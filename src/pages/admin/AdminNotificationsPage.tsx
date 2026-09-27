import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  ShieldAlert,
  Loader2,
  CheckCheck,
  RefreshCw,
  Radio,
} from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { useAuth } from '@/src/context/AuthContext';
import { useNotifications } from '@/src/context/NotificationContext';
import { useNotificationSync } from '@/src/hooks/useNotificationSync';
import { NotificationCard } from '@/src/components/notifications/NotificationCard';
import {
  fetchUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from '@/src/lib/notificationService';
import { toUserMessage } from '@/src/lib/errorMessages';
import type { Notification } from '@/src/types/database';

type StatusFilter = 'all' | 'unread' | 'read';

/**
 * Alert categories this page can scope to. These are the `notifications.type`
 * values the server actually writes, so a scope is a real database filter rather
 * than a client-side bucket. `ADMIN` is included because the mentor
 * verification flow writes that type.
 */
const ALERT_SCOPES = ['ALL', 'PAYMENT', 'SESSION', 'BOOKING', 'WORKSPACE', 'ADMIN', 'SYSTEM'] as const;

const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'unread', 'read'] as const;

/**
 * Real operational notifications for the signed-in administrator.
 *
 * Every row here was written by a real application event: a payment proof
 * submission, a payment decision, a cancellation, a session ending, a mentor
 * application being submitted. There is no simulator, no preset event catalogue
 * and no way to compose an alert from this page - the only actions available are
 * reading the real queue, scoping it, and marking what has been reviewed.
 */
export const AdminNotificationsPage: React.FC = () => {
  const { user } = useAuth();
  const { refreshNotifications: refreshContext } = useNotifications();

  const adminId = user?.id;

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [scopeFilter, setScopeFilter] = useState<(typeof ALERT_SCOPES)[number]>('ALL');
  // Bumped to request a reload from the realtime / visibility revalidation path,
  // which reuses the same loader rather than duplicating the query.
  const [reloadToken, setReloadToken] = useState(0);

  const loadNotifs = useCallback(async () => {
    if (!adminId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchUserNotifications(adminId, {
        status: statusFilter,
        type: scopeFilter,
      });
      setNotifications(data);
    } catch (err) {
      setError(toUserMessage(err, 'The notification queue could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [adminId, statusFilter, scopeFilter]);

  useEffect(() => {
    void loadNotifs();
  }, [loadNotifs, reloadToken]);

  // A new real notification is written straight to `notifications`, so the
  // realtime channel reloads the queue. The interval and focus revalidation cover
  // environments without realtime.
  useNotificationSync({ userId: adminId, onInvalidate: () => setReloadToken((n) => n + 1) });

  // The context feeds the shell's unread badge, so it is kept in step with the
  // queue this page shows. It is a separate query by design, so a failure here
  // must not take the page down.
  const syncBadge = useCallback(async () => {
    try {
      await refreshContext();
    } catch (err) {
      console.warn('Unable to refresh the notification badge:', err);
    }
  }, [refreshContext]);

  useEffect(() => {
    void syncBadge();
  }, [syncBadge, reloadToken, notifications.length]);

  const handleMarkRead = async (id: string) => {
    if (!adminId) return;
    // Optimistic: the card renders read immediately, and the reload below
    // replaces it with what the database actually stored.
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n))
    );
    try {
      await markNotificationAsRead(id, adminId);
      await syncBadge();
    } catch (err) {
      setError(toUserMessage(err, 'That notification could not be marked as read.'));
      void loadNotifs();
    }
  };

  const handleMarkAllRead = async () => {
    if (!adminId) return;
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, is_read: true, read_at: new Date().toISOString() }))
    );
    try {
      await markAllNotificationsAsRead(adminId);
      await loadNotifs();
      await syncBadge();
    } catch (err) {
      setError(toUserMessage(err, 'The queue could not be marked as reviewed.'));
      void loadNotifs();
    }
  };

  // The unread badge reflects the WHOLE queue, not the filtered view, so
  // switching to "read" never makes pending work look like it was cleared.
  const unreadCount = useMemo(() => notifications.filter((n) => !n.is_read).length, [notifications]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[var(--color-shell-border)] pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-shell-text)] sm:text-3xl">
              Operational Alerts
            </h1>
            {unreadCount > 0 && (
              <Badge variant="destructive" className="text-xs font-semibold">
                {unreadCount} unreviewed
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-[var(--color-shell-text-muted)]">
            Real events written by the platform: payment proofs awaiting verification, payment decisions, booking
            interventions and mentor verification activity.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-center">
          {unreadCount > 0 && (
            <Button
              id="admin-mark-all-read-btn"
              onClick={handleMarkAllRead}
              variant="outline"
              size="sm"
              className="text-xs gap-1.5 h-8"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              <span>Mark all reviewed</span>
            </Button>
          )}

          <Button
            id="admin-refresh-btn"
            onClick={() => setReloadToken((n) => n + 1)}
            variant="outline"
            size="sm"
            className="text-xs gap-1.5 h-8"
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] p-2">
        <div className="flex items-center gap-1 overflow-x-auto">
          {STATUS_FILTERS.map((st) => (
            <button
              key={st}
              id={`admin-filter-${st}`}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors cursor-pointer ${
                statusFilter === st
                  ? 'bg-[var(--color-shell-surface)] text-[var(--color-shell-text)] shadow-xs border border-[var(--color-shell-border)] font-semibold'
                  : 'text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)] hover:bg-[var(--color-shell-surface-hover)]'
              }`}
            >
              {st}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto">
          <span className="text-[11px] font-medium text-[var(--color-shell-text-subtle)] pl-1">Alert scope:</span>
          {ALERT_SCOPES.map((cat) => (
            <button
              key={cat}
              id={`admin-cat-${cat.toLowerCase()}`}
              onClick={() => setScopeFilter(cat)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer ${
                scopeFilter === cat
                  ? 'bg-[var(--color-shell-text)] text-[var(--color-shell-surface)] font-semibold'
                  : 'bg-[var(--color-shell-surface)] text-[var(--color-shell-text-muted)] border border-[var(--color-shell-border)] hover:bg-[var(--color-shell-surface-hover)]'
              }`}
            >
              {cat === 'ALL' ? 'All Alerts' : cat}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)]">
          <ErrorState
            title="Notification Queue Unavailable"
            message={error}
            onRetry={() => setReloadToken((n) => n + 1)}
          />
        </div>
      )}

      {loading ? (
        <div className="py-16 flex flex-col justify-center items-center text-[var(--color-shell-text-subtle)] text-xs gap-2">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--color-shell-text-muted)]" />
          <span>Loading operational alerts…</span>
        </div>
      ) : notifications.length === 0 ? (
        <EmptyState
          icon={statusFilter === 'unread' ? CheckCheck : ShieldAlert}
          title={statusFilter === 'unread' ? 'Nothing Awaiting Review' : 'No Alerts Match This Filter'}
          description={
            statusFilter === 'unread'
              ? 'Every payment queue, booking intervention and verification item has been reviewed.'
              : 'No alerts exist for this status and scope combination.'
          }
        />
      ) : (
        <div className="space-y-3">
          {notifications.map((n) => (
            <NotificationCard
              key={n.id}
              notification={n}
              onMarkRead={handleMarkRead}
              role="admin"
            />
          ))}
        </div>
      )}

      <p className="flex items-start gap-2 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] p-3 text-[11px] text-[var(--color-shell-text-subtle)]">
        <Radio className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
        <span>
          This queue is fed only by real application events. Every action button resolves to the admin record the
          event was written for — a payment notification opens the admin payment queue, never a seeker page.
        </span>
      </p>
    </div>
  );
};
