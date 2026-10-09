import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/src/lib/supabase';
import { useRateLimitCheck } from '@/src/hooks/useRateLimitCheck';

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

const REVALIDATE_MS = 20_000;
const TICK_MS = 1_000;

export interface UseSessionSyncOptions<T> {
  fetcher: () => Promise<T>;
  serverNow: string | null | undefined;
  getServerNow?: (result: T) => string | null | undefined;
  bookingId: string | null | undefined;
  enabled?: boolean;
  periodic?: boolean;
}

export interface UseSessionSyncResult<T> {
  data: T | null;
  serverNowMs: () => number;
  offsetMs: () => number;
  loading: boolean;
  error: string | null;
  revalidate: () => Promise<void>;
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
  
  const { isRateLimited } = useRateLimitCheck();

  const offsetRef = useRef<number>(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const serverNowRef = useRef(serverNow);
  serverNowRef.current = serverNow;
  const getServerNowRef = useRef(getServerNow);
  getServerNowRef.current = getServerNow;
  const nonceRef = useRef(0);
  const inFlightRef = useRef(false);

  const serverNowMs = useCallback(() => Date.now() + offsetRef.current, []);
  const offsetMs = useCallback(() => offsetRef.current, []);

  const revalidate = useCallback(async () => {
    if (inFlightRef.current) return;
    if (isRateLimited) return; // Skip revalidation if rate limited
    inFlightRef.current = true;

    let isFirstLoad = false;
    setRefreshing((prev) => {
      isFirstLoad = prev === false;
      return true;
    });

    try {
      const result = await fetcherRef.current();
      setData(result);
      setError(null);

      const fromPayload = getServerNowRef.current?.(result);
      const raw = fromPayload ?? serverNowRef.current;
      if (raw) {
        const parsed = new Date(raw).getTime();
        if (Number.isFinite(parsed)) {
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
  }, [isRateLimited]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void revalidate();
  }, [enabled, bookingId, revalidate]);

  useEffect(() => {
    if (!enabled || !periodic) return;
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (isRateLimited) return; // Skip if rate limited
      void revalidate();
    }, REVALIDATE_MS);
    return () => clearInterval(timer);
  }, [enabled, periodic, revalidate, isRateLimited]);

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      nonceRef.current += 1;
      setData((prev) => (prev === null ? prev : ({ ...prev } as T)));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const onWake = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (isRateLimited) return;
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
  }, [enabled, revalidate, isRateLimited]);

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
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    };
  }, [enabled, bookingId, revalidate]);

  return { data, serverNowMs, offsetMs, loading, error, revalidate, refreshing };
}