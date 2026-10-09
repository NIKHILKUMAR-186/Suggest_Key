import { isSupabaseConfigured, supabase } from './supabase';
import { logSanitizer, scrubForLog } from './logSanitizer';
import { extractRateLimitInfo, type RateLimitInfo } from './rateLimitUtils';
import {
  enterRateLimit,
  getSnapshot,
  isCriticalRequest,
  isEndpointSuppressed,
  pathnameOf,
  RateLimitError,
  RATE_LIMIT_FALLBACK_SECONDS,
  DEFAULT_RATE_LIMIT_MESSAGE,
  type RateLimitState,
} from './rateLimitManager';

export {
  RateLimitError,
  RATE_LIMIT_FALLBACK_SECONDS,
  DEFAULT_RATE_LIMIT_MESSAGE,
  isCriticalRequest,
  getSnapshot,
  enterRateLimit,
};
export type { RateLimitInfo };

const DEMO_AUTH_STORAGE_KEY = 'suggestkey_demo_auth';

let lastResponseRequestId: string | null = null;

export function getLastResponseRequestId(): string | null {
  return lastResponseRequestId;
}

/**
 * Resolves the bearer token for API calls.
 *
 * The live Supabase session is authoritative and is therefore checked FIRST.
 * The stored development demo token is only consulted when no Supabase session
 * exists, because preferring it would let a stale value in localStorage
 * override the signed-in identity — and with it the role the server resolves.
 */
export async function getApiAuthorization(): Promise<string | null> {
  if (isSupabaseConfigured()) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (token) return token;
    } catch {
      // fall through to demo token
    }
  }

  try {
    const demoAuth = localStorage.getItem(DEMO_AUTH_STORAGE_KEY);
    if (demoAuth) {
      const parsed = JSON.parse(demoAuth) as { token?: unknown };
      if (typeof parsed.token === 'string' && parsed.token.trim()) {
        return parsed.token.trim();
      }
    }
  } catch {
    // fall through
  }

  return null;
}

/**
 * Checks if a response is a rate limit (429) response.
 */
export function isRateLimitedResponse(response: Response): boolean {
  return response.status === 429;
}

function buildSynthetic429(state: RateLimitState): Response {
  const retryAfter = state.retryAt
    ? Math.max(0, Math.ceil((state.retryAt - Date.now()) / 1000))
    : 0;
  const body = JSON.stringify({
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: state.message || DEFAULT_RATE_LIMIT_MESSAGE,
      retryAfterSeconds: retryAfter,
    },
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Retry-After': String(retryAfter > 0 ? retryAfter : 1),
  };
  return new Response(body, { status: 429, statusText: 'Too Many Requests', headers });
}

/**
 * Core fetch with global 429 handling.
 *
 * Behaviour:
 *  - A 429 is treated as a COOLDOWN signal, never as a normal transient error.
 *    It is NOT retried.
 *  - On a real 429 the response is fed to the rate-limit manager (server is
 *    authoritative) so the global banner + countdown reflect the cooldown.
 *  - While a cooldown is active, non-critical requests are short-circuited with a
 *    synthetic 429 response (no network) so a re-render / polling tick cannot
 *    produce a request storm. Critical auth/health flows always pass through.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const requestUrl = typeof input === 'string' ? input : String(input);

  // While a server-granted cooldown is active, suppress re-fetches to the SAME
  // endpoint (prevents render/poll loops producing a request storm). Requests to
  // other endpoints are still allowed through so they can extend the single
  // global cooldown. Critical auth/health flows always pass through.
  if (!isCriticalRequest(requestUrl)) {
    const snapshot = getSnapshot();
    if (snapshot.isRateLimited && isEndpointSuppressed(pathnameOf(requestUrl))) {
      return buildSynthetic429(snapshot);
    }
  }

  const headers = new Headers(init.headers);
  if (!headers.has('Authorization')) {
    const authorization = await getApiAuthorization();
    if (authorization) headers.set('Authorization', `Bearer ${authorization}`);
  }

  const response = await fetch(input, { ...init, headers });

  const serverRequestId = response.headers.get('X-Request-ID');
  if (serverRequestId) {
    lastResponseRequestId = serverRequestId;
  }

  // 429: record the cooldown and stop. Do NOT retry automatically.
  if (response.status === 429) {
    const pathname = pathnameOf(requestUrl);
    try {
      const info = await extractRateLimitInfo(response.clone());
      enterRateLimit(
        {
          retryAt: info.retryAt,
          retryAfterSeconds: info.retryAfterSeconds,
          message: info.message,
        },
        pathname,
      );
    } catch {
      enterRateLimit(
        {
          retryAt: Date.now() + RATE_LIMIT_FALLBACK_SECONDS * 1000,
          retryAfterSeconds: RATE_LIMIT_FALLBACK_SECONDS,
          message: DEFAULT_RATE_LIMIT_MESSAGE,
        },
        pathname,
      );
    }
  }

  return response;
}

export interface ClientErrorInfo {
  error: string;
  statusCode?: number;
  requestId?: string;
  timestamp: string;
}

export function captureClientError(error: Error | unknown, context?: Record<string, any>): ClientErrorInfo {
  const safeContext = scrubForLog({ ...(context || {}) });
  const info: ClientErrorInfo = {
    error: logSanitizer.safeMessage(error),
    requestId: lastResponseRequestId || undefined,
    timestamp: new Date().toISOString(),
    ...safeContext,
  };

  console.error('[Client Error]', JSON.stringify(info));
  return info;
}
