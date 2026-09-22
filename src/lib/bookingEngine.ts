import {
  Booking,
  BookingStatus,
  Gig,
  MentorAvailability,
  MentorAvailabilityException,
  MentorProfile,
  Segment,
  SlotHold,
  Payment,
  Notification,
} from '@/src/types/database';
import { Profile, UserRole } from '@/src/types/auth';
import { parseZonedDateTime, isSlotConflicting } from './slotEngine';
import { APP_CONFIG, HOLDOUT_MINUTES, SESSION_ACCESS_WINDOW_MINUTES } from '@/src/config/app';

export type { Notification };

export interface BookingValidationResult {
  success: boolean;
  booking?: Booking;
  hold?: SlotHold;
  expires_at?: string;
  booking_code?: string;
  error?: {
    code: string;
    message: string;
  };
}

export interface BookingEngineContext {
  profiles: Profile[];
  userRoles: { user_id: string; role: UserRole }[];
  mentorProfiles: MentorProfile[];
  segments: Segment[];
  mentorSegments: { mentor_id: string; segment_id: string }[];
  gigs: Gig[];
  mentorAvailability: MentorAvailability[];
  mentorAvailabilityExceptions: MentorAvailabilityException[];
  bookings: Booking[];
  slotHolds: SlotHold[];
  payments?: Payment[];
  notifications?: Notification[];
}

export interface BookingRequestInput {
  seekerId: string;
  mentorId: string;
  segmentId: string;
  gigId: string;
  startTime: string; // ISO string UTC
  endTime: string; // ISO string UTC
  currentUtcTime?: Date; // Authoritative server UTC time
}

// Mutex locks keyed by mentorId for serializing concurrent requests in Node runtime
const mentorLocks = new Map<string, Promise<void>>();

async function acquireMentorLock(mentorId: string): Promise<() => void> {
  while (mentorLocks.has(mentorId)) {
    await mentorLocks.get(mentorId);
  }
  let resolveLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    resolveLock = resolve;
  });
  mentorLocks.set(mentorId, lockPromise);

  return () => {
    mentorLocks.delete(mentorId);
    resolveLock!();
  };
}

/**
 * Server-Side Atomic Booking Creation Engine
 * Enforces all 12 validations in strict sequence.
 * Guarantees zero partial records on failure.
 */
export async function executeAtomicBookingWithHold(
  input: BookingRequestInput,
  db: BookingEngineContext
): Promise<BookingValidationResult> {
  const currentUtcTime = input.currentUtcTime || new Date();

  // Acquire concurrency lock for this mentor
  const releaseLock = await acquireMentorLock(input.mentorId);

  try {
    // ------------------------------------------------------------------------
    // 1. AUTHENTICATED USER VALIDATION
    // ------------------------------------------------------------------------
    if (!input.seekerId || typeof input.seekerId !== 'string') {
      return {
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required: missing seeker ID.' },
      };
    }

    const seeker = db.profiles.find((p) => p.id === input.seekerId);
    if (!seeker) {
      return {
        success: false,
        error: { code: 'SEEKER_NOT_FOUND', message: 'Seeker user profile does not exist.' },
      };
    }

    // ------------------------------------------------------------------------
    // 2. SEEKER ROLE VALIDATION
    // ------------------------------------------------------------------------
    const hasSeekerRole = db.userRoles.some(
      (r) => r.user_id === input.seekerId && r.role === 'seeker'
    );
    if (!hasSeekerRole) {
      return {
        success: false,
        error: { code: 'ROLE_NOT_SEEKER', message: 'User does not possess the seeker role.' },
      };
    }

    // ------------------------------------------------------------------------
    // 3. MENTOR VALIDATION (Approved & Active)
    // ------------------------------------------------------------------------
    const mentor = db.profiles.find((p) => p.id === input.mentorId);
    const mentorProfile = db.mentorProfiles.find((mp) => mp.id === input.mentorId);

    if (!mentor || !mentorProfile) {
      return {
        success: false,
        error: { code: 'MENTOR_NOT_FOUND', message: 'Mentor profile not found.' },
      };
    }

    if (!mentorProfile.is_approved) {
      return {
        success: false,
        error: { code: 'MENTOR_NOT_APPROVED', message: 'Mentor is not currently approved.' },
      };
    }

    // ------------------------------------------------------------------------
    // 4. SEGMENT VALIDATION (Active & Mentor Membership)
    // ------------------------------------------------------------------------
    const segment = db.segments.find((s) => s.id === input.segmentId);
    if (!segment || !segment.is_active) {
      return {
        success: false,
        error: { code: 'SEGMENT_INACTIVE', message: 'Selected mentorship segment is not active.' },
      };
    }

    const belongsToSegment = db.mentorSegments.some(
      (ms) => ms.mentor_id === input.mentorId && ms.segment_id === input.segmentId
    );
    if (!belongsToSegment) {
      return {
        success: false,
        error: {
          code: 'MENTOR_SEGMENT_MISMATCH',
          message: 'Mentor is not registered under the selected segment.',
        },
      };
    }

    // ------------------------------------------------------------------------
    // 5. GIG VALIDATION (Active & Belongs to Mentor & Segment)
    // ------------------------------------------------------------------------
    const gig = db.gigs.find((g) => g.id === input.gigId);
    if (!gig || !gig.is_active) {
      return {
        success: false,
        error: { code: 'GIG_INACTIVE', message: 'Selected gig is inactive or does not exist.' },
      };
    }

    if (gig.mentor_id !== input.mentorId || gig.segment_id !== input.segmentId) {
      return {
        success: false,
        error: {
          code: 'GIG_MISMATCH',
          message: 'Gig does not match the specified mentor or segment.',
        },
      };
    }

    // ------------------------------------------------------------------------
    // 6. SELECTED TIME & DURATION VALIDATION
    // ------------------------------------------------------------------------
    const startMs = new Date(input.startTime).getTime();
    const endMs = new Date(input.endTime).getTime();

    if (isNaN(startMs) || isNaN(endMs) || startMs >= endMs) {
      return {
        success: false,
        error: {
          code: 'INVALID_INTERVAL',
          message: 'Slot start time must be strictly earlier than end time.',
        },
      };
    }

    const slotDurationMinutes = Math.round((endMs - startMs) / 60000);
    if (slotDurationMinutes !== gig.duration_minutes) {
      return {
        success: false,
        error: {
          code: 'DURATION_MISMATCH',
          message: `Slot interval (${slotDurationMinutes}m) must exactly equal gig duration (${gig.duration_minutes}m).`,
        },
      };
    }

    // ------------------------------------------------------------------------
    // 7. TIMEZONE CONVERSION
    // ------------------------------------------------------------------------
    const mentorTz = mentor.timezone || 'Asia/Kolkata';
    const seekerTz = seeker.timezone || 'Asia/Kolkata';

    // Format start time into mentor's local calendar date and clock time
    const startZoned = new Date(input.startTime);
    const endZoned = new Date(input.endTime);

    // Get date parts in mentor's timezone
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: mentorTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const localDateStr = formatter.format(startZoned); // 'YYYY-MM-DD'

    // Get day of week (0 = Sunday, 6 = Saturday)
    const dowFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: mentorTz,
      weekday: 'short',
    });
    const weekdayStr = dowFormatter.format(startZoned);
    const dowMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    const dayOfWeek = dowMap[weekdayStr];

    const timeFormatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: mentorTz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const localStartTime = timeFormatter.format(startZoned);
    const localEndTime = timeFormatter.format(endZoned);

    // Verify round-trip conversion to prevent offset tampering
    const canonicalStartUtc = parseZonedDateTime(localDateStr, localStartTime.slice(0, 5), mentorTz);
    if (Math.abs(new Date(canonicalStartUtc).getTime() - startMs) > 60000) {
      return {
        success: false,
        error: {
          code: 'TIMEZONE_DRIFT_DETECTED',
          message: 'Client provided timestamp does not align with mentor timezone operating boundary.',
        },
      };
    }

    // ------------------------------------------------------------------------
    // 8. FUTURE TIME VALIDATION (Past slots cannot be booked)
    // ------------------------------------------------------------------------
    if (startMs <= currentUtcTime.getTime()) {
      return {
        success: false,
        error: {
          code: 'PAST_SLOT_FORBIDDEN',
          message: 'Cannot book or hold a slot that begins in the past.',
        },
      };
    }

    // ------------------------------------------------------------------------
    // 9. RECURRING MENTOR AVAILABILITY & 10. DATE EXCEPTIONS
    // ------------------------------------------------------------------------
    const exception = db.mentorAvailabilityExceptions.find(
      (e) => e.mentor_id === input.mentorId && e.exception_date === localDateStr
    );

    if (exception) {
      if (!exception.is_available) {
        return {
          success: false,
          error: {
            code: 'DATE_EXCEPTION_UNAVAILABLE',
            message: 'Mentor has marked this date as unavailable (leave/holiday).',
          },
        };
      }

      if (exception.start_time && exception.end_time) {
        if (localStartTime < exception.start_time || localEndTime > exception.end_time) {
          return {
            success: false,
            error: {
              code: 'OUTSIDE_EXCEPTION_HOURS',
              message: `Slot falls outside custom operating hours for this date (${exception.start_time} - ${exception.end_time}).`,
            },
          };
        }
      }
    } else {
      // Check weekly recurring schedule
      const recurring = db.mentorAvailability.find(
        (a) =>
          a.mentor_id === input.mentorId &&
          a.day_of_week === dayOfWeek &&
          a.is_enabled &&
          a.start_time <= localStartTime &&
          a.end_time >= localEndTime
      );

      if (!recurring) {
        return {
          success: false,
          error: {
            code: 'OUTSIDE_AVAILABILITY',
            message: 'Slot falls outside mentor regular operating hours for this day of the week.',
          },
        };
      }
    }

    // ------------------------------------------------------------------------
    // 11. CONFLICTING BOOKINGS VALIDATION (Global mentor availability)
    // ------------------------------------------------------------------------
    // Non-pending bookings (confirmed, completed, mentor_pending, pending_verification)
    const conflictingBooking = db.bookings.find(
      (b) =>
        b.mentor_id === input.mentorId &&
        b.status !== 'CANCELLED' &&
        b.status !== 'REJECTED' &&
        b.status !== 'PAYMENT_PENDING' &&
        isSlotConflicting(input.startTime, input.endTime, b.start_time, b.end_time)
    );

    if (conflictingBooking) {
      return {
        success: false,
        error: {
          code: 'SLOT_ALREADY_BOOKED',
          message: 'The requested slot conflicts with an existing confirmed booking for this mentor.',
        },
      };
    }

    // ------------------------------------------------------------------------
    // 12. ACTIVE HOLDS VALIDATION (Expired holds release slot; active blocks)
    // ------------------------------------------------------------------------
    // Expire any stale holds
    db.slotHolds.forEach((h) => {
      if (
        h.mentor_id === input.mentorId &&
        h.status === 'ACTIVE' &&
        new Date(h.expires_at).getTime() <= currentUtcTime.getTime()
      ) {
        h.status = 'EXPIRED';
        // Also cancel corresponding payment_pending booking if any
        const pendingBk = db.bookings.find((b) => b.hold_id === h.id && b.status === 'PAYMENT_PENDING');
        if (pendingBk) {
          pendingBk.status = 'CANCELLED';
        }
      }
    });

    // Check for overlapping active, unexpired holds
    const conflictingHold = db.slotHolds.find(
      (h) =>
        h.mentor_id === input.mentorId &&
        h.status === 'ACTIVE' &&
        new Date(h.expires_at).getTime() > currentUtcTime.getTime() &&
        isSlotConflicting(input.startTime, input.endTime, h.start_time, h.end_time)
    );

    if (conflictingHold) {
      return {
        success: false,
        error: {
          code: 'SLOT_HELD_BY_OTHER',
          message: `The requested slot is currently held by another seeker (${HOLDOUT_MINUTES}-minute hold active).`,
        },
      };
    }

    // ------------------------------------------------------------------------
    // ATOMIC TRANSACTION: CREATE 15-MINUTE HOLD & PAYMENT_PENDING BOOKING
    // ------------------------------------------------------------------------
    const holdExpiresAt = new Date(currentUtcTime.getTime() + APP_CONFIG.HOLD_DURATION_MS).toISOString();
    const holdId = 'hold-' + Math.random().toString(36).substring(2, 11);

    const newHold: SlotHold = {
      id: holdId,
      mentor_id: input.mentorId,
      seeker_id: input.seekerId,
      gig_id: input.gigId,
      start_time: input.startTime,
      end_time: input.endTime,
      status: 'ACTIVE',
      expires_at: holdExpiresAt,
      created_at: currentUtcTime.toISOString(),
    };

    const bookingCode =
      'BK-' +
      Math.random().toString(36).substring(2, 6).toUpperCase() +
      Math.floor(1000 + Math.random() * 9000);

    const bookingId = 'bk-' + Math.random().toString(36).substring(2, 11);

    const newBooking: Booking = {
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
      status: 'PAYMENT_PENDING',
      meeting_url: null,
      cancellation_reason: null,
      created_at: currentUtcTime.toISOString(),
      updated_at: currentUtcTime.toISOString(),
      gig,
      segment,
    };

    // Commit atomically to state
    db.slotHolds.push(newHold);
    db.bookings.push(newBooking);

    return {
      success: true,
      booking: newBooking,
      hold: newHold,
      expires_at: holdExpiresAt,
      booking_code: bookingCode,
    };
  } finally {
    releaseLock();
  }
}

// ----------------------------------------------------------------------------
// PHASE 8: MENTOR CONFIRMATION & MEETING LINK ENGINE
// ----------------------------------------------------------------------------

export interface ConfirmSessionInput {
  bookingId: string;
  mentorId: string;
  meetingUrl: string;
  currentUtcTime?: Date;
}

export interface ConfirmSessionResult {
  success: boolean;
  booking?: Booking;
  isOverdue?: boolean;
  message?: string;
  error?: {
    code: string;
    message: string;
  };
}

export interface MeetingLinkValidationResult {
  isValid: boolean;
  error?: string;
  normalizedUrl?: string;
}

export interface MeetingLinkDeadlineInfo {
  deadlineUtc: string;
  isOverdue: boolean;
  hoursUntilSession: number;
  minutesUntilSession: number;
}

/**
 * Validates that the meeting URL is a secure HTTPS link with valid hostname.
 */
export function validateMeetingUrl(url: string | null | undefined): MeetingLinkValidationResult {
  if (!url || typeof url !== 'string' || url.trim() === '') {
    return {
      isValid: false,
      error: 'Meeting link is required to confirm the session.',
    };
  }

  const trimmed = url.trim();

  // Invariant: Must strictly use HTTPS
  if (!trimmed.toLowerCase().startsWith('https://')) {
    return {
      isValid: false,
      error: 'Meeting link must begin with secure https:// protocol.',
    };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') {
      return {
        isValid: false,
        error: 'Meeting link must use https:// protocol.',
      };
    }
    // Must have a valid hostname with at least one dot (domain.tld)
    if (!parsed.hostname || !parsed.hostname.includes('.')) {
      return {
        isValid: false,
        error: 'Meeting link must have a valid domain (e.g. meet.google.com, zoom.us, teams.microsoft.com).',
      };
    }
    return {
      isValid: true,
      normalizedUrl: trimmed,
    };
  } catch {
    return {
      isValid: false,
      error: 'Meeting link must be a valid HTTPS URL.',
    };
  }
}

/**
 * Calculates meeting link deadline (recommended 2 hours before session start).
 * Invariant: Missing deadline does NOT automatically cancel the booking.
 */
export function calculateMeetingLinkDeadline(
  startTimeUtc: string,
  nowUtc: Date = new Date()
): MeetingLinkDeadlineInfo {
  const sessionStartMs = new Date(startTimeUtc).getTime();
  const deadlineMs = sessionStartMs - APP_CONFIG.MEETING_LINK_DEADLINE_MS;
  const nowMs = nowUtc.getTime();

  const isOverdue = nowMs > deadlineMs;
  const minutesUntilSession = Math.floor((sessionStartMs - nowMs) / (1000 * 60));
  const hoursUntilSession = Number(((sessionStartMs - nowMs) / (1000 * 60 * 60)).toFixed(1));

  return {
    deadlineUtc: new Date(deadlineMs).toISOString(),
    isOverdue,
    hoursUntilSession,
    minutesUntilSession,
  };
}

/**
 * Identifies overdue meeting links where status is MENTOR_PENDING and current time is past the 2-hour deadline.
 */
export function getOverdueBookings(
  db: BookingEngineContext,
  nowUtc: Date = new Date()
): Booking[] {
  return db.bookings.filter((b) => {
    if (b.status !== 'MENTOR_PENDING') return false;
    const { isOverdue } = calculateMeetingLinkDeadline(b.start_time, nowUtc);
    return isOverdue;
  });
}

/**
 * Executes mentor confirmation of a booking:
 * - Validates booking exists
 * - Enforces status is MENTOR_PENDING
 * - Enforces mentor ownership of booking
 * - Enforces valid HTTPS meeting link
 * - Transitions status to CONFIRMED
 * - Dispatches in-app notification to seeker
 * - Dispatches in-app notification to mentor
 * - Returns updated booking state
 */
export async function confirmSessionByMentor(
  input: ConfirmSessionInput,
  db: BookingEngineContext
): Promise<ConfirmSessionResult> {
  const currentUtcTime = input.currentUtcTime || new Date();

  if (!input.mentorId) {
    return {
      success: false,
      error: { code: 'AUTH_REQUIRED', message: 'Mentor authentication required.' },
    };
  }

  // 1. Booking existence check
  const booking = db.bookings.find((b) => b.id === input.bookingId);
  if (!booking) {
    return {
      success: false,
      error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' },
    };
  }

  // 2. Ownership check: mentor must own the booking
  const isOwner = booking.mentor_id === input.mentorId;

  if (!isOwner) {
    return {
      success: false,
      error: {
        code: 'FORBIDDEN_NOT_BOOKING_OWNER',
        message: 'Forbidden: You are not authorized to confirm this booking.',
      },
    };
  }

  // 3. Status check: Booking must be in MENTOR_PENDING status
  if (booking.status !== 'MENTOR_PENDING') {
    if (booking.status === 'PAYMENT_PENDING' || booking.status === 'PENDING_VERIFICATION') {
      return {
        success: false,
        error: {
          code: 'PAYMENT_NOT_VERIFIED',
          message: 'Cannot confirm session: Payment verification is still pending.',
        },
      };
    }
    if (booking.status === 'CONFIRMED') {
      return {
        success: false,
        error: {
          code: 'ALREADY_CONFIRMED',
          message: 'Booking has already been confirmed.',
        },
      };
    }
    return {
      success: false,
      error: {
        code: 'INVALID_BOOKING_STATUS',
        message: `Booking is in '${booking.status}' status. Only MENTOR_PENDING bookings can be confirmed.`,
      },
    };
  }

  // 4. Meeting link validation: mentor cannot confirm without valid HTTPS meeting link
  const urlValidation = validateMeetingUrl(input.meetingUrl);
  if (!urlValidation.isValid) {
    return {
      success: false,
      error: {
        code: 'INVALID_MEETING_URL',
        message: urlValidation.error || 'A valid HTTPS meeting link is required.',
      },
    };
  }

  // 5. Check deadline status (for reporting / notification)
  const deadlineInfo = calculateMeetingLinkDeadline(booking.start_time, currentUtcTime);

  // 6. Transition state to CONFIRMED
  booking.status = 'CONFIRMED';
  booking.meeting_url = urlValidation.normalizedUrl!;
  booking.updated_at = currentUtcTime.toISOString();

  // 7. Dispatch in-app notification to Seeker
  if (!db.notifications) {
    db.notifications = [];
  }

  const seekerNotification: Notification = {
    id: `notif-seeker-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    user_id: booking.seeker_id,
    title: 'Session Confirmed by Mentor',
    message: `Your mentor has confirmed session ${booking.booking_code}. Your secure meeting link will unlock 5 minutes prior to session start.`,
    type: 'SESSION',
    link: `/seeker/bookings?bookingId=${booking.id}`,
    is_read: false,
    created_at: currentUtcTime.toISOString(),
  };
  db.notifications.push(seekerNotification);

  // 8. Dispatch in-app notification to Mentor
  const mentorNotification: Notification = {
    id: `notif-mentor-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    user_id: booking.mentor_id,
    title: 'Session Confirmed Successfully',
    message: `You confirmed session ${booking.booking_code}. The meeting link has been securely stored.`,
    type: 'SESSION',
    link: `/mentor/booking-detail?bookingId=${booking.id}`,
    is_read: false,
    created_at: currentUtcTime.toISOString(),
  };
  db.notifications.push(mentorNotification);

  return {
    success: true,
    booking,
    isOverdue: deadlineInfo.isOverdue,
    message: 'Session confirmed successfully.',
  };
}

// ----------------------------------------------------------------------------
// PHASE 9: SESSION ACCESS & TIME-GATE ENGINE
// ----------------------------------------------------------------------------

export type SessionAccessState =
  | 'BEFORE_T5' // now < start_time - 5 mins: link hidden, join denied
  | 'T5_WINDOW' // start_time - 5 mins <= now < start_time: link visible, pre-session join allowed
  | 'IN_PROGRESS' // start_time <= now < end_time: link visible, join allowed
  | 'COMPLETED'; // now >= end_time: join denied, link hidden, transitioned to COMPLETED

export interface SessionAccessRequest {
  bookingId: string;
  userId: string;
  currentUtcTime?: Date;
}

export interface SessionAccessResult {
  success: boolean;
  canJoin: boolean;
  accessState: SessionAccessState;
  meetingUrl: string | null; // Strictly null unless in T5_WINDOW or IN_PROGRESS
  sessionTitle: string;
  mentorName: string;
  seekerName: string;
  mentorId: string;
  seekerId: string;
  startTime: string;
  endTime: string;
  currentServerTime: string;
  secondsUntilT5: number;
  secondsUntilStart: number;
  secondsUntilEnd: number;
  bookingStatus: BookingStatus;
  bookingCode: string;
  message: string;
  error?: {
    code: string;
    message: string;
  };
}

export interface AuthoritativeJoinResult {
  success: boolean;
  canJoin: boolean;
  meetingUrl?: string;
  accessState: SessionAccessState;
  bookingCode?: string;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Sweeps bookings and transitions confirmed bookings past end_time to COMPLETED.
 */
export function transitionExpiredBookingsToCompleted(
  db: BookingEngineContext,
  nowUtc: Date = new Date()
): Booking[] {
  const nowMs = nowUtc.getTime();
  const transitioned: Booking[] = [];

  for (const booking of db.bookings) {
    if (booking.status === 'CONFIRMED') {
      const endMs = new Date(booking.end_time).getTime();
      if (nowMs >= endMs) {
        booking.status = 'COMPLETED';
        booking.updated_at = nowUtc.toISOString();
        transitioned.push(booking);

        // Dispatch completion notification to seeker if not already sent
        if (!db.notifications) {
          db.notifications = [];
        }
        const notifExists = db.notifications.some(
          (n) => n.user_id === booking.seeker_id && n.link?.includes(booking.id) && n.title.includes('Completed')
        );
        if (!notifExists) {
          db.notifications.push({
            id: `notif-comp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            user_id: booking.seeker_id,
            title: 'Session Completed',
            message: `Your session ${booking.booking_code} has concluded. You can access your session notes anytime.`,
            type: 'SESSION',
            link: `/seeker/bookings?bookingId=${booking.id}`,
            is_read: false,
            created_at: nowUtc.toISOString(),
          });
        }
      }
    }
  }

  return transitioned;
}

/**
 * Server-authoritative validation for session access:
 * - Validates booking exists
 * - Enforces seeker or mentor participant authorization
 * - Validates booking status (CONFIRMED or COMPLETED)
 * - Evaluates authoritative time-gate:
 *     Before T-5: meeting link hidden, join denied
 *     From T-5 until session end: meeting link available, join allowed
 *     At or after session end: join denied, transitions to COMPLETED
 */
export function validateSessionAccess(
  input: SessionAccessRequest,
  db: BookingEngineContext
): SessionAccessResult {
  const now = input.currentUtcTime || new Date();
  const nowMs = now.getTime();

  // Run automatic transition for expired bookings
  transitionExpiredBookingsToCompleted(db, now);

  // 1. Locate booking
  const booking = db.bookings.find(
    (b) => b.id === input.bookingId || b.booking_code.toUpperCase() === input.bookingId.toUpperCase()
  );

  if (!booking) {
    return {
      success: false,
      canJoin: false,
      accessState: 'COMPLETED',
      meetingUrl: null,
      sessionTitle: 'Session Not Found',
      mentorName: '',
      seekerName: '',
      mentorId: '',
      seekerId: '',
      startTime: '',
      endTime: '',
      currentServerTime: now.toISOString(),
      secondsUntilT5: 0,
      secondsUntilStart: 0,
      secondsUntilEnd: 0,
      bookingStatus: 'CANCELLED',
      bookingCode: '',
      message: 'Booking not found.',
      error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' },
    };
  }

  // Lookup metadata
  const gig = db.gigs.find((g) => g.id === booking.gig_id);
  const mentorProfile = db.profiles.find((p) => p.id === booking.mentor_id);
  const seekerProfile = db.profiles.find((p) => p.id === booking.seeker_id);
  const sessionTitle = gig?.title || '1:1 Mentorship Session';
  const mentorName = mentorProfile?.full_name || 'Mentor';
  const seekerName = seekerProfile?.full_name || 'Seeker';

  // 2. Authorize user: caller must be seeker, mentor, or mentor alias
  const isSeeker = booking.seeker_id === input.userId;
  const isMentor = booking.mentor_id === input.userId;
  const userRole = db.userRoles.find((r) => r.user_id === input.userId)?.role;
  const isAdmin = userRole === 'admin';

  if (!isSeeker && !isMentor && !isAdmin) {
    return {
      success: false,
      canJoin: false,
      accessState: 'BEFORE_T5',
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
      message: 'Forbidden: You are not an authorized participant in this session.',
      error: {
        code: 'FORBIDDEN_NOT_PARTICIPANT',
        message: 'Forbidden: You are not authorized to access this session.',
      },
    };
  }

  // 3. Status checks
  if (booking.status === 'PAYMENT_PENDING' || booking.status === 'PENDING_VERIFICATION') {
    return {
      success: false,
      canJoin: false,
      accessState: 'BEFORE_T5',
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
      message: 'Payment verification is pending for this session.',
      error: {
        code: 'PAYMENT_NOT_VERIFIED',
        message: 'This session has not been verified yet.',
      },
    };
  }

  if (booking.status === 'MENTOR_PENDING') {
    return {
      success: false,
      canJoin: false,
      accessState: 'BEFORE_T5',
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
      message: 'Session is awaiting mentor confirmation and meeting link.',
      error: {
        code: 'MENTOR_CONFIRMATION_PENDING',
        message: 'Mentor has not yet confirmed the session.',
      },
    };
  }

  if (booking.status === 'CANCELLED' || booking.status === 'REJECTED') {
    return {
      success: false,
      canJoin: false,
      accessState: 'COMPLETED',
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
        code: 'BOOKING_CANCELLED',
        message: `This session was ${booking.status.toLowerCase()}.`,
      },
    };
  }

  // 4. Compute authoritative time windows
  const startMs = new Date(booking.start_time).getTime();
  const endMs = new Date(booking.end_time).getTime();
    const t5Ms = startMs - APP_CONFIG.SESSION_ACCESS_WINDOW_MS;

  const secondsUntilT5 = Math.max(0, Math.ceil((t5Ms - nowMs) / 1000));
  const secondsUntilStart = Math.max(0, Math.ceil((startMs - nowMs) / 1000));
  const secondsUntilEnd = Math.max(0, Math.ceil((endMs - nowMs) / 1000));

  // CASE 1: At or after session end (now >= end_time)
  // "At or after session end: join denied"
  // "After end_time: booking/session should transition appropriately toward COMPLETED."
  if (nowMs >= endMs || booking.status === 'COMPLETED') {
    if (booking.status !== 'COMPLETED') {
      booking.status = 'COMPLETED';
      booking.updated_at = now.toISOString();
    }

    return {
      success: true,
      canJoin: false,
      accessState: 'COMPLETED',
      meetingUrl: null, // Strictly hidden / inactive
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
      bookingStatus: 'COMPLETED',
      bookingCode: booking.booking_code,
      message: 'Session has concluded. Thank you for participating.',
      error: {
        code: 'SESSION_ENDED',
        message: 'This session has already ended. Joining is no longer permitted.',
      },
    };
  }

  // CASE 2: Before T-5 (now < start_time - 5 min)
  // "Before T-5: meeting link hidden, join denied"
  if (nowMs < t5Ms) {
    return {
      success: true,
      canJoin: false,
      accessState: 'BEFORE_T5',
      meetingUrl: null, // Strictly hidden!
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
      message: 'Meeting link unlocks exactly 5 minutes before scheduled start.',
      error: {
        code: 'TOO_EARLY',
        message: 'Access opens 5 minutes before session start.',
      },
    };
  }

  // CASE 3: Inside T-5 early arrival window (start_time - 5 min <= now < start_time)
  // "From T-5 until session end: meeting link available, join allowed"
  if (nowMs >= t5Ms && nowMs < startMs) {
    return {
      success: true,
      canJoin: true,
      accessState: 'T5_WINDOW',
      meetingUrl: booking.meeting_url, // Available!
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
      message: 'Early access window is open. You may now join the session room.',
    };
  }

  // CASE 4: Active session in-progress (start_time <= now < end_time)
  // "From T-5 until session end: meeting link available, join allowed"
  return {
    success: true,
    canJoin: true,
    accessState: 'IN_PROGRESS',
    meetingUrl: booking.meeting_url, // Available!
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
    message: 'Session is currently in progress. Join immediately.',
  };
}

/**
 * Server-authoritative action when user clicks "Join Session":
 * Re-validates current server time against the session access rule.
 * Throws/returns error if before T-5 or after end_time.
 */
export function joinSessionAuthoritative(
  input: SessionAccessRequest,
  db: BookingEngineContext
): AuthoritativeJoinResult {
  const result = validateSessionAccess(input, db);

  if (!result.canJoin) {
    return {
      success: false,
      canJoin: false,
      accessState: result.accessState,
      bookingCode: result.bookingCode,
      error: result.error || {
        code: result.accessState === 'BEFORE_T5' ? 'TOO_EARLY' : 'SESSION_ENDED',
        message: result.message,
      },
    };
  }

  return {
    success: true,
    canJoin: true,
    meetingUrl: result.meetingUrl || undefined,
    accessState: result.accessState,
    bookingCode: result.bookingCode,
  };
}

