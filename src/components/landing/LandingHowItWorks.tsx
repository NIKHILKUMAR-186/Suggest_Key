import React from 'react';
import { LandingSectionHead } from '@/src/components/landing/LandingSectionHead';
import { Reveal } from '@/src/components/landing/Reveal';
import { STEPS, STEPS_BODY, STEPS_EYEBROW, STEPS_TITLE } from '@/src/components/landing/landingContent';

/**
 * HOW IT WORKS.
 *
 * Four steps, rendered as a ruled editorial list rather than four cards. The
 * reference system treats a numbered sequence as a ledger: a hairline above the
 * group, a hairline between rows, an oversized numeral as the anchor and the
 * sentence itself set small beside it. Cards would have implied these steps are
 * separable, and padded everything into boxes for no gain.
 *
 * The numerals are decorative. They repeat an ordered list the DOM already
 * conveys, so they are hidden from assistive technology rather than announced as
 * "01" between two headings.
 *
 * Every step describes the shipped flow: choose an area, browse approved
 * mentors, take an opened slot, hold the session. Nothing here promises a
 * feature that does not exist.
 */

export const LandingHowItWorks: React.FC = () => (
  <section
    id="how-it-works"
    className="sk-lp-section"
    style={{ background: 'var(--sk-lp-surface)' }}
    aria-labelledby="how-it-works-title"
  >
    <div className="sk-lp-wrap">
      <LandingSectionHead
        id="how-it-works"
        eyebrow={STEPS_EYEBROW}
        title={STEPS_TITLE}
        body={STEPS_BODY}
      />

      <ol className="sk-lp-steps">
        {STEPS.map((step, index) => (
          <Reveal
            as="li"
            key={step.index}
            delay={index * 0.06}
            className="sk-lp-step"
            y={22}
          >
            <div className="sk-lp-step__title-col">
              <span className="sk-lp-numeral" aria-hidden="true">
                {step.index}
              </span>
            </div>

            <div className="sk-lp-step__text-col">
              <h3 className="sk-lp-step__title">{step.title}</h3>
              <p className="sk-lp-step__desc mt-3">{step.description}</p>
            </div>
          </Reveal>
        ))}
      </ol>
    </div>
  </section>
);