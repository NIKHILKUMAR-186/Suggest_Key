import { motion, useReducedMotion } from 'motion/react';
import React from 'react';
import { LandingSectionHead } from '@/src/components/landing/LandingSectionHead';
import { STEPS, STEPS_TITLE } from '@/src/components/landing/landingContent';

/**
 * HOW IT WORKS — three simple cards.
 *
 * The spec asks for three compact cards on a light band: Pick your key,
 * Meet the wise, Talk, then act. Each is a white rounded card with a small
 * numbered circle, a title, and a short description. No pinned stage, no
 * SVG arc, no scroll observer — just three cards that rise as the section
 * arrives.
 */

export const LandingHowItWorks: React.FC = () => {
  const canAnimate = useReducedMotion() !== true;

  return (
    <section id="how-it-works" className="sk-lg-band sk-lg-band--paper" aria-labelledby="how-it-works-title">
      <span className="sk-lg-margin" aria-hidden="true" />

      <div className="sk-lg__wrap">
        <LandingSectionHead id="how-it-works-title" title={STEPS_TITLE} />

        <div className="sk-lg-steps--cards">
          {STEPS.map((step, index) => (
            <motion.div
              key={step.index}
              className="sk-lg-step-card"
              initial={canAnimate ? { opacity: 0, y: 24 } : false}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{
                duration: 0.72,
                delay: index * 0.1,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              <span className="sk-lg-step-card__index" aria-hidden="true">
                {step.index}
              </span>
              <h3 className="sk-lg-step-card__title">{step.title}</h3>
              <p className="sk-lg-step-card__desc">{step.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default LandingHowItWorks;
