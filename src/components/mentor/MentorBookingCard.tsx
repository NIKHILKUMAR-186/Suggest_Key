import React from 'react';
import { cn } from '@/src/lib/utils';
import { Badge } from '@/src/components/ui/Badge';
import { Button } from '@/src/components/ui/Button';
import { motion } from 'motion/react';
import type { EnrichedBookingRecord } from '@/src/lib/bookingService';

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
  const hoursLeft = booking.deadlineInfo?.hoursUntilSession;
  const seekerName = booking.seeker?.full_name || 'Seeker';
  const initials = seekerName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

  const formatSessionTime = (startTimeIso: string, endTimeIso: string, timezone: string = 'Asia/Kolkata') => {
    try {
      const start = new Date(startTimeIso);
      const end = new Date(endTimeIso);
      const dateStr = start.toLocaleDateString('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: timezone,
      });
      const timeStart = start.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: timezone,
      });
      const timeEnd = end.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: timezone,
      });
      return `${dateStr} · ${timeStart} – ${timeEnd}`;
    } catch {
      return `${startTimeIso} – ${endTimeIso}`;
    }
  };

  const actionConfig = isPending
    ? { label: 'Add Link & Confirm', variant: 'default' as const }
    : isConfirmed
      ? { label: 'View Session', variant: 'outline' as const }
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-100 pb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={statusTone[status] || 'secondary'} className="text-xs">
            {status}
          </Badge>
          <span className="text-xs font-mono font-bold text-zinc-600">#{booking.booking_code}</span>
          {booking.payment && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
              Payment Verified · ₹{booking.amount_inr}
            </span>
          )}
        </div>
        {isPending && (
          <div className="flex items-center gap-2">
            {isOverdue ? (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-800 bg-amber-100 px-2.5 py-1 rounded-md border border-amber-300">
                Overdue Link
              </span>
            ) : (
              <span className="text-xs font-medium text-zinc-500">
                Link deadline: 2h before start
                {hoursLeft !== undefined && hoursLeft > 0 ? ` (~${hoursLeft}h left)` : ''}
              </span>
            )}
          </div>
        )}
        {isConfirmed && booking.meeting_url && (
          <span className="text-xs font-medium text-emerald-700 flex items-center gap-1">
            HTTPS Link Attached
          </span>
        )}
      </div>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-full bg-zinc-100 font-bold text-zinc-800 text-xs flex items-center justify-center border border-zinc-200 shrink-0">
              {initials}
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-950">{seekerName}</h3>
              <p className="text-xs text-zinc-500">
                {booking.segment?.name || 'Segment'} · {booking.gig?.title || 'Session'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-700 pt-1">
            <span className="flex items-center gap-1 font-medium">
              {formatSessionTime(booking.start_time, booking.end_time, booking.mentor_timezone)}
            </span>
          </div>
          {booking.meeting_url && (
            <div className="text-xs text-zinc-600 pt-1 font-mono break-all">
              <span className="text-zinc-400 select-none">Link: </span>
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
      </div>
    </motion.div>
  );
};