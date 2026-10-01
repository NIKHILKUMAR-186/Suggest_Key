/**
 * REGRESSION: the mentor workspace refused a fully consistent booking.
 *
 * THE REPORTED SYMPTOM
 * --------------------
 * BK-2609301941-3937 / 63a2196b-... "Best autism mentor", segment "Autism
 * Mentor" rendered "This booking lists a segment that does not match its own
 * gig, so its workspace cannot be edited or published until it is repaired."
 *
 * THE ROW WAS NOT INCONSISTENT. Traced live:
 *
 *   booking.segment_id = 00000000-0000-0000-0000-000000000002
 *   gig.segment_id     = 00000000-0000-0000-0000-000000000002   <- equal
 *   booking.mentor_id  = a8222dcd-...
 *   gig.mentor_id      = a8222dcd-...                            <- equal
 *
 * The first incorrect link in the chain was the SELECT: the booking detail
 * projections joined `gig:gigs(id, title, ... segment_id)` WITHOUT
 * `gigs.mentor_id`. `evaluateBookingOfferIdentity` compares
 * `booking.gig.mentor_id === booking.mentor_id`, so `undefined !== mentorId`
 * made `mentorConsistent` false for EVERY booking, and the page reported a
 * segment mismatch that did not exist.
 *
 * These tests pin the predicate (T1, T2) and the projection that feeds it
 * (T3-T5, T10), so a projection that drops the compared column fails here
 * rather than in a mentor's face.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  bookingMatchesRequestedId,
  evaluateBookingOfferIdentity,
  isWorkspaceVisibleTo,
  resolveRequestedBookingId,
  resolveWorkspaceView,
  workspaceBelongsToBooking,
  type BookingIdentity,
  type WorkspaceIdentity,
} from '../src/lib/workspaceIdentity';

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), 'utf8');

// The reported booking, as it exists in the database.
const MENTOR = 'a8222dcd-6124-4ade-9c2a-8d226d16e632';
const OTHER_MENTOR = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const SEEKER = '1fe5cc5d-7b36-401d-ade3-ec7a3d763a4c';

const SEGMENT = '00000000-0000-0000-0000-000000000002';
const OTHER_SEGMENT = '00000000-0000-0000-0000-000000000001';

const GIG: NonNullable<BookingIdentity['gig']> = {
  id: '8c8bf8a1-8a02-4a36-82a4-3328e86cb696',
  mentor_id: MENTOR,
  segment_id: SEGMENT,
};

const BOOKING: BookingIdentity = {
  id: '63a2196b-f3a0-4665-981d-9ce02d71264b',
  booking_code: 'BK-2609301941-3937',
  mentor_id: MENTOR,
  seeker_id: SEEKER,
  gig_id: GIG.id,
  segment_id: SEGMENT,
  gig: GIG,
};

/** A second booking by the same mentor, used to prove IDs never cross over. */
const OTHER_BOOKING: BookingIdentity = {
  id: '78675ba2-d344-4859-b1a2-13a5527c784e',
  booking_code: 'BK-2609262151-7763',
  mentor_id: MENTOR,
  seeker_id: SEEKER,
  gig_id: GIG.id,
  segment_id: OTHER_SEGMENT,
  gig: { ...GIG, segment_id: OTHER_SEGMENT },
};

const stripJsComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// ---------------------------------------------------------------------------
// T1 / T2: the predicate. Consistent opens; inconsistent refuses.
// ---------------------------------------------------------------------------

describe('T1/T2 the offer-identity verdict follows the joined gig', () => {
  it('T1 a booking whose segment equals its gig segment is verified, not broken', () => {
    const verdict = evaluateBookingOfferIdentity(BOOKING);
    assert.equal(verdict.unverified, false);
    assert.equal(verdict.segmentConsistent, true);
    assert.equal(verdict.mentorConsistent, true);
    assert.equal(
      resolveWorkspaceView({
        requestedId: BOOKING.id,
        booking: BOOKING,
        workspace: null,
        viewer: { userId: MENTOR, role: 'mentor' },
      }),
      'NOT_STARTED',
      'a valid booking with no workspace row must open the editor'
    );
  });

  it('T2 a booking whose segment differs from its gig segment is refused', () => {
    const broken: BookingIdentity = { ...BOOKING, segment_id: OTHER_SEGMENT };
    const verdict = evaluateBookingOfferIdentity(broken);
    assert.equal(verdict.segmentConsistent, false);
    assert.equal(
      resolveWorkspaceView({
        requestedId: broken.id,
        booking: broken,
        workspace: null,
        viewer: { userId: MENTOR, role: 'mentor' },
      }),
      'OFFER_MISMATCH'
    );
  });

  it('T2 a gig owned by another mentor is refused even when the segment agrees', () => {
    const broken: BookingIdentity = { ...BOOKING, gig: { ...GIG, mentor_id: OTHER_MENTOR } };
    assert.equal(evaluateBookingOfferIdentity(broken).mentorConsistent, false);
  });

  it('a gig that was never joined is unverified, never asserted broken', () => {
    assert.equal(evaluateBookingOfferIdentity({ ...BOOKING, gig: null }).unverified, true);
  });
});

// ---------------------------------------------------------------------------
// T3 / T4 / T5: identifier discipline. bookingId is never a booking_code.
// ---------------------------------------------------------------------------

describe('T3/T4/T5 the requested booking is the booking that renders', () => {
  it('T3 the UUID in the URL resolves to this booking and no other', () => {
    assert.equal(
      resolveRequestedBookingId(`/mentor/workspace?bookingId=${BOOKING.id}`, ''),
      BOOKING.id
    );
    assert.equal(bookingMatchesRequestedId(BOOKING, BOOKING.id), true);
  });

  it('T4 a different booking UUID yields a different session', () => {
    assert.equal(bookingMatchesRequestedId(BOOKING, OTHER_BOOKING.id), false);
    assert.equal(bookingMatchesRequestedId(OTHER_BOOKING, OTHER_BOOKING.id), true);
    // Each request names its own workspace: A's row is never B's row, and B's
    // row is never visible from A's URL.
    const rowA: WorkspaceIdentity = {
      id: 'ws-a',
      booking_id: BOOKING.id,
      mentor_id: MENTOR,
      seeker_id: SEEKER,
      status: 'PUBLISHED',
    };
    assert.equal(workspaceBelongsToBooking(rowA, BOOKING), true);
    assert.equal(workspaceBelongsToBooking(rowA, OTHER_BOOKING), false);
    assert.equal(
      resolveWorkspaceView({
        requestedId: OTHER_BOOKING.id,
        booking: OTHER_BOOKING,
        workspace: rowA,
        viewer: { userId: MENTOR, role: 'mentor' },
      }),
      'WORKSPACE_PARTICIPANT_MISMATCH'
    );
  });

  it('T5 a booking code passed as bookingId resolves to itself only, never another booking', () => {
    assert.equal(bookingMatchesRequestedId(BOOKING, BOOKING.booking_code), true);
    assert.equal(bookingMatchesRequestedId(OTHER_BOOKING, BOOKING.booking_code), false);
  });

  it('T5 a hostile bookingId never reaches a filter', () => {
    for (const hostile of [
      'x,id.neq.00000000-0000-0000-0000-000000000000',
      "1' OR '1'='1",
      '<script>',
    ]) {
      assert.equal(
        resolveRequestedBookingId(`/mentor/workspace?bookingId=${encodeURIComponent(hostile)}`, ''),
        '',
        `must reject ${hostile.slice(0, 24)}`
      );
    }
  });

  it('T3 the mentor page still refuses to publish a booking the URL does not name', () => {
    assert.equal(bookingMatchesRequestedId(BOOKING, OTHER_BOOKING.id), false);
    assert.match(
      read('src/pages/mentor/MentorWorkspacePage.tsx'),
      /!bookingMatchesRequestedId\(booking, queryBookingId\)/
    );
  });
});

// ---------------------------------------------------------------------------
// T6 / T7: authorization. Ownership is decided by the booking row.
// ---------------------------------------------------------------------------

describe('T6/T7 workspace authorization follows the booking participants', () => {
  const published: WorkspaceIdentity = {
    id: 'ws-1',
    booking_id: BOOKING.id,
    mentor_id: MENTOR,
    seeker_id: SEEKER,
    status: 'PUBLISHED',
  };

  it('T6 the mentor of the booking owns the workspace', () => {
    assert.equal(isWorkspaceVisibleTo(published, { userId: MENTOR, role: 'mentor' }), true);
    assert.equal(
      isWorkspaceVisibleTo(published, { userId: OTHER_MENTOR, role: 'mentor' }),
      false,
      'another mentor must not read it, by URL or otherwise'
    );
  });

  it('T6 another mentor\'s booking is refused by ownership, not by luck', () => {
    assert.equal(
      workspaceBelongsToBooking({ ...published, booking_id: OTHER_BOOKING.id }, BOOKING),
      false
    );
  });

  it('T7 a seeker never holds the mentor editor role', () => {
    // The seeker is a participant, so the READ is allowed - but the write path
    // takes `roles` from the token and only a mentor/admin may author. There is
    // no code path here that grants a seeker the editor.
    assert.equal(
      isWorkspaceVisibleTo({ ...published, status: 'PENDING' }, { userId: SEEKER, role: 'seeker' }),
      false
    );
    const server = read('server.ts');
    const post = server.slice(
      server.indexOf('POST /api/workspaces:'),
      server.indexOf('GET /api/admin/workspaces')
    );
    assert.doesNotMatch(post, /req\.body\.[a-zA-Z]*[Mm]entorId/);
    assert.doesNotMatch(post, /req\.body\.[a-zA-Z]*[Ss]eekerId/);
  });
});

// ---------------------------------------------------------------------------
// T8 / T9: publish semantics are unchanged by this fix.
// ---------------------------------------------------------------------------

describe('T8/T9 published is readable, pending is withheld', () => {
  const row: WorkspaceIdentity = {
    id: 'ws-1',
    booking_id: BOOKING.id,
    mentor_id: MENTOR,
    seeker_id: SEEKER,
    status: 'PUBLISHED',
  };

  it('T8 the seeker reads a published workspace', () => {
    assert.equal(isWorkspaceVisibleTo(row, { userId: SEEKER, role: 'seeker' }), true);
    assert.equal(
      resolveWorkspaceView({
        requestedId: BOOKING.id,
        booking: BOOKING,
        workspace: row,
        viewer: { userId: SEEKER, role: 'seeker' },
      }),
      'OK'
    );
  });

  it('T9 an unpublished workspace is withheld from the seeker but not the mentor', () => {
    const draft = { ...row, status: 'PENDING' };
    assert.equal(isWorkspaceVisibleTo(draft, { userId: SEEKER, role: 'seeker' }), false);
    assert.equal(isWorkspaceVisibleTo(draft, { userId: MENTOR, role: 'mentor' }), true);
    assert.equal(
      resolveWorkspaceView({
        requestedId: BOOKING.id,
        booking: BOOKING,
        workspace: draft,
        viewer: { userId: SEEKER, role: 'seeker' },
      }),
      'PENDING'
    );
  });

  it('the database predicate that enforces it is untouched', () => {
    const phase10 = read('supabase/migrations/20260921000001_phase10_session_workspace.sql');
    assert.match(phase10, /seeker_id\s*=\s*auth\.uid\(\)\s+AND\s+status\s*=\s*'PUBLISHED'/i);
  });
});

// ---------------------------------------------------------------------------
// T10 + the actual regression: projections must select what is compared.
// ---------------------------------------------------------------------------

describe('T10 every projection that feeds the identity check carries gig.mentor_id', () => {
  /**
   * `evaluateBookingOfferIdentity` compares `booking.gig.mentor_id` with
   * `booking.mentor_id`. A select that joins `gigs(...)` without that column
   * makes the comparison false for every booking, which is the reported bug.
   */
  const gigEmbeds = (source: string): string[] =>
    [...stripJsComments(source).matchAll(/gig:gigs\(([^)]*)\)/g)].map((m) => m[1]);

  it('the mentor booking detail and list projection selects gig.mentor_id', () => {
    const server = read('server.ts');
    const start = server.indexOf('const MENTOR_BOOKING_SELECT');
    const projection = server.slice(start, server.indexOf('`;', start));
    const embeds = gigEmbeds(projection);
    assert.equal(embeds.length, 1);
    assert.match(embeds[0], /\bmentor_id\b/);
  });

  it('the seeker booking detail projection selects gig.mentor_id', () => {
    const server = read('server.ts');
    const route = server.slice(
      server.indexOf("app.get('/api/seeker/bookings/:id'"),
      server.indexOf('GET /api/seeker/bookings:')
    );
    assert.match(route, /gig:gigs\([^)]*\bmentor_id\b[^)]*\)/);
  });

  it('every projection that reaches the verdict carries the compared columns', () => {
    // The verdict reads `booking.gig.{id,mentor_id,segment_id}` and
    // `booking.{id,booking_code,mentor_id,seeker_id,gig_id,segment_id}`. A select
    // feeding it that drops `gigs.mentor_id` reintroduces the reported bug, so
    // each of these three is pinned explicitly rather than by a blanket scan:
    // the other `gigs(...)` joins in the codebase (session access, admin
    // workspaces) never reach the verdict and do not need the column.
    const server = read('server.ts');

    // 1. The mentor booking list + detail projection.
    const mentorStart = server.indexOf('const MENTOR_BOOKING_SELECT');
    const mentorProjection = server.slice(mentorStart, server.indexOf('`;', mentorStart));
    assert.match(mentorProjection, /gig:gigs\([^)]*\bmentor_id\b[^)]*\)/);
    assert.match(mentorProjection, /gig:gigs\([^)]*\bsegment_id\b[^)]*\)/);
    assert.match(mentorProjection, /gig:gigs\([^)]*\bid\b[^)]*\)/);

    // 2. The seeker booking detail projection.
    const seekerDetail = server.slice(
      server.indexOf("app.get('/api/seeker/bookings/:id'"),
      server.indexOf('GET /api/seeker/bookings:')
    );
    for (const column of ['id', 'mentor_id', 'segment_id']) {
      assert.match(seekerDetail, new RegExp(`gig:gigs\\([^)]*\\b${column}\\b[^)]*\\)`));
    }

    // 3. The browser-side booking read behind fetchWorkspaceByBooking.
    const service = stripJsComments(read('src/lib/workspaceService.ts'));
    assert.match(service, /gig:gigs!inner\(\*\)/);
  });

  it('T10 historical bookings are not rewritten by the fix', () => {
    // The reported row is one of two real bookings. The other,
    // BK-2609300533-099b, IS genuinely inconsistent (gig in the Relationship
    // segment, booking carrying Autism) and is COMPLETED. It is reported, not
    // repaired: no code path in this fix writes to bookings.
    for (const file of [
      'src/lib/workspaceIdentity.ts',
      'src/lib/workspaceService.ts',
      'src/pages/mentor/MentorWorkspacePage.tsx',
      'src/pages/seeker/SeekerWorkspacePage.tsx',
    ]) {
      assert.doesNotMatch(
        stripJsComments(read(file)),
        /\.update\(\s*\{\s*segment_id/,
        `${file} must not repair a booking's segment`
      );
    }
  });
});