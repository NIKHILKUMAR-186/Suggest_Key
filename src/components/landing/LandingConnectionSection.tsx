import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import React from 'react';
import { EdgeReveal, Reveal } from '@/src/components/landing/Reveal';
import { MagneticButton } from '@/src/components/landing/landingMotion';
import {
  APPROVAL_STAMP,
  STORY_BODY,
  STORY_CTA_LABEL,
  STORY_QUOTE_LINES,
} from '@/src/components/landing/landingContent';

/**
 * THE CONVERSATION.
 *
 * The quietest passage on the page, and the one with the most room in it. It comes
 * after the mentors, so by the time a visitor reads it they have already seen real
 * faces and these sentences are reinforcement rather than a claim made on trust.
 *
 * A CROP OF THE SAME ROOM, AT A DIFFERENT SCALE.
 *
 * The hero shows the room wide, with both people and the window. This shows it
 * close, from inside the conversation, with the two figures in profile and the
 * desk edge cutting the bottom of the frame. Using the same drawn world at two
 * crops rather than two unrelated images is what makes the page feel like one
 * place rather than a stock photo album — and a foreground leaf crossing the near
 * edge is what makes a picture read as a photograph rather than as a diagram.
 *
 * The crop opens as the section arrives: a clip-path wipe from the bottom edge,
 * the picture scaling down from 1.14 as it settles, and a brightness that lifts as
 * it comes up to full. All three are compositor or paint properties, and the whole
 * sequence runs once — it does not loop, so a visitor who stays for a minute sees
 * the same finished frame they arrived at.
 *
 * IT MOVES INDEPENDENTLY OF THE TEXT.
 *
 * The picture drifts 14px against the paragraph beside it as the section scrolls,
 * which is the cheapest parallax there is and the only kind worth building: two
 * layers on different rates, so the eye reads depth rather than a moving picture.
 *
 * THE STAMP IS THE ONLY STAMP ON THE PAGE.
 *
 * Approval is what this platform actually does — an application, two documents, a
 * human review — so approval is the only thing that gets a hand-stamp. Nothing
 * else is stamped, which is the whole reason it means something.
 *
 * The copy makes no promise about outcomes. It describes the shape of the session
 * — one person, one hour, one question — which is the only thing the platform
 * actually controls.
 */

export interface LandingConnectionSectionProps {
  onFindMentor: () => void;
}

export const LandingConnectionSection: React.FC<LandingConnectionSectionProps> = ({
  onFindMentor,
}) => {
  const canAnimate = useReducedMotion() !== true;

  return (
    <section
      id="conversation"
      className="sk-lg-band sk-lg-story"
      aria-labelledby="conversation-title"
    >
      <div className="sk-lg__wrap">
        <div className="sk-lg-story__grid">
          {/* ------------------------------------------------------------------ */}
          {/* THE PICTURE                                                         */}
          {/* ------------------------------------------------------------------ */}
            {/*
              The trigger lives on the stage, not on the crop.

              Motion's `whileInView` does not fire on an element whose own
              resting style makes it invisible — and the crop's initial state is
              `inset(0 0 100% 0)`, which is exactly that. The browser's own
              IntersectionObserver reports it as fully in view; Motion's
              viewport observer never calls back, so the reveal never runs and
              the section ships permanently masked.

              Putting the trigger on the unclipped stage and letting the crop and
              the pane inherit it through variants fixes it, keeps the crop's
              timing identical, and adds no dependency. One observer, two
              children — which is the shape the rest of this page already uses.
            */}
            <motion.div
              className="sk-lg-story__stage"
              initial={canAnimate ? 'hidden' : false}
              whileInView="shown"
              viewport={{ once: true, amount: 0.25 }}
              onPointerMove={(event) => {
                /*
                  The picture's own pointer read, delegated from the React handler
                  rather than attached by the hook. It is here because the drift is a
                  pointer effect and not a scroll effect: the crop drifts 10px toward
                  the pointer and 14px against the page's scroll, and combining the
                  two into one transform is what stops them fighting.
                */
                if (!canAnimate) return;
                const box = event.currentTarget.getBoundingClientRect();
                const x = (event.clientX - (box.left + box.width / 2)) / (box.width / 2);
                const y = (event.clientY - (box.top + box.height / 2)) / (box.height / 2);
                const pane = event.currentTarget.querySelector<HTMLElement>('[data-pane]');
                if (pane) {
                  pane.style.transform = `translate3d(${x * -10}px, ${y * -8}px, 0)`;
                }
              }}
            >
              <motion.div
                className="sk-lg-story__crop"
                aria-hidden="true"
                variants={{
                  hidden: { clipPath: 'inset(0% 0% 100% 0%)' },
                  shown: { clipPath: 'inset(0% 0% 0% 0%)', transition: { duration: 1.15, ease: [0.22, 1, 0.36, 1] } },
                }}
              >
                <motion.span
                  data-pane
                  className="sk-lg-story__pane"
                  variants={{
                    hidden: { scale: 1.14, filter: 'brightness(0.62)' },
                    shown: { scale: 1, filter: 'brightness(1)', transition: { duration: 1.5, ease: [0.22, 1, 0.36, 1] } },
                  }}
                >
                  <img
                    className="sk-lg-story__photo"
                    src="/assets/landing/conversation-close.jpg"
                    alt=""
                    width={2400}
                    height={1600}
                    decoding="async"
                    loading="lazy"
                  />
                </motion.span>
                <span className="sk-lg-story__wash" />
              </motion.div>

            {/*
              The picture's caption, set in the page's own mono and clipped to the
              same crop. It names the scene rather than describing it, and it is
              decorative — the paragraph beside it makes every claim this section
              actually makes.
            */}
            <motion.span
              className="sk-lg-story__caption"
              aria-hidden="true"
              variants={{
                hidden: { opacity: 0, y: 12 },
                shown: { opacity: 1, y: 0, transition: { duration: 0.9, delay: 0.7, ease: [0.22, 1, 0.36, 1] } },
              }}
            >
              <span className="sk-lg-story__caption-rule" />
              One hour · one question · two people
            </motion.span>
          </motion.div>

          {/* ------------------------------------------------------------------ */}
          {/* THE ARGUMENT                                                        */}
          {/* ------------------------------------------------------------------ */}
          <div className="sk-lg-story__aside-text">
            {/*
              The rule comes first because it belongs to the statement, not to the
              band: it is the page's spine at this scale, and `EdgeReveal` grows it
              from its own left edge as the section arrives.
            */}
            <EdgeReveal className="sk-lg-story__rule" />

            <h2 id="conversation-title" className="sk-lg-story__quote">
              {STORY_QUOTE_LINES.map((line, index) => (
                <Reveal key={line} delay={0.06 * index}>
                  {line}
                </Reveal>
              ))}
            </h2>

            <Reveal delay={0.2}>
              <p className="sk-lg-body sk-lg-story__body">{STORY_BODY}</p>
            </Reveal>

            <Reveal delay={0.3}>
              {/*
                Plum ink rather than the default gold: this stamp sits on paper, and
                gold on paper is not a legible contrast ratio. Gold is reserved for
                the stamps that land on the dark bands.
              */}
              <span className="sk-lg-stamp sk-lg-stamp--plum">{APPROVAL_STAMP}</span>
            </Reveal>

            <Reveal delay={0.46}>
              <MagneticButton className="sk-lg-btn sk-lg-btn--violet" onClick={onFindMentor}>
                {STORY_CTA_LABEL}
                <ArrowRight className="h-4 w-4 sk-lg-btn__arrow" aria-hidden="true" />
              </MagneticButton>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
};

export default LandingConnectionSection;