/**
 * Audit P0-1: a captured Razorpay payment that matches no local `payments` row
 * must become durably traceable, must not be acknowledged, and must never be
 * turned into a confirmed payment.
 *
 * Every test drives the REAL production entry points - `runRazorpayWebhook` and
 * `reconcileUnmatchedCapture` from `src/lib/razorpayService.ts`. The only
 * substitute is the `RazorpayStore` port, and the harness reproduces the two
 * adapter properties this behaviour depends on:
 *
 *   1. the ledger's identity is `(gateway, razorpay_payment_id)`, so a
 *      redelivery OR a second event id for the same capture collapses onto one
 *      financial record;
 *   2. every business write is a conditional update, so a capture applies at
 *      most once and a reconciliation is at most one attach.
 *
 * No business rule is re-implemented here.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  reconcileUnmatchedCapture,
  runRazorpayWebhook,
} from '../src/lib/razorpayService';
import {
  AMOUNT_INR,
  BOOKING_ID,
  MENTOR_ID,
  NOW,
  ORDER_ID,
  PAYMENT_ID,
  SEEKER_ID,
  createFakeGateway,
  createFakeStore,
  eventIdOf,
  signWebhook,
  toPaise,
  useRazorpayEnv,
  webhookBody,
} from './helpers/razorpayHarness';

let restoreEnv: () => void;
before(() => {
  restoreEnv = useRazorpayEnv();
});
after(() => {
  restoreEnv();
});

const GATEWAY_ID = 'order_ORPHAN';
const CAPTURED_ID = 'pay_ORPHAN';

const deliver = (
  store: ReturnType<typeof createFakeStore>,
  body: string,
  gateway = createFakeGateway(),
) => runRazorpayWebhook({ rawBody: body, signature: signWebhook(body), gateway, store, now: NOW });

/** A capture for a payment that does not exist locally. */
const orphanBody = (overrides: Parameters<typeof webhookBody>[0] = {}) =>
  webhookBody({ orderId: GATEWAY_ID, paymentId: CAPTURED_ID, ...overrides });

/** The single recorded exception for a store that has seen one capture. */
const onlyRecord = (store: ReturnType<typeof createFakeStore>) => {
  assert.equal(store.unmatched.size, 1, 'exactly one exception record is expected');
  return [...store.unmatched.values()][0];
};

describe('P0-1: an unmatched capture is made durable and never acknowledged', () => {
  it('1. persists the capture with the identifiers needed to reconcile it', async () => {
    const store = createFakeStore();
    const body = orphanBody();

    const result = await deliver(store, body);

    assert.ok(!result.ok);
    const row = onlyRecord(store);
    assert.equal(row.gateway, 'razorpay');
    assert.equal(row.razorpay_payment_id, CAPTURED_ID);
    assert.equal(row.razorpay_order_id, GATEWAY_ID);
    assert.equal(row.event_id, eventIdOf(body));
    assert.equal(row.event_type, 'payment.captured');
    assert.equal(row.amount_paise, toPaise(AMOUNT_INR));
    assert.equal(row.currency, 'INR');
    assert.equal(row.received_at, NOW.toISOString());
    assert.equal(row.reason, 'PAYMENT_ROW_NOT_FOUND');
    assert.equal(row.reconciliation_status, 'PENDING');
    assert.equal(row.delivery_count, 1);
  });

  it('2. does not create a verified payment, or advance any booking', async () => {
    const store = createFakeStore();
    // A live booking exists, but its payment row does not. Nothing may be
    // written against the booking either.
    store.seedBooking();

    await deliver(store, orphanBody());

    assert.equal(store.payments.size, 0, 'no payment row is fabricated');
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'PAYMENT_PENDING', 'the booking is untouched');
    assert.equal(store.events.length, 0, 'no payment_events row claims a payment that does not exist');
  });

  it('3. never notifies a mentor', async () => {
    const store = createFakeStore();
    store.seedBooking({ mentor_id: MENTOR_ID });

    const result = await deliver(store, orphanBody());

    // The route only notifies when `ok && mentorNotified`; a non-ok result can
    // never reach that branch.
    assert.ok(!result.ok);
    assert.ok(!('mentorNotified' in result && result.mentorNotified));
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'PAYMENT_PENDING');
  });

  it('4. returns a non-2xx so the gateway keeps redelivering', async () => {
    const store = createFakeStore();
    const result = await deliver(store, orphanBody());

    assert.ok(!result.ok);
    assert.equal(result.error.code, 'RAZORPAY_CAPTURE_UNMATCHED');
    assert.ok(result.error.httpStatus >= 400, 'the status must not be 2xx');
    assert.equal(
      store.webhookClaims.get(`razorpay:${eventIdOf(orphanBody())}`),
      false,
      'the event is deliberately left unprocessed so a redelivery is re-evaluated',
    );
  });

  it('5. is idempotent for the same event delivered repeatedly', async () => {
    const store = createFakeStore();
    const body = orphanBody();

    const first = await deliver(store, body);
    const second = await deliver(store, body);
    const third = await deliver(store, body);

    assert.ok(!first.ok && !second.ok && !third.ok, 'every delivery stays retryable');
    assert.equal(store.unmatched.size, 1, 'redelivery must not create a second record');
    const row = onlyRecord(store);
    assert.equal(row.delivery_count, 3, 'the redelivery trail is counted');
    assert.equal(row.event_id, eventIdOf(body), 'the first-seen evidence is preserved');
  });

  it('6. does not duplicate a financial record for a different event id', async () => {
    const store = createFakeStore();

    // Two byte-different deliveries describing the SAME captured payment.
    await deliver(store, orphanBody({ eventId: 'evt_first' }));
    await deliver(store, orphanBody({ eventId: 'evt_second' }));

    assert.equal(store.unmatched.size, 1, 'a re-signed replay must not create a second financial record');
    const row = onlyRecord(store);
    assert.equal(row.event_id, 'evt_first', 'the original evidence is kept');
    assert.equal(row.last_event_id, 'evt_second', 'the newest delivery is traceable');
    assert.equal(row.delivery_count, 2);
    assert.equal(store.payments.size, 0);
  });

  it('7. still refuses a delivery whose signature is invalid, before any persistence', async () => {
    const store = createFakeStore();
    const body = orphanBody();

    const result = await runRazorpayWebhook({
      rawBody: body,
      signature: 'deadbeef'.repeat(8),
      gateway: createFakeGateway(),
      store,
      now: NOW,
    });

    assert.ok(!result.ok);
    assert.equal(result.error.code, 'RAZORPAY_SIGNATURE_INVALID');
    assert.equal(store.unmatched.size, 0, 'an unverified delivery is never recorded');
    assert.equal(store.payments.size, 0);
  });

  it('8. still refuses an amount mismatch against a KNOWN payment', async () => {
    const store = createFakeStore();
    store.seedBooking();
    store.seedHold();
    await store.attachGatewayOrder({
      bookingId: BOOKING_ID,
      seekerId: SEEKER_ID,
      amountInr: AMOUNT_INR,
      orderId: ORDER_ID,
      at: NOW.toISOString(),
    });

    // This payment IS known, so the capture reaches the amount guard rather
    // than the unmatched ledger.
    const body = webhookBody({ orderId: ORDER_ID, paymentId: 'pay_WRONG_AMOUNT', amount: 1 });
    const result = await deliver(store, body, createFakeGateway({ orderId: ORDER_ID }));

    assert.ok(result.ok && result.handled === 'amount_mismatch');
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'PAYMENT_PROCESSING', 'the payment is not confirmed');
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'PAYMENT_PENDING');
    assert.equal(store.unmatched.size, 0, 'a known payment is not an orphan');
    assert.ok(
      store.events.some((e) => e.eventType === 'PAYMENT_AMOUNT_MISMATCH'),
      'the mismatch is recorded',
    );
  });
});


describe('P0-1: reconciliation resolves a capture that became locatable', () => {
  /** Capture arrives first, then the payment row it belongs to appears. */
  const captureThenPayment = async (paymentOverrides: Record<string, unknown> = {}) => {
    const store = createFakeStore();
    store.seedBooking();
    store.seedHold();
    await deliver(store, orphanBody());

    // The `payments` row that should have existed all along now shows up,
    // exactly as it would if an order-creation response had been lost.
    const payment = await store.attachGatewayOrder({
      bookingId: BOOKING_ID,
      seekerId: SEEKER_ID,
      amountInr: AMOUNT_INR,
      orderId: GATEWAY_ID,
      at: NOW.toISOString(),
    });
    assert.ok(payment);
    Object.assign(payment, paymentOverrides);
    return { store, record: onlyRecord(store), payment };
  };

  it('9. attaches a valid capture to the correct payment and advances the booking', async () => {
    const { store, record } = await captureThenPayment();

    const result = await reconcileUnmatchedCapture({
      store,
      unmatchedCaptureId: record.id,
      actorId: 'admin-1',
      now: NOW,
    });

    assert.equal(result.status, 'APPLIED');
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'VERIFIED');
    assert.equal(store.payments.get(PAYMENT_ID)!.razorpay_payment_id, CAPTURED_ID);
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'MENTOR_PENDING');
    assert.equal(store.unmatched.get(record.id)!.reconciliation_status, 'RESOLVED');
    assert.equal(store.unmatched.get(record.id)!.resolved_payment_id, PAYMENT_ID);
  });

  it('10. refuses to attach a capture whose amount disagrees with the payment', async () => {
    const { store, record, payment } = await captureThenPayment();
    // The recorded capture is for a larger amount than the booking is worth.
    payment.amount_inr = 1;

    const result = await reconcileUnmatchedCapture({
      store,
      unmatchedCaptureId: record.id,
      actorId: 'admin-1',
      now: NOW,
    });

    assert.equal(result.status, 'CONFLICT');
    assert.equal(result.status === 'CONFLICT' && result.reason, 'AMOUNT_MISMATCH');
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'PAYMENT_PROCESSING', 'nothing is confirmed');
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'PAYMENT_PENDING');
    assert.equal(store.unmatched.get(record.id)!.reconciliation_status, 'CONFLICT', 'it stays unresolved');
  });


  it('11. refuses an ambiguous attach, and never touches a foreign payment', async () => {
    const { store, record, payment } = await captureThenPayment();
    // This payment already records a DIFFERENT captured gateway payment, so
    // attaching this one would double-count the same booking.
    payment.razorpay_payment_id = 'pay_SOMEONE_ELSE';

    const result = await reconcileUnmatchedCapture({
      store,
      unmatchedCaptureId: record.id,
      actorId: 'admin-1',
      now: NOW,
    });

    // It must NOT be applied. The payment-id lookup no longer matches, and the
    // order-id fallback deliberately declines a payment that already carries a
    // captured gateway id, so the capture stays unattached rather than being
    // bound to a payment that belongs to someone else's money.
    assert.notEqual(result.status, 'APPLIED');
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'PAYMENT_PROCESSING');
    assert.equal(store.payments.get(PAYMENT_ID)!.razorpay_payment_id, 'pay_SOMEONE_ELSE', 'untouched');
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'PAYMENT_PENDING');
    assert.equal(
      store.unmatched.get(record.id)!.reconciliation_status,
      'PENDING',
      'the exception is still open, so a human or a later reconciliation can finish it',
    );
  });

  it('11b. refuses a payment that is not a Razorpay payment at all', async () => {
    const { store, record, payment } = await captureThenPayment();
    payment.gateway = 'manual';

    const result = await reconcileUnmatchedCapture({
      store,
      unmatchedCaptureId: record.id,
      actorId: 'admin-1',
      now: NOW,
    });

    assert.equal(result.status, 'CONFLICT');
    assert.equal(result.status === 'CONFLICT' && result.reason, 'PAYMENT_NOT_RAZORPAY');
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'PAYMENT_PROCESSING');
  });

  it('11c. reports STILL_UNMATCHED rather than guessing while no payment exists', async () => {
    const store = createFakeStore();
    await deliver(store, orphanBody());
    const record = onlyRecord(store);

    const result = await reconcileUnmatchedCapture({
      store,
      unmatchedCaptureId: record.id,
      actorId: 'admin-1',
      now: NOW,
    });

    assert.equal(result.status, 'STILL_UNMATCHED');
    assert.equal(store.unmatched.get(record.id)!.reconciliation_status, 'PENDING', 'it stays pending');
    assert.equal(store.payments.size, 0);
  });

  it('12. cannot be reconciled twice', async () => {
    const { store, record } = await captureThenPayment();

    const first = await reconcileUnmatchedCapture({
      store,
      unmatchedCaptureId: record.id,
      actorId: 'admin-1',
      now: NOW,
    });
    assert.equal(first.status, 'APPLIED');

    // A second operator action (or a retry of the first) is a no-op.
    const second = await reconcileUnmatchedCapture({
      store,
      unmatchedCaptureId: record.id,
      actorId: 'admin-2',
      now: NOW,
    });

    assert.equal(second.status, 'ALREADY_RESOLVED');
    assert.equal(second.status === 'ALREADY_RESOLVED' && second.resolvedPaymentId, PAYMENT_ID);
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'VERIFIED', 'not re-verified');
    assert.equal(
      store.events.filter((e) => e.eventType === 'PAYMENT_CAPTURED').length,
      1,
      'the capture is applied exactly once',
    );
  });

  it('reports NOT_FOUND for a record that does not exist', async () => {
    const store = createFakeStore();
    const result = await reconcileUnmatchedCapture({
      store,
      unmatchedCaptureId: 'no-such-record',
      actorId: 'admin-1',
      now: NOW,
    });
    assert.equal(result.status, 'NOT_FOUND');
  });
});

describe('P0-1: a redelivery after the payment appears is applied without help', () => {
  it('resumes and applies the capture on the next delivery, with no manual step', async () => {
    const store = createFakeStore();
    store.seedBooking();
    store.seedHold();
    const body = orphanBody();

    // First delivery: unmatched, recorded, left unprocessed.
    assert.ok(!(await deliver(store, body)).ok);
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'PAYMENT_PENDING');

    // The missing payment row appears, then Razorpay redelivers.
    await store.attachGatewayOrder({
      bookingId: BOOKING_ID,
      seekerId: SEEKER_ID,
      amountInr: AMOUNT_INR,
      orderId: GATEWAY_ID,
      at: NOW.toISOString(),
    });
    const second = await deliver(store, body);

    assert.ok(second.ok, 'the redelivery is applied normally');
    assert.equal(second.handled, 'captured');
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'VERIFIED');
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'MENTOR_PENDING');
    assert.equal(
      store.unmatched.size,
      1,
      'the exception record is retained as evidence rather than deleted',
    );
  });
});

