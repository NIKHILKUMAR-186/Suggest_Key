import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import React from 'react';
import { EdgeReveal, Reveal } from '@/src/components/landing/Reveal';
import { MagneticButton } from '@/src/components/landing/landingMotion';
import { FINAL_TITLE, HERO_PRIMARY_LABEL } from '@/src/components/landing/landingContent';

/**
 * FINAL CALL — yellow block.
 *
 * The spec asks for a large yellow CTA block with:
 * - LEFT: large heading, short supporting paragraph
 * - RIGHT: dark purple primary button, white secondary button
 *
 * We keep the plum final band's entrance animation and replace its fill with
 * the brand gold, so the page still closes with the same weight but in the
 * colour the reference screenshot shows.
 */

export interface LandingFinalCtaProps {
  onFindMentor: () => void;
}

export const LandingFinalCta: React.FC<LandingFinalCtaProps> = ({ onFindMentor }) => {
  const canAnimate = useReducedMotion() !== true;

  return (
    <section className="sk-lg-band sk-lg-final sk-lg-final--yellow" aria-labelledby="sk-lg-final-title">
      <div className="sk-lg__wrap">
        <div className="sk-lg-cta-block">
          <div className="sk-lg-cta-block__text">
            <EdgeReveal className="sk-lg-head__rule sk-lg-head__rule--edge" delay={0.06} />
            <h2 id="sk-lg-final-title" className="sk-lg-cta-block__title">
              {FINAL_TITLE}
            </h2>
            <p className="sk-lg-cta-block__body">
              Browse mentors, read their profiles, and book the hour that works.
            </p>
          </div>
          <div className="sk-lg-cta-block__actions">
            <MagneticButton className="sk-lg-btn sk-lg-btn--plum sk-lg-btn--lg" onClick={onFindMentor}>
              {HERO_PRIMARY_LABEL}
              <ArrowRight className="h-4 w-4 sk-lg-btn__arrow" aria-hidden="true" />
            </MagneticButton>
            <MagneticButton className="sk-lg-btn sk-lg-btn--white sk-lg-btn--lg" onClick={onFindMentor}>
              How it works
            </MagneticButton>
          </div>
        </div>
      </div>
    </section>
  );
};

export default LandingFinalCta;
