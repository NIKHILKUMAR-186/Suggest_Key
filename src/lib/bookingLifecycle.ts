/**
 * The booking lifecycle bucket a booking belongs in RIGHT NOW.
 *
 * `bookings.status` cannot express "the mentor has not supplied a meeting link
 * and the deadline for doing so has passed". That is a real, distinct
 * operational state - the booking is no longer a routine pending confirmation,
 * but it is emphatically NOT cancelled either - and the database has no status
 * for it. Inventing one would duplicate state that is fully derivable from
 * `status`, `meeting_url` and the clock.
 *
 * So OVERDUE is DERIVED, never persisted, and it is derived in exactly one
 * place: this module. Every server endpoint stamps the result onto the row it
 * returns, and every client groups on the stamped value. A browser therefore
 * never decides whether a deadline has expired - moving the local clock back
 * changes nothing, because the bucket that drives the tabs was computed by the
 * server.
 *
 * The deadline rule itself is unchanged from phase 8: `start_time -
 * MEETING_LINK_DEADLINE_MS`, measured on absolute instants so it is independent
 * of any display timezone. What is new is that the answer now has a name, and
 * that the three divergent overdue predicates this repository used to carry
 * (`server.ts` overdue-links, the admin ledger, and `calculateMeetingLinkDeadline`)
 * now call this one function instead.
 */

import { APP_CONFIG } from '@/src/config/app';

/**
 * The buckets the mentor ledger renders, plus the two pre-payment states a
 * mentor ledger never groups.
 *
 * `AWAITING_PAYMENT` / `AWAITING_VERIFICATION` are listed explicitly rather than
 * collapsed, so a booking the mentor cannot act on is still *classified* rather
 * than silently dropped from the projection. Note `PAYMENT_PROCESSING` is a
 * valid `bookings.status` in the database even though the TypeScript union does
 * not yet list it; it is grouped as awaiting-payment here rather than treated
 * as an unknown status.
 */
export type BookingLifecycleBucket =
  | 'AWAITING_PAYMENT'
  | 'AWAITING_VERIFICATION'
  | 'PENDING_CONFIRMATION'
  | 'OVERDUE'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'CANCELLED';

export interface BookingLifecycle {
  bucket: BookingLifecycleBucket;
  /**
   * `start_time - MEETING_LINK_DEADLINE_MS`, or null when the booking has no
   * parseable start (a corrupt row must not be presented as "on time").
   */
  meetingLinkDeadlineUtc: string | null;
  /** Server-computed. Never recomputed on the client. */
  isOverdue: boolean;
  /**
   * Server-computed milliseconds past the deadline, 0 when not overdue. The UI
   * renders this as the "Overdue by" duration, so the number shown is the one
   * the server measured rather than one a manipulated local clock produced.
   */
  overdueByMs: number;
  /**
   * Server-computed. True once the session start instant has passed, which
   * changes what an overdue booking can honestly be resolved into: adding a
   * meeting link for a session already under way is no longer meaningful.
   */
  sessionStarted: boolean;
  /** True only while the booking is still inside its confirmation window. */
  canAddMeetingLink: boolean;
  /** The bucket groups the tab; this is the raw database status behind it. */
  status: string;
}

/**
 * The minimal shape the resolver needs. A joined booking row, a bare row, or a
 * database payload all satisfy it, so every endpoint can call it without
 * normalising first.
 */
export type BookingLifecycleInput = {
  status: string;
  start_time: string | null;
  end_time: string | null;
  meeting_url?: string | null;
  actual_ended_at?: string | null;
};

/** Statuses that end the booking. A closed booking is never overdue. */
function isTerminalCancelled(status: string): boolean {
  return status === 'CANCELLED' || status === 'REJECTED';
}

function parseMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Classifies one booking against the server clock.
 *
 * `nowMs` MUST be a server clock reading. Passing `Date.now()` from a browser is
 * the exact failure this module exists to prevent, so every call site passes
 * the request's own sampled `now`.
 *
 * Precedence, and why each step is where it is:
 *
 *   1. CANCELLED / REJECTED      -> CANCELLED. A cancelled booking is not late,
 *      it is finished. This ordering also guarantees a cancelled booking never
 *      appears in Overdue, which is the whole of requirement 10.
 *
 *   2. COMPLETED / manually ended -> COMPLETED. Both are recorded terminal
 *      facts, so they outrank the deadline.
 *
 *   3. MENTOR_PENDING            -> PENDING_CONFIRMATION or OVERDUE. This
 *      deliberately comes BEFORE the elapsed-window check: a MENTOR_PENDING
 *      row is never reconciled to COMPLETED (only CONFIRMED rows are), so a
 *      session that started without a link stays the mentor's problem rather
 *      than being silently filed as delivered. This also matches the existing
 *      admin exception centre, which reports "Session reached without a meeting
 *      link" as an overdue exception.
 *
 *   4. elapsed window            -> COMPLETED. A CONFIRMED row whose `end_time`
 *      has passed is reconciled by the caller first; this is the read-side
 *      backstop so a stale row can never render as joinable.
 *
 *   5. CONFIRMED                 -> CONFIRMED.
 *
 *   6. anything else             -> its pre-payment bucket. Money has not
 *      moved, so the mentor has nothing to be late for.
 */
export function resolveBookingLifecycle(
  booking: BookingLifecycleInput,
  nowMs: number = Date.now(),
): BookingLifecycle {
  const status = String(booking.status ?? '');
  const startMs = parseMs(booking.start_time);
  const endMs = parseMs(booking.end_time);
  const hasMeetingUrl =
    typeof booking.meeting_url === 'string' && booking.meeting_url.trim() !== '';
  const manuallyEnded = parseMs(booking.actual_ended_at) !== null;
  const sessionStarted = startMs === null ? false : nowMs >= startMs;

  const deadlineMs =
    startMs === null ? null : startMs - APP_CONFIG.MEETING_LINK_DEADLINE_MS;
  const meetingLinkDeadlineUtc =
    deadlineMs === null ? null : new Date(deadlineMs).toISOString();

  const base = { meetingLinkDeadlineUtc, status, sessionStarted };

  // 1. Closed bookings.
  if (isTerminalCancelled(status)) {
    return { ...base, bucket: 'CANCELLED', isOverdue: false, overdueByMs: 0, canAddMeetingLink: false };
  }

  // 2. Recorded terminal facts.
  if (status === 'COMPLETED' || manuallyEnded) {
    return { ...base, bucket: 'COMPLETED', isOverdue: false, overdueByMs: 0, canAddMeetingLink: false };
  }

  // 3. The mentor's action queue.
  if (status === 'MENTOR_PENDING') {
    // A link already on the row means the booking is no longer waiting on
    // anything, whatever `status` still says. Treating it as overdue would
    // present a booking with a working link as broken.
    if (hasMeetingUrl) {
      return {
        ...base,
        bucket: 'PENDING_CONFIRMATION',
        isOverdue: false,
        overdueByMs: 0,
        canAddMeetingLink: true,
      };
    }

    // Strict `>`: at exactly `start - deadline` the window is still open. This
    // is the boundary `tests/meetingLinkDeadline.test.ts` already pins, and it
    // matches the T-5 access window the rest of the product uses
    // (`nowMs >= start - SESSION_ACCESS_WINDOW_MS`). One millisecond later the
    // deadline has arrived.
    const isOverdue = deadlineMs !== null && nowMs > deadlineMs;

    return {
      ...base,
      bucket: isOverdue ? 'OVERDUE' : 'PENDING_CONFIRMATION',
      isOverdue,
      overdueByMs: isOverdue && deadlineMs !== null ? nowMs - deadlineMs : 0,
      canAddMeetingLink: true,
    };
  }

  // 4. Elapsed session window.
  if (endMs !== null && nowMs >= endMs) {
    return { ...base, bucket: 'COMPLETED', isOverdue: false, overdueByMs: 0, canAddMeetingLink: false };
  }

  // 5. Confirmed and still ahead.
  if (status === 'CONFIRMED') {
    return { ...base, bucket: 'CONFIRMED', isOverdue: false, overdueByMs: 0, canAddMeetingLink: false };
  }

  // 6. Money has not moved. Not the mentor's action, so not overdue.
  const bucket: BookingLifecycleBucket =
    status === 'PENDING_VERIFICATION' ? 'AWAITING_VERIFICATION' : 'AWAITING_PAYMENT';

  return { ...base, bucket, isOverdue: false, overdueByMs: 0, canAddMeetingLink: false };
}

/** The mentor ledger's five sections, in the order the tabs render them. */
export const MENTOR_BOOKING_TABS = [
  'pending',
  'upcoming',
  'overdue',
  'completed',
  'cancelled',
] as const;

export type MentorBookingTab = (typeof MENTOR_BOOKING_TABS)[number];

/**
 * Maps a bucket onto the tab it belongs in.
 *
 * `AWAITING_PAYMENT` / `AWAITING_VERIFICATION` return null: they are not
 * mentor-actionable, so they appear in no tab. That matches the previous
 * behaviour (the page filtered on `MENTOR_PENDING`), so no booking silently
 * appears somewhere it did not before.
 */
export function bucketToMentorTab(bucket: BookingLifecycleBucket): MentorBookingTab | null {
  switch (bucket) {
    case 'PENDING_CONFIRMATION':
      return 'pending';
    case 'OVERDUE':
      return 'overdue';
    case 'CONFIRMED':
      return 'upcoming';
    case 'COMPLETED':
      return 'completed';
    case 'CANCELLED':
      return 'cancelled';
    default:
      return null;
  }
}

/**
 * Whether a confirmation request is still inside its window, evaluated against
 * a SERVER clock reading.
 *
 * This answers "did the mentor submit inside the window?", NOT "may they still
 * submit?". Those are different questions and the existing product rule makes
 * them different on purpose: `docs/rules.md` M4 records that `MENTOR_PENDING`
 * "has no timer" and "nothing in code moves it automatically", and phase 8
 * states that a missed meeting-link deadline "never cancels the booking". A
 * mentor who supplies a valid HTTPS link late is therefore still allowed to
 * confirm, because refusing would strand a paid seeker with no room - and the
 * lateness is recorded for audit instead.
 *
 * What this DOES guarantee is that the answer comes from the server's `now`, so
 * a browser with a rewound clock gains nothing and cannot extend its own window.
 */
export function isMeetingLinkDeadlineOpen(
  booking: Pick<BookingLifecycleInput, 'start_time'>,
  nowMs: number = Date.now(),
): boolean {
  const startMs = parseMs(booking.start_time);
  if (startMs === null) return false;
  return nowMs <= startMs - APP_CONFIG.MEETING_LINK_DEADLINE_MS;
}

/** Server-relative label for how long a booking has been overdue. */
export function formatOverdueDuration(overdueByMs: number): string {
  if (!Number.isFinite(overdueByMs) || overdueByMs <= 0) return 'less than a minute';
  const totalMinutes = Math.floor(overdueByMs / 60_000);
  if (totalMinutes < 60) {
    return `${totalMinutes} minute${totalMinutes === 1 ? '' : 's'}`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days} day${days === 1 ? '' : 's'}`;
}