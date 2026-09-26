import {
  GeneratedSlot,
  SlotStatus,
  MentorAvailability,
  MentorAvailabilityException,
  Booking,
  SlotHold,
} from '@/src/types/database';

/**
 * Calculates timezone offset in milliseconds between UTC and the specified IANA timezone
 * at a given instant, completely independent of the browser's local timezone.
 */
export function getTimezoneOffsetMs(timeZone: string, date: Date): number {
  try {
    const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
    const tzDate = new Date(date.toLocaleString('en-US', { timeZone }));
    return tzDate.getTime() - utcDate.getTime();
  } catch (err) {
    console.warn(`Invalid timezone "${timeZone}", falling back to UTC`, err);
    return 0;
  }
}

/**
 * Parses a calendar date string (YYYY-MM-DD) and a time string (HH:MM or HH:MM:SS)
 * within a specific IANA timezone (e.g. 'Asia/Kolkata', 'America/New_York') and returns
 * the exact UTC Date instant.
 *
 * DST-resilient with two-pass offset stabilization.
 */
export function parseZonedDateTime(dateStr: string, timeStr: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const timeParts = timeStr.split(':').map(Number);
  const hh = timeParts[0] || 0;
  const mm = timeParts[1] || 0;
  const ss = timeParts[2] || 0;

  // 1. Construct naive UTC date at specified clock time
  const naiveUtc = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));

  // 2. Compute first-pass offset
  const offset1 = getTimezoneOffsetMs(timeZone, naiveUtc);
  const candidate = new Date(naiveUtc.getTime() - offset1);

  // 3. Second-pass offset check across DST / local boundary
  const offset2 = getTimezoneOffsetMs(timeZone, candidate);
  return new Date(naiveUtc.getTime() - offset2);
}

/**
 * Formats a UTC Date back into a 12-hour or 24-hour time string in the specified timezone.
 */
export function formatTimeInTimezone(
  date: Date | string,
  timeZone: string,
  options: { hour12?: boolean; includeSeconds?: boolean } = { hour12: true }
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    second: options.includeSeconds ? '2-digit' : undefined,
    hour12: options.hour12 ?? true,
  });
}

/**
 * Formats a 24h 'HH:MM' string into a friendly 'h:mm A' label without timezone distortion.
 */
export function formatLocalTimeLabel(timeStr: string): string {
  const [hh, mm] = timeStr.split(':').map(Number);
  const period = hh >= 12 ? 'PM' : 'AM';
  const displayHour = hh % 12 === 0 ? 12 : hh % 12;
  const displayMin = mm < 10 ? `0${mm}` : `${mm}`;
  return `${displayHour}:${displayMin} ${period}`;
}

export function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-IN', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Returns the calendar date ('YYYY-MM-DD') that an instant falls on inside a given
 * IANA timezone. Used so "Today" / "Tomorrow" reflect the user's configured
 * timezone rather than UTC or the browser default.
 */
export function getDateStringInTimezone(date: Date, timeZone: string): string {
  try {
    return date.toLocaleDateString('en-CA', { timeZone });
  } catch (err) {
    console.warn(`Invalid timezone "${timeZone}", falling back to UTC`, err);
    return date.toISOString().split('T')[0];
  }
}

/**
 * Shifts a 'YYYY-MM-DD' calendar date by whole days. Pure calendar arithmetic
 * on the date string, so it is unaffected by UTC offsets and DST boundaries.
 */
export function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().split('T')[0];
}

/**
 * Returns day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday) for a date string (YYYY-MM-DD)
 */
export function getDayOfWeekFromDateString(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  // Noon UTC prevents day drift
  const midDay = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return midDay.getUTCDay();
}

export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Short weekday label (e.g. "Wed") for a 'YYYY-MM-DD' date string, computed in
 * UTC so it is stable regardless of the user's browser timezone.
 */
export function getWeekdayShort(dateStr: string): string {
  const dow = getDayOfWeekFromDateString(dateStr);
  return WEEKDAYS_SHORT[dow] ?? '';
}

/**
 * Builds a compact rolling set of selectable dates starting from `today`
 * ('YYYY-MM-DD'), e.g. Today, Tomorrow, Wed, Thu, ...
 *
 * `today` must come from `getDateStringInTimezone` so the window is computed in
 * the user's configured timezone rather than UTC or the browser default.
 */
export function buildQuickDates(
  today: string,
  count: number
): { label: string; value: string }[] {
  const dates: { label: string; value: string }[] = [];
  for (let i = 0; i < count; i++) {
    const value = addDaysToDateString(today, i);
    if (!value) continue;
    const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : getWeekdayShort(value);
    dates.push({ label, value });
  }
  return dates;
}

/**
 * Converts 'HH:MM' or 'HH:MM:SS' to total minutes since midnight
 */
export function timeStringToMinutes(timeStr: string): number {
  const [hh, mm] = timeStr.split(':').map(Number);
  return (hh || 0) * 60 + (mm || 0);
}

/**
 * Converts total minutes since midnight back into 'HH:MM'
 */
export function minutesToTimeString(minutes: number): string {
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${pad(hh)}:${pad(mm)}`;
}

/**
 * Checks if two half-open intervals [start1, end1) and [start2, end2) overlap.
 * Adjacent intervals where end1 === start2 do NOT overlap.
 */
export function intervalsOverlap(
  start1: number | Date,
  end1: number | Date,
  start2: number | Date,
  end2: number | Date
): boolean {
  const s1 = typeof start1 === 'number' ? start1 : start1.getTime();
  const e1 = typeof end1 === 'number' ? end1 : end1.getTime();
  const s2 = typeof start2 === 'number' ? start2 : start2.getTime();
  const e2 = typeof end2 === 'number' ? end2 : end2.getTime();

  return s1 < e2 && e1 > s2;
}

export function isSlotConflicting(
  start1: string | number | Date,
  end1: string | number | Date,
  start2: string | number | Date,
  end2: string | number | Date
): boolean {
  const s1 = typeof start1 === 'string' ? new Date(start1).getTime() : typeof start1 === 'number' ? start1 : start1.getTime();
  const e1 = typeof end1 === 'string' ? new Date(end1).getTime() : typeof end1 === 'number' ? end1 : end1.getTime();
  const s2 = typeof start2 === 'string' ? new Date(start2).getTime() : typeof start2 === 'number' ? start2 : start2.getTime();
  const e2 = typeof end2 === 'string' ? new Date(end2).getTime() : typeof end2 === 'number' ? end2 : end2.getTime();

  return s1 < e2 && e1 > s2;
}

export interface SlotEngineOptions {
  mentorId: string;
  gigId: string;
  dateStr: string; // 'YYYY-MM-DD'
  timezone: string;
  durationMinutes: number;
  recurringAvailability: MentorAvailability[];
  exceptions: MentorAvailabilityException[];
  bookings: Booking[];
  slotHolds: SlotHold[];
  currentUtcTime?: Date;
}

/**
 * Dynamic Slot Generation Engine
 *
 * Enforces:
 * 1. Date exceptions (unavailable overrides vs custom operating hours)
 * 2. Weekly recurring availability rules
 * 3. Dynamic division of available windows into contiguous `durationMinutes` slots
 * 4. Conversion of mentor local clock intervals to exact UTC ISO instants
 * 5. Past-slot detection against authoritative currentUtcTime
 * 6. Global booking conflict detection across ALL mentor gigs
 * 7. Global active hold conflict detection across ALL mentor gigs (with expiration check)
 */
export function generateMentorSlots(options: SlotEngineOptions): GeneratedSlot[] {
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
    currentUtcTime = new Date(),
  } = options;

  if (durationMinutes <= 0) {
    return [];
  }

  // --------------------------------------------------------------------------
  // Step 1: Check for date-specific exceptions for this mentor
  // --------------------------------------------------------------------------
  const dateException = exceptions.find(
    (e) => e.mentor_id === mentorId && e.exception_date === dateStr
  );

  let activeWindows: Array<{ start_time: string; end_time: string }> = [];

  if (dateException) {
    if (!dateException.is_available) {
      // Mentor is marked unavailable on this date (e.g. sick day, holiday)
      return [];
    }

    if (dateException.start_time && dateException.end_time) {
      activeWindows.push({
        start_time: dateException.start_time,
        end_time: dateException.end_time,
      });
    }
  } else {
    // --------------------------------------------------------------------------
    // Step 2: Use weekly recurring availability for day of week
    // --------------------------------------------------------------------------
    const targetDayOfWeek = getDayOfWeekFromDateString(dateStr);
    const dayRules = recurringAvailability.filter(
      (a) =>
        a.mentor_id === mentorId &&
        a.day_of_week === targetDayOfWeek &&
        a.is_enabled
    );

    for (const rule of dayRules) {
      activeWindows.push({
        start_time: rule.start_time,
        end_time: rule.end_time,
      });
    }
  }

  if (activeWindows.length === 0) {
    return [];
  }

  // --------------------------------------------------------------------------
  // Step 3: Filter active bookings & holds for global mentor availability
  // --------------------------------------------------------------------------
  // All confirmed/pending non-cancelled bookings for this mentor block the calendar
  const mentorBookings = bookings.filter(
    (b) =>
      b.mentor_id === mentorId &&
      !['CANCELLED', 'REJECTED'].includes(b.status)
  );

  // Active holds for this mentor that have not expired block the calendar
  const nowMs = currentUtcTime.getTime();
  const mentorActiveHolds = slotHolds.filter(
    (h) =>
      h.mentor_id === mentorId &&
      h.status === 'ACTIVE' &&
      new Date(h.expires_at).getTime() > nowMs
  );

  // --------------------------------------------------------------------------
  // Step 4: Dynamically generate slots from each available window
  // --------------------------------------------------------------------------
  const generatedSlots: GeneratedSlot[] = [];

  for (const window of activeWindows) {
    const windowStartMin = timeStringToMinutes(window.start_time);
    const windowEndMin = timeStringToMinutes(window.end_time);

    for (
      let curMin = windowStartMin;
      curMin + durationMinutes <= windowEndMin;
      curMin += durationMinutes
    ) {
      const slotStartMin = curMin;
      const slotEndMin = curMin + durationMinutes;

      const localStartTime = minutesToTimeString(slotStartMin);
      const localEndTime = minutesToTimeString(slotEndMin);

      // Convert local mentor time to UTC
      const slotUtcStart = parseZonedDateTime(dateStr, localStartTime, timezone);
      const slotUtcEnd = parseZonedDateTime(dateStr, localEndTime, timezone);

      const slotUtcStartMs = slotUtcStart.getTime();
      const slotUtcEndMs = slotUtcEnd.getTime();

      let status: SlotStatus = 'AVAILABLE';
      let isAvailable = true;
      let conflictReason: GeneratedSlot['conflict_reason'] | undefined = undefined;

      // 1. Past-slot check: Cannot book slots in the past
      if (slotUtcStartMs <= nowMs) {
        status = 'PAST';
        isAvailable = false;
        conflictReason = 'PAST';
      }
      // 2. Booking conflict check
      else {
        const hasBookingConflict = mentorBookings.some((b) => {
          const bStart = new Date(b.start_time).getTime();
          const bEnd = new Date(b.end_time).getTime();
          return intervalsOverlap(slotUtcStartMs, slotUtcEndMs, bStart, bEnd);
        });

        if (hasBookingConflict) {
          status = 'BOOKED';
          isAvailable = false;
          conflictReason = 'BOOKING_CONFLICT';
        }
        // 3. Active-hold conflict check
        else {
          const hasHoldConflict = mentorActiveHolds.some((h) => {
            const hStart = new Date(h.start_time).getTime();
            const hEnd = new Date(h.end_time).getTime();
            return intervalsOverlap(slotUtcStartMs, slotUtcEndMs, hStart, hEnd);
          });

          if (hasHoldConflict) {
            status = 'HELD';
            isAvailable = false;
            conflictReason = 'HOLD_CONFLICT';
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
        conflict_reason: conflictReason,
      });
    }
  }

  // Sort chronologically by UTC start time
  return generatedSlots.sort(
    (a, b) => new Date(a.utc_start_time).getTime() - new Date(b.utc_start_time).getTime()
  );
}
