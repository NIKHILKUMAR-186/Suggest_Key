/**
 * ROUTE CONTRACT.
 *
 * The app has no router library: `Router.tsx` is an ordered `if` chain, and the
 * `/seeker`, `/mentor` and `/admin` blocks each fall through to their home page
 * for any path they do not recognise. That fallthrough is why
 * `/seeker/reschedule` could be linked from a fully enabled button for as long
 * as it could: the click "worked", and the seeker was silently dumped on the
 * home page with no error.
 *
 * These are source-level assertions on purpose — the same style as
 * `seeker_header_navigation.test.ts`. They pin the two properties that let that
 * bug hide:
 *
 *   1. every hard-coded `navigate('/…')` destination in the app is a route the
 *      router actually implements, and
 *   2. the mentor block ends in a 404 rather than its home page.
 *
 * A typo in a new link now fails here instead of shipping as a dead end.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = process.cwd();

const code = (file: string): string => readFileSync(resolve(ROOT, file), 'utf8');

const ROUTER = 'src/routes/Router.tsx';
const PAGE_META = 'src/lib/pageMeta.ts';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(resolve(ROOT, dir))) {
    const full = join(dir, entry);
    if (statSync(resolve(ROOT, full)).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Every route the router implements, as documented in docs/architecture.md.
 * Dynamic segments are recorded as the prefix that is actually matched, so a
 * link can be checked against the shape of the route it is allowed to target.
 */
const STATIC_ROUTES = new Set([
  '/',
  '/login',
  '/signup',
  '/auth/login',
  '/auth/signup',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/verify',
  '/auth/callback',
  '/auth/unauthorized',
  '/403',
  '/mentor/signup',
  '/mentor/verification',
  '/mentors',
  '/mentor',
  '/mentor/availability',
  '/mentor/bookings',
  '/mentor/booking-detail',
  '/mentor/workspace',
  '/mentor/gigs',
  '/mentor/segments',
  '/mentor/notifications',
  '/mentor/settings',
  '/seeker',
  '/seeker/mentors',
  '/seeker/mentor-detail',
  '/seeker/booking-detail',
  '/seeker/reschedule',
  '/seeker/payment',
  '/seeker/checkout',
  '/seeker/bookings',
  '/seeker/session',
  '/seeker/workspace',
  '/seeker/notifications',
  '/seeker/settings',
  '/admin',
  '/admin/users',
  '/admin/users/create',
  '/admin/mentor-verification',
  '/admin/mentors',
  '/admin/segments',
  '/admin/bookings',
  '/admin/workspaces',
  '/admin/payments',
  '/admin/notifications',
  '/admin/system-health',
  '/admin/system-health/logs',
  '/admin/settings',
]);

/** Parameterised routes, matched by their documented prefix. */
const PREFIX_ROUTES: Array<[string, string]> = [
  ['/admin/users/', 'AdminUserDetailPage'],
  ['/admin/mentors/', 'AdminMentorDetailPage'],
  ['/admin/mentor-verification/', 'AdminMentorVerificationDetailPage'],
  ['/admin/segments/', 'AdminSegmentDetailPage'],
  ['/admin/system-health/logs/', 'AdminSystemHealthPage'],
  ['/mentors/', 'MentorDirectoryPage'],
];

const isRealRoute = (path: string): boolean =>
  STATIC_ROUTES.has(path) || PREFIX_ROUTES.some(([prefix]) => path.startsWith(prefix));

// ---------------------------------------------------------------------------
// Every navigate() destination is a real route
// ---------------------------------------------------------------------------

describe('every navigate() destination is a route the router implements', () => {
  const offenders: string[] = [];
  let checked = 0;

  for (const file of [
    ...sourceFiles('src/pages'),
    ...sourceFiles('src/components'),
    ...sourceFiles('src/lib'),
    ...sourceFiles('src/context'),
  ]) {
    const source = readFileSync(resolve(ROOT, file), 'utf8');
    // Static destinations only. A template literal containing an interpolation
    // is a dynamic path and is checked by the param-shape tests below.
    for (const match of source.matchAll(/navigate\(\s*'([^']+)'/g)) {
      const raw = match[1];
      const path = raw.split('?')[0];
      checked += 1;
      if (!isRealRoute(path)) offenders.push(`${file}: ${raw}`);
    }
  }

  it('scans the app and finds destinations to check', () => {
    assert.ok(checked > 50, `expected many navigate() calls, only found ${checked}`);
  });

  it('has no dead navigate() target', () => {
    assert.deepEqual(
      offenders,
      [],
      'these navigate() destinations are not routes Router.tsx implements:\n' +
        offenders.join('\n'),
    );
  });
});

// ---------------------------------------------------------------------------
// The list and the router agree
// ---------------------------------------------------------------------------

describe('the route list and Router.tsx cannot drift apart', () => {
  it('every route in the list is actually implemented by the router', () => {
    const source = code(ROUTER);
    const missing = [...STATIC_ROUTES].filter((path) => !source.includes(`'${path}'`));
    assert.deepEqual(
      missing,
      [],
      'these routes are listed as real but Router.tsx no longer implements them:\n' +
        missing.join('\n'),
    );
  });

  it('every path the router matches is in the list', () => {
    const source = code(ROUTER);
    // Literal paths the router compares against `pathname`, minus the public
    // auth aliases, which are listed too. Anything the router matches but the
    // list omits would let a new link escape the checks above.
    const matched = new Set(
      [...source.matchAll(/pathname === '([^']+)'/g)].map((m) => m[1]),
    );
    const unlisted = [...matched].filter((path) => !isRealRoute(path));
    assert.deepEqual(
      unlisted,
      [],
      'Router.tsx matches paths the contract does not know about:\n' + unlisted.join('\n'),
    );
  });
});

// ---------------------------------------------------------------------------
// The routes that the audit found missing
// ---------------------------------------------------------------------------

describe('the reschedule route exists end to end', () => {
  it('the router serves /seeker/reschedule', () => {
    assert.ok(
      /pathname === '\/seeker\/reschedule'\) return <SeekerReschedulePage \/>/.test(code(ROUTER)),
      'Router.tsx must route /seeker/reschedule to its own page',
    );
    assert.ok(
      code(ROUTER).includes("import { SeekerReschedulePage } from '@/src/pages/seeker/SeekerReschedulePage'"),
      'the page must be imported by the router',
    );
  });

  it('the page is a real page, not a stub', () => {
    const page = code('src/pages/seeker/SeekerReschedulePage.tsx');
    assert.ok(
      page.includes('/reschedule'),
      'it must call the real backend route, not fake a reschedule',
    );
    assert.ok(page.includes('apiFetch'), 'it must send the request authenticated');
    // Server owns every eligibility rule; the page must not re-decide them.
    assert.equal(
      /acquire_slot_hold|slot_holds|from\('bookings'\)/.test(page),
      false,
      'the page must not touch storage or booking state directly',
    );
  });

  it('the page is registered for metadata and title', () => {
    assert.ok(
      /path: '\/seeker\/reschedule'/.test(code(PAGE_META)),
      'pageMeta must know the route, or isKnownRoute would treat it as a 404',
    );
  });

  it('the booking detail button points at the real route', () => {
    assert.ok(
      code('src/pages/seeker/SeekerBookingDetailPage.tsx').includes(
        'navigate(`/seeker/reschedule?bookingId=',
      ),
      'the reschedule button must target the route that now exists',
    );
  });
});

// ---------------------------------------------------------------------------
// Unknown paths must 404, not impersonate a home page
// ---------------------------------------------------------------------------

describe('an unrecognised path is a 404, never a plausible-looking home page', () => {
  it('the mentor block ends in the 404, with /mentor itself named explicitly', () => {
    const source = code(ROUTER);
    assert.ok(
      /if \(pathname === '\/mentor'\) return <MentorHomePage \/>/.test(source),
      '/mentor must be matched on its own, so the home page is no longer the fallthrough',
    );

    const block = source.slice(source.indexOf("pathname.startsWith('/mentor')"));
    assert.ok(
      /return <NotFoundPage \/>;/.test(block),
      'any other /mentor/* path must render the 404',
    );
    // The fallthrough is the bug: it made a dead link look like a success.
    assert.equal(
      /if \(pathname === '\/mentor\/settings'\) return <MentorSettingsPage \/>;\s*return <MentorHomePage \/>/.test(source),
      false,
      'the mentor chain must not fall through to MentorHomePage',
    );
  });

  it('the 404 stays inside the mentor auth guard', () => {
    const source = code(ROUTER);
    const block = source.slice(source.indexOf("pathname.startsWith('/mentor')"));
    const open = block.indexOf('<ProtectedRoute allowedRoles={[\'mentor\', \'admin\']}>');
    const close = block.indexOf('</ProtectedRoute>');
    const notFound = block.indexOf('<NotFoundPage />');
    assert.ok(open !== -1 && close !== -1 && notFound > open && notFound < close,
      'an unknown mentor path must not reveal itself differently to a signed-out visitor');
  });

  it('an unknown mentor path is not a "known route", so the 404 is not double-chromed', () => {
    // AppShell renders children bare when isKnownRoute is false, because the
    // 404 carries its own header. A `/mentor` prefix in pageMeta would keep
    // it "known" and wrap it in MentorShell on top of that header.
    const meta = code(PAGE_META);
    assert.equal(
      /\{ prefix: '\/mentor'/.test(meta),
      false,
      'pageMeta must not treat every /mentor/* path as a known route',
    );
    assert.ok(
      /\{ path: '\/mentor', meta: privatePage\('Mentor Home'\)/.test(meta),
      '/mentor itself must still be a known route',
    );
  });
});

// ---------------------------------------------------------------------------
// API calls are authenticated
// ---------------------------------------------------------------------------

describe('every /api call carries the auth token', () => {
  it('no page calls /api with a bare fetch', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('src')) {
      const source = readFileSync(resolve(ROOT, file), 'utf8');
      for (const match of source.matchAll(/(?<!\w)fetch\(\s*[`'"]\/api\//g)) {
        // `/api/auth/*` is the login/telemetry surface, which is deliberately
        // unauthenticated (AuthContext reports outcomes without a session).
        const line = source.slice(0, match.index).split('\n').length;
        offenders.push(`${file}:${line} ${match[0]}`);
      }
    }
    const unexpected = offenders.filter((o) => !o.includes('/api/auth/'));
    assert.deepEqual(
      unexpected,
      [],
      'a bare fetch() to /api sends no Authorization header. Use apiFetch():\n' +
        unexpected.join('\n'),
    );
  });
});

// ---------------------------------------------------------------------------
// Signed documents are opened by their signed URL
// ---------------------------------------------------------------------------

describe('a private document is only ever opened by its signed URL', () => {
  it('no admin page opens a storage path as if it were a URL', () => {
    for (const file of sourceFiles('src/pages')) {
      const source = readFileSync(resolve(ROOT, file), 'utf8');
      assert.equal(
        /window\.open\([^)]*storage_path/.test(source),
        false,
        `${file} must use the server-minted download_url, not the storage object path`,
      );
      assert.equal(
        /href=\{[^}]*storage_path/.test(source),
        false,
        `${file} must not link a storage object path`,
      );
    }
  });
});
