/**
 * Shared admin payment view model (audit P2-5).
 *
 * The admin payment queue and the admin payments page both need to agree on what
 * a "payment" looks like, and both need the gateway/refund state that used to be
 * selected by `select *` but never projected. One projection, one set of rules.
 *
 * Nothing here writes, refunds, or reconciles. It is a read model.
 */

export type AdminPaymentStatus =
  | 'PENDING_VERIFICATION'
  | 'VERIFIED'
  | 'REJECTED'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_PROCESSING'
  | 'FAILED'
  | 'REFUNDED'
  | 'REFUND_FAILED';

export type RefundStatus = 'PENDING' | 'FAILED' | 'REFUNDED';

export interface AdminPaymentRow {
  id: string;
  bookingId: string;
  bookingCode: string | null;
  bookingStatus: string | null;
  seekerName: string | null;
  mentorName: string | null;
  gigTitle: string | null;
  amount: number;
  submittedAt: string | null;
  status: AdminPaymentStatus;
  transactionReference: string | null;
  proofUrl: string | null;
  rejectionReason: string | null;
  verifiedAt: string | null;
  /** 'manual' for UPI/QR, 'razorpay' for the optional gateway. */
  gateway: string;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  refundStatus: RefundStatus | null;
  refundId: string | null;
  failureReason: string | null;
}

/** The raw `payments` columns this view reads. */
export interface AdminPaymentSource {
  id: string;
  booking_id: string;
  amount_inr: number;
  created_at: string | null;
  status: AdminPaymentStatus;
  transaction_reference?: string | null;
  proof_storage_path?: string | null;
  rejection_reason?: string | null;
  verified_at?: string | null;
  gateway?: string | null;
  razorpay_order_id?: string | null;
  razorpay_payment_id?: string | null;
  refund_status?: RefundStatus | null;
  refund_id?: string | null;
  failure_reason?: string | null;
  booking?: {
    booking_code?: string | null;
    status?: string | null;
    seeker_id?: string | null;
    mentor_id?: string | null;
    gig_id?: string | null;
  } | null;
}

/**
 * A refund the platform owes but has not issued.
 *
 * `refund_status` is a column separate from `status`: a VERIFIED payment can
 * still be owed a refund. Only PENDING counts as owed — FAILED and REFUNDED are
 * terminal for this filter.
 */
export const isRefundOwed = (p: AdminPaymentRow) => p.refundStatus === 'PENDING';

/**
 * Projects a raw `payments` row plus its joined booking into the admin view.
 *
 * `names` is supplied by the caller because resolving profiles is an async
 * concern; anything that cannot be resolved stays null rather than being
 * defaulted into a fake value.
 *
 * The gateway signature is deliberately NOT part of the projection.
 */
export const projectAdminPayment = (
  p: AdminPaymentSource,
  names: {
    seekerName?: string | null;
    mentorName?: string | null;
    gigTitle?: string | null;
    proofUrl?: string | null;
  } = {},
): AdminPaymentRow => ({
  id: p.id,
  bookingId: p.booking_id,
  bookingCode: p.booking?.booking_code ?? null,
  bookingStatus: p.booking?.status ?? null,
  seekerName: p.booking?.seeker_id ? names.seekerName ?? null : null,
  mentorName: p.booking?.mentor_id ? names.mentorName ?? null : null,
  gigTitle: p.booking?.gig_id ? names.gigTitle ?? null : null,
  amount: p.amount_inr,
  transactionReference: p.transaction_reference ?? null,
  submittedAt: p.created_at ?? null,
  status: p.status,
  proofUrl: names.proofUrl ?? null,
  rejectionReason: p.rejection_reason ?? null,
  verifiedAt: p.verified_at ?? null,
  // A manual UPI/QR row has no gateway column set at all, so it is reported as
  // 'manual' rather than leaking a null into the UI.
  gateway: p.gateway ?? 'manual',
  razorpayOrderId: p.razorpay_order_id ?? null,
  razorpayPaymentId: p.razorpay_payment_id ?? null,
  refundStatus: p.refund_status ?? null,
  refundId: p.refund_id ?? null,
  failureReason: p.failure_reason ?? null,
});
