import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import React, { useRef } from 'react';
import { HERO_IMAGE } from '@/src/components/landing/landingImages';

/**
 * HERO PHOTOGRAPH.
 *
 * Two things happen to this image and neither is decoration:
 *
 *   1. On load it resolves out of a slightly soft, slightly oversized state.
 *      That is a one-shot transition tied to first paint — the photograph is
 *      what makes the page say "mentorship" before a word is read, so it is
 *      given the loudest entrance on the page. Nothing else gets a blur.
 *   2. It drifts a few percent as the hero leaves, which is what stops a
 *      full-bleed photo from feeling like wallpaper.
 *
 * The parallax is a scroll-linked transform on a single element, driven by
 * `useScroll` against the hero rather than a hand-rolled scroll listener. It is
 * disabled outright when the visitor prefers reduced motion, when the input is
 * coarse-pointer (a drag would fight the gesture), and when the image is a
 * static band rather than a full-bleed field.
 *
 * The frame is over-tall by 12% precisely to give the drift somewhere to go;
 * without that headroom the image would expose the edge of the hero mid-scroll.
 */

interface HeroConversationVisualProps {
  /** True when the photo is the full-bleed field rather than a band. */
  isFullBleed?: boolean;
}

export const HeroConversationVisual: React.FC<HeroConversationVisualProps> = ({
  isFullBleed = true,
}) => {
  const mediaRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const canAnimate = reducedMotion !== true;

  const { scrollYProgress } = useScroll({
    target: mediaRef,
    offset: ['start start', 'end start'],
  });

  // 6% of drift over the hero's exit. Small enough to read as depth rather
  // than as movement, and bounded so it never fights the copy.
  const drift = useTransform(scrollYProgress, [0, 1], ['0%', '6%']);

  const shouldDrift = canAnimate && isFullBleed;

  return (
    <div ref={mediaRef} className="sk-lp-hero__media">
      <motion.img
        src={HERO_IMAGE.src}
        alt={HERO_IMAGE.alt}
        width={HERO_IMAGE.width}
        height={HERO_IMAGE.height}
        fetchPriority="high"
        decoding="async"
        initial={canAnimate ? { opacity: 0, scale: 1.045, filter: 'blur(18px)' } : false}
        animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
        transition={{
          duration: 1.5,
          delay: 0.12,
          ease: [0.22, 1, 0.36, 1],
        }}
        style={shouldDrift ? { y: drift } : undefined}
      />
      <div className="sk-lp-hero__scrim" />
    </div>
  );
};