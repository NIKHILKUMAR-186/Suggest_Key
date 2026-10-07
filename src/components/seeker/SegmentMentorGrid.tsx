/**
 * The segment mentor marketplace.
 *
 * Fed entirely by the topic-filtered API through `useSegmentMentorsByTopic`.
 * There is no local filtering, no `.slice(0, n)` sampling and no synthetic
 * card: what renders is exactly the list the database returned for the
 * current segment and topic.
 *
 * Cards navigate through the existing mentor-detail route, so booking,
 * availability, holds and payment are untouched by anything in this file.
 */

import React from 'react';
import { AlertCircle, Compass, Users } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { SegmentMentorCard } from '@/src/components/seeker/SegmentMentorCard';
import type { SegmentTopicView, TopicMentor } from '@/src/lib/segmentTopics';
import { ALL_TOPICS } from '@/src/lib/segmentTopics';
import { mentorListPath } from '@/src/lib/mentorNav';
import { cn } from '@/src/lib/utils';

export const SEGMENT_MENTOR_GRID_CLASS =
  'grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 xl:grid-cols-4';

/**
 * Adaptive grid layout based on how many mentors the API returned:
 *  - 1 mentor  → a single wider featured card, centered on the page.
 *  - 2-3 mentors → a balanced grid (up to 3 columns).
 *  - 4+ mentors → the full responsive marketplace grid.
 */
function mentorGridClass(count: number): string {
  if (count === 1) return 'grid grid-cols-1 gap-6';
  if (count <= 3) return 'grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3';
  return SEGMENT_MENTOR_GRID_CLASS;
}

const SKELETON_COUNT = 4;

export interface SegmentMentorGridProps {
  mentors: TopicMentor[];
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  /** The topic currently selected, used only to word the empty state. */
  selectedTopicSlug: string;
  segmentName: string | null;
  segmentSlug: string | null;
  /** The landing page's date scope, forwarded so Back restores it. */
  selectedDate?: string | null;
  navigate: (path: string) => void;
  className?: string;
}

const CardSkeleton: React.FC = () => (
  <div className="sk-mentor-card flex flex-col overflow-hidden" aria-hidden="true">
    <div className="aspect-[4/5] w-full overflow-hidden bg-gradient-to-br from-[var(--segment-accent-soft)] to-[color-mix(in_srgb,var(--segment-accent)_8%,transparent)]" />
    <div className="sk-mentor-card-body">
      <Skeleton className="h-6 w-3/5" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-3 w-1/2" />
      <div className="mt-2 flex items-center gap-2">
        <Skeleton variant="circular" className="h-3.5 w-3.5" />
        <Skeleton className="h-3 w-10" />
        <Skeleton className="h-3 w-14" />
      </div>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/5" />
      <div className="mt-2 space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <Skeleton className="h-4 w-1/3" />
      <div className="mt-2 flex flex-wrap gap-2">
        <Skeleton className="h-9 w-24 rounded-full" />
        <Skeleton className="h-9 w-24 rounded-full" />
        <Skeleton className="h-9 w-24 rounded-full" />
      </div>
      <div className="flex flex-col gap-2 pt-2 sm:flex-row">
        <Skeleton className="h-10 flex-1 rounded-lg" />
        <Skeleton className="h-10 flex-1 rounded-lg" />
      </div>
    </div>
  </div>
);

export const SegmentMentorGrid: React.FC<SegmentMentorGridProps> = ({
  mentors,
  isLoading,
  error,
  onRetry,
  selectedTopicSlug,
  segmentName,
  segmentSlug,
  selectedDate = null,
  navigate,
  className,
}) => {
  // The marketplace is the page's main event, so it carries its own heading
  // rather than appearing as an unlabelled list under the topic chips. The
  // labels are structural, not configured marketing copy.
  const heading = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <p className="sk-eyebrow">Mentors</p>
        <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-[var(--sk-brand-text)] sm:text-3xl">
          Meet the experts
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-[var(--sk-brand-text-muted)]">
          {segmentName
            ? `Verified mentors available for ${segmentName}.`
            : 'Verified mentors, bookable in your own timezone.'}
        </p>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className={className}>
        {heading}
        <div
          className={cn(mentorGridClass(SKELETON_COUNT), 'mt-6')}
          aria-busy="true"
          aria-live="polite"
        >
          <span className="sr-only">Loading mentors</span>
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={className}>
        {heading}
        <div className="error-banner mt-6" role="alert">
          <span className="flex items-center gap-2 font-semibold">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </span>
          <Button variant="outline" size="sm" onClick={onRetry} className="mt-2 sm:mt-0">
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (mentors.length === 0) {
    // Two genuinely different situations, so two genuinely different messages:
    // "nobody covers this topic yet" needs a different next action from "this
    // segment has no mentors at all".
    const isFiltered = selectedTopicSlug !== ALL_TOPICS;

    return (
      <div className={className}>
        {heading}
        <div className="mt-6 flex flex-col items-center rounded-3xl border border-dashed border-[var(--sk-brand-border)] bg-[var(--sk-brand-surface)] px-6 py-12 text-center">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--sk-brand-border)] text-[var(--sk-brand-text-muted)]"
            aria-hidden="true"
          >
            {isFiltered ? <Compass className="h-6 w-6" /> : <Users className="h-6 w-6" />}
          </div>
          <h3 className="mt-4 font-display text-lg font-bold tracking-tight text-[var(--sk-brand-text)]">
            {isFiltered ? 'No mentors found for this topic yet' : 'No mentors available yet'}
          </h3>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-[var(--sk-brand-text-muted)]">
            {isFiltered
              ? `No active gig in ${segmentName ?? 'this segment'} covers that topic right now. Choose another topic, or view every mentor here.`
              : `There are no approved mentors listed under ${
                  segmentName ?? 'this segment'
                } right now. Try exploring another segment above.`}
          </p>
          {isFiltered && (
            <Button
              variant="outline"
              size="sm"
              className="mt-5"
              onClick={() => navigate(mentorListPath({ segmentSlug, date: selectedDate }))}
            >
              View all mentors
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      {heading}
      {mentors.length === 1 ? (
        <div className="mt-6 mx-auto max-w-3xl">
          <SegmentMentorCard
            mentor={mentors[0]!}
            navigate={navigate}
            selectedDate={selectedDate}
            selectedTopic={selectedTopicSlug}
            featured
          />
        </div>
      ) : (
        <div className={cn(mentorGridClass(mentors.length), 'mt-6')}>
          {mentors.map((mentor) => (
            <SegmentMentorCard
              key={mentor.id}
              mentor={mentor}
              navigate={navigate}
              selectedDate={selectedDate}
              selectedTopic={selectedTopicSlug}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export type { SegmentTopicView };
export default SegmentMentorGrid;