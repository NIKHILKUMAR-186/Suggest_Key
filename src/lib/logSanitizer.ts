import { createHash } from 'crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogCategory =
  | 'api_request'
  | 'api_error'
  | 'auth'
  | 'db'
  | 'business'
  | 'system';

export interface LogContext {
  requestId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  userId?: string | null;
  role?: string | null;
  errorCode?: string | null;
  message?: string;
  metadata?: Record<string, unknown>;
}

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-csrf-token',
  'x-forwarded-for',
]);

const SENSITIVE_BODY_KEYS = new Set([
  'password',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'token',
  'accessToken',
  'refreshToken',
  'refresh_token',
  'access_token',
  'apiKey',
  'api_key',
  'serviceRoleKey',
  'service_role_key',
  'paymentSecret',
  'payment_secret',
  'cardNumber',
  'card_number',
  'cvv',
  'otp',
  'recoveryCode',
  'recovery_code',
  'secret',
  'clientSecret',
  'client_secret',
]);

const SENSITIVE_PATH_SEGMENTS = [
  '/auth/reset-password',
  '/auth/callback',
  '/api/admin/payments',
];

function isSensitivePath(path: string): boolean {
  return SENSITIVE_PATH_SEGMENTS.some((seg) => path.startsWith(seg));
}

function sanitizeHeaderName(name: string): string {
  return name.toLowerCase();
}

function redactHeaderValue(name: string): string {
  const lower = name.toLowerCase();
  if (lower === 'authorization') return 'present';
  if (lower === 'cookie' || lower === 'set-cookie') return 'present';
  if (lower.includes('token') || lower.includes('key') || lower.includes('secret')) {
    return 'redacted';
  }
  return 'present';
}

function sanitizeHeaders(headers: Record<string, unknown> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = sanitizeHeaderName(key);
    if (SENSITIVE_HEADERS.has(lower)) {
      out[lower] = redactHeaderValue(lower);
    } else if (typeof value === 'string') {
      out[lower] = value;
    } else if (Array.isArray(value)) {
      out[lower] = value.join(', ');
    } else if (value !== undefined && value !== null) {
      out[lower] = String(value);
    }
  }
  return out;
}

function sanitizeBody(body: unknown): unknown {
  if (body === null || body === undefined) return null;
  if (typeof body !== 'object') return body;
  if (Array.isArray(body)) return body.map((item) => sanitizeBody(item));

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_BODY_KEYS.has(key) || SENSITIVE_BODY_KEYS.has(lower)) {
      out[key] = 'redacted';
    } else if (lower.includes('password') || lower.includes('token') || lower.includes('secret') || lower.includes('key') || lower.includes('cvv') || lower.includes('card')) {
      out[key] = 'redacted';
    } else if (typeof value === 'object' && value !== null) {
      out[key] = sanitizeBody(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function safeErrorStack(error: unknown): string | undefined {
  if (error instanceof Error) {
    const stack = error.stack;
    if (stack && stack.length > 4096) {
      return stack.slice(0, 4096);
    }
    return stack;
  }
  if (typeof error === 'string') return error.slice(0, 2048);
  return undefined;
}

function safeMessage(error: unknown, fallback = 'Unknown error'): string {
  if (error instanceof Error) {
    return error.message ? error.message.slice(0, 2048) : fallback;
  }
  if (typeof error === 'string') return error.slice(0, 2048);
  try {
    const serialized = JSON.stringify(error);
    return serialized ? serialized.slice(0, 2048) : fallback;
  } catch {
    return fallback;
  }
}

function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

export const logSanitizer = {
  isSensitivePath,
  sanitizeHeaders,
  sanitizeBody,
  safeErrorStack,
  safeMessage,
  fingerprint,
};