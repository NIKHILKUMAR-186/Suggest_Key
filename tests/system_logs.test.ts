import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateRequestId,
  sanitizeHeadersForLog,
  sanitizeBodyForLog,
  logApiRequest,
  logAuthEvent,
  logAuditEvent,
  logSystemError,
  fetchSystemLogs,
  fetchAuditLogs,
  fetchSystemHealthMetrics,
  logger,
  requestIdMiddleware,
  requestLoggerMiddleware,
} from '../src/lib/logger';
import { auditAction } from '../src/lib/auditLogger';
import { generateRequestId as generateRequestIdFromModule } from '../src/lib/requestId';

describe('Request ID Generation', () => {
  it('generates IDs with the req_ prefix', () => {
    const id = generateRequestId();
    assert.ok(id.startsWith('req_'), `Expected prefix "req_" but got "${id}"`);
  });

  it('generates unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateRequestId());
    }
    assert.equal(ids.size, 1000, 'Expected 1000 unique IDs');
  });

  it('requestId module re-exports generateRequestId', () => {
    const id = generateRequestIdFromModule();
    assert.ok(id.startsWith('req_'));
  });
});

describe('Header Sanitization', () => {
  it('redacts sensitive headers', () => {
    const headers = {
      authorization: 'Bearer secret-token-123',
      cookie: 'session=abc123',
      'x-api-key': 'super-secret-key',
      'content-type': 'application/json',
      'x-request-id': 'req_abc123',
    };
    const result = sanitizeHeadersForLog(headers);

    assert.equal(result.authorization, '***present***');
    assert.equal(result.cookie, '***present***');
    assert.equal(result['x-api-key'], '***present***');
    assert.equal(result['content-type'], 'application/json');
    assert.equal(result['x-request-id'], 'req_abc123');
  });

  it('does not include absent headers in output', () => {
    const result = sanitizeHeadersForLog({ 'content-type': 'application/json' });
    assert.ok(!('authorization' in result));
  });
});

describe('Body Sanitization', () => {
  it('redacts sensitive body keys', () => {
    const body = {
      password: 'hunter2',
      access_token: 'tok_abc',
      email: 'user@test.com',
      name: 'Test User',
      cardNumber: '4111111111111111',
      cvv: '123',
    };
    const result = sanitizeBodyForLog(body);

    assert.equal(result.password, '***redacted***');
    assert.equal(result.access_token, '***redacted***');
    assert.equal(result.cardNumber, '***redacted***');
    assert.equal(result.cvv, '***redacted***');
    assert.equal(result.email, 'user@test.com');
    assert.equal(result.name, 'Test User');
  });

  it('handles null or non-object bodies', () => {
    assert.deepEqual(sanitizeBodyForLog(null), {});
    assert.deepEqual(sanitizeBodyForLog(undefined), {});
    assert.deepEqual(sanitizeBodyForLog('string'), {});
  });
});

describe('Logger Facade', () => {
  it('logger.auth does not throw when no Supabase client', () => {
    assert.doesNotThrow(() => {
      logger.auth('login_success', {
        requestId: 'req_test',
        userId: 'user-1',
        role: 'admin',
        path: '/api/test',
        result: 'success',
      });
    });
  });

  it('logger.auth handles missing options gracefully', () => {
    assert.doesNotThrow(() => {
      logger.auth('auth_missing_token', {
        requestId: 'req_test2',
        result: 'failure',
        reason: 'AUTH_REQUIRED',
      });
    });
  });

  it('logger.requestEnd does not throw when no Supabase client', () => {
    assert.doesNotThrow(() => {
      logger.requestEnd(
        {
          requestId: 'req_test',
          start: Date.now(),
          method: 'GET',
          path: '/api/test',
          userId: 'user-1',
          role: 'admin',
        },
        200,
        null,
        undefined,
        { durationMs: 42 },
      );
    });
  });

  it('logger.requestEnd logs error context on 500 status', () => {
    assert.doesNotThrow(() => {
      logger.requestEnd(
        {
          requestId: 'req_err',
          start: Date.now(),
          method: 'POST',
          path: '/api/bookings/hold',
          userId: null,
          role: null,
        },
        500,
        'INTERNAL_SERVER_ERROR',
        'Something went wrong',
        { durationMs: 150, error: { code: 'INTERNAL_SERVER_ERROR', message: 'Something went wrong' } },
      );
    });
  });
});

describe('Audit Action', () => {
  it('auditAction does not throw when auth is undefined', async () => {
    await assert.doesNotReject(async () => {
      await auditAction(undefined, 'mentor_approved', {
        entityType: 'mentor_profile',
        entityId: 'mentor-123',
        requestId: 'req_audit_test',
        metadata: { action: 'approve' },
      });
    });
  });

  it('auditAction resolves for admin auth', async () => {
    await assert.doesNotReject(async () => {
      await auditAction(
        {
          user: { id: 'usr-admin', email: 'admin@test.com' },
          roles: ['admin'],
        },
        'segment_created',
        {
          entityType: 'segment',
          entityId: 'seg-1',
          requestId: 'req_seg',
          metadata: { name: 'Test', slug: 'test' },
        },
      );
    });
  });

  it('auditAction resolves for mentor auth', async () => {
    await assert.doesNotReject(async () => {
      await auditAction(
        {
          user: { id: 'usr-mentor', email: 'mentor@test.com' },
          roles: ['mentor'],
        },
        'segment_edited',
        { entityType: 'segment', entityId: 'seg-2', requestId: 'req_seg2' },
      );
    });
  });
});

describe('Log Fetching (No Client = Empty Results)', () => {
  it('fetchSystemLogs returns empty array when no client configured', async () => {
    const result = await fetchSystemLogs({ limit: 10 });
    assert.ok(Array.isArray(result), 'Expected an array');
    assert.equal(result.length, 0);
  });

  it('fetchAuditLogs returns empty array when no client configured', async () => {
    const result = await fetchAuditLogs({ limit: 10 });
    assert.ok(Array.isArray(result), 'Expected an array');
    assert.equal(result.length, 0);
  });

  it('fetchSystemHealthMetrics returns zeroed metrics when no client configured', async () => {
    const result = await fetchSystemHealthMetrics();
    assert.equal(result.total_requests, 0);
    assert.equal(result.error_rate, 0);
    assert.equal(result.average_latency_ms, 0);
    assert.ok(Array.isArray(result.error_groups));
    assert.equal(result.error_groups.length, 0);
  });
});

describe('Direct Log Functions (No Client = No Throw)', () => {
  it('logApiRequest does not throw', async () => {
    await assert.doesNotReject(async () => {
      await logApiRequest({
        requestId: 'req_api_test',
        method: 'GET',
        path: '/api/health',
        statusCode: 200,
        durationMs: 5,
      });
    });
  });

  it('logAuthEvent does not throw', async () => {
    await assert.doesNotReject(async () => {
      await logAuthEvent({
        requestId: 'req_auth_test',
        event: 'login_success',
        userId: 'user-1',
      });
    });
  });

  it('logAuditEvent does not throw', async () => {
    await assert.doesNotReject(async () => {
      await logAuditEvent({
        actorUserId: 'user-1',
        action: 'test_action',
        entityType: 'test',
        entityId: '1',
        requestId: 'req_test',
      });
    });
  });

  it('logSystemError does not throw', async () => {
    await assert.doesNotReject(async () => {
      await logSystemError({
        requestId: 'req_err',
        message: 'Test error',
        path: '/api/test',
        method: 'GET',
        error_code: 'TEST_ERROR',
        stack: 'Error: test\n  at /src/index.js:10:5',
      });
    });
  });
});

describe('Express Middleware', () => {
  it('requestIdMiddleware sets X-Request-ID header', () => {
    const headers: Record<string, string> = {};
    const req = { id: undefined } as any;
    const res = {
      setHeader: (k: string, v: string) => { headers[k] = v; },
    } as any;

    requestIdMiddleware(req, res, () => {});

    assert.ok(req.id?.startsWith('req_'));
    assert.equal(headers['X-Request-ID'], req.id);
  });

  it('requestIdMiddleware preserves existing request ID', () => {
    const req = { id: 'req_existing' } as any;
    const res = { setHeader: () => {} } as any;

    requestIdMiddleware(req, res, () => {});

    assert.equal(req.id, 'req_existing');
  });

  it('requestLoggerMiddleware logs without throwing', () => {
    const req: any = { method: 'GET', path: '/api/test', id: 'req_mw_test', auth: { user: { id: 'u1' }, roles: ['seeker'] } };
    const res: any = {
      statusCode: 200,
      end: () => {},
      on: () => {},
      setHeader: () => {},
    };

    assert.doesNotThrow(() => {
      requestLoggerMiddleware(req, res, () => {});
    });
  });
});
