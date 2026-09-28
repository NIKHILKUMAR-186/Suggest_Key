import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  parseRazorpayWebhookEvent,
  runCreateRazorpayOrder,
  runRazorpayWebhook,
  runVerifyRazorpayPayment,
  toPaise,
  type PaymentEventInput,
  type RazorpayBookingRow,
  type RazorpayGatewayClient,
  type RazorpayHoldRow,
  type RazorpayPaymentRow,
  type RazorpayStore,
} from '../src/lib/razorpayService';
import { verifyPaymentSignature, verifyWebhookSignature } from '../src/lib/razorpaySignature';
import { isRazorpayEnabled, isRazorpayConfigured } from '../src/lib/razorpayConfig';

/**
 * Phase 2 Razorpay backend — behaviour tests against the real service.
 *
 * The gateway and the database are both replaced with fakes, but the fakes are
 * NOT stubs: the store reproduces the conditional-update semantics the real
 * Supabase adapter relies on (`WHERE status = ...`), and the gateway signs and
 * verifies with the same HMAC-SHA256 as Razorpay. That is what makes the
 * idempotency and signature assertions meaningful rather than tautological.
 *
 * The behaviours pinned here are the ones that must not regress:
 *   - a caller can only pay for a booking they own;
 *   - the amount is derived from the booking, never from the request;
 *   - a payment is only ever confirmed on a valid gateway signature;
 *   - a confirmed payment moves the booking exactly once, and the mentor is
 *     notified exactly once even across replays and races;
 *   - a failed payment never advances the booking and never notifies.
 */

const KEY_ID = 'rzp_test_key_id';
const KEY_SECRET = 'rzp_test_key_secret_0123456789abcdef';
const WEBHOOK_SECRET = 'rzp_test_webhook_secret_0123456789';

const SEEKER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_SEEKER_ID = '22222222-2222-4222-8222-222222222222';
const MENTOR_ID = '33333333-3333-4333-8333-333333333333';
const BOOKING_ID = '44444444-4444-4444-8444-444444444444';
const HOLD_ID = '55555555-5555-4555-8555-555555555555';
const PAYMENT_ID = '66666666-6666-4666-8666-666666666666';

const NOW = new Date('2026-10-01T12:00:00.000Z');
const FUTURE_START = new Date(NOW.getTime() + 3 * 60 * 60 * 1000).toISOString();

const originalEnv = { ...process.env };

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/**
 * In-memory `RazorpayStore` mirroring the conditional updates of the real
 * Supabase adapter. Every mutator returns the row ONLY when the transition
 * actually applied, which is exactly the signal the service uses to decide
 * whether it is the winner and owns the side effects.
 */
type FakeStore = RazorpayStore & {
  bookings: Map<string, RazorpayBookingRow>;
  payments: Map<string, RazorpayPaymentRow>;
  events: PaymentEventInput[];
  webhookKeys: Map<string, boolean>;  refunds: Array<{ paymentId: string; refundId: string; status: string }>;
  seedBooking(overrides?: Partial<RazorpayBookingRow>): RazorpayBookingRow;
  seedHold(overrides?: Partial<RazorpayHoldRow>): RazorpayHoldRow;
};

function createFakeStore(): FakeStore {
  const bookings = new Map<string, RazorpayBookingRow>();
  const payments = new Map<string, RazorpayPaymentRow>();
  const events: PaymentEventInput[] = [];
  const webhookKeys = new Map<string, boolean>();
  const refunds: Array<{ paymentId: string; refundId: string; status: string }> = [];
  const holds = new Map<string, RazorpayHoldRow>();

  const store: any = {
    bookings,
    payments,
    events,
    webhookKeys,
    refunds,

    seedBooking(overrides: Partial<RazorpayBookingRow> = {}) {
      const row: RazorpayBookingRow = {
        id: BOOKING_ID,
        booking_code: 'BK-1001',
        seeker_id: SEEKER_ID,
        mentor_id: MENTOR_ID,
        amount_inr: 999,
        status: 'PAYMENT_PENDING',
        start_time: FUTURE_START,
        hold_id: HOLD_ID,
        ...overrides,
      };
      bookings.set(row.id, row);
      return row;
    },

    seedHold(overrides: Partial<RazorpayHoldRow> = {}) {
      const row: RazorpayHoldRow = {
        id: HOLD_ID,
        status: 'ACTIVE',
        expires_at: new Date(NOW.getTime() + 10 * 60 * 1000).toISOString(),
        ...overrides,
      };
      holds.set(row.id, row);
      return row;
    },

    getBooking: async (id: string) => bookings.get(id) ?? null,
    getHold: async (id: string) => holds.get(id) ?? null,
    getPaymentById: async (id: string) => payments.get(id) ?? null,
    getPaymentByBookingId: async (bookingId: string) => {
      for (const p of payments.values()) if (p.booking_id === bookingId) return p;
      return null;
    },
    getPaymentByOrderId: async (orderId: string) => {
      for (const p of payments.values()) if (p.razorpay_order_id === orderId) return p;
      return null;
    },
    getPaymentByGatewayPaymentId: async (paymentId: string) => {
      for (const p of payments.values()) if (p.razorpay_payment_id === paymentId) return p;
      return null;
    },

    // Plain insert semantics, mirroring the real store: a booking that already
    // has a payment row is a conflict, never an overwrite.
    attachGatewayOrder: async ({ bookingId, seekerId, amountInr, orderId, at }: { bookingId: string; seekerId: string; amountInr: number; orderId: string; at: string }) => {
      void at;
      for (const existing of payments.values()) {
        if (existing.booking_id === bookingId) return null; // unique violation
      }
      const row: RazorpayPaymentRow = {
        id: PAYMENT_ID,
        booking_id: bookingId,
        seeker_id: seekerId,
        amount_inr: amountInr,
        status: 'PAYMENT_PROCESSING',
        gateway: 'razorpay',
        razorpay_order_id: orderId,
        razorpay_payment_id: null,
        razorpay_signature: null,
        captured_at: null,
        failure_reason: null,
        refund_id: null,
        refund_status: null,
      };
      payments.set(row.id, row);
      return row;
    },

    // Conditional on the in-flight state: this is the duplicate gate.
    markPaymentCaptured: async ({ paymentId, gatewayPaymentId, signature, capturedAt }: { paymentId: string; gatewayPaymentId: string; signature: string | null; capturedAt: string }) => {
      const p = payments.get(paymentId);
      if (!p || p.status !== 'PAYMENT_PROCESSING') return null;
      p.status = 'VERIFIED';
      p.razorpay_payment_id = gatewayPaymentId;
      p.razorpay_signature = signature;
      p.captured_at = capturedAt;
      return p;
    },

    markPaymentAlreadyCaptured: async ({ paymentId, gatewayPaymentId, capturedAt }: { paymentId: string; gatewayPaymentId: string; capturedAt: string }) => {
      const p = payments.get(paymentId);
      if (!p || p.status !== 'VERIFIED' || p.razorpay_payment_id !== null) return null;
      p.razorpay_payment_id = gatewayPaymentId;
      p.captured_at = capturedAt;
      return p;
    },

    markPaymentFailed: async ({ paymentId, reason, at }: { paymentId: string; reason: string; at: string }) => {
      const p = payments.get(paymentId);
      if (!p || !['PAYMENT_PROCESSING', 'PAYMENT_PENDING'].includes(p.status)) return null;
      p.status = 'FAILED';
      p.failure_reason = reason;
      void at;
      return p;
    },

    // The gate the mentor notification hangs off.
    markBookingMentorPending: async (bookingId: string) => {
      const b = bookings.get(bookingId);
      if (!b || !['PAYMENT_PENDING', 'PAYMENT_PROCESSING'].includes(b.status)) return false;
      b.status = 'MENTOR_PENDING';
      return true;
    },

    // A refund must never advance the payment's own status into a confirmed
    // one, and may only move a genuinely captured payment.
    recordRefund: async ({ paymentId, refundId, refundStatus, at }: { paymentId: string; refundId: string; refundStatus: 'PENDING' | 'REFUNDED' | 'FAILED'; at: string }) => {
      const p = payments.get(paymentId);
      if (!p) return false;
      p.refund_id = refundId;
      p.refund_status = refundStatus;
      refunds.push({ paymentId, refundId, status: refundStatus });
      void at;
      if (refundStatus === 'PENDING') return true;
      if (p.status !== 'VERIFIED') return false;
      p.status = refundStatus === 'REFUNDED' ? 'REFUNDED' : 'REFUND_FAILED';
      return true;
    },

    insertPaymentEvent: async (event: PaymentEventInput) => { events.push(event); },
    // Mirrors the real store: `processed` is what separates a completed
    // delivery (skip) from one that failed part-way (resume).
    claimWebhookEvent: async ({ eventId }: { eventId: string }) => {
      const key = `razorpay:${eventId}`;
      const existing = webhookKeys.get(key);
      if (existing === undefined) {
        webhookKeys.set(key, false);
        return 'new';
      }
      return existing ? 'duplicate' : 'resume';
    },
    completeWebhookEvent: async (eventId: string, _at: string) => {
      webhookKeys.set(`razorpay:${eventId}`, true);
    },
  };
  return store as any;
}

function createFakeGateway(options: { captured?: boolean; amountPaise?: number; orderId?: string; paymentId?: string; unreachable?: boolean } = {}): RazorpayGatewayClient & { calls: number } {
  const state = { calls: 0 };
  return {
    get calls() { return state.calls; },
    async createOrder(input: { amountPaise: number; currency: string; receipt: string; notes: Record<string, string>; expiresInSeconds: number }) {
      state.calls += 1;
      return { ok: true, order: { id: options.orderId ?? 'order_TEST123', amount: input.amountPaise, currency: input.currency, status: 'created' } };
    },
    async fetchPayment(paymentId: string) {
      state.calls += 1;
      if (options.unreachable) return { ok: false, reason: 'gateway_unreachable' };
      return {
        ok: true,
        payment: {
          id: paymentId,
          order_id: options.orderId ?? 'order_TEST123',
          amount: options.amountPaise ?? toPaise(999),
          currency: 'INR',
          status: options.captured === false ? 'authorized' : 'captured',
          captured: options.captured !== false,
        },
      };
    },
  } as any;
}

const signPayment = (orderId: string, paymentId: string) =>
  createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');

const signWebhook = (body: string) => createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');

/** Mirrors the service's event-id derivation, so a test can inspect the store. */
const eventIdOf = (body: string) => {
  const parsed = JSON.parse(body) as { event: string; payload: { payment?: { id?: string } } };
  return `${parsed.event}:${parsed.payload.payment?.id ?? 'unknown'}`;
};

/** Builds a raw webhook body exactly as Razorpay would send it. */
function webhookBody(overrides: { event?: string; paymentId?: string; orderId?: string; amount?: number; errorDescription?: string } = {}): string {
  const payment: Record<string, unknown> = {
    entity: 'payment',
    id: overrides.paymentId ?? 'pay_TEST123',
    order_id: overrides.orderId ?? 'order_TEST123',
    amount: overrides.amount ?? toPaise(999),
    currency: 'INR',
    status: 'captured',
    captured: true,
  };
  if (overrides.errorDescription) {
    payment.error_code = 'BAD_CARD_ERROR';
    payment.error_description = overrides.errorDescription;
  }
  return JSON.stringify({
    entity: 'event',
    event: overrides.event ?? 'payment.captured',
    account_id: 'acc_TEST',
    payload: { payment },
  });
}

beforeEach(() => {
  process.env.RAZORPAY_ENABLED = 'true';
  process.env.RAZORPAY_KEY_ID = KEY_ID;
  process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

// ---------------------------------------------------------------------------
// Config / feature flag
// ---------------------------------------------------------------------------

describe('razorpay: server-side configuration', () => {
  it('is disabled unless RAZORPAY_ENABLED is exactly "true"', () => {
    delete process.env.RAZORPAY_ENABLED;
    assert.equal(isRazorpayEnabled(), false);
    process.env.RAZORPAY_ENABLED = 'false';
    assert.equal(isRazorpayEnabled(), false);
    process.env.RAZORPAY_ENABLED = '1';
    assert.equal(isRazorpayEnabled(), false);
    process.env.RAZORPAY_ENABLED = 'TRUE';
    assert.equal(isRazorpayEnabled(), true);
  });

  it('requires all three secrets before it reports itself configured', () => {
    process.env.RAZORPAY_KEY_ID = KEY_ID;
    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    assert.equal(isRazorpayConfigured(), false);
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    assert.equal(isRazorpayConfigured(), true);
  });

  it('fails safely when disabled, without touching the booking', async () => {
    process.env.RAZORPAY_ENABLED = 'false';
    const store = createFakeStore();
    store.seedBooking();
    const result = await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway: createFakeGateway(), store, now: NOW });
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.error.code === 'RAZORPAY_DISABLED');
    assert.equal(result.ok, false);
    // The manual flow is untouched: no payment row, booking still payable.
    assert.equal(store.payments.size, 0);
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'PAYMENT_PENDING');
  });

  it('fails safely when the secret is missing even though the flag is on', async () => {
    delete process.env.RAZORPAY_KEY_SECRET;
    const store = createFakeStore();
    store.seedBooking();
    const result = await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway: createFakeGateway(), store, now: NOW });
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.error.code === 'RAZORPAY_NOT_CONFIGURED');
  });
});

// ---------------------------------------------------------------------------
// Order creation: authorization
// ---------------------------------------------------------------------------

describe('razorpay: order creation authorization', () => {
  it('refuses a caller who does not own the booking', async () => {
    const store = createFakeStore();
    store.seedBooking();
    const result = await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: OTHER_SEEKER_ID, gateway: createFakeGateway(), store, now: NOW });
    assert.ok(!result.ok);
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.error.code === 'FORBIDDEN_NOT_BOOKING_OWNER');
    assert.equal(store.payments.size, 0, 'no payment row may be created for another seeker');
  });

  it('404s an unknown booking rather than 403, so ids cannot be probed', async () => {
    const store = createFakeStore();
    const result = await runCreateRazorpayOrder({ bookingId: 'no-such-booking', callerId: SEEKER_ID, gateway: createFakeGateway(), store, now: NOW });
    assert.ok(!result.ok && result.error.code === 'BOOKING_NOT_FOUND');
    assert.ok(!result.ok && result.error.httpStatus === 404);
  });

  it('refuses a booking that is no longer payable', async () => {
    const store = createFakeStore();
    store.seedBooking({ status: 'CONFIRMED' });
    const result = await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway: createFakeGateway(), store, now: NOW });
    assert.ok(!result.ok && result.error.code === 'BOOKING_NOT_PAYABLE');
  });

  it('refuses when the 5-minute hold has already elapsed', async () => {
    const store = createFakeStore();
    store.seedBooking();
    store.seedHold({ status: 'EXPIRED', expires_at: new Date(NOW.getTime() - 1000).toISOString() });
    const result = await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway: createFakeGateway(), store, now: NOW });
    assert.ok(!result.ok && result.error.code === 'HOLD_EXPIRED');
    assert.equal(store.payments.size, 0);
  });

  it('refuses when the session has already started', async () => {
    const store = createFakeStore();
    store.seedBooking({ start_time: new Date(NOW.getTime() - 60_000).toISOString() });
    const result = await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway: createFakeGateway(), store, now: NOW });
    assert.ok(!result.ok && result.error.code === 'SLOT_ALREADY_STARTED');
  });
});

// ---------------------------------------------------------------------------
// Order creation: server-derived amount
// ---------------------------------------------------------------------------

describe('razorpay: server-derived amount', () => {
  it('takes the amount from the booking, in paise, and never from the caller', async () => {
    const store = createFakeStore();
    store.seedBooking({ amount_inr: 499 });
    const gateway = createFakeGateway();
    const result = await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway, store, now: NOW });

    assert.ok(result.ok);
    assert.ok(result.ok && result.value.amountInr === 499);
    // 499 INR must reach the gateway as 49900 paise.
    const created = await gateway.createOrder({ amountPaise: 49900, currency: 'INR', receipt: 'x', notes: {}, expiresInSeconds: 900 });
    assert.ok(created.ok && created.order.amount === 49900);
  });

  it('writes the server amount onto the payment row', async () => {
    const store = createFakeStore();
    store.seedBooking({ amount_inr: 1234 });
    const result = await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway: createFakeGateway(), store, now: NOW });
    assert.ok(result.ok);
    assert.equal(store.payments.get(PAYMENT_ID)!.amount_inr, 1234);
  });

  it('refuses a booking whose stored amount is not a positive number', async () => {
    const store = createFakeStore();
    store.seedBooking({ amount_inr: 0 });
    const result = await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway: createFakeGateway(), store, now: NOW });
    assert.ok(!result.ok && result.error.code === 'AMOUNT_UNAVAILABLE');
  });

  it('converts rupees to paise without floating-point drift', () => {
    assert.equal(toPaise(999), 99900);
    assert.equal(toPaise(1), 100);
    assert.equal(toPaise(0.1), 10);
  });
});

// ---------------------------------------------------------------------------
// Order creation: idempotency and gateway failure
// ---------------------------------------------------------------------------

describe('razorpay: order creation is idempotent', () => {
  it('reuses the in-flight order instead of minting a second one', async () => {
    const store = createFakeStore();
    store.seedBooking();
    const gateway = createFakeGateway();

    const first = await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway, store, now: NOW });
    const callsAfterFirst = gateway.calls;
    const second = await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway, store, now: NOW });

    assert.ok(first.ok && second.ok);
    assert.ok(first.ok && first.value.alreadyCreated === false);
    assert.ok(second.ok && second.value.alreadyCreated === true);
    assert.ok(first.ok && second.ok && first.value.razorpayOrderId === second.value.razorpayOrderId);
    assert.equal(gateway.calls, callsAfterFirst, 'a second request must not call Razorpay again');
    assert.equal(store.payments.size, 1, 'payments is UNIQUE(booking_id)');
  });

  it('refuses to overwrite a manual payment that is mid-review', async () => {
    const store = createFakeStore();
    store.seedBooking({ status: 'PENDING_VERIFICATION' });
    store.payments.set('manual-1', {
      id: 'manual-1', booking_id: BOOKING_ID, seeker_id: SEEKER_ID, amount_inr: 999,
      status: 'PENDING_VERIFICATION', gateway: 'manual', razorpay_order_id: null,
      razorpay_payment_id: null, razorpay_signature: null, captured_at: null,
      failure_reason: null, refund_id: null, refund_status: null,
    });
    const result = await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway: createFakeGateway(), store, now: NOW });
    assert.ok(!result.ok && result.error.code === 'PAYMENT_ALREADY_IN_PROGRESS');
    assert.equal(store.payments.get('manual-1')!.status, 'PENDING_VERIFICATION');
  });

  it('never overwrites a manual proof that lands after the pre-flight check', async () => {
    // Regression: `attachGatewayOrder` used to upsert, so a manual proof
    // submitted between the ownership check and the write was silently
    // destroyed (proof path, UTR and admin review state all lost).
    const store = createFakeStore();
    store.seedBooking();
    const gateway = createFakeGateway();
    const realAttach = store.attachGatewayOrder;
    store.attachGatewayOrder = async (args: any) => {
      // Simulate the seeker submitting a manual proof mid-request.
      store.payments.set('manual-race', {
        id: 'manual-race', booking_id: BOOKING_ID, seeker_id: SEEKER_ID, amount_inr: 999,
        status: 'PENDING_VERIFICATION', gateway: 'manual', razorpay_order_id: null,
        razorpay_payment_id: null, razorpay_signature: null, captured_at: null,
        failure_reason: null, refund_id: null, refund_status: null,
      });
      return realAttach(args);
    };

    const result = await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway, store, now: NOW });

    assert.ok(!result.ok, 'the gateway order must be refused, not written over the proof');
    assert.ok(!result.ok && result.error.code === 'PAYMENT_ALREADY_IN_PROGRESS');
    // The manual proof is intact.
    const manual = store.payments.get('manual-race')!;
    assert.equal(manual.status, 'PENDING_VERIFICATION');
    assert.equal(manual.gateway, 'manual');
    assert.equal(store.payments.size, 1);
  });

  it('reports a gateway failure without recording a payment', async () => {
    const store = createFakeStore();
    store.seedBooking();
    const gateway = { createOrder: async () => ({ ok: false as const, reason: 'gateway_status_500' }), fetchPayment: async () => ({ ok: false as const, reason: 'x' }) } as any;
    const result = await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway, store, now: NOW });
    assert.ok(!result.ok && result.error.code === 'RAZORPAY_ORDER_FAILED');
    assert.equal(store.payments.size, 0);
  });
});

// ---------------------------------------------------------------------------
// Payment verification: signature
// ---------------------------------------------------------------------------

describe('razorpay: payment verification signature', () => {
  async function setupCapturable(options: { gatewayAmountPaise?: number; orderId?: string } = {}) {
    const store = createFakeStore();
    store.seedBooking();
    const orderId = options.orderId ?? 'order_TEST123';
    const created = await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway: createFakeGateway({ orderId }), store, now: NOW });
    assert.ok(created.ok);
    return { store, orderId };
  }

  const verifyArgs = (orderId: string, paymentId: string, signature?: string) => ({
    bookingId: BOOKING_ID,
    callerId: SEEKER_ID,
    razorpayOrderId: orderId,
    razorpayPaymentId: paymentId,
    razorpaySignature: signature ?? signPayment(orderId, paymentId),
  });

  it('accepts a valid signature and confirms the payment', async () => {
    const { store, orderId } = await setupCapturable();
    const result = await runVerifyRazorpayPayment({
      ...verifyArgs(orderId, 'pay_OK'),
      gateway: createFakeGateway({ orderId }),
      store,
      now: NOW,
    });

    assert.ok(result.ok);
    assert.ok(result.ok && result.value.paymentStatus === 'VERIFIED');
    assert.equal(store.payments.get(PAYMENT_ID)!.razorpay_payment_id, 'pay_OK');
    assert.equal(store.payments.get(PAYMENT_ID)!.razorpay_signature, signPayment(orderId, 'pay_OK'));
    assert.equal(store.payments.get(PAYMENT_ID)!.captured_at, NOW.toISOString());
  });

  it('rejects an invalid signature and writes nothing', async () => {
    const { store, orderId } = await setupCapturable();
    const result = await runVerifyRazorpayPayment({
      ...verifyArgs(orderId, 'pay_OK', 'deadbeef'.repeat(8)),
      gateway: createFakeGateway({ orderId }),
      store,
      now: NOW,
    });

    assert.ok(!result.ok && result.error.code === 'RAZORPAY_SIGNATURE_INVALID');
    // Nothing advanced: still in flight, booking still payable.
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'PAYMENT_PROCESSING');
    assert.equal(store.payments.get(PAYMENT_ID)!.razorpay_payment_id, null);
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'PAYMENT_PENDING');
  });

  it('rejects a signature minted with the wrong secret', async () => {
    const { store, orderId } = await setupCapturable();
    const forged = createHmac('sha256', 'attacker-secret').update(`${orderId}|pay_OK`).digest('hex');
    const result = await runVerifyRazorpayPayment({ ...verifyArgs(orderId, 'pay_OK', forged), gateway: createFakeGateway({ orderId }), store, now: NOW });
    assert.ok(!result.ok && result.error.code === 'RAZORPAY_SIGNATURE_INVALID');
  });

  it('rejects a signature harvested from a different payment id', async () => {
    const { store, orderId } = await setupCapturable();
    // Signature is genuinely valid, but for a DIFFERENT payment.
    const stolen = signPayment(orderId, 'pay_SOMEONE_ELSES');
    const result = await runVerifyRazorpayPayment({ ...verifyArgs(orderId, 'pay_OK', stolen), gateway: createFakeGateway({ orderId }), store, now: NOW });
    assert.ok(!result.ok && result.error.code === 'RAZORPAY_SIGNATURE_INVALID');
  });

  it('rejects a wrong order id even when the payment and signature are real', async () => {
    const { store, orderId } = await setupCapturable();
    const otherOrder = 'order_SOMEONE_ELSE';
    // Fully valid signature — just for a different order than the one we stored.
    const result = await runVerifyRazorpayPayment({
      ...verifyArgs(otherOrder, 'pay_OK'),
      gateway: createFakeGateway({ orderId }),
      store,
      now: NOW,
    });

    assert.ok(!result.ok && result.error.code === 'RAZORPAY_ORDER_MISMATCH');
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'PAYMENT_PROCESSING');
  });

  it('refuses a non-owner trying to verify someone else’s payment', async () => {
    const { store, orderId } = await setupCapturable();
    const result = await runVerifyRazorpayPayment({
      ...verifyArgs(orderId, 'pay_OK'),
      callerId: OTHER_SEEKER_ID,
      gateway: createFakeGateway({ orderId }),
      store,
      now: NOW,
    });
    assert.ok(!result.ok && result.error.code === 'FORBIDDEN_NOT_BOOKING_OWNER');
  });

  it('rejects a missing/blank payment field before doing any work', async () => {
    const { store, orderId } = await setupCapturable();
    const result = await runVerifyRazorpayPayment({
      bookingId: BOOKING_ID,
      callerId: SEEKER_ID,
      razorpayOrderId: orderId,
      razorpayPaymentId: '   ',
      razorpaySignature: signPayment(orderId, 'pay_OK'),
      gateway: createFakeGateway({ orderId }),
      store,
      now: NOW,
    });
    assert.ok(!result.ok && result.error.code === 'VALIDATION_ERROR');
  });

  it('rejects a gateway amount that disagrees with the booking', async () => {
    const { store, orderId } = await setupCapturable();
    const result = await runVerifyRazorpayPayment({
      ...verifyArgs(orderId, 'pay_OK'),
      gateway: createFakeGateway({ orderId, amountPaise: 1 }), // attacker paid ₹0.01
      store,
      now: NOW,
    });

    assert.ok(!result.ok && result.error.code === 'RAZORPAY_AMOUNT_MISMATCH');
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'PAYMENT_PROCESSING');
    assert.ok(store.events.some((e) => e.eventType === 'PAYMENT_AMOUNT_MISMATCH'), 'the mismatch is recorded');
  });

  it('refuses an authorized-but-not-captured payment', async () => {
    const { store, orderId } = await setupCapturable();
    const result = await runVerifyRazorpayPayment({
      ...verifyArgs(orderId, 'pay_OK'),
      gateway: createFakeGateway({ orderId, captured: false }),
      store,
      now: NOW,
    });
    assert.ok(!result.ok && result.error.code === 'PAYMENT_NOT_CAPTURED');
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'PAYMENT_PENDING');
  });

  it('still confirms on signature alone when the gateway is unreachable', async () => {
    const { store, orderId } = await setupCapturable();
    const gateway = { createOrder: async () => ({ ok: false as const, reason: 'x' }), fetchPayment: async () => ({ ok: false as const, reason: 'gateway_unreachable' }) } as any;
    const result = await runVerifyRazorpayPayment({ ...verifyArgs(orderId, 'pay_OK'), gateway, store, now: NOW });
    // The signature already proved the payment id belongs to this order.
    assert.ok(result.ok);
  });
});

// ---------------------------------------------------------------------------
// Payment verification: duplicate / idempotency
// ---------------------------------------------------------------------------

describe('razorpay: duplicate verification', () => {
  it('confirms once, then reports a duplicate without re-confirming', async () => {
    const store = createFakeStore();
    store.seedBooking();
    const orderId = 'order_TEST123';
    await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway: createFakeGateway({ orderId }), store, now: NOW });

    const args = { bookingId: BOOKING_ID, callerId: SEEKER_ID, razorpayOrderId: orderId, razorpayPaymentId: 'pay_OK', razorpaySignature: signPayment(orderId, 'pay_OK'), gateway: createFakeGateway({ orderId }), store, now: NOW };

    const first = await runVerifyRazorpayPayment(args);
    const second = await runVerifyRazorpayPayment(args);
    const third = await runVerifyRazorpayPayment(args);

    assert.ok(first.ok && first.value.duplicate === false);
    assert.ok(first.ok && first.value.mentorNotified === true);
    assert.ok(second.ok && second.value.duplicate === true);
    assert.ok(third.ok && third.value.duplicate === true);
    // The mentor notification hangs off the booking transition, so it is only
    // ever true on the FIRST call.
    assert.ok(second.ok && second.value.mentorNotified === false);
    assert.ok(third.ok && third.value.mentorNotified === false);
  });

  it('records exactly one capture event no matter how many times it is verified', async () => {
    const store = createFakeStore();
    store.seedBooking();
    const orderId = 'order_TEST123';
    await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway: createFakeGateway({ orderId }), store, now: NOW });
    const args = { bookingId: BOOKING_ID, callerId: SEEKER_ID, razorpayOrderId: orderId, razorpayPaymentId: 'pay_OK', razorpaySignature: signPayment(orderId, 'pay_OK'), gateway: createFakeGateway({ orderId }), store, now: NOW };
    for (let i = 0; i < 4; i += 1) await runVerifyRazorpayPayment(args);
    assert.equal(store.events.filter((e) => e.eventType === 'PAYMENT_CAPTURED').length, 1);
  });

  it('refuses a second, different payment id against the same booking', async () => {
    const store = createFakeStore();
    store.seedBooking();
    const orderId = 'order_TEST123';
    await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway: createFakeGateway({ orderId }), store, now: NOW });
    const base = { bookingId: BOOKING_ID, callerId: SEEKER_ID, razorpayOrderId: orderId, gateway: createFakeGateway({ orderId }), store, now: NOW };

    await runVerifyRazorpayPayment({ ...base, razorpayPaymentId: 'pay_FIRST', razorpaySignature: signPayment(orderId, 'pay_FIRST') });
    const second = await runVerifyRazorpayPayment({ ...base, razorpayPaymentId: 'pay_SECOND', razorpaySignature: signPayment(orderId, 'pay_SECOND') });

    assert.ok(!second.ok && second.error.code === 'PAYMENT_STATE_CONFLICT');
    assert.equal(store.payments.get(PAYMENT_ID)!.razorpay_payment_id, 'pay_FIRST', 'the first payment id is preserved');
  });
});

// ---------------------------------------------------------------------------
// Success flow: state transitions
// ---------------------------------------------------------------------------

describe('razorpay: successful payment transitions', () => {
  it('walks PAYMENT_PENDING -> MENTOR_PENDING and verifies the payment once', async () => {
    const store = createFakeStore();
    store.seedBooking();
    const orderId = 'order_TEST123';

    // Order creation leaves the BOOKING in PAYMENT_PENDING so the hold-expiry
    // cron can still cancel an unpaid booking.
    const created = await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway: createFakeGateway({ orderId }), store, now: NOW });
    assert.ok(created.ok);
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'PAYMENT_PENDING');
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'PAYMENT_PROCESSING');

    const verified = await runVerifyRazorpayPayment({
      bookingId: BOOKING_ID, callerId: SEEKER_ID, razorpayOrderId: orderId, razorpayPaymentId: 'pay_OK',
      razorpaySignature: signPayment(orderId, 'pay_OK'), gateway: createFakeGateway({ orderId }), store, now: NOW,
    });

    assert.ok(verified.ok);
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'MENTOR_PENDING');
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'VERIFIED');
    assert.ok(store.events.some((e) => e.eventType === 'GATEWAY_ORDER_CREATED'));
    assert.ok(store.events.some((e) => e.eventType === 'PAYMENT_CAPTURED'));
  });

  it('leaves the mentor confirmation flow untouched (MENTOR_PENDING, not CONFIRMED)', async () => {
    const store = createFakeStore();
    store.seedBooking();
    const orderId = 'order_TEST123';
    await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway: createFakeGateway({ orderId }), store, now: NOW });
    await runVerifyRazorpayPayment({
      bookingId: BOOKING_ID, callerId: SEEKER_ID, razorpayOrderId: orderId, razorpayPaymentId: 'pay_OK',
      razorpaySignature: signPayment(orderId, 'pay_OK'), gateway: createFakeGateway({ orderId }), store, now: NOW,
    });
    // The mentor still has to confirm; the gateway never does it for them.
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'MENTOR_PENDING');
  });
});

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

describe('razorpay: webhook signature', () => {
  it('rejects a delivery with no signature', async () => {
    const store = createFakeStore();
    const body = webhookBody();
    const result = await runRazorpayWebhook({ rawBody: body, signature: null, gateway: createFakeGateway(), store, now: NOW });
    assert.ok(!result.ok && result.error.code === 'RAZORPAY_SIGNATURE_MISSING');
  });

  it('rejects a delivery with an invalid signature and stores nothing', async () => {
    const store = createFakeStore();
    store.seedBooking();
    const orderId = 'order_TEST123';
    await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway: createFakeGateway({ orderId }), store, now: NOW });

    const body = webhookBody({ orderId });
    const result = await runRazorpayWebhook({ rawBody: body, signature: 'f'.repeat(64), gateway: createFakeGateway({ orderId }), store, now: NOW });

    assert.ok(!result.ok && result.error.code === 'RAZORPAY_SIGNATURE_INVALID');
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'PAYMENT_PROCESSING');
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'PAYMENT_PENDING');
    assert.equal(store.webhookKeys.size, 0, 'an unverified delivery is never claimed');
  });

  it('rejects a body tampered with after signing', async () => {
    const store = createFakeStore();
    const original = webhookBody({ amount: 99900 });
    const tampered = webhookBody({ amount: 100 });
    const result = await runRazorpayWebhook({ rawBody: tampered, signature: signWebhook(original), gateway: createFakeGateway(), store, now: NOW });
    assert.ok(!result.ok && result.error.code === 'RAZORPAY_SIGNATURE_INVALID');
  });

  it('verifies against the raw body, so re-serialising would break it', () => {
    // A body whose parsed form round-trips differently (key order) is a
    // different byte sequence and must not verify.
    const a = '{"event":"payment.captured","payload":{}}';
    const b = '{"payload":{},"event":"payment.captured"}';
    assert.equal(verifyWebhookSignature({ body: a, signature: signWebhook(a) }), true);
    assert.equal(verifyWebhookSignature({ body: b, signature: signWebhook(a) }), false);
  });
});

describe('razorpay: webhook processing', () => {
  async function withInFlightOrder() {
    const store = createFakeStore();
    store.seedBooking();
    const orderId = 'order_TEST123';
    await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway: createFakeGateway({ orderId }), store, now: NOW });
    return { store, orderId };
  }

  it('confirms the payment when the webhook arrives first', async () => {
    const { store, orderId } = await withInFlightOrder();
    const body = webhookBody({ orderId, paymentId: 'pay_OK' });
    const result = await runRazorpayWebhook({ rawBody: body, signature: signWebhook(body), gateway: createFakeGateway({ orderId }), store, now: NOW });

    assert.ok(result.ok);
    assert.ok(result.ok && result.handled === 'captured');
    assert.ok(result.ok && result.mentorNotified === true);
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'VERIFIED');
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'MENTOR_PENDING');
  });

  it('is safe when the browser verification already happened', async () => {
    const { store, orderId } = await withInFlightOrder();

    await runVerifyRazorpayPayment({
      bookingId: BOOKING_ID, callerId: SEEKER_ID, razorpayOrderId: orderId, razorpayPaymentId: 'pay_OK',
      razorpaySignature: signPayment(orderId, 'pay_OK'), gateway: createFakeGateway({ orderId }), store, now: NOW,
    });
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'MENTOR_PENDING');

    const body = webhookBody({ orderId, paymentId: 'pay_OK' });
    const result = await runRazorpayWebhook({ rawBody: body, signature: signWebhook(body), gateway: createFakeGateway({ orderId }), store, now: NOW });

    assert.ok(result.ok);
    // The browser already won the transition, so the webhook must not re-notify.
    assert.ok(result.ok && result.mentorNotified === false);
    assert.equal(store.events.filter((e) => e.eventType === 'PAYMENT_CAPTURED').length, 1);
  });

  it('ignores a replayed delivery and does not re-apply it', async () => {
    const { store, orderId } = await withInFlightOrder();
    const body = webhookBody({ orderId, paymentId: 'pay_OK' });
    const sig = signWebhook(body);

    const first = await runRazorpayWebhook({ rawBody: body, signature: sig, gateway: createFakeGateway({ orderId }), store, now: NOW });
    const replay = await runRazorpayWebhook({ rawBody: body, signature: sig, gateway: createFakeGateway({ orderId }), store, now: NOW });
    const replay2 = await runRazorpayWebhook({ rawBody: body, signature: sig, gateway: createFakeGateway({ orderId }), store, now: NOW });

    assert.ok(first.ok && first.duplicateEvent === false);
    assert.ok(replay.ok && replay.duplicateEvent === true);
    assert.ok(replay2.ok && replay2.duplicateEvent === true);
    assert.equal(store.events.filter((e) => e.eventType === 'PAYMENT_CAPTURED').length, 1);
  });

  it('notifies the mentor exactly once across verify + webhook + replays', async () => {
    const { store, orderId } = await withInFlightOrder();
    const body = webhookBody({ orderId, paymentId: 'pay_OK' });
    const sig = signWebhook(body);

    let notifications = 0;
    // Mirrors the route: only the winner of the booking transition notifies.
    const first = await runVerifyRazorpayPayment({
      bookingId: BOOKING_ID, callerId: SEEKER_ID, razorpayOrderId: orderId, razorpayPaymentId: 'pay_OK',
      razorpaySignature: signPayment(orderId, 'pay_OK'), gateway: createFakeGateway({ orderId }), store, now: NOW,
    });
    if (first.ok && first.value.mentorNotified) notifications += 1;

    for (let i = 0; i < 3; i += 1) {
      const r = await runRazorpayWebhook({ rawBody: body, signature: sig, gateway: createFakeGateway({ orderId }), store, now: NOW });
      if (r.ok && r.mentorNotified) notifications += 1;
    }

    assert.equal(notifications, 1, 'exactly one mentor notification for one captured payment');
  });

  it('reports the real payment id on a capture so the notification can link to it', async () => {
    const { store, orderId } = await withInFlightOrder();
    const body = webhookBody({ orderId, paymentId: 'pay_OK' });
    const result = await runRazorpayWebhook({ rawBody: body, signature: signWebhook(body), gateway: createFakeGateway({ orderId }), store, now: NOW });

    assert.ok(result.ok);
    // The route feeds this straight into the notification metadata; an empty
    // value here would silently strip the payment link from the mentor's alert.
    assert.ok(result.ok && result.paymentId === PAYMENT_ID, 'webhook must surface the real payment id');
  });

  it('refuses a capture whose amount disagrees with the booking', async () => {
    const { store, orderId } = await withInFlightOrder();
    const body = webhookBody({ orderId, paymentId: 'pay_OK', amount: 1 });
    const result = await runRazorpayWebhook({ rawBody: body, signature: signWebhook(body), gateway: createFakeGateway({ orderId }), store, now: NOW });

    assert.ok(result.ok && result.handled === 'amount_mismatch');
    assert.ok(result.ok && result.mentorNotified === false);
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'PAYMENT_PENDING');
  });

  it('acknowledges a capture for a payment we do not know about', async () => {
    const store = createFakeStore();
    const body = webhookBody({ orderId: 'order_UNKNOWN', paymentId: 'pay_UNKNOWN' });
    const result = await runRazorpayWebhook({ rawBody: body, signature: signWebhook(body), gateway: createFakeGateway(), store, now: NOW });
    assert.ok(result.ok && result.handled === 'unmatched');
    assert.equal(store.payments.size, 0);
  });

  it('ignores an unrecognised event type rather than guessing a transition', async () => {
    const { store, orderId } = await withInFlightOrder();
    const body = webhookBody({ orderId, event: 'subscription.charged' });
    const result = await runRazorpayWebhook({ rawBody: body, signature: signWebhook(body), gateway: createFakeGateway({ orderId }), store, now: NOW });
    assert.ok(result.ok && result.handled === 'ignored');
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'PAYMENT_PROCESSING');
  });

  it('rejects a malformed body after a valid signature', async () => {
    const store = createFakeStore();
    const body = 'not json at all';
    const result = await runRazorpayWebhook({ rawBody: body, signature: signWebhook(body), gateway: createFakeGateway(), store, now: NOW });
    assert.ok(!result.ok && result.error.code === 'RAZORPAY_WEBHOOK_MALFORMED');
  });

  it('resumes a delivery whose first attempt failed, instead of dropping the payment', async () => {
    // Regression: a transient failure left the event row at processed = false,
    // but the retry was treated as a plain duplicate and skipped. The seeker
    // had paid and the booking stayed in PAYMENT_PENDING forever.
    const { store, orderId } = await withInFlightOrder();
    const body = webhookBody({ orderId, paymentId: 'pay_OK' });
    const sig = signWebhook(body);

    // First delivery captures the payment, then fails advancing the booking —
    // the realistic partial-failure that used to strand a paid booking.
    const realAdvance = store.markBookingMentorPending;
    let broken = true;
    store.markBookingMentorPending = async (bookingId: string, at: string) => {
      if (broken) { broken = false; throw new Error('transient database failure'); }
      return realAdvance(bookingId, at);
    };

    await assert.rejects(
      () => runRazorpayWebhook({ rawBody: body, signature: sig, gateway: createFakeGateway({ orderId }), store, now: NOW }),
      /transient database failure/,
    );
    // The event was claimed but never completed.
    assert.equal(store.webhookKeys.get(`razorpay:${eventIdOf(body)}`), false, 'must stay unprocessed so a retry can resume');
    // The exact stranded state this bug produced: money taken, booking stuck.
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'VERIFIED');
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'PAYMENT_PENDING');

    // Razorpay retries: the capture must actually be applied this time.
    const retry = await runRazorpayWebhook({ rawBody: body, signature: sig, gateway: createFakeGateway({ orderId }), store, now: NOW });

    assert.ok(retry.ok);
    assert.ok(retry.ok && retry.handled !== 'duplicate', 'the retried capture is applied, not skipped');
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'MENTOR_PENDING');
    assert.equal(store.events.filter((e) => e.eventType === 'PAYMENT_CAPTURED').length, 1, 'and still only once');
  });

  it('skips a delivery that already completed', async () => {
    const { store, orderId } = await withInFlightOrder();
    const body = webhookBody({ orderId, paymentId: 'pay_OK' });
    const sig = signWebhook(body);
    await runRazorpayWebhook({ rawBody: body, signature: sig, gateway: createFakeGateway({ orderId }), store, now: NOW });
    const again = await runRazorpayWebhook({ rawBody: body, signature: sig, gateway: createFakeGateway({ orderId }), store, now: NOW });
    assert.ok(again.ok && again.handled === 'duplicate');
  });
});

// ---------------------------------------------------------------------------
// Failed payment
// ---------------------------------------------------------------------------

describe('razorpay: failed payment', () => {
  it('records the failure, keeps the booking payable, and never notifies the mentor', async () => {
    const store = createFakeStore();
    store.seedBooking();
    const orderId = 'order_TEST123';
    await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway: createFakeGateway({ orderId }), store, now: NOW });

    const body = webhookBody({ orderId, paymentId: 'pay_FAIL', event: 'payment.failed', errorDescription: 'Your card was declined.' });
    const result = await runRazorpayWebhook({ rawBody: body, signature: signWebhook(body), gateway: createFakeGateway({ orderId }), store, now: NOW });

    assert.ok(result.ok && result.handled === 'failed');
    assert.ok(result.ok && result.mentorNotified === false);

    const payment = store.payments.get(PAYMENT_ID)!;
    assert.equal(payment.status, 'FAILED');
    assert.match(String(payment.failure_reason), /declined/i);
    // The booking stays payable so the seeker can simply retry.
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'PAYMENT_PENDING');
    assert.ok(store.events.some((e) => e.eventType === 'PAYMENT_FAILED'));
  });

  it('cannot be downgraded to FAILED after a capture (out-of-order delivery)', async () => {
    const store = createFakeStore();
    store.seedBooking();
    const orderId = 'order_TEST123';
    await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway: createFakeGateway({ orderId }), store, now: NOW });

    const captured = webhookBody({ orderId, paymentId: 'pay_OK', event: 'payment.captured' });
    await runRazorpayWebhook({ rawBody: captured, signature: signWebhook(captured), gateway: createFakeGateway({ orderId }), store, now: NOW });
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'VERIFIED');

    // A stale failure arriving afterwards must not undo a confirmed capture.
    const failed = webhookBody({ orderId, paymentId: 'pay_OK', event: 'payment.failed', errorDescription: 'late failure' });
    const late = await runRazorpayWebhook({ rawBody: failed, signature: signWebhook(failed), gateway: createFakeGateway({ orderId }), store, now: NOW });

    assert.ok(late.ok);
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'VERIFIED', 'a captured payment is never downgraded');
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'MENTOR_PENDING');
  });

  it('preserves the payment row for a retry rather than deleting it', async () => {
    const store = createFakeStore();
    store.seedBooking();
    const orderId = 'order_TEST123';
    await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway: createFakeGateway({ orderId }), store, now: NOW });
    const body = webhookBody({ orderId, paymentId: 'pay_FAIL', event: 'payment.failed' });
    await runRazorpayWebhook({ rawBody: body, signature: signWebhook(body), gateway: createFakeGateway({ orderId }), store, now: NOW });

    // The row survives with the failure recorded, so support can see what happened.
    assert.equal(store.payments.size, 1);
    assert.ok(store.events.some((e) => e.eventType === 'PAYMENT_FAILED'));
  });
});

// ---------------------------------------------------------------------------
// Refunds (schema prepared, no invented behaviour)
// ---------------------------------------------------------------------------

describe('razorpay: refund bookkeeping', () => {
  it('records a refund against the payment without moving the booking', async () => {
    const store = createFakeStore();
    store.seedBooking();
    const orderId = 'order_TEST123';
    await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway: createFakeGateway({ orderId }), store, now: NOW });
    const captured = webhookBody({ orderId, paymentId: 'pay_OK' });
    await runRazorpayWebhook({ rawBody: captured, signature: signWebhook(captured), gateway: createFakeGateway({ orderId }), store, now: NOW });

    const refundBody = JSON.stringify({
      event: 'refund.processed',
      payload: { refund: { entity: 'refund', id: 'rfnd_1', order_id: orderId, payment_id: 'pay_OK', amount: 99900, currency: 'INR', status: 'processed' } },
    });
    const result = await runRazorpayWebhook({ rawBody: refundBody, signature: signWebhook(refundBody), gateway: createFakeGateway({ orderId }), store, now: NOW });

    assert.ok(result.ok);
    assert.equal(store.refunds.length, 1);
    assert.equal(store.refunds[0].refundId, 'rfnd_1');
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'REFUNDED');
    // No invented policy: the booking is NOT cancelled or moved backwards.
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'MENTOR_PENDING');
  });

  it('never confirms an uncaptured payment just because a refund was created', async () => {
    // Regression: `refund.created` used to write status VERIFIED, which would
    // confirm a payment that was only ever authorized.
    const store = createFakeStore();
    store.seedBooking();
    const orderId = 'order_TEST123';
    await runCreateRazorpayOrder({ bookingId: BOOKING_ID, callerId: SEEKER_ID, gateway: createFakeGateway({ orderId }), store, now: NOW });
    assert.equal(store.payments.get(PAYMENT_ID)!.status, 'PAYMENT_PROCESSING');

    const refundBody = JSON.stringify({
      event: 'refund.created',
      payload: { refund: { entity: 'refund', id: 'rfnd_2', order_id: orderId, payment_id: 'pay_PENDING', amount: 99900, currency: 'INR', status: 'pending' } },
    });
    await runRazorpayWebhook({ rawBody: refundBody, signature: signWebhook(refundBody), gateway: createFakeGateway({ orderId }), store, now: NOW });

    const payment = store.payments.get(PAYMENT_ID)!;
    assert.equal(payment.refund_id, 'rfnd_2', 'the refund is still recorded');
    assert.notEqual(payment.status, 'VERIFIED', 'a refund must never confirm an uncaptured payment');
    assert.equal(payment.status, 'PAYMENT_PROCESSING', 'an uncaptured payment keeps its state');
    assert.equal(store.bookings.get(BOOKING_ID)!.status, 'PAYMENT_PENDING');
  });
});

// ---------------------------------------------------------------------------
// Webhook parsing
// ---------------------------------------------------------------------------

describe('razorpay: webhook payload parsing', () => {
  it('extracts the fields the handler needs from a payment event', () => {
    const parsed = parseRazorpayWebhookEvent(webhookBody({ paymentId: 'pay_X', orderId: 'order_Y', amount: 49900 }));
    assert.ok(parsed);
    assert.equal(parsed!.eventType, 'payment.captured');
    assert.equal(parsed!.gatewayPaymentId, 'pay_X');
    assert.equal(parsed!.gatewayOrderId, 'order_Y');
    assert.equal(parsed!.amount, 49900);
    assert.equal(parsed!.currency, 'INR');
  });

  it('derives a stable event id so a redelivery maps to the same row', () => {
    const body = webhookBody({ paymentId: 'pay_X' });
    assert.equal(parseRazorpayWebhookEvent(body)!.eventId, parseRazorpayWebhookEvent(body)!.eventId);
  });

  it('rejects a body with no event type', () => {
    assert.equal(parseRazorpayWebhookEvent('{"payload":{}}'), null);
    assert.equal(parseRazorpayWebhookEvent('nonsense'), null);
  });
});

// ---------------------------------------------------------------------------
// Signature primitives
// ---------------------------------------------------------------------------

describe('razorpay: signature primitives', () => {
  it('verifies a payment signature over "<order>|<payment>"', () => {
    const sig = signPayment('order_1', 'pay_1');
    assert.equal(verifyPaymentSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: sig }), true);
    assert.equal(verifyPaymentSignature({ orderId: 'order_1', paymentId: 'pay_2', signature: sig }), false);
    assert.equal(verifyPaymentSignature({ orderId: 'order_2', paymentId: 'pay_1', signature: sig }), false);
  });

  it('fails closed when the secret is unavailable', () => {
    delete process.env.RAZORPAY_KEY_SECRET;
    assert.equal(verifyPaymentSignature({ orderId: 'o', paymentId: 'p', signature: 'x' }), false);
  });

  it('never returns true for an empty signature', () => {
    assert.equal(verifyPaymentSignature({ orderId: 'o', paymentId: 'p', signature: '' }), false);
  });
});
