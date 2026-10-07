import React from 'react';
import type { DirectoryMentor, Segment } from '@/src/types/database';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { useActiveSegments } from '@/src/hooks/useActiveSegments';
import { useFeaturedMentors } from '@/src/hooks/useFeaturedMentors';
import { mentorDirectoryPath, mentorProfilePath, segmentLandingPath } from '@/src/lib/mentorNav';
import { LandingNav } from '@/src/components/landing/LandingNav';
import { LandingHero } from '@/src/components/landing/LandingHero';
import { LandingSegmentStrip } from '@/src/components/landing/LandingSegmentStrip';
import { LandingHowItWorks } from '@/src/components/landing/LandingHowItWorks';
import { LandingFeaturedMentors } from '@/src/components/landing/LandingFeaturedMentors';
import { LandingConnectionSection } from '@/src/components/landing/LandingConnectionSection';
import { LandingTrustSection } from '@/src/components/landing/LandingTrustSection';
import { LandingFaq } from '@/src/components/landing/LandingFaq';
import { LandingFinalCta } from '@/src/components/landing/LandingFinalCta';
import { LandingFooter } from '@/src/components/landing/LandingFooter';

/**
 * THE LANDING PAGE.
 *
 * Deliberately a composition and nothing else: every section owns its own
 * markup, its own data and its own states, so this file holds only the
 * decisions that genuinely belong to the page as a whole — where the one
 * conversion goes, and the single href dispatcher every section shares.
 *
 * DATA. Nothing on this page carries a hardcoded mentor, gig, price, slot,
 * rating, review, testimonial or segment. Areas come from `useActiveSegments`,
 * mentors and availability from `useFeaturedMentors`, and both go through the
 * same shipped queries every other surface uses. The hero's orbit and the
 * areas section render the SAME catalogue from the ONE read.
 *
 * AUTH. Mentor discovery is a gated seeker route, so a signed-out visitor is
 * sent to sign up — the step that actually unlocks discovery — rather than
 * into an "Authentication Required" screen for a page they never had access
 * to. The global directory is gated the same way, so "Browse every mentor"
 * resolves to signup for a signed-out visitor too.
 *
 * ROUTING. The app's hand-written router is preserved. `navigate` from
 * `NavigationContext` is the only way this page changes route; in-page
 * anchors are scrolled in place by the sections themselves. No router
 * library is involved and no route is invented: every destination resolves
 * to a route the router implements.
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

  const findMentorPath = isAuthenticated ? '/seeker' : '/auth/signup';

  const handleNavigate = (path: string) => {
    navigate(path);
  };

  const handleOpenArea = (segment: Segment) => {
    navigate(segmentLandingPath({ segmentSlug: segment.slug }));
  };

  const handleOpenMentor = (mentor: DirectoryMentor) => {
    navigate(
      isAuthenticated
        ? mentorProfilePath({ mentorId: mentor.id, origin: 'mentor-list' })
        : findMentorPath
    );
  };

  /**
   * The rail renders directory rows, while the hero's stage renders the
   * availability-wrapped pairs the same read produced. One query, two
   * shapes, no second fetch.
   */
  const directoryMentors = featuredMentors.map((entry) => entry.mentor);

  return (
    <div className="sk-lg">
      <a className="sk-lg-skip" href="#main">
        Skip to content
      </a>

      <LandingNav findMentorPath={findMentorPath} onNavigate={handleNavigate} />

        <LandingFinalCta onFindMentor={() => handleNavigate(findMentorPath)} />

      <LandingFooter onNavigate={handleNavigate} />
    </div>
  );
};

export default LandingPage;
