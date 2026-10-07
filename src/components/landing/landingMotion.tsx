import { useEffect, useRef, useState } from 'react';

/**
 * SHARED MOTION PRIMITIVES.
 *
 * Two hooks and one component, in one file, because each of them is a dozen lines
 * and splitting them across three files would be three imports to express three
 * ideas that only ever appear together on this page.
 *
 * THE TWO HOOKS SHARE ONE RULE: they read layout, never write it.
 *
 * Every value they return is destined for a `transform` or an `opacity`, so
 * nothing here can trigger layout. That is not an optimisation detail — it is
 * what lets the hero run a continuous pointer read on a page that is also doing
 * scroll work without ever costing a reflow.
 *
 * AND THEY ALL STOP.
 *
 * `usePointerParallax` never subscribes on a coarse pointer or on touch,
 * `useSectionProgress` reads nothing it does not need, and `MagneticButton`
 * refuses to move at all under reduced motion. A visitor who has asked for less
 * motion gets the same page with the same content, minus the travel.
 *
 * The page's scroll-progress hairline and its back-to-top control read the same
 * scroll position, so they live together in `LandingBackToTop` rather than here.
 */

/** True on a device whose primary pointer cannot hover. */
function isCoarsePointer(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(hover: none), (pointer: coarse)').matches;
}

/* ---------------------------------------------------------------------------
   usePointerParallax — two normalised offsets in [-1, 1].
   --------------------------------------------------------------------------- */

export interface PointerParallax<T extends HTMLElement> {
  /** -1 at the left edge, 1 at the right, 0 at the horizontal centre. */
  readonly x: number;
  /** -1 at the top of the element, 1 at the bottom. */
  readonly y: number;
  /** Pointer leaves have been ignored: coarse pointer, or outside the element. */
  readonly isIdle: boolean;
  /** Give this to the element the offsets are measured against. */
  readonly ref: React.RefObject<T | null>;
}

/**
 * Pointer position, normalised, for parallax.
 *
 * The normalisation is the whole point. Without it, a 4px offset applies to a
 * 4px-wide element and a 4000px offset to a large one, which is how a "subtle"
 * parallax ends up nauseating on one part of a page and invisible on another.
 *
 * Both axes are damped on the way out, so the layers settle instead of snapping
 * back to centre when the pointer leaves — a hero that visibly resets reads as a
 * broken effect rather than as one that has ended.
 *
 * Idle is a first-class return value, not an edge case: it is how the caller
 * knows to hold its resting pose rather than chase a pointer that is not there.
 */
export function usePointerParallax<T extends HTMLElement>(): PointerParallax<T> {
  const ref = useRef<T>(null);
  const [state, setState] = useState({ x: 0, y: 0, isIdle: true });
  const frame = useRef<number>(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // A touch pointer and a mouse produce the same numbers here and completely
    // different intentions, so a coarse pointer never starts this at all.
    if (isCoarsePointer()) return;

    const write = (x: number, y: number, isIdle: boolean) => {
      if (frame.current) return;
      frame.current = window.requestAnimationFrame(() => {
        frame.current = 0;
        setState({ x, y, isIdle });
      });
    };

    const onMove = (event: PointerEvent) => {
      const box = node.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;

      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;

      // Half-width denominators: ±1 lands exactly on the element's edge, and the
      // clamp catches the pointer being outside it, which is normal mid-gesture.
      const x = Math.max(-1, Math.min(1, (event.clientX - cx) / (box.width / 2)));
      const y = Math.max(-1, Math.min(1, (event.clientY - cy) / (box.height / 2)));

      write(x, y, false);
    };

    const onLeave = () => write(0, 0, true);

    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerleave', onLeave);

    return () => {
      if (frame.current) window.cancelAnimationFrame(frame.current);
      frame.current = 0;
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return { ...state, ref };
}

/* ---------------------------------------------------------------------------
   useSectionProgress — how far a section has travelled through the viewport.
   --------------------------------------------------------------------------- */

export interface SectionProgress {
  /** 0 when the section's top reaches the bottom of the viewport, 1 when its
   *  bottom has passed a third of the way up. The range every scroll-driven
   *  reveal in this page is expressed against. */
  readonly value: number;
  readonly ref: React.RefObject<HTMLElement | null>;
}

/**
 * The scroll position an element's own box has reached, as 0–1.
 *
 * Used by the hero for its exit: the image scales down, the copy rises and fades
 * and the ambient field goes quiet, all from this one number. Because it is the
 * element's own progress rather than the document's, the hero begins moving the
 * moment its bottom edge appears and has finished before it has left, which is
 * what stops an exit transition from finishing off-screen.
 */
export function useSectionProgress<T extends HTMLElement>(): SectionProgress {
  const ref = useRef<T>(null);
  const [value, setValue] = useState(0);

  useEffect(() => {
    let frame = 0;

    const read = () => {
      frame = 0;
      const node = ref.current;
      if (!node) return;

      const box = node.getBoundingClientRect();
      if (box.height <= 0) return;

      /*
       * How far the viewport top has travelled PAST the section, over the
       * section's own height.
       *
       * The previous form divided the section's position by its height PLUS
       * the viewport height, which is correct for a section sitting in the
       * middle of a long document and wrong for one anchored at the top of
       * it. For the hero that meant 0.48 before the visitor had scrolled at all:
       * the photograph started 29px high, the deck started 63px high and at
       * 59% opacity, and the hero's whole exit transition had already run
       * halfway while the page was still loading.
       *
       * Measuring scroll travelled instead of position makes the value 0 at the
       * top of the document and 1 as the section leaves — which is what the
       * hero's exit was written to do in the first place.
       */
      const travelled = window.scrollY - (box.top + window.scrollY);
      setValue(Math.max(0, Math.min(1, travelled / box.height)));
    };

    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(read);
    };

    read();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, []);

  return { value, ref };
}

/* ---------------------------------------------------------------------------
   MagneticButton
   --------------------------------------------------------------------------- */

/**
 * A button that leans a few pixels toward the pointer.
 *
 * The movement is capped at 6px and damped to a third of the pointer's offset,
 * which is what "magnetic" has to mean before it stops being a gimmick: enough
 * that the target is unmistakably the thing under the cursor, little enough that
 * nobody's aim is ever disturbed by the target moving. A larger pull turns the
 * single most important control on the page into a precision task.
 *
 * It is a wrapper rather than a button because it has to preserve whatever the
 * caller renders inside — the label, the arrow, the focus ring — and because the
 * element that moves must be the same element that receives focus. A focus ring
 * that lagged a frame behind its button would be a visible accessibility bug.
 */
export interface MagneticButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  type?: 'button' | 'submit';
  /** Accessible name, when the visible label alone is not enough. */
  ariaLabel?: string;
}

/** Fraction of the pointer's offset from centre that the button actually follows. */
const DAMPING = 0.3;

/**
 * Hard ceiling on the displacement in either axis, in px. Kept next to
 * `DAMPING` so the prose above and the behaviour below cannot disagree: this
 * figure is the whole reason the effect is tolerable.
 */
const CAP = 6;

export const MagneticButton: React.FC<MagneticButtonProps> = ({
  children,
  onClick,
  className,
  type = 'button',
  ariaLabel,
}) => {
  const ref = useRef<HTMLButtonElement>(null);
  const frame = useRef(0);
  const enabled = useRef(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const coarse = window.matchMedia('(hover: none), (pointer: coarse)');

    /**
     * Enabled only when the pointer can hover AND the visitor has not asked for
     * reduced motion. Both are re-read on change rather than captured once: a
     * visitor can flip their OS setting with the page open, and a magnetic button
     * that ignores the change they just made is worse than one that never had it.
     */
    const sync = () => {
      enabled.current = !media.matches && !coarse.matches;
      if (!enabled.current) {
        node.style.removeProperty('--sk-mag-x');
        node.style.removeProperty('--sk-mag-y');
      }
    };

    const onMove = (event: PointerEvent) => {
      if (!enabled.current) return;

      const box = node.getBoundingClientRect();
      const dx = event.clientX - (box.left + box.width / 2);
      const dy = event.clientY - (box.top + box.height / 2);

      if (frame.current) return;
      frame.current = window.requestAnimationFrame(() => {
        frame.current = 0;
        // Clamp the damped result rather than the pointer offset: damping alone
        // is not a ceiling. On a 200px-wide button the pointer can sit 100px from
        // centre, and 0.3 of that is 30px — three times the budget, and enough to
        // make the primary action feel like it slipped out from under the cursor.
        const x = Math.max(-CAP, Math.min(CAP, dx * DAMPING));
        const y = Math.max(-CAP, Math.min(CAP, dy * DAMPING));
        /*
          * Custom properties, not `transform`.
          *
          * The page's own rule composes these with the hover and press scale:
          * `transform: translate3d(var(--sk-mag-x), var(--sk-mag-y)) scale(...)`.
          * Writing `transform` from here would win that rule outright and silently
          * delete the press feedback from every primary call on the page.
          */
        node.style.setProperty('--sk-mag-x', `${x}px`);
        node.style.setProperty('--sk-mag-y', `${y}px`);
      });
    };

    const release = () => {
      if (frame.current) {
        window.cancelAnimationFrame(frame.current);
        frame.current = 0;
      }
      if (node) {
        node.style.removeProperty('--sk-mag-x');
        node.style.removeProperty('--sk-mag-y');
      }
    };

    sync();
    media.addEventListener('change', sync);
    coarse.addEventListener('change', sync);
    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerleave', release);
    node.addEventListener('blur', release);

    return () => {
      if (frame.current) window.cancelAnimationFrame(frame.current);
      frame.current = 0;
      media.removeEventListener('change', sync);
      coarse.removeEventListener('change', sync);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerleave', release);
      node.removeEventListener('blur', release);
    };
  }, []);

  return (
    <button
      ref={ref}
      type={type}
      className={className}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {children}
    </button>
  );
};

export default MagneticButton;