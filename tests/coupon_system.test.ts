/**
 * Coupon lifecycle and booking pricing snapshot - migration contract tests.
 *
 * These read the phase 39 migration as text and assert the invariants that must
 * hold IN SQL. They cannot execute plpgsql, so each assertion is deliberately
 * about a mechanism the database itself enforces (a CHECK, a UNIQUE, a lock, a
 * revoke) rather than about a runtime result. A behavioural test would need a
 * live database; what this file protects is that someone editing the migration
 * cannot quietly remove the guarantee.
 *
 * Run: npx tsx --test tests/coupon_system.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION = join(
  process.cwd(),
  'supabase',
  'migrations',
  '20261013000000_phase39_coupon_original_price.sql',
);

const sql = readFileSync(MIGRATION, 'utf8');

/** The body of one `CREATE OR REPLACE FUNCTION <name>(...) ... $$;` block. */
const functionBody = (name: string): string => {
  const start = sql.indexOf(`FUNCTION public.${name}(`);
  assert.notEqual(start, -1, `${name} must exist in the migration`);
  const open = sql.indexOf('$$', start);
  const close = sql.indexOf('\n$$;', open);
  assert.ok(open !== -1 && close !== -1, `${name} must have a delimited body`);
  return sql.slice(open + 2, close);
};

test('gigs.original_price_inr cannot fake a saving', () => {
  // `>` and not `>=`: an original price equal to the current price is a
  // struck-through number that saves nothing, which is exactly the lie this
  // column exists to make impossible.
  assert.match(sql, /original_price_inr[\s\S]*?>\s*price_inr/);

  // Nullable, because most gigs have no reduction.
  assert.match(sql, /ADD COLUMN IF NOT EXISTS original_price_inr INTEGER(?![\s\S]{0,40}NOT NULL)/);
});

test('the booking snapshot enforces amount = base - discount at rest', () => {
  assert.match(sql, /chk_booking_pricing_arithmetic[\s\S]*?amount_inr = base_amount_inr - discount_amount_inr/);

  // base_amount_inr is NOT NULL, and existing rows are backfilled to their own
  // amount before that is enforced, so a pre-coupon booking is not left NULL.
  assert.match(sql, /SET base_amount_inr = amount_inr[\s\S]*?WHERE base_amount_inr IS NULL/);
  assert.match(sql, /ALTER COLUMN base_amount_inr SET NOT NULL/);
});

test('a coupon can never take a booking to zero, and the snapshot is all-or-nothing', () => {
  assert.match(sql, /chk_booking_discount_floor[\s\S]*?coupon_id IS NULL OR amount_inr >= 1/);
  assert.match(sql, /chk_booking_coupon_snapshot_complete/);
});

test('bookings.coupon_id RESTRICTS deletes instead of nulling a historical snapshot', () => {
  // SET NULL would leave coupon_code + discount_amount_inr > 0 with no
  // coupon_id and violate chk_booking_coupon_snapshot_complete, silently
  // rewriting the provenance of a booking that may already have been paid.
  assert.match(
    sql,
    /ADD COLUMN IF NOT EXISTS coupon_id UUID REFERENCES public\.coupons\(id\) ON DELETE RESTRICT/,
  );
  assert.doesNotMatch(
    sql,
    /coupon_id UUID REFERENCES public\.coupons\(id\) ON DELETE (SET NULL|CASCADE)/,
  );
});

test('one coupon_usage row per booking is a database fact', () => {
  // This is what lets the status trigger find the reservation without a lookup
  // that could race, and what makes "one coupon per booking" structural.
  assert.match(sql, /booking_id UUID NOT NULL UNIQUE REFERENCES public\.bookings/);
});

test('the lifecycle trigger function is a legal trigger function', () => {
  // Postgres requires `RETURNS trigger` on a function used with EXECUTE
  // FUNCTION in a CREATE TRIGGER; `RETURNS void` fails with 42P17 at apply
  // time. The return type lives in the header, before the $$ body.
  assert.match(
    sql,
    /FUNCTION public\.sync_coupon_usage_for_booking\(\)\s*\nRETURNS trigger\b/,
  );

  // A trigger function must also return NEW (or NULL) on EVERY path -- a bare
  // `RETURN` is only legal for a RETURNS void function.
  const body = functionBody('sync_coupon_usage_for_booking');
  assert.equal(body.match(/^\s*RETURN\s*;/gm), null, 'a trigger function cannot use a bare RETURN');

  // Every RETURN statement carries NEW, and the fall-through path returns too.
  const returns = body.match(/RETURN[^;]*;/g) || [];
  assert.ok(returns.length >= 2, 'each lifecycle branch must return a value');
  for (const statement of returns) {
    assert.match(statement, /RETURN\s+NEW\s*;/);
  }

  // And the whole point of it: it must actually be wired as a trigger.
  assert.match(sql, /CREATE TRIGGER trg_bookings_coupon_usage[\s\S]*?EXECUTE FUNCTION public\.sync_coupon_usage_for_booking\(\)/);
});

test('applying a coupon is an upsert, not a release-then-insert', () => {
  const body = functionBody('apply_coupon_to_booking');

  // A release-then-insert cannot work against UNIQUE(booking_id): the released
  // row still occupies the unique key, so the second insert raises. The upsert
  // is what makes switching code and re-applying the same code both work.
  assert.match(body, /INSERT INTO public\.coupon_usage[\s\S]*?ON CONFLICT \(booking_id\) DO UPDATE/);
  assert.doesNotMatch(body, /release_reason\s*=\s*'REPLACED_BY_NEW_COUPON'/);
});

test('usage limits exclude the applying booking, so re-applying is idempotent', () => {
  const body = functionBody('apply_coupon_to_booking');

  // Counting this booking's own reservation would report a limit already
  // reached for a coupon the seeker demonstrably holds.
  assert.match(body, /status IN \('RESERVED', 'REDEEMED'\)\s*\n\s*AND booking_id <> v_booking\.id/);
  assert.match(body, /AND booking_id <> v_booking\.id/);
});

test('RESERVED and REDEEMED both consume the limit', () => {
  const body = functionBody('apply_coupon_to_booking');
  // Excluding RESERVED would let max_total_uses = 1 be claimed by every
  // simultaneous checkout at once.
  assert.match(body, /status IN \('RESERVED', 'REDEEMED'\)/);
});

test('the coupon row is locked before usage is counted', () => {
  const body = functionBody('apply_coupon_to_booking');

  // The lock must come after the booking lock (to avoid a lock-order inversion
  // against the remove path) and before the counts, or two concurrent applies
  // can both read a pre-reservation total and overshoot max_total_uses.
  const lockCoupon = body.indexOf('FROM public.coupons WHERE code = v_code FOR UPDATE');
  const lockBooking = body.indexOf('FROM public.bookings WHERE id = p_booking_id FOR UPDATE');
  const firstCount = body.indexOf('SELECT count(*) INTO v_active_uses');

  assert.ok(lockBooking > -1 && lockCoupon > -1 && firstCount > -1);
  assert.ok(lockBooking < lockCoupon, 'booking lock must precede coupon lock');
  assert.ok(lockCoupon < firstCount, 'coupon lock must precede the usage count');
});

test('the discount is computed from the snapshotted base, never the live gig price', () => {
  const body = functionBody('apply_coupon_to_booking');

  // A gig price edit between hold and checkout must not move what an existing
  // booking is discounted from.
  assert.match(body, /v_base := v_booking\.base_amount_inr/);
  assert.doesNotMatch(body, /v_base :=\s*v_booking\.gig/);
});

test('a reprice is refused once any payment has started', () => {
  // bookings.status is not enough: razorpayService deliberately leaves the
  // booking at PAYMENT_PENDING while an order is live, so the status check
  // passes even after the gateway has been told an amount. Only a payment that
  // definitively did not happen may still be repriced.
  for (const name of ['apply_coupon_to_booking', 'remove_coupon_from_booking']) {
    const body = functionBody(name);
    assert.match(body, /FROM public\.payments/);
    assert.match(body, /status NOT IN \('FAILED', 'REJECTED'\)/);
    assert.match(body, /COUPON_PAYMENT_IN_FLIGHT/);
  }
});

test('both coupon RPCs verify the caller owns the booking', () => {
  for (const name of ['apply_coupon_to_booking', 'remove_coupon_from_booking']) {
    const body = functionBody(name);
    assert.match(body, /v_booking\.seeker_id <> p_seeker_id/);
    // A NULL seeker_id makes that comparison NULL, which is not TRUE, so the
    // function has to reject NULL before relying on it.
    assert.match(body, /IF p_seeker_id IS NULL THEN[\s\S]*?UNAUTHORIZED/);
  }
});

test('removal restores the base and leaves the usage row released, not deleted', () => {
  const body = functionBody('remove_coupon_from_booking');
  assert.match(body, /amount_inr = v_booking\.base_amount_inr/);
  assert.match(body, /coupon_id = NULL/);
  assert.match(body, /SET status = 'RELEASED'/);
});

test('only a verified payment redeems a coupon', () => {
  // MENTOR_PENDING is the single state that means the money moved, and it is
  // reached by a verified payment and by nothing else. CANCELLED and REJECTED
  // release instead.
  const body = functionBody('sync_coupon_usage_for_booking');
  assert.match(body, /NEW\.status = 'MENTOR_PENDING'[\s\S]*?SET status = 'REDEEMED'/);
  assert.match(body, /NEW\.status IN \('CANCELLED', 'REJECTED'\)[\s\S]*?SET status = 'RELEASED'/);
});

test('the trigger fires on the status change itself, not on column noise', () => {
  const body = functionBody('sync_coupon_usage_for_booking');
  // Without this, every unrelated UPDATE on a booking would rewrite a usage row.
  assert.match(body, /IF NEW\.status = OLD\.status THEN\s*\n\s*RETURN/);
});

test('coupon targeting is OR, so a segment coupon covers every mentor in it', () => {
  const body = functionBody('apply_coupon_to_booking');
  assert.match(body, /v_coupon\.segment_id IS NOT NULL AND v_coupon\.segment_id <> v_booking\.segment_id/);
  assert.match(body, /v_coupon\.mentor_id IS NOT NULL AND v_coupon\.mentor_id <> v_booking\.mentor_id/);
});

test('a coupon row can never claim both a segment and a mentor', () => {
  assert.match(sql, /chk_coupon_not_fully_scoped[\s\S]*?NOT \(segment_id IS NOT NULL AND mentor_id IS NOT NULL\)/);
});

test('a coupon is not executable by any client role', () => {
  // Postgres grants EXECUTE on a new function to PUBLIC, so each of these
  // inherits it by default and would be reachable by the publishable key until
  // explicitly revoked.
  for (const fn of ['apply_coupon_to_booking', 'remove_coupon_from_booking']) {
    assert.match(
      sql,
      new RegExp(`REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${fn}\\([^)]*\\)[\\s\\S]*?FROM\\s+PUBLIC`),
    );
  }
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.sync_coupon_usage_for_booking/);
});

test('both coupon tables are admin-only, so no seeker can read or forge usage', () => {
  assert.match(sql, /ALTER TABLE public\.coupons ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER TABLE public\.coupon_usage ENABLE ROW LEVEL SECURITY/);
  // The admin policies are the only ones: an OR-branch that reached non-admins
  // would reintroduce cross-seeker enumeration.
  assert.doesNotMatch(sql, /CREATE POLICY[^;]*ON public\.coupon_usage[^;]*TO\s+authenticated/);
});

test('the migration is forward-only and safe to re-run', () => {
  // Supabase replays a migration file whole; an unguarded CREATE FUNCTION would
  // collide on a retry, so the containment re-check at the end must be written
  // to tolerate an already-correct state.
  assert.match(sql, /DROP CONSTRAINT IF EXISTS chk_booking_pricing_arithmetic/);
  assert.match(sql, /DROP TRIGGER IF EXISTS trg_bookings_coupon_usage/);
});