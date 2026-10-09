/**
 * Canonical, framework-agnostic rate-limit state manager.
 *
 * This module is the single source of truth for "is the app currently under a
 * server-granted 429 cooldown". It deliberately lives outside React so that the
 * API client can consult it without a context, and so it can be unit tested
 * without a DOM/renderer.
 *
 * Responsibilities:
 *  - hold the active cooldown (absolute `retryAt` timestamp),
 *  - merge concurrent 429s by keeping the LONGEST cooldown (never shortens),
 *  - short-circuit non-critical requests while a cooldown is active,
 *  - never block critical auth/health flows (server stays authoritative there).
 *
 * The React layer (`RateLimitContext` / `RateLimitBanner`) is a thin view over
 * this manager; there is exactly ONE place that decides "we are rate limited",
 * so five simultaneous 429s produce exactly one banner and one cooldown.
 */

export interface RateLimitState {
  isRateLimited: boolean;
  retryAt: number | null;
  remainingSeconds: number;
  message: string;
}

export interface RateLimitInfo {
  retryAfterSeconds: number;
  retryAt: number;
  message: string;
}

/** Last-resort cooldown (seconds) used ONLY when a 429 response carries no
 *  usable Retry-After header and no usable body field. The server always sends
 *  one, so this path should be rare — it exists to prevent an infinite retry
 *  storm rather than to guess a policy. */
export const RATE_LIMIT_FALLBACK_SECONDS = 60;

export const DEFAULT_RATE_LIMIT_MESSAGE =
  'Too many requests. Please try again shortly.';

export class RateLimitError extends Error {
  readonly name = 'RateLimitError';
  readonly status = 429;
  readonly retryAt: number;
  readonly retryAfterSeconds: number;

  constructor(state: RateLimitState) {
    super(state.message || DEFAULT_RATE_LIMIT_MESSAGE);
    this.retryAt = state.retryAt ?? Date.now() + RATE_LIMIT_FALLBACK_SECONDS * 1000;
    this.retryAfterSeconds = Math.max(
      0,
      Math.ceil((this.retryAt - Date.now()) / 1000),
    );
  }
}

type Listener = () => void;
const listeners = new Set<Listener>();

/** Endpoints that have currently hit a 429 and are suppressed for the duration
 *  of the active cooldown. Kept per-endpoint (not global) so that a 429 on one
 *  resource does not stall unrelated requests: each endpoint extends the single
 *  global cooldown and only the endpoint that produced a 429 is short-circuited. */
let suppressedEndpoints = new Set<string>();

let state: RateLimitState = {
  isRateLimited: false,
  retryAt: null,
  remainingSeconds: 0,
  message: '',
};

let interval: ReturnType<typeof setInterval> | null = null;

function computeRemaining(retryAt: number | null): number {
  if (!retryAt) return 0;
  return Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
}

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function clearInternal(): void {
  state = {
    isRateLimited: false,
    retryAt: null,
    remainingSeconds: 0,
    message: '',
  };
  suppressedEndpoints = new Set();
  stopTimer();
  emit();
}

function startTimer() {
  if (interval) return;
  interval = setInterval(() => {
    if (state.isRateLimited && (Date.now() >= (state.retryAt ?? 0) || computeRemaining(state.retryAt) === 0)) {
      clearInternal();
    } else if (state.isRateLimited) {
      emit();
    }
  }, 1000);
}

function stopTimer() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}

/** Returns a lazily-corrected snapshot. If the cooldown has just expired it is
 *  cleared as a side effect (so callers never observe a 0-second cooldown). */
export function getSnapshot(): RateLimitState {
  if (state.isRateLimited && state.retryAt) {
    const remaining = computeRemaining(state.retryAt);
    if (remaining === 0) {
      clearInternal();
      return { isRateLimited: false, retryAt: null, remainingSeconds: 0, message: '' };
    }
    return { ...state, remainingSeconds: remaining };
  }
  return { isRateLimited: false, retryAt: null, remainingSeconds: 0, message: '' };
}

/** Enter (or extend) the global cooldown. Concurrent 429s never shorten an
 *  active cooldown — the longest `retryAt` always wins, and its message is kept.
 *  A 429 whose `retryAt` is already in the past is treated as a "window elapsed"
 *  signal and clears any active cooldown. The triggering `pathname` (if given)
 *  is registered so re-fetches to that exact endpoint are suppressed while the
 *  cooldown runs, without blocking other endpoints. */
export function enterRateLimit(info: RateLimitInfo, pathname?: string): void {
  const now = Date.now();

  // Expired retryAt => the limit window has elapsed; reset to idle.
  if (info.retryAt <= now) {
    clearInternal();
    return;
  }

  if (pathname) suppressedEndpoints.add(pathname);

  const existingRetryAt = state.retryAt;
  const mergedRetryAt = existingRetryAt
    ? Math.max(existingRetryAt, info.retryAt)
    : info.retryAt;

  // Not extending the active cooldown: keep the current retryAt + message,
  // but still notify listeners in case a banner is mid-countdown.
  if (existingRetryAt && mergedRetryAt === existingRetryAt) {
    startTimer();
    emit();
    return;
  }

  state = {
    isRateLimited: true,
    retryAt: mergedRetryAt,
    remainingSeconds: Math.max(0, Math.ceil((mergedRetryAt - now) / 1000)),
    message: info.message || DEFAULT_RATE_LIMIT_MESSAGE,
  };
  startTimer();
  emit();
}

export function isActiveCooldown(): boolean {
  return getSnapshot().isRateLimited;
}

/** True when `pathname` is currently suppressed (it produced a 429 during the
 *  active cooldown). Critical auth/health flows bypass this at the client. */
export function isEndpointSuppressed(pathname: string): boolean {
  if (!state.isRateLimited) return false;
  return suppressedEndpoints.has(pathname);
}

export function clearRateLimit(): void {
  clearInternal();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Critical flows that must bypass client-side cooldown suppression so the user
 *  can always log out / recover / reach health. The server remains the authority. */
const CRITICAL_PATH_PREFIXES: ReadonlyArray<string> = [
  '/api/auth/',
  '/api/platform-config',
];

/** Normalized pathname key for an endpoint. Exported so the API client and the
 *  manager classify the same URL identically when deciding suppression. */
export function pathnameOf(url: string): string {
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return url;
  }
}

export function isCriticalRequest(url: string): boolean {
  const path = pathnameOf(url);
  if (path === '/api/health') return true;
  return CRITICAL_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export const rateLimitManager = {
  getSnapshot,
  enterRateLimit,
  clear: clearRateLimit,
  isActiveCooldown,
  isEndpointSuppressed,
  subscribe,
};
