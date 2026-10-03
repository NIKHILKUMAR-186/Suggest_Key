import { ArrowRight } from 'lucide-react';
import React from 'react';
import type { Segment } from '@/src/types/database';
import { deriveSegmentTheme } from '@/src/lib/segmentTheme';
import { useTheme } from '@/src/context/ThemeContext';
import { Reveal } from '@/src/components/landing/Reveal';
import { LandingSectionHead } from '@/src/components/landing/LandingSectionHead';
import { areaImageAt } from '@/src/components/landing/landingImages';
import {
  AREAS_BODY,
  AREAS_EYEBROW,
  AREAS_TITLE,
} from '@/src/components/landing/landingContent';

/**
 * MENTORSHIP AREAS.
 *
 * The catalogue is database data. It arrives through the page's single
 * `useActiveSegments()` read — ordered by the CMS `priority` column, live over
 * the existing realtime publication — and nothing here re-ranks it, filters it,
 * pads it or names an area. An empty catalogue renders a sentence, not a
 * placeholder card, because a made-up area is a promise the platform cannot
 * keep.
 *
 * The composition is a balanced editorial grid of equal cards. An earlier
 * version gave the highest-priority area a double-width lead cell, which looked
 * accidental: with three live areas it left a hole beside a very large card, and
 * with five it read as one important category and four leftovers. Equal weight
 * is also the honest signal — the ordering is a CMS ranking for search results,
 * not a claim that one area of someone's life outranks another.
 *
 * Photographs are assigned by position from a fixed manifest, so an admin can
 * rename or reorder the catalogue without breaking an image association.
 */

export interface LandingSegmentStripProps {
  segments: Segment[];
  isLoadingSegments: boolean;
  hasError: boolean;
  onOpenArea: (segment: Segment) => void;
  onRetry: () => void;
}

const SectionSkeleton: React.FC = () => (
  <div className="sk-lp-areas" aria-hidden="true">
    {[0, 1, 2].map((key) => (
      <div key={key} className="sk-lp-skeleton">
        <div className="sk-lp-skeleton__media" />
        <div className="py-6">
          <div className="sk-lp-skeleton__line h-5 w-3/5" />
          <div className="sk-lp-skeleton__line mt-3" />
          <div className="sk-lp-skeleton__line sk-lp-skeleton__line--short" />
        </div>
      </div>
    ))}
  </div>
);

export const LandingSegmentStrip: React.FC<LandingSegmentStripProps> = ({
  segments,
  isLoadingSegments,
  hasError,
  onOpenArea,
  onRetry,
}) => {
  const { theme } = useTheme();

  return (
    <section
      id="areas"
      className="sk-lp-section"
      style={{ background: 'var(--sk-lp-violet-field), var(--sk-lp-canvas)' }}
      aria-labelledby="areas-title"
    >
      <div className="sk-lp-wrap">
        <LandingSectionHead
          id="areas"
          eyebrow={AREAS_EYEBROW}
          title={AREAS_TITLE}
          body={AREAS_BODY}
        />

        {isLoadingSegments ? (
          <SectionSkeleton />
        ) : segments.length > 0 ? (
          <div className="sk-lp-areas">
            {segments.map((segment, index) => {
              const image = areaImageAt(index);

              /**
               * The area's own configured accent, derived from data rather than
               * from a slug lookup, so a new area gets its colour from the admin
               * panel with no frontend change. It is applied to the index numeral
               * and one soft wash on the photograph — deliberately the only two
               * places, because a page of six differently coloured cards would
               * read as decoration rather than as brand.
               */
              const accent = deriveSegmentTheme(segment.experience_config, theme).accent;

              return (
                <Reveal
                  key={segment.id}
                  delay={index * 0.06}
                  y={20}
                  className="sk-lp-areas__cell"
                >
                  <button
                    type="button"
                    className="sk-lp-area"
                    style={{ '--lp-area-accent': accent } as React.CSSProperties}
                    aria-label={`Explore mentors in ${segment.name}`}
                    onClick={() => onOpenArea(segment)}
                  >
                    <span className="sk-lp-area__media">
                      <img
                        src={image.src}
                        alt={image.alt}
                        width={image.width}
                        height={image.height}
                        loading="lazy"
                        decoding="async"
                      />
                      <span className="sk-lp-area__index" aria-hidden="true">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                    </span>

                    <span className="sk-lp-area__body">
                      <span className="sk-lp-area__name">{segment.name}</span>
                      {segment.description && (
                        <span className="sk-lp-area__desc">{segment.description}</span>
                      )}
                      <span className="sk-lp-area__go">
                        Explore mentors
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </span>
                    </span>
                  </button>
                </Reveal>
              );
            })}
          </div>
        ) : hasError ? (
          <div className="sk-lp-state">
            <p className="sk-lp-state__title">Mentorship areas could not be loaded</p>
            <p className="sk-lp-state__text">
              The catalogue did not respond. Nothing is cached here, so trying again shows
              the areas that are live right now.
            </p>
            <button type="button" className="sk-lp-state__action" onClick={onRetry}>
              Try Again
            </button>
          </div>
        ) : (
          <p className="sk-lp-lead max-w-[46ch]">Mentorship areas are being prepared.</p>
        )}
      </div>
    </section>
  );
};