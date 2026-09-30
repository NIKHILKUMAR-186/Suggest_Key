import 'dotenv/config';

const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DB = process.env.VITE_SUPABASE_URL.replace(/\/$/, '');

const svcHeaders = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' };

async function applyMigration() {
  // Execute the phase33 migration SQL statements
  
  // 1. Add the four missing columns
  const statements = [
    `ALTER TABLE public.session_workspaces ADD COLUMN IF NOT EXISTS mentor_notes TEXT NOT NULL DEFAULT '';`,
    `ALTER TABLE public.session_workspaces ADD COLUMN IF NOT EXISTS suggestions JSONB NOT NULL DEFAULT '[]'::jsonb;`,
    `ALTER TABLE public.session_workspaces ADD COLUMN IF NOT EXISTS next_steps JSONB NOT NULL DEFAULT '[]'::jsonb;`,
    `ALTER TABLE public.session_workspaces ADD COLUMN IF NOT EXISTS follow_up_recommendation JSONB DEFAULT NULL;`,
    // 2. Backfill summary into mentor_notes
    `UPDATE public.session_workspaces SET mentor_notes = summary WHERE mentor_notes = '' AND summary IS NOT NULL AND summary <> '';`,
    // 3. Create unique index on booking_id
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_session_workspaces_booking_id ON public.session_workspaces (booking_id);`,
  ];
  
  for (const sql of statements) {
    console.log(`Executing: ${sql}`);
    const response = await fetch(`${DB}/rest/v1/rpc/execute_sql`, {
      method: 'POST',
      headers: svcHeaders,
      body: JSON.stringify({ sql })
    });
    const result = await response.json();
    console.log('Result:', result);
  }
  
  // 4. Verify all columns exist
  console.log('\nVerifying columns...');
  const verifySql = `
    SELECT string_agg(expected, ', ') as missing
    FROM unnest(ARRAY[
      'booking_id', 'mentor_id', 'seeker_id', 'status', 'mentor_notes',
      'summary', 'takeaways', 'suggestions', 'next_steps', 'action_items',
      'follow_up_recommendation', 'resources', 'published_at'
    ]) AS expected
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = 'session_workspaces'
       AND c.column_name = expected
   );
  `;
  
  const response = await fetch(`${DB}/rest/v1/rpc/execute_sql`, {
    method: 'POST',
    headers: svcHeaders,
    body: JSON.stringify({ sql: verifySql })
  });
  const result = await response.json();
  console.log('Missing columns:', result);
  
  // 5. Verify unique index on booking_id
  const indexSql = `
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'session_workspaces'
     AND i.indisunique
     AND i.indnatts = 1
     AND i.indkey[0] = (
       SELECT a.attnum FROM pg_attribute a
       WHERE a.attrelid = 'public.session_workspaces'::regclass
         AND a.attname = 'booking_id'
     );
  `;
  
  const indexResponse = await fetch(`${DB}/rest/v1/rpc/execute_sql`, {
    method: 'POST',
    headers: svcHeaders,
    body: JSON.stringify({ sql: indexSql })
  });
  const indexResult = await indexResponse.json();
  console.log('Unique index exists:', indexResult);
}

applyMigration().catch(console.error);