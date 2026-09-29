import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { runCreateRazorpayOrder, runRazorpayWebhook, runVerifyRazorpayPayment } from '../src/lib/razorpayService';
import { RAZORPAY_ORDER_EXPIRY_SECONDS } from '../src/lib/razorpayConfig';
import {
  AMOUNT_INR,
  BOOKING_ID,
  NOW,
  ORDER_ID,
  OTHER_SEEKER_ID,
  PAYMENT_ID,
  SEEKER_ID,
  createFakeStore,
  createSequencedGateway,
  signPayment,
  signWebhook,
  useRazorpayEnv,
  webhookBody,
  type FakeStore,
} from './helpers/razorpayHarness';

/**
 * Production safety: retrying a failed payment, and a capture that lands after
 * the booking is gone.
 *
 * Both are Phase 2 defects pinned here against the real service, because both
 * lose money if they regress:
 *
 *   1. `payments` is UNIQUE(booking_id), so a FAILED row used to block every
 *      later payment attempt for that booking, and a subsequent successful
 *      capture on a different payment id hit the FAILED row and 409/5xx'd.
 *      The fix re-arms the same row for the new gateway order.
 *
 *   2. A capture arriving after `expire_stale_holds()` cancelled the booking
 *      used to be recorded as a successful payment on a booking nobody would
 *      ever deliver. It is now parked in a refund-owed state instead.
 */

let restoreEnv: () => void;
before(() => {
  restoreEnv = useRazorpayEnv();
});
after(() => {
  restoreEnv();
});

const RETRY_ORDER_ID = 'order_RETRY1';
const DECLINED_PAYMENT_ID = 'pay_DECLINED';

/** One declined attempt on `order_TEST123`, with the seeker free to try again. */
async function afterFailedAttempt() {
  const store = createFakeStore();
  store.seedBooking();
  store.seedHold();
  const gateway = createSequencedGateway([ORDER_ID, RETRY_ORDER_ID]);

  const first = await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway, store, now: NOW });
  assert.ok(first.ok, 'fixture: the first order is created');

  const failure = webhookBody({ orderId: ORDER_ID, paymentId: DECLINED_PAYMENT_ID, event: 'payment.failed', errorDescription: 'Your card was declined.' });
  const failed = await runRazorpayWebhook({ rawBody: failure, signature: signWebhook(failure), gateway, store, now: NOW });
  assert.ok(failed.ok && failed.handled === 'failed', 'fixture: the attempt fails');

  return { store, gateway };
}

const retryOrder = (store: FakeStore, gateway: ReturnType<typeof createSequencedGateway>) =>
  runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway, store, now: NOW });

const verify = (
  store: FakeStore,
  gateway: ReturnType<typeof createSequencedGateway>,
  orderId: string,
  paymentId: string,
  callerId = SEEKER_ID,
) =>
  runVerifyRazorpayPayment({
    bookingId: BOOKING_ID,
    callerId,
    razorpayOrderId: orderId,
    razorpayPaymentId: paymentId,
    razorpaySignature: signPayment(orderId, paymentId),
    gateway,
    store,
    now: NOW,
  });

const webhook = (store: FakeStore, gateway: ReturnType<typeof createSequencedGateway>, body: string) =>
  runRazorpayWebhook({ rawBody: body, signature: signWebhook(body), gateway, store, now: NOW });

// ---------------------------------------------------------------------------
// P1 - retrying after a failed attempt
// ---------------------------------------------------------------------------

describe('razorpay safety: retrying a failed payment', () => {
  it('creates a new order for the same booking after a failure', async () => {
    const { store, gateway } = await afterFailedAttempt();
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'FAILED');

    const retry = await retryOrder(store, gateway);

    assert.ok(retry.ok, 'a declined card must not end online payment for this booking');
    assert.ok(retry.ok && retry.value.alreadyCreated === false, 'the retry is a fresh order, not the old one');
    assert.ok(retry.ok && retry.value.razorpayOrderId === RETRY_ORDER_ID);
    // One payment row for the booking, re-armed - `payments` is UNIQUE(booking_id).
    assert.equal(store.payments.size, 1);
    const payment = store.payments.get(PAYMENT_ID)!;
    assert.equal(payment.status, 'PAYMENT_PROCESSING');
    assert.equal(payment.razorpay_order_id, RETRY_ORDER_ID);
    // The previous attempt's identifiers are cleared, not mixed in.
    assert.equal(payment.razorpay_payment_id, null);
    assert.equal(payment.failure_reason, null);
    assert.equal(payment.captured_at, null);
  });

  it('confirms the retried payment and advances the booking exactly once', async () => {
    const { store, gateway } = await afterFailedAttempt();
    await retryOrder(store, gateway);

    const result = await verify(store, gateway, RETRY_ORDER_ID, 'pay_OK');

    assert.ok(result.ok);
    assert.ok(result.ok && result.value.paymentStatus === 'VERIFIED');
    assert.ok(result.ok && result.value.bookingStatus === 'MENTOR_PENDING');
    assert.ok(result.ok && result.value.mentorNotified === true);
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'VERIFIED');
    assert.equal(store.payments.get(PAYMENT_ID)!.razorpay_payment_id, 'pay_OK');
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'MENTOR_PENDING');
  });

  it('preserves the failed attempt in the audit trail', async () => {
    const { store, gateway } = await afterFailedAttempt();
    await retryOrder(store, gateway);
    await verify(store, gateway, RETRY_ORDER_ID, 'pay_OK');

    const types = store.events.map((e) => e.eventType);
    // The declined attempt is still on record, with its gateway payment id.
    assert.ok(types.includes('PAYMENT_FAILED'));
    assert.ok(
      store.events.some((e) => e.eventType === 'PAYMENT_FAILED' && e.gatewayPaymentId === DECLINED_PAYMENT_ID),
      'the failed attempt keeps its gateway payment id',
    );
    // And the retry is distinguishable from a first attempt.
    assert.ok(types.includes('GATEWAY_ORDER_CREATED'));
    assert.ok(types.includes('GATEWAY_ORDER_RETRIED'));
    assert.ok(types.includes('PAYMENT_CAPTURED'));
    assert.equal(store.events.filter((e) => e.eventType === 'PAYMENT_CAPTURED').length, 1);
  });

  it('never duplicates the capture when the retry is verified twice', async () => {
    const { store, gateway } = await afterFailedAttempt();
    await retryOrder(store, gateway);

    const first = await verify(store, gateway, RETRY_ORDER_ID, 'pay_OK');
    const second = await verify(store, gateway, RETRY_ORDER_ID, 'pay_OK');
    const third = await verify(store, gateway, RETRY_ORDER_ID, 'pay_OK');

    assert.ok(first.ok && first.value.duplicate === false && first.value.mentorNotified === true);
    assert.ok(second.ok && second.value.duplicate === true && second.value.mentorNotified === false);
    assert.ok(third.ok && third.value.duplicate === true && third.value.mentorNotified === false);
    assert.equal(store.events.filter((e) => e.eventType === 'PAYMENT_CAPTURED').length, 1);
  });

  it('never duplicates the capture when the browser and the webhook both confirm the retry', async () => {
    const { store, gateway } = await afterFailedAttempt();
    await retryOrder(store, gateway);

    const body = webhookBody({ orderId: RETRY_ORDER_ID, paymentId: 'pay_OK' });
    const first = await webhook(store, gateway, body);
    const replay = await webhook(store, gateway, body);
    const late = await verify(store, gateway, RETRY_ORDER_ID, 'pay_OK');

    assert.ok(first.ok && first.handled === 'captured' && first.mentorNotified === true);
    assert.ok(replay.ok && replay.handled === 'duplicate');
    assert.ok(late.ok && late.value.duplicate === true && late.value.mentorNotified === false);
    assert.equal(store.events.filter((e) => e.eventType === 'PAYMENT_CAPTURED').length, 1);
  });

  it('refuses the old order id once the row has been re-armed', async () => {
    const { store, gateway } = await afterFailedAttempt();
    await retryOrder(store, gateway);

    // The signature is perfectly valid - for the OLD order. It must not confirm
    // the new attempt.
    const stale = await verify(store, gateway, ORDER_ID, DECLINED_PAYMENT_ID);

    assert.ok(!stale.ok && stale.error.code === 'RAZORPAY_ORDER_MISMATCH');
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'PAYMENT_PROCESSING');
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'PAYMENT_PENDING');
  });

  it('records a late webhook for the superseded order without touching the retry', async () => {
    const { store, gateway } = await afterFailedAttempt();
    await retryOrder(store, gateway);

    const late = await webhook(store, gateway, webhookBody({ orderId: ORDER_ID, paymentId: DECLINED_PAYMENT_ID }));

    // The re-armed row matches neither the old order id nor the old payment id,
    // so no capture is applied. Since the money may still have moved, the
    // delivery is now RECORDED for reconciliation and left retryable rather
    // than being silently acknowledged (P0-1).
    assert.ok(!late.ok && late.error.code === 'RAZORPAY_CAPTURE_UNMATCHED');
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'PAYMENT_PROCESSING');
    assert.equal(store.payments.get(PAYMENT_ID)!.razorpay_order_id, RETRY_ORDER_ID);
    assert.equal(store.events.filter((e) => e.eventType === 'PAYMENT_CAPTURED').length, 0);
    assert.equal(store.unmatched.size, 1, 'the superseded capture is recorded, not dropped');
  });

  it('returns the same retried order when the seeker double-taps', async () => {
    const { store, gateway } = await afterFailedAttempt();
    const retry = await retryOrder(store, gateway);
    const doubleTap = await retryOrder(store, gateway);

    assert.ok(retry.ok && retry.value.alreadyCreated === false);
    assert.ok(doubleTap.ok && doubleTap.value.alreadyCreated === true);
    assert.ok(doubleTap.ok && doubleTap.value.razorpayOrderId === RETRY_ORDER_ID);
    assert.equal(store.payments.size, 1);
  });

  it('allows a second retry when the retried attempt also fails', async () => {
    const { store, gateway } = await afterFailedAttempt();
    await retryOrder(store, gateway);

    const secondFailure = webhookBody({ orderId: RETRY_ORDER_ID, paymentId: 'pay_DECLINED_AGAIN', event: 'payment.failed', errorDescription: 'declined again' });
    const failedAgain = await webhook(store, gateway, secondFailure);
    assert.ok(failedAgain.ok && failedAgain.handled === 'failed');
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'FAILED');
    // The booking is untouched and still payable.
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'PAYMENT_PENDING');

    const third = await retryOrder(store, gateway);
    assert.ok(third.ok, 'a second failure must not permanently block payment either');
  });

  it('still enforces ownership on a retry', async () => {
    const { store, gateway } = await afterFailedAttempt();

    const stolen = await retryOrder(store, gateway).then(() =>
      runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: OTHER_SEEKER_ID, gateway, store, now: NOW }),
    );

    assert.ok(!stolen.ok && stolen.error.code === 'FORBIDDEN_NOT_BOOKING_OWNER');
  });

  it('still derives the retried amount from the booking, not from the caller', async () => {
    const { store, gateway } = await afterFailedAttempt();

    const retry = await retryOrder(store, gateway);

    // The retried order is minted from `bookings.amount_inr`, in paise, on the
    // same 5-minute expiry as the first attempt. Nothing the caller sends can
    // reach it - the route takes no amount input at all.
    assert.ok(retry.ok && retry.value.amountInr === AMOUNT_INR);
    assert.deepEqual(gateway.lastOrder, { amountPaise: AMOUNT_INR * 100, currency: 'INR', expiresInSeconds: RAZORPAY_ORDER_EXPIRY_SECONDS });
    // The re-armed row keeps the booking's own snapshot.
    assert.equal(store.payments.get(PAYMENT_ID)!.amount_inr, AMOUNT_INR);
  });

  it('never re-arms a row that already has a refund owed', async () => {
    // Defence in depth: a row parked with `refund_status = 'PENDING'` holds
    // money already taken, so re-arming it could never be allowed - even though
    // a closed booking is refused before this point today.
    const store = createFakeStore();
    store.seedBooking();
    store.seedHold();
    const gateway = createSequencedGateway([ORDER_ID]);
    await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway, store, now: NOW });

    const payment = store.payments.get(PAYMENT_ID)!;
    payment.status = 'FAILED';
    payment.refund_status = 'PENDING';
    payment.razorpay_payment_id = 'pay_LATE';
    payment.failure_reason = 'captured after the booking was cancelled; a refund is owed.';

    const retry = await retryOrder(store, gateway);

    assert.ok(!retry.ok && retry.error.code === 'PAYMENT_ALREADY_IN_PROGRESS');
    assert.equal(store.payments.get(PAYMENT_ID)!.refund_status, 'PENDING', 'the refund marker survives');
    assert.equal(store.payments.get(PAYMENT_ID)!.razorpay_payment_id, 'pay_LATE');
  });

  it('refuses a retry once the hold has elapsed', async () => {
    const { store, gateway } = await afterFailedAttempt();
    store.seedHold({ expires_at: new Date(NOW.getTime() - 1000).toISOString() });

    const retry = await retryOrder(store, gateway);

    assert.ok(!retry.ok && retry.error.code === 'HOLD_EXPIRED');
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'FAILED', 'the row is left as it was');
  });

  it('refuses a retry after the booking has been cancelled', async () => {
    const { store, gateway } = await afterFailedAttempt();
    store.bookings.get(BOOKING_ID)!.status = 'CANCELLED';

    const retry = await retryOrder(store, gateway);

    assert.ok(!retry.ok && retry.error.code === 'BOOKING_NOT_PAYABLE');
  });
});

// ---------------------------------------------------------------------------
// P2 - a capture that arrives after the booking is gone
// ---------------------------------------------------------------------------

describe('razorpay safety: capture after the booking was closed', () => {
  it('does not confirm the payment, and records a refund-owed state', async () => {
    const store = createFakeStore();
    store.seedBooking();
    store.seedHold();
    const gateway = createSequencedGateway([ORDER_ID]);
    await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway, store, now: NOW });

    // `expire_stale_holds()` cancels the unpaid booking whose hold elapsed.
    store.bookings.get(BOOKING_ID)!.status = 'CANCELLED';

    const result = await webhook(store, gateway, webhookBody({ orderId: ORDER_ID, paymentId: 'pay_LATE' }));

    assert.ok(result.ok && result.handled === 'refund_pending');
    const payment = store.payments.get(PAYMENT_ID)!;
    // NOT a successful booking payment...
    assert.notEqual(payment.status, 'VERIFIED');
    assert.equal(payment.status, 'FAILED');
    assert.equal(payment.captured_at, null, 'a capture that was never confirmed has no capture time');
    // ...but the money is traceable and a refund is owed.
    assert.equal(payment.razorpay_payment_id, 'pay_LATE');
    assert.equal(payment.refund_status, 'PENDING');
    assert.match(String(payment.failure_reason), /refund is owed/i);
  });

  it('records the capture and the refund obligation in the audit trail', async () => {
    const store = createFakeStore();
    store.seedBooking();
    store.seedHold();
    const gateway = createSequencedGateway([ORDER_ID]);
    await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway, store, now: NOW });
    store.bookings.get(BOOKING_ID)!.status = 'CANCELLED';

    await webhook(store, gateway, webhookBody({ orderId: ORDER_ID, paymentId: 'pay_LATE' }));

    const events = store.events;
    // The original delivery is still retained verbatim for reconciliation.
    assert.ok(events.some((e) => e.eventType === 'CAPTURE_AFTER_BOOKING_CLOSED' && e.gatewayPaymentId === 'pay_LATE'));
    // And nothing claims the money was captured for this booking.
    assert.equal(events.filter((e) => e.eventType === 'PAYMENT_CAPTURED').length, 0);
    const recovery = events.find((e) => e.eventType === 'CAPTURE_AFTER_BOOKING_CLOSED')!;
    assert.equal(recovery.amountInr, AMOUNT_INR, 'the amount owed back is on the record');
    assert.equal(recovery.at, NOW.toISOString(), 'the real capture time is recorded here');
  });

  it('never notifies the mentor for a cancelled booking', async () => {
    const store = createFakeStore();
    store.seedBooking();
    store.seedHold();
    const gateway = createSequencedGateway([ORDER_ID]);
    await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway, store, now: NOW });
    store.bookings.get(BOOKING_ID)!.status = 'CANCELLED';

    const result = await webhook(store, gateway, webhookBody({ orderId: ORDER_ID, paymentId: 'pay_LATE' }));

    assert.ok(result.ok && result.mentorNotified === false);
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'CANCELLED', 'the booking is never advanced');
  });

  it('tells the browser the payment is being refunded, not that it succeeded', async () => {
    const store = createFakeStore();
    store.seedBooking();
    store.seedHold();
    const gateway = createSequencedGateway([ORDER_ID]);
    await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway, store, now: NOW });
    store.bookings.get(BOOKING_ID)!.status = 'CANCELLED';

    const result = await verify(store, gateway, ORDER_ID, 'pay_LATE');

    assert.ok(!result.ok);
    assert.ok(!result.ok && result.error.code === 'BOOKING_CLOSED_REFUND_PENDING');
    assert.ok(!result.ok && /refunded/i.test(result.error.message));
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'FAILED');
    assert.equal(store.payments.get(PAYMENT_ID)!.refund_status, 'PENDING');
  });

  it('answers a redelivered capture without throwing, so Razorpay stops retrying', async () => {
    const store = createFakeStore();
    store.seedBooking();
    store.seedHold();
    const gateway = createSequencedGateway([ORDER_ID]);
    await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway, store, now: NOW });
    store.bookings.get(BOOKING_ID)!.status = 'CANCELLED';

    const first = await webhook(store, gateway, webhookBody({ orderId: ORDER_ID, paymentId: 'pay_LATE' }));
    // Same capture under a different event id, which the event key cannot catch.
    const again = await webhook(store, gateway, webhookBody({ orderId: ORDER_ID, paymentId: 'pay_LATE', eventId: 'evt_other' }));
    // And the browser reporting the same payment.
    const lateVerify = await verify(store, gateway, ORDER_ID, 'pay_LATE');

    // None of these throw: an unresolvable conflict must not become a retry loop.
    assert.ok(first.ok && first.handled === 'refund_pending');
    assert.ok(again.ok && again.handled === 'refund_pending');
    assert.ok(!lateVerify.ok && lateVerify.error.code === 'BOOKING_CLOSED_REFUND_PENDING');
    assert.equal(store.events.filter((e) => e.eventType === 'CAPTURE_AFTER_BOOKING_CLOSED').length, 1);
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'FAILED');
  });

  it('treats a rejected booking and a deleted booking the same way', async () => {
    for (const close of ['REJECTED', null] as const) {
      const store = createFakeStore();
      store.seedBooking();
      store.seedHold();
      const gateway = createSequencedGateway([ORDER_ID]);
      await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway, store, now: NOW });
      if (close === null) store.bookings.delete(BOOKING_ID);
      else store.bookings.get(BOOKING_ID)!.status = close;

      const result = await webhook(store, gateway, webhookBody({ orderId: ORDER_ID, paymentId: 'pay_LATE' }));

      assert.ok(result.ok && result.handled === 'refund_pending', `booking ${close} must not be confirmed`);
      assert.equal(store.payments.get(PAYMENT_ID)!.refund_status, 'PENDING');
      assert.equal(store.payments.get(PAYMENT_ID)!.status, 'FAILED');
    }
  });

  it('still confirms normally when the booking is merely already paid', async () => {
    // MENTOR_PENDING is NOT a dead end: a capture arriving then is a duplicate
    // of one already applied, and must keep taking the idempotent path.
    const { store, gateway } = await afterFailedAttempt();
    await retryOrder(store, gateway);
    await verify(store, gateway, RETRY_ORDER_ID, 'pay_OK');

    const body = webhookBody({ orderId: RETRY_ORDER_ID, paymentId: 'pay_OK', eventId: 'evt_after_confirm' });
    const result = await webhook(store, gateway, body);

    assert.ok(result.ok && result.handled === 'captured_duplicate');
    assert.ok(result.ok && result.mentorNotified === false);
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'VERIFIED');
    assert.equal(store.events.filter((e) => e.eventType === 'CAPTURE_AFTER_BOOKING_CLOSED').length, 0);
  });
});

// ---------------------------------------------------------------------------
// Secrets stay on the server
// ---------------------------------------------------------------------------

const REPO_ROOT = join(import.meta.dirname, '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
    } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('razorpay safety: secrets stay server-side', () => {
  it('are only readable from the modules that must use them', () => {
    // The key secret and the webhook secret may only appear in the config
    // reader, the gateway client and the signature verifier. Anything else -
    // a page, a component, an API handler response - would be a leak.
    const allowed = ['src/lib/razorpayConfig.ts', 'src/lib/razorpayService.ts', 'src/lib/razorpaySignature.ts'];
    const offenders: string[] = [];

    for (const file of [...sourceFiles(join(REPO_ROOT, 'src')), join(REPO_ROOT, 'server.ts')]) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, '/');
      if (allowed.includes(rel)) continue;
      const contents = readFileSync(file, 'utf8');
      if (/getRazorpayKeySecret|getRazorpayWebhookSecret|RAZORPAY_KEY_SECRET|RAZORPAY_WEBHOOK_SECRET/.test(contents)) {
        offenders.push(rel);
      }
    }

    assert.deepEqual(offenders, [], `a Razorpay secret is readable from: ${offenders.join(', ')}`);
  });

  it('are never exposed through a VITE_ prefixed variable', () => {
    // Only VITE_-prefixed variables reach the browser bundle, so a Razorpay
    // secret behind one of them would ship to every user.
    for (const file of [...sourceFiles(join(REPO_ROOT, 'src')), join(REPO_ROOT, 'server.ts'), join(REPO_ROOT, '.env.example')]) {
      const contents = readFileSync(file, 'utf8');
      assert.ok(!/VITE_RAZORPAY/i.test(contents), `VITE_RAZORPAY must not appear in ${relative(REPO_ROOT, file)}`);
    }
  });

  it('are not part of the value returned to the order-creation route', async () => {
    const store = createFakeStore();
    store.seedBooking();
    store.seedHold();

    const result = await runCreateRazorpayOrder({
      bookingId: BOOKING_ID,
      callerId: SEEKER_ID,
      gateway: createSequencedGateway([ORDER_ID]),
      store,
      now: NOW,
    });

    assert.ok(result.ok);
    // The route forwards this value verbatim, so its shape is the contract.
    assert.deepEqual(Object.keys(result.value).sort(), [
      'alreadyCreated',
      'amountInr',
      'bookingId',
      'currency',
      'paymentId',
      'razorpayKeyId',
      'razorpayOrderId',
    ]);
    assert.doesNotMatch(JSON.stringify(result.value), /secret/i);
  });

  it('are never persisted on the payment row', async () => {
    const store = createFakeStore();
    store.seedBooking();
    store.seedHold();
    const gateway = createSequencedGateway([ORDER_ID]);
    await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway, store, now: NOW });
    await verify(store, gateway, ORDER_ID, 'pay_OK');

    // The signature is proof material and belongs on the row; the secrets never
    // appear in any row the flows write.
    const serialised = JSON.stringify([...store.payments.values(), ...store.events]);
    assert.ok(!serialised.includes('rzp_test_key_secret'));
    assert.ok(!serialised.includes('rzp_test_webhook_secret'));
  });
});
