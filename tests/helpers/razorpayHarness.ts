/**
 * Shared harness for the Razorpay service tests.
 *
 * Only the two edges of the production code are replaced here: the HTTP call to
 * Razorpay and the database. The business logic under test - order creation,
 * signature verification, the booking/payment state machine, webhook parsing,
 * dispatch and idempotency - is always the real code in
 * `src/lib/razorpayService.ts` and `src/lib/razorpaySignature.ts`.
 *
 * The store is not a stub. It reproduces the conditional-update semantics the
 * real Supabase adapter relies on: every mutator applies its transition ONLY
 * from the status it is allowed to move from, and returns the row (or `true`)
 * only when it actually won. That return value is the signal the service uses
 * to decide whether it owns the side effects, so a fake that always returned a
 * value would let a duplicate payment through unnoticed.
 *
 * The gateway signs nothing itself, but the tests sign with the same
 * HMAC-SHA256 the real verifier checks, so a signature assertion is meaningful.
 */

import { createHmac } from 'node:crypto';

import {
  toPaise,
  type PaymentEventInput,
  type RazorpayBookingRow,
  type RazorpayGatewayClient,
  type RazorpayHoldRow,
  type RazorpayPaymentRow,
  type RazorpayStore,
  type UnmatchedCaptureRow,
} from '../../src/lib/razorpayService';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Re-exported so tests can assert on the same conversion the service uses. */
export { toPaise };

export const KEY_ID = 'rzp_test_key_id';
export const KEY_SECRET = 'rzp_test_key_secret_0123456789abcdef';
export const WEBHOOK_SECRET = 'rzp_test_webhook_secret_0123456789';

export const SEEKER_ID = '11111111-1111-4111-8111-111111111111';
export const OTHER_SEEKER_ID = '22222222-2222-4222-8222-222222222222';
export const MENTOR_ID = '33333333-3333-4333-8333-333333333333';
export const BOOKING_ID = '44444444-4444-4444-8444-444444444444';
export const HOLD_ID = '55555555-5555-4555-8555-555555555555';
export const PAYMENT_ID = '66666666-6666-4666-8666-666666666666';
export const ORDER_ID = 'order_TEST123';

/** A slot three hours out, so the session has demonstrably not started. */
export const NOW = new Date('2026-10-01T12:00:00.000Z');
export const FUTURE_START = new Date(NOW.getTime() + 3 * 60 * 60 * 1000).toISOString();

/** The booking amount every fixture starts from, in rupees. */
export const AMOUNT_INR = 999;

/**
 * Installs the Razorpay environment for a test file. Returns a restore function
 * so a caller can put the real environment back without relying on ordering
 * between test files.
 */
export function useRazorpayEnv(): () => void {
  const original = { ...process.env };
  process.env.RAZORPAY_ENABLED = 'true';
  process.env.RAZORPAY_KEY_ID = KEY_ID;
  process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  return () => {
    process.env = { ...original };
  };
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/** The exact string Razorpay signs for a payment: `<order_id>|<payment_id>`. */
export const signPayment = (orderId: string, paymentId: string): string =>
  createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');

/** The exact bytes Razorpay signs for a webhook: the raw request body. */
export const signWebhook = (body: string): string =>
  createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface RefundRecord {
  paymentId: string;
  refundId: string;
  status: string;
}

export type FakeStore = RazorpayStore & {
  bookings: Map<string, RazorpayBookingRow>;
  payments: Map<string, RazorpayPaymentRow>;
  events: PaymentEventInput[];
  /** `razorpay:<eventId>` -> processed flag, mirroring `webhook_events`. */
  webhookClaims: Map<string, boolean>;
  refunds: RefundRecord[];
  /** Captures that matched no local payment row, keyed by record id. */
  unmatched: Map<string, UnmatchedCaptureRow>;
  seedBooking(overrides?: Partial<RazorpayBookingRow>): RazorpayBookingRow;
  seedHold(overrides?: Partial<RazorpayHoldRow>): RazorpayHoldRow;
};

export function createFakeStore(): FakeStore {
  const bookings = new Map<string, RazorpayBookingRow>();
  const payments = new Map<string, RazorpayPaymentRow>();
  const holds = new Map<string, RazorpayHoldRow>();
  const events: PaymentEventInput[] = [];
  const webhookClaims = new Map<string, boolean>();
  const refunds: RefundRecord[] = [];
  const unmatched = new Map<string, UnmatchedCaptureRow>();

  return {
    bookings,
    payments,
    events,
    webhookClaims,
    refunds,
    unmatched,

    seedBooking(overrides: Partial<RazorpayBookingRow> = {}): RazorpayBookingRow {
      const row: RazorpayBookingRow = {
        id: BOOKING_ID,
        booking_code: 'BK-1001',
        seeker_id: SEEKER_ID,
        mentor_id: MENTOR_ID,
        amount_inr: AMOUNT_INR,
        status: 'PAYMENT_PENDING',
        start_time: FUTURE_START,
        hold_id: HOLD_ID,
        ...overrides,
      };
      bookings.set(row.id, row);
      return row;
    },

    seedHold(overrides: Partial<RazorpayHoldRow> = {}): RazorpayHoldRow {
      const row: RazorpayHoldRow = {
        id: HOLD_ID,
        status: 'ACTIVE',
        expires_at: new Date(NOW.getTime() + 10 * 60 * 1000).toISOString(),
        ...overrides,
      };
      holds.set(row.id, row);
      return row;
    },

    async getBooking(id) {
      return bookings.get(id) ?? null;
    },

    async getHold(id) {
      return holds.get(id) ?? null;
    },

    async getPaymentById(id) {
      return payments.get(id) ?? null;
    },

    async getPaymentByBookingId(bookingId) {
      for (const row of payments.values()) if (row.booking_id === bookingId) return row;
      return null;
    },

    async getPaymentByOrderId(orderId) {
      for (const row of payments.values()) if (row.razorpay_order_id === orderId) return row;
      return null;
    },

    async getPaymentByGatewayPaymentId(gatewayPaymentId) {
      for (const row of payments.values()) if (row.razorpay_payment_id === gatewayPaymentId) return row;
      return null;
    },

    // Plain insert, as the real adapter does: `payments` is UNIQUE(booking_id),
    // so a pre-existing row is a conflict, never an overwrite.
    async attachGatewayOrder({ bookingId, seekerId, amountInr, orderId }) {
      for (const existing of payments.values()) {
        if (existing.booking_id === bookingId) return null;
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

    // A retry re-uses the failed row, exactly as the real adapter does. The
    // previous attempt's identifiers are cleared so the old order can never be
    // attributed to the new attempt.
    async rearmFailedGatewayPayment({ paymentId, orderId }) {
      const row = payments.get(paymentId);
      if (!row || row.status !== 'FAILED' || row.gateway !== 'razorpay') return null;
      row.status = 'PAYMENT_PROCESSING';
      row.razorpay_order_id = orderId;
      row.razorpay_payment_id = null;
      row.razorpay_signature = null;
      row.captured_at = null;
      row.failure_reason = null;
      row.refund_id = null;
      row.refund_status = null;
      return row;
    },

    // A capture against a booking that will never be delivered: not confirmed,
    // the money traceable, a refund owed but not yet issued.
    async markPaymentRefundPending({ paymentId, gatewayPaymentId, reason }) {
      const row = payments.get(paymentId);
      if (!row || !['PAYMENT_PROCESSING', 'PAYMENT_PENDING'].includes(row.status)) return null;
      row.status = 'FAILED';
      row.razorpay_payment_id = gatewayPaymentId;
      row.refund_status = 'PENDING';
      row.failure_reason = reason;
      return row;
    },

    // Conditional on the in-flight state: the duplicate-capture gate.
    async markPaymentCaptured({ paymentId, gatewayPaymentId, signature, capturedAt }) {
      const row = payments.get(paymentId);
      if (!row || row.status !== 'PAYMENT_PROCESSING') return null;
      row.status = 'VERIFIED';
      row.razorpay_payment_id = gatewayPaymentId;
      row.razorpay_signature = signature;
      row.captured_at = capturedAt;
      return row;
    },

    async markPaymentAlreadyCaptured({ paymentId, gatewayPaymentId, capturedAt }) {
      const row = payments.get(paymentId);
      if (!row || row.status !== 'VERIFIED' || row.razorpay_payment_id !== null) return null;
      row.razorpay_payment_id = gatewayPaymentId;
      row.captured_at = capturedAt;
      return row;
    },

    async markPaymentFailed({ paymentId, reason }) {
      const row = payments.get(paymentId);
      if (!row || !['PAYMENT_PROCESSING', 'PAYMENT_PENDING'].includes(row.status)) return null;
      row.status = 'FAILED';
      row.failure_reason = reason;
      return row;
    },

    // The gate the mentor notification hangs off.
    async markBookingMentorPending(bookingId) {
      const row = bookings.get(bookingId);
      if (!row || !['PAYMENT_PENDING', 'PAYMENT_PROCESSING'].includes(row.status)) return false;
      row.status = 'MENTOR_PENDING';
      return true;
    },

    async recordRefund({ paymentId, refundId, refundStatus }) {
      const row = payments.get(paymentId);
      if (!row) return false;
      row.refund_id = refundId;
      row.refund_status = refundStatus;
      refunds.push({ paymentId, refundId, status: refundStatus });
      // A pending refund is bookkeeping only; only a captured payment may move.
      if (refundStatus === 'PENDING') return true;
      if (row.status !== 'VERIFIED') return false;
      row.status = refundStatus === 'REFUNDED' ? 'REFUNDED' : 'REFUND_FAILED';
      return true;
    },

    async insertPaymentEvent(event) {
      events.push(event);
    },

    // Mirrors the real adapter: the `processed` flag is what separates a
    // completed delivery (skip) from one that failed part-way (resume).
    async claimWebhookEvent({ eventId }) {
      const key = `razorpay:${eventId}`;
      const processed = webhookClaims.get(key);
      if (processed === undefined) {
        webhookClaims.set(key, false);
        return 'new';
      }
      return processed ? 'duplicate' : 'resume';
    },

    async completeWebhookEvent(eventId) {
      webhookClaims.set(`razorpay:${eventId}`, true);
    },

    // --- Unmatched-capture ledger (audit P0-1) -----------------------------
    // Mirrors the real adapter: identity is `(gateway, razorpay_payment_id)`, so
    // a redelivery OR a second event id for the same capture collapses onto ONE
    // record, exactly as the UNIQUE constraint does in Postgres.
    async recordUnmatchedCapture(input) {
      const existing = [...unmatched.values()].find(
        (row) => row.razorpay_payment_id === input.gatewayPaymentId,
      );
      if (existing) {
        existing.last_event_id = input.eventId;
        existing.last_received_at = input.receivedAt;
        existing.delivery_count += 1;
        existing.updated_at = input.receivedAt;
        return { row: { ...existing }, created: false };
      }
      const row: UnmatchedCaptureRow = {
        id: `unmatched-${unmatched.size + 1}`,
        gateway: 'razorpay',
        event_id: input.eventId,
        last_event_id: input.eventId,
        event_type: input.eventType,
        razorpay_payment_id: input.gatewayPaymentId,
        razorpay_order_id: input.gatewayOrderId,
        amount_paise: input.amountPaise,
        currency: input.currency,
        received_at: input.receivedAt,
        reason: input.reason,
        reconciliation_status: 'PENDING',
        delivery_count: 1,
        last_received_at: input.receivedAt,
        resolved_payment_id: null,
        resolution_note: null,
        created_at: input.receivedAt,
        updated_at: input.receivedAt,
      };
      unmatched.set(row.id, row);
      return { row: { ...row }, created: true };
    },

    async getUnmatchedCaptureById(id) {
      const row = unmatched.get(id);
      return row ? { ...row } : null;
    },

    async getUnmatchedCaptureByGatewayPaymentId(gatewayPaymentId) {
      const row = [...unmatched.values()].find((r) => r.razorpay_payment_id === gatewayPaymentId);
      return row ? { ...row } : null;
    },

    async listUnmatchedCaptures() {
      return [...unmatched.values()]
        .filter((row) => row.reconciliation_status !== 'RESOLVED')
        .map((row) => ({ ...row }));
    },

    // Conditional on the record still being unresolved, as the real adapter is.
    async resolveUnmatchedCapture({ id, status, resolvedPaymentId, note, actorId, at }) {
      const row = unmatched.get(id);
      if (!row || row.reconciliation_status === 'RESOLVED') return null;
      row.reconciliation_status = status;
      row.resolved_payment_id = resolvedPaymentId;
      row.resolution_note = note;
      row.updated_at = at;
      return { ...row };
    },
  };
}

// ---------------------------------------------------------------------------
// Gateway
// ---------------------------------------------------------------------------

export type FakeGateway = RazorpayGatewayClient & { calls: number };

export function createFakeGateway(
  options: { captured?: boolean; amountPaise?: number; orderId?: string; unreachable?: boolean } = {},
): FakeGateway {
  const state = { calls: 0 };
  return {
    get calls() {
      return state.calls;
    },
    async createOrder(input) {
      state.calls += 1;
      return {
        ok: true,
        order: {
          id: options.orderId ?? ORDER_ID,
          amount: input.amountPaise,
          currency: input.currency,
          status: 'created',
        },
      };
    },
    async fetchPayment(paymentId) {
      state.calls += 1;
      if (options.unreachable) return { ok: false, reason: 'gateway_unreachable' };
      return {
        ok: true,
        payment: {
          id: paymentId,
          order_id: options.orderId ?? ORDER_ID,
          amount: options.amountPaise ?? toPaise(AMOUNT_INR),
          currency: 'INR',
          status: options.captured === false ? 'authorized' : 'captured',
          captured: options.captured !== false,
        },
      };
    },
  };
}

/** A gateway that cannot be reached, so the service must fall back to the signature. */
export function createUnreachableGateway(): RazorpayGatewayClient {
  return {
    async createOrder() {
      return { ok: false, reason: 'gateway_unreachable' };
    },
    async fetchPayment() {
      return { ok: false, reason: 'gateway_unreachable' };
    },
  };
}

/**
 * A gateway that mints a NEW order id per call, so a retry after a failed
 * attempt can be modelled: the second order creation returns a different order.
 */
/** The order the gateway was last asked to mint, so the amount can be asserted. */
export interface RecordedOrder {
  amountPaise: number;
  currency: string;
  expiresInSeconds: number;
}

export type SequencedGateway = RazorpayGatewayClient & { calls: number; lastOrder: RecordedOrder | null };

export function createSequencedGateway(orderIds: string[]): SequencedGateway {
  const state: { calls: number; last: string; lastOrder: RecordedOrder | null } = {
    calls: 0,
    last: orderIds[0] ?? ORDER_ID,
    lastOrder: null,
  };
  return {
    get calls() {
      return state.calls;
    },
    get lastOrder() {
      return state.lastOrder;
    },
    async createOrder(input) {
      state.calls += 1;
      const next = orderIds[state.calls - 1] ?? state.last;
      state.last = next;
      state.lastOrder = { amountPaise: input.amountPaise, currency: input.currency, expiresInSeconds: input.expiresInSeconds };
      return { ok: true, order: { id: next, amount: input.amountPaise, currency: input.currency, status: 'created' } };
    },
    async fetchPayment(paymentId) {
      state.calls += 1;
      return {
        ok: true,
        payment: {
          id: paymentId,
          order_id: state.last,
          amount: toPaise(AMOUNT_INR),
          currency: 'INR',
          status: 'captured',
          captured: true,
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Webhook bodies
// ---------------------------------------------------------------------------

export interface WebhookBodyOptions {
  event?: string;
  paymentId?: string;
  orderId?: string;
  amount?: number;
  errorDescription?: string;
  /** Sets `event_id` on the envelope, as the real gateway sends it. */
  eventId?: string;
  /**
   * The payment's `created_at` (epoch seconds), which is the gateway's own
   * statement of when the money moved. Defaults to NOW so fixtures look like a
   * capture that happened just now.
   */
  createdAt?: Date;
  /** Extra envelope fields, so two deliveries of one event can differ byte-wise. */
  extra?: Record<string, unknown>;
}

/** Builds a raw webhook body shaped like the one Razorpay actually sends. */
export function webhookBody(options: WebhookBodyOptions = {}): string {
  const payment: Record<string, unknown> = {
    entity: 'payment',
    id: options.paymentId ?? 'pay_TEST123',
    order_id: options.orderId ?? ORDER_ID,
    amount: options.amount ?? toPaise(AMOUNT_INR),
    currency: 'INR',
    status: 'captured',
    captured: true,
    created_at: Math.floor((options.createdAt ?? NOW).getTime() / 1000),
  };
  if (options.errorDescription) {
    payment.error_code = 'BAD_CARD_ERROR';
    payment.error_description = options.errorDescription;
  }
  const envelope: Record<string, unknown> = {
    entity: 'event',
    event: options.event ?? 'payment.captured',
    account_id: 'acc_TEST',
    payload: { payment },
    ...(options.extra ?? {}),
  };
  if (options.eventId) envelope.event_id = options.eventId;
  return JSON.stringify(envelope);
}

/** Mirrors `parseRazorpayWebhookEvent`'s fallback id derivation. */
export function eventIdOf(body: string): string {
  const parsed = JSON.parse(body) as { event: string; event_id?: string; payload: { payment?: { id?: string } } };
  if (typeof parsed.event_id === 'string' && parsed.event_id) return parsed.event_id;
  return `${parsed.event}:${parsed.payload.payment?.id ?? 'unknown'}`;
}
