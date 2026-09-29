/**
 * A marketplace card for one mentor inside one segment.
 *
 * Built for the new topic-driven grid rather than adapting the legacy
 * availability card: the data here is a mentor, their gig in this segment,
 * and real slot information - so every field rendered is a field that exists.
 *
 * What it deliberately does NOT show: invented achievements, invented
 * specialisms, "top mentor" badges, or any statistic the API did not return.
 * `rating` and `review_count` render only when the record actually carries
 * them, and a mentor with no reviews shows no rating at all rather than a
 * fabricated 5.0.
 */

import React from 'react';
import { ArrowRight, Clock, Globe, Star } from 'lucide-react';
import type { TopicMentor } from '@/src/lib/segmentTopics';
import { cn } from '@/src/lib/utils';

export interface SegmentMentorCardProps {
  mentor: TopicMentor;
  navigate: (path: string) => void;
  /** The earliest bookable time, when the request was date-scoped. */
  nextSlotLabel?: string | null;
  className?: string;
}

function formatPrice(value: number): string {
  return `₹${Number(value || 0).toLocaleString('en-IN')}`;
}

/**
 * The existing mentor-detail route, so booking is completely unchanged.
 *
 * The parameter is `segmentSlug`, which is what
 * `SeekerMentorDetailPage` reads (`mentorId` + `segmentSlug`/`segmentId`).
 * Sending a key it does not understand made every card a dead end: the page
 * loaded with no segment and rendered "Mentor not found".
 */
export function segmentMentorDetailPath(mentor: TopicMentor): string {
  const params = new URLSearchParams({
    mentorId: mentor.id,
    segmentSlug: mentor.segment?.slug ?? '',
  });
  if (mentor.gig?.id) params.set('gigId', mentor.gig.id);
  return `/seeker/mentor-detail?${params.toString()}`;
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
        className="h-14 w-14 shrink-0 rounded-2xl object-cover ring-1 ring-[var(--sk-brand-border)]"
      />
    );
  }
  return (
    <span
      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-[15px] font-bold"
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
  nextSlotLabel = null,
  className,
}) => {
  const gig = mentor.gig;
  const hasRating = Number(mentor.review_count) > 0;
  // Real gig titles from the database. Only worth showing when a mentor has
  // more than one - otherwise the list would repeat the gig already rendered
  // above it. Never a generated "speciality" label.
  const gigTags = (mentor.gigs || []).length > 1 ? (mentor.gigs || []).slice(0, 2) : [];

  return (
    <article
      className={cn(
        'sk-card group flex flex-col overflow-hidden p-0 transition-[transform,box-shadow,border-color] duration-200',
        className,
      )}
    >
      <div className="flex flex-1 flex-col p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <Avatar mentor={mentor} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h3 className="truncate font-display text-[17px] font-bold tracking-tight text-[var(--sk-brand-text)]">
                {mentor.full_name}
              </h3>
              {mentor.is_featured && (
                <span
                  className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider"
                  style={{ background: 'var(--segment-accent-soft)', color: 'var(--segment-accent)' }}
                >
                  Featured
                </span>
              )}
            </div>

            {mentor.headline && (
              <p className="mt-1.5 line-clamp-2 text-[13.5px] leading-snug text-[var(--sk-brand-text-muted)]">
                {mentor.headline}
              </p>
            )}

            {/* Real fields only. No rating row appears unless reviews exist. */}
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12.5px] text-[var(--sk-brand-text-muted)]">
              {hasRating && (
                <span className="flex items-center gap-1 font-semibold text-[var(--sk-brand-text)]">
                  <Star className="h-3.5 w-3.5" style={{ color: 'var(--segment-accent)' }} aria-hidden="true" />
                  {Number(mentor.rating).toFixed(1)}
                  <span className="font-normal text-[var(--sk-brand-text-muted)]">
                    ({mentor.review_count})
                  </span>
                </span>
              )}
              {mentor.experience_years > 0 && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  {mentor.experience_years} yr{mentor.experience_years === 1 ? '' : 's'}
                </span>
              )}
              {mentor.timezone && (
                <span className="flex items-center gap-1">
                  <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                  {mentor.timezone.split('/').pop()?.replace(/_/g, ' ') ?? mentor.timezone}
                </span>
              )}
            </div>
          </div>
        </div>

        {gig && (
          <div className="mt-4 rounded-xl border border-[var(--sk-brand-border)] bg-[var(--sk-brand-surface)] p-4">
            <p className="text-[13.5px] font-semibold leading-snug text-[var(--sk-brand-text)]">
              {gig.title}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-[var(--sk-brand-text-muted)]">
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                {gig.duration_minutes} min
              </span>
              <span className="font-semibold text-[var(--sk-brand-text)]">{formatPrice(gig.price_inr)}</span>
            </div>
          </div>
        )}

        {gigTags.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Mentor sessions">
            {gigTags.map((g) => (
              <li
                key={g.id}
                className="rounded-full border border-[var(--sk-brand-border)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--sk-brand-text-muted)]"
              >
                {g.title}
              </li>
            ))}
          </ul>
        )}

        {mentor.languages.length > 0 && (
          <p className="mt-3 text-[12px] text-[var(--sk-brand-text-muted)]">
            Speaks {mentor.languages.slice(0, 3).join(', ')}
            {mentor.languages.length > 3 ? ` +${mentor.languages.length - 3}` : ''}
          </p>
        )}

        {nextSlotLabel && (
          <p className="mt-3 text-[12.5px] font-medium" style={{ color: 'var(--segment-accent)' }}>
            Next available {nextSlotLabel}
          </p>
        )}
      </div>

      <div className="mt-auto flex items-center gap-2 border-t border-[var(--sk-brand-border)] bg-[var(--sk-brand-canvas)] px-5 py-4 sm:px-6">
        <button
          type="button"
          onClick={() => navigate(segmentMentorDetailPath(mentor))}
          className="sk-btn sk-btn-primary flex-1"
        >
          Book session
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => navigate(segmentMentorDetailPath(mentor))}
          className="sk-btn sk-btn-secondary"
        >
          View profile
        </button>
      </div>
    </article>
  );
};

export default SegmentMentorCard;