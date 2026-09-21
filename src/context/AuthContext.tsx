import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import type { Profile, UserRole, AuthContextType } from '@/src/types/auth';
import { supabase, isSupabaseConfigured, fetchUserProfile, fetchUserRoles, upsertUserProfile } from '@/src/lib/supabase';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Demo test personas for local preview / unconfigured environment
const DEMO_USERS: Record<string, { user: User; profile: Profile; roles: UserRole[] }> = {
  'seeker@suggestkey.com': {
    user: {
      id: 'usr-8801',
      app_metadata: {},
      user_metadata: { full_name: 'Aman Kumar' },
      aud: 'authenticated',
      created_at: '2026-01-10T00:00:00Z',
      email: 'suggestkey1505@gmail.com',
    } as unknown as User,
    profile: {
      id: 'usr-8801',
      email: 'suggestkey1505@gmail.com',
      full_name: 'Aman Kumar',
      timezone: 'Asia/Kolkata',
      created_at: '2026-01-10T00:00:00Z',
      updated_at: '2026-01-10T00:00:00Z',
    },
    roles: ['seeker'],
  },
  'mentor@suggestkey.com': {
    user: {
      id: 'usr-8802',
      app_metadata: {},
      user_metadata: { full_name: 'Rahul Sharma' },
      aud: 'authenticated',
      created_at: '2026-01-12T00:00:00Z',
      email: 'mentor.rahul@suggestkey.com',
    } as unknown as User,
    profile: {
      id: 'usr-8802',
      email: 'mentor.rahul@suggestkey.com',
      full_name: 'Rahul Sharma',
      timezone: 'Asia/Kolkata',
      created_at: '2026-01-12T00:00:00Z',
      updated_at: '2026-01-12T00:00:00Z',
    },
    roles: ['mentor', 'seeker'],
  },
  'admin@suggestkey.com': {
    user: {
      id: 'usr-8800',
      app_metadata: {},
      user_metadata: { full_name: 'Platform Administrator' },
      aud: 'authenticated',
      created_at: '2026-01-01T00:00:00Z',
      email: 'admin@suggestkey.com',
    } as unknown as User,
    profile: {
      id: 'usr-8800',
      email: 'admin@suggestkey.com',
      full_name: 'Platform Administrator',
      timezone: 'UTC',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    roles: ['admin', 'seeker'],
  },
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [activeRole, setActiveRole] = useState<UserRole>('seeker');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isConfigured] = useState<boolean>(isSupabaseConfigured());

  // Helper to determine primary role
  const determinePrimaryRole = (userRoles: UserRole[]): UserRole => {
    if (userRoles.includes('admin')) return 'admin';
    if (userRoles.includes('mentor')) return 'mentor';
    return 'seeker';
  };

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

      // 3. Set Active Role
      const primary = determinePrimaryRole(effectiveRoles);
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
        // Fallback: Check local storage for simulated active user
        try {
          const savedDemoKey = localStorage.getItem('suggestkey_demo_auth_user');
          if (savedDemoKey && DEMO_USERS[savedDemoKey]) {
            const demo = DEMO_USERS[savedDemoKey];
            setUser(demo.user);
            setProfile(demo.profile);
            setRoles(demo.roles);
            setActiveRole(determinePrimaryRole(demo.roles));
          } else {
            // Default to demo seeker logged in for seamless preview review
            const defaultDemo = DEMO_USERS['seeker@suggestkey.com'];
            setUser(defaultDemo.user);
            setProfile(defaultDemo.profile);
            setRoles(defaultDemo.roles);
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
  const signInWithPassword = async (email: string, password: string) => {
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
    } else {
      // Fallback demo auth
      const cleanEmail = email.trim().toLowerCase();
      let matched = DEMO_USERS[cleanEmail];

      if (!matched) {
        if (cleanEmail.includes('admin')) matched = DEMO_USERS['admin@suggestkey.com'];
        else if (cleanEmail.includes('mentor')) matched = DEMO_USERS['mentor@suggestkey.com'];
        else matched = DEMO_USERS['seeker@suggestkey.com'];
      }

      setUser(matched.user);
      setProfile(matched.profile);
      setRoles(matched.roles);
      const targetRole = determinePrimaryRole(matched.roles);
      setActiveRole(targetRole);

      try {
        localStorage.setItem('suggestkey_demo_auth_user', cleanEmail in DEMO_USERS ? cleanEmail : 'seeker@suggestkey.com');
      } catch {}

      setIsLoading(false);
      return { error: null };
    }
  };

  // Sign Up with email, password, full name, and requested role
  const signUp = async (
    email: string,
    password: string,
    fullName: string,
    requestedRole: UserRole = 'seeker'
  ) => {
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
    } else {
      // Fallback demo signup
      const newUserId = `usr-${Date.now().toString().slice(-4)}`;
      const newUser: User = {
        id: newUserId,
        email,
        app_metadata: {},
        user_metadata: { full_name: fullName },
        aud: 'authenticated',
        created_at: new Date().toISOString(),
      } as unknown as User;

      const newProfile: Profile = {
        id: newUserId,
        email,
        full_name: fullName,
        timezone: 'Asia/Kolkata',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const newRoles: UserRole[] = [requestedRole];

      setUser(newUser);
      setProfile(newProfile);
      setRoles(newRoles);
      setActiveRole(requestedRole);

      try {
        localStorage.setItem('suggestkey_demo_auth_user', email);
      } catch {}

      setIsLoading(false);
      return { error: null, user: newUser };
    }
  };

  // Sign Out
  const signOut = async () => {
    setIsLoading(true);
    if (isConfigured) {
      await supabase.auth.signOut();
    } else {
      try {
        localStorage.removeItem('suggestkey_demo_auth_user');
      } catch {}
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

  // Switch active role within granted roles
  const switchActiveRole = (targetRole: UserRole): boolean => {
    if (!hasRole(targetRole) && !roles.includes('admin')) {
      setError(`Cannot switch to ${targetRole}: Role authorization not granted.`);
      return false;
    }
    setActiveRole(targetRole);
    return true;
  };

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
        switchActiveRole,
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
