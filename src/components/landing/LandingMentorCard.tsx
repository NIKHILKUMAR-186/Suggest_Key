import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import React from 'react';
import type { DirectoryMentor } from '@/src/types/database';
import { formatInr } from '@/src/lib/seekerFormat';

/**
 * MENTOR CARD — one channel in the bank.
 *
 * Portrait, name, the area the mentor is approved for, and one line of their own
 * words. Only facts the directory actually returns are shown: session length and
 * starting price, both read from the live gig row.
 *
 * What is deliberately absent matters more than what is present. No score, no
 * number of sessions, no star row, no endorsement — the platform collects none of
 * those, and a card that invented them would be the single most damaging thing on
 * the page. A visitor who trusts this brand enough to pay for an hour is owed an
 * accurate card.
 *
 * The portrait carries an empty `alt`: the mentor's name is the adjacent text, so
 * announcing the image again would only repeat it. The monogram is decorative for
 * the same reason — and it exists because a missing avatar should not read as a
 * fault. Inventing a face for a real person would be worse.
 *
 * THE ARRIVAL IS PER CARD, NOT PER RAIL.
 *
 * The rail is a horizontal scroller, so a reveal on the rail would play once for
 * the whole row and the seventh mentor would arrive already settled at the moment
 * it was swept into view. The hover lift stays in CSS, because a motion hover on
 * top of a rail that is itself moving is how a card ends up drifting.
 */

export interface LandingMentorCardProps {
  mentor: DirectoryMentor;
  /** Position in the rail. Drives the arrival stagger; the database decides it. */
  index?: number;
  onOpen: (mentor: DirectoryMentor) => void;
}

/** First letters of the first and last words, which is all a monogram needs. */
function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + last).toUpperCase() || '?';
}

function formatDuration(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hr`;
}

export const LandingMentorCard: React.FC<LandingMentorCardProps> = ({
  mentor,
  index = 0,
  onOpen,
}) => {
  const canAnimate = useReducedMotion() !== true;

  const areaName = mentor.segments[0]?.name ?? null;
  const intro = mentor.headline?.trim() || mentor.about?.trim() || '';

  const duration = formatDuration(mentor.gigs?.[0]?.duration_minutes);
  const price =
    mentor.starting_price_inr != null && mentor.starting_price_inr > 0
      ? `From ${formatInr(mentor.starting_price_inr)}`
      : null;

  return (
    <li className="sk-lg-mentor sk-lg-mentor--grid">
      {/*
        The arrival is on the button, not the `li`.
      */}
      <motion.button
        type="button"
        className="sk-lg-mentor__hit"
        onClick={() => onOpen(mentor)}
        aria-label={`View ${mentor.full_name}’s profile`}
        initial={canAnimate ? { opacity: 0, y: 24 } : false}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{
          duration: 0.72,
          delay: Math.min(index, 6) * 0.07,
          ease: [0.22, 1, 0.36, 1],
        }}
      >
        <span className="sk-lg-mentor__portrait">
          {mentor.avatar_url ? (
            <img src={mentor.avatar_url} alt="" loading="lazy" decoding="async" />
          ) : (
            <span className="sk-lg-mentor__monogram" aria-hidden="true">
              {initialsOf(mentor.full_name)}
            </span>
          )}
        </span>

        <span className="sk-lg-mentor__body">
          <span className="sk-lg-mentor__name">{mentor.full_name}</span>
          {areaName && <span className="sk-lg-mentor__specialty">{areaName}</span>}
          {intro && <span className="sk-lg-mentor__bio">{intro}</span>}

          <span className="sk-lg-mentor__meta">
            {(duration || price) && (
              <span className="sk-lg-figure">
                {[duration, price].filter(Boolean).join(' · ')}
              </span>
            )}
            <span className="sk-lg-mentor__go" aria-hidden="true">
              Profile
              <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </span>
        </span>
      </motion.button>
    </li>
  );
};

export default LandingMentorCard;