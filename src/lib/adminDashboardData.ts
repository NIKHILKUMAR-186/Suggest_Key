/**
 * ADMIN OPERATIONS DASHBOARD — the single data service.
 *
 * The page must not fire dozens of independent Supabase queries from JSX, and
 * it must not count hundreds of rows in the browser. `getAdminDashboardData`
 * performs one aggregated, fully parallelised read of the live database and
 * returns the structured payload declared in `@/src/lib/adminDashboard`.
 *
 * GUARANTEES
 * ---------------------------------------------------------------------------
 * * Counters are pushed down to Postgres (`head: true` + `count: 'exact'`), so
 *   no row data crosses the wire for a pure count.
 * * Lists are explicitly capped (upcoming sessions, recent bookings, activity,
 *   exception candidates).
 * * Sections fail independently: one broken query degrades ONE panel instead of
 *   crashing the console, and never falls back to a fabricated value.
 * * Privacy: no payment proof path, no email address and no private seeker
 *   field is ever selected. Party resolution is limited to `id` + `full_name`.
 *   Payment proof review stays on the dedicated /admin/payments page.
 * * The caller owns authentication/authorization (`requireAdmin`); this
 *   function only trusts the server-side client it is handed.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ADMIN_DASHBOARD_ACTIVITY_LIMIT,
  ADMIN_DASHBOARD_RECENT_BOOKING_LIMIT,
  ADMIN_DASHBOARD_SYSTEM_LOG_WINDOW_HOURS,
  ADMIN_DASHBOARD_TIMEZONE,
  ADMIN_DASHBOARD_UPCOMING_LIMIT,
  MEETING_LINK_DEADLINE_HOURS,
  buildDashboardExceptions,
  countDistinctUsersByRole,
  dashboardSection,
  dashboardSectionError,
  formatDashboardDateTime,
  formatDashboardTime,
  formatRelativeAge,
  getDisplayDayBoundsUtc,
  isSameDisplayDay,
  isStaleSlotHold,
  selectHighestPrioritySegment,
  type AdminDashboardActivityRow,
  type AdminDashboardBookingMetrics,
  type AdminDashboardMentorMetrics,
  type AdminDashboardPayload,
  type AdminDashboardPaymentMetrics,
  type AdminDashboardRecentBookingRow,
  type AdminDashboardSegmentMetrics,
  type AdminDashboardSessionRow,
  type AdminDashboardSystemHealth,
  type AdminDashboardUserMetrics,
  type DashboardException,
  type DashboardSection,
  type DeadlineCandidate,
  type RankedSegment,
  type StaleHoldCandidate,
} from '@/src/lib/adminDashboard';
import { getErrorMessage } from '@/src/lib/supabaseErrors';
import type { BookingStatus } from '@/src/types/database';

/** Runs a section loader, converting any failure into an error section. */
const runSection = async <T>(
  label: string,
  loader: () => Promise<DashboardSection<T>>,
): Promise<DashboardSection<T>> => {
  try {
    return await loader();
  } catch (error) {
    return dashboardSectionError<T>(`${label}: ${getErrorMessage(error)}`);
  }
};

interface BookingListRow {
  id: string;
  booking_code: string | null;
  status: string;
  start_time: string;
  end_time: string | null;
  amount_inr: number | null;
  seeker_id: string;
  mentor_id: string;
  // PostgREST may type a to-one embed as an object or as a single-item array
  // depending on the generated schema, so both shapes are normalised here.
  segment: { name: string } | { name: string }[] | null;
  gig: { title: string } | { title: string }[] | null;
}

/** Reads a to-one embed regardless of whether PostgREST returned an array. */
const embeddedField = <T>(value: T | T[] | null): T | null => {
  if (Array.isArray(value)) return value.length ? value[0] : null;
  return value ?? null;
};

const BOOKING_LIST_COLUMNS =
  'id, booking_code, status, start_time, end_time, amount_inr, seeker_id, mentor_id, segment:segments(name), gig:gigs(title)';

const UNKNOWN_PARTY_LABEL = 'Unknown';

const BOOKING_STATUS_LIST: readonly BookingStatus[] = [
  'PAYMENT_PENDING',
  'PENDING_VERIFICATION',
  'MENTOR_PENDING',
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
];

export interface GetAdminDashboardDataOptions {
  /** Injected in tests; defaults to the server clock. */
  now?: Date;
  /** Display timezone for "today" buckets and rendered times. */
  timeZone?: string;
}

export async function getAdminDashboardData(
  client: SupabaseClient,
  options: GetAdminDashboardDataOptions = {},
): Promise<AdminDashboardPayload> {
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? ADMIN_DASHBOARD_TIMEZONE;
  const nowIso = now.toISOString();
  const day = getDisplayDayBoundsUtc(now, timeZone);
  const windowStartIso = new Date(
    now.getTime() - ADMIN_DASHBOARD_SYSTEM_LOG_WINDOW_HOURS * 60 * 60 * 1000,
  ).toISOString();

  // -------------------------------------------------------------------------
  // 1. Users — one narrow read of `user_roles`, deduplicated in memory so a
  //    multi-role account is never counted twice.
  // -------------------------------------------------------------------------
  const usersSection = await runSection('User metrics unavailable', async () => {
    const { data, error } = await client.from('user_roles').select('user_id, role');
    if (error) throw error;

    const rows = (data ?? []) as Array<{ user_id: string; role: string }>;
    const counts = countDistinctUsersByRole(rows);
    const distinctUsers = new Set(rows.map((row) => row.user_id)).size;

    const metrics: AdminDashboardUserMetrics = {
      seekers: counts.seeker ?? 0,
      mentors: counts.mentor ?? 0,
      admins: counts.admin ?? 0,
      distinctUsers,
    };
    return dashboardSection(metrics);
  });

  // -------------------------------------------------------------------------
  // 2. Mentors — only schema-supported states: approval_status, is_active and
  //    is_approved, plus the `mentor_applications` verification queue.
  // -------------------------------------------------------------------------
  const mentorsSection = await runSection('Mentor metrics unavailable', async () => {
    const [totalRes, approvedRes, pendingRes, inactiveRes, activeApprovedRes, applicationsRes] =
      await Promise.all([
        client.from('mentor_profiles').select('id', { count: 'exact', head: true }),
        client.from('mentor_profiles').select('id', { count: 'exact', head: true }).eq('is_approved', true),
        client
          .from('mentor_profiles')
          .select('id', { count: 'exact', head: true })
          .eq('approval_status', 'pending_review'),
        client.from('mentor_profiles').select('id', { count: 'exact', head: true }).eq('is_active', false),
        client
          .from('mentor_profiles')
          .select('id', { count: 'exact', head: true })
          .eq('is_approved', true)
          .eq('is_active', true),
        client
          .from('mentor_applications')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending_review'),
      ]);

    const firstError =
      totalRes.error ??
      approvedRes.error ??
      pendingRes.error ??
      inactiveRes.error ??
      activeApprovedRes.error ??
      applicationsRes.error;
    if (firstError) throw firstError;

    const metrics: AdminDashboardMentorMetrics = {
      totalProfiles: totalRes.count ?? 0,
      approved: approvedRes.count ?? 0,
      pendingReview: pendingRes.count ?? 0,
      inactive: inactiveRes.count ?? 0,
      activeAndApproved: activeApprovedRes.count ?? 0,
      pendingApplications: applicationsRes.count ?? 0,
    };
    return dashboardSection(metrics);
  });

  // -------------------------------------------------------------------------
  // 3. Segments — active count and highest-priority active segment, both read
  //    from the real rows.
  // -------------------------------------------------------------------------
  const segmentsSection = await runSection('Segment metrics unavailable', async () => {
    const [activeRes, totalRes, rowsRes] = await Promise.all([
      client.from('segments').select('id', { count: 'exact', head: true }).eq('is_active', true),
      client.from('segments').select('id', { count: 'exact', head: true }),
      client
        .from('segments')
        .select('id, name, slug, priority')
        .eq('is_active', true)
        .order('priority', { ascending: true })
        .limit(12),
    ]);

    const firstError = activeRes.error ?? totalRes.error ?? rowsRes.error;
    if (firstError) throw firstError;

    const active = (rowsRes.data ?? []) as RankedSegment[];
    const metrics: AdminDashboardSegmentMetrics = {
      totalCount: totalRes.count ?? 0,
      activeCount: activeRes.count ?? 0,
      highestPriority: selectHighestPrioritySegment(active),
      active,
    };
    return dashboardSection(metrics);
  });

  // -------------------------------------------------------------------------
  // 4. Payments — the live states are PENDING_VERIFICATION / VERIFIED /
  //    REJECTED (supabase/migrations/20260920000001_phase4_mvp_schema.sql).
  //    No proof path is selected here; proof review stays on /admin/payments.
  // -------------------------------------------------------------------------
  const paymentsSection = await runSection('Payment metrics unavailable', async () => {
    const [pendingRes, verifiedRes, rejectedRes, todayRes] = await Promise.all([
      client.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'PENDING_VERIFICATION'),
      client.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'VERIFIED'),
      client.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'REJECTED'),
      client
        .from('payments')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', day.startUtc)
        .lt('created_at', day.endUtc),
    ]);

    const firstError = pendingRes.error ?? verifiedRes.error ?? rejectedRes.error ?? todayRes.error;
    if (firstError) throw firstError;

    const pending = pendingRes.count ?? 0;
    const verified = verifiedRes.count ?? 0;
    const rejected = rejectedRes.count ?? 0;
    const metrics: AdminDashboardPaymentMetrics = {
      pending,
      verified,
      rejected,
      total: pending + verified + rejected,
      submittedToday: todayRes.count ?? 0,
    };
    return dashboardSection(metrics);
  });

  // -------------------------------------------------------------------------
  // 5. Bookings — counts are pushed down per authoritative state, and the
  //    "today" bucket is bounded by the display-day window computed above.
  // -------------------------------------------------------------------------
  const bookingsSection = await runSection('Booking metrics unavailable', async () => {
    const [totalRes, upcomingRes, ...statusResults] = await Promise.all([
      client.from('bookings').select('id', { count: 'exact', head: true }),
      client
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .in('status', ['CONFIRMED', 'MENTOR_PENDING'])
        .gte('start_time', nowIso),
      ...BOOKING_STATUS_LIST.map((status) =>
        client.from('bookings').select('id', { count: 'exact', head: true }).eq('status', status),
      ),
      ...BOOKING_STATUS_LIST.map((status) =>
        client
          .from('bookings')
          .select('id', { count: 'exact', head: true })
          .eq('status', status)
          .gte('start_time', day.startUtc)
          .lt('start_time', day.endUtc),
      ),
    ]);

    const firstError =
      totalRes.error ?? upcomingRes.error ?? statusResults.find((result) => result.error)?.error;
    if (firstError) throw firstError;

    const counts = {} as Record<BookingStatus, number>;
    const todayByStatus = {} as Record<BookingStatus, number>;
    BOOKING_STATUS_LIST.forEach((status, index) => {
      counts[status] = statusResults[index].count ?? 0;
      todayByStatus[status] = statusResults[BOOKING_STATUS_LIST.length + index].count ?? 0;
    });

    const metrics: AdminDashboardBookingMetrics = {
      total: totalRes.count ?? 0,
      paymentPending: counts.PAYMENT_PENDING,
      pendingVerification: counts.PENDING_VERIFICATION,
      mentorPending: counts.MENTOR_PENDING,
      confirmed: counts.CONFIRMED,
      completed: counts.COMPLETED,
      cancelled: counts.CANCELLED,
      rejected: counts.REJECTED,
      todayTotal: Object.values(todayByStatus).reduce((sum, value) => sum + value, 0),
      todayByStatus,
      upcomingTotal: upcomingRes.count ?? 0,
    };
    return dashboardSection(metrics);
  });

  // -------------------------------------------------------------------------
  // 6. Operational lists — upcoming sessions, recent bookings, meeting-link
  //    deadline candidates and slot holds. All strictly capped.
  // -------------------------------------------------------------------------
  const [upcomingResult, recentResult, deadlineResult, holdResult] = await Promise.all([
    client
      .from('bookings')
      .select(BOOKING_LIST_COLUMNS)
      .in('status', ['CONFIRMED', 'MENTOR_PENDING'])
      .gte('start_time', nowIso)
      .order('start_time', { ascending: true })
      .limit(ADMIN_DASHBOARD_UPCOMING_LIMIT),
    client
      .from('bookings')
      .select(BOOKING_LIST_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(ADMIN_DASHBOARD_RECENT_BOOKING_LIMIT),
    client
      .from('bookings')
      .select('id, booking_code, status, start_time, meeting_url')
      .eq('status', 'MENTOR_PENDING')
      .is('meeting_url', null)
      .order('start_time', { ascending: true })
      .limit(25),
    client
      .from('slot_holds')
      .select('id, expires_at, status')
      .eq('status', 'ACTIVE')
      .limit(50),
  ]);

  const listRows: BookingListRow[] = [
    ...((upcomingResult.data ?? []) as unknown as BookingListRow[]),
    ...((recentResult.data ?? []) as unknown as BookingListRow[]),
  ];

  const resolvePartyNames = async (): Promise<Map<string, string>> => {
    const ids = Array.from(new Set(listRows.flatMap((row) => [row.seeker_id, row.mentor_id])));
    if (!ids.length) return new Map();
    const { data, error } = await client.from('profiles').select('id, full_name').in('id', ids);
    if (error) throw error;
    return new Map(
      ((data ?? []) as Array<{ id: string; full_name: string }>).map((row) => [row.id, row.full_name]),
    );
  };

  const nameFor = (names: Map<string, string>, id: string): string =>
    names.get(id) ?? UNKNOWN_PARTY_LABEL;

  const upcomingSessionsSection = await runSection('Upcoming sessions unavailable', async () => {
    if (upcomingResult.error) throw upcomingResult.error;
    const names = await resolvePartyNames();
    const rows: AdminDashboardSessionRow[] = ((
      upcomingResult.data ?? []
    ) as unknown as BookingListRow[]).map((row) => ({
      id: row.id,
      bookingCode: row.booking_code,
      status: row.status,
      startTimeUtc: row.start_time,
      endTimeUtc: row.end_time,
      seekerName: nameFor(names, row.seeker_id),
      mentorName: nameFor(names, row.mentor_id),
      segmentName: embeddedField(row.segment)?.name ?? null,
      gigTitle: embeddedField(row.gig)?.title ?? null,
      amountInr: row.amount_inr ?? null,
      displayTime: formatDashboardTime(row.start_time, timeZone),
      isToday: isSameDisplayDay(row.start_time, now, timeZone),
    }));
    return dashboardSection(rows);
  });

  const recentBookingsSection = await runSection('Recent bookings unavailable', async () => {
    if (recentResult.error) throw recentResult.error;
    const names = await resolvePartyNames();
    const rows: AdminDashboardRecentBookingRow[] = ((
      recentResult.data ?? []
    ) as unknown as BookingListRow[]).map((row) => ({
      id: row.id,
      bookingCode: row.booking_code,
      status: row.status,
      startTimeUtc: row.start_time,
      seekerName: nameFor(names, row.seeker_id),
      mentorName: nameFor(names, row.mentor_id),
      segmentName: embeddedField(row.segment)?.name ?? null,
      amountInr: row.amount_inr ?? null,
      displayTime: formatDashboardDateTime(row.start_time, timeZone),
    }));
    return dashboardSection(rows);
  });

  // -------------------------------------------------------------------------
  // 7. Exception centre — real deadline evaluation + real stale holds.
  // -------------------------------------------------------------------------
  const exceptionsSection = await runSection('Exception checks unavailable', async () => {
    if (deadlineResult.error) throw deadlineResult.error;
    if (holdResult.error) throw holdResult.error;

    const candidates = (deadlineResult.data ?? []) as DeadlineCandidate[];
    const holds = (holdResult.data ?? []) as StaleHoldCandidate[];
    const staleHolds = holds.filter((hold) => isStaleSlotHold(hold, now));

    const exceptions: DashboardException[] = buildDashboardExceptions(candidates, staleHolds, now, {
      hasPaymentPendingBookings: (bookingsSection.data?.paymentPending ?? 0) > 0,
    });
    return dashboardSection(exceptions);
  });

  // -------------------------------------------------------------------------
  // 8. Action queue — derived from the metrics above, never re-queried.
  // -------------------------------------------------------------------------
  const actionsSection = await runSection('Action queue unavailable', async () => {
    if (!paymentsSection.data) throw new Error('Payment metrics unavailable');
    if (!mentorsSection.data) throw new Error('Mentor metrics unavailable');
    if (!bookingsSection.data) throw new Error('Booking metrics unavailable');
    if (!exceptionsSection.data) throw new Error('Exception checks unavailable');

    const pendingPayments = paymentsSection.data.pending;
    const pendingMentorApprovals =
      mentorsSection.data.pendingApplications + mentorsSection.data.pendingReview;
    const mentorPendingBookings = bookingsSection.data.mentorPending;
    const overdueMeetingLinks = exceptionsSection.data.filter(
      (exception) => exception.kind === 'MEETING_LINK_OVERDUE',
    ).length;

    const totalActionable =
      pendingPayments + pendingMentorApprovals + mentorPendingBookings + overdueMeetingLinks;

    return dashboardSection({
      pendingPayments,
      pendingMentorApprovals,
      mentorPendingBookings,
      overdueMeetingLinks,
      totalActionable,
      allQueuesClear: totalActionable === 0,
    });
  });

  // -------------------------------------------------------------------------
  // 9. Recent activity — the REAL `audit_logs` trail written by
  //    `auditAction` / `logAuditEvent`. No synthetic events.
  // -------------------------------------------------------------------------
  const recentActivitySection = await runSection('Recent activity unavailable', async () => {
    const { data, error } = await client
      .from('audit_logs')
      .select('id, action, actor_user_id, actor_role, entity_type, entity_id, created_at')
      .order('created_at', { ascending: false })
      .limit(ADMIN_DASHBOARD_ACTIVITY_LIMIT);
    if (error) throw error;

    const rows = (data ?? []) as Array<{
      id: string;
      action: string | null;
      actor_user_id: string | null;
      actor_role: string | null;
      entity_type: string | null;
      entity_id: string | null;
      created_at: string;
    }>;

    const actorIds = Array.from(
      new Set(rows.map((row) => row.actor_user_id).filter((id): id is string => Boolean(id))),
    );
    let actorNames = new Map<string, string>();
    if (actorIds.length) {
      const { data: actors, error: actorError } = await client
        .from('profiles')
        .select('id, full_name')
        .in('id', actorIds);
      if (actorError) throw actorError;
      actorNames = new Map(
        ((actors ?? []) as Array<{ id: string; full_name: string }>).map((row) => [
          row.id,
          row.full_name,
        ]),
      );
    }

    const activity: AdminDashboardActivityRow[] = rows.map((row) => ({
      id: row.id,
      action: row.action ?? 'UNKNOWN_ACTION',
      actorName: row.actor_user_id ? actorNames.get(row.actor_user_id) ?? 'System' : 'System',
      actorRole: row.actor_role,
      entityType: row.entity_type,
      entityId: row.entity_id,
      createdAtUtc: row.created_at,
      displayTime: formatDashboardDateTime(row.created_at, timeZone),
      relativeAge: formatRelativeAge(row.created_at, now),
    }));
    return dashboardSection(activity);
  });

  // -------------------------------------------------------------------------
  // 10. System health — only signals that actually exist in the database.
  // -------------------------------------------------------------------------
  const systemHealthSection = await runSection('System health unavailable', async () => {
    const [requestsRes, errorsRes, serverErrorsRes, auditRes, activeHoldsRes, expiredHoldsRes] =
      await Promise.all([
        client
          .from('system_logs')
          .select('id', { count: 'exact', head: true })
          .eq('category', 'api_request')
          .gte('created_at', windowStartIso),
        client
          .from('system_logs')
          .select('id', { count: 'exact', head: true })
          .eq('category', 'api_error')
          .gte('created_at', windowStartIso),
        client
          .from('system_logs')
          .select('id', { count: 'exact', head: true })
          .eq('category', 'api_error')
          .gte('status_code', 500)
          .gte('created_at', windowStartIso),
        client
          .from('audit_logs')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', windowStartIso),
        client.from('slot_holds').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE'),
        client
          .from('slot_holds')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'ACTIVE')
          .lte('expires_at', nowIso),
      ]);

    const firstError =
      requestsRes.error ??
      errorsRes.error ??
      serverErrorsRes.error ??
      auditRes.error ??
      activeHoldsRes.error ??
      expiredHoldsRes.error;
    if (firstError) throw firstError;

    const requests = requestsRes.count ?? 0;
    const errors = errorsRes.count ?? 0;
    const health: AdminDashboardSystemHealth = {
      api: {
        requests24h: requests,
        errors24h: errors,
        serverErrors24h: serverErrorsRes.count ?? 0,
        errorRatePercent: requests > 0 ? Number(((errors / requests) * 100).toFixed(1)) : 0,
      },
      database: { sectionsOk: 0, sectionsFailed: 0, status: 'ok' },
      bookingEngine: {
        activeHolds: activeHoldsRes.count ?? 0,
        expiredActiveHolds: expiredHoldsRes.count ?? 0,
      },
      audit: { events24h: auditRes.count ?? 0 },
    };
    return dashboardSection(health);
  });

  const operationalSections: DashboardSection<unknown>[] = [
    usersSection,
    mentorsSection,
    segmentsSection,
    paymentsSection,
    bookingsSection,
    actionsSection,
    upcomingSessionsSection,
    recentBookingsSection,
    recentActivitySection,
    exceptionsSection,
  ];

  // Database health is itself derived — how many sections answered and how many
  // degraded. It is never a hardcoded "healthy".
  const sectionsOk = operationalSections.filter((section) => section.status === 'ok').length;
  const sectionsFailed = operationalSections.length - sectionsOk;
  if (systemHealthSection.data) {
    systemHealthSection.data.database = {
      sectionsOk,
      sectionsFailed,
      status: sectionsFailed === 0 ? 'ok' : 'degraded',
    };
  }

  return {
    generatedAtUtc: nowIso,
    timezone: timeZone,
    meetingLinkDeadlineHours: MEETING_LINK_DEADLINE_HOURS,
    users: usersSection,
    mentors: mentorsSection,
    segments: segmentsSection,
    payments: paymentsSection,
    bookings: bookingsSection,
    actions: actionsSection,
    upcomingSessions: upcomingSessionsSection,
    recentBookings: recentBookingsSection,
    recentActivity: recentActivitySection,
    exceptions: exceptionsSection,
    systemHealth: systemHealthSection,
  };
}
