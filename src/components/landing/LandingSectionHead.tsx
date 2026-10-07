import React from 'react';
import { motion } from 'motion/react';
import { EdgeReveal, useCanAnimate } from '@/src/components/landing/Reveal';

/**
 * A SECTION HEAD.
 *
 * A heading, its sentence, and the rule it rests on. No eyebrow: a kicker above
 * a heading is a label asking to be read before the sentence that actually
 * carries the meaning, and every heading on this page is strong enough to speak
 * for itself without one.
 *
 * The rule is the page's own gesture. It draws itself as the section arrives,
 * violet fading out along its length, and it is the same mark under every head —
 * which is most of what makes eight differently composed sections read as one
 * system rather than as eight designs stacked on top of each other.
 *
 * THE HEAD ARRIVES IN THE ORDER IT IS READ.
 *
 * Heading, then sentence, then rule. On a wide viewport the sentence sits BESIDE
 * the heading, so the sequence tells the eye which is the claim and which is the
 * support. No character animation: a heading that assembles letter by letter is
 * unreadable at the one moment it is being read for the first time.
 *
 * On wide viewports the sentence sets beside the heading rather than under it,
 * because a two-column head uses the width the page already has instead of
 * pushing the first content row further down the sheet.
 */

/** The hero's one easing curve, matched to the rest of the page. */
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export interface LandingSectionHeadProps {
  id: string;
  title: string;
  /**
   * Optional, because not every section earns one.
   *
   * "How it works." is a complete sentence and adding a sentence under it would
   * only restate the heading. A section that has something to say passes it; a
   * section whose heading says everything omits it rather than padding the head.
   */
  body?: string;
  /** Renders the heading at statement scale instead of section scale. */
  variant?: 'section' | 'statement';
  className?: string;
}

export const LandingSectionHead: React.FC<LandingSectionHeadProps> = ({
  id,
  title,
  body,
  variant = 'section',
  className,
}) => {
  const canAnimate = useCanAnimate();

  /* Animated in place: `.sk-lg-head__copy` is `flex: 0 1 42ch` and the lead is a
     direct flex child, so a wrapper div around either would change the layout. */
  const rise = canAnimate
    ? {
        initial: { opacity: 0, y: 22 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: true, amount: 0.35 },
      }
    : {};

  return (
    <div className={`sk-lg-head ${className ?? ''}`}>
      <div className="sk-lg-head__body">
        <div className="sk-lg-head__copy">
          <motion.h2
            id={id}
            className={`sk-lg-display ${
              variant === 'statement' ? 'sk-lg-display--statement' : 'sk-lg-display--section'
            }`}
            {...rise}
            transition={{ duration: 0.78, ease: EASE }}
          >
            {title}
          </motion.h2>
        </div>

        {body && (
          <motion.p className="sk-lg-lead" {...rise} transition={{ duration: 0.78, delay: 0.09, ease: EASE }}>
            {body}
          </motion.p>
        )}
      </div>

      {/* A keyframe would draw this the moment the document parses, so a rule six
          sections down was finished before its section was ever seen. */}
      <EdgeReveal className="sk-lg-head__rule sk-lg-head__rule--edge" delay={0.16} />
    </div>
  );
};

export default LandingSectionHead;