/**
 * The segment-context invariant for seeker discovery -> mentor detail -> booking.
 *
 * # The bug these tests exist for
 *
 * A seeker opened a mentor from the "Autism Mentor" segment. The URL carried
 * `segmentSlug=autism-mentor`. The page rendered that mentor's "Relationship
 * Guidance session" gig. Nothing errored, no request failed, and the UI looked
 * completely normal — the only way to notice was to already know that mentor had
 * gigs in two segments.
 *
 * The cause was a gig lookup that matched on `mentor_id` alone. A gig belongs
 * to exactly one segment through `gigs.segment_id`, and a mentor may hold one
 * active gig per segment, so "the mentor's first active gig" and "the gig for
 * the selected segment" are different things as soon as a mentor has more than
 * one. The lookup returned whichever row the database listed first and the rest
 * of the page — duration, price, slot grid, and the booking it created — all
 * inherited that choice.
 *
 * # Why the tests are shaped this way
 *
 * The relationships are identity-based: a gig's segment is a column, not a
 * label. So the fixtures use two segments and two gigs with the same mentor and
 * deliberately inverted ids, which means a check that quietly compared the
 * wrong pair of columns would still fail here rather than pass by luck.
 *
 * No test names a real segment slug or id. If the fix were ever "hardcode
 * Autism Mentor", these would still pass while the product was broken for every
 * other segment, so there is an explicit test for that.
 *
 * The last group asserts on SOURCE rather than behaviour. It is the only way to
 * prove a route still forwards a `gigId` and that the booking route still
 * validates the triple: both are a single expression that typechecking accepts
 * whether or not the surrounding guard exists, and both are exactly the kind of
 * line a later refactor drops without complaint.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  describeGigContextMismatch,
  describeBookingContextMismatch,
  GIG_CONTEXT_ERROR_MESSAGE,
  type GigContext,
} from '../src/lib/gigContext';
import { generateMentorSlots } from '../src/lib/slotEngine';
import type { MentorAvailability } from '../src/types/database';

const readSource = (relative: string) =>
  readFileSync(join(import.meta.dirname, '..', relative), 'utf8');

/** Strips comments so prose in a docblock cannot satisfy or break a check. */
const code = (relative: string) =>
  readSource(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

// ---------------------------------------------------------------------------
// Fixtures
//
// Two segments, two gigs, ONE mentor holding both. The ids are chosen so that
// `MENTOR_ID` is not a prefix of either gig id and the segment ids are not
// interchangeable, which catches a comparison that accidentally reads the wrong
// column.
// ---------------------------------------------------------------------------

const MENTOR_ID = 'mentor-aaaa';
const OTHER_MENTOR_ID = 'mentor-bbbb';

/** Stands in for the Autism segment. Named only in the test vocabulary. */
const SEGMENT_A = 'segment-1111';
/** Stands in for the Relationship segment. */
const SEGMENT_B = 'segment-2222';

const GIG_A = 'gig-aaaa'; // belongs to SEGMENT_A
const GIG_B = 'gig-bbbb'; // belongs to SEGMENT_B

const gigA: GigContext = {
  id: GIG_A,
  mentor_id: MENTOR_ID,
  segment_id: SEGMENT_A,
  is_active: true,
};

const gigB: GigContext = {
  id: GIG_B,
  mentor_id: MENTOR_ID,
  segment_id: SEGMENT_B,
  is_active: true,
};

// ---------------------------------------------------------------------------
// The matching cases: the right gig is found for the right segment.
// ---------------------------------------------------------------------------

describe('a matching segment resolves its own gig', () => {
  it('segment A + gig A is accepted', () => {
    assert.equal(
      describeGigContextMismatch({
        gig: gigA,
        mentorId: MENTOR_ID,
        segmentId: SEGMENT_A,
        requestedGigId: GIG_A,
      }),
      null
    );
  });

  it('segment B + gig B is accepted', () => {
    assert.equal(
      describeGigContextMismatch({
        gig: gigB,
        mentorId: MENTOR_ID,
        segmentId: SEGMENT_B,
        requestedGigId: GIG_B,
      }),
      null
    );
  });

  it('a route with no gigId still resolves correctly by segment alone', () => {
    // The older discovery cards link with only mentorId + segmentSlug. That path
    // must keep working, so a gig that matches the segment is accepted even
    // when the caller named no gig.
    assert.equal(
      describeGigContextMismatch({
        gig: gigA,
        mentorId: MENTOR_ID,
        segmentId: SEGMENT_A,
        requestedGigId: null,
      }),
      null
    );
  });
});

// ---------------------------------------------------------------------------
// The regression: the wrong gig is never displayed under the right segment.
// ---------------------------------------------------------------------------

describe('a gig from another segment is rejected, never displayed', () => {
  it('segment A + gig B is rejected (the reported bug)', () => {
    // This is the exact observed failure: the Autism segment context resolved
    // the Relationship gig. The guard must refuse it.
    const reason = describeGigContextMismatch({
      gig: gigB,
      mentorId: MENTOR_ID,
      segmentId: SEGMENT_A,
      requestedGigId: null,
    });
    assert.notEqual(reason, null, 'a cross-segment gig must be rejected');
    assert.match(reason as string, new RegExp(SEGMENT_B));
  });

  it('segment A + an explicitly requested gig B is rejected', () => {
    // Stronger: the route NAMED gig B, so substituting gig A would also be
    // wrong. Both the gigId and the segment must agree.
    const reason = describeGigContextMismatch({
      gig: gigB,
      mentorId: MENTOR_ID,
      segmentId: SEGMENT_A,
      requestedGigId: GIG_B,
    });
    assert.notEqual(reason, null, 'a cross-segment gig must be rejected');
  });

  it('a gigId from another segment is rejected even when the segment agrees', () => {
    // Reverse direction: the caller asked for the Relationship gig while in the
    // Relationship segment, but the resolver handed back the Autism gig.
    const reason = describeGigContextMismatch({
      gig: gigA,
      mentorId: MENTOR_ID,
      segmentId: SEGMENT_B,
      requestedGigId: GIG_B,
    });
    assert.notEqual(reason, null, 'a mismatched gigId must be rejected');
    assert.match(reason as string, new RegExp(GIG_A));
  });

  it('a gig belonging to a different mentor is rejected', () => {
    const foreignGig: GigContext = { ...gigA, mentor_id: OTHER_MENTOR_ID };
    assert.notEqual(
      describeGigContextMismatch({
        gig: foreignGig,
        mentorId: MENTOR_ID,
        segmentId: SEGMENT_A,
        requestedGigId: GIG_A,
      }),
      null
    );
  });

  it('an inactive gig is rejected', () => {
    const archivedGig: GigContext = { ...gigA, is_active: false };
    assert.notEqual(
      describeGigContextMismatch({
        gig: archivedGig,
        mentorId: MENTOR_ID,
        segmentId: SEGMENT_A,
        requestedGigId: GIG_A,
      }),
      null
    );
  });

  it('a mentor with no gig in the segment is rejected rather than defaulted', () => {
    // The "no gig here" case must not fall back to the mentor's other gig.
    assert.notEqual(
      describeGigContextMismatch({
        gig: null,
        mentorId: MENTOR_ID,
        segmentId: SEGMENT_A,
        requestedGigId: null,
      }),
      null
    );
  });

  it('the rejection message does not name a specific segment', () => {
    // Guards against the "fix" of hardcoding a segment into the error copy.
    const lowered = GIG_CONTEXT_ERROR_MESSAGE.toLowerCase();
    for (const forbidden of ['autism', 'relationship', 'career', 'mentor-mentor']) {
      assert.ok(
        !lowered.includes(forbidden),
        `the shared error message must stay segment-agnostic, found "${forbidden}"`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The booking triple: what actually gets persisted.
// ---------------------------------------------------------------------------

describe('a booking is created from one consistent gig/segment pair', () => {
  it('an Autism-context booking stores the Autism gig and Autism segment', () => {
    assert.equal(
      describeBookingContextMismatch({
        gig: gigA,
        mentorId: MENTOR_ID,
        segmentId: SEGMENT_A,
        gigId: GIG_A,
      }),
      null
    );
  });

  it('a Relationship-context booking stores the Relationship gig and segment', () => {
    assert.equal(
      describeBookingContextMismatch({
        gig: gigB,
        mentorId: MENTOR_ID,
        segmentId: SEGMENT_B,
        gigId: GIG_B,
      }),
      null
    );
  });

  it('an Autism segment with a Relationship gig id is rejected', () => {
    // The write-side half of the bug: without this, a booking row would carry an
    // Autism segment_id alongside a Relationship gig_id and the booking detail
    // page would then contradict the mentor detail page.
    assert.notEqual(
      describeBookingContextMismatch({
        gig: gigB,
        mentorId: MENTOR_ID,
        segmentId: SEGMENT_A,
        gigId: GIG_B,
      }),
      null
    );
  });

  it('a Relationship segment with an Autism gig id is rejected', () => {
    assert.notEqual(
      describeBookingContextMismatch({
        gig: gigA,
        mentorId: MENTOR_ID,
        segmentId: SEGMENT_B,
        gigId: GIG_A,
      }),
      null
    );
  });

  it('a missing, foreign or inactive gig is rejected', () => {
    const base = { mentorId: MENTOR_ID, segmentId: SEGMENT_A, gigId: GIG_A };
    assert.notEqual(describeBookingContextMismatch({ ...base, gig: null }), null);
    assert.notEqual(
      describeBookingContextMismatch({
        ...base,
        gig: { ...gigA, mentor_id: OTHER_MENTOR_ID },
      }),
      null
    );
    assert.notEqual(
      describeBookingContextMismatch({ ...base, gig: { ...gigA, is_active: false } }),
      null
    );
  });
});

// ---------------------------------------------------------------------------
// Source-level guards.
//
// Each of these is a single expression that typechecks whether or not the guard
// around it exists, and each is exactly the kind of line a later refactor drops
// without complaint. Behavioural tests cannot cover them without a live
// database, so they are asserted against the source instead.
// ---------------------------------------------------------------------------

const DISCOVERY = 'src/lib/discoveryService.ts';
const DETAIL_PAGE = 'src/pages/seeker/SeekerMentorDetailPage.tsx';
const SERVER = 'server.ts';
const MIGRATION = 'supabase/migrations/20261003500000_phase31_gig_segment_invariant.sql';

describe('the client sends the whole context, not a subset', () => {
  it('forwards gigId to the slot endpoint alongside mentor and segment', () => {
    const src = code(DISCOVERY);
    assert.match(src, /params\.set\('mentorId', query\.mentorId\)/);
    assert.match(src, /params\.set\('segmentId', query\.segmentId\)/);
    assert.match(
      src,
      /params\.set\('gigId', query\.gigId\)/,
      'the gigId must reach the server, or the server cannot honour the choice'
    );
  });

  it('never picks one scope parameter instead of the others', () => {
    // The original defect: `'mentorId' in query ? mentorId : segmentId`, which
    // silently dropped the segment whenever a mentor was also named.
    const src = code(DISCOVERY);
    assert.doesNotMatch(src, /'mentorId' in query/);
    assert.doesNotMatch(src, /else\s*\{\s*params\.set\('segmentId'/);
  });

  it('passes the route gigId into the detail fetch', () => {
    const src = code(DETAIL_PAGE);
    assert.match(src, /searchParams\.get\('gigId'\)/);
    assert.match(
      src,
      /\{\s*gigId: paramGigId \|\| null\s*\}/,
      'the detail page must forward the route gigId to fetchMentorDetail'
    );
  });

  it('verifies the resolved gig through the shared guard', () => {
    const src = code(DISCOVERY);
    assert.match(src, /describeGigContextMismatch\(\{/);
    // The old shape silently returned a mentor with no gig.
    assert.doesNotMatch(src, /if \(!slotResult\.gig\) \{\s*return \{ mentor: null, error: null \}/);
  });
});

describe('the server resolves the exact gig and never falls back', () => {
  it('accepts a gigId on the slot endpoint', () => {
    const src = code(SERVER);
    assert.match(src, /const \{ mentorId, segmentId, gigId, date \}/);
    assert.match(src, /gigId: gigIdRaw \|\| undefined/);
  });

  it('does not reject mentorId and segmentId as mutually exclusive', () => {
    // This 400 was the reason the browser had to drop one of the two ids, which
    // is what left the server unable to narrow the gig by segment.
    const src = code(SERVER);
    assert.doesNotMatch(src, /not both/);
  });

  it('resolves an explicit gigId, or the segment gig, but never a bare first gig', () => {
    const src = code(SERVER);
    // A gig with no segment context must resolve to nothing, not to the first row.
    assert.match(src, /\} else if \(segmentId\) \{/);
    assert.doesNotMatch(
      src,
      /activeGigs\.find\(\s*\(g: any\) => g\.mentor_id === mentorId\s*\)/,
      'matching on mentor_id alone is the original defect'
    );
  });

  it('validates the booking triple before the RPC writes a row', () => {
    const src = code(SERVER);
    assert.match(src, /describeBookingContextMismatch\(\{/);
    // The gig must be read from the database first, then handed to the guard.
    // Ordering matters: validating an id against itself proves nothing.
    const read = src.indexOf(".from('gigs')");
    const guard = src.indexOf('describeBookingContextMismatch({');
    assert.ok(read !== -1, 'the booking route must read the gig row');
    assert.ok(guard !== -1, 'the booking route must run the shared guard');
    assert.ok(
      read < guard,
      'the gig row must be fetched before it is validated against the triple'
    );
  });
});

describe('the database function enforces the same invariant', () => {
  it('compares the gig segment against the requested segment', () => {
    const sql = readSource(MIGRATION);
    assert.match(
      sql,
      /v_gig\.segment_id <> p_segment_id/,
      'the RPC must reject a gig from a different segment'
    );
    assert.match(sql, /v_gig\.mentor_id <> p_mentor_id/);
    assert.match(sql, /NOT v_gig\.is_active/);
  });

  it('does not derive the booking segment from the gig or from a default', () => {
    const sql = readSource(MIGRATION);
    // The booking row must store the validated argument, not a repaired value.
    assert.match(
      sql,
      /p_mentor_id, p_seeker_id, v_gig\.id, p_segment_id/,
      'the booking must store gig.id with the validated p_segment_id'
    );
    assert.doesNotMatch(sql, /p_segment_id := v_gig\.segment_id/);
  });

  it('sorts after the migration that dropped the check, and before the containment revoke', () => {
    // Two ordering constraints, and getting either wrong is silent:
    //
    //  - Phase 26 replaced the whole function and dropped phase 18's segment
    //    predicate. Sorting before it means the fix is overwritten and the
    //    booking endpoint accepts mismatched combinations again.
    //  - Phase 29 revokes EXECUTE from anon/PUBLIC on every function. Sorting
    //    after it and re-granting is harmless, but the containment migration is
    //    expected to be the security authority, so this one stays before it.
    const invariant = MIGRATION;
    const phase26 = 'supabase/migrations/20260928000000_phase26_hold_duration_5min.sql';
    const phase29 = 'supabase/migrations/20261004000000_phase29_security_definer_execute_containment.sql';
    assert.ok(
      invariant > phase26,
      'the invariant migration must be applied after the one that dropped the check'
    );
    assert.ok(
      invariant < phase29,
      'the invariant migration must not land after the security containment revoke'
    );
  });
});

// ---------------------------------------------------------------------------
// Slot generation follows the SELECTED gig's duration.
//
// The slot grid is built from `gig.duration_minutes`, so a mentor whose gigs
// differ in length produces different grids per segment. Availability stays
// mentor-wide, which is the existing rule and must not change: the window comes
// from `mentor_availability`, never from the gig.
// ---------------------------------------------------------------------------

describe('slots are generated from the selected gig duration', () => {
  // The window belongs to the MENTOR, not to a gig. That is the existing global
  // availability rule and this fix does not change it: only the slice length
  // varies, and it varies with the gig that was selected.
  const availability: MentorAvailability[] = [
    {
      id: 'avail-1',
      mentor_id: MENTOR_ID,
      day_of_week: 4, // 2026-10-08 is a Thursday
      start_time: '10:00',
      end_time: '14:00',
      timezone: 'Asia/Kolkata',
      is_enabled: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ];
  const NOW = new Date('2026-10-01T00:00:00Z');
  const DATE = '2026-10-08';

  const grid = (gigId: string, durationMinutes: number) =>
    generateMentorSlots({
      mentorId: MENTOR_ID,
      gigId,
      dateStr: DATE,
      timezone: 'Asia/Kolkata',
      durationMinutes,
      recurringAvailability: availability,
      exceptions: [],
      bookings: [],
      slotHolds: [],
      currentUtcTime: NOW,
    });

  it('a 30-minute gig yields a 30-minute grid', () => {
    const slots = grid(GIG_A, 30);
    assert.ok(slots.length > 0, 'the shared 4-hour window must produce slots');
    for (const slot of slots) {
      assert.equal(slot.duration_minutes, 30);
      assert.equal(slot.gig_id, GIG_A, 'every slot is stamped with the selected gig');
    }
  });

  it('a 60-minute gig on the same mentor yields a 60-minute grid', () => {
    // Same mentor, same window, different segment gig: the grid must follow the
    // gig, not the mentor and not a hardcoded default.
    const slots = grid(GIG_B, 60);
    assert.ok(slots.length > 0);
    for (const slot of slots) {
      assert.equal(slot.duration_minutes, 60);
      assert.equal(slot.gig_id, GIG_B);
    }
  });

  it('reserves are mentor-wide: a booking on gig A blocks gig B slots too', () => {
    // The existing global-availability rule, preserved deliberately. A seeker
    // holding 12:00-13:00 on the Autism gig must not be able to double-book
    // 12:00-13:00 on the Relationship gig.
    const blocked = generateMentorSlots({
      mentorId: MENTOR_ID,
      gigId: GIG_B,
      dateStr: DATE,
      timezone: 'Asia/Kolkata',
      durationMinutes: 60,
      recurringAvailability: availability,
      exceptions: [],
      bookings: [
        {
          id: 'b1',
          mentor_id: MENTOR_ID,
          seeker_id: 'seeker-1',
          gig_id: GIG_A,
          segment_id: SEGMENT_A,
          start_time: '2026-10-08T06:30:00.000Z', // 12:00 IST
          end_time: '2026-10-08T07:30:00.000Z', // 13:00 IST
          status: 'CONFIRMED',
        } as any,
      ],
      slotHolds: [],
      currentUtcTime: NOW,
    });

    const overlapping = blocked.filter(
      (s) =>
        new Date(s.utc_start_time).getTime() < new Date('2026-10-08T07:30:00.000Z').getTime() &&
        new Date(s.utc_end_time).getTime() > new Date('2026-10-08T06:30:00.000Z').getTime()
    );
    assert.ok(overlapping.length > 0, 'the fixture must actually overlap');
    for (const slot of overlapping) {
      assert.equal(slot.is_available, false, 'a cross-gig booking must still block the slot');
    }
  });
});

