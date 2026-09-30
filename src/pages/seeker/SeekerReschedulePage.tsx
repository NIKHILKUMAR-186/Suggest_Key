import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarClock, Check } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { PageHeading } from '@/src/components/booking/PageHeading';
import { InlineNotice, SectionCard } from '@/src/components/booking/StatePanel';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { DateSelector } from '@/src/components/seeker/DateSelector';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import { useToast } from '@/src/context/ToastContext';
import {
  fetchBookingDetail,
  requestReschedule,
  type EnrichedBookingRecord,
} from '@/src/lib/bookingService';
import { fetchMentorSlots } from '@/src/lib/discoveryService';
import {
  buildQuickDates,
  formatLocalTimeLabel,
  getDateStringInTimezone,
} from '@/src/lib/slotEngine';
import { toUserMessage } from '@/src/lib/errorMessages';
import type { GeneratedSlot } from '@/src/types/database';
import { cn } from '@/src/lib/utils';

const SLOT_STATUS_COPY: Record<GeneratedSlot['status'], string> = {
  AVAILABLE: 'Available',
  PAST: 'Past',
  BOOKED: 'Booked',
  HELD: 'On hold',
  CLOSING_SOON: 'Closing soon',
};

/**
 * Headline for each refusal the server can return.
 *
 * The old page put every one of these under "That time was not available",
 * which is simply untrue for a closed change window, a booking that has reached
 * a final state, or a request the mentor has not answered yet. The body is
 * always the server's own message; only the framing is chosen here.
 */
const RESCHEDULE_ERROR_TITLES: Record<string, string> = {
  SLOT_ALREADY_BOOKED: 'That time was taken',
  SLOT_HELD_BY_OTHER: 'That time is on hold',
  OUTSIDE_AVAILABILITY: 'That time is outside your mentor’s hours',
  OUTSIDE_EXCEPTION_HOURS: 'That time is outside this date’s hours',
  DATE_EXCEPTION_UNAVAILABLE: 'Your mentor is unavailable that day',
  BOOKING_CUTOFF_REACHED: 'That time is too close',
  PAST_SLOT_FORBIDDEN: 'That time has passed',
  DURATION_MISMATCH: 'That time is the wrong length',
  RESCHEDULE_WINDOW_CLOSED: 'The change window has closed',
  BOOKING_NOT_RESCHEDULABLE: 'This booking can no longer be rescheduled',
  RESCHEDULE_REQUEST_PENDING: 'A request is already awaiting your mentor',
  FORBIDDEN_NOT_BOOKING_OWNER: 'You cannot reschedule this booking',
  BOOKING_NOT_FOUND: 'Booking not found',
};

/** `30 Sep, 2:00 PM – 3:00 PM`, in the mentor's own timezone. */
function formatSessionWindow(startIso: string, endIso: string, timeZone: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone,
    });
  return `${fmt(startIso)} – ${fmt(endIso).split(', ').pop()}`;
}

/**
 * Requesting a new time for an existing booking.
 *
 * This page is a REQUEST form, not an edit form. Submitting it does not move the
 * booking: it asks the mentor to move it, and the booking keeps its current time
 * until the mentor accepts. That is why the submit button reads "Send Reschedule
 * Request" and the success message is "Reschedule request sent to mentor" -
 * wording that implies the change already happened would be a lie the server
 * does not back up.
 *
 * There is no gig or segment picker, and there cannot be: a reschedule changes
 * TIME only. The booking's mentor, gig and segment are fixed, so the slots
 * offered here are generated from that booking's own gig - which is what fixes
 * the duration - while the conflicts are still resolved against the MENTOR'S
 * GLOBAL TIMELINE. A Relationship booking at 5 PM blocks 5 PM here, and a free
 * 5 PM is requestable.
 *
 * Every rule that matters is enforced server-side by
 * `POST /api/seeker/bookings/:id/reschedule` (via the
 * `create_reschedule_request` RPC): ownership, the reschedulable statuses, the
 * lead-time window on the original slot, the booking cutoff, duration, the
 * mentor's live availability, conflicts, and the hold that reserves the
 * requested slot. This page does no eligibility arithmetic of its own.
 */
export const SeekerReschedulePage: React.FC = () => {
  const { navigate, currentPath } = useNavigation();
  const { profile } = useAuth();
  const toast = useToast();

  const bookingId = useMemo(
    () => new URLSearchParams(currentPath.includes('?') ? currentPath.split('?')[1] : '').get('bookingId') || '',
    [currentPath]
  );
  const userTimezone = profile?.timezone || 'UTC';

  const [booking, setBooking] = useState<EnrichedBookingRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedDate, setSelectedDate] = useState<string>(() =>
    getDateStringInTimezone(new Date(), userTimezone)
  );
  const [slots, setSlots] = useState<GeneratedSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<GeneratedSlot | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [rescheduleError, setRescheduleError] = useState<{ title: string; message: string } | null>(null);

  const today = getDateStringInTimezone(new Date(), userTimezone);
  const quickDates = useMemo(() => buildQuickDates(today, 6), [today]);

  // While a request is open, another one would be refused by the server. Saying
  // so here is a courtesy, not a control: the server is still the authority.
  const pendingRequest = booking?.rescheduleRequest?.status === 'PENDING' ? booking.rescheduleRequest : null;

  const backToBooking = useCallback(
    () => navigate(bookingId ? `/seeker/booking-detail?bookingId=${bookingId}` : '/seeker/bookings'),
    [navigate, bookingId]
  );

  const loadBooking = useCallback(async () => {
    if (!bookingId) {
      setLoading(false);
      setLoadError('No booking reference provided.');
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      setBooking(await fetchBookingDetail(bookingId));
    } catch (err: any) {
      setLoadError(toUserMessage(err, 'Failed to load booking details.'));
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  useEffect(() => {
    loadBooking();
  }, [loadBooking]);

  const loadSlots = useCallback(async () => {
    if (!booking) return;
    setSlotsLoading(true);
    setSlotsError(null);
    try {
      // `gigId`/`segmentId` pin the grid to THIS booking's offer, so the
      // duration the slots are cut to is the duration the session actually has.
      // Only the gig lookup is narrowed; conflicts are still resolved against
      // every booking and hold the mentor has, on every gig they hold.
      const { data, error } = await fetchMentorSlots(
        { mentorId: booking.mentor_id, segmentId: booking.segment_id, gigId: booking.gig_id },
        selectedDate
      );
      if (error) throw error;
      setSlots(data?.byMentorId.get(booking.mentor_id)?.slots || []);
    } catch (err: any) {
      setSlots([]);
      setSlotsError(toUserMessage(err, 'Unable to load availability.'));
    } finally {
      setSlotsLoading(false);
    }
  }, [booking, selectedDate]);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  // A slot selected on a previous date is never a slot on this one.
  useEffect(() => {
    setSelectedSlot(null);
    setRescheduleError(null);
  }, [selectedDate]);

  const handleSendRequest = async () => {
    if (!booking || !selectedSlot || submitting) return;
    setSubmitting(true);
    setRescheduleError(null);
    try {
      const result = await requestReschedule(
        booking.id,
        selectedSlot.utc_start_time,
        selectedSlot.utc_end_time
      );

      if (!result.success) {
        // The server owns every rule here, so its message is the honest one to
        // show. The heading is picked from the code because "that time was not
        // available" was the wrong story for a closed window, a booking that
        // can no longer move, or a request already awaiting an answer.
        const code = result.error?.code || 'RESCHEDULE_REQUEST_FAILED';
        setRescheduleError({
          title: RESCHEDULE_ERROR_TITLES[code] || 'We could not send that request',
          message: result.error?.message || 'We could not send that request.',
        });
        await loadSlots();
        return;
      }

      setSent(true);
      toast.success('Reschedule request sent to mentor.', { title: 'Request sent' });
    } catch (err: any) {
      setRescheduleError({
        title: 'We could not send that request',
        message: toUserMessage(err, 'We could not send that request.'),
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <PageHeading title="Request a new time" back={{ label: 'Back to booking', onClick: backToBooking }} />
        <SectionCard aria-label="Loading booking">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="mt-4 h-24 w-full" />
        </SectionCard>
      </div>
    );
  }

  if (loadError || !booking) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <PageHeading title="Request a new time" back={{ label: 'Back to bookings', onClick: () => navigate('/seeker/bookings') }} />
        <ErrorState title="Booking unavailable" message={loadError || 'Booking not found.'} onRetry={loadBooking} />
      </div>
    );
  }

  if (sent || pendingRequest) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <PageHeading
          eyebrow={`Booking ${booking.booking_code}`}
          title="Reschedule request sent to mentor"
          back={{ label: 'Back to booking', onClick: backToBooking }}
        />
        <InlineNotice tone="success" role="status" icon={Check} title="Reschedule request sent to mentor">
          {booking.segment?.name ? `Your ${booking.segment.name} session with ${booking.mentor?.full_name || 'your mentor'} ` : 'Your session '}
          is still booked for its current time until your mentor responds. You will be notified as soon as they decide.
        </InlineNotice>
        <div className="flex justify-end">
          <Button onClick={backToBooking}>Back to booking</Button>
        </div>
      </div>
    );
  }

  const selectable = slots.filter((s) => s.is_available);
  const currentSlot = booking.gig?.duration_minutes
    ? formatSessionWindow(booking.start_time, booking.end_time, booking.mentor_timezone)
    : null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeading
        eyebrow={`Booking ${booking.booking_code}`}
        title="Choose a new time"
        description="Pick a time that is free on your mentor's calendar. Your mentor approves the change before anything moves."
        back={{ label: 'Back to booking', onClick: backToBooking }}
      />

      {currentSlot && (
        <SectionCard title="Current booking" description="This time stays confirmed until your mentor approves a new one.">
          <p className="text-sm font-semibold text-[var(--color-shell-text)]">{currentSlot}</p>
          <p className="mt-1 text-xs text-[var(--color-shell-text-muted)]">
            Same mentor, same session, same price. Only the time changes.
          </p>
        </SectionCard>
      )}

      <SectionCard title="Pick a date" description="Availability is generated by the server from live hours, bookings and holds across all of this mentor's sessions.">
        <DateSelector
          selectedDate={selectedDate}
          minDate={today}
          quickDates={quickDates}
          onSelect={setSelectedDate}
        />
      </SectionCard>

      <SectionCard title="Available times">
        {slotsError ? (
          <ErrorState title="Availability unavailable" message={slotsError} onRetry={loadSlots} />
        ) : slotsLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : slots.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="No times on this date"
            description="This mentor has no operating hours on the selected day. Try another date."
            actionLabel="Choose another date"
            onAction={() => quickDates[1] && setSelectedDate(quickDates[1].value)}
          />
        ) : selectable.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="All times are taken"
            description="Every time on this date is already booked or held. Try another date."
            actionLabel="Choose another date"
            onAction={() => quickDates[1] && setSelectedDate(quickDates[1].value)}
          />
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {slots.map((slot) => {
              const isSelected = selectedSlot?.id === slot.id;
              return (
                <li key={slot.id}>
                  <button
                    type="button"
                    disabled={!slot.is_available}
                    aria-pressed={isSelected}
                    aria-label={`${formatLocalTimeLabel(slot.local_start_time)} — ${SLOT_STATUS_COPY[slot.status]}`}
                    onClick={() => {
                      setSelectedSlot(slot);
                      setRescheduleError(null);
                    }}
                    className={cn(
                      'flex min-h-[52px] w-full cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl border px-2 py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] focus-visible:ring-offset-2',
                      isSelected
                        ? 'border-[var(--color-shell-primary)] bg-[var(--color-shell-primary)] text-white'
                        : !slot.is_available
                          ? 'cursor-not-allowed border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-text-subtle)]'
                          : 'border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] text-[var(--color-shell-text)] hover:border-[var(--color-shell-primary)]/50 hover:bg-[var(--color-shell-surface-elevated)]'
                    )}
                  >
                    <span className="text-[12px] font-semibold leading-tight">
                      {formatLocalTimeLabel(slot.local_start_time)}
                    </span>
                    <span className={cn('text-[10px] leading-tight', isSelected ? 'opacity-90' : 'text-[var(--color-shell-text-subtle)]')}>
                      {SLOT_STATUS_COPY[slot.status]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {rescheduleError && (
        <InlineNotice tone="danger" role="alert" icon={AlertCircle} title={rescheduleError.title}>
          {rescheduleError.message}
        </InlineNotice>
      )}

      <div className="flex flex-col gap-2.5 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={backToBooking} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={handleSendRequest} disabled={!selectedSlot || submitting} isLoading={submitting} className="gap-2">
          {!submitting && <Check className="h-4 w-4" aria-hidden="true" />}
          <span>Send Reschedule Request</span>
        </Button>
      </div>
    </div>
  );
};
