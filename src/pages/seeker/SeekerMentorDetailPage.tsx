import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  Clock,
  CheckCircle2,
  Shield,
  AlertTriangle,
  Globe,
  Star,
  ArrowRight,
  Lock,
  Calendar,
} from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import { fetchMentorDetail } from '@/src/lib/discoveryService';
import { createBookingWithHold, calculateRemainingHoldSeconds, formatCountdown } from '@/src/lib/bookingService';
import { DiscoverableMentor, GeneratedSlot, Booking, SlotHold } from '@/src/types/database';
import { formatLocalTimeLabel, formatDate } from '@/src/lib/slotEngine';

export const SeekerMentorDetailPage: React.FC = () => {
  const { navigate, currentPath } = useNavigation();
  const { user } = useAuth();

  const searchParams = new URLSearchParams(
    currentPath.includes('?') ? currentPath.split('?')[1] : ''
  );
  const paramMentorId = searchParams.get('mentorId') || '';
  const paramSegmentId = searchParams.get('segmentId') || '';
  const paramDate = searchParams.get('date') || new Date().toISOString().split('T')[0];
  const hasRequiredParams = Boolean(paramMentorId && paramSegmentId);

  const [selectedDate, setSelectedDate] = useState<string>(paramDate);
  const [mentorData, setMentorData] = useState<DiscoverableMentor | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<GeneratedSlot | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [isReserving, setIsReserving] = useState<boolean>(false);
  const [activeBooking, setActiveBooking] = useState<Booking | null>(null);
  const [activeHold, setActiveHold] = useState<SlotHold | null>(null);
  const [holdSecondsRemaining, setHoldSecondsRemaining] = useState<number>(0);
  const [bookingConflictError, setBookingConflictError] = useState<string | null>(null);

  const reloadMentorSlots = useCallback(async () => {
    try {
      const { mentor } = await fetchMentorDetail(
        paramMentorId,
        paramSegmentId,
        selectedDate
      );
      if (mentor) {
        setMentorData(mentor);
        if (selectedSlot && !mentor.all_slots.find((s) => s.id === selectedSlot.id)) {
          setSelectedSlot(null);
        }
      }
    } catch (e) {
      // Ignore background reload failure
    }
  }, [paramMentorId, paramSegmentId, selectedDate, selectedSlot]);

  // Live 15-Minute Countdown Timer
  useEffect(() => {
    if (!activeHold || holdSecondsRemaining <= 0) return;

    const interval = setInterval(() => {
      setHoldSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setActiveHold(null);
          setBookingConflictError(
            'Slot hold expired. The 15-minute reservation window has ended and the slot has been released.'
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
    const seekerId = user?.id;
    if (!seekerId) return;

    setIsReserving(true);
    setBookingConflictError(null);

    try {
      const result = await createBookingWithHold({
        seekerId,
        mentorId: mentorData.id,
        segmentId: mentorData.segment.id,
        gigId: mentorData.gig.id,
        startTime: selectedSlot.utc_start_time,
        endTime: selectedSlot.utc_end_time,
      });

      if (!result.success || !result.booking || !result.hold) {
        setBookingConflictError(
          result.error?.message || 'Failed to acquire slot hold. Please try selecting a different slot.'
        );
        await reloadMentorSlots();
        return;
      }

      setActiveBooking(result.booking);
      setActiveHold(result.hold);
      const remainingSec = calculateRemainingHoldSeconds(result.hold.expires_at) || 900;
      setHoldSecondsRemaining(remainingSec);
      await reloadMentorSlots();
    } catch (err: any) {
      setBookingConflictError(err.message || 'An unexpected error occurred while locking the slot.');
      await reloadMentorSlots();
    } finally {
      setIsReserving(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    async function load() {
      if (!hasRequiredParams) {
        setIsLoading(false);
        setError('Select a mentor and segment to view availability.');
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        const { mentor, error: err } = await fetchMentorDetail(
          paramMentorId,
          paramSegmentId,
          selectedDate
        );
        if (err) throw err;
        if (isMounted) {
          setMentorData(mentor);
          if (mentor && mentor.available_slots.length > 0) {
            setSelectedSlot(mentor.available_slots[0]);
          } else {
            setSelectedSlot(null);
          }
        }
      } catch (e: any) {
        if (isMounted) {
          setError(e.message || 'Failed to load mentor details');
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [paramMentorId, paramSegmentId, selectedDate]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.23, 1, 0.31, 1] }}
      className="space-y-6"
    >
      {/* Navigation breadcrumb */}
      <motion.button
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3 }}
        onClick={() =>
          navigate(
            `/seeker/mentors?segmentId=${paramSegmentId}&date=${selectedDate}`
          )
        }
        className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)] transition-colors rounded-md p-1 -ml-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-accent)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        <span>Back to Mentors List</span>
      </motion.button>

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 space-y-4 shadow-xs">
              <div className="flex items-start gap-5">
                <Skeleton variant="circular" className="h-20 w-20" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-6 w-1/2" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-16 w-full mt-2" />
                </div>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-xs space-y-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </div>
      ) : !mentorData ? (
        <EmptyState
          title="Mentor Not Found"
          description="Could not find mentor profile or active gig for the selected segment."
          actionLabel="Back to Mentors"
          onAction={() => navigate('/seeker/mentors')}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column: Mentor Profile & Active Gig Information */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.05 }}
            className="lg:col-span-2 space-y-6"
          >
            <div className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-xs space-y-6">
              <div className="flex items-start gap-5">
                {mentorData.avatar_url ? (
                  <img
                    src={mentorData.avatar_url}
                    alt={mentorData.full_name}
                    className="h-20 w-20 rounded-full object-cover border border-[var(--color-shell-border)] shrink-0"
                  />
                ) : (
                  <div className="h-20 w-20 rounded-full bg-zinc-100 border border-[var(--color-shell-border)] flex items-center justify-center font-bold text-xl text-[var(--color-shell-text-muted)] font-display shrink-0">
                    {mentorData.full_name
                      .split(' ')
                      .map((n) => n[0])
                      .join('')
                      .toUpperCase() || 'M'}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-xl font-bold text-[var(--color-shell-text)]">
                      {mentorData.full_name}
                    </h1>
                    {mentorData.is_featured && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] gap-0.5 bg-[var(--color-shell-warning-soft)] text-[var(--color-shell-warning)] border-[var(--color-shell-warning)]/30"
                      >
                        <Star className="h-3 w-3 fill-current" />
                        Featured
                      </Badge>
                    )}
                    {mentorData.is_approved && (
                      <Badge variant="success" className="text-[10px]">
                        Verified
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-[var(--color-shell-text-muted)] mt-1">{mentorData.headline}</p>
                </div>
              </div>

              {/* Timezone Info */}
              <div className="flex items-center gap-2 text-xs text-[var(--color-shell-text-muted)]">
                <Globe className="h-4 w-4 text-[var(--color-shell-text-subtle)]" />
                <span>Mentor Operating Timezone:</span>
                <span className="font-medium text-[var(--color-shell-text)]">{mentorData.timezone}</span>
              </div>

              {/* About */}
              {mentorData.about && (
                <p className="text-xs text-[var(--color-shell-text-muted)] leading-relaxed">
                  {mentorData.about}
                </p>
              )}

              {/* Languages & Experience */}
              <div className="flex flex-wrap gap-2">
                {mentorData.languages.map((lang) => (
                  <span
                    key={lang}
                    className="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-text-muted)] border border-[var(--color-shell-border)]"
                  >
                    {lang}
                  </span>
                ))}
                <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-text-muted)] border border-[var(--color-shell-border)] font-medium">
                  {mentorData.experience_years}+ Years Experience
                </span>
              </div>

              {/* Selected Active Gig Offer */}
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.1 }}
                className="rounded-2xl border border-[var(--color-shell-warning)]/30 bg-[var(--color-shell-warning-soft)]/30 p-5 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-shell-warning)]">
                    Active Gig Offer
                  </span>
                  <Badge variant="secondary" className="text-[10px] border-[var(--color-shell-warning)]/30 bg-[var(--color-shell-warning-soft)] text-[var(--color-shell-text)]">
                    Segment: {mentorData.segment.name}
                  </Badge>
                </div>
                <h3 className="text-lg font-bold text-[var(--color-shell-text)]">
                  {mentorData.gig.title}
                </h3>
                <p className="text-xs text-[var(--color-shell-text-muted)] leading-relaxed">
                  {mentorData.gig.description}
                </p>
                <div className="flex items-center gap-6 pt-2 text-xs">
                  <div>
                    <span className="text-[var(--color-shell-text-subtle)] block text-[11px]">Session Length</span>
                    <span className="font-semibold text-[var(--color-shell-text)] flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-[var(--color-shell-text-muted)]" />{' '}
                      {mentorData.gig.duration_minutes} Minutes
                    </span>
                  </div>
                  <div>
                    <span className="text-[var(--color-shell-text-subtle)] block text-[11px]">Price</span>
                    <span className="font-bold text-[var(--color-shell-text)] text-sm">
                      ?{mentorData.gig.price_inr} INR
                    </span>
                  </div>
                  <div>
                    <span className="text-[var(--color-shell-text-subtle)] block text-[11px]">Hold Window</span>
                    <span className="font-semibold text-[var(--color-shell-warning)] flex items-center gap-1">
                      <Lock className="h-3.5 w-3.5" /> 15 Min Lock
                    </span>
                  </div>
                </div>
              </motion.div>

              {/* Global Mentor Availability Invariant Notice */}
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.15 }}
                className="flex items-start gap-3 rounded-2xl border border-blue-100 bg-blue-50/50 p-4 text-xs text-blue-900"
              >
                <Shield className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">
                    Global Mentor Availability Invariant:
                  </span>
                  <p className="text-blue-800 mt-0.5 leading-relaxed">
                    Availability belongs to {mentorData.full_name}, not individual gigs. Any slot
                    confirmed or held here is locked across all segments {mentorData.full_name}{' '}
                    mentors on the platform.
                  </p>
                </div>
              </motion.div>
            </div>
          </motion.div>

          {/* Right Column: Dynamic Slot Selection & Booking Summary */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.08 }}
            className="space-y-6"
          >
            <div className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-xs space-y-5 sticky top-20">
              <div>
                <h3 className="text-base font-bold text-[var(--color-shell-text)]">Select Session Slot</h3>
                <p className="text-xs text-[var(--color-shell-text-muted)] mt-0.5">
                  Dynamic slots calculated in {mentorData.timezone} and verified in UTC.
                </p>
              </div>

              {/* Date Input */}
              <div>
                <label className="block text-xs font-medium text-[var(--color-shell-text-muted)] mb-1.5">
                  Session Date
                </label>
                <div className="flex items-center gap-2 bg-[var(--color-shell-surface)] rounded-xl border border-[var(--color-shell-border)] px-3 py-2.5 shadow-xs">
                  <Calendar className="h-4 w-4 text-[var(--color-shell-text-subtle)]" />
                  <input
                    type="date"
                    value={selectedDate}
                    min={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="text-xs text-[var(--color-shell-text)] border-none bg-transparent focus:outline-none font-semibold cursor-pointer w-full"
                    aria-label="Select session date"
                  />
                </div>
              </div>

              {/* Dynamic Slots Grid */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-[var(--color-shell-text-muted)]">
                    Slots on {formatDate(selectedDate)}
                  </label>
                  <span className="text-[11px] text-[var(--color-shell-text-subtle)]">
                    {mentorData.available_slots.length} available
                  </span>
                </div>

                {mentorData.all_slots.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] p-4 text-center text-xs text-[var(--color-shell-text-muted)]">
                    No operating slots or mentor has leave on this date.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
                    {mentorData.all_slots.map((s) => {
                      const isSelected = selectedSlot?.id === s.id;
                      const timeLabel = `${formatLocalTimeLabel(
                        s.local_start_time
                      )} � ${formatLocalTimeLabel(s.local_end_time)}`;

                      return (
                        <button
                          key={s.id}
                          disabled={!s.is_available}
                          onClick={() => setSelectedSlot(s)}
                          className={`flex flex-col items-center justify-center p-2.5 rounded-lg border text-xs font-medium transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-accent)] ${
                            s.status === 'PAST'
                              ? 'border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] text-zinc-300 cursor-not-allowed line-through'
                              : s.status === 'BOOKED'
                              ? 'border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-text-subtle)] cursor-not-allowed'
                              : s.status === 'HELD'
                              ? 'border-[var(--color-shell-warning)]/20 bg-[var(--color-shell-warning-soft)]/50 text-[var(--color-shell-warning)] cursor-not-allowed'
                              : isSelected
                              ? 'border-amber-600 bg-[var(--color-shell-warning-soft)] text-[var(--color-shell-text)] shadow-xs'
                              : 'border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] text-[var(--color-shell-text)] hover:border-[var(--color-shell-border-strong)] hover:bg-[var(--color-shell-surface-elevated)]'
                          }`}
                        >
                          <span className="font-semibold text-[11px]">{timeLabel}</span>
                          <span className="text-[9px] opacity-80 mt-0.5">
                            {s.status === 'PAST'
                              ? 'Past Slot'
                              : s.status === 'BOOKED'
                              ? 'Booked'
                              : s.status === 'HELD'
                              ? 'On Hold'
                              : 'Available'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="text-[10px] text-[var(--color-shell-text-subtle)] pt-1">
                  * Calculated dynamically from recurring schedule & date exceptions.
                </p>
              </div>

              {/* Conflict / Error Banner */}
              {bookingConflictError && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl border border-[var(--color-shell-error)]/30 bg-[var(--color-shell-error-soft)]/80 p-3 text-xs text-[var(--color-shell-error)] flex items-start gap-2.5"
                >
                  <AlertTriangle className="h-4 w-4 text-[var(--color-shell-error)] shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-semibold text-[var(--color-shell-text)]">Booking Concurrency Alert</p>
                    <p>{bookingConflictError}</p>
                  </div>
                </motion.div>
              )}

              {/* Active Hold State Display */}
              {activeHold && activeBooking ? (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-2xl border-2 border-emerald-500/80 bg-emerald-50/40 p-4 space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-emerald-800 font-bold text-xs">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-600"></span>
                      </span>
                      <span>15-Minute Slot Hold Active</span>
                    </div>
                    <Badge variant="outline" className="border-emerald-300 text-emerald-800 bg-[var(--color-shell-surface)] font-mono text-[11px]">
                      {formatCountdown(holdSecondsRemaining)}
                    </Badge>
                  </div>

                  <div className="rounded-lg bg-[var(--color-shell-surface)] border border-emerald-200 p-3 space-y-1.5 text-xs">
                    <div className="flex justify-between text-[var(--color-shell-text-muted)]">
                      <span>Booking Code:</span>
                      <span className="font-mono font-bold text-[var(--color-shell-text)]">
                        {activeBooking.booking_code}
                      </span>
                    </div>
                    <div className="flex justify-between text-[var(--color-shell-text-muted)]">
                      <span>Status:</span>
                      <Badge variant="warning" className="text-[10px] py-0">
                        {activeBooking.status}
                      </Badge>
                    </div>
                    <div className="flex justify-between text-[var(--color-shell-text-muted)]">
                      <span>Session Time:</span>
                      <span className="font-medium text-[var(--color-shell-text)]">
                        {selectedSlot
                          ? `${formatLocalTimeLabel(selectedSlot.local_start_time)} � ${formatLocalTimeLabel(
                              selectedSlot.local_end_time
                            )}`
                          : ''}
                      </span>
                    </div>
                    <div className="flex justify-between text-[var(--color-shell-text)] font-bold pt-1 border-t border-[var(--color-shell-border)]">
                      <span>Amount Payable:</span>
                      <span>?{activeBooking.amount_inr} INR</span>
                    </div>
                  </div>

                  <p className="text-[11px] text-emerald-900 leading-relaxed">
                    This slot has been locked exclusively for you in the database. Complete
                    payment within 15 minutes before the hold expires.
                  </p>

                  <Button
                    onClick={() => {
                      navigate(`/seeker/payment?bookingId=${activeBooking.id}`);
                    }}
                    className="w-full gap-2 text-xs bg-emerald-700 hover:bg-emerald-800 text-white font-semibold"
                    size="md"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Proceed to Payment Proof Upload</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </motion.div>
              ) : (
                <>
                  {/* Booking Summary Box */}
                  <div className="border-t border-[var(--color-shell-border)] pt-4 space-y-2 text-xs">
                    <div className="flex justify-between text-[var(--color-shell-text-muted)]">
                      <span>Duration</span>
                      <span className="font-medium text-[var(--color-shell-text)]">
                        {mentorData.gig.duration_minutes} minutes
                      </span>
                    </div>
                    <div className="flex justify-between text-[var(--color-shell-text-muted)]">
                      <span>Selected Time</span>
                      <span className="font-semibold text-[var(--color-shell-text)]">
                        {selectedSlot
                          ? `${formatLocalTimeLabel(selectedSlot.local_start_time)} � ${formatLocalTimeLabel(
                              selectedSlot.local_end_time
                            )} (${mentorData.timezone})`
                          : 'Please select an available slot'}
                      </span>
                    </div>
                    <div className="flex justify-between text-[var(--color-shell-text)] text-sm font-bold pt-1 border-t border-[var(--color-shell-border)]">
                      <span>Total Due</span>
                      <span>?{mentorData.gig.price_inr} INR</span>
                    </div>
                  </div>

                  {/* Hold Action Button */}
                  <Button
                    disabled={!selectedSlot || !selectedSlot.is_available || isReserving}
                    onClick={handleReserveSlot}
                    className="w-full gap-2 text-xs font-semibold"
                    size="md"
                  >
                    <Lock className="h-3.5 w-3.5" />
                    <span>
                      {isReserving ? 'Validating & Locking Slot...' : 'Reserve Slot (15-Min Hold)'}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                  <p className="text-[11px] text-center text-[var(--color-shell-text-subtle)]">
                    Holding this slot locks it in PostgreSQL for 15 minutes.
                  </p>
                </>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
};

export default SeekerMentorDetailPage;
