import React from 'react';
import { cn } from '@/src/lib/utils';
import { ArrowRight, Calendar, Clock, User, FileText } from 'lucide-react';
import { Badge } from '@/src/components/ui/Badge';

export interface MentorBookingSummaryProps {
  bookingCode: string;
  gig: string;
  segment?: string;
  seeker: string;
  dateTime: string;
  duration: string;
  state: 'awaiting' | 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'overdue';
  stateLabel?: string;
  payment?: {
    amount: string;
    status: string;
    reference?: string;
  };
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  className?: string;
}

/**
 * Compact booking row for the mentor bookings queue. One call to action,
 * clean status, and no decorative chrome.
 */
export const MentorBookingSummary: React.FC<MentorBookingSummaryProps> = ({
  bookingCode,
  gig,
  segment,
  seeker,
  dateTime,
  duration,
  state,
  stateLabel,
  payment,
  action,
  secondaryAction,
  className,
}) => {
  const stateClass = {
    awaiting: 'mentor-status--pending',
    pending: 'mentor-status--pending',
    confirmed: 'mentor-status--confirmed',
    completed: 'mentor-status--completed',
    cancelled: 'mentor-status--cancelled',
    overdue: 'mentor-status--attention',
  }[state];

  return (
    <div
      className={cn(
        'mentor-booking-summary',
        'flex items-center gap-4',
        className
      )}
    >
      <div className="mentor-booking-summary__main">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="mentor-booking-summary__gig" title={gig}>
            {gig}
          </h3>
          {segment && (
            <span className="text-xs font-medium text-[var(--color-shell-text-muted)]">
              {segment}
            </span>
          )}
          <Badge
            className={cn('mentor-status', stateClass)}
            data-testid="booking-state"
          >
            {stateLabel || state}
          </Badge>
        </div>
        <p className="mentor-booking-summary__seeker mt-1.5">{seeker}</p>
        <div className="mentor-booking-summary__meta mt-3">
          <div className="mentor-booking-summary__row">
            <span className="mentor-booking-summary__label">Date</span>
            <span className="mentor-booking-summary__value">{dateTime}</span>
          </div>
          <div className="mentor-booking-summary__row">
            <span className="mentor-booking-summary__label">Duration</span>
            <span className="mentor-booking-summary__value">{duration}</span>
          </div>
        </div>
      </div>

      <div className="mentor-booking-summary__actions">
        <span className="mentor-booking-summary__row">
          <span className="mentor-booking-summary__label">Booking</span>
          <span className="mentor-booking-summary__value font-mono text-xs font-semibold">
            {bookingCode}
          </span>
        </span>
        {payment && (
          <span className="mentor-booking-summary__row">
            <span className="mentor-booking-summary__label">Payment</span>
            <span className="mentor-booking-summary__value">
              {payment.amount}
            </span>
          </span>
        )}
        {action && <div className="mentor-booking-summary__actions">{action}</div>}
        {secondaryAction && (
          <button className="mentor-booking-summary__actions inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)] transition-colors">
            {secondaryAction}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
};
