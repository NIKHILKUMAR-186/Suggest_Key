import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import type { Profile, UserRole, AuthContextType } from '@/src/types/auth';
import { supabase, isSupabaseConfigured, fetchUserProfile, fetchUserRoles, upsertUserProfile } from '@/src/lib/supabase';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [activeRole, setActiveRole] = useState<UserRole>('seeker');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isConfigured] = useState<boolean>(isSupabaseConfigured());

  // Sync Supabase user profile and roles
  const loadUserData = useCallback(async (supabaseUser: User) => {
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

      // 2. Fetch User Roles from user_roles table
      const { roles: userRoles } = await fetchUserRoles(supabaseUser.id);
      const effectiveRoles: UserRole[] =
        userRoles.length > 0
          ? userRoles
          : [(supabaseUser.user_metadata?.requested_role as UserRole) || 'seeker'];
      setRoles(effectiveRoles);

      // 3. Set Active Role (from database, never frontend-assigned)
      const primary: UserRole = effectiveRoles.includes('admin')
        ? 'admin'
        : effectiveRoles.includes('mentor')
          ? 'mentor'
          : 'seeker';
      setActiveRole(primary);
    } catch (err: any) {
      console.error('Error loading Supabase user data:', err);
    }
  }, []);

  // Initialize Session
  useEffect(() => {
    let isMounted = true;

    async function initAuth() {
      if (isConfigured) {
        try {
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
            }
          }
        } catch (err: any) {
          console.error('Supabase getSession error:', err);
        } finally {
          if (isMounted) setIsLoading(false);
        }

        // Listen for Auth changes
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
              setActiveRole('seeker');
            }
            setIsLoading(false);
          }
        );

        return () => {
          subscription.unsubscribe();
        };
      } else {
        // Fallback: Check local storage for simulated active user (DEV ONLY)
        try {
          const savedDemoKey = localStorage.getItem('suggestkey_demo_auth_user');
          if (savedDemoKey) {
            const demo = { id: savedDemoKey, email: savedDemoKey, full_name: savedDemoKey, timezone: 'Asia/Kolkata', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
            setUser(demo as unknown as User);
            setProfile(demo as Profile);
            setRoles(['seeker']);
            setActiveRole('seeker');
          }
        } catch {
          // localStorage access disabled
        } finally {
          setIsLoading(false);
        }
      }
    }

    initAuth();

    return () => {
      isMounted = false;
    };
  }, [isConfigured, loadUserData]);

  // Sign In with email & password
  const signInWithPassword = async (email: string, password: string): Promise<{ error: Error | null }> => {
    setError(null);
    setIsLoading(true);

    if (isConfigured) {
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
        await loadUserData(data.user);
      }
      setIsLoading(false);
      return { error: null };
    }
    return { error: null };
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
        setUser(data.user);
        setSession(data.session);
        await loadUserData(data.user);
      }
      setIsLoading(false);
      return { error: null, user: data.user };
    }
    return { error: null };
  };

  // Sign Out
  const signOut = async () => {
    setIsLoading(true);
    if (isConfigured) {
      await supabase.auth.signOut();
    }
    setUser(null);
    setSession(null);
    setProfile(null);
    setRoles([]);
    setActiveRole('seeker');
    setIsLoading(false);
  };

  // Check if user has specific role
  const hasRole = useCallback((role: UserRole): boolean => {
    return roles.includes(role);
  }, [roles]);

  const clearError = () => setError(null);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        roles,
        activeRole,
        isAuthenticated: !!user,
        isLoading,
        isConfigured,
        error,
        signInWithPassword,
        signUp,
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