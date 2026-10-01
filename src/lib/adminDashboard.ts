/**
 * ADMIN OPERATIONS DASHBOARD — shared contract & pure derivations.
 *
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * The Admin dashboard used to be a page of hardcoded business values
 * ("100% On-Time", a "Zero Backlog State" toggle, a static SLA narrative and a
 * hardcoded default segment name). Every number rendered by the dashboard must
 * come from the live database, so the *shape* of the payload and every
 * derivation that turns database rows into a metric live here, outside JSX.
 *
 * DESIGN RULES ENFORCED BY THIS MODULE
 * ---------------------------------------------------------------------------
 * 1. No fabricated data. There is no mock/demo fallback anywhere: a metric is
 *    either derived from rows the server read, or the section is reported as
 *    an error state and the UI says so.
 * 2. One definition per business concept. Booking states, the mentor approval
 *    states and the 2-hour meeting-link deadline all come from the existing
 *    authoritative modules (`@/src/types/database`, `@/src/lib/bookingEngine`,
 *    `@/src/config/app`) instead of being re-declared here.
 * 3. UTC in, explicit timezone out. Database timestamps are UTC; the dashboard
 *    converts for display in a single, clearly defined display timezone
 *    (APP_CONFIG.DEFAULT_TIMEZONE) so "today" means the same thing on the
 *    server and in the browser.
 */

import { APP_CONFIG } from '@/src/config/app';
import { calculateMeetingLinkDeadline } from '@/src/lib/bookingEngine';
import type { BookingStatus, PaymentStatus } from '@/src/types/database';

/** Single display timezone for "today" buckets and every rendered time. */
export const ADMIN_DASHBOARD_TIMEZONE = APP_CONFIG.DEFAULT_TIMEZONE;

export const ADMIN_DASHBOARD_ACTIVITY_LIMIT = 8;
export const ADMIN_DASHBOARD_UPCOMING_LIMIT = 6;
export const ADMIN_DASHBOARD_RECENT_BOOKING_LIMIT = 5;
export const ADMIN_DASHBOARD_EXCEPTION_LIMIT = 8;
export const ADMIN_DASHBOARD_SYSTEM_LOG_WINDOW_HOURS = 24;
export const MEETING_LINK_DEADLINE_MINUTES = (APP_CONFIG.MEETING_LINK_DEADLINE_MS / (60 * 1000)) | 0;

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const getZonedParts = (date: Date, timeZone: string): ZonedParts => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = formatter.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value ?? '0';
    return Number.parseInt(value, 10) || 0;
  };

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    // `en-CA` can render midnight as 24 in some ICU versions.
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  };
};

/** Offset (ms) to ADD to a UTC instant to obtain wall-clock time in `timeZone`. */
const getTimeZoneOffsetMs = (date: Date, timeZone: string): number => {
  const parts = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
};

const zonedMidnightUtcMs = (year: number, month: number, day: number, timeZone: string): number => {
  // Two passes converge for every real-world offset, including DST changes.
  const naive = Date.UTC(year, month - 1, day, 0, 0, 0);
  const firstPass = naive - getTimeZoneOffsetMs(new Date(naive), timeZone);
  return naive - getTimeZoneOffsetMs(new Date(firstPass), timeZone);
};

export interface DayBoundsUtc {
  /** Inclusive start of the display day, as a UTC ISO string. */
  startUtc: string;
  /** Exclusive end of the display day, as a UTC ISO string. */
  endUtc: string;
}

/**
 * Resolves the [start, end) UTC window of the display day containing `nowUtc`.
 * Computed on the server so the "today" bucket is identical for every admin and
 * is never derived from browser-local time.
 */
export const getDisplayDayBoundsUtc = (
  nowUtc: Date,
  timeZone: string = ADMIN_DASHBOARD_TIMEZONE,
): DayBoundsUtc => {
  const { year, month, day } = getZonedParts(nowUtc, timeZone);
  const startMs = zonedMidnightUtcMs(year, month, day, timeZone);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const endMs = zonedMidnightUtcMs(
    nextDay.getUTCFullYear(),
    nextDay.getUTCMonth() + 1,
    nextDay.getUTCDate(),
    timeZone,
  );

  return {
    startUtc: new Date(startMs).toISOString(),
    endUtc: new Date(endMs).toISOString(),
  };
};

/** Formats a UTC ISO timestamp as a time-of-day in the display timezone. */
export const formatDashboardTime = (
  isoUtc: string,
  timeZone: string = ADMIN_DASHBOARD_TIMEZONE,
): string => {
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
};

/** `26 Sep, 2:30 PM` in the display timezone. */
export const formatDashboardDateTime = (
  isoUtc: string,
  timeZone: string = ADMIN_DASHBOARD_TIMEZONE,
): string => {
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
};

/** True when the UTC instant falls inside the display day of `nowUtc`. */
export const isSameDisplayDay = (
  isoUtc: string,
  nowUtc: Date,
  timeZone: string = ADMIN_DASHBOARD_TIMEZONE,
): boolean => {
  const bounds = getDisplayDayBoundsUtc(nowUtc, timeZone);
  const value = Date.parse(isoUtc);
  return value >= Date.parse(bounds.startUtc) && value < Date.parse(bounds.endUtc);
};

// ---------------------------------------------------------------------------
// Authoritative business states (re-used, never re-declared)
// ---------------------------------------------------------------------------

/** Booking states that still represent live, unresolved operational work. */
export const ACTIONABLE_BOOKING_STATUSES: readonly BookingStatus[] = [
  'PAYMENT_PENDING',
  'PENDING_VERIFICATION',
  'MENTOR_PENDING',
  'CONFIRMED',
];

/** Payment states actually present in the live `payments` table. */
export const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  'PENDING_VERIFICATION',
  'VERIFIED',
  'REJECTED',
];

/** Payment state that requires an admin verification decision. */
export const PENDING_PAYMENT_STATUS: PaymentStatus = 'PENDING_VERIFICATION';

export type BookingStatusTone = 'action' | 'progress' | 'confirmed' | 'done' | 'closed' | 'neutral';

export interface BookingStatusMeta {
  label: string;
  tone: BookingStatusTone;
  description: string;
}

const BOOKING_STATUS_META: Record<BookingStatus, BookingStatusMeta> = {
  PAYMENT_PENDING: { label: 'Payment pending', tone: 'action', description: 'Awaiting seeker payment submission.' },
  PENDING_VERIFICATION: { label: 'Payment verification', tone: 'action', description: 'Awaiting admin payment verification.' },
  MENTOR_PENDING: { label: 'Mentor pending', tone: 'progress', description: 'Awaiting mentor confirmation and meeting link.' },
  CONFIRMED: { label: 'Confirmed', tone: 'confirmed', description: 'Session confirmed with a meeting link.' },
  COMPLETED: { label: 'Completed', tone: 'done', description: 'Session completed.' },
  CANCELLED: { label: 'Cancelled', tone: 'closed', description: 'Session cancelled.' },
  REJECTED: { label: 'Rejected', tone: 'closed', description: 'Booking rejected.' },
};

export const isKnownBookingStatus = (status: string): status is BookingStatus =>
  Object.prototype.hasOwnProperty.call(BOOKING_STATUS_META, status);

export const getBookingStatusMeta = (
  status: BookingStatus | string | null | undefined,
): BookingStatusMeta => {
  if (status && isKnownBookingStatus(status)) {
    return BOOKING_STATUS_META[status];
  }
  return {
    label: status ? status.replace(/_/g, ' ') : 'Unknown',
    tone: 'neutral',
    description: 'Unrecognised booking state.',
  };
};

// ---------------------------------------------------------------------------
// Pure derivations (unit tested in tests/admin_dashboard.test.ts)
// ---------------------------------------------------------------------------

export interface CountableBooking {
  status: BookingStatus | string;
}

/** Counts bookings per authoritative status. Missing states resolve to 0. */
export const countBookingsByStatus = <T extends CountableBooking>(
  rows: readonly T[],
): Record<BookingStatus, number> => {
  const counts: Record<BookingStatus, number> = {
    PAYMENT_PENDING: 0,
    PENDING_VERIFICATION: 0,
    MENTOR_PENDING: 0,
    CONFIRMED: 0,
    COMPLETED: 0,
    CANCELLED: 0,
    REJECTED: 0,
  };

  for (const row of rows) {
    if (isKnownBookingStatus(row.status)) {
      counts[row.status] += 1;
    }
  }
  return counts;
};

/** Deduplicates role rows so one user is never counted twice. */
export const countDistinctUsersByRole = (
  rows: ReadonlyArray<{ user_id: string; role: string }>,
): Record<string, number> => {
  const byRole = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row?.user_id || !row?.role) continue;
    const bucket = byRole.get(row.role) ?? new Set<string>();
    bucket.add(row.user_id);
    byRole.set(row.role, bucket);
  }

  const counts: Record<string, number> = {};
  for (const [role, users] of byRole.entries()) {
    counts[role] = users.size;
  }
  return counts;
};

export interface RankedSegment {
  id: string;
  name: string;
  slug?: string | null;
  priority: number;
}

/**
 * Highest-priority active segment, derived from the real `segments` rows
 * ordered by `priority` ascending (priority 1 wins) — the ordering the rest of
 * the platform already uses. Returns `null` when no segment is active.
 */
export const selectHighestPrioritySegment = <T extends RankedSegment>(
  segments: readonly T[],
): T | null => {
  if (!segments.length) return null;
  return segments.reduce((best, candidate) => (candidate.priority < best.priority ? candidate : best));
};

// ---------------------------------------------------------------------------
// Exception centre
// ---------------------------------------------------------------------------

export type DashboardExceptionKind =
  | 'MEETING_LINK_OVERDUE'
  | 'MEETING_LINK_DUE_SOON'
  | 'STALE_SLOT_HOLD'
  | 'PAYMENT_PENDING_BOOKING';

export interface DashboardException {
  id: string;
  kind: DashboardExceptionKind;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  bookingCode: string | null;
  bookingId: string | null;
  startTimeUtc: string | null;
  deadlineUtc: string | null;
  href: string;
}

export interface DeadlineCandidate {
  id: string;
  booking_code: string | null;
  status: BookingStatus | string;
  start_time: string;
  meeting_url: string | null;
}

export interface StaleHoldCandidate {
  id: string;
  expires_at: string;
  status: string;
}

/**
 * Derives real meeting-link exceptions from MENTOR_PENDING bookings.
 *
 * The deadline is the project's existing rule (`MEETING_LINK_DEADLINE_MINUTES`
 * before session start, `APP_CONFIG.MEETING_LINK_DEADLINE_MS`, applied through
 * `calculateMeetingLinkDeadline`). IMPORTANT: missing the deadline is reported
 * as an exception ONLY — it never implies cancellation, which is the existing
 * business rule and is left untouched.
 *
 * `staleHolds` are real ACTIVE slot holds whose `expires_at` has passed.
 * `hasPaymentPendingBookings` adds one informational exception; the count
 * itself already lives in the action queue, so it is not duplicated.
 */
export const buildDashboardExceptions = (
  candidates: readonly DeadlineCandidate[],
  staleHolds: readonly StaleHoldCandidate[],
  nowUtc: Date,
  options: { hasPaymentPendingBookings?: boolean; limit?: number } = {},
): DashboardException[] => {
  const limit = options.limit ?? ADMIN_DASHBOARD_EXCEPTION_LIMIT;
  const exceptions: DashboardException[] = [];

  for (const booking of candidates) {
    if (booking.status !== 'MENTOR_PENDING') continue;
    if (booking.meeting_url) continue;

    const { deadlineUtc, isOverdue, minutesUntilSession } = calculateMeetingLinkDeadline(
      booking.start_time,
      nowUtc,
    );
    const sessionStillUpcoming = Date.parse(booking.start_time) > nowUtc.getTime();
    const code = booking.booking_code ?? null;

    if (isOverdue) {
      exceptions.push({
        id: `overdue-${booking.id}`,
        kind: 'MEETING_LINK_OVERDUE',
        severity: 'critical',
        title: sessionStillUpcoming
          ? 'Meeting link deadline missed'
          : 'Session reached without a meeting link',
        detail: sessionStillUpcoming
          ? `No meeting link ${minutesUntilSession}m before session start. The booking is NOT auto-cancelled — mentor follow-up is required.`
          : 'The session start time has passed while the booking is still MENTOR_PENDING with no meeting link.',
        bookingCode: code,
        bookingId: booking.id,
        startTimeUtc: booking.start_time,
        deadlineUtc,
        href: '/admin/bookings',
      });
      continue;
    }

    exceptions.push({
      id: `due-soon-${booking.id}`,
      kind: 'MEETING_LINK_DUE_SOON',
      severity: 'warning',
      title: 'Meeting link deadline approaching',
      detail: `Due in ${minutesUntilSession}m before session start (recommended ${MEETING_LINK_DEADLINE_MINUTES}m).`,
      bookingCode: code,
      bookingId: booking.id,
      startTimeUtc: booking.start_time,
      deadlineUtc,
      href: '/admin/bookings',
    });
  }

  for (const hold of staleHolds) {
    exceptions.push({
      id: `stale-hold-${hold.id}`,
      kind: 'STALE_SLOT_HOLD',
      severity: 'warning',
      title: 'Expired slot hold still active',
      detail: 'A slot hold is still ACTIVE after its expiry, so the slot stays locked.',
      bookingCode: null,
      bookingId: null,
      startTimeUtc: null,
      deadlineUtc: hold.expires_at,
      href: '/admin/bookings',
    });
  }

  if (options.hasPaymentPendingBookings) {
    exceptions.push({
      id: 'payment-pending-bookings',
      kind: 'PAYMENT_PENDING_BOOKING',
      severity: 'info',
      title: 'Bookings awaiting payment',
      detail: 'One or more bookings are still in PAYMENT_PENDING and cannot become confirmed sessions.',
      bookingCode: null,
      bookingId: null,
      startTimeUtc: null,
      deadlineUtc: null,
      href: '/admin/bookings',
    });
  }

  const severityRank: Record<DashboardException['severity'], number> = { critical: 0, warning: 1, info: 2 };
  return exceptions
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
    .slice(0, limit);
};

/** Expiry state of a slot hold, derived from real `expires_at` timestamps. */
export const isStaleSlotHold = (
  hold: { status: string; expires_at: string },
  nowUtc: Date,
): boolean => hold.status === 'ACTIVE' && Date.parse(hold.expires_at) <= nowUtc.getTime();

// ---------------------------------------------------------------------------
// Dashboard payload contract
// ---------------------------------------------------------------------------

export type DashboardSectionStatus = 'ok' | 'error';

export interface DashboardSection<T> {
  status: DashboardSectionStatus;
  data: T | null;
  error: string | null;
}

export const dashboardSection = <T>(data: T): DashboardSection<T> => ({
  status: 'ok',
  data,
  error: null,
});

export const dashboardSectionError = <T>(error: string): DashboardSection<T> => ({
  status: 'error',
  data: null,
  error,
});

export interface AdminDashboardUserMetrics {
  seekers: number;
  mentors: number;
  admins: number;
  distinctUsers: number;
}

export interface AdminDashboardMentorMetrics {
  totalProfiles: number;
  approved: number;
  pendingReview: number;
  inactive: number;
  activeAndApproved: number;
  /** `mentor_applications` rows in `pending_review` — the Mentor Verification queue. */
  pendingApplications: number;
}

export interface AdminDashboardSegmentMetrics {
  totalCount: number;
  activeCount: number;
  highestPriority: RankedSegment | null;
  active: RankedSegment[];
}

export interface AdminDashboardPaymentMetrics {
  pending: number;
  verified: number;
  rejected: number;
  total: number;
  submittedToday: number;
}

export interface AdminDashboardBookingMetrics {
  total: number;
  paymentPending: number;
  pendingVerification: number;
  mentorPending: number;
  confirmed: number;
  completed: number;
  cancelled: number;
  rejected: number;
  todayTotal: number;
  todayByStatus: Record<BookingStatus, number>;
  /**
   * Every future session that is CONFIRMED or MENTOR_PENDING. This is the real
   * total — NOT the length of the capped "upcoming sessions" preview list.
   */
  upcomingTotal: number;
}

export interface AdminDashboardActionMetrics {
  pendingPayments: number;
  pendingMentorApprovals: number;
  mentorPendingBookings: number;
  overdueMeetingLinks: number;
  totalActionable: number;
  allQueuesClear: boolean;
}

export interface AdminDashboardSessionRow {
  id: string;
  bookingCode: string | null;
  status: BookingStatus | string;
  startTimeUtc: string;
  endTimeUtc: string | null;
  seekerName: string;
  mentorName: string;
  segmentName: string | null;
  gigTitle: string | null;
  amountInr: number | null;
  displayTime: string;
  isToday: boolean;
}

export interface AdminDashboardRecentBookingRow {
  id: string;
  bookingCode: string | null;
  status: BookingStatus | string;
  startTimeUtc: string;
  seekerName: string;
  mentorName: string;
  segmentName: string | null;
  amountInr: number | null;
  displayTime: string;
}

export interface AdminDashboardActivityRow {
  id: string;
  action: string;
  actorName: string;
  actorRole: string | null;
  entityType: string | null;
  entityId: string | null;
  createdAtUtc: string;
  displayTime: string;
  relativeAge: string;
}

export interface AdminDashboardSystemHealth {
  api: {
    requests24h: number;
    errors24h: number;
    serverErrors24h: number;
    errorRatePercent: number;
  };
  database: {
    sectionsOk: number;
    sectionsFailed: number;
    status: 'ok' | 'degraded';
  };
  bookingEngine: {
    activeHolds: number;
    expiredActiveHolds: number;
  };
  audit: {
    events24h: number;
  };
}

export interface AdminDashboardPayload {
  /** Server timestamp of the successful aggregation (UTC ISO). */
  generatedAtUtc: string;
  /** Display timezone used for every "today" bucket and rendered time. */
  timezone: string;
  /** Meeting-link deadline rule in force, in minutes (existing business rule). */
  meetingLinkDeadlineMinutes: number;
  users: DashboardSection<AdminDashboardUserMetrics>;
  mentors: DashboardSection<AdminDashboardMentorMetrics>;
  segments: DashboardSection<AdminDashboardSegmentMetrics>;
  payments: DashboardSection<AdminDashboardPaymentMetrics>;
  bookings: DashboardSection<AdminDashboardBookingMetrics>;
  actions: DashboardSection<AdminDashboardActionMetrics>;
  upcomingSessions: DashboardSection<AdminDashboardSessionRow[]>;
  recentBookings: DashboardSection<AdminDashboardRecentBookingRow[]>;
  recentActivity: DashboardSection<AdminDashboardActivityRow[]>;
  exceptions: DashboardSection<DashboardException[]>;
  systemHealth: DashboardSection<AdminDashboardSystemHealth>;
}

/** Turns a raw action such as `MENTOR_APPROVED` into `Mentor approved`. */
export const humanizeAuditAction = (action: string): string => {
  const cleaned = (action || '').replace(/[_-]+/g, ' ').trim();
  if (!cleaned) return 'System event';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
};

/** Compact relative age used by the activity feed, e.g. `4m ago`. */
export const formatRelativeAge = (isoUtc: string, nowUtc: Date): string => {
  const value = Date.parse(isoUtc);
  if (Number.isNaN(value)) return '—';

  const diffMs = nowUtc.getTime() - value;
  const future = diffMs < 0;
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60000);
  if (minutes < 1) return future ? 'in a moment' : 'just now';
  if (minutes < 60) return future ? `in ${minutes}m` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return future ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return future ? `in ${days}d` : `${days}d ago`;
};

/** `HH:MM:SS` freshness stamp rendered in the dashboard header. */
export const formatLastUpdatedClock = (date: Date): string =>
  new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(date);
