import React, { useState, useEffect } from 'react';
import {
  Bell,
  Loader2,
  CheckCheck,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@/src/components/ui/Button';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { PageHeading, SegmentedTabs } from '@/src/components/booking/PageHeading';
import { StatusPill } from '@/src/components/booking/StatusPill';
import { InlineNotice } from '@/src/components/booking/StatePanel';
import { useAuth } from '@/src/context/AuthContext';
import { useNotifications } from '@/src/context/NotificationContext';
import { NotificationCard } from '@/src/components/notifications/NotificationCard';
import { toUserMessage } from '@/src/lib/errorMessages';
import {
  fetchUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from '@/src/lib/notificationService';
import type { Notification } from '@/src/types/database';

const CATEGORIES = ['ALL', 'BOOKING', 'PAYMENT', 'SESSION', 'WORKSPACE'] as const;

export const SeekerNotificationsPage: React.FC = () => {
  const { user } = useAuth();
  const { refreshNotifications: refreshContext } = useNotifications();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'unread' | 'read'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');

  const seekerId = user?.id;

  const loadNotifs = async () => {
    if (!seekerId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchUserNotifications(seekerId, {
        status: statusFilter,
        type: typeFilter,
      });
      setNotifications(data);
      await refreshContext();
    } catch (err) {
      // A failed load is surfaced rather than swallowed. Leaving the list empty
      // here would render "No notifications", which reads as "you have nothing"
      // rather than "we could not check" — the exact wrong conclusion.
      setNotifications([]);
      setError(toUserMessage(err, 'Failed to load notifications.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotifs();
  }, [seekerId, statusFilter, typeFilter]);

  const handleMarkRead = async (id: string) => {
    if (!seekerId) return;
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n
      )
    );
    await markNotificationAsRead(id, seekerId);
    await refreshContext();
  };

  const handleMarkAllRead = async () => {
    if (!seekerId) return;
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, is_read: true, read_at: new Date().toISOString() }))
    );
    await markAllNotificationsAsRead(seekerId);
    await refreshContext();
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.23, 1, 0.31, 1] }}
      className="max-w-4xl mx-auto space-y-6"
    >
      {/* Header */}
      <PageHeading
        title="Notifications"
        description="Authoritative in-app alerts for your bookings, payment verifications, session rooms and mentor workspace notes."
        aside={
          <>
            {unreadCount > 0 && (
              <StatusPill tone="info" label={`${unreadCount} unread`} size="md" className="tabular-nums" />
            )}
            {unreadCount > 0 && (
              <Button
                id="mark-all-read-btn"
                onClick={handleMarkAllRead}
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
              >
                <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Mark all as read</span>
              </Button>
            )}
            <Button
              id="refresh-notifs-btn"
              onClick={loadNotifs}
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              disabled={loading}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loading ? 'motion-safe:animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>Refresh</span>
            </Button>
          </>
        }
      />

      {/* Filter Tabs */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedTabs
          value={statusFilter}
          onChange={setStatusFilter}
          ariaLabel="Filter by read status"
          options={[
            { id: 'all', label: 'All' },
            { id: 'unread', label: 'Unread', count: unreadCount },
            { id: 'read', label: 'Read' },
          ]}
        />
        <SegmentedTabs
          value={typeFilter}
          onChange={setTypeFilter}
          ariaLabel="Filter by category"
          options={CATEGORIES.map((cat) => ({
            id: cat,
            label: cat === 'ALL' ? 'All Types' : cat.charAt(0) + cat.slice(1).toLowerCase(),
          }))}
        />
      </div>

      {/* Notification List */}
      {loading ? (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col items-center justify-center gap-2 py-16 text-xs text-[var(--color-shell-text-subtle)]"
        >
          <Loader2 className="h-6 w-6 animate-spin text-[var(--color-shell-text-muted)] motion-reduce:animate-none" aria-hidden="true" />
          <span>Synchronizing alerts with real database...</span>
        </div>
      ) : error ? (
        <InlineNotice
          tone="danger"
          role="alert"
          icon={TriangleAlert}
          title="Could not load your notifications"
          actions={
            <Button size="sm" variant="outline" onClick={loadNotifs}>
              Retry
            </Button>
          }
        >
          {error}
        </InlineNotice>
      ) : notifications.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={statusFilter === 'unread' ? 'No Unread Notifications' : 'No Notifications'}
          description={
            statusFilter === 'unread'
              ? 'You have read all pending alerts. Switch to "All" to review earlier booking activity.'
              : 'You do not have any notifications matching this filter yet.'
          }
        />
      ) : (
        <motion.div
          initial="hidden"
          animate="show"
          variants={{
            hidden: { opacity: 0 },
            show: { opacity: 1, transition: { staggerChildren: 0.04 } },
          }}
          className="space-y-3"
        >
          {notifications.map((n) => (
            <motion.div
              key={n.id}
              variants={{ hidden: { opacity: 0, y: 4 }, show: { opacity: 1, y: 0 } }}
            >
              <NotificationCard
                notification={n}
                onMarkRead={handleMarkRead}
                role="seeker"
              />
            </motion.div>
          ))}
        </motion.div>
      )}
    </motion.div>
  );
};

export default SeekerNotificationsPage;
