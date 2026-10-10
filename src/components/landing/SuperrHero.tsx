import React, { useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight } from 'lucide-react';
import { motion, useScroll, useSpring, useTransform, type MotionValue } from 'motion/react';
import { MagneticButton, Reveal, SplitText, landingMotion, useReducedMotion } from '@/src/components/landing/motion';
import { useNavigation } from '@/src/context/NavigationContext';
import { HandArrow, StickerBolt, StickerHeart, StickerSparkle } from '@/src/components/landing/SuperrStickers';
import { mentorSegmentLabel, mentorSessionLabel } from '@/src/components/landing/mentorMeta';
import type { MentorDirectoryItem } from '@/src/hooks/useMentorDirectory';

/**
 * THE HERO.
 *
 * A two-column editorial split, left-aligned throughout. The left holds a
 * handwritten caption, the display headline, the lede, the single pill action
 * and a quiet info line. The right holds the hero object: a tilted frame
 * carrying a laminated name label — the schoolyard notebook's own vocabulary,
 * applied to a real mentor so nothing here is decorative invention.
 *
 * ENTRANCE CHOREOGRAPHY.
 * Caption, then headline lines, then the visual, then lede, CTA and info — the
 * order the page is read in. The headline rises out of an overflow mask so the
 * type is never animated word by word at the one moment it is being read for
 * the first time. With `prefers-reduced-motion` every step resolves to its
 * final state and the copy is simply present.
 */

export interface SuperrHeroProps {
  /** The real mentor shown on the name label; null until the directory answers. */
  featured: MentorDirectoryItem | null;
  /** Where the primary action leads. */
  findMentorPath: string;
}

interface NotebookGeometry {
  startWidth: number;
  startHeight: number;
  endWidth: number;
  endHeight: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

function NotebookIllustration({
  progress,
  x,
  y,
  scaleX,
  scaleY,
  rotate,
  width,
}: {
  progress: MotionValue<number>;
  x: MotionValue<number>;
  y: MotionValue<number>;
  scaleX: MotionValue<number>;
  scaleY: MotionValue<number>;
  rotate: MotionValue<number>;
  width: number;
}) {
  const coverRotate = useTransform(progress, [0.08, 0.72], [0, -178]);
  const pageOpacity = useTransform(progress, [0.18, 0.62], [0, 1]);
  const coverOpacity = useTransform(progress, [0.58, 0.82], [1, 0]);

  return (
    <motion.div
      className="notebook-artwork notebook-artwork--transition"
      style={{ x, y, scaleX, scaleY, rotate, width }}
      aria-hidden="true"
    >
      <div className="notebook-artwork__shadow" />
      <div className="notebook-artwork__cover-edge" />
      <div className="notebook-artwork__pages notebook-artwork__pages--left">
        <span /><span /><span />
      </div>
      <div className="notebook-artwork__pages notebook-artwork__pages--right">
        <span /><span /><span />
      </div>
      <motion.div className="notebook-artwork__cover notebook-artwork__cover--left" style={{ rotateY: coverRotate, opacity: coverOpacity }}>
        <span className="notebook-artwork__brand">suggest<br />key</span>
        <span className="notebook-artwork__cover-line">one useful next step</span>
      </motion.div>
      <motion.div className="notebook-artwork__page notebook-artwork__page--left" style={{ opacity: pageOpacity }}>
        <span className="notebook-artwork__margin" />
        <span className="notebook-artwork__scribble notebook-artwork__scribble--one" />
        <span className="notebook-artwork__scribble notebook-artwork__scribble--two" />
        <span className="notebook-artwork__corner">suggest key</span>
      </motion.div>
      <motion.div className="notebook-artwork__page notebook-artwork__page--right" style={{ opacity: pageOpacity }}>
        <span className="notebook-artwork__margin" />
        <span className="notebook-artwork__scribble notebook-artwork__scribble--three" />
        <span className="notebook-artwork__scribble notebook-artwork__scribble--four" />
      </motion.div>
      <div className="notebook-artwork__spine" />
    </motion.div>
  );
}

export function SuperrHero({ featured, findMentorPath }: SuperrHeroProps) {
  const { navigate } = useNavigation();
  const reduceMotion = useReducedMotion();
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 560px)').matches);
  const mentor = featured?.mentor ?? null;
  const transitionRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const openSectionRef = useRef<HTMLElement>(null);
  const [geometry, setGeometry] = useState<NotebookGeometry | null>(null);
  const { scrollYProgress } = useScroll({
    target: openSectionRef,
    offset: ['start 140%', 'start 0%'],
  });
  const progress = useSpring(scrollYProgress, landingMotion.spring);
  useLayoutEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 560px)');
    const update = () => setIsMobile(mediaQuery.matches);
    update();
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }, []);

  // Mobile and reduced-motion layouts resolve directly to the open notebook.
  // Only desktop/tablet with normal motion follows the scroll timeline.
  const animationProgress = useTransform(progress, (value) => (isMobile || reduceMotion) ? 1 : value);
  const x = useTransform(animationProgress, (value) => geometry ? geometry.startX + (geometry.endX - geometry.startX) * value : 0);
  const y = useTransform(animationProgress, (value) => geometry ? geometry.startY + (geometry.endY - geometry.startY) * value : 0);
  const scaleX = useTransform(animationProgress, (value) => geometry ? 1 + ((geometry.endWidth / geometry.startWidth) - 1) * value : 1);
  const scaleY = useTransform(animationProgress, (value) => geometry ? 1 + ((geometry.endHeight / geometry.startHeight) - 1) * value : 1);
  const rotate = useTransform(animationProgress, [0, 1], [7, 0]);

  useLayoutEffect(() => {
    const measure = () => {
      const wrapper = transitionRef.current;
      const source = sourceRef.current;
      const target = targetRef.current;
      if (!wrapper || !source || !target) return;
      const wrapperRect = wrapper.getBoundingClientRect();
      const sourceRect = source.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      setGeometry({
        startWidth: sourceRect.width,
        startHeight: sourceRect.height,
        endWidth: targetRect.width,
        endHeight: targetRect.height,
        startX: sourceRect.left - wrapperRect.left + sourceRect.width * 0.16,
        startY: sourceRect.top - wrapperRect.top - sourceRect.height * 0.045,
        endX: targetRect.left - wrapperRect.left,
        endY: targetRect.top - wrapperRect.top,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (transitionRef.current) observer.observe(transitionRef.current);
    if (sourceRef.current) observer.observe(sourceRef.current);
    if (targetRef.current) observer.observe(targetRef.current);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  return (
    <div ref={transitionRef} className="notebook-transition">
    <section className="landing-hero" aria-labelledby="hero-title">
      <div className="landing-wrap">
        <div className="landing-hero__head">
          <Reveal className="landing-hero__caption" mode="lift" playOnMount delay={0.05}>
            <span className="landing-handnote">figuring it out?</span>
            <HandArrow />
          </Reveal>

          <h1
            id="hero-title"
            className="landing-hero__title"
            aria-label="find a mentor for the thing you're stuck on."
          >
            <SplitText mode="line" playOnMount delay={landingMotion.stagger.hero} text="find a mentor" />
            <SplitText mode="line" playOnMount delay={landingMotion.stagger.hero * 1.8} text="for the thing" />
            <SplitText mode="line" playOnMount delay={landingMotion.stagger.hero * 2.6} text="you&rsquo;re stuck on." />
          </h1>
        </div>

        <div className="landing-hero__body">
          <div className="landing-hero__copy">
            <Reveal as="p" className="landing-hero__lede" mode="lift" playOnMount delay={0.44}>
              Suggest Key is a 1:1 mentorship marketplace. Bring the question, decision, or challenge you are
              sitting with, meet someone who has <span className="landing-em">lived</span> a version of it, and
              leave with one useful next step.
            </Reveal>

            <Reveal className="landing-hero__actions" mode="lift" playOnMount delay={0.54}>
              <MagneticButton
                className="landing-button landing-button--lg"
                onClick={() => {
                  navigate(findMentorPath);
                }}
              >
                Find a mentor <ArrowRight size={17} aria-hidden="true" />
              </MagneticButton>
              <a
                className="landing-text-link"
                href="#how-it-works"
                onClick={(event) => {
                  event.preventDefault();
                  document.getElementById('how-it-works')?.scrollIntoView({
                    behavior: reduceMotion ? 'auto' : 'smooth',
                    block: 'start',
                  });
                  window.history.replaceState(null, '', '#how-it-works');
                }}
              >
                How it works <ArrowRight size={17} aria-hidden="true" />
              </a>
            </Reveal>

            <Reveal as="p" className="landing-hero__info" mode="lift" playOnMount delay={0.62}>
              1:1 sessions &middot; 30&ndash;120 min &middot; booked in your timezone
            </Reveal>
          </div>

          <Reveal className="landing-hero__visual" mode="lift" playOnMount delay={0.3}>
            <div ref={sourceRef} className="landing-hero__notebook-slot" aria-hidden="true" />

            <Reveal className="landing-hero__label" mode="lift" playOnMount delay={0.58}>
              <dl>
                <div className="landing-hero__label-row">
                  <dt>Name</dt>
                  <dd className="landing-hero__label-name">{mentor?.full_name ?? 'your mentor'}</dd>
                </div>
                <div className="landing-hero__label-row">
                  <dt>Class</dt>
                  <dd>{mentor && featured ? mentorSegmentLabel(featured) : 'mentorship'}</dd>
                </div>
                <div className="landing-hero__label-row">
                  <dt>Session</dt>
                  <dd>{mentor && featured ? mentorSessionLabel(featured) : '1:1 conversation'}</dd>
                </div>
              </dl>
            </Reveal>

            <Reveal as="span" className="landing-sticker landing-sticker--bolt" mode="settle" playOnMount delay={0.78}>
              <StickerBolt />
            </Reveal>
            <Reveal as="span" className="landing-sticker landing-sticker--sparkle" mode="settle" playOnMount delay={0.9}>
              <StickerSparkle />
            </Reveal>
            <Reveal as="span" className="landing-sticker landing-sticker--heart" mode="settle" playOnMount delay={1.02}>
              <StickerHeart />
            </Reveal>
          </Reveal>
        </div>
      </div>

      <div className="landing-wrap">
        <Reveal className="landing-hero__scroll" mode="settle" playOnMount delay={0.9}>
          <span>scroll</span>
          <ArrowDown size={15} aria-hidden="true" />
        </Reveal>
      </div>
    </section>
    <section ref={openSectionRef} className="notebook-open-section" aria-label="An open Suggest Key notebook">
      <div ref={targetRef} className="notebook-open-section__notebook-slot" aria-hidden="true" />
    </section>
    {geometry && (
      <NotebookIllustration progress={animationProgress} x={x} y={y} scaleX={scaleX} scaleY={scaleY} rotate={rotate} width={geometry.startWidth} />
    )}
    </div>
  );
}

export default SuperrHero;
