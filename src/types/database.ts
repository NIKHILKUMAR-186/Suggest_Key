import { Profile, UserRoleRecord } from './auth';

// ----------------------------------------------------------------------
// 1. SEGMENTS
// ----------------------------------------------------------------------
export interface Segment {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  priority: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ----------------------------------------------------------------------
// 2. MENTOR PROFILES
// ----------------------------------------------------------------------
export interface MentorProfile {
  id: string; // Foreign key to profiles.id
  headline: string;
  about: string | null;
  experience_years: number;
  languages: string[];
  rating: number;
  review_count: number;
  session_count: number;
  is_approved: boolean;
  is_featured: boolean;
  created_at: string;
  updated_at: string;
  // Joined fields
  profile?: Profile;
}

// ----------------------------------------------------------------------
// 3. MENTOR SEGMENTS
// ----------------------------------------------------------------------
export interface MentorSegment {
  id: string;
  mentor_id: string;
  segment_id: string;
  is_primary: boolean;
  created_at: string;
  // Joined fields
  segment?: Segment;
}

// ----------------------------------------------------------------------
// 4. SEEKER PROFILES
// ----------------------------------------------------------------------
export interface SeekerProfile {
  id: string; // Foreign key to profiles.id
  preferred_language: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  profile?: Profile;
}

// ----------------------------------------------------------------------
// 5. GIGS
// ----------------------------------------------------------------------
export type GigDuration = 30 | 45 | 60 | 90 | 120;

export interface Gig {
  id: string;
  mentor_id: string;
  segment_id: string;
  title: string;
  description: string;
  duration_minutes: GigDuration;
  price_inr: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Joined fields
  segment?: Segment;
  mentor?: Profile;
}

// ----------------------------------------------------------------------
// 6. MENTOR AVAILABILITY (Recurring Weekly)
// ----------------------------------------------------------------------
export interface MentorAvailability {
  id: string;
  mentor_id: string;
  day_of_week: number; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  start_time: string; // 'HH:MM:SS' or 'HH:MM'
  end_time: string; // 'HH:MM:SS' or 'HH:MM'
  timezone: string;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

// ----------------------------------------------------------------------
// 7. MENTOR AVAILABILITY EXCEPTIONS (Date Overrides)
// ----------------------------------------------------------------------
export interface MentorAvailabilityException {
  id: string;
  mentor_id: string;
  exception_date: string; // 'YYYY-MM-DD'
  is_available: boolean;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  created_at: string;
}

// ----------------------------------------------------------------------
// 8. SLOT HOLDS (15-min Concurrency Lock)
// ----------------------------------------------------------------------
export type SlotHoldStatus = 'ACTIVE' | 'CONVERTED' | 'EXPIRED' | 'RELEASED';

export interface SlotHold {
  id: string;
  mentor_id: string;
  seeker_id: string;
  gig_id: string;
  start_time: string; // UTC ISO string
  end_time: string; // UTC ISO string
  status: SlotHoldStatus;
  expires_at: string; // UTC ISO string
  created_at: string;
}

// ----------------------------------------------------------------------
// 9. BOOKINGS
// ----------------------------------------------------------------------
export type BookingStatus =
  | 'PAYMENT_PENDING'
  | 'PENDING_VERIFICATION'
  | 'MENTOR_PENDING'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REJECTED';

export interface Booking {
  id: string;
  booking_code: string; // e.g. "BK-9021"
  mentor_id: string;
  seeker_id: string;
  gig_id: string;
  segment_id: string;
  hold_id: string | null;
  start_time: string; // UTC ISO string
  end_time: string; // UTC ISO string
  seeker_timezone: string;
  mentor_timezone: string;
  amount_inr: number;
  status: BookingStatus;
  meeting_url: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  mentor?: Profile;
  seeker?: Profile;
  gig?: Gig;
  segment?: Segment;
}

// ----------------------------------------------------------------------
// 10. PAYMENTS (Manual QR & Proof Verification)
// ----------------------------------------------------------------------
export type PaymentStatus = 'PENDING_VERIFICATION' | 'VERIFIED' | 'REJECTED';

export interface Payment {
  id: string;
  booking_id: string;
  seeker_id: string;
  amount_inr: number;
  status: PaymentStatus;
  proof_storage_path: string;
  transaction_reference: string | null;
  verified_by: string | null;
  verified_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  booking?: Booking;
  seeker?: Profile;
}

// ----------------------------------------------------------------------
// 11. NOTIFICATIONS
// ----------------------------------------------------------------------
export type NotificationType = 'BOOKING' | 'PAYMENT' | 'SESSION' | 'WORKSPACE' | 'SYSTEM' | 'REMINDER' | 'ADMIN';

export type NotificationEventType =
  // Seeker events
  | 'BOOKING_CREATED'
  | 'PAYMENT_SUBMITTED'
  | 'PAYMENT_APPROVED'
  | 'PAYMENT_REJECTED'
  | 'MENTOR_CONFIRMED'
  | 'MEETING_LINK_AVAILABLE'
  | 'SESSION_REMINDER'
  | 'CANCELLATION'
  | 'RESCHEDULING'
  | 'SESSION_COMPLETED'
  | 'WORKSPACE_UPDATED'
  // Mentor events
  | 'NEW_BOOKING'
  | 'MEETING_LINK_DEADLINE'
  | 'OVERDUE_MEETING_LINK'
  | 'MENTOR_SESSION_REMINDER'
  | 'MENTOR_CANCELLATION'
  | 'MENTOR_RESCHEDULING'
  | 'SESSION_COMPLETION'
  // Admin events
  | 'ADMIN_PAYMENT_PROOF_SUBMITTED'
  | 'ADMIN_OVERDUE_MENTOR_LINK'
  | 'ADMIN_MENTOR_CANCELLATION'
  | 'ADMIN_BOOKING_INTERVENTION';

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: NotificationType;
  event_type?: NotificationEventType | string;
  entity_type?: 'booking' | 'payment' | 'session' | 'workspace' | 'mentor' | 'seeker' | string;
  entity_id?: string;
  link: string | null;
  is_read: boolean;
  read_at?: string | null;
  created_at: string;
  metadata?: Record<string, any>;
}

// ----------------------------------------------------------------------
// 12. SESSION WORKSPACES
// ----------------------------------------------------------------------
export type WorkspaceStatus = 'PENDING' | 'PUBLISHED';

export interface ActionItem {
  id: string;
  text: string;
  completed: boolean;
}

export interface NextStepItem {
  id: string;
  text: string;
  due_date?: string;
  completed?: boolean;
}

export interface ResourceLink {
  title: string;
  url: string;
  type?: 'DOCUMENT' | 'LINK' | 'TOOL';
}

export interface FollowUpRecommendation {
  recommended: boolean;
  timeframe: string; // e.g. "1-2 weeks", "2-3 weeks", "1 month", "As needed"
  topic?: string;
  notes?: string;
}

export interface SessionOverviewData {
  bookingId: string;
  bookingCode: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  mentorId: string;
  mentorName: string;
  mentorHeadline?: string;
  seekerId: string;
  seekerName: string;
  segmentTitle: string;
  gigTitle: string;
  bookingStatus: string;
}

export interface SessionWorkspace {
  id: string;
  booking_id: string;
  mentor_id: string;
  seeker_id: string;
  status: WorkspaceStatus;
  mentor_notes: string;
  summary: string;
  takeaways: string[];
  suggestions: string[];
  next_steps: NextStepItem[];
  action_items: ActionItem[];
  follow_up_recommendation?: FollowUpRecommendation | null;
  resources: ResourceLink[];
  published_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  booking?: Booking;
  session_overview?: SessionOverviewData;
}

// Re-export auth types for convenience
export type { Profile, UserRoleRecord };

// ----------------------------------------------------------------------
// 13. SLOT GENERATION & DISCOVERY TYPES
// ----------------------------------------------------------------------
export type SlotStatus = 'AVAILABLE' | 'PAST' | 'BOOKED' | 'HELD';

export interface GeneratedSlot {
  id: string; // Deterministic identifier `${mentorId}_${utcStartTime}`
  mentor_id: string;
  gig_id: string;
  date: string; // 'YYYY-MM-DD'
  local_start_time: string; // 'HH:MM'
  local_end_time: string; // 'HH:MM'
  utc_start_time: string; // ISO 8601 UTC timestamp
  utc_end_time: string; // ISO 8601 UTC timestamp
  duration_minutes: number;
  timezone: string;
  status: SlotStatus;
  is_available: boolean;
  conflict_reason?: 'PAST' | 'BOOKING_CONFLICT' | 'HOLD_CONFLICT' | 'EXCEPTION';
}

export interface DiscoverableMentor {
  id: string;
  full_name: string;
  avatar_url: string | null;
  timezone: string;
  headline: string;
  about: string | null;
  experience_years: number;
  languages: string[];
  rating: number;
  review_count: number;
  session_count: number;
  is_approved: boolean;
  is_featured: boolean;
  segment: Segment;
  gig: Gig;
  available_slots: GeneratedSlot[]; // Valid future non-conflicting slots
  all_slots: GeneratedSlot[]; // All generated slots on selected date
  next_available_slot: GeneratedSlot | null;
}
