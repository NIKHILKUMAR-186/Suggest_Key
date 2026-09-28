/**
 * Post-booking payment proof rules.
 *
 * Everything here is PURE so the browser and the Express server share one
 * definition of "a usable payment proof", and so the rules are unit testable
 * without a database. Nothing in this module invents a value (no generated
 * UTR, no default amount): it only accepts or rejects what the user supplied.
 *
 * The constants mirror the LIVE database, not a migration file:
 *   - bucket `payment-proofs`: private, 5MB, image/jpeg|png|webp
 *   - `payments.status`: PENDING_VERIFICATION | VERIFIED | REJECTED
 *   - `bookings.status`: PAYMENT_PENDING -> PENDING_VERIFICATION -> MENTOR_PENDING
 */

/** The existing private Supabase bucket. Never make this public. */
export const PAYMENT_PROOF_BUCKET = 'payment-proofs';

/** Matches the bucket's own `file_size_limit`. */
export const PAYMENT_PROOF_MAX_BYTES = 5 * 1024 * 1024;

/**
 * The limit as shown to the user. Derived from the real byte ceiling rather
 * than written by hand, so the message can never drift from the actual limit.
 */
export const PAYMENT_PROOF_MAX_LABEL = `${PAYMENT_PROOF_MAX_BYTES / (1024 * 1024)} MB`;

/**
 * A subset of the bucket's allowed MIME types. `application/pdf` is allowed by
 * the bucket but excluded here on purpose: this flow asks for a payment
 * *screenshot* that an admin can read the UTR off.
 */
export const PAYMENT_PROOF_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export type PaymentProofMimeType = (typeof PAYMENT_PROOF_MIME_TYPES)[number];

/**
 * The public, admin-managed payment QR shown to seekers.
 *
 * This is a different asset from the proof bucket above and is deliberately
 * PUBLIC: the QR and the UPI id are instructions a payer is meant to read, so
 * they hold no secret. Only writes are restricted, to admins. It lives in its
 * own bucket because "everyone can read this" and "each seeker can only read
 * their own receipts" are opposite policies and cannot share one bucket.
 */
export const PAYMENT_QR_BUCKET = 'payment-qr';

/** Mirrors the `payment-qr` bucket's own `allowed_mime_types`. */
export const PAYMENT_QR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export type PaymentQrMimeType = (typeof PAYMENT_QR_MIME_TYPES)[number];

/** Matches the bucket's `file_size_limit` (2 MB). */
export const PAYMENT_QR_MAX_BYTES = 2 * 1024 * 1024;

/** Derived from the real byte ceiling so the message cannot drift from the limit. */
export const PAYMENT_QR_MAX_LABEL = `${PAYMENT_QR_MAX_BYTES / (1024 * 1024)} MB`;

/** The payment status a freshly submitted proof must carry. */
export const PAYMENT_STATUS_PENDING = 'PENDING_VERIFICATION';

/** Booking created, awaiting any payment attempt (manual or gateway). */
export const PAYMENT_STATUS_PAYMENT_PENDING = 'PAYMENT_PENDING';

/** Gateway payment is in flight (Razorpay processing). */
export const PAYMENT_STATUS_PAYMENT_PROCESSING = 'PAYMENT_PROCESSING';

/** Gateway payment failed or was rejected by the bank. */
export const PAYMENT_STATUS_FAILED = 'FAILED';

/** Full refund issued through the gateway. */
export const PAYMENT_STATUS_REFUNDED = 'REFUNDED';

/** Refund attempt failed. */
export const PAYMENT_STATUS_REFUND_FAILED = 'REFUND_FAILED';

/**
 * Validates a payment QR image before it is uploaded.
 *
 * `application/pdf` is allowed by neither this check nor the bucket: a QR must
 * be scannable straight off the seeker's screen.
 */
export function validateQrFile(file: ProofFileLike | null | undefined): Validated<ProofFileLike> {
  if (!file) {
    return { ok: false, message: 'Select a payment QR image.' };
  }
  if (file.size <= 0) {
    return { ok: false, message: 'That file is empty.' };
  }
  if (!PAYMENT_QR_MIME_TYPES.includes(file.type as PaymentQrMimeType)) {
    return { ok: false, message: 'Upload a PNG, JPEG or WebP image.' };
  }
  if (file.size > PAYMENT_QR_MAX_BYTES) {
    return { ok: false, message: `That image is larger than ${PAYMENT_QR_MAX_LABEL}.` };
  }
  return { ok: true, value: file };
}

/**
 * UPI handle shape: a local part of 2+ word characters, an `@`, and a provider
 * handle. Deliberately shape-only - it rejects obvious typos without claiming
 * to know which handles are actually registered on a UPI provider.
 */
export function validateUpiId(raw: unknown): Validated<string> {
  if (typeof raw !== 'string') {
    return { ok: false, message: 'Enter a UPI ID, for example name@bank.' };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, message: 'Enter a UPI ID, for example name@bank.' };
  }
  if (trimmed.length > 120) {
    return { ok: false, message: 'That UPI ID is too long.' };
  }
  if (!/^[A-Za-z0-9._-]{2,}@[A-Za-z0-9-]{1,}$/.test(trimmed)) {
    return { ok: false, message: 'Enter a valid UPI ID, for example name@bank.' };
  }
  return { ok: true, value: trimmed };
}

/**
 * Booking statuses that still accept a payment proof.
 *
 * `PAYMENT_PENDING` is the state a booking is created in; `PENDING_VERIFICATION`
 * is where it sits after a first submission. A booking that advanced to
 * MENTOR_PENDING/CONFIRMED, or ended as CANCELLED/REJECTED/COMPLETED, is no
 * longer payable.
 */
export const PAYABLE_BOOKING_STATUSES = ['PAYMENT_PENDING', 'PENDING_VERIFICATION'] as const;

export interface ProofFileLike {
  name: string;
  type: string;
  size: number;
}

export type Validated<T> = { ok: true; value: T } | { ok: false; message: string };

/** UTRs are provider-issued identifiers: digits, letters, dash, underscore. */
const TRANSACTION_REFERENCE_PATTERN = /^[A-Za-z0-9_-]+$/;
const TRANSACTION_REFERENCE_MIN = 4;
const TRANSACTION_REFERENCE_MAX = 64;

/**
 * Validates the user-entered UTR / transaction reference.
 *
 * The field is always rendered EMPTY. No branch here can produce a reference,
 * because fabricating one would let a proof pass validation for a payment that
 * never happened.
 */
export function normaliseTransactionReference(raw: unknown): Validated<string> {
  if (typeof raw !== 'string') {
    return { ok: false, message: 'Enter the transaction UTR / reference ID from your payment receipt.' };
  }

  const trimmed = raw.trim();

  if (!trimmed) {
    return { ok: false, message: 'Enter the transaction UTR / reference ID from your payment receipt.' };
  }
  if (trimmed.length < TRANSACTION_REFERENCE_MIN) {
    return { ok: false, message: `That reference is too short. Use the full reference from your receipt (at least ${TRANSACTION_REFERENCE_MIN} characters).` };
  }
  if (trimmed.length > TRANSACTION_REFERENCE_MAX) {
    return { ok: false, message: `That reference is too long. A UTR / reference ID is at most ${TRANSACTION_REFERENCE_MAX} characters.` };
  }
  if (!TRANSACTION_REFERENCE_PATTERN.test(trimmed)) {
    return { ok: false, message: 'Use only letters, numbers, hyphens and underscores — copy the reference exactly as it appears on your receipt.' };
  }

  return { ok: true, value: trimmed };
}

/** Validates a selected screenshot before anything is uploaded. */
export function validateProofFile(file: ProofFileLike | null | undefined): Validated<ProofFileLike> {
  if (!file) {
    return { ok: false, message: 'Select your payment screenshot.' };
  }
  if (file.size <= 0) {
    return { ok: false, message: 'That file is empty. Select the screenshot you took of your payment receipt.' };
  }
  if (!PAYMENT_PROOF_MIME_TYPES.includes(file.type as PaymentProofMimeType)) {
    return { ok: false, message: 'Please upload a PNG, JPG, or WebP image.' };
  }
  if (file.size > PAYMENT_PROOF_MAX_BYTES) {
    return {
      ok: false,
      message: `This screenshot is larger than the supported limit. Please upload an image smaller than ${PAYMENT_PROOF_MAX_LABEL}.`,
    };
  }
  return { ok: true, value: file };
}

/** A booking accepts payment while it sits in one of these states. */
export function isPayableBookingStatus(status: unknown): boolean {
  return typeof status === 'string' && (PAYABLE_BOOKING_STATUSES as readonly string[]).includes(status);
}

/**
 * Strips a client-supplied filename down to something safe to append to a
 * storage path, so `../../etc/passwd` or a Windows path can never influence the
 * object key. Always prefixed with a server-generated random name.
 */
export function sanitiseProofFileName(fileName: unknown): string {
  const base = typeof fileName === 'string' ? fileName : '';
  const leaf = base.split(/[\\/]/).pop() || '';
  const cleaned = leaf.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[.-]+/, '').slice(0, 60);
  return cleaned || 'proof.png';
}

/**
 * Builds the object key for a payment proof:
 *   `<seekerId>/<bookingId>/<random>-<safeName>`
 *
 * The leading folder is the owning seeker on purpose — the live storage RLS
 * policy for this bucket is `storage.foldername(name)[1] = auth.uid()`, and the
 * project's existing convention (mentor verification documents) is identical.
 * The random segment stops a re-submission from overwriting the previous proof
 * while that proof may still be under review.
 */
export function buildProofStoragePath(
  seekerId: string,
  bookingId: string,
  fileName: unknown,
  uniquePart: string,
): string {
  return `${seekerId}/${bookingId}/${uniquePart}-${sanitiseProofFileName(fileName)}`;
}

/** Decodes a browser-sent data URL / base64 payload into raw bytes. */
export function decodeBase64Image(dataUrl: string): Buffer | null {
  if (typeof dataUrl !== 'string' || !dataUrl) return null;

  // A data URL is handled strictly. Without the strict branch below, the empty
  // payload of `data:image/png;base64,` would fall through and be decoded as if
  // the literal header text were the image itself.
  const match = /^data:([A-Za-z0-9/+.-]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (match) {
    if (!match[2]) return null;
    const fromDataUrl = Buffer.from(match[2], 'base64');
    return fromDataUrl.length > 0 ? fromDataUrl : null;
  }

  // A bare base64 payload (no data URL header) is also accepted.
  const buffer = Buffer.from(dataUrl, 'base64');
  // Buffer.from silently drops invalid characters, so an empty result means the
  // client did not actually send an image.
  return buffer.length > 0 ? buffer : null;
}

/** Formats a byte count for the file chip, e.g. 245 KB. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
