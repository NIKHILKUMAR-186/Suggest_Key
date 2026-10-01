/**
 * Client bridge for the coupon endpoints.
 *
 * Two calls only, because two calls is all there is:
 *
 *   applyCouponToBooking  POST   /api/seeker/bookings/:id/coupon  { code }
 *   removeCouponFromBooking DELETE /api/seeker/bookings/:id/coupon
 *
 * The client NEVER computes or sends a price, a discount, a coupon id or the
 * seeker's identity. The server RPC owns all of that under row locks, so there
 * is nothing to keep in sync here and no way for the page to show an amount the
 * database does not agree with.
 *
 * The booking's own pricing fields are the response, so the caller simply
 * replaces its booking state with what came back rather than re-deriving
 * anything locally.
 */
import { apiFetch } from './apiClient';
import type { Booking } from '@/src/types/database';

/**
 * The pricing half of a booking, as the coupon endpoints return it.
 *
 * A structural subset rather than `Booking` so a caller can render a coupon
 * summary from it alone. The snapshot columns are declared required here even
 * though `Booking` has them optional: these endpoints ARE the coupon RPCs, and a
 * row without the snapshot could not be repriced at all. `base_amount_inr` and
 * `amount_inr` are what make `amount_inr === base - discount` checkable.
 */
export type BookingPricing = Pick<
  Booking,
  'id' | 'booking_code' | 'status' | 'amount_inr' | 'coupon_id'
> & {
  base_amount_inr: number;
  discount_amount_inr: number;
  original_amount_inr: number | null;
  coupon_code: string | null;
};

export interface CouponResult {
  success: boolean;
  booking: BookingPricing | null;
  error?: { code: string; message: string };
}

const FAILURE: CouponResult = {
  success: false,
  booking: null,
  error: { code: 'COUPON_FAILED', message: 'We could not update the coupon on this booking.' },
};

/**
 * Applies (or replaces) a coupon.
 *
 * A server refusal is returned as-is rather than thrown: "that coupon has been
 * fully claimed" is a message the page must render next to the input, not an
 * exception. `error.code` is stable, so the page can also tell a limit reached
 * apart from a generic failure.
 */
export async function applyCouponToBooking(bookingId: string, code: string): Promise<CouponResult> {
  try {
    const res = await apiFetch(`/api/seeker/bookings/${encodeURIComponent(bookingId)}/coupon`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // A trimmed code only. An empty one cannot reach here: the caller should
      // treat it as "remove" instead of asking the server to reject it.
      body: JSON.stringify({ code: code.trim().toUpperCase() }),
    });
    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.success) {
      return {
        success: false,
        booking: null,
        error: data?.error ?? FAILURE.error!,
      };
    }
    return { success: true, booking: data.booking ?? null };
  } catch {
    return FAILURE;
  }
}

/**
 * Removes the coupon and restores the base amount.
 *
 * Kept as its own call because a coupon archived after it was reserved must
 * still be removable: the server restores the base without re-validating the
 * code.
 */
export async function removeCouponFromBooking(bookingId: string): Promise<CouponResult> {
  try {
    const res = await apiFetch(`/api/seeker/bookings/${encodeURIComponent(bookingId)}/coupon`, {
      method: 'DELETE',
    });
    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.success) {
      return { success: false, booking: null, error: data?.error ?? FAILURE.error! };
    }
    return { success: true, booking: data.booking ?? null };
  } catch {
    return FAILURE;
  }
}
