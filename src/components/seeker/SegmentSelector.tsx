import React from 'react';
import { Check } from 'lucide-react';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { Segment } from '@/src/types/database';
import { cn } from '@/src/lib/utils';

export interface SegmentSelectorProps {
  segments: Segment[];
  selected: Segment | null;
  onSelect: (segment: Segment) => void;
  isLoading: boolean;
  align?: 'center' | 'start';
  className?: string;
}

/**
 * Marketplace category navigation driven by the real active segments.
 *
 * Premium pill design with:
 * - Segment color indicator (left border accent on selected)
 * - Smooth hover/selected transitions
 * - Check glyph for selected state
 * - Proper ARIA tab semantics
 */
export const SegmentSelector: React.FC<SegmentSelectorProps> = ({
  segments,
  selected,
  onSelect,
  isLoading,
  align = 'center',
  className,
}) => {
  if (isLoading) {
    return (
      <div className="seeker-rail flex gap-2.5 overflow-x-auto" aria-hidden="true">
        <Skeleton className="h-[46px] w-44 shrink-0 rounded-[14px]" />
        <Skeleton className="h-[46px] w-36 shrink-0 rounded-[14px]" />
        <Skeleton className="h-[46px] w-40 shrink-0 rounded-[14px]" />
      </div>
    );
  }

  if (segments.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] px-4 py-3 text-center text-xs text-[var(--color-shell-text-subtle)]">
        No mentorship segments are available right now. Please check back soon.
      </div>
    );
  }

  return (
    <div
      className={cn(
        'seeker-rail flex gap-2.5 overflow-x-auto pb-1',
        align === 'center' ? 'justify-start sm:justify-center' : 'justify-start',
        className
      )}
      role="tablist"
      aria-label="Mentorship segments"
    >
      {segments.map((seg) => {
        const isSelected = selected?.id === seg.id;
        return (
          <button
            key={seg.id}
            type="button"
            role="tab"
            aria-selected={isSelected}
            onClick={() => onSelect(seg)}
            data-selected={isSelected}
            className={cn(
              'seeker-segment relative',
              isSelected && 'segment-selected-pill'
            )}
          >
            {/* Segment color indicator — visible only when selected */}
            {isSelected && (
              <span
                className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full"
                style={{ background: 'var(--segment-gradient-primary)' }}
                aria-hidden="true"
              />
            )}
            {isSelected && <Check className="h-3.5 w-3.5 shrink-0 relative z-10" aria-hidden="true" />}
            <span className="relative z-10">{seg.name}</span>
          </button>
        );
      })}
    </div>
  );
};
