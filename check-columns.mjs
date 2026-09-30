import 'dotenv/config';

const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DB = process.env.VITE_SUPABASE_URL.replace(/\/$/, '');

const svcHeaders = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' };

async function checkColumns() {
  // Try to select the columns that should exist
  // If a column doesn't exist, PostgREST will return PGRST204
  
  const columnsToCheck = [
    'mentor_notes',
    'suggestions',
    'next_steps',
    'follow_up_recommendation',
    'summary',
    'takeaways',
    'action_items',
    'resources',
    'published_at',
    'status',
    'booking_id',
    'mentor_id',
    'seeker_id'
  ];
  
  for (const col of columnsToCheck) {
    try {
      const response = await fetch(`${DB}/rest/v1/session_workspaces?select=${col}&limit=1`, {
        headers: svcHeaders
      });
      const result = await response.json();
      if (response.ok) {
        console.log(`✓ ${col}: EXISTS`);
      } else {
        console.log(`✗ ${col}: MISSING - ${result.message || result.code}`);
      }
    } catch (e) {
      console.log(`✗ ${col}: ERROR - ${e.message}`);
    }
  }
}

checkColumns().catch(console.error);