import React, { useState, useEffect } from 'react';
import {
  Bell,
  Check,
  Loader2,
  CheckCheck,
} from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { useAuth } from '@/src/context/AuthContext';
import { useNotifications } from '@/src/context/NotificationContext';
import { NotificationCard } from '@/src/components/notifications/NotificationCard';
import {
  fetchUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from '@/src/lib/notificationService';
import type { Notification } from '@/src/types/database';

export const SeekerNotificationsPage: React.FC = () => {
  const { user } = useAuth();
  const { refreshNotifications: refreshContext } = useNotifications();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'unread' | 'read'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');

  const seekerId = user?.id;

  const loadNotifs = async () => {
    if (!seekerId) return;
    setLoading(true);
    try {
      const data = await fetchUserNotifications(seekerId, {
        status: statusFilter,
        type: typeFilter,
      });
      setNotifications(data);
      await refreshContext();
    } catch (err) {
      console.error('Failed to load notifications:', err);
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-shell-text)] sm:text-3xl font-display">
              Notifications
            </h1>
            {unreadCount > 0 && (
              <Badge variant="default" className="text-xs bg-zinc-900 text-white font-semibold">
                {unreadCount} unread
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-[var(--color-shell-text-muted)]">
            Authoritative in-app alerts for your bookings, payment verifications, session rooms,
            and mentor workspace notes.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <Button
              id="mark-all-read-btn"
              onClick={handleMarkAllRead}
              variant="outline"
              size="sm"
              className="text-xs gap-1.5 h-8"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              <span>Mark all as read</span>
            </Button>
          )}
          <Button
            id="refresh-notifs-btn"
            onClick={loadNotifs}
            variant="outline"
            size="sm"
            className="text-xs gap-1.5 h-8"
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      {/* Filter Tabs */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[var(--color-shell-surface-elevated)] p-2 rounded-xl border border-[var(--color-shell-border)]"
      >
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
          {(['all', 'unread', 'read'] as const).map((st) => (
            <button
              key={st}
              id={`filter-status-${st}`}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all capitalize cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-accent)] ${
                statusFilter === st
                  ? 'bg-[var(--color-shell-surface)] text-[var(--color-shell-text)] shadow-xs border border-[var(--color-shell-border)] font-semibold'
                  : 'text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)] hover:bg-zinc-100'
              }`}
            >
              {st} {st === 'unread' && unreadCount > 0 && `(${unreadCount})`}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
          <span className="text-[11px] font-medium text-[var(--color-shell-text-subtle)] pl-1">Category:</span>
          {['ALL', 'BOOKING', 'PAYMENT', 'SESSION', 'WORKSPACE'].map((cat) => (
            <button
              key={cat}
              id={`filter-cat-${cat.toLowerCase()}`}
              onClick={() => setTypeFilter(cat)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-accent)] ${
                typeFilter === cat
                  ? 'bg-amber-900 text-white font-semibold'
                  : 'bg-[var(--color-shell-surface)] text-[var(--color-shell-text-muted)] border border-[var(--color-shell-border)] hover:bg-zinc-100'
              }`}
            >
              {cat === 'ALL' ? 'All Types' : cat}
            </button>
          ))}
        </div>
      </motion.div>

      {/* Notification List */}
      {loading ? (
        <div className="py-16 flex flex-col justify-center items-center text-[var(--color-shell-text-subtle)] text-xs gap-2">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--color-shell-text-muted)]" />
          <span>Synchronizing alerts with real database...</span>
        </div>
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
