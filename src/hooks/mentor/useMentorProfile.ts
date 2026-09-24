import { useState, useEffect, useCallback } from 'react';
import {
  fetchUserProfile,
  fetchUserRoles,
  upsertUserProfile,
} from '@/src/lib/supabase';
import { getLocalBookingEngineContext } from '@/src/lib/bookingService';
import type { Profile } from '@/src/types/auth';
import type { MentorProfile } from '@/src/types/database';

export interface MentorProfileData {
  profile: Profile | null;
  mentorProfile: MentorProfile | null;
  roles: string[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useMentorProfile(userId: string | undefined): MentorProfileData {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [mentorProfile, setMentorProfile] = useState<MentorProfile | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!userId) {
      setProfile(null);
      setMentorProfile(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { profile: fetchedProfile, error: profileError } = await fetchUserProfile(userId);
      const { roles: fetchedRoles, error: rolesError } = await fetchUserRoles(userId);

      if (profileError) {
        setError(profileError.message);
      } else if (fetchedProfile) {
        setProfile(fetchedProfile);
      }

      if (rolesError) {
        setError(rolesError.message);
      } else if (fetchedRoles.length > 0) {
        setRoles(fetchedRoles);
      }

      const db = getLocalBookingEngineContext();
      const mp = db.mentorProfiles.find((mp) => mp.id === userId);
      if (mp) {
        setMentorProfile(mp);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { profile, mentorProfile, roles, loading, error, refetch };
}

export async function updateMentorProfile(
  userId: string,
  updates: Partial<Profile>
): Promise<{ success: boolean; error: string | null }> {
  try {
    const { error } = await upsertUserProfile({ id: userId, ...updates });
    if (error) return { success: false, error: error.message };
    return { success: true, error: null };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to update profile' };
  }
}
