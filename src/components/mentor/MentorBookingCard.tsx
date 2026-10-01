import React from 'react';
import { cn } from '@/src/lib/utils';
import { Badge } from '@/src/components/ui/Badge';
import { Button } from '@/src/components/ui/Button';
import { motion } from 'motion/react';
import { CalendarDays, CheckCircle2, Clock, ShieldCheck, Video } from 'lucide-react';
import type { EnrichedBookingRecord } from '@/src/lib/bookingService';
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
 */
const statusLabel: Record<string, string> = {
  PAYMENT_PENDING: 'Awaiting payment',
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
  const isOverdue = booking.deadlineInfo?.isOverdue;
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

  const actionConfig = isPending
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
        'rounded-xl border bg-white p-5 shadow-xs space-y-4 transition-all',
        isPending
          ? isOverdue
            ? 'border-amber-400 bg-amber-50/20'
            : 'border-amber-200'
          : 'border-zinc-200',
        className
      )}
    >
      {/* Status / identity bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-100 pb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={statusTone[status] || 'secondary'} className="text-xs">
            {statusLabel[status] || status}
          </Badge>
          <span className="text-xs font-mono font-bold text-zinc-600">#{booking.booking_code}</span>
          <span
            className={cn(
              'inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded border',
              isPaymentVerified
                ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                : 'text-zinc-600 bg-zinc-50 border-zinc-200'
            )}
          >
            {isPaymentVerified ? <ShieldCheck className="h-3 w-3" /> : null}
            {paymentLabel}
            {isPaymentVerified ? ` · ₹${booking.amount_inr}` : ''}
          </span>
        </div>
        {isPending && (
          <div className="flex items-center gap-2">
            {isOverdue ? (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-800 bg-amber-100 px-2.5 py-1 rounded-md border border-amber-300">
                Overdue Link
              </span>
            ) : (
              <span className="text-xs font-medium text-zinc-500">
                Link deadline: {MEETING_LINK_DEADLINE_MINUTES}m before start
                {minutesLeft !== undefined && minutesLeft > 0 ? ` (~${minutesLeft}m left)` : ''}
              </span>
            )}
          </div>
        )}
        {isConfirmed && booking.meeting_url && (
          <span className="text-xs font-medium text-emerald-700 flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" />
            HTTPS Link Attached
          </span>
        )}
      </div>

      {/* Gig-first body: a mentor with multiple gigs must never have to guess
          which session a booking belongs to. */}
      <div className="space-y-2.5">
        <div className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Gig / Session
          </span>
          <h3 className="text-base font-bold leading-snug text-zinc-950">{gigTitle}</h3>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {segmentName ? (
              <span className="inline-flex items-center rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-700">
                {segmentName}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-600">
              <Clock className="h-3 w-3 text-zinc-400" />
              {durationLabel}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-full bg-zinc-100 font-bold text-zinc-800 text-xs flex items-center justify-center border border-zinc-200 shrink-0">
            {initials}
          </div>
          <div className="min-w-0">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Seeker
            </span>
            <p className="text-sm font-semibold text-zinc-950 truncate">{seekerName}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-700">
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
          <div className="text-xs text-zinc-600 font-mono break-all">
            <span className="font-sans text-zinc-400 select-none">Meeting link: </span>
            <a
              href={booking.meeting_url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-zinc-900 underline hover:text-zinc-600"
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
          {isPending ? <Video className="h-3.5 w-3.5" /> : null}
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
