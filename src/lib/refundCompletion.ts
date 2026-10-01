/**
 * Manual refund COMPLETION rules.
 *
 * A manual UPI/QR payment is paid outside the application. Nothing here moves
 * money and nothing here invents evidence: an admin completes a refund only
 * after they have actually transferred the money and can show the UTR and the
 * screenshot. That is why every field is required and nothing is defaulted.
 *
 * Pure module: the browser and the Express server import the same rules, and the
 * unit tests run them with no database. The authoritative re-check of the money
 * rules still happens inside the `complete_manual_refund` SQL function; this is
 * the fast, friendly layer, never the security boundary.
 */

import {
  PAYMENT_PROOF_MAX_BYTES,
  PAYMENT_PROOF_MIME_TYPES,
  normaliseTransactionReference,
  sanitiseProofFileName,
  type ProofFileLike,
  type Validated,
} from './paymentProof';

/**
 * The manual-payment refund rails the product actually supports.
 *
 * Closed set on purpose: this is an allow-list matched by a CHECK constraint in
 * the migration and re-checked in the RPC, so an unrecognised method can never
 * reach the database. Nothing outside this list is offered, because the payment
 * configuration only ever collects a UPI id for the inbound leg.
 */
export const REFUND_METHODS = ['UPI', 'BANK_TRANSFER'] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];

/** Human label for the admin form. Derived from the value, never a second list. */
export const refundMethodLabel = (method: string): string =>
  method === 'BANK_TRANSFER' ? 'Bank transfer' : 'UPI';

/**
 * What the admin sees for a stored `refund_status`.
 *
 * The stored value `REFUNDED` is the database's word for "completed"; `PENDING`
 * and `FAILED` read the same either way. `COMPLETED` is used in the UI because
 * "REFUNDED" next to a payment status of "REFUNDED" says the same thing twice.
 */
export function refundStatusLabel(status: string): string {
  if (status === 'REFUNDED') return 'COMPLETED';
  if (status === 'PENDING') return 'PENDING';
  if (status === 'FAILED') return 'FAILED';
  return status;
}

/** Matches `payment-proofs`' own `file_size_limit`. */
export const REFUND_PROOF_MAX_BYTES = PAYMENT_PROOF_MAX_BYTES;
export const REFUND_PROOF_MAX_LABEL = `${REFUND_PROOF_MAX_BYTES / (1024 * 1024)} MB`;

/**
 * Where a refund proof lives inside the EXISTING private `payment-proofs`
 * bucket.
 *
 * `refunds/<paymentId>/...` is chosen so the bucket's existing seeker read
 * policy (`storage.foldername(name)[1] = auth.uid()`) can never match it: the
 * first folder is the literal word `refunds`, which is not a user id. Only the
 * admin `FOR ALL ... is_admin()` policy reaches these objects. No new bucket, no
 * new policy, and no existing bucket is made public or private as a side effect.
 */
export const REFUND_PROOF_PATH_PREFIX = 'refunds';

/** Rejects anything that is not one of the two supported rails. */
export function normaliseRefundMethod(raw: unknown): Validated<RefundMethod> {
  if (typeof raw !== 'string') {
    return { ok: false, message: 'Choose how the refund was sent.' };
  }
  const trimmed = raw.trim().toUpperCase();
  if (!(REFUND_METHODS as readonly string[]).includes(trimmed)) {
    return { ok: false, message: 'Choose either UPI or bank transfer.' };
  }
  return { ok: true, value: trimmed as RefundMethod };
}

/**
 * Validates the external refund reference / UTR.
 *
 * Delegates to the payment-proof rule rather than restating it: the same shape
 * that identifies an inbound UTR identifies an outbound one. The field is
 * always rendered EMPTY and no branch here can produce a value — a fabricated
 * UTR would make a refund that never happened look settled.
 */
export function normaliseRefundReference(raw: unknown): Validated<string> {
  return normaliseTransactionReference(raw);
}

/** Converts rupees to the integer paise the `refund_amount_paise` column stores. */
export function toPaise(amountInr: number): number {
  return Math.round(amountInr * 100);
}

/** The inverse, for rendering a stored paise amount back to the admin. */
export const fromPaise = (paise: number | null | undefined): number | null =>
  typeof paise === 'number' && Number.isFinite(paise) ? paise / 100 : null;

/**
 * Validates the refund amount against the original payment amount.
 *
 * Rejects NaN, Infinity, zero and negatives before it compares anything, because
 * `NaN <= x` is false and would otherwise sail past a naive bound check.
 *
 * The product does NOT support partial refunds — `docs/prd.md` lists them as
 * unimplemented and the gateway refund path is explicitly full-amount — so the
 * only accepted value is the full original amount. The upper bound is still
 * checked separately and reported as its own error, so a future partial-refund
 * feature fails loudly here rather than silently over-refunding.
 */
export function normaliseRefundAmount(
  rawAmountInr: unknown,
  originalAmountInr: number,
): Validated<number> {
  if (typeof rawAmountInr !== 'number' || !Number.isFinite(rawAmountInr)) {
    return { ok: false, message: 'Enter the refund amount as a number.' };
  }
  if (rawAmountInr <= 0) {
    return { ok: false, message: 'The refund amount must be more than zero.' };
  }

  const refundPaise = toPaise(rawAmountInr);
  const originalPaise = toPaise(Number(originalAmountInr ?? 0));

  if (!Number.isSafeInteger(refundPaise) || refundPaise <= 0) {
    return { ok: false, message: 'The refund amount must be more than zero.' };
  }
  if (refundPaise > originalPaise) {
    return {
      ok: false,
      message: `The refund amount cannot be more than the ${formatInrLabel(originalAmountInr)} that was paid.`,
    };
  }
  if (refundPaise !== originalPaise) {
    return {
      ok: false,
      message: `Only a full refund of ${formatInrLabel(originalAmountInr)} is supported for this payment.`,
    };
  }
  return { ok: true, value: refundPaise / 100 };
}

/** `₹1,234` — matches the existing payment notification/UI formatting. */
export function formatInrLabel(amountInr: number | null | undefined): string {
  const value = Number(amountInr ?? 0);
  return `₹${(Number.isFinite(value) ? value : 0).toLocaleString('en-IN')}`;
}

/**
 * Validates the refund proof file.
 *
 * Same MIME allowlist and same byte ceiling as a payment proof: an image of the
 * bank/UPI confirmation receipt. The bucket enforces both again server-side.
 */
export function validateRefundProofFile(file: ProofFileLike | null | undefined): Validated<ProofFileLike> {
  if (!file) {
    return { ok: false, message: 'Attach the refund receipt as proof.' };
  }
  if (file.size <= 0) {
    return { ok: false, message: 'That file is empty.' };
  }
  if (!PAYMENT_PROOF_MIME_TYPES.includes(file.type as (typeof PAYMENT_PROOF_MIME_TYPES)[number])) {
    return { ok: false, message: 'Upload a PNG, JPG, or WebP image.' };
  }
  if (file.size > REFUND_PROOF_MAX_BYTES) {
    return { ok: false, message: `That image is larger than ${REFUND_PROOF_MAX_LABEL}.` };
  }
  return { ok: true, value: file };
}

/**
 * Builds the object key for a refund proof:
 *   `refunds/<paymentId>/<random>-<safeName>`
 *
 * The filename is sanitised and a server-generated random segment is prefixed, so
 * a client cannot influence the folder and a re-upload never overwrites the
 * proof of a previous attempt.
 */
export function buildRefundProofStoragePath(
  paymentId: string,
  fileName: unknown,
  uniquePart: string,
): string {
  return `${REFUND_PROOF_PATH_PREFIX}/${paymentId}/${uniquePart}-${sanitiseProofFileName(fileName)}`;
}

/**
 * True only when `path` is a well-formed refund-proof key for `paymentId`.
 *
 * A trailing filename is mandatory, so `refunds/<id>/` (a folder, not an object)
 * is refused — otherwise the storage listing in the completion route would look
 * up an empty name and the row could record a path that holds no image.
 */
export function isRefundProofPathFor(paymentId: string, path: unknown): boolean {
  if (typeof path !== 'string' || !path) return false;
  if (path.length > 300) return false;
  if (path.includes('..') || path.includes('\\')) return false;
  const segments = path.split('/');
  const prefix = [REFUND_PROOF_PATH_PREFIX, paymentId];
  if (segments.length !== prefix.length + 1) return false;
  if (segments[0] !== prefix[0] || segments[1] !== prefix[1]) return false;
  return segments[2].length > 0;
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/** The payment/refund state this workflow operates on. */
export interface RefundablePaymentState {
  gateway: string | null;
  status: string | null;
  refundStatus: string | null;
  manualRefundRequired?: boolean | null;
}

/**
 * Whether an admin may open the "Process Refund" form for this payment.
 *
 * Requires all four: a manual UPI/QR payment (a gateway refund is settled by the
 * gateway's own events, never by this form), a payment that actually captured
 * money (`VERIFIED`), a refund that is owed (`PENDING`), and the manual marker
 * set when the cancellation queued it. A completed or failed refund is refused,
 * so the action cannot be offered twice.
 */
export function canProcessManualRefund(payment: RefundablePaymentState): boolean {
  return (
    (payment.gateway ?? 'manual') === 'manual' &&
    payment.status === 'VERIFIED' &&
    payment.refundStatus === 'PENDING' &&
    payment.manualRefundRequired === true
  );
}

// ---------------------------------------------------------------------------
// Seeker notification copy
// ---------------------------------------------------------------------------

export type RefundNoticeKind = 'MANUAL_PENDING' | 'GATEWAY_PENDING' | 'COMPLETED' | 'FAILED';

export interface RefundNotice {
  title: string;
  message: string;
  eventType: 'REFUND_PENDING' | 'REFUND_COMPLETED' | 'REFUND_FAILED';
}

/**
 * The one place refund wording is decided.
 *
 * A refund is only ever described as COMPLETED once the state transition says
 * so. While it is still PENDING the copy says exactly that, and nothing claims a
 * refund was initiated: this application has no generic refund-initiation API
 * for a manual payment, and a gateway refund is not confirmed until the gateway
 * says so.
 */
export function refundNotice(
  kind: RefundNoticeKind,
  input: { amountInr?: number | null; bookingCode?: string | null; refundMethod?: string | null; refundReference?: string | null } = {},
): RefundNotice {
  const amount = typeof input.amountInr === 'number' && Number.isFinite(input.amountInr)
    ? input.amountInr
    : null;
  const amountLabel = amount === null ? null : formatInrLabel(amount);
  const codeSuffix = input.bookingCode ? ` for booking ${input.bookingCode}` : '';
  // "Your refund" when the amount is unknown; "Your ₹499 refund" when it is known.
  const subject = amountLabel ? `Your ${amountLabel} refund${codeSuffix}` : `Your refund${codeSuffix}`;

  switch (kind) {
    case 'MANUAL_PENDING':
      return {
        title: 'Refund Pending',
        message: `${subject} is pending admin processing. You will be notified once the refund is completed.`,
        eventType: 'REFUND_PENDING',
      };

    case 'GATEWAY_PENDING':
      return {
        title: 'Refund Pending',
        message: `${subject} is pending processing. You will be notified once the refund is confirmed.`,
        eventType: 'REFUND_PENDING',
      };

    case 'COMPLETED': {
      const method = input.refundMethod
        ? ` It was sent by ${refundMethodLabel(input.refundMethod).toLowerCase()}.`
        : '';
      const reference = input.refundReference ? ` Reference: ${input.refundReference}.` : '';
      return {
        title: 'Refund Completed',
        message: `${subject} has been completed.${method}${reference}`,
        eventType: 'REFUND_COMPLETED',
      };
    }

    case 'FAILED':
      return {
        title: 'Refund Failed',
        message: `${subject} could not be completed. Our team is looking into it and will update you here.`,
        eventType: 'REFUND_FAILED',
      };
  }
}
