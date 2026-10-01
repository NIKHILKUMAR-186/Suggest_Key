import { apiFetch } from './apiClient';
import { logSanitizer } from './logSanitizer';

/**
 * Payer-facing payment details an admin manages. Every field is nullable because
 * "not configured yet" is a real, honest state: nothing here is defaulted to a
 * placeholder UPI id, a stock QR or canned instructions.
 */
export interface PaymentConfiguration {
  upiId: string | null;
  qrImageStoragePath: string | null;
  qrImageUrl: string | null;
  instructions: string | null;
  currency: string | null;
  accountName: string | null;
  updatedAt: string | null;
}

/** The subset a seeker is allowed to see. No storage path, no credentials. */
export interface PublicPaymentConfiguration {
  upiId: string | null;
  qrImageUrl: string | null;
  instructions: string | null;
  currency: string | null;
  accountName: string | null;
}

/**
 * Booking/session rules exactly as the booking engine and the database
 * functions enforce them, served by the server from the same `APP_CONFIG` they
 * read. Read-only by design - see the server route for why these are not
 * editable.
 */
export interface EnforcedPlatformRules {
  holdDurationMinutes: number;
  sessionAccessWindowMinutes: number;
  meetingLinkDeadlineMinutes: number;
  bookingCutoffMinutes: number;
  cancellationWindowMinutes: number;
  defaultTimezone: string;
  paymentMethod: string;
}

export interface AdminPlatformConfiguration {
  payment: PaymentConfiguration;
  rules: EnforcedPlatformRules;
}

export type ConfigUpdatePayload = Partial<
  Pick<PaymentConfiguration, 'upiId' | 'qrImageStoragePath' | 'instructions' | 'currency' | 'accountName'>
>;

/** Every payment field is a nullable string, so an "unset" is always null. */
const optionalText = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function readPayment(raw: unknown): PaymentConfiguration | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  return {
    upiId: optionalText(row.upiId),
    qrImageStoragePath: optionalText(row.qrImageStoragePath),
    qrImageUrl: optionalText(row.qrImageUrl),
    instructions: optionalText(row.instructions),
    currency: optionalText(row.currency),
    accountName: optionalText(row.accountName),
    updatedAt: optionalText(row.updatedAt),
  };
}

function readRules(raw: unknown): EnforcedPlatformRules | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const num = (key: string): number => (typeof row[key] === 'number' ? (row[key] as number) : NaN);
  const str = (key: string): string | null => (typeof row[key] === 'string' ? (row[key] as string) : null);

  const holdDurationMinutes = num('holdDurationMinutes');
  const sessionAccessWindowMinutes = num('sessionAccessWindowMinutes');
  const meetingLinkDeadlineMinutes = num('meetingLinkDeadlineMinutes');
  const bookingCutoffMinutes = num('bookingCutoffMinutes');
  const cancellationWindowMinutes = num('cancellationWindowMinutes');
  const defaultTimezone = str('defaultTimezone');

  // A rules payload with a missing or non-numeric timing is a contract break,
  // not a configuration to display. Returning null makes the caller render an
  // honest error instead of "NaN minutes".
  if (
    !Number.isFinite(holdDurationMinutes) ||
    !Number.isFinite(sessionAccessWindowMinutes) ||
    !Number.isFinite(meetingLinkDeadlineMinutes) ||
    !Number.isFinite(bookingCutoffMinutes) ||
    !Number.isFinite(cancellationWindowMinutes) ||
    !defaultTimezone
  ) {
    return null;
  }

  return {
    holdDurationMinutes,
    sessionAccessWindowMinutes,
    meetingLinkDeadlineMinutes,
    bookingCutoffMinutes,
    cancellationWindowMinutes,
    defaultTimezone,
    paymentMethod: str('paymentMethod') ?? 'manual_qr',
  };
}

/** Pulls `{ success, error }` out of a non-2xx API response, best effort. */
async function readApiError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const message = body?.error?.message;
    if (typeof message === 'string' && message.trim()) return message;
  } catch {
    // Non-JSON error body; fall through to the generic message.
  }
  return 'The server rejected this request.';
}

/**
 * Loads the admin settings payload: the persisted payment configuration plus the
 * server-enforced booking rules.
 *
 * Throws on failure so the page can show a real error state. Returning `null`
 * here would render an empty form that looks like "no payment configured" when
 * the truth is "the request failed".
 */
export async function fetchAdminPlatformConfiguration(): Promise<AdminPlatformConfiguration> {
  const res = await apiFetch('/api/admin/platform-config');
  if (!res.ok) throw new Error(await readApiError(res));

  const body = await res.json();
  const payment = readPayment(body?.payment);
  const rules = readRules(body?.rules);

  if (!payment || !rules) {
    throw new Error('The platform configuration response was incomplete.');
  }

  return { payment, rules };
}

/**
 * Loads the payment details the seeker payment page renders.
 *
 * Same table and same row the admin console writes, so a saved change is
 * reflected on the next load with no cache of its own.
 */
export async function fetchPaymentConfiguration(): Promise<PublicPaymentConfiguration> {
  const res = await apiFetch('/api/platform-config');
  if (!res.ok) throw new Error(await readApiError(res));

  const body = await res.json();
  const payment = readPayment(body?.payment);

  if (!payment) {
    throw new Error('The payment configuration response was incomplete.');
  }

  return {
    upiId: payment.upiId,
    qrImageUrl: payment.qrImageUrl,
    instructions: payment.instructions,
    currency: payment.currency,
    accountName: payment.accountName,
  };
}

/** Persists the payment configuration. Throws with the server's message on failure. */
export async function savePaymentConfiguration(payload: ConfigUpdatePayload): Promise<PaymentConfiguration> {
  const res = await apiFetch('/api/admin/platform-config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readApiError(res));

  const body = await res.json();
  const payment = readPayment(body?.payment);
  if (!payment) throw new Error('The save response did not include the updated configuration.');

  return payment;
}

export interface QrUploadTicket {
  uploadUrl: string;
  token: string;
  path: string;
}

/**
 * Asks the server for a signed upload slot for a payment QR image.
 *
 * The image itself is uploaded straight to Supabase Storage by
 * `uploadQrImage`, so the binary never passes through this app and is never
 * written into a database column.
 */
export async function requestQrUploadTicket(file: File): Promise<QrUploadTicket> {
  const res = await apiFetch('/api/admin/platform-config/qr-upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Only the type and size are sent: the server derives the object key itself,
    // so the client's filename is never transmitted or trusted.
    body: JSON.stringify({ fileType: file.type, fileSize: file.size }),
  });
  if (!res.ok) throw new Error(await readApiError(res));

  const body = await res.json();
  if (typeof body?.uploadUrl !== 'string' || typeof body?.token !== 'string' || typeof body?.path !== 'string') {
    throw new Error('The upload slot response was incomplete.');
  }

  return { uploadUrl: body.uploadUrl, token: body.token, path: body.path };
}

/**
 * Uploads the QR image bytes to the signed slot and returns the object key to
 * persist. A rejected upload throws, so the caller never records a reference to
 * an object that does not exist.
 */
export async function uploadQrImage(ticket: QrUploadTicket, file: File): Promise<string> {
  const res = await fetch(ticket.uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': file.type,
      authorization: `Bearer ${ticket.token}`,
      'x-upsert': 'true',
    },
    body: file,
  });

  if (!res.ok) {
    throw new Error('The payment QR image could not be uploaded. Please try again.');
  }

  return ticket.path;
}

/** Detaches and deletes the stored payment QR. */
export async function deletePaymentQrImage(): Promise<void> {
  const res = await apiFetch('/api/admin/platform-config/qr', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(await readApiError(res));
}

/** Sanitises a server error into something safe to show in the UI. */
export function toSettingsErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === 'string' && err.trim()) return err;
  console.warn('Admin settings request failed:', logSanitizer.safeMessage(err));
  return fallback;
}
