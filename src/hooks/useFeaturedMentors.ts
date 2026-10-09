import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchAllMentors,
  fetchMentorDirectoryAvailability,
  type DirectoryMentorAvailability,
} from '@/src/lib/discoveryService';
import { getDateStringInTimezone } from '@/src/lib/slotEngine';
import { useAuth } from '@/src/context/AuthContext';
import type { DirectoryMentor } from '@/src/types/database';

/** Keep every landing-page database page to a maximum of six mentors. */
const FEATURED_PAGE_SIZE = 6;

export interface FeaturedMentor {
  mentor: DirectoryMentor;
  /**
   * Server-computed availability, or null when there is no answer for this
   * mentor. Null is a real, expected outcome \u2014 the slot endpoint requires a
   * session, so a signed-out visitor gets no availability rather than a
   * fabricated one \u2014 and the card renders no time at all in that case.
   */
  availability: DirectoryMentorAvailability | null;
}

export interface UseFeaturedMentorsResult {
  mentors: FeaturedMentor[];
  isLoading: boolean;
  isLoadingMore: boolean;
  /** True only when the mentor query itself failed, not merely when it was empty. */
  hasError: boolean;
  loadMoreError: Error | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  reload: () => void;
}

/**
 * FEATURED MENTORS, FROM THE SAME QUERIES THE DIRECTORY USES.
 *
 * This hook deliberately introduces no eligibility rule of its own. It calls
 * `fetchAllMentors`, which is the shipped directory query: it returns mentors
 * that are approved, active, approval_status = approved, and not suspended or
 * deactivated, and nothing else. It then calls `fetchMentorDirectoryAvailability`,
 * which is the shipped availability read: one call per DISTINCT SEGMENT, from
 * `GET /api/mentor-availability/slots`, the same endpoint mentor detail uses.
 *
 * Two consequences are load-bearing:
 *
 *   1. Availability here CANNOT remove a mentor. `fetchMentorDirectoryAvailability`
 *      returns a map and has no filtering role; the card decides how to draw a
 *      missing answer. Availability-first removal lives only in the discovery
 *      query the seeker's own list uses.
 *   2. Availability is only ever a server value. No slot is generated,
 *      cached or inferred from the browser clock, and no fallback time exists,
 *      so an empty map renders "no time shown", never a plausible-looking slot.
 */
export function useFeaturedMentors(): UseFeaturedMentorsResult {
  const { profile } = useAuth();
  const [mentors, setMentors] = useState<DirectoryMentor[]>([]);
  const [availability, setAvailability] = useState<Map<string, DirectoryMentorAvailability>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<Error | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const loadMoreLock = useRef(false);
  const requestGeneration = useRef(0);

  // The availability date is resolved in the viewer's own timezone, exactly as
  // the directory resolves it, so "today" on this card means the same day it
  // means on the page the visitor is sent to.
  const today = useMemo(
    () => getDateStringInTimezone(new Date(), profile?.timezone || 'Asia/Kolkata'),
    [profile?.timezone]
  );

  useEffect(() => {
    let isActive = true;
    const generation = ++requestGeneration.current;

    (async () => {
      setIsLoading(true);
      setIsLoadingMore(false);
      setHasError(false);
      setLoadMoreError(null);
      setHasMore(false);
      setCursor(null);
      setMentors([]);
      setAvailability(new Map());

      const { mentors: rows, nextCursor, hasMore: pageHasMore, error } = await fetchAllMentors({
        pageSize: FEATURED_PAGE_SIZE,
        strictPageSize: true,
      });

      // A response for a page the visitor has already navigated away from must
      // not write into the list they are no longer looking at.
      if (!isActive) return;

      if (error) {
        setHasError(true);
        setIsLoading(false);
        return;
      }

      setMentors(rows);
      setCursor(nextCursor);
      setHasMore(pageHasMore && Boolean(nextCursor));

      // Availability is a second, optional read. A failure here degrades to
      // "no time shown" on the cards and never fails the section, because the
      // mentor list itself is perfectly usable without it.
      const result = await fetchMentorDirectoryAvailability(rows, today);
      if (!isActive || generation !== requestGeneration.current) return;

      setAvailability(result.byMentorId);
      setIsLoading(false);
    })();

    return () => {
      isActive = false;
      if (requestGeneration.current === generation) requestGeneration.current += 1;
    };
  }, [reloadToken, today]);

  const loadMore = useCallback(async () => {
    if (!cursor || !hasMore || loadMoreLock.current) return;
    loadMoreLock.current = true;
    const generation = requestGeneration.current;
    setIsLoadingMore(true);
    setLoadMoreError(null);

    try {
      const { mentors: rows, nextCursor, hasMore: pageHasMore, error } = await fetchAllMentors({
        cursor,
        pageSize: FEATURED_PAGE_SIZE,
        strictPageSize: true,
      });
      if (generation !== requestGeneration.current) return;
      if (error) {
        setLoadMoreError(error);
        return;
      }

      const existingIds = new Set(mentors.map((mentor) => mentor.id));
      const additions = rows.filter((mentor) => !existingIds.has(mentor.id));
      setMentors((current) => {
        const currentIds = new Set(current.map((mentor) => mentor.id));
        return [...current, ...additions.filter((mentor) => !currentIds.has(mentor.id))];
      });

      const result = await fetchMentorDirectoryAvailability(additions, today);
      if (generation !== requestGeneration.current) return;
      setAvailability((current) => {
        const next = new Map(current);
        result.byMentorId.forEach((value, id) => next.set(id, value));
        return next;
      });
      setCursor(nextCursor);
      setHasMore(pageHasMore && Boolean(nextCursor));
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      const loadError = error instanceof Error ? error : new Error('Unable to load more mentors.');
      setLoadMoreError(loadError);
    } finally {
      loadMoreLock.current = false;
      if (generation === requestGeneration.current) setIsLoadingMore(false);
    }
  }, [cursor, hasMore, mentors, today]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  const featured = useMemo(
    () => mentors.map((mentor) => ({ mentor, availability: availability.get(mentor.id) ?? null })),
    [mentors, availability]
  );

  return {
    mentors: featured,
    isLoading,
    isLoadingMore,
    hasError,
    loadMoreError,
    hasMore,
    loadMore,
    reload,
  };
}