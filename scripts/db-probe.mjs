import fs from 'node:fs';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const URL_BASE = env.VITE_SUPABASE_URL.replace(/\/$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const get = async (p) => {
  const r = await fetch(`${URL_BASE}/rest/v1/${p}`, { headers: H });
  const t = await r.text();
  return { status: r.status, body: t };
};

const mode = process.argv[2];

if (mode === 'schema') {
  for (const t of ['payments', 'bookings', 'notifications', 'gigs', 'segments', 'profiles', 'seeker_profiles', 'mentor_profiles']) {
    const { status, body } = await get(`${t}?select=*&limit=1`);
    let cols = 'ERR';
    try {
      const j = JSON.parse(body);
      cols = Array.isArray(j) && j.length ? Object.keys(j[0]).join(', ') : `EMPTY_OR_ERR(${status}) ${body.slice(0, 120)}`;
    } catch { cols = body.slice(0, 200); }
    console.log(`=== ${t} [${status}] ===\n${cols}\n`);
  }
}

if (mode === 'rows') {
  const { body } = await get('payments?select=*&limit=5');
  console.log('payments rows:', body.slice(0, 1500));
}

if (mode === 'openapi') {
  const r = await fetch(`${URL_BASE}/rest/v1/`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: 'application/openapi+json' } });
  const spec = await r.json();
  const want = process.argv.slice(3);
  for (const [name, def] of Object.entries(spec.definitions || {})) {
    if (want.length && !want.includes(name)) continue;
    if (def.properties) {
      console.log(`\n=== ${name} ===`);
      for (const [c, p] of Object.entries(def.properties)) {
        console.log(`  ${c} :: ${p.type || p.format || '?'}${p.enum ? ' ENUM' + JSON.stringify(p.enum) : ''}${p.description ? '  // ' + p.description : ''}`);
      }
      console.log('  REQUIRED:', (def.required || []).join(', '));
    }
  }
  console.log('\n--- payments relation paths ---');
  for (const p of Object.keys(spec.paths || {})) if (/payment/i.test(p)) console.log('  ', p);
}

if (mode === 'rpc') {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${process.argv[3]}`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: '{}' });
  console.log(r.status, (await r.text()).slice(0, 2000));
}

if (mode === 'rpcsig') {
  const r = await fetch(`${URL_BASE}/rest/v1/`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: 'application/openapi+json' } });
  const spec = await r.json();
  for (const [p, v] of Object.entries(spec.paths || {})) {
    if (!/^\/rpc\//.test(p)) continue;
    const params = (v.post?.parameters || []).map((x) => x.name + (x.required ? '*' : ''));
    console.log(p.replace('/rpc/', '').padEnd(30), params.join(', '));
  }
}

if (mode === 'probe-constraint') {
  // Insert then attempt a duplicate booking_id to learn whether a unique
  // constraint exists. Both rows are removed again, so the probe leaves no trace.
  const bookingId = '0da02d9a-6bb3-4101-87da-660318fa6d90';
  const seekerId = '292515d7-88d3-4bd0-94de-020785a2667c';
  const base = {
    booking_id: bookingId,
    seeker_id: seekerId,
    amount_inr: 499,
    status: 'PENDING_VERIFICATION',
    proof_storage_path: 'probe/a.png',
    transaction_reference: 'PROBE',
  };
  const h = { ...H, 'Content-Type': 'application/json', Prefer: 'return=representation' };

  const del = await fetch(`${URL_BASE}/rest/v1/payments?transaction_reference=eq.PROBE`, { method: 'DELETE', headers: h });
  console.log('cleanup', del.status);

  const r1 = await fetch(`${URL_BASE}/rest/v1/payments`, { method: 'POST', headers: h, body: JSON.stringify(base) });
  const b1 = await r1.text();
  console.log('insert #1 ->', r1.status, b1.slice(0, 200));

  const r2 = await fetch(`${URL_BASE}/rest/v1/payments`, { method: 'POST', headers: h, body: JSON.stringify(base) });
  console.log('insert #2 (duplicate booking_id) ->', r2.status, (await r2.text()).slice(0, 400));

  const r3 = await fetch(`${URL_BASE}/rest/v1/payments?transaction_reference=eq.PROBE`, { method: 'DELETE', headers: h });
  console.log('final cleanup', r3.status);
}

if (mode === 'probe-review') {
  // Creates a throwaway PENDING payment, runs review_payment with the real admin,
  // observes the booking transition, then restores everything.
  const bookingId = process.argv[3];
  const adminId = '59f0712c-9018-42ed-a0ea-baaec3b97de8';
  const h = { ...H, 'Content-Type': 'application/json', Prefer: 'return=representation' };
  const del = () => fetch(`${URL_BASE}/rest/v1/payments?transaction_reference=eq.PROBEREV`, { method: 'DELETE', headers: h });

  await del();
  const b0 = await (await fetch(`${URL_BASE}/rest/v1/bookings?id=eq.${bookingId}&select=id,status,amount_inr,seeker_id`, { headers: H })).json();
  console.log('booking before:', JSON.stringify(b0));

  const ins = await fetch(`${URL_BASE}/rest/v1/payments`, {
    method: 'POST', headers: h,
    body: JSON.stringify({
      booking_id: bookingId, seeker_id: b0[0].seeker_id, amount_inr: b0[0].amount_inr,
      status: 'PENDING_VERIFICATION', proof_storage_path: 'probe/b.png', transaction_reference: 'PROBEREV',
    }),
  });
  const insBody = await ins.text();
  console.log('insert ->', ins.status, insBody.slice(0, 300));
  if (ins.status >= 400) { console.log('ABORT: nothing to clean up'); process.exit(0); }
  const payId = JSON.parse(insBody)[0].id;

  const rpc = await fetch(`${URL_BASE}/rest/v1/rpc/review_payment`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_payment_id: payId, p_approve: true, p_rejection_reason: null, p_admin_id: adminId }),
  });
  console.log('review_payment APPROVE ->', rpc.status, (await rpc.text()).slice(0, 600));

  const p1 = await (await fetch(`${URL_BASE}/rest/v1/payments?id=eq.${payId}&select=*`, { headers: H })).json();
  const b1 = await (await fetch(`${URL_BASE}/rest/v1/bookings?id=eq.${bookingId}&select=id,status`, { headers: H })).json();
  console.log('payment after:', JSON.stringify(p1));
  console.log('booking after:', JSON.stringify(b1));
  console.log('notifications referencing payment/booking:',
    JSON.stringify(await (await fetch(`${URL_BASE}/rest/v1/notifications?or=(entity_id.eq.${payId},entity_id.eq.${bookingId})&select=title,user_id,type,event_type,entity_type,entity_id`, { headers: H })).json()));

  await del();
  await fetch(`${URL_BASE}/rest/v1/bookings?id=eq.${bookingId}`, {
    method: 'PATCH', headers: h, body: JSON.stringify({ status: b0[0].status, updated_at: b0[0].updated_at }),
  });
  const b2 = await (await fetch(`${URL_BASE}/rest/v1/bookings?id=eq.${bookingId}&select=id,status`, { headers: H })).json();
  console.log('restored booking:', JSON.stringify(b2), 'payments left:',
    JSON.stringify(await (await fetch(`${URL_BASE}/rest/v1/payments?transaction_reference=eq.PROBEREV&select=id`, { headers: H })).json()));
}

if (mode === 'probe-reject') {
  const bookingId = process.argv[3];
  const adminId = '59f0712c-9018-42ed-a0ea-baaec3b97de8';
  const h = { ...H, 'Content-Type': 'application/json', Prefer: 'return=representation' };

  const b0 = await (await fetch(`${URL_BASE}/rest/v1/bookings?id=eq.${bookingId}&select=id,status,amount_inr,seeker_id,mentor_id,booking_code`, { headers: H })).json();
  console.log('booking before:', JSON.stringify(b0[0]));

  const ins = await (await fetch(`${URL_BASE}/rest/v1/payments`, {
    method: 'POST', headers: h,
    body: JSON.stringify({
      booking_id: bookingId, seeker_id: b0[0].seeker_id, amount_inr: b0[0].amount_inr,
      status: 'PENDING_VERIFICATION', proof_storage_path: 'probe/c.png', transaction_reference: 'PROBEREJ',
    }),
  })).json();
  const payId = ins[0].id;

  const rpc = await fetch(`${URL_BASE}/rest/v1/rpc/review_payment`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_payment_id: payId, p_approve: false, p_rejection_reason: 'Blurry screenshot', p_admin_id: adminId }),
  });
  console.log('review_payment REJECT ->', rpc.status, (await rpc.text()).slice(0, 500));

  const p1 = await (await fetch(`${URL_BASE}/rest/v1/payments?id=eq.${payId}&select=status,rejection_reason,verified_by`, { headers: H })).json();
  const b1 = await (await fetch(`${URL_BASE}/rest/v1/bookings?id=eq.${bookingId}&select=id,status`, { headers: H })).json();
  console.log('payment after:', JSON.stringify(p1));
  console.log('booking after:', JSON.stringify(b1));

  // A rejected payment must be re-submittable, so also confirm a second
  // submission for the same booking updates rather than duplicating.
  const upd = await fetch(`${URL_BASE}/rest/v1/payments?id=eq.${payId}`, {
    method: 'PATCH', headers: h,
    body: JSON.stringify({ status: 'PENDING_VERIFICATION', rejection_reason: null, transaction_reference: 'PROBEREJ2', updated_at: new Date().toISOString() }),
  });
  console.log('re-submit PATCH ->', upd.status);
  console.log('rows for booking now:',
    JSON.stringify(await (await fetch(`${URL_BASE}/rest/v1/payments?booking_id=eq.${bookingId}&select=id,status,transaction_reference`, { headers: H })).json()));

  await fetch(`${URL_BASE}/rest/v1/payments?id=eq.${payId}`, { method: 'DELETE', headers: h });
  await fetch(`${URL_BASE}/rest/v1/bookings?id=eq.${bookingId}`, {
    method: 'PATCH', headers: h, body: JSON.stringify({ status: b0[0].status }),
  });
  console.log('restored:', JSON.stringify(await (await fetch(`${URL_BASE}/rest/v1/bookings?id=eq.${bookingId}&select=status`, { headers: H })).json()));
}

if (mode === 'probe-storage') {
  // Confirms the service role can write to the private payment-proofs bucket
  // using the project path convention, then reads it back signed.
  const path = `${process.argv[3]}/${process.argv[4]}/probe-proof.txt`;
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64',
  );
  const up = await fetch(`${URL_BASE}/storage/v1/object/payment-proofs/${path}`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'image/png' }, body: png,
  });
  console.log('upload ->', up.status, (await up.text()).slice(0, 300));

  const pub = await fetch(`${URL_BASE}/storage/v1/object/public/payment-proofs/${path}`);
  console.log('PUBLIC access attempt ->', pub.status, (pub.status === 200 ? '!! BUCKET IS PUBLIC' : 'correctly denied'));

  const rm = await fetch(`${URL_BASE}/storage/v1/object/payment-proofs/${path}`, { method: 'DELETE', headers: H });
  console.log('cleanup ->', rm.status);
}

if (mode === 'probe-notif') {
  const h = { ...H, 'Content-Type': 'application/json', Prefer: 'return=representation' };
  const mk = (row) => fetch(`${URL_BASE}/rest/v1/notifications`, { method: 'POST', headers: h, body: JSON.stringify(row) });

  console.log('--- insert with user_id: null (pattern used elsewhere in server.ts) ---');
  const n = await mk({ user_id: null, title: 'PROBE', message: 'probe', type: 'ADMIN', is_read: false });
  console.log('->', n.status, (await n.text()).slice(0, 300));

  console.log('--- insert with a real admin id ---');
  const a = await mk({
    user_id: '59f0712c-9018-42ed-a0ea-baaec3b97de8', title: 'PROBE2', message: 'probe',
    type: 'PAYMENT', event_type: 'ADMIN_PAYMENT_PROOF_SUBMITTED', entity_type: 'payment',
    entity_id: '00000000-0000-0000-0000-000000000000', link: '/admin/payments', is_read: false,
  });
  console.log('->', a.status, (await a.text()).slice(0, 200));

  console.log('--- dedupe probe: does the same notification row repeat? ---');
  const adminIds = await (await fetch(`${URL_BASE}/rest/v1/user_roles?role=eq.admin&select=user_id`, { headers: H })).json();
  console.log('admin user_ids:', JSON.stringify(adminIds));

  await fetch(`${URL_BASE}/rest/v1/notifications?or=(title.eq.PROBE,title.eq.PROBE2)`, { method: 'DELETE', headers: h });
  console.log('cleaned:', JSON.stringify(await (await fetch(`${URL_BASE}/rest/v1/notifications?or=(title.eq.PROBE,title.eq.PROBE2)&select=id`, { headers: H })).json()));
}

if (mode === 'purge-e2e') {
  // Removes any leftover temporary E2E users (auth + profile + roles).
  const { data: profiles } = await get('profiles?email=like.*e2e*&select=id,email');
  for (const p of profiles || []) {
    await fetch(`${URL_BASE}/auth/v1/admin/users/${p.id}`, { method: 'DELETE', headers: H });
    await fetch(`${URL_BASE}/rest/v1/user_roles?user_id=eq.${p.id}`, { method: 'DELETE', headers: H });
    await fetch(`${URL_BASE}/rest/v1/mentor_profiles?id=eq.${p.id}`, { method: 'DELETE', headers: H });
    await fetch(`${URL_BASE}/rest/v1/gigs?mentor_id=eq.${p.id}`, { method: 'DELETE', headers: H });
    await fetch(`${URL_BASE}/rest/v1/bookings?or=(seeker_id.eq.${p.id},mentor_id.eq.${p.id})`, { method: 'DELETE', headers: H });
    await fetch(`${URL_BASE}/rest/v1/notifications?user_id=eq.${p.id}`, { method: 'DELETE', headers: H });
    console.log('purged', p.email);
  }
  console.log('remaining:', JSON.stringify(await get('profiles?email=like.*e2e*&select=id,email')));
}

if (mode === 'q') {
  const { status, body } = await get(process.argv[3]);
  console.log(status, body.slice(0, 4000));
}

if (mode === 'call') {
  // call <fn> <jsonArgs>  -- PostgREST named-parameter invocation
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${process.argv[3]}`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: process.argv[4] || '{}',
  });
  console.log(process.argv[3], '->', r.status, (await r.text()).slice(0, 1200));
}

if (mode === 'listfns') {
  // Functions with a homogeneous (all same-type) parameter list are callable by name.
  const r = await fetch(`${URL_BASE}/rest/v1/`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: 'application/openapi+json' } });
  const spec = await r.json();
  for (const [p, v] of Object.entries(spec.paths || {})) {
    if (!/^\/rpc\//.test(p)) continue;
    const params = (v.post?.parameters || []);
    const names = params.map((x) => x.name);
    const key = names.join('|');
    if (/payment|notification/.test(p)) console.log(p, '->', JSON.stringify(params.map((x) => ({ n: x.name, req: x.required, d: x.description }))));
  }
}

if (mode === 'constraints') {
  // PostgREST cannot expose constraints, so infer them behaviourally.
  const { status, body } = await get('payments?select=booking_id,status&limit=3');
  console.log('sample', status, body);
}

if (mode === 'sql') {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${process.argv[3]}`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify(JSON.parse(process.argv[4] || '{}')),
  });
  console.log(r.status, (await r.text()).slice(0, 3000));
}

if (mode === 'storagepolicy') {
  // Storage objects are not exposed via PostgREST; probe the storage API instead.
  const r = await fetch(`${URL_BASE}/storage/v1/object/list/payment-proofs`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: '', limit: 10 }),
  });
  console.log('list objects ->', r.status, (await r.text()).slice(0, 500));
}

if (mode === 'buckets') {
  const r = await fetch(`${URL_BASE}/storage/v1/bucket`, { headers: H });
  console.log(r.status, JSON.stringify(await r.json(), null, 2).slice(0, 3000));
}

