import 'dotenv/config';

const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DB = process.env.VITE_SUPABASE_URL.replace(/\/$/, '');

const svcHeaders = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' };

async function checkGrants() {
  // Check table grants
  const tableGrants = await fetch(`${DB}/rest/v1/information_schema.role_table_grants?table_name=eq.session_workspaces&select=grantee,privilege_type`, {
    headers: svcHeaders
  }).then(r => r.json());
  
  console.log('Table grants:', tableGrants);
  
  // Check column grants
  const columnGrants = await fetch(`${DB}/rest/v1/information_schema.role_column_grants?table_name=eq.session_workspaces&select=grantee,column_name,privilege_type`, {
    headers: svcHeaders
  }).then(r => r.json());
  
  console.log('Column grants:', columnGrants);
}

checkGrants().catch(console.error);