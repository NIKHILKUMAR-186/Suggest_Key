const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-service-role-key',
  'apikey',
  'supabase-apikey',
  'x-csrf-token',
  'x-auth-token',
]);

const SENSITIVE_BODY_KEYS_LOWER = new Set([
  'password',
  'pass',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'token',
  'secret',
  'api_key',
  'apikey',
  'service_role_key',
  'service_role',
  'cardnumber',
  'card_number',
  'cvv',
  'ssn',
  'proof_base64',
  'proof_data',
  'credit_card',
  'creditcard',
]);

const SENSITIVE_PATH_PATTERNS = [
  /^\/auth\//,
  /^\/api\/auth\//,
  /^\/api\/auth\/demo-login/,
];

const REDACTED_HEADER = '***present***';
const REDACTED_HEADER_ABSENT = '***absent***';
const REDACTED_VALUE = 'redacted';

export interface SanitizedHeaders {
  [key: string]: unknown;
}

export interface SanitizedBody {
  [key: string]: unknown;
}

export const logSanitizer = {
  sanitizeHeaders(headers: Record<string, unknown>): SanitizedHeaders {
    const result: SanitizedHeaders = {};
    for (const [key, value] of Object.entries(headers || {})) {
      const lower = key.toLowerCase();
      if (SENSITIVE_HEADER_NAMES.has(lower)) {
        result[lower] = value ? REDACTED_HEADER : REDACTED_HEADER_ABSENT;
      } else {
        result[key] = value;
      }
    }
    return result;
  },

  sanitizeBody(body: unknown): SanitizedBody {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return {};
    }
    const result: SanitizedBody = {};
    for (const [key, value] of Object.entries(body)) {
      const lower = key.toLowerCase();
      if (SENSITIVE_BODY_KEYS_LOWER.has(lower)) {
        result[key] = value ? REDACTED_VALUE : undefined;
      } else {
        result[key] = value;
      }
    }
    return result;
  },

  isSensitivePath(pathname: string): boolean {
    if (!pathname || typeof pathname !== 'string') return false;
    const normalized = pathname.toLowerCase();
    for (const pattern of SENSITIVE_PATH_PATTERNS) {
      if (pattern.test(normalized)) return true;
    }
    return false;
  },

  safeErrorStack(stack: string | undefined): string | undefined {
    if (!stack) return undefined;
    return stack.replace(/\.js:\d+:\d+/g, '.js:xxx:xxx').replace(/\.ts:\d+:\d+/g, '.ts:xxx:xxx');
  },

  safeMessage(error: Error | unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    return 'An unexpected error occurred';
  },
};
