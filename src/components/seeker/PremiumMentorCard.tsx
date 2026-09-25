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
  UserRound,
} from 'lucide-react';
import { DiscoverableMentor, Segment } from '@/src/types/database';
import { formatLocalTimeLabel } from '@/src/lib/slotEngine';
import { cn } from '@/src/lib/utils';

interface PremiumMentorCardProps {
  mentor: DiscoverableMentor;
  selectedSegment: Segment | null;
  selectedDate: string;
  navigate: (path: string) => void;
  isFeatured?: boolean;
}

/**
 * Marketplace mentor card.
 *
 * Consumes exactly the fields the discovery query already returns. Optional
 * fields (image, expertise, languages, headline, next slot) are hidden when
 * they are absent rather than being filled with placeholder values.
 */
export const PremiumMentorCard: React.FC<PremiumMentorCardProps> = ({
  mentor,
  selectedSegment,
  selectedDate,
  navigate,
  isFeatured = false,
}) => {
  const initials =
    mentor.full_name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase() || 'M';

  const expertise = (mentor.expertise || []).slice(0, 3);
  const languages = (mentor.languages || []).slice(0, 2);
  const extraLanguages = (mentor.languages || []).length - languages.length;

  const detailPath = `/seeker/mentor-detail?mentorId=${mentor.id}&segmentId=${
    selectedSegment?.id || mentor.segment.id
  }&date=${selectedDate}`;

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.23, 1, 0.31, 1] }}
      className={cn(
        'seeker-card group flex flex-col overflow-hidden rounded-3xl',
        isFeatured && 'ring-1 ring-[var(--color-shell-warning)]/30'
      )}
    >
      {/* Cover band — decorative surface, not a photo */}
      <div className="relative h-24 w-full shrink-0 overflow-hidden">
        <div
          className="seeker-card-image-fallback absolute inset-0"
          aria-hidden="true"
        />
        <div
          className="absolute inset-0 bg-gradient-to-t from-[var(--seeker-card-bg)] via-transparent to-transparent"
          aria-hidden="true"
        />

        {isFeatured && (
          <span className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-full border border-[var(--color-shell-warning)]/35 bg-[var(--color-shell-bg)]/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--color-shell-warning)] backdrop-blur-sm">
            <Star className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
            Featured
          </span>
        )}
      </div>

      <div className="-mt-10 flex flex-1 flex-col px-5 pb-5 sm:px-6 sm:pb-6">
        {/* Identity */}
        <div className="flex items-end gap-4">
          {mentor.avatar_url ? (
            <img
              src={mentor.avatar_url}
              alt={`${mentor.full_name} profile photo`}
              className="h-20 w-20 shrink-0 rounded-2xl border-2 border-[var(--seeker-card-bg)] object-cover shadow-[var(--shadow-md)]"
              loading="lazy"
            />
          ) : (
            <div
              className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border-2 border-[var(--seeker-card-bg)] bg-[var(--color-shell-surface-elevated)] text-xl font-bold text-[var(--color-shell-text)] shadow-[var(--shadow-md)]"
              aria-hidden="true"
            >
              {initials}
            </div>
          )}

          <div className="min-w-0 flex-1 pb-1">
            <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 font-display text-[17px] font-bold leading-tight tracking-tight text-[var(--color-shell-text)]">
              <span className="truncate">{mentor.full_name}</span>
              {mentor.is_approved && (
                <BadgeCheck
                  className="h-4 w-4 shrink-0 text-[var(--color-shell-accent)]"
                  aria-label="Verified mentor"
                />
              )}
            </h3>
            {mentor.headline && (
              <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-[var(--color-shell-text-muted)]">
                {mentor.headline}
              </p>
            )}
          </div>
        </div>

        {/* Experience + segment metadata */}
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11.5px] font-medium text-[var(--color-shell-text-subtle)]">
          {typeof mentor.experience_years === 'number' && mentor.experience_years > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
              {mentor.experience_years} yr{mentor.experience_years === 1 ? '' : 's'} experience
            </span>
          )}
          {mentor.segment?.name && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1 w-1 rounded-full bg-[var(--color-shell-border-strong)]" aria-hidden="true" />
              {mentor.segment.name}
            </span>
          )}
        </div>

        {/* Expertise */}
        {expertise.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Expertise">
            {expertise.map((item) => (
              <li
                key={item}
                className="rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-shell-text-muted)]"
              >
                {item}
              </li>
            ))}
          </ul>
        )}

        {/* Gig */}
        <div className="mt-5 rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-shell-text-subtle)]">
            Session
          </p>
          <h4 className="mt-1.5 text-sm font-semibold leading-snug text-[var(--color-shell-text)]">
            {mentor.gig.title}
          </h4>
          {mentor.gig.description && (
            <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-[var(--color-shell-text-muted)]">
              {mentor.gig.description}
            </p>
          )}

          <div className="mt-3.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-display text-xl font-bold tracking-tight text-[var(--color-shell-text)]">
              ₹{mentor.gig.price_inr}
            </span>
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--color-shell-text-muted)]">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {mentor.gig.duration_minutes} min
            </span>
          </div>
        </div>

        {/* Language + timezone */}
        {(languages.length > 0 || mentor.timezone) && (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-[var(--color-shell-text-muted)]">
            {languages.length > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <Languages className="h-3.5 w-3.5 text-[var(--color-shell-text-subtle)]" aria-hidden="true" />
                {languages.join(', ')}
                {extraLanguages > 0 && (
                  <span className="text-[var(--color-shell-text-subtle)]">+{extraLanguages}</span>
                )}
              </span>
            )}
            {mentor.timezone && (
              <span className="inline-flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5 text-[var(--color-shell-text-subtle)]" aria-hidden="true" />
                {mentor.timezone}
              </span>
            )}
          </div>
        )}

        {/* Next available + CTAs */}
        <div className="mt-5 flex flex-col gap-4 border-t border-[var(--color-shell-border)] pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-shell-text-subtle)]">
              <CalendarClock className="h-3 w-3" aria-hidden="true" />
              Next available
            </p>
            {mentor.next_available_slot ? (
              <p className="mt-1 text-[13px] font-semibold text-[var(--color-shell-text)]">
                {formatLocalTimeLabel(mentor.next_available_slot.local_start_time)}
              </p>
            ) : (
              <p className="mt-1 text-[13px] text-[var(--color-shell-text-subtle)]">
                No slots on this date
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(detailPath)}
              className="inline-flex min-h-[40px] flex-1 cursor-pointer items-center justify-center rounded-xl border border-[var(--color-shell-border-strong)] px-3.5 text-[12.5px] font-semibold text-[var(--color-shell-text-muted)] transition-colors duration-150 hover:border-[var(--color-shell-primary)]/50 hover:text-[var(--color-shell-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] sm:flex-none"
            >
              View profile
            </button>
            <button
              type="button"
              onClick={() => navigate(detailPath)}
              className="inline-flex min-h-[40px] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-[var(--color-shell-primary)] px-4 text-[12.5px] font-semibold text-[var(--color-shell-text-contrast)] shadow-[var(--shadow-sm)] transition-all duration-150 hover:bg-[var(--color-shell-primary-hover)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-shell-bg)] sm:flex-none"
            >
              <span>Book</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </motion.article>
  );
};
