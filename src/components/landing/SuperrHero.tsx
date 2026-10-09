import React, { useState } from 'react';
import { ArrowDown, ArrowRight } from 'lucide-react';
import { MagneticButton, Reveal, SplitText, landingMotion, useReducedMotion } from '@/src/components/landing/motion';
import { useNavigation } from '@/src/context/NavigationContext';
import { HandArrow, NotebookScene, StickerBolt, StickerHeart, StickerSparkle } from '@/src/components/landing/SuperrStickers';
import { mentorSegmentLabel, mentorSessionLabel } from '@/src/components/landing/mentorMeta';
import type { MentorDirectoryItem } from '@/src/hooks/useMentorDirectory';

/**
 * THE HERO.
 *
 * A two-column editorial split, left-aligned throughout. The left holds a
 * handwritten caption, the display headline, the lede, the single pill action
 * and a quiet info line. The right holds the hero object: a tilted frame
 * carrying a laminated name label — the schoolyard notebook's own vocabulary,
 * applied to a real mentor so nothing here is decorative invention.
 *
 * ENTRANCE CHOREOGRAPHY.
 * Caption, then headline lines, then the visual, then lede, CTA and info — the
 * order the page is read in. The headline rises out of an overflow mask so the
 * type is never animated word by word at the one moment it is being read for
 * the first time. With `prefers-reduced-motion` every step resolves to its
 * final state and the copy is simply present.
 */

export interface SuperrHeroProps {
  /** The real mentor shown on the name label; null until the directory answers. */
  featured: MentorDirectoryItem | null;
  /** Where the primary action leads. */
  findMentorPath: string;
}

export function SuperrHero({ featured, findMentorPath }: SuperrHeroProps) {
  const { navigate } = useNavigation();
  const reduceMotion = useReducedMotion();
  const [portraitFailed, setPortraitFailed] = useState(false);
  const mentor = featured?.mentor ?? null;
  const portraitUrl = mentor?.avatar_url ?? null;
  const showPortrait = Boolean(portraitUrl) && !portraitFailed;

  return (
    <section className="landing-hero" aria-labelledby="hero-title">
      <div className="landing-wrap">
        <div className="landing-hero__head">
          <Reveal className="landing-hero__caption" mode="lift" playOnMount delay={0.05}>
            <span className="landing-handnote">figuring it out?</span>
            <HandArrow />
          </Reveal>

          <h1
            id="hero-title"
            className="landing-hero__title"
            aria-label="find a mentor for the thing you're stuck on."
          >
            <SplitText mode="line" playOnMount delay={landingMotion.stagger.hero} text="find a mentor" />
            <SplitText mode="line" playOnMount delay={landingMotion.stagger.hero * 1.8} text="for the thing" />
            <SplitText mode="line" playOnMount delay={landingMotion.stagger.hero * 2.6} text="you&rsquo;re stuck on." />
          </h1>
        </div>

        <div className="landing-hero__body">
          <div className="landing-hero__copy">
            <Reveal as="p" className="landing-hero__lede" mode="lift" playOnMount delay={0.44}>
              Suggest Key is a 1:1 mentorship marketplace. Bring the question, decision, or challenge you are
              sitting with, meet someone who has <span className="landing-em">lived</span> a version of it, and
              leave with one useful next step.
            </Reveal>

            <Reveal className="landing-hero__actions" mode="lift" playOnMount delay={0.54}>
              <MagneticButton
                className="landing-button landing-button--lg"
                onClick={() => {
                  navigate(findMentorPath);
                }}
              >
                Find a mentor <ArrowRight size={17} aria-hidden="true" />
              </MagneticButton>
              <a
                className="landing-text-link"
                href="#how-it-works"
                onClick={(event) => {
                  event.preventDefault();
                  document.getElementById('how-it-works')?.scrollIntoView({
                    behavior: reduceMotion ? 'auto' : 'smooth',
                    block: 'start',
                  });
                  window.history.replaceState(null, '', '#how-it-works');
                }}
              >
                How it works <ArrowRight size={17} aria-hidden="true" />
              </a>
            </Reveal>

            <Reveal as="p" className="landing-hero__info" mode="lift" playOnMount delay={0.62}>
              1:1 sessions &middot; 30&ndash;120 min &middot; booked in your timezone
            </Reveal>
          </div>

          <Reveal className="landing-hero__visual" mode="lift" playOnMount delay={0.3}>
            <div className="landing-hero__frame">
              {/* The image reveal is scoped to the media so the stickers, which
                  deliberately break the frame's edges, are never clipped by it. */}
              <Reveal as="span" className="landing-hero__media" mode="clip" playOnMount delay={0.36}>
                {showPortrait ? (
                  <img
                    src={portraitUrl as string}
                    alt=""
                    decoding="async"
                    onError={() => setPortraitFailed(true)}
                  />
                ) : (
                  <NotebookScene />
                )}
              </Reveal>
            </div>

            <Reveal className="landing-hero__label" mode="lift" playOnMount delay={0.58}>
              <dl>
                <div className="landing-hero__label-row">
                  <dt>Name</dt>
                  <dd className="landing-hero__label-name">{mentor?.full_name ?? 'your mentor'}</dd>
                </div>
                <div className="landing-hero__label-row">
                  <dt>Class</dt>
                  <dd>{mentor && featured ? mentorSegmentLabel(featured) : 'mentorship'}</dd>
                </div>
                <div className="landing-hero__label-row">
                  <dt>Session</dt>
                  <dd>{mentor && featured ? mentorSessionLabel(featured) : '1:1 conversation'}</dd>
                </div>
              </dl>
            </Reveal>

            <Reveal as="span" className="landing-sticker landing-sticker--bolt" mode="settle" playOnMount delay={0.78}>
              <StickerBolt />
            </Reveal>
            <Reveal as="span" className="landing-sticker landing-sticker--sparkle" mode="settle" playOnMount delay={0.9}>
              <StickerSparkle />
            </Reveal>
            <Reveal as="span" className="landing-sticker landing-sticker--heart" mode="settle" playOnMount delay={1.02}>
              <StickerHeart />
            </Reveal>
          </Reveal>
        </div>
      </div>

      <div className="landing-wrap">
        <Reveal className="landing-hero__scroll" mode="settle" playOnMount delay={0.9}>
          <span>scroll</span>
          <ArrowDown size={15} aria-hidden="true" />
        </Reveal>
      </div>
    </section>
  );
}

export default SuperrHero;
