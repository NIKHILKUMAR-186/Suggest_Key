/**
 * The migration chain must be applicable in filename order, start to finish.
 *
 * Three separate failures came from the same operator mistake: applying phase
 * 14, 29 and 30 while phase 13 had never been run. Each aborted with a bare
 * `42883 function public.<x>() does not exist`, which reads like a defect in the
 * file being applied rather than a missing prerequisite, and in phase 30 it
 * aborted mid-file after earlier sections had already applied.
 *
 * These tests pin the property that makes filename order sufficient:
 *
 *   1. no migration references an object that NO migration creates, and
 *   2. no migration references an object before the migration that creates it.
 *
 * Together they mean a clean database built by applying every file in order
 * cannot hit a missing object. Deliberate existence checks - to_regclass() and
 * to_regprocedure() - are excluded, because referencing an optional object
 * inside a guard is the opposite of a defect.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const dir = join(root, 'supabase/migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

// Schemas this project does not own. Their objects are supplied by Supabase.
const EXTERNAL = new Set([
  'auth', 'storage', 'extensions', 'vault', 'graphql', 'graphql_public',
  'cron', 'net', 'pgrst', 'realtime', 'pg_catalog', 'information_schema',
  'pgcrypto',
]);

const CREATE_RE =
  /CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|VIEW|MATERIALIZED\s+VIEW|TABLE|TYPE|SCHEMA|SEQUENCE)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?("?[A-Za-z_][\w$]*"?)/gi;
const REF_RE = /(?:public\.)("?[A-Za-z_][\w$]*"?)/g;
const GUARD_RE = /to_reg(?:class|procedure)\s*\(\s*'public\.([A-Za-z_][\w$]*)/gi;

interface Ref {
  name: string;
  file: string;
  index: number;
  line: number;
  code: string;
}

const created = new Map<string, number>(); // name -> file index of first creation
const refs: Ref[] = [];
const guards = new Map<string, number>(); // `${file}:${name}` -> line of the existence check

files.forEach((file, index) => {
  const sql = readFileSync(join(dir, file), 'utf8');

  sql.split(/\r?\n/).forEach((raw, lineNo) => {
    const code = raw.replace(/--.*$/, '');
    const line = lineNo + 1;

    let m: RegExpExecArray | null;
    CREATE_RE.lastIndex = 0;
    while ((m = CREATE_RE.exec(code)) !== null) {
      const name = m[1].replace(/"/g, '').toLowerCase();
      if (!created.has(name)) created.set(name, index);
    }

    // to_regclass('public.x') / to_regprocedure('public.x(...)') are deliberate
    // existence checks for objects this project does not own. They may sit on
    // the line before the block they govern, so record the line rather than
    // treating the check and the use as co-located.
    GUARD_RE.lastIndex = 0;
    while ((m = GUARD_RE.exec(code)) !== null) {
      const key = `${file}:${m[1].replace(/"/g, '').toLowerCase()}`;
      if (!guards.has(key)) guards.set(key, line);
    }

    // An existence check is not itself a use of the object.
    const withoutGuards = code.replace(/to_reg(?:class|procedure)\s*\([^)]*\)/gi, '');

    REF_RE.lastIndex = 0;
    while ((m = REF_RE.exec(withoutGuards)) !== null) {
      const name = m[1].replace(/"/g, '').toLowerCase();
      if (EXTERNAL.has(name) || name.startsWith('pg_')) continue;
      refs.push({ name, file, index, line, code: code.trim().slice(0, 100) });
    }
  });
});

/** True when the file explicitly checks for this object before first using it. */
const checkedBeforeUse = (r: Ref) => {
  const at = guards.get(`${r.file}:${r.name}`);
  return at !== undefined && at <= r.line;
};

test('every migration file is uniquely named and sorts into a single order', () => {
  assert.equal(new Set(files).size, files.length, 'duplicate migration filename');
  assert.ok(files.length > 1);
});

test('no migration uses a public object without creating it or checking for it first', () => {
  const orphans = refs.filter((r) => !created.has(r.name) && !checkedBeforeUse(r));
  const detail = orphans
    .map((r) => `  public.${r.name} at ${r.file}:${r.line}  ${r.code}`)
    .join('\n');

  assert.equal(
    orphans.length,
    0,
    `used with no creating migration and no existence check - the chain cannot be applied in order:\n${detail}`,
  );
});

test('every optional object a migration depends on is explicitly existence-checked', () => {
  // The objects this project does not own but depends on. Each one must be
  // reached through a to_regclass/to_regprocedure check, never assumed.
  const optional = [
    'admin_audit_log',
    'availability',
    'availability_exceptions',
    'get_user_role',
  ];

  const unchecked: string[] = [];
  for (const name of optional) {
    const used = refs.filter((r) => r.name === name);
    if (used.length === 0) continue; // no longer referenced: nothing to prove
    if (!used.some(checkedBeforeUse)) unchecked.push(name);
  }

  assert.deepEqual(
    unchecked,
    [],
    'these optional objects are used without a preceding existence check',
  );
});

test('no migration references an object before the migration that creates it', () => {
  const forward = refs.filter((r) => created.get(r.name)! > r.index && !checkedBeforeUse(r));
  const detail = forward
    .map((r) => {
      const creator = files[created.get(r.name)!];
      return `  public.${r.name} used at ${r.file}:${r.line} but created by ${creator}`;
    })
    .join('\n');

  assert.equal(
    forward.length,
    0,
    `forward references - these require a later file to run first:\n${detail}`,
  );
});

test('the phase 30 prerequisite guard names the files the operator must apply', () => {
  // A missing prerequisite must fail the whole file before anything is applied,
  // and must name the remedy rather than repeating the raw 42883.
  const phase30 = readFileSync(
    join(dir, '20261005000000_phase30_reschedule_requests.sql'),
    'utf8'
  );

  assert.match(phase30, /to_regprocedure\('public\.set_updated_at\(\)'\) IS NULL/);
  assert.match(phase30, /20260924000000_phase12_mentor_onboarding\.sql/);
  assert.match(phase30, /20260925000000_phase13_mentor_onboarding_admin_control\.sql/);

  // The guard must precede the first statement that mutates the database.
  const guardAt = phase30.indexOf('to_regprocedure');
  const firstMutationAt = phase30.search(/ALTER\s+TABLE/i);
  assert.ok(guardAt > -1 && guardAt < firstMutationAt, 'the guard must run before any DDL');
});

test('every post-phase-29 SECURITY DEFINER migration keeps its anon containment check', () => {
  // Phase 29 revoked EXECUTE from PUBLIC on all existing SECURITY DEFINER
  // functions. Postgres re-grants EXECUTE to PUBLIC on every NEW function, so a
  // migration shipped after phase 29 must re-assert containment itself.
  const phase29Index = files.indexOf(
    '20261004000000_phase29_security_definer_execute_containment.sql'
  );
  assert.ok(phase29Index > -1, 'phase 29 migration must exist');

  const offenders = files
    .slice(phase29Index + 1)
    .filter((f) => {
      const sql = readFileSync(join(dir, f), 'utf8');
      const addsDefiner = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION[\s\S]*?SECURITY\s+DEFINER/i.test(sql);
      if (!addsDefiner) return false;
      return !/has_function_privilege\('anon'/.test(sql);
    });

  assert.deepEqual(offenders, [], 'these add a SECURITY DEFINER function with no anon post-condition');
});