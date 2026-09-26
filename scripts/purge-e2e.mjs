import fs from 'node:fs';

/** Removes leftover temporary E2E users and everything hanging off them. */
const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const BASE = env.VITE_SUPABASE_URL.replace(/\/$/, '');
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };

const get = async (p) => (await fetch(`${BASE}/rest/v1/${p}`, { headers: H })).json();

const rows = await get('profiles?select=id,email');
const targets = (rows || []).filter((p) => String(p.email).includes('e2e'));

for (const p of targets) {
  for (const t of ['mentor_profiles?id', 'gigs?mentor_id', 'bookings?seeker_id', 'bookings?mentor_id',
                   'payments?seeker_id', 'notifications?user_id', 'user_roles?user_id', 'profiles?id']) {
    const [tbl, q] = t.split('?');
    await fetch(`${BASE}/rest/v1/${tbl}?${q}=eq.${p.id}`, { method: 'DELETE', headers: H });
  }
  const r = await fetch(`${BASE}/auth/v1/admin/users/${p.id}`, { method: 'DELETE', headers: H });
  console.log('purged', p.email, '| auth:', r.status);
}

const left = await get('profiles?select=id,email');
console.log('remaining e2e profiles:', JSON.stringify((left || []).filter((p) => String(p.email).includes('e2e'))));
