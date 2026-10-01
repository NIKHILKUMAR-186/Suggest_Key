import React from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  Clock,
  Globe,
  Languages,
  Star,
} from 'lucide-react';
import { formatLocalTimeLabel } from '@/src/lib/slotEngine';
import { formatInr, formatNextAvailableLabel, formatOriginalPrice } from '@/src/lib/seekerFormat';
import { getInitials } from '@/src/lib/avatar';
import { mentorDetailPath, mentorProfilePath, type MentorOrigin } from '@/src/lib/mentorNav';
import type { DiscoverableMentor, DirectoryMentor, GeneratedSlot } from '@/src/types/database';
import { cn } from '@/src/lib/utils';

const EASE = [0.23, 1, 0.31, 1] as const;

export type MentorCardVariant = 'availability' | 'discovery';

export interface MentorCardProps {
  variant: MentorCardVariant;
  navigate: (path: string) => void;
  segmentSlug: string;
  selectedDate: string;
  today: string;
  availableMentor?: DiscoverableMentor;
  directoryMentor?: DirectoryMentor;
  isFeatured?: boolean;
  /**
   * Where this card was opened from. Defaults to the mentor list, which is the
   * only host that renders this card today. Carrying the origin in the URL is
   * what lets mentor detail send Back to the right discovery page.
   */
  origin?: MentorOrigin;
  className?: string;
}

const EASE_CURVE = [0.23, 1, 0.31, 1] as const;

const MentorAvatar: React.FC<{ name: string; avatarUrl: string | null }> = ({
  name,
  avatarUrl,
}) => {
  const frame =
    'h-14 w-14 shrink-0 rounded-full sm:h-[68px] sm:w-[68px] border-2 border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] avatar-ring';

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={`${name} profile photo`}
        className={cn(frame, 'object-cover')}
        loading="lazy"
      />
    );
  }

  return (
    <div
      className={cn(
        frame,
        'flex items-center justify-center text-lg font-bold text-[var(--color-shell-text-muted)]'
      )}
      role="img"
      aria-label={`${name} profile photo placeholder`}
    >
      {getInitials(name)}
    </div>
  );
};

const ChipRow: React.FC<{ items: string[]; limit: number; label: string }> = ({
  items,
  limit,
  label,
}) => {
  const all = (items || []).filter(Boolean);
  const visible = all.slice(0, limit);
  const extra = all.length - visible.length;
  if (visible.length === 0) return null;

  return (
    <ul className="chip-row" aria-label={label}>
      {visible.map((item) => (
        <li key={item} className="chip">
          {item}
        </li>
      ))}
      {extra > 0 && (
        <li className="text-[11px] text-[var(--color-shell-text-subtle)]">+{extra}</li>
      )}
    </ul>
  );
};

const VerifiedBadge: React.FC = () => (
  <span className="badge badge-success">
    <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
    Verified
  </span>
);

const FeaturedBadge: React.FC = () => (
  <span className="badge" style={{ background: 'var(--color-shell-warning-soft)', color: 'var(--color-shell-warning)', border: '1px solid color-mix(in srgb, var(--color-shell-warning) 30%, transparent)' }}>
    <Star className="h-3 w-3 fill-current" aria-hidden="true" />
    Featured
  </span>
);

/**
 * The single mentor presentation used by BOTH seeker discovery sections.
 *
 * Premium card design with:
 * - Segment-aware accent touches
 * - Better visual hierarchy
 * - Improved pricing display
 * - Enhanced CTA buttons
 * - Smooth hover animations
 */
export const MentorCard: React.FC<MentorCardProps> = ({
  variant,
  navigate,
  segmentSlug,
  selectedDate,
  today,
  availableMentor,
  directoryMentor,
  isFeatured = false,
  origin = 'mentor-list',
  className,
}) => {
  const mentor = variant === 'availability' ? availableMentor : directoryMentor;
  if (!mentor) return null;

  const {
    id,
    full_name: fullName,
    avatar_url: avatarUrl,
    headline,
    about,
    experience_years: experienceYears,
    languages,
    expertise,
    rating,
    review_count: reviewCount,
    timezone,
  } = mentor;

  const isVerified =
    variant === 'availability'
      ? Boolean((mentor as DiscoverableMentor).is_approved)
      : true;

  const expertiseList = (expertise || []).filter(Boolean);
  const languageList = (languages || []).filter(Boolean);

  // Two DIFFERENT destinations, for the same reason the segment card has two:
  // "View profile" asks who this mentor is, "Book a session" asks when they are
  // free. Sharing one path made them byte-identical navigations.
  //
  // The gig travels only when this card KNOWS which one it means. The
  // availability card has exactly one gig, so it forwards it. The directory card
  // may be summarising several, and a mentor holds one ACTIVE gig PER SEGMENT,
  // so "the first one" is not a fact about the mentor - it forwards nothing and
  // the booking page resolves the gig from the segment the seeker is in.
  const onlyKnownGigId =
    variant === 'availability'
      ? ((mentor as DiscoverableMentor).gig?.id ?? null)
      : (mentor as DirectoryMentor).gigs.length === 1
        ? (mentor as DirectoryMentor).gigs[0].id
        : null;

  const bookPath = mentorDetailPath({
    mentorId: String(id),
    segmentSlug,
    gigId: onlyKnownGigId,
    date: selectedDate,
    origin,
    intent: 'book',
  });

  const profilePath = mentorProfilePath({
    mentorId: String(id),
    segmentSlug,
    date: selectedDate,
    origin,
  });

  const hasRating = Number(rating) > 0 && (reviewCount || 0) > 0;

  const gig = variant === 'availability' ? (mentor as DiscoverableMentor).gig : null;
  const nextSlot: GeneratedSlot | null =
    variant === 'availability' ? (mentor as DiscoverableMentor).next_available_slot : null;

  const nextAvailableLabel = nextSlot
    ? formatNextAvailableLabel(
        nextSlot.date,
        formatLocalTimeLabel(nextSlot.local_start_time),
        today
      )
    : null;

  // Both figures come from the gig row itself and are only rendered when the
  // original is genuinely higher; a gig with no real reduction shows one price,
  // never a struck-through one that reads as a saving.
  const sessionPrice = gig ? formatInr(gig.price_inr) : '';
  const sessionWasPrice = gig ? formatOriginalPrice(gig.price_inr, gig.original_price_inr) : '';
  const sessionDuration = gig?.duration_minutes ?? 0;

  const directoryGigs = variant === 'discovery' ? (mentor as DirectoryMentor).gigs : [];
  const startingPrice = variant === 'discovery' ? (mentor as DirectoryMentor).starting_price_inr : null;
  const directoryStartingPrice = formatInr(startingPrice);
  // The "from" price is the cheapest gig on the mentor, so the strike-through is
  // the cheapest gig's own original - never a maximum across gigs, which would
  // show a saving on a price the seeker is not being quoted.
  const cheapestGig = startingPrice === null
    ? null
    : directoryGigs.find((g) => g.price_inr === startingPrice) ?? directoryGigs[0] ?? null;
  const directoryWasPrice = cheapestGig
    ? formatOriginalPrice(cheapestGig.price_inr, cheapestGig.original_price_inr)
    : '';
  const directoryDuration = directoryGigs[0]?.duration_minutes ?? 0;

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE_CURVE }}
      className={cn(
        'seeker-card-premium relative flex h-full flex-col',
        isFeatured && 'seeker-card-featured',
        className
      )}
    >
      {/* Segment color indicator */}
      <div className="segment-indicator" aria-hidden="true" />

      <div className="mentor-card-body">
        {/* Identity header */}
        <div className="flex items-center gap-4">
          <MentorAvatar name={fullName} avatarUrl={avatarUrl} />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
              <h3 className="font-display text-lg font-bold leading-tight tracking-tight text-[var(--color-shell-text)]">
                {fullName}
              </h3>
              {isVerified && <VerifiedBadge />}
              {isFeatured && <FeaturedBadge />}
            </div>

            {headline && (
              <p className="mt-1.5 line-clamp-2 text-[13px] leading-snug text-[var(--color-shell-text-muted)]">
                {headline}
              </p>
            )}

            {/* Live rating */}
            {hasRating && (
              <div className="mt-2 inline-flex items-center gap-1.5">
                <Star
                  className="h-3.5 w-3.5 fill-[var(--color-shell-warning)] text-[var(--color-shell-warning)]"
                  aria-hidden="true"
                />
                <span className="text-[12px] font-semibold text-[var(--color-shell-text)]">
                  {Number(rating).toFixed(1)}
                </span>
                <span className="text-[12px] text-[var(--color-shell-text-subtle)]">
                  ({reviewCount} {reviewCount === 1 ? 'review' : 'reviews'})
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Bio preview */}
        {about && about.trim() && (
          <p className="mt-4 line-clamp-3 text-[13px] leading-relaxed text-[var(--color-shell-text-muted)]">
            {about.trim()}
          </p>
        )}

        {/* Expertise chips */}
        {expertiseList.length > 0 && (
          <div className="mt-4">
            <ChipRow items={expertiseList} limit={3} label="Expertise" />
          </div>
        )}

        {/* Segments (discovery variant only) */}
        {variant === 'discovery' && (mentor as DirectoryMentor).segments.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Segments">
            {(mentor as DirectoryMentor).segments.map((segment) => (
              <li
                key={segment.id}
                className="chip"
              >
                {segment.name}
              </li>
            ))}
          </ul>
        )}

        {/* Language + timezone */}
        {(languageList.length > 0 || timezone) && (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-[var(--color-shell-text-muted)]">
            {languageList.length > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <Languages
                  className="h-3.5 w-3.5 shrink-0 text-[var(--color-shell-text-subtle)]"
                  aria-hidden="true"
                />
                <span className="truncate">
                  {languageList.slice(0, 2).join(', ')}
                  {languageList.length > 2 && ` +${languageList.length - 2}`}
                </span>
              </span>
            )}
            {timezone && (
              <span className="inline-flex items-center gap-1.5">
                <Globe
                  className="h-3.5 w-3.5 shrink-0 text-[var(--color-shell-text-subtle)]"
                  aria-hidden="true"
                />
                {timezone}
              </span>
            )}
            {experienceYears > 0 && (
              <span className="text-[var(--color-shell-text-subtle)]">
                {experienceYears} {experienceYears === 1 ? 'year' : 'years'} experience
              </span>
            )}
          </div>
        )}

        {/* Commerce footer */}
        <div className="mentor-card-footer">
          {variant === 'availability' && availableMentor && (
            <div className="flex items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-shell-text-subtle)]">
                  <CalendarClock className="h-3 w-3 shrink-0" aria-hidden="true" />
                  Next available
                </p>
                {nextAvailableLabel ? (
                  <p className="mt-1.5 text-[13px] font-semibold text-[var(--color-shell-text)]">
                    {nextAvailableLabel}
                  </p>
                ) : (
                  <p className="mt-1.5 text-[13px] font-semibold text-[var(--color-shell-text-subtle)]">
                    No upcoming availability
                  </p>
                )}
              </div>

              <div className="shrink-0 text-right">
                {sessionDuration > 0 && (
                  <div className="flex items-center gap-1.5 text-[12px] text-[var(--color-shell-text-muted)]">
                    <Clock
                      className="h-3.5 w-3.5 shrink-0 text-[var(--color-shell-text-subtle)]"
                      aria-hidden="true"
                    />
                    {sessionDuration} min
                  </div>
                )}
                {sessionPrice && (
                  <p className="price-display mt-1">
                    <span className="price-label">From </span>
                    {sessionWasPrice && <span className="price-original">{sessionWasPrice}</span>}
                    <span className="price-amount">{sessionPrice}</span>
                  </p>
                )}
              </div>
            </div>
          )}

          {variant === 'discovery' && directoryMentor && (
            <div className="flex items-end justify-between gap-4">
              <div className="min-w-0 text-[12px] text-[var(--color-shell-text-subtle)]">
                {directoryGigs.length > 0 ? (
                  <p className="truncate">
                    {directoryGigs.length === 1
                      ? directoryGigs[0].title
                      : `${directoryGigs.length} active sessions`}
                  </p>
                ) : (
                  <p>No active session listed</p>
                )}
                {directoryDuration > 0 && <p className="mt-0.5">{directoryDuration} min</p>}
              </div>
              {directoryStartingPrice && (
                <p className="price-display shrink-0 text-right">
                  <span className="price-label">From </span>
                  {directoryWasPrice && <span className="price-original">{directoryWasPrice}</span>}
                  <span className="price-amount">{directoryStartingPrice}</span>
                </p>
              )}
            </div>
          )}

          {/* CTA buttons */}
          <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
            <button
              type="button"
              onClick={() => navigate(profilePath)}
              aria-label={`View ${fullName}'s full profile`}
              className="btn-secondary flex-1"
            >
              <span>View profile</span>
            </button>
            <button
              type="button"
              onClick={() => navigate(bookPath)}
              aria-label={`Book a session with ${fullName}`}
              className="btn-primary-segment flex-1"
            >
              <span>Book session</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </motion.article>
  );
};
