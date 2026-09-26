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

/**
 * Heading for the results region. Shows the real selected segment, the real
 * selected date and the real (unfabricated) result count.
 *
 * The count and the "View all mentors" action sit together on the SAME row as
 * a matched pair, so they read as one control instead of two elements pushed
 * to opposite edges of the page.
 */
export const AvailableMentorsHeader: React.FC<AvailableMentorsHeaderProps> = ({
  segmentName,
  selectedDate,
  count,
  isCountLoading,
  onViewAll,
  className,
}) => (
  <div className={cn('flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between', className)}>
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-shell-text-subtle)]">
        Available for your date
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

    {onViewAll && (
      <div className="flex shrink-0 items-center gap-3">
        {isCountLoading ? (
          <Skeleton className="h-10 w-24 rounded-xl" />
        ) : (
          <span
            className="inline-flex h-10 items-center rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] px-3.5 text-[13px] font-semibold text-[var(--color-shell-text-muted)]"
            aria-live="polite"
          >
            {mentorCountLabel(count)}
          </span>
        )}

        <button
          type="button"
          onClick={onViewAll}
          className="group inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-xl border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-surface)] px-4 text-[13px] font-semibold text-[var(--color-shell-text)] transition-colors duration-150 hover:border-[var(--color-shell-primary)]/50 hover:bg-[var(--color-shell-surface-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] focus-visible:ring-offset-2"
        >
          <span>View all mentors</span>
          <ArrowRight
            className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </button>
      </div>
    )}
  </div>
);
