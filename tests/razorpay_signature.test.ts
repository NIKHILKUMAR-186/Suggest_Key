import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import express from 'express';
import type { AddressInfo } from 'net';

import {
  extractWebhookEventId,
  extractWebhookSignature,
  verifyPaymentSignature,
  verifyRazorpaySignature,
  verifyWebhookSignature,
} from '../src/lib/razorpaySignature';
import { runRazorpayWebhook } from '../src/lib/razorpayService';
import {
  KEY_SECRET,
  WEBHOOK_SECRET,
  createFakeStore,
  signWebhook,
  useRazorpayEnv,
  webhookBody,
  type FakeStore,
} from './helpers/razorpayHarness';

/**
 * Signature verification, against the real implementation.
 *
 * The previous version of this file re-implemented HMAC-SHA256 in the test and
 * asserted against its own copy of the algorithm, so it proved only that Node's
 * `createHmac` is self-consistent - it would have passed unchanged if
 * `src/lib/razorpaySignature.ts` had been deleted. Every assertion below now
 * calls the production functions; the only independent oracle is Node's own
 * `createHmac`, which is what Razorpay itself uses.
 *
 * The last section is the one that matters most: the webhook signature is
 * verified through a real Express server using the same body-parser
 * configuration and the same route handler wiring as `server.ts`, because the
 * signature covers the RAW request bytes and `req.body` is a re-parse of them.
 * `server.ts` builds its app inside `startServer()` and does not export it, so
 * the middleware and handler are reproduced here verbatim rather than imported;
 * the verification code they call IS the production code.
 */

let restoreEnv: () => void;
before(() => {
  restoreEnv = useRazorpayEnv();
});
after(() => {
  restoreEnv();
});

// ---------------------------------------------------------------------------
// Primitive
// ---------------------------------------------------------------------------

describe('razorpay signature: primitive', () => {
  it('matches the HMAC-SHA256 hex digest Razorpay produces for the payload', () => {
    const body = '{"event":"payment.captured"}';
    const oracle = createHmac('sha256', WEBHOOK_SECRET).update(body, 'utf8').digest('hex');

    assert.equal(verifyRazorpaySignature(body, oracle, WEBHOOK_SECRET), true);
  });

  it('accepts a correct signature and rejects a body tampered with after signing', () => {
    const signed = webhookBody({ amount: 99900 });
    const tampered = webhookBody({ amount: 100 });

    assert.equal(verifyRazorpaySignature(signed, signWebhook(signed), WEBHOOK_SECRET), true);
    assert.equal(verifyRazorpaySignature(tampered, signWebhook(signed), WEBHOOK_SECRET), false);
  });

  it('rejects a payload signed with a different secret', () => {
    const body = webhookBody();
    const foreign = createHmac('sha256', 'a-different-webhook-secret').update(body).digest('hex');

    assert.equal(verifyRazorpaySignature(body, foreign, WEBHOOK_SECRET), false);
  });

  it('rejects a signature of a different length or algorithm', () => {
    const body = webhookBody();
    const sha512 = createHmac('sha512', WEBHOOK_SECRET).update(body).digest('hex');

    assert.equal(verifyRazorpaySignature(body, 'a'.repeat(40), WEBHOOK_SECRET), false);
    assert.equal(verifyRazorpaySignature(body, sha512, WEBHOOK_SECRET), false);
  });

  it('never verifies an empty signature, an empty body, or a missing secret', () => {
    assert.equal(verifyRazorpaySignature('', '', WEBHOOK_SECRET), false);
    assert.equal(verifyRazorpaySignature('body', '', WEBHOOK_SECRET), false);
    assert.equal(verifyRazorpaySignature('body', 'a'.repeat(64), ''), false);
  });

  it('verifies bodies whose byte layout differs, so it is really byte-exact', () => {
    const a = '{"event":"payment.captured","payload":{}}';
    const b = '{"payload":{},"event":"payment.captured"}';
    // Same JSON value, different bytes: only the exact signed bytes verify.
    assert.equal(verifyRazorpaySignature(a, signWebhook(a), WEBHOOK_SECRET), true);
    assert.equal(verifyRazorpaySignature(b, signWebhook(a), WEBHOOK_SECRET), false);
  });
});

// ---------------------------------------------------------------------------
// Webhook signature
// ---------------------------------------------------------------------------

describe('razorpay signature: webhook', () => {
  it('verifies against the configured webhook secret', () => {
    const body = webhookBody({ paymentId: 'pay_X' });
    assert.equal(verifyWebhookSignature({ body, signature: signWebhook(body) }), true);
  });

  it('rejects a signature minted with the KEY secret instead of the webhook secret', () => {
    const body = webhookBody();
    const wrongSecret = createHmac('sha256', KEY_SECRET).update(body).digest('hex');

    assert.equal(verifyWebhookSignature({ body, signature: wrongSecret }), false);
  });

  it('fails closed when the webhook secret is not configured', () => {
    const previous = process.env.RAZORPAY_WEBHOOK_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    try {
      const body = webhookBody();
      assert.equal(verifyWebhookSignature({ body, signature: signWebhook(body) }), false);
    } finally {
      process.env.RAZORPAY_WEBHOOK_SECRET = previous;
    }
  });
});

// ---------------------------------------------------------------------------
// Payment signature
// ---------------------------------------------------------------------------

describe('razorpay signature: payment verification', () => {
  it('verifies over "<order_id>|<payment_id>" in that order', () => {
    const signature = createHmac('sha256', KEY_SECRET).update('order_1|pay_1').digest('hex');

    assert.equal(verifyPaymentSignature({ orderId: 'order_1', paymentId: 'pay_1', signature }), true);
    // A signature harvested from one payment must not replay onto another.
    assert.equal(verifyPaymentSignature({ orderId: 'order_1', paymentId: 'pay_2', signature }), false);
    assert.equal(verifyPaymentSignature({ orderId: 'order_2', paymentId: 'pay_1', signature }), false);
  });

  it('fails closed when the key secret is not configured', () => {
    const previous = process.env.RAZORPAY_KEY_SECRET;
    delete process.env.RAZORPAY_KEY_SECRET;
    try {
      assert.equal(verifyPaymentSignature({ orderId: 'o', paymentId: 'p', signature: 'x' }), false);
    } finally {
      process.env.RAZORPAY_KEY_SECRET = previous;
    }
  });
});

// ---------------------------------------------------------------------------
// Header extraction
// ---------------------------------------------------------------------------

describe('razorpay signature: header extraction', () => {
  it('reads the signature header regardless of header casing', () => {
    const headers = { 'x-razorpay-signature': '  abc123  ' };
    assert.equal(extractWebhookSignature(headers), 'abc123');
    assert.equal(extractWebhookSignature({ 'X-Razorpay-Signature': 'abc123' }), 'abc123');
  });

  it('returns null for a missing, blank, or non-string header', () => {
    assert.equal(extractWebhookSignature(undefined), null);
    assert.equal(extractWebhookSignature({}), null);
    assert.equal(extractWebhookSignature({ 'x-razorpay-signature': '   ' }), null);
    assert.equal(extractWebhookSignature({ 'x-razorpay-signature': ['abc'] }), null);
  });

  it('reads the event id header, which the parser falls back from', () => {
    assert.equal(extractWebhookEventId({ 'X-Razorpay-Event-Id': 'evt_1' }), 'evt_1');
    assert.equal(extractWebhookEventId({}), null);
  });
});

// ---------------------------------------------------------------------------
// Through a real Express route
// ---------------------------------------------------------------------------

interface TestServer {
  url: string;
  close: () => Promise<void>;
  store: FakeStore;
  /** The exact bytes the handler received, for byte-exactness assertions. */
  received: string[];
}

/**
 * Boots a real Express server with the production body-parser configuration
 * (`server.ts:1311`) and a handler wired the way `POST /api/webhooks/razorpay`
 * is wired (`server.ts:2621`): the raw body is read from the buffer stashed by
 * `verify`, never from `req.body`, and the signature comes from the header.
 */
async function startWebhookServer(): Promise<TestServer> {
  const app = express();
  const store = createFakeStore();
  const received: string[] = [];

  app.use(
    express.json({
      limit: '256kb',
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
      },
    }),
  );

  app.post('/api/webhooks/razorpay', async (req: express.Request, res) => {
    const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody?.toString('utf8') ?? '';
    if (!rawBody) {
      return res.status(400).json({ success: false, error: { code: 'RAZORPAY_WEBHOOK_EMPTY', message: 'Empty webhook body.' } });
    }
    received.push(rawBody);

    const result = await runRazorpayWebhook({
      rawBody,
      signature: extractWebhookSignature(req.headers as unknown as Record<string, unknown>),
      gateway: { createOrder: async () => ({ ok: false as const, reason: 'x' }), fetchPayment: async () => ({ ok: false as const, reason: 'x' }), createRefund: async () => ({ ok: false as const, reason: 'x' }) },
      store,
    });

    if (!result.ok) {
      return res.status(result.error.httpStatus).json({
        success: false,
        error: { code: result.error.code, message: result.error.message },
      });
    }
    return res.json({ success: true, handled: result.handled, duplicate: result.duplicateEvent });
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/api/webhooks/razorpay`,
    store,
    received,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

const post = (url: string, body: string, headers: Record<string, string>) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

describe('razorpay signature: verification through the Express route', () => {
  it('accepts a correctly signed delivery and hands the handler the exact bytes', async () => {
    const server = await startWebhookServer();
    try {
      const body = webhookBody({ paymentId: 'pay_UNKNOWN' });
      const res = await post(server.url, body, { 'x-razorpay-signature': signWebhook(body) });

      // Nothing in this fixture is ours, so the capture cannot be matched. Since
      // P0-1 that is a recorded, retryable failure rather than a 200: a signed
      // capture of unknown money must never be acknowledged as processed.
      // What this test still proves is signature acceptance and byte-exactness.
      assert.equal(res.status, 503);
      const payload = (await res.json()) as { success: boolean; error: { code: string } };
      assert.equal(payload.success, false);
      assert.equal(payload.error.code, 'RAZORPAY_CAPTURE_UNMATCHED');
      // The bytes the handler verified are the bytes that were sent.
      assert.equal(server.received[0], body);
    } finally {
      await server.close();
    }
  });

  it('rejects a delivery whose body was re-serialised after signing', async () => {
    const server = await startWebhookServer();
    try {
      // Same JSON value, different bytes: only the raw signed bytes verify.
      const signed = '{"event":"payment.captured","payload":{"payment":{"id":"pay_1"}}}';
      const reserialized = '{"payload":{"payment":{"id":"pay_1"}},"event":"payment.captured"}';
      const res = await post(server.url, reserialized, { 'x-razorpay-signature': signWebhook(signed) });

      assert.equal(res.status, 400);
      const payload = (await res.json()) as { error: { code: string } };
      assert.equal(payload.error.code, 'RAZORPAY_SIGNATURE_INVALID');
    } finally {
      await server.close();
    }
  });

  it('rejects a delivery with no signature header', async () => {
    const server = await startWebhookServer();
    try {
      const res = await post(server.url, webhookBody(), {});
      const payload = (await res.json()) as { error: { code: string } };

      assert.equal(res.status, 400);
      assert.equal(payload.error.code, 'RAZORPAY_SIGNATURE_MISSING');
    } finally {
      await server.close();
    }
  });

  it('rejects a delivery signed with a foreign secret and writes nothing', async () => {
    const server = await startWebhookServer();
    try {
      const body = webhookBody({ paymentId: 'pay_ATTACKER' });
      const foreign = createHmac('sha256', 'attacker-controlled').update(body).digest('hex');
      const res = await post(server.url, body, { 'x-razorpay-signature': foreign });

      assert.equal(res.status, 400);
      // An unverified delivery is never claimed and never applied.
      assert.equal(server.store.webhookClaims.size, 0);
      assert.equal(server.store.payments.size, 0);
    } finally {
      await server.close();
    }
  });

  it('rejects an empty body before verification', async () => {
    const server = await startWebhookServer();
    try {
      const res = await post(server.url, '', { 'x-razorpay-signature': 'a'.repeat(64) });
      const payload = (await res.json()) as { error: { code: string } };

      assert.equal(res.status, 400);
      assert.equal(payload.error.code, 'RAZORPAY_WEBHOOK_EMPTY');
    } finally {
      await server.close();
    }
  });
});
