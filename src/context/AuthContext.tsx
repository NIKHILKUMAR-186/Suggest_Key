import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import type { Profile, UserRole, AuthContextType } from '@/src/types/auth';
import { supabase, isSupabaseConfigured, fetchUserProfile, fetchUserRoles, upsertUserProfile } from '@/src/lib/supabase';
import { apiFetch } from '@/src/lib/apiClient';

const isDevMode = process.env.NODE_ENV !== 'production';

interface DemoAuthResponse {
  user: { id: string; email: string };
  profile: Profile;
    roles: UserRole[];
    activeRole: UserRole;
    token: string;
  }


import type { MentorOnboardingData } from '@/src/types/database';


const DEMO_AUTH_STORAGE_KEY = 'suggestkey_demo_auth';
const LEGACY_DEMO_AUTH_STORAGE_KEY = 'suggestkey_demo_auth_user';
const DEMO_LOGIN_URL = '/api/auth/demo-login';

const isUserRole = (value: unknown): value is UserRole => {
  return value === 'seeker' || value === 'mentor' || value === 'admin';
};

const isDemoAuthResponse = (value: unknown): value is DemoAuthResponse => {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<DemoAuthResponse>;
  return !!data.user &&
    typeof data.user.id === 'string' &&
    typeof data.user.email === 'string' &&
    !!data.profile &&
    typeof data.profile.id === 'string' &&
    typeof data.profile.email === 'string' &&
    typeof data.profile.full_name === 'string' &&
    typeof data.profile.timezone === 'string' &&
    typeof data.profile.created_at === 'string' &&
    typeof data.profile.updated_at === 'string' &&
    Array.isArray(data.roles) &&
    data.roles.every(isUserRole) &&
    isUserRole(data.activeRole) &&
    typeof data.token === 'string';
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [activeRoleState, setActiveRoleState] = useState<UserRole | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [isConfigured] = useState<boolean>(isSupabaseConfigured());
  const [onboardingStatus, setOnboardingStatus] = useState<MentorOnboardingData | null>(null);

  const setDemoAuth = (data: DemoAuthResponse) => {
    setUser(data.user as unknown as User);
    setSession(null);
    setProfile(data.profile);
    setRoles(data.roles);
    setActiveRoleState(data.activeRole);
    try {
      localStorage.setItem(DEMO_AUTH_STORAGE_KEY, JSON.stringify(data));
    } catch {
    }
  };

  const restoreDemoAuth = () => {
    try {
      const saved = localStorage.getItem(DEMO_AUTH_STORAGE_KEY);
      if (!saved) return false;
      const parsed = JSON.parse(saved);
      if (!isDemoAuthResponse(parsed)) {
        localStorage.removeItem(DEMO_AUTH_STORAGE_KEY);
        return false;
      }
      setDemoAuth(parsed);
      return true;
    } catch {
      return false;
    }
  };

  const clearDemoAuth = () => {
    try {
      localStorage.removeItem(DEMO_AUTH_STORAGE_KEY);
    } catch {
    }
  };

  const requestDemoLogin = async (body: Record<string, string>): Promise<{ error: Error | null; data?: DemoAuthResponse }> => {
    if (!isDevMode) {
      return { error: new Error('Demo login is unavailable in production.') };
    }
    try {
      const response = await fetch(DEMO_LOGIN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) return { error: new Error('Invalid demo credentials') };
      const data: unknown = await response.json();
      if (!isDemoAuthResponse(data)) return { error: new Error('Invalid demo login response') };
      return { error: null, data };
    } catch {
      return { error: new Error('Demo login is unavailable') };
    }
  };

  /**
   * Resolve the canonical role set for a signed-in user.
   *
   * `user_roles` is the ONLY source of truth, exactly as the server resolves it
   * in `requireAuth`. This function must never invent a role: the previous
   * `userRoles.length > 0 ? userRoles : ['seeker']` fallback granted every
   * role-less account a phantom seeker role, which put unprivileged accounts
   * into the seeker shell where every write was then rejected server-side with
   * "Role 'seeker' required." A role-less account now honestly reports no
   * roles and is routed to the unauthorized state instead.
   */
  const loadUserData = useCallback(async (supabaseUser: User): Promise<UserRole | null> => {
    let primary: UserRole | null = null;
    try {
      // 1. Fetch Profile
      let { profile: userProfile } = await fetchUserProfile(supabaseUser.id);
      if (!userProfile) {
        // Create initial profile if missing
        const newProfile: Profile = {
          id: supabaseUser.id,
          email: supabaseUser.email || '',
          full_name:
            supabaseUser.user_metadata?.full_name ||
            supabaseUser.email?.split('@')[0] ||
            'Platform User',
          timezone: supabaseUser.user_metadata?.timezone || 'Asia/Kolkata',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        await upsertUserProfile(newProfile);
        userProfile = newProfile;
      }
      setProfile(userProfile);

      // 2. Fetch User Roles from user_roles table (server-authoritative)
      const { roles: userRoles, error: rolesError } = await fetchUserRoles(supabaseUser.id);
      if (rolesError) {
        // A failed role lookup must NOT be treated as "no roles" and must NOT
        // fall back to a default role. Surface the failure instead of guessing.
        console.error('Unable to resolve user roles:', rolesError);
        setRoles([]);
        setActiveRoleState(null);
        return null;
      }

      const effectiveRoles: UserRole[] = userRoles;
      setRoles(effectiveRoles);

      // 3. Set Active Role (from database, never frontend-assigned)
      primary = effectiveRoles.includes('admin')
        ? 'admin'
        : effectiveRoles.includes('mentor')
          ? 'mentor'
          : effectiveRoles.includes('seeker')
            ? 'seeker'
            : null;
      setActiveRoleState(primary);
    } catch (err: any) {
      console.error('Error loading Supabase user data:', err);
    }
    return primary;
  }, []);

  // Initialize Session
  useEffect(() => {
    let isMounted = true;

    async function initAuth() {
      // A stored development demo token must never shadow a real Supabase
      // session. Restoring it unconditionally let a stale localStorage value
      // decide who the API believed the caller was, and therefore which role
      // the server resolved. It is only honoured when there is no database.
      const restoredDemoSession = isConfigured ? false : restoreDemoAuth();

      if (isConfigured) {
        try {
          {
            const { data: { session: currentSession } } = await supabase.auth.getSession();
            if (isMounted) {
              if (currentSession?.user) {
                setSession(currentSession);
                setUser(currentSession.user);
                await loadUserData(currentSession.user);
              } else {
                setSession(null);
                setUser(null);
                setProfile(null);
                setRoles([]);
                setActiveRoleState(null);
              }
            }
          }
        } catch (err: any) {
          console.error('Supabase getSession error:', err);
        } finally {
          if (isMounted) setIsLoading(false);
        }

        // Listen for Auth changes. When a database is configured, every event
        // is honoured: the real session is the only identity that counts, so a
        // leftover demo entry in localStorage can no longer freeze the UI on a
        // stale user.
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
          async (event, newSession) => {
            if (!isMounted) return;
            setSession(newSession);
            if (newSession?.user) {
              setUser(newSession.user);
              await loadUserData(newSession.user);
            } else {
              setUser(null);
              setProfile(null);
              setRoles([]);
              setActiveRoleState(null);
            }
            setIsLoading(false);
          }
        );

        return () => {
          subscription.unsubscribe();
        };
      } else {
        // Fallback: Check local storage for simulated active user (DEV ONLY)
        if (!restoredDemoSession) {
          try {
            const savedDemoKey = localStorage.getItem(LEGACY_DEMO_AUTH_STORAGE_KEY);
            if (savedDemoKey && isMounted) {
              const demoProfile: Profile = {
                id: savedDemoKey,
                email: savedDemoKey,
                full_name: savedDemoKey,
                timezone: 'Asia/Kolkata',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              };
              setUser(demoProfile as unknown as User);
              setProfile(demoProfile);
              // No Supabase connection exists in this branch, so there is no
              // `user_roles` table to read. This is a local preview identity
              // only and is never used when a database is configured.
              setRoles(['seeker']);
              setActiveRoleState('seeker');
            }
          } catch {
            // localStorage access disabled
          }
        }
        if (isMounted) setIsLoading(false);
      }
    }

    initAuth();

    return () => {
      isMounted = false;
    };
  }, [isConfigured, loadUserData]);

  // Sign In with email & password
  const signInWithPassword = async (email: string, password: string): Promise<{ error: Error | null; role?: UserRole }> => {
    setError(null);
    setIsLoading(true);

    // Try demo login first (dev only)
    if (isDevMode) {
      const demoResult = await requestDemoLogin({ email: email.trim(), password });
      if (!demoResult.error && demoResult.data) {
        setDemoAuth(demoResult.data);
        setIsLoading(false);
        return { error: null, role: demoResult.data.activeRole };
      }
    }

    if (isConfigured) {
      clearDemoAuth();
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(signInError.message);
        setIsLoading(false);
        return { error: signInError };
      }

      if (data.user) {
        setUser(data.user);
        setSession(data.session);
        // `undefined` (not null) so a genuinely role-less account is reported
        // as "no role resolved" rather than as a seeker.
        const role = await loadUserData(data.user);
        setIsLoading(false);
        return { error: null, role: role ?? undefined };
      }

      setIsLoading(false);
      return { error: null };
    }

    // Fallback: not configured or demo auth failed
    const loginError = isDevMode ? new Error('Invalid email or password') : new Error('Authentication is not configured.');
    setError(loginError.message);
    setIsLoading(false);
    return { error: loginError };
  };

   // Sign In with Google OAuth
   const signInWithGoogle = async (): Promise<{ error: Error | null }> => {
    setError(null);
    if (!isConfigured) {
      const error = new Error('Authentication is not configured.');
      setError(error.message);
      return { error };
    }
    try {
      const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : undefined;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      });
      if (error) {
        setError(error.message);
        return { error };
      }
      return { error: null };
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Google sign-in is unavailable.');
      setError(error.message);
      return { error };
    }
  };

  // Demo persona login (development only)
  const signInWithDemoPersona = async (persona: UserRole): Promise<{ error: Error | null; role?: UserRole }> => {
    if (!isDevMode) {
      return { error: new Error('Demo login is unavailable in production.') };
    }
    setError(null);
    setIsLoading(true);

    const demoResult = await requestDemoLogin({ persona });
    if (!demoResult.error && demoResult.data) {
      setDemoAuth(demoResult.data);
      setIsLoading(false);
      return { error: null, role: demoResult.data.activeRole };
    }

    const error = demoResult.error ?? new Error('Demo login is unavailable');
    setError(error.message);
    setIsLoading(false);
    return { error };
  };

  const requestPasswordReset = async (email: string): Promise<{ error: Error | null }> => {
    setError(null);
    setIsLoading(true);

    try {
      if (!isConfigured) {
        const error = new Error('Password reset is unavailable until authentication is configured.');
        setError(error.message);
        return { error };
      }

      const redirectTo = typeof window === 'undefined' ? undefined : `${window.location.origin}/auth/reset-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        redirectTo ? { redirectTo } : undefined
      );

      if (error) {
        setError(error.message);
        return { error };
      }

      return { error: null };
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Password reset is unavailable.');
      setError(error.message);
      return { error };
    } finally {
      setIsLoading(false);
    }
  };

  const updatePassword = async (password: string): Promise<{ error: Error | null }> => {
    setError(null);
    setIsLoading(true);

    try {
      if (!isConfigured) {
        const error = new Error('Password update is unavailable until authentication is configured.');
        setError(error.message);
        return { error };
      }

      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setError(error.message);
        return { error };
      }

      return { error: null };
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Password update is unavailable.');
      setError(error.message);
      return { error };
    } finally {
      setIsLoading(false);
    }
  };

  // Sign Up with email, password, full name, and requested role
  const signUp = async (
    email: string,
    password: string,
    fullName: string,
    requestedRole: UserRole = 'seeker'
  ): Promise<{ error: Error | null; user?: User | null }> => {
    setError(null);
    setIsLoading(true);

    if (isConfigured) {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            requested_role: requestedRole,
            timezone: 'Asia/Kolkata',
          },
        },
      });

      if (signUpError) {
        setError(signUpError.message);
        setIsLoading(false);
        return { error: signUpError };
      }

      if (data.user) {
        if (!data.user.email_confirmed_at && !data.session) {
          setUser(null);
          setSession(null);
          setProfile(null);
          setRoles([]);
          setActiveRoleState(null);
          setPendingEmail(data.user.email || email);
        } else {
          setUser(data.user);
          setSession(data.session);
          await loadUserData(data.user);
          setPendingEmail(null);
        }
      }
      setIsLoading(false);
      return { error: null, user: data.user };
    }
    return { error: null, user: null };
  };

   // Resend email verification code
   const resendVerification = async (emailAddr: string): Promise<{ error: Error | null }> => {
    setError(null);
    if (!isConfigured) {
      const error = new Error('Authentication is not configured.');
      setError(error.message);
      return { error };
    }
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: emailAddr.trim(),
      });
      if (error) {
        setError(error.message);
        return { error };
      }
      return { error: null };
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unable to resend verification email.');
      setError(error.message);
      return { error };
    }
  };

  // Sign Out
  const signOut = async () => {
    setIsLoading(true);
    clearDemoAuth();
    if (isConfigured) {
      try {
        await supabase.auth.signOut();
      } catch {
      }
    }
    setUser(null);
    setSession(null);
    setProfile(null);
    setRoles([]);
    setActiveRoleState(null);
    setPendingEmail(null);
    setIsLoading(false);
  };

   // Fetch mentor onboarding status
  const fetchOnboardingStatus = useCallback(async () => {
    if (!user) {
      setOnboardingStatus(null);
      return;
    }

    try {
      const response = await apiFetch('/api/mentor/onboarding-status');
      if (response.ok) {
        const result = await response.json();
        setOnboardingStatus(result.onboarding || null);
      } else {
        setOnboardingStatus(null);
      }
    } catch {
      setOnboardingStatus(null);
    }
  }, [user]);

const clearError = () => setError(null);

// Fetch onboarding status when user changes
useEffect(() => {
  if (user && roles.includes('mentor')) {
    fetchOnboardingStatus();
  } else {
    setOnboardingStatus(null);
  }
}, [user, roles, fetchOnboardingStatus]);

  const hasRole = useCallback((role: UserRole): boolean => {
    return roles.includes(role);
  }, [roles]);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        roles,
        activeRole: activeRoleState,
        isAuthenticated: !!user,
        isLoading,
        isConfigured,
        error,
        pendingEmail,
        onboardingStatus,
        signInWithPassword,
        signInWithGoogle,
        signInWithDemoPersona,
        requestPasswordReset,
        updatePassword,
        signUp,
        resendVerification,
        signOut,
        hasRole,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};