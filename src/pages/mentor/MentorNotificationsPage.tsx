import React, { useState, useEffect } from 'react';
import {
  Bell,
  CheckCircle2,
  Clock,
  Video,
  Calendar,
  AlertTriangle,
  Loader2,
  CheckCheck,
  RefreshCw,
  FileText,
} from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import { useNotifications } from '@/src/context/NotificationContext';
import { NotificationCard } from '@/src/components/notifications/NotificationCard';
import { NotificationSimulator } from '@/src/components/notifications/NotificationSimulator';
import {
  fetchUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from '@/src/lib/notificationService';
import type { Notification } from '@/src/types/database';

export const MentorNotificationsPage: React.FC = () => {
  const { user } = useAuth();
  const { refreshNotifications: refreshContext } = useNotifications();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'unread' | 'read'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');

  const mentorId = user?.id || 'usr-8802';

  const loadNotifs = async () => {
    setLoading(true);
    try {
      const data = await fetchUserNotifications(mentorId, {
        status: statusFilter,
        type: typeFilter,
      });
      setNotifications(data);
      await refreshContext();
    } catch (err) {
      console.error('Failed to load mentor notifications:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotifs();
  }, [mentorId, statusFilter, typeFilter]);

  const handleMarkRead = async (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n))
    );
    await markNotificationAsRead(id, mentorId);
    await refreshContext();
  };

  const handleMarkAllRead = async () => {
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, is_read: true, read_at: new Date().toISOString() }))
    );
    await markAllNotificationsAsRead(mentorId);
    await refreshContext();
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-200/80 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">
              Mentor Notifications
            </h1>
            {unreadCount > 0 && (
              <Badge variant="default" className="text-xs bg-zinc-900 text-white font-semibold">
                {unreadCount} unread
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Lifecycle alerts for session confirmations, meeting link deadlines, cancellations, and workspace handoffs.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-center">
          {unreadCount > 0 && (
            <Button
              id="mentor-mark-all-read-btn"
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
            id="mentor-refresh-btn"
            onClick={loadNotifs}
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

      {/* Simulator bar for testing all 8 Mentor events */}
      <NotificationSimulator
        userId={mentorId}
        role="mentor"
        onEventDispatched={loadNotifs}
      />

      {/* Filter Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-zinc-50 p-2 rounded-xl border border-zinc-200">
        <div className="flex items-center gap-1 overflow-x-auto">
          {(['all', 'unread', 'read'] as const).map((st) => (
            <button
              key={st}
              id={`mentor-filter-${st}`}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors cursor-pointer ${
                statusFilter === st
                  ? 'bg-white text-zinc-950 shadow-xs border border-zinc-200/80 font-semibold'
                  : 'text-zinc-600 hover:text-zinc-950 hover:bg-zinc-100'
              }`}
            >
              {st} {st === 'unread' && unreadCount > 0 && `(${unreadCount})`}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto">
          <span className="text-[11px] font-medium text-zinc-400 pl-1">Category:</span>
          {['ALL', 'BOOKING', 'PAYMENT', 'SESSION', 'WORKSPACE'].map((cat) => (
            <button
              key={cat}
              id={`mentor-cat-${cat.toLowerCase()}`}
              onClick={() => setTypeFilter(cat)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer ${
                typeFilter === cat
                  ? 'bg-zinc-900 text-white font-semibold'
                  : 'bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-100'
              }`}
            >
              {cat === 'ALL' ? 'All Types' : cat}
            </button>
          ))}
        </div>
      </div>

      {/* Notification List */}
      {loading ? (
        <div className="py-16 flex flex-col justify-center items-center text-zinc-400 text-xs gap-2">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-600" />
          <span>Loading mentor alerts...</span>
        </div>
      ) : notifications.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={statusFilter === 'unread' ? 'No Unread Notifications' : 'No Alerts'}
          description={
            statusFilter === 'unread'
              ? 'You have completed all pending action items. Great job staying on top of your schedule!'
              : 'You have no alerts matching your active filter. Use the event simulator above to test specific scenarios.'
          }
        />
      ) : (
        <div className="space-y-3">
          {notifications.map((n) => (
            <NotificationCard
              key={n.id}
              notification={n}
              onMarkRead={handleMarkRead}
              role="mentor"
            />
          ))}
        </div>
      )}
    </div>
  );
};
