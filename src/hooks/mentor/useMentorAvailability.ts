import { useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '@/src/lib/supabase';
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

  const refetch = useCallback(async () => {
    if (!mentorId) {
      setDays([]);
      setExceptions([]);
      setTimezone('Asia/Kolkata');
      setLoading(false);
      return;
    }

    if (!isSupabaseConfigured()) {
      setDays([]);
      setExceptions([]);
      setTimezone('Asia/Kolkata');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [{ data: availabilityRules, error: availError }, { data: dbExceptions, error: excError }, { data: profile, error: profileError }] = await Promise.all([
        supabase
          .from('mentor_availability')
          .select('*')
          .eq('mentor_id', mentorId)
          .eq('is_enabled', true),
        supabase
          .from('mentor_availability_exceptions')
          .select('*')
          .eq('mentor_id', mentorId),
        supabase
          .from('profiles')
          .select('timezone')
          .eq('id', mentorId)
          .maybeSingle(),
      ]);

      if (availError) throw availError;
      if (excError) throw excError;
      if (profileError) throw profileError;

      if (profile?.timezone) {
        setTimezone(profile.timezone);
      }

      setExceptions(dbExceptions || []);

      const daysList: AvailabilityDay[] = DAYS_OF_WEEK.map(({ name, index }) => {
        const rulesForDay = (availabilityRules || []).filter((a) => a.day_of_week === index);

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
