import { ArrowRight } from 'lucide-react';
import React from 'react';
import type { DirectoryMentor } from '@/src/types/database';
import { LandingMentorCard } from '@/src/components/landing/LandingMentorCard';
import { LandingSectionHead } from '@/src/components/landing/LandingSectionHead';
import { Reveal } from '@/src/components/landing/Reveal';
import {
  MENTORS_BODY,
  MENTORS_EMPTY_BODY,
  MENTORS_EMPTY_TITLE,
  MENTORS_ERROR_BODY,
  MENTORS_ERROR_TITLE,
  MENTORS_EYEBROW,
  MENTORS_LINK_LABEL,
  MENTORS_TITLE,
} from '@/src/components/landing/landingContent';

/**
 * THE MENTORS.
 *
 * Real profiles, fetched live through the public directory and rendered exactly
 * as it returns them. There is no seed data, no fallback card and no invented
 * number anywhere in this section: the product has no review system, so the page
 * cannot show one without telling a lie that costs a paying user money.
 *
 * The section sits on the deep plum field, which is the surface change that
 * makes the portraits read as portraits. Everything above it is paper; the
 * mentors are the first thing on the page with light behind it.
 *
 * All three empty states are honest. Loading shows the shape of what is coming
 * rather than a spinner; a failed read offers a retry and says nothing was
 * cached. A visitor is never shown a placeholder person.
 *
 * An empty directory is a composition, not a panel. The real state is "the
 * network is still being built", so it is drawn that way: the same plum field,
 * one large quiet numeral, the sentence that explains it, and the one action
 * that still works. An empty white rectangle in the middle of a dark band read
 * as a fault in the page, which is the opposite of what it is.
 */

export interface LandingFeaturedMentorsProps {
  mentors: DirectoryMentor[];
  isLoading: boolean;
  hasError: boolean;
  onOpenMentor: (mentor: DirectoryMentor) => void;
  onBrowseAll: () => void;
  onRetry: () => void;
}

const CardSkeleton: React.FC = () => (
  <div aria-hidden="true">
    <div className="sk-lp-skeleton" style={{ border: 0, background: 'transparent' }}>
      <div className="sk-lp-skeleton__portrait" style={{ borderRadius: 3 }} />
      <div className="mt-5">
        <div className="sk-lp-skeleton__line sk-lp-skeleton__line--flush" />
        <div className="sk-lp-skeleton__line sk-lp-skeleton__line--short sk-lp-skeleton__line--flush mt-3" />
        <div className="sk-lp-skeleton__line sk-lp-skeleton__line--flush mt-3" />
      </div>
    </div>
  </div>
);

export const LandingFeaturedMentors: React.FC<LandingFeaturedMentorsProps> = ({
  mentors,
  isLoading,
  hasError,
  onOpenMentor,
  onBrowseAll,
  onRetry,
}) => {
  return (
    <section
      id="mentors"
      className="sk-lp-section sk-lp-section--plum sk-lp-on-plum"
      aria-labelledby="mentors-title"
    >
      <div className="sk-lp-wrap">
        <LandingSectionHead
          id="mentors"
          eyebrow={MENTORS_EYEBROW}
          title={MENTORS_TITLE}
          body={MENTORS_BODY}
          aside={
            <Reveal delay={0.16}>
              <button type="button" className="sk-lp-link sk-lp-link--on-plum mt-6" onClick={onBrowseAll}>
                {MENTORS_LINK_LABEL}
                <ArrowRight className="h-4 w-4 sk-lp-link__arrow" aria-hidden="true" />
              </button>
            </Reveal>
          }
        />

        {isLoading ? (
          <div className="sk-lp-mentors">
            {[0, 1, 2].map((key) => (
              <CardSkeleton key={key} />
            ))}
          </div>
        ) : mentors.length > 0 ? (
          <div className="sk-lp-mentors">
            {mentors.map((mentor, index) => (
              <Reveal key={mentor.id} delay={index * 0.07} y={24} className="flex">
                <LandingMentorCard mentor={mentor} onOpen={onOpenMentor} />
              </Reveal>
            ))}
          </div>
        ) : hasError ? (
          <div className="sk-lp-state sk-lp-state--on-plum">
            <p className="sk-lp-state__title">{MENTORS_ERROR_TITLE}</p>
            <p className="sk-lp-state__text">{MENTORS_ERROR_BODY}</p>
            <button
              type="button"
              className="sk-lp-state__action"
              style={{ color: 'var(--sk-lp-gold)', borderColor: 'var(--sk-lp-gold)' }}
              onClick={onRetry}
            >
              Try Again
            </button>
          </div>
        ) : (
          <div className="sk-lp-mentors sk-lp-mentors--empty">
            <Reveal y={20} className="sk-lp-mentors__empty">
              <p className="sk-lp-numeral sk-lp-mentors__empty-numeral" aria-hidden="true">
                00
              </p>
              <p className="sk-lp-display sk-lp-display--sm sk-lp-mentors__empty-title">
                {MENTORS_EMPTY_TITLE}
              </p>
              <p className="sk-lp-lead sk-lp-mentors__empty-text">{MENTORS_EMPTY_BODY}</p>
              <button
                type="button"
                className="sk-lp-btn sk-lp-btn--gold mt-9"
                onClick={onBrowseAll}
              >
                Browse every mentor
                <ArrowRight className="h-4 w-4 sk-lp-btn__arrow" aria-hidden="true" />
              </button>
            </Reveal>
          </div>
        )}
      </div>
    </section>
  );
};