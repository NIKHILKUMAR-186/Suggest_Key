import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  runCreateRazorpayOrder,
  runRazorpayWebhook,
  runVerifyRazorpayPayment,
} from '../src/lib/razorpayService';
import {
  AMOUNT_INR,
  BOOKING_ID,
  HOLD_ID,
  NOW,
  ORDER_ID,
  SEEKER_ID,
  createFakeGateway,
  createFakeStore,
  signPayment,
  signWebhook,
  useRazorpayEnv,
  webhookBody,
} from './helpers/razorpayHarness';

let restore: () => void;
before(() => {
  restore = useRazorpayEnv();
});
after(() => restore());

const GATEWAY_PAYMENT_ID = 'pay_AUDIT_1';

/** A payment row mid-flight on a booking, as order creation leaves it. */
const seedProcessing = (store: ReturnType<typeof createFakeStore>) => {
  store.seedBooking({ status: 'PAYMENT_PENDING', hold_id: HOLD_ID });
  return store.attachGatewayOrder({
    bookingId: BOOKING_ID,
    seekerId: SEEKER_ID,
    amountInr: AMOUNT_INR,
    orderId: ORDER_ID,
    at: NOW.toISOString(),
  });
};

describe('readiness audit — webhook event coverage', () => {
  // A concrete gap, not a hypothetical: `payment.authorized` is declared in
  // RAZORPAY_WEBHOOK_EVENTS but has no dispatch case, so it falls through to
  // `handled: 'ignored'` and is acknowledged 200. If a test-mode dashboard is
  // configured to deliver only `payment.authorized` for some instruments, that
  // delivery would apply nothing.
  it('leaves payment.authorized unhandled and acknowledged', async () => {
    const store = createFakeStore();
    seedProcessing(store);

    const body = webhookBody({ event: 'payment.authorized' });
    const result = await runRazorpayWebhook({
      rawBody: body,
      signature: signWebhook(body),
      gateway: createFakeGateway(),
      store,
      now: NOW,
    });

    assert.equal(result.ok, true, 'the delivery is acknowledged');
    assert.equal(result.ok === true && result.handled, 'ignored', 'but nothing is applied to the payment');
    assert.equal(
      store.events.filter((e) => e.eventType === 'PAYMENT_CAPTURED').length,
      0,
      'no capture is recorded from an authorization alone',
    );
  });
describe('readiness audit — capture with a live hold is unchanged', () => {
  // Guards the other direction: the new check must not divert a capture that was
  // genuinely made inside the payment window. Test F - one second of headroom.
  it('confirms a capture made immediately before the hold expires', async () => {
    const store = createFakeStore();
    seedProcessing(store);
    // Expires exactly one second after the capture instant.
    const capturedAt = new Date(NOW.getTime() + 10_000);
    store.seedHold({ status: 'ACTIVE', expires_at: new Date(capturedAt.getTime() + 1_000).toISOString() });

    const body = webhookBody({ paymentId: GATEWAY_PAYMENT_ID, eventId: 'evt_in_time', createdAt: capturedAt });
    const result = await runRazorpayWebhook({
      rawBody: body,
      signature: signWebhook(body),
      gateway: createFakeGateway(),
      store,
      now: capturedAt,
    });

    assert.equal(result.ok === true && result.handled, 'captured');
    assert.equal(result.ok === true && result.mentorNotified, true);
    assert.equal(store.bookings.get(BOOKING_ID)?.status, 'MENTOR_PENDING');
    assert.equal([...store.payments.values()][0]?.status, 'VERIFIED');
  });

  // A redelivery arriving long after the hold has lapsed must NOT retroactively
  // invalidate a capture that was made in time. The check is evaluated against
  // the capture instant, not the delivery instant.
  it('does not invalidate an in-time capture on a very late redelivery', async () => {
    const store = createFakeStore();
    seedProcessing(store);
    const capturedAt = new Date(NOW.getTime() + 10_000);
    store.seedHold({ status: 'ACTIVE', expires_at: new Date(capturedAt.getTime() + 1_000).toISOString() });

    const body = webhookBody({ paymentId: GATEWAY_PAYMENT_ID, eventId: 'evt_late', createdAt: capturedAt });
    const result = await runRazorpayWebhook({
      rawBody: body,
      signature: signWebhook(body),
      gateway: createFakeGateway(),
      store,
      now: capturedAt,
    });

    assert.equal(result.ok === true && result.handled, 'captured');
    // Six hours later, well past the hold: a redelivery is a duplicate, not a
    // re-judgement, so the confirmed booking is left alone.
    const later = new Date(capturedAt.getTime() + 6 * 60 * 60 * 1000);
    const again = webhookBody({ paymentId: GATEWAY_PAYMENT_ID, eventId: 'evt_late_retry' });
    const redelivery = await runRazorpayWebhook({
      rawBody: again,
      signature: signWebhook(again),
      gateway: createFakeGateway(),
      store,
      now: later,
    });

    assert.equal(redelivery.ok, true);
    assert.equal(redelivery.ok === true && redelivery.handled, 'captured_duplicate');
    assert.equal(store.bookings.get(BOOKING_ID)?.status, 'MENTOR_PENDING', 'no regression');
    assert.equal([...store.payments.values()][0]?.status, 'VERIFIED');
  });

  it('accepts a CONVERTED hold, so a converted slot stays payable', async () => {
    const store = createFakeStore();
    seedProcessing(store);
    store.seedHold({ status: 'CONVERTED' });

    const body = webhookBody({ paymentId: GATEWAY_PAYMENT_ID, eventId: 'evt_converted' });
    const result = await runRazorpayWebhook({
      rawBody: body,
      signature: signWebhook(body),
      gateway: createFakeGateway(),
      store,
      now: NOW,
    });

    assert.equal(result.ok === true && result.handled, 'captured');
    assert.equal(store.bookings.get(BOOKING_ID)?.status, 'MENTOR_PENDING');
  });
});



describe('readiness audit — capture after hold expiry', () => {
  // THE REGRESSION TEST for the readiness blocker.
  //
  // Hold expiry cancels the booking LAZILY, inside booking creation, so a capture
  // landing after the hold elapsed but before anyone books the same mentor again
  // finds a row that is still PAYMENT_PENDING. This asserts the capture is
  // detected as expired and diverted, even though NOTHING swept the hold.
  it('refuses a capture on an unswept booking whose hold already expired', async () => {
    const store = createFakeStore();
    seedProcessing(store);
    // The hold time has passed, yet the booking is still PAYMENT_PENDING because
    // no lazy expiry sweep has run for this mentor. This is the exact state the
    // blocker exploited.
    store.seedHold({ status: 'ACTIVE', expires_at: new Date(NOW.getTime() - 60_000).toISOString() });
    assert.equal(store.bookings.get(BOOKING_ID)?.status, 'PAYMENT_PENDING', 'the sweep has NOT run');

    const body = webhookBody({ paymentId: GATEWAY_PAYMENT_ID, eventId: 'evt_expired' });
    const result = await runRazorpayWebhook({
      rawBody: body,
      signature: signWebhook(body),
      gateway: createFakeGateway(),
      store,
      now: new Date(NOW.getTime() + 120_000),
    });

    assert.equal(result.ok, true, 'the delivery is still acknowledged, so the gateway stops retrying');
    assert.equal(result.ok === true && result.handled, 'refund_pending', 'the capture is diverted, not confirmed');
    assert.equal(result.ok === true && result.mentorNotified, false, 'the mentor is NOT notified');
    assert.notEqual(store.bookings.get(BOOKING_ID)?.status, 'MENTOR_PENDING', 'the booking is NOT confirmed');

    // The money is still recorded and auditable, with its gateway identifier.
    const payment = [...store.payments.values()][0];
    assert.equal(payment?.status, 'FAILED');
    assert.equal(payment?.refund_status, 'PENDING', 'a refund is owed');
    assert.equal(payment?.razorpay_payment_id, GATEWAY_PAYMENT_ID, 'the capture stays traceable');
    assert.match(String(payment?.failure_reason), /hold expired/i);
    assert.equal(
      store.events.filter((e) => e.eventType === 'CAPTURE_AFTER_HOLD_EXPIRED').length,
      1,
      'the diversion is explicit in the event log',
    );
  });

  it('is idempotent when the expired capture is redelivered', async () => {
    const store = createFakeStore();
    seedProcessing(store);
    store.seedHold({ status: 'ACTIVE', expires_at: new Date(NOW.getTime() - 60_000).toISOString() });

    const deliver = async (eventId: string) => {
      const body = webhookBody({ paymentId: GATEWAY_PAYMENT_ID, eventId });
      return runRazorpayWebhook({
        rawBody: body,
        signature: signWebhook(body),
        gateway: createFakeGateway(),
        store,
        now: new Date(NOW.getTime() + 120_000),
      });
    };

    await deliver('evt_expired_1');
    // A DIFFERENT event id for the same capture: the ledger must not regress and
    // the mentor must not be notified a second time.
    const replay = await deliver('evt_expired_2');

    assert.equal(replay.ok, true);
    assert.equal(replay.ok === true && replay.mentorNotified, false, 'no duplicate notification');
    assert.notEqual(store.bookings.get(BOOKING_ID)?.status, 'MENTOR_PENDING', 'no state regression');
    assert.equal([...store.payments.values()][0]?.refund_status, 'PENDING', 'still refund-owed');
    assert.equal(
      store.events.filter((e) => e.eventType === 'PAYMENT_CAPTURED').length,
      0,
      'the capture is never recorded as a success',
    );
  });

  it('refuses a capture when the hold is no longer active', async () => {
    const store = createFakeStore();
    seedProcessing(store);
    store.seedHold({ status: 'RELEASED' });

    const body = webhookBody({ paymentId: GATEWAY_PAYMENT_ID, eventId: 'evt_released' });
    const result = await runRazorpayWebhook({
      rawBody: body,
      signature: signWebhook(body),
      gateway: createFakeGateway(),
      store,
      now: NOW,
    });

    assert.equal(result.ok === true && result.handled, 'refund_pending');
    assert.notEqual(store.bookings.get(BOOKING_ID)?.status, 'MENTOR_PENDING');
  });

  it('still refuses to confirm once the booking has actually been cancelled', async () => {
    const store = createFakeStore();
    seedProcessing(store);
    store.seedBooking({ status: 'CANCELLED', hold_id: HOLD_ID });

    const body = webhookBody({ paymentId: GATEWAY_PAYMENT_ID, eventId: 'evt_cancelled' });
    const result = await runRazorpayWebhook({
      rawBody: body,
      signature: signWebhook(body),
      gateway: createFakeGateway(),
      store,
      now: NOW,
    });

    assert.equal(result.ok, true, 'acknowledged, because it can never succeed');
    assert.equal(result.ok === true && result.handled, 'refund_pending', 'money is owed back, not earned');
    assert.equal(result.ok === true && result.mentorNotified, false);
    assert.notEqual(store.bookings.get(BOOKING_ID)?.status, 'MENTOR_PENDING');
  });
});

describe('readiness audit — test-mode gateway behaviour', () => {
  // Razorpay test mode answers a malformed request with a 400 and an error
  // envelope. The service must degrade to a clean, opaque 502 that reveals
  // nothing, and must not leave a payment row half-attached.
  it('maps a gateway 400 into an opaque 502 and attaches nothing', async () => {
    const store = createFakeStore();
    store.seedBooking({ status: 'PAYMENT_PENDING', hold_id: HOLD_ID });

    const gateway = {
      createOrder: async () => ({ ok: false as const, reason: 'gateway_status_400' }),
      fetchPayment: async () => ({ ok: false as const, reason: 'gateway_status_400' }),
      createRefund: async () => ({ ok: false as const, reason: 'gateway_status_400' }),
    };

    const result = await runCreateRazorpayOrder({
      bookingId: BOOKING_ID,
      callerId: SEEKER_ID,
      gateway,
      store,
      now: NOW,
    });

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.error.code, 'RAZORPAY_ORDER_FAILED');
    assert.equal(result.ok === false && result.error.httpStatus, 502);
    assert.doesNotMatch(result.ok === false ? result.error.message : '', /400|razorpay|key|secret/i);
    assert.equal(store.payments.size, 0, 'no payment row is attached to a failed order');
  });

  it('rejects a browser-reported payment whose order was never ours', async () => {
    const store = createFakeStore();
    assert.ok(seedProcessing(store));

    const result = await runVerifyRazorpayPayment({
      bookingId: BOOKING_ID,
      callerId: SEEKER_ID,
      // A real signature, but over an order this booking never created.
      razorpayOrderId: 'order_SOMEONE_ELSE',
      razorpayPaymentId: GATEWAY_PAYMENT_ID,
      razorpaySignature: signPayment('order_SOMEONE_ELSE', GATEWAY_PAYMENT_ID),
      gateway: createFakeGateway(),
      store,
      now: NOW,
    });

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.error.code, 'RAZORPAY_ORDER_MISMATCH');
    assert.notEqual(store.bookings.get(BOOKING_ID)?.status, 'MENTOR_PENDING');
  });

  it('treats a replayed verification as a duplicate, recorded exactly once', async () => {
    const store = createFakeStore();
    seedProcessing(store);

    const first = webhookBody({ paymentId: GATEWAY_PAYMENT_ID, eventId: 'evt_first' });
    await runRazorpayWebhook({
      rawBody: first,
      signature: signWebhook(first),
      gateway: createFakeGateway(),
      store,
      now: NOW,
    });

    // The browser re-posts the very same capture after already succeeding.
    const replay = await runVerifyRazorpayPayment({
      bookingId: BOOKING_ID,
      callerId: SEEKER_ID,
      razorpayOrderId: ORDER_ID,
      razorpayPaymentId: GATEWAY_PAYMENT_ID,
      razorpaySignature: signPayment(ORDER_ID, GATEWAY_PAYMENT_ID),
      gateway: createFakeGateway(),
      store,
      now: new Date(NOW.getTime() + 5_000),
    });

    assert.equal(replay.ok, true, 'a duplicate is a success, not an error');
    assert.equal(replay.ok === true && replay.value.duplicate, true);
    assert.equal(
      store.events.filter((e) => e.eventType === 'PAYMENT_CAPTURED').length,
      1,
      'the capture is recorded exactly once',
    );
  });
});

});
