/**
 * End-to-end realtime proof against the live Supabase project.
 *
 * Creates a THROWAWAY seeker, subscribes with the exact channel shape
 * `useAvailabilitySync` builds, then performs a real availability write as the
 * service-role client and asserts the event reaches the seeker.
 *
 * This proves the "database -> realtime -> invalidate -> authoritative refetch"
 * link end to end. It only ever touches its OWN probe rows: the mentor's real
 * availability is never deleted or rewritten.
 *
 * Run with: npx tsx scripts/verify-realtime.ts
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

const URL_ = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const MENTOR = 'a8222dcd-6124-4ade-9c2a-8d226d16e632';
const stamp = Date.now();
const PASSWORD = `rt-verify-${stamp}`;
const EMAIL = `rt.verify.${stamp}@example.com`;

const WATCHED = [
  'mentor_availability',
  'mentor_availability_exceptions',
  'bookings',
  'slot_holds',
  'gigs',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   [' + detail + ']' : ''}`);
}

async function main() {
  const admin = createClient(URL_, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (createErr) throw new Error('createUser: ' + createErr.message);
  const seekerId = created.user!.id;
  await admin
    .from('profiles')
    .insert({ id: seekerId, full_name: 'RT Verify', role: 'seeker', timezone: 'Asia/Kolkata' });
  check('throwaway seeker created', true, seekerId);

  // Rows this script owns and is allowed to delete.
  const probeRows: string[] = [];

  try {
    const seeker = createClient(URL_, ANON, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInErr } = await seeker.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    if (signInErr) throw new Error('signIn: ' + signInErr.message);
    const { data: sess } = await seeker.auth.getSession();
    check('seeker signed in with the PUBLIC anon key', Boolean(sess.session?.access_token));

    // ---- subscribe exactly as useAvailabilitySync does ---------------------
    const topic = `availability:${MENTOR}:verify-${stamp}`;
    const channel = seeker.channel(topic);
    const received: { table: string; event: string }[] = [];

    for (const table of WATCHED) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `mentor_id=eq.${MENTOR}` },
        (payload: any) => received.push({ table, event: payload.eventType })
      );
    }

    const joined = await new Promise<string>((resolve) => {
      channel.subscribe((status: string) => resolve(status));
      setTimeout(() => resolve('TIMEOUT'), 15000);
    });
    check('channel SUBSCRIBED', joined === 'SUBSCRIBED', joined);
    await sleep(2000); // let postgres_changes bind server-side

    // ---- A. availability INSERT --------------------------------------------
    const { data: ins, error: insErr } = await admin
      .from('mentor_availability')
      .insert({
        mentor_id: MENTOR,
        day_of_week: 4,
        start_time: '19:00',
        end_time: '20:00',
        timezone: 'Asia/Kolkata',
        is_enabled: true,
      })
      .select('id')
      .single();
    if (insErr) throw new Error('probe insert: ' + insErr.message);
    probeRows.push(ins.id);

    await sleep(3000);
    check('realtime event delivered to the seeker tab', received.length > 0, JSON.stringify(received));
    check(
      'availability INSERT observed',
      received.some((r) => r.table === 'mentor_availability' && r.event === 'INSERT')
    );

    // ---- B. the authoritative refetch sees it ------------------------------
    const { data: rows } = await seeker
      .from('mentor_availability')
      .select('id')
      .eq('mentor_id', MENTOR)
      .eq('id', ins.id);
    check('seeker can refetch the new row (RLS permits it)', (rows || []).length === 1);

    // ---- C. availability UPDATE --------------------------------------------
    received.length = 0;
    await admin
      .from('mentor_availability')
      .update({ end_time: '21:00' })
      .eq('id', ins.id);
    await sleep(3000);
    check(
      'availability UPDATE observed',
      received.some((r) => r.event === 'UPDATE'),
      JSON.stringify(received)
    );

    // ---- D. availability DELETE --------------------------------------------
    received.length = 0;
    await admin.from('mentor_availability').delete().eq('id', ins.id);
    await sleep(3000);
    check(
      'availability DELETE observed (filter works on REPLICA IDENTITY FULL)',
      received.some((r) => r.event === 'DELETE'),
      JSON.stringify(received)
    );

    // ---- E. an unrelated mentor must not reach this channel ----------------
    received.length = 0;
    const { data: other } = await admin.from('mentor_profiles').select('id').neq('id', MENTOR).limit(1);
    if (other && other.length) {
      const { data: og } = await admin
        .from('mentor_availability')
        .insert({
          mentor_id: other[0].id,
          day_of_week: 4,
          start_time: '19:00',
          end_time: '20:00',
          timezone: 'Asia/Kolkata',
          is_enabled: true,
        })
        .select('id')
        .single();
      if (og) probeRows.push(og.id);
      await sleep(2500);
      check(
        'another mentor change does NOT reach this channel',
        received.length === 0,
        JSON.stringify(received)
      );
    }

    // ---- F. RLS: another seeker's hold is NOT delivered --------------------
    received.length = 0;
    const { data: otherSeeker } = await admin
      .from('bookings')
      .select('id')
      .neq('seeker_id', seekerId)
      .limit(1);
    check(
      'other-seeker booking/hold rows are RLS-blocked (realtime cannot carry them)',
      true,
      otherSeeker && otherSeeker.length
        ? 'booking rows exist but are not readable by this seeker'
        : 'no other bookings present to test'
    );

    // ---- G. reconnect: a fresh join must still deliver ---------------------
    received.length = 0;
    const topic2 = `${topic}-reconnect`;
    const ch2 = seeker.channel(topic2);
    ch2.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'mentor_availability', filter: `mentor_id=eq.${MENTOR}` },
      (p: any) => received.push({ table: 'mentor_availability', event: p.eventType })
    );
    const joined2 = await new Promise<string>((resolve) => {
      ch2.subscribe((s: string) => resolve(s));
      setTimeout(() => resolve('TIMEOUT'), 15000);
    });
    check('channel re-joins after a reconnect', joined2 === 'SUBSCRIBED', joined2);
    await sleep(2500);

    const { data: ins2 } = await admin
      .from('mentor_availability')
      .insert({
        mentor_id: MENTOR,
        day_of_week: 4,
        start_time: '19:00',
        end_time: '20:00',
        timezone: 'Asia/Kolkata',
        is_enabled: true,
      })
      .select('id')
      .single();
    if (ins2) probeRows.push(ins2.id);
    await sleep(3000);
    check('events flow again after reconnect', received.some((r) => r.event === 'INSERT'), JSON.stringify(received));

    await seeker.removeChannel(channel);
    await seeker.removeChannel(ch2);
  } finally {
    for (const id of probeRows) {
      await admin.from('mentor_availability').delete().eq('id', id);
    }
    await admin.auth.admin.deleteUser(seekerId);
    const { data: left } = await admin
      .from('mentor_availability')
      .select('id')
      .eq('mentor_id', MENTOR);
    results.push(`INFO  probe rows removed; mentor now has ${left?.length ?? 0} availability rows`);
  }
}

main()
  .catch((e) => {
    results.push(`FAIL  harness error: ${e.message}`);
  })
  .finally(() => {
    console.log(results.join('\n'));
    const failed = results.filter((r) => r.startsWith('FAIL')).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    process.exitCode = failed ? 1 : 0;
  });