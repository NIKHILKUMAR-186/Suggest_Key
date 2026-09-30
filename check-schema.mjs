import 'dotenv/config';

const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DB = process.env.VITE_SUPABASE_URL.replace(/\/$/, '');

const svcHeaders = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' };

async function checkSchema() {
  // Check columns in session_workspaces
  const columns = await fetch(`${DB}/rest/v1/information_schema.columns?table_name=eq.session_workspaces&table_schema=eq.public&select=column_name,data_type,is_nullable,column_default`, {
    headers: svcHeaders
  }).then(r => r.json());
  
  console.log('Columns response:', JSON.stringify(columns, null, 2));
  
  if (Array.isArray(columns)) {
    columns.forEach(c => {
      console.log(`  ${c.column_name}: ${c.data_type} ${c.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'} ${c.column_default ? `DEFAULT ${c.column_default}` : ''}`);
    });
  }
}

checkSchema().catch(console.error);