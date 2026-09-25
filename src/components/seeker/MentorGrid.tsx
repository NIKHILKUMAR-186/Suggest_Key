import React from 'react';
import { motion } from 'motion/react';
import { Star } from 'lucide-react';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { PremiumMentorCard } from '@/src/components/seeker/PremiumMentorCard';
import { DiscoverableMentor, Segment } from '@/src/types/database';
import { cn } from '@/src/lib/utils';

export interface MentorGridProps {
  featuredMentors: DiscoverableMentor[];
  regularMentors: DiscoverableMentor[];
  selectedSegment: Segment | null;
  selectedDate: string;
  navigate: (path: string) => void;
  className?: string;
}

const gridClass = 'grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6';

/** Frontend-only placeholder card used while real mentor data is loading. */
export const MentorCardSkeleton: React.FC = () => (
  <div
    aria-hidden="true"
    className="overflow-hidden rounded-3xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)]"
  >
    <Skeleton className="h-40 w-full rounded-none" />
    <div className="space-y-3.5 p-5">
      <div className="flex items-center gap-3">
        <Skeleton variant="circular" className="h-11 w-11 shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <Skeleton className="h-3.5 w-3/4" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-4/5" />
      <div className="flex items-center gap-2 border-t border-[var(--color-shell-border)] pt-4">
        <Skeleton className="h-9 flex-1 rounded-lg" />
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
    </div>
  </div>
);

export const MentorGridSkeleton: React.FC<{ count?: number }> = ({ count = 4 }) => (
  <div className={gridClass} aria-hidden="true">
    {Array.from({ length: count }).map((_, i) => (
      <MentorCardSkeleton key={i} />
    ))}
  </div>
);

/**
 * Premium 2-column marketplace grid. Renders exactly the mentors supplied by
 * the page — never padding the grid with placeholder entries.
 */
export const MentorGrid: React.FC<MentorGridProps> = ({
  featuredMentors,
  regularMentors,
  selectedSegment,
  selectedDate,
  navigate,
  className,
}) => {
  if (featuredMentors.length === 0 && regularMentors.length === 0) return null;

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
          <div className={gridClass}>
            {featuredMentors.map((mentor) => (
              <PremiumMentorCard
                key={`featured-${mentor.id}`}
                mentor={mentor}
                selectedSegment={selectedSegment}
                selectedDate={selectedDate}
                navigate={navigate}
                isFeatured
              />
            ))}
          </div>
        </section>
      )}

      {regularMentors.length > 0 && (
        <section
          aria-labelledby="seeker-all-heading"
          className={cn('space-y-4', featuredMentors.length > 0 && 'border-t border-[var(--color-shell-border)] pt-8')}
        >
          {featuredMentors.length === 0 && (
            <h3 id="seeker-all-heading" className="sr-only">
              All available mentors
            </h3>
          )}
          <div className={gridClass}>
            {regularMentors.map((mentor) => (
              <PremiumMentorCard
                key={`regular-${mentor.id}`}
                mentor={mentor}
                selectedSegment={selectedSegment}
                selectedDate={selectedDate}
                navigate={navigate}
              />
            ))}
          </div>
        </section>
      )}
    </motion.div>
  );
};
