import React from 'react';
import { motion } from 'motion/react';
import { Star } from 'lucide-react';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { MentorCard } from '@/src/components/seeker/MentorCard';
import { DiscoverableMentor, Segment } from '@/src/types/database';
import type { MentorOrigin } from '@/src/lib/mentorNav';
import { cn } from '@/src/lib/utils';

export interface MentorGridProps {
  featuredMentors: DiscoverableMentor[];
  regularMentors: DiscoverableMentor[];
  selectedSegment: Segment | null;
  selectedDate: string;
  today: string;
  navigate: (path: string) => void;
  origin?: MentorOrigin;
  className?: string;
}

/**
 * Responsive grid for mentor cards:
 * - Mobile: 1 column
 * - Tablet (md): 2 columns
 * - Desktop (lg): 3 columns
 * - Large desktop (xl): 3 columns (max 3 for readability)
 */
export const MENTOR_GRID_CLASS =
  'grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6 lg:grid-cols-3 xl:grid-cols-3';

export const MentorCardSkeleton: React.FC = () => (
  <div
    aria-hidden="true"
    className="seeker-card-premium relative flex h-full flex-col p-5 sm:p-6"
  >
    {/* Segment color indicator */}
    <div className="segment-indicator" aria-hidden="true" />

    <div className="mentor-card-body">
      {/* Identity header - avatar + name + badges */}
      <div className="flex items-center gap-4">
        <Skeleton variant="circular" className="h-14 w-14 shrink-0 sm:h-[68px] sm:w-[68px]" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-16 rounded-md" />
          </div>
          <Skeleton className="h-3.5 w-4/5" />
        </div>
      </div>

      {/* Bio preview */}
      <div className="mt-4 space-y-2">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-3.5 w-3/5" />
      </div>

      {/* Expertise chips */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>

      {/* Language + timezone + experience */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <div className="inline-flex items-center gap-1.5">
          <Skeleton variant="circular" className="h-3.5 w-3.5 shrink-0" />
          <Skeleton className="h-3 w-24" />
        </div>
        <div className="inline-flex items-center gap-1.5">
          <Skeleton variant="circular" className="h-3.5 w-3.5 shrink-0" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="h-3 w-28" />
      </div>

      {/* Commerce footer */}
      <div className="mentor-card-footer mt-auto space-y-4 pt-5 border-t border-[var(--color-shell-border)]">
        {/* Availability badge */}
        <div className="flex items-center gap-2">
          <Skeleton variant="circular" className="h-3.5 w-3.5 shrink-0" />
          <Skeleton className="h-3 w-36" />
        </div>

        {/* Price/duration row */}
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Skeleton variant="circular" className="h-3 w-3 shrink-0" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-4 w-20" />
          </div>
          <div className="shrink-0 text-right space-y-1">
            <div className="flex items-center gap-1.5">
              <Skeleton variant="circular" className="h-3.5 w-3.5 shrink-0" />
              <Skeleton className="h-3 w-16" />
            </div>
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-5 w-12 rounded-md" />
              <Skeleton className="h-5 w-16 rounded-md" />
            </div>
          </div>
        </div>

        {/* CTA buttons */}
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <Skeleton className="h-11 flex-1 rounded-xl" />
          <Skeleton className="h-11 flex-1 rounded-xl" />
        </div>
      </div>
    </div>
  </div>
);

export const MentorGridSkeleton: React.FC<{ count?: number }> = ({ count = 6 }) => (
  <div className={MENTOR_GRID_CLASS} aria-hidden="true">
    {Array.from({ length: count }).map((_, i) => (
      <MentorCardSkeleton key={i} />
    ))}
  </div>
);

/**
 * Premium marketplace grid.
 *
 * Enhanced with:
 * - Better section headers with segment-aware styling
 * - Improved spacing between sections
 * - Featured section with distinct visual treatment
 */
export const MentorGrid: React.FC<MentorGridProps> = ({
  featuredMentors,
  regularMentors,
  selectedSegment,
  selectedDate,
  today,
  navigate,
  origin = 'mentor-list',
  className,
}) => {
  if (featuredMentors.length === 0 && regularMentors.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] px-4 py-8 text-center">
        <p className="text-xs text-[var(--color-shell-text-subtle)]">
          No mentors match these filters yet. Try another segment or date.
        </p>
      </div>
    );
  }

  const renderCard = (mentor: DiscoverableMentor, key: string, featured: boolean) => (
    <MentorCard
      key={key}
      variant="availability"
      availableMentor={mentor}
      segmentSlug={selectedSegment?.slug || mentor.segment.slug}
      selectedDate={selectedDate}
      today={today}
      navigate={navigate}
      isFeatured={featured}
      origin={origin}
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
      {/* Featured mentors section */}
      {featuredMentors.length > 0 && (
        <section aria-labelledby="seeker-featured-heading" className="space-y-5">
          <div className="section-header">
            <div className="section-header-content">
              <h3
                id="seeker-featured-heading"
                className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-shell-warning)]"
              >
                <Star className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                <span>Featured mentors</span>
              </h3>
              <p className="mt-1 text-[13px] text-[var(--color-shell-text-muted)]">
                Hand-picked for this segment
              </p>
            </div>
            <span className="badge badge-accent">
              {featuredMentors.length} {featuredMentors.length === 1 ? 'mentor' : 'mentors'}
            </span>
          </div>
          <div className={MENTOR_GRID_CLASS}>
            {featuredMentors.map((mentor) =>
              renderCard(mentor, `featured-${mentor.id}`, true)
            )}
          </div>
        </section>
      )}

      {/* Regular mentors section */}
      {regularMentors.length > 0 && (
        <section
          aria-labelledby="seeker-all-heading"
          className={cn(
            'space-y-5',
            featuredMentors.length > 0 && 'pt-8'
          )}
          style={featuredMentors.length > 0 ? { borderTop: '1px solid var(--color-shell-border)' } : undefined}
        >
          {featuredMentors.length === 0 && (
            <h3 id="seeker-all-heading" className="sr-only">
              All available mentors
            </h3>
          )}
          <div className="section-header">
            <div className="section-header-content">
              {featuredMentors.length > 0 && (
                <h3
                  id="seeker-all-heading"
                  className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-shell-text-subtle)]"
                >
                  All available mentors
                </h3>
              )}
              <p className="mt-1 text-[13px] text-[var(--color-shell-text-muted)]">
                Browse all mentors in this segment
              </p>
            </div>
            <span className="badge badge-neutral">
              {regularMentors.length} {regularMentors.length === 1 ? 'mentor' : 'mentors'}
            </span>
          </div>
          <div className={MENTOR_GRID_CLASS}>
            {regularMentors.map((mentor) => renderCard(mentor, `regular-${mentor.id}`, false))}
          </div>
        </section>
      )}
    </motion.div>
  );
};
