import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import {
  fetchUserNotifications,
  markNotificationAsRead as apiMarkRead,
  markAllNotificationsAsRead as apiMarkAllRead,
  dispatchNotification as apiDispatch,
  NotificationDispatchPayload,
} from '@/src/lib/notificationService';
import type { Notification } from '@/src/types/database';

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  refreshNotifications: () => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  dispatchNotification: (payload: NotificationDispatchPayload) => Promise<Notification | null>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, activeRole } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  // Compute effective user ID from auth context
  const effectiveUserId = user?.id;

  const refreshNotifications = useCallback(async () => {
    if (!effectiveUserId) return;
    setLoading(true);
    try {
      const list = await fetchUserNotifications(effectiveUserId);
      setNotifications(list);
    } catch (err) {
      console.error('Failed to load notifications in context:', err);
    } finally {
      setLoading(false);
    }
  }, [effectiveUserId]);

  useEffect(() => {
    refreshNotifications();
    // Periodic refresh every 30s to detect live events
    const interval = setInterval(refreshNotifications, 30000);
    return () => clearInterval(interval);
  }, [refreshNotifications]);

  const markAsRead = async (id: string) => {
    if (!effectiveUserId) return;
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n))
    );
    await apiMarkRead(id, effectiveUserId);
  };

  const markAllAsRead = async () => {
    if (!effectiveUserId) return;
    // Optimistic local update
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, is_read: true, read_at: new Date().toISOString() }))
    );
    await apiMarkAllRead(effectiveUserId);
  };

  const dispatchNotification = async (payload: NotificationDispatchPayload) => {
    const created = await apiDispatch(payload);
    if (created) {
      setNotifications((prev) => [created, ...prev]);
    }
    return created;
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        loading,
        refreshNotifications,
        markAsRead,
        markAllAsRead,
        dispatchNotification,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};
