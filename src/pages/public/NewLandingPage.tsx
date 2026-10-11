import { useCallback } from 'react';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { useMentorDirectory } from '@/src/hooks/useMentorDirectory';
import { NewLandingHero } from '@/src/components/new-landing/NewLandingHero';
import { NewLandingSections } from '@/src/components/new-landing/NewLandingSections';
import { NewLandingFooter } from '@/src/components/new-landing/NewLandingFooter';
import { useSectionScroll } from '@/src/components/new-landing/useSectionScroll';
import '@/src/components/new-landing/styles/NewLandingPage.css';

/**
 * NEW LANDING PAGE — the `new` variant.
 *
 * A complete, independent landing page converted from the supplied standalone
 * HTML design. It owns no state, markup or styling from the legacy landing
 * page and never imports `src/pages/public/LandingPage.tsx` or anything under
 * `src/components/landing/` that the legacy page depends on for itself.
 *
 * It reuses the application's real infrastructure so it is not a disconnected
 * static page: the mentor catalogue comes from `useMentorDirectory`, and every
 * genuinely available destination — sign-in, sign-up, the segment filters and
 * the mentor directory — goes through the app's own router via
 * `useNavigation().navigate`, so no internal link causes a full page reload.
 *
 * The single `.nlg` scope root is what keeps this page's stylesheet from
 * leaking anywhere else. See `src/components/new-landing/styles/`.
 */
export function NewLandingPage() {
  const { isAuthenticated } = useAuth();
  const { navigate } = useNavigation();
  const {
    mentors,
    isLoading: mentorsLoading,
    hasError: mentorsError,
    reload: reloadMentors,
  } = useMentorDirectory();

  const scrollTo = useSectionScroll();

  /**
   * The one conversion destination, resolved exactly as the legacy page does:
   * a signed-in seeker goes to their home, an anonymous visitor is sent to
   * sign-up. There is no second, divergent definition of this path.
   */
  const findMentorPath = isAuthenticated ? '/seeker' : '/auth/signup';

  const openSignIn = useCallback(() => navigate('/auth/login'), [navigate]);
  const openHome = useCallback(() => scrollTo('top'), [scrollTo]);
  const openBookSession = useCallback(
    () => navigate(findMentorPath),
    [navigate, findMentorPath],
  );

  return (
    <div className="nlg" id="top">
      <a
        className="nlg-skip"
        href="#keys"
        onClick={(event) => {
          event.preventDefault();
          scrollTo('keys');
        }}
      >
        Skip to content
      </a>

      <NewLandingHero onBookSession={openBookSession} />

      <NewLandingSections
        mentors={mentors}
        mentorsLoading={mentorsLoading}
        mentorsError={mentorsError}
        onReloadMentors={reloadMentors}
        findMentorPath={findMentorPath}
      />

      <NewLandingFooter onSignIn={openSignIn} onHome={openHome} />
    </div>
  );
}

export default NewLandingPage;
