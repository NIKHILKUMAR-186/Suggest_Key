import { ArrowRight } from 'lucide-react';
import React from 'react';
import { LineReveal, Reveal } from '@/src/components/landing/Reveal';
import {
  FINAL_BODY,
  FINAL_EYEBROW,
  FINAL_TITLE,
  HERO_PRIMARY_LABEL,
} from '@/src/components/landing/landingContent';

/**
 * FINAL CALL.
 *
 * The page ends on the brand field rather than on a card, at the same plum the
 * hero opened with — so the whole scroll reads as one movement from the first
 * photograph to the last invitation, closed by the single gold hairline that runs
 * across the top of this section.
 *
 * It is the one place allowed to be loud. The hero is a photograph with type on
 * it; this is type on a field, set larger than any other section, with the single
 * gold action underneath it. Nothing competes with that button, because the
 * button is the point of the page.
 *
 * The wash behind it breathes once on reveal — a slow, wide, low-amplitude drift
 * on a single transform — and stops. It is disabled outright under reduced
 * motion, and it never loops, so a visitor who stays on the page for a minute
 * sees the same frame they arrived at.
 */

export interface LandingFinalCtaProps {
  onFindMentor: () => void;
}

export const LandingFinalCta: React.FC<LandingFinalCtaProps> = ({ onFindMentor }) => (
  <section className="sk-lp-final sk-lp-on-plum" aria-labelledby="sk-lp-final-title">
    <div className="sk-lp-wrap">
      <div className="sk-lp-final__inner">
        <Reveal y={10}>
          <p className="sk-lp-eyebrow">{FINAL_EYEBROW}</p>
        </Reveal>

        <h2
          id="sk-lp-final-title"
          className="sk-lp-display sk-lp-display--lg sk-lp-display--final mt-6 text-balance"
        >
          <LineReveal lines={[FINAL_TITLE]} />
        </h2>

        <Reveal delay={0.22}>
          <p className="sk-lp-lead mx-auto mt-6 max-w-[46ch]">{FINAL_BODY}</p>
        </Reveal>

        <Reveal delay={0.32}>
          <div className="sk-lp-final__actions">
            <button
              type="button"
              className="sk-lp-btn sk-lp-btn--gold sk-lp-btn--lg"
              onClick={onFindMentor}
            >
              {HERO_PRIMARY_LABEL}
              <ArrowRight className="h-4 w-4 sk-lp-btn__arrow" aria-hidden="true" />
            </button>
          </div>
        </Reveal>
      </div>
    </div>
  </section>
);
