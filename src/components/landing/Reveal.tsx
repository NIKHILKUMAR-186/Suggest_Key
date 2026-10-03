import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/src/lib/utils';

/**
 * SCROLL REVEAL — the single place entrance animation is expressed.
 *
 * Every section on the landing page reveals through this component so the
 * motion system stays one small, consistent thing rather than a variant of
 * itself in a dozen files:
 *
 *   - one short rise, one short fade, once per element;
 *   - `prefers-reduced-motion` is respected at the source, so a reduced-motion
 *     visitor gets the final state immediately with no transform and no delay,
 *     rather than a page of content that has to animate to become visible;
 *   - it renders a plain element and never intercepts clicks, so wrapping an
 *     interactive card cannot swallow its own activation.
 *
 * `y` is deliberately small: transform-based reveal causes layout-independent
 * repaint only, and a large offset reads as "sliding" rather than "arriving".
 */
export interface RevealProps {
  children: React.ReactNode;
  className?: string;
  /** Seconds of stagger. Kept under 0.3s so nothing feels slow. */
  delay?: number;
  /** Fraction of the element that must be visible before it plays. */
  amount?: number;
  /** Element to render. Defaults to a div. */
  as?: 'div' | 'section' | 'li' | 'article' | 'header' | 'footer';
  /** Inline CSS custom properties, e.g. a segment's runtime theme. */
  style?: React.CSSProperties;
}

export const Reveal: React.FC<RevealProps> = ({
  children,
  className,
  delay = 0,
  amount = 0.2,
  as = 'div',
  style,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const canAnimate = prefersReducedMotion === false;

  const MotionTag = motion[as];

  return (
    <MotionTag
      className={cn(className)}
      style={style}
      initial={canAnimate ? { opacity: 0, y: 16 } : false}
      whileInView={canAnimate ? { opacity: 1, y: 0 } : undefined}
      viewport={{ once: true, amount }}
      transition={{ duration: 0.45, delay, ease: [0.23, 1, 0.31, 1] }}
    >
      {children}
    </MotionTag>
  );
};

/**
 * A one-shot entrance for above-the-fold content, which must not wait for a
 * scroll position the visitor has not reached yet.
 */
export interface EnterProps extends Omit<RevealProps, 'amount'> {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  as?: RevealProps['as'];
}

export const Enter: React.FC<EnterProps> = ({ children, className, delay = 0, as = 'div' }) => {
  const prefersReducedMotion = useReducedMotion();
  const canAnimate = prefersReducedMotion === false;

  const MotionTag = motion[as];

  return (
    <MotionTag
      className={cn(className)}
      initial={canAnimate ? { opacity: 0, y: 14 } : false}
      animate={canAnimate ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.5, delay, ease: [0.23, 1, 0.31, 1] }}
    >
      {children}
    </MotionTag>
  );
};