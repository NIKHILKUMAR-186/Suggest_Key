import React, { useRef } from 'react';
import { motion, useInView } from 'motion/react';
import { landingMotion } from './tokens';
import { useReducedMotion } from './useReducedMotion';

type RevealTag = 'article' | 'div' | 'footer' | 'header' | 'h2' | 'li' | 'p' | 'section' | 'span';
type RevealMode = 'blur' | 'clip' | 'lift' | 'mask' | 'settle' | 'stagger';

interface RevealProps {
  as?: RevealTag;
  children: React.ReactNode;
  className?: string;
  delay?: number;
  mode?: RevealMode;
  /**
   * Animate on mount instead of waiting for the viewport.
   *
   * Above-the-fold content is already in view when the component mounts, so a
   * viewport trigger would resolve in the same frame and never animate. This
   * prop gives that content a real entrance by making the reveal frames the
   * element's initial state.
   */
  playOnMount?: boolean;
  /** Viewport share that counts as "seen". Lowered for tall panels. */
  amount?: number;
}

const revealFrames: Record<RevealMode, Record<string, number[] | string[]>> = {
  blur: { filter: ['blur(2px)', 'blur(0px)'] },
  clip: { clipPath: ['inset(0% 8% 0% 0%)', 'inset(0% 0% 0% 0%)'] },
  lift: { opacity: [0, 1], y: [18, 0] },
  mask: { clipPath: ['inset(0% 0% 8% 0%)', 'inset(0% 0% 0% 0%)'] },
  settle: { opacity: [0.92, 1], y: [7, 0] },
  stagger: { opacity: [0.94, 1], y: [4, 0] },
};

export function Reveal({
  as = 'div',
  children,
  className,
  delay = 0,
  mode = 'settle',
  playOnMount = false,
  amount = 0.18,
}: RevealProps) {
  const ref = useRef<HTMLElement>(null);
  const setRef = (element: HTMLElement | null) => {
    ref.current = element;
  };
  const inView = useInView(ref, { once: true, amount });
  const reduceMotion = useReducedMotion();
  const MotionTag = motion[as];
  const frames = revealFrames[mode];

  return (
    <MotionTag
      ref={setRef}
      className={className}
      initial={playOnMount && !reduceMotion ? frames : false}
      animate={reduceMotion ? {} : playOnMount ? frames : inView ? frames : {}}
      transition={{
        duration: landingMotion.duration.reveal,
        delay,
        ease: landingMotion.ease,
      }}
      data-reveal-mode={mode}
    >
      {children}
    </MotionTag>
  );
}
