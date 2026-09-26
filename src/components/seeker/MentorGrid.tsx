import React from 'react';
import { motion } from 'motion/react';
import { Star } from 'lucide-react';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { MentorCard } from '@/src/components/seeker/MentorCard';
import { DiscoverableMentor, Segment } from '@/src/types/database';
import { cn } from '@/src/lib/utils';

export interface MentorGridProps {
  featuredMentors: DiscoverableMentor[];
  regularMentors: DiscoverableMentor[];
  selectedSegment: Segment | null;
  selectedDate: string;
  /** The seeker's "today" in their own timezone, for the live slot label. */
  today: string;
  navigate: (path: string) => void;
  className?: string;
}

/**
 * Responsive marketplace grid.
 *
 * The column count is driven purely by available width, so the cards use the
 * whole content column instead of leaving the page half empty:
 *   1 column  on phones
 *   2 columns on tablets
 *   3 columns from the lg breakpoint upward
 */
export const MENTOR_GRID_CLASS =
  'grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3';

/** Frontend-only placeholder card used while real mentor data is loading. */
export const MentorCardSkeleton: React.FC = () => (
  <div
    aria-hidden="true"
    className="flex h-full flex-col rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-5 sm:p-6"
  >
    <div className="flex items-center gap-4">
      <Skeleton variant="circular" className="h-14 w-14 shrink-0 sm:h-[68px] sm:w-[68px]" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
    <div className="mt-4 space-y-2">
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-4/5" />
    </div>
    <div className="mt-4 flex gap-1.5">
      <Skeleton className="h-5 w-20 rounded-md" />
      <Skeleton className="h-5 w-16 rounded-md" />
    </div>
    <div className="mt-auto space-y-3 pt-5">
      <div className="h-px w-full bg-[var(--color-shell-border)]" />
      <div className="flex items-end justify-between">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-5 w-20" />
      </div>
      <div className="flex gap-2.5">
        <Skeleton className="h-11 flex-1 rounded-xl" />
        <Skeleton className="h-11 flex-1 rounded-xl" />
      </div>
    </div>
  </div>
);

export const MentorGridSkeleton: React.FC<{ count?: number }> = ({ count = 3 }) => (
  <div className={MENTOR_GRID_CLASS} aria-hidden="true">
    {Array.from({ length: count }).map((_, i) => (
      <MentorCardSkeleton key={i} />
    ))}
  </div>
);

/**
 * Premium marketplace grid. Renders exactly the mentors supplied by the page —
 * never padding the grid with placeholder entries.
 */
export const MentorGrid: React.FC<MentorGridProps> = ({
  featuredMentors,
  regularMentors,
  selectedSegment,
  selectedDate,
  today,
  navigate,
  className,
}) => {
  if (featuredMentors.length === 0 && regularMentors.length === 0) return null;

  const renderCard = (mentor: DiscoverableMentor, key: string, featured: boolean) => (
    <MentorCard
      key={key}
      variant="availability"
      availableMentor={mentor}
      segmentId={selectedSegment?.id || mentor.segment.id}
      selectedDate={selectedDate}
      today={today}
      navigate={navigate}
      isFeatured={featured}
    />
  );

  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{
        hidden: { opacity: 0 },
        show: { opacity: 1, transition: { staggerChildren: 0.06 } },
      }}
      className={cn('space-y-10', className)}
    >
      {featuredMentors.length > 0 && (
        <section aria-labelledby="seeker-featured-heading" className="space-y-4">
          <h3
            id="seeker-featured-heading"
            className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-shell-warning)]"
          >
            <Star className="h-3 w-3 fill-current" aria-hidden="true" />
            <span>Featured mentors</span>
          </h3>
          <div className={MENTOR_GRID_CLASS}>
            {featuredMentors.map((mentor) =>
              renderCard(mentor, `featured-${mentor.id}`, true)
            )}
          </div>
        </section>
      )}

      {regularMentors.length > 0 && (
        <section
          aria-labelledby="seeker-all-heading"
          className={cn(
            'space-y-4',
            featuredMentors.length > 0 && 'border-t border-[var(--color-shell-border)] pt-8'
          )}
        >
          {featuredMentors.length === 0 && (
            <h3 id="seeker-all-heading" className="sr-only">
              All available mentors
            </h3>
          )}
          <div className={MENTOR_GRID_CLASS}>
            {regularMentors.map((mentor) => renderCard(mentor, `regular-${mentor.id}`, false))}
          </div>
        </section>
      )}
    </motion.div>
  );
};
