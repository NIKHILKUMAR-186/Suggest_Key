import { APP_CONFIG } from '@/src/config/app';

/**
 * The one place a session's lifecycle state is derived in the browser.
 *
 * This module is a PRESENTATION mirror of the server rule
 * `public.resolve_session_state(...)` (supabase/migrations/20260927050000_phase24_session_time_authority.sql).
 * The two are deliberately identical, and `tests/session_access.test.ts` pins
 * the TypeScript side against the same matrix the SQL is verified with.
 *
 * What this module is NOT:
 *   - it is never an authorization decision. The server re-resolves the state on
 *     every join, every access read and every reconciliation;
 *   - it never reads the raw browser clock. Every function that needs "now"
 *     takes it as an argument, and the only place a real `Date.now()` enters is
 *     `useSessionSync`, which corrects it by the server offset first.
 *
 * That is what makes a wrong browser clock harmless: it can only make a
 * countdown look wrong for up to one revalidation interval, and it can never
 * unlock a meeting.
 */

/**
 * The five lifecycle states. Mirrors the SQL resolver's return values.
 *
 * - SCHEDULED    now < start - 5m  -> access DENIED
 * - ACCESS_OPEN  start - 5m <= now < start -> access ALLOWED (early arrival)
 * - IN_PROGRESS  start <= now < end -> access ALLOWED
 * - COMPLETED    now >= end, or manually ended -> access DENIED
 * - CANCELLED    status is CANCELLED / REJECTED
 */
export type SessionLifecycleState =
  | 'SCHEDULED'
  | 'ACCESS_OPEN'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';

/** The minimum shape this module needs. Avoids a dependency on the full Booking row. */
export interface LifecycleCarrier {
  status: string;
  start_time: string | null | undefined;
  end_time: string | null | undefined;
  actual_ended_at?: string | null;
}

const TERMINAL_CLOSED = new Set(['COMPLETED', 'CANCELLED', 'REJECTED']);

/** Milliseconds before `start_time` at which meeting access opens. */
export const SESSION_ACCESS_WINDOW_MS = APP_CONFIG.SESSION_ACCESS_WINDOW_MS;

function toMs(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  return new Date(value).getTime();
}

/**
 * Resolves the lifecycle state of one booking.
 *
 * `serverNowMs` must come from a server-authoritative clock. Pass
 * `useSessionSync().serverNowMs()` rather than `Date.now()`.
 *
 * Order of precedence is deliberate and must match the SQL exactly:
 *   1. a cancelled/rejected booking is CANCELLED whatever the clock says;
 *   2. an unparseable window is COMPLETED (fail closed, never "probably open");
 *   3. a manual end is COMPLETED even if end_time is still in the future;
 *   4. an elapsed end_time is COMPLETED even if the row still says CONFIRMED -
 *      this single rule is what makes a stale row harmless;
 *   5. otherwise the T-5 window decides.
 */
export function resolveSessionLifecycle(
  booking: LifecycleCarrier,
  serverNowMs: number
): SessionLifecycleState {
  if (booking.status === 'CANCELLED' || booking.status === 'REJECTED') return 'CANCELLED';

  const startMs = toMs(booking.start_time);
  const endMs = toMs(booking.end_time);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 'COMPLETED';

  if (booking.actual_ended_at) return 'COMPLETED';
  if (booking.status === 'COMPLETED') return 'COMPLETED';

  if (serverNowMs >= endMs) return 'COMPLETED';

  if (serverNowMs >= startMs - SESSION_ACCESS_WINDOW_MS) {
    return serverNowMs >= startMs ? 'IN_PROGRESS' : 'ACCESS_OPEN';
  }

  return 'SCHEDULED';
}

/**
 * Whether meeting access may be released. The single predicate every page must
 * use to decide whether to render a Join button. Kept separate from the state
 * so a state rename can never quietly change the security gate.
 */
export function isAccessGranted(state: SessionLifecycleState): boolean {
  return state === 'ACCESS_OPEN' || state === 'IN_PROGRESS';
}

/**
 * Whether a booking belongs in "Upcoming" or in "History".
 *
 * A booking is History as soon as its window has closed, regardless of the
 * stored status. This is the rule that stops an expired session from sitting in
 * Upcoming forever.
 */
export function isBookingUpcoming(
  booking: LifecycleCarrier,
  serverNowMs: number
): boolean {
  if (TERMINAL_CLOSED.has(booking.status)) return false;
  const endMs = toMs(booking.end_time);
  if (!Number.isFinite(endMs)) return false;
  return serverNowMs < endMs;
}

/** Seconds remaining until meeting access opens (T-5). Zero once it has. */
export function secondsUntilAccessOpens(
  booking: LifecycleCarrier,
  serverNowMs: number
): number {
  const startMs = toMs(booking.start_time);
  if (!Number.isFinite(startMs)) return 0;
  return Math.max(0, Math.ceil((startMs - SESSION_ACCESS_WINDOW_MS - serverNowMs) / 1000));
}

/** Seconds remaining until the session is scheduled to end. Zero once it has. */
export function secondsUntilSessionEnd(
  booking: LifecycleCarrier,
  serverNowMs: number
): number {
  const endMs = toMs(booking.end_time);
  if (!Number.isFinite(endMs)) return 0;
  return Math.max(0, Math.ceil((endMs - serverNowMs) / 1000));
}

/**
 * Seconds remaining until the session is scheduled to start.
 *
 * Distinct from `secondsUntilAccessOpens`, which counts to T-5. Both are needed:
 * before T-5 the first is what the user wants to see, and inside the window the
 * second is.
 */
export function secondsUntilSessionStart(
  booking: LifecycleCarrier,
  serverNowMs: number
): number {
  const startMs = toMs(booking.start_time);
  if (!Number.isFinite(startMs)) return 0;
  return Math.max(0, Math.ceil((startMs - serverNowMs) / 1000));
}

export interface Countdown {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** Splits a duration in seconds into a display breakdown, clamped at zero. */
export function splitDuration(totalSeconds: number): Countdown {
  const s = Math.max(0, Math.floor(totalSeconds));
  return {
    days: Math.floor(s / 86_400),
    hours: Math.floor((s % 86_400) / 3_600),
    minutes: Math.floor((s % 3_600) / 60),
    seconds: s % 60,
  };
}

/** `MM:SS`, widening to `HH:MM:SS` past an hour and `Dd HH:MM:SS` past a day. */
export function formatCountdown(totalSeconds: number): string {
  const { days, hours, minutes, seconds } = splitDuration(totalSeconds);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (days > 0) return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Formats an instant in the viewer's timezone.
 *
 * Display only. Business state is never derived from the output of this
 * function - two viewers in different zones must see the same session state.
 */
export function formatInZone(
  iso: string | null | undefined,
  timeZone: string | null | undefined,
  options: Intl.DateTimeFormatOptions
): string {
  const ms = toMs(iso);
  if (!Number.isFinite(ms)) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      ...options,
      timeZone: timeZone || undefined,
    }).format(new Date(ms));
  } catch {
    // An invalid IANA zone must not take the page down.
    return new Date(ms).toLocaleString(undefined, options);
  }
}

/** e.g. `27 Sep 2026`. */
export function formatSessionDate(iso: string | null | undefined, timeZone?: string | null): string {
  return formatInZone(iso, timeZone, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** e.g. `03:35 AM`. */
export function formatClockTime(iso: string | null | undefined, timeZone?: string | null): string {
  return formatInZone(iso, timeZone, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * A whole session window on one line, e.g. `30 Sep, 2:00 PM – 3:00 PM`.
 *
 * The date comes from the start and the end time from the end, so a window that
 * crosses a clock change or a midnight boundary still reads correctly instead
 * of repeating or dropping a day.
 */
export function formatClockRange(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
  timeZone?: string | null
): string {
  const day = formatInZone(startIso, timeZone, { day: 'numeric', month: 'short' });
  return `${day}, ${formatClockTime(startIso, timeZone)} – ${formatClockTime(endIso, timeZone)}`;
}

/** e.g. `Asia/Kolkata`, with a short offset label beside the times. */
export function formatZoneLabel(timeZone: string | null | undefined): string {
  if (!timeZone) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'short',
    }).formatToParts(new Date());
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

/** Session length in whole minutes, from the authoritative UTC window. */
export function sessionDurationMinutes(booking: LifecycleCarrier): number {
  const startMs = toMs(booking.start_time);
  const endMs = toMs(booking.end_time);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.max(0, Math.round((endMs - startMs) / 60_000));
}

/**
 * A monotonic, server-corrected clock.
 *
 * `offsetMs = serverNow - clientNow` is sampled on every revalidation, so a
 * browser whose clock is wrong by an hour still renders an accurate countdown.
 * The offset is applied to presentation only; the server remains the authority.
 */
export function serverNowFromOffset(offsetMs: number): number {
  return Date.now() + offsetMs;
}
