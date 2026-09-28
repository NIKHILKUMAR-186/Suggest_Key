import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { runRazorpayWebhook } from '../src/lib/razorpayService';
import {
  AMOUNT_INR,
  BOOKING_ID,
  NOW,
  ORDER_ID,
  PAYMENT_ID,
  SEEKER_ID,
  createFakeGateway,
  createFakeStore,
  eventIdOf,
  signWebhook,
  useRazorpayEnv,
  webhookBody,
} from './helpers/razorpayHarness';

/**
 * Webhook idempotency, against the real implementation.
 *
 * The previous version of this file built its own `Map`-based "store" and
 * asserted against that, so it tested nothing but its own test code. Every
 * assertion below drives the real `runRazorpayWebhook`; the only substitute is
 * the database port, whose conditional-update and claim semantics the harness
 * reproduces (the adapter's own query shapes are pinned separately in
 * `razorpay_store.test.ts`).
 *
 * Three properties are being protected, and they are not the same property:
 *   1. EVENT IDEMPOTENCY - the same delivery twice is applied once, because
 *      `webhook_events` is UNIQUE (gateway, event_id) and a completed claim is
 *      skipped.
 *   2. BUSINESS IDEMPOTENCY - two DIFFERENT event ids describing the same
 *      capture are still applied once, because the payment transition is a
 *      conditional update. This is the property that protects the money if
 *      Razorpay ever re-signs a replay.
 *   3. NO PAYMENT LOSS - a delivery whose processing failed is left UNPROCESSED
 *      so Razorpay's own retry resumes it, rather than being acknowledged as a
 *      duplicate and dropped.
 */

let restoreEnv: () => void;
before(() => {
  restoreEnv = useRazorpayEnv();
});
after(() => {
  restoreEnv();
});

/** A booking with a live Razorpay order, i.e. one webhook can act on. */
async function withInFlightOrder() {
  const store = createFakeStore();
  store.seedBooking();
  store.seedHold();
  // The order row is what the webhook resolves the payment through.
  await store.attachGatewayOrder({
    bookingId: BOOKING_ID,
    seekerId: SEEKER_ID,
    amountInr: AMOUNT_INR,
    orderId: ORDER_ID,
    at: NOW.toISOString(),
  });
  return { store, gateway: createFakeGateway({ orderId: ORDER_ID }) };
}

const deliver = (
  store: Awaited<ReturnType<typeof withInFlightOrder>>['store'],
  body: string,
  gateway: ReturnType<typeof createFakeGateway>,
) =>
  runRazorpayWebhook({ rawBody: body, signature: signWebhook(body), gateway, store, now: NOW });

// ---------------------------------------------------------------------------
// 1. Event idempotency
// ---------------------------------------------------------------------------

describe('razorpay webhook: event idempotency', () => {
  it('claims a first delivery as new and marks it processed once it succeeds', async () => {
    const { store, gateway } = await withInFlightOrder();
    const body = webhookBody({ paymentId: 'pay_OK' });

    const result = await deliver(store, body, gateway);

    assert.ok(result.ok);
    assert.ok(result.ok && result.duplicateEvent === false);
    assert.equal(store.webhookClaims.get(`razorpay:${eventIdOf(body)}`), true);
  });

  it('acknowledges a replay of the same delivery without re-applying it', async () => {
    const { store, gateway } = await withInFlightOrder();
    const body = webhookBody({ paymentId: 'pay_OK' });

    await deliver(store, body, gateway);
    const replay = await deliver(store, body, gateway);
    const replayAgain = await deliver(store, body, gateway);

    assert.ok(replay.ok && replay.duplicateEvent === true && replay.handled === 'duplicate');
    assert.ok(replayAgain.ok && replayAgain.handled === 'duplicate');
    // One capture, one booking transition, one notification - not three.
    assert.equal(store.events.filter((e) => e.eventType === 'PAYMENT_CAPTURED').length, 1);
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'VERIFIED');
  });

  it('keys the claim on the gateway event id when the delivery carries one', async () => {
    // With a header event id, two byte-different bodies describing the same
    // event must still collapse onto one claim.
    const { store, gateway } = await withInFlightOrder();
    const first = webhookBody({ paymentId: 'pay_OK', eventId: 'evt_gateway_1', extra: { created_at: 1 } });
    const second = webhookBody({ paymentId: 'pay_OK', eventId: 'evt_gateway_1', extra: { created_at: 2 } });
    assert.notEqual(first, second, 'the two deliveries differ byte-for-byte');

    await deliver(store, first, gateway);
    const secondDelivery = await deliver(store, second, gateway);

    assert.equal(store.webhookClaims.get('razorpay:evt_gateway_1'), true);
    assert.ok(secondDelivery.ok && secondDelivery.handled === 'duplicate');
  });
});

// ---------------------------------------------------------------------------
// 2. Business idempotency
// ---------------------------------------------------------------------------

describe('razorpay webhook: business idempotency', () => {
  it('applies one capture once even when two different events describe it', async () => {
    const { store, gateway } = await withInFlightOrder();

    // Same gateway payment id, different event id: the event key cannot catch
    // this, so the conditional update on the payment row has to.
    const first = webhookBody({ paymentId: 'pay_OK', eventId: 'evt_a' });
    const second = webhookBody({ paymentId: 'pay_OK', eventId: 'evt_b' });

    const a = await deliver(store, first, gateway);
    const b = await deliver(store, second, gateway);

    assert.ok(a.ok && a.handled === 'captured' && a.mentorNotified === true);
    // The second is recognised as the same payment, not a new one.
    assert.ok(b.ok && b.handled === 'captured_duplicate');
    assert.ok(b.ok && b.mentorNotified === false, 'the mentor must be notified once per payment');
    assert.equal(store.events.filter((e) => e.eventType === 'PAYMENT_CAPTURED').length, 1);
  });

  it('notifies the mentor once across a browser verification and every webhook', async () => {
    const { store, gateway } = await withInFlightOrder();
    const body = webhookBody({ paymentId: 'pay_OK' });

    // The browser already confirmed; the webhook is only a safety net here.
    await store.markPaymentCaptured({ paymentId: PAYMENT_ID, gatewayPaymentId: 'pay_OK', signature: null, capturedAt: NOW.toISOString(), payload: null });
    await store.markBookingMentorPending(BOOKING_ID, NOW.toISOString());

    const result = await deliver(store, body, gateway);

    assert.ok(result.ok);
    assert.ok(result.ok && result.mentorNotified === false);
    assert.equal(store.events.filter((e) => e.eventType === 'PAYMENT_CAPTURED').length, 0);
  });
});

// ---------------------------------------------------------------------------
// 3. No payment loss on a failed attempt
// ---------------------------------------------------------------------------

describe('razorpay webhook: a failed attempt is retried, not dropped', () => {
  it('leaves the claim unprocessed when processing throws, so a retry can resume it', async () => {
    const { store, gateway } = await withInFlightOrder();
    const body = webhookBody({ paymentId: 'pay_OK' });
    const key = `razorpay:${eventIdOf(body)}`;

    // The capture lands, then advancing the booking fails: a realistic partial
    // failure that used to strand a paid booking in PAYMENT_PENDING forever.
    const realAdvance = store.markBookingMentorPending;
    let armed = true;
    store.markBookingMentorPending = async (bookingId: string, at: string) => {
      if (armed) {
        armed = false;
        throw new Error('transient database failure');
      }
      return realAdvance(bookingId, at);
    };

    await assert.rejects(() => deliver(store, body, gateway), /transient database failure/);
    assert.equal(store.webhookClaims.get(key), false, 'an unprocessed delivery must stay resumable');

    const retry = await deliver(store, body, gateway);

    assert.ok(retry.ok);
    assert.ok(retry.ok && retry.duplicateEvent === true, 'a resume is reported to the caller as a duplicate');
    assert.ok(retry.ok && retry.handled !== 'duplicate', 'but the capture is still applied');
    assert.equal(store.webhookClaims.get(key), true);
    assert.equal(store.events.filter((e) => e.eventType === 'PAYMENT_CAPTURED').length, 1, 'and still only once');
  });

  it('never claims a delivery whose signature did not verify', async () => {
    const { store, gateway } = await withInFlightOrder();
    const body = webhookBody({ paymentId: 'pay_OK' });

    const result = await runRazorpayWebhook({ rawBody: body, signature: 'f'.repeat(64), gateway, store });

    assert.ok(!result.ok);
    assert.equal(store.webhookClaims.size, 0, 'a forged delivery must not occupy the event table');
  });
});

// ---------------------------------------------------------------------------
// Deliveries that are acknowledged rather than applied
// ---------------------------------------------------------------------------

describe('razorpay webhook: acknowledged deliveries', () => {
  it('marks an unmatched capture processed, so Razorpay stops retrying it', async () => {
    const store = createFakeStore();
    const body = webhookBody({ orderId: 'order_NOT_OURS', paymentId: 'pay_NOT_OURS' });

    const result = await deliver(store, body, createFakeGateway({ orderId: 'order_NOT_OURS' }));

    assert.ok(result.ok && result.handled === 'unmatched');
    assert.equal(store.webhookClaims.get(`razorpay:${eventIdOf(body)}`), true);
    assert.equal(store.payments.size, 0, 'nothing is written for a payment we do not own');
  });

  it('marks an unrecognised event type processed and applies nothing', async () => {
    const { store, gateway } = await withInFlightOrder();
    const body = webhookBody({ paymentId: 'pay_OK', event: 'subscription.charged' });

    const result = await deliver(store, body, gateway);

    assert.ok(result.ok && result.handled === 'ignored');
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'PAYMENT_PROCESSING');
  });

  it('records one failure event however many times the failure is redelivered', async () => {
    const { store, gateway } = await withInFlightOrder();
    const body = webhookBody({ paymentId: 'pay_FAIL', event: 'payment.failed', errorDescription: 'Your card was declined.' });

    const first = await deliver(store, body, gateway);
    const replay = await deliver(store, body, gateway);

    assert.ok(first.ok && first.handled === 'failed');
    assert.ok(replay.ok && replay.handled === 'duplicate');
    assert.equal(store.events.filter((e) => e.eventType === 'PAYMENT_FAILED').length, 1);
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'FAILED');
  });
});
