import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/src/lib/supabase';
import { logSanitizer } from '@/src/lib/logSanitizer';
import { normalizeSegmentExperience, type SegmentExperienceConfig } from '@/src/lib/segmentExperience';

/**
 * The public-safe shape a seeker subscription can receive.
 *
 * Admin-only fields (audit metadata, private notes, credentials) are never
 * exposed here: the server-side GET /api/seeker/segments/:slug/experience
 * already projects only { id, name, slug, experience_config }, and this hook
 * subscribes to the same `segments` row through Realtime, filtered to the
 * public-safe columns.
 */
export interface SegmentExperienceRow {
  id: string;
  name: string;
  slug: string;
  experience_config: SegmentExperienceConfig | null;
}

export interface UseSegmentExperienceRealtimeOptions {
  /** The active segment slug. Changes unsubscribe the old channel and subscribe the new one. */
  slug: string | null;
  /** Called whenever the segment's experience config changes (realtime or otherwise). */
  onConfigChange: (config: SegmentExperienceConfig) => void;
  /** When true, the hook subscribes. Defaults to true. */
  enabled?: boolean;
}

/**
 * Keeps the seeker's segment experience in sync with the live `segments`
 * table through Supabase Realtime.
 *
 * Architecture (per the Phase 8 spec):
 *
 *   Admin updates segment config
 *     -> Supabase database (experience_config JSONB)
 *     -> Realtime postgres_changes on `segments`
 *     -> this hook
 *     -> SegmentExperienceContext / store
 *     -> seeker UI
 *
 * There is NO polling: no setInterval, no focus/visibility refetch timer, and
 * no synthetic re-render. (An earlier draft of this file polled every 60s and
 * pushed an EMPTY config into state, which would have blanked the seeker page on
 * a timer; that behaviour is gone.)
 *
 * The channel is filtered to the selected segment's `slug`, so an admin editing
 * an unrelated segment never touches this tab. When the slug changes the old
 * channel is removed and a new one created — exactly one subscription per slug,
 * cleaned up on unmount.
 *
 * Requires `public.segments` to be a member of the `supabase_realtime`
 * publication; see migration `phase8a_segments_realtime`.
 */
export function useSegmentExperienceRealtime({
  slug,
  onConfigChange,
  enabled = true,
}: UseSegmentExperienceRealtimeOptions): void {
  // The latest callback is read through a ref so re-subscribing is driven purely
  // by slug/enabled. An inline arrow in a component would otherwise recreate the
  // channel on every render.
  const handlerRef = useRef<(config: SegmentExperienceConfig) => void>(() => undefined);
  handlerRef.current = onConfigChange;

  const [lastEvent, setLastEvent] = useState<number>(0);

  useEffect(() => {
    if (!enabled || !slug) return;

    let channel: RealtimeChannel | null = null;

    if (isSupabaseConfigured()) {
      channel = supabase.channel(`segment-experience:${slug}`) as RealtimeChannel;

      channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'segments',
          filter: `slug=eq.${slug}`,
        },
        (payload: any) => {
          // Only react to UPDATE — inserts/deletes for this slug are irrelevant
          // while the seeker is viewing it (a delete would 404 on the next API
          // call, and an insert is a different segment).
          if (payload.eventType !== 'UPDATE') return;
          const row = payload.new;
          if (!row) return;
          const config = normalizeSegmentExperience(row.experience_config);
          handlerRef.current(config);
          setLastEvent(Date.now());
        },
      );

      channel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          // No-op: the channel is live; subsequent events flow through the
          // handler above. Kept as a hook for diagnostics if needed.
        }
      });
    }

    // No polling. A previous version of this hook ran a 60s setInterval whose
    // callback pushed `normalizeSegmentExperience(undefined)` — an EMPTY config —
    // into the seeker's state, which would have wiped the rendered experience on
    // a timer. Updates now arrive only from a real postgres_changes event.
    //
    // If realtime is unavailable, the page keeps whatever it fetched initially
    // rather than being emptied.

    return () => {
      // Removing the channel detaches every listener registered above, so
      // switching segments cannot accumulate duplicate subscriptions.
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    };
  }, [slug, enabled]);
}

/** Re-export for consumers that want the normalised type without a second import. */
export type { SegmentExperienceConfig };