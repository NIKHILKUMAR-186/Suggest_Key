import { ArrowRight } from 'lucide-react';
import React from 'react';
import { HeroConversationVisual } from '@/src/components/landing/HeroConversationVisual';
import { LineReveal, Reveal, Stagger, StaggerItem } from '@/src/components/landing/Reveal';
import { HERO_IMAGE } from '@/src/components/landing/landingImages';
import {
  HERO_BODY,
  HERO_EYEBROW,
  HERO_PRIMARY_LABEL,
  HERO_PROOF,
  HERO_TITLE_LINES,
} from '@/src/components/landing/landingContent';

/**
 * THE HERO.
 *
 * One sentence, one promise, one action. The whole page is engineered so a
 * visitor who never scrolls still knows what this is: an eyebrow that names the
 * format, a headline that names the outcome, a sentence that names the
 * mechanism, and exactly one button.
 *
 * There is deliberately no second action here. A visitor who has not yet chosen
 * a mentor and a visitor who wants to become one are at very different points,
 * and offering both at the same weight would split the only conversion this
 * page has. "Become a mentor" is a footer link, where it can be chosen without
 * competing.
 *
 * The entrance is ordered rather than simultaneous: the bar settles, the
 * photograph resolves out of a soft frame, the label appears, the headline
 * arrives line by line out of its own mask, then the copy, the action and the
 * proof line follow. The whole thing is settled inside about a second and a
 * quarter. Nothing here loops, and every step is a transform or an opacity, so
 * the sequence costs one composited frame.
 *
 * The photograph is the full-bleed field on desktop and a wide band on mobile.
 * That is a different composition, not a smaller one: on a phone the headline
 * and the action need the whole width, so the image moves underneath them
 * instead of competing with them.
 */

export interface LandingHeroProps {
  onFindMentor: () => void;
}

export const LandingHero: React.FC<LandingHeroProps> = ({ onFindMentor }) => {
  return (
    <section
      className="sk-lp-hero sk-lp-on-plum"
      aria-labelledby="sk-lp-hero-title"
      /**
       * The same photograph that fills the desktop hero is laid behind the copy
       * on small screens. The path is handed over from the image manifest rather
       * than repeated in the stylesheet, so the file it points at can only ever
       * be the one the band below is already loading.
       */
      style={{ '--sk-lp-hero-atmosphere': `url(${HERO_IMAGE.src})` } as React.CSSProperties}
    >
      <div className="sk-lp-wrap">
        <div className="sk-lp-hero__grid">
          <div className="sk-lp-hero__copy">
            <Reveal delay={0.18} y={10}>
              <p className="sk-lp-eyebrow">{HERO_EYEBROW}</p>
            </Reveal>

            <h1 id="sk-lp-hero-title" className="sk-lp-display sk-lp-display--xl mt-6">
              <LineReveal lines={HERO_TITLE_LINES} delay={0.26} step={0.1} />
            </h1>

            <Reveal delay={0.48}>
              <p className="sk-lp-lead mt-7 max-w-[46ch]">{HERO_BODY}</p>
            </Reveal>

            <Stagger className="sk-lp-hero__actions" step={0.09} delay={0.56}>
              <StaggerItem>
                <button type="button" className="sk-lp-btn sk-lp-btn--gold" onClick={onFindMentor}>
                  {HERO_PRIMARY_LABEL}
                  <ArrowRight className="h-4 w-4 sk-lp-btn__arrow" aria-hidden="true" />
                </button>
              </StaggerItem>
            </Stagger>

            <Reveal delay={0.68}>
              <ul className="sk-lp-hero__proof">
                {HERO_PROOF.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Reveal>
          </div>
        </div>
      </div>

      <HeroConversationVisual isFullBleed />
    </section>
  );
};