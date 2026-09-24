import { apiFetch } from './apiClient';
import { supabase, isSupabaseConfigured } from './supabase';
import {
  SessionWorkspace,
  WorkspaceStatus,
  FollowUpRecommendation,
  NextStepItem,
  SessionOverviewData,
  Booking,
} from '@/src/types/database';
import { getLocalBookingEngineContext } from './bookingService';

const isDevMode = process.env.NODE_ENV !== 'production';

// ponytail: localWorkspaces is dev-only preview data.
// Production must use real Supabase data; this fallback is only used when
// isSupabaseConfigured() is false and the app is running in local preview mode.
let localWorkspaces: SessionWorkspace[] = [
  {
    id: 'ws-ended-03',
    booking_id: 'bk-session-ended',
    mentor_id: 'usr-8802',
    seeker_id: 'usr-8801',
    status: 'PUBLISHED',
    mentor_notes:
      'Great dialogue on identifying conversational friction points and setting boundaries with emotional clarity. Aman demonstrated high self-awareness and willingness to adopt structured conversational pause techniques.',
    summary:
      'Great dialogue on identifying conversational friction points and setting boundaries with emotional clarity.',
    takeaways: [
      'Distinguish between the underlying emotion and the reactive behavior during tense discussions.',
      'Implement a 2-minute cooling off rule before answering emotionally charged messages.',
      'Express personal needs using "I feel" rather than accusatory "You always" statements.',
    ],
    suggestions: [
      'Read Chapter 3 of "Nonviolent Communication" by Marshall Rosenberg.',
      'Practice weekly active-listening check-ins for 15 minutes without electronic distractions.',
      'Maintain an emotional trigger journal whenever conversational stress spikes.',
    ],
    next_steps: [
      {
        id: 'ns-1',
        text: 'Log three instances of conversational friction in notes with root cause observations',
        due_date: 'In 7 days',
        completed: false,
      },
      {
        id: 'ns-2',
        text: 'Review boundary script rehearsal before high-stakes family or work conversation',
        due_date: 'In 14 days',
        completed: false,
      },
      {
        id: 'ns-3',
        text: 'Assess communication log in follow-up session',
        due_date: 'Optional',
        completed: false,
      },
    ],
    action_items: [
      { id: 'act-1', text: 'Log 3 communication triggers', completed: false },
      { id: 'act-2', text: 'Practice 2-minute cooling off pause', completed: true },
    ],
    follow_up_recommendation: {
      recommended: true,
      timeframe: '2-3 weeks',
      topic: 'Boundary Reinforcement & Regulation Review',
      notes:
        'A follow-up session after two weeks of practicing active listening will allow us to assess emotional regulation progress and fine-tune response tactics.',
    },
    resources: [
      {
        title: 'Nonviolent Communication Primer',
        url: 'https://example.com/resources/nvc-guide.pdf',
        type: 'DOCUMENT',
      },
      {
        title: 'Emotional De-escalation Checklist',
        url: 'https://example.com/tools/deescalation',
        type: 'TOOL',
      },
    ],
    published_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
  },
  {
    id: 'ws-9021',
    booking_id: 'bk-9021',
    mentor_id: 'usr-8802',
    seeker_id: 'usr-8801',
    status: 'PENDING',
    mentor_notes: 'Drafting session summary for pre-session consultation goals...',
    summary: 'Drafting session summary...',
    takeaways: ['Establish baseline relationship trust indicators.'],
    suggestions: ['Review mutual expectation sheet.'],
    next_steps: [
      {
        id: 'ns-9021-1',
        text: 'Complete relationship assessment checklist prior to scheduled consultation',
        due_date: 'Before session',
        completed: false,
      },
    ],
    action_items: [],
    follow_up_recommendation: null,
    resources: [],
    published_at: null,
    created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
  },
];

/**
 * Returns current local workspaces list.
 */
export function getLocalWorkspaces(): SessionWorkspace[] {
  return localWorkspaces;
}

/**
 * Derives sanitized session overview data without exposing unrelated private details.
 * Works synchronously from the booking's joined fields (mentor, seeker, gig, segment)
 * or from local dev DB lookups when those fields are not populated.
 */
export function deriveSessionOverview(booking: Booking): SessionOverviewData {
  const startMs = new Date(booking.start_time).getTime();
  const endMs = new Date(booking.end_time).getTime();
  const durationMinutes = Math.max(15, Math.round((endMs - startMs) / (60 * 1000)));

  // Use joined fields when available (from real Supabase queries)
  const mentorName = booking.mentor?.full_name || '—';
  const mentorHeadline = booking.gig?.title || '—';
  const seekerName = booking.seeker?.full_name || '—';
  const segmentTitle = booking.segment?.name || '—';
  const gigTitle = booking.gig?.title || '—';

  // If joined fields are missing and we're in dev mode, fall back to local DB lookup
  if (!booking.mentor && !isSupabaseConfigured() && isDevMode) {
    const db = getLocalBookingEngineContext();
    const mentorProfile = db.profiles.find((p) => p.id === booking.mentor_id);
    const mentorInfo = db.mentorProfiles.find((mp) => mp.id === booking.mentor_id);
    const seekerProfile = db.profiles.find((p) => p.id === booking.seeker_id);
    const segment = db.segments.find((s) => s.id === booking.segment_id);
    const gig = db.gigs.find((g) => g.id === booking.gig_id);

    return {
      bookingId: booking.id,
      bookingCode: booking.booking_code,
      startTime: booking.start_time,
      endTime: booking.end_time,
      durationMinutes,
      mentorId: booking.mentor_id,
      mentorName: mentorProfile?.full_name || '—',
      mentorHeadline: mentorInfo?.headline || '—',
      seekerId: booking.seeker_id,
      seekerName: seekerProfile?.full_name || '—',
      segmentTitle: segment?.name || '—',
      gigTitle: gig?.title || '—',
      bookingStatus: booking.status,
    };
  }

  return {
    bookingId: booking.id,
    bookingCode: booking.booking_code,
    startTime: booking.start_time,
    endTime: booking.end_time,
    durationMinutes,
    mentorId: booking.mentor_id,
    mentorName,
    mentorHeadline,
    seekerId: booking.seeker_id,
    seekerName,
    segmentTitle,
    gigTitle,
    bookingStatus: booking.status,
  };
}

/**
 * Fetch authoritative session workspace for a given booking ID.
 * Respects RLS and privacy rules:
 * - Seeker: only permitted if published or completed.
 * - Mentor: permitted for own bookings.
 * - Admin: operational access to all.
 */
export async function fetchWorkspaceByBooking(
  bookingId: string,
  userId?: string,
  role?: string
): Promise<{ workspace: SessionWorkspace | null; error: Error | null; isPending?: boolean }> {
  // 1. Try real Supabase query if configured
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('session_workspaces')
        .select('*')
        .eq('booking_id', bookingId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.warn('Supabase session_workspaces query warning:', error.message);
       } else if (data) {
         // Fetch booking from Supabase to derive session overview
         let booking: Booking | null = null;
         try {
           const { data: bookingData, error: bookingErr } = await supabase
             .from('bookings')
             .select('*, mentor:profiles!mentor_id!inner(full_name), seeker:profiles!seeker_id!inner(full_name), gig:gigs!inner(*), segment:segments!inner(*)')
             .eq('id', bookingId)
             .maybeSingle();
           if (!bookingErr && bookingData) {
             booking = bookingData as unknown as Booking;
           }
         } catch (bkErr: any) {
           console.warn('Could not fetch booking for overview:', bkErr.message);
         }
         const overview = booking ? deriveSessionOverview(booking) : null;

        const record: SessionWorkspace = {
          id: data.id,
          booking_id: data.booking_id,
          mentor_id: data.mentor_id,
          seeker_id: data.seeker_id,
          status: data.status as WorkspaceStatus,
          mentor_notes: data.mentor_notes || data.summary || '',
          summary: data.summary || data.mentor_notes || '',
          takeaways: Array.isArray(data.takeaways) ? data.takeaways : [],
          suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
          next_steps: Array.isArray(data.next_steps) ? data.next_steps : [],
          action_items: Array.isArray(data.action_items) ? data.action_items : [],
          follow_up_recommendation: data.follow_up_recommendation || null,
          resources: Array.isArray(data.resources) ? data.resources : [],
          published_at: data.published_at || null,
          created_at: data.created_at,
          updated_at: data.updated_at,
          session_overview: overview || undefined,
        };

        // Check seeker view restriction
        if (role === 'seeker' && record.status === 'PENDING') {
          return { workspace: null, error: null, isPending: true };
        }

        return { workspace: record, error: null };
      }
    } catch (err: any) {
      console.warn('Falling back to local workspace database:', err.message);
    }
  }

  // 2. Query server API or local in-memory fallback
  try {
    const res = await apiFetch(`/api/workspaces/booking/${bookingId}`);
    if (res.ok) {
      const json = await res.json();
      if (json.success) {
        if (json.isPending) {
          return { workspace: null, error: null, isPending: true };
        }
        return { workspace: json.workspace, error: null };
      }
    }
  } catch (err) {
    // Continue to local in-memory fallback
  }

  // 3. Fallback to local in-memory engine (DEV ONLY)
  if (!isDevMode) {
    return { workspace: null, error: null };
  }

  const db = getLocalBookingEngineContext();
  const booking = db.bookings.find(
    (b) => b.id === bookingId || b.booking_code.toUpperCase() === bookingId.toUpperCase()
  );

  if (!booking) {
    return { workspace: null, error: new Error('Booking not found') };
  }

  const overview = deriveSessionOverview(booking);
  let ws = localWorkspaces.find((w) => w.booking_id === booking.id);

  if (!ws) {
    // If not found, return null (empty state)
    return { workspace: null, error: null };
  }

  // Enforce Seeker RLS rule: seekers only see PUBLISHED workspaces
  if (role === 'seeker' && ws.status !== 'PUBLISHED') {
    return { workspace: null, error: null, isPending: true };
  }

  return {
    workspace: {
      ...ws,
      session_overview: overview,
    },
    error: null,
  };
}

export interface SaveWorkspacePayload {
  booking_id: string;
  mentor_id: string;
  mentor_notes: string;
  takeaways: string[];
  suggestions: string[];
  next_steps: NextStepItem[];
  follow_up_recommendation?: FollowUpRecommendation | null;
  publish?: boolean;
}

/**
 * Mentor or Admin creates, edits, and saves a session workspace.
 */
export async function saveWorkspaceAuthoritative(
  payload: SaveWorkspacePayload,
  userId: string,
  role: string
): Promise<{ success: boolean; workspace?: SessionWorkspace; error?: { message: string } }> {
  // Authorization validation - fetch booking from Supabase if configured
  let booking: Booking | null = null;

  if (isSupabaseConfigured()) {
    try {
      const { data: bookingData, error: bookingErr } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', payload.booking_id)
        .maybeSingle();
      if (!bookingErr && bookingData) {
        booking = bookingData as Booking;
      }
    } catch (err: any) {
      console.warn('Failed to fetch booking for authorization check:', err.message);
    }
  }

  if (!booking && isDevMode) {
    // Dev-only fallback to local DB
    const db = getLocalBookingEngineContext();
    booking = db.bookings.find((b) => b.id === payload.booking_id) || null;
  }

  if (!booking) {
    return { success: false, error: { message: 'Referenced booking does not exist.' } };
  }

  if (role !== 'admin' && booking.mentor_id !== userId) {
    return {
      success: false,
      error: { message: 'Unauthorized. Only the assigned mentor or an admin can manage this workspace.' },
    };
  }

  const nowIso = new Date().toISOString();
  const status: WorkspaceStatus = payload.publish ? 'PUBLISHED' : 'PENDING';
  const publishedAt = payload.publish ? nowIso : null;

  // 1. Try real Supabase upsert if configured
  if (isSupabaseConfigured()) {
    try {
      const upsertRecord = {
        booking_id: payload.booking_id,
        mentor_id: payload.mentor_id,
        seeker_id: booking.seeker_id,
        status,
        mentor_notes: payload.mentor_notes,
        summary: payload.mentor_notes,
        takeaways: payload.takeaways,
        suggestions: payload.suggestions,
        next_steps: payload.next_steps,
        follow_up_recommendation: payload.follow_up_recommendation || null,
        published_at: publishedAt,
        updated_at: nowIso,
      };

      const { data, error } = await supabase
        .from('session_workspaces')
        .upsert(upsertRecord, { onConflict: 'booking_id' })
        .select()
        .single();

      if (error) {
        console.warn('Supabase upsert warning, syncing with local server:', error.message);
      } else if (data) {
        // Also dispatch in-app notification if published
        if (payload.publish) {
          await supabase.from('notifications').insert({
            user_id: booking.seeker_id,
            title: 'Session Workspace Ready',
            message: `Your mentor has published takeaways and recommendations for session ${booking.booking_code}.`,
            type: 'WORKSPACE',
            link: `/seeker/workspace?bookingId=${booking.id}`,
            is_read: false,
          });
        }
      }
    } catch (err: any) {
      console.warn('Supabase error during workspace save:', err.message);
    }
  }

  // 2. Call backend endpoint to keep server authoritative
  try {
    const res = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        userId,
        role,
      }),
    });

    if (res.ok) {
      const json = await res.json();
      if (json.success && json.workspace) {
        return { success: true, workspace: json.workspace };
      }
    }
  } catch (err) {
    // Continue to local sync
  }

  // 3. In-memory update (DEV ONLY)
  if (!isDevMode) {
    return {
      success: false,
      error: { message: 'Workspace service is unavailable without a backend connection.' },
    };
  }

  const db = getLocalBookingEngineContext();
  let existingIndex = localWorkspaces.findIndex((w) => w.booking_id === payload.booking_id);
  const overview = deriveSessionOverview(booking);

  const updatedRecord: SessionWorkspace = {
    id: existingIndex >= 0 ? localWorkspaces[existingIndex].id : `ws-${Date.now()}`,
    booking_id: payload.booking_id,
    mentor_id: payload.mentor_id,
    seeker_id: booking.seeker_id,
    status,
    mentor_notes: payload.mentor_notes,
    summary: payload.mentor_notes,
    takeaways: payload.takeaways,
    suggestions: payload.suggestions,
    next_steps: payload.next_steps,
    action_items: payload.next_steps.map((ns) => ({
      id: ns.id,
      text: ns.text,
      completed: !!ns.completed,
    })),
    follow_up_recommendation: payload.follow_up_recommendation || null,
    resources: existingIndex >= 0 ? localWorkspaces[existingIndex].resources : [],
    published_at: publishedAt || (existingIndex >= 0 ? localWorkspaces[existingIndex].published_at : null),
    created_at: existingIndex >= 0 ? localWorkspaces[existingIndex].created_at : nowIso,
    updated_at: nowIso,
    session_overview: overview,
  };

  if (existingIndex >= 0) {
    localWorkspaces[existingIndex] = updatedRecord;
  } else {
    localWorkspaces.push(updatedRecord);
  }

  // Add notification to local db if published
  if (payload.publish && db.notifications) {
    db.notifications.unshift({
      id: `notif-ws-${Date.now()}`,
      user_id: booking.seeker_id,
      title: 'Session Workspace Ready',
      message: `Your mentor has published takeaways and recommendations for session ${booking.booking_code}.`,
      type: 'WORKSPACE',
      link: `/seeker/workspace?bookingId=${booking.id}`,
      is_read: false,
      created_at: nowIso,
    });
  }

  return { success: true, workspace: updatedRecord };
}

/**
 * Fetch all workspaces for Admin operational view.
 */
export async function fetchAdminWorkspacesAuthoritative(): Promise<SessionWorkspace[]> {
  // Try real Supabase query if configured
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('session_workspaces')
        .select('*')
        .order('updated_at', { ascending: false });

      if (!error && data && data.length > 0) {
        return data.map((d: any) => {
          return {
            id: d.id,
            booking_id: d.booking_id,
            mentor_id: d.mentor_id,
            seeker_id: d.seeker_id,
            status: d.status as WorkspaceStatus,
            mentor_notes: d.mentor_notes || d.summary || '',
            summary: d.summary || d.mentor_notes || '',
            takeaways: Array.isArray(d.takeaways) ? d.takeaways : [],
            suggestions: Array.isArray(d.suggestions) ? d.suggestions : [],
            next_steps: Array.isArray(d.next_steps) ? d.next_steps : [],
            action_items: Array.isArray(d.action_items) ? d.action_items : [],
            follow_up_recommendation: d.follow_up_recommendation || null,
            resources: Array.isArray(d.resources) ? d.resources : [],
            published_at: d.published_at || null,
            created_at: d.created_at,
            updated_at: d.updated_at,
            session_overview: undefined,
          };
        });
      }
    } catch (err: any) {
      console.warn('Supabase fetchAdminWorkspaces warning:', err.message);
    }
  }

  // Fallback to local (DEV ONLY)
  if (!isDevMode) {
    return [];
  }

  const db = getLocalBookingEngineContext();
  return localWorkspaces.map((ws) => {
    const booking = db.bookings.find((b) => b.id === ws.booking_id);
    return {
      ...ws,
      session_overview: booking ? deriveSessionOverview(booking) : undefined,
    };
  });
}
