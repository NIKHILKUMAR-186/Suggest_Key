import React from 'react';
import { ArrowRight, LayoutGrid } from 'lucide-react';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { formatSelectedDateLabel } from '@/src/components/seeker/DateSelector';
import { cn } from '@/src/lib/utils';

export interface AvailableMentorsHeaderProps {
  segmentName: string | null;
  selectedDate: string;
  count: number;
  isCountLoading: boolean;
  onViewAll?: () => void;
  className?: string;
}

/**
 * Heading for the results region. Shows the real selected segment, the real
 * selected date and the real (unfabricated) result count.
 */
export const AvailableMentorsHeader: React.FC<AvailableMentorsHeaderProps> = ({
  segmentName,
  selectedDate,
  count,
  isCountLoading,
  onViewAll,
  className,
}) => (
  <div className={cn('flex flex-wrap items-end justify-between gap-x-6 gap-y-4', className)}>
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-shell-text-subtle)]">
        Available mentors
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="font-display text-2xl font-bold leading-tight tracking-tight text-[var(--color-shell-text)] sm:text-3xl">
          {segmentName ? segmentName : 'All mentors'}
        </h2>
        {segmentName && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-shell-text-muted)]">
            <LayoutGrid className="h-3 w-3" aria-hidden="true" />
            {formatSelectedDateLabel(selectedDate)}
          </span>
        )}
      </div>
    </div>

    <div className="flex items-center gap-3">
      {isCountLoading ? (
        <Skeleton className="h-8 w-24 rounded-full" />
      ) : (
        <span
          className="inline-flex items-center rounded-full border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] px-3.5 py-1.5 text-xs font-semibold text-[var(--color-shell-text-muted)]"
          aria-live="polite"
        >
          {count} mentor{count !== 1 ? 's' : ''}
        </span>
      )}

      {onViewAll && (
        <button
          type="button"
          onClick={onViewAll}
          className="group inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-1 py-0.5 text-xs font-semibold text-[var(--color-shell-primary)] transition-colors duration-150 hover:text-[var(--color-shell-primary-hover)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--color-shell-focus)] focus-visible:outline-offset-2"
        >
          <span>View all mentors</span>
          <ArrowRight
            className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </button>
      )}
    </div>
  </div>
);
