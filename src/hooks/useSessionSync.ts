import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/src/lib/supabase';

/**
 * Keeps one open session page in step with the server.
 *
 * The spec this implements:
 *   - the browser countdown is presentation only;
 *   - the authoritative state is re-fetched on a slow cadence, on focus, on
 *     visibility change, on network reconnect, and on a Supabase Realtime event
 *     for the single authorized booking;
 *   - the local tick is one cheap state decrement per second, never a request.
 *
 * Two independent mechanisms, because either one alone fails in practice:
 *
 *   Realtime   gives instant cross-tab updates (End Session in tab A repaints
 *              tab B) but silently stops delivering if the socket drops.
 *   Polling    re-syncs every REVALIDATE_MS and on any lifecycle event, so a
 *              dropped socket degrades to a bounded staleness rather than an
 *              indefinitely stale page.
 *
 * The hook deliberately does not decide anything about access. It hands the
 * page a server payload and a corrected clock; every security-sensitive action
 * still round-trips to the server, which re-derives the state itself.
 */

/** Full revalidation cadence while the page is visible. */
const REVALIDATE_MS = 20_000;
/** Local countdown cadence. Costs one state update, never a request. */
const TICK_MS = 1_000;

export interface UseSessionSyncOptions<T> {
  /**
   * Fetches the authoritative payload. Receives a monotonically increasing
   * counter so a manual refresh can force a re-fetch even when React would
   * otherwise see identical inputs.
   */
  fetcher: () => Promise<T>;
  /**
   * The server's clock, ISO-8601, from the same response as the payload. Used
   * to correct the browser clock drift.
   */
  serverNow: string | null | undefined;
  /**
   * Pulls the server clock out of a freshly fetched payload.
   *
   * This exists because `serverNow` alone cannot sample the offset on the very
   * first load. The page's fetcher learns the server time as a side effect of
   * its own `setState`, so React has not re-rendered and `serverNow` is still
   * `null` at the moment `revalidate` would read it. Reading the value straight
   * off the awaited result closes that window instead of leaving the corrected
   * clock equal to the (possibly skewed) browser clock until the first poll.
   */
  getServerNow?: (result: T) => string | null | undefined;
  /** The booking id to watch. Realtime is scoped to this single row. */
  bookingId: string | null | undefined;
  /** Re-subscribe / revalidate when this changes (e.g. after sign-in resolves). */
  enabled?: boolean;
  /** Disable the periodic revalidation (used for detail pages, not session rooms). */
  periodic?: boolean;
}

export interface UseSessionSyncResult<T> {
  data: T | null;
  /** Server-corrected "now", in epoch milliseconds. Feed this to the resolvers. */
  serverNowMs: () => number;
  /** `serverNow - clientNow`, for display of clock drift. */
  offsetMs: () => number;
  loading: boolean;
  error: string | null;
  /** Force an immediate authoritative re-fetch. */
  revalidate: () => Promise<void>;
  /** True while a re-fetch is in flight, so the UI can avoid a spinner flash. */
  refreshing: boolean;
}

export function useSessionSync<T>({
  fetcher,
  serverNow,
  getServerNow,
  bookingId,
  enabled = true,
  periodic = true,
}: UseSessionSyncOptions<T>): UseSessionSyncResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Clock offset, resampled on every successful fetch. Held in a ref because
  // the ticking timer must read it without re-subscribing on each change.
  const offsetRef = useRef<number>(0);

  // Read the latest fetcher/offset through refs so the timers below are
  // registered once instead of on every render.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const serverNowRef = useRef(serverNow);
  serverNowRef.current = serverNow;
  const getServerNowRef = useRef(getServerNow);
  getServerNowRef.current = getServerNow;

  // Forces a re-fetch even if inputs are referentially stable.
  const nonceRef = useRef(0);
  const inFlightRef = useRef(false);

  const serverNowMs = useCallback(() => Date.now() + offsetRef.current, []);
  const offsetMs = useCallback(() => offsetRef.current, []);

  const revalidate = useCallback(async () => {
    // Collapse overlapping requests. A realtime event, a focus event and the
    // poll timer can all fire within the same tick; only one should hit the API.
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    // Only the very first load shows a blocking spinner.
    let isFirstLoad = false;
    setRefreshing((prev) => {
      isFirstLoad = prev === false;
      return true;
    });

    try {
      const result = await fetcherRef.current();
      setData(result);
      setError(null);

      // Resample the clock offset. Guarded so a malformed timestamp leaves the
      // previous offset in place rather than corrupting every countdown.
      //
      // Prefer the timestamp carried by the payload we just received: on the
      // first load `serverNow` is still the pre-fetch `null` because the
      // fetcher's `setState` has not re-rendered yet, so reading the prop alone
      // would silently leave the offset at 0 until the first poll.
      const fromPayload = getServerNowRef.current?.(result);
      const raw = fromPayload ?? serverNowRef.current;
      if (raw) {
        const parsed = new Date(raw).getTime();
        if (Number.isFinite(parsed)) {
          // `parsed` is the server's reading of "now" at the moment the response
          // was produced; `Date.now()` is our reading of the same instant
          // modulo round-trip latency. The difference is the drift to cancel.
          offsetRef.current = parsed - Date.now();
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to reach the session service.');
    } finally {
      inFlightRef.current = false;
      setRefreshing(false);
      if (isFirstLoad) setLoading(false);
    }
  }, []);

  // Initial load + identity changes.
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void revalidate();
  }, [enabled, bookingId, revalidate]);

  // Periodic authoritative revalidation, paused while the tab is hidden.
  useEffect(() => {
    if (!enabled || !periodic) return;
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void revalidate();
    }, REVALIDATE_MS);
    return () => clearInterval(timer);
  }, [enabled, periodic, revalidate]);

  // Local one-second tick, so a visible countdown advances without a request.
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      // Bump the nonce so the page re-renders and re-reads the corrected clock.
      nonceRef.current += 1;
      setData((prev) => (prev === null ? prev : ({ ...prev } as T)));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [enabled]);

  // Re-sync on focus / visibility / reconnect. These are the events that catch
  // a page left open in a background tab across a session's end_time.
  useEffect(() => {
    if (!enabled) return;
    const onWake = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void revalidate();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onWake);
      window.addEventListener('focus', onWake);
      window.addEventListener('online', onWake);
      window.addEventListener('pageshow', onWake);
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onWake);
        window.removeEventListener('focus', onWake);
        window.removeEventListener('online', onWake);
        window.removeEventListener('pageshow', onWake);
      }
    };
  }, [enabled, revalidate]);

  // Targeted realtime subscription.
  //
  // Scoped to `id=eq.<bookingId>` on the single `bookings` row, not to a table
  // or to the user, so unrelated traffic is dropped by the server and RLS still
  // governs what is delivered. This is what repaints tab B when tab A ends the
  // session. Poll revalidation remains the fallback if the socket is down.
  useEffect(() => {
    if (!enabled || !bookingId || !isSupabaseConfigured()) return;

    let channel: RealtimeChannel | null = supabase.channel(`session:${bookingId}`);

    channel = channel.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'bookings',
        filter: `id=eq.${bookingId}`,
      },
      () => {
        void revalidate();
      }
    );

    channel.subscribe();

    return () => {
      // removeChannel detaches every listener, so navigating between session
      // pages cannot accumulate duplicate subscriptions.
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    };
  }, [enabled, bookingId, revalidate]);

  return { data, serverNowMs, offsetMs, loading, error, revalidate, refreshing };
}
