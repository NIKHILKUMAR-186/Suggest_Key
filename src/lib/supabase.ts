import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Profile, UserRole } from '@/src/types/auth';

const getEnvVar = (key: string): string | undefined => {
  try {
    if (typeof import.meta !== 'undefined' && (import.meta as any)?.env?.[key]) {
      return (import.meta as any).env[key];
    }
  } catch {
    // Ignore in runtimes where import.meta.env is inaccessible
  }
  try {
    if (typeof process !== 'undefined' && process?.env?.[key]) {
      return process.env[key];
    }
  } catch {
    // Ignore
  }
  return undefined;
};

const supabaseUrl = getEnvVar('VITE_SUPABASE_URL');
const supabaseAnonKey = getEnvVar('VITE_SUPABASE_ANON_KEY');

export const isSupabaseConfigured = (): boolean => {
  if (!supabaseUrl || !supabaseAnonKey) return false;
  if (supabaseUrl.includes('your-project.supabase.co') || supabaseAnonKey.includes('your-anon-key')) {
    return false;
  }
  try {
    const url = new URL(supabaseUrl);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
};

// Safe fallback URL for client initialization if environment is not yet connected
const safeUrl = (isSupabaseConfigured() && supabaseUrl) ? supabaseUrl : 'https://placeholder.supabase.co';
const safeKey = (isSupabaseConfigured() && supabaseAnonKey) ? supabaseAnonKey : 'placeholder-anon-key';

export const supabase: SupabaseClient = createClient(safeUrl, safeKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/**
 * Fetch authoritative user profile from `profiles` table.
 * Secured by RLS policy: users can view own profile or approved mentor profiles or admin.
 */
export async function fetchUserProfile(userId: string): Promise<{ profile: Profile | null; error: Error | null }> {
  if (!isSupabaseConfigured()) {
    return { profile: null, error: new Error('Supabase is not configured') };
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) throw error;
    return { profile: data as Profile | null, error: null };
  } catch (err: any) {
    console.error('Error fetching user profile from profiles table:', err);
    return { profile: null, error: err };
  }
}

/**
 * Fetch authoritative roles assigned to the user from `user_roles` table.
 * Secured by RLS policy: auth.uid() = user_id or is_admin().
 */
export async function fetchUserRoles(userId: string): Promise<{ roles: UserRole[]; error: Error | null }> {
  if (!isSupabaseConfigured()) {
    return { roles: [], error: new Error('Supabase is not configured') };
  }

  try {
    const { data, error } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId);

    if (error) throw error;
    const roles = (data || []).map((r: { role: UserRole }) => r.role);
    return { roles, error: null };
  } catch (err: any) {
    console.error('Error fetching user roles from user_roles table:', err);
    return { roles: [], error: err };
  }
}

/**
 * Upsert user profile (RLS: auth.uid() = id).
 */
export async function upsertUserProfile(profile: Partial<Profile> & { id: string }): Promise<{ error: Error | null }> {
  if (!isSupabaseConfigured()) {
    return { error: new Error('Supabase is not configured') };
  }

  try {
    const { error } = await supabase
      .from('profiles')
      .upsert({
        id: profile.id,
        full_name: profile.full_name,
        email: profile.email,
        timezone: profile.timezone || 'Asia/Kolkata',
        avatar_url: profile.avatar_url || null,
        updated_at: new Date().toISOString(),
      });

    if (error) throw error;
    return { error: null };
  } catch (err: any) {
    return { error: err };
  }
}
