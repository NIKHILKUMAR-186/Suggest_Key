import fs from 'node:fs';

/**
 * Verifies the System Health dashboard endpoint against the LIVE database:
 *   - unauthenticated and non-admin callers are refused server-side
 *   - an admin receives metrics computed from real system_logs rows
 *   - the overview maths is internally consistent
 *   - ranges, drill-down windows and endpoint filters behave
 *
 * Temporary accounts are created and removed again; no real account is used.
 */
const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const BASE = env.VITE_SUPABASE_URL.replace(/\/$/, '');
const ANON = env.VITE_SUPABASE_ANON_KEY;
const SVC = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
const JH = { ...SVC, 'Content-Type': 'application/json' };
const API = process.env.API_BASE || 'http://localhost:3300';

const json = async (r) => { try { return await r.json(); } catch { return null; } };
let pass = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${extra}`); }
};
const section = (t) => console.log(`\n=== ${t} ===`);

const stamp = Date.now();
const pw = `Pw-${stamp}-aA1`;

const mkUser = async (email, role) => {
  const created = await json(await fetch(`${BASE}/auth/v1/admin/users`, {
    method: 'POST', headers: JH,
    body: JSON.stringify({ email, password: pw, email_confirm: true }),
  }));
  if (!created?.id) throw new Error(`create ${role}: ${JSON.stringify(created)}`);
  await fetch(`${BASE}/rest/v1/user_roles`, {
    method: 'POST', headers: JH, body: JSON.stringify({ user_id: created.id, role }),
  });
  return created;
};

const signIn = async (email) => {
  const b = await json(await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pw }),
  }));
  if (!b?.access_token) throw new Error(`sign-in failed: ${JSON.stringify(b)}`);
  return b.access_token;
};

const admin = await mkUser(`sh${stamp}-admin@example.test`, 'admin');
const seeker = await mkUser(`sh${stamp}-seeker@example.test`, 'seeker');

try {
  const adminToken = await signIn(`sh${stamp}-admin@example.test`);
  const seekerToken = await signIn(`sh${stamp}-seeker@example.test`);

  section('1. Server-side authorization');
  const anon = await fetch(`${API}/api/admin/system-health/dashboard?range=1h`);
  check('unauthenticated is 401', anon.status === 401, `got ${anon.status}`);

  const asSeeker = await fetch(`${API}/api/admin/system-health/dashboard?range=1h`, {
    headers: { Authorization: `Bearer ${seekerToken}` },
  });
  check('non-admin seeker is 403', asSeeker.status === 403, `got ${asSeeker.status}`);

  const asAdmin = await fetch(`${API}/api/admin/system-health/dashboard?range=1h`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  check('admin is 200', asAdmin.status === 200, `got ${asAdmin.status}`);
  const body = await json(asAdmin);
  const d = body?.dashboard;
  check('response has the documented shape',
    !!d && 'overview' in d && 'timeline' in d && 'anomalies' in d && 'topErrors' in d && 'services' in d && 'lastUpdated' in d);


  section('2. Metrics are real and internally consistent');
  const o = d.overview;
  console.log('   overview:', JSON.stringify(o));
  check('totalRequests equals success + 4xx + 5xx',
    o.totalRequests === o.successfulRequests + o.error4xx + o.error5xx,
    `${o.totalRequests} vs ${o.successfulRequests + o.error4xx + o.error5xx}`);
  check('successRate and errorRate sum to ~100',
    o.totalRequests === 0 || Math.abs(o.successRate + o.errorRate - 100) < 0.2,
    `${o.successRate} + ${o.errorRate}`);
  check('rates match their own numerators',
    o.totalRequests === 0 ||
      (Math.abs(o.successRate - (o.successfulRequests / o.totalRequests) * 100) < 0.11 &&
       Math.abs(o.errorRate - ((o.error4xx + o.error5xx) / o.totalRequests) * 100) < 0.11));
  check('p95 is >= average when both exist',
    o.averageLatencyMs == null || o.p95LatencyMs == null || o.p95LatencyMs >= o.averageLatencyMs,
    `avg=${o.averageLatencyMs} p95=${o.p95LatencyMs}`);

  section('3. Timeline is real, fixed-width and complete');
  check('timeline has buckets', Array.isArray(d.timeline) && d.timeline.length > 0, String(d.timeline?.length));
  check('timeline bucket count matches the 1h range', d.timeline.length === 30, String(d.timeline?.length));
  const sumReq = d.timeline.reduce((a, b) => a + b.requests, 0);
  check('timeline request total matches the overview', sumReq === o.totalRequests, `${sumReq} vs ${o.totalRequests}`);
  const sum5 = d.timeline.reduce((a, b) => a + b.errors5xx, 0);
  check('timeline 5xx total matches the overview', sum5 === o.error5xx, `${sum5} vs ${o.error5xx}`);
  check('every bucket is a valid timestamp',
    d.timeline.every((b) => !Number.isNaN(Date.parse(b.bucket))));

  section('4. Ranges are honoured');
  for (const [range, expected] of [['15m', 15], ['1h', 30], ['24h', 48], ['7d', 56]]) {
    const r = await fetch(`${API}/api/admin/system-health/dashboard?range=${range}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const b = await json(r);
    check(`range=${range} returns ${expected} buckets`,
      b?.dashboard?.timeline?.length === expected, String(b?.dashboard?.timeline?.length));
  }
  const bad = await fetch(`${API}/api/admin/system-health/dashboard?range=banana`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const badBody = await json(bad);
  check('invalid range falls back to the default', badBody?.dashboard?.range === '1h', badBody?.dashboard?.range);

  section('5. Anomalies are evidence-based');
  check('anomalies is an array', Array.isArray(d.anomalies));
  console.log('   anomalies:', JSON.stringify(d.anomalies));
  for (const a of d.anomalies ?? []) {
    check(`anomaly "${a.metric}" has current > baseline`, a.currentValue > a.baselineValue, JSON.stringify(a));
    check(`anomaly "${a.metric}" carries a drill-down window`,
      Number.isFinite(Date.parse(a.windowStart)) && Number.isFinite(Date.parse(a.windowEnd)));
  }

  section('6. Services + auth + top errors come from logs');
  console.log('   services:', JSON.stringify(d.services));
  check('all five services reported',
    ['api', 'database', 'authentication', 'storage', 'notifications'].every((k) => k in d.services));
  check('every service has a real status word',
    Object.values(d.services).every((s) => ['operational', 'degraded', 'critical', 'unknown'].includes(s.status)));
  console.log('   auth:', JSON.stringify(d.auth));
  check('auth summary present', typeof d.auth?.totalEvents === 'number');
  check('topErrors is an array', Array.isArray(d.topErrors));
  for (const g of d.topErrors ?? []) {
    check(`group "${g.endpoint}" has real counts and timestamps`,
      g.occurrences >= 1 && Number.isFinite(Date.parse(g.first_seen)) && Number.isFinite(Date.parse(g.last_seen)));
  }

  section('7. Drill-down narrows to an exact window');
  if (d.timeline.length) {
    const b0 = d.timeline[Math.max(0, d.timeline.length - 3)];
    const startAt = b0.bucket;
    const endAt = new Date(Date.parse(b0.bucket) + d.bucketMs).toISOString();
    const drill = await fetch(
      `${API}/api/admin/system-health/dashboard?range=1h&startAt=${encodeURIComponent(startAt)}&endAt=${encodeURIComponent(endAt)}`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    const dBody = await json(drill);
    const dw = dBody?.dashboard?.window;
    check('drill-down echoes the requested window',
      dw?.start === startAt && dw?.end === endAt, JSON.stringify(dw));
    check('drill-down total is <= the full-range total',
      dBody?.dashboard?.overview?.totalRequests <= o.totalRequests);
  }

  const top = d.topErrors?.[0];
  if (top?.endpoint) {
    const byEp = await fetch(
      `${API}/api/admin/system-health/dashboard?range=1h&endpoint=${encodeURIComponent(top.endpoint)}`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    const eBody = await json(byEp);
    const eps = (eBody?.dashboard?.topErrors ?? []).map((g) => g.endpoint);
    check('endpoint filter returns only that endpoint',
      eps.length > 0 && eps.every((p) => p && p.includes(top.endpoint)), JSON.stringify(eps));
  }

  section('8. No secrets leaked in the payload');
  const raw = JSON.stringify(body);
  for (const secret of ['service_role', 'SUPABASE_SERVICE_ROLE', 'eyJ', 'password', 'postgresql://']) {
    check(`payload does not contain "${secret}"`, !raw.includes(secret));
  }
} finally {
  for (const u of [admin, seeker]) {
    await fetch(`${BASE}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: SVC });
  }
  console.log('\n  temp users removed');
}

console.log(`\n============  ${pass} passed, ${fail} failed  ============`);
process.exit(fail === 0 ? 0 : 1);
