/**
 * ADMIN — PLATFORM OPERATIONS CENTER
 *
 * A database-driven operational console, not a statistics page. Every number
 * rendered here comes from `GET /api/admin/dashboard/overview`, which is served
 * by `getAdminDashboardData()` in `@/src/lib/adminDashboardData`.
 *
 * WHAT WAS REMOVED (and is never rendered again):
 *   - the hardcoded "100% On-Time" SLA claim (no deadline evaluation existed),
 *   - the fake "Zero Backlog State" toggle (it always rendered an empty state),
 *   - the static 2-hour-SLA narrative, now derived per booking,
 *   - the request to a non-existent `/api/admin/dashboard/metrics` endpoint.
 *
 * WHAT IS NOT CLAIMED: this dashboard is not "realtime". Supabase Realtime is
 * not enabled for these tables, so the page revalidates on an interval, on tab
 * focus and via the [Refresh] button, and labels the data "Live operational
 * data" with a real "Last updated" clock.
 *
 * The existing Admin shell, sidebar, theme tokens and routing are untouched.
 */

import React from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  Layers,
  RefreshCw,
  ShieldCheck,
  Timer,
  Users,
} from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAdminDashboard } from '@/src/hooks/admin/useAdminDashboard';
import {
  ActionQueueCard,
  MetricSkeleton,
  MetricTile,
  PanelEmptyState,
  PanelErrorState,
  SectionCard,
  StatusPill,
} from '@/src/components/admin/OperationsPrimitives';
import {
  formatDashboardTime,
  humanizeAuditAction,
  type AdminDashboardSystemHealth,
  type DashboardSection,
} from '@/src/lib/adminDashboard';

/**
 * System-health tiles. Each value is read from a real table; the tone only
 * reflects the measured value (there is no unconditional "healthy" state).
 */
const SystemHealthGrid: React.FC<{ health: AdminDashboardSystemHealth }> = ({ health }) => {
  const totalSections = health.database.sectionsOk + health.database.sectionsFailed;

  const signals: Array<{ label: string; value: string; hint: string; tone: 'ok' | 'warn' | 'error' }> = [
    {
      label: 'Database reads',
      value: `${health.database.sectionsOk}/${totalSections}`,
      hint:
        health.database.status === 'ok'
          ? 'Every dashboard section answered.'
          : `${health.database.sectionsFailed} section(s) degraded.`,
      tone: health.database.status === 'ok' ? 'ok' : 'error',
    },
    {
      label: 'API requests',
      value: String(health.api.requests24h),
      hint: `${health.api.errors24h} error response(s) · ${health.api.serverErrors24h} server error(s)`,
      tone: health.api.serverErrors24h > 0 ? 'warn' : 'ok',
    },
    {
      label: 'Active slot holds',
      value: String(health.bookingEngine.activeHolds),
      hint: `${health.bookingEngine.expiredActiveHolds} still active after expiry`,
      tone: health.bookingEngine.expiredActiveHolds > 0 ? 'warn' : 'ok',
    },
    {
      label: 'Audit events',
      value: String(health.audit.events24h),
      hint: 'Recorded administrative actions in the window.',
      tone: 'ok',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {signals.map((signal) => (
        <div
          key={signal.label}
          className="rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg-hover)]/50 px-3 py-2.5"
        >
          <p className="text-[12px] font-semibold text-[var(--color-shell-text-subtle)]">
            {signal.label}
          </p>
          <p className="mt-1 text-xl font-black leading-none tabular-nums text-[var(--color-shell-text)]">
            {signal.value}
          </p>
          <p
            className={
              signal.tone === 'error'
                ? 'mt-1.5 text-[11px] text-[var(--color-shell-error)]'
                : signal.tone === 'warn'
                  ? 'mt-1.5 text-[11px] text-[var(--status-warning-strong)]'
                  : 'mt-1.5 text-[11px] text-[var(--color-shell-text-subtle)]'
            }
          >
            {signal.hint}
          </p>
        </div>
      ))}
    </div>
  );
};

/** Human-facing message for a section that could not be read. */
const sectionError = <T,>(section: DashboardSection<T> | undefined): string | null =>
  !section || section.status !== 'error' ? null : section.error ?? 'This section is unavailable.';

/** Real value of a section, or `null` when it is loading / errored. */
const sectionValue = <T,>(section: DashboardSection<T> | undefined): T | null =>
  section && section.status === 'ok' ? section.data : null;

/** True while a section must render skeletons instead of a value. */
const isSectionLoading = (data: unknown, isInitialLoading: boolean): boolean => isInitialLoading || !data;

export const AdminDashboardPage: React.FC = () => {
  const { navigate } = useNavigation();
  const { data, isInitialLoading, isRefreshing, error, lastUpdatedAt, refresh } = useAdminDashboard();

  const users = sectionValue(data?.users);
  const mentors = sectionValue(data?.mentors);
  const segments = sectionValue(data?.segments);
  const payments = sectionValue(data?.payments);
  const bookings = sectionValue(data?.bookings);
  const actions = sectionValue(data?.actions);
  const upcoming = sectionValue(data?.upcomingSessions);
  const recentBookings = sectionValue(data?.recentBookings);
  const activity = sectionValue(data?.recentActivity);
  const exceptions = sectionValue(data?.exceptions);
  const health = sectionValue(data?.systemHealth);

  const lastUpdatedClock = lastUpdatedAt
    ? `${String(lastUpdatedAt.getUTCHours()).padStart(2, '0')}:${String(lastUpdatedAt.getUTCMinutes()).padStart(2, '0')}:${String(lastUpdatedAt.getUTCSeconds()).padStart(2, '0')}`
    : '—';

  if (error && !data) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <AlertTriangle className="h-8 w-8 text-[var(--color-shell-error)]" />
        <h1 className="text-lg font-bold text-[var(--color-shell-text)]">
          Dashboard data is temporarily unavailable.
        </h1>
        <p className="max-w-md text-xs text-[var(--color-shell-text-muted)]">{error}</p>
        <Button onClick={() => void refresh()} isLoading={isRefreshing} size="sm" className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      {/* ---------------------------------------------------------------- */}
      {/* HEADER                                                          */}
      {/* ---------------------------------------------------------------- */}
      <header className="flex flex-col gap-4 border-b border-[var(--color-shell-border)] pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-shell-text)] sm:text-3xl">
              Operational Dashboard
            </h1>
            <Button
              onClick={() => void refresh()}
              isLoading={isRefreshing}
              variant="outline"
              size="sm"
              className="h-[34px] gap-1.5"
            >
              {!isRefreshing ? <RefreshCw className="h-3.5 w-3.5" /> : null}
              Refresh
            </Button>
          </div>
          <p className="mt-1 text-xs text-[var(--color-shell-text-muted)]">
            Live operational data — platform overview and actions requiring attention.
          </p>
        </div>

        <div className="rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-shell-text-subtle)]">
            Last updated
          </p>
          <p className="font-mono text-sm font-bold tabular-nums text-[var(--color-shell-text)]">
            {lastUpdatedClock}
            <span className="ml-1 text-[10px] font-medium text-[var(--color-shell-text-subtle)]">UTC</span>
          </p>
        </div>
      </header>

      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-shell-error)]/30 bg-[var(--color-shell-error-soft)] px-4 py-2.5"
        >
          <p className="text-[12px] font-semibold text-[var(--color-shell-error)]">
            {error} Showing the last successful snapshot.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void refresh()}
            className="h-auto min-h-0 px-0 text-[11px] font-bold text-[var(--color-shell-error)] hover:text-[var(--color-shell-error)] underline-offset-2 hover:underline hover:bg-transparent"
          >
            Retry
          </Button>
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* ACTION QUEUE — the most important band on the page             */}
      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="action-queue-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            id="action-queue-heading"
            className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-shell-text-subtle)]"
          >
            Action queue
          </h2>
          {actions ? (
            actions.allQueuesClear ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--status-success-border)] bg-[var(--status-success-soft)] px-2.5 py-1 text-[12px] font-bold text-[var(--status-success-strong)]">
                <CheckCircle2 className="h-3.5 w-3.5" />
                All operational queues clear
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--status-warning-border)] bg-[var(--status-warning-soft)] px-2.5 py-1 text-[11px] font-bold text-[var(--status-warning-strong)]">
                <AlertTriangle className="h-3.5 w-3.5" />
                {actions.totalActionable} item{actions.totalActionable === 1 ? '' : 's'} need attention
              </span>
            )
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ActionQueueCard
            icon={CreditCard}
            title="Pending payments"
            count={actions?.pendingPayments ?? null}
            description="Payment submissions awaiting admin verification."
            emptyDescription="No payments currently require review."
            href="/admin/payments"
            ctaLabel="View payments"
            isLoading={isSectionLoading(actions, isInitialLoading)}
            error={sectionError(data?.actions)}
            onNavigate={navigate}
            onRetry={() => void refresh()}
          />
          <ActionQueueCard
            icon={ShieldCheck}
            title="Pending mentor approvals"
            count={actions?.pendingMentorApprovals ?? null}
            description="Mentor applications waiting for verification."
            emptyDescription="No mentor applications are waiting for review."
            href="/admin/mentor-verification"
            ctaLabel="View mentors"
            isLoading={isSectionLoading(actions, isInitialLoading)}
            error={sectionError(data?.actions)}
            onNavigate={navigate}
            onRetry={() => void refresh()}
          />
          <ActionQueueCard
            icon={CalendarClock}
            title="Mentor-pending bookings"
            count={actions?.mentorPendingBookings ?? null}
            description="Bookings waiting for mentor confirmation and a meeting link."
            emptyDescription="No bookings are waiting on a mentor."
            href="/admin/bookings"
            ctaLabel="View bookings"
            isLoading={isSectionLoading(actions, isInitialLoading)}
            error={sectionError(data?.actions)}
            onNavigate={navigate}
            onRetry={() => void refresh()}
          />
          <ActionQueueCard
            icon={Timer}
            title="Overdue meeting links"
            count={actions?.overdueMeetingLinks ?? null}
            description={`Past the recommended ${data?.meetingLinkDeadlineMinutes ?? 5}-minute meeting-link deadline.`}
            emptyDescription="No meeting-link deadline has been missed."
            href="/admin/bookings"
            ctaLabel="View bookings"
            isLoading={isSectionLoading(actions, isInitialLoading)}
            error={sectionError(data?.actions)}
            onNavigate={navigate}
            onRetry={() => void refresh()}
          />
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* PLATFORM OVERVIEW                                                 */}
      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="overview-heading" className="space-y-3">
        <h2
          id="overview-heading"
          className="text-[12px] font-bold text-[var(--color-shell-text-subtle)]"
        >
          Platform overview
        </h2>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <MetricTile
            label="Seekers"
            icon={Users}
            value={users?.seekers ?? null}
            hint={`${users?.distinctUsers ?? 0} distinct accounts on the platform`}
            isLoading={isSectionLoading(users, isInitialLoading)}
            error={sectionError(data?.users)}
            onClick={() => navigate('/admin/users')}
          />
          <MetricTile
            label="Mentors"
            icon={ShieldCheck}
            value={mentors?.totalProfiles ?? null}
            hint={`${mentors?.activeAndApproved ?? 0} approved and active`}
            isLoading={isSectionLoading(mentors, isInitialLoading)}
            error={sectionError(data?.mentors)}
            onClick={() => navigate('/admin/mentors')}
          />
          <MetricTile
            label="Active segments"
            icon={Layers}
            value={segments?.activeCount ?? null}
            hint={
              segments
                ? segments.highestPriority
                  ? `Highest priority: ${segments.highestPriority.name}`
                  : 'No active segment is configured'
                : undefined
            }
            isLoading={isSectionLoading(segments, isInitialLoading)}
            error={sectionError(data?.segments)}
            onClick={() => navigate('/admin/segments')}
          />
          <MetricTile
            label="Upcoming sessions"
            icon={CalendarClock}
            value={bookings?.upcomingTotal ?? null}
            hint={
              bookings
                ? `${bookings.confirmed} confirmed · ${bookings.todayTotal} scheduled today`
                : undefined
            }
            isLoading={isSectionLoading(bookings, isInitialLoading)}
            error={sectionError(data?.bookings)}
            onClick={() => navigate('/admin/bookings')}
          />
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* OPERATIONS — payments & mentor verification queues                */}
      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="operations-heading" className="space-y-3">
        <h2
          id="operations-heading"
          className="text-[12px] font-bold text-[var(--color-shell-text-subtle)]"
        >
          Operations
        </h2>

        <SectionCard
          title="Booking operations"
          icon={Activity}
          subtitle="Authoritative booking state machine, counted from live rows."
        >
          {sectionError(data?.bookings) ? (
            <PanelErrorState message={sectionError(data?.bookings) as string} onRetry={() => void refresh()} />
          ) : isSectionLoading(bookings, isInitialLoading) ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {Array.from({ length: 6 }).map((_, index) => (
                <MetricSkeleton key={index} lines={2} />
              ))}
            </div>
          ) : bookings ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {(
                  [
                    ['Payment pending', bookings.paymentPending],
                    ['Verification', bookings.pendingVerification],
                    ['Mentor pending', bookings.mentorPending],
                    ['Confirmed', bookings.confirmed],
                    ['Completed', bookings.completed],
                    ['Cancelled', bookings.cancelled],
                  ] as Array<[string, number]>
                ).map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg-hover)]/50 px-3 py-2.5"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-shell-text-subtle)]">
                      {label}
                    </p>
                    <p className="mt-1 text-xl font-black leading-none tabular-nums text-[var(--color-shell-text)]">
                      {value}
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-[var(--color-shell-text-subtle)]">
                {bookings.total} booking{bookings.total === 1 ? '' : 's'} on record · {bookings.rejected} rejected ·
                today&apos;s bucket is bounded by the {data?.timezone} day.
              </p>
            </>
          ) : null}
        </SectionCard>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SectionCard
            title="Payment verification queue"
            icon={CreditCard}
            subtitle="Proof review happens on the Payments page — no proof data is loaded here."
            actionLabel="View payments"
            onAction={() => navigate('/admin/payments')}
          >
            {sectionError(data?.payments) ? (
              <PanelErrorState message={sectionError(data?.payments) as string} onRetry={() => void refresh()} />
            ) : isSectionLoading(payments, isInitialLoading) ? (
              <MetricSkeleton lines={3} />
            ) : payments ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ['Pending', payments.pending],
                      ['Verified', payments.verified],
                      ['Rejected', payments.rejected],
                    ] as Array<[string, number]>
                  ).map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg-hover)]/50 px-3 py-2.5"
                    >
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-shell-text-subtle)]">
                        {label}
                      </p>
                      <p className="mt-1 text-xl font-black leading-none tabular-nums text-[var(--color-shell-text)]">
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[11px] text-[var(--color-shell-text-subtle)]">
                  {payments.submittedToday} payment submission{payments.submittedToday === 1 ? '' : 's'} today ·{' '}
                  {payments.total} total on record.
                </p>
              </>
            ) : null}
          </SectionCard>

          <SectionCard
            title="Mentor approval queue"
            icon={ShieldCheck}
            subtitle="Counts come from the existing verification and mentor-profile records."
            actionLabel="Review mentors"
            onAction={() => navigate('/admin/mentor-verification')}
          >
            {sectionError(data?.mentors) ? (
              <PanelErrorState message={sectionError(data?.mentors) as string} onRetry={() => void refresh()} />
            ) : isSectionLoading(mentors, isInitialLoading) ? (
              <MetricSkeleton lines={3} />
            ) : mentors ? (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(
                    [
                      ['Total', mentors.totalProfiles],
                      ['Approved', mentors.approved],
                      ['In review', mentors.pendingReview + mentors.pendingApplications],
                      ['Inactive', mentors.inactive],
                    ] as Array<[string, number]>
                  ).map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg-hover)]/50 px-3 py-2.5"
                    >
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-shell-text-subtle)]">
                        {label}
                      </p>
                      <p className="mt-1 text-xl font-black leading-none tabular-nums text-[var(--color-shell-text)]">
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[11px] text-[var(--color-shell-text-subtle)]">
                  {mentors.pendingApplications} application{mentors.pendingApplications === 1 ? '' : 's'} in verification ·{' '}
                  {mentors.activeAndApproved} mentor{mentors.activeAndApproved === 1 ? '' : 's'} bookable right now.
                </p>
              </>
            ) : null}
          </SectionCard>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* BOOKING OPERATIONS — upcoming sessions, recent bookings, exceptions */}
      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="booking-ops-heading" className="space-y-3">
        <h2
          id="booking-ops-heading"
          className="text-[12px] font-bold text-[var(--color-shell-text-subtle)]"
        >
          Booking activity
        </h2>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
          <SectionCard
            title="Upcoming sessions"
            icon={CalendarClock}
            subtitle="Confirmed and mentor-pending sessions starting soon."
            actionLabel="View bookings"
            onAction={() => navigate('/admin/bookings')}
          >
            {sectionError(data?.upcomingSessions) ? (
              <PanelErrorState
                message={sectionError(data?.upcomingSessions) as string}
                onRetry={() => void refresh()}
              />
            ) : isSectionLoading(upcoming, isInitialLoading) ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-11 w-full" />
                ))}
              </div>
            ) : upcoming && upcoming.length > 0 ? (
              <ul className="divide-y divide-[var(--color-shell-border)]">
                {upcoming.map((session) => (
                  <li
                    key={session.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-[12px] font-bold text-[var(--color-shell-text)]">
                        <span className="font-mono tabular-nums text-[var(--color-shell-primary)]">
                          {session.displayTime}
                        </span>
                        {session.isToday ? (
                          <span className="rounded-full bg-[var(--color-shell-primary-soft)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--color-shell-primary)]">
                            Today
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-[var(--color-shell-text-muted)]">
                        {session.seekerName} → {session.mentorName}
                        {session.segmentName ? ` · ${session.segmentName}` : ''}
                        {session.bookingCode ? ` · ${session.bookingCode}` : ''}
                      </p>
                    </div>
                    <StatusPill status={session.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <PanelEmptyState
                title="No upcoming sessions."
                description="Nothing is confirmed or awaiting a mentor for a future start time."
                icon={CalendarClock}
              />
            )}
          </SectionCard>

          <SectionCard
            title="Recent bookings"
            icon={Activity}
            subtitle="Newest records across every state."
            actionLabel="View all"
            onAction={() => navigate('/admin/bookings')}
          >
            {sectionError(data?.recentBookings) ? (
              <PanelErrorState
                message={sectionError(data?.recentBookings) as string}
                onRetry={() => void refresh()}
              />
            ) : isSectionLoading(recentBookings, isInitialLoading) ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-10 w-full" />
                ))}
              </div>
            ) : recentBookings && recentBookings.length > 0 ? (
              <ul className="divide-y divide-[var(--color-shell-border)]">
                {recentBookings.map((booking) => (
                  <li key={booking.id} className="flex items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-semibold text-[var(--color-shell-text)]">
                        {booking.seekerName} → {booking.mentorName}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[var(--color-shell-text-subtle)]">
                        {booking.displayTime}
                        {booking.bookingCode ? ` · ${booking.bookingCode}` : ''}
                      </p>
                    </div>
                    <StatusPill status={booking.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <PanelEmptyState title="No bookings recorded yet." icon={Activity} />
            )}
          </SectionCard>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* EXCEPTION CENTRE + PLATFORM ACTIVITY + SYSTEM HEALTH              */}
      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="exceptions-heading" className="space-y-3">
        <h2
          id="exceptions-heading"
          className="text-[12px] font-bold text-[var(--color-shell-text-subtle)]"
        >
          Exceptions & activity
        </h2>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
          <SectionCard
            title="Exception centre"
            icon={AlertTriangle}
            subtitle={`Real deadline evaluation using the ${data?.meetingLinkDeadlineMinutes ?? 5}-minute meeting-link rule. Missing a deadline never cancels a booking.`}
          >
            {sectionError(data?.exceptions) ? (
              <PanelErrorState message={sectionError(data?.exceptions) as string} onRetry={() => void refresh()} />
            ) : isSectionLoading(exceptions, isInitialLoading) ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-14 w-full" />
                ))}
              </div>
            ) : exceptions && exceptions.length > 0 ? (
              <ul className="space-y-2">
                {exceptions.map((exception) => (
                  <li
                    key={exception.id}
                    className={
                      exception.severity === 'critical'
                        ? 'rounded-lg border border-[var(--status-error-border)] bg-[var(--status-error-soft)] px-3 py-2.5'
                        : exception.severity === 'warning'
                          ? 'rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-soft)] px-3 py-2.5'
                          : 'rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg-hover)]/50 px-3 py-2.5'
                    }
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="text-[12px] font-bold text-[var(--color-shell-text)]">{exception.title}</p>
                      {exception.bookingCode ? (
                        <span className="font-mono text-[10px] text-[var(--color-shell-text-subtle)]">
                          {exception.bookingCode}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-shell-text-muted)]">
                      {exception.detail}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[10px] text-[var(--color-shell-text-subtle)]">
                      {exception.startTimeUtc ? (
                        <span>
                          Session {formatDashboardTime(exception.startTimeUtc, data?.timezone)} {data?.timezone}
                        </span>
                      ) : null}
                      {exception.deadlineUtc ? (
                        <span>Deadline {formatDashboardTime(exception.deadlineUtc, data?.timezone)} {data?.timezone}</span>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate(exception.href)}
                        className="h-auto min-h-0 px-0 font-bold text-[var(--color-shell-primary)] hover:text-[var(--color-shell-primary)] underline-offset-2 hover:underline hover:bg-transparent"
                      >
                        Inspect <ArrowUpRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <PanelEmptyState
                title="No deadline data available yet."
                description="No booking is currently inside the meeting-link deadline window, and no slot hold has expired."
                icon={CheckCircle2}
              />
            )}
          </SectionCard>

          <SectionCard
            title="Recent activity"
            icon={Activity}
            subtitle="Read from the platform audit log."
          >
            {sectionError(data?.recentActivity) ? (
              <PanelErrorState message={sectionError(data?.recentActivity) as string} onRetry={() => void refresh()} />
            ) : isSectionLoading(activity, isInitialLoading) ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-9 w-full" />
                ))}
              </div>
            ) : activity && activity.length > 0 ? (
              <ul className="space-y-3">
                {activity.map((event) => (
                  <li key={event.id} className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-semibold text-[var(--color-shell-text)]">
                        {event.actorName}
                      </p>
                      <p className="truncate text-[11px] text-[var(--color-shell-text-subtle)]">
                        {humanizeAuditAction(event.action)}
                        {event.entityType ? ` · ${event.entityType.replace(/_/g, ' ')}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 text-[10px] tabular-nums text-[var(--color-shell-text-subtle)]">
                      {event.relativeAge}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <PanelEmptyState
                title="No recent administrative activity."
                description="The audit log has no entries yet."
                icon={Activity}
              />
            )}
          </SectionCard>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* SYSTEM HEALTH — only signals backed by real records                */}
      {/* ---------------------------------------------------------------- */}
      <section aria-labelledby="health-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            id="health-heading"
            className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-shell-text-subtle)]"
          >
            System health
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/admin/system-health')}
            className="h-auto min-h-0 px-0 text-[11px] font-bold text-[var(--color-shell-primary)] hover:text-[var(--color-shell-primary)] underline-offset-4 hover:underline hover:bg-transparent"
          >
            Open system health <ArrowUpRight className="h-3.5 w-3.5" />
          </Button>
        </div>

        <SectionCard
          title="Platform signals (last 24 hours)"
          icon={Activity}
          subtitle="Derived from system_logs, audit_logs and slot_holds — never a placeholder."
        >
          {sectionError(data?.systemHealth) ? (
            <PanelErrorState message={sectionError(data?.systemHealth) as string} onRetry={() => void refresh()} />
          ) : isSectionLoading(health, isInitialLoading) ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <MetricSkeleton key={index} lines={2} />
              ))}
            </div>
          ) : health ? (
            <SystemHealthGrid health={health} />
          ) : null}
        </SectionCard>
      </section>
    </div>
  );
};
