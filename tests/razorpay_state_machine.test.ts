import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { runCreateRazorpayOrder, runRazorpayWebhook, runVerifyRazorpayPayment } from '../src/lib/razorpayService';
import { isPayableBookingStatus } from '../src/lib/paymentProof';
import { RAZORPAY_ORDER_EXPIRY_SECONDS } from '../src/lib/razorpayConfig';
import { APP_CONFIG } from '../src/config/app';
import {
  AMOUNT_INR,
  BOOKING_ID,
  NOW,
  ORDER_ID,
  OTHER_SEEKER_ID,
  PAYMENT_ID,
  SEEKER_ID,
  createFakeGateway,
  createFakeStore,
  signPayment,
  signWebhook,
  useRazorpayEnv,
  webhookBody,
  type FakeStore,
} from './helpers/razorpayHarness';

/**
 * The booking/payment state machine, against the real implementation.
 *
 * The previous version of this file asserted that two local constants differed
 * from each other (`assert.notEqual(1299, 1)`) and re-implemented
 * `isPayableBookingStatus` locally, so it exercised no production code at all.
 * Everything below drives `runCreateRazorpayOrder`, `runVerifyRazorpayPayment`
 * and `runRazorpayWebhook` and then reads the resulting rows back.
 *
 * The transitions under review, exactly as they occur in production:
 *
 *   order created        booking  PAYMENT_PENDING   (unchanged)
 *                        payment  PAYMENT_PROCESSING (new row)
 *   payment captured     booking  MENTOR_PENDING
 *                        payment  VERIFIED
 *   payment failed       booking  PAYMENT_PENDING   (unchanged)
 *                        payment  FAILED
 *
 * The booking deliberately never sits in PAYMENT_PROCESSING: the hold-expiry
 * cron only cancels PAYMENT_PENDING bookings, so parking an unpaid order in any
 * other state would strand a booking whose hold has elapsed.
 */

let restoreEnv: () => void;
before(() => {
  restoreEnv = useRazorpayEnv();
});
after(() => {
  restoreEnv();
});

/** A booking with an active hold and a live Razorpay order. */
async function withInFlightOrder() {
  const store = createFakeStore();
  store.seedBooking();
  store.seedHold();
  const gateway = createFakeGateway({ orderId: ORDER_ID });
  const created = await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway, store, now: NOW });
  assert.ok(created.ok, 'fixture: the order must be created');
  return { store, gateway, orderId: created.ok ? created.value.razorpayOrderId : ORDER_ID };
}

const verify = (store: FakeStore, gateway: ReturnType<typeof createFakeGateway>, orderId: string, paymentId: string, signature?: string) =>
  runVerifyRazorpayPayment({
    bookingId: BOOKING_ID,
    callerId: SEEKER_ID,
    razorpayOrderId: orderId,
    razorpayPaymentId: paymentId,
    razorpaySignature: signature ?? signPayment(orderId, paymentId),
    gateway,
    store,
    now: NOW,
  });

const webhook = (store: FakeStore, gateway: ReturnType<typeof createFakeGateway>, body: string) =>
  runRazorpayWebhook({ rawBody: body, signature: signWebhook(body), gateway, store, now: NOW });

// ---------------------------------------------------------------------------
// After order creation
// ---------------------------------------------------------------------------

describe('razorpay state machine: after order creation', () => {
  it('leaves the booking PAYMENT_PENDING and opens a PAYMENT_PROCESSING payment', async () => {
    const store = createFakeStore();
    store.seedBooking();
    store.seedHold();

    const result = await runCreateRazorpayOrder({
      bookingId: BOOKING_ID,
      callerId: SEEKER_ID,
      gateway: createFakeGateway({ orderId: ORDER_ID }),
      store,
      now: NOW,
    });

    assert.ok(result.ok);
    // The booking is untouched, so the hold-expiry cron can still cancel it.
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'PAYMENT_PENDING');
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'PAYMENT_PROCESSING');
    assert.equal(store.payments.get(PAYMENT_ID)!.gateway, 'razorpay');
    // The amount is the server's snapshot, in the column's own units.
    assert.equal(store.payments.get(PAYMENT_ID)!.amount_inr, AMOUNT_INR);
    assert.equal(store.payments.get(PAYMENT_ID)!.razorpay_payment_id, null);
  });

  it('never moves the booking into PAYMENT_PROCESSING, which the cron cannot cancel', async () => {
    const store = createFakeStore();
    store.seedBooking();
    store.seedHold();
    await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway: createFakeGateway(), store, now: NOW });

    // `expire_stale_holds()` cancels only PAYMENT_PENDING bookings, so an unpaid
    // order must still be in a state that cron acts on.
    assert.equal(isPayableBookingStatus(store.bookings.get(BOOKING_ID)!.status), true);
    assert.notEqual(store.bookings.get(BOOKING_ID)!.status, 'PAYMENT_PROCESSING');
  });

  it('refuses an order for a booking the caller does not own, without writing a payment', async () => {
    const store = createFakeStore();
    store.seedBooking();
    store.seedHold();

    const result = await runCreateRazorpayOrder({
      bookingId: BOOKING_ID,
      callerId: OTHER_SEEKER_ID,
      gateway: createFakeGateway(),
      store,
      now: NOW,
    });

    assert.ok(!result.ok && result.error.code === 'FORBIDDEN_NOT_BOOKING_OWNER');
    assert.equal(store.payments.size, 0);
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'PAYMENT_PENDING');
  });
});

// ---------------------------------------------------------------------------
// After a successful payment
// ---------------------------------------------------------------------------

describe('razorpay state machine: after a successful payment', () => {
  it('moves the booking to MENTOR_PENDING and the payment to VERIFIED', async () => {
    const { store, gateway, orderId } = await withInFlightOrder();

    const result = await verify(store, gateway, orderId, 'pay_OK');

    assert.ok(result.ok);
    assert.ok(result.ok && result.value.bookingStatus === 'MENTOR_PENDING');
    assert.ok(result.ok && result.value.paymentStatus === 'VERIFIED');
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'MENTOR_PENDING');
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'VERIFIED');
    assert.equal(store.payments.get(PAYMENT_ID)!.razorpay_payment_id, 'pay_OK');
    assert.equal(store.payments.get(PAYMENT_ID)!.captured_at, NOW.toISOString());
    // The mentor still has to confirm: the gateway never confirms for them.
    assert.notEqual(store.bookings.get(BOOKING_ID)!.status, 'CONFIRMED');
  });

  it('notifies the mentor exactly once across repeated verifications', async () => {
    const { store, gateway, orderId } = await withInFlightOrder();

    const first = await verify(store, gateway, orderId, 'pay_OK');
    const second = await verify(store, gateway, orderId, 'pay_OK');

    assert.ok(first.ok && first.value.mentorNotified === true);
    assert.ok(second.ok && second.value.duplicate === true && second.value.mentorNotified === false);
    assert.equal(store.events.filter((e) => e.eventType === 'PAYMENT_CAPTURED').length, 1);
  });

  it('does not transition on a signature that does not verify', async () => {
    const { store, gateway, orderId } = await withInFlightOrder();

    const result = await verify(store, gateway, orderId, 'pay_OK', 'f'.repeat(64));

    assert.ok(!result.ok && result.error.code === 'RAZORPAY_SIGNATURE_INVALID');
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'PAYMENT_PROCESSING');
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'PAYMENT_PENDING');
  });

  it('does not transition on a gateway amount that disagrees with the booking', async () => {
    const { store, orderId } = await withInFlightOrder();

    const result = await verify(store, createFakeGateway({ orderId, amountPaise: 1 }), orderId, 'pay_OK');

    assert.ok(!result.ok && result.error.code === 'RAZORPAY_AMOUNT_MISMATCH');
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'PAYMENT_PROCESSING');
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'PAYMENT_PENDING');
  });

  it('reaches the same end state when the webhook arrives before the browser', async () => {
    const { store, gateway, orderId } = await withInFlightOrder();

    const result = await webhook(store, gateway, webhookBody({ orderId, paymentId: 'pay_OK' }));
    const late = await verify(store, gateway, orderId, 'pay_OK');

    assert.ok(result.ok && result.handled === 'captured');
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'MENTOR_PENDING');
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'VERIFIED');
    // The browser reporting the same payment afterwards changes nothing.
    assert.ok(late.ok && late.value.duplicate === true && late.value.mentorNotified === false);
  });
});

// ---------------------------------------------------------------------------
// After a failure
// ---------------------------------------------------------------------------

describe('razorpay state machine: after a failed payment', () => {
  it('marks the payment FAILED, leaves the booking payable, and notifies nobody', async () => {
    const { store, gateway, orderId } = await withInFlightOrder();

    const body = webhookBody({ orderId, paymentId: 'pay_FAIL', event: 'payment.failed', errorDescription: 'Your card was declined.' });
    const result = await webhook(store, gateway, body);

    assert.ok(result.ok && result.handled === 'failed');
    assert.ok(result.ok && result.mentorNotified === false);
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'FAILED');
    assert.match(String(store.payments.get(PAYMENT_ID)!.failure_reason), /declined/i);
    // The booking stays in the state the hold cron can still cancel, and the
    // slot is still the seeker's.
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'PAYMENT_PENDING');
  });

  it('never lets a late failure undo a captured payment', async () => {
    const { store, gateway, orderId } = await withInFlightOrder();
    await verify(store, gateway, orderId, 'pay_OK');

    const body = webhookBody({ orderId, paymentId: 'pay_OK', event: 'payment.failed', errorDescription: 'late' });
    const result = await webhook(store, gateway, body);

    assert.ok(result.ok);
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'VERIFIED');
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'MENTOR_PENDING');
  });
});

// ---------------------------------------------------------------------------
// Retry behaviour
// ---------------------------------------------------------------------------

describe('razorpay state machine: retry behaviour', () => {
  it('returns the SAME order when the seeker retries while one is in flight', async () => {
    const { store, gateway } = await withInFlightOrder();

    const retry = await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway, store, now: NOW });

    assert.ok(retry.ok);
    assert.ok(retry.ok && retry.value.alreadyCreated === true);
    assert.ok(retry.ok && retry.value.razorpayOrderId === ORDER_ID);
    // `payments` is UNIQUE(booking_id): a retry must not mint a second payment.
    assert.equal(store.payments.size, 1);
  });

  it('refuses a new order once the payment is captured', async () => {
    const { store, gateway, orderId } = await withInFlightOrder();
    await verify(store, gateway, orderId, 'pay_OK');

    const retry = await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway, store, now: NOW });

    // The booking left the payable set with the capture, so the payability check
    // is what refuses the retry. The payment lookup behind it is the backstop
    // for a captured payment on a still-payable booking.
    assert.ok(!retry.ok && retry.error.code === 'BOOKING_NOT_PAYABLE');
    assert.equal(store.payments.size, 1);
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'MENTOR_PENDING');
  });
});

// ---------------------------------------------------------------------------
// The 5-minute hold
// ---------------------------------------------------------------------------

describe('razorpay state machine: the 5-minute hold', () => {
  it('mints gateway orders that expire on the same 5 minutes as the hold', () => {
    // Both windows are 5 minutes, so an order can never outlive the hold that
    // reserves the slot. Verified, not assumed - the constants are compared.
    assert.equal(RAZORPAY_ORDER_EXPIRY_SECONDS * 1000, APP_CONFIG.HOLD_DURATION_MS);
    assert.equal(RAZORPAY_ORDER_EXPIRY_SECONDS, 5 * 60);
  });

  it('refuses to mint an order once the hold has elapsed', async () => {
    const store = createFakeStore();
    store.seedBooking();
    store.seedHold({ expires_at: new Date(NOW.getTime() - 1000).toISOString() });

    const result = await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway: createFakeGateway(), store, now: NOW });

    assert.ok(!result.ok && result.error.code === 'HOLD_EXPIRED');
    assert.equal(store.payments.size, 0);
  });

  it('refuses to mint an order once the hold has been released or expired', async () => {
    for (const status of ['EXPIRED', 'RELEASED'] as const) {
      const store = createFakeStore();
      store.seedBooking();
      store.seedHold({ status, expires_at: new Date(NOW.getTime() + 10 * 60 * 1000).toISOString() });

      const result = await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway: createFakeGateway(), store, now: NOW });

      assert.ok(!result.ok && result.error.code === 'HOLD_EXPIRED', `${status} must refuse a new order`);
    }
  });

  it('accepts a hold that has been CONVERTED, so a converted slot stays payable', async () => {
    const store = createFakeStore();
    store.seedBooking();
    store.seedHold({ status: 'CONVERTED' });

    const result = await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway: createFakeGateway(), store, now: NOW });

    assert.ok(result.ok);
  });

  it('refuses an order for a session that has already started', async () => {
    const store = createFakeStore();
    store.seedBooking({ start_time: new Date(NOW.getTime() - 60_000).toISOString() });
    store.seedHold();

    const result = await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway: createFakeGateway(), store, now: NOW });

    assert.ok(!result.ok && result.error.code === 'SLOT_ALREADY_STARTED');
  });
});

// ---------------------------------------------------------------------------
// Known gaps, documented rather than endorsed
// ---------------------------------------------------------------------------

describe('razorpay state machine: a failed attempt leaves the booking payable', () => {
  it('keeps the booking in PAYMENT_PENDING and accepts a new attempt', async () => {
    // The booking must stay in the one state the hold cron can still cancel,
    // and the FAILED payment row must not end the booking's payment life. The
    // retry mechanics are covered in razorpay_payment_safety.test.ts.
    const { store, gateway, orderId } = await withInFlightOrder();
    await webhook(store, gateway, webhookBody({ orderId, paymentId: 'pay_FAIL', event: 'payment.failed', errorDescription: 'declined' }));

    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'FAILED');
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'PAYMENT_PENDING');

    const retry = await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway, store, now: NOW });
    assert.ok(retry.ok, 'a declined card must not make the booking unpayable');
  });
});
