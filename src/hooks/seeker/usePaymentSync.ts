import { useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/src/lib/supabase';

/**
 * Keeps a seeker's booking list in step with payment decisions.
 *
 * When an admin approves or rejects a payment, the `payments` and `bookings`
 * rows both change, and My Bookings must reflect that without the seeker
 * reloading the page. This mirrors the existing `useAvailabilitySync` approach:
 *
 *   1. one Supabase Realtime channel scoped to this seeker's rows,
 *   2. a visibility-gated interval as a fallback for environments without
 *      realtime, plus a refetch when the tab regains focus.
 *
 * There is deliberately no aggressive polling: the interval is generous and
 * skipped entirely while the tab is hidden.
 */
const WATCHED_TABLES = ['payments', 'bookings'] as const;

const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 30_000;

export interface PaymentSyncOptions {
  /** The signed-in seeker. Changes to this rebuild the channel. */
  seekerId?: string | null;
  /** Called when a watched row for this seeker changed, or on a timed revalidation. */
  onInvalidate: () => void;
  intervalMs?: number;
  enabled?: boolean;
}

export function usePaymentSync({
  seekerId = null,
  onInvalidate,
  intervalMs = DEFAULT_INTERVAL_MS,
  enabled = true,
}: PaymentSyncOptions): void {
  // Read the latest callback through a ref so re-subscribing is driven purely
  // by seekerId/enabled rather than by a new inline function each render.
  const handlerRef = useRef<() => void>(() => undefined);
  handlerRef.current = () => onInvalidate();

  useEffect(() => {
    if (!enabled || !seekerId) return;

    const notify = () => handlerRef.current();
    let channel: RealtimeChannel | null = null;

    if (isSupabaseConfigured()) {
      channel = supabase.channel(`seeker-payments:${seekerId}`) as RealtimeChannel;

      for (const table of WATCHED_TABLES) {
        // `bookings` carries seeker_id; `payments` carries seeker_id too, so
        // both can be filtered to this seeker and unrelated traffic is dropped.
        channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table, filter: `seeker_id=eq.${seekerId}` },
          notify as (payload: unknown) => void,
        );
      }

      channel.subscribe();
    }

    const period = Math.max(MIN_INTERVAL_MS, intervalMs);
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      notify();
    }, period);

    const revalidate = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      notify();
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', revalidate);
      window.addEventListener('focus', revalidate);
    }

    return () => {
      clearInterval(timer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', revalidate);
        window.removeEventListener('focus', revalidate);
      }
      // Removes every listener registered on the channel, so navigating back
      // and forth cannot accumulate duplicate subscriptions.
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    };
  }, [seekerId, intervalMs, enabled]);
}
