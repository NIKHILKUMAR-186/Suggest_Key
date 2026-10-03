/**
 * Client-side derivation of verification-email rate-limit state.
 *
 * Everything here is pure arithmetic over a payload the server produced. There is
 * no local counter, no cached "attempts made" tally and no fallback cooldown
 * duration anywhere in this file, because all three would be client state that a
 * refresh, a second tab or a tampered request could disagree with. The server
 * owns the numbers; this file only turns them into text.
 *
 * The wire shape is intentionally narrow (`allowed`, `remaining`, `retryAt`,
 * `serverNow`) and carries nothing about how the limit is implemented, so there
 * is nothing sensitive to leak by rendering it.
 */

export interface EmailVerificationLimitState {
  /** `null` means the server could not determine the state. */
  allowed: boolean | null;
  /** Attempts left in the current window, or `null` when unknown. */
  remaining: number | null;
  /** Server-authoritative instant a retry is permitted. `null` = no deadline known. */
  retryAt: string | null;
  /** Server clock reading at the moment of the response, for skew correction. */
  serverNow: string | null;
}

/** The only state we cannot describe. Never render a number for it. */
export const UNKNOWN_LIMIT_STATE: EmailVerificationLimitState = {
  allowed: null,
  remaining: null,
  retryAt: null,
  serverNow: null,
};

/**
 * At or below this many remaining attempts the UI starts warning.
 *
 * Shown near the email field while the action is still enabled, so the user can
 * slow down before the send is refused rather than discovering it afterwards.
 */
export const EMAIL_VERIFICATION_WARNING_THRESHOLD = 2;

export type EmailVerificationPhase =
  /** Ledger unreachable: say nothing at all, and let the attempt proceed. */
  | { kind: 'unknown' }
  /** Comfortable headroom. */
  | { kind: 'available'; remaining: number }
  /** Approaching the limit; the action stays enabled. */
  | { kind: 'warning'; remaining: number }
  /** Blocked, with a server deadline we can count down to. */
  | { kind: 'cooldown'; retryAt: string }
  /** Blocked, but the server offered no deadline we can show. */
  | { kind: 'blocked' }
  /** The countdown reached zero. The action unlocks; the server still decides. */
  | { kind: 'ready' };

/**
 * Parse a server payload into state, discarding anything untrustworthy.
 *
 * A response that is missing, non-object, or carrying a non-integer / negative
 * count collapses to `unknown` rather than being partially believed. Showing "0
 * attempts remaining" from a malformed payload is exactly the fabricated count
 * this feature is required never to produce.
 */
export function parseEmailVerificationLimit(payload: unknown): EmailVerificationLimitState {
  if (!payload || typeof payload !== 'object') return UNKNOWN_LIMIT_STATE;
  const raw = payload as Record<string, unknown>;

  if (typeof raw.allowed !== 'boolean') return UNKNOWN_LIMIT_STATE;

  const remaining =
    typeof raw.remaining === 'number' && Number.isInteger(raw.remaining) && raw.remaining >= 0
      ? raw.remaining
      : null;
  if (remaining === null) return UNKNOWN_LIMIT_STATE;

  const retryAt =
    typeof raw.retryAt === 'string' && !Number.isNaN(Date.parse(raw.retryAt)) ? raw.retryAt : null;

  return {
    allowed: raw.allowed,
    remaining,
    retryAt,
    serverNow: typeof raw.serverNow === 'string' ? raw.serverNow : null,
  };
}

/**
 * How far the client's clock is behind the server's, in milliseconds.
 *
 * The countdown is anchored to a server instant, so it has to be measured
 * against the server's clock too. Without this, a device five minutes fast would
 * jump straight to 00:00 and unlock the button early - and since the client is
 * never the authority on whether a request is allowed, an early unlock is at
 * best a wasted round trip and at worst looks like a bypass.
 *
 * Measured once per response rather than per tick, because a clock that jumps
 * mid-countdown would make the seconds stutter.
 */
export function serverClockOffsetMs(serverNow: string | null, localNowMs: number): number {
  if (!serverNow) return 0;
  const serverMs = Date.parse(serverNow);
  if (Number.isNaN(serverMs)) return 0;
  return serverMs - localNowMs;
}

/** Milliseconds left on the cooldown, measured on the server's clock. Never negative. */
export function cooldownMsRemaining(
  retryAt: string | null,
  offsetMs: number,
  nowMs: number,
): number | null {
  if (!retryAt) return null;
  const expiryMs = Date.parse(retryAt);
  if (Number.isNaN(expiryMs)) return null;
  return Math.max(0, expiryMs - (nowMs + offsetMs));
}

/**
 * `MM:SS` for the countdown. Clamped at zero so an expired cooldown reads
 * `00:00` rather than a negative minute field.
 *
 * Deliberately its own three-line implementation rather than an import of
 * `bookingService.formatCountdown`: that one is un-clamped (a negative input
 * renders `-1:-1`) and lives in the booking surface, which has no business being
 * a dependency of the auth flow.
 */
export function formatEmailVerificationCountdown(msRemaining: number): string {
  const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Collapse server state plus the ticking clock into the one phase the page renders.
 *
 * `msRemaining` is only consulted when a deadline exists. `ready` means the
 * displayed cooldown elapsed - it is deliberately not the same as "allowed": the
 * button unlocks, but the next attempt still goes through the server gate and
 * then Supabase Auth.
 */
export function deriveEmailVerificationPhase(
  state: EmailVerificationLimitState,
  msRemaining: number | null,
): EmailVerificationPhase {
  if (state.allowed === null) return { kind: 'unknown' };

  if (state.allowed === false) {
    if (!state.retryAt) return { kind: 'blocked' };
    // A deadline in the past is a stale read, not an active cooldown. Reporting
    // it as `ready` is what lets a page left open overnight recover on its own.
    if (msRemaining !== null && msRemaining <= 0) return { kind: 'ready' };
    return { kind: 'cooldown', retryAt: state.retryAt };
  }

  if (state.remaining !== null && state.remaining <= EMAIL_VERIFICATION_WARNING_THRESHOLD) {
    return { kind: 'warning', remaining: state.remaining };
  }

  return {
    kind: 'available',
    remaining: state.remaining ?? EMAIL_VERIFICATION_WARNING_THRESHOLD + 1,
  };
}

/** The action must be disabled while the gate is refusing, or while a send is in flight. */
export function isEmailVerificationActionBlocked(phase: EmailVerificationPhase): boolean {
  return phase.kind === 'cooldown' || phase.kind === 'blocked';
}

/** `"1 email verification attempt remaining"` / `"2 email verification attempts remaining"`. */
export function describeAttemptsRemaining(remaining: number): string {
  return remaining === 1
    ? '1 email verification attempt remaining'
    : `${remaining} email verification attempts remaining`;
}

/**
 * What a screen reader hears instead of the ticking digits.
 *
 * Announced at minute granularity rather than every second: a live region whose
 * text changes once a second is unusable, and by the time the last minute starts
 * a whole-minute reading would be "0 minutes", so the seconds are spoken
 * directly for that final stretch. Same rule as the booking hold countdown.
 */
export function describeCountdownForAssistiveTech(msRemaining: number): string {
  const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000));
  if (totalSeconds === 0) return 'You can try again now.';
  if (totalSeconds < 60) {
    return `${totalSeconds} second${totalSeconds === 1 ? '' : 's'} remaining`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  return `About ${minutes} minute${minutes === 1 ? '' : 's'} remaining`;
}

/**
 * Wording for the case where the server refused but offered no deadline.
 *
 * Deliberately the graceful fallback rather than a guess: there is no cooldown
 * length in this file to guess with, and inventing one would be the exact defect
 * this feature set out to remove.
 */
export const BLOCKED_WITHOUT_DEADLINE_MESSAGE =
  'Too many email verification attempts. Please try again later.';