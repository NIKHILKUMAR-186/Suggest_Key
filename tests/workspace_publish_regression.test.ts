/**
 * Session workspace publish regression test.
 *
 * `POST /api/workspaces` answered HTTP 500 for every mentor save and publish.
 * The proximate cause was PostgREST `PGRST204`: the write path named
 * `mentor_notes`, `suggestions`, `next_steps` and `follow_up_recommendation`,
 * and none of those four columns existed on the live table, because the phase10
 * migration that declares them was never applied in this lineage. PostgREST
 * resolves a whole payload against its schema cache before emitting any SQL, so
 * one unknown column aborted the entire statement.
 *
 * This test locks in what must not silently regress:
 *
 *   1. Every column the write path depends on is declared by a migration, and a
 *      database that applied the migrations actually has all of them. A
 *      payload/table mismatch is exactly the class of bug that only surfaces as
 *      a 500 in production.
 *   2. The publish boundary stays narrow. `status` and `published_at` are never
 *      granted to a client role, and no migration hands a client role a
 *      table-level UPDATE here - which would silently re-open every column.
 *   3. Publishing stays a server decision: ownership from the verified token,
 *      `status` from the validated `publish` flag, `published_at` from a server
 *      clock, identity from the booking rather than the body, and a republish
 *      that preserves the original publication time.
 *
 * Runs offline against the migration files and the store module, so it is safe
 * in CI.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  WORKSPACE_WRITE_COLUMNS,
  authorizeWorkspaceWrite,
  authorizeExistingWorkspace,
  planWorkspaceWrite,
  saveWorkspace,
  isWorkspaceVisibleToSeeker,
  type SessionWorkspaceRow,
  type WorkspaceStore,
} from '@/src/lib/workspaceStore.server';

const root = process.cwd();
const MIGRATIONS_DIR = join(root, 'supabase', 'migrations');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/**
 * Strips SQL line comments so DDL scanning cannot match prose.
 *
 * These migrations are heavily commented and the commentary deliberately names
 * the protected columns while explaining why they are withheld. Without
 * stripping, a naive `GRANT ... ON public.session_workspaces` scan matches a
 * paragraph of explanation and reports protected columns as granted - a false
 * failure that would train us to ignore this test.
 */
const stripSqlComments = (sql: string) => sql.replace(/--[^\n]*/g, '');

const executableSql = stripSqlComments(
  readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
    .join('\n'),
);

const storeSource = read('src/lib/workspaceStore.server.ts');
const serverSource = read('server.ts');
const workspaceService = read('src/lib/workspaceService.ts');
const validationSource = read('src/lib/validation.ts');

/**
 * Columns that must never be writable by a client role at all.
 *
 * Workflow state and audit data have no legitimate client-write path, on
 * INSERT or UPDATE.
 */
const NEVER_CLIENT_WRITABLE = ['status', 'published_at', 'id', 'created_at', 'updated_at'];

/**
 * Participant identity.
 *
 * These ARE present in the INSERT grant, and deliberately so: the RLS INSERT
 * policy is `WITH CHECK (mentor_id = auth.uid())`, so `mentor_id` must be
 * settable for that policy to be satisfiable at all, and `booking_id` /
 * `seeker_id` are what make the row self-consistent under it. What must never
 * happen is an UPDATE: re-pointing `mentor_id` / `seeker_id` / `booking_id`
 * would move a published document to a different pair of participants, which is
 * the defect phase32 corrected.
 */
const IDENTITY_COLUMNS = ['booking_id', 'mentor_id', 'seeker_id'];

const MENTOR = 'mentor-1';
const SEEKER = 'seeker-1';
const ADMIN = 'admin-1';
const BOOKING = {
  id: 'booking-1',
  booking_code: 'BK-1',
  mentor_id: MENTOR,
  seeker_id: SEEKER,
};

const CONTENT = {
  mentorNotes: 'notes',
  takeaways: ['t1'],
  suggestions: ['s1'],
  nextSteps: [{ id: 'act-1', text: 'do it' }],
  followUpRecommendation: { recommended: true, timeframe: '2-3 weeks' },
};

function storedRow(overrides: Partial<SessionWorkspaceRow> = {}): SessionWorkspaceRow {
  return {
    id: 'ws-1',
    booking_id: BOOKING.id,
    mentor_id: MENTOR,
    seeker_id: SEEKER,
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
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** In-memory store, so the orchestration can be exercised without a database. */
function fakeStore(existing: SessionWorkspaceRow | null): WorkspaceStore & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async findByBookingId() {
      calls.push('find');
      return existing;
    },
    async insertWorkspace(record) {
      calls.push('insert');
      return record;
    },
    async updateWorkspace(id, patch) {
      calls.push('update');
      return existing ? { ...existing, ...patch, id } : null;
    },
    async notifySeekerPublished() {
      calls.push('notify');
    },
  };
}

// ---------------------------------------------------------------------------
// Schema convergence: the original defect
// ---------------------------------------------------------------------------

test('every column the write path depends on is declared by a migration', () => {
  const declared = new Set(
    [
      ...executableSql.matchAll(
        /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_]+)\s+(?:TEXT|JSONB|TIMESTAMPTZ|UUID)/gi,
      ),
      ...executableSql.matchAll(/^\s{2}([a-z_]+)\s+(?:TEXT|JSONB|TIMESTAMPTZ|UUID)\b/gim),
    ].map((m) => m[1].toLowerCase()),
  );

  for (const col of WORKSPACE_WRITE_COLUMNS) {
    assert.ok(declared.has(col), `${col} must be declared by a migration`);
  }
});

test('the write path declares exactly the columns the schema provides', () => {
  // Pins the drift that caused the 500: a column appearing in the payload
  // without a matching migration, or a rename on either side.
  assert.deepEqual(
    [...WORKSPACE_WRITE_COLUMNS].sort(),
    [
      'action_items', 'booking_id', 'created_at', 'follow_up_recommendation',
      'id', 'mentor_id', 'mentor_notes', 'next_steps', 'published_at',
      'resources', 'seeker_id', 'status', 'suggestions', 'summary',
      'takeaways', 'updated_at',
    ].sort(),
  );
  // The store must select exactly that set, so a stale select cannot reintroduce
  // a PGRST204 on the read path.
  assert.match(storeSource, /const WORKSPACE_COLUMNS = WORKSPACE_WRITE_COLUMNS\.join\(', '\)/);
});

test('the alignment migration is idempotent and forward-only', () => {
  const phase33 = read(
    'supabase/migrations/20261007000000_phase33_session_workspaces_column_alignment.sql',
  );
  for (const col of ['mentor_notes', 'suggestions', 'next_steps', 'follow_up_recommendation']) {
    assert.match(
      stripSqlComments(phase33),
      new RegExp(`ADD\\s+COLUMN\\s+IF\\s+NOT\\s+EXISTS\\s+${col}\\b`, 'i'),
      `${col} must be added idempotently`,
    );
  }
  // Idempotent widening only: never drop a column a mentor may have authored.
  assert.doesNotMatch(stripSqlComments(phase33), /DROP\s+COLUMN/i);
  assert.doesNotMatch(stripSqlComments(phase33), /TRUNCATE/i);
});

// ---------------------------------------------------------------------------
// Privilege boundary
// ---------------------------------------------------------------------------

test('protected workspace columns are never granted to a client role', () => {
  const grants = [...executableSql.matchAll(/GRANT[^;]*ON\s+public\.session_workspaces[^;]*;/gi)].map(
    (m) => m[0],
  );
  assert.ok(grants.length > 0, 'expected at least one grant to scan');

  for (const stmt of grants) {
    // A table-level grant makes every column writable regardless of the column
    // list, which is the exact defect phase32 corrected.
    assert.doesNotMatch(
      stmt,
      /\bGRANT\s+(INSERT|UPDATE|DELETE|TRUNCATE|ALL)(\s+ALL)?\s+ON\b/i,
      'client roles must be granted per column, never at table level',
    );
    // Workflow state and audit columns are never client-writable, on either
    // operation: an INSERT that could pre-publish, or pre-date, a workspace.
    for (const col of NEVER_CLIENT_WRITABLE) {
      assert.doesNotMatch(
        stmt,
        new RegExp(`\\b${col}\\b`, 'i'),
        `"${col}" must never appear in a client grant`,
      );
    }
    // Identity must never appear in an UPDATE grant: re-pointing a workspace at
    // another pair of participants is the escalation phase32 closed.
    if (/GRANT\s+UPDATE\s*\(/i.test(stmt)) {
      for (const col of IDENTITY_COLUMNS) {
        assert.doesNotMatch(
          stmt,
          new RegExp(`\\b${col}\\b`, 'i'),
          `"${col}" must never be client-updatable`,
        );
      }
    }
  }
});

test('the client UPDATE grant is exactly the four phase32 content columns', () => {
  // Nothing in src/ writes this table from the browser, so the grant is
  // defence-in-depth and must stay as narrow as phase32 left it. phase34
  // withdrew the four columns phase33_content_columns had added.
  const updateGrants = [...executableSql.matchAll(/GRANT\s+UPDATE\s*\(([^)]*)\)\s*ON\s+public\.session_workspaces/gi)]
    .map((m) => m[1]);
  assert.ok(updateGrants.length > 0, 'expected a per-column UPDATE grant');

  const granted = new Set(
    updateGrants
      .join(',')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean),
  );

  for (const col of ['summary', 'takeaways', 'action_items', 'resources']) {
    assert.ok(granted.has(col), `${col} must remain client-writable as content`);
  }
  for (const col of [...NEVER_CLIENT_WRITABLE, ...IDENTITY_COLUMNS]) {
    assert.ok(!granted.has(col), `${col} must stay out of the client UPDATE grant`);
  }
  // The four restored columns are server-written only.
  const phase34 = stripSqlComments(
    read('supabase/migrations/20261008000000_phase34_restore_narrow_workspace_content_grant.sql'),
  );
  assert.match(
    phase34,
    /REVOKE\s+UPDATE\s*\(\s*mentor_notes,\s*suggestions,\s*next_steps,\s*follow_up_recommendation\s*\)/i,
  );
  for (const col of ['mentor_notes', 'suggestions', 'next_steps', 'follow_up_recommendation']) {
    assert.ok(!granted.has(col), `${col} must be service-role only`);
  }
});

test('every client grant names both client roles', () => {
  // Revoking or granting for only one leaves the other able to write.
  for (const stmt of executableSql.matchAll(/GRANT[^;]*ON\s+public\.session_workspaces[^;]*;/gi)) {
    assert.match(stmt[0], /authenticated/i);
    assert.match(stmt[0], /\banon\b/i);
  }
});

test('RLS stays enabled on session_workspaces', () => {
  assert.match(executableSql, /ALTER\s+TABLE\s+public\.session_workspaces\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  assert.doesNotMatch(executableSql, /ALTER\s+TABLE\s+public\.session_workspaces\s+DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
});

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

test('the assigned mentor may write; a seeker and a stranger may not', () => {
  assert.deepEqual(authorizeWorkspaceWrite({ booking: BOOKING, callerId: MENTOR, roles: ['mentor'] }), {
    allowed: true,
  });
  // A seeker is a participant and may READ a published workspace, but must
  // never be able to author or publish one.
  assert.deepEqual(authorizeWorkspaceWrite({ booking: BOOKING, callerId: SEEKER, roles: ['seeker'] }), {
    allowed: false,
    reason: 'FORBIDDEN',
  });
  assert.deepEqual(
    authorizeWorkspaceWrite({ booking: BOOKING, callerId: 'someone-else', roles: ['mentor'] }),
    { allowed: false, reason: 'FORBIDDEN' },
  );
});

test('an admin may perform the legitimate administrative write', () => {
  assert.deepEqual(authorizeWorkspaceWrite({ booking: BOOKING, callerId: ADMIN, roles: ['admin'] }), {
    allowed: true,
  });
});

test('a missing booking is reported distinctly from a permission failure', () => {
  assert.deepEqual(authorizeWorkspaceWrite({ booking: null, callerId: MENTOR, roles: ['mentor'] }), {
    allowed: false,
    reason: 'BOOKING_NOT_FOUND',
  });
});

test('a drifted row cannot be re-pointed at a different mentor', () => {
  // The stored row claims a different mentor than the booking: refuse rather
  // than letting the participants of a published document follow the row.
  const drifted = { mentor_id: 'someone-else', seeker_id: SEEKER };
  assert.deepEqual(
    authorizeExistingWorkspace({ existing: drifted, booking: BOOKING, callerId: MENTOR, roles: ['mentor'] }),
    { allowed: false, reason: 'PARTICIPANT_MISMATCH' },
  );
  // Consistent row passes through.
  assert.deepEqual(
    authorizeExistingWorkspace({ existing: { mentor_id: MENTOR, seeker_id: SEEKER }, booking: BOOKING, callerId: MENTOR, roles: ['mentor'] }),
    { allowed: true },
  );
});

test('a drifted SEEKER is refused even though the mentor is the caller', () => {
  // RLS keys seeker visibility on the ROW's seeker_id, so a drifted row hides
  // the workspace from the seeker who booked the session while showing it to
  // whoever the drifted value names. The mentor's ownership check passes here,
  // so this has to be caught by the participant check and nothing else.
  const drifted = { mentor_id: MENTOR, seeker_id: 'someone-else' };
  assert.deepEqual(
    authorizeExistingWorkspace({ existing: drifted, booking: BOOKING, callerId: MENTOR, roles: ['mentor'] }),
    { allowed: false, reason: 'PARTICIPANT_MISMATCH' },
  );
  // An admin is not exempt: this is stored data that disagrees with its
  // booking, not a permission question.
  assert.deepEqual(
    authorizeExistingWorkspace({ existing: drifted, booking: BOOKING, callerId: ADMIN, roles: ['admin'] }),
    { allowed: false, reason: 'PARTICIPANT_MISMATCH' },
  );
});

test('saveWorkspace refuses a seeker before touching the store', async () => {
  const store = fakeStore(null);
  const result = await saveWorkspace({
    store,
    booking: BOOKING,
    input: { ...CONTENT, publish: true },
    callerId: SEEKER,
    roles: ['seeker'],
    nowIso: '2026-02-01T00:00:00.000Z',
    newId: 'ws-new',
  });
  assert.deepEqual(result, { ok: false, reason: 'FORBIDDEN' });
  assert.deepEqual(store.calls, [], 'nothing may be read or written for a denied caller');
});

test('saveWorkspace refuses a mentor writing another mentor\'s workspace', async () => {
  const store = fakeStore(storedRow());
  const result = await saveWorkspace({
    store,
    booking: BOOKING,
    input: { ...CONTENT, publish: true },
    callerId: 'other-mentor',
    roles: ['mentor'],
    nowIso: '2026-02-01T00:00:00.000Z',
    newId: 'ws-new',
  });
  assert.deepEqual(result, { ok: false, reason: 'FORBIDDEN' });
  assert.ok(!store.calls.includes('update'), 'the row must not be updated');
});

// ---------------------------------------------------------------------------
// Publish semantics
// ---------------------------------------------------------------------------

test('publishing stamps status and a server-generated published_at', () => {
  const plan = planWorkspaceWrite({
    booking: BOOKING,
    input: { ...CONTENT, publish: true },
    existing: null,
    nowIso: '2026-02-01T00:00:00.000Z',
    newId: 'ws-new',
  });
  assert.equal(plan.mode, 'insert');
  if (plan.mode !== 'insert') return;
  assert.equal(plan.record.status, 'PUBLISHED');
  assert.equal(plan.record.published_at, '2026-02-01T00:00:00.000Z');
  // Identity comes from the booking, never from caller input.
  assert.equal(plan.record.mentor_id, BOOKING.mentor_id);
  assert.equal(plan.record.seeker_id, BOOKING.seeker_id);
});

test('saving a draft leaves the workspace unpublished', () => {
  const plan = planWorkspaceWrite({
    booking: BOOKING,
    input: { ...CONTENT, publish: false },
    existing: null,
    nowIso: '2026-02-01T00:00:00.000Z',
    newId: 'ws-new',
  });
  if (plan.mode !== 'insert') throw new Error('expected insert');
  assert.equal(plan.record.status, 'PENDING');
  assert.equal(plan.record.published_at, null);
});

test('republishing preserves the original published_at and mentor resources', () => {
  const existing = storedRow({
    status: 'PUBLISHED',
    published_at: '2026-01-15T09:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    resources: [{ url: 'https://example.com/handout.pdf' }],
  });
  const plan = planWorkspaceWrite({
    booking: BOOKING,
    input: { ...CONTENT, publish: true },
    existing,
    nowIso: '2026-02-01T00:00:00.000Z',
    newId: 'ws-new',
  });
  assert.equal(plan.mode, 'update');
  if (plan.mode !== 'update') return;
  assert.equal(plan.patch.published_at, '2026-01-15T09:00:00.000Z');
  // An edit must not clear mentor-authored resources.
  assert.deepEqual(plan.patch.resources, existing.resources);
});

test('an edit does not rewrite created_at', () => {
  const existing = storedRow();
  const plan = planWorkspaceWrite({
    booking: BOOKING,
    input: { ...CONTENT, publish: false },
    existing,
    nowIso: '2026-02-01T00:00:00.000Z',
    newId: 'ws-new',
  });
  if (plan.mode !== 'update') throw new Error('expected update');
  assert.equal('created_at' in (plan.patch as object), false, 'created_at must not be in an update patch');
  assert.equal(plan.patch.updated_at, '2026-02-01T00:00:00.000Z');
});

test('action item ids are stable across saves', () => {
  const first = planWorkspaceWrite({
    booking: BOOKING,
    input: { ...CONTENT, publish: false },
    existing: null,
    nowIso: '2026-02-01T00:00:00.000Z',
    newId: 'ws-new',
  });
  const second = planWorkspaceWrite({
    booking: BOOKING,
    input: { ...CONTENT, publish: false },
    existing: storedRow(),
    nowIso: '2026-03-01T00:00:00.000Z',
    newId: 'ws-new',
  });
  if (first.mode !== 'insert' || second.mode !== 'update') throw new Error('unexpected plan');
  assert.deepEqual(first.record.action_items, second.patch.action_items);
});

test('the mentor publish succeeds end to end and notifies the seeker', async () => {
  const store = fakeStore(null);
  const result = await saveWorkspace({
    store,
    booking: BOOKING,
    input: { ...CONTENT, publish: true },
    callerId: MENTOR,
    roles: ['mentor'],
    nowIso: '2026-02-01T00:00:00.000Z',
    newId: 'ws-new',
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.workspace.status, 'PUBLISHED');
  assert.equal(result.created, true);
  assert.deepEqual(store.calls, ['find', 'insert', 'notify']);
  // All four restored columns must survive the round trip.
  assert.equal(result.workspace.mentor_notes, CONTENT.mentorNotes);
  assert.deepEqual(result.workspace.suggestions, CONTENT.suggestions);
  assert.deepEqual(result.workspace.next_steps, CONTENT.nextSteps);
  assert.deepEqual(result.workspace.follow_up_recommendation, CONTENT.followUpRecommendation);
});

test('a save without publish does not notify the seeker', async () => {
  const store = fakeStore(null);
  await saveWorkspace({
    store,
    booking: BOOKING,
    input: { ...CONTENT, publish: false },
    callerId: MENTOR,
    roles: ['mentor'],
    nowIso: '2026-02-01T00:00:00.000Z',
    newId: 'ws-new',
  });
  assert.ok(!store.calls.includes('notify'));
});

test('a seeker sees a workspace only once it is published', () => {
  assert.equal(isWorkspaceVisibleToSeeker({ status: 'PENDING' }, ['seeker']), false);
  assert.equal(isWorkspaceVisibleToSeeker({ status: 'PUBLISHED' }, ['seeker']), true);
  assert.equal(isWorkspaceVisibleToSeeker({ status: 'PENDING' }, ['mentor']), true);
  assert.equal(isWorkspaceVisibleToSeeker({ status: 'PENDING' }, ['admin']), true);
});

// ---------------------------------------------------------------------------
// Route wiring
// ---------------------------------------------------------------------------

test('the route derives identity from the verified token, never the body', () => {
  assert.match(serverSource, /const result = await saveWorkspace\(\{/);
  assert.match(serverSource, /callerId: req\.auth!\.user\.id/);
  assert.match(serverSource, /roles: req\.auth!\.roles/);
  // A missing booking is 404, an ordinary permission failure is 403, and stored
  // data that disagrees with its booking is 409 - a conflict, not a permission
  // problem. Reporting the last one as 403 would tell a mentor they may not edit
  // their own session, which is both false and unactionable.
  assert.match(
    serverSource,
    /result\.reason === 'BOOKING_NOT_FOUND'\s*\?\s*404\s*:\s*result\.reason === 'PARTICIPANT_MISMATCH'\s*\?\s*409\s*:\s*403/,
  );
  // Every denial still carries a message the client can show verbatim.
  assert.match(serverSource, /'This workspace record is linked to different participants/);
});

test('the client cannot supply authority-bearing workspace fields', () => {
  // `apiSchemas.workspace` is strict, so `status`, `published_at`,
  // `mentor_id` and `seeker_id` are rejected as unknown keys rather than being
  // silently ignored - which is what stops them acting as authority.
  assert.match(validationSource, /workspace: z\.strictObject\(\{/);
  const start = validationSource.indexOf('workspace: z.strictObject({');
  const schema = validationSource.slice(start, start + 2000);
  for (const forbidden of ['status:', 'publishedAt', 'published_at', 'seekerId', 'seeker_id']) {
    assert.doesNotMatch(
      schema,
      new RegExp(`\\b${forbidden}`, 'i'),
      `client must not be able to supply ${forbidden}`,
    );
  }
});

test('no browser code writes session_workspaces with the anon key', () => {
  // This is what makes the column grants defence-in-depth rather than the
  // operative path: a client-side write would make the narrow grant load-bearing
  // and could break the mentor flow on its own.
  const writes = [...workspaceService.matchAll(/\.(insert|upsert|update)\(/g)].map((m) => m[1]);
  assert.equal(writes.length, 0, `workspaceService must write through apiFetch, found: ${writes.join(', ')}`);
  assert.match(workspaceService, /apiFetch\('\/api\/workspaces'/);
});

test('insufficient privilege maps to 403, not 500', () => {
  // 42501 is an authorization outcome. Letting it fall through to 500 told the
  // browser "our side is broken" when the accurate answer was "not permitted".
  assert.match(read('src/lib/supabaseErrors.ts'), /case '42501':[\s\S]{0,160}?return 403;/);
});
