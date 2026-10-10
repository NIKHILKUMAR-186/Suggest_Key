export interface RateLimitInfo {
  retryAfterSeconds: number;
  retryAt: number;
  message: string;
}

export const RATE_LIMIT_FALLBACK_SECONDS = 60;

export const DEFAULT_RATE_LIMIT_MESSAGE =
  'Too many requests. Please try again shortly.';

/**
 * Parses the Retry-After header value into seconds.
 * Retry-After can be either:
 * - A non-negative integer representing seconds (e.g., "30")
 * - An HTTP-date (e.g., "Wed, 21 Oct 2015 07:28:00 GMT")
 */
export function parseRetryAfterHeader(header: string | null): number | null {
  if (!header) return null;

  const trimmed = header.trim();
  if (!trimmed) return null;

  const asSeconds = Number(trimmed);
  if (Number.isInteger(asSeconds) && asSeconds >= 0) {
    return asSeconds;
  }

  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    // A valid HTTP-date for Retry-After MUST be in the future. If the parsed
    // date is in the past (e.g., Date.parse("-5") returns -5 ms before epoch),
    // treat it as unparsable and fall through to null.
    const now = Date.now();
    if (dateMs <= now) return null;
    return Math.max(1, Math.ceil((dateMs - now) / 1000));
  }

  return null;
}

/**
 * Extracts rate limit info from a 429 response.
 *
 * Priority order (server is authoritative; the body and header MUST agree):
 *   1. JSON body `error.retryAfterSeconds`
 *   2. `Retry-After` header (seconds)
 *   3. `Retry-After` header (HTTP-date)
 *   4. safe fallback only if neither is available
 *
 * The previous implementation compared against a hard-coded `60` sentinel,
 * which meant a legitimate server value of 60 seconds was ignored in favour of
 * the header. A `fromBody` flag is tracked instead so the fallback only engages
 * when neither the body nor the header provided a usable value.
 */
export async function extractRateLimitInfo(response: Response): Promise<RateLimitInfo> {
  const now = Date.now();
  let retryAfterSeconds = RATE_LIMIT_FALLBACK_SECONDS;
  let fromBody = false;
  let message = DEFAULT_RATE_LIMIT_MESSAGE;

  try {
    const contentType = response.headers.get('Content-Type');
    if (contentType?.includes('application/json')) {
      const data = await response.clone().json();
      const bodySeconds = Number(data?.error?.retryAfterSeconds);
      if (Number.isInteger(bodySeconds) && bodySeconds >= 0) {
        retryAfterSeconds = bodySeconds;
        fromBody = true;
      }
      if (typeof data?.error?.message === 'string' && data.error.message) {
        message = data.error.message;
      }
    }
  } catch {
    // Ignore JSON parse errors — fall through to header parsing.
  }

  if (!fromBody) {
    const parsed = parseRetryAfterHeader(response.headers.get('Retry-After'));
    if (parsed !== null) {
      retryAfterSeconds = parsed;
    }
  }

  const retryAt = now + retryAfterSeconds * 1000;

  return {
    retryAfterSeconds: Math.max(0, retryAfterSeconds),
    retryAt,
    message,
  };
}

/**
 * Formats a duration in seconds into a human-readable string.
 * Examples: "1 second", "8 seconds", "1 minute 12 seconds", "3 minutes"
 */
export function formatRateLimitDuration(seconds: number): string {
  if (seconds <= 0) return 'Ready';

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes === 0) {
    return `${seconds} second${seconds !== 1 ? 's' : ''}`;
  }

  if (remainingSeconds === 0) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }

  return `${minutes} minute${minutes !== 1 ? 's' : ''} ${remainingSeconds} second${remainingSeconds !== 1 ? 's' : ''}`;
}

/**
 * Calculates remaining seconds from an absolute retry timestamp.
 * Uses Math.max to prevent negative values and Math.ceil for accuracy.
 */
export function getRemainingSeconds(retryAt: number | null): number {
  if (!retryAt) return 0;
  return Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
}
