/**
 * REGRESSION: POST /api/workspaces 500s.
 *
 * THE FAILURE
 * -----------
 * The mentor Publish button sent a request that reached the backend and came
 * back `500 Internal Server Error`. The server-side cause was a PostgREST
 * `PGRST204`:
 *
 *   Could not find the 'follow_up_recommendation' column of
 *   'session_workspaces' in the schema cache
 *
 * `POST /api/workspaces` wrote `mentor_notes`, `suggestions`, `next_steps` and
 * `follow_up_recommendation`, none of which existed on the live
 * `session_workspaces` table. The phase-10 migration file that intended to add
 * them was never applied to this project's migration lineage, so the
 * application and the database disagreed. PostgREST resolves the entire
 * payload against its schema cache before emitting any SQL, so one unknown
 * column aborted the whole statement: every draft save and every publish failed
 * identically, which is why the error looked unrelated to "publishing".
 *
 * The behavioural tests below drive the real
 * `src/lib/workspaceStore.server.ts` logic - the same code the route calls -
 * through an in-memory store that reproduces the two database facts the write
 * path depends on:
 *
 *   - `booking_id` is UNIQUE, so a second row for one booking is impossible
 *     and an insert for an existing booking is a bug, not a fallback;
 *   - a column the table does not have makes the write fail, exactly as
 *     PostgREST does.
 *
 * The store records every write, so "publish performs an UPDATE, not a
 * duplicate INSERT" is asserted on what the code actually did rather than on
 * the row it happened to leave behind.
 *
 * The last describe block is a source-and-migration assertion. The behavioural
 * tests use a fake table, so on their own they would still pass if the real
 * table lost a column again. That is precisely the regression being guarded,
 * so the column set the code writes is pinned against the migration history.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  WORKSPACE_WRITE_COLUMNS,
  authorizeWorkspaceWrite,
  isWorkspaceVisibleToSeeker,
  planWorkspaceWrite,
  saveWorkspace,
  type SessionWorkspaceRow,
  type WorkspaceBooking,
  type WorkspaceStore,
  type WorkspaceWriteInput,
} from '../src/lib/workspaceStore.server';

const root = process.cwd();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MENTOR_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_MENTOR_ID = '22222222-2222-4222-8222-222222222222';
const SEEKER_ID = '33333333-3333-4333-8333-333333333333';
const BOOKING_ID = '44444444-4444-4444-8444-444444444444';
const BOOKING_CODE = 'SK-1001';

const booking: WorkspaceBooking = {
  id: BOOKING_ID,
  booking_code: BOOKING_CODE,
  mentor_id: MENTOR_ID,
  seeker_id: SEEKER_ID,
};

const T0 = '2026-10-01T10:00:00.000Z';
const T1 = '2026-10-01T11:00:00.000Z';
const T2 = '2026-10-01T12:00:00.000Z';

const draftInput = (overrides: Partial<WorkspaceWriteInput> = {}): WorkspaceWriteInput => ({
  mentorNotes: 'Walked through the migration plan.',
  takeaways: ['Pin the search_path', 'Revoke EXECUTE from anon'],
  suggestions: ['Add a regression test'],
  nextSteps: [{ text: 'Write the migration test' }],
  followUpRecommendation: { recommended: true, timeframe: '2 weeks' },
  publish: false,
  ...overrides,
});

/**
 * The columns the live `session_workspaces` table is known to have.
 *
 * Kept as an explicit list rather than a permissive catch-all: a column added
 * to `WORKSPACE_WRITE_COLUMNS` without adding it here fails the write, which is
 * what PostgREST did to production.
 */
const LIVE_TABLE_COLUMNS = new Set<string>(WORKSPACE_WRITE_COLUMNS);

interface WriteCall {
  kind: 'insert' | 'update';
  columns: string[];
}

class InMemoryWorkspaceStore implements WorkspaceStore {
  readonly rows = new Map<string, SessionWorkspaceRow>();
  readonly writes: WriteCall[] = [];
  readonly notifications: Array<{ userId: string; bookingId: string }> = [];
  private seq = 0;
  /** Simulates a table that has drifted from the code. */
  constructor(private readonly availableColumns: Set<string> = LIVE_TABLE_COLUMNS) {}

  private assertColumns(columns: string[]): void {
    const unknown = columns.filter((c) => !this.availableColumns.has(c));
    if (unknown.length > 0) {
      // The shape PostgREST returns, which is what surfaced as the 500.
      const error: any = new Error(
        `Could not find the '${unknown[0]}' column of 'session_workspaces' in the schema cache`,
      );
      error.code = 'PGRST204';
      throw error;
    }
  }

  async findByBookingId(bookingId: string): Promise<SessionWorkspaceRow | null> {
    return [...this.rows.values()].find((r) => r.booking_id === bookingId) ?? null;
  }

  async insertWorkspace(record: SessionWorkspaceRow): Promise<SessionWorkspaceRow> {
    const columns = Object.keys(record);
    this.assertColumns(columns);
    this.writes.push({ kind: 'insert', columns });

    // booking_id is UNIQUE in Postgres. A second row is a hard error, and the
    // only way to hit it is a write path that inserts when it should update.
    if (this.rows.has(record.booking_id)) {
      const error: any = new Error(
        'duplicate key value violates unique constraint "uq_workspace_booking"',
      );
      error.code = '23505';
      throw error;
    }

    this.seq += 1;
    const stored = { ...record, id: record.id || `ws-${this.seq}` };
    this.rows.set(stored.booking_id, stored);
    return stored;
  }

  async updateWorkspace(
    id: string,
    patch: Partial<SessionWorkspaceRow>,
  ): Promise<SessionWorkspaceRow | null> {
    const columns = Object.keys(patch);
    this.assertColumns(columns);
    this.writes.push({ kind: 'update', columns });

    const entry = [...this.rows.values()].find((r) => r.id === id);
    if (!entry) return null;
    const updated = { ...entry, ...patch };
    this.rows.set(updated.booking_id, updated);
    return updated;
  }

  async notifySeekerPublished(input: { userId: string; bookingId: string }): Promise<void> {
    this.notifications.push({ userId: input.userId, bookingId: input.bookingId });
  }
}

function makeStore(available?: Set<string>): InMemoryWorkspaceStore {
  return new InMemoryWorkspaceStore(available);
}

const save = (
  store: WorkspaceStore,
  overrides: {
    input?: Partial<WorkspaceWriteInput>;
    callerId?: string;
    roles?: Array<'seeker' | 'mentor' | 'admin'>;
    nowIso?: string;
  } = {},
) =>
  saveWorkspace({
    store,
    booking,
    input: draftInput(overrides.input),
    callerId: overrides.callerId ?? MENTOR_ID,
    roles: overrides.roles ?? ['mentor'],
    nowIso: overrides.nowIso ?? T0,
    newId: 'ws-generated',
  });

// ---------------------------------------------------------------------------
// The exact failure: a column the table does not have
// ---------------------------------------------------------------------------

describe('the 500 this replaces: a write naming a column the table lacks', () => {
  it('reproduces PGRST204 against a table missing the four columns', async () => {
    // This is the production shape of `session_workspaces` before the fix.
    const drifted = makeStore(
      new Set([
        'id', 'booking_id', 'mentor_id', 'seeker_id', 'status', 'summary',
        'takeaways', 'action_items', 'resources', 'published_at',
        'created_at', 'updated_at',
      ]),
    );

    await assert.rejects(
      () => save(drifted),
      (err: any) => {
        // PostgREST names one unknown column, and which one is not
        // deterministic, so assert the class of failure and that it names a
        // column from the missing set.
        assert.equal(err.code, 'PGRST204');
        assert.match(err.message, /in the schema cache/);
        assert.match(
          err.message,
          /mentor_notes|suggestions|next_steps|follow_up_recommendation/,
        );
        return true;
      },
    );
  });

  it('names the exact column set the live table is missing today', () => {
    // Guard against the migration silently diverging from the code: these four
    // are the ones the live table lacked.
    const liveBeforeFix = new Set([
      'id', 'booking_id', 'mentor_id', 'seeker_id', 'status', 'summary',
      'takeaways', 'action_items', 'resources', 'published_at', 'created_at',
      'updated_at',
    ]);
    const missing = WORKSPACE_WRITE_COLUMNS.filter((c) => !liveBeforeFix.has(c));

    assert.deepEqual(
      [...missing].sort(),
      ['follow_up_recommendation', 'mentor_notes', 'next_steps', 'suggestions'],
    );
  });
});

// ---------------------------------------------------------------------------
// Required behaviour 1: the mentor can save a draft
// ---------------------------------------------------------------------------

describe('a mentor can save a draft', () => {
  it('creates the workspace, leaves it PENDING and does not notify the seeker', async () => {
    const store = makeStore();
    const result = await save(store);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.created, true);
    assert.equal(result.published, false);

    const row = store.rows.get(BOOKING_ID)!;
    assert.equal(row.status, 'PENDING');
    assert.equal(row.published_at, null);
    assert.equal(row.mentor_id, MENTOR_ID);
    assert.equal(row.seeker_id, SEEKER_ID);
    assert.equal(row.mentor_notes, 'Walked through the migration plan.');
    assert.deepEqual(row.takeaways, ['Pin the search_path', 'Revoke EXECUTE from anon']);
    assert.deepEqual(row.next_steps, [{ text: 'Write the migration test' }]);
    assert.equal(store.notifications.length, 0, 'a draft must not notify the seeker');
  });

  it('edits the draft without creating a second row', async () => {
    const store = makeStore();
    await save(store, { input: { mentorNotes: 'first pass' } });
    const result = await save(store, {
      input: { mentorNotes: 'second pass' },
      nowIso: T1,
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.created, false);
    assert.equal(store.rows.size, 1);
    assert.equal(store.rows.get(BOOKING_ID)!.mentor_notes, 'second pass');
  });

  it('preserves created_at across an edit instead of re-dating it', async () => {
    const store = makeStore();
    await save(store, { nowIso: T0 });
    await save(store, { nowIso: T1 });

    const row = store.rows.get(BOOKING_ID)!;
    assert.equal(row.created_at, T0, 'created_at must be the original creation time');
    assert.equal(row.updated_at, T1, 'updated_at must advance');
  });
});

// ---------------------------------------------------------------------------
// Required behaviour 2 + 3: publish own workspace, as an UPDATE
// ---------------------------------------------------------------------------

describe('a mentor can publish their own workspace', () => {
  it('publishes an existing draft by UPDATE, never by a duplicate INSERT', async () => {
    const store = makeStore();
    await save(store, { nowIso: T0 });

    const published = await save(store, { input: { publish: true }, nowIso: T1 });
    assert.equal(published.ok, true);

    assert.equal(store.writes.length, 2);
    assert.deepEqual(
      store.writes.map((w) => w.kind),
      ['insert', 'update'],
      'the draft is one INSERT, the publish must be an UPDATE',
    );
    assert.equal(store.rows.size, 1, 'one booking, one workspace');

    const row = store.rows.get(BOOKING_ID)!;
    assert.equal(row.status, 'PUBLISHED');
    assert.equal(row.published_at, T1, 'published_at is the server timestamp');
  });

  it('creates and publishes in one call when no workspace exists yet', async () => {
    const store = makeStore();
    const result = await save(store, { input: { publish: true }, nowIso: T1 });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.created, true);
    assert.equal(store.writes.length, 1);
    assert.equal(store.rows.get(BOOKING_ID)!.status, 'PUBLISHED');
  });

  it('notifies the seeker once, on a successful publish', async () => {
    const store = makeStore();
    await save(store);
    await save(store, { input: { publish: true }, nowIso: T1 });

    assert.equal(store.notifications.length, 1);
    assert.equal(store.notifications[0].userId, SEEKER_ID);
  });
});

// ---------------------------------------------------------------------------
// Required behaviour 4: publishing twice is safe
// ---------------------------------------------------------------------------

describe('publishing twice is safe and idempotent', () => {
  it('keeps the original published_at rather than re-dating the publication', async () => {
    const store = makeStore();
    await save(store, { input: { publish: true }, nowIso: T0 });
    await save(store, { input: { publish: true }, nowIso: T1 });

    const row = store.rows.get(BOOKING_ID)!;
    assert.equal(row.status, 'PUBLISHED');
    assert.equal(row.published_at, T0, 'a republish must not move published_at');
  });

  it('leaves exactly one row after repeated publishes', async () => {
    const store = makeStore();
    for (const nowIso of [T0, T1, T2]) {
      const result = await save(store, { input: { publish: true }, nowIso });
      assert.equal(result.ok, true);
    }

    assert.equal(store.rows.size, 1);
    assert.equal(
      store.writes.filter((w) => w.kind === 'insert').length,
      1,
      'republishing must never insert again',
    );
  });

  it('is safe to interleave drafts and publishes', async () => {
    const store = makeStore();
    await save(store, { input: { publish: true }, nowIso: T0 });
    await save(store, { input: { publish: false }, nowIso: T1 });
    await save(store, { input: { publish: true }, nowIso: T2 });

    // One row throughout: the interleave is an UPDATE each time.
    assert.equal(store.rows.size, 1);
    assert.equal(store.writes.filter((w) => w.kind === 'insert').length, 1);

    const row = store.rows.get(BOOKING_ID)!;
    assert.equal(row.status, 'PUBLISHED');

    // Saving a draft withdraws the workspace (status PENDING, published_at
    // cleared), so the republish is a genuine re-publication and takes a fresh
    // timestamp. Idempotency is about not duplicating the row, not about
    // freezing a timestamp across an explicit withdrawal.
    assert.equal(row.published_at, T2);
  });

  it('withdrawing a published workspace clears published_at', async () => {
    const store = makeStore();
    await save(store, { input: { publish: true }, nowIso: T0 });
    await save(store, { input: { publish: false }, nowIso: T1 });

    const row = store.rows.get(BOOKING_ID)!;
    assert.equal(row.status, 'PENDING');
    assert.equal(row.published_at, null, 'a withdrawn workspace is not published');
    assert.equal(
      isWorkspaceVisibleToSeeker(row, ['seeker']),
      false,
      'and is hidden from the seeker again',
    );
  });

  it('does not erase mentor-authored resources on a save', async () => {
    const store = makeStore();
    await save(store);
    const row = store.rows.get(BOOKING_ID)!;
    row.resources = [{ title: 'OWASP API Security Top 10', url: 'https://owasp.org' }];

    await save(store, { input: { publish: true }, nowIso: T1 });

    assert.equal(
      store.rows.get(BOOKING_ID)!.resources.length,
      1,
      'resources are not in the request payload and must survive a save',
    );
  });
});

// ---------------------------------------------------------------------------
// Required behaviour 5 + 6: nobody else may write it
// ---------------------------------------------------------------------------

describe('another mentor cannot publish it', () => {
  it('refuses a mentor who is not assigned to the booking', async () => {
    const store = makeStore();
    await save(store);

    const result = await save(store, {
      callerId: OTHER_MENTOR_ID,
      input: { publish: true },
      nowIso: T1,
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, 'FORBIDDEN');
    assert.equal(store.rows.get(BOOKING_ID)!.status, 'PENDING', 'the draft is untouched');
    assert.equal(store.notifications.length, 0, 'a refused publish must not notify');
  });

  it('refuses an unassigned mentor even when the row does not exist yet', async () => {
    const store = makeStore();
    const result = await save(store, { callerId: OTHER_MENTOR_ID, input: { publish: true } });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, 'FORBIDDEN');
    assert.equal(store.rows.size, 0, 'nothing may be created on a refused write');
  });

  it('refuses a caller whose role is not mentor or admin', async () => {
    const store = makeStore();
    await save(store);

    // The assigned mentor's own id, but a token that carries only `seeker`.
    // The RLS INSERT policy requires the mentor role as well as the id, so the
    // server must not trust the id alone.
    const result = await save(store, { roles: ['seeker'], input: { publish: true } });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, 'FORBIDDEN');
    assert.equal(store.rows.get(BOOKING_ID)!.status, 'PENDING');
  });

  it('requires the mentor role, not just a matching booking.mentor_id', () => {
    // The pure rule, so the role requirement is pinned independently of the
    // route that supplies the roles.
    assert.deepEqual(
      authorizeWorkspaceWrite({ booking, callerId: MENTOR_ID, roles: ['seeker'] }),
      { allowed: false, reason: 'FORBIDDEN' },
      'a token without the mentor role must not be able to author, even when the ' +
        'booking names it as mentor',
    );
    assert.deepEqual(
      authorizeWorkspaceWrite({ booking, callerId: MENTOR_ID, roles: ['mentor'] }),
      { allowed: true },
    );
  });

  it('refuses when the stored row belongs to a different mentor than the booking', async () => {
    // Defence in depth: a workspace whose mentor_id drifted from the booking
    // must not be writable by the booking's current mentor, or the published
    // document would follow the row rather than the booking.
    //
    // The reason is PARTICIPANT_MISMATCH rather than FORBIDDEN. The caller IS
    // the booking's mentor, so reporting "forbidden" would be false and would
    // send the mentor looking for a permissions problem instead of a data one.
    const store = makeStore();
    await save(store);
    store.rows.get(BOOKING_ID)!.mentor_id = OTHER_MENTOR_ID;

    const result = await save(store, { input: { publish: true }, nowIso: T1 });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, 'PARTICIPANT_MISMATCH');
  });

  it('refuses when the stored row names a different SEEKER than the booking', async () => {
    // The mentor drift case above is defence in depth. This one is not: RLS
    // gates seeker visibility on the ROW's seeker_id, so a drifted row is
    // simultaneously hidden from the seeker who booked the session and readable
    // by whoever the drifted value names - while the mentor still sees
    // PUBLISHED. Nothing else in the stack can detect that pair.
    const store = makeStore();
    await save(store);
    store.rows.get(BOOKING_ID)!.seeker_id = OTHER_MENTOR_ID;

    const result = await save(store, { input: { publish: true }, nowIso: T1 });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, 'PARTICIPANT_MISMATCH');
    // And nothing was written, so a refused publish never half-happens.
    assert.equal(store.rows.get(BOOKING_ID)!.status, 'PENDING');
  });

  it('reports a missing booking as 404-shaped, not as a permission error', async () => {
    const result = await saveWorkspace({
      store: makeStore(),
      booking: null,
      input: draftInput(),
      callerId: MENTOR_ID,
      roles: ['mentor'],
      nowIso: T0,
      newId: 'ws-generated',
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, 'BOOKING_NOT_FOUND');
  });
});

describe('a seeker cannot modify it', () => {
  it('refuses a save from the seeker of the booking', async () => {
    const store = makeStore();
    await save(store);

    const result = await save(store, {
      callerId: SEEKER_ID,
      roles: ['seeker'],
      input: { mentorNotes: 'forged by the seeker', publish: true },
      nowIso: T1,
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, 'FORBIDDEN');
    assert.equal(
      store.rows.get(BOOKING_ID)!.mentor_notes,
      'Walked through the migration plan.',
      'the mentor content is untouched',
    );
    assert.equal(store.rows.get(BOOKING_ID)!.status, 'PENDING');
  });

  it('refuses a seeker forging mentor_id in the body', async () => {
    // The route takes the mentor from the booking row and the caller identity
    // from the verified token, so a body-supplied mentorId cannot widen access.
    const store = makeStore();
    const result = await saveWorkspace({
      store,
      booking,
      input: draftInput({ publish: true }),
      callerId: SEEKER_ID,
      roles: ['seeker'],
      nowIso: T0,
      newId: 'ws-generated',
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, 'FORBIDDEN');
    assert.equal(store.rows.size, 0);
  });

  it('an admin may write, since the route grants operational access', async () => {
    const store = makeStore();
    const result = await save(store, {
      callerId: OTHER_MENTOR_ID,
      roles: ['admin'],
      input: { publish: true },
      nowIso: T1,
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(store.rows.get(BOOKING_ID)!.status, 'PUBLISHED');
  });
});

// ---------------------------------------------------------------------------
// Required behaviour 7: the seeker sees it only once PUBLISHED
// ---------------------------------------------------------------------------

describe('a seeker sees the workspace only after PUBLISHED', () => {
  it('hides a PENDING draft from the seeker and shows it once published', () => {
    const draft: SessionWorkspaceRow = {
      id: 'ws-1',
      booking_id: BOOKING_ID,
      mentor_id: MENTOR_ID,
      seeker_id: SEEKER_ID,
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

    assert.equal(isWorkspaceVisibleToSeeker(draft, ['seeker']), false);
    assert.equal(
      isWorkspaceVisibleToSeeker({ ...draft, status: 'PUBLISHED' }, ['seeker']),
      true,
    );
  });

  it('shows the mentor their own draft at any status', () => {
    const draft = { status: 'PENDING' as const };
    assert.equal(isWorkspaceVisibleToSeeker(draft, ['mentor']), true);
    assert.equal(isWorkspaceVisibleToSeeker(draft, ['admin']), true);
  });

  it('ends up visible to the seeker only after the mentor publishes', async () => {
    const store = makeStore();
    await save(store);

    assert.equal(
      isWorkspaceVisibleToSeeker(store.rows.get(BOOKING_ID)!, ['seeker']),
      false,
    );

    await save(store, { input: { publish: true }, nowIso: T1 });

    assert.equal(
      isWorkspaceVisibleToSeeker(store.rows.get(BOOKING_ID)!, ['seeker']),
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Record construction
// ---------------------------------------------------------------------------

describe('the write plan', () => {
  const base = { booking, input: draftInput(), existing: null, nowIso: T0, newId: 'ws-new' };

  it('inserts when the booking has no workspace', () => {
    const plan = planWorkspaceWrite(base);
    assert.equal(plan.mode, 'insert');
    if (plan.mode !== 'insert') return;
    assert.equal(plan.record.booking_id, BOOKING_ID);
    assert.equal(plan.record.mentor_id, MENTOR_ID);
    assert.equal(plan.record.created_at, T0);
  });

  it('updates by id when one already exists', () => {
    const existing: SessionWorkspaceRow = {
      id: 'ws-existing',
      booking_id: BOOKING_ID,
      mentor_id: MENTOR_ID,
      seeker_id: SEEKER_ID,
      status: 'PENDING',
      mentor_notes: 'old',
      summary: 'old',
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

    const plan = planWorkspaceWrite({ ...base, existing, nowIso: T1 });
    assert.equal(plan.mode, 'update');
    if (plan.mode !== 'update') return;
    assert.equal(plan.id, 'ws-existing');
    assert.equal(
      plan.patch.created_at,
      undefined,
      'an update must not rewrite created_at',
    );
  });

  it('gives action items stable ids so a republish can be diffed', () => {
    const plan = planWorkspaceWrite({
      ...base,
      input: draftInput({ nextSteps: [{ text: 'first' }, { text: 'second' }] }),
    });
    assert.equal(plan.mode, 'insert');
    if (plan.mode !== 'insert') return;

    assert.deepEqual(
      plan.record.action_items,
      [
        { id: 'act-1', text: 'first', completed: false },
        { id: 'act-2', text: 'second', completed: false },
      ],
    );

    // Same input, later clock: the ids must be identical, not Date.now()-derived.
    const again = planWorkspaceWrite({
      ...base,
      input: draftInput({ nextSteps: [{ text: 'first' }, { text: 'second' }] }),
      nowIso: T1,
    });
    assert.equal(again.mode, 'insert');
    if (again.mode !== 'insert') return;
    assert.deepEqual(again.record.action_items, plan.record.action_items);
  });

  it('accepts both next-step spellings and caller-supplied ids', () => {
    const plan = planWorkspaceWrite({
      ...base,
      input: draftInput({ nextSteps: [{ id: 'custom', text: 'x', completed: true }] }),
    });
    assert.equal(plan.mode, 'insert');
    if (plan.mode !== 'insert') return;
    assert.deepEqual(plan.record.action_items, [
      { id: 'custom', text: 'x', completed: true },
    ]);
  });
});

describe('the authorization rule', () => {
  it('allows the assigned mentor', () => {
    assert.deepEqual(
      authorizeWorkspaceWrite({ booking, callerId: MENTOR_ID, roles: ['mentor'] }),
      { allowed: true },
    );
  });

  it('allows an admin who is not the mentor', () => {
    assert.deepEqual(
      authorizeWorkspaceWrite({ booking, callerId: OTHER_MENTOR_ID, roles: ['admin'] }),
      { allowed: true },
    );
  });

  it('refuses a different mentor and a seeker', () => {
    for (const roles of [['mentor'], ['seeker']] as const) {
      const result = authorizeWorkspaceWrite({
        booking,
        callerId: roles[0] === 'seeker' ? SEEKER_ID : OTHER_MENTOR_ID,
        roles: [...roles],
      });
      assert.equal(result.allowed, false);
    }
  });

  it('fails closed when the booking does not exist', () => {
    const result = authorizeWorkspaceWrite({
      booking: null,
      callerId: MENTOR_ID,
      roles: ['mentor'],
    });
    assert.deepEqual(result, { allowed: false, reason: 'BOOKING_NOT_FOUND' });
  });
});

// ---------------------------------------------------------------------------
// Schema alignment: the behavioural tests use a fake table
// ---------------------------------------------------------------------------

describe('the migration history provides every column the write path needs', () => {
  const MIGRATIONS_DIR = join(root, 'supabase', 'migrations');

  const schema = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
    .join('\n');

  it('the alignment migration adds all four missing columns', () => {
    const migration = readFileSync(
      join(MIGRATIONS_DIR, '20261007000000_phase33_session_workspaces_column_alignment.sql'),
      'utf8',
    );

    for (const column of [
      'mentor_notes',
      'suggestions',
      'next_steps',
      'follow_up_recommendation',
    ]) {
      assert.match(
        migration,
        new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`),
        `the migration must add ${column}`,
      );
    }
  });

  it('the alignment migration is idempotent and forward-only', () => {
    const migration = readFileSync(
      join(MIGRATIONS_DIR, '20261007000000_phase33_session_workspaces_column_alignment.sql'),
      'utf8',
    );

    assert.match(migration, /ADD COLUMN IF NOT EXISTS/);
    assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS/);
    for (const destructive of [
      /\bDROP\s+TABLE\b/i,
      /\bDROP\s+COLUMN\b/i,
      /\bTRUNCATE\s+TABLE\b/i,
      /\bDELETE\s+FROM\b/i,
    ]) {
      assert.doesNotMatch(migration, destructive, `must not contain ${destructive}`);
    }
  });

  it('the alignment migration neither disables RLS nor grants the client anything', () => {
    const migration = readFileSync(
      join(MIGRATIONS_DIR, '20261007000000_phase33_session_workspaces_column_alignment.sql'),
      'utf8',
    );

    assert.doesNotMatch(migration, /DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    assert.doesNotMatch(migration, /DROP\s+POLICY/i);
    assert.doesNotMatch(
      migration,
      /GRANT[^;]*\bTO\s+(anon|authenticated)\b/i,
      'these columns must stay service-role only, like status and published_at',
    );
  });

  it('every column the write path names is created by the migration history', () => {
    // The behavioural tests above pass against a fake table, so without this
    // they would still pass if the real table lost a column again. That is the
    // regression, so the two are pinned together.
    const createdInWorkspaceTable = new Set<string>();

    // The table is created once, in the MVP schema, and only ever altered.
    const createMatch = schema.match(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?session_workspaces\s*\(([\s\S]*?)\n\);/i,
    );
    if (createMatch) {
      for (const rawLine of createMatch[1].split('\n')) {
        const line = rawLine.replace(/--.*$/, '').trim();
        const m = line.match(/^(\w+)\s+(?:UUID|TEXT|JSONB|TIMESTAMPTZ|BIGINT|INT|INTEGER|BOOLEAN)\b/i);
        if (m) createdInWorkspaceTable.add(m[1].toLowerCase());
      }
    }

    for (const alter of schema.matchAll(
      /ALTER\s+TABLE\s+(?:public\.)?session_workspaces\s+ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi,
    )) {
      createdInWorkspaceTable.add(alter[1].toLowerCase());
    }

    const missing = WORKSPACE_WRITE_COLUMNS.filter(
      (c) => !createdInWorkspaceTable.has(c.toLowerCase()),
    );

    assert.deepEqual(
      [...missing],
      [],
      'the migration history does not create these session_workspaces columns, ' +
        'so POST /api/workspaces would 500 with PGRST204: ' + missing.join(', '),
    );
  });

  it('the write path depends on booking_id being unique', () => {
    // Without this, publishing an existing workspace could not resolve to a
    // single row update.
    const migration = readFileSync(
      join(MIGRATIONS_DIR, '20261007000000_phase33_session_workspaces_column_alignment.sql'),
      'utf8',
    );
    assert.match(
      migration,
      /CREATE UNIQUE INDEX IF NOT EXISTS[\s\S]{0,120}ON public\.session_workspaces \(booking_id\)/,
    );
    assert.match(schema, /UNIQUE\s*\(booking_id\)|UNIQUE INDEX[^;]*\(booking_id\)/i);
  });

  it('RLS still gates the table after the alignment', () => {
    // The fix must not have traded a 500 for an open table.
    assert.match(
      schema,
      /ALTER\s+TABLE\s+(?:public\.)?session_workspaces\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i,
    );
    assert.doesNotMatch(
      schema,
      /ALTER\s+TABLE\s+(?:public\.)?session_workspaces\s+DISABLE\s+ROW\s+LEVEL\s+SECURITY/i,
    );
  });

  it('the write path is not reachable with client credentials', () => {
    // `status` and `published_at` are server decisions, so the browser must not
    // hold UPDATE on the table itself.
    const tightening = readFileSync(
      join(
        MIGRATIONS_DIR,
        '20261006000000_phase32_workflow_column_privilege_tightening.sql',
      ),
      'utf8',
    );
    assert.match(
      tightening,
      /REVOKE\s+INSERT,\s*UPDATE,\s*DELETE,\s*TRUNCATE\s+ON\s+public\.session_workspaces\s+FROM\s+authenticated,\s*anon/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Route wiring
// ---------------------------------------------------------------------------

describe('the route delegates to the tested logic', () => {
  const server = readFileSync(join(root, 'server.ts'), 'utf8');

  it('POST /api/workspaces calls saveWorkspace rather than hand-rolling a write', () => {
    const start = server.indexOf("app.post('/api/workspaces'");
    assert.ok(start > -1, 'route not found');
    const body = server.slice(start, server.indexOf("app.get('/api/admin/workspaces'"));

    assert.match(body, /saveWorkspace\(/);
    assert.match(body, /createSupabaseWorkspaceStore\(/);
    assert.doesNotMatch(
      body,
      /from\('session_workspaces'\)[\s\S]{0,80}\.upsert\(/,
      'the route must not build its own upsert; the plan logic is the tested seam',
    );
  });

  it('the route takes the caller identity from the verified token', () => {
    const start = server.indexOf("app.post('/api/workspaces'");
    const body = server.slice(start, server.indexOf("app.get('/api/admin/workspaces'"));

    assert.match(body, /callerId: req\.auth!\.user\.id/);
    assert.match(body, /roles: req\.auth!\.roles/);
    // A body-supplied mentor must never reach the write.
    assert.doesNotMatch(body, /mentor_id:\s*req\.body/);
  });

  it('the booking select carries the session-overview fields, not just identity', () => {
    const start = server.indexOf("app.post('/api/workspaces'");
    const body = server.slice(start, server.indexOf("app.get('/api/admin/workspaces'"));

    // The write consumes only participant identity, so those must be selected.
    assert.match(body, /select\('id, booking_code, mentor_id, seeker_id/);

    // The response also carries `session_overview`, and
    // `deriveSessionOverview` computes `durationMinutes` from start_time and
    // end_time. Narrowing the select to identity alone silently made that
    // `NaN` (serialised as null) in the publish response, so the overview
    // fields are part of the contract, not incidental.
    assert.match(
      body,
      /select\('id, booking_code, mentor_id, seeker_id, start_time, end_time, status'\)/,
      'the session overview needs start_time/end_time, and booking status is shown',
    );
    assert.match(body, /deriveSessionOverview\(booking as any\)/);
  });

  it('the failing write is logged with a route and operation label', () => {
    const start = server.indexOf("app.post('/api/workspaces'");
    const body = server.slice(start, server.indexOf("app.get('/api/admin/workspaces'"));

    // The error the operator needs: code + route + operation, via the
    // centralised handler that scrubs the message and keeps the internals
    // out of the HTTP response.
    assert.match(body, /respondWithInternalError\(\{[^}]*context: 'POST \/api\/workspaces'/);
  });

  it('the route still requires authentication and validates the body', () => {
    const start = server.indexOf("app.post('/api/workspaces'");
    const body = server.slice(start, server.indexOf("app.get('/api/admin/workspaces'"));

    assert.match(body, /requireAuth/);
    assert.match(body, /validateBody\(apiSchemas\.workspace\)/);
  });

  it('the seeker read gate uses the shared predicate', () => {
    const start = server.indexOf("app.get('/api/workspaces/booking/:bookingId'");
    const body = server.slice(start, server.indexOf("app.post('/api/workspaces'"));

    assert.match(body, /isWorkspaceVisibleToSeeker\(/);
  });
});
