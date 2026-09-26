/**
 * Client bridge for the post-booking payment proof flow.
 *
 * Every function here is a thin, typed wrapper over one server endpoint. The
 * browser never writes to `payments` or to storage itself: it sends the UTR and
 * the screenshot, and the server decides ownership, payability and the amount.
 */
import { apiFetch } from './apiClient';
import type { Payment, BookingStatus } from '@/src/types/database';

export interface SubmitPaymentProofRequest {
  bookingId: string;
  transactionReference: string;
  file: File;
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

/** Reads a File as a base64 data URL. Rejects rather than sending an empty body. */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('That screenshot could not be read. Please select it again.'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string' || !result.startsWith('data:')) {
        reject(new Error('That screenshot could not be read. Please select it again.'));
        return;
      }
      resolve(result);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Uploads the proof and records the payment.
 *
 * The returned `error` is the server's safe, user-facing message; a raw
 * database or network error is never surfaced to the page.
 */
export async function submitPaymentProof(
  request: SubmitPaymentProofRequest,
): Promise<SubmitPaymentProofResponse> {
  let fileBase64: string;
  try {
    fileBase64 = await readFileAsDataUrl(request.file);
  } catch (err: any) {
    return {
      success: false,
      payment: null,
      booking: null,
      error: { code: 'FILE_READ_FAILED', message: err?.message || 'That screenshot could not be read. Please select it again.' },
    };
  }

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
        fileBase64,
      }),
    });
  } catch {
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
