import React from 'react';
import { cn } from '@/src/lib/utils';

export interface HeroSegmentBubbleSkeletonProps {
  className?: string;
  style?: React.CSSProperties;
  /** Matches the primary bubble's larger footprint. */
  emphasis?: boolean;
}

/**
 * LOADING STATE FOR A HERO SEGMENT BUBBLE.
 *
 * The shape mirrors the real bubble — a leading dot, a text bar and the same
 * padding curve — so the row does not jump when the catalogue arrives. It
 * carries NO width guess at a segment name: the bars are fixed, which is why a
 * skeleton here can never imply the length of an area that does not exist yet.
 */
export const HeroSegmentBubbleSkeleton: React.FC<HeroSegmentBubbleSkeletonProps> = ({
  className,
  style,
  emphasis = false,
}) => (
  <div
    aria-hidden="true"
    className={cn(
      'flex shrink-0 animate-pulse items-center rounded-full border border-white/10 bg-white/[0.05]',
      emphasis ? 'gap-2.5 px-4 py-2.5' : 'gap-2 px-3.5 py-2',
      className
    )}
    style={style}
  >
    <span
      className={cn('shrink-0 rounded-full bg-white/15', emphasis ? 'h-[30px] w-[30px]' : 'h-6 w-6')}
    />
    <span className={cn('h-2.5 rounded-full bg-white/15', emphasis ? 'w-24' : 'w-20')} />
  </div>
);