import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { AlertCircle, ArrowRight, Compass, Users } from 'lucide-react';
import { MentorCard } from '@/src/components/seeker/MentorCard';
import { MentorCardSkeleton } from '@/src/components/seeker/MentorGrid';
import {
  buildMentorCountLabel,
  pluralizeSegmentName,
} from '@/src/lib/segmentNaming';
import { MENTOR_GRID_CLASS } from '@/src/components/seeker/MentorGrid';
import type { DirectoryMentor, Segment } from '@/src/types/database';
import { cn } from '@/src/lib/utils';

export interface SegmentMentorsSectionProps {
  segment: Segment | null;
  mentors: DirectoryMentor[];
  total: number;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  selectedDate: string;
  today: string;
  navigate: (path: string) => void;
  className?: string;
}

/**
 * EXPLORE THIS SEGMENT.
 *
 * Premium section design with:
 * - Better header with count badge and CTA
 * - Subtle segment-aware ambient glow
 * - Improved error/loading/empty states
 * - Better visual separation from content above
 */
export const SegmentMentorsSection: React.FC<SegmentMentorsSectionProps> = ({
  segment,
  mentors,
  total,
  isLoading,
  error,
  onRetry,
  selectedDate,
  today,
  navigate,
  className,
}) => {
  const prefersReducedMotion = useReducedMotion();

  const title = segment?.name
    ? pluralizeSegmentName(segment.name)
    : 'Mentors';
  const hasMentors = mentors.length > 0;
  const hasDirectoryRoute = !!segment?.id;

  return (
    <motion.section
      id="segment-mentors"
      aria-labelledby="segment-mentors-heading"
      initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
      whileInView={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.5, ease: [0.23, 1, 0.31, 1] }}
      className={cn('relative scroll-mt-24 section-gap', className)}
    >
      {/* Subtle radial atmosphere */}
      <div
        className="pointer-events-none absolute -inset-x-8 -top-10 -z-10 h-72 rounded-[40px]"
        style={{
          background:
            'radial-gradient(ellipse 60% 100% at 50% 0%, var(--segment-atmo-c), transparent 72%)',
        }}
        aria-hidden="true"
      />

      {/* Section header */}
      <div className="section-header">
        <div className="section-header-content">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-shell-text-subtle)]">
            <Compass className="h-3.5 w-3.5" aria-hidden="true" />
            Explore this segment
          </p>
          <h2
            id="segment-mentors-heading"
            className="mt-2.5 font-display text-2xl font-bold leading-tight tracking-tight text-[var(--color-shell-text)] sm:text-3xl"
          >
            {title}
          </h2>
          <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-[var(--color-shell-text-muted)]">
            Browse mentors available in this area.
          </p>
        </div>

        <div className="section-header-actions">
          {!isLoading && !error && (
            <span
              className="badge badge-neutral"
              aria-live="polite"
            >
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              {buildMentorCountLabel(total)}
            </span>
          )}

          {hasDirectoryRoute && !error && (
            <button
              type="button"
              onClick={() => navigate(`/mentors?segmentSlug=${segment!.slug}`)}
              className="btn-secondary"
            >
              <span>View all</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Error state */}
      {error ? (
        <div
          role="alert"
          className="error-banner mt-8"
        >
          <span className="flex items-center gap-2 font-semibold">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </span>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-[38px] cursor-pointer items-center justify-center rounded-lg border border-[var(--color-shell-error)]/40 px-4 text-[13px] font-semibold transition-colors duration-150 hover:bg-[var(--color-shell-error)]/10 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--color-shell-focus)] focus-visible:outline-offset-2"
          >
            Try again
          </button>
        </div>
      ) : isLoading ? (
        <div className={cn(MENTOR_GRID_CLASS, 'mt-8')}>
          {Array.from({ length: 3 }).map((_, i) => (
            <MentorCardSkeleton key={i} />
          ))}
        </div>
      ) : hasMentors ? (
        <motion.div
          initial="hidden"
          animate="show"
          variants={{
            hidden: { opacity: 0 },
            show: {
              opacity: 1,
              transition: { staggerChildren: prefersReducedMotion ? 0 : 0.05 },
            },
          }}
          className={cn(MENTOR_GRID_CLASS, 'mt-8')}
        >
          {mentors.map((mentor) => (
            <MentorCard
              key={mentor.id}
              variant="discovery"
              directoryMentor={mentor}
              segmentSlug={segment!.slug}
              selectedDate={selectedDate}
              today={today}
              navigate={navigate}
            />
          ))}
        </motion.div>
      ) : (
        <div className="mt-8 flex flex-col items-center rounded-3xl border border-dashed border-[var(--color-shell-border)] bg-[var(--color-shell-surface)]/50 px-6 py-12 text-center">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-text-subtle)]"
            aria-hidden="true"
          >
            <Users className="h-6 w-6" />
          </div>
          <h3 className="mt-4 font-display text-lg font-bold tracking-tight text-[var(--color-shell-text)]">
            No mentors in this segment yet
          </h3>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-[var(--color-shell-text-muted)]">
            There are no approved mentors listed under {segment?.name ?? 'this segment'}{' '}
            right now. Try exploring another segment above.
          </p>
        </div>
      )}
    </motion.section>
  );
};
