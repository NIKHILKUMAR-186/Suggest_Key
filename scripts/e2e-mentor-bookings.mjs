import fs from 'node:fs';
import crypto from 'node:crypto';

/**
 * End-to-end exercise of the MENTOR booking ledger against the LIVE database.
 *
 * This is the regression test for the reported defect: after an admin approved
 * the seeker's payment the mentor was notified, but Mentor -> My Bookings showed
 * "No Pending Confirmations" because the mentor endpoints answered from the
 * in-memory seed database instead of the real `bookings` table.
 *
 * It builds an isolated fixture - one temp mentor owning TWO different gigs, one
 * temp seeker, one temp admin - and runs the whole lifecycle:
 *
 *   booking -> payment proof -> admin approval -> mentor notification
 *   -> GET /api/mentor/bookings (must show BOTH bookings, each with its OWN gig)
 *   -> mentor attaches the meeting link -> the booking leaves Pending and
 *      appears in Upcoming (Confirmed)
 *
 * Every row it creates is deleted again in teardown, so no test data survives.
 */
const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const BASE = env.VITE_SUPABASE_URL.replace(/\/$/, '');
const ANON = env.VITE_SUPABASE_ANON_KEY;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const JH = { ...H, 'Content-Type': 'application/json' };
const JRH = { ...JH, Prefer: 'return=representation' };

const API = process.env.API_BASE || 'http://localhost:3000';
const MENTOR_GIG_TITLES = ['E2E Gig A - Relationship Guidance', 'E2E Gig B - Career Strategy'];

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${extra}`); }
};
const section = (t) => console.log(`\n=== ${t} ===`);

const rest = (p, opts = {}) => fetch(`${BASE}/rest/v1/${p}`, { headers: H, ...opts });
const json = async (r) => { try { return await r.json(); } catch { return null; } };

const signIn = async (email, password) => {
  const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const b = await json(r);
  if (!b?.access_token) throw new Error(`sign-in failed for ${email}: ${r.status} ${JSON.stringify(b)}`);
  return b.access_token;
};

const api = (token) => async (path, init = {}) => {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  return { status: r.status, body: await json(r) };
};

// A real 1x1 PNG so the upload path runs with genuine image bytes.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

const uploadAndSubmit = async ({ token, seekerId, bookingId, ref }) => {
  const storagePath = `${seekerId}/${bookingId}/${crypto.randomUUID()}-payment-proof.png`;
  const up = await fetch(`${BASE}/storage/v1/object/payment-proofs/${storagePath}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
    body: Buffer.from(PNG_B64, 'base64'),
  });
  if (!up.ok) return { status: 0, body: { error: { message: `storage upload ${up.status}` } }, storagePath };
  const r = await api(token)(`/api/seeker/bookings/${bookingId}/payment-proof`, {
    method: 'POST',
    body: JSON.stringify({
      transactionReference: ref, fileName: 'payment-proof.png', mimeType: 'image/png',
      fileSize: 68, storagePath,
    }),
  });
  return { ...r, storagePath };
};

const main = async () => {
  const stamp = Date.now();
  const suffix = `mtr${stamp}`;
  const pw = `Pw-${stamp}-aA1`;

  const mkUser = async (email, role) => {
    const created = await json(await fetch(`${BASE}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { ...JH },
      body: JSON.stringify({ email, password: pw, email_confirm: true }),
    }));
    if (!created?.id) throw new Error(`could not create ${role}: ${JSON.stringify(created)}`);
    await rest(`user_roles`, { method: 'POST', headers: JH, body: JSON.stringify({ user_id: created.id, role }) });
    return created;
  };

  const seekerUser = await mkUser(`${suffix}-seeker@example.test`, 'seeker');
  const mentorUser = await mkUser(`${suffix}-mentor@example.test`, 'mentor');
  const adminUser = await mkUser(`${suffix}-admin@example.test`, 'admin');
  const seekerToken = await signIn(`${suffix}-seeker@example.test`, pw);
  const mentorToken = await signIn(`${suffix}-mentor@example.test`, pw);
  const adminToken = await signIn(`${suffix}-admin@example.test`, pw);

  const seekerId = seekerUser.id;
  const mentorId = mentorUser.id;
  const adminId = adminUser.id;

  // A mentor may hold at most ONE active gig per segment
  // (`uq_active_gig_per_mentor_segment`), so the two gigs deliberately sit in
  // two different segments - which is exactly the "mentor with several gigs"
  // case that used to be ambiguous.
  const segs = await json(await rest(`segments?select=id,name&limit=2`));
  if (!Array.isArray(segs) || segs.length < 2) throw new Error('need two segments for the two gigs');
  const segmentNames = segs.map((s) => s.name);

  const gigIds = [];
  const bookingIds = [];
  const createdPaths = [];

  const cleanup = async () => {
    for (const p of createdPaths) await rest(`object/payment-proofs/${p}`, { method: 'DELETE' });
    if (bookingIds.length) {
      await rest(`payments?booking_id=in.(${bookingIds.join(',')})`, { method: 'DELETE' });
      await rest(`notifications?user_id=in.(${seekerId},${mentorId},${adminId})`, { method: 'DELETE' });
      await rest(`bookings?id=in.(${bookingIds.join(',')})`, { method: 'DELETE' });
    }
    if (gigIds.length) await rest(`gigs?id=in.(${gigIds.join(',')})`, { method: 'DELETE' });
    await rest(`mentor_profiles?id=eq.${mentorId}`, { method: 'DELETE' });
    await rest(`user_roles?user_id=in.(${seekerId},${mentorId},${adminId})`, { method: 'DELETE' });
    for (const uid of [seekerId, mentorId, adminId]) {
      await fetch(`${BASE}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: JH });
    }
  };

  try {
    section('0. Fixture: one mentor, two distinct gigs');
    await rest(`mentor_profiles`, {
      method: 'POST', headers: JH,
      body: JSON.stringify({
        id: mentorId, headline: 'E2E mentor', experience_years: 1, languages: ['en'],
        rating: 0, review_count: 0, session_count: 0, is_approved: true, is_featured: false,
        approval_status: 'approved', is_active: true,
      }),
    });

    const durations = [60, 45];
    for (let i = 0; i < MENTOR_GIG_TITLES.length; i++) {
      const res = await rest(`gigs`, {
        method: 'POST', headers: JRH,
        body: JSON.stringify({
          mentor_id: mentorId, segment_id: segs[i].id, title: MENTOR_GIG_TITLES[i],
          description: 'temp e2e gig', duration_minutes: durations[i],
          price_inr: 700 + i * 100, is_active: true,
        }),
      });
      if (res.status >= 400) throw new Error(`gig insert failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const row = (await json(res))[0];
      gigIds.push(row.id);
    }
    check('mentor owns two separate gigs', gigIds.length === 2 && gigIds[0] !== gigIds[1]);

    // Two bookings on the SAME mentor, each for a DIFFERENT gig and a
    // different, non-overlapping slot.
    const bookings = [];
    for (let i = 0; i < 2; i++) {
      const start = Date.now() + (i + 1) * 3 * 864e5;
      const res = await rest(`bookings`, {
        method: 'POST', headers: JRH,
        body: JSON.stringify({
          booking_code: `${suffix}-BK${i + 1}`, mentor_id: mentorId, seeker_id: seekerId,
          gig_id: gigIds[i], segment_id: segs[i].id,
          start_time: new Date(start).toISOString(),
          end_time: new Date(start + durations[i] * 60000).toISOString(),
          seeker_timezone: 'Asia/Kolkata', mentor_timezone: 'Asia/Kolkata',
          amount_inr: 700 + i * 100, status: 'PAYMENT_PENDING',
        }),
      });
      if (res.status >= 400) throw new Error(`booking insert failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const row = (await json(res))[0];
      bookings.push(row);
      bookingIds.push(row.id);
    }
    check('two bookings created against the same mentor', bookings.length === 2);

    const asSeeker = api(seekerToken);
    const asMentor = api(mentorToken);
    const asAdmin = api(adminToken);

    section('1. Before approval: nothing is confirmed yet');
    const before = await asMentor('/api/mentor/bookings');
    check('mentor ledger responds 200', before.status === 200, `got ${before.status}`);
    const beforeIds = (before.body?.bookings ?? []).map((b) => b.id);
    check('both bookings are visible to the mentor', bookingIds.every((id) => beforeIds.includes(id)), JSON.stringify(beforeIds));
    check('no booking is CONFIRMED before payment approval',
      (before.body?.bookings ?? []).every((b) => b.status !== 'CONFIRMED'));
    check('no meeting link is attached yet',
      (before.body?.bookings ?? []).every((b) => !b.meeting_url));

    section('2. Payment proof -> admin approval, once per booking');
    const payments = [];
    for (let i = 0; i < bookings.length; i++) {
      const ref = `MTR${crypto.randomInt(100000, 999999)}`;
      const sub = await uploadAndSubmit({ token: seekerToken, seekerId, bookingId: bookings[i].id, ref });
      if (sub.storagePath) createdPaths.push(sub.storagePath);
      check(`payment proof for booking ${i + 1} accepted`, sub.status === 201, `got ${sub.status} ${JSON.stringify(sub.body)}`);
      const payId = sub.body?.payment?.id;
      payments.push(payId);

      const appr = await asAdmin(`/api/admin/payments/${payId}/approve`, { method: 'PATCH' });
      check(`admin approval for booking ${i + 1} returns 200`, appr.status === 200, `got ${appr.status}`);

      const row = (await json(await rest(`bookings?id=eq.${bookings[i].id}&select=status`)))[0];
      check(`booking ${i + 1} advanced to MENTOR_PENDING`, row?.status === 'MENTOR_PENDING', row?.status);
    }

    section('3. Mentor notification points at the exact booking');
    for (let i = 0; i < bookings.length; i++) {
      const notifs = await json(await rest(
        `notifications?user_id=eq.${mentorId}&entity_type=eq.booking&entity_id=eq.${bookings[i].id}&select=id,event_type,link`
      ));
      check(`mentor notified for booking ${i + 1}`, (notifs?.length ?? 0) === 1, JSON.stringify(notifs));
      check(`notification link opens booking ${i + 1} exactly`,
        notifs?.[0]?.link === `/mentor/booking-detail?bookingId=${bookings[i].id}`, notifs?.[0]?.link);
    }

    section('4. Mentor My Bookings shows both, each with its OWN gig');
    const after = await asMentor('/api/mentor/bookings');
    const rows = after.body?.bookings ?? [];
    check('both bookings appear after approval', bookingIds.every((id) => rows.some((b) => b.id === id)));

    const byId = new Map(rows.map((b) => [b.id, b]));
    for (let i = 0; i < bookings.length; i++) {
      const b = byId.get(bookings[i].id);
      check(`booking ${i + 1} is MENTOR_PENDING (Pending Confirmation tab)`, b?.status === 'MENTOR_PENDING', b?.status);
      check(`booking ${i + 1} shows ITS OWN gig title`, b?.gig?.title === MENTOR_GIG_TITLES[i], b?.gig?.title);
      check(`booking ${i + 1} gig id is the one the seeker selected`, b?.gig_id === gigIds[i]);
      check(`booking ${i + 1} shows the real segment`, b?.segment?.name === segmentNames[i], b?.segment?.name);
      check(`booking ${i + 1} shows the seeker`, b?.seeker?.id === seekerId);
      check(`booking ${i + 1} shows the verified payment`, b?.payment?.status === 'VERIFIED', b?.payment?.status);
      check(`booking ${i + 1} keeps the booking-time price snapshot`, b?.amount_inr === bookings[i].amount_inr, b?.amount_inr);
      check(`booking ${i + 1} duration comes from the booked window`, b?.duration_minutes === durations[i], b?.duration_minutes);
      check(`booking ${i + 1} carries a meeting-link deadline`, !!b?.deadlineInfo?.deadlineUtc);
    }
    // The decisive assertion for a mentor with several gigs: no mixing.
    check('the two bookings never show each other\'s gig',
      rows.filter((b) => bookingIds.includes(b.id))
        .map((b) => b.gig?.title).sort().join('|') === [...MENTOR_GIG_TITLES].sort().join('|'),
      JSON.stringify(rows.filter((b) => bookingIds.includes(b.id)).map((b) => b.gig?.title)));

    section('5. Opening the booking from the notification returns the same record');
    for (let i = 0; i < bookings.length; i++) {
      const detail = await asMentor(`/api/mentor/bookings/${bookings[i].id}`);
      check(`booking ${i + 1} detail loads`, detail.status === 200, `got ${detail.status}`);
      check(`booking ${i + 1} detail has the same booking code`, detail.body?.booking?.booking_code === bookings[i].booking_code);
      check(`booking ${i + 1} detail has the same gig`, detail.body?.booking?.gig?.title === MENTOR_GIG_TITLES[i]);
      check(`booking ${i + 1} detail has the same payment state`, detail.body?.booking?.payment?.status === 'VERIFIED');
    }

    section('6. Another mentor cannot read these bookings');
    const stranger = await mkUser(`${suffix}-other-mentor@example.test`, 'mentor');
    const otherToken = await signIn(`${suffix}-other-mentor@example.test`, pw);
    const foreign = await api(otherToken)(`/api/mentor/bookings/${bookings[0].id}`);
    check('booking detail for a foreign mentor is 403', foreign.status === 403, `got ${foreign.status}`);
    const foreignList = await api(otherToken)('/api/mentor/bookings');
    check('foreign mentor sees none of these bookings',
      (foreignList.body?.bookings ?? []).every((b) => !bookingIds.includes(b.id)));
    await rest(`user_roles?user_id=eq.${stranger.id}`, { method: 'DELETE' });
    await fetch(`${BASE}/auth/v1/admin/users/${stranger.id}`, { method: 'DELETE', headers: JH });

    section('7. Mentor attaches the meeting link -> Upcoming (Confirmed)');
    const meetingUrl = `https://meet.google.com/e2e-${stamp}`;
    const confirm = await asMentor(`/api/mentor/bookings/${bookings[0].id}/confirm`, {
      method: 'POST', body: JSON.stringify({ meetingUrl }),
    });
    check('mentor confirmation returns 200', confirm.status === 200, `got ${confirm.status} ${JSON.stringify(confirm.body)}`);

    const confirmed = (await json(await rest(`bookings?id=eq.${bookings[0].id}&select=status,meeting_url`)))[0];
    check('confirmed booking is CONFIRMED', confirmed?.status === 'CONFIRMED', confirmed?.status);
    check('confirmed booking stored the meeting url', confirmed?.meeting_url === meetingUrl, confirmed?.meeting_url);

    const final = await asMentor('/api/mentor/bookings');
    const finalRows = final.body?.bookings ?? [];
    const confirmedRow = finalRows.find((b) => b.id === bookings[0].id);
    const stillPending = finalRows.find((b) => b.id === bookings[1].id);
    check('confirmed booking is in the Upcoming (Confirmed) tab, not Pending',
      confirmedRow?.status === 'CONFIRMED' && stillPending?.status === 'MENTOR_PENDING',
      `${confirmedRow?.status} / ${stillPending?.status}`);
    check('confirmed booking still shows its own gig', confirmedRow?.gig?.title === MENTOR_GIG_TITLES[0], confirmedRow?.gig?.title);
    check('no duplicate booking was created', finalRows.filter((b) => b.id === bookings[0].id).length === 1);

    const seekerNotifs = await json(await rest(
      `notifications?user_id=eq.${seekerId}&entity_id=eq.${bookings[0].id}&event_type=eq.MENTOR_CONFIRMED&select=id`
    ));
    check('seeker is notified of the mentor confirmation', (seekerNotifs?.length ?? 0) >= 1, JSON.stringify(seekerNotifs));
  } finally {
    section('Cleanup');
    await cleanup();
    console.log('  temp bookings left:', JSON.stringify(await json(await rest(`bookings?booking_code=like.${suffix}-*&select=id`))));
    console.log('  temp gigs left:', JSON.stringify(await json(await rest(`gigs?id=in.(${gigIds.join(',') || '00000000-0000-0000-0000-000000000000'})&select=id`))));
  }

  console.log(`\n============  ${pass} passed, ${fail} failed  ============`);
  process.exit(fail === 0 ? 0 : 1);
};

main().catch((e) => { console.error('E2E ERROR:', e); process.exit(1); });
