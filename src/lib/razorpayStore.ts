/**
 * Supabase implementation of the `RazorpayStore` port.
 *
 * Every mutating call is a CONDITIONAL update scoped to the status it is
 * allowed to move from, and every one of them selects the affected row. That
 * gives the idempotency the gateway flows depend on: if a webhook, the browser
 * verification, and a retried webhook all race, only the update whose
 * precondition still holds writes anything, and only that caller is told it
 * "won" the transition. The mentor notification is emitted from the winner
 * alone, which is what makes a duplicate notification impossible.
 *
 * All queries go through the service-role client, so none of this depends on
 * browser RLS.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { RAZORPAY_GATEWAY } from './razorpayConfig';
import {
  type PaymentEventInput,
  type RazorpayBookingRow,
  type RazorpayHoldRow,
  type RazorpayPaymentRow,
  type RazorpayStore,
} from './razorpayService';

/** Supabase returns snake_case columns; these selects keep the mapping explicit. */
const BOOKING_COLUMNS = 'id, booking_code, seeker_id, mentor_id, amount_inr, status, start_time, hold_id';
const PAYMENT_COLUMNS =
  'id, booking_id, seeker_id, amount_inr, status, gateway, razorpay_order_id, razorpay_payment_id, razorpay_signature, captured_at, failure_reason, refund_id, refund_status';

const readBooking = (row: Record<string, unknown> | null): RazorpayBookingRow | null => {
  if (!row || typeof row.id !== 'string') return null;
  return {
    id: row.id,
    booking_code: String(row.booking_code ?? ''),
    seeker_id: String(row.seeker_id ?? ''),
    mentor_id: String(row.mentor_id ?? ''),
    amount_inr: Number(row.amount_inr ?? 0),
    status: String(row.status ?? ''),
    start_time: String(row.start_time ?? ''),
    hold_id: (row.hold_id as string | null) ?? null,
  };
};

const readPayment = (row: Record<string, unknown> | null): RazorpayPaymentRow | null => {
  if (!row || typeof row.id !== 'string') return null;
  return {
    id: row.id,
    booking_id: String(row.booking_id ?? ''),
    seeker_id: String(row.seeker_id ?? ''),
    amount_inr: Number(row.amount_inr ?? 0),
    status: String(row.status ?? ''),
    gateway: (row.gateway as string | null) ?? null,
    razorpay_order_id: (row.razorpay_order_id as string | null) ?? null,
    razorpay_payment_id: (row.razorpay_payment_id as string | null) ?? null,
    razorpay_signature: (row.razorpay_signature as string | null) ?? null,
    captured_at: (row.captured_at as string | null) ?? null,
    failure_reason: (row.failure_reason as string | null) ?? null,
    refund_id: (row.refund_id as string | null) ?? null,
    refund_status: (row.refund_status as string | null) ?? null,
  };
};

export function createSupabaseRazorpayStore(admin: SupabaseClient): RazorpayStore {
  return {
    async getBooking(bookingId) {
      const { data, error } = await admin.from('bookings').select(BOOKING_COLUMNS).eq('id', bookingId).maybeSingle();
      if (error) throw error;
      return readBooking(data as Record<string, unknown> | null);
    },

    async getHold(holdId) {
      const { data, error } = await admin
        .from('slot_holds')
        .select('id, status, expires_at')
        .eq('id', holdId)
        .maybeSingle();
      if (error) throw error;
      const row = data as Record<string, unknown> | null;
      if (!row || typeof row.id !== 'string') return null;
      return { id: row.id, status: String(row.status ?? ''), expires_at: String(row.expires_at ?? '') } as RazorpayHoldRow;
    },

    async getPaymentById(paymentId) {
      const { data, error } = await admin.from('payments').select(PAYMENT_COLUMNS).eq('id', paymentId).maybeSingle();
      if (error) throw error;
      return readPayment(data as Record<string, unknown> | null);
    },

    async getPaymentByBookingId(bookingId) {
      const { data, error } = await admin.from('payments').select(PAYMENT_COLUMNS).eq('booking_id', bookingId).maybeSingle();
      if (error) throw error;
      return readPayment(data as Record<string, unknown> | null);
    },

    async getPaymentByOrderId(orderId) {
      const { data, error } = await admin
        .from('payments')
        .select(PAYMENT_COLUMNS)
        .eq('razorpay_order_id', orderId)
        .maybeSingle();
      if (error) throw error;
      return readPayment(data as Record<string, unknown> | null);
    },

    async getPaymentByGatewayPaymentId(gatewayPaymentId) {
      const { data, error } = await admin
        .from('payments')
        .select(PAYMENT_COLUMNS)
        .eq('razorpay_payment_id', gatewayPaymentId)
        .maybeSingle();
      if (error) throw error;
      return readPayment(data as Record<string, unknown> | null);
    },

    async attachGatewayOrder({ bookingId, seekerId, amountInr, orderId, at }) {
      // A plain INSERT, deliberately never an upsert. `payments` is
      // UNIQUE(booking_id), so a manual proof submitted between the pre-flight
      // lookup and this write makes the INSERT FAIL instead of silently
      // overwriting that seeker's proof, transaction reference and admin review
      // state. Data loss on the manual flow is not an acceptable outcome of a
      // race, so the conflict is reported rather than resolved.
      const { data, error } = await admin
        .from('payments')
        .insert({
          booking_id: bookingId,
          seeker_id: seekerId,
          // Server-derived snapshot, matching the manual flow exactly.
          amount_inr: amountInr,
          gateway: RAZORPAY_GATEWAY,
          status: 'PAYMENT_PROCESSING',
          razorpay_order_id: orderId,
          razorpay_payment_id: null,
          razorpay_signature: null,
          captured_at: null,
          failure_reason: null,
          // A gateway payment has no uploaded screenshot.
          proof_storage_path: null,
          transaction_reference: null,
          rejection_reason: null,
          verified_by: null,
          verified_at: null,
          updated_at: at,
        })
        .select(PAYMENT_COLUMNS)
        .single();
      if (error) {
        // A payment row already exists for this booking: the caller won a race
        // we deliberately refuse to resolve by overwriting.
        if (error.code === '23505') return null;
        throw error;
      }
      return readPayment(data as Record<string, unknown> | null);
    },

    async rearmFailedGatewayPayment({ paymentId, orderId, at }) {
      // A retry re-uses the failed row because `payments` is UNIQUE(booking_id).
      // Scoped to a FAILED RAZORPAY row on purpose: an attempt that is still in
      // flight, an already-confirmed payment, and a manual proof all fail this
      // filter, so a retry can never hijack another flow's row.
      //
      // The previous attempt's identifiers are cleared, not overwritten with a
      // mixed record. That is what stops a late webhook or a stale browser
      // verify for the old order from being attributed to the new attempt; the
      // old attempt itself remains in `payment_events`.
      const { data, error } = await admin
        .from('payments')
        .update({
          status: 'PAYMENT_PROCESSING',
          razorpay_order_id: orderId,
          razorpay_payment_id: null,
          razorpay_signature: null,
          captured_at: null,
          failure_reason: null,
          gateway_payload: null,
          refund_id: null,
          refund_status: null,
          updated_at: at,
        })
        .eq('id', paymentId)
        .eq('status', 'FAILED')
        .eq('gateway', RAZORPAY_GATEWAY)
        .select(PAYMENT_COLUMNS)
        .maybeSingle();
      if (error) throw error;
      return readPayment(data as Record<string, unknown> | null);
    },

    async markPaymentRefundPending({ paymentId, gatewayPaymentId, reason, at }) {
      // Money arrived for a booking that will never be delivered (cancelled or
      // gone). The row is parked in the most honest state the existing CHECK
      // allows: NOT confirmed, with the gateway payment id recorded so the money
      // is traceable, and `refund_status = 'PENDING'` meaning a refund is owed
      // and has not been issued.
      //
      // `captured_at` is deliberately left unset: this payment was never
      // confirmed for a booking, and the real capture time is on the
      // `CAPTURE_AFTER_BOOKING_CLOSED` event. Scoped to the in-flight states so
      // it can never overwrite a confirmed or already-refunded payment.
      const { data, error } = await admin
        .from('payments')
        .update({
          status: 'FAILED',
          razorpay_payment_id: gatewayPaymentId,
          refund_status: 'PENDING',
          failure_reason: reason.slice(0, 500),
          updated_at: at,
        })
        .eq('id', paymentId)
        .in('status', ['PAYMENT_PROCESSING', 'PAYMENT_PENDING'])
        .select(PAYMENT_COLUMNS)
        .maybeSingle();
      if (error) throw error;
      return readPayment(data as Record<string, unknown> | null);
    },

    async markPaymentCaptured({ paymentId, gatewayPaymentId, signature, capturedAt, payload }) {
      // Scoped to the in-flight state: a second capture finds no matching row
      // and is reported as a duplicate rather than overwriting the first.
      const { data, error } = await admin
        .from('payments')
        .update({
          status: 'VERIFIED',
          razorpay_payment_id: gatewayPaymentId,
          razorpay_signature: signature,
          captured_at: capturedAt,
          verified_at: capturedAt,
          failure_reason: null,
          gateway_payload: payload,
          updated_at: capturedAt,
        })
        .eq('id', paymentId)
        .eq('status', 'PAYMENT_PROCESSING')
        .select(PAYMENT_COLUMNS)
        .maybeSingle();
      if (error) throw error;
      return readPayment(data as Record<string, unknown> | null);
    },

    async markPaymentAlreadyCaptured({ paymentId, gatewayPaymentId, capturedAt }) {
      // Only fills a gap: a row that is already VERIFIED but has not recorded
      // the gateway payment id yet (an interrupted first attempt).
      const { data, error } = await admin
        .from('payments')
        .update({
          razorpay_payment_id: gatewayPaymentId,
          captured_at: capturedAt,
          verified_at: capturedAt,
          updated_at: capturedAt,
        })
        .eq('id', paymentId)
        .eq('status', 'VERIFIED')
        .is('razorpay_payment_id', null)
        .select(PAYMENT_COLUMNS)
        .maybeSingle();
      if (error) throw error;
      return readPayment(data as Record<string, unknown> | null);
    },

    async markPaymentFailed({ paymentId, reason, at }) {
      const { data, error } = await admin
        .from('payments')
        .update({ status: 'FAILED', failure_reason: reason.slice(0, 500), updated_at: at })
        .eq('id', paymentId)
        .in('status', ['PAYMENT_PROCESSING', 'PAYMENT_PENDING'])
        .select(PAYMENT_COLUMNS)
        .maybeSingle();
      if (error) throw error;
      return readPayment(data as Record<string, unknown> | null);
    },

    async markBookingMentorPending(bookingId, at) {
      // The gate the mentor notification hangs off. Only one caller can move
      // the booking out of a payable state, so only one notification is sent.
      const { data, error } = await admin
        .from('bookings')
        .update({ status: 'MENTOR_PENDING', updated_at: at })
        .eq('id', bookingId)
        .in('status', ['PAYMENT_PENDING', 'PAYMENT_PROCESSING'])
        .select('id')
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },

    async recordRefund({ paymentId, refundId, refundStatus, at }) {
      // A refund must NEVER advance the payment's own status into a confirmed
      // one. A `refund.created` event can arrive for an order whose payment was
      // authorized but never captured, and writing VERIFIED here would confirm a
      // payment no money was ever received for. A pending refund therefore only
      // records bookkeeping columns.
      const bookkeeping = { refund_id: refundId, refund_status: refundStatus, updated_at: at };

      if (refundStatus === 'PENDING') {
        const { data, error } = await admin
          .from('payments')
          .update(bookkeeping)
          .eq('id', paymentId)
          .select('id')
          .maybeSingle();
        if (error) throw error;
        return !!data;
      }

      // Money is (or is not) back. Only a payment that was genuinely captured
      // may move to a refunded state, so the transition is scoped to VERIFIED
      // and a still-uncaptured payment is left alone.
      const { data, error } = await admin
        .from('payments')
        .update({
          ...bookkeeping,
          status: refundStatus === 'REFUNDED' ? 'REFUNDED' : 'REFUND_FAILED',
        })
        .eq('id', paymentId)
        .eq('status', 'VERIFIED')
        .select('id')
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },

    async insertPaymentEvent(event: PaymentEventInput) {
      const { error } = await admin.from('payment_events').insert({
        payment_id: event.paymentId,
        status: event.status,
        event_type: event.eventType,
        gateway: event.gateway,
        gateway_payment_id: event.gatewayPaymentId,
        amount_inr: event.amountInr,
        reason: event.reason,
        created_by: event.actorId,
        created_at: event.at,
      });
      // An audit-log write must never fail the payment it describes.
      if (error) console.error('Failed to record payment event:', error.message);
    },

    async claimWebhookEvent({ eventId, eventType, payload, at }) {
      // The insert is the fast path for a first delivery.
      const { error } = await admin.from('webhook_events').insert({
        gateway: RAZORPAY_GATEWAY,
        event_id: eventId,
        event_type: eventType,
        payload,
        processed: false,
        created_at: at,
      });

      if (!error) return 'new';
      // Anything other than the uniqueness violation is a real fault.
      if (error.code !== '23505') throw error;

      // Already recorded, so read the `processed` flag that the Phase 1 schema
      // provides for exactly this purpose. A completed delivery is skipped; one
      // that failed part-way is RESUMED, because every write in the gateway
      // flow is a conditional update and re-applying it is a no-op. Collapsing
      // these two cases would silently discard a real captured payment.
      const { data, error: readErr } = await admin
        .from('webhook_events')
        .select('processed')
        .eq('gateway', RAZORPAY_GATEWAY)
        .eq('event_id', eventId)
        .maybeSingle();
      if (readErr) throw readErr;
      // The row vanished between the conflict and the read: treat as new.
      if (!data) return 'new';
      return data.processed ? 'duplicate' : 'resume';
    },

    async completeWebhookEvent(eventId, at) {
      const { error } = await admin
        .from('webhook_events')
        .update({ processed: true, processed_at: at })
        .eq('gateway', RAZORPAY_GATEWAY)
        .eq('event_id', eventId);
      if (error) console.error('Failed to mark webhook event processed:', error.message);
    },
  };
}
