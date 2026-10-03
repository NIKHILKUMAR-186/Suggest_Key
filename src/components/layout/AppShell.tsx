import React, { Suspense, lazy } from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { isKnownRoute } from '@/src/lib/pageMeta';

// The three role shells carry the header, sidebar and navigation config for
// their role. They only ever render AFTER `isLoading` resolves below, so they
// are never part of the first paint and can be fetched alongside the first
// authenticated route instead of ahead of it.
const SeekerShell = lazy(() => import('@/src/components/layout/SeekerShell').then((m) => ({ default: m.SeekerShell })));
const MentorShell = lazy(() => import('@/src/components/layout/MentorShell').then((m) => ({ default: m.MentorShell })));
const AdminShell = lazy(() => import('@/src/components/layout/AdminShell').then((m) => ({ default: m.AdminShell })));

const SESSION_LOADING_FALLBACK = (
  <div className="min-h-screen flex items-center justify-center bg-[#05060f]">
    <div className="text-center space-y-3">
      <div className="h-8 w-8 rounded-full border-2 border-[#663af3] border-t-transparent animate-spin mx-auto text-[var(--color-shell-text-subtle)]" />
      <p className="text-xs text-[#9da7ba]">Loading session...</p>
    </div>
  </div>
);

const isPublicRoute = (pathname: string) => (
  pathname === '/' ||
  pathname.startsWith('/auth') ||
  pathname === '/login' ||
  pathname === '/signup' ||
  pathname === '/403' ||
  // Open to visitors who have no account yet, so it must not be wrapped in a
  // role shell: an anonymous applicant would otherwise get seeker navigation.
  pathname === '/mentor/signup'
);

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
  const { currentPath } = useNavigation();
  const pathname = currentPath.split('?')[0];

  if (isPublicRoute(pathname)) {
    return <>{children}</>;
  }

  // The 404 page is self-contained (own header, own theme toggle, no role
  // navigation), so it must not be wrapped in a role shell.
  if (!isKnownRoute(pathname)) {
    return <>{children}</>;
  }

  if (isLoading) {
    return SESSION_LOADING_FALLBACK;
  }

  return (
    <Suspense fallback={SESSION_LOADING_FALLBACK}>
      {activeRole === 'admin' ? (
        <AdminShell>{children}</AdminShell>
      ) : activeRole === 'mentor' ? (
        <MentorShell>{children}</MentorShell>
      ) : (
        <SeekerShell>{children}</SeekerShell>
      )}
    </Suspense>
  );
};