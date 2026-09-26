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
 * Marketplace category navigation driven by the real active segments returned
 * by the backend. Selection state is communicated by colour, weight, elevation
 * and a check glyph so it never relies on colour alone.
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

  if (segments.length === 0) return null;

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
            className="seeker-segment"
          >
            {isSelected && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            <span>{seg.name}</span>
          </button>
        );
      })}
    </div>
  );
};
