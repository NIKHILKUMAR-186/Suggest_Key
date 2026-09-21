import React from 'react';
import { useNavigation } from '@/src/context/NavigationContext';
import { SeekerShell } from '@/src/components/layout/SeekerShell';
import { MentorShell } from '@/src/components/layout/MentorShell';
import { AdminShell } from '@/src/components/layout/AdminShell';

/**
 * Role-aware AppShell.
 * Renders the appropriate layout shell depending on the current user's role:
 * - seeker: TopNavigation + MainContent
 * - mentor: TopNavigation + MainContent
 * - admin:  Sidebar + MainContent
 */
export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentRole } = useNavigation();

  if (currentRole === 'admin') {
    return <AdminShell>{children}</AdminShell>;
  }

  if (currentRole === 'mentor') {
    return <MentorShell>{children}</MentorShell>;
  }

  return <SeekerShell>{children}</SeekerShell>;
};
