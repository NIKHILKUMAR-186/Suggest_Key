import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrubForLog, scrubString, logSanitizer, REDACTED } from '../src/lib/logSanitizer';
import { buildIdentifierKey } from '../src/lib/loginFailureTracker';

test('redacts password-style keys at any depth', () => {
  const out = scrubForLog({
    email: 'a@b.com',
    password: 'hunter2',
    nested: { user: { newPassword: 'hunter3', current_password: 'x', user_password: 'y' } },
  }) as any;
  assert.equal(out.email, 'a@b.com');
  assert.equal(out.password, REDACTED);
  assert.equal(out.nested.user.newPassword, REDACTED);
  assert.equal(out.nested.user.current_password, REDACTED);
  assert.equal(out.nested.user.user_password, REDACTED);
});

test('redacts token and secret keys including compound names', () => {
  const out = scrubForLog({
    access_token: 'abc',
    refresh_token: 'def',
    api_key: 'ghi',
    service_role_key: 'jkl',
    client_secret: 'mno',
    db_secret: 's',
    authToken: 't',
  }) as Record<string, unknown>;
  for (const [k, v] of Object.entries(out)) {
    assert.equal(v, REDACTED, `${k} should be redacted`);
  }
});

test('redacts credit card numbers held as keys and inside free text', () => {
  assert.equal((scrubForLog({ cardnumber: '4111111111111111' }) as any).cardnumber, REDACTED);
  assert.equal((scrubForLog({ cardNumber: '4111111111111111' }) as any).cardNumber, REDACTED);
  assert.equal((scrubForLog({ cvv: '123' }) as any).cvv, REDACTED);

  const out = scrubString('card 4111 1111 1111 1111 declined');
  assert.ok(!out.includes('4111'), 'card digits must not survive');
  assert.ok(out.includes(REDACTED));
  assert.ok(out.includes('declined'), 'surrounding prose must survive');

  assert.ok(!scrubString('pan=5500005555555559').includes('5500005555555559'));
});

test('never leaks bearer tokens or JWTs embedded in messages', () => {
  assert.ok(!scrubString('Authorization: Bearer abcdef1234567890').includes('abcdef1234567890'));
  assert.ok(scrubString('Authorization: Bearer abcdef1234567890').includes(REDACTED));

  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
  assert.ok(!scrubString(`token was ${jwt}`).includes('dozjgNryP4J3jVmNHl0w5N'));
  assert.ok(!scrubString('key sk_live_abcdefghijklmnop').includes('abcdefghijklmnop'));
});

test('redacts postgres connection strings with inline password', () => {
  const out = scrubString('connect failed postgres://user:s3cr3t@host:5432/db');
  assert.ok(!out.includes('s3cr3t'), 'password must not survive');
  assert.ok(out.includes(REDACTED));
});

test('redacts supabase service role, publishable and demo tokens', () => {
  assert.equal(scrubString('sb_secret_abcdefghijklmnop'), REDACTED);
  assert.equal(scrubString('sb_publishable_abcdefghijklmnop'), REDACTED);
  const demo = scrubString('used skdemo.eyJzdWIiOiJhIn0.abcdefghijkl');
  assert.ok(!demo.includes('abcdefghijkl'), 'demo token signature must not survive');
  assert.ok(demo.includes(REDACTED));
});

test('scrubString does not leak match offsets into the output', () => {
  const out = scrubString('card 4111 1111 1111 1111 declined');
  assert.ok(!/\d+\*\*\*redacted\*\*\*/.test(out), `offset leaked into output: ${out}`);
  assert.ok(!/card \d/.test(out), `stray digit left behind: ${out}`);
});

test('survives circular structures', () => {
  const node: Record<string, unknown> = { name: 'root' };
  node.self = node;
  const out = scrubForLog(node) as Record<string, unknown>;
  assert.equal(out.name, 'root');
  assert.equal(out.self, '[circular]');
});

test('truncates oversized strings instead of logging them whole', () => {
  const out = scrubString('x'.repeat(5000));
  assert.ok(out.length < 2100);
  assert.ok(out.endsWith('...[truncated]'));
});

test('preserves useful non-sensitive diagnostics', () => {
  const out = scrubForLog({
    method: 'POST',
    path: '/api/bookings/hold',
    statusCode: 409,
    durationMs: 12,
    errorCode: 'SLOT_HELD_BY_OTHER',
  }) as Record<string, unknown>;
  assert.equal(out.method, 'POST');
  assert.equal(out.path, '/api/bookings/hold');
  assert.equal(out.statusCode, 409);
  assert.equal(out.durationMs, 12);
  assert.equal(out.errorCode, 'SLOT_HELD_BY_OTHER');
});

test('sanitizeHeaders hides credential headers but keeps correlation ids', () => {
  const out = logSanitizer.sanitizeHeaders({
    Authorization: 'Bearer secret-token-value',
    Cookie: 'session=abc',
    'X-Request-ID': 'req_1234',
    'Content-Type': 'application/json',
  });
  assert.equal(out.authorization, '***present***');
  assert.equal(out.cookie, '***present***');
  assert.equal(out['X-Request-ID'], 'req_1234');
  assert.equal(out['Content-Type'], 'application/json');
});

test('sanitizeBody keeps the legacy contract for non-object input', () => {
  assert.deepEqual(logSanitizer.sanitizeBody(null), {});
  assert.deepEqual(logSanitizer.sanitizeBody(undefined), {});
  assert.deepEqual(logSanitizer.sanitizeBody('string'), {});
  assert.deepEqual(logSanitizer.sanitizeBody([1, 2, 3]), {});
});

test('identifier key is stable, non-reversible, and identity-scoped', () => {
  const a = buildIdentifierKey('User@Example.com', '1.2.3.4');
  const b = buildIdentifierKey('user@example.com', '1.2.3.4');
  const c = buildIdentifierKey('user@example.com', '5.6.7.8');

  assert.equal(a, b, 'case/whitespace normalised email must map to the same key');
  assert.notEqual(a, c, 'different IP must be a different identity');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.ok(!a.includes('user@example.com'), 'raw email must never appear in the key');
});

test('hashed identifier key is not mistaken for a secret and stays correlatable', () => {
  const key = buildIdentifierKey('victim@example.com', '9.9.9.9');
  const out = scrubForLog({ identifierKey: key, email: 'victim@example.com' }) as Record<string, unknown>;
  assert.equal(out.identifierKey, key, 'the key must survive so alerts stay correlatable');
  assert.equal(out.email, 'victim@example.com');
});
