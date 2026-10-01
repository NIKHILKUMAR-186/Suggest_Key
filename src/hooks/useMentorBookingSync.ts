import { useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/src/lib/supabase';

/**
 * Keeps the mentor bookings ledger synchronised with the server.
 *
 * The overdue transition is the hard case, and it is the reason this hook
 * exists rather than a plain refetch:
 *
 *   OVERDUE is DERIVED, not persisted. Nothing is written to `bookings` when
 *   the deadline passes, so a `postgres_changes` event never fires for it. A
 *   page that only listened to realtime would sit on "Pending Confirmation"
 *   until a human pressed Refresh. The client clock cannot be used to fix that
 *   either, because the bucket is the server's to decide.
 *
 * So the page combines three transports, all funnelling into one refetch:
 *
 *   1. An EXACT boundary timer, scheduled for the nearest deadline among the
 *      rows on screen. This is what makes Pending -> Overdue happen the moment
 *      it should, with no refresh and no waiting for a poll.
 *   2. Supabase Realtime `postgres_changes` on `bookings`, scoped to this
 *      mentor, for the transitions that DO write a row - a confirmation, an
 *      admin cancellation, the end-of-session reconciliation.
 *   3. A visibility-gated interval plus focus/online/pageshow revalidation, for
 *      a socket that dropped events while the machine was asleep, and as the
 *      backstop if realtime is not configured at all.
 *
 * The refetch always re-reads the server's own verdict. Nothing here computes a
 * deadline: it only decides WHEN to ask.
 */
export interface MentorBookingSyncOptions {
  /** Scopes the realtime filter and identifies whose ledger this is. */
  mentorId: string | null;
  /** Called to re-read the authoritative ledger from the server. */
  onInvalidate: () => void;
  /**
   * ISO instants at which some booking's meeting-link deadline expires. Only
   * future ones matter; the nearest is scheduled exactly.
   */
  deadlinesUtc?: readonly (string | null)[];
  /** Backstop revalidation cadence. Only while the tab is visible. */
  intervalMs?: number;
  enabled?: boolean;
}

const DEFAULT_INTERVAL_MS = 45_000;
const MIN_INTERVAL_MS = 15_000;
/** A single edit or reconciliation emits a burst; collapse it into one refetch. */
const BURST_WINDOW_MS = 250;
/**
 * A boundary further out than this cannot be scheduled exactly without holding a
 * timer open for days. The interval backstop still covers it.
 */
const MAX_BOUNDARY_WAIT_MS = 6 * 60 * 60 * 1000;

let channelSequence = 0;

function trace(event: string, fields: Record<string, unknown> = {}): void {
  if (!import.meta.env?.DEV) return;
  console.debug(`[MentorBookingSync] ${event}`, fields);
}

export function useMentorBookingSync({
  mentorId,
  onInvalidate,
  deadlinesUtc = [],
  intervalMs = DEFAULT_INTERVAL_MS,
  enabled = true,
}: MentorBookingSyncOptions): void {
  const handlerRef = useRef<() => void>(() => undefined);
  handlerRef.current = () => onInvalidate();

  // The nearest deadline is the only boundary that can change a tab. A stable
  // string key (rather than the array identity) keeps this effect from
  // rescheduling on every render that happens to build a new array.
  const nextBoundaryKey = (() => {
    const now = Date.now();
    let nearest: number | null = null;
    for (const iso of deadlinesUtc) {
      if (!iso) continue;
      const ms = Date.parse(iso);
      if (!Number.isFinite(ms) || ms <= now) continue;
      if (nearest === null || ms < nearest) nearest = ms;
    }
    return nearest === null ? '' : String(nearest);
  })();

  useEffect(() => {
    if (!enabled || !nextBoundaryKey) return;
    const delay = Number(nextBoundaryKey) - Date.now();
    // A boundary a few hundred milliseconds out still warrants an immediate
    // revalidation, because what the page is showing is already stale.
    const wait = Math.max(delay, 0) + 250;
    const timer = setTimeout(() => handlerRef.current(), Math.min(wait, MAX_BOUNDARY_WAIT_MS));
    return () => clearTimeout(timer);
  }, [nextBoundaryKey, enabled]);

  useEffect(() => {
    if (!enabled) return;

    let burstTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    /**
     * A per-instance topic prevents React StrictMode's mount/teardown/remount
     * from being handed a half-unsubscribed channel, which would silently
     * deliver no events at all. Mirrors `useAvailabilitySync`.
     */
    const topic = `mentor-bookings:${mentorId || 'anonymous'}:${++channelSequence}`;

    const notify = (source?: string) => {
      trace('INVALIDATE', { source: source ?? 'trigger' });
      if (burstTimer) clearTimeout(burstTimer);
      burstTimer = setTimeout(() => {
        burstTimer = null;
        handlerRef.current();
      }, BURST_WINDOW_MS);
    };

    let channel: RealtimeChannel | null = null;

    if (isSupabaseConfigured()) {
      channel = supabase.channel(topic) as RealtimeChannel;
      channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bookings',
          ...(mentorId ? { filter: `mentor_id=eq.${mentorId}` } : {}),
        },
        (payload: any) => {
          trace('REALTIME_EVENT', {
            event: payload?.eventType,
            bookingId: payload?.new?.id ?? payload?.old?.id ?? null,
          });
          notify('bookings');
        }
      );
      channel.subscribe((status: string) => {
        // 'SUBSCRIBED' also fires on reconnect. Anything published while the
        // socket was down was never delivered, so the only safe answer is to
        // re-read.
        if (status === 'SUBSCRIBED') {
          if (settled) {
            trace('RECONNECT', { topic });
            notify();
          }
          settled = true;
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // Not surfaced to the mentor: the interval and the exact boundary
          // timer still cover this page, so a failed socket degrades to polling.
          trace('CHANNEL_DEGRADED', { topic, status });
        }
      });
    }

    const period = Math.max(MIN_INTERVAL_MS, intervalMs);
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      notify();
    }, period);

    const onResume = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      notify();
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onResume);
      window.addEventListener('focus', onResume);
      window.addEventListener('online', onResume);
      window.addEventListener('pageshow', onResume);
    }

    return () => {
      if (timer) clearInterval(timer);
      if (burstTimer) clearTimeout(burstTimer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onResume);
        window.removeEventListener('focus', onResume);
        window.removeEventListener('online', onResume);
        window.removeEventListener('pageshow', onResume);
      }
      if (channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }
    };
  }, [mentorId, intervalMs, enabled]);
}