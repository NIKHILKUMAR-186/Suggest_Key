/**
 * Client bridge for the post-booking payment proof flow.
 *
 * The screenshot is uploaded straight to the private Supabase bucket, exactly
 * as the mentor verification documents already do, and the API then receives
 * only a small metadata envelope. The browser never writes to `payments`; the
 * server still decides ownership, payability, amount and status.
 *
 * Sending the image inline as base64 JSON made every request ~33% larger than
 * the file and blew past the platform request-size limit (HTTP 413). Uploading
 * to storage directly keeps the API request a few hundred bytes and lets the
 * bucket's own 5MB limit apply to the image.
 */
import { apiFetch } from './apiClient';
import { supabase, isSupabaseConfigured } from './supabase';
import { PAYMENT_PROOF_BUCKET, buildProofStoragePath, validateProofFile } from './paymentProof';
import type { Payment, BookingStatus } from '@/src/types/database';

export interface SubmitPaymentProofRequest {
  bookingId: string;
  transactionReference: string;
  file: File;
  /** The signed-in seeker; the storage path is rooted at this id. */
  seekerId: string;
}

export interface SubmitPaymentProofResponse {
  success: boolean;
  payment: Payment | null;
  booking: { id: string; booking_code: string; status: BookingStatus; amount_inr: number } | null;
  error?: { code: string; message: string; field?: string };
}

export interface PaymentStateResponse {
  success: boolean;
  payment: Payment | null;
  booking: { id: string; booking_code: string; status: BookingStatus; amount_inr: number } | null;
  error?: { code: string; message: string };
}

/** A short random token; the browser cannot import node's crypto.randomUUID. */
function randomToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Uploads the screenshot to the private `payment-proofs` bucket.
 *
 * The object key is `<seekerId>/<bookingId>/<random>-<file>`, which is the
 * layout the live storage RLS policy requires (first folder = auth.uid()) and
 * the convention the rest of the project already uses. Supabase Storage
 * enforces that policy, so this cannot write into another seeker's folder.
 *
 * Returns the stored object path, or a user-facing error message.
 */
export async function uploadPaymentProofFile(
  request: SubmitPaymentProofRequest,
): Promise<{ ok: true; storagePath: string } | { ok: false; message: string }> {
  const checked = validateProofFile({ name: request.file.name, type: request.file.type, size: request.file.size });
  if (!checked.ok) return { ok: false, message: checked.message };

  if (!isSupabaseConfigured()) {
    return { ok: false, message: 'Payment uploads are unavailable right now. Please try again shortly.' };
  }

  const storagePath = buildProofStoragePath(request.seekerId, request.bookingId, request.file.name, randomToken());

  const { error } = await supabase.storage
    .from(PAYMENT_PROOF_BUCKET)
    .upload(storagePath, request.file, {
      contentType: request.file.type,
      upsert: false,
      cacheControl: '3600',
    });

  if (error) {
    console.error('Payment proof upload failed:', error.message);
    // The bucket refuses anything over its 5MB limit, so surface that plainly
    // rather than as a generic failure.
    if (/exceed|too large|size/i.test(error.message)) {
      return { ok: false, message: 'This screenshot is larger than the supported limit. Please upload an image smaller than 5 MB.' };
    }
    return { ok: false, message: "We couldn't upload the payment proof. Please try again." };
  }

  return { ok: true, storagePath };
}

/**
 * Best-effort removal of an uploaded object.
 *
 * Used when the follow-up API call fails, so a rejected submission does not
 * leave an unreferenced file in the private bucket. Failures are swallowed:
 * cleanup must never turn a handled error into a crash.
 */
async function removeStoredProof(storagePath: string): Promise<void> {
  try {
    await supabase.storage.from(PAYMENT_PROOF_BUCKET).remove([storagePath]);
  } catch (err) {
    console.warn('Could not remove orphaned payment proof:', err);
  }
}


/**
 * Uploads the proof to storage, then records the payment.
 *
 * Two steps, mirroring the mentor verification document flow:
 *   1. the image goes straight to the private bucket (no API request, so no
 *      request-size ceiling to exceed);
 *   2. a small JSON envelope tells the API where the image landed.
 *
 * The returned `error` is always safe to show a user; a raw database or
 * network error is never surfaced to the page.
 */
export async function submitPaymentProof(
  request: SubmitPaymentProofRequest,
): Promise<SubmitPaymentProofResponse> {
  // ---- 1. Upload the image directly to storage --------------------------
  const uploaded = await uploadPaymentProofFile(request);
  if (!uploaded.ok) {
    return {
      success: false,
      payment: null,
      booking: null,
      error: { code: 'UPLOAD_FAILED', field: 'proof', message: uploaded.message },
    };
  }

  // ---- 2. Record the payment (metadata only, a few hundred bytes) --------
  let res: Response;
  try {
    res = await apiFetch(`/api/seeker/bookings/${encodeURIComponent(request.bookingId)}/payment-proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transactionReference: request.transactionReference,
        fileName: request.file.name,
        mimeType: request.file.type,
        fileSize: request.file.size,
        storagePath: uploaded.storagePath,
      }),
    });
  } catch {
    // The image is already stored, so remove it rather than leave an orphan.
    void removeStoredProof(uploaded.storagePath);
    return {
      success: false,
      payment: null,
      booking: null,
      error: { code: 'NETWORK_ERROR', message: 'We could not reach the payment service. Check your connection and try again.' },
    };
  }

  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok || !payload?.success) {
    // Best-effort cleanup so a failed submission does not leave an unreferenced
    // file sitting in the private bucket.
    void removeStoredProof(uploaded.storagePath);
    return {
      success: false,
      payment: payload?.payment ?? null,
      booking: payload?.booking ?? null,
      error: payload?.error ?? {
        code: res.status === 401 ? 'AUTH_REQUIRED' : 'SUBMISSION_FAILED',
        message: 'We could not submit your payment proof. Please try again.',
      },
    };
  }

  return {
    success: true,
    payment: payload.payment ?? null,
    booking: payload.booking ?? null,
  };
}

/** Loads the real current payment state for a booking. */
export async function fetchPaymentState(bookingId: string): Promise<PaymentStateResponse> {
  try {
    const res = await apiFetch(`/api/seeker/bookings/${encodeURIComponent(bookingId)}/payment-proof`);
    const data = await res.json();
    if (res.ok && data?.success) {
      return { success: true, payment: data.payment ?? null, booking: data.booking ?? null };
    }
    return {
      success: false,
      payment: null,
      booking: null,
      error: data?.error ?? { code: 'FETCH_FAILED', message: 'Could not load your payment status.' },
    };
  } catch {
    return {
      success: false,
      payment: null,
      booking: null,
      error: { code: 'NETWORK_ERROR', message: 'Could not load your payment status.' },
    };
  }
}
