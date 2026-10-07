import { motion, useReducedMotion, type Variants } from 'motion/react';
import React from 'react';

/**
 * LANDING MOTION PRIMITIVES.
 *
 * The page has two levels of movement and no more: the hero announces itself,
 * and sections settle as the reader reaches them. Anything that would keep moving
 * while nobody is touching it is decoration, and decoration on a page like this
 * is how a landing site ends up feeling like a template.
 *
 * `canAnimate` is the single gate for all of it. When a visitor prefers reduced
 * motion every primitive resolves to its finished state immediately — no
 * transform, no opacity ramp, no stagger — so the page is simply a still page
 * with the same information in the same order. Nothing is ever hidden behind an
 * animation that does not run, which is the failure this gating exists to prevent.
 *
 * Only `transform` and `opacity` are animated here.
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
 * which is what keeps the whole group in step regardless of how many rows the
 * database returned.
 */
type StaggerTag = 'div' | 'ul' | 'ol' | 'section';

export function Stagger({
  children,
  className,
  step = 0.08,
  delay = 0,
  as = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  /** Seconds between children. */
  step?: number;
  /** Seconds before the first child. */
  delay?: number;
  /**
   * Rendered element. This is not decoration: a list whose rows each carry a
   * bottom rule has to be real `ul`/`li`, because an extra `div` between them
   * changes which element the rule belongs to and how the browser counts the
   * rows for assistive technology.
   */
  as?: StaggerTag;
}) {
  const canAnimate = useCanAnimate();
  const Tag = motion[as];

  if (!canAnimate) {
    const Plain = as;
    return <Plain className={className}>{children}</Plain>;
  }

  return (
    <Tag
      className={className}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, amount: 0.12 }}
      variants={{
        hidden: {},
        shown: { transition: { staggerChildren: step, delayChildren: delay } },
      }}
    >
      {children}
    </Tag>
  );
}

export function StaggerItem({
  children,
  className,
  y = 14,
  as = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  y?: number;
  as?: StaggerTag | 'li';
}) {
  const canAnimate = useCanAnimate();
  const Tag = motion[as];

  if (!canAnimate) {
    const Plain = as;
    return <Plain className={className}>{children}</Plain>;
  }

  return (
    <Tag
      className={className}
      variants={{
        hidden: { opacity: 0, y },
        shown: { opacity: 1, y: 0, transition: { duration: 0.62, ease: EASE } },
      }}
    >
      {children}
    </Tag>
  );
}

/**
 * A block that grows from its own left edge rather than rising.
 *
 * Used exactly once, on the final call, where a settle from the left reads as a
 * page being turned rather than as another copy of the entrance that ran four
 * sections earlier.
 */
export function EdgeReveal({
  children,
  className,
  delay = 0,
}: {
  /**
   * Optional, because this also draws bare marks: the hairline rule under the
   * closing call is revealed this way and has nothing inside it.
   */
  children?: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const canAnimate = useCanAnimate();

  if (!canAnimate) return <div className={className}>{children}</div>;

  /*
   * It scales rather than clips, and that is not a style preference.
   *
   * `whileInView` does not fire on an element whose resting style makes it
   * invisible, and `inset(0 100% 0 0)` is exactly that: the browser reports the
   * element as fully in view, the observer never calls back, and the rule is
   * never drawn at all. This component is the one the areas section and the
   * editorial section both use for their spine rule, so the bug showed up in
   * two places at once.
   *
   * `scaleX` from a left-hand origin produces the same draw, composites, and
   * leaves the element a real box that a viewport observer can see.
   */
  const variants: Variants = {
    hidden: { opacity: 0, scaleX: 0 },
    shown: {
      opacity: 1,
      scaleX: 1,
      transition: { duration: 0.95, delay, ease: EASE },
    },
  };

  return (
    <motion.div
      className={className}
      variants={variants}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, amount: 0.3 }}
      style={{ transformOrigin: 'left center' }}
    >
      {children}
    </motion.div>
  );
}