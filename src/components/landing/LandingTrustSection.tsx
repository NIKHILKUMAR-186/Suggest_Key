import { motion, useReducedMotion } from 'motion/react';
import React from 'react';
import { Reveal } from '@/src/components/landing/Reveal';
import {
  TRUST_TITLE,
  WHY_ITEMS,
  WHY_STATEMENT,
} from '@/src/components/landing/landingContent';

/**
 * WHY SUGGEST KEY — the trust story, told once and told here.
 *
 * This section describes the mechanism, not a promise. The model is
 * `mentor_applications` plus `mentor_verification_documents`, two configured
 * document types — a government-issued photo ID and a relevant qualification —
 * an admin review queue, and a directory that only returns approved, active
 * profiles. Everything below is that, stated plainly.
 *
 * Nothing here claims a certification, an accreditation or an outcome the platform
 * cannot evidence, and there is no trust badge wall: a row of invented logos or
 * counts would undo the honesty of the sentence next to them.
 *
 * THIS IS WHERE THE VERIFICATION CLAIM LIVES NOW.
 *
 * The same three facts were once printed as bullets under the hero's buttons. They
 * are true, and they belong here rather than above the fold: "can I trust these
 * people" is a question a visitor asks after they have decided the page is about
 * mentors, not while they are still finding out what the page is. Moving them here
 * also means the hero says one thing instead of five.
 *
 * AN EDITORIAL SPLIT, NOT THREE CARDS.
 *
 * The left column makes one claim at statement scale and holds it. The right
 * column carries the three mechanisms that make it true, on ruled rows, entering
 * one at a time as the visitor descends.
 *
 * Cards would be wrong here for the same reason they were wrong on the previous
 * version of this section: three cards make three claims look like three features
 * that could ship independently, and these three are not independent. Relevant
 * experience is what makes a focused conversation possible; a focused conversation
 * is what makes choosing a time worth anything. They are one argument in three
 * clauses, and the layout says so by refusing to separate them into boxes.
 *
 * Each row is one sentence. The paragraphs that used to sit here named every
 * document type, the upload flow and the review queue in detail; the accuracy was
 * never the problem and the length was. What remains is the shortest form each
 * fact survives.
 *
 * On a phone the split collapses to one column and the statement leads, because a
 * heading above three points is the only reading order that works at 390px.
 */

export const LandingTrustSection: React.FC = () => {
  const canAnimate = useReducedMotion() !== true;

  return (
    <section id="why" className="sk-lg-band sk-lg-why" aria-labelledby="why-title">
      <span className="sk-lg-margin" aria-hidden="true" />

      <div className="sk-lg__wrap">
        <div className="sk-lg-why__layout">
          {/* ------------------------------------------------------------------ */}
          {/* THE CLAIM                                                           */}
          {/* ------------------------------------------------------------------ */}
          <div className="sk-lg-why__claim">
            {/*
              The claim rises first and the statement follows it, because the
              statement is the argument the heading is promising: read in the other
              order, the paragraph arrives before the thing it is defending.
            */}
            <motion.h2
              id="why-title"
              className="sk-lg-why__title"
              initial={canAnimate ? { opacity: 0, y: 22 } : false}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 0.78, ease: [0.22, 1, 0.36, 1] }}
            >
              {TRUST_TITLE}
            </motion.h2>

            {/*
              The statement is what this section asserts and the heading above is
              the promise it keeps. They are separate strings because they do
              different jobs, and they are set at two different scales because a
              reader should be able to stop after either one.
            */}
            <Reveal delay={0.08}>
              <p className="sk-lg-why__statement">{WHY_STATEMENT}</p>
            </Reveal>
          </div>

          {/* ------------------------------------------------------------------ */}
          {/* THE THREE MECHANISMS                                                */}
          {/* ------------------------------------------------------------------ */}
          <ol className="sk-lg-why__list">
            {WHY_ITEMS.map((item, index) => (
              <motion.li
                key={item.title}
                className="sk-lg-why__item"
                initial={canAnimate ? { opacity: 0, y: 20 } : false}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ duration: 0.75, delay: index * 0.09, ease: [0.22, 1, 0.36, 1] }}
              >
                {/*
                  The line draws itself across the top of each clause as it arrives,
                  from the left edge outward. It is the page's one repeated gesture
                  and it is what makes three separately-revealed rows read as one
                  list rather than as three things that happened to appear.
                */}
                <span className="sk-lg-why__line" aria-hidden="true" />

                <span className="sk-lg-why__index" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>

                <h3 className="sk-lg-why__item-title">{item.title}</h3>
                <p className="sk-lg-why__text">{item.description}</p>
              </motion.li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
};

export default LandingTrustSection;