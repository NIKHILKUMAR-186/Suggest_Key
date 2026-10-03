import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '@/src/lib/apiClient';
import { logSanitizer } from '@/src/lib/logSanitizer';
import {
  UNKNOWN_LIMIT_STATE,
  cooldownMsRemaining,
  deriveEmailVerificationPhase,
  parseEmailVerificationLimit,
  serverClockOffsetMs,
  type EmailVerificationLimitState,
  type EmailVerificationPhase,
} from '@/src/lib/emailVerificationLimit';

/** How often the visible countdown redraws. Matches the "updates every second" requirement. */
const TICK_MS = 1000;

const RATE_LIMIT_PATH = '/api/auth/email-verification/rate-limit';
const ATTEMPT_PATH = '/api/auth/email-verification/attempt';
const OUTCOME_PATH = '/api/auth/email-verification/outcome';

export interface UseEmailVerificationLimit {
  /** Collapsed phase for rendering. */
  phase: EmailVerificationPhase;
  /** Milliseconds left on the cooldown, `null` when there is no deadline. */
  msRemaining: number | null;
  /** Read the budget without spending an attempt. Safe to call repeatedly. */
  refresh: (email: string) => Promise<void>;
  /**
   * Ask the server whether one more verification email may be attempted.
   * Returns `false` when the server refused; the caller must then NOT send.
   */
  requestAttempt: (email: string) => Promise<boolean>;
  /** Report what the provider did with the send, so a refusal gets a real deadline. */
  reportOutcome: (email: string, outcome: 'sent' | 'rate_limited' | 'failed') => Promise<void>;
}

/**
 * Keeps verification-email rate-limit state in step with the server.
 *
 * Three properties this hook exists to guarantee:
 *
 * 1. **The server is the only source of truth.** Every number it exposes came
 *    back from `/api/auth/email-verification/*` in this session. There is no
 *    local attempt tally to drift and nothing is persisted, so a refresh or a
 *    second tab re-reads the ledger instead of resuming from a stale value.
 * 2. **Countdown expiry is not permission.** Reaching 00:00 clears the blocked
 *    presentation and re-enables the button, but it never sends anything: the
 *    next submit still asks `requestAttempt`, and Supabase Auth still validates.
 * 3. **Never render a fabricated count.** A failed request, a malformed payload
 *    or a ledger outage all resolve to the `unknown` phase, which renders nothing.
 *
 * `email` is passed in rather than handed over per-call so that changing the
 * address discards the previous address's state instead of carrying a count
 * across, and so countdown expiry can re-read the ledger without a registration
 * dance.
 *
 * The tick only runs while a countdown is actually on screen, so a page the user
 * is simply filling in does not re-render once a second forever.
 */
export function useEmailVerificationLimit(email: string): UseEmailVerificationLimit {
  const [state, setState] = useState<EmailVerificationLimitState>(UNKNOWN_LIMIT_STATE);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // The skew correction is captured once per response, not per tick, so a clock
  // adjustment mid-countdown cannot make the seconds jump around.
  const offsetRef = useRef(0);
  const retryAtRef = useRef<string | null>(null);
  const normalizedEmail = email.trim();

  const applyState = useCallback((next: EmailVerificationLimitState) => {
    offsetRef.current = serverClockOffsetMs(next.serverNow, Date.now());
    retryAtRef.current = next.retryAt;
    setState(next);
    setNowMs(Date.now());
  }, []);

  const request = useCallback(
    async (path: string, init?: RequestInit): Promise<EmailVerificationLimitState> => {
      try {
        const response = await apiFetch(path, init);
        // Both the 200 and the 429 carry `rateLimit`. A response without it means
        // the server could not tell us anything, which is `unknown`, not `ok`.
        const body = (await response.json().catch(() => null)) as
          | { rateLimit?: unknown }
          | null;
        const parsed = parseEmailVerificationLimit(body?.rateLimit);
        if (!response.ok && parsed.allowed !== false) return UNKNOWN_LIMIT_STATE;
        return parsed;
      } catch (error) {
        console.error('[email-rate-limit] request failed:', logSanitizer.safeMessage(error));
        return UNKNOWN_LIMIT_STATE;
      }
    },
    [],
  );

  const refresh = useCallback(
    async (target: string) => {
      const normalized = target.trim();
      if (!normalized) return;
      applyState(await request(`${RATE_LIMIT_PATH}?email=${encodeURIComponent(normalized)}`));
    },
    [applyState, request],
  );

  const requestAttempt = useCallback(
    async (target: string) => {
      const next = await request(ATTEMPT_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: target.trim() }),
      });
      applyState(next);
      // `allowed === null` is a ledger outage, not a refusal. Supabase Auth still
      // validates the request in that case, so refusing here would only lock a
      // legitimate mentor out during a database incident.
      return next.allowed !== false;
    },
    [applyState, request],
  );

  const reportOutcome = useCallback(
    async (target: string, outcome: 'sent' | 'rate_limited' | 'failed') => {
      applyState(
        await request(OUTCOME_PATH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: target.trim(), outcome }),
        }),
      );
    },
    [applyState, request],
  );

  const msRemaining = useMemo(
    () => cooldownMsRemaining(retryAtRef.current, offsetRef.current, nowMs),
    // `state.retryAt` is a dependency alongside the ref read because the ref is
    // not reactive on its own: without it a newly arrived deadline would leave
    // the memo showing the previous one's arithmetic.
    [state.retryAt, nowMs],
  );

  const phase = useMemo(
    () => deriveEmailVerificationPhase(state, msRemaining),
    [state, msRemaining],
  );

  const countdownLive = phase.kind === 'cooldown';

  useEffect(() => {
    if (!countdownLive) return;
    // Re-anchor immediately so the first painted second is not stale, then tick.
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [countdownLive]);

  // The expiry latch is separate from the address-change reset, deliberately.
  // Conflating them silently disables the expiry re-read: both effects want to
  // ask "have I already handled this address?", but only the reset is allowed to
  // clear the latch.
  const expiryHandledRef = useRef<string | null>(null);

  useEffect(() => {
    // A different address must never inherit the previous one's budget. Wiping
    // the state also re-arms the expiry latch, so a second cooldown for the same
    // address is followed once it expires too.
    expiryHandledRef.current = null;
    offsetRef.current = 0;
    retryAtRef.current = null;
    setState(UNKNOWN_LIMIT_STATE);
  }, [normalizedEmail]);

  useEffect(() => {
    if (phase.kind !== 'ready' || !normalizedEmail) return;
    if (expiryHandledRef.current === normalizedEmail) return;
    expiryHandledRef.current = normalizedEmail;
    // The countdown is over, but "over" is not "allowed": re-read the ledger so
    // the count shown next to the form comes from the server rather than from a
    // subtraction this tab performed. Whatever comes back decides what happens
    // next - including the possibility that it is blocked again.
    void refresh(normalizedEmail);
  }, [phase.kind, normalizedEmail, refresh]);

  return useMemo(
    () => ({ phase, msRemaining, refresh, requestAttempt, reportOutcome }),
    [phase, msRemaining, refresh, requestAttempt, reportOutcome],
  );
}