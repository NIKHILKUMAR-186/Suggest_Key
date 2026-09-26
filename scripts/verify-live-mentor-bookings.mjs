import fs from 'node:fs';

/**
 * Verifies GET /api/mentor/bookings for the REAL mentor over real HTTP, using a
 * Supabase magic-link session token (no password is read, set or changed, and no
 * email is sent - the token is exchanged directly through the auth API).
 *
 * This is the Step 11 check: the exact booking the mentor was notified about
 * must come back from the live endpoint, in the Pending Confirmation tab, with
 * its own gig/segment/seeker/date/time/payment.
 */
const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const BASE = env.VITE_SUPABASE_URL.replace(/\/$/, '');
const ANON = env.VITE_SUPABASE_ANON_KEY;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const JH = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const API = process.env.API_BASE || 'http://localhost:3000';

const MENTOR_EMAIL = process.argv[2];
const MENTOR_PENDING_ID = process.argv[3]; // optional: the booking the mentor was notified about
if (!MENTOR_EMAIL) throw new Error('usage: node verify-live-mentor-bookings.mjs <mentor email> [bookingId]');

const json = async (r) => { try { return await r.json(); } catch { return null; } };

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${extra}`); }
};

const link = await json(await fetch(`${BASE}/auth/v1/admin/generate_link`, {
  method: 'POST', headers: JH,
  body: JSON.stringify({ type: 'magiclink', email: MENTOR_EMAIL }),
}));
if (!link?.hashed_token) throw new Error(`generate_link failed: ${JSON.stringify(link)}`);

const session = await json(await fetch(`${BASE}/auth/v1/verify?grant_type=passwordless`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token }),
}));
if (!session?.access_token) throw new Error(`verify failed: ${JSON.stringify(session)}`);

const token = session.access_token;
const userId = session.user?.id;
console.log('signed-in mentor auth id:', userId);

const call = async (path) => {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: r.status, body: await json(r) };
};

const notifs = await call('/api/notifications');
const list = await call('/api/mentor/bookings');
console.log('\n=== 1. Mentor session identity ===');
check('mentor bookings endpoint returns 200', list.status === 200, `got ${list.status} ${JSON.stringify(list.body)?.slice(0, 200)}`);

const rows = list.body?.bookings ?? [];
console.log(`  rows returned: ${rows.length}`);
for (const b of rows) {
  console.log(`   - ${b.booking_code} ${b.status} gig="${b.gig?.title}" segment="${b.segment?.name}" seeker=${b.seeker?.full_name} payment=${b.payment?.status ?? 'none'}`);
}

check('every returned booking belongs to the signed-in mentor',
  rows.every((b) => b.mentor_id === userId), JSON.stringify(rows.map((b) => b.mentor_id)));

console.log('\n=== 2. Tab mapping against the real rows ===');
const pending = rows.filter((b) => b.status === 'MENTOR_PENDING');
const upcoming = rows.filter((b) => b.status === 'CONFIRMED');
const completed = rows.filter((b) => b.status === 'COMPLETED');
const cancelled = rows.filter((b) => b.status === 'CANCELLED' || b.status === 'REJECTED');
console.log(`  pending=${pending.length} upcoming=${upcoming.length} completed=${completed.length} cancelled=${cancelled.length}`);
check('no booking falls outside the four tabs',
  rows.length === pending.length + upcoming.length + completed.length + cancelled.length
    + rows.filter((b) => b.status === 'PAYMENT_PENDING' || b.status === 'PENDING_VERIFICATION').length);
check('no booking awaiting payment/verification is shown to the mentor',
  rows.filter((b) => b.status === 'PAYMENT_PENDING' || b.status === 'PENDING_VERIFICATION')
    .every((b) => !b.payment || b.payment.status !== 'VERIFIED'));
check('every admin-approved booking is in Pending Confirmation',
  rows.filter((b) => b.status === 'MENTOR_PENDING').length === pending.length);

console.log('\n=== 3. The booking the mentor was notified about ===');
const mentorNotifs = (notifs.body?.notifications ?? []).filter((n) => n.type === 'BOOKING' || n.event_type === 'NEW_BOOKING');
for (const n of mentorNotifs) console.log(`   notif ${n.id} entity_id=${n.entity_id} link=${n.link}`);

const target = MENTOR_PENDING_ID
  ? mentorNotifs.find((n) => n.entity_id === MENTOR_PENDING_ID)
  : mentorNotifs.find((n) => n.entity_id);

if (!target) {
  check('a mentor notification carries a booking id', false, 'none found');
} else {
  check('notification entity_id is a real booking id', !!target.entity_id, target.entity_id);
  check('notification link targets that exact booking',
    target.link === `/mentor/booking-detail?bookingId=${target.entity_id}`, target.link);

  const detail = await call(`/api/mentor/bookings/${target.entity_id}`);
  const listed = rows.find((b) => b.id === target.entity_id);
  const db = (await json(await fetch(`${BASE}/rest/v1/bookings?id=eq.${target.entity_id}&select=*,gig:gigs(title),segment:segments(name),seeker:profiles!bookings_seeker_id_fkey(full_name)`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })))?.[0];
  const dbPayments = await json(await fetch(`${BASE}/rest/v1/payments?booking_id=eq.${target.entity_id}&select=status`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }));

  check('detail endpoint returns the same booking', detail.status === 200 && detail.body?.booking?.id === target.entity_id, `got ${detail.status}`);
  check('the booking is listed in Mentor My Bookings', !!listed);
  check('detail and list are the same record',
    detail.body?.booking?.booking_code === listed?.booking_code && detail.body?.booking?.gig?.id === listed?.gig?.id,
    `${detail.body?.booking?.booking_code} vs ${listed?.booking_code}`);
  check('status is the real MENTOR_PENDING', listed?.status === 'MENTOR_PENDING', listed?.status);
  check('it is in the Pending Confirmation tab', pending.some((b) => b.id === target.entity_id));
  check('gig title matches the DB', listed?.gig?.title === db?.gig?.title, `${listed?.gig?.title} vs ${db?.gig?.title}`);
  check('segment matches the DB', listed?.segment?.name === db?.segment?.name, `${listed?.segment?.name} vs ${db?.segment?.name}`);
  check('seeker matches the DB', listed?.seeker?.full_name === db?.seeker?.full_name, `${listed?.seeker?.full_name} vs ${db?.seeker?.full_name}`);
  check('payment is the real VERIFIED payment', listed?.payment?.status === dbPayments?.[0]?.status, `${listed?.payment?.status} vs ${dbPayments?.[0]?.status}`);
  check('price is the booking-time snapshot', listed?.amount_inr === db?.amount_inr, `${listed?.amount_inr} vs ${db?.amount_inr}`);
  check('start/end times match the DB', listed?.start_time === db?.start_time && listed?.end_time === db?.end_time);
  check('duration is derived from the booked window', listed?.duration_minutes === 60, listed?.duration_minutes);
  check('timezone is the booking timezone', !!listed?.mentor_timezone, listed?.mentor_timezone);
}

console.log(`\n============  ${pass} passed, ${fail} failed  ============`);
process.exit(fail === 0 ? 0 : 1);
