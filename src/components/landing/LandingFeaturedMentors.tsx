import React, { useMemo } from 'react';
import { ArrowRight, Users } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { Reveal } from '@/src/components/landing/Reveal';
import {
  LandingMentorCard,
  LandingMentorCardSkeleton,
} from '@/src/components/landing/LandingMentorCard';
import { useFeaturedMentors } from '@/src/hooks/useFeaturedMentors';
import { getDateStringInTimezone } from '@/src/lib/slotEngine';
import { useAuth } from '@/src/context/AuthContext';
import { HERO_ARROW } from '@/src/components/landing/landingContent';

export interface LandingFeaturedMentorsProps {
  /** The app's own navigate(), so discovery is reached through the router. */
  onNavigate: (href: string) => void;
  /** Where mentor discovery goes for this visitor's auth state. */
  findMentorPath: string;
}

/**
 * FEATURED MENTORS.
 *
 * Reads the live directory and the live availability endpoint through
 * `useFeaturedMentors`, and shows nothing at all rather than something
 * representative: no placeholder mentor is ever rendered, in the loading state
 * or in the empty one.
 */
export const LandingFeaturedMentors: React.FC<LandingFeaturedMentorsProps> = ({
  onNavigate,
  findMentorPath,
}) => {
  const { profile } = useAuth();
  const { mentors, isLoading, hasError, reload } = useFeaturedMentors();

  const today = useMemo(
    () => getDateStringInTimezone(new Date(), profile?.timezone || 'Asia/Kolkata'),
    [profile?.timezone]
  );

  return (
    <section
      id="mentors"
      className="scroll-mt-24 bg-[var(--sk-brand-canvas)] px-4 py-16 sm:px-6 sm:py-24 lg:px-8"
      aria-labelledby="featured-mentors-heading"
    >
      <div className="mx-auto max-w-[1240px]">
        <Reveal className="max-w-2xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-shell-accent)]">
            Featured mentors
          </p>
          <h2
            id="featured-mentors-heading"
            className="mt-4 text-[28px] font-medium leading-[1.12] tracking-tight text-[var(--sk-brand-text)] sm:text-[38px]"
            style={{ fontFamily: 'var(--font-aeonikpro)' }}
          >
            Meet people who can help you move forward.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-[var(--sk-brand-text-muted)]">
            Explore verified mentors across different areas and find someone who fits your needs. Prices and
            availability below are the mentor&apos;s own.
          </p>
        </Reveal>

        <div className="mt-10">
          {isLoading ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true">
              {[0, 1, 2, 3].map((index) => (
                <LandingMentorCardSkeleton key={index} />
              ))}
            </div>
          ) : hasError ? (
            <ErrorState
              title="We couldn't load mentors just now"
              message="Mentor discovery is available as usual — head there directly, or try loading this section again."
              onRetry={reload}
            />
          ) : mentors.length > 0 ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {mentors.map((entry, index) => (
                  <Reveal key={entry.mentor.id} delay={index * 0.06} className="h-full">
                    <LandingMentorCard
                      entry={entry}
                      today={today}
                      onOpen={() => onNavigate(findMentorPath)}
                    />
                  </Reveal>
                ))}
              </div>

              <div className="mt-10 flex justify-center">
                <Button variant="outline" size="lg" className="gap-2 rounded-xl" onClick={() => onNavigate(findMentorPath)}>
                  Explore all mentors
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </>
          ) : (
            <div className="rounded-[26px] border border-dashed border-[var(--sk-brand-border-strong)] bg-[var(--sk-brand-surface)]/60">
              <EmptyState
                icon={Users}
                title="Mentors are being added"
                description="New mentors are approved and onboarded regularly. Every session fee is shown before you pay, so there are no surprises when they arrive."
              />
              <div className="flex justify-center pb-12">
                <Button size="md" className="gap-2" onClick={() => onNavigate(findMentorPath)}>
                  Find a Mentor {HERO_ARROW}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};