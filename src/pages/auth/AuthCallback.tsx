import React, { useEffect } from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { isSupabaseConfigured } from '@/src/lib/supabase';

export const AuthCallback: React.FC = () => {
  const { navigate } = useNavigation();
  const { activeRole, isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      navigate('/auth/login');
      return;
    }

    if (isLoading) return;

    if (!isAuthenticated) {
      navigate('/auth/login');
      return;
    }

    if (activeRole === 'admin') navigate('/admin');
    else if (activeRole === 'mentor') navigate('/mentor');
    else navigate('/seeker');
  }, [navigate, isAuthenticated, isLoading, activeRole]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="text-xs text-[var(--color-shell-text-subtle)]">Completing sign-in…</div>
      </div>
    </div>
  );
};
