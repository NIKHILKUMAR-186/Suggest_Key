import { useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/src/lib/supabase';

/**
 * The rows the slot engine reads. A change to any of them can change what is
 * bookable, so each one is watched; nothing else is subscribed to.
 */
const WATCHED_TABLES = [
  'mentor_availability',
  'mentor_availability_exceptions',
  'bookings',
  'slot_holds',
  'gigs',
] as const;

export type AvailabilityChangeSource = (typeof WATCHED_TABLES)[number];

export interface AvailabilitySyncOptions {
  /**
   * Restricts every subscription to a single mentor. When supplied, the channel
   * carries `mentor_id=eq.<id>` so a change to an unrelated mentor never
   * triggers a refetch of this page.
   */
  mentorId?: string | null;
  /**
   * Called when a watched row for this mentor changed, or with no argument when
   * the trigger was a timed/visibility revalidation rather than a database
   * event. Callers narrow the refresh either way; the source is informational.
   */
  onInvalidate: (source?: AvailabilityChangeSource) => void;
  /**
   * Conservative fallback revalidation cadence in milliseconds. Realtime covers
   * the mentor's own edits and the caller's own reservations immediately; this
   * covers the remaining case — another seeker's hold quietly expiring, which
   * produces no database event at all. Only one timer is ever created, and only
   * while the tab is visible.
   */
  intervalMs?: number;
  /**
   * ISO instant at which a slot's status is guaranteed to change without any
   * database write: the next hold expiry, or the next slot start (which flips a
   * slot from AVAILABLE to PAST). Scheduling an exact timeout for it means an
   * expiring hold frees its slot immediately instead of up to `intervalMs`
   * later. Pass `null` when there is no such boundary.
   */
  nextBoundaryAt?: string | null;
  enabled?: boolean;
}

const DEFAULT_INTERVAL_MS = 45_000;
const MIN_INTERVAL_MS = 15_000;

/**
 * Keeps one slot/availability view synchronised with the database.
 *
 * Three complementary triggers, all funnelling into the same `onInvalidate`:
 *
 *  1. Supabase Realtime `postgres_changes` on the five slot-engine inputs, scoped
 *     to `mentor_id`. Immediate, targeted, no polling.
 *  2. A conservative visibility-gated interval, for state changes that emit no
 *     event (an expired hold simply becomes ineligible by time).
 *  3. `visibilitychange` / `focus`, so a tab that was backgrounded through a
 *     change revalidates on return.
 *
 * Exactly one channel and at most one interval exist per hook instance, and both
 * are torn down when the mentor changes, the consumer unmounts, or the user
 * leaves the page. Nothing here is a websocket server or a second data source.
 */
export function useAvailabilitySync({
  mentorId = null,
  onInvalidate,
  intervalMs = DEFAULT_INTERVAL_MS,
  nextBoundaryAt = null,
  enabled = true,
}: AvailabilitySyncOptions): void {
  // The latest callback is read through a ref so re-subscribing is driven purely
  // by mentorId/enabled. An inline arrow in a component would otherwise
  // recreate the channel on every render.
  const handlerRef = useRef<() => void>(() => undefined);
  handlerRef.current = () => onInvalidate();

  // ---- Boundary timer -----------------------------------------------------
  // Kept in its own effect so a new response that moves the boundary reschedules
  // exactly one timeout instead of restarting the channel.
  useEffect(() => {
    if (!enabled || !nextBoundaryAt) return;

    const delay = new Date(nextBoundaryAt).getTime() - Date.now();
    if (!Number.isFinite(delay)) return;

    // A boundary in the past (or within a second) still warrants one immediate
    // revalidation, because the data the page is showing is already stale.
    const wait = Math.max(delay, 0) + 250;
    // Cap the wait so a far-future boundary cannot leave the page unsynced
    // indefinitely if the clock is wrong.
    const timer = setTimeout(() => handlerRef.current(), Math.min(wait, 6 * 60 * 60 * 1000));

    return () => clearTimeout(timer);
  }, [nextBoundaryAt, enabled]);

  useEffect(() => {
    if (!enabled) return;

    const notify = () => handlerRef.current();

    // ---- 1. Realtime -------------------------------------------------------
    let channel: RealtimeChannel | null = null;

    if (isSupabaseConfigured()) {
      const topic = `availability:${mentorId || 'all'}`;
      channel = supabase.channel(topic) as RealtimeChannel;

      for (const table of WATCHED_TABLES) {
        // A client-side filter keeps unrelated mentors' traffic off this page.
        // REPLICA IDENTITY FULL on these tables is what makes the filter apply
        // to DELETE events as well as inserts and updates.
        const filter = mentorId
          ? `mentor_id=eq.${mentorId}`
          : undefined;
        channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
          notify as (payload: unknown) => void
        );
      }

      channel.subscribe();
    }

    // ---- 2. Conservative revalidation -------------------------------------
    // A single interval, created once, cleared on cleanup, and skipped entirely
    // while the tab is hidden so a backgrounded page costs nothing.
    const period = Math.max(MIN_INTERVAL_MS, intervalMs);
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      notify();
    }, period);

    // ---- 3. Revalidate when the tab regains focus --------------------------
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      notify();
    };
    const onFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      notify();
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('focus', onFocus);
    }

    return () => {
      if (timer) clearInterval(timer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('focus', onFocus);
      }
      // Removing the channel detaches every listener registered above, so
      // navigating back and forth cannot accumulate duplicate subscriptions.
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    };
  }, [mentorId, intervalMs, enabled]);
}
