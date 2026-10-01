import React from 'react';
import { cn } from '@/src/lib/utils';
import { Badge } from '@/src/components/ui/Badge';
import { Button } from '@/src/components/ui/Button';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  ShieldCheck,
  Video,
} from 'lucide-react';
import type { EnrichedBookingRecord } from '@/src/lib/bookingService';
import { formatOverdueDuration } from '@/src/lib/bookingLifecycle';
import { MEETING_LINK_DEADLINE_MINUTES } from '@/src/config/app';

export interface MentorBookingCardProps {
  booking: EnrichedBookingRecord;
  onAction: (booking: EnrichedBookingRecord) => void;
  onSecondaryAction?: (booking: EnrichedBookingRecord) => void;
  className?: string;
}

const statusTone: Record<string, 'success' | 'warning' | 'secondary' | 'destructive'> = {
  MENTOR_PENDING: 'warning',
  CONFIRMED: 'success',
  COMPLETED: 'secondary',
  CANCELLED: 'destructive',
  REJECTED: 'destructive',
};

/**
 * Plain-language labels for the existing booking statuses. The underlying
 * status model is unchanged; only the wording on the card is.
 *
 * `MENTOR_PENDING` deliberately does NOT read "Awaiting your confirmation" in
 * the overdue card: an overdue booking is not awaiting a routine confirmation,
 * and the copy below the badge is what explains why.
 */
const statusLabel: Record<string, string> = {
  PAYMENT_PENDING: 'Awaiting payment',
  PAYMENT_PROCESSING: 'Payment in progress',
  PENDING_VERIFICATION: 'Payment under review',
  MENTOR_PENDING: 'Awaiting your confirmation',
  CONFIRMED: 'Confirmed',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected',
};

export const MentorBookingCard: React.FC<MentorBookingCardProps> = ({
  booking,
  onAction,
  onSecondaryAction,
  className,
}) => {
  const status = booking.status;
  const isPending = status === 'MENTOR_PENDING';
  const isConfirmed = status === 'CONFIRMED';
  const isCompleted = status === 'COMPLETED';

  // The server's verdict, not a local computation. A booking whose bucket the
  // server could not resolve is treated as NOT overdue rather than being
  // guessed at; the page itself refuses to render such a row at all.
  const lifecycle = booking.lifecycle;
  const isOverdue = lifecycle?.bucket === 'OVERDUE';
  const minutesLeft = booking.deadlineInfo?.minutesUntilSession;

  const seekerName = booking.seeker?.full_name || 'Seeker';
  const initials = seekerName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

  const timezone = booking.mentor_timezone || 'Asia/Kolkata';

  // The gig the seeker actually picked, joined through `bookings.gig_id`.
  // A mentor with several gigs therefore never sees an ambiguous card.
  const gigTitle = booking.gig?.title || 'Gig no longer listed';
  const segmentName = booking.segment?.name || null;

  // Duration is read off the booking window itself, so a later gig edit cannot
  // rewrite what was actually booked.
  const durationMinutes = (() => {
    if (typeof booking.duration_minutes === 'number') return booking.duration_minutes;
    const start = new Date(booking.start_time).getTime();
    const end = new Date(booking.end_time).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    return Math.round((end - start) / 60000);
  })();
  const durationLabel = durationMinutes ? `${durationMinutes} minutes` : 'Not recorded';

  // The payment row exists as soon as a proof is submitted, so only a VERIFIED
  // row is ever described as verified.
  const paymentStatus = booking.payment?.status ?? null;
  const isPaymentVerified = paymentStatus === 'VERIFIED';
  const paymentLabel = isPaymentVerified
    ? 'Payment verified'
    : paymentStatus === 'REJECTED'
      ? 'Payment rejected'
      : paymentStatus
        ? 'Payment under review'
        : 'No payment recorded';

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: timezone,
    });

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone,
    });

  const formatDateTime = (iso: string | null | undefined) =>
    iso
      ? `${new Date(iso).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          timeZone: timezone,
        })}, ${new Date(iso).toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
          timeZone: timezone,
        })}`
      : 'Not recorded';

  /**
   * How long the booking has been overdue, as MEASURED BY THE SERVER.
   *
   * This is deliberately the server's `overdueByMs` and nothing derived from
   * the local clock: adding a local delta would let a rewound browser report
   * "less than a minute" on a booking that has been overdue for an hour. The
   * value advances because the sync hook refetches and the server re-measures,
   * not because a timer on this device counted.
   */
  const overdueLabel = formatOverdueDuration(lifecycle?.overdueByMs ?? 0);

  /**
   * The overdue action is "Review Booking", not "Add Meeting Link & Confirm".
   *
   * The existing server rule still accepts a late link - `MENTOR_PENDING` has
   * no timer - so the capability is not gone, but the one-tap path is: past the
   * deadline a mentor may reasonably want to add the link, reschedule, or cancel
   * and refund, and silently confirming on their behalf would pick one of those
   * for them. The detail page is where the decision belongs.
   */
  const actionConfig = isOverdue
    ? { label: 'Review Booking', variant: 'default' as const }
    : isPending
      ? { label: 'Add Meeting Link & Confirm', variant: 'default' as const }
      : isConfirmed
        ? { label: 'View Booking', variant: 'outline' as const }
        : isCompleted
          ? { label: 'Open Workspace', variant: 'outline' as const }
          : { label: 'View Details', variant: 'outline' as const };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'rounded-xl border p-5 shadow-xs space-y-4 transition-all',
        'bg-white dark:bg-[var(--color-shell-surface)]',
        isOverdue
          ? 'border-[var(--color-shell-warning)] bg-[var(--color-shell-warning-soft)]/30'
          : isPending
            ? 'border-[var(--color-shell-warning)]/40 dark:border-[var(--color-shell-border)]'
            : 'border-zinc-200 dark:border-[var(--color-shell-border)]',
        className
      )}
    >
      {/* Status / identity bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--color-shell-border)] pb-3">
        <div className="flex items-center gap-2 flex-wrap">
          {isOverdue ? (
            <Badge variant="warning" className="text-xs">
              Overdue
            </Badge>
          ) : (
            <Badge variant={statusTone[status] || 'secondary'} className="text-xs">
              {statusLabel[status] || status}
            </Badge>
          )}
          <span className="text-xs font-mono font-bold text-zinc-600 dark:text-[var(--color-shell-text-muted)]">
            #{booking.booking_code}
          </span>
          <span
            className={cn(
              'inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded border',
              isPaymentVerified
                ? 'text-[var(--color-shell-success)] bg-[var(--color-shell-success-soft)] border-[var(--color-shell-success)]/35'
                : 'text-zinc-600 bg-zinc-50 border-zinc-200 dark:text-[var(--color-shell-text-muted)] dark:bg-[var(--color-shell-bg-hover)] dark:border-[var(--color-shell-border)]'
            )}
          >
            {isPaymentVerified ? <ShieldCheck className="h-3 w-3" /> : null}
            {paymentLabel}
            {isPaymentVerified ? ` · ₹${booking.amount_inr}` : ''}
          </span>
        </div>
        {isOverdue ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-shell-warning)]">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            Meeting link deadline missed
          </span>
        ) : isPending ? (
          <span className="text-xs font-medium text-zinc-500 dark:text-[var(--color-shell-text-muted)]">
            Link deadline: {MEETING_LINK_DEADLINE_MINUTES}m before start
            {minutesLeft !== undefined && minutesLeft > 0 ? ` (~${minutesLeft}m left)` : ''}
          </span>
        ) : null}
        {isConfirmed && booking.meeting_url && (
          <span className="text-xs font-medium text-emerald-700 flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" />
            HTTPS Link Attached
          </span>
        )}
      </div>

      {/* Overdue detail. Scheduled time, the deadline that was missed, and the
          server-measured delay - the three facts a mentor needs to decide. */}
      {isOverdue && (
        <div className="rounded-lg border border-[var(--color-shell-warning)]/40 bg-[var(--color-shell-surface)] p-3 space-y-2">
          <p className="text-xs font-semibold text-[var(--color-shell-text)]">
            This session has no meeting link and its deadline has passed.
          </p>
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1 text-[11px]">
            <div>
              <dt className="text-[var(--color-shell-text-muted)] font-medium">Scheduled</dt>
              <dd className="text-[var(--color-shell-text)] font-semibold">
                {formatDate(booking.start_time)}, {formatTime(booking.start_time)}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--color-shell-text-muted)] font-medium">Deadline</dt>
              <dd className="text-[var(--color-shell-text)] font-semibold">
                {formatDateTime(lifecycle?.meetingLinkDeadlineUtc)}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--color-shell-text-muted)] font-medium">Overdue by</dt>
              <dd className="text-[var(--color-shell-warning)] font-bold">{overdueLabel}</dd>
            </div>
          </dl>
          <p className="text-[11px] text-[var(--color-shell-text-muted)]">
            {lifecycle?.sessionStarted
              ? 'The session start time has already passed, so adding a link now will not reach the seeker in time.'
              : 'The seeker is still waiting and has not been notified of any cancellation.'}{' '}
            This booking has not been cancelled and nothing has been refunded.
          </p>
        </div>
      )}

      {/* Gig-first body: a mentor with multiple gigs must never have to guess
          which session a booking belongs to. */}
      <div className="space-y-2.5">
        <div className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Gig / Session
          </span>
          <h3 className="text-base font-bold leading-snug text-zinc-950 dark:text-[var(--color-shell-text)]">
            {gigTitle}
          </h3>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {segmentName ? (
              <span className="inline-flex items-center rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:border-[var(--color-shell-border)] dark:bg-[var(--color-shell-bg-hover)] dark:text-[var(--color-shell-text-muted)]">
                {segmentName}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-600 dark:text-[var(--color-shell-text-muted)]">
              <Clock className="h-3 w-3 text-zinc-400" />
              {durationLabel}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-full bg-zinc-100 font-bold text-zinc-800 text-xs flex items-center justify-center border border-zinc-200 shrink-0 dark:bg-[var(--color-shell-bg-hover)] dark:text-[var(--color-shell-text)] dark:border-[var(--color-shell-border)]">
            {initials}
          </div>
          <div className="min-w-0">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Seeker
            </span>
            <p className="text-sm font-semibold text-zinc-950 truncate dark:text-[var(--color-shell-text)]">
              {seekerName}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-700 dark:text-[var(--color-shell-text-muted)]">
          <span className="flex items-center gap-1.5 font-medium">
            <CalendarDays className="h-3.5 w-3.5 text-zinc-400" />
            {formatDate(booking.start_time)}
          </span>
          <span className="flex items-center gap-1.5 font-medium">
            <Clock className="h-3.5 w-3.5 text-zinc-400" />
            {formatTime(booking.start_time)} – {formatTime(booking.end_time)} ({timezone})
          </span>
        </div>

        {booking.meeting_url && (
          <div className="text-xs text-zinc-600 font-mono break-all dark:text-[var(--color-shell-text-muted)]">
            <span className="font-sans text-zinc-400 select-none">Meeting link: </span>
            <a
              href={booking.meeting_url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-zinc-900 underline hover:text-zinc-600 dark:text-[var(--color-shell-text)]"
            >
              {booking.meeting_url}
            </a>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          variant={actionConfig.variant}
          onClick={() => onAction(booking)}
          className="text-xs gap-1.5"
        >
          {isOverdue ? (
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          ) : isPending ? (
            <Video className="h-3.5 w-3.5" />
          ) : null}
          {actionConfig.label}
        </Button>
        {onSecondaryAction && (isConfirmed || isCompleted) && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onSecondaryAction(booking)}
            className="text-xs"
          >
            Details
          </Button>
        )}
      </div>
    </motion.div>
  );
};