import React from 'react';
import { motion } from 'motion/react';
import { Star } from 'lucide-react';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { MentorCard } from '@/src/components/seeker/MentorCard';
import { DiscoverableMentor, Segment } from '@/src/types/database';
import { cn } from '@/src/lib/utils';
import { useSegmentTheme } from '@/src/context/SegmentThemeContext';

export interface MentorGridProps {
  featuredMentors: DiscoverableMentor[];
  regularMentors: DiscoverableMentor[];
  selectedSegment: Segment | null;
  selectedDate: string;
  today: string;
  navigate: (path: string) => void;
  className?: string;
}

export const MENTOR_GRID_CLASS =
  'grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3';

export const MentorCardSkeleton: React.FC = () => (
  <div
    aria-hidden="true"
    className="seeker-card-premium flex h-full flex-col p-5 sm:p-6"
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
  className,
}) => {
  const { activeSegmentSlug } = useSegmentTheme();

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
    />
  );

  const sectionStyle = activeSegmentSlug
    ? ({
        '--segment-accent': `var(--segment-accent)`,
        '--segment-accent-soft': `var(--segment-accent-soft)`,
        '--segment-border-accent': `var(--segment-border-accent)`,
      } as React.CSSProperties)
    : {};

  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{
        hidden: { opacity: 0 },
        show: { opacity: 1, transition: { staggerChildren: 0.06 } },
      }}
      className={cn('space-y-10', className)}
      style={sectionStyle}
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
