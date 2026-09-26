import { APP_CONFIG } from '@/src/config/app';

/**
 * Session-access helpers that are pure functions of their inputs.
 *
 * These live outside `server.ts` so they can be unit-tested without booting an
 * HTTP listener, and so the rules they encode have exactly one definition. The
 * authoritative time gate itself stays in `validateSessionAccess`
 * (`src/lib/bookingEngine.ts`); what lives here is the projection rule that the
 * T-5 gate implies for every OTHER endpoint that happens to return a booking row.
 */

export const SESSION_ACCESS_WINDOW_MS = APP_CONFIG.SESSION_ACCESS_WINDOW_MS;

/**
 * `bookings.id` is a UUID and `bookings.booking_code` is a short opaque code.
 * Both are used to build equality filters, so a path segment has to be
 * shape-checked before it reaches PostgREST.
 *
 * This is what stops `.or('id.eq.' + bookingId)` from becoming a filter
 * injection: a caller passing `x,id.neq.00000000-0000-0000-0000-000000000000`
 * would otherwise append a second clause to the `or` group and widen the
 * result set.
 *
 * The UUID check is shape-only, not version-strict, because the seeded platform
 * rows use nil-prefixed ids that an RFC-4122 version check would reject.
 */
const BOOKING_ID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const BOOKING_CODE_PATTERN = /^[A-Za-z0-9_-]{4,40}$/;

export function isBookingIdShape(value: unknown): boolean {
  return typeof value === 'string' && BOOKING_ID_PATTERN.test(value);
}

export function isBookingCodeShape(value: unknown): boolean {
  return typeof value === 'string' && BOOKING_CODE_PATTERN.test(value);
}

/** True when the value is safe to interpolate into an equality filter. */
export function isSafeBookingIdentifier(value: unknown): value is string {
  return isBookingIdShape(value) || isBookingCodeShape(value);
}

export interface MeetingUrlCarrier {
  start_time?: string | null;
  end_time?: string | null;
  meeting_url?: string | null;
}

/**
 * Whether the server clock is inside the window in which the meeting link may
 * be released to a participant:
 *
 *   now < start - 5m            -> false
 *   start - 5m <= now < end    -> true
 *   now >= end                 -> false
 */
export function isInsideSessionAccessWindow(
  booking: Pick<MeetingUrlCarrier, 'start_time' | 'end_time'>,
  now: Date = new Date()
): boolean {
  const nowMs = now.getTime();
  const startMs = new Date(booking.start_time ?? '').getTime();
  const endMs = new Date(booking.end_time ?? '').getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
  return nowMs >= startMs - SESSION_ACCESS_WINDOW_MS && nowMs < endMs;
}

/**
 * Removes `meeting_url` from a booking projection that is being returned to a
 * participant outside the access window.
 *
 * `bookings.meeting_url` was returned verbatim by `GET /api/seeker/bookings` and
 * `GET /api/seeker/bookings/:id`, which made the T-5 gate on
 * `POST /api/sessions/:bookingId/join` decorative: the link was readable from
 * the bookings list at any hour. `validateSessionAccess` already states the
 * rule - "strictly null unless in T5_WINDOW or IN_PROGRESS" - and this applies
 * the same rule to the projections, so the link has exactly one door.
 *
 * Admins keep full visibility for operational support, and the mentor is never
 * redacted because the mentor is the party that supplies the URL.
 */
export function redactMeetingUrlForParticipant<
  T extends MeetingUrlCarrier,
>(booking: T, options: { isAdmin: boolean; isMentor: boolean; now?: Date }): T {
  if (options.isAdmin || options.isMentor) return booking;
  if (!booking.meeting_url) return booking;
  if (isInsideSessionAccessWindow(booking, options.now)) return booking;
  return { ...booking, meeting_url: null };
}
