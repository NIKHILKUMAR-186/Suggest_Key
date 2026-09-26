/**
 * Real booking verification harness.
 *
 * 1. Signs in as the ACTUAL seeker account with a Supabase admin-issued magic
 *    link, producing a genuine access token.
 * 2. Resolves the mentor's real slots through the SAME discovery code the
 *    seeker UI runs (fetchMentorDetail -> generateMentorSlots).
 * 3. Calls POST /api/bookings/hold exactly as the browser does: the real token
 *    in the Authorization header, and NO seeker id or role in the body.
 */
import { createClient } from '@supabase/supabase-js';
import { fetchMentorDetail } from '@/src/lib/discoveryService';

const URL = process.env.VITE_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.VITE_SUPABASE_ANON_KEY;
const API = process.env.TEST_API_URL || 'http://localhost:3000';
const EMAIL = process.env.TEST_SEEKER_EMAIL;

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function getAccessToken(email) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw new Error(`generateLink: ${error.message}`);
  const tokenHash = data?.properties?.hashed_token;
  if (!tokenHash) throw new Error('no hashed_token returned');

  const anon = createClient(URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: sess, error: vErr } = await anon.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'magiclink',
  });
  if (vErr) throw new Error(`verifyOtp: ${vErr.message}`);
  return sess.session.access_token;
}

const run = async () => {
  const token = await getAccessToken(EMAIL);
  const userId = (await admin.auth.getUser(token)).data.user.id;
  console.log(`Authenticated user : ${userId}`);

  const { data: roles } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', userId);
  console.log(`user_roles rows   : ${JSON.stringify(roles)}`);

  const date = process.env.TEST_DATE || '2026-09-26';

  const { data: segs } = await admin
    .from('segments')
    .select('id, name')
    .eq('is_active', true)
    .order('priority', { ascending: true });

  let picked = null;
  for (const seg of segs || []) {
    const { data: disc } = await admin
      .from('mentor_segments')
      .select('mentor_id')
      .eq('segment_id', seg.id);
    for (const row of disc || []) {
      const { mentor, error } = await fetchMentorDetail(row.mentor_id, seg.id, date);
      if (!error && mentor && mentor.available_slots.length > 0) {
        picked = { seg, mentor };
        break;
      }
    }
    if (picked) break;
  }

  if (!picked) {
    console.log(`NO_AVAILABLE_SLOT for ${date}`);
    return;
  }

  const { seg, mentor } = picked;
  console.log(
    `Mentor            : ${mentor.full_name} (${mentor.timezone})`
  );
  console.log(`Segment           : ${seg.name}`);
  console.log(
    `Slots on ${date} : ${mentor.all_slots.length} total, ${mentor.available_slots.length} available`
  );
  mentor.available_slots.forEach((s) =>
    console.log(`   AVAILABLE ${s.local_start_time} -> ${s.local_end_time}  (${s.utc_start_time})`)
  );

  const slot = mentor.available_slots[0];

  const res = await fetch(`${API}/api/bookings/hold`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      mentorId: mentor.id,
      segmentId: mentor.segment.id,
      gigId: mentor.gig.id,
      startTime: slot.utc_start_time,
      endTime: slot.utc_end_time,
    }),
  });

  const body = await res.json();
  console.log(`POST /api/bookings/hold -> HTTP ${res.status}`);
  console.log(JSON.stringify(body, null, 2));

  // Verify against the real database, not the response body.
  const { data: holdRows } = await admin
    .from('slot_holds')
    .select('*')
    .eq('mentor_id', mentor.id)
    .order('created_at', { ascending: false })
    .limit(3);
  console.log('DB slot_holds (latest):');
  console.log(JSON.stringify(holdRows, null, 2));

  const { data: bookingRows } = await admin
    .from('bookings')
    .select('id, booking_code, seeker_id, mentor_id, status, amount_inr, start_time')
    .order('created_at', { ascending: false })
    .limit(3);
  console.log('DB bookings (latest):');
  console.log(JSON.stringify(bookingRows, null, 2));

  if (res.status === 403) {
    console.log('RESULT: ROLE_ERROR');
    process.exitCode = 1;
  } else if (res.status === 201) {
    console.log('RESULT: HOLD_CREATED');
  } else {
    console.log(`RESULT: HTTP_${res.status}`);
  }
};

run().catch((e) => {
  console.error('HARNESS_ERROR', e.stack || e.message);
  process.exitCode = 1;
});
