/**
 * Live segment topics for the seeker.
 *
 * Two responsibilities, kept separate because they have different lifecycles:
 *
 *  1. INITIAL LOAD. Fetches the segment's active topics once per segment id,
 *     through the public endpoint. A failure yields an empty list plus an
 *     error, so the bar renders "All" alone rather than inventing chips.
 *
 *  2. LIVE UPDATES. Subscribes to `segment_topics` for this segment over
 *     Supabase Realtime, so an admin adding or retiring a topic updates an
 *     already-open page with no refresh.
 *
 * There is NO POLLING. No setInterval, no focus refetch, no self-triggering
 * effect: updates are event-driven only. The channel is removed on unmount and
 * whenever the segment changes, so exactly one subscription exists per
 * segment and no listener can accumulate.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/src/lib/supabase';
import { logSanitizer } from '@/src/lib/logSanitizer';
import {
  fetchSegmentTopicsRealtime,
  toTopicViews,
  type SegmentTopic,
  type SegmentTopicView,
} from '@/src/lib/segmentTopics';

export interface UseSegmentTopicsResult {
  topics: SegmentTopicView[];
  isLoading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * @param segmentId    The active segment's id (null while none is selected).
 * @param segmentSlug  The same segment's slug, used for the initial fetch.
 */
export function useSegmentTopics(
  segmentId: string | null,
  segmentSlug: string | null,
): UseSegmentTopicsResult {
  const [topics, setTopics] = useState<SegmentTopicView[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(segmentId));
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState<number>(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  // Guards every state write: a response for a segment the seeker has already
  // navigated away from must not overwrite the current list.
  const activeSegmentRef = useRef<string | null>(segmentId);
  activeSegmentRef.current = segmentId;

  useEffect(() => {
    if (!segmentId || !segmentSlug) {
      setTopics([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        const rows = await fetchSegmentTopicsRealtime(segmentId);
        if (cancelled || activeSegmentRef.current !== segmentId) return;
        setTopics(toTopicViews(rows));
      } catch (err) {
        if (cancelled || activeSegmentRef.current !== segmentId) return;
        console.error('Error loading segment topics:', logSanitizer.safeMessage(err));
        setError('Unable to load topics for this area.');
        setTopics([]);
      } finally {
        if (!cancelled && activeSegmentRef.current === segmentId) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [segmentId, segmentSlug, reloadToken]);

  useEffect(() => {
    if (!segmentId || !isSupabaseConfigured()) return;

    let channel: RealtimeChannel | null = supabase.channel(`segment-topics:${segmentId}`);

    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'segment_topics',
        filter: `segment_id=eq.${segmentId}`,
      },
      () => {
        // The payload shape is not fully under our control, so the list is
        // re-read through the same guarded path rather than patched in place.
        // A refetch is NOT polling: it happens only when the database says
        // something changed.
        if (activeSegmentRef.current !== segmentId) return;
        void (async () => {
          try {
            const rows = await fetchSegmentTopicsRealtime(segmentId);
            if (activeSegmentRef.current !== segmentId) return;
            setTopics(toTopicViews(rows));
            setError(null);
          } catch (err) {
            console.error('Error applying topic update:', logSanitizer.safeMessage(err));
          }
        })();
      },
    );

    channel.subscribe();

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    };
  }, [segmentId]);

  return { topics, isLoading, error, reload };
}

export type { SegmentTopic };
export default useSegmentTopics;