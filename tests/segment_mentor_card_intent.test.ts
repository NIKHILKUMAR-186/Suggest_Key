/**
 * SEGMENT MENTOR CARD: two buttons, two pages.
 *
 * # The defect this file was born for
 *
 * "Book a session" and "View profile" on a segment mentor card produced
 * byte-identical URLs, so the page had no way to know which button was pressed.
 *
 * # Why it was first fixed with a query keyword, and why it no longer is
 *
 * The first fix made both buttons the same `/seeker/mentor-detail` route
 * distinguished only by `intent=profile|book`. That made the two navigations
 * different while leaving them the same EXPERIENCE: one page still had to be
 * both a biography and a slot picker, and "View profile" still arrived at a
 * page with a date, a slot grid and a Reserve button.
 *
 * The profile is now its own page (`/seeker/mentor-profile`) and booking stays
 * on `/seeker/mentor-detail`. `intent` survives on the booking route because it
 * still earns its place there: it decides whether the page lands on the date/time
 * selection, and it is still whitelisted so a hand-edited URL cannot arm a time.
 *
 * # What is asserted here
 *
 * On the built URL, not on rendered DOM: the routing decision is pure string
 * work, and a render test would also pass if both buttons rendered identical
 * markup while differing only in a handler, which was the bug.
 *
 * Every invariant the previous version of this file asserted is still asserted
 * here - different destinations, mentorId/segmentSlug/gigId preserved, the
 * origin preserved for Back, no gig lookup or default on the card, exactly one
 * control that reserves a slot, no booking logic in the card, no invented
 * rating. Only the two assertions that encoded "one route" now assert "two
 * routes".
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MENTOR_DETAIL_ROUTE,
  MENTOR_PROFILE_ROUTE,
  mentorDetailPath,
  mentorProfilePath,
  parseMentorIntent,
} from '../src/lib/mentorNav';
import type { TopicMentor } from '../src/lib/segmentTopics';

const readSource = (relative: string) =>
  readFileSync(join(import.meta.dirname, '..', relative), 'utf8');

/** Strips comments so prose in a docblock cannot satisfy a source check. */
const code = (relative: string) =>
  readSource(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const CARD = 'src/components/seeker/SegmentMentorCard.tsx';
const DETAIL_PAGE = 'src/pages/seeker/SeekerMentorDetailPage.tsx';
const PROFILE_PAGE = 'src/pages/seeker/SeekerMentorProfilePage.tsx';

// ---------------------------------------------------------------------------
// Fixtures. Nothing here names a real segment: if the card ever branched on a
// slug instead of forwarding context, these would still pass while the product
// was broken for every segment but one.
// ---------------------------------------------------------------------------

const MENTOR: TopicMentor = {
  id: 'mentor-aaaa',
  full_name: 'Asha Rao',
  avatar_url: null,
  timezone: 'Asia/Kolkata',
  headline: 'Speech-language pathologist',
  about: 'Ten years in paediatric clinics.',
  experience_years: 0,
  languages: ['English', 'Hindi'],
  expertise: null,
  rating: 5,
  review_count: 0,
  session_count: 0,
  is_featured: false,
  is_primary_segment: true,
  segment: { id: 'segment-1111', name: 'Speech', slug: 'speech' },
  gigs: [
    {
      id: 'gig-aaaa',
      title: 'First session',
      description: 'A 45 minute intro.',
      duration_minutes: 45,
      price_inr: 1200,
    },
  ],
  gig: {
    id: 'gig-aaaa',
    title: 'First session',
    description: 'A 45 minute intro.',
    duration_minutes: 45,
    price_inr: 1200,
  },
} as TopicMentor;

/** Mirrors what the card builds, so the two paths are compared as built. */
const cardBookPath = (intent: 'profile' | 'book' = 'book') =>
  mentorDetailPath({
    mentorId: MENTOR.id,
    segmentSlug: MENTOR.segment.slug,
    gigId: MENTOR.gig.id,
    date: null,
    topic: null,
    origin: 'segment',
    intent,
  });

const cardProfilePath = () =>
  mentorProfilePath({
    mentorId: MENTOR.id,
    segmentSlug: MENTOR.segment.slug,
    date: null,
    topic: null,
    origin: 'segment',
  });

const paramsOf = (path: string) => new URLSearchParams(path.split('?')[1]);

// ---------------------------------------------------------------------------
// 1. The two buttons are different destinations, on different pages.
// ---------------------------------------------------------------------------

describe('the two card actions go to two different pages', () => {
  it('"View profile" targets the public profile route, not mentor detail', () => {
    const profile = cardProfilePath();
    assert.ok(
      profile.startsWith(`${MENTOR_PROFILE_ROUTE}?`),
      `View profile must target ${MENTOR_PROFILE_ROUTE}, got ${profile}`,
    );
    assert.equal(profile.startsWith(`${MENTOR_DETAIL_ROUTE}?`), false);
  });

  it('"Book a session" targets mentor detail, the booking experience', () => {
    const book = cardBookPath('book');
    assert.ok(
      book.startsWith(`${MENTOR_DETAIL_ROUTE}?`),
      `Book a session must target ${MENTOR_DETAIL_ROUTE}, got ${book}`,
    );
    assert.equal(book.startsWith(`${MENTOR_PROFILE_ROUTE}?`), false);
  });

  it('the two destinations are not merely different URLs - they are different routes', () => {
    // The stronger form of the old "differ only in the intent keyword" check.
    // A keyword difference inside one path would satisfy `notEqual` on the full
    // URL while leaving both buttons on the same page, which is the defect.
    assert.notEqual(cardBookPath(), cardProfilePath());
    assert.notEqual(
      cardBookPath().split('?')[0],
      cardProfilePath().split('?')[0],
      'the two buttons must be on two different routes, not one route with two moods',
    );
  });

  it('the profile route carries no gigId and no booking intent', () => {
    // The profile is about the mentor and every offer they hold. Naming one gig
    // would claim the page is about that gig, and `intent=book` would put a
    // booking affordance on a read-only page.
    const params = paramsOf(cardProfilePath());
    assert.equal(params.get('gigId'), null);
    assert.equal(params.get('intent'), null);
  });

  it('the booking route still carries intent=book', () => {
    assert.equal(paramsOf(cardBookPath('book')).get('intent'), 'book');
  });

  it('the card navigates to two distinct paths, not one reused twice', () => {
    const card = code(CARD);
    assert.match(card, /const bookPath = segmentMentorDetailPath\(/);
    assert.match(card, /const profilePath = segmentMentorProfilePath\(/);
    // The regression shape: one path variable feeding both handlers.
    assert.equal(
      /const detailPath = segmentMentorDetailPath\(/.test(card),
      false,
      'a single shared path makes both buttons identical again',
    );
    assert.match(card, /navigate\(bookPath\)/);
    assert.match(card, /navigate\(profilePath\)/);
  });

  it('the booking page reads the keyword it is sent, through the whitelist', () => {
    assert.equal(parseMentorIntent('book'), 'book');
    assert.equal(parseMentorIntent('profile'), 'profile');
    // Anything unknown - a hand-edited URL, a stale link - opens the profile
    // section without arming a time.
    for (const hostile of [null, '', 'BOOK', 'https://evil.example', 'pay', 'reserve']) {
      assert.equal(
        parseMentorIntent(hostile as string | null),
        'profile',
        `${hostile} must not open booking`,
      );
    }
    const detail = code(DETAIL_PAGE);
    assert.match(detail, /parseMentorIntent\(/);
  });

  it('the router serves both routes to different pages', () => {
    const router = code('src/routes/Router.tsx');
    assert.match(router, /pathname === '\/seeker\/mentor-profile'\) return <SeekerMentorProfilePage \/>/);
    assert.match(router, /pathname === '\/seeker\/mentor-detail'\) return <SeekerMentorDetailPage \/>/);
  });
});

// ---------------------------------------------------------------------------
// 2, 3, 4, 5. Context survives both destinations.
// ---------------------------------------------------------------------------

describe('both destinations preserve the exact context', () => {
  const destinations: Array<[string, string]> = [
    ['book', cardBookPath('book')],
    ['profile', cardProfilePath()],
  ];

  for (const [label, path] of destinations) {
    it(`mentorId survives (${label})`, () => {
      assert.equal(paramsOf(path).get('mentorId'), MENTOR.id);
    });

    it(`segmentSlug survives (${label})`, () => {
      assert.equal(paramsOf(path).get('segmentSlug'), MENTOR.segment.slug);
    });

    it(`the discovery origin survives, so Back is contextual (${label})`, () => {
      assert.equal(paramsOf(path).get('source'), 'segment');
    });
  }

  it('the exact gigId survives booking, unresolved', () => {
    // The invariant the card must not regress: the seeker reaches the booking
    // flow for the gig ON THE CARD, not the mentor's first gig. A mentor can
    // hold one active gig per segment, so "first gig" and "this gig" differ
    // the moment a mentor has more than one.
    assert.equal(paramsOf(cardBookPath('book')).get('gigId'), MENTOR.gig.id);
  });

  it('the card sends the gig on the card, not a lookup or a default', () => {
    const card = code(CARD);
    assert.match(card, /gigId: mentor\.gig\?\.id \?\? null/);
    assert.equal(
      /gigs\[0\]|gigs\.find\(/.test(card),
      false,
      'the card must never resolve a gig itself',
    );
  });

  it('Back from either destination returns to the segment listing', () => {
    // `source=segment` is what the pages' existing back helper reads, and it is
    // carried identically by both buttons, so Back is unchanged by the split.
    for (const [, path] of destinations) {
      assert.equal(paramsOf(path).get('source'), 'segment');
    }
  });
});

// ---------------------------------------------------------------------------
// The profile page: public data only, and per-offer booking.
// ---------------------------------------------------------------------------

describe('the public profile is a separate, read-only experience', () => {
  const page = () => code(PROFILE_PAGE);

  it('reads the one public profile endpoint', () => {
    assert.match(page(), /fetchPublicMentorProfile\(/);
    assert.equal(
      /createBookingWithHold|slot_holds|fetchMentorSlots|acquireSlotHold/.test(page()),
      false,
      'the profile must hold no booking, slot or hold logic of its own',
    );
  });

  it('routes to the booking page with the exact mentor, segment and gig of the offer', () => {
    assert.match(page(), /mentorDetailPath\(\{/);
    assert.match(page(), /mentorId: offer\.mentorId/);
    assert.match(page(), /segmentSlug: offer\.segmentSlug/);
    assert.match(page(), /gigId: offer\.gigId/);
    assert.match(page(), /intent: 'book'/);
  });

  it('has no first-gig fallback anywhere', () => {
    // The regression this guards: a "Book a slot" that books `offers[0]`, or
    // fills a missing gigId from the first offer, silently books a session the
    // seeker did not choose.
    const source = page();
    assert.equal(/offers\[0\]|offers\.find\(|\.shift\(\)/.test(source), false);
    assert.equal(
      /gigId: offer\.gigId \?\? /.test(source),
      false,
      'a missing gigId must never be substituted from another offer',
    );
  });

  it('renders the fields the public projection actually carries', () => {
    const source = page();
    for (const field of [
      'mentor.fullName',
      'mentor.avatarUrl',
      'mentor.headline',
      'mentor.about',
      'mentor.languages',
      'mentor.expertise',
      'offer.segmentName',
      'offer.title',
      'offer.description',
      'offer.durationMinutes',
      'offer.priceInr',
    ]) {
      assert.ok(source.includes(field), `the profile should render ${field}`);
    }
  });

  it('shows experience years only for a real non-zero value', () => {
    assert.match(page(), /mentor\.experienceYears > 0/);
  });

  it('never renders a private, admin-only or moderation field', () => {
    const source = page();
    for (const forbidden of [
      'email',
      'phone',
      'internalNote',
      'internal_note',
      'accountStatus',
      'account_status',
      'suspended',
      'deactivated',
      'suspension',
      'payment',
      'bookingId',
    ]) {
      assert.equal(
        source.includes(forbidden),
        false,
        `the public profile must not read or render ${forbidden}`,
      );
    }
  });

  it('adds no product capability: no rating, reviews, social links or chat', () => {
    const source = page();
    for (const forbidden of [
      'review',
      'Review',
      'rating',
      'Rating',
      'youtube',
      'YouTube',
      'social',
      'Social',
      'website',
      'chat',
      'Chat',
    ]) {
      assert.equal(
        source.includes(forbidden),
        false,
        `the public profile must not introduce ${forbidden}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Behaviour on the booking page.
// ---------------------------------------------------------------------------

describe('profile never starts booking; book opens slot selection', () => {
  it('profile leaves no slot selected', () => {
    const detail = code(DETAIL_PAGE);
    assert.match(
      detail,
      /if \(intent === 'profile'\) return null;/,
      'a bare mentor-detail URL must not arm a time the seeker did not pick',
    );
  });

  it('book scrolls to the existing date/time selection', () => {
    const detail = code(DETAIL_PAGE);
    assert.match(detail, /if \(intent !== 'book' \|\| !mentorData\) return;/);
    assert.match(detail, /bookingPanelRef\.current\?\.scrollIntoView\(/);
    // Scrolling is presentation only. It must not select or reserve anything.
    assert.equal(
      /scrollIntoView[\s\S]{0,200}createBookingWithHold/.test(detail),
      false,
      'opening the booking panel must never create a hold',
    );
  });

  it('the reserve action is still an explicit click on the page', () => {
    // The 5-minute hold is created by `handleReserveSlot`, which only the
    // Reserve button calls. Neither the keyword nor the profile may wire to it.
    const detail = code(DETAIL_PAGE);
    const handlers = [...detail.matchAll(/onClick=\{handleReserveSlot\}/g)];
    assert.equal(handlers.length, 1, 'exactly one control reserves a slot');
    assert.equal(
      /intent === 'book'[\s\S]{0,120}handleReserveSlot\(\)/.test(detail),
      false,
      'the intent keyword must not trigger the RPC',
    );
    assert.equal(
      /createBookingWithHold/.test(code(PROFILE_PAGE)),
      false,
      'the profile must never create a booking or a hold',
    );
  });

  it('the gig still comes from the route, and is still forwarded to the server', () => {
    // The split is navigation only. The existing exact-gig contract is
    // untouched: the route's gigId is read, forwarded and re-validated.
    const detail = code(DETAIL_PAGE);
    assert.match(detail, /searchParams\.get\('gigId'\)/);
    assert.match(detail, /\{\s*gigId: paramGigId \|\| null\s*\}/);
    assert.match(detail, /searchParams\.get\('segmentSlug'\)/);
  });
});

// ---------------------------------------------------------------------------
// Nothing new was invented on the card.
// ---------------------------------------------------------------------------

describe('the card adds detail without adding a product capability', () => {
  it('renders no rating, review count or experience years beyond what it already did', () => {
    // These were already on the card, gated on real review counts. This test
    // pins that they were not made unconditional, and no new statistic joined
    // them: `session_count` is a stored counter with no computed meaning, and
    // the UI design system does not list it.
    const card = code(CARD);
    assert.match(card, /const hasRating = Number\(mentor\.review_count\) > 0/);
    assert.match(card, /\{hasRating && \(/);
    assert.equal(
      /mentor\.rating\s*\|\|\s*5/.test(card),
      false,
      'a missing rating must never be defaulted to 5.0',
    );
    assert.equal(
      /mentor\.session_count/.test(card),
      false,
      'session_count is a stored counter, not a published statistic',
    );
  });

  it('the next-available label is derived from a real slot or not shown at all', () => {
    const card = code(CARD);
    // The server returns generated slots; the card reads the earliest one. It
    // never formats a time the API did not send.
    assert.match(card, /const openSlots = \(mentor\.available_slots \|\| \[\]\)/);
    assert.match(card, /formatNextAvailableLabel\(/);
    assert.match(card, /formatLocalTimeLabel\(/);
    // No "available today" claim without a slot behind it.
    assert.equal(
      /Available today|available now/i.test(card),
      false,
      'the card must not claim availability the data does not carry',
    );
  });

  it('still shows only real fields, and holds no booking logic', () => {
    const card = code(CARD);
    for (const field of [
      'mentor.avatar_url',
      'mentor.full_name',
      'mentor.segment?.name',
      'gig.title',
      'gig.description',
      'gig.duration_minutes',
      'gig.price_inr',
    ]) {
      assert.ok(card.includes(field), `the card should still render ${field}`);
    }
    assert.equal(
      /slot_holds|createBookingHold|createBookingWithHold|payment/i.test(card),
      false,
      'no availability, hold or payment logic belongs in the card',
    );
  });

  it('the shared nav helper owns both route literals', () => {
    const nav = readSource('src/lib/mentorNav.ts');
    assert.match(nav, /MENTOR_DETAIL_ROUTE = '\/seeker\/mentor-detail'/);
    assert.match(nav, /MENTOR_PROFILE_ROUTE = '\/seeker\/mentor-profile'/);
  });
});
