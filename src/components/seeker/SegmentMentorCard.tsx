/**
 * A marketplace card for one mentor inside one segment.
 *
 * Built for the new topic-driven grid rather than adapting the legacy
 * availability card: the data here is a mentor, their gig in this segment,
 * and real slot information - so every field rendered is a field that exists.
 *
 * What it deliberately does NOT show: invented achievements, invented
 * specialisms, "top mentor" badges, a "verified" tick the API never sends, or
 * any statistic the data did not return. `rating` and `review_count` render
 * only when the record actually carries them, and a mentor with no reviews
 * shows no rating at all rather than a fabricated 5.0.
 *
 * The two actions go to two DIFFERENT pages, because they are two different
 * questions. "Book a session" opens mentor detail - the existing date/slot/hold
 * experience - carrying this card's exact gig. "View profile" opens the public
 * mentor profile, which is about the mentor and every ACTIVE offer they sell.
 * See `mentorNav.ts` for the two route builders.
 *
 * Styling is composed entirely from the Suggest Key tokens and the existing
 * `sk-card` / `sk-btn` classes, so the segment accent keeps driving the card.
 */

import React from 'react';
import { ArrowRight, CalendarClock, Clock, Globe, MapPin, Star } from 'lucide-react';
import type { TopicMentor } from '@/src/lib/segmentTopics';
import { mentorDetailPath, mentorProfilePath, type MentorIntent } from '@/src/lib/mentorNav';
import { formatNextAvailableLabel } from '@/src/lib/seekerFormat';
import {
  formatLocalTimeLabel,
  getDateStringInTimezone,
} from '@/src/lib/slotEngine';
import { cn } from '@/src/lib/utils';

export interface SegmentMentorCardProps {
  mentor: TopicMentor;
  navigate: (path: string) => void;
  /** The date the segment landing page is currently scoped to, if any. */
  selectedDate?: string | null;
  /** The topic currently selected on the landing page, so Back restores it. */
  selectedTopic?: string | null;
  className?: string;
}

function formatPrice(value: number): string {
  return `₹${Number(value || 0).toLocaleString('en-IN')}`;
}

/**
 * The BOOKING route: mentor detail, so booking is completely unchanged.
 *
 * The parameter is `segmentSlug`, which is what
 * `SeekerMentorDetailPage` reads (`mentorId` + `segmentSlug`/`segmentId`).
 * Sending a key it does not understand made every card a dead end: the page
 * loaded with no segment and rendered "Mentor not found".
 *
 * `source=segment` is what makes Back contextual: it tells the detail page the
 * seeker arrived from a segment landing page, so Back returns to that landing
 * page instead of the mentor list.
 */
export function segmentMentorDetailPath(
  mentor: TopicMentor,
  context: {
    date?: string | null;
    topic?: string | null;
    intent?: MentorIntent;
  } = {}
): string {
  return mentorDetailPath({
    mentorId: mentor.id,
    segmentSlug: mentor.segment?.slug ?? '',
    gigId: mentor.gig?.id ?? null,
    date: context.date ?? null,
    topic: context.topic ?? null,
    origin: 'segment',
    intent: context.intent ?? null,
  });
}

/**
 * The PUBLIC PROFILE route: the same mentor and the same discovery context, but
 * a different page, so the two card actions can no longer be indistinguishable.
 *
 * The profile shows every ACTIVE offer this mentor has, so it takes no `gigId`:
 * naming one gig would claim the page is about that gig when it is about the
 * mentor. The seeker picks an offer on the page, and that choice carries the
 * exact gig into booking.
 */
export function segmentMentorProfilePath(
  mentor: TopicMentor,
  context: {
    date?: string | null;
    topic?: string | null;
  } = {}
): string {
  return mentorProfilePath({
    mentorId: mentor.id,
    segmentSlug: mentor.segment?.slug ?? '',
    date: context.date ?? null,
    topic: context.topic ?? null,
    origin: 'segment',
  });
}

const Avatar: React.FC<{ mentor: TopicMentor }> = ({ mentor }) => {
  const initials = (mentor.full_name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();

  if (mentor.avatar_url) {
    return (
      <img
        src={mentor.avatar_url}
        alt=""
        loading="lazy"
        decoding="async"
        className="h-12 w-12 shrink-0 rounded-2xl object-cover ring-1 ring-[var(--sk-brand-border)]"
      />
    );
  }
  return (
    <span
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-sm font-bold"
      style={{ background: 'var(--segment-accent-soft)', color: 'var(--segment-accent)' }}
      aria-hidden="true"
    >
      {initials || 'SK'}
    </span>
  );
};

export const SegmentMentorCard: React.FC<SegmentMentorCardProps> = ({
  mentor,
  navigate,
  selectedDate = null,
  selectedTopic = null,
  className,
}) => {
  const gig = mentor.gig;
  const hasRating = Number(mentor.review_count) > 0;
  // Two DIFFERENT pages, not one page with two moods.
  //
  //   "Book a session" -> mentor detail, the slot-selection experience, landing
  //                      on the date/time grid with THIS card's gig.
  //   "View profile"   -> the public mentor profile, which lists every active
  //                      offer this mentor sells and books a chosen one.
  //
  // The gig on the card is the booking context, so it travels with the book
  // action only. It is the card's own `gig`, never a lookup and never a
  // "first gig" default.
  const bookPath = segmentMentorDetailPath(mentor, {
    date: selectedDate,
    topic: selectedTopic,
    intent: 'book',
  });
  const profilePath = segmentMentorProfilePath(mentor, {
    date: selectedDate,
    topic: selectedTopic,
  });
  // Only the timezone exists as a place on the record; there is no separate
  // location field, so the card never claims a city the data does not carry.
  const location = mentor.timezone
    ? (mentor.timezone.split('/').pop()?.replace(/_/g, ' ') ?? mentor.timezone)
    : null;
  // Real slot data only. The server returns the generated slots themselves,
  // so the earliest open one IS the next available time - nothing is inferred,
  // and with no slot data the card says nothing about availability at all.
  const openSlots = (mentor.available_slots || []).filter((s) => s.is_available);
  const earliest = openSlots[0];
  const nextAvailableLabel = earliest?.date
    ? formatNextAvailableLabel(
        earliest.date,
        earliest.local_start_time
          ? formatLocalTimeLabel(earliest.local_start_time)
          : null,
        getDateStringInTimezone(new Date(), mentor.timezone || 'UTC')
      )
    : null;
  const availability = nextAvailableLabel
    ? `Next available ${nextAvailableLabel}`
    : openSlots.length > 0
      ? `${openSlots.length} open ${openSlots.length === 1 ? 'slot' : 'slots'}`
      : null;
  const languages = (mentor.languages || []).slice(0, 3);

  return (
    <article
      className={cn(
        'sk-card group flex h-full flex-col overflow-hidden transition-[box-shadow,border-color] duration-200 focus-within:border-[var(--segment-border-accent)]',
        className,
      )}
    >
      {/* Header ------------------------------------------------------------ */}
      <div className="flex items-start gap-3.5 p-4 sm:p-5">
        <Avatar mentor={mentor} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate font-display text-[16px] font-bold leading-tight tracking-tight text-[var(--sk-brand-text)]">
              {mentor.full_name}
            </h3>
            {mentor.is_featured && (
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                style={{ background: 'var(--segment-accent-soft)', color: 'var(--segment-accent)' }}
              >
                Featured
              </span>
            )}
          </div>

          {mentor.headline && (
            <p className="mt-0.5 truncate text-[13px] leading-snug text-[var(--sk-brand-text-muted)]">
              {mentor.headline}
            </p>
          )}

          {/* Real fields only. No rating appears unless reviews exist. */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--sk-brand-text-muted)]">
            {location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {location}
              </span>
            )}
            {hasRating && (
              <span className="flex items-center gap-1 font-semibold text-[var(--sk-brand-text)]">
                <Star
                  className="h-3.5 w-3.5 shrink-0"
                  style={{ color: 'var(--segment-accent)' }}
                  aria-hidden="true"
                />
                {Number(mentor.rating).toFixed(1)}
                <span className="font-normal text-[var(--sk-brand-text-muted)]">
                  ({mentor.review_count})
                </span>
              </span>
            )}
            {mentor.experience_years > 0 && (
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {mentor.experience_years} yr{mentor.experience_years === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Session offer ---------------------------------------------------- */}
      {gig && (
        <div className="mx-4 rounded-xl border border-[var(--sk-brand-border)] bg-[var(--sk-brand-canvas)] p-3.5 sm:mx-5">
          {/* The segment this gig belongs to, from the record itself. */}
          {mentor.segment?.name && (
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--sk-brand-text-muted)]">
              {mentor.segment.name}
            </p>
          )}
          <p className="text-[14px] font-semibold leading-snug text-[var(--sk-brand-text)]">
            {gig.title}
          </p>
          {gig.description && (
            <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-[var(--sk-brand-text-muted)]">
              {gig.description}
            </p>
          )}
          <div className="mt-2.5 flex items-end justify-between gap-3">
            <span className="flex items-center gap-1 text-[12px] text-[var(--sk-brand-text-muted)]">
              <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {gig.duration_minutes} min
            </span>
            <span className="text-right">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--sk-brand-text-muted)]">
                Price
              </span>
              <span
                className="font-display text-[17px] font-bold leading-tight"
                style={{ color: 'var(--segment-accent)' }}
              >
                {formatPrice(gig.price_inr)}
              </span>
            </span>
          </div>
        </div>
      )}

      {/* Availability + language ------------------------------------------ */}
      {(availability || languages.length > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 text-[12px] text-[var(--sk-brand-text-muted)] sm:px-5">
          {availability && (
            <span className="flex items-center gap-1.5 font-medium">
              <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {availability}
            </span>
          )}
          {languages.length > 0 && (
            <span className="flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {languages.join(', ')}
              {mentor.languages.length > 3 ? ` +${mentor.languages.length - 3}` : ''}
            </span>
          )}
        </div>
      )}

      {/* Actions ----------------------------------------------------------- */}
      <div className="mt-auto flex flex-col-reverse gap-2 border-t border-[var(--sk-brand-border)] p-4 sm:flex-row sm:p-5">
        <button
          type="button"
          onClick={() => navigate(bookPath)}
          className="sk-btn sk-btn-primary flex-1"
          aria-label={`Book a session with ${mentor.full_name}`}
        >
          Book a session
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => navigate(profilePath)}
          className="sk-btn sk-btn-secondary flex-1"
          aria-label={`View ${mentor.full_name}'s full profile`}
        >
          View profile
        </button>
      </div>
    </article>
  );
};

export default SegmentMentorCard;
