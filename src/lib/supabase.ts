import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Profile, UserRole } from '@/src/types/auth';
import { logSanitizer } from '@/src/lib/logSanitizer';

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
    console.error('Error fetching user profile from profiles table:', logSanitizer.safeMessage(err));
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
    console.error('Error fetching user roles from user_roles table:', logSanitizer.safeMessage(err));
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

const PROFILE_PHOTOS_BUCKET = 'profile-photos';
const PROFILE_PHOTOS_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const PROFILE_PHOTOS_MAX_BYTES = 5 * 1024 * 1024;
const PROFILE_PHOTOS_ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'webp'];

/**
 * Generate a unique storage path for a profile photo.
 * Format: profile-photos/{userId}/{unique-id}.webp
 * Using unique paths prevents CDN/browser cache collisions during replacement.
 */
function profilePhotoStoragePath(userId: string): string {
  const uniqueId = crypto.randomUUID();
  return `${userId}/${uniqueId}.webp`;
}

/**
 * Extract the user ID from a profile photo storage path.
 * Path format: {userId}/{filename}
 */
function extractUserIdFromPath(path: string): string | null {
  const parts = path.split('/');
  return parts.length >= 1 ? parts[0] : null;
}

/**
 * Client-side guard before upload. The storage bucket enforces the same rules
 * server-side (allowed_mime_types, file_size_limit), but validating here lets us
 * surface a clear user-facing message instead of a raw storage error.
 */
export function validateProfilePhoto(file: File): { ok: boolean; error: string | null } {
  if (!PROFILE_PHOTOS_ALLOWED_MIME.includes(file.type)) {
    return { ok: false, error: 'Please upload a JPG, PNG, or WebP image up to 5 MB.' };
  }
  if (file.size > PROFILE_PHOTOS_MAX_BYTES) {
    return { ok: false, error: 'Please upload a JPG, PNG, or WebP image up to 5 MB.' };
  }
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (!ext || !PROFILE_PHOTOS_ALLOWED_EXT.includes(ext)) {
    return { ok: false, error: 'Please upload a JPG, PNG, or WebP image up to 5 MB.' };
  }
  return { ok: true, error: null };
}

/**
 * Upload a profile photo for the current user.
 *
 * The old avatar is NOT deleted here: the caller updates `profiles.avatar_url`
 * first and only then removes the previous object, so a failed upload or DB
 * write never leaves the mentor without their existing photo.
 */
export async function uploadProfilePhoto(userId: string, file: File): Promise<{ path: string | null; error: Error | null }> {
  if (!isSupabaseConfigured()) {
    return { path: null, error: new Error('Supabase is not configured') };
  }

  const validation = validateProfilePhoto(file);
  if (!validation.ok) {
    return { path: null, error: new Error(validation.error ?? 'Invalid file.') };
  }

  const path = profilePhotoStoragePath(userId);

  try {
    const { error } = await supabase.storage.from(PROFILE_PHOTOS_BUCKET).upload(path, file, {
      upsert: false,
      contentType: file.type,
    });

    if (error) throw error;
    return { path, error: null };
  } catch (err: any) {
    return { path: null, error: err };
  }
}

/**
 * Delete the current user's profile photo.
 *
 * Pass `keepPath` (the freshly uploaded object) to preserve it while removing any
 * previous avatar of a different extension — used by the replace flow after
 * `profiles.avatar_url` has already been updated to point at the new photo.
 */
export async function deleteProfilePhoto(userId: string, keepPath?: string | null): Promise<{ error: Error | null }> {
  if (!isSupabaseConfigured()) {
    return { error: new Error('Supabase is not configured') };
  }

  const prefix = `${userId}/`;
  try {
    const { data: existing, error: listError } = await supabase.storage
      .from(PROFILE_PHOTOS_BUCKET)
      .list(prefix, { limit: 100 });

    if (listError) throw listError;

    const files = (existing || [])
      .filter((item) => !item.id)
      .filter((item) => `${prefix}${item.name}` !== keepPath)
      .map((item) => `${prefix}${item.name}`);

    if (files.length === 0) {
      return { error: null };
    }

    const { error: removeError } = await supabase.storage.from(PROFILE_PHOTOS_BUCKET).remove(files);
    if (removeError) throw removeError;
    return { error: null };
  } catch (err: any) {
    return { error: err };
  }
}

/**
 * Return a SIGNED URL for a profile photo path in the PRIVATE profile-photos bucket.
 * The URL expires after 1 hour (3600 seconds) by default.
 * This is required because the bucket is private and not publicly accessible.
 */
export async function getProfilePhotoSignedUrl(path: string | null, expiresIn: number = 3600): Promise<string | null> {
  if (!isSupabaseConfigured() || !path) {
    return null;
  }

  try {
    const { data, error } = await supabase.storage.from(PROFILE_PHOTOS_BUCKET).createSignedUrl(path, expiresIn);
    if (error) throw error;
    return data.signedUrl;
  } catch (err: any) {
    console.error('Failed to sign profile photo URL:', err.message);
    return null;
  }
}
