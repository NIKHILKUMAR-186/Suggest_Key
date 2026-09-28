import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'net';
import {
  RATE_LIMIT_MESSAGE,
  API_RATE_LIMIT,
  EXPENSIVE_RATE_LIMIT,
  apiRateLimiter,
  expensiveRouteLimiter,
} from '../src/lib/rateLimit';

interface TestServer {
  url: string;
  close: () => Promise<void>;
}

async function startTestServer(
  register: (app: express.Express) => void,
): Promise<TestServer> {
  const app = express();
  // One proxy hop, matching production, so X-Forwarded-For drives req.ip.
  app.set('trust proxy', 1);
  register(app);

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

async function hit(
  url: string,
  options: { ip: string; userId?: string },
): Promise<Response> {
  return fetch(url, {
    headers: {
      'X-Forwarded-For': options.ip,
      ...(options.userId ? { 'X-Test-User': options.userId } : {}),
    },
  });
}

describe('API rate limiting', () => {
  let server: TestServer;

  before(async () => {
    server = await startTestServer((app) => {
      // Mirrors the real ordering: the strict limiter runs after requireAuth,
      // so req.auth is populated before the key is generated.
      app.get('/api/expensive', (req, res) => {
        (req as any).auth = (req as any).auth ?? { user: { id: req.headers['x-test-user'] } };
        expensiveRouteLimiter(req, res, () => {
          res.json({ success: true });
        });
      });
      app.use('/api', apiRateLimiter);
      app.get('/api/ping', (_req, res) => {
        res.json({ success: true });
      });
    });
  });

  after(async () => {
    await server.close();
  });

  it('allows 10 requests per minute on an expensive route, then returns 429', async () => {
    const ip = '203.0.113.10';

    for (let attempt = 1; attempt <= EXPENSIVE_RATE_LIMIT; attempt += 1) {
      const res = await hit(`${server.url}/api/expensive`, { ip, userId: `u-${ip}` });
      assert.equal(res.status, 200, `request ${attempt} should pass`);
    }

    const blocked = await hit(`${server.url}/api/expensive`, { ip, userId: `u-${ip}` });
    assert.equal(blocked.status, 429);

    const body = await blocked.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'RATE_LIMITED');
    assert.equal(body.error.message, RATE_LIMIT_MESSAGE);
  });

  it('gives each authenticated user their own expensive-route budget', async () => {
    const ip = '203.0.113.20';

    for (let attempt = 0; attempt <= EXPENSIVE_RATE_LIMIT; attempt += 1) {
      await hit(`${server.url}/api/expensive`, { ip, userId: 'user-noisy' });
    }

    const blocked = await hit(`${server.url}/api/expensive`, { ip, userId: 'user-noisy' });
    assert.equal(blocked.status, 429, 'the noisy user stays blocked');

    const other = await hit(`${server.url}/api/expensive`, { ip, userId: 'user-quiet' });
    assert.equal(other.status, 200, 'a different user is unaffected by the noisy one');
  });

  it('keys unauthenticated callers by IP address', async () => {
    const ip = '203.0.113.30';

    for (let attempt = 0; attempt <= EXPENSIVE_RATE_LIMIT; attempt += 1) {
      await hit(`${server.url}/api/expensive`, { ip });
    }

    const blocked = await hit(`${server.url}/api/expensive`, { ip });
    assert.equal(blocked.status, 429, 'the same IP stays blocked');

    const other = await hit(`${server.url}/api/expensive`, { ip: '203.0.113.31' });
    assert.equal(other.status, 200, 'a different IP gets its own budget');
  });

  it('advertises the standard RateLimit headers', async () => {
    const res = await hit(`${server.url}/api/ping`, { ip: '203.0.113.40' });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('ratelimit'), 'RateLimit header should be present');
  });

  it('allows ordinary API traffic well past the expensive budget', async () => {
    assert.ok(API_RATE_LIMIT > EXPENSIVE_RATE_LIMIT, 'the general tier must be the looser one');

    for (let attempt = 0; attempt <= EXPENSIVE_RATE_LIMIT; attempt += 1) {
      const res = await hit(`${server.url}/api/ping`, { ip: '203.0.113.50' });
      assert.equal(res.status, 200, `request ${attempt + 1} should pass the general limiter`);
    }
  });
});
