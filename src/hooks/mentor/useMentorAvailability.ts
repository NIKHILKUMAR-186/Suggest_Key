import { useState, useEffect, useCallback } from 'react';
import { getLocalBookingEngineContext } from '@/src/lib/bookingService';
import type {
  MentorAvailability,
  MentorAvailabilityException,
} from '@/src/types/database';
import { DAYS_OF_WEEK } from '@/src/config/app';

export interface AvailabilityDay {
  dayName: string;
  dayIndex: number;
  enabled: boolean;
  windows: { start: string; end: string }[];
  ruleId?: string;
}

export interface UseMentorAvailabilityResult {
  timezone: string;
  days: AvailabilityDay[];
  exceptions: MentorAvailabilityException[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useMentorAvailability(mentorId: string | undefined): UseMentorAvailabilityResult {
  const [days, setDays] = useState<AvailabilityDay[]>([]);
  const [exceptions, setExceptions] = useState<MentorAvailabilityException[]>([]);
  const [timezone, setTimezone] = useState<string>('Asia/Kolkata');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    if (!mentorId) {
      setDays([]);
      setExceptions([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const db = getLocalBookingEngineContext();

      const availabilityRules = db.mentorAvailability.filter(
        (a) => a.mentor_id === mentorId && a.is_enabled
      );

      const dbExceptions = db.mentorAvailabilityExceptions.filter(
        (e) => e.mentor_id === mentorId
      );

      setExceptions(dbExceptions);

      const daysList: AvailabilityDay[] = DAYS_OF_WEEK.map(({ name, index }) => {
        const rulesForDay = availabilityRules.filter((a) => a.day_of_week === index);

        const windows = rulesForDay.map((r) => ({
          start: r.start_time.slice(0, 5),
          end: r.end_time.slice(0, 5),
        }));

        const enabled = rulesForDay.length > 0;

        return {
          dayName: name,
          dayIndex: index,
          enabled,
          windows,
          ruleId: rulesForDay[0]?.id,
        };
      });

      setDays(daysList);

      const profileTz = db.profiles.find((p) => p.id === mentorId)?.timezone;
      if (profileTz) {
        setTimezone(profileTz);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load availability');
    } finally {
      setLoading(false);
    }
  }, [mentorId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { timezone, days, exceptions, loading, error, refetch };
}
