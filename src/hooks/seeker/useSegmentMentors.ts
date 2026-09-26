import { useCallback, useEffect, useState } from 'react';
import { fetchAllMentors } from '@/src/lib/discoveryService';
import type { DirectoryMentor } from '@/src/types/database';

/**
 * How many segment mentors the discovery section shows at once.
 *
 * `fetchAllMentors` already caps pageSize at 50, and the section is a
 * "browse the top of this segment" view, so a bounded first page keeps the
 * query and the layout honest instead of pretending to render everything.
 */
export const SEGMENT_MENTOR_PAGE_SIZE = 24;

export interface UseSegmentMentorsResult {
  mentors: DirectoryMentor[];
  /** Real total from the existing query's count, never a local guess. */
  total: number;
  isLoading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Loads every real mentor belonging to the selected segment, regardless of
 * whether they have a slot on the selected date.
 *
 * This reuses the existing, already-shipped `fetchAllMentors` data source —
 * the same one the `/mentors` directory page uses. Deliberately NO date is
 * passed, so availability is never applied here: the selected date filters the
 * "Available" section only.
 */
export function useSegmentMentors(segmentId: string | null): UseSegmentMentorsResult {
  const [mentors, setMentors] = useState<DirectoryMentor[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState<number>(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let isMounted = true;

    if (!segmentId) {
      setMentors([]);
      setTotal(0);
      setError(null);
      setIsLoading(false);
      return;
    }

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const { mentors: rows, pagination, error: fetchErr } = await fetchAllMentors({
          segmentId,
          page: 1,
          pageSize: SEGMENT_MENTOR_PAGE_SIZE,
        });
        if (fetchErr) throw fetchErr;
        if (!isMounted) return;
        setMentors(rows);
        // `pagination.total` is the server's own count, so the badge always
        // reflects the real size of the segment rather than the page length.
        setTotal(typeof pagination.total === 'number' ? pagination.total : rows.length);
      } catch (err) {
        if (!isMounted) return;
        console.error('Error loading segment mentors:', err);
        // A failure must never be rendered as "0 mentors".
        setMentors([]);
        setTotal(0);
        setError('Unable to load mentors in this segment right now.');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [segmentId, reloadToken]);

  return { mentors, total, isLoading, error, reload };
}