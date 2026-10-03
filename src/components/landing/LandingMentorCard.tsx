import { ArrowRight } from 'lucide-react';
import React from 'react';
import type { DirectoryMentor } from '@/src/types/database';
import { formatInr } from '@/src/lib/seekerFormat';

/**
 * MENTOR PREVIEW CARD.
 *
 * Portrait first, then a name, the area they are approved for, one line of their
 * own words, and only the facts the directory actually returns — session length
 * and starting price, both read from the live gig row.
 *
 * What is deliberately absent is as important as what is present. There is no
 * score, no number of sessions, no star row and no endorsement, because the
 * platform collects none of those and a card that invented them would be the
 * single most damaging thing on the page. A visitor who trusts this brand
 * enough to pay for a session is owed an accurate card.
 *
 * The portrait carries an empty `alt`: the mentor's name is the adjacent text,
 * so announcing the image again would just repeat it. When a mentor has no
 * avatar the monogram is decorative for the same reason.
 */

export interface LandingMentorCardProps {
  mentor: DirectoryMentor;
  onOpen: (mentor: DirectoryMentor) => void;
}

/** First letters of the first two words, which is all a monogram needs. */
function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return (first + second).toUpperCase() || '?';
}

function formatDuration(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hr`;
}

export const LandingMentorCard: React.FC<LandingMentorCardProps> = ({ mentor, onOpen }) => {
  const areaName = mentor.segments[0]?.name ?? null;
  const intro = mentor.headline?.trim() || mentor.about?.trim() || '';

  const duration = formatDuration(mentor.gigs?.[0]?.duration_minutes);
  const price =
    mentor.starting_price_inr != null && mentor.starting_price_inr > 0
      ? `From ${formatInr(mentor.starting_price_inr)}`
      : null;

  return (
    <button
      type="button"
      className="sk-lp-mentor"
      onClick={() => onOpen(mentor)}
      aria-label={`View ${mentor.full_name}'s profile`}
    >
      <span className="sk-lp-mentor__portrait">
        {mentor.avatar_url ? (
          <img
            src={mentor.avatar_url}
            alt=""
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="sk-lp-mentor__monogram" aria-hidden="true">
            {initialsOf(mentor.full_name)}
          </span>
        )}
      </span>

      <span className="block">
        <span className="sk-lp-mentor__name block">{mentor.full_name}</span>
        {areaName && <span className="sk-lp-mentor__specialty block">{areaName}</span>}
        {intro && <span className="sk-lp-mentor__bio block">{intro}</span>}

        {(duration || price) && (
          <span className="sk-lp-mentor__facts">
            {duration && (
              <span>
                <strong>{duration}</strong> session
              </span>
            )}
            {price && (
              <span>
                <strong>{price}</strong>
              </span>
            )}
          </span>
        )}

        <span className="sk-lp-link sk-lp-link--on-plum sk-lp-mentor__go">
          View profile
          <ArrowRight className="h-4 w-4 sk-lp-link__arrow" aria-hidden="true" />
        </span>
      </span>
    </button>
  );
};