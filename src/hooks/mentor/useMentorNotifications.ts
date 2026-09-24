import { useState, useEffect, useCallback } from 'react';
import {
  fetchUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from '@/src/lib/notificationService';
import type { Notification } from '@/src/types/database';

export interface UseMentorNotificationsResult {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  refetch: () => Promise<void>;
}

export function useMentorNotifications(
  userId: string | undefined,
  filter?: {
    status?: 'all' | 'unread' | 'read';
    type?: string;
  }
): UseMentorNotificationsResult {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!userId) {
      setNotifications([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await fetchUserNotifications(userId, filter);
      setNotifications(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, [userId, filter?.status, filter?.type]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const markRead = useCallback(
    async (id: string) => {
      if (!userId) return;
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === id
            ? { ...n, is_read: true, read_at: new Date().toISOString() }
            : n
        )
      );
      try {
        await markNotificationAsRead(id, userId);
      } catch (err: any) {
        setError(err.message);
      }
    },
    [userId]
  );

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, is_read: true, read_at: new Date().toISOString() }))
    );
    try {
      await markAllNotificationsAsRead(userId);
    } catch (err: any) {
      setError(err.message);
    }
  }, [userId]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return {
    notifications,
    unreadCount,
    loading,
    error,
    markRead,
    markAllRead,
    refetch,
  };
}
