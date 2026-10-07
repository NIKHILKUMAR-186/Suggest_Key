import { motion, useReducedMotion } from 'motion/react';
import { CalendarClock } from 'lucide-react';
import React, { useCallback, useRef } from 'react';
import type { FeaturedMentor } from '@/src/hooks/useFeaturedMentors';
import type { Segment } from '@/src/types/database';
import { formatInr } from '@/src/lib/seekerFormat';
import {
  STAGE_ACTION_LABEL,
  STAGE_AVAILABLE_LABEL,
  STAGE_LOADING_LABEL,
} from '@/src/components/landing/landingContent';

/**
 * The two non-data states of the profile itself.
 *
 * They live here rather than in the shared copy file because they are
 * the only two sentences this component owns: the empty directory and
 * the failed read, each rendered exactly once, at caption weight.
 */
const STAGE_EMPTY_LABEL = 'No mentors are live yet.';
const STAGE_ERROR_LABEL = 'Couldn’t load mentors.';

/**
 * THE MENTOR STAGE — the product, in the first viewport.
 *
 * The hero's job is answered in three seconds, and the fastest way to answer "is
 * this a real marketplace with real people in it" is to show one. So the right half
 * of the hero is not an abstract illustration of mentorship: it is an actual
 * profile, built from the same `DirectoryMentor` row the mentor rail below it
 * renders, with the same fields the directory actually returns.
 *
 * WHAT IS REAL AND WHAT IS NOT
 *
 * Real, and rendered only when the database returns it:
 *
 *   the photo (or a monogram, never an invented face)
 *   the name
 *   the expertise tags and the approved area
 *   the mentor's own headline
 *   the next free hour, and only when the availability read actually returned one
 *   the session price, and only when a live gig has one
 *
 * Not shown, because the platform collects none of them and a landing page that
 * displays an invented number is worse than one that displays nothing: rating,
 * review count, sessions completed, years of experience, response rate. A visitor
 * deciding whether to pay an actual person an actual fee is owed an accurate card,
 * and silence is accurate.
 * "BOOK SESSION" IS A LABEL, NOT A BUTTON.
 *
 * It names the action the picture depicts. The stage carries no handler, no role,
 * no tab stop and no pointer cursor, for the same reason the segment orbit is not
 * a navigation: everything in this component is `aria-hidden`, because the one real
 * route to a profile is the mentor rail further down the page. A visitor who taps
 * the most card-shaped object in the first viewport and gets nothing would be
 * misled by it, which is why it is set as a caption inside the frame rather than
 * as a control that looks like it should work.
 *
 * THE ORBIT IS THE ARGUMENT.
 *
 * Real mentorship-area names from the live catalogue, set on a restrained ellipse
 * around the profile with a hairline drawn from each one to the person. It is the
 * one gesture that communicates what the product does — different questions, one
 * relevant mentor — and it is deliberately not a network diagram: no boxes, no
 * infrastructure language, no arrows, no server shapes. Four words and a thread.
 *
 * With more areas than fit, the orbit takes the first four. Taking the first four
 * rather than a sample is deliberate: the catalogue is already ordered by the CMS
 * `priority` column, so the first four are the ones the team chose to lead with.
 *
 * THE DEPTH IS THREE DEGREES.
 *
 * `rotateX` and `rotateY` move across ±3deg from the pointer's position, plus a
 * cursor-following light. At that amplitude the frame reads as a physical object
 * under a real light source; any more and the text inside it starts to swim, which
 * is the moment a "premium" tilt becomes a gimmick.
 *
 * Both are switched off for coarse pointers — a phone has no cursor to follow, and
 * a tilt driven by a finger produces motion nobody asked for — and under
 * `prefers-reduced-motion`, where the frame renders flat and fully readable.
 */

/** How many areas the orbit can hold before it stops reading as an orbit. */
const ORBIT_SLOTS = 4;

/** Seconds one slow drift takes. Long enough not to be watched. */
const DRIFT_S = 9;

/**
 * The orbit's geometry, as fractions of the frame.
 *
 * Four positions on an ellipse, alternating above and below, so the profile is
 * framed rather than surrounded — a ring of equal nodes reads as a target diagram
 * and a diagram is what the brief is asking this page to stop looking like.
 */
const ORBIT_POINTS: readonly { x: number; y: number; depth: number }[] = [
  { x: 0.14, y: 0.3, depth: -1 },
  { x: 0.86, y: 0.24, depth: 1 },
  { x: 0.1, y: 0.78, depth: 1 },
  { x: 0.9, y: 0.74, depth: -1 },
];

/** The hero's one easing curve, matched to the rest of the page. */
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** First letters of the first and last words, which is all a monogram needs. */
function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

/**
 * Coarse pointers get no pointer depth.
 *
 * Read once per mount rather than tracked per event: a device does not change its
 * input type while a page is open, and a media query in a render path is a layout
 * read on every frame.
 */
function useHasFinePointer(): boolean {
  const ref = useRef(true);
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    ref.current = window.matchMedia('(pointer: fine)').matches;
  }
  return ref.current;
}

export interface HeroMentorStageProps {
  /** The same rows the mentor rail renders, with their real availability. */
  mentors: FeaturedMentor[];
  isLoading: boolean;
  hasError: boolean;
  /** Live areas, used for the orbit. Never a fallback list. */
  segments: Segment[];
}

export const HeroMentorStage: React.FC<HeroMentorStageProps> = ({
  mentors,
  isLoading,
  hasError,
  segments,
}) => {
  const reducedMotion = useReducedMotion();
  const canAnimate = reducedMotion !== true;
  const hasFinePointer = useHasFinePointer();

  /**
   * Pointer depth, or nothing.
   *
   * One transform for the whole frame, written straight to style rather than
   * through `animate`: this is a value that changes with the pointer, not a
   * transition between two states, so it belongs in a transform and not in the
   * animation pipeline. Nothing else on the hero reads the pointer.
   */
  const frameRef = useRef<HTMLDivElement>(null);
  const lightRef = useRef<HTMLSpanElement>(null);

  const tilt = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!canAnimate || !hasFinePointer) return;

    const box = event.currentTarget.getBoundingClientRect();
    // Normalised to ±1 from the frame's own centre, so the ±3deg budget holds at
    // every viewport size rather than scaling up on a large display.
    const x = (event.clientX - (box.left + box.width / 2)) / (box.width / 2);
    const y = (event.clientY - (box.top + box.height / 2)) / (box.height / 2);

    const frame = frameRef.current;
    if (frame) {
      frame.style.transform = `perspective(1200px) rotateX(${(-y * 3).toFixed(2)}deg) rotateY(${(x * 3).toFixed(2)}deg)`;
    }

    // The light follows the pointer across the same box the frame occupies, so the
    // highlight stays inside the object instead of drifting across the hero.
    const light = lightRef.current;
    if (light) {
      light.style.transform = `translate3d(${((x + 1) / 2) * 100}%, ${((y + 1) / 2) * 100}%, 0)`;
    }
  }, [canAnimate, hasFinePointer]);

  const resetTilt = useCallback(() => {
    const frame = frameRef.current;
    if (frame) frame.style.transform = 'perspective(1200px) rotateX(0deg) rotateY(0deg)';
    const light = lightRef.current;
    if (light) light.style.transform = 'translate3d(50%, 50%, 0)';
  }, []);

  /**
   * The one profile on stage.
   *
   * A mentor with a real free hour is preferred, because the availability line is
   * the most persuasive thing in the frame and it should not go to whoever happened
   * to be first in the directory's ordering. Ties keep directory order.
   */
  const onStage =
    mentors.find((entry) => entry.availability?.state === 'available') ?? mentors[0] ?? null;

  const orbit = segments.slice(0, ORBIT_SLOTS);
  const mentor = onStage?.mentor ?? null;

  const areaName = mentor?.segments?.[0]?.name ?? null;
  const expertise = (mentor?.expertise ?? []).filter(Boolean).slice(0, 2);
  const blurb = mentor?.headline?.trim() || mentor?.about?.trim() || '';

  const freeAt = onStage?.availability?.nextLocalStartTime ?? null;
  const price =
    mentor?.starting_price_inr != null && mentor.starting_price_inr > 0
      ? `From ${formatInr(mentor.starting_price_inr)}`
      : null;

  return (
    <div className="sk-lg-stage" aria-hidden="true">
      {/* The threads, drawn to each area name before the names themselves. */}
      {canAnimate && orbit.length > 0 && (
        <svg className="sk-lg-stage__threads" viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
          <defs>
            <linearGradient id="sk-lg-stage-thread" x1="0" y1="0" x2="1" y2="1">
              <stop className="sk-lg-stage__thread-a" offset="0%" />
              <stop className="sk-lg-stage__thread-b" offset="100%" />
            </linearGradient>
          </defs>
          {orbit.map((segment, index) => {
            const point = ORBIT_POINTS[index % ORBIT_POINTS.length];
            return (
              <motion.line
                key={segment.id}
                x1="50"
                y1="50"
                x2={point.x * 100}
                y2={point.y * 100}
                stroke="url(#sk-lg-stage-thread)"
                strokeWidth="0.18"
                strokeLinecap="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{
                  duration: 1.2,
                  delay: 0.5 + index * 0.14,
                  ease: EASE,
                }}
              />
            );
          })}
        </svg>
      )}

      {/*
        The orbit. Real area names, four at most, each drifting on its own slow
        cycle and offset from its own starting fraction so the four never move
        together — a synchronised ring reads as machinery, and this is meant to read
        as people.
      */}
      {orbit.map((segment, index) => {
        const point = ORBIT_POINTS[index % ORBIT_POINTS.length];
        const drift = (index % 2 === 0 ? 1 : -1) * 3;

        return (
          <motion.span
            key={segment.id}
            className="sk-lg-stage__node"
            style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
            initial={canAnimate ? { opacity: 0, scale: 0.9 } : false}
            animate={
              canAnimate
                ? { opacity: 1, scale: 1, x: [0, drift, 0], y: [0, -drift, 0] }
                : { opacity: 1, scale: 1 }
            }
            transition={
              canAnimate
                ? {
                    opacity: { duration: 0.7, delay: 0.45 + index * 0.12 },
                    scale: { duration: 0.7, delay: 0.45 + index * 0.12, ease: EASE },
                    x: { duration: DRIFT_S, repeat: Infinity, ease: 'easeInOut' },
                    y: { duration: DRIFT_S, repeat: Infinity, ease: 'easeInOut' },
                  }
                : { duration: 0 }
            }
          >
            {segment.name}
          </motion.span>
        );
      })}

      {/* ------------------------------------------------------------------ */}
      {/* THE PROFILE                                                           */}
      {/* ------------------------------------------------------------------ */}
      <div
        ref={frameRef}
        className="sk-lg-stage__frame"
        onPointerMove={tilt}
        onPointerLeave={resetTilt}
      >
        <span className="sk-lg-stage__light" ref={lightRef} />

        <div className="sk-lg-stage__card">
          {isLoading ? (
            <StageSkeleton />
          ) : hasError && !mentor ? (
            <p className="sk-lg-stage__note" role="presentation">
              {STAGE_ERROR_LABEL}
            </p>
          ) : !mentor ? (
            <p className="sk-lg-stage__note" role="presentation">
              {STAGE_EMPTY_LABEL}
            </p>
          ) : (
            <>
              <div className="sk-lg-stage__portrait">
                {mentor.avatar_url ? (
                  <img src={mentor.avatar_url} alt="" loading="eager" decoding="async" />
                ) : (
                  <span className="sk-lg-stage__monogram">{initialsOf(mentor.full_name)}</span>
                )}
              </div>

              <div className="sk-lg-stage__identity">
                <span className="sk-lg-stage__name">{mentor.full_name}</span>
                {areaName && <span className="sk-lg-stage__area">{areaName}</span>}
              </div>

              {expertise.length > 0 && (
                <ul className="sk-lg-stage__tags">
                  {expertise.map((tag) => (
                    <li key={tag} className="sk-lg-stage__tag">
                      {tag}
                    </li>
                  ))}
                </ul>
              )}

              {blurb && <p className="sk-lg-stage__blurb">{blurb}</p>}

              {/*
                Availability is shown only when the server returned a free hour.
                A mentor with no answer from the availability read renders no time
                at all rather than a plausible-looking placeholder.
              */}
              {freeAt && (
                <span className="sk-lg-stage__availability">
                  <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                  {`${STAGE_AVAILABLE_LABEL} ${freeAt}`}
                </span>
              )}

              <div className="sk-lg-stage__foot">
                {price && <span className="sk-lg-stage__price">{price}</span>}
                <span className="sk-lg-stage__action">
                  {STAGE_ACTION_LABEL}
                  <svg viewBox="0 0 14 14" fill="none" focusable="false">
                    <path
                      d="M2 7h9.5M8 3.4 11.8 7 8 10.6"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/*
        Announced as a live region even though the stage is itself hidden
        from the accessibility tree: a visitor using a screen reader gets
        "loading" resolved to either the profile or the empty state, which
        is the difference between knowing the page is working and knowing
        it is broken.
      */}
      <span className="sk-lg-sr-only" role="status">
        {isLoading
          ? STAGE_LOADING_LABEL
          : mentor
            ? mentor.full_name
            : hasError
              ? STAGE_ERROR_LABEL
              : STAGE_EMPTY_LABEL}
      </span>
    </div>
  );
};

/**
 * A skeleton shaped like the profile it replaces.
 *
 * Same aspect and same internal rhythm as the real card — portrait block, name,
 * two tags, a line of text — so the swap to content is a fill rather than a
 * reflow. Anything else makes the hero jump at the exact moment a visitor is
 * trying to read it.
 */
const StageSkeleton: React.FC = () => (
  <div className="sk-lg-stage__skeleton">
    <span className="sk-lg-skeleton sk-lg-skeleton--portrait" />
    <span className="sk-lg-skeleton sk-lg-skeleton--line" style={{ width: '62%' }} />
    <span className="sk-lg-skeleton sk-lg-skeleton--line" style={{ width: '38%' }} />
    <span className="sk-lg-skeleton sk-lg-skeleton--line" style={{ width: '88%', marginTop: 18 }} />
    <span className="sk-lg-skeleton sk-lg-skeleton--line" style={{ width: '54%', marginTop: 10 }} />
  </div>
);

export default HeroMentorStage;