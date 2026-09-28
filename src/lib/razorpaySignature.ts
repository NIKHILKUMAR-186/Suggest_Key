/**
 * Razorpay signature verification.
 *
 * Razorpay signs every webhook and every payment verification payload with
 * HMAC-SHA256 using the configured key secret. The signature is a hex digest
 * of `<payload>` where `<payload>` is the *exact* byte sequence the gateway
 * sent - for webhooks that is the RAW request body, for payment verification
 * it is `<razorpay_order_id>|<razorpay_payment_id>`.
 *
 * This module is deliberately side-effect free and pure so it can be unit
 * tested without a database, a network or a configured secret.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { getRazorpayKeySecret, getRazorpayWebhookSecret } from './razorpayConfig';

/** Algorithm Razorpay uses for every signature. */
export const RAZORPAY_SIGNATURE_ALGORITHM = 'sha256' as const;

/**
 * Compute the expected HMAC-SHA256 signature for a payload.
 *
 * `payload` must be the raw string the gateway signed - for webhooks that is
 * the verbatim request body, so callers must pass the un-parsed bytes.
 */
export function computeRazorpaySignature(payload: string, secret: string): string {
  return createHmac(RAZORPAY_SIGNATURE_ALGORITHM, secret).update(payload).digest('hex');
}

/**
 * Constant-time comparison of a supplied signature against the expected one.
 *
 * `timingSafeEqual` rejects unequal-length inputs itself, so a short-circuit
 * on length is unnecessary and would actually be a small timing leak. The
 * function therefore always hashes both buffers to the same length before
 * comparing, which keeps the comparison time independent of the secret.
 */
export function verifyRazorpaySignature(
  payload: string,
  suppliedSignature: string,
  secret: string,
): boolean {
  if (typeof payload !== 'string' || typeof suppliedSignature !== 'string' || !secret) {
    return false;
  }
  if (suppliedSignature.length === 0) return false;

  const expected = computeRazorpaySignature(payload, secret);
  if (expected.length !== suppliedSignature.length) return false;

  try {
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(suppliedSignature, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * Verify a payment signature using the KEY secret.
 *
 * The string Razorpay signs is `<order_id>|<payment_id>`, in that order, with
 * a literal pipe separator and no whitespace.
 */
export function verifyPaymentSignature(input: {
  orderId: string;
  paymentId: string;
  signature: string;
  secret?: string;
}): boolean {
  const secret = input.secret ?? getRazorpayKeySecret();
  if (!secret) return false;
  const payload = `${input.orderId}|${input.paymentId}`;
  return verifyRazorpaySignature(payload, input.signature, secret);
}

/**
 * Verify a webhook signature using the WEBHOOK secret.
 *
 * `body` MUST be the raw request body bytes as a string. Passing the parsed
 * JSON object here would silently fail: the gateway signs the bytes it sent,
 * not the semantic value inside them.
 */
export function verifyWebhookSignature(input: {
  body: string;
  signature: string;
  secret?: string;
}): boolean {
  const secret = input.secret ?? getRazorpayWebhookSecret();
  if (!secret) return false;
  return verifyRazorpaySignature(input.body, input.signature, secret);
}

/** Extract the `x-razorpay-signature` header from an arbitrary headers object. */
export function extractWebhookSignature(headers: Record<string, unknown> | undefined): string | null {
  if (!headers || typeof headers !== 'object') return null;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'x-razorpay-signature' && typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

/** Extract the `x-razorpay-event-id` header from an arbitrary headers object. */
export function extractWebhookEventId(headers: Record<string, unknown> | undefined): string | null {
  if (!headers || typeof headers !== 'object') return null;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'x-razorpay-event-id' && typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}