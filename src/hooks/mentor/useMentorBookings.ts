import { useCallback } from 'react';
import { usePaginatedQuery } from '@/src/hooks/usePaginatedQuery';
import type { EnrichedBookingRecord } from '@/src/lib/bookingService';
import type { BookingStatus } from '@/src/types/database';

export type MentorBookingsFilter = 'ALL' | BookingStatus | 'all';

export interface UseMentorBookingsResult {
  bookings: EnrichedBookingRecord[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  loadMore: (isLoadMore?: boolean) => Promise<void>;
  hasMore: boolean;
  nextCursor: string | null;
}

interface MentorBookingsResponse {
  bookings: EnrichedBookingRecord[];
  nextCursor: string | null;
  hasMore: boolean;
  pageSize: number;
  serverNow: string;
}

export function useMentorBookings(
  mentorId: string | undefined,
  filter?: MentorBookingsFilter
): UseMentorBookingsResult {
  const statusFilter = filter && filter !== 'ALL' && filter !== 'all' ? filter : undefined;

  const {
    data: bookings = [],
    isLoading,
    error,
    refetch,
    loadMore,
    hasMore,
    nextCursor,
  } = usePaginatedQuery<EnrichedBookingRecord, { status?: string }>({
    url: '/api/mentor/bookings',
    pageSize: 6,
    enabled: !!mentorId,
    params: { status: statusFilter },
  });

  return {
    bookings,
    loading: isLoading,
    error: error?.message || null,
    refetch,
    loadMore,
    hasMore,
    nextCursor,
  };
}
