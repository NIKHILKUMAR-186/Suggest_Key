import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchAllMentors,
  fetchMentorDirectoryAvailability,
  type DirectoryMentor,
  type DirectoryMentorAvailability,
} from '@/src/lib/discoveryService';
import { getDateStringInTimezone } from '@/src/lib/slotEngine';
import { useAuth } from '@/src/context/AuthContext';

export interface MentorDirectoryItem {
  mentor: DirectoryMentor;
  availability: DirectoryMentorAvailability | null;
}

export interface UseMentorDirectoryResult {
  mentors: MentorDirectoryItem[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasError: boolean;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

const PAGE_SIZE = 6;

export function useMentorDirectory(): UseMentorDirectoryResult {
  const { profile } = useAuth();
  const [mentors, setMentors] = useState<DirectoryMentor[]>([]);
  const [availability, setAvailability] = useState<Map<string, DirectoryMentorAvailability>>(new Map());
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const today = useMemo(
    () => getDateStringInTimezone(new Date(), profile?.timezone || 'Asia/Kolkata'),
    [profile?.timezone]
  );

  const fetchPage = useCallback(
    async (currentCursor: string | null, isInitial: boolean) => {
      if (isInitial) {
        setIsLoading(true);
      } else {
        setIsLoadingMore(true);
      }
      setHasError(false);

      const { mentors: rows, nextCursor, hasMore: pageHasMore, error } = await fetchAllMentors({
        cursor: currentCursor,
        pageSize: PAGE_SIZE,
      });

      if (error) {
        if (isInitial) {
          setMentors([]);
          setAvailability(new Map());
          setCursor(null);
          setHasMore(false);
          setIsLoading(false);
        } else {
          setIsLoadingMore(false);
        }
        setHasError(true);
        return;
      }

      const visible = rows.slice(0, PAGE_SIZE);

      if (isInitial) {
        setMentors(visible);
        setCursor(pageHasMore ? nextCursor : null);
        setHasMore(pageHasMore);
      } else {
        setMentors((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const newMentors = visible.filter((m) => !existingIds.has(m.id));
          return [...prev, ...newMentors];
        });
        setCursor(pageHasMore ? nextCursor : null);
        setHasMore(pageHasMore);
      }

      const result = await fetchMentorDirectoryAvailability(visible, today);
      if (isInitial) {
        setAvailability(result.byMentorId);
        setIsLoading(false);
      } else {
        setAvailability((prev) => new Map([...prev, ...result.byMentorId]));
        setIsLoadingMore(false);
      }
    },
    [today]
  );

  useEffect(() => {
    let isActive = true;

    (async () => {
      await fetchPage(null, true);

      if (!isActive) return;
    })();

    return () => {
      isActive = false;
    };
  }, [fetchPage, reloadToken]);

  const loadMore = useCallback(() => {
    if (isLoadingMore || !hasMore || !cursor) return;
    fetchPage(cursor, false);
  }, [cursor, fetchPage, hasMore, isLoadingMore]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  const items = useMemo(
    () =>
      mentors.map((mentor) => ({
        mentor,
        availability: availability.get(mentor.id) ?? null,
      })),
    [mentors, availability]
  );

  return {
    mentors: items,
    isLoading,
    isLoadingMore,
    hasError,
    hasMore,
    loadMore,
    reload,
  };
}