import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight } from 'lucide-react';
import { motion, useMotionValue, useTransform, type MotionValue } from 'motion/react';
import { MagneticButton, Reveal, SplitText, landingMotion, useReducedMotion, useScrollProgress } from '@/src/components/landing/motion';
import { useNavigation } from '@/src/context/NavigationContext';
import { HandArrow, StickerBolt, StickerHeart, StickerSparkle } from '@/src/components/landing/SuperrStickers';
import { mentorSegmentLabel, mentorSessionLabel } from '@/src/components/landing/mentorMeta';
import { LANDING_SEGMENTS } from '@/src/components/landing/landingSegments';
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
 *
 * NOTEBOOK.
 * A single notebook artwork is measured between two hidden slots: a closed
 * slot beside the hero copy and a pinned slot inside the tall opening stage
 * below. Scroll progress — measured by `useScrollProgress` so it always starts
 * at zero on a fresh load — flies the notebook from the hero slot to the
 * pinned slot, swings the cover open around the spine, and reveals the three
 * local mentorship segments on the pages. The pinned slot lives inside a
 * `position: sticky` container, so once the book is open it stays centred in
 * the viewport long enough to read before the stage scrolls it away.
 */

export interface SuperrHeroProps {
  /** The real mentor shown on the name label; null until the directory answers. */
  featured: MentorDirectoryItem | null;
  /** Where the primary action leads. */
  findMentorPath: string;
}

/**
 * How many viewport heights above the pinned slot the transition begins.
 * Reduced to 1.0 to match the shorter 120vh open section — the entrance
 * animation now completes within ~1 viewport height of scrolling.
 */
const NOTEBOOK_SCROLL_LEAD = 1.0;

function NotebookIllustration({
  progress,
  x,
  y,
  scaleX,
  scaleY,
  rotate,
  width,
  onLoginClick,
}: {
  progress: MotionValue<number>;
  x: MotionValue<number>;
  y: MotionValue<number>;
  scaleX: MotionValue<number>;
  scaleY: MotionValue<number>;
  rotate: MotionValue<number>;
  width: MotionValue<number>;
  onLoginClick: () => void;
}) {
  const coverRotate = useTransform(progress, [0.08, 0.72], [0, -178]);
  const pageOpacity = useTransform(progress, [0.18, 0.62], [0, 1]);
  const coverOpacity = useTransform(progress, [0.58, 0.82], [1, 0]);
  const contentOpacity = useTransform(progress, [0.62, 0.86], [0, 1]);

  return (
    <motion.div
      className="notebook-artwork notebook-artwork--transition"
      style={{ x, y, scaleX, scaleY, rotate, width, willChange: 'transform' }}
      aria-hidden="true"
    >
      <div className="notebook-artwork__shadow" />
      <div className="notebook-artwork__cover-edge" />
      <div className="notebook-artwork__pages notebook-artwork__pages--single">
        <span /><span /><span />
      </div>
      <motion.div className="notebook-artwork__cover notebook-artwork__cover--left" style={{ rotateY: coverRotate, opacity: coverOpacity }}>
        <span className="notebook-artwork__brand"><img src="/logo.png"  width={30} height={30} /><img src="/name.png" alt="suggest key" /></span>
        <span className="notebook-artwork__cover-line">one useful next step</span>
      </motion.div>
<motion.div className="notebook-artwork__page notebook-artwork__page--single" style={{ opacity: pageOpacity }}>
        <span className="notebook-artwork__margin" />
        <motion.div className="notebook-editorial" style={{ opacity: contentOpacity }}>
          <button
            className="notebook-editorial__header-graphic notebook-editorial__clickable"
            onClick={onLoginClick}
            aria-label="Explore Suggest Key mentorship — sign in to continue"
            type="button"
          >
            <img src="/image1.png" width={300} height={30} alt="Suggest Key mentorship introduction" />
          </button>
          <button
            className="notebook-editorial__segments-graphic notebook-editorial__clickable"
            onClick={onLoginClick}
            aria-label="Explore Suggest Key mentorship segments — sign in to continue"
            type="button"
          >
            <img src="/image2.png" width={300} height={30} alt="Suggest Key mentorship segments: Autism Mentorship, Relationship Guidance, Career Mentorship" />
          </button>
          <footer className="notebook-editorial__footer">
            <span className="notebook-editorial__signature">Suggest Key</span>
            <p className="notebook-editorial__tagline">Guidance that moves you forward.</p>
          </footer>
        </motion.div>
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
  const pinRef = useRef<HTMLDivElement>(null);
  const [isMeasured, setIsMeasured] = useState(false);

  // Geometry lives in motion values, not state, so the scroll listener can
  // re-measure the pinned slot on every tick without triggering a re-render.
  const gStartX = useMotionValue(0);
  const gStartY = useMotionValue(0);
  const gEndX = useMotionValue(0);
  const gEndY = useMotionValue(0);
  const gStartWidth = useMotionValue(1);
  const gStartHeight = useMotionValue(1);
  const gEndWidth = useMotionValue(1);
  const gEndHeight = useMotionValue(1);

  // One authoritative scroll-progress source. `useScrollProgress` clamps the
  // measurement window to the document, so a hard reload at the top always
  // begins at the closed book (progress 0) instead of part-way open.
  const { progress } = useScrollProgress({
    targetRef: pinRef,
    lead: NOTEBOOK_SCROLL_LEAD,
  });

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
  const x = useTransform([animationProgress, gStartX, gEndX], ([p, sx, ex]: number[]) => sx + (ex - sx) * p);
  const y = useTransform([animationProgress, gStartY, gEndY], ([p, sy, ey]: number[]) => sy + (ey - sy) * p);
  const scaleX = useTransform([animationProgress, gStartWidth, gEndWidth], ([p, sw, ew]: number[]) => (sw > 0 ? 1 + (ew / sw - 1) * p : 1));
  const scaleY = useTransform([animationProgress, gStartHeight, gEndHeight], ([p, sh, eh]: number[]) => (sh > 0 ? 1 + (eh / sh - 1) * p : 1));
  const rotate = useTransform(animationProgress, [0, 1], [7, 0]);

  const measure = useCallback(() => {
    const wrapper = transitionRef.current;
    const source = sourceRef.current;
    const target = targetRef.current;
    if (!wrapper || !source || !target) return;
    // Batch reads to avoid layout thrashing
    const wrapperRect = wrapper.getBoundingClientRect();
    const sourceRect = source.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    // Write to motion values (no state updates)
    gStartX.set(sourceRect.left - wrapperRect.left + sourceRect.width * 0.16);
    gStartY.set(sourceRect.top - wrapperRect.top - sourceRect.height * 0.045);
    gEndX.set(targetRect.left - wrapperRect.left);
    gEndY.set(targetRect.top - wrapperRect.top);
    gStartWidth.set(sourceRect.width);
    gStartHeight.set(sourceRect.height);
    gEndWidth.set(targetRect.width);
    gEndHeight.set(targetRect.height);
    setIsMeasured(true);
  }, [gStartX, gStartY, gEndX, gEndY, gStartWidth, gStartHeight, gEndWidth, gEndHeight]);

  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(() => {
      measure();
    });
    if (transitionRef.current) observer.observe(transitionRef.current);
    if (sourceRef.current) observer.observe(sourceRef.current);
    if (targetRef.current) observer.observe(targetRef.current);
    window.addEventListener('resize', measure, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

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
    <section className="notebook-open-section" aria-label="An open Suggest Key notebook">
      <div className="notebook-open-section__lead" aria-hidden="true" />
      <div ref={pinRef} className="notebook-open-section__pin">
        <div ref={targetRef} className="notebook-open-section__notebook-slot" aria-hidden="true" />
      </div>
    </section>
    {isMeasured && (
      <NotebookIllustration progress={animationProgress} x={x} y={y} scaleX={scaleX} scaleY={scaleY} rotate={rotate} width={gStartWidth} />
    )}
    </div>
  );
}

export default SuperrHero;
