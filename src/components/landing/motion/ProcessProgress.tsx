import React from 'react';
import { motion, useScroll, useSpring } from 'motion/react';
import { landingMotion } from './tokens';
import { useReducedMotion } from './useReducedMotion';

interface ProcessProgressProps {
  target: React.RefObject<HTMLElement | null>;
}

export function ProcessProgress({ target }: ProcessProgressProps) {
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target,
    offset: landingMotion.scroll.process,
  });
  const progress = useSpring(scrollYProgress, landingMotion.spring);

  return (
    <motion.span
      className="landing-steps__progress"
      aria-hidden="true"
      style={{ scaleX: reduceMotion ? 0 : progress }}
    />
  );
}

export default ProcessProgress;
