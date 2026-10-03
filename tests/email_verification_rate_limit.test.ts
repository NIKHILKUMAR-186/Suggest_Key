/**
 * Verification-email rate limit: the mentor signup feedback loop.
 *
 * The defect this suite exists for: `/mentor/signup` printed GoTrue's bare
 * "email rate limit exceeded" and nothing else, because `supabase.auth.signUp`
 * and `supabase.auth.resend` answer a throttled request with no remaining count
 * and no retry-after, and nothing in the repo could read that state back. So the
 * user could neither see how close they were nor how long they had to wait.
 *
 * The fix adds a server-authoritative ledger (migration phase 43), three thin
 * routes over it, and a countdown computed from the server's own deadline. That
 * combination introduces a specific set of ways to get it wrong - a counter that
 * lives in the browser, a cooldown invented in the frontend, a countdown that
 * unlocks the button and calls that permission, a screen reader re-read
 * "9 minutes remaining" sixty times - so each of those is pinned here.
 *
 * Split by what can actually be proven offline:
 *
 *   1. behaviour of the pure derivations (the countdown maths, the phase
 *      collapse, the payload validation) - real assertions on real output
 *   2. behaviour of the server module against a stubbed PostgREST transport -
 *      real assertions on the RPC name, the argument shape and every failure
 *      path
 *   3. source-level invariants for the routes, the page, the notice and the
 *      migration, which is the only way to pin "this value came from the
 *      database, not from the client" as a property
 */
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BLOCKED_WITHOUT_DEADLINE_MESSAGE,
  EMAIL_VERIFICATION_WARNING_THRESHOLD,
  UNKNOWN_LIMIT_STATE,
  cooldownMsRemaining,
  deriveEmailVerificationPhase,
  describeAttemptsRemaining,
  describeCountdownForAssistiveTech,
  formatEmailVerificationCountdown,
  isEmailVerificationActionBlocked,
  parseEmailVerificationLimit,
  serverClockOffsetMs,
  type EmailVerificationLimitState,
} from '../src/lib/emailVerificationLimit';

const REPO_ROOT = join(import.meta.dirname, '..');
const read = (p: string): string => readFileSync(join(REPO_ROOT, p), 'utf8');

/** Strips comments and string bodies so prose cannot satisfy a check. */
function code(relativePath: string): string {
  return read(relativePath)
    .replace(/\r/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

/** Just this route out of server.ts, bounded by the next route registration. */
function routeSource(routeMarker: string): string {
  const source = read('server.ts').replace(/\r/g, '');
  const start = source.indexOf(routeMarker);
  assert.ok(start > -1, `route not found in server.ts: ${routeMarker}`);
  const rest = source.slice(start + routeMarker.length);
  const next = rest.search(/\n\s*app\.(get|post|put|patch|delete)\(/);
  return next > -1
    ? source.slice(start, start + routeMarker.length + next)
    : source.slice(start);
}

const MIGRATION =
  'supabase/migrations/20261017000000_phase43_email_verification_rate_limit.sql';

// ===========================================================================
// 1. Attempt count rendering
// ===========================================================================

describe('attempts-remaining display', () => {
  const limit = (allowed: boolean, remaining: number, retryAt: string | null = null) =>
    parseEmailVerificationLimit({ allowed, remaining, retryAt, serverNow: '2026-10-03T10:00:00Z' });

  it('says "attempts" for more than one and "attempt" for exactly one', () => {
    assert.equal(describeAttemptsRemaining(2), '2 email verification attempts remaining');
    assert.equal(describeAttemptsRemaining(3), '3 email verification attempts remaining');
    assert.equal(describeAttemptsRemaining(1), '1 email verification attempt remaining');
  });

  it('stays quiet while there is comfortable headroom', () => {
    const phase = deriveEmailVerificationPhase(limit(true, 5), null);
    assert.equal(phase.kind, 'available');
  });

  it('warns at the threshold and at the final attempt, using the server count', () => {
    for (const remaining of [1, EMAIL_VERIFICATION_WARNING_THRESHOLD]) {
      const phase = deriveEmailVerificationPhase(limit(true, remaining), null);
      assert.equal(phase.kind, 'warning', `${remaining} remaining should warn`);
      if (phase.kind === 'warning') {
        assert.equal(phase.remaining, remaining);
        assert.equal(describeAttemptsRemaining(phase.remaining).startsWith(String(remaining)), true);
      }
    }
  });

  it('does not warn one attempt above the threshold', () => {
    const phase = deriveEmailVerificationPhase(
      limit(true, EMAIL_VERIFICATION_WARNING_THRESHOLD + 1),
      null,
    );
    assert.equal(phase.kind, 'available');
  });

  it('leaves the action enabled while merely warning', () => {
    assert.equal(isEmailVerificationActionBlocked(deriveEmailVerificationPhase(limit(true, 1), null)), false);
  });
});

// ===========================================================================
// 2. Rate-limit reached state
// ===========================================================================

describe('rate-limit state', () => {
  const blockedAt = '2026-10-03T10:10:00Z';

  it('reports a cooldown when the server supplied a deadline', () => {
    const state = parseEmailVerificationLimit({
      allowed: false,
      remaining: 0,
      retryAt: blockedAt,
      serverNow: '2026-10-03T10:00:00Z',
    });
    const phase = deriveEmailVerificationPhase(state, 600_000);
    assert.equal(phase.kind, 'cooldown');
    assert.equal(isEmailVerificationActionBlocked(phase), true);
  });

  it('reports a deadline-free block when the server refused without one', () => {
    const state = parseEmailVerificationLimit({
      allowed: false,
      remaining: 0,
      retryAt: null,
      serverNow: '2026-10-03T10:00:00Z',
    });
    const phase = deriveEmailVerificationPhase(state, null);
    assert.equal(phase.kind, 'blocked');
    assert.equal(isEmailVerificationActionBlocked(phase), true);
    assert.equal(BLOCKED_WITHOUT_DEADLINE_MESSAGE, 'Too many email verification attempts. Please try again later.');
  });

  it('never invents a deadline when the server gave none', () => {
    const state = parseEmailVerificationLimit({ allowed: false, remaining: 0 });
    assert.equal(state.retryAt, null, 'no retryAt must become null, not a guessed instant');
    assert.equal(cooldownMsRemaining(state.retryAt, 0, Date.now()), null);
  });
});

// ===========================================================================
// 3. Countdown rendering
// ===========================================================================

describe('countdown rendering', () => {
  it('formats MM:SS', () => {
    assert.equal(formatEmailVerificationCountdown(582_000), '09:42');
    assert.equal(formatEmailVerificationCountdown(600_000), '10:00');
    assert.equal(formatEmailVerificationCountdown(59 * 60_000), '59:00');
  });

  it('reads 00:00 at zero rather than a negative field', () => {
    assert.equal(formatEmailVerificationCountdown(0), '00:00');
    assert.equal(formatEmailVerificationCountdown(-5_000), '00:00');
  });

  it('rounds a partial second up, so the clock never shows 00:00 early', () => {
    assert.equal(formatEmailVerificationCountdown(1), '00:01');
    assert.equal(formatEmailVerificationCountdown(1_400), '00:02');
  });

  it('counts down against the SERVER clock, not the device clock', () => {
    const retryAt = '2026-10-03T10:05:00Z';
    const serverNow = '2026-10-03T10:00:00Z';
    // The device believes it is 10:05, so it thinks the deadline has just passed.
    const deviceIsFiveMinutesFast = Date.parse('2026-10-03T10:05:00Z');

    // What naive arithmetic would do here, and the reason the offset exists.
    assert.equal(Date.parse(retryAt) - deviceIsFiveMinutesFast, 0, 'naive maths reads 00:00 straight away');

    const offset = serverClockOffsetMs(serverNow, deviceIsFiveMinutesFast);
    assert.equal(offset, -5 * 60_000, 'a fast device produces a negative offset');

    const remaining = cooldownMsRemaining(retryAt, offset, deviceIsFiveMinutesFast);
    assert.equal(remaining, 5 * 60_000, 'measured on the server clock, five minutes remain');
    assert.equal(formatEmailVerificationCountdown(remaining as number), '05:00');
  });

  it('measures no skew when the server sent no timestamp', () => {
    assert.equal(serverClockOffsetMs(null, 1_700_000_000_000), 0);
    assert.equal(serverClockOffsetMs('not-a-date', 1_700_000_000_000), 0);
  });

  it('never returns a negative remaining time', () => {
    assert.equal(
      cooldownMsRemaining('2026-10-03T09:00:00Z', 0, Date.parse('2026-10-03T10:00:00Z')),
      0,
    );
  });
});

// ===========================================================================
// 4. Countdown expiry
// ===========================================================================

describe('countdown expiry', () => {
  const expiringState: EmailVerificationLimitState = parseEmailVerificationLimit({
    allowed: false,
    remaining: 0,
    retryAt: '2026-10-03T10:00:00Z',
    serverNow: '2026-10-03T09:59:00Z',
  });

  it('becomes ready the moment the remaining time reaches zero', () => {
    assert.equal(deriveEmailVerificationPhase(expiringState, 0).kind, 'ready');
  });

  it('unlocks the action on expiry', () => {
    assert.equal(isEmailVerificationActionBlocked(deriveEmailVerificationPhase(expiringState, 0)), false);
  });

  it('treats a stale deadline in the past as expired rather than as an active block', () => {
    // A tab left open overnight still holds a blocked state whose deadline has
    // gone by. Reporting that as "cooldown" would strand the user on a timer
    // that reads 00:00 forever.
    const phase = deriveEmailVerificationPhase(expiringState, 0);
    assert.equal(phase.kind, 'ready');
  });

  it('is not permission: the next attempt still goes through the server gate', () => {
    // `ready` is a presentation state. The page must re-read the ledger and the
    // provider must still validate, so nothing here grants an allowance.
    const ready = deriveEmailVerificationPhase(expiringState, 0);
    assert.equal(ready.kind, 'ready');
    assert.equal((ready as { remaining?: number }).remaining, undefined);
  });
});

// ===========================================================================
// 5. No fake client-side state
// ===========================================================================

describe('never display a fake attempt count', () => {
  const unknownPayloads: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['a string', 'rate limited'],
    ['a missing allowed flag', { remaining: 3 }],
    ['a non-boolean allowed flag', { allowed: 'yes', remaining: 3 }],
    ['a missing remaining', { allowed: true }],
    ['a fractional remaining', { allowed: true, remaining: 2.5 }],
    ['a negative remaining', { allowed: true, remaining: -1 }],
    ['a string remaining', { allowed: true, remaining: '4' }],
    ['an empty object', {}],
  ];

  for (const [label, payload] of unknownPayloads) {
    it(`collapses ${label} to unknown`, () => {
      const parsed = parseEmailVerificationLimit(payload);
      assert.equal(parsed.allowed, null);
      assert.equal(parsed.remaining, null);
      const phase = deriveEmailVerificationPhase(parsed, null);
      assert.equal(phase.kind, 'unknown');
      // `unknown` renders nothing, and never blocks.
      assert.equal(isEmailVerificationActionBlocked(phase), false);
    });
  }

  it('drops an unparseable deadline rather than counting down from NaN', () => {
    const parsed = parseEmailVerificationLimit({
      allowed: false,
      remaining: 0,
      retryAt: 'soon',
      serverNow: '2026-10-03T10:00:00Z',
    });
    assert.equal(parsed.retryAt, null);
    assert.equal(cooldownMsRemaining(parsed.retryAt, 0, Date.now()), null);
    assert.equal(deriveEmailVerificationPhase(parsed, null).kind, 'blocked');
  });

  it('starts from an unknown state, so a fresh page has no count at all', () => {
    assert.equal(UNKNOWN_LIMIT_STATE.allowed, null);
    assert.equal(UNKNOWN_LIMIT_STATE.remaining, null);
    assert.equal(deriveEmailVerificationPhase(UNKNOWN_LIMIT_STATE, null).kind, 'unknown');
  });

  it('holds no cooldown duration of its own', () => {
    // A duration constant in the client lib would be a frontend-invented
    // cooldown: the browser deciding how long a server-imposed block lasts.
    // Unit conversions (ms to s, s to min) are not durations, so the floor is
    // set above any plausible cooldown: 10_000 seconds is nearly three hours.
    const durations = code('src/lib/emailVerificationLimit.ts').match(/\b\d{5,}\b/g) ?? [];
    assert.deepEqual(durations, [], `unexpected duration-like literal: ${durations.join(', ')}`);

    for (const constant of ['COOLDOWN', 'WINDOW_MS', 'ATTEMPT_LIMIT', 'RETRY_AFTER']) {
      assert.ok(
        !code('src/lib/emailVerificationLimit.ts').includes(constant),
        `${constant} must not exist in the client lib`,
      );
    }
  });
});

// ===========================================================================
// 6. Accessible countdown
// ===========================================================================

describe('accessible countdown', () => {
  it('speaks minutes, not seconds, above a minute', () => {
    assert.equal(describeCountdownForAssistiveTech(9 * 60_000), 'About 9 minutes remaining');
    assert.equal(describeCountdownForAssistiveTech(60_000), 'About 1 minute remaining');
    // Floors rather than ceils, matching the booking hold countdown: "About 9
    // minutes" for 9m42s under-reports slightly, "About 10 minutes" over-reports
    // and would let a user start a resend a minute early.
    assert.equal(describeCountdownForAssistiveTech(9 * 60_000 + 42_000), 'About 9 minutes remaining');
  });

  it('speaks seconds in the last minute, where "0 minutes" would say nothing', () => {
    assert.equal(describeCountdownForAssistiveTech(42_000), '42 seconds remaining');
    assert.equal(describeCountdownForAssistiveTech(1_000), '1 second remaining');
  });

  it('announces the recovery state once the clock is done', () => {
    assert.equal(describeCountdownForAssistiveTech(0), 'You can try again now.');
  });

  it('keeps the ticking digits out of the live region', () => {
    const notice = code('src/components/auth/EmailVerificationNotice.tsx');
    // The clock changes every second. If it were inside the live region, or
    // reachable by a screen reader, it would be re-announced sixty times a
    // minute. `aria-hidden` on the digits plus a polite region that only speaks
    // at minute marks is the same rule the booking hold countdown follows.
    assert.match(
      notice,
      /aria-hidden="true"[^>]*>\s*\{formatEmailVerificationCountdown\(deadlineMs\)\}/,
      'the ticking digits must be rendered inside an aria-hidden element',
    );
    assert.match(notice, /className="sr-only" aria-live="polite" aria-atomic="true"/);

    // The headline is an alert: the user's next action was just refused.
    assert.match(notice, /role="alert"/);

    // The recovery state is polite, not an alert: it is good news, not a failure.
    assert.match(notice, /role="status"[\s\S]{0,120}aria-live="polite"/);
  });

  it('points the disabled button at the notice so the block is explained', () => {
    const page = code('src/pages/mentor/MentorSignupPage.tsx');
    assert.match(page, /disabled=\{submitDisabled\}/);
    assert.match(
      page,
      /aria-describedby=\{rateLimitBlocked \? RATE_LIMIT_NOTICE_ID : undefined\}/,
      'a disabled button must say why it is disabled',
    );
    assert.match(page, /id=\{RATE_LIMIT_NOTICE_ID\}/);
  });
});

// ===========================================================================
// 7. Design system
// ===========================================================================

describe('design system', () => {
  const notice = read('src/components/auth/EmailVerificationNotice.tsx');

  it('uses the shell tokens, never a raw Tailwind palette', () => {
    // A literal palette resolves to a fixed hex, which ignores both dark mode and
    // the active segment theme - the reason the booking surfaces were the least
    // polished screens in dark mode.
    assert.doesNotMatch(notice, /\b(?:bg|text|border)-(?:red|amber|yellow|orange|emerald|green|rose|slate|gray)-\d{2,3}\b/);
    assert.match(notice, /var\(--color-shell-warning\)/);
    assert.match(notice, /var\(--color-shell-error\)/);
  });

  it('warns with the warning token and blocks with the error token', () => {
    assert.match(notice, /color-shell-warning-soft[\s\S]{0,160}color-shell-warning/);
    assert.match(notice, /color-shell-error-soft[\s\S]{0,160}color-shell-error/);
  });

  it('only uses colour tokens that exist in both themes', () => {
    const css = read('src/index.css');
    // `--color-success` and `--color-success-soft` are used elsewhere in the auth
    // surfaces but are not declared anywhere; the shell-prefixed pairs are.
    for (const token of [
      '--color-shell-warning',
      '--color-shell-warning-soft',
      '--color-shell-error',
      '--color-shell-error-soft',
      '--color-shell-success',
      '--color-shell-success-soft',
    ]) {
      assert.match(css, new RegExp(`${token}:`, 'g'), `${token} is not declared in index.css`);
    }
    assert.doesNotMatch(notice, /var\(--color-success/);
  });

  it('keeps the notice compact - a status line, not a banner', () => {
    assert.doesNotMatch(notice, /text-(?:2xl|3xl|4xl)/);
    assert.doesNotMatch(notice, /\b(?:p-8|p-10|p-12|py-8|py-10)\b/);
  });

  it('renders the exact wording the product asked for', () => {
    assert.match(notice, /Too many email verification attempts/);
    assert.match(notice, /Try again in/);
    assert.match(notice, /You can try again now\./);
  });

  it('is rendered once, not duplicated into two live regions', () => {
    const page = code('src/pages/mentor/MentorSignupPage.tsx');
    assert.equal(
      (page.match(/<EmailVerificationNotice/g) ?? []).length,
      1,
      'two notices means the same text announced twice',
    );
  });
});

// ===========================================================================
// 8. The server module, against a stubbed PostgREST transport
// ===========================================================================

interface RpcCall {
  url: string;
  body: Record<string, unknown> | null;
}

describe('server rate-limit module', () => {
  const ORIGINAL_URL = process.env.VITE_SUPABASE_URL;
  const ORIGINAL_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ORIGINAL_FETCH = globalThis.fetch;

  let calls: RpcCall[] = [];
  let handler: (url: string) => { status: number; body: unknown } = () => ({
    status: 200,
    body: [{ allowed: true, remaining: 4, retry_at: null }],
  });

  before(async () => {
    process.env.VITE_SUPABASE_URL = 'https://ledger.invalid';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
    // Installed before the first `getSupabaseAdmin()`, which is what the real
    // supabase-js client captures. No test in this suite creates that client
    // first, so this is the only transport it ever sees.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      let body: Record<string, unknown> | null = null;
      if (typeof init?.body === 'string') body = JSON.parse(init.body);
      calls.push({ url, body });

      const outcome = handler(url);
      return new Response(JSON.stringify(outcome.body), {
        status: outcome.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
  });

  after(async () => {
    globalThis.fetch = ORIGINAL_FETCH;
    if (ORIGINAL_URL === undefined) delete process.env.VITE_SUPABASE_URL;
    else process.env.VITE_SUPABASE_URL = ORIGINAL_URL;
    if (ORIGINAL_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_KEY;
  });

  /** Imported lazily so the stub is in place first. */
  const load = () => import('../src/lib/emailVerificationRateLimit');

  beforeEach(() => {
    calls = [];
    handler = () => ({ status: 200, body: [{ allowed: true, remaining: 4, retry_at: null }] });
  });

  // -- the identifier key ---------------------------------------------------

  it('derives a key that is stable, opaque and free of the address', async () => {
    const { buildEmailVerificationKey } = await load();
    const key = buildEmailVerificationKey('mentor@example.com', '203.0.113.9');

    assert.match(key, /^[0-9a-f]{64}$/);
    assert.equal(key, buildEmailVerificationKey('mentor@example.com', '203.0.113.9'), 'stable');
    assert.ok(!key.includes('mentor@example.com'), 'the address must never be recoverable');
    assert.ok(!key.includes('203.0.113.9'), 'the IP must never be recoverable');
  });

  it('normalises the address so casing cannot buy a fresh budget', async () => {
    const { buildEmailVerificationKey } = await load();
    assert.equal(
      buildEmailVerificationKey('Mentor@Example.COM', '203.0.113.9'),
      buildEmailVerificationKey('  mentor@example.com  ', '203.0.113.9'),
    );
  });

  it('binds the key to the caller, so another network cannot probe it', async () => {
    const { buildEmailVerificationKey } = await load();
    assert.notEqual(
      buildEmailVerificationKey('mentor@example.com', '203.0.113.9'),
      buildEmailVerificationKey('mentor@example.com', '203.0.113.10'),
      'the same address from a different IP is a different bucket',
    );
  });

  it('namespaces the key so it cannot collide with the login-failure ledger', async () => {
    const { buildEmailVerificationKey } = await load();
    const { buildIdentifierKey } = await import('../src/lib/loginFailureTracker');
    assert.notEqual(
      buildEmailVerificationKey('mentor@example.com', '203.0.113.9'),
      buildIdentifierKey('mentor@example.com', '203.0.113.9'),
      'both ledgers share a salt, so the input must be namespaced',
    );
  });

  // -- reading --------------------------------------------------------------

  it('reads through the read RPC, spending nothing', async () => {
    const { readEmailVerificationRateLimit } = await load();
    const state = await readEmailVerificationRateLimit({ email: 'mentor@example.com', ip: '203.0.113.9' });

    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/rest\/v1\/rpc\/read_email_verification_rate_limit$/);
    assert.equal(typeof calls[0].body?.p_identifier_key, 'string');
    assert.equal(state.allowed, true);
    assert.equal(state.remaining, 4);
  });

  it('reports the server clock so the client can correct for skew', async () => {
    const { readEmailVerificationRateLimit } = await load();
    const state = await readEmailVerificationRateLimit({ email: 'mentor@example.com', ip: '203.0.113.9' });
    assert.ok(state.serverNow, 'serverNow must be present so the countdown is anchored');
    assert.ok(!Number.isNaN(Date.parse(state.serverNow)));
  });

  it('sends only the identifier key, never the address or the IP', async () => {
    const { readEmailVerificationRateLimit } = await load();
    await readEmailVerificationRateLimit({ email: 'mentor@example.com', ip: '203.0.113.9' });

    const serialised = JSON.stringify(calls[0].body);
    assert.ok(!serialised.includes('mentor@example.com'), 'the address must not reach the RPC');
    assert.ok(!serialised.includes('203.0.113.9'), 'the IP must not reach the RPC');
    assert.deepEqual(Object.keys(calls[0].body ?? {}), ['p_identifier_key']);
  });

  // -- consuming ------------------------------------------------------------

  it('consumes through the consuming RPC, which is what spends the budget', async () => {
    const { consumeEmailVerificationAttempt } = await load();
    await consumeEmailVerificationAttempt({ email: 'mentor@example.com', ip: '203.0.113.9' });
    assert.match(calls[0].url, /\/rest\/v1\/rpc\/consume_email_verification_attempt$/);
  });

  it('refuses the sixth attempt with the database deadline', async () => {
    const { consumeEmailVerificationAttempt } = await load();
    handler = () => ({
      status: 200,
      body: [{ allowed: false, remaining: 0, retry_at: '2026-10-03T10:10:00Z' }],
    });

    const state = await consumeEmailVerificationAttempt({ email: 'mentor@example.com', ip: '203.0.113.9' });
    assert.equal(state.allowed, false);
    assert.equal(state.remaining, 0);
    assert.equal(state.retryAt, '2026-10-03T10:10:00Z');
  });

  // -- every failure path must be unknown, never a number -------------------

  const brokenRows: Array<[string, { status: number; body: unknown }]> = [
    ['an empty array', { status: 200, body: [] }],
    ['a null row', { status: 200, body: [null] }],
    ['a null remaining', { status: 200, body: [{ allowed: true, remaining: null, retry_at: null }] }],
    ['a negative remaining', { status: 200, body: [{ allowed: false, remaining: -3, retry_at: null }] }],
    ['a missing allowed', { status: 200, body: [{ remaining: 2, retry_at: null }] }],
    ['a null payload', { status: 200, body: null }],
  ];

  for (const [label, outcome] of brokenRows) {
    it(`returns unknown for ${label} rather than a fabricated count`, async () => {
      const { readEmailVerificationRateLimit } = await load();
      handler = () => outcome;

      const state = await readEmailVerificationRateLimit({ email: 'mentor@example.com', ip: '203.0.113.9' });
      assert.equal(state.allowed, null);
      assert.equal(state.remaining, null);
      assert.equal(state.retryAt, null);
    });
  }

  it('returns unknown when the ledger call errors', async () => {
    const { readEmailVerificationRateLimit, consumeEmailVerificationAttempt } = await load();
    handler = () => ({ status: 500, body: { message: 'relation does not exist' } });

    const read = await readEmailVerificationRateLimit({ email: 'a@b.test', ip: '203.0.113.1' });
    assert.equal(read.allowed, null);
    assert.equal(read.remaining, null);

    // A ledger outage must not lock a legitimate mentor out of signing up: the
    // caller is told "unknown", not "refused", and Supabase Auth still decides.
    handler = () => ({ status: 500, body: { message: 'boom' } });
    const consumed = await consumeEmailVerificationAttempt({ email: 'a@b.test', ip: '203.0.113.1' });
    assert.equal(consumed.allowed, null);
    assert.notEqual(consumed.allowed, false);
  });

  // -- recording a provider refusal ----------------------------------------

  it('records a provider refusal, then re-reads the resulting state', async () => {
    const { markEmailVerificationUpstreamBlocked } = await load();
    handler = (url) =>
      url.includes('mark_email_verification_upstream_blocked')
        ? { status: 200, body: '2026-10-03T10:10:00+00:00' }
        : { status: 200, body: [{ allowed: false, remaining: 0, retry_at: '2026-10-03T10:10:00Z' }] };

    const state = await markEmailVerificationUpstreamBlocked({ email: 'mentor@example.com', ip: '203.0.113.9' });

    assert.match(calls[0].url, /\/rest\/v1\/rpc\/mark_email_verification_upstream_blocked$/);
    assert.match(calls[1].url, /\/rest\/v1\/rpc\/read_email_verification_rate_limit$/);
    assert.equal(state.allowed, false);
    assert.equal(state.retryAt, '2026-10-03T10:10:00Z');
  });

  it('falls back to unknown when the refusal cannot be recorded', async () => {
    const { markEmailVerificationUpstreamBlocked } = await load();
    handler = () => ({ status: 500, body: { message: 'boom' } });

    const state = await markEmailVerificationUpstreamBlocked({ email: 'mentor@example.com', ip: '203.0.113.9' });
    assert.equal(state.allowed, null);
    assert.equal(state.retryAt, null, 'no deadline may be invented when the write failed');
  });
});

// ===========================================================================
// 9. Server-side enforcement
// ===========================================================================

describe('server-side enforcement', () => {
  it('exposes exactly the three rate-limit routes', () => {
    const server = read('server.ts');
    assert.match(server, /app\.get\('\/api\/auth\/email-verification\/rate-limit'/);
    assert.match(server, /app\.post\(\s*'\/api\/auth\/email-verification\/attempt'/);
    assert.match(server, /app\.post\(\s*'\/api\/auth\/email-verification\/outcome'/);
  });

  it('derives the key server-side from the validated address and the caller IP', () => {
    // The POST bodies go through `validateBody(apiSchemas.emailVerification*)`; the
    // GET has a query parameter, so it parses the address with the same
    // `emailField` those schemas are built from rather than with a second pattern.
    for (const [label, route] of [
      ['attempt', routeSource("'/api/auth/email-verification/attempt'")],
      ['outcome', routeSource("'/api/auth/email-verification/outcome'")],
      ['read', routeSource("app.get('/api/auth/email-verification/rate-limit'")],
    ] as const) {
      assert.match(route, /req\.ip/, `${label}: the key must be bound to the caller`);
      assert.match(
        route,
        /emailVerification|emailField/,
        `${label}: the address must come through the shared validator`,
      );
    }
  });

  it('accepts no count, deadline or attempt number from the client', () => {
    for (const route of [
      routeSource("'/api/auth/email-verification/attempt'"),
      routeSource("'/api/auth/email-verification/outcome'"),
      routeSource("app.get('/api/auth/email-verification/rate-limit'"),
    ]) {
      // Any of these read straight out of the request would be a client-authoritative
      // rate limit, which is the whole failure mode this feature must not have.
      for (const forbidden of ['req.body.remaining', 'req.body.attempts', 'req.body.retryAt', 'req.query.remaining', 'req.query.retryAt']) {
        assert.ok(!route.includes(forbidden), `${forbidden} must never be read from the request`);
      }
    }
  });

  it('validates both POST bodies with a strict schema', () => {
    assert.match(routeSource("'/api/auth/email-verification/attempt'"), /validateBody\(apiSchemas\.emailVerificationAttempt\)/);
    assert.match(routeSource("'/api/auth/email-verification/outcome'"), /validateBody\(apiSchemas\.emailVerificationOutcome\)/);

    const schemas = code('src/lib/validation.ts');
    assert.match(schemas, /emailVerificationAttempt:\s*z\.strictObject\(\{\s*email:\s*emailField/);
    assert.match(schemas, /emailVerificationOutcome:\s*z\.strictObject/);
  });

  it('rate limits the spending routes so the ledger cannot be flooded', () => {
    assert.match(routeSource("'/api/auth/email-verification/attempt'"), /expensiveRouteLimiter/);
    assert.match(routeSource("'/api/auth/email-verification/outcome'"), /expensiveRouteLimiter/);
  });

  it('answers a refusal with 429 plus the authoritative state', () => {
    const attempt = routeSource("'/api/auth/email-verification/attempt'");
    assert.match(attempt, /status\(429\)/);
    assert.match(attempt, /EMAIL_VERIFICATION_RATE_LIMIT_CODE/);
    assert.match(attempt, /rateLimit:\s*state/);
  });

  it('serves the read route without the strict limiter, so a refresh can rehydrate', () => {
    // The read is side-effect free and cheap; putting it behind the 10/min budget
    // would make rehydrating a rate-limited page the thing that fails.
    const read = routeSource("app.get('/api/auth/email-verification/rate-limit'");
    assert.ok(!read.includes('expensiveRouteLimiter'), 'the read route must not be strictly limited');
    assert.match(read, /readEmailVerificationRateLimit/);
    assert.ok(!read.includes('consumeEmailVerificationAttempt'), 'reading must never spend an attempt');
  });

  it('never caches a rate-limit response', () => {
    for (const route of [
      routeSource("app.get('/api/auth/email-verification/rate-limit'"),
      routeSource("'/api/auth/email-verification/attempt'"),
      routeSource("'/api/auth/email-verification/outcome'"),
    ]) {
      assert.match(route, /Cache-Control['"]?,\s*['"]no-store/, 'a cached budget would be a stale budget');
    }
  });

  it('does not reach GoTrue from the server, so the existing limiter is untouched', () => {
    const routes =
      routeSource("app.get('/api/auth/email-verification/rate-limit'") +
      routeSource("'/api/auth/email-verification/attempt'") +
      routeSource("'/api/auth/email-verification/outcome'");

    assert.ok(
      !/auth\.admin\.createUser|inviteUserByEmail|\.signUp\(|\.resend\(/.test(routes),
      'the routes must not take over the email send itself',
    );

    // The provider call stays exactly where it was: the browser still asks
    // Supabase Auth directly, and GoTrue still decides whether that send is
    // allowed. This is a gate in front of it, not a takeover.
    assert.match(
      read('src/context/AuthContext.tsx'),
      /supabase\.auth\.signUp\(\{/,
      'signup must still go straight to Supabase Auth',
    );
  });

  it('has a route-level contract so the page cannot drift from it', () => {
    const hook = code('src/hooks/useEmailVerificationLimit.ts');
    assert.match(hook, /\/api\/auth\/email-verification\/rate-limit/);
    assert.match(hook, /\/api\/auth\/email-verification\/attempt/);
    assert.match(hook, /\/api\/auth\/email-verification\/outcome/);
  });
});

// ===========================================================================
// 10. The signup page: gating, rehydration, no local bypass
// ===========================================================================

describe('mentor signup page', () => {
  const page = code('src/pages/mentor/MentorSignupPage.tsx');

  it('asks the server before any verification email is attempted', () => {
    const gate = page.indexOf('await requestAttempt(');
    const send = page.indexOf('await signUp(');
    assert.ok(gate > -1, 'the pre-flight gate must exist');
    assert.ok(send > -1);
    assert.ok(gate < send, 'the gate has to run before the provider call');
  });

  it('does not call the provider once the server has refused', () => {
    const gate = page.indexOf('await requestAttempt(');
    const bail = page.indexOf('if (!permitted)');
    const send = page.indexOf('await signUp(');
    assert.ok(bail > gate && bail < send, 'a refusal must return before the provider call');
  });

  it('re-checks the block inside the handler, not only on the button', () => {
    // A disabled button is a UI affordance, not a control: Enter in a text field,
    // a queued click and a scripted submit all bypass it.
    assert.match(
      page,
      /if \(isEmailVerificationActionBlocked\(phase\)\) return;/,
      'the handler must refuse independently of the button',
    );
    assert.match(page, /disabled=\{submitDisabled\}/);
  });

  it('holds no local attempt counter of any kind', () => {
    // A tally in component state is what a refresh resets and a second tab
    // disagrees with, which is exactly the bug class being fixed.
    assert.ok(
      !/useState\(\s*0\s*\)/.test(page),
      'no numeric state may stand in for the server attempt count',
    );
    assert.ok(!/localStorage|sessionStorage/.test(page), 'no rate-limit state may be persisted client-side');
    assert.ok(!page.includes('attemptsMade'), 'a client-side tally must not exist');
  });

  it('rehydrates from the server when the address is known', () => {
    assert.match(page, /void refresh\(email\)/);
    assert.match(page, /onBlur=\{validateEmailAndSyncLimit\}/);
  });

  it('reports a provider refusal so the cooldown gets a real deadline', () => {
    assert.match(page, /over_email_send_rate_limit/);
    assert.match(page, /reportOutcome\(email\.trim\(\),\s*'rate_limited'\)/);
  });

  it('replaces the provider sentence instead of showing it alongside', () => {
    // Two live regions carrying the same information is itself an accessibility
    // defect, and showing GoTrue's bare sentence next to the countdown is exactly
    // the "email rate limit exceeded" the product asked to replace.
    assert.match(
      page,
      /\{\(displayError \|\| error\) && !rateLimitBlocked &&/,
      'the page-level error banner must be suppressed while the notice is up',
    );
    assert.match(
      page,
      /\{displayError && !rateLimitBlocked && !fullNameError/,
      'and the trailing line too',
    );
    // The refusal path must not stash the raw provider message in the first place.
    assert.match(page, /if \(isUpstreamRateLimit\(res\.error\)\) \{\s*setProviderRefused\(true\);/);
  });

  it('treats an unreachable ledger as unknown, not as a refusal', () => {
    const hook = code('src/hooks/useEmailVerificationLimit.ts');
    assert.match(
      hook,
      /return next\.allowed !== false;/,
      'a null answer must not block; only a positive refusal does',
    );
  });

  it('re-reads the ledger when the countdown reaches zero', () => {
    const hook = code('src/hooks/useEmailVerificationLimit.ts');
    assert.match(hook, /phase\.kind !== 'ready'/);
    assert.match(hook, /void refresh\(normalizedEmail\)/);
  });

  it('keeps the expiry latch separate from the address reset', () => {
    // Regression. A single ref shared by both effects looks like a tidier way to
    // remember "already handled this address", and it silently kills the expiry
    // re-read: the reset effect stamps the ref on the first keystroke, so by the
    // time the countdown ends the expiry effect sees its own latch already set
    // and returns early. The page then stays on "You can try again now." with a
    // count nobody re-read. The reset effect must clear a latch that only the
    // expiry effect sets.
    const hook = code('src/hooks/useEmailVerificationLimit.ts');
    // `(?!=)` so the `===` guard is not counted as an assignment.
    const setters = hook.match(/expiryHandledRef\.current =(?!=)/g) ?? [];
    assert.equal(setters.length, 2, 'one assignment arms the latch, one clears it');

    assert.match(
      hook,
      /const expiryHandledRef = useRef<string \| null>\(null\);/,
      'the latch must be its own ref',
    );
    // The arming happens only in the expiry effect, guarded by the phase.
    assert.match(hook, /phase\.kind !== 'ready'[\s\S]{0,120}expiryHandledRef\.current = normalizedEmail/);
    // The clearing happens in the address-change effect, which runs on every
    // keystroke and so must not be gated on the ref it also writes.
    assert.match(hook, /expiryHandledRef\.current = null;\s*\n\s*offsetRef\.current = 0;/);
  });

  it('ticks the countdown once a second', () => {
    const hook = code('src/hooks/useEmailVerificationLimit.ts');
    assert.match(hook, /TICK_MS\s*=\s*1000/);
    assert.match(hook, /setInterval/);
    assert.match(hook, /clearInterval/);
  });

  it('does not tick while nothing is counting down', () => {
    const hook = code('src/hooks/useEmailVerificationLimit.ts');
    assert.match(
      hook,
      /if \(!countdownLive\) return;/,
      'a form the user is filling in must not re-render every second',
    );
  });

  it('discards state when the address changes', () => {
    const hook = code('src/hooks/useEmailVerificationLimit.ts');
    assert.match(
      hook,
      /\}, \[normalizedEmail\]\);/,
      'the reset effect must key on the address',
    );
    assert.match(page, /setProviderRefused\(false\)/);
  });
});

// ===========================================================================
// 11. The ledger itself
// ===========================================================================

describe('the ledger', () => {
  const sql = read(MIGRATION);

  it('is a single-row config plus a per-recipient ledger, both RLS-enabled', () => {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.email_verification_rate_limit_config\s*\(/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.email_verification_rate_limits\s*\(/);
    assert.match(sql, /ALTER TABLE public\.email_verification_rate_limits ENABLE ROW LEVEL SECURITY/);
    assert.match(sql, /ALTER TABLE public\.email_verification_rate_limit_config ENABLE ROW LEVEL SECURITY/);
  });

  it('stores counts and instants only - no address, no IP', () => {
    const columns = sql
      .slice(sql.indexOf('CREATE TABLE IF NOT EXISTS public.email_verification_rate_limits'))
      .split(');')[0];
    for (const forbidden of ['email', 'ip_address', 'address']) {
      assert.ok(
        !new RegExp(`^\\s*${forbidden}\\b`, 'mi').test(columns),
        `${forbidden} must not be a column of the ledger`,
      );
    }
    assert.match(sql, /identifier_key TEXT PRIMARY KEY/);
  });

  it('pins an explicit attempt limit, window and cooldown for the operator', () => {
    assert.match(sql, /attempt_limit INTEGER NOT NULL DEFAULT 5/);
    assert.match(sql, /window_minutes INTEGER NOT NULL DEFAULT 60/);
    assert.match(sql, /cooldown_seconds INTEGER NOT NULL DEFAULT 600/);
  });

  it('defaults the cooldown from config, never from a literal in a function', () => {
    assert.match(sql, /\(v_cooldown_seconds \|\| ' seconds'\)::INTERVAL/);
    assert.match(sql, /COALESCE\(v_cooldown_seconds, 600\)/);
    // The only hardcoded fallback is the same value the config row defaults to,
    // so a half-applied config cannot change the documented behaviour.
    assert.match(sql, /cooldown_seconds INTEGER NOT NULL DEFAULT 600/);
  });

  it('never widens the limit when config is missing', () => {
    // A missing config row must fall back to the documented default, not to
    // "unlimited".
    assert.match(sql, /COALESCE\(v_attempt_limit, 5\)/);
    assert.match(sql, /COALESCE\(v_window_minutes, 60\)/);
  });

  it('serialises the read-modify-write so two tabs cannot both spend the last attempt', () => {
    const consume = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.consume_email_verification_attempt'),
      sql.indexOf('CREATE OR REPLACE FUNCTION public.mark_email_verification_upstream_blocked'),
    );
    assert.match(consume, /FOR UPDATE/);
  });

  it('makes the provider refusal outrank the local arithmetic', () => {
    // If GoTrue has already refused, the caller waits for that instant even though
    // the local budget would have allowed another attempt.
    const consume = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.consume_email_verification_attempt'),
      sql.indexOf('CREATE OR REPLACE FUNCTION public.mark_email_verification_upstream_blocked'),
    );
    assert.match(consume, /blocked_until IS NOT NULL AND v_row\.blocked_until > NOW\(\)/);
  });

  it('stores an absolute block, so repeated reports cannot extend it', () => {
    assert.match(sql, /blocked_until = GREATEST\(/);
  });

  it('does not spend an attempt while a provider block is in force', () => {
    const consume = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.consume_email_verification_attempt'),
      sql.indexOf('CREATE OR REPLACE FUNCTION public.mark_email_verification_upstream_blocked'),
    );
    const blockedBranch = consume.slice(consume.indexOf('IF v_row.blocked_until IS NOT NULL'));
    assert.ok(
      !blockedBranch.slice(0, blockedBranch.indexOf('ELSIF')).includes('UPDATE'),
      'a refused attempt must not rewrite the counter',
    );
  });

  it('polls the same shared budget for a resend as for a signup', () => {
    // A second independent limiter would be the wrong shape: the budget has to be
    // the one the page reads, or the countdown is describing something else.
    assert.match(sql, /email_verification_rate_limits/);
    assert.equal(
      (sql.match(/CREATE OR REPLACE FUNCTION public\./g) ?? []).length,
      4,
      'one read, one consume, one mark-blocked, one prune',
    );
  });
});

// ===========================================================================
// 12. No security regression
// ===========================================================================

describe('no security regression', () => {
  const sql = read(MIGRATION);

  it('revokes EXECUTE from PUBLIC, anon and authenticated on every new function', () => {
    for (const fn of [
      'read_email_verification_rate_limit',
      'consume_email_verification_attempt',
      'mark_email_verification_upstream_blocked',
      'prune_email_verification_rate_limits',
    ]) {
      assert.match(sql, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\(.*\\) FROM PUBLIC`, 'i'), `${fn} must be revoked from PUBLIC`);
      assert.match(sql, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\(.*\\) FROM anon`, 'i'), `${fn} must be revoked from anon`);
      assert.match(sql, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\(.*\\) FROM authenticated`, 'i'), `${fn} must be revoked from authenticated`);
      assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(.*\\) TO service_role`, 'i'), `${fn} must stay reachable by the server`);
    }
    assert.ok(!/GRANT[^;]*TO anon/i.test(sql), 'this migration must never grant anything to anon');
  });

  it('pins a search_path on every SECURITY DEFINER function', () => {
    const definers = (sql.match(/CREATE OR REPLACE FUNCTION public\.\w+\([\s\S]*?\)\s*RETURNS[\s\S]*?\$\$/g) ?? []);
    assert.equal(definers.length, 4);
    for (const fn of definers) {
      assert.match(fn, /SECURITY DEFINER/);
      assert.match(fn, /SET search_path = public/, 'an unpinned search_path is an escalation vector');
    }
  });

  it('rejects a short or missing identifier key at the database boundary', () => {
    // Three of the four RPCs take a key and must refuse a short one before doing
    // any work. `prune_email_verification_rate_limits` takes an age instead, so
    // there is nothing to validate.
    const raisings = (sql.match(/RAISE EXCEPTION 'invalid identifier key'/g) ?? []).length;
    assert.equal(raisings, 3);
    assert.match(sql, /FUNCTION public\.prune_email_verification_rate_limits\(\s*p_older_than_minutes INTEGER/);
  });

  it('grants no client role any privilege on the ledger or its config', () => {
    assert.match(sql, /REVOKE ALL ON public\.email_verification_rate_limits\s+FROM anon, authenticated/);
    assert.match(sql, /REVOKE ALL ON public\.email_verification_rate_limit_config FROM anon, authenticated/);
    assert.match(sql, /GRANT ALL ON public\.email_verification_rate_limits\s+TO service_role/);
  });

  it('proves both post-conditions rather than assuming them', () => {
    // Phase 29 revoked EXECUTE from anon on every function that existed then.
    // Postgres re-grants it on every new function, so this migration has to
    // re-assert containment and prove it.
    assert.match(sql, /has_function_privilege\('anon'/);
    assert.match(sql, /CRITICAL-01 containment incomplete/);
    assert.match(sql, /has_table_privilege\('anon'/, 'table reachability must be proven too');
    assert.match(sql, /is writable by a client role|is reachable by a client role/);
  });

  it('registers itself in the post-phase-29 containment regression list', () => {
    const regression = read('tests/security_containment_regression.test.ts');
    assert.match(
      regression,
      new RegExp(`20261017000000_phase43_email_verification_rate_limit\\.sql`),
      'a SECURITY DEFINER migration added after phase 29 must be named in the regression list',
    );
  });

  it('classifies the new tables in the RLS inventory', () => {
    const regression = read('tests/rls_coverage_regression.test.ts');
    assert.match(regression, /email_verification_rate_limits: null/);
    assert.match(regression, /email_verification_rate_limit_config: null/);
  });

  it('leaves the existing limiters, RLS and auth untouched', () => {
    const diffTouches = [
      'src/lib/rateLimit.ts',
      'src/lib/loginFailureTracker.ts',
      'src/context/AuthContext.tsx',
    ];
    for (const untouched of diffTouches) {
      assert.ok(read(untouched).length > 0, `${untouched} must still exist`);
    }
    // The ledger is additive: nothing in the login-failure path is rewritten.
    assert.match(sql, /login_failure/);
    const server = read('server.ts');
    assert.match(server, /recordLoginFailure/);
    assert.match(server, /resetLoginFailures/);
  });

  it('does not widen any express rate limit', () => {
    const limits = read('src/lib/rateLimit.ts');
    assert.match(limits, /export const API_RATE_LIMIT = 120;/);
    assert.match(limits, /export const EXPENSIVE_RATE_LIMIT = 10;/);
  });
});
