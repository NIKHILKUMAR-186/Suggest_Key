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
import { formatInr, formatNextAvailableLabel } from '@/src/lib/seekerFormat';
import type { DiscoverableMentor, DirectoryMentor, GeneratedSlot } from '@/src/types/database';
import { cn } from '@/src/lib/utils';

const EASE = [0.23, 1, 0.31, 1] as const;

/**
 * The single mentor presentation used by BOTH seeker discovery sections.
 *
 * `variant="availability"` renders a mentor who genuinely has a bookable slot
 * on the selected date, so it exposes the live session price, duration and
 * next-available slot taken from the same slot engine the detail page uses.
 * `variant="discovery"` renders a mentor who merely belongs to the segment, so
 * it shows only the fields that exist without a date (gigs, starting price).
 *
 * There is deliberately NO decorative gradient banner. The identity block is
 * the visual focus: a circular avatar, the name, a live verification badge
 * and the headline, all on the card surface itself.
 */
export type MentorCardVariant = 'availability' | 'discovery';

export interface MentorCardProps {
  variant: MentorCardVariant;
  navigate: (path: string) => void;
  /** Segment used to build the mentor detail route. */
  segmentId: string;
  /** The real selected date, forwarded to the detail page's date picker. */
  selectedDate: string;
  /**
   * The seeker's "today", in their own timezone. Used to render the live
   * "Today"/"Tomorrow" wording for the next available slot.
   */
  today: string;
  /** `availability` variant only — carries gig + slot data. */
  availableMentor?: DiscoverableMentor;
  /** `discovery` variant only — carries segment membership, no slot data. */
  directoryMentor?: DirectoryMentor;
  isFeatured?: boolean;
  className?: string;
}

/** Real initials fallback, used only when a mentor has no avatar. */
export const getMentorInitials = (fullName: string): string =>
  (fullName || '')
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'M';

/**
 * Circular mentor avatar.
 *
 * Sized with responsive Tailwind classes rather than absolute or negative
 * offsets, and given `shrink-0` inside a flex row, so it can never be clipped
 * by the card or overlap the identity block at any width.
 */
const MentorAvatar: React.FC<{ name: string; avatarUrl: string | null }> = ({
  name,
  avatarUrl,
}) => {
  const frame =
    'h-14 w-14 shrink-0 rounded-full sm:h-[68px] sm:w-[68px] border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)]';

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
      {getMentorInitials(name)}
    </div>
  );
};

/** Compact chip row for real expertise / language values. */
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
    <ul className="flex flex-wrap items-center gap-1.5" aria-label={label}>
      {visible.map((item) => (
        <li
          key={item}
          className="rounded-md border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] px-2 py-[3px] text-[11px] font-medium leading-4 text-[var(--color-shell-text-muted)]"
        >
          {item}
        </li>
      ))}
      {extra > 0 && (
        <li className="text-[11px] text-[var(--color-shell-text-subtle)]">+{extra}</li>
      )}
    </ul>
  );
};

/** Live verification state. Rendered only when the database says approved. */
const VerifiedBadge: React.FC = () => (
  <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-shell-success)]/30 bg-[var(--color-shell-success-soft)] px-2 py-[3px] text-[10px] font-semibold text-[var(--color-shell-success)]">
    <BadgeCheck className="h-3 w-3" aria-hidden="true" />
    Verified
  </span>
);

const FeaturedBadge: React.FC = () => (
  <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-shell-warning)]/35 bg-[var(--color-shell-warning-soft)] px-2 py-[3px] text-[10px] font-semibold text-[var(--color-shell-warning)]">
    <Star className="h-3 w-3 fill-current" aria-hidden="true" />
    Featured
  </span>
);

export const MentorCard: React.FC<MentorCardProps> = ({
  variant,
  navigate,
  segmentId,
  selectedDate,
  today,
  availableMentor,
  directoryMentor,
  isFeatured = false,
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

  // `is_approved` only exists on the availability shape; the directory query
  // already filters to approved + active + approved-status mentors, so that
  // variant is verified by construction.
  const isVerified =
    variant === 'availability'
      ? Boolean((mentor as DiscoverableMentor).is_approved)
      : true;

  const expertiseList = (expertise || []).filter(Boolean);
  const languageList = (languages || []).filter(Boolean);

  const detailPath = `/seeker/mentor-detail?mentorId=${id}&segmentId=${segmentId}&date=${selectedDate}`;

  // Guards against rendering a fabricated "0.0" rating for an unrated mentor.
  const hasRating = Number(rating) > 0 && (reviewCount || 0) > 0;

  // ---- Availability-variant commerce data, all from the live gig + slots ----
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

  const sessionPrice = gig ? formatInr(gig.price_inr) : '';
  const sessionDuration = gig?.duration_minutes ?? 0;

  // ---- Discovery-variant commerce data, from real active gigs ----
  const directoryGigs = variant === 'discovery' ? (mentor as DirectoryMentor).gigs : [];
  const directoryStartingPrice = formatInr(
    variant === 'discovery' ? (mentor as DirectoryMentor).starting_price_inr : null
  );
  const directoryDuration = directoryGigs[0]?.duration_minutes ?? 0;

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE }}
      className={cn(
        'seeker-card flex h-full flex-col rounded-2xl',
        isFeatured && 'ring-1 ring-[var(--color-shell-warning)]/30',
        className
      )}
    >
      <div className="flex flex-1 flex-col p-5 sm:p-6">
        {/* ---------------- Identity ---------------- */}
        <div className="flex items-center gap-4">
          <MentorAvatar name={fullName} avatarUrl={avatarUrl} />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <h3 className="font-display text-lg font-bold leading-tight tracking-tight text-[var(--color-shell-text)]">
                {fullName}
              </h3>
              {isVerified && <VerifiedBadge />}
              {isFeatured && <FeaturedBadge />}
            </div>

            {headline && (
              <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-[var(--color-shell-text-muted)]">
                {headline}
              </p>
            )}

            {/* Live rating, only when the database actually holds reviews. */}
            {hasRating && (
              <p className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-[var(--color-shell-text-muted)]">
                <Star
                  className="h-3.5 w-3.5 fill-[var(--color-shell-warning)] text-[var(--color-shell-warning)]"
                  aria-hidden="true"
                />
                <span className="font-semibold text-[var(--color-shell-text)]">
                  {Number(rating).toFixed(1)}
                </span>
                <span className="text-[var(--color-shell-text-subtle)]">
                  ({reviewCount} {reviewCount === 1 ? 'review' : 'reviews'})
                </span>
              </p>
            )}
          </div>
        </div>

        {/* ---------------- Bio preview ---------------- */}
        {about && about.trim() && (
          <p className="mt-4 line-clamp-3 text-[13px] leading-relaxed text-[var(--color-shell-text-muted)]">
            {about.trim()}
          </p>
        )}

        {/* ---------------- Expertise chips ---------------- */}
        {expertiseList.length > 0 && (
          <div className="mt-4">
            <ChipRow items={expertiseList} limit={3} label="Expertise" />
          </div>
        )}

        {/* ---------------- Segments (discovery variant only) ---------------- */}
        {variant === 'discovery' && (mentor as DirectoryMentor).segments.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Segments">
            {(mentor as DirectoryMentor).segments.map((segment) => (
              <li
                key={segment.id}
                className="rounded-md border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] px-2 py-[3px] text-[11px] font-medium leading-4 text-[var(--color-shell-text)]"
              >
                {segment.name}
              </li>
            ))}
          </ul>
        )}

        {/* ---------------- Language + timezone ---------------- */}
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

        {/* ---------------- Divider + commerce footer ---------------- */}
        <div className="mt-auto pt-5">
          <div className="h-px w-full bg-[var(--color-shell-border)]" aria-hidden="true" />

          {variant === 'availability' && availableMentor && (
            <div className="pt-4">
              <div className="flex items-end justify-between gap-4">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-shell-text-subtle)]">
                    <CalendarClock className="h-3 w-3 shrink-0" aria-hidden="true" />
                    Next available
                  </p>
                  {nextAvailableLabel ? (
                    <p className="mt-1 text-[13px] font-semibold text-[var(--color-shell-text)]">
                      {nextAvailableLabel}
                    </p>
                  ) : (
                    <p className="mt-1 text-[13px] font-semibold text-[var(--color-shell-text-subtle)]">
                      No upcoming availability
                    </p>
                  )}
                </div>

                <div className="shrink-0 text-right">
                  {sessionDuration > 0 && (
                    <p className="inline-flex items-center gap-1.5 text-[12px] text-[var(--color-shell-text-muted)]">
                      <Clock
                        className="h-3.5 w-3.5 shrink-0 text-[var(--color-shell-text-subtle)]"
                        aria-hidden="true"
                      />
                      {sessionDuration} min
                    </p>
                  )}
                  {sessionPrice && (
                    <p className="mt-1 text-[15px] font-bold leading-tight text-[var(--color-shell-text)]">
                      <span className="text-[11px] font-medium text-[var(--color-shell-text-subtle)]">
                        From{' '}
                      </span>
                      {sessionPrice}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {variant === 'discovery' && directoryMentor && (
            <div className="flex items-end justify-between gap-4 pt-4">
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
                <p className="shrink-0 text-right text-[15px] font-bold leading-tight text-[var(--color-shell-text)]">
                  <span className="text-[11px] font-medium text-[var(--color-shell-text-subtle)]">
                    From{' '}
                  </span>
                  {directoryStartingPrice}
                </p>
              )}
            </div>
          )}

          {/* ---------------- Calls to action ---------------- */}
          <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
            <button
              type="button"
              onClick={() => navigate(detailPath)}
              className="inline-flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-surface)] px-4 text-[13px] font-semibold text-[var(--color-shell-text)] transition-colors duration-150 hover:border-[var(--color-shell-primary)]/50 hover:bg-[var(--color-shell-surface-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--seeker-card-bg)] sm:flex-1"
            >
              View profile
            </button>
            <button
              type="button"
              onClick={() => navigate(detailPath)}
              className="group inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-[var(--color-shell-primary)] px-5 text-[13px] font-semibold text-[var(--color-shell-text-contrast)] shadow-[var(--shadow-sm)] transition-all duration-150 hover:bg-[var(--color-shell-primary-hover)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--seeker-card-bg)] sm:flex-1"
            >
              <span>Book session</span>
              <ArrowRight
                className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
      </div>
    </motion.article>
  );
};
