/**
 * Support Center domain rules.
 *
 * Pure module, no database and no React: the server and the browser import the
 * same constants, so a status label can never disagree between the admin queue
 * and the user's own ticket view.
 *
 * The DATABASE is the authority. Every enum here mirrors a CHECK constraint or
 * an allow-list in `20261015000000_phase41_support_center.sql`, and the RPCs
 * re-check every one of them. This module exists for rendering, for offering
 * the right choices in a dropdown, and for failing fast in a unit test — not as
 * a substitute for the server-side check.
 */

import type { UserRole } from '@/src/types/navigation';

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export const SUPPORT_TICKET_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_FOR_USER',
  'RESOLVED',
  'CLOSED',
] as const;
export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];

/**
 * Status is never conveyed by colour alone. Each badge ships a glyph and a
 * label alongside its tone, so a status is still distinguishable in a
 * monochrome print or to a screen-reader user.
 */
const STATUS_PRESENTATION: Record<
  SupportTicketStatus,
  { label: string; icon: string; tone: BadgeTone }
> = {
  OPEN: { label: 'Open', icon: '●', tone: 'info' },
  IN_PROGRESS: { label: 'In Progress', icon: '◐', tone: 'progress' },
  WAITING_FOR_USER: { label: 'Waiting for You', icon: '◔', tone: 'waiting' },
  RESOLVED: { label: 'Resolved', icon: '✓', tone: 'success' },
  CLOSED: { label: 'Closed', icon: '○', tone: 'neutral' },
};

export type BadgeTone = 'info' | 'progress' | 'waiting' | 'success' | 'neutral' | 'urgent';

export interface StatusPresentation {
  label: string;
  icon: string;
  tone: BadgeTone;
}

export const supportStatusPresentation = (status: string): StatusPresentation => {
  const known = STATUS_PRESENTATION[status as SupportTicketStatus];
  return known ?? { label: humaniseToken(status), icon: '●', tone: 'neutral' };
};

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

export const SUPPORT_TICKET_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type SupportTicketPriority = (typeof SUPPORT_TICKET_PRIORITIES)[number];

const PRIORITY_PRESENTATION: Record<SupportTicketPriority, { label: string; icon: string }> = {
  LOW: { label: 'Low', icon: '↓' },
  NORMAL: { label: 'Normal', icon: '→' },
  HIGH: { label: 'High', icon: '↑' },
  URGENT: { label: 'Urgent', icon: '⚠' },
};

export const supportPriorityPresentation = (priority: string) => {
  const known = PRIORITY_PRESENTATION[priority as SupportTicketPriority];
  return known ?? { label: humaniseToken(priority), icon: '→' };
};

/**
 * Every ticket opens at NORMAL and only an admin may raise it.
 *
 * Exported as a single named constant rather than as a comment so a test can
 * assert the value the create RPC hard-codes.
 */
export const DEFAULT_TICKET_PRIORITY: SupportTicketPriority = 'NORMAL';

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/**
 * The per-role allow-list. A single closed set: the database rejects anything
 * outside it, and `create_support_ticket` rejects a category that is not in the
 * caller's real role's list.
 */
export const SUPPORT_TICKET_CATEGORIES: Record<UserRole, readonly string[]> = {
  seeker: ['BOOKING', 'PAYMENT', 'SESSION', 'MENTOR', 'ACCOUNT', 'TECHNICAL', 'OTHER'],
  mentor: ['BOOKING', 'AVAILABILITY', 'PAYMENT', 'SESSION', 'PROFILE', 'TECHNICAL', 'OTHER'],
  admin: ['USER', 'MENTOR', 'BOOKING', 'PAYMENT', 'SYSTEM', 'TECHNICAL', 'OTHER'],
};

const CATEGORY_LABELS: Record<string, string> = {
  BOOKING: 'Booking',
  PAYMENT: 'Payment',
  SESSION: 'Session',
  MENTOR: 'Mentor',
  ACCOUNT: 'Account',
  TECHNICAL: 'Technical',
  OTHER: 'Other',
  AVAILABILITY: 'Availability',
  PROFILE: 'Profile',
  USER: 'User',
  SYSTEM: 'System',
};

export const supportCategoryLabel = (category: string): string =>
  CATEGORY_LABELS[category] ?? humaniseToken(category);

/** A category is only offered if the caller's real role has it. */
export const isCategoryAllowedForRole = (role: UserRole, category: string): boolean =>
  (SUPPORT_TICKET_CATEGORIES[role] ?? []).includes(category);

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

/**
 * The transition table, identical to `public.is_valid_support_transition`.
 *
 * Duplicated on purpose and covered by a test that reads both sides: the SQL
 * is the boundary, this copy is what the UI uses to disable a button. If the two
 * ever disagree, the test fails rather than the UI offering a move the database
 * refuses.
 */
export const SUPPORT_STATUS_TRANSITIONS: Record<SupportTicketStatus, readonly SupportTicketStatus[]> = {
  OPEN: ['IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['WAITING_FOR_USER', 'RESOLVED', 'CLOSED'],
  WAITING_FOR_USER: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['OPEN', 'CLOSED'],
  CLOSED: [],
};

export const canTransitionSupportStatus = (from: string, to: string): boolean =>
  (SUPPORT_STATUS_TRANSITIONS[from as SupportTicketStatus] ?? []).includes(to as SupportTicketStatus);

/**
 * Whether a requester may add a public message.
 *
 * A RESOLVED ticket takes no reply either: the supported action there is
 * "Reopen", which posts the reason onto the conversation as its own message. A
 * CLOSED ticket is finished, and reopening it is deliberately not offered.
 */
export const isSupportTicketReplyable = (status: string): boolean =>
  (['OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER'] as const).includes(status as SupportTicketStatus);

/** Whether the "Reopen" button should appear. */
export const isSupportTicketReopenable = (status: string): boolean => status === 'RESOLVED';

// ---------------------------------------------------------------------------
// Audit events
// ---------------------------------------------------------------------------

export const SUPPORT_AUDIT_EVENT_TYPES = [
  'TICKET_CREATED',
  'TICKET_MESSAGE_SENT',
  'TICKET_INTERNAL_NOTE_ADDED',
  'TICKET_STATUS_CHANGED',
  'TICKET_PRIORITY_CHANGED',
  'TICKET_ASSIGNED',
  'TICKET_RESOLVED',
  'TICKET_REOPENED',
  'ATTACHMENT_ADDED',
  'REFUND_REQUESTED',
  'REFUND_STATUS_CHANGED',
] as const;
export type SupportAuditEventType = (typeof SUPPORT_AUDIT_EVENT_TYPES)[number];

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Mirrors the CHECK constraints and the RPC's own bounds. */
export const SUPPORT_SUBJECT_MIN = 4;
export const SUPPORT_SUBJECT_MAX = 140;
export const SUPPORT_MESSAGE_MIN = 20;
export const SUPPORT_MESSAGE_MAX = 4000;
export const SUPPORT_RESOLUTION_MIN = 5;
export const SUPPORT_RESOLUTION_MAX = 4000;
export const SUPPORT_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const SUPPORT_ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
] as const;

/**
 * A human booking code, e.g. `BK-SESSION-1A2B`.
 *
 * Typed as a format check only. It is NOT an authorization control: the server
 * resolves the code against `bookings` and refuses one that does not belong to
 * the caller. A regex can stop a UUID being pasted into the field, and nothing
 * more.
 */
export const BOOKING_CODE_PATTERN = /^BK-[A-Za-z0-9-]{1,32}$/;
export const isValidBookingCode = (value: string): boolean =>
  BOOKING_CODE_PATTERN.test(value.trim());

/** `SK-20261015-000042`. The public identifier users and admins quote. */
export const SUPPORT_TICKET_CODE_PATTERN = /^SK-[0-9]{8}-[0-9]{6}$/;

// ---------------------------------------------------------------------------
// Notification wording
// ---------------------------------------------------------------------------

/**
 * The single definition of what each support notification says.
 *
 * The `resolution` is folded into the user's RESOLVED copy so the notification
 * alone is actionable: the user does not have to open the ticket to learn what
 * was decided about their issue.
 */
export function supportNotificationCopy(
  event:
    | 'SUPPORT_TICKET_CREATED'
    | 'SUPPORT_TICKET_REPLY'
    | 'SUPPORT_TICKET_WAITING_FOR_USER'
    | 'SUPPORT_TICKET_RESOLVED'
    | 'SUPPORT_TICKET_REOPENED'
    | 'SUPPORT_TICKET_ASSIGNED'
    | 'SUPPORT_REFUND_UPDATED',
  input: { ticketCode: string; subject?: string | null; resolution?: string | null },
): { title: string; message: string } {
  const code = input.ticketCode;
  switch (event) {
    case 'SUPPORT_TICKET_CREATED':
      return {
        title: `New support ticket ${code}`,
        message: `A new support ticket needs attention: ${input.subject ?? code}.`,
      };
    case 'SUPPORT_TICKET_REPLY':
      return {
        title: `Support ticket ${code} has a new reply`,
        message: 'You have a new reply on your support ticket.',
      };
    case 'SUPPORT_TICKET_WAITING_FOR_USER':
      return {
        title: 'Support needs more information',
        message: `Support is waiting for information from you on ticket ${code}.`,
      };
    case 'SUPPORT_TICKET_RESOLVED':
      return {
        title: `Support ticket ${code} resolved`,
        message: input.resolution
          ? `Your support ticket has been resolved. ${input.resolution}`
          : 'Your support ticket has been resolved.',
      };
    case 'SUPPORT_TICKET_REOPENED':
      return {
        title: `Support ticket ${code} reopened`,
        message: 'Your support ticket was reopened.',
      };
    case 'SUPPORT_TICKET_ASSIGNED':
      return {
        title: 'A support ticket was assigned to you',
        message: `Support ticket ${code} has been assigned to you.`,
      };
    case 'SUPPORT_REFUND_UPDATED':
      return {
        title: `Refund updated for ticket ${code}`,
        message: `Your refund status for ticket ${code} has been updated.`,
      };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** `WAITING_FOR_USER` -> `Waiting for user`. The fallback for an unknown token. */
export const humaniseToken = (value: string): string => {
  const cleaned = value.replace(/_/g, ' ').trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
};

/** `5 min ago`. Short, and honest that it is a relative rendering. */
export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const seconds = Math.round((now.getTime() - then) / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;

  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The date format used on a ticket header. */
export const formatTicketDate = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** `₹1,499`. Matches the formatting the rest of the payment UI uses. */
export const formatInr = (amount: number | null | undefined): string =>
  `₹${(Number.isFinite(Number(amount)) ? Number(amount) : 0).toLocaleString('en-IN')}`;