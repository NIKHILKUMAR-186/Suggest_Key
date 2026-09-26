import fs from 'node:fs';

/**
 * Verifies whether the LIVE storage RLS lets the authenticated SEEKER upload a
 * payment proof directly to the private `payment-proofs` bucket.
 *
 * The live policy (phase4 migration) is:
 *   INSERT ... WITH CHECK (bucket_id = 'payment-proofs'
 *                          AND (storage.foldername(name))[1] = auth.uid()::text)
 *
 * If a client-side upload is permitted, the payment flow can send only a small
 * JSON metadata envelope to the API instead of a base64 image body, which is
 * what triggers the 413. This probes the real policy rather than assuming it.
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

const json = async (r) => { try { return await r.json(); } catch { return null; } };

const stamp = Date.now();
const email = `rls${stamp}@example.test`;
const pw = `Pw-${stamp}-aA1`;

const user = await json(await fetch(`${BASE}/auth/v1/admin/users`, {
  method: 'POST', headers: JH,
  body: JSON.stringify({ email, password: pw, email_confirm: true }),
}));
if (!user?.id) { console.error('could not create probe user', JSON.stringify(user)); process.exit(1); }
const uid = user.id;

const tok = await json(await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: pw }),
}));
if (!tok?.access_token) { console.error('sign-in failed', JSON.stringify(tok)); process.exit(1); }

// Exactly the headers the browser would send: anon key + the user's own JWT.
const CLIENT = { apikey: ANON, Authorization: `Bearer ${tok.access_token}` };

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

const booking = '00000000-0000-0000-0000-000000000001';
const ownPath = `${uid}/${booking}/rls-probe.png`;
const foreignPath = `somebody-else/${booking}/rls-probe.png`;

const up = await fetch(`${BASE}/storage/v1/object/payment-proofs/${ownPath}`, {
  method: 'POST', headers: { ...CLIENT, 'Content-Type': 'image/png' }, body: PNG,
});
console.log('UPLOAD into own folder   ->', up.status, up.ok ? 'ALLOWED' : (await up.text()).slice(0, 180));

const bad = await fetch(`${BASE}/storage/v1/object/payment-proofs/${foreignPath}`, {
  method: 'POST', headers: { ...CLIENT, 'Content-Type': 'image/png' }, body: PNG,
});
console.log('UPLOAD into foreign folder ->', bad.status, bad.ok ? '!! ALLOWED (RLS GAP)' : 'correctly denied');

if (up.ok) {
  const pub = await fetch(`${BASE}/storage/v1/object/public/payment-proofs/${ownPath}`);
  console.log('PUBLIC read of own upload ->', pub.status, pub.status === 200 ? '!! PUBLIC' : 'still private (good)');
}

await fetch(`${BASE}/storage/v1/object/payment-proofs/${ownPath}`, { method: 'DELETE', headers: SVC });
await fetch(`${BASE}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: SVC });
console.log('probe cleaned up');
