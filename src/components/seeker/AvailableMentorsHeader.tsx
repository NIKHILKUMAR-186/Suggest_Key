import React from 'react';
import { LayoutGrid } from 'lucide-react';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { formatSelectedDateLabel } from '@/src/components/seeker/DateSelector';
import { mentorCountLabel } from '@/src/lib/seekerFormat';
import { pluralizeSegmentName } from '@/src/lib/segmentNaming';
import { cn } from '@/src/lib/utils';

export interface AvailableMentorsHeaderProps {
  segmentName: string | null;
  selectedDate: string;
  count: number;
  isCountLoading: boolean;
  className?: string;
}

/**
 * The result header for mentor discovery.
 *
 * There is deliberately no "view all mentors" action here: this IS the full
 * list. The CTA that enters discovery lives on the segment landing page, and
 * the count shown here is the real number the query returned - including zero.
 */
export const AvailableMentorsHeader: React.FC<AvailableMentorsHeaderProps> = ({
  segmentName,
  selectedDate,
  count,
  isCountLoading,
  className,
}) => {
  return (
    <div className={cn('section-header', className)}>
      <div className="section-header-content">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-shell-text-subtle)]">
          Available mentors
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="font-display text-2xl font-bold leading-tight tracking-tight text-[var(--color-shell-text)] sm:text-3xl">
            {segmentName ? pluralizeSegmentName(segmentName) : 'All mentors'}
          </h2>
          <span className="badge badge-neutral">
            <LayoutGrid className="h-3 w-3" aria-hidden="true" />
            {formatSelectedDateLabel(selectedDate)}
          </span>
        </div>
      </div>

      <div className="section-header-actions">
        {isCountLoading ? (
          <Skeleton className="h-10 w-24 rounded-xl" />
        ) : (
          <span className="badge badge-accent" aria-live="polite">
            {mentorCountLabel(count)}
          </span>
        )}
      </div>
    </div>
  );
};