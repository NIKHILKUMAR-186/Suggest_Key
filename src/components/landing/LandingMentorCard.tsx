import React from 'react';
import { ArrowRight, CalendarClock, Clock } from 'lucide-react';
import { Badge } from '@/src/components/ui/Badge';
import { getInitials } from '@/src/lib/avatar';
import { formatInr, formatNextAvailableLabel, formatShortDate } from '@/src/lib/seekerFormat';
import { deriveSegmentTheme } from '@/src/lib/segmentTheme';
import type { FeaturedMentor } from '@/src/hooks/useFeaturedMentors';
import { cn } from '@/src/lib/utils';

export interface LandingMentorCardProps {
  entry: FeaturedMentor;
  today: string;
  onOpen: () => void;
}

const Avatar: React.FC<{ name: string; avatarUrl: string | null }> = ({ name, avatarUrl }) => {
  const frame =
    'h-14 w-14 shrink-0 rounded-2xl border border-[var(--sk-brand-border)] bg-[var(--sk-brand-canvas)] object-cover';

  if (avatarUrl) {
    return <img src={avatarUrl} alt={`${name} profile photo`} className={frame} loading="lazy" />;
  }

  return (
    <div
      className={cn(frame, 'flex items-center justify-center text-base font-bold text-[var(--sk-brand-text-muted)]')}
      role="img"
      aria-label={`${name} profile photo placeholder`}
    >
      {getInitials(name)}
    </div>
  );
};

/**
 * FEATURED MENTOR CARD.
 *
 * Every field is a real value off a real `DirectoryMentor`: photo
 * (`avatar_url` + shared initials fallback), name (`full_name`), bio
 * (`headline`, then `about` — both mentor-authored), segment (for its runtime
 * accent), gig title (the first ACTIVE gig, or how many), duration (that gig's
 * real `duration_minutes`), price (`starting_price_inr`, the lowest active gig
 * price) and availability (the server's own answer, or nothing).
 *
 * What is deliberately absent: rating, review count, session count and any
 * quote. The product has no review system, and `mentor_profiles.rating` /
 * `review_count` are columns with no real reviews behind them, so rendering
 * them would assert something that is not true.
 */
export const LandingMentorCard: React.FC<LandingMentorCardProps> = ({ entry, today, onOpen }) => {
  const { mentor, availability } = entry;
  const primarySegment = mentor.segments[0] ?? null;
  const theme = deriveSegmentTheme(primarySegment?.experience_config, 'light');
  const accent = theme.accent;

  const primaryGig = mentor.gigs[0] ?? null;
  const duration = primaryGig?.duration_minutes ?? null;
  const price = formatInr(mentor.starting_price_inr);

  // `available` and `none` are both real answers from the server. `null` is
  // "no answer" (signed out, or the availability read failed) and deliberately
  // renders no time at all rather than a guess.
  const nextLabel =
    availability?.state === 'available' && availability.nextLocalStartTime
      ? formatNextAvailableLabel(today, availability.nextLocalStartTime, today)
      : null;

  return (
    <article
      style={theme.variables}
      className="group flex h-full flex-col rounded-[26px] border border-[var(--sk-brand-border)] bg-[var(--sk-brand-surface)] p-6 shadow-[var(--sk-shadow-card)] transition-all duration-200 hover:-translate-y-1.5 hover:shadow-[var(--sk-shadow-card-hover)] sm:p-7"
    >
      <div className="flex items-start gap-4">
        <Avatar name={mentor.full_name} avatarUrl={mentor.avatar_url} />

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold leading-tight tracking-tight text-[var(--sk-brand-text)]">
            {mentor.full_name}
          </h3>
          {mentor.experience_years > 0 ? (
            <p className="mt-1 text-[12px] text-[var(--sk-brand-text-muted)]">
              {mentor.experience_years} {mentor.experience_years === 1 ? 'year' : 'years'} of experience
            </p>
          ) : null}
          {primarySegment ? (
            <span
              className="mt-2 inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
              style={{ backgroundColor: theme.variables['--segment-accent-soft'], color: accent }}
            >
              {primarySegment.name}
            </span>
          ) : null}
        </div>
      </div>

      {mentor.headline || mentor.about ? (
        <p className="mt-5 line-clamp-3 text-[13.5px] leading-relaxed text-[var(--sk-brand-text-muted)]">
          {mentor.headline || mentor.about}
        </p>
      ) : null}
{/* Gig, duration and price. Each is omitted when the mentor has no active
          gig to describe, rather than filled with a placeholder. */}
      {primaryGig || price ? (
        <div className="mt-5 rounded-2xl border border-[var(--sk-brand-border)] bg-[var(--sk-brand-canvas)]/70 p-4">
          <p className="line-clamp-1 text-[13px] font-semibold text-[var(--sk-brand-text)]">
            {mentor.gigs.length > 1 ? `${mentor.gigs.length} active sessions` : primaryGig?.title ?? 'Session'}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-[var(--sk-brand-text-muted)]">
            {duration ? (
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                {duration} min
              </span>
            ) : null}
            {price ? <span className="font-semibold text-[var(--sk-brand-text)]">{price}</span> : null}
          </div>
        </div>
      ) : null}

      <div className="mt-auto pt-6">
        {/* Availability is a server fact or it is nothing at all. */}
        {nextLabel ? (
          <Badge variant="success" className="gap-1.5">
            <CalendarClock className="h-3 w-3" aria-hidden="true" />
            Next free: {nextLabel}
          </Badge>
        ) : availability?.state === 'none' ? (
          <p className="text-[12px] text-[var(--sk-brand-text-muted)]">No open slot on {formatShortDate(today)}</p>
        ) : null}

        <button
          type="button"
          onClick={onOpen}
          aria-label={`View ${mentor.full_name}'s mentor profile`}
          className="mt-5 inline-flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-[var(--sk-brand-border-strong)] bg-[var(--sk-brand-surface)] px-4 text-[13.5px] font-semibold text-[var(--sk-brand-text)] transition-colors hover:bg-[var(--sk-brand-canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] focus-visible:ring-offset-2"
        >
          View Mentor
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </article>
  );
};

/** A skeleton with the card's own shape, so the grid does not reflow on load. */
export const LandingMentorCardSkeleton: React.FC = () => (
  <div
    aria-hidden="true"
    className="flex h-full flex-col rounded-[26px] border border-[var(--sk-brand-border)] bg-[var(--sk-brand-surface)] p-6 shadow-[var(--sk-shadow-card)] sm:p-7"
  >
    <div className="flex items-start gap-4">
      <div className="h-14 w-14 shrink-0 animate-pulse rounded-2xl bg-[var(--sk-brand-canvas)]" />
      <div className="flex-1 space-y-2 pt-1">
        <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--sk-brand-canvas)]" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-[var(--sk-brand-canvas)]" />
      </div>
    </div>
    <div className="mt-5 space-y-2">
      <div className="h-3.5 w-full animate-pulse rounded bg-[var(--sk-brand-canvas)]" />
      <div className="h-3.5 w-4/5 animate-pulse rounded bg-[var(--sk-brand-canvas)]" />
    </div>
    <div className="mt-5 h-[74px] animate-pulse rounded-2xl bg-[var(--sk-brand-canvas)]" />
    <div className="mt-auto h-11 w-full animate-pulse rounded-xl bg-[var(--sk-brand-canvas)]" />
  </div>
);
