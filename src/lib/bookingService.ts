import { apiFetch } from './apiClient';
import { isSupabaseConfigured } from './supabase';
import { Booking, SlotHold, Payment, Notification } from '@/src/types/database';
import { supabase } from './supabase';
import {
  executeAtomicBookingWithHold,
  BookingEngineContext,
  confirmSessionByMentor,
  calculateMeetingLinkDeadline,
  validateMeetingUrl,
  getOverdueBookings,
  ConfirmSessionResult,
  validateSessionAccess,
  joinSessionAuthoritative,
  SessionAccessResult,
  SessionAccessState,
  AuthoritativeJoinResult,
} from './bookingEngine';

export type { SessionAccessResult, SessionAccessState, AuthoritativeJoinResult };
export { validateSessionAccess, joinSessionAuthoritative };

const isDevMode = process.env.NODE_ENV !== 'production';

export interface CreateBookingRequest {
  seekerId: string;
  mentorId: string;
  segmentId: string;
  gigId: string;
  startTime: string; // UTC ISO
  endTime: string; // UTC ISO
}

export interface CreateBookingResponse {
  success: boolean;
  booking?: Booking;
  hold?: SlotHold;
  expires_at?: string;
  booking_code?: string;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Initiates the atomic booking & hold transaction.
 * First attempts to call the server `/api/bookings/hold` or Supabase RPC `create_booking_with_hold`.
 * If running in local standalone mode, executes the atomic booking engine with persisted state.
 */
export async function createBookingWithHold(
  request: CreateBookingRequest
): Promise<CreateBookingResponse> {
  // 1. Try server-side Express endpoint if available
  try {
    const res = await apiFetch('/api/bookings/hold', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (res.ok) {
      const data = await res.json();
      return data;
    }

    if (res.status === 409 || res.status === 400 || res.status === 403) {
      const errData = await res.json();
      return {
        success: false,
        error: errData.error || { code: 'BOOKING_FAILED', message: errData.message || 'Booking failed' },
      };
    }
  } catch (httpErr) {
    // Backend API route not responding; proceed to Supabase RPC
  }

  // 2. Try Supabase RPC `create_booking_with_hold`
  if (supabase) {
    try {
      const { data, error } = await (supabase as any).rpc('create_booking_with_hold', {
        p_seeker_id: request.seekerId,
        p_mentor_id: request.mentorId,
        p_segment_id: request.segmentId,
        p_gig_id: request.gigId,
        p_start_time: request.startTime,
        p_end_time: request.endTime,
      });

      if (!error && data) {
        return data as CreateBookingResponse;
      }
      if (error) {
        return {
          success: false,
          error: {
            code: 'DATABASE_ERROR',
            message: error.message,
          },
        };
      }
    } catch (rpcErr: any) {
      // Proceed to local fallback
    }
  }

  // 3. Deterministic Local State Engine Fallback (for preview/testing only)
  if (!isDevMode) {
    return {
      success: false,
      error: {
        code: 'NO_BACKEND',
        message: 'Booking service is unavailable in production without a backend connection.',
      },
    };
  }
  const seedDb: BookingEngineContext = getLocalBookingEngineContext();
  return executeAtomicBookingWithHold(request, seedDb);
}

// In-memory persistent database representation for local development
let localBookingDb: BookingEngineContext | null = null;

export function getLocalBookingEngineContext(): BookingEngineContext {
  if (!localBookingDb) {
    localBookingDb = {
      profiles: [
        {
          id: 'usr-8801',
          email: 'suggestkey1505@gmail.com',
          full_name: 'Aman Kumar',
          timezone: 'Asia/Kolkata',
          avatar_url: null,
          created_at: '2026-01-10T00:00:00Z',
          updated_at: '2026-01-10T00:00:00Z',
        },
        {
          id: 'usr-seeker-demo',
          email: 'seeker@suggestkey.com',
          full_name: 'Aditi Rao',
          timezone: 'Asia/Kolkata',
          avatar_url: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
        {
          id: 'usr-mentor-rahul',
          email: 'mentor.rahul@suggestkey.com',
          full_name: 'Rahul Sharma',
          timezone: 'Asia/Kolkata',
          avatar_url: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
        {
          id: 'usr-8802',
          email: 'mentor.rahul@suggestkey.com',
          full_name: 'Rahul Sharma',
          timezone: 'Asia/Kolkata',
          avatar_url: null,
          created_at: '2026-01-12T00:00:00Z',
          updated_at: '2026-01-12T00:00:00Z',
        },
        {
          id: 'usr-mentor-ananya',
          email: 'mentor.ananya@suggestkey.com',
          full_name: 'Ananya Patel',
          timezone: 'Asia/Kolkata',
          avatar_url: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
        {
          id: 'usr-mentor-vikram',
          email: 'mentor.vikram@suggestkey.com',
          full_name: 'Dr. Vikram Joshi',
          timezone: 'Asia/Kolkata',
          avatar_url: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ],
      userRoles: [
        { user_id: 'usr-8801', role: 'seeker' },
        { user_id: 'usr-seeker-demo', role: 'seeker' },
        { user_id: 'usr-mentor-rahul', role: 'mentor' },
        { user_id: 'usr-8802', role: 'mentor' },
        { user_id: 'usr-mentor-ananya', role: 'mentor' },
        { user_id: 'usr-mentor-vikram', role: 'mentor' },
      ],
      mentorProfiles: [
        {
          id: 'usr-mentor-rahul',
          headline: 'Relationship Counselor & Interpersonal Strategist',
          about: 'Experienced counselor in emotional intelligence and conflict resolution.',
          experience_years: 6,
          languages: ['English', 'Hindi'],
          rating: 4.95,
          review_count: 38,
          session_count: 142,
          is_approved: true,
          is_featured: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
        {
          id: 'usr-8802',
          headline: 'Relationship Counselor & Interpersonal Strategist',
          about: 'Experienced counselor in emotional intelligence and conflict resolution.',
          experience_years: 6,
          languages: ['English', 'Hindi'],
          rating: 4.95,
          review_count: 38,
          session_count: 142,
          is_approved: true,
          is_featured: true,
          created_at: '2026-01-12T00:00:00Z',
          updated_at: '2026-01-12T00:00:00Z',
        },
        {
          id: 'usr-mentor-ananya',
          headline: 'Certified Family Systems & Dialogue Practitioner',
          about: 'Specialist in partner dialogue and pre-marital relational health.',
          experience_years: 8,
          languages: ['English', 'Hindi', 'Gujarati'],
          rating: 4.98,
          review_count: 52,
          session_count: 210,
          is_approved: true,
          is_featured: false,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
        {
          id: 'usr-mentor-vikram',
          headline: 'Neurodiversity Specialist & Autism Guidance Mentor',
          about: 'Guiding autistic individuals, parents, and caregivers.',
          experience_years: 10,
          languages: ['English', 'Hindi', 'Marathi'],
          rating: 5.0,
          review_count: 64,
          session_count: 320,
          is_approved: true,
          is_featured: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ],
      segments: [
        {
          id: 'seg-rel-01',
          name: 'Relationship Advisor',
          slug: 'relationship-advisor',
          description: 'Expert guidance on interpersonal relationships.',
          priority: 1,
          is_active: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
        {
          id: 'seg-aut-02',
          name: 'Autism Mentor',
          slug: 'autism-mentor',
          description: 'Specialized neurodivergent support.',
          priority: 2,
          is_active: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
        {
          id: 'seg-car-03',
          name: 'Career Mentor',
          slug: 'career-mentor',
          description: 'Career development and leadership communication.',
          priority: 3,
          is_active: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ],
      mentorSegments: [
        { mentor_id: 'usr-mentor-rahul', segment_id: 'seg-rel-01' },
        { mentor_id: 'usr-mentor-rahul', segment_id: 'seg-car-03' },
        { mentor_id: 'usr-8802', segment_id: 'seg-rel-01' },
        { mentor_id: 'usr-8802', segment_id: 'seg-car-03' },
        { mentor_id: 'usr-mentor-ananya', segment_id: 'seg-rel-01' },
        { mentor_id: 'usr-mentor-vikram', segment_id: 'seg-aut-02' },
      ],
      gigs: [
        {
          id: 'gig-rel-rahul',
          mentor_id: 'usr-mentor-rahul',
          segment_id: 'seg-rel-01',
          title: '1:1 Relationship Guidance Session',
          description: 'In-depth consultation on interpersonal boundaries and dialogue.',
          duration_minutes: 60,
          price_inr: 999,
          is_active: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
        {
          id: 'gig-car-rahul',
          mentor_id: 'usr-mentor-rahul',
          segment_id: 'seg-car-03',
          title: 'Career Communication Coaching',
          description: 'Master interpersonal influence and professional boundary management.',
          duration_minutes: 45,
          price_inr: 1299,
          is_active: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
        {
          id: 'gig-rel-ananya',
          mentor_id: 'usr-mentor-ananya',
          segment_id: 'seg-rel-01',
          title: 'Deep Communication Reset & Dialogue Coaching',
          description: 'Dialogue session to unpack relationship dynamics.',
          duration_minutes: 45,
          price_inr: 1200,
          is_active: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
        {
          id: 'gig-aut-vikram',
          mentor_id: 'usr-mentor-vikram',
          segment_id: 'seg-aut-02',
          title: 'Autism Navigational & Sensory Mentorship',
          description: 'Structured 1:1 strategy session covering sensory regulation.',
          duration_minutes: 60,
          price_inr: 1500,
          is_active: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ],
      mentorAvailability: [
        // Rahul: Mon-Sat 10:00 - 18:00
        ...[1, 2, 3, 4, 5, 6].map((dow) => ({
          id: `avail-rahul-${dow}`,
          mentor_id: 'usr-mentor-rahul',
          day_of_week: dow,
          start_time: '10:00:00',
          end_time: '18:00:00',
          timezone: 'Asia/Kolkata',
          is_enabled: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        })),
        // Ananya: Mon-Sat 11:00 - 19:00
        ...[1, 2, 3, 4, 5, 6].map((dow) => ({
          id: `avail-ananya-${dow}`,
          mentor_id: 'usr-mentor-ananya',
          day_of_week: dow,
          start_time: '11:00:00',
          end_time: '19:00:00',
          timezone: 'Asia/Kolkata',
          is_enabled: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        })),
        // Dr Vikram: Mon-Fri 09:00 - 17:00
        ...[1, 2, 3, 4, 5].map((dow) => ({
          id: `avail-vikram-${dow}`,
          mentor_id: 'usr-mentor-vikram',
          day_of_week: dow,
          start_time: '09:00:00',
          end_time: '17:00:00',
          timezone: 'Asia/Kolkata',
          is_enabled: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        })),
      ],
      mentorAvailabilityExceptions: [],
      bookings: [
        {
          id: 'bk-9021',
          booking_code: 'BK-9021',
          mentor_id: 'usr-8802',
          seeker_id: 'usr-8801',
          gig_id: 'gig-rel-rahul',
          segment_id: 'seg-rel-01',
          hold_id: 'hold-9021',
          start_time: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
          end_time: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
          seeker_timezone: 'Asia/Kolkata',
          mentor_timezone: 'Asia/Kolkata',
          amount_inr: 999,
          status: 'MENTOR_PENDING',
          meeting_url: null,
          cancellation_reason: null,
          created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          updated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        },
        {
          id: 'bk-9022',
          booking_code: 'BK-9022',
          mentor_id: 'usr-8802',
          seeker_id: 'usr-seeker-demo',
          gig_id: 'gig-car-rahul',
          segment_id: 'seg-car-03',
          hold_id: 'hold-9022',
          start_time: new Date(Date.now() + 75 * 60 * 1000).toISOString(), // 75 mins: Overdue (<2h)!
          end_time: new Date(Date.now() + 120 * 60 * 1000).toISOString(),
          seeker_timezone: 'Asia/Kolkata',
          mentor_timezone: 'Asia/Kolkata',
          amount_inr: 1299,
          status: 'MENTOR_PENDING',
          meeting_url: null,
          cancellation_reason: null,
          created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
          updated_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
        },
        {
          id: 'bk-9020',
          booking_code: 'BK-9020',
          mentor_id: 'usr-8802',
          seeker_id: 'usr-8801',
          gig_id: 'gig-rel-rahul',
          segment_id: 'seg-rel-01',
          hold_id: 'hold-9020',
          start_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          end_time: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(),
          seeker_timezone: 'Asia/Kolkata',
          mentor_timezone: 'Asia/Kolkata',
          amount_inr: 999,
          status: 'CONFIRMED',
          meeting_url: 'https://meet.google.com/hrc-qjtv-zsk',
          cancellation_reason: null,
          created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          updated_at: new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString(),
        },
        // Phase 9 Test Booking 1: In T-5 early arrival window (starts in 3 minutes)
        {
          id: 'bk-session-soon',
          booking_code: 'BK-SOON-01',
          mentor_id: 'usr-8802',
          seeker_id: 'usr-8801',
          gig_id: 'gig-rel-rahul',
          segment_id: 'seg-rel-01',
          hold_id: null,
          start_time: new Date(Date.now() + 3 * 60 * 1000).toISOString(), // 3 mins from now
          end_time: new Date(Date.now() + 63 * 60 * 1000).toISOString(),
          seeker_timezone: 'Asia/Kolkata',
          mentor_timezone: 'Asia/Kolkata',
          amount_inr: 999,
          status: 'CONFIRMED',
          meeting_url: 'https://meet.google.com/early-access-room',
          cancellation_reason: null,
          created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          updated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        },
        // Phase 9 Test Booking 2: Active in-progress session (started 12 minutes ago)
        {
          id: 'bk-session-live',
          booking_code: 'BK-LIVE-02',
          mentor_id: 'usr-8802',
          seeker_id: 'usr-8801',
          gig_id: 'gig-rel-rahul',
          segment_id: 'seg-rel-01',
          hold_id: null,
          start_time: new Date(Date.now() - 12 * 60 * 1000).toISOString(), // 12 mins in
          end_time: new Date(Date.now() + 48 * 60 * 1000).toISOString(),
          seeker_timezone: 'Asia/Kolkata',
          mentor_timezone: 'Asia/Kolkata',
          amount_inr: 999,
          status: 'CONFIRMED',
          meeting_url: 'https://meet.google.com/live-session-room',
          cancellation_reason: null,
          created_at: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
          updated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        },
        // Phase 9 Test Booking 3: Completed / ended session (ended 20 minutes ago)
        {
          id: 'bk-session-ended',
          booking_code: 'BK-ENDED-03',
          mentor_id: 'usr-8802',
          seeker_id: 'usr-8801',
          gig_id: 'gig-rel-rahul',
          segment_id: 'seg-rel-01',
          hold_id: null,
          start_time: new Date(Date.now() - 80 * 60 * 1000).toISOString(),
          end_time: new Date(Date.now() - 20 * 60 * 1000).toISOString(), // Ended 20 mins ago
          seeker_timezone: 'Asia/Kolkata',
          mentor_timezone: 'Asia/Kolkata',
          amount_inr: 999,
          status: 'COMPLETED',
          meeting_url: 'https://meet.google.com/past-session-room',
          cancellation_reason: null,
          created_at: new Date(Date.now() - 180 * 60 * 1000).toISOString(),
          updated_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
        },
      ],
      slotHolds: [],
      payments: [
        {
          id: 'pay-9021',
          booking_id: 'bk-9021',
          seeker_id: 'usr-8801',
          amount_inr: 999,
          status: 'VERIFIED',
          proof_storage_path: 'receipts/upi_9021.png',
          transaction_reference: 'UPI-REF-90214481',
          verified_by: 'usr-8800',
          verified_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
          rejection_reason: null,
          created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          updated_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        },
        {
          id: 'pay-9022',
          booking_id: 'bk-9022',
          seeker_id: 'usr-seeker-demo',
          amount_inr: 1299,
          status: 'VERIFIED',
          proof_storage_path: 'receipts/gpay_9022.png',
          transaction_reference: 'GPAY-TXN-9022981',
          verified_by: 'usr-8800',
          verified_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
          rejection_reason: null,
          created_at: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
          updated_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
        },
        {
          id: 'pay-9020',
          booking_id: 'bk-9020',
          seeker_id: 'usr-8801',
          amount_inr: 999,
          status: 'VERIFIED',
          proof_storage_path: 'receipts/upi_9020.png',
          transaction_reference: 'UPI-REF-9020112',
          verified_by: 'usr-8800',
          verified_at: new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString(),
          rejection_reason: null,
          created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          updated_at: new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString(),
        },
      ],
      notifications: [
        // --- SEEKER SEEDS (usr-8801) ---
        {
          id: 'notif-seeker-1',
          user_id: 'usr-8801',
          title: 'Booking Created',
          message: 'Consultation slot reserved for BK-9021 with Rahul Sharma. Please upload UPI payment proof.',
          type: 'BOOKING',
          event_type: 'BOOKING_CREATED',
          entity_type: 'booking',
          entity_id: 'bk-9021',
          link: '/seeker/bookings?bookingId=bk-9021',
          is_read: true,
          created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: 'notif-seeker-2',
          user_id: 'usr-8801',
          title: 'Payment Submitted',
          message: 'Your payment screenshot for BK-9021 (₹999) has been submitted for admin verification.',
          type: 'PAYMENT',
          event_type: 'PAYMENT_SUBMITTED',
          entity_type: 'payment',
          entity_id: 'bk-9021',
          link: '/seeker/bookings?bookingId=bk-9021',
          is_read: true,
          created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: 'notif-seeker-3',
          user_id: 'usr-8801',
          title: 'Payment Approved',
          message: 'Your payment for BK-9020 has been verified by the admin team. Awaiting mentor confirmation.',
          type: 'PAYMENT',
          event_type: 'PAYMENT_APPROVED',
          entity_type: 'payment',
          entity_id: 'bk-9020',
          link: '/seeker/bookings?bookingId=bk-9020',
          is_read: true,
          created_at: new Date(Date.now() - 28 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: 'notif-seeker-4',
          user_id: 'usr-8801',
          title: 'Payment Verification Rejected',
          message: 'Payment proof for BK-9017 was rejected: UTR does not match banking ledger. Please re-upload.',
          type: 'PAYMENT',
          event_type: 'PAYMENT_REJECTED',
          entity_type: 'payment',
          entity_id: 'bk-9017',
          link: '/seeker/bookings?bookingId=bk-9017',
          is_read: true,
          created_at: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: 'notif-seeker-5',
          user_id: 'usr-8801',
          title: 'Mentor Confirmed Session',
          message: 'Rahul Sharma has confirmed your consultation BK-9020.',
          type: 'BOOKING',
          event_type: 'MENTOR_CONFIRMED',
          entity_type: 'booking',
          entity_id: 'bk-9020',
          link: '/seeker/bookings?bookingId=bk-9020',
          is_read: false,
          created_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: 'notif-seeker-6',
          user_id: 'usr-8801',
          title: 'Meeting Link Available',
          message: 'Your Google Meet link for BK-SESSION-SOON is ready. You may enter the session room.',
          type: 'SESSION',
          event_type: 'MEETING_LINK_AVAILABLE',
          entity_type: 'session',
          entity_id: 'bk-session-soon',
          link: '/seeker/session?bookingId=bk-session-soon',
          is_read: false,
          created_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
        },
        {
          id: 'notif-seeker-7',
          user_id: 'usr-8801',
          title: 'Session Reminder: 15m to Start',
          message: 'Your 1:1 consultation with Rahul Sharma begins in 15 minutes. Join access unlocks at T-5m.',
          type: 'SESSION',
          event_type: 'SESSION_REMINDER',
          entity_type: 'session',
          entity_id: 'bk-session-soon',
          link: '/seeker/session?bookingId=bk-session-soon',
          is_read: false,
          created_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
        },
        {
          id: 'notif-seeker-8',
          user_id: 'usr-8801',
          title: 'Consultation Cancelled',
          message: 'Booking BK-9019 was cancelled upon request. A credit record has been logged.',
          type: 'BOOKING',
          event_type: 'CANCELLATION',
          entity_type: 'booking',
          entity_id: 'bk-9019',
          link: '/seeker/bookings?bookingId=bk-9019',
          is_read: true,
          created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: 'notif-seeker-9',
          user_id: 'usr-8801',
          title: 'Session Rescheduled',
          message: 'Booking BK-9018 was updated to match your newly requested time slot.',
          type: 'BOOKING',
          event_type: 'RESCHEDULING',
          entity_type: 'booking',
          entity_id: 'bk-9018',
          link: '/seeker/bookings?bookingId=bk-9018',
          is_read: true,
          created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: 'notif-seeker-10',
          user_id: 'usr-8801',
          title: 'Session Completed',
          message: 'Your consultation BK-SESSION-ENDED is complete. The mentor is preparing post-session takeaways.',
          type: 'SESSION',
          event_type: 'SESSION_COMPLETED',
          entity_type: 'session',
          entity_id: 'bk-session-ended',
          link: '/seeker/workspace?bookingId=bk-session-ended',
          is_read: false,
          created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: 'notif-seeker-11',
          user_id: 'usr-8801',
          title: 'Workspace Notes Published',
          message: 'Rahul Sharma published takeaways, suggestions, and next steps for BK-SESSION-ENDED.',
          type: 'WORKSPACE',
          event_type: 'WORKSPACE_UPDATED',
          entity_type: 'workspace',
          entity_id: 'bk-session-ended',
          link: '/seeker/workspace?bookingId=bk-session-ended',
          is_read: false,
          created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        },

        // --- MENTOR SEEDS (usr-8802) ---
        {
          id: 'notif-mentor-1',
          user_id: 'usr-8802',
          title: 'Seeker Payment Verified',
          message: 'Payment verified for session BK-9021. Please add your HTTPS meeting link.',
          type: 'PAYMENT',
          event_type: 'PAYMENT_APPROVED',
          entity_type: 'booking',
          entity_id: 'bk-9021',
          link: '/mentor/booking-detail?bookingId=bk-9021',
          is_read: false,
          created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: 'notif-mentor-2',
          user_id: 'usr-8802',
          title: 'New Booking Request',
          message: 'Aman Kumar booked a 60-minute Relationship Guidance session (BK-9025).',
          type: 'BOOKING',
          event_type: 'NEW_BOOKING',
          entity_type: 'booking',
          entity_id: 'bk-9025',
          link: '/mentor/bookings',
          is_read: true,
          created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: 'notif-mentor-3',
          user_id: 'usr-8802',
          title: 'Action Required: Add Meeting Link',
          message: 'Session BK-9021 starts today. Policy mandates providing meeting URL at least 2 hours before start.',
          type: 'SESSION',
          event_type: 'MEETING_LINK_DEADLINE',
          entity_type: 'booking',
          entity_id: 'bk-9021',
          link: '/mentor/booking-detail?bookingId=bk-9021',
          is_read: false,
          created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: 'notif-mentor-4',
          user_id: 'usr-8802',
          title: 'Urgent: Meeting Link Overdue (<2h)',
          message: 'Session BK-9022 starts in 75 minutes. Please provide meeting link immediately.',
          type: 'SESSION',
          event_type: 'OVERDUE_MEETING_LINK',
          entity_type: 'booking',
          entity_id: 'bk-9022',
          link: '/mentor/booking-detail?bookingId=bk-9022',
          is_read: false,
          created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        },
        {
          id: 'notif-mentor-5',
          user_id: 'usr-8802',
          title: 'Upcoming Consultation Reminder',
          message: 'Session BK-SESSION-SOON starts in 15 minutes. Authoritative session join unlocks at T-5m.',
          type: 'SESSION',
          event_type: 'MENTOR_SESSION_REMINDER',
          entity_type: 'session',
          entity_id: 'bk-session-soon',
          link: '/mentor/booking-detail?bookingId=bk-session-soon',
          is_read: false,
          created_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
        },
        {
          id: 'notif-mentor-6',
          user_id: 'usr-8802',
          title: 'Consultation Cancelled',
          message: 'Seeker cancelled booking BK-9019. Calendar slot has been reopened for bookings.',
          type: 'BOOKING',
          event_type: 'MENTOR_CANCELLATION',
          entity_type: 'booking',
          entity_id: 'bk-9019',
          link: '/mentor/bookings',
          is_read: true,
          created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: 'notif-mentor-7',
          user_id: 'usr-8802',
          title: 'Consultation Rescheduled',
          message: 'Booking BK-9018 was rescheduled according to updated calendar availability.',
          type: 'BOOKING',
          event_type: 'MENTOR_RESCHEDULING',
          entity_type: 'booking',
          entity_id: 'bk-9018',
          link: '/mentor/bookings',
          is_read: true,
          created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: 'notif-mentor-8',
          user_id: 'usr-8802',
          title: 'Session Concluded: Workspace Draft Ready',
          message: 'Consultation BK-SESSION-ENDED completed. Please draft takeaways, suggestions, and next steps.',
          type: 'WORKSPACE',
          event_type: 'SESSION_COMPLETION',
          entity_type: 'workspace',
          entity_id: 'bk-session-ended',
          link: '/mentor/workspace?bookingId=bk-session-ended',
          is_read: false,
          created_at: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
        },

        // --- ADMIN SEEDS (usr-8800) ---
        {
          id: 'notif-admin-1',
          user_id: 'usr-8800',
          title: 'Payment Verification Required',
          message: 'New manual UPI receipt uploaded for BK-9021 (₹999) by Aman Kumar. Awaiting ledger verification.',
          type: 'PAYMENT',
          event_type: 'ADMIN_PAYMENT_PROOF_SUBMITTED',
          entity_type: 'payment',
          entity_id: 'bk-9021',
          link: '/admin/payments',
          is_read: false,
          created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: 'notif-admin-2',
          user_id: 'usr-8800',
          title: 'SLA Breach: Overdue Mentor Link',
          message: 'Mentor Rahul Sharma has not provided meeting URL for BK-9022 starting in 75 minutes.',
          type: 'SESSION',
          event_type: 'ADMIN_OVERDUE_MENTOR_LINK',
          entity_type: 'booking',
          entity_id: 'bk-9022',
          link: '/admin/bookings',
          is_read: false,
          created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        },
        {
          id: 'notif-admin-3',
          user_id: 'usr-8800',
          title: 'Mentor Cancellation Logged',
          message: 'Mentor Dr. Vikram Joshi submitted an emergency cancellation for consultation BK-9016.',
          type: 'BOOKING',
          event_type: 'ADMIN_MENTOR_CANCELLATION',
          entity_type: 'booking',
          entity_id: 'bk-9016',
          link: '/admin/bookings',
          is_read: true,
          created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: 'notif-admin-4',
          user_id: 'usr-8800',
          title: 'Booking Intervention Required',
          message: 'High Priority: Session BK-9022 is at T-45m with missing meeting link. Administrative outreach advised.',
          type: 'BOOKING',
          event_type: 'ADMIN_BOOKING_INTERVENTION',
          entity_type: 'booking',
          entity_id: 'bk-9022',
          link: '/admin/bookings',
          is_read: false,
          created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        },
      ],

    };
  }
  return localBookingDb;
}

/**
 * Calculates remaining seconds on an active slot hold.
 */
export function calculateRemainingHoldSeconds(expiresAtIso: string): number {
  const expiresMs = new Date(expiresAtIso).getTime();
  const nowMs = Date.now();
  const diffSec = Math.floor((expiresMs - nowMs) / 1000);
  return Math.max(0, diffSec);
}

/**
 * Format remaining countdown seconds into MM:SS format.
 */
export function formatCountdown(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// ----------------------------------------------------------------------------
// PHASE 8: MENTOR CONFIRMATION CLIENT & SERVER HELPER FUNCTIONS
// ----------------------------------------------------------------------------

export interface EnrichedBookingRecord extends Booking {
  payment?: Payment;
  deadlineInfo?: {
    deadlineUtc: string;
    isOverdue: boolean;
    hoursUntilSession: number;
    minutesUntilSession: number;
  };
}

/**
 * Enriches a booking with joined seeker, payment, and deadline details.
 */
export function enrichBooking(booking: Booking, db: BookingEngineContext): EnrichedBookingRecord {
  const seeker = db.profiles.find((p) => p.id === booking.seeker_id);
  const gig = db.gigs.find((g) => g.id === booking.gig_id);
  const segment = db.segments.find((s) => s.id === booking.segment_id);
  const payment = db.payments?.find((pay) => pay.booking_id === booking.id);
  const deadlineInfo = calculateMeetingLinkDeadline(booking.start_time);

  return {
    ...booking,
    gig: gig || booking.gig,
    segment: segment || booking.segment,
    seeker: seeker || booking.seeker,
    payment,
    deadlineInfo,
  };
}

/**
 * Fetches mentor bookings with optional status filter.
 * Works both via HTTP endpoint or in-memory DB fallback.
 */
export async function fetchMentorBookings(
  mentorId: string,
  statusFilter?: string
): Promise<EnrichedBookingRecord[]> {
  if (!isDevMode) {
    try {
      const params = new URLSearchParams({ mentorId });
      if (statusFilter && statusFilter !== 'ALL') {
        params.append('status', statusFilter);
      }
      const res = await apiFetch(`/api/mentor/bookings?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.bookings) return data.bookings;
      }
    } catch {
      // API unreachable
    }
    return [];
  }

  try {
    const params = new URLSearchParams({ mentorId });
    if (statusFilter && statusFilter !== 'ALL') {
      params.append('status', statusFilter);
    }
    const res = await apiFetch(`/api/mentor/bookings?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      if (data.bookings) return data.bookings;
    }
  } catch {
    // Network or preview offline fallback
  }

  const db = getLocalBookingEngineContext();
  const mentorIds = [mentorId];

  let matched = db.bookings.filter((b) => mentorIds.includes(b.mentor_id));
  if (statusFilter && statusFilter !== 'ALL') {
    matched = matched.filter((b) => b.status === statusFilter);
  }

  // Sort by start_time ascending
  matched.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  return matched.map((b) => enrichBooking(b, db));
}

/**
 * Fetches bookings for a seeker, enriched with mentor, gig, and segment data.
 */
export async function fetchSeekerBookings(seekerId: string): Promise<EnrichedBookingRecord[]> {
  // Try server API first, then Supabase
  try {
    const res = await apiFetch(`/api/seeker/bookings?seekerId=${encodeURIComponent(seekerId)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.bookings) return data.bookings;
    }
  } catch {
    // API unreachable
  }

  if (!isDevMode) {
    return [];
  }

  const db = getLocalBookingEngineContext();
  const seekerIds = [seekerId];
  const matched = db.bookings.filter((b) => seekerIds.includes(b.seeker_id));
  matched.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
  return matched.map((b) => enrichBooking(b, db));
}

/**
 * Fetches details for a single booking.
 */
export async function fetchBookingDetail(
  bookingId: string,
  mentorId?: string
): Promise<EnrichedBookingRecord | null> {
  try {
    const url = mentorId
      ? `/api/mentor/bookings/${bookingId}?mentorId=${mentorId}`
      : `/api/seeker/bookings/${bookingId}`;
    const res = await apiFetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data.booking) return data.booking;
      if (data.bookings && data.bookings[0]) return data.bookings[0];
    }
  } catch {
    // API unreachable
  }

  if (!isDevMode) {
    return null;
  }

  const db = getLocalBookingEngineContext();
  const booking = db.bookings.find((b) => b.id === bookingId || b.booking_code === bookingId);
  if (!booking) return null;
  return enrichBooking(booking, db);
}

/**
 * Confirms a session with valid HTTPS meeting URL.
 * Strictly verifies mentor ownership, MENTOR_PENDING status, and HTTPS url.
 */
export async function confirmMentorBooking(
  bookingId: string,
  mentorId: string,
  meetingUrl: string
): Promise<ConfirmSessionResult> {
  try {
    const res = await apiFetch(`/api/mentor/bookings/${bookingId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mentorId, meetingUrl }),
    });

    const data = await res.json();
    if (res.ok && data.success) {
      if (isDevMode) {
        // Also sync to local DB in case client was using local state
        const db = getLocalBookingEngineContext();
        const localBooking = db.bookings.find((b) => b.id === bookingId);
        if (localBooking) {
          localBooking.status = 'CONFIRMED';
          localBooking.meeting_url = meetingUrl;
          localBooking.updated_at = new Date().toISOString();
        }
      }
      return data;
    }

    return {
      success: false,
      error: data.error || { code: 'CONFIRMATION_FAILED', message: 'Failed to confirm session.' },
    };
  } catch {
    if (!isDevMode) {
      return {
        success: false,
        error: { code: 'NO_BACKEND', message: 'Booking confirmation service is unavailable.' },
      };
    }
    // Direct execution fallback on local db
    const db = getLocalBookingEngineContext();
    return await confirmSessionByMentor({ bookingId, mentorId, meetingUrl }, db);
  }
}

/**
 * Fetches overdue bookings for admin ledger.
 */
export async function fetchOverdueBookings(): Promise<Booking[]> {
  try {
    const res = await apiFetch('/api/admin/bookings/overdue-links');
    if (res.ok) {
      const data = await res.json();
      if (data.bookings) return data.bookings;
    }
  } catch {
    // API unreachable
  }

  if (!isDevMode) {
    return [];
  }

  const db = getLocalBookingEngineContext();
  return getOverdueBookings(db);
}

/**
 * Fetches in-app notifications for user.
 */
export async function fetchUserNotifications(userId: string): Promise<Notification[]> {
  try {
    const res = await apiFetch(`/api/notifications?userId=${encodeURIComponent(userId)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.notifications) return data.notifications;
    }
  } catch {
    // API unreachable
  }

  if (!isDevMode) {
    return [];
  }

  const db = getLocalBookingEngineContext();
  const userIds = [userId];
  return (db.notifications || [])
    .filter((n) => userIds.includes(n.user_id))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

// ----------------------------------------------------------------------------
// PHASE 9: SESSION ACCESS & JOIN CLIENT HELPERS
// ----------------------------------------------------------------------------

/**
 * Fetches authoritative session access information:
 * Calls server GET /api/sessions/:id/access, with fallback to in-memory validation.
 */
export async function fetchSessionAccess(
  bookingId: string,
  userId: string,
  simulatedTime?: Date
): Promise<SessionAccessResult> {
  const timeParam = simulatedTime ? `&currentTime=${encodeURIComponent(simulatedTime.toISOString())}` : '';
  try {
    const res = await apiFetch(`/api/sessions/${encodeURIComponent(bookingId)}/access?userId=${encodeURIComponent(userId)}${timeParam}`);
    const data = await res.json();
    if (res.ok && data.success !== undefined) {
      return data;
    }
  } catch {
    // API unreachable
  }

  if (!isDevMode) {
    return {
      success: false,
      accessState: 'BEFORE_T5',
      canJoin: false,
      meetingUrl: null,
      sessionTitle: '',
      mentorName: '',
      seekerName: '',
      mentorId: '',
      seekerId: '',
      startTime: '',
      endTime: '',
      currentServerTime: new Date().toISOString(),
      secondsUntilT5: 0,
      secondsUntilStart: 0,
      secondsUntilEnd: 0,
      bookingStatus: 'PENDING_VERIFICATION',
      bookingCode: '',
      message: 'Session access service is unavailable.',
      error: { code: 'NO_BACKEND', message: 'Session access service is unavailable.' },
    };
  }

  const db = getLocalBookingEngineContext();
  return validateSessionAccess(
    {
      bookingId,
      userId,
      currentUtcTime: simulatedTime,
    },
    db
  );
}

/**
 * Authoritative join action:
 * When user clicks "Join Session", sends request to server for verification.
 * Server strictly rejects before T-5 or after end_time.
 */
export async function joinSessionRequest(
  bookingId: string,
  userId: string,
  simulatedTime?: Date
): Promise<AuthoritativeJoinResult> {
  try {
    const res = await apiFetch(`/api/sessions/${encodeURIComponent(bookingId)}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        currentTime: simulatedTime ? simulatedTime.toISOString() : undefined,
      }),
    });
    const data = await res.json();
    return data;
  } catch {
    // API unreachable
  }

  if (!isDevMode) {
    return {
      success: false,
      canJoin: false,
      accessState: 'BEFORE_T5',
      error: { code: 'NO_BACKEND', message: 'Session join service is unavailable.' },
    };
  }

  const db = getLocalBookingEngineContext();
  return joinSessionAuthoritative(
    {
      bookingId,
      userId,
      currentUtcTime: simulatedTime,
    },
    db
  );
}

/**
 * Explicitly marks a session as COMPLETED after conclusion.
 */
export async function markSessionCompleted(bookingId: string): Promise<boolean> {
  try {
    const res = await apiFetch(`/api/sessions/${encodeURIComponent(bookingId)}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    if (res.ok && data.success) return true;
  } catch {
    // API unreachable
  }

  if (!isDevMode) {
    return false;
  }

  const db = getLocalBookingEngineContext();
  const b = db.bookings.find((item) => item.id === bookingId || item.booking_code.toUpperCase() === bookingId.toUpperCase());
  if (b) {
    b.status = 'COMPLETED';
    b.updated_at = new Date().toISOString();
    return true;
  }
  return false;
}

