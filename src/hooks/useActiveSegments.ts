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

import { useCallback, useEffect, useState } from 'react';
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
    };
  }, [reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return { segments, isLoading, error, reload };
}
