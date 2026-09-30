import fs from 'node:fs';
import crypto from 'node:crypto';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const API = 'http://localhost:3000';
const DB = env.VITE_SUPABASE_URL.replace(/\/$/, '');
const ANON = env.VITE_SUPABASE_ANON_KEY;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;

const svcHeaders = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' };
const svcWrite = { ...svcHeaders, Prefer: 'return=representation' };

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

async function test() {
  // Find the secaudit mentor
  const mentors = await fetch(`${DB}/rest/v1/profiles?email=like.secaudit*mentor*@audit.local&select=id,email`, {
    headers: svcHeaders
  }).then(r => r.json());
  
  console.log('Found mentors:', mentors);
  
  for (const mentor of mentors) {
    // Find existing gigs for this mentor
    const gigs = await fetch(`${DB}/rest/v1/gigs?mentor_id=eq.${mentor.id}&is_active=eq.true&select=id`, {
      headers: svcHeaders
    }).then(r => r.json());
    
    console.log(`Gigs for mentor ${mentor.email}:`, gigs);
    
    if (gigs.length === 0) {
      console.error('No active gig found for mentor');
      continue;
    }
    
    const gigId = gigs[0].id;
    
    // Find bookings for this mentor and gig
    const bookings = await fetch(`${DB}/rest/v1/bookings?mentor_id=eq.${mentor.id}&gig_id=eq.${gigId}&select=id,booking_code,status`, {
      headers: svcHeaders
    }).then(r => r.json());
    
    console.log(`Bookings for mentor ${mentor.email} gig ${gigId}:`, bookings);
    
    let booking = bookings[0];
    
    if (!booking) {
      console.error('No booking found');
      continue;
    }
    
    // Now try to publish workspace
    const password = 'SecAudit!2026xQ';
    const token = await signIn(mentor.email, password);
    
    console.log('Got mentor token');
    
    // Step 1: Save as draft (PENDING)
    console.log('\n=== Step 1: Save as draft (PENDING) ===');
    const draftPayload = {
      bookingId: booking.id,
      mentorNotes: 'Draft mentor notes',
      takeaways: ['Draft takeaway 1'],
      suggestions: ['Draft suggestion 1'],
      nextSteps: [{ id: '1', text: 'Draft step 1', completed: false }],
      followUpRecommendation: { recommended: false, timeframe: '1 week', topic: 'Draft follow up', notes: 'Draft details' },
      publish: false
    };
    
    let response = await fetch(`${API}/api/workspaces`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(draftPayload)
    });
    
    let result = await response.json();
    console.log('Draft save status:', response.status);
    console.log('Draft save body:', JSON.stringify(result, null, 2));
    
    if (!result.success) {
      console.error('Failed to save draft');
      return;
    }
    
    const workspaceId = result.workspace.id;
    console.log('Workspace ID:', workspaceId);
    
    // Step 2: Publish the existing workspace
    console.log('\n=== Step 2: Publish existing workspace ===');
    const publishPayload = {
      bookingId: booking.id,
      mentorNotes: 'Published mentor notes',
      takeaways: ['Published takeaway 1', 'Published takeaway 2'],
      suggestions: ['Published suggestion 1'],
      nextSteps: [{ id: '1', text: 'Published step 1', completed: true }],
      followUpRecommendation: { recommended: true, timeframe: '2 weeks', topic: 'Published follow up', notes: 'Published details' },
      publish: true
    };
    
    response = await fetch(`${API}/api/workspaces`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(publishPayload)
    });
    
    result = await response.json();
    console.log('Publish status:', response.status);
    console.log('Publish body:', JSON.stringify(result, null, 2));
    
    // Step 3: Publish again (idempotent)
    console.log('\n=== Step 3: Publish again (idempotent) ===');
    response = await fetch(`${API}/api/workspaces`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(publishPayload)
    });
    
    result = await response.json();
    console.log('Second publish status:', response.status);
    console.log('Second publish body:', JSON.stringify(result, null, 2));
    
    break;
  }
}

test().catch(console.error);