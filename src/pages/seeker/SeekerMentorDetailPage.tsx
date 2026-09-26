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
  formatCountdown,
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
import { BOOKING_CUTOFF_MINUTES } from '@/src/config/app';
import { cn } from '@/src/lib/utils';

const EASE = [0.23, 1, 0.31, 1] as const;

/** Human label for a generated slot's real status. */
const SLOT_STATUS_COPY: Record<GeneratedSlot['status'], string> = {
  AVAILABLE: 'Available',
  PAST: 'Past',
  BOOKED: 'Booked',
  HELD: 'On hold',
  CLOSING_SOON: 'Closing',
};

/**
 * Copy for the slot panel, derived only from real generated slots.
 *
 * `availability` is the count of genuinely selectable slots, and it is the same
 * number rendered next to the heading and used for the empty-state decision — a
 * page can no longer say "0 slots" while offering a selectable button, and it
 * can no longer imply availability by listing times that are actually booked.
 */
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

/**
 * Maps a failed reservation onto a message a seeker can act on.
 *
 * The raw server text ("Role 'seeker' required.") is developer-facing, so it
 * is translated here instead of being dumped into the UI. Authorization
 * failures are NOT hidden: they get their own explicit explanation, because
 * the fix belongs on the account, not in the browser.
 */
const describeBookingError = (code: string | undefined, message: string | undefined): string => {
  const text = (message || '').trim();

  if (code === 'FORBIDDEN' || /role '.+' required/i.test(text)) {
    return 'Your account is not authorized to book sessions on this platform. An administrator needs to assign your account the seeker role before you can reserve a slot.';
  }
  if (code === 'AUTH_REQUIRED' || code === 'AUTH_INVALID') {
    return 'Your session has expired. Sign in again to reserve this slot.';
  }
  if (code === 'SLOT_ALREADY_BOOKED' || code === 'SLOT_HELD_BY_OTHER' || code === 'BOOKING_CONFLICT') {
    // The database decided the race; the browser never asserts success.
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
  // The mentor cards link here with the human-readable segment slug, while
  // older/hand-built links may still carry the segment UUID. Both identify
  // the same segment, so accept either rather than failing the required-param
  // check on a slug-only link.
  const paramSegmentSlug = searchParams.get('segmentSlug') || '';
  const paramSegmentId = searchParams.get('segmentId') || '';
  const paramDate = searchParams.get('date') || '';
  const hasRequiredParams = Boolean(paramMentorId && (paramSegmentSlug || paramSegmentId));

  // "Today" follows the seeker's own configured timezone, matching the
  // calendar the date picker shows. Deriving it with `toISOString()` would use
  // the UTC date and shift the selected day for anyone east or west of UTC.
  const userTimezone = profile?.timezone || 'UTC';
  const today = getDateStringInTimezone(new Date(), userTimezone);

  const [selectedDate, setSelectedDate] = useState<string>(paramDate || today);
  const [mentorData, setMentorData] = useState<DiscoverableMentor | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<GeneratedSlot | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  // Slot data is refreshed independently of the mentor's profile, so the two
  // never share a single "loading" flag. Without this split a background
  // revalidation would blank the whole page, and a still-loading slot list
  // would be rendered as "0 slots".
  const [isSlotsLoading, setIsSlotsLoading] = useState<boolean>(true);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Earliest instant at which availability changes with no database write.
  const [nextBoundaryAt, setNextBoundaryAt] = useState<string | null>(null);
  // Resolved internal segment UUID (slug → UUID) used by API calls.
  const [resolvedSegmentId, setResolvedSegmentId] = useState<string>('');

  // Resolve the public segment slug to the internal UUID the backend requires.
  useEffect(() => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const slugOrId = paramSegmentSlug || paramSegmentId;

    if (!slugOrId) {
      setResolvedSegmentId('');
      return;
    }

    // A UUID can be used directly — supports both slug URLs and legacy UUID links.
    if (uuidRegex.test(slugOrId)) {
      setResolvedSegmentId(slugOrId);
      return;
    }

    // Otherwise resolve the human-readable slug to a UUID via the API.
    if (paramSegmentSlug) {
      fetchSegmentBySlug(paramSegmentSlug).then((segment) => {
        setResolvedSegmentId(segment?.id || '');
      });
    } else {
      setResolvedSegmentId(paramSegmentId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramSegmentSlug, paramSegmentId]);

  const [isReserving, setIsReserving] = useState<boolean>(false);
  const [activeBooking, setActiveBooking] = useState<Booking | null>(null);
  const [activeHold, setActiveHold] = useState<SlotHold | null>(null);
  const [holdSecondsRemaining, setHoldSecondsRemaining] = useState<number>(0);
  // Set ONLY after a real failed operation. There is no permanently rendered
  // error banner on this page.
  const [bookingError, setBookingError] = useState<string | null>(null);

  /**
   * The single loader for this page. Every path into fresh availability goes
   * through here: the first render, a date change, a realtime event, an expired
   * hold, a failed reservation, and the conservative revalidation tick.
   *
   * Slots are never assembled here. `fetchMentorDetail` returns what the server
   * generated from the live tables, and the only client-side decision is whether
   * the current selection is still bookable.
   */
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
          selectedDate
        );
        if (err) throw err;

        setMentorData(mentor);
        setNextBoundaryAt(mentor?.next_hold_expires_at ?? mentor?.next_slot_start_at ?? null);

        // Keep the selection only if it is still a real, selectable slot on the
        // freshly generated list. A slot that just became BOOKED, HELD or PAST
        // is dropped rather than left highlighted.
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
          // A background refresh must not destroy a good render, but the seeker
          // has to know the times on screen may be stale.
          setSlotsError(message);
        }
      } finally {
        setIsLoading(false);
        setIsSlotsLoading(false);
      }
    },
    [hasRequiredParams, resolvedSegmentId, paramMentorId, selectedDate]
  );

  const reloadMentorSlots = useCallback(() => loadMentor(), [loadMentor]);

  // Realtime + conservative revalidation. Scoped to this mentor, and torn down
  // when the mentor changes, the date changes, or the page unmounts.
  useAvailabilitySync({
    mentorId: paramMentorId || null,
    enabled: hasRequiredParams && Boolean(resolvedSegmentId),
    nextBoundaryAt,
    onInvalidate: reloadMentorSlots,
  });

  // Live 15-minute countdown. The hold countdown is a UI affordance only: the
  // authoritative expiry is `slot_holds.expires_at`, enforced by the database.
  useEffect(() => {
    if (!activeHold || holdSecondsRemaining <= 0) return;

    const interval = setInterval(() => {
      setHoldSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setActiveHold(null);
          setBookingError(
            'Your 15-minute hold expired and the slot was released. Select a time to try again.'
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
      // The seeker identity is NOT sent from the browser: the server derives it
      // from the authenticated Supabase session.
      const result = await createBookingWithHold({
        mentorId: mentorData.id,
        segmentId: mentorData.segment.id,
        gigId: mentorData.gig.id,
        startTime: selectedSlot.utc_start_time,
        endTime: selectedSlot.utc_end_time,
      });

      // Only a successful database transaction may change what the UI claims.
      // A click is never treated as a booking.
      if (!result.success || !result.booking || !result.hold) {
        setBookingError(describeBookingError(result.error?.code, result.error?.message));
        await reloadMentorSlots();
        return;
      }

      setActiveBooking(result.booking);
      setActiveHold(result.hold);
      setHoldSecondsRemaining(calculateRemainingHoldSeconds(result.hold.expires_at) || 900);
      await reloadMentorSlots();
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

  // ---------------------------------------------------------------------------
  // Derived display values — every one of them comes from the loaded mentor.
  // ---------------------------------------------------------------------------
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

  // The headline number and the empty state are derived from the SAME real slot
  // list, so "N slots" can never disagree with the buttons underneath it.
  const slotPanel = describeSlotPanel(
    availableSlots.length,
    allSlots.length,
    isSlotsLoading,
    Boolean(slotsError)
  );
  const hasSelectableSlot = availableSlots.length > 0;

  // "Choose another date" focuses the real date input instead of navigating
  // away, so the seeker can retry the same mentor one day later.
  const focusDatePicker = useCallback(() => {
    const input = document.getElementById('session-date');
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.showPicker?.();
    }
  }, []);

  // SegmentMentorsSection links here as `/seeker/mentors?segmentSlug=...`, so
  // prefer the slug for the back link and only fall back to the segment UUID.
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
            <div className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6">
              <div className="flex items-center gap-5">
                <Skeleton variant="circular" className="h-20 w-20 shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-6 w-1/2" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6">
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="mt-3 h-16 w-full" />
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="mt-4 h-12 w-full" />
            <Skeleton className="mt-4 h-40 w-full" />
          </div>
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
          {/* ================= LEFT: profile, expertise, gig ================= */}
          <div className="min-w-0 space-y-6">
            {/* ---- Identity header ---- */}
            <section className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-xs">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                {mentorData.avatar_url ? (
                  <img
                    src={mentorData.avatar_url}
                    alt={`${mentorData.full_name} profile photo`}
                    className="h-20 w-20 shrink-0 rounded-full border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] object-cover sm:h-24 sm:w-24"
                  />
                ) : (
                  <div
                    role="img"
                    aria-label={`${mentorData.full_name} profile photo placeholder`}
                    className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] text-2xl font-bold text-[var(--color-shell-text-muted)] sm:h-24 sm:w-24"
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
                      <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-shell-success)]/30 bg-[var(--color-shell-success-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-shell-success)]">
                        <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        Verified
                      </span>
                    )}
                    {mentorData.is_featured && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-shell-warning)]/35 bg-[var(--color-shell-warning-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-shell-warning)]">
                        <Star className="h-3 w-3 fill-current" aria-hidden="true" />
                        Featured
                      </span>
                    )}
                  </div>

                  {mentorData.headline && (
                    <p className="mt-1.5 text-[15px] leading-snug text-[var(--color-shell-text-muted)]">
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
                  <ul className="mt-2.5 flex flex-wrap gap-2" aria-label="Expertise">
                    {mentorData.expertise.map((item) => (
                      <li
                        key={item}
                        className="rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-shell-text-muted)]"
                      >
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            {/* ---- Active gig ---- */}
            <section className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-shell-text-subtle)]">
                  Active session offer
                </h2>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-shell-text-muted)]">
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
                  <dd className="mt-1 text-[18px] font-bold leading-tight text-[var(--color-shell-text)]">
                    {gigPrice}
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
                    15 minutes
                  </dd>
                </div>
              </dl>
            </section>

              {/* ---- Availability summary ---- */}
            <section className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-xs">
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

          {/* ================= RIGHT: sticky booking panel ================= */}
          <div className="min-w-0 lg:sticky lg:top-20">
            <div className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-xs">
              <h2 className="font-display text-[17px] font-bold leading-tight text-[var(--color-shell-text)]">
                Book a session
              </h2>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-shell-text-muted)]">
                Times are shown in {mentorData.timezone}.
              </p>

              {/* ---- Date ---- */}
              <div className="mt-5">
                <label
                  htmlFor="session-date"
                  className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-shell-text-subtle)]"
                >
                  Session date
                </label>
                <div className="mt-2 flex items-center gap-2.5 rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] px-3.5 py-2.5 focus-within:border-[var(--color-shell-primary)]/60 focus-within:ring-2 focus-within:ring-[var(--color-shell-focus)]">
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

              {/* ---- Times ---- */}
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
                  // Never a fake slot: an explicit failure with a retry.
                  <div className="mt-2.5 rounded-xl border border-dashed border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] px-4 py-6 text-center">
                    <p className="text-[13px] font-medium text-[var(--color-shell-text-muted)]">
                      Unable to load availability.
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="mt-3"
                      onClick={() => reloadMentorSlots()}
                    >
                      Retry
                    </Button>
                  </div>
                ) : allSlots.length === 0 ? (
                  <div className="mt-2.5 rounded-xl border border-dashed border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] px-4 py-6 text-center">
                    <p className="text-[13px] font-medium text-[var(--color-shell-text)]">
                      No available slots for this date.
                    </p>
                    <p className="mt-1 text-[12px] text-[var(--color-shell-text-muted)]">
                      {mentorData.full_name} has no operating hours on this day.
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="mt-3"
                      onClick={() => focusDatePicker()}
                    >
                      Choose another date
                    </Button>
                  </div>
                ) : !hasSelectableSlot ? (
                  <div className="mt-2.5 rounded-xl border border-dashed border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] px-4 py-6 text-center">
                    <p className="text-[13px] font-medium text-[var(--color-shell-text)]">
                      All available times are currently booked.
                    </p>
                    <p className="mt-1 text-[12px] text-[var(--color-shell-text-muted)]">
                      The times below are shown for context and cannot be selected.
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="mt-3"
                      onClick={() => focusDatePicker()}
                    >
                      Choose another date
                    </Button>
                  </div>
                ) : null}

                {/* Only a real generated list is ever rendered — there is no
                    fallback, demo or default slot array anywhere on this page. */}
                {!isSlotsLoading && !slotsError && allSlots.length > 0 && (
                  <ul className="mt-2.5 grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1">
                    {allSlots.map((slot) => {
                      const isSelected = selectedSlot?.id === slot.id;
                      // Only AVAILABLE is selectable. HELD is not BOOKED and is
                      // never presented as bookable.
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
                              'flex w-full min-h-[52px] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl border px-2 py-2 text-center transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] focus-visible:ring-offset-2',
                              isSelected
                                ? 'border-[var(--color-shell-primary)] bg-[var(--color-shell-primary)] text-[var(--color-shell-text-contrast)]'
                                : isDisabled
                                  ? 'cursor-not-allowed border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-text-subtle)]'
                                  : 'border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] text-[var(--color-shell-text)] hover:border-[var(--color-shell-primary)]/50 hover:bg-[var(--color-shell-surface-elevated)]'
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
              {/* ---- Contextual error: only after a real failure ---- */}
              {bookingError && (
                <div
                  role="alert"
                  className="mt-5 flex items-start gap-2.5 rounded-xl border border-[var(--color-shell-error)]/30 bg-[var(--color-shell-error-soft)] p-3.5"
                >
                  <TriangleAlert
                    className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-shell-error)]"
                    aria-hidden="true"
                  />
                  <p className="text-[13px] leading-relaxed text-[var(--color-shell-error)]">
                    {bookingError}
                  </p>
                </div>
              )}

              {/* ---- Active hold ---- */}
              {activeHold && activeBooking ? (
                <div className="mt-5 rounded-xl border border-[var(--color-shell-success)]/35 bg-[var(--color-shell-success-soft)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-[var(--color-shell-text)]">
                      <Timer className="h-4 w-4 text-[var(--color-shell-success)]" aria-hidden="true" />
                      Slot held for you
                    </span>
                    <span className="rounded-lg border border-[var(--color-shell-success)]/30 bg-[var(--color-shell-surface)] px-2 py-1 font-mono text-[12px] font-semibold text-[var(--color-shell-text)]">
                      {formatCountdown(holdSecondsRemaining)}
                    </span>
                  </div>

                  <dl className="mt-3.5 space-y-2 border-t border-[var(--color-shell-success)]/20 pt-3.5 text-[13px]">
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-[var(--color-shell-text-muted)]">Booking code</dt>
                      <dd className="font-mono font-semibold text-[var(--color-shell-text)]">
                        {activeBooking.booking_code}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-[var(--color-shell-text-muted)]">Session time</dt>
                      <dd className="text-right font-semibold text-[var(--color-shell-text)]">
                        {selectedTimeLabel}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t border-[var(--color-shell-success)]/20 pt-2">
                      <dt className="font-semibold text-[var(--color-shell-text)]">Amount due</dt>
                      <dd className="text-[16px] font-bold text-[var(--color-shell-text)]">
                        {holdAmount}
                      </dd>
                    </div>
                  </dl>

                  <Button
                    onClick={() => navigate(`/seeker/payment?bookingId=${activeBooking.id}`)}
                    size="lg"
                    className="mt-4 w-full gap-2"
                  >
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    Continue to payment
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              ) : (
                <>
                  {/* ---- Summary ---- */}
                  <dl className="mt-5 space-y-2.5 border-t border-[var(--color-shell-border)] pt-5 text-[13px]">
                    <div className="flex items-start justify-between gap-3">
                      <dt className="text-[var(--color-shell-text-muted)]">Duration</dt>
                      <dd className="text-right font-medium text-[var(--color-shell-text)]">
                        {gig?.duration_minutes} minutes
                      </dd>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <dt className="text-[var(--color-shell-text-muted)]">Selected time</dt>
                      <dd className="text-right font-medium text-[var(--color-shell-text)]">
                        {selectedSlot ? (
                          <>
                            {selectedTimeLabel}
                            <span className="block text-[11px] font-normal text-[var(--color-shell-text-subtle)]">
                              {formatShortDate(selectedDate)} · {mentorData.timezone}
                            </span>
                          </>
                        ) : (
                          'Select an available time'
                        )}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t border-[var(--color-shell-border)] pt-3">
                      <dt className="text-[14px] font-semibold text-[var(--color-shell-text)]">
                        Total
                      </dt>
                      <dd className="text-[18px] font-bold text-[var(--color-shell-text)]">
                        {gigPrice}
                      </dd>
                    </div>
                  </dl>

                  <Button
                    onClick={handleReserveSlot}
                    disabled={!canReserve}
                    isLoading={isReserving}
                    loadingText="Reserving"
                    size="lg"
                    className="mt-5 w-full gap-2"
                  >
                    {!isReserving && <Lock className="h-4 w-4" aria-hidden="true" />}
                    <span>
                      {isReserving
                        ? 'Reserving slot'
                        : 'Reserve slot (15-min hold)'}
                    </span>
                    {!isReserving && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
                  </Button>

                  <p className="mt-2.5 text-center text-[11px] leading-relaxed text-[var(--color-shell-text-subtle)]">
                    Reserving locks this time in the database for 15 minutes while you complete
                    payment.
                  </p>
                  <p className="mt-1.5 text-center text-[11px] leading-relaxed text-[var(--color-shell-text-subtle)]">
                    Bookings are available until {BOOKING_CUTOFF_MINUTES} minutes before the
                    session.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default SeekerMentorDetailPage;
