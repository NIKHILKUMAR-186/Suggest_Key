import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Calendar,
  CheckCircle2,
  Clock,
  Globe,
  Languages,
  Lock,
  RefreshCw,
  Star,
  Timer,
  TriangleAlert,
  Briefcase,
} from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@/src/components/ui/Button';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import { fetchMentorDetail, fetchSegmentBySlug } from '@/src/lib/discoveryService';
import { useAvailabilitySync } from '@/src/hooks/useAvailabilitySync';
import { getInitials } from '@/src/lib/avatar';
import {
  createBookingWithHold,
  calculateRemainingHoldSeconds,
} from '@/src/lib/bookingService';
import {
  formatInr,
  formatShortDate,
  formatTimeRange,
} from '@/src/lib/seekerFormat';
import { DiscoverableMentor, GeneratedSlot, Booking, SlotHold } from '@/src/types/database';
import {
  formatLocalTimeLabel,
  formatDate,
  getDateStringInTimezone,
} from '@/src/lib/slotEngine';
import { BOOKING_CUTOFF_MINUTES, HOLDOUT_MINUTES } from '@/src/config/app';
import { cn } from '@/src/lib/utils';
import { SegmentScope } from '@/src/components/booking/SegmentScope';
import { SectionCard, InlineNotice, DetailItem, DetailList, TotalRow } from '@/src/components/booking/StatePanel';
import { HoldCountdown } from '@/src/components/booking/HoldCountdown';
import { StatusPill } from '@/src/components/booking/StatusPill';

const EASE = [0.23, 1, 0.31, 1] as const;

const SLOT_STATUS_COPY: Record<GeneratedSlot['status'], string> = {
  AVAILABLE: 'Available',
  PAST: 'Past',
  BOOKED: 'Booked',
  HELD: 'On hold',
  CLOSING_SOON: 'Closing',
};

const SlotEmptyState: React.FC<{
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}> = ({ title, body, actionLabel, onAction }) => (
  <div className="mt-3 rounded-xl border border-dashed border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] px-4 py-6 text-center">
    <p className="text-[13px] font-semibold text-[var(--color-shell-text)]">{title}</p>
    <p className="mx-auto mt-1 max-w-[30ch] text-[12px] leading-relaxed text-[var(--color-shell-text-muted)]">
      {body}
    </p>
    <Button type="button" variant="secondary" size="sm" className="mt-3.5" onClick={onAction}>
      {actionLabel}
    </Button>
  </div>
);

const describeSlotPanel = (
  availableCount: number,
  totalGenerated: number,
  isLoading: boolean,
  hasLoadError: boolean
): { headline: string; body: string } => {
  if (isLoading) {
    return { headline: 'Checking availability…', body: '' };
  }
  if (hasLoadError) {
    return { headline: 'Unable to load availability.', body: '' };
  }
  if (availableCount > 0) {
    return {
      headline: `${availableCount} ${availableCount === 1 ? 'slot' : 'slots'}`,
      body: '',
    };
  }
  if (totalGenerated === 0) {
    return {
      headline: 'No available slots for this date.',
      body: 'Choose another date to see open times.',
    };
  }
  return {
    headline: 'All available times are currently booked.',
    body: 'Choose another date to see open times.',
  };
};

const describeBookingError = (code: string | undefined, message: string | undefined): string => {
  const text = (message || '').trim();

  if (code === 'FORBIDDEN' || /role '.+' required/i.test(text)) {
    return 'Your account is not authorized to book sessions on this platform. An administrator needs to assign your account the seeker role before you can reserve a slot.';
  }
  if (code === 'AUTH_REQUIRED' || code === 'AUTH_INVALID') {
    return 'Your session has expired. Sign in again to reserve this slot.';
  }
  if (code === 'SLOT_ALREADY_BOOKED' || code === 'SLOT_HELD_BY_OTHER' || code === 'BOOKING_CONFLICT') {
    return 'This slot was just taken. Please choose another time.';
  }
  if (code === 'PAST_SLOT_FORBIDDEN') {
    return 'That time has already passed. Please choose another time.';
  }
  if (code === 'BOOKING_CUTOFF_REACHED') {
    return `This slot can no longer be booked because it starts in less than ${BOOKING_CUTOFF_MINUTES} minutes. Please choose another time.`;
  }
  if (code === 'DURATION_MISMATCH') {
    return 'That session length no longer matches the active offer. Please choose another time.';
  }
  if (
    code === 'OUTSIDE_AVAILABILITY' ||
    code === 'OUTSIDE_EXCEPTION_HOURS' ||
    code === 'DATE_EXCEPTION_UNAVAILABLE'
  ) {
    return "This time is no longer bookable because the mentor's availability changed. Please choose another time.";
  }
  if (code === 'MENTOR_NOT_BOOKABLE') {
    return 'This mentor is not currently accepting bookings. Browse other mentors in this segment.';
  }
  if (code === 'SEEKER_ACCOUNT_SUSPENDED' || code === 'SEEKER_ACCOUNT_DEACTIVATED') {
    return text || 'Your account cannot start new bookings right now.';
  }
  return text || 'We could not reserve that slot. Please choose another time and try again.';
};

export const SeekerMentorDetailPage: React.FC = () => {
  const { navigate, currentPath } = useNavigation();
  const { profile } = useAuth();

  const searchParams = new URLSearchParams(
    currentPath.includes('?') ? currentPath.split('?')[1] : ''
  );
  const paramMentorId = searchParams.get('mentorId') || '';
  const paramSegmentSlug = searchParams.get('segmentSlug') || '';
  const paramSegmentId = searchParams.get('segmentId') || '';
  const paramGigId = searchParams.get('gigId') || '';
  const paramDate = searchParams.get('date') || '';
  const hasRequiredParams = Boolean(paramMentorId && (paramSegmentSlug || paramSegmentId));

  const userTimezone = profile?.timezone || 'UTC';
  const today = getDateStringInTimezone(new Date(), userTimezone);

  const [selectedDate, setSelectedDate] = useState<string>(paramDate || today);
  const [mentorData, setMentorData] = useState<DiscoverableMentor | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<GeneratedSlot | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSlotsLoading, setIsSlotsLoading] = useState<boolean>(true);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [staleContextError, setStaleContextError] = useState<string | null>(null);
  const [nextBoundaryAt, setNextBoundaryAt] = useState<string | null>(null);
  const [resolvedSegmentId, setResolvedSegmentId] = useState<string>('');

  useEffect(() => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const slugOrId = paramSegmentSlug || paramSegmentId;

    if (!slugOrId) {
      setResolvedSegmentId('');
      return;
    }

    if (uuidRegex.test(slugOrId)) {
      setResolvedSegmentId(slugOrId);
      return;
    }

    if (paramSegmentSlug) {
      fetchSegmentBySlug(paramSegmentSlug).then((segment) => {
        setResolvedSegmentId(segment?.id || '');
      });
    } else {
      setResolvedSegmentId(paramSegmentId);
    }
  }, [paramSegmentSlug, paramSegmentId]);

  const [isReserving, setIsReserving] = useState<boolean>(false);
  const [activeBooking, setActiveBooking] = useState<Booking | null>(null);
  const [activeHold, setActiveHold] = useState<SlotHold | null>(null);
  const [holdSecondsRemaining, setHoldSecondsRemaining] = useState<number>(0);
  const [bookingError, setBookingError] = useState<string | null>(null);

  const loadMentor = useCallback(
    async (opts: { initial?: boolean } = {}) => {
      if (!hasRequiredParams || !resolvedSegmentId) {
        setIsLoading(false);
        setIsSlotsLoading(false);
        setError('Select a mentor and segment to view availability.');
        return;
      }

      if (opts.initial) {
        setIsLoading(true);
        setError(null);
      }
      setIsSlotsLoading(true);
      setSlotsError(null);

      try {
        const { mentor, error: err } = await fetchMentorDetail(
          paramMentorId,
          resolvedSegmentId,
          selectedDate,
          { gigId: paramGigId || null }
        );
        if (err) throw err;

        setMentorData(mentor);
        setNextBoundaryAt(mentor?.next_hold_expires_at ?? mentor?.next_slot_start_at ?? null);

        // `fetchMentorDetail` has already proven that the resolved gig is the one
        // this route asked for: same mentor, same segment, still active, and the
        // same `gigId` when the route carried one. So a returned mentor is
        // renderable and every field on it — segment name, gig title, gig
        // description, duration, price and the slot grid — comes from that single
        // gig row.
        //
        // The only remaining stale-context case is a mentor with no usable offer
        // in this segment at all, which is a real state the seeker must be told
        // about rather than a bug.
        setStaleContextError(
          mentor
            ? null
            : 'This mentor has no active session offer in the segment you selected.'
        );

        setSelectedSlot((prev) => {
          if (!prev) return mentor?.available_slots?.[0] ?? null;
          const stillBookable = mentor?.all_slots?.find(
            (s) => s.id === prev.id && s.is_available
          );
          return stillBookable ?? mentor?.available_slots?.[0] ?? null;
        });
      } catch (e: any) {
        const message = e?.message || 'Unable to load availability.';
        if (opts.initial) {
          setError(message);
        } else {
          setSlotsError(message);
        }
      } finally {
        setIsLoading(false);
        setIsSlotsLoading(false);
      }
    },
    [hasRequiredParams, resolvedSegmentId, paramMentorId, paramGigId, selectedDate]
  );

  const reloadMentorSlots = useCallback(() => loadMentor(), [loadMentor]);

  useAvailabilitySync({
    mentorId: paramMentorId || null,
    enabled: hasRequiredParams && Boolean(resolvedSegmentId),
    nextBoundaryAt,
    onInvalidate: reloadMentorSlots,
  });

  useEffect(() => {
    if (!activeHold || holdSecondsRemaining <= 0) return;

    const interval = setInterval(() => {
      setHoldSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setActiveHold(null);
          setBookingError(
            `Your ${HOLDOUT_MINUTES}-minute hold expired and the slot was released. Select a time to try again.`
          );
          reloadMentorSlots();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [activeHold, holdSecondsRemaining, reloadMentorSlots]);

  const handleReserveSlot = async () => {
    if (!selectedSlot || !mentorData) return;

    setIsReserving(true);
    setBookingError(null);

    try {
      const result = await createBookingWithHold({
        mentorId: mentorData.id,
        segmentId: mentorData.segment.id,
        gigId: mentorData.gig.id,
        startTime: selectedSlot.utc_start_time,
        endTime: selectedSlot.utc_end_time,
      });

      if (!result.success || !result.booking || !result.hold) {
        setBookingError(describeBookingError(result.error?.code, result.error?.message));
        await reloadMentorSlots();
        return;
      }

      // The server has just created the hold; `expires_at` is the only
      // authority on how long it lasts. A remaining of zero means the hold is
      // already gone (device/server clock skew, or a hold shorter than the
      // round trip), so it is reported as released rather than presented as a
      // fresh countdown — a seeker must never be shown time they do not have.
      const remainingSeconds = calculateRemainingHoldSeconds(result.hold.expires_at);
      if (remainingSeconds <= 0) {
        setActiveBooking(null);
        setActiveHold(null);
        setHoldSecondsRemaining(0);
        setBookingError(
          describeBookingError(
            'HOLD_EXPIRED',
            'That slot was released before it could be held. Please choose another time.'
          )
        );
        await reloadMentorSlots();
        return;
      }

      setActiveBooking(result.booking);
      setActiveHold(result.hold);
      setHoldSecondsRemaining(remainingSeconds);
      await reloadMentorSlots();

      // The server created the booking and the hold. The hold is the only
      // authority on how long the slot is reserved, and the booking is in
      // PAYMENT_PENDING — so the seeker is sent straight to My Bookings,
      // where the new row is highlighted and its "Pay Now" action is the
      // first thing they can reach. Nothing here marks the booking paid or
      // confirmed: payment still has to happen through the existing flow.
      navigate(`/seeker/bookings?bookingId=${encodeURIComponent(result.booking.id)}`);
    } catch (err: any) {
      setBookingError(describeBookingError(undefined, err?.message));
      await reloadMentorSlots();
    } finally {
      setIsReserving(false);
    }
  };

  useEffect(() => {
    loadMentor({ initial: true });
  }, [loadMentor]);

  const gig = mentorData?.gig;
  const gigPrice = mentorData ? formatInr(mentorData.gig.price_inr) : '';
  const holdAmount = activeBooking ? formatInr(activeBooking.amount_inr) : '';
  const availableSlots = mentorData?.available_slots ?? [];
  const allSlots = mentorData?.all_slots ?? [];
  const selectedTimeLabel = selectedSlot
    ? formatTimeRange(
        formatLocalTimeLabel(selectedSlot.local_start_time),
        formatLocalTimeLabel(selectedSlot.local_end_time)
      )
    : '';
  const canReserve = Boolean(selectedSlot?.is_available) && !isReserving && !activeHold;

  const slotPanel = describeSlotPanel(
    availableSlots.length,
    allSlots.length,
    isSlotsLoading,
    Boolean(slotsError)
  );
  const hasSelectableSlot = availableSlots.length > 0;

  const focusDatePicker = useCallback(() => {
    const input = document.getElementById('session-date');
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.showPicker?.();
    }
  }, []);

  const backPath = paramSegmentSlug
    ? `/seeker/mentors?segmentSlug=${encodeURIComponent(paramSegmentSlug)}&date=${selectedDate}`
    : `/seeker/mentors?segmentId=${paramSegmentId}&date=${selectedDate}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
      className="mx-auto w-full max-w-[1280px]"
    >
      {/* Back navigation */}
      <button
        type="button"
        onClick={() => navigate(backPath)}
        className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg px-1.5 text-[13px] font-medium text-[var(--color-shell-text-muted)] transition-colors hover:text-[var(--color-shell-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] focus-visible:ring-offset-2"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        <span>Back to mentors</span>
      </button>

      {isLoading ? (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.9fr)_minmax(340px,1fr)] lg:gap-8">
          <div className="space-y-6">
            <div className="detail-card">
              <div className="flex items-center gap-5">
                <Skeleton variant="circular" className="h-20 w-20 shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-6 w-1/2" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              </div>
            </div>
            <div className="detail-card">
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="mt-3 h-16 w-full" />
            </div>
          </div>
          <div className="detail-card">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="mt-4 h-12 w-full" />
            <Skeleton className="mt-4 h-40 w-full" />
          </div>
        </div>
      ) : staleContextError ? (
        <div className="mt-6">
          <EmptyState
            title="Session offer mismatch"
            description={staleContextError}
            actionLabel="Back to mentors"
            onAction={() => navigate(backPath)}
          />
        </div>
      ) : !mentorData ? (
        <div className="mt-6">
          <EmptyState
            title="Mentor not found"
            description="We could not find this mentor with an active session in the selected segment."
            actionLabel="Back to mentors"
            onAction={() => navigate(backPath)}
          />
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.9fr)_minmax(340px,1fr)] lg:gap-8">
          {/* LEFT: profile, expertise, gig */}
          <div className="min-w-0 space-y-6">
            {/* Identity header */}
            <section className="detail-card">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                {mentorData.avatar_url ? (
                  <img
                    src={mentorData.avatar_url}
                    alt={`${mentorData.full_name} profile photo`}
                    className="h-20 w-20 shrink-0 rounded-full border-2 border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] object-cover sm:h-24 sm:w-24 avatar-ring"
                  />
                ) : (
                  <div
                    role="img"
                    aria-label={`${mentorData.full_name} profile photo placeholder`}
                    className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-2 border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] text-2xl font-bold text-[var(--color-shell-text-muted)] sm:h-24 sm:w-24"
                  >
                    {getInitials(mentorData.full_name)}
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
                    <h1 className="font-display text-2xl font-bold leading-tight tracking-tight text-[var(--color-shell-text)] sm:text-[28px]">
                      {mentorData.full_name}
                    </h1>
                    {mentorData.is_approved && (
                      <span className="badge badge-success">
                        <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        Verified
                      </span>
                    )}
                    {mentorData.is_featured && (
                      <span className="badge" style={{ background: 'var(--color-shell-warning-soft)', color: 'var(--color-shell-warning)', border: '1px solid color-mix(in srgb, var(--color-shell-warning) 30%, transparent)' }}>
                        <Star className="h-3 w-3 fill-current" aria-hidden="true" />
                        Featured
                      </span>
                    )}
                  </div>

                  {mentorData.headline && (
                    <p className="mt-2 text-[15px] leading-snug text-[var(--color-shell-text-muted)]">
                      {mentorData.headline}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-[var(--color-shell-text-muted)]">
                    {mentorData.languages.length > 0 && (
                      <span className="inline-flex items-center gap-1.5">
                        <Languages
                          className="h-4 w-4 shrink-0 text-[var(--color-shell-text-subtle)]"
                          aria-hidden="true"
                        />
                        {mentorData.languages.join(', ')}
                      </span>
                    )}
                    {mentorData.timezone && (
                      <span className="inline-flex items-center gap-1.5">
                        <Globe
                          className="h-4 w-4 shrink-0 text-[var(--color-shell-text-subtle)]"
                          aria-hidden="true"
                        />
                        {mentorData.timezone}
                      </span>
                    )}
                    {mentorData.experience_years > 0 && (
                      <span className="inline-flex items-center gap-1.5">
                        <Briefcase
                          className="h-4 w-4 shrink-0 text-[var(--color-shell-text-subtle)]"
                          aria-hidden="true"
                        />
                        {mentorData.experience_years}{' '}
                        {mentorData.experience_years === 1 ? 'year' : 'years'} experience
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {mentorData.about && mentorData.about.trim() && (
                <p className="mt-5 text-[14px] leading-relaxed text-[var(--color-shell-text-muted)]">
                  {mentorData.about.trim()}
                </p>
              )}

              {mentorData.expertise && mentorData.expertise.length > 0 && (
                <div className="mt-5">
                  <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-shell-text-subtle)]">
                    Expertise
                  </h2>
                  <ul className="mt-2.5 chip-row" aria-label="Expertise">
                    {mentorData.expertise.map((item) => (
                      <li key={item} className="chip">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            {/* Active gig */}
            <section className="detail-card">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-shell-text-subtle)]">
                  Active session offer
                </h2>
                <span className="badge badge-neutral">
                  {mentorData.segment.name}
                </span>
              </div>

              <h3 className="mt-3 font-display text-lg font-bold leading-snug text-[var(--color-shell-text)] sm:text-xl">
                {gig?.title}
              </h3>

              {gig?.description && (
                <p className="mt-2 text-[14px] leading-relaxed text-[var(--color-shell-text-muted)]">
                  {gig.description}
                </p>
              )}

              <dl className="mt-5 grid grid-cols-1 gap-4 border-t border-[var(--color-shell-border)] pt-5 sm:grid-cols-3">
                <div>
                  <dt className="text-[11px] font-medium text-[var(--color-shell-text-subtle)]">
                    Duration
                  </dt>
                  <dd className="mt-1 inline-flex items-center gap-1.5 text-[14px] font-semibold text-[var(--color-shell-text)]">
                    <Clock
                      className="h-4 w-4 shrink-0 text-[var(--color-shell-text-muted)]"
                      aria-hidden="true"
                    />
                    {gig?.duration_minutes} minutes
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium text-[var(--color-shell-text-subtle)]">
                    Session price
                  </dt>
                  <dd className="price-display mt-1">
                    <span className="price-amount">{gigPrice}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium text-[var(--color-shell-text-subtle)]">
                    Hold window
                  </dt>
                  <dd className="mt-1 inline-flex items-center gap-1.5 text-[14px] font-semibold text-[var(--color-shell-text)]">
                    <Lock
                      className="h-4 w-4 shrink-0 text-[var(--color-shell-text-muted)]"
                      aria-hidden="true"
                    />
                    {HOLDOUT_MINUTES} minutes
                  </dd>
                </div>
              </dl>
            </section>

            {/* Availability summary */}
            <section className="detail-card">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-shell-text-subtle)]">
                Availability
              </h2>
              <p className="mt-2.5 text-[14px] leading-relaxed text-[var(--color-shell-text-muted)]">
                {isSlotsLoading ? (
                  <>Checking availability for {formatShortDate(selectedDate) || formatDate(selectedDate)}…</>
                ) : slotsError ? (
                  <>We could not confirm availability for {formatShortDate(selectedDate) || formatDate(selectedDate)}. The times below may be out of date.</>
                ) : hasSelectableSlot ? (
                  <>
                    {mentorData.full_name} has{' '}
                    <span className="font-semibold text-[var(--color-shell-text)]">
                      {availableSlots.length} {availableSlots.length === 1 ? 'slot' : 'slots'}
                    </span>{' '}
                    available on {formatShortDate(selectedDate) || formatDate(selectedDate)} in{' '}
                    {mentorData.timezone}.
                  </>
                ) : (
                  <>
                    {mentorData.full_name} has no bookable slots on{' '}
                    {formatShortDate(selectedDate) || formatDate(selectedDate)}. Pick another
                    date to see open times.
                  </>
                )}
              </p>
              <p className="mt-2 text-[12px] text-[var(--color-shell-text-subtle)]">
                Availability belongs to the mentor, not to a single session offer. A confirmed or
                held time is blocked across every segment they mentor on.
              </p>
            </section>
          </div>

          {/* RIGHT: sticky booking panel */}
          <div className="min-w-0 lg:sticky lg:top-20">
            <SegmentScope slug={paramSegmentSlug}>
            <SectionCard
              title="Book a session"
              description={`Times are shown in ${mentorData.timezone}.`}
              icon={Calendar}
              aside={
                activeHold ? (
                  <StatusPill tone="success" label="Slot held" dot />
                ) : isReserving ? (
                  <StatusPill tone="info" label="Reserving…" />
                ) : hasSelectableSlot ? (
                  <StatusPill tone="success" label={`${availableSlots.length} open`} />
                ) : (
                  <StatusPill tone="neutral" label="None open" />
                )
              }
            >
              {/* Date */}
              <div>
                <label
                  htmlFor="session-date"
                  className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-shell-text-subtle)]"
                >
                  Session date
                </label>
                <div className="mt-2 flex items-center gap-2.5 rounded-xl border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-surface-elevated)] px-3.5 py-2.5 transition-colors focus-within:border-[var(--segment-accent)] focus-within:ring-2 focus-within:ring-[var(--color-shell-focus)]">
                  <Calendar
                    className="h-4 w-4 shrink-0 text-[var(--color-shell-text-subtle)]"
                    aria-hidden="true"
                  />
                  <input
                    id="session-date"
                    type="date"
                    value={selectedDate}
                    min={today}
                    onChange={(e) => {
                      setSelectedDate(e.target.value);
                      setSelectedSlot(null);
                      setBookingError(null);
                    }}
                    className="w-full cursor-pointer border-none bg-transparent text-[14px] font-semibold text-[var(--color-shell-text)] focus:outline-none"
                  />
                </div>
              </div>

              {/* Times */}
              <div className="mt-5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-shell-text-subtle)]">
                    Available times
                  </span>
                  <span
                    aria-live="polite"
                    className="text-[12px] text-[var(--color-shell-text-muted)]"
                  >
                    {isSlotsLoading ? 'Checking…' : slotsError ? 'Unavailable' : slotPanel.headline}
                  </span>
                </div>

                {isSlotsLoading ? (
                  <div className="mt-2.5 grid grid-cols-2 gap-2" aria-hidden="true">
                    {[0, 1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-[52px] w-full" />
                    ))}
                  </div>
                ) : slotsError ? (
                  <InlineNotice
                    tone="danger"
                    role="alert"
                    icon={TriangleAlert}
                    title="Unable to load availability"
                    className="mt-2.5"
                    actions={
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => reloadMentorSlots()}
                      >
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Retry</span>
                      </Button>
                    }
                  >
                    The times below may be out of date. Retry before choosing a slot.
                  </InlineNotice>
                ) : allSlots.length === 0 ? (
                  <SlotEmptyState
                    title="No available slots for this date."
                    body={`${mentorData.full_name} has no operating hours on this day.`}
                    actionLabel="Choose another date"
                    onAction={focusDatePicker}
                  />
                ) : !hasSelectableSlot ? (
                  <SlotEmptyState
                    title="All available times are currently booked."
                    body="The times below are shown for context and cannot be selected."
                    actionLabel="Choose another date"
                    onAction={focusDatePicker}
                  />
                ) : null}

                {!isSlotsLoading && !slotsError && allSlots.length > 0 && (
                  <ul className="mt-2.5 grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1">
                    {allSlots.map((slot) => {
                      const isSelected = selectedSlot?.id === slot.id;
                      const isDisabled = !slot.is_available;

                      return (
                        <li key={slot.id}>
                          <button
                            type="button"
                            disabled={isDisabled}
                            aria-pressed={isSelected}
                            aria-label={`${formatLocalTimeLabel(slot.local_start_time)} — ${SLOT_STATUS_COPY[slot.status]}`}
                            onClick={() => {
                              setSelectedSlot(slot);
                              setBookingError(null);
                            }}
                            className={cn(
                              'flex min-h-[52px] w-full cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl border px-2 py-2 text-center transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] focus-visible:ring-offset-2',
                              isSelected
                                ? 'border-[var(--segment-accent)] bg-[var(--segment-accent)] text-[var(--color-shell-text-contrast)]'
                                : isDisabled
                                  ? 'cursor-not-allowed border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-text-subtle)]'
                                  : 'border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] text-[var(--color-shell-text)] hover:border-[var(--segment-accent)]/50 hover:bg-[var(--color-shell-surface-elevated)]'
                            )}
                          >
                            <span className="text-[12px] font-semibold leading-tight">
                              {formatLocalTimeLabel(slot.local_start_time)}
                            </span>
                            <span
                              className={cn(
                                'text-[10px] leading-tight',
                                isSelected
                                  ? 'opacity-90'
                                  : 'text-[var(--color-shell-text-subtle)]'
                              )}
                            >
                              {SLOT_STATUS_COPY[slot.status]}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* Booking error */}
              {bookingError && (
                <InlineNotice
                  tone="danger"
                  role="alert"
                  icon={TriangleAlert}
                  title="That booking did not go through"
                  className="mt-5"
                >
                  {bookingError}
                </InlineNotice>
              )}

              {/* Active hold */}
              {activeHold && activeBooking ? (
                <div className="mt-5 space-y-4">
                  <HoldCountdown
                    secondsRemaining={holdSecondsRemaining}
                    totalSeconds={HOLDOUT_MINUTES * 60}
                    label="Slot held for you"
                  />

                  <DetailList className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] p-4">
                    <DetailItem label="Booking code" mono>
                      {activeBooking.booking_code}
                    </DetailItem>
                    <DetailItem label="Session time">
                      <span className="whitespace-nowrap">{selectedTimeLabel}</span>
                    </DetailItem>
                    <DetailItem label="Date">
                      {formatShortDate(selectedDate)} · {mentorData.timezone}
                    </DetailItem>
                    <div className="sm:col-span-2">
                      <TotalRow label="Amount due" value={holdAmount} />
                    </div>
                  </DetailList>

                  <Button
                    onClick={() => navigate(`/seeker/payment?bookingId=${activeBooking.id}`)}
                    size="lg"
                    className="btn-primary-segment w-full gap-2"
                  >
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    <span>Continue to payment</span>
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Button>

                  <p className="text-center text-[11.5px] leading-relaxed text-[var(--color-shell-text-subtle)]">
                    Your slot is released automatically when the timer runs out.
                  </p>
                </div>
              ) : (
                <>
                  {/* Summary */}
                  <div className="mt-5 border-t border-[var(--color-shell-border)] pt-5">
                    <DetailList columns={2} className="text-[13px]">
                      <DetailItem label="Duration" icon={Clock}>
                        {gig?.duration_minutes} minutes
                      </DetailItem>
                      <DetailItem label="Session price">
                        {gigPrice}
                      </DetailItem>
                      <DetailItem label="Selected time" className="sm:col-span-2">
                        {selectedSlot ? (
                          <>
                            <span className="whitespace-nowrap">{selectedTimeLabel}</span>
                            <span className="mt-0.5 block text-[11.5px] font-normal text-[var(--color-shell-text-subtle)]">
                              {formatShortDate(selectedDate)} · {mentorData.timezone}
                            </span>
                          </>
                        ) : (
                          <span className="font-normal text-[var(--color-shell-text-subtle)]">
                            Select an available time
                          </span>
                        )}
                      </DetailItem>
                    </DetailList>

                    <div className="mt-4">
                      <TotalRow label="Total" value={gigPrice} />
                    </div>
                  </div>

                  <Button
                    onClick={handleReserveSlot}
                    disabled={!canReserve}
                    isLoading={isReserving}
                    loadingText="Reserving slot"
                    size="lg"
                    className="btn-primary-segment mt-5 w-full gap-2 font-semibold shadow-xs"
                  >
                    {!isReserving && <Lock className="h-4 w-4" aria-hidden="true" />}
                    <span>
                      {isReserving
                        ? 'Reserving slot'
                        : `Reserve slot · ${HOLDOUT_MINUTES}-min hold`}
                    </span>
                    {!isReserving && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
                  </Button>

                  <p className="mt-2.5 text-center text-[11.5px] leading-relaxed text-[var(--color-shell-text-subtle)]">
                    Reserving locks this time in the database for {HOLDOUT_MINUTES} minutes while you
                    complete payment.
                  </p>
                  <p className="mt-1.5 text-center text-[11.5px] leading-relaxed text-[var(--color-shell-text-subtle)]">
                    Bookings are available until {BOOKING_CUTOFF_MINUTES} minutes before the
                    session.
                  </p>
                </>
              )}
            </SectionCard>
            </SegmentScope>
          </div>
        </div>
      )}
    </motion.div>
  );
};
