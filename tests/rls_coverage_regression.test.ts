/**
 * RLS coverage regression test.
 *
 * The RLS posture of this schema is not derivable from a generic rule. There is
 * no uniform `user_id` column, so a generated `user_id = auth.uid()` policy is
 * both uncompilable on most tables and wrong on the ones that do have one.
 * Ownership is expressed seven different ways:
 *
 *   user_id                notifications, user_roles, mentor_applications
 *   id                     profiles, mentor_profiles, seeker_profiles
 *   mentor_id              gigs, mentor_availability, mentor_availability_exceptions,
 *                          mentor_segments
 *   seeker_id AND mentor_id bookings, slot_holds, session_workspaces
 *                          (BOTH parties are owners - a mentor must see their own
 *                          bookings, not only the seeker's)
 *   actor_user_id /        audit_logs, mentor_application_audit
 *     admin_user_id
 *   parent-derived         gig_topics (via gigs), payment_events (via payments),
 *                          mentor_verification_documents (via mentor_applications)
 *   none - admin only      segments, segment_topics, platform_config, system_logs,
 *                          system_log_retention, webhook_events, mentor_document_types,
 *                          login_failure_config, login_failure_trackers,
 *                          razorpay_unmatched_captures, reschedule_requests
 *
 * This test therefore asserts on the OWNERSHIP MODEL per table rather than
 * applying one shape everywhere, and it locks in the column-privilege
 * tightening that RLS alone does not provide.
 *
 * It runs offline against the migration files - no database connection - so it
 * is safe to run in CI. Every assertion is a statement about the migrations
 * that would be applied to a fresh database.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const MIGRATIONS_DIR = join(root, 'supabase', 'migrations');

const read = (p: string) => readFileSync(join(root, p), 'utf8');

/** Every migration, in filename (i.e. application) order. */
const allMigrations = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => ({ name: f, sql: readFileSync(join(MIGRATIONS_DIR, f), 'utf8') }));

/** Concatenation of all migrations: the effective schema on a fresh database. */
const schema = allMigrations.map((m) => m.sql).join('\n');

const workflowMigration = read(
  'supabase/migrations/20261006000000_phase32_workflow_column_privilege_tightening.sql',
);

// ---------------------------------------------------------------------------
// The expected table inventory
// ---------------------------------------------------------------------------

/**
 * Every table the project owns, with the ownership column its policies must
 * key on. `null` means the table is intentionally admin-only and must have no
 * user-owned write path.
 */
const EXPECTED_TABLES: Record<string, string | null> = {
  audit_logs: 'actor_user_id',
  bookings: 'seeker_id+mentor_id',
  gig_topics: null, // parent-derived via gigs
  gigs: 'mentor_id',
  login_failure_config: null,
  login_failure_trackers: null,
  mentor_application_audit: 'admin_user_id',
  mentor_applications: 'user_id',
  mentor_availability: 'mentor_id',
  mentor_availability_exceptions: 'mentor_id',
  mentor_document_types: null,
  mentor_profiles: 'id',
  mentor_segments: 'mentor_id',
  mentor_verification_documents: null, // parent-derived via mentor_applications
  notifications: 'user_id',
  payment_events: null, // parent-derived via payments
  payments: 'seeker_id',
  platform_config: null,
  profiles: 'id',
  razorpay_unmatched_captures: null,
  reschedule_requests: 'seeker_id+mentor_id',
  seeker_profiles: 'id',
  segment_topics: null,
  segments: null,
  session_workspaces: 'mentor_id',
  slot_holds: 'seeker_id+mentor_id',
  system_log_retention: null,
  system_logs: null,
  user_roles: 'user_id',
  webhook_events: null,
};

const EXPECTED_TABLE_NAMES = Object.keys(EXPECTED_TABLES).sort();

/** True when any migration enables RLS on this table. */
const enablesRls = (table: string) =>
  new RegExp(
    `ALTER\\s+TABLE\\s+(public\\.)?${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
    'i',
  ).test(schema);

/** Every policy name defined for a table across all migrations, last wins. */
const policiesFor = (table: string): string[] => {
  const names: string[] = [];
  const re = new RegExp(
    `CREATE\\s+POLICY\\s+["']?([\\w\\s]+?)["']?\\s+ON\\s+(public\\.)?${table}\\b`,
    'gi',
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(schema)) !== null) names.push(m[1].trim());
  return names;
};

/**
 * Every policy defined for a table WITH its USING clause, so a test can assert
 * on what a policy actually permits rather than only that it exists.
 *
 * `policiesFor` is deliberately name-only because most assertions are about
 * inventory. Where the gating expression matters - a table whose table-level
 * privileges make RLS the only control - the qualifier has to be inspected too,
 * otherwise a permissive policy would satisfy a name-based check.
 */
const policiesWithQualFor = (table: string): Array<{ name: string; qual: string }> => {
  const found: Array<{ name: string; qual: string }> = [];
  const re = new RegExp(
    `CREATE\\s+POLICY\\s+["']?([\\w\\s]+?)["']?\\s+ON\\s+(?:public\\.)?${table}\\b([\\s\\S]*?);`,
    'gi',
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(schema)) !== null) {
    const body = m[2];
    const using = body.match(/USING\s*\(([\s\S]*?)\)\s*(?:WITH\s+CHECK|$)/i);
    found.push({ name: m[1].trim(), qual: using ? using[1] : '' });
  }
  return found;
};

// ---------------------------------------------------------------------------
// RLS enabled on every table
// ---------------------------------------------------------------------------

test('every expected public table has RLS enabled in migration history', () => {
  // Reconciled by 20261009000000_phase35_platform_config_rls.sql. The
  // `platform_config` allow-list that used to sit here is gone on purpose: it
  // existed to mark the gap, and leaving it would have hidden a regression that
  // silently un-protected the table holding the payment UPI id.
  const missing = EXPECTED_TABLE_NAMES.filter((t) => !enablesRls(t));
  assert.deepEqual(missing, [], `RLS is never enabled for: ${missing.join(', ')}`);
});

test('the expected table inventory matches what the migrations create', () => {
  const created = new Set<string>();
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(schema)) !== null) created.add(m[1].toLowerCase());

  const createdNames = [...created].sort();
  assert.deepEqual(
    createdNames,
    EXPECTED_TABLE_NAMES,
    'a table was added or removed without updating EXPECTED_TABLES; ' +
      'its ownership model must be classified before it ships',
  );
});

// ---------------------------------------------------------------------------
// Every table has at least one policy
// ---------------------------------------------------------------------------

test('every expected table has at least one RLS policy', () => {
  const missing = EXPECTED_TABLE_NAMES.filter((t) => policiesFor(t).length === 0);
  assert.deepEqual(missing, [], `no policy defined for: ${missing.join(', ')}`);
});

// ---------------------------------------------------------------------------
// Critical ownership policies exist and key on the right column
// ---------------------------------------------------------------------------

test('two-party tables let BOTH participants see the row, not just the seeker', () => {
  // A `user_id = auth.uid()`-shaped policy here would hide a mentor's own
  // bookings from the mentor and break booking confirmation entirely.
  for (const table of ['bookings', 'slot_holds', 'session_workspaces']) {
    const policies = policiesFor(table);
    assert.ok(policies.length > 0, `${table} has no policies`);

    const defs = allMigrations
      .map((m) => m.sql)
      .join('\n');
    assert.match(
      defs,
      new RegExp(`${table}[\\s\\S]{0,4000}?seeker_id\\s*=\\s*auth\\.uid\\(\\)`),
      `${table} must scope reads to seeker_id = auth.uid()`,
    );
    assert.match(
      defs,
      new RegExp(`${table}[\\s\\S]{0,4000}?mentor_id\\s*=\\s*auth\\.uid\\(\\)`),
      `${table} must scope reads to mentor_id = auth.uid() - a mentor who cannot ` +
        'read their own bookings cannot confirm, cancel or reschedule them',
    );
  }
});

test('owner-scoped tables key their policies on their own ownership column', () => {
  const expectations: Array<[string, string]> = [
    ['notifications', 'user_id'],
    ['user_roles', 'user_id'],
    ['mentor_applications', 'user_id'],
    ['profiles', 'id'],
    ['mentor_profiles', 'id'],
    ['seeker_profiles', 'id'],
    ['gigs', 'mentor_id'],
    ['mentor_availability', 'mentor_id'],
    ['mentor_availability_exceptions', 'mentor_id'],
    ['mentor_segments', 'mentor_id'],
    ['payments', 'seeker_id'],
  ];

  for (const [table, column] of expectations) {
    assert.match(
      schema,
      new RegExp(`${table}[\\s\\S]{0,6000}?${column}\\s*=\\s*auth\\.uid\\(\\)`),
      `${table} must scope access to ${column} = auth.uid()`,
    );
  }
});

test('admin-only tables are gated on is_admin()', () => {
  const adminOnly = EXPECTED_TABLE_NAMES.filter(
    (t) => EXPECTED_TABLES[t] === null && t !== 'gig_topics' && t !== 'payment_events' && t !== 'mentor_verification_documents',
  );
  for (const table of adminOnly) {
    assert.match(
      schema,
      new RegExp(`${table}[\\s\\S]{0,6000}?is_admin\\(\\)`),
      `${table} is admin-only and must be gated on is_admin()`,
    );
  }
});

test('parent-derived ownership is expressed as an EXISTS against the parent', () => {
  // gig_topics and mentor_verification_documents have no owner column of their
  // own; their access is inherited from the parent row. A generated
  // `user_id = auth.uid()` policy cannot express this at all.
  // The policies are written as `ON public.<table> FOR SELECT USING (EXISTS
  // (... FROM <parent> ...))`, so the search starts at the policy definition
  // rather than the table name.
  assert.match(
    schema,
    /ON\s+public\.gig_topics[\s\S]{0,600}?EXISTS\s*\(\s*SELECT[\s\S]{0,600}?FROM\s+(?:public\.)?gigs\b/i,
    'gig_topics must derive ownership from gigs via EXISTS',
  );
  assert.match(
    schema,
    /ON\s+public\.mentor_verification_documents[\s\S]{0,900}?EXISTS\s*\(\s*SELECT[\s\S]{0,900}?FROM\s+(?:public\.)?mentor_applications\b/i,
    'mentor_verification_documents must derive ownership from mentor_applications via EXISTS',
  );
});

test('intentionally public read surfaces stay public and are not owner-gated', () => {
  // These are the marketplace browse surfaces. Locking them to auth.uid() would
  // break discovery for signed-out visitors, which is the product's whole point.
  const expectations: Array<[string, RegExp]> = [
    ['segments', /ON\s+public\.segments[\s\S]{0,600}?is_active\s*=\s*true/i],
    ['mentor_profiles', /ON\s+public\.mentor_profiles[\s\S]{0,600}?mentor_is_publicly_visible\s*\(/i],
    ['gigs', /ON\s+public\.gigs[\s\S]{0,600}?mentor_is_publicly_visible\s*\(/i],
  ];
  for (const [table, re] of expectations) {
    assert.match(schema, re, `${table} must stay publicly readable through a ` +
      'non-owner-scoped policy, otherwise signed-out mentor discovery breaks');
  }
});

// ---------------------------------------------------------------------------
// No accidental public write access
// ---------------------------------------------------------------------------

test('no migration grants blanket write access to anon or authenticated', () => {
  // A `GRANT ALL ... TO authenticated` reintroduces the column escalation that
  // the privilege-tightening migrations exist to remove.
  assert.doesNotMatch(
    schema,
    /GRANT\s+ALL\s+(?:ON\s+(?:public\.)?\w+\s+)?TO\s+(anon|authenticated)/i,
    'a blanket GRANT ALL to anon/authenticated would undo the column tightening',
  );
  assert.doesNotMatch(
    schema,
    /GRANT\s+ALL\s+ON\s+ALL\s+TABLES[\s\S]{0,200}?TO\s+authenticated/i,
    'authenticated must never hold ALL on all tables',
  );
});

test('anon holds no write privilege on any table', () => {
  const anonWrites = allMigrations
    .map((m) => ({ name: m.name, sql: m.sql }))
    .filter((m) =>
      /GRANT\s+(INSERT|UPDATE|DELETE|TRUNCATE|ALL)\b[\s\S]{0,200}?TO\s+anon/i.test(m.sql),
    );
  assert.deepEqual(
    anonWrites.map((m) => m.name),
    [],
    'anon must never be granted a write privilege',
  );
});

// ---------------------------------------------------------------------------
// Column privileges for protected workflow fields
// ---------------------------------------------------------------------------

test('every table-level UPDATE grant is revoked before column grants are issued', () => {
  // Postgres treats table-level and column-level privileges independently: a
  // table-level grant keeps every column writable, so a column-only revoke is
  // inert. Both of the tightening migrations got this wrong initially and had
  // to be corrected by a follow-up (phase24c).
  const cases: Array<[string, string, RegExp]> = [
    [
      'phase32 workflow tightening',
      workflowMigration,
      /REVOKE\s+INSERT,\s*UPDATE,\s*DELETE,\s*TRUNCATE/i,
    ],
    [
      'phase24c bookings tightening',
      read('supabase/migrations/20260927070000_phase24c_bookings_privilege_tightening.sql'),
      /REVOKE\s+UPDATE,\s*DELETE,\s*TRUNCATE/i,
    ],
  ];

  for (const [name, sql, revokeRe] of cases) {
    const revokeIdx = sql.search(revokeRe);
    const grantIdx = sql.search(/GRANT\s+UPDATE\s*\(/i);
    assert.ok(revokeIdx !== -1, `${name} must revoke the table-level UPDATE grant`);
    assert.ok(grantIdx !== -1, `${name} must re-grant specific columns`);
    assert.ok(
      revokeIdx < grantIdx,
      `${name}: the table-level REVOKE must come before the column-level GRANT, ` +
        'otherwise the table grant keeps every column writable',
    );
  }
});

test('bookings session-state columns stay service-role only', () => {
  // The column-level revoke lives in phase24; phase24c removed the table-level
  // grant that had made it inert.
  const revoke = read(
    'supabase/migrations/20260927050000_phase24_session_time_authority.sql',
  );
  for (const column of [
    'status',
    'actual_ended_at',
    'ended_by_role',
    'end_reason',
    'meeting_url',
    'start_time',
    'end_time',
  ]) {
    assert.match(
      revoke,
      new RegExp(`REVOKE\\s+UPDATE\\s*\\([^)]*\\b${column}\\b`),
      `bookings.${column} must stay revoked from the client`,
    );
  }
  const tightening = read(
    'supabase/migrations/20260927070000_phase24c_bookings_privilege_tightening.sql',
  );
  assert.match(tightening, /GRANT\s+UPDATE\s*\(\s*cancellation_reason\s*,\s*updated_at\s*\)/);
});

test('profiles admin-owned columns are never granted to the client', () => {
  // A self-serve UPDATE on account_status lets a suspended user un-suspend
  // themselves; internal_note is an admin field. Neither may ever appear in a
  // column grant to authenticated or anon.
  for (const role of ['authenticated', 'anon']) {
    for (const column of ['account_status', 'internal_note', 'suspended_until', 'deactivated_at']) {
      assert.doesNotMatch(
        schema,
        new RegExp(
          `GRANT\\s+UPDATE\\s*\\([^)]*\\b${column}\\b[^)]*\\)\\s+ON\\s+public\\.profiles[^;]*${role}`,
          'i',
        ),
        `profiles.${column} must never be granted to ${role}`,
      );
    }
  }
});

test('mentor_profiles approval columns are never granted to the client', () => {
  // A mentor self-approving is the mentor-verification bypass: the public
  // SELECT policy keys on mentor_is_publicly_visible(), so flipping is_approved
  // makes the account publicly bookable without ever passing review.
  for (const role of ['authenticated', 'anon']) {
    for (const column of ['is_approved', 'approval_status', 'is_active', 'is_featured']) {
      assert.doesNotMatch(
        schema,
        new RegExp(
          `GRANT\\s+UPDATE\\s*\\([^)]*\\b${column}\\b[^)]*\\)\\s+ON\\s+public\\.mentor_profiles[^;]*${role}`,
          'i',
        ),
        `mentor_profiles.${column} must never be granted to ${role}`,
      );
    }
  }
});

test('profiles UPDATE is narrowed to the four display columns', () => {
  // Previously KNOWN DRIFT: production had this narrow grant but no migration
  // recorded it, so a history-built database shipped the wide grant from
  // permissions_authenticated_anon and any user could clear their own suspension
  // or write to the admin-only `internal_note`.
  // Reconciled by 20261010000000_phase36_profile_column_boundaries.sql.
  const profileMigration = read(
    'supabase/migrations/20261010000000_phase36_profile_column_boundaries.sql',
  );

  // The wide table-level grant must be revoked first: Postgres treats table and
  // column privileges independently, so a surviving table-level UPDATE makes the
  // column list below meaningless.
  assert.match(
    profileMigration,
    /REVOKE\s+UPDATE\s+ON\s+public\.profiles\s+FROM\s+authenticated/i,
    'the table-level UPDATE on profiles must be revoked before narrowing',
  );

  const grant = profileMigration.match(
    /GRANT\s+UPDATE\s*\(([^)]*)\)\s*ON\s+public\.profiles/i,
  );
  assert.ok(grant, 'profiles must be granted UPDATE per column');
  assert.deepEqual(
    grant[1].split(',').map((c) => c.trim()).filter(Boolean).sort(),
    ['avatar_url', 'full_name', 'phone', 'timezone'],
  );

  // The moderation and lifecycle fields must be absent, and must never be
  // re-granted anywhere in the history.
  for (const column of [
    'account_status', 'internal_note', 'suspended_until', 'suspended_at',
    'deactivated_at', 'suspended_by', 'suspension_reason',
  ]) {
    assert.doesNotMatch(
      grant[1],
      new RegExp(`\\b${column}\\b`, 'i'),
      `profiles.${column} must not be client-writable`,
    );
    assert.doesNotMatch(
      schema,
      new RegExp(`GRANT\\s+UPDATE\\s*\\([^)]*\\b${column}\\b[^)]*\\)[\\s\\S]{0,80}?ON\\s+public\\.profiles`, 'i'),
      `no migration may ever grant profiles.${column} to a client role`,
    );
  }

  // INSERT must keep every column: upsertUserProfile is called on first sign-in
  // and writes id/email/created_at under a WITH CHECK (auth.uid() = id) policy.
  // Narrowing it would break new sign-ups.
  assert.doesNotMatch(
    profileMigration,
    /GRANT\s+INSERT\s*\(/i,
    'profiles INSERT must stay table-level so new sign-ups can write their own row',
  );
});

test('mentor_profiles UPDATE is narrowed to the five content columns', () => {
  // Previously KNOWN DRIFT. With is_approved / is_featured writable and the
  // public SELECT policy keyed on mentor_is_publicly_visible(), a mentor could
  // self-approve and become publicly bookable without review.
  const profileMigration = read(
    'supabase/migrations/20261010000000_phase36_profile_column_boundaries.sql',
  );

  assert.match(
    profileMigration,
    /REVOKE\s+UPDATE\s+ON\s+public\.mentor_profiles\s+FROM\s+authenticated/i,
    'the table-level UPDATE on mentor_profiles must be revoked before narrowing',
  );

  const grant = profileMigration.match(
    /GRANT\s+UPDATE\s*\(([^)]*)\)\s*ON\s+public\.mentor_profiles/i,
  );
  assert.ok(grant, 'mentor_profiles must be granted UPDATE per column');
  assert.deepEqual(
    grant[1].split(',').map((c) => c.trim()).filter(Boolean).sort(),
    ['about', 'experience_years', 'expertise', 'headline', 'languages'],
  );

  for (const column of [
    'is_approved', 'approval_status', 'is_active', 'is_featured',
    'rating', 'review_count', 'session_count',
  ]) {
    assert.doesNotMatch(
      grant[1],
      new RegExp(`\\b${column}\\b`, 'i'),
      `mentor_profiles.${column} must not be client-writable`,
    );
    assert.doesNotMatch(
      schema,
      new RegExp(`GRANT\\s+UPDATE\\s*\\([^)]*\\b${column}\\b[^)]*\\)[\\s\\S]{0,80}?ON\\s+public\.mentor_profiles`, 'i'),
      `no migration may ever grant mentor_profiles.${column} to a client role`,
    );
  }
});

test('the profile UPDATE policies that production runs are recorded', () => {
  // Four policies exist in production but were never created by a migration, so
  // a history-built database had the narrow column grant with no ownership
  // policy behind it at all.
  for (const name of [
    'Users can update own own editable columns', // the doubled "own" is in the live policy
    'Admins can update any profile',
    'Mentors can update own editable profile fields',
    'Admins can update any mentor profile',
  ]) {
    assert.ok(
      schema.includes(`CREATE POLICY "${name}"`),
      `migration history must create the live policy "${name}"`,
    );
  }
});

test('client roles hold no TRUNCATE on user or workflow tables', () => {
  // TRUNCATE is one of the few statements RLS does not cover, so a table-level
  // grant is a real data-destruction path. No application path TRUNCATEs
  // (verified across src/, server.ts and scripts/); maintenance tooling uses the
  // service-role key and keeps its own grants.
  for (const table of ['profiles', 'mentor_profiles', 'reschedule_requests']) {
    assert.match(
      schema,
      new RegExp(`REVOKE\\s+TRUNCATE\\s+ON\\s+public\\.${table}\\s+FROM[^;]*authenticated`, 'i'),
      `a client role must not hold TRUNCATE on ${table}`,
    );
    // The revoke must cover both client roles.
    assert.match(
      schema,
      new RegExp(`REVOKE\\s+TRUNCATE\\s+ON\\s+public\\.${table}\\s+FROM[^;]*\\banon\\b`, 'i'),
      `the TRUNCATE revoke on ${table} must name anon as well`,
    );
    assert.doesNotMatch(
      schema,
      new RegExp(`GRANT\\s+TRUNCATE\\s+ON\\s+public\\.${table}\\s+TO[^;]*authenticated`, 'i'),
      `no migration may grant TRUNCATE on ${table} to a client role`,
    );
  }
});

test('session_workspaces workflow and identity columns are service-role only', () => {
  for (const column of ['status', 'published_at', 'booking_id', 'mentor_id', 'seeker_id']) {
    assert.doesNotMatch(
      workflowMigration,
      new RegExp(`GRANT\\s+UPDATE\\s*\\([^)]*\\b${column}\\b[^)]*\\)`, 'i'),
      `session_workspaces.${column} must not be client-writable - publishing is a ` +
        'server decision and the participant columns must not be re-pointable',
    );
  }
  assert.match(
    workflowMigration,
    /GRANT\s+UPDATE\s*\(\s*summary\s*,\s*takeaways\s*,\s*action_items\s*,\s*resources\s*\)/i,
    'the mentor-authored content columns must remain writable',
  );
});

test('mentor_applications review-decision columns are service-role only', () => {
  for (const column of ['status', 'submitted_at', 'reviewed_at', 'reviewed_by', 'rejection_reason']) {
    assert.doesNotMatch(
      workflowMigration,
      new RegExp(`GRANT\\s+UPDATE\\s*\\([^)]*\\b${column}\\b[^)]*\\)`, 'i'),
      `mentor_applications.${column} is an admin decision field and must not be client-writable`,
    );
  }
  assert.match(
    workflowMigration,
    /GRANT\s+UPDATE\s*\(\s*full_name\s*,\s*bio\s*,\s*timezone\s*,\s*headline\s*,\s*years_of_experience\s*,\s*requested_segment_ids\s*\)/i,
    'the applicant-authored content columns must remain writable',
  );
});

test('TRUNCATE is revoked on the workflow tables', () => {
  // TRUNCATE is one of the few statements RLS does not cover, so a table-level
  // grant on it is a real data-destruction path.
  for (const table of ['session_workspaces', 'mentor_applications', 'bookings']) {
    const src =
      table === 'bookings'
        ? read('supabase/migrations/20260927070000_phase24c_bookings_privilege_tightening.sql')
        : workflowMigration;
    assert.match(
      src,
      new RegExp(`REVOKE[^;]*TRUNCATE[^;]*ON\\s+public\\.${table}`, 'i'),
      `${table} must revoke TRUNCATE from the client roles`,
    );
  }
});

test('updated_at stays protected on mentor_applications without breaking its trigger', () => {
  // The BEFORE UPDATE set_updated_at() trigger fires as the table owner and
  // does not require the client to hold UPDATE on updated_at, so the column can
  // stay service-role only. If a future migration makes the trigger SECURITY
  // INVOKER-dependent or adds a client-written updated_at path, this fails.
  assert.doesNotMatch(
    workflowMigration,
    /GRANT\s+UPDATE\s*\([^)]*\bupdated_at\b[^)]*\)\s+ON\s+public\.mentor_applications/i,
    'updated_at must not be client-writable on mentor_applications',
  );
  assert.match(
    schema,
    /CREATE\s+TRIGGER\s+trg_mentor_applications_updated_at[\s\S]{0,200}?BEFORE\s+UPDATE\s+ON\s+public\.mentor_applications/i,
    'the updated_at trigger must still exist',
  );
});

test('the workflow migration is forward-only and idempotent', () => {
  // Forward-only: it must not drop tables, drop columns, or truncate data.
  for (const destructive of [
    /\bDROP\s+TABLE\b/i,
    /\bDROP\s+COLUMN\b/i,
    /\bTRUNCATE\s+TABLE\b/i,
    /\bDELETE\s+FROM\b/i,
  ]) {
    assert.doesNotMatch(
      workflowMigration,
      destructive,
      `the migration must not contain a destructive statement (${destructive})`,
    );
  }
  // Revoking a privilege that was never granted is a no-op, so re-running is safe.
  assert.match(workflowMigration, /REVOKE\s+INSERT,\s*UPDATE,\s*DELETE,\s*TRUNCATE/i);
});

test('the workflow migration revokes from anon as well as authenticated', () => {
  // Revoking from only one of the two client roles leaves the other able to
  // write every privileged column.
  for (const match of workflowMigration.matchAll(/REVOKE[^;]*ON\s+public\.\w+[^;]*;/gi)) {
    assert.match(
      match[0],
      /authenticated/i,
      'every REVOKE must name authenticated',
    );
    assert.match(
      match[0],
      /\banon\b/i,
      'every REVOKE must name anon as well - revoking from only one client ' +
        'role leaves the other able to write every privileged column',
    );
  }
});

// ---------------------------------------------------------------------------
// platform_config: payment destination data
// ---------------------------------------------------------------------------

test('platform_config is closed to non-admins by migration, not only in production', () => {
  // This table holds `upi_id` and `qr_image_storage_path`. `authenticated`
  // holds table-level UPDATE on it from `permissions_authenticated_anon`, so
  // RLS is the only thing standing between a signed-in user and rewriting where
  // payments are sent. Production had the policy but no migration recorded it,
  // so a history-built database shipped with the guard missing.
  assert.ok(
    enablesRls('platform_config'),
    'platform_config must enable RLS in migration history',
  );

  const policies = policiesWithQualFor('platform_config');
  assert.ok(policies.length > 0, 'platform_config must have at least one policy');

  for (const p of policies) {
    assert.match(
      p.qual,
      /is_admin\(\)/i,
      `platform_config policy "${p.name}" is not admin-gated; a permissive ` +
        'policy would expose upi_id and qr_image_storage_path to any signed-in user',
    );
  }
});

test('the platform_config migration matches the policy production already runs', () => {
  // Applying it to production is a no-op, so the name and shape must match what
  // is live: recreating it under a different name would leave two policies and
  // make the live state ambiguous.
  const phase35 = read('supabase/migrations/20261009000000_phase35_platform_config_rls.sql');
  assert.match(phase35, /CREATE\s+POLICY\s+"Admins can manage platform config"/i);
  assert.match(phase35, /USING\s*\(\s*public\.is_admin\(\)\s*\)/i);
  assert.match(phase35, /WITH\s+CHECK\s*\(\s*public\.is_admin\(\)\s*\)/i);
  // FOR ALL, not a narrower command: production gates SELECT and writes alike.
  assert.match(phase35, /FOR\s+ALL/i);
  // Idempotent, and never disables what production already enforces.
  assert.match(phase35, /DROP\s+POLICY\s+IF\s+EXISTS/i);
  assert.doesNotMatch(phase35, /DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
});