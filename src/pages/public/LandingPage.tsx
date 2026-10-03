import React, { useCallback } from 'react';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import { useActiveSegments } from '@/src/hooks/useActiveSegments';
import { mentorListPath } from '@/src/lib/mentorNav';
import { LandingNav } from '@/src/components/landing/LandingNav';
import { LandingHero } from '@/src/components/landing/LandingHero';
import { LandingSegmentStrip } from '@/src/components/landing/LandingSegmentStrip';
import { LandingHowItWorks } from '@/src/components/landing/LandingHowItWorks';
import { LandingFeaturedMentors } from '@/src/components/landing/LandingFeaturedMentors';
import { LandingWhySection } from '@/src/components/landing/LandingWhySection';
import { LandingMentorCta } from '@/src/components/landing/LandingMentorCta';
import { LandingFinalCta } from '@/src/components/landing/LandingFinalCta';
import { LandingFooter } from '@/src/components/landing/LandingFooter';

/**
 * THE LANDING PAGE.
 *
 * Deliberately a composition and nothing else: every section owns its own
 * markup, its own data and its own states, so this file holds only the two
 * decisions that genuinely belong to the page as a whole.
 *
 *   1. `findMentorPath` — where "Find a Mentor" goes.
 *   2. `handleNavigate` — the one href dispatcher.
 *
 * DATA. Nothing on this page carries a hardcoded mentor, gig, price, slot,
 * rating, review, testimonial or segment. Areas come from `useActiveSegments`,
 * mentors and availability from `useFeaturedMentors`, and both go through the
 * same shipped queries every other surface uses. No rule about who is eligible
 * to appear is re-implemented here: the backend's answer is the answer.
 *
 * AUTH. Unchanged from the page this replaces. Mentor discovery is a gated
 * seeker route, so a signed-out visitor is sent to sign up — the step that
 * actually unlocks discovery — rather than into an "Authentication Required"
 * screen for a page they never had access to.
 *
 * ROUTING. The app's hand-written router is preserved. `navigate` from
 * `NavigationContext` is the only way this page changes route; anchors are
 * scrolled in place. No router library is involved and no route is invented:
 * every destination resolves to a route the router implements.
 */
export const LandingPage: React.FC = () => {
  const { navigate } = useNavigation();
  const { isAuthenticated } = useAuth();
  const { segments, isLoading: isLoadingSegments, error: segmentsError, reload: reloadSegments } = useActiveSegments();

  const findMentorPath = isAuthenticated ? mentorListPath() : '/auth/signup';

  const handleNavigate = useCallback(
    (href: string) => {
      if (href === '/') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      if (href.startsWith('#')) {
        const target = document.getElementById(href.slice(1));
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          // Move focus with the scroll, so a keyboard or screen-reader user
          // lands on the section they chose instead of staying on the nav link.
          target.setAttribute('tabindex', '-1');
          target.focus({ preventScroll: true });
          target.removeAttribute('tabindex');
        }
        return;
      }

      navigate(href);
    },
    [navigate]
  );

  const handleSegmentOpen = useCallback(
    (segment: { slug: string }) => {
      // Signed out, a segment link still has to land somewhere real, so it
      // resolves to the same entry point as "Find a Mentor". Signed in, it is
      // the segment's own discovery route with the slug carried through.
      navigate(isAuthenticated ? mentorListPath({ segmentSlug: segment.slug }) : findMentorPath);
    },
    [navigate, isAuthenticated, findMentorPath]
  );

  return (
    <div className="min-h-screen bg-[var(--sk-brand-canvas)] text-[var(--sk-brand-text)] antialiased">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-[var(--sk-brand-surface)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-[var(--sk-brand-text)] focus:shadow-lg"
      >
        Skip to content
      </a>

      <LandingNav findMentorPath={findMentorPath} onNavigate={handleNavigate} />

      <main id="main">
        <LandingHero
          findMentorPath={findMentorPath}
          onNavigate={handleNavigate}
          segments={segments}
          isLoadingSegments={isLoadingSegments}
          onSegmentOpen={handleSegmentOpen}
        />

        <LandingSegmentStrip
          segments={segments}
          isLoading={isLoadingSegments}
          hasError={Boolean(segmentsError)}
          onOpen={handleSegmentOpen}
          onFindMentor={() => handleNavigate(findMentorPath)}
          onRetry={reloadSegments}
        />

        <LandingHowItWorks />

        <LandingFeaturedMentors findMentorPath={findMentorPath} onNavigate={handleNavigate} />

        <LandingWhySection />

        <LandingMentorCta onNavigate={handleNavigate} />

        <LandingFinalCta findMentorPath={findMentorPath} onNavigate={handleNavigate} />
      </main>

      <LandingFooter onNavigate={handleNavigate} />
    </div>
  );
};