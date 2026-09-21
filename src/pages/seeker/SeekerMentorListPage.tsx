import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Clock,
  Calendar,
  CheckCircle2,
  ChevronRight,
  User,
  Star,
  Globe,
  Sparkles,
  Shield,
} from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { Skeleton, SkeletonCard } from '@/src/components/ui/Skeleton';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { useNavigation } from '@/src/context/NavigationContext';
import {
  fetchActiveSegments,
  getHighestPriorityActiveSegment,
  fetchDiscoverableMentors,
} from '@/src/lib/discoveryService';
import { Segment, DiscoverableMentor } from '@/src/types/database';
import { formatLocalTimeLabel } from '@/src/lib/slotEngine';

export const SeekerMentorListPage: React.FC = () => {
  const { navigate, currentPath } = useNavigation();

  // Extract query parameters from currentPath
  const searchParams = new URLSearchParams(
    currentPath.includes('?') ? currentPath.split('?')[1] : ''
  );
  const paramSegmentId = searchParams.get('segmentId') || '';
  const paramDate = searchParams.get('date') || '';

  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return paramDate || new Date().toISOString().split('T')[0];
  });

  const [segments, setSegments] = useState<Segment[]>([]);
  const [selectedSegment, setSelectedSegment] = useState<Segment | null>(null);
  const [mentors, setMentors] = useState<DiscoverableMentor[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // 1. Fetch Segments
  useEffect(() => {
    let isMounted = true;
    async function load() {
      setIsLoading(true);
      try {
        const { segments: activeSegs } = await fetchActiveSegments();
        if (isMounted) {
          setSegments(activeSegs);

          // Find targeted segment by param or pick highest priority
          const matched =
            activeSegs.find((s) => s.id === paramSegmentId || s.slug === paramSegmentId) ||
            getHighestPriorityActiveSegment(activeSegs);
          setSelectedSegment(matched);
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [paramSegmentId]);

  // 2. Fetch Discoverable Mentors
  useEffect(() => {
    let isMounted = true;
    if (!selectedSegment) return;

    async function loadMentors() {
      setIsLoading(true);
      try {
        const { mentors: discMentors } = await fetchDiscoverableMentors(
          selectedSegment!.id,
          selectedDate
        );
        if (isMounted) {
          setMentors(discMentors);
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadMentors();
    return () => {
      isMounted = false;
    };
  }, [selectedSegment, selectedDate]);

  return (
    <div className="space-y-6">
      {/* Back to Discovery & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <button
            onClick={() => navigate('/seeker')}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-500 hover:text-zinc-950 transition-colors mb-2 rounded-md p-1 -ml-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to Discovery</span>
          </button>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl font-display">
            Mentors in {selectedSegment?.name || 'Selected Segment'}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Showing verified mentors with active gigs and valid bookable slots on <span className="font-mono font-medium text-zinc-700">{selectedDate}</span>.
          </p>
        </div>

        {/* Date Quick Selector */}
        <div className="flex items-center gap-2.5 bg-white p-2.5 rounded-xl border border-zinc-200 self-start text-xs shadow-2xs focus-within:ring-2 focus-within:ring-zinc-950 transition-all">
          <Calendar className="h-4 w-4 text-zinc-500 shrink-0" />
          <input
            type="date"
            value={selectedDate}
            min={new Date().toISOString().split('T')[0]}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="text-xs text-zinc-900 border-none bg-transparent focus:outline-none font-semibold cursor-pointer"
            aria-label="Filter by appointment date"
          />
        </div>
      </div>

      {/* Segment Selector Tabs */}
      {segments.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1.5 scrollbar-none" role="tablist" aria-label="Segments">
          {segments.map((seg) => {
            const isSelected = selectedSegment?.id === seg.id;
            return (
              <button
                key={seg.id}
                role="tab"
                aria-selected={isSelected}
                onClick={() => setSelectedSegment(seg)}
                className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap border cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 min-h-[38px] ${
                  isSelected
                    ? 'border-zinc-950 bg-zinc-950 text-white shadow-xs'
                    : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 hover:border-zinc-300'
                }`}
              >
                {seg.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Results Section */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl border border-zinc-200 bg-white p-6 space-y-4 shadow-2xs">
              <div className="flex items-start gap-4">
                <Skeleton variant="circular" width="4rem" height="4rem" />
                <div className="flex-1 space-y-2.5">
                  <Skeleton variant="rounded" width="35%" height="1.25rem" />
                  <Skeleton variant="rounded" width="25%" height="1rem" />
                  <Skeleton variant="rounded" width="75%" height="0.875rem" />
                </div>
              </div>
              <div className="flex justify-between items-center pt-3 border-t border-zinc-100">
                <Skeleton variant="rounded" width="6rem" height="1.25rem" />
                <Skeleton variant="rounded" width="8rem" height="2.25rem" />
              </div>
            </div>
          ))}
        </div>
      ) : mentors.length === 0 ? (
        <EmptyState
          title="No Available Mentors Found"
          description={`All mentors in ${
            selectedSegment?.name || 'this segment'
          } are fully booked, have date exceptions, or have no active gig on ${selectedDate}.`}
          actionLabel="Select Next Date"
          onAction={() => {
            const next = new Date(selectedDate);
            next.setDate(next.getDate() + 1);
            setSelectedDate(next.toISOString().split('T')[0]);
          }}
        />
      ) : (
        <motion.div
          initial="hidden"
          animate="show"
          variants={{
            hidden: { opacity: 0 },
            show: {
              opacity: 1,
              transition: { staggerChildren: 0.06 },
            },
          }}
          className="space-y-4"
        >
          {mentors.map((mentor) => (
            <motion.div
              key={mentor.id}
              variants={{
                hidden: { opacity: 0, y: 8 },
                show: { opacity: 1, y: 0, transition: { duration: 0.2 } },
              }}
              className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xs hover:shadow-xs transition-all hover:border-zinc-300 flex flex-col md:flex-row md:items-center justify-between gap-6"
            >
              <div className="flex items-start gap-4">
                <div className="h-16 w-16 rounded-2xl bg-zinc-100 border border-zinc-200 flex items-center justify-center font-bold text-lg text-zinc-900 shrink-0 font-display">
                  {mentor.full_name
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .toUpperCase() || 'M'}
                </div>
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-bold text-zinc-950">{mentor.full_name}</h2>
                    <Badge variant="secondary" className="text-[10px] font-semibold">
                      {mentor.segment.name}
                    </Badge>
                    <span className="flex items-center gap-1 text-[11px] text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded-md">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Approved Mentor
                    </span>
                  </div>

                  <p className="text-xs text-zinc-600 max-w-xl leading-relaxed">
                    {mentor.headline}
                  </p>

                  <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 pt-1">
                    <span className="font-semibold text-zinc-900">{mentor.gig.title}</span>
                    <span>·</span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-zinc-400" /> {mentor.gig.duration_minutes} mins
                    </span>
                    <span>·</span>
                    <span className="font-bold text-zinc-950 font-mono">₹{mentor.gig.price_inr} INR</span>
                    <span>·</span>
                    <span className="flex items-center gap-1 text-[11px] text-zinc-500">
                      <Globe className="h-3 w-3 text-zinc-400" /> {mentor.timezone}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row md:flex-col items-start sm:items-end justify-between gap-3 border-t md:border-t-0 pt-4 md:pt-0 border-zinc-100 shrink-0">
                <div className="text-left sm:text-right">
                  <span className="text-[11px] text-zinc-400 block font-medium">Next Available Slot</span>
                  <span className="text-xs font-semibold text-emerald-700 flex items-center gap-1 justify-start sm:justify-end">
                    <Sparkles className="h-3 w-3" />
                    {mentor.next_available_slot
                      ? formatLocalTimeLabel(mentor.next_available_slot.local_start_time)
                      : 'Slots Available'}
                  </span>
                </div>
                <Button
                  onClick={() =>
                    navigate(
                      `/seeker/mentor-detail?mentorId=${mentor.id}&segmentId=${
                        selectedSegment?.id || mentor.segment.id
                      }&date=${selectedDate}`
                    )
                  }
                  size="sm"
                  className="w-full sm:w-auto gap-1.5 text-xs shadow-2xs font-semibold"
                >
                  <span>Select Slot</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Notice on Real Availability Engine */}
      <div className="flex items-start gap-3 rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4 text-xs text-zinc-600">
        <Shield className="h-4 w-4 text-zinc-600 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold text-zinc-950">
            Global Mentor Invariant:
          </span>
          <p className="mt-0.5 leading-relaxed text-zinc-600">
            Mentor availability is attached globally to the mentor, not to an individual gig. Bookings across all segments are reconciled in UTC to ensure no concurrent double-bookings can occur.
          </p>
        </div>
      </div>
    </div>
  );
};

