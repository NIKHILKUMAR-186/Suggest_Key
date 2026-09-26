import fs from 'node:fs';
import crypto from 'node:crypto';

/**
 * Authorized security-audit harness for Suggest Key.
 *
 * Drives the real Express API over HTTP with throwaway test identities and
 * asserts that each previously-reported attack now fails for the RIGHT reason.
 * Every artefact it creates is tagged `secaudit` and removed again at the end.
 *
 * Usage:
 *   node scripts/security-audit.mjs [apiBase]
 */

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const API = process.argv[2] || process.env.API_BASE || 'http://localhost:3111';
const DB = env.VITE_SUPABASE_URL.replace(/\/$/, '');
const ANON = env.VITE_SUPABASE_ANON_KEY;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const TAG = 'secaudit';

const svcHeaders = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' };
const svcWrite = { ...svcHeaders, Prefer: 'return=representation' };

let pass = 0;
let fail = 0;
const failures = [];
const check = (label, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    failures.push(label);
    console.log(`  FAIL  ${label} ${extra}`);
  }
};
const section = (t) => console.log(`\n=== ${t} ===`);

const rest = (p, opts = {}) => fetch(`${DB}/rest/v1/${p}`, { headers: svcHeaders, ...opts }).then(async (r) => {
  try { return await r.json(); } catch { return null; }
});

/**
 * Like `rest`, but fails loudly. Seeding that silently no-ops turns later
 * authorization checks into false positives (or false negatives), so every
 * fixture write must be verified.
 */
const mustRest = async (p, opts = {}) => {
  const r = await fetch(`${DB}/rest/v1/${p}`, { headers: svcHeaders, ...opts });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`seed ${(opts.method || 'GET')} ${p} -> ${r.status} ${JSON.stringify(body)}`);
  return body;
};

/**
 * Upsert variant. A previous run that was interrupted can leave an orphaned
 * fixture row behind (the auth user is gone but the profile remains), and a
 * plain insert would then abort the whole harness. Re-running must be safe.
 */
const seedWrite = (table, row) =>
  mustRest(table, {
    method: 'POST',
    headers: { ...svcWrite, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(row),
  });

/**
 * Creating a profile already provisions its role through a database trigger, so
 * an explicit insert conflicts. Clear the row first, then assert the role is
 * present either way.
 */
async function seedUserRole(user) {
  await fetch(`${DB}/rest/v1/user_roles?user_id=eq.${user.id}`, { method: 'DELETE', headers: svcHeaders });
  await mustRest('user_roles', {
    method: 'POST',
    headers: { ...svcWrite, Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: user.id, role: user.role }),
  });
  const rows = await rest(`user_roles?user_id=eq.${user.id}&role=eq.${user.role}&select=role`);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`seedUserRole: ${user.role} not present for ${user.id}`);
  }
}

const api = (token) => async (path, init = {}) => {
  const headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${API}${path}`, { ...init, headers });
  let body = null;
  try { body = await r.json(); } catch { body = null; }
  return { status: r.status, body, raw: r };
};

const anon = api(null);

const signIn = async (email, password) => {
  const r = await fetch(`${DB}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const b = await r.json().catch(() => null);
  if (!b?.access_token) throw new Error(`sign-in failed for ${email}: ${r.status}`);
  return b.access_token;
};

const PASSWORD = 'SecAudit!2026xQ';

const created = { users: [], bookings: [], gigs: [] };

async function createUser(role, label) {
  const email = `${TAG}-${label}@audit.local`;
  const r = await fetch(`${DB}/auth/v1/admin/users`, {
    method: 'POST',
    headers: svcWrite,
    body: JSON.stringify({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: `SecAudit ${label}`, timezone: 'Asia/Kolkata', requested_role: role },
    }),
  });
  const b = await r.json().catch(() => null);
  if (!b?.id) throw new Error(`createUser(${label}) failed: ${r.status} ${JSON.stringify(b)}`);
  created.users.push(b.id);
  return { id: b.id, email, password: PASSWORD, role };
}

async function seedProfile(user, { approved = false } = {}) {
  await seedWrite('profiles', {
    id: user.id, email: user.email, full_name: `SecAudit ${user.role}`,
    timezone: 'Asia/Kolkata',
  });
  await seedUserRole(user);
  if (user.role === 'mentor') {
    await seedWrite('mentor_profiles', {
      id: user.id, headline: 'Audit mentor', about: 'audit', experience_years: 3,
      languages: ['English'], rating: 5, review_count: 0, session_count: 0,
      is_approved: approved, is_active: true,
      approval_status: approved ? 'approved' : 'pending_review',
    });
  }
  return user;
}

async function seedBooking(seeker, mentor) {
  const segments = await rest('segments?select=id&limit=1');
  const segmentId = segments?.[0]?.id || null;
  const gigId = crypto.randomUUID();
  await seedWrite('gigs', {
    id: gigId, mentor_id: mentor.id, segment_id: segmentId, title: 'Audit gig',
    description: 'audit', duration_minutes: 60, price_inr: 500, is_active: true,
  });

  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  start.setUTCMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const code = `${TAG.toUpperCase()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const rows = await seedWrite('bookings', {
    booking_code: code, mentor_id: mentor.id, seeker_id: seeker.id, gig_id: gigId,
    segment_id: segmentId,
    start_time: start.toISOString(), end_time: end.toISOString(),
    amount_inr: 500, status: 'CONFIRMED',
    meeting_url: 'https://meet.google.com/audit-secret-room',
  });
  const booking = Array.isArray(rows) ? rows[0] : rows;
  if (!booking?.id) throw new Error(`seedBooking failed: ${JSON.stringify(rows)}`);
  created.bookings.push(booking.id);
  created.gigs.push(gigId);
  return booking;
}

async function cleanup() {
  for (const b of created.bookings) {
    await fetch(`${DB}/rest/v1/session_workspaces?booking_id=eq.${b}`, { method: 'DELETE', headers: svcHeaders });
    await fetch(`${DB}/rest/v1/payments?booking_id=eq.${b}`, { method: 'DELETE', headers: svcHeaders });
    await fetch(`${DB}/rest/v1/bookings?id=eq.${b}`, { method: 'DELETE', headers: svcHeaders });
  }
  for (const u of created.users) {
    for (const q of [
      'mentor_profiles?id', 'gigs?mentor_id', 'bookings?seeker_id', 'bookings?mentor_id',
      'payments?seeker_id', 'notifications?user_id', 'user_roles?user_id', 'profiles?id',
    ]) {
      const [tbl, key] = q.split('?');
      await fetch(`${DB}/rest/v1/${tbl}?${key}=eq.${u}`, { method: 'DELETE', headers: svcHeaders });
    }
    await fetch(`${DB}/auth/v1/admin/users/${u}`, { method: 'DELETE', headers: svcHeaders });
  }
  for (const g of created.gigs) {
    await fetch(`${DB}/rest/v1/gigs?id=eq.${g}`, { method: 'DELETE', headers: svcHeaders });
  }
}

/**
 * Removes fixtures left behind by a run that was interrupted before its cleanup
 * step. Without this, orphaned rows accumulate in the shared project and can
 * silently satisfy a later check.
 */
async function purgeStaleFixtures() {
  const stale = await rest('profiles?select=id&email=like.*@audit.local');
  if (!Array.isArray(stale) || stale.length === 0) return 0;
  for (const { id } of stale) {
    for (const t of [
      'session_workspaces?booking_id', 'payments?booking_id', 'bookings?seeker_id', 'bookings?mentor_id',
      'mentor_profiles?id', 'gigs?mentor_id', 'notifications?user_id', 'user_roles?user_id', 'profiles?id',
    ]) {
      const [tbl, key] = t.split('?');
      await fetch(`${DB}/rest/v1/${tbl}?${key}=eq.${id}`, { method: 'DELETE', headers: svcHeaders });
    }
  }
  const ids = stale.map((u) => u.id);
  await fetch(`${DB}/rest/v1/profiles?id=in.(${ids.join(',')})`, { method: 'DELETE', headers: svcHeaders });
  for (const id of ids) {
    await fetch(`${DB}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: svcHeaders });
  }
  return stale.length;
}

async function main() {
  console.log(`Target: ${API}`);
  console.log(`DB:    ${DB}`);

  section('SETUP: throwaway audit identities');
  const purged = await purgeStaleFixtures();
  if (purged) console.log(`  purged ${purged} stale fixture(s) from an earlier run`);
  const seekerA = await seedProfile(await createUser('seeker', 'seeker-a'), {});
  const seekerB = await seedProfile(await createUser('seeker', 'seeker-b'), {});
  const mentorA = await seedProfile(await createUser('mentor', 'mentor-a'), { approved: true });
  const mentorB = await seedProfile(await createUser('mentor', 'mentor-b'), { approved: true });
  const adminU = await seedProfile(await createUser('admin', 'admin'), {});
  console.log(`  created seekerA, seekerB, mentorA, mentorB, admin`);

  const tSeekerA = await signIn(seekerA.email, seekerA.password);
  const tSeekerB = await signIn(seekerB.email, seekerB.password);
  const tMentorA = await signIn(mentorA.email, mentorA.password);
  const tMentorB = await signIn(mentorB.email, mentorB.password);
  const tAdmin = await signIn(adminU.email, adminU.password);
  const sA = api(tSeekerA);
  const sB = api(tSeekerB);
  const mA = api(tMentorA);
  const mB = api(tMentorB);
  const ad = api(tAdmin);

  const booking = await seedBooking(seekerA, mentorA);
  console.log(`  seeded booking ${booking.id} (seekerA -> mentorA), status CONFIRMED`);

  const notif = (await rest(`notifications?user_id=eq.${seekerA.id}&select=id&limit=1`))?.[0];
  if (!notif) {
    await rest('notifications', {
      method: 'POST', headers: svcWrite,
      body: JSON.stringify({
        user_id: seekerA.id, title: 'audit', message: 'audit', type: 'SYSTEM',
        is_read: false, event_type: 'AUDIT', entity_type: 'audit', entity_id: 'audit',
        link: '/', metadata: {},
      }),
    });
  }
  const notifRows = await rest(`notifications?user_id=eq.${seekerA.id}&select=id&is_read&limit=5`);
  const targetNotif = notifRows?.[0];

  // ---------------------------------------------------------------------
  section('A. Authentication required on protected routes');
  for (const [label, path, init] of [
    ['GET /api/notifications', '/api/notifications', {}],
    ['GET /api/notifications/unread-count', '/api/notifications/unread-count', {}],
    ['PATCH /api/notifications/:id/read', `/api/notifications/${targetNotif?.id || 'x'}/read`, { method: 'PATCH', body: '{}' }],
    ['POST /api/notifications/mark-all-read', '/api/notifications/mark-all-read', { method: 'POST', body: '{}' }],
    ['POST /api/sessions/:id/join', `/api/sessions/${booking.id}/join`, { method: 'POST', body: '{}' }],
    ['POST /api/sessions/:id/complete', `/api/sessions/${booking.id}/complete`, { method: 'POST', body: '{}' }],
    ['GET /api/sessions/:id/access', `/api/sessions/${booking.id}/access`, {}],
    ['GET /api/workspaces/booking/:id', `/api/workspaces/booking/${booking.id}`, {}],
    ['POST /api/workspaces', '/api/workspaces', { method: 'POST', body: JSON.stringify({ bookingId: booking.id }) }],
    ['GET /api/mentor/available-segments', '/api/mentor/available-segments', {}],
    ['GET /api/admin/users', '/api/admin/users', {}],
    ['GET /api/admin/payments', '/api/admin/payments', {}],
    ['POST /api/bookings/hold', '/api/bookings/hold', { method: 'POST', body: '{}' }],
    ['GET /api/seeker/bookings', '/api/seeker/bookings', {}],
    ['GET /api/mentor/bookings', '/api/mentor/bookings', {}],
  ]) {
    const r = await anon(path, init);
    check(`anon ${label} -> 401`, r.status === 401, `got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  }

  // ---------------------------------------------------------------------
  section('B. Broken function-level authorization (horizontal)');
  {
    const r = await sB(`/api/seeker/bookings/${booking.id}`);
    check('seekerB GET /api/seeker/bookings/:id (seekerA booking) -> 403', r.status === 403, `got ${r.status}`);

    const r2 = await sB(`/api/seeker/bookings/${booking.id}/payment-proof`);
    check('seekerB GET payment-proof of seekerA booking -> 403', r2.status === 403, `got ${r2.status}`);

    const r3 = await sB(`/api/seeker/bookings/${booking.id}/payment-proof`, {
      method: 'POST',
      body: JSON.stringify({
        transactionReference: 'AUDIT123456', fileName: 'a.png', mimeType: 'image/png',
        fileSize: 100, storagePath: `${seekerB.id}/${booking.id}/x.png`,
      }),
    });
    check('seekerB POST payment-proof on seekerA booking -> 403', r3.status === 403, `got ${r3.status}`);

    const r4 = await mB(`/api/mentor/bookings/${booking.id}`);
    check('mentorB GET /api/mentor/bookings/:id (mentorA booking) -> 403/404', [403, 404].includes(r4.status), `got ${r4.status}`);

    const r5 = await sB(`/api/workspaces/booking/${booking.id}`);
    check('seekerB GET workspace-by-booking of seekerA booking -> 403/404', [403, 404].includes(r5.status), `got ${r5.status}`);

    const r6 = await sB(`/api/workspaces`, {
      method: 'POST',
      body: JSON.stringify({ bookingId: booking.id, mentorNotes: 'pwned', publish: true }),
    });
    check('seekerB POST /api/workspaces on seekerA booking -> 403', r6.status === 403, `got ${r6.status}`);

    const r7 = await mB(`/api/workspaces`, {
      method: 'POST',
      body: JSON.stringify({ bookingId: booking.id, mentorNotes: 'pwned', publish: true }),
    });
    check('unrelated mentorB POST /api/workspaces -> 403', r7.status === 403, `got ${r7.status}`);

    const r8 = await sB(`/api/notifications/${targetNotif?.id}/read`, { method: 'PATCH', body: '{}' });
    check('seekerB PATCH notification of seekerA -> 404/403', [403, 404].includes(r8.status), `got ${r8.status}`);
  }

  // ---------------------------------------------------------------------
  section('C. Vertical privilege escalation');
  {
    for (const [label, path, init] of [
      ['GET /api/admin/users', '/api/admin/users', {}],
      ['GET /api/admin/payments', '/api/admin/payments', {}],
      ['GET /api/admin/workspaces', '/api/admin/workspaces', {}],
      ['GET /api/admin/mentors', '/api/admin/mentors', {}],
      ['GET /api/admin/system-health/logs', '/api/admin/system-health/logs', {}],
      ['POST /api/admin/users/direct-create', '/api/admin/users/direct-create', { method: 'POST', body: '{"role":"seeker"}' }],
      ['PATCH /api/admin/payments/x/approve', '/api/admin/payments/x/approve', { method: 'PATCH', body: '{}' }],
      ['POST /api/notifications/dispatch', '/api/notifications/dispatch', { method: 'POST', body: '{"title":"t","message":"m"}' }],
    ]) {
      const r = await sA(path, init);
      check(`seeker ${label} -> 403`, r.status === 403, `got ${r.status}`);
    }
    for (const [label, path, init] of [
      ['GET /api/admin/users', '/api/admin/users', {}],
      ['GET /api/admin/mentors', '/api/admin/mentors', {}],
    ]) {
      const r = await mA(path, init);
      check(`mentor ${label} -> 403`, r.status === 403, `got ${r.status}`);
    }
    const r = await sA('/api/admin/users', { headers: { 'X-Role': 'admin', 'X-User-Role': 'admin' } });
    check('seeker with role-spoofing headers on /api/admin/users -> 403', r.status === 403, `got ${r.status}`);
  }

  // ---------------------------------------------------------------------
  section('D. Mass assignment / role from request body or query string');
  {
    const r = await sA('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({
        bookingId: booking.id, mentorNotes: 'x', publish: true,
        role: 'admin', isAdmin: true, userId: adminU.id, mentorId: adminU.id,
        seekerId: adminU.id, status: 'PUBLISHED', approved_by: adminU.id,
      }),
    });
    // Either rejection is acceptable; what must never happen is acceptance.
    // Unknown keys are rejected by request validation, so this answers 400,
    // while a clean body is refused by the authorization check with 403.
    check('seeker POST /api/workspaces with role=admin body is rejected', [400, 403].includes(r.status), `got ${r.status}`);

    const r1b = await sA('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({ bookingId: booking.id, mentorNotes: 'x', publish: true }),
    });
    check('seeker POST /api/workspaces with a clean body -> 403', r1b.status === 403, `got ${r1b.status}`);

    const written = await rest(`session_workspaces?booking_id=eq.${booking.id}&select=id`);
    check('no workspace row was written by the mass-assignment attempts',
      !Array.isArray(written) || written.length === 0, `rows=${JSON.stringify(written)}`);

    const r2 = await sB(`/api/workspaces/booking/${booking.id}?role=admin&userId=${adminU.id}`);
    check('seekerB GET workspace ?role=admin -> 403/404', [403, 404].includes(r2.status), `got ${r2.status}`);

    const r3 = await sB(`/api/seeker/bookings?userId=${seekerA.id}&seekerId=${seekerA.id}&role=admin`);
    const list = Array.isArray(r3.body?.bookings) ? r3.body.bookings : [];
    check('seekerB GET /api/seeker/bookings?userId=seekerA -> only own bookings',
      r3.status === 200 && list.every((b) => b.seeker_id === seekerB.id),
      `got ${r3.status} n=${list.length}`);

    const r4 = await sB(`/api/notifications?userId=${seekerA.id}`);
    const n = Array.isArray(r4.body?.notifications) ? r4.body.notifications : [];
    check('seekerB GET /api/notifications?userId=seekerA -> only own notifications',
      r4.status === 200 && n.every((x) => x.user_id === seekerB.id), `got ${r4.status} n=${n.length}`);

    const r5 = await sA('/api/notifications/dispatch', {
      method: 'POST',
      body: JSON.stringify({ userId: adminU.id, title: 'pwn', message: 'pwn' }),
    });
    check('seeker POST /api/notifications/dispatch for another user -> 403', r5.status === 403, `got ${r5.status}`);
  }

  // ---------------------------------------------------------------------
  section('E. Session access window (T-5 gate) - client-supplied clock');
  {
    // The booking starts in 24h, so nothing may be released no matter what
    // timestamp the caller supplies.
    const far = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const r = await sA(`/api/sessions/${booking.id}/access?currentTime=${far}`);
    check('GET access with future currentTime does not grant canJoin',
      r.status >= 400 || r.body?.canJoin === false,
      `got ${r.status} canJoin=${r.body?.canJoin}`);
    check('GET access with future currentTime leaks no meetingUrl',
      !r.body?.meetingUrl, `meetingUrl=${String(r.body?.meetingUrl).slice(0, 20)}`);

    const j = await sA(`/api/sessions/${booking.id}/join`, { method: 'POST', body: JSON.stringify({ currentTime: far }) });
    check('POST join with future currentTime does not return a meetingUrl',
      j.status >= 400 || !j.body?.meetingUrl,
      `got ${j.status} meetingUrl=${Boolean(j.body?.meetingUrl)}`);

    const inWindow = new Date(new Date(booking.start_time).getTime() - 60 * 1000).toISOString();
    const j2 = await sA(`/api/sessions/${booking.id}/join`, { method: 'POST', body: JSON.stringify({ currentTime: inWindow }) });
    check('POST join with simulated in-window currentTime does not return a meetingUrl',
      j2.status >= 400 || !j2.body?.meetingUrl,
      `got ${j2.status} meetingUrl=${Boolean(j2.body?.meetingUrl)}`);

    // The genuine T-5 bypass: a PARTICIPANT on their own CONFIRMED booking,
    // asking for the link 24 hours early.
    const own = await sA(`/api/sessions/${booking.id}/join`, { method: 'POST', body: '{}' });
    check('participant cannot join their own booking 24h early',
      !own.body?.meetingUrl, `status ${own.status} meetingUrl=${String(own.body?.meetingUrl).slice(0, 20)}`);

    const j3 = await sB(`/api/sessions/${booking.id}/join`, { method: 'POST', body: '{}' });
    check('non-participant seekerB POST join is refused', [403, 404].includes(j3.status), `got ${j3.status}`);
    check('non-participant join response leaks no meetingUrl', !j3.body?.meetingUrl);

    const acc = await sB(`/api/sessions/${booking.id}/access`);
    check('non-participant access response leaks no participant identity',
      !acc.body?.mentorId && !acc.body?.seekerId && !acc.body?.bookingCode && !acc.body?.mentorName,
      `mentorId=${acc.body?.mentorId} bookingCode=${acc.body?.bookingCode}`);

    const bogus = await sA('/api/sessions/1%27%20OR%201%3D1--/join', { method: 'POST', body: '{}' });
    check('injection-shaped booking id is refused, not 500', [400, 404].includes(bogus.status), `got ${bogus.status}`);

    const c = await sB(`/api/sessions/${booking.id}/complete`, { method: 'POST', body: '{}' });
    check('non-participant seekerB POST complete is refused', [403, 404].includes(c.status), `got ${c.status}`);

    // The participant must not be able to complete a session that has not begun.
    const c2 = await sA(`/api/sessions/${booking.id}/complete`, { method: 'POST', body: '{}' });
    check('participant cannot complete a session that has not started', c2.status === 409, `got ${c2.status}`);

    const after = await rest(`bookings?id=eq.${booking.id}&select=status`);
    check('booking status unchanged after rejected complete',
      after?.[0]?.status === 'CONFIRMED', `status=${after?.[0]?.status}`);

    const c3 = await ad(`/api/sessions/${booking.id}/complete`, { method: 'POST', body: '{}' });
    check('admin cannot complete a session that has not started either', c3.status === 409, `got ${c3.status}`);
  }

  // ---------------------------------------------------------------------
  section('F. Mentor booking list isolation');
  {
    const r = await mA('/api/mentor/bookings');
    const list = Array.isArray(r.body?.bookings) ? r.body.bookings : [];
    check('mentorA GET /api/mentor/bookings returns only own bookings',
      list.every((b) => b.mentor_id === mentorA.id), `n=${list.length}`);
    const r2 = await mB(`/api/mentor/bookings?mentorId=${mentorA.id}`);
    const l2 = Array.isArray(r2.body?.bookings) ? r2.body.bookings : [];
    check('mentorB ?mentorId=mentorA is ignored', l2.every((b) => b.mentor_id === mentorB.id), `n=${l2.length}`);
  }

  // ---------------------------------------------------------------------
  section('G. Meeting URL is not exposed before the access window');
  {
    const r = await sA(`/api/seeker/bookings/${booking.id}`);
    check('seeker GET own booking does not leak meeting_url before T-5',
      r.body?.booking?.meeting_url === null || r.body?.booking?.meeting_url === undefined,
      `meeting_url=${String(r.body?.booking?.meeting_url).slice(0, 12)}...`);
    const list = await sA('/api/seeker/bookings');
    const mine = (list.body?.bookings || []).find((b) => b.id === booking.id);
    check('seeker booking LIST does not leak meeting_url before T-5',
      !mine || mine.meeting_url === null || mine.meeting_url === undefined,
      `meeting_url=${String(mine?.meeting_url).slice(0, 12)}...`);
  }

  // ---------------------------------------------------------------------
  section('H. Booking creation authorization + business rules');
  {
    const segs = await rest('segments?select=id&limit=1');
    const segmentId = segs?.[0]?.id;
    const myGigs = await rest(`gigs?mentor_id=eq.${mentorA.id}&select=id&limit=1`);
    const gigId = myGigs?.[0]?.id;
    const valid = { mentorId: mentorA.id, segmentId, gigId };

    const r = await mA('/api/bookings/hold', {
      method: 'POST',
      body: JSON.stringify({ ...valid, startTime: new Date(Date.now() + 3600e3).toISOString(), endTime: new Date(Date.now() + 7200e3).toISOString(), seekerId: seekerA.id }),
    });
    check('mentor POST /api/bookings/hold -> 403', r.status === 403, `got ${r.status}`);

    const r2 = await sA('/api/bookings/hold', {
      method: 'POST',
      body: JSON.stringify({ ...valid, startTime: new Date(Date.now() + 3600e3).toISOString(), endTime: new Date(Date.now() + 7200e3).toISOString(), seekerId: adminU.id }),
    });
    check('seekerA cannot book as seekerB (body seekerId ignored)', r2.status !== 201, `got ${r2.status}`);

    const r3 = await sA('/api/bookings/hold', {
      method: 'POST',
      body: JSON.stringify({ ...valid, startTime: new Date(Date.now() + 60e3).toISOString(), endTime: new Date(Date.now() + 3660e3).toISOString() }),
    });
    check('booking inside the 5-minute cutoff is rejected', r3.status === 409, `got ${r3.status} ${JSON.stringify(r3.body)}`);

    const r4 = await sA('/api/bookings/hold', {
      method: 'POST',
      body: JSON.stringify({ ...valid, startTime: new Date(Date.now() - 3600e3).toISOString(), endTime: new Date(Date.now() - 60e3).toISOString() }),
    });
    check('booking a past slot is rejected', r4.status === 409, `got ${r4.status} ${JSON.stringify(r4.body)}`);
  }


  // ---------------------------------------------------------------------
  section('I. Notification ownership');
  {
    const mine = await sA('/api/notifications');
    check('seekerA GET /api/notifications -> 200', mine.status === 200, `got ${mine.status}`);
    const all = mine.body?.notifications || [];
    check('seekerA only sees own notifications', all.every((n) => n.user_id === seekerA.id), `n=${all.length}`);

    const r = await sA(`/api/notifications/${targetNotif?.id}/read`, { method: 'PATCH', body: '{}' });
    check('seekerA marks own notification read -> 200', r.status === 200, `got ${r.status}`);

    const r2 = await sA(`/api/notifications/${targetNotif?.id}/read`, { method: 'PATCH', body: '{}' });
    check('re-reading an already-read notification is idempotent', r2.status === 200, `got ${r2.status}`);

    const r3 = await ad(`/api/notifications/${targetNotif?.id}/read`, { method: 'PATCH', body: '{}' });
    check('admin marking another user notification read -> 404 (not owner-scoped write)', r3.status === 404, `got ${r3.status}`);
  }

  // ---------------------------------------------------------------------
  section('J. Demo auth surface');
  {
    const demoEnabled = process.env.EXPECT_DEMO_AUTH === 'enabled';

    const r = await anon('/api/auth/demo-login', { method: 'POST', body: JSON.stringify({ persona: 'admin' }) });
    if (demoEnabled) {
      check('demo persona=admin without a password is refused', r.status === 401, `got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
    } else {
      check('anonymous demo-login is refused when not explicitly enabled', r.status === 404 || r.status === 401, `got ${r.status}`);
    }

    const r2 = await anon('/api/auth/demo-login', { method: 'POST', body: JSON.stringify({ email: 'admin@local.test', password: '' }) });
    check('demo-login with empty admin password is refused', r2.status === 404 || r2.status === 401, `got ${r2.status}`);

    if (demoEnabled) {
      const wrong = await anon('/api/auth/demo-login', { method: 'POST', body: JSON.stringify({ persona: 'admin', password: 'not-the-password' }) });
      check('demo persona=admin with a wrong password is refused', wrong.status === 401, `got ${wrong.status}`);

      const good = await anon('/api/auth/demo-login', { method: 'POST', body: JSON.stringify({ persona: 'admin', password: process.env.EXPECT_DEMO_ADMIN_PW }) });
      check('demo persona=admin with the operator password still works (dev UX preserved)',
        good.status === 200 && Boolean(good.body?.token), `got ${good.status}`);

      const seekerPersona = await anon('/api/auth/demo-login', { method: 'POST', body: JSON.stringify({ persona: 'seeker' }) });
      check('unprivileged demo persona remains one-click (dev UX preserved)', seekerPersona.status === 200, `got ${seekerPersona.status}`);
    }

    const r3 = await anon('/api/notifications', { headers: { Authorization: 'Bearer skdemo.eyJzdWIiOiJhZG1pbiJ9.AAAA' } });
    check('forged demo token is rejected', r3.status === 401, `got ${r3.status}`);

    const r4 = await anon('/api/notifications', { headers: { Authorization: 'Bearer not-a-jwt' } });
    check('garbage bearer token is rejected', r4.status === 401, `got ${r4.status}`);

    const r5 = await anon('/api/notifications', { headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbiIsInJvbGUiOiJhZG1pbiJ9.x' } });
    check('unsigned JWT claiming admin is rejected', r5.status === 401, `got ${r5.status}`);

    const r6 = await anon('/api/notifications', { headers: { Authorization: 'Bearer skdemo.' + Buffer.from(JSON.stringify({ sub: 'admin', email: 'a@b.test', role: 'admin', iat: 1, exp: 9999999999 })).toString('base64url') + '.' + 'A'.repeat(43) } });
    check('demo token signed with a guessable key is rejected', r6.status === 401, `got ${r6.status}`);
  }

  // ---------------------------------------------------------------------
  section('K. Input handling');
  {
    const r = await sA(`/api/seeker/bookings/${encodeURIComponent("1' OR 1=1--")}`);
    // The upstream Supabase project sits behind a WAF that rejects SQL-shaped
    // path segments outright, so the failure arrives as an unattributable
    // upstream error rather than a Postgres 22P02. What matters here is that the
    // request never succeeds and never leaks internals.
    check('SQLi-shaped booking id does not return data', r.status !== 200 && !r.body?.booking, `got ${r.status}`);
    check('SQLi-shaped booking id leaks no internal error detail',
      !/postgres|postgrest|22P02|node_modules/i.test(JSON.stringify(r.body || {})),
      JSON.stringify(r.body).slice(0, 160));
    const r2 = await sA('/api/notifications?limit=abc');
    check('non-numeric limit does not 500', r2.status !== 500, `got ${r2.status}`);
    const r3 = await sA('/api/mentor-availability/slots?mentorId=abc&date=nope');
    check('malformed slot query is rejected cleanly', [400, 404].includes(r3.status), `got ${r3.status}`);
    const big = 'x'.repeat(400 * 1024);
    const r4 = await sA('/api/workspaces', { method: 'POST', body: JSON.stringify({ bookingId: booking.id, mentorNotes: big }) });
    check('oversized body is refused', r4.status === 413 || r4.status === 400, `got ${r4.status}`);
  }

  // ---------------------------------------------------------------------
  section('L. Rate limiting');
  {
    let limited = 0;
    for (let i = 0; i < 200; i++) {
      const r = await anon('/api/health');
      if (r.status === 429) { limited++; break; }
    }
    check('global API rate limit eventually returns 429', limited > 0, 'never limited');
  }

  // ---------------------------------------------------------------------
  section('M. Information disclosure');
  {
    const r = await sA(`/api/seeker/bookings/${booking.id}`);
    const b = r.body?.booking || {};
    const leak = ['service_role', 'SUPABASE_SERVICE_ROLE_KEY', 'password_hash', 'encrypted_password'];
    check('booking response contains no service role key material',
      !leak.some((k) => JSON.stringify(b).includes(k)), 'leak found');
    const h = await anon('/api/health');
    check('health endpoint exposes no config', !JSON.stringify(h.body).toLowerCase().includes('supabase'), JSON.stringify(h.body).slice(0, 120));
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`PASS: ${pass}   FAIL: ${fail}`);
  if (failures.length) {
    console.log('FAILED CHECKS:');
    for (const f of failures) console.log(`  - ${f}`);
  }
}

main()
  .catch((e) => { console.error('HARNESS ERROR:', e); process.exitCode = 1; })
  .finally(async () => {
    console.log('\nCleaning up audit fixtures...');
    await cleanup();
    console.log('Cleanup complete.');
  });
