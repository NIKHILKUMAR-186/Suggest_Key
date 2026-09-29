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

describe('readiness audit — capture after hold expiry', () => {
  // `isBookingPaymentDeadEnd` only treats CANCELLED/REJECTED/missing as a dead
  // end. Hold expiry cancels the booking LAZILY, inside booking creation, so a
  // capture landing after the hold elapsed but before anyone books the same
  // mentor again is applied to a booking that is still PAYMENT_PENDING.
  it('applies a capture to a booking whose hold already expired', async () => {
    const store = createFakeStore();
    seedProcessing(store);
    // The hold time has passed, but the booking row is still PAYMENT_PENDING
    // because no lazy expiry sweep has run for this mentor.
    store.seedHold({ status: 'ACTIVE', expires_at: new Date(NOW.getTime() - 60_000).toISOString() });

    const body = webhookBody({ paymentId: GATEWAY_PAYMENT_ID, eventId: 'evt_expired' });
    const result = await runRazorpayWebhook({
      rawBody: body,
      signature: signWebhook(body),
      gateway: createFakeGateway(),
      store,
      now: new Date(NOW.getTime() + 120_000),
    });

    assert.equal(result.ok, true);
    assert.equal(result.ok === true && result.handled, 'captured', 'the capture is applied as a success');
    assert.equal(result.ok === true && result.mentorNotified, true, 'and the mentor is notified');
    assert.equal(store.bookings.get(BOOKING_ID)?.status, 'MENTOR_PENDING');
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
