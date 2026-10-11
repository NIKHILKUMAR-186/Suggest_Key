import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useMotionValue, useSpring, useTransform, type MotionValue } from 'motion/react';

/**
 * Shared scroll-progress tracking for scroll-linked landing choreography.
 *
 * WHY THIS EXISTS INSTEAD OF `useScroll`.
 *
 * `useScroll({ target, offset })` derives its window from the target's document
 * position minus a multiple of the viewport height. When that multiple is
 * taller than the space above the target (any tall viewport), the window
 * begins ABOVE the top of the document, so the shared progress is already
 * part-way (or fully) advanced before the visitor has scrolled at all — the
 * approved initial state stops being the first painted state, and the visible
 * animation range shrinks or disappears. Measuring the window here keeps it
 * clamped to the document: progress 0 is always `scrollY === 0`.
 *
 * The window is re-measured on every scroll tick, on resize/orientation change
 * and through `refresh()`, so layout shifts that no ResizeObserver would catch
 * (webfonts, reflow above the target) can never leave it stale.
 */
export interface ScrollProgressConfig {
  /** Element whose top edge, reaching the top of the viewport, marks progress 1. */
  targetRef: RefObject<HTMLElement | null>;
  /**
   * How many viewport heights above the target's top edge the transition
   * begins. The window never starts above the document top, whatever this is.
   * Defaults to 1.4.
   */
  lead?: number;
  /**
   * Pins the progress to `pinned` — mobile and reduced-motion experiences do
   * not follow the scroll timeline. Kept independent of every other flag.
   */
  disabled?: boolean;
  /** The value a pinned progress resolves to. Defaults to 1 (final state). */
  pinned?: number;
  /** Spring applied to the raw scroll offset before clamping. */
  spring?: { type: 'spring'; stiffness: number; damping: number; mass: number };
}

export interface ScrollProgressResult {
  /** Smoothed, clamped 0..1 progress driven by the shared scroll window. */
  progress: MotionValue<number>;
  /** Re-measure the window after a layout change the observers cannot see. */
  refresh: () => void;
}

const DEFAULT_SPRING = { type: 'spring' as const, stiffness: 260, damping: 24, mass: 0.6 };

export function useScrollProgress({
  targetRef,
  lead = 1.4,
  disabled = false,
  pinned = 1,
  spring,
}: ScrollProgressConfig): ScrollProgressResult {
  const initialScrollY = useRef(typeof window !== 'undefined' ? window.scrollY : 0);
  const scrollY = useMotionValue(initialScrollY.current);
  const windowStart = useMotionValue(Number.NaN);
  const windowEnd = useMotionValue(Number.NaN);
  const source = spring ? useSpring(scrollY, spring) : scrollY;

  /**
   * Recompute the animation window from the target's live document position.
   * Reading it on every tick (rather than caching at mount) is what keeps the
   * window correct across late webfonts, reflow and orientation changes.
   */
  const measureWindow = useCallback(() => {
    const target = targetRef.current;
    if (!target || typeof window === 'undefined') return;
    const documentTop = target.getBoundingClientRect().top + window.scrollY;
    const viewportHeight = window.innerHeight || 0;
    windowStart.set(Math.max(0, documentTop - lead * viewportHeight));
    windowEnd.set(documentTop);
  }, [lead, targetRef]);

  useLayoutEffect(() => {
    measureWindow();
  }, [measureWindow]);

  useEffect(() => {
    if (disabled) {
      scrollY.set(typeof window !== 'undefined' ? window.scrollY : 0);
      return;
    }

    // Use native scroll event listener instead of Framer Motion's scroll()
    // for reliable window scroll tracking.
    scrollY.set(window.scrollY);
    measureWindow();

    const onScroll = () => {
      scrollY.set(window.scrollY);
      measureWindow();
    };

    let ticking = false;
    const onScrollRAF = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          scrollY.set(window.scrollY);
          measureWindow();
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', onScrollRAF, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScrollRAF);
    };
  }, [disabled, measureWindow, scrollY]);

  useEffect(() => {
    const onResize = () => measureWindow();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [measureWindow]);

  const progress = useTransform(
    [source, windowStart, windowEnd],
    ([value, start, end]: number[]) => {
      if (disabled) return pinned;
      // Unmeasured or degenerate geometry falls back to the initial state so
      // the first painted frame is always the approved closed notebook.
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
      const raw = (value - start) / (end - start);
      return raw < 0 ? 0 : raw > 1 ? 1 : raw;
    },
  );

  return { progress, refresh: measureWindow };
}