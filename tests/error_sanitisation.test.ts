import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'net';
import {
  GENERIC_ERROR_MESSAGE,
  respondWithInternalError,
  terminalErrorHandler,
} from '../src/lib/supabaseErrors';
import { generateRequestId } from '../src/lib/requestId';

interface TestServer {
  url: string;
  close: () => Promise<void>;
}

/** A realistic PostgREST failure, i.e. exactly the kind of thing that must never
 *  reach the browser: constraint names, column names, and a SQL fragment. */
const POSTGREST_ERROR = {
  message: 'duplicate key value violates unique constraint "users_email_key"',
  code: '23505',
  details: 'Key (email)=(victim@example.com) already exists.',
  hint: null,
  stack: 'Error: duplicate key value...\n    at handler (/app/server.ts:900:11)',
};

const INTERNALS = [
  'users_email_key',
  'victim@example.com',
  'duplicate key value',
  'at handler',
  POSTGREST_ERROR.message,
  POSTGREST_ERROR.details,
];

async function startTestServer(
  register: (app: express.Express) => void,
): Promise<TestServer> {
  const app = express();
  // Mirrors server.ts: the requestId middleware runs first, so req.requestId is
  // populated by the time any handler or the backstop builds the error envelope.
  app.use((req, res, next) => {
    const requestId = generateRequestId();
    (req as { requestId?: string }).requestId = requestId;
    res.set('X-Request-ID', requestId);
    next();
  });
  register(app);
  // MUST be last, exactly as in server.ts.
  app.use(terminalErrorHandler);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    ),
  };
}

function assertNoInternals(body: string) {
  for (const secret of INTERNALS) {
    assert.ok(
      !body.includes(secret),
      `response leaked internal detail ${JSON.stringify(secret)}: ${body}`,
    );
  }
}

describe('Production error sanitisation', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let server: TestServer;

  before(async () => {
    process.env.NODE_ENV = 'production';
    server = await startTestServer((app) => {
      // Shape used by every migrated catch block in server.ts.
      app.get('/api/caught', (req, res) => {
        try {
          throw new Error('boom');
        } catch (err) {
          return respondWithInternalError({ req, res, error: err });
        }
      });

      // A catch block that rethrows a raw Supabase/PostgREST error.
      app.get('/api/caught-db', (req, res) => {
        try {
          throw POSTGREST_ERROR;
        } catch (err) {
          return respondWithInternalError({ req, res, error: err });
        }
      });

      // A route with NO try/catch at all - the backstop must catch this.
      app.get('/api/uncaught', () => {
        throw new Error('unhandled boom');
      });
    });
  });

  after(async () => {
    await server.close();
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('returns 500 with the friendly generic message', async () => {
    const res = await fetch(`${server.url}/api/caught`);
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.error.message, GENERIC_ERROR_MESSAGE);
    assert.equal(body.error.message, 'An unexpected error occurred');
  });

  it('does not leak the raw Error message', async () => {
    const res = await fetch(`${server.url}/api/caught`);
    const body = await res.text();
    assert.ok(!body.includes('boom'), `leaked Error.message: ${body}`);
  });

  it('does not leak database errors, constraint names, or stack frames', async () => {
    const res = await fetch(`${server.url}/api/caught-db`);
    const body = await res.text();
    assertNoInternals(body);
    const parsed = JSON.parse(body);
    assert.equal(parsed.error.message, GENERIC_ERROR_MESSAGE);
  });

  it('answers 409 for a constraint violation the caller caused', async () => {
    // A 23505 is the caller's own doing (a duplicate they submitted), not an
    // internal fault. Reporting 500 was both misleading and a cheap way to fill
    // the admin error log - `GET /api/seeker/bookings/1' OR 1=1--` produced a
    // 500 because the malformed uuid reached Postgres as 22P02.
    const res = await fetch(`${server.url}/api/caught-db`);
    assert.equal(res.status, 409);
    const parsed = await res.json();
    assert.equal(parsed.error.code, 'VALIDATION_ERROR');
  });

  it('still answers 500 for an error it cannot attribute to the caller', async () => {
    const res = await fetch(`${server.url}/api/uncaught`);
    assert.equal(res.status, 500);
    const parsed = await res.json();
    assert.equal(parsed.error.code, 'SERVER_ERROR');
    assert.equal(parsed.error.message, GENERIC_ERROR_MESSAGE);
  });

  it('maps an oversized request body to 413 rather than 500', async () => {
    // body-parser rejects this before any route handler runs, so it reaches the
    // terminal backstop rather than a route catch block. The app mounts
    // `express.json({ limit: '256kb' })`, which this fixture mirrors.
    const jsonServer = await startTestServer((app) => {
      app.use(express.json({ limit: '1kb' }));
      app.post('/api/echo', (req, res) => res.json({ success: true }));
    });
    try {
      const oversized = await fetch(`${jsonServer.url}/api/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ padding: 'x'.repeat(4096) }),
      });
      assert.equal(oversized.status, 413);
      const parsed = await oversized.json();
      assert.equal(parsed.success, false);
      assert.equal(parsed.error.code, 'PAYLOAD_TOO_LARGE');

      const malformed = await fetch(`${jsonServer.url}/api/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ not json',
      });
      assert.equal(malformed.status, 400);
      assert.equal((await malformed.json()).error.code, 'VALIDATION_ERROR');
    } finally {
      await jsonServer.close();
    }
  });

  it('exposes a requestId that matches the X-Request-ID header', async () => {
    const res = await fetch(`${server.url}/api/caught`);
    const body = await res.json();
    assert.ok(body.error.requestId, 'expected a requestId in the error envelope');
    // Same id the server-side log is keyed by, so a user can quote it and the
    // developer can find the full diagnostic in the logs.
    assert.equal(body.error.requestId, res.headers.get('X-Request-ID'));
  });

  it('answers in the standard JSON envelope, never an HTML stack trace', async () => {
    const res = await fetch(`${server.url}/api/uncaught`);
    assert.equal(res.status, 500);
    const contentType = res.headers.get('content-type') || '';
    assert.ok(contentType.includes('application/json'), `expected JSON, got ${contentType}`);
    const body = await res.text();
    assertNoInternals(body);
    assert.equal(JSON.parse(body).error.message, GENERIC_ERROR_MESSAGE);
  });

  it('sanitises in development too, so no env can leak internals', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const res = await fetch(`${server.url}/api/caught-db`);
      const body = await res.text();
      assertNoInternals(body);
      assert.equal(JSON.parse(body).error.message, GENERIC_ERROR_MESSAGE);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
