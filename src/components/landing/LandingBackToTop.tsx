import { ArrowUp } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';

/**
 * THE PAGE'S TWO FIXED UTILITIES.
 *
 * Both are here rather than in their own files because both are 40 lines, both are
 * pure chrome, and neither of them knows anything about the page's content. What
 * they share is the rule that keeps them out of the way: neither one is visible
 * until the visitor is genuinely past the top, and both disappear again rather
 * than lingering on top of something.
 *
 * BACK TO TOP.
 *
 * The bar already carries Home, so this is not the only way back up — it is the way
 * back up that does not require finding the bar first. It appears only once the
 * visitor is at 700px, roughly three quarters of a viewport, because before that
 * the journey has been short enough that the bar's own Home link is the obvious
 * control and a second floating one is clutter.
 *
 * It is `aria-hidden` and unfocusable while it is hidden, rather than merely
 * transparent. A control that is present but invisible is still a tab stop, and a
 * keyboard visitor would be tabbing to a button that does nothing.
 *
 * It sits at z-index 55, below the navigation's 60, so it can never cover the bar,
 * and it clears `env(safe-area-inset-bottom)` rather than sitting on top of a
 * phone's home indicator.
 *
 * SCROLL PROGRESS.
 *
 * A 2px rule under the bar, violet track with a gold fill. `scaleX` with a left
 * origin means the only property that changes is a compositor transform, so a
 * scroll listener can drive it every frame without a single layout. It is
 * `aria-hidden`: the page's own scrollbar already states this, and a second
 * announcement of it would be noise.
 *
 * The gold-over-violet is deliberate. It reads as light travelling across a page
 * rather than as a loading bar, and it is the only element allowed to imply
 * forward motion on its own.
 */

const REVEAL_AFTER = 700;

export interface LandingBackToTopProps {
  /** Scrolling is done by this component; it owns the offset it reacts to. */
  className?: string;
}

export const LandingBackToTop: React.FC<LandingBackToTopProps> = ({ className }) => {
  const reducedMotion = useReducedMotion();
  const canAnimate = reducedMotion !== true;
  const [isVisible, setIsVisible] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let frame = 0;

    /**
     * One rAF-coalesced listener for two booleans and a float.
     *
     * Coalesced because a raw scroll handler that calls `setState` fires up to once
     * per frame on a fast wheel and well beyond it on a trackpad; this one
     * remembers a frame is already pending and lets the latest `scrollY` win. Both
     * values are read from the same sample, so the progress bar and the button can
     * never disagree about where the visitor is.
     */
    const read = () => {
      frame = 0;
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      setIsVisible(window.scrollY > REVEAL_AFTER);
      setProgress(scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0);
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

  const toTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: canAnimate ? 'smooth' : 'auto' });
  }, [canAnimate]);

  return (
    <>
      {/* The hairline. Above the bar's own top edge so it reads as part of it. */}
      <div className="sk-lg-progress" aria-hidden="true">
        <span className="sk-lg-progress__track" />
        <span className="sk-lg-progress__fill" style={{ transform: `scaleX(${progress})` }} />
      </div>

      <motion.button
        type="button"
        className={`sk-lg-top ${className ?? ''}`}
        aria-label="Back to top"
        aria-hidden={!isVisible}
        tabIndex={isVisible ? 0 : -1}
        onClick={toTop}
        /**
         * `AnimatePresence` is deliberately absent. A control that mounts and
         * unmounts cannot be faded, and one that unmounts takes its focus with it;
         * animating the two properties instead means the element is the same
         * element before and after, which is what keeps focus behaviour
         * predictable.
         */
        initial={false}
        animate={
          isVisible
            ? { opacity: 1, y: 0, scale: 1, pointerEvents: 'auto' }
            : { opacity: 0, y: 12, scale: 0.94, pointerEvents: 'none' }
        }
        transition={{ duration: canAnimate ? 0.3 : 0, ease: [0.22, 1, 0.36, 1] }}
        whileHover={canAnimate ? { scale: 1.06 } : undefined}
        whileTap={canAnimate ? { scale: 0.94 } : undefined}
      >
        <ArrowUp className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
      </motion.button>
    </>
  );
};

export default LandingBackToTop;