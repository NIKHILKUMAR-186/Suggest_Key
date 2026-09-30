import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { APP_CONFIG, HOLDOUT_MINUTES } from '../src/config/app';
import { RAZORPAY_ORDER_EXPIRY_SECONDS } from '../src/lib/razorpayConfig';

/**
 * The booking hold is 5 minutes. The database is authoritative and reads
 * `platform_config.hold_duration_minutes`; these checks pin the TypeScript side
 * to the same value and, because the SQL is not reachable from a unit test,
 * scan the live migration sources for a reintroduced 15-minute literal.
 */

const FIVE_MINUTES_MS = 5 * 60 * 1000;

test('the hold window is 5 minutes everywhere the app states it', () => {
  assert.equal(APP_CONFIG.HOLD_DURATION_MS, FIVE_MINUTES_MS);
  assert.equal(HOLDOUT_MINUTES, 5);
  // A gateway order must never outlive the hold that reserves the slot.
  assert.equal(RAZORPAY_ORDER_EXPIRY_SECONDS, 300);
});

test('no TypeScript source declares a 15-minute hold duration', () => {
  const offenders: string[] = [];
  for (const file of tsSources('src')) {
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (/(HOLD_DURATION_MS|HOLDOUT_MINUTES|RAZORPAY_ORDER_EXPIRY_SECONDS|hold)/i.test(line) && /15\s*(\*\s*60|minutes?)/i.test(line)) {
          offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
  }
  readFileSync('server.ts', 'utf8')
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (/hold/i.test(line) && /15\s*(\*\s*60|minutes?)/i.test(line)) {
        offenders.push(`server.ts:${i + 1}: ${line.trim()}`);
      }
    });
  assert.deepEqual(offenders, []);
});

test('the live SQL hold functions carry no hardcoded 15-minute literal', () => {
  const sql = readFileSync(latestHoldMigration(), 'utf8');

  // Canonical config row.
  assert.match(sql, /INSERT INTO public\.platform_config[\s\S]*?VALUES \(1, 5\)/);
  // One reader of that config, used by both hold-writing functions.
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.hold_duration_interval\(\)/);
  for (const fn of ['acquire_slot_hold', 'create_booking_with_hold']) {
    const body = sql.slice(sql.indexOf(`FUNCTION public.${fn}(`));
    assert.match(body, /expires_at[\s\S]{0,200}hold_duration_interval\(\)/, `${fn} must read the canonical hold duration`);
  }
  // No hidden 15-minute window in any function this migration installs.
  // The trailing verification block is prose, not an installed function.
  const installed = sql.split(/CREATE OR REPLACE FUNCTION/).slice(1).map((b) => b.split(/\$\$;/)[0]);
  for (const body of installed) {
    assert.doesNotMatch(body, /15 minutes/, body.slice(0, 60));
  }
  // Expiry logic still compares against expires_at, so a shorter window is honoured.
  assert.match(sql, /status = 'ACTIVE'\s+AND expires_at <= NOW\(\)/);
  // Confirmed/active bookings are still never swept: only PAYMENT_PENDING is cancelled.
  assert.match(sql, /WHERE status = 'PAYMENT_PENDING'/);
});

function tsSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsSources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/**
 * The migration that INSTALLS the canonical hold-duration reader.
 *
 * This must match on the `CREATE OR REPLACE FUNCTION public.hold_duration_interval`
 * definition, not merely on a mention of the name. A later migration may
 * legitimately redefine `create_booking_with_hold` — to add a validation, say —
 * and that body still has to read the canonical duration, but it does not
 * re-declare the config table or the reader. Matching a bare mention made this
 * selector pick that migration and then assert on a config insert it never
 * contained, which fails for a correct file.
 */
function latestHoldMigration(): string {
  const dir = 'supabase/migrations';
  const file = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .filter((name) =>
      readFileSync(join(dir, name), 'utf8').includes(
        'CREATE OR REPLACE FUNCTION public.hold_duration_interval()'
      )
    )
    .pop();
  assert.ok(file, 'a migration must install hold_duration_interval()');
  return join(dir, file);
}

/**
 * Every hold-writing function installed AFTER the canonical reader must read it.
 *
 * This is the invariant that keeps a 5-minute hold from silently reverting to
 * 15: the original `INTERVAL '15 minutes'` literal is what that phase removed,
 * and a redefinition that hardcodes a window again would reintroduce it.
 *
 * Scope matters. The schema and the first `acquire_slot_hold` predate
 * `hold_duration_interval()`, so at that point a literal was the only option and
 * asserting otherwise would flag correct history. The check therefore starts at
 * the migration that introduces the reader: from there on, every installed
 * hold-writing function has to use it. A later migration may legitimately
 * redefine `create_booking_with_hold` to add a validation, and that is exactly
 * the case this covers.
 */
test('every hold-writing function installed after the canonical reader uses it', () => {
  const dir = 'supabase/migrations';
  const names = readdirSync(dir).filter((name) => name.endsWith('.sql')).sort();
  const reader = names.find((name) =>
    readFileSync(join(dir, name), 'utf8').includes(
      'CREATE OR REPLACE FUNCTION public.hold_duration_interval()'
    )
  );
  assert.ok(reader, 'a migration must install hold_duration_interval()');

  const fromReaderOnwards = names.slice(names.indexOf(reader));
  let checked = 0;

  for (const name of fromReaderOnwards) {
    const sql = readFileSync(join(dir, name), 'utf8');
    const installed = sql
      .split(/CREATE OR REPLACE FUNCTION/)
      .slice(1)
      .map((body) => body.split(/\$\$;/)[0]);

    for (const body of installed) {
      const fn = body.slice(0, body.indexOf('(')).trim();
      if (!/hold$/.test(fn)) continue; // hold_duration_interval, expire_stale_holds
      if (!/INSERT INTO public\.slot_holds/.test(body)) continue; // writes no hold
      checked += 1;
      assert.match(
        body,
        /expires_at[\s\S]{0,200}hold_duration_interval\(\)/,
        `${name}: ${fn} must read the canonical hold duration`
      );
      assert.doesNotMatch(
        body,
        /15 minutes/,
        `${name}: ${fn} must not reintroduce the 15-minute literal`
      );
    }
  }

  assert.ok(checked > 0, 'at least one hold-writing function must be checked');
});
