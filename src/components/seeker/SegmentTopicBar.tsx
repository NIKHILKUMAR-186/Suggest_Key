/**
 * THE SEEKER TOPIC BAR.
 *
 * Every chip is a real row from `segment_topics`, fetched for the selected
 * segment. There is no hardcoded topic list anywhere in this file: adding a
 * topic in the admin CMS makes a chip appear here with no deployment.
 *
 * "All" is always first and is not a database row - it is the empty selection.
 * When a segment genuinely has no topics the bar renders "All" alone, which
 * is honest, rather than inventing chips to fill the space.
 *
 * The rail scrolls horizontally on narrow screens (`.sk-topic-rail`), so a
 * nine-topic Career bar never causes page-level horizontal overflow.
 */

import React from 'react';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { cn } from '@/src/lib/utils';
import { ALL_TOPICS, type SegmentTopicView } from '@/src/lib/segmentTopics';

export interface SegmentTopicBarProps {
  /** Active topics for the current segment, in display order. */
  topics: SegmentTopicView[];
  /** The selected topic slug, or ALL_TOPICS. */
  selectedSlug: string;
  onSelect: (slug: string) => void;
  /** Rendered while the topics are loading. */
  isLoading?: boolean;
  /** A recoverable load failure. The bar stays usable with "All" only. */
  error?: string | null;
  /** How many mentors the current selection yields, for the result summary. */
  resultCount?: number;
  className?: string;
}

export const SegmentTopicBar: React.FC<SegmentTopicBarProps> = ({
  topics,
  selectedSlug,
  onSelect,
  isLoading = false,
  error = null,
  resultCount,
  className,
}) => {
  if (isLoading) {
    return (
      <div className={cn('sk-section', className)} aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading topics</span>
        <div className="sk-topic-rail">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-32 shrink-0 rounded-full" />
          ))}
        </div>
      </div>
    );
  }

  const activeTopic = topics.find((t) => t.slug === selectedSlug) ?? null;
  const hasTopics = topics.length > 0;

  return (
    <div className={cn('sk-section', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="sk-eyebrow">Browse by topic</p>

        {typeof resultCount === 'number' && !error && (
          <span
            className="shrink-0 rounded-full border border-[var(--sk-brand-border)] bg-[var(--sk-brand-surface)] px-3 py-1 text-[12px] font-semibold text-[var(--sk-brand-text-muted)]"
            aria-live="polite"
          >
            {resultCount} {resultCount === 1 ? 'mentor' : 'mentors'}
          </span>
        )}
      </div>

      {/* The active topic's description is real configured copy, so it is shown
          - but as a supporting line, not as a competing section heading. */}
      {activeTopic?.description && (
        <p className="mt-2.5 max-w-2xl text-[13.5px] leading-relaxed text-[var(--sk-brand-text-muted)]">
          {activeTopic.description}
        </p>
      )}

      <div
        className="sk-topic-rail mt-4"
        role="group"
        aria-label="Filter mentors by topic"
      >
        <button
          type="button"
          className="sk-topic-chip"
          aria-pressed={selectedSlug === ALL_TOPICS}
          onClick={() => onSelect(ALL_TOPICS)}
        >
          All
        </button>

        {hasTopics &&
          topics.map((topic) => {
            const isActive = topic.slug === selectedSlug;
            return (
              <button
                key={topic.id}
                type="button"
                className="sk-topic-chip"
                aria-pressed={isActive}
                onClick={() => onSelect(topic.slug)}
              >
                {topic.name}
              </button>
            );
          })}
      </div>

      {error && (
        <p className="mt-2 text-[12px] text-[var(--color-shell-error)]" role="status">
          Topics could not be loaded. Showing every mentor in this segment.
        </p>
      )}
    </div>
  );
};

export default SegmentTopicBar;