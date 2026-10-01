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
import { AlertCircle, ArrowRight } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { SegmentExperienceRenderer } from '@/src/components/seeker/SegmentExperienceRenderer';
import { SegmentTopicBar } from '@/src/components/seeker/SegmentTopicBar';
import { SegmentMentorGrid } from '@/src/components/seeker/SegmentMentorGrid';
import { useSegmentExperience } from '@/src/context/SegmentExperienceContext';
import { useSegmentTopics } from '@/src/hooks/useSegmentTopics';
import { useSegmentMentorsByTopic } from '@/src/hooks/useSegmentMentorsByTopic';
import { useAvailabilitySync } from '@/src/hooks/useAvailabilitySync';
import { ALL_TOPICS } from '@/src/lib/segmentTopics';
import { mentorDirectoryPath } from '@/src/lib/mentorNav';
import { buildSegmentExploreTitle } from '@/src/lib/segmentNaming';
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

  /**
   * The "available on <date>" claim is a slot claim, so a mentor's availability
   * edit or another seeker's booking has to be able to change this grid. Same
   * hook and same refetch path as mentor detail and discovery — not a third
   * implementation. Not mentor-scoped, because this grid spans every mentor in
   * the segment.
   */
  useAvailabilitySync({
    mentorId: null,
    enabled: Boolean(segmentSlug),
    onInvalidate: reloadMentors,
  });

  const handleRetry = useCallback(() => {
    reload();
    reloadTopics();
    reloadMentors();
  }, [reload, reloadTopics, reloadMentors]);

  /**
   * "See all mentors" means ALL mentors, so it opens the GLOBAL directory.
   *
   * It used to call `mentorListPath`, which is the availability-first route: a
   * seeker who read this as "show me every mentor" landed on a page that drops
   * anyone without a free slot on the selected date, and on a busy day that page
   * reads "0 mentors" while mentors are plainly listed a click away. That was the
   * bug. The date-scoped list still exists and still does its job; it is simply
   * no longer what this button promises.
   *
   * The segment rides along as a visual filter, so the directory opens already
   * narrowed to this segment. It is a filter, not a membership condition: every
   * approved + active mentor of the segment is there, dated or not.
   *
   * The heading is built from the real segment name ("Explore Autism Mentors"),
   * so a segment created tomorrow words itself correctly with no code change.
   */
  const discoveryCta = segmentSlug ? (
    <div className="sk-section">
      <div className="flex flex-col gap-4 rounded-3xl border border-[var(--sk-brand-border)] bg-[var(--sk-brand-surface)] p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
        <div className="min-w-0">
          <p className="sk-eyebrow">{buildSegmentExploreTitle(segment?.name)}</p>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-[var(--sk-brand-text-muted)]">
            Every verified mentor for this segment, filterable by language and experience.
            Someone without a free slot on your date is still listed — their profile has
            the rest of their schedule.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate(mentorDirectoryPath({ segmentSlug }))}
          aria-label={`See all ${segment?.name ? `${segment.name} ` : ''}mentors`}
          className="sk-btn sk-btn-primary shrink-0"
        >
          See all mentors
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  ) : null;

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

      {discoveryCta}

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
          selectedDate={selectedDate}
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
            selectedDate={selectedDate}
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