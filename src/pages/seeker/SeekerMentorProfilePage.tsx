/**
 * THE PUBLIC MENTOR PROFILE.
 *
 * A read-only page about a mentor: who they are, what they say about themselves,
 * and every session offer they actually sell. It is deliberately a different
 * experience from mentor detail, which is the booking experience - date, slots,
 * the 5-minute hold and the payment hand-off.
 *
 * Every value rendered here comes from `GET /api/seeker/mentors/:id/profile`,
 * which projects an allow-list of public columns and returns 404 for a mentor
 * who is not publicly visible. There is no second source, no cached copy and no
 * fallback mentor, so a failed read renders an error state rather than an
 * invented person.
 *
 * The one action is per OFFER, not per mentor. A mentor holds one ACTIVE gig per
 * segment and may belong to several segments, so a single "Book a slot" button
 * would have to guess. Every offer therefore carries its own button, and each
 * one hands booking the exact `mentorId` + `segmentSlug` + `gigId` that produced
 * it. Nothing here resolves a "default" gig.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Briefcase,
  Clock,
  Globe,
  Languages,
  Sparkles,
  Star,
} from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@/src/components/ui/Button';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { useNavigation } from '@/src/context/NavigationContext';
import {
  fetchPublicMentorProfile,
  type PublicMentorOffer,
  type PublicMentorProfile,
} from '@/src/lib/discoveryService';
import {
  mentorDetailBackPath,
  mentorDetailPath,
  mentorProfilePath,
  parseMentorOrigin,
} from '@/src/lib/mentorNav';
import { formatInr } from '@/src/lib/seekerFormat';
import { getInitials } from '@/src/lib/avatar';

const EASE = [0.23, 1, 0.31, 1] as const;

const Avatar: React.FC<{ name: string; avatarUrl: string | null }> = ({ name, avatarUrl }) => {
  const frame =
    'h-20 w-20 shrink-0 rounded-full border-2 border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] sm:h-24 sm:w-24';

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={`${name} profile photo`}
        className={`${frame} object-cover avatar-ring`}
        loading="lazy"
      />
    );
  }
  return (
    <div
      role="img"
      aria-label={`${name} profile photo placeholder`}
      className={`${frame} flex items-center justify-center text-2xl font-bold text-[var(--color-shell-text-muted)]`}
    >
      {getInitials(name)}
    </div>
  );
};

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-shell-text-subtle)]">
    {children}
  </h2>
);

/**
 * One ACTIVE gig, with the ACTIVE segment it belongs to and its own Book a slot.
 *
 * The button calls `onBook` with nothing, because the destination is bound to
 * this offer in the parent. Passing the ids in would let a future edit bind one
 * offer's button to another offer's gig; binding the path here means the
 * segment and the gig a seeker books always came from the same card.
 */
const OfferCard: React.FC<{
  offer: PublicMentorOffer;
  onBook: () => void;
}> = ({ offer, onBook }) => {
  const price = formatInr(offer.priceInr);
  return (
    <article className="detail-card flex flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-shell-text-subtle)]">
            {offer.segmentName}
          </p>
          <h3 className="mt-2 font-display text-lg font-bold leading-snug text-[var(--color-shell-text)]">
            {offer.title}
          </h3>
        </div>
        {price && (
          <p className="price-display shrink-0 text-right">
            <span className="price-label">Price </span>
            <span className="price-amount">{price}</span>
          </p>
        )}
      </div>

      {offer.description && (
        <p className="mt-3 text-[14px] leading-relaxed text-[var(--color-shell-text-muted)]">
          {offer.description}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--color-shell-border)] pt-4 text-[13px] text-[var(--color-shell-text-muted)]">
        <span className="inline-flex items-center gap-1.5">
          <Clock className="h-4 w-4 shrink-0 text-[var(--color-shell-text-subtle)]" aria-hidden="true" />
          {offer.durationMinutes} min
        </span>
        {offer.isPrimarySegment && (
          <span className="badge badge-neutral">Primary segment</span>
        )}
      </div>

      <Button
        type="button"
        onClick={onBook}
        className="btn-primary-segment mt-5 w-full gap-2 font-semibold"
      >
        <span>Book a slot</span>
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Button>
    </article>
  );
};

export const SeekerMentorProfilePage: React.FC = () => {
  const { navigate, currentPath } = useNavigation();

  const searchParams = new URLSearchParams(
    currentPath.includes('?') ? currentPath.split('?')[1] : ''
  );
  const mentorId = searchParams.get('mentorId') || '';
  const segmentSlug = searchParams.get('segmentSlug') || '';
  const date = searchParams.get('date') || '';
  const topic = searchParams.get('topic') || '';
  const origin = parseMentorOrigin(searchParams.get('source') || '');

  const [mentor, setMentor] = useState<PublicMentorProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    if (!mentorId) {
      setIsLoading(false);
      setError('Select a mentor to view their profile.');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const { mentor: loaded, error: err } = await fetchPublicMentorProfile(mentorId);
      if (err) throw err;
      setMentor(loaded);
    } catch (e: any) {
      setMentor(null);
      setError(e?.message || 'Unable to load this mentor.');
    } finally {
      setIsLoading(false);
    }
  }, [mentorId]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const backPath = mentorDetailBackPath({
    origin,
    discovery: { segmentSlug, topic, date },
  });
  const backLabel = 'Back to mentors';

  // The profile route itself, rebuilt for a retry. Keeps `mentorId` and the
  // discovery context so a reload never drops the seeker back to a bare listing.
  const selfPath = mentorProfilePath({
    mentorId,
    segmentSlug,
    date,
    topic,
    origin,
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
      className="mx-auto w-full max-w-[1100px]"
    >
      <button
        type="button"
        onClick={() => navigate(backPath)}
        aria-label="Go back"
        className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-lg px-1.5 text-[13px] font-medium text-[var(--color-shell-text-muted)] transition-colors hover:text-[var(--color-shell-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] focus-visible:ring-offset-2"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        <span>{backLabel}</span>
      </button>

      {isLoading ? (
        <div className="mt-6 space-y-6">
          <div className="detail-card">
            <div className="flex items-center gap-5">
              <Skeleton variant="circular" className="h-20 w-20 shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-6 w-1/2" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
          </div>
          <div className="detail-card">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="mt-4 h-28 w-full" />
          </div>
        </div>
      ) : error ? (
        <div className="mt-6">
          <EmptyState
            title="Unable to load this mentor"
            description={error}
            actionLabel="Try again"
            onAction={() => navigate(selfPath)}
          />
        </div>
      ) : !mentor ? (
        <div className="mt-6">
          <EmptyState
            title="Mentor not found"
            description="This mentor is not currently available for sessions."
            actionLabel={backLabel}
            onAction={() => navigate(backPath)}
          />
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {/* HEADER -------------------------------------------------------- */}
          <section className="detail-card">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
              <Avatar name={mentor.fullName} avatarUrl={mentor.avatarUrl} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
                  <h1 className="font-display text-2xl font-bold leading-tight tracking-tight text-[var(--color-shell-text)] sm:text-[28px]">
                    {mentor.fullName}
                  </h1>
                  {mentor.isApproved && (
                    <span className="badge badge-success">
                      <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      Verified
                    </span>
                  )}
                  {mentor.isFeatured && (
                    <span
                      className="badge"
                      style={{
                        background: 'var(--color-shell-warning-soft)',
                        color: 'var(--color-shell-warning)',
                        border: '1px solid color-mix(in srgb, var(--color-shell-warning) 30%, transparent)',
                      }}
                    >
                      <Star className="h-3 w-3 fill-current" aria-hidden="true" />
                      Featured
                    </span>
                  )}
                </div>

                {mentor.headline && (
                  <p className="mt-2 text-[15px] leading-snug text-[var(--color-shell-text-muted)]">
                    {mentor.headline}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-[var(--color-shell-text-muted)]">
                  {mentor.languages.length > 0 && (
                    <span className="inline-flex items-center gap-1.5">
                      <Languages
                        className="h-4 w-4 shrink-0 text-[var(--color-shell-text-subtle)]"
                        aria-hidden="true"
                      />
                      {mentor.languages.join(', ')}
                    </span>
                  )}
                  {mentor.timezone && (
                    <span className="inline-flex items-center gap-1.5">
                      <Globe
                        className="h-4 w-4 shrink-0 text-[var(--color-shell-text-subtle)]"
                        aria-hidden="true"
                      />
                      {mentor.timezone}
                    </span>
                  )}
                  {/* Only when the record actually carries a non-zero value.
                      The column defaults to 0, and "0 years experience" is not
                      information, it is a missing value wearing a number. */}
                  {mentor.experienceYears > 0 && (
                    <span className="inline-flex items-center gap-1.5">
                      <Briefcase
                        className="h-4 w-4 shrink-0 text-[var(--color-shell-text-subtle)]"
                        aria-hidden="true"
                      />
                      {mentor.experienceYears}{' '}
                      {mentor.experienceYears === 1 ? 'year' : 'years'} experience
                    </span>
                  )}
                </div>
              </div>
            </div>

            {mentor.about && mentor.about.trim() && (
              <div className="mt-6">
                <SectionLabel>About</SectionLabel>
                <p className="mt-2.5 whitespace-pre-line text-[14px] leading-relaxed text-[var(--color-shell-text-muted)]">
                  {mentor.about.trim()}
                </p>
              </div>
            )}

            {mentor.expertise && mentor.expertise.filter(Boolean).length > 0 && (
              <div className="mt-6">
                <SectionLabel>Expertise</SectionLabel>
                <ul className="mt-2.5 chip-row" aria-label="Expertise">
                  {mentor.expertise.filter(Boolean).map((item) => (
                    <li key={item} className="chip">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* ACTIVE SESSION OFFERS ------------------------------------------ */}
          <section>
            <div className="flex flex-wrap items-center gap-2.5">
              <SectionLabel>Session offers</SectionLabel>
              {mentor.offers.length > 0 && (
                <span className="badge badge-neutral">
                  {mentor.offers.length} active
                </span>
              )}
            </div>

            {mentor.offers.length === 0 ? (
              <div className="mt-3">
                <EmptyState
                  title="No active session offers"
                  description="This mentor has no published session at the moment."
                  actionLabel={backLabel}
                  onAction={() => navigate(backPath)}
                />
              </div>
            ) : (
              <div className="mt-3.5 grid grid-cols-1 gap-5 md:grid-cols-2">
                {mentor.offers.map((offer) => (
                  <OfferCard
                    key={offer.gigId}
                    offer={offer}
                    // The booking destination for THIS offer: the exact mentor,
                    // the exact segment and the exact gig it was rendered from.
                    // `intent: 'book'` lands on the date/time selection, and no
                    // gig is ever inferred from the others on this page.
                    onBook={() =>
                      navigate(
                        mentorDetailPath({
                          mentorId: offer.mentorId,
                          segmentSlug: offer.segmentSlug,
                          gigId: offer.gigId,
                          date: date || null,
                          topic: topic || null,
                          origin,
                          intent: 'book',
                        })
                      )
                    }
                  />
                ))}
              </div>
            )}

            {mentor.offers.length > 0 && (
              <p className="mt-4 flex items-start gap-1.5 text-[12px] leading-relaxed text-[var(--color-shell-text-subtle)]">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                  Each offer is a separate session you can book. Choosing one opens the
                  times {mentor.fullName.split(' ')[0] || 'this mentor'} has free.
                </span>
              </p>
            )}
          </section>
        </div>
      )}
    </motion.div>
  );
};
