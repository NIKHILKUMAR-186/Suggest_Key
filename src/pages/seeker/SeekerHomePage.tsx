/**
 * THE SEEKER HOME — segment-driven marketplace experience.
 *
 * Rebuilt rather than patched. The flow it implements is the whole product:
 *
 *   Suggest Key -> Segment -> that segment's experience -> its topics
 *                -> topic-filtered mentors -> existing booking flow
 *
 * Three architectural points:
 *
 *  1. PROVIDER ORDER. The experience provider sits ABOVE the theme provider so
 *     the theme can consume the live config. That is what makes a realtime
 *     accent change repaint the page, not just swap its text.
 *
 *  2. URL STATE. The selected segment and topic live in the query string, so a
 *     selection survives a refresh, is shareable, and Back/Forward works.
 *     `NavigationContext.navigate` is a history pushState, so switching topic
 *     is a client-side transition and never a full page load.
 *
 *  3. NO SLUG BRANCHES. There is no `if (slug === 'career')` anywhere on this
 *     page. Segment behaviour comes entirely from configuration, so a segment
 *     created tomorrow works today.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { SegmentExperiencePage } from '@/src/components/seeker/SegmentExperiencePage';
import { SegmentSelector } from '@/src/components/seeker/SegmentSelector';
import { EmptyState } from '@/src/components/shared/EmptyState';
import {
  SegmentExperienceProvider,
  useSegmentExperience,
} from '@/src/context/SegmentExperienceContext';
import { SegmentThemeProvider } from '@/src/context/SegmentThemeContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import { fetchActiveSegments, getHighestPriorityActiveSegment } from '@/src/lib/discoveryService';
import { toUserMessage } from '@/src/lib/errorMessages';
import {
  ALL_TOPICS,
  buildExperienceQuery,
  parseExperienceQuery,
} from '@/src/lib/segmentTopics';
import type { Segment } from '@/src/types/database';

export const SeekerHomePage: React.FC = () => {
  // The active segment lives at the very top so BOTH providers below can read
  // it: the experience provider needs the slug to fetch and subscribe, and the
  // theme provider needs the segment to apply the configured palette.
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selectedSegment, setSelectedSegment] = useState<Segment | null>(null);

  return (
    <SegmentExperienceProvider slug={selectedSegment?.slug ?? null}>
      {/* The theme provider sits INSIDE the experience provider so it can
          receive the live config. */}
      <SegmentThemeBridge activeSegment={selectedSegment}>
        <SeekerHomeContent
          segments={segments}
          setSegments={setSegments}
          activeSegment={selectedSegment}
          onSegmentSelected={setSelectedSegment}
        />
      </SegmentThemeBridge>
    </SegmentExperienceProvider>
  );
};

/** Feeds the live experience config into the theme provider. */
const SegmentThemeBridge: React.FC<{
  activeSegment: Segment | null;
  children: React.ReactNode;
}> = ({ activeSegment, children }) => {
  const { config } = useSegmentExperience();
  return (
    <SegmentThemeProvider initialSegment={activeSegment} liveConfig={config}>
      {children}
    </SegmentThemeProvider>
  );
};

/** Real in-app routes. No invented contact details, no external placeholders. */
const FOOTER_LINKS = [
  { label: 'Home', href: '/seeker' },
  { label: 'Mentors', href: '/mentors' },
  { label: 'My Bookings', href: '/seeker/bookings' },
  { label: 'Settings', href: '/seeker/settings' },
] as const;

const SeekerHomeContent: React.FC<{
  segments: Segment[];
  setSegments: React.Dispatch<React.SetStateAction<Segment[]>>;
  activeSegment: Segment | null;
  onSegmentSelected: React.Dispatch<React.SetStateAction<Segment | null>>;
}> = ({ segments, setSegments, activeSegment, onSegmentSelected }) => {
  const { currentPath, navigate } = useNavigation();
  const { profile } = useAuth();

  const [isLoadingSegments, setIsLoadingSegments] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState<number>(0);

  // The URL is the source of truth for BOTH selections.
  const query = useMemo(() => parseExperienceQuery(currentPath), [currentPath]);
  const urlSegmentSlug = query.segment;
  const urlTopic = query.topic;

  // Load the real segment catalogue once.
  useEffect(() => {
    let isMounted = true;
    setIsLoadingSegments(true);
    setError(null);

    (async () => {
      try {
        const { segments: activeSegs, error: segErr } = await fetchActiveSegments();
        if (segErr) throw segErr;
        if (!isMounted) return;
        setSegments(activeSegs);
      } catch (err: any) {
        if (!isMounted) return;
        console.error('Error loading segments:', err);
        setError(toUserMessage(err, 'Failed to load mentorship segments'));
      } finally {
        if (isMounted) setIsLoadingSegments(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [reloadToken, setSegments]);

  // Resolve the URL's segment against the loaded catalogue.
  //
  // An unknown or absent slug falls back to the highest-priority active
  // segment, so the page is never empty. Crucially this is a lookup by
  // VALUE, not a branch by name: it works identically for a segment created
  // tomorrow.
  useEffect(() => {
    if (segments.length === 0) return;

    if (urlSegmentSlug) {
      const match = segments.find((s) => s.slug === urlSegmentSlug);
      if (match) {
        if (activeSegment?.id !== match.id) onSegmentSelected(match);
        return;
      }
    }

    const fallback = getHighestPriorityActiveSegment(segments);
    if (fallback && activeSegment?.id !== fallback.id) onSegmentSelected(fallback);
  }, [segments, urlSegmentSlug, activeSegment?.id, onSegmentSelected]);

  // Canonicalise the URL once the default segment is known, so the address bar
  // always reflects what is on screen.
  const hasCanonicalised = useRef(false);
  useEffect(() => {
    if (hasCanonicalised.current) return;
    if (!activeSegment || urlSegmentSlug) return;
    hasCanonicalised.current = true;
    navigate(`/seeker${buildExperienceQuery(activeSegment.slug, urlTopic)}`);
  }, [activeSegment, urlSegmentSlug, urlTopic, navigate]);

  // A topic that no longer exists in this segment must not leave the page in a
  // state that renders nothing. Resetting to "all" is the honest outcome: the
  // topic was retired or belonged to a different segment.
  const handleSelectTopic = useCallback(
    (topicSlug: string) => {
      if (!activeSegment) return;
      navigate(`/seeker${buildExperienceQuery(activeSegment.slug, topicSlug)}`);
    },
    [activeSegment, navigate],
  );

  const handleSelectSegment = useCallback(
    (segment: Segment) => {
      onSegmentSelected(segment);
      // Switching segment always resets the topic: a topic belongs to exactly
      // one segment, so carrying it across would be meaningless.
      navigate(`/seeker${buildExperienceQuery(segment.slug, ALL_TOPICS)}`);
    },
    [navigate, onSegmentSelected],
  );

  const retry = () => setReloadToken((t) => t + 1);

  return (
    <>
        {error && (
          <div className="mx-auto max-w-3xl px-4 pt-8 sm:px-6">
            <div className="error-banner" role="alert">
              <span className="flex items-center gap-2 font-semibold">
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                {error}
              </span>
              <Button variant="outline" size="sm" onClick={retry} className="mt-2 sm:mt-0">
                Try again
              </Button>
            </div>
          </div>
        )}

        {/* Segment navigation: the marketplace's own top-level axis. */}
        {/* <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 sm:pt-8 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
            <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--sk-brand-text-muted)]">
              Explore by segment
            </span>
            <div className="min-w-0 flex-1">
              <SegmentSelector
                segments={segments}
                selected={activeSegment}
                onSelect={handleSelectSegment}
                isLoading={isLoadingSegments}
                align="start"
              />
            </div>
          </div>
        </div> */}

        <div id="segment-experience" className="mt-6 scroll-mt-24 sm:mt-8">
          {isLoadingSegments && segments.length === 0 ? (
            <div className="sk-experience flex min-h-[60vh] items-center justify-center">
              <p className="flex items-center gap-2 text-sm text-[var(--sk-brand-text-muted)]">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading your marketplace...
              </p>
            </div>
          ) : activeSegment ? (
            <SegmentExperiencePage
              segment={activeSegment}
              selectedTopic={urlTopic}
              onSelectTopic={handleSelectTopic}
              navigate={navigate}
            />
          ) : (
            <EmptyState
              title="No mentorship segments are available"
              description="Suggest Key has not published any segments yet. Please check back shortly."
            />
          )}
        </div>

      <footer className="mt-20 border-t border-white/10 bg-[var(--sk-brand-plum)] text-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-sm">
              <div className="flex items-center gap-2.5">
                <img src="/logo.png" alt="" className="h-9 w-9 rounded-[10px] object-cover" />
                <span className="font-display text-base font-bold">Suggest Key</span>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-white/70">
                Book a focused one-to-one session with a verified mentor, in your own timezone.
              </p>
            </div>

            <nav aria-label="Footer" className="grid grid-cols-2 gap-x-12 gap-y-3 sm:gap-x-16">
              {FOOTER_LINKS.map((link) => (
                <button
                  key={link.href}
                  type="button"
                  onClick={() => navigate(link.href)}
                  className="text-left text-sm font-medium text-white/70 transition-colors hover:text-[var(--sk-brand-gold)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--sk-brand-gold)] focus-visible:outline-offset-2"
                >
                  {link.label}
                </button>
              ))}
            </nav>
          </div>

          <p className="mt-10 border-t border-white/10 pt-6 text-xs text-white/50">
            © {new Date().getFullYear()} Suggest Key
          </p>
        </div>
      </footer>

      {/* Announced so assistive tech knows the profile's timezone is in play. */}
      <span className="sr-only" aria-live="polite">
        {profile?.timezone ? `Times shown in ${profile.timezone}.` : ''}
      </span>
    </>
  );
};

export default SeekerHomePage;