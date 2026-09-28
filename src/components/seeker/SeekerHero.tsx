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
 * Seeker hero composition — premium editorial control surface.
 *
 * The hero frames discovery as a calm, trustworthy experience:
 * - MarketplaceBadge establishes credibility
 * - Headline uses display type with refined gradient
 * - Search is the primary action, visually dominant
 * - Control deck (segments + date) is a cohesive glass panel
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
}) => {
  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: EASE }}
      aria-labelledby="seeker-hero-heading"
      className="seeker-hero relative isolate overflow-hidden rounded-[28px] sm:rounded-[32px]"
    >
      <HeroVisual />

      {/* Content-driven height — control surface, not showcase */}
      <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center px-5 py-10 text-center sm:px-8 sm:py-12 lg:py-14">
        {/* Badge */}
        <MarketplaceBadge className="mb-5" />

        {/* Headline — refined typographic hierarchy */}
        <div className="max-w-3xl">
          <h1
            id="seeker-hero-heading"
            className="heading-display heading-display-lg tracking-[-0.03em]"
          >
            Find the right mentor
            <br />
            <span className="text-gradient-brand">for your journey</span>
          </h1>
          <p className="mt-4 max-w-xl mx-auto text-[15px] leading-relaxed text-[var(--color-shell-text-muted)] sm:text-base">
            Real guidance. Meaningful conversations. One session at a time.
          </p>
        </div>

        {/* Search — primary action, visually dominant */}
        <div className="mt-7 w-full max-w-2xl">
          <MentorSearch
            value={searchQuery}
            onChange={onSearchChange}
            className="w-full"
          />
        </div>

        {/* Control deck — cohesive glass panel */}
        <div className="seeker-panel surface-float mt-5 w-full max-w-2xl space-y-4 rounded-3xl p-4 text-left sm:p-5">
          {/* Segment selector with eyebrow */}
          <div className="space-y-2.5">
            <p className="section-eyebrow-premium">Explore by segment</p>
            <SegmentSelector
              segments={segments}
              selected={selectedSegment}
              onSelect={onSelectSegment}
              isLoading={isLoadingSegments}
            />
          </div>

          <div className="h-px w-full bg-[var(--color-shell-border)]" aria-hidden="true" />

          {/* Date selector */}
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
};
