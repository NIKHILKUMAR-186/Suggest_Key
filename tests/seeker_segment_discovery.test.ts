/**
 * Seeker segment discovery regression test
 * =========================================
 * `GET /api/seeker/segments/:slug/mentors` answered HTTP 500 for every valid
 * segment, including `autism-mentor`.
 *
 * The proximate cause was PostgREST/Postgres `42703`:
 *
 *   GET /api/seeker/segments/:slug/mentors - [42703]
 *   column gigs.original_price_inr does not exist
 *
 * raised by the route's own gig query
 *
 *   server.ts  .from('gigs').select('id, mentor_id, title, description,
 *              duration_minutes, price_inr, original_price_inr, segment_id')
 *
 * The column is declared by `20261013000000_phase39_coupon_original_price.sql`,
 * and that migration had never been applied to the project this server talks to.
 * The application code was correct and documented; the DATABASE was behind.
 * PostgREST resolves a select against its schema before emitting SQL, so one
 * unknown column aborted the whole statement and `throw gigErr` turned it into a
 * 500 - for every segment, with no way for the route to tell "no mentors" from
 * "the schema is wrong".
 *
 * The same missing column also broke `GET /api/seeker/bookings/:id` and
 * `GET /api/seeker/bookings`, which select it in a nested `gig:gigs(...)`.
 *
 * A payload/table mismatch is exactly the class of defect that only ever
 * surfaces as a 500 in production, so what is locked in here is SCHEMA
 * CONVERGENCE: every column this route reads must be declared by a migration,
 * and the migration that declares the pricing column must still declare it.
 * The eligibility rule, the public field allowlist, the 404/400 outcomes and the
 * frontend contract are pinned alongside it so a future "make the 500 go away"
 * change cannot quietly buy that with a looser filter or a wider response.
 *
 * Runs offline against the migration files and the route source, so it is safe
 * in CI and needs no database.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  GENERIC_ERROR_MESSAGE,
  describeSupabaseError,
  resolveHttpStatusForSupabaseError,
} from '../src/lib/supabaseErrors';

const root = process.cwd();
const MIGRATIONS_DIR = join(root, 'supabase', 'migrations');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/**
 * Strips SQL line comments so a DDL scan cannot match prose.
 *
 * These migrations are heavily commented and the commentary deliberately names
 * the columns it is protecting. Without stripping, a scan for `original_price_inr`
 * matches a paragraph explaining why a zero saving must be impossible.
 */
const stripSqlComments = (sql: string) => sql.replace(/--[^\n]*/g, '');

const migrationFiles = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const executableSql = stripSqlComments(
  migrationFiles.map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8')).join('\n'),
);

const serverSource = read('server.ts');
const clientSource = read('src/lib/segmentTopics.ts');
const hookSource = read('src/hooks/useSegmentMentorsByTopic.ts');
const phase39 = read('supabase/migrations/20261013000000_phase39_coupon_original_price.sql');

const ROUTE_PATH = '/api/seeker/segments/:slug/mentors';

/** The source of one route, from its registration to the next registration. */
function sliceRoute(src: string, method: string, path: string): string {
  const start = src.search(new RegExp(`app\\.${method}\\(\\s*'${path.replace(/[/:]/g, (c) => `\\${c}`)}'`));
  assert.notEqual(start, -1, `no app.${method}('${path}') registration in server.ts`);
  const rest = src.slice(start + 1);
  const next = rest.search(/\n\s*app\.(get|post|put|patch|delete)\(/);
  return next === -1 ? rest : rest.slice(0, next);
}

const route = sliceRoute(serverSource, 'get', ROUTE_PATH);

/** Every column this route asks a table for, keyed by table. */
function selectedColumns(table: string): string[] {
  const matches = [...route.matchAll(new RegExp(`\\.from\\('${table}'\\)[\\s\\S]{0,120}?\\.select\\('([^']+)'\\)`, 'g'))];
  assert.ok(matches.length > 0, `the route must select from ${table}`);
  return matches.flatMap((m) => m[1].split(',').map((c) => c.trim()));
}

// ===========================================================================
// The reported defect: schema convergence
// ===========================================================================

describe('every column the discovery route reads is declared by a migration', () => {
  // The failing statement. Named separately because it is the exact regression.
  it('the gigs select is satisfied by the pricing column phase 39 declares', () => {
    const columns = selectedColumns('gigs');
    assert.ok(
      columns.includes('original_price_inr'),
      'the route is expected to read the pre-discount price; this is the column that broke it',
    );
    assert.match(
      executableSql,
      /ALTER\s+TABLE\s+public\.gigs\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+original_price_inr/i,
      'gigs.original_price_inr must be declared by a migration, or the route 500s on every segment',
    );
  });

  for (const table of ['segments', 'gigs', 'mentor_profiles', 'profiles', 'mentor_segments', 'segment_topics']) {
    it(`resolves every column selected from ${table}`, () => {
      for (const column of selectedColumns(table)) {
        // A column is in the schema if any migration adds it, or if it is
        // declared inline in a CREATE TABLE column list.
        const added = new RegExp(
          `ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${column}\\b`,
          'i',
        ).test(executableSql);
        const inline = new RegExp(`^\\s+${column}\\s+[A-Za-z]`, 'im').test(executableSql);
        assert.ok(
          added || inline,
          `${table}.${column} is selected by ${ROUTE_PATH} but no migration declares it`,
        );
      }
    });
  }

  it('phase 39 is idempotent, so applying it to a partly-migrated database is safe', () => {
    assert.match(phase39, /ADD COLUMN IF NOT EXISTS original_price_inr/i);
    assert.match(phase39, /CREATE TABLE IF NOT EXISTS public\.coupons/i);
    assert.match(phase39, /CREATE TABLE IF NOT EXISTS public\.coupon_usage/i);
    assert.match(phase39, /CREATE OR REPLACE FUNCTION public\.create_booking_with_hold/i);
  });

  it('keeps a struck-through price honest at the database level', () => {
    // `original_price_inr > price_inr`, not `>=`: a zero saving must be
    // unrepresentable, not merely discouraged in the UI.
    assert.match(
      executableSql,
      /original_price_inr IS NULL OR \(original_price_inr > price_inr/i,
      'the > price_inr CHECK that forbids a fake saving must survive',
    );
  });

  it('the two seeker booking routes read the same column, so the same fix covers them', () => {
    // Named because they were broken by the identical defect and would
    // otherwise look like an unrelated second bug.
    for (const path of ['/api/seeker/bookings/:id', '/api/seeker/bookings']) {
      assert.match(sliceRoute(serverSource, 'get', path), /gigs\([^)]*original_price_inr/);
    }
  });
});

// ===========================================================================
// Eligibility: the documented rule, unchanged
// ===========================================================================

describe('discovery eligibility is the existing rule', () => {
  it('requires a real name, both approval flags and an active account', () => {
    assert.match(route, /if \(!profile \|\| !profile\.full_name\) return false;/);
    assert.match(route, /if \(!mp\.is_approved \|\| !mp\.is_active \|\| mp\.approval_status !== 'approved'\) return false;/);
  });

  it('defers the operational-account decision to deriveAccountState', () => {
    assert.match(route, /deriveAccountState\(/);
    assert.match(route, /if \(!state\.canPerformOperationalActions\) return false;/);
  });

  it('requires membership of THIS segment, not any segment', () => {
    assert.match(route, /ms\.mentor_id === mp\.id && ms\.segment_id === segment\.id/);
  });

  it('requires an active gig in this segment', () => {
    assert.match(route, /\.from\('gigs'\)[\s\S]{0,140}?\.eq\('segment_id', segment\.id\)/);
    assert.match(route, /\.eq\('is_active', true\)/);
    assert.match(route, /const mentorGigs = gigList\.filter\(\(g: any\) => g\.mentor_id === mp\.id\);/);
    assert.match(route, /if \(mentorGigs\.length === 0\) continue;/);
  });

  it('invents no extra rule and never widens the filter', () => {
    // A new predicate here would silently change who is discoverable.
    const filterBody = route.slice(route.indexOf('const eligible ='), route.indexOf('if (eligible.length === 0)'));
    for (const banned of ['mentor_verification', 'payment_proof', 'bookings.', 'payments.']) {
      assert.doesNotMatch(filterBody, new RegExp(banned.replace('.', '\\.')), `${banned} must not gate discovery`);
    }
  });

  it('reads the active segment only', () => {
    assert.match(route, /\.from\('segments'\)[\s\S]{0,120}?\.eq\('slug', slug\)[\s\S]{0,80}?\.eq\('is_active', true\)/);
  });
});

// ===========================================================================
// The response stays a public discovery payload
// ===========================================================================

describe('the public response carries only discovery fields', () => {
  it('builds the mentor row from an explicit field list, never SELECT *', () => {
    // The row is assembled key by key, so a new column on the table cannot
    // appear in the public payload by accident.
    const row = route.slice(route.indexOf('const row: any = {'), route.indexOf('if (slotResults)'));
    for (const field of [
      'id', 'full_name', 'avatar_url', 'timezone', 'headline', 'about',
      'experience_years', 'languages', 'expertise', 'rating', 'review_count',
      'session_count', 'is_featured', 'is_primary_segment', 'segment', 'gigs', 'gig',
    ]) {
      // `segment,` and `gigs,` are shorthand properties, hence `[:,]`.
      assert.ok(new RegExp(`^\\s+${field}[:,]`, 'm').test(row), `${field} must be in the public row`);
    }
  });

  it('never selects a private column', () => {
    for (const table of ['mentor_profiles', 'profiles', 'mentor_segments', 'gigs', 'segments']) {
      for (const column of selectedColumns(table)) {
        for (const forbidden of [
          'email', 'phone', 'password', 'suspended_reason', 'deactivation_reason',
          'admin_note', 'storage_path', 'created_via', 'last_login',
        ]) {
          assert.notEqual(
            column,
            forbidden,
            `${table}.${forbidden} must never be selected for a public payload`,
          );
        }
      }
    }
  });

  it('reads the eligibility flags without ever returning them', () => {
    // `is_approved` and friends are legitimately SELECTed: the route filters on
    // them server-side. What must not happen is a seeker seeing the flags.
    for (const flag of ['is_approved', 'is_featured']) {
      assert.ok(selectedColumns('mentor_profiles').includes(flag), `${flag} gates eligibility server-side`);
    }
    const row = route.slice(route.indexOf('const row: any = {'), route.indexOf('if (slotResults)'));
    assert.doesNotMatch(row, /^\s+is_approved[:,]/m, 'the approval flag is a filter, not a public field');
    assert.doesNotMatch(row, /^\s+account_status[:,]/m, 'the account status is a filter, not a public field');
  });

  it('never returns bookings, payments or verification documents', () => {
    for (const forbidden of ['booking_id', 'payment', 'verification_document', 'rejection_reason']) {
      assert.doesNotMatch(route, new RegExp(`'?${forbidden}'?\\s*:`, 'i'), `${forbidden} must not reach a seeker`);
    }
  });

  it('keeps the documented response envelope', () => {
    for (const key of ['success', 'mentors', 'total', 'topic', 'segment']) {
      assert.match(route, new RegExp(`\\b${key}[,:]`), `${key} must stay in the response`);
    }
  });

  it('uses the service-role client and never a client credential', () => {
    assert.match(route, /const admin = getSupabaseAdmin\(\);/);
    assert.doesNotMatch(clientSource, /service_role|SERVICE_ROLE|eyJ[A-Za-z0-9_-]{10,}/);
    assert.doesNotMatch(hookSource, /service_role|SERVICE_ROLE|eyJ[A-Za-z0-9_-]{10,}/);
  });
});

// ===========================================================================
// Status codes: a 500 only for a genuine server fault
// ===========================================================================

describe('failures get the right status, and 500 never leaks internals', () => {
  it('a malformed slug is a 400, not a 500', () => {
    assert.match(route, /INVALID_SLUG/);
    assert.ok(
      route.includes("/^[a-z0-9-]{2,60}$/.test(slug)"),
      'the slug must be shape-checked before it reaches the database',
    );
  });

  it('an unknown or inactive segment is the existing 404, not a 500', () => {
    assert.match(route, /SEGMENT_NOT_FOUND/);
    // The segment lookup precedes the gig query, so an unknown slug can never
    // reach the statement that was throwing.
    assert.ok(
      route.indexOf("from('segments')") < route.indexOf("from('gigs')"),
      'the segment lookup must come before the gig query',
    );
  });

  it('a bad topic or date is a 400', () => {
    assert.match(route, /INVALID_TOPIC/);
    assert.match(route, /INVALID_DATE/);
  });

  it('an unknown column is a 500: a schema defect is a server fault', () => {
    // 42703 is absent from the map on purpose. Mapping it to 4xx would report a
    // deployment mistake as the caller's fault and hide it from the error log.
    assert.equal(resolveHttpStatusForSupabaseError({ code: '42703', message: '', details: null, hint: null, isRelationshipAmbiguity: false }), 500);
    // And the caller-fault mappings that ARE defined stay defined.
    assert.equal(resolveHttpStatusForSupabaseError({ code: '22P02', message: '', details: null, hint: null, isRelationshipAmbiguity: false }), 400);
    assert.equal(resolveHttpStatusForSupabaseError({ code: '42501', message: '', details: null, hint: null, isRelationshipAmbiguity: false }), 403);
    assert.equal(resolveHttpStatusForSupabaseError({ code: '23505', message: '', details: null, hint: null, isRelationshipAmbiguity: false }), 409);
  });

  it('the 500 body carries no database detail', () => {
    const info = describeSupabaseError({ code: '42703', message: 'column gigs.original_price_inr does not exist' });
    assert.equal(info.code, '42703');
    // GENERIC_ERROR_MESSAGE is the only text the client is given.
    assert.doesNotMatch(GENERIC_ERROR_MESSAGE, /42703|original_price_inr|column/i);
    assert.match(route, /respondWithInternalError\(\{[\s\S]{0,200}context: 'GET \/api\/seeker\/segments\/:slug\/mentors'/);
  });

  it('stays public: no auth middleware on the route', () => {
    const registration = serverSource.slice(
      serverSource.search(new RegExp(`app\\.get\\(\\s*'${ROUTE_PATH.replace(/[/:]/g, (c) => `\\${c}`)}'`)),
    ).split('=>')[0];
    assert.doesNotMatch(registration, /requireAuth|requireRole|requireAdmin/);
  });
});

// ===========================================================================
// The frontend contract
// ===========================================================================

describe('the frontend contract still matches the route', () => {
  it('calls the documented path', () => {
    assert.match(clientSource, /`\/api\/seeker\/segments\/\$\{encodeURIComponent\(segmentSlug\)\}\/mentors/);
  });

  it('passes topic and date as query parameters', () => {
    assert.match(clientSource, /params\.set\('topic', options\.topicSlug\);/);
    assert.match(clientSource, /params\.set\('date', options\.dateStr\);/);
  });

  it('renders an error state rather than inventing mentors', () => {
    // The 500 surfaced as `Unable to load mentors right now.` because the
    // client turns a non-ok response into an Error. That behaviour is correct:
    // no fallback list, no cached copy.
    assert.match(clientSource, /Unable to load mentors\./);
    assert.doesNotMatch(clientSource, /mockMentor|fallbackMentors|demoMentors|localStorage/);
    assert.match(hookSource, /Unable to load mentors right now\./);
  });

  it('keeps the topic filter server-side', () => {
    // The gig list is narrowed by the resolved topic's own gig ids in the
    // database, never in the browser over an already-fetched list.
    assert.match(route, /if \(topicId\) \{[\s\S]{0,400}?gigQuery = gigQuery\.in\('id', gigIds\);/);
    assert.match(route, /if \(gigIds\.length === 0\) \{[\s\S]{0,160}?mentors: \[\], total: 0/);
  });

  it('an unknown topic in this segment is zero results, not a leak across segments', () => {
    assert.match(route, /return res\.json\(\{ success: true, mentors: \[\], total: 0, topic: null, segment \}\);/);
  });

  it('keeps date mode on the existing availability engine', () => {
    assert.match(route, /computeMentorSlotsForDate\(/);
    assert.match(route, /if \(computed\.error\) throw computed\.error;/);
    // No fallback slot list is ever produced.
    assert.doesNotMatch(route, /fallbackSlots|defaultSlots|syntheticSlots/);
  });
});