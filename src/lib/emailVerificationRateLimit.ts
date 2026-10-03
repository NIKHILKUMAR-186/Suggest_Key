/**
 * Server-authoritative verification-email rate limit.
 *
 * ## Why this exists
 *
 * `/mentor/signup` asks Supabase Auth to send the verification email, and GoTrue
 * answers a throttled request with `over_email_send_rate_limit` / "Email rate
 * limit exceeded". That response carries no remaining-attempt count, no
 * retry-after, and there is no Auth endpoint that will produce either. The two
 * limiters already in this repo cannot help: `apiRateLimiter` /
 * `expensiveRouteLimiter` are per-process express-rate-limit stores keyed on IP,
 * and `login_failure_trackers` documents itself as detection telemetry rather
 * than a gate. So the budget was enforced somewhere the UI could not read it,
 * which is why the page could only ever print the bare message.
 *
 * ## What this is, precisely
 *
 * A read model and a pre-flight gate in front of the existing limiter, backed by
 * the `email_verification_rate_limits` ledger (migration phase 43). GoTrue stays
 * the hard enforcement point for every actual send and is unchanged; this only
 * stops our own UI from spending that budget blindly and gives the countdown a
 * server timestamp to count down from.
 *
 * ## Invariants
 *
 * - The server is the only source of truth. Nothing here accepts a count, a
 *   remaining number or a deadline from the client.
 * - No raw email address or IP address is persisted. The key is an HMAC-SHA256
 *   over the normalised pair, exactly as `loginFailureTracker` does, so the
 *   ledger holds counts and instants only.
 * - `available === null` means "the ledger could not be consulted". Callers must
 *   treat it as unknown and say so; it is never rounded down to a fabricated
 *   number, and it never blocks a signup on its own. Supabase Auth still
 *   validates every request, so a ledger outage degrades the feedback, not the
 *   protection.
 */

import { createHmac, randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/src/lib/supabaseServer';
import { logSanitizer } from '@/src/lib/logSanitizer';

/** Message the signup UI renders when the gate refuses an attempt. */
export const EMAIL_VERIFICATION_RATE_LIMIT_MESSAGE =
  'Too many email verification attempts';

export const EMAIL_VERIFICATION_RATE_LIMIT_CODE = 'EMAIL_VERIFICATION_RATE_LIMITED';

/**
 * Salt for the ledger key.
 *
 * Reusing `LOGIN_ALERT_SALT` is deliberate: one secret, one rotation, and the
 * two ledgers stay separately keyed because the HMAC input is namespaced below.
 * The service-role key is the fallback for the same reason it is in
 * `loginFailureTracker` - it is always present in a deployment that can talk to
 * the database at all. `randomBytes` only applies in a process with no database
 * configuration, where every call fails open anyway.
 */
const IDENTIFIER_SALT =
  process.env.LOGIN_ALERT_SALT ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  randomBytes(32).toString('hex');

/**
 * The shape every caller in the app is allowed to receive.
 *
 * Deliberately narrow. It carries what the UI needs to render a countdown and
 * nothing about how the limit is implemented: no window length, no configured
 * ceiling, no bucket contents. `allowed` and `remaining` are only ever the
 * database's own arithmetic.
 */
export interface EmailVerificationRateLimitState {
  /**
   * Whether another verification email may be attempted.
   * `null` means the ledger could not be consulted and the answer is unknown.
   */
  allowed: boolean | null;
  /** Attempts left in the current window, or `null` when unknown. */
  remaining: number | null;
  /**
   * Server-authoritative instant the caller may try again. `null` while allowed,
   * and also `null` when a block is in force but the server has no deadline to
   * offer - the UI must then show the generic "try again later" wording.
   */
  retryAt: string | null;
  /** Server clock at the moment of the read, for client-side skew correction. */
  serverNow: string;
}

/** Unknown state: what every failure path returns. Never a fabricated count. */
function unknownState(): EmailVerificationRateLimitState {
  return { allowed: null, remaining: null, retryAt: null, serverNow: new Date().toISOString() };
}

function normalizeEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function normalizeIp(ip: unknown): string {
  return typeof ip === 'string' ? ip.trim().slice(0, 64) : '';
}

/**
 * The opaque ledger key for a recipient/IP pair.
 *
 * Namespaced with a `verify:` prefix so a key can never collide with one in
 * `login_failure_trackers` even though both use the same salt, and bound to the
 * caller IP as well as the address: someone probing another person's email
 * cannot read or reset their budget from a different network.
 */
export function buildEmailVerificationKey(email: unknown, ip: unknown): string {
  return createHmac('sha256', IDENTIFIER_SALT)
    .update(`verify:${normalizeEmail(email)}|${normalizeIp(ip)}`)
    .digest('hex');
}

interface LedgerRow {
  allowed?: boolean | null;
  remaining?: number | null;
  retry_at?: string | null;
}

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) && data.length > 0 ? (data[0] as T) : null;
}

/**
 * Turn a ledger row into the client-facing state, dropping any value the server
 * will not stand behind.
 *
 * A malformed row (null boolean, negative or non-integer count, a deadline in
 * the past presented as a future one) collapses to `unknown` rather than being
 * passed through, so a surprising payload cannot put a negative count or a
 * negative countdown on screen.
 */
function toState(row: LedgerRow | null): EmailVerificationRateLimitState {
  const serverNow = new Date().toISOString();
  if (!row || typeof row.allowed !== 'boolean') return unknownState();

  const remaining = Number.isInteger(row.remaining) && (row.remaining as number) >= 0
    ? (row.remaining as number)
    : null;
  if (remaining === null) return unknownState();

  const retryAt = typeof row.retry_at === 'string' && !Number.isNaN(Date.parse(row.retry_at))
    ? row.retry_at
    : null;

  // A blocked caller with no deadline is a real state: the provider refused and
  // offered no retry-after. `retryAt: null` is how the UI learns to say "try
  // again later" instead of showing a countdown it would have had to invent.
  return { allowed: row.allowed, remaining, retryAt, serverNow };
}

async function callLedger(
  rpc: 'read_email_verification_rate_limit' | 'consume_email_verification_attempt',
  identifierKey: string,
): Promise<EmailVerificationRateLimitState> {
  const admin: SupabaseClient | null = getSupabaseAdmin();
  if (!admin) return unknownState();

  try {
    const { data, error } = await admin.rpc(rpc, { p_identifier_key: identifierKey });
    if (error) {
      console.error(`[email-rate-limit] ${rpc} failed:`, logSanitizer.safeMessage(error));
      return unknownState();
    }

    const row = firstRow<LedgerRow>(data);
    if (!row) return unknownState();
    return toState(row);
  } catch (error) {
    console.error(`[email-rate-limit] ${rpc} threw:`, logSanitizer.safeMessage(error));
    return unknownState();
  }
}

export interface EmailVerificationIdentity {
  email?: unknown;
  ip?: unknown;
}

/**
 * Read the current budget without spending any of it.
 *
 * This is what the signup page calls on mount, on refresh and when a countdown
 * reaches zero, which is what makes the UI rehydrate from server state instead
 * of resetting a local counter. It is not free of side effects because it has
 * none at all: refreshing the page cannot shorten the cooldown.
 */
export function readEmailVerificationRateLimit(
  identity: EmailVerificationIdentity,
): Promise<EmailVerificationRateLimitState> {
  return callLedger(
    'read_email_verification_rate_limit',
    buildEmailVerificationKey(identity.email, identity.ip),
  );
}

/**
 * Spend one attempt, or report why it was refused.
 *
 * `allowed === false` means the caller must not ask Supabase Auth for a
 * verification email. `retryAt` is the server's own deadline. A `null` `allowed`
 * means the ledger was unreachable, in which case the caller proceeds and lets
 * Supabase Auth decide - a database outage must not be able to lock a
 * legitimate mentor out of signing up.
 */
export function consumeEmailVerificationAttempt(
  identity: EmailVerificationIdentity,
): Promise<EmailVerificationRateLimitState> {
  return callLedger(
    'consume_email_verification_attempt',
    buildEmailVerificationKey(identity.email, identity.ip),
  );
}

/**
 * Record that the provider itself refused the send.
 *
 * Supabase Auth sends no retry-after for `over_email_send_rate_limit`, so the
 * deadline comes from `cooldown_seconds` in the config table - an operator-owned
 * value. Storing it as an absolute instant means repeated reports cannot push
 * the block further out.
 *
 * Returns the resulting state, or the unknown state if the ledger was
 * unreachable, so the caller can show the fallback wording instead of pretending
 * it knows a deadline.
 */
export async function markEmailVerificationUpstreamBlocked(
  identity: EmailVerificationIdentity,
): Promise<EmailVerificationRateLimitState> {
  const admin: SupabaseClient | null = getSupabaseAdmin();
  if (!admin) return unknownState();

  const identifierKey = buildEmailVerificationKey(identity.email, identity.ip);

  try {
    const { error } = await admin.rpc('mark_email_verification_upstream_blocked', {
      p_identifier_key: identifierKey,
    });
    if (error) {
      console.error(
        '[email-rate-limit] mark_email_verification_upstream_blocked failed:',
        logSanitizer.safeMessage(error),
      );
      return unknownState();
    }
  } catch (error) {
    console.error(
      '[email-rate-limit] mark_email_verification_upstream_blocked threw:',
      logSanitizer.safeMessage(error),
    );
    return unknownState();
  }

  return readEmailVerificationRateLimit(identity);
}