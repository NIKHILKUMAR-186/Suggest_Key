/**
 * Razorpay payment backend.
 *
 * The three public entry points mirror the three things a gateway integration
 * needs, and nothing else:
 *
 *   - `runCreateRazorpayOrder`  — a seeker asks to pay for a booking.
 *   - `runVerifyRazorpayPayment` — the browser reports a payment it just made.
 *   - `runRazorpayWebhook`       — Razorpay pushes an authoritative event.
 *
 * Two rules shape everything below:
 *
 *   1. THE AMOUNT IS ALWAYS SERVER-DERIVED. It comes from
 *      `bookings.amount_inr`, the snapshot taken when the booking was created.
 *      No amount, currency, status, user id or booking id sent by the browser
 *      is ever trusted; they are only used to LOOK UP the real rows.
 *
 *   2. EVERY WRITE IS A CONDITIONAL UPDATE. Each state change is scoped to the
 *      status it is allowed to move FROM, so a webhook, the browser, and a
 *      retried webhook racing each other can each perform the transition at
 *      most once. The row that wins the race is the one that sends the mentor
 *      notification, which is what makes duplicate notification impossible
 *      without a separate de-duplication table.
 *
 * State machine (booking):  PAYMENT_PENDING -> MENTOR_PENDING
 * State machine (payment):  PAYMENT_PROCESSING -> VERIFIED | FAILED
 *
 * Two off-ramps hang off that, and both exist because the gateway is
 * asynchronous and the booking can die while money is in flight:
 *
 *   - A FAILED attempt is re-armed for a retry rather than left to block the
 *     booking forever (`payments` is UNIQUE(booking_id), so the retry reuses
 *     the row). See `runCreateRazorpayOrder`.
 *   - A capture that arrives after the booking was cancelled is recorded as a
 *     REFUND-OWED state instead of a successful payment. See
 *     `applyCapturedPayment`.
 *
 * The booking deliberately does NOT move to `PAYMENT_PROCESSING`: the
 * hold-expiry cron only cancels `PAYMENT_PENDING` bookings, so parking an
 * unpaid order in `PAYMENT_PROCESSING` would strand a booking whose 15-minute
 * hold has elapsed. The booking therefore stays `PAYMENT_PENDING` until money
 * is actually captured, at which point it advances straight to the
 * `MENTOR_PENDING` the existing mentor confirmation flow already expects.
 */

import {
  RAZORPAY_CURRENCY,
  RAZORPAY_GATEWAY,
  RAZORPAY_ORDER_EXPIRY_SECONDS,
  RAZORPAY_WEBHOOK_EVENTS,
  getRazorpayApiBase,
  getRazorpayKeyId,
  getRazorpayKeySecret,
  getRazorpayWebhookSecret,
  isRazorpayConfigured,
  isRazorpayEnabled,
} from './razorpayConfig';
import {
  verifyPaymentSignature,
  verifyWebhookSignature,
} from './razorpaySignature';
import { isPayableBookingStatus } from './paymentProof';
import { logSanitizer } from './logSanitizer';

// ---------------------------------------------------------------------------
// Gateway HTTP client
// ---------------------------------------------------------------------------

export interface RazorpayOrderResult {
  id: string;
  /** Minor units (paise), as returned by the gateway. */
  amount: number;
  currency: string;
  status: string;
}

export interface RazorpayPaymentResult {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string;
  captured: boolean;
  method?: string;
  error_code?: string | null;
  error_description?: string | null;
}

/**
 * Everything this module needs from Razorpay itself, so tests can substitute a
 * deterministic double instead of reaching the network.
 */
export interface RazorpayGatewayClient {
  createOrder(input: { amountPaise: number; currency: string; receipt: string; notes: Record<string, string>; expiresInSeconds: number }):
    Promise<{ ok: true; order: RazorpayOrderResult } | { ok: false; reason: string }>;
  fetchPayment(paymentId: string):
    Promise<{ ok: true; payment: RazorpayPaymentResult } | { ok: false; reason: string }>;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Real HTTP client. `fetchImpl` is injectable purely for tests. */
export function createRazorpayGatewayClient(options: { fetchImpl?: FetchLike } = {}): RazorpayGatewayClient {
  const doFetch: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const base = getRazorpayApiBase();

  const basicAuth = (): string =>
    `Basic ${Buffer.from(`${getRazorpayKeyId()}:${getRazorpayKeySecret()}`).toString('base64')}`;

  const request = async <T>(path: string, init: RequestInit): Promise<{ ok: true; data: T } | { ok: false; reason: string }> => {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', Authorization: basicAuth(), ...(init.headers ?? {}) },
      });
    } catch (networkErr) {
      // Never surface the raw transport error: it can contain the request URL,
      // which embeds the key id.
      return { ok: false, reason: 'gateway_unreachable' };
    }
    if (!res.ok) return { ok: false, reason: `gateway_status_${res.status}` };
    try {
      return { ok: true, data: (await res.json()) as T };
    } catch {
      return { ok: false, reason: 'gateway_bad_response' };
    }
  };

  return {
    async createOrder(input) {
      const result = await request<RazorpayOrderResult>('/orders', {
        method: 'POST',
        body: JSON.stringify({
          amount: input.amountPaise,
          currency: input.currency,
          receipt: input.receipt,
          notes: input.notes,
          payment_capture: 1,
        }),
      });
      if (!result.ok) return result;
      if (typeof result.data?.id !== 'string' || !result.data.id) {
        return { ok: false, reason: 'gateway_bad_response' };
      }
      return { ok: true, order: result.data };
    },

    async fetchPayment(paymentId) {
      const result = await request<Record<string, unknown>>(`/payments/${encodeURIComponent(paymentId)}`, {
        method: 'GET',
      });
      if (!result.ok) return result;
      const raw = result.data ?? {};
      return {
        ok: true,
        payment: {
          id: String(raw.id ?? ''),
          order_id: String(raw.order_id ?? ''),
          amount: Number(raw.amount ?? 0),
          currency: String(raw.currency ?? ''),
          status: String(raw.status ?? ''),
          captured: raw.captured === true,
          method: typeof raw.method === 'string' ? raw.method : undefined,
          error_code: typeof raw.error_code === 'string' ? raw.error_code : null,
          error_description: typeof raw.error_description === 'string' ? raw.error_description : null,
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Storage port
// ---------------------------------------------------------------------------

export interface RazorpayBookingRow {
  id: string;
  booking_code: string;
  seeker_id: string;
  mentor_id: string;
  amount_inr: number;
  status: string;
  start_time: string;
  hold_id: string | null;
}

export interface RazorpayPaymentRow {
  id: string;
  booking_id: string;
  seeker_id: string;
  amount_inr: number;
  status: string;
  gateway: string | null;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  razorpay_signature: string | null;
  captured_at: string | null;
  failure_reason: string | null;
  refund_id: string | null;
  refund_status: string | null;
}

export interface RazorpayHoldRow {
  id: string;
  status: string;
  expires_at: string;
}

export interface PaymentEventInput {
  paymentId: string;
  status: string;
  eventType: string;
  gateway: string | null;
  gatewayPaymentId: string | null;
  amountInr: number | null;
  reason: string | null;
  actorId: string | null;
  at: string;
}

/**
 * Outcome of claiming a gateway event. See `RazorpayStore.claimWebhookEvent`
 * for why `resume` must be distinguished from `duplicate`.
 */
export type WebhookClaim = 'new' | 'duplicate' | 'resume';

/**
 * Machine-readable reasons an exception record can carry.
 *
 * Kept as a narrow union so a new reason is a deliberate code change rather
 * than a free-text value that no caller can exhaustively handle.
 */
export type UnmatchedCaptureReason =
  /** No local `payments` row matched the captured gateway payment. */
  | 'PAYMENT_ROW_NOT_FOUND';

/** Lifecycle of one recorded exception. Never overlaps the payment state machine. */
export type UnmatchedReconciliationStatus = 'PENDING' | 'RESOLVED' | 'CONFLICT';

/**
 * One captured gateway payment that has no local confirmed payment.
 *
 * This is an EXCEPTION record, never a payment. It is never `VERIFIED`, never
 * implies a booking was paid, and is never refundable by itself - it only tells
 * an operator that money moved and where to look.
 */
export interface UnmatchedCaptureRow {
  id: string;
  gateway: string;
  event_id: string;
  last_event_id: string | null;
  event_type: string;
  razorpay_payment_id: string;
  razorpay_order_id: string | null;
  amount_paise: number | null;
  currency: string | null;
  received_at: string;
  reason: UnmatchedCaptureReason;
  reconciliation_status: UnmatchedReconciliationStatus;
  delivery_count: number;
  /** Most recent delivery instant absorbed for this capture. */
  last_received_at: string | null;
  resolved_payment_id: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface UnmatchedCaptureInput {
  eventId: string;
  eventType: string;
  gatewayPaymentId: string;
  gatewayOrderId: string | null;
  /** Already range-checked, or null when the event carried no usable amount. */
  amountPaise: number | null;
  currency: string | null;
  receivedAt: string;
  reason: UnmatchedCaptureReason;
  /** The original webhook payload, retained for later reconciliation. */
  payload: unknown;
}

/** Result of recording an exception, including whether this was a first write. */
export interface UnmatchedCaptureWriteResult {
  row: UnmatchedCaptureRow;
  /** False when an existing record was updated rather than inserted. */
  created: boolean;
}

/**
 * Why a delivery could not be attributed to a local payment, reported to the
 * route so it can answer with a retryable status instead of 200.
 */
export type UnmatchedCaptureSignal =
  | {
      /** True when a durable exception row now exists for this capture. */
      recorded: true;
      reason: UnmatchedCaptureReason;
      gatewayPaymentId: string | null;
      unmatchedCaptureId: string;
      deliveryCount: number;
      created: boolean;
      detail: string;
    }
  | {
      recorded: false;
      reason: 'MISSING_PAYMENT_ID';
      gatewayPaymentId: null;
      detail: string;
    };

/**
 * The narrow slice of persistence the Razorpay flows need.
 *
 * Every mutating method returns whether it actually changed a row, so the
 * caller can treat "false" as "someone else already did this" and skip the
 * side effects (chiefly the mentor notification) rather than duplicating them.
 */
export interface RazorpayStore {
  getBooking(bookingId: string): Promise<RazorpayBookingRow | null>;
  getHold(holdId: string): Promise<RazorpayHoldRow | null>;
  getPaymentById(paymentId: string): Promise<RazorpayPaymentRow | null>;
  getPaymentByBookingId(bookingId: string): Promise<RazorpayPaymentRow | null>;
  getPaymentByOrderId(orderId: string): Promise<RazorpayPaymentRow | null>;
  getPaymentByGatewayPaymentId(gatewayPaymentId: string): Promise<RazorpayPaymentRow | null>;

  /** Creates the in-flight gateway order for a booking. */
  attachGatewayOrder(input: {
    bookingId: string;
    seekerId: string;
    amountInr: number;
    orderId: string;
    at: string;
  }): Promise<RazorpayPaymentRow | null>;

  /**
   * Conditional FAILED -> PAYMENT_PROCESSING re-arm, for a retry attempt.
   * Returns the row when it won.
   *
   * `payments` is UNIQUE(booking_id), so a retry has to re-use the failed row
   * rather than insert a second one. Scoped to a FAILED RAZORPAY row, so it can
   * never re-arm a manual payment or an attempt that is still in flight.
   */
  rearmFailedGatewayPayment(input: {
    paymentId: string;
    orderId: string;
    at: string;
  }): Promise<RazorpayPaymentRow | null>;

  /**
   * Conditional in-flight -> refund-owed, for a capture that arrived after the
   * booking was cancelled (or deleted). Returns the row when it won.
   *
   * The row is deliberately NOT confirmed: `status` stays out of VERIFIED, the
   * gateway payment id is recorded so the money is traceable, and
   * `refund_status = 'PENDING'` marks that a refund is owed and has not been
   * issued. No refund is issued automatically - there is no outbound refund call
   * in this integration - so this is a recoverable state for an operator, not a
   * silent success.
   */
  markPaymentRefundPending(input: {
    paymentId: string;
    gatewayPaymentId: string;
    reason: string;
    at: string;
  }): Promise<RazorpayPaymentRow | null>;

  /** Conditional PAYMENT_PROCESSING -> VERIFIED. Returns the row when it won. */
  markPaymentCaptured(input: {
    paymentId: string;
    gatewayPaymentId: string;
    signature: string | null;
    capturedAt: string;
    payload: Record<string, unknown> | null;
  }): Promise<RazorpayPaymentRow | null>;

  /** Records a capture when the row is already VERIFIED, to stay idempotent. */
  markPaymentAlreadyCaptured(input: {
    paymentId: string;
    gatewayPaymentId: string;
    capturedAt: string;
  }): Promise<RazorpayPaymentRow | null>;
  /** Conditional gateway payment -> FAILED. Returns the row when it won. */
  markPaymentFailed(input: {
    paymentId: string;
    reason: string;
    at: string;
  }): Promise<RazorpayPaymentRow | null>;

  /** Conditional booking PAYMENT_PENDING|PAYMENT_PROCESSING -> MENTOR_PENDING. */
  markBookingMentorPending(bookingId: string, at: string): Promise<boolean>;

  /** Conditional refund bookkeeping. Returns true when it applied. */
  recordRefund(input: {
    paymentId: string;
    refundId: string;
    refundStatus: 'PENDING' | 'REFUNDED' | 'FAILED';
    at: string;
  }): Promise<boolean>;

  insertPaymentEvent(event: PaymentEventInput): Promise<void>;

  /**
   * Claims a gateway event for processing.
   *
   * Three outcomes, and the distinction between the last two is what stops a
   * transient failure from losing a real payment:
   *   - `new`      : first delivery; process it.
   *   - `duplicate`: already applied and completed; skip it.
   *   - `resume`   : a previous attempt failed part-way. Safe to re-apply,
   *                  because every write in these flows is a conditional update
   *                  and therefore a no-op the second time.
   */
  claimWebhookEvent(input: { eventId: string; eventType: string; payload: unknown; at: string }): Promise<WebhookClaim>;
  completeWebhookEvent(eventId: string, at: string): Promise<void>;

  // ---------------------------------------------------------------------
  // Unmatched-capture ledger (audit P0-1)
  //
  // Separate from `payments` on purpose. These methods exist so a captured
  // gateway payment that has no local row becomes durable and reconcilable
  // instead of being discarded. They never create, confirm or advance a
  // payment; `recordUnmatchedCapture` writes an exception row only.
  // ---------------------------------------------------------------------

  /**
   * Idempotently records a captured gateway payment that matched no local row.
   *
   * Identity is `(gateway, razorpay_payment_id)`, not the event id, so a
   * redelivery OR a different event id describing the same capture collapses
   * onto one financial record. Returns `created: false` when an existing record
   * was updated.
   *
   * Throws when the record cannot be persisted or read back, so a capture that
   * could not be made durable is never reported as recorded.
   */
  recordUnmatchedCapture(input: UnmatchedCaptureInput): Promise<UnmatchedCaptureWriteResult>;

  getUnmatchedCaptureById(id: string): Promise<UnmatchedCaptureRow | null>;

  getUnmatchedCaptureByGatewayPaymentId(gatewayPaymentId: string): Promise<UnmatchedCaptureRow | null>;

  /** The operator queue. Only non-resolved records are returned. */
  listUnmatchedCaptures(input: { limit: number }): Promise<UnmatchedCaptureRow[]>;

  /**
   * Conditional resolution, scoped to the record still being unresolved.
   *
   * Returns false when another operator already resolved or flagged it, which is
   * what makes a double reconciliation a no-op rather than a second attach.
   */
  resolveUnmatchedCapture(input: {
    id: string;
    status: 'RESOLVED' | 'CONFLICT';
    resolvedPaymentId: string | null;
    note: string;
    actorId: string | null;
    at: string;
  }): Promise<UnmatchedCaptureRow | null>;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export interface RazorpayFailure {
  httpStatus: number;
  code: string;
  message: string;
}

export type RazorpayOutcome<T> = { ok: true; value: T } | { ok: false; error: RazorpayFailure };

const fail = (httpStatus: number, code: string, message: string): RazorpayFailure => ({ httpStatus, code, message });

/**
 * The single gate every Razorpay endpoint passes through before doing any work.
 *
 * Two distinct conditions are reported differently on purpose: "you have not
 * turned this on yet" is an expected state during the manual-only period, while
 * "you turned it on but the secrets are missing" is a deployment mistake an
 * operator has to fix. Neither is allowed to reach the manual payment flow.
 */
export function assertRazorpayUsable(): RazorpayFailure | null {
  if (!isRazorpayEnabled()) {
    return fail(503, 'RAZORPAY_DISABLED', 'Online payment is not available right now. Please use the payment details provided.');
  }
  if (!isRazorpayConfigured()) {
    return fail(503, 'RAZORPAY_NOT_CONFIGURED', 'Online payment is temporarily unavailable. Please use the payment details provided.');
  }
  return null;
}

/** Rupees -> paise. The gateway works in the minor unit; the database does not. */
export function toPaise(amountInr: number): number {
  return Math.round(amountInr * 100);
}

const isPositiveAmount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * Confirms the hold behind a booking has not elapsed.
 *
 * The hold is what reserves the slot, so paying for an expired hold would let
 * two seekers pay for the same slot while only one of them keeps it. A booking
 * with no hold (created by a path that does not use one) is not blocked.
 */
async function assertHoldStillValid(store: RazorpayStore, booking: RazorpayBookingRow, nowMs: number): Promise<RazorpayFailure | null> {
  if (!booking.hold_id) return null;
  const hold = await store.getHold(booking.hold_id);
  if (!hold) return null;

  if (hold.status !== 'ACTIVE' && hold.status !== 'CONVERTED') {
    return fail(409, 'HOLD_EXPIRED', 'Your payment window for this slot has expired. Please book the slot again.');
  }
  if (Number.isFinite(new Date(hold.expires_at).getTime()) && new Date(hold.expires_at).getTime() <= nowMs) {
    return fail(409, 'HOLD_EXPIRED', 'Your payment window for this slot has expired. Please book the slot again.');
  }
  return null;
}

// ---------------------------------------------------------------------------
// 1. Create order
// ---------------------------------------------------------------------------

export interface CreateRazorpayOrderInput {
  bookingId: string;
  callerId: string;
  gateway: RazorpayGatewayClient;
  store: RazorpayStore;
  now?: Date;
}

export interface CreateRazorpayOrderValue {
  razorpayOrderId: string;
  razorpayKeyId: string;
  amountInr: number;
  currency: string;
  paymentId: string;
  /** Echoed back so the caller never has to trust its own path parameter. */
  bookingId: string;
  alreadyCreated: boolean;
}

/**
 * Creates (or returns) a Razorpay order for a booking the caller owns.
 *
 * Order of checks matters: existence before ownership, so a bogus booking id
 * cannot be distinguished from somebody else's booking by a caller, then
 * payability, then slot/hold validity, and only then is the amount derived.
 */
export async function runCreateRazorpayOrder(input: CreateRazorpayOrderInput): Promise<RazorpayOutcome<CreateRazorpayOrderValue>> {
  const gate = assertRazorpayUsable();
  if (gate) return { ok: false, error: gate };

  const now = input.now ?? new Date();
  const nowIso = now.toISOString();

  const booking = await input.store.getBooking(input.bookingId);
  if (!booking) return { ok: false, error: fail(404, 'BOOKING_NOT_FOUND', 'Booking not found.') };

  if (booking.seeker_id !== input.callerId) {
    return { ok: false, error: fail(403, 'FORBIDDEN_NOT_BOOKING_OWNER', 'You are not authorized to pay for this booking.') };
  }

  if (!isPayableBookingStatus(booking.status)) {
    return {
      ok: false,
      error: fail(409, 'BOOKING_NOT_PAYABLE', `This booking is ${booking.status.replace(/_/g, ' ').toLowerCase()} and no longer accepts payment.`),
    };
  }

  // The session must not already be under way; a booking that is payable but
  // past its start time can only be a stale row, and paying for it is never
  // meaningful.
  if (Number.isFinite(new Date(booking.start_time).getTime()) && new Date(booking.start_time).getTime() <= now.getTime()) {
    return { ok: false, error: fail(409, 'SLOT_ALREADY_STARTED', 'This session has already started and can no longer be paid for.') };
  }

  const holdFailure = await assertHoldStillValid(input.store, booking, now.getTime());
  if (holdFailure) return { ok: false, error: holdFailure };

  // Server-derived. Never the body, never a query parameter.
  if (!isPositiveAmount(booking.amount_inr)) {
    return { ok: false, error: fail(409, 'AMOUNT_UNAVAILABLE', 'This booking does not have a payable amount.') };
  }
  const amountPaise = toPaise(booking.amount_inr);

  const existing = await input.store.getPaymentByBookingId(booking.id);

  // The ONE case in which an existing payment row does not end the attempt: a
  // Razorpay attempt that FAILED. `payments` is UNIQUE(booking_id), so the retry
  // re-arms that same row further down instead of inserting a second one. The
  // failed attempt itself is not lost - it stays in `payment_events` - and
  // because the re-arm clears `razorpay_order_id`/`razorpay_payment_id`, the old
  // attempt can never be mistaken for the new one.
  //
  // `refund_status === null` is a deliberate second condition: a row parked with
  // a refund owed holds money already taken, and re-arming it would erase that
  // marker. Such a row only exists for a closed booking, which is refused above,
  // but the guard keeps it true even if that ordering ever changes.
  const retryOf =
    existing && existing.gateway === RAZORPAY_GATEWAY && existing.status === 'FAILED' && existing.refund_status === null
      ? existing
      : null;

  if (existing && !retryOf) {
    if (existing.status === 'VERIFIED') {
      return { ok: false, error: fail(409, 'PAYMENT_ALREADY_COMPLETED', 'This booking has already been paid.') };
    }
    // An in-flight order is returned as-is so a double-tap, a refresh, or a
    // retried request cannot mint a second order for the same booking.
    if (existing.gateway === RAZORPAY_GATEWAY && existing.razorpay_order_id && existing.status === 'PAYMENT_PROCESSING') {
      return {
        ok: true,
        value: {
          razorpayOrderId: existing.razorpay_order_id,
          razorpayKeyId: getRazorpayKeyId(),
          amountInr: existing.amount_inr,
          currency: RAZORPAY_CURRENCY,
          paymentId: existing.id,
          bookingId: booking.id,
          alreadyCreated: true,
        },
      };
    }
    // A manual proof is mid-review on this booking. Leave it alone rather than
    // racing the admin queue with a gateway order.
    return {
      ok: false,
      error: fail(409, 'PAYMENT_ALREADY_IN_PROGRESS', 'A payment for this booking is already being processed.'),
    };
  }

  const created = await input.gateway.createOrder({
    amountPaise,
    currency: RAZORPAY_CURRENCY,
    receipt: `booking_${booking.booking_code}`,
    notes: { booking_id: booking.id, seeker_id: booking.seeker_id, mentor_id: booking.mentor_id },
    expiresInSeconds: RAZORPAY_ORDER_EXPIRY_SECONDS,
  });

  if (!created.ok) {
    // Only the coarse reason is logged; it never contains a key or a secret.
    console.error('Razorpay order creation failed:', created.reason);
    return { ok: false, error: fail(502, 'RAZORPAY_ORDER_FAILED', 'We could not start the payment. Please try again.') };
  }

  const payment = retryOf
    ? await input.store.rearmFailedGatewayPayment({ paymentId: retryOf.id, orderId: created.order.id, at: nowIso })
    : await input.store.attachGatewayOrder({
        bookingId: booking.id,
        seekerId: booking.seeker_id,
        amountInr: booking.amount_inr,
        orderId: created.order.id,
        at: nowIso,
      });

  if (!payment) {
    // `attachGatewayOrder` reports null only on a unique violation, and
    // `rearmFailedGatewayPayment` only when the row is no longer FAILED: both
    // mean another request (or a manual proof) got there first. That is a
    // conflict, not a server fault. The freshly minted order is left unused and
    // expires on its own, which is cheaper than refunding it.
    return {
      ok: false,
      error: fail(409, 'PAYMENT_ALREADY_IN_PROGRESS', 'A payment for this booking is already being processed.'),
    };
  }

  await input.store.insertPaymentEvent({
    paymentId: payment.id,
    status: 'PAYMENT_PROCESSING',
    // A retry is recorded distinctly, so the audit trail shows that this order
    // followed a failed attempt rather than being the first one.
    eventType: retryOf ? 'GATEWAY_ORDER_RETRIED' : 'GATEWAY_ORDER_CREATED',
    gateway: RAZORPAY_GATEWAY,
    gatewayPaymentId: created.order.id,
    amountInr: booking.amount_inr,
    reason: retryOf ? 'Retried after an earlier failed payment attempt.' : null,
    actorId: input.callerId,
    at: nowIso,
  });

  return {
    ok: true,
    value: {
      razorpayOrderId: created.order.id,
      razorpayKeyId: getRazorpayKeyId(),
      amountInr: booking.amount_inr,
      currency: RAZORPAY_CURRENCY,
      paymentId: payment.id,
      bookingId: booking.id,
      alreadyCreated: false,
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Verify payment
// ---------------------------------------------------------------------------

export interface VerifyRazorpayPaymentInput {
  bookingId: string;
  callerId: string;
  razorpayOrderId: unknown;
  razorpayPaymentId: unknown;
  razorpaySignature: unknown;
  gateway: RazorpayGatewayClient;
  store: RazorpayStore;
  now?: Date;
}

export interface VerifyRazorpayPaymentValue {
  paymentId: string;
  bookingId: string;
  bookingStatus: string;
  paymentStatus: string;
  mentorNotified: boolean;
  /** True when this call had already been processed (duplicate submission). */
  duplicate: boolean;
}

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

/**
 * A booking that can never become a paid booking again, so a capture against
 * it is money owed back rather than money earned.
 *
 * Deliberately narrow. `MENTOR_PENDING`/`CONFIRMED`/`COMPLETED` are NOT dead
 * ends: a capture that arrives when the booking is already in one of those is
 * a duplicate of a capture that was already applied, and that must keep taking
 * the existing idempotent path. Only a booking that has been cancelled or
 * rejected (or has vanished) can never advance, so it is the only case where
 * confirming the payment would record money as a successful booking payment
 * that no one will ever deliver.
 */
function isBookingPaymentDeadEnd(status: string | null): boolean {
  if (status === null) return true;
  return status === 'CANCELLED' || status === 'REJECTED';
}

/**
 * The capture was real, but the booking it paid for is gone. Recorded as a
 * refund-owed state rather than a success, because there is no outbound refund
 * call in this integration and inventing refund policy is out of scope.
 */
export interface RecoveredCapture {
  outcome: 'refund_pending';
  bookingId: string;
  paymentId: string;
  gatewayPaymentId: string;
  reason: string;
}

export type ApplyCaptureOutcome =
  | { outcome: 'captured'; mentorNotified: boolean; duplicate: boolean }
  | RecoveredCapture;

/**
 * Records a capture against a dead booking in a recoverable state.
 *
 * The payment row keeps the gateway payment id (so the money is traceable to a
 * Razorpay payment), stays out of VERIFIED, and is marked `refund_status =
 * 'PENDING'`: a refund is owed and has not been issued. `captured_at` is
 * deliberately left unset, because the payment was never confirmed - the real
 * capture time is on the payment event below.
 */
async function recoverCaptureAgainstDeadBooking(
  store: RazorpayStore,
  payment: RazorpayPaymentRow,
  args: { gatewayPaymentId: string; capturedAt: string },
  bookingStatus: string | null,
): Promise<RecoveredCapture> {
  const reason = bookingStatus
    ? `Payment ${args.gatewayPaymentId} was captured after the booking was ${bookingStatus}; a refund is owed.`
    : `Payment ${args.gatewayPaymentId} was captured after the booking no longer exists; a refund is owed.`;

  const marked = await store.markPaymentRefundPending({
    paymentId: payment.id,
    gatewayPaymentId: args.gatewayPaymentId,
    reason,
    at: args.capturedAt,
  });

  if (marked) {
    await store.insertPaymentEvent({
      paymentId: payment.id,
      status: 'FAILED',
      eventType: 'CAPTURE_AFTER_BOOKING_CLOSED',
      gateway: RAZORPAY_GATEWAY,
      gatewayPaymentId: args.gatewayPaymentId,
      amountInr: payment.amount_inr,
      reason,
      actorId: null,
      at: args.capturedAt,
    });
  }

  // Reported even when the conditional write lost: the outcome is the same and
  // the caller must never treat this capture as a successful booking payment.
  return {
    outcome: 'refund_pending',
    bookingId: payment.booking_id,
    paymentId: payment.id,
    gatewayPaymentId: args.gatewayPaymentId,
    reason,
  };
}

/**
 * Applies a captured payment to a booking.
 *
 * Shared by the browser verification and the `payment.captured` webhook so both
 * produce the same end state, and so whichever arrives first is the one that
 * performs the transition and notifies the mentor.
 *
 * The signature is re-verified here in both cases: the browser path against the
 * key secret, the webhook path against the webhook secret. The gateway
 * signature is the only thing that proves the money moved.
 *
 * The booking is re-read before anything is confirmed. A capture that arrives
 * after `expire_stale_holds()` cancelled the booking would otherwise be recorded
 * as a successful payment on a booking nobody will ever deliver, with no
 * notification and no refund - so it is diverted into a refund-owed state
 * instead.
 */
async function applyCapturedPayment(
  store: RazorpayStore,
  payment: RazorpayPaymentRow,
  args: { gatewayPaymentId: string; signature: string | null; capturedAt: string; payload: Record<string, unknown> | null },
): Promise<ApplyCaptureOutcome> {
  if (payment.razorpay_payment_id && payment.razorpay_payment_id !== args.gatewayPaymentId) {
    // Two different gateway payments claiming one booking is a conflict that
    // must never be resolved by picking a winner.
    throw new RazorpayConflictError('This booking already has a different payment recorded against it.');
  }

  // The money is real, so a dead booking changes where it is recorded, not
  // whether it is acknowledged. A payment already parked in the refund-owed
  // state is answered from here too, which is what keeps a redelivered capture
  // from being re-processed (or re-thrown) forever.
  const booking = await store.getBooking(payment.booking_id);
  if (isBookingPaymentDeadEnd(booking?.status ?? null)) {
    return recoverCaptureAgainstDeadBooking(store, payment, args, booking?.status ?? null);
  }

  // The conditional update is the concurrency gate: only the first caller to
  // find the row in PAYMENT_PROCESSING performs the capture.
  const newlyCaptured = await store.markPaymentCaptured({
    paymentId: payment.id,
    gatewayPaymentId: args.gatewayPaymentId,
    signature: args.signature,
    capturedAt: args.capturedAt,
    payload: args.payload,
  });

  if (newlyCaptured) {
    await store.insertPaymentEvent({
      paymentId: payment.id,
      status: 'VERIFIED',
      eventType: 'PAYMENT_CAPTURED',
      gateway: RAZORPAY_GATEWAY,
      gatewayPaymentId: args.gatewayPaymentId,
      amountInr: newlyCaptured.amount_inr,
      reason: null,
      actorId: null,
      at: args.capturedAt,
    });

    // The booking transition is the de-duplication gate for the mentor
    // notification: exactly one caller can move it to MENTOR_PENDING.
    const mentorNotified = await store.markBookingMentorPending(newlyCaptured.booking_id, args.capturedAt);
    return { outcome: 'captured', mentorNotified, duplicate: false };
  }

  // We lost the race. Re-read to tell a benign duplicate apart from a genuine
  // state conflict: a payment that is already VERIFIED for THIS gateway payment
  // is simply the other caller having got there first, and a payment already
  // parked in the refund-owed state is this same dead-booking outcome arriving
  // again. Anything else (a FAILED or REFUNDED row) must never be resurrected by
  // a late capture.
  const current = await store.getPaymentById(payment.id);
  if (!current) {
    throw new RazorpayConflictError('This payment is no longer in a state that can be confirmed.');
  }
  if (current.status !== 'VERIFIED') {
    if (current.status === 'FAILED' && current.refund_status === 'PENDING' && current.razorpay_payment_id === args.gatewayPaymentId) {
      // Already recorded as a refund-owed capture against a dead booking.
      return {
        outcome: 'refund_pending',
        bookingId: current.booking_id,
        paymentId: current.id,
        gatewayPaymentId: args.gatewayPaymentId,
        reason: String(current.failure_reason ?? 'A refund is owed for this payment.'),
      };
    }
    throw new RazorpayConflictError('This payment is no longer in a state that can be confirmed.');
  }
  if (current.razorpay_payment_id && current.razorpay_payment_id !== args.gatewayPaymentId) {
    throw new RazorpayConflictError('This booking already has a different payment recorded against it.');
  }

  // Backfill the gateway id if the winning write was interrupted before it
  // landed, so a later replay is recognised as the same payment.
  if (!current.razorpay_payment_id) {
    await store.markPaymentAlreadyCaptured({
      paymentId: payment.id,
      gatewayPaymentId: args.gatewayPaymentId,
      capturedAt: args.capturedAt,
    });
  }

  // Still attempted: the winning caller may have crashed between capturing the
  // payment and advancing the booking, and this is what rescues the booking.
  const mentorNotified = await store.markBookingMentorPending(current.booking_id, args.capturedAt);
  return { outcome: 'captured', mentorNotified, duplicate: true };
}

export class RazorpayConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RazorpayConflictError';
  }
}

export async function runVerifyRazorpayPayment(input: VerifyRazorpayPaymentInput): Promise<RazorpayOutcome<VerifyRazorpayPaymentValue>> {
  const gate = assertRazorpayUsable();
  if (gate) return { ok: false, error: gate };

  const orderId = asNonEmptyString(input.razorpayOrderId);
  const paymentId = asNonEmptyString(input.razorpayPaymentId);
  const signature = asNonEmptyString(input.razorpaySignature);

  if (!orderId || !paymentId || !signature) {
    return { ok: false, error: fail(400, 'VALIDATION_ERROR', 'The payment details sent were incomplete.') };
  }

  const booking = await input.store.getBooking(input.bookingId);
  if (!booking) return { ok: false, error: fail(404, 'BOOKING_NOT_FOUND', 'Booking not found.') };

  if (booking.seeker_id !== input.callerId) {
    return { ok: false, error: fail(403, 'FORBIDDEN_NOT_BOOKING_OWNER', 'You are not authorized to pay for this booking.') };
  }

  const payment = await input.store.getPaymentByBookingId(booking.id);
  if (!payment) return { ok: false, error: fail(404, 'PAYMENT_NOT_FOUND', 'No payment has been started for this booking.') };
  if (payment.gateway !== RAZORPAY_GATEWAY) {
    return { ok: false, error: fail(409, 'PAYMENT_NOT_GATEWAY', 'This booking is not being paid through online payment.') };
  }

  // The stored order must be the one being claimed. This is what stops a
  // signature harvested from a cheap booking being replayed onto an expensive one.
  if (!payment.razorpay_order_id || payment.razorpay_order_id !== orderId) {
    return { ok: false, error: fail(409, 'RAZORPAY_ORDER_MISMATCH', 'This payment does not match the order created for this booking.') };
  }

  // MANDATORY: the signature is checked before anything is written. A browser
  // saying "the payment succeeded" is not evidence that money moved.
  if (!verifyPaymentSignature({ orderId, paymentId, signature })) {
    return { ok: false, error: fail(400, 'RAZORPAY_SIGNATURE_INVALID', 'We could not verify this payment. Please try again.') };
  }

  const now = input.now ?? new Date();
  const nowIso = now.toISOString();

  // Best-effort cross-check against the gateway. The signature already proved
  // the payment id belongs to this order, so a gateway hiccup must not fail an
  // otherwise-valid payment - but when the call succeeds, amount and currency
  // are compared against the server-derived values rather than the client's.
  let gatewayPayload: Record<string, unknown> | null = null;
  const fetched = await input.gateway.fetchPayment(paymentId);
  if (fetched.ok) {
    const expectedPaise = toPaise(payment.amount_inr);
    if (fetched.payment.amount !== expectedPaise || fetched.payment.currency?.toUpperCase() !== RAZORPAY_CURRENCY) {
      await recordCaptureMismatch(input.store, payment, fetched.payment, nowIso);
      return { ok: false, error: fail(409, 'RAZORPAY_AMOUNT_MISMATCH', 'The payment amount does not match this booking.') };
    }
    if (!fetched.payment.captured && fetched.payment.status !== 'captured') {
      await input.store.insertPaymentEvent({
        paymentId: payment.id,
        status: payment.status,
        eventType: 'PAYMENT_NOT_CAPTURED',
        gateway: RAZORPAY_GATEWAY,
        gatewayPaymentId: paymentId,
        amountInr: payment.amount_inr,
        reason: fetched.payment.error_description ?? 'Payment is authorized but not captured.',
        actorId: input.callerId,
        at: nowIso,
      });
      return { ok: false, error: fail(409, 'PAYMENT_NOT_CAPTURED', 'This payment is not complete yet.') };
    }
    gatewayPayload = fetched.payment as unknown as Record<string, unknown>;
  }

  try {
    const outcome = await applyCapturedPayment(input.store, payment, {
      gatewayPaymentId: paymentId,
      signature,
      capturedAt: nowIso,
      payload: gatewayPayload,
    });

    if (outcome.outcome === 'refund_pending') {
      // The money is real but the booking is gone, so this is NOT a success:
      // the seeker is told their payment is being refunded, and the route
      // notifies nobody. The recovery state and its event are already recorded.
      return {
        ok: false,
        error: fail(409, 'BOOKING_CLOSED_REFUND_PENDING', 'This booking is no longer active, so your payment is being refunded.'),
      };
    }

    return {
      ok: true,
      value: {
        paymentId: payment.id,
        bookingId: payment.booking_id,
        bookingStatus: 'MENTOR_PENDING',
        paymentStatus: 'VERIFIED',
        mentorNotified: outcome.mentorNotified,
        duplicate: outcome.duplicate,
      },
    };
  } catch (err) {
    if (err instanceof RazorpayConflictError) {
      return { ok: false, error: fail(409, 'PAYMENT_STATE_CONFLICT', err.message) };
    }
    throw err;
  }
}

async function recordCaptureMismatch(
  store: RazorpayStore,
  payment: RazorpayPaymentRow,
  gatewayPayment: RazorpayPaymentResult,
  at: string,
): Promise<void> {
  await store.insertPaymentEvent({
    paymentId: payment.id,
    status: payment.status,
    eventType: 'PAYMENT_AMOUNT_MISMATCH',
    gateway: RAZORPAY_GATEWAY,
    gatewayPaymentId: gatewayPayment.id,
    amountInr: payment.amount_inr,
    reason: `Gateway reported ${gatewayPayment.currency} ${gatewayPayment.amount} against a booking of INR ${toPaise(payment.amount_inr)}.`,
    actorId: null,
    at,
  });
}

// ---------------------------------------------------------------------------
// 3. Webhook
// ---------------------------------------------------------------------------

export interface RazorpayWebhookInput {
  rawBody: string;
  signature: string | null;
  gateway: RazorpayGatewayClient;
  store: RazorpayStore;
  now?: Date;
}

export interface RazorpayWebhookOutcome {
  handled: string;
  bookingId: string | null;
  /** Carried so the route can attach a real payment id to its notification. */
  paymentId: string | null;
  mentorNotified: boolean;
  /**
   * Present ONLY when a capture matched no local payment row (audit P0-1).
   *
   * Its presence means the delivery must NOT be acknowledged: the money moved
   * and the platform could not attribute it, so the route returns a non-2xx
   * and the gateway keeps redelivering while an operator reconciles.
   */
  unmatched?: UnmatchedCaptureSignal;
}

export type RazorpayWebhookResult =
  | ({ ok: true; duplicateEvent: boolean } & RazorpayWebhookOutcome)
  | { ok: false; error: RazorpayFailure }
  /**
   * A capture that could not be matched to a local payment (audit P0-1).
   *
   * This is deliberately NOT `ok: true`. The capture has been persisted to the
   * unmatched ledger, but nothing has been paid, confirmed or reconciled, so
   * the gateway must keep redelivering. `outcome` carries the original dispatch
   * result so the route can log and surface it.
   */
  | {
      ok: false;
      error: RazorpayFailure;
      outcome: RazorpayWebhookOutcome;
      unmatchedCapture: UnmatchedCaptureSignal;
    };

interface ParsedWebhook {
  eventType: string;
  eventId: string;
  gatewayPaymentId: string | null;
  gatewayOrderId: string | null;
  amount: number | null;
  currency: string | null;
  status: string | null;
  refundId: string | null;
  payload: Record<string, unknown>;
}

/**
 * Pulls the fields the handler needs out of a Razorpay webhook body.
 *
 * Razorpay nests the entity differently per event (`payload.payment` for payment
 * events, `payload.refund` for refund events), so the lookup walks the known
 * entity keys rather than assuming one shape. `eventId` falls back to a
 * deterministic composite of the event type and the entity id, because the
 * gateway's own `event_id` is not present on every delivery.
 */
export function parseRazorpayWebhookEvent(rawBody: string): ParsedWebhook | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const root = parsed as Record<string, unknown>;
  const eventType = typeof root.event === 'string' ? root.event : '';
  if (!eventType) return null;

  const payloadNode =
    root.payload && typeof root.payload === 'object' ? (root.payload as Record<string, unknown>) : {};

  const readEntity = (key: string): Record<string, unknown> | null => {
    const node = payloadNode[key];
    return node && typeof node === 'object' ? (node as Record<string, unknown>) : null;
  };

  const payment = readEntity('payment');
  const order = readEntity('order');
  const refund = readEntity('refund');

  const gatewayPaymentId = payment && typeof payment.id === 'string' ? payment.id : null;
  const gatewayOrderId =
    (order && typeof order.id === 'string' ? order.id : null) ??
    (payment && typeof payment.order_id === 'string' ? payment.order_id : null) ??
    (refund && typeof refund.order_id === 'string' ? refund.order_id : null);
  const refundId = refund && typeof refund.id === 'string' ? refund.id : null;

  const amountSource = payment ?? order ?? refund;
  const amount = amountSource && typeof amountSource.amount === 'number' ? amountSource.amount : null;
  const currency = amountSource && typeof amountSource.currency === 'string' ? amountSource.currency : null;
  const status = amountSource && typeof amountSource.status === 'string' ? amountSource.status : null;

  const headerEventId = typeof root.event_id === 'string' ? root.event_id : null;
  const eventId = headerEventId ?? `${eventType}:${gatewayPaymentId ?? refundId ?? gatewayOrderId ?? 'unknown'}`;

  return {
    eventType,
    eventId,
    gatewayPaymentId,
    gatewayOrderId,
    amount,
    currency,
    status,
    refundId,
    payload: root,
  };
}

/**
 * Handles one Razorpay webhook delivery.
 *
 * Safety properties, in the order they are enforced:
 *   1. The signature is checked against the RAW body before the body is parsed.
 *   2. The delivery is claimed in `webhook_events` by `(gateway, event_id)`, so
 *      a retried delivery is recognised and ignored rather than re-processed.
 *   3. The business effect is a conditional update, so even if two DIFFERENT
 *      event ids describe the same capture, the payment is marked once and the
 *      mentor is notified once.
 */
export async function runRazorpayWebhook(input: RazorpayWebhookInput): Promise<RazorpayWebhookResult> {
  if (!isRazorpayEnabled()) {
    return { ok: false, error: fail(503, 'RAZORPAY_DISABLED', 'Online payment is not available.') };
  }
  const webhookSecret = getRazorpayWebhookSecret();
  if (!webhookSecret) {
    return { ok: false, error: fail(503, 'RAZORPAY_NOT_CONFIGURED', 'Online payment is temporarily unavailable.') };
  }
  if (!input.signature) {
    return { ok: false, error: fail(400, 'RAZORPAY_SIGNATURE_MISSING', 'Missing signature.') };
  }

  // The RAW body is the signed payload. Parsing first, or re-serialising the
  // parsed object, produces different bytes and can never verify.
  if (!verifyWebhookSignature({ body: input.rawBody, signature: input.signature })) {
    return { ok: false, error: fail(400, 'RAZORPAY_SIGNATURE_INVALID', 'Invalid signature.') };
  }

  const event = parseRazorpayWebhookEvent(input.rawBody);
  if (!event) {
    return { ok: false, error: fail(400, 'RAZORPAY_WEBHOOK_MALFORMED', 'Malformed webhook payload.') };
  }

  const now = input.now ?? new Date();
  const nowIso = now.toISOString();

  const claim = await input.store.claimWebhookEvent({
    eventId: event.eventId,
    eventType: event.eventType,
    payload: event.payload,
    at: nowIso,
  });

  if (claim === 'duplicate') {
    // Already applied and completed on an earlier delivery. Acknowledged so
    // Razorpay stops retrying, without touching any row.
    return { ok: true, duplicateEvent: true, handled: 'duplicate', bookingId: null, paymentId: null, mentorNotified: false };
  }

  try {
    const result = await dispatchWebhookEvent(input, event, nowIso);

    // A capture that matched no local payment row has been persisted to the
    // unmatched ledger, but it is NOT resolved: no payment was confirmed and no
    // booking was advanced. Acknowledging it with 200 is exactly the P0-1 money
    // loss, so it is reported as a retryable failure instead and the event is
    // deliberately left `processed = false`.
    //
    // Leaving it unprocessed matters: a later redelivery is then claimed as
    // `resume` and re-evaluated, so if the missing `payments` row has since
    // appeared (for example an order-creation response that was lost) the
    // capture is applied normally with no manual step.
    if (result.unmatched) {
      console.error(
        `Razorpay ${event.eventType} capture is unmatched (${result.unmatched.reason}); ` +
          'recorded for reconciliation and left unacknowledged so the gateway retries.',
      );
      return {
        ok: false,
        error: fail(
          503,
          'RAZORPAY_CAPTURE_UNMATCHED',
          'A captured payment could not be matched to a local payment and has been recorded for reconciliation.',
        ),
        outcome: result,
        unmatchedCapture: result.unmatched,
      };
    }

    await input.store.completeWebhookEvent(event.eventId, nowIso);
    // `resume` is a repeat delivery, but one that had never been applied, so it
    // is reported as a duplicate for the caller while still being processed.
    return { ok: true, duplicateEvent: claim === 'resume', ...result };
  } catch (err) {
    // Deliberately NOT marking the event processed. The row stays at
    // `processed = false`, which is what lets the next delivery (Razorpay's own
    // retry, or a manual replay) be claimed as `resume` and actually applied.
    // Treating it as a plain duplicate here would drop a real capture and leave
    // a paid booking stuck in PAYMENT_PENDING forever.
    console.error('Razorpay webhook processing failed:', logSanitizer.safeMessage(err));
    throw err;
  }
}

async function dispatchWebhookEvent(
  input: RazorpayWebhookInput,
  event: ParsedWebhook,
  nowIso: string,
): Promise<RazorpayWebhookOutcome> {
  switch (event.eventType) {
    case RAZORPAY_WEBHOOK_EVENTS.payment_captured:
      return handleCaptured(input, event, nowIso);
    case RAZORPAY_WEBHOOK_EVENTS.order_paid:
      // `order.paid` carries no payment entity of its own; the authoritative
      // capture event is what moves the booking, so this is recorded and
      // acknowledged without touching state.
      return { handled: 'order_paid', bookingId: null, paymentId: null, mentorNotified: false };
    case RAZORPAY_WEBHOOK_EVENTS.payment_failed:
      return handleFailed(input, event, nowIso);
    case RAZORPAY_WEBHOOK_EVENTS.refund_created:
      return handleRefund(input, event, 'PENDING');
    case RAZORPAY_WEBHOOK_EVENTS.refund_processed:
      return handleRefund(input, event, 'REFUNDED');
    case RAZORPAY_WEBHOOK_EVENTS.refund_failed:
      return handleRefund(input, event, 'FAILED');
    default:
      return { handled: 'ignored', bookingId: null, paymentId: null, mentorNotified: false };
  }
}

async function resolveWebhookPayment(store: RazorpayStore, event: ParsedWebhook): Promise<RazorpayPaymentRow | null> {
  if (event.gatewayPaymentId) {
    const byPayment = await store.getPaymentByGatewayPaymentId(event.gatewayPaymentId);
    if (byPayment) return byPayment;
  }
  if (event.gatewayOrderId) {
    const byOrder = await store.getPaymentByOrderId(event.gatewayOrderId);
    if (byOrder) return byOrder;
  }
  return null;
}

/**
 * Writes one captured-but-unmatched gateway payment to the exception ledger.
 *
 * Returns null when the event carries no gateway payment id, because
 * `(gateway, razorpay_payment_id)` is the financial identity of the record and
 * there is nothing to key it on.
 *
 * The amount is range-checked here rather than trusted from the payload: the
 * column is INTEGER, and a delivery carrying an absurd figure must still be
 * recorded (with a null amount) rather than fail the whole write and vanish.
 */
async function recordUnmatchedCapture(
  store: RazorpayStore,
  event: ParsedWebhook,
  nowIso: string,
): Promise<UnmatchedCaptureWriteResult | null> {
  if (!event.gatewayPaymentId) return null;

  return store.recordUnmatchedCapture({
    eventId: event.eventId,
    eventType: event.eventType,
    gatewayPaymentId: event.gatewayPaymentId,
    gatewayOrderId: event.gatewayOrderId,
    amountPaise: isStorablePaise(event.amount) ? event.amount : null,
    currency: event.currency,
    receivedAt: nowIso,
    reason: 'PAYMENT_ROW_NOT_FOUND',
    // The original delivery, retained verbatim for later reconciliation. It is
    // never logged and never returned to a browser.
    payload: event.payload,
  });
}

/** Integer-safe guard for the ledger's INTEGER amount column. */
function isStorablePaise(value: number | null): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

async function handleCaptured(
  input: RazorpayWebhookInput,
  event: ParsedWebhook,
  nowIso: string,
): Promise<RazorpayWebhookOutcome> {
  const payment = await resolveWebhookPayment(input.store, event);
  if (!payment) {
    // The money moved but no local `payments` row claims it (audit P0-1).
    //
    // The old behaviour here returned `handled: 'unmatched'` and wrote nothing,
    // which the route acknowledged with 200. Razorpay therefore stopped
    // retrying and the captured money had no local record at all.
    //
    // Now the capture is made DURABLE first: it is written to the unmatched
    // ledger with the original payload, then reported as a retryable failure so
    // the gateway keeps redelivering. It is never turned into a payment, never
    // advances a booking and never notifies a mentor.
    const recorded = await recordUnmatchedCapture(input.store, event, nowIso);
    if (!recorded) {
      // No usable gateway payment id means there is no financial identity to
      // key an exception record on, so nothing can be written or reconciled.
      // Still a retryable failure rather than a silent 200.
      return {
        handled: 'unattributable',
        bookingId: null,
        paymentId: null,
        mentorNotified: false,
        unmatched: {
          recorded: false,
          reason: 'MISSING_PAYMENT_ID',
          gatewayPaymentId: null,
          detail: 'The capture carried no Razorpay payment id, so it cannot be identified or reconciled.',
        },
      };
    }
    return {
      handled: 'unmatched',
      bookingId: null,
      paymentId: null,
      mentorNotified: false,
      unmatched: {
        recorded: true,
        reason: 'PAYMENT_ROW_NOT_FOUND',
        gatewayPaymentId: event.gatewayPaymentId ?? null,
        unmatchedCaptureId: recorded.row.id,
        deliveryCount: recorded.row.delivery_count,
        created: recorded.created,
        detail:
          'A captured payment could not be matched to a local payment row. ' +
          'The capture has been recorded for operator reconciliation.',
      },
    };
  }

  // `razorpay_payment_id` is the key duplicate captures are detected by, so a
  // capture we cannot attribute to a specific gateway payment must not be
  // applied. A `payment.captured` event always carries one, so reaching here
  // means a malformed delivery.
  if (!event.gatewayPaymentId) {
    return { handled: 'unattributable', bookingId: payment.booking_id, paymentId: null, mentorNotified: false };
  }

  // The webhook is authoritative about the gateway's own view, so the amount
  // is re-checked here too. A mismatch is recorded and refused rather than
  // confirming a booking the seeker did not actually pay for.
  if (event.amount !== null && event.amount !== toPaise(payment.amount_inr)) {
    await input.store.insertPaymentEvent({
      paymentId: payment.id,
      status: payment.status,
      eventType: 'PAYMENT_AMOUNT_MISMATCH',
      gateway: RAZORPAY_GATEWAY,
      gatewayPaymentId: event.gatewayPaymentId,
      amountInr: payment.amount_inr,
      reason: `Webhook reported ${event.currency ?? 'unknown'} ${event.amount} against a booking of INR ${toPaise(payment.amount_inr)}.`,
      actorId: null,
      at: nowIso,
    });
    return { handled: 'amount_mismatch', bookingId: payment.booking_id, paymentId: payment.id, mentorNotified: false };
  }

  const outcome = await applyCapturedPayment(input.store, payment, {
    gatewayPaymentId: event.gatewayPaymentId,
    signature: null,
    capturedAt: nowIso,
    payload: event.payload,
  });

  if (outcome.outcome === 'refund_pending') {
    // The booking was cancelled (or is gone) before the money arrived. The
    // capture is recorded in a refund-owed state and acknowledged, so Razorpay
    // stops retrying a delivery that can never succeed - but the booking is NOT
    // advanced and the mentor is NOT notified.
    return {
      handled: 'refund_pending',
      bookingId: payment.booking_id,
      paymentId: payment.id,
      mentorNotified: false,
    };
  }

  return {
    handled: outcome.duplicate ? 'captured_duplicate' : 'captured',
    bookingId: payment.booking_id,
    paymentId: payment.id,
    mentorNotified: outcome.mentorNotified,
  };
}

async function handleFailed(
  input: RazorpayWebhookInput,
  event: ParsedWebhook,
  nowIso: string,
): Promise<RazorpayWebhookOutcome> {
  const payment = await resolveWebhookPayment(input.store, event);
  if (!payment) return { handled: 'unmatched', bookingId: null, paymentId: null, mentorNotified: false };

  const reason = describeFailure(event);

  // The booking is deliberately left in PAYMENT_PENDING. It is still payable,
  // the hold is untouched, and the seeker can simply try again: the FAILED row
  // is re-armed for a new gateway order on the next `runCreateRazorpayOrder`.
  // Advancing it anywhere, or notifying the mentor, would treat a failure as a
  // success.
  const failed = await input.store.markPaymentFailed({ paymentId: payment.id, reason, at: nowIso });
  if (failed) {
    await input.store.insertPaymentEvent({
      paymentId: payment.id,
      status: 'FAILED',
      eventType: 'PAYMENT_FAILED',
      gateway: RAZORPAY_GATEWAY,
      gatewayPaymentId: event.gatewayPaymentId,
      amountInr: payment.amount_inr,
      reason,
      actorId: null,
      at: nowIso,
    });
  }

  return { handled: failed ? 'failed' : 'failed_duplicate', bookingId: payment.booking_id, paymentId: payment.id, mentorNotified: false };
}

function describeFailure(event: ParsedWebhook): string {
  const paymentNode = (event.payload?.payload as Record<string, unknown> | undefined)?.payment;
  if (paymentNode && typeof paymentNode === 'object') {
    const node = paymentNode as Record<string, unknown>;
    if (typeof node.error_description === 'string' && node.error_description.trim()) {
      return node.error_description.trim().slice(0, 500);
    }
    if (typeof node.error_code === 'string' && node.error_code.trim()) {
      return node.error_code.trim().slice(0, 500);
    }
  }
  return event.status ? `Payment ${String(event.status).toLowerCase()}.` : 'The payment could not be completed.';
}

async function handleRefund(
  input: RazorpayWebhookInput,
  event: ParsedWebhook,
  refundStatus: 'PENDING' | 'REFUNDED' | 'FAILED',
): Promise<RazorpayWebhookOutcome> {
  const payment = await resolveWebhookPayment(input.store, event);
  if (!payment || !event.refundId) return { handled: 'unmatched', bookingId: null, paymentId: null, mentorNotified: false };

  // Refund bookkeeping only. The Phase 1 schema carries `refund_id` /
  // `refund_status` so an admin refund flow can be built on top later; nothing
  // here cancels a booking or moves it backwards, because that policy is not
  // defined yet and must not be invented.
  await input.store.recordRefund({ paymentId: payment.id, refundId: event.refundId, refundStatus, at: new Date().toISOString() });
  return { handled: 'refund_recorded', bookingId: payment.booking_id, paymentId: payment.id, mentorNotified: false };
}


// ===========================================================================
// RECONCILIATION (audit P0-1, phase B)
//
// A capture recorded as unmatched is not resolved by waiting or by a hidden
// job: it is resolved by an explicit operator action. The one thing this must
// never do is bind money to the wrong booking, so there is no automatic
// attachment anywhere. Every answer is re-derived from trusted gateway
// identifiers recorded at capture time plus the real local rows; the only
// operator input is which exception record to act on.
// ===========================================================================

export type ReconcileUnmatchedCaptureResult =
  /** Applied through the normal capture path, with all its guards intact. */
  | {
      status: 'APPLIED';
      unmatchedCaptureId: string;
      paymentId: string;
      bookingId: string;
      outcome: ApplyCaptureOutcome['outcome'];
      mentorNotified: boolean;
    }
  /**
   * A verified conflict. The record is flagged CONFLICT and stays unresolved, so
   * a human must look rather than the platform guessing.
   */
  | { status: 'CONFLICT'; unmatchedCaptureId: string; reason: string; detail: string }
  /** Already resolved (possibly by another operator). Not an error. */
  | { status: 'ALREADY_RESOLVED'; unmatchedCaptureId: string; resolvedPaymentId: string | null }
  /** No local payment claims the capture yet. It may appear later. */
  | { status: 'STILL_UNMATCHED'; unmatchedCaptureId: string; reason: string }
  | { status: 'NOT_FOUND'; reason: string };

export interface ReconcileUnmatchedCaptureInput {
  store: RazorpayStore;
  unmatchedCaptureId: string;
  /** The admin performing the action, recorded for the audit trail. */
  actorId: string | null;
  now?: Date;
}

/**
 * Attempts to attach one recorded unmatched capture to the payment it belongs to.
 *
 * Every step refuses rather than assumes:
 *   1. the record exists and has not already been resolved;
 *   2. a local payment claims that exact gateway payment id - or, failing that,
 *      the exact gateway order id, and ONLY when that payment has no gateway
 *      payment id of its own, so a later capture cannot be re-bound to a payment
 *      that merely shares an order;
 *   3. the payment is a Razorpay payment in a state a capture may apply to;
 *   4. the capture was not already applied to a different payment;
 *   5. the recorded amount equals the server-derived amount for that payment;
 *   6. the recorded currency is the platform currency.
 *
 * Only then is `applyCapturedPayment` used, so reconciliation inherits the same
 * conditional updates, the same booking dead-end handling and the same once-only
 * mentor notification as a live capture. It cannot invent a payment, cannot
 * fabricate a booking, and cannot apply a conflicting amount.
 */
export async function reconcileUnmatchedCapture(
  input: ReconcileUnmatchedCaptureInput,
): Promise<ReconcileUnmatchedCaptureResult> {
  const nowIso = (input.now ?? new Date()).toISOString();
  const { store } = input;

  const record = await store.getUnmatchedCaptureById(input.unmatchedCaptureId);
  if (!record) {
    return { status: 'NOT_FOUND', reason: 'No unmatched-capture record with that id exists.' };
  }
  if (record.reconciliation_status === 'RESOLVED') {
    return {
      status: 'ALREADY_RESOLVED',
      unmatchedCaptureId: record.id,
      resolvedPaymentId: record.resolved_payment_id,
    };
  }


  // 2. Resolve only through the trusted gateway identifiers captured earlier.
  let payment = await store.getPaymentByGatewayPaymentId(record.razorpay_payment_id);
  if (!payment && record.razorpay_order_id) {
    const byOrder = await store.getPaymentByOrderId(record.razorpay_order_id);
    if (byOrder && byOrder.razorpay_payment_id === null) payment = byOrder;
  }
  if (!payment) {
    return {
      status: 'STILL_UNMATCHED',
      unmatchedCaptureId: record.id,
      reason: 'No local payment row claims this capture yet. It stays pending and the gateway keeps retrying.',
    };
  }

  // 3. A gateway payment, in a state a capture may legally apply to.
  if (payment.gateway !== RAZORPAY_GATEWAY) {
    return flagConflict(
      store, record, input.actorId, nowIso, 'PAYMENT_NOT_RAZORPAY',
      `Payment ${payment.id} is not a Razorpay payment.`,
    );
  }
  if (!['PAYMENT_PROCESSING', 'PAYMENT_PENDING'].includes(payment.status)) {
    return flagConflict(
      store, record, input.actorId, nowIso, 'PAYMENT_NOT_CAPTURABLE',
      `Payment ${payment.id} is ${payment.status} and cannot accept a capture.`,
    );
  }

  // 4. Never attach a capture to a payment that already records a different
  //    captured gateway payment: that would double-count one booking.
  if (payment.razorpay_payment_id && payment.razorpay_payment_id !== record.razorpay_payment_id) {
    return flagConflict(
      store, record, input.actorId, nowIso, 'PAYMENT_ALREADY_CAPTURED_ELSEWHERE',
      `Payment ${payment.id} already records captured payment ${payment.razorpay_payment_id}.`,
    );
  }

  // 5 + 6. Amount and currency, against server-derived values only.
  const expectedPaise = toPaise(payment.amount_inr);
  if (record.amount_paise !== null && record.amount_paise !== expectedPaise) {
    return flagConflict(
      store, record, input.actorId, nowIso, 'AMOUNT_MISMATCH',
      `Capture was ${record.amount_paise} paise but payment ${payment.id} is worth ${expectedPaise}.`,
    );
  }
  if (record.currency !== null && record.currency !== RAZORPAY_CURRENCY) {
    return flagConflict(
      store, record, input.actorId, nowIso, 'CURRENCY_MISMATCH',
      `Capture was in ${record.currency}, not ${RAZORPAY_CURRENCY}.`,
    );
  }

  // All checks passed. Reuse the live capture path so the payment, the booking
  // and the mentor notification move through exactly the same guarded
  // transitions a normal webhook uses.
  let applied: ApplyCaptureOutcome;
  try {
    applied = await applyCapturedPayment(
      store,
      payment,
      {
        gatewayPaymentId: record.razorpay_payment_id,
        // The gateway signature is never retained in the ledger, so it is null
        // here. That is safe because the capture was already HMAC-verified when
        // it was recorded, and because the amount above was re-derived from the
        // server, not from this record.
        signature: null,
        capturedAt: record.received_at,
        // The raw payload is deliberately not replayed into `gateway_payload`;
        // it remains in the ledger for audit rather than being copied forward.
        payload: null,
      },
    );
  } catch (err) {
    // A conflict raised by the capture path itself (a different gateway payment
    // already on this booking, or a state that cannot be confirmed). Surface it
    // rather than forcing a resolution.
    return flagConflict(
      store, record, input.actorId, nowIso, 'CAPTURE_PATH_CONFLICT',
      logSanitizer.safeMessage(err),
    );
  }

  await store.resolveUnmatchedCapture({
    id: record.id,
    status: 'RESOLVED',
    resolvedPaymentId: payment.id,
    note: `Reconciled to payment ${payment.id} (${applied.outcome}).`,
    actorId: input.actorId,
    at: nowIso,
  });

  return {
    status: 'APPLIED',
    unmatchedCaptureId: record.id,
    paymentId: payment.id,
    bookingId: payment.booking_id,
    outcome: applied.outcome,
    mentorNotified: 'mentorNotified' in applied ? applied.mentorNotified : false,
  };
}

/**
 * Marks a record CONFLICT so it stops being retried blindly and waits for a
 * human. The capture evidence is preserved; nothing is attached.
 */
async function flagConflict(
  store: RazorpayStore,
  record: UnmatchedCaptureRow,
  actorId: string | null,
  at: string,
  reason: string,
  detail: string,
): Promise<ReconcileUnmatchedCaptureResult> {
  await store.resolveUnmatchedCapture({
    id: record.id,
    status: 'CONFLICT',
    resolvedPaymentId: null,
    note: `${reason}: ${detail}`.slice(0, 500),
    actorId,
    at,
  });
  return { status: 'CONFLICT', unmatchedCaptureId: record.id, reason, detail };
}

/** The operator queue: exception records that still need a decision. */
export async function listUnmatchedCaptures(
  store: RazorpayStore,
  input: { limit?: number } = {},
): Promise<UnmatchedCaptureRow[]> {
  return store.listUnmatchedCaptures({ limit: Math.min(Math.max(input.limit ?? 50, 1), 200) });
}
