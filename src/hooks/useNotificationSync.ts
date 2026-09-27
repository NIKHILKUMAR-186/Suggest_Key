import { useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/src/lib/supabase';

/**
 * Keeps a notification list in step with the real `notifications` table.
 *
 * An admin's payment-verification alert is written server-side the moment a
 * seeker submits a proof, so the queue has to reflect that without a manual
 * refresh. This mirrors the existing `usePaymentSync` and `useAvailabilitySync`
 * approach rather than introducing a new mechanism:
 *
 *   1. one Supabase Realtime channel scoped to this user's own rows,
 *   2. a visibility-gated interval as a fallback for environments without
 *      realtime, plus a revalidation when the tab regains focus.
 *
 * The channel is filtered on `user_id`, and the `notifications` RLS policy is
 * `user_id = auth.uid()`, so a subscriber can only ever be delivered its own
 * rows. There is no aggressive polling: the interval is generous and is skipped
 * entirely while the tab is hidden.
 */
const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 30_000;

export interface NotificationSyncOptions {
  /** The signed-in user. A change to this rebuilds the channel. */
  userId?: string | null;
  /** Called when one of this user's notification rows changed, or on revalidation. */
  onInvalidate: () => void;
  intervalMs?: number;
  enabled?: boolean;
}

export function useNotificationSync({
  userId = null,
  onInvalidate,
  intervalMs = DEFAULT_INTERVAL_MS,
  enabled = true,
}: NotificationSyncOptions): void {
  // Read the latest callback through a ref so re-subscribing is driven purely by
  // userId/enabled, not by a new inline function on every render.
  const handlerRef = useRef<() => void>(() => undefined);
  handlerRef.current = () => onInvalidate();

  useEffect(() => {
    if (!enabled || !userId) return;

    const notify = () => handlerRef.current();
    let channel: RealtimeChannel | null = null;

    if (isSupabaseConfigured()) {
      channel = supabase.channel(`notifications:${userId}`) as RealtimeChannel;

      // INSERT is what a real event produces. UPDATE and DELETE are included so
      // a mark-as-read performed in another tab is reflected too.
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        notify as (payload: unknown) => void,
      );

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
      // Removes every listener registered on the channel, so navigating back and
      // forth cannot accumulate duplicate subscriptions.
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    };
  }, [userId, intervalMs, enabled]);
}
