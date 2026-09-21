import React, { useState, useEffect } from 'react';
import {
  Compass,
  Calendar as CalendarIcon,
  ArrowRight,
  Clock,
  ShieldCheck,
  Sparkles,
  AlertCircle,
  Star,
  Globe,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { useNavigation } from '@/src/context/NavigationContext';
import {
  fetchActiveSegments,
  getHighestPriorityActiveSegment,
  fetchDiscoverableMentors,
} from '@/src/lib/discoveryService';
import { Segment, DiscoverableMentor } from '@/src/types/database';
import { formatLocalTimeLabel } from '@/src/lib/slotEngine';

export const SeekerHomePage: React.FC = () => {
  const { navigate, currentPath } = useNavigation();

  // Date selection: default to today (YYYY-MM-DD)
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });

  const [segments, setSegments] = useState<Segment[]>([]);
  const [selectedSegment, setSelectedSegment] = useState<Segment | null>(null);
  const [mentors, setMentors] = useState<DiscoverableMentor[]>([]);
  const [isLoadingSegments, setIsLoadingSegments] = useState<boolean>(true);
  const [isLoadingMentors, setIsLoadingMentors] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // 1. Initial Load: Fetch active segments and select highest-priority segment
  useEffect(() => {
    let isMounted = true;
    async function loadSegments() {
      setIsLoadingSegments(true);
      setError(null);
      try {
        const { segments: activeSegs, error: segErr } = await fetchActiveSegments();
        if (segErr) throw segErr;
        if (isMounted) {
          setSegments(activeSegs);
          // Auto-select highest-priority active segment
          const topSegment = getHighestPriorityActiveSegment(activeSegs);
          setSelectedSegment(topSegment);
        }
      } catch (err: any) {
        if (isMounted) {
          console.error('Error loading segments:', err);
          setError(err.message || 'Failed to load mentorship segments');
        }
      } finally {
        if (isMounted) setIsLoadingSegments(false);
      }
    }

    loadSegments();
    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Query discoverable mentors whenever selectedSegment or selectedDate changes
  useEffect(() => {
    let isMounted = true;
    if (!selectedSegment) {
      setMentors([]);
      return;
    }

    async function loadMentors() {
      setIsLoadingMentors(true);
      try {
        const { mentors: discMentors, error: mentorErr } = await fetchDiscoverableMentors(
          selectedSegment!.id,
          selectedDate
        );
        if (mentorErr) throw mentorErr;
        if (isMounted) {
          setMentors(discMentors);
        }
      } catch (err: any) {
        if (isMounted) {
          console.error('Error loading mentors:', err);
        }
      } finally {
        if (isMounted) setIsLoadingMentors(false);
      }
    }

    loadMentors();
    return () => {
      isMounted = false;
    };
  }, [selectedSegment, selectedDate]);

  return (
    <div className="space-y-8">
      {/* Platform Invariant Header */}
      <div className="space-y-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-700">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
          <span>Real-Time Supabase Discovery · Concurrency-Safe Booking</span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-950 sm:text-4xl">
          Find Your Mentor & Book 1:1 Guidance
        </h1>
        <p className="max-w-2xl text-base text-zinc-600 leading-relaxed">
          Select a verified segment and date. All slots are dynamically calculated in the mentor's timezone, validated against UTC invariants, and filtered for booking conflicts.
        </p>
      </div>

      {/* Discovery Filters: Segments + Date Picker */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs space-y-5">
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Mentorship Segment
            </label>
            <span className="text-[11px] text-zinc-400">
              Highest-priority active segment auto-selected
            </span>
          </div>

          {isLoadingSegments ? (
            <div className="flex gap-2">
              <Skeleton className="h-10 w-44 rounded-lg" />
              <Skeleton className="h-10 w-36 rounded-lg" />
              <Skeleton className="h-10 w-36 rounded-lg" />
            </div>
          ) : segments.length === 0 ? (
            <div className="text-xs text-zinc-500 italic">No active segments found.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {segments.map((seg) => {
                const isSelected = selectedSegment?.id === seg.id;
                const isHighest = seg.priority === 1;

                return (
                  <button
                    key={seg.id}
                    onClick={() => setSelectedSegment(seg)}
                    className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-all ${
                      isSelected
                        ? 'border-zinc-950 bg-zinc-950 text-white shadow-xs'
                        : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50'
                    }`}
                  >
                    <span>{seg.name}</span>
                    {isHighest && (
                      <Badge
                        variant="secondary"
                        className={
                          isSelected
                            ? 'bg-zinc-800 text-zinc-200 text-[10px] py-0 px-1.5'
                            : 'bg-zinc-100 text-zinc-700 text-[10px] py-0 px-1.5'
                        }
                      >
                        Priority {seg.priority}
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-4 border-t border-zinc-100">
          <div>
            <label className="block text-xs font-medium text-zinc-700 mb-1.5">
              Select Session Date
            </label>
            <div className="relative">
              <input
                type="date"
                value={selectedDate}
                min={new Date().toISOString().split('T')[0]}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-hidden focus:ring-1 focus:ring-zinc-900"
              />
            </div>
            <p className="mt-1 text-[11px] text-zinc-500">
              Past intervals are disabled per server UTC rules.
            </p>
          </div>

          <div className="flex items-end">
            <Button
              onClick={() =>
                navigate(
                  `/seeker/mentors?segmentId=${selectedSegment?.id || ''}&date=${selectedDate}`
                )
              }
              className="w-full gap-2 text-sm"
              size="md"
              disabled={!selectedSegment}
            >
              <span>View All Segment Mentors</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Discovery Content Area: Real Mentors */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900">
            Available Mentors on {selectedDate}
          </h2>
          <span className="text-xs text-zinc-500">
            {mentors.length} discoverable {mentors.length === 1 ? 'mentor' : 'mentors'} with valid slots
          </span>
        </div>

        {isLoadingMentors ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {[1, 2].map((i) => (
              <div key={i} className="rounded-xl border border-zinc-200 bg-white p-6 space-y-4">
                <div className="flex items-center gap-4">
                  <Skeleton className="h-14 w-14 rounded-full" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-5 w-1/2" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
                <Skeleton className="h-12 w-full" />
                <div className="flex justify-between items-center pt-2">
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-9 w-28" />
                </div>
              </div>
            ))}
          </div>
        ) : mentors.length === 0 ? (
          <EmptyState
            icon={Compass}
            title="No Available Mentors On This Date"
            description={`No approved mentors in ${
              selectedSegment?.name || 'this segment'
            } have open bookable slots on ${selectedDate}. Mentors with 0 valid slots are excluded to prevent dead ends.`}
            actionLabel="Try Tomorrow"
            onAction={() => {
              const tomorrow = new Date();
              tomorrow.setDate(tomorrow.getDate() + 1);
              setSelectedDate(tomorrow.toISOString().split('T')[0]);
            }}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {mentors.map((mentor) => (
              <div
                key={mentor.id}
                className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs flex flex-col justify-between transition-all hover:border-zinc-300"
              >
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3.5">
                      <div className="h-12 w-12 rounded-full bg-zinc-100 border border-zinc-200 flex items-center justify-center font-bold text-zinc-700 shrink-0">
                        {mentor.full_name
                          .split(' ')
                          .map((n) => n[0])
                          .join('')
                          .toUpperCase() || 'M'}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h3 className="font-semibold text-zinc-950 text-base">
                            {mentor.full_name}
                          </h3>
                          <Badge variant="success" className="text-[10px] py-0 px-1">
                            Approved
                          </Badge>
                        </div>
                        <p className="text-xs text-zinc-500 line-clamp-1">
                          {mentor.headline}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-zinc-900">
                        {mentor.gig.title}
                      </h4>
                      <Badge variant="secondary" className="text-[10px]">
                        {mentor.experience_years}+ Yrs
                      </Badge>
                    </div>
                    <p className="text-xs text-zinc-600 mt-1 line-clamp-2 leading-relaxed">
                      {mentor.gig.description}
                    </p>
                  </div>

                  <div className="flex items-center justify-between text-xs text-zinc-500 border-t border-zinc-100 pt-3">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-zinc-400" />
                        {mentor.gig.duration_minutes} mins
                      </span>
                      <span>·</span>
                      <span className="font-bold text-zinc-950 text-sm">
                        ₹{mentor.gig.price_inr} INR
                      </span>
                    </div>

                    <div className="flex items-center gap-1 text-[11px] text-zinc-500">
                      <Globe className="h-3 w-3 text-zinc-400" />
                      <span>{mentor.timezone}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-zinc-100 pt-4">
                  <span className="text-xs text-emerald-700 font-medium flex items-center gap-1">
                    <Sparkles className="h-3.5 w-3.5" />
                    Next:{' '}
                    {mentor.next_available_slot
                      ? formatLocalTimeLabel(mentor.next_available_slot.local_start_time)
                      : 'Slots Available'}
                  </span>
                  <Button
                    onClick={() =>
                      navigate(
                        `/seeker/mentor-detail?mentorId=${mentor.id}&segmentId=${
                          selectedSegment?.id || mentor.segment.id
                        }&date=${selectedDate}`
                      )
                    }
                    size="sm"
                    className="gap-1 text-xs"
                  >
                    <span>View Slots & Book</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Discovery Architecture & Business Invariant Notice */}
      <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-5 space-y-2 text-xs text-zinc-600">
        <div className="flex items-center gap-2 font-semibold text-zinc-900">
          <ShieldCheck className="h-4 w-4 text-zinc-700" />
          <span>Phase 5 Architecture: Discoverability Invariants Enforced</span>
        </div>
        <p className="leading-relaxed">
          A mentor is discoverable only when: (1) Approved in <code className="text-zinc-800">mentor_profiles</code>; (2) Belongs to selected segment; (3) Has an active gig for that segment; (4) Has at least <strong>1 valid unbooked, non-held slot</strong> on the selected calendar date. Time intervals are converted to authoritative UTC and checked against global mentor bookings across all segments.
        </p>
      </div>
    </div>
  );
};
