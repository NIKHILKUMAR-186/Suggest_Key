import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createSupabaseRazorpayStore } from '../src/lib/razorpayStore';

/**
 * Supabase adapter contract tests.
 *
 * The service tests drive the business logic through an in-memory store, which
 * means they would happily pass even if the real adapter issued a broken query.
 * That is the dangerous gap this file closes: the adapter is where the
 * IDEMPOTENCY actually lives. A mistyped column, a missing `.eq('status', ...)`
 * filter, or an `upsert` where an `insert` was required would turn "only one
 * caller may confirm this payment" into "every caller may", and no service-level
 * test would notice.
 *
 * So these tests assert the emitted query itself - the exact filters, the exact
 * payload, the exact operation - rather than the returned value. The column and
 * constraint names are the ones verified against the live database.
 */

const PAYMENT_ID = '66666666-6666-4666-8666-666666666666';
const BOOKING_ID = '44444444-4444-4444-8444-444444444444';
const ORDER_ID = 'order_TEST123';
const GATEWAY_PAYMENT_ID = 'pay_TEST123';

interface Recorded {
  table: string;
  op: 'select' | 'insert' | 'update';
  payload: Record<string, unknown> | null;
  filters: Array<[string, string, unknown]>;
}

interface StubResponse {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
}

/**
 * Minimal but faithful stand-in for the supabase-js query builder: chainable,
 * thenable, and it records exactly what was asked for.
 */
function createFakeClient(defaults: { select?: StubResponse; insert?: StubResponse; update?: StubResponse } = {}) {
  const calls: Recorded[] = [];
  const responses: StubResponse[] = [];
  let responseQueue: StubResponse[] = [];

  const client: any = {
    __calls: calls,
    /** Append a specific response for the next awaited query. */
    __queue: (...r: StubResponse[]) => { responseQueue = [...responseQueue, ...r]; },
    from(table: string) {
      const record: Recorded = { table, op: 'select', payload: null, filters: [] };
      calls.push(record);

      const builder: any = {
        select(_cols?: string) { return builder; },
        insert(payload: Record<string, unknown>) { record.op = 'insert'; record.payload = payload; return builder; },
        update(payload: Record<string, unknown>) { record.op = 'update'; record.payload = payload; return builder; },
        eq(column: string, value: unknown) { record.filters.push([column, 'eq', value]); return builder; },
        in(column: string, values: unknown[]) { record.filters.push([column, 'in', values]); return builder; },
        is(column: string, value: unknown) { record.filters.push([column, 'is', value]); return builder; },
        not() { return builder; },
        gt() { return builder; },
        lt() { return builder; },
        single() { return builder; },
        maybeSingle() { return builder; },
        then(onFulfilled: (v: unknown) => unknown) {
          const fallback = record.op === 'insert' ? defaults.insert : record.op === 'update' ? defaults.update : defaults.select;
          const response: StubResponse = responseQueue.shift() ?? fallback ?? { data: null, error: null };
          return Promise.resolve(onFulfilled(response));
        },
      };
      return builder;
    },
  };

  return client;
}

const filter = (calls: Recorded[], i: number, column: string) => calls[i].filters.find((f) => f[0] === column);
const columns = (calls: Recorded[], i: number) => calls[i].filters.map((f) => f[0]);

let originalEnv: NodeJS.ProcessEnv;
beforeEach(() => { originalEnv = { ...process.env }; });
afterEach(() => { process.env = originalEnv; });

// ---------------------------------------------------------------------------
// Column shapes
// ---------------------------------------------------------------------------

describe('razorpay store: payment row mapping', () => {
  it('maps the live payments columns the flows depend on', async () => {
    const client = createFakeClient({
      select: {
        data: {
          id: PAYMENT_ID, booking_id: BOOKING_ID, seeker_id: 'seeker-1', amount_inr: 999,
          status: 'PAYMENT_PROCESSING', gateway: 'razorpay', razorpay_order_id: ORDER_ID,
          razorpay_payment_id: null, razorpay_signature: null, captured_at: null,
          failure_reason: null, refund_id: null, refund_status: null,
        },
        error: null,
      },
    });
    const store = createSupabaseRazorpayStore(client);
    const row = await store.getPaymentByBookingId(BOOKING_ID);

    assert.equal(row?.id, PAYMENT_ID);
    assert.equal(row?.gateway, 'razorpay');
    assert.equal(row?.razorpay_order_id, ORDER_ID);
    assert.equal(row?.amount_inr, 999);
    assert.equal(client.__calls[0].table, 'payments');
  });

  it('returns null for a missing row rather than throwing', async () => {
    const client = createFakeClient({ select: { data: null, error: null } });
    const store = createSupabaseRazorpayStore(client);
    assert.equal(await store.getPaymentByBookingId('nope'), null);
  });
});

// ---------------------------------------------------------------------------
// The concurrency gates — the reason this adapter exists
// ---------------------------------------------------------------------------

describe('razorpay store: capture is a conditional update', () => {
  it('scopes the capture to PAYMENT_PROCESSING so only one caller can win', async () => {
    const client = createFakeClient();
    const store = createSupabaseRazorpayStore(client);

    await store.markPaymentCaptured({
      paymentId: PAYMENT_ID, gatewayPaymentId: GATEWAY_PAYMENT_ID, signature: 'sig', capturedAt: '2026-10-01T12:00:00.000Z', payload: null,
    });

    const call = client.__calls[0];
    assert.equal(call.op, 'update');
    assert.equal(call.table, 'payments');
    // The load-bearing filter. Without it every delivery could re-confirm.
    assert.deepEqual(filter(client.__calls, 0, 'status'), ['status', 'eq', 'PAYMENT_PROCESSING']);
    assert.deepEqual(filter(client.__calls, 0, 'id'), ['id', 'eq', PAYMENT_ID]);
    assert.equal(call.payload?.status, 'VERIFIED');
    assert.equal(call.payload?.razorpay_payment_id, GATEWAY_PAYMENT_ID);
    assert.equal(call.payload?.captured_at, '2026-10-01T12:00:00.000Z');
  });

  it('refuses to downgrade a VERIFIED payment back into the capture path', async () => {
    const client = createFakeClient();
    const store = createSupabaseRazorpayStore(client);
    await store.markPaymentCaptured({ paymentId: PAYMENT_ID, gatewayPaymentId: GATEWAY_PAYMENT_ID, signature: null, capturedAt: 'x', payload: null });
    // The query must not accept a VERIFIED row, or a late capture could
    // rewrite a confirmed payment.
    assert.equal(filter(client.__calls, 0, 'status')?.[2], 'PAYMENT_PROCESSING');
  });

  it('backfills a missing gateway id only on an already-VERIFIED row', async () => {
    const client = createFakeClient();
    const store = createSupabaseRazorpayStore(client);
    await store.markPaymentAlreadyCaptured({ paymentId: PAYMENT_ID, gatewayPaymentId: GATEWAY_PAYMENT_ID, capturedAt: 'x' });

    const call = client.__calls[0];
    assert.deepEqual(filter(client.__calls, 0, 'status'), ['status', 'eq', 'VERIFIED']);
    assert.deepEqual(filter(client.__calls, 0, 'razorpay_payment_id'), ['razorpay_payment_id', 'is', null]);
    assert.equal(call.payload?.razorpay_payment_id, GATEWAY_PAYMENT_ID);
  });
});

describe('razorpay store: booking transition is the notification gate', () => {
  it('moves the booking out of a payable state and reports the row when it won', async () => {
    const client = createFakeClient({ update: { data: { id: BOOKING_ID }, error: null } });
    const store = createSupabaseRazorpayStore(client);

    const won = await store.markBookingMentorPending(BOOKING_ID, '2026-10-01T12:00:00.000Z');

    assert.equal(won, true);
    const call = client.__calls[0];
    assert.equal(call.table, 'bookings');
    assert.equal(call.payload?.status, 'MENTOR_PENDING');
    // Both payable states must be accepted, or a Razorpay order created while
    // the booking is still PAYMENT_PENDING could never advance.
    assert.deepEqual(filter(client.__calls, 0, 'status'), ['status', 'in', ['PAYMENT_PENDING', 'PAYMENT_PROCESSING']]);
  });

  it('reports false when no row matched, so the loser sends no notification', async () => {
    const client = createFakeClient({ update: { data: null, error: null } });
    const store = createSupabaseRazorpayStore(client);
    assert.equal(await store.markBookingMentorPending(BOOKING_ID, 'x'), false);
  });

  it('never advances a booking that is already MENTOR_PENDING or later', async () => {
    const client = createFakeClient();
    const store = createSupabaseRazorpayStore(client);
    await store.markBookingMentorPending(BOOKING_ID, 'x');
    const allowed = filter(client.__calls, 0, 'status')?.[2] as string[];
    for (const terminal of ['MENTOR_PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REJECTED']) {
      assert.equal(allowed.includes(terminal), false, `${terminal} must not be re-entered`);
    }
  });
});

describe('razorpay store: failure never resurrects a captured payment', () => {
  it('scopes the failure to in-flight states only', async () => {
    const client = createFakeClient();
    const store = createSupabaseRazorpayStore(client);
    await store.markPaymentFailed({ paymentId: PAYMENT_ID, reason: 'card declined', at: 'x' });

    assert.equal(client.__calls[0].payload?.status, 'FAILED');
    assert.match(String(client.__calls[0].payload?.failure_reason), /card declined/);
    const allowed = filter(client.__calls, 0, 'status')?.[2] as string[];
    assert.deepEqual(allowed.sort(), ['PAYMENT_PENDING', 'PAYMENT_PROCESSING']);
    // A captured payment must be immune to a late failure event.
    assert.equal(allowed.includes('VERIFIED'), false);
  });

  it('bounds the stored failure reason to the column width', async () => {
    const client = createFakeClient();
    const store = createSupabaseRazorpayStore(client);
    await store.markPaymentFailed({ paymentId: PAYMENT_ID, reason: 'x'.repeat(5000), at: 'x' });
    assert.ok(String(client.__calls[0].payload?.failure_reason).length <= 500);
  });
});

// ---------------------------------------------------------------------------
// Order creation must never destroy a manual payment
// ---------------------------------------------------------------------------

describe('razorpay store: attaching a gateway order', () => {
  it('uses INSERT, never an upsert, so a manual proof cannot be overwritten', async () => {
    const client = createFakeClient({ insert: { data: { id: PAYMENT_ID }, error: null } });
    const store = createSupabaseRazorpayStore(client);
    await store.attachGatewayOrder({ bookingId: BOOKING_ID, seekerId: 'seeker-1', amountInr: 999, orderId: ORDER_ID, at: 'x' });

    const call = client.__calls[0];
    // An upsert here would silently destroy a concurrently submitted manual
    // proof (proof path, UTR and admin review state all lost).
    assert.equal(call.op, 'insert', 'must be an insert so a unique violation is a conflict, not an overwrite');
    assert.equal(call.payload?.booking_id, BOOKING_ID);
    assert.equal(call.payload?.gateway, 'razorpay');
    assert.equal(call.payload?.status, 'PAYMENT_PROCESSING');
    assert.equal(call.payload?.razorpay_order_id, ORDER_ID);
    // Server-derived amount, and a gateway payment has no proof.
    assert.equal(call.payload?.amount_inr, 999);
    assert.equal(call.payload?.proof_storage_path, null);
    assert.equal(call.payload?.transaction_reference, null);
  });

  it('reports a unique violation as a conflict rather than throwing', async () => {
    const client = createFakeClient({ insert: { data: null, error: { code: '23505', message: 'duplicate key' } } });
    const store = createSupabaseRazorpayStore(client);
    const result = await store.attachGatewayOrder({ bookingId: BOOKING_ID, seekerId: 's', amountInr: 999, orderId: ORDER_ID, at: 'x' });
    assert.equal(result, null, 'null tells the service a payment already exists');
  });

  it('propagates a genuine database error instead of swallowing it', async () => {
    const client = createFakeClient({ insert: { data: null, error: { code: 'PGRST116', message: 'boom' } } });
    const store = createSupabaseRazorpayStore(client);
    // Raw PostgREST errors are rethrown, matching the rest of the codebase:
    // `describeSupabaseError` reads `.code`/`.message` off either shape.
    let thrown: any = null;
    try {
      await store.attachGatewayOrder({ bookingId: BOOKING_ID, seekerId: 's', amountInr: 999, orderId: ORDER_ID, at: 'x' });
    } catch (err) {
      thrown = err;
    }
    assert.ok(thrown, 'a non-uniqueness error must not be silently reported as a conflict');
    assert.equal(thrown.code, 'PGRST116');
  });
});

describe('razorpay store: re-arming a failed payment for a retry', () => {
  it('scopes the re-arm to a FAILED RAZORPAY row, so no other flow is hijacked', async () => {
    const client = createFakeClient({ update: { data: { id: PAYMENT_ID }, error: null } });
    const store = createSupabaseRazorpayStore(client);
    await store.rearmFailedGatewayPayment({ paymentId: PAYMENT_ID, orderId: 'order_RETRY', at: '2026-10-01T12:05:00.000Z' });

    const call = client.__calls[0];
    assert.equal(call.table, 'payments');
    assert.equal(call.payload?.status, 'PAYMENT_PROCESSING');
    assert.equal(call.payload?.razorpay_order_id, 'order_RETRY');
    // Without the gateway filter this would re-arm a MANUAL payment proof, and
    // without the status filter it would re-arm an attempt still in flight.
    assert.deepEqual(filter(client.__calls, 0, 'status'), ['status', 'eq', 'FAILED']);
    assert.deepEqual(filter(client.__calls, 0, 'gateway'), ['gateway', 'eq', 'razorpay']);
  });

  it('clears the previous attempt rather than mixing the two records', async () => {
    const client = createFakeClient();
    const store = createSupabaseRazorpayStore(client);
    await store.rearmFailedGatewayPayment({ paymentId: PAYMENT_ID, orderId: 'order_RETRY', at: 'x' });

    const payload = client.__calls[0].payload ?? {};
    // The old gateway payment id and signature must not survive: they are the
    // keys a stale webhook or browser verify would be matched on.
    assert.equal(payload.razorpay_payment_id, null);
    assert.equal(payload.razorpay_signature, null);
    assert.equal(payload.captured_at, null);
    assert.equal(payload.failure_reason, null);
    assert.equal(payload.gateway_payload, null);
    assert.equal(payload.refund_id, null);
    assert.equal(payload.refund_status, null);
  });

  it('reports no row when the payment is not FAILED, so a lost race is visible', async () => {
    const client = createFakeClient();
    const store = createSupabaseRazorpayStore(client);
    // No update response: zero rows matched, which the service reports as a
    // conflict rather than silently overwriting.
    assert.equal(await store.rearmFailedGatewayPayment({ paymentId: PAYMENT_ID, orderId: 'order_RETRY', at: 'x' }), null);
  });
});

describe('razorpay store: a capture against a closed booking', () => {
  it('parks the payment as refund-owed instead of confirming it', async () => {
    const client = createFakeClient({ update: { data: { id: PAYMENT_ID }, error: null } });
    const store = createSupabaseRazorpayStore(client);
    await store.markPaymentRefundPending({ paymentId: PAYMENT_ID, gatewayPaymentId: GATEWAY_PAYMENT_ID, reason: 'booking was cancelled', at: 'x' });

    const call = client.__calls[0];
    // Not VERIFIED: a cancelled booking must never look like money earned.
    assert.equal(call.payload?.status, 'FAILED');
    // The gateway payment id is kept, so the money is traceable to Razorpay.
    assert.equal(call.payload?.razorpay_payment_id, GATEWAY_PAYMENT_ID);
    // The existing CHECK allows this, and it means "owed, not yet issued".
    assert.equal(call.payload?.refund_status, 'PENDING');
    // `captured_at` stays unset: the payment was never confirmed for a booking.
    assert.equal('captured_at' in (call.payload ?? {}), false);
  });

  it('scopes the write to the in-flight states, so it cannot overwrite a confirmed payment', async () => {
    const client = createFakeClient();
    const store = createSupabaseRazorpayStore(client);
    await store.markPaymentRefundPending({ paymentId: PAYMENT_ID, gatewayPaymentId: GATEWAY_PAYMENT_ID, reason: 'x', at: 'x' });

    const allowed = filter(client.__calls, 0, 'status')?.[2] as string[];
    assert.deepEqual(allowed.sort(), ['PAYMENT_PENDING', 'PAYMENT_PROCESSING']);
    for (const safe of ['VERIFIED', 'REFUNDED', 'REFUND_FAILED', 'REJECTED']) {
      assert.equal(allowed.includes(safe), false, `${safe} must not be overwritten by a recovery write`);
    }
  });

  it('bounds the recorded reason to the column width', async () => {
    const client = createFakeClient();
    const store = createSupabaseRazorpayStore(client);
    await store.markPaymentRefundPending({ paymentId: PAYMENT_ID, gatewayPaymentId: GATEWAY_PAYMENT_ID, reason: 'x'.repeat(5000), at: 'x' });
    assert.ok(String(client.__calls[0].payload?.failure_reason).length <= 500);
  });
});

// ---------------------------------------------------------------------------
// Webhook claim: the payment-loss gate
// ---------------------------------------------------------------------------

describe('razorpay store: webhook event claim', () => {
  const claimInput = { eventId: 'evt_1', eventType: 'payment.captured', payload: { a: 1 }, at: 'x' };

  it('claims a first delivery as new and records it unprocessed', async () => {
    const client = createFakeClient({ insert: { data: null, error: null } });
    const store = createSupabaseRazorpayStore(client);
    const claim = await store.claimWebhookEvent(claimInput);

    assert.equal(claim, 'new');
    const call = client.__calls[0];
    assert.equal(call.table, 'webhook_events');
    assert.equal(call.payload?.gateway, 'razorpay');
    assert.equal(call.payload?.event_id, 'evt_1');
    assert.equal(call.payload?.processed, false, 'an in-flight event must be marked unprocessed');
  });

  it('treats a completed replay as a duplicate and does NOT re-apply it', async () => {
    const client = createFakeClient();
    client.__queue({ data: null, error: { code: '23505', message: 'duplicate key' } });
    client.__queue({ data: { processed: true }, error: null });
    const store = createSupabaseRazorpayStore(client);
    assert.equal(await store.claimWebhookEvent(claimInput), 'duplicate');
  });

  it('resumes an event whose earlier attempt failed, so a real payment is not lost', async () => {
    const client = createFakeClient();
    client.__queue({ data: null, error: { code: '23505', message: 'duplicate key' } });
    client.__queue({ data: { processed: false }, error: null });
    const store = createSupabaseRazorpayStore(client);
    // Regression: this used to be reported as a duplicate and skipped, which
    // silently dropped a captured payment.
    assert.equal(await store.claimWebhookEvent(claimInput), 'resume');
  });

  it('propagates a non-uniqueness insert error instead of pretending it is a replay', async () => {
    const client = createFakeClient();
    client.__queue({ data: null, error: { code: '42501', message: 'permission denied' } });
    const store = createSupabaseRazorpayStore(client);
    let thrown: any = null;
    try {
      await store.claimWebhookEvent(claimInput);
    } catch (err) {
      thrown = err;
    }
    // Misreporting this as a duplicate would ACK a capture that was never
    // applied, which is how a paid booking gets lost.
    assert.ok(thrown, 'a permission error must not be reported as a duplicate');
    assert.equal(thrown.code, '42501');
  });

  it('marks the event processed by gateway and event id together', async () => {
    const client = createFakeClient();
    const store = createSupabaseRazorpayStore(client);
    await store.completeWebhookEvent('evt_1', 'x');

    const call = client.__calls[0];
    assert.equal(call.op, 'update');
    assert.equal(call.payload?.processed, true);
    assert.deepEqual(columns(client.__calls, 0).sort(), ['event_id', 'gateway']);
  });
});

// ---------------------------------------------------------------------------
// Refunds: bookkeeping only, never a confirmation
// ---------------------------------------------------------------------------

describe('razorpay store: refund bookkeeping', () => {
  it('records a pending refund WITHOUT touching the payment status', async () => {
    const client = createFakeClient({ update: { data: { id: PAYMENT_ID }, error: null } });
    const store = createSupabaseRazorpayStore(client);
    await store.recordRefund({ paymentId: PAYMENT_ID, refundId: 'rfnd_1', refundStatus: 'PENDING', at: 'x' });

    const call = client.__calls[0];
    assert.equal(call.payload?.refund_id, 'rfnd_1');
    assert.equal(call.payload?.refund_status, 'PENDING');
    assert.equal('status' in (call.payload ?? {}), false, 'a pending refund must not write a payment status at all');
  });

  it('only moves a genuinely VERIFIED payment to REFUNDED', async () => {
    const client = createFakeClient({ update: { data: { id: PAYMENT_ID }, error: null } });
    const store = createSupabaseRazorpayStore(client);
    await store.recordRefund({ paymentId: PAYMENT_ID, refundId: 'rfnd_1', refundStatus: 'REFUNDED', at: 'x' });

    const call = client.__calls[0];
    assert.equal(call.payload?.status, 'REFUNDED');
    assert.deepEqual(filter(client.__calls, 0, 'status'), ['status', 'eq', 'VERIFIED']);
  });

  it('maps a failed refund to REFUND_FAILED, still scoped to VERIFIED', async () => {
    const client = createFakeClient();
    const store = createSupabaseRazorpayStore(client);
    await store.recordRefund({ paymentId: PAYMENT_ID, refundId: 'rfnd_1', refundStatus: 'FAILED', at: 'x' });
    assert.equal(client.__calls[0].payload?.status, 'REFUND_FAILED');
    assert.deepEqual(filter(client.__calls, 0, 'status'), ['status', 'eq', 'VERIFIED']);
  });
});

// ---------------------------------------------------------------------------
// Payment events must never fail the payment they describe
// ---------------------------------------------------------------------------

describe('razorpay store: payment events are best effort', () => {
  it('swallows an event write failure rather than rejecting', async () => {
    const client = createFakeClient({ insert: { data: null, error: { code: '23503', message: 'fk violation' } } });
    const store = createSupabaseRazorpayStore(client);
    // An audit-log write must never fail the payment it describes.
    await store.insertPaymentEvent({
      paymentId: PAYMENT_ID, status: 'VERIFIED', eventType: 'PAYMENT_CAPTURED',
      gateway: 'razorpay', gatewayPaymentId: GATEWAY_PAYMENT_ID, amountInr: 999, reason: null, actorId: null, at: 'x',
    });
    const call = client.__calls[0];
    assert.equal(call.table, 'payment_events');
    assert.equal(call.payload?.event_type, 'PAYMENT_CAPTURED');
    assert.equal(call.payload?.amount_inr, 999);
  });
});
