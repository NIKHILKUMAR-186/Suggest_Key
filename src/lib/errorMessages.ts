import { captureClientError, getLastResponseRequestId } from './apiClient';

/**
 * Turns any thrown value into one safe, actionable sentence for the user.
 *
 * Rules:
 *  - The full technical error is always sent to the console (with the request
 *    id when the API client captured one) and, for server-side failures, to
 *    System Health. Nothing technical reaches the UI.
 *  - Messages that are already written for humans (from our own API envelope)
 *    are passed through unchanged, so the backend keeps ownership of its own
 *    user-facing copy.
 *  - Anything unrecognised collapses to the caller's contextual fallback.
 */

const TECHNICAL_MARKERS = [
  'pgrst',
  'sqlstate',
  'postgres',
  'postgrest',
  'duplicate key',
  'violates',
  'constraint',
  'relation ',
  'column ',
  'null value',
  'undefined is not',
  'unexpected token',
  'json at position',
  'syntaxerror',
  'typeerror',
  'referenceerror',
  'http status',
  'status code',
  'stack',
];

/** True when a string looks like a developer detail rather than user copy. */
export function isTechnicalMessage(message: string): boolean {
  const lower = (message || '').toLowerCase();
  if (!lower) return true;
  return TECHNICAL_MARKERS.some((marker) => lower.includes(marker));
}

function looksLikeHttpNoise(message: string): boolean {
  const lower = (message || '').toLowerCase();
  return (
    lower === 'failed to fetch' ||
    lower === 'networkerror' ||
    lower === 'load failed' ||
    lower === 'network error' ||
    lower.startsWith('fetch failed')
  );
}

const isPlainString = (value: unknown): value is string => typeof value === 'string';

/**
 * @param error    The caught value (Error, API envelope string, unknown).
 * @param fallback Contextual, human copy shown when nothing better is known.
 * @param context  Optional label recorded in the console log.
 */
export function toUserMessage(
  error: unknown,
  fallback: string,
  context?: Record<string, unknown>
): string {
  const raw = isPlainString(error) ? error : error instanceof Error ? error.message : '';

  // Preserve the technical detail for whoever is debugging - the console and
  // System Health, never the screen.
  if (raw) {
    captureClientError(raw, { userMessageFallback: fallback, requestId: getLastResponseRequestId(), ...context });
  } else {
    captureClientError(fallback, { ...context });
  }

  if (!raw) return fallback;
  if (looksLikeHttpNoise(raw)) {
    return 'We could not reach Suggest Key. Check your connection and try again.';
  }
  if (isTechnicalMessage(raw)) return fallback;

  const trimmed = raw.trim();
  // A one-line sentence of reasonable length is real user-facing copy.
  if (trimmed.length <= 240 && !trimmed.includes('\n') && /[a-z]/i.test(trimmed)) {
    return trimmed;
  }
  return fallback;
}
