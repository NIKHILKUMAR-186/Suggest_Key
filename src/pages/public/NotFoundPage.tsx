import React from 'react';
import { motion } from 'motion/react';
import { Compass, Home, ArrowLeft, LayoutGrid, UserCog, ShieldCheck } from 'lucide-react';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import { Button } from '@/src/components/ui/Button';
import { ThemeToggle } from '@/src/components/ui/ThemeToggle';

const ROLE_HOME: Record<string, string> = {
  admin: '/admin',
  mentor: '/mentor',
  seeker: '/seeker',
};

/**
 * Global 404.
 *
 * Rendered by the router for any pathname it does not recognise, so it must
 * stand on its own: it carries its own header, works signed-out, and never
 * renders a stack trace, a request id, or the internal error envelope.
 */
export const NotFoundPage: React.FC = () => {
  const { navigate, currentPath } = useNavigation();
  const { isAuthenticated, activeRole } = useAuth();
  const roleHome = (activeRole && ROLE_HOME[activeRole]) || '/seeker';
  const requestedPath = currentPath.split('?')[0];

  const goBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
      return;
    }
    navigate('/');
  };

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[var(--color-shell-bg)] text-[var(--color-shell-text)] antialiased">
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="landing-grid absolute inset-0" />
      </div>

      <header className="relative z-10 border-b border-[var(--color-shell-border)] bg-[var(--color-shell-bg)]/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <button
            onClick={() => navigate('/')}
            aria-label="Suggest Key home"
            className="flex cursor-pointer items-center gap-3 rounded-xl p-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-gradient-to-br from-[var(--color-shell-primary)] to-[var(--color-shell-accent)] text-[13px] font-bold text-white shadow-[var(--shadow-sm)] ring-1 ring-inset ring-white/25">
              SK
            </div>
            <span className="font-display text-[17px] font-bold tracking-[-0.02em]">Suggest Key</span>
          </button>
          <ThemeToggle />
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-2xl flex-col items-center px-4 py-16 text-center sm:px-6 sm:py-24">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="flex w-full flex-col items-center"
        >
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-primary)] shadow-[var(--shadow-sm)]">
            <Compass className="h-7 w-7" aria-hidden="true" />
          </div>

          <p className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-shell-text-subtle)]">
            Error 404
          </p>
          <h1 className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">
            Page not found
          </h1>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-[var(--color-shell-text-muted)] sm:text-base">
            We could not find the page you were looking for. It may have been moved, or the
            address may contain a typo.
          </p>

          <p className="mt-4 max-w-full break-all rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] px-3 py-2 font-mono text-xs text-[var(--color-shell-text-subtle)]">
            {requestedPath}
          </p>

          <div className="mt-8 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">
            <Button
              size="lg"
              onClick={() => navigate(isAuthenticated ? roleHome : '/')}
              className="w-full gap-2 sm:w-auto"
            >
              <Home className="h-4 w-4" aria-hidden="true" />
              Go Home
            </Button>
            <Button variant="outline" size="lg" onClick={goBack} className="w-full gap-2 sm:w-auto">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Go Back
            </Button>
          </div>

          {isAuthenticated && (
            <nav
              aria-label="Suggested pages"
              className="mt-10 w-full rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-4"
            >
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-shell-text-subtle)]">
                Or try one of these
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {activeRole !== 'admin' && (
                  <Button variant="ghost" size="sm" onClick={() => navigate('/seeker/mentors')} className="gap-1.5">
                    <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
                    Find a Mentor
                  </Button>
                )}
                {activeRole === 'mentor' && (
                  <Button variant="ghost" size="sm" onClick={() => navigate('/mentor/availability')} className="gap-1.5">
                    <UserCog className="h-3.5 w-3.5" aria-hidden="true" />
                    My Availability
                  </Button>
                )}
                {activeRole === 'admin' && (
                  <Button variant="ghost" size="sm" onClick={() => navigate('/admin')} className="gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    Admin Dashboard
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => navigate('/auth/login')} className="gap-1.5">
                  Sign In
                </Button>
              </div>
            </nav>
          )}
        </motion.div>
      </main>
    </div>
  );
};
