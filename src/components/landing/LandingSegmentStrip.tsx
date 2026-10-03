import React, { useState } from 'react';
import { ArrowUpRight, Compass } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { Reveal } from '@/src/components/landing/Reveal';
import { resolveSegmentIcon } from '@/src/lib/segmentIcons';
import { deriveSegmentTheme } from '@/src/lib/segmentTheme';
import { HERO_ARROW } from '@/src/components/landing/landingContent';
import type { Segment } from '@/src/types/database';

interface SegmentCardProps {
  segment: Segment;
  onOpen: (segment: Segment) => void;
}

/**
 * One segment, one card.
 *
 * The segment's own runtime theme is applied through the CSS custom properties
 * `deriveSegmentTheme` produces, so an admin-configured accent is honoured here
 * exactly as it is on the seeker's segment experience — with no per-segment
 * code and no slug lookup. The accent is only ever used for a soft tint, an
 * icon and an arrow on this light canvas, so the light palette is the right
 * one to derive here.
 */
const SegmentCard: React.FC<SegmentCardProps> = ({ segment, onOpen }) => {
  const [isHighlighted, setIsHighlighted] = useState(false);
  const theme = deriveSegmentTheme(segment.experience_config, 'light');
  // A `segments` row configures its icon per experience item, not per area, so
  // the shared neutral mark is used and tinted with that segment's own accent.
  // A distinct icon per area would be decoration masquerading as configuration.
  const Icon = resolveSegmentIcon(null);
  const { variables, accent } = theme;

  return (
    <button
      type="button"
      onClick={() => onOpen(segment)}
      onMouseEnter={() => setIsHighlighted(true)}
      onMouseLeave={() => setIsHighlighted(false)}
      onFocus={() => setIsHighlighted(true)}
      onBlur={() => setIsHighlighted(false)}
      aria-label={`Explore mentors in ${segment.name}`}
      style={variables}
      className="group flex h-full w-full cursor-pointer flex-col rounded-[26px] border border-[var(--sk-brand-border)] bg-[var(--sk-brand-surface)] p-7 text-left shadow-[var(--sk-shadow-card)] transition-all duration-200 hover:-translate-y-1 hover:shadow-[var(--sk-shadow-card-hover),var(--segment-section-glow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] focus-visible:ring-offset-2"
    >
      <span
        className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl transition-transform duration-200 group-hover:scale-105"
        style={{ backgroundColor: variables['--segment-accent-soft'], color: accent }}
        aria-hidden="true"
      >
        <Icon className="h-5 w-5" />
      </span>

      <h3 className="text-lg font-semibold leading-snug tracking-tight text-[var(--sk-brand-text)]">
        {segment.name}
      </h3>

      {segment.description ? (
        <p className="mt-2.5 line-clamp-3 text-[13px] leading-relaxed text-[var(--sk-brand-text-muted)]">
          {segment.description}
        </p>
      ) : null}

      <span
        className={[
          'mt-6 inline-flex items-center gap-1.5 text-[13px] font-semibold transition-opacity duration-200',
          isHighlighted ? 'opacity-100' : 'opacity-0 group-focus-visible:opacity-100',
        ].join(' ')}
        style={{ color: accent }}
      >
        Explore mentors
        <ArrowUpRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
      </span>
    </button>
  );
};
export interface LandingSegmentStripProps {
  segments: Segment[];
  isLoading: boolean;
  hasError: boolean;
  onOpen: (segment: Segment) => void;
  /** Keeps the primary CTA reachable from the empty and error states. */
  onFindMentor: () => void;
  /** Re-runs the catalogue fetch after a failed load. */
  onRetry?: () => void;
}

/**
 * SEGMENTS — the CMS-driven row that overlaps the hero.
 *
 * Every name, description and icon comes from the active segment rows the
 * whole app already reads (`useActiveSegments`). No area is hardcoded: retire a
 * segment and it leaves this row, publish one and it arrives, with no frontend
 * change. The skeleton mirrors the final card's structure so the row does not
 * resize when data lands, and it carries no placeholder area names.
 */
export const LandingSegmentStrip: React.FC<LandingSegmentStripProps> = ({
  segments,
  isLoading,
  hasError,
  onOpen,
  onFindMentor,
  onRetry,
}) => (
  <section
    className="relative z-20 bg-[var(--sk-brand-canvas)] px-4 sm:px-6 lg:px-8"
    aria-labelledby="segments-heading"
  >
    <div className="mx-auto -mt-20 max-w-[1240px] sm:-mt-24 lg:-mt-28">
      <h2 id="segments-heading" className="sr-only">
        Areas you can explore
      </h2>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="rounded-[26px] border border-[var(--sk-brand-border)] bg-[var(--sk-brand-surface)] p-7 shadow-[var(--sk-shadow-card)]"
            >
              <Skeleton className="h-12 w-12 rounded-2xl" />
              <Skeleton className="mt-6 h-5 w-2/3" />
              <Skeleton className="mt-3 h-3.5 w-full" />
              <Skeleton className="mt-2 h-3.5 w-4/5" />
            </div>
          ))}
        </div>
      ) : segments.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {segments.map((segment, index) => (
            <Reveal key={segment.id} delay={index * 0.06} className="h-full">
              <SegmentCard segment={segment} onOpen={onOpen} />
            </Reveal>
          ))}
        </div>
      ) : (
        <div className="rounded-[26px] border border-dashed border-[var(--sk-brand-border-strong)] bg-[var(--sk-brand-surface)]/60 px-6 py-8 text-center sm:py-10">
          <Compass className="mx-auto h-6 w-6 text-[var(--sk-brand-text-subtle)]" aria-hidden="true" />
          <p className="mx-auto mt-3 max-w-md text-[13px] font-semibold text-[var(--sk-brand-text)]">
            {hasError ? "We couldn&apos;t load mentorship areas right now." : 'Mentorship areas are being prepared.'}
          </p>
          <p className="mx-auto mt-1.5 max-w-md text-[12px] leading-relaxed text-[var(--sk-brand-text-muted)]">
            {hasError
              ? 'Mentors and sessions are unaffected. Head straight to mentor discovery.'
              : 'New areas appear here as the Suggest Key team publishes them. Every mentor is open to browse now.'}
          </p>
          <div className="mt-5 flex flex-col items-center justify-center gap-2 sm:flex-row">
            <Button size="md" className="gap-2" onClick={onFindMentor}>
              Find a Mentor {HERO_ARROW}
            </Button>
            {hasError && onRetry ? (
              <Button size="md" variant="outline" onClick={onRetry}>
                Try Again
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </div>

    <p className="mx-auto mt-5 max-w-[1240px] px-2 pb-14 text-center text-[12px] leading-relaxed text-[var(--sk-brand-text-muted)] sm:pb-16">
      Areas are maintained by the Suggest Key team, so this list is exactly where mentors are currently taking
      sessions. {HERO_ARROW}
    </p>
  </section>
);
