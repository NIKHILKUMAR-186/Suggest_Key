export const REDACTED = '***redacted***';
export const REDACTED_LEGACY = 'redacted';
export const REDACTED_HEADER = '***present***';
export const REDACTED_HEADER_ABSENT = '***absent***';

const SENSITIVE_KEYS = new Set([
  'pass',
  'pwd',
  'passwd',
  'password',
  'pin',
  'otp',
  'totp',
  'mfa_code',
  'mfacode',
  'currentpassword',
  'newpassword',
  'oldpassword',
  'confirmpassword',
  'passwordconfirmation',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'id_token',
  'idtoken',
  'token',
  'tokens',
  'jwt',
  'bearer',
  'authorization',
  'auth_token',
  'authtoken',
  'session',
  'session_id',
  'sessionid',
  'cookie',
  'set-cookie',
  'secret',
  'secret_key',
  'secretkey',
  'client_secret',
  'clientsecret',
  'private_key',
  'privatekey',
  'api_key',
  'apikey',
  'access_key',
  'accesskey',
  'secret_access_key',
  'x-api-key',
  'x-service-role-key',
  'supabase-apikey',
  'service_role_key',
  'service_role',
  'supabase_service_role_key',
  'sbp_secret',
  'webhook_secret',
  'signature',
  'signedurl',
  'signed_url',
  'uploadurl',
  'upload_url',
  'card',
  'cardnum',
  'card_num',
  'cardnumber',
  'card_number',
  'credit_card',
  'creditcard',
  'creditcardnumber',
  'pan',
  'cvc',
  'cvv',
  'cvv2',
  'ssn',
  'social_security_number',
  'routing_number',
  'routingnumber',
  'iban',
  'account_number',
  'accountnumber',
  'proof_base64',
  'proof_data',
  'document_base64',
  'credential',
  'credentials',
  'demo_auth_secret',
]);

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
  'proxy-authorization',
]);

const SENSITIVE_PATH_PATTERNS = [
  /^\/auth\//,
  /^\/api\/auth\//,
  /^\/api\/auth\/demo-login/,
];

const SENSITIVE_KEY_SUBSTRING =
  /(^|[_\-.])(pass(word|wd)?|pwd|secret|token|apikey|api_key|cvv|cvc|cvv2|ssn|otp|credential|pin|signature)s?($|[_\-.])/i;

const SENSITIVE_VALUE_PATTERNS: RegExp[] = [
  /(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi,
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*/g,
  /\bsb_(?:publishable|secret)_[A-Za-z0-9_-]{10,}/g,
  /\bskdemo\.[A-Za-z0-9._-]{8,}/g,
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bAIza[0-9A-Za-z_\-]{20,}/g,
  /\bxox[abopsr]-[A-Za-z0-9-]{10,}/g,
  /\bpostgres(?:ql)?:\/\/[^\s"']+/gi,
  /((?:password|passwd|pwd|token|secret|api[_-]?key|authorization|bearer)\s*[=:]\s*)[^\s,;"'&]+/gi,
  /\b(?:\d[ -]?){13,19}\b/g,
];

const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 2000;

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.has(lower) || SENSITIVE_KEY_SUBSTRING.test(lower);
}

export function scrubString(value: string, marker: string = REDACTED): string {
  let out = value;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, (...args) => {
      const match = args[0] as string;
      // With a capture group present, args[1] is the prefix to preserve.
      // Without one, args[1] is the numeric match offset, so it must be
      // type-checked rather than merely tested for truthiness.
      const prefix = typeof args[1] === 'string' ? args[1] : undefined;
      if (match.includes(marker)) return match;
      return prefix !== undefined ? `${prefix}${marker}` : marker;
    });
  }
  return out.length > MAX_STRING_LENGTH ? `${out.slice(0, MAX_STRING_LENGTH)}...[truncated]` : out;
}

function scrubValue(value: unknown, depth: number, seen: WeakSet<object>, marker: string): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') return scrubString(value, marker);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`;

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: scrubString(value.message, marker) };
  }
  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of value.entries()) {
      const key = String(k);
      out[key] = isSensitiveKey(key) ? marker : scrubValue(v, depth + 1, seen, marker);
    }
    return out;
  }
  if (value instanceof Set) {
    return scrubValue(Array.from(value.values()), depth, seen, marker);
  }

  if (depth >= MAX_DEPTH) return '[depth-limit]';

  if (Array.isArray(value)) {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    const out = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => scrubValue(item, depth + 1, seen, marker));
    if (value.length > MAX_ARRAY_ITEMS) out.push(`...[${value.length - MAX_ARRAY_ITEMS} more]`);
    return out;
  }

  if (typeof value === 'object') {
    if (seen.has(value as object)) return '[circular]';
    seen.add(value as object);
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? marker : scrubValue(val, depth + 1, seen, marker);
    }
    return out;
  }

  return String(value);
}

/**
 * Recursively redacts credentials from an arbitrary value.
 *
 * `marker` exists because this codebase already exposes two redaction
 * sentinels in its public surface: `logSanitizer.sanitizeBody` yields
 * `redacted`, while `sanitizeBodyForLog` yields `***redacted***`. Both are
 * load-bearing for existing callers and tests, so the marker is a parameter
 * rather than a single global constant.
 */
export function scrubForLog<T>(value: T, marker: string = REDACTED): T {
  return scrubValue(value, 0, new WeakSet(), marker) as T;
}

export interface SanitizedHeaders {
  [key: string]: unknown;
}

export const logSanitizer = {
  scrubForLog,

  sanitizeHeaders(headers: Record<string, unknown>): SanitizedHeaders {
    const result: SanitizedHeaders = {};
    for (const [key, value] of Object.entries(headers || {})) {
      const lower = key.toLowerCase();
      if (SENSITIVE_HEADER_NAMES.has(lower) || isSensitiveKey(lower)) {
        result[lower] = value ? REDACTED_HEADER : REDACTED_HEADER_ABSENT;
      } else {
        result[key] = scrubValue(value, 1, new WeakSet(), REDACTED_LEGACY);
      }
    }
    return result;
  },

  sanitizeBody(body: unknown): Record<string, unknown> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
    return scrubForLog(body as Record<string, unknown>, REDACTED_LEGACY);
  },

  isSensitivePath(pathname: string): boolean {
    if (!pathname || typeof pathname !== 'string') return false;
    const normalized = pathname.toLowerCase();
    return SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
  },

  safeErrorStack(stack: string | undefined): string | undefined {
    if (!stack) return undefined;
    return scrubString(stack)
      .replace(/\.js:\d+:\d+/g, '.js:xxx:xxx')
      .replace(/\.ts:\d+:\d+/g, '.ts:xxx:xxx');
  },

  safeMessage(error: Error | unknown): string {
    if (error instanceof Error) return scrubString(error.message);
    if (typeof error === 'string') return scrubString(error);
    return 'An unexpected error occurred';
  },
};
