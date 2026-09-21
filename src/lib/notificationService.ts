import { supabase, isSupabaseConfigured } from './supabase';
import type { Notification, NotificationType, NotificationEventType } from '@/src/types/database';

export interface NotificationFilter {
  status?: 'all' | 'unread' | 'read';
  type?: string;
  limit?: number;
}

export interface NotificationDispatchPayload {
  userId: string;
  title: string;
  message: string;
  type: NotificationType;
  eventType?: NotificationEventType | string;
  entityType?: 'booking' | 'payment' | 'session' | 'workspace' | 'mentor' | 'seeker' | string;
  entityId?: string;
  link?: string | null;
  metadata?: Record<string, any>;
}

/**
 * Normalizes user ID to match database IDs (e.g., usr-8801 <-> 88888888-8888-8888-8888-888888888881)
 */
export function normalizeUserIds(userId: string): string[] {
  const map: Record<string, string[]> = {
    'usr-8801': ['usr-8801', '88888888-8888-8888-8888-888888888881'],
    '88888888-8888-8888-8888-888888888881': ['usr-8801', '88888888-8888-8888-8888-888888888881'],
    'usr-8802': ['usr-8802', '11111111-1111-1111-1111-111111111111', 'usr-mentor-rahul'],
    '11111111-1111-1111-1111-111111111111': ['usr-8802', '11111111-1111-1111-1111-111111111111', 'usr-mentor-rahul'],
    'usr-mentor-rahul': ['usr-8802', '11111111-1111-1111-1111-111111111111', 'usr-mentor-rahul'],
    'usr-8800': ['usr-8800', '88888888-8888-8888-8888-888888888880', 'admin'],
    '88888888-8888-8888-8888-888888888880': ['usr-8800', '88888888-8888-8888-8888-888888888880', 'admin'],
    'admin': ['usr-8800', '88888888-8888-8888-8888-888888888880', 'admin'],
  };
  return map[userId] || [userId];
}

/**
 * Fetches real in-app notifications from API / Supabase database.
 */
export async function fetchUserNotifications(
  userId: string,
  filter?: NotificationFilter
): Promise<Notification[]> {
  const queryParams = new URLSearchParams();
  queryParams.set('userId', userId);
  if (filter?.status) queryParams.set('status', filter.status);
  if (filter?.type) queryParams.set('type', filter.type);
  if (filter?.limit) queryParams.set('limit', String(filter.limit));

  try {
    const res = await fetch(`/api/notifications?${queryParams.toString()}`);
    if (res.ok) {
      const data = await res.json();
      if (data.notifications && Array.isArray(data.notifications)) {
        return data.notifications;
      }
    }
  } catch (err) {
    console.warn('API notification fetch fallback:', err);
  }

  // Fallback to Supabase direct query if client configured
  if (isSupabaseConfigured() && supabase) {
    try {
      const ids = normalizeUserIds(userId);
      let query = supabase
        .from('notifications')
        .select('*')
        .in('user_id', ids)
        .order('created_at', { ascending: false });

      if (filter?.status === 'unread') {
        query = query.eq('is_read', false);
      } else if (filter?.status === 'read') {
        query = query.eq('is_read', true);
      }

      if (filter?.type && filter.type !== 'ALL') {
        query = query.eq('type', filter.type);
      }

      if (filter?.limit) {
        query = query.limit(filter.limit);
      }

      const { data, error } = await query;
      if (!error && data) {
        return data as Notification[];
      }
    } catch (sbErr) {
      console.warn('Supabase direct query failed, returning empty:', sbErr);
    }
  }

  return [];
}

/**
 * Marks a single notification as read in the database.
 */
export async function markNotificationAsRead(
  notificationId: string,
  userId: string
): Promise<boolean> {
  try {
    const res = await fetch(`/api/notifications/${notificationId}/read`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, isRead: true }),
    });
    if (res.ok) {
      const data = await res.json();
      return !!data.success;
    }
  } catch (err) {
    console.warn('API mark as read failed:', err);
  }

  // Fallback to direct Supabase update
  if (isSupabaseConfigured() && supabase) {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', notificationId);
      return !error;
    } catch (sbErr) {
      console.warn('Supabase mark read error:', sbErr);
    }
  }

  return false;
}

/**
 * Marks all unread notifications for a user as read.
 */
export async function markAllNotificationsAsRead(userId: string): Promise<number> {
  try {
    const res = await fetch('/api/notifications/mark-all-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.updatedCount ?? 0;
    }
  } catch (err) {
    console.warn('API mark all read error:', err);
  }

  if (isSupabaseConfigured() && supabase) {
    try {
      const ids = normalizeUserIds(userId);
      const { data, error } = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .in('user_id', ids)
        .eq('is_read', false)
        .select('id');
      if (!error && data) {
        return data.length;
      }
    } catch (sbErr) {
      console.warn('Supabase mark all read error:', sbErr);
    }
  }

  return 0;
}

/**
 * Dispatches a new notification to the database.
 */
export async function dispatchNotification(
  payload: NotificationDispatchPayload
): Promise<Notification | null> {
  try {
    const res = await fetch('/api/notifications/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = await res.json();
      return data.notification;
    }
  } catch (err) {
    console.warn('API dispatch notification failed:', err);
  }

  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .insert({
          user_id: payload.userId,
          title: payload.title,
          message: payload.message,
          type: payload.type,
          event_type: payload.eventType,
          entity_type: payload.entityType,
          entity_id: payload.entityId,
          link: payload.link,
          metadata: payload.metadata || {},
          is_read: false,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (!error && data) {
        return data as Notification;
      }
    } catch (sbErr) {
      console.warn('Supabase dispatch notification failed:', sbErr);
    }
  }

  return null;
}

/**
 * Event simulation preset definitions across all 3 roles (Seeker: 11, Mentor: 8, Admin: 4).
 */
export interface EventPreset {
  eventType: NotificationEventType;
  category: 'seeker' | 'mentor' | 'admin';
  title: string;
  messageTemplate: (bookingCode: string) => string;
  type: NotificationType;
  entityType: string;
  linkTemplate: (bookingCode: string) => string;
  severity?: 'normal' | 'urgent' | 'action';
}

export const NOTIFICATION_EVENT_PRESETS: EventPreset[] = [
  // --- SEEKER PRESETS (11) ---
  {
    eventType: 'BOOKING_CREATED',
    category: 'seeker',
    title: 'Booking Created',
    messageTemplate: (code) => `Consultation slot reserved for #${code}. Complete payment verification within 15 minutes to secure your slot.`,
    type: 'BOOKING',
    entityType: 'booking',
    linkTemplate: (code) => `/seeker/bookings?bookingId=${code.toLowerCase()}`,
  },
  {
    eventType: 'PAYMENT_SUBMITTED',
    category: 'seeker',
    title: 'Payment Submitted',
    messageTemplate: (code) => `Your UPI transfer screenshot for #${code} has been uploaded and queued for admin verification.`,
    type: 'PAYMENT',
    entityType: 'payment',
    linkTemplate: (code) => `/seeker/bookings?bookingId=${code.toLowerCase()}`,
  },
  {
    eventType: 'PAYMENT_APPROVED',
    category: 'seeker',
    title: 'Payment Approved',
    messageTemplate: (code) => `Your payment for #${code} was approved by operations. The session is confirmed awaiting mentor meeting link.`,
    type: 'PAYMENT',
    entityType: 'payment',
    linkTemplate: (code) => `/seeker/bookings?bookingId=${code.toLowerCase()}`,
  },
  {
    eventType: 'PAYMENT_REJECTED',
    category: 'seeker',
    title: 'Payment Rejected',
    messageTemplate: (code) => `Payment receipt for #${code} was rejected: Invalid transaction reference number. Please re-upload proof.`,
    type: 'PAYMENT',
    entityType: 'payment',
    linkTemplate: (code) => `/seeker/bookings?bookingId=${code.toLowerCase()}`,
    severity: 'action',
  },
  {
    eventType: 'MENTOR_CONFIRMED',
    category: 'seeker',
    title: 'Mentor Confirmation',
    messageTemplate: (code) => `Your mentor has accepted #${code} and locked the consultation into their official calendar.`,
    type: 'BOOKING',
    entityType: 'booking',
    linkTemplate: (code) => `/seeker/bookings?bookingId=${code.toLowerCase()}`,
  },
  {
    eventType: 'MEETING_LINK_AVAILABLE',
    category: 'seeker',
    title: 'Meeting Link Available',
    messageTemplate: (code) => `Your Google Meet URL for #${code} is now verified. You may join room 5 minutes before scheduled start time.`,
    type: 'SESSION',
    entityType: 'session',
    linkTemplate: (code) => `/seeker/session?bookingId=${code.toLowerCase()}`,
  },
  {
    eventType: 'SESSION_REMINDER',
    category: 'seeker',
    title: 'Session Reminder: 15m to Start',
    messageTemplate: (code) => `Your 1:1 consultation #${code} begins in 15 minutes. Check camera and audio in the session prep room.`,
    type: 'SESSION',
    entityType: 'session',
    linkTemplate: (code) => `/seeker/session?bookingId=${code.toLowerCase()}`,
    severity: 'urgent',
  },
  {
    eventType: 'CANCELLATION',
    category: 'seeker',
    title: 'Session Cancellation',
    messageTemplate: (code) => `Booking #${code} has been cancelled. Any applicable credit balance has been logged to your account.`,
    type: 'BOOKING',
    entityType: 'booking',
    linkTemplate: (code) => `/seeker/bookings?bookingId=${code.toLowerCase()}`,
  },
  {
    eventType: 'RESCHEDULING',
    category: 'seeker',
    title: 'Session Rescheduled',
    messageTemplate: (code) => `Consultation #${code} was successfully updated to your requested new time slot.`,
    type: 'BOOKING',
    entityType: 'booking',
    linkTemplate: (code) => `/seeker/bookings?bookingId=${code.toLowerCase()}`,
  },
  {
    eventType: 'SESSION_COMPLETED',
    category: 'seeker',
    title: 'Session Completed',
    messageTemplate: (code) => `Your consultation #${code} is complete. Your mentor will publish post-session workspace takeaways shortly.`,
    type: 'SESSION',
    entityType: 'session',
    linkTemplate: (code) => `/seeker/workspace?bookingId=${code.toLowerCase()}`,
  },
  {
    eventType: 'WORKSPACE_UPDATED',
    category: 'seeker',
    title: 'Workspace Notes Published',
    messageTemplate: (code) => `Mentor notes, key takeaways, suggestions, and action items have been published for #${code}.`,
    type: 'WORKSPACE',
    entityType: 'workspace',
    linkTemplate: (code) => `/seeker/workspace?bookingId=${code.toLowerCase()}`,
  },

  // --- MENTOR PRESETS (8) ---
  {
    eventType: 'PAYMENT_APPROVED',
    category: 'mentor',
    title: 'Seeker Payment Verified',
    messageTemplate: (code) => `Payment for #${code} was verified by admin. Please provide your secure HTTPS meeting link.`,
    type: 'PAYMENT',
    entityType: 'booking',
    linkTemplate: (code) => `/mentor/booking-detail?bookingId=${code.toLowerCase()}`,
    severity: 'action',
  },
  {
    eventType: 'NEW_BOOKING',
    category: 'mentor',
    title: 'New Booking Request',
    messageTemplate: (code) => `You have a new booking request #${code} for 1:1 consultation guidance.`,
    type: 'BOOKING',
    entityType: 'booking',
    linkTemplate: (code) => `/mentor/booking-detail?bookingId=${code.toLowerCase()}`,
  },
  {
    eventType: 'MEETING_LINK_DEADLINE',
    category: 'mentor',
    title: 'Meeting Link Deadline (2h)',
    messageTemplate: (code) => `Session #${code} starts in 2 hours. Platform policy requires adding the meeting link now.`,
    type: 'SESSION',
    entityType: 'booking',
    linkTemplate: (code) => `/mentor/booking-detail?bookingId=${code.toLowerCase()}`,
    severity: 'action',
  },
  {
    eventType: 'OVERDUE_MEETING_LINK',
    category: 'mentor',
    title: 'URGENT: Meeting Link Overdue',
    messageTemplate: (code) => `Session #${code} starts in less than 75 minutes and meeting link is missing. Please add URL immediately.`,
    type: 'SESSION',
    entityType: 'booking',
    linkTemplate: (code) => `/mentor/booking-detail?bookingId=${code.toLowerCase()}`,
    severity: 'urgent',
  },
  {
    eventType: 'MENTOR_SESSION_REMINDER',
    category: 'mentor',
    title: 'Upcoming Session Reminder',
    messageTemplate: (code) => `Session #${code} with your seeker starts in 15 minutes. Session access unlocks at T-5m.`,
    type: 'SESSION',
    entityType: 'session',
    linkTemplate: (code) => `/mentor/booking-detail?bookingId=${code.toLowerCase()}`,
  },
  {
    eventType: 'MENTOR_CANCELLATION',
    category: 'mentor',
    title: 'Consultation Cancelled',
    messageTemplate: (code) => `Seeker has cancelled booking #${code}. Slot has been returned to your open calendar availability.`,
    type: 'BOOKING',
    entityType: 'booking',
    linkTemplate: (code) => `/mentor/bookings`,
  },
  {
    eventType: 'MENTOR_RESCHEDULING',
    category: 'mentor',
    title: 'Consultation Rescheduled',
    messageTemplate: (code) => `Booking #${code} has been adjusted to a new agreed time. Your calendar has updated automatically.`,
    type: 'BOOKING',
    entityType: 'booking',
    linkTemplate: (code) => `/mentor/bookings`,
  },
  {
    eventType: 'SESSION_COMPLETION',
    category: 'mentor',
    title: 'Session Concluded: Prepare Workspace',
    messageTemplate: (code) => `Consultation #${code} has ended. Please compile notes, suggestions, and next steps in the workspace.`,
    type: 'WORKSPACE',
    entityType: 'workspace',
    linkTemplate: (code) => `/mentor/workspace?bookingId=${code.toLowerCase()}`,
    severity: 'action',
  },

  // --- ADMIN PRESETS (4) ---
  {
    eventType: 'ADMIN_PAYMENT_PROOF_SUBMITTED',
    category: 'admin',
    title: 'Payment Verification Required',
    messageTemplate: (code) => `New UPI screenshot submitted for booking #${code}. Awaiting admin ledger review.`,
    type: 'PAYMENT',
    entityType: 'payment',
    linkTemplate: () => `/admin/payments`,
    severity: 'action',
  },
  {
    eventType: 'ADMIN_OVERDUE_MENTOR_LINK',
    category: 'admin',
    title: 'SLA Breach: Overdue Mentor Link',
    messageTemplate: (code) => `Mentor has not provided meeting link for #${code} starting within 2 hours. SLA escalation triggered.`,
    type: 'SESSION',
    entityType: 'booking',
    linkTemplate: () => `/admin/bookings`,
    severity: 'urgent',
  },
  {
    eventType: 'ADMIN_MENTOR_CANCELLATION',
    category: 'admin',
    title: 'Mentor Cancellation Logged',
    messageTemplate: (code) => `Mentor submitted an emergency cancellation for consultation #${code}. Check seeker reassignment or refund.`,
    type: 'BOOKING',
    entityType: 'booking',
    linkTemplate: () => `/admin/bookings`,
    severity: 'action',
  },
  {
    eventType: 'ADMIN_BOOKING_INTERVENTION',
    category: 'admin',
    title: 'Booking Intervention Required',
    messageTemplate: (code) => `Critical operational anomaly detected on #${code}: T-45m deadline breached. Direct outreach required.`,
    type: 'BOOKING',
    entityType: 'booking',
    linkTemplate: () => `/admin/bookings`,
    severity: 'urgent',
  },
];

/**
 * Simulates and commits an authentic notification event to the real database.
 */
export async function simulateNotificationEvent(
  eventType: NotificationEventType,
  userId: string,
  bookingCode: string = 'BK-9021',
  customMessage?: string
): Promise<Notification | null> {
  const preset = NOTIFICATION_EVENT_PRESETS.find((p) => p.eventType === eventType);
  if (!preset) return null;

  const payload: NotificationDispatchPayload = {
    userId,
    title: preset.title,
    message: customMessage || preset.messageTemplate(bookingCode),
    type: preset.type,
    eventType: preset.eventType,
    entityType: preset.entityType,
    entityId: bookingCode.toLowerCase(),
    link: preset.linkTemplate(bookingCode),
    metadata: {
      bookingCode,
      simulatedAt: new Date().toISOString(),
      category: preset.category,
      severity: preset.severity || 'normal',
    },
  };

  return await dispatchNotification(payload);
}

/**
 * Formats ISO timestamps into human-readable relative duration strings (e.g., '10m ago', '2h ago', 'Yesterday').
 */
export function formatRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();

    if (diffMs < 0) return 'Just now';
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
  } catch {
    return 'Recently';
  }
}
