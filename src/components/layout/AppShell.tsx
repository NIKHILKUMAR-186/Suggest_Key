import React from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { SeekerShell } from '@/src/components/layout/SeekerShell';
import { MentorShell } from '@/src/components/layout/MentorShell';
import { AdminShell } from '@/src/components/layout/AdminShell';

/**
 * Role-aware AppShell.
 * Renders the appropriate layout shell depending on the current user's role:
 * - seeker: TopNavigation + MainContent
 * - mentor: TopNavigation + MainContent
 * - admin:  Sidebar + MainContent
 *
 * Role is always resolved from the authenticated user's database role via AuthContext.
 */
export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { activeRole, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#05060f]">
        <div className="text-center space-y-3">
          <div className="h-8 w-8 rounded-full border-2 border-[#663af3] border-t-transparent animate-spin mx-auto" />
          <p className="text-xs text-[#9da7ba]">Loading session...</p>
        </div>
      </div>
    );
  }

  if (activeRole === 'admin') {
    return <AdminShell>{children}</AdminShell>;
  }

  if (activeRole === 'mentor') {
    return <MentorShell>{children}</MentorShell>;
  }

  return <SeekerShell>{children}</SeekerShell>;
};