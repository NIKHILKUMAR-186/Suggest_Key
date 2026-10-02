/**
 * Regression tests for CRITICAL-01 (unauthenticated privilege escalation) and
 * the CRITICAL-02/CRITICAL-03 deployment defects.
 *
 * These assert on the schema-of-record migration, the deployment config, the
 * build output and the server source, so a future change that reopens any of
 * these holes fails the suite rather than shipping.
 *
 * The live-database half of CRITICAL-01 is verified separately by anon probes
 * against PostgREST; these tests lock in the SQL that makes that true.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const migration = read(
  'supabase/migrations/20261004000000_phase29_security_definer_execute_containment.sql'
);

// ---------------------------------------------------------------------------
// CRITICAL-01: anon / PUBLIC must not be able to EXECUTE SECURITY DEFINER
// ---------------------------------------------------------------------------

test('containment migration revokes EXECUTE from PUBLIC, anon and authenticated', () => {
  assert.match(migration, /REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC/);
  assert.match(migration, /REVOKE EXECUTE ON FUNCTION %s FROM anon/);
  assert.match(migration, /REVOKE EXECUTE ON FUNCTION %s FROM authenticated/);
});

test('containment is scoped to SECURITY DEFINER functions, not every function', () => {
  // A blanket `ON ALL FUNCTIONS ... FROM authenticated` would strip EXECUTE
  // from plain trigger bodies (set_updated_at, enforce_gig_topic_segment_
  // ownership) that fire on rows written by signed-in users, breaking ordinary
  // writes. The migration must iterate SECURITY DEFINER functions only.
  assert.match(migration, /p\.prosecdef/);
  assert.doesNotMatch(migration, /REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated/);
  assert.doesNotMatch(migration, /REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon/);
});

test('service_role retains function access because it is the trusted backend', () => {
  assert.match(migration, /GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role/);
});

test('authenticated is granted exactly the four RLS predicate helpers and nothing more', () => {
  const grants = [...migration.matchAll(/GRANT EXECUTE ON FUNCTION (public\.\w+)\([^)]*\)\s+TO authenticated/g)]
    .map((m) => m[1])
    .sort();

  assert.deepEqual(grants, [
    'public.has_role',
    'public.is_account_suspended',
    'public.is_admin',
    'public.mentor_is_publicly_visible',
  ]);
});

test('anon is granted EXECUTE on nothing', () => {
  assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION .* TO anon/);
  assert.doesNotMatch(migration, /GRANT EXECUTE ON ALL FUNCTIONS .* TO anon/);
});

test('handle_new_user stays executable for supabase_auth_admin so signup keeps working', () => {
  // Removing the PUBLIC grant would otherwise break the auth.users trigger.
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.handle_new_user\(\) TO supabase_auth_admin/);
});

test('containment migration fails closed if anon can still execute anything', () => {
  assert.match(migration, /CRITICAL-01 containment incomplete/);
  assert.match(migration, /has_function_privilege\('anon'/);
});

test('the two functions that were missing a pinned search_path are pinned', () => {
  assert.match(migration, /ALTER FUNCTION public\.create_booking_with_hold/);
  assert.match(migration, /SET search_path = public/);
  assert.match(migration, /ALTER FUNCTION public\.get_user_role/);
});

test('any legacy anon EXECUTE grant is superseded by the global containment revoke', () => {
  // phase14 line 201 still contains:
  //   GRANT EXECUTE ON FUNCTION public.mentor_is_publicly_visible(UUID) TO authenticated, anon;
  // and phase24 line 242 shows the team already knew the correct pattern for a
  // single function. Neither was applied globally, which is the root cause.
  //
  // The invariant that must hold is the *end state*, not that no migration ever
  // mentions anon: phase29 revokes EXECUTE from anon on every SECURITY DEFINER
  // function, so any earlier grant is superseded.
  //
  // Pinning phase29 as the last filename is not that invariant, it is a proxy
  // for it, and the proxy breaks the moment anyone ships a feature. The check
  // is therefore on the end state: whatever migration runs last must not re-open
  // the hole phase29 closed.
  const dir = 'supabase/migrations';
  const files = readdirSync(join(root, dir)).filter((f) => f.endsWith('.sql')).sort();
  const last = files[files.length - 1];
  const phase29 = '20261004000000_phase29_security_definer_execute_containment.sql';
  const lastSql = readFileSync(join(root, dir, last), 'utf8');

  if (last === phase29) {
    assert.match(lastSql, /REVOKE EXECUTE ON FUNCTION %s FROM anon/);
    assert.match(lastSql, /REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC/);
    return;
  }

  assert.doesNotMatch(
    lastSql,
    /GRANT EXECUTE ON FUNCTION .* TO anon/,
    `${last} grants EXECUTE to anon after the phase 29 blanket revoke`,
  );
  assert.doesNotMatch(
    lastSql,
    /GRANT EXECUTE ON ALL FUNCTIONS .* TO anon/,
    `${last} grants blanket EXECUTE to anon after the phase 29 revoke`,
  );
});

// A SECURITY DEFINER function added after phase 29 is callable by `anon` unless
// its own migration re-applies containment, because Postgres grants EXECUTE to
// PUBLIC by default. Each migration that adds one is named here, so the check
// cannot be satisfied by whatever file happens to sort last.
const POST_PHASE29_SECURITY_DEFINER_MIGRATIONS = [
  '20261005000000_phase30_reschedule_requests.sql',
];

for (const migration of POST_PHASE29_SECURITY_DEFINER_MIGRATIONS) {
  test(`${migration} carries its own anon containment post-condition`, () => {
    const body = readFileSync(join(root, 'supabase/migrations', migration), 'utf8');
    assert.match(
      body,
      /has_function_privilege\('anon'/,
      'a SECURITY DEFINER function added after phase 29 must prove anon cannot execute it',
    );
    assert.doesNotMatch(body, /GRANT EXECUTE ON FUNCTION .* TO anon/);
  });
}

// ---------------------------------------------------------------------------
// CRITICAL-03: /api/* must reach Express, not a static file in dist
// ---------------------------------------------------------------------------

test('vercel.json does not rewrite /api to a file inside dist', () => {
  const v = read('vercel.json');
  // `/api/(.*) -> /server.cjs` made Vercel serve the bundle as a static
  // download (content-type application/node), which is what produced
  // `Unexpected token 'v', "var __crea..."` when the client called /api/health.
  assert.doesNotMatch(v, /"destination"\s*:\s*"\/server\.cjs"/);
});

test('vercel.json routes all /api traffic to the serverless function', () => {
  const v = JSON.parse(
    read('vercel.json').replace(/^\s*\/\/[^\n]*\n/gm, '')
  ) as { rewrites: { source: string; destination: string }[] };

  const api = v.rewrites.find((r) => r.source.startsWith('/api'));
  assert.ok(api, 'expected an /api rewrite');
  // All /api/* traffic must be routed to the api/index.cjs serverless function.
  // On Vercel the destination only selects which function to invoke; the
  // original request URL (e.g. /api/admin/dashboard/overview) is still the
  // value Express sees for routing. A no-op rewrite to /api/:path* fails to
  // match any function for paths deeper than /api, so the request falls
  // through to the SPA fallback and index.html is served instead of JSON.
  assert.equal(api.destination, '/api');
});

test('the SPA fallback rewrite still exists for non-API routes', () => {
  const v = JSON.parse(
    read('vercel.json').replace(/^\s*\/\/[^\n]*\n/gm, '')
  ) as { rewrites: { source: string; destination: string }[] };
  const spa = v.rewrites.find((r) => r.destination === '/index.html');
  assert.ok(spa, 'SPA fallback rewrite is missing');

  // The fallback must not swallow /api. This is the rewrite that turned a
  // request which never reached the function into 200 text/html, which the
  // client reported as `Unexpected token '<'`. Excluding /api turns the same
  // breakage into an honest 404 instead of a JSON parse error. The lookahead
  // must be wrapped in a group: vercel.json `rewrites` (unlike `routes`) only
  // accepts a bare `(?!...)` inside a capture group.
  assert.match(spa.source, /\(\?!api\)/);
});

test('the server bundle is built outside the published output directory', () => {
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  // The bundle must land on api/index.cjs, which is both the Vercel function
  // entrypoint and inside the function package, and must never land in dist/,
  // which Vercel publishes as static output.
  assert.match(pkg.scripts['build:server'], /--outfile=api\/index\.cjs/);
  assert.doesNotMatch(pkg.scripts['build:server'], /--outfile=dist\//);
  // No source map: api/ is packaged into the deployed function, and shipping
  // one reintroduces the backend-source exposure this suite exists to prevent.
  assert.doesNotMatch(pkg.scripts['build:server'], /--sourcemap/);
});

test('the serverless entrypoint is the self-contained Express bundle', () => {
  const entry = read('api/index.cjs');
  // api/index.cjs IS the esbuild output, not a wrapper that requires a bundle
  // from somewhere else. A wrapper adds a second file for Vercel to trace and
  // ignore-filter, and that indirection is what silently produced a project
  // with zero functions when the referenced path was not packaged.
  assert.doesNotMatch(entry, /require\('\.\/_build\//);
  assert.doesNotMatch(entry, /require\('\.\.\/\.build\//);
});

test('server.ts exports the app synchronously so Vercel receives a real handler', () => {
  const s = read('server.ts');
  // startServer() is async; an export at the end of it is not visible when
  // Vercel first requires the module.
  const exportIdx = s.indexOf("if (process.env.VERCEL === '1')");
  const startIdx = s.indexOf('async function startServer()');
  assert.ok(exportIdx > -1, 'expected a VERCEL export branch');
  assert.ok(exportIdx < startIdx, 'export must be assigned before startServer() awaits');
});

// ---------------------------------------------------------------------------
// CRITICAL-02: backend source must not be published
// ---------------------------------------------------------------------------

test('the build fails if dist ever contains backend source or a sourcemap', () => {
  const v = read('scripts/verify-dist.mjs');
  assert.match(v, /\.cjs\$/);
  assert.match(v, /\.map\$/);
  assert.match(v, /process\.exit\(1\)/);
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  assert.match(pkg.scripts.build, /build:verify/);
});

test('verify-dist fails on the secret identifiers that must never be published', () => {
  const v = read('scripts/verify-dist.mjs');
  for (const marker of [
    'SUPABASE_SERVICE_ROLE_KEY',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET',
    'ADMIN_PASSWORD',
    'DEMO_TOKEN_SECRET',
  ]) {
    assert.ok(v.includes(marker), `verify-dist should scan for ${marker}`);
  }
});

test('.build/ is git-ignored so server bundles are never committed', () => {
  const g = read('.gitignore');
  assert.match(g, /^\.build\/$/m);
});

// ---------------------------------------------------------------------------
// Fixture data must not be served in production
// ---------------------------------------------------------------------------

test('the admin overdue-links route reads the database, not the local fixture', () => {
  const s = read('server.ts');
  const start = s.indexOf("app.get('/api/admin/bookings/overdue-links'");
  assert.ok(start > -1, 'route not found');

  // Bound the window to this route only: everything up to the next route
  // registration, so an unrelated fixture use further down cannot mask or
  // falsely trip this assertion.
  const rest = s.slice(start + 10);
  const nextRoute = rest.search(/\n\s*app\.(get|post|put|patch|delete)\(/);
  const raw = s.slice(start, nextRoute > -1 ? start + 10 + nextRoute : s.length);

  // Strip comments first: the route deliberately documents the old behaviour
  // in prose, and that prose must not be mistaken for a live call.
  //
  // CRLF is normalised before stripping because `.` does not match `\r` in a
  // JavaScript regex (it is a line terminator), so `//.*$` silently fails to
  // match on a CRLF file and the comment text would survive the strip.
  const body = raw
    .replace(/\r/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');

  assert.ok(
    !/getLocalBookingEngineContext\(\)/.test(body),
    'overdue-links must not read the in-memory BookingEngine fixture'
  );
  assert.match(body, /getSupabaseAdmin\(\)/);
  assert.match(body, /from\('bookings'\)/);
});

test('production fails closed when Supabase service credentials are missing', () => {
  const s = read('server.ts');
  const guard = s.indexOf("app.use('/api', (req: ExpressRequest");
  assert.ok(guard > -1, 'expected a production fail-closed guard');
  const body = s.slice(guard, guard + 900);
  assert.match(body, /NODE_ENV !== 'production'/);
  assert.match(body, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(body, /503/);
  assert.match(body, /SERVICE_UNAVAILABLE/);
});

test('the production guard is mounted before any API route', () => {
  const s = read('server.ts');
  const guard = s.indexOf("app.use('/api', (req: ExpressRequest");
  const firstRoute = s.indexOf("app.get('/api/health'");
  assert.ok(guard > -1 && firstRoute > -1);
  assert.ok(guard < firstRoute, 'guard must be registered before routes');
});

test('the health endpoint stays reachable so a misconfigured deploy is diagnosable', () => {
  const s = read('server.ts');
  const guard = s.indexOf("app.use('/api', (req: ExpressRequest");
  const body = s.slice(guard, guard + 900);
  assert.match(body, /req\.path === '\/health'/);
});

// ---------------------------------------------------------------------------
// Built output, when a build has been run
// ---------------------------------------------------------------------------

test('if dist exists it contains no server bundle', (t) => {
  if (!existsSync(join(root, 'dist'))) return t.skip('no build output present');
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((e) => {
      const full = join(d, e);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  const offenders = walk(join(root, 'dist')).filter((f) => /\.(cjs|map)$/i.test(f));
  assert.deepEqual(offenders, [], `server source published in dist: ${offenders.join(', ')}`);
});
