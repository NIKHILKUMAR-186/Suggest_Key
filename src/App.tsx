import { StrictMode } from 'react';
import { AuthProvider } from '@/src/context/AuthContext';
import { ThemeProvider } from '@/src/context/ThemeContext';
import { NavigationProvider } from '@/src/context/NavigationContext';
import { NotificationProvider } from '@/src/context/NotificationContext';
import { ToastProvider } from '@/src/context/ToastContext';
import { RateLimitProvider } from '@/src/context/RateLimitContext';
import { PageMetaProvider, PageMetaRunner } from '@/src/context/PageMetaContext';
import { RateLimitBanner } from '@/src/components/shared/RateLimitBanner';
import { ErrorBoundary, RouteErrorFallback } from '@/src/components/shared/ErrorBoundary';
import { AppShell } from '@/src/components/layout/AppShell';
import { Router } from '@/src/routes/Router';

export default function App() {
  return (
    <StrictMode>
      <ThemeProvider>
        {/*
         * RateLimitProvider is a thin view over the framework-agnostic
         * `rateLimitManager` singleton, so it depends on NOTHING and therefore
         * sits above every provider that consumes it.
         *
         * It must be wrapped around `NotificationProvider`: the notification
         * poller reads `useRateLimitCheck()` so a 429 can pause it. When it sat
         * below, `NotificationProvider` ran `useRateLimit()` outside its context
         * and threw `useRateLimit must be used within a RateLimitProvider` on
         * every render, which blanked the whole app. `NotificationProvider` keeps
         * its `useAuth()` dependency, hence directly under `AuthProvider`.
         */}
        <RateLimitProvider>
          <AuthProvider>
            <NotificationProvider>
              <NavigationProvider>
                <PageMetaProvider>
                  <ToastProvider>
                    <PageMetaRunner />
                    <RateLimitBanner />
                    {/*
                     * Route-level containment. A single page that throws keeps
                     * the shell, the sidebar and the navigation usable, so the
                     * user can move on instead of facing a blank screen. It sits
                     * BELOW every provider on purpose: a provider defect still
                     * propagates to the root boundary and stays visible.
                     */}
                    <ErrorBoundary scope="page" fallback={(error, reset) => (
                      <RouteErrorFallback error={error} reset={reset} />
                    )}>
                      <AppShell>
                        <Router />
                      </AppShell>
                    </ErrorBoundary>
                  </ToastProvider>
                </PageMetaProvider>
              </NavigationProvider>
            </NotificationProvider>
          </AuthProvider>
        </RateLimitProvider>
      </ThemeProvider>
    </StrictMode>
  );
}
