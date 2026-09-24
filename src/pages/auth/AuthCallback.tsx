import React, { useEffect } from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { supabase, isSupabaseConfigured } from '@/src/lib/supabase';

export const AuthCallback: React.FC = () => {
  const { navigate } = useNavigation();
  const { activeRole, isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      navigate('/auth/login');
      return;
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      if (isAuthenticated && !isLoading) {
        if (activeRole === 'admin') navigate('/admin');
        else if (activeRole === 'mentor') navigate('/mentor');
        else navigate('/seeker');
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate, isAuthenticated, isLoading, activeRole]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="text-xs text-[var(--color-shell-text-subtle)]">Completing sign-in…</div>
      </div>
    </div>
  );
};
