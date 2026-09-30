import { apiFetch } from './apiClient';
import { supabase, isSupabaseConfigured } from './supabase';
import { getLocalBookingEngineContext } from './bookingService';
import {
  SessionWorkspace,
  WorkspaceStatus,
  FollowUpRecommendation,
  NextStepItem,
  SessionOverviewData,
  Booking,
} from '@/src/types/database';
import {
  evaluateBookingOfferIdentity,
  workspaceBelongsToBooking,
} from './workspaceIdentity';

const isDevMode = process.env.NODE_ENV !== 'production';

// Dev-only in-memory workspace storage (only used when Supabase is not configured and in dev mode)
let localWorkspaces: SessionWorkspace[] = [];

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

export type WorkspaceReadFailure =
  /** The row found for this booking belongs to a different pair of participants. */
  | 'WORKSPACE_PARTICIPANT_MISMATCH'
  /** The booking's gig and segment disagree, so the screen cannot be trusted. */
  | 'BOOKING_OFFER_MISMATCH';

/**
 * Fetches authoritative session workspace for a given booking ID.
 * Respects RLS and privacy rules:
 * - Seeker: only permitted if published or completed.
 * - Mentor: permitted for own bookings.
 * - Admin: operational access to all.
 *
 * Two failures are reported rather than folded into `isPending`, because
 * "not published yet" is a claim about this session's document and both of these
 * mean the screen is describing something other than this session:
 *
 *   - a row whose `seeker_id`/`mentor_id` are not the booking's participants.
 *     RLS reads those columns, so such a row is hidden from the rightful seeker
 *     and shown to the wrong one, while the mentor still sees PUBLISHED;
 *   - a booking whose `segment_id` and `gig_id` describe two different offers,
 *     which renders the same gig under two segment names across bookings.
 *
 * Returning `isPending` for either would reproduce the reported symptom pair
 * exactly, so both surface as an error the UI can state plainly.
 */
export async function fetchWorkspaceByBooking(
  bookingId: string,
  userId?: string,
  role?: string
): Promise<{
  workspace: SessionWorkspace | null;
  error: Error | null;
  isPending?: boolean;
  failure?: WorkspaceReadFailure;
}> {
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

        // The row must be the row FOR this booking. `booking_id` is unique and
        // is the filter above, so this is belt-and-braces against a filter that
        // is ever widened by a future edit.
        if (record.booking_id !== bookingId) {
          return {
            workspace: null,
            error: null,
            failure: 'WORKSPACE_PARTICIPANT_MISMATCH',
          };
        }

        // ...and its participants must be this booking's participants. RLS reads
        // these two columns, not `bookings`, so this is the only place the
        // browser can notice that the two disagree.
        if (booking && !workspaceBelongsToBooking(record, booking)) {
          return {
            workspace: null,
            error: null,
            failure: 'WORKSPACE_PARTICIPANT_MISMATCH',
          };
        }

        // A booking whose gig and segment disagree cannot be presented as one
        // coherent session, whatever the workspace says.
        if (booking) {
          const offer = evaluateBookingOfferIdentity(booking);
          if (!offer.unverified && !(offer.segmentConsistent && offer.mentorConsistent)) {
            return { workspace: null, error: null, failure: 'BOOKING_OFFER_MISMATCH' };
          }
        }

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
        if (json.workspace && json.workspace.booking_id !== bookingId) {
          return { workspace: null, error: null, failure: 'WORKSPACE_PARTICIPANT_MISMATCH' };
        }
        return { workspace: json.workspace, error: null };
      }
    }
  } catch (err) {
    // Continue to local in-memory fallback
  }

  // 3. Fallback to local in-memory engine (DEV ONLY)
  if (!isDevMode) {
    return { workspace: null, error: new Error('Workspace service is unavailable without a backend connection.'), isPending: false };
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

  // Same participant check as the live paths: the dev store must not be able to
  // hand back a row belonging to a different session.
  if (!workspaceBelongsToBooking(ws, booking)) {
    return { workspace: null, error: null, failure: 'WORKSPACE_PARTICIPANT_MISMATCH' };
  }

  const devOffer = evaluateBookingOfferIdentity(booking);
  if (!devOffer.unverified && !(devOffer.segmentConsistent && devOffer.mentorConsistent)) {
    return { workspace: null, error: null, failure: 'BOOKING_OFFER_MISMATCH' };
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

function toApiWorkspacePayload(payload: SaveWorkspacePayload) {
  return {
    bookingId: payload.booking_id,
    mentorId: payload.mentor_id,
    mentorNotes: payload.mentor_notes,
    takeaways: payload.takeaways,
    suggestions: payload.suggestions,
    nextSteps: payload.next_steps,
    followUpRecommendation: payload.follow_up_recommendation ?? null,
    publish: payload.publish ?? false,
  };
}

/**
 * Mentor or Admin creates, edits, and saves a session workspace.
 * Uses the authoritative server API endpoint to ensure consistency.
 */
export async function saveWorkspaceAuthoritative(
  payload: SaveWorkspacePayload,
  userId: string,
  role: string
): Promise<{ success: boolean; workspace?: SessionWorkspace; error?: { message: string } }> {
  // Call backend endpoint - server is the single source of truth
  try {
    const res = await apiFetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toApiWorkspacePayload(payload)),
    });

    if (res.ok) {
      const json = await res.json();
      if (json.success && json.workspace) {
        return { success: true, workspace: json.workspace };
      }
      return { success: false, error: { message: json.error?.message || 'Failed to save workspace.' } };
    }

    // Handle non-OK responses
    let errorMessage = 'Failed to save workspace.';
    try {
      const json = await res.json();
      errorMessage = json.error?.message || errorMessage;
    } catch {
      // Use default error message
    }
    return { success: false, error: { message: errorMessage } };
  } catch (err: any) {
    // Network or unexpected error
    if (!isDevMode) {
      return {
        success: false,
        error: { message: 'Workspace service is unavailable without a backend connection.' },
      };
    }

    // Dev-only fallback to local in-memory engine
    let booking: Booking | null = null;
    const db = getLocalBookingEngineContext();
    booking = db.bookings.find((b) => b.id === payload.booking_id) || null;

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
        .select(`
          *,
          booking:bookings (
            id,
            booking_code,
            status,
            start_time,
            end_time,
            amount_inr,
            seeker_id,
            mentor_id,
            gig_id,
            segment_id,
            seeker:profiles!bookings_seeker_id_fkey(id, full_name, email, timezone),
            mentor:profiles!bookings_mentor_id_fkey(id, full_name, email, timezone),
            gig:gigs(id, title, segment_id),
            segment:segments(id, name, slug)
          )
        `)
        .order('updated_at', { ascending: false });

      if (!error && data && data.length > 0) {
        return data.map((d: any) => {
          const booking = d.booking;
          const overview = booking ? deriveSessionOverview(booking as unknown as Booking) : undefined;
          
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
            session_overview: overview,
          };
        });
      }
    } catch (err: any) {
      console.warn('Supabase fetchAdminWorkspaces warning:', err.message);
    }
  }

  // Fallback - production must use real Supabase data
  if (!isDevMode) {
    return [];
  }

  // Dev-only fallback using local in-memory data
  const db = getLocalBookingEngineContext();
  
  return localWorkspaces.map((ws: SessionWorkspace) => {
    const booking = db.bookings.find((b) => b.id === ws.booking_id);
    return {
      ...ws,
      session_overview: booking ? deriveSessionOverview(booking) : undefined,
    };
  });
}
