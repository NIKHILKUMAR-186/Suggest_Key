import { useState } from 'react';
import { useNavigation } from '@/src/context/NavigationContext';
import { mentorDirectoryPath } from '@/src/lib/mentorNav';
import { formatInr } from '@/src/lib/seekerFormat';
import type { MentorDirectoryItem } from '@/src/hooks/useMentorDirectory';
import { LANDING_SEGMENTS } from '@/src/components/landing/landingSegments';
import { NewLandingFaq } from './NewLandingFaq';

/**
 * NEW LANDING PAGE — PAGE SECTIONS.
 *
 * The category cards, the how-it-works steps and the FAQ are structural copy
 * from the supplied design. The experts row is bound to the SAME real mentor
 * catalogue the legacy landing page uses (`useMentorDirectory`), so this page
 * shows real mentors, real session formats and real starting prices, and it
 * reports the same loading, error and empty states instead of inventing
 * people.
 *
 * The supplied design's "stories" row contains placeholder testimonials with
 * invented names. This page ships no testimonial source, so that row shows
 * the mentors' own headline and segment — the mentor's real, published
 * description — rather than a fabricated quote attributed to them.
 */

const STEPS = [
  [
    '1',
    'Pick your key',
    'Choose autism, relationships or career. The whole site re-tunes to what you need.',
  ],
  [
    '2',
    'Meet the wise',
    'Browse verified experts with real credentials, languages, fees and availability.',
  ],
  [
    '3',
    'Talk, then act',
    'Enquire in one tap. We confirm a time and you leave the session with a plan.',
  ],
] as const;

const CHIP_COLOURS = ['teal', 'pink', 'yellow'] as const;

/**
 * The two chips the design shows on each category card.
 *
 * These are the design's own descriptive labels for each area, keyed by the
 * segment slug so the pairing cannot drift. A segment with no entry here
 * simply shows no chips — nothing is invented to fill the row.
 */
const CATEGORY_CHIPS: Record<string, readonly [string, string]> = Object.freeze({
  autism: ['Early signs', 'Diagnosis'],
  relationship: ['Couples', 'Marriage decisions'],
  career: ['Career change', 'First job'],
});

/** Initials for the avatar fallback, taken from the mentor's real name. */
function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export interface NewLandingSectionsProps {
  mentors: MentorDirectoryItem[];
  mentorsLoading: boolean;
  mentorsError: boolean;
  onReloadMentors: () => void;
  /** Where authenticated seekers land; anonymous visitors are sent to sign-up. */
  findMentorPath: string;
}

export function NewLandingSections({
  mentors,
  mentorsLoading,
  mentorsError,
  onReloadMentors,
  findMentorPath,
}: NewLandingSectionsProps) {
  const { navigate } = useNavigation();
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <>
      {/* Category cards. Each links to the real, segment-filtered directory so
          the segment selection the visitor clicked is genuinely preserved. */}
      <main className="nlg-wrap" id="keys">
        <section className="nlg-cards" aria-label="Support areas">
          {LANDING_SEGMENTS.map((segment, index) => (
            <article className="nlg-card" key={segment.id}>
              <h3>{segment.title}</h3>
              <p>{segment.description}</p>
              <div className="nlg-card__chips">
                {(CATEGORY_CHIPS[segment.id] ?? []).map((chip) => (
                  <span
                    className={`nlg-chip nlg-chip--${CHIP_COLOURS[index] ?? 'yellow'}`}
                    key={chip}
                  >
                    {chip}
                  </span>
                ))}
              </div>
              <button
                type="button"
                className="nlg-btn nlg-btn--dark"
                onClick={() => navigate(mentorDirectoryPath({ segmentSlug: segment.id }))}
              >
                Explore {segment.title}
              </button>
            </article>
          ))}
        </section>

        {/* How it works */}
        <section className="nlg-section" id="how">
          <div className="nlg-eyebrow">How it works</div>
          <h2>Three steps to a wiser decision</h2>
          <div className="nlg-steps">
            {STEPS.map(([number, title, detail]) => (
              <article className="nlg-step" key={number}>
                <span className="nlg-step__number">{number}</span>
                <h3>{title}</h3>
                <p>{detail}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Experts — real catalogue, same data and states as the legacy page */}
        <section className="nlg-section" id="experts" aria-labelledby="experts-title">
          <div className="nlg-eyebrow">Meet the wise</div>
          <h2 id="experts-title">Experts families and professionals trust</h2>

          {mentorsLoading && <div className="nlg-stories">
            <p>Finding experts for you&hellip;</p>
          </div>}

          {mentorsError && (
            <div className="nlg-stories" role="alert">
              <p>
                Experts could not be loaded.{' '}
                <button type="button" onClick={onReloadMentors}>
                  Try again
                </button>
              </p>
            </div>
          )}

          {!mentorsLoading && !mentorsError && mentors.length === 0 && (
            <div className="nlg-stories">
              <p>No experts are available yet.</p>
            </div>
          )}

          {!mentorsLoading && !mentorsError && mentors.length > 0 && (
            <div className="nlg-experts">
              {mentors.slice(0, 4).map((item) => {
                const mentor = item.mentor;
                const segmentName =
                  mentor.segments[0]?.name || mentor.expertise?.[0] || 'Mentor';
                return (
                  <article className="nlg-expert" key={mentor.id}>
                    <div className="nlg-expert__top">
                      <span className="nlg-expert__avatar">
                        {mentor.avatar_url ? (
                          <img src={mentor.avatar_url} alt="" loading="lazy" />
                        ) : (
                          initials(mentor.full_name)
                        )}
                      </span>
                      <div>
                        <b>{mentor.full_name}</b>
                        <small>{segmentName}</small>
                      </div>
                    </div>
                    <p>{mentor.headline || mentor.about || segmentName}</p>
                    <div className="nlg-expert__price">
                      <span>{segmentName}</span>
                      <b>
                        {mentor.starting_price_inr == null
                          ? 'See sessions'
                          : formatInr(mentor.starting_price_inr)}
                      </b>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {!mentorsLoading && !mentorsError && mentors.length > 0 && (
            <div className="nlg-section">
              <button
                type="button"
                className="nlg-btn nlg-btn--dark"
                onClick={() => navigate(mentorDirectoryPath())}
              >
                Browse every expert
              </button>
            </div>
          )}
        </section>

        {/* Profiles shown through the design's dark-story card treatment. The
            text is the mentor's own published headline, never an invented
            testimonial. */}
        <section className="nlg-section" aria-labelledby="stories-title">
          <div className="nlg-eyebrow">Stories</div>
          <h2 id="stories-title">What people say after one session</h2>
          {mentorsLoading || mentorsError || mentors.length === 0 ? (
            <div className="nlg-stories">
              <p>
                {mentorsError
                  ? 'Profiles could not be loaded.'
                  : mentorsLoading
                    ? 'Loading profiles\u2026'
                    : 'No profiles are available yet.'}
              </p>
            </div>
          ) : (
            <div className="nlg-stories">
              {mentors.slice(0, 3).map((item) => {
                const mentor = item.mentor;
                const segmentName = mentor.segments[0]?.name || 'Mentor';
                return (
                  <article className="nlg-story" key={mentor.id}>
                    <p>{mentor.headline || mentor.about || segmentName}</p>
                    <small>
                      {mentor.full_name} &middot; {segmentName}
                    </small>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <NewLandingFaq openFaq={openFaq} onToggle={setOpenFaq} />

        {/* CTA */}
        <section className="nlg-cta">
          <div>
            <h2>Not sure which key is yours?</h2>
            <p>
              Tell us what is going on in two lines. A Suggest Key guide will
              point you to the right expert, free.
            </p>
          </div>
          <div className="nlg-cta__actions">
            <button
              type="button"
              className="nlg-btn nlg-btn--dark"
              onClick={() => navigate(findMentorPath)}
            >
              Ask the Wise
            </button>
            <button
              type="button"
              className="nlg-btn nlg-btn--white"
              onClick={() => navigate(mentorDirectoryPath())}
            >
              Compare experts
            </button>
          </div>
        </section>
      </main>
    </>
  );
}
