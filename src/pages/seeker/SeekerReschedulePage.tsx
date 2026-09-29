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
import { apiFetch } from '@/src/lib/apiClient';
import { fetchBookingDetail, type EnrichedBookingRecord } from '@/src/lib/bookingService';
import { fetchMentorSlots } from '@/src/lib/discoveryService';
import {
  buildQuickDates,
  formatLocalTimeLabel,
  getDateStringInTimezone,
} from '@/src/lib/slotEngine';
import { toUserMessage } from '@/src/lib/errorMessages';
import { HOLDOUT_MINUTES } from '@/src/config/app';
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
 * Rescheduling a booking onto a different slot.
 *
 * Every rule that matters is enforced server-side by
 * `POST /api/seeker/bookings/:id/reschedule`: ownership, the reschedulable
 * statuses, the cancellation-window cutoff, gig/segment match, the gig
 * duration, and the slot conflict check. This page therefore does no
 * eligibility arithmetic of its own — it offers the slots the server says are
 * available and reports whatever the server refuses, in the server's words.
 *
 * Rescheduling resets the booking to PAYMENT_PENDING on the new slot, so
 * success hands the seeker straight to payment, which is the same destination
 * the backend's own notification link uses.
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
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);

  const today = getDateStringInTimezone(new Date(), userTimezone);
  const quickDates = useMemo(() => buildQuickDates(today, 6), [today]);

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
      const { data, error } = await fetchMentorSlots({ mentorId: booking.mentor_id }, selectedDate);
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

  const handleConfirm = async () => {
    if (!booking || !selectedSlot || submitting) return;
    setSubmitting(true);
    setRescheduleError(null);
    try {
      const res = await apiFetch(
        `/api/seeker/bookings/${encodeURIComponent(booking.id)}/reschedule`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            newStartTime: selectedSlot.utc_start_time,
            newEndTime: selectedSlot.utc_end_time,
          }),
        }
      );
      const payload = await res.json().catch(() => null);

      if (!res.ok || !payload?.success) {
        // The server owns every rule here, so its message is the honest one to
        // show; the slot list is reloaded because a refusal usually means the
        // availability we rendered has just changed.
        setRescheduleError(payload?.error?.message || 'We could not reschedule to that time.');
        await loadSlots();
        return;
      }

      toast.success('Booking rescheduled. Please complete payment for the new slot.', {
        title: 'Booking Rescheduled',
      });
      navigate(`/seeker/payment?bookingId=${booking.id}`);
    } catch (err: any) {
      setRescheduleError(toUserMessage(err, 'We could not reschedule to that time.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <PageHeading title="Reschedule session" back={{ label: 'Back to booking', onClick: backToBooking }} />
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
        <PageHeading title="Reschedule session" back={{ label: 'Back to bookings', onClick: () => navigate('/seeker/bookings') }} />
        <ErrorState title="Booking unavailable" message={loadError || 'Booking not found.'} onRetry={loadBooking} />
      </div>
    );
  }

  const selectable = slots.filter((s) => s.is_available);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeading
        eyebrow={`Booking ${booking.booking_code}`}
        title="Choose a new time"
        description={`Pick an available time with the same mentor. Your booking returns to payment once the new slot is held for ${HOLDOUT_MINUTES} minutes.`}
        back={{ label: 'Back to booking', onClick: backToBooking }}
      />

      <SectionCard title="Pick a date" description="Availability is generated by the server from live hours, bookings and holds.">
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
            title="All times are booked"
            description="Every time on this date is already taken or held. Try another date."
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
        <InlineNotice tone="danger" role="alert" icon={AlertCircle} title="That time was not available">
          {rescheduleError}
        </InlineNotice>
      )}

      <div className="flex flex-col gap-2.5 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={backToBooking} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={handleConfirm} disabled={!selectedSlot || submitting} isLoading={submitting} className="gap-2">
          {!submitting && <Check className="h-4 w-4" aria-hidden="true" />}
          <span>Reschedule to this time</span>
        </Button>
      </div>
    </div>
  );
};
