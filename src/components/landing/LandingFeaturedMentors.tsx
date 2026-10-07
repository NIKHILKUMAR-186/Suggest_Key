import React from 'react';
import type { DirectoryMentor } from '@/src/types/database';
import { LandingMentorCard } from '@/src/components/landing/LandingMentorCard';
import { LandingSectionHead } from '@/src/components/landing/LandingSectionHead';
import { MagneticButton } from '@/src/components/landing/landingMotion';
import {
  MENTORS_BODY,
  MENTORS_EMPTY_TITLE,
  MENTORS_ERROR_TITLE,
  MENTORS_LINK_LABEL,
  MENTORS_RETRY_LABEL,
  MENTORS_TITLE,
} from '@/src/components/landing/landingContent';

/**
 * THE MENTORS — a grid of profiles.
 *
 * Real profiles, fetched live through the public directory and rendered exactly as
 * it returns them. No seed data, no fallback card, no invented number anywhere in
 * this section.
 *
 * THE SPEC ASKS FOR A GRID.
 *
 * The reference screenshot shows four mentor cards across on desktop. The cards are
 * white with rounded corners, subtle borders, and soft shadows. We keep the plum
 * band behind them so portraits read as portraits, but the cards themselves are
 * paper-coloured tiles in a grid that sizes to the database.
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
  <li className="sk-lg-mentor sk-lg-mentor--grid" aria-hidden="true">
    <div style={{ padding: 18, display: 'grid', gap: 12 }}>
      <span className="sk-lg-skeleton sk-lg-skeleton--portrait" />
      <span className="sk-lg-skeleton sk-lg-skeleton--line" style={{ width: '64%' }} />
      <span className="sk-lg-skeleton sk-lg-skeleton--line" style={{ width: '42%' }} />
    </div>
  </li>
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
      className="sk-lg-band sk-lg-band--plum sk-lg-mentors-band"
      aria-labelledby="mentors-title"
    >
      <div className="sk-lg__wrap">
        <div className="sk-lg-band__head">
          <LandingSectionHead id="mentors-title" title={MENTORS_TITLE} body={MENTORS_BODY} />

          <MagneticButton className="sk-lg-link" onClick={onBrowseAll}>
            {MENTORS_LINK_LABEL}
            <span className="sk-lg-link__arrow" aria-hidden="true">
              <svg viewBox="0 0 14 14" fill="none">
                <path
                  d="M2 7h9.5M8 3.4 11.8 7 8 10.6"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </MagneticButton>
        </div>

        {isLoading ? (
          <ul className="sk-lg-mentors--grid" aria-hidden="true">
            {[0, 1, 2, 3].map((key) => (
              <CardSkeleton key={key} />
            ))}
          </ul>
        ) : mentors.length > 0 ? (
          <ul className="sk-lg-mentors--grid">
            {mentors.map((mentor, index) => (
              <LandingMentorCard key={mentor.id} mentor={mentor} index={index} onOpen={onOpenMentor} />
            ))}
          </ul>
        ) : hasError ? (
          <div className="sk-lg-state sk-lg-state--on-plum">
            <p className="sk-lg-state__title">{MENTORS_ERROR_TITLE}</p>
            <button type="button" className="sk-lg-link sk-lg-state__action" onClick={onRetry}>
              {MENTORS_RETRY_LABEL}
              <span className="sk-lg-link__arrow" aria-hidden="true">
                <svg viewBox="0 0 14 14" fill="none">
                  <path
                    d="M2 7h9.5M8 3.4 11.8 7 8 10.6"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </button>
          </div>
        ) : (
          <div className="sk-lg-blank">
            <p className="sk-lg-lead">{MENTORS_EMPTY_TITLE}</p>
            <button type="button" className="sk-lg-link sk-lg-state__action" onClick={onBrowseAll}>
              {MENTORS_LINK_LABEL}
              <span className="sk-lg-link__arrow" aria-hidden="true">
                <svg viewBox="0 0 14 14" fill="none">
                  <path
                    d="M2 7h9.5M8 3.4 11.8 7 8 10.6"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </button>
          </div>
        )}
      </div>
    </section>
  );
};

export default LandingFeaturedMentors;
