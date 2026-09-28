/**
 * Client-side bridge to the Razorpay backend endpoints.
 *
 * This module is the browser-side counterpart to the three routes in `server.ts`:
 *   - `GET  /api/payments/razorpay/config`
 *   - `POST /api/seeker/bookings/:id/razorpay/order`
 *   - `POST /api/seeker/bookings/:id/razorpay/verify`
 *
 * It contains NO secrets: the key id it returns is public by design (Razorpay's
 * Checkout needs it), and the key secret / webhook secret are verified only on
 * the server. Everything here is either a pure helper (unit-testable without a
 * network or a DOM) or a thin `apiFetch` wrapper around the response mappers.
 */

import { apiFetch } from './apiClient';

// ---------------------------------------------------------------------------
// API response types (match the server's JSON envelope exactly)
// ---------------------------------------------------------------------------

export interface RazorpayConfigSuccess {
  success: true;
  enabled: boolean;
  currency: string | null;
  razorpayKeyId: string | null;
}

export interface RazorpayOrderSuccess {
  success: true;
  razorpayOrderId: string;
  razorpayKeyId: string;
  amountInr: number;
  currency: string;
  paymentId: string;
  message: string;
}

export interface RazorpayVerifySuccess {
  success: true;
  paymentId: string;
  bookingId: string;
  bookingStatus: string;
  paymentStatus: string;
  message: string;
}

export interface RazorpayFailureBody {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export type RazorpayApiResponse =
  | RazorpayConfigSuccess
  | RazorpayOrderSuccess
  | RazorpayVerifySuccess
  | RazorpayFailureBody;

// ---------------------------------------------------------------------------
// Result envelope used by the typed fetchers
// ---------------------------------------------------------------------------

export interface RazorpayApiSuccess<T> {
  success: true;
  data: T;
}

export interface RazorpayApiFailure {
  success: false;
  code: string;
  message: string;
  statusCode?: number;
}

export type RazorpayApiResult<T> = RazorpayApiSuccess<T> | RazorpayApiFailure;

// ---------------------------------------------------------------------------
// UI state machine
// ---------------------------------------------------------------------------

export type RazorpayUiState =
  | 'idle'
  | 'loading_config'
  | 'not_enabled'
  | 'config_error'
  | 'creating_order'
  | 'opening_checkout'
  | 'processing'
  | 'verifying'
  | 'success'
  | 'failed'
  | 'expired'
  | 'already_completed'
  | 'unavailable';

// ---------------------------------------------------------------------------
// Checkout types
// ---------------------------------------------------------------------------

export interface RazorpayCheckoutResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export interface RazorpayCheckoutOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  handler: (response: RazorpayCheckoutResponse) => void;
  prefill?: { name?: string; email?: string };
  theme?: { color: string };
  modal?: { ondismiss?: () => void };
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** URL of the Razorpay Checkout script (public, no secret). */
export const RAZORPAY_CHECKOUT_SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';

/** The checkout colour used for the brand accent. */
export const RAZORPAY_THEME_COLOR = '#3399cc';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Rupees -> paise. The gateway works in the minor unit; the API works in rupees. */
export function inrToPaise(amountInr: number): number {
  return Math.round(amountInr * 100);
}

/** True when the state represents an in-flight action the user must wait on. */
export function isProcessingState(state: RazorpayUiState): boolean {
  return (
    state === 'loading_config' ||
    state === 'creating_order' ||
    state === 'opening_checkout' ||
    state === 'processing' ||
    state === 'verifying'
  );
}

/** True when the user can retry the payment from this state. */
export function isRetryableState(state: RazorpayUiState): boolean {
  return state === 'failed';
}

/** True when the flow has reached a state that should not offer a retry. */
export function isTerminalState(state: RazorpayUiState): boolean {
  return (
    state === 'success' ||
    state === 'expired' ||
    state === 'already_completed' ||
    state === 'not_enabled' ||
    state === 'config_error' ||
    state === 'unavailable'
  );
}

// ---------------------------------------------------------------------------
// Error code mapping
// ---------------------------------------------------------------------------

/**
 * Maps a backend error `code` to the UI state that should be shown.
 *
 * The mapping is grouped by the user-facing consequence of each failure:
 *   - HOLD_EXPIRED / PAYMENT_ALREADY_COMPLETED -> terminal states
 *   - booking not found / not payable / not owned / amount missing -> unavailable
 *   - everything else (gateway, signature, amount mismatch, conflict) -> retryable
 */
const ERROR_CODE_TO_STATE: Record<string, RazorpayUiState> = {
  HOLD_EXPIRED: 'expired',
  PAYMENT_ALREADY_COMPLETED: 'already_completed',
  // The flag was switched off, or the credentials were removed, between the
  // availability probe and this request. Retrying cannot help: the endpoint
  // answers 503 for as long as the flag is off, so a retryable state here would
  // show a "Retry Payment" button that can only ever fail again.
  RAZORPAY_DISABLED: 'not_enabled',
  RAZORPAY_NOT_CONFIGURED: 'not_enabled',
  // The booking is closed and a capture landed against it, so the money is
  // being refunded. A retry would open a second attempt for a session that will
  // never be delivered, so this is terminal.
  BOOKING_CLOSED_REFUND_PENDING: 'unavailable',
  BOOKING_NOT_FOUND: 'unavailable',
  FORBIDDEN_NOT_BOOKING_OWNER: 'unavailable',
  BOOKING_NOT_PAYABLE: 'unavailable',
  SLOT_ALREADY_STARTED: 'unavailable',
  AMOUNT_UNAVAILABLE: 'unavailable',
  PAYMENT_NOT_FOUND: 'unavailable',
  PAYMENT_NOT_GATEWAY: 'unavailable',
  // A genuine conflict, not a race this client lost: another request holds the
  // row. `createRazorpayOrder` retries once before surfacing this, so reaching
  // it means the conflict is real (a manual proof mid-review, for example).
  PAYMENT_ALREADY_IN_PROGRESS: 'failed',
  RAZORPAY_ORDER_FAILED: 'failed',
  RAZORPAY_SIGNATURE_INVALID: 'failed',
  RAZORPAY_ORDER_MISMATCH: 'failed',
  RAZORPAY_AMOUNT_MISMATCH: 'failed',
  PAYMENT_NOT_CAPTURED: 'failed',
  PAYMENT_STATE_CONFLICT: 'failed',
  VALIDATION_ERROR: 'failed',
};

export function mapRazorpayErrorCode(code: string | undefined): RazorpayUiState {
  if (!code) return 'failed';
  return ERROR_CODE_TO_STATE[code] ?? 'failed';
}

// ---------------------------------------------------------------------------
// Response mappers (pure: parse raw JSON body -> typed result)
// ---------------------------------------------------------------------------

interface RawError {
  code?: unknown;
  message?: unknown;
}

function readError(raw: unknown): RawError {
  if (!raw || typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;
  return {
    code: obj.code,
    message: obj.message,
  };
}

export function parseConfigResponse(raw: unknown): RazorpayApiResult<{
  enabled: boolean;
  currency: string | null;
  razorpayKeyId: string | null;
}> {
  if (!raw || typeof raw !== 'object') {
    return { success: false, code: 'PARSE_ERROR', message: 'Unexpected response from the payment service.' };
  }
  const obj = raw as Record<string, unknown>;

  if (obj.success === false) {
    const err = readError(obj.error);
    return {
      success: false,
      code: typeof err.code === 'string' ? err.code : 'CONFIG_ERROR',
      message: typeof err.message === 'string' && err.message.trim() ? err.message : 'Payment service is temporarily unavailable.',
    };
  }

  const enabled = obj.enabled === true;
  const currency = typeof obj.currency === 'string' && obj.currency ? obj.currency : null;
  const razorpayKeyId = typeof obj.razorpayKeyId === 'string' ? obj.razorpayKeyId : null;

  return { success: true, data: { enabled, currency, razorpayKeyId } };
}

/**
 * Maps a raw order response to a typed result.
 *
 * The server signals a freshly minted order with 201 and a reused in-flight
 * order with 200; it does not put the distinction in the body, so the caller
 * passes it in rather than this mapper hardcoding a constant. Without that the
 * field was permanently `false` and the page could not tell a new attempt from
 * the order it already had open.
 */
export function parseOrderResponse(
  raw: unknown,
  options: { alreadyCreated?: boolean } = {},
): RazorpayApiResult<{
  razorpayOrderId: string;
  razorpayKeyId: string;
  amountInr: number;
  currency: string;
  paymentId: string;
  message: string;
  alreadyCreated: boolean;
}> {
  if (!raw || typeof raw !== 'object') {
    return { success: false, code: 'PARSE_ERROR', message: 'Unexpected response from the payment service.' };
  }
  const obj = raw as Record<string, unknown>;

  if (obj.success === false) {
    const err = readError(obj.error);
    return {
      success: false,
      code: typeof err.code === 'string' ? err.code : 'ORDER_FAILED',
      message: typeof err.message === 'string' && err.message.trim() ? err.message : 'We could not start the payment. Please try again.',
    };
  }

  const orderId = typeof obj.razorpayOrderId === 'string' && obj.razorpayOrderId ? obj.razorpayOrderId : null;
  const keyId = typeof obj.razorpayKeyId === 'string' && obj.razorpayKeyId ? obj.razorpayKeyId : null;
  const amount = typeof obj.amountInr === 'number' && Number.isFinite(obj.amountInr) ? obj.amountInr : null;
  const currency = typeof obj.currency === 'string' && obj.currency ? obj.currency : null;
  const paymentId = typeof obj.paymentId === 'string' && obj.paymentId ? obj.paymentId : null;
  const message = typeof obj.message === 'string' ? obj.message : '';

  if (!orderId || !keyId || amount === null || !currency || !paymentId) {
    return {
      success: false,
      code: 'PARSE_ERROR',
      message: 'The payment order response was incomplete. Please try again.',
    };
  }

  return {
    success: true,
    data: {
      razorpayOrderId: orderId,
      razorpayKeyId: keyId,
      amountInr: amount,
      currency,
      paymentId,
      message,
      alreadyCreated: options.alreadyCreated === true,
    },
  };
}

export function parseVerifyResponse(raw: unknown): RazorpayApiResult<{
  paymentId: string;
  bookingId: string;
  bookingStatus: string;
  paymentStatus: string;
  message: string;
}> {
  if (!raw || typeof raw !== 'object') {
    return { success: false, code: 'PARSE_ERROR', message: 'Unexpected response from the payment service.' };
  }
  const obj = raw as Record<string, unknown>;

  if (obj.success === false) {
    const err = readError(obj.error);
    return {
      success: false,
      code: typeof err.code === 'string' ? err.code : 'VERIFY_FAILED',
      message: typeof err.message === 'string' && err.message.trim() ? err.message : 'We could not verify this payment. Please try again.',
    };
  }

  const paymentId = typeof obj.paymentId === 'string' && obj.paymentId ? obj.paymentId : null;
  const bookingId = typeof obj.bookingId === 'string' && obj.bookingId ? obj.bookingId : null;
  const bookingStatus = typeof obj.bookingStatus === 'string' && obj.bookingStatus ? obj.bookingStatus : null;
  const paymentStatus = typeof obj.paymentStatus === 'string' && obj.paymentStatus ? obj.paymentStatus : null;
  const message = typeof obj.message === 'string' ? obj.message : '';

  if (!paymentId || !bookingId || !bookingStatus || !paymentStatus) {
    return {
      success: false,
      code: 'PARSE_ERROR',
      message: 'The payment verification response was incomplete.',
    };
  }

  return {
    success: true,
    data: { paymentId, bookingId, bookingStatus, paymentStatus, message },
  };
}

// ---------------------------------------------------------------------------
// Checkout options builder
// ---------------------------------------------------------------------------

export function buildRazorpayCheckoutOptions(params: {
  keyId: string;
  orderId: string;
  amountInr: number;
  currency: string;
  bookingCode: string;
  prefillName?: string;
  prefillEmail?: string;
  handler: (response: RazorpayCheckoutResponse) => void;
  onDismiss?: () => void;
}): RazorpayCheckoutOptions {
  const options: RazorpayCheckoutOptions = {
    key: params.keyId,
    order_id: params.orderId,
    amount: inrToPaise(params.amountInr),
    currency: params.currency,
    name: 'Suggest Key',
    description: `Payment for booking ${params.bookingCode}`,
    handler: params.handler,
    theme: { color: RAZORPAY_THEME_COLOR },
  };

  const prefill: { name?: string; email?: string } = {};
  if (params.prefillName) prefill.name = params.prefillName;
  if (params.prefillEmail) prefill.email = params.prefillEmail;
  if (prefill.name || prefill.email) options.prefill = prefill;

  if (params.onDismiss) {
    options.modal = { ondismiss: params.onDismiss };
  }

  return options;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/**
 * Loads whether Razorpay checkout is switched on for seekers.
 *
 * The config endpoint is the only place the browser learns the key id (which is
 * public by design).
 *
 * "Not available" is a SUCCESS, not an error. While the flag is off the endpoint
 * answers 200 with `{ enabled: false, currency: null, razorpayKeyId: null }`, so
 * the page simply hides the gateway option and keeps the manual flow. Only a
 * rejected or unreadable request — network failure, non-JSON body, a bare
 * 401/500 — comes back as a failure here, and the page treats that the same
 * way: fall back to manual. The `RAZORPAY_DISABLED` / `RAZORPAY_NOT_CONFIGURED`
 * codes belong to the order and verify endpoints, which do answer 503.
 */
export async function fetchRazorpayConfig(): Promise<RazorpayApiResult<{
  enabled: boolean;
  currency: string | null;
  razorpayKeyId: string | null;
}>> {
  let res: Response;
  try {
    res = await apiFetch('/api/payments/razorpay/config');
  } catch {
    return { success: false, code: 'NETWORK_ERROR', message: 'We could not load the payment service. Please try again shortly.' };
  }

  let raw: unknown = null;
  try {
    raw = await res.json();
  } catch {
    return { success: false, code: 'PARSE_ERROR', message: 'The payment service responded unexpectedly. Please try again shortly.' };
  }

  const parsed = parseConfigResponse(raw);
  if (!parsed.success) {
    return { success: false, code: parsed.code, message: parsed.message, statusCode: res.status };
  }

  return parsed;
}

export interface RazorpayOrderData {
  razorpayOrderId: string;
  razorpayKeyId: string;
  amountInr: number;
  currency: string;
  paymentId: string;
  message: string;
  alreadyCreated: boolean;
}

/** One round trip to the order endpoint, with its result normalised. */
async function postOrder(url: string): Promise<RazorpayApiResult<RazorpayOrderData>> {
  let res: Response;
  try {
    res = await apiFetch(url, { method: 'POST' });
  } catch {
    return { success: false, code: 'NETWORK_ERROR', message: 'We could not reach the payment service. Check your connection and try again.' };
  }

  let raw: unknown = null;
  try {
    raw = await res.json();
  } catch {
    return { success: false, code: 'PARSE_ERROR', message: 'The payment service responded unexpectedly. Please try again.' };
  }

  const parsed = parseOrderResponse(raw, { alreadyCreated: res.status === 200 });
  if (!parsed.success) {
    return { success: false, code: parsed.code, message: parsed.message, statusCode: res.status };
  }

  return parsed;
}

/**
 * Asks the server to create (or return) a Razorpay order for this booking.
 *
 * The server derives the amount, the booking ownership, hold validity and
 * payability. The browser only supplies the booking id — it cannot influence the
 * amount the order is minted for.
 */
export async function createRazorpayOrder(bookingId: string): Promise<RazorpayApiResult<RazorpayOrderData>> {
  const url = `/api/seeker/bookings/${encodeURIComponent(bookingId)}/razorpay/order`;

  const first = await postOrder(url);

  // A double-tap can leave both requests past the server's pre-flight read
  // before either has written its row. The loser is answered 409
  // PAYMENT_ALREADY_IN_PROGRESS even though its own first tap succeeded, which
  // used to render "Payment Failed" beside a checkout that was in fact open.
  //
  // The endpoint is idempotent, so exactly one more read now finds the winning
  // order and returns it: the race resolves to the same checkout the seeker
  // already has. Bounded to a single attempt, because a genuine conflict — a
  // manual proof mid-review, say — fails the same way again and is then
  // reported as the failure it is.
  if (!first.success && first.code === 'PAYMENT_ALREADY_IN_PROGRESS') {
    return postOrder(url);
  }

  return first;
}

export interface RazorpayVerifyInput {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

export interface RazorpayVerifyData {
  paymentId: string;
  bookingId: string;
  bookingStatus: string;
  paymentStatus: string;
  message: string;
}

/**
 * Sends the gateway's payment response back to the server for signature
 * verification and capture.
 *
 * The signature is verified server-side against the key secret before any state
 * is written. The browser only relays what the Checkout `handler` handed it.
 */
export async function verifyRazorpayPayment(
  bookingId: string,
  payload: RazorpayVerifyInput,
): Promise<RazorpayApiResult<RazorpayVerifyData>> {
  let res: Response;
  try {
    res = await apiFetch(`/api/seeker/bookings/${encodeURIComponent(bookingId)}/razorpay/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        razorpayOrderId: payload.razorpayOrderId,
        razorpayPaymentId: payload.razorpayPaymentId,
        razorpaySignature: payload.razorpaySignature,
      }),
    });
  } catch {
    return { success: false, code: 'NETWORK_ERROR', message: 'We could not reach the payment service. Check your connection and try again.' };
  }

  let raw: unknown = null;
  try {
    raw = await res.json();
  } catch {
    return { success: false, code: 'PARSE_ERROR', message: 'The payment service responded unexpectedly. Please try again.' };
  }

  const parsed = parseVerifyResponse(raw);
  if (!parsed.success) {
    return { success: false, code: parsed.code, message: parsed.message, statusCode: res.status };
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Script loader
// ---------------------------------------------------------------------------

let scriptLoading: Promise<boolean> | null = null;

/** True once the SDK constructor is actually callable. */
const isRazorpaySdkReady = (): boolean =>
  typeof window !== 'undefined' && typeof (window as unknown as { Razorpay?: unknown }).Razorpay === 'function';

/**
 * Loads the Razorpay Checkout script.
 *
 * Idempotent: concurrent calls share a single in-flight load, and a script that
 * loaded successfully is never re-fetched. Returns `false` when the script fails
 * to load, when it loads without defining the SDK, or when there is no document
 * (e.g. SSR), so the caller can surface an honest error rather than a crash.
 *
 * A tag that did not produce a usable SDK is removed again. Without that, a
 * single failed load left the tag in the document, and the "already present"
 * check below then reported `false` for the rest of the page's life — the
 * gateway stayed broken until a full reload, with no way for the seeker to
 * recover by retrying.
 */
export function loadRazorpayScript(): Promise<boolean> {
  if (typeof document === 'undefined') {
    return Promise.resolve(false);
  }

  if (isRazorpaySdkReady()) {
    return Promise.resolve(true);
  }

  if (scriptLoading) {
    return scriptLoading;
  }

  // The script may already have been added by an earlier mount or a different
  // module. If the SDK is not callable the tag is unusable — a still-loading
  // tag cannot reach here, because an in-flight load is held in `scriptLoading`
  // and a finished one only survives when it succeeded — so drop it and load
  // again rather than reporting a permanent failure.
  document.querySelector(`script[src="${RAZORPAY_CHECKOUT_SCRIPT_URL}"]`)?.remove();

  scriptLoading = new Promise<boolean>((resolve) => {
    const script = document.createElement('script');
    script.src = RAZORPAY_CHECKOUT_SCRIPT_URL;
    script.async = true;

    // Resolves the attempt and clears the shared slot, dropping the tag unless
    // the SDK actually arrived.
    const settle = (loaded: boolean) => {
      scriptLoading = null;
      if (loaded && isRazorpaySdkReady()) {
        resolve(true);
        return;
      }
      script.remove();
      resolve(false);
    };

    script.onload = () => settle(true);
    script.onerror = () => settle(false);
    document.body.appendChild(script);
  });

  return scriptLoading;
}
