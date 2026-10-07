import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, MessageCircle, CalendarClock, Search, Users, Target } from 'lucide-react';
import React from 'react';
import type { Segment } from '@/src/types/database';
import { MagneticButton } from '@/src/components/landing/landingMotion';
import {
  HERO_BODY,
  HERO_EYEBROW,
  HERO_PRIMARY_LABEL,
  HERO_SECONDARY_LABEL,
  HERO_SECONDARY_TARGET,
  HERO_TITLE_LINES,
} from '@/src/components/landing/landingContent';

const TOPIC_PILLS = [
  { label: 'Career', icon: Target },
  { label: 'Relationships', icon: MessageCircle },
  { label: 'Health', icon: CalendarClock },
  { label: 'Finance', icon: Search },
  { label: 'Growth', icon: Users },
] as const;

export interface LandingHeroProps {
  onFindMentor: () => void;
}

export const LandingHero: React.FC<LandingHeroProps> = ({ onFindMentor }) => {
  const reducedMotion = useReducedMotion();
  const canAnimate = reducedMotion !== true;
  const scrollBehavior: ScrollBehavior = canAnimate ? 'smooth' : 'auto';

  const scrollToJourney = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    document.getElementById(HERO_SECONDARY_TARGET)?.scrollIntoView({ behavior: scrollBehavior });
  };

  return (
    <section
      className="sk-lg-hero"
      aria-labelledby="hero-title"
    >
      {/* Background scene with hero.png */}
      <div className="sk-lg-hero__scene" aria-hidden="true">
        <motion.div
          className="sk-lg-hero__scene-crop"
          initial={canAnimate ? { clipPath: 'inset(5% 3% 5% 3%)' } : false}
          animate={{ clipPath: 'inset(0% 0% 0% 0%)' }}
          transition={{ duration: 1.5, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="sk-lg-hero__scene-pane">
            <motion.img
              className="sk-lg-hero__photo"
              src="/assets/landing/hero.png"
              alt=""
              width={2400}
              height={1600}
              role="presentation"
              decoding="async"
              fetchPriority="high"
              initial={canAnimate ? { opacity: 0, scale: 1.06 } : false}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1.8, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
        </motion.div>
        <span className="sk-lg-hero__scene-wash" />
        <span className="sk-lg-hero__scene-vignette" />
      </div>

      {/* Floating topic pills - positioned over the scene */}
      <div className="sk-lg-hero__pills" aria-hidden="true">
        {TOPIC_PILLS.map(({ label, icon: Icon }, index) => (
          <motion.span
            key={label}
            className="sk-lg-hero__pill"
            style={pillPositionStyles[index] as React.CSSProperties}
            initial={canAnimate ? { opacity: 0, scale: 0.9, y: 20 } : false}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.6 + index * 0.08, ease: [0.22, 1, 0.36, 1] }}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {label}
          </motion.span>
        ))}
      </div>

      <div className="sk-lg__wrap">
        <div className="sk-lg-hero__grid">
          {/* THE COPY */}
          <div className="sk-lg-hero__copy">
            <motion.p
              className="sk-lg-eyebrow"
              initial={canAnimate ? { opacity: 0, y: 14 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            >
              <span className="sk-lg-eyebrow__rule" aria-hidden="true" />
              {HERO_EYEBROW}
            </motion.p>

            <h1 id="hero-title" className="sk-lg-display sk-lg-display--hero sk-lg-hero__title">
              {HERO_TITLE_LINES.map((line, index) => (
                <span key={line} className="sk-lg-hero__line">
                  <motion.span
                    className="sk-lg-hero__line-in"
                    initial={canAnimate ? { y: '108%' } : false}
                    animate={{ y: '0%' }}
                    transition={{
                      duration: 0.92,
                      delay: 0.12 + index * 0.11,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                  >
                    {line === "figuring out."
                      ? <span className="sk-lg-hero__highlight">{line}</span>
                      : line}
                  </motion.span>
                </span>
              ))}
            </h1>

            <motion.p
              className="sk-lg-lead sk-lg-hero__body"
              initial={canAnimate ? { opacity: 0, y: 18 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.42, ease: [0.22, 1, 0.36, 1] }}
            >
              {HERO_BODY}
            </motion.p>

            <motion.div
              className="sk-lg-hero__actions"
              initial={canAnimate ? { opacity: 0, y: 18 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.56, ease: [0.22, 1, 0.36, 1] }}
            >
              <MagneticButton className="sk-lg-btn sk-lg-btn--gold sk-lg-btn--lg" onClick={onFindMentor}>
                {HERO_PRIMARY_LABEL}
                <ArrowRight className="h-4 w-4 sk-lg-btn__arrow" aria-hidden="true" />
              </MagneticButton>

              <a
                href={`/#${HERO_SECONDARY_TARGET}`}
                className="sk-lg-btn sk-lg-btn--ghost"
                onClick={scrollToJourney}
              >
                {HERO_SECONDARY_LABEL}
              </a>
            </motion.div>

            {/* Trust indicators */}
            <motion.div
              className="sk-lg-hero__trust"
              initial={canAnimate ? { opacity: 0, y: 18 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.7, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="sk-lg-hero__trust-item">
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                <span>Private 1:1 conversations</span>
              </div>
              <div className="sk-lg-hero__trust-divider" aria-hidden="true" />
              <div className="sk-lg-hero__trust-item">
                <CalendarClock className="h-4 w-4" aria-hidden="true" />
                <span>Verified mentors</span>
              </div>
              <div className="sk-lg-hero__trust-divider" aria-hidden="true" />
              <div className="sk-lg-hero__trust-item">
                <Target className="h-4 w-4" aria-hidden="true" />
                <span>Structured outcomes</span>
              </div>
            </motion.div>
          </div>

          {/* Right side - Visual is now the scene background */}
        </div>
      </div>

      {/* Scroll cue */}
      <motion.div
        className="sk-lg-hero__cue"
        aria-hidden="true"
        initial={canAnimate ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 1.1 }}
      >
        <motion.span
          className="sk-lg-hero__cue-rule"
          style={canAnimate ? { scaleX: 1 } : { scaleX: 1 }}
        />
        <span className="sk-lg-hero__cue-word">Scroll</span>
      </motion.div>
    </section>
  );
};

const pillPositionStyles: React.CSSProperties[] = [
  { top: '18%', left: '8%', transform: 'translate(-50%, -50%)' },
  { top: '12%', right: '10%', transform: 'translate(50%, -50%)' },
  { top: '55%', left: '5%', transform: 'translate(-50%, -50%)' },
  { bottom: '15%', right: '8%', transform: 'translate(50%, 50%)' },
  { bottom: '22%', left: '50%', transform: 'translate(-50%, 50%)' },
];

export default LandingHero;