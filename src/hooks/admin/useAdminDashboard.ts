/**
 * useAdminDashboard — client access to the aggregated operations payload.
 *
 * REFRESH STRATEGY (deliberately not "realtime")
 * ---------------------------------------------------------------------------
 * Supabase Realtime is NOT enabled for this project's tables, so the dashboard
 * does not claim to be realtime. Instead it uses reliable revalidation through
 * the existing application infrastructure:
 *
 *   1. one initial server-backed fetch on mount,
 *   2. a manual [Refresh] action,
 *   3. a low-frequency background revalidation (default 60s) so an admin who
 *      leaves the console open still sees queue changes,
 *   4. an immediate revalidation when the tab regains focus / becomes visible.
 *
 * `lastUpdatedAt` is the real client clock reading of the last SUCCESSFUL load.
 * It is a UI freshness indicator only and is never a source of business truth.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, captureClientError } from '@/src/lib/apiClient';
import type { AdminDashboardPayload } from '@/src/lib/adminDashboard';

export const ADMIN_DASHBOARD_REFRESH_INTERVAL_MS = 60_000;

export interface UseAdminDashboardResult {
  data: AdminDashboardPayload | null;
  /** True only for the very first load, so the UI can show full skeletons. */
  isInitialLoading: boolean;
  /** True while any refresh (manual, interval or focus) is in flight. */
  isRefreshing: boolean;
  /** Set only when the whole payload failed to load. */
  error: string | null;
  lastUpdatedAt: Date | null;
  refresh: () => Promise<void>;
}

export function useAdminDashboard(
  options: { refreshIntervalMs?: number } = {},
): UseAdminDashboardResult {
  const refreshIntervalMs = options.refreshIntervalMs ?? ADMIN_DASHBOARD_REFRESH_INTERVAL_MS;

  const [data, setData] = useState<AdminDashboardPayload | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setIsRefreshing(true);

    try {
      const response = await apiFetch('/api/admin/dashboard/overview');
      const payload = (await response.json()) as {
        success?: boolean;
        dashboard?: AdminDashboardPayload;
        error?: { message?: string };
      };

      if (!response.ok || !payload?.success || !payload.dashboard) {
        throw new Error(payload?.error?.message ?? 'Dashboard data is temporarily unavailable.');
      }

      if (!mounted.current) return;
      setData(payload.dashboard);
      setError(null);
      setLastUpdatedAt(new Date());
    } catch (err) {
      if (!mounted.current) return;
      captureClientError(err, { context: 'admin-dashboard-overview' });
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Dashboard data is temporarily unavailable.',
      );
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setIsRefreshing(false);
        setIsInitialLoading(false);
      }
    }
  }, []);

  // Initial load.
  useEffect(() => {
    void load();
  }, [load]);

  // Background revalidation.
  useEffect(() => {
    const interval = setInterval(() => {
      void load();
    }, refreshIntervalMs);
    return () => clearInterval(interval);
  }, [load, refreshIntervalMs]);

  // Revalidate when the admin returns to the tab (covers mutations performed
  // in another tab and long-idle sessions).
  useEffect(() => {
    const handleVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void load();
      }
    };
    const handleFocus = () => void load();

    window.addEventListener('focus', handleFocus);
    document?.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document?.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [load]);

  return { data, isInitialLoading, isRefreshing, error, lastUpdatedAt, refresh: load };
}
