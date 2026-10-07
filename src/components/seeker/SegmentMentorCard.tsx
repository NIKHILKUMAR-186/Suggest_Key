/**
 * THE SEGMENT MENTOR CARD.
 *
 * A premium editorial profile-preview for one mentor on a segment
 * landing page. Every value comes from the topic-filtered marketplace
 * endpoint. Nothing is invented.
 */

import React from 'react';
import { ArrowRight, BadgeCheck, Globe } from 'lucide-react';
import { motion } from 'motion/react';
import { getInitials } from '@/src/lib/avatar';
import {
  formatInr,
  formatOriginalPrice,
  genuineOriginalPrice,
} from '@/src/lib/seekerFormat';
import {
  formatLocalTimeLabel,
  getDateStringInTimezone,
} from '@/src/lib/slotEngine';
import {
  mentorDetailPath,
  mentorProfilePath,
} from '@/src/lib/mentorNav';
import { cn } from '@/src/lib/utils';
import type { TopicMentor } from '@/src/lib/segmentTopics';

const segmentMentorDetailPath = (
  input: Parameters<typeof mentorDetailPath>[0],
): string => mentorDetailPath(input);

const segmentMentorProfilePath = (
  input: Parameters<typeof mentorProfilePath>[0],
): string => mentorProfilePath(input);

export interface SegmentMentorCardProps {
  mentor: TopicMentor;
  navigate: (path: string) => void;
  selectedDate?: string | null;
  selectedTopic?: string | null;
  className?: string;
  featured?: boolean;
}

const EASE = [0.23, 1, 0.31, 1] as const;

function locationFromTimezone(timezone: string | null | undefined): string | null {
  const tz = (timezone || '').trim();
  if (!tz) return null;
  const city = tz.split('/').pop();
  if (!city) return null;
  return city.replace(/_/g, ' ');
}

export const SegmentMentorCard: React.FC<SegmentMentorCardProps> = ({
  mentor,
  navigate,
  selectedDate = null,
  selectedTopic = null,
  className,
  featured = false,
}) => {
  const gig = mentor.gig;
  const isVerified = mentor.is_approved === true;
  const hasRating = Number(mentor.review_count) > 0;
  const openSlots = (mentor.available_slots || []).filter((s) => s.is_available);
  const today = getDateStringInTimezone(new Date(), mentor.timezone || 'UTC');

  const location = locationFromTimezone(mentor.timezone);
  const languages = (mentor.languages || []).filter(Boolean);
  const experienceYears = Number(mentor.experience_years) || 0;
  const originalPrice = genuineOriginalPrice(gig.price_inr, gig.original_price_inr);
  const originalPriceLabel = formatOriginalPrice(gig.price_inr, gig.original_price_inr);

  const bookPath = segmentMentorDetailPath({
    mentorId: mentor.id,
    segmentSlug: mentor.segment?.slug ?? null,
    gigId: mentor.gig?.id ?? null,
    date: selectedDate,
    topic: selectedTopic,
    origin: 'segment',
    intent: 'book',
  });

  const profilePath = segmentMentorProfilePath({
    mentorId: mentor.id,
    segmentSlug: mentor.segment?.slug ?? null,
    date: selectedDate,
    topic: selectedTopic,
    origin: 'segment',
  });

  const metadata: string[] = [];
  if (languages.length > 0) metadata.push(languages.join(' · '));
  if (location) metadata.push(location);
  if (experienceYears > 0) metadata.push(`${experienceYears} yr${experienceYears === 1 ? '' : 's'}`);

  // Show up to 3 slot chips. If more are available, show "+N more".
  const MAX_VISIBLE_SLOTS = 3;
  const visibleSlots = openSlots.slice(0, MAX_VISIBLE_SLOTS);
  const remainingCount = openSlots.length - MAX_VISIBLE_SLOTS;

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
      className={cn('sk-mentor-card group', featured && 'sk-mentor-card--featured', className)}
    >
      {/* Portrait / editorial image area */}
      <div className="sk-mentor-card-media">
        {mentor.avatar_url ? (
          <img
            src={mentor.avatar_url}
            alt={`${mentor.full_name} profile photo`}
            loading="lazy"
            decoding="async"
            className="sk-mentor-card-media-img"
          />
        ) : (
          <span className="sk-mentor-card-media-fallback" aria-hidden="true">
            {getInitials(mentor.full_name)}
          </span>
        )}

        {isVerified && (
          <span className="sk-mentor-card-verified">
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Verified
          </span>
        )}
        {mentor.segment?.name && (
          <span className="sk-mentor-card-segment">{mentor.segment.name}</span>
        )}
      </div>

      {/* Body */}
      <div className="sk-mentor-card-body">
        <h3 className="sk-mentor-card-name">{mentor.full_name}</h3>
        {mentor.headline && <p className="sk-mentor-card-headline">{mentor.headline}</p>}

        {metadata.length > 0 && (
          <p className="sk-mentor-card-meta">
            {metadata.map((part, i) => (
              <span key={part}>
                {i > 0 && <span className="sk-mentor-card-meta-sep" aria-hidden="true">·</span>}
                {part}
              </span>
            ))}
          </p>
        )}

        {hasRating && (
          <p className="sk-mentor-card-rating">
            <span className="sk-mentor-card-rating-value">{Number(mentor.rating).toFixed(1)}</span>
            <span className="sk-mentor-card-rating-count">
              {mentor.review_count} review{mentor.review_count === 1 ? '' : 's'}
            </span>
          </p>
        )}

        {mentor.about && mentor.about.trim() && (
          <p className="sk-mentor-card-bio line-clamp-3">{mentor.about.trim()}</p>
        )}

        {gig && (
          <div className="sk-mentor-card-offer">
            <div className="sk-mentor-card-offer-top">
              <p className="sk-mentor-card-offer-title">{gig.title}</p>
              {gig.description && (
                <p className="sk-mentor-card-offer-desc line-clamp-2">{gig.description}</p>
              )}
            </div>
            <div className="sk-mentor-card-offer-row">
              <span className="sk-mentor-card-duration">
                {gig.duration_minutes} min
              </span>
              <span className="sk-mentor-card-price">
                {originalPriceLabel && (
                  <span className="sk-mentor-card-price-original">{originalPriceLabel}</span>
                )}
                <span className="sk-mentor-card-price-amount">{formatInr(gig.price_inr)}</span>
                <span className="sk-mentor-card-price-unit">/ session</span>
              </span>
            </div>
          </div>
        )}

        {/* Slot chips — real, server-generated bookable times. */}
        <div className="sk-mentor-card-availability">
          {openSlots.length > 0 ? (
            <>
              <span className="sk-mentor-card-avail-label">Available times</span>
              <div className="sk-slot-chips">
                {visibleSlots.map((slot) => {
                  const slotDate = slot.date || today;
                  const timeLabel = slot.local_start_time
                    ? formatLocalTimeLabel(slot.local_start_time)
                    : null;
                  const isToday = slotDate === today;
                  const dateLabel = isToday ? 'Today' : slotDate;

                  return (
                    <button
                      key={`${slot.date || today}-${slot.local_start_time || 'tbd'}`}
                      type="button"
                      onClick={() => {
                        const path = segmentMentorDetailPath({
                          mentorId: mentor.id,
                          segmentSlug: mentor.segment?.slug ?? null,
                          gigId: mentor.gig?.id ?? null,
                          date: slotDate,
                          topic: selectedTopic,
                          origin: 'segment',
                          intent: 'book',
                          slotTime: slot.local_start_time || undefined,
                        });
                        navigate(path);
                      }}
                      className="sk-slot-chip"
                      aria-label={`${dateLabel} at ${timeLabel || 'TBD'}`}
                    >
                      <span className="sk-slot-chip-time">{timeLabel}</span>
                      {!isToday && (
                        <span className="sk-slot-chip-date">{dateLabel}</span>
                      )}
                    </button>
                  );
                })}
                {remainingCount > 0 && (
                  <button
                    type="button"
                    onClick={() => navigate(bookPath)}
                    className="sk-slot-chip"
                    aria-label={`${remainingCount} more available times`}
                  >
                    +{remainingCount} more
                  </button>
                )}
              </div>
              {location && (
                <span className="sk-slot-context">
                  <Globe className="sk-slot-context-icon h-3 w-3" aria-hidden="true" />
                  {location}
                </span>
              )}
            </>
          ) : (
            <span className="sk-slot-empty">No upcoming slots</span>
          )}
        </div>

        <div className="sk-mentor-card-cta">
          <button
            type="button"
            onClick={() => navigate(profilePath)}
            aria-label={`View ${mentor.full_name}'s full profile`}
            className="sk-mentor-card-view"
          >
            View profile
            <ArrowRight className="sk-mentor-card-arrow" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => navigate(bookPath)}
            aria-label={`Book a session with ${mentor.full_name}`}
            className="sk-mentor-card-book"
          >
            Book a session
          </button>
        </div>
      </div>
    </motion.article>
  );
};

export default SegmentMentorCard;
