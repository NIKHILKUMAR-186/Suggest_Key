/**
 * The active segment catalogue, shared by every surface that offers segment
 * navigation.
 *
 * It exists so the header and the seeker page read the SAME real rows through
 * ONE code path. Neither of them owns a selection: the selection is the `slug`
 * in the URL, and this hook only ever answers "which segments exist and what
 * are they called". That is why adding a segment in the database makes it
 * appear in the header with no frontend change, and why no slug is ever
 * hardcoded here.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/src/lib/supabase';
import { logSanitizer } from '@/src/lib/logSanitizer';
import { fetchActiveSegments } from '@/src/lib/discoveryService';
import { toUserMessage } from '@/src/lib/errorMessages';
import type { Segment } from '@/src/types/database';

export interface UseActiveSegmentsResult {
  segments: Segment[];
  isLoading: boolean;
  error: string | null;
  reload: () => void;
}

export function useActiveSegments(): UseActiveSegmentsResult {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Guards every write. An event for a page the visitor has already navigated
  // away from must not repopulate the list they are no longer looking at.
  const isMountedRef = useRef(true);
  isMountedRef.current = true;

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        const { segments: activeSegments, error: segmentError } = await fetchActiveSegments();
        if (segmentError) throw segmentError;
        if (!isMounted) return;
        setSegments(activeSegments);
      } catch (err: unknown) {
        if (!isMounted) return;
        setSegments([]);
        setError(toUserMessage(err, 'Failed to load mentorship segments'));
      } finally {
        if (isMounted) setIsLoading(false);
      }
    })();

    return () => {
      isMounted = false;
      isMountedRef.current = false;
    };
  }, [reloadToken]);

  /**
   * CATALOGUE REALTIME.
   *
   * `public.segments` is already a member of the `supabase_realtime` publication
   * (migration `phase8a_segments_realtime`), and RLS limits public SELECT to
   * `is_active = TRUE`, so an anonymous subscriber only ever receives events for
   * segments that are publicly visible. No policy, grant or publication is
   * changed here.
   *
   * The deliberate design choice is that an event is a SIGNAL, never the data.
   * `useSegmentExperienceRealtime` reads its payload directly because it is
   * scoped to one slug whose row it already knows; this subscription covers the
   * WHOLE catalogue, where an INSERT, a rename, an `is_active` flip and a
   * `priority` change all have to be reflected. Patching from a payload would
   * mean re-deriving the active-only filter and the priority ordering in the
   * browser and trusting the replica to be complete. Instead every event
   * re-reads through the SAME public query the first load used, so the ordered,
   * active-only list is rebuilt by exactly one code path and cannot drift from
   * what a fresh page load would show.
   *
   * Realtime is therefore an accelerator, never the source of truth:
   *   - a dropped subscription leaves the last valid list on screen;
   *   - a failed re-read leaves the previous list rather than blanking it;
   *   - there is no polling, interval or focus refetch anywhere in this hook.
   */
  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    const channel: RealtimeChannel = supabase.channel('active-segments-catalogue');

    // INSERT/UPDATE/DELETE all matter: an admin can publish a new area, rename
    // one, deactivate one or reorder them, and each of those changes what the
    // landing page is allowed to show.
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'segments' },
      () => {
        if (!isMountedRef.current) return;
        void (async () => {
          try {
            const { segments: next, error: segmentError } = await fetchActiveSegments();
            if (!isMountedRef.current) return;
            // A failed re-read keeps the last known-good list. Blanking the
            // catalogue on a transient error would be worse than showing a
            // slightly stale but real set of areas.
            if (segmentError || !next) return;
            setSegments(next);
            setError(null);
          } catch (err) {
            console.error('Error applying segment update:', logSanitizer.safeMessage(err));
          }
        })();
      },
    );

    channel.subscribe();

    return () => {
      // removeChannel detaches the listener, so remounting can never stack up
      // duplicate subscriptions that each fire their own re-read.
      supabase.removeChannel(channel);
    };
  }, []);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return { segments, isLoading, error, reload };
}
