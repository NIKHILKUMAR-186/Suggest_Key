/**
 * Server-side Razorpay configuration.
 *
 * All three values come from environment variables and are read lazily so the
 * rest of the codebase can import this module without forcing a restart after
 * a secret is rotated in the environment.
 *
 * Secrets NEVER reach the client and NEVER land in the database. They are only
 * ever used server-side to create orders and to verify signatures.
 *
 * When the credentials are missing the helpers in `razorpayService.ts` fail
 * safely with a clear server error, and the existing manual payment flow is
 * unaffected because this module is only consulted by the Razorpay endpoints.
 */

import { APP_CONFIG } from '@/src/config/app';

/** Razorpay key id (public by design; it is safe to show in checkout). */
export function getRazorpayKeyId(): string {
  return (process.env.RAZORPAY_KEY_ID ?? '').trim();
}

/** Razorpay key secret. NEVER exposed to the client. */
export function getRazorpayKeySecret(): string {
  return (process.env.RAZORPAY_KEY_SECRET ?? '').trim();
}

/** Razorpay webhook secret. NEVER exposed to the client. */
export function getRazorpayWebhookSecret(): string {
  return (process.env.RAZORPAY_WEBHOOK_SECRET ?? '').trim();
}

/** True only when all three credentials are present and non-empty. */
export function isRazorpayConfigured(): boolean {
  return Boolean(getRazorpayKeyId() && getRazorpayKeySecret() && getRazorpayWebhookSecret());
}

/**
 * Feature flag gating the Razorpay integration.
 *
 * The integration can exist in the codebase without becoming the default
 * payment path until the Phase 3 frontend is ready. When the flag is unset
 * (the default) every Razorpay endpoint answers 503 and the manual flow is
 * untouched.
 *
 * Only the exact string `true` enables it.
 */
export function isRazorpayEnabled(): boolean {
  return String(process.env.RAZORPAY_ENABLED ?? '').trim().toLowerCase() === 'true';
}

/** Currency Razorpay orders are minted in. INR is the only supported value. */
export const RAZORPAY_CURRENCY = 'INR' as const;

/** Razorpay API base URL. Overridable for test doubles. */
export function getRazorpayApiBase(): string {
  return (process.env.RAZORPAY_API_BASE ?? 'https://api.razorpay.com/v1').trim();
}

/**
 * Order expiry, in seconds, applied to every server-created order.
 *
 * Derived from the hold window so an order can never outlive the slot hold it
 * pays for. Never a second literal.
 */
export const RAZORPAY_ORDER_EXPIRY_SECONDS = APP_CONFIG.HOLD_DURATION_MS / 1000;

/** Human-readable label for the payment method stored on `payments.gateway`. */
export const RAZORPAY_GATEWAY = 'razorpay' as const;

/** Gateway event id stored on `webhook_events.gateway`. */
export const RAZORPAY_WEBHOOK_GATEWAY = 'razorpay' as const;

/** Event types the webhook handler currently knows about. */
export const RAZORPAY_WEBHOOK_EVENTS = {
  payment_captured: 'payment.captured',
  payment_failed: 'payment.failed',
  payment_authorized: 'payment.authorized',
  order_paid: 'order.paid',
  refund_created: 'refund.created',
  refund_processed: 'refund.processed',
  refund_failed: 'refund.failed',
} as const;