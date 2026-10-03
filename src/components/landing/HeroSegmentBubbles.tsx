import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight } from 'lucide-react';
import { deriveSegmentTheme } from '@/src/lib/segmentTheme';
import { resolveSegmentIcon } from '@/src/lib/segmentIcons';
import { HeroSegmentBubbleSkeleton } from '@/src/components/landing/HeroSegmentBubbleSkeleton';
import { cn } from '@/src/lib/utils';
import type { Segment } from '@/src/types/database';

export interface HeroSegmentBubblesProps {
  segments: Segment[];
  isLoading: boolean;
  onOpen: (segment: Segment) => void;
}

/**
 * HOW MANY BUBBLES, AND WHY.
 *
 * The hero is a composition, not a directory, so it shows a small, visually
 * balanced subset rather than every area. The cap is fixed here; WHICH areas
 * appear is never decided in this file. `fetchActiveSegments` already orders by
 * `segments.priority` ascending (priority 1 = highest), so simply taking the
 * first N preserves the CMS's own ranking exactly — there is no second priority
 * system, no hardcoded order and no hardcoded name.
 *
 * Fewer than N real segments renders fewer bubbles. There is no filler: a
 * missing area is never padded with a placeholder, because a fabricated category
 * on a public page is indistinguishable from a real one.
 */
const MAX_HERO_BUBBLES = 4;

/**
 * Where each bubble sits, as a percentage of the visual's box. These are
 * LAYOUT CONSTANTS, not data: they describe positions, never which area goes
 * where in the catalogue. Index 0 is the highest-priority area, so it is
 * anchored closest to the figure and rendered largest.
 */
const POSITIONS = [
  { top: '8%', left: '4%' },
  { top: '30%', right: '0%' },
  { top: '58%', left: '0%' },
  { bottom: '10%', right: '6%' },
] as const;

export const HeroSegmentBubbles: React.FC<HeroSegmentBubblesProps> = ({
  segments,
  isLoading,
  onOpen,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const canAnimate = prefersReducedMotion === false;

  // Priority order is already applied by the query; taking a prefix keeps it.
  const bubbles = segments.slice(0, MAX_HERO_BUBBLES);

  if (isLoading) {
    // The skeleton mirrors the responsive split: a scrolling chip strip on
    // mobile, floating bubbles from `sm` up. Matching the real layout is what
    // stops the hero reflowing the moment the catalogue lands.
    return (
      <>
        <div
          className={cn(
            '-mx-4 mt-6 flex gap-2 overflow-hidden px-4 pb-1 sm:hidden',
            '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
          )}
          aria-hidden="true"
        >
          {POSITIONS.map((_, index) => (
            <HeroSegmentBubbleSkeleton key={index} className="flex-row" emphasis={index === 0} />
          ))}
        </div>
        <div className="hidden sm:block" aria-hidden="true">
          {POSITIONS.map((_, index) => (
            <HeroSegmentBubbleSkeleton key={index} emphasis={index === 0} style={positionStyle(index)} />
          ))}
        </div>
      </>
    );
  }

  if (bubbles.length === 0) return null;

  /**
   * THE MOBILE FORM.
   *
   * Absolutely-positioned bubbles are a desktop-only idea: at 375px the same
   * geometry would either overflow the viewport or sit on top of the figure and
   * the CTAs. So below `sm` the same live segments render as a horizontally
   * scrollable chip row beneath the visual. It is the same data, the same
   * priority order and the same click target — only the layout changes.
   *
   * The row is a scroll container with `overflow-x-auto`, so it can never widen
   * the page, and `-mx-4` plus the parent's `px-4` make the chips run to the
   * screen edge so it reads as scrollable rather than as a clipped list.
   */
  const chipRow = (
    <div
      className={cn(
        '-mx-4 mt-6 flex gap-2 overflow-x-auto px-4 pb-1 sm:hidden',
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
      )}
    >
      {bubbles.map((segment, index) => {
        const theme = deriveSegmentTheme(segment.experience_config, 'dark');
        const Icon = resolveSegmentIcon(null);
        const isPrimary = index === 0;

        return (
          <motion.button
            key={segment.id}
            type="button"
            onClick={() => onOpen(segment)}
            style={theme.variables}
            initial={canAnimate ? { opacity: 0, y: 8 } : false}
            animate={canAnimate ? { opacity: 1, y: 0 } : undefined}
            transition={{ duration: 0.4, delay: index * 0.06, ease: [0.23, 1, 0.31, 1] }}
            className={cn(
              'flex shrink-0 cursor-pointer items-center gap-2 rounded-full border backdrop-blur-md',
              'transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sk-brand-focus)]',
              isPrimary ? 'border-white/20 bg-white/12 px-4 py-2.5' : 'border-white/12 bg-white/[0.07] px-3.5 py-2'
            )}
            aria-label={`Explore mentors in ${segment.name}`}
          >
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
              style={{ backgroundColor: theme.variables['--segment-accent-soft'], color: theme.accent }}
              aria-hidden="true"
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="whitespace-nowrap text-[13px] font-semibold tracking-tight text-[var(--sk-brand-header-text)]">
              {segment.name}
            </span>
          </motion.button>
        );
      })}
    </div>
  );

  if (bubbles.length === 0) return null;

  return (
    <>
      {chipRow}
      <div className="hidden sm:block">{bubbles.map((segment, index) => {
        const theme = deriveSegmentTheme(segment.experience_config, 'dark');
        // A `segments` row configures its icon per experience item rather than
        // per area, so the shared neutral mark is used and tinted with that
        // segment's own accent. Inventing a distinct icon per area would be
        // decoration pretending to be configuration.
        const Icon = resolveSegmentIcon(null);

        // The highest-priority area reads as the primary bubble; the rest step
        // down in size and opacity so the eye lands in a clear order.
        const isPrimary = index === 0;
        const scale = isPrimary ? 1 : 0.88 - index * 0.03;

        return (
          <motion.button
            key={segment.id}
            type="button"
            onClick={() => onOpen(segment)}
            style={{
              ...theme.variables,
              ...positionStyle(index),
            }}
            initial={canAnimate ? { opacity: 0, scale: 0.9, y: 12 } : false}
            animate={canAnimate ? { opacity: 1, scale: 1, y: 0 } : undefined}
            transition={{ duration: 0.45, delay: 0.25 + index * 0.09, ease: [0.23, 1, 0.31, 1] }}
            whileHover={canAnimate ? { y: -4, scale: scale * 1.03 } : undefined}
            className={cn(
              'group absolute z-10 flex cursor-pointer items-center gap-2 rounded-full border backdrop-blur-md',
              'transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sk-brand-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sk-brand-plum)]',
              isPrimary
                ? 'gap-2.5 border-white/20 bg-white/12 px-5 py-3'
                : 'border-white/12 bg-white/[0.07] px-4 py-2'
            )}
            aria-label={`Explore mentors in ${segment.name}`}
          >
            <span
              className="flex shrink-0 items-center justify-center rounded-full"
              style={{
                width: isPrimary ? 30 : 24,
                height: isPrimary ? 30 : 24,
                backgroundColor: theme.variables['--segment-accent-soft'],
                color: theme.accent,
              }}
              aria-hidden="true"
            >
              <Icon className={isPrimary ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
            </span>

            <span
              className={cn(
                'whitespace-nowrap font-semibold tracking-tight text-[var(--sk-brand-header-text)]',
                isPrimary ? 'text-[15px]' : 'text-[13px]'
              )}
            >
              {segment.name}
            </span>

            <ArrowUpRight
              className="h-3.5 w-3.5 shrink-0 text-[var(--sk-brand-header-muted)] opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
              aria-hidden="true"
            />
          </motion.button>
        );
      })}
      </div>
    </>
  );
};

/** Maps a bubble index to its positioning style. Wraps so repeated indices never overlap. */
function positionStyle(index: number): React.CSSProperties {
  const position = POSITIONS[index % POSITIONS.length];
  return {
    position: 'absolute',
    ...position,
  } as React.CSSProperties;
}