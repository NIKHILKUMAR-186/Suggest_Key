import type { User, Session } from '@supabase/supabase-js';
import type { MentorOnboardingData } from '@/src/types/database';

export type UserRole = 'seeker' | 'mentor' | 'admin';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  avatar_url?: string | null;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface UserRoleRecord {
  id: string;
  user_id: string;
  role: UserRole;
  created_at: string;
}

export interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  roles: UserRole[];
  /**
   * Primary role resolved from `user_roles`, or `null` when the database has no
   * role row for the account. `null` is a real state, not a fallback: it must
   * never be defaulted to a role, or the UI would grant a role the server does
   * not recognise.
   */
  activeRole: UserRole | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isConfigured: boolean;
  error: string | null;
  pendingEmail: string | null;
  onboardingStatus: MentorOnboardingData | null;
  signInWithPassword: (email: string, password: string) => Promise<{ error: Error | null; role?: UserRole }>;
  signInWithGoogle: () => Promise<{ error: Error | null }>;
  signInWithDemoPersona: (persona: UserRole) => Promise<{ error: Error | null; role?: UserRole }>;
  requestPasswordReset: (email: string) => Promise<{ error: Error | null }>;
  updatePassword: (password: string) => Promise<{ error: Error | null }>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
    requestedRole?: UserRole
  ) => Promise<{ error: Error | null; user?: User | null }>;
  resendVerification: (email: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  hasRole: (role: UserRole) => boolean;
  clearError: () => void;
}
