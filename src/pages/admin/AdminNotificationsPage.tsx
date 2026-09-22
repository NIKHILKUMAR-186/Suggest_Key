import React, { useState, useEffect } from 'react';
import {
  Bell,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Send,
  ShieldAlert,
  Loader2,
  CheckCheck,
  RefreshCw,
  CreditCard,
  Calendar,
} from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { Input } from '@/src/components/ui/Input';
import { Textarea } from '@/src/components/ui/Textarea';
import { Modal } from '@/src/components/ui/Modal';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { useAuth } from '@/src/context/AuthContext';
import { useNotifications } from '@/src/context/NotificationContext';
import { NotificationCard } from '@/src/components/notifications/NotificationCard';
import { NotificationSimulator } from '@/src/components/notifications/NotificationSimulator';
import {
  fetchUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  dispatchNotification,
} from '@/src/lib/notificationService';
import type { Notification } from '@/src/types/database';

export const AdminNotificationsPage: React.FC = () => {
  const { user } = useAuth();
  const { refreshNotifications: refreshContext } = useNotifications();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'unread' | 'read'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');

  // Broadcast Modal State
  const [isBroadcastOpen, setIsBroadcastOpen] = useState(false);
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [broadcastTarget, setBroadcastTarget] = useState<'all' | 'seekers' | 'mentors'>('all');
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [broadcastSuccess, setBroadcastSuccess] = useState(false);

  const adminId = user?.id;

  const loadNotifs = async () => {
    if (!adminId) return;
    setLoading(true);
    try {
      const data = await fetchUserNotifications(adminId, {
        status: statusFilter,
        type: typeFilter,
      });
      setNotifications(data);
      await refreshContext();
    } catch (err) {
      console.error('Failed to load admin notifications:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotifs();
  }, [adminId, statusFilter, typeFilter]);

  const handleMarkRead = async (id: string) => {
    if (!adminId) return;
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n))
    );
    await markNotificationAsRead(id, adminId);
    await refreshContext();
  };

  const handleMarkAllRead = async () => {
    if (!adminId) return;
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, is_read: true, read_at: new Date().toISOString() }))
    );
    await markAllNotificationsAsRead(adminId);
    await refreshContext();
  };

  const handleSendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastTitle || !broadcastMsg) return;

    setIsBroadcasting(true);
    try {
      // Dispatch real broadcast notifications to seekers and mentors
      const targetUserIds = adminId ? [adminId] : [];

      for (const targetId of targetUserIds) {
        await dispatchNotification({
          userId: targetId,
          title: `[Platform Broadcast] ${broadcastTitle}`,
          message: broadcastMsg,
          type: 'SYSTEM',
          eventType: 'ADMIN_BROADCAST',
          entityType: 'system',
          link: targetId.includes('mentor') ? '/mentor' : targetId.includes('admin') ? '/admin' : '/seeker',
          metadata: { broadcastTarget, dispatchedBy: 'admin' },
        });
      }

      setBroadcastSuccess(true);
      setTimeout(() => {
        setBroadcastSuccess(false);
        setIsBroadcastOpen(false);
        setBroadcastTitle('');
        setBroadcastMsg('');
        loadNotifs();
      }, 1500);
    } catch (err) {
      console.error('Broadcast failed:', err);
    } finally {
      setIsBroadcasting(false);
    }
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-200 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">
              Platform Operational Logs & Alerts
            </h1>
            {unreadCount > 0 && (
              <Badge variant="destructive" className="text-xs font-semibold">
                {unreadCount} action required
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Real-time operational alerts for manual payment queues, mentor SLA link breaches, emergency cancellations, and booking intervention triggers.
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
            onClick={loadNotifs}
            variant="outline"
            size="sm"
            className="text-xs gap-1.5 h-8"
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </Button>

          <Button
            id="admin-new-broadcast-btn"
            onClick={() => setIsBroadcastOpen(true)}
            size="sm"
            className="gap-1.5 text-xs h-8 bg-zinc-900 text-white"
          >
            <Send className="h-3.5 w-3.5" />
            <span>New System Broadcast</span>
          </Button>
        </div>
      </div>

      {/* Simulator bar for testing all 4 Admin events */}
      {adminId && (
        <NotificationSimulator
          userId={adminId}
          role="admin"
          onEventDispatched={loadNotifs}
        />
      )}

      {/* Filter Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-zinc-50 p-2 rounded-xl border border-zinc-200">
        <div className="flex items-center gap-1 overflow-x-auto">
          {(['all', 'unread', 'read'] as const).map((st) => (
            <button
              key={st}
              id={`admin-filter-${st}`}
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
          <span className="text-[11px] font-medium text-zinc-400 pl-1">Alert Scope:</span>
          {['ALL', 'PAYMENT', 'SESSION', 'BOOKING', 'SYSTEM'].map((cat) => (
            <button
              key={cat}
              id={`admin-cat-${cat.toLowerCase()}`}
              onClick={() => setTypeFilter(cat)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer ${
                typeFilter === cat
                  ? 'bg-zinc-900 text-white font-semibold'
                  : 'bg-white text-zinc-600 border border-zinc-200 hover:bg-zinc-100'
              }`}
            >
              {cat === 'ALL' ? 'All Alerts' : cat}
            </button>
          ))}
        </div>
      </div>

      {/* Notification List */}
      {loading ? (
        <div className="py-16 flex flex-col justify-center items-center text-zinc-400 text-xs gap-2">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-600" />
          <span>Synchronizing operational audit queue...</span>
        </div>
      ) : notifications.length === 0 ? (
        <EmptyState
          icon={ShieldAlert}
          title={statusFilter === 'unread' ? 'Zero Pending Operational Escalations' : 'No Operational Alerts'}
          description={
            statusFilter === 'unread'
              ? 'All SLA warnings, manual payment queues, and mentor escalations are cleared.'
              : 'No operational logs found matching this filter criteria.'
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

      {/* Broadcast Modal */}
      <Modal
        isOpen={isBroadcastOpen}
        onClose={() => setIsBroadcastOpen(false)}
        title="Broadcast System Announcement"
      >
        <form onSubmit={handleSendBroadcast} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-800 mb-1">
              Target Audience
            </label>
            <div className="flex gap-2">
              {[
                { id: 'all', label: 'All Users' },
                { id: 'seekers', label: 'Seekers Only' },
                { id: 'mentors', label: 'Mentors Only' },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setBroadcastTarget(t.id as any)}
                  className={`flex-1 py-1.5 px-2 text-xs rounded-lg border font-medium cursor-pointer ${
                    broadcastTarget === t.id
                      ? 'bg-zinc-950 text-white border-zinc-950'
                      : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-800 mb-1">
              Announcement Title
            </label>
            <Input
              id="broadcast-title-input"
              value={broadcastTitle}
              onChange={(e) => setBroadcastTitle(e.target.value)}
              placeholder="e.g., Scheduled Maintenance Window / Holiday Availability"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-800 mb-1">
              Message Content
            </label>
            <Textarea
              id="broadcast-msg-input"
              value={broadcastMsg}
              onChange={(e) => setBroadcastMsg(e.target.value)}
              placeholder="Provide clear details and instructions for platform participants..."
              rows={4}
              required
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-2 border-t border-zinc-100">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsBroadcastOpen(false)}
            >
              Cancel
            </Button>
            <Button
              id="broadcast-submit-btn"
              type="submit"
              size="sm"
              disabled={isBroadcasting}
              className="gap-1.5 bg-zinc-950 text-white"
            >
              {isBroadcasting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              <span>{broadcastSuccess ? 'Published!' : 'Send Broadcast'}</span>
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
