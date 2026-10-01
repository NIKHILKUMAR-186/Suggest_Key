/**
 * THE GLOBAL DIRECTORY IS NOT AVAILABILITY DISCOVERY.
 *
 * Two mentor listings exist and they answer different questions:
 *
 *   /mentors            "who is on the platform?"   -> membership
 *   /seeker/mentors?... "who can I book on <date>?" -> availability-first
 *
 * They used to be conflated from the user's side: the segment landing page's
 * "See all mentors" called `mentorListPath`, so a seeker who read those words as
 * "show me every mentor" landed on a page that drops anyone without a free slot
 * on the selected date — and on a busy day that page says "0 mentors" while
 * approved, active mentors sit a click away.
 *
 * The rule this file pins down: membership is decided by approval and activity
 * ALONE. A date may change what a card SAYS. It may never change whether a card
 * EXISTS.
 *
 * Pure navigation logic is asserted directly. Wiring and query behaviour are
 * asserted at source level, which is how this suite already catches regressions
 * that only appear once the pieces are assembled.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  mentorDirectoryPath,
  mentorListPath,
  parseAvailabilityDateParam,
  segmentLandingPath,
} from '../src/lib/mentorNav';
import { pickBetterDirectoryAvailability } from '../src/lib/discoveryService';

function read(rel: string): string {
  return readFileSync(join(import.meta.dirname, '..', rel), 'utf8');
}

/** Strips comments so a source assertion cannot be satisfied by prose alone. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * The body of ONE function, bounded on both sides.
 *
 * A one-sided slice silently runs to the end of the file, which makes a "does
 * not contain X" assertion pass or fail for reasons that have nothing to do
 * with the function under test. `end` may be omitted ONLY for the last function
 * in a module, where end-of-file really is the boundary.
 */
function body(rel: string, start: string, end?: string): string {
  const source = code(rel);
  const from = source.indexOf(start);
  assert.ok(from > -1, `${start} not found in ${rel}`);
  const to = end === undefined ? source.length : source.indexOf(end, from + start.length);
  assert.ok(to > from, `${end} not found after ${start} in ${rel}`);
  return source.slice(from, to);
}

const SEGMENT_PAGE = 'src/components/seeker/SegmentExperiencePage.tsx';
const RENDERER = 'src/components/seeker/SegmentExperienceRenderer.tsx';
const DIRECTORY_PAGE = 'src/pages/seeker/MentorDirectoryPage.tsx';
const LIST_PAGE = 'src/pages/seeker/SeekerMentorListPage.tsx';
const CARD = 'src/components/seeker/MentorCard.tsx';
const SERVICE = 'src/lib/discoveryService.ts';

// ---------------------------------------------------------------------------
// A + B. Both "all mentors" CTAs mean the global directory
// ---------------------------------------------------------------------------

describe('"See all mentors" and "Browse every mentor" both open /mentors', () => {
  it('the shared helper resolves to the global directory route', () => {
    assert.equal(mentorDirectoryPath(), '/mentors');
    assert.equal(mentorDirectoryPath({}), '/mentors');
    assert.equal(mentorDirectoryPath({ segmentSlug: null }), '/mentors');
  });

  it('"See all mentors" calls the directory helper, not the availability-first one', () => {
    const source = code(SEGMENT_PAGE);
    assert.match(
      source,
      /onClick=\{\(\)\s*=>\s*navigate\(mentorDirectoryPath\(\{\s*segmentSlug\s*\}\)\)\}/,
      '"See all mentors" must navigate via mentorDirectoryPath'
    );
    assert.doesNotMatch(
      source,
      /mentorListPath/,
      'the segment landing page must not link to the availability-first list any more'
    );
  });

  it('"Browse every mentor" calls the same helper', () => {
    const source = code(RENDERER);
    assert.match(source, /Browse every mentor/);
    assert.match(
      source,
      /onClick=\{\(\)\s*=>\s*onNavigate\(mentorDirectoryPath\(\)\)\}/,
      '"Browse every mentor" must navigate via mentorDirectoryPath'
    );
    // A hardcoded literal would drift the moment the route moves.
    assert.doesNotMatch(source, /onNavigate\('\/mentors'\)/);
  });

  it('neither CTA leaks a date into the directory URL', () => {
    // The regression was not the target route; it was the date riding along and
    // turning a directory into a date filter. There is no parameter to pass one.
    assert.match(
      read('src/lib/mentorNav.ts'),
      /export function mentorDirectoryPath\(state: \{ segmentSlug\?: string \| null \} = \{\}\)/,
      'mentorDirectoryPath must not accept a date at all'
    );
  });
});

// ---------------------------------------------------------------------------
// C. The directory keeps the segment as a FILTER, never as a date filter
// ---------------------------------------------------------------------------

describe('the segment filter narrows membership without narrowing to availability', () => {
  it('a segment rides along so the directory opens pre-filtered', () => {
    assert.equal(
      mentorDirectoryPath({ segmentSlug: 'autism-mentor' }),
      '/mentors?segmentSlug=autism-mentor'
    );
    assert.equal(
      mentorDirectoryPath({ segmentSlug: 'relationship-advisor' }),
      '/mentors?segmentSlug=relationship-advisor'
    );
    assert.equal(
      mentorDirectoryPath({ segmentSlug: 'career-mentor' }),
      '/mentors?segmentSlug=career-mentor'
    );
  });

  it('an unusable slug is dropped rather than interpolated', () => {
    assert.equal(mentorDirectoryPath({ segmentSlug: 'autism mentor/../admin' }), '/mentors');
    assert.equal(mentorDirectoryPath({ segmentSlug: '  ' }), '/mentors');
    assert.equal(mentorDirectoryPath({ segmentSlug: '../../admin' }), '/mentors');
  });

  it('the directory query filters by segment membership, not by slots', () => {
    const fn = body(
      SERVICE,
      'export async function fetchAllMentors',
      'export async function fetchEligibleLanguages'
    );
    // The segment predicate is a mentor_segments join on the mentor's identity.
    assert.match(fn, /matchesSegment/);
    assert.match(fn, /ms\.mentor_id === mentorId && ms\.segment_id === query\.segmentId/);
    // And there is no slot call anywhere in the membership query. This is the
    // line that, if it ever comes back, re-fuses the two pages.
    assert.doesNotMatch(
      fn,
      /fetchMentorSlots/,
      'the membership query must never ask the slot engine who exists'
    );
  });

  it('the page never passes its availability date into the mentor query', () => {
    const source = code(DIRECTORY_PAGE);
    const loadMentors = source.slice(
      source.indexOf('const loadMentors'),
      source.indexOf('const loadAvailability')
    );
    assert.match(loadMentors, /const query: AllMentorsQuery/);
    assert.doesNotMatch(
      loadMentors,
      /availabilityDate/,
      'loadMentors must not be able to see the availability date'
    );
    // The date drives a separate, second fetch.
    assert.match(source, /fetchMentorDirectoryAvailability\(mentors, availabilityDate\)/);
  });
});

// ---------------------------------------------------------------------------
// D + E + F. Availability describes the card; it never removes it
// ---------------------------------------------------------------------------

describe('availability is a label on the card, not a membership condition', () => {
  it('the availability fetch cannot shorten the list', () => {
    // Last function in the module, so end-of-file is its real boundary.
    const fn = body(SERVICE, 'export async function fetchMentorDirectoryAvailability');
    assert.match(fn, /Promise<DirectoryAvailabilityResult>/);
    assert.match(fn, /byMentorId\.set/);
    assert.doesNotMatch(fn, /mentors\.filter|\.filter\(\(m\) => availableSlots/);
  });

  it('a mentor missing from the map is still rendered', () => {
    const source = code(DIRECTORY_PAGE);
    // `?? null` is the contract: an unknown answer yields a card with an
    // unresolved label, not an absent card.
    assert.match(
      source,
      /directoryAvailability=\{availability\.get\(mentor\.id\) \?\? null\}/
    );
    assert.doesNotMatch(
      source,
      /mentors\.filter\(\(m\) => availability\.has/,
      'the directory must never filter its own result set by availability'
    );
  });

  it('the three availability states are rendered as distinct copy', () => {
    const source = code(CARD);
    assert.match(source, /Available on /);
    assert.match(source, /No slots on /);
    // "No slot on this date" must never be dressed as a platform problem.
    assert.doesNotMatch(source, /badge-error[^\n]*No slots/);
  });

  it('a date is described as a slot fact, never as mentor availability', () => {
    const source = code(DIRECTORY_PAGE);
    // The empty-state copy no longer claims mentors are "currently available",
    // which on this page would falsely imply a date filter is in play.
    assert.match(source, /No mentors are currently listed/);
  });
});

// ---------------------------------------------------------------------------
// H. The three states of a mentor's date are kept apart
// ---------------------------------------------------------------------------

describe('"no slot" and "no answer" are different facts', () => {
  const base = {
    mentorId: 'm-1',
    availableCount: 0,
    nextLocalStartTime: null as string | null,
    segmentId: 's-1' as string | null,
    gigId: 'g-1' as string | null,
    generatedAt: '2026-10-01T00:00:00.000Z' as string | null,
  };

  it('any real slot beats none, regardless of the time', () => {
    const none = { ...base, state: 'none' as const };
    const late = { ...base, state: 'available' as const, availableCount: 1, nextLocalStartTime: '21:00' };
    assert.equal(pickBetterDirectoryAvailability(late, none)?.state, 'available');
    assert.equal(pickBetterDirectoryAvailability(none, late)?.state, 'available');
  });

  it('among real slots the earliest wins', () => {
    const early = { ...base, state: 'available' as const, availableCount: 3, nextLocalStartTime: '09:00' };
    const late = { ...base, state: 'available' as const, availableCount: 1, nextLocalStartTime: '20:00' };
    assert.equal(
      pickBetterDirectoryAvailability(late, early)?.nextLocalStartTime,
      '09:00'
    );
    assert.equal(
      pickBetterDirectoryAvailability(early, late)?.nextLocalStartTime,
      '09:00'
    );
  });

  it('two empty answers keep the first rather than inventing one', () => {
    const a = { ...base, state: 'none' as const };
    const b = { ...base, state: 'none' as const };
    assert.equal(pickBetterDirectoryAvailability(a, b), a);
    assert.equal(pickBetterDirectoryAvailability(null, b), b);
    assert.equal(pickBetterDirectoryAvailability(a, null), a);
    assert.equal(pickBetterDirectoryAvailability(null, null), null);
  });
});

// ---------------------------------------------------------------------------
// F + K. Booking is offered only against a real, server-generated slot
// ---------------------------------------------------------------------------

describe('a booking CTA appears only when the server found a real slot', () => {
  it('the CTA is gated on the availability state', () => {
    const source = code(CARD);
    assert.match(
      source,
      /const hasBookableSlot =\s*\n?\s*variant === 'availability' \? true : directoryAvailability\?\.state === 'available'/
    );
    assert.match(source, /\{hasBookableSlot \? \(/);
  });

  it('no slot means "Choose another date", not a dead booking button', () => {
    const source = code(CARD);
    assert.match(source, /Choose another date/);
    // Both branches lead somewhere real: the profile re-validates server-side.
    assert.match(source, /onClick=\{\(\) => navigate\(profilePath\)\}/);
  });

  it('availability is read from the server endpoint, never computed in the browser', () => {
    const fn = body(SERVICE, 'export async function fetchMentorDirectoryAvailability');
    assert.match(fn, /fetchMentorSlots\(/);
    assert.match(fn, /slots \|\| \[\]\)\.filter\(\(s\) => s\.is_available\)/);
    // Nothing here may look at the browser clock.
    assert.doesNotMatch(fn, /Date\.now|new Date\(\)/);
  });

  it('the directory reuses the shared realtime availability hook', () => {
    const source = code(DIRECTORY_PAGE);
    assert.match(source, /useAvailabilitySync\(/);
    assert.match(source, /onInvalidate: loadAvailability/);
    // Same hook as mentor detail and the segment grid, not a private timer.
    assert.doesNotMatch(source, /setInterval\(/);
  });
});

// ---------------------------------------------------------------------------
// G + H. Eligibility is unchanged, and not relaxed to make cards appear
// ---------------------------------------------------------------------------

describe('only approved and active mentors are ever in the directory', () => {
  it('all three eligibility predicates are still applied', () => {
    const fn = body(
      SERVICE,
      'export async function fetchAllMentors',
      'export async function fetchEligibleLanguages'
    );
    assert.match(fn, /\.eq\('is_approved', true\)/);
    assert.match(fn, /\.eq\('is_active', true\)/);
    assert.match(fn, /\.eq\('approval_status', 'approved'\)/);
    // The shared account-state rule removes suspended and deactivated mentors.
    assert.match(fn, /isMentorEligible\(r, nowMs\)/);
    assert.match(fn, /\.filter\(\(r: any\) => isMentorEligible\(r, nowMs\)\)/);
  });

  it('the visibility of a suspended mentor is not time-of-day dependent', () => {
    // The only time input to the membership query is the suspension window, and
    // it is read from the database, never from a slot count.
    const source = code(SERVICE);
    const fn = source.slice(source.indexOf('function isMentorEligible'));
    assert.match(fn, /deriveAccountState\(/);
    assert.match(fn, /canPerformOperationalActions/);
  });
});

// ---------------------------------------------------------------------------
// I + 9. The availability-first page stays exactly that
// ---------------------------------------------------------------------------

describe('/seeker/mentors keeps its own, different contract', () => {
  it('it is still the availability-first route with its segment and date', () => {
    assert.equal(
      mentorListPath({ segmentSlug: 'autism-mentor', date: '2026-10-02' }),
      '/seeker/mentors?segmentSlug=autism-mentor&date=2026-10-02'
    );
    assert.equal(mentorListPath({}), '/seeker/mentors');
  });

  it('it is NOT redirected into the directory, and Back is untouched', () => {
    // Back must still return to the segment landing page, not to /mentors.
    assert.equal(
      segmentLandingPath({ segmentSlug: 'autism-mentor', date: '2026-10-02' }),
      '/seeker?segment=autism-mentor&date=2026-10-02'
    );
    const source = code(LIST_PAGE);
    assert.match(source, /segmentLandingPath\(/);
    assert.match(source, /Back to \$\{selectedSegment\.name\}/);
  });

  it('it says out loud that it only lists mentors bookable on the day', () => {
    const source = code(LIST_PAGE);
    assert.match(source, /Mentors you can book on the day you pick/);
    // And offers the directory as a separate, explicit choice.
    assert.match(source, /Browse all mentors/);
  });

  it('the directory offers the filtered page rather than becoming it', () => {
    const source = code(DIRECTORY_PAGE);
    assert.match(source, /See mentors available on that day/);
    assert.match(source, /mentorListPath\(/);
  });
});

// ---------------------------------------------------------------------------
// 7. A date parameter describes; it never filters
// ---------------------------------------------------------------------------

describe('a date parameter is display-only', () => {
  it('a real calendar date is accepted, because a shared link may carry one', () => {
    assert.equal(parseAvailabilityDateParam('2026-10-02'), '2026-10-02');
  });

  it('a malformed or impossible date is discarded, not forwarded', () => {
    for (const bad of ['tomorrow', '2026-10', '2026-13-01', '2026-02-31', '', '  ', '../../admin']) {
      assert.equal(parseAvailabilityDateParam(bad), null, `${bad} must not parse`);
    }
    assert.equal(parseAvailabilityDateParam(null), null);
    assert.equal(parseAvailabilityDateParam(undefined), null);
  });

  it('the page reads the param for the label and falls back to today', () => {
    const source = code(DIRECTORY_PAGE);
    assert.match(source, /parseAvailabilityDateParam\(searchParams\.get\('date'\)\)/);
    assert.match(source, /useState<string>\(paramDate \|\| today\)/);
    assert.match(source, /getDateStringInTimezone\(new Date\(\), userTimezone\)/);
  });

  it('the stepper changes the described day and nothing else', () => {
    const source = code(DIRECTORY_PAGE);
    assert.match(source, /addDaysToDateString\(current, days\)/);
    // The copy has to say so, because a date control above a list reads as a
    // filter to everyone who sees it.
    assert.match(source, /This changes the date only\. Every approved and active mentor stays listed\./);
  });
});