/**
 * REGRESSION: booking <-> workspace identity and visibility.
 *
 * THE REPORTED SYMPTOM
 * --------------------
 * Two screenshots of what should have been one session:
 *
 *   mentor  #BK-2609262151-7763  Relationship Advisor  PUBLISHED
 *   seeker  #BK-2609300533-099b  Autism Mentor        Awaiting Mentor Notes
 *
 * with the mentor reporting "Workspace published successfully! The seeker has
 * been notified."
 *
 * Traced against the live database, the two bookings are genuinely different
 * rows (78675ba2-... and e366ed96-...), so both screens were individually
 * correct. The investigation of HOW that pair could be mistaken for one
 * session produced four defects, all rooted in the same missing check: nothing
 * ever confirmed that the booking on screen is the booking that was asked for,
 * and nothing ever confirmed that the workspace row belongs to that booking.
 *
 * The tests below pin each of them. Every guard here has been verified by
 * injection - reintroducing the defect fails the suite rather than passing it
 * quietly.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  saveWorkspace,
  type SessionWorkspaceRow,
  type WorkspaceBooking,
  type WorkspaceStore,
  type WorkspaceWriteInput,
} from '../src/lib/workspaceStore.server';
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

/**
 * SQL with its comments removed.
 *
 * These guards assert what a migration DOES, and the `--` prose around a
 * migration is allowed to name the thing it deliberately does not do ("no grant
 * is issued here"). Matching against the raw text would make a file's own
 * explanation of itself look like the defect it guards against.
 */
const stripSqlComments = (sql: string) => sql.replace(/--[^\n]*/g, '');

/**
 * SQL with its string literals ALSO removed, for the grant/policy scan.
 *
 * A `COMMENT ON` body is executable SQL that happens to be prose, and this
 * migration's comment describes the phase-32 column grants it is preserving. An
 * un-stripped scan would read that sentence as a fresh grant.
 */
const stripSqlProse = (sql: string) =>
  stripSqlComments(sql).replace(/'(?:[^']|'')*'/g, "''");

/**
 * TypeScript with block and line comments removed, for the same reason: the
 * source is heavily commented, and the comment describing a removed defect
 * still contains the code it described.
 */
const stripJsComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// ---------------------------------------------------------------------------
// Fixtures: two real bookings, two seekers, one mentor
// ---------------------------------------------------------------------------

const MENTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_MENTOR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const SEEKER_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SEEKER_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const SEGMENT_RELATIONSHIP = '00000000-0000-0000-0000-000000000001';
const SEGMENT_AUTISM = '00000000-0000-0000-0000-000000000002';

const GIG_RELATIONSHIP: NonNullable<BookingIdentity['gig']> = {
  id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  mentor_id: MENTOR,
  segment_id: SEGMENT_RELATIONSHIP,
};
const GIG_AUTISM: NonNullable<BookingIdentity['gig']> = {
  id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  mentor_id: MENTOR,
  segment_id: SEGMENT_AUTISM,
};

/** Booking A - the one the mentor published in the reported screenshot. */
const BOOKING_A: BookingIdentity & WorkspaceBooking = {
  id: '11111111-1111-4111-8111-111111111111',
  booking_code: 'BK-2609262151-7763',
  mentor_id: MENTOR,
  seeker_id: SEEKER_A,
  gig_id: GIG_RELATIONSHIP.id,
  segment_id: SEGMENT_RELATIONSHIP,
  gig: GIG_RELATIONSHIP,
};

/** Booking B - the one the seeker was looking at. Different day, seeker, segment. */
const BOOKING_B: BookingIdentity & WorkspaceBooking = {
  id: '22222222-2222-4222-8222-222222222222',
  booking_code: 'BK-2609300533-099b',
  mentor_id: MENTOR,
  seeker_id: SEEKER_B,
  gig_id: GIG_AUTISM.id,
  segment_id: SEGMENT_AUTISM,
  gig: GIG_AUTISM,
};

const T0 = '2026-09-30T18:41:29.796Z';

const content = (notes: string, publish: boolean): WorkspaceWriteInput => ({
  mentorNotes: notes,
  takeaways: [`takeaway for ${notes}`],
  suggestions: [],
  nextSteps: [],
  publish,
});

// ---------------------------------------------------------------------------
// Store double: records every read and every write, scoped by booking_id
// ---------------------------------------------------------------------------

interface StoreCall {
  op: 'find' | 'insert' | 'update' | 'notify';
  bookingId?: string;
  id?: string;
}

/**
 * A stand-in for `session_workspaces` that reproduces the three database facts
 * the identity rules depend on:
 *
 *   - `booking_id` is UNIQUE, so there is never a "which one?" question;
 *   - a workspace row's participants must equal its booking's participants
 *     (`trg_session_workspaces_participant_identity`, phase 37);
 *   - a booking's gig must belong to that booking's mentor and segment
 *     (`trg_bookings_offer_identity`, phase 37).
 *
 * The last two are enforced on write so a test cannot accidentally set up a
 * world the database would refuse to produce.
 */
class IdentityStore implements WorkspaceStore {
  readonly rows = new Map<string, SessionWorkspaceRow>();
  readonly calls: StoreCall[] = [];
  private seq = 0;
  /** The booking table, as the triggers would read it. */
  constructor(private readonly bookings: WorkspaceBooking[]) {}

  private bookingOf(bookingId: string): WorkspaceBooking {
    const b = this.bookings.find((x) => x.id === bookingId);
    if (!b) throw new Error(`no such booking ${bookingId}`);
    return b;
  }

  async findByBookingId(bookingId: string): Promise<SessionWorkspaceRow | null> {
    this.calls.push({ op: 'find', bookingId });
    return this.rows.get(bookingId) ?? null;
  }

  async insertWorkspace(record: SessionWorkspaceRow): Promise<SessionWorkspaceRow> {
    this.calls.push({ op: 'insert', bookingId: record.booking_id, id: record.id });
    if (this.rows.has(record.booking_id)) {
      throw new Error('duplicate key value violates unique constraint "uq_workspace_booking"');
    }
    const booking = this.bookingOf(record.booking_id);
    // The phase-37 trigger.
    if (record.mentor_id !== booking.mentor_id || record.seeker_id !== booking.seeker_id) {
      throw new Error('code: WORKSPACE_PARTICIPANT_MISMATCH');
    }
    this.seq += 1;
    const stored = { ...record, id: record.id || `ws-${this.seq}` };
    this.rows.set(stored.booking_id, stored);
    return stored;
  }

  async updateWorkspace(
    id: string,
    patch: Partial<SessionWorkspaceRow>
  ): Promise<SessionWorkspaceRow | null> {
    const entry = [...this.rows.values()].find((r) => r.id === id) ?? null;
    this.calls.push({ op: 'update', bookingId: entry?.booking_id, id });
    if (!entry) return null;
    const booking = this.bookingOf(entry.booking_id);
    const nextMentor = patch.mentor_id ?? entry.mentor_id;
    const nextSeeker = patch.seeker_id ?? entry.seeker_id;
    if (nextMentor !== booking.mentor_id || nextSeeker !== booking.seeker_id) {
      throw new Error('code: WORKSPACE_PARTICIPANT_MISMATCH');
    }
    const updated = { ...entry, ...patch };
    this.rows.set(updated.booking_id, updated);
    return updated;
  }

  async notifySeekerPublished(input: { userId: string; bookingId: string }): Promise<void> {
    this.calls.push({ op: 'notify', bookingId: input.bookingId });
  }
}

const publish = (store: IdentityStore, b: WorkspaceBooking, notes: string) =>
  saveWorkspace({
    store,
    booking: b,
    input: content(notes, true),
    callerId: b.mentor_id,
    roles: ['mentor'],
    nowIso: T0,
    newId: `ws-${b.id}`,
  });

const rowOf = (store: IdentityStore, b: WorkspaceBooking): WorkspaceIdentity =>
  store.rows.get(b.id) as unknown as WorkspaceIdentity;

// ===========================================================================
// A. The reported flow: publish A, seeker for A sees PUBLISHED
// ===========================================================================

describe('A. a mentor publishes booking A and the seeker for A sees it', () => {
  it('publishing A produces one PUBLISHED row on A, and A\'s seeker can read it', async () => {
    const store = new IdentityStore([BOOKING_A, BOOKING_B]);
    const result = await publish(store, BOOKING_A, 'Session A notes');

    assert.equal(result.ok, true);
    assert.equal(store.rows.size, 1, 'exactly one workspace row exists');

    const row = rowOf(store, BOOKING_A);
    assert.equal(row.booking_id, BOOKING_A.id);
    assert.equal(row.status, 'PUBLISHED');
    assert.equal(row.seeker_id, SEEKER_A, 'the row names the booking\'s seeker');

    // What the seeker's page resolves.
    const verdict = resolveWorkspaceView({
      requestedId: BOOKING_A.id,
      booking: BOOKING_A,
      workspace: row,
      viewer: { userId: SEEKER_A, role: 'seeker' },
    });
    assert.equal(verdict, 'OK');
    assert.equal(isWorkspaceVisibleTo(row, { userId: SEEKER_A, role: 'seeker' }), true);
  });

  it('the mentor sees the same workspace the seeker does', async () => {
    const store = new IdentityStore([BOOKING_A, BOOKING_B]);
    await publish(store, BOOKING_A, 'Session A notes');
    const row = rowOf(store, BOOKING_A);

    const mentorVerdict = resolveWorkspaceView({
      requestedId: BOOKING_A.id,
      booking: BOOKING_A,
      workspace: row,
      viewer: { userId: MENTOR, role: 'mentor' },
    });
    const seekerVerdict = resolveWorkspaceView({
      requestedId: BOOKING_A.id,
      booking: BOOKING_A,
      workspace: row,
      viewer: { userId: SEEKER_A, role: 'seeker' },
    });
    assert.equal(mentorVerdict, 'OK');
    assert.equal(seekerVerdict, 'OK', 'mentor and seeker must agree on one workspace state');
  });
});

// ===========================================================================
// B. Cross-tenant read: seeker for B cannot see A's workspace
// ===========================================================================

describe('B. a seeker cannot read another seeker\'s workspace', () => {
  it('the seeker for B cannot see A\'s published row, even by URL', async () => {
    const store = new IdentityStore([BOOKING_A, BOOKING_B]);
    await publish(store, BOOKING_A, 'Session A notes');
    const rowA = rowOf(store, BOOKING_A);

    // B's seeker asks for B's booking, and the client is handed A's row anyway -
    // exactly what a lookup that was not scoped by booking_id would produce.
    const verdict = resolveWorkspaceView({
      requestedId: BOOKING_B.id,
      booking: BOOKING_B,
      workspace: rowA,
      viewer: { userId: SEEKER_B, role: 'seeker' },
    });

    // The verdict is a refusal, never a render. This is the assertion that
    // matters: not "it is hidden" but "the foreign row is recognised as
    // foreign before any of its content is displayed".
    assert.notEqual(verdict, 'OK');
    assert.equal(verdict, 'WORKSPACE_PARTICIPANT_MISMATCH');
    assert.equal(isWorkspaceVisibleTo(rowA, { userId: SEEKER_B, role: 'seeker' }), false);
  });

  it('a stranger who is in neither booking sees nothing, published or not', async () => {
    const store = new IdentityStore([BOOKING_A, BOOKING_B]);
    await publish(store, BOOKING_A, 'Session A notes');
    const rowA = rowOf(store, BOOKING_A);

    for (const status of ['PUBLISHED', 'PENDING'] as const) {
      assert.equal(
        isWorkspaceVisibleTo({ ...rowA, status }, { userId: OTHER_MENTOR, role: 'seeker' }),
        false,
      );
    }
    // A mentor is only visible to their own workspace, never to a stranger's.
    assert.equal(
      isWorkspaceVisibleTo(rowA, { userId: OTHER_MENTOR, role: 'mentor' }),
      false,
    );
  });

  it('the database rule this mirrors is not weakened', () => {
    const phase10 = read(
      'supabase/migrations/20260921000001_phase10_session_workspace.sql'
    );
    // The seeker predicate still requires BOTH the seeker identity and the
    // published status. Phase 37 adds triggers; it must not have touched this.
    assert.match(phase10, /seeker_id\s*=\s*auth\.uid\(\)\s+AND\s+status\s*=\s*'PUBLISHED'/i);
    assert.doesNotMatch(phase10, /seeker_id\s*=\s*auth\.uid\(\)\s*$/im);
  });
});

// ===========================================================================
// C. Publishing A leaves B untouched
// ===========================================================================

describe('C. publishing A does not modify B', () => {
  it('B keeps its own row, its own status and its own participants', async () => {
    const store = new IdentityStore([BOOKING_A, BOOKING_B]);

    // B is drafted first, then A is published, so a write that leaked across
    // bookings would overwrite a row that exists.
    await saveWorkspace({
      store,
      booking: BOOKING_B,
      input: content('Session B draft', false),
      callerId: MENTOR,
      roles: ['mentor'],
      nowIso: T0,
      newId: 'ws-b',
    });
    const beforeB = { ...store.rows.get(BOOKING_B.id)! };

    await publish(store, BOOKING_A, 'Session A notes');
    const afterB = store.rows.get(BOOKING_B.id)!;

    assert.deepEqual(afterB, beforeB, 'booking B\'s workspace must be byte-identical');
    assert.equal(afterB.status, 'PENDING', 'publishing A must not publish B');
    assert.equal(afterB.mentor_notes, 'Session B draft');
    assert.equal(afterB.seeker_id, SEEKER_B);

    // And no write was ever aimed at the other booking's row.
    const writes = store.calls.filter((c) => c.op === 'insert' || c.op === 'update');
    for (const w of writes) {
      assert.ok(
        w.bookingId === BOOKING_A.id || w.bookingId === BOOKING_B.id,
        `unexpected write scope ${w.bookingId}`,
      );
    }
  });

  it('publishing A notifies only A\'s seeker', async () => {
    const store = new IdentityStore([BOOKING_A, BOOKING_B]);
    await publish(store, BOOKING_A, 'Session A notes');
    const notifications = store.calls.filter((c) => c.op === 'notify');
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].bookingId, BOOKING_A.id);
  });

  it('the notification link carries the booking that was published', async () => {
    const storeSource = read('src/lib/workspaceStore.server.ts');
    // The link must be built from the booking id the write was made against.
    assert.match(storeSource, /link:\s*`\/seeker\/workspace\?bookingId=\$\{bookingId\}`/);
    assert.doesNotMatch(
      storeSource,
      /link:\s*`\/seeker\/workspace\?bookingId=\$\{[^}]*booking_code[^}]*\}`/
    );
  });
});

// ===========================================================================
// D. Lookup is always scoped by booking_id
// ===========================================================================

describe('D. workspace lookup is always scoped by booking_id', () => {
  it('the read path filters on booking_id and takes exactly one row', () => {
    const service = read('src/lib/workspaceService.ts');
    assert.match(
      service,
      /from\('session_workspaces'\)[\s\S]{0,120}?\.eq\('booking_id',\s*bookingId\)[\s\S]{0,40}?\.maybeSingle\(\)/
    );

    const storeSource = read('src/lib/workspaceStore.server.ts');
    assert.match(
      storeSource,
      /from\('session_workspaces'\)[\s\S]{0,120}?\.eq\('booking_id',\s*bookingId\)[\s\S]{0,40}?\.maybeSingle\(\)/
    );

    const server = read('server.ts');
    const readRoute = server.slice(
      server.indexOf("GET /api/workspaces/booking/:bookingId"),
      server.indexOf('POST /api/workspaces:')
    );
    assert.match(
      readRoute,
      /from\('session_workspaces'\)[\s\S]{0,120}?\.eq\('booking_id',\s*booking\.id\)[\s\S]{0,40}?\.maybeSingle\(\)/
    );
  });

  it('the store keys its read on the booking, and the write path never re-points a row', async () => {
    const store = new IdentityStore([BOOKING_A, BOOKING_B]);
    await publish(store, BOOKING_A, 'Session A notes');

    // The only find was for A. Nothing in the flow consulted "the mentor's most
    // recent workspace" or "the first workspace".
    const finds = store.calls.filter((c) => c.op === 'find');
    assert.equal(finds.length, 1);
    assert.equal(finds[0].bookingId, BOOKING_A.id);
  });

  it('the seeker page resolves ONE booking, not a scan of the booking list', () => {
    const page = read('src/pages/seeker/SeekerWorkspacePage.tsx');
    // The old implementation fetched the seeker's whole list and used
    // `bookings.find(...)`. The lookup is now a scoped single-booking read that
    // the server authorizes.
    assert.match(page, /fetchBookingDetail\(queryBookingId\)/);
    assert.doesNotMatch(page, /fetchSeekerBookings\(/);
    assert.doesNotMatch(page, /bookings\.find\(/);
  });
});

// ===========================================================================
// E. mentor_id + segment_id + gig_id stay consistent
// ===========================================================================

describe('E. mentor, segment and gig remain consistent', () => {
  it('a booking whose gig belongs to another segment is refused, not rendered', () => {
    // This is the row that produced the reported pair: booking B carried the
    // Autism segment with a Relationship gig, which is why the same gig title
    // appeared under two different segment names on two bookings.
    const contradictory: BookingIdentity = {
      ...BOOKING_A,
      segment_id: SEGMENT_AUTISM,
      gig_id: GIG_RELATIONSHIP.id,
      gig: GIG_RELATIONSHIP,
    };
    const verdict = evaluateBookingOfferIdentity(contradictory);
    assert.equal(verdict.unverified, false);
    assert.equal(verdict.segmentConsistent, false);
    assert.equal(verdict.mentorConsistent, true);

    assert.equal(
      resolveWorkspaceView({
        requestedId: contradictory.id,
        booking: contradictory,
        workspace: null,
        viewer: { userId: MENTOR, role: 'mentor' },
      }),
      'OFFER_MISMATCH'
    );
  });

  it('a booking whose gig belongs to another mentor is refused', () => {
    const contradictory: BookingIdentity = {
      ...BOOKING_A,
      gig: { ...GIG_RELATIONSHIP, mentor_id: OTHER_MENTOR },
    };
    const verdict = evaluateBookingOfferIdentity(contradictory);
    assert.equal(verdict.mentorConsistent, false);
  });

  it('a booking whose gig was not joined is unverified, never asserted broken', () => {
    const verdict = evaluateBookingOfferIdentity({ ...BOOKING_A, gig: null });
    assert.equal(verdict.unverified, true);
    // Unverified must not be reported as a mismatch, or every booking loaded
    // without its gig would raise a false alarm.
    assert.notEqual(
      resolveWorkspaceView({
        requestedId: BOOKING_A.id,
        booking: { ...BOOKING_A, gig: null },
        workspace: null,
        viewer: { userId: MENTOR, role: 'mentor' },
      }),
      'OFFER_MISMATCH'
    );
  });

  it('the database refuses to create such a booking in the first place', () => {
    const phase37 = read(
      'supabase/migrations/20261011000000_phase37_workspace_identity_invariant.sql'
    );
    // Both identity comparisons must be present, on the booking row.
    assert.match(phase37, /assert_booking_offer_identity/);
    assert.match(phase37, /v_gig\.mentor_id\s+IS\s+DISTINCT\s+FROM\s+NEW\.mentor_id/);
    assert.match(phase37, /v_gig\.segment_id\s+IS\s+DISTINCT\s+FROM\s+NEW\.segment_id/);
    assert.match(phase37, /BEFORE\s+INSERT\s+OR\s+UPDATE\s+OF\s+mentor_id,\s*segment_id,\s*gig_id/i);

    // And it must report rather than silently repair, which is the posture
    // phase 31 established for the same class of disagreement.
    assert.match(phase37, /CREATE\s+OR\s+REPLACE\s+VIEW\s+public\.inconsistent_bookings/i);
    assert.doesNotMatch(phase37, /UPDATE\s+public\.bookings\s+SET/i);
  });

  it('a mismatched workspace row cannot be written at all', async () => {
    const store = new IdentityStore([BOOKING_A, BOOKING_B]);
    await assert.rejects(
      () =>
        store.insertWorkspace({
          id: 'ws-bad',
          booking_id: BOOKING_A.id,
          mentor_id: MENTOR,
          seeker_id: SEEKER_B, // not this booking's seeker
          status: 'PUBLISHED',
          mentor_notes: '',
          summary: '',
          takeaways: [],
          suggestions: [],
          next_steps: [],
          action_items: [],
          follow_up_recommendation: null,
          resources: [],
          published_at: T0,
          created_at: T0,
          updated_at: T0,
        }),
      /WORKSPACE_PARTICIPANT_MISMATCH/
    );
  });
});

// ===========================================================================
// F. No "latest workspace" / "first workspace" fallback
// ===========================================================================

describe('F. there is no latest-workspace or first-workspace fallback', () => {
  it('fetchBookingDetail no longer resolves a list to its first element', () => {
    const service = stripJsComments(read('src/lib/bookingService.ts'));
    // The literal defect: `data.bookings[0]` returns the first row in a list
    // regardless of which booking was requested.
    assert.doesNotMatch(service, /bookings\s*\[\s*0\s*\]/);
    // And the response must be verified against the request.
    assert.match(service, /bookingMatchesRequestedId\(data\.booking as Booking, bookingId\)/);
  });

  it('a response that is not the requested booking fails closed', () => {
    // Same booking list, wrong booking selected: what the old fallback returned.
    const wrongBooking = { ...BOOKING_B };
    assert.equal(bookingMatchesRequestedId(wrongBooking, BOOKING_A.id), false);
    assert.equal(bookingMatchesRequestedId(BOOKING_A, BOOKING_A.id), true);
    // A booking code resolves to itself and to nothing else.
    assert.equal(bookingMatchesRequestedId(BOOKING_A, BOOKING_A.booking_code), true);
    assert.equal(bookingMatchesRequestedId(BOOKING_B, BOOKING_A.booking_code), false);
  });

  it('no workspace read orders by a timestamp and takes the first row', () => {
    const service = read('src/lib/workspaceService.ts');
    // `.order(...)` exists on the admin list endpoints only; the per-booking
    // reads must not carry one.
    const reads = service.match(
      /from\('session_workspaces'\)[\s\S]*?(?=\n\s{2}\}\n|\n\s{2}\/\/ )/g
    );
    assert.ok(reads && reads.length > 0, 'expected at least one session_workspaces read');
    const perBooking = reads.filter((r) => r.includes("eq('booking_id'"));
    assert.ok(perBooking.length > 0);
    for (const r of perBooking) {
      assert.doesNotMatch(r, /\.order\(/, 'a per-booking read must never take a first/last row');
      assert.doesNotMatch(r, /\.limit\(1\)/);
    }
  });

  it('the store never reads by mentor, by segment or by seeker alone', () => {
    const storeSource = read('src/lib/workspaceStore.server.ts');
    for (const column of ['mentor_id', 'seeker_id', 'segment_id']) {
      assert.doesNotMatch(
        storeSource,
        new RegExp(`from\\('session_workspaces'\\)[\\s\\S]{0,200}?\\.eq\\('${column}'`),
        `workspace reads must never be scoped by ${column} alone`
      );
    }
  });

  it('the workspace read rejects a row whose booking_id is not the one requested', () => {
    const rowB = { id: 'ws-b', booking_id: BOOKING_B.id, mentor_id: MENTOR, seeker_id: SEEKER_B, status: 'PUBLISHED' };
    assert.equal(workspaceBelongsToBooking(rowB, BOOKING_A), false);
    assert.equal(workspaceBelongsToBooking(rowB, BOOKING_B), true);
  });
});

// ===========================================================================
// G. PENDING / PUBLISHED semantics
// ===========================================================================

describe('G. PENDING is hidden and PUBLISHED is shown, for the right seeker', () => {
  it('PENDING withholds content from the seeker', async () => {
    const store = new IdentityStore([BOOKING_A, BOOKING_B]);
    await saveWorkspace({
      store,
      booking: BOOKING_A,
      input: content('draft only', false),
      callerId: MENTOR,
      roles: ['mentor'],
      nowIso: T0,
      newId: 'ws-a',
    });
    const row = rowOf(store, BOOKING_A);
    assert.equal(row.status, 'PENDING');

    assert.equal(
      resolveWorkspaceView({
        requestedId: BOOKING_A.id,
        booking: BOOKING_A,
        workspace: row,
        viewer: { userId: SEEKER_A, role: 'seeker' },
      }),
      'PENDING'
    );
    // The mentor still sees their own draft.
    assert.equal(
      resolveWorkspaceView({
        requestedId: BOOKING_A.id,
        booking: BOOKING_A,
        workspace: row,
        viewer: { userId: MENTOR, role: 'mentor' },
      }),
      'OK'
    );
  });

  it('no row at all is NOT_STARTED, which is distinct from a mismatch', () => {
    assert.equal(
      resolveWorkspaceView({
        requestedId: BOOKING_B.id,
        booking: BOOKING_B,
        workspace: null,
        viewer: { userId: SEEKER_B, role: 'seeker' },
      }),
      'NOT_STARTED'
    );
  });

  it('the report itself is honoured: two different bookings are two sessions', () => {
    // The screenshots showed #7763 and #099b. Nothing in the system may resolve
    // either to the other, and the identifier a URL carries decides everything.
    assert.equal(bookingMatchesRequestedId(BOOKING_A, BOOKING_B.id), false);
    assert.equal(bookingMatchesRequestedId(BOOKING_B, BOOKING_A.id), false);
    assert.equal(bookingMatchesRequestedId(BOOKING_A, BOOKING_A.booking_code), true);
    assert.equal(bookingMatchesRequestedId(BOOKING_B, BOOKING_B.booking_code), true);
  });
});

// ===========================================================================
// The navigation failure mode: publishing one session under another URL
// ===========================================================================

describe('the workspace pages are bound to the booking the URL names', () => {
  it('the requested id is read from the tracked route, not only from window', () => {
    const expected = BOOKING_A.id;
    assert.equal(resolveRequestedBookingId(`/mentor/workspace?bookingId=${expected}`, ''), expected);
    assert.equal(resolveRequestedBookingId('/mentor/workspace', `?bookingId=${expected}`), expected);
    assert.equal(resolveRequestedBookingId('/mentor/workspace', ''), '');
    assert.equal(resolveRequestedBookingId(undefined, undefined), '');
  });

  it('a malformed or injected bookingId never reaches a query', () => {
    // These are the values that would turn `.or('id.eq.X,booking_code.eq.X')`
    // into a filter that matches more than one booking.
    const hostile = [
      'x,id.neq.00000000-0000-0000-0000-000000000000',
      "1' OR '1'='1",
      'a'.repeat(200),
      '<script>',
    ];
    for (const value of hostile) {
      assert.equal(
        resolveRequestedBookingId(`/seeker/workspace?bookingId=${encodeURIComponent(value)}`, ''),
        '',
        `must reject ${value.slice(0, 24)}`
      );
    }
  });

  it('a change of bookingId resets the per-booking state on both pages', () => {
    for (const page of [
      'src/pages/mentor/MentorWorkspacePage.tsx',
      'src/pages/seeker/SeekerWorkspacePage.tsx',
    ]) {
      const source = read(page);
      assert.match(source, /resolveRequestedBookingId\(currentPath/, `${page} must read the tracked route`);
      // The reset runs when the request changes, before the new booking loads.
      assert.match(
        source,
        /useEffect\(\(\)\s*=>\s*\{[\s\S]{0,200}?setBooking\(null\)[\s\S]{0,400}?\}, \[queryBookingId/,
        `${page} must clear per-booking state when the requested booking changes`
      );
    }
  });

  it('the mentor publish handler refuses a booking the URL does not name', () => {
    const page = read('src/pages/mentor/MentorWorkspacePage.tsx');
    assert.match(
      page,
      /if \(!booking\?\.id \|\| !mentorId \|\| !bookingMatchesRequestedId\(booking, queryBookingId\)\)/
    );
  });

  it('nothing is rendered from a booking the URL does not name', () => {
    for (const page of [
      'src/pages/mentor/MentorWorkspacePage.tsx',
      'src/pages/seeker/SeekerWorkspacePage.tsx',
    ]) {
      const source = read(page);
      assert.match(
        source,
        /const overview =\s*\n?\s*booking && bookingMatchesRequestedId\(booking, queryBookingId\)/,
        `${page} must derive its overview only from the requested booking`
      );
      assert.doesNotMatch(
        source,
        /const overview = booking \? deriveSessionOverview\(booking\) : workspace\?\.session_overview/,
        `${page} must not fall back to workspace-derived identity`
      );
    }
  });
});

// ===========================================================================
// The server write path
// ===========================================================================

describe('the publish route keeps its identity guarantees', () => {
  it('a workspace whose participants drift from its booking is refused, loudly', async () => {
    const store = new IdentityStore([BOOKING_A, BOOKING_B]);
    // Simulate a row that predates the phase-37 trigger.
    const drifted: SessionWorkspaceRow = {
      id: 'ws-a',
      booking_id: BOOKING_A.id,
      mentor_id: MENTOR,
      seeker_id: SEEKER_B,
      status: 'PENDING',
      mentor_notes: '',
      summary: '',
      takeaways: [],
      suggestions: [],
      next_steps: [],
      action_items: [],
      follow_up_recommendation: null,
      resources: [],
      published_at: null,
      created_at: T0,
      updated_at: T0,
    };
    store.rows.set(drifted.booking_id, drifted);

    const result = await publish(store, BOOKING_A, 'Session A notes');

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, 'PARTICIPANT_MISMATCH');
    // Nothing was written and the mentor was not told the seeker was notified.
    assert.deepEqual(store.calls.filter((c) => c.op !== 'find'), []);
    assert.equal(store.rows.get(BOOKING_A.id)!.status, 'PENDING');
  });

  it('the route answers a participant mismatch with 409, not a permission error', () => {
    const server = read('server.ts');
    const route = server.slice(
      server.indexOf('POST /api/workspaces:'),
      server.indexOf('GET /api/admin/workspaces')
    );
    // 403 would tell the mentor they are not allowed to edit their own session,
    // which is false and sends them looking for the wrong problem.
    assert.match(route, /PARTICIPANT_MISMATCH'\s*\n\s*\?\s*409/);
  });

  it('identity still comes from the verified token and the booking row, never the body', () => {
    const route = read('server.ts');
    const post = route.slice(
      route.indexOf('POST /api/workspaces:'),
      route.indexOf('GET /api/admin/workspaces')
    );
    assert.doesNotMatch(post, /req\.body\.[a-zA-Z]*[Mm]entorId/);
    assert.doesNotMatch(post, /req\.body\.[a-zA-Z]*[Ss]eekerId/);
    assert.match(post, /callerId:\s*req\.auth!\.user\.id/);
    assert.match(post, /roles:\s*req\.auth!\.roles/);
  });
});

// ===========================================================================
// Migration guards
// ===========================================================================

describe('the phase-37 migration is forward-only and self-verifying', () => {
  const phase37 = read(
    'supabase/migrations/20261011000000_phase37_workspace_identity_invariant.sql'
  );
  const sql = stripSqlProse(phase37);
  const code = stripSqlComments(phase37);

  it('is idempotent and never destroys data', () => {
    assert.match(sql, /DROP TRIGGER IF EXISTS trg_bookings_offer_identity/);
    assert.match(sql, /DROP TRIGGER IF EXISTS trg_session_workspaces_participant_identity/);
    assert.doesNotMatch(sql, /\bDROP\s+COLUMN\b/i);
    assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
    assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
  });

  it('enforces the participants RLS actually reads', () => {
    assert.match(sql, /NEW\.mentor_id IS DISTINCT FROM v_booking\.mentor_id/);
    assert.match(sql, /NEW\.seeker_id IS DISTINCT FROM v_booking\.seeker_id/);
    assert.match(sql, /BEFORE\s+INSERT\s+OR\s+UPDATE\s+OF\s+booking_id,\s*mentor_id,\s*seeker_id/i);
  });

  it('changes no grant and no policy', () => {
    assert.doesNotMatch(sql, /\bGRANT\b/i);
    assert.doesNotMatch(sql, /\bREVOKE\b/i);
    assert.doesNotMatch(sql, /\bPOLICY\b/i);
    assert.doesNotMatch(sql, /DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    assert.doesNotMatch(sql, /ALTER\s+TABLE\s+public\.session_workspaces\s+ENABLE/i);
  });

  it('fails loudly if either trigger did not install', () => {
    assert.match(code, /phase37 identity enforcement incomplete/);
    assert.match(code, /t\.tgenabled\s*<>\s*'O'/);
    assert.match(code, /trg_bookings_offer_identity'\s*,\s*'trg_session_workspaces_participant_identity'/);
  });

  it('does not open a door for seekers to write', () => {
    // No policy statement at all, so the existing default-deny for every
    // non-SELECT operation, and the phase-32 column grants, are unchanged by
    // this file. A trigger cannot grant access; it can only refuse a write.
    assert.doesNotMatch(sql, /CREATE\s+POLICY/i);
    assert.doesNotMatch(sql, /\bFOR\s+(INSERT|UPDATE|DELETE|SELECT)\b/i);
  });

  it('reports inconsistent legacy rows instead of repairing them', () => {
    assert.match(sql, /CREATE OR REPLACE VIEW public\.inconsistent_bookings/i);
    assert.match(sql, /CREATE OR REPLACE VIEW public\.inconsistent_session_workspaces/i);
    // The gig's own segment is the authority, so the reporting view surfaces it
    // rather than trusting the booking's copy.
    assert.match(sql, /g\.segment_id AS gig_segment_id/);
  });
});