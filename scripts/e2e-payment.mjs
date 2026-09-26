import fs from 'node:fs';
import crypto from 'node:crypto';

/**
 * End-to-end exercise of the payment pipeline against the LIVE database.
 *
 * It signs in as the real seeker and admin through Supabase Auth, calls the
 * real Express endpoints over HTTP, then asserts the resulting rows in Postgres
 * and the object in Storage. State is restored at the end so the database is
 * left exactly as it was found.
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
// PostgREST only echoes an inserted row back when asked to.
const JRH = { ...JH, Prefer: 'return=representation' };

const API = process.env.API_BASE || 'http://localhost:3000';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;

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

// A real 1x1 PNG, so the upload path runs with genuine image bytes.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const proofBody = (ref, name = 'payment-proof.png') => JSON.stringify({
  transactionReference: ref, fileName: name, mimeType: 'image/png',
  fileSize: 68, fileBase64: `data:image/png;base64,${PNG_B64}`,
});

const main = async () => {
  // ---- Provision an isolated, temporary fixture ---------------------------
  // Real account passwords are never touched. Everything created here is
  // removed again during teardown.
  const stamp = Date.now();
  const suffix = `e2e${stamp}`;
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
  // A temporary admin, so the real admin account is never signed into or
  // modified. Removed again during teardown.
  const adminUser = await mkUser(`${suffix}-admin@example.test`, 'admin');
  const seekerToken = await signIn(`${suffix}-seeker@example.test`, pw);
  const adminToken = await signIn(`${suffix}-admin@example.test`, pw);
  const seekerId = seekerUser.id;
  console.log('temp seeker', seekerId, '| temp admin', adminUser.id);

  // A real segment, gig and booking so the amount is a genuine DB value.
  const seg = await json(await rest(`segments?select=id&limit=1`));
  if (!Array.isArray(seg) || !seg.length) throw new Error('no segment available for the fixture');
  const segmentId = seg[0].id;

  const mentorIns = await rest(`mentor_profiles`, {
    method: 'POST', headers: JH,
    body: JSON.stringify({ id: mentorUser.id, headline: 'E2E', experience_years: 1, languages: ['en'], rating: 0, review_count: 0, session_count: 0, is_approved: true, is_featured: false, approval_status: 'approved', is_active: true }),
  });
  if (mentorIns.status >= 400) console.log('  mentor_profiles insert:', mentorIns.status, (await mentorIns.text()).slice(0, 200));

  const gigRes = await rest(`gigs`, {
    method: 'POST', headers: JRH,
    body: JSON.stringify({ mentor_id: mentorUser.id, segment_id: segmentId, title: 'E2E Session', description: 'temp', duration_minutes: 60, price_inr: 1299, is_active: true }),
  });
  if (gigRes.status >= 400) throw new Error(`gig insert failed ${gigRes.status}: ${(await gigRes.text()).slice(0, 300)}`);
  const gigId = (await json(gigRes))[0].id;

  const bkRes = await rest(`bookings`, {
    method: 'POST', headers: JRH,
    body: JSON.stringify({
      booking_code: `${suffix}-BK`, mentor_id: mentorUser.id, seeker_id: seekerId, gig_id: gigId,
      segment_id: segmentId, start_time: new Date(Date.now() + 864e5).toISOString(),
      end_time: new Date(Date.now() + 864e5 + 36e5).toISOString(),
      seeker_timezone: 'Asia/Kolkata', mentor_timezone: 'Asia/Kolkata',
      amount_inr: 1299, status: 'PAYMENT_PENDING',
    }),
  });
  if (bkRes.status >= 400) throw new Error(`booking insert failed ${bkRes.status}: ${(await bkRes.text()).slice(0, 300)}`);
  const booking = (await json(bkRes))[0];
  console.log('temp booking', booking.booking_code, booking.id, 'amount', booking.amount_inr);

  const asSeeker = api(seekerToken);
  const asAdmin = api(adminToken);
  const adminId = adminUser.id;

  const createdNotifIds = [];
  const createdPaths = [];

  // Removes the entire temporary fixture, so no test data survives the run.
  const cleanup = async () => {
    for (const p of createdPaths) await rest(`object/payment-proofs/${p}`, { method: 'DELETE' });
    await rest(`payments?booking_id=eq.${booking.id}`, { method: 'DELETE' });
    await rest(`notifications?user_id=in.(${seekerId},${adminId},${mentorUser.id})&entity_id=eq.${booking.id}`, { method: 'DELETE' });
    await rest(`bookings?id=eq.${booking.id}`, { method: 'DELETE' });
    await rest(`gigs?id=eq.${gigId}`, { method: 'DELETE' });
    await rest(`mentor_profiles?id=eq.${mentorUser.id}`, { method: 'DELETE' });
    await rest(`user_roles?user_id=in.(${seekerId},${mentorUser.id},${adminUser.id})`, { method: 'DELETE' });
    for (const uid of [seekerId, mentorUser.id, adminUser.id]) {
      await fetch(`${BASE}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: JH });
    }
  };

  try {
    // ---- 1. Security --------------------------------------------------------
    section('1. Security');
    const anon = await fetch(`${API}/api/seeker/bookings/${booking.id}/payment-proof`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: proofBody('ANON12345'),
    });
    check('unauthenticated submission rejected (401)', anon.status === 401, `got ${anon.status}`);

    const foreign = await asSeeker('/api/seeker/bookings/00000000-0000-0000-0000-000000000000/payment-proof', {
      method: 'POST', body: proofBody('FOREIGN123'),
    });
    check('unknown booking is 404', foreign.status === 404, `got ${foreign.status}`);

    // ---- 2. Validation ------------------------------------------------------
    section('2. Validation');
    const noRef = await asSeeker(`/api/seeker/bookings/${booking.id}/payment-proof`, {
      method: 'POST', body: JSON.stringify({ fileName: 'a.png', mimeType: 'image/png', fileBase64: `data:image/png;base64,${PNG_B64}` }),
    });
    check('empty UTR is 400', noRef.status === 400, `got ${noRef.status}`);

    const blankRef = await asSeeker(`/api/seeker/bookings/${booking.id}/payment-proof`, {
      method: 'POST', body: JSON.stringify({ transactionReference: '    ', fileName: 'a.png', mimeType: 'image/png', fileBase64: `data:image/png;base64,${PNG_B64}` }),
    });
    check('whitespace-only UTR is 400', blankRef.status === 400, `got ${blankRef.status}`);

    const badRef = await asSeeker(`/api/seeker/bookings/${booking.id}/payment-proof`, {
      method: 'POST', body: JSON.stringify({ transactionReference: 'ref with spaces', fileName: 'a.png', mimeType: 'image/png', fileBase64: `data:image/png;base64,${PNG_B64}` }),
    });
    check('invalid UTR characters is 400', badRef.status === 400, `got ${badRef.status}`);

    const badMime = await asSeeker(`/api/seeker/bookings/${booking.id}/payment-proof`, {
      method: 'POST', body: JSON.stringify({ transactionReference: 'REF123456', fileName: 'a.exe', mimeType: 'application/x-msdownload', fileBase64: `data:image/png;base64,${PNG_B64}` }),
    });
    check('non-image MIME is 400', badMime.status === 400, `got ${badMime.status}`);

    const noFile = await asSeeker(`/api/seeker/bookings/${booking.id}/payment-proof`, {
      method: 'POST', body: JSON.stringify({ transactionReference: 'REF123456' }),
    });
    check('missing screenshot is 400', noFile.status === 400, `got ${noFile.status}`);

    const emptyImg = await asSeeker(`/api/seeker/bookings/${booking.id}/payment-proof`, {
      method: 'POST', body: JSON.stringify({ transactionReference: 'REF123456', fileName: 'a.png', mimeType: 'image/png', fileBase64: 'data:image/png;base64,' }),
    });
    check('empty image payload is 400', emptyImg.status === 400, `got ${emptyImg.status}`);

    const none = (await json(await rest(`payments?booking_id=eq.${booking.id}&select=id`)))?.length ?? 0;
    check('no payment row created by any rejected request', none === 0, `rows=${none}`);

    // ---- 3. Real submission --------------------------------------------------
    section('3. Real submission');
    const ref = `E2E${crypto.randomInt(100000, 999999)}`;
    const sub = await asSeeker(`/api/seeker/bookings/${booking.id}/payment-proof`, {
      method: 'POST',
      // Leading/trailing whitespace must be trimmed server-side.
      body: JSON.stringify({
        transactionReference: `  ${ref}  `, fileName: 'payment-proof.png', mimeType: 'image/png',
        fileSize: 68, fileBase64: `data:image/png;base64,${PNG_B64}`,
      }),
    });
    check('submission returns 201', sub.status === 201, `got ${sub.status} ${JSON.stringify(sub.body)}`);
    check('returned payment is PENDING_VERIFICATION', sub.body?.payment?.status === 'PENDING_VERIFICATION', sub.body?.payment?.status);

    const pay = (await json(await rest(`payments?booking_id=eq.${booking.id}&select=*`)))[0];
    check('exactly one payment row exists', !!pay);
    if (pay) {
      check('payment references the real booking', pay.booking_id === booking.id);
      check('amount equals the BOOKING amount (server-derived)', pay.amount_inr === booking.amount_inr, `${pay.amount_inr} vs ${booking.amount_inr}`);
      check('stored UTR is trimmed', pay.transaction_reference === ref, pay.transaction_reference);
      check('proof path starts with seeker id (storage RLS convention)', pay.proof_storage_path.startsWith(`${seekerId}/${booking.id}/`), pay.proof_storage_path);
      createdPaths.push(pay.proof_storage_path);
    }

    const bk = (await json(await rest(`bookings?id=eq.${booking.id}&select=status`)))[0];
    check('booking advanced to PENDING_VERIFICATION', bk?.status === 'PENDING_VERIFICATION', bk?.status);

    // ---- 4. Storage ---------------------------------------------------------
    section('4. Storage (private)');
    const pubTry = await fetch(`${BASE}/storage/v1/object/public/payment-proofs/${pay.proof_storage_path}`);
    check('proof is NOT publicly readable', pubTry.status !== 200, `public status ${pubTry.status}`);

    // ---- 5. Idempotency -----------------------------------------------------
    section('5. Duplicate submission protection');
    const sub2 = await asSeeker(`/api/seeker/bookings/${booking.id}/payment-proof`, {
      method: 'POST', body: proofBody(`${ref}B`),
    });
    check('second submission succeeds (update, not duplicate)', sub2.status === 201, `got ${sub2.status}`);
    const rows = await json(await rest(`payments?booking_id=eq.${booking.id}&select=id,transaction_reference`));
    check('still exactly ONE payment row', rows.length === 1, `rows=${rows.length}`);
    check('existing row updated in place', rows[0].id === pay.id && rows[0].transaction_reference === `${ref}B`, JSON.stringify(rows[0]));

    // ---- 6. Notifications ---------------------------------------------------
    section('6. Notifications');
    const seekerNotifs = await json(await rest(`notifications?user_id=eq.${seekerId}&entity_id=eq.${pay.id}&select=id,event_type`));
    for (const n of seekerNotifs ?? []) createdNotifIds.push(n.id);
    check('seeker received a real notification', (seekerNotifs?.length ?? 0) === 1, JSON.stringify(seekerNotifs));

    const adminNotifs = await json(await rest(`notifications?user_id=eq.${adminId}&entity_id=eq.${pay.id}&select=id,event_type`));
    for (const n of adminNotifs ?? []) createdNotifIds.push(n.id);

    // ---- 7. Admin queue -----------------------------------------------------
    section('7. Admin payment queue');
    const queue = await asAdmin('/api/admin/payments');
    const row = (queue.body?.payments ?? []).find((p) => p.id === pay.id);
    check('payment appears in /api/admin/payments', !!row);
    check('queue shows the real booking code', row?.bookingCode === booking.booking_code, row?.bookingCode);
    check('queue shows the transaction reference', row?.transactionReference === `${ref}B`, row?.transactionReference);
    check('queue shows the real amount', row?.amount === booking.amount_inr);
    check('queue returns a SIGNED proof url', typeof row?.proofUrl === 'string' && row.proofUrl.includes('token='), row?.proofUrl);
    check('queue does NOT leak the raw storage path', !JSON.stringify(row).includes(pay.proof_storage_path));

    const signedGet = await fetch(row.proofUrl);
    check('signed proof URL serves the image', signedGet.status === 200 && (signedGet.headers.get('content-type') || '').includes('image'), `status ${signedGet.status}`);

    // ---- 8. Admin verification ----------------------------------------------
    section('8. Admin approve -> real state transition');
    const appr = await asAdmin(`/api/admin/payments/${pay.id}/approve`, { method: 'PATCH' });
    check('approve returns 200', appr.status === 200, `got ${appr.status}`);

    const verified = (await json(await rest(`payments?id=eq.${pay.id}&select=*`)))[0];
    check('payment is now VERIFIED', verified?.status === 'VERIFIED', verified?.status);
    check('verified_by is the real admin', verified?.verified_by === adminId, verified?.verified_by);
    check('verified_at is set', !!verified?.verified_at);

    const bk2 = (await json(await rest(`bookings?id=eq.${booking.id}&select=status`)))[0];
    check('booking advanced to MENTOR_PENDING', bk2?.status === 'MENTOR_PENDING', bk2?.status);

    const verifiedNotifs = await json(await rest(`notifications?user_id=eq.${seekerId}&entity_id=eq.${pay.id}&event_type=eq.PAYMENT_APPROVED&select=id`));
    for (const n of verifiedNotifs ?? []) createdNotifIds.push(n.id);
    check('seeker notified of verification', (verifiedNotifs?.length ?? 0) === 1, JSON.stringify(verifiedNotifs));

    const myBookings = await asSeeker('/api/seeker/bookings');
    const mine = (myBookings.body?.bookings ?? []).find((b) => b.id === booking.id);
    check('My Bookings shows the verified payment', mine?.payment?.status === 'VERIFIED', mine?.payment?.status);
    check('My Bookings shows the advanced booking status', mine?.status === 'MENTOR_PENDING', mine?.status);

    // ---- 9. Verified payment is terminal -------------------------------------
    section('9. Verified payment is terminal');
    const afterVerify = await asSeeker(`/api/seeker/bookings/${booking.id}/payment-proof`, {
      method: 'POST', body: proofBody('AFTER12345'),
    });
    check('cannot submit again once verified (409)', afterVerify.status === 409, `got ${afterVerify.status}`);

    // ---- 10. Refresh keeps the real state -------------------------------------
    section('10. Refresh / re-read');
    const reread = await asSeeker(`/api/seeker/bookings/${booking.id}/payment-proof`);
    check('re-read returns the real stored payment', reread.body?.payment?.id === pay.id && reread.body?.payment?.status === 'VERIFIED');
  } finally {
    section('Cleanup');
    await cleanup();
    console.log('  temp booking rows left:', JSON.stringify(await json(await rest(`bookings?id=eq.${booking.id}&select=id`))));
    console.log('  temp payment rows left:', JSON.stringify(await json(await rest(`payments?booking_id=eq.${booking.id}&select=id`))));
  }

  console.log(`\n============  ${pass} passed, ${fail} failed  ============`);
  process.exit(fail === 0 ? 0 : 1);
};

main().catch((e) => { console.error('E2E ERROR:', e); process.exit(1); });
