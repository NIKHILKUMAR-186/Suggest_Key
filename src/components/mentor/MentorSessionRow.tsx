import React from 'react';
import { useNavigation } from '@/src/context/NavigationContext';
import { cn } from '@/src/lib/utils';
import { Clock } from 'lucide-react';
import type { EnrichedBookingRecord } from '@/src/lib/bookingService';

export interface MentorSessionRowProps {
  booking: EnrichedBookingRecord;
  onClick?: () => void;
  className?: string;
}

const statusConfig: Record<string, { label: string; colorClass: string }> = {
  MENTOR_PENDING: { label: 'Needs action', colorClass: 'text-[var(--color-shell-warning)] bg-[var(--color-shell-warning-soft)] border-[var(--color-shell-warning)]/30' },
  CONFIRMED: { label: 'Confirmed', colorClass: 'text-[var(--color-shell-success)] bg-[var(--color-shell-success-soft)] border-[var(--color-shell-success)]/30' },
  COMPLETED: { label: 'Completed', colorClass: 'text-[var(--color-shell-info)] bg-[var(--color-shell-info-soft)] border-[var(--color-shell-info)]/30' },
  CANCELLED: { label: 'Canceled', colorClass: 'text-[var(--color-shell-error)] bg-[var(--color-shell-error-soft)] border-[var(--color-shell-error)]/30' },
  REJECTED: { label: 'Canceled', colorClass: 'text-[var(--color-shell-error)] bg-[var(--color-shell-error-soft)] border-[var(--color-shell-error)]/30' },
};

export const MentorSessionRow: React.FC<MentorSessionRowProps> = ({
  booking,
  onClick,
  className,
}) => {
  const { navigate } = useNavigation();
  const cfg = statusConfig[booking.status] ?? { label: booking.status, colorClass: 'text-[var(--color-shell-text-muted)] bg-[var(--color-shell-bg-hover)] border-[var(--color-shell-border)]' };

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      navigate(`/mentor/bookings/${booking.id}`);
    }
  };

  const seekerName = booking.seeker?.full_name || 'Seeker';
  const gigTitle = booking.gig?.title || booking.segment?.name || 'Session';
  const tz = booking.mentor_timezone || 'UTC';

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'w-full text-left',
        'border-b border-[var(--mw-row-border)]',
        'bg-[var(--mw-row-bg)]',
        'transition-colors duration-150',
        'hover:bg-[var(--mw-row-bg-hover)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] focus-visible:ring-offset-2',
        className
      )}
    >
      <div className="flex items-center gap-4 px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--mw-text)] leading-tight">
                {seekerName}
              </p>
              <p className="mt-0.5 text-sm text-[var(--mw-text-secondary)]">
                {gigTitle}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold',
                  cfg.colorClass
                )}
              >
                {cfg.label}
              </span>
            </div>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--mw-text-tertiary)]">
            <span className="inline-flex items-center gap-1">
              {new Date(booking.start_time).toLocaleDateString('en-IN', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3 text-[var(--mw-text-tertiary)]" />
              {new Date(booking.start_time).toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
                timeZone: tz,
              })} – {new Date(booking.end_time).toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
                timeZone: tz,
              })}
            </span>
            {booking.meeting_url && booking.status === 'CONFIRMED' && (
              <span className="inline-flex items-center gap-1">
                Meeting link ready
              </span>
            )}
          </div>
        </div>
        <div className="ml-2 flex shrink-0 items-center justify-center">
          <ChevronRightIcon className="h-5 w-5 text-[var(--mw-text-tertiary)]" />
        </div>
      </div>
    </button>
  );
};

const ChevronRightIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);
