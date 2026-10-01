var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// server.ts
var server_exports = {};
__export(server_exports, {
  extractSegmentHeroStoragePath: () => extractSegmentHeroStoragePath,
  validateHeroUploadPayload: () => validateHeroUploadPayload
});
module.exports = __toCommonJS(server_exports);
var import_config = require("dotenv/config");
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_crypto5 = require("crypto");
var import_http = require("http");

// src/config/app.ts
var APP_CONFIG = {
  // Canonical booking hold window. The database is authoritative and enforces
  // the same value from `platform_config.hold_duration_minutes`; this constant
  // only mirrors it for display and for the server's own copy of the timeline.
  HOLD_DURATION_MS: 5 * 60 * 1e3,
  SESSION_ACCESS_WINDOW_MS: 5 * 60 * 1e3,
  // Authoritative booking cutoff. A slot stays bookable while
  // `slotStart - now >= BOOKING_CUTOFF_MS`, measured on absolute instants and
  // therefore independent of any display timezone. This replaces the old
  // 2-hour advance restriction, which no longer exists.
  //
  // This is NOT the mentor meeting-link deadline below: that is an operational
  // rule for mentors adding a meeting URL and must never block booking.
  BOOKING_CUTOFF_MS: 5 * 60 * 1e3,
  // Mentor meeting-link submission deadline. The mentor may provide or update
  // the meeting link until `scheduledStart - MEETING_LINK_DEADLINE_MS`. Missing
  // the deadline is recorded as an audit exception only; it never cancels the
  // booking. This is a separate rule from `SESSION_ACCESS_WINDOW_MS`, which is
  // when the seeker's copy of the link becomes visible.
  MEETING_LINK_DEADLINE_MS: 5 * 60 * 1e3,
  NORMAL_CANCELLATION_WINDOW_MINUTES: 10,
  MVP_PAYMENT_METHOD: "manual_qr",
  DEFAULT_TIMEZONE: "Asia/Kolkata"
};
var HOLDOUT_MINUTES = APP_CONFIG.HOLD_DURATION_MS / (60 * 1e3) | 0;
var SESSION_ACCESS_WINDOW_MINUTES = APP_CONFIG.SESSION_ACCESS_WINDOW_MS / (60 * 1e3) | 0;
var BOOKING_CUTOFF_MINUTES = APP_CONFIG.BOOKING_CUTOFF_MS / (60 * 1e3) | 0;
var MEETING_LINK_DEADLINE_MINUTES = APP_CONFIG.MEETING_LINK_DEADLINE_MS / (60 * 1e3) | 0;
var CANCELLATION_WINDOW_MINUTES = APP_CONFIG.NORMAL_CANCELLATION_WINDOW_MINUTES;
var CANCELLATION_WINDOW_MS = APP_CONFIG.NORMAL_CANCELLATION_WINDOW_MINUTES * 60 * 1e3;

// src/lib/slotEngine.ts
function getTimezoneOffsetMs(timeZone, date) {
  try {
    const utcDate = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
    const tzDate = new Date(date.toLocaleString("en-US", { timeZone }));
    return tzDate.getTime() - utcDate.getTime();
  } catch (err) {
    console.warn(`Invalid timezone "${timeZone}", falling back to UTC`, err);
    return 0;
  }
}
function parseZonedDateTime(dateStr, timeStr, timeZone) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const timeParts = timeStr.split(":").map(Number);
  const hh = timeParts[0] || 0;
  const mm = timeParts[1] || 0;
  const ss = timeParts[2] || 0;
  const naiveUtc = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
  const offset1 = getTimezoneOffsetMs(timeZone, naiveUtc);
  const candidate = new Date(naiveUtc.getTime() - offset1);
  const offset2 = getTimezoneOffsetMs(timeZone, candidate);
  return new Date(naiveUtc.getTime() - offset2);
}
function addDaysToDateString(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().split("T")[0];
}
function getDayOfWeekFromDateString(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const midDay = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return midDay.getUTCDay();
}
function timeStringToMinutes(timeStr) {
  const [hh, mm] = timeStr.split(":").map(Number);
  return (hh || 0) * 60 + (mm || 0);
}
function minutesToTimeString(minutes) {
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  const pad = (n) => n < 10 ? `0${n}` : `${n}`;
  return `${pad(hh)}:${pad(mm)}`;
}
function intervalsOverlap(start1, end1, start2, end2) {
  const s1 = typeof start1 === "number" ? start1 : start1.getTime();
  const e1 = typeof end1 === "number" ? end1 : end1.getTime();
  const s2 = typeof start2 === "number" ? start2 : start2.getTime();
  const e2 = typeof end2 === "number" ? end2 : end2.getTime();
  return s1 < e2 && e1 > s2;
}
function isSlotConflicting(start1, end1, start2, end2) {
  const s1 = typeof start1 === "string" ? new Date(start1).getTime() : typeof start1 === "number" ? start1 : start1.getTime();
  const e1 = typeof end1 === "string" ? new Date(end1).getTime() : typeof end1 === "number" ? end1 : end1.getTime();
  const s2 = typeof start2 === "string" ? new Date(start2).getTime() : typeof start2 === "number" ? start2 : start2.getTime();
  const e2 = typeof end2 === "string" ? new Date(end2).getTime() : typeof end2 === "number" ? end2 : end2.getTime();
  return s1 < e2 && e1 > s2;
}
function generateMentorSlots(options) {
  const {
    mentorId,
    gigId,
    dateStr,
    timezone,
    durationMinutes,
    recurringAvailability,
    exceptions,
    bookings,
    slotHolds,
    currentUtcTime = /* @__PURE__ */ new Date()
  } = options;
  if (durationMinutes <= 0) {
    return [];
  }
  const dateException = exceptions.find(
    (e) => e.mentor_id === mentorId && e.exception_date === dateStr
  );
  let activeWindows = [];
  if (dateException) {
    if (!dateException.is_available) {
      return [];
    }
    if (dateException.start_time && dateException.end_time) {
      activeWindows.push({
        start_time: dateException.start_time,
        end_time: dateException.end_time
      });
    }
  } else {
    const targetDayOfWeek = getDayOfWeekFromDateString(dateStr);
    const dayRules = recurringAvailability.filter(
      (a) => a.mentor_id === mentorId && a.day_of_week === targetDayOfWeek && a.is_enabled
    );
    for (const rule of dayRules) {
      activeWindows.push({
        start_time: rule.start_time,
        end_time: rule.end_time
      });
    }
  }
  if (activeWindows.length === 0) {
    return [];
  }
  const mentorBookings = bookings.filter(
    (b) => b.mentor_id === mentorId && !["CANCELLED", "REJECTED"].includes(b.status)
  );
  const nowMs = currentUtcTime.getTime();
  const mentorActiveHolds = slotHolds.filter(
    (h) => h.mentor_id === mentorId && h.status === "ACTIVE" && new Date(h.expires_at).getTime() > nowMs
  );
  const generatedSlots = [];
  for (const window of activeWindows) {
    const windowStartMin = timeStringToMinutes(window.start_time);
    const windowEndMin = timeStringToMinutes(window.end_time);
    for (let curMin = windowStartMin; curMin + durationMinutes <= windowEndMin; curMin += durationMinutes) {
      const slotStartMin = curMin;
      const slotEndMin = curMin + durationMinutes;
      const localStartTime = minutesToTimeString(slotStartMin);
      const localEndTime = minutesToTimeString(slotEndMin);
      const slotUtcStart = parseZonedDateTime(dateStr, localStartTime, timezone);
      const slotUtcEnd = parseZonedDateTime(dateStr, localEndTime, timezone);
      const slotUtcStartMs = slotUtcStart.getTime();
      const slotUtcEndMs = slotUtcEnd.getTime();
      let status = "AVAILABLE";
      let isAvailable = true;
      let conflictReason = void 0;
      if (slotUtcStartMs <= nowMs) {
        status = "PAST";
        isAvailable = false;
        conflictReason = "PAST";
      } else if (slotUtcStartMs - nowMs < APP_CONFIG.BOOKING_CUTOFF_MS) {
        status = "CLOSING_SOON";
        isAvailable = false;
        conflictReason = "BOOKING_CUTOFF";
      } else {
        const hasBookingConflict = mentorBookings.some((b) => {
          const bStart = new Date(b.start_time).getTime();
          const bEnd = new Date(b.end_time).getTime();
          return intervalsOverlap(slotUtcStartMs, slotUtcEndMs, bStart, bEnd);
        });
        if (hasBookingConflict) {
          status = "BOOKED";
          isAvailable = false;
          conflictReason = "BOOKING_CONFLICT";
        } else {
          const hasHoldConflict = mentorActiveHolds.some((h) => {
            const hStart = new Date(h.start_time).getTime();
            const hEnd = new Date(h.end_time).getTime();
            return intervalsOverlap(slotUtcStartMs, slotUtcEndMs, hStart, hEnd);
          });
          if (hasHoldConflict) {
            status = "HELD";
            isAvailable = false;
            conflictReason = "HOLD_CONFLICT";
          }
        }
      }
      generatedSlots.push({
        id: `${mentorId}_${slotUtcStart.toISOString()}`,
        mentor_id: mentorId,
        gig_id: gigId,
        date: dateStr,
        local_start_time: localStartTime,
        local_end_time: localEndTime,
        utc_start_time: slotUtcStart.toISOString(),
        utc_end_time: slotUtcEnd.toISOString(),
        duration_minutes: durationMinutes,
        timezone,
        status,
        is_available: isAvailable,
        conflict_reason: conflictReason
      });
    }
  }
  return generatedSlots.sort(
    (a, b) => new Date(a.utc_start_time).getTime() - new Date(b.utc_start_time).getTime()
  );
}

// src/lib/bookingEngine.ts
var mentorLocks = /* @__PURE__ */ new Map();
async function acquireMentorLock(mentorId) {
  while (mentorLocks.has(mentorId)) {
    await mentorLocks.get(mentorId);
  }
  let resolveLock;
  const lockPromise = new Promise((resolve) => {
    resolveLock = resolve;
  });
  mentorLocks.set(mentorId, lockPromise);
  return () => {
    mentorLocks.delete(mentorId);
    resolveLock();
  };
}
async function executeAtomicBookingWithHold(input, db) {
  const currentUtcTime = input.currentUtcTime || /* @__PURE__ */ new Date();
  const releaseLock = await acquireMentorLock(input.mentorId);
  try {
    if (!input.seekerId || typeof input.seekerId !== "string") {
      return {
        success: false,
        error: { code: "AUTH_REQUIRED", message: "Authentication required: missing seeker ID." }
      };
    }
    const seeker = db.profiles.find((p) => p.id === input.seekerId);
    if (!seeker) {
      return {
        success: false,
        error: { code: "SEEKER_NOT_FOUND", message: "Seeker user profile does not exist." }
      };
    }
    const hasSeekerRole = db.userRoles.some(
      (r) => r.user_id === input.seekerId && r.role === "seeker"
    );
    if (!hasSeekerRole) {
      return {
        success: false,
        error: { code: "ROLE_NOT_SEEKER", message: "User does not possess the seeker role." }
      };
    }
    const mentor = db.profiles.find((p) => p.id === input.mentorId);
    const mentorProfile = db.mentorProfiles.find((mp) => mp.id === input.mentorId);
    if (!mentor || !mentorProfile) {
      return {
        success: false,
        error: { code: "MENTOR_NOT_FOUND", message: "Mentor profile not found." }
      };
    }
    if (!mentorProfile.is_approved) {
      return {
        success: false,
        error: { code: "MENTOR_NOT_APPROVED", message: "Mentor is not currently approved." }
      };
    }
    const segment = db.segments.find((s) => s.id === input.segmentId);
    if (!segment || !segment.is_active) {
      return {
        success: false,
        error: { code: "SEGMENT_INACTIVE", message: "Selected mentorship segment is not active." }
      };
    }
    const belongsToSegment = db.mentorSegments.some(
      (ms) => ms.mentor_id === input.mentorId && ms.segment_id === input.segmentId
    );
    if (!belongsToSegment) {
      return {
        success: false,
        error: {
          code: "MENTOR_SEGMENT_MISMATCH",
          message: "Mentor is not registered under the selected segment."
        }
      };
    }
    const gig = db.gigs.find((g) => g.id === input.gigId);
    if (!gig || !gig.is_active) {
      return {
        success: false,
        error: { code: "GIG_INACTIVE", message: "Selected gig is inactive or does not exist." }
      };
    }
    if (gig.mentor_id !== input.mentorId || gig.segment_id !== input.segmentId) {
      return {
        success: false,
        error: {
          code: "GIG_MISMATCH",
          message: "Gig does not match the specified mentor or segment."
        }
      };
    }
    const startMs = new Date(input.startTime).getTime();
    const endMs = new Date(input.endTime).getTime();
    if (isNaN(startMs) || isNaN(endMs) || startMs >= endMs) {
      return {
        success: false,
        error: {
          code: "INVALID_INTERVAL",
          message: "Slot start time must be strictly earlier than end time."
        }
      };
    }
    const slotDurationMinutes = Math.round((endMs - startMs) / 6e4);
    if (slotDurationMinutes !== gig.duration_minutes) {
      return {
        success: false,
        error: {
          code: "DURATION_MISMATCH",
          message: `Slot interval (${slotDurationMinutes}m) must exactly equal gig duration (${gig.duration_minutes}m).`
        }
      };
    }
    const mentorTz = mentor.timezone || "Asia/Kolkata";
    const seekerTz = seeker.timezone || "Asia/Kolkata";
    const startZoned = new Date(input.startTime);
    const endZoned = new Date(input.endTime);
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: mentorTz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    const localDateStr = formatter.format(startZoned);
    const dowFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: mentorTz,
      weekday: "short"
    });
    const weekdayStr = dowFormatter.format(startZoned);
    const dowMap = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6
    };
    const dayOfWeek = dowMap[weekdayStr];
    const timeFormatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: mentorTz,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
    const localStartTime = timeFormatter.format(startZoned);
    const localEndTime = timeFormatter.format(endZoned);
    const canonicalStartUtc = parseZonedDateTime(localDateStr, localStartTime.slice(0, 5), mentorTz);
    if (Math.abs(new Date(canonicalStartUtc).getTime() - startMs) > 6e4) {
      return {
        success: false,
        error: {
          code: "TIMEZONE_DRIFT_DETECTED",
          message: "Client provided timestamp does not align with mentor timezone operating boundary."
        }
      };
    }
    if (startMs <= currentUtcTime.getTime()) {
      return {
        success: false,
        error: {
          code: "PAST_SLOT_FORBIDDEN",
          message: "Cannot book or hold a slot that begins in the past."
        }
      };
    }
    if (startMs - currentUtcTime.getTime() < APP_CONFIG.BOOKING_CUTOFF_MS) {
      return {
        success: false,
        error: {
          code: "BOOKING_CUTOFF_REACHED",
          message: `This slot can no longer be booked because it starts in less than ${APP_CONFIG.BOOKING_CUTOFF_MS / 6e4} minutes.`
        }
      };
    }
    const exception = db.mentorAvailabilityExceptions.find(
      (e) => e.mentor_id === input.mentorId && e.exception_date === localDateStr
    );
    if (exception) {
      if (!exception.is_available) {
        return {
          success: false,
          error: {
            code: "DATE_EXCEPTION_UNAVAILABLE",
            message: "Mentor has marked this date as unavailable (leave/holiday)."
          }
        };
      }
      if (exception.start_time && exception.end_time) {
        if (localStartTime < exception.start_time || localEndTime > exception.end_time) {
          return {
            success: false,
            error: {
              code: "OUTSIDE_EXCEPTION_HOURS",
              message: `Slot falls outside custom operating hours for this date (${exception.start_time} - ${exception.end_time}).`
            }
          };
        }
      }
    } else {
      const recurring = db.mentorAvailability.find(
        (a) => a.mentor_id === input.mentorId && a.day_of_week === dayOfWeek && a.is_enabled && a.start_time <= localStartTime && a.end_time >= localEndTime
      );
      if (!recurring) {
        return {
          success: false,
          error: {
            code: "OUTSIDE_AVAILABILITY",
            message: "Slot falls outside mentor regular operating hours for this day of the week."
          }
        };
      }
    }
    const conflictingBooking = db.bookings.find(
      (b) => b.mentor_id === input.mentorId && b.status !== "CANCELLED" && b.status !== "REJECTED" && b.status !== "PAYMENT_PENDING" && isSlotConflicting(input.startTime, input.endTime, b.start_time, b.end_time)
    );
    if (conflictingBooking) {
      return {
        success: false,
        error: {
          code: "SLOT_ALREADY_BOOKED",
          message: "The requested slot conflicts with an existing confirmed booking for this mentor."
        }
      };
    }
    db.slotHolds.forEach((h) => {
      if (h.mentor_id === input.mentorId && h.status === "ACTIVE" && new Date(h.expires_at).getTime() <= currentUtcTime.getTime()) {
        h.status = "EXPIRED";
        const pendingBk = db.bookings.find((b) => b.hold_id === h.id && b.status === "PAYMENT_PENDING");
        if (pendingBk) {
          pendingBk.status = "CANCELLED";
        }
      }
    });
    const conflictingHold = db.slotHolds.find(
      (h) => h.mentor_id === input.mentorId && h.status === "ACTIVE" && new Date(h.expires_at).getTime() > currentUtcTime.getTime() && isSlotConflicting(input.startTime, input.endTime, h.start_time, h.end_time)
    );
    if (conflictingHold) {
      return {
        success: false,
        error: {
          code: "SLOT_HELD_BY_OTHER",
          message: `The requested slot is currently held by another seeker (${HOLDOUT_MINUTES}-minute hold active).`
        }
      };
    }
    const holdExpiresAt = new Date(currentUtcTime.getTime() + APP_CONFIG.HOLD_DURATION_MS).toISOString();
    const holdId = "hold-" + Math.random().toString(36).substring(2, 11);
    const newHold = {
      id: holdId,
      mentor_id: input.mentorId,
      seeker_id: input.seekerId,
      gig_id: input.gigId,
      start_time: input.startTime,
      end_time: input.endTime,
      status: "ACTIVE",
      expires_at: holdExpiresAt,
      created_at: currentUtcTime.toISOString()
    };
    const bookingCode = "BK-" + Math.random().toString(36).substring(2, 6).toUpperCase() + Math.floor(1e3 + Math.random() * 9e3);
    const bookingId = "bk-" + Math.random().toString(36).substring(2, 11);
    const newBooking = {
      id: bookingId,
      booking_code: bookingCode,
      mentor_id: input.mentorId,
      seeker_id: input.seekerId,
      gig_id: input.gigId,
      segment_id: input.segmentId,
      hold_id: holdId,
      start_time: input.startTime,
      end_time: input.endTime,
      seeker_timezone: seekerTz,
      mentor_timezone: mentorTz,
      amount_inr: gig.price_inr,
      status: "PAYMENT_PENDING",
      meeting_url: null,
      actual_ended_at: null,
      ended_by_role: null,
      end_reason: null,
      cancellation_reason: null,
      created_at: currentUtcTime.toISOString(),
      updated_at: currentUtcTime.toISOString(),
      gig,
      segment
    };
    db.slotHolds.push(newHold);
    db.bookings.push(newBooking);
    return {
      success: true,
      booking: newBooking,
      hold: newHold,
      expires_at: holdExpiresAt,
      booking_code: bookingCode
    };
  } finally {
    releaseLock();
  }
}
function validateMeetingUrl(url) {
  if (!url || typeof url !== "string" || url.trim() === "") {
    return {
      isValid: false,
      error: "Meeting link is required to confirm the session."
    };
  }
  const trimmed = url.trim();
  if (!trimmed.toLowerCase().startsWith("https://")) {
    return {
      isValid: false,
      error: "Meeting link must begin with secure https:// protocol."
    };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:") {
      return {
        isValid: false,
        error: "Meeting link must use https:// protocol."
      };
    }
    if (!parsed.hostname || !parsed.hostname.includes(".")) {
      return {
        isValid: false,
        error: "Meeting link must have a valid domain (e.g. meet.google.com, zoom.us, teams.microsoft.com)."
      };
    }
    return {
      isValid: true,
      normalizedUrl: trimmed
    };
  } catch {
    return {
      isValid: false,
      error: "Meeting link must be a valid HTTPS URL."
    };
  }
}
function calculateMeetingLinkDeadline(startTimeUtc, nowUtc = /* @__PURE__ */ new Date()) {
  const sessionStartMs = new Date(startTimeUtc).getTime();
  const deadlineMs = sessionStartMs - APP_CONFIG.MEETING_LINK_DEADLINE_MS;
  const nowMs = nowUtc.getTime();
  const isOverdue = nowMs > deadlineMs;
  const minutesUntilSession = Math.floor((sessionStartMs - nowMs) / (1e3 * 60));
  const hoursUntilSession = Number(((sessionStartMs - nowMs) / (1e3 * 60 * 60)).toFixed(1));
  return {
    deadlineUtc: new Date(deadlineMs).toISOString(),
    isOverdue,
    hoursUntilSession,
    minutesUntilSession
  };
}
async function confirmSessionByMentor(input, db) {
  const currentUtcTime = input.currentUtcTime || /* @__PURE__ */ new Date();
  if (!input.mentorId) {
    return {
      success: false,
      error: { code: "AUTH_REQUIRED", message: "Mentor authentication required." }
    };
  }
  const booking = db.bookings.find((b) => b.id === input.bookingId);
  if (!booking) {
    return {
      success: false,
      error: { code: "BOOKING_NOT_FOUND", message: "Booking not found." }
    };
  }
  const isOwner = booking.mentor_id === input.mentorId;
  if (!isOwner) {
    return {
      success: false,
      error: {
        code: "FORBIDDEN_NOT_BOOKING_OWNER",
        message: "Forbidden: You are not authorized to confirm this booking."
      }
    };
  }
  if (booking.status !== "MENTOR_PENDING") {
    if (booking.status === "PAYMENT_PENDING" || booking.status === "PENDING_VERIFICATION") {
      return {
        success: false,
        error: {
          code: "PAYMENT_NOT_VERIFIED",
          message: "Cannot confirm session: Payment verification is still pending."
        }
      };
    }
    if (booking.status === "CONFIRMED") {
      return {
        success: false,
        error: {
          code: "ALREADY_CONFIRMED",
          message: "Booking has already been confirmed."
        }
      };
    }
    return {
      success: false,
      error: {
        code: "INVALID_BOOKING_STATUS",
        message: `Booking is in '${booking.status}' status. Only MENTOR_PENDING bookings can be confirmed.`
      }
    };
  }
  const urlValidation = validateMeetingUrl(input.meetingUrl);
  if (!urlValidation.isValid) {
    return {
      success: false,
      error: {
        code: "INVALID_MEETING_URL",
        message: urlValidation.error || "A valid HTTPS meeting link is required."
      }
    };
  }
  const deadlineInfo = calculateMeetingLinkDeadline(booking.start_time, currentUtcTime);
  booking.status = "CONFIRMED";
  booking.meeting_url = urlValidation.normalizedUrl;
  booking.updated_at = currentUtcTime.toISOString();
  if (!db.notifications) {
    db.notifications = [];
  }
  const seekerNotification = {
    id: `notif-seeker-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    user_id: booking.seeker_id,
    title: "Session Confirmed by Mentor",
    message: `Your mentor has confirmed session ${booking.booking_code}. Your secure meeting link will unlock 5 minutes prior to session start.`,
    type: "SESSION",
    link: `/seeker/bookings?bookingId=${booking.id}`,
    is_read: false,
    created_at: currentUtcTime.toISOString()
  };
  db.notifications.push(seekerNotification);
  const mentorNotification = {
    id: `notif-mentor-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    user_id: booking.mentor_id,
    title: "Session Confirmed Successfully",
    message: `You confirmed session ${booking.booking_code}. The meeting link has been securely stored.`,
    type: "SESSION",
    link: `/mentor/booking-detail?bookingId=${booking.id}`,
    is_read: false,
    created_at: currentUtcTime.toISOString()
  };
  db.notifications.push(mentorNotification);
  return {
    success: true,
    booking,
    isOverdue: deadlineInfo.isOverdue,
    message: "Session confirmed successfully."
  };
}
function transitionExpiredBookingsToCompleted(db, nowUtc = /* @__PURE__ */ new Date()) {
  const nowMs = nowUtc.getTime();
  const transitioned = [];
  for (const booking of db.bookings) {
    if (booking.status === "CONFIRMED") {
      const endMs = new Date(booking.end_time).getTime();
      if (nowMs >= endMs) {
        booking.status = "COMPLETED";
        booking.updated_at = nowUtc.toISOString();
        transitioned.push(booking);
        if (!db.notifications) {
          db.notifications = [];
        }
        const notifExists = db.notifications.some(
          (n) => n.user_id === booking.seeker_id && n.link?.includes(booking.id) && n.title.includes("Completed")
        );
        if (!notifExists) {
          db.notifications.push({
            id: `notif-comp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            user_id: booking.seeker_id,
            title: "Session Completed",
            message: `Your session ${booking.booking_code} has concluded. You can access your session notes anytime.`,
            type: "SESSION",
            link: `/seeker/bookings?bookingId=${booking.id}`,
            is_read: false,
            created_at: nowUtc.toISOString()
          });
        }
      }
    }
  }
  return transitioned;
}
function validateSessionAccess(input, db) {
  const now = input.currentUtcTime || /* @__PURE__ */ new Date();
  const nowMs = now.getTime();
  transitionExpiredBookingsToCompleted(db, now);
  const booking = db.bookings.find(
    (b) => b.id === input.bookingId || b.booking_code.toUpperCase() === input.bookingId.toUpperCase()
  );
  if (!booking) {
    return {
      success: false,
      canJoin: false,
      accessState: "COMPLETED",
      sessionState: "COMPLETED",
      meetingUrl: null,
      sessionTitle: "Session Not Found",
      mentorName: "",
      seekerName: "",
      mentorId: "",
      seekerId: "",
      startTime: "",
      endTime: "",
      currentServerTime: now.toISOString(),
      secondsUntilT5: 0,
      secondsUntilStart: 0,
      secondsUntilEnd: 0,
      bookingStatus: "CANCELLED",
      bookingCode: "",
      message: "Booking not found.",
      error: { code: "BOOKING_NOT_FOUND", message: "Booking not found." }
    };
  }
  const gig = db.gigs.find((g) => g.id === booking.gig_id);
  const mentorProfile = db.profiles.find((p) => p.id === booking.mentor_id);
  const seekerProfile = db.profiles.find((p) => p.id === booking.seeker_id);
  const sessionTitle = gig?.title || "1:1 Mentorship Session";
  const mentorName = mentorProfile?.full_name || "Mentor";
  const seekerName = seekerProfile?.full_name || "Seeker";
  const isSeeker = booking.seeker_id === input.userId;
  const isMentor = booking.mentor_id === input.userId;
  const userRole = db.userRoles.find((r) => r.user_id === input.userId)?.role;
  const isAdmin = userRole === "admin";
  if (!isSeeker && !isMentor && !isAdmin) {
    return {
      success: false,
      canJoin: false,
      accessState: "BEFORE_T5",
      sessionState: "SCHEDULED",
      meetingUrl: null,
      sessionTitle,
      mentorName,
      seekerName,
      mentorId: booking.mentor_id,
      seekerId: booking.seeker_id,
      startTime: booking.start_time,
      endTime: booking.end_time,
      currentServerTime: now.toISOString(),
      secondsUntilT5: 0,
      secondsUntilStart: 0,
      secondsUntilEnd: 0,
      bookingStatus: booking.status,
      bookingCode: booking.booking_code,
      message: "Forbidden: You are not an authorized participant in this session.",
      error: {
        code: "FORBIDDEN_NOT_PARTICIPANT",
        message: "Forbidden: You are not authorized to access this session."
      }
    };
  }
  if (booking.status === "PAYMENT_PENDING" || booking.status === "PENDING_VERIFICATION") {
    return {
      success: false,
      canJoin: false,
      accessState: "BEFORE_T5",
      sessionState: "SCHEDULED",
      meetingUrl: null,
      sessionTitle,
      mentorName,
      seekerName,
      mentorId: booking.mentor_id,
      seekerId: booking.seeker_id,
      startTime: booking.start_time,
      endTime: booking.end_time,
      currentServerTime: now.toISOString(),
      secondsUntilT5: 0,
      secondsUntilStart: 0,
      secondsUntilEnd: 0,
      bookingStatus: booking.status,
      bookingCode: booking.booking_code,
      message: "Payment verification is pending for this session.",
      error: {
        code: "PAYMENT_NOT_VERIFIED",
        message: "This session has not been verified yet."
      }
    };
  }
  if (booking.status === "MENTOR_PENDING") {
    return {
      success: false,
      canJoin: false,
      accessState: "BEFORE_T5",
      sessionState: "SCHEDULED",
      meetingUrl: null,
      sessionTitle,
      mentorName,
      seekerName,
      mentorId: booking.mentor_id,
      seekerId: booking.seeker_id,
      startTime: booking.start_time,
      endTime: booking.end_time,
      currentServerTime: now.toISOString(),
      secondsUntilT5: 0,
      secondsUntilStart: 0,
      secondsUntilEnd: 0,
      bookingStatus: booking.status,
      bookingCode: booking.booking_code,
      message: "Session is awaiting mentor confirmation and meeting link.",
      error: {
        code: "MENTOR_CONFIRMATION_PENDING",
        message: "Mentor has not yet confirmed the session."
      }
    };
  }
  if (booking.status === "CANCELLED" || booking.status === "REJECTED") {
    return {
      success: false,
      canJoin: false,
      accessState: "COMPLETED",
      sessionState: "CANCELLED",
      meetingUrl: null,
      sessionTitle,
      mentorName,
      seekerName,
      mentorId: booking.mentor_id,
      seekerId: booking.seeker_id,
      startTime: booking.start_time,
      endTime: booking.end_time,
      currentServerTime: now.toISOString(),
      secondsUntilT5: 0,
      secondsUntilStart: 0,
      secondsUntilEnd: 0,
      bookingStatus: booking.status,
      bookingCode: booking.booking_code,
      message: `This session was ${booking.status.toLowerCase()}.`,
      error: {
        code: "BOOKING_CANCELLED",
        message: `This session was ${booking.status.toLowerCase()}.`
      }
    };
  }
  const startMs = new Date(booking.start_time).getTime();
  const endMs = new Date(booking.end_time).getTime();
  const t5Ms = startMs - APP_CONFIG.SESSION_ACCESS_WINDOW_MS;
  const secondsUntilT5 = Math.max(0, Math.ceil((t5Ms - nowMs) / 1e3));
  const secondsUntilStart = Math.max(0, Math.ceil((startMs - nowMs) / 1e3));
  const secondsUntilEnd = Math.max(0, Math.ceil((endMs - nowMs) / 1e3));
  const manualEndedAtMs = booking.actual_ended_at ? new Date(booking.actual_ended_at).getTime() : 0;
  const hasManualEnd = Number.isFinite(manualEndedAtMs) && manualEndedAtMs > 0;
  if (nowMs >= endMs || booking.status === "COMPLETED" || hasManualEnd) {
    if (booking.status !== "COMPLETED") {
      booking.status = "COMPLETED";
      booking.updated_at = now.toISOString();
    }
    const endedBeforeScheduledEnd = hasManualEnd && manualEndedAtMs < endMs;
    return {
      success: true,
      canJoin: false,
      accessState: endedBeforeScheduledEnd ? "ENDED" : "COMPLETED",
      sessionState: "COMPLETED",
      meetingUrl: null,
      // Strictly hidden / inactive
      sessionTitle,
      mentorName,
      seekerName,
      mentorId: booking.mentor_id,
      seekerId: booking.seeker_id,
      startTime: booking.start_time,
      endTime: booking.end_time,
      currentServerTime: now.toISOString(),
      secondsUntilT5: 0,
      secondsUntilStart: 0,
      secondsUntilEnd: 0,
      bookingStatus: "COMPLETED",
      bookingCode: booking.booking_code,
      message: endedBeforeScheduledEnd ? "Session was ended early by the mentor. Joining is no longer permitted." : "Session has concluded. Thank you for participating.",
      error: {
        code: "SESSION_ENDED",
        message: endedBeforeScheduledEnd ? "This session was ended early by the mentor. Joining is no longer permitted." : "This session has already ended. Joining is no longer permitted."
      }
    };
  }
  if (nowMs < t5Ms) {
    return {
      success: true,
      canJoin: false,
      accessState: "BEFORE_T5",
      sessionState: "SCHEDULED",
      meetingUrl: null,
      // Strictly hidden!
      sessionTitle,
      mentorName,
      seekerName,
      mentorId: booking.mentor_id,
      seekerId: booking.seeker_id,
      startTime: booking.start_time,
      endTime: booking.end_time,
      currentServerTime: now.toISOString(),
      secondsUntilT5,
      secondsUntilStart,
      secondsUntilEnd,
      bookingStatus: booking.status,
      bookingCode: booking.booking_code,
      message: "Meeting link unlocks exactly 5 minutes before scheduled start.",
      error: {
        code: "TOO_EARLY",
        message: "Access opens 5 minutes before session start."
      }
    };
  }
  if (nowMs >= t5Ms && nowMs < startMs) {
    return {
      success: true,
      canJoin: true,
      accessState: "T5_WINDOW",
      sessionState: "ACCESS_OPEN",
      meetingUrl: booking.meeting_url,
      // Available!
      sessionTitle,
      mentorName,
      seekerName,
      mentorId: booking.mentor_id,
      seekerId: booking.seeker_id,
      startTime: booking.start_time,
      endTime: booking.end_time,
      currentServerTime: now.toISOString(),
      secondsUntilT5: 0,
      secondsUntilStart,
      secondsUntilEnd,
      bookingStatus: booking.status,
      bookingCode: booking.booking_code,
      message: "Early access window is open. You may now join the session room."
    };
  }
  return {
    success: true,
    canJoin: true,
    accessState: "IN_PROGRESS",
    sessionState: "IN_PROGRESS",
    meetingUrl: booking.meeting_url,
    // Available!
    sessionTitle,
    mentorName,
    seekerName,
    mentorId: booking.mentor_id,
    seekerId: booking.seeker_id,
    startTime: booking.start_time,
    endTime: booking.end_time,
    currentServerTime: now.toISOString(),
    secondsUntilT5: 0,
    secondsUntilStart: 0,
    secondsUntilEnd,
    bookingStatus: booking.status,
    bookingCode: booking.booking_code,
    message: "Session is currently in progress. Join immediately."
  };
}
function joinSessionAuthoritative(input, db) {
  const result = validateSessionAccess(input, db);
  if (!result.canJoin) {
    return {
      success: false,
      canJoin: false,
      accessState: result.accessState,
      sessionState: result.sessionState,
      bookingCode: result.bookingCode,
      error: result.error || {
        code: result.accessState === "BEFORE_T5" ? "TOO_EARLY" : "SESSION_ENDED",
        message: result.message
      }
    };
  }
  return {
    success: true,
    canJoin: true,
    meetingUrl: result.meetingUrl || void 0,
    accessState: result.accessState,
    sessionState: result.sessionState,
    bookingCode: result.bookingCode
  };
}

// src/lib/gigContext.ts
function describeBookingContextMismatch(input) {
  const { gig, mentorId, segmentId, gigId } = input;
  if (!gig) return `gig ${gigId} does not exist`;
  if (gig.id !== gigId) return `gig ${gigId} was resolved as ${gig.id}`;
  if (gig.mentor_id !== mentorId) {
    return `gig ${gigId} belongs to mentor ${gig.mentor_id}, not ${mentorId}`;
  }
  if (gig.segment_id !== segmentId) {
    return `gig ${gigId} belongs to segment ${gig.segment_id}, not ${segmentId}`;
  }
  if (gig.is_active !== true) return `gig ${gigId} is no longer active`;
  return null;
}

// src/lib/sessionAccess.ts
var SESSION_ACCESS_WINDOW_MS = APP_CONFIG.SESSION_ACCESS_WINDOW_MS;
var BOOKING_ID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
var BOOKING_CODE_PATTERN = /^[A-Za-z0-9_-]{4,40}$/;
function isBookingIdShape(value) {
  return typeof value === "string" && BOOKING_ID_PATTERN.test(value);
}
function isBookingCodeShape(value) {
  return typeof value === "string" && BOOKING_CODE_PATTERN.test(value);
}
function isSafeBookingIdentifier(value) {
  return isBookingIdShape(value) || isBookingCodeShape(value);
}
function isInsideSessionAccessWindow(booking, now = /* @__PURE__ */ new Date()) {
  const nowMs = now.getTime();
  const startMs = new Date(booking.start_time ?? "").getTime();
  const endMs = new Date(booking.end_time ?? "").getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
  return nowMs >= startMs - SESSION_ACCESS_WINDOW_MS && nowMs < endMs;
}
function redactMeetingUrlForParticipant(booking, options) {
  if (options.isAdmin || options.isMentor) return booking;
  if (!booking.meeting_url) return booking;
  if (booking.status === "CANCELLED" || booking.status === "REJECTED") {
    return { ...booking, meeting_url: null };
  }
  if (booking.actual_ended_at) return { ...booking, meeting_url: null };
  if (isInsideSessionAccessWindow(booking, options.now)) return booking;
  return { ...booking, meeting_url: null };
}

// src/lib/bookingLifecycle.ts
function isTerminalCancelled(status) {
  return status === "CANCELLED" || status === "REJECTED";
}
function parseMs(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}
function resolveBookingLifecycle(booking, nowMs = Date.now()) {
  const status = String(booking.status ?? "");
  const startMs = parseMs(booking.start_time);
  const endMs = parseMs(booking.end_time);
  const hasMeetingUrl = typeof booking.meeting_url === "string" && booking.meeting_url.trim() !== "";
  const manuallyEnded = parseMs(booking.actual_ended_at) !== null;
  const sessionStarted = startMs === null ? false : nowMs >= startMs;
  const deadlineMs = startMs === null ? null : startMs - APP_CONFIG.MEETING_LINK_DEADLINE_MS;
  const meetingLinkDeadlineUtc = deadlineMs === null ? null : new Date(deadlineMs).toISOString();
  const base = { meetingLinkDeadlineUtc, status, sessionStarted };
  if (isTerminalCancelled(status)) {
    return { ...base, bucket: "CANCELLED", isOverdue: false, overdueByMs: 0, canAddMeetingLink: false };
  }
  if (status === "COMPLETED" || manuallyEnded) {
    return { ...base, bucket: "COMPLETED", isOverdue: false, overdueByMs: 0, canAddMeetingLink: false };
  }
  if (status === "MENTOR_PENDING") {
    if (hasMeetingUrl) {
      return {
        ...base,
        bucket: "PENDING_CONFIRMATION",
        isOverdue: false,
        overdueByMs: 0,
        canAddMeetingLink: true
      };
    }
    const isOverdue = deadlineMs !== null && nowMs > deadlineMs;
    return {
      ...base,
      bucket: isOverdue ? "OVERDUE" : "PENDING_CONFIRMATION",
      isOverdue,
      overdueByMs: isOverdue && deadlineMs !== null ? nowMs - deadlineMs : 0,
      canAddMeetingLink: true
    };
  }
  if (endMs !== null && nowMs >= endMs) {
    return { ...base, bucket: "COMPLETED", isOverdue: false, overdueByMs: 0, canAddMeetingLink: false };
  }
  if (status === "CONFIRMED") {
    return { ...base, bucket: "CONFIRMED", isOverdue: false, overdueByMs: 0, canAddMeetingLink: false };
  }
  const bucket = status === "PENDING_VERIFICATION" ? "AWAITING_VERIFICATION" : "AWAITING_PAYMENT";
  return { ...base, bucket, isOverdue: false, overdueByMs: 0, canAddMeetingLink: false };
}
function isMeetingLinkDeadlineOpen(booking, nowMs = Date.now()) {
  const startMs = parseMs(booking.start_time);
  if (startMs === null) return false;
  return nowMs <= startMs - APP_CONFIG.MEETING_LINK_DEADLINE_MS;
}

// src/lib/supabase.ts
var import_supabase_js = require("@supabase/supabase-js");

// src/lib/logSanitizer.ts
var REDACTED = "***redacted***";
var REDACTED_LEGACY = "redacted";
var REDACTED_HEADER = "***present***";
var REDACTED_HEADER_ABSENT = "***absent***";
var SENSITIVE_KEYS = /* @__PURE__ */ new Set([
  "pass",
  "pwd",
  "passwd",
  "password",
  "pin",
  "otp",
  "totp",
  "mfa_code",
  "mfacode",
  "currentpassword",
  "newpassword",
  "oldpassword",
  "confirmpassword",
  "passwordconfirmation",
  "access_token",
  "accesstoken",
  "refresh_token",
  "refreshtoken",
  "id_token",
  "idtoken",
  "token",
  "tokens",
  "jwt",
  "bearer",
  "authorization",
  "auth_token",
  "authtoken",
  "session",
  "session_id",
  "sessionid",
  "cookie",
  "set-cookie",
  "secret",
  "secret_key",
  "secretkey",
  "client_secret",
  "clientsecret",
  "private_key",
  "privatekey",
  "api_key",
  "apikey",
  "access_key",
  "accesskey",
  "secret_access_key",
  "x-api-key",
  "x-service-role-key",
  "supabase-apikey",
  "service_role_key",
  "service_role",
  "supabase_service_role_key",
  "sbp_secret",
  "webhook_secret",
  "signature",
  "signedurl",
  "signed_url",
  "uploadurl",
  "upload_url",
  "card",
  "cardnum",
  "card_num",
  "cardnumber",
  "card_number",
  "credit_card",
  "creditcard",
  "creditcardnumber",
  "pan",
  "cvc",
  "cvv",
  "cvv2",
  "ssn",
  "social_security_number",
  "routing_number",
  "routingnumber",
  "iban",
  "account_number",
  "accountnumber",
  "proof_base64",
  "proof_data",
  "document_base64",
  "credential",
  "credentials",
  "demo_auth_secret"
]);
var SENSITIVE_HEADER_NAMES = /* @__PURE__ */ new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-service-role-key",
  "apikey",
  "supabase-apikey",
  "x-csrf-token",
  "x-auth-token",
  "proxy-authorization"
]);
var SENSITIVE_PATH_PATTERNS = [
  /^\/auth\//,
  /^\/api\/auth\//,
  /^\/api\/auth\/demo-login/
];
var SENSITIVE_KEY_SUBSTRING = /(^|[_\-.])(pass(word|wd)?|pwd|secret|token|apikey|api_key|cvv|cvc|cvv2|ssn|otp|credential|pin|signature)s?($|[_\-.])/i;
var SENSITIVE_VALUE_PATTERNS = [
  /(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi,
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*/g,
  /\bsb_(?:publishable|secret)_[A-Za-z0-9_-]{10,}/g,
  /\bskdemo\.[A-Za-z0-9._-]{8,}/g,
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bAIza[0-9A-Za-z_\-]{20,}/g,
  /\bxox[abopsr]-[A-Za-z0-9-]{10,}/g,
  /\bpostgres(?:ql)?:\/\/[^\s"']+/gi,
  /((?:password|passwd|pwd|token|secret|api[_-]?key|authorization|bearer)\s*[=:]\s*)[^\s,;"'&]+/gi,
  /\b(?:\d[ -]?){13,19}\b/g
];
var MAX_DEPTH = 8;
var MAX_ARRAY_ITEMS = 50;
var MAX_STRING_LENGTH = 2e3;
function isSensitiveKey(key) {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.has(lower) || SENSITIVE_KEY_SUBSTRING.test(lower);
}
function scrubString(value, marker = REDACTED) {
  let out = value;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, (...args) => {
      const match = args[0];
      const prefix = typeof args[1] === "string" ? args[1] : void 0;
      if (match.includes(marker)) return match;
      return prefix !== void 0 ? `${prefix}${marker}` : marker;
    });
  }
  return out.length > MAX_STRING_LENGTH ? `${out.slice(0, MAX_STRING_LENGTH)}...[truncated]` : out;
}
function scrubValue(value, depth, seen, marker) {
  if (value === null || value === void 0) return value;
  if (typeof value === "string") return scrubString(value, marker);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return `[${typeof value}]`;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: scrubString(value.message, marker) };
  }
  if (value instanceof Map) {
    const out = {};
    for (const [k, v] of value.entries()) {
      const key = String(k);
      out[key] = isSensitiveKey(key) ? marker : scrubValue(v, depth + 1, seen, marker);
    }
    return out;
  }
  if (value instanceof Set) {
    return scrubValue(Array.from(value.values()), depth, seen, marker);
  }
  if (depth >= MAX_DEPTH) return "[depth-limit]";
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const out = value.slice(0, MAX_ARRAY_ITEMS).map((item) => scrubValue(item, depth + 1, seen, marker));
    if (value.length > MAX_ARRAY_ITEMS) out.push(`...[${value.length - MAX_ARRAY_ITEMS} more]`);
    return out;
  }
  if (typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = isSensitiveKey(key) ? marker : scrubValue(val, depth + 1, seen, marker);
    }
    return out;
  }
  return String(value);
}
function scrubForLog(value, marker = REDACTED) {
  return scrubValue(value, 0, /* @__PURE__ */ new WeakSet(), marker);
}
var logSanitizer = {
  scrubForLog,
  sanitizeHeaders(headers) {
    const result = {};
    for (const [key, value] of Object.entries(headers || {})) {
      const lower = key.toLowerCase();
      if (SENSITIVE_HEADER_NAMES.has(lower) || isSensitiveKey(lower)) {
        result[lower] = value ? REDACTED_HEADER : REDACTED_HEADER_ABSENT;
      } else {
        result[key] = scrubValue(value, 1, /* @__PURE__ */ new WeakSet(), REDACTED_LEGACY);
      }
    }
    return result;
  },
  sanitizeBody(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) return {};
    return scrubForLog(body, REDACTED_LEGACY);
  },
  isSensitivePath(pathname) {
    if (!pathname || typeof pathname !== "string") return false;
    const normalized = pathname.toLowerCase();
    return SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
  },
  safeErrorStack(stack) {
    if (!stack) return void 0;
    return scrubString(stack).replace(/\.js:\d+:\d+/g, ".js:xxx:xxx").replace(/\.ts:\d+:\d+/g, ".ts:xxx:xxx");
  },
  safeMessage(error) {
    if (error instanceof Error) return scrubString(error.message);
    if (typeof error === "string") return scrubString(error);
    return "An unexpected error occurred";
  }
};

// src/lib/supabase.ts
var import_meta = {};
var getEnvVar = (key) => {
  try {
    if (typeof import_meta !== "undefined" && import_meta?.env?.[key]) {
      return import_meta.env[key];
    }
  } catch {
  }
  try {
    if (typeof process !== "undefined" && process?.env?.[key]) {
      return process.env[key];
    }
  } catch {
  }
  return void 0;
};
var supabaseUrl = getEnvVar("VITE_SUPABASE_URL");
var supabaseAnonKey = getEnvVar("VITE_SUPABASE_ANON_KEY");
var isSupabaseConfigured = () => {
  if (!supabaseUrl || !supabaseAnonKey) return false;
  if (supabaseUrl.includes("your-project.supabase.co") || supabaseAnonKey.includes("your-anon-key")) {
    return false;
  }
  try {
    const url = new URL(supabaseUrl);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};
var safeUrl = isSupabaseConfigured() && supabaseUrl ? supabaseUrl : "https://placeholder.supabase.co";
var safeKey = isSupabaseConfigured() && supabaseAnonKey ? supabaseAnonKey : "placeholder-anon-key";
var supabase = (0, import_supabase_js.createClient)(safeUrl, safeKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

// src/lib/sessionState.ts
var SESSION_ACCESS_WINDOW_MS2 = APP_CONFIG.SESSION_ACCESS_WINDOW_MS;

// src/lib/bookingService.ts
var isDevMode = process.env.NODE_ENV !== "production";
var localBookingDb = null;
function getLocalBookingEngineContext() {
  if (!localBookingDb) {
    localBookingDb = {
      profiles: [
        {
          id: "usr-8801",
          email: "suggestkey1505@gmail.com",
          full_name: "Aman Kumar",
          timezone: "Asia/Kolkata",
          avatar_url: null,
          created_at: "2026-01-10T00:00:00Z",
          updated_at: "2026-01-10T00:00:00Z"
        },
        {
          id: "usr-seeker-demo",
          email: "seeker@suggestkey.com",
          full_name: "Aditi Rao",
          timezone: "Asia/Kolkata",
          avatar_url: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z"
        },
        {
          id: "usr-mentor-rahul",
          email: "mentor.rahul@suggestkey.com",
          full_name: "Rahul Sharma",
          timezone: "Asia/Kolkata",
          avatar_url: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z"
        },
        {
          id: "usr-8802",
          email: "mentor.rahul@suggestkey.com",
          full_name: "Rahul Sharma",
          timezone: "Asia/Kolkata",
          avatar_url: null,
          created_at: "2026-01-12T00:00:00Z",
          updated_at: "2026-01-12T00:00:00Z"
        },
        {
          id: "usr-mentor-ananya",
          email: "mentor.ananya@suggestkey.com",
          full_name: "Ananya Patel",
          timezone: "Asia/Kolkata",
          avatar_url: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z"
        },
        {
          id: "usr-mentor-vikram",
          email: "mentor.vikram@suggestkey.com",
          full_name: "Dr. Vikram Joshi",
          timezone: "Asia/Kolkata",
          avatar_url: null,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z"
        }
      ],
      userRoles: [
        { user_id: "usr-8801", role: "seeker" },
        { user_id: "usr-seeker-demo", role: "seeker" },
        { user_id: "usr-mentor-rahul", role: "mentor" },
        { user_id: "usr-8802", role: "mentor" },
        { user_id: "usr-mentor-ananya", role: "mentor" },
        { user_id: "usr-mentor-vikram", role: "mentor" }
      ],
      mentorProfiles: [
        {
          id: "usr-mentor-rahul",
          headline: "Relationship Counselor & Interpersonal Strategist",
          about: "Experienced counselor in emotional intelligence and conflict resolution.",
          experience_years: 6,
          languages: ["English", "Hindi"],
          rating: 4.95,
          review_count: 38,
          session_count: 142,
          is_approved: true,
          is_featured: true,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z"
        },
        {
          id: "usr-8802",
          headline: "Relationship Counselor & Interpersonal Strategist",
          about: "Experienced counselor in emotional intelligence and conflict resolution.",
          experience_years: 6,
          languages: ["English", "Hindi"],
          rating: 4.95,
          review_count: 38,
          session_count: 142,
          is_approved: true,
          is_featured: true,
          created_at: "2026-01-12T00:00:00Z",
          updated_at: "2026-01-12T00:00:00Z"
        },
        {
          id: "usr-mentor-ananya",
          headline: "Certified Family Systems & Dialogue Practitioner",
          about: "Specialist in partner dialogue and pre-marital relational health.",
          experience_years: 8,
          languages: ["English", "Hindi", "Gujarati"],
          rating: 4.98,
          review_count: 52,
          session_count: 210,
          is_approved: true,
          is_featured: false,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z"
        },
        {
          id: "usr-mentor-vikram",
          headline: "Neurodiversity Specialist & Autism Guidance Mentor",
          about: "Guiding autistic individuals, parents, and caregivers.",
          experience_years: 10,
          languages: ["English", "Hindi", "Marathi"],
          rating: 5,
          review_count: 64,
          session_count: 320,
          is_approved: true,
          is_featured: true,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z"
        }
      ],
      segments: [
        {
          id: "seg-rel-01",
          name: "Relationship Advisor",
          slug: "relationship-advisor",
          description: "Expert guidance on interpersonal relationships.",
          priority: 1,
          is_active: true,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z"
        },
        {
          id: "seg-aut-02",
          name: "Autism Mentor",
          slug: "autism-mentor",
          description: "Specialized neurodivergent support.",
          priority: 2,
          is_active: true,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z"
        },
        {
          id: "seg-car-03",
          name: "Career Mentor",
          slug: "career-mentor",
          description: "Career development and leadership communication.",
          priority: 3,
          is_active: true,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z"
        }
      ],
      mentorSegments: [
        { mentor_id: "usr-mentor-rahul", segment_id: "seg-rel-01" },
        { mentor_id: "usr-mentor-rahul", segment_id: "seg-car-03" },
        { mentor_id: "usr-8802", segment_id: "seg-rel-01" },
        { mentor_id: "usr-8802", segment_id: "seg-car-03" },
        { mentor_id: "usr-mentor-ananya", segment_id: "seg-rel-01" },
        { mentor_id: "usr-mentor-vikram", segment_id: "seg-aut-02" }
      ],
      gigs: [
        {
          id: "gig-rel-rahul",
          mentor_id: "usr-mentor-rahul",
          segment_id: "seg-rel-01",
          title: "1:1 Relationship Guidance Session",
          description: "In-depth consultation on interpersonal boundaries and dialogue.",
          duration_minutes: 60,
          price_inr: 999,
          is_active: true,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z"
        },
        {
          id: "gig-car-rahul",
          mentor_id: "usr-mentor-rahul",
          segment_id: "seg-car-03",
          title: "Career Communication Coaching",
          description: "Master interpersonal influence and professional boundary management.",
          duration_minutes: 45,
          price_inr: 1299,
          is_active: true,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z"
        },
        {
          id: "gig-rel-ananya",
          mentor_id: "usr-mentor-ananya",
          segment_id: "seg-rel-01",
          title: "Deep Communication Reset & Dialogue Coaching",
          description: "Dialogue session to unpack relationship dynamics.",
          duration_minutes: 45,
          price_inr: 1200,
          is_active: true,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z"
        },
        {
          id: "gig-aut-vikram",
          mentor_id: "usr-mentor-vikram",
          segment_id: "seg-aut-02",
          title: "Autism Navigational & Sensory Mentorship",
          description: "Structured 1:1 strategy session covering sensory regulation.",
          duration_minutes: 60,
          price_inr: 1500,
          is_active: true,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z"
        }
      ],
      mentorAvailability: [
        // Rahul: Mon-Sat 10:00 - 18:00
        ...[1, 2, 3, 4, 5, 6].map((dow) => ({
          id: `avail-rahul-${dow}`,
          mentor_id: "usr-mentor-rahul",
          day_of_week: dow,
          start_time: "10:00:00",
          end_time: "18:00:00",
          timezone: "Asia/Kolkata",
          is_enabled: true,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z"
        })),
        // Ananya: Mon-Sat 11:00 - 19:00
        ...[1, 2, 3, 4, 5, 6].map((dow) => ({
          id: `avail-ananya-${dow}`,
          mentor_id: "usr-mentor-ananya",
          day_of_week: dow,
          start_time: "11:00:00",
          end_time: "19:00:00",
          timezone: "Asia/Kolkata",
          is_enabled: true,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z"
        })),
        // Dr Vikram: Mon-Fri 09:00 - 17:00
        ...[1, 2, 3, 4, 5].map((dow) => ({
          id: `avail-vikram-${dow}`,
          mentor_id: "usr-mentor-vikram",
          day_of_week: dow,
          start_time: "09:00:00",
          end_time: "17:00:00",
          timezone: "Asia/Kolkata",
          is_enabled: true,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z"
        }))
      ],
      mentorAvailabilityExceptions: [],
      bookings: [
        {
          id: "bk-9021",
          booking_code: "BK-9021",
          mentor_id: "usr-8802",
          seeker_id: "usr-8801",
          gig_id: "gig-rel-rahul",
          segment_id: "seg-rel-01",
          hold_id: "hold-9021",
          start_time: new Date(Date.now() + 4 * 60 * 60 * 1e3).toISOString(),
          end_time: new Date(Date.now() + 5 * 60 * 60 * 1e3).toISOString(),
          seeker_timezone: "Asia/Kolkata",
          mentor_timezone: "Asia/Kolkata",
          amount_inr: 999,
          status: "MENTOR_PENDING",
          meeting_url: null,
          actual_ended_at: null,
          ended_by_role: null,
          end_reason: null,
          cancellation_reason: null,
          created_at: new Date(Date.now() - 2 * 60 * 60 * 1e3).toISOString(),
          updated_at: new Date(Date.now() - 30 * 60 * 1e3).toISOString()
        },
        {
          id: "bk-9022",
          booking_code: "BK-9022",
          mentor_id: "usr-8802",
          seeker_id: "usr-seeker-demo",
          gig_id: "gig-car-rahul",
          segment_id: "seg-car-03",
          hold_id: "hold-9022",
          start_time: new Date(Date.now() + 3 * 60 * 1e3).toISOString(),
          // 3 mins: Overdue (<5m)!
          end_time: new Date(Date.now() + 120 * 60 * 1e3).toISOString(),
          seeker_timezone: "Asia/Kolkata",
          mentor_timezone: "Asia/Kolkata",
          amount_inr: 1299,
          status: "MENTOR_PENDING",
          meeting_url: null,
          actual_ended_at: null,
          ended_by_role: null,
          end_reason: null,
          cancellation_reason: null,
          created_at: new Date(Date.now() - 3 * 60 * 60 * 1e3).toISOString(),
          updated_at: new Date(Date.now() - 45 * 60 * 1e3).toISOString()
        },
        {
          id: "bk-9020",
          booking_code: "BK-9020",
          mentor_id: "usr-8802",
          seeker_id: "usr-8801",
          gig_id: "gig-rel-rahul",
          segment_id: "seg-rel-01",
          hold_id: "hold-9020",
          start_time: new Date(Date.now() + 24 * 60 * 60 * 1e3).toISOString(),
          end_time: new Date(Date.now() + 25 * 60 * 60 * 1e3).toISOString(),
          seeker_timezone: "Asia/Kolkata",
          mentor_timezone: "Asia/Kolkata",
          amount_inr: 999,
          status: "CONFIRMED",
          meeting_url: "https://meet.google.com/hrc-qjtv-zsk",
          actual_ended_at: null,
          ended_by_role: null,
          end_reason: null,
          cancellation_reason: null,
          created_at: new Date(Date.now() - 24 * 60 * 60 * 1e3).toISOString(),
          updated_at: new Date(Date.now() - 20 * 60 * 60 * 1e3).toISOString()
        },
        // Phase 9 Test Booking 1: In T-5 early arrival window (starts in 3 minutes)
        {
          id: "bk-session-soon",
          booking_code: "BK-SOON-01",
          mentor_id: "usr-8802",
          seeker_id: "usr-8801",
          gig_id: "gig-rel-rahul",
          segment_id: "seg-rel-01",
          hold_id: null,
          start_time: new Date(Date.now() + 3 * 60 * 1e3).toISOString(),
          // 3 mins from now
          end_time: new Date(Date.now() + 63 * 60 * 1e3).toISOString(),
          seeker_timezone: "Asia/Kolkata",
          mentor_timezone: "Asia/Kolkata",
          amount_inr: 999,
          status: "CONFIRMED",
          meeting_url: "https://meet.google.com/early-access-room",
          actual_ended_at: null,
          ended_by_role: null,
          end_reason: null,
          cancellation_reason: null,
          created_at: new Date(Date.now() - 60 * 60 * 1e3).toISOString(),
          updated_at: new Date(Date.now() - 30 * 60 * 1e3).toISOString()
        },
        // Phase 9 Test Booking 2: Active in-progress session (started 12 minutes ago)
        {
          id: "bk-session-live",
          booking_code: "BK-LIVE-02",
          mentor_id: "usr-8802",
          seeker_id: "usr-8801",
          gig_id: "gig-rel-rahul",
          segment_id: "seg-rel-01",
          hold_id: null,
          start_time: new Date(Date.now() - 12 * 60 * 1e3).toISOString(),
          // 12 mins in
          end_time: new Date(Date.now() + 48 * 60 * 1e3).toISOString(),
          seeker_timezone: "Asia/Kolkata",
          mentor_timezone: "Asia/Kolkata",
          amount_inr: 999,
          status: "CONFIRMED",
          meeting_url: "https://meet.google.com/live-session-room",
          actual_ended_at: null,
          ended_by_role: null,
          end_reason: null,
          cancellation_reason: null,
          created_at: new Date(Date.now() - 120 * 60 * 1e3).toISOString(),
          updated_at: new Date(Date.now() - 60 * 60 * 1e3).toISOString()
        },
        // Phase 9 Test Booking 3: Completed / ended session (ended 20 minutes ago)
        {
          id: "bk-session-ended",
          booking_code: "BK-ENDED-03",
          mentor_id: "usr-8802",
          seeker_id: "usr-8801",
          gig_id: "gig-rel-rahul",
          segment_id: "seg-rel-01",
          hold_id: null,
          start_time: new Date(Date.now() - 80 * 60 * 1e3).toISOString(),
          end_time: new Date(Date.now() - 20 * 60 * 1e3).toISOString(),
          // Ended 20 mins ago
          seeker_timezone: "Asia/Kolkata",
          mentor_timezone: "Asia/Kolkata",
          amount_inr: 999,
          status: "COMPLETED",
          meeting_url: "https://meet.google.com/past-session-room",
          actual_ended_at: new Date(Date.now() - 20 * 60 * 1e3).toISOString(),
          ended_by_role: null,
          end_reason: null,
          cancellation_reason: null,
          created_at: new Date(Date.now() - 180 * 60 * 1e3).toISOString(),
          updated_at: new Date(Date.now() - 20 * 60 * 1e3).toISOString()
        },
        // Phase 22 Test Booking: Mentor ended session early (actual_ended_at before end_time)
        {
          id: "bk-session-ended-early",
          booking_code: "BK-ENDED-04",
          mentor_id: "usr-8802",
          seeker_id: "usr-8801",
          gig_id: "gig-rel-rahul",
          segment_id: "seg-rel-01",
          hold_id: null,
          start_time: new Date(Date.now() - 30 * 60 * 1e3).toISOString(),
          // Started 30 mins ago
          end_time: new Date(Date.now() + 30 * 60 * 1e3).toISOString(),
          // Scheduled to end in 30 mins
          seeker_timezone: "Asia/Kolkata",
          mentor_timezone: "Asia/Kolkata",
          amount_inr: 999,
          status: "COMPLETED",
          meeting_url: "https://meet.google.com/early-ended-room",
          actual_ended_at: new Date(Date.now() - 10 * 60 * 1e3).toISOString(),
          // Ended 10 mins ago, 20 mins before scheduled end
          ended_by_role: "mentor",
          end_reason: null,
          cancellation_reason: null,
          created_at: new Date(Date.now() - 120 * 60 * 1e3).toISOString(),
          updated_at: new Date(Date.now() - 10 * 60 * 1e3).toISOString()
        }
      ],
      slotHolds: [],
      payments: [
        {
          id: "pay-9021",
          booking_id: "bk-9021",
          seeker_id: "usr-8801",
          amount_inr: 999,
          status: "VERIFIED",
          proof_storage_path: "receipts/upi_9021.png",
          transaction_reference: "UPI-REF-90214481",
          verified_by: "usr-8800",
          verified_at: new Date(Date.now() - 30 * 60 * 1e3).toISOString(),
          rejection_reason: null,
          gateway: "manual",
          razorpay_order_id: null,
          razorpay_payment_id: null,
          razorpay_signature: null,
          captured_at: null,
          refund_id: null,
          refund_status: null,
          refund_amount_paise: null,
          refunded_at: null,
          refund_reason: null,
          failure_reason: null,
          gateway_payload: null,
          manual_refund_required: false,
          created_at: new Date(Date.now() - 60 * 60 * 1e3).toISOString(),
          updated_at: new Date(Date.now() - 30 * 60 * 1e3).toISOString()
        },
        {
          id: "pay-9022",
          booking_id: "bk-9022",
          seeker_id: "usr-seeker-demo",
          amount_inr: 1299,
          status: "VERIFIED",
          proof_storage_path: "receipts/gpay_9022.png",
          transaction_reference: "GPAY-TXN-9022981",
          verified_by: "usr-8800",
          verified_at: new Date(Date.now() - 45 * 60 * 1e3).toISOString(),
          rejection_reason: null,
          gateway: "manual",
          razorpay_order_id: null,
          razorpay_payment_id: null,
          razorpay_signature: null,
          captured_at: null,
          refund_id: null,
          refund_status: null,
          refund_amount_paise: null,
          refunded_at: null,
          refund_reason: null,
          failure_reason: null,
          gateway_payload: null,
          manual_refund_required: false,
          created_at: new Date(Date.now() - 90 * 60 * 1e3).toISOString(),
          updated_at: new Date(Date.now() - 45 * 60 * 1e3).toISOString()
        },
        {
          id: "pay-9020",
          booking_id: "bk-9020",
          seeker_id: "usr-8801",
          amount_inr: 999,
          status: "VERIFIED",
          proof_storage_path: "receipts/upi_9020.png",
          transaction_reference: "UPI-REF-9020112",
          verified_by: "usr-8800",
          verified_at: new Date(Date.now() - 20 * 60 * 60 * 1e3).toISOString(),
          rejection_reason: null,
          gateway: "manual",
          razorpay_order_id: null,
          razorpay_payment_id: null,
          razorpay_signature: null,
          captured_at: null,
          refund_id: null,
          refund_status: null,
          refund_amount_paise: null,
          refunded_at: null,
          refund_reason: null,
          failure_reason: null,
          gateway_payload: null,
          manual_refund_required: false,
          created_at: new Date(Date.now() - 24 * 60 * 60 * 1e3).toISOString(),
          updated_at: new Date(Date.now() - 20 * 60 * 60 * 1e3).toISOString()
        }
      ],
      notifications: [
        // --- SEEKER SEEDS (usr-8801) ---
        {
          id: "notif-seeker-1",
          user_id: "usr-8801",
          title: "Booking Created",
          message: "Consultation slot reserved for BK-9021 with Rahul Sharma. Please upload UPI payment proof.",
          type: "BOOKING",
          event_type: "BOOKING_CREATED",
          entity_type: "booking",
          entity_id: "bk-9021",
          link: "/seeker/bookings?bookingId=bk-9021",
          is_read: true,
          created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1e3).toISOString()
        },
        {
          id: "notif-seeker-2",
          user_id: "usr-8801",
          title: "Payment Submitted",
          message: "Your payment screenshot for BK-9021 (\xC3\xA2\xE2\u20AC\u0161\xC2\xB9999) has been submitted for admin verification.",
          type: "PAYMENT",
          event_type: "PAYMENT_SUBMITTED",
          entity_type: "payment",
          entity_id: "bk-9021",
          link: "/seeker/bookings?bookingId=bk-9021",
          is_read: true,
          created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1e3).toISOString()
        },
        {
          id: "notif-seeker-3",
          user_id: "usr-8801",
          title: "Payment Approved",
          message: "Your payment for BK-9020 has been verified by the admin team. Awaiting mentor confirmation.",
          type: "PAYMENT",
          event_type: "PAYMENT_APPROVED",
          entity_type: "payment",
          entity_id: "bk-9020",
          link: "/seeker/bookings?bookingId=bk-9020",
          is_read: true,
          created_at: new Date(Date.now() - 28 * 60 * 60 * 1e3).toISOString()
        },
        {
          id: "notif-seeker-4",
          user_id: "usr-8801",
          title: "Payment Verification Rejected",
          message: "Payment proof for BK-9017 was rejected: UTR does not match banking ledger. Please re-upload.",
          type: "PAYMENT",
          event_type: "PAYMENT_REJECTED",
          entity_type: "payment",
          entity_id: "bk-9017",
          link: "/seeker/bookings?bookingId=bk-9017",
          is_read: true,
          created_at: new Date(Date.now() - 26 * 60 * 60 * 1e3).toISOString()
        },
        {
          id: "notif-seeker-5",
          user_id: "usr-8801",
          title: "Mentor Confirmed Session",
          message: "Rahul Sharma has confirmed your consultation BK-9020.",
          type: "BOOKING",
          event_type: "MENTOR_CONFIRMED",
          entity_type: "booking",
          entity_id: "bk-9020",
          link: "/seeker/bookings?bookingId=bk-9020",
          is_read: false,
          created_at: new Date(Date.now() - 5 * 60 * 60 * 1e3).toISOString()
        },
        {
          id: "notif-seeker-6",
          user_id: "usr-8801",
          title: "Meeting Link Available",
          message: "Your Google Meet link for BK-SESSION-SOON is ready. You may enter the session room.",
          type: "SESSION",
          event_type: "MEETING_LINK_AVAILABLE",
          entity_type: "session",
          entity_id: "bk-session-soon",
          link: "/seeker/session?bookingId=bk-session-soon",
          is_read: false,
          created_at: new Date(Date.now() - 45 * 60 * 1e3).toISOString()
        },
        {
          id: "notif-seeker-7",
          user_id: "usr-8801",
          title: "Session Reminder: 15m to Start",
          message: "Your 1:1 consultation with Rahul Sharma begins in 15 minutes. Join access unlocks at T-5m.",
          type: "SESSION",
          event_type: "SESSION_REMINDER",
          entity_type: "session",
          entity_id: "bk-session-soon",
          link: "/seeker/session?bookingId=bk-session-soon",
          is_read: false,
          created_at: new Date(Date.now() - 15 * 60 * 1e3).toISOString()
        },
        {
          id: "notif-seeker-8",
          user_id: "usr-8801",
          title: "Consultation Cancelled",
          message: "Booking BK-9019 was cancelled upon request. A credit record has been logged.",
          type: "BOOKING",
          event_type: "CANCELLATION",
          entity_type: "booking",
          entity_id: "bk-9019",
          link: "/seeker/bookings?bookingId=bk-9019",
          is_read: true,
          created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1e3).toISOString()
        },
        {
          id: "notif-seeker-9",
          user_id: "usr-8801",
          title: "Session Rescheduled",
          message: "Booking BK-9018 was updated to match your newly requested time slot.",
          type: "BOOKING",
          event_type: "RESCHEDULING",
          entity_type: "booking",
          entity_id: "bk-9018",
          link: "/seeker/bookings?bookingId=bk-9018",
          is_read: true,
          created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1e3).toISOString()
        },
        {
          id: "notif-seeker-10",
          user_id: "usr-8801",
          title: "Session Completed",
          message: "Your consultation BK-SESSION-ENDED is complete. The mentor is preparing post-session takeaways.",
          type: "SESSION",
          event_type: "SESSION_COMPLETED",
          entity_type: "session",
          entity_id: "bk-session-ended",
          link: "/seeker/workspace?bookingId=bk-session-ended",
          is_read: false,
          created_at: new Date(Date.now() - 2 * 60 * 60 * 1e3).toISOString()
        },
        {
          id: "notif-seeker-12",
          user_id: "usr-8801",
          title: "Session Ended Early",
          message: "Your mentor has ended session BK-ENDED-04 early. The meeting link has been deactivated.",
          type: "SESSION",
          event_type: "SESSION_COMPLETED",
          entity_type: "booking",
          entity_id: "bk-session-ended-early",
          link: "/seeker/bookings?bookingId=bk-session-ended-early",
          is_read: false,
          created_at: new Date(Date.now() - 10 * 60 * 1e3).toISOString()
        },
        {
          id: "notif-seeker-11",
          user_id: "usr-8801",
          title: "Workspace Notes Published",
          message: "Rahul Sharma published takeaways, suggestions, and next steps for BK-SESSION-ENDED.",
          type: "WORKSPACE",
          event_type: "WORKSPACE_UPDATED",
          entity_type: "workspace",
          entity_id: "bk-session-ended",
          link: "/seeker/workspace?bookingId=bk-session-ended",
          is_read: false,
          created_at: new Date(Date.now() - 60 * 60 * 1e3).toISOString()
        },
        // --- MENTOR SEEDS (usr-8802) ---
        {
          id: "notif-mentor-1",
          user_id: "usr-8802",
          title: "Seeker Payment Verified",
          message: "Payment verified for session BK-9021. Please add your HTTPS meeting link.",
          type: "PAYMENT",
          event_type: "PAYMENT_APPROVED",
          entity_type: "booking",
          entity_id: "bk-9021",
          link: "/mentor/booking-detail?bookingId=bk-9021",
          is_read: false,
          created_at: new Date(Date.now() - 3 * 60 * 60 * 1e3).toISOString()
        },
        {
          id: "notif-mentor-2",
          user_id: "usr-8802",
          title: "New Booking Request",
          message: "Aman Kumar booked a 60-minute Relationship Guidance session (BK-9025).",
          type: "BOOKING",
          event_type: "NEW_BOOKING",
          entity_type: "booking",
          entity_id: "bk-9025",
          link: "/mentor/bookings",
          is_read: true,
          created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1e3).toISOString()
        },
        {
          id: "notif-mentor-3",
          user_id: "usr-8802",
          title: "Action Required: Add Meeting Link",
          message: "Session BK-9021 starts today. Policy mandates providing meeting URL at least 5 minutes before start.",
          type: "SESSION",
          event_type: "MEETING_LINK_DEADLINE",
          entity_type: "booking",
          entity_id: "bk-9021",
          link: "/mentor/booking-detail?bookingId=bk-9021",
          is_read: false,
          created_at: new Date(Date.now() - 2 * 60 * 60 * 1e3).toISOString()
        },
        {
          id: "notif-mentor-4",
          user_id: "usr-8802",
          title: "Urgent: Meeting Link Overdue (<5m)",
          message: "Session BK-9022 starts in 3 minutes. Please provide meeting link immediately.",
          type: "SESSION",
          event_type: "OVERDUE_MEETING_LINK",
          entity_type: "booking",
          entity_id: "bk-9022",
          link: "/mentor/booking-detail?bookingId=bk-9022",
          is_read: false,
          created_at: new Date(Date.now() - 30 * 60 * 1e3).toISOString()
        },
        {
          id: "notif-mentor-5",
          user_id: "usr-8802",
          title: "Upcoming Consultation Reminder",
          message: "Session BK-SESSION-SOON starts in 15 minutes. Authoritative session join unlocks at T-5m.",
          type: "SESSION",
          event_type: "MENTOR_SESSION_REMINDER",
          entity_type: "session",
          entity_id: "bk-session-soon",
          link: "/mentor/booking-detail?bookingId=bk-session-soon",
          is_read: false,
          created_at: new Date(Date.now() - 15 * 60 * 1e3).toISOString()
        },
        {
          id: "notif-mentor-6",
          user_id: "usr-8802",
          title: "Consultation Cancelled",
          message: "Seeker cancelled booking BK-9019. Calendar slot has been reopened for bookings.",
          type: "BOOKING",
          event_type: "MENTOR_CANCELLATION",
          entity_type: "booking",
          entity_id: "bk-9019",
          link: "/mentor/bookings",
          is_read: true,
          created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1e3).toISOString()
        },
        {
          id: "notif-mentor-7",
          user_id: "usr-8802",
          title: "Consultation Rescheduled",
          message: "Booking BK-9018 was rescheduled according to updated calendar availability.",
          type: "BOOKING",
          event_type: "MENTOR_RESCHEDULING",
          entity_type: "booking",
          entity_id: "bk-9018",
          link: "/mentor/bookings",
          is_read: true,
          created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1e3).toISOString()
        },
        {
          id: "notif-mentor-8",
          user_id: "usr-8802",
          title: "Session Concluded: Workspace Draft Ready",
          message: "Consultation BK-SESSION-ENDED completed. Please draft takeaways, suggestions, and next steps.",
          type: "WORKSPACE",
          event_type: "SESSION_COMPLETION",
          entity_type: "workspace",
          entity_id: "bk-session-ended",
          link: "/mentor/workspace?bookingId=bk-session-ended",
          is_read: false,
          created_at: new Date(Date.now() - 90 * 60 * 1e3).toISOString()
        },
        // --- ADMIN SEEDS (usr-8800) ---
        {
          id: "notif-admin-1",
          user_id: "usr-8800",
          title: "Payment Verification Required",
          message: "New manual UPI receipt uploaded for BK-9021 (\xC3\xA2\xE2\u20AC\u0161\xC2\xB9999) by Aman Kumar. Awaiting ledger verification.",
          type: "PAYMENT",
          event_type: "ADMIN_PAYMENT_PROOF_SUBMITTED",
          entity_type: "payment",
          entity_id: "bk-9021",
          link: "/admin/payments",
          is_read: false,
          created_at: new Date(Date.now() - 3 * 60 * 60 * 1e3).toISOString()
        },
        {
          id: "notif-admin-2",
          user_id: "usr-8800",
          title: "SLA Breach: Overdue Mentor Link",
          message: "Mentor Rahul Sharma has not provided meeting URL for BK-9022 starting in 3 minutes.",
          type: "SESSION",
          event_type: "ADMIN_OVERDUE_MENTOR_LINK",
          entity_type: "booking",
          entity_id: "bk-9022",
          link: "/admin/bookings",
          is_read: false,
          created_at: new Date(Date.now() - 30 * 60 * 1e3).toISOString()
        },
        {
          id: "notif-admin-3",
          user_id: "usr-8800",
          title: "Mentor Cancellation Logged",
          message: "Mentor Dr. Vikram Joshi submitted an emergency cancellation for consultation BK-9016.",
          type: "BOOKING",
          event_type: "ADMIN_MENTOR_CANCELLATION",
          entity_type: "booking",
          entity_id: "bk-9016",
          link: "/admin/bookings",
          is_read: true,
          created_at: new Date(Date.now() - 24 * 60 * 60 * 1e3).toISOString()
        },
        {
          id: "notif-admin-4",
          user_id: "usr-8800",
          title: "Booking Intervention Required",
          message: "High Priority: Session BK-9022 is at T-45m with missing meeting link. Administrative outreach advised.",
          type: "BOOKING",
          event_type: "ADMIN_BOOKING_INTERVENTION",
          entity_type: "booking",
          entity_id: "bk-9022",
          link: "/admin/bookings",
          is_read: false,
          created_at: new Date(Date.now() - 10 * 60 * 1e3).toISOString()
        }
      ]
    };
  }
  return localBookingDb;
}
function enrichBooking(booking, db) {
  const seeker = db.profiles.find((p) => p.id === booking.seeker_id);
  const gig = db.gigs.find((g) => g.id === booking.gig_id);
  const segment = db.segments.find((s) => s.id === booking.segment_id);
  const payment = db.payments?.find((pay) => pay.booking_id === booking.id);
  const deadlineInfo = calculateMeetingLinkDeadline(booking.start_time);
  const bookedMinutes = Math.round(
    (new Date(booking.end_time).getTime() - new Date(booking.start_time).getTime()) / 6e4
  );
  return {
    ...booking,
    gig: gig || booking.gig,
    segment: segment || booking.segment,
    seeker: seeker || booking.seeker,
    payment,
    duration_minutes: Number.isFinite(bookedMinutes) && bookedMinutes > 0 ? bookedMinutes : null,
    deadlineInfo,
    // Same shape the server stamps, so the mentor ledger groups identically in
    // the offline dev preview and in production.
    lifecycle: resolveBookingLifecycle(booking)
  };
}

// src/lib/workspaceService.ts
var isDevMode2 = process.env.NODE_ENV !== "production";
function deriveSessionOverview(booking) {
  const startMs = new Date(booking.start_time).getTime();
  const endMs = new Date(booking.end_time).getTime();
  const durationMinutes = Math.max(15, Math.round((endMs - startMs) / (60 * 1e3)));
  const mentorName = booking.mentor?.full_name || "\u2014";
  const mentorHeadline = booking.gig?.title || "\u2014";
  const seekerName = booking.seeker?.full_name || "\u2014";
  const segmentTitle = booking.segment?.name || "\u2014";
  const gigTitle = booking.gig?.title || "\u2014";
  if (!booking.mentor && !isSupabaseConfigured() && isDevMode2) {
    const db = getLocalBookingEngineContext();
    const mentorProfile = db.profiles.find((p) => p.id === booking.mentor_id);
    const mentorInfo = db.mentorProfiles.find((mp) => mp.id === booking.mentor_id);
    const seekerProfile = db.profiles.find((p) => p.id === booking.seeker_id);
    const segment = db.segments.find((s) => s.id === booking.segment_id);
    const gig = db.gigs.find((g) => g.id === booking.gig_id);
    return {
      bookingId: booking.id,
      bookingCode: booking.booking_code,
      startTime: booking.start_time,
      endTime: booking.end_time,
      durationMinutes,
      mentorId: booking.mentor_id,
      mentorName: mentorProfile?.full_name || "\u2014",
      mentorHeadline: mentorInfo?.headline || "\u2014",
      seekerId: booking.seeker_id,
      seekerName: seekerProfile?.full_name || "\u2014",
      segmentTitle: segment?.name || "\u2014",
      gigTitle: gig?.title || "\u2014",
      bookingStatus: booking.status
    };
  }
  return {
    bookingId: booking.id,
    bookingCode: booking.booking_code,
    startTime: booking.start_time,
    endTime: booking.end_time,
    durationMinutes,
    mentorId: booking.mentor_id,
    mentorName,
    mentorHeadline,
    seekerId: booking.seeker_id,
    seekerName,
    segmentTitle,
    gigTitle,
    bookingStatus: booking.status
  };
}

// src/lib/workspaceStore.server.ts
var WORKSPACE_WRITE_COLUMNS = [
  "id",
  "booking_id",
  "mentor_id",
  "seeker_id",
  "status",
  "mentor_notes",
  "summary",
  "takeaways",
  "suggestions",
  "next_steps",
  "action_items",
  "follow_up_recommendation",
  "resources",
  "published_at",
  "created_at",
  "updated_at"
];
function authorizeWorkspaceWrite(params) {
  const { booking, callerId, roles } = params;
  if (!booking) return { allowed: false, reason: "BOOKING_NOT_FOUND" };
  if (roles.includes("admin")) return { allowed: true };
  if (roles.includes("mentor") && booking.mentor_id === callerId) return { allowed: true };
  return { allowed: false, reason: "FORBIDDEN" };
}
function authorizeExistingWorkspace(params) {
  if (params.existing.mentor_id !== params.booking.mentor_id || params.existing.seeker_id !== params.booking.seeker_id) {
    return { allowed: false, reason: "PARTICIPANT_MISMATCH" };
  }
  return authorizeWorkspaceWrite(params);
}
function isWorkspaceVisibleToSeeker(workspace, roles) {
  if (roles.includes("admin") || roles.includes("mentor")) return true;
  return workspace.status === "PUBLISHED";
}
function toActionItems(steps) {
  return steps.map((step, index) => ({
    id: step.id || `act-${index + 1}`,
    text: step.text,
    completed: !!step.completed
  }));
}
function planWorkspaceWrite(params) {
  const { booking, input, existing, nowIso, newId } = params;
  const status = input.publish ? "PUBLISHED" : "PENDING";
  const notes = input.mentorNotes || "";
  const publishedAt = input.publish ? existing?.published_at ?? nowIso : null;
  const content = {
    status,
    mentor_notes: notes,
    summary: notes,
    takeaways: input.takeaways,
    suggestions: input.suggestions,
    next_steps: input.nextSteps,
    action_items: toActionItems(input.nextSteps),
    follow_up_recommendation: input.followUpRecommendation ?? null,
    published_at: publishedAt,
    updated_at: nowIso
  };
  if (existing) {
    return {
      mode: "update",
      id: existing.id,
      patch: {
        ...content,
        // Mentor-authored resources are not part of this payload, so an edit
        // must not clear them.
        resources: existing.resources
      }
    };
  }
  return {
    mode: "insert",
    record: {
      id: newId,
      booking_id: booking.id,
      mentor_id: booking.mentor_id,
      seeker_id: booking.seeker_id,
      resources: [],
      created_at: nowIso,
      ...content
    }
  };
}
async function saveWorkspace(params) {
  const { store, booking, input, callerId, roles, nowIso, newId } = params;
  const auth = authorizeWorkspaceWrite({ booking, callerId, roles });
  if (!auth.allowed) return { ok: false, reason: auth.reason };
  const resolvedBooking = booking;
  const existing = await store.findByBookingId(resolvedBooking.id);
  if (existing) {
    const existingAuth = authorizeExistingWorkspace({
      existing,
      booking: resolvedBooking,
      callerId,
      roles
    });
    if (!existingAuth.allowed) return { ok: false, reason: existingAuth.reason };
  }
  const plan = planWorkspaceWrite({ booking: resolvedBooking, input, existing, nowIso, newId });
  let workspace;
  if (plan.mode === "insert") {
    workspace = await store.insertWorkspace(plan.record);
  } else {
    const updated = await store.updateWorkspace(plan.id, plan.patch);
    if (!updated) {
      throw new Error("Session workspace disappeared during update");
    }
    workspace = updated;
  }
  if (input.publish) {
    await store.notifySeekerPublished({
      userId: resolvedBooking.seeker_id,
      bookingCode: resolvedBooking.booking_code,
      bookingId: resolvedBooking.id
    });
  }
  return {
    ok: true,
    workspace,
    created: plan.mode === "insert",
    published: input.publish
  };
}
var WORKSPACE_COLUMNS = WORKSPACE_WRITE_COLUMNS.join(", ");
var readWorkspace = (row) => {
  if (!row || typeof row.id !== "string") return null;
  return {
    id: row.id,
    booking_id: String(row.booking_id ?? ""),
    mentor_id: String(row.mentor_id ?? ""),
    seeker_id: String(row.seeker_id ?? ""),
    status: row.status,
    mentor_notes: String(row.mentor_notes ?? row.summary ?? ""),
    summary: String(row.summary ?? ""),
    takeaways: Array.isArray(row.takeaways) ? row.takeaways : [],
    suggestions: Array.isArray(row.suggestions) ? row.suggestions : [],
    next_steps: Array.isArray(row.next_steps) ? row.next_steps : [],
    action_items: Array.isArray(row.action_items) ? row.action_items : [],
    follow_up_recommendation: row.follow_up_recommendation ?? null,
    resources: Array.isArray(row.resources) ? row.resources : [],
    published_at: row.published_at ?? null,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? "")
  };
};
function createSupabaseWorkspaceStore(client) {
  return {
    async findByBookingId(bookingId) {
      const { data, error } = await client.from("session_workspaces").select(WORKSPACE_COLUMNS).eq("booking_id", bookingId).maybeSingle();
      if (error) throw error;
      return readWorkspace(data);
    },
    async insertWorkspace(record) {
      const { data, error } = await client.from("session_workspaces").insert(record).select(WORKSPACE_COLUMNS).single();
      if (error) throw error;
      const row = readWorkspace(data);
      if (!row) throw new Error("Workspace insert returned no row");
      return row;
    },
    async updateWorkspace(id, patch) {
      const { data, error } = await client.from("session_workspaces").update(patch).eq("id", id).select(WORKSPACE_COLUMNS).maybeSingle();
      if (error) throw error;
      return readWorkspace(data);
    },
    async notifySeekerPublished({ userId, bookingCode, bookingId }) {
      const { error } = await client.from("notifications").insert({
        user_id: userId,
        title: "Session Workspace Published",
        message: `Your mentor has published takeaways and recommendations for session ${bookingCode}.`,
        type: "WORKSPACE",
        link: `/seeker/workspace?bookingId=${bookingId}`,
        is_read: false
      });
      if (error) console.warn("Failed to create workspace notification:", error.message);
    }
  };
}

// src/lib/supabaseServer.ts
var import_supabase_js3 = require("@supabase/supabase-js");
var import_crypto2 = require("crypto");

// src/lib/logger.ts
var import_supabase_js2 = require("@supabase/supabase-js");
var import_crypto = require("crypto");
var REQUEST_ID_PREFIX = "req_";
var REQUEST_ID_BYTES = 8;
var _adminClient = null;
var _clientErrorEmitted = false;
function getAdminClient() {
  if (_adminClient) return _adminClient;
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    if (!_clientErrorEmitted) {
      _clientErrorEmitted = true;
    }
    return null;
  }
  _adminClient = (0, import_supabase_js2.createClient)(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  return _adminClient;
}
function generateRequestId() {
  const hex = (0, import_crypto.randomBytes)(REQUEST_ID_BYTES).toString("hex");
  return `${REQUEST_ID_PREFIX}${hex}`;
}
function sanitizeStack(stack) {
  if (!stack) return void 0;
  const lines = stack.split("\n");
  const cleaned = lines.map((line) => {
    return line.replace(/\.js:\d+:\d+/, ".js:xxx:xxx");
  });
  return cleaned.join("\n");
}
async function writeSystemLog(input) {
  const admin = getAdminClient();
  if (!admin) return;
  try {
    await admin.rpc("insert_system_log", {
      p_request_id: input.requestId,
      p_level: input.level,
      p_category: input.category,
      p_method: input.method || null,
      p_path: input.path || null,
      p_status_code: input.status_code || null,
      p_duration_ms: input.duration_ms || null,
      p_user_id: input.user_id || null,
      p_role: input.role || null,
      p_error_code: input.error_code || null,
      p_message: input.message || null,
      p_metadata: input.metadata || {}
    });
  } catch {
  }
}
async function logApiRequest(params) {
  const { requestId, method, path: path2, statusCode, durationMs, userId, role, error_code, error_message, metadata } = params;
  const isError = statusCode >= 400;
  const level = statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info";
  const category = isError ? "api_error" : "api_request";
  let message;
  if (error_code) {
    message = error_code;
  } else if (isError) {
    message = `Error ${statusCode}`;
  }
  const logMetadata = {
    ...metadata || {},
    ...error_message ? { error_message } : {}
  };
  await writeSystemLog({
    requestId,
    level,
    category,
    method,
    path: path2,
    status_code: statusCode,
    duration_ms: durationMs,
    user_id: userId,
    role,
    error_code,
    message,
    metadata: logMetadata
  });
}
async function logAuthEvent(params) {
  const { requestId, event, userId, role, path: path2, method, statusCode, metadata } = params;
  let level = "info";
  if (event.includes("failure") || event.includes("invalid") || event.includes("missing") || event.includes("expired")) {
    level = "warn";
  }
  await writeSystemLog({
    requestId,
    level,
    category: "auth",
    method,
    path: path2,
    status_code: statusCode,
    user_id: userId,
    role,
    message: event,
    metadata
  });
}
async function logAuditEvent(params) {
  const admin = getAdminClient();
  if (!admin) return;
  try {
    await admin.rpc("insert_audit_log", {
      p_actor_user_id: params.actorUserId || null,
      p_actor_role: params.actorRole || null,
      p_action: params.action,
      p_entity_type: params.entityType || null,
      p_entity_id: params.entityId || null,
      p_request_id: params.requestId || null,
      p_metadata: params.metadata || {}
    });
  } catch {
  }
}
async function logApiError(params) {
  await writeSystemLog({
    requestId: params.requestId,
    level: params.statusCode >= 500 ? "error" : "warn",
    category: "api_error",
    method: params.method,
    path: params.path,
    status_code: params.statusCode,
    user_id: params.userId,
    role: params.role,
    error_code: params.error_code,
    message: params.message,
    metadata: {
      ...params.metadata || {},
      ...params.stack ? { stack: sanitizeStack(params.stack) } : {}
    }
  });
}
async function fetchSystemLogs(options) {
  const admin = getAdminClient();
  if (!admin) return [];
  try {
    let query = admin.from("system_logs").select("*");
    if (options.category) query = query.eq("category", options.category);
    if (options.level) query = query.eq("level", options.level);
    if (options.status_code !== void 0) query = query.eq("status_code", options.status_code);
    if (options.request_id) query = query.eq("request_id", options.request_id);
    if (options.user_id) query = query.eq("user_id", options.user_id);
    if (options.path) query = query.ilike("path", `%${options.path}%`);
    if (options.method) query = query.eq("method", options.method);
    if (options.search) {
      query = query.or(`message.ilike.%${options.search}%,error_code.ilike.%${options.search}%,request_id.ilike.%${options.search}%`);
    }
    if (options.timeRangeHours) {
      const cutoff = new Date(Date.now() - options.timeRangeHours * 3600 * 1e3).toISOString();
      query = query.gte("created_at", cutoff);
    }
    query = query.order("created_at", { ascending: false });
    if (options.offset) {
      const from = options.offset;
      const to = from + (options.limit ? options.limit : 1e3) - 1;
      query = query.range(from, to);
    } else if (options.limit) {
      query = query.limit(options.limit);
    }
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch {
    return [];
  }
}
async function fetchAuditLogs(options) {
  const admin = getAdminClient();
  if (!admin) return [];
  try {
    let query = admin.from("audit_logs").select("*");
    if (options.actor_user_id) query = query.eq("actor_user_id", options.actor_user_id);
    if (options.action) query = query.ilike("action", `%${options.action}%`);
    if (options.entity_type) query = query.eq("entity_type", options.entity_type);
    if (options.request_id) query = query.eq("request_id", options.request_id);
    if (options.timeRangeHours) {
      const cutoff = new Date(Date.now() - options.timeRangeHours * 3600 * 1e3).toISOString();
      query = query.gte("created_at", cutoff);
    }
    if (options.search) {
      query = query.or(`action.ilike.%${options.search}%,metadata::text.ilike.%${options.search}%`);
    }
    query = query.order("created_at", { ascending: false });
    if (options.offset) {
      const from = options.offset;
      const to = from + (options.limit ? options.limit : 1e3) - 1;
      query = query.range(from, to);
    } else if (options.limit) {
      query = query.limit(options.limit);
    }
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch {
    return [];
  }
}
async function fetchSystemHealthMetrics() {
  const admin = getAdminClient();
  if (!admin) {
    return {
      total_requests: 0,
      successful_requests: 0,
      error_4xx: 0,
      error_5xx: 0,
      average_latency_ms: 0,
      slow_requests: 0,
      error_rate: 0,
      total_audit_events: 0,
      error_groups: []
    };
  }
  try {
    const [{ count: total }, { count: successful }, { count: err4xx }, { count: err5xx }, { data: latencyData }, { count: auditCount }, { data: errorGroups }] = await Promise.all([
      admin.from("system_logs").select("*", { count: "exact", head: true }).eq("category", "api_request"),
      admin.from("system_logs").select("*", { count: "exact", head: true }).eq("category", "api_request").not("status_code", "is", null).lt("status_code", 400),
      admin.from("system_logs").select("*", { count: "exact", head: true }).eq("category", "api_error").not("status_code", "is", null).gte("status_code", 400).lt("status_code", 500),
      admin.from("system_logs").select("*", { count: "exact", head: true }).eq("category", "api_error").not("status_code", "is", null).gte("status_code", 500),
      admin.from("system_logs").select("duration_ms").not("duration_ms", "is", null).eq("category", "api_request"),
      admin.from("audit_logs").select("*", { count: "exact", head: true }),
      admin.from("system_logs").select(`
          path,
          status_code,
          error_code,
          created_at,
          request_id
        `).eq("category", "api_error").not("status_code", "is", null).order("created_at", { ascending: false }).limit(500)
    ]);
    const durations = (latencyData || []).map((d) => d.duration_ms).filter((d) => d != null && d > 0);
    const averageLatency = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    const slowRequests = durations.filter((d) => d > 1e3).length;
    const totalRequests = total || 0;
    const allErrors = (err4xx || 0) + (err5xx || 0);
    const errorRate = totalRequests > 0 ? Number((allErrors / totalRequests * 100).toFixed(1)) : 0;
    const groups = /* @__PURE__ */ new Map();
    for (const row of errorGroups || []) {
      const key = `${row.path || "unknown"}|${row.status_code || 0}|${row.error_code || "unknown"}`;
      const existing = groups.get(key);
      if (existing) {
        existing.occurrences += 1;
        if (new Date(row.created_at).getTime() < new Date(existing.first_seen).getTime()) {
          existing.first_seen = row.created_at;
          existing.request_id = row.request_id;
        }
        if (new Date(row.created_at).getTime() > new Date(existing.last_seen).getTime()) {
          existing.last_seen = row.created_at;
        }
      } else {
        groups.set(key, {
          endpoint: row.path,
          status_code: row.status_code,
          error_type: row.error_code,
          occurrences: 1,
          first_seen: row.created_at,
          last_seen: row.created_at,
          request_id: row.request_id
        });
      }
    }
    return {
      total_requests: totalRequests,
      successful_requests: successful || 0,
      error_4xx: err4xx || 0,
      error_5xx: err5xx || 0,
      average_latency_ms: averageLatency,
      slow_requests: slowRequests,
      error_rate: errorRate,
      total_audit_events: auditCount || 0,
      error_groups: Array.from(groups.values()).sort((a, b) => b.occurrences - a.occurrences)
    };
  } catch {
    return {
      total_requests: 0,
      successful_requests: 0,
      error_4xx: 0,
      error_5xx: 0,
      average_latency_ms: 0,
      slow_requests: 0,
      error_rate: 0,
      total_audit_events: 0,
      error_groups: []
    };
  }
}
var logger = {
  auth: (event, options) => {
    logAuthEvent({
      requestId: options.requestId || "",
      event,
      userId: options.userId,
      role: options.role,
      path: options.path,
      method: options.method,
      statusCode: options.statusCode,
      metadata: options.result || options.reason ? { result: options.result, reason: options.reason } : void 0
    }).catch(() => {
    });
  },
  requestEnd: (context, statusCode, errorCode, errorMessage, metadata) => {
    const durationMs = context.start ? Date.now() - context.start : 0;
    logApiRequest({
      requestId: context.requestId || "",
      method: context.method || "GET",
      path: context.path || "",
      statusCode,
      durationMs,
      userId: context.userId || void 0,
      role: context.role || void 0,
      error_code: errorCode || void 0,
      error_message: errorMessage,
      metadata
    }).catch(() => {
    });
  },
  /**
   * Structured booking transition logger. Safe identifiers only — never
   * logs passwords, payment secrets, private tokens or PII.
   */
  booking: (event, options) => {
    logAuthEvent({
      requestId: options.requestId || "",
      event,
      userId: options.userId,
      role: options.role,
      metadata: {
        ...options.metadata,
        bookingId: options.bookingId,
        holdId: options.holdId,
        bookingCode: options.bookingCode,
        mentorId: options.mentorId,
        seekerId: options.seekerId,
        status: options.status,
        error: options.error
      }
    }).catch(() => {
    });
  }
};

// src/lib/adminAccountControl.ts
var ACCOUNT_ADMIN_AUDIT_ACTIONS = {
  ACTIVATED: "USER_ACTIVATED",
  DEACTIVATED: "USER_DEACTIVATED",
  SUSPENDED: "USER_SUSPENDED",
  REACTIVATED: "USER_REACTIVATED"
};
var ACCOUNT_STATUS_ACTIONS = ["activate", "deactivate", "suspend", "reactivate"];
function isAccountStatusAction(value) {
  return typeof value === "string" && ACCOUNT_STATUS_ACTIONS.includes(value);
}
function parseAccountStatusAction(value) {
  return isAccountStatusAction(value) ? value : null;
}
var ACCOUNT_STATUS_ACTION_SPECS = {
  activate: {
    auditAction: ACCOUNT_ADMIN_AUDIT_ACTIONS.ACTIVATED,
    accountStatus: "active",
    requiresReason: false,
    supportsSuspendedUntil: false,
    label: "Activate",
    confirmation: "This account becomes active again. The user regains normal platform access and existing records stay intact."
  },
  deactivate: {
    auditAction: ACCOUNT_ADMIN_AUDIT_ACTIONS.DEACTIVATED,
    accountStatus: "deactivated",
    requiresReason: false,
    supportsSuspendedUntil: false,
    label: "Deactivate",
    confirmation: "This user will no longer be able to perform normal platform operations or start new bookings. Profile, bookings, payments, workspaces, notifications and audit history are all preserved."
  },
  suspend: {
    auditAction: ACCOUNT_ADMIN_AUDIT_ACTIONS.SUSPENDED,
    accountStatus: "suspended",
    requiresReason: true,
    supportsSuspendedUntil: true,
    label: "Suspend",
    confirmation: "This user is not discoverable and cannot start new bookings until the suspension is lifted. Historical data is preserved."
  },
  reactivate: {
    auditAction: ACCOUNT_ADMIN_AUDIT_ACTIONS.REACTIVATED,
    accountStatus: "active",
    requiresReason: false,
    supportsSuspendedUntil: false,
    label: "Reactivate",
    confirmation: "Suspension is lifted and the account returns to normal operation. The user does not need to recreate their account."
  }
};
function isSuspendedWindowElapsed(suspendedUntil, now) {
  if (!suspendedUntil) return false;
  const until = Date.parse(suspendedUntil);
  if (Number.isNaN(until)) return false;
  return now.getTime() >= until;
}
function deriveAccountState(source, now = /* @__PURE__ */ new Date()) {
  const raw = (source.account_status ?? "active").toString().toLowerCase();
  const accountStatus = raw === "suspended" ? "suspended" : raw === "deactivated" ? "deactivated" : "active";
  const suspendedByExpiry = accountStatus === "suspended" && isSuspendedWindowElapsed(source.suspended_until, now);
  const isSuspended = accountStatus === "suspended" && !suspendedByExpiry;
  const isSuspensionLapsed = suspendedByExpiry;
  const isDeactivated = accountStatus === "deactivated";
  const isActive = !isSuspended && !isDeactivated;
  return {
    accountStatus,
    isSuspended,
    isSuspensionLapsed,
    isDeactivated,
    isActive,
    canPerformOperationalActions: isActive
  };
}
function buildAccountStatusUpdate(input) {
  const spec = ACCOUNT_STATUS_ACTION_SPECS[input.action];
  const nowIso = (input.now ?? /* @__PURE__ */ new Date()).toISOString();
  const reason = input.reason?.trim() ? input.reason.trim() : null;
  const suspendedUntil = spec.supportsSuspendedUntil && input.suspendedUntil ? new Date(input.suspendedUntil).toISOString() : null;
  const isSuspension = spec.accountStatus === "suspended";
  return {
    account_status: spec.accountStatus,
    suspended_at: isSuspension ? nowIso : null,
    suspended_until: isSuspension ? suspendedUntil : null,
    suspension_reason: isSuspension ? reason : null,
    suspended_by: isSuspension ? input.adminId : null,
    deactivated_at: spec.accountStatus === "deactivated" ? nowIso : null,
    updated_at: nowIso
  };
}
function validateAccountStatusAction(input) {
  const action = parseAccountStatusAction(input.action);
  if (!action) {
    return {
      valid: false,
      code: "VALIDATION_ERROR",
      message: `action must be one of: ${ACCOUNT_STATUS_ACTIONS.join(", ")}.`
    };
  }
  const spec = ACCOUNT_STATUS_ACTION_SPECS[action];
  const now = input.now ?? /* @__PURE__ */ new Date();
  const reason = typeof input.reason === "string" && input.reason.trim() ? input.reason.trim() : null;
  if (spec.requiresReason && !reason) {
    return { valid: false, code: "REASON_REQUIRED", message: "A reason is required for this action." };
  }
  let suspendedUntil = null;
  if (spec.supportsSuspendedUntil && input.suspendedUntil !== void 0 && input.suspendedUntil !== null && input.suspendedUntil !== "") {
    if (typeof input.suspendedUntil !== "string") {
      return {
        valid: false,
        code: "SUSPENDED_UNTIL_INVALID",
        message: "suspendedUntil must be an ISO timestamp."
      };
    }
    const parsed = Date.parse(input.suspendedUntil);
    if (Number.isNaN(parsed)) {
      return {
        valid: false,
        code: "SUSPENDED_UNTIL_INVALID",
        message: "suspendedUntil must be an ISO timestamp."
      };
    }
    if (parsed <= now.getTime()) {
      return {
        valid: false,
        code: "SUSPENDED_UNTIL_IN_PAST",
        message: "suspendedUntil must be in the future."
      };
    }
    suspendedUntil = new Date(parsed).toISOString();
  }
  return { valid: true, reason, suspendedUntil };
}
function assertAdminAccountSafety(input) {
  const { action, adminId, targetId, targetRoles, activeAdminCount, targetState } = input;
  if (targetId === adminId) {
    return {
      allowed: false,
      code: "SELF_STATUS_CHANGE_FORBIDDEN",
      message: "Administrators cannot change their own account status."
    };
  }
  const targetIsAdmin = targetRoles.includes("admin");
  const wouldDisable = action === "deactivate" || action === "suspend";
  if (targetIsAdmin && wouldDisable && activeAdminCount <= 1) {
    return {
      allowed: false,
      code: "LAST_ACTIVE_ADMIN",
      message: `Cannot ${action} this administrator: it is the last active admin account. Promote or restore another admin first.`
    };
  }
  if (action === "activate" && !targetState.isActive) {
    return { allowed: true };
  }
  if (action === "reactivate" && !targetState.isActive) {
    return { allowed: true };
  }
  if (action === "deactivate" && targetState.isDeactivated) {
    return {
      allowed: false,
      code: "NO_STATUS_CHANGE_NEEDED",
      message: "This account is already deactivated."
    };
  }
  if (action === "suspend" && targetState.isSuspended) {
    return {
      allowed: false,
      code: "NO_STATUS_CHANGE_NEEDED",
      message: "This account is already suspended."
    };
  }
  return { allowed: true };
}

// src/lib/adminMentorControl.ts
var MENTOR_ADMIN_AUDIT_ACTIONS = {
  CREATED: "MENTOR_CREATED_BY_ADMIN",
  ACTIVATED: "MENTOR_ACTIVATED",
  DEACTIVATED: "MENTOR_DEACTIVATED",
  SUSPENDED: "MENTOR_SUSPENDED",
  REACTIVATED: "MENTOR_REACTIVATED",
  PROFILE_UPDATED: "MENTOR_PROFILE_UPDATED_BY_ADMIN",
  SEGMENTS_UPDATED: "MENTOR_SEGMENTS_UPDATED_BY_ADMIN",
  GIG_CREATED: "MENTOR_GIG_CREATED_BY_ADMIN",
  GIG_UPDATED: "MENTOR_GIG_UPDATED_BY_ADMIN",
  GIG_ARCHIVED: "MENTOR_GIG_ARCHIVED_BY_ADMIN",
  AVAILABILITY_UPDATED: "MENTOR_AVAILABILITY_UPDATED_BY_ADMIN"
};
var MENTOR_STATUS_ACTIONS = ["activate", "deactivate", "suspend", "reactivate"];
function isMentorStatusAction(value) {
  return typeof value === "string" && MENTOR_STATUS_ACTIONS.includes(value);
}
function parseMentorStatusAction(value) {
  return isMentorStatusAction(value) ? value : null;
}
var MENTOR_STATUS_ACTION_SPECS = {
  activate: {
    auditAction: MENTOR_ADMIN_AUDIT_ACTIONS.ACTIVATED,
    isActive: true,
    accountStatus: "active",
    requiresReason: false,
    supportsSuspendedUntil: false,
    label: "Activate Mentor"
  },
  deactivate: {
    auditAction: MENTOR_ADMIN_AUDIT_ACTIONS.DEACTIVATED,
    isActive: false,
    accountStatus: "deactivated",
    requiresReason: false,
    supportsSuspendedUntil: false,
    label: "Deactivate Mentor"
  },
  suspend: {
    auditAction: MENTOR_ADMIN_AUDIT_ACTIONS.SUSPENDED,
    isActive: false,
    accountStatus: "suspended",
    requiresReason: true,
    supportsSuspendedUntil: true,
    label: "Suspend Mentor"
  },
  reactivate: {
    auditAction: MENTOR_ADMIN_AUDIT_ACTIONS.REACTIVATED,
    isActive: true,
    accountStatus: "active",
    requiresReason: false,
    supportsSuspendedUntil: false,
    label: "Reactivate Mentor"
  }
};
function deriveMentorAccountState(source, now = /* @__PURE__ */ new Date()) {
  const approvalStatus = source.approval_status ?? null;
  const isApproved = approvalStatus !== null ? approvalStatus === "approved" : source.is_approved === true;
  const isActive = source.is_active === true;
  const account = deriveAccountState(
    { account_status: source.account_status, suspended_until: source.suspended_until },
    now
  );
  const isEligible = isApproved && isActive && account.isActive;
  return {
    isApproved,
    isActive,
    isSuspended: account.isSuspended,
    isSuspensionLapsed: account.isSuspensionLapsed,
    isDeactivated: account.isDeactivated,
    isEligible,
    canPerformOperationalActions: isEligible
  };
}
function buildMentorStatusUpdate(input) {
  const nowIso = (input.now ?? /* @__PURE__ */ new Date()).toISOString();
  return {
    mentorProfile: {
      is_active: MENTOR_STATUS_ACTION_SPECS[input.action].isActive,
      updated_at: nowIso
    },
    // Shared with the generic user Control Center: one definition of the
    // `profiles` writes, so a mentor and a seeker behave identically.
    profile: buildAccountStatusUpdate({
      action: input.action,
      adminId: input.adminId,
      reason: input.reason,
      suspendedUntil: input.suspendedUntil,
      now: input.now
    })
  };
}
function validateMentorStatusAction(input) {
  const action = parseMentorStatusAction(input.action);
  if (!action) {
    return {
      valid: false,
      code: "VALIDATION_ERROR",
      message: `action must be one of: ${MENTOR_STATUS_ACTIONS.join(", ")}.`
    };
  }
  const base = validateAccountStatusAction({
    action,
    reason: input.reason,
    suspendedUntil: input.suspendedUntil,
    now: input.now
  });
  if (!base.valid) {
    return { valid: false, code: base.code, message: base.message };
  }
  if ((action === "activate" || action === "reactivate") && input.state && !input.state.isApproved) {
    return {
      valid: false,
      code: "MENTOR_NOT_APPROVED",
      message: "This mentor is not approved. Approve the mentor before activating them."
    };
  }
  return { valid: true, reason: base.reason ?? null, suspendedUntil: base.suspendedUntil ?? null };
}
var ADMIN_CREATED_MENTOR_DEFAULTS = {
  approval_status: "approved",
  is_approved: true,
  is_active: true,
  account_status: "active"
};
function buildAdminCreatedMentorProfile(input) {
  const nowIso = (input.now ?? /* @__PURE__ */ new Date()).toISOString();
  return {
    headline: input.headline?.trim() || "",
    about: input.about?.trim() || null,
    experience_years: typeof input.experienceYears === "number" && Number.isInteger(input.experienceYears) && input.experienceYears >= 0 ? input.experienceYears : 0,
    languages: [],
    rating: 0,
    review_count: 0,
    session_count: 0,
    is_approved: ADMIN_CREATED_MENTOR_DEFAULTS.is_approved,
    is_featured: false,
    approval_status: ADMIN_CREATED_MENTOR_DEFAULTS.approval_status,
    is_active: ADMIN_CREATED_MENTOR_DEFAULTS.is_active,
    created_at: nowIso,
    updated_at: nowIso
  };
}
var MENTOR_CREATION_SOURCES = ["public_signup", "admin_direct", "unknown"];
function isMentorCreationSource(value) {
  return typeof value === "string" && MENTOR_CREATION_SOURCES.includes(value);
}
function resolveMentorCreationSource(evidence) {
  if (isMentorCreationSource(evidence.createdVia) && evidence.createdVia !== "unknown") {
    return evidence.createdVia;
  }
  if (evidence.hasAdminCreationAudit === true) return "admin_direct";
  if (evidence.hasApplication === true) return "public_signup";
  return "unknown";
}

// src/lib/supabaseServer.ts
var supabaseAdmin = null;
var DEMO_TOKEN_PREFIX = "skdemo.";
var DEMO_TOKEN_TTL_SECONDS = 24 * 60 * 60;
var FORBIDDEN_DEFAULT_SECRETS = /* @__PURE__ */ new Set([
  "suggest-key-development-only",
  "development-only",
  "secret",
  "changeme",
  "demo"
]);
var DEMO_TOKEN_SECRET_MIN_LENGTH = 32;
function readDemoTokenSecret() {
  const raw = (process.env.DEMO_TOKEN_SECRET ?? process.env.DEMO_AUTH_SECRET ?? "").trim();
  if (!raw) return "";
  if (raw.length < DEMO_TOKEN_SECRET_MIN_LENGTH) return "";
  if (FORBIDDEN_DEFAULT_SECRETS.has(raw.toLowerCase())) return "";
  return raw;
}
var DEMO_TOKEN_SECRET = readDemoTokenSecret();
function isDemoPersonasExplicitlyEnabled() {
  return String(process.env.ENABLE_DEMO_PERSONAS ?? "").trim().toLowerCase() === "true";
}
function demoAuthDisabledReason() {
  if (process.env.NODE_ENV === "production") return "NODE_ENV=production";
  if (!isDemoPersonasExplicitlyEnabled()) return 'ENABLE_DEMO_PERSONAS is not "true"';
  if (!DEMO_TOKEN_SECRET) return "DEMO_TOKEN_SECRET is missing, too short, or a known default";
  return "";
}
function isDemoAuthEnabled() {
  return demoAuthDisabledReason() === "";
}
var encodeBase64Url = (value) => value.toString("base64url");
var decodeBase64Url = (value) => Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
function createDemoToken(claims) {
  const now = Math.floor(Date.now() / 1e3);
  const payload = { ...claims, iat: now, exp: now + DEMO_TOKEN_TTL_SECONDS };
  const encodedPayload = encodeBase64Url(Buffer.from(JSON.stringify(payload)));
  const signature = encodeBase64Url((0, import_crypto2.createHmac)("sha256", DEMO_TOKEN_SECRET).update(encodedPayload).digest());
  return `${DEMO_TOKEN_PREFIX}${encodedPayload}.${signature}`;
}
function verifyDemoToken(token) {
  if (!isDemoAuthEnabled() || !token.startsWith(DEMO_TOKEN_PREFIX)) {
    return null;
  }
  const parts = token.slice(DEMO_TOKEN_PREFIX.length).split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, encodedSignature] = parts;
  const expectedSignature = (0, import_crypto2.createHmac)("sha256", DEMO_TOKEN_SECRET).update(encodedPayload).digest();
  const actualSignature = decodeBase64Url(encodedSignature);
  if (expectedSignature.length !== actualSignature.length || !(0, import_crypto2.timingSafeEqual)(expectedSignature, actualSignature)) {
    return null;
  }
  try {
    const payload = JSON.parse(decodeBase64Url(encodedPayload).toString("utf8"));
    if (typeof payload.sub !== "string" || typeof payload.email !== "string" || !["seeker", "mentor", "admin"].includes(payload.role || "") || typeof payload.iat !== "number" || typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1e3)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
function getSupabaseAdmin() {
  if (supabaseAdmin) return supabaseAdmin;
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return null;
  }
  supabaseAdmin = (0, import_supabase_js3.createClient)(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
  return supabaseAdmin;
}
function isUserRole(value) {
  return value === "seeker" || value === "mentor" || value === "admin";
}
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7).trim() : null;
  const path2 = req.path || req.url || "";
  if (!token) {
    logger.auth("auth_missing_token", {
      requestId: req.requestId,
      path: path2,
      result: "failure",
      reason: "AUTH_REQUIRED"
    });
    res.status(401).json({
      success: false,
      error: { code: "AUTH_REQUIRED", message: "A valid bearer token is required." }
    });
    return;
  }
  const demoClaims = isDemoAuthEnabled() ? verifyDemoToken(token) : null;
  if (demoClaims) {
    req.auth = {
      user: {
        id: demoClaims.sub,
        email: demoClaims.email,
        aud: "authenticated"
      },
      roles: [demoClaims.role]
    };
    logger.auth("login_success", {
      requestId: req.requestId,
      userId: demoClaims.sub,
      role: demoClaims.role,
      path: path2,
      result: "success"
    });
    next();
    return;
  }
  const admin = getSupabaseAdmin();
  if (!admin) {
    logger.auth("auth_service_unavailable", {
      requestId: req.requestId,
      path: path2,
      result: "failure",
      reason: "AUTH_SERVICE_UNAVAILABLE"
    });
    res.status(503).json({
      success: false,
      error: { code: "AUTH_SERVICE_UNAVAILABLE", message: "Authentication is not configured." }
    });
    return;
  }
  try {
    const { data: { user }, error } = await admin.auth.getUser(token);
    if (error || !user) {
      logger.auth("login_failure", {
        requestId: req.requestId,
        path: path2,
        result: "failure",
        reason: error?.code || "AUTH_INVALID"
      });
      res.status(401).json({
        success: false,
        error: { code: "AUTH_INVALID", message: "The provided token is invalid or expired." }
      });
      return;
    }
    const { data: userRoles, error: rolesError } = await admin.from("user_roles").select("role").eq("user_id", user.id);
    if (rolesError) {
      logger.auth("role_lookup_failed", {
        requestId: req.requestId,
        userId: user.id,
        path: path2,
        result: "failure",
        reason: "ROLE_LOOKUP_FAILED"
      });
      console.error("[Auth] Failed to fetch user roles:", rolesError.message);
      res.status(500).json({
        success: false,
        error: { code: "ROLE_LOOKUP_FAILED", message: "Unable to verify user roles." }
      });
      return;
    }
    const roles = (userRoles || []).map((r) => r.role).filter(isUserRole);
    req.auth = { user, roles };
    logger.auth("login_success", {
      requestId: req.requestId,
      userId: user.id,
      role: roles.includes("admin") ? "admin" : roles.includes("mentor") ? "mentor" : roles.includes("seeker") ? "seeker" : void 0,
      path: path2,
      result: "success"
    });
    next();
  } catch (error) {
    logger.auth("login_failure", {
      requestId: req.requestId,
      path: path2,
      result: "failure",
      reason: "AUTH_INVALID"
    });
    console.error("[Auth] Authentication failed:", logSanitizer.safeMessage(error));
    res.status(401).json({
      success: false,
      error: { code: "AUTH_INVALID", message: "The provided token is invalid or expired." }
    });
  }
}
async function requireAdmin(req, res, next) {
  if (!req.auth) {
    logger.auth("auth_missing", {
      requestId: req.requestId,
      path: req.path || req.url || "",
      result: "failure",
      reason: "AUTH_REQUIRED"
    });
    res.status(401).json({
      success: false,
      error: { code: "AUTH_REQUIRED", message: "Authentication required." }
    });
    return;
  }
  if (!req.auth.roles.includes("admin")) {
    logger.auth("role_authorization_failure", {
      requestId: req.requestId,
      userId: req.auth.user.id,
      role: req.auth.roles.includes("mentor") ? "mentor" : req.auth.roles.includes("seeker") ? "seeker" : void 0,
      path: req.path || req.url || "",
      result: "failure",
      reason: "FORBIDDEN_ADMIN_REQUIRED"
    });
    res.status(403).json({
      success: false,
      error: { code: "FORBIDDEN", message: "Admin role required." }
    });
    return;
  }
  next();
}
function requireRole(role) {
  return async (req, res, next) => {
    if (!req.auth) {
      logger.auth("auth_missing", {
        requestId: req.requestId,
        path: req.path || req.url || "",
        result: "failure",
        reason: "AUTH_REQUIRED"
      });
      res.status(401).json({
        success: false,
        error: { code: "AUTH_REQUIRED", message: "Authentication required." }
      });
      return;
    }
    if (!req.auth.roles.includes(role) && !req.auth.roles.includes("admin")) {
      logger.auth("role_authorization_failure", {
        requestId: req.requestId,
        userId: req.auth.user.id,
        role: req.auth.roles.includes("mentor") ? "mentor" : req.auth.roles.includes("seeker") ? "seeker" : void 0,
        path: req.path || req.url || "",
        result: "failure",
        reason: `FORBIDDEN_ROLE_${role.toUpperCase()}`
      });
      res.status(403).json({
        success: false,
        error: { code: "FORBIDDEN", message: `Role '${role}' required.` }
      });
      return;
    }
    next();
  };
}
async function requireActiveMentor(req, res, next) {
  try {
    if (!req.auth) {
      res.status(401).json({
        success: false,
        error: { code: "AUTH_REQUIRED", message: "Authentication required." }
      });
      return;
    }
    if (req.auth.roles.includes("admin")) {
      next();
      return;
    }
    const admin = getSupabaseAdmin();
    if (!admin) {
      res.status(503).json({
        success: false,
        error: { code: "SERVICE_UNAVAILABLE", message: "Mentor status cannot be verified right now." }
      });
      return;
    }
    const userId = req.auth.user.id;
    const [{ data: mentorProfile, error: mpErr }, { data: profile, error: profileErr }] = await Promise.all([
      admin.from("mentor_profiles").select("approval_status, is_approved, is_active").eq("id", userId).maybeSingle(),
      admin.from("profiles").select("account_status, suspended_until").eq("id", userId).maybeSingle()
    ]);
    if (mpErr) throw mpErr;
    if (profileErr) throw profileErr;
    if (!mentorProfile) {
      res.status(403).json({
        success: false,
        error: { code: "MENTOR_PROFILE_NOT_FOUND", message: "No mentor profile is associated with this account." }
      });
      return;
    }
    const state = deriveMentorAccountState({
      approval_status: mentorProfile.approval_status ?? null,
      is_approved: mentorProfile.is_approved ?? null,
      is_active: mentorProfile.is_active ?? null,
      account_status: profile?.account_status ?? null,
      suspended_until: profile?.suspended_until ?? null
    });
    if (!state.canPerformOperationalActions) {
      const reason = state.isSuspended ? "Your account is suspended." : state.isDeactivated ? "Your mentor account has been deactivated by an administrator." : "Your mentor account is not active.";
      logger.auth("mentor_operational_blocked", {
        requestId: req.requestId,
        userId,
        role: "mentor",
        path: req.path || req.url || "",
        result: "failure",
        reason: state.isSuspended ? "ACCOUNT_SUSPENDED" : state.isDeactivated ? "ACCOUNT_DEACTIVATED" : "MENTOR_INACTIVE"
      });
      res.status(403).json({
        success: false,
        error: { code: "MENTOR_ACCOUNT_NOT_ACTIVE", message: reason }
      });
      return;
    }
    next();
  } catch (error) {
    logger.auth("mentor_operational_check_failed", {
      requestId: req.requestId,
      userId: req.auth?.user?.id,
      role: "mentor",
      path: req.path || req.url || "",
      result: "failure",
      reason: "STATUS_CHECK_FAILED"
    });
    console.error("[Auth] Failed to verify mentor operational status:", logSanitizer.safeMessage(error));
    res.status(500).json({
      success: false,
      error: { code: "STATUS_CHECK_FAILED", message: "Unable to verify the mentor account status." }
    });
  }
}

// src/lib/supportDomain.ts
var SUPPORT_TICKET_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_FOR_USER",
  "RESOLVED",
  "CLOSED"
];
var SUPPORT_TICKET_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"];
var SUPPORT_SUBJECT_MIN = 4;
var SUPPORT_SUBJECT_MAX = 140;
var SUPPORT_MESSAGE_MIN = 20;
var SUPPORT_MESSAGE_MAX = 4e3;
var SUPPORT_RESOLUTION_MIN = 5;
var SUPPORT_RESOLUTION_MAX = 4e3;
var SUPPORT_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
var SUPPORT_ATTACHMENT_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf"
];
var BOOKING_CODE_PATTERN2 = /^BK-[A-Za-z0-9-]{1,32}$/;
var SUPPORT_ATTACHMENT_BUCKET = "support-attachments";
var buildSupportAttachmentPath = (ticketId, fileName, uniquePart) => `support/${ticketId}/${uniquePart}-${sanitiseSupportFileName(fileName)}`;
function sanitiseSupportFileName(raw) {
  const base = String(raw ?? "").split(/[/\\]/).pop() ?? "";
  const cleaned = base.replace(/[^0-9A-Za-z._-]/g, "_").replace(/^\.+/, "").slice(0, 80);
  return cleaned.length > 0 ? cleaned : "attachment";
}

// src/lib/loginFailureTracker.ts
var import_crypto3 = require("crypto");
var LOGIN_FAILURE_ALERT_THRESHOLD = 5;
var IDENTIFIER_SALT = process.env.LOGIN_ALERT_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.DEMO_AUTH_SECRET || (0, import_crypto3.randomBytes)(32).toString("hex");
var FALLBACK_THRESHOLD = LOGIN_FAILURE_ALERT_THRESHOLD;
var FALLBACK_WINDOW_MINUTES = 15;
var NOOP_RESULT = {
  consecutiveFailures: 0,
  shouldAlert: false,
  alertRaised: false
};
function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}
function normalizeIp(ip) {
  return typeof ip === "string" ? ip.trim().slice(0, 64) : "";
}
function buildIdentifierKey(email, ip) {
  return (0, import_crypto3.createHmac)("sha256", IDENTIFIER_SALT).update(`${normalizeEmail(email)}|${normalizeIp(ip)}`).digest("hex");
}
function firstRow(data) {
  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}
async function recordLoginFailure(params) {
  const admin = getSupabaseAdmin();
  if (!admin) return NOOP_RESULT;
  const identifierKey = buildIdentifierKey(params.email, params.ip);
  if (!identifierKey) return NOOP_RESULT;
  const reason = logSanitizer.safeMessage(
    typeof params.reason === "string" ? params.reason : "INVALID_CREDENTIALS"
  );
  try {
    const { data, error } = await admin.rpc("record_login_failure", {
      p_identifier_key: identifierKey,
      p_failure_reason: reason.slice(0, 120)
    });
    if (error) {
      console.error("[login-alert] record_login_failure failed:", error.message);
      return NOOP_RESULT;
    }
    const row = firstRow(data);
    if (!row) return NOOP_RESULT;
    if (row.alert_raised) {
      console.error(
        `[login-alert] LOGIN_BRUTE_FORCE_SUSPECTED consecutive_failures=${row.consecutive_failures} threshold=${FALLBACK_THRESHOLD} window_minutes=${FALLBACK_WINDOW_MINUTES} identity=${identifierKey.slice(0, 12)}`
      );
    }
    return {
      consecutiveFailures: row.consecutive_failures ?? 0,
      shouldAlert: Boolean(row.should_alert),
      alertRaised: Boolean(row.alert_raised)
    };
  } catch (error) {
    console.error("[login-alert] record_login_failure threw:", logSanitizer.safeMessage(error));
    return NOOP_RESULT;
  }
}
async function resetLoginFailures(params) {
  const admin = getSupabaseAdmin();
  if (!admin) return 0;
  const identifierKey = buildIdentifierKey(params.email, params.ip);
  if (!identifierKey) return 0;
  try {
    const { data, error } = await admin.rpc("reset_login_failures", {
      p_identifier_key: identifierKey
    });
    if (error) {
      console.error("[login-alert] reset_login_failures failed:", error.message);
      return 0;
    }
    return typeof data === "number" ? data : 0;
  } catch (error) {
    console.error("[login-alert] reset_login_failures threw:", logSanitizer.safeMessage(error));
    return 0;
  }
}

// src/lib/auditLogger.ts
async function auditAction(auth, action, options) {
  const userId = auth?.user?.id;
  const role = auth?.roles?.includes("admin") ? "admin" : auth?.roles?.includes("mentor") ? "mentor" : auth?.roles?.includes("seeker") ? "seeker" : void 0;
  await logAuditEvent({
    actorUserId: userId,
    actorRole: role,
    action,
    entityType: options.entityType,
    entityId: options.entityId,
    requestId: options.requestId,
    metadata: options.metadata
  }).catch(() => {
  });
}

// src/lib/paymentProof.ts
var PAYMENT_PROOF_BUCKET = "payment-proofs";
var PAYMENT_PROOF_MAX_BYTES = 5 * 1024 * 1024;
var PAYMENT_PROOF_MAX_LABEL = `${PAYMENT_PROOF_MAX_BYTES / (1024 * 1024)} MB`;
var PAYMENT_PROOF_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp"
];
var PAYMENT_QR_BUCKET = "payment-qr";
var PAYMENT_QR_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];
var PAYMENT_QR_MAX_BYTES = 2 * 1024 * 1024;
var PAYMENT_QR_MAX_LABEL = `${PAYMENT_QR_MAX_BYTES / (1024 * 1024)} MB`;
var PAYMENT_STATUS_PENDING = "PENDING_VERIFICATION";
var PAYABLE_BOOKING_STATUSES = ["PAYMENT_PENDING", "PENDING_VERIFICATION"];
var TRANSACTION_REFERENCE_PATTERN = /^[A-Za-z0-9_-]+$/;
var TRANSACTION_REFERENCE_MIN = 4;
var TRANSACTION_REFERENCE_MAX = 64;
function normaliseTransactionReference(raw) {
  if (typeof raw !== "string") {
    return { ok: false, message: "Enter the transaction UTR / reference ID from your payment receipt." };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, message: "Enter the transaction UTR / reference ID from your payment receipt." };
  }
  if (trimmed.length < TRANSACTION_REFERENCE_MIN) {
    return { ok: false, message: `That reference is too short. Use the full reference from your receipt (at least ${TRANSACTION_REFERENCE_MIN} characters).` };
  }
  if (trimmed.length > TRANSACTION_REFERENCE_MAX) {
    return { ok: false, message: `That reference is too long. A UTR / reference ID is at most ${TRANSACTION_REFERENCE_MAX} characters.` };
  }
  if (!TRANSACTION_REFERENCE_PATTERN.test(trimmed)) {
    return { ok: false, message: "Use only letters, numbers, hyphens and underscores \u2014 copy the reference exactly as it appears on your receipt." };
  }
  return { ok: true, value: trimmed };
}
function validateProofFile(file) {
  if (!file) {
    return { ok: false, message: "Select your payment screenshot." };
  }
  if (file.size <= 0) {
    return { ok: false, message: "That file is empty. Select the screenshot you took of your payment receipt." };
  }
  if (!PAYMENT_PROOF_MIME_TYPES.includes(file.type)) {
    return { ok: false, message: "Please upload a PNG, JPG, or WebP image." };
  }
  if (file.size > PAYMENT_PROOF_MAX_BYTES) {
    return {
      ok: false,
      message: `This screenshot is larger than the supported limit. Please upload an image smaller than ${PAYMENT_PROOF_MAX_LABEL}.`
    };
  }
  return { ok: true, value: file };
}
function isPayableBookingStatus(status) {
  return typeof status === "string" && PAYABLE_BOOKING_STATUSES.includes(status);
}

// src/lib/refundCompletion.ts
var REFUND_METHODS = ["UPI", "BANK_TRANSFER"];
var refundMethodLabel = (method) => method === "BANK_TRANSFER" ? "Bank transfer" : "UPI";
var REFUND_PROOF_MAX_BYTES = PAYMENT_PROOF_MAX_BYTES;
var REFUND_PROOF_MAX_LABEL = `${REFUND_PROOF_MAX_BYTES / (1024 * 1024)} MB`;
var REFUND_PROOF_PATH_PREFIX = "refunds";
function normaliseRefundMethod(raw) {
  if (typeof raw !== "string") {
    return { ok: false, message: "Choose how the refund was sent." };
  }
  const trimmed = raw.trim().toUpperCase();
  if (!REFUND_METHODS.includes(trimmed)) {
    return { ok: false, message: "Choose either UPI or bank transfer." };
  }
  return { ok: true, value: trimmed };
}
function normaliseRefundReference(raw) {
  return normaliseTransactionReference(raw);
}
function toPaise(amountInr) {
  return Math.round(amountInr * 100);
}
function normaliseRefundAmount(rawAmountInr, originalAmountInr) {
  if (typeof rawAmountInr !== "number" || !Number.isFinite(rawAmountInr)) {
    return { ok: false, message: "Enter the refund amount as a number." };
  }
  if (rawAmountInr <= 0) {
    return { ok: false, message: "The refund amount must be more than zero." };
  }
  const refundPaise = toPaise(rawAmountInr);
  const originalPaise = toPaise(Number(originalAmountInr ?? 0));
  if (!Number.isSafeInteger(refundPaise) || refundPaise <= 0) {
    return { ok: false, message: "The refund amount must be more than zero." };
  }
  if (refundPaise > originalPaise) {
    return {
      ok: false,
      message: `The refund amount cannot be more than the ${formatInrLabel(originalAmountInr)} that was paid.`
    };
  }
  if (refundPaise !== originalPaise) {
    return {
      ok: false,
      message: `Only a full refund of ${formatInrLabel(originalAmountInr)} is supported for this payment.`
    };
  }
  return { ok: true, value: refundPaise / 100 };
}
function formatInrLabel(amountInr) {
  const value = Number(amountInr ?? 0);
  return `\u20B9${(Number.isFinite(value) ? value : 0).toLocaleString("en-IN")}`;
}
function validateRefundProofFile(file) {
  if (!file) {
    return { ok: false, message: "Attach the refund receipt as proof." };
  }
  if (file.size <= 0) {
    return { ok: false, message: "That file is empty." };
  }
  if (!PAYMENT_PROOF_MIME_TYPES.includes(file.type)) {
    return { ok: false, message: "Upload a PNG, JPG, or WebP image." };
  }
  if (file.size > REFUND_PROOF_MAX_BYTES) {
    return { ok: false, message: `That image is larger than ${REFUND_PROOF_MAX_LABEL}.` };
  }
  return { ok: true, value: file };
}
function isRefundProofPathFor(paymentId, path2) {
  if (typeof path2 !== "string" || !path2) return false;
  if (path2.length > 300) return false;
  if (path2.includes("..") || path2.includes("\\")) return false;
  const segments = path2.split("/");
  const prefix = [REFUND_PROOF_PATH_PREFIX, paymentId];
  if (segments.length !== prefix.length + 1) return false;
  if (segments[0] !== prefix[0] || segments[1] !== prefix[1]) return false;
  return segments[2].length > 0;
}
function canProcessManualRefund(payment) {
  return (payment.gateway ?? "manual") === "manual" && payment.status === "VERIFIED" && payment.refundStatus === "PENDING" && payment.manualRefundRequired === true;
}
function refundNotice(kind, input = {}) {
  const amount = typeof input.amountInr === "number" && Number.isFinite(input.amountInr) ? input.amountInr : null;
  const amountLabel = amount === null ? null : formatInrLabel(amount);
  const codeSuffix = input.bookingCode ? ` for booking ${input.bookingCode}` : "";
  const subject = amountLabel ? `Your ${amountLabel} refund${codeSuffix}` : `Your refund${codeSuffix}`;
  switch (kind) {
    case "MANUAL_PENDING":
      return {
        title: "Refund Pending",
        message: `${subject} is pending admin processing. You will be notified once the refund is completed.`,
        eventType: "REFUND_PENDING"
      };
    case "GATEWAY_PENDING":
      return {
        title: "Refund Pending",
        message: `${subject} is pending processing. You will be notified once the refund is confirmed.`,
        eventType: "REFUND_PENDING"
      };
    case "COMPLETED": {
      const method = input.refundMethod ? ` It was sent by ${refundMethodLabel(input.refundMethod).toLowerCase()}.` : "";
      const reference = input.refundReference ? ` Reference: ${input.refundReference}.` : "";
      return {
        title: "Refund Completed",
        message: `${subject} has been completed.${method}${reference}`,
        eventType: "REFUND_COMPLETED"
      };
    }
    case "FAILED":
      return {
        title: "Refund Failed",
        message: `${subject} could not be completed. Our team is looking into it and will update you here.`,
        eventType: "REFUND_FAILED"
      };
  }
}

// src/lib/razorpayConfig.ts
function getRazorpayKeyId() {
  return (process.env.RAZORPAY_KEY_ID ?? "").trim();
}
function getRazorpayKeySecret() {
  return (process.env.RAZORPAY_KEY_SECRET ?? "").trim();
}
function getRazorpayWebhookSecret() {
  return (process.env.RAZORPAY_WEBHOOK_SECRET ?? "").trim();
}
function isRazorpayConfigured() {
  return Boolean(getRazorpayKeyId() && getRazorpayKeySecret() && getRazorpayWebhookSecret());
}
function isRazorpayEnabled() {
  return String(process.env.RAZORPAY_ENABLED ?? "").trim().toLowerCase() === "true";
}
var RAZORPAY_CURRENCY = "INR";
function getRazorpayApiBase() {
  return (process.env.RAZORPAY_API_BASE ?? "https://api.razorpay.com/v1").trim();
}
var RAZORPAY_ORDER_EXPIRY_SECONDS = APP_CONFIG.HOLD_DURATION_MS / 1e3;
var RAZORPAY_GATEWAY = "razorpay";
var RAZORPAY_WEBHOOK_EVENTS = {
  payment_captured: "payment.captured",
  payment_failed: "payment.failed",
  payment_authorized: "payment.authorized",
  order_paid: "order.paid",
  refund_created: "refund.created",
  refund_processed: "refund.processed",
  refund_failed: "refund.failed"
};

// src/lib/razorpaySignature.ts
var import_crypto4 = require("crypto");
var RAZORPAY_SIGNATURE_ALGORITHM = "sha256";
function computeRazorpaySignature(payload, secret) {
  return (0, import_crypto4.createHmac)(RAZORPAY_SIGNATURE_ALGORITHM, secret).update(payload).digest("hex");
}
function verifyRazorpaySignature(payload, suppliedSignature, secret) {
  if (typeof payload !== "string" || typeof suppliedSignature !== "string" || !secret) {
    return false;
  }
  if (suppliedSignature.length === 0) return false;
  const expected = computeRazorpaySignature(payload, secret);
  if (expected.length !== suppliedSignature.length) return false;
  try {
    return (0, import_crypto4.timingSafeEqual)(Buffer.from(expected, "utf8"), Buffer.from(suppliedSignature, "utf8"));
  } catch {
    return false;
  }
}
function verifyPaymentSignature(input) {
  const secret = input.secret ?? getRazorpayKeySecret();
  if (!secret) return false;
  const payload = `${input.orderId}|${input.paymentId}`;
  return verifyRazorpaySignature(payload, input.signature, secret);
}
function verifyWebhookSignature(input) {
  const secret = input.secret ?? getRazorpayWebhookSecret();
  if (!secret) return false;
  return verifyRazorpaySignature(input.body, input.signature, secret);
}
function extractWebhookSignature(headers) {
  if (!headers || typeof headers !== "object") return null;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "x-razorpay-signature" && typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

// src/lib/razorpayService.ts
function createRazorpayGatewayClient(options = {}) {
  const doFetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const base = getRazorpayApiBase();
  const basicAuth = () => `Basic ${Buffer.from(`${getRazorpayKeyId()}:${getRazorpayKeySecret()}`).toString("base64")}`;
  const request = async (path2, init) => {
    let res;
    try {
      res = await doFetch(`${base}${path2}`, {
        ...init,
        headers: { "Content-Type": "application/json", Authorization: basicAuth(), ...init.headers ?? {} }
      });
    } catch (networkErr) {
      return { ok: false, reason: "gateway_unreachable" };
    }
    if (!res.ok) return { ok: false, reason: `gateway_status_${res.status}` };
    try {
      return { ok: true, data: await res.json() };
    } catch {
      return { ok: false, reason: "gateway_bad_response" };
    }
  };
  return {
    async createOrder(input) {
      const result = await request("/orders", {
        method: "POST",
        body: JSON.stringify({
          amount: input.amountPaise,
          currency: input.currency,
          receipt: input.receipt,
          notes: input.notes,
          payment_capture: 1
        })
      });
      if (!result.ok) return result;
      if (typeof result.data?.id !== "string" || !result.data.id) {
        return { ok: false, reason: "gateway_bad_response" };
      }
      return { ok: true, order: result.data };
    },
    async fetchPayment(paymentId) {
      const result = await request(`/payments/${encodeURIComponent(paymentId)}`, {
        method: "GET"
      });
      if (!result.ok) return result;
      const raw = result.data ?? {};
      return {
        ok: true,
        payment: {
          id: String(raw.id ?? ""),
          order_id: String(raw.order_id ?? ""),
          amount: Number(raw.amount ?? 0),
          currency: String(raw.currency ?? ""),
          status: String(raw.status ?? ""),
          captured: raw.captured === true,
          method: typeof raw.method === "string" ? raw.method : void 0,
          error_code: typeof raw.error_code === "string" ? raw.error_code : null,
          error_description: typeof raw.error_description === "string" ? raw.error_description : null
        }
      };
    },
    async createRefund(input) {
      const result = await request(`/payments/${encodeURIComponent(input.paymentId)}/refund`, {
        method: "POST",
        body: JSON.stringify({
          amount: input.amountPaise,
          notes: input.notes ?? {},
          receipt: input.receipt
        })
      });
      if (!result.ok) return result;
      if (typeof result.data?.id !== "string" || !result.data.id) {
        return { ok: false, reason: "gateway_bad_response" };
      }
      return { ok: true, refund: result.data };
    }
  };
}
var fail = (httpStatus, code, message) => ({ httpStatus, code, message });
function assertRazorpayUsable() {
  if (!isRazorpayEnabled()) {
    return fail(503, "RAZORPAY_DISABLED", "Online payment is not available right now. Please use the payment details provided.");
  }
  if (!isRazorpayConfigured()) {
    return fail(503, "RAZORPAY_NOT_CONFIGURED", "Online payment is temporarily unavailable. Please use the payment details provided.");
  }
  return null;
}
function toPaise2(amountInr) {
  return Math.round(amountInr * 100);
}
var isPositiveAmount = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
function evaluateHoldValidity(hold, nowMs) {
  if (!hold) return "VALID";
  if (hold.status !== "ACTIVE" && hold.status !== "CONVERTED") return "NOT_ACTIVE";
  const expiresAt = new Date(hold.expires_at).getTime();
  if (Number.isFinite(expiresAt) && expiresAt <= nowMs) return "ELAPSED";
  return "VALID";
}
async function assertHoldStillValid(store, booking, nowMs) {
  if (!booking.hold_id) return null;
  const validity = evaluateHoldValidity(await store.getHold(booking.hold_id), nowMs);
  if (validity === "VALID") return null;
  return fail(409, "HOLD_EXPIRED", "Your payment window for this slot has expired. Please book the slot again.");
}
async function readHoldValidity(store, booking, nowMs) {
  if (!booking.hold_id) return "VALID";
  return evaluateHoldValidity(await store.getHold(booking.hold_id), nowMs);
}
async function runCreateRazorpayOrder(input) {
  const gate = assertRazorpayUsable();
  if (gate) return { ok: false, error: gate };
  const now = input.now ?? /* @__PURE__ */ new Date();
  const nowIso = now.toISOString();
  const booking = await input.store.getBooking(input.bookingId);
  if (!booking) return { ok: false, error: fail(404, "BOOKING_NOT_FOUND", "Booking not found.") };
  if (booking.seeker_id !== input.callerId) {
    return { ok: false, error: fail(403, "FORBIDDEN_NOT_BOOKING_OWNER", "You are not authorized to pay for this booking.") };
  }
  if (!isPayableBookingStatus(booking.status)) {
    return {
      ok: false,
      error: fail(409, "BOOKING_NOT_PAYABLE", `This booking is ${booking.status.replace(/_/g, " ").toLowerCase()} and no longer accepts payment.`)
    };
  }
  if (Number.isFinite(new Date(booking.start_time).getTime()) && new Date(booking.start_time).getTime() <= now.getTime()) {
    return { ok: false, error: fail(409, "SLOT_ALREADY_STARTED", "This session has already started and can no longer be paid for.") };
  }
  const holdFailure = await assertHoldStillValid(input.store, booking, now.getTime());
  if (holdFailure) return { ok: false, error: holdFailure };
  if (!isPositiveAmount(booking.amount_inr)) {
    return { ok: false, error: fail(409, "AMOUNT_UNAVAILABLE", "This booking does not have a payable amount.") };
  }
  const amountPaise = toPaise2(booking.amount_inr);
  const existing = await input.store.getPaymentByBookingId(booking.id);
  const retryOf = existing && existing.gateway === RAZORPAY_GATEWAY && existing.status === "FAILED" && existing.refund_status === null ? existing : null;
  if (existing && !retryOf) {
    if (existing.status === "VERIFIED") {
      return { ok: false, error: fail(409, "PAYMENT_ALREADY_COMPLETED", "This booking has already been paid.") };
    }
    if (existing.gateway === RAZORPAY_GATEWAY && existing.razorpay_order_id && existing.status === "PAYMENT_PROCESSING") {
      return {
        ok: true,
        value: {
          razorpayOrderId: existing.razorpay_order_id,
          razorpayKeyId: getRazorpayKeyId(),
          amountInr: existing.amount_inr,
          currency: RAZORPAY_CURRENCY,
          paymentId: existing.id,
          bookingId: booking.id,
          alreadyCreated: true
        }
      };
    }
    return {
      ok: false,
      error: fail(409, "PAYMENT_ALREADY_IN_PROGRESS", "A payment for this booking is already being processed.")
    };
  }
  const created = await input.gateway.createOrder({
    amountPaise,
    currency: RAZORPAY_CURRENCY,
    receipt: `booking_${booking.booking_code}`,
    notes: { booking_id: booking.id, seeker_id: booking.seeker_id, mentor_id: booking.mentor_id },
    expiresInSeconds: RAZORPAY_ORDER_EXPIRY_SECONDS
  });
  if (!created.ok) {
    console.error("Razorpay order creation failed:", created.reason);
    return { ok: false, error: fail(502, "RAZORPAY_ORDER_FAILED", "We could not start the payment. Please try again.") };
  }
  const payment = retryOf ? await input.store.rearmFailedGatewayPayment({ paymentId: retryOf.id, orderId: created.order.id, at: nowIso }) : await input.store.attachGatewayOrder({
    bookingId: booking.id,
    seekerId: booking.seeker_id,
    amountInr: booking.amount_inr,
    orderId: created.order.id,
    at: nowIso
  });
  if (!payment) {
    return {
      ok: false,
      error: fail(409, "PAYMENT_ALREADY_IN_PROGRESS", "A payment for this booking is already being processed.")
    };
  }
  await input.store.insertPaymentEvent({
    paymentId: payment.id,
    status: "PAYMENT_PROCESSING",
    // A retry is recorded distinctly, so the audit trail shows that this order
    // followed a failed attempt rather than being the first one.
    eventType: retryOf ? "GATEWAY_ORDER_RETRIED" : "GATEWAY_ORDER_CREATED",
    gateway: RAZORPAY_GATEWAY,
    gatewayPaymentId: created.order.id,
    amountInr: booking.amount_inr,
    reason: retryOf ? "Retried after an earlier failed payment attempt." : null,
    actorId: input.callerId,
    at: nowIso
  });
  return {
    ok: true,
    value: {
      razorpayOrderId: created.order.id,
      razorpayKeyId: getRazorpayKeyId(),
      amountInr: booking.amount_inr,
      currency: RAZORPAY_CURRENCY,
      paymentId: payment.id,
      bookingId: booking.id,
      alreadyCreated: false
    }
  };
}
var asNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
function isBookingPaymentDeadEnd(status) {
  if (status === null) return true;
  return status === "CANCELLED" || status === "REJECTED";
}
async function recoverCaptureAgainstDeadBooking(store, payment, args, bookingStatus, cause = "BOOKING_CLOSED") {
  const reason = cause === "HOLD_EXPIRED" ? `Payment ${args.gatewayPaymentId} was captured after the payment hold expired${bookingStatus ? ` (booking is ${bookingStatus})` : ""}; a refund is owed.` : bookingStatus ? `Payment ${args.gatewayPaymentId} was captured after the booking was ${bookingStatus}; a refund is owed.` : `Payment ${args.gatewayPaymentId} was captured after the booking no longer exists; a refund is owed.`;
  const marked = await store.markPaymentRefundPending({
    paymentId: payment.id,
    gatewayPaymentId: args.gatewayPaymentId,
    reason,
    at: args.capturedAt
  });
  if (marked) {
    await store.insertPaymentEvent({
      paymentId: payment.id,
      status: "FAILED",
      eventType: cause === "HOLD_EXPIRED" ? "CAPTURE_AFTER_HOLD_EXPIRED" : "CAPTURE_AFTER_BOOKING_CLOSED",
      gateway: RAZORPAY_GATEWAY,
      gatewayPaymentId: args.gatewayPaymentId,
      amountInr: payment.amount_inr,
      reason,
      actorId: null,
      at: args.capturedAt
    });
  }
  return {
    outcome: "refund_pending",
    bookingId: payment.booking_id,
    paymentId: payment.id,
    gatewayPaymentId: args.gatewayPaymentId,
    reason
  };
}
async function applyCapturedPayment(store, payment, args) {
  if (payment.razorpay_payment_id && payment.razorpay_payment_id !== args.gatewayPaymentId) {
    throw new RazorpayConflictError("This booking already has a different payment recorded against it.");
  }
  const booking = await store.getBooking(payment.booking_id);
  if (isBookingPaymentDeadEnd(booking?.status ?? null)) {
    return recoverCaptureAgainstDeadBooking(store, payment, args, booking?.status ?? null);
  }
  if (booking) {
    const holdValidity = await readHoldValidity(store, booking, new Date(args.capturedAt).getTime());
    if (holdValidity !== "VALID") {
      return recoverCaptureAgainstDeadBooking(store, payment, args, booking.status, "HOLD_EXPIRED");
    }
  }
  const newlyCaptured = await store.markPaymentCaptured({
    paymentId: payment.id,
    gatewayPaymentId: args.gatewayPaymentId,
    signature: args.signature,
    capturedAt: args.capturedAt,
    payload: args.payload
  });
  if (newlyCaptured) {
    await store.insertPaymentEvent({
      paymentId: payment.id,
      status: "VERIFIED",
      eventType: "PAYMENT_CAPTURED",
      gateway: RAZORPAY_GATEWAY,
      gatewayPaymentId: args.gatewayPaymentId,
      amountInr: newlyCaptured.amount_inr,
      reason: null,
      actorId: null,
      at: args.capturedAt
    });
    const mentorNotified2 = await store.markBookingMentorPending(newlyCaptured.booking_id, args.capturedAt);
    return { outcome: "captured", mentorNotified: mentorNotified2, duplicate: false };
  }
  const current = await store.getPaymentById(payment.id);
  if (!current) {
    throw new RazorpayConflictError("This payment is no longer in a state that can be confirmed.");
  }
  if (current.status !== "VERIFIED") {
    if (current.status === "FAILED" && current.refund_status === "PENDING" && current.razorpay_payment_id === args.gatewayPaymentId) {
      return {
        outcome: "refund_pending",
        bookingId: current.booking_id,
        paymentId: current.id,
        gatewayPaymentId: args.gatewayPaymentId,
        reason: String(current.failure_reason ?? "A refund is owed for this payment.")
      };
    }
    throw new RazorpayConflictError("This payment is no longer in a state that can be confirmed.");
  }
  if (current.razorpay_payment_id && current.razorpay_payment_id !== args.gatewayPaymentId) {
    throw new RazorpayConflictError("This booking already has a different payment recorded against it.");
  }
  if (!current.razorpay_payment_id) {
    await store.markPaymentAlreadyCaptured({
      paymentId: payment.id,
      gatewayPaymentId: args.gatewayPaymentId,
      capturedAt: args.capturedAt
    });
  }
  const mentorNotified = await store.markBookingMentorPending(current.booking_id, args.capturedAt);
  return { outcome: "captured", mentorNotified, duplicate: true };
}
var RazorpayConflictError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "RazorpayConflictError";
  }
};
async function runVerifyRazorpayPayment(input) {
  const gate = assertRazorpayUsable();
  if (gate) return { ok: false, error: gate };
  const orderId = asNonEmptyString(input.razorpayOrderId);
  const paymentId = asNonEmptyString(input.razorpayPaymentId);
  const signature = asNonEmptyString(input.razorpaySignature);
  if (!orderId || !paymentId || !signature) {
    return { ok: false, error: fail(400, "VALIDATION_ERROR", "The payment details sent were incomplete.") };
  }
  const booking = await input.store.getBooking(input.bookingId);
  if (!booking) return { ok: false, error: fail(404, "BOOKING_NOT_FOUND", "Booking not found.") };
  if (booking.seeker_id !== input.callerId) {
    return { ok: false, error: fail(403, "FORBIDDEN_NOT_BOOKING_OWNER", "You are not authorized to pay for this booking.") };
  }
  const payment = await input.store.getPaymentByBookingId(booking.id);
  if (!payment) return { ok: false, error: fail(404, "PAYMENT_NOT_FOUND", "No payment has been started for this booking.") };
  if (payment.gateway !== RAZORPAY_GATEWAY) {
    return { ok: false, error: fail(409, "PAYMENT_NOT_GATEWAY", "This booking is not being paid through online payment.") };
  }
  if (!payment.razorpay_order_id || payment.razorpay_order_id !== orderId) {
    return { ok: false, error: fail(409, "RAZORPAY_ORDER_MISMATCH", "This payment does not match the order created for this booking.") };
  }
  if (!verifyPaymentSignature({ orderId, paymentId, signature })) {
    return { ok: false, error: fail(400, "RAZORPAY_SIGNATURE_INVALID", "We could not verify this payment. Please try again.") };
  }
  const now = input.now ?? /* @__PURE__ */ new Date();
  const nowIso = now.toISOString();
  let gatewayPayload = null;
  const fetched = await input.gateway.fetchPayment(paymentId);
  if (fetched.ok) {
    const expectedPaise = toPaise2(payment.amount_inr);
    if (fetched.payment.amount !== expectedPaise || fetched.payment.currency?.toUpperCase() !== RAZORPAY_CURRENCY) {
      await recordCaptureMismatch(input.store, payment, fetched.payment, nowIso);
      return { ok: false, error: fail(409, "RAZORPAY_AMOUNT_MISMATCH", "The payment amount does not match this booking.") };
    }
    if (!fetched.payment.captured && fetched.payment.status !== "captured") {
      await input.store.insertPaymentEvent({
        paymentId: payment.id,
        status: payment.status,
        eventType: "PAYMENT_NOT_CAPTURED",
        gateway: RAZORPAY_GATEWAY,
        gatewayPaymentId: paymentId,
        amountInr: payment.amount_inr,
        reason: fetched.payment.error_description ?? "Payment is authorized but not captured.",
        actorId: input.callerId,
        at: nowIso
      });
      return { ok: false, error: fail(409, "PAYMENT_NOT_CAPTURED", "This payment is not complete yet.") };
    }
    gatewayPayload = fetched.payment;
  }
  try {
    const outcome = await applyCapturedPayment(input.store, payment, {
      gatewayPaymentId: paymentId,
      signature,
      capturedAt: nowIso,
      payload: gatewayPayload
    });
    if (outcome.outcome === "refund_pending") {
      return {
        ok: false,
        error: fail(409, "BOOKING_CLOSED_REFUND_PENDING", "This booking is no longer active, so your payment is being refunded.")
      };
    }
    return {
      ok: true,
      value: {
        paymentId: payment.id,
        bookingId: payment.booking_id,
        bookingStatus: "MENTOR_PENDING",
        paymentStatus: "VERIFIED",
        mentorNotified: outcome.mentorNotified,
        duplicate: outcome.duplicate
      }
    };
  } catch (err) {
    if (err instanceof RazorpayConflictError) {
      return { ok: false, error: fail(409, "PAYMENT_STATE_CONFLICT", err.message) };
    }
    throw err;
  }
}
async function runCreateRazorpayRefund(input) {
  const now = input.now ?? /* @__PURE__ */ new Date();
  const nowIso = now.toISOString();
  const booking = await input.store.getBooking(input.bookingId);
  if (!booking) return { ok: false, error: fail(404, "BOOKING_NOT_FOUND", "Booking not found.") };
  const payment = await input.store.getPaymentByBookingId(booking.id);
  if (!payment) return { ok: false, error: fail(404, "PAYMENT_NOT_FOUND", "No payment found for this booking.") };
  if (payment.status !== "VERIFIED") {
    return { ok: false, error: fail(409, "PAYMENT_NOT_VERIFIED", "This payment has not been captured and cannot be refunded.") };
  }
  if (payment.refund_status === "REFUNDED") {
    return { ok: false, error: fail(409, "ALREADY_REFUNDED", "This payment has already been refunded.") };
  }
  if (payment.refund_status === "PENDING" && payment.refund_id) {
    return { ok: false, error: fail(409, "REFUND_ALREADY_INITIATED", "A refund has already been initiated for this payment.") };
  }
  if (payment.gateway === RAZORPAY_GATEWAY) {
    const gate = assertRazorpayUsable();
    if (gate) return { ok: false, error: gate };
    if (!payment.razorpay_payment_id) {
      return { ok: false, error: fail(409, "NO_GATEWAY_PAYMENT_ID", "This payment does not have a gateway payment ID.") };
    }
    const amountPaise = toPaise2(payment.amount_inr);
    const receipt = `refund_${payment.id.slice(0, 8)}_${Date.now()}`;
    const refundResult = await input.gateway.createRefund({
      paymentId: payment.razorpay_payment_id,
      amountPaise,
      receipt,
      notes: {
        booking_id: booking.id,
        booking_code: booking.booking_code,
        reason: input.reason,
        initiated_by: input.callerId
      }
    });
    if (!refundResult.ok) {
      await input.store.insertPaymentEvent({
        paymentId: payment.id,
        status: payment.status,
        eventType: "REFUND_FAILED",
        gateway: RAZORPAY_GATEWAY,
        gatewayPaymentId: payment.razorpay_payment_id,
        amountInr: payment.amount_inr,
        reason: `Refund creation failed: ${refundResult.reason}`,
        actorId: input.callerId,
        at: nowIso
      });
      return { ok: false, error: fail(503, "REFUND_CREATION_FAILED", `Failed to initiate refund: ${refundResult.reason}`) };
    }
    const refund = refundResult.refund;
    const updatedPayment = await input.store.markRefundInitiated({
      paymentId: payment.id,
      refundId: refund.id,
      amountPaise: refund.amount,
      reason: input.reason,
      at: nowIso
    });
    if (!updatedPayment) {
      return { ok: false, error: fail(409, "REFUND_ALREADY_INITIATED", "A refund has already been initiated for this payment.") };
    }
    await input.store.insertPaymentEvent({
      paymentId: payment.id,
      status: payment.status,
      eventType: "REFUND_INITIATED",
      gateway: RAZORPAY_GATEWAY,
      gatewayPaymentId: payment.razorpay_payment_id,
      amountInr: payment.amount_inr,
      reason: `Refund initiated: ${input.reason}`,
      actorId: input.callerId,
      at: nowIso
    });
    return {
      ok: true,
      value: {
        refundId: refund.id,
        paymentId: payment.id,
        bookingId: booking.id,
        amountInr: payment.amount_inr,
        status: "REFUND_INITIATED",
        message: "Refund has been initiated. The amount will be credited back to the original payment method."
      }
    };
  } else if (payment.gateway === "manual") {
    const updatedPayment = await input.store.markManualRefundRequired({
      paymentId: payment.id,
      reason: input.reason,
      at: nowIso
    });
    if (!updatedPayment) {
      return { ok: false, error: fail(409, "MANUAL_REFUND_ALREADY_REQUIRED", "This manual payment is already marked for admin refund.") };
    }
    await input.store.insertPaymentEvent({
      paymentId: payment.id,
      status: payment.status,
      eventType: "MANUAL_REFUND_REQUIRED",
      gateway: "manual",
      gatewayPaymentId: null,
      amountInr: payment.amount_inr,
      reason: `Manual refund required: ${input.reason}`,
      actorId: input.callerId,
      at: nowIso
    });
    return {
      ok: true,
      value: {
        refundId: "",
        paymentId: payment.id,
        bookingId: booking.id,
        amountInr: payment.amount_inr,
        status: "MANUAL_REFUND_REQUIRED",
        message: "This is a manual payment. The refund has been queued for admin processing."
      }
    };
  }
  return { ok: false, error: fail(400, "UNSUPPORTED_GATEWAY", "Refunds are not supported for this payment method.") };
}
async function recordCaptureMismatch(store, payment, gatewayPayment, at) {
  await store.insertPaymentEvent({
    paymentId: payment.id,
    status: payment.status,
    eventType: "PAYMENT_AMOUNT_MISMATCH",
    gateway: RAZORPAY_GATEWAY,
    gatewayPaymentId: gatewayPayment.id,
    amountInr: payment.amount_inr,
    reason: `Gateway reported ${gatewayPayment.currency} ${gatewayPayment.amount} against a booking of INR ${toPaise2(payment.amount_inr)}.`,
    actorId: null,
    at
  });
}
function parseRazorpayWebhookEvent(rawBody) {
  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const root = parsed;
  const eventType = typeof root.event === "string" ? root.event : "";
  if (!eventType) return null;
  const payloadNode = root.payload && typeof root.payload === "object" ? root.payload : {};
  const readEntity = (key) => {
    const node = payloadNode[key];
    return node && typeof node === "object" ? node : null;
  };
  const payment = readEntity("payment");
  const order = readEntity("order");
  const refund = readEntity("refund");
  const gatewayPaymentId = payment && typeof payment.id === "string" ? payment.id : null;
  const gatewayOrderId = (order && typeof order.id === "string" ? order.id : null) ?? (payment && typeof payment.order_id === "string" ? payment.order_id : null) ?? (refund && typeof refund.order_id === "string" ? refund.order_id : null);
  const refundId = refund && typeof refund.id === "string" ? refund.id : null;
  const amountSource = payment ?? order ?? refund;
  const amount = amountSource && typeof amountSource.amount === "number" ? amountSource.amount : null;
  const currency = amountSource && typeof amountSource.currency === "string" ? amountSource.currency : null;
  const status = amountSource && typeof amountSource.status === "string" ? amountSource.status : null;
  const rawCreatedAt = payment && typeof payment.created_at === "number" ? payment.created_at : null;
  const capturedAtMs = rawCreatedAt !== null && Number.isFinite(rawCreatedAt) && rawCreatedAt > 0 ? rawCreatedAt * 1e3 : null;
  const headerEventId = typeof root.event_id === "string" ? root.event_id : null;
  const eventId = headerEventId ?? `${eventType}:${gatewayPaymentId ?? refundId ?? gatewayOrderId ?? "unknown"}`;
  return {
    eventType,
    eventId,
    gatewayPaymentId,
    gatewayOrderId,
    amount,
    currency,
    status,
    refundId,
    capturedAt: capturedAtMs,
    payload: root
  };
}
async function runRazorpayWebhook(input) {
  if (!isRazorpayEnabled()) {
    return { ok: false, error: fail(503, "RAZORPAY_DISABLED", "Online payment is not available.") };
  }
  const webhookSecret = getRazorpayWebhookSecret();
  if (!webhookSecret) {
    return { ok: false, error: fail(503, "RAZORPAY_NOT_CONFIGURED", "Online payment is temporarily unavailable.") };
  }
  if (!input.signature) {
    return { ok: false, error: fail(400, "RAZORPAY_SIGNATURE_MISSING", "Missing signature.") };
  }
  if (!verifyWebhookSignature({ body: input.rawBody, signature: input.signature })) {
    return { ok: false, error: fail(400, "RAZORPAY_SIGNATURE_INVALID", "Invalid signature.") };
  }
  const event = parseRazorpayWebhookEvent(input.rawBody);
  if (!event) {
    return { ok: false, error: fail(400, "RAZORPAY_WEBHOOK_MALFORMED", "Malformed webhook payload.") };
  }
  const now = input.now ?? /* @__PURE__ */ new Date();
  const nowIso = now.toISOString();
  const claim = await input.store.claimWebhookEvent({
    eventId: event.eventId,
    eventType: event.eventType,
    payload: event.payload,
    at: nowIso
  });
  if (claim === "duplicate") {
    return { ok: true, duplicateEvent: true, handled: "duplicate", bookingId: null, paymentId: null, mentorNotified: false };
  }
  try {
    const result = await dispatchWebhookEvent(input, event, nowIso);
    if (result.unmatched) {
      console.error(
        `Razorpay ${event.eventType} capture is unmatched (${result.unmatched.reason}); recorded for reconciliation and left unacknowledged so the gateway retries.`
      );
      return {
        ok: false,
        error: fail(
          503,
          "RAZORPAY_CAPTURE_UNMATCHED",
          "A captured payment could not be matched to a local payment and has been recorded for reconciliation."
        ),
        outcome: result,
        unmatchedCapture: result.unmatched
      };
    }
    await input.store.completeWebhookEvent(event.eventId, nowIso);
    return { ok: true, duplicateEvent: claim === "resume", ...result };
  } catch (err) {
    console.error("Razorpay webhook processing failed:", logSanitizer.safeMessage(err));
    throw err;
  }
}
async function dispatchWebhookEvent(input, event, nowIso) {
  switch (event.eventType) {
    case RAZORPAY_WEBHOOK_EVENTS.payment_captured:
      return handleCaptured(input, event, nowIso);
    case RAZORPAY_WEBHOOK_EVENTS.order_paid:
      return { handled: "order_paid", bookingId: null, paymentId: null, mentorNotified: false };
    case RAZORPAY_WEBHOOK_EVENTS.payment_failed:
      return handleFailed(input, event, nowIso);
    case RAZORPAY_WEBHOOK_EVENTS.refund_created:
      return handleRefund(input, event, "PENDING");
    case RAZORPAY_WEBHOOK_EVENTS.refund_processed:
      return handleRefund(input, event, "REFUNDED");
    case RAZORPAY_WEBHOOK_EVENTS.refund_failed:
      return handleRefund(input, event, "FAILED");
    default:
      return { handled: "ignored", bookingId: null, paymentId: null, mentorNotified: false };
  }
}
async function resolveWebhookPayment(store, event) {
  if (event.gatewayPaymentId) {
    const byPayment = await store.getPaymentByGatewayPaymentId(event.gatewayPaymentId);
    if (byPayment) return byPayment;
  }
  if (event.gatewayOrderId) {
    const byOrder = await store.getPaymentByOrderId(event.gatewayOrderId);
    if (byOrder) return byOrder;
  }
  return null;
}
async function recordUnmatchedCapture(store, event, nowIso) {
  if (!event.gatewayPaymentId) return null;
  return store.recordUnmatchedCapture({
    eventId: event.eventId,
    eventType: event.eventType,
    gatewayPaymentId: event.gatewayPaymentId,
    gatewayOrderId: event.gatewayOrderId,
    amountPaise: isStorablePaise(event.amount) ? event.amount : null,
    currency: event.currency,
    receivedAt: nowIso,
    reason: "PAYMENT_ROW_NOT_FOUND",
    // The original delivery, retained verbatim for later reconciliation. It is
    // never logged and never returned to a browser.
    payload: event.payload
  });
}
function isStorablePaise(value) {
  return typeof value === "number" && Number.isSafeInteger(value);
}
async function handleCaptured(input, event, nowIso) {
  const payment = await resolveWebhookPayment(input.store, event);
  if (!payment) {
    const recorded = await recordUnmatchedCapture(input.store, event, nowIso);
    if (!recorded) {
      return {
        handled: "unattributable",
        bookingId: null,
        paymentId: null,
        mentorNotified: false,
        unmatched: {
          recorded: false,
          reason: "MISSING_PAYMENT_ID",
          gatewayPaymentId: null,
          detail: "The capture carried no Razorpay payment id, so it cannot be identified or reconciled."
        }
      };
    }
    return {
      handled: "unmatched",
      bookingId: null,
      paymentId: null,
      mentorNotified: false,
      unmatched: {
        recorded: true,
        reason: "PAYMENT_ROW_NOT_FOUND",
        gatewayPaymentId: event.gatewayPaymentId ?? null,
        unmatchedCaptureId: recorded.row.id,
        deliveryCount: recorded.row.delivery_count,
        created: recorded.created,
        detail: "A captured payment could not be matched to a local payment row. The capture has been recorded for operator reconciliation."
      }
    };
  }
  if (!event.gatewayPaymentId) {
    return { handled: "unattributable", bookingId: payment.booking_id, paymentId: null, mentorNotified: false };
  }
  if (event.amount !== null && event.amount !== toPaise2(payment.amount_inr)) {
    await input.store.insertPaymentEvent({
      paymentId: payment.id,
      status: payment.status,
      eventType: "PAYMENT_AMOUNT_MISMATCH",
      gateway: RAZORPAY_GATEWAY,
      gatewayPaymentId: event.gatewayPaymentId,
      amountInr: payment.amount_inr,
      reason: `Webhook reported ${event.currency ?? "unknown"} ${event.amount} against a booking of INR ${toPaise2(payment.amount_inr)}.`,
      actorId: null,
      at: nowIso
    });
    return { handled: "amount_mismatch", bookingId: payment.booking_id, paymentId: payment.id, mentorNotified: false };
  }
  const capturedAt = event.capturedAt !== null ? new Date(event.capturedAt).toISOString() : nowIso;
  const outcome = await applyCapturedPayment(input.store, payment, {
    gatewayPaymentId: event.gatewayPaymentId,
    signature: null,
    capturedAt,
    payload: event.payload
  });
  if (outcome.outcome === "refund_pending") {
    return {
      handled: "refund_pending",
      bookingId: payment.booking_id,
      paymentId: payment.id,
      mentorNotified: false
    };
  }
  return {
    handled: outcome.duplicate ? "captured_duplicate" : "captured",
    bookingId: payment.booking_id,
    paymentId: payment.id,
    mentorNotified: outcome.mentorNotified
  };
}
async function handleFailed(input, event, nowIso) {
  const payment = await resolveWebhookPayment(input.store, event);
  if (!payment) return { handled: "unmatched", bookingId: null, paymentId: null, mentorNotified: false };
  const reason = describeFailure(event);
  const failed = await input.store.markPaymentFailed({ paymentId: payment.id, reason, at: nowIso });
  if (failed) {
    await input.store.insertPaymentEvent({
      paymentId: payment.id,
      status: "FAILED",
      eventType: "PAYMENT_FAILED",
      gateway: RAZORPAY_GATEWAY,
      gatewayPaymentId: event.gatewayPaymentId,
      amountInr: payment.amount_inr,
      reason,
      actorId: null,
      at: nowIso
    });
  }
  return { handled: failed ? "failed" : "failed_duplicate", bookingId: payment.booking_id, paymentId: payment.id, mentorNotified: false };
}
function describeFailure(event) {
  const paymentNode = event.payload?.payload?.payment;
  if (paymentNode && typeof paymentNode === "object") {
    const node = paymentNode;
    if (typeof node.error_description === "string" && node.error_description.trim()) {
      return node.error_description.trim().slice(0, 500);
    }
    if (typeof node.error_code === "string" && node.error_code.trim()) {
      return node.error_code.trim().slice(0, 500);
    }
  }
  return event.status ? `Payment ${String(event.status).toLowerCase()}.` : "The payment could not be completed.";
}
async function handleRefund(input, event, refundStatus) {
  const payment = await resolveWebhookPayment(input.store, event);
  if (!payment || !event.refundId) return { handled: "unmatched", bookingId: null, paymentId: null, mentorNotified: false };
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  if (refundStatus === "PENDING") {
    await input.store.recordRefund({ paymentId: payment.id, refundId: event.refundId, refundStatus: "PENDING", at: nowIso });
    await input.store.insertPaymentEvent({
      paymentId: payment.id,
      status: payment.status,
      eventType: "REFUND_CREATED",
      gateway: RAZORPAY_GATEWAY,
      gatewayPaymentId: event.gatewayPaymentId,
      amountInr: payment.amount_inr,
      reason: "Refund created by gateway",
      actorId: null,
      at: nowIso
    });
    return { handled: "refund_created", bookingId: payment.booking_id, paymentId: payment.id, mentorNotified: false };
  }
  if (refundStatus === "REFUNDED") {
    const updatedPayment = await input.store.markPaymentRefunded({
      paymentId: payment.id,
      refundId: event.refundId,
      amountPaise: event.amount ?? toPaise2(payment.amount_inr),
      reason: "Refund processed by gateway",
      at: nowIso
    });
    if (updatedPayment) {
      await input.store.insertPaymentEvent({
        paymentId: payment.id,
        status: "REFUNDED",
        eventType: "REFUND_PROCESSED",
        gateway: RAZORPAY_GATEWAY,
        gatewayPaymentId: event.gatewayPaymentId,
        amountInr: payment.amount_inr,
        reason: "Refund completed successfully",
        actorId: null,
        at: nowIso
      });
    }
    return { handled: "refund_processed", bookingId: payment.booking_id, paymentId: payment.id, mentorNotified: false };
  }
  if (refundStatus === "FAILED") {
    const updatedPayment = await input.store.markPaymentRefundFailed({
      paymentId: payment.id,
      refundId: event.refundId,
      reason: "Refund failed at gateway",
      at: nowIso
    });
    if (updatedPayment) {
      await input.store.insertPaymentEvent({
        paymentId: payment.id,
        status: "REFUND_FAILED",
        eventType: "REFUND_FAILED",
        gateway: RAZORPAY_GATEWAY,
        gatewayPaymentId: event.gatewayPaymentId,
        amountInr: payment.amount_inr,
        reason: "Refund failed at gateway",
        actorId: null,
        at: nowIso
      });
    }
    return { handled: "refund_failed", bookingId: payment.booking_id, paymentId: payment.id, mentorNotified: false };
  }
  return { handled: "refund_recorded", bookingId: payment.booking_id, paymentId: payment.id, mentorNotified: false };
}
async function reconcileUnmatchedCapture(input) {
  const nowIso = (input.now ?? /* @__PURE__ */ new Date()).toISOString();
  const { store } = input;
  const record = await store.getUnmatchedCaptureById(input.unmatchedCaptureId);
  if (!record) {
    return { status: "NOT_FOUND", reason: "No unmatched-capture record with that id exists." };
  }
  if (record.reconciliation_status === "RESOLVED") {
    return {
      status: "ALREADY_RESOLVED",
      unmatchedCaptureId: record.id,
      resolvedPaymentId: record.resolved_payment_id
    };
  }
  let payment = await store.getPaymentByGatewayPaymentId(record.razorpay_payment_id);
  if (!payment && record.razorpay_order_id) {
    const byOrder = await store.getPaymentByOrderId(record.razorpay_order_id);
    if (byOrder && byOrder.razorpay_payment_id === null) payment = byOrder;
  }
  if (!payment) {
    return {
      status: "STILL_UNMATCHED",
      unmatchedCaptureId: record.id,
      reason: "No local payment row claims this capture yet. It stays pending and the gateway keeps retrying."
    };
  }
  if (payment.gateway !== RAZORPAY_GATEWAY) {
    return flagConflict(
      store,
      record,
      input.actorId,
      nowIso,
      "PAYMENT_NOT_RAZORPAY",
      `Payment ${payment.id} is not a Razorpay payment.`
    );
  }
  if (!["PAYMENT_PROCESSING", "PAYMENT_PENDING"].includes(payment.status)) {
    return flagConflict(
      store,
      record,
      input.actorId,
      nowIso,
      "PAYMENT_NOT_CAPTURABLE",
      `Payment ${payment.id} is ${payment.status} and cannot accept a capture.`
    );
  }
  if (payment.razorpay_payment_id && payment.razorpay_payment_id !== record.razorpay_payment_id) {
    return flagConflict(
      store,
      record,
      input.actorId,
      nowIso,
      "PAYMENT_ALREADY_CAPTURED_ELSEWHERE",
      `Payment ${payment.id} already records captured payment ${payment.razorpay_payment_id}.`
    );
  }
  const expectedPaise = toPaise2(payment.amount_inr);
  if (record.amount_paise !== null && record.amount_paise !== expectedPaise) {
    return flagConflict(
      store,
      record,
      input.actorId,
      nowIso,
      "AMOUNT_MISMATCH",
      `Capture was ${record.amount_paise} paise but payment ${payment.id} is worth ${expectedPaise}.`
    );
  }
  if (record.currency !== null && record.currency !== RAZORPAY_CURRENCY) {
    return flagConflict(
      store,
      record,
      input.actorId,
      nowIso,
      "CURRENCY_MISMATCH",
      `Capture was in ${record.currency}, not ${RAZORPAY_CURRENCY}.`
    );
  }
  let applied;
  try {
    applied = await applyCapturedPayment(
      store,
      payment,
      {
        gatewayPaymentId: record.razorpay_payment_id,
        // The gateway signature is never retained in the ledger, so it is null
        // here. That is safe because the capture was already HMAC-verified when
        // it was recorded, and because the amount above was re-derived from the
        // server, not from this record.
        signature: null,
        capturedAt: record.received_at,
        // The raw payload is deliberately not replayed into `gateway_payload`;
        // it remains in the ledger for audit rather than being copied forward.
        payload: null
      }
    );
  } catch (err) {
    return flagConflict(
      store,
      record,
      input.actorId,
      nowIso,
      "CAPTURE_PATH_CONFLICT",
      logSanitizer.safeMessage(err)
    );
  }
  await store.resolveUnmatchedCapture({
    id: record.id,
    status: "RESOLVED",
    resolvedPaymentId: payment.id,
    note: `Reconciled to payment ${payment.id} (${applied.outcome}).`,
    actorId: input.actorId,
    at: nowIso
  });
  return {
    status: "APPLIED",
    unmatchedCaptureId: record.id,
    paymentId: payment.id,
    bookingId: payment.booking_id,
    outcome: applied.outcome,
    mentorNotified: "mentorNotified" in applied ? applied.mentorNotified : false
  };
}
async function flagConflict(store, record, actorId, at, reason, detail) {
  await store.resolveUnmatchedCapture({
    id: record.id,
    status: "CONFLICT",
    resolvedPaymentId: null,
    note: `${reason}: ${detail}`.slice(0, 500),
    actorId,
    at
  });
  return { status: "CONFLICT", unmatchedCaptureId: record.id, reason, detail };
}
async function listUnmatchedCaptures(store, input = {}) {
  return store.listUnmatchedCaptures({ limit: Math.min(Math.max(input.limit ?? 50, 1), 200) });
}

// src/lib/razorpayStore.ts
var BOOKING_COLUMNS = "id, booking_code, seeker_id, mentor_id, amount_inr, status, start_time, hold_id";
var PAYMENT_COLUMNS = "id, booking_id, seeker_id, amount_inr, status, gateway, razorpay_order_id, razorpay_payment_id, razorpay_signature, captured_at, failure_reason, refund_id, refund_status, refund_amount_paise, refunded_at, refund_reason, manual_refund_required";
var readBooking = (row) => {
  if (!row || typeof row.id !== "string") return null;
  return {
    id: row.id,
    booking_code: String(row.booking_code ?? ""),
    seeker_id: String(row.seeker_id ?? ""),
    mentor_id: String(row.mentor_id ?? ""),
    amount_inr: Number(row.amount_inr ?? 0),
    status: String(row.status ?? ""),
    start_time: String(row.start_time ?? ""),
    hold_id: row.hold_id ?? null
  };
};
var readPayment = (row) => {
  if (!row || typeof row.id !== "string") return null;
  return {
    id: row.id,
    booking_id: String(row.booking_id ?? ""),
    seeker_id: String(row.seeker_id ?? ""),
    amount_inr: Number(row.amount_inr ?? 0),
    status: String(row.status ?? ""),
    gateway: row.gateway ?? null,
    razorpay_order_id: row.razorpay_order_id ?? null,
    razorpay_payment_id: row.razorpay_payment_id ?? null,
    razorpay_signature: row.razorpay_signature ?? null,
    captured_at: row.captured_at ?? null,
    failure_reason: row.failure_reason ?? null,
    refund_id: row.refund_id ?? null,
    refund_status: row.refund_status ?? null,
    refund_amount_paise: row.refund_amount_paise === null || row.refund_amount_paise === void 0 ? null : Number(row.refund_amount_paise),
    refunded_at: row.refunded_at ?? null,
    refund_reason: row.refund_reason ?? null,
    manual_refund_required: row.manual_refund_required === true
  };
};
var UNMATCHED_CAPTURE_TABLE = "razorpay_unmatched_captures";
var UNMATCHED_CAPTURE_COLUMNS = [
  "id",
  "gateway",
  "event_id",
  "last_event_id",
  "event_type",
  "razorpay_payment_id",
  "razorpay_order_id",
  "amount_paise",
  "currency",
  "received_at",
  "reason",
  "reconciliation_status",
  "delivery_count",
  "resolved_payment_id",
  "resolution_note",
  "created_at",
  "updated_at"
].join(", ");
var readUnmatchedCapture = (row) => {
  if (!row || typeof row !== "object" || typeof row.id !== "string") return null;
  const id = String(row.id);
  return {
    id,
    gateway: String(row.gateway ?? "razorpay"),
    event_id: String(row.event_id ?? ""),
    last_event_id: row.last_event_id ?? null,
    event_type: String(row.event_type ?? ""),
    razorpay_payment_id: String(row.razorpay_payment_id ?? ""),
    razorpay_order_id: row.razorpay_order_id ?? null,
    amount_paise: row.amount_paise === null || row.amount_paise === void 0 ? null : Number(row.amount_paise),
    currency: row.currency ?? null,
    received_at: String(row.received_at ?? ""),
    reason: String(row.reason ?? "PAYMENT_ROW_NOT_FOUND"),
    reconciliation_status: String(
      row.reconciliation_status ?? "PENDING"
    ),
    delivery_count: Number(row.delivery_count ?? 1),
    last_received_at: row.last_received_at ?? null,
    resolved_payment_id: row.resolved_payment_id ?? null,
    resolution_note: row.resolution_note ?? null,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? "")
  };
};
async function readUnmatchedCaptureByPaymentId(admin, gatewayPaymentId) {
  const { data, error } = await admin.from(UNMATCHED_CAPTURE_TABLE).select(UNMATCHED_CAPTURE_COLUMNS).eq("gateway", RAZORPAY_GATEWAY).eq("razorpay_payment_id", gatewayPaymentId).maybeSingle();
  if (error) throw error;
  return readUnmatchedCapture(data);
}
function createSupabaseRazorpayStore(admin) {
  return {
    async getBooking(bookingId) {
      const { data, error } = await admin.from("bookings").select(BOOKING_COLUMNS).eq("id", bookingId).maybeSingle();
      if (error) throw error;
      return readBooking(data);
    },
    async getHold(holdId) {
      const { data, error } = await admin.from("slot_holds").select("id, status, expires_at").eq("id", holdId).maybeSingle();
      if (error) throw error;
      const row = data;
      if (!row || typeof row.id !== "string") return null;
      return { id: row.id, status: String(row.status ?? ""), expires_at: String(row.expires_at ?? "") };
    },
    async getPaymentById(paymentId) {
      const { data, error } = await admin.from("payments").select(PAYMENT_COLUMNS).eq("id", paymentId).maybeSingle();
      if (error) throw error;
      return readPayment(data);
    },
    async getPaymentByBookingId(bookingId) {
      const { data, error } = await admin.from("payments").select(PAYMENT_COLUMNS).eq("booking_id", bookingId).maybeSingle();
      if (error) throw error;
      return readPayment(data);
    },
    async getPaymentByOrderId(orderId) {
      const { data, error } = await admin.from("payments").select(PAYMENT_COLUMNS).eq("razorpay_order_id", orderId).maybeSingle();
      if (error) throw error;
      return readPayment(data);
    },
    async getPaymentByGatewayPaymentId(gatewayPaymentId) {
      const { data, error } = await admin.from("payments").select(PAYMENT_COLUMNS).eq("razorpay_payment_id", gatewayPaymentId).maybeSingle();
      if (error) throw error;
      return readPayment(data);
    },
    async attachGatewayOrder({ bookingId, seekerId, amountInr, orderId, at }) {
      const { data, error } = await admin.from("payments").insert({
        booking_id: bookingId,
        seeker_id: seekerId,
        // Server-derived snapshot, matching the manual flow exactly.
        amount_inr: amountInr,
        gateway: RAZORPAY_GATEWAY,
        status: "PAYMENT_PROCESSING",
        razorpay_order_id: orderId,
        razorpay_payment_id: null,
        razorpay_signature: null,
        captured_at: null,
        failure_reason: null,
        // A gateway payment has no uploaded screenshot.
        proof_storage_path: null,
        transaction_reference: null,
        rejection_reason: null,
        verified_by: null,
        verified_at: null,
        updated_at: at
      }).select(PAYMENT_COLUMNS).single();
      if (error) {
        if (error.code === "23505") return null;
        throw error;
      }
      return readPayment(data);
    },
    async rearmFailedGatewayPayment({ paymentId, orderId, at }) {
      const { data, error } = await admin.from("payments").update({
        status: "PAYMENT_PROCESSING",
        razorpay_order_id: orderId,
        razorpay_payment_id: null,
        razorpay_signature: null,
        captured_at: null,
        failure_reason: null,
        gateway_payload: null,
        refund_id: null,
        refund_status: null,
        updated_at: at
      }).eq("id", paymentId).eq("status", "FAILED").eq("gateway", RAZORPAY_GATEWAY).select(PAYMENT_COLUMNS).maybeSingle();
      if (error) throw error;
      return readPayment(data);
    },
    async markPaymentRefundPending({ paymentId, gatewayPaymentId, reason, at }) {
      const { data, error } = await admin.from("payments").update({
        status: "FAILED",
        razorpay_payment_id: gatewayPaymentId,
        refund_status: "PENDING",
        failure_reason: reason.slice(0, 500),
        updated_at: at
      }).eq("id", paymentId).in("status", ["PAYMENT_PROCESSING", "PAYMENT_PENDING"]).select(PAYMENT_COLUMNS).maybeSingle();
      if (error) throw error;
      return readPayment(data);
    },
    async markPaymentCaptured({ paymentId, gatewayPaymentId, signature, capturedAt, payload }) {
      const { data, error } = await admin.from("payments").update({
        status: "VERIFIED",
        razorpay_payment_id: gatewayPaymentId,
        razorpay_signature: signature,
        captured_at: capturedAt,
        verified_at: capturedAt,
        failure_reason: null,
        gateway_payload: payload,
        updated_at: capturedAt
      }).eq("id", paymentId).eq("status", "PAYMENT_PROCESSING").select(PAYMENT_COLUMNS).maybeSingle();
      if (error) throw error;
      return readPayment(data);
    },
    async markPaymentAlreadyCaptured({ paymentId, gatewayPaymentId, capturedAt }) {
      const { data, error } = await admin.from("payments").update({
        razorpay_payment_id: gatewayPaymentId,
        captured_at: capturedAt,
        verified_at: capturedAt,
        updated_at: capturedAt
      }).eq("id", paymentId).eq("status", "VERIFIED").is("razorpay_payment_id", null).select(PAYMENT_COLUMNS).maybeSingle();
      if (error) throw error;
      return readPayment(data);
    },
    async markPaymentFailed({ paymentId, reason, at }) {
      const { data, error } = await admin.from("payments").update({ status: "FAILED", failure_reason: reason.slice(0, 500), updated_at: at }).eq("id", paymentId).in("status", ["PAYMENT_PROCESSING", "PAYMENT_PENDING"]).select(PAYMENT_COLUMNS).maybeSingle();
      if (error) throw error;
      return readPayment(data);
    },
    async markBookingMentorPending(bookingId, at) {
      const { data, error } = await admin.from("bookings").update({ status: "MENTOR_PENDING", updated_at: at }).eq("id", bookingId).in("status", ["PAYMENT_PENDING", "PAYMENT_PROCESSING"]).select("id").maybeSingle();
      if (error) throw error;
      return !!data;
    },
    async recordRefund({ paymentId, refundId, refundStatus, at }) {
      const bookkeeping = { refund_id: refundId, refund_status: refundStatus, updated_at: at };
      if (refundStatus === "PENDING") {
        const { data: data2, error: error2 } = await admin.from("payments").update(bookkeeping).eq("id", paymentId).select("id").maybeSingle();
        if (error2) throw error2;
        return !!data2;
      }
      const { data, error } = await admin.from("payments").update({
        ...bookkeeping,
        status: refundStatus === "REFUNDED" ? "REFUNDED" : "REFUND_FAILED"
      }).eq("id", paymentId).eq("status", "VERIFIED").select("id").maybeSingle();
      if (error) throw error;
      return !!data;
    },
    async markRefundInitiated({ paymentId, refundId, amountPaise, reason, at }) {
      const { data, error } = await admin.from("payments").update({
        refund_id: refundId,
        refund_status: "PENDING",
        refund_amount_paise: amountPaise,
        refund_reason: reason,
        updated_at: at
      }).eq("id", paymentId).eq("status", "VERIFIED").select(PAYMENT_COLUMNS).maybeSingle();
      if (error) throw error;
      return readPayment(data);
    },
    async markPaymentRefunded({ paymentId, refundId, amountPaise, reason, at }) {
      const { data, error } = await admin.from("payments").update({
        status: "REFUNDED",
        refund_id: refundId,
        refund_status: "REFUNDED",
        refund_amount_paise: amountPaise,
        refund_reason: reason,
        refunded_at: at,
        updated_at: at
      }).eq("id", paymentId).eq("status", "VERIFIED").select(PAYMENT_COLUMNS).maybeSingle();
      if (error) throw error;
      return readPayment(data);
    },
    async markPaymentRefundFailed({ paymentId, refundId, reason, at }) {
      const { data, error } = await admin.from("payments").update({
        status: "REFUND_FAILED",
        refund_id: refundId,
        refund_status: "FAILED",
        refund_reason: reason,
        updated_at: at
      }).eq("id", paymentId).eq("status", "VERIFIED").select(PAYMENT_COLUMNS).maybeSingle();
      if (error) throw error;
      return readPayment(data);
    },
    async markManualRefundRequired({ paymentId, reason, at }) {
      const { data, error } = await admin.from("payments").update({
        manual_refund_required: true,
        refund_reason: reason,
        refund_status: "PENDING",
        updated_at: at
      }).eq("id", paymentId).eq("status", "VERIFIED").eq("gateway", "manual").select(PAYMENT_COLUMNS).maybeSingle();
      if (error) throw error;
      return readPayment(data);
    },
    async insertPaymentEvent(event) {
      const { error } = await admin.from("payment_events").insert({
        payment_id: event.paymentId,
        status: event.status,
        event_type: event.eventType,
        gateway: event.gateway,
        gateway_payment_id: event.gatewayPaymentId,
        amount_inr: event.amountInr,
        reason: event.reason,
        created_by: event.actorId,
        created_at: event.at
      });
      if (error) console.error("Failed to record payment event:", error.message);
    },
    async claimWebhookEvent({ eventId, eventType, payload, at }) {
      const { error } = await admin.from("webhook_events").insert({
        gateway: RAZORPAY_GATEWAY,
        event_id: eventId,
        event_type: eventType,
        payload,
        processed: false,
        created_at: at
      });
      if (!error) return "new";
      if (error.code !== "23505") throw error;
      const { data, error: readErr } = await admin.from("webhook_events").select("processed").eq("gateway", RAZORPAY_GATEWAY).eq("event_id", eventId).maybeSingle();
      if (readErr) throw readErr;
      if (!data) return "new";
      return data.processed ? "duplicate" : "resume";
    },
    async completeWebhookEvent(eventId, at) {
      const { error } = await admin.from("webhook_events").update({ processed: true, processed_at: at }).eq("gateway", RAZORPAY_GATEWAY).eq("event_id", eventId);
      if (error) console.error("Failed to mark webhook event processed:", error.message);
    },
    // -----------------------------------------------------------------
    // Unmatched-capture ledger (audit P0-1)
    // -----------------------------------------------------------------
    // Idempotent on `(gateway, razorpay_payment_id)` - the FINANCIAL identity of
    // the exception, not the delivery. `ignoreDuplicates` makes the INSERT a
    // no-op when a record already exists, so a redelivery or a second event id
    // for the same capture can never create a second financial record. The
    // follow-up UPDATE then absorbs that delivery onto the existing row.
    async recordUnmatchedCapture(input) {
      const base = {
        gateway: RAZORPAY_GATEWAY,
        event_id: input.eventId,
        last_event_id: input.eventId,
        event_type: input.eventType,
        razorpay_payment_id: input.gatewayPaymentId,
        razorpay_order_id: input.gatewayOrderId,
        amount_paise: input.amountPaise,
        currency: input.currency,
        received_at: input.receivedAt,
        reason: input.reason,
        payload: input.payload ?? {},
        reconciliation_status: "PENDING",
        last_received_at: input.receivedAt,
        updated_at: input.receivedAt
      };
      const { error: insertError } = await admin.from(UNMATCHED_CAPTURE_TABLE).insert({ ...base, delivery_count: 1 });
      if (insertError && insertError.code !== "23505") {
        throw insertError;
      }
      if (!insertError) {
        const created = await readUnmatchedCaptureByPaymentId(admin, input.gatewayPaymentId);
        if (created) return { row: created, created: true };
        throw new Error("Unmatched capture was inserted but could not be read back.");
      }
      const existing = await readUnmatchedCaptureByPaymentId(admin, input.gatewayPaymentId);
      if (!existing) {
        throw new Error("Unmatched capture conflicted on insert but no record could be read.");
      }
      const { data, error: updateError } = await admin.from(UNMATCHED_CAPTURE_TABLE).update({
        last_event_id: input.eventId,
        last_received_at: input.receivedAt,
        delivery_count: existing.delivery_count + 1,
        updated_at: input.receivedAt
      }).eq("gateway", RAZORPAY_GATEWAY).eq("razorpay_payment_id", input.gatewayPaymentId).select(UNMATCHED_CAPTURE_COLUMNS).maybeSingle();
      if (updateError) throw updateError;
      if (!data) throw new Error("Unmatched capture could not be updated after a duplicate delivery.");
      const row = readUnmatchedCapture(data);
      if (!row) throw new Error("Unmatched capture could not be read after being updated.");
      return { row, created: false };
    },
    async getUnmatchedCaptureById(id) {
      const { data, error } = await admin.from(UNMATCHED_CAPTURE_TABLE).select(UNMATCHED_CAPTURE_COLUMNS).eq("id", id).maybeSingle();
      if (error) throw error;
      return readUnmatchedCapture(data);
    },
    async getUnmatchedCaptureByGatewayPaymentId(gatewayPaymentId) {
      const { data, error } = await admin.from(UNMATCHED_CAPTURE_TABLE).select(UNMATCHED_CAPTURE_COLUMNS).eq("gateway", RAZORPAY_GATEWAY).eq("razorpay_payment_id", gatewayPaymentId).maybeSingle();
      if (error) throw error;
      return readUnmatchedCapture(data);
    },
    async listUnmatchedCaptures({ limit }) {
      const { data, error } = await admin.from(UNMATCHED_CAPTURE_TABLE).select(UNMATCHED_CAPTURE_COLUMNS).neq("reconciliation_status", "RESOLVED").order("received_at", { ascending: true }).limit(limit);
      if (error) throw error;
      return (data ?? []).map((row) => readUnmatchedCapture(row)).filter((row) => row !== null);
    },
    // Conditional on the record still being unresolved, which is what makes a
    // second reconciliation a no-op rather than a second attach.
    async resolveUnmatchedCapture({ id, status, resolvedPaymentId, note, actorId, at }) {
      const { data, error } = await admin.from(UNMATCHED_CAPTURE_TABLE).update({
        reconciliation_status: status,
        resolved_payment_id: resolvedPaymentId,
        resolution_note: note.slice(0, 500),
        resolved_at: at,
        resolved_by: actorId,
        updated_at: at
      }).eq("id", id).neq("reconciliation_status", "RESOLVED").select(UNMATCHED_CAPTURE_COLUMNS).maybeSingle();
      if (error) throw error;
      return readUnmatchedCapture(data);
    }
  };
}

// src/lib/systemHealth.ts
var SLOW_REQUEST_MS = 1e3;
var DASHBOARD_RANGES = {
  "15m": { ms: 15 * 6e4, bucketMs: 6e4 },
  "1h": { ms: 60 * 6e4, bucketMs: 2 * 6e4 },
  "24h": { ms: 24 * 60 * 6e4, bucketMs: 30 * 6e4 },
  "7d": { ms: 7 * 24 * 60 * 6e4, bucketMs: 3 * 60 * 6e4 }
};
var DEFAULT_RANGE = "1h";
function isDashboardRange(value) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(DASHBOARD_RANGES, value);
}
function round1(n) {
  return Math.round(n * 10) / 10;
}
function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(p / 100 * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}
function computeOverview(rows, totalAuditEvents = 0) {
  let successfulRequests = 0;
  let error4xx = 0;
  let error5xx = 0;
  const durations = [];
  let slowRequests = 0;
  for (const row of rows) {
    if (row.category === "api_request") {
      if (row.status_code == null || row.status_code < 400) successfulRequests += 1;
    } else if (row.category === "api_error") {
      if (row.status_code != null && row.status_code >= 500) error5xx += 1;
      else if (row.status_code != null) error4xx += 1;
    }
    if (row.duration_ms != null && row.duration_ms > 0) {
      durations.push(row.duration_ms);
      if (row.duration_ms > SLOW_REQUEST_MS) slowRequests += 1;
    }
  }
  const totalRequests = successfulRequests + error4xx + error5xx;
  return {
    totalRequests,
    successfulRequests,
    error4xx,
    error5xx,
    successRate: totalRequests > 0 ? round1(successfulRequests / totalRequests * 100) : 0,
    errorRate: totalRequests > 0 ? round1((error4xx + error5xx) / totalRequests * 100) : 0,
    averageLatencyMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    p95LatencyMs: percentile(durations, 95),
    slowRequests,
    totalAuditEvents
  };
}
function buildTimeline(rows, rangeMs, bucketMs, now) {
  const windowStart = now - rangeMs;
  const bucketCount = Math.max(1, Math.ceil(rangeMs / bucketMs));
  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    bucket: new Date(windowStart + i * bucketMs).toISOString(),
    requests: 0,
    errors4xx: 0,
    errors5xx: 0,
    latencyMs: null
  }));
  const latencySum = new Array(bucketCount).fill(0);
  const latencyCount = new Array(bucketCount).fill(0);
  for (const row of rows) {
    const t = new Date(row.created_at).getTime();
    if (!Number.isFinite(t) || t < windowStart || t > now) continue;
    const index = Math.min(bucketCount - 1, Math.floor((t - windowStart) / bucketMs));
    if (index < 0) continue;
    if (row.category === "api_request") {
      if (row.status_code == null || row.status_code < 400) buckets[index].requests += 1;
    } else if (row.category === "api_error") {
      buckets[index].requests += 1;
      if (row.status_code != null && row.status_code >= 500) buckets[index].errors5xx += 1;
      else if (row.status_code != null) buckets[index].errors4xx += 1;
    }
    if (row.duration_ms != null && row.duration_ms > 0) {
      latencySum[index] += row.duration_ms;
      latencyCount[index] += 1;
    }
  }
  for (let i = 0; i < bucketCount; i += 1) {
    buckets[i].latencyMs = latencyCount[i] > 0 ? Math.round(latencySum[i] / latencyCount[i]) : null;
  }
  return buckets;
}
var ANOMALY = {
  /** Buckets of history used to form the baseline. */
  baselineBuckets: 12,
  /** current / baseline at or above this ratio is flagged. */
  warningRatio: 2,
  /** current / baseline at or above this ratio is critical. */
  criticalRatio: 3,
  /**
   * A rise smaller than this is noise, not a spike. Without it a baseline of 1
   * rising to 2 would raise a 100% "critical" alert on a perfectly healthy API.
   */
  warningMinDelta: 3,
  /** Latency is compared in milliseconds. */
  latencyWarningMinDelta: 150,
  latencyCriticalMinDelta: 400
};
function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function topErrorEndpoint(rows, fromMs, toMs) {
  const counts = /* @__PURE__ */ new Map();
  for (const row of rows) {
    if (row.category !== "api_error") continue;
    const t = new Date(row.created_at).getTime();
    if (!Number.isFinite(t) || t < fromMs || t > toMs) continue;
    const key = row.path || row.error_code || "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let bestPath = null;
  let bestCount = 0;
  for (const [path2, count] of counts) {
    if (count > bestCount) {
      bestPath = path2;
      bestCount = count;
    }
  }
  return { path: bestPath, count: bestCount };
}
function detectAnomalies(timeline, rows, bucketMs) {
  if (timeline.length < 2) return [];
  const current = timeline[timeline.length - 1];
  const history = timeline.slice(Math.max(0, timeline.length - 1 - ANOMALY.baselineBuckets), timeline.length - 1);
  if (!history.length) return [];
  const windowStartMs = new Date(current.bucket).getTime();
  const windowEndMs = windowStartMs + bucketMs;
  const { path: affectedEndpoint } = topErrorEndpoint(rows, windowStartMs, windowEndMs);
  const specs = [
    { key: "errors5xx", label: "5xx error spike", value: (b) => b.errors5xx, minDelta: ANOMALY.warningMinDelta },
    { key: "errors4xx", label: "4xx error spike", value: (b) => b.errors4xx, minDelta: ANOMALY.warningMinDelta },
    { key: "requests", label: "Request volume spike", value: (b) => b.requests, minDelta: ANOMALY.warningMinDelta },
    { key: "latency", label: "Latency spike", value: (b) => b.latencyMs ?? 0, minDelta: ANOMALY.latencyWarningMinDelta }
  ];
  const anomalies = [];
  for (const spec of specs) {
    const currentValue = spec.value(current);
    const baselineValue = round1(median(history.map(spec.value)));
    if (currentValue - baselineValue < spec.minDelta) continue;
    if (currentValue <= 0) continue;
    const ratio = baselineValue > 0 ? currentValue / baselineValue : Infinity;
    if (ratio < ANOMALY.warningRatio) continue;
    const isCritical = ratio >= ANOMALY.criticalRatio && currentValue - baselineValue >= spec.minDelta * 2 && (spec.key !== "latency" || currentValue - baselineValue >= ANOMALY.latencyCriticalMinDelta);
    anomalies.push({
      id: `${spec.key}-${current.bucket}`,
      severity: isCritical ? "critical" : "warning",
      metric: spec.label,
      metricKey: spec.key,
      currentValue,
      baselineValue,
      percentChange: baselineValue > 0 ? round1((currentValue - baselineValue) / baselineValue * 100) : null,
      firstDetected: current.bucket,
      windowStart: current.bucket,
      windowEnd: new Date(windowEndMs).toISOString(),
      affectedEndpoint: affectedEndpoint ?? null,
      occurrenceCount: currentValue
    });
  }
  return anomalies.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "critical" ? -1 : 1;
    return b.currentValue - a.currentValue;
  });
}
function summariseAuth(rows) {
  const authRows = rows.filter((r) => r.category === "auth");
  const failures = authRows.filter((r) => r.level === "warn" || r.level === "error");
  const successful = authRows.length - failures.length;
  const unauthorizedRequests = rows.filter((r) => r.status_code === 401 || r.status_code === 403).length;
  const byPath = /* @__PURE__ */ new Map();
  for (const row of failures) {
    const key = row.path || "unknown";
    byPath.set(key, (byPath.get(key) ?? 0) + 1);
  }
  let topFailurePath = null;
  let topFailureCount = 0;
  for (const [path2, count] of byPath) {
    if (count > topFailureCount) {
      topFailurePath = path2;
      topFailureCount = count;
    }
  }
  return {
    totalEvents: authRows.length,
    successful,
    failures: failures.length,
    unauthorizedRequests,
    topFailurePath,
    topFailureCount,
    // A real run means several failures concentrated on one endpoint.
    repeatedFailuresDetected: topFailureCount >= 3
  };
}
function groupErrors(rows, limit = 10) {
  const groups = /* @__PURE__ */ new Map();
  const errors = rows.filter((r) => r.category === "api_error").sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  for (const row of errors) {
    const key = `${row.path ?? "unknown"}|${row.status_code ?? "none"}|${row.error_code ?? "none"}`;
    const existing = groups.get(key);
    if (existing) {
      existing.occurrences += 1;
      if (row.created_at < existing.first_seen) existing.first_seen = row.created_at;
      continue;
    }
    groups.set(key, {
      endpoint: row.path,
      status_code: row.status_code,
      error_type: row.error_code,
      occurrences: 1,
      first_seen: row.created_at,
      last_seen: row.created_at,
      request_id: row.request_id ?? ""
    });
  }
  return [...groups.values()].sort((a, b) => b.occurrences - a.occurrences || b.last_seen.localeCompare(a.last_seen)).slice(0, limit);
}
function statusFromCounts(total, critical, warn) {
  if (total === 0) return { status: "unknown", detail: "No requests in the selected window" };
  if (critical > 0) {
    return { status: "critical", detail: `${critical} server error${critical === 1 ? "" : "s"} in the selected window` };
  }
  if (warn > 0) {
    return { status: "degraded", detail: `${warn} client error${warn === 1 ? "" : "s"} in the selected window` };
  }
  return { status: "operational", detail: `${total} requests, no errors` };
}
function summariseServices(overview, rows, dbReachable, auth) {
  const dbErrors = rows.filter((r) => r.category === "db" && r.level === "error").length;
  const storageErrors = rows.filter(
    (r) => r.category === "api_error" && r.status_code != null && r.status_code >= 500 && /storage|bucket|proof|upload/i.test(`${r.path ?? ""} ${r.error_code ?? ""}`)
  ).length;
  const notifErrors = rows.filter(
    (r) => r.category === "api_error" && /notification/i.test(`${r.path ?? ""} ${r.error_code ?? ""}`)
  ).length;
  return {
    api: statusFromCounts(overview.totalRequests, overview.error5xx, overview.error4xx),
    database: {
      status: !dbReachable ? "critical" : dbErrors > 0 ? "degraded" : overview.totalRequests > 0 ? "operational" : "unknown",
      detail: !dbReachable ? "Database is not responding" : dbErrors > 0 ? `${dbErrors} database error${dbErrors === 1 ? "" : "s"} logged` : overview.totalRequests > 0 ? "Serving traffic, no database errors logged" : "No traffic in the selected window"
    },
    authentication: {
      status: auth.totalEvents === 0 ? "unknown" : auth.failures > 0 || auth.unauthorizedRequests > 0 ? "degraded" : "operational",
      detail: auth.totalEvents === 0 ? "No authentication events in the selected window" : `${auth.failures} auth failure${auth.failures === 1 ? "" : "s"}, ${auth.unauthorizedRequests} unauthorized response${auth.unauthorizedRequests === 1 ? "" : "s"}`
    },
    storage: {
      status: storageErrors > 0 ? "critical" : overview.totalRequests > 0 ? "operational" : "unknown",
      detail: storageErrors > 0 ? `${storageErrors} storage operation failure${storageErrors === 1 ? "" : "s"}` : overview.totalRequests > 0 ? "No storage failures logged" : "No traffic in the selected window"
    },
    notifications: {
      status: notifErrors > 0 ? "degraded" : overview.totalRequests > 0 ? "operational" : "unknown",
      detail: notifErrors > 0 ? `${notifErrors} notification operation failure${notifErrors === 1 ? "" : "s"}` : overview.totalRequests > 0 ? "No notification failures logged" : "No traffic in the selected window"
    }
  };
}

// src/lib/adminDashboard.ts
var ADMIN_DASHBOARD_TIMEZONE = APP_CONFIG.DEFAULT_TIMEZONE;
var ADMIN_DASHBOARD_ACTIVITY_LIMIT = 8;
var ADMIN_DASHBOARD_UPCOMING_LIMIT = 6;
var ADMIN_DASHBOARD_RECENT_BOOKING_LIMIT = 5;
var ADMIN_DASHBOARD_EXCEPTION_LIMIT = 8;
var ADMIN_DASHBOARD_SYSTEM_LOG_WINDOW_HOURS = 24;
var MEETING_LINK_DEADLINE_MINUTES2 = APP_CONFIG.MEETING_LINK_DEADLINE_MS / (60 * 1e3) | 0;
var getZonedParts = (date, timeZone) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const parts = formatter.formatToParts(date);
  const read = (type) => {
    const value = parts.find((part) => part.type === type)?.value ?? "0";
    return Number.parseInt(value, 10) || 0;
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    // `en-CA` can render midnight as 24 in some ICU versions.
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second")
  };
};
var getTimeZoneOffsetMs = (date, timeZone) => {
  const parts = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
};
var zonedMidnightUtcMs = (year, month, day, timeZone) => {
  const naive = Date.UTC(year, month - 1, day, 0, 0, 0);
  const firstPass = naive - getTimeZoneOffsetMs(new Date(naive), timeZone);
  return naive - getTimeZoneOffsetMs(new Date(firstPass), timeZone);
};
var getDisplayDayBoundsUtc = (nowUtc, timeZone = ADMIN_DASHBOARD_TIMEZONE) => {
  const { year, month, day } = getZonedParts(nowUtc, timeZone);
  const startMs = zonedMidnightUtcMs(year, month, day, timeZone);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const endMs = zonedMidnightUtcMs(
    nextDay.getUTCFullYear(),
    nextDay.getUTCMonth() + 1,
    nextDay.getUTCDate(),
    timeZone
  );
  return {
    startUtc: new Date(startMs).toISOString(),
    endUtc: new Date(endMs).toISOString()
  };
};
var formatDashboardTime = (isoUtc, timeZone = ADMIN_DASHBOARD_TIMEZONE) => {
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return "\u2014";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  }).format(date);
};
var formatDashboardDateTime = (isoUtc, timeZone = ADMIN_DASHBOARD_TIMEZONE) => {
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return "\u2014";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  }).format(date);
};
var isSameDisplayDay = (isoUtc, nowUtc, timeZone = ADMIN_DASHBOARD_TIMEZONE) => {
  const bounds = getDisplayDayBoundsUtc(nowUtc, timeZone);
  const value = Date.parse(isoUtc);
  return value >= Date.parse(bounds.startUtc) && value < Date.parse(bounds.endUtc);
};
var countDistinctUsersByRole = (rows) => {
  const byRole = /* @__PURE__ */ new Map();
  for (const row of rows) {
    if (!row?.user_id || !row?.role) continue;
    const bucket = byRole.get(row.role) ?? /* @__PURE__ */ new Set();
    bucket.add(row.user_id);
    byRole.set(row.role, bucket);
  }
  const counts = {};
  for (const [role, users] of byRole.entries()) {
    counts[role] = users.size;
  }
  return counts;
};
var selectHighestPrioritySegment = (segments) => {
  if (!segments.length) return null;
  return segments.reduce((best, candidate) => candidate.priority < best.priority ? candidate : best);
};
var buildDashboardExceptions = (candidates, staleHolds, nowUtc, options = {}) => {
  const limit = options.limit ?? ADMIN_DASHBOARD_EXCEPTION_LIMIT;
  const exceptions = [];
  for (const booking of candidates) {
    if (booking.status !== "MENTOR_PENDING") continue;
    if (booking.meeting_url) continue;
    const { deadlineUtc, isOverdue, minutesUntilSession } = calculateMeetingLinkDeadline(
      booking.start_time,
      nowUtc
    );
    const sessionStillUpcoming = Date.parse(booking.start_time) > nowUtc.getTime();
    const code = booking.booking_code ?? null;
    if (isOverdue) {
      exceptions.push({
        id: `overdue-${booking.id}`,
        kind: "MEETING_LINK_OVERDUE",
        severity: "critical",
        title: sessionStillUpcoming ? "Meeting link deadline missed" : "Session reached without a meeting link",
        detail: sessionStillUpcoming ? `No meeting link ${minutesUntilSession}m before session start. The booking is NOT auto-cancelled \u2014 mentor follow-up is required.` : "The session start time has passed while the booking is still MENTOR_PENDING with no meeting link.",
        bookingCode: code,
        bookingId: booking.id,
        startTimeUtc: booking.start_time,
        deadlineUtc,
        href: "/admin/bookings"
      });
      continue;
    }
    exceptions.push({
      id: `due-soon-${booking.id}`,
      kind: "MEETING_LINK_DUE_SOON",
      severity: "warning",
      title: "Meeting link deadline approaching",
      detail: `Due in ${minutesUntilSession}m before session start (recommended ${MEETING_LINK_DEADLINE_MINUTES2}m).`,
      bookingCode: code,
      bookingId: booking.id,
      startTimeUtc: booking.start_time,
      deadlineUtc,
      href: "/admin/bookings"
    });
  }
  for (const hold of staleHolds) {
    exceptions.push({
      id: `stale-hold-${hold.id}`,
      kind: "STALE_SLOT_HOLD",
      severity: "warning",
      title: "Expired slot hold still active",
      detail: "A slot hold is still ACTIVE after its expiry, so the slot stays locked.",
      bookingCode: null,
      bookingId: null,
      startTimeUtc: null,
      deadlineUtc: hold.expires_at,
      href: "/admin/bookings"
    });
  }
  if (options.hasPaymentPendingBookings) {
    exceptions.push({
      id: "payment-pending-bookings",
      kind: "PAYMENT_PENDING_BOOKING",
      severity: "info",
      title: "Bookings awaiting payment",
      detail: "One or more bookings are still in PAYMENT_PENDING and cannot become confirmed sessions.",
      bookingCode: null,
      bookingId: null,
      startTimeUtc: null,
      deadlineUtc: null,
      href: "/admin/bookings"
    });
  }
  const severityRank = { critical: 0, warning: 1, info: 2 };
  return exceptions.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]).slice(0, limit);
};
var isStaleSlotHold = (hold, nowUtc) => hold.status === "ACTIVE" && Date.parse(hold.expires_at) <= nowUtc.getTime();
var dashboardSection = (data) => ({
  status: "ok",
  data,
  error: null
});
var dashboardSectionError = (error) => ({
  status: "error",
  data: null,
  error
});
var formatRelativeAge = (isoUtc, nowUtc) => {
  const value = Date.parse(isoUtc);
  if (Number.isNaN(value)) return "\u2014";
  const diffMs = nowUtc.getTime() - value;
  const future = diffMs < 0;
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 6e4);
  if (minutes < 1) return future ? "in a moment" : "just now";
  if (minutes < 60) return future ? `in ${minutes}m` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return future ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return future ? `in ${days}d` : `${days}d ago`;
};

// src/lib/supabaseErrors.ts
function getErrorMessage(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof error.message === "string") {
    return error.message;
  }
  return "Unexpected error";
}
function describeSupabaseError(error) {
  const message = getErrorMessage(error);
  let code = "UNKNOWN_ERROR";
  let details = null;
  let hint = null;
  let stack;
  if (error instanceof Error) {
    stack = error.stack;
  }
  if (error && typeof error === "object") {
    const candidate = error;
    if (typeof candidate.code === "string" && candidate.code.trim()) {
      code = candidate.code;
    } else if (typeof candidate.code === "number") {
      code = String(candidate.code);
    }
    if (candidate.details !== void 0) details = candidate.details;
    if (typeof candidate.hint === "string") hint = candidate.hint;
  }
  return {
    code,
    message,
    details,
    hint,
    stack,
    isRelationshipAmbiguity: code === "PGRST201" || /more than one relationship/i.test(message)
  };
}
function resolveHttpStatusForSupabaseError(info) {
  switch (info.code) {
    case "42501":
      return 403;
    case "23505":
      return 409;
    case "23503":
    // foreign key violation
    case "23502":
    // not null violation
    case "22P02":
    // invalid text representation (malformed uuid)
    case "23514":
      return 400;
    case "PGRST116":
      return 404;
    default:
      return 500;
  }
}
function primaryRole(roles) {
  if (!roles || roles.length === 0) return void 0;
  if (roles.includes("admin")) return "admin";
  if (roles.includes("mentor")) return "mentor";
  if (roles.includes("seeker")) return "seeker";
  return roles[0];
}
var GENERIC_ERROR_MESSAGE = "An unexpected error occurred";
function respondWithServerError(options) {
  const { req, res, error, clientMessage, code = "SERVER_ERROR", status, context } = options;
  const info = describeSupabaseError(error);
  const httpStatus = status ?? resolveHttpStatusForSupabaseError(info);
  const requestId = req.requestId ?? "";
  void logApiError({
    requestId,
    method: req.method ?? "GET",
    path: req.path ?? "",
    statusCode: httpStatus,
    message: `${context ? `${context} - ` : ""}[${info.code}] ${info.message}`,
    error_code: info.code,
    userId: req.auth?.user?.id,
    role: primaryRole(req.auth?.roles),
    stack: info.stack
  }).catch(() => {
  });
  return res.status(httpStatus).json({
    success: false,
    error: {
      code,
      message: clientMessage,
      requestId: requestId || null
    }
  });
}
function respondWithInternalError(options) {
  const mapped = resolveHttpStatusForSupabaseError(describeSupabaseError(options.error));
  const isCallerFault = mapped >= 400 && mapped < 500 && mapped !== 404;
  return respondWithServerError({
    ...options,
    clientMessage: GENERIC_ERROR_MESSAGE,
    code: isCallerFault ? "VALIDATION_ERROR" : "SERVER_ERROR",
    status: isCallerFault ? mapped : 500
  });
}
function resolveRequestShapeFailure(err) {
  const candidate = err;
  if (!candidate || typeof candidate !== "object") return null;
  const status = candidate.status ?? candidate.statusCode;
  if (candidate.type === "entity.too.large" || status === 413) {
    return { status: 413, code: "PAYLOAD_TOO_LARGE", message: "The request body is too large." };
  }
  if (candidate.type === "entity.parse.failed" || status === 400) {
    return { status: 400, code: "VALIDATION_ERROR", message: "The request body could not be parsed." };
  }
  if (candidate.type === "encoding.unsupported" || candidate.type === "charset.unsupported" || status === 415) {
    return { status: 415, code: "UNSUPPORTED_MEDIA_TYPE", message: "Unsupported content type or encoding." };
  }
  return null;
}
var terminalErrorHandler = (err, req, res, next) => {
  const isApi = req.path.startsWith("/api/");
  if (!isApi && process.env.NODE_ENV !== "production") {
    next(err);
    return;
  }
  if (res.headersSent) {
    next(err);
    return;
  }
  const shapeFailure = resolveRequestShapeFailure(err);
  if (shapeFailure) {
    const requestId = req.requestId ?? "";
    void logApiError({
      requestId,
      method: req.method ?? "GET",
      path: req.path ?? "",
      statusCode: shapeFailure.status,
      message: `request shape rejected: ${err?.message ?? "unknown"}`,
      error_code: shapeFailure.code,
      userId: req.auth?.user?.id
    }).catch(() => {
    });
    res.status(shapeFailure.status).json({
      success: false,
      error: { code: shapeFailure.code, message: shapeFailure.message, requestId: requestId || null }
    });
    return;
  }
  respondWithInternalError({ req, res, error: err });
};

// src/lib/adminDashboardData.ts
var runSection = async (label, loader) => {
  try {
    return await loader();
  } catch (error) {
    return dashboardSectionError(`${label}: ${getErrorMessage(error)}`);
  }
};
var embeddedField = (value) => {
  if (Array.isArray(value)) return value.length ? value[0] : null;
  return value ?? null;
};
var BOOKING_LIST_COLUMNS = "id, booking_code, status, start_time, end_time, amount_inr, seeker_id, mentor_id, segment:segments(name), gig:gigs(title)";
var UNKNOWN_PARTY_LABEL = "Unknown";
var BOOKING_STATUS_LIST = [
  "PAYMENT_PENDING",
  "PENDING_VERIFICATION",
  "MENTOR_PENDING",
  "CONFIRMED",
  "COMPLETED",
  "CANCELLED",
  "REJECTED"
];
async function getAdminDashboardData(client, options = {}) {
  const now = options.now ?? /* @__PURE__ */ new Date();
  const timeZone = options.timeZone ?? ADMIN_DASHBOARD_TIMEZONE;
  const nowIso = now.toISOString();
  const day = getDisplayDayBoundsUtc(now, timeZone);
  const windowStartIso = new Date(
    now.getTime() - ADMIN_DASHBOARD_SYSTEM_LOG_WINDOW_HOURS * 60 * 60 * 1e3
  ).toISOString();
  const usersSection = await runSection("User metrics unavailable", async () => {
    const { data, error } = await client.from("user_roles").select("user_id, role");
    if (error) throw error;
    const rows = data ?? [];
    const counts = countDistinctUsersByRole(rows);
    const distinctUsers = new Set(rows.map((row) => row.user_id)).size;
    const metrics = {
      seekers: counts.seeker ?? 0,
      mentors: counts.mentor ?? 0,
      admins: counts.admin ?? 0,
      distinctUsers
    };
    return dashboardSection(metrics);
  });
  const mentorsSection = await runSection("Mentor metrics unavailable", async () => {
    const [totalRes, approvedRes, pendingRes, inactiveRes, activeApprovedRes, applicationsRes] = await Promise.all([
      client.from("mentor_profiles").select("id", { count: "exact", head: true }),
      client.from("mentor_profiles").select("id", { count: "exact", head: true }).eq("is_approved", true),
      client.from("mentor_profiles").select("id", { count: "exact", head: true }).eq("approval_status", "pending_review"),
      client.from("mentor_profiles").select("id", { count: "exact", head: true }).eq("is_active", false),
      client.from("mentor_profiles").select("id", { count: "exact", head: true }).eq("is_approved", true).eq("is_active", true),
      client.from("mentor_applications").select("id", { count: "exact", head: true }).eq("status", "pending_review")
    ]);
    const firstError = totalRes.error ?? approvedRes.error ?? pendingRes.error ?? inactiveRes.error ?? activeApprovedRes.error ?? applicationsRes.error;
    if (firstError) throw firstError;
    const metrics = {
      totalProfiles: totalRes.count ?? 0,
      approved: approvedRes.count ?? 0,
      pendingReview: pendingRes.count ?? 0,
      inactive: inactiveRes.count ?? 0,
      activeAndApproved: activeApprovedRes.count ?? 0,
      pendingApplications: applicationsRes.count ?? 0
    };
    return dashboardSection(metrics);
  });
  const segmentsSection = await runSection("Segment metrics unavailable", async () => {
    const [activeRes, totalRes, rowsRes] = await Promise.all([
      client.from("segments").select("id", { count: "exact", head: true }).eq("is_active", true),
      client.from("segments").select("id", { count: "exact", head: true }),
      client.from("segments").select("id, name, slug, priority").eq("is_active", true).order("priority", { ascending: true }).limit(12)
    ]);
    const firstError = activeRes.error ?? totalRes.error ?? rowsRes.error;
    if (firstError) throw firstError;
    const active = rowsRes.data ?? [];
    const metrics = {
      totalCount: totalRes.count ?? 0,
      activeCount: activeRes.count ?? 0,
      highestPriority: selectHighestPrioritySegment(active),
      active
    };
    return dashboardSection(metrics);
  });
  const paymentsSection = await runSection("Payment metrics unavailable", async () => {
    const [pendingRes, verifiedRes, rejectedRes, todayRes] = await Promise.all([
      client.from("payments").select("id", { count: "exact", head: true }).eq("status", "PENDING_VERIFICATION"),
      client.from("payments").select("id", { count: "exact", head: true }).eq("status", "VERIFIED"),
      client.from("payments").select("id", { count: "exact", head: true }).eq("status", "REJECTED"),
      client.from("payments").select("id", { count: "exact", head: true }).gte("created_at", day.startUtc).lt("created_at", day.endUtc)
    ]);
    const firstError = pendingRes.error ?? verifiedRes.error ?? rejectedRes.error ?? todayRes.error;
    if (firstError) throw firstError;
    const pending = pendingRes.count ?? 0;
    const verified = verifiedRes.count ?? 0;
    const rejected = rejectedRes.count ?? 0;
    const metrics = {
      pending,
      verified,
      rejected,
      total: pending + verified + rejected,
      submittedToday: todayRes.count ?? 0
    };
    return dashboardSection(metrics);
  });
  const bookingsSection = await runSection("Booking metrics unavailable", async () => {
    const [totalRes, upcomingRes, ...statusResults] = await Promise.all([
      client.from("bookings").select("id", { count: "exact", head: true }),
      client.from("bookings").select("id", { count: "exact", head: true }).in("status", ["CONFIRMED", "MENTOR_PENDING"]).gte("start_time", nowIso),
      ...BOOKING_STATUS_LIST.map(
        (status) => client.from("bookings").select("id", { count: "exact", head: true }).eq("status", status)
      ),
      ...BOOKING_STATUS_LIST.map(
        (status) => client.from("bookings").select("id", { count: "exact", head: true }).eq("status", status).gte("start_time", day.startUtc).lt("start_time", day.endUtc)
      )
    ]);
    const firstError = totalRes.error ?? upcomingRes.error ?? statusResults.find((result) => result.error)?.error;
    if (firstError) throw firstError;
    const counts = {};
    const todayByStatus = {};
    BOOKING_STATUS_LIST.forEach((status, index) => {
      counts[status] = statusResults[index].count ?? 0;
      todayByStatus[status] = statusResults[BOOKING_STATUS_LIST.length + index].count ?? 0;
    });
    const metrics = {
      total: totalRes.count ?? 0,
      paymentPending: counts.PAYMENT_PENDING,
      pendingVerification: counts.PENDING_VERIFICATION,
      mentorPending: counts.MENTOR_PENDING,
      confirmed: counts.CONFIRMED,
      completed: counts.COMPLETED,
      cancelled: counts.CANCELLED,
      rejected: counts.REJECTED,
      todayTotal: Object.values(todayByStatus).reduce((sum, value) => sum + value, 0),
      todayByStatus,
      upcomingTotal: upcomingRes.count ?? 0
    };
    return dashboardSection(metrics);
  });
  const [upcomingResult, recentResult, deadlineResult, holdResult] = await Promise.all([
    client.from("bookings").select(BOOKING_LIST_COLUMNS).in("status", ["CONFIRMED", "MENTOR_PENDING"]).gte("start_time", nowIso).order("start_time", { ascending: true }).limit(ADMIN_DASHBOARD_UPCOMING_LIMIT),
    client.from("bookings").select(BOOKING_LIST_COLUMNS).order("created_at", { ascending: false }).limit(ADMIN_DASHBOARD_RECENT_BOOKING_LIMIT),
    client.from("bookings").select("id, booking_code, status, start_time, meeting_url").eq("status", "MENTOR_PENDING").is("meeting_url", null).order("start_time", { ascending: true }).limit(25),
    client.from("slot_holds").select("id, expires_at, status").eq("status", "ACTIVE").limit(50)
  ]);
  const listRows = [
    ...upcomingResult.data ?? [],
    ...recentResult.data ?? []
  ];
  const resolvePartyNames = async () => {
    const ids = Array.from(new Set(listRows.flatMap((row) => [row.seeker_id, row.mentor_id])));
    if (!ids.length) return /* @__PURE__ */ new Map();
    const { data, error } = await client.from("profiles").select("id, full_name").in("id", ids);
    if (error) throw error;
    return new Map(
      (data ?? []).map((row) => [row.id, row.full_name])
    );
  };
  const nameFor = (names, id) => names.get(id) ?? UNKNOWN_PARTY_LABEL;
  const upcomingSessionsSection = await runSection("Upcoming sessions unavailable", async () => {
    if (upcomingResult.error) throw upcomingResult.error;
    const names = await resolvePartyNames();
    const rows = (upcomingResult.data ?? []).map((row) => ({
      id: row.id,
      bookingCode: row.booking_code,
      status: row.status,
      startTimeUtc: row.start_time,
      endTimeUtc: row.end_time,
      seekerName: nameFor(names, row.seeker_id),
      mentorName: nameFor(names, row.mentor_id),
      segmentName: embeddedField(row.segment)?.name ?? null,
      gigTitle: embeddedField(row.gig)?.title ?? null,
      amountInr: row.amount_inr ?? null,
      displayTime: formatDashboardTime(row.start_time, timeZone),
      isToday: isSameDisplayDay(row.start_time, now, timeZone)
    }));
    return dashboardSection(rows);
  });
  const recentBookingsSection = await runSection("Recent bookings unavailable", async () => {
    if (recentResult.error) throw recentResult.error;
    const names = await resolvePartyNames();
    const rows = (recentResult.data ?? []).map((row) => ({
      id: row.id,
      bookingCode: row.booking_code,
      status: row.status,
      startTimeUtc: row.start_time,
      seekerName: nameFor(names, row.seeker_id),
      mentorName: nameFor(names, row.mentor_id),
      segmentName: embeddedField(row.segment)?.name ?? null,
      amountInr: row.amount_inr ?? null,
      displayTime: formatDashboardDateTime(row.start_time, timeZone)
    }));
    return dashboardSection(rows);
  });
  const exceptionsSection = await runSection("Exception checks unavailable", async () => {
    if (deadlineResult.error) throw deadlineResult.error;
    if (holdResult.error) throw holdResult.error;
    const candidates = deadlineResult.data ?? [];
    const holds = holdResult.data ?? [];
    const staleHolds = holds.filter((hold) => isStaleSlotHold(hold, now));
    const exceptions = buildDashboardExceptions(candidates, staleHolds, now, {
      hasPaymentPendingBookings: (bookingsSection.data?.paymentPending ?? 0) > 0
    });
    return dashboardSection(exceptions);
  });
  const actionsSection = await runSection("Action queue unavailable", async () => {
    if (!paymentsSection.data) throw new Error("Payment metrics unavailable");
    if (!mentorsSection.data) throw new Error("Mentor metrics unavailable");
    if (!bookingsSection.data) throw new Error("Booking metrics unavailable");
    if (!exceptionsSection.data) throw new Error("Exception checks unavailable");
    const pendingPayments = paymentsSection.data.pending;
    const pendingMentorApprovals = mentorsSection.data.pendingApplications + mentorsSection.data.pendingReview;
    const mentorPendingBookings = bookingsSection.data.mentorPending;
    const overdueMeetingLinks = exceptionsSection.data.filter(
      (exception) => exception.kind === "MEETING_LINK_OVERDUE"
    ).length;
    const totalActionable = pendingPayments + pendingMentorApprovals + mentorPendingBookings + overdueMeetingLinks;
    return dashboardSection({
      pendingPayments,
      pendingMentorApprovals,
      mentorPendingBookings,
      overdueMeetingLinks,
      totalActionable,
      allQueuesClear: totalActionable === 0
    });
  });
  const recentActivitySection = await runSection("Recent activity unavailable", async () => {
    const { data, error } = await client.from("audit_logs").select("id, action, actor_user_id, actor_role, entity_type, entity_id, created_at").order("created_at", { ascending: false }).limit(ADMIN_DASHBOARD_ACTIVITY_LIMIT);
    if (error) throw error;
    const rows = data ?? [];
    const actorIds = Array.from(
      new Set(rows.map((row) => row.actor_user_id).filter((id) => Boolean(id)))
    );
    let actorNames = /* @__PURE__ */ new Map();
    if (actorIds.length) {
      const { data: actors, error: actorError } = await client.from("profiles").select("id, full_name").in("id", actorIds);
      if (actorError) throw actorError;
      actorNames = new Map(
        (actors ?? []).map((row) => [
          row.id,
          row.full_name
        ])
      );
    }
    const activity = rows.map((row) => ({
      id: row.id,
      action: row.action ?? "UNKNOWN_ACTION",
      actorName: row.actor_user_id ? actorNames.get(row.actor_user_id) ?? "System" : "System",
      actorRole: row.actor_role,
      entityType: row.entity_type,
      entityId: row.entity_id,
      createdAtUtc: row.created_at,
      displayTime: formatDashboardDateTime(row.created_at, timeZone),
      relativeAge: formatRelativeAge(row.created_at, now)
    }));
    return dashboardSection(activity);
  });
  const systemHealthSection = await runSection("System health unavailable", async () => {
    const [requestsRes, errorsRes, serverErrorsRes, auditRes, activeHoldsRes, expiredHoldsRes] = await Promise.all([
      client.from("system_logs").select("id", { count: "exact", head: true }).eq("category", "api_request").gte("created_at", windowStartIso),
      client.from("system_logs").select("id", { count: "exact", head: true }).eq("category", "api_error").gte("created_at", windowStartIso),
      client.from("system_logs").select("id", { count: "exact", head: true }).eq("category", "api_error").gte("status_code", 500).gte("created_at", windowStartIso),
      client.from("audit_logs").select("id", { count: "exact", head: true }).gte("created_at", windowStartIso),
      client.from("slot_holds").select("id", { count: "exact", head: true }).eq("status", "ACTIVE"),
      client.from("slot_holds").select("id", { count: "exact", head: true }).eq("status", "ACTIVE").lte("expires_at", nowIso)
    ]);
    const firstError = requestsRes.error ?? errorsRes.error ?? serverErrorsRes.error ?? auditRes.error ?? activeHoldsRes.error ?? expiredHoldsRes.error;
    if (firstError) throw firstError;
    const requests = requestsRes.count ?? 0;
    const errors = errorsRes.count ?? 0;
    const health = {
      api: {
        requests24h: requests,
        errors24h: errors,
        serverErrors24h: serverErrorsRes.count ?? 0,
        errorRatePercent: requests > 0 ? Number((errors / requests * 100).toFixed(1)) : 0
      },
      database: { sectionsOk: 0, sectionsFailed: 0, status: "ok" },
      bookingEngine: {
        activeHolds: activeHoldsRes.count ?? 0,
        expiredActiveHolds: expiredHoldsRes.count ?? 0
      },
      audit: { events24h: auditRes.count ?? 0 }
    };
    return dashboardSection(health);
  });
  const operationalSections = [
    usersSection,
    mentorsSection,
    segmentsSection,
    paymentsSection,
    bookingsSection,
    actionsSection,
    upcomingSessionsSection,
    recentBookingsSection,
    recentActivitySection,
    exceptionsSection
  ];
  const sectionsOk = operationalSections.filter((section) => section.status === "ok").length;
  const sectionsFailed = operationalSections.length - sectionsOk;
  if (systemHealthSection.data) {
    systemHealthSection.data.database = {
      sectionsOk,
      sectionsFailed,
      status: sectionsFailed === 0 ? "ok" : "degraded"
    };
  }
  return {
    generatedAtUtc: nowIso,
    timezone: timeZone,
    meetingLinkDeadlineMinutes: MEETING_LINK_DEADLINE_MINUTES2,
    users: usersSection,
    mentors: mentorsSection,
    segments: segmentsSection,
    payments: paymentsSection,
    bookings: bookingsSection,
    actions: actionsSection,
    upcomingSessions: upcomingSessionsSection,
    recentBookings: recentBookingsSection,
    recentActivity: recentActivitySection,
    exceptions: exceptionsSection,
    systemHealth: systemHealthSection
  };
}

// src/lib/adminPaymentView.ts
var projectAdminPayment = (p, names = {}) => ({
  id: p.id,
  bookingId: p.booking_id,
  bookingCode: p.booking?.booking_code ?? null,
  bookingStatus: p.booking?.status ?? null,
  seekerName: p.booking?.seeker_id ? names.seekerName ?? null : null,
  mentorName: p.booking?.mentor_id ? names.mentorName ?? null : null,
  gigTitle: p.booking?.gig_id ? names.gigTitle ?? null : null,
  amount: p.amount_inr,
  transactionReference: p.transaction_reference ?? null,
  submittedAt: p.created_at ?? null,
  status: p.status,
  proofUrl: names.proofUrl ?? null,
  rejectionReason: p.rejection_reason ?? null,
  verifiedAt: p.verified_at ?? null,
  // A manual UPI/QR row has no gateway column set at all, so it is reported as
  // 'manual' rather than leaking a null into the UI.
  gateway: p.gateway ?? "manual",
  razorpayOrderId: p.razorpay_order_id ?? null,
  razorpayPaymentId: p.razorpay_payment_id ?? null,
  refundStatus: p.refund_status ?? null,
  refundId: p.refund_id ?? null,
  failureReason: p.failure_reason ?? null,
  refundAmountPaise: p.refund_amount_paise === null || p.refund_amount_paise === void 0 ? null : Number(p.refund_amount_paise),
  refundMethod: p.refund_method ?? null,
  refundReference: p.refund_reference ?? null,
  refundedAt: p.refunded_at ?? null,
  refundedBy: p.refunded_by ?? null,
  refundAdminNote: p.refund_admin_note ?? null
});

// src/lib/topicSlug.ts
function slugifyTopicName(name) {
  return (name || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, "");
}

// src/lib/mentorApplicationsQuery.ts
var MENTOR_APPLICATION_STATUSES = [
  "draft",
  "pending_review",
  "approved",
  "rejected"
];
var DEFAULT_MENTOR_APPLICATION_PAGE_SIZE = 20;
var MAX_MENTOR_APPLICATION_PAGE_SIZE = 100;
var MAX_MENTOR_APPLICATION_PAGE = 1e4;
var MAX_MENTOR_APPLICATION_SEARCH_LENGTH = 120;
function isMentorApplicationStatus(value) {
  return typeof value === "string" && MENTOR_APPLICATION_STATUSES.includes(value);
}
function parseMentorApplicationStatusFilter(value) {
  if (value === "ALL" || value === void 0 || value === null || value === "") return "ALL";
  return isMentorApplicationStatus(value) ? value : "ALL";
}
function sanitizeMentorApplicationSearch(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[,()*%\\'"]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_MENTOR_APPLICATION_SEARCH_LENGTH);
}
function buildProfileSearchFilter(search) {
  return `full_name.ilike.*${search}*,email.ilike.*${search}*`;
}
function parsePositiveInteger(value, fallback, max) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" && typeof raw !== "number") return fallback;
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}
function parseMentorApplicationListQuery(query) {
  const source = query ?? {};
  const status = parseMentorApplicationStatusFilter(source.status);
  const search = sanitizeMentorApplicationSearch(source.search);
  const page = parsePositiveInteger(source.page, 1, MAX_MENTOR_APPLICATION_PAGE);
  const pageSize = parsePositiveInteger(
    source.pageSize,
    DEFAULT_MENTOR_APPLICATION_PAGE_SIZE,
    MAX_MENTOR_APPLICATION_PAGE_SIZE
  );
  const from = (page - 1) * pageSize;
  return { status, search, page, pageSize, from, to: from + pageSize - 1 };
}
function buildMentorApplicationPagination(page, pageSize, total) {
  const safeTotal = Math.max(0, total);
  const totalPages = Math.max(1, Math.ceil(safeTotal / pageSize));
  return {
    page,
    pageSize,
    total: safeTotal,
    totalPages,
    hasPrevious: page > 1,
    hasNext: page < totalPages
  };
}
function emptyMentorApplicationStatusCounts() {
  return { all: 0, draft: 0, pending_review: 0, approved: 0, rejected: 0 };
}

// src/lib/adminCreateUser.ts
var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(value) {
  return typeof value === "string" && EMAIL_PATTERN.test(value.trim());
}
function isValidTimezone(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  const candidate = value.trim();
  if (candidate === "UTC") return true;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return true;
  } catch {
    return false;
  }
}
var PHONE_ALLOWED = /^\+?[\d\s().-]{6,25}$/;
function isValidPhone(value) {
  if (value === void 0 || value === null || value === "") return true;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return true;
  return PHONE_ALLOWED.test(trimmed) && (trimmed.match(/\d/g) || []).length >= 6;
}
var MAX_TAG_LENGTH = 40;
var MAX_TAGS = 12;
function parseTagList(value) {
  if (Array.isArray(value)) {
    return dedupeTags(value.filter((v) => typeof v === "string").map((v) => v.trim()));
  }
  if (typeof value !== "string") return [];
  return dedupeTags(value.split(",").map((tag) => tag.trim()));
}
function dedupeTags(tags) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const tag of tags) {
    if (!tag) continue;
    if (tag.length > MAX_TAG_LENGTH) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out.slice(0, MAX_TAGS);
}
var MIN_PASSWORD_LENGTH = 8;
function isValidPassword(value) {
  return typeof value === "string" && value.length >= MIN_PASSWORD_LENGTH;
}
var MAX_EXPERIENCE_YEARS = 80;
function validateCreateUserForm(values) {
  const errors = {};
  if (!values.fullName.trim()) errors.fullName = "Full name is required.";
  if (!values.email.trim()) {
    errors.email = "Email address is required.";
  } else if (!isValidEmail(values.email)) {
    errors.email = "Enter a valid email address.";
  }
  if (!values.timezone.trim()) {
    errors.timezone = "Timezone is required.";
  } else if (!isValidTimezone(values.timezone)) {
    errors.timezone = "Select a valid timezone.";
  }
  if (!isValidPhone(values.phone)) {
    errors.phone = "Enter a valid phone number or leave it blank.";
  }
  if (values.passwordMode === "manual") {
    if (!values.password) {
      errors.password = "Password is required.";
    } else if (!isValidPassword(values.password)) {
      errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (!values.confirmPassword) {
      errors.confirmPassword = "Confirm the password.";
    } else if (values.confirmPassword !== values.password) {
      errors.confirmPassword = "Passwords do not match.";
    }
  }
  if (values.role === "mentor") {
    const years = values.experienceYears.trim();
    if (years) {
      const parsed = Number(years);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_EXPERIENCE_YEARS) {
        errors.experienceYears = `Years of experience must be a whole number between 0 and ${MAX_EXPERIENCE_YEARS}.`;
      }
    }
    if (values.segmentIds.length === 0) {
      errors.segmentIds = "Select at least one mentorship segment.";
    }
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

// src/lib/rateLimit.ts
var import_express_rate_limit = require("express-rate-limit");
var RATE_LIMIT_MESSAGE = "Too many requests, please wait a moment.";
var RATE_LIMIT_WINDOW_MS = 6e4;
var API_RATE_LIMIT = 120;
var EXPENSIVE_RATE_LIMIT = 10;
function clientRateLimitKey(req, _res) {
  const userId = req.auth?.user?.id;
  if (typeof userId === "string" && userId) return `user:${userId}`;
  return `ip:${(0, import_express_rate_limit.ipKeyGenerator)(req.ip || "")}`;
}
var buildLimiter = (limit) => (0, import_express_rate_limit.rateLimit)({
  windowMs: RATE_LIMIT_WINDOW_MS,
  limit,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: clientRateLimitKey,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: { code: "RATE_LIMITED", message: RATE_LIMIT_MESSAGE }
    });
  }
});
var apiRateLimiter = buildLimiter(API_RATE_LIMIT);
var expensiveRouteLimiter = buildLimiter(EXPENSIVE_RATE_LIMIT);

// src/lib/validation.ts
var import_zod = require("zod");

// src/lib/segmentExperience.ts
var SEGMENT_ICON_KEYS = [
  "sparkles",
  "briefcase",
  "heart",
  "message-circle",
  "graduation-cap",
  "compass",
  "life-buoy",
  "users",
  "calendar",
  "clock",
  "target",
  "book-open",
  "lightbulb",
  "shield-check",
  "star",
  "map",
  "phone",
  "video",
  "globe",
  "brain",
  "heart-handshake",
  "scale",
  "puzzle",
  "mic",
  "pen-line"
];
var SEGMENT_ICON_KEY_SET = new Set(SEGMENT_ICON_KEYS);
var SEGMENT_SECTION_KEYS = [
  "hero",
  "topics",
  "quickHelp",
  "mentors",
  "journey",
  "benefits",
  "guides",
  "stories",
  "faq",
  "cta"
];
var SEGMENT_SECTION_KEY_SET = new Set(SEGMENT_SECTION_KEYS);
function isSafeSegmentUrl(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
function isSafeSegmentLink(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith("/")) return !trimmed.startsWith("//");
  return isSafeSegmentUrl(trimmed);
}

// src/lib/validation.ts
function stripHtmlTags(input) {
  return input.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "").replace(/<([a-zA-Z/!?])(?:[^<>"']|"[^"]*"|'[^']*')*>/g, "").replace(/<[a-zA-Z/!?][^<>]*$/, "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}
var UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var HHMM = /^\d{2}:\d{2}(:\d{2})?$/;
var YMD = /^\d{4}-\d{2}-\d{2}$/;
var SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var ALLOWED_DOCUMENT_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
var ALLOWED_REFUND_PROOF_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
var MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
var ALLOWED_GIG_DURATIONS = [30, 45, 60, 90, 120];
var MAX_AVAILABILITY_RULES = 50;
var MAX_AVAILABILITY_EXCEPTIONS = 200;
var MAX_BIO_LENGTH = 2e3;
var MAX_HEADLINE_LENGTH = 140;
var MAX_TITLE_LENGTH = 200;
var MAX_NAME_LENGTH = 120;
var MAX_SEGMENT_DESCRIPTION_LENGTH = 500;
var MAX_REASON_LENGTH = 500;
var MAX_TAG_LENGTH2 = 40;
var MAX_TAGS2 = 12;
var MAX_EXPERIENCE_YEARS2 = 80;
function text(options) {
  const { min = 0, max, label, multiline = false } = options;
  return import_zod.z.string().transform((value) => {
    const stripped = stripHtmlTags(value).trim();
    return multiline ? stripped.replace(/\r\n/g, "\n") : stripped;
  }).pipe(
    import_zod.z.string().min(min, min === 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`).max(max, `${label} must be ${max} characters or fewer.`)
  );
}
function optionalText(options) {
  return import_zod.z.union([text({ ...options, min: 0 }), import_zod.z.literal("").transform(() => "")]).optional();
}
var emailField = import_zod.z.string().trim().toLowerCase().pipe(import_zod.z.email("Enter a valid email address."));
var blankToUndefined = (value) => typeof value === "string" && value.trim() === "" ? void 0 : value;
var httpUrlField = import_zod.z.string().trim().pipe(import_zod.z.url("Enter a valid URL.")).refine((value) => /^https?:\/\//i.test(value), "Only http and https links are allowed.");
var linkField = import_zod.z.string().trim().refine(
  (value) => isSafeSegmentLink(value),
  "Enter a valid URL: use a path like /mentors, or an http(s) address."
);
var uuidField = import_zod.z.string().trim().pipe(
  import_zod.z.string().regex(UUID_SHAPE, "Enter a valid ID.")
);
var idField = import_zod.z.string().trim().min(1, "This value is required.").max(200, "This value is too long.");
function isValidTimezone2(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  const candidate = value.trim();
  if (candidate === "UTC") return true;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return true;
  } catch {
    return false;
  }
}
var timezoneField = import_zod.z.preprocess(
  blankToUndefined,
  import_zod.z.string().trim().refine(isValidTimezone2, "Select a valid timezone.").optional()
);
var isoDateTimeField = import_zod.z.iso.datetime({ offset: true, message: "Enter a valid date and time." });
var clockTimeField = import_zod.z.string().trim().pipe(import_zod.z.string().regex(HHMM, "Use a HH:MM time, for example 09:30."));
function hasAtLeastOneField(body) {
  return Object.values(body).some((value) => value !== void 0);
}
var tagArray = () => import_zod.z.array(text({ max: MAX_TAG_LENGTH2, label: "Each tag" })).max(MAX_TAGS2, `Use at most ${MAX_TAGS2} tags.`);
var tagListField = tagArray().optional().default([]);
var nullableTagListField = tagArray().nullable().optional().default([]);
var experienceYearsField = import_zod.z.int("Years of experience must be a whole number.").min(0, "Years of experience cannot be negative.").max(MAX_EXPERIENCE_YEARS2, `Years of experience must be ${MAX_EXPERIENCE_YEARS2} or fewer.`);
var gigDurationField = import_zod.z.int("Duration must be a whole number of minutes.").refine(
  (value) => ALLOWED_GIG_DURATIONS.includes(value),
  "Duration must be one of 30, 45, 60, 90 or 120 minutes."
);
var priceField = import_zod.z.number("Price must be a number.").finite("Price must be a number.").min(0, "Price cannot be negative.").max(1e7, "Price is unrealistically high.");
var slugField = import_zod.z.string().trim().toLowerCase().pipe(
  import_zod.z.string().min(1, "Slug is required.").max(60, "Slug must be 60 characters or fewer.").regex(SLUG, "Use lowercase letters, numbers and single hyphens, for example relationship-advisor.")
);
var accountActionField = import_zod.z.enum(["activate", "deactivate", "suspend", "reactivate"], {
  message: "Action must be one of: activate, deactivate, suspend, reactivate."
});
var suspendedUntilField = isoDateTimeField.optional();
var MAX_AVAILABILITY_WINDOW_MINUTES = 12 * 60;
var windowMinutes = (time) => {
  const [hh, mm] = time.split(":").map(Number);
  return (hh || 0) * 60 + (mm || 0);
};
var availabilityRuleSchema = import_zod.z.strictObject({
  dayOfWeek: import_zod.z.int("Day must be a whole number.").min(0, "Day must be between 0 and 6.").max(6, "Day must be between 0 and 6."),
  startTime: clockTimeField,
  endTime: clockTimeField,
  isEnabled: import_zod.z.boolean().optional().default(true)
}).refine((rule) => rule.startTime < rule.endTime, {
  message: "Start time must be earlier than end time.",
  path: ["startTime"]
}).refine(
  (rule) => windowMinutes(rule.endTime) - windowMinutes(rule.startTime) < MAX_AVAILABILITY_WINDOW_MINUTES,
  {
    message: "That time window is 12 hours or longer. Check the start and end times \u2014 a window this long is usually a 1:10 PM / 1:10 AM mix-up.",
    path: ["startTime"]
  }
);
var availabilityExceptionSchema = import_zod.z.strictObject({
  exceptionDate: import_zod.z.string().trim().pipe(import_zod.z.string().regex(YMD, "Use a YYYY-MM-DD date, for example 2026-09-27.")),
  isAvailable: import_zod.z.boolean().optional().default(false),
  startTime: clockTimeField.nullish(),
  endTime: clockTimeField.nullish(),
  reason: optionalText({ max: MAX_REASON_LENGTH, label: "Reason" })
}).refine(
  (exception) => !exception.isAvailable || Boolean(exception.startTime) && Boolean(exception.endTime) && exception.startTime < exception.endTime,
  {
    message: "An available day needs an end time later than its start time.",
    path: ["startTime"]
  }
).refine(
  (exception) => !exception.isAvailable || !exception.startTime || !exception.endTime || windowMinutes(exception.endTime) - windowMinutes(exception.startTime) < MAX_AVAILABILITY_WINDOW_MINUTES,
  {
    message: "That time window is 12 hours or longer. Check the start and end times \u2014 a window this long is usually a 1:10 PM / 1:10 AM mix-up.",
    path: ["startTime"]
  }
);
var availabilitySchema = import_zod.z.strictObject({
  rules: import_zod.z.array(availabilityRuleSchema).max(MAX_AVAILABILITY_RULES, `A mentor may not have more than ${MAX_AVAILABILITY_RULES} recurring windows.`),
  timezone: timezoneField
});
var availabilityExceptionsSchema = import_zod.z.strictObject({
  exceptions: import_zod.z.array(availabilityExceptionSchema).max(MAX_AVAILABILITY_EXCEPTIONS, `A mentor may not have more than ${MAX_AVAILABILITY_EXCEPTIONS} date exceptions.`)
});
var gigTitleField = text({ min: 1, max: MAX_TITLE_LENGTH, label: "Title" });
var gigDescriptionField = optionalText({ max: MAX_BIO_LENGTH, label: "Description", multiline: true });
var gigOriginalPriceField = import_zod.z.union([priceField, import_zod.z.literal("").transform(() => null), import_zod.z.null()]);
var gigCreateShape = {
  title: gigTitleField,
  segmentId: uuidField,
  durationMinutes: gigDurationField,
  priceInr: priceField,
  // `.optional()` is required, not cosmetic: "no original price" is the normal
  // state and an omitted key must mean exactly that. Without it every existing
  // gig-create caller that doesn't send the field is rejected outright.
  originalPriceInr: gigOriginalPriceField.optional(),
  description: gigDescriptionField
};
var gigUpdateShape = {
  title: gigTitleField.optional(),
  durationMinutes: gigDurationField.optional(),
  priceInr: priceField.optional(),
  originalPriceInr: gigOriginalPriceField.optional(),
  description: optionalText({ max: MAX_BIO_LENGTH, label: "Description", multiline: true }),
  isActive: import_zod.z.boolean().optional()
};
var gigUpdateSchema = import_zod.z.strictObject(gigUpdateShape).refine(
  hasAtLeastOneField,
  { message: "No editable fields were provided." }
);
var sectionToggles = import_zod.z.partialRecord(
  import_zod.z.enum(SEGMENT_SECTION_KEYS),
  import_zod.z.strictObject({ enabled: import_zod.z.boolean() })
);
var experienceItemSchema = import_zod.z.strictObject({
  title: text({ max: 80, label: "Title" }),
  description: text({ max: 200, label: "Description", multiline: true }),
  icon: import_zod.z.string().trim().max(40).optional(),
  enabled: import_zod.z.boolean().optional()
});
var segmentNameField = text({ min: 1, max: MAX_NAME_LENGTH, label: "Segment name" });
var segmentDescriptionField = optionalText({
  max: MAX_SEGMENT_DESCRIPTION_LENGTH,
  label: "Description",
  multiline: true
});
var segmentPriorityField = import_zod.z.int().min(0, "Priority cannot be negative.").max(1e4, "Priority is too large.");
var segmentCreateShape = {
  name: segmentNameField,
  slug: slugField,
  priority: segmentPriorityField.optional(),
  isActive: import_zod.z.boolean().optional(),
  description: segmentDescriptionField
};
var segmentUpdateShape = {
  name: segmentNameField.optional(),
  slug: slugField.optional(),
  priority: segmentPriorityField.optional(),
  isActive: import_zod.z.boolean().optional(),
  description: segmentDescriptionField
};
var fullNameField = text({ min: 1, max: MAX_NAME_LENGTH, label: "Full name" });
var phoneField = import_zod.z.string().trim().transform((value) => value ? value : "").pipe(import_zod.z.string().max(25, "Phone number must be 25 characters or fewer.").refine(isValidPhone2, "Enter a valid phone number or leave it blank.")).optional();
function isValidPhone2(value) {
  if (!value) return true;
  if (!/^\+?[\d\s().-]{6,25}$/.test(value)) return false;
  return (value.match(/\d/g) || []).length >= 6;
}
var headlineField = optionalText({ max: MAX_HEADLINE_LENGTH, label: "Headline" });
var bioField = optionalText({ max: MAX_BIO_LENGTH, label: "Bio", multiline: true });
var nextStepItemSchema = import_zod.z.strictObject({
  id: import_zod.z.string().trim().min(1).max(100).optional(),
  text: text({ max: MAX_TITLE_LENGTH, label: "Next step" }),
  due_date: import_zod.z.string().trim().max(60).optional(),
  completed: import_zod.z.boolean().optional()
});
var followUpSchema = import_zod.z.union([
  import_zod.z.strictObject({
    recommended: import_zod.z.boolean(),
    timeframe: text({ min: 1, max: 80, label: "Timeframe" }),
    topic: optionalText({ max: MAX_HEADLINE_LENGTH, label: "Topic" }),
    notes: optionalText({ max: MAX_BIO_LENGTH, label: "Notes", multiline: true })
  }),
  optionalText({ max: MAX_BIO_LENGTH, label: "Follow-up recommendation", multiline: true }),
  import_zod.z.null()
]);
function formatValidationFailure(error) {
  const fields = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_";
    if (!(key in fields)) fields[key] = issue.message;
  }
  const first = error.issues[0];
  return {
    code: "VALIDATION_ERROR",
    message: first ? first.message : "The request was not valid.",
    fields
  };
}
function validateBody(schema) {
  return function validateBodyMiddleware(req, res, next) {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      res.status(400).json({ success: false, error: formatValidationFailure(result.error) });
      return;
    }
    req.body = result.data;
    next();
  };
}
function parseBody(req, res, schema) {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) {
    res.status(400).json({ success: false, error: formatValidationFailure(result.error) });
    return null;
  }
  req.body = result.data;
  return result.data;
}
var couponCodeField = import_zod.z.string().trim().toUpperCase().pipe(
  import_zod.z.string().regex(/^[A-Z0-9_]{4,24}$/, "Use 4 to 24 letters, numbers or underscores.")
);
var couponDiscountValueField = import_zod.z.int("Discount must be a whole number.").min(1, "Discount must be at least 1.").max(1e7, "Discount is unrealistically high.");
var couponUseLimitField = import_zod.z.int("Limit must be a whole number.").min(1, "Limit must be at least 1.").max(1e6, "Limit is unrealistically high.");
var nullablePositiveInt = (label) => import_zod.z.union([couponUseLimitField, import_zod.z.literal("").transform(() => null), import_zod.z.null()]).optional();
var couponShape = {
  code: couponCodeField,
  description: optionalText({ max: 300, label: "Description", multiline: true }),
  discountType: import_zod.z.enum(["PERCENTAGE", "FIXED"], { message: "Choose a percentage or a fixed amount." }),
  discountValue: couponDiscountValueField,
  maxDiscountInr: import_zod.z.union([priceField, import_zod.z.literal("").transform(() => null), import_zod.z.null()]).optional(),
  minOrderAmountInr: priceField.optional().default(0),
  segmentId: import_zod.z.union([uuidField, import_zod.z.literal("").transform(() => null), import_zod.z.null()]).optional(),
  mentorId: import_zod.z.union([uuidField, import_zod.z.literal("").transform(() => null), import_zod.z.null()]).optional(),
  maxTotalUses: nullablePositiveInt("Total use limit"),
  maxUsesPerUser: nullablePositiveInt("Per-user limit"),
  startsAt: isoDateTimeField.optional(),
  expiresAt: import_zod.z.union([isoDateTimeField, import_zod.z.literal("").transform(() => null), import_zod.z.null()]).optional(),
  status: import_zod.z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]).optional().default("ACTIVE")
};
var couponUpdateShape = {
  description: optionalText({ max: 300, label: "Description", multiline: true }),
  discountType: import_zod.z.enum(["PERCENTAGE", "FIXED"], { message: "Choose a percentage or a fixed amount." }).optional(),
  discountValue: couponDiscountValueField.optional(),
  maxDiscountInr: import_zod.z.union([priceField, import_zod.z.literal("").transform(() => null), import_zod.z.null()]).optional(),
  minOrderAmountInr: priceField.optional(),
  segmentId: import_zod.z.union([uuidField, import_zod.z.literal("").transform(() => null), import_zod.z.null()]).optional(),
  mentorId: import_zod.z.union([uuidField, import_zod.z.literal("").transform(() => null), import_zod.z.null()]).optional(),
  maxTotalUses: nullablePositiveInt("Total use limit"),
  maxUsesPerUser: nullablePositiveInt("Per-user limit"),
  startsAt: isoDateTimeField.optional(),
  expiresAt: import_zod.z.union([isoDateTimeField, import_zod.z.literal("").transform(() => null), import_zod.z.null()]).optional()
};
var apiSchemas = {
  // -- auth -----------------------------------------------------------------
  /**
   * The login form posts `{ email, password }`, and the persona buttons post
   * `{ persona }`. Either string can legitimately be blank when the user typed
   * nothing, so both are optional and blank-tolerant; a wrong value still falls
   * through to the handler's 401 rather than being revealed as a 400.
   */
  demoLogin: import_zod.z.strictObject({
    persona: import_zod.z.preprocess(
      blankToUndefined,
      import_zod.z.enum(["seeker", "mentor", "admin"], { message: "Unknown demo persona." }).optional()
    ),
    email: import_zod.z.preprocess(blankToUndefined, emailField.optional()),
    password: import_zod.z.preprocess(
      blankToUndefined,
      import_zod.z.string().min(1, "Password is required.").max(200, "Password is too long.").optional()
    )
  }),
  // -- seeker booking -------------------------------------------------------
  bookingHold: import_zod.z.strictObject({
    mentorId: uuidField,
    segmentId: uuidField,
    gigId: uuidField,
    startTime: isoDateTimeField,
    endTime: isoDateTimeField
  }),
  bookingCancel: import_zod.z.strictObject({
    reason: optionalText({ max: MAX_REASON_LENGTH, label: "Reason", multiline: true })
  }),
  /**
   * Body of `POST /api/seeker/bookings/:id/reschedule`.
   *
   * TIME ONLY. There is no `gigId`, `segmentId` or `mentorId` field, and that
   * omission is the rule: a reschedule may not change who the session is with
   * or what it is for. The server reads all three from the booking row itself,
   * so adding such a field here would be rejected as an unknown key rather than
   * silently ignored.
   */
  bookingReschedule: import_zod.z.strictObject({
    newStartTime: isoDateTimeField,
    newEndTime: isoDateTimeField
  }),
  // -- mentor reschedule decision -------------------------------------------
  /**
   * Body of `POST /api/mentor/reschedule-requests/:id/respond`. `reason` is
   * optional but honoured on both outcomes, so a mentor can tell a seeker why a
   * time did not work without the seeker having to ask.
   */
  rescheduleRespond: import_zod.z.strictObject({
    decision: import_zod.z.enum(["APPROVED", "REJECTED"], { message: "Decision must be APPROVED or REJECTED." }),
    reason: optionalText({ max: MAX_REASON_LENGTH, label: "Reason", multiline: true })
  }),
  // -- mentor ---------------------------------------------------------------
  mentorBookingConfirm: import_zod.z.strictObject({
    meetingUrl: httpUrlField
  }),
  gigCreate: import_zod.z.strictObject(gigCreateShape),
  gigUpdate: gigUpdateSchema,
  segmentApply: import_zod.z.strictObject({
    segmentId: uuidField
  }),
  availability: availabilitySchema,
  availabilityExceptions: availabilityExceptionsSchema,
  mentorApplicationDraft: import_zod.z.strictObject({
    fullName: fullNameField,
    bio: bioField,
    timezone: timezoneField,
    headline: headlineField,
    experienceYears: experienceYearsField.optional(),
    segmentIds: import_zod.z.array(uuidField, { message: "Segment ids must be a list of IDs." }).max(MAX_TAGS2).optional()
  }),
  mentorDocument: import_zod.z.strictObject({
    applicationId: uuidField,
    documentType: import_zod.z.string().trim().min(1, "Document type is required.").max(60, "Document type is too long.").regex(/^[a-z0-9_]+$/i, "Document type must be a code, for example aadhar_front."),
    storagePath: import_zod.z.string().trim().min(1, "Storage path is required.").max(500, "Storage path is too long."),
    originalFilename: import_zod.z.string().trim().min(1, "File name is required.").max(255, "File name is too long."),
    mimeType: import_zod.z.enum(ALLOWED_DOCUMENT_MIME_TYPES, { message: "Upload a JPG, PNG, WEBP or PDF file." }),
    sizeBytes: import_zod.z.int("File size must be a whole number of bytes.").positive("File size must be greater than zero.").max(MAX_DOCUMENT_BYTES, "File size exceeds the 5MB limit.")
  }),
  // -- admin: mentors -------------------------------------------------------
  mentorStatus: import_zod.z.strictObject({
    action: accountActionField,
    reason: optionalText({ max: MAX_REASON_LENGTH, label: "Reason", multiline: true }),
    suspendedUntil: suspendedUntilField
  }),
  adminMentorProfile: import_zod.z.strictObject({
    fullName: fullNameField.optional(),
    timezone: timezoneField,
    phone: phoneField,
    avatarUrl: import_zod.z.union([httpUrlField, import_zod.z.literal(""), import_zod.z.null()]).optional(),
    headline: headlineField,
    bio: bioField,
    experienceYears: experienceYearsField.optional(),
    languages: tagListField,
    expertise: nullableTagListField,
    isFeatured: import_zod.z.boolean().optional(),
    segmentIds: import_zod.z.array(uuidField, { message: "Segment ids must be a list of IDs." }).max(MAX_TAGS2).optional()
  }).refine(hasAtLeastOneField, { message: "No editable fields were provided." }),
  adminMentorGigCreate: import_zod.z.strictObject(gigCreateShape),
  adminMentorGigUpdate: gigUpdateSchema,
  adminMentorSegments: import_zod.z.strictObject({
    segmentIds: import_zod.z.array(uuidField, { message: "Segment ids must be a list of IDs." }).max(MAX_TAGS2),
    primarySegmentId: uuidField.optional()
  }),
  // -- admin: segments and gigs --------------------------------------------
  segmentCreate: import_zod.z.strictObject(segmentCreateShape),
  segmentUpdate: import_zod.z.strictObject(segmentUpdateShape).refine(hasAtLeastOneField, {
    message: "No editable fields were provided."
  }),
  segmentToggleActive: import_zod.z.strictObject({
    isActive: import_zod.z.boolean("isActive must be true or false.")
  }),
  segmentPriority: import_zod.z.strictObject({
    direction: import_zod.z.enum(["up", "down"], { message: 'Direction must be "up" or "down".' })
  }),
  segmentExperience: import_zod.z.strictObject({
    branding: import_zod.z.strictObject({
      eyebrow: optionalText({ max: 60, label: "Eyebrow" }),
      heroImageAlt: optionalText({ max: 160, label: "Hero image alt text" }),
      heroHeadline: text({ max: 120, label: "Hero headline" }).optional(),
      heroSubheadline: text({ max: 200, label: "Hero subheadline", multiline: true }).optional(),
      tintColor: import_zod.z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #0d9488.").optional(),
      accent: import_zod.z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #0d9488.").optional(),
      accentSoft: import_zod.z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #0d9488.").optional(),
      accentSecondary: import_zod.z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #0d9488.").optional(),
      heroTint: import_zod.z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #0d9488.").optional(),
      gradientStart: import_zod.z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #0d9488.").optional(),
      gradientEnd: import_zod.z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #0d9488.").optional(),
      textMode: import_zod.z.enum(["auto", "light", "dark"]).optional(),
      heroImageUrl: httpUrlField.optional()
    }).optional(),
    topics: import_zod.z.array(experienceItemSchema).max(8, "Use at most 8 topics.").optional(),
    quickHelp: import_zod.z.array(experienceItemSchema).max(6, "Use at most 6 quick help items.").optional(),
    journeySteps: import_zod.z.array(experienceItemSchema).max(6, "Use at most 6 journey steps.").optional(),
    benefits: import_zod.z.array(experienceItemSchema).max(6, "Use at most 6 benefits.").optional(),
    faq: import_zod.z.array(import_zod.z.strictObject({
      question: text({ max: 200, label: "Question" }),
      answer: text({ max: 1e3, label: "Answer", multiline: true }),
      enabled: import_zod.z.boolean().optional()
    })).max(8, "Use at most 8 FAQ items.").optional(),
    guides: import_zod.z.array(import_zod.z.strictObject({
      topic: optionalText({ max: 80, label: "Topic" }),
      title: text({ max: 200, label: "Title" }),
      description: text({ max: 400, label: "Description", multiline: true }),
      readingTime: optionalText({ max: 40, label: "Reading time" }),
      cta: import_zod.z.strictObject({
        text: text({ max: 60, label: "CTA text" }),
        url: linkField
      }).optional()
    })).max(6, "Use at most 6 guides.").optional(),
    stories: import_zod.z.array(import_zod.z.strictObject({
      quote: text({ max: 600, label: "Quote", multiline: true }),
      name: text({ min: 1, max: 80, label: "Name" }),
      context: optionalText({ max: 120, label: "Context" }),
      avatar: httpUrlField.optional()
    })).max(6, "Use at most 6 stories.").optional(),
    // The CTA carries a heading, supporting copy and a button. The legacy
    // `{ text, url }` pair is still accepted so an older admin client keeps
    // working, and `text` is always the BUTTON label — never the heading.
    cta: import_zod.z.strictObject({
      title: optionalText({ max: 120, label: "CTA title" }),
      description: optionalText({ max: 300, label: "CTA description", multiline: true }),
      buttonText: text({ max: 60, label: "CTA button text" }).optional(),
      buttonUrl: linkField.optional(),
      text: text({ max: 60, label: "CTA text" }).optional(),
      url: linkField.optional()
    }).refine(
      (c) => Boolean(c.title || c.description || c.buttonText || c.text || c.url || c.buttonUrl),
      { message: "Add a title, description or button to the CTA." }
    ).optional(),
    /**
     * Per-section on/off. A section that is explicitly disabled is never
     * rendered, so an admin can hide a section without deleting its content.
     * Unknown keys are refused rather than stored, which keeps the payload
     * inside the closed registry the renderer knows.
     */
    sections: sectionToggles.optional()
  }).optional(),
  segmentAddMentor: import_zod.z.strictObject({
    mentorId: uuidField,
    isPrimary: import_zod.z.boolean().optional().default(false)
  }),
  /**
   * Admin topic management.
   *
   * The slug is NEVER accepted from the client: it is derived server-side from
   * the name, so a topic's URL always matches its label and a rename updates
   * the link consistently. `priority` drives the order of the seeker topic bar.
   */
  segmentTopicCreate: import_zod.z.strictObject({
    name: text({ min: 1, max: 80, label: "Topic name" }),
    description: optionalText({ max: 200, label: "Description", multiline: true }),
    isActive: import_zod.z.boolean().optional()
  }),
  segmentTopicUpdate: import_zod.z.strictObject({
    name: text({ min: 1, max: 80, label: "Topic name" }).optional(),
    description: optionalText({ max: 200, label: "Description", multiline: true }),
    isActive: import_zod.z.boolean().optional(),
    priority: import_zod.z.int("Priority must be a whole number.").min(0).max(9999).optional()
  }).refine(hasAtLeastOneField, {
    message: "No editable fields were provided."
  }),
  /**
   * Replace the topic set of a gig.
   *
   * The body is the COMPLETE desired selection, not a delta, so a save can
   * never leave a stale link behind. Ownership (topic.segment_id ===
   * gig.segment_id) is verified against the database before anything is
   * written — the UI filter is a convenience, this is the guarantee.
   */
  gigTopicsUpdate: import_zod.z.strictObject({
    topicIds: import_zod.z.array(uuidField).max(24, "A gig can cover at most 24 topics.")
  }),
  segmentGigCreate: import_zod.z.strictObject({
    mentorId: uuidField,
    ...gigCreateShape,
    isActive: import_zod.z.boolean().optional()
  }),
  adminGigUpdate: import_zod.z.strictObject({
    title: gigTitleField.optional(),
    description: optionalText({ max: MAX_BIO_LENGTH, label: "Description", multiline: true }),
    durationMinutes: gigDurationField.optional(),
    priceInr: priceField.optional(),
    isActive: import_zod.z.boolean().optional()
  }).refine(hasAtLeastOneField, {
    message: "No editable fields were provided."
  }),
  adminGigToggleActive: import_zod.z.strictObject({
    isActive: import_zod.z.boolean("isActive must be true or false.")
  }),
  // -- admin: users ---------------------------------------------------------
  adminUserUpdate: import_zod.z.strictObject({
    fullName: fullNameField.optional(),
    timezone: timezoneField,
    phone: phoneField,
    bio: bioField,
    headline: headlineField,
    experienceYears: experienceYearsField.optional()
  }).refine(hasAtLeastOneField, {
    message: "No editable fields were provided."
  }),
  adminUserStatus: import_zod.z.strictObject({
    action: accountActionField,
    reason: optionalText({ max: MAX_REASON_LENGTH, label: "Reason", multiline: true }),
    suspendedUntil: suspendedUntilField
  }),
  adminUserNotification: import_zod.z.strictObject({
    title: text({ min: 1, max: MAX_TITLE_LENGTH, label: "Title" }),
    message: text({ min: 1, max: MAX_BIO_LENGTH, label: "Message", multiline: true })
  }),
  /**
   * Structural layer for direct-create. The richer cross-field rules (password
   * mode, "a mentor needs a segment", tag de-duplication) stay in
   * `validateCreateUserForm`, which is shared verbatim with the browser form, so
   * this schema deliberately does not duplicate them.
   */
  adminUserDirectCreate: import_zod.z.strictObject({
    role: import_zod.z.enum(["seeker", "mentor"], { message: 'Role must be "seeker" or "mentor".' }),
    email: emailField,
    fullName: fullNameField,
    phone: phoneField,
    bio: bioField,
    headline: headlineField,
    timezone: timezoneField,
    password: import_zod.z.string().max(200, "Password must be 200 characters or fewer.").optional().default(""),
    sendEmail: import_zod.z.boolean().optional().default(true),
    experienceYears: import_zod.z.union([experienceYearsField, import_zod.z.literal(""), import_zod.z.null()]).optional(),
    segmentIds: import_zod.z.array(import_zod.z.union([uuidField, import_zod.z.literal("")]), { message: "Segment ids must be a list of IDs." }).max(MAX_TAGS2).optional().default([]),
    languages: import_zod.z.union([
      import_zod.z.array(text({ max: MAX_TAG_LENGTH2, label: "Each language" })).max(MAX_TAGS2),
      import_zod.z.string().max(400, "Too many languages.")
    ]).optional().default([]),
    expertise: import_zod.z.union([
      import_zod.z.array(text({ max: MAX_TAG_LENGTH2, label: "Each expertise" })).max(MAX_TAGS2),
      import_zod.z.string().max(400, "Too many areas of expertise.")
    ]).optional().default([])
  }),
  // -- admin: payments, applications, documents, system ---------------------
  paymentReject: import_zod.z.strictObject({
    rejectionReason: text({ min: 1, max: MAX_REASON_LENGTH, label: "Rejection reason", multiline: true })
  }),
  /**
   * Body of `POST /api/admin/payments/:id/complete-manual-refund`.
   *
   * The shape is the point: an admin records a transfer that has ALREADY
   * happened outside the application, so every field that makes the record
   * believable is required and nothing is defaulted. There is no
   * `paymentStatus`/`refundStatus` field - the transition is decided by the
   * database from the payment's real state, never by the caller.
   *
   * The money and reference rules are re-checked against the stored payment by
   * the `complete_manual_refund` RPC; this layer only bounds the shape.
   */
  manualRefundComplete: import_zod.z.strictObject({
    refundAmountInr: import_zod.z.number("Enter the refund amount as a number.").finite("Enter the refund amount as a number.").positive("The refund amount must be more than zero.").max(1e7, "Refund amount is unrealistically high."),
    refundMethod: import_zod.z.enum(["UPI", "BANK_TRANSFER"], {
      message: "Choose either UPI or bank transfer."
    }),
    refundReference: text({ min: 1, max: 64, label: "Refund reference" }),
    storagePath: idField,
    fileName: import_zod.z.string().max(255, "That filename is too long."),
    mimeType: import_zod.z.enum(ALLOWED_REFUND_PROOF_MIME_TYPES, {
      message: "Upload a PNG, JPG, or WebP image."
    }),
    fileSize: import_zod.z.int("File size must be a whole number of bytes.").positive("That file is empty.").max(MAX_DOCUMENT_BYTES, `That image is larger than ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB.`),
    adminNote: optionalText({ max: MAX_REASON_LENGTH, label: "Admin note", multiline: true })
  }),
  mentorApplicationReject: import_zod.z.strictObject({
    rejectionReason: text({ min: 1, max: MAX_REASON_LENGTH, label: "Rejection reason", multiline: true })
  }),
  mentorDocumentReview: import_zod.z.strictObject({
    status: import_zod.z.enum(["approved", "rejected"], { message: 'Status must be "approved" or "rejected".' }),
    adminNote: optionalText({ max: MAX_REASON_LENGTH, label: "Admin note", multiline: true })
  }),
  logRetention: import_zod.z.strictObject({
    retentionDays: import_zod.z.int("Retention must be a whole number of days.").min(1, "Retention must be at least 1 day.").max(365, "Retention must be 365 days or fewer.")
  }),
  // -- coupons ---------------------------------------------------------------
  /**
   * The whole body of `POST /api/seeker/bookings/:id/coupon`.
   *
   * A CODE AND NOTHING ELSE. There is deliberately no `amountInr`,
   * `discountAmountInr`, `originalAmountInr` or `couponId` field, and that
   * omission is the rule: `apply_coupon_to_booking` is the only writer of the
   * pricing snapshot and it reads every number from a locked row. Adding such a
   * field here would be rejected as an unknown key rather than silently
   * ignored.
   */
  couponApply: import_zod.z.strictObject({
    code: import_zod.z.string().trim().toUpperCase().pipe(
      import_zod.z.string().regex(
        /^[A-Z0-9_]{4,24}$/,
        "Use 4 to 24 letters, numbers or underscores."
      )
    )
  }),
  // -- admin: coupons --------------------------------------------------------
  /** Shared by create and update; only requiredness differs. */
  couponCreate: import_zod.z.strictObject(couponShape).refine(
    // A coupon targeted at both a segment and a single mentor is refused by the
    // database CHECK, so it is refused here where the admin can be told why
    // rather than getting a constraint violation.
    (coupon) => !(coupon.segmentId && coupon.mentorId),
    {
      message: "Target a segment or a mentor, not both.",
      path: ["segmentId"]
    }
  ),
  couponUpdate: import_zod.z.strictObject(couponUpdateShape).refine(hasAtLeastOneField, { message: "No editable fields were provided." }),
  couponStatus: import_zod.z.strictObject({
    status: import_zod.z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"], {
      message: "Status must be ACTIVE, INACTIVE or ARCHIVED."
    })
  }),
  // -- support ---------------------------------------------------------------
  /**
   * Body of `POST /api/support/tickets`.
   *
   * `strictObject` is the load-bearing part of this schema. There is
   * deliberately NO `requesterId`, `role`, `priority`, `status`,
   * `assignedAdminId`, `paymentId` or `isInternal` field, and because the object
   * is strict a client that sends one gets a 400 "unrecognized key" instead of
   * having it quietly dropped. Identity, role and the initial NORMAL priority
   * are derived server-side from the verified session.
   *
   * `bookingCode` is a human reference, not a UUID. The server resolves it
   * against `bookings` and refuses a booking that is not the caller's own.
   */
  supportTicketCreate: import_zod.z.strictObject({
    category: import_zod.z.enum(
      ["BOOKING", "PAYMENT", "SESSION", "MENTOR", "ACCOUNT", "TECHNICAL", "OTHER"],
      { message: "Choose a category." }
    ),
    subject: text({ min: SUPPORT_SUBJECT_MIN, max: SUPPORT_SUBJECT_MAX, label: "Subject" }),
    message: text({ min: SUPPORT_MESSAGE_MIN, max: SUPPORT_MESSAGE_MAX, label: "Message", multiline: true }),
    bookingCode: import_zod.z.string().trim().max(40).regex(BOOKING_CODE_PATTERN2, "Use the booking code from your booking, for example BK-1234.").optional().or(import_zod.z.literal("").transform(() => void 0))
  }),
  /**
   * Body of `POST /api/support/tickets/:ticketCode/messages`.
   *
   * There is no `isInternal` field. A public reply structurally cannot become
   * an internal note: the RPC that inserts it takes no such parameter, and the
   * separate admin-only RPC is the sole writer of `is_internal = TRUE`.
   */
  supportMessageCreate: import_zod.z.strictObject({
    message: text({ min: 1, max: SUPPORT_MESSAGE_MAX, label: "Message", multiline: true })
  }),
  /** Body of `POST /api/support/tickets/:ticketCode/internal-notes`. Admin only. */
  supportInternalNote: import_zod.z.strictObject({
    note: text({ min: 1, max: SUPPORT_MESSAGE_MAX, label: "Note", multiline: true })
  }),
  /**
   * Body of `POST /api/support/tickets/:ticketCode/resolve`. Admin only.
   *
   * The resolution is mandatory and is stored as a public conversation message,
   * so the user reads the same words the admin wrote.
   */
  supportResolve: import_zod.z.strictObject({
    resolution: text({
      min: SUPPORT_RESOLUTION_MIN,
      max: SUPPORT_RESOLUTION_MAX,
      label: "Resolution",
      multiline: true
    })
  }),
  /** Body of `POST /api/support/tickets/:ticketCode/reopen`. Requester or admin. */
  supportReopen: import_zod.z.strictObject({
    reason: text({ min: 1, max: SUPPORT_MESSAGE_MAX, label: "Reason", multiline: true })
  }),
  /**
     * Body of `GET /api/support/tickets/:ticketCode/attachments/upload-url`.
     *
     * The client describes the file; the server decides where it goes. There is
     * deliberately no `storagePath` here, so a client cannot name its own object
     * key - the signed upload URL is minted for a path the server generated.
     */
  supportAttachmentUploadRequest: import_zod.z.strictObject({
    fileName: import_zod.z.string().trim().min(1).max(255),
    mimeType: import_zod.z.enum(SUPPORT_ATTACHMENT_MIME_TYPES, {
      message: "Only PNG, JPG, WebP or PDF files can be attached."
    }),
    fileSize: import_zod.z.int("File size must be a whole number of bytes.").positive("That file is empty.").max(SUPPORT_ATTACHMENT_MAX_BYTES, "Attachments must be 5 MB or smaller.")
  }),
  /**
   * Body of `POST /api/support/tickets/:ticketCode/attachments`.
   *
   * The bytes never reach this route. The browser PUTs them to a signed upload
   * URL the server minted for a path IT generated, then posts that path here.
   * `mimeType` is an allow-list rather than a free string, and the same list is
   * the bucket's `allowed_mime_types`, so an executable cannot be uploaded even
   * if this check were bypassed.
   */
  supportAttachmentCreate: import_zod.z.strictObject({
    storagePath: idField,
    fileName: import_zod.z.string().trim().min(1).max(255),
    mimeType: import_zod.z.enum(SUPPORT_ATTACHMENT_MIME_TYPES, {
      message: "Only PNG, JPG, WebP or PDF files can be attached."
    }),
    fileSize: import_zod.z.int("File size must be a whole number of bytes.").positive("That file is empty.").max(SUPPORT_ATTACHMENT_MAX_BYTES, "Attachments must be 5 MB or smaller.")
  }),
  /**
   * Admin filters for `GET /api/support/tickets?scope=ADMIN`.
   *
   * There is deliberately no `userId` field. A requester's list is scoped to the
   * authenticated caller inside the RPC, so there is no parameter here that
   * could ask for somebody else's tickets.
   */
  supportQueueQuery: import_zod.z.strictObject({
    scope: import_zod.z.enum(["USER", "ADMIN"]).optional().default("USER"),
    status: import_zod.z.enum(SUPPORT_TICKET_STATUSES).optional(),
    priority: import_zod.z.enum(SUPPORT_TICKET_PRIORITIES).optional(),
    category: import_zod.z.enum([
      "BOOKING",
      "PAYMENT",
      "SESSION",
      "MENTOR",
      "AVAILABILITY",
      "PROFILE",
      "ACCOUNT",
      "USER",
      "SYSTEM",
      "TECHNICAL",
      "OTHER"
    ]).optional(),
    requesterRole: import_zod.z.enum(["seeker", "mentor", "admin"]).optional(),
    search: import_zod.z.string().trim().max(120).optional()
  }),
  /**
   * Body of the admin `PATCH /api/support/tickets/:ticketCode`.
   *
   * Three optional admin-only fields, at least one required. `RESOLVED` is
   * refused here on purpose: resolving requires a resolution message and goes
   * through `POST /api/support/tickets/:ticketCode/resolve`, so a status field
   * can never resolve a ticket without telling the user what was decided.
   *
   * There is no `status: 'RESOLVED'` path and no `requesterId`, no
   * `requesterRole`, no `ticketCode` and no `resolution` here: the RPC
   * re-verifies the admin, resolves the ticket by its code, and derives the
   * actor from the caller's verified session.
   */
  supportAdminUpdate: import_zod.z.strictObject({
    status: import_zod.z.enum(["OPEN", "IN_PROGRESS", "WAITING_FOR_USER", "CLOSED"]).optional(),
    priority: import_zod.z.enum(SUPPORT_TICKET_PRIORITIES).optional(),
    // `null` unassigns. Only an admin id is accepted, and the RPC checks it.
    assignedAdminId: import_zod.z.union([uuidField, import_zod.z.null()]).optional()
  }).refine(
    (body) => body.status !== void 0 || body.priority !== void 0 || body.assignedAdminId !== void 0,
    { message: "Change a status, a priority, or an assignee." }
  ),
  // -- notifications, sessions, workspaces ---------------------------------
  notificationRead: import_zod.z.strictObject({
    isRead: import_zod.z.boolean().optional().default(true)
  }),
  notificationMarkAllRead: import_zod.z.strictObject({
    userId: idField
  }),
  notificationDispatch: import_zod.z.strictObject({
    userId: idField.optional(),
    title: text({ min: 1, max: MAX_TITLE_LENGTH, label: "Title" }),
    message: text({ min: 1, max: MAX_BIO_LENGTH, label: "Message", multiline: true }),
    type: import_zod.z.string().trim().min(1).max(40).optional().default("SYSTEM"),
    eventType: import_zod.z.string().trim().max(80).optional(),
    entityType: import_zod.z.string().trim().max(60).optional(),
    entityId: import_zod.z.string().trim().max(200).optional(),
    link: import_zod.z.string().trim().max(500).optional(),
    metadata: import_zod.z.record(import_zod.z.string(), import_zod.z.unknown()).optional().default({})
  }),
  // The caller identity is taken from the verified bearer token, never from
  // the body, so `userId` is accepted for backwards compatibility but must not
  // be required. `currentTime` is likewise accepted and deliberately ignored:
  // the T-5 gate is evaluated against the server clock, and a client-supplied
  // timestamp would otherwise be a way to unlock the meeting link early.
  sessionJoin: import_zod.z.strictObject({
    userId: idField.optional(),
    currentTime: isoDateTimeField.optional()
  }),
  /**
   * POST /api/sessions/:bookingId/complete — End a CONFIRMED session.
   *
   * Either the mentor or the seeker may end their own session (the room is a
   * shared space), and an admin may end any session. The caller's identity and
   * role come from the verified bearer token, never from the body, so the
   * fields below are all optional. `endReason` is free text: stripped of markup
   * and bounded so it cannot smuggle HTML into the audit trail or overflow the
   * column.
   */
  sessionComplete: import_zod.z.strictObject({
    endReason: optionalText({ max: MAX_REASON_LENGTH, label: "Reason", multiline: true })
  }),
  workspace: import_zod.z.strictObject({
    bookingId: idField,
    mentorId: uuidField.optional(),
    mentorNotes: optionalText({ max: 1e4, label: "Mentor notes", multiline: true }),
    takeaways: import_zod.z.array(text({ max: MAX_TITLE_LENGTH, label: "Takeaway" })).max(50, "Use at most 50 takeaways.").optional().default([]),
    suggestions: import_zod.z.array(text({ max: MAX_TITLE_LENGTH, label: "Suggestion" })).max(50, "Use at most 50 suggestions.").optional().default([]),
    /**
     * Accepted under both spellings: the handler historically read `nextSteps`
     * while the Mentor and Admin workspace pages send `next_steps`. Normalising
     * here keeps both callers working and strips markup from every step.
     */
    nextSteps: import_zod.z.array(nextStepItemSchema).max(50, "Use at most 50 next steps.").optional(),
    next_steps: import_zod.z.array(nextStepItemSchema).max(50, "Use at most 50 next steps.").optional(),
    followUpRecommendation: followUpSchema.optional(),
    publish: import_zod.z.boolean().optional().default(false),
    userId: idField.optional(),
    role: import_zod.z.string().trim().max(20).optional()
  })
};

// server.ts
var MENTOR_APPLICATION_LIST_SELECT = `
  *,
  documents:mentor_verification_documents(
    id, document_type, status, original_filename, uploaded_at, reviewed_at, reviewed_by, admin_note
  )
`;
var MENTOR_APPLICATION_DETAIL_SELECT = `
  *
`;
var MENTOR_APPLICATION_AUDIT_SELECT = `
  *
`;
var MENTOR_APPLICATION_STATUS_COUNT_BUCKETS = ["ALL", ...MENTOR_APPLICATION_STATUSES];
var MENTOR_APPLICATION_SEARCH_MATCH_LIMIT = 200;
var EMAIL_PATTERN2 = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var UUID_SHAPE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var MIN_MENTOR_BIO_LENGTH = 10;
var HttpError = class extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
};
async function signQrImageUrl(admin, storagePath) {
  if (!storagePath) return null;
  try {
    const { data, error } = await admin.storage.from(PAYMENT_QR_BUCKET).createSignedUrl(storagePath, 3600);
    if (error) {
      console.error("Failed to sign the payment QR URL:", error.message);
      return null;
    }
    return data?.signedUrl ?? null;
  } catch (signErr) {
    console.error("Failed to sign the payment QR URL:", logSanitizer.safeMessage(signErr));
    return null;
  }
}
async function countActiveAdminAccounts(admin) {
  const { data: adminRoleRows, error: adminRoleErr } = await admin.from("user_roles").select("user_id").eq("role", "admin");
  if (adminRoleErr) throw adminRoleErr;
  const adminIds = Array.from(new Set((adminRoleRows || []).map((r) => r.user_id)));
  if (!adminIds.length) return 0;
  const { data: adminAccounts, error: adminAccountsErr } = await admin.from("profiles").select("id, account_status, suspended_until").in("id", adminIds);
  if (adminAccountsErr) throw adminAccountsErr;
  const now = /* @__PURE__ */ new Date();
  return (adminAccounts || []).filter(
    (row) => deriveAccountState(
      { account_status: row.account_status ?? null, suspended_until: row.suspended_until ?? null },
      now
    ).canPerformOperationalActions
  ).length;
}
async function insertPaymentNotifications(admin, input) {
  const recipients = Array.from(new Set(input.userIds.filter((id) => typeof id === "string" && id)));
  if (!recipients.length) return 0;
  const rows = recipients.map((user_id) => ({
    user_id,
    title: input.title,
    message: input.message,
    type: input.type,
    event_type: input.eventType,
    entity_type: input.entityType,
    entity_id: input.entityId,
    link: input.link,
    is_read: false,
    metadata: input.metadata ?? {}
  }));
  const { error } = await admin.from("notifications").insert(rows);
  if (error) {
    console.error("Failed to write payment notifications:", error.message);
    return 0;
  }
  return rows.length;
}
async function resolveActiveAdminIds(admin) {
  const { data, error } = await admin.from("user_roles").select("user_id").eq("role", "admin");
  if (error) throw error;
  const ids = Array.from(new Set((data || []).map((r) => r.user_id)));
  if (!ids.length) return [];
  const { data: accounts, error: accountsErr } = await admin.from("profiles").select("id, account_status, suspended_until").in("id", ids);
  if (accountsErr) throw accountsErr;
  const now = /* @__PURE__ */ new Date();
  return (accounts || []).filter(
    (row) => deriveAccountState(
      { account_status: row.account_status ?? null, suspended_until: row.suspended_until ?? null },
      now
    ).canPerformOperationalActions
  ).map((row) => row.id);
}
async function notifyPaymentReviewed(admin, input) {
  try {
    const { data: payment, error } = await admin.from("payments").select("id, booking_id, seeker_id, amount_inr, status, rejection_reason").eq("id", input.paymentId).maybeSingle();
    if (error) throw error;
    if (!payment) return;
    const bookingId = input.bookingId ?? payment.booking_id;
    const { data: booking } = await admin.from("bookings").select("id, booking_code").eq("id", bookingId).maybeSingle();
    const bookingCode = booking?.booking_code ?? null;
    const amountLabel = `\u20B9${Number(payment.amount_inr ?? 0).toLocaleString("en-IN")}`;
    const codeSuffix = bookingCode ? ` for booking ${bookingCode}` : "";
    await insertPaymentNotifications(admin, {
      userIds: [payment.seeker_id],
      title: input.approved ? "Payment verified" : "Payment verification requires attention",
      message: input.approved ? `Your payment${codeSuffix} (${amountLabel}) has been verified. The mentor will now add the meeting link.` : `Your payment proof${codeSuffix} (${amountLabel}) could not be verified${input.rejectionReason ? `: ${input.rejectionReason}` : "."} Please submit a clearer payment reference and screenshot.`,
      type: "PAYMENT",
      eventType: input.approved ? "PAYMENT_APPROVED" : "PAYMENT_REJECTED",
      entityType: "payment",
      entityId: payment.id,
      link: "/seeker/bookings",
      metadata: {
        bookingId,
        bookingCode,
        paymentId: payment.id,
        amountInr: payment.amount_inr,
        rejectionReason: input.rejectionReason ?? null
      }
    });
  } catch (notifyErr) {
    console.error("Failed to notify seeker of payment review outcome:", logSanitizer.safeMessage(notifyErr));
  }
}
async function notifyRefundState(admin, input) {
  const notice = refundNotice(input.kind, {
    amountInr: input.refundInfo.amountInr,
    bookingCode: input.booking.booking_code
  });
  await insertPaymentNotifications(admin, {
    userIds: [input.booking.seeker_id],
    title: notice.title,
    message: notice.message,
    type: "PAYMENT",
    eventType: notice.eventType,
    entityType: "payment",
    entityId: input.refundInfo.paymentId,
    link: "/seeker/bookings",
    metadata: {
      bookingCode: input.booking.booking_code,
      paymentId: input.refundInfo.paymentId,
      amountInr: input.refundInfo.amountInr
    }
  });
}
function refundCompletionFailureCode(dbMessage) {
  const match = /code:\s*([A-Z_]+)/.exec(dbMessage ?? "");
  const known = /* @__PURE__ */ new Set([
    "UNAUTHORIZED",
    "PAYMENT_NOT_FOUND",
    "REFUND_NOT_MANUAL",
    "ALREADY_REFUNDED",
    "PAYMENT_NOT_REFUNDABLE",
    "REFUND_NOT_PENDING",
    "REFUND_AMOUNT_INVALID",
    "REFUND_AMOUNT_EXCEEDS_PAYMENT",
    "REFUND_AMOUNT_NOT_FULL",
    "REFUND_REFERENCE_REQUIRED",
    "REFUND_METHOD_INVALID",
    "REFUND_PROOF_REQUIRED",
    "REFUND_NOTE_TOO_LONG"
  ]);
  return match && known.has(match[1]) ? match[1] : "REFUND_COMPLETION_FAILED";
}
function refundCompletionFailureStatus(code) {
  if (code === "PAYMENT_NOT_FOUND") return 404;
  if (code === "UNAUTHORIZED") return 403;
  if (code === "REFUND_COMPLETION_FAILED") return 500;
  return 409;
}
function refundCompletionFailureReason(code) {
  const reasons = {
    UNAUTHORIZED: "Only an admin can complete a refund.",
    PAYMENT_NOT_FOUND: "Payment not found.",
    REFUND_NOT_MANUAL: "This refund is settled by the payment gateway, not by an admin.",
    ALREADY_REFUNDED: "This payment has already been refunded.",
    PAYMENT_NOT_REFUNDABLE: "This payment is not in a refundable state.",
    REFUND_NOT_PENDING: "This payment has no manual refund awaiting completion.",
    REFUND_AMOUNT_INVALID: "The refund amount must be more than zero.",
    REFUND_AMOUNT_EXCEEDS_PAYMENT: "The refund amount cannot exceed the amount that was paid.",
    REFUND_AMOUNT_NOT_FULL: "Only a full refund is supported for this payment.",
    REFUND_REFERENCE_REQUIRED: "Enter the refund reference / UTR from the transfer receipt.",
    REFUND_METHOD_INVALID: "Choose either UPI or bank transfer.",
    REFUND_PROOF_REQUIRED: "Attach the refund receipt as proof.",
    REFUND_NOTE_TOO_LONG: "The admin note is too long.",
    REFUND_COMPLETION_FAILED: "The refund could not be completed. Nothing was recorded; please try again."
  };
  return reasons[code] ?? reasons.REFUND_COMPLETION_FAILED;
}
async function notifyMentorOfPaymentCaptured(admin, input) {
  try {
    const { data: booking, error: bookingErr } = await admin.from("bookings").select("id, booking_code, mentor_id, start_time").eq("id", input.bookingId).maybeSingle();
    if (bookingErr) throw bookingErr;
    if (!booking) return;
    const amountLabel = `\u20B9${Number(input.amountInr ?? 0).toLocaleString("en-IN")}`;
    const codeSuffix = booking.booking_code ? ` for booking ${booking.booking_code}` : "";
    await insertPaymentNotifications(admin, {
      userIds: [input.mentorId],
      title: "New paid booking",
      message: `Payment received${codeSuffix} (${amountLabel}). Please confirm the session and add the meeting link.`,
      type: "BOOKING",
      eventType: "NEW_BOOKING",
      entityType: "booking",
      entityId: input.bookingId,
      link: "/mentor/bookings",
      metadata: {
        bookingId: input.bookingId,
        bookingCode: booking.booking_code,
        paymentId: input.paymentId,
        amountInr: input.amountInr,
        source: input.source
      }
    });
  } catch (notifyErr) {
    console.error("Failed to notify mentor of captured payment:", logSanitizer.safeMessage(notifyErr));
  }
}
var MENTOR_BOOKING_SELECT = `
  *,
  seeker:profiles!bookings_seeker_id_fkey(id, full_name, email, timezone),
  mentor:profiles!bookings_mentor_id_fkey(id, full_name, email, timezone),
  gig:gigs(id, mentor_id, title, description, duration_minutes, price_inr, segment_id),
  segment:segments(id, name, slug)
`;
async function loadMentorBookingRows(admin, mentorId, statusFilter) {
  let query = admin.from("bookings").select(MENTOR_BOOKING_SELECT).eq("mentor_id", mentorId).order("start_time", { ascending: true });
  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }
  return await query;
}
var RESCHEDULE_FAILURE_CODES = [
  "INVALID_INTERVAL",
  "PAST_SLOT_FORBIDDEN",
  "BOOKING_CUTOFF_REACHED",
  "BOOKING_NOT_FOUND",
  "GIG_NOT_FOUND",
  "BOOKING_NOT_RESCHEDULABLE",
  "FORBIDDEN_NOT_BOOKING_OWNER",
  "RESCHEDULE_WINDOW_CLOSED",
  "RESCHEDULE_REQUEST_PENDING",
  "OUTSIDE_AVAILABILITY",
  "OUTSIDE_EXCEPTION_HOURS",
  "DATE_EXCEPTION_UNAVAILABLE",
  "DURATION_MISMATCH",
  "SLOT_ALREADY_BOOKED",
  "SLOT_HELD_BY_OTHER",
  "RESCHEDULE_REQUEST_NOT_FOUND",
  "RESCHEDULE_REQUEST_CLOSED",
  "RESCHEDULE_REQUEST_EXPIRED",
  "INVALID_DECISION"
];
function rescheduleFailureCode(message) {
  const matched = (message || "").match(/code:\s*([A-Z0-9_]+)/i)?.[1]?.toUpperCase();
  return RESCHEDULE_FAILURE_CODES.includes(matched || "") ? matched : "RESCHEDULE_REQUEST_FAILED";
}
function rescheduleFailureReason(message) {
  return (message || "").match(/code:\s*[A-Z0-9_]+,\s*([\s\S]*)$/i)?.[1]?.trim() || "Could not process the reschedule request.";
}
function rescheduleFailureStatus(message) {
  const code = rescheduleFailureCode(message);
  if (code === "BOOKING_NOT_FOUND" || code === "GIG_NOT_FOUND" || code === "RESCHEDULE_REQUEST_NOT_FOUND") {
    return 404;
  }
  if (code === "FORBIDDEN_NOT_BOOKING_OWNER") return 403;
  if (code === "RESCHEDULE_REQUEST_PENDING" || code === "RESCHEDULE_REQUEST_CLOSED" || code === "RESCHEDULE_REQUEST_EXPIRED" || code === "BOOKING_NOT_RESCHEDULABLE" || code === "RESCHEDULE_WINDOW_CLOSED" || code === "SLOT_ALREADY_BOOKED" || code === "SLOT_HELD_BY_OTHER" || code === "BOOKING_CUTOFF_REACHED" || code === "PAST_SLOT_FORBIDDEN") {
    return 409;
  }
  return 400;
}
function enrichMentorBookingProjection(booking, payment, hold = null, rescheduleRequest = null, nowMs = Date.now()) {
  const durationMinutes = (() => {
    const start = new Date(booking.start_time).getTime();
    const end = new Date(booking.end_time).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    return Math.round((end - start) / 6e4);
  })();
  const lifecycle = resolveBookingLifecycle(booking, nowMs);
  return {
    ...booking,
    gig: booking.gig || null,
    segment: booking.segment || null,
    seeker: booking.seeker || null,
    mentor: booking.mentor || null,
    payment: payment || null,
    hold: hold || null,
    // Duration as it was booked, so a later gig edit cannot rewrite history.
    duration_minutes: durationMinutes ?? booking.gig?.duration_minutes ?? null,
    // `deadlineInfo` is retained for the surfaces that render the raw deadline
    // arithmetic, but `lifecycle` is what decides which tab a booking belongs
    // in, so the two can never disagree about the tabs.
    deadlineInfo: calculateMeetingLinkDeadline(booking.start_time, new Date(nowMs)),
    lifecycle,
    // The open (or most recent) reschedule request, so the detail page renders
    // the Accept/Reject decision without a second round trip.
    rescheduleRequest: rescheduleRequest || null
  };
}
async function readRescheduleRequest(admin, bookingId, callerId) {
  const { data, error } = await admin.rpc("get_reschedule_request_for_booking", {
    p_booking_id: bookingId,
    p_caller_id: callerId
  });
  if (error) return null;
  return data || null;
}
async function resolveAdminSegmentBySlugOrId(admin, reference) {
  const key = String(reference ?? "").trim();
  if (!key) return { segment: null, error: null };
  const column = UUID_SHAPE_PATTERN.test(key) ? "id" : "slug";
  const { data, error } = await admin.from("segments").select("*").eq(column, key).maybeSingle();
  if (error) return { segment: null, error };
  return { segment: data ?? null, error: null };
}
async function loadSegmentMentors(admin, segmentId) {
  const { data: msData, error: msErr } = await admin.from("mentor_segments").select("mentor_id, segment_id, is_primary, created_at").eq("segment_id", segmentId);
  if (msErr) return { mentors: [], error: msErr };
  const rows = msData || [];
  const mentorIds = Array.from(new Set(rows.map((ms) => ms.mentor_id)));
  if (mentorIds.length === 0) return { mentors: [], error: null };
  const [profilesRes, mentorProfilesRes, rolesRes, gigsRes] = await Promise.all([
    admin.from("profiles").select("id, full_name, email").in("id", mentorIds),
    admin.from("mentor_profiles").select("id, approval_status, is_approved, is_active, headline").in("id", mentorIds),
    admin.from("user_roles").select("user_id, role").in("user_id", mentorIds).eq("role", "mentor"),
    admin.from("gigs").select("id, title, mentor_id, segment_id, is_active").in("mentor_id", mentorIds).eq("is_active", true)
  ]);
  for (const res of [profilesRes, mentorProfilesRes, rolesRes, gigsRes]) {
    if (res.error) return { mentors: [], error: res.error };
  }
  const profileMap = new Map((profilesRes.data || []).map((p) => [p.id, p]));
  const mpMap = new Map((mentorProfilesRes.data || []).map((mp) => [mp.id, mp]));
  const mentorRoleIds = new Set((rolesRes.data || []).map((r) => r.user_id));
  const activeGigByMentor = /* @__PURE__ */ new Map();
  for (const g of gigsRes.data || []) {
    if (g.segment_id !== segmentId) continue;
    if (!activeGigByMentor.has(g.mentor_id)) activeGigByMentor.set(g.mentor_id, g);
  }
  const mentors = rows.filter((ms) => mentorRoleIds.has(ms.mentor_id)).map((ms) => {
    const profile = profileMap.get(ms.mentor_id);
    const mp = mpMap.get(ms.mentor_id);
    return {
      id: ms.mentor_id,
      name: profile?.full_name || "Unknown",
      email: profile?.email || "",
      headline: mp?.headline || "",
      isPrimary: Boolean(ms.is_primary),
      activeGig: activeGigByMentor.get(ms.mentor_id)?.title || null,
      approvalStatus: mp?.approval_status || "draft",
      isActive: Boolean(mp?.is_active)
    };
  });
  return { mentors, error: null };
}
async function loadSegmentGigs(admin, segmentId) {
  const { data, error } = await admin.from("gigs").select("*, segment:segments(name)").eq("segment_id", segmentId).order("created_at", { ascending: false });
  if (error) return { gigs: [], error };
  const gigs = (data || []).map((g) => ({
    id: g.id,
    title: g.title,
    description: g.description,
    durationMinutes: g.duration_minutes,
    priceInr: g.price_inr,
    isActive: g.is_active,
    mentorId: g.mentor_id,
    segmentId: g.segment_id,
    segmentName: g.segment?.name || "Unknown",
    createdAt: g.created_at,
    updatedAt: g.updated_at
  }));
  return { gigs, error: null };
}
async function computeMentorSlotsForDate(admin, params) {
  const { mentorIds, dateStr, segmentId, gigId, now } = params;
  const results = /* @__PURE__ */ new Map();
  if (mentorIds.length === 0) return { results, error: null };
  const windowStartIso = `${dateStr}T00:00:00.000Z`;
  const windowEndIso = `${addDaysToDateString(dateStr, 2)}T00:00:00.000Z`;
  const nowIso = now.toISOString();
  const [profilesRes, availabilityRes, exceptionsRes, bookingsRes, holdsRes, gigsRes] = await Promise.all([
    admin.from("profiles").select("id, timezone").in("id", mentorIds),
    admin.from("mentor_availability").select("*").in("mentor_id", mentorIds).eq("is_enabled", true),
    admin.from("mentor_availability_exceptions").select("*").in("mentor_id", mentorIds).eq("exception_date", dateStr),
    admin.from("bookings").select("*").in("mentor_id", mentorIds).not("status", "in", '("CANCELLED","REJECTED")').lt("start_time", windowEndIso).gt("end_time", windowStartIso),
    admin.from("slot_holds").select("*").in("mentor_id", mentorIds).eq("status", "ACTIVE").gt("expires_at", nowIso).lt("start_time", windowEndIso).gt("end_time", windowStartIso),
    admin.from("gigs").select("*").in("mentor_id", mentorIds).eq("is_active", true)
  ]);
  for (const res of [profilesRes, availabilityRes, exceptionsRes, bookingsRes, holdsRes, gigsRes]) {
    if (res.error) return { results, error: res.error };
  }
  const timezoneByMentor = new Map(
    (profilesRes.data || []).map((p) => [p.id, p.timezone || APP_CONFIG.DEFAULT_TIMEZONE])
  );
  const availabilityRows = availabilityRes.data || [];
  const exceptionRows = exceptionsRes.data || [];
  const bookingRows = bookingsRes.data || [];
  const holdRows = holdsRes.data || [];
  for (const mentorId of mentorIds) {
    const timezone = timezoneByMentor.get(mentorId) || APP_CONFIG.DEFAULT_TIMEZONE;
    const mentorGigs = (gigsRes.data || []).filter((g) => g.mentor_id === mentorId);
    let gig = null;
    if (gigId) {
      const requested = mentorGigs.find((g) => g.id === gigId) || null;
      if (requested && requested.mentor_id === mentorId && (!segmentId || requested.segment_id === segmentId) && requested.is_active === true) {
        gig = requested;
      }
    } else if (segmentId) {
      gig = mentorGigs.find((g) => g.segment_id === segmentId) || null;
    }
    if (!gig) {
      results.set(mentorId, {
        mentor_id: mentorId,
        timezone,
        gig: null,
        slots: [],
        available_count: 0,
        next_hold_expires_at: null,
        next_slot_start_at: null
      });
      continue;
    }
    const mentorHolds = holdRows.filter((h) => h.mentor_id === mentorId);
    const slots = generateMentorSlots({
      mentorId,
      gigId: gig.id,
      dateStr,
      timezone,
      durationMinutes: gig.duration_minutes,
      recurringAvailability: availabilityRows.filter((a) => a.mentor_id === mentorId),
      exceptions: exceptionRows.filter((e) => e.mentor_id === mentorId),
      bookings: bookingRows.filter((b) => b.mentor_id === mentorId),
      slotHolds: mentorHolds,
      currentUtcTime: now
    });
    const nowMs = now.getTime();
    const holdExpiries = mentorHolds.map((h) => new Date(h.expires_at).getTime()).filter((ms) => Number.isFinite(ms) && ms > nowMs).sort((a, b) => a - b);
    const upcomingStarts = slots.map((s) => new Date(s.utc_start_time).getTime()).filter((ms) => Number.isFinite(ms) && ms > nowMs).sort((a, b) => a - b);
    results.set(mentorId, {
      mentor_id: mentorId,
      timezone,
      gig: {
        id: gig.id,
        mentor_id: gig.mentor_id,
        segment_id: gig.segment_id,
        title: gig.title,
        description: gig.description ?? null,
        duration_minutes: gig.duration_minutes,
        price_inr: gig.price_inr,
        is_active: gig.is_active === true
      },
      slots,
      available_count: slots.filter((s) => s.is_available).length,
      next_hold_expires_at: holdExpiries.length > 0 ? new Date(holdExpiries[0]).toISOString() : null,
      next_slot_start_at: upcomingStarts.length > 0 ? new Date(upcomingStarts[0]).toISOString() : null
    });
  }
  return { results, error: null };
}
var SESSION_BOOKING_SELECT = `
  id, booking_code, mentor_id, seeker_id, gig_id, segment_id, hold_id,
  start_time, end_time, seeker_timezone, mentor_timezone, amount_inr,
  status, meeting_url, actual_ended_at, ended_by_role, cancellation_reason, created_at, updated_at,
  gig:gigs(id, title),
  seeker:profiles!bookings_seeker_id_fkey(id, full_name, timezone),
  mentor:profiles!bookings_mentor_id_fkey(id, full_name, timezone)
`;
async function loadAuthoritativeSessionBooking(admin, rawBookingId, callerId) {
  if (!isSafeBookingIdentifier(rawBookingId)) {
    return { booking: null, engineBooking: null, callerIsAdmin: false };
  }
  const identifier = rawBookingId;
  const isUuid = isBookingIdShape(identifier);
  const column = isUuid ? "id" : "booking_code";
  const value = isUuid ? identifier : identifier.toUpperCase();
  const { data, error } = await admin.from("bookings").select(SESSION_BOOKING_SELECT).eq(column, value).limit(1);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return { booking: null, engineBooking: null, callerIsAdmin: false };
  const { data: roleRows, error: roleErr } = await admin.from("user_roles").select("role").eq("user_id", callerId);
  if (roleErr) throw roleErr;
  const callerIsAdmin = (roleRows || []).some((r) => r.role === "admin");
  const engineBooking = {
    ...row,
    booking_code: row.booking_code,
    mentor_id: row.mentor_id,
    seeker_id: row.seeker_id,
    gig_id: row.gig_id,
    segment_id: row.segment_id,
    start_time: row.start_time,
    end_time: row.end_time,
    status: row.status,
    meeting_url: row.meeting_url ?? null,
    actual_ended_at: row.actual_ended_at ?? null,
    cancellation_reason: row.cancellation_reason ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
  return { booking: row, engineBooking, callerIsAdmin };
}
function buildSessionEngineContext(engineBooking, callerId, callerIsAdmin) {
  const base = getLocalBookingEngineContext();
  return {
    ...base,
    bookings: [engineBooking],
    userRoles: callerIsAdmin ? [{ user_id: callerId, role: "admin" }] : [],
    gigs: engineBooking.gig ? [engineBooking.gig] : base.gigs.filter((g) => g.id === engineBooking.gig_id),
    profiles: [engineBooking.seeker, engineBooking.mentor].filter(Boolean)
  };
}
async function persistNaturalSessionCompletion(admin, engineBooking, nowIso) {
  if (!engineBooking) return false;
  if (engineBooking.status !== "CONFIRMED") return false;
  const endMs = new Date(engineBooking.end_time).getTime();
  if (!Number.isFinite(endMs) || new Date(nowIso).getTime() < endMs) return false;
  const { data, error } = await admin.from("bookings").update({
    status: "COMPLETED",
    actual_ended_at: engineBooking.end_time,
    updated_at: nowIso
  }).eq("id", engineBooking.id).eq("status", "CONFIRMED").select("id, status").maybeSingle();
  if (error) {
    console.error("Failed to persist natural session completion:", error.message);
    return false;
  }
  return !!data;
}
function logSessionEvent(event, fields) {
  const parts = [event];
  for (const [key, value] of Object.entries(fields)) {
    if (value === void 0) continue;
    parts.push(`${key}=${value}`);
  }
  console.log(parts.join(" "));
}
async function reconcileBookingSessionState(admin, bookingId) {
  if (!isSafeBookingIdentifier(bookingId) || !isBookingIdShape(bookingId)) return null;
  try {
    const { data, error } = await admin.rpc("reconcile_expired_sessions", {
      p_booking_id: bookingId
    });
    if (error) {
      logSessionEvent("SESSION_RECONCILE_FAILED", {
        bookingId,
        detail: error.message
      });
      return null;
    }
    return typeof data === "string" ? data : null;
  } catch (err) {
    logSessionEvent("SESSION_RECONCILE_FAILED", {
      bookingId,
      detail: err?.message
    });
    return null;
  }
}
async function reconcileAndAnnotateBookingRows(admin, rows, nowMs = Date.now()) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const expiredIds = [];
  for (const row of rows) {
    if (row?.status !== "CONFIRMED") continue;
    const endMs = row.end_time ? new Date(row.end_time).getTime() : Number.NaN;
    if (!Number.isFinite(endMs) || nowMs >= endMs) {
      expiredIds.push(row.id);
    }
  }
  if (expiredIds.length > 0) {
    const { data, error } = await admin.rpc("reconcile_expired_bookings", {
      p_booking_ids: expiredIds
    });
    if (error) {
      console.error("Bulk session reconciliation failed:", error.message);
    } else {
      const completed = Array.isArray(data) ? data.length : 0;
      if (completed > 0) {
        logSessionEvent("SESSION_AUTO_COMPLETED", {
          count: completed,
          reason: "bulk_reconcile",
          serverNow: new Date(nowMs).toISOString()
        });
      }
      const expiredSet = new Set(expiredIds);
      for (const row of rows) {
        if (!expiredSet.has(row.id)) continue;
        row.status = "COMPLETED";
        if (typeof row.end_time === "string" && Number.isFinite(new Date(row.end_time).getTime())) {
          row.actual_ended_at = row.end_time;
        }
      }
    }
  }
  for (const row of rows) annotateSessionState(row, nowMs);
  return rows;
}
function annotateSessionState(row, nowMs = Date.now()) {
  const startMs = row.start_time ? new Date(row.start_time).getTime() : Number.NaN;
  const endMs = row.end_time ? new Date(row.end_time).getTime() : Number.NaN;
  let sessionState;
  let isUpcoming;
  if (row.status === "CANCELLED" || row.status === "REJECTED") {
    sessionState = "CANCELLED";
    isUpcoming = false;
  } else if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    sessionState = "COMPLETED";
    isUpcoming = false;
  } else if (row.actual_ended_at || row.status === "COMPLETED" || nowMs >= endMs) {
    sessionState = "COMPLETED";
    isUpcoming = false;
  } else if (nowMs >= startMs - SESSION_ACCESS_WINDOW_MS) {
    sessionState = nowMs >= startMs ? "IN_PROGRESS" : "ACCESS_OPEN";
    isUpcoming = true;
  } else {
    sessionState = "SCHEDULED";
    isUpcoming = true;
  }
  return { ...row, sessionState, isUpcoming };
}
var ALLOWED_HERO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
var HERO_MAX_BYTES = 5 * 1024 * 1024;
function readHeroUploadBody(body) {
  const obj = typeof body === "object" && body !== null ? body : {};
  const contentType = typeof obj.contentType === "string" ? obj.contentType : "";
  const fileSize = typeof obj.fileSize === "number" ? obj.fileSize : Number(obj.fileSize || 0);
  return { contentType, fileSize };
}
function validateHeroUploadPayload(body) {
  const { contentType, fileSize } = readHeroUploadBody(body);
  const type = contentType.toLowerCase();
  if (!ALLOWED_HERO_MIME_TYPES.includes(type)) {
    return { valid: false, error: { code: "VALIDATION_ERROR", message: "Upload a PNG, JPEG, WebP or GIF image." } };
  }
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return { valid: false, error: { code: "VALIDATION_ERROR", message: "That file is empty." } };
  }
  if (fileSize > HERO_MAX_BYTES) {
    return { valid: false, error: { code: "VALIDATION_ERROR", message: "That image is larger than 5 MB." } };
  }
  return { valid: true, type, size: fileSize };
}
function extractSegmentHeroStoragePath(heroImageUrl) {
  if (typeof heroImageUrl !== "string") return null;
  const trimmed = heroImageUrl.trim();
  if (!trimmed) return null;
  const supabaseBaseUrl = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  if (supabaseBaseUrl) {
    const publicPrefix = `${supabaseBaseUrl}/storage/v1/object/public/segment-hero/`;
    if (trimmed.startsWith(publicPrefix)) {
      const relativePath = trimmed.slice(publicPrefix.length);
      let decoded;
      try {
        decoded = decodeURIComponent(relativePath);
      } catch {
        return null;
      }
      if (decoded.includes("..") || decoded.startsWith("/")) return null;
      return decoded;
    }
  }
  if (trimmed.startsWith("segment-hero/")) {
    const path2 = trimmed.slice("segment-hero/".length);
    if (path2.includes("..") || path2.startsWith("/")) return null;
    return trimmed;
  }
  return null;
}
var app = (0, import_express.default)();
app.set("trust proxy", 1);
if (process.env.VERCEL === "1") {
  module.exports = app;
}
async function startServer() {
  const PORT = Number(process.env.PORT) || 3e3;
  const demoAccounts = {
    seeker: {
      id: "usr-seeker-demo",
      email: "seeker@suggestkey.com",
      full_name: "Aman Kumar",
      password: "password123",
      role: "seeker",
      requiresPassword: false
    },
    mentor: {
      id: "usr-mentor-rahul",
      email: "mentor@suggestkey.com",
      full_name: "Rahul Sharma",
      password: "password123",
      role: "mentor",
      requiresPassword: false
    },
    admin: {
      id: process.env.ADMIN_EMAIL || "admin@suggestkey.local",
      email: process.env.ADMIN_EMAIL || "admin@suggestkey.local",
      full_name: "Platform Administrator",
      // Never defaults to an empty string. An unset or weak ADMIN_PASSWORD
      // removes the admin demo account from the registry entirely (see
      // buildDemoAccounts below), so `password: ""` can no longer be used to
      // authenticate as an admin.
      password: process.env.ADMIN_PASSWORD || "",
      role: "admin",
      requiresPassword: true
    }
  };
  const ADMIN_DEMO_PASSWORD_MIN_LENGTH = 12;
  const buildDemoAccounts = () => {
    const configured = (process.env.ADMIN_PASSWORD || "").trim();
    if (configured.length >= ADMIN_DEMO_PASSWORD_MIN_LENGTH) {
      return demoAccounts;
    }
    const { admin: _omitted, ...withoutAdmin } = demoAccounts;
    return withoutAdmin;
  };
  const passwordsMatch = (expected, candidate) => {
    const expectedBuffer = Buffer.from(expected);
    const candidateBuffer = Buffer.from(candidate);
    return expectedBuffer.length === candidateBuffer.length && (0, import_crypto5.timingSafeEqual)(expectedBuffer, candidateBuffer);
  };
  const demoAuthResponse = (account) => {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    return {
      user: { id: account.id, email: account.email },
      profile: {
        id: account.id,
        email: account.email,
        full_name: account.full_name,
        timezone: "Asia/Kolkata",
        created_at: now,
        updated_at: now
      },
      roles: [account.role],
      activeRole: account.role,
      token: createDemoToken({ sub: account.id, email: account.email, role: account.role })
    };
  };
  app.use(
    import_express.default.json({
      limit: "256kb",
      verify: (req, _res, buf) => {
        req.rawBody = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
      }
    })
  );
  app.use((req, res, next) => {
    const requestId = generateRequestId();
    req.requestId = requestId;
    req.logStart = Date.now();
    res.set("X-Request-ID", requestId);
    next();
  });
  app.use((req, res, next) => {
    if (!req.path.startsWith("/api/")) {
      next();
      return;
    }
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    let capturedBody = void 0;
    let capturedStatus;
    res.json = ((body) => {
      capturedBody = body;
      return originalJson(body);
    });
    res.on("finish", async () => {
      const authReq = req;
      const durationMs = authReq.logStart ? Date.now() - authReq.logStart : void 0;
      const statusCode = res.statusCode;
      const userId = authReq.auth?.user?.id || null;
      const role = authReq.auth?.roles?.includes("admin") ? "admin" : authReq.auth?.roles?.includes("mentor") ? "mentor" : authReq.auth?.roles?.includes("seeker") ? "seeker" : null;
      const errorObj = capturedBody;
      const errorCode = errorObj?.error?.code || null;
      const errorMessage = errorObj?.error?.message || null;
      logApiRequest({
        requestId: authReq.requestId || "",
        method: req.method,
        path: req.path,
        statusCode,
        durationMs: durationMs || 0,
        userId: userId || void 0,
        role: role || void 0,
        error_code: errorCode || void 0,
        error_message: errorMessage || void 0,
        metadata: {
          durationMs,
          statusCode,
          error: errorMessage ? {
            code: errorCode,
            message: errorMessage
          } : void 0
        }
      }).catch(() => {
      });
    });
    next();
  });
  app.use("/api", apiRateLimiter);
  app.use("/api", (req, res, next) => {
    if (process.env.NODE_ENV !== "production") return next();
    if (req.path === "/health" || req.path === "/api/health") return next();
    if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(503).json({
        success: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "The service is temporarily unavailable. Please try again shortly."
        }
      });
    }
    return next();
  });
  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      service: "suggest-key-api",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  });
  app.post("/api/auth/demo-login", expensiveRouteLimiter, validateBody(apiSchemas.demoLogin), async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!isDemoAuthEnabled()) {
      return res.status(404).json({
        success: false,
        error: { code: "DEMO_LOGIN_DISABLED", message: "Demo login is unavailable." }
      });
    }
    const { persona, email, password } = req.body;
    const registry = buildDemoAccounts();
    let account;
    if (persona && Object.prototype.hasOwnProperty.call(registry, persona)) {
      const candidate = registry[persona];
      if (!candidate.requiresPassword || passwordsMatch(candidate.password, password ?? "")) {
        account = candidate;
      }
    } else if (email) {
      account = Object.values(registry).find(
        (candidate) => candidate.email.toLowerCase() === email
      );
      if (account && !passwordsMatch(account.password, password ?? "")) {
        account = void 0;
      }
    }
    if (!account) {
      const tracked = await recordLoginFailure({
        email: email || persona,
        ip: req.ip,
        reason: "INVALID_DEMO_CREDENTIALS"
      });
      logger.auth("login_failure", {
        requestId: req.requestId,
        path: "/api/auth/demo-login",
        method: "POST",
        statusCode: 401,
        result: "failure",
        reason: "INVALID_DEMO_CREDENTIALS"
      });
      return res.status(401).json({
        success: false,
        error: { code: "INVALID_DEMO_CREDENTIALS", message: "Invalid demo credentials." },
        consecutiveFailures: tracked.consecutiveFailures
      });
    }
    await resetLoginFailures({ email: account.email, ip: req.ip });
    return res.json({ success: true, ...demoAuthResponse(account) });
  });
  app.post("/api/auth/login-failure", expensiveRouteLimiter, async (req, res) => {
    try {
      const body = req.body || {};
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const ip = typeof req.ip === "string" ? req.ip : "";
      if (!email && !ip) {
        return res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "email is required." }
        });
      }
      const tracked = await recordLoginFailure({ email, ip, reason: body.reason });
      logger.auth("login_failure", {
        requestId: req.requestId,
        path: "/api/auth/login-failure",
        method: "POST",
        statusCode: 401,
        result: "failure",
        reason: typeof body.reason === "string" ? body.reason.slice(0, 60) : "INVALID_CREDENTIALS"
      });
      return res.json({
        success: true,
        consecutiveFailures: tracked.consecutiveFailures,
        shouldAlert: tracked.shouldAlert
      });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "POST /api/auth/login-failure",
        clientMessage: "Unable to record login attempt."
      });
    }
  });
  app.post("/api/auth/login-success", expensiveRouteLimiter, async (req, res) => {
    try {
      const body = req.body || {};
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const ip = typeof req.ip === "string" ? req.ip : "";
      const cleared = await resetLoginFailures({ email, ip });
      return res.json({ success: true, clearedFailures: cleared });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "POST /api/auth/login-success",
        clientMessage: "Unable to record login attempt."
      });
    }
  });
  app.post("/api/bookings/hold", requireAuth, requireRole("seeker"), expensiveRouteLimiter, validateBody(apiSchemas.bookingHold), async (req, res) => {
    try {
      const { mentorId, segmentId, gigId, startTime, endTime } = req.body;
      const seekerId = req.auth.user.id;
      const admin = getSupabaseAdmin();
      if (admin) {
        const { data: seekerAccount, error: seekerAccountErr } = await admin.from("profiles").select("account_status, suspended_until").eq("id", seekerId).maybeSingle();
        if (seekerAccountErr) throw seekerAccountErr;
        const seekerState = deriveAccountState({
          account_status: seekerAccount?.account_status ?? null,
          suspended_until: seekerAccount?.suspended_until ?? null
        });
        if (!seekerState.canPerformOperationalActions) {
          return res.status(403).json({
            success: false,
            error: {
              code: seekerState.isSuspended ? "SEEKER_ACCOUNT_SUSPENDED" : "SEEKER_ACCOUNT_DEACTIVATED",
              message: seekerState.isSuspended ? "Your account is suspended. New bookings are not possible until the suspension is lifted." : "Your account has been deactivated. New bookings are not possible."
            }
          });
        }
        const { data: bookingGig, error: bookingGigErr } = await admin.from("gigs").select("id, mentor_id, segment_id, is_active").eq("id", gigId).maybeSingle();
        if (bookingGigErr) throw bookingGigErr;
        if (!bookingGig) {
          return res.status(404).json({
            success: false,
            error: { code: "GIG_NOT_FOUND", message: "Session offer not found." }
          });
        }
        const bookingContextProblem = describeBookingContextMismatch({
          gig: bookingGig,
          mentorId,
          segmentId,
          gigId
        });
        if (bookingContextProblem) {
          const inactive = bookingGig.is_active !== true;
          return res.status(409).json({
            success: false,
            error: {
              code: inactive ? "GIG_INACTIVE" : "GIG_MISMATCH",
              message: inactive ? "That session offer is no longer available." : "That session offer does not match the selected mentor and segment."
            }
          });
        }
        const [{ data: mentorProfile, error: mpErr }, { data: mentorAccount, error: accErr }] = await Promise.all([
          admin.from("mentor_profiles").select("approval_status, is_approved, is_active").eq("id", mentorId).maybeSingle(),
          admin.from("profiles").select("account_status, suspended_until").eq("id", mentorId).maybeSingle()
        ]);
        if (mpErr) throw mpErr;
        if (accErr) throw accErr;
        if (!mentorProfile) {
          return res.status(404).json({
            success: false,
            error: { code: "MENTOR_NOT_FOUND", message: "Mentor not found." }
          });
        }
        const mentorState = deriveMentorAccountState({
          approval_status: mentorProfile.approval_status ?? null,
          is_approved: mentorProfile.is_approved ?? null,
          is_active: mentorProfile.is_active ?? null,
          account_status: mentorAccount?.account_status ?? null,
          suspended_until: mentorAccount?.suspended_until ?? null
        });
        if (!mentorState.canPerformOperationalActions) {
          return res.status(403).json({
            success: false,
            error: {
              code: "MENTOR_NOT_BOOKABLE",
              message: mentorState.isSuspended ? "This mentor is currently suspended and cannot receive new bookings." : mentorState.isDeactivated ? "This mentor has been deactivated and cannot receive new bookings." : "This mentor is not currently available for bookings."
            }
          });
        }
        const requestedStartMs = new Date(startTime).getTime();
        if (Number.isFinite(requestedStartMs)) {
          const nowMs = Date.now();
          if (requestedStartMs <= nowMs) {
            return res.status(409).json({
              success: false,
              error: {
                code: "PAST_SLOT_FORBIDDEN",
                message: "This slot can no longer be booked because it has already started."
              }
            });
          }
          if (requestedStartMs - nowMs < APP_CONFIG.BOOKING_CUTOFF_MS) {
            return res.status(409).json({
              success: false,
              error: {
                code: "BOOKING_CUTOFF_REACHED",
                message: `This slot can no longer be booked because it starts in less than ${APP_CONFIG.BOOKING_CUTOFF_MS / 6e4} minutes.`
              }
            });
          }
        }
        const { data, error } = await admin.rpc("create_booking_with_hold", {
          p_seeker_id: seekerId,
          p_mentor_id: mentorId,
          p_segment_id: segmentId,
          p_gig_id: gigId,
          p_start_time: startTime,
          p_end_time: endTime
        });
        if (error) {
          const codeMatch = error.message.match(/code:\s*([A-Z0-9_]+)/i);
          const code = codeMatch?.[1]?.toUpperCase() || "BOOKING_FAILED";
          const reasonMatch = error.message.match(/code:\s*[A-Z0-9_]+,\s*(.*)$/i);
          const reason = (reasonMatch?.[1] || "").trim();
          const conflictCodes = [
            "SLOT_ALREADY_BOOKED",
            "SLOT_HELD_BY_OTHER",
            "BOOKING_CONFLICT",
            "OUTSIDE_AVAILABILITY",
            "OUTSIDE_EXCEPTION_HOURS",
            "DATE_EXCEPTION_UNAVAILABLE",
            "DURATION_MISMATCH",
            "PAST_SLOT_FORBIDDEN",
            "BOOKING_CUTOFF_REACHED"
          ];
          const status = conflictCodes.includes(code) ? 409 : code === "UNAUTHORIZED" || code === "ROLE_NOT_SEEKER" ? 403 : code === "GIG_NOT_FOUND" || code === "GIG_MISMATCH" ? 404 : 400;
          return res.status(status).json({
            success: false,
            error: { code, message: reason || GENERIC_ERROR_MESSAGE }
          });
        }
        const booking = data?.booking;
        if (!booking || typeof booking.id !== "string") {
          return res.status(500).json({
            success: false,
            error: { code: "BOOKING_CREATE_FAILED", message: "Booking creation returned an invalid record." }
          });
        }
        logger.booking("BOOKING_CREATE_COMMITTED", {
          requestId: req.requestId,
          userId: req.auth?.user?.id,
          role: "seeker",
          bookingId: booking.id,
          holdId: booking.hold_id,
          bookingCode: booking.booking_code,
          mentorId: booking.mentor_id,
          seekerId: booking.seeker_id,
          status: booking.status
        });
        return res.status(201).json({
          success: true,
          booking: {
            id: booking.id,
            booking_code: booking.booking_code,
            mentor_id: booking.mentor_id,
            seeker_id: booking.seeker_id,
            gig_id: booking.gig_id,
            segment_id: booking.segment_id,
            hold_id: booking.hold_id,
            start_time: booking.start_time,
            end_time: booking.end_time,
            seeker_timezone: booking.seeker_timezone,
            mentor_timezone: booking.mentor_timezone,
            amount_inr: booking.amount_inr,
            status: booking.status,
            created_at: booking.created_at,
            updated_at: booking.updated_at
          },
          hold: data?.hold || null
        });
      }
      const db = getLocalBookingEngineContext();
      const result = await executeAtomicBookingWithHold(
        {
          seekerId,
          mentorId,
          segmentId,
          gigId,
          startTime,
          endTime,
          currentUtcTime: /* @__PURE__ */ new Date()
        },
        db
      );
      if (!result.success) {
        const code = result.error?.code;
        if (code === "SLOT_ALREADY_BOOKED" || code === "SLOT_HELD_BY_OTHER") {
          return res.status(409).json(result);
        }
        if (code === "AUTH_REQUIRED" || code === "ROLE_NOT_SEEKER") {
          return res.status(403).json(result);
        }
        return res.status(400).json(result);
      }
      return res.status(201).json(result);
    } catch (err) {
      console.error("Unhandled booking error:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err, context: "POST /api/bookings" });
    }
  });
  app.get("/api/mentor/bookings", requireAuth, requireRole("mentor"), async (req, res) => {
    try {
      const { status } = req.query;
      const mentorId = req.auth.user.id;
      const statusFilter = typeof status === "string" && status && status !== "ALL" ? status : null;
      const nowMs = Date.now();
      const supabaseAdmin2 = getSupabaseAdmin();
      if (supabaseAdmin2) {
        const { data: bookings, error: bookingsErr } = await loadMentorBookingRows(
          supabaseAdmin2,
          mentorId,
          statusFilter
        );
        if (bookingsErr) throw bookingsErr;
        const bookingIds = (bookings || []).map((b) => b.id);
        const { data: payments, error: paymentsErr } = bookingIds.length ? await supabaseAdmin2.from("payments").select("*").in("booking_id", bookingIds) : { data: [], error: null };
        if (paymentsErr) throw paymentsErr;
        const paymentByBooking = /* @__PURE__ */ new Map();
        for (const payment of payments || []) {
          paymentByBooking.set(payment.booking_id, payment);
        }
        const reconciledMentor = await reconcileAndAnnotateBookingRows(
          supabaseAdmin2,
          [...bookings || []],
          nowMs
        );
        const enriched = reconciledMentor.map(
          (booking) => enrichMentorBookingProjection(
            booking,
            paymentByBooking.get(booking.id) || null,
            null,
            null,
            nowMs
          )
        );
        return res.json({
          success: true,
          bookings: enriched,
          // The authoritative instant every `lifecycle` verdict above was
          // computed against. The client uses this to correct its own clock
          // rather than to decide anything.
          serverNow: new Date(nowMs).toISOString()
        });
      }
      const db = getLocalBookingEngineContext();
      const mentorIds = [mentorId];
      let matched = db.bookings.filter((b) => mentorIds.includes(b.mentor_id));
      if (statusFilter) {
        matched = matched.filter((b) => b.status === statusFilter);
      }
      matched.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
      const devEnriched = matched.map((b) => enrichBooking(b, db));
      return res.json({ success: true, bookings: devEnriched });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err, context: "GET /api/mentor/bookings" });
    }
  });
  app.get("/api/mentor/bookings/:id", requireAuth, requireRole("mentor"), async (req, res) => {
    try {
      const bookingId = req.params.id;
      const callerId = req.auth.user.id;
      const supabaseAdmin2 = getSupabaseAdmin();
      if (supabaseAdmin2) {
        const { data: booking2, error: bookingErr } = await supabaseAdmin2.from("bookings").select(MENTOR_BOOKING_SELECT).or(`id.eq.${bookingId},booking_code.eq.${bookingId}`).maybeSingle();
        if (bookingErr) throw bookingErr;
        if (!booking2) {
          return res.status(404).json({
            success: false,
            error: { code: "BOOKING_NOT_FOUND", message: "Booking not found." }
          });
        }
        if (booking2.mentor_id !== callerId) {
          return res.status(403).json({
            success: false,
            error: {
              code: "FORBIDDEN_NOT_BOOKING_OWNER",
              message: "Forbidden: You are not authorized to view this booking."
            }
          });
        }
        const { data: payment, error: paymentErr } = await supabaseAdmin2.from("payments").select("*").eq("booking_id", booking2.id).maybeSingle();
        if (paymentErr) throw paymentErr;
        const { data: hold, error: holdErr } = booking2.hold_id ? await supabaseAdmin2.from("slot_holds").select("*").eq("id", booking2.hold_id).maybeSingle() : { data: null, error: null };
        if (holdErr) throw holdErr;
        const detailNowMs = Date.now();
        const [reconciledDetail] = await reconcileAndAnnotateBookingRows(
          supabaseAdmin2,
          [booking2],
          detailNowMs
        );
        const rescheduleRequest = await readRescheduleRequest(supabaseAdmin2, booking2.id, callerId);
        return res.json({
          success: true,
          booking: enrichMentorBookingProjection(
            reconciledDetail,
            payment || null,
            hold || null,
            rescheduleRequest,
            detailNowMs
          ),
          serverNow: new Date(detailNowMs).toISOString()
        });
      }
      const db = getLocalBookingEngineContext();
      const booking = db.bookings.find((b) => b.id === bookingId || b.booking_code === bookingId);
      if (!booking) {
        return res.status(404).json({
          success: false,
          error: { code: "BOOKING_NOT_FOUND", message: "Booking not found." }
        });
      }
      if (booking.mentor_id !== callerId) {
        return res.status(403).json({
          success: false,
          error: {
            code: "FORBIDDEN_NOT_BOOKING_OWNER",
            message: "Forbidden: You are not authorized to view this booking."
          }
        });
      }
      const enriched = enrichBooking(booking, db);
      return res.json({ success: true, booking: enriched });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err, context: "GET /api/mentor/bookings/:id" });
    }
  });
  app.get("/api/seeker/bookings/:id", requireAuth, requireRole("seeker"), async (req, res) => {
    try {
      const bookingId = req.params.id;
      const callerId = req.auth.user.id;
      const admin = getSupabaseAdmin();
      if (admin) {
        const { data: booking2, error: bookingErr } = await admin.from("bookings").select(`
            *,
            seeker:profiles!bookings_seeker_id_fkey(id, full_name, email, timezone),
            mentor:profiles!bookings_mentor_id_fkey(id, full_name, email, timezone),
            gig:gigs(id, mentor_id, title, duration_minutes, price_inr, original_price_inr, segment_id),
            segment:segments(id, name, slug)
          `).eq("id", bookingId).maybeSingle();
        if (bookingErr) throw bookingErr;
        if (!booking2) {
          return res.status(404).json({
            success: false,
            error: { code: "BOOKING_NOT_FOUND", message: "Booking not found." }
          });
        }
        const isAdmin = req.auth.roles.includes("admin");
        if (!isAdmin && booking2.seeker_id !== callerId) {
          return res.status(403).json({
            success: false,
            error: { code: "FORBIDDEN_NOT_BOOKING_OWNER", message: "Forbidden: You are not authorized to view this booking." }
          });
        }
        const { data: payment, error: paymentErr } = await admin.from("payments").select("*").eq("booking_id", bookingId).maybeSingle();
        if (paymentErr) throw paymentErr;
        let hold = null;
        if (booking2.hold_id) {
          const { data: holdData, error: holdErr } = await admin.from("slot_holds").select("*").eq("id", booking2.hold_id).maybeSingle();
          if (!holdErr) hold = holdData;
        }
        const [reconciledSeekerDetail] = await reconcileAndAnnotateBookingRows(admin, [booking2]);
        const rescheduleRequest = await readRescheduleRequest(admin, bookingId, callerId);
        const enriched2 = redactMeetingUrlForParticipant(
          {
            ...reconciledSeekerDetail,
            gig: reconciledSeekerDetail.gig || null,
            segment: reconciledSeekerDetail.segment || null,
            seeker: reconciledSeekerDetail.seeker || null,
            mentor: reconciledSeekerDetail.mentor || null,
            payment: payment || null,
            hold: hold || null,
            rescheduleRequest: rescheduleRequest || null
          },
          { isAdmin, isMentor: false }
        );
        return res.json({ success: true, booking: enriched2, serverNow: (/* @__PURE__ */ new Date()).toISOString() });
      }
      const db = getLocalBookingEngineContext();
      const booking = db.bookings.find((b) => b.id === bookingId || b.booking_code === bookingId);
      if (!booking) {
        return res.status(404).json({
          success: false,
          error: { code: "BOOKING_NOT_FOUND", message: "Booking not found." }
        });
      }
      if (booking.seeker_id !== callerId) {
        return res.status(403).json({
          success: false,
          error: { code: "FORBIDDEN_NOT_BOOKING_OWNER", message: "Forbidden: You are not authorized to view this booking." }
        });
      }
      const enriched = enrichBooking(booking, db);
      return res.json({ success: true, booking: enriched });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.get("/api/seeker/bookings", requireAuth, requireRole("seeker"), async (req, res) => {
    try {
      const callerId = req.auth.user.id;
      const isAdmin = req.auth.roles.includes("admin");
      const admin = getSupabaseAdmin();
      if (admin) {
        let query = admin.from("bookings").select(`
            *,
            seeker:profiles!bookings_seeker_id_fkey(id, full_name, email, timezone),
            mentor:profiles!bookings_mentor_id_fkey(id, full_name, email, timezone),
            gig:gigs(id, title, duration_minutes, price_inr, original_price_inr, segment_id),
            segment:segments(id, name, slug)
          `).order("start_time", { ascending: false });
        if (!isAdmin) {
          query = query.eq("seeker_id", callerId);
        }
        const { data: bookings, error: bookingsErr } = await query;
        if (bookingsErr) throw bookingsErr;
        const bookingIds = (bookings || []).map((b) => b.id);
        const { data: payments, error: paymentsErr } = bookingIds.length ? await admin.from("payments").select("*").in("booking_id", bookingIds) : { data: [], error: null };
        if (paymentsErr) throw paymentsErr;
        const paymentByBooking = /* @__PURE__ */ new Map();
        for (const payment of payments || []) {
          paymentByBooking.set(payment.booking_id, payment);
        }
        const reconciled = await reconcileAndAnnotateBookingRows(admin, [...bookings || []]);
        const enriched = reconciled.map(
          (booking) => redactMeetingUrlForParticipant(
            {
              ...booking,
              gig: booking.gig || null,
              segment: booking.segment || null,
              seeker: booking.seeker || null,
              mentor: booking.mentor || null,
              payment: paymentByBooking.get(booking.id) || null
            },
            // A seeker never receives the link from a list payload; only the
            // access/join endpoints can release it, and only inside the window.
            { isAdmin, isMentor: false }
          )
        );
        return res.json({ success: true, bookings: enriched, serverNow: (/* @__PURE__ */ new Date()).toISOString() });
      }
      const db = getLocalBookingEngineContext();
      const seekerIds = [callerId];
      let matched = db.bookings.filter((b) => seekerIds.includes(b.seeker_id));
      matched.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
      return res.json({ success: true, bookings: matched.map((b) => enrichBooking(b, db)) });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.post("/api/seeker/bookings/:id/payment-proof", requireAuth, requireRole("seeker"), expensiveRouteLimiter, async (req, res) => {
    const bookingId = req.params.id;
    const callerId = req.auth.user.id;
    const admin = getSupabaseAdmin();
    if (!admin) {
      return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Payment service is temporarily unavailable." } });
    }
    const { transactionReference, fileName, mimeType, fileSize, storagePath } = req.body ?? {};
    const reference = normaliseTransactionReference(transactionReference);
    if (!reference.ok) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", field: "transactionReference", message: reference.message } });
    }
    const proof = validateProofFile({
      name: typeof fileName === "string" ? fileName : "",
      type: typeof mimeType === "string" ? mimeType : "",
      size: typeof fileSize === "number" ? fileSize : PAYMENT_PROOF_MAX_BYTES + 1
    });
    if (!proof.ok) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", field: "proof", message: proof.message } });
    }
    if (typeof storagePath !== "string" || !storagePath) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", field: "proof", message: "Select your payment screenshot." } });
    }
    const { data: booking, error: bookingErr } = await admin.from("bookings").select("id, booking_code, seeker_id, mentor_id, gig_id, amount_inr, status, start_time").eq("id", bookingId).maybeSingle();
    if (bookingErr) {
      return respondWithInternalError({ req, res, error: bookingErr, context: "POST /api/seeker/bookings/:id/payment-proof" });
    }
    if (!booking) {
      return res.status(404).json({ success: false, error: { code: "BOOKING_NOT_FOUND", message: "Booking not found." } });
    }
    if (booking.seeker_id !== callerId) {
      return res.status(403).json({ success: false, error: { code: "FORBIDDEN_NOT_BOOKING_OWNER", message: "You are not authorized to pay for this booking." } });
    }
    if (!storagePath.startsWith(`${callerId}/${bookingId}/`)) {
      return res.status(403).json({ success: false, error: { code: "FORBIDDEN_STORAGE_PATH", message: "That file does not belong to this booking." } });
    }
    if (!isPayableBookingStatus(booking.status)) {
      return res.status(409).json({
        success: false,
        error: {
          code: "BOOKING_NOT_PAYABLE",
          message: `This booking is ${String(booking.status).replace(/_/g, " ").toLowerCase()} and no longer accepts a payment proof.`
        }
      });
    }
    const { data: existingPayment, error: existingErr } = await admin.from("payments").select("*").eq("booking_id", bookingId).maybeSingle();
    if (existingErr) {
      return respondWithInternalError({ req, res, error: existingErr, context: "POST /api/seeker/bookings/:id/payment-proof (lookup)" });
    }
    if (existingPayment?.status === "VERIFIED") {
      return res.status(409).json({
        success: false,
        error: { code: "PAYMENT_ALREADY_VERIFIED", message: "This payment has already been verified." },
        payment: existingPayment
      });
    }
    const { data: storedFile, error: statErr } = await admin.storage.from(PAYMENT_PROOF_BUCKET).list(`${callerId}/${bookingId}`, { search: storagePath.split("/").pop(), limit: 10 });
    if (statErr) {
      console.error("Payment proof lookup failed:", statErr.message);
      return respondWithInternalError({ req, res, error: statErr, context: "POST /api/seeker/bookings/:id/payment-proof (storage lookup)" });
    }
    const storedObject = (storedFile || []).find((f) => f.name === storagePath.split("/").pop());
    if (!storedObject) {
      return res.status(400).json({ success: false, error: { code: "PROOF_NOT_STORED", message: "We could not find that screenshot. Please select it again." } });
    }
    const storedBytes = storedObject.metadata?.size;
    if (typeof storedBytes === "number" && storedBytes > PAYMENT_PROOF_MAX_BYTES) {
      await admin.storage.from(PAYMENT_PROOF_BUCKET).remove([storagePath]);
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", field: "proof", message: "That image is too large. Please upload a screenshot under 5 MB." } });
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const paymentRow = {
      booking_id: booking.id,
      seeker_id: booking.seeker_id,
      // Server-derived: never the client-supplied amount.
      amount_inr: booking.amount_inr,
      status: PAYMENT_STATUS_PENDING,
      proof_storage_path: storagePath,
      transaction_reference: reference.value,
      // A fresh submission clears a previous rejection and any stale verifier.
      rejection_reason: null,
      verified_by: null,
      verified_at: null,
      updated_at: nowIso
    };
    const { data: payment, error: paymentErr } = await admin.from("payments").upsert(paymentRow, { onConflict: "booking_id" }).select().single();
    if (paymentErr) {
      console.error("Failed to persist payment record:", paymentErr.message);
      try {
        await admin.storage.from(PAYMENT_PROOF_BUCKET).remove([storagePath]);
      } catch (cleanupErr) {
        console.error("Failed to clean up orphaned proof upload:", logSanitizer.safeMessage(cleanupErr));
      }
      return respondWithInternalError({ req, res, error: paymentErr, context: "POST /api/seeker/bookings/:id/payment-proof (persist)" });
    }
    if (booking.status === "PAYMENT_PENDING") {
      const { error: advanceErr } = await admin.from("bookings").update({ status: "PENDING_VERIFICATION", updated_at: nowIso }).eq("id", booking.id).eq("status", "PAYMENT_PENDING");
      if (advanceErr) {
        console.error("Failed to advance booking to PENDING_VERIFICATION:", advanceErr.message);
      }
    }
    const isNewReviewRequest = !existingPayment || existingPayment.status === "REJECTED";
    const amountLabel = `\u20B9${Number(booking.amount_inr ?? 0).toLocaleString("en-IN")}`;
    const notificationMetadata = {
      bookingId: booking.id,
      bookingCode: booking.booking_code,
      paymentId: payment.id,
      amountInr: booking.amount_inr,
      transactionReference: reference.value
    };
    if (isNewReviewRequest) {
      await insertPaymentNotifications(admin, {
        userIds: [booking.seeker_id],
        title: "Payment proof submitted",
        message: `We received your payment reference and screenshot for booking ${booking.booking_code} (${amountLabel}). An admin will verify it shortly.`,
        type: "PAYMENT",
        eventType: "PAYMENT_SUBMITTED",
        entityType: "payment",
        entityId: payment.id,
        link: "/seeker/bookings",
        metadata: notificationMetadata
      });
      try {
        const adminIds = await resolveActiveAdminIds(admin);
        await insertPaymentNotifications(admin, {
          userIds: adminIds,
          title: "Payment verification required",
          message: `Payment proof submitted for booking ${booking.booking_code} (${amountLabel}). Reference ${reference.value}. Awaiting verification.`,
          type: "PAYMENT",
          eventType: "ADMIN_PAYMENT_PROOF_SUBMITTED",
          entityType: "payment",
          entityId: payment.id,
          link: "/admin/payments",
          metadata: notificationMetadata
        });
      } catch (adminNotifErr) {
        console.error("Failed to raise admin payment verification alert:", logSanitizer.safeMessage(adminNotifErr));
      }
    }
    auditAction(req.auth, "payment_proof_submitted", {
      entityType: "payment",
      entityId: payment.id,
      requestId: req.requestId,
      metadata: { bookingId: booking.id, bookingCode: booking.booking_code, amountInr: booking.amount_inr }
    });
    return res.status(201).json({
      success: true,
      // The status is PENDING_VERIFICATION, never "paid": the money is not
      // verified until an admin says so.
      message: "Payment proof submitted for verification.",
      payment,
      booking: { id: booking.id, booking_code: booking.booking_code, status: "PENDING_VERIFICATION", amount_inr: booking.amount_inr }
    });
  });
  app.get("/api/seeker/bookings/:id/payment-proof", requireAuth, requireRole("seeker"), async (req, res) => {
    try {
      const callerId = req.auth.user.id;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Payment service is temporarily unavailable." } });
      }
      const { data: booking, error: bookingErr } = await admin.from("bookings").select("id, booking_code, seeker_id, status, amount_inr").eq("id", req.params.id).maybeSingle();
      if (bookingErr) throw bookingErr;
      if (!booking) {
        return res.status(404).json({ success: false, error: { code: "BOOKING_NOT_FOUND", message: "Booking not found." } });
      }
      if (booking.seeker_id !== callerId) {
        return res.status(403).json({ success: false, error: { code: "FORBIDDEN_NOT_BOOKING_OWNER", message: "You are not authorized to view this booking." } });
      }
      const { data: payment, error: paymentErr } = await admin.from("payments").select("*").eq("booking_id", booking.id).maybeSingle();
      if (paymentErr) throw paymentErr;
      return res.json({ success: true, payment: payment ?? null, booking });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err, context: "GET /api/seeker/bookings/:id/payment-proof" });
    }
  });
  const respondCouponRefusal = (res, error) => {
    const codeMatch = error.message?.match(/code:\s*([A-Z0-9_]+)/i);
    const code = codeMatch?.[1]?.toUpperCase() || "COUPON_APPLY_FAILED";
    const reason = (error.message?.match(/code:\s*[A-Z0-9_]+,\s*(.*)$/i)?.[1] || "").trim();
    const status = code === "UNAUTHORIZED" || code === "FORBIDDEN_NOT_BOOKING_OWNER" ? 403 : code === "BOOKING_NOT_FOUND" ? 404 : code === "COUPON_NOT_FOUND" ? 404 : code === "COUPON_LIMIT_REACHED" || code === "COUPON_HOLD_EXPIRED" || code === "COUPON_BOOKING_NOT_PAYABLE" || code === "COUPON_INACTIVE" || code === "COUPON_EXPIRED" || code === "COUPON_NOT_STARTED" || code === "COUPON_NOT_TARGETED" || code === "COUPON_PAYMENT_IN_FLIGHT" ? 409 : 400;
    return res.status(status).json({
      success: false,
      error: { code, message: reason || GENERIC_ERROR_MESSAGE }
    });
  };
  const readBookingPricing = async (admin, bookingId) => {
    const { data, error } = await admin.from("bookings").select("id, booking_code, status, amount_inr, base_amount_inr, discount_amount_inr, original_amount_inr, coupon_id, coupon_code").eq("id", bookingId).maybeSingle();
    if (error) throw error;
    return data;
  };
  app.post(
    "/api/seeker/bookings/:id/coupon",
    requireAuth,
    requireRole("seeker"),
    expensiveRouteLimiter,
    validateBody(apiSchemas.couponApply),
    async (req, res) => {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Payment service is temporarily unavailable." } });
      }
      const { code } = req.body;
      try {
        const { data, error } = await admin.rpc("apply_coupon_to_booking", {
          p_booking_id: req.params.id,
          p_coupon_code: code,
          // From the verified token, never from the body: this is the value the
          // RPC checks ownership against.
          p_seeker_id: req.auth.user.id
        });
        if (error) return respondCouponRefusal(res, error);
        const pricing = await readBookingPricing(admin, req.params.id);
        auditAction(req.auth, "coupon_applied", {
          entityType: "booking",
          entityId: req.params.id,
          requestId: req.requestId,
          metadata: {
            couponCode: pricing?.coupon_code ?? code,
            discountAmountInr: pricing?.discount_amount_inr ?? null,
            amountInr: pricing?.amount_inr ?? null
          }
        });
        return res.json({ success: true, booking: pricing });
      } catch (err) {
        return respondWithInternalError({ req, res, error: err, context: "POST /api/seeker/bookings/:id/coupon" });
      }
    }
  );
  app.delete(
    "/api/seeker/bookings/:id/coupon",
    requireAuth,
    requireRole("seeker"),
    expensiveRouteLimiter,
    async (req, res) => {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Payment service is temporarily unavailable." } });
      }
      try {
        const { error } = await admin.rpc("remove_coupon_from_booking", {
          p_booking_id: req.params.id,
          p_seeker_id: req.auth.user.id
        });
        if (error) return respondCouponRefusal(res, error);
        const pricing = await readBookingPricing(admin, req.params.id);
        auditAction(req.auth, "coupon_removed", {
          entityType: "booking",
          entityId: req.params.id,
          requestId: req.requestId,
          metadata: { amountInr: pricing?.amount_inr ?? null }
        });
        return res.json({ success: true, booking: pricing });
      } catch (err) {
        return respondWithInternalError({ req, res, error: err, context: "DELETE /api/seeker/bookings/:id/coupon" });
      }
    }
  );
  const respondRazorpayFailure = (res, error) => res.status(error.httpStatus).json({
    success: false,
    error: { code: error.code, message: error.message }
  });
  app.post(
    "/api/seeker/bookings/:id/razorpay/order",
    requireAuth,
    requireRole("seeker"),
    expensiveRouteLimiter,
    async (req, res) => {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({
          success: false,
          error: { code: "SERVICE_UNAVAILABLE", message: "Payment service is temporarily unavailable." }
        });
      }
      try {
        const result = await runCreateRazorpayOrder({
          bookingId: req.params.id,
          callerId: req.auth.user.id,
          gateway: createRazorpayGatewayClient(),
          store: createSupabaseRazorpayStore(admin)
        });
        if (!result.ok) {
          auditAction(req.auth, "razorpay_order_rejected", {
            entityType: "booking",
            entityId: req.params.id,
            requestId: req.requestId,
            metadata: { code: result.error.code }
          });
          return respondRazorpayFailure(res, result.error);
        }
        auditAction(req.auth, "razorpay_order_created", {
          entityType: "payment",
          entityId: result.value.paymentId,
          requestId: req.requestId,
          metadata: {
            bookingId: result.value.bookingId ?? req.params.id,
            amountInr: result.value.amountInr,
            reusedExistingOrder: result.value.alreadyCreated
          }
        });
        return res.status(result.value.alreadyCreated ? 200 : 201).json({
          success: true,
          // Enough for the browser to open Razorpay checkout. No secret.
          razorpayOrderId: result.value.razorpayOrderId,
          razorpayKeyId: result.value.razorpayKeyId,
          amountInr: result.value.amountInr,
          currency: result.value.currency,
          paymentId: result.value.paymentId,
          message: "Payment order created."
        });
      } catch (err) {
        return respondWithInternalError({ req, res, error: err, context: "POST /api/seeker/bookings/:id/razorpay/order" });
      }
    }
  );
  app.post(
    "/api/seeker/bookings/:id/razorpay/verify",
    requireAuth,
    requireRole("seeker"),
    expensiveRouteLimiter,
    async (req, res) => {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({
          success: false,
          error: { code: "SERVICE_UNAVAILABLE", message: "Payment service is temporarily unavailable." }
        });
      }
      try {
        const body = req.body ?? {};
        const result = await runVerifyRazorpayPayment({
          bookingId: req.params.id,
          callerId: req.auth.user.id,
          razorpayOrderId: body.razorpayOrderId,
          razorpayPaymentId: body.razorpayPaymentId,
          razorpaySignature: body.razorpaySignature,
          gateway: createRazorpayGatewayClient(),
          store: createSupabaseRazorpayStore(admin)
        });
        if (!result.ok) {
          auditAction(req.auth, "razorpay_payment_verification_failed", {
            entityType: "booking",
            entityId: req.params.id,
            requestId: req.requestId,
            metadata: { code: result.error.code }
          });
          return respondRazorpayFailure(res, result.error);
        }
        if (result.value.mentorNotified) {
          const { data: booking } = await admin.from("bookings").select("mentor_id, amount_inr").eq("id", result.value.bookingId).maybeSingle();
          if (booking) {
            await notifyMentorOfPaymentCaptured(admin, {
              mentorId: booking.mentor_id,
              bookingId: result.value.bookingId,
              paymentId: result.value.paymentId,
              amountInr: booking.amount_inr,
              source: "razorpay"
            });
          }
        }
        auditAction(req.auth, "razorpay_payment_verified", {
          entityType: "payment",
          entityId: result.value.paymentId,
          requestId: req.requestId,
          metadata: {
            bookingId: result.value.bookingId,
            duplicate: result.value.duplicate,
            mentorNotified: result.value.mentorNotified
          }
        });
        return res.json({
          success: true,
          paymentId: result.value.paymentId,
          bookingId: result.value.bookingId,
          bookingStatus: result.value.bookingStatus,
          paymentStatus: result.value.paymentStatus,
          message: "Payment confirmed."
        });
      } catch (err) {
        return respondWithInternalError({ req, res, error: err, context: "POST /api/seeker/bookings/:id/razorpay/verify" });
      }
    }
  );
  app.post("/api/webhooks/razorpay", async (req, res) => {
    const admin = getSupabaseAdmin();
    if (!admin) {
      return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Webhook handler is not configured." } });
    }
    const rawBody = req.rawBody?.toString("utf8") ?? "";
    if (!rawBody) {
      return res.status(400).json({ success: false, error: { code: "RAZORPAY_WEBHOOK_EMPTY", message: "Empty webhook body." } });
    }
    try {
      const result = await runRazorpayWebhook({
        rawBody,
        signature: extractWebhookSignature(req.headers),
        gateway: createRazorpayGatewayClient(),
        store: createSupabaseRazorpayStore(admin)
      });
      if (!result.ok) {
        logger.auth("razorpay_webhook_rejected", {
          requestId: req.requestId,
          path: "/api/webhooks/razorpay",
          result: "failure",
          reason: result.error.code
        });
        if ("unmatchedCapture" in result) {
          const signal = result.unmatchedCapture;
          auditAction(void 0, "razorpay_capture_unmatched", {
            entityType: "payment",
            entityId: signal.gatewayPaymentId ?? "unknown",
            requestId: req.requestId,
            metadata: {
              reason: signal.reason,
              recorded: signal.recorded,
              unmatchedCaptureId: "unmatchedCaptureId" in signal ? signal.unmatchedCaptureId : null,
              deliveryCount: "deliveryCount" in signal ? signal.deliveryCount : null
            }
          });
        }
        return respondRazorpayFailure(res, result.error);
      }
      if (result.mentorNotified && result.bookingId) {
        const { data: booking } = await admin.from("bookings").select("mentor_id, amount_inr").eq("id", result.bookingId).maybeSingle();
        if (booking) {
          await notifyMentorOfPaymentCaptured(admin, {
            mentorId: booking.mentor_id,
            bookingId: result.bookingId,
            // The real payment row, so the notification links to it.
            paymentId: result.paymentId ?? "",
            amountInr: booking.amount_inr,
            source: "razorpay"
          });
        }
      }
      logger.auth("razorpay_webhook_processed", {
        requestId: req.requestId,
        path: "/api/webhooks/razorpay",
        result: "success",
        reason: `${result.handled}${result.duplicateEvent ? ":duplicate" : ""}`
      });
      return res.json({ success: true, handled: result.handled, duplicate: result.duplicateEvent });
    } catch (err) {
      logger.auth("razorpay_webhook_error", {
        requestId: req.requestId,
        path: "/api/webhooks/razorpay",
        result: "failure",
        reason: "WEBHOOK_PROCESSING_FAILED"
      });
      return respondWithInternalError({ req, res, error: err, context: "POST /api/webhooks/razorpay" });
    }
  });
  app.get("/api/admin/unmatched-captures", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const rows = await listUnmatchedCaptures(createSupabaseRazorpayStore(admin), { limit: 100 });
      return res.json({
        success: true,
        unmatchedCaptures: rows.map((row) => ({
          id: row.id,
          gateway: row.gateway,
          eventId: row.event_id,
          lastEventId: row.last_event_id,
          eventType: row.event_type,
          razorpayPaymentId: row.razorpay_payment_id,
          razorpayOrderId: row.razorpay_order_id,
          amountPaise: row.amount_paise,
          currency: row.currency,
          receivedAt: row.received_at,
          reason: row.reason,
          reconciliationStatus: row.reconciliation_status,
          deliveryCount: row.delivery_count,
          resolvedPaymentId: row.resolved_payment_id,
          resolutionNote: row.resolution_note
        }))
      });
    } catch (err) {
      console.error("Failed to list unmatched captures:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.post(
    "/api/admin/unmatched-captures/:id/reconcile",
    requireAuth,
    requireAdmin,
    expensiveRouteLimiter,
    async (req, res) => {
      try {
        const admin = getSupabaseAdmin();
        if (!admin) {
          return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
        }
        const result = await reconcileUnmatchedCapture({
          store: createSupabaseRazorpayStore(admin),
          unmatchedCaptureId: req.params.id,
          actorId: req.auth.user.id
        });
        auditAction(req.auth, "razorpay_unmatched_capture_reconciled", {
          entityType: "payment",
          entityId: "unmatchedCaptureId" in result ? result.unmatchedCaptureId : req.params.id,
          requestId: req.requestId,
          metadata: { status: result.status }
        });
        if (result.status === "CONFLICT") {
          return res.status(409).json({
            success: false,
            error: { code: "UNMATCHED_CAPTURE_CONFLICT", message: result.detail },
            result
          });
        }
        if (result.status === "NOT_FOUND") {
          return res.status(404).json({
            success: false,
            error: { code: "UNMATCHED_CAPTURE_NOT_FOUND", message: result.reason },
            result
          });
        }
        if (result.status === "ALREADY_RESOLVED") {
          return res.status(409).json({
            success: false,
            error: { code: "UNMATCHED_CAPTURE_ALREADY_RESOLVED", message: "This capture was already reconciled." },
            result
          });
        }
        return res.json({ success: true, result });
      } catch (err) {
        console.error("Failed to reconcile unmatched capture:", logSanitizer.safeMessage(err));
        return respondWithInternalError({ req, res, error: err });
      }
    }
  );
  app.get("/api/payments/razorpay/config", requireAuth, async (_req, res) => {
    const enabled = isRazorpayEnabled();
    return res.json({
      success: true,
      enabled,
      currency: enabled ? "INR" : null,
      // Read through the config module so this can never drift from what the
      // order-creation path uses. Absent rather than a placeholder when
      // disabled: an empty value must never be mistaken for a real key.
      razorpayKeyId: enabled ? getRazorpayKeyId() || null : null
    });
  });
  app.post("/api/seeker/bookings/:id/cancel", requireAuth, requireRole("seeker"), validateBody(apiSchemas.bookingCancel), async (req, res) => {
    try {
      const bookingId = req.params.id;
      const callerId = req.auth.user.id;
      const { reason } = req.body;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Booking service is temporarily unavailable." } });
      }
      const now = /* @__PURE__ */ new Date();
      const { data: booking, error: bookingErr } = await admin.from("bookings").select("id, booking_code, seeker_id, mentor_id, status, start_time, hold_id, cancellation_reason, amount_inr").eq("id", bookingId).maybeSingle();
      if (bookingErr) throw bookingErr;
      if (!booking) {
        return res.status(404).json({ success: false, error: { code: "BOOKING_NOT_FOUND", message: "Booking not found." } });
      }
      if (booking.seeker_id !== callerId) {
        return res.status(403).json({ success: false, error: { code: "FORBIDDEN_NOT_BOOKING_OWNER", message: "You are not authorized to cancel this booking." } });
      }
      const cancellableStatuses = ["PAYMENT_PENDING", "PENDING_VERIFICATION", "MENTOR_PENDING", "CONFIRMED"];
      if (!cancellableStatuses.includes(booking.status)) {
        return res.status(409).json({
          success: false,
          error: { code: "BOOKING_NOT_CANCELLABLE", message: `This booking is ${booking.status.toLowerCase().replace(/_/g, " ")} and cannot be cancelled.` }
        });
      }
      const sessionStartMs = new Date(booking.start_time).getTime();
      const nowMs = now.getTime();
      const minutesUntilStart = (sessionStartMs - nowMs) / (1e3 * 60);
      if (minutesUntilStart < APP_CONFIG.NORMAL_CANCELLATION_WINDOW_MINUTES) {
        return res.status(409).json({
          success: false,
          error: {
            code: "CANCELLATION_WINDOW_CLOSED",
            message: `Normal cancellation is only available until ${APP_CONFIG.NORMAL_CANCELLATION_WINDOW_MINUTES} minutes before the session. The session starts in ${Math.ceil(minutesUntilStart)} minutes.`
          }
        });
      }
      if (booking.status === "PAYMENT_PENDING" && booking.hold_id) {
        await admin.from("slot_holds").update({ status: "RELEASED", updated_at: now.toISOString() }).eq("id", booking.hold_id).eq("status", "ACTIVE");
      }
      const { data: updatedBooking, error: updateErr } = await admin.from("bookings").update({
        status: "CANCELLED",
        cancellation_reason: reason || "Cancelled by seeker",
        updated_at: now.toISOString()
      }).eq("id", bookingId).select().single();
      if (updateErr) throw updateErr;
      const { data: payment } = await admin.from("payments").select("id, status, gateway, amount_inr").eq("booking_id", bookingId).maybeSingle();
      let refundInfo = null;
      if (payment && payment.status === "VERIFIED") {
        const refundReason = "seeker_cancellation_within_window";
        const gatewayClient = createRazorpayGatewayClient();
        const store = createSupabaseRazorpayStore(admin);
        const refundResult = await runCreateRazorpayRefund({
          bookingId,
          callerId,
          reason: refundReason,
          gateway: gatewayClient,
          store,
          now
        });
        if (refundResult.ok) {
          refundInfo = refundResult.value;
        }
      }
      await admin.from("notifications").insert({
        user_id: booking.seeker_id,
        title: "Booking Cancelled",
        message: `You cancelled booking ${booking.booking_code}.${reason ? ` Reason: ${reason}` : ""}`,
        type: "BOOKING",
        event_type: "CANCELLATION",
        entity_type: "booking",
        entity_id: booking.id,
        link: "/seeker/bookings",
        is_read: false
      });
      await admin.from("notifications").insert({
        user_id: booking.mentor_id,
        title: "Seeker Cancelled Booking",
        message: `The seeker cancelled booking ${booking.booking_code}. The slot is now available for new bookings.`,
        type: "BOOKING",
        event_type: "MENTOR_CANCELLATION",
        entity_type: "booking",
        entity_id: booking.id,
        link: "/mentor/bookings",
        is_read: false
      });
      if (refundInfo) {
        await notifyRefundState(admin, {
          booking,
          refundInfo,
          kind: refundInfo.status === "REFUND_INITIATED" ? "GATEWAY_PENDING" : "MANUAL_PENDING"
        });
      }
      auditAction(req.auth, "booking_cancelled", {
        entityType: "booking",
        entityId: booking.id,
        requestId: req.requestId,
        metadata: { bookingCode: booking.booking_code, reason: reason || "Cancelled by seeker", refund: refundInfo }
      });
      return res.json({
        success: true,
        booking: updatedBooking,
        message: "Booking cancelled successfully.",
        refund: refundInfo
      });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err, context: "POST /api/seeker/bookings/:id/cancel" });
    }
  });
  app.post("/api/seeker/bookings/:id/reschedule", requireAuth, requireRole("seeker"), validateBody(apiSchemas.bookingReschedule), async (req, res) => {
    try {
      const bookingId = req.params.id;
      const callerId = req.auth.user.id;
      const { newStartTime, newEndTime } = req.body;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Booking service is temporarily unavailable." } });
      }
      const { data, error } = await admin.rpc("create_reschedule_request", {
        p_booking_id: bookingId,
        p_seeker_id: callerId,
        p_requested_start_time: newStartTime,
        p_requested_end_time: newEndTime
      });
      if (error) {
        return res.status(rescheduleFailureStatus(error.message)).json({
          success: false,
          error: { code: rescheduleFailureCode(error.message), message: rescheduleFailureReason(error.message) }
        });
      }
      auditAction(req.auth, "reschedule_requested", {
        entityType: "booking",
        entityId: bookingId,
        requestId: req.requestId,
        metadata: { requestedStartTime: newStartTime, requestedEndTime: newEndTime, rescheduleRequestId: data?.request?.id }
      });
      return res.status(201).json({
        success: true,
        request: data?.request || null,
        holdExpiresAt: data?.hold_expires_at || null,
        message: "Reschedule request sent to mentor."
      });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err, context: "POST /api/seeker/bookings/:id/reschedule" });
    }
  });
  app.get("/api/seeker/bookings/:id/reschedule-request", requireAuth, requireRole("seeker"), async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Booking service is temporarily unavailable." } });
      }
      const { data, error } = await admin.rpc("get_reschedule_request_for_booking", {
        p_booking_id: req.params.id,
        p_caller_id: req.auth.user.id
      });
      if (error) throw error;
      return res.json({ success: true, request: data || null, serverNow: (/* @__PURE__ */ new Date()).toISOString() });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err, context: "GET /api/seeker/bookings/:id/reschedule-request" });
    }
  });
  app.post("/api/seeker/bookings/:id/reschedule-request/cancel", requireAuth, requireRole("seeker"), async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Booking service is temporarily unavailable." } });
      }
      const { data: request, error: lookupErr } = await admin.from("reschedule_requests").select("id, booking_id").eq("booking_id", req.params.id).eq("seeker_id", req.auth.user.id).eq("status", "PENDING").maybeSingle();
      if (lookupErr) throw lookupErr;
      if (!request) {
        return res.status(404).json({
          success: false,
          error: { code: "RESCHEDULE_REQUEST_NOT_FOUND", message: "No pending reschedule request was found for this booking." }
        });
      }
      const { data, error } = await admin.rpc("cancel_reschedule_request", {
        p_request_id: request.id,
        p_seeker_id: req.auth.user.id
      });
      if (error) {
        return res.status(rescheduleFailureStatus(error.message)).json({
          success: false,
          error: { code: rescheduleFailureCode(error.message), message: rescheduleFailureReason(error.message) }
        });
      }
      auditAction(req.auth, "reschedule_request_cancelled", {
        entityType: "booking",
        entityId: req.params.id,
        requestId: req.requestId,
        metadata: { rescheduleRequestId: request.id }
      });
      return res.json({ success: true, request: data || null, message: "Reschedule request withdrawn." });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err, context: "POST /api/seeker/bookings/:id/reschedule-request/cancel" });
    }
  });
  app.get("/api/mentor/bookings/:id/reschedule-request", requireAuth, requireRole("mentor"), async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Booking service is temporarily unavailable." } });
      }
      const { data, error } = await admin.rpc("get_reschedule_request_for_booking", {
        p_booking_id: req.params.id,
        p_caller_id: req.auth.user.id
      });
      if (error) throw error;
      return res.json({ success: true, request: data || null, serverNow: (/* @__PURE__ */ new Date()).toISOString() });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err, context: "GET /api/mentor/bookings/:id/reschedule-request" });
    }
  });
  app.post("/api/mentor/reschedule-requests/:id/respond", requireAuth, requireRole("mentor"), validateBody(apiSchemas.rescheduleRespond), async (req, res) => {
    try {
      const mentorId = req.auth.user.id;
      const { decision, reason } = req.body;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Booking service is temporarily unavailable." } });
      }
      const { data: request, error: lookupErr } = await admin.from("reschedule_requests").select("id, booking_id").eq("id", req.params.id).maybeSingle();
      if (lookupErr) throw lookupErr;
      if (!request) {
        return res.status(404).json({
          success: false,
          error: { code: "RESCHEDULE_REQUEST_NOT_FOUND", message: "Reschedule request not found." }
        });
      }
      const { data, error } = await admin.rpc("respond_to_reschedule_request", {
        p_request_id: request.id,
        p_mentor_id: mentorId,
        p_decision: decision,
        p_reason: reason?.trim() || null
      });
      if (error) {
        return res.status(rescheduleFailureStatus(error.message)).json({
          success: false,
          error: { code: rescheduleFailureCode(error.message), message: rescheduleFailureReason(error.message) }
        });
      }
      auditAction(req.auth, decision === "APPROVED" ? "reschedule_approved" : "reschedule_rejected", {
        entityType: "booking",
        entityId: request.booking_id,
        requestId: req.requestId,
        metadata: { rescheduleRequestId: request.id, reason: reason?.trim() || null }
      });
      return res.json({
        success: true,
        decision,
        requestId: request.id,
        booking: data?.booking || null,
        message: decision === "APPROVED" ? "Reschedule approved." : "Reschedule request declined."
      });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err, context: "POST /api/mentor/reschedule-requests/:id/respond" });
    }
  });
  app.post("/api/mentor/bookings/:id/confirm", requireAuth, requireRole("mentor"), validateBody(apiSchemas.mentorBookingConfirm), async (req, res) => {
    try {
      const bookingId = req.params.id;
      const mentorId = req.auth.user.id;
      const { meetingUrl } = req.body;
      const admin = getSupabaseAdmin();
      if (admin) {
        const confirmNowMs = Date.now();
        const { data: prior } = await admin.from("bookings").select("start_time, status, meeting_url").eq("id", bookingId).maybeSingle();
        const deadlineOpen = prior ? isMeetingLinkDeadlineOpen(prior, confirmNowMs) : null;
        const { data: booking, error } = await admin.rpc("confirm_booking", {
          p_booking_id: bookingId,
          p_meeting_url: meetingUrl,
          p_mentor_id: mentorId
        });
        if (error) throw error;
        return res.json({
          success: true,
          booking,
          isOverdue: deadlineOpen === false,
          confirmedAfterDeadline: deadlineOpen === false,
          message: deadlineOpen === false ? "Session confirmed after the recommended meeting-link deadline." : "Session confirmed."
        });
      }
      const db = getLocalBookingEngineContext();
      const result = await confirmSessionByMentor(
        {
          bookingId,
          mentorId,
          meetingUrl,
          currentUtcTime: /* @__PURE__ */ new Date()
        },
        db
      );
      if (!result.success) {
        const code = result.error?.code;
        if (code === "FORBIDDEN_NOT_BOOKING_OWNER") {
          return res.status(403).json(result);
        }
        if (code === "BOOKING_NOT_FOUND") {
          return res.status(404).json(result);
        }
        if (code === "ALREADY_CONFIRMED") {
          return res.status(409).json(result);
        }
        return res.status(400).json(result);
      }
      const enriched = enrichBooking(result.booking, db);
      return res.json({
        success: true,
        booking: enriched,
        isOverdue: result.isOverdue,
        message: result.message
      });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.post("/api/mentor/bookings/:id/cancel", requireAuth, requireRole("mentor"), validateBody(apiSchemas.bookingCancel), async (req, res) => {
    try {
      const bookingId = req.params.id;
      const mentorId = req.auth.user.id;
      const { reason } = req.body;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Booking service is temporarily unavailable." } });
      }
      const now = /* @__PURE__ */ new Date();
      const { data: booking, error: bookingErr } = await admin.from("bookings").select("id, booking_code, seeker_id, mentor_id, status, start_time, hold_id, cancellation_reason, amount_inr").eq("id", bookingId).maybeSingle();
      if (bookingErr) throw bookingErr;
      if (!booking) {
        return res.status(404).json({ success: false, error: { code: "BOOKING_NOT_FOUND", message: "Booking not found." } });
      }
      if (booking.mentor_id !== mentorId) {
        return res.status(403).json({ success: false, error: { code: "FORBIDDEN_NOT_BOOKING_OWNER", message: "You are not authorized to cancel this booking." } });
      }
      const cancellableStatuses = ["PAYMENT_PENDING", "PENDING_VERIFICATION", "MENTOR_PENDING", "CONFIRMED"];
      if (!cancellableStatuses.includes(booking.status)) {
        return res.status(409).json({
          success: false,
          error: { code: "BOOKING_NOT_CANCELLABLE", message: `This booking is ${booking.status.toLowerCase().replace(/_/g, " ")} and cannot be cancelled.` }
        });
      }
      if (booking.status === "PAYMENT_PENDING" && booking.hold_id) {
        await admin.from("slot_holds").update({ status: "RELEASED", updated_at: now.toISOString() }).eq("id", booking.hold_id).eq("status", "ACTIVE");
      }
      const { data: updatedBooking, error: updateErr } = await admin.from("bookings").update({
        status: "CANCELLED",
        cancellation_reason: reason || "Cancelled by mentor",
        updated_at: now.toISOString()
      }).eq("id", bookingId).select().single();
      if (updateErr) throw updateErr;
      const { data: payment } = await admin.from("payments").select("id, status, gateway, amount_inr").eq("booking_id", bookingId).maybeSingle();
      let refundInfo = null;
      if (payment && payment.status === "VERIFIED") {
        const refundReason = "mentor_cancellation";
        const gatewayClient = createRazorpayGatewayClient();
        const store = createSupabaseRazorpayStore(admin);
        const refundResult = await runCreateRazorpayRefund({
          bookingId,
          callerId: mentorId,
          reason: refundReason,
          gateway: gatewayClient,
          store,
          now
        });
        if (refundResult.ok) {
          refundInfo = refundResult.value;
        }
      }
      await admin.from("notifications").insert({
        user_id: booking.seeker_id,
        title: "Mentor Cancelled Booking",
        message: `The mentor cancelled booking ${booking.booking_code}.${reason ? ` Reason: ${reason}` : ""}`,
        type: "BOOKING",
        event_type: "CANCELLATION",
        entity_type: "booking",
        entity_id: booking.id,
        link: "/seeker/bookings",
        is_read: false
      });
      await admin.from("notifications").insert({
        user_id: booking.mentor_id,
        title: "Booking Cancelled",
        message: `You cancelled booking ${booking.booking_code}. The slot is now available for new bookings.`,
        type: "BOOKING",
        event_type: "MENTOR_CANCELLATION",
        entity_type: "booking",
        entity_id: booking.id,
        link: "/mentor/bookings",
        is_read: false
      });
      if (refundInfo) {
        await notifyRefundState(admin, {
          booking,
          refundInfo,
          kind: refundInfo.status === "REFUND_INITIATED" ? "GATEWAY_PENDING" : "MANUAL_PENDING"
        });
      }
      auditAction(req.auth, "booking_cancelled", {
        entityType: "booking",
        entityId: booking.id,
        requestId: req.requestId,
        metadata: { bookingCode: booking.booking_code, reason: reason || "Cancelled by mentor", cancelledBy: "mentor", refund: refundInfo }
      });
      return res.json({
        success: true,
        booking: updatedBooking,
        message: "Booking cancelled successfully.",
        refund: refundInfo
      });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err, context: "POST /api/mentor/bookings/:id/cancel" });
    }
  });
  app.get("/api/admin/bookings/overdue-links", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({
          success: false,
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "The service is temporarily unavailable. Please try again shortly."
          }
        });
      }
      const { data, error } = await admin.from("bookings").select(
        "id, booking_code, mentor_id, seeker_id, start_time, end_time, status, meeting_url, amount_inr"
      ).eq("status", "MENTOR_PENDING").is("meeting_url", null).order("start_time", { ascending: true }).limit(200);
      if (error) {
        return respondWithInternalError({ req, res, error });
      }
      const nowMs = Date.now();
      const bookings = (data ?? []).map((b) => {
        const startMs = b.start_time ? new Date(b.start_time).getTime() : null;
        const minutesUntilStart = startMs === null ? null : Math.round((startMs - nowMs) / 6e4);
        const lifecycle = resolveBookingLifecycle(b, nowMs);
        return {
          ...b,
          minutes_until_start: minutesUntilStart,
          meeting_link_deadline: lifecycle.meetingLinkDeadlineUtc,
          is_overdue: lifecycle.isOverdue,
          overdue_by_ms: lifecycle.overdueByMs,
          session_started: lifecycle.sessionStarted
        };
      });
      return res.json({
        success: true,
        count: bookings.length,
        bookings
      });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.get("/api/admin/bookings", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: bookings, error: bookingsErr } = await admin.from("bookings").select(`
          *,
          seeker:profiles!bookings_seeker_id_fkey(id, full_name, email, timezone),
          mentor:profiles!bookings_mentor_id_fkey(id, full_name, email, timezone),
          gig:gigs(id, title, duration_minutes, price_inr, segment_id),
          segment:segments(id, name, slug)
        `).order("start_time", { ascending: true });
      if (bookingsErr) throw bookingsErr;
      const adminNowMs = Date.now();
      const reconciledBookings = await reconcileAndAnnotateBookingRows(
        admin,
        [...bookings || []],
        adminNowMs
      );
      const bookingIds = (bookings || []).map((b) => b.id);
      const { data: payments, error: paymentsErr } = bookingIds.length ? await admin.from("payments").select("*").in("booking_id", bookingIds) : { data: [], error: null };
      if (paymentsErr) throw paymentsErr;
      const paymentByBooking = /* @__PURE__ */ new Map();
      for (const payment of payments || []) {
        paymentByBooking.set(payment.booking_id, payment);
      }
      const enrichedBookings = reconciledBookings.map((booking) => {
        const payment = paymentByBooking.get(booking.id);
        const lifecycle = resolveBookingLifecycle(booking, adminNowMs);
        return {
          ...booking,
          payment: payment ? {
            id: payment.id,
            status: payment.status,
            amount_inr: payment.amount_inr,
            verified_at: payment.verified_at,
            proof_storage_path: payment.proof_storage_path,
            transaction_reference: payment.transaction_reference
          } : null,
          lifecycle,
          // Retained for the admin UI's raw deadline readout. `lifecycle` is
          // what decides classification, so these two cannot disagree.
          deadlineInfo: {
            deadlineUtc: lifecycle.meetingLinkDeadlineUtc,
            isOverdue: lifecycle.isOverdue,
            hoursUntilSession: Math.max(
              0,
              Math.round((new Date(booking.start_time).getTime() - adminNowMs) / (1e3 * 60 * 60))
            ),
            minutesUntilSession: Math.max(
              0,
              Math.round((new Date(booking.start_time).getTime() - adminNowMs) / (1e3 * 60))
            )
          }
        };
      });
      return res.json({
        success: true,
        bookings: enrichedBookings,
        serverNow: new Date(adminNowMs).toISOString()
      });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "GET /api/admin/bookings",
        clientMessage: "Unable to load admin bookings."
      });
    }
  });
  app.get("/api/mentor/segments", requireAuth, requireRole("mentor"), async (req, res) => {
    try {
      const mentorId = req.auth.user.id;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: mentorSegments, error: msErr } = await admin.from("mentor_segments").select("*, segment:segments(*)").eq("mentor_id", mentorId);
      if (msErr) throw msErr;
      const segments = (mentorSegments || []).map((ms) => ({
        id: ms.segment?.id,
        name: ms.segment?.name,
        slug: ms.segment?.slug,
        status: ms.segment?.is_active ? "APPROVED" : "INACTIVE",
        appliedAt: ms.created_at ? new Date(ms.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Unknown",
        gigsCount: 0
        // Will be populated below
      }));
      if (segments.length > 0) {
        const segmentIds = segments.map((s) => s.id);
        const { data: gigs, error: gigsErr } = await admin.from("gigs").select("segment_id").eq("mentor_id", mentorId).eq("is_active", true).in("segment_id", segmentIds);
        if (!gigsErr && gigs) {
          const gigCounts = gigs.reduce((acc, g) => {
            acc[g.segment_id] = (acc[g.segment_id] || 0) + 1;
            return acc;
          }, {});
          segments.forEach((s) => {
            s.gigsCount = gigCounts[s.id] || 0;
          });
        }
      }
      return res.json({ success: true, segments });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.get("/api/mentor/gigs", requireAuth, requireRole("mentor"), async (req, res) => {
    try {
      const mentorId = req.auth.user.id;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: gigs, error: gigsErr } = await admin.from("gigs").select(`
          *,
          segment:segments(*)
        `).eq("mentor_id", mentorId).order("created_at", { ascending: false });
      if (gigsErr) throw gigsErr;
      const formattedGigs = (gigs || []).map((g) => ({
        id: g.id,
        title: g.title,
        // The segment id is what the topic editor filters on, so the client
        // never has to guess which segment a gig belongs to from its name.
        segmentId: g.segment_id,
        segmentName: g.segment?.name || "Unknown",
        segmentSlug: g.segment?.slug || "unknown",
        durationMinutes: g.duration_minutes,
        priceInr: g.price_inr,
        isActive: g.is_active,
        description: g.description
      }));
      return res.json({ success: true, gigs: formattedGigs });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.post("/api/mentor/gigs", requireAuth, requireRole("mentor"), requireActiveMentor, validateBody(apiSchemas.gigCreate), async (req, res) => {
    try {
      const { title, segmentId, durationMinutes, priceInr, originalPriceInr, description } = req.body;
      const mentorId = req.auth.user.id;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: msData, error: msErr } = await admin.from("mentor_segments").select("*").eq("mentor_id", mentorId).eq("segment_id", segmentId).maybeSingle();
      if (msErr) throw msErr;
      if (!msData) {
        return res.status(403).json({
          success: false,
          error: { code: "FORBIDDEN", message: "You are not approved for this segment." }
        });
      }
      const { data: gig, error } = await admin.from("gigs").insert({
        mentor_id: mentorId,
        segment_id: segmentId,
        title,
        duration_minutes: durationMinutes,
        price_inr: priceInr,
        // `null` clears a struck-through price. The database refuses any value
        // that is not strictly greater than `price_inr`, so a "was ₹100 / now
        // ₹100" card cannot be saved.
        original_price_inr: originalPriceInr ?? null,
        description: description || "",
        is_active: true
      }).select().single();
      if (error) throw error;
      return res.json({ success: true, gig });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.get("/api/mentor/topics", requireAuth, requireRole("mentor"), async (req, res) => {
    try {
      const mentorId = req.auth.user.id;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: memberships, error: msErr } = await admin.from("mentor_segments").select("segment_id, segment:segments(id, name, slug)").eq("mentor_id", mentorId);
      if (msErr) throw msErr;
      const segmentIds = Array.from(
        new Set((memberships || []).map((m) => m.segment_id).filter(Boolean))
      );
      if (segmentIds.length === 0) {
        return res.json({ success: true, topics: [] });
      }
      const { data: topics, error } = await admin.from("segment_topics").select("id, segment_id, name, slug, description, priority").in("segment_id", segmentIds).eq("is_active", true).order("priority", { ascending: true }).order("name", { ascending: true });
      if (error) throw error;
      const nameById = new Map(
        (memberships || []).map((m) => [m.segment_id, m.segment?.name ?? ""])
      );
      return res.json({
        success: true,
        topics: (topics || []).map((t) => ({
          ...t,
          segmentName: nameById.get(t.segment_id) || ""
        }))
      });
    } catch (err) {
      console.error("Failed to list mentor topics:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err, context: "GET /api/mentor/topics" });
    }
  });
  app.get("/api/mentor/gigs/:id/topics", requireAuth, requireRole("mentor"), async (req, res) => {
    try {
      const mentorId = req.auth.user.id;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { id } = req.params;
      if (!UUID_SHAPE_PATTERN.test(id)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_GIG_ID", message: "Gig ID must be a valid UUID." } });
      }
      const { data: gig, error: gigErr } = await admin.from("gigs").select("id").eq("id", id).eq("mentor_id", mentorId).maybeSingle();
      if (gigErr) throw gigErr;
      if (!gig) {
        return res.status(404).json({ success: false, error: { code: "GIG_NOT_FOUND", message: "Gig not found." } });
      }
      const { data, error } = await admin.from("gig_topics").select("topic_id").eq("gig_id", id);
      if (error) throw error;
      return res.json({ success: true, topicIds: (data || []).map((r) => r.topic_id) });
    } catch (err) {
      console.error("Failed to read gig topics:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err, context: "GET /api/mentor/gigs/:id/topics" });
    }
  });
  app.put("/api/mentor/gigs/:id/topics", requireAuth, requireRole("mentor"), validateBody(apiSchemas.gigTopicsUpdate), async (req, res) => {
    try {
      const mentorId = req.auth.user.id;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { id } = req.params;
      if (!UUID_SHAPE_PATTERN.test(id)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_GIG_ID", message: "Gig ID must be a valid UUID." } });
      }
      const { data: gig, error: gigErr } = await admin.from("gigs").select("id, segment_id").eq("id", id).eq("mentor_id", mentorId).maybeSingle();
      if (gigErr) throw gigErr;
      if (!gig) {
        return res.status(404).json({ success: false, error: { code: "GIG_NOT_FOUND", message: "Gig not found." } });
      }
      const requested = Array.from(new Set(req.body.topicIds || []));
      if (requested.length > 0) {
        const { data: topics, error: topicErr } = await admin.from("segment_topics").select("id, segment_id").in("id", requested);
        if (topicErr) throw topicErr;
        const found = topics || [];
        const foundIds = new Set(found.map((t) => t.id));
        const missing = requested.filter((topicId) => !foundIds.has(topicId));
        if (missing.length > 0) {
          return res.status(400).json({
            success: false,
            error: { code: "UNKNOWN_TOPIC", message: "One or more selected topics no longer exist. Reload and try again." }
          });
        }
        const foreign = found.filter((t) => t.segment_id !== gig.segment_id);
        if (foreign.length > 0) {
          return res.status(400).json({
            success: false,
            error: {
              code: "TOPIC_SEGMENT_MISMATCH",
              message: "A topic can only be attached to a gig in the same segment."
            }
          });
        }
      }
      const { data: before, error: beforeErr } = await admin.from("gig_topics").select("topic_id").eq("gig_id", id);
      if (beforeErr) throw beforeErr;
      const beforeIds = new Set((before || []).map((r) => r.topic_id));
      const toInsert = requested.filter((topicId) => !beforeIds.has(topicId));
      const toRemove = Array.from(beforeIds).filter((topicId) => !requested.includes(topicId));
      if (toRemove.length > 0) {
        const { error: removeErr } = await admin.from("gig_topics").delete().eq("gig_id", id).in("topic_id", toRemove);
        if (removeErr) throw removeErr;
      }
      if (toInsert.length > 0) {
        const { error: insertErr } = await admin.from("gig_topics").insert(toInsert.map((topic_id) => ({ gig_id: id, topic_id })));
        if (insertErr) throw insertErr;
      }
      auditAction(req.auth, "mentor_gig_topics_updated", {
        entityType: "gig",
        entityId: id,
        requestId: req.requestId,
        metadata: { added: toInsert.length, removed: toRemove.length, total: requested.length }
      });
      return res.json({ success: true, topicIds: requested });
    } catch (err) {
      console.error("Failed to update gig topics:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err, context: "PUT /api/mentor/gigs/:id/topics" });
    }
  });
  app.patch("/api/mentor/gigs/:id", requireAuth, requireRole("mentor"), requireActiveMentor, validateBody(apiSchemas.gigUpdate), async (req, res) => {
    try {
      const { id } = req.params;
      const { title, durationMinutes, priceInr, originalPriceInr, description, isActive } = req.body;
      const mentorId = req.auth.user.id;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: existing } = await admin.from("gigs").select("mentor_id").eq("id", id).maybeSingle();
      if (!existing || existing.mentor_id !== mentorId) {
        return res.status(403).json({
          success: false,
          error: { code: "FORBIDDEN", message: "Not authorized to update this gig." }
        });
      }
      const updates = { updated_at: (/* @__PURE__ */ new Date()).toISOString() };
      if (title !== void 0) updates.title = title;
      if (durationMinutes !== void 0) updates.duration_minutes = durationMinutes;
      if (priceInr !== void 0) updates.price_inr = priceInr;
      if (originalPriceInr !== void 0) updates.original_price_inr = originalPriceInr ?? null;
      if (description !== void 0) updates.description = description;
      if (isActive !== void 0) updates.is_active = isActive;
      const { data: gig, error } = await admin.from("gigs").update(updates).eq("id", id).select().single();
      if (error) throw error;
      return res.json({ success: true, gig });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.delete("/api/mentor/gigs/:id", requireAuth, requireRole("mentor"), requireActiveMentor, async (req, res) => {
    try {
      const { id } = req.params;
      const mentorId = req.auth.user.id;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: existing } = await admin.from("gigs").select("mentor_id").eq("id", id).maybeSingle();
      if (!existing || existing.mentor_id !== mentorId) {
        return res.status(403).json({
          success: false,
          error: { code: "FORBIDDEN", message: "Not authorized to delete this gig." }
        });
      }
      const { error } = await admin.from("gigs").delete().eq("id", id);
      if (error) throw error;
      return res.json({ success: true, message: "Gig deleted successfully." });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.get("/api/mentor/available-segments", requireAuth, requireRole("mentor"), async (req, res) => {
    try {
      const mentorId = req.auth.user.id;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: allSegments, error: segErr } = await admin.from("segments").select("*").eq("is_active", true).order("priority", { ascending: true });
      if (segErr) throw segErr;
      const { data: mentorSegments, error: msErr } = await admin.from("mentor_segments").select("segment_id").eq("mentor_id", mentorId);
      if (msErr) throw msErr;
      const mentorSegmentIds = new Set((mentorSegments || []).map((ms) => ms.segment_id));
      const availableSegments = (allSegments || []).filter((s) => !mentorSegmentIds.has(s.id)).map((s) => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        description: s.description
      }));
      return res.json({ success: true, segments: availableSegments });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.post("/api/mentor/segments/apply", requireAuth, requireRole("mentor"), requireActiveMentor, validateBody(apiSchemas.segmentApply), async (req, res) => {
    try {
      const mentorId = req.auth.user.id;
      const { segmentId } = req.body;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: existing } = await admin.from("mentor_segments").select("*").eq("mentor_id", mentorId).eq("segment_id", segmentId).maybeSingle();
      if (existing) {
        return res.status(409).json({
          success: false,
          error: { code: "CONFLICT", message: "Already applied for this segment." }
        });
      }
      const { data: segment } = await admin.from("segments").select("*").eq("id", segmentId).eq("is_active", true).maybeSingle();
      if (!segment) {
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Segment not found or inactive." }
        });
      }
      const { error } = await admin.from("mentor_segments").insert({
        mentor_id: mentorId,
        segment_id: segmentId
      });
      if (error) throw error;
      return res.json({ success: true, message: "Segment application submitted for admin review." });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.get("/api/mentor/availability", requireAuth, requireRole("mentor"), async (req, res) => {
    try {
      const mentorId = req.auth.user.id;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const [availabilityRes, exceptionsRes, profileRes] = await Promise.all([
        admin.from("mentor_availability").select("*").eq("mentor_id", mentorId).order("day_of_week", { ascending: true }).order("start_time", { ascending: true }),
        admin.from("mentor_availability_exceptions").select("*").eq("mentor_id", mentorId).order("exception_date", { ascending: true }),
        admin.from("profiles").select("timezone").eq("id", mentorId).maybeSingle()
      ]);
      if (availabilityRes.error) throw availabilityRes.error;
      if (exceptionsRes.error) throw exceptionsRes.error;
      if (profileRes.error) throw profileRes.error;
      return res.json({
        success: true,
        availability: availabilityRes.data || [],
        exceptions: exceptionsRes.data || [],
        timezone: profileRes.data?.timezone || APP_CONFIG.DEFAULT_TIMEZONE
      });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "GET /api/mentor/availability",
        clientMessage: "Unable to load availability."
      });
    }
  });
  app.put("/api/mentor/availability", requireAuth, requireRole("mentor"), requireActiveMentor, validateBody(apiSchemas.availability), async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const mentorId = req.auth.user.id;
      const { rules, timezone } = req.body;
      const resolvedTimezone = timezone ?? APP_CONFIG.DEFAULT_TIMEZONE;
      const rows = rules.map((rule) => ({
        mentor_id: mentorId,
        day_of_week: rule.dayOfWeek,
        start_time: rule.startTime,
        end_time: rule.endTime,
        timezone: resolvedTimezone,
        is_enabled: rule.isEnabled
      }));
      const { error: clearErr } = await admin.from("mentor_availability").delete().eq("mentor_id", mentorId);
      if (clearErr) throw clearErr;
      if (rows.length > 0) {
        const { error: insertErr } = await admin.from("mentor_availability").insert(rows);
        if (insertErr) throw insertErr;
      }
      auditAction(req.auth, MENTOR_ADMIN_AUDIT_ACTIONS.AVAILABILITY_UPDATED, {
        entityType: "mentor_availability",
        entityId: mentorId,
        requestId: req.requestId,
        metadata: { mentorId, ruleCount: rows.length, timezone: resolvedTimezone }
      });
      return res.json({ success: true, message: "Availability updated successfully.", ruleCount: rows.length });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "PUT /api/mentor/availability",
        clientMessage: "Unable to update availability."
      });
    }
  });
  app.put("/api/mentor/availability/exceptions", requireAuth, requireRole("mentor"), requireActiveMentor, validateBody(apiSchemas.availabilityExceptions), async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const mentorId = req.auth.user.id;
      const { exceptions } = req.body;
      const rows = exceptions.map((exception) => ({
        mentor_id: mentorId,
        exception_date: exception.exceptionDate,
        is_available: exception.isAvailable,
        start_time: exception.isAvailable ? exception.startTime ?? null : null,
        end_time: exception.isAvailable ? exception.endTime ?? null : null,
        reason: exception.reason ? exception.reason : null
      }));
      const { error: clearErr } = await admin.from("mentor_availability_exceptions").delete().eq("mentor_id", mentorId);
      if (clearErr) throw clearErr;
      if (rows.length > 0) {
        const { error: insertErr } = await admin.from("mentor_availability_exceptions").insert(rows);
        if (insertErr) throw insertErr;
      }
      auditAction(req.auth, MENTOR_ADMIN_AUDIT_ACTIONS.AVAILABILITY_UPDATED, {
        entityType: "mentor_availability_exceptions",
        entityId: mentorId,
        requestId: req.requestId,
        metadata: { mentorId, exceptionCount: rows.length }
      });
      return res.json({ success: true, message: "Date exceptions updated successfully.", exceptionCount: rows.length });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "PUT /api/mentor/availability/exceptions",
        clientMessage: "Unable to update date exceptions."
      });
    }
  });
  app.get("/api/mentor-availability/slots", requireAuth, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({
          success: false,
          error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." }
        });
      }
      const { mentorId, segmentId, gigId, date } = req.query;
      const mentorIdRaw = (mentorId || "").trim();
      const segmentIdRaw = (segmentId || "").trim();
      const gigIdRaw = (gigId || "").trim();
      const dateRaw = (date || "").trim();
      if (!UUID_SHAPE_PATTERN.test(mentorIdRaw) && !UUID_SHAPE_PATTERN.test(segmentIdRaw) && !UUID_SHAPE_PATTERN.test(gigIdRaw)) {
        return res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "A valid mentorId, segmentId or gigId query parameter is required."
          }
        });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
        return res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "date must be a YYYY-MM-DD calendar date." }
        });
      }
      let resolvedGig = null;
      if (gigIdRaw) {
        const { data: gigRow, error: gigErr } = await admin.from("gigs").select("id, mentor_id, segment_id, is_active").eq("id", gigIdRaw).maybeSingle();
        if (gigErr) throw gigErr;
        if (!gigRow) {
          return res.status(404).json({
            success: false,
            error: { code: "GIG_NOT_FOUND", message: "Session offer not found." }
          });
        }
        if (mentorIdRaw && gigRow.mentor_id !== mentorIdRaw) {
          return res.status(409).json({
            success: false,
            error: {
              code: "GIG_MISMATCH",
              message: "That session offer does not belong to this mentor."
            }
          });
        }
        if (segmentIdRaw && gigRow.segment_id !== segmentIdRaw) {
          return res.status(409).json({
            success: false,
            error: {
              code: "GIG_MISMATCH",
              message: "That session offer belongs to a different segment."
            }
          });
        }
        if (gigRow.is_active !== true) {
          return res.status(409).json({
            success: false,
            error: {
              code: "GIG_INACTIVE",
              message: "That session offer is no longer available."
            }
          });
        }
        resolvedGig = gigRow;
      }
      let mentorIds = [];
      if (mentorIdRaw) {
        const { data, error: error2 } = await admin.from("mentor_profiles").select("id").eq("id", mentorIdRaw).maybeSingle();
        if (error2) throw error2;
        if (!data) {
          return res.status(404).json({
            success: false,
            error: { code: "MENTOR_NOT_FOUND", message: "Mentor not found." }
          });
        }
        mentorIds = [mentorIdRaw];
      } else if (resolvedGig) {
        mentorIds = [resolvedGig.mentor_id];
      } else {
        const { data, error: error2 } = await admin.from("mentor_segments").select("mentor_id").eq("segment_id", segmentIdRaw);
        if (error2) throw error2;
        const segmentExists = await admin.from("segments").select("id").eq("id", segmentIdRaw).maybeSingle();
        if (segmentExists.error) throw segmentExists.error;
        if (!segmentExists.data) {
          return res.status(404).json({
            success: false,
            error: { code: "SEGMENT_NOT_FOUND", message: "Segment not found." }
          });
        }
        mentorIds = Array.from(
          new Set((data || []).map((row) => row.mentor_id).filter(Boolean))
        );
      }
      if (mentorIds.length === 0) {
        return res.json({
          success: true,
          date: dateRaw,
          generated_at: (/* @__PURE__ */ new Date()).toISOString(),
          mentors: []
        });
      }
      const now = /* @__PURE__ */ new Date();
      const { results, error } = await computeMentorSlotsForDate(admin, {
        mentorIds,
        dateStr: dateRaw,
        // Both are forwarded so the engine resolves the exact gig and re-checks
        // the pairing itself. The segment is never re-derived from a mentor
        // default or a `mentor_segments.is_primary` flag: it comes from the
        // route, or from the gig's own `segment_id`.
        segmentId: segmentIdRaw || resolvedGig?.segment_id || void 0,
        gigId: gigIdRaw || void 0,
        now
      });
      if (error) throw error;
      return res.json({
        success: true,
        date: dateRaw,
        generated_at: now.toISOString(),
        mentors: mentorIds.map((id) => results.get(id)).filter(Boolean)
      });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "GET /api/mentor-availability/slots",
        clientMessage: "Unable to load availability."
      });
    }
  });
  app.get("/api/admin/mentors", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({
          success: false,
          error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." }
        });
      }
      const { data: mentorRoles, error: rolesErr } = await admin.from("user_roles").select("user_id").eq("role", "mentor");
      if (rolesErr) throw rolesErr;
      if (!mentorRoles || mentorRoles.length === 0) {
        return res.json({ success: true, mentors: [] });
      }
      const mentorIds = mentorRoles.map((mr) => mr.user_id);
      const { data: profiles, error: profilesErr } = await admin.from("profiles").select("id, email, full_name, timezone, created_at, updated_at").in("id", mentorIds);
      if (profilesErr) throw profilesErr;
      const { data: mentorProfiles, error: mpErr } = await admin.from("mentor_profiles").select("*").in("id", mentorIds);
      if (mpErr) throw mpErr;
      const { data: mentorSegments, error: msErr } = await admin.from("mentor_segments").select("*, segment:segments(*)").in("mentor_id", mentorIds);
      if (msErr) throw msErr;
      const { data: gigs, error: gigsErr } = await admin.from("gigs").select("*").in("mentor_id", mentorIds);
      if (gigsErr) throw gigsErr;
      const mentorMap = /* @__PURE__ */ new Map();
      for (const p of profiles || []) {
        mentorMap.set(p.id, {
          id: p.id,
          email: p.email,
          full_name: p.full_name,
          timezone: p.timezone,
          created_at: p.created_at,
          updated_at: p.updated_at
        });
      }
      const mpMap = /* @__PURE__ */ new Map();
      for (const mp of mentorProfiles || []) {
        mpMap.set(mp.id, mp);
      }
      const msMap = /* @__PURE__ */ new Map();
      for (const ms of mentorSegments || []) {
        if (!msMap.has(ms.mentor_id)) msMap.set(ms.mentor_id, []);
        msMap.get(ms.mentor_id).push(ms);
      }
      const gigMap = /* @__PURE__ */ new Map();
      for (const g of gigs || []) {
        if (!gigMap.has(g.mentor_id)) gigMap.set(g.mentor_id, []);
        gigMap.get(g.mentor_id).push(g);
      }
      const { data: accountProfiles, error: accountErr } = await admin.from("profiles").select("id, account_status, suspended_at, suspended_until, suspension_reason, deactivated_at").in("id", mentorIds);
      if (accountErr) throw accountErr;
      const accountMap = /* @__PURE__ */ new Map();
      for (const row of accountProfiles || []) {
        accountMap.set(row.id, row);
      }
      const mentors = [];
      for (const [mentorId, profile] of mentorMap) {
        const mp = mpMap.get(mentorId);
        const segments = msMap.get(mentorId) || [];
        const mentorGigs = gigMap.get(mentorId) || [];
        const account = accountMap.get(mentorId) || {};
        const primarySegment = segments.find((s) => s.is_primary) || segments[0];
        const state = deriveMentorAccountState({
          approval_status: mp?.approval_status ?? null,
          is_approved: mp?.is_approved ?? null,
          is_active: mp?.is_active ?? null,
          account_status: account.account_status ?? null,
          suspended_until: account.suspended_until ?? null
        });
        mentors.push({
          id: mentorId,
          name: profile.full_name,
          email: profile.email,
          segmentName: primarySegment?.segment?.name || "No Segment",
          status: state.isApproved ? "APPROVED" : mp?.approval_status === "rejected" ? "REJECTED" : "PENDING",
          experienceYears: mp?.experience_years || 0,
          bio: mp?.about || "",
          appliedDate: profile.created_at ? new Date(profile.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Unknown",
          isApproved: state.isApproved,
          // Read from the DB, not assumed.
          isActive: state.isActive,
          isSuspended: state.isSuspended,
          isDeactivated: state.isDeactivated,
          isEligible: state.isEligible,
          approvalStatus: mp?.approval_status ?? null,
          accountStatus: account.account_status ?? "active",
          suspendedUntil: account.suspended_until ?? null,
          suspensionReason: account.suspension_reason ?? null,
          profile: mp,
          segments: segments.map((s) => s.segment),
          gigs: mentorGigs
        });
      }
      return res.json({ success: true, mentors });
    } catch (err) {
      console.error("Failed to fetch admin mentors:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.patch("/api/admin/mentors/:id/approve", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { error } = await admin.from("mentor_profiles").update({ is_approved: true, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", id);
      if (error) throw error;
      auditAction(req.auth, "mentor_approved", {
        entityType: "mentor_profile",
        entityId: id,
        requestId: req.requestId,
        metadata: { action: "approve" }
      });
      return res.json({ success: true, message: "Mentor approved successfully." });
    } catch (err) {
      console.error("Failed to approve mentor:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.patch("/api/admin/mentors/:id/reject", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { error } = await admin.from("mentor_profiles").update({ is_approved: false, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", id);
      if (error) throw error;
      auditAction(req.auth, "mentor_rejected", {
        entityType: "mentor_profile",
        entityId: id,
        requestId: req.requestId,
        metadata: { action: "reject" }
      });
      return res.json({ success: true, message: "Mentor rejected successfully." });
    } catch (err) {
      console.error("Failed to reject mentor:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.patch("/api/admin/mentors/:id/toggle-active", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: current, error: readErr } = await admin.from("mentor_profiles").select("is_active, approval_status, is_approved").eq("id", id).maybeSingle();
      if (readErr) throw readErr;
      if (!current) {
        return res.status(404).json({ success: false, error: { code: "MENTOR_NOT_FOUND", message: "Mentor not found." } });
      }
      const isCurrentlyActive = current.is_active === true;
      const action = isCurrentlyActive ? "deactivate" : "activate";
      const state = deriveMentorAccountState({
        approval_status: current.approval_status ?? null,
        is_approved: current.is_approved ?? null,
        is_active: current.is_active ?? null,
        account_status: null
      });
      const validation = validateMentorStatusAction({ action, state });
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: { code: validation.code, message: validation.message }
        });
      }
      const update = buildMentorStatusUpdate({ action, adminId: req.auth.user.id });
      const { error: mpErr } = await admin.from("mentor_profiles").update(update.mentorProfile).eq("id", id);
      if (mpErr) throw mpErr;
      const { error: profileErr } = await admin.from("profiles").update(update.profile).eq("id", id);
      if (profileErr) throw profileErr;
      auditAction(req.auth, MENTOR_STATUS_ACTION_SPECS[action].auditAction, {
        entityType: "mentor_profile",
        entityId: id,
        requestId: req.requestId,
        metadata: { isActive: update.mentorProfile.is_active, via: "toggle-active" }
      });
      return res.json({ success: true, message: `Mentor ${action === "activate" ? "activated" : "deactivated"} successfully.` });
    } catch (err) {
      console.error("Failed to toggle mentor active status:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.patch("/api/admin/mentors/:id/status", requireAuth, requireAdmin, validateBody(apiSchemas.mentorStatus), async (req, res) => {
    const requestId = req.requestId ?? "";
    try {
      const { id } = req.params;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      if (!UUID_PATTERN.test(id)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_MENTOR_ID", message: "Mentor ID must be a valid UUID." } });
      }
      const { action, reason, suspendedUntil } = req.body;
      const adminId = req.auth.user.id;
      if (id === adminId) {
        return res.status(400).json({
          success: false,
          error: { code: "SELF_STATUS_CHANGE_FORBIDDEN", message: "Administrators cannot change their own account status." }
        });
      }
      const { data: mentorProfile, error: mpReadErr } = await admin.from("mentor_profiles").select("id, approval_status, is_approved, is_active").eq("id", id).maybeSingle();
      if (mpReadErr) throw mpReadErr;
      if (!mentorProfile) {
        return res.status(404).json({ success: false, error: { code: "MENTOR_NOT_FOUND", message: "Mentor not found." } });
      }
      const { data: accountProfile, error: profileReadErr } = await admin.from("profiles").select("id, account_status, suspended_until").eq("id", id).maybeSingle();
      if (profileReadErr) throw profileReadErr;
      const state = deriveMentorAccountState({
        approval_status: mentorProfile.approval_status ?? null,
        is_approved: mentorProfile.is_approved ?? null,
        is_active: mentorProfile.is_active ?? null,
        account_status: accountProfile?.account_status ?? null,
        suspended_until: accountProfile?.suspended_until ?? null
      });
      if (action === "deactivate" || action === "suspend") {
        const [{ data: mentorRoleRows, error: mentorRolesErr }, activeAdminCount] = await Promise.all([
          admin.from("user_roles").select("role").eq("user_id", id),
          countActiveAdminAccounts(admin)
        ]);
        if (mentorRolesErr) throw mentorRolesErr;
        const mentorSafety = assertAdminAccountSafety({
          action,
          adminId,
          targetId: id,
          targetRoles: (mentorRoleRows || []).map((entry) => entry.role),
          activeAdminCount,
          targetState: deriveAccountState({
            account_status: accountProfile?.account_status ?? null,
            suspended_until: accountProfile?.suspended_until ?? null
          })
        });
        if (!mentorSafety.allowed && mentorSafety.code === "LAST_ACTIVE_ADMIN") {
          return res.status(409).json({
            success: false,
            error: { code: mentorSafety.code, message: mentorSafety.message }
          });
        }
      }
      const validation = validateMentorStatusAction({
        action,
        reason,
        suspendedUntil,
        state
      });
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: { code: validation.code, message: validation.message }
        });
      }
      const update = buildMentorStatusUpdate({
        action,
        adminId,
        reason: validation.reason,
        suspendedUntil: validation.suspendedUntil
      });
      const { error: mpWriteErr } = await admin.from("mentor_profiles").update(update.mentorProfile).eq("id", id);
      if (mpWriteErr) throw mpWriteErr;
      if (accountProfile) {
        const { error: profileWriteErr } = await admin.from("profiles").update(update.profile).eq("id", id);
        if (profileWriteErr) throw profileWriteErr;
      }
      auditAction(req.auth, MENTOR_STATUS_ACTION_SPECS[action].auditAction, {
        entityType: "mentor_profile",
        entityId: id,
        requestId: req.requestId,
        metadata: {
          action,
          adminId,
          mentorId: id,
          reason: validation.reason ?? null,
          suspendedUntil: validation.suspendedUntil ?? null,
          previousState: state
        }
      });
      const pastTense = action === "activate" ? "activated" : action === "deactivate" ? "deactivated" : action === "suspend" ? "suspended" : "reactivated";
      return res.json({
        success: true,
        message: `Mentor ${pastTense} successfully.`,
        action: MENTOR_STATUS_ACTION_SPECS[action].auditAction,
        isActive: update.mentorProfile.is_active,
        accountStatus: update.profile.account_status
      });
    } catch (err) {
      const info = describeSupabaseError(err);
      await logApiError({
        requestId,
        method: req.method,
        path: req.path,
        statusCode: resolveHttpStatusForSupabaseError(info),
        message: `admin mentor status change failed - [${info.code}] ${info.message}`,
        error_code: info.code,
        userId: req.auth.user.id,
        role: "admin",
        stack: info.stack,
        metadata: { operation: "mentor_status_change", mentorId: req.params.id }
      }).catch(() => {
      });
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "PATCH /api/admin/mentors/:id/status",
        clientMessage: "Unable to update the mentor account status."
      });
    }
  });
  app.get("/api/admin/mentors/eligible", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: mpData, error: mpErr } = await admin.from("mentor_profiles").select("id").eq("is_approved", true).eq("is_active", true);
      if (mpErr) throw mpErr;
      const mentorIds = (mpData || []).map((mp) => mp.id);
      if (mentorIds.length === 0) {
        return res.json({ success: true, mentors: [] });
      }
      const { data: profiles, error: profilesErr } = await admin.from("profiles").select("id, full_name, email").in("id", mentorIds);
      if (profilesErr) throw profilesErr;
      const mentors = (profiles || []).map((p) => ({
        id: p.id,
        name: p.full_name,
        email: p.email
      }));
      return res.json({ success: true, mentors });
    } catch (err) {
      console.error("Failed to fetch eligible mentors:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.get("/api/admin/mentors/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const mentorId = req.params.id;
      if (!UUID_PATTERN.test(mentorId)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_MENTOR_ID", message: "Mentor ID must be a valid UUID." } });
      }
      const { data: profile, error: profileErr } = await admin.from("profiles").select("*").eq("id", mentorId).maybeSingle();
      if (profileErr) throw profileErr;
      if (!profile) {
        return res.status(404).json({ success: false, error: { code: "MENTOR_NOT_FOUND", message: "Mentor not found." } });
      }
      const [{ data: mentorProfile, error: mpErr }, { data: roles, error: rolesErr }] = await Promise.all([
        admin.from("mentor_profiles").select("*").eq("id", mentorId).maybeSingle(),
        admin.from("user_roles").select("role").eq("user_id", mentorId)
      ]);
      if (mpErr) throw mpErr;
      if (rolesErr) throw rolesErr;
      if (!profile) {
        return res.status(404).json({ success: false, error: { code: "MENTOR_NOT_FOUND", message: "Mentor not found." } });
      }
      const [segmentsRes, gigsRes, availabilityRes, exceptionsRes] = await Promise.all([
        admin.from("mentor_segments").select("*, segment:segments(*)").eq("mentor_id", mentorId),
        admin.from("gigs").select("*, segment:segments(id, name, slug)").eq("mentor_id", mentorId).order("created_at", { ascending: false }),
        admin.from("mentor_availability").select("*").eq("mentor_id", mentorId).order("day_of_week", { ascending: true }).order("start_time", { ascending: true }),
        admin.from("mentor_availability_exceptions").select("*").eq("mentor_id", mentorId).order("exception_date", { ascending: true })
      ]);
      if (segmentsRes.error) throw segmentsRes.error;
      if (gigsRes.error) throw gigsRes.error;
      if (availabilityRes.error) throw availabilityRes.error;
      if (exceptionsRes.error) throw exceptionsRes.error;
      const { data: application, error: appErr } = await admin.from("mentor_applications").select("*").eq("user_id", mentorId).maybeSingle();
      if (appErr) throw appErr;
      const { data: documents, error: docsErr } = application ? await admin.from("mentor_verification_documents").select("*").eq("application_id", application.id).order("uploaded_at", { ascending: false }) : { data: [], error: null };
      if (docsErr) throw docsErr;
      const signedDocuments = await Promise.all(
        (documents || []).map(async (document) => {
          try {
            const { data: signed } = await admin.storage.from("mentor-verification-documents").createSignedUrl(document.storage_path, 300);
            return { ...document, download_url: signed?.signedUrl || null };
          } catch {
            return { ...document, download_url: null };
          }
        })
      );
      let approvedBy = null;
      if (application?.reviewed_by) {
        const { data: approver } = await admin.from("profiles").select("id, full_name, email").eq("id", application.reviewed_by).maybeSingle();
        approvedBy = approver || null;
      }
      const { data: creationAudit } = await admin.from("audit_logs").select("id, created_at, actor_user_id, metadata").eq("entity_id", mentorId).eq("action", MENTOR_ADMIN_AUDIT_ACTIONS.CREATED).order("created_at", { ascending: true }).limit(1);
      const creationSource = resolveMentorCreationSource({
        createdVia: mentorProfile.created_via ?? null,
        hasAdminCreationAudit: (creationAudit || []).length > 0,
        hasApplication: Boolean(application)
      });
      const creationEvent = (creationAudit || [])[0] || null;
      let createdByAdmin = null;
      if (creationEvent?.actor_user_id) {
        const { data: creator } = await admin.from("profiles").select("id, full_name, email").eq("id", creationEvent.actor_user_id).maybeSingle();
        createdByAdmin = creator || null;
      }
      return res.json({
        success: true,
        mentor: {
          // ---- PROFILE ----
          profile: {
            id: profile.id,
            fullName: profile.full_name,
            email: profile.email,
            // `profiles.phone` verified to exist in the live schema.
            phone: profile.phone ?? null,
            avatarUrl: profile.avatar_url,
            timezone: profile.timezone,
            createdAt: profile.created_at,
            updatedAt: profile.updated_at
          },
          roles: (roles || []).map((r) => r.role),
          mentorProfile: {
            headline: mentorProfile?.headline ?? "",
            about: mentorProfile?.about ?? null,
            // Verified live column name. NOT `years_of_experience`, which only
            // exists on mentor_applications and caused a schema-cache error.
            experienceYears: mentorProfile?.experience_years ?? 0,
            languages: mentorProfile?.languages ?? null,
            // Verified to exist in the live schema (text[]).
            expertise: mentorProfile?.expertise ?? null,
            rating: mentorProfile?.rating ?? 0,
            reviewCount: mentorProfile?.review_count ?? 0,
            sessionCount: mentorProfile?.session_count ?? 0,
            isFeatured: mentorProfile?.is_featured ?? false,
            createdAt: mentorProfile?.created_at ?? profile.created_at,
            updatedAt: mentorProfile?.updated_at ?? profile.updated_at,
            // False when the mentor holds the role but has no profile row yet
            // (an unapproved public applicant).
            exists: Boolean(mentorProfile)
          },
          // ---- CREATION SOURCE ----
          creation: {
            source: creationSource,
            createdVia: mentorProfile.created_via ?? null,
            createdBy: createdByAdmin,
            createdAt: creationEvent?.created_at ?? mentorProfile?.created_at ?? profile.created_at
          },
          // ---- VERIFICATION ----
          verification: {
            approvalStatus: mentorProfile?.approval_status ?? null,
            isApproved: mentorProfile?.is_approved ?? false,
            applicationStatus: application?.status ?? null,
            applicationId: application?.id ?? null,
            submittedAt: application?.submitted_at ?? null,
            reviewedAt: application?.reviewed_at ?? null,
            rejectionReason: application?.rejection_reason ?? null,
            approvedBy,
            documents: signedDocuments
          },
          // ---- SEGMENTS ----
          segments: (segmentsRes.data || []).map((row) => ({
            segmentId: row.segment_id,
            isPrimary: row.is_primary,
            name: row.segment?.name ?? null,
            slug: row.segment?.slug ?? null,
            isActive: row.segment?.is_active ?? null,
            createdAt: row.created_at
          })),
          // ---- GIGS ----
          gigs: (gigsRes.data || []).map((gig) => ({
            id: gig.id,
            title: gig.title,
            description: gig.description,
            priceInr: gig.price_inr,
            durationMinutes: gig.duration_minutes,
            isActive: gig.is_active,
            segmentId: gig.segment_id,
            segmentName: gig.segment?.name ?? null,
            createdAt: gig.created_at,
            updatedAt: gig.updated_at
          })),
          // ---- AVAILABILITY ----
          availability: (availabilityRes.data || []).map((rule) => ({
            id: rule.id,
            dayOfWeek: rule.day_of_week,
            startTime: rule.start_time,
            endTime: rule.end_time,
            timezone: rule.timezone,
            isEnabled: rule.is_enabled
          })),
          availabilityExceptions: (exceptionsRes.data || []).map((exception) => ({
            id: exception.id,
            exceptionDate: exception.exception_date,
            isAvailable: exception.is_available,
            startTime: exception.start_time,
            endTime: exception.end_time,
            reason: exception.reason
          })),
          // ---- ACCOUNT STATUS (from stored columns) ----
          account: {
            accountStatus: profile.account_status ?? "active",
            isActive: mentorProfile.is_active === true,
            suspendedAt: profile.suspended_at ?? null,
            suspendedUntil: profile.suspended_until ?? null,
            suspensionReason: profile.suspension_reason ?? null,
            suspendedBy: profile.suspended_by ?? null,
            deactivatedAt: profile.deactivated_at ?? null,
            internalNote: profile.internal_note ?? null
          }
        }
      });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "GET /api/admin/mentors/:id",
        clientMessage: "Unable to load mentor details."
      });
    }
  });
  app.get("/api/admin/mentors/:id/bookings", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const mentorId = req.params.id;
      if (!UUID_PATTERN.test(mentorId)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_MENTOR_ID", message: "Mentor ID must be a valid UUID." } });
      }
      const { data: bookings, error: bookingsErr } = await admin.from("bookings").select("*, seeker:profiles!bookings_seeker_id_fkey(id, full_name, email)").eq("mentor_id", mentorId).order("start_time", { ascending: false });
      if (bookingsErr) throw bookingsErr;
      const bookingIds = (bookings || []).map((b) => b.id);
      const { data: payments, error: paymentsErr } = bookingIds.length ? await admin.from("payments").select("*").in("booking_id", bookingIds) : { data: [], error: null };
      if (paymentsErr) throw paymentsErr;
      const paymentByBooking = /* @__PURE__ */ new Map();
      for (const payment of payments || []) {
        paymentByBooking.set(payment.booking_id, payment);
      }
      const now = Date.now();
      const decorated = (bookings || []).map((booking) => {
        const payment = paymentByBooking.get(booking.id);
        const startMs = Date.parse(booking.start_time);
        return {
          id: booking.id,
          bookingCode: booking.booking_code,
          startTime: booking.start_time,
          endTime: booking.end_time,
          amountInr: booking.amount_inr,
          status: booking.status,
          meetingUrl: booking.meeting_url,
          cancellationReason: booking.cancellation_reason,
          isUpcoming: startMs >= now && !["CANCELLED", "REJECTED", "COMPLETED"].includes(booking.status),
          seeker: booking.seeker ?? null,
          payment: payment ? {
            id: payment.id,
            status: payment.status,
            amountInr: payment.amount_inr,
            verifiedAt: payment.verified_at
          } : null
        };
      });
      return res.json({
        success: true,
        bookings: decorated,
        upcoming: decorated.filter((b) => b.isUpcoming),
        completed: decorated.filter((b) => b.status === "COMPLETED"),
        cancelled: decorated.filter((b) => ["CANCELLED", "REJECTED"].includes(b.status))
      });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "GET /api/admin/mentors/:id/bookings",
        clientMessage: "Unable to load mentor bookings."
      });
    }
  });
  app.patch("/api/admin/mentors/:id/profile", requireAuth, requireAdmin, validateBody(apiSchemas.adminMentorProfile), async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const mentorId = req.params.id;
      if (!UUID_PATTERN.test(mentorId)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_MENTOR_ID", message: "Mentor ID must be a valid UUID." } });
      }
      const body = req.body;
      const profileUpdates = {};
      if (body.fullName !== void 0) {
        profileUpdates.full_name = body.fullName;
      }
      if (body.timezone !== void 0) {
        profileUpdates.timezone = body.timezone;
      }
      if (body.phone !== void 0) {
        profileUpdates.phone = body.phone || null;
      }
      if (body.avatarUrl !== void 0) {
        profileUpdates.avatar_url = body.avatarUrl || null;
      }
      const mentorUpdates = {};
      if (body.headline !== void 0) mentorUpdates.headline = body.headline;
      if (body.bio !== void 0) mentorUpdates.about = body.bio || null;
      if (body.experienceYears !== void 0) {
        mentorUpdates.experience_years = body.experienceYears;
      }
      if (body.languages !== void 0) {
        mentorUpdates.languages = body.languages;
      }
      if (body.expertise !== void 0) {
        mentorUpdates.expertise = body.expertise;
      }
      if (body.isFeatured !== void 0) mentorUpdates.is_featured = body.isFeatured;
      const replaceSegments = body.segmentIds !== void 0;
      const requestedSegmentIds = body.segmentIds ?? [];
      const { data: existing, error: existsErr } = await admin.from("mentor_profiles").select("id").eq("id", mentorId).maybeSingle();
      if (existsErr) throw existsErr;
      if (!existing) {
        return res.status(404).json({ success: false, error: { code: "MENTOR_NOT_FOUND", message: "Mentor not found." } });
      }
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      if (Object.keys(profileUpdates).length > 0) {
        const { error } = await admin.from("profiles").update({ ...profileUpdates, updated_at: nowIso }).eq("id", mentorId);
        if (error) throw error;
      }
      if (Object.keys(mentorUpdates).length > 0) {
        const { error } = await admin.from("mentor_profiles").update({ ...mentorUpdates, updated_at: nowIso }).eq("id", mentorId);
        if (error) throw error;
      }
      if (replaceSegments) {
        const nextSegmentIds = requestedSegmentIds;
        if (nextSegmentIds.length > 0) {
          const { data: validSegments, error: segErr } = await admin.from("segments").select("id").in("id", nextSegmentIds);
          if (segErr) throw segErr;
          const validIds = new Set((validSegments || []).map((s) => s.id));
          const unknown = nextSegmentIds.filter((id) => !validIds.has(id));
          if (unknown.length > 0) {
            return res.status(400).json({
              success: false,
              error: { code: "UNKNOWN_SEGMENT", message: `Unknown segment id(s): ${unknown.join(", ")}.` }
            });
          }
        }
        const { error: deleteErr } = await admin.from("mentor_segments").delete().eq("mentor_id", mentorId);
        if (deleteErr) throw deleteErr;
        if (nextSegmentIds.length > 0) {
          const { error: insertErr } = await admin.from("mentor_segments").insert(nextSegmentIds.map((segmentId) => ({
            mentor_id: mentorId,
            segment_id: segmentId,
            is_primary: false
          })));
          if (insertErr) throw insertErr;
        }
      }
      auditAction(req.auth, MENTOR_ADMIN_AUDIT_ACTIONS.PROFILE_UPDATED, {
        entityType: "mentor_profile",
        entityId: mentorId,
        requestId: req.requestId,
        metadata: {
          adminId: req.auth.user.id,
          mentorId,
          fields: [...Object.keys(profileUpdates), ...Object.keys(mentorUpdates)],
          segmentsChanged: replaceSegments
        }
      });
      return res.json({ success: true, message: "Mentor profile updated successfully." });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "PATCH /api/admin/mentors/:id/profile",
        clientMessage: "Unable to update the mentor profile."
      });
    }
  });
  app.post("/api/admin/mentors/:id/gigs", requireAuth, requireAdmin, validateBody(apiSchemas.adminMentorGigCreate), async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const mentorId = req.params.id;
      if (!UUID_PATTERN.test(mentorId)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_MENTOR_ID", message: "Mentor ID must be a valid UUID." } });
      }
      const { title, segmentId, durationMinutes, priceInr, originalPriceInr, description } = req.body;
      const { data: mentorProfile, error: mpErr } = await admin.from("mentor_profiles").select("id").eq("id", mentorId).maybeSingle();
      if (mpErr) throw mpErr;
      if (!mentorProfile) {
        return res.status(404).json({ success: false, error: { code: "MENTOR_NOT_FOUND", message: "Mentor not found." } });
      }
      const { data: segment, error: segErr } = await admin.from("segments").select("id").eq("id", segmentId).maybeSingle();
      if (segErr) throw segErr;
      if (!segment) {
        return res.status(400).json({ success: false, error: { code: "UNKNOWN_SEGMENT", message: "Segment not found." } });
      }
      const { data: gig, error } = await admin.from("gigs").insert({
        mentor_id: mentorId,
        segment_id: segmentId,
        title: title.trim(),
        description: typeof description === "string" ? description.trim() : "",
        duration_minutes: durationMinutes,
        price_inr: priceInr,
        original_price_inr: originalPriceInr ?? null,
        is_active: true
      }).select().single();
      if (error) {
        if (error.code === "23505") {
          return res.status(409).json({
            success: false,
            error: { code: "DUPLICATE_ACTIVE_GIG", message: "This mentor already has an active gig for that segment. Archive it first." }
          });
        }
        throw error;
      }
      auditAction(req.auth, MENTOR_ADMIN_AUDIT_ACTIONS.GIG_CREATED, {
        entityType: "gig",
        entityId: gig.id,
        requestId: req.requestId,
        metadata: { adminId: req.auth.user.id, mentorId, gigId: gig.id, segmentId, priceInr, durationMinutes }
      });
      return res.status(201).json({ success: true, gig });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "POST /api/admin/mentors/:id/gigs",
        clientMessage: "Unable to create the gig."
      });
    }
  });
  app.patch("/api/admin/mentors/gigs/:gigId", requireAuth, requireAdmin, validateBody(apiSchemas.adminMentorGigUpdate), async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const gigId = req.params.gigId;
      if (!UUID_PATTERN.test(gigId)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_GIG_ID", message: "Gig ID must be a valid UUID." } });
      }
      const { title, durationMinutes, priceInr, originalPriceInr, description, isActive } = req.body;
      const updates = { updated_at: (/* @__PURE__ */ new Date()).toISOString() };
      if (title !== void 0) updates.title = title;
      if (description !== void 0) updates.description = description;
      if (durationMinutes !== void 0) updates.duration_minutes = durationMinutes;
      if (priceInr !== void 0) updates.price_inr = priceInr;
      if (originalPriceInr !== void 0) updates.original_price_inr = originalPriceInr ?? null;
      if (isActive !== void 0) updates.is_active = isActive;
      const { data: gig, error } = await admin.from("gigs").update(updates).eq("id", gigId).select().single();
      if (error) throw error;
      if (!gig) {
        return res.status(404).json({ success: false, error: { code: "GIG_NOT_FOUND", message: "Gig not found." } });
      }
      auditAction(req.auth, MENTOR_ADMIN_AUDIT_ACTIONS.GIG_UPDATED, {
        entityType: "gig",
        entityId: gigId,
        requestId: req.requestId,
        metadata: { adminId: req.auth.user.id, mentorId: gig.mentor_id, gigId, fields: Object.keys(updates) }
      });
      return res.json({ success: true, gig });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "PATCH /api/admin/mentors/gigs/:gigId",
        clientMessage: "Unable to update the gig."
      });
    }
  });
  app.patch("/api/admin/mentors/gigs/:gigId/archive", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const gigId = req.params.gigId;
      if (!UUID_PATTERN.test(gigId)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_GIG_ID", message: "Gig ID must be a valid UUID." } });
      }
      const { data: gig, error } = await admin.from("gigs").update({ is_active: false, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", gigId).select().single();
      if (error) throw error;
      if (!gig) {
        return res.status(404).json({ success: false, error: { code: "GIG_NOT_FOUND", message: "Gig not found." } });
      }
      auditAction(req.auth, MENTOR_ADMIN_AUDIT_ACTIONS.GIG_ARCHIVED, {
        entityType: "gig",
        entityId: gigId,
        requestId: req.requestId,
        metadata: { adminId: req.auth.user.id, mentorId: gig.mentor_id, gigId }
      });
      return res.json({ success: true, gig, message: "Gig archived. Booking history is preserved." });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "PATCH /api/admin/mentors/gigs/:gigId/archive",
        clientMessage: "Unable to archive the gig."
      });
    }
  });
  app.put("/api/admin/mentors/:id/availability", requireAuth, requireAdmin, validateBody(apiSchemas.availability), async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const mentorId = req.params.id;
      if (!UUID_PATTERN.test(mentorId)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_MENTOR_ID", message: "Mentor ID must be a valid UUID." } });
      }
      const { rules, timezone } = req.body;
      const resolvedTimezone = timezone ?? APP_CONFIG.DEFAULT_TIMEZONE;
      const rows = rules.map((rule) => ({
        mentor_id: mentorId,
        day_of_week: rule.dayOfWeek,
        start_time: rule.startTime,
        end_time: rule.endTime,
        timezone: resolvedTimezone,
        is_enabled: rule.isEnabled
      }));
      const { error: clearErr } = await admin.from("mentor_availability").delete().eq("mentor_id", mentorId);
      if (clearErr) throw clearErr;
      if (rows.length > 0) {
        const { error: insertErr } = await admin.from("mentor_availability").insert(rows);
        if (insertErr) throw insertErr;
      }
      auditAction(req.auth, MENTOR_ADMIN_AUDIT_ACTIONS.AVAILABILITY_UPDATED, {
        entityType: "mentor_availability",
        entityId: mentorId,
        requestId: req.requestId,
        metadata: { adminId: req.auth.user.id, mentorId, ruleCount: rows.length, timezone: resolvedTimezone }
      });
      return res.json({ success: true, message: "Availability updated successfully.", ruleCount: rows.length });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "PUT /api/admin/mentors/:id/availability",
        clientMessage: "Unable to update availability."
      });
    }
  });
  app.put("/api/admin/mentors/:id/availability/exceptions", requireAuth, requireAdmin, validateBody(apiSchemas.availabilityExceptions), async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const mentorId = req.params.id;
      if (!UUID_PATTERN.test(mentorId)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_MENTOR_ID", message: "Mentor ID must be a valid UUID." } });
      }
      const { exceptions } = req.body;
      const rows = exceptions.map((exception) => ({
        mentor_id: mentorId,
        exception_date: exception.exceptionDate,
        is_available: exception.isAvailable,
        start_time: exception.isAvailable ? exception.startTime ?? null : null,
        end_time: exception.isAvailable ? exception.endTime ?? null : null,
        reason: exception.reason ? exception.reason : null
      }));
      const { error: clearErr } = await admin.from("mentor_availability_exceptions").delete().eq("mentor_id", mentorId);
      if (clearErr) throw clearErr;
      if (rows.length > 0) {
        const { error: insertErr } = await admin.from("mentor_availability_exceptions").insert(rows);
        if (insertErr) throw insertErr;
      }
      auditAction(req.auth, MENTOR_ADMIN_AUDIT_ACTIONS.AVAILABILITY_UPDATED, {
        entityType: "mentor_availability_exceptions",
        entityId: mentorId,
        requestId: req.requestId,
        metadata: { adminId: req.auth.user.id, mentorId, exceptionCount: rows.length }
      });
      return res.json({ success: true, message: "Date exceptions updated successfully.", exceptionCount: rows.length });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "PUT /api/admin/mentors/:id/availability/exceptions",
        clientMessage: "Unable to update date exceptions."
      });
    }
  });
  app.get("/api/admin/mentors/:id/audit", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const mentorId = req.params.id;
      if (!UUID_PATTERN.test(mentorId)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_MENTOR_ID", message: "Mentor ID must be a valid UUID." } });
      }
      const { data: gigs } = await admin.from("gigs").select("id").eq("mentor_id", mentorId);
      const childIds = (gigs || []).map((g) => g.id);
      const orFilter = [
        `entity_id.eq.${mentorId}`,
        ...childIds.length ? childIds.map((id) => `entity_id.eq.${id}`) : []
      ].join(",");
      const { data: entries, error: auditErr } = await admin.from("audit_logs").select("id, created_at, actor_user_id, actor_role, action, entity_type, entity_id, request_id, metadata").or(orFilter).order("created_at", { ascending: false }).limit(100);
      if (auditErr) throw auditErr;
      const relevant = (entries || []).filter((entry) => {
        if (entry.entity_id === mentorId) return true;
        const metaMentorId = entry.metadata?.mentorId ?? entry.metadata?.mentor_id;
        return metaMentorId === mentorId;
      });
      const actorIds = Array.from(
        new Set(relevant.map((e) => e.actor_user_id).filter(Boolean))
      );
      const { data: actors } = actorIds.length ? await admin.from("profiles").select("id, full_name, email").in("id", actorIds) : { data: [] };
      const actorMap = new Map((actors || []).map((a) => [a.id, a]));
      return res.json({
        success: true,
        entries: relevant.map((entry) => ({
          id: entry.id,
          createdAt: entry.created_at,
          action: entry.action,
          entityType: entry.entity_type,
          entityId: entry.entity_id,
          requestId: entry.request_id,
          actorRole: entry.actor_role,
          actor: entry.actor_user_id ? {
            id: entry.actor_user_id,
            name: actorMap.get(entry.actor_user_id)?.full_name ?? null,
            email: actorMap.get(entry.actor_user_id)?.email ?? null
          } : null,
          metadata: entry.metadata ?? null
        }))
      });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "GET /api/admin/mentors/:id/audit",
        clientMessage: "Unable to load the audit log."
      });
    }
  });
  app.put("/api/admin/mentors/:id/segments", requireAuth, requireAdmin, validateBody(apiSchemas.adminMentorSegments), async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const mentorId = req.params.id;
      if (!UUID_PATTERN.test(mentorId)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_MENTOR_ID", message: "Mentor ID must be a valid UUID." } });
      }
      const { segmentIds, primarySegmentId } = req.body;
      const nextSegmentIds = Array.from(new Set(segmentIds));
      if (primarySegmentId && !nextSegmentIds.includes(primarySegmentId)) {
        return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "primarySegmentId must be one of segmentIds." } });
      }
      const { data: existingMentor, error: existsErr } = await admin.from("mentor_profiles").select("id").eq("id", mentorId).maybeSingle();
      if (existsErr) throw existsErr;
      if (!existingMentor) {
        return res.status(404).json({ success: false, error: { code: "MENTOR_NOT_FOUND", message: "Mentor not found." } });
      }
      if (nextSegmentIds.length > 0) {
        const { data: validSegments, error: segErr } = await admin.from("segments").select("id, is_active").in("id", nextSegmentIds);
        if (segErr) throw segErr;
        const found = new Set((validSegments || []).map((s) => s.id));
        const unknown = nextSegmentIds.filter((id) => !found.has(id));
        if (unknown.length > 0) {
          return res.status(400).json({ success: false, error: { code: "UNKNOWN_SEGMENT", message: `Unknown segment id(s): ${unknown.join(", ")}.` } });
        }
        const inactive = (validSegments || []).filter((s) => !s.is_active).map((s) => s.id);
        if (inactive.length > 0) {
          return res.status(400).json({ success: false, error: { code: "SEGMENT_INACTIVE", message: `Cannot assign inactive segment(s): ${inactive.join(", ")}.` } });
        }
      }
      const { data: before, error: beforeErr } = await admin.from("mentor_segments").select("segment_id, is_primary").eq("mentor_id", mentorId);
      if (beforeErr) throw beforeErr;
      const beforeIds = (before || []).map((r) => r.segment_id).sort();
      const { error: clearErr } = await admin.from("mentor_segments").delete().eq("mentor_id", mentorId);
      if (clearErr) throw clearErr;
      if (nextSegmentIds.length > 0) {
        const { error: insertErr } = await admin.from("mentor_segments").insert(nextSegmentIds.map((segmentId) => ({
          mentor_id: mentorId,
          segment_id: segmentId,
          is_primary: primarySegmentId ? segmentId === primarySegmentId : false
        })));
        if (insertErr) throw insertErr;
      }
      auditAction(req.auth, MENTOR_ADMIN_AUDIT_ACTIONS.SEGMENTS_UPDATED, {
        entityType: "mentor_segments",
        entityId: mentorId,
        requestId: req.requestId,
        metadata: {
          adminId: req.auth.user.id,
          mentorId,
          before: beforeIds,
          after: nextSegmentIds.slice().sort(),
          primarySegmentId
        }
      });
      return res.json({ success: true, segmentIds: nextSegmentIds, primarySegmentId });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "PUT /api/admin/mentors/:id/segments",
        clientMessage: "Unable to update segments."
      });
    }
  });
  app.get("/api/admin/segments", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: segments, error: segErr } = await admin.from("segments").select("*").order("priority", { ascending: true });
      if (segErr) throw segErr;
      const segmentIds = segments?.map((s) => s.id) || [];
      let mentorCounts = {};
      const activeGigCounts = {};
      if (segmentIds.length > 0) {
        const { data: msData, error: msErr } = await admin.from("mentor_segments").select("mentor_id, segment_id").in("segment_id", segmentIds);
        if (msErr) throw msErr;
        if (msData && msData.length > 0) {
          const mentorIds = [...new Set(msData.map((ms) => ms.mentor_id))];
          const { data: mpData, error: mpErr } = await admin.from("mentor_profiles").select("id, is_approved").in("id", mentorIds);
          if (mpErr) throw mpErr;
          const approvedMentorIds = new Set((mpData || []).filter((mp) => mp.is_approved).map((mp) => mp.id));
          if (approvedMentorIds.size > 0) {
            const { data: gigsData, error: gigsErr } = await admin.from("gigs").select("mentor_id, segment_id").in("mentor_id", [...approvedMentorIds]).in("segment_id", segmentIds).eq("is_active", true);
            if (gigsErr) throw gigsErr;
            for (const g of gigsData || []) {
              if (!approvedMentorIds.has(g.mentor_id)) continue;
              mentorCounts[g.segment_id] = (mentorCounts[g.segment_id] || 0) + 1;
              activeGigCounts[g.segment_id] = (activeGigCounts[g.segment_id] || 0) + 1;
            }
          }
        }
      }
      if (segmentIds.length > 0) {
        const { data: allActiveGigs, error: allGigsErr } = await admin.from("gigs").select("id, segment_id").in("segment_id", segmentIds).eq("is_active", true);
        if (allGigsErr) throw allGigsErr;
        for (const g of allActiveGigs || []) {
          if (activeGigCounts[g.segment_id] === void 0) {
            activeGigCounts[g.segment_id] = (activeGigCounts[g.segment_id] || 0) + 1;
          }
        }
      }
      const segmentsWithCounts = (segments || []).map((s) => ({
        ...s,
        mentorsCount: mentorCounts[s.id] || 0,
        gigsCount: activeGigCounts[s.id] || 0
      }));
      return res.json({ success: true, segments: segmentsWithCounts });
    } catch (err) {
      console.error("Failed to fetch admin segments:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.get("/api/admin/segments/:segment", requireAuth, requireAdmin, async (req, res) => {
    const admin = getSupabaseAdmin();
    if (!admin) {
      return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
    }
    try {
      const { segment, error } = await resolveAdminSegmentBySlugOrId(admin, req.params.segment);
      if (error) throw error;
      if (!segment) {
        return res.status(404).json({ success: false, error: { code: "SEGMENT_NOT_FOUND", message: "Segment not found" } });
      }
      const [mentorsRes, gigsRes] = await Promise.all([
        loadSegmentMentors(admin, segment.id),
        loadSegmentGigs(admin, segment.id)
      ]);
      if (mentorsRes.error) throw mentorsRes.error;
      if (gigsRes.error) throw gigsRes.error;
      return res.json({
        success: true,
        segment,
        mentors: mentorsRes.mentors,
        gigs: gigsRes.gigs
      });
    } catch (err) {
      console.error("Failed to fetch segment:", logSanitizer.safeMessage(err));
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "GET /api/admin/segments/:segment",
        clientMessage: "Unable to load the segment."
      });
    }
  });
  app.post("/api/admin/segments", requireAuth, requireAdmin, validateBody(apiSchemas.segmentCreate), async (req, res) => {
    try {
      const { name, slug, priority, isActive, description } = req.body;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: slugClash, error: slugCheckErr } = await admin.from("segments").select("id").eq("slug", slug).maybeSingle();
      if (slugCheckErr) throw slugCheckErr;
      if (slugClash) {
        return res.status(400).json({ success: false, error: { code: "DUPLICATE_SLUG", message: "Another segment already uses this slug." } });
      }
      const { data, error } = await admin.from("segments").insert({
        name,
        slug,
        description: description ?? null,
        priority: priority || 10,
        is_active: isActive !== false
      }).select().single();
      if (error) {
        if (error.code === "23505") {
          return res.status(400).json({ success: false, error: { code: "DUPLICATE_SLUG", message: "Another segment already uses this slug." } });
        }
        throw error;
      }
      auditAction(req.auth, "segment_created", {
        entityType: "segment",
        entityId: data?.id,
        requestId: req.requestId,
        metadata: { name, slug, priority, isActive }
      });
      return res.status(201).json({ success: true, segment: data, message: "Segment created successfully." });
    } catch (err) {
      console.error("Failed to create segment:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.patch("/api/admin/segments/:id", requireAuth, requireAdmin, validateBody(apiSchemas.segmentUpdate), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, slug, priority, isActive, description } = req.body;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      if (!UUID_SHAPE_PATTERN.test(id)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_SEGMENT_ID", message: "Segment ID must be a valid UUID." } });
      }
      const { data: existing, error: existingErr } = await admin.from("segments").select("id").eq("id", id).maybeSingle();
      if (existingErr) throw existingErr;
      if (!existing) {
        return res.status(404).json({ success: false, error: { code: "SEGMENT_NOT_FOUND", message: "Segment not found" } });
      }
      const updateData = { updated_at: (/* @__PURE__ */ new Date()).toISOString() };
      if (name !== void 0) updateData.name = name;
      if (slug !== void 0) updateData.slug = slug;
      if (priority !== void 0) updateData.priority = priority;
      if (isActive !== void 0) updateData.is_active = isActive;
      if (description !== void 0) updateData.description = description;
      if (slug !== void 0) {
        const { data: slugClash, error: slugCheckErr } = await admin.from("segments").select("id").eq("slug", slug).neq("id", id).maybeSingle();
        if (slugCheckErr) throw slugCheckErr;
        if (slugClash) {
          return res.status(400).json({ success: false, error: { code: "DUPLICATE_SLUG", message: "Another segment already uses this slug." } });
        }
      }
      const { data, error } = await admin.from("segments").update(updateData).eq("id", id).select().single();
      if (error) {
        if (error.code === "23505") {
          return res.status(400).json({ success: false, error: { code: "DUPLICATE_SLUG", message: "Another segment already uses this slug." } });
        }
        throw error;
      }
      auditAction(req.auth, "segment_edited", {
        entityType: "segment",
        entityId: id,
        requestId: req.requestId,
        metadata: { updates: updateData }
      });
      return res.json({ success: true, segment: data, message: "Segment updated successfully." });
    } catch (err) {
      console.error("Failed to update segment:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.patch("/api/admin/segments/:id/toggle-active", requireAuth, requireAdmin, validateBody(apiSchemas.segmentToggleActive), async (req, res) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data, error } = await admin.from("segments").update({ is_active: isActive, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", id).select().single();
      if (error) throw error;
      auditAction(req.auth, isActive ? "segment_activated" : "segment_deactivated", {
        entityType: "segment",
        entityId: id,
        requestId: req.requestId,
        metadata: { isActive }
      });
      return res.json({ success: true, segment: data, message: `Segment ${isActive ? "activated" : "deactivated"} successfully.` });
    } catch (err) {
      console.error("Failed to toggle segment active status:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.post("/api/admin/segments/:id/priority", requireAuth, requireAdmin, validateBody(apiSchemas.segmentPriority), async (req, res) => {
    try {
      const { id } = req.params;
      const { direction } = req.body;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: current, error: readErr } = await admin.from("segments").select("id, priority").eq("id", id).maybeSingle();
      if (readErr) throw readErr;
      if (!current) {
        return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Segment not found." } });
      }
      const { data: adjacent, error: adjErr } = await admin.from("segments").select("id, priority").eq("is_active", true).neq("id", id).order("priority", { ascending: direction === "up" ? false : true }).limit(1).maybeSingle();
      if (adjErr) throw adjErr;
      if (adjacent) {
        const currentPriority = current.priority;
        const adjacentPriority = adjacent.priority;
        const { error: err1 } = await admin.from("segments").update({ priority: adjacentPriority, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", id);
        if (err1) throw err1;
        const { error: err2 } = await admin.from("segments").update({ priority: currentPriority, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", adjacent.id);
        if (err2) throw err2;
        auditAction(req.auth, "segment_priority_changed", {
          entityType: "segment",
          entityId: id,
          requestId: req.requestId,
          metadata: { direction, fromPriority: currentPriority, toPriority: adjacentPriority }
        });
      }
      const { data: segments, error: segErr } = await admin.from("segments").select("*").order("priority", { ascending: true });
      if (segErr) throw segErr;
      return res.json({ success: true, segments, message: `Segment priority moved ${direction}.` });
    } catch (err) {
      console.error("Failed to change segment priority:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.post("/api/admin/segments/:id/mentors", requireAuth, requireAdmin, validateBody(apiSchemas.segmentAddMentor), async (req, res) => {
    try {
      const { id } = req.params;
      const { mentorId, isPrimary } = req.body;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: segment, error: segErr } = await admin.from("segments").select("id").eq("id", id).maybeSingle();
      if (segErr) throw segErr;
      if (!segment) {
        return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Segment not found." } });
      }
      const { data: mentor, error: mpErr } = await admin.from("mentor_profiles").select("id, is_approved").eq("id", mentorId).maybeSingle();
      if (mpErr) throw mpErr;
      if (!mentor) {
        return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Mentor not found." } });
      }
      const { data: existing, error: existErr } = await admin.from("mentor_segments").select("id").eq("mentor_id", mentorId).eq("segment_id", id).maybeSingle();
      if (existErr) throw existErr;
      if (existing) {
        return res.status(409).json({ success: false, error: { code: "CONFLICT", message: "Mentor already assigned to this segment." } });
      }
      if (isPrimary) {
        const { error: clearErr } = await admin.from("mentor_segments").update({ is_primary: false }).eq("mentor_id", mentorId);
        if (clearErr) throw clearErr;
      }
      const { data, error } = await admin.from("mentor_segments").insert({ mentor_id: mentorId, segment_id: id, is_primary: isPrimary || false }).select().single();
      if (error) throw error;
      auditAction(req.auth, "mentor_assigned_to_segment", {
        entityType: "mentor_segments",
        entityId: data?.id,
        requestId: req.requestId,
        metadata: { mentorId, segmentId: id, isPrimary }
      });
      return res.status(201).json({ success: true, assignment: data, message: "Mentor assigned to segment." });
    } catch (err) {
      console.error("Failed to assign mentor to segment:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.delete("/api/admin/segments/:id/mentors/:mentorId", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { id, mentorId } = req.params;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: gigs, error: gigsErr } = await admin.from("gigs").select("id").eq("mentor_id", mentorId).eq("segment_id", id).eq("is_active", true);
      if (gigsErr) throw gigsErr;
      if (gigs && gigs.length > 0) {
        return res.status(400).json({ success: false, error: { code: "CONFLICT", message: "Cannot remove mentor with active gigs in this segment." } });
      }
      const { data: bookings, error: bookingsErr } = await admin.from("bookings").select("id").eq("mentor_id", mentorId).eq("segment_id", id).not("status", "in", '("CANCELLED","REJECTED")').gte("start_time", (/* @__PURE__ */ new Date()).toISOString());
      if (bookingsErr) throw bookingsErr;
      if (bookings && bookings.length > 0) {
        return res.status(400).json({ success: false, error: { code: "CONFLICT", message: "Cannot remove mentor with future bookings in this segment." } });
      }
      const { error } = await admin.from("mentor_segments").delete().eq("mentor_id", mentorId).eq("segment_id", id);
      if (error) throw error;
      auditAction(req.auth, "mentor_removed_from_segment", {
        entityType: "mentor_segments",
        entityId: `${mentorId}:${id}`,
        requestId: req.requestId,
        metadata: { mentorId, segmentId: id }
      });
      return res.json({ success: true, message: "Mentor removed from segment." });
    } catch (err) {
      console.error("Failed to remove mentor from segment:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.post("/api/admin/segments/:id/gigs", requireAuth, requireAdmin, validateBody(apiSchemas.segmentGigCreate), async (req, res) => {
    try {
      const { id } = req.params;
      const { mentorId, title, description, durationMinutes, priceInr, originalPriceInr, isActive } = req.body;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: segment, error: segErr } = await admin.from("segments").select("id, is_active").eq("id", id).maybeSingle();
      if (segErr) throw segErr;
      if (!segment) {
        return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Segment not found." } });
      }
      const { data: ms, error: msErr } = await admin.from("mentor_segments").select("id").eq("mentor_id", mentorId).eq("segment_id", id).maybeSingle();
      if (msErr) throw msErr;
      if (!ms) {
        return res.status(400).json({ success: false, error: { code: "FORBIDDEN", message: "Mentor not assigned to this segment." } });
      }
      const { data: existingGig, error: egErr } = await admin.from("gigs").select("id").eq("mentor_id", mentorId).eq("segment_id", id).eq("is_active", true).maybeSingle();
      if (egErr) throw egErr;
      if (existingGig && isActive !== false) {
        return res.status(409).json({ success: false, error: { code: "CONFLICT", message: "Mentor already has an active gig in this segment." } });
      }
      const { data, error } = await admin.from("gigs").insert({
        mentor_id: mentorId,
        segment_id: id,
        title,
        description: description || "",
        duration_minutes: durationMinutes,
        price_inr: priceInr,
        original_price_inr: originalPriceInr ?? null,
        is_active: isActive !== false
      }).select().single();
      if (error) throw error;
      auditAction(req.auth, "gig_created", {
        entityType: "gig",
        entityId: data?.id,
        requestId: req.requestId,
        metadata: { mentorId, segmentId: id, title, durationMinutes, priceInr, isActive }
      });
      return res.status(201).json({ success: true, gig: data, message: "Gig created successfully." });
    } catch (err) {
      console.error("Failed to create gig:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.get("/api/admin/segments/:id/experience", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { id } = req.params;
      if (!UUID_SHAPE_PATTERN.test(id)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_SEGMENT_ID", message: "Segment ID must be a valid UUID." } });
      }
      const { data: segment, error } = await admin.from("segments").select("id, name, experience_config").eq("id", id).maybeSingle();
      if (error) throw error;
      if (!segment) {
        return res.status(404).json({ success: false, error: { code: "SEGMENT_NOT_FOUND", message: "Segment not found" } });
      }
      return res.json({
        success: true,
        segment: {
          id: segment.id,
          name: segment.name,
          experience_config: segment.experience_config || {}
        }
      });
    } catch (err) {
      console.error("Failed to fetch segment experience:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err, context: "GET /api/admin/segments/:id/experience" });
    }
  });
  app.put("/api/admin/segments/:id/experience", requireAuth, requireAdmin, validateBody(apiSchemas.segmentExperience), async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { id } = req.params;
      if (!UUID_SHAPE_PATTERN.test(id)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_SEGMENT_ID", message: "Segment ID must be a valid UUID." } });
      }
      const { data: existing, error: existingErr } = await admin.from("segments").select("id, experience_config").eq("id", id).maybeSingle();
      if (existingErr) throw existingErr;
      if (!existing) {
        return res.status(404).json({ success: false, error: { code: "SEGMENT_NOT_FOUND", message: "Segment not found" } });
      }
      const oldHeroImageUrl = existing.experience_config?.branding?.heroImageUrl;
      const experienceConfig = req.body ?? {};
      const { data, error } = await admin.from("segments").update({ experience_config: experienceConfig, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", id).select("id, name, experience_config").single();
      if (error) throw error;
      auditAction(req.auth, "segment_experience_updated", {
        entityType: "segment",
        entityId: id,
        requestId: req.requestId,
        metadata: { hasConfig: !!experienceConfig && Object.keys(experienceConfig).length > 0 }
      });
      const newHeroImageUrl = data.experience_config?.branding?.heroImageUrl;
      if (oldHeroImageUrl && newHeroImageUrl && oldHeroImageUrl !== newHeroImageUrl) {
        const oldPath = extractSegmentHeroStoragePath(oldHeroImageUrl);
        const newPath = extractSegmentHeroStoragePath(newHeroImageUrl);
        if (oldPath && newPath && oldPath !== newPath) {
          try {
            await admin.storage.from("segment-hero").remove([oldPath]);
            console.log("[segment-hero] Removed previous hero image:", oldPath);
          } catch (err) {
            console.error("[segment-hero] Failed to remove previous hero image:", oldPath, logSanitizer.safeMessage(err));
          }
        }
      }
      return res.json({
        success: true,
        segment: {
          id: data.id,
          name: data.name,
          experience_config: data.experience_config || {}
        },
        message: "Segment experience updated."
      });
    } catch (err) {
      console.error("Failed to update segment experience:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err, context: "PUT /api/admin/segments/:id/experience" });
    }
  });
  app.get("/api/seeker/segments/:slug/experience", async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Service unavailable." } });
      }
      const { slug } = req.params;
      const { data: segment, error } = await admin.from("segments").select("id, name, slug, is_active, experience_config").eq("slug", slug).eq("is_active", true).maybeSingle();
      if (error) throw error;
      if (!segment) {
        return res.status(404).json({ success: false, error: { code: "SEGMENT_NOT_FOUND", message: "Segment not found" } });
      }
      return res.json({
        success: true,
        segment: {
          id: segment.id,
          name: segment.name,
          slug: segment.slug,
          experience_config: segment.experience_config || {}
        }
      });
    } catch (err) {
      console.error("Failed to fetch seeker segment experience:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err, context: "GET /api/seeker/segments/:slug/experience" });
    }
  });
  app.get("/api/seeker/segments/:slug/topics", async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Service unavailable." } });
      }
      const { slug } = req.params;
      if (typeof slug !== "string" || !/^[a-z0-9-]{2,60}$/.test(slug)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_SLUG", message: "Segment slug is invalid." } });
      }
      const { data: segment, error: segErr } = await admin.from("segments").select("id").eq("slug", slug).eq("is_active", true).maybeSingle();
      if (segErr) throw segErr;
      if (!segment) {
        return res.status(404).json({ success: false, error: { code: "SEGMENT_NOT_FOUND", message: "Segment not found" } });
      }
      const { data: topics, error } = await admin.from("segment_topics").select("id, segment_id, name, slug, description, priority, is_active, created_at, updated_at").eq("segment_id", segment.id).eq("is_active", true).order("priority", { ascending: true }).order("name", { ascending: true });
      if (error) throw error;
      return res.json({ success: true, topics: topics || [] });
    } catch (err) {
      console.error("Failed to fetch segment topics:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err, context: "GET /api/seeker/segments/:slug/topics" });
    }
  });
  async function findGigIdsForTopic(admin, topicId) {
    const { data, error } = await admin.from("gig_topics").select("gig_id").eq("topic_id", topicId);
    if (error) throw error;
    return Array.from(new Set((data || []).map((row) => row.gig_id)));
  }
  app.get("/api/seeker/segments/:slug/mentors", async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Service unavailable." } });
      }
      const { slug } = req.params;
      if (typeof slug !== "string" || !/^[a-z0-9-]{2,60}$/.test(slug)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_SLUG", message: "Segment slug is invalid." } });
      }
      const topicSlug = typeof req.query.topic === "string" ? req.query.topic : null;
      const dateStr = typeof req.query.date === "string" ? req.query.date : null;
      if (topicSlug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(topicSlug)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_TOPIC", message: "Topic slug is invalid." } });
      }
      if (dateStr && !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_DATE", message: "Date must be YYYY-MM-DD." } });
      }
      const { data: segment, error: segErr } = await admin.from("segments").select("id, name, slug").eq("slug", slug).eq("is_active", true).maybeSingle();
      if (segErr) throw segErr;
      if (!segment) {
        return res.status(404).json({ success: false, error: { code: "SEGMENT_NOT_FOUND", message: "Segment not found" } });
      }
      let topicId = null;
      if (topicSlug) {
        const { data: topic, error: topicErr } = await admin.from("segment_topics").select("id").eq("segment_id", segment.id).eq("slug", topicSlug).eq("is_active", true).maybeSingle();
        if (topicErr) throw topicErr;
        if (!topic) {
          return res.json({ success: true, mentors: [], total: 0, topic: null, segment });
        }
        topicId = topic.id;
      }
      let gigQuery = admin.from("gigs").select("id, mentor_id, title, description, duration_minutes, price_inr, original_price_inr, segment_id").eq("segment_id", segment.id).eq("is_active", true);
      if (topicId) {
        const gigIds = await findGigIdsForTopic(admin, topicId);
        if (gigIds.length === 0) {
          return res.json({ success: true, mentors: [], total: 0, topic: topicSlug, segment });
        }
        gigQuery = gigQuery.in("id", gigIds);
      }
      const { data: gigs, error: gigErr } = await gigQuery;
      if (gigErr) throw gigErr;
      const gigList = gigs || [];
      if (gigList.length === 0) {
        return res.json({ success: true, mentors: [], total: 0, topic: topicSlug, segment });
      }
      const mentorIds = Array.from(new Set(gigList.map((g) => g.mentor_id)));
      const [profilesRes, visibilityRes, segmentsRes] = await Promise.all([
        admin.from("mentor_profiles").select("id, headline, about, experience_years, languages, expertise, rating, review_count, session_count, is_approved, is_featured, is_active, approval_status").in("id", mentorIds),
        admin.from("profiles").select("id, full_name, avatar_url, timezone, account_status, suspended_until").in("id", mentorIds),
        admin.from("mentor_segments").select("mentor_id, is_primary, segment_id").in("mentor_id", mentorIds)
      ]);
      for (const r of [profilesRes, visibilityRes, segmentsRes]) {
        if (r.error) throw r.error;
      }
      const now = /* @__PURE__ */ new Date();
      const profileById = new Map((visibilityRes.data || []).map((p) => [p.id, p]));
      const eligible = (profilesRes.data || []).filter((mp) => {
        const profile = profileById.get(mp.id);
        if (!profile || !profile.full_name) return false;
        if (!mp.is_approved || !mp.is_active || mp.approval_status !== "approved") return false;
        const state = deriveAccountState(
          { account_status: profile.account_status ?? null, suspended_until: profile.suspended_until ?? null },
          now
        );
        if (!state.canPerformOperationalActions) return false;
        return (segmentsRes.data || []).some(
          (ms) => ms.mentor_id === mp.id && ms.segment_id === segment.id
        );
      });
      if (eligible.length === 0) {
        return res.json({ success: true, mentors: [], total: 0, topic: topicSlug, segment });
      }
      let slotResults = null;
      if (dateStr) {
        const computed = await computeMentorSlotsForDate(admin, {
          mentorIds: eligible.map((mp) => mp.id),
          dateStr,
          segmentId: segment.id,
          now
        });
        if (computed.error) throw computed.error;
        slotResults = computed.results;
      }
      const mentors = [];
      for (const mp of eligible) {
        const mentorGigs = gigList.filter((g) => g.mentor_id === mp.id);
        if (mentorGigs.length === 0) continue;
        const profile = profileById.get(mp.id);
        const membership = (segmentsRes.data || []).find(
          (ms) => ms.mentor_id === mp.id && ms.segment_id === segment.id
        );
        const row = {
          id: mp.id,
          full_name: profile.full_name,
          avatar_url: profile.avatar_url ?? null,
          timezone: profile.timezone || "Asia/Kolkata",
          headline: mp.headline,
          about: mp.about ?? null,
          experience_years: mp.experience_years ?? 0,
          languages: mp.languages || [],
          expertise: mp.expertise ?? null,
          rating: Number(mp.rating) || 0,
          review_count: mp.review_count || 0,
          session_count: mp.session_count || 0,
          is_featured: !!mp.is_featured,
          is_primary_segment: !!membership?.is_primary,
          segment,
          gigs: mentorGigs,
          // The one gig that represents this mentor inside this segment.
          gig: mentorGigs[0]
        };
        if (slotResults) {
          const slot = slotResults.get(mp.id);
          if (!slot) continue;
          const available = (slot.slots || []).filter((s) => s.is_available);
          if (available.length === 0) continue;
          row.available_slots = available;
          row.all_slots = slot.slots;
          row.next_available_slot = available[0];
          row.next_hold_expires_at = slot.next_hold_expires_at;
          row.next_slot_start_at = slot.next_slot_start_at;
          if (slot.gig) row.gig = slot.gig;
        }
        mentors.push(row);
      }
      mentors.sort(
        (a, b) => Number(b.is_featured) - Number(a.is_featured) || b.rating - a.rating
      );
      return res.json({
        success: true,
        mentors,
        total: mentors.length,
        topic: topicSlug,
        segment
      });
    } catch (err) {
      console.error("Failed to fetch topic-filtered mentors:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err, context: "GET /api/seeker/segments/:slug/mentors" });
    }
  });
  app.get("/api/seeker/mentors/:id/profile", async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Service unavailable." } });
      }
      const mentorId = typeof req.params.id === "string" ? req.params.id : "";
      if (!UUID_SHAPE_PATTERN.test(mentorId)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_MENTOR_ID", message: "Mentor id is invalid." } });
      }
      const [profileRes, identityRes, segmentsRes] = await Promise.all([
        admin.from("mentor_profiles").select("id, headline, about, experience_years, languages, expertise, is_approved, is_featured, is_active, approval_status").eq("id", mentorId).maybeSingle(),
        admin.from("profiles").select("id, full_name, avatar_url, timezone, account_status, suspended_until").eq("id", mentorId).maybeSingle(),
        admin.from("mentor_segments").select("segment_id, is_primary").eq("mentor_id", mentorId)
      ]);
      for (const r of [profileRes, identityRes, segmentsRes]) {
        if (r.error) throw r.error;
      }
      const mp = profileRes.data;
      const identity = identityRes.data;
      const memberships = segmentsRes.data || [];
      const eligible = Boolean(mp) && Boolean(identity?.full_name) && Boolean(mp.is_approved) && Boolean(mp.is_active) && mp.approval_status === "approved" && memberships.length > 0 && deriveAccountState(
        {
          account_status: identity.account_status ?? null,
          suspended_until: identity.suspended_until ?? null
        },
        /* @__PURE__ */ new Date()
      ).canPerformOperationalActions;
      if (!eligible) {
        return res.status(404).json({ success: false, error: { code: "MENTOR_NOT_FOUND", message: "Mentor not found." } });
      }
      const segmentIds = Array.from(new Set(memberships.map((ms) => ms.segment_id)));
      const { data: activeSegments, error: segErr } = await admin.from("segments").select("id, name, slug").in("id", segmentIds).eq("is_active", true);
      if (segErr) throw segErr;
      const segmentById = new Map(
        (activeSegments || []).map((s) => [s.id, { id: s.id, name: s.name, slug: s.slug }])
      );
      const { data: gigs, error: gigErr } = await admin.from("gigs").select("id, mentor_id, segment_id, title, description, duration_minutes, price_inr").eq("mentor_id", mentorId).eq("is_active", true);
      if (gigErr) throw gigErr;
      const primaryBySegment = new Map(
        memberships.filter((ms) => ms.is_primary).map((ms) => [ms.segment_id, true])
      );
      const offers = (gigs || []).filter((g) => segmentById.has(g.segment_id)).filter((g) => memberships.some((ms) => ms.segment_id === g.segment_id)).map((g) => {
        const segment = segmentById.get(g.segment_id);
        return {
          gigId: g.id,
          mentorId: g.mentor_id,
          segmentId: g.segment_id,
          segmentName: segment.name,
          segmentSlug: segment.slug,
          isPrimarySegment: Boolean(primaryBySegment.get(g.segment_id)),
          title: g.title,
          description: g.description ?? null,
          durationMinutes: g.duration_minutes,
          priceInr: g.price_inr
        };
      }).sort(
        (a, b) => Number(b.isPrimarySegment) - Number(a.isPrimarySegment) || a.segmentName.localeCompare(b.segmentName) || a.gigId.localeCompare(b.gigId)
      );
      return res.json({
        success: true,
        mentor: {
          id: mp.id,
          fullName: identity.full_name,
          avatarUrl: identity.avatar_url ?? null,
          timezone: identity.timezone || "Asia/Kolkata",
          headline: mp.headline ?? "",
          about: mp.about ?? null,
          experienceYears: Number(mp.experience_years) || 0,
          languages: mp.languages || [],
          expertise: mp.expertise ?? null,
          isApproved: Boolean(mp.is_approved),
          isFeatured: Boolean(mp.is_featured),
          segments: Array.from(segmentById.values()).map((s) => ({
            id: s.id,
            name: s.name,
            slug: s.slug,
            isPrimary: Boolean(primaryBySegment.get(s.id))
          })),
          offers
        }
      });
    } catch (err) {
      console.error("Failed to fetch public mentor profile:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err, context: "GET /api/seeker/mentors/:id/profile" });
    }
  });
  async function resolveAdminSegment(admin, key) {
    if (!key) return null;
    const byId = UUID_SHAPE_PATTERN.test(key);
    const query = admin.from("segments").select("id, name, slug").eq(byId ? "id" : "slug", key).limit(1);
    const { data, error } = await query;
    if (error) throw error;
    return data && data[0] || null;
  }
  async function withTopicUsage(admin, topics) {
    if (topics.length === 0) return [];
    const { data, error } = await admin.from("gig_topics").select("topic_id").in("topic_id", topics.map((t) => t.id));
    if (error) throw error;
    const counts = /* @__PURE__ */ new Map();
    for (const row of data || []) {
      counts.set(row.topic_id, (counts.get(row.topic_id) || 0) + 1);
    }
    return topics.map((t) => ({ ...t, gig_count: counts.get(t.id) || 0 }));
  }
  app.get("/api/admin/segments/:segment/topics", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const segment = await resolveAdminSegment(admin, req.params.segment);
      if (!segment) {
        return res.status(404).json({ success: false, error: { code: "SEGMENT_NOT_FOUND", message: "Segment not found" } });
      }
      const { data, error } = await admin.from("segment_topics").select("id, segment_id, name, slug, description, priority, is_active, created_at, updated_at").eq("segment_id", segment.id).order("priority", { ascending: true }).order("name", { ascending: true });
      if (error) throw error;
      return res.json({ success: true, topics: await withTopicUsage(admin, data || []) });
    } catch (err) {
      console.error("Failed to list segment topics:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err, context: "GET /api/admin/segments/:segment/topics" });
    }
  });
  app.post("/api/admin/segments/:segment/topics", requireAuth, requireAdmin, validateBody(apiSchemas.segmentTopicCreate), async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const segment = await resolveAdminSegment(admin, req.params.segment);
      if (!segment) {
        return res.status(404).json({ success: false, error: { code: "SEGMENT_NOT_FOUND", message: "Segment not found" } });
      }
      const name = String(req.body.name).trim();
      const slug = slugifyTopicName(name);
      if (!slug) {
        return res.status(400).json({ success: false, error: { code: "INVALID_TOPIC_NAME", message: "That name does not produce a usable topic link." } });
      }
      const { data: last, error: lastErr } = await admin.from("segment_topics").select("priority").eq("segment_id", segment.id).order("priority", { ascending: false }).limit(1);
      if (lastErr) throw lastErr;
      const nextPriority = ((last && last[0] && last[0].priority) ?? 0) + 10;
      const { data, error } = await admin.from("segment_topics").insert({
        segment_id: segment.id,
        name,
        slug,
        description: req.body.description ?? null,
        priority: nextPriority,
        is_active: req.body.isActive !== false,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      }).select("id, segment_id, name, slug, description, priority, is_active, created_at, updated_at").single();
      if (error) {
        if (error.code === "23505") {
          return res.status(409).json({ success: false, error: { code: "DUPLICATE_TOPIC", message: "This segment already has a topic with that name." } });
        }
        throw error;
      }
      auditAction(req.auth, "segment_topic_created", {
        entityType: "segment_topic",
        entityId: data.id,
        requestId: req.requestId,
        metadata: { segmentId: segment.id, slug }
      });
      const [topic] = await withTopicUsage(admin, [data]);
      return res.status(201).json({ success: true, topic });
    } catch (err) {
      console.error("Failed to create segment topic:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err, context: "POST /api/admin/segments/:segment/topics" });
    }
  });
  app.patch("/api/admin/segments/:segment/topics/:topicId", requireAuth, requireAdmin, validateBody(apiSchemas.segmentTopicUpdate), async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const segment = await resolveAdminSegment(admin, req.params.segment);
      if (!segment) {
        return res.status(404).json({ success: false, error: { code: "SEGMENT_NOT_FOUND", message: "Segment not found" } });
      }
      const { topicId } = req.params;
      if (!UUID_SHAPE_PATTERN.test(topicId)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_TOPIC_ID", message: "Topic ID must be a valid UUID." } });
      }
      const { data: existing, error: existingErr } = await admin.from("segment_topics").select("id, name, slug, segment_id").eq("id", topicId).eq("segment_id", segment.id).maybeSingle();
      if (existingErr) throw existingErr;
      if (!existing) {
        return res.status(404).json({ success: false, error: { code: "TOPIC_NOT_FOUND", message: "Topic not found in this segment." } });
      }
      const update = { updated_at: (/* @__PURE__ */ new Date()).toISOString() };
      if (req.body.name !== void 0) {
        const name = String(req.body.name).trim();
        const slug = slugifyTopicName(name);
        if (!slug) {
          return res.status(400).json({ success: false, error: { code: "INVALID_TOPIC_NAME", message: "That name does not produce a usable topic link." } });
        }
        update.name = name;
        update.slug = slug;
      }
      if (req.body.description !== void 0) update.description = req.body.description || null;
      if (req.body.isActive !== void 0) update.is_active = req.body.isActive;
      if (req.body.priority !== void 0) update.priority = req.body.priority;
      const { data, error } = await admin.from("segment_topics").update(update).eq("id", topicId).eq("segment_id", segment.id).select("id, segment_id, name, slug, description, priority, is_active, created_at, updated_at").single();
      if (error) {
        if (error.code === "23505") {
          return res.status(409).json({ success: false, error: { code: "DUPLICATE_TOPIC", message: "This segment already has a topic with that name." } });
        }
        throw error;
      }
      auditAction(req.auth, "segment_topic_updated", {
        entityType: "segment_topic",
        entityId: topicId,
        requestId: req.requestId,
        metadata: { segmentId: segment.id }
      });
      const [topic] = await withTopicUsage(admin, [data]);
      return res.json({ success: true, topic });
    } catch (err) {
      console.error("Failed to update segment topic:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err, context: "PATCH /api/admin/segments/:segment/topics/:topicId" });
    }
  });
  app.delete("/api/admin/segments/:segment/topics/:topicId", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const segment = await resolveAdminSegment(admin, req.params.segment);
      if (!segment) {
        return res.status(404).json({ success: false, error: { code: "SEGMENT_NOT_FOUND", message: "Segment not found" } });
      }
      const { topicId } = req.params;
      if (!UUID_SHAPE_PATTERN.test(topicId)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_TOPIC_ID", message: "Topic ID must be a valid UUID." } });
      }
      const { data: existing, error: existingErr } = await admin.from("segment_topics").select("id").eq("id", topicId).eq("segment_id", segment.id).maybeSingle();
      if (existingErr) throw existingErr;
      if (!existing) {
        return res.status(404).json({ success: false, error: { code: "TOPIC_NOT_FOUND", message: "Topic not found in this segment." } });
      }
      const { data: links, error: linkErr } = await admin.from("gig_topics").select("gig_id").eq("topic_id", topicId);
      if (linkErr) throw linkErr;
      const usedBy = Array.from(new Set((links || []).map((r) => r.gig_id)));
      if (usedBy.length > 0) {
        return res.status(409).json({
          success: false,
          error: {
            code: "TOPIC_IN_USE",
            message: `This topic is still used by ${usedBy.length} gig${usedBy.length === 1 ? "" : "s"}. Deactivate it instead to retire it without changing those gigs.`
          },
          gigCount: usedBy.length
        });
      }
      const { error } = await admin.from("segment_topics").delete().eq("id", topicId);
      if (error) throw error;
      auditAction(req.auth, "segment_topic_deleted", {
        entityType: "segment_topic",
        entityId: topicId,
        requestId: req.requestId,
        metadata: { segmentId: segment.id }
      });
      return res.json({ success: true, message: "Topic deleted." });
    } catch (err) {
      console.error("Failed to delete segment topic:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err, context: "DELETE /api/admin/segments/:segment/topics/:topicId" });
    }
  });
  app.get("/api/admin/gigs/:id/topics", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { id } = req.params;
      if (!UUID_SHAPE_PATTERN.test(id)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_GIG_ID", message: "Gig ID must be a valid UUID." } });
      }
      const { data, error } = await admin.from("gig_topics").select("topic_id").eq("gig_id", id);
      if (error) throw error;
      return res.json({ success: true, topicIds: (data || []).map((r) => r.topic_id) });
    } catch (err) {
      console.error("Failed to read gig topics:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err, context: "GET /api/admin/gigs/:id/topics" });
    }
  });
  app.put("/api/admin/gigs/:id/topics", requireAuth, requireAdmin, validateBody(apiSchemas.gigTopicsUpdate), async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { id } = req.params;
      if (!UUID_SHAPE_PATTERN.test(id)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_GIG_ID", message: "Gig ID must be a valid UUID." } });
      }
      const { data: gig, error: gigErr } = await admin.from("gigs").select("id, segment_id").eq("id", id).maybeSingle();
      if (gigErr) throw gigErr;
      if (!gig) {
        return res.status(404).json({ success: false, error: { code: "GIG_NOT_FOUND", message: "Gig not found" } });
      }
      const requested = Array.from(new Set(req.body.topicIds || []));
      if (requested.length > 0) {
        const { data: topics, error: topicErr } = await admin.from("segment_topics").select("id, segment_id").in("id", requested);
        if (topicErr) throw topicErr;
        const found = topics || [];
        const foundIds = new Set(found.map((t) => t.id));
        const missing = requested.filter((topicId) => !foundIds.has(topicId));
        if (missing.length > 0) {
          return res.status(400).json({
            success: false,
            error: { code: "UNKNOWN_TOPIC", message: "One or more selected topics no longer exist. Reload and try again." }
          });
        }
        const foreign = found.filter((t) => t.segment_id !== gig.segment_id);
        if (foreign.length > 0) {
          return res.status(400).json({
            success: false,
            error: {
              code: "TOPIC_SEGMENT_MISMATCH",
              message: "A topic can only be attached to a gig in the same segment."
            }
          });
        }
      }
      const { data: before, error: beforeErr } = await admin.from("gig_topics").select("topic_id").eq("gig_id", id);
      if (beforeErr) throw beforeErr;
      const beforeIds = new Set((before || []).map((r) => r.topic_id));
      const toInsert = requested.filter((topicId) => !beforeIds.has(topicId));
      const toRemove = Array.from(beforeIds).filter((topicId) => !requested.includes(topicId));
      if (toRemove.length > 0) {
        const { error: removeErr } = await admin.from("gig_topics").delete().eq("gig_id", id).in("topic_id", toRemove);
        if (removeErr) throw removeErr;
      }
      if (toInsert.length > 0) {
        const { error: insertErr } = await admin.from("gig_topics").insert(toInsert.map((topic_id) => ({ gig_id: id, topic_id })));
        if (insertErr) throw insertErr;
      }
      auditAction(req.auth, "gig_topics_updated", {
        entityType: "gig",
        entityId: id,
        requestId: req.requestId,
        metadata: { added: toInsert.length, removed: toRemove.length, total: requested.length }
      });
      return res.json({ success: true, topicIds: requested });
    } catch (err) {
      console.error("Failed to update gig topics:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err, context: "PUT /api/admin/gigs/:id/topics" });
    }
  });
  app.patch("/api/admin/gigs/:id", requireAuth, requireAdmin, validateBody(apiSchemas.adminGigUpdate), async (req, res) => {
    try {
      const { id } = req.params;
      const { title, description, durationMinutes, priceInr, originalPriceInr, isActive } = req.body;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      if (isActive === true) {
        const { data: gig, error: readErr } = await admin.from("gigs").select("mentor_id, segment_id").eq("id", id).maybeSingle();
        if (readErr) throw readErr;
        if (gig) {
          const { data: existingGig, error: egErr } = await admin.from("gigs").select("id").eq("mentor_id", gig.mentor_id).eq("segment_id", gig.segment_id).eq("is_active", true).neq("id", id).maybeSingle();
          if (egErr) throw egErr;
          if (existingGig) {
            return res.status(409).json({ success: false, error: { code: "CONFLICT", message: "Mentor already has an active gig in this segment." } });
          }
        }
      }
      const updateData = { updated_at: (/* @__PURE__ */ new Date()).toISOString() };
      if (title !== void 0) updateData.title = title;
      if (description !== void 0) updateData.description = description;
      if (durationMinutes !== void 0) updateData.duration_minutes = durationMinutes;
      if (priceInr !== void 0) updateData.price_inr = priceInr;
      if (originalPriceInr !== void 0) updateData.original_price_inr = originalPriceInr ?? null;
      if (isActive !== void 0) updateData.is_active = isActive;
      const { data, error } = await admin.from("gigs").update(updateData).eq("id", id).select().single();
      if (error) throw error;
      auditAction(req.auth, "gig_updated", {
        entityType: "gig",
        entityId: id,
        requestId: req.requestId,
        metadata: { updates: updateData }
      });
      return res.json({ success: true, gig: data, message: "Gig updated successfully." });
    } catch (err) {
      console.error("Failed to update gig:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.post("/api/admin/segments/:id/hero-upload-url", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { id } = req.params;
      if (!UUID_SHAPE_PATTERN.test(id)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_SEGMENT_ID", message: "Segment ID must be a valid UUID." } });
      }
      const { data: segment, error: segErr } = await admin.from("segments").select("id").eq("id", id).maybeSingle();
      if (segErr) throw segErr;
      if (!segment) {
        return res.status(404).json({ success: false, error: { code: "SEGMENT_NOT_FOUND", message: "Segment not found" } });
      }
      const validation = validateHeroUploadPayload(req.body);
      if (!validation.valid) {
        return res.status(400).json({ success: false, error: validation.error });
      }
      const { type, size } = validation;
      const extensionByMimeType = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
        "image/gif": "gif"
      };
      const storagePath = `segment-hero/${id}-${Date.now()}-${(0, import_crypto5.randomUUID)().slice(0, 6)}.${extensionByMimeType[type]}`;
      const { data, error } = await admin.storage.from("segment-hero").createSignedUploadUrl(storagePath);
      if (error) throw error;
      const supabaseUrl2 = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
      const publicUrl = `${supabaseUrl2}/storage/v1/object/public/segment-hero/${storagePath}`;
      auditAction(req.auth, "segment_hero_upload_url_requested", {
        entityType: "segment",
        entityId: id,
        requestId: req.requestId,
        metadata: { mimeType: type, sizeBytes: size }
      });
      return res.json({ success: true, uploadUrl: data.signedUrl, token: data.token, path: storagePath, publicUrl });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "POST /api/admin/segments/:id/hero-upload-url",
        clientMessage: "Unable to prepare the segment hero image upload."
      });
    }
  });
  app.delete("/api/admin/segments/:id/hero-image", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { id } = req.params;
      if (!UUID_SHAPE_PATTERN.test(id)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_SEGMENT_ID", message: "Segment ID must be a valid UUID." } });
      }
      const { data: current, error: readErr } = await admin.from("segments").select("experience_config").eq("id", id).maybeSingle();
      if (readErr) throw readErr;
      if (!current) {
        return res.status(404).json({ success: false, error: { code: "SEGMENT_NOT_FOUND", message: "Segment not found" } });
      }
      const cfg = current.experience_config || {};
      const branding = cfg.branding || {};
      const previousPath = extractSegmentHeroStoragePath(branding.heroImageUrl);
      const nextConfig = { ...cfg };
      const nextBranding = { ...branding };
      delete nextBranding.heroImageUrl;
      nextConfig.branding = nextBranding;
      const { error: writeErr } = await admin.from("segments").update({ experience_config: nextConfig, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", id);
      if (writeErr) throw writeErr;
      if (previousPath) {
        try {
          await admin.storage.from("segment-hero").remove([previousPath]);
          console.log("[segment-hero] Removed previous hero image:", previousPath);
        } catch (err) {
          console.error("[segment-hero] Failed to remove previous hero image:", previousPath, logSanitizer.safeMessage(err));
        }
      }
      auditAction(req.auth, "segment_hero_image_removed", {
        entityType: "segment",
        entityId: id,
        requestId: req.requestId,
        metadata: { previousPath }
      });
      return res.json({ success: true, message: "Segment hero image removed." });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "DELETE /api/admin/segments/:id/hero-image",
        clientMessage: "Unable to remove the segment hero image."
      });
    }
  });
  app.patch("/api/admin/gigs/:id/toggle-active", requireAuth, requireAdmin, validateBody(apiSchemas.adminGigToggleActive), async (req, res) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      if (isActive === true) {
        const { data: gig, error: readErr } = await admin.from("gigs").select("mentor_id, segment_id").eq("id", id).maybeSingle();
        if (readErr) throw readErr;
        if (gig) {
          const { data: existingGig, error: egErr } = await admin.from("gigs").select("id").eq("mentor_id", gig.mentor_id).eq("segment_id", gig.segment_id).eq("is_active", true).neq("id", id).maybeSingle();
          if (egErr) throw egErr;
          if (existingGig) {
            return res.status(409).json({ success: false, error: { code: "CONFLICT", message: "Mentor already has an active gig in this segment." } });
          }
        }
      }
      const { data, error } = await admin.from("gigs").update({ is_active: isActive, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", id).select().single();
      if (error) throw error;
      auditAction(req.auth, isActive ? "gig_activated" : "gig_deactivated", {
        entityType: "gig",
        entityId: id,
        requestId: req.requestId,
        metadata: { isActive }
      });
      return res.json({ success: true, gig: data, message: `Gig ${isActive ? "activated" : "deactivated"} successfully.` });
    } catch (err) {
      console.error("Failed to toggle gig active status:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.get("/api/admin/segments/:segment/mentors", requireAuth, requireAdmin, async (req, res) => {
    const admin = getSupabaseAdmin();
    if (!admin) {
      return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
    }
    try {
      const { segment, error: segErr } = await resolveAdminSegmentBySlugOrId(admin, req.params.segment);
      if (segErr) throw segErr;
      if (!segment) {
        return res.status(404).json({ success: false, error: { code: "SEGMENT_NOT_FOUND", message: "Segment not found" } });
      }
      const { mentors, error } = await loadSegmentMentors(admin, segment.id);
      if (error) throw error;
      return res.json({ success: true, mentors });
    } catch (err) {
      console.error("Failed to fetch segment mentors:", logSanitizer.safeMessage(err));
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "GET /api/admin/segments/:segment/mentors",
        clientMessage: "Unable to load the mentors for this segment."
      });
    }
  });
  app.get("/api/admin/segments/:segment/gigs", requireAuth, requireAdmin, async (req, res) => {
    const admin = getSupabaseAdmin();
    if (!admin) {
      return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
    }
    try {
      const { segment, error: segErr } = await resolveAdminSegmentBySlugOrId(admin, req.params.segment);
      if (segErr) throw segErr;
      if (!segment) {
        return res.status(404).json({ success: false, error: { code: "SEGMENT_NOT_FOUND", message: "Segment not found" } });
      }
      const { gigs, error } = await loadSegmentGigs(admin, segment.id);
      if (error) throw error;
      return res.json({ success: true, gigs });
    } catch (err) {
      console.error("Failed to fetch segment gigs:", logSanitizer.safeMessage(err));
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "GET /api/admin/segments/:segment/gigs",
        clientMessage: "Unable to load the gigs for this segment."
      });
    }
  });
  app.get("/api/admin/mentors/:id/slots", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { date, gigId } = req.query;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      if (!date || !gigId) {
        return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "date and gigId query parameters are required." } });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
        return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "date must be a YYYY-MM-DD calendar date." } });
      }
      const { data: gig, error: gigErr } = await admin.from("gigs").select("*").eq("id", gigId).eq("mentor_id", id).maybeSingle();
      if (gigErr) throw gigErr;
      if (!gig) {
        return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Gig not found for this mentor." } });
      }
      const { results, error } = await computeMentorSlotsForDate(admin, {
        mentorIds: [id],
        dateStr: String(date),
        segmentId: gig.segment_id,
        now: /* @__PURE__ */ new Date()
      });
      if (error) throw error;
      const result = results.get(id);
      if (!result || !result.gig) {
        return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Mentor not found." } });
      }
      return res.json({
        success: true,
        slots: result.slots,
        gig: { id: result.gig.id, title: result.gig.title, durationMinutes: result.gig.duration_minutes }
      });
    } catch (err) {
      console.error("Failed to generate slots:", logSanitizer.safeMessage(err));
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "GET /api/admin/mentors/:id/slots",
        clientMessage: "Unable to load availability."
      });
    }
  });
  app.get("/api/admin/users", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: profiles, error: profilesErr } = await admin.from("profiles").select("*").order("created_at", { ascending: false });
      if (profilesErr) throw profilesErr;
      const { data: userRoles, error: rolesErr } = await admin.from("user_roles").select("*");
      if (rolesErr) throw rolesErr;
      const { data: applications, error: applicationsErr } = await admin.from("mentor_applications").select("user_id, status");
      if (applicationsErr) throw applicationsErr;
      const rolesMap = /* @__PURE__ */ new Map();
      for (const ur of userRoles || []) {
        if (!rolesMap.has(ur.user_id)) rolesMap.set(ur.user_id, []);
        rolesMap.get(ur.user_id).push(ur.role);
      }
      const applicationStatusMap = /* @__PURE__ */ new Map();
      for (const application of applications || []) {
        if (application.user_id) applicationStatusMap.set(application.user_id, application.status);
      }
      const users = (profiles || []).map((p) => {
        const roles = rolesMap.get(p.id) || ["seeker"];
        const applicationStatus = applicationStatusMap.get(p.id) || null;
        const primaryRole2 = roles.includes("admin") ? "ADMIN" : roles.includes("mentor") && applicationStatus !== null && applicationStatus !== "approved" ? "PENDING_MENTOR" : roles.includes("mentor") ? "MENTOR" : "SEEKER";
        return {
          id: p.id,
          name: p.full_name,
          email: p.email,
          role: primaryRole2,
          timezone: p.timezone,
          createdAt: p.created_at ? new Date(p.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Unknown",
          status: p.account_status === "suspended" ? "SUSPENDED" : "ACTIVE",
          roles,
          applicationStatus
        };
      });
      return res.json({ success: true, users });
    } catch (err) {
      console.error("Failed to fetch admin users:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.get("/api/admin/users/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      const userId = req.params.id;
      if (!UUID_PATTERN.test(userId)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_USER_ID", message: "User ID must be a valid UUID." } });
      }
      const [{ data: profile, error: profileErr }, { data: roles, error: rolesErr }, { data: mentorProfile, error: mentorErr }, { data: application, error: applicationErr }] = await Promise.all([
        admin.from("profiles").select("*").eq("id", userId).maybeSingle(),
        admin.from("user_roles").select("role").eq("user_id", userId),
        admin.from("mentor_profiles").select("*").eq("id", userId).maybeSingle(),
        admin.from("mentor_applications").select("*").eq("user_id", userId).maybeSingle()
      ]);
      if (profileErr) throw profileErr;
      if (rolesErr) throw rolesErr;
      if (mentorErr) throw mentorErr;
      if (applicationErr) throw applicationErr;
      if (!profile) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "User not found." } });
      const applicationId = application?.id;
      const [{ data: documents, error: documentsErr }, { data: memberships, error: membershipsErr }] = await Promise.all([
        applicationId ? admin.from("mentor_verification_documents").select("*").eq("application_id", applicationId).order("uploaded_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
        admin.from("mentor_segments").select("*, segment:segments(*)").eq("mentor_id", userId)
      ]);
      if (documentsErr) throw documentsErr;
      if (membershipsErr) throw membershipsErr;
      const signedDocuments = await Promise.all((documents || []).map(async (document) => {
        const { data: signed, error: signedErr } = await admin.storage.from("mentor-verification-documents").createSignedUrl(document.storage_path, 300);
        if (signedErr) throw signedErr;
        return { ...document, download_url: signed?.signedUrl || null };
      }));
      const transformedMentorProfile = mentorProfile ? {
        ...mentorProfile,
        bio: mentorProfile.about,
        years_experience: mentorProfile.experience_years
      } : null;
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      const isAdminAccount = (roles || []).some((entry) => entry.role === "admin");
      const isActiveAccount = deriveAccountState({
        account_status: profile.account_status ?? null,
        suspended_until: profile.suspended_until ?? null
      }).canPerformOperationalActions;
      const [
        { count: upcomingBookings },
        { count: completedBookings },
        { count: gigCount },
        { count: activeGigCount },
        { count: paymentCount },
        { count: workspaceCount },
        { count: notificationCount },
        { count: unreadNotificationCount }
      ] = await Promise.all([
        admin.from("bookings").select("id", { count: "exact", head: true }).or(`seeker_id.eq.${userId},mentor_id.eq.${userId}`).in("status", ["PAYMENT_PENDING", "PENDING_VERIFICATION", "MENTOR_PENDING", "CONFIRMED"]).gte("start_time", nowIso),
        admin.from("bookings").select("id", { count: "exact", head: true }).or(`seeker_id.eq.${userId},mentor_id.eq.${userId}`).eq("status", "COMPLETED"),
        admin.from("gigs").select("id", { count: "exact", head: true }).eq("mentor_id", userId),
        admin.from("gigs").select("id", { count: "exact", head: true }).eq("mentor_id", userId).eq("is_active", true),
        admin.from("payments").select("id", { count: "exact", head: true }).eq("seeker_id", userId),
        admin.from("session_workspaces").select("id", { count: "exact", head: true }).or(`seeker_id.eq.${userId},mentor_id.eq.${userId}`),
        admin.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId),
        admin.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("is_read", false)
      ]);
      const activeAdminCount = await countActiveAdminAccounts(admin);
      let authState = null;
      try {
        const { data: authUser } = await admin.auth.admin.getUserById(userId);
        if (authUser?.user) {
          const u = authUser.user;
          const invitationStatus = u.last_sign_in_at ? "accepted" : u.invited_at ? "sent" : "pending";
          authState = {
            invitationStatus,
            createdAt: u.created_at ?? null,
            invitedAt: u.invited_at ?? null,
            lastSignInAt: u.last_sign_in_at ?? null,
            emailConfirmedAt: u.email_confirmed_at ?? null,
            actionLink: null
          };
        }
      } catch (authErr) {
        console.warn("[admin] Unable to read Supabase Auth state for user", userId, getErrorMessage(authErr));
      }
      return res.json({
        success: true,
        user: {
          profile,
          roles: (roles || []).map((entry) => entry.role),
          mentorProfile: transformedMentorProfile,
          application,
          documents: signedDocuments,
          segments: memberships || [],
          auth: authState,
          safety: {
            isAdmin: isAdminAccount,
            isActive: isActiveAccount,
            activeAdminCount
          },
          summary: {
            upcomingBookings: upcomingBookings ?? 0,
            completedBookings: completedBookings ?? 0,
            gigs: gigCount ?? 0,
            activeGigs: activeGigCount ?? 0,
            payments: paymentCount ?? 0,
            segments: (memberships || []).length,
            workspaces: workspaceCount ?? 0,
            notifications: notificationCount ?? 0,
            unreadNotifications: unreadNotificationCount ?? 0
          }
        }
      });
    } catch (err) {
      return respondWithServerError({ req, res, error: err, context: "GET /api/admin/users/:id", clientMessage: "Unable to load user details." });
    }
  });
  app.patch("/api/admin/users/:id", requireAuth, requireAdmin, validateBody(apiSchemas.adminUserUpdate), async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      const userId = req.params.id;
      if (!UUID_PATTERN.test(userId)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_USER_ID", message: "User ID must be a valid UUID." } });
      }
      const { fullName, timezone, phone, bio, headline, experienceYears } = req.body;
      const { data: existing, error: existingErr } = await admin.from("profiles").select("id").eq("id", userId).maybeSingle();
      if (existingErr) throw existingErr;
      if (!existing) {
        return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "User not found." } });
      }
      const profileUpdates = {};
      if (fullName !== void 0) profileUpdates.full_name = fullName;
      if (timezone !== void 0) profileUpdates.timezone = timezone;
      if (phone !== void 0) profileUpdates.phone = phone || null;
      const mentorUpdates = {};
      if (bio !== void 0) mentorUpdates.about = bio;
      if (headline !== void 0) mentorUpdates.headline = headline;
      if (experienceYears !== void 0) mentorUpdates.experience_years = experienceYears;
      if (Object.keys(profileUpdates).length > 0) {
        const { error } = await admin.from("profiles").update({ ...profileUpdates, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", userId);
        if (error) throw error;
      }
      if (Object.keys(mentorUpdates).length > 0) {
        const { error } = await admin.from("mentor_profiles").update({ ...mentorUpdates, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", userId);
        if (error) throw error;
      }
      await auditAction(req.auth, "USER_PROFILE_UPDATED", {
        entityType: "user",
        entityId: userId,
        requestId: req.requestId,
        metadata: {
          targetUserId: userId,
          adminId: req.auth.user.id,
          fields: [...Object.keys(profileUpdates), ...Object.keys(mentorUpdates)]
        }
      });
      return res.json({ success: true, message: "User updated successfully." });
    } catch (err) {
      return respondWithServerError({ req, res, error: err, context: "PATCH /api/admin/users/:id", clientMessage: "Unable to update user." });
    }
  });
  app.patch("/api/admin/users/:id/status", requireAuth, requireAdmin, validateBody(apiSchemas.adminUserStatus), async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const userId = req.params.id;
      if (!UUID_PATTERN.test(userId)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_USER_ID", message: "User ID must be a valid UUID." } });
      }
      const { action, reason, suspendedUntil } = req.body;
      const adminId = req.auth.user.id;
      const [{ data: profile, error: profileErr }, { data: roles, error: rolesErr }] = await Promise.all([
        admin.from("profiles").select("id, account_status, suspended_until").eq("id", userId).maybeSingle(),
        admin.from("user_roles").select("role").eq("user_id", userId)
      ]);
      if (profileErr) throw profileErr;
      if (rolesErr) throw rolesErr;
      if (!profile) {
        return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "User not found." } });
      }
      const targetRoles = (roles || []).map((entry) => entry.role);
      const targetState = deriveAccountState({
        account_status: profile.account_status ?? null,
        suspended_until: profile.suspended_until ?? null
      });
      const activeAdminCount = await countActiveAdminAccounts(admin);
      const safety = assertAdminAccountSafety({
        action,
        adminId,
        targetId: userId,
        targetRoles,
        activeAdminCount,
        targetState
      });
      if (!safety.allowed) {
        return res.status(safety.code === "LAST_ACTIVE_ADMIN" ? 409 : 400).json({
          success: false,
          error: { code: safety.code, message: safety.message }
        });
      }
      const validation = validateAccountStatusAction({
        action,
        reason,
        suspendedUntil
      });
      if (!validation.valid) {
        return res.status(400).json({ success: false, error: { code: validation.code, message: validation.message } });
      }
      const update = buildAccountStatusUpdate({
        action,
        adminId,
        reason: validation.reason,
        suspendedUntil: validation.suspendedUntil
      });
      const { error: writeErr } = await admin.from("profiles").update(update).eq("id", userId);
      if (writeErr) throw writeErr;
      await auditAction(req.auth, ACCOUNT_STATUS_ACTION_SPECS[action].auditAction, {
        entityType: "user",
        entityId: userId,
        requestId: req.requestId,
        metadata: {
          action,
          adminId,
          targetUserId: userId,
          reason: validation.reason ?? null,
          suspendedUntil: validation.suspendedUntil ?? null,
          previousStatus: profile.account_status ?? null,
          previousSuspendedUntil: profile.suspended_until ?? null
        }
      });
      const pastTense = action === "activate" ? "activated" : action === "deactivate" ? "deactivated" : action === "suspend" ? "suspended" : "reactivated";
      return res.json({
        success: true,
        message: `Account ${pastTense}.`,
        action: ACCOUNT_STATUS_ACTION_SPECS[action].auditAction,
        accountStatus: update.account_status
      });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "PATCH /api/admin/users/:id/status",
        clientMessage: "Unable to update the account status."
      });
    }
  });
  app.get("/api/admin/users/:id/bookings", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      const userId = req.params.id;
      if (!UUID_PATTERN.test(userId)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_USER_ID", message: "User ID must be a valid UUID." } });
      }
      const { data: bookings, error: bookingsErr } = await admin.from("bookings").select(`
          *,
          seeker:profiles!bookings_seeker_id_fkey(id, full_name, email),
          mentor:profiles!bookings_mentor_id_fkey(id, full_name, email),
          gig:gigs(id, title, duration_minutes, price_inr),
          segment:segments(id, name, slug)
        `).or(`seeker_id.eq.${userId},mentor_id.eq.${userId}`).order("start_time", { ascending: false });
      if (bookingsErr) throw bookingsErr;
      const bookingIds = (bookings || []).map((b) => b.id);
      const [{ data: payments, error: paymentsErr }, { data: workspaces, error: workspacesErr }] = await Promise.all([
        bookingIds.length ? admin.from("payments").select("*").in("booking_id", bookingIds) : Promise.resolve({ data: [], error: null }),
        bookingIds.length ? admin.from("session_workspaces").select("id, booking_id, status, published_at").in("booking_id", bookingIds) : Promise.resolve({ data: [], error: null })
      ]);
      if (paymentsErr) throw paymentsErr;
      if (workspacesErr) throw workspacesErr;
      const paymentByBooking = new Map((payments || []).map((p) => [p.booking_id, p]));
      const workspaceByBooking = new Map((workspaces || []).map((w) => [w.booking_id, w]));
      const now = Date.now();
      const rows = (bookings || []).map((booking) => {
        const payment = paymentByBooking.get(booking.id);
        const workspace = workspaceByBooking.get(booking.id);
        return {
          id: booking.id,
          bookingCode: booking.booking_code,
          startTime: booking.start_time,
          endTime: booking.end_time,
          status: booking.status,
          amountInr: booking.amount_inr,
          meetingUrl: booking.meeting_url,
          cancellationReason: booking.cancellation_reason,
          createdAt: booking.created_at,
          isUpcoming: Date.parse(booking.start_time) >= now && !["CANCELLED", "REJECTED", "COMPLETED"].includes(booking.status),
          seeker: booking.seeker ?? null,
          mentor: booking.mentor ?? null,
          gig: booking.gig ?? null,
          segment: booking.segment ?? null,
          payment: payment ? { id: payment.id, status: payment.status, amountInr: payment.amount_inr, verifiedAt: payment.verified_at } : null,
          workspace: workspace ? { id: workspace.id, status: workspace.status, publishedAt: workspace.published_at } : null
        };
      });
      return res.json({
        success: true,
        bookings: rows,
        upcoming: rows.filter((r) => r.isUpcoming),
        completed: rows.filter((r) => r.status === "COMPLETED"),
        cancelled: rows.filter((r) => ["CANCELLED", "REJECTED"].includes(r.status))
      });
    } catch (err) {
      return respondWithServerError({ req, res, error: err, context: "GET /api/admin/users/:id/bookings", clientMessage: "Unable to load bookings." });
    }
  });
  app.get("/api/admin/users/:id/payments", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      const userId = req.params.id;
      if (!UUID_PATTERN.test(userId)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_USER_ID", message: "User ID must be a valid UUID." } });
      }
      const { data: mentorBookings, error: mentorBookingsErr } = await admin.from("bookings").select("id").eq("mentor_id", userId);
      if (mentorBookingsErr) throw mentorBookingsErr;
      const mentorBookingIds = (mentorBookings || []).map((b) => b.id);
      const { data: payments, error: paymentsErr } = await admin.from("payments").select("*").or(
        [
          `seeker_id.eq.${userId}`,
          ...mentorBookingIds.length ? mentorBookingIds.slice(0, 50).map((id) => `booking_id.eq.${id}`) : []
        ].join(",")
      ).order("created_at", { ascending: false });
      if (paymentsErr) throw paymentsErr;
      const bookingIds = Array.from(new Set((payments || []).map((p) => p.booking_id)));
      const { data: bookings, error: bookingsErr } = bookingIds.length ? await admin.from("bookings").select("id, booking_code, start_time, status, gig:gigs(id, title), segment:segments(id, name), mentor:profiles!bookings_mentor_id_fkey(id, full_name, email)").in("id", bookingIds) : { data: [], error: null };
      if (bookingsErr) throw bookingsErr;
      const bookingMap = new Map((bookings || []).map((b) => [b.id, b]));
      const verifiedByIds = Array.from(new Set((payments || []).map((p) => p.verified_by).filter(Boolean)));
      const { data: verifiers } = verifiedByIds.length ? await admin.from("profiles").select("id, full_name, email").in("id", verifiedByIds) : { data: [] };
      const verifierMap = new Map((verifiers || []).map((v) => [v.id, v]));
      const rows = (payments || []).map((payment) => {
        const booking = bookingMap.get(payment.booking_id);
        return {
          id: payment.id,
          amountInr: payment.amount_inr,
          currency: "INR",
          status: payment.status,
          transactionReference: payment.transaction_reference,
          hasProof: Boolean(payment.proof_storage_path),
          verifiedAt: payment.verified_at,
          verifiedBy: payment.verified_by ? { id: payment.verified_by, name: verifierMap.get(payment.verified_by)?.full_name ?? null } : null,
          rejectionReason: payment.rejection_reason,
          createdAt: payment.created_at,
          booking: booking ? {
            id: booking.id,
            bookingCode: booking.booking_code,
            startTime: booking.start_time,
            status: booking.status,
            gigTitle: booking.gig?.title ?? null,
            segmentName: booking.segment?.name ?? null,
            mentor: booking.mentor ?? null
          } : null
        };
      });
      return res.json({ success: true, payments: rows });
    } catch (err) {
      return respondWithServerError({ req, res, error: err, context: "GET /api/admin/users/:id/payments", clientMessage: "Unable to load payments." });
    }
  });
  app.get("/api/admin/users/:id/workspaces", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      const userId = req.params.id;
      if (!UUID_PATTERN.test(userId)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_USER_ID", message: "User ID must be a valid UUID." } });
      }
      const { data: workspaces, error: workspacesErr } = await admin.from("session_workspaces").select(`
          id, booking_id, mentor_id, seeker_id, status, published_at, created_at, updated_at,
          booking:bookings(id, booking_code, start_time, end_time, status, segment:segments(id, name)),
          mentor:profiles!session_workspaces_mentor_id_fkey(id, full_name, email),
          seeker:profiles!session_workspaces_seeker_id_fkey(id, full_name, email)
        `).or(`seeker_id.eq.${userId},mentor_id.eq.${userId}`).order("created_at", { ascending: false });
      if (workspacesErr) throw workspacesErr;
      return res.json({
        success: true,
        workspaces: (workspaces || []).map((w) => ({
          id: w.id,
          bookingId: w.booking_id,
          status: w.status,
          publishedAt: w.published_at,
          createdAt: w.created_at,
          updatedAt: w.updated_at,
          mentor: w.mentor ?? null,
          seeker: w.seeker ?? null,
          booking: w.booking ?? null
        }))
      });
    } catch (err) {
      return respondWithServerError({ req, res, error: err, context: "GET /api/admin/users/:id/workspaces", clientMessage: "Unable to load workspaces." });
    }
  });
  app.get("/api/admin/users/:id/notifications", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      const userId = req.params.id;
      if (!UUID_PATTERN.test(userId)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_USER_ID", message: "User ID must be a valid UUID." } });
      }
      const { data: notifications, error: notifErr } = await admin.from("notifications").select("id, type, event_type, title, message, link, is_read, read_at, created_at, entity_type, entity_id").eq("user_id", userId).order("created_at", { ascending: false }).limit(100);
      if (notifErr) throw notifErr;
      return res.json({
        success: true,
        notifications: notifications || []
      });
    } catch (err) {
      return respondWithServerError({ req, res, error: err, context: "GET /api/admin/users/:id/notifications", clientMessage: "Unable to load notifications." });
    }
  });
  app.post("/api/admin/users/:id/notifications", requireAuth, requireAdmin, validateBody(apiSchemas.adminUserNotification), async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      const userId = req.params.id;
      if (!UUID_PATTERN.test(userId)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_USER_ID", message: "User ID must be a valid UUID." } });
      }
      const { title, message } = req.body;
      const { data: profile, error: profileErr } = await admin.from("profiles").select("id").eq("id", userId).maybeSingle();
      if (profileErr) throw profileErr;
      if (!profile) {
        return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "User not found." } });
      }
      const { data: inserted, error: insertErr } = await admin.from("notifications").insert({
        user_id: userId,
        title,
        message,
        type: "ADMIN",
        event_type: "ADMIN_MESSAGE",
        entity_type: "user",
        entity_id: userId,
        is_read: false,
        metadata: { adminId: req.auth.user.id },
        created_at: (/* @__PURE__ */ new Date()).toISOString()
      }).select("id, created_at").single();
      if (insertErr) throw insertErr;
      await auditAction(req.auth, "ADMIN_NOTIFICATION_SENT", {
        entityType: "user",
        entityId: userId,
        requestId: req.requestId,
        metadata: { targetUserId: userId, adminId: req.auth.user.id, notificationId: inserted?.id ?? null, title }
      });
      return res.status(201).json({ success: true, message: "Notification sent.", notification: inserted });
    } catch (err) {
      return respondWithServerError({ req, res, error: err, context: "POST /api/admin/users/:id/notifications", clientMessage: "Unable to send the notification." });
    }
  });
  app.get("/api/admin/users/:id/audit", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      const userId = req.params.id;
      if (!UUID_PATTERN.test(userId)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_USER_ID", message: "User ID must be a valid UUID." } });
      }
      const [{ data: gigs }, { data: bookings }, { data: application }] = await Promise.all([
        admin.from("gigs").select("id").eq("mentor_id", userId),
        admin.from("bookings").select("id").or(`seeker_id.eq.${userId},mentor_id.eq.${userId}`),
        admin.from("mentor_applications").select("id").eq("user_id", userId).maybeSingle()
      ]);
      const childIds = [
        ...(gigs || []).map((g) => g.id),
        ...(bookings || []).map((b) => b.id),
        ...application?.id ? [application.id] : []
      ];
      const orFilter = [userId, ...childIds].map((id) => `entity_id.eq.${id}`).join(",");
      const { data: entries, error: auditErr } = await admin.from("audit_logs").select("id, created_at, actor_user_id, actor_role, action, entity_type, entity_id, request_id, metadata").or(orFilter).order("created_at", { ascending: false }).limit(100);
      if (auditErr) throw auditErr;
      const relevant = (entries || []).filter((entry) => {
        if (entry.entity_id === userId) return true;
        const meta = entry.metadata || {};
        return (meta.targetUserId ?? meta.userId ?? meta.mentorId ?? meta.mentor_id) === userId;
      });
      const actorIds = Array.from(new Set(relevant.map((e) => e.actor_user_id).filter(Boolean)));
      const { data: actors } = actorIds.length ? await admin.from("profiles").select("id, full_name, email").in("id", actorIds) : { data: [] };
      const actorMap = new Map((actors || []).map((a) => [a.id, a]));
      return res.json({
        success: true,
        entries: relevant.map((entry) => ({
          id: entry.id,
          createdAt: entry.created_at,
          action: entry.action,
          entityType: entry.entity_type,
          entityId: entry.entity_id,
          requestId: entry.request_id,
          actorRole: entry.actor_role,
          actor: entry.actor_user_id ? {
            id: entry.actor_user_id,
            name: actorMap.get(entry.actor_user_id)?.full_name ?? null,
            email: actorMap.get(entry.actor_user_id)?.email ?? null
          } : null,
          metadata: entry.metadata ?? null
        }))
      });
    } catch (err) {
      return respondWithServerError({ req, res, error: err, context: "GET /api/admin/users/:id/audit", clientMessage: "Unable to load the audit log." });
    }
  });
  app.post("/api/admin/users/:id/password-reset", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      const userId = req.params.id;
      if (!UUID_PATTERN.test(userId)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_USER_ID", message: "User ID must be a valid UUID." } });
      }
      const { data: profile, error: profileErr } = await admin.from("profiles").select("id, email, full_name").eq("id", userId).maybeSingle();
      if (profileErr) throw profileErr;
      if (!profile) {
        return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "User not found." } });
      }
      if (!profile.email || !EMAIL_PATTERN2.test(profile.email)) {
        return res.status(400).json({ success: false, error: { code: "INVALID_EMAIL", message: "This account has no usable email address." } });
      }
      const appBaseUrl = process.env.APP_URL || process.env.APP_BASE_URL || process.env.VITE_APP_BASE_URL || process.env.PUBLIC_APP_URL;
      if (!appBaseUrl) {
        return res.status(503).json({
          success: false,
          error: { code: "EMAIL_NOT_CONFIGURED", message: "Unable to send password reset email: the application URL is not configured." }
        });
      }
      const { error: resetErr } = await admin.auth.admin.generateLink({
        type: "recovery",
        email: profile.email,
        options: { redirectTo: `${appBaseUrl.replace(/\/$/, "")}/auth/callback` }
      });
      if (resetErr) {
        const info = describeSupabaseError(resetErr);
        return res.status(502).json({
          success: false,
          error: { code: info.code, message: `Unable to send password reset email: ${info.message}` }
        });
      }
      await auditAction(req.auth, "PASSWORD_RESET_REQUESTED", {
        entityType: "user",
        entityId: userId,
        requestId: req.requestId,
        metadata: { targetUserId: userId, adminId: req.auth.user.id, email: profile.email }
      });
      return res.json({
        success: true,
        message: "Password reset email sent to the account holder.",
        email: profile.email
      });
    } catch (err) {
      return respondWithServerError({ req, res, error: err, context: "POST /api/admin/users/:id/password-reset", clientMessage: "Unable to send password reset email." });
    }
  });
  app.get("/api/admin/dashboard/overview", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const dashboard = await getAdminDashboardData(admin);
      return res.json({ success: true, dashboard });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "GET /api/admin/dashboard/overview",
        clientMessage: "Dashboard data is temporarily unavailable."
      });
    }
  });
  app.get("/api/admin/payments", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: payments, error: paymentsErr } = await admin.from("payments").select(`
          *,
          booking:bookings (
            id,
            booking_code,
            seeker_id,
            mentor_id,
            gig_id,
            status,
            amount_inr
          )
        `).order("created_at", { ascending: false });
      if (paymentsErr) throw paymentsErr;
      const seekerIds = [...new Set((payments || []).map((p) => p.booking?.seeker_id).filter(Boolean))];
      const mentorIds = [...new Set((payments || []).map((p) => p.booking?.mentor_id).filter(Boolean))];
      const gigIds = [...new Set((payments || []).map((p) => p.booking?.gig_id).filter(Boolean))];
      const [seekerRes, mentorRes, gigRes] = await Promise.all([
        seekerIds.length ? admin.from("profiles").select("id, full_name").in("id", seekerIds) : { data: [], error: null },
        mentorIds.length ? admin.from("profiles").select("id, full_name").in("id", mentorIds) : { data: [], error: null },
        gigIds.length ? admin.from("gigs").select("id, title").in("id", gigIds) : { data: [], error: null }
      ]);
      const seekerMap = new Map((seekerRes.data || []).map((s) => [s.id, s.full_name]));
      const mentorMap = new Map((mentorRes.data || []).map((m) => [m.id, m.full_name]));
      const gigMap = new Map((gigRes.data || []).map((g) => [g.id, g.title]));
      const SIGNED_PROOF_TTL_SECONDS = 300;
      const formattedPayments = await Promise.all(
        (payments || []).map(async (p) => {
          let proofUrl = null;
          if (p.proof_storage_path) {
            try {
              const { data: signed, error: signedErr } = await admin.storage.from(PAYMENT_PROOF_BUCKET).createSignedUrl(p.proof_storage_path, SIGNED_PROOF_TTL_SECONDS);
              if (signedErr) {
                console.error("Failed to sign payment proof:", signedErr.message);
              } else {
                proofUrl = signed?.signedUrl ?? null;
              }
            } catch (signErr) {
              console.error("Failed to sign payment proof:", logSanitizer.safeMessage(signErr));
            }
          }
          return projectAdminPayment(p, {
            seekerName: p.booking?.seeker_id ? seekerMap.get(p.booking.seeker_id) : null,
            mentorName: p.booking?.mentor_id ? mentorMap.get(p.booking.mentor_id) : null,
            gigTitle: p.booking?.gig_id ? gigMap.get(p.booking.gig_id) : null,
            proofUrl
          });
        })
      );
      return res.json({ success: true, payments: formattedPayments });
    } catch (err) {
      console.error("Failed to fetch admin payments:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });
  const COUPON_COLUMNS = {
    code: "code",
    description: "description",
    discountType: "discount_type",
    discountValue: "discount_value",
    maxDiscountInr: "max_discount_inr",
    minOrderAmountInr: "min_order_amount_inr",
    segmentId: "segment_id",
    mentorId: "mentor_id",
    maxTotalUses: "max_total_uses",
    maxUsesPerUser: "max_uses_per_user",
    startsAt: "starts_at",
    expiresAt: "expires_at"
  };
  const toCouponColumnPatch = (body) => {
    const patch = {};
    for (const [key, column] of Object.entries(COUPON_COLUMNS)) {
      if (body[key] !== void 0) patch[column] = body[key];
    }
    return patch;
  };
  app.get("/api/admin/coupons", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: coupons, error: couponsErr } = await admin.from("coupons").select("*").order("created_at", { ascending: false });
      if (couponsErr) throw couponsErr;
      const ids = (coupons || []).map((c) => c.id);
      const { data: usage, error: usageErr } = ids.length ? await admin.from("coupon_usage").select("coupon_id, status").in("coupon_id", ids) : { data: [], error: null };
      if (usageErr) throw usageErr;
      const counts = /* @__PURE__ */ new Map();
      for (const row of usage || []) {
        const entry = counts.get(row.coupon_id) ?? { reserved: 0, redeemed: 0, released: 0 };
        if (row.status === "RESERVED") entry.reserved += 1;
        else if (row.status === "REDEEMED") entry.redeemed += 1;
        else entry.released += 1;
        counts.set(row.coupon_id, entry);
      }
      return res.json({
        success: true,
        coupons: (coupons || []).map((c) => ({
          ...c,
          reserved_count: counts.get(c.id)?.reserved ?? 0,
          redeemed_count: counts.get(c.id)?.redeemed ?? 0,
          released_count: counts.get(c.id)?.released ?? 0
        }))
      });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err, context: "GET /api/admin/coupons" });
    }
  });
  app.post("/api/admin/coupons", requireAuth, requireAdmin, validateBody(apiSchemas.couponCreate), async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const body = req.body;
      const patch = toCouponColumnPatch(body);
      patch.created_by = req.auth.user.id;
      patch.starts_at = body.startsAt ?? (/* @__PURE__ */ new Date()).toISOString();
      const { data, error } = await admin.from("coupons").insert(patch).select().single();
      if (error) {
        const isDuplicate = String(error.code) === "23505";
        return respondWithServerError({
          req,
          res,
          error,
          status: isDuplicate ? 409 : 400,
          code: isDuplicate ? "COUPON_CODE_EXISTS" : "COUPON_CREATE_FAILED",
          clientMessage: isDuplicate ? "That coupon code is already in use." : "The coupon could not be saved. Check the discount and its limits.",
          context: "POST /api/admin/coupons"
        });
      }
      auditAction(req.auth, "coupon_created", {
        entityType: "coupon",
        entityId: data.id,
        requestId: req.requestId,
        metadata: {
          code: data.code,
          discountType: data.discount_type,
          discountValue: data.discount_value,
          maxTotalUses: data.max_total_uses
        }
      });
      return res.status(201).json({ success: true, coupon: data });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err, context: "POST /api/admin/coupons" });
    }
  });
  app.patch("/api/admin/coupons/:id", requireAuth, requireAdmin, validateBody(apiSchemas.couponUpdate), async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const patch = toCouponColumnPatch(req.body);
      delete patch.code;
      const { data, error } = await admin.from("coupons").update(patch).eq("id", req.params.id).select().single();
      if (error) {
        const isDuplicate = String(error.code) === "23505";
        return respondWithServerError({
          req,
          res,
          error,
          status: isDuplicate ? 409 : 400,
          code: isDuplicate ? "COUPON_CODE_EXISTS" : "COUPON_UPDATE_FAILED",
          clientMessage: isDuplicate ? "That coupon code is already in use." : "The coupon could not be updated.",
          context: "PATCH /api/admin/coupons/:id"
        });
      }
      auditAction(req.auth, "coupon_updated", {
        entityType: "coupon",
        entityId: req.params.id,
        requestId: req.requestId,
        metadata: { code: data.code, fields: Object.keys(patch) }
      });
      return res.json({ success: true, coupon: data });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err, context: "PATCH /api/admin/coupons/:id" });
    }
  });
  app.patch("/api/admin/coupons/:id/status", requireAuth, requireAdmin, validateBody(apiSchemas.couponStatus), async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { status } = req.body;
      const { data, error } = await admin.from("coupons").update({ status }).eq("id", req.params.id).select().single();
      if (error) {
        return respondWithServerError({
          req,
          res,
          error,
          status: 400,
          code: "COUPON_STATUS_UPDATE_FAILED",
          clientMessage: "The coupon status could not be changed.",
          context: "PATCH /api/admin/coupons/:id/status"
        });
      }
      const actionByStatus = {
        ACTIVE: "coupon_activated",
        INACTIVE: "coupon_deactivated",
        ARCHIVED: "coupon_archived"
      };
      auditAction(req.auth, actionByStatus[status] ?? "coupon_updated", {
        entityType: "coupon",
        entityId: req.params.id,
        requestId: req.requestId,
        metadata: { code: data.code, status }
      });
      return res.json({ success: true, coupon: data });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err, context: "PATCH /api/admin/coupons/:id/status" });
    }
  });
  app.get("/api/admin/coupons/:id/usage", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: usage, error: usageErr } = await admin.from("coupon_usage").select(`
          id, coupon_id, booking_id, seeker_id, status, discount_amount_inr,
          reserved_at, redeemed_at, released_at, release_reason,
          booking:bookings (id, booking_code, amount_inr, start_time, status)
        `).eq("coupon_id", req.params.id).order("reserved_at", { ascending: false });
      if (usageErr) throw usageErr;
      return res.json({ success: true, usage: usage ?? [] });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err, context: "GET /api/admin/coupons/:id/usage" });
    }
  });
  app.patch("/api/admin/payments/:id/approve", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data, error } = await admin.rpc("review_payment", {
        p_payment_id: id,
        p_approve: true,
        p_rejection_reason: null,
        p_admin_id: req.auth.user.id
      });
      if (error) throw error;
      await notifyPaymentReviewed(admin, {
        paymentId: id,
        bookingId: data?.booking_id,
        approved: true
      });
      auditAction(req.auth, "payment_approved", {
        entityType: "payment",
        entityId: id,
        requestId: req.requestId,
        metadata: { bookingId: data?.booking_id }
      });
      return res.json({ success: true, message: "Payment approved successfully." });
    } catch (err) {
      console.error("Failed to approve payment:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.patch("/api/admin/payments/:id/reject", requireAuth, requireAdmin, validateBody(apiSchemas.paymentReject), async (req, res) => {
    try {
      const { id } = req.params;
      const { rejectionReason } = req.body;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data, error } = await admin.rpc("review_payment", {
        p_payment_id: id,
        p_approve: false,
        p_rejection_reason: rejectionReason || null,
        p_admin_id: req.auth.user.id
      });
      if (error) throw error;
      await notifyPaymentReviewed(admin, {
        paymentId: id,
        bookingId: data?.booking_id,
        approved: false,
        rejectionReason: typeof rejectionReason === "string" && rejectionReason.trim() ? rejectionReason.trim() : null
      });
      auditAction(req.auth, "payment_rejected", {
        entityType: "payment",
        entityId: id,
        requestId: req.requestId,
        metadata: { bookingId: data?.booking_id, rejectionReason }
      });
      return res.json({ success: true, message: "Payment rejected successfully." });
    } catch (err) {
      console.error("Failed to reject payment:", logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.post("/api/admin/payments/:id/complete-manual-refund", requireAuth, requireAdmin, validateBody(apiSchemas.manualRefundComplete), async (req, res) => {
    const { id } = req.params;
    const body = req.body;
    const admin = getSupabaseAdmin();
    if (!admin) {
      return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
    }
    const discardUpload = async () => {
      try {
        await admin.storage.from(PAYMENT_PROOF_BUCKET).remove([body.storagePath]);
      } catch (cleanupErr) {
        console.error("Failed to clean up orphaned refund proof:", logSanitizer.safeMessage(cleanupErr));
      }
    };
    try {
      const method = normaliseRefundMethod(body.refundMethod);
      if (!method.ok) {
        return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", field: "refundMethod", message: method.message } });
      }
      const reference = normaliseRefundReference(body.refundReference);
      if (!reference.ok) {
        return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", field: "refundReference", message: reference.message } });
      }
      const proofFile = validateRefundProofFile({ name: body.fileName, type: body.mimeType, size: body.fileSize });
      if (!proofFile.ok) {
        return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", field: "storagePath", message: proofFile.message } });
      }
      if (!isRefundProofPathFor(id, body.storagePath)) {
        return res.status(403).json({ success: false, error: { code: "FORBIDDEN_STORAGE_PATH", message: "That file does not belong to this payment." } });
      }
      const { data: payment, error: paymentErr } = await admin.from("payments").select("id, booking_id, seeker_id, amount_inr, status, gateway, manual_refund_required, refund_status, refund_id").eq("id", id).maybeSingle();
      if (paymentErr) throw paymentErr;
      if (!payment) {
        return res.status(404).json({ success: false, error: { code: "PAYMENT_NOT_FOUND", message: "Payment not found." } });
      }
      if (!canProcessManualRefund({
        gateway: payment.gateway,
        status: payment.status,
        refundStatus: payment.refund_status,
        manualRefundRequired: payment.manual_refund_required
      })) {
        return res.status(409).json({
          success: false,
          error: {
            code: payment.refund_status === "REFUNDED" || payment.status === "REFUNDED" ? "ALREADY_REFUNDED" : "REFUND_NOT_PENDING",
            message: payment.refund_status === "REFUNDED" || payment.status === "REFUNDED" ? "This payment has already been refunded." : "This payment has no manual refund awaiting completion."
          }
        });
      }
      const amount = normaliseRefundAmount(body.refundAmountInr, payment.amount_inr);
      if (!amount.ok) {
        return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", field: "refundAmountInr", message: amount.message } });
      }
      const objectName = body.storagePath.split("/").pop();
      const { data: storedFile, error: statErr } = await admin.storage.from(PAYMENT_PROOF_BUCKET).list(`${REFUND_PROOF_PATH_PREFIX}/${id}`, { search: objectName, limit: 10 });
      if (statErr) {
        console.error("Refund proof lookup failed:", statErr.message);
        return respondWithInternalError({ req, res, error: statErr, context: "POST /api/admin/payments/:id/complete-manual-refund (storage lookup)" });
      }
      const storedObject = (storedFile || []).find((f) => f.name === objectName);
      if (!storedObject) {
        return res.status(400).json({ success: false, error: { code: "PROOF_NOT_STORED", message: "We could not find that refund receipt. Please attach it again." } });
      }
      const storedBytes = storedObject.metadata?.size;
      if (typeof storedBytes === "number" && storedBytes > PAYMENT_PROOF_MAX_BYTES) {
        await discardUpload();
        return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", field: "storagePath", message: `That image is too large. Please attach one under ${REFUND_PROOF_MAX_LABEL}.` } });
      }
      const { data: result, error: rpcErr } = await admin.rpc("complete_manual_refund", {
        p_payment_id: id,
        p_admin_id: req.auth.user.id,
        p_amount_paise: toPaise(amount.value),
        p_method: method.value,
        p_reference: reference.value,
        p_proof_path: body.storagePath,
        p_admin_note: typeof body.adminNote === "string" ? body.adminNote : null
      });
      if (rpcErr) {
        await discardUpload();
        const code = refundCompletionFailureCode(rpcErr.message);
        return res.status(refundCompletionFailureStatus(code)).json({
          success: false,
          error: { code, message: refundCompletionFailureReason(code) }
        });
      }
      auditAction(req.auth, "manual_refund_completed", {
        entityType: "payment",
        entityId: id,
        requestId: req.requestId,
        // Names and the reference only. Never the proof contents, never a
        // storage path, never a credential.
        metadata: {
          bookingId: payment.booking_id,
          amountInr: amount.value,
          refundMethod: method.value,
          refundReference: reference.value
        }
      });
      return res.json({
        success: true,
        refund: result,
        message: `The refund of \u20B9${amount.value.toLocaleString("en-IN")} was recorded as completed by ${refundMethodLabel(method.value)}.`
      });
    } catch (err) {
      console.error("Failed to complete manual refund:", logSanitizer.safeMessage(err));
      await discardUpload();
      return respondWithInternalError({ req, res, error: err, context: "POST /api/admin/payments/:id/complete-manual-refund" });
    }
  });
  app.get("/api/admin/payments/:id/refund-proof", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: payment, error: paymentErr } = await admin.from("payments").select("refund_proof_storage_path").eq("id", req.params.id).maybeSingle();
      if (paymentErr) throw paymentErr;
      if (!payment) {
        return res.status(404).json({ success: false, error: { code: "PAYMENT_NOT_FOUND", message: "Payment not found." } });
      }
      if (!isRefundProofPathFor(req.params.id, payment.refund_proof_storage_path)) {
        return res.status(404).json({ success: false, error: { code: "PROOF_NOT_STORED", message: "No refund proof is stored for this payment." } });
      }
      const { data: signed, error: signedErr } = await admin.storage.from(PAYMENT_PROOF_BUCKET).createSignedUrl(payment.refund_proof_storage_path, 300);
      if (signedErr) {
        console.error("Failed to sign refund proof:", signedErr.message);
        return res.status(500).json({ success: false, error: { code: "PROOF_NOT_STORED", message: "The refund proof could not be opened right now." } });
      }
      return res.json({ success: true, url: signed?.signedUrl ?? null });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err, context: "GET /api/admin/payments/:id/refund-proof" });
    }
  });
  app.get("/api/admin/platform-config", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data, error } = await admin.from("platform_config").select("*").eq("id", 1).maybeSingle();
      if (error) throw error;
      return res.json({
        success: true,
        payment: {
          upiId: data?.upi_id ?? null,
          qrImageStoragePath: data?.qr_image_storage_path ?? null,
          qrImageUrl: await signQrImageUrl(admin, data?.qr_image_storage_path ?? null),
          instructions: data?.payment_instructions ?? null,
          currency: data?.currency ?? null,
          accountName: data?.payment_account_name ?? null,
          updatedAt: data?.updated_at ?? null
        },
        rules: {
          holdDurationMinutes: APP_CONFIG.HOLD_DURATION_MS / 6e4,
          sessionAccessWindowMinutes: APP_CONFIG.SESSION_ACCESS_WINDOW_MS / 6e4,
          meetingLinkDeadlineMinutes: APP_CONFIG.MEETING_LINK_DEADLINE_MS / 6e4,
          bookingCutoffMinutes: APP_CONFIG.BOOKING_CUTOFF_MS / 6e4,
          cancellationWindowMinutes: APP_CONFIG.NORMAL_CANCELLATION_WINDOW_MINUTES,
          defaultTimezone: APP_CONFIG.DEFAULT_TIMEZONE,
          paymentMethod: APP_CONFIG.MVP_PAYMENT_METHOD
        }
      });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "GET /api/admin/platform-config",
        clientMessage: "Unable to load the platform configuration."
      });
    }
  });
  app.get("/api/platform-config", requireAuth, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data, error } = await admin.from("platform_config").select("upi_id, qr_image_storage_path, payment_instructions, currency, payment_account_name").eq("id", 1).maybeSingle();
      if (error) throw error;
      return res.json({
        success: true,
        payment: {
          upiId: data?.upi_id ?? null,
          qrImageUrl: await signQrImageUrl(admin, data?.qr_image_storage_path ?? null),
          instructions: data?.payment_instructions ?? null,
          currency: data?.currency ?? null,
          accountName: data?.payment_account_name ?? null
        }
      });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "GET /api/platform-config",
        clientMessage: "Unable to load payment details."
      });
    }
  });
  app.patch("/api/admin/platform-config", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const body = req.body ?? {};
      const QR_PATH_PATTERN = /^platform\/payment-qr-[0-9]{13}-[a-z0-9]{6}\.(png|jpe?g|webp)$/i;
      const optionalText2 = (maxLength) => (value, field) => {
        if (value === void 0) return void 0;
        if (value === null) return null;
        if (typeof value !== "string") throw new HttpError(400, "VALIDATION_ERROR", `${field} must be a string.`);
        const trimmed = value.trim();
        if (trimmed.length > maxLength) {
          throw new HttpError(400, "VALIDATION_ERROR", `${field} must be ${maxLength} characters or fewer.`);
        }
        return trimmed === "" ? null : trimmed;
      };
      const updates = {};
      const changedFields = [];
      const upiId = optionalText2(120)(body.upiId, "UPI ID");
      if (upiId !== void 0) {
        if (upiId !== null && !/^[A-Za-z0-9._-]{2,}@[A-Za-z0-9-]{1,}$/.test(upiId)) {
          throw new HttpError(400, "VALIDATION_ERROR", "Enter a valid UPI ID, for example name@bank.");
        }
        updates.upi_id = upiId;
        changedFields.push("upi_id");
      }
      const accountName = optionalText2(120)(body.accountName, "Account name");
      if (accountName !== void 0) {
        updates.payment_account_name = accountName;
        changedFields.push("payment_account_name");
      }
      const instructions = optionalText2(1e3)(body.instructions, "Payment instructions");
      if (instructions !== void 0) {
        updates.payment_instructions = instructions;
        changedFields.push("payment_instructions");
      }
      if (body.currency !== void 0) {
        if (body.currency !== null && body.currency !== "INR") {
          throw new HttpError(400, "VALIDATION_ERROR", "Currency is fixed to INR: all amounts are stored in rupees.");
        }
        updates.currency = "INR";
        changedFields.push("currency");
      }
      if (body.qrImageStoragePath !== void 0) {
        if (body.qrImageStoragePath === null) {
          updates.qr_image_storage_path = null;
        } else if (typeof body.qrImageStoragePath === "string" && QR_PATH_PATTERN.test(body.qrImageStoragePath)) {
          updates.qr_image_storage_path = body.qrImageStoragePath;
        } else {
          throw new HttpError(400, "VALIDATION_ERROR", "Unknown payment QR reference.");
        }
        changedFields.push("qr_image_storage_path");
      }
      if (changedFields.length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "No editable payment setting was provided." }
        });
      }
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      const adminId = req.auth.user.id;
      const { data, error } = await admin.from("platform_config").upsert({ id: 1, ...updates, updated_at: nowIso, updated_by: adminId }, { onConflict: "id" }).select("upi_id, qr_image_storage_path, payment_instructions, currency, payment_account_name, updated_at").single();
      if (error) throw error;
      auditAction(req.auth, "ADMIN_UPDATED_PAYMENT_CONFIGURATION", {
        entityType: "platform_config",
        entityId: "1",
        requestId: req.requestId,
        // Field NAMES only. Payment values are deliberately not copied into the
        // audit trail, so the log cannot become a second copy of the config.
        metadata: { fields: changedFields }
      });
      return res.json({
        success: true,
        payment: {
          upiId: data.upi_id,
          qrImageStoragePath: data.qr_image_storage_path,
          qrImageUrl: await signQrImageUrl(admin, data.qr_image_storage_path),
          instructions: data.payment_instructions,
          currency: data.currency,
          accountName: data.payment_account_name,
          updatedAt: data.updated_at
        },
        message: "Payment configuration saved."
      });
    } catch (err) {
      if (err instanceof HttpError) {
        return res.status(err.status).json({ success: false, error: { code: err.code, message: err.message } });
      }
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "PATCH /api/admin/platform-config",
        clientMessage: "Unable to save the payment configuration."
      });
    }
  });
  app.post("/api/admin/platform-config/qr-upload-url", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const body = req.body ?? {};
      const type = typeof body.fileType === "string" ? body.fileType : "";
      const size = typeof body.fileSize === "number" ? body.fileSize : Number.NaN;
      if (!PAYMENT_QR_MIME_TYPES.includes(type)) {
        throw new HttpError(400, "VALIDATION_ERROR", "Upload a PNG, JPEG or WebP image.");
      }
      if (!Number.isFinite(size) || size <= 0) {
        throw new HttpError(400, "VALIDATION_ERROR", "That file is empty.");
      }
      if (size > PAYMENT_QR_MAX_BYTES) {
        throw new HttpError(400, "VALIDATION_ERROR", `That image is larger than ${PAYMENT_QR_MAX_LABEL}.`);
      }
      const extensionByMimeType = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp"
      };
      const storagePath = `platform/payment-qr-${Date.now()}-${(0, import_crypto5.randomUUID)().slice(0, 6)}.${extensionByMimeType[type]}`;
      const { data, error } = await admin.storage.from(PAYMENT_QR_BUCKET).createSignedUploadUrl(storagePath);
      if (error) throw error;
      return res.json({
        success: true,
        uploadUrl: data.signedUrl,
        token: data.token,
        path: storagePath
      });
    } catch (err) {
      if (err instanceof HttpError) {
        return res.status(err.status).json({ success: false, error: { code: err.code, message: err.message } });
      }
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "POST /api/admin/platform-config/qr-upload-url",
        clientMessage: "Unable to prepare the payment QR upload."
      });
    }
  });
  app.delete("/api/admin/platform-config/qr", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const adminId = req.auth.user.id;
      const { data: current, error: readErr } = await admin.from("platform_config").select("qr_image_storage_path").eq("id", 1).maybeSingle();
      if (readErr) throw readErr;
      const previousPath = current?.qr_image_storage_path ?? null;
      const { error: writeErr } = await admin.from("platform_config").upsert(
        { id: 1, qr_image_storage_path: null, updated_at: (/* @__PURE__ */ new Date()).toISOString(), updated_by: adminId },
        { onConflict: "id" }
      );
      if (writeErr) throw writeErr;
      if (previousPath) {
        const { error: removeErr } = await admin.storage.from(PAYMENT_QR_BUCKET).remove([previousPath]);
        if (removeErr) {
          console.error("Failed to remove the previous payment QR object:", removeErr.message);
        }
      }
      auditAction(req.auth, "ADMIN_UPDATED_PAYMENT_CONFIGURATION", {
        entityType: "platform_config",
        entityId: "1",
        requestId: req.requestId,
        metadata: { fields: ["qr_image_storage_path"], action: "qr_removed" }
      });
      return res.json({ success: true, message: "Payment QR removed." });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "DELETE /api/admin/platform-config/qr",
        clientMessage: "Unable to remove the payment QR."
      });
    }
  });
  const SUPPORT_ERROR_CODES = /* @__PURE__ */ new Set([
    "UNAUTHORIZED",
    "FORBIDDEN_NOT_TICKET_OWNER",
    "FORBIDDEN_NOT_BOOKING_PARTICIPANT",
    "FORBIDDEN_STORAGE_PATH",
    "TICKET_NOT_FOUND",
    "TICKET_NOT_REPLYABLE",
    "TICKET_CLOSED",
    "INVALID_TRANSITION",
    "CATEGORY_NOT_ALLOWED",
    "SUBJECT_INVALID",
    "MESSAGE_INVALID",
    "RESOLUTION_REQUIRED",
    "BOOKING_NOT_FOUND",
    "PRIORITY_INVALID",
    "STATUS_INVALID",
    "ASSIGNEE_NOT_ADMIN",
    "FILE_TYPE_NOT_ALLOWED",
    "FILE_TOO_LARGE",
    "USE_RESOLVE_ENDPOINT",
    "NO_CHANGES"
  ]);
  const SUPPORT_ERROR_MESSAGES = {
    UNAUTHORIZED: "You are not authorized to perform this action.",
    FORBIDDEN_NOT_TICKET_OWNER: "You are not authorized to view this support ticket.",
    FORBIDDEN_NOT_BOOKING_PARTICIPANT: "That booking reference is not yours.",
    FORBIDDEN_STORAGE_PATH: "That file does not belong to this ticket.",
    TICKET_NOT_FOUND: "Support ticket not found.",
    TICKET_NOT_REPLYABLE: "This ticket is closed and cannot receive new replies.",
    TICKET_CLOSED: "This ticket is closed. Please raise a new support ticket.",
    INVALID_TRANSITION: "That change is not allowed for the current ticket status.",
    CATEGORY_NOT_ALLOWED: "Choose a category available for your account type.",
    SUBJECT_INVALID: "The subject must be between 4 and 140 characters.",
    MESSAGE_INVALID: "That message is not a valid length.",
    RESOLUTION_REQUIRED: "Write a resolution message for the user.",
    BOOKING_NOT_FOUND: "No booking matches that reference.",
    PRIORITY_INVALID: "Unknown ticket priority.",
    STATUS_INVALID: "Unknown ticket status.",
    ASSIGNEE_NOT_ADMIN: "A ticket can only be assigned to an admin.",
    FILE_TYPE_NOT_ALLOWED: "Only PNG, JPG, WebP or PDF files can be attached.",
    FILE_TOO_LARGE: "Attachments must be 5 MB or smaller.",
    USE_RESOLVE_ENDPOINT: "Resolving a ticket requires a resolution message.",
    NO_CHANGES: "No changes were requested."
  };
  function supportFailure(res, context, dbMessage) {
    const match = /code:\s*([A-Z_]+)/.exec(dbMessage ?? "");
    const code = match && SUPPORT_ERROR_CODES.has(match[1]) ? match[1] : "SUPPORT_OPERATION_FAILED";
    const status = code === "UNAUTHORIZED" || code.startsWith("FORBIDDEN") ? 403 : code === "TICKET_NOT_FOUND" || code === "BOOKING_NOT_FOUND" ? 404 : code === "SUPPORT_OPERATION_FAILED" ? 500 : 409;
    if (status === 500) {
      console.error(`[Support] ${context}:`, logSanitizer.safeMessage(dbMessage));
    }
    res.status(status).json({
      success: false,
      error: {
        code,
        message: SUPPORT_ERROR_MESSAGES[code] ?? "We could not complete that support action. Please try again."
      }
    });
  }
  async function runSupportRpc(res, context, fn) {
    const { data, error } = await fn();
    if (error) {
      supportFailure(res, context, error.message);
      return;
    }
    res.status(200).json(data);
  }
  const supportUnavailable = (res) => res.status(503).json({
    success: false,
    error: { code: "SERVICE_UNAVAILABLE", message: "Support is temporarily unavailable." }
  });
  app.get("/api/support/tickets", requireAuth, async (req, res) => {
    const admin = getSupabaseAdmin();
    if (!admin) return supportUnavailable(res);
    const parsed = apiSchemas.supportQueueQuery.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: formatValidationFailure(parsed.error).message
        }
      });
    }
    const q = parsed.data;
    return runSupportRpc(
      res,
      "GET /api/support/tickets",
      () => admin.rpc("list_support_tickets", {
        p_caller_id: req.auth.user.id,
        p_scope: q.scope,
        p_status: q.status ?? null,
        p_priority: q.priority ?? null,
        p_category: q.category ?? null,
        p_requester_role: q.requesterRole ?? null,
        p_assigned_admin_id: null,
        p_search: q.search ?? null,
        p_limit: 200,
        p_offset: 0
      })
    );
  });
  app.get("/api/support/tickets/metrics", requireAuth, requireAdmin, async (req, res) => {
    const admin = getSupabaseAdmin();
    if (!admin) return supportUnavailable(res);
    return runSupportRpc(
      res,
      "GET /api/support/tickets/metrics",
      () => admin.rpc("support_ticket_metrics", { p_caller_id: req.auth.user.id })
    );
  });
  app.post(
    "/api/support/tickets",
    requireAuth,
    expensiveRouteLimiter,
    validateBody(apiSchemas.supportTicketCreate),
    async (req, res) => {
      const admin = getSupabaseAdmin();
      if (!admin) return supportUnavailable(res);
      const { category, subject, message, bookingCode } = req.body ?? {};
      const { data, error } = await admin.rpc("create_support_ticket", {
        // The caller's real id. There is no body field that could override it.
        p_requester_id: req.auth.user.id,
        p_category: category,
        p_subject: subject,
        p_message: message,
        p_booking_code: bookingCode ?? null
      });
      if (error) {
        supportFailure(res, "POST /api/support/tickets", error.message);
        return;
      }
      auditAction(req.auth, "support_ticket_created", {
        entityType: "support_ticket",
        entityId: data?.ticket?.ticketCode,
        requestId: req.requestId,
        metadata: { category }
      });
      return res.status(201).json(data);
    }
  );
  app.get("/api/support/tickets/:ticketCode", requireAuth, async (req, res) => {
    const admin = getSupabaseAdmin();
    if (!admin) return supportUnavailable(res);
    return runSupportRpc(
      res,
      "GET /api/support/tickets/:ticketCode",
      () => admin.rpc("get_support_ticket", {
        p_ticket_code: req.params.ticketCode,
        p_caller_id: req.auth.user.id
      })
    );
  });
  app.post(
    "/api/support/tickets/:ticketCode/messages",
    requireAuth,
    validateBody(apiSchemas.supportMessageCreate),
    async (req, res) => {
      const admin = getSupabaseAdmin();
      if (!admin) return supportUnavailable(res);
      const { data, error } = await admin.rpc("add_support_message", {
        p_ticket_code: req.params.ticketCode,
        p_actor_id: req.auth.user.id,
        p_message: req.body?.message
      });
      if (error) {
        supportFailure(res, "POST /api/support/tickets/:ticketCode/messages", error.message);
        return;
      }
      auditAction(req.auth, "support_ticket_message_sent", {
        entityType: "support_ticket",
        entityId: req.params.ticketCode,
        requestId: req.requestId
      });
      return res.status(200).json(data);
    }
  );
  app.post(
    "/api/support/tickets/:ticketCode/internal-notes",
    requireAuth,
    requireAdmin,
    validateBody(apiSchemas.supportInternalNote),
    async (req, res) => {
      const admin = getSupabaseAdmin();
      if (!admin) return supportUnavailable(res);
      const { data, error } = await admin.rpc("add_support_internal_note", {
        p_ticket_code: req.params.ticketCode,
        p_admin_id: req.auth.user.id,
        p_note: req.body?.note
      });
      if (error) {
        supportFailure(res, "POST /api/support/tickets/:ticketCode/internal-notes", error.message);
        return;
      }
      auditAction(req.auth, "support_ticket_internal_note_added", {
        entityType: "support_ticket",
        entityId: req.params.ticketCode,
        requestId: req.requestId
      });
      return res.status(200).json(data);
    }
  );
  app.patch(
    "/api/support/tickets/:ticketCode",
    requireAuth,
    requireAdmin,
    validateBody(apiSchemas.supportAdminUpdate),
    async (req, res) => {
      const admin = getSupabaseAdmin();
      if (!admin) return supportUnavailable(res);
      const { status, priority, assignedAdminId } = req.body ?? {};
      const { data, error } = await admin.rpc("update_support_ticket", {
        p_ticket_code: req.params.ticketCode,
        p_admin_id: req.auth.user.id,
        p_status: status ?? null,
        p_priority: priority ?? null,
        // Taken from the admin's own choice, but the RPC re-checks that the
        // assignee really holds the admin role.
        p_assigned_admin_id: assignedAdminId ?? null,
        p_unassign: assignedAdminId === null
      });
      if (error) {
        supportFailure(res, "PATCH /api/support/tickets/:ticketCode", error.message);
        return;
      }
      auditAction(req.auth, "support_ticket_updated", {
        entityType: "support_ticket",
        entityId: req.params.ticketCode,
        requestId: req.requestId,
        metadata: {
          status: status ?? null,
          priority: priority ?? null,
          assignmentChanged: assignedAdminId !== void 0
        }
      });
      return res.status(200).json(data);
    }
  );
  app.post(
    "/api/support/tickets/:ticketCode/resolve",
    requireAuth,
    requireAdmin,
    validateBody(apiSchemas.supportResolve),
    async (req, res) => {
      const admin = getSupabaseAdmin();
      if (!admin) return supportUnavailable(res);
      const { data, error } = await admin.rpc("resolve_support_ticket", {
        p_ticket_code: req.params.ticketCode,
        p_admin_id: req.auth.user.id,
        p_resolution: req.body?.resolution
      });
      if (error) {
        supportFailure(res, "POST /api/support/tickets/:ticketCode/resolve", error.message);
        return;
      }
      auditAction(req.auth, "support_ticket_resolved", {
        entityType: "support_ticket",
        entityId: req.params.ticketCode,
        requestId: req.requestId
      });
      return res.status(200).json(data);
    }
  );
  app.post(
    "/api/support/tickets/:ticketCode/reopen",
    requireAuth,
    validateBody(apiSchemas.supportReopen),
    async (req, res) => {
      const admin = getSupabaseAdmin();
      if (!admin) return supportUnavailable(res);
      const { data, error } = await admin.rpc("reopen_support_ticket", {
        p_ticket_code: req.params.ticketCode,
        p_actor_id: req.auth.user.id,
        p_reason: req.body?.reason
      });
      if (error) {
        supportFailure(res, "POST /api/support/tickets/:ticketCode/reopen", error.message);
        return;
      }
      auditAction(req.auth, "support_ticket_reopened", {
        entityType: "support_ticket",
        entityId: req.params.ticketCode,
        requestId: req.requestId
      });
      return res.status(200).json(data);
    }
  );
  app.get(
    "/api/support/tickets/:ticketCode/attachments/upload-url",
    requireAuth,
    expensiveRouteLimiter,
    validateBody(apiSchemas.supportAttachmentUploadRequest),
    async (req, res) => {
      const admin = getSupabaseAdmin();
      if (!admin) return supportUnavailable(res);
      const callerId = req.auth.user.id;
      const { fileName, mimeType, fileSize } = req.body ?? {};
      const { data: ticket, error: ticketErr } = await admin.from("support_tickets").select("id, requester_id, status").eq("ticket_code", String(req.params.ticketCode).toUpperCase()).maybeSingle();
      if (ticketErr) {
        return respondWithInternalError({
          req,
          res,
          error: ticketErr,
          context: "GET support attachment upload-url"
        });
      }
      if (!ticket) {
        return res.status(404).json({
          success: false,
          error: { code: "TICKET_NOT_FOUND", message: "Support ticket not found." }
        });
      }
      const callerIsAdmin = req.auth.roles.includes("admin");
      if (!callerIsAdmin && ticket.requester_id !== callerId) {
        return res.status(403).json({
          success: false,
          error: { code: "FORBIDDEN_NOT_TICKET_OWNER", message: "You are not authorized to view this support ticket." }
        });
      }
      if (ticket.status === "CLOSED") {
        return res.status(409).json({
          success: false,
          error: { code: "TICKET_CLOSED", message: "This ticket is closed. Please raise a new support ticket." }
        });
      }
      const safeName = buildSupportAttachmentPath(ticket.id, fileName, (0, import_crypto5.randomUUID)().slice(0, 8));
      const { data: signed, error: signErr } = await admin.storage.from(SUPPORT_ATTACHMENT_BUCKET).createSignedUploadUrl(safeName);
      if (signErr || !signed?.token) {
        console.error("[Support] Failed to mint an attachment upload URL:", logSanitizer.safeMessage(signErr));
        return res.status(500).json({
          success: false,
          error: { code: "UPLOAD_UNAVAILABLE", message: "We could not prepare that upload. Please try again." }
        });
      }
      auditAction(req.auth, "support_attachment_upload_url_issued", {
        entityType: "support_ticket",
        entityId: req.params.ticketCode,
        requestId: req.requestId,
        metadata: { mimeType, fileSize }
      });
      return res.json({
        success: true,
        // The path the browser must POST back. Generated here, not by the client.
        storagePath: safeName,
        token: signed.token,
        bucket: SUPPORT_ATTACHMENT_BUCKET
      });
    }
  );
  app.post(
    "/api/support/tickets/:ticketCode/attachments",
    requireAuth,
    validateBody(apiSchemas.supportAttachmentCreate),
    async (req, res) => {
      const admin = getSupabaseAdmin();
      if (!admin) return supportUnavailable(res);
      const { storagePath, fileName, mimeType, fileSize } = req.body ?? {};
      const { data, error } = await admin.rpc("add_support_attachment", {
        p_ticket_code: req.params.ticketCode,
        p_actor_id: req.auth.user.id,
        p_storage_path: storagePath,
        p_file_name: fileName,
        p_mime_type: mimeType,
        p_file_size: fileSize,
        p_message_id: null
      });
      if (error) {
        supportFailure(res, "POST /api/support/tickets/:ticketCode/attachments", error.message);
        return;
      }
      auditAction(req.auth, "support_attachment_added", {
        entityType: "support_ticket",
        entityId: req.params.ticketCode,
        requestId: req.requestId,
        metadata: { mimeType, fileSize }
      });
      return res.status(201).json(data);
    }
  );
  app.get(
    "/api/support/tickets/:ticketCode/attachments/:attachmentId",
    requireAuth,
    async (req, res) => {
      const admin = getSupabaseAdmin();
      if (!admin) return supportUnavailable(res);
      const callerId = req.auth.user.id;
      const { data: attachment, error: attachErr } = await admin.from("support_attachments").select("id, ticket_id, storage_path, file_name, mime_type").eq("id", req.params.attachmentId).maybeSingle();
      if (attachErr) {
        return respondWithInternalError({
          req,
          res,
          error: attachErr,
          context: "GET support attachment"
        });
      }
      if (!attachment) {
        return res.status(404).json({
          success: false,
          error: { code: "TICKET_NOT_FOUND", message: "Attachment not found." }
        });
      }
      const { data: ticket, error: ticketErr } = await admin.from("support_tickets").select("id, ticket_code, requester_id").eq("ticket_code", String(req.params.ticketCode).toUpperCase()).maybeSingle();
      if (ticketErr) {
        return respondWithInternalError({
          req,
          res,
          error: ticketErr,
          context: "GET support attachment (ticket)"
        });
      }
      if (!ticket || ticket.id !== attachment.ticket_id) {
        return res.status(404).json({
          success: false,
          error: { code: "TICKET_NOT_FOUND", message: "Attachment not found." }
        });
      }
      const callerIsAdmin = req.auth.roles.includes("admin");
      if (!callerIsAdmin && ticket.requester_id !== callerId) {
        return res.status(403).json({
          success: false,
          error: { code: "FORBIDDEN_NOT_TICKET_OWNER", message: "You are not authorized to view this support ticket." }
        });
      }
      const { data: signed, error: signErr } = await admin.storage.from(SUPPORT_ATTACHMENT_BUCKET).createSignedUrl(attachment.storage_path, 300, { download: attachment.file_name });
      if (signErr || !signed?.signedUrl) {
        console.error("[Support] Failed to sign an attachment URL:", logSanitizer.safeMessage(signErr));
        return res.status(500).json({
          success: false,
          error: { code: "ATTACHMENT_UNAVAILABLE", message: "We could not open that file right now." }
        });
      }
      auditAction(req.auth, "support_attachment_viewed", {
        entityType: "support_ticket",
        entityId: ticket.ticket_code,
        requestId: req.requestId,
        metadata: { attachmentId: attachment.id }
      });
      return res.json({
        success: true,
        // Short-lived (300s) and scoped to this one object.
        url: signed.signedUrl,
        fileName: attachment.file_name,
        mimeType: attachment.mime_type,
        expiresInSeconds: 300
      });
    }
  );
  app.get("/api/notifications", requireAuth, async (req, res) => {
    try {
      const { status, type, limit } = req.query;
      const userId = req.auth.user.id;
      const admin = getSupabaseAdmin();
      if (admin) {
        let query = admin.from("notifications").select("*").eq("user_id", userId).order("created_at", { ascending: false });
        if (status === "unread") query = query.eq("is_read", false);
        else if (status === "read") query = query.eq("is_read", true);
        if (type && typeof type === "string" && type !== "ALL") {
          query = query.eq("type", type);
        }
        if (limit && !Number.isNaN(Number(limit))) {
          query = query.limit(Math.min(Number(limit), 200));
        }
        const { data, error } = await query;
        if (error) throw error;
        const { count: unreadCount } = await admin.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("is_read", false);
        return res.json({
          success: true,
          notifications: data || [],
          unreadCount: unreadCount ?? 0
        });
      }
      const db = getLocalBookingEngineContext();
      const userIds = [userId];
      let list = (db.notifications || []).filter((n) => userIds.includes(n.user_id));
      if (status === "unread") {
        list = list.filter((n) => !n.is_read);
      } else if (status === "read") {
        list = list.filter((n) => n.is_read);
      }
      if (type && typeof type === "string" && type !== "ALL") {
        list = list.filter((n) => n.type.toUpperCase() === type.toUpperCase());
      }
      list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      if (limit && !isNaN(Number(limit))) {
        list = list.slice(0, Number(limit));
      }
      const totalUnread = (db.notifications || []).filter((n) => userIds.includes(n.user_id) && !n.is_read).length;
      return res.json({
        success: true,
        notifications: list,
        unreadCount: totalUnread
      });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.get("/api/notifications/unread-count", requireAuth, async (req, res) => {
    try {
      const userId = req.auth.user.id;
      const admin = getSupabaseAdmin();
      if (admin) {
        const { count: count2, error } = await admin.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("is_read", false);
        if (error) throw error;
        return res.json({ success: true, count: count2 ?? 0 });
      }
      const db = getLocalBookingEngineContext();
      const userIds = [userId];
      const count = (db.notifications || []).filter((n) => userIds.includes(n.user_id) && !n.is_read).length;
      return res.json({ success: true, count });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.patch("/api/notifications/:id/read", requireAuth, validateBody(apiSchemas.notificationRead), async (req, res) => {
    try {
      const { id } = req.params;
      const { isRead = true } = req.body;
      const userId = req.auth.user.id;
      const admin = getSupabaseAdmin();
      if (admin) {
        const { data, error } = await admin.from("notifications").update({ is_read: !!isRead, read_at: isRead ? (/* @__PURE__ */ new Date()).toISOString() : null }).eq("id", id).eq("user_id", userId).select().maybeSingle();
        if (error) throw error;
        if (!data) {
          return res.status(404).json({
            success: false,
            error: { code: "NOT_FOUND", message: "Notification not found" }
          });
        }
        return res.json({ success: true, notification: data });
      }
      const db = getLocalBookingEngineContext();
      if (!db.notifications) db.notifications = [];
      const notif = db.notifications.find((n) => n.id === id);
      if (!notif) {
        return res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Notification not found" }
        });
      }
      if (notif.user_id !== userId && !req.auth.roles.includes("admin")) {
        return res.status(403).json({
          success: false,
          error: { code: "FORBIDDEN", message: "You can only mark your own notifications as read." }
        });
      }
      notif.is_read = !!isRead;
      notif.read_at = isRead ? (/* @__PURE__ */ new Date()).toISOString() : null;
      return res.json({ success: true, notification: notif });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.post("/api/notifications/mark-all-read", requireAuth, validateBody(apiSchemas.notificationMarkAllRead), async (req, res) => {
    try {
      const userId = req.auth.user.id;
      const admin = getSupabaseAdmin();
      if (admin) {
        const { data, error } = await admin.from("notifications").update({ is_read: true, read_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("user_id", userId).eq("is_read", false).select("id");
        if (error) throw error;
        return res.json({ success: true, updatedCount: (data || []).length });
      }
      const db = getLocalBookingEngineContext();
      if (!db.notifications) db.notifications = [];
      const userIds = [userId];
      let updatedCount = 0;
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      db.notifications.forEach((n) => {
        if (userIds.includes(n.user_id) && !n.is_read) {
          n.is_read = true;
          n.read_at = nowIso;
          updatedCount++;
        }
      });
      return res.json({ success: true, updatedCount });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.post("/api/notifications/dispatch", requireAuth, requireAdmin, validateBody(apiSchemas.notificationDispatch), async (req, res) => {
    try {
      const {
        userId: bodyUserId,
        title,
        message,
        type,
        eventType,
        entityType,
        entityId,
        link,
        metadata
      } = req.body;
      const callerId = req.auth?.user?.id;
      const isAdmin = req.auth?.roles.includes("admin") ?? false;
      if (!isAdmin && bodyUserId && bodyUserId !== callerId) {
        return res.status(403).json({
          success: false,
          error: { code: "FORBIDDEN", message: "You can only dispatch notifications for your own account." }
        });
      }
      const userId = bodyUserId || callerId;
      if (!userId) {
        return res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "userId is required" }
        });
      }
      const supabaseAdmin2 = getSupabaseAdmin();
      if (supabaseAdmin2) {
        const { data: created, error: insertErr } = await supabaseAdmin2.from("notifications").insert({
          user_id: userId,
          title,
          message,
          type,
          event_type: eventType ?? null,
          entity_type: entityType ?? null,
          entity_id: entityId ?? null,
          link: link || null,
          metadata: metadata ?? {},
          is_read: false
        }).select().single();
        if (insertErr) {
          return respondWithServerError({
            req,
            res,
            error: insertErr,
            context: "POST /api/notifications/dispatch",
            clientMessage: "The notification could not be stored."
          });
        }
        return res.status(201).json({ success: true, notification: created });
      }
      const db = getLocalBookingEngineContext();
      if (!db.notifications) db.notifications = [];
      const newNotif = {
        id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        user_id: userId,
        title,
        message,
        type,
        event_type: eventType,
        entity_type: entityType,
        entity_id: entityId,
        link: link || null,
        is_read: false,
        created_at: (/* @__PURE__ */ new Date()).toISOString(),
        metadata
      };
      db.notifications.unshift(newNotif);
      return res.status(201).json({ success: true, notification: newNotif });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.get("/api/sessions/:bookingId/access", requireAuth, async (req, res) => {
    try {
      const { bookingId } = req.params;
      const userId = req.auth.user.id;
      const currentUtcTime = /* @__PURE__ */ new Date();
      const admin = getSupabaseAdmin();
      if (admin) {
        await reconcileBookingSessionState(admin, bookingId);
      }
      const db = admin ? await (async () => {
        const loaded = await loadAuthoritativeSessionBooking(
          admin,
          bookingId,
          userId
        );
        if (!loaded.booking) return null;
        return buildSessionEngineContext(loaded.engineBooking, userId, loaded.callerIsAdmin);
      })() : getLocalBookingEngineContext();
      if (!db) {
        return res.status(404).json({
          success: false,
          canJoin: false,
          meetingUrl: null,
          error: { code: "BOOKING_NOT_FOUND", message: "Booking not found." }
        });
      }
      const accessResult = validateSessionAccess(
        {
          bookingId,
          userId,
          currentUtcTime
        },
        db
      );
      if (accessResult.success && admin && db.bookings[0]) {
        const persisted = await persistNaturalSessionCompletion(admin, db.bookings[0], currentUtcTime.toISOString());
        if (persisted) {
          logSessionEvent("SESSION_AUTO_COMPLETED", {
            bookingId,
            reason: "end_time_elapsed",
            serverNow: currentUtcTime.toISOString(),
            endTime: db.bookings[0].end_time
          });
        }
      }
      logSessionEvent("SESSION_STATE_RESOLVED", {
        bookingId,
        state: accessResult.sessionState,
        accessState: accessResult.accessState,
        canJoin: accessResult.canJoin,
        bookingStatus: accessResult.bookingStatus,
        serverNow: currentUtcTime.toISOString(),
        startTime: accessResult.startTime,
        endTime: accessResult.endTime
      });
      if (!accessResult.canJoin && accessResult.error) {
        logSessionEvent("SESSION_ACCESS_DENIED", {
          bookingId,
          reason: accessResult.error.code,
          state: accessResult.sessionState,
          serverNow: currentUtcTime.toISOString(),
          endTime: accessResult.endTime
        });
      }
      if (!accessResult.success) {
        const code = accessResult.error?.code;
        if (code === "FORBIDDEN_NOT_PARTICIPANT" || code === "BOOKING_NOT_FOUND") {
          return res.status(404).json({
            success: false,
            canJoin: false,
            accessState: "BEFORE_T5",
            meetingUrl: null,
            currentServerTime: currentUtcTime.toISOString(),
            message: "Booking not found.",
            error: { code: "BOOKING_NOT_FOUND", message: "Booking not found." }
          });
        }
        return res.status(400).json(accessResult);
      }
      return res.json(accessResult);
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.post("/api/sessions/:bookingId/join", requireAuth, validateBody(apiSchemas.sessionJoin), async (req, res) => {
    try {
      const { bookingId } = req.params;
      const userId = req.auth.user.id;
      const currentUtcTime = /* @__PURE__ */ new Date();
      const supabase2 = getSupabaseAdmin();
      if (supabase2) {
        await reconcileBookingSessionState(supabase2, bookingId);
      }
      const db = supabase2 ? await (async () => {
        const loaded = await loadAuthoritativeSessionBooking(supabase2, bookingId, userId);
        if (!loaded.booking) return null;
        return buildSessionEngineContext(loaded.engineBooking, userId, loaded.callerIsAdmin);
      })() : getLocalBookingEngineContext();
      if (!db) {
        return res.status(404).json({
          success: false,
          canJoin: false,
          accessState: "COMPLETED",
          error: { code: "BOOKING_NOT_FOUND", message: "Booking not found." }
        });
      }
      const joinResult = joinSessionAuthoritative(
        {
          bookingId,
          userId,
          currentUtcTime
        },
        db
      );
      if (supabase2 && db.bookings[0]) {
        const persisted = await persistNaturalSessionCompletion(supabase2, db.bookings[0], currentUtcTime.toISOString());
        if (persisted) {
          logSessionEvent("SESSION_AUTO_COMPLETED", {
            bookingId,
            reason: "end_time_elapsed",
            serverNow: currentUtcTime.toISOString(),
            endTime: db.bookings[0].end_time
          });
        }
      }
      if (!joinResult.canJoin) {
        const code = joinResult.error?.code;
        logSessionEvent("SESSION_ACCESS_DENIED", {
          bookingId,
          reason: code,
          state: joinResult.accessState,
          serverNow: currentUtcTime.toISOString(),
          endTime: db.bookings[0]?.end_time
        });
        if (code === "TOO_EARLY") {
          return res.status(403).json({
            success: false,
            canJoin: false,
            accessState: joinResult.accessState,
            error: {
              code: "TOO_EARLY",
              message: "Session join is locked. It unlocks 5 minutes prior to session start."
            }
          });
        }
        if (code === "SESSION_ENDED") {
          return res.status(403).json({
            success: false,
            canJoin: false,
            accessState: joinResult.accessState,
            error: {
              code: "SESSION_ENDED",
              message: "Session has concluded. Join access is closed."
            }
          });
        }
        if (code === "FORBIDDEN_NOT_PARTICIPANT" || code === "BOOKING_NOT_FOUND") {
          return res.status(404).json({
            success: false,
            canJoin: false,
            error: { code: "BOOKING_NOT_FOUND", message: "Booking not found." }
          });
        }
        return res.status(400).json(joinResult);
      }
      logSessionEvent("SESSION_ACCESS_GRANTED", {
        bookingId,
        accessState: joinResult.accessState,
        serverNow: currentUtcTime.toISOString(),
        startTime: db.bookings[0]?.start_time,
        endTime: db.bookings[0]?.end_time
      });
      return res.json({
        success: true,
        canJoin: true,
        accessState: joinResult.accessState,
        meetingUrl: joinResult.meetingUrl,
        bookingCode: joinResult.bookingCode,
        message: "Join authorized. Proceeding to meeting."
      });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.post("/api/sessions/:bookingId/complete", requireAuth, async (req, res) => {
    try {
      const { bookingId } = req.params;
      const userId = req.auth.user.id;
      const isAdmin = req.auth.roles.includes("admin");
      const isMentor = req.auth.roles.includes("mentor");
      const isSeeker = req.auth.roles.includes("seeker");
      const parsedBody = parseBody(req, res, apiSchemas.sessionComplete);
      if (parsedBody === null) return;
      const endReason = parsedBody.endReason ?? null;
      const supabase2 = getSupabaseAdmin();
      if (!supabase2) {
        return res.status(503).json({
          success: false,
          error: { code: "SERVICE_UNAVAILABLE", message: "Session service is not configured." }
        });
      }
      const loaded = await loadAuthoritativeSessionBooking(supabase2, bookingId, userId);
      if (!loaded.booking) {
        return res.status(404).json({
          success: false,
          error: { code: "BOOKING_NOT_FOUND", message: "Booking not found." }
        });
      }
      const booking = loaded.booking;
      const isBookingMentor = booking.mentor_id === userId;
      const isBookingSeeker = booking.seeker_id === userId;
      if (!isAdmin && !isBookingMentor && !isBookingSeeker) {
        return res.status(404).json({
          success: false,
          error: { code: "BOOKING_NOT_FOUND", message: "Booking not found." }
        });
      }
      const endedByRole = isAdmin ? "admin" : isBookingMentor ? "mentor" : "seeker";
      if (booking.status === "COMPLETED") {
        return res.json({
          success: true,
          booking: { id: booking.id, booking_code: booking.booking_code, status: "COMPLETED" },
          message: "Booking is already COMPLETED."
        });
      }
      if (booking.status !== "CONFIRMED") {
        return res.status(409).json({
          success: false,
          error: {
            code: "BOOKING_NOT_COMPLETABLE",
            message: `A booking that is ${String(booking.status).replace(/_/g, " ").toLowerCase()} cannot be completed.`
          }
        });
      }
      const nowMs = Date.now();
      const startMs = new Date(booking.start_time).getTime();
      if (Number.isFinite(startMs) && nowMs < startMs) {
        return res.status(409).json({
          success: false,
          error: {
            code: "SESSION_NOT_STARTED",
            message: "This session has not started yet, so it cannot be marked complete."
          }
        });
      }
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      const { data: updated, error: updateErr } = await supabase2.from("bookings").update({
        status: "COMPLETED",
        actual_ended_at: nowIso,
        ended_by_role: endedByRole,
        end_reason: endReason,
        updated_at: nowIso
      }).eq("id", booking.id).eq("status", "CONFIRMED").select("id, booking_code, status, updated_at, ended_by_role, actual_ended_at").maybeSingle();
      if (updateErr) throw updateErr;
      if (!updated) {
        return res.status(409).json({
          success: false,
          error: { code: "BOOKING_STATE_CHANGED", message: "The booking changed state and was not completed." }
        });
      }
      const counterpartyId = endedByRole === "mentor" ? booking.seeker_id : booking.mentor_id;
      const counterpartyLabel = endedByRole === "mentor" ? "Seeker" : "Mentor";
      const endedByLabel = endedByRole === "mentor" ? "Your mentor" : "You";
      await supabase2.from("notifications").insert({
        user_id: counterpartyId,
        title: "Session Ended",
        message: `${endedByLabel} has ended session ${booking.booking_code}. The meeting link has been deactivated.`,
        type: "SESSION",
        event_type: "SESSION_COMPLETED",
        entity_type: "booking",
        entity_id: booking.id,
        link: `/seeker/bookings?bookingId=${booking.id}`,
        is_read: false,
        created_at: nowIso
      });
      auditAction(req.auth, "session_completed", {
        entityType: "booking",
        entityId: booking.id,
        requestId: req.requestId,
        metadata: {
          bookingCode: booking.booking_code,
          endedByRole,
          endReason: endReason ?? null
        }
      });
      return res.json({
        success: true,
        booking: {
          id: updated.id,
          booking_code: updated.booking_code,
          status: updated.status,
          ended_by_role: updated.ended_by_role,
          actual_ended_at: updated.actual_ended_at
        },
        endedByRole,
        message: "Booking marked as COMPLETED."
      });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.get("/api/workspaces/booking/:bookingId", requireAuth, async (req, res) => {
    try {
      const { bookingId } = req.params;
      const userId = req.auth.user.id;
      const roles = req.auth.roles;
      const isMentor = roles.includes("mentor");
      const isAdmin = roles.includes("admin");
      const isSeeker = roles.includes("seeker");
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: booking, error: bookingErr } = await admin.from("bookings").select(`
          *,
          seeker:profiles!bookings_seeker_id_fkey(id, full_name, email, timezone),
          mentor:profiles!bookings_mentor_id_fkey(id, full_name, email, timezone),
          gig:gigs(id, title, segment_id),
          segment:segments(id, name, slug)
        `).or(`id.eq.${bookingId},booking_code.eq.${bookingId}`).maybeSingle();
      if (bookingErr) throw bookingErr;
      if (!booking) {
        return res.status(404).json({
          success: false,
          error: { code: "BOOKING_NOT_FOUND", message: "Booking not found." }
        });
      }
      if (!isAdmin && booking.seeker_id !== userId && booking.mentor_id !== userId) {
        return res.status(403).json({
          success: false,
          error: { code: "FORBIDDEN", message: "Unauthorized access to session workspace." }
        });
      }
      const { data: ws, error: wsErr } = await admin.from("session_workspaces").select("*").eq("booking_id", booking.id).maybeSingle();
      if (wsErr) throw wsErr;
      const overview = deriveSessionOverview(booking);
      if (!ws) {
        return res.json({
          success: true,
          workspace: null,
          isPending: true,
          session_overview: overview,
          message: "No workspace record exists for this booking yet."
        });
      }
      if (!isWorkspaceVisibleToSeeker(ws, roles)) {
        return res.json({
          success: true,
          workspace: null,
          isPending: true,
          session_overview: overview,
          message: "Mentor notes are currently being prepared and not yet published."
        });
      }
      return res.json({
        success: true,
        workspace: {
          ...ws,
          session_overview: overview
        }
      });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err, context: "GET /api/workspaces/booking/:bookingId" });
    }
  });
  app.post("/api/workspaces", requireAuth, validateBody(apiSchemas.workspace), async (req, res) => {
    try {
      const {
        bookingId,
        mentorNotes,
        takeaways,
        suggestions,
        nextSteps,
        next_steps,
        followUpRecommendation,
        publish
      } = req.body;
      const steps = nextSteps ?? next_steps ?? [];
      const input = {
        mentorNotes,
        takeaways,
        suggestions,
        nextSteps: steps,
        followUpRecommendation,
        publish
      };
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: booking, error: bookingErr } = await admin.from("bookings").select("id, booking_code, mentor_id, seeker_id, start_time, end_time, status").or(`id.eq.${bookingId},booking_code.eq.${bookingId}`).maybeSingle();
      if (bookingErr) throw bookingErr;
      if (!booking) {
        return res.status(404).json({
          success: false,
          error: { code: "BOOKING_NOT_FOUND", message: "Booking does not exist." }
        });
      }
      const result = await saveWorkspace({
        store: createSupabaseWorkspaceStore(admin),
        booking: {
          id: booking.id,
          booking_code: booking.booking_code,
          mentor_id: booking.mentor_id,
          seeker_id: booking.seeker_id
        },
        input,
        callerId: req.auth.user.id,
        roles: req.auth.roles,
        nowIso: (/* @__PURE__ */ new Date()).toISOString(),
        newId: (0, import_crypto5.randomUUID)()
      });
      if (!result.ok) {
        const status = result.reason === "BOOKING_NOT_FOUND" ? 404 : result.reason === "PARTICIPANT_MISMATCH" ? 409 : 403;
        const message = result.reason === "BOOKING_NOT_FOUND" ? "Booking does not exist." : result.reason === "PARTICIPANT_MISMATCH" ? "This workspace record is linked to different participants than the booking. It has not been changed, and it needs to be repaired before it can be published." : "Only the assigned mentor or an administrator can create or update this workspace.";
        return res.status(status).json({
          success: false,
          error: {
            code: result.reason,
            message
          }
        });
      }
      const overview = deriveSessionOverview(booking);
      return res.status(200).json({
        success: true,
        workspace: {
          ...result.workspace,
          session_overview: overview
        },
        message: publish ? "Workspace published to seeker successfully." : "Workspace saved as draft."
      });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err, context: "POST /api/workspaces" });
    }
  });
  app.get("/api/admin/workspaces", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: workspaces, error: wsErr } = await admin.from("session_workspaces").select(`
          *,
          booking:bookings (
            id,
            booking_code,
            status,
            start_time,
            end_time,
            amount_inr,
            seeker_id,
            mentor_id,
            gig_id,
            segment_id,
            seeker:profiles!bookings_seeker_id_fkey(id, full_name, email, timezone),
            mentor:profiles!bookings_mentor_id_fkey(id, full_name, email, timezone),
            gig:gigs(id, title, segment_id),
            segment:segments(id, name, slug)
          )
        `).order("updated_at", { ascending: false });
      if (wsErr) throw wsErr;
      const enriched = (workspaces || []).map((ws) => {
        const booking = ws.booking;
        const overview = booking ? deriveSessionOverview(booking) : void 0;
        return {
          ...ws,
          session_overview: overview
        };
      });
      return res.json({
        success: true,
        workspaces: enriched
      });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.get("/api/mentor/onboarding-status", requireAuth, requireRole("mentor"), async (req, res) => {
    try {
      const userId = req.auth.user.id;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: application, error: appErr } = await admin.from("mentor_applications").select("*").eq("user_id", userId).maybeSingle();
      if (appErr) throw appErr;
      const { data: documents, error: docsErr } = application ? await admin.from("mentor_verification_documents").select("*").eq("application_id", application.id) : { data: [], error: null };
      if (docsErr) throw docsErr;
      const [{ data: mentorProfile, error: mentorProfileErr }, { data: mentorSegments, error: mentorSegmentsErr }] = await Promise.all([
        admin.from("mentor_profiles").select("*").eq("id", userId).maybeSingle(),
        admin.from("mentor_segments").select("segment_id, segment:segments(id, name, slug, description)").eq("mentor_id", userId)
      ]);
      if (mentorProfileErr) throw mentorProfileErr;
      if (mentorSegmentsErr) throw mentorSegmentsErr;
      const { data: documentTypes, error: dtErr } = await admin.from("mentor_document_types").select("*").eq("is_active", true).order("sort_order");
      if (dtErr) throw dtErr;
      const { data: auditLog, error: auditErr } = application ? await admin.from("mentor_application_audit").select(MENTOR_APPLICATION_AUDIT_SELECT).eq("application_id", application.id).order("created_at", { ascending: false }) : { data: [], error: null };
      if (auditErr) throw auditErr;
      const requiredDocumentTypes = (documentTypes || []).filter((documentType) => documentType.is_required).map((documentType) => documentType.code);
      const approvedDocTypes = new Set((documents || []).filter((d) => d.status === "approved").map((d) => d.document_type));
      return res.json({
        success: true,
        onboarding: {
          application: application || null,
          documents: documents || [],
          documentTypes: documentTypes || [],
          mentorProfile: mentorProfile || null,
          segments: mentorSegments || [],
          auditLog: auditLog || [],
          allRequiredDocsApproved: application ? application.status === "approved" && requiredDocumentTypes.every((t) => approvedDocTypes.has(t)) : false
        }
      });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.post("/api/mentor/application/draft", requireAuth, requireRole("mentor"), validateBody(apiSchemas.mentorApplicationDraft), async (req, res) => {
    try {
      const userId = req.auth.user.id;
      const { fullName, bio, timezone, headline, experienceYears, segmentIds } = req.body;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: existing } = await admin.from("mentor_applications").select("id, status").eq("user_id", userId).maybeSingle();
      let application;
      if (existing) {
        if (existing.status !== "draft" && existing.status !== "rejected") {
          return res.status(409).json({ success: false, error: { code: "CONFLICT", message: "Application cannot be edited in current status." } });
        }
        const { data, error } = await admin.from("mentor_applications").update({
          full_name: fullName.trim(),
          bio: bio || "",
          timezone: timezone || "Asia/Kolkata",
          updated_at: (/* @__PURE__ */ new Date()).toISOString()
        }).eq("user_id", userId).select().single();
        if (error) throw error;
        application = data;
      } else {
        const { data, error } = await admin.from("mentor_applications").insert({
          user_id: userId,
          full_name: fullName.trim(),
          bio: bio || "",
          timezone: timezone || "Asia/Kolkata",
          status: "draft"
        }).select().single();
        if (error) throw error;
        application = data;
      }
      const { error: mentorProfileErr } = await admin.from("mentor_profiles").upsert({
        id: userId,
        headline: typeof headline === "string" ? headline.trim() : "",
        about: typeof bio === "string" ? bio.trim() : "",
        experience_years: Number.isInteger(experienceYears) ? experienceYears : 0,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      }, { onConflict: "id" });
      if (mentorProfileErr) throw mentorProfileErr;
      if (Array.isArray(segmentIds)) {
        const validSegmentIds = segmentIds.filter((segmentId) => typeof segmentId === "string" && segmentId.length > 0);
        if (validSegmentIds.length > 0) {
          const { data: activeSegments, error: segmentErr } = await admin.from("segments").select("id").in("id", validSegmentIds).eq("is_active", true);
          if (segmentErr) throw segmentErr;
          const memberships = (activeSegments || []).map((segment) => ({ mentor_id: userId, segment_id: segment.id }));
          if (memberships.length > 0) {
            const { error: membershipErr } = await admin.from("mentor_segments").upsert(memberships, { onConflict: "mentor_id,segment_id", ignoreDuplicates: true });
            if (membershipErr) throw membershipErr;
          }
        }
      }
      await admin.from("mentor_application_audit").insert({
        application_id: application.id,
        action: "created",
        admin_user_id: null,
        metadata: { full_name: fullName.trim() }
      });
      return res.json({ success: true, application });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.post("/api/mentor/application/submit", requireAuth, requireRole("mentor"), async (req, res) => {
    try {
      const userId = req.auth.user.id;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: application, error: appErr } = await admin.from("mentor_applications").select("*").eq("user_id", userId).maybeSingle();
      if (appErr) throw appErr;
      if (!application) {
        return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "No mentor application found." } });
      }
      if (application.status !== "draft" && application.status !== "rejected") {
        return res.status(409).json({ success: false, error: { code: "CONFLICT", message: "Application cannot be submitted from current status." } });
      }
      const { data: requiredDocumentTypes, error: requiredTypesErr } = await admin.from("mentor_document_types").select("code").eq("is_active", true).eq("is_required", true);
      if (requiredTypesErr) throw requiredTypesErr;
      const { data: mentorSegments, error: mentorSegmentsErr } = await admin.from("mentor_segments").select("segment_id").eq("mentor_id", userId);
      if (mentorSegmentsErr) throw mentorSegmentsErr;
      const { data: mentorProfile, error: mentorProfileErr } = await admin.from("mentor_profiles").select("about, headline, experience_years").eq("id", userId).maybeSingle();
      if (mentorProfileErr) throw mentorProfileErr;
      const missingProfileFields = [];
      if (!application.bio || application.bio.trim().length < MIN_MENTOR_BIO_LENGTH) missingProfileFields.push("Mentor bio");
      if (!mentorProfile?.headline || !mentorProfile.headline.trim()) missingProfileFields.push("Professional headline");
      if (!mentorSegments || mentorSegments.length === 0) missingProfileFields.push("At least one mentorship segment");
      if (missingProfileFields.length > 0) {
        return res.status(400).json({ success: false, error: { code: "INCOMPLETE_APPLICATION", message: `Complete the following before submitting: ${missingProfileFields.join(", ")}.` } });
      }
      const { data: docs, error: docsErr } = await admin.from("mentor_verification_documents").select("document_type, status").eq("application_id", application.id);
      if (docsErr) throw docsErr;
      const uploadedDocTypes = new Set((docs || []).filter((d) => d.status === "pending" || d.status === "approved").map((d) => d.document_type));
      const missingTypes = (requiredDocumentTypes || []).map((documentType) => documentType.code).filter((type) => !uploadedDocTypes.has(type));
      if (missingTypes.length > 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: "MISSING_REQUIRED_DOCUMENTS",
            message: `Missing required documents: ${missingTypes.join(", ")}`
          }
        });
      }
      const { data: updatedApp, error: updErr } = await admin.from("mentor_applications").update({
        status: "pending_review",
        submitted_at: (/* @__PURE__ */ new Date()).toISOString(),
        rejection_reason: null,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      }).eq("user_id", userId).select().single();
      if (updErr) throw updErr;
      await admin.from("mentor_application_audit").insert({
        application_id: updatedApp.id,
        action: "submitted",
        admin_user_id: null,
        metadata: { previous_status: application.status }
      });
      try {
        const adminIds = await resolveActiveAdminIds(admin);
        await insertPaymentNotifications(admin, {
          userIds: adminIds,
          title: "New Mentor Verification Submitted",
          message: `A new mentor application from ${updatedApp.full_name} requires review.`,
          type: "ADMIN",
          eventType: "ADMIN_MENTOR_APPLICATION_SUBMITTED",
          entityType: "mentor_application",
          entityId: updatedApp.id,
          link: `/admin/mentor-verification/${updatedApp.id}`,
          metadata: {}
        });
      } catch (adminNotifErr) {
        console.error("Failed to create admin notification:", logSanitizer.safeMessage(adminNotifErr));
      }
      return res.json({ success: true, application: updatedApp });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.post("/api/mentor/document", requireAuth, requireRole("mentor"), validateBody(apiSchemas.mentorDocument), async (req, res) => {
    try {
      const userId = req.auth.user.id;
      const { applicationId, documentType, storagePath, originalFilename, mimeType, sizeBytes } = req.body;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: application, error: appErr } = await admin.from("mentor_applications").select("user_id, status").eq("id", applicationId).eq("user_id", userId).maybeSingle();
      if (appErr) throw appErr;
      if (!application) {
        return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Application not found." } });
      }
      if (!storagePath.startsWith(`${userId}/${applicationId}/`)) {
        return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Document storage path is not owned by the current user." } });
      }
      if (application.status !== "draft" && application.status !== "rejected") {
        return res.status(409).json({ success: false, error: { code: "CONFLICT", message: "Documents can only be uploaded for draft or rejected applications." } });
      }
      const { data: docType, error: dtErr } = await admin.from("mentor_document_types").select("code").eq("code", documentType).eq("is_active", true).maybeSingle();
      if (dtErr) throw dtErr;
      if (!docType) {
        return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid document type." } });
      }
      const { data: document, error: docErr } = await admin.from("mentor_verification_documents").upsert({
        application_id: applicationId,
        document_type: documentType,
        storage_path: storagePath,
        original_filename: originalFilename,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        status: "pending",
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      }, {
        onConflict: "application_id,document_type"
      }).select().single();
      if (docErr) throw docErr;
      await admin.from("mentor_application_audit").insert({
        application_id: applicationId,
        action: "document_uploaded",
        admin_user_id: null,
        metadata: { document_type: documentType, document_id: document.id }
      });
      return res.json({ success: true, document });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.delete("/api/mentor/document/:id", requireAuth, requireRole("mentor"), async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      const userId = req.auth.user.id;
      const { data: document, error: documentErr } = await admin.from("mentor_verification_documents").select("id, storage_path, application_id, mentor_applications!inner(user_id, status)").eq("id", req.params.id).maybeSingle();
      if (documentErr) throw documentErr;
      const ownerApplication = Array.isArray(document?.mentor_applications) ? document.mentor_applications[0] : document?.mentor_applications;
      if (!document || ownerApplication?.user_id !== userId) {
        return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Document not found." } });
      }
      if (ownerApplication.status !== "draft" && ownerApplication.status !== "rejected") {
        return res.status(409).json({ success: false, error: { code: "CONFLICT", message: "Documents cannot be changed after submission." } });
      }
      const { error: storageErr } = await admin.storage.from("mentor-verification-documents").remove([document.storage_path]);
      if (storageErr) throw storageErr;
      const { error: deleteErr } = await admin.from("mentor_verification_documents").delete().eq("id", document.id);
      if (deleteErr) throw deleteErr;
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: "Unable to remove verification document." } });
    }
  });
  app.get("/api/admin/mentor-applications", requireAuth, requireAdmin, async (req, res) => {
    const admin = getSupabaseAdmin();
    if (!admin) {
      return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
    }
    const { status, search, page, pageSize, from, to } = parseMentorApplicationListQuery(
      req.query
    );
    try {
      let applicantIds = null;
      if (search) {
        const { data: matchedProfiles, error: searchErr } = await admin.from("profiles").select("id").or(buildProfileSearchFilter(search)).limit(MENTOR_APPLICATION_SEARCH_MATCH_LIMIT);
        if (searchErr) throw searchErr;
        applicantIds = (matchedProfiles ?? []).map((profile) => profile.id);
        if (applicantIds.length === 0) {
          return res.json({
            success: true,
            applications: [],
            counts: emptyMentorApplicationStatusCounts(),
            pagination: buildMentorApplicationPagination(page, pageSize, 0)
          });
        }
      }
      const countApplications = async (statusFilter) => {
        let countQuery = admin.from("mentor_applications").select("id", { count: "exact", head: true });
        if (statusFilter !== "ALL") countQuery = countQuery.eq("status", statusFilter);
        if (applicantIds) countQuery = countQuery.in("user_id", applicantIds);
        const { count, error } = await countQuery;
        if (error) throw error;
        return count ?? 0;
      };
      let listQuery = admin.from("mentor_applications").select(MENTOR_APPLICATION_LIST_SELECT, { count: "exact" }).order("created_at", { ascending: false }).range(from, to);
      if (status !== "ALL") listQuery = listQuery.eq("status", status);
      if (applicantIds) listQuery = listQuery.in("user_id", applicantIds);
      const [listResult, countEntries] = await Promise.all([
        listQuery,
        Promise.all(
          MENTOR_APPLICATION_STATUS_COUNT_BUCKETS.map(
            async (statusFilter) => [statusFilter, await countApplications(statusFilter)]
          )
        )
      ]);
      if (listResult.error) throw listResult.error;
      const counts = emptyMentorApplicationStatusCounts();
      for (const [statusFilter, value] of countEntries) {
        if (statusFilter === "ALL") counts.all = value;
        else counts[statusFilter] = value;
      }
      const rows = listResult.data ?? [];
      const applicationIds = rows.map((row) => row.id);
      const applicantIdsForProfiles = [...new Set(rows.map((row) => row.user_id).filter(Boolean))];
      const { data: applicantProfiles, error: applicantProfilesErr } = applicantIdsForProfiles.length > 0 ? await admin.from("profiles").select("id, full_name, email, avatar_url").in("id", applicantIdsForProfiles) : { data: [], error: null };
      if (applicantProfilesErr) throw applicantProfilesErr;
      const applicantProfileMap = new Map((applicantProfiles || []).map((profile) => [profile.id, profile]));
      let auditLog = [];
      if (applicationIds.length > 0) {
        const { data: audits, error: auditErr } = await admin.from("mentor_application_audit").select("*").in("application_id", applicationIds).order("created_at", { ascending: false });
        if (auditErr) throw auditErr;
        auditLog = audits ?? [];
      }
      const auditMap = /* @__PURE__ */ new Map();
      for (const entry of auditLog) {
        const existing = auditMap.get(entry.application_id);
        if (existing) existing.push(entry);
        else auditMap.set(entry.application_id, [entry]);
      }
      const applications = rows.map((row) => ({
        ...row,
        profile: applicantProfileMap.get(row.user_id) || null,
        auditLog: auditMap.get(row.id) ?? []
      }));
      return res.json({
        success: true,
        applications,
        counts,
        pagination: buildMentorApplicationPagination(page, pageSize, listResult.count ?? applications.length)
      });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "GET /api/admin/mentor-applications",
        clientMessage: "Unable to load mentor applications."
      });
    }
  });
  app.get("/api/admin/mentor-applications/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: applicationData, error: appErr } = await admin.from("mentor_applications").select(MENTOR_APPLICATION_DETAIL_SELECT).eq("id", id).maybeSingle();
      if (appErr) throw appErr;
      const rawApplication = applicationData ?? null;
      const application = rawApplication ? {
        ...rawApplication,
        profile: (await admin.from("profiles").select("id, full_name, email, avatar_url, timezone, created_at").eq("id", rawApplication.user_id).maybeSingle()).data || null
      } : null;
      if (!application) {
        return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Application not found." } });
      }
      const { data: documentRows, error: docsErr } = await admin.from("mentor_verification_documents").select(`
          *,
          document_type_ref:mentor_document_types!inner(code, label, description, is_required)
        `).eq("application_id", id).order("uploaded_at", { ascending: false });
      if (docsErr) throw docsErr;
      const { data: auditRows, error: auditErr } = await admin.from("mentor_application_audit").select(MENTOR_APPLICATION_AUDIT_SELECT).eq("application_id", id).order("created_at", { ascending: false });
      if (auditErr) throw auditErr;
      const documents = await Promise.all((documentRows ?? []).map(async (doc) => {
        const { data: signed, error: signedErr } = await admin.storage.from("mentor-verification-documents").createSignedUrl(doc.storage_path, 300);
        if (signedErr) throw signedErr;
        return { ...doc, download_url: signed?.signedUrl || null };
      }));
      const auditLog = auditRows ?? [];
      return res.json({
        success: true,
        application: {
          ...application,
          documents,
          auditLog
        }
      });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "GET /api/admin/mentor-applications/:id",
        clientMessage: "Unable to load mentor application."
      });
    }
  });
  app.post("/api/admin/mentor-applications/:id/approve", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const adminUserId = req.auth.user.id;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: application, error: appErr } = await admin.from("mentor_applications").select("*").eq("id", id).maybeSingle();
      if (appErr) throw appErr;
      if (!application) {
        return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Application not found." } });
      }
      if (application.status !== "pending_review") {
        return res.status(409).json({ success: false, error: { code: "CONFLICT", message: `Application is not pending review (current: ${application.status}).` } });
      }
      const { data: docs, error: docsErr } = await admin.from("mentor_verification_documents").select("document_type, status").eq("application_id", id);
      if (docsErr) throw docsErr;
      const { data: requiredDocumentTypes, error: requiredTypesErr } = await admin.from("mentor_document_types").select("code").eq("is_active", true).eq("is_required", true);
      if (requiredTypesErr) throw requiredTypesErr;
      const approvedDocTypes = new Set((docs || []).filter((d) => d.status === "approved").map((d) => d.document_type));
      const missingApproved = (requiredDocumentTypes || []).map((documentType) => documentType.code).filter((type) => !approvedDocTypes.has(type));
      if (missingApproved.length > 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: "MISSING_APPROVED_DOCUMENTS",
            message: `All required documents must be approved before mentor approval: ${missingApproved.join(", ")}`
          }
        });
      }
      await admin.rpc("approve_mentor_application", { p_application_id: id });
      const { error: updErr } = await admin.from("mentor_applications").update({
        status: "approved",
        reviewed_at: (/* @__PURE__ */ new Date()).toISOString(),
        reviewed_by: adminUserId,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      }).eq("id", id);
      if (updErr) throw updErr;
      await admin.from("mentor_application_audit").insert({
        application_id: id,
        action: "approved",
        admin_user_id: adminUserId,
        metadata: { approved_by: adminUserId }
      });
      const { error: roleErr } = await admin.from("user_roles").upsert({
        user_id: application.user_id,
        role: "mentor"
      });
      if (roleErr) throw roleErr;
      const { error: mpErr } = await admin.from("mentor_profiles").upsert({
        id: application.user_id,
        headline: application.bio || "",
        about: application.bio || "",
        experience_years: 0,
        languages: [],
        rating: 0,
        review_count: 0,
        session_count: 0,
        is_approved: true,
        is_featured: false,
        approval_status: "approved",
        is_active: true,
        created_at: (/* @__PURE__ */ new Date()).toISOString(),
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      });
      if (mpErr) throw mpErr;
      await admin.from("notifications").insert({
        user_id: application.user_id,
        title: "Mentor Application Approved",
        message: "Congratulations! Your mentor application has been approved. You can now complete your mentor profile and configure your availability.",
        type: "SYSTEM",
        event_type: "MENTOR_APPLICATION_APPROVED",
        entity_type: "mentor_application",
        entity_id: id,
        link: "/mentor",
        is_read: false
      });
      auditAction(req.auth, "mentor_application_approved", {
        entityType: "mentor_application",
        entityId: id,
        requestId: req.requestId,
        metadata: { approvedByUserId: adminUserId, applicantUserId: application.user_id }
      });
      return res.json({ success: true, message: "Mentor application approved successfully." });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "POST /api/admin/mentor-applications/:id/approve",
        clientMessage: "Unable to approve mentor application."
      });
    }
  });
  app.post("/api/admin/mentor-applications/:id/reject", requireAuth, requireAdmin, validateBody(apiSchemas.mentorApplicationReject), async (req, res) => {
    try {
      const { id } = req.params;
      const { rejectionReason } = req.body;
      const adminUserId = req.auth.user.id;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: application, error: appErr } = await admin.from("mentor_applications").select("*").eq("id", id).maybeSingle();
      if (appErr) throw appErr;
      if (!application) {
        return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Application not found." } });
      }
      if (application.status !== "pending_review") {
        return res.status(409).json({ success: false, error: { code: "CONFLICT", message: `Application is not pending review (current: ${application.status}).` } });
      }
      const { error: updErr } = await admin.from("mentor_applications").update({
        status: "rejected",
        reviewed_at: (/* @__PURE__ */ new Date()).toISOString(),
        reviewed_by: adminUserId,
        rejection_reason: rejectionReason.trim(),
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      }).eq("id", id);
      if (updErr) throw updErr;
      await admin.from("mentor_application_audit").insert({
        application_id: id,
        action: "rejected",
        admin_user_id: adminUserId,
        rejection_reason: rejectionReason.trim(),
        metadata: { rejected_by: adminUserId }
      });
      await admin.from("notifications").insert({
        user_id: application.user_id,
        title: "Mentor Application Needs Changes",
        message: `Your mentor application needs changes: ${rejectionReason.trim()}. Please review the Admin feedback and resubmit your verification.`,
        type: "SYSTEM",
        event_type: "MENTOR_APPLICATION_REJECTED",
        entity_type: "mentor_application",
        entity_id: id,
        link: "/mentor/verification",
        is_read: false
      });
      auditAction(req.auth, "mentor_application_rejected", {
        entityType: "mentor_application",
        entityId: id,
        requestId: req.requestId,
        metadata: { rejectedByUserId: adminUserId, applicantUserId: application.user_id, rejectionReason }
      });
      return res.json({ success: true, message: "Mentor application rejected successfully." });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "POST /api/admin/mentor-applications/:id/reject",
        clientMessage: "Unable to reject mentor application."
      });
    }
  });
  app.patch("/api/admin/mentor-documents/:id/review", requireAuth, requireAdmin, validateBody(apiSchemas.mentorDocumentReview), async (req, res) => {
    try {
      const { id } = req.params;
      const { status, adminNote } = req.body;
      const adminUserId = req.auth.user.id;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: document, error: docErr } = await admin.from("mentor_verification_documents").select("*, application:mentor_applications!inner(id, user_id, full_name)").eq("id", id).maybeSingle();
      if (docErr) throw docErr;
      if (!document) {
        return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Document not found." } });
      }
      const { data: updatedDoc, error: updErr } = await admin.from("mentor_verification_documents").update({
        status,
        reviewed_at: (/* @__PURE__ */ new Date()).toISOString(),
        reviewed_by: adminUserId,
        admin_note: adminNote || null,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      }).eq("id", id).select().single();
      if (updErr) throw updErr;
      await admin.from("mentor_application_audit").insert({
        application_id: document.application.id,
        action: "document_reviewed",
        admin_user_id: adminUserId,
        metadata: { document_id: id, document_type: document.document_type, status }
      });
      auditAction(req.auth, "mentor_document_reviewed", {
        entityType: "mentor_verification_document",
        entityId: id,
        requestId: req.requestId,
        metadata: { documentType: document.document_type, status, adminNote }
      });
      return res.json({ success: true, document: updatedDoc });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "PATCH /api/admin/mentor-documents/:id/review",
        clientMessage: "Unable to review verification document."
      });
    }
  });
  app.post("/api/admin/users/direct-create", requireAuth, requireAdmin, async (req, res) => {
    const adminUserId = req.auth.user.id;
    const requestId = req.requestId ?? "";
    const admin = getSupabaseAdmin();
    if (!admin) {
      return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
    }
    const structural = apiSchemas.adminUserDirectCreate.safeParse(req.body ?? {});
    if (!structural.success) {
      const failure = formatValidationFailure(structural.error);
      await logApiError({
        requestId,
        method: req.method,
        path: req.path,
        statusCode: 400,
        message: `direct-create validation failed - fields: ${Object.keys(failure.fields).join(", ")}`,
        error_code: "VALIDATION_ERROR",
        userId: adminUserId,
        role: "admin",
        metadata: {
          operation: "validation",
          adminUserId,
          requestId,
          invalidFields: failure.fields
        }
      }).catch(() => {
      });
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: failure.message, fields: failure.fields, requestId: requestId || null }
      });
    }
    req.body = structural.data;
    const body = req.body;
    const role = typeof body.role === "string" ? body.role.trim().toLowerCase() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const bio = typeof body.bio === "string" ? body.bio.trim() : "";
    const headline = typeof body.headline === "string" ? body.headline.trim() : "";
    const timezone = typeof body.timezone === "string" && body.timezone.trim() ? body.timezone.trim() : "Asia/Kolkata";
    const password = typeof body.password === "string" ? body.password : "";
    const sendEmail = body.sendEmail !== false;
    const rawExperienceYears = body.experienceYears;
    const segmentIds = Array.isArray(body.segmentIds) ? body.segmentIds.filter((id) => typeof id === "string") : [];
    const languages = parseTagList(body.languages);
    const expertise = parseTagList(body.expertise);
    const logContext = (operation, extra) => ({
      operation,
      adminUserId,
      targetEmail: email,
      selectedRole: role,
      requestId,
      ...extra
    });
    if (role !== "seeker" && role !== "mentor") {
      await logApiError({
        requestId,
        method: req.method,
        path: req.path,
        statusCode: 400,
        message: `direct-create validation failed - invalid role: ${role}`,
        error_code: "VALIDATION_ERROR",
        userId: adminUserId,
        role: "admin",
        metadata: logContext("validation", { providedRole: role })
      }).catch(() => {
      });
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: 'Role must be "seeker" or "mentor".', requestId: requestId || null }
      });
    }
    const formValues = {
      role,
      fullName,
      email,
      phone,
      timezone,
      bio,
      headline,
      experienceYears: rawExperienceYears === null || rawExperienceYears === void 0 ? "" : String(rawExperienceYears),
      languages: languages.join(", "),
      expertise: expertise.join(", "),
      segmentIds,
      passwordMode: password ? "manual" : "invitation",
      password,
      confirmPassword: password,
      sendEmail
    };
    const formValidation = validateCreateUserForm(formValues);
    if (!formValidation.valid) {
      await logApiError({
        requestId,
        method: req.method,
        path: req.path,
        statusCode: 400,
        message: `direct-create validation failed - fields: ${Object.keys(formValidation.errors).join(", ")}`,
        error_code: "VALIDATION_ERROR",
        userId: adminUserId,
        role: "admin",
        metadata: logContext("validation", { invalidFields: formValidation.errors })
      }).catch(() => {
      });
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: Object.values(formValidation.errors)[0] ?? "Invalid request.",
          fields: formValidation.errors,
          requestId: requestId || null
        }
      });
    }
    if (!password && !sendEmail) {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Provide a password or enable the account access email, otherwise the new account cannot be signed into.",
          requestId: requestId || null
        }
      });
    }
    const experienceYears = typeof rawExperienceYears === "number" && Number.isInteger(rawExperienceYears) ? rawExperienceYears : 0;
    try {
      const { data: existingProfiles, error: duplicateCheckErr } = await admin.from("profiles").select("id").eq("email", email).limit(1);
      if (duplicateCheckErr) throw duplicateCheckErr;
      if ((existingProfiles ?? []).length > 0) {
        await logApiError({
          requestId,
          method: req.method,
          path: req.path,
          statusCode: 409,
          message: `direct-create duplicate email rejected - email already exists in profiles`,
          error_code: "ACCOUNT_EXISTS",
          userId: adminUserId,
          role: "admin",
          metadata: logContext("duplicate_check", { existingProfileId: existingProfiles[0].id })
        }).catch(() => {
        });
        return res.status(409).json({
          success: false,
          error: { code: "ACCOUNT_EXISTS", message: "An account with this email already exists.", requestId: requestId || null }
        });
      }
    } catch (err) {
      const info = describeSupabaseError(err);
      await logApiError({
        requestId,
        method: req.method,
        path: req.path,
        statusCode: 500,
        message: `direct-create duplicate check failed - [${info.code}] ${info.message}`,
        error_code: info.code,
        userId: adminUserId,
        role: "admin",
        stack: info.stack,
        metadata: logContext("duplicate_check", { errorDetails: info.details, errorHint: info.hint })
      }).catch(() => {
      });
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "POST /api/admin/users/direct-create (duplicate check)",
        clientMessage: "Unable to create the user account."
      });
    }
    const { data: authUser, error: createAuthErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      ...password ? { password } : {},
      user_metadata: { full_name: fullName, timezone, requested_role: role }
    });
    if (createAuthErr) {
      const info = describeSupabaseError(createAuthErr);
      const isDuplicateEmail = info.code === "email_exists" || info.code === "23505" || /already (been )?registered|already exists/i.test(info.message);
      if (isDuplicateEmail) {
        await logApiError({
          requestId,
          method: req.method,
          path: req.path,
          statusCode: 409,
          message: `direct-create duplicate email rejected by auth - [${info.code}] ${info.message}`,
          error_code: info.code,
          userId: adminUserId,
          role: "admin",
          metadata: logContext("auth_create", { authErrorCode: info.code, authErrorMessage: info.message })
        }).catch(() => {
        });
        return res.status(409).json({
          success: false,
          error: { code: "ACCOUNT_EXISTS", message: "An account with this email already exists.", requestId: requestId || null }
        });
      }
      await logApiError({
        requestId,
        method: req.method,
        path: req.path,
        statusCode: 500,
        message: `direct-create auth user creation failed - [${info.code}] ${info.message}`,
        error_code: info.code,
        userId: adminUserId,
        role: "admin",
        stack: info.stack,
        metadata: logContext("auth_create", { authErrorCode: info.code, authErrorMessage: info.message, authErrorDetails: info.details, authErrorHint: info.hint })
      }).catch(() => {
      });
      return respondWithServerError({
        req,
        res,
        error: createAuthErr,
        context: "POST /api/admin/users/direct-create (auth.users insert)",
        clientMessage: "Unable to create the user account."
      });
    }
    if (!authUser.user) {
      await logApiError({
        requestId,
        method: req.method,
        path: req.path,
        statusCode: 500,
        message: "direct-create auth user creation returned no user",
        error_code: "NO_USER_RETURNED",
        userId: adminUserId,
        role: "admin",
        metadata: logContext("auth_create", { authUserData: authUser })
      }).catch(() => {
      });
      return respondWithServerError({
        req,
        res,
        error: new Error("createUser returned no user"),
        context: "POST /api/admin/users/direct-create (auth.users insert)",
        clientMessage: "Unable to create the user account."
      });
    }
    const userId = authUser.user.id;
    const rollbackCreatedUser = async (reason) => {
      const { error: deleteErr } = await admin.auth.admin.deleteUser(userId);
      await logApiError({
        requestId,
        method: req.method,
        path: req.path,
        statusCode: 500,
        message: `direct-create rollback (${reason}) for user ${userId}: ${deleteErr ? getErrorMessage(deleteErr) : "auth user deleted"}`,
        error_code: deleteErr ? "ROLLBACK_FAILED" : "ROLLED_BACK",
        userId: adminUserId,
        role: "admin",
        metadata: logContext("rollback", { reason, deletedUserId: userId, deleteError: deleteErr ? getErrorMessage(deleteErr) : null })
      }).catch(() => {
      });
    };
    try {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const { error: profileErr } = await admin.from("profiles").upsert(
        {
          id: userId,
          email,
          full_name: fullName,
          phone: phone || null,
          timezone,
          avatar_url: null,
          account_status: "active",
          created_at: now,
          updated_at: now
        },
        { onConflict: "id" }
      );
      if (profileErr) {
        const info = describeSupabaseError(profileErr);
        await logApiError({
          requestId,
          method: req.method,
          path: req.path,
          statusCode: resolveHttpStatusForSupabaseError(info),
          message: `direct-create profile upsert failed - [${info.code}] ${info.message}`,
          error_code: info.code,
          userId: adminUserId,
          role: "admin",
          stack: info.stack,
          metadata: logContext("profile_upsert", { profileErrorCode: info.code, profileErrorMessage: info.message, profileErrorDetails: info.details, profileErrorHint: info.hint, userId })
        }).catch(() => {
        });
        throw profileErr;
      }
      const { error: roleErr } = await admin.from("user_roles").upsert({ user_id: userId, role }, { onConflict: "user_id,role", ignoreDuplicates: true });
      if (roleErr) {
        const info = describeSupabaseError(roleErr);
        await logApiError({
          requestId,
          method: req.method,
          path: req.path,
          statusCode: resolveHttpStatusForSupabaseError(info),
          message: `direct-create user_roles upsert failed - [${info.code}] ${info.message}`,
          error_code: info.code,
          userId: adminUserId,
          role: "admin",
          stack: info.stack,
          metadata: logContext("role_upsert", { roleErrorCode: info.code, roleErrorMessage: info.message, roleErrorDetails: info.details, roleErrorHint: info.hint, userId, assignedRole: role })
        }).catch(() => {
        });
        throw roleErr;
      }
      if (role === "mentor") {
        const { error: straySeekerErr } = await admin.from("user_roles").delete().eq("user_id", userId).eq("role", "seeker");
        if (straySeekerErr) {
          const info = describeSupabaseError(straySeekerErr);
          await logApiError({
            requestId,
            method: req.method,
            path: req.path,
            statusCode: resolveHttpStatusForSupabaseError(info),
            message: `direct-create stray seeker role cleanup failed - [${info.code}] ${info.message}`,
            error_code: info.code,
            userId: adminUserId,
            role: "admin",
            stack: info.stack,
            metadata: logContext("role_upsert", { userId, stage: "remove_stray_seeker_role" })
          }).catch(() => {
          });
          throw straySeekerErr;
        }
      }
      if (role === "mentor") {
        const mentorRow = {
          id: userId,
          ...buildAdminCreatedMentorProfile({
            headline: headline || bio,
            about: bio,
            experienceYears
          }),
          languages,
          expertise,
          // Records HOW this mentor joined. The Admin Mentor Control Center
          // reads this to tell an Admin-created mentor (no application, by
          // design) apart from a public signup, instead of guessing.
          created_via: "admin_direct"
        };
        const { error: mpErr } = await admin.from("mentor_profiles").upsert(mentorRow, { onConflict: "id" });
        if (mpErr) {
          const info = describeSupabaseError(mpErr);
          await logApiError({
            requestId,
            method: req.method,
            path: req.path,
            statusCode: resolveHttpStatusForSupabaseError(info),
            message: `direct-create mentor_profiles upsert failed - [${info.code}] ${info.message}`,
            error_code: info.code,
            userId: adminUserId,
            role: "admin",
            stack: info.stack,
            metadata: logContext("mentor_profile_upsert", { mentorErrorCode: info.code, mentorErrorMessage: info.message, mentorErrorDetails: info.details, mentorErrorHint: info.hint, userId, bioLength: bio.length })
          }).catch(() => {
          });
          throw mpErr;
        }
        if (segmentIds.length > 0) {
          const { data: validSegments, error: segReadErr } = await admin.from("segments").select("id, name, is_active").in("id", segmentIds);
          if (segReadErr) {
            await logApiError({
              requestId,
              method: req.method,
              path: req.path,
              statusCode: resolveHttpStatusForSupabaseError(describeSupabaseError(segReadErr)),
              message: `direct-create mentor segment lookup failed - [${describeSupabaseError(segReadErr).code}] ${describeSupabaseError(segReadErr).message}`,
              error_code: describeSupabaseError(segReadErr).code,
              userId: adminUserId,
              role: "admin",
              metadata: logContext("mentor_segments", { userId, segmentIds })
            }).catch(() => {
            });
            throw segReadErr;
          }
          const validIds = new Set((validSegments ?? []).map((s) => s.id));
          const unknown = segmentIds.filter((id) => !validIds.has(id));
          if (unknown.length > 0) {
            await logApiError({
              requestId,
              method: req.method,
              path: req.path,
              statusCode: 400,
              message: "direct-create rejected - unknown segment id(s)",
              error_code: "UNKNOWN_SEGMENT",
              userId: adminUserId,
              role: "admin",
              metadata: logContext("mentor_segments", { unknown })
            }).catch(() => {
            });
            const error = new Error("One or more selected segments no longer exist.");
            error.httpStatus = 400;
            error.code = "UNKNOWN_SEGMENT";
            throw error;
          }
          const { error: msErr } = await admin.from("mentor_segments").insert(
            segmentIds.map((segmentId, index) => ({
              mentor_id: userId,
              segment_id: segmentId,
              is_primary: index === 0
            }))
          );
          if (msErr) {
            const info = describeSupabaseError(msErr);
            await logApiError({
              requestId,
              method: req.method,
              path: req.path,
              statusCode: resolveHttpStatusForSupabaseError(info),
              message: `direct-create mentor_segments insert failed - [${info.code}] ${info.message}`,
              error_code: info.code,
              userId: adminUserId,
              role: "admin",
              stack: info.stack,
              metadata: logContext("mentor_segments", { userId, segmentIds, errorMessage: info.message })
            }).catch(() => {
            });
            throw msErr;
          }
        }
        auditAction(req.auth, MENTOR_ADMIN_AUDIT_ACTIONS.CREATED, {
          entityType: "mentor_profile",
          entityId: userId,
          requestId: req.requestId,
          metadata: {
            adminId: adminUserId,
            mentorId: userId,
            email,
            fullName,
            role: "mentor",
            approvalStatus: ADMIN_CREATED_MENTOR_DEFAULTS.approval_status,
            isActive: ADMIN_CREATED_MENTOR_DEFAULTS.is_active,
            createdVia: "admin_direct_create",
            verificationRequired: false
          }
        });
      } else {
        const { error: spErr } = await admin.from("seeker_profiles").upsert(
          {
            id: userId,
            preferred_language: "English",
            notes: null,
            created_at: now,
            updated_at: now
          },
          { onConflict: "id" }
        );
        if (spErr) {
          const info = describeSupabaseError(spErr);
          await logApiError({
            requestId,
            method: req.method,
            path: req.path,
            statusCode: resolveHttpStatusForSupabaseError(info),
            message: `direct-create seeker_profiles upsert failed - [${info.code}] ${info.message}`,
            error_code: info.code,
            userId: adminUserId,
            role: "admin",
            stack: info.stack,
            metadata: logContext("seeker_profile_upsert", { seekerErrorCode: info.code, seekerErrorMessage: info.message, seekerErrorDetails: info.details, seekerErrorHint: info.hint, userId })
          }).catch(() => {
          });
          throw spErr;
        }
        auditAction(req.auth, "user_role_assigned", {
          entityType: "user_role",
          entityId: userId,
          requestId: req.requestId,
          metadata: { role: "seeker", assignedBy: "admin", email, fullName }
        });
      }
      const appBaseUrl = process.env.APP_URL || process.env.APP_BASE_URL || process.env.VITE_APP_BASE_URL || process.env.PUBLIC_APP_URL;
      let emailDeliveryStatus = "not_sent";
      if (sendEmail && appBaseUrl) {
        const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
          data: { full_name: fullName, timezone, requested_role: role },
          redirectTo: `${appBaseUrl.replace(/\/$/, "")}/auth/callback`
        });
        if (inviteErr) {
          const info = describeSupabaseError(inviteErr);
          if (info.code === "over_email_send_rate_limit") {
            emailDeliveryStatus = "not_sent";
          } else {
            emailDeliveryStatus = "failed";
          }
          await logApiError({
            requestId,
            method: req.method,
            path: req.path,
            statusCode: 201,
            message: `direct-create invitation email ${emailDeliveryStatus} for user ${userId} - [${info.code}] ${info.message}`,
            error_code: info.code,
            userId: adminUserId,
            role: "admin",
            metadata: logContext("email_invite", { emailDeliveryStatus, inviteErrorCode: info.code, inviteErrorMessage: info.message, appBaseUrlConfigured: true })
          }).catch(() => {
          });
        } else {
          emailDeliveryStatus = "sent";
        }
      } else {
        await logApiError({
          requestId,
          method: req.method,
          path: req.path,
          statusCode: 201,
          message: sendEmail ? "direct-create invitation email not sent - APP_URL not configured" : "direct-create invitation email intentionally skipped by admin",
          error_code: sendEmail ? "APP_URL_MISSING" : "EMAIL_SKIPPED",
          userId: adminUserId,
          role: "admin",
          metadata: logContext("email_invite", { emailDeliveryStatus: "not_sent", appBaseUrlConfigured: Boolean(appBaseUrl), sendEmail })
        }).catch(() => {
        });
      }
      await logApiError({
        requestId,
        method: req.method,
        path: req.path,
        statusCode: 201,
        message: `direct-create success - user ${userId} created with role ${role}`,
        error_code: "SUCCESS",
        userId: adminUserId,
        role: "admin",
        metadata: logContext("success", { createdUserId: userId, emailDeliveryStatus, appBaseUrlConfigured: Boolean(appBaseUrl) })
      }).catch(() => {
      });
      return res.status(201).json({
        success: true,
        user: { id: userId, email, full_name: fullName, role },
        account: {
          status: "active",
          approval_status: role === "mentor" ? "approved" : null
        },
        emailDelivery: {
          status: emailDeliveryStatus,
          redirectConfigured: Boolean(appBaseUrl)
        }
      });
    } catch (err) {
      const typed = err;
      const isClientError = typeof typed.httpStatus === "number" && typed.httpStatus < 500;
      if (isClientError) {
        await rollbackCreatedUser(typed.message);
        return res.status(typed.httpStatus).json({
          success: false,
          error: { code: typed.code || "VALIDATION_ERROR", message: typed.message, requestId: requestId || null }
        });
      }
      await rollbackCreatedUser(describeSupabaseError(err).message);
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "POST /api/admin/users/direct-create",
        clientMessage: "Unable to create the user account. No partial account was kept."
      });
    }
  });
  app.post("/api/admin/users/:id/resend-invite", requireAuth, requireAdmin, async (req, res) => {
    const adminUserId = req.auth.user.id;
    const requestId = req.requestId ?? "";
    const admin = getSupabaseAdmin();
    if (!admin) {
      return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
    }
    const userId = req.params.id;
    if (!UUID_PATTERN.test(userId)) {
      return res.status(400).json({ success: false, error: { code: "INVALID_USER_ID", message: "User ID must be a valid UUID." } });
    }
    try {
      const { data: profile, error: profileErr } = await admin.from("profiles").select("id, email, full_name, timezone").eq("id", userId).maybeSingle();
      if (profileErr) throw profileErr;
      if (!profile) {
        return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "User not found." } });
      }
      const { data: userRoles, error: rolesErr } = await admin.from("user_roles").select("role").eq("user_id", userId);
      if (rolesErr) throw rolesErr;
      const roles = (userRoles || []).map((r) => r.role);
      const primaryRole2 = roles.includes("mentor") ? "mentor" : roles.includes("admin") ? "admin" : "seeker";
      const appBaseUrl = process.env.APP_URL || process.env.APP_BASE_URL || process.env.VITE_APP_BASE_URL || process.env.PUBLIC_APP_URL;
      let emailDeliveryStatus = "not_sent";
      if (appBaseUrl) {
        const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(profile.email, {
          data: { full_name: profile.full_name, timezone: profile.timezone, requested_role: primaryRole2 },
          redirectTo: `${appBaseUrl.replace(/\/$/, "")}/auth/callback`
        });
        if (inviteErr) {
          const info = describeSupabaseError(inviteErr);
          if (info.code === "over_email_send_rate_limit") {
            emailDeliveryStatus = "not_sent";
          } else {
            emailDeliveryStatus = "failed";
          }
        } else {
          emailDeliveryStatus = "sent";
        }
      } else {
        emailDeliveryStatus = "failed";
      }
      auditAction(req.auth, "invitation_resent", {
        entityType: "user",
        entityId: userId,
        requestId: req.requestId,
        metadata: { role: primaryRole2, emailDeliveryStatus }
      });
      return res.json({
        success: true,
        message: emailDeliveryStatus === "sent" ? "Invitation email sent successfully." : emailDeliveryStatus === "not_sent" ? "User exists but invitation email could not be sent due to rate limiting. Please try again later." : "User exists but invitation email delivery failed. Please try again later.",
        userId,
        email: profile.email,
        emailDelivery: { status: emailDeliveryStatus, redirectConfigured: Boolean(appBaseUrl) }
      });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: "POST /api/admin/users/:id/resend-invite",
        clientMessage: "Unable to resend invitation email."
      });
    }
  });
  app.get("/api/mentor/document/upload-url", requireAuth, requireRole("mentor"), async (req, res) => {
    try {
      const userId = req.auth.user.id;
      const { applicationId, documentType, fileName, mimeType, sizeBytes } = req.query;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      if (!applicationId || !documentType || !fileName || !mimeType || !sizeBytes) {
        return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "applicationId, documentType, fileName, mimeType, and sizeBytes are required." } });
      }
      const { data: application, error: appErr } = await admin.from("mentor_applications").select("user_id, status").eq("id", applicationId).eq("user_id", userId).maybeSingle();
      if (appErr) throw appErr;
      if (!application) {
        return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Application not found." } });
      }
      if (application.status !== "draft" && application.status !== "rejected") {
        return res.status(409).json({ success: false, error: { code: "CONFLICT", message: "Documents can only be uploaded for draft or rejected applications." } });
      }
      const { data: docType, error: dtErr } = await admin.from("mentor_document_types").select("code").eq("code", documentType).eq("is_active", true).maybeSingle();
      if (dtErr) throw dtErr;
      if (!docType) {
        return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid document type." } });
      }
      if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(mimeType)) {
        return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Unsupported file type." } });
      }
      if (Number(sizeBytes) > 5242880) {
        return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "File size exceeds 5MB limit." } });
      }
      const fileExt = fileName.split(".").pop() || "bin";
      const uniqueFilename = `${documentType}-${Date.now()}-${Math.random().toString(36).substring(2, 12)}.${fileExt}`;
      const storagePath = `${userId}/${applicationId}/${uniqueFilename}`;
      if (process.env.NODE_ENV !== "production") {
        console.log("[MentorVerification] Signed upload URL generated:", {
          bucket: "mentor-verification-documents",
          storagePath,
          userId,
          applicationId,
          documentType,
          originalFileName: fileName,
          mimeType,
          sizeBytes: Number(sizeBytes)
        });
      }
      const { data: uploadUrl, error: urlErr } = await admin.storage.from("mentor-verification-documents").createSignedUploadUrl(storagePath);
      if (urlErr) {
        if (process.env.NODE_ENV !== "production") {
          console.error("[MentorVerification] createSignedUploadUrl error:", logSanitizer.safeMessage(urlErr));
        }
        throw urlErr;
      }
      return res.json({
        success: true,
        uploadUrl: uploadUrl?.signedUrl || "",
        storagePath,
        token: uploadUrl?.token || ""
      });
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[MentorVerification] upload-url error:", logSanitizer.safeMessage(err));
      }
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.get("/api/admin/system-health/dashboard", requireAuth, requireAdmin, async (req, res) => {
    const admin = getSupabaseAdmin();
    if (!admin) {
      return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
    }
    try {
      const rangeParam = req.query.range;
      const range = isDashboardRange(rangeParam) ? rangeParam : DEFAULT_RANGE;
      const { ms: rangeMs, bucketMs } = DASHBOARD_RANGES[range];
      const now = Date.now();
      const parsedStart = req.query.startAt ? new Date(String(req.query.startAt)).getTime() : NaN;
      const parsedEnd = req.query.endAt ? new Date(String(req.query.endAt)).getTime() : NaN;
      const hasWindow = Number.isFinite(parsedStart) && Number.isFinite(parsedEnd) && parsedEnd > parsedStart;
      const windowStartIso = hasWindow ? new Date(parsedStart).toISOString() : new Date(now - rangeMs).toISOString();
      const windowEndIso = hasWindow ? new Date(parsedEnd).toISOString() : new Date(now).toISOString();
      const endpointFilter = typeof req.query.endpoint === "string" && req.query.endpoint.trim() ? req.query.endpoint.trim() : null;
      const ROW_CAP = 2e4;
      const selects = [
        admin.from("system_logs").select("created_at, category, level, status_code, duration_ms, path, error_code, request_id").gte("created_at", windowStartIso).lte("created_at", windowEndIso).in("category", ["api_request", "api_error", "auth", "db"]).order("created_at", { ascending: false }).limit(ROW_CAP),
        admin.from("audit_logs").select("id", { count: "exact", head: true }).gte("created_at", windowStartIso).lte("created_at", windowEndIso)
      ];
      const [logRes, auditRes] = await Promise.all(selects);
      if (logRes.error) throw logRes.error;
      if (auditRes.error) throw auditRes.error;
      let rows = logRes.data ?? [];
      if (endpointFilter) {
        rows = rows.filter((r) => (r.path ?? "").includes(endpointFilter));
      }
      const dbReachable = true;
      const overview = computeOverview(rows, auditRes.count ?? 0);
      const timeline = buildTimeline(rows, rangeMs, bucketMs, now);
      const anomalies = detectAnomalies(timeline, rows, bucketMs);
      const topErrors = groupErrors(rows, 10);
      const auth = summariseAuth(rows);
      const services = summariseServices(overview, rows, dbReachable, auth);
      return res.json({
        success: true,
        dashboard: {
          overview,
          timeline,
          anomalies,
          topErrors,
          services,
          auth,
          range,
          bucketMs,
          // True when the DB had more rows in range than we could read, so the
          // UI can say the numbers are a floor rather than an exact total.
          truncated: (logRes.data?.length ?? 0) >= ROW_CAP,
          window: { start: windowStartIso, end: windowEndIso },
          lastUpdated: new Date(now).toISOString()
        }
      });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err, context: "GET /api/admin/system-health/dashboard" });
    }
  });
  app.get("/api/admin/system-health/metrics", requireAuth, requireAdmin, async (req, res) => {
    try {
      const metrics = await fetchSystemHealthMetrics();
      return res.json({ success: true, metrics });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.get("/api/admin/system-health/logs", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { category, level, status_code, request_id, user_id, path: path2, method, search, timeRangeHours, limit, offset } = req.query;
      const logs = await fetchSystemLogs({
        category,
        level,
        status_code: status_code ? Number(status_code) : void 0,
        request_id,
        user_id,
        path: path2,
        method,
        search,
        timeRangeHours: timeRangeHours ? Number(timeRangeHours) : void 0,
        limit: limit ? Number(limit) : 50,
        offset: offset ? Number(offset) : 0
      });
      return res.json({ success: true, logs });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.get("/api/admin/system-health/errors", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { level, error_code, request_id, user_id, path: path2, search, timeRangeHours, limit, offset } = req.query;
      const allLogs = await fetchSystemLogs({
        level,
        request_id,
        user_id,
        path: path2,
        search,
        timeRangeHours: timeRangeHours ? Number(timeRangeHours) : 24,
        limit: limit ? Number(limit) : 50,
        offset: offset ? Number(offset) : 0
      });
      const errors = allLogs.filter((l) => l.category === "api_error" || l.category === "system" || l.level === "error" || l.level === "warn");
      const filtered = error_code ? errors.filter((l) => l.error_code === error_code) : errors;
      return res.json({ success: true, errors: filtered });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.get("/api/admin/system-health/auth-logs", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { level, user_id, path: path2, search, timeRangeHours, limit, offset } = req.query;
      const logs = await fetchSystemLogs({
        category: "auth",
        level,
        user_id,
        path: path2,
        search,
        timeRangeHours: timeRangeHours ? Number(timeRangeHours) : 24,
        limit: limit ? Number(limit) : 50,
        offset: offset ? Number(offset) : 0
      });
      return res.json({ success: true, logs });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.get("/api/admin/system-health/audit-logs", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { actor_user_id, action, entity_type, request_id, search, timeRangeHours, limit, offset } = req.query;
      const logs = await fetchAuditLogs({
        actor_user_id,
        action,
        entity_type,
        request_id,
        search,
        timeRangeHours: timeRangeHours ? Number(timeRangeHours) : 24,
        limit: limit ? Number(limit) : 50,
        offset: offset ? Number(offset) : 0
      });
      return res.json({ success: true, logs });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.get("/api/admin/system-health/logs/:requestId", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { requestId } = req.params;
      const [log, authLog, auditLog] = await Promise.all([
        fetchSystemLogs({ request_id: requestId, limit: 10 }),
        fetchSystemLogs({ category: "auth", request_id: requestId, limit: 10 }),
        fetchAuditLogs({ request_id: requestId, limit: 10 })
      ]);
      return res.json({
        success: true,
        logs: log,
        auth_log: authLog,
        audit_log: auditLog
      });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.get("/api/admin/system-health/retention", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data, error } = await admin.from("system_log_retention").select("retention_days, updated_at").eq("id", 1).single();
      if (error) throw error;
      return res.json({ success: true, retention: data });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.post("/api/admin/system-health/retention", requireAuth, requireAdmin, validateBody(apiSchemas.logRetention), async (req, res) => {
    try {
      const { retentionDays } = req.body;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { error } = await admin.from("system_log_retention").update({ retention_days: retentionDays, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", 1);
      if (error) throw error;
      auditAction(req.auth, "log_retention_updated", {
        entityType: "system_log_retention",
        requestId: req.requestId,
        metadata: { retentionDays }
      });
      return res.json({ success: true, message: "Log retention updated successfully." });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.post("/api/admin/system-health/prune", requireAuth, requireAdmin, async (req, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: "SERVICE_UNAVAILABLE", message: "Admin client not configured." } });
      }
      const { data: deletedCount, error } = await admin.rpc("prune_system_logs");
      if (error) throw error;
      auditAction(req.auth, "logs_pruned", {
        entityType: "system_logs",
        requestId: req.requestId,
        metadata: { deletedCount }
      });
      return res.json({ success: true, deletedCount: deletedCount || 0 });
    } catch (err) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  app.use("/api", (_req, res) => {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: "API endpoint not found" }
    });
  });
  let httpServer = null;
  if (process.env.NODE_ENV !== "production") {
    const hmrEnabled = process.env.DISABLE_HMR !== "true";
    httpServer = (0, import_http.createServer)(app);
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: { server: httpServer },
        // HMR rides the Express server instead of opening its own WebSocket
        // listener on the default 24678, which collided as soon as a second
        // dev server for this project was running.
        ws: hmrEnabled ? { server: httpServer } : false,
        watch: hmrEnabled ? {} : null
      },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else if (process.env.VERCEL !== "1") {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  app.use(terminalErrorHandler);
  if (process.env.VERCEL !== "1") {
    if (httpServer) {
      httpServer.listen(PORT, "0.0.0.0", () => {
        console.log("This website is buid by Nikhil Kumar ");
        console.log(`[Suggest Key] Server running on http://0.0.0.0:${PORT}`);
      });
    } else {
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`[Suggest Key] Server running on http://0.0.0.0:${PORT}`);
      });
    }
  }
}
startServer();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  extractSegmentHeroStoragePath,
  validateHeroUploadPayload
});
