import React from 'react';
import { ArrowRight, LayoutGrid } from 'lucide-react';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { formatSelectedDateLabel } from '@/src/components/seeker/DateSelector';
import { mentorCountLabel } from '@/src/lib/seekerFormat';
import { cn } from '@/src/lib/utils';

export interface AvailableMentorsHeaderProps {
  segmentName: string | null;
  selectedDate: string;
  count: number;
  isCountLoading: boolean;
  onViewAll?: () => void;
  className?: string;
}

export const AvailableMentorsHeader: React.FC<AvailableMentorsHeaderProps> = ({
  segmentName,
  selectedDate,
  count,
  isCountLoading,
  onViewAll,
  className,
}) => {
  return (
    <div className={cn('section-header', className)}>
      <div className="section-header-content">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-shell-text-subtle)]">
          Available for your date
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="font-display text-2xl font-bold leading-tight tracking-tight text-[var(--color-shell-text)] sm:text-3xl">
            {segmentName ? segmentName : 'All mentors'}
          </h2>
          {segmentName && (
            <span className="badge badge-neutral">
              <LayoutGrid className="h-3 w-3" aria-hidden="true" />
              {formatSelectedDateLabel(selectedDate)}
            </span>
          )}
        </div>
      </div>

      {onViewAll && (
        <div className="section-header-actions">
          {isCountLoading ? (
            <Skeleton className="h-10 w-24 rounded-xl" />
          ) : (
            <span
              className="badge badge-accent"
              aria-live="polite"
            >
              {mentorCountLabel(count)}
            </span>
          )}

          <button
            type="button"
            onClick={onViewAll}
            className="btn-secondary"
          >
            <span>View all mentors</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
};
