import { motion, useReducedMotion, type Variants } from 'motion/react';
import React from 'react';

/**
 * LANDING MOTION PRIMITIVES.
 *
 * The page has three levels of movement and no more: the hero announces itself,
 * sections arrive once, and hover is a whisper. Anything that would keep moving
 * while nobody is touching it is decoration, not motion, and does not belong
 * here.
 *
 * `canAnimate` is the single gate for all of it. When a visitor prefers reduced
 * motion, every primitive resolves to its finished state immediately — no
 * transform, no opacity ramp, no stagger — so the page is simply a still page
 * with the same information in the same order. Nothing is hidden behind an
 * animation that never plays.
 *
 * Only `transform` and `opacity` are animated. Blur appears once, on the hero
 * photograph, because it is a one-shot load and not a scroll-linked effect.
 */

/** Editorial easing: a long, quiet settle. No spring, no overshoot. */
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** False while the preference is unknown, so a first paint never animates. */
export function useCanAnimate(): boolean {
  const prefersReducedMotion = useReducedMotion();
  return prefersReducedMotion !== true;
}

interface RevealProps {
  children: React.ReactNode;
  /** Seconds. */
  delay?: number;
  /** Distance in pixels the block settles up from. */
  y?: number;
  className?: string;
  as?: 'div' | 'section' | 'li' | 'header' | 'footer' | 'article';
}

export function Reveal({
  children,
  delay = 0,
  y = 18,
  className,
  as = 'div',
}: RevealProps) {
  const canAnimate = useCanAnimate();
  const Tag = motion[as];

  if (!canAnimate) {
    const Plain = as;
    return <Plain className={className}>{children}</Plain>;
  }

  return (
    <Tag
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.72, delay, ease: EASE }}
    >
      {children}
    </Tag>
  );
}

/**
 * A group whose children arrive one after another.
 *
 * The stagger lives on the parent so the children carry no timing of their own,
 * which is what keeps the whole group in step regardless of how many items the
 * database returned.
 */
export function Stagger({
  children,
  className,
  step = 0.08,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  /** Seconds between children. */
  step?: number;
  /** Seconds before the first child. */
  delay?: number;
}) {
  const canAnimate = useCanAnimate();

  if (!canAnimate) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, amount: 0.15 }}
      variants={{
        hidden: {},
        shown: { transition: { staggerChildren: step, delayChildren: delay } },
      }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
  y = 14,
}: {
  children: React.ReactNode;
  className?: string;
  y?: number;
}) {
  const canAnimate = useCanAnimate();

  if (!canAnimate) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y },
        shown: { opacity: 1, y: 0, transition: { duration: 0.62, ease: EASE } },
      }}
    >
      {children}
    </motion.div>
  );
}

/**
 * A headline that reveals one line at a time.
 *
 * Each line is its own clipping box, so the text rises out of nothing rather
 * than sliding as one solid block. The caller supplies the lines: splitting on
 * whitespace would break on the manual line breaks an editorial headline wants,
 * and would produce an unpredictable number of animated nodes on a phone.
 */
export function LineReveal({
  lines,
  className,
  lineClassName,
  delay = 0,
  /** Seconds between lines. */
  step = 0.09,
}: {
  lines: readonly string[];
  className?: string;
  lineClassName?: string;
  delay?: number;
  step?: number;
}) {
  const canAnimate = useCanAnimate();

  if (!canAnimate) {
    return (
      <span className={className}>
        {lines.map((line) => (
          <span key={line} className={`block ${lineClassName ?? ''}`}>
            {line}
          </span>
        ))}
      </span>
    );
  }

  return (
    <span className={className}>
      {lines.map((line, index) => (
        <span
          key={line}
          className="block overflow-hidden"
          style={{ paddingBottom: '0.08em', marginBottom: '-0.08em' }}
        >
          <motion.span
            className={`block ${lineClassName ?? ''}`}
            initial={{ y: '108%', opacity: 0 }}
            animate={{ y: '0%', opacity: 1 }}
            transition={{
              duration: 0.86,
              delay: delay + index * step,
              ease: EASE,
            }}
          >
            {line}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

/**
 * A photographic reveal: slightly soft and slightly scaled, sharpening into
 * place. Deliberately used once. A blur ramp on a scrolling element reads as
 * jank, so it belongs to a load, not a scroll.
 */
export function MediaReveal({
  children,
  className,
  delay = 0,
  duration = 1.4,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  duration?: number;
}) {
  const canAnimate = useCanAnimate();

  if (!canAnimate) return <div className={className}>{children}</div>;

  const variants: Variants = {
    hidden: { opacity: 0, scale: 1.05, filter: 'blur(16px)' },
    shown: {
      opacity: 1,
      scale: 1,
      filter: 'blur(0px)',
      transition: { duration, delay, ease: EASE },
    },
  };

  return (
    <motion.div
      className={className}
      variants={variants}
      initial="hidden"
      animate="shown"
    >
      {children}
    </motion.div>
  );
}