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

/** The newest migration that installs the hold-writing functions. */
function latestHoldMigration(): string {
  const dir = 'supabase/migrations';
  const file = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .filter((name) => readFileSync(join(dir, name), 'utf8').includes('hold_duration_interval()'))
    .pop();
  assert.ok(file, 'a migration must install hold_duration_interval()');
  return join(dir, file);
}
