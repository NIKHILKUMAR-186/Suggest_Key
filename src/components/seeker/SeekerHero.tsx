import React from 'react';
import { motion } from 'motion/react';
import { cn } from '@/src/lib/utils';
import { HeroVisual } from '@/src/components/seeker/HeroVisual';
import { MarketplaceBadge } from '@/src/components/seeker/MarketplaceBadge';
import { MentorSearch } from '@/src/components/seeker/MentorSearch';
import { SegmentSelector } from '@/src/components/seeker/SegmentSelector';
import { DateSelector, QuickDate } from '@/src/components/seeker/DateSelector';
import { Segment } from '@/src/types/database';

export interface SeekerHeroProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  segments: Segment[];
  selectedSegment: Segment | null;
  onSelectSegment: (segment: Segment) => void;
  isLoadingSegments: boolean;
  selectedDate: string;
  minDate: string;
  quickDates: QuickDate[];
  onSelectDate: (value: string) => void;
}

const EASE = [0.23, 1, 0.31, 1] as const;

/**
 * Seeker hero composition.
 *
 * Layered as: decorative SVG artwork → real HTML content. The artwork frames
 * the content from the edges; the centre stays calm so the headline, search,
 * segment controls and date controls remain fully readable and interactive.
 */
export const SeekerHero: React.FC<SeekerHeroProps> = ({
  searchQuery,
  onSearchChange,
  segments,
  selectedSegment,
  onSelectSegment,
  isLoadingSegments,
  selectedDate,
  minDate,
  quickDates,
  onSelectDate,
}) => (
  <motion.section
    initial={{ opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5, ease: EASE }}
    aria-labelledby="seeker-hero-heading"
    className="seeker-hero relative isolate overflow-hidden rounded-[28px] sm:rounded-[32px]"
  >
    <HeroVisual />

    <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center px-5 py-12 text-center sm:px-8 sm:py-14 lg:min-h-[620px] lg:flex-col lg:justify-center lg:py-12">
      <MarketplaceBadge className="mb-5" />

      <h1
        id="seeker-hero-heading"
        className="font-display text-[2.5rem] font-bold leading-[1.06] tracking-[-0.03em] text-[var(--color-shell-text)] sm:text-[3.5rem] lg:text-[3.9rem]"
      >
        Find the right mentor
        <br />
        <span className="bg-gradient-to-br from-[var(--color-shell-text)] via-[var(--color-shell-text)] to-[var(--color-shell-primary)] bg-clip-text text-transparent">
          for your journey
        </span>
      </h1>

      <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-[var(--color-shell-text-muted)] sm:text-base">
        Real guidance. Meaningful conversations. One session at a time.
      </p>

      <MentorSearch
        value={searchQuery}
        onChange={onSearchChange}
        className="mt-7 w-full max-w-2xl"
      />

      {/* Control deck: keeps segments and date visually related to the search */}
      <div className="seeker-panel mt-5 w-full max-w-2xl space-y-4 rounded-3xl p-4 text-left sm:p-5">
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-shell-text-subtle)]">
            Explore segments
          </p>
          <SegmentSelector
            segments={segments}
            selected={selectedSegment}
            onSelect={onSelectSegment}
            isLoading={isLoadingSegments}
          />
        </div>

        <div className="h-px w-full bg-[var(--color-shell-border)]" aria-hidden="true" />

        <DateSelector
          selectedDate={selectedDate}
          minDate={minDate}
          quickDates={quickDates}
          onSelect={onSelectDate}
        />
      </div>
    </div>
  </motion.section>
);
