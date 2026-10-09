import React from 'react';
import { motion, useScroll } from 'motion/react';
import { useReducedMotion } from './useReducedMotion';

export function ScrollProgress() {
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();

  if (reduceMotion) return null;

  return (
    <motion.div
      className="sk-motion-scroll-progress"
      style={{ scaleX: scrollYProgress }}
      aria-hidden="true"
    />
  );
}

export default ScrollProgress;
