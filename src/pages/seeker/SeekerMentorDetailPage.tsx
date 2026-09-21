import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Clock,
  Calendar,
  CheckCircle2,
  Shield,
  AlertTriangle,
  ArrowRight,
  Lock,
  Globe,
  Star,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import { fetchMentorDetail } from '@/src/lib/discoveryService';
import { createBookingWithHold, calculateRemainingHoldSeconds, formatCountdown } from '@/src/lib/bookingService';
import { DiscoverableMentor, GeneratedSlot, Booking, SlotHold } from '@/src/types/database';
import { formatLocalTimeLabel } from '@/src/lib/slotEngine';

export const SeekerMentorDetailPage: React.FC = () => {
  const { navigate, currentPath } = useNavigation();
  const { user } = useAuth();

  // Parse parameters from query string
  const searchParams = new URLSearchParams(
    currentPath.includes('?') ? currentPath.split('?')[1] : ''
  );
  const paramMentorId = searchParams.get('mentorId') || 'usr-mentor-rahul';
  const paramSegmentId = searchParams.get('segmentId') || 'seg-rel-01';
  const paramDate = searchParams.get('date') || new Date().toISOString().split('T')[0];

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

  // Function to reload mentor and availability slots
  const reloadMentorSlots = async () => {
    try {
      const { mentor } = await fetchMentorDetail(
        paramMentorId,
        paramSegmentId,
        selectedDate
      );
      if (mentor) {
        setMentorData(mentor);
      }
    } catch (e) {
      // Ignore background reload failure
    }
  };

  // Live 15-Minute Countdown Timer
  useEffect(() => {
    if (!activeHold || holdSecondsRemaining <= 0) return;

    const interval = setInterval(() => {
      setHoldSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setActiveHold(null);
          setBookingConflictError('Slot hold expired. The 15-minute reservation window has ended and the slot has been released.');
          reloadMentorSlots();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [activeHold, holdSecondsRemaining]);

  const handleReserveSlot = async () => {
    if (!selectedSlot || !mentorData) return;

    setIsReserving(true);
    setBookingConflictError(null);

    const seekerId = user?.id || 'usr-8801';

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
        // Refresh slots from server to reflect the newly taken slot
        await reloadMentorSlots();
        return;
      }

      // Success: Store active booking and hold
      setActiveBooking(result.booking);
      setActiveHold(result.hold);
      const remainingSec = calculateRemainingHoldSeconds(result.hold.expires_at) || 900;
      setHoldSecondsRemaining(remainingSec);

      // Refresh slot list to show updated state
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
          // Auto-select first available slot if present
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
    <div className="space-y-6">
      {/* Navigation breadcrumb */}
      <button
        onClick={() =>
          navigate(
            `/seeker/mentors?segmentId=${paramSegmentId}&date=${selectedDate}`
          )
        }
        className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        <span>Back to Mentors List</span>
      </button>

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-xl border border-zinc-200 bg-white p-6 space-y-4">
              <Skeleton className="h-20 w-20 rounded-full" />
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-32 w-full" />
            </div>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-6 space-y-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-32 w-full" />
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
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-start gap-5">
                <div className="h-20 w-20 rounded-full bg-zinc-100 border border-zinc-200 flex items-center justify-center font-bold text-2xl text-zinc-800 shrink-0">
                  {mentorData.full_name
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .toUpperCase() || 'M'}
                </div>
                <div className="space-y-1.5 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl font-bold text-zinc-950">
                      {mentorData.full_name}
                    </h1>
                    <Badge variant="success" className="text-xs">
                      Approved Mentor
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      {mentorData.segment.name}
                    </Badge>
                  </div>
                  <p className="text-xs font-medium text-zinc-500 flex items-center gap-1">
                    <Globe className="h-3.5 w-3.5 text-zinc-400" />
                    <span>Mentor Operating Timezone: {mentorData.timezone}</span>
                  </p>
                  <p className="text-xs text-zinc-700 max-w-xl leading-relaxed pt-1">
                    {mentorData.about || mentorData.headline}
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-2">
                    {mentorData.languages.map((lang) => (
                      <span
                        key={lang}
                        className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] bg-zinc-100 text-zinc-700"
                      >
                        {lang}
                      </span>
                    ))}
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] bg-zinc-100 text-zinc-700">
                      {mentorData.experience_years}+ Years Experience
                    </span>
                  </div>
                </div>
              </div>

              {/* Selected Active Gig Offer */}
              <div className="rounded-lg border border-zinc-100 bg-zinc-50/70 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Active Gig Offer
                  </span>
                  <Badge variant="secondary" className="text-[10px]">
                    Segment: {mentorData.segment.name}
                  </Badge>
                </div>
                <h3 className="text-base font-bold text-zinc-900">
                  {mentorData.gig.title}
                </h3>
                <p className="text-xs text-zinc-600 leading-relaxed">
                  {mentorData.gig.description}
                </p>
                <div className="flex items-center gap-6 pt-2 text-xs">
                  <div>
                    <span className="text-zinc-400 block text-[11px]">Session Length</span>
                    <span className="font-semibold text-zinc-900 flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-zinc-500" />{' '}
                      {mentorData.gig.duration_minutes} Minutes
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-400 block text-[11px]">Price</span>
                    <span className="font-bold text-zinc-950 text-sm">
                      ₹{mentorData.gig.price_inr} INR
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-400 block text-[11px]">Hold Window</span>
                    <span className="font-semibold text-amber-700 flex items-center gap-1">
                      <Lock className="h-3.5 w-3.5" /> 15 Min Lock
                    </span>
                  </div>
                </div>
              </div>

              {/* Global Mentor Availability Invariant Notice */}
              <div className="flex items-start gap-3 rounded-lg border border-blue-100 bg-blue-50/50 p-4 text-xs text-blue-900">
                <Shield className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">
                    Global Mentor Availability Invariant:
                  </span>
                  <p className="text-blue-800 mt-0.5 leading-relaxed">
                    Availability belongs to {mentorData.full_name}, not individual gigs. Any slot confirmed or held here is locked across all segments {mentorData.full_name} mentors on the platform.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Dynamic Slot Selection & Booking Summary */}
          <div className="space-y-6">
            <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-5 sticky top-20">
              <div>
                <h3 className="text-base font-bold text-zinc-950">Select Session Slot</h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Dynamic slots calculated in {mentorData.timezone} and verified in UTC.
                </p>
              </div>

              {/* Date Input */}
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  Date
                </label>
                <input
                  type="date"
                  value={selectedDate}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 focus:border-zinc-900 focus:outline-hidden"
                />
              </div>

              {/* Dynamic Slots Grid */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-zinc-700">
                    Slots on {selectedDate}
                  </label>
                  <span className="text-[11px] text-zinc-400">
                    {mentorData.available_slots.length} available
                  </span>
                </div>

                {mentorData.all_slots.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-4 text-center text-xs text-zinc-500">
                    No operating slots or mentor has leave on this date.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
                    {mentorData.all_slots.map((s) => {
                      const isSelected = selectedSlot?.id === s.id;
                      const timeLabel = `${formatLocalTimeLabel(
                        s.local_start_time
                      )} – ${formatLocalTimeLabel(s.local_end_time)}`;

                      return (
                        <button
                          key={s.id}
                          disabled={!s.is_available}
                          onClick={() => setSelectedSlot(s)}
                          className={`flex flex-col items-center justify-center p-2.5 rounded-lg border text-xs font-medium transition-all ${
                            s.status === 'PAST'
                              ? 'border-zinc-100 bg-zinc-50 text-zinc-300 cursor-not-allowed line-through'
                              : s.status === 'BOOKED'
                              ? 'border-zinc-100 bg-zinc-50 text-zinc-400 cursor-not-allowed'
                              : s.status === 'HELD'
                              ? 'border-amber-100 bg-amber-50/50 text-amber-700 cursor-not-allowed'
                              : isSelected
                              ? 'border-zinc-900 bg-zinc-900 text-white shadow-xs font-semibold'
                              : 'border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-zinc-50'
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
                <p className="text-[10px] text-zinc-400 pt-1">
                  * Calculated dynamically from recurring schedule & date exceptions.
                </p>
              </div>

              {/* Conflict / Error Banner */}
              {bookingConflictError && (
                <div className="rounded-lg border border-red-200 bg-red-50/80 p-3 text-xs text-red-700 flex items-start gap-2.5">
                  <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-semibold text-red-800">Booking Concurrency Alert</p>
                    <p>{bookingConflictError}</p>
                  </div>
                </div>
              )}

              {/* Active Hold State Display */}
              {activeHold && activeBooking ? (
                <div className="rounded-xl border-2 border-emerald-500/80 bg-emerald-50/40 p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-emerald-800 font-bold text-xs">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-600"></span>
                      </span>
                      <span>15-Minute Slot Hold Active</span>
                    </div>
                    <Badge variant="outline" className="border-emerald-300 text-emerald-800 bg-white font-mono text-[11px]">
                      {formatCountdown(holdSecondsRemaining)}
                    </Badge>
                  </div>

                  <div className="rounded-lg bg-white border border-emerald-200 p-3 space-y-1.5 text-xs">
                    <div className="flex justify-between text-zinc-600">
                      <span>Booking Code:</span>
                      <span className="font-mono font-bold text-zinc-900">{activeBooking.booking_code}</span>
                    </div>
                    <div className="flex justify-between text-zinc-600">
                      <span>Status:</span>
                      <Badge variant="warning" className="text-[10px] py-0">
                        {activeBooking.status}
                      </Badge>
                    </div>
                    <div className="flex justify-between text-zinc-600">
                      <span>Session Time:</span>
                      <span className="font-medium text-zinc-900">
                        {selectedSlot ? `${formatLocalTimeLabel(selectedSlot.local_start_time)} – ${formatLocalTimeLabel(selectedSlot.local_end_time)}` : ''}
                      </span>
                    </div>
                    <div className="flex justify-between text-zinc-900 font-bold pt-1 border-t border-zinc-100">
                      <span>Amount Payable:</span>
                      <span>₹{activeBooking.amount_inr} INR</span>
                    </div>
                  </div>

                  <p className="text-[11px] text-emerald-900 leading-relaxed">
                    This slot has been locked exclusively for you in the database. Complete payment within 15 minutes before the hold expires.
                  </p>

                  <Button
                    onClick={() => {
                      navigate(`/seeker/payments?bookingId=${activeBooking.id}`);
                    }}
                    className="w-full gap-2 text-xs bg-emerald-700 hover:bg-emerald-800 text-white"
                    size="md"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Proceed to Payment Proof Upload</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <>
                  {/* Booking Summary Box */}
                  <div className="border-t border-zinc-100 pt-4 space-y-2 text-xs">
                    <div className="flex justify-between text-zinc-600">
                      <span>Duration</span>
                      <span className="font-medium text-zinc-900">
                        {mentorData.gig.duration_minutes} minutes
                      </span>
                    </div>
                    <div className="flex justify-between text-zinc-600">
                      <span>Selected Time</span>
                      <span className="font-semibold text-zinc-900">
                        {selectedSlot
                          ? `${formatLocalTimeLabel(
                              selectedSlot.local_start_time
                            )} – ${formatLocalTimeLabel(
                              selectedSlot.local_end_time
                            )} (${mentorData.timezone})`
                          : 'Please select an available slot'}
                      </span>
                    </div>
                    <div className="flex justify-between text-zinc-900 text-sm font-bold pt-1 border-t border-zinc-100">
                      <span>Total Due</span>
                      <span>₹{mentorData.gig.price_inr} INR</span>
                    </div>
                  </div>

                  {/* Hold Action Button */}
                  <Button
                    disabled={!selectedSlot || !selectedSlot.is_available || isReserving}
                    onClick={handleReserveSlot}
                    className="w-full gap-2 text-xs"
                    size="md"
                  >
                    <Lock className="h-3.5 w-3.5" />
                    <span>
                      {isReserving ? 'Validating & Locking Slot...' : 'Reserve Slot (15-Min Hold)'}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                  <p className="text-[11px] text-center text-zinc-400">
                    Holding this slot locks it in PostgreSQL for 15 minutes.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
