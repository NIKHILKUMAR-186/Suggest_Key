/**
 * The live seeker experience for one segment.
 *
 * A THIN composition wrapper, deliberately not a second renderer:
 *
 *   SegmentExperiencePage
 *     -> SegmentExperienceRenderer   (content, from the admin config)
 *     -> SegmentTopicBar             (chips, from segment_topics)
 *     -> SegmentMentorGrid           (real mentors, from the topic API)
 *
 * All three are driven by real data. Nothing here invents a mentor, a topic, a
 * guide, a story or a statistic, and nothing here filters a mentor list in
 * the browser: the topic filter is a database join, so a chip labelled
 * "Interviews" shows exactly the mentors whose ACTIVE gig covers Interviews.
 *
 * The SAME `SegmentExperienceRenderer` powers the admin "Preview as seeker"
 * surface. That is the guarantee that a preview cannot drift from reality.
 */

import React from 'react';
import { useCallback } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { SegmentExperienceRenderer } from '@/src/components/seeker/SegmentExperienceRenderer';
import { SegmentTopicBar } from '@/src/components/seeker/SegmentTopicBar';
import { SegmentMentorGrid } from '@/src/components/seeker/SegmentMentorGrid';
import { useSegmentExperience } from '@/src/context/SegmentExperienceContext';
import { useSegmentTopics } from '@/src/hooks/useSegmentTopics';
import { useSegmentMentorsByTopic } from '@/src/hooks/useSegmentMentorsByTopic';
import { ALL_TOPICS } from '@/src/lib/segmentTopics';
import type { Segment } from '@/src/types/database';

export interface SegmentExperiencePageProps {
  segment: Segment | null;
  /** The selected topic slug, or ALL_TOPICS. Owned by the host (URL state). */
  selectedTopic: string;
  onSelectTopic: (slug: string) => void;
  /** Restricts results to mentors with a free slot on this date. */
  selectedDate?: string | null;
  navigate: (path: string) => void;
  className?: string;
  /** Hides the topic bar (used by a context where topics are already shown). */
  hideTopicBar?: boolean;
}

export const SegmentExperiencePage: React.FC<SegmentExperiencePageProps> = ({
  segment,
  selectedTopic,
  onSelectTopic,
  selectedDate = null,
  navigate,
  className,
  hideTopicBar = false,
}) => {
  const { config, isLoading, error, isFallback, reload } = useSegmentExperience();

  const segmentId = segment?.id ?? null;
  const segmentSlug = segment?.slug ?? null;

  const {
    topics,
    isLoading: isLoadingTopics,
    error: topicsError,
    reload: reloadTopics,
  } = useSegmentTopics(segmentId, segmentSlug);

  const {
    mentors,
    isLoading: isLoadingMentors,
    error: mentorsError,
    reload: reloadMentors,
  } = useSegmentMentorsByTopic(segmentSlug, selectedTopic, selectedDate);

  const activeTopic = topics.find((t) => t.slug === selectedTopic) ?? null;

  const handleRetry = useCallback(() => {
    reload();
    reloadTopics();
    reloadMentors();
  }, [reload, reloadTopics, reloadMentors]);

  // The marketplace block, assembled as a node and handed to the renderer so
  // the renderer stays pure and can position it identically in the preview.
  const marketplace = (
    <>
      {error && (
        <div className="sk-section">
          <div className="error-banner" role="alert">
            <span className="flex items-center gap-2 font-semibold">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              {error}
            </span>
            <Button variant="outline" size="sm" onClick={handleRetry} className="mt-2 sm:mt-0">
              Try again
            </Button>
          </div>
        </div>
      )}

      {hideTopicBar ? (
        <SegmentMentorGrid
          className="sk-section"
          mentors={mentors}
          isLoading={isLoadingMentors}
          error={mentorsError}
          onRetry={reloadMentors}
          selectedTopicSlug={selectedTopic}
          segmentName={segment?.name ?? null}
          segmentSlug={segmentSlug}
          navigate={navigate}
        />
      ) : (
        <>
          <SegmentTopicBar
            topics={topics}
            selectedSlug={selectedTopic}
            onSelect={onSelectTopic}
            isLoading={isLoadingTopics}
            error={topicsError}
            resultCount={mentorsError ? undefined : mentors.length}
          />
          <SegmentMentorGrid
            className="sk-section"
            mentors={mentors}
            isLoading={isLoadingMentors}
            error={mentorsError}
            onRetry={reloadMentors}
            selectedTopicSlug={selectedTopic}
            segmentName={segment?.name ?? null}
            segmentSlug={segmentSlug}
            navigate={navigate}
          />
        </>
      )}
    </>
  );

  return (
    <SegmentExperienceRenderer
      segment={segment ? { name: segment.name, slug: segment.slug } : null}
      config={config}
      isLoading={isLoading}
      isFallback={isFallback}
      onNavigate={navigate}
      className={className}
      mentors={marketplace}
    />
  );
};

export { ALL_TOPICS };
export default SegmentExperiencePage;