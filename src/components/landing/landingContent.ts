/**
 * LANDING PAGE COPY.
 *
 * Marketing words and navigation targets only. There is deliberately NO mentor,
 * gig, price, availability, rating, review or testimonial data in this file:
 * every one of those is read at runtime from the live backend. Copy that would
 * have to be "true about the product" is written once here so it cannot drift
 * between sections.
 *
 * Route targets use the app's own helpers/constants rather than string
 * literals, so `tests/route_contract.test.ts` keeps holding: no link on this
 * page can point at a route the router does not implement.
 */

import type { LucideIcon } from 'lucide-react';
import {
  BadgeCheck,
  CalendarClock,
  Compass,
  MessagesSquare,
  Search,
  Sparkles,
  UserRound,
} from 'lucide-react';

// Real, implemented routes. Referenced by id below so a link and its label can
// never drift apart.
export const ROUTE_SIGN_IN = '/auth/login';
export const ROUTE_SIGN_UP = '/auth/signup';
export const ROUTE_MENTOR_SIGNUP = '/mentor/signup';

const ARROW = '\u2192'; // →

/**
 * The shared right-arrow glyph. It is written as an escape on purpose: a
 * literal arrow in source is exactly the kind of character that silently
 * degrades to "?" when the file is saved with a different encoding, which is
 * how a page ends up shipping "Find a Mentor ?".
 */
export const HERO_ARROW = ARROW;

export interface LandingNavLink {
  label: string;
  /** On-page anchor (no '#'). */
  anchor: string;
}

export const NAV_LINKS: LandingNavLink[] = [
  { label: 'Explore Mentors', anchor: 'mentors' },
  { label: 'How It Works', anchor: 'how-it-works' },
  { label: 'Why Suggest Key', anchor: 'why-suggest-key' },
  { label: 'For Mentors', anchor: 'for-mentors' },
];

/**
 * The three things the product actually guarantees, stated without
 * embellishment. No ratings, no review counts, no booking counts.
 */
export interface TrustPoint {
  icon: LucideIcon;
  label: string;
}

export const TRUST_POINTS: TrustPoint[] = [
  { icon: BadgeCheck, label: 'Verified mentors' },
  { icon: Search, label: 'Fees shown upfront' },
  { icon: MessagesSquare, label: 'Private 1:1 sessions' },
];

export interface JourneyStep {
  num: string;
  title: string;
  description: string;
  icon: LucideIcon;
}

/** The real booking journey: discover → choose slot → pay → confirm → session → workspace. */
export const JOURNEY_STEPS: JourneyStep[] = [
  {
    num: '01',
    title: 'Discover',
    description: 'Find a mentor who understands your situation.',
    icon: Compass,
  },
  {
    num: '02',
    title: 'Choose',
    description: 'Pick a session and a time that works for you.',
    icon: CalendarClock,
  },
  {
    num: '03',
    title: 'Connect',
    description: 'Have a private 1:1 mentorship session.',
    icon: MessagesSquare,
  },
  {
    num: '04',
    title: 'Move forward',
    description: 'Get takeaways, suggestions and next steps after your session.',
    icon: Sparkles,
  },
];

export interface WhyBenefit {
  title: string;
  description: string;
  icon: LucideIcon;
}

/** Each claim here is a mechanic the product already ships. */
export const WHY_BENEFITS: WhyBenefit[] = [
  {
    title: '1:1, not one-size-fits-all',
    description: 'Your situation gets the mentor\u2019s full attention.',
    icon: UserRound,
  },
  {
    title: 'Verified mentors',
    description: 'Connect with approved mentors with relevant experience.',
    icon: BadgeCheck,
  },
  {
    title: 'Your time matters',
    description: 'Choose a session that fits your schedule.',
    icon: CalendarClock,
  },
  {
    title: 'Leave with clarity',
    description: 'Get takeaways, suggestions and next steps after your session.',
    icon: Sparkles,
  },
];

/** What a mentor actually does on the platform, in their own order. */
export const MENTOR_STEPS: string[] = [
  'Apply to mentor with your area of experience',
  'Set the sessions you want to offer and your price',
  'Publish your availability',
  'Take 1:1 bookings and write up each session',
];

export interface FooterGroup {
  title: string;
  links: Array<{ label: string; href: string }>;
}

/**
 * Footer links are either on-page anchors or implemented routes. There is no
 * About, Privacy or Terms page in this app, so none is invented here.
 */
export const FOOTER_GROUPS: FooterGroup[] = [
  {
    title: 'Explore',
    links: [
      { label: 'Find Mentors', href: `#mentors` },
      { label: 'How It Works', href: '#how-it-works' },
      { label: 'Why Suggest Key', href: '#why-suggest-key' },
    ],
  },
  {
    title: 'For Mentors',
    links: [{ label: 'Become a Mentor', href: ROUTE_MENTOR_SIGNUP }],
  },
  {
    title: 'Account',
    links: [
      { label: 'Sign In', href: ROUTE_SIGN_IN },
      { label: 'Create Account', href: ROUTE_SIGN_UP },
    ],
  },
];