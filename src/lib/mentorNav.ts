/**
 * MENTOR DISCOVERY NAVIGATION.
 *
 * Mentor detail can be entered from two different places, and they are NOT the
 * same destination:
 *
 *   segment landing  (/seeker?segment=<slug>)  -> "See all mentors"
 *   mentor list      (/seeker/mentors?...)     -> "View profile" / "Book session"
 *
 * The old code hardcoded one Back target (the mentor list), so a seeker who
 * opened a mentor from a segment landing page and pressed Back lost the segment
 * context entirely. `window.history.back()` is not the fix: a direct link, a
 * refresh, a notification or a bookmark all produce a back stack with no
 * relationship to this app.
 *
 * So the origin travels in the URL as a WHITELISTED keyword, never as a path:
 * an attacker-supplied `returnTo=https://evil.example` is dropped, not followed.
 * Everything else here is pure string work, so it is unit-testable without a
 * browser.
 */

import { ALL_TOPICS, isValidTopicSlug } from '@/src/lib/segmentTopics';

export const SEEKER_HOME = '/seeker';
export const MENTOR_LIST_ROUTE = '/seeker/mentors';
export const MENTOR_DETAIL_ROUTE = '/seeker/mentor-detail';
/**
 * The PUBLIC MENTOR PROFILE, which is a different experience from mentor detail.
 *
 * Mentor detail answers "when can I book this gig": it holds the date, the slot
 * grid, the 5-minute hold and the payment hand-off. The profile answers "who is
 * this mentor and what do they sell": identity, about, languages, expertise,
 * experience and every ACTIVE session offer, each with its own Book a slot.
 *
 * They are separate routes because a single page cannot honestly be both: a
 * profile that preselects a time, or a booking screen with no way to see what
 * else the mentor offers, each break one of the two jobs.
 */
export const MENTOR_PROFILE_ROUTE = '/seeker/mentor-profile';

/** Where the seeker was when they opened mentor detail. */
export type MentorOrigin = 'segment' | 'mentor-list';

/**
 * Why the seeker opened mentor detail.
 *
 * Mentor detail is the BOOKING experience, so `book` is what a booking action
 * sends and `profile` is the safe default for a bare or hand-edited URL: it
 * opens the biography and the date/time selection without arming a time. It
 * never decides WHAT is booked: the gig, the segment and the mentor still come
 * from the URL and are still re-validated by the server, and reserving stays an
 * explicit action on the page.
 */
export type MentorIntent = 'profile' | 'book';

const MENTOR_INTENTS: MentorIntent[] = ['profile', 'book'];

/** Anything unrecognised yields `profile`, the non-committal default. */
export function parseMentorIntent(raw: string | null | undefined): MentorIntent {
  return MENTOR_INTENTS.includes(raw as MentorIntent) ? (raw as MentorIntent) : 'profile';
}

const SEGMENT_SLUG = /^[a-z0-9-]{2,60}$/;
const DATE_STRING = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reads the `source` parameter. Anything unrecognised - including a URL, a
 * path, or an absent value from a direct link - yields null, and the caller
 * falls back to the mentor list.
 */
export function parseMentorOrigin(raw: string | null | undefined): MentorOrigin | null {
  if (raw === 'segment') return 'segment';
  // `mentors` is accepted as a legacy alias for the same whitelist entry.
  if (raw === 'mentor-list' || raw === 'mentors') return 'mentor-list';
  return null;
}

/** True when a `source` value survived the whitelist. */
export function isKnownMentorOrigin(raw: string | null | undefined): boolean {
  return parseMentorOrigin(raw) !== null;
}

export interface DiscoveryState {
  segmentSlug?: string | null;
  topic?: string | null;
  date?: string | null;
}

function discoveryParams(state: DiscoveryState): URLSearchParams {
  const params = new URLSearchParams();
  const slug = (state.segmentSlug || '').trim();
  if (SEGMENT_SLUG.test(slug)) params.set('segmentSlug', slug);
  if (state.topic && state.topic !== ALL_TOPICS && isValidTopicSlug(state.topic)) {
    params.set('topic', state.topic);
  }
  const date = (state.date || '').trim();
  if (DATE_STRING.test(date)) params.set('date', date);
  return params;
}

/** The segment landing page, preserving topic and date. */
export function segmentLandingPath(state: DiscoveryState = {}): string {
  const params = new URLSearchParams();
  const slug = (state.segmentSlug || '').trim();
  if (SEGMENT_SLUG.test(slug)) params.set('segment', slug);
  if (state.topic && state.topic !== ALL_TOPICS && isValidTopicSlug(state.topic)) {
    params.set('topic', state.topic);
  }
  const date = (state.date || '').trim();
  if (DATE_STRING.test(date)) params.set('date', date);

  const query = params.toString();
  return query ? `${SEEKER_HOME}?${query}` : SEEKER_HOME;
}

/** The canonical mentor discovery/list page, preserving the same context. */
export function mentorListPath(state: DiscoveryState = {}): string {
  const query = discoveryParams(state).toString();
  return query ? `${MENTOR_LIST_ROUTE}?${query}` : MENTOR_LIST_ROUTE;
}

/**
 * The BOOKING route: mentor detail, tagged with the origin so Back is
 * contextual and with `intent: 'book'` so the page lands on the date/time
 * selection rather than at the top of the biography.
 *
 * `gigId` is optional and only forwarded when the caller actually knows it,
 * because an empty `gigId` would override the server's own gig resolution.
 *
 * The mentor / segment / gig context is the caller's to supply. Nothing in this
 * module, or anywhere that calls it, picks a default gig: "the mentor's first
 * gig" is not a thing the database guarantees, because a mentor holds one ACTIVE
 * gig PER SEGMENT and may hold several at once.
 */
export function mentorDetailPath(input: {
  mentorId: string;
  segmentSlug?: string | null;
  gigId?: string | null;
  date?: string | null;
  topic?: string | null;
  origin?: MentorOrigin | null;
  intent?: MentorIntent | null;
}): string {
  const params = new URLSearchParams({ mentorId: input.mentorId });
  const slug = (input.segmentSlug || '').trim();
  if (SEGMENT_SLUG.test(slug)) params.set('segmentSlug', slug);
  if (input.gigId) params.set('gigId', input.gigId);
  const date = (input.date || '').trim();
  if (DATE_STRING.test(date)) params.set('date', date);
  if (input.topic && input.topic !== ALL_TOPICS && isValidTopicSlug(input.topic)) {
    params.set('topic', input.topic);
  }
  if (input.origin) params.set('source', input.origin);
  if (input.intent) params.set('intent', input.intent);
  return `${MENTOR_DETAIL_ROUTE}?${params.toString()}`;
}

/**
 * The PUBLIC MENTOR PROFILE route.
 *
 * Carries the same discovery context as `mentorDetailPath` — `source` so Back
 * is contextual, `segmentSlug` so the page can be scoped to a segment and `date`
 * so a seeker who was looking at a date does not lose it — and it deliberately
 * carries NO `intent`: this page never starts or lands on a booking.
 *
 * It takes no `gigId`. A profile shows every active offer the mentor has, so
 * naming one gig here would be a lie about what the page is showing, and the
 * seeker chooses an offer on the page itself.
 */
export function mentorProfilePath(input: {
  mentorId: string;
  segmentSlug?: string | null;
  date?: string | null;
  topic?: string | null;
  origin?: MentorOrigin | null;
}): string {
  const params = new URLSearchParams({ mentorId: input.mentorId });
  const slug = (input.segmentSlug || '').trim();
  if (SEGMENT_SLUG.test(slug)) params.set('segmentSlug', slug);
  const date = (input.date || '').trim();
  if (DATE_STRING.test(date)) params.set('date', date);
  if (input.topic && input.topic !== ALL_TOPICS && isValidTopicSlug(input.topic)) {
    params.set('topic', input.topic);
  }
  if (input.origin) params.set('source', input.origin);
  return `${MENTOR_PROFILE_ROUTE}?${params.toString()}`;
}

/**
 * Where Back goes from mentor detail OR from the public profile.
 *
 * Both pages are entered from the same two places and carry the same `source`
 * keyword, so they share this one helper: `segment` returns to the segment
 * landing page, `mentor-list` returns to discovery. A missing, hostile or
 * unusable origin falls back to discovery - never to an arbitrary URL, and
 * never to a segment the URL does not name.
 */
export function mentorDetailBackPath(input: {
  origin?: string | null;
  discovery?: DiscoveryState;
}): string {
  const state = input.discovery || {};
  const hasSegment = SEGMENT_SLUG.test((state.segmentSlug || '').trim());
  const origin = parseMentorOrigin(input.origin);
  if (origin === 'segment' && hasSegment) return segmentLandingPath(state);
  return mentorListPath(state);
}