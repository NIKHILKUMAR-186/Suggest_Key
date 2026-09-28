import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateRequestId, isValidRequestId } from '../src/lib/requestId';
import { logSanitizer } from '../src/lib/logSanitizer';

describe('Request ID', () => {
  it('generates unique request IDs with the req_ prefix', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const id = generateRequestId();
      assert.ok(id.startsWith('req_'), `Expected req_ prefix, got ${id}`);
      assert.ok(id.length > 6, `ID too short: ${id}`);
      ids.add(id);
    }
    assert.equal(ids.size, 100, 'All request IDs should be unique');
  });

  it('validates request IDs correctly', () => {
    assert.equal(isValidRequestId('req_8f72a1'), true);
    assert.equal(isValidRequestId('invalid'), false);
    assert.equal(isValidRequestId(''), false);
    assert.equal(isValidRequestId(undefined), false);
  });
});

describe('Log Sanitizer', () => {
  it('redacts authorization header', () => {
    const sanitized = logSanitizer.sanitizeHeaders({
      authorization: 'Bearer super-secret-token-12345',
      'content-type': 'application/json',
    });
    assert.notEqual(sanitized.authorization, 'Bearer super-secret-token-12345');
    assert.match(sanitized.authorization as string, /present/i);
    assert.equal(sanitized['content-type'], 'application/json');
  });

  it('redacts cookie header', () => {
    const sanitized = logSanitizer.sanitizeHeaders({
      cookie: 'session=abc123; auth=xyz',
    });
    assert.match(sanitized.cookie as string, /present/i);
  });

  it('redacts sensitive body keys', () => {
    const sanitized = logSanitizer.sanitizeBody({
      email: 'user@example.com',
      password: 'hunter2',
      accessToken: 'secret-token',
      refresh_token: 'refresh-xyz',
    }) as Record<string, unknown>;
    assert.equal(sanitized.email, 'user@example.com');
    assert.equal(sanitized.password, 'redacted');
    assert.equal(sanitized.accessToken, 'redacted');
    assert.equal(sanitized.refresh_token, 'redacted');
  });

  it('detects sensitive paths', () => {
    assert.equal(logSanitizer.isSensitivePath('/auth/reset-password'), true);
    assert.equal(logSanitizer.isSensitivePath('/api/admin/mentors'), false);
  });

  it('sanitizes error stacks safely', () => {
    const stack = 'Error: test\n    at file.js:123:45\n    at file2.js:678:90';
    const sanitized = logSanitizer.safeErrorStack(stack);
    assert.ok(sanitized);
    assert.match(sanitized, /file\.js:xxx:xxx/);
  });

  it('provides safe error messages', () => {
    const err = new Error('Something went wrong');
    const msg = logSanitizer.safeMessage(err);
    assert.equal(msg, 'Something went wrong');
  });
});