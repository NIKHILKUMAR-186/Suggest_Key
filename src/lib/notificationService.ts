import { apiFetch } from './apiClient';
import { supabase, isSupabaseConfigured } from './supabase';
import { logSanitizer } from './logSanitizer';
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
    const res = await apiFetch(`/api/notifications?${queryParams.toString()}`);
    if (res.ok) {
      const data = await res.json();
      if (data.notifications && Array.isArray(data.notifications)) {
        return data.notifications;
      }
    }
  } catch (err) {
    console.warn('API notification fetch fallback:', logSanitizer.safeMessage(err));
  }

  // Fallback to Supabase direct query if client configured
  if (isSupabaseConfigured() && supabase) {
    try {
      let query = supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
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
      console.warn('Supabase direct query failed, returning empty:', logSanitizer.safeMessage(sbErr));
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
    const res = await apiFetch(`/api/notifications/${notificationId}/read`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, isRead: true }),
    });
    if (res.ok) {
      const data = await res.json();
      return !!data.success;
    }
  } catch (err) {
    console.warn('API mark as read failed:', logSanitizer.safeMessage(err));
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
      console.warn('Supabase mark read error:', logSanitizer.safeMessage(sbErr));
    }
  }

  return false;
}

/**
 * Marks all unread notifications for a user as read.
 */
export async function markAllNotificationsAsRead(userId: string): Promise<number> {
  try {
    const res = await apiFetch('/api/notifications/mark-all-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.updatedCount ?? 0;
    }
  } catch (err) {
    console.warn('API mark all read error:', logSanitizer.safeMessage(err));
  }

  if (isSupabaseConfigured() && supabase) {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('is_read', false)
        .select('id');
      if (!error && data) {
        return data.length;
      }
    } catch (sbErr) {
      console.warn('Supabase mark all read error:', logSanitizer.safeMessage(sbErr));
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
    const res = await apiFetch('/api/notifications/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = await res.json();
      return data.notification;
    }
  } catch (err) {
    console.warn('API dispatch notification failed:', logSanitizer.safeMessage(err));
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
      console.warn('Supabase dispatch notification failed:', logSanitizer.safeMessage(sbErr));
    }
  }

  return null;
}

/**
 * Resolves where a notification's action button should navigate for the role
 * reading it.
 *
 * `notifications.link` is written by whichever server-side event produced the
 * row, and that event knows who it is talking to. The risk is an admin queue
 * containing a link that was written for a participant: an admin clicking
 * "Review Payment" must never land on a seeker page, which would both break the
 * workflow and hand an operator a view scoped to someone else's booking.
 *
 * So the destination is resolved from the event's own subject, per role, rather
 * than trusted from the stored string. An admin always gets an admin route; a
 * link that cannot be mapped is replaced by that role's own home rather than
 * navigated to verbatim.
 *
 * `entityId` is the real record id the notification was written for, so the
 * destination identifies the actual record and never a hardcoded one.
 */
export function resolveNotificationLink(
  link: string | null | undefined,
  role: 'seeker' | 'mentor' | 'admin',
  entityId?: string | null,
): string | null {
  if (!link || typeof link !== 'string') return null;

  const [rawPath, rawQuery = ''] = link.split('?');
  const path = rawPath.trim();
  if (!path) return null;

  // Carries the notification's own record reference across, so the destination
  // can focus the record the event is actually about. A `payments` event carries
  // a payment id, so it is forwarded as `paymentId` rather than as a booking id.
  const incoming = new URLSearchParams(rawQuery);
  const isUuid = (value: string | null): value is string =>
    !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const recordId = entityId ?? null;
  const bookingId = incoming.get('bookingId') || (isUuid(recordId) ? recordId : null);
  const withBooking = (route: string) => (bookingId ? `${route}?bookingId=${encodeURIComponent(bookingId)}` : route);
  // Admin payment review is keyed on the payment row, so the notification's own
  // record id is passed as `paymentId` and the queue opens that exact record.
  const withPayment = (route: string) =>
    isUuid(recordId) ? `${route}?paymentId=${encodeURIComponent(recordId)}` : route;

  if (role === 'admin') {
    // Already an admin route: keep it, but drop any participant query that would
    // only make sense on a seeker or mentor page.
    if (path.startsWith('/admin/')) {
      const params = new URLSearchParams(rawQuery);
      params.delete('bookingId');
      const query = params.toString();
      return query ? `${path}?${query}` : path;
    }

    if (path.startsWith('/seeker/')) {
      if (path.startsWith('/seeker/payment')) return withPayment('/admin/payments');
      if (path.startsWith('/seeker/workspace')) return withBooking('/admin/workspaces');
      return withBooking('/admin/bookings');
    }

    if (path.startsWith('/mentor/')) {
      if (path.startsWith('/mentor/workspace')) return withBooking('/admin/workspaces');
      if (path.startsWith('/mentor/bookings')) return withBooking('/admin/bookings');
      return '/admin/mentors';
    }

    if (path === '/' || path === '') return '/admin';

    // A payment event is about a payment row, so the review queue is the right
    // destination even when the writer left a generic link.
    if (/\/payment/i.test(path)) return withPayment('/admin/payments');
    if (/\/booking/i.test(path)) return withBooking('/admin/bookings');

    // Nothing recognisable: send the operator to their own console rather than
    // to an unknown or participant-facing path.
    return '/admin';
  }

  if (role === 'mentor') {
    if (path.startsWith('/admin/')) return '/mentor';
    return link;
  }

  if (path.startsWith('/admin/') || path.startsWith('/mentor/')) return '/seeker';
  return link;
}

/**
 * The action label for a notification button, chosen from the destination the
 * link actually resolves to so the wording always matches the page it opens.
 */
export function notificationActionLabel(resolvedLink: string | null): string | null {
  if (!resolvedLink) return null;
  const path = resolvedLink.toLowerCase();

  if (path.includes('/payments')) return 'Review Payment';
  if (path.includes('/mentor-verification')) return 'Review Application';
  if (path.includes('/workspace')) return 'Open Workspace';
  if (path.includes('/session')) return 'Join Prep Room';
  if (path.includes('/booking')) return 'View Booking';
  if (path.includes('/mentor')) return 'View Mentor';
  if (path.includes('/settings')) return 'Open Settings';
  return 'View Details';
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
