/**
 * The topic-filtered mentor list for a segment.
 *
 * A single source of truth for "which mentors should this page show". The
 * filter is applied in the DATABASE, through `gig_topics`, so:
 *
 *   All          -> every eligible mentor with an active gig in the segment
 *   Interviews   -> only mentors whose active gig covers that topic
 *
 * There is no client-side post-filtering of an already-fetched list. That
 * distinction matters: filtering in the browser would also surface mentors
 * whose gig is inactive, and would report counts the database never agreed to.
 *
 * Every state change refetches because the underlying data genuinely changed
 * (a different segment, a different topic, a different date, or an admin
 * edit). That is event- and interaction-driven, never a timer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { logSanitizer } from '@/src/lib/logSanitizer';
import { fetchSegmentMentorsByTopic, type TopicMentor } from '@/src/lib/segmentTopics';

export interface UseSegmentMentorsByTopicResult {
  mentors: TopicMentor[];
  total: number;
  isLoading: boolean;
  error: string | null;
  reload: () => void;
}

export function useSegmentMentorsByTopic(
  segmentSlug: string | null,
  topicSlug: string | null,
  dateStr: string | null = null,
): UseSegmentMentorsByTopicResult {
  const [mentors, setMentors] = useState<TopicMentor[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState<number>(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  // A response for a selection the seeker has already moved on from must not
  // overwrite the current list.
  const requestKeyRef = useRef<string>('');

  useEffect(() => {
    if (!segmentSlug) {
      setMentors([]);
      setTotal(0);
      setError(null);
      setIsLoading(false);
      return;
    }

    const requestKey = `${segmentSlug}|${topicSlug ?? 'all'}|${dateStr ?? ''}`;
    requestKeyRef.current = requestKey;
    let cancelled = false;

    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        const { mentors: rows, error: fetchError } = await fetchSegmentMentorsByTopic(segmentSlug, {
          topicSlug,
          dateStr,
        });
        if (cancelled || requestKeyRef.current !== requestKey) return;
        if (fetchError) throw fetchError;
        setMentors(rows);
        // The count is the server's own, never a locally derived guess.
        setTotal(rows.length);
      } catch (err) {
        if (cancelled || requestKeyRef.current !== requestKey) return;
        console.error('Error loading segment mentors:', logSanitizer.safeMessage(err));
        // A failure must never render as "0 mentors available".
        setMentors([]);
        setTotal(0);
        setError('Unable to load mentors right now.');
      } finally {
        if (!cancelled && requestKeyRef.current === requestKey) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [segmentSlug, topicSlug, dateStr, reloadToken]);

  return { mentors, total, isLoading, error, reload };
}

export default useSegmentMentorsByTopic;