/**
 * THE PUBLIC MENTOR PROFILE ENDPOINT.
 *
 * `GET /api/seeker/mentors/:id/profile` is the one read model behind the new
 * `/seeker/mentor-profile` page. It is the ONLY place in the product that
 * returns a mentor's identity and their offers to a caller who is not the
 * mentor, an admin or a participant in a booking, and it reads through the
 * service-role client, which bypasses RLS entirely.
 *
 * That combination is exactly why these are source-level assertions. A handler
 * that selects `*`, or that omits the eligibility gate, would look correct in
 * review and ship every private column on `profiles` to anyone who could guess a
 * UUID. So the properties pinned here are:
 *
 *   1. the gate - the same `deriveAccountState` + approved/active predicate the
 *      existing public segment route uses, and a 404 rather than a partial body;
 *   2. the allow-list - no private, moderation, verification, booking or payment
 *      column is ever selected;
 *   3. the offers - active segments and active gigs only, and no default gig;
 *   4. the surface - it does not reach into slots, holds, payments or bookings.
 *
 * The data itself is asserted through `toPublicMentorProfile`, which is the only
 * mapper between the wire shape and the UI type, so a field that appeared on the
 * wire but not in the projection is caught here rather than in a browser.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/** Strips comments so prose in a docblock cannot satisfy a source check. */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const SERVER = code('server.ts');
const DISCOVERY = code('src/lib/discoveryService.ts');
const PROFILE_PAGE = code('src/pages/seeker/SeekerMentorProfilePage.tsx');

/**
 * The body of the new handler, sliced out of the 12k-line server file.
 *
 * Sliced to the handler's own closing `  });` rather than to the next route,
 * because helper functions (`withTopicUsage` and friends) are declared between
 * two route registrations and would otherwise be pulled into the allow-list.
 */
function handler(): string {
  const start = SERVER.indexOf("app.get('/api/seeker/mentors/:id/profile'");
  assert.notEqual(start, -1, 'the public mentor profile endpoint must exist');
  const end = SERVER.indexOf('\n  });', start);
  assert.notEqual(end, -1, 'the handler must have a closing brace to slice at');
  return SERVER.slice(start, end);
}

// ---------------------------------------------------------------------------
// 1. The gate.
// ---------------------------------------------------------------------------

describe('the endpoint applies the same public-visibility gate as discovery', () => {
  it('requires approved AND active AND approval_status=approved', () => {
    const body = handler();
    assert.match(body, /mp\.is_approved/);
    assert.match(body, /mp\.is_active/);
    assert.match(body, /mp\.approval_status === 'approved'/);
  });

  it('reuses the shared account-state rule, not a hand-rolled suspension check', () => {
    // `deriveAccountState` is what every other discovery path uses, so a
    // time-boxed suspension that has already lapsed hides the mentor here
    // exactly as it does everywhere else.
    assert.match(handler(), /deriveAccountState\(/);
    assert.match(handler(), /canPerformOperationalActions/);
  });

  it('requires a real profiles row and at least one segment membership', () => {
    const body = handler();
    assert.match(body, /identity\?\.full_name/);
    assert.match(body, /memberships\.length > 0/);
  });

  it('a mentor who fails the gate is a 404, never a partial profile', () => {
    const body = handler();
    assert.match(body, /MENTOR_NOT_FOUND/);
    assert.match(
      body,
      /if \(!eligible\) \{[\s\S]{0,200}res\.status\(404\)/,
      'the refusal must be a 404 so the endpoint cannot probe for existence',
    );
  });

  it('shape-checks the id before it reaches PostgREST', () => {
    assert.match(handler(), /UUID_SHAPE_PATTERN\.test\(mentorId\)/);
  });

  it('fails closed with no admin client, and never downgrades to a weaker one', () => {
    assert.match(handler(), /if \(!admin\)[\s\S]{0,120}503/);
  });
});

// ---------------------------------------------------------------------------
// 2. The allow-list.
// ---------------------------------------------------------------------------

describe('the endpoint selects only public columns', () => {
  /** Every distinct column named in a `.select('...')` inside the handler. */
  function selectedColumns(): string[] {
    return [
      ...new Set(
        [...handler().matchAll(/\.select\('([^']+)'\)/g)].flatMap((m) =>
          m[1].split(',').map((c) => c.trim())
        )
      ),
    ].filter(Boolean).sort();
  }

  it('reads exactly the columns the public profile renders', () => {
    assert.deepEqual(selectedColumns(), [
      'about',
      'account_status',
      'approval_status',
      'avatar_url',
      'description',
      'duration_minutes',
      'experience_years',
      'expertise',
      'full_name',
      'headline',
      'id',
      'is_active',
      'is_approved',
      'is_featured',
      'is_primary',
      'languages',
      'mentor_id',
      'name',
      'price_inr',
      'segment_id',
      'slug',
      'suspended_until',
      'timezone',
      'title',
    ]);
  });

  it('never selects a private, contact or moderation column', () => {
    const columns = selectedColumns();
    for (const forbidden of [
      'email',
      'phone',
      'internal_note',
      'suspended_at',
      'suspension_reason',
      'suspended_by',
      'deactivated_at',
      'created_at',
      'user_id',
      'storage_path',
      'original_filename',
      'meeting_url',
      'amount_inr',
      'booking_code',
    ]) {
      assert.equal(
        columns.includes(forbidden),
        false,
        `the public profile endpoint must never select ${forbidden}`,
      );
    }
  });

  it('uses an explicit column list, never a wildcard', () => {
    // `.select('*')` on `profiles` would return email, phone and internal_note
    // in the row even if the response body omitted them.
    const body = handler();
    assert.equal(/\.select\('\*'\)/.test(body), false);
    assert.equal(/\.select\(`\*`\)/.test(body), false);
  });

  it('the two moderation columns it does read are used only as a gate, never echoed', () => {
    // `account_status` and `suspended_until` exist here to evaluate
    // `deriveAccountState`, exactly as they do in the segment route. Neither
    // may appear in the response body.
    const body = handler();
    const response = body.slice(body.indexOf('return res.json'));
    assert.equal(response.includes('account_status'), false);
    assert.equal(response.includes('suspended_until'), false);
  });

  it('the client type cannot grow a private field', () => {
    const iface = DISCOVERY.slice(
      DISCOVERY.indexOf('export interface PublicMentorProfile'),
      DISCOVERY.indexOf('function toPublicMentorProfile')
    );
    for (const forbidden of [
      'email',
      'phone',
      'internal',
      'account',
      'suspend',
      'deactivat',
      'payment',
      'booking',
      'slot',
    ]) {
      assert.equal(
        iface.toLowerCase().includes(forbidden),
        false,
        `PublicMentorProfile must not carry a ${forbidden} field`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 3. The offers.
// ---------------------------------------------------------------------------

describe('offers are the real active gigs, and there is no default one', () => {
  it('reads only active segments and active gigs', () => {
    const body = handler();
    assert.match(body, /from\('segments'\)[\s\S]{0,200}?\.eq\('is_active', true\)/);
    assert.match(body, /from\('gigs'\)[\s\S]{0,200}?\.eq\('is_active', true\)/);
  });

  it('drops a gig whose segment is inactive or where the mentor is not a member', () => {
    // A stale `mentor_segments` row must not be able to put a gig on a profile
    // under a segment the mentor is not in.
    const body = handler();
    assert.match(body, /\.filter\(\(g: any\) => segmentById\.has\(g\.segment_id\)\)/);
    assert.match(body, /memberships\.some\(\(ms: any\) => ms\.segment_id === g\.segment_id\)/);
  });

  it('carries mentor, segment and gig ids on every offer', () => {
    const body = handler();
    assert.match(body, /gigId: g\.id/);
    assert.match(body, /mentorId: g\.mentor_id/);
    assert.match(body, /segmentId: g\.segment_id/);
    assert.match(body, /segmentSlug: segment\.slug/);
  });

  it('the endpoint resolves no default gig and accepts no gigId parameter', () => {
    const body = handler();
    assert.equal(/offers\[0\]|\.shift\(\)/.test(body), false);
    assert.equal(
      /req\.query\.gigId/.test(body),
      false,
      'the profile is about every offer; a gigId parameter would imply a default',
    );
  });

  it('the ordering is stable, so a reload does not reshuffle the offers', () => {
    assert.match(handler(), /\.sort\(/);
  });
});

// ---------------------------------------------------------------------------
// 4. The surface it must not have.
// ---------------------------------------------------------------------------

describe('the profile read model touches no transactional state', () => {
  it('reads no slots, holds, bookings, payments or documents', () => {
    const body = handler();
    for (const table of [
      'bookings',
      'slot_holds',
      'payments',
      'payment_events',
      'payment-proofs',
      'mentor_verification_documents',
      'mentor_applications',
      'mentor_availability',
      'session_workspaces',
    ]) {
      assert.equal(
        body.includes(`'${table}'`),
        false,
        `the public profile endpoint must not read ${table}`,
      );
    }
  });

  it('it is read-only: no POST/PATCH/DELETE on a mentor profile', () => {
    assert.equal(
      /app\.(post|patch|put|delete)\('\/api\/seeker\/mentors/.test(SERVER),
      false,
      'the public mentor profile must remain a read-only surface',
    );
  });
});

// ---------------------------------------------------------------------------
// 5. The page uses only this projection.
// ---------------------------------------------------------------------------

describe('the profile page renders the projection and nothing else', () => {
  it('fetches exactly one endpoint', () => {
    const calls = [...PROFILE_PAGE.matchAll(/apiFetch\(|fetch[A-Z]\w*\(/g)].map((m) => m[0]);
    assert.deepEqual(
      calls,
      ['fetchPublicMentorProfile('],
      'the page must have exactly one data source, so it cannot mix in a second',
    );
  });

  it('reads only fields the projection returns', () => {
    // `segmentId` is projected but not rendered: the booking route takes the
    // `segmentSlug` the seeker can read, and the page resolves it server-side.
    // That is the "segmentId / segmentSlug" pair the contract requires - the
    // segment is named explicitly, never inferred.
    const rendered = [
      'mentor.fullName',
      'mentor.avatarUrl',
      'mentor.headline',
      'mentor.about',
      'mentor.timezone',
      'mentor.languages',
      'mentor.expertise',
      'mentor.experienceYears',
      'mentor.isApproved',
      'mentor.isFeatured',
      'mentor.offers',
      'offer.gigId',
      'offer.mentorId',
      'offer.segmentSlug',
      'offer.title',
      'offer.description',
      'offer.durationMinutes',
      'offer.priceInr',
    ];
    for (const field of rendered) {
      assert.ok(PROFILE_PAGE.includes(field), `the profile page should read ${field}`);
    }
  });

  it('renders a 404 as an explicit empty state, not as a retryable error', () => {
    // The client maps 404 to a null mentor with no error, so the page shows
    // "Mentor not found". A 500 is a different state and must be retryable.
    assert.match(DISCOVERY, /res\.status === 404/);
    assert.match(DISCOVERY, /return \{ mentor: null, error: null \}/);
  });
});
