import React, { useEffect, useRef, useState } from 'react';
import { motion, useScroll, useTransform } from 'motion/react';
import { useReducedMotion } from './useReducedMotion';

interface ParallaxProps {
  children: React.ReactNode;
  className?: string;
  distance?: number;
}

export function Parallax({
  children,
  className,
  distance = 24,
}: ParallaxProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const [smallScreen, setSmallScreen] = useState(true);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });
  const y = useTransform(scrollYProgress, [0, 1], [-distance, distance]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => setSmallScreen(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return (
    <motion.div
      ref={ref}
      className={className}
      style={{ y: reduceMotion || smallScreen ? 0 : y }}
    >
      {children}
    </motion.div>
  );
}
