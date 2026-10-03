import React from 'react';
import type { DirectoryMentor, Segment } from '@/src/types/database';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { useActiveSegments } from '@/src/hooks/useActiveSegments';
import { useFeaturedMentors } from '@/src/hooks/useFeaturedMentors';
import { mentorDirectoryPath, mentorProfilePath } from '@/src/lib/mentorNav';
import { LandingNav } from '@/src/components/landing/LandingNav';
import { LandingHero } from '@/src/components/landing/LandingHero';
import { LandingSegmentStrip } from '@/src/components/landing/LandingSegmentStrip';
import { LandingHowItWorks } from '@/src/components/landing/LandingHowItWorks';
import { LandingFeaturedMentors } from '@/src/components/landing/LandingFeaturedMentors';
import { LandingConnectionSection } from '@/src/components/landing/LandingConnectionSection';
import { LandingTrustSection } from '@/src/components/landing/LandingTrustSection';
import { LandingFinalCta } from '@/src/components/landing/LandingFinalCta';
import { LandingFooter } from '@/src/components/landing/LandingFooter';

/**
 * THE PUBLIC LANDING PAGE.
 *
 * The composition is one argument, read top to bottom:
 *
 *   1  hero          what this is, in one sentence and one button
 *   2  areas         what it covers, from the live catalogue
 *   3  how it works  the four steps, as a ruled ledger
 *   4  the mentors   real, approved, current profiles
 *   5  conversation  why one to one, in three lines of type
 *   6  verification  the actual approval mechanism
 *   7  final call    the one action, at full volume
 *
 * Data and behaviour are unchanged from the page this replaces. The segment
 * catalogue is read once, here, and shared by the hero's photography and the
 * areas section; mentor profiles come from the same public directory hook and
 * the same profile route they always did. Nothing is cached, faked or hardcoded,
 * and no service-role client is involved.
 */

export const LandingPage: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const { navigate } = useNavigation();

  const {
    segments,
    isLoading: isLoadingSegments,
    error: segmentError,
    reload: reloadSegments,
  } = useActiveSegments();

  const {
    mentors: featuredMentors,
    isLoading: isLoadingMentors,
    hasError: hasMentorError,
    reload: reloadMentors,
  } = useFeaturedMentors();

  /**
   * Discovery is the destination for every "find a mentor" action. A signed-out
   * visitor cannot see mentors, so they are taken to signup instead of to a
   * page that would redirect them anyway.
   */
  const findMentorPath = isAuthenticated ? '/seeker' : '/auth/signup';

  const handleNavigate = (path: string) => {
    navigate(path);
  };

  const handleOpenArea = (segment: Segment) => {
    navigate(`/seeker?segment=${encodeURIComponent(segment.slug)}`);
  };

  /**
   * Signed in, a mentor card opens that mentor's public profile. Signed out,
   * there is no profile to show, so the visitor goes to signup — the same
   * destination as every other discovery action.
   */
  const handleOpenMentor = (mentor: DirectoryMentor) => {
    navigate(
      isAuthenticated
        ? mentorProfilePath({ mentorId: mentor.id, origin: 'mentor-list' })
        : findMentorPath
    );
  };

  return (
    <div className="sk-lp-shell">
      <a className="sk-lp-skip" href="#main">
        Skip to content
      </a>

      <LandingNav findMentorPath={findMentorPath} onNavigate={handleNavigate} />

      <main id="main">
        <LandingHero onFindMentor={() => handleNavigate(findMentorPath)} />

        <LandingSegmentStrip
          segments={segments}
          isLoadingSegments={isLoadingSegments}
          hasError={Boolean(segmentError)}
          onOpenArea={handleOpenArea}
          onRetry={reloadSegments}
        />

        <LandingHowItWorks />

        <LandingFeaturedMentors
          mentors={featuredMentors.map((entry) => entry.mentor)}
          isLoading={isLoadingMentors}
          hasError={hasMentorError}
          onOpenMentor={handleOpenMentor}
          onBrowseAll={() => handleNavigate(isAuthenticated ? mentorDirectoryPath() : '/auth/signup')}
          onRetry={reloadMentors}
        />

        <LandingConnectionSection onFindMentor={() => handleNavigate(findMentorPath)} />

        <LandingTrustSection />

        <LandingFinalCta onFindMentor={() => handleNavigate(findMentorPath)} />
      </main>

      <LandingFooter onNavigate={handleNavigate} />
    </div>
  );
};

export default LandingPage;