import { motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight } from 'lucide-react';
import React from 'react';
import type { Segment } from '@/src/types/database';
import { deriveSegmentTheme } from '@/src/lib/segmentTheme';
import { resolveSegmentIcon } from '@/src/lib/segmentIcons';
import { useTheme } from '@/src/context/ThemeContext';
import { EdgeReveal, Stagger, StaggerItem } from '@/src/components/landing/Reveal';
import { AREAS_ACTION_LABEL, AREAS_BODY, AREAS_EMPTY_LABEL, AREAS_RETRY_LABEL, AREAS_TITLE } from '@/src/components/landing/landingContent';

/**
 * The catalogue's failure sentence. It lives here rather than in the
 * shared copy file because this section is the only place it renders.
 */
const AREAS_ERROR_LABEL = 'Couldn’t load mentorship areas.';

/**
 * MENTORSHIP AREAS — the index.
 *
 * The catalogue is database data. It arrives through the page's single
 * `useActiveSegments()` read — ordered by the CMS `priority` column, live over the
 * existing realtime publication — and nothing here re-ranks it, filters it, pads
 * it or names an area. An empty catalogue renders a sentence, not a placeholder,
 * because a made-up area is a promise the platform cannot keep.
 *
 * THIS IS THE ONLY SEGMENT NAVIGATION ON THE PAGE.
 *
 * The hero's orbit shows the same area names as decoration — it carries no href,
 * no click and no focus — so these rows carry the entire route into every live
 * area. That is why they are real buttons with a real accessible name and a real
 * focus ring rather than a decorated list.
 *
 * THE HEADING IS A QUESTION, BECAUSE THE SECTION IS AN OFFER.
 *
 * "Who do you want to talk to?" is what a visitor is actually in the middle of
 * when they arrive, and asking it makes the list below an answer rather than a
 * catalogue. The subtext is one sentence and does not describe the review process:
 * that claim belongs to the trust section, and repeating it here is how a page
 * ends up explaining the same thing in three places.
 *
 * NO ORDINAL, NO PANEL, NO HEADING-SIZED FAILURE.
 *
 * The "01" this section used to carry is gone: numbering a page whose sections are
 * already named by their own headings only adds a second thing to read. And a
 * failed read is one sentence at caption weight with a retry beside it, never a
 * card — an error that renders louder than the real content it replaced makes the
 * whole page look broken when one request timed out.
 *
 * THE ACCENT IS DATA, NOT DECORATION.
 *
 * Each row carries its own admin-configured colour, used once, on the mark. A page
 * of six differently coloured panels would read as decoration; six small marks
 * inside one rule read as data — and an area added in the CMS appears here in its
 * own colour with no frontend change at all.
 */

export interface LandingSegmentStripProps {
  segments: Segment[];
  isLoadingSegments: boolean;
  hasError: boolean;
  onOpenArea: (segment: Segment) => void;
  onRetry: () => void;
}

/**
 * A skeleton that is the shape of a real row.
 *
 * Four lines rather than three equal tiles, because the thing loading is a list of
 * ruled rows and a skeleton of tiles would make the layout jump when the rows
 * arrive — which is the failure a skeleton exists to prevent.
 */
const SectionSkeleton: React.FC = () => (
  <ul className="sk-lg-areas" aria-hidden="true">
    {[0, 1, 2, 3].map((key) => (
      <li key={key} className="sk-lg-area">
        <div style={{ padding: '28px 10px', display: 'grid', gap: 12 }}>
          <span className="sk-lg-skeleton sk-lg-skeleton--line" style={{ width: '26%' }} />
          <span className="sk-lg-skeleton sk-lg-skeleton--line" style={{ width: '58%' }} />
        </div>
      </li>
    ))}
  </ul>
);

export const LandingSegmentStrip: React.FC<LandingSegmentStripProps> = ({
  segments,
  isLoadingSegments,
  hasError,
  onOpenArea,
  onRetry,
}) => {
  const { theme } = useTheme();
  const canAnimate = useReducedMotion() !== true;

  return (
    <section id="areas" className="sk-lg-band sk-lg-areas-band" aria-labelledby="areas-title">
      <span className="sk-lg-margin" aria-hidden="true" />

      <div className="sk-lg__wrap">
        {/*
          The heading is set beside the rows rather than above them on a wide
          viewport, so the list starts at the top of the section and a visitor
          scanning for a specific area never has to scroll past four lines of
          prose to reach it.
        */}
        <div className="sk-lg-areas__layout">
          <div className="sk-lg-areas__intro">
            {/*
              Revealed on the elements themselves, not inside wrappers: the CSS
              sizes this column with `position: sticky` and reads the heading and
              lead as its own direct children, so a motion div around either of
              them would change what the sticky box contains.
            */}
            <motion.h2
              id="areas-title"
              className="sk-lg-display sk-lg-display--section"
              initial={canAnimate ? { opacity: 0, y: 22 } : false}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 0.78, ease: [0.22, 1, 0.36, 1] }}
            >
              {AREAS_TITLE}
            </motion.h2>
            <motion.p
              className="sk-lg-lead"
              initial={canAnimate ? { opacity: 0, y: 20 } : false}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 0.78, delay: 0.09, ease: [0.22, 1, 0.36, 1] }}
            >
              {AREAS_BODY}
            </motion.p>
            <EdgeReveal className="sk-lg-head__rule sk-lg-head__rule--edge" delay={0.16} />
          </div>

          <div className="sk-lg-areas__list">
            {isLoadingSegments ? (
              <SectionSkeleton />
            ) : segments.length > 0 ? (
              <Stagger step={0.055} as="ul" className="sk-lg-areas">
                {segments.map((segment) => {
                  /**
                   * The area's own configured accent, derived from data rather than
                   * from a slug lookup, so a new area gets its colour from the admin
                   * panel with no frontend change.
                   */
                  const accent = deriveSegmentTheme(segment.experience_config, theme).accent;
                  const Icon = resolveSegmentIcon(
                    segment.experience_config?.topics?.find((topic) => topic.enabled !== false)?.icon
                  );
                  const description = segment.description?.trim();

                  return (
                    <StaggerItem key={segment.id} y={16} as="li" className="sk-lg-area">
                      <motion.button
                        type="button"
                        className="sk-lg-area__link"
                        style={{ '--sk-area-accent': accent } as React.CSSProperties}
                        aria-label={`${AREAS_ACTION_LABEL} mentors in ${segment.name}`}
                        onClick={() => onOpenArea(segment)}
                        /**
                         * A three-degree tilt toward the pointer, on the row's own
                         * plane. It is the page's one piece of 3D on paper, and it
                         * is here rather than on the mentor cards because a mentor
                         * card is a link into a person and this is a link into a
                         * catalogue — the smaller gesture belongs to the smaller
                         * decision.
                         *
                         * Rotating a full-width ruled row is a large area, so this
                         * is deliberately shallow: enough that the rule's far end
                         * moves 3px, not enough that the text leaves its baseline.
                         */
                        whileHover={canAnimate ? { rotateX: 3, rotateY: -1.5 } : undefined}
                        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                      >
                        <span className="sk-lg-area__mark" aria-hidden="true">
                          <Icon className="h-4 w-4" strokeWidth={1.7} />
                        </span>

                        <span className="sk-lg-area__name">{segment.name}</span>

                        {description && <span className="sk-lg-area__desc">{description}</span>}

                        <span className="sk-lg-area__go" aria-hidden="true">
                          {AREAS_ACTION_LABEL}
                          <ArrowUpRight className="h-4 w-4" />
                        </span>
                      </motion.button>
                    </StaggerItem>
                  );
                })}
              </Stagger>
            ) : hasError ? (
              /*
                One sentence and a retry, at caption weight. This state used to be a
                titled panel, which made a single failed request look like the page
                had failed; it is now deliberately quieter than the rows it failed
                to draw, because that is the correct hierarchy.
              */
              <div className="sk-lg-state">
                <p className="sk-lg-state__title">{AREAS_ERROR_LABEL}</p>
                <button type="button" className="sk-lg-link sk-lg-state__action" onClick={onRetry}>
                  {AREAS_RETRY_LABEL}
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
              <p className="sk-lg-lead" style={{ maxWidth: '46ch' }}>
                {AREAS_EMPTY_LABEL}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default LandingSegmentStrip;