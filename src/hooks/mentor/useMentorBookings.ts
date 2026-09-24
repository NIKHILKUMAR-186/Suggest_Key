import { useState, useEffect, useCallback } from 'react';
import { fetchMentorBookings, EnrichedBookingRecord } from '@/src/lib/bookingService';
import type { BookingStatus } from '@/src/types/database';

export type MentorBookingsFilter = 'ALL' | BookingStatus | 'all';

export interface UseMentorBookingsResult {
  bookings: EnrichedBookingRecord[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useMentorBookings(
  mentorId: string | undefined,
  filter?: MentorBookingsFilter
): UseMentorBookingsResult {
  const [bookings, setBookings] = useState<EnrichedBookingRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!mentorId) {
      setBookings([]);
      return;
    }

    const statusFilter = filter && filter !== 'ALL' && filter !== 'all' ? filter : undefined;

    setLoading(true);
    setError(null);
    try {
      const data = await fetchMentorBookings(mentorId, statusFilter);
      setBookings(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load bookings');
    } finally {
      setLoading(false);
    }
  }, [mentorId, filter]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { bookings, loading, error, refetch };
}
