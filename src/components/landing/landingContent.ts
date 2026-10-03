/**
 * LANDING PAGE COPY.
 *
 * Kept in one file because the page is one argument, and an argument reads
 * better in a single place than scattered across eight components.
 *
 * Two rules govern every string here:
 *
 *   1. No production segment or mentor data. Mentorship areas are database rows
 *      and arrive through `useActiveSegments`; anything a visitor sees about a
 *      real area comes from the API, never from this file.
 *   2. No claim the backend cannot keep. There is no review system, so no
 *      rating, testimonial or success metric appears anywhere on the page. What
 *      the platform does actually do — applications, two documents, a human
 *      approval, approved-and-active discovery — is stated exactly.
 *
 * A third rule governs the calls to action. This page has one conversion —
 * finding a mentor — so "Find a Mentor" is the only action in the hero, the
 * navigation, the final call and the mobile sheet. "Become a mentor" belongs
 * to the footer and nowhere else, because a second action at the same weight
 * would split the one thing this page is for.
 */

export interface LandingStep {
  /** Two digits, editorial anchor. Decorative: rendered inside aria-hidden. */
  readonly index: string;
  readonly title: string;
  readonly description: string;
}

export interface LandingTrustItem {
  readonly title: string;
  readonly description: string;
}

// --- hero -------------------------------------------------------------------

export const HERO_EYEBROW = '1:1 Mentorship';

/** Split into lines so the entrance can reveal the headline one line at a time. */
export const HERO_TITLE_LINES: readonly string[] = [
  'Find the right mentor.',
  'Take your next step.',
];

export const HERO_BODY =
  'Connect with verified mentors for focused, one-to-one conversations around what matters to you.';

export const HERO_PRIMARY_LABEL = 'Find a Mentor';

/** What a visitor is actually promised, taken from the real verification model. */
export const HERO_PROOF: readonly string[] = [
  'Applications reviewed by our team',
  'Government ID and qualification proof',
  'Only approved mentors are listed',
];

// --- mentorship areas --------------------------------------------------------

export const AREAS_EYEBROW = 'Mentorship areas';
export const AREAS_TITLE = 'What are you looking for help with?';
export const AREAS_BODY =
  'Explore focused mentorship across the areas that matter to you. Each one is run by mentors who applied, were reviewed, and are approved to appear here.';

// --- how it works -----------------------------------------------------------

export const STEPS_EYEBROW = 'How it works';
export const STEPS_TITLE = 'Guidance that fits your next step.';
export const STEPS_BODY =
  'Four steps from the question you are carrying to the hour you spend on it.';

export const STEPS: readonly LandingStep[] = [
  {
    index: '01',
    title: 'Choose what you need',
    description:
      'Pick the area you want help with, then add the detail you would want a mentor to know before the call.',
  },
  {
    index: '02',
    title: 'Find your mentor',
    description:
      'Browse approved mentors in that area. Read who they are, what they offer and what it costs before you commit to anything.',
  },
  {
    index: '03',
    title: 'Pick a time that works',
    description:
      'See the times a mentor has actually opened, then take one that fits your week in your own timezone.',
  },
  {
    index: '04',
    title: 'Have a focused 1:1 conversation',
    description:
      'The hour is yours alone. Bring the situation, leave with a clearer next step.',
  },
];

// --- the mentors -------------------------------------------------------------

export const MENTORS_EYEBROW = 'The mentors';
export const MENTORS_TITLE = 'Meet the experts';
export const MENTORS_BODY = 'Verified mentors ready to help you move forward.';

export const MENTORS_LINK_LABEL = 'Browse every mentor';

export const MENTORS_EMPTY_TITLE = 'Mentors are joining the community.';
export const MENTORS_EMPTY_BODY =
  'Check back soon to discover verified mentors for this area. A profile appears here the moment our team approves it, and nothing on this page is added by hand.';

export const MENTORS_ERROR_TITLE = 'The mentor list could not be loaded';
export const MENTORS_ERROR_BODY =
  'Nothing is cached here, so trying again shows the current directory rather than an old copy.';

// --- human connection --------------------------------------------------------

export const CONNECTION_EYEBROW = 'Why one to one';

export const CONNECTION_QUOTE_LINES: readonly string[] = [
  'Sometimes one conversation',
  'can change how you see',
  'what comes next.',
];

export const CONNECTION_BODY =
  'A focused 1:1 session gives the whole hour to a single question. You bring the situation; the mentor brings experience in the area you are stuck on. What you take away is a next step you can act on, not a list of advice to file away.';

export const CONNECTION_CTA_LABEL = 'Find your mentor';

// --- verification ------------------------------------------------------------

export const TRUST_EYEBROW = 'Verification';
export const TRUST_TITLE = 'Guidance from people who are ready to help.';
export const TRUST_BODY =
  'Mentorship only works if the person on the other side has actually done this before. So no profile goes live on a claim alone.';

/**
 * The real model, described exactly:
 * `mentor_applications` + `mentor_verification_documents`, two configured
 * document types (Government ID, Qualification Certificate), an admin review
 * queue, and discovery restricted to approved and active profiles.
 */
export const TRUST_ITEMS: readonly LandingTrustItem[] = [
  {
    title: 'Every mentor applies with proof',
    description:
      'A government-issued photo identification and a relevant qualification certificate, degree or license. Both are uploaded to the mentor portal as part of the application.',
  },
  {
    title: 'A person reviews every application',
    description:
      'The application sits in a review queue. A member of the team reads it and checks both documents before anything is approved, and a rejected application can be resubmitted with corrections.',
  },
  {
    title: 'Only approved mentors are discoverable',
    description:
      'A mentor appears in search and on a public profile only once that approval is recorded and the profile is active. An application that has not been approved has no public page to find.',
  },
];

// --- final call ---------------------------------------------------------------

export const FINAL_EYEBROW = 'One conversation';
export const FINAL_TITLE = 'Your next step can start with one conversation.';
export const FINAL_BODY =
  'Find a mentor for what you are working through, learning, or building.';

// --- footer --------------------------------------------------------------------

export interface LandingFooterGroup {
  readonly heading: string;
  readonly links: ReadonlyArray<{ readonly label: string; readonly route: string }>;
}

export const FOOTER_PROMISE = 'One-to-one mentorship, booked around your life.';

export const FOOTER_GROUPS: readonly LandingFooterGroup[] = [
  {
    heading: 'Explore',
    links: [
      { label: 'How it works', route: '/#how-it-works' },
      { label: 'Mentorship areas', route: '/#areas' },
      { label: 'The mentors', route: '/#mentors' },
      { label: 'Become a mentor', route: '/mentor/signup' },
    ],
  },
  {
    heading: 'For seekers',
    links: [
      { label: 'Sign in', route: '/auth/login' },
      { label: 'Create an account', route: '/auth/signup' },
      { label: 'Mentor directory', route: '/mentors' },
      { label: 'Browse mentors', route: '/seeker' },
    ],
  },
  {
    heading: 'For mentors',
    links: [
      { label: 'Apply as a mentor', route: '/mentor/signup' },
      { label: 'Mentor sign in', route: '/auth/login' },
      { label: 'Verification status', route: '/mentor/verification' },
      { label: 'Mentor support', route: '/mentor/support' },
    ],
  },
];

export const FOOTER_LEGAL = 'One conversation at a time.';