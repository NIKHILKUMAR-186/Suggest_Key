import React from 'react';
import { cn } from '@/src/lib/utils';
import { Button } from '@/src/components/ui/Button';
import { motion } from 'motion/react';
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  FileText,
  ShieldAlert,
  Video,
} from 'lucide-react';
import type { EnrichedBookingRecord } from '@/src/lib/bookingService';
import { formatOverdueDuration } from '@/src/lib/bookingLifecycle';

export interface MentorBookingCardProps {
  booking: EnrichedBookingRecord;
  onAction: (booking: EnrichedBookingRecord) => void;
  onSecondaryAction?: (booking: EnrichedBookingRecord) => void;
  className?: string;
}

function getDurationMinutes(booking: EnrichedBookingRecord): number | null {
  if (typeof booking.duration_minutes === 'number') return booking.duration_minutes;
  const start = new Date(booking.start_time).getTime();
  const end = new Date(booking.end_time).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.round((end - start) / 60000);
}

function isAutoCancelled(booking: EnrichedBookingRecord): boolean {
  return booking.status === 'CANCELLED' && booking.cancellation_reason === 'MENTOR_MEETING_LINK_DEADLINE_MISSED';
}

export const MentorBookingCard: React.FC<MentorBookingCardProps> = ({
  booking,
  onAction,
  onSecondaryAction,
  className,
}) => {
  const status = booking.status;
  const lifecycle = booking.lifecycle;
  const isOverdue = lifecycle?.bucket === 'OVERDUE';
  const isPending = status === 'MENTOR_PENDING';
  const isConfirmed = status === 'CONFIRMED';
  const isCompleted = status === 'COMPLETED';
  const isCancelled = status === 'CANCELLED';
  const autoCancelled = isAutoCancelled(booking);

  const seekerName = booking.seeker?.full_name || 'Seeker';
  const gigTitle = booking.gig?.title || 'Gig no longer listed';
  const segmentName = booking.segment?.name || null;
  const timezone = booking.mentor_timezone || 'Asia/Kolkata';
  const durationMinutes = getDurationMinutes(booking);
  const durationLabel = durationMinutes ? `${durationMinutes} min` : '1 hr';
  const overdueBy = isOverdue
    ? formatOverdueDuration(lifecycle?.overdueByMs ?? 0)
    : undefined;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={cn(
        'rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-5 shadow-xs',
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
              isOverdue
                ? 'bg-[var(--color-shell-warning-soft)] text-[var(--color-shell-warning)]'
                : isCompleted
                  ? 'bg-[var(--color-shell-success-soft)] text-[var(--color-shell-success)]'
                  : isCancelled
                    ? 'bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-text-muted)]'
                    : 'bg-[var(--color-shell-primary-soft)] text-[var(--color-shell-primary)]'
            )}
          >
{autoCancelled ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAction(booking)}
            className="gap-1.5 text-xs font-semibold"
            // label: 'Review Booking'
          >
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
            Review Booking
          </Button>
        ) : isOverdue ? (
              <ShieldAlert className="h-5 w-5" aria-hidden="true" />
            ) : isCompleted ? (
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            ) : isCancelled ? (
              <Clock className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Video className="h-5 w-5" aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold leading-snug text-[var(--color-shell-text)]">
                {gigTitle}
              </h3>
              {segmentName && (
                <span className="text-xs font-medium text-[var(--color-shell-text-muted)]">
                  {segmentName}
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--color-shell-text-muted)]">{seekerName}</p>
          </div>
        </div>

        <div
          className={cn(
            'mentor-status',
            autoCancelled && 'mentor-status--auto-cancelled',
            isOverdue && 'mentor-status--attention',
            isCompleted && 'mentor-status--completed',
            isCancelled && 'mentor-status--cancelled',
            isPending && 'mentor-status--pending',
            isConfirmed && 'mentor-status--confirmed'
          )}
          data-testid="booking-state"
        >
          {autoCancelled
            ? 'Auto-cancelled (meeting link deadline missed)'
            : isOverdue
            ? 'Overdue'
            : isCompleted
            ? 'Completed'
            : isCancelled
            ? 'Cancelled'
            : status === 'MENTOR_PENDING'
            ? 'Awaiting confirmation'
            : status === 'CONFIRMED'
            ? 'Confirmed'
            : status}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[var(--color-shell-text-muted)]">
        <span className="flex items-center gap-1.5 font-medium text-[var(--color-shell-text)]">
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
          {new Date(booking.start_time).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </span>
        <span className="flex items-center gap-1.5 font-medium text-[var(--color-shell-text)]">
          <Clock className="h-4 w-4" aria-hidden="true" />
          {new Date(booking.start_time).toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
          })}
          <span className="font-mono text-xs">({timezone})</span>
        </span>
        <span className="flex items-center gap-1.5">
          <Clock className="h-4 w-4" aria-hidden="true" />
          {durationLabel}
        </span>
      </div>

      {autoCancelled && (
        <p className="mt-3 text-xs font-medium text-[var(--color-shell-warning)]">
          <ShieldAlert className="h-3.5 w-3.5 inline mr-1.5" aria-hidden="true" />
          Meeting link deadline missed. This booking was automatically cancelled. A refund is being processed.
        </p>
      )}

      {overdueBy && (
        <p className="mt-3 text-xs font-medium text-[var(--color-shell-warning)]">
          <ShieldAlert className="h-3.5 w-3.5 inline mr-1.5" aria-hidden="true" />
          Overdue by {overdueBy}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3 shrink-0">
        {isOverdue ? (
          <Button
            size="sm"
            onClick={() => onAction(booking)}
            className="gap-1.5 text-xs font-semibold"
          >
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
            Review booking
          </Button>
        ) : isPending ? (
            <Button
              size="sm"
              onClick={() => onAction(booking)}
              className="gap-1.5 text-xs font-semibold"
            >
              <Video className="h-3.5 w-3.5" aria-hidden="true" />
              Add Meeting Link & Confirm
            </Button>
        ) : isConfirmed ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAction(booking)}
            className="text-xs font-semibold"
          >
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            Open workspace
          </Button>
        ) : isCompleted ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAction(booking)}
            className="text-xs font-semibold"
          >
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            View workspace
          </Button>
        ) : null}
        {onSecondaryAction && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onSecondaryAction(booking)}
            className="text-xs font-semibold"
          >
            Details
          </Button>
        )}
      </div>
    </motion.div>
  );
};
