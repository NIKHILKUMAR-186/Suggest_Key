import React from 'react';
import { CalendarDays, Clock, Globe, Receipt, Timer } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { getInitials } from '@/src/lib/avatar';
import { formatInr } from '@/src/lib/seekerFormat';
import { formatClockTime, formatSessionDate, formatZoneLabel } from '@/src/lib/sessionState';
import { DetailItem, DetailList, TotalRow } from '@/src/components/booking/StatePanel';
import type { EnrichedBookingRecord } from '@/src/lib/bookingService';

export interface BookingSummaryProps {
  booking: EnrichedBookingRecord;
  /** Hides the mentor block where the page already shows mentor detail. */
  showMentor?: boolean;
  className?: string;
  /** Overrides the derived duration, e.g. from the seeker's own timezone. */
  durationMinutes?: number | null;
}

/**
 * The single rendering of "what you booked and what it costs".
 *
 * Payment and booking-detail screens both need this, and when they each built
 * their own they inevitably drifted — different durations, different timezones,
 * different amounts. Every field here is read from the booking record the
 * server returned; nothing is inferred or filled in.
 *
 * `formatInr` returns an empty string for a missing or non-positive amount, and
 * that empty string is rendered as an explicit "—" rather than a fabricated 0.
 */
export const BookingSummary: React.FC<BookingSummaryProps> = ({
  booking,
  showMentor = true,
  className,
  durationMinutes,
}) => {
  const amount = formatInr(booking.amount_inr ?? booking.gig?.price_inr) || '—';
  const duration =
    durationMinutes ?? booking.duration_minutes ?? booking.gig?.duration_minutes ?? null;
  const durationLabel = duration ? `${duration} minutes` : '—';

  // The mentor's timezone is authoritative for the slot; the seeker's is used as
  // a secondary reading so neither party is confused by a mismatched clock.
  const mentorZone = booking.mentor_timezone;
  const seekerZone = booking.seeker_timezone;
  const zonesDiffer = Boolean(mentorZone && seekerZone && mentorZone !== seekerZone);

  // The zone every time on this card is rendered in. Formatting these with the
  // browser's own zone instead would show a seeker abroad from the mentor a
  // different calendar day than the slot actually falls on, which directly
  // contradicts the timezone note printed underneath.
  const displayZone = mentorZone || seekerZone || null;

  return (
    <div className={cn('space-y-5', className)}>
      {showMentor && (
        <div className="flex items-center gap-3.5">
          {booking.mentor?.avatar_url ? (
            <img
              src={booking.mentor.avatar_url}
              alt={`${booking.mentor.full_name} profile photo`}
              className="h-12 w-12 shrink-0 rounded-full border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] object-cover"
            />
          ) : (
            <div
              role="img"
              aria-label={`${booking.mentor?.full_name || 'Mentor'} profile photo placeholder`}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] text-sm font-bold text-[var(--color-shell-text-muted)]"
            >
              {getInitials(booking.mentor?.full_name || 'Mentor')}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-shell-text-subtle)]">
              Your mentor
            </p>
            <p className="mt-0.5 truncate text-[15px] font-bold text-[var(--color-shell-text)]">
              {booking.mentor?.full_name || 'Mentor'}
            </p>
            {booking.segment?.name && (
              <p className="mt-0.5 truncate text-[12px] text-[var(--color-shell-text-muted)]">
                {booking.segment.name}
              </p>
            )}
          </div>
        </div>
      )}

      {booking.gig?.title && (
        <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-shell-text-subtle)]">
            Session type
          </p>
          <p className="mt-1 text-[14px] font-semibold leading-snug text-[var(--color-shell-text)]">
            {booking.gig.title}
          </p>
        </div>
      )}

      <DetailList columns={2}>
        <DetailItem label="Date" icon={CalendarDays}>
          {formatSessionDate(booking.start_time, displayZone)}
        </DetailItem>
        <DetailItem label="Time" icon={Clock}>
          <span className="whitespace-nowrap">
            {formatClockTime(booking.start_time, displayZone)} –{' '}
            {formatClockTime(booking.end_time, displayZone)}
          </span>
        </DetailItem>
        <DetailItem label="Duration" icon={Timer}>
          {durationLabel}
        </DetailItem>
        <DetailItem label="Booking reference" icon={Receipt} mono>
          {booking.booking_code}
        </DetailItem>
      </DetailList>

      {(mentorZone || zonesDiffer) && (
        <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-[var(--color-shell-text-subtle)]">
          <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Times are shown in the mentor&rsquo;s timezone
            {mentorZone ? ` (${mentorZone}${formatZoneLabel(mentorZone) ? `, ${formatZoneLabel(mentorZone)}` : ''})` : ''}
            {zonesDiffer && seekerZone
              ? `, which differs from your own (${formatZoneLabel(seekerZone) || seekerZone}).`
              : '.'}
          </span>
        </p>
      )}

      <TotalRow label="Amount due" value={amount} />
    </div>
  );
};

export interface AmountDueProps {
  amountInr: number | null | undefined;
  fallbackPriceInr?: number | null;
  className?: string;
}

/**
 * The amount, in one place, with the fallback order the rest of the app uses:
 * the booking's own charged amount first, then the gig's listed price.
 */
export const AmountDue: React.FC<AmountDueProps> = ({ amountInr, fallbackPriceInr, className }) => (
  <span className={cn('tabular-nums', className)}>{formatInr(amountInr ?? fallbackPriceInr) || '—'}</span>
);
