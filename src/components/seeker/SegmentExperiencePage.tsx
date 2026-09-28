import React from 'react';
import { AlertCircle, Users } from 'lucide-react';
import { SegmentExperienceRenderer } from '@/src/components/seeker/SegmentExperienceRenderer';
import { MENTOR_GRID_CLASS, MentorCardSkeleton } from '@/src/components/seeker/MentorGrid';
import { MentorCard } from '@/src/components/seeker/MentorCard';
import { Button } from '@/src/components/ui/Button';
import { useSegmentExperience } from '@/src/context/SegmentExperienceContext';
import { SectionHeader } from '@/src/components/seeker/SectionHeader';
import { cn } from '@/src/lib/utils';
import type { Segment, DiscoverableMentor } from '@/src/types/database';

export interface SegmentExperiencePageProps {
  segment: Segment | null;
  mentors: DiscoverableMentor[];
  selectedDate: string;
  today: string;
  isLoadingMentors: boolean;
  mentorError: string | null;
  navigate: (path: string) => void;
  className?: string;
  showHero?: boolean;
}

/**
 * Segment landing section for the seeker home page.
 *
 * This is a THIN composition wrapper, not a second renderer: the experience
 * content itself is produced by the shared `SegmentExperienceRenderer` from the
 * config owned by `SegmentExperienceProvider`. That is what guarantees a future
 * admin preview shows byte-identical output to the seeker.
 *
 * Its only additional job is to render the REAL mentor data for the selected
 * segment, plus loading / error / empty states. It never invents content:
 * guides come from `config.guides`, stories from `config.stories`, and mentors
 * from the discovery API.
 */
export const SegmentExperiencePage: React.FC<SegmentExperiencePageProps> = ({
  segment,
  mentors,
  selectedDate,
  today,
  isLoadingMentors,
  mentorError,
  navigate,
  className,
  showHero = true,
}) => {
  const { config, isLoading, error, isFallback, reload } = useSegmentExperience();

  // Real mentors for this segment. No fallback list, no placeholder people.
  const mentorSection = (
    <section className="section-container">
      <div id="segment-mentors" className="scroll-mt-24">
        <SectionHeader
          eyebrow="Mentors"
          title={segment?.name ? `${segment.name} mentors` : 'Mentors'}
          description="Real, verified mentors available for this area."
          badge={
            <span className="badge badge-neutral" aria-live="polite">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              {mentors.length}
            </span>
          }
        />

        {isLoadingMentors ? (
          <div className={cn(MENTOR_GRID_CLASS, 'mt-8')}>
            {Array.from({ length: 3 }).map((_, i) => (
              <MentorCardSkeleton key={i} />
            ))}
          </div>
        ) : mentorError ? (
          <div className="error-banner mt-8" role="alert">
            <span className="flex items-center gap-2 font-semibold">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {mentorError}
            </span>
            <Button variant="outline" size="sm" onClick={reload} className="mt-2 sm:mt-0">
              Try again
            </Button>
          </div>
        ) : mentors.length === 0 ? (
          <div className="mt-8 flex flex-col items-center rounded-3xl border border-dashed border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] px-6 py-12 text-center">
            <div
              className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-text-subtle)]"
              aria-hidden="true"
            >
              <Users className="h-6 w-6" />
            </div>
            <h3 className="mt-4 font-display text-lg font-bold tracking-tight text-[var(--color-shell-text)]">
              No mentors available yet
            </h3>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-[var(--color-shell-text-muted)]">
              There are no mentors available for {segment?.name || 'this area'} on {selectedDate}.
            </p>
          </div>
        ) : (
          <div className={cn(MENTOR_GRID_CLASS, 'mt-8')}>
            {mentors.map((mentor) => (
              <MentorCard
                key={mentor.id}
                variant="availability"
                availableMentor={mentor}
                segmentSlug={segment?.slug ?? mentor.segment.slug}
                selectedDate={selectedDate}
                today={today}
                navigate={navigate}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );

  return (
    <SegmentExperienceRenderer
      segment={segment ? { name: segment.name, slug: segment.slug } : null}
      config={config}
      isLoading={isLoading}
      isFallback={isFallback}
      className={className}
      mentors={
        <>
          {error && (
            <div className="section-container">
              <div className="error-banner" role="alert">
                <span className="flex items-center gap-2 font-semibold">
                  <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {error}
                </span>
                <Button variant="outline" size="sm" onClick={reload} className="mt-2 sm:mt-0">
                  Try again
                </Button>
              </div>
            </div>
          )}
          {showHero && mentors}
        </>
      }
    />
  );
};

export default SegmentExperiencePage;
