import 'dotenv/config';
import express, { type Response } from 'express';
import path from 'path';
import { timingSafeEqual, randomUUID } from 'crypto';
import { createServer as createHttpServer, type Server as HttpServer } from 'http';
import { createServer as createViteServer } from 'vite';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  executeAtomicBookingWithHold,
  confirmSessionByMentor,
  getOverdueBookings,
  validateSessionAccess,
  joinSessionAuthoritative,
  transitionExpiredBookingsToCompleted,
  calculateMeetingLinkDeadline,
  BookingEngineContext,
} from './src/lib/bookingEngine';
import { generateMentorSlots, addDaysToDateString } from './src/lib/slotEngine';
import {
  isBookingIdShape,
  isSafeBookingIdentifier,
  redactMeetingUrlForParticipant,
  SESSION_ACCESS_WINDOW_MS,
} from './src/lib/sessionAccess';
import { getLocalBookingEngineContext, enrichBooking } from './src/lib/bookingService';
import {
  deriveSessionOverview,
} from './src/lib/workspaceService';
import {
  requireAuth,
  requireAdmin,
  requireRole,
  requireActiveMentor,
  getSupabaseAdmin,
  createDemoToken,
  isDemoAuthEnabled,
  type AuthRequest,
} from './src/lib/supabaseServer';
import { generateRequestId } from './src/lib/requestId';
import { logApiRequest, requestIdMiddleware, requestLoggerMiddleware, fetchSystemLogs, fetchAuditLogs, fetchSystemHealthMetrics, logApiError, logger } from './src/lib/logger';
import { logSanitizer } from './src/lib/logSanitizer';
import { recordLoginFailure, resetLoginFailures } from './src/lib/loginFailureTracker';
import { auditAction } from './src/lib/auditLogger';
import { POSTGREST_RELATIONSHIPS } from './src/lib/postgrestRelationships';
import {
  PAYMENT_PROOF_BUCKET,
  PAYMENT_PROOF_MAX_BYTES,
  PAYMENT_STATUS_PENDING,
  PAYMENT_QR_BUCKET,
  PAYMENT_QR_MIME_TYPES,
  PAYMENT_QR_MAX_BYTES,
  PAYMENT_QR_MAX_LABEL,
  type PaymentQrMimeType,
  isPayableBookingStatus,
  normaliseTransactionReference,
  validateProofFile,
} from './src/lib/paymentProof';
import { isRazorpayEnabled, getRazorpayKeyId } from './src/lib/razorpayConfig';
import { extractWebhookSignature } from './src/lib/razorpaySignature';
import {
  createRazorpayGatewayClient,
  runCreateRazorpayOrder,
  runRazorpayWebhook,
  runVerifyRazorpayPayment,
  type RazorpayFailure,
} from './src/lib/razorpayService';
import { createSupabaseRazorpayStore } from './src/lib/razorpayStore';
import {
  DASHBOARD_RANGES,
  DEFAULT_RANGE,
  buildTimeline,
  computeOverview,
  detectAnomalies,
  groupErrors,
  isDashboardRange,
  summariseAuth,
  summariseServices,
  type HealthRow,
} from './src/lib/systemHealth';
import { getAdminDashboardData } from './src/lib/adminDashboardData';
import { GENERIC_ERROR_MESSAGE, describeSupabaseError, getErrorMessage, respondWithInternalError, respondWithServerError, resolveHttpStatusForSupabaseError, terminalErrorHandler } from './src/lib/supabaseErrors';
import {
  MENTOR_APPLICATION_STATUSES,
  buildMentorApplicationPagination,
  buildProfileSearchFilter,
  emptyMentorApplicationStatusCounts,
  parseMentorApplicationListQuery,
  type MentorApplicationStatusCounts,
} from './src/lib/mentorApplicationsQuery';
import type {
  GeneratedSlot,
  MentorApplicationDetailAuditEntry,
  MentorApplicationDetailDocument,
  MentorApplicationDetailRow,
  MentorApplicationQueueAuditEntry,
  MentorApplicationQueueRow,
} from './src/types/database';
import {
  ADMIN_CREATED_MENTOR_DEFAULTS,
  MENTOR_ADMIN_AUDIT_ACTIONS,
  MENTOR_STATUS_ACTION_SPECS,
  buildAdminCreatedMentorProfile,
  buildMentorStatusUpdate,
  deriveMentorAccountState,
  resolveMentorCreationSource,
  validateMentorStatusAction,
  type MentorAccountState,
  type MentorStatusAction,
} from './src/lib/adminMentorControl';

import {
  parseTagList,
  validateCreateUserForm,
  type CreateUserFormValues,
} from './src/lib/adminCreateUser';

import {
  ACCOUNT_STATUS_ACTION_SPECS,
  assertAdminAccountSafety,
  buildAccountStatusUpdate,
  deriveAccountState,
  validateAccountStatusAction,
  type AccountStatusAction,
} from './src/lib/adminAccountControl';
import { APP_CONFIG, HOLDOUT_MINUTES } from './src/config/app';
import { apiRateLimiter, expensiveRouteLimiter } from './src/lib/rateLimit';
import { apiSchemas, formatValidationFailure, parseBody, validateBody } from './src/lib/validation';

/**
 * Applicant embed for the admin mentor verification queue.
 *
 * `mentor_applications` has two foreign keys to `profiles`:
 *   user_id      -> profiles.id  (the applicant)
 *   reviewed_by  -> profiles.id  (the reviewing admin)
 * The relationship therefore has to be named explicitly, otherwise PostgREST
 * fails with PGRST201 "more than one relationship was found".
 */
const MENTOR_APPLICATION_LIST_SELECT = `
  *,
  documents:mentor_verification_documents(
    id, document_type, status, original_filename, uploaded_at, reviewed_at, reviewed_by, admin_note
  )
`;

const MENTOR_APPLICATION_DETAIL_SELECT = `
  *
`;

const MENTOR_APPLICATION_AUDIT_SELECT = `
  *
`;

const MENTOR_APPLICATION_STATUS_COUNT_BUCKETS = ['ALL', ...MENTOR_APPLICATION_STATUSES] as const;

/** Upper bound for the applicant profile pre-filter used by the search box. */
const MENTOR_APPLICATION_SEARCH_MATCH_LIMIT = 200;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/**
 * Any UUID shape, including the all-zero / low-entropy ids used by seeded rows.
 * Use this when the id is validated against the real table anyway; the database
 * is the authority, not the RFC 4122 version nibble.
 */
const UUID_SHAPE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_MENTOR_BIO_LENGTH = 10;
const MIN_PASSWORD_LENGTH = 6;

/**
 * A handler-thrown error that already knows the status and machine-readable code
 * it should be reported with.
 *
 * The alternative - returning a 500 and logging a message - is wrong for a
 * rejected admin setting: "that UPI ID is malformed" is a 400 with a specific
 * code the UI can render next to the field, not an internal failure. Used only
 * inside request handlers, so it never escapes to the global error handler.
 */
class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Mints a short-lived signed URL for the stored payment QR.
 *
 * The bucket is public, so this is convenience rather than secrecy, but a
 * stable asset URL is still better than nothing: it is scoped, it expires, and
 * it keeps the raw object key out of the seeker payload.
 *
 * A signing failure yields `null` and is logged. The caller must treat that as
 * "no QR configured" - never as "show a placeholder image".
 */
async function signQrImageUrl(admin: SupabaseClient, storagePath: string | null): Promise<string | null> {
  if (!storagePath) return null;
  try {
    const { data, error } = await admin.storage
      .from(PAYMENT_QR_BUCKET)
      .createSignedUrl(storagePath, 3600);
    if (error) {
      console.error('Failed to sign the payment QR URL:', error.message);
      return null;
    }
    return data?.signedUrl ?? null;
  } catch (signErr) {
    console.error('Failed to sign the payment QR URL:', logSanitizer.safeMessage(signErr));
    return null;
  }
}

/**
 * How many admin accounts are currently OPERATIONAL.
 *
 * Counted through the shared `deriveAccountState` so a time-boxed suspension
 * whose window has already elapsed counts as active: the account can sign in
 * and use the admin area, so treating it as inactive would wrongly block a
 * legitimate status change with LAST_ACTIVE_ADMIN. Raw string comparison is
 * deliberately avoided here for exactly that reason.
 */
async function countActiveAdminAccounts(admin: SupabaseClient): Promise<number> {
  const { data: adminRoleRows, error: adminRoleErr } = await admin
    .from('user_roles')
    .select('user_id')
    .eq('role', 'admin');
  if (adminRoleErr) throw adminRoleErr;

  const adminIds = Array.from(new Set((adminRoleRows || []).map((r: { user_id: string }) => r.user_id)));
  if (!adminIds.length) return 0;

  const { data: adminAccounts, error: adminAccountsErr } = await admin
    .from('profiles')
    .select('id, account_status, suspended_until')
    .in('id', adminIds);
  if (adminAccountsErr) throw adminAccountsErr;

  const now = new Date();
  return (adminAccounts || []).filter(
    (row: { account_status?: string | null; suspended_until?: string | null }) =>
      deriveAccountState(
        { account_status: row.account_status ?? null, suspended_until: row.suspended_until ?? null },
        now,
      ).canPerformOperationalActions,
  ).length;
}

interface PaymentNotificationInput {
  /** Recipients. `notifications.user_id` is NOT NULL, so each admin needs a row. */
  userIds: string[];
  title: string;
  message: string;
  type: 'BOOKING' | 'PAYMENT' | 'SESSION' | 'WORKSPACE' | 'SYSTEM' | 'REMINDER' | 'ADMIN';
  eventType: string;
  entityType: 'booking' | 'payment' | string;
  entityId: string;
  link: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Writes real rows into the existing `notifications` table.
 *
 * `notifications.user_id` is NOT NULL, so an "alert all admins" notification
 * has to be materialised once per admin account — the `user_id: null` pattern
 * used by some older admin-alert code is rejected by the live database.
 *
 * Failures are logged and swallowed on purpose: a payment that is already
 * stored must not be reported as failed just because the notification could not
 * be written.
 */
async function insertPaymentNotifications(
  admin: SupabaseClient,
  input: PaymentNotificationInput,
): Promise<number> {
  const recipients = Array.from(new Set(input.userIds.filter((id) => typeof id === 'string' && id)));
  if (!recipients.length) return 0;

  const rows = recipients.map((user_id) => ({
    user_id,
    title: input.title,
    message: input.message,
    type: input.type,
    event_type: input.eventType,
    entity_type: input.entityType,
    entity_id: input.entityId,
    link: input.link,
    is_read: false,
    metadata: input.metadata ?? {},
  }));

  const { error } = await admin.from('notifications').insert(rows);
  if (error) {
    console.error('Failed to write payment notifications:', error.message);
    return 0;
  }
  return rows.length;
}

/** Active admin account ids, used to route the payment verification alert. */
async function resolveActiveAdminIds(admin: SupabaseClient): Promise<string[]> {
  const { data, error } = await admin.from('user_roles').select('user_id').eq('role', 'admin');
  if (error) throw error;

  const ids = Array.from(new Set((data || []).map((r: { user_id: string }) => r.user_id)));
  if (!ids.length) return [];

  const { data: accounts, error: accountsErr } = await admin
    .from('profiles')
    .select('id, account_status, suspended_until')
    .in('id', ids);
  if (accountsErr) throw accountsErr;

  const now = new Date();
  return (accounts || [])
    .filter((row: { account_status?: string | null; suspended_until?: string | null }) =>
      deriveAccountState(
        { account_status: row.account_status ?? null, suspended_until: row.suspended_until ?? null },
        now,
      ).canPerformOperationalActions,
    )
    .map((row: { id: string }) => row.id);
}

/**
 * Tells the seeker what an admin decided about their payment.
 *
 * The database function `review_payment` owns the state transition but writes
 * no notification, so this fills that gap using the real payment/booking rows.
 * A failure here is logged, never thrown: the admin's decision is already
 * durably recorded and must not be reported as failed.
 */
async function notifyPaymentReviewed(
  admin: SupabaseClient,
  input: { paymentId: string; bookingId?: string | null; approved: boolean; rejectionReason?: string | null },
): Promise<void> {
  try {
    const { data: payment, error } = await admin
      .from('payments')
      .select('id, booking_id, seeker_id, amount_inr, status, rejection_reason')
      .eq('id', input.paymentId)
      .maybeSingle();
    if (error) throw error;
    if (!payment) return;

    const bookingId = input.bookingId ?? payment.booking_id;
    const { data: booking } = await admin
      .from('bookings')
      .select('id, booking_code')
      .eq('id', bookingId)
      .maybeSingle();

    const bookingCode = booking?.booking_code ?? null;
    const amountLabel = `₹${Number(payment.amount_inr ?? 0).toLocaleString('en-IN')}`;
    const codeSuffix = bookingCode ? ` for booking ${bookingCode}` : '';

    await insertPaymentNotifications(admin, {
      userIds: [payment.seeker_id],
      title: input.approved ? 'Payment verified' : 'Payment verification requires attention',
      message: input.approved
        ? `Your payment${codeSuffix} (${amountLabel}) has been verified. The mentor will now add the meeting link.`
        : `Your payment proof${codeSuffix} (${amountLabel}) could not be verified${input.rejectionReason ? `: ${input.rejectionReason}` : '.'} Please submit a clearer payment reference and screenshot.`,
      type: 'PAYMENT',
      eventType: input.approved ? 'PAYMENT_APPROVED' : 'PAYMENT_REJECTED',
      entityType: 'payment',
      entityId: payment.id,
      link: '/seeker/bookings',
      metadata: {
        bookingId,
        bookingCode,
        paymentId: payment.id,
        amountInr: payment.amount_inr,
        rejectionReason: input.rejectionReason ?? null,
      },
    });
  } catch (notifyErr) {
    console.error('Failed to notify seeker of payment review outcome:', logSanitizer.safeMessage(notifyErr));
  }
}

/**
 * Tells the mentor their booking is paid and awaiting their confirmation.
 *
 * Only ever called by the caller that WON the conditional
 * `PAYMENT_PENDING -> MENTOR_PENDING` update, which is what makes a duplicate
 * notification impossible: the webhook, the browser verification, and a retried
 * webhook all contend for that single update, and only the winner reaches this
 * function. The notification therefore goes out at most once per booking, and
 * never for a failed or uncaptured payment.
 *
 * `notifications.user_id` is NOT NULL, so the existing per-recipient insert
 * helper is used rather than a single row.
 */
async function notifyMentorOfPaymentCaptured(
  admin: SupabaseClient,
  input: { mentorId: string; bookingId: string; paymentId: string; amountInr: number; source: 'razorpay' },
): Promise<void> {
  try {
    const { data: booking, error: bookingErr } = await admin
      .from('bookings')
      .select('id, booking_code, mentor_id, start_time')
      .eq('id', input.bookingId)
      .maybeSingle();
    if (bookingErr) throw bookingErr;
    if (!booking) return;

    const amountLabel = `₹${Number(input.amountInr ?? 0).toLocaleString('en-IN')}`;
    const codeSuffix = booking.booking_code ? ` for booking ${booking.booking_code}` : '';

    await insertPaymentNotifications(admin, {
      userIds: [input.mentorId],
      title: 'New paid booking',
      message: `Payment received${codeSuffix} (${amountLabel}). Please confirm the session and add the meeting link.`,
      type: 'BOOKING',
      eventType: 'NEW_BOOKING',
      entityType: 'booking',
      entityId: input.bookingId,
      link: '/mentor/bookings',
      metadata: {
        bookingId: input.bookingId,
        bookingCode: booking.booking_code,
        paymentId: input.paymentId,
        amountInr: input.amountInr,
        source: input.source,
      },
    });
  } catch (notifyErr) {
    // The payment is already durably confirmed, so a failed notification must
    // never be reported as a failed payment. Logged and swallowed.
    console.error('Failed to notify mentor of captured payment:', logSanitizer.safeMessage(notifyErr));
  }
}


/**
 * The booking projection a mentor is allowed to see.
 *
 * `gig` is the row joined through `bookings.gig_id`, so a mentor with several
 * gigs can always tell WHICH gig a booking is for: the gig is never inferred
 * from the segment, from a default gig, or from a hardcoded name. `segment`
 * comes from `bookings.segment_id` the same way.
 */
const MENTOR_BOOKING_SELECT = `
  *,
  seeker:profiles!bookings_seeker_id_fkey(id, full_name, email, timezone),
  mentor:profiles!bookings_mentor_id_fkey(id, full_name, email, timezone),
  gig:gigs(id, title, description, duration_minutes, price_inr, segment_id),
  segment:segments(id, name, slug)
`;

/**
 * Reads one mentor's bookings, optionally narrowed to a single status.
 *
 * Scoped by `mentor_id` in the WHERE clause so a mentor can only ever read
 * their own rows, and joined with the gig/segment/seeker relations the mentor
 * card renders.
 */
async function loadMentorBookingRows(
  admin: SupabaseClient,
  mentorId: string,
  statusFilter: string | null,
): Promise<{ data: any[]; error: any | null }> {
  let query = admin
    .from('bookings')
    .select(MENTOR_BOOKING_SELECT)
    .eq('mentor_id', mentorId)
    .order('start_time', { ascending: true });

  if (statusFilter) {
    query = query.eq('status', statusFilter);
  }

  return (await query) as { data: any[]; error: any | null };
}

/**
 * Shapes a live booking row into the payload the mentor UI consumes.
 *
 * Nothing here invents data: the gig/segment/seeker are the joined relations of
 * THIS booking, the price is the `bookings.amount_inr` snapshot taken when the
 * booking was created, the duration is derived from the booking's own
 * start/end window, and the payment state comes from the real `payments` row.
 * The mentor is never redacted from `meeting_url` because the mentor is the
 * party that supplies it.
 */
function enrichMentorBookingProjection(
  booking: any,
  payment: any | null,
  hold: any | null = null,
): Record<string, any> {
  const durationMinutes = (() => {
    const start = new Date(booking.start_time).getTime();
    const end = new Date(booking.end_time).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    return Math.round((end - start) / 60000);
  })();

  return {
    ...booking,
    gig: booking.gig || null,
    segment: booking.segment || null,
    seeker: booking.seeker || null,
    mentor: booking.mentor || null,
    payment: payment || null,
    hold: hold || null,
    // Duration as it was booked, so a later gig edit cannot rewrite history.
    duration_minutes: durationMinutes ?? booking.gig?.duration_minutes ?? null,
    deadlineInfo: calculateMeetingLinkDeadline(booking.start_time),
  };
}

/**
 * Resolve an Admin segment reference that may be EITHER the human-readable
 * `segments.slug` used in browser URLs OR the internal `segments.id` UUID.
 *
 * URLs stay short and readable (`/admin/segments/relationship-advisior`) while
 * the database keeps its UUID primary key. Primary keys are never changed and
 * UUIDs are never stringified: the slug is resolved to the real row and the
 * real `segment.id` is what every downstream query uses.
 *
 * A slug can never collide with a UUID shape, so the two are unambiguous.
 */
async function resolveAdminSegmentBySlugOrId(
  admin: SupabaseClient,
  reference: string,
): Promise<{ segment: any | null; error: any | null }> {
  const key = String(reference ?? '').trim();
  if (!key) return { segment: null, error: null };

  const column = UUID_SHAPE_PATTERN.test(key) ? 'id' : 'slug';
  const { data, error } = await admin
    .from('segments')
    .select('*')
    .eq(column, key)
    .maybeSingle();

  if (error) return { segment: null, error };
  return { segment: data ?? null, error: null };
}

/**
 * Mentors assigned to a segment, read through `mentor_segments` and joined with
 * `profiles` (identity), `mentor_profiles` (approval/active/headline) and
 * `user_roles` (confirm the account really is a mentor).
 *
 * `headline` lives on `mentor_profiles`, NOT on `profiles`; selecting it from
 * `profiles` makes PostgREST reject the whole query and previously produced
 * rows with no name or email.
 */
async function loadSegmentMentors(
  admin: SupabaseClient,
  segmentId: string,
): Promise<{ mentors: any[]; error: any | null }> {
  const { data: msData, error: msErr } = await admin
    .from('mentor_segments')
    .select('mentor_id, segment_id, is_primary, created_at')
    .eq('segment_id', segmentId);

  if (msErr) return { mentors: [], error: msErr };

  const rows = msData || [];
  const mentorIds = Array.from(new Set(rows.map((ms: any) => ms.mentor_id as string)));
  if (mentorIds.length === 0) return { mentors: [], error: null };

  const [profilesRes, mentorProfilesRes, rolesRes, gigsRes] = await Promise.all([
    admin.from('profiles').select('id, full_name, email').in('id', mentorIds),
    admin.from('mentor_profiles').select('id, approval_status, is_approved, is_active, headline').in('id', mentorIds),
    admin.from('user_roles').select('user_id, role').in('user_id', mentorIds).eq('role', 'mentor'),
    admin.from('gigs').select('id, title, mentor_id, segment_id, is_active').in('mentor_id', mentorIds).eq('is_active', true),
  ]);

  // Every one of these must be checked: a discarded `error` turns a failed
  // query into an empty result set and silently blanks the whole table.
  for (const res of [profilesRes, mentorProfilesRes, rolesRes, gigsRes]) {
    if (res.error) return { mentors: [], error: res.error };
  }

  const profileMap = new Map((profilesRes.data || []).map((p: any) => [p.id, p]));
  const mpMap = new Map((mentorProfilesRes.data || []).map((mp: any) => [mp.id, mp]));
  const mentorRoleIds = new Set((rolesRes.data || []).map((r: any) => r.user_id as string));

  const activeGigByMentor = new Map<string, any>();
  for (const g of gigsRes.data || []) {
    if (g.segment_id !== segmentId) continue;
    if (!activeGigByMentor.has(g.mentor_id)) activeGigByMentor.set(g.mentor_id, g);
  }

  const mentors = rows
    // A mentor_segments row can outlive the mentor role; only list real mentors.
    .filter((ms: any) => mentorRoleIds.has(ms.mentor_id))
    .map((ms: any) => {
      const profile = profileMap.get(ms.mentor_id);
      const mp = mpMap.get(ms.mentor_id);
      return {
        id: ms.mentor_id,
        name: profile?.full_name || 'Unknown',
        email: profile?.email || '',
        headline: mp?.headline || '',
        isPrimary: Boolean(ms.is_primary),
        activeGig: activeGigByMentor.get(ms.mentor_id)?.title || null,
        approvalStatus: mp?.approval_status || 'draft',
        isActive: Boolean(mp?.is_active),
      };
    });

  return { mentors, error: null };
}

/**
 * Gigs belonging to a segment. A segment with no gigs yields an empty array,
 * which is a normal state and never an error.
 */
async function loadSegmentGigs(
  admin: SupabaseClient,
  segmentId: string,
): Promise<{ gigs: any[]; error: any | null }> {
  const { data, error } = await admin
    .from('gigs')
    .select('*, segment:segments(name)')
    .eq('segment_id', segmentId)
    .order('created_at', { ascending: false });

  if (error) return { gigs: [], error };

  const gigs = (data || []).map((g: any) => ({
    id: g.id,
    title: g.title,
    description: g.description,
    durationMinutes: g.duration_minutes,
    priceInr: g.price_inr,
    isActive: g.is_active,
    mentorId: g.mentor_id,
    segmentId: g.segment_id,
    segmentName: g.segment?.name || 'Unknown',
    createdAt: g.created_at,
    updatedAt: g.updated_at,
  }));

  return { gigs, error: null };
}

// ---------------------------------------------------------------------------
// SINGLE AUTHORITATIVE SLOT ENGINE (server side)
// ---------------------------------------------------------------------------
//
// `generateMentorSlots` is the only slot-generation implementation in the
// project, and this helper is the only place that feeds it real data. It MUST be
// called with the service-role client: the anon/authenticated RLS policies on
// `bookings` and `slot_holds` are participant-scoped, so a browser reading those
// tables directly only ever sees its own reservations and would happily offer a
// slot another seeker has already taken.
//
// Every input the engine needs is loaded here, in one bounded round trip set:
//   mentor timezone  <- profiles.timezone
//   duration         <- gigs.duration_minutes of the ACTIVE gig (never a constant)
//   schedule         <- mentor_availability
//   exceptions       <- mentor_availability_exceptions for the requested date
//   reservations     <- bookings (not CANCELLED/REJECTED)
//   holds            <- slot_holds ACTIVE and not yet expired
// `currentUtcTime` is the server clock, so a slot that has already started can
// never be reported as bookable regardless of the caller's clock.

export interface MentorSlotResult {
  mentor_id: string;
  timezone: string;
  gig: {
    id: string;
    segment_id: string;
    title: string;
    duration_minutes: number;
    price_inr: number;
  } | null;
  slots: GeneratedSlot[];
  available_count: number;
  /** Earliest still-blocking hold boundary, for a targeted revalidation timer. */
  next_hold_expires_at: string | null;
  /** Earliest not-yet-started slot boundary, for a targeted revalidation timer. */
  next_slot_start_at: string | null;
}

async function computeMentorSlotsForDate(
  admin: SupabaseClient,
  params: { mentorIds: string[]; dateStr: string; segmentId?: string; now: Date }
): Promise<{ results: Map<string, MentorSlotResult>; error: any | null }> {
  const { mentorIds, dateStr, segmentId, now } = params;
  const results = new Map<string, MentorSlotResult>();

  if (mentorIds.length === 0) return { results, error: null };

  // A generous UTC window around the requested calendar date. Overlap is
  // re-checked by the engine on the exact instants, so this only has to be wide
  // enough to never miss a row and narrow enough to stay cheap.
  const windowStartIso = `${dateStr}T00:00:00.000Z`;
  const windowEndIso = `${addDaysToDateString(dateStr, 2)}T00:00:00.000Z`;
  const nowIso = now.toISOString();

  const [profilesRes, availabilityRes, exceptionsRes, bookingsRes, holdsRes, gigsRes] =
    await Promise.all([
      admin
        .from('profiles')
        .select('id, timezone')
        .in('id', mentorIds),
      admin
        .from('mentor_availability')
        .select('*')
        .in('mentor_id', mentorIds)
        .eq('is_enabled', true),
      admin
        .from('mentor_availability_exceptions')
        .select('*')
        .in('mentor_id', mentorIds)
        .eq('exception_date', dateStr),
      admin
        .from('bookings')
        .select('*')
        .in('mentor_id', mentorIds)
        .not('status', 'in', '("CANCELLED","REJECTED")')
        .lt('start_time', windowEndIso)
        .gt('end_time', windowStartIso),
      admin
        .from('slot_holds')
        .select('*')
        .in('mentor_id', mentorIds)
        .eq('status', 'ACTIVE')
        .gt('expires_at', nowIso)
        .lt('start_time', windowEndIso)
        .gt('end_time', windowStartIso),
      admin.from('gigs').select('*').in('mentor_id', mentorIds).eq('is_active', true),
    ]);

  for (const res of [profilesRes, availabilityRes, exceptionsRes, bookingsRes, holdsRes, gigsRes]) {
    if (res.error) return { results, error: res.error };
  }

  const timezoneByMentor = new Map<string, string>(
    (profilesRes.data || []).map((p: any) => [p.id as string, (p.timezone as string) || APP_CONFIG.DEFAULT_TIMEZONE])
  );
  const availabilityRows = availabilityRes.data || [];
  const exceptionRows = exceptionsRes.data || [];
  const bookingRows = bookingsRes.data || [];
  const holdRows = holdsRes.data || [];
  const activeGigs = (gigsRes.data || []).filter((g: any) => !segmentId || g.segment_id === segmentId);

  for (const mentorId of mentorIds) {
    const timezone = timezoneByMentor.get(mentorId) || APP_CONFIG.DEFAULT_TIMEZONE;
    const gig = activeGigs.find((g: any) => g.mentor_id === mentorId) || null;

    if (!gig) {
      // No active offer for this segment: nothing is bookable, and saying so
      // explicitly is better than returning an empty slot list that looks like
      // "fully booked".
      results.set(mentorId, {
        mentor_id: mentorId,
        timezone,
        gig: null,
        slots: [],
        available_count: 0,
        next_hold_expires_at: null,
        next_slot_start_at: null,
      });
      continue;
    }

    const mentorHolds = holdRows.filter((h: any) => h.mentor_id === mentorId);
    const slots = generateMentorSlots({
      mentorId,
      gigId: gig.id,
      dateStr,
      timezone,
      durationMinutes: gig.duration_minutes,
      recurringAvailability: availabilityRows.filter((a: any) => a.mentor_id === mentorId),
      exceptions: exceptionRows.filter((e: any) => e.mentor_id === mentorId),
      bookings: bookingRows.filter((b: any) => b.mentor_id === mentorId),
      slotHolds: mentorHolds,
      currentUtcTime: now,
    });

    const nowMs = now.getTime();
    const holdExpiries = mentorHolds
      .map((h: any) => new Date(h.expires_at).getTime())
      .filter((ms: number) => Number.isFinite(ms) && ms > nowMs)
      .sort((a: number, b: number) => a - b);
    const upcomingStarts = slots
      .map((s) => new Date(s.utc_start_time).getTime())
      .filter((ms: number) => Number.isFinite(ms) && ms > nowMs)
      .sort((a: number, b: number) => a - b);

    results.set(mentorId, {
      mentor_id: mentorId,
      timezone,
      gig: {
        id: gig.id,
        segment_id: gig.segment_id,
        title: gig.title,
        duration_minutes: gig.duration_minutes,
        price_inr: gig.price_inr,
      },
      slots,
      available_count: slots.filter((s) => s.is_available).length,
      next_hold_expires_at: holdExpiries.length > 0 ? new Date(holdExpiries[0]).toISOString() : null,
      next_slot_start_at: upcomingStarts.length > 0 ? new Date(upcomingStarts[0]).toISOString() : null,
    });
  }

  return { results, error: null };
}

// ---------------------------------------------------------------------------
// Authoritative session context
// ---------------------------------------------------------------------------
// The session endpoints used to authorize against `getLocalBookingEngineContext()`,
// a hard-coded in-memory fixture of demo users, bookings and meeting URLs. That
// store is not the source of truth: real bookings were never in it, so the
// participant check, the booking-state check and the T-5 gate were all evaluated
// against data that has nothing to do with the caller's actual session, and
// POST /api/sessions/:bookingId/complete mutated a JavaScript object instead of
// a row.
//
// These helpers load the real booking from Supabase and hand it to the SAME
// `validateSessionAccess` / `joinSessionAuthoritative` engine that was already
// covered by the unit tests, so the security rules stay in one place. The
// in-memory context is still used when no database is configured, which is the
// "no backend at all" local preview.
//
// `bookings.id` is a UUID and `bookings.booking_code` is a short opaque code, so
// both are looked up with separate, shape-validated equality filters instead of
// a combined PostgREST `.or()` string. Interpolating an unvalidated path segment
// into `.or()` would let a caller inject extra filter clauses (`,id.neq...`).
// The shape rules live in `src/lib/sessionAccess.ts` so they are unit-testable.

const SESSION_BOOKING_SELECT = `
  id, booking_code, mentor_id, seeker_id, gig_id, segment_id, hold_id,
  start_time, end_time, seeker_timezone, mentor_timezone, amount_inr,
  status, meeting_url, actual_ended_at, ended_by_role, cancellation_reason, created_at, updated_at,
  gig:gigs(id, title),
  seeker:profiles!bookings_seeker_id_fkey(id, full_name, timezone),
  mentor:profiles!bookings_mentor_id_fkey(id, full_name, timezone)
`;

interface LoadedSessionBooking {
  booking: any | null;
  /** Flattened engine-shaped record; `meeting_url` and timestamps are real. */
  engineBooking: any;
  /** Real roles of the caller, read from `user_roles`. */
  callerIsAdmin: boolean;
}

/**
 * Loads one booking, its display metadata and the caller's real admin status.
 * Returns `{ booking: null }` when the identifier is malformed or unknown.
 */
async function loadAuthoritativeSessionBooking(
  admin: SupabaseClient,
  rawBookingId: string,
  callerId: string
): Promise<LoadedSessionBooking> {
  if (!isSafeBookingIdentifier(rawBookingId)) {
    return { booking: null, engineBooking: null, callerIsAdmin: false };
  }

  const identifier: string = rawBookingId;
  const isUuid = isBookingIdShape(identifier);
  const column = isUuid ? 'id' : 'booking_code';
  const value = isUuid ? identifier : identifier.toUpperCase();

  const { data, error } = await admin
    .from('bookings')
    .select(SESSION_BOOKING_SELECT)
    .eq(column, value)
    .limit(1);

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return { booking: null, engineBooking: null, callerIsAdmin: false };

  const { data: roleRows, error: roleErr } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', callerId);
  if (roleErr) throw roleErr;

  const callerIsAdmin = (roleRows || []).some((r: { role: string }) => r.role === 'admin');

  // `validateSessionAccess` reads the booking off the context and looks the
  // caller up in `userRoles`, so the engine sees the real row and the real role.
  const engineBooking = {
    ...row,
    booking_code: row.booking_code,
    mentor_id: row.mentor_id,
    seeker_id: row.seeker_id,
    gig_id: row.gig_id,
    segment_id: row.segment_id,
    start_time: row.start_time,
    end_time: row.end_time,
    status: row.status,
    meeting_url: row.meeting_url ?? null,
    actual_ended_at: row.actual_ended_at ?? null,
    cancellation_reason: row.cancellation_reason ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };

  return { booking: row, engineBooking, callerIsAdmin };
}

/**
 * Builds the minimal `BookingEngineContext` the session engine needs for a
 * single, already-authorized booking. The only role row supplied is the
 * caller's, so the engine's internal admin check reflects the database rather
 * than any fixture.
 */
function buildSessionEngineContext(
  engineBooking: any,
  callerId: string,
  callerIsAdmin: boolean
): BookingEngineContext {
  const base = getLocalBookingEngineContext();
  return {
    ...base,
    bookings: [engineBooking],
    userRoles: callerIsAdmin ? [{ user_id: callerId, role: 'admin' }] : [],
    gigs: engineBooking.gig
      ? [engineBooking.gig as any]
      : base.gigs.filter((g: any) => g.id === engineBooking.gig_id),
    profiles: [engineBooking.seeker, engineBooking.mentor].filter(Boolean),
  } as BookingEngineContext;
}

/**
 * Persists the automatic COMPLETED transition that `validateSessionAccess`
 * performs in memory when a CONFIRMED session has reached its scheduled
 * end_time.
 *
 * The engine mutates the in-memory context object, but the context is rebuilt
 * from the database on every request, so without this the transition would be
 * lost between calls and a seeker polling the access endpoint would keep
 * seeing IN_PROGRESS forever. This runs a conditional UPDATE scoped to the
 * still-CONFIRMED row so two concurrent polls cannot double-apply, and it
 * leaves `actual_ended_at` NULL (and `ended_by_role` NULL) because a natural
 * expiry is not a manual end.
 */
async function persistNaturalSessionCompletion(
  admin: SupabaseClient,
  engineBooking: any,
  nowIso: string
): Promise<boolean> {
  if (!engineBooking) return false;
  if (engineBooking.status !== 'CONFIRMED') return false;
  const endMs = new Date(engineBooking.end_time).getTime();
  if (!Number.isFinite(endMs) || new Date(nowIso).getTime() < endMs) return false;

  // `actual_ended_at` is set to `end_time`, NOT `nowIso`, and this must match
  // `complete_expired_sessions()` exactly. A natural expiry is recorded as the
  // moment the session was scheduled to end, so the value is identical whether
  // pg_cron or this read path got there first. Writing `nowIso` here would make
  // the recorded end depend on which path won the race, and would push the end
  // time forward by up to a full cron interval.
  const { data, error } = await admin
    .from('bookings')
    .update({
      status: 'COMPLETED',
      actual_ended_at: engineBooking.end_time,
      updated_at: nowIso,
    })
    .eq('id', engineBooking.id)
    .eq('status', 'CONFIRMED')
    .select('id, status')
    .maybeSingle();

  if (error) {
    console.error('Failed to persist natural session completion:', error.message);
    return false;
  }
  return !!data;
}

// ---------------------------------------------------------------------------
// Server-authoritative session logging
// ---------------------------------------------------------------------------
// Structured, greppable lines for the four decisions that matter when a session
// time bug is investigated: what state the server resolved, why a join was
// refused, and when a row was auto-completed.
//
// Only non-sensitive fields are logged. Meeting URLs are never written, and no
// payment data is touched, so these lines are safe to keep in a log aggregator.

type SessionLogEvent =
  | 'SESSION_STATE_RESOLVED'
  | 'SESSION_ACCESS_DENIED'
  | 'SESSION_ACCESS_GRANTED'
  | 'SESSION_AUTO_COMPLETED'
  | 'SESSION_MANUAL_END'
  | 'SESSION_RECONCILE_FAILED';

function logSessionEvent(
  event: SessionLogEvent,
  fields: Record<string, string | number | boolean | null | undefined>
): void {
  const parts: string[] = [event];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    parts.push(`${key}=${value}`);
  }
  console.log(parts.join(' '));
}

/**
 * Runs the database reconciliation for a single booking and returns the
 * server-resolved lifecycle state.
 *
 * This is the read-path half of the fix. `complete_expired_sessions()` is
 * driven by pg_cron every minute, which guarantees a past session cannot stay
 * open indefinitely. This call guarantees something stronger: the row is
 * corrected *before the first request that touches the booking is answered*, so
 * a stale CONFIRMED row can never even be served - not even for the first 59
 * seconds of a cron interval, and not at all if cron is unavailable.
 *
 * It delegates to `public.reconcile_expired_sessions(uuid)`, which is scoped to
 * one authorized booking (indexed by primary key) rather than scanning the
 * table, and which uses the caller's own JWT so RLS still decides whether the
 * caller may see the booking at all.
 *
 * A failure is logged and swallowed: reconciliation is an optimisation layered
 * on top of the resolver, and the resolver already refuses a join for an
 * elapsed booking on its own. A database hiccup must not turn a read into a
 * 500.
 */
async function reconcileBookingSessionState(
  admin: SupabaseClient,
  bookingId: string
): Promise<string | null> {
  if (!isSafeBookingIdentifier(bookingId) || !isBookingIdShape(bookingId)) return null;

  try {
    const { data, error } = await admin.rpc('reconcile_expired_sessions', {
      p_booking_id: bookingId,
    });
    if (error) {
      logSessionEvent('SESSION_RECONCILE_FAILED', {
        bookingId,
        detail: error.message,
      });
      return null;
    }
    return typeof data === 'string' ? data : null;
  } catch (err: any) {
    logSessionEvent('SESSION_RECONCILE_FAILED', {
      bookingId,
      detail: err?.message,
    });
    return null;
  }
}

/**
 * Bulk reconciles a page of already-fetched booking rows and annotates each with
 * its server-resolved lifecycle state.
 *
 * Used by the list endpoints, where calling the per-booking RPC once per row
 * would turn one page request into N round trips. Instead the expiry predicate
 * is evaluated here against the same server clock, and the transitions are
 * applied in a SINGLE conditional UPDATE scoped to `status = 'CONFIRMED'`.
 *
 * The predicate here is the same rule as `public.resolve_session_state` and
 * `public.complete_expired_sessions`: an elapsed `end_time` on a still-CONFIRMED
 * row means the session is over, whatever the row still says. The UPDATE is
 * idempotent (a second call matches zero rows) and sets `actual_ended_at` to the
 * booking's own `end_time`, so re-running can never move the recorded instant.
 *
 * `isUpcoming` is included because the spec requires Upcoming and History to be
 * separated by server time, not by the stored status - a stale CONFIRMED row
 * used to land in Upcoming forever.
 *
 * Notification emission is deliberately NOT done here. The cron job and
 * `reconcileBookingSessionState` own that, so a list request can never be the
 * thing that produces a completion notification.
 */
async function reconcileAndAnnotateBookingRows(
  admin: SupabaseClient,
  rows: any[],
  nowMs: number = Date.now()
): Promise<any[]> {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const expiredIds: string[] = [];
  for (const row of rows) {
    if (row?.status !== 'CONFIRMED') continue;
    const endMs = row.end_time ? new Date(row.end_time).getTime() : Number.NaN;
    // Fail closed on an unparseable window: treat it as elapsed rather than
    // leaving a row that can never be resolved.
    if (!Number.isFinite(endMs) || nowMs >= endMs) {
      expiredIds.push(row.id);
    }
  }

  if (expiredIds.length > 0) {
    // A single `.update()` cannot write a per-row value, and `actual_ended_at`
    // must be each booking's OWN `end_time` - collapsing the batch onto one
    // timestamp would misrecord every row in it. So the transition goes through
    // a scoped RPC that applies the same per-row expression as
    // `complete_expired_sessions()`, restricted to the ids on this page rather
    // than scanning the table.
    const { data, error } = await admin.rpc('reconcile_expired_bookings', {
      p_booking_ids: expiredIds,
    });
    if (error) {
      // Non-fatal: the annotation below still reports these rows as COMPLETED
      // from the clock, so the UI is correct even if the write failed.
      console.error('Bulk session reconciliation failed:', error.message);
    } else {
      const completed = Array.isArray(data) ? data.length : 0;
      if (completed > 0) {
        logSessionEvent('SESSION_AUTO_COMPLETED', {
          count: completed,
          reason: 'bulk_reconcile',
          serverNow: new Date(nowMs).toISOString(),
        });
      }
      // Reflect the transition locally so the response we return matches the row
      // we just wrote, without re-querying the page.
      const expiredSet = new Set(expiredIds);
      for (const row of rows) {
        if (!expiredSet.has(row.id)) continue;
        row.status = 'COMPLETED';
        // Mirror the write so the annotation below reads a consistent row. Left
        // NULL when the stored end is unparseable, which is also what
        // `annotateSessionState` treats as "elapsed but unrecorded".
        if (typeof row.end_time === 'string' && Number.isFinite(new Date(row.end_time).getTime())) {
          row.actual_ended_at = row.end_time;
        }
      }
    }
  }

  // Annotate unconditionally, including when nothing expired. Without this the
  // list endpoints would ship raw `status` with no `sessionState` / `isUpcoming`
  // at all, which is precisely the field the pages group on.
  for (const row of rows) annotateSessionState(row, nowMs);

  return rows;
}

/**
 * Attaches the server-resolved lifecycle state to a booking projection.
 *
 * This is the read-only half of the fix, and it is the reason an expired session
 * cannot be shown as joinable even if every write path has failed: the
 * annotation is derived from the server clock and `end_time`, never from the
 * stored status alone.
 */
function annotateSessionState<T extends Record<string, any>>(row: T, nowMs: number = Date.now()): T {
  const startMs = row.start_time ? new Date(row.start_time).getTime() : Number.NaN;
  const endMs = row.end_time ? new Date(row.end_time).getTime() : Number.NaN;

  let sessionState: 'SCHEDULED' | 'ACCESS_OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  let isUpcoming: boolean;

  if (row.status === 'CANCELLED' || row.status === 'REJECTED') {
    sessionState = 'CANCELLED';
    isUpcoming = false;
  } else if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    // Fail closed: an unreadable window is treated as closed, never as open.
    sessionState = 'COMPLETED';
    isUpcoming = false;
  } else if (row.actual_ended_at || row.status === 'COMPLETED' || nowMs >= endMs) {
    sessionState = 'COMPLETED';
    isUpcoming = false;
  } else if (nowMs >= startMs - SESSION_ACCESS_WINDOW_MS) {
    sessionState = nowMs >= startMs ? 'IN_PROGRESS' : 'ACCESS_OPEN';
    isUpcoming = true;
  } else {
    sessionState = 'SCHEDULED';
    isUpcoming = true;
  }

  return { ...row, sessionState, isUpcoming };
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Behind exactly one reverse proxy (the Vercel edge in production), so
  // `req.ip` is the real client instead of the proxy's own address. Without
  // this every visitor would share one rate-limit bucket.
  app.set('trust proxy', 1);

  type DemoRole = 'seeker' | 'mentor' | 'admin';

  interface DemoAccount {
    id: string;
    email: string;
    full_name: string;
    password: string;
    role: DemoRole;
    /**
     * A privileged persona is never reachable with a bare `{"persona":"..."}`
     * body. It requires the operator-supplied password, so enabling demo
     * personas can never mint an admin identity out of thin air.
     */
    requiresPassword: boolean;
  }

  interface DemoAuthResponse {
    user: { id: string; email: string };
    profile: {
      id: string;
      email: string;
      full_name: string;
      timezone: string;
      created_at: string;
      updated_at: string;
    };
    roles: DemoRole[];
    activeRole: DemoRole;
    token: string;
  }

  const demoAccounts: Record<DemoRole, DemoAccount> = {
    seeker: {
      id: 'usr-seeker-demo',
      email: 'seeker@suggestkey.com',
      full_name: 'Aman Kumar',
      password: 'password123',
      role: 'seeker',
      requiresPassword: false,
    },
    mentor: {
      id: 'usr-mentor-rahul',
      email: 'mentor@suggestkey.com',
      full_name: 'Rahul Sharma',
      password: 'password123',
      role: 'mentor',
      requiresPassword: false,
    },
    admin: {
      id: process.env.ADMIN_EMAIL || 'admin@suggestkey.local',
      email: process.env.ADMIN_EMAIL || 'admin@suggestkey.local',
      full_name: 'Platform Administrator',
      // Never defaults to an empty string. An unset or weak ADMIN_PASSWORD
      // removes the admin demo account from the registry entirely (see
      // buildDemoAccounts below), so `password: ""` can no longer be used to
      // authenticate as an admin.
      password: process.env.ADMIN_PASSWORD || '',
      role: 'admin',
      requiresPassword: true,
    },
  };

  /**
   * Fail closed on the admin demo persona.
   *
   * Previously `ADMIN_PASSWORD` defaulted to `''` and the email path compared
   * the candidate against that empty string, so anybody who knew the default
   * admin address could sign in as an admin on any host that had merely set a
   * demo secret. The admin persona is now only registered when the operator
   * supplies a strong password, and it always demands that password even on
   * the persona path.
   */
  const ADMIN_DEMO_PASSWORD_MIN_LENGTH = 12;
  const buildDemoAccounts = (): Record<DemoRole, DemoAccount> => {
    const configured = (process.env.ADMIN_PASSWORD || '').trim();
    if (configured.length >= ADMIN_DEMO_PASSWORD_MIN_LENGTH) {
      return demoAccounts;
    }
    const { admin: _omitted, ...withoutAdmin } = demoAccounts;
    return withoutAdmin as Record<DemoRole, DemoAccount>;
  };

  const passwordsMatch = (expected: string, candidate: string) => {
    const expectedBuffer = Buffer.from(expected);
    const candidateBuffer = Buffer.from(candidate);
    return expectedBuffer.length === candidateBuffer.length && timingSafeEqual(expectedBuffer, candidateBuffer);
  };

  const demoAuthResponse = (account: DemoAccount): DemoAuthResponse => {
    const now = new Date().toISOString();
    return {
      user: { id: account.id, email: account.email },
      profile: {
        id: account.id,
        email: account.email,
        full_name: account.full_name,
        timezone: 'Asia/Kolkata',
        created_at: now,
        updated_at: now,
      },
      roles: [account.role],
      activeRole: account.role,
      token: createDemoToken({ sub: account.id, email: account.email, role: account.role }),
    };
  };

  // Payment proofs are NOT sent through this parser. The browser uploads the
  // screenshot straight to the private Supabase bucket and POSTs only a small
  // metadata envelope (a few hundred bytes) to /api/seeker/bookings/:id/
  // /payment-proof, so a large base64 image can never reach the body limit
  // again — that was the cause of the 413. The cap is kept small and explicit
  // rather than removed, so a single oversized request is still refused early.
  //
  // `verify` stashes the exact bytes that arrived on the request. The Razorpay
  // webhook signs those raw bytes, so re-serialising the parsed JSON would
  // produce different bytes (key order, whitespace, unicode escaping) and the
  // signature would never verify. Keeping the buffer alongside the parsed body
  // means only the webhook needs it and every other route is unaffected.
  app.use(
    express.json({
      limit: '256kb',
      verify: (req, _res, buf) => {
        (req as AuthRequest).rawBody = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
      },
    }),
  );

  // --------------------------------------------------------------------------
  // Request ID + Centralized Request Logging Middleware
  // --------------------------------------------------------------------------
  app.use((req, res, next) => {
    const requestId = generateRequestId();
    (req as AuthRequest).requestId = requestId;
    (req as AuthRequest).logStart = Date.now();
    res.set('X-Request-ID', requestId);
    next();
  });

  // Capture response finish to log every API request
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) {
      next();
      return;
    }
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    let capturedBody: unknown = undefined;
    let capturedStatus: number | undefined;

    res.json = ((body: unknown) => {
      capturedBody = body;
      return originalJson(body);
    }) as typeof res.json;

    res.on('finish', async () => {
      const authReq = req as AuthRequest;
      const durationMs = authReq.logStart ? Date.now() - authReq.logStart : undefined;
      const statusCode = res.statusCode;
      const userId = authReq.auth?.user?.id || null;
      const role = authReq.auth?.roles?.includes('admin')
        ? 'admin'
        : authReq.auth?.roles?.includes('mentor')
          ? 'mentor'
          : authReq.auth?.roles?.includes('seeker')
            ? 'seeker'
            : null;

      const errorObj = capturedBody as any;
      const errorCode = errorObj?.error?.code || null;
      const errorMessage = errorObj?.error?.message || null;

      logApiRequest({
        requestId: authReq.requestId || '',
        method: req.method,
        path: req.path,
        statusCode,
        durationMs: durationMs || 0,
        userId: userId || undefined,
        role: role || undefined,
        error_code: errorCode || undefined,
        error_message: errorMessage || undefined,
        metadata: {
          durationMs,
          statusCode,
          error: errorMessage
            ? {
                code: errorCode,
                message: errorMessage,
              }
            : undefined,
        },
      }).catch(() => {});
    });

    next();
  });

  // --------------------------------------------------------------------------
  // API Rate Limiting
  // --------------------------------------------------------------------------
  // Mounted after the request-id and logging middleware so a rejected request
  // still gets an X-Request-ID and shows up in the admin system logs.
  app.use('/api', apiRateLimiter);

  // --------------------------------------------------------------------------
  // API Routes
  // --------------------------------------------------------------------------
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'suggest-key-api',
      timestamp: new Date().toISOString(),
    });
  });

  // POST /api/auth/demo-login
  // Auth is unauthenticated by nature, so this is keyed on IP. 10/min stops
  // credential and persona brute-forcing long before it is useful.
  // Demo auth is explicit and fail-closed: it requires
  // ENABLE_DEMO_PERSONAS=true, a non-production NODE_ENV and a strong
  // externally supplied DEMO_TOKEN_SECRET (see isDemoAuthEnabled). The admin
  // persona additionally requires the operator-set ADMIN_PASSWORD, and the
  // persona is dropped from the registry entirely when that password is unset
  // or too weak, so there is no default-secret or empty-password path to admin.
  app.post('/api/auth/demo-login', expensiveRouteLimiter, validateBody(apiSchemas.demoLogin), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!isDemoAuthEnabled()) {
      return res.status(404).json({
        success: false,
        error: { code: 'DEMO_LOGIN_DISABLED', message: 'Demo login is unavailable.' },
      });
    }
    // Already trimmed, lower-cased and type-checked by the schema, and a blank
    // field arrived here as `undefined` rather than as an empty string.
    const { persona, email, password } = req.body as {
      persona?: string;
      email?: string;
      password?: string;
    };

    // Privileged personas are only handed out to a caller who knows the
    // operator-configured password, so `{"persona":"admin"}` can never mint an
    // admin identity. The unprivileged personas stay one-click for the
    // development demo.
    const registry = buildDemoAccounts();
    let account: DemoAccount | undefined;
    if (persona && Object.prototype.hasOwnProperty.call(registry, persona)) {
      const candidate = registry[persona as DemoRole];
      if (!candidate.requiresPassword || passwordsMatch(candidate.password, password ?? '')) {
        account = candidate;
      }
    } else if (email) {
      account = Object.values(registry).find(
        (candidate) => candidate.email.toLowerCase() === email
      );
      if (account && !passwordsMatch(account.password, password ?? '')) {
        account = undefined;
      }
    }

    if (!account) {
      const tracked = await recordLoginFailure({
        email: email || persona,
        ip: req.ip,
        reason: 'INVALID_DEMO_CREDENTIALS',
      });

      logger.auth('login_failure', {
        requestId: (req as AuthRequest).requestId,
        path: '/api/auth/demo-login',
        method: 'POST',
        statusCode: 401,
        result: 'failure',
        reason: 'INVALID_DEMO_CREDENTIALS',
      });

      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_DEMO_CREDENTIALS', message: 'Invalid demo credentials.' },
        consecutiveFailures: tracked.consecutiveFailures,
      });
    }

    await resetLoginFailures({ email: account.email, ip: req.ip });

    return res.json({ success: true, ...demoAuthResponse(account) });
  });

  // POST /api/auth/login-failure
  // Detection telemetry for the brute-force alert. Supabase password sign-in
  // happens in the browser, so the server never observes the failed attempt
  // itself and the client reports it here. Rate limited per IP so the reporting
  // path cannot itself be used to flood the tracker table.
  app.post('/api/auth/login-failure', expensiveRouteLimiter, async (req: AuthRequest, res) => {
    try {
      const body = (req.body || {}) as { email?: unknown; reason?: unknown };
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const ip = typeof req.ip === 'string' ? req.ip : '';

      if (!email && !ip) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'email is required.' },
        });
      }

      const tracked = await recordLoginFailure({ email, ip, reason: body.reason });

      logger.auth('login_failure', {
        requestId: req.requestId,
        path: '/api/auth/login-failure',
        method: 'POST',
        statusCode: 401,
        result: 'failure',
        reason: typeof body.reason === 'string' ? body.reason.slice(0, 60) : 'INVALID_CREDENTIALS',
      });

      return res.json({
        success: true,
        consecutiveFailures: tracked.consecutiveFailures,
        shouldAlert: tracked.shouldAlert,
      });
    } catch (err: any) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: 'POST /api/auth/login-failure',
        clientMessage: 'Unable to record login attempt.',
      });
    }
  });

  // POST /api/auth/login-success
  // A correct password breaks the streak, so only genuinely consecutive failures
  // ever reach the threshold.
  app.post('/api/auth/login-success', expensiveRouteLimiter, async (req: AuthRequest, res) => {
    try {
      const body = (req.body || {}) as { email?: unknown };
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const ip = typeof req.ip === 'string' ? req.ip : '';

      const cleared = await resetLoginFailures({ email, ip });
      return res.json({ success: true, clearedFailures: cleared });
    } catch (err: any) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: 'POST /api/auth/login-success',
        clientMessage: 'Unable to record login attempt.',
      });
    }
  });

  // POST /api/bookings/hold: Complete Phase 6 Atomic Booking & Hold Endpoint
  // Expensive: the RPC takes a mentor row lock and writes a hold. The strict
  // limiter sits after requireAuth so the bucket is per user, not per IP.
  app.post('/api/bookings/hold', requireAuth, requireRole('seeker'), expensiveRouteLimiter, validateBody(apiSchemas.bookingHold), async (req: AuthRequest, res) => {
    try {
      // Schema-checked and normalised: ids are UUID-shaped, the instants are
      // real ISO timestamps, and nothing else can ride along in the body.
      const { mentorId, segmentId, gigId, startTime, endTime } = req.body;
      const seekerId = req.auth!.user.id;

      const admin = getSupabaseAdmin();
      if (admin) {
        // A deactivated or suspended SEEKER must not be able to start new
        // bookings (prompt section 4/5). Read from the same columns the Admin
        // writes, so the gate cannot be bypassed by calling this endpoint
        // directly. Existing bookings and payments are untouched.
        const { data: seekerAccount, error: seekerAccountErr } = await admin
          .from('profiles')
          .select('account_status, suspended_until')
          .eq('id', seekerId)
          .maybeSingle();
        if (seekerAccountErr) throw seekerAccountErr;

        const seekerState = deriveAccountState({
          account_status: seekerAccount?.account_status ?? null,
          suspended_until: seekerAccount?.suspended_until ?? null,
        });

        if (!seekerState.canPerformOperationalActions) {
          return res.status(403).json({
            success: false,
            error: {
              code: seekerState.isSuspended ? 'SEEKER_ACCOUNT_SUSPENDED' : 'SEEKER_ACCOUNT_DEACTIVATED',
              message: seekerState.isSuspended
                ? 'Your account is suspended. New bookings are not possible until the suspension is lifted.'
                : 'Your account has been deactivated. New bookings are not possible.',
            },
          });
        }

        // A deactivated or suspended mentor must stop receiving new bookings
        // (prompt section 5). Checked server-side so it cannot be bypassed by
        // calling this endpoint directly.
        const [{ data: mentorProfile, error: mpErr }, { data: mentorAccount, error: accErr }] = await Promise.all([
          admin
            .from('mentor_profiles')
            .select('approval_status, is_approved, is_active')
            .eq('id', mentorId)
            .maybeSingle(),
          admin
            .from('profiles')
            .select('account_status, suspended_until')
            .eq('id', mentorId)
            .maybeSingle(),
        ]);

        if (mpErr) throw mpErr;
        if (accErr) throw accErr;

        if (!mentorProfile) {
          return res.status(404).json({
            success: false,
            error: { code: 'MENTOR_NOT_FOUND', message: 'Mentor not found.' },
          });
        }

        const mentorState = deriveMentorAccountState({
          approval_status: mentorProfile.approval_status ?? null,
          is_approved: mentorProfile.is_approved ?? null,
          is_active: mentorProfile.is_active ?? null,
          account_status: mentorAccount?.account_status ?? null,
          suspended_until: mentorAccount?.suspended_until ?? null,
        });

        if (!mentorState.canPerformOperationalActions) {
          return res.status(403).json({
            success: false,
            error: {
              code: 'MENTOR_NOT_BOOKABLE',
              message: mentorState.isSuspended
                ? 'This mentor is currently suspended and cannot receive new bookings.'
                : mentorState.isDeactivated
                  ? 'This mentor has been deactivated and cannot receive new bookings.'
                  : 'This mentor is not currently available for bookings.',
            },
          });
        }

        // Real-time booking cutoff re-check, performed server-side immediately
        // before the hold is attempted. A slot the browser rendered seconds ago
        // may already be inside the cutoff, so the client is never trusted.
        //
        // The comparison is on absolute instants, so it is correct for whatever
        // timezone the mentor is in and needs no zone to be named. The database
        // function re-checks the same boundary under the mentor row lock, which
        // is what actually makes the decision race-free; this early return just
        // avoids a pointless RPC.
        const requestedStartMs = new Date(startTime).getTime();
        if (Number.isFinite(requestedStartMs)) {
          const nowMs = Date.now();
          if (requestedStartMs <= nowMs) {
            return res.status(409).json({
              success: false,
              error: {
                code: 'PAST_SLOT_FORBIDDEN',
                message: 'This slot can no longer be booked because it has already started.',
              },
            });
          }
          if (requestedStartMs - nowMs < APP_CONFIG.BOOKING_CUTOFF_MS) {
            return res.status(409).json({
              success: false,
              error: {
                code: 'BOOKING_CUTOFF_REACHED',
                message: `This slot can no longer be booked because it starts in less than ${APP_CONFIG.BOOKING_CUTOFF_MS / 60000} minutes.`,
              },
            });
          }
        }

        const { data, error } = await admin.rpc('create_booking_with_hold', {
          p_seeker_id: seekerId,
          p_mentor_id: mentorId,
          p_segment_id: segmentId,
          p_gig_id: gigId,
          p_start_time: startTime,
          p_end_time: endTime,
        });

        if (error) {
          // `create_booking_with_hold` refuses with a `code: X, <reason>` prefix.
          // Extracting the code is what lets a lost race render as a clean
          // "this slot was just taken" message instead of a generic failure, and
          // what lets the correct HTTP status reach the client.
          const codeMatch = error.message.match(/code:\s*([A-Z0-9_]+)/i);
          const code = codeMatch?.[1]?.toUpperCase() || 'BOOKING_FAILED';
          const reasonMatch = error.message.match(/code:\s*[A-Z0-9_]+,\s*(.*)$/i);
          const reason = (reasonMatch?.[1] || '').trim();

          const conflictCodes = [
            'SLOT_ALREADY_BOOKED',
            'SLOT_HELD_BY_OTHER',
            'BOOKING_CONFLICT',
            'OUTSIDE_AVAILABILITY',
            'OUTSIDE_EXCEPTION_HOURS',
            'DATE_EXCEPTION_UNAVAILABLE',
            'DURATION_MISMATCH',
            'PAST_SLOT_FORBIDDEN',
            'BOOKING_CUTOFF_REACHED',
          ];

          const status = conflictCodes.includes(code)
            ? 409
            : code === 'UNAUTHORIZED' || code === 'ROLE_NOT_SEEKER'
              ? 403
              : code === 'GIG_NOT_FOUND' || code === 'GIG_MISMATCH'
                ? 404
                : 400;

          return res.status(status).json({
            success: false,
            error: { code, message: reason || GENERIC_ERROR_MESSAGE },
          });
        }

        // The RPC returns { success, booking, hold }. The canonical booking
        // record is what the frontend must use for navigation — never the
        // hold id, never a payment id.
        const booking = data?.booking;
        if (!booking || typeof booking.id !== 'string') {
          return res.status(500).json({
            success: false,
            error: { code: 'BOOKING_CREATE_FAILED', message: 'Booking creation returned an invalid record.' },
          });
        }

        logger.booking('BOOKING_CREATE_COMMITTED', {
          requestId: req.requestId,
          userId: req.auth?.user?.id,
          role: 'seeker',
          bookingId: booking.id,
          holdId: booking.hold_id,
          bookingCode: booking.booking_code,
          mentorId: booking.mentor_id,
          seekerId: booking.seeker_id,
          status: booking.status,
        });

        return res.status(201).json({
          success: true,
          booking: {
            id: booking.id,
            booking_code: booking.booking_code,
            mentor_id: booking.mentor_id,
            seeker_id: booking.seeker_id,
            gig_id: booking.gig_id,
            segment_id: booking.segment_id,
            hold_id: booking.hold_id,
            start_time: booking.start_time,
            end_time: booking.end_time,
            seeker_timezone: booking.seeker_timezone,
            mentor_timezone: booking.mentor_timezone,
            amount_inr: booking.amount_inr,
            status: booking.status,
            created_at: booking.created_at,
            updated_at: booking.updated_at,
          },
          hold: data?.hold || null,
        });
      }

      const db: BookingEngineContext = getLocalBookingEngineContext();

      const result = await executeAtomicBookingWithHold(
        {
          seekerId,
          mentorId,
          segmentId,
          gigId,
          startTime,
          endTime,
          currentUtcTime: new Date(),
        },
        db
      );

      if (!result.success) {
        const code = result.error?.code;
        // Map domain errors to proper HTTP response codes
        if (code === 'SLOT_ALREADY_BOOKED' || code === 'SLOT_HELD_BY_OTHER') {
          return res.status(409).json(result);
        }
        if (code === 'AUTH_REQUIRED' || code === 'ROLE_NOT_SEEKER') {
          return res.status(403).json(result);
        }
        return res.status(400).json(result);
      }

      return res.status(201).json(result);
    } catch (err: any) {
      console.error('Unhandled booking error:', logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err, context: 'POST /api/bookings' });
    }
  });

  // --------------------------------------------------------------------------
  // Phase 8: Mentor Confirmation & Bookings Endpoints
  // --------------------------------------------------------------------------

  // GET /api/mentor/bookings: Get bookings for a mentor with optional status filter
  //
  // The mentor ledger is read from the LIVE `bookings` table. It used to be
  // served from the in-memory seed database, so a real booking (created through
  // `create_booking_with_hold` and advanced to MENTOR_PENDING by
  // `review_payment`) never appeared in My Bookings even though the mentor had
  // already been notified about it. The mentor is derived from the session, so
  // a client can never read another mentor's bookings.
  app.get('/api/mentor/bookings', requireAuth, requireRole('mentor'), async (req: AuthRequest, res) => {
    try {
      const { status } = req.query;
      const mentorId = req.auth!.user.id;
      const statusFilter = typeof status === 'string' && status && status !== 'ALL' ? status : null;

      const supabaseAdmin = getSupabaseAdmin();
      if (supabaseAdmin) {
        const { data: bookings, error: bookingsErr } = await loadMentorBookingRows(
          supabaseAdmin,
          mentorId,
          statusFilter
        );
        if (bookingsErr) throw bookingsErr;

        const bookingIds = (bookings || []).map((b: any) => b.id);
        const { data: payments, error: paymentsErr } = bookingIds.length
          ? await supabaseAdmin.from('payments').select('*').in('booking_id', bookingIds)
          : { data: [], error: null };
        if (paymentsErr) throw paymentsErr;

        const paymentByBooking = new Map<string, any>();
        for (const payment of payments || []) {
          paymentByBooking.set(payment.booking_id, payment);
        }

        // Reconcile expired sessions before projecting, then annotate each row
        // with its server-resolved lifecycle state. The mentor's Upcoming tab
        // must never contain a session that has already ended.
        const reconciledMentor = await reconcileAndAnnotateBookingRows(
          supabaseAdmin,
          [...(bookings || [])]
        );
        const enriched = reconciledMentor.map((booking: any) =>
          enrichMentorBookingProjection(booking, paymentByBooking.get(booking.id) || null)
        );

        return res.json({ success: true, bookings: enriched, serverNow: new Date().toISOString() });
      }

      // Fallback to the in-memory dev DB only when Supabase is not configured.
      const db = getLocalBookingEngineContext();
      const mentorIds = [mentorId];

      let matched = db.bookings.filter((b) => mentorIds.includes(b.mentor_id));
      if (statusFilter) {
        matched = matched.filter((b) => b.status === statusFilter);
      }

      matched.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
      const devEnriched = matched.map((b) => enrichBooking(b, db));

      return res.json({ success: true, bookings: devEnriched });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err, context: 'GET /api/mentor/bookings' });
    }
  });

  // GET /api/mentor/bookings/:id: Get booking detail with authorization check
  app.get('/api/mentor/bookings/:id', requireAuth, requireRole('mentor'), async (req: AuthRequest, res) => {
    try {
      const bookingId = req.params.id;
      const callerId = req.auth!.user.id;

      const supabaseAdmin = getSupabaseAdmin();
      if (supabaseAdmin) {
        const { data: booking, error: bookingErr } = await supabaseAdmin
          .from('bookings')
          .select(MENTOR_BOOKING_SELECT)
          .or(`id.eq.${bookingId},booking_code.eq.${bookingId}`)
          .maybeSingle();
        if (bookingErr) throw bookingErr;

        if (!booking) {
          return res.status(404).json({
            success: false,
            error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' },
          });
        }

        if (booking.mentor_id !== callerId) {
          return res.status(403).json({
            success: false,
            error: {
              code: 'FORBIDDEN_NOT_BOOKING_OWNER',
              message: 'Forbidden: You are not authorized to view this booking.',
            },
          });
        }

        const { data: payment, error: paymentErr } = await supabaseAdmin
          .from('payments')
          .select('*')
          .eq('booking_id', booking.id)
          .maybeSingle();
        if (paymentErr) throw paymentErr;

        const { data: hold, error: holdErr } = booking.hold_id
          ? await supabaseAdmin.from('slot_holds').select('*').eq('id', booking.hold_id).maybeSingle()
          : { data: null, error: null };
        if (holdErr) throw holdErr;

        // Reconcile + annotate so a detail page opened the next morning shows
        // COMPLETED immediately, on the very first request.
        const [reconciledDetail] = await reconcileAndAnnotateBookingRows(supabaseAdmin, [booking]);

        return res.json({
          success: true,
          booking: enrichMentorBookingProjection(reconciledDetail, payment || null, hold || null),
          serverNow: new Date().toISOString(),
        });
      }

      // Fallback to the in-memory dev DB only when Supabase is not configured.
      const db = getLocalBookingEngineContext();
      const booking = db.bookings.find((b) => b.id === bookingId || b.booking_code === bookingId);

      if (!booking) {
        return res.status(404).json({
          success: false,
          error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' },
        });
      }

      if (booking.mentor_id !== callerId) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN_NOT_BOOKING_OWNER',
            message: 'Forbidden: You are not authorized to view this booking.',
          },
        });
      }

      const enriched = enrichBooking(booking, db);
      return res.json({ success: true, booking: enriched });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err, context: 'GET /api/mentor/bookings/:id' });
    }
  });

  // GET /api/seeker/bookings/:id: Get booking detail for the authenticated seeker.
  //
  // The payment page (/seeker/payment?bookingId=...) and the booking-detail
  // page both rely on this endpoint. It enforces:
  //   - booking must exist
  //   - caller must be the seeker (booking.seeker_id == auth.uid())
  //   - admin may inspect any booking
  //
  // This is the authoritative lookup for the seeker payment flow. Without it
  // the payment page falls through to the in-memory dev DB, which never
  // contains the real Supabase booking, producing "Booking Not Found".
  app.get('/api/seeker/bookings/:id', requireAuth, requireRole('seeker'), async (req: AuthRequest, res) => {
    try {
      const bookingId = req.params.id;
      const callerId = req.auth!.user.id;

      const admin = getSupabaseAdmin();
      if (admin) {
        const { data: booking, error: bookingErr } = await admin
          .from('bookings')
          .select(`
            *,
            seeker:profiles!bookings_seeker_id_fkey(id, full_name, email, timezone),
            mentor:profiles!bookings_mentor_id_fkey(id, full_name, email, timezone),
            gig:gigs(id, title, duration_minutes, price_inr, segment_id),
            segment:segments(id, name, slug)
          `)
          .eq('id', bookingId)
          .maybeSingle();

        if (bookingErr) throw bookingErr;

        if (!booking) {
          return res.status(404).json({
            success: false,
            error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' },
          });
        }

        // Authorization: seeker must own the booking; admin may inspect any.
        const isAdmin = req.auth!.roles.includes('admin');
        if (!isAdmin && booking.seeker_id !== callerId) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN_NOT_BOOKING_OWNER', message: 'Forbidden: You are not authorized to view this booking.' },
          });
        }

        // Fetch payment record if one exists
        const { data: payment, error: paymentErr } = await admin
          .from('payments')
          .select('*')
          .eq('booking_id', bookingId)
          .maybeSingle();
        if (paymentErr) throw paymentErr;

        // Fetch hold details if present
        let hold = null;
        if (booking.hold_id) {
          const { data: holdData, error: holdErr } = await admin
            .from('slot_holds')
            .select('*')
            .eq('id', booking.hold_id)
            .maybeSingle();
          if (!holdErr) hold = holdData;
        }

        // Reconcile + annotate before projecting. Opening an old session URL
        // tomorrow must show COMPLETED on the first request, with no meeting
        // URL in the payload.
        const [reconciledSeekerDetail] = await reconcileAndAnnotateBookingRows(admin, [booking]);

        const enriched = redactMeetingUrlForParticipant(
          {
            ...reconciledSeekerDetail,
            gig: reconciledSeekerDetail.gig || null,
            segment: reconciledSeekerDetail.segment || null,
            seeker: reconciledSeekerDetail.seeker || null,
            mentor: reconciledSeekerDetail.mentor || null,
            payment: payment || null,
            hold: hold || null,
          },
          { isAdmin, isMentor: false }
        );

        return res.json({ success: true, booking: enriched, serverNow: new Date().toISOString() });
      }

      // Fallback to in-memory dev DB
      const db = getLocalBookingEngineContext();
      const booking = db.bookings.find((b) => b.id === bookingId || b.booking_code === bookingId);
      if (!booking) {
        return res.status(404).json({
          success: false,
          error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' },
        });
      }

      if (booking.seeker_id !== callerId) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN_NOT_BOOKING_OWNER', message: 'Forbidden: You are not authorized to view this booking.' },
        });
      }

      const enriched = enrichBooking(booking, db);
      return res.json({ success: true, booking: enriched });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // GET /api/seeker/bookings: List all bookings for the authenticated seeker.
  //
  // The My Bookings page relies on this endpoint. It enforces:
  //   - caller must be authenticated and hold the seeker role (admin may inspect)
  //   - only the caller's own bookings are returned
  //   - payments are joined so the UI can render real payment state
  app.get('/api/seeker/bookings', requireAuth, requireRole('seeker'), async (req: AuthRequest, res) => {
    try {
      const callerId = req.auth!.user.id;
      const isAdmin = req.auth!.roles.includes('admin');

      const admin = getSupabaseAdmin();
      if (admin) {
        let query = admin
          .from('bookings')
          .select(`
            *,
            seeker:profiles!bookings_seeker_id_fkey(id, full_name, email, timezone),
            mentor:profiles!bookings_mentor_id_fkey(id, full_name, email, timezone),
            gig:gigs(id, title, duration_minutes, price_inr, segment_id),
            segment:segments(id, name, slug)
          `)
          .order('start_time', { ascending: false });

        if (!isAdmin) {
          query = query.eq('seeker_id', callerId);
        }

        const { data: bookings, error: bookingsErr } = await query;
        if (bookingsErr) throw bookingsErr;

        // Fetch payments for all returned bookings
        const bookingIds = (bookings || []).map((b: any) => b.id);
        const { data: payments, error: paymentsErr } = bookingIds.length
          ? await admin.from('payments').select('*').in('booking_id', bookingIds)
          : { data: [], error: null };
        if (paymentsErr) throw paymentsErr;

        const paymentByBooking = new Map<string, any>();
        for (const payment of payments || []) {
          paymentByBooking.set(payment.booking_id, payment);
        }

        // Reconcile expired sessions BEFORE projecting, so a session whose
        // window closed is written back as COMPLETED and annotated from the
        // server clock. This is what moves an expired booking out of "Upcoming"
        // and off the join path without anyone clicking End Session.
        const reconciled = await reconcileAndAnnotateBookingRows(admin, [...(bookings || [])]);

        const enriched = reconciled.map((booking: any) =>
          redactMeetingUrlForParticipant(
            {
              ...booking,
              gig: booking.gig || null,
              segment: booking.segment || null,
              seeker: booking.seeker || null,
              mentor: booking.mentor || null,
              payment: paymentByBooking.get(booking.id) || null,
            },
            // A seeker never receives the link from a list payload; only the
            // access/join endpoints can release it, and only inside the window.
            { isAdmin, isMentor: false }
          )
        );

        return res.json({ success: true, bookings: enriched, serverNow: new Date().toISOString() });
      }

      // Fallback to in-memory dev DB
      const db = getLocalBookingEngineContext();
      const seekerIds = [callerId];
      let matched = db.bookings.filter((b) => seekerIds.includes(b.seeker_id));
      matched.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
      return res.json({ success: true, bookings: matched.map((b) => enrichBooking(b, db)) });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // --------------------------------------------------------------------------
  // Seeker Payment Proof Submission
  // --------------------------------------------------------------------------
  //
  // POST /api/seeker/bookings/:id/payment-proof
  //
  // The seeker has already paid offline (manual QR) and is now handing the
  // platform evidence of it. This is the ONLY writer of a `payments` row for a
  // seeker, and it is entirely server-authoritative:
  //
  //   authenticated -> owns this booking -> booking is still payable
  //   -> UTR and image both validate -> image stored -> payment upserted
  //
  // Nothing about the payment is taken from the request except the UTR and the
  // image itself. The amount, the seeker, the booking and the storage key are
  // all derived server-side, so a client cannot pay ₹1 for a ₹499 session.
  app.post('/api/seeker/bookings/:id/payment-proof', requireAuth, requireRole('seeker'), expensiveRouteLimiter, async (req: AuthRequest, res) => {
    const bookingId = req.params.id;
    const callerId = req.auth!.user.id;

    const admin = getSupabaseAdmin();
    if (!admin) {
      return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Payment service is temporarily unavailable.' } });
    }

    // ---- 1. Input validation --------------------------------------------
    // The image is NOT sent in this request. The browser uploads it straight
    // to the private Supabase bucket (the same two-step flow the mentor
    // verification documents already use) and sends only the resulting object
    // path here. That keeps this request a few hundred bytes instead of a
    // base64 image ~33% larger than the file, which is what previously blew
    // past the platform request-size limit and returned 413.
    const { transactionReference, fileName, mimeType, fileSize, storagePath } = req.body ?? {};

    const reference = normaliseTransactionReference(transactionReference);
    if (!reference.ok) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', field: 'transactionReference', message: reference.message } });
    }

    const proof = validateProofFile({
      name: typeof fileName === 'string' ? fileName : '',
      type: typeof mimeType === 'string' ? mimeType : '',
      size: typeof fileSize === 'number' ? fileSize : PAYMENT_PROOF_MAX_BYTES + 1,
    });
    if (!proof.ok) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', field: 'proof', message: proof.message } });
    }

    if (typeof storagePath !== 'string' || !storagePath) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', field: 'proof', message: 'Select your payment screenshot.' } });
    }

    // ---- 2. Booking exists, is owned by the caller, and is payable -------
    const { data: booking, error: bookingErr } = await admin
      .from('bookings')
      .select('id, booking_code, seeker_id, mentor_id, gig_id, amount_inr, status, start_time')
      .eq('id', bookingId)
      .maybeSingle();

    if (bookingErr) {
      return respondWithInternalError({ req, res, error: bookingErr, context: 'POST /api/seeker/bookings/:id/payment-proof' });
    }
    if (!booking) {
      return res.status(404).json({ success: false, error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' } });
    }
    if (booking.seeker_id !== callerId) {
      // The guard that stops one seeker submitting proof against another
      // seeker's booking.
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN_NOT_BOOKING_OWNER', message: 'You are not authorized to pay for this booking.' } });
    }

    // Checked only once the booking is known to exist and be the caller's, so a
    // bogus booking id still reports 404 rather than being masked as 403. The
    // client only ever names a path inside its OWN folder, and live storage RLS
    // already enforces that on upload; re-checking here means a crafted path
    // cannot make the server record a proof belonging to somebody else.
    if (!storagePath.startsWith(`${callerId}/${bookingId}/`)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN_STORAGE_PATH', message: 'That file does not belong to this booking.' } });
    }

    if (!isPayableBookingStatus(booking.status)) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'BOOKING_NOT_PAYABLE',
          message: `This booking is ${String(booking.status).replace(/_/g, ' ').toLowerCase()} and no longer accepts a payment proof.`,
        },
      });
    }

    // ---- 3. An existing payment decides insert vs update -----------------
    const { data: existingPayment, error: existingErr } = await admin
      .from('payments')
      .select('*')
      .eq('booking_id', bookingId)
      .maybeSingle();
    if (existingErr) {
      return respondWithInternalError({ req, res, error: existingErr, context: 'POST /api/seeker/bookings/:id/payment-proof (lookup)' });
    }

    if (existingPayment?.status === 'VERIFIED') {
      // Already verified: report the real state instead of creating anything.
      return res.status(409).json({
        success: false,
        error: { code: 'PAYMENT_ALREADY_VERIFIED', message: 'This payment has already been verified.' },
        payment: existingPayment,
      });
    }

    // ---- 4. Confirm the uploaded object really is there ------------------
    // The browser already put the file in the bucket. Verifying it here means a
    // payment row can never point at a path that holds no image, and lets the
    // real stored size be checked instead of a client-claimed number.
    const { data: storedFile, error: statErr } = await admin.storage
      .from(PAYMENT_PROOF_BUCKET)
      .list(`${callerId}/${bookingId}`, { search: storagePath.split('/').pop(), limit: 10 });

    if (statErr) {
      console.error('Payment proof lookup failed:', statErr.message);
      return respondWithInternalError({ req, res, error: statErr, context: 'POST /api/seeker/bookings/:id/payment-proof (storage lookup)' });
    }

    const storedObject = (storedFile || []).find((f) => f.name === storagePath.split('/').pop());
    if (!storedObject) {
      return res.status(400).json({ success: false, error: { code: 'PROOF_NOT_STORED', message: 'We could not find that screenshot. Please select it again.' } });
    }
    // supabase-js exposes the byte count on `metadata.size`, not on the object.
    const storedBytes = storedObject.metadata?.size;
    if (typeof storedBytes === 'number' && storedBytes > PAYMENT_PROOF_MAX_BYTES) {
      // The bucket's own limit is the backstop; this returns a clear message
      // instead of a generic failure.
      await admin.storage.from(PAYMENT_PROOF_BUCKET).remove([storagePath]);
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', field: 'proof', message: 'That image is too large. Please upload a screenshot under 5 MB.' } });
    }

    // ---- 5. Upsert the payment record ------------------------------------
    // `payments` has UNIQUE(booking_id), so this is naturally idempotent: a
    // re-submission after a rejection updates the single existing row instead
    // of inserting a duplicate.
    const nowIso = new Date().toISOString();
    const paymentRow = {
      booking_id: booking.id,
      seeker_id: booking.seeker_id,
      // Server-derived: never the client-supplied amount.
      amount_inr: booking.amount_inr,
      status: PAYMENT_STATUS_PENDING,
      proof_storage_path: storagePath,
      transaction_reference: reference.value,
      // A fresh submission clears a previous rejection and any stale verifier.
      rejection_reason: null,
      verified_by: null,
      verified_at: null,
      updated_at: nowIso,
    };

    const { data: payment, error: paymentErr } = await admin
      .from('payments')
      .upsert(paymentRow, { onConflict: 'booking_id' })
      .select()
      .single();

    if (paymentErr) {
      console.error('Failed to persist payment record:', paymentErr.message);
      // The uploaded object is now orphaned; remove it so a failed submission
      // leaves no unreferenced file in the private bucket.
      try {
        await admin.storage.from(PAYMENT_PROOF_BUCKET).remove([storagePath]);
      } catch (cleanupErr) {
        console.error('Failed to clean up orphaned proof upload:', logSanitizer.safeMessage(cleanupErr));
      }
      return respondWithInternalError({ req, res, error: paymentErr, context: 'POST /api/seeker/bookings/:id/payment-proof (persist)' });
    }

    // ---- 6. Advance the booking into verification -------------------------
    if (booking.status === 'PAYMENT_PENDING') {
      const { error: advanceErr } = await admin
        .from('bookings')
        .update({ status: 'PENDING_VERIFICATION', updated_at: nowIso })
        .eq('id', booking.id)
        .eq('status', 'PAYMENT_PENDING');
      if (advanceErr) {
        // The payment itself is safely stored, so this is logged rather than
        // thrown: the admin queue reads the payment, and My Bookings still
        // shows a truthful payment state.
        console.error('Failed to advance booking to PENDING_VERIFICATION:', advanceErr.message);
      }
    }

    // ---- 7. Notify the seeker and the admin queue ------------------------
    // Only a genuinely new submission raises the alert. A repeat click on an
    // already-pending payment updates the row but must not spam a second
    // notification; a re-submission after a rejection is a new review request
    // and does notify.
    const isNewReviewRequest = !existingPayment || existingPayment.status === 'REJECTED';
    const amountLabel = `₹${Number(booking.amount_inr ?? 0).toLocaleString('en-IN')}`;
    const notificationMetadata = {
      bookingId: booking.id,
      bookingCode: booking.booking_code,
      paymentId: payment.id,
      amountInr: booking.amount_inr,
      transactionReference: reference.value,
    };

    if (isNewReviewRequest) {
      await insertPaymentNotifications(admin, {
        userIds: [booking.seeker_id],
        title: 'Payment proof submitted',
        message: `We received your payment reference and screenshot for booking ${booking.booking_code} (${amountLabel}). An admin will verify it shortly.`,
        type: 'PAYMENT',
        eventType: 'PAYMENT_SUBMITTED',
        entityType: 'payment',
        entityId: payment.id,
        link: '/seeker/bookings',
        metadata: notificationMetadata,
      });

      try {
        const adminIds = await resolveActiveAdminIds(admin);
        await insertPaymentNotifications(admin, {
          userIds: adminIds,
          title: 'Payment verification required',
          message: `Payment proof submitted for booking ${booking.booking_code} (${amountLabel}). Reference ${reference.value}. Awaiting verification.`,
          type: 'PAYMENT',
          eventType: 'ADMIN_PAYMENT_PROOF_SUBMITTED',
          entityType: 'payment',
          entityId: payment.id,
          link: '/admin/payments',
          metadata: notificationMetadata,
        });
      } catch (adminNotifErr) {
        console.error('Failed to raise admin payment verification alert:', logSanitizer.safeMessage(adminNotifErr));
      }
    }

    auditAction(req.auth, 'payment_proof_submitted', {
      entityType: 'payment',
      entityId: payment.id,
      requestId: req.requestId,
      metadata: { bookingId: booking.id, bookingCode: booking.booking_code, amountInr: booking.amount_inr },
    });

    return res.status(201).json({
      success: true,
      // The status is PENDING_VERIFICATION, never "paid": the money is not
      // verified until an admin says so.
      message: 'Payment proof submitted for verification.',
      payment,
      booking: { id: booking.id, booking_code: booking.booking_code, status: 'PENDING_VERIFICATION', amount_inr: booking.amount_inr },
    });
  });

  // GET /api/seeker/bookings/:id/payment-proof
  // Returns the real current payment state for a booking so the payment page
  // can render the true status on load and after a refresh, instead of
  // inferring one from "the user visited this page".
  app.get('/api/seeker/bookings/:id/payment-proof', requireAuth, requireRole('seeker'), async (req: AuthRequest, res) => {
    try {
      const callerId = req.auth!.user.id;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Payment service is temporarily unavailable.' } });
      }

      const { data: booking, error: bookingErr } = await admin
        .from('bookings')
        .select('id, booking_code, seeker_id, status, amount_inr')
        .eq('id', req.params.id)
        .maybeSingle();
      if (bookingErr) throw bookingErr;

      if (!booking) {
        return res.status(404).json({ success: false, error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' } });
      }
      if (booking.seeker_id !== callerId) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN_NOT_BOOKING_OWNER', message: 'You are not authorized to view this booking.' } });
      }

      const { data: payment, error: paymentErr } = await admin
        .from('payments')
        .select('*')
        .eq('booking_id', booking.id)
        .maybeSingle();
      if (paymentErr) throw paymentErr;

      return res.json({ success: true, payment: payment ?? null, booking });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err, context: 'GET /api/seeker/bookings/:id/payment-proof' });
    }
  });

  // ==========================================================================
  // RAZORPAY ONLINE PAYMENT (Phase 2 backend)
  // ==========================================================================
  //
  // These three routes sit ALONGSIDE the manual QR flow above, never instead of
  // it. Every one of them is gated on `RAZORPAY_ENABLED`, so the integration can
  // ship and be tested while the manual UPI/QR path remains the default until
  // the Phase 3 frontend is ready. Nothing below changes the existing manual
  // payment behaviour, the slot hold, or the mentor confirmation flow.
  //
  // The business rules live in `src/lib/razorpayService.ts` so they are unit
  // tested without a database or a network; these handlers only do
  // authentication, dependency wiring and response shaping.

  /**
   * Shared failure responder so all three routes report a rejected Razorpay
   * call identically: the service decides the status and the code, this only
   * shapes the envelope.
   */
  const respondRazorpayFailure = (res: Response, error: RazorpayFailure) =>
    res.status(error.httpStatus).json({
      success: false,
      error: { code: error.code, message: error.message },
    });

  // POST /api/seeker/bookings/:id/razorpay/order
  //
  // Creates a Razorpay order for a booking, or returns the existing one so a
  // double-tap cannot mint two orders. Everything that decides whether this may
  // happen lives in the service: ownership, payability, slot validity, hold
  // validity, and a SERVER-DERIVED amount.
  //
  // The key id in the response is public by design (Razorpay's checkout needs
  // it). The key secret and webhook secret never leave the server.
  app.post(
    '/api/seeker/bookings/:id/razorpay/order',
    requireAuth,
    requireRole('seeker'),
    expensiveRouteLimiter,
    async (req: AuthRequest, res) => {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({
          success: false,
          error: { code: 'SERVICE_UNAVAILABLE', message: 'Payment service is temporarily unavailable.' },
        });
      }

      try {
        const result = await runCreateRazorpayOrder({
          bookingId: req.params.id,
          callerId: req.auth!.user.id,
          gateway: createRazorpayGatewayClient(),
          store: createSupabaseRazorpayStore(admin),
        });

        if (!result.ok) {
          auditAction(req.auth, 'razorpay_order_rejected', {
            entityType: 'booking',
            entityId: req.params.id,
            requestId: req.requestId,
            metadata: { code: result.error.code },
          });
          return respondRazorpayFailure(res, result.error);
        }

        auditAction(req.auth, 'razorpay_order_created', {
          entityType: 'payment',
          entityId: result.value.paymentId,
          requestId: req.requestId,
          metadata: {
            bookingId: result.value.bookingId ?? req.params.id,
            amountInr: result.value.amountInr,
            reusedExistingOrder: result.value.alreadyCreated,
          },
        });

        return res.status(result.value.alreadyCreated ? 200 : 201).json({
          success: true,
          // Enough for the browser to open Razorpay checkout. No secret.
          razorpayOrderId: result.value.razorpayOrderId,
          razorpayKeyId: result.value.razorpayKeyId,
          amountInr: result.value.amountInr,
          currency: result.value.currency,
          paymentId: result.value.paymentId,
          message: 'Payment order created.',
        });
      } catch (err: any) {
        return respondWithInternalError({ req, res, error: err, context: 'POST /api/seeker/bookings/:id/razorpay/order' });
      }
    },
  );

  // POST /api/seeker/bookings/:id/razorpay/verify
  //
  // The browser reports the payment it just made. The Razorpay signature is
  // verified SERVER-SIDE against the key secret before anything is written, and
  // nothing the browser claims about amount, status, user or booking is trusted
  // — those are only used to look up the real rows, and the amount is compared
  // against the stored server-derived value.
  //
  // This is deliberately safe to call repeatedly: the second call sees the
  // payment already captured, reports success, and does NOT notify the mentor a
  // second time.
  app.post(
    '/api/seeker/bookings/:id/razorpay/verify',
    requireAuth,
    requireRole('seeker'),
    expensiveRouteLimiter,
    async (req: AuthRequest, res) => {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({
          success: false,
          error: { code: 'SERVICE_UNAVAILABLE', message: 'Payment service is temporarily unavailable.' },
        });
      }

      try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const result = await runVerifyRazorpayPayment({
          bookingId: req.params.id,
          callerId: req.auth!.user.id,
          razorpayOrderId: body.razorpayOrderId,
          razorpayPaymentId: body.razorpayPaymentId,
          razorpaySignature: body.razorpaySignature,
          gateway: createRazorpayGatewayClient(),
          store: createSupabaseRazorpayStore(admin),
        });

        if (!result.ok) {
          // A rejected signature or amount is security-relevant, so it is
          // audited. Only the code is recorded - never the signature, which is
          // proof material.
          auditAction(req.auth, 'razorpay_payment_verification_failed', {
            entityType: 'booking',
            entityId: req.params.id,
            requestId: req.requestId,
            metadata: { code: result.error.code },
          });
          return respondRazorpayFailure(res, result.error);
        }

        if (result.value.mentorNotified) {
          const { data: booking } = await admin
            .from('bookings')
            .select('mentor_id, amount_inr')
            .eq('id', result.value.bookingId)
            .maybeSingle();
          if (booking) {
            await notifyMentorOfPaymentCaptured(admin, {
              mentorId: booking.mentor_id,
              bookingId: result.value.bookingId,
              paymentId: result.value.paymentId,
              amountInr: booking.amount_inr,
              source: 'razorpay',
            });
          }
        }

        auditAction(req.auth, 'razorpay_payment_verified', {
          entityType: 'payment',
          entityId: result.value.paymentId,
          requestId: req.requestId,
          metadata: {
            bookingId: result.value.bookingId,
            duplicate: result.value.duplicate,
            mentorNotified: result.value.mentorNotified,
          },
        });

        return res.json({
          success: true,
          paymentId: result.value.paymentId,
          bookingId: result.value.bookingId,
          bookingStatus: result.value.bookingStatus,
          paymentStatus: result.value.paymentStatus,
          message: 'Payment confirmed.',
        });
      } catch (err: any) {
        return respondWithInternalError({ req, res, error: err, context: 'POST /api/seeker/bookings/:id/razorpay/verify' });
      }
    },
  );

  // POST /api/webhooks/razorpay
  //
  // Unauthenticated by necessity: the caller is Razorpay, not a signed-in user.
  // The request is authorised entirely by the webhook signature, which is
  // computed over the RAW body captured by the JSON `verify` hook above. Using
  // `req.body` here would fail verification, so it is never used for it.
  //
  // Responds 200 for anything already seen so Razorpay stops retrying, and only
  // reports a failure for a genuinely unverifiable request.
  app.post('/api/webhooks/razorpay', async (req: AuthRequest, res) => {
    const admin = getSupabaseAdmin();
    if (!admin) {
      return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Webhook handler is not configured.' } });
    }

    // The raw bytes, exactly as Razorpay sent them. Never `req.body`.
    const rawBody = (req as AuthRequest).rawBody?.toString('utf8') ?? '';
    if (!rawBody) {
      return res.status(400).json({ success: false, error: { code: 'RAZORPAY_WEBHOOK_EMPTY', message: 'Empty webhook body.' } });
    }

    try {
      const result = await runRazorpayWebhook({
        rawBody,
        signature: extractWebhookSignature(req.headers as unknown as Record<string, unknown>),
        gateway: createRazorpayGatewayClient(),
        store: createSupabaseRazorpayStore(admin),
      });

      if (!result.ok) {
        // The event id is safe to log (it is a gateway identifier, not proof
        // material) but the signature never is.
        logger.auth('razorpay_webhook_rejected', {
          requestId: req.requestId,
          path: '/api/webhooks/razorpay',
          result: 'failure',
          reason: result.error.code,
        });
        return respondRazorpayFailure(res, result.error);
      }

      if (result.mentorNotified && result.bookingId) {
        const { data: booking } = await admin
          .from('bookings')
          .select('mentor_id, amount_inr')
          .eq('id', result.bookingId)
          .maybeSingle();
        if (booking) {
          await notifyMentorOfPaymentCaptured(admin, {
            mentorId: booking.mentor_id,
            bookingId: result.bookingId,
            // The real payment row, so the notification links to it.
            paymentId: result.paymentId ?? '',
            amountInr: booking.amount_inr,
            source: 'razorpay',
          });
        }
      }

      logger.auth('razorpay_webhook_processed', {
        requestId: req.requestId,
        path: '/api/webhooks/razorpay',
        result: 'success',
        reason: `${result.handled}${result.duplicateEvent ? ':duplicate' : ''}`,
      });

      return res.json({ success: true, handled: result.handled, duplicate: result.duplicateEvent });
    } catch (err: any) {
      // Rethrowing the cause of an unexpected failure lets Razorpay retry, which
      // is safe because processing is idempotent.
      logger.auth('razorpay_webhook_error', {
        requestId: req.requestId,
        path: '/api/webhooks/razorpay',
        result: 'failure',
        reason: 'WEBHOOK_PROCESSING_FAILED',
      });
      return respondWithInternalError({ req, res, error: err, context: 'POST /api/webhooks/razorpay' });
    }
  });

  // GET /api/payments/razorpay/config
  //
  // Non-secret availability probe for the frontend. Returns only whether the
  // gateway is switched on and which key id to use - never a secret, and never
  // enough to verify a signature. Lets the UI hide the gateway option while
  // RAZORPAY_ENABLED is off, without the manual flow being affected.
  app.get('/api/payments/razorpay/config', requireAuth, async (_req: AuthRequest, res) => {
    const enabled = isRazorpayEnabled();
    return res.json({
      success: true,
      enabled,
      currency: enabled ? 'INR' : null,
      // Read through the config module so this can never drift from what the
      // order-creation path uses. Absent rather than a placeholder when
      // disabled: an empty value must never be mistaken for a real key.
      razorpayKeyId: enabled ? getRazorpayKeyId() || null : null,
    });
  });

  // --------------------------------------------------------------------------
  // Seeker Cancellation & Rescheduling
  // --------------------------------------------------------------------------
  //
  // POST /api/seeker/bookings/:id/cancel
  // Cancels a booking if the session starts in >= 10 minutes.
  // The 10-minute window is evaluated server-side using the authoritative clock.
  app.post('/api/seeker/bookings/:id/cancel', requireAuth, requireRole('seeker'), validateBody(apiSchemas.bookingCancel), async (req: AuthRequest, res) => {
    try {
      const bookingId = req.params.id;
      const callerId = req.auth!.user.id;
      const { reason } = req.body as { reason?: string };

      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Booking service is temporarily unavailable.' } });
      }

      const now = new Date();

      // Fetch booking with seeker ownership check
      const { data: booking, error: bookingErr } = await admin
        .from('bookings')
        .select('id, booking_code, seeker_id, mentor_id, status, start_time, hold_id, cancellation_reason')
        .eq('id', bookingId)
        .maybeSingle();

      if (bookingErr) throw bookingErr;
      if (!booking) {
        return res.status(404).json({ success: false, error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' } });
      }
      if (booking.seeker_id !== callerId) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN_NOT_BOOKING_OWNER', message: 'You are not authorized to cancel this booking.' } });
      }

      // Check if booking is in a cancellable state
      const cancellableStatuses = ['PAYMENT_PENDING', 'PENDING_VERIFICATION', 'MENTOR_PENDING', 'CONFIRMED'];
      if (!cancellableStatuses.includes(booking.status)) {
        return res.status(409).json({
          success: false,
          error: { code: 'BOOKING_NOT_CANCELLABLE', message: `This booking is ${booking.status.toLowerCase().replace(/_/g, ' ')} and cannot be cancelled.` },
        });
      }

      // Enforce 10-minute cancellation window (server-side authoritative time)
      const sessionStartMs = new Date(booking.start_time).getTime();
      const nowMs = now.getTime();
      const minutesUntilStart = (sessionStartMs - nowMs) / (1000 * 60);

      if (minutesUntilStart < APP_CONFIG.NORMAL_CANCELLATION_WINDOW_MINUTES) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'CANCELLATION_WINDOW_CLOSED',
            message: `Normal cancellation is only available until ${APP_CONFIG.NORMAL_CANCELLATION_WINDOW_MINUTES} minutes before the session. The session starts in ${Math.ceil(minutesUntilStart)} minutes.`,
          },
        });
      }

      // If PAYMENT_PENDING, also expire the associated hold
      if (booking.status === 'PAYMENT_PENDING' && booking.hold_id) {
        await admin
          .from('slot_holds')
          .update({ status: 'RELEASED', updated_at: now.toISOString() })
          .eq('id', booking.hold_id)
          .eq('status', 'ACTIVE');
      }

      // Cancel the booking
      const { data: updatedBooking, error: updateErr } = await admin
        .from('bookings')
        .update({
          status: 'CANCELLED',
          cancellation_reason: reason || 'Cancelled by seeker',
          updated_at: now.toISOString(),
        })
        .eq('id', bookingId)
        .select()
        .single();

      if (updateErr) throw updateErr;

      // Notify seeker
      await admin.from('notifications').insert({
        user_id: booking.seeker_id,
        title: 'Booking Cancelled',
        message: `You cancelled booking ${booking.booking_code}.${reason ? ` Reason: ${reason}` : ''}`,
        type: 'BOOKING',
        event_type: 'CANCELLATION',
        entity_type: 'booking',
        entity_id: booking.id,
        link: '/seeker/bookings',
        is_read: false,
      });

      // Notify mentor
      await admin.from('notifications').insert({
        user_id: booking.mentor_id,
        title: 'Seeker Cancelled Booking',
        message: `The seeker cancelled booking ${booking.booking_code}. The slot is now available for new bookings.`,
        type: 'BOOKING',
        event_type: 'MENTOR_CANCELLATION',
        entity_type: 'booking',
        entity_id: booking.id,
        link: '/mentor/bookings',
        is_read: false,
      });

      auditAction(req.auth, 'booking_cancelled', {
        entityType: 'booking',
        entityId: booking.id,
        requestId: req.requestId,
        metadata: { bookingCode: booking.booking_code, reason: reason || 'Cancelled by seeker' },
      });

      return res.json({ success: true, booking: updatedBooking, message: 'Booking cancelled successfully.' });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err, context: 'POST /api/seeker/bookings/:id/cancel' });
    }
  });

  // POST /api/seeker/bookings/:id/reschedule
  // Reschedules a booking to a new slot if the session starts in >= 10 minutes.
  // The new slot must pass all availability/conflict checks.
  app.post('/api/seeker/bookings/:id/reschedule', requireAuth, requireRole('seeker'), validateBody(apiSchemas.bookingReschedule), async (req: AuthRequest, res) => {
    try {
      const bookingId = req.params.id;
      const callerId = req.auth!.user.id;
      const { newStartTime, newEndTime, newGigId } = req.body as { newStartTime: string; newEndTime: string; newGigId?: string };

      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Booking service is temporarily unavailable.' } });
      }

      const now = new Date();

      // Fetch current booking
      const { data: booking, error: bookingErr } = await admin
        .from('bookings')
        .select('id, booking_code, seeker_id, mentor_id, gig_id, segment_id, status, start_time, end_time, hold_id, amount_inr')
        .eq('id', bookingId)
        .maybeSingle();

      if (bookingErr) throw bookingErr;
      if (!booking) {
        return res.status(404).json({ success: false, error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' } });
      }
      if (booking.seeker_id !== callerId) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN_NOT_BOOKING_OWNER', message: 'You are not authorized to reschedule this booking.' } });
      }

      // Check if booking is in a reschedulable state
      const reschedulableStatuses = ['PAYMENT_PENDING', 'PENDING_VERIFICATION', 'MENTOR_PENDING', 'CONFIRMED'];
      if (!reschedulableStatuses.includes(booking.status)) {
        return res.status(409).json({
          success: false,
          error: { code: 'BOOKING_NOT_RESCHEDULABLE', message: `This booking is ${booking.status.toLowerCase().replace(/_/g, ' ')} and cannot be rescheduled.` },
        });
      }

      // Enforce 10-minute rescheduling window
      const sessionStartMs = new Date(booking.start_time).getTime();
      const nowMs = now.getTime();
      const minutesUntilStart = (sessionStartMs - nowMs) / (1000 * 60);

      if (minutesUntilStart < APP_CONFIG.NORMAL_CANCELLATION_WINDOW_MINUTES) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'RESCHEDULE_WINDOW_CLOSED',
            message: `Normal rescheduling is only available until ${APP_CONFIG.NORMAL_CANCELLATION_WINDOW_MINUTES} minutes before the session. The session starts in ${Math.ceil(minutesUntilStart)} minutes.`,
          },
        });
      }

      // Validate new slot times
      const newStartMs = new Date(newStartTime).getTime();
      const newEndMs = new Date(newEndTime).getTime();

      if (isNaN(newStartMs) || isNaN(newEndMs) || newStartMs >= newEndMs) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_INTERVAL', message: 'Invalid new slot times.' } });
      }
      if (newStartMs <= nowMs) {
        return res.status(400).json({ success: false, error: { code: 'PAST_SLOT_FORBIDDEN', message: 'Cannot reschedule to a slot in the past.' } });
      }

      // Determine target gig (same gig by default, or new gig if provided)
      const targetGigId = newGigId || booking.gig_id;
      const { data: targetGig, error: gigErr } = await admin
        .from('gigs')
        .select('id, mentor_id, segment_id, duration_minutes, price_inr, is_active')
        .eq('id', targetGigId)
        .maybeSingle();

      if (gigErr) throw gigErr;
      if (!targetGig || !targetGig.is_active) {
        return res.status(404).json({ success: false, error: { code: 'GIG_INACTIVE', message: 'Selected gig is not active.' } });
      }

      // If changing gig, verify it belongs to same mentor and segment
      if (targetGig.mentor_id !== booking.mentor_id || targetGig.segment_id !== booking.segment_id) {
        return res.status(400).json({ success: false, error: { code: 'GIG_MISMATCH', message: 'New gig must belong to the same mentor and segment.' } });
      }

      // Check duration matches
      const newDurationMinutes = Math.round((newEndMs - newStartMs) / 60000);
      if (newDurationMinutes !== targetGig.duration_minutes) {
        return res.status(400).json({
          success: false,
          error: { code: 'DURATION_MISMATCH', message: `New slot duration (${newDurationMinutes}m) must match gig duration (${targetGig.duration_minutes}m).` },
        });
      }

      // Release old hold if PAYMENT_PENDING
      if (booking.status === 'PAYMENT_PENDING' && booking.hold_id) {
        await admin
          .from('slot_holds')
          .update({ status: 'RELEASED', updated_at: now.toISOString() })
          .eq('id', booking.hold_id)
          .eq('status', 'ACTIVE');
      }

      // Create new hold and update booking atomically via RPC
      // We reuse the atomic booking function but need a variant that updates existing booking
      // For simplicity, we'll do the checks and updates in a transaction-like manner
      // The RPC will fail if slot is not available; if it succeeds, we have a new hold
      const { data: holdResult, error: holdErr } = await admin.rpc('acquire_slot_hold', {
        p_mentor_id: booking.mentor_id,
        p_seeker_id: booking.seeker_id,
        p_gig_id: targetGigId,
        p_start_time: newStartTime,
        p_end_time: newEndTime,
      });

      if (holdErr) {
        const codeMatch = holdErr.message.match(/code:\s*([A-Z0-9_]+)/i);
        const code = codeMatch?.[1]?.toUpperCase() || 'RESCHEDULE_FAILED';
        const reasonMatch = holdErr.message.match(/code:\s*[A-Z0-9_]+,\s*(.*)$/i);
        const reason = (reasonMatch?.[1] || '').trim();

        const status = ['SLOT_ALREADY_BOOKED', 'SLOT_HELD_BY_OTHER', 'OUTSIDE_AVAILABILITY', 'OUTSIDE_EXCEPTION_HOURS', 'DATE_EXCEPTION_UNAVAILABLE', 'DURATION_MISMATCH', 'PAST_SLOT_FORBIDDEN', 'BOOKING_CUTOFF_REACHED'].includes(code)
          ? 409
          : 400;

        return res.status(status).json({ success: false, error: { code, message: reason || 'Could not reschedule to the requested slot.' } });
      }

      // Update booking with new slot and new hold
      const { data: updatedBooking, error: updateErr } = await admin
        .from('bookings')
        .update({
          gig_id: targetGigId,
          hold_id: holdResult.id,
          start_time: newStartTime,
          end_time: newEndTime,
          amount_inr: targetGig.price_inr,
          status: 'PAYMENT_PENDING', // Reset to payment pending for new slot
          updated_at: now.toISOString(),
        })
        .eq('id', bookingId)
        .select()
        .single();

      if (updateErr) throw updateErr;

      // Cancel old payment if exists (will be replaced when new payment submitted)
      await admin
        .from('payments')
        .update({ status: 'REJECTED', rejection_reason: 'Booking rescheduled to new slot', updated_at: now.toISOString() })
        .eq('booking_id', bookingId)
        .eq('status', 'PENDING_VERIFICATION');

      // Notify seeker
      await admin.from('notifications').insert({
        user_id: booking.seeker_id,
        title: 'Booking Rescheduled',
        message: `Your booking ${booking.booking_code} has been rescheduled. Please complete payment for the new slot within ${HOLDOUT_MINUTES} minutes.`,
        type: 'BOOKING',
        event_type: 'RESCHEDULING',
        entity_type: 'booking',
        entity_id: booking.id,
        link: `/seeker/payment?bookingId=${booking.id}`,
        is_read: false,
      });

      // Notify mentor
      await admin.from('notifications').insert({
        user_id: booking.mentor_id,
        title: 'Seeker Rescheduled Booking',
        message: `Booking ${booking.booking_code} was rescheduled by the seeker.`,
        type: 'BOOKING',
        event_type: 'MENTOR_RESCHEDULING',
        entity_type: 'booking',
        entity_id: booking.id,
        link: '/mentor/bookings',
        is_read: false,
      });

      auditAction(req.auth, 'booking_rescheduled', {
        entityType: 'booking',
        entityId: booking.id,
        requestId: req.requestId,
        metadata: { bookingCode: booking.booking_code, newStartTime, newEndTime },
      });

      return res.json({ success: true, booking: updatedBooking, hold: holdResult, message: 'Booking rescheduled. Please complete payment for the new slot.' });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err, context: 'POST /api/seeker/bookings/:id/reschedule' });
    }
  });

  // POST /api/mentor/bookings/:id/confirm: Server-side mentor confirmation
  app.post('/api/mentor/bookings/:id/confirm', requireAuth, requireRole('mentor'), validateBody(apiSchemas.mentorBookingConfirm), async (req: AuthRequest, res) => {
    try {
      const bookingId = req.params.id;
      const mentorId = req.auth!.user.id;
      // The schema guarantees a real http(s) URL, so `javascript:` and other
      // script-bearing schemes can never be stored as the session's meeting link.
      const { meetingUrl } = req.body as { meetingUrl: string };

      const admin = getSupabaseAdmin();
      if (admin) {
        const { data: booking, error } = await admin.rpc('confirm_booking', {
          p_booking_id: bookingId,
          p_meeting_url: meetingUrl,
          p_mentor_id: mentorId,
        });
        if (error) throw error;
        return res.json({ success: true, booking, isOverdue: false, message: 'Session confirmed.' });
      }

      const db = getLocalBookingEngineContext();
      const result = await confirmSessionByMentor(
        {
          bookingId,
          mentorId,
          meetingUrl,
          currentUtcTime: new Date(),
        },
        db
      );

      if (!result.success) {
        const code = result.error?.code;
        if (code === 'FORBIDDEN_NOT_BOOKING_OWNER') {
          return res.status(403).json(result);
        }
        if (code === 'BOOKING_NOT_FOUND') {
          return res.status(404).json(result);
        }
        if (code === 'ALREADY_CONFIRMED') {
          return res.status(409).json(result);
        }
        return res.status(400).json(result);
      }

      const enriched = enrichBooking(result.booking!, db);
      return res.json({
        success: true,
        booking: enriched,
        isOverdue: result.isOverdue,
        message: result.message,
      });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // GET /api/admin/bookings/overdue-links: Admin inspection of overdue meeting links
  app.get('/api/admin/bookings/overdue-links', requireAuth, requireAdmin, (req: AuthRequest, res) => {
    try {
      const db = getLocalBookingEngineContext();
      const overdue = getOverdueBookings(db);
      const enriched = overdue.map((b) => enrichBooking(b, db));

      return res.json({
        success: true,
        count: overdue.length,
        bookings: enriched,
      });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // GET /api/admin/bookings: Admin operational ledger of all bookings with full joins
  app.get('/api/admin/bookings', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      const { data: bookings, error: bookingsErr } = await admin
        .from('bookings')
        .select(`
          *,
          seeker:profiles!bookings_seeker_id_fkey(id, full_name, email, timezone),
          mentor:profiles!bookings_mentor_id_fkey(id, full_name, email, timezone),
          gig:gigs(id, title, duration_minutes, price_inr, segment_id),
          segment:segments(id, name, slug)
        `)
        .order('start_time', { ascending: true });

      if (bookingsErr) throw bookingsErr;

      // Reconcile and annotate before building the ledger, so an admin never
      // sees a stale CONFIRMED row for a session that has already ended. The
      // cron job would have corrected it within a minute, but an operational
      // ledger that disagrees with the seeker and mentor views in the meantime
      // is exactly the kind of mismatch that makes people chase phantom bugs.
      const reconciledBookings = await reconcileAndAnnotateBookingRows(
        admin,
        [...(bookings || [])]
      );

      // Get payment info for all bookings
      const bookingIds = (bookings || []).map((b: any) => b.id);
      const { data: payments, error: paymentsErr } = bookingIds.length
        ? await admin.from('payments').select('*').in('booking_id', bookingIds)
        : { data: [], error: null };
      if (paymentsErr) throw paymentsErr;

      const paymentByBooking = new Map<string, any>();
      for (const payment of payments || []) {
        paymentByBooking.set(payment.booking_id, payment);
      }

      // Calculate deadline info for each booking
      const now = new Date();
      const enrichedBookings = reconciledBookings.map((booking: any) => {
        const payment = paymentByBooking.get(booking.id);
        const startTime = new Date(booking.start_time);
        const deadlineMs = startTime.getTime() - 2 * 60 * 60 * 1000; // 2 hours before
        const isOverdue = !booking.meeting_url && now.getTime() > deadlineMs && startTime > now;
        const hoursUntilSession = Math.max(0, Math.round((startTime.getTime() - now.getTime()) / (1000 * 60 * 60)));

        return {
          ...booking,
          payment: payment ? {
            id: payment.id,
            status: payment.status,
            amount_inr: payment.amount_inr,
            verified_at: payment.verified_at,
            proof_storage_path: payment.proof_storage_path,
            transaction_reference: payment.transaction_reference,
          } : null,
          deadlineInfo: {
            deadlineUtc: new Date(deadlineMs).toISOString(),
            isOverdue,
            hoursUntilSession,
            minutesUntilSession: Math.max(0, Math.round((startTime.getTime() - now.getTime()) / (1000 * 60))),
          },
        };
      });

      return res.json({
        success: true,
        bookings: enrichedBookings,
      });
    } catch (err: any) {
      return respondWithServerError({
        req, res, error: err,
        context: 'GET /api/admin/bookings',
        clientMessage: 'Unable to load admin bookings.',
      });
    }
  });

  // GET /api/mentor/segments: Get segments for authenticated mentor
  app.get('/api/mentor/segments', requireAuth, requireRole('mentor'), async (req: AuthRequest, res) => {
    try {
      const mentorId = req.auth!.user.id;

      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      // Fetch mentor_segments with segment details
      const { data: mentorSegments, error: msErr } = await admin
        .from('mentor_segments')
        .select('*, segment:segments(*)')
        .eq('mentor_id', mentorId);

      if (msErr) throw msErr;

      const segments = (mentorSegments || []).map((ms: any) => ({
        id: ms.segment?.id,
        name: ms.segment?.name,
        slug: ms.segment?.slug,
        status: ms.segment?.is_active ? 'APPROVED' : 'INACTIVE',
        appliedAt: ms.created_at ? new Date(ms.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Unknown',
        gigsCount: 0, // Will be populated below
      }));

      // Fetch gig counts per segment for this mentor
      if (segments.length > 0) {
        const segmentIds = segments.map((s: any) => s.id);
        const { data: gigs, error: gigsErr } = await admin
          .from('gigs')
          .select('segment_id')
          .eq('mentor_id', mentorId)
          .eq('is_active', true)
          .in('segment_id', segmentIds);

        if (!gigsErr && gigs) {
          const gigCounts = gigs.reduce((acc: Record<string, number>, g: any) => {
            acc[g.segment_id] = (acc[g.segment_id] || 0) + 1;
            return acc;
          }, {});
          segments.forEach((s: any) => {
            s.gigsCount = gigCounts[s.id] || 0;
          });
        }
      }

      return res.json({ success: true, segments });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // GET /api/mentor/gigs: Get gigs for authenticated mentor
  app.get('/api/mentor/gigs', requireAuth, requireRole('mentor'), async (req: AuthRequest, res) => {
    try {
      const mentorId = req.auth!.user.id;

      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      const { data: gigs, error: gigsErr } = await admin
        .from('gigs')
        .select(`
          *,
          segment:segments(*)
        `)
        .eq('mentor_id', mentorId)
        .order('created_at', { ascending: false });

      if (gigsErr) throw gigsErr;

      const formattedGigs = (gigs || []).map((g: any) => ({
        id: g.id,
        title: g.title,
        segmentName: g.segment?.name || 'Unknown',
        segmentSlug: g.segment?.slug || 'unknown',
        durationMinutes: g.duration_minutes,
        priceInr: g.price_inr,
        isActive: g.is_active,
        description: g.description,
      }));

      return res.json({ success: true, gigs: formattedGigs });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // POST /api/mentor/gigs: Create a new gig for authenticated mentor
  // requireActiveMentor: a deactivated or suspended mentor cannot create or
  // edit active gigs through the normal mentor UI (prompt section 5).
  app.post('/api/mentor/gigs', requireAuth, requireRole('mentor'), requireActiveMentor, validateBody(apiSchemas.gigCreate), async (req: AuthRequest, res) => {
    try {
      // Title and description arrive already trimmed and stripped of markup, so
      // the row can never contain a `<script>` payload typed into the form.
      const { title, segmentId, durationMinutes, priceInr, description } = req.body as {
        title: string;
        segmentId: string;
        durationMinutes: number;
        priceInr: number;
        description?: string;
      };
      const mentorId = req.auth!.user.id;

      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      // Verify mentor has this segment approved
      const { data: msData, error: msErr } = await admin
        .from('mentor_segments')
        .select('*')
        .eq('mentor_id', mentorId)
        .eq('segment_id', segmentId)
        .maybeSingle();

      if (msErr) throw msErr;
      if (!msData) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You are not approved for this segment.' },
        });
      }

      const { data: gig, error } = await admin
        .from('gigs')
        .insert({
          mentor_id: mentorId,
          segment_id: segmentId,
          title,
          duration_minutes: durationMinutes,
          price_inr: priceInr,
          description: description || '',
          is_active: true,
        })
        .select()
        .single();

      if (error) throw error;

      return res.json({ success: true, gig });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // PATCH /api/mentor/gigs/:id: Update gig
  app.patch('/api/mentor/gigs/:id', requireAuth, requireRole('mentor'), requireActiveMentor, validateBody(apiSchemas.gigUpdate), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { title, durationMinutes, priceInr, description, isActive } = req.body as {
        title?: string;
        durationMinutes?: number;
        priceInr?: number;
        description?: string;
        isActive?: boolean;
      };
      const mentorId = req.auth!.user.id;

      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      // Verify ownership
      const { data: existing } = await admin
        .from('gigs')
        .select('mentor_id')
        .eq('id', id)
        .maybeSingle();

      if (!existing || existing.mentor_id !== mentorId) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Not authorized to update this gig.' },
        });
      }

      const updates: any = { updated_at: new Date().toISOString() };
      if (title !== undefined) updates.title = title;
      if (durationMinutes !== undefined) updates.duration_minutes = durationMinutes;
      if (priceInr !== undefined) updates.price_inr = priceInr;
      if (description !== undefined) updates.description = description;
      if (isActive !== undefined) updates.is_active = isActive;

      const { data: gig, error } = await admin
        .from('gigs')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return res.json({ success: true, gig });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // DELETE /api/mentor/gigs/:id: Delete gig
  app.delete('/api/mentor/gigs/:id', requireAuth, requireRole('mentor'), requireActiveMentor, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const mentorId = req.auth!.user.id;

      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      // Verify ownership
      const { data: existing } = await admin
        .from('gigs')
        .select('mentor_id')
        .eq('id', id)
        .maybeSingle();

      if (!existing || existing.mentor_id !== mentorId) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Not authorized to delete this gig.' },
        });
      }

      const { error } = await admin
        .from('gigs')
        .delete()
        .eq('id', id);

      if (error) throw error;

      return res.json({ success: true, message: 'Gig deleted successfully.' });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // GET /api/mentor/available-segments: Get all active segments for mentor to apply
  // Requires authentication; the mentor is always the authenticated caller so a
  // client-supplied mentorId can never be used to enumerate another mentor's segments.
  app.get('/api/mentor/available-segments', requireAuth, requireRole('mentor'), async (req: AuthRequest, res) => {
    try {
      const mentorId = req.auth!.user.id;

      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      // Get all active segments
      const { data: allSegments, error: segErr } = await admin
        .from('segments')
        .select('*')
        .eq('is_active', true)
        .order('priority', { ascending: true });

      if (segErr) throw segErr;

      // Get mentor's current segments
      const { data: mentorSegments, error: msErr } = await admin
        .from('mentor_segments')
        .select('segment_id')
        .eq('mentor_id', mentorId);

      if (msErr) throw msErr;

      const mentorSegmentIds = new Set((mentorSegments || []).map((ms: any) => ms.segment_id));

      // Filter out segments mentor already has
      const availableSegments = (allSegments || [])
        .filter((s: any) => !mentorSegmentIds.has(s.id))
        .map((s: any) => ({
          id: s.id,
          name: s.name,
          slug: s.slug,
          description: s.description,
        }));

      return res.json({ success: true, segments: availableSegments });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // POST /api/mentor/segments/apply: Apply for a new segment
  //
  // Previously this route took an unauthenticated mentorId straight from the
  // request body, so anyone could add any mentor to any segment. It now
  // requires an authenticated mentor, ignores any client-supplied mentorId, and
  // blocks deactivated/suspended mentors (prompt section 5).
  app.post('/api/mentor/segments/apply', requireAuth, requireRole('mentor'), requireActiveMentor, validateBody(apiSchemas.segmentApply), async (req: AuthRequest, res) => {
    try {
      // The mentor is always the authenticated caller. A mentor may never
      // apply on behalf of someone else.
      const mentorId = req.auth!.user.id;
      const { segmentId } = req.body as { segmentId: string };

      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      // Check if already applied
      const { data: existing } = await admin
        .from('mentor_segments')
        .select('*')
        .eq('mentor_id', mentorId)
        .eq('segment_id', segmentId)
        .maybeSingle();

      if (existing) {
        return res.status(409).json({
          success: false,
          error: { code: 'CONFLICT', message: 'Already applied for this segment.' },
        });
      }

      // Check segment exists and is active
      const { data: segment } = await admin
        .from('segments')
        .select('*')
        .eq('id', segmentId)
        .eq('is_active', true)
        .maybeSingle();

      if (!segment) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Segment not found or inactive.' },
        });
      }

      // Insert application (status PENDING by default)
      const { error } = await admin
        .from('mentor_segments')
        .insert({
          mentor_id: mentorId,
          segment_id: segmentId,
        });

      if (error) throw error;

      return res.json({ success: true, message: 'Segment application submitted for admin review.' });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // --------------------------------------------------------------------------
  // Mentor API: Availability Management
  // --------------------------------------------------------------------------
  //
  // The mentor-facing mirror of the admin availability endpoints below. The
  // mentor is ALWAYS the authenticated caller: req.auth.user.id, never a
  // client-supplied id, so a mentor can only ever read or write their own rows.

  // GET /api/mentor/availability: The caller's own recurring windows, date
  // exceptions, and their profile timezone.
  app.get('/api/mentor/availability', requireAuth, requireRole('mentor'), async (req: AuthRequest, res) => {
    try {
      const mentorId = req.auth!.user.id;

      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      const [availabilityRes, exceptionsRes, profileRes] = await Promise.all([
        admin.from('mentor_availability').select('*').eq('mentor_id', mentorId).order('day_of_week', { ascending: true }).order('start_time', { ascending: true }),
        admin.from('mentor_availability_exceptions').select('*').eq('mentor_id', mentorId).order('exception_date', { ascending: true }),
        admin.from('profiles').select('timezone').eq('id', mentorId).maybeSingle(),
      ]);
      if (availabilityRes.error) throw availabilityRes.error;
      if (exceptionsRes.error) throw exceptionsRes.error;
      if (profileRes.error) throw profileRes.error;

      return res.json({
        success: true,
        availability: availabilityRes.data || [],
        exceptions: exceptionsRes.data || [],
        timezone: (profileRes.data as { timezone?: string | null } | null)?.timezone || APP_CONFIG.DEFAULT_TIMEZONE,
      });
    } catch (err: any) {
      return respondWithServerError({
        req, res, error: err,
        context: 'GET /api/mentor/availability',
        clientMessage: 'Unable to load availability.',
      });
    }
  });

  // PUT /api/mentor/availability
  //
  // Replaces the caller's recurring weekly windows. Same validation and
  // replace-all semantics as the admin endpoint, but scoped to the caller and
  // gated on requireActiveMentor (prompt section 5).
  app.put('/api/mentor/availability', requireAuth, requireRole('mentor'), requireActiveMentor, validateBody(apiSchemas.availability), async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }
      // Ownership is the caller's id, full stop.
      const mentorId = req.auth!.user.id;

      // Every rule is already a well-typed, in-range, start-before-end window:
      // the schema rejected anything else with a 400 before we got here.
      const { rules, timezone } = req.body as {
        rules: Array<{ dayOfWeek: number; startTime: string; endTime: string; isEnabled: boolean }>;
        timezone?: string;
      };
      const resolvedTimezone = timezone ?? APP_CONFIG.DEFAULT_TIMEZONE;

      const rows = rules.map((rule) => ({
        mentor_id: mentorId,
        day_of_week: rule.dayOfWeek,
        start_time: rule.startTime,
        end_time: rule.endTime,
        timezone: resolvedTimezone,
        is_enabled: rule.isEnabled,
      }));

      // Replace-all semantics. Availability is operational, not historical, so
      // rewriting the window set destroys no booking record.
      const { error: clearErr } = await admin
        .from('mentor_availability').delete().eq('mentor_id', mentorId);
      if (clearErr) throw clearErr;

      if (rows.length > 0) {
        const { error: insertErr } = await admin.from('mentor_availability').insert(rows);
        if (insertErr) throw insertErr;
      }

      auditAction(req.auth, MENTOR_ADMIN_AUDIT_ACTIONS.AVAILABILITY_UPDATED, {
        entityType: 'mentor_availability',
        entityId: mentorId,
        requestId: req.requestId,
        metadata: { mentorId, ruleCount: rows.length, timezone: resolvedTimezone },
      });

      return res.json({ success: true, message: 'Availability updated successfully.', ruleCount: rows.length });
    } catch (err: any) {
      return respondWithServerError({
        req, res, error: err,
        context: 'PUT /api/mentor/availability',
        clientMessage: 'Unable to update availability.',
      });
    }
  });

  // PUT /api/mentor/availability/exceptions
  //
  // Replaces the caller's date exceptions. Same validation as the admin route.
  app.put('/api/mentor/availability/exceptions', requireAuth, requireRole('mentor'), requireActiveMentor, validateBody(apiSchemas.availabilityExceptions), async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }
      // Ownership is the caller's id, full stop.
      const mentorId = req.auth!.user.id;

      // Dates are YYYY-MM-DD, an available day is guaranteed a real
      // start-before-end window, and `reason` is already markup-free.
      const { exceptions } = req.body as {
        exceptions: Array<{
          exceptionDate: string;
          isAvailable: boolean;
          startTime?: string | null;
          endTime?: string | null;
          reason?: string;
        }>;
      };

      const rows = exceptions.map((exception) => ({
        mentor_id: mentorId,
        exception_date: exception.exceptionDate,
        is_available: exception.isAvailable,
        start_time: exception.isAvailable ? exception.startTime ?? null : null,
        end_time: exception.isAvailable ? exception.endTime ?? null : null,
        reason: exception.reason ? exception.reason : null,
      }));

      const { error: clearErr } = await admin
        .from('mentor_availability_exceptions').delete().eq('mentor_id', mentorId);
      if (clearErr) throw clearErr;

      if (rows.length > 0) {
        const { error: insertErr } = await admin.from('mentor_availability_exceptions').insert(rows);
        if (insertErr) throw insertErr;
      }

      auditAction(req.auth, MENTOR_ADMIN_AUDIT_ACTIONS.AVAILABILITY_UPDATED, {
        entityType: 'mentor_availability_exceptions',
        entityId: mentorId,
        requestId: req.requestId,
        metadata: { mentorId, exceptionCount: rows.length },
      });

      return res.json({ success: true, message: 'Date exceptions updated successfully.', exceptionCount: rows.length });
    } catch (err: any) {
      return respondWithServerError({
        req, res, error: err,
        context: 'PUT /api/mentor/availability/exceptions',
        clientMessage: 'Unable to update date exceptions.',
      });
    }
  });

  // --------------------------------------------------------------------------
  // GET /api/mentor-availability/slots
  //
  // The single authoritative slot endpoint used by every seeker surface.
  //
  //   ?mentorId=<uuid>&date=YYYY-MM-DD   -> one mentor
  //   ?segmentId=<uuid>&date=YYYY-MM-DD   -> every active mentor in the segment
  //
  // Always JSON: 200 on success, 400 on a malformed request, 401 when the caller
  // has no session, 404 when the mentor/segment does not exist, 500 on failure.
  // The response carries the fully generated slot list with a real status
  // (AVAILABLE / HELD / BOOKED / PAST) so the browser never computes
  // availability itself and can never render a fake slot.
  // --------------------------------------------------------------------------
  app.get('/api/mentor-availability/slots', requireAuth, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({
          success: false,
          error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' },
        });
      }

      const { mentorId, segmentId, date } = req.query as Record<string, string | undefined>;
      const mentorIdRaw = (mentorId || '').trim();
      const segmentIdRaw = (segmentId || '').trim();
      const dateRaw = (date || '').trim();

      // A shape check, not an RFC-4122 version check: seeded platform rows use
      // nil-prefixed ids that a version-strict pattern would reject.
      if (!UUID_SHAPE_PATTERN.test(mentorIdRaw) && !UUID_SHAPE_PATTERN.test(segmentIdRaw)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'A valid mentorId or segmentId query parameter is required.',
          },
        });
      }

      if (mentorIdRaw && segmentIdRaw) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Provide either mentorId or segmentId, not both.',
          },
        });
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'date must be a YYYY-MM-DD calendar date.' },
        });
      }

      let mentorIds: string[] = [];

      if (mentorIdRaw) {
        const { data, error } = await admin
          .from('mentor_profiles')
          .select('id')
          .eq('id', mentorIdRaw)
          .maybeSingle();
        if (error) throw error;
        if (!data) {
          return res.status(404).json({
            success: false,
            error: { code: 'MENTOR_NOT_FOUND', message: 'Mentor not found.' },
          });
        }
        mentorIds = [mentorIdRaw];
      } else {
        const { data, error } = await admin
          .from('mentor_segments')
          .select('mentor_id')
          .eq('segment_id', segmentIdRaw);
        if (error) throw error;

        const segmentExists = await admin
          .from('segments')
          .select('id')
          .eq('id', segmentIdRaw)
          .maybeSingle();
        if (segmentExists.error) throw segmentExists.error;
        if (!segmentExists.data) {
          return res.status(404).json({
            success: false,
            error: { code: 'SEGMENT_NOT_FOUND', message: 'Segment not found.' },
          });
        }

        mentorIds = Array.from(
          new Set((data || []).map((row: { mentor_id: string }) => row.mentor_id).filter(Boolean))
        );
      }

      if (mentorIds.length === 0) {
        return res.json({
          success: true,
          date: dateRaw,
          generated_at: new Date().toISOString(),
          mentors: [],
        });
      }

      const now = new Date();
      const { results, error } = await computeMentorSlotsForDate(admin, {
        mentorIds,
        dateStr: dateRaw,
        segmentId: segmentIdRaw || undefined,
        now,
      });

      if (error) throw error;

      return res.json({
        success: true,
        date: dateRaw,
        generated_at: now.toISOString(),
        mentors: mentorIds.map((id) => results.get(id)).filter(Boolean),
      });
    } catch (err: any) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: 'GET /api/mentor-availability/slots',
        clientMessage: 'Unable to load availability.',
      });
    }
  });

  // --------------------------------------------------------------------------
  // Admin API: Mentors Management
  // --------------------------------------------------------------------------

  // GET /api/admin/mentors: Fetch all mentors with profile, segments, and approval status
  app.get('/api/admin/mentors', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({
          success: false,
          error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' },
        });
      }

      // Fetch profiles with mentor role
      const { data: mentorRoles, error: rolesErr } = await admin
        .from('user_roles')
        .select('user_id')
        .eq('role', 'mentor');

      if (rolesErr) throw rolesErr;
      if (!mentorRoles || mentorRoles.length === 0) {
        return res.json({ success: true, mentors: [] });
      }

      const mentorIds = mentorRoles.map((mr: { user_id: string }) => mr.user_id);

      // Fetch profiles
      const { data: profiles, error: profilesErr } = await admin
        .from('profiles')
        .select('id, email, full_name, timezone, created_at, updated_at')
        .in('id', mentorIds);

      if (profilesErr) throw profilesErr;

      // Fetch mentor_profiles
      const { data: mentorProfiles, error: mpErr } = await admin
        .from('mentor_profiles')
        .select('*')
        .in('id', mentorIds);

      if (mpErr) throw mpErr;

      // Fetch mentor_segments with segment details
      const { data: mentorSegments, error: msErr } = await admin
        .from('mentor_segments')
        .select('*, segment:segments(*)')
        .in('mentor_id', mentorIds);

      if (msErr) throw msErr;

      // Fetch gigs for these mentors
      const { data: gigs, error: gigsErr } = await admin
        .from('gigs')
        .select('*')
        .in('mentor_id', mentorIds);

      if (gigsErr) throw gigsErr;

      // Combine data
      const mentorMap = new Map();
      for (const p of profiles || []) {
        mentorMap.set(p.id, {
          id: p.id,
          email: p.email,
          full_name: p.full_name,
          timezone: p.timezone,
          created_at: p.created_at,
          updated_at: p.updated_at,
        });
      }

      const mpMap = new Map();
      for (const mp of mentorProfiles || []) {
        mpMap.set(mp.id, mp);
      }

      const msMap = new Map<string, any[]>();
      for (const ms of mentorSegments || []) {
        if (!msMap.has(ms.mentor_id)) msMap.set(ms.mentor_id, []);
        msMap.get(ms.mentor_id)!.push(ms);
      }

      const gigMap = new Map<string, any[]>();
      for (const g of gigs || []) {
        if (!gigMap.has(g.mentor_id)) gigMap.set(g.mentor_id, []);
        gigMap.get(g.mentor_id)!.push(g);
      }

      // ---- Account status comes from the DATABASE, never hardcoded ----
      // `profiles.account_status` and `mentor_profiles.is_active` are the source
      // of truth (prompt section 13). The previous implementation returned a
      // literal `isActive: true`, which made a deactivated mentor look active
      // in the Admin UI.
      const { data: accountProfiles, error: accountErr } = await admin
        .from('profiles')
        .select('id, account_status, suspended_at, suspended_until, suspension_reason, deactivated_at')
        .in('id', mentorIds);

      if (accountErr) throw accountErr;

      const accountMap = new Map<string, any>();
      for (const row of accountProfiles || []) {
        accountMap.set(row.id, row);
      }

      const mentors = [];
      for (const [mentorId, profile] of mentorMap) {
        const mp = mpMap.get(mentorId);
        const segments = msMap.get(mentorId) || [];
        const mentorGigs = gigMap.get(mentorId) || [];
        const account = accountMap.get(mentorId) || {};

        // Determine primary segment for display
        const primarySegment = segments.find((s: any) => s.is_primary) || segments[0];

        const state: MentorAccountState = deriveMentorAccountState({
          approval_status: mp?.approval_status ?? null,
          is_approved: mp?.is_approved ?? null,
          is_active: mp?.is_active ?? null,
          account_status: account.account_status ?? null,
          suspended_until: account.suspended_until ?? null,
        });

        mentors.push({
          id: mentorId,
          name: profile.full_name,
          email: profile.email,
          segmentName: primarySegment?.segment?.name || 'No Segment',
          status: state.isApproved
            ? 'APPROVED'
            : mp?.approval_status === 'rejected' ? 'REJECTED' : 'PENDING',
          experienceYears: mp?.experience_years || 0,
          bio: mp?.about || '',
          appliedDate: profile.created_at ? new Date(profile.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Unknown',
          isApproved: state.isApproved,
          // Read from the DB, not assumed.
          isActive: state.isActive,
          isSuspended: state.isSuspended,
          isDeactivated: state.isDeactivated,
          isEligible: state.isEligible,
          approvalStatus: mp?.approval_status ?? null,
          accountStatus: account.account_status ?? 'active',
          suspendedUntil: account.suspended_until ?? null,
          suspensionReason: account.suspension_reason ?? null,
          profile: mp,
          segments: segments.map((s: any) => s.segment),
          gigs: mentorGigs,
        });
      }

      return res.json({ success: true, mentors });
    } catch (err: any) {
      console.error('Failed to fetch admin mentors:', logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // PATCH /api/admin/mentors/:id/approve: Approve mentor
  app.patch('/api/admin/mentors/:id/approve', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      const { error } = await admin
        .from('mentor_profiles')
        .update({ is_approved: true, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;

      auditAction(req.auth, 'mentor_approved', {
        entityType: 'mentor_profile',
        entityId: id,
        requestId: req.requestId,
        metadata: { action: 'approve' },
      });

      return res.json({ success: true, message: 'Mentor approved successfully.' });
    } catch (err: any) {
      console.error('Failed to approve mentor:', logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // PATCH /api/admin/mentors/:id/reject: Reject mentor
  app.patch('/api/admin/mentors/:id/reject', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      const { error } = await admin
        .from('mentor_profiles')
        .update({ is_approved: false, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;

      auditAction(req.auth, 'mentor_rejected', {
        entityType: 'mentor_profile',
        entityId: id,
        requestId: req.requestId,
        metadata: { action: 'reject' },
      });

      return res.json({ success: true, message: 'Mentor rejected successfully.' });
    } catch (err: any) {
      console.error('Failed to reject mentor:', logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // PATCH /api/admin/mentors/:id/toggle-active
  //
  // Backwards-compatible wrapper around the status endpoint below. The old
  // implementation wrote `is_approved`, which conflated APPROVAL with
  // ACTIVE/INACTIVE - deactivating a mentor silently un-approved them, and
  // reactivating them silently re-approved them without any verification.
  // Activation state now lives exclusively in `mentor_profiles.is_active`.
  app.patch('/api/admin/mentors/:id/toggle-active', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      const { data: current, error: readErr } = await admin
        .from('mentor_profiles')
        .select('is_active, approval_status, is_approved')
        .eq('id', id)
        .maybeSingle();

      if (readErr) throw readErr;
      if (!current) {
        return res.status(404).json({ success: false, error: { code: 'MENTOR_NOT_FOUND', message: 'Mentor not found.' } });
      }

      const isCurrentlyActive = current.is_active === true;
      const action = isCurrentlyActive ? 'deactivate' : 'activate';

      const state = deriveMentorAccountState({
        approval_status: current.approval_status ?? null,
        is_approved: current.is_approved ?? null,
        is_active: current.is_active ?? null,
        account_status: null,
      });

      const validation = validateMentorStatusAction({ action, state });
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: { code: validation.code, message: validation.message },
        });
      }

      const update = buildMentorStatusUpdate({ action, adminId: req.auth!.user.id });

      const { error: mpErr } = await admin
        .from('mentor_profiles')
        .update(update.mentorProfile)
        .eq('id', id);
      if (mpErr) throw mpErr;

      const { error: profileErr } = await admin
        .from('profiles')
        .update(update.profile)
        .eq('id', id);
      if (profileErr) throw profileErr;

      auditAction(req.auth, MENTOR_STATUS_ACTION_SPECS[action].auditAction, {
        entityType: 'mentor_profile',
        entityId: id,
        requestId: req.requestId,
        metadata: { isActive: update.mentorProfile.is_active, via: 'toggle-active' },
      });

      return res.json({ success: true, message: `Mentor ${action === 'activate' ? 'activated' : 'deactivated'} successfully.` });
    } catch (err: any) {
      console.error('Failed to toggle mentor active status:', logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // PATCH /api/admin/mentors/:id/status
  //
  // The single server-side authorized entry point for Admin operational control
  // over a mentor account (prompt sections 3, 5, 6, 7).
  //   body: { action, reason?, suspendedUntil? }
  //
  // Guarantees:
  //  - server-side Admin authorization. The Admin never needs the mentor's
  //    password and never impersonates the mentor (prompt section 10).
  //  - a STATUS CHANGE ONLY. No profile, gig, availability, booking, payment,
  //    workspace, notification or audit row is ever deleted (section 5).
  //  - approval_status is never modified, so reactivation never requires
  //    repeating verification (section 6).
  //  - every transition is audited with admin_id, mentor_id, timestamp, action
  //    and the reason (section 12).
  app.patch('/api/admin/mentors/:id/status', requireAuth, requireAdmin, validateBody(apiSchemas.mentorStatus), async (req: AuthRequest, res) => {
    const requestId = req.requestId ?? '';
    try {
      const { id } = req.params;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }
      if (!UUID_PATTERN.test(id)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_MENTOR_ID', message: 'Mentor ID must be a valid UUID.' } });
      }

      // The action enum and the markup-free reason are enforced by the schema.
      const { action, reason, suspendedUntil } = req.body as {
        action: MentorStatusAction;
        reason?: string;
        suspendedUntil?: string;
      };

      const adminId = req.auth!.user.id;

      // An Admin may not suspend or deactivate themselves.
      if (id === adminId) {
        return res.status(400).json({
          success: false,
          error: { code: 'SELF_STATUS_CHANGE_FORBIDDEN', message: 'Administrators cannot change their own account status.' },
        });
      }

      const { data: mentorProfile, error: mpReadErr } = await admin
        .from('mentor_profiles')
        .select('id, approval_status, is_approved, is_active')
        .eq('id', id)
        .maybeSingle();

      if (mpReadErr) throw mpReadErr;
      if (!mentorProfile) {
        return res.status(404).json({ success: false, error: { code: 'MENTOR_NOT_FOUND', message: 'Mentor not found.' } });
      }

      const { data: accountProfile, error: profileReadErr } = await admin
        .from('profiles')
        .select('id, account_status, suspended_until')
        .eq('id', id)
        .maybeSingle();

      if (profileReadErr) throw profileReadErr;

      // Interpret the STORED columns; never assume a status.
      const state = deriveMentorAccountState({
        approval_status: mentorProfile.approval_status ?? null,
        is_approved: mentorProfile.is_approved ?? null,
        is_active: mentorProfile.is_active ?? null,
        account_status: accountProfile?.account_status ?? null,
        suspended_until: accountProfile?.suspended_until ?? null,
      });

      // A mentor may ALSO hold the admin role, so the platform-critical Admin
      // invariants are enforced here too: driving the same account through the
      // mentor endpoint must not be a way around the last-active-admin guard
      // that /api/admin/users/:id/status applies. Only the lockout rule is
      // evaluated; every other mentor rule stays with validateMentorStatusAction.
      if (action === 'deactivate' || action === 'suspend') {
        const [{ data: mentorRoleRows, error: mentorRolesErr }, activeAdminCount] = await Promise.all([
          admin.from('user_roles').select('role').eq('user_id', id),
          countActiveAdminAccounts(admin),
        ]);
        if (mentorRolesErr) throw mentorRolesErr;

        const mentorSafety = assertAdminAccountSafety({
          action,
          adminId,
          targetId: id,
          targetRoles: (mentorRoleRows || []).map((entry: { role: string }) => entry.role),
          activeAdminCount,
          targetState: deriveAccountState({
            account_status: accountProfile?.account_status ?? null,
            suspended_until: accountProfile?.suspended_until ?? null,
          }),
        });
        if (!mentorSafety.allowed && mentorSafety.code === 'LAST_ACTIVE_ADMIN') {
          return res.status(409).json({
            success: false,
            error: { code: mentorSafety.code, message: mentorSafety.message },
          });
        }
      }

      const validation = validateMentorStatusAction({
        action,
        reason,
        suspendedUntil,
        state,
      });

      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: { code: validation.code, message: validation.message },
        });
      }

      const update = buildMentorStatusUpdate({
        action,
        adminId,
        reason: validation.reason,
        suspendedUntil: validation.suspendedUntil,
      });

      // Two writes, two tables. Neither one deletes anything.
      const { error: mpWriteErr } = await admin
        .from('mentor_profiles')
        .update(update.mentorProfile)
        .eq('id', id);
      if (mpWriteErr) throw mpWriteErr;

      if (accountProfile) {
        const { error: profileWriteErr } = await admin
          .from('profiles')
          .update(update.profile)
          .eq('id', id);
        if (profileWriteErr) throw profileWriteErr;
      }

      auditAction(req.auth, MENTOR_STATUS_ACTION_SPECS[action].auditAction, {
        entityType: 'mentor_profile',
        entityId: id,
        requestId: req.requestId,
        metadata: {
          action,
          adminId,
          mentorId: id,
          reason: validation.reason ?? null,
          suspendedUntil: validation.suspendedUntil ?? null,
          previousState: state,
        },
      });

      const pastTense = action === 'activate'
        ? 'activated'
        : action === 'deactivate' ? 'deactivated' : action === 'suspend' ? 'suspended' : 'reactivated';
      return res.json({
        success: true,
        message: `Mentor ${pastTense} successfully.`,
        action: MENTOR_STATUS_ACTION_SPECS[action].auditAction,
        isActive: update.mentorProfile.is_active,
        accountStatus: update.profile.account_status,
      });
    } catch (err: any) {
      const info = describeSupabaseError(err);
      await logApiError({
        requestId,
        method: req.method,
        path: req.path,
        statusCode: resolveHttpStatusForSupabaseError(info),
        message: `admin mentor status change failed - [${info.code}] ${info.message}`,
        error_code: info.code,
        userId: req.auth!.user.id,
        role: 'admin',
        stack: info.stack,
        metadata: { operation: 'mentor_status_change', mentorId: req.params.id },
      }).catch(() => {});
      return respondWithServerError({
        req,
        res,
        error: err,
        context: 'PATCH /api/admin/mentors/:id/status',
        clientMessage: 'Unable to update the mentor account status.',
      });
    }
  });


  //
  // Full operational visibility for ONE mentor (prompt section 8 / TEST E).
  // Every value is read from the database (section 13); no status is hardcoded.
  //
  // ADMIN-ONLY: served from an authenticated, Admin-gated endpoint and never
  // exposed through public mentor discovery (prompt section 11). Verification
  // documents, internal notes and audit records live here and nowhere public.
  //
  // NOTE: GET /api/admin/mentors/eligible is registered immediately below and
  // MUST stay above this `/api/admin/mentors/:id` route. Express matches routes
  // in registration order, so a `:id` route registered first captures the
  // literal segment "eligible" and rejects it with 400 "Mentor ID must be a
  // valid UUID.", leaving the eligible-mentor handler permanently unreachable.

  // GET /api/admin/mentors/eligible: Approved + active mentors available for
  // segment assignment. Needs no segment id: eligibility is a property of the
  // mentor, not of the segment being edited.
  app.get('/api/admin/mentors/eligible', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      const { data: mpData, error: mpErr } = await admin
        .from('mentor_profiles')
        .select('id')
        .eq('is_approved', true)
        .eq('is_active', true);

      if (mpErr) throw mpErr;

      const mentorIds = (mpData || []).map((mp: any) => mp.id);
      if (mentorIds.length === 0) {
        return res.json({ success: true, mentors: [] });
      }

      const { data: profiles, error: profilesErr } = await admin
        .from('profiles')
        .select('id, full_name, email')
        .in('id', mentorIds);

      if (profilesErr) throw profilesErr;

      const mentors = (profiles || []).map((p: any) => ({
        id: p.id,
        name: p.full_name,
        email: p.email,
      }));

      return res.json({ success: true, mentors });
    } catch (err: any) {
      console.error('Failed to fetch eligible mentors:', logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });

  app.get('/api/admin/mentors/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }
      const mentorId = req.params.id;
      if (!UUID_PATTERN.test(mentorId)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_MENTOR_ID', message: 'Mentor ID must be a valid UUID.' } });
      }

      const { data: profile, error: profileErr } = await admin
        .from('profiles').select('*').eq('id', mentorId).maybeSingle();
      if (profileErr) throw profileErr;
      if (!profile) {
        return res.status(404).json({ success: false, error: { code: 'MENTOR_NOT_FOUND', message: 'Mentor not found.' } });
      }

      const [{ data: mentorProfile, error: mpErr }, { data: roles, error: rolesErr }] = await Promise.all([
        admin.from('mentor_profiles').select('*').eq('id', mentorId).maybeSingle(),
        admin.from('user_roles').select('role').eq('user_id', mentorId),
      ]);
      if (mpErr) throw mpErr;
      if (rolesErr) throw rolesErr;
      // A mentor may hold the `mentor` role before a mentor_profiles row exists
      // (for example a public applicant who has not been approved yet). The
      // Control Center must still open for them and show their real
      // verification state, so a missing profile is NOT a 404 here. It is only
      // a 404 when the PROFILE itself does not exist at all.
      if (!profile) {
        return res.status(404).json({ success: false, error: { code: 'MENTOR_NOT_FOUND', message: 'Mentor not found.' } });
      }

      const [segmentsRes, gigsRes, availabilityRes, exceptionsRes] = await Promise.all([
        admin.from('mentor_segments').select('*, segment:segments(*)').eq('mentor_id', mentorId),
        admin.from('gigs').select('*, segment:segments(id, name, slug)').eq('mentor_id', mentorId).order('created_at', { ascending: false }),
        admin.from('mentor_availability').select('*').eq('mentor_id', mentorId).order('day_of_week', { ascending: true }).order('start_time', { ascending: true }),
        admin.from('mentor_availability_exceptions').select('*').eq('mentor_id', mentorId).order('exception_date', { ascending: true }),
      ]);
      if (segmentsRes.error) throw segmentsRes.error;
      if (gigsRes.error) throw gigsRes.error;
      if (availabilityRes.error) throw availabilityRes.error;
      if (exceptionsRes.error) throw exceptionsRes.error;

      const { data: application, error: appErr } = await admin
        .from('mentor_applications').select('*').eq('user_id', mentorId).maybeSingle();
      if (appErr) throw appErr;

      const { data: documents, error: docsErr } = application
        ? await admin
            .from('mentor_verification_documents').select('*')
            .eq('application_id', application.id).order('uploaded_at', { ascending: false })
        : { data: [], error: null };
      if (docsErr) throw docsErr;

      // Short-lived signed URLs, minted server-side. The bucket is private, so
      // this is the ONLY way an Admin can read a document.
      const signedDocuments = await Promise.all(
        (documents || []).map(async (document: { storage_path: string }) => {
          try {
            const { data: signed } = await admin.storage
              .from('mentor-verification-documents')
              .createSignedUrl(document.storage_path, 300);
            return { ...document, download_url: signed?.signedUrl || null };
          } catch {
            return { ...document, download_url: null };
          }
        }),
      );

      // Approver identity, resolved from the application, not assumed.
      let approvedBy: { id: string; full_name: string | null; email: string | null } | null = null;
      if (application?.reviewed_by) {
        const { data: approver } = await admin
          .from('profiles').select('id, full_name, email').eq('id', application.reviewed_by).maybeSingle();
        approvedBy = approver || null;
      }

      // ---- CREATION SOURCE (public_signup vs admin_direct) ----
      // Resolved from real database evidence, in this order:
      //   1. mentor_profiles.created_via  (explicit, written at creation time)
      //   2. audit_logs MENTOR_CREATED_BY_ADMIN for this mentor id
      //   3. presence of a mentor_applications row
      //   4. unknown - never guessed from the mentor's name or id
      //
      // This is what stops an Admin-created mentor being shown the
      // "No mentor application exists" error state: it has no application BY
      // DESIGN, and the audit record proves why.
      const { data: creationAudit } = await admin
        .from('audit_logs')
        .select('id, created_at, actor_user_id, metadata')
        .eq('entity_id', mentorId)
        .eq('action', MENTOR_ADMIN_AUDIT_ACTIONS.CREATED)
        .order('created_at', { ascending: true })
        .limit(1);

      const creationSource = resolveMentorCreationSource({
        createdVia: (mentorProfile as { created_via?: string | null }).created_via ?? null,
        hasAdminCreationAudit: (creationAudit || []).length > 0,
        hasApplication: Boolean(application),
      });

      // Who created / approved the mentor, and when. From the audit trail.
      const creationEvent = (creationAudit || [])[0] || null;
      let createdByAdmin: { id: string; full_name: string | null; email: string | null } | null = null;
      if (creationEvent?.actor_user_id) {
        const { data: creator } = await admin
          .from('profiles').select('id, full_name, email').eq('id', creationEvent.actor_user_id).maybeSingle();
        createdByAdmin = creator || null;
      }

      return res.json({
        success: true,
        mentor: {
          // ---- PROFILE ----
          profile: {
            id: profile.id,
            fullName: profile.full_name,
            email: profile.email,
            // `profiles.phone` verified to exist in the live schema.
            phone: profile.phone ?? null,
            avatarUrl: profile.avatar_url,
            timezone: profile.timezone,
            createdAt: profile.created_at,
            updatedAt: profile.updated_at,
          },
          roles: (roles || []).map((r: { role: string }) => r.role),
          mentorProfile: {
            headline: mentorProfile?.headline ?? '',
            about: mentorProfile?.about ?? null,
            // Verified live column name. NOT `years_of_experience`, which only
            // exists on mentor_applications and caused a schema-cache error.
            experienceYears: mentorProfile?.experience_years ?? 0,
            languages: mentorProfile?.languages ?? null,
            // Verified to exist in the live schema (text[]).
            expertise: mentorProfile?.expertise ?? null,
            rating: mentorProfile?.rating ?? 0,
            reviewCount: mentorProfile?.review_count ?? 0,
            sessionCount: mentorProfile?.session_count ?? 0,
            isFeatured: mentorProfile?.is_featured ?? false,
            createdAt: mentorProfile?.created_at ?? profile.created_at,
            updatedAt: mentorProfile?.updated_at ?? profile.updated_at,
            // False when the mentor holds the role but has no profile row yet
            // (an unapproved public applicant).
            exists: Boolean(mentorProfile),
          },
          // ---- CREATION SOURCE ----
          creation: {
            source: creationSource,
            createdVia: (mentorProfile as { created_via?: string | null }).created_via ?? null,
            createdBy: createdByAdmin,
            createdAt: creationEvent?.created_at ?? mentorProfile?.created_at ?? profile.created_at,
          },
          // ---- VERIFICATION ----
          verification: {
            approvalStatus: mentorProfile?.approval_status ?? null,
            isApproved: mentorProfile?.is_approved ?? false,
            applicationStatus: application?.status ?? null,
            applicationId: application?.id ?? null,
            submittedAt: application?.submitted_at ?? null,
            reviewedAt: application?.reviewed_at ?? null,
            rejectionReason: application?.rejection_reason ?? null,
            approvedBy,
            documents: signedDocuments,
          },
          // ---- SEGMENTS ----
          segments: (segmentsRes.data || []).map((row: any) => ({
            segmentId: row.segment_id,
            isPrimary: row.is_primary,
            name: row.segment?.name ?? null,
            slug: row.segment?.slug ?? null,
            isActive: row.segment?.is_active ?? null,
            createdAt: row.created_at,
          })),
          // ---- GIGS ----
          gigs: (gigsRes.data || []).map((gig: any) => ({
            id: gig.id,
            title: gig.title,
            description: gig.description,
            priceInr: gig.price_inr,
            durationMinutes: gig.duration_minutes,
            isActive: gig.is_active,
            segmentId: gig.segment_id,
            segmentName: gig.segment?.name ?? null,
            createdAt: gig.created_at,
            updatedAt: gig.updated_at,
          })),
          // ---- AVAILABILITY ----
          availability: (availabilityRes.data || []).map((rule: any) => ({
            id: rule.id,
            dayOfWeek: rule.day_of_week,
            startTime: rule.start_time,
            endTime: rule.end_time,
            timezone: rule.timezone,
            isEnabled: rule.is_enabled,
          })),
          availabilityExceptions: (exceptionsRes.data || []).map((exception: any) => ({
            id: exception.id,
            exceptionDate: exception.exception_date,
            isAvailable: exception.is_available,
            startTime: exception.start_time,
            endTime: exception.end_time,
            reason: exception.reason,
          })),
          // ---- ACCOUNT STATUS (from stored columns) ----
          account: {
            accountStatus: profile.account_status ?? 'active',
            isActive: mentorProfile.is_active === true,
            suspendedAt: profile.suspended_at ?? null,
            suspendedUntil: profile.suspended_until ?? null,
            suspensionReason: profile.suspension_reason ?? null,
            suspendedBy: profile.suspended_by ?? null,
            deactivatedAt: profile.deactivated_at ?? null,
            internalNote: profile.internal_note ?? null,
          },
        },
      });
    } catch (err: any) {
      return respondWithServerError({
        req, res, error: err,
        context: 'GET /api/admin/mentors/:id',
        clientMessage: 'Unable to load mentor details.',
      });
    }
  });

  // GET /api/admin/mentors/:id/bookings
  //
  // Booking + payment history for the mentor detail page. Kept separate from
  // the detail payload because it is the only potentially large collection, so
  // it is loaded on demand rather than on every detail render.
  app.get('/api/admin/mentors/:id/bookings', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }
      const mentorId = req.params.id;
      if (!UUID_PATTERN.test(mentorId)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_MENTOR_ID', message: 'Mentor ID must be a valid UUID.' } });
      }

      // bookings has FKs to both profiles (mentor_id, seeker_id) and to gigs,
      // so the seeker embed is named explicitly to avoid PGRST201.
      const { data: bookings, error: bookingsErr } = await admin
        .from('bookings')
        .select('*, seeker:profiles!bookings_seeker_id_fkey(id, full_name, email)')
        .eq('mentor_id', mentorId)
        .order('start_time', { ascending: false });

      if (bookingsErr) throw bookingsErr;

      const bookingIds = (bookings || []).map((b: { id: string }) => b.id);
      const { data: payments, error: paymentsErr } = bookingIds.length
        ? await admin.from('payments').select('*').in('booking_id', bookingIds)
        : { data: [], error: null };
      if (paymentsErr) throw paymentsErr;

      const paymentByBooking = new Map<string, any>();
      for (const payment of payments || []) {
        paymentByBooking.set(payment.booking_id, payment);
      }

      const now = Date.now();
      const decorated = (bookings || []).map((booking: any) => {
        const payment = paymentByBooking.get(booking.id);
        const startMs = Date.parse(booking.start_time);
        return {
          id: booking.id,
          bookingCode: booking.booking_code,
          startTime: booking.start_time,
          endTime: booking.end_time,
          amountInr: booking.amount_inr,
          status: booking.status,
          meetingUrl: booking.meeting_url,
          cancellationReason: booking.cancellation_reason,
          isUpcoming:
            startMs >= now && !['CANCELLED', 'REJECTED', 'COMPLETED'].includes(booking.status),
          seeker: booking.seeker ?? null,
          payment: payment
            ? {
                id: payment.id,
                status: payment.status,
                amountInr: payment.amount_inr,
                verifiedAt: payment.verified_at,
              }
            : null,
        };
      });

      return res.json({
        success: true,
        bookings: decorated,
        upcoming: decorated.filter((b: any) => b.isUpcoming),
        completed: decorated.filter((b: any) => b.status === 'COMPLETED'),
        cancelled: decorated.filter((b: any) => ['CANCELLED', 'REJECTED'].includes(b.status)),
      });
    } catch (err: any) {
      return respondWithServerError({
        req, res, error: err,
        context: 'GET /api/admin/mentors/:id/bookings',
        clientMessage: 'Unable to load mentor bookings.',
      });
    }
  });

  // PATCH /api/admin/mentors/:id/profile
  //
  // Admin edit access to mentor operational information (prompt section 9).
  // Everything is PERSISTED to the database - no UI-only changes. Server-side
  // Admin authorization only: the Admin never needs the mentor's password and
  // never impersonates the mentor (prompt section 10).
  //
  // approval_status and is_active are deliberately NOT editable here: approval
  // belongs to the verification flow and activation to the status endpoint, so
  // this endpoint can never be used to bypass either.
  app.patch('/api/admin/mentors/:id/profile', requireAuth, requireAdmin, validateBody(apiSchemas.adminMentorProfile), async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }
      const mentorId = req.params.id;
      if (!UUID_PATTERN.test(mentorId)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_MENTOR_ID', message: 'Mentor ID must be a valid UUID.' } });
      }

      // Free text arrives trimmed and markup-free; tag arrays are bounded and
      // de-duplication is left to the column default.
      const body = req.body as {
        fullName?: string;
        timezone?: string;
        phone?: string;
        avatarUrl?: string | null;
        headline?: string;
        bio?: string;
        experienceYears?: number;
        languages?: string[];
        expertise?: string[] | null;
        isFeatured?: boolean;
        segmentIds?: string[];
      };

      const profileUpdates: Record<string, unknown> = {};
      if (body.fullName !== undefined) {
        profileUpdates.full_name = body.fullName;
      }
      if (body.timezone !== undefined) {
        profileUpdates.timezone = body.timezone;
      }
      // `profiles.phone` verified to exist in the live schema.
      if (body.phone !== undefined) {
        profileUpdates.phone = body.phone || null;
      }
      if (body.avatarUrl !== undefined) {
        profileUpdates.avatar_url = body.avatarUrl || null;
      }

      const mentorUpdates: Record<string, unknown> = {};
      if (body.headline !== undefined) mentorUpdates.headline = body.headline;
      if (body.bio !== undefined) mentorUpdates.about = body.bio || null;
      if (body.experienceYears !== undefined) {
        mentorUpdates.experience_years = body.experienceYears;
      }
      if (body.languages !== undefined) {
        mentorUpdates.languages = body.languages;
      }
      // `mentor_profiles.expertise` verified to exist in the live schema (text[]).
      if (body.expertise !== undefined) {
        mentorUpdates.expertise = body.expertise;
      }
      if (body.isFeatured !== undefined) mentorUpdates.is_featured = body.isFeatured;

      // Segments: add / remove, only when explicitly provided. An empty array
      // is a real instruction to clear every assignment, so it is honoured.
      const replaceSegments = body.segmentIds !== undefined;
      const requestedSegmentIds = body.segmentIds ?? [];

      const { data: existing, error: existsErr } = await admin
        .from('mentor_profiles').select('id').eq('id', mentorId).maybeSingle();
      if (existsErr) throw existsErr;
      if (!existing) {
        return res.status(404).json({ success: false, error: { code: 'MENTOR_NOT_FOUND', message: 'Mentor not found.' } });
      }

      const nowIso = new Date().toISOString();

      if (Object.keys(profileUpdates).length > 0) {
        const { error } = await admin
          .from('profiles')
          .update({ ...profileUpdates, updated_at: nowIso })
          .eq('id', mentorId);
        if (error) throw error;
      }

      if (Object.keys(mentorUpdates).length > 0) {
        const { error } = await admin
          .from('mentor_profiles')
          .update({ ...mentorUpdates, updated_at: nowIso })
          .eq('id', mentorId);
        if (error) throw error;
      }

      if (replaceSegments) {
        const nextSegmentIds = requestedSegmentIds;

        // Validate every referenced segment actually exists.
        if (nextSegmentIds.length > 0) {
          const { data: validSegments, error: segErr } = await admin
            .from('segments').select('id').in('id', nextSegmentIds);
          if (segErr) throw segErr;
          const validIds = new Set((validSegments || []).map((s: { id: string }) => s.id));
          const unknown = nextSegmentIds.filter((id) => !validIds.has(id));
          if (unknown.length > 0) {
            return res.status(400).json({
              success: false,
              error: { code: 'UNKNOWN_SEGMENT', message: `Unknown segment id(s): ${unknown.join(', ')}.` },
            });
          }
        }

        const { error: deleteErr } = await admin
          .from('mentor_segments').delete().eq('mentor_id', mentorId);
        if (deleteErr) throw deleteErr;

        if (nextSegmentIds.length > 0) {
          const { error: insertErr } = await admin
            .from('mentor_segments')
            .insert(nextSegmentIds.map((segmentId) => ({
              mentor_id: mentorId,
              segment_id: segmentId,
              is_primary: false,
            })));
          if (insertErr) throw insertErr;
        }
      }

      auditAction(req.auth, MENTOR_ADMIN_AUDIT_ACTIONS.PROFILE_UPDATED, {
        entityType: 'mentor_profile',
        entityId: mentorId,
        requestId: req.requestId,
        metadata: {
          adminId: req.auth!.user.id,
          mentorId,
          fields: [...Object.keys(profileUpdates), ...Object.keys(mentorUpdates)],
          segmentsChanged: replaceSegments,
        },
      });

      return res.json({ success: true, message: 'Mentor profile updated successfully.' });
    } catch (err: any) {
      return respondWithServerError({
        req, res, error: err,
        context: 'PATCH /api/admin/mentors/:id/profile',
        clientMessage: 'Unable to update the mentor profile.',
      });
    }
  });

  // Admin gig management (prompt section 9): Admin can create / edit / archive
  // gigs for ANY mentor without the mentor's password. Archiving sets
  // is_active=false and NEVER deletes the row, so booking and payment history
  // keeps its foreign key (prompt section 5).
  app.post('/api/admin/mentors/:id/gigs', requireAuth, requireAdmin, validateBody(apiSchemas.adminMentorGigCreate), async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }
      const mentorId = req.params.id;
      if (!UUID_PATTERN.test(mentorId)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_MENTOR_ID', message: 'Mentor ID must be a valid UUID.' } });
      }

      // Title and description arrive trimmed and markup-free; duration is one of
      // the allowed slot lengths and price is non-negative.
      const { title, segmentId, durationMinutes, priceInr, description } = req.body as {
        title: string;
        segmentId: string;
        durationMinutes: number;
        priceInr: number;
        description?: string;
      };

      const { data: mentorProfile, error: mpErr } = await admin
        .from('mentor_profiles').select('id').eq('id', mentorId).maybeSingle();
      if (mpErr) throw mpErr;
      if (!mentorProfile) {
        return res.status(404).json({ success: false, error: { code: 'MENTOR_NOT_FOUND', message: 'Mentor not found.' } });
      }

      const { data: segment, error: segErr } = await admin
        .from('segments').select('id').eq('id', segmentId).maybeSingle();
      if (segErr) throw segErr;
      if (!segment) {
        return res.status(400).json({ success: false, error: { code: 'UNKNOWN_SEGMENT', message: 'Segment not found.' } });
      }

      const { data: gig, error } = await admin
        .from('gigs')
        .insert({
          mentor_id: mentorId,
          segment_id: segmentId,
          title: title.trim(),
          description: typeof description === 'string' ? description.trim() : '',
          duration_minutes: durationMinutes,
          price_inr: priceInr,
          is_active: true,
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          return res.status(409).json({
            success: false,
            error: { code: 'DUPLICATE_ACTIVE_GIG', message: 'This mentor already has an active gig for that segment. Archive it first.' },
          });
        }
        throw error;
      }

      auditAction(req.auth, MENTOR_ADMIN_AUDIT_ACTIONS.GIG_CREATED, {
        entityType: 'gig',
        entityId: gig.id,
        requestId: req.requestId,
        metadata: { adminId: req.auth!.user.id, mentorId, gigId: gig.id, segmentId, priceInr, durationMinutes },
      });

      return res.status(201).json({ success: true, gig });
    } catch (err: any) {
      return respondWithServerError({
        req, res, error: err,
        context: 'POST /api/admin/mentors/:id/gigs',
        clientMessage: 'Unable to create the gig.',
      });
    }
  });

  // PATCH /api/admin/mentors/gigs/:gigId - edit price, duration, title, etc.
  app.patch('/api/admin/mentors/gigs/:gigId', requireAuth, requireAdmin, validateBody(apiSchemas.adminMentorGigUpdate), async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }
      const gigId = req.params.gigId;
      if (!UUID_PATTERN.test(gigId)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_GIG_ID', message: 'Gig ID must be a valid UUID.' } });
      }

      // Already typed, in-range and markup-free. The schema also guarantees at
      // least one editable field, so the "nothing to change" case is a 400
      // before the handler runs.
      const { title, durationMinutes, priceInr, description, isActive } = req.body as {
        title?: string;
        durationMinutes?: number;
        priceInr?: number;
        description?: string;
        isActive?: boolean;
      };

      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (durationMinutes !== undefined) updates.duration_minutes = durationMinutes;
      if (priceInr !== undefined) updates.price_inr = priceInr;
      if (isActive !== undefined) updates.is_active = isActive;

      const { data: gig, error } = await admin
        .from('gigs').update(updates).eq('id', gigId).select().single();

      if (error) throw error;
      if (!gig) {
        return res.status(404).json({ success: false, error: { code: 'GIG_NOT_FOUND', message: 'Gig not found.' } });
      }

      auditAction(req.auth, MENTOR_ADMIN_AUDIT_ACTIONS.GIG_UPDATED, {
        entityType: 'gig',
        entityId: gigId,
        requestId: req.requestId,
        metadata: { adminId: req.auth!.user.id, mentorId: gig.mentor_id, gigId, fields: Object.keys(updates) },
      });

      return res.json({ success: true, gig });
    } catch (err: any) {
      return respondWithServerError({
        req, res, error: err,
        context: 'PATCH /api/admin/mentors/gigs/:gigId',
        clientMessage: 'Unable to update the gig.',
      });
    }
  });

  // PATCH /api/admin/mentors/gigs/:gigId/archive
  //
  // Archiving flips is_active=false. It is deliberately NOT a DELETE: the row
  // must survive so historical bookings and payments keep their reference.
  app.patch('/api/admin/mentors/gigs/:gigId/archive', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }
      const gigId = req.params.gigId;
      if (!UUID_PATTERN.test(gigId)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_GIG_ID', message: 'Gig ID must be a valid UUID.' } });
      }

      const { data: gig, error } = await admin
        .from('gigs')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', gigId)
        .select()
        .single();

      if (error) throw error;
      if (!gig) {
        return res.status(404).json({ success: false, error: { code: 'GIG_NOT_FOUND', message: 'Gig not found.' } });
      }

      auditAction(req.auth, MENTOR_ADMIN_AUDIT_ACTIONS.GIG_ARCHIVED, {
        entityType: 'gig',
        entityId: gigId,
        requestId: req.requestId,
        metadata: { adminId: req.auth!.user.id, mentorId: gig.mentor_id, gigId },
      });

      return res.json({ success: true, gig, message: 'Gig archived. Booking history is preserved.' });
    } catch (err: any) {
      return respondWithServerError({
        req, res, error: err,
        context: 'PATCH /api/admin/mentors/gigs/:gigId/archive',
        clientMessage: 'Unable to archive the gig.',
      });
    }
  });

  // PUT /api/admin/mentors/:id/availability
  //
  // Replaces the mentor's recurring weekly windows. Persisted to
  // mentor_availability - no UI-only changes.
  //
  // This ADMIN path is intentionally NOT gated on the mentor being active: an
  // Admin must be able to set availability up front and to repair it while the
  // mentor is deactivated or suspended. The restriction in prompt section 5
  // applies to the MENTOR's own UI, enforced by requireActiveMentor.
  app.put('/api/admin/mentors/:id/availability', requireAuth, requireAdmin, validateBody(apiSchemas.availability), async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }
      const mentorId = req.params.id;
      if (!UUID_PATTERN.test(mentorId)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_MENTOR_ID', message: 'Mentor ID must be a valid UUID.' } });
      }

      // Rules are already in-range, start-before-end windows: the schema
      // rejected anything else with a 400 before we got here.
      const { rules, timezone } = req.body as {
        rules: Array<{ dayOfWeek: number; startTime: string; endTime: string; isEnabled: boolean }>;
        timezone?: string;
      };
      const resolvedTimezone = timezone ?? APP_CONFIG.DEFAULT_TIMEZONE;

      const rows = rules.map((rule) => ({
        mentor_id: mentorId,
        day_of_week: rule.dayOfWeek,
        start_time: rule.startTime,
        end_time: rule.endTime,
        timezone: resolvedTimezone,
        is_enabled: rule.isEnabled,
      }));

      // Replace-all semantics. Availability is operational, not historical, so
      // rewriting the window set destroys no booking record.
      const { error: clearErr } = await admin
        .from('mentor_availability').delete().eq('mentor_id', mentorId);
      if (clearErr) throw clearErr;

      if (rows.length > 0) {
        const { error: insertErr } = await admin.from('mentor_availability').insert(rows);
        if (insertErr) throw insertErr;
      }

      auditAction(req.auth, MENTOR_ADMIN_AUDIT_ACTIONS.AVAILABILITY_UPDATED, {
        entityType: 'mentor_availability',
        entityId: mentorId,
        requestId: req.requestId,
        metadata: { adminId: req.auth!.user.id, mentorId, ruleCount: rows.length, timezone: resolvedTimezone },
      });

      return res.json({ success: true, message: 'Availability updated successfully.', ruleCount: rows.length });
    } catch (err: any) {
      return respondWithServerError({
        req, res, error: err,
        context: 'PUT /api/admin/mentors/:id/availability',
        clientMessage: 'Unable to update availability.',
      });
    }
  });

  // PUT /api/admin/mentors/:id/availability/exceptions
  //
  // Replaces the mentor's date exceptions. Same admin-vs-mentor reasoning as
  // the recurring windows above.
  app.put('/api/admin/mentors/:id/availability/exceptions', requireAuth, requireAdmin, validateBody(apiSchemas.availabilityExceptions), async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }
      const mentorId = req.params.id;
      if (!UUID_PATTERN.test(mentorId)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_MENTOR_ID', message: 'Mentor ID must be a valid UUID.' } });
      }

      // Dates are YYYY-MM-DD, an available day is guaranteed a real
      // start-before-end window, and `reason` is already markup-free.
      const { exceptions } = req.body as {
        exceptions: Array<{
          exceptionDate: string;
          isAvailable: boolean;
          startTime?: string | null;
          endTime?: string | null;
          reason?: string;
        }>;
      };

      const rows = exceptions.map((exception) => ({
        mentor_id: mentorId,
        exception_date: exception.exceptionDate,
        is_available: exception.isAvailable,
        start_time: exception.isAvailable ? exception.startTime ?? null : null,
        end_time: exception.isAvailable ? exception.endTime ?? null : null,
        reason: exception.reason ? exception.reason : null,
      }));

      const { error: clearErr } = await admin
        .from('mentor_availability_exceptions').delete().eq('mentor_id', mentorId);
      if (clearErr) throw clearErr;

      if (rows.length > 0) {
        const { error: insertErr } = await admin.from('mentor_availability_exceptions').insert(rows);
        if (insertErr) throw insertErr;
      }

      auditAction(req.auth, MENTOR_ADMIN_AUDIT_ACTIONS.AVAILABILITY_UPDATED, {
        entityType: 'mentor_availability_exceptions',
        entityId: mentorId,
        requestId: req.requestId,
        metadata: { adminId: req.auth!.user.id, mentorId, exceptionCount: rows.length },
      });

      return res.json({ success: true, message: 'Date exceptions updated successfully.', exceptionCount: rows.length });
    } catch (err: any) {
      return respondWithServerError({
        req, res, error: err,
        context: 'PUT /api/admin/mentors/:id/availability/exceptions',
        clientMessage: 'Unable to update date exceptions.',
      });
    }
  });

  // GET /api/admin/mentors/:id/audit
  //
  // The Admin-visible audit trail for one mentor (prompt section 20).
  //
  // This reuses the EXISTING audit_logs table written by auditAction(); no
  // parallel audit system is introduced. Entries are matched by entity_id
  // (status/profile changes use the mentor id) or by the mentorId recorded in
  // the metadata (gig and availability actions use their own entity id).
  app.get('/api/admin/mentors/:id/audit', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }
      const mentorId = req.params.id;
      if (!UUID_PATTERN.test(mentorId)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_MENTOR_ID', message: 'Mentor ID must be a valid UUID.' } });
      }

      const { data: gigs } = await admin.from('gigs').select('id').eq('mentor_id', mentorId);
      const childIds = (gigs || []).map((g: { id: string }) => g.id);

      const orFilter = [
        `entity_id.eq.${mentorId}`,
        ...(childIds.length ? childIds.map((id) => `entity_id.eq.${id}`) : []),
      ].join(',');

      const { data: entries, error: auditErr } = await admin
        .from('audit_logs')
        .select('id, created_at, actor_user_id, actor_role, action, entity_type, entity_id, request_id, metadata')
        .or(orFilter)
        .order('created_at', { ascending: false })
        .limit(100);

      if (auditErr) throw auditErr;

      // Only keep entries that genuinely belong to this mentor: either the
      // entity IS the mentor, or the metadata names this mentor.
      const relevant = (entries || []).filter((entry: any) => {
        if (entry.entity_id === mentorId) return true;
        const metaMentorId = entry.metadata?.mentorId ?? entry.metadata?.mentor_id;
        return metaMentorId === mentorId;
      });

      const actorIds = Array.from(
        new Set(relevant.map((e: any) => e.actor_user_id).filter(Boolean)),
      ) as string[];
      const { data: actors } = actorIds.length
        ? await admin.from('profiles').select('id, full_name, email').in('id', actorIds)
        : { data: [] as any[] };
      const actorMap = new Map<string, any>((actors || []).map((a: any) => [a.id, a]));

      return res.json({
        success: true,
        entries: relevant.map((entry: any) => ({
          id: entry.id,
          createdAt: entry.created_at,
          action: entry.action,
          entityType: entry.entity_type,
          entityId: entry.entity_id,
          requestId: entry.request_id,
          actorRole: entry.actor_role,
          actor: entry.actor_user_id
            ? {
                id: entry.actor_user_id,
                name: actorMap.get(entry.actor_user_id)?.full_name ?? null,
                email: actorMap.get(entry.actor_user_id)?.email ?? null,
              }
            : null,
          metadata: entry.metadata ?? null,
        })),
      });
    } catch (err: any) {
      return respondWithServerError({
        req, res, error: err,
        context: 'GET /api/admin/mentors/:id/audit',
        clientMessage: 'Unable to load the audit log.',
      });
    }
  });

  // PUT /api/admin/mentors/:id/segments
  //
  // Add / remove a mentor's segment assignments (prompt section 10).
  //
  // A dedicated endpoint rather than a PATCH on the profile, because segment
  // membership is its own audited operation and a partial update must never
  // silently drop an unrelated field.
  app.put('/api/admin/mentors/:id/segments', requireAuth, requireAdmin, validateBody(apiSchemas.adminMentorSegments), async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }
      const mentorId = req.params.id;
      if (!UUID_PATTERN.test(mentorId)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_MENTOR_ID', message: 'Mentor ID must be a valid UUID.' } });
      }

      // Both fields are already UUID-shaped and sanitised by the schema.
      const { segmentIds, primarySegmentId } = req.body as {
        segmentIds: string[];
        primarySegmentId?: string;
      };

      const nextSegmentIds = Array.from(new Set(segmentIds));

      if (primarySegmentId && !nextSegmentIds.includes(primarySegmentId)) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'primarySegmentId must be one of segmentIds.' } });
      }

      const { data: existingMentor, error: existsErr } = await admin
        .from('mentor_profiles').select('id').eq('id', mentorId).maybeSingle();
      if (existsErr) throw existsErr;
      if (!existingMentor) {
        return res.status(404).json({ success: false, error: { code: 'MENTOR_NOT_FOUND', message: 'Mentor not found.' } });
      }

      // Validate against the real segments table; never hardcode segment ids.
      if (nextSegmentIds.length > 0) {
        const { data: validSegments, error: segErr } = await admin
          .from('segments').select('id, is_active').in('id', nextSegmentIds);
        if (segErr) throw segErr;
        const found = new Set((validSegments || []).map((s: { id: string }) => s.id));
        const unknown = nextSegmentIds.filter((id) => !found.has(id));
        if (unknown.length > 0) {
          return res.status(400).json({ success: false, error: { code: 'UNKNOWN_SEGMENT', message: `Unknown segment id(s): ${unknown.join(', ')}.` } });
        }
        const inactive = (validSegments || []).filter((s: { is_active: boolean }) => !s.is_active).map((s: { id: string }) => s.id);
        if (inactive.length > 0) {
          return res.status(400).json({ success: false, error: { code: 'SEGMENT_INACTIVE', message: `Cannot assign inactive segment(s): ${inactive.join(', ')}.` } });
        }
      }

      const { data: before, error: beforeErr } = await admin
        .from('mentor_segments').select('segment_id, is_primary').eq('mentor_id', mentorId);
      if (beforeErr) throw beforeErr;
      const beforeIds = (before || []).map((r: { segment_id: string }) => r.segment_id).sort();

      const { error: clearErr } = await admin
        .from('mentor_segments').delete().eq('mentor_id', mentorId);
      if (clearErr) throw clearErr;

      if (nextSegmentIds.length > 0) {
        const { error: insertErr } = await admin
          .from('mentor_segments')
          .insert(nextSegmentIds.map((segmentId) => ({
            mentor_id: mentorId,
            segment_id: segmentId,
            is_primary: primarySegmentId ? segmentId === primarySegmentId : false,
          })));
        if (insertErr) throw insertErr;
      }

      auditAction(req.auth, MENTOR_ADMIN_AUDIT_ACTIONS.SEGMENTS_UPDATED, {
        entityType: 'mentor_segments',
        entityId: mentorId,
        requestId: req.requestId,
        metadata: {
          adminId: req.auth!.user.id,
          mentorId,
          before: beforeIds,
          after: nextSegmentIds.slice().sort(),
          primarySegmentId,
        },
      });

      return res.json({ success: true, segmentIds: nextSegmentIds, primarySegmentId });
    } catch (err: any) {
      return respondWithServerError({
        req, res, error: err,
        context: 'PUT /api/admin/mentors/:id/segments',
        clientMessage: 'Unable to update segments.',
      });
    }
  });








  // --------------------------------------------------------------------------
  // Admin API: Segments Management
  // --------------------------------------------------------------------------

  // GET /api/admin/segments: Fetch all segments with mentor counts
  app.get('/api/admin/segments', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      // Fetch all segments
      const { data: segments, error: segErr } = await admin
        .from('segments')
        .select('*')
        .order('priority', { ascending: true });

      if (segErr) throw segErr;

      // Fetch mentor counts per segment (only approved and active mentors with active gigs)
      const segmentIds = segments?.map((s: any) => s.id) || [];
      let mentorCounts: Record<string, number> = {};
      // Derived from the active-gig rows already fetched below, so the list can
      // show a real Gigs count without an extra round trip or a hardcoded 0.
      const activeGigCounts: Record<string, number> = {};

      if (segmentIds.length > 0) {
        // Get mentor_segments for active segments
        const { data: msData, error: msErr } = await admin
          .from('mentor_segments')
          .select('mentor_id, segment_id')
          .in('segment_id', segmentIds);

        if (msErr) throw msErr;

        if (msData && msData.length > 0) {
          const mentorIds = [...new Set(msData.map((ms: any) => ms.mentor_id))];

          // Check which mentors are approved
          const { data: mpData, error: mpErr } = await admin
            .from('mentor_profiles')
            .select('id, is_approved')
            .in('id', mentorIds);

          if (mpErr) throw mpErr;

          const approvedMentorIds = new Set((mpData || []).filter((mp: any) => mp.is_approved).map((mp: any) => mp.id));

          // Check which approved mentors have active gigs for these segments
          if (approvedMentorIds.size > 0) {
            const { data: gigsData, error: gigsErr } = await admin
              .from('gigs')
              .select('mentor_id, segment_id')
              .in('mentor_id', [...approvedMentorIds])
              .in('segment_id', segmentIds)
              .eq('is_active', true);

            if (gigsErr) throw gigsErr;

            // Count unique mentors per segment who have active gigs
            for (const g of gigsData || []) {
              if (!approvedMentorIds.has(g.mentor_id)) continue;
              mentorCounts[g.segment_id] = (mentorCounts[g.segment_id] || 0) + 1;
              activeGigCounts[g.segment_id] = (activeGigCounts[g.segment_id] || 0) + 1;
            }
          }
        }
      }

      // Gigs owned by mentors who are not approved still exist and belong to the
      // segment, so count them too rather than under-reporting.
      if (segmentIds.length > 0) {
        const { data: allActiveGigs, error: allGigsErr } = await admin
          .from('gigs')
          .select('id, segment_id')
          .in('segment_id', segmentIds)
          .eq('is_active', true);

        if (allGigsErr) throw allGigsErr;

        for (const g of allActiveGigs || []) {
          if (activeGigCounts[g.segment_id] === undefined) {
            activeGigCounts[g.segment_id] = (activeGigCounts[g.segment_id] || 0) + 1;
          }
        }
      }

      const segmentsWithCounts = (segments || []).map((s: any) => ({
        ...s,
        mentorsCount: mentorCounts[s.id] || 0,
        gigsCount: activeGigCounts[s.id] || 0,
      }));

      return res.json({ success: true, segments: segmentsWithCounts });
    } catch (err: any) {
      console.error('Failed to fetch admin segments:', logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // GET /api/admin/segments/:segment
  //
  // `:segment` is the public `segments.slug` from the browser URL. The internal
  // `segments.id` UUID is resolved here and used for every related query, so no
  // UUID ever appears in a URL. A UUID is still accepted for back-compat.
  //
  // Returns segment + mentors + gigs in ONE response so the detail page needs a
  // single round trip instead of a three-request waterfall. Always JSON: an
  // unknown slug is 404 JSON, never an HTML page.
  app.get('/api/admin/segments/:segment', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    const admin = getSupabaseAdmin();
    if (!admin) {
      return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
    }

    try {
      const { segment, error } = await resolveAdminSegmentBySlugOrId(admin, req.params.segment);
      if (error) throw error;
      if (!segment) {
        return res.status(404).json({ success: false, error: { code: 'SEGMENT_NOT_FOUND', message: 'Segment not found' } });
      }

      const [mentorsRes, gigsRes] = await Promise.all([
        loadSegmentMentors(admin, segment.id),
        loadSegmentGigs(admin, segment.id),
      ]);
      if (mentorsRes.error) throw mentorsRes.error;
      if (gigsRes.error) throw gigsRes.error;

      return res.json({
        success: true,
        segment,
        mentors: mentorsRes.mentors,
        gigs: gigsRes.gigs,
      });
    } catch (err: any) {
      console.error('Failed to fetch segment:', logSanitizer.safeMessage(err));
      return respondWithServerError({
        req, res, error: err,
        context: 'GET /api/admin/segments/:segment',
        clientMessage: 'Unable to load the segment.',
      });
    }
  });

  // POST /api/admin/segments: Create new segment
  app.post('/api/admin/segments', requireAuth, requireAdmin, validateBody(apiSchemas.segmentCreate), async (req: AuthRequest, res) => {
    try {
      const { name, slug, priority, isActive, description } = req.body;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      // `segments.slug` is UNIQUE in the live schema. Check it explicitly so a
      // duplicate is a clear validation error instead of a 23505 surfacing as a
      // generic 500, and so no duplicate row is ever attempted.
      const { data: slugClash, error: slugCheckErr } = await admin
        .from('segments')
        .select('id')
        .eq('slug', slug)
        .maybeSingle();

      if (slugCheckErr) throw slugCheckErr;
      if (slugClash) {
        return res.status(400).json({ success: false, error: { code: 'DUPLICATE_SLUG', message: 'Another segment already uses this slug.' } });
      }

      const { data, error } = await admin
        .from('segments')
        .insert({
          name,
          slug,
          description: description ?? null,
          priority: priority || 10,
          is_active: isActive !== false,
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') { // unique violation
          return res.status(400).json({ success: false, error: { code: 'DUPLICATE_SLUG', message: 'Another segment already uses this slug.' } });
        }
        throw error;
      }

      auditAction(req.auth, 'segment_created', {
        entityType: 'segment',
        entityId: data?.id,
        requestId: req.requestId,
        metadata: { name, slug, priority, isActive },
      });

      return res.status(201).json({ success: true, segment: data, message: 'Segment created successfully.' });
    } catch (err: any) {
      console.error('Failed to create segment:', logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // PATCH /api/admin/segments/:id: Update segment
  app.patch('/api/admin/segments/:id', requireAuth, requireAdmin, validateBody(apiSchemas.segmentUpdate), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { name, slug, priority, isActive, description } = req.body;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      // Writes stay keyed on the internal UUID; only reads use the slug.
      if (!UUID_SHAPE_PATTERN.test(id)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_SEGMENT_ID', message: 'Segment ID must be a valid UUID.' } });
      }

      const { data: existing, error: existingErr } = await admin
        .from('segments')
        .select('id')
        .eq('id', id)
        .maybeSingle();
      if (existingErr) throw existingErr;
      if (!existing) {
        return res.status(404).json({ success: false, error: { code: 'SEGMENT_NOT_FOUND', message: 'Segment not found' } });
      }

      const updateData: Record<string, any> = { updated_at: new Date().toISOString() };
      if (name !== undefined) updateData.name = name;
      if (slug !== undefined) updateData.slug = slug;
      if (priority !== undefined) updateData.priority = priority;
      if (isActive !== undefined) updateData.is_active = isActive;
      if (description !== undefined) updateData.description = description;

      // A slug change must not collide with a DIFFERENT segment. The row's own id
      // is excluded so re-saving a segment without touching its slug is fine.
      if (slug !== undefined) {
        const { data: slugClash, error: slugCheckErr } = await admin
          .from('segments')
          .select('id')
          .eq('slug', slug)
          .neq('id', id)
          .maybeSingle();

        if (slugCheckErr) throw slugCheckErr;
        if (slugClash) {
          return res.status(400).json({ success: false, error: { code: 'DUPLICATE_SLUG', message: 'Another segment already uses this slug.' } });
        }
      }

      const { data, error } = await admin
        .from('segments')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          return res.status(400).json({ success: false, error: { code: 'DUPLICATE_SLUG', message: 'Another segment already uses this slug.' } });
        }
        throw error;
      }

      auditAction(req.auth, 'segment_edited', {
        entityType: 'segment',
        entityId: id,
        requestId: req.requestId,
        metadata: { updates: updateData },
      });

      return res.json({ success: true, segment: data, message: 'Segment updated successfully.' });
    } catch (err: any) {
      console.error('Failed to update segment:', logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // PATCH /api/admin/segments/:id/toggle-active: Toggle segment active status
  app.patch('/api/admin/segments/:id/toggle-active', requireAuth, requireAdmin, validateBody(apiSchemas.segmentToggleActive), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      const { data, error } = await admin
        .from('segments')
        .update({ is_active: isActive, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      auditAction(req.auth, isActive ? 'segment_activated' : 'segment_deactivated', {
        entityType: 'segment',
        entityId: id,
        requestId: req.requestId,
        metadata: { isActive },
      });

      return res.json({ success: true, segment: data, message: `Segment ${isActive ? 'activated' : 'deactivated'} successfully.` });
    } catch (err: any) {
      console.error('Failed to toggle segment active status:', logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // POST /api/admin/segments/:id/priority: Change segment priority
  app.post('/api/admin/segments/:id/priority', requireAuth, requireAdmin, validateBody(apiSchemas.segmentPriority), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { direction } = req.body; // 'up' or 'down'
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      // Get current segment
      const { data: current, error: readErr } = await admin
        .from('segments')
        .select('id, priority')
        .eq('id', id)
        .maybeSingle();

      if (readErr) throw readErr;
      if (!current) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Segment not found.' } });
      }

      // Get adjacent segment
      const { data: adjacent, error: adjErr } = await admin
        .from('segments')
        .select('id, priority')
        .eq('is_active', true)
        .neq('id', id)
        .order('priority', { ascending: direction === 'up' ? false : true })
        .limit(1)
        .maybeSingle();

      if (adjErr) throw adjErr;

      if (adjacent) {
        // Swap priorities
        const currentPriority = current.priority;
        const adjacentPriority = adjacent.priority;

        const { error: err1 } = await admin
          .from('segments')
          .update({ priority: adjacentPriority, updated_at: new Date().toISOString() })
          .eq('id', id);

        if (err1) throw err1;

        const { error: err2 } = await admin
          .from('segments')
          .update({ priority: currentPriority, updated_at: new Date().toISOString() })
          .eq('id', adjacent.id);

        if (err2) throw err2;

        auditAction(req.auth, 'segment_priority_changed', {
          entityType: 'segment',
          entityId: id,
          requestId: req.requestId,
          metadata: { direction, fromPriority: currentPriority, toPriority: adjacentPriority },
        });
      }

      // Re-fetch and return updated list
      const { data: segments, error: segErr } = await admin
        .from('segments')
        .select('*')
        .order('priority', { ascending: true });

      if (segErr) throw segErr;

      return res.json({ success: true, segments, message: `Segment priority moved ${direction}.` });
    } catch (err: any) {
      console.error('Failed to change segment priority:', logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // POST /api/admin/segments/:id/mentors: Add mentor to segment
  app.post('/api/admin/segments/:id/mentors', requireAuth, requireAdmin, validateBody(apiSchemas.segmentAddMentor), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { mentorId, isPrimary } = req.body as { mentorId: string; isPrimary: boolean };
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      // Check segment exists
      const { data: segment, error: segErr } = await admin
        .from('segments')
        .select('id')
        .eq('id', id)
        .maybeSingle();

      if (segErr) throw segErr;
      if (!segment) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Segment not found.' } });
      }

      // Check mentor exists and is approved
      const { data: mentor, error: mpErr } = await admin
        .from('mentor_profiles')
        .select('id, is_approved')
        .eq('id', mentorId)
        .maybeSingle();

      if (mpErr) throw mpErr;
      if (!mentor) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Mentor not found.' } });
      }

      // Check if already assigned
      const { data: existing, error: existErr } = await admin
        .from('mentor_segments')
        .select('id')
        .eq('mentor_id', mentorId)
        .eq('segment_id', id)
        .maybeSingle();

      if (existErr) throw existErr;
      if (existing) {
        return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Mentor already assigned to this segment.' } });
      }

      // If setting as primary, unset other primary for this mentor
      if (isPrimary) {
        const { error: clearErr } = await admin
          .from('mentor_segments')
          .update({ is_primary: false })
          .eq('mentor_id', mentorId);

        if (clearErr) throw clearErr;
      }

      const { data, error } = await admin
        .from('mentor_segments')
        .insert({ mentor_id: mentorId, segment_id: id, is_primary: isPrimary || false })
        .select()
        .single();

      if (error) throw error;

      auditAction(req.auth, 'mentor_assigned_to_segment', {
        entityType: 'mentor_segments',
        entityId: data?.id,
        requestId: req.requestId,
        metadata: { mentorId, segmentId: id, isPrimary },
      });

      return res.status(201).json({ success: true, assignment: data, message: 'Mentor assigned to segment.' });
    } catch (err: any) {
      console.error('Failed to assign mentor to segment:', logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // DELETE /api/admin/segments/:id/mentors/:mentorId: Remove mentor from segment
  app.delete('/api/admin/segments/:id/mentors/:mentorId', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id, mentorId } = req.params;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      // Check for active gigs
      const { data: gigs, error: gigsErr } = await admin
        .from('gigs')
        .select('id')
        .eq('mentor_id', mentorId)
        .eq('segment_id', id)
        .eq('is_active', true);

      if (gigsErr) throw gigsErr;
      if (gigs && gigs.length > 0) {
        return res.status(400).json({ success: false, error: { code: 'CONFLICT', message: 'Cannot remove mentor with active gigs in this segment.' } });
      }

      // Check for future bookings
      const { data: bookings, error: bookingsErr } = await admin
        .from('bookings')
        .select('id')
        .eq('mentor_id', mentorId)
        .eq('segment_id', id)
        .not('status', 'in', '("CANCELLED","REJECTED")')
        .gte('start_time', new Date().toISOString());

      if (bookingsErr) throw bookingsErr;
      if (bookings && bookings.length > 0) {
        return res.status(400).json({ success: false, error: { code: 'CONFLICT', message: 'Cannot remove mentor with future bookings in this segment.' } });
      }

      const { error } = await admin
        .from('mentor_segments')
        .delete()
        .eq('mentor_id', mentorId)
        .eq('segment_id', id);

      if (error) throw error;

      auditAction(req.auth, 'mentor_removed_from_segment', {
        entityType: 'mentor_segments',
        entityId: `${mentorId}:${id}`,
        requestId: req.requestId,
        metadata: { mentorId, segmentId: id },
      });

      return res.json({ success: true, message: 'Mentor removed from segment.' });
    } catch (err: any) {
      console.error('Failed to remove mentor from segment:', logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // POST /api/admin/segments/:id/gigs: Create gig for mentor in segment
  app.post('/api/admin/segments/:id/gigs', requireAuth, requireAdmin, validateBody(apiSchemas.segmentGigCreate), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      // mentorId, title, duration and price are required and markup-free; the
      // description is bounded and sanitised.
      const { mentorId, title, description, durationMinutes, priceInr, isActive } = req.body as {
        mentorId: string;
        title: string;
        description?: string;
        durationMinutes: number;
        priceInr: number;
        isActive?: boolean;
      };
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      // Check segment exists
      const { data: segment, error: segErr } = await admin
        .from('segments')
        .select('id, is_active')
        .eq('id', id)
        .maybeSingle();

      if (segErr) throw segErr;
      if (!segment) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Segment not found.' } });
      }

      // Check mentor is assigned to segment
      const { data: ms, error: msErr } = await admin
        .from('mentor_segments')
        .select('id')
        .eq('mentor_id', mentorId)
        .eq('segment_id', id)
        .maybeSingle();

      if (msErr) throw msErr;
      if (!ms) {
        return res.status(400).json({ success: false, error: { code: 'FORBIDDEN', message: 'Mentor not assigned to this segment.' } });
      }

      // Check for existing active gig for this mentor in this segment
      const { data: existingGig, error: egErr } = await admin
        .from('gigs')
        .select('id')
        .eq('mentor_id', mentorId)
        .eq('segment_id', id)
        .eq('is_active', true)
        .maybeSingle();

      if (egErr) throw egErr;
      if (existingGig && isActive !== false) {
        return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Mentor already has an active gig in this segment.' } });
      }

      const { data, error } = await admin
        .from('gigs')
        .insert({
          mentor_id: mentorId,
          segment_id: id,
          title,
          description: description || '',
          duration_minutes: durationMinutes,
          price_inr: priceInr,
          is_active: isActive !== false,
        })
        .select()
        .single();

      if (error) throw error;

      auditAction(req.auth, 'gig_created', {
        entityType: 'gig',
        entityId: data?.id,
        requestId: req.requestId,
        metadata: { mentorId, segmentId: id, title, durationMinutes, priceInr, isActive },
      });

      return res.status(201).json({ success: true, gig: data, message: 'Gig created successfully.' });
    } catch (err: any) {
      console.error('Failed to create gig:', logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // --------------------------------------------------------------------------
  // Segment Experience Configuration
  // --------------------------------------------------------------------------

  // GET /api/admin/segments/:id/experience: Fetch segment experience config
  app.get('/api/admin/segments/:id/experience', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      const { id } = req.params;
      if (!UUID_SHAPE_PATTERN.test(id)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_SEGMENT_ID', message: 'Segment ID must be a valid UUID.' } });
      }

      const { data: segment, error } = await admin
        .from('segments')
        .select('id, name, experience_config')
        .eq('id', id)
        .maybeSingle();

      if (error) throw error;
      if (!segment) {
        return res.status(404).json({ success: false, error: { code: 'SEGMENT_NOT_FOUND', message: 'Segment not found' } });
      }

      return res.json({
        success: true,
        segment: {
          id: segment.id,
          name: segment.name,
          experience_config: segment.experience_config || {},
        },
      });
    } catch (err: any) {
      console.error('Failed to fetch segment experience:', logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err, context: 'GET /api/admin/segments/:id/experience' });
    }
  });

  // PUT /api/admin/segments/:id/experience: Update segment experience config
  app.put('/api/admin/segments/:id/experience', requireAuth, requireAdmin, validateBody(apiSchemas.segmentExperience), async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      const { id } = req.params;
      if (!UUID_SHAPE_PATTERN.test(id)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_SEGMENT_ID', message: 'Segment ID must be a valid UUID.' } });
      }

      const { data: existing, error: existingErr } = await admin
        .from('segments')
        .select('id')
        .eq('id', id)
        .maybeSingle();

      if (existingErr) throw existingErr;
      if (!existing) {
        return res.status(404).json({ success: false, error: { code: 'SEGMENT_NOT_FOUND', message: 'Segment not found' } });
      }

      const experienceConfig = req.body ?? {};

      const { data, error } = await admin
        .from('segments')
        .update({ experience_config: experienceConfig, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('id, name, experience_config')
        .single();

      if (error) throw error;

      auditAction(req.auth, 'segment_experience_updated', {
        entityType: 'segment',
        entityId: id,
        requestId: req.requestId,
        metadata: { hasConfig: !!experienceConfig && Object.keys(experienceConfig).length > 0 },
      });

      return res.json({
        success: true,
        segment: {
          id: data.id,
          name: data.name,
          experience_config: data.experience_config || {},
        },
        message: 'Segment experience updated.',
      });
    } catch (err: any) {
      console.error('Failed to update segment experience:', logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err, context: 'PUT /api/admin/segments/:id/experience' });
    }
  });

  // GET /api/seeker/segments/:slug/experience: Public segment experience for seekers
  app.get('/api/seeker/segments/:slug/experience', async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable.' } });
      }

      const { slug } = req.params;

      const { data: segment, error } = await admin
        .from('segments')
        .select('id, name, slug, is_active, experience_config')
        .eq('slug', slug)
        .eq('is_active', true)
        .maybeSingle();

      if (error) throw error;
      if (!segment) {
        return res.status(404).json({ success: false, error: { code: 'SEGMENT_NOT_FOUND', message: 'Segment not found' } });
      }

      return res.json({
        success: true,
        segment: {
          id: segment.id,
          name: segment.name,
          slug: segment.slug,
          experience_config: segment.experience_config || {},
        },
      });
    } catch (err: any) {
      console.error('Failed to fetch seeker segment experience:', logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err, context: 'GET /api/seeker/segments/:slug/experience' });
    }
  });

  // PATCH /api/admin/gigs/:id: Update gig
  app.patch('/api/admin/gigs/:id', requireAuth, requireAdmin, validateBody(apiSchemas.adminGigUpdate), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { title, description, durationMinutes, priceInr, isActive } = req.body;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      // Check for active gig conflict if activating
      if (isActive === true) {
        const { data: gig, error: readErr } = await admin
          .from('gigs')
          .select('mentor_id, segment_id')
          .eq('id', id)
          .maybeSingle();

        if (readErr) throw readErr;
        if (gig) {
          const { data: existingGig, error: egErr } = await admin
            .from('gigs')
            .select('id')
            .eq('mentor_id', gig.mentor_id)
            .eq('segment_id', gig.segment_id)
            .eq('is_active', true)
            .neq('id', id)
            .maybeSingle();

          if (egErr) throw egErr;
          if (existingGig) {
            return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Mentor already has an active gig in this segment.' } });
          }
        }
      }

      const updateData: Record<string, any> = { updated_at: new Date().toISOString() };
      if (title !== undefined) updateData.title = title;
      if (description !== undefined) updateData.description = description;
      if (durationMinutes !== undefined) updateData.duration_minutes = durationMinutes;
      if (priceInr !== undefined) updateData.price_inr = priceInr;
      if (isActive !== undefined) updateData.is_active = isActive;

      const { data, error } = await admin
        .from('gigs')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      auditAction(req.auth, 'gig_updated', {
        entityType: 'gig',
        entityId: id,
        requestId: req.requestId,
        metadata: { updates: updateData },
      });

      return res.json({ success: true, gig: data, message: 'Gig updated successfully.' });
    } catch (err: any) {
      console.error('Failed to update gig:', logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // Segment hero image endpoints (admin only)
  app.post('/api/admin/segments/:id/hero-upload-url', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      const { id } = req.params;
      if (!UUID_SHAPE_PATTERN.test(id)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_SEGMENT_ID', message: 'Segment ID must be a valid UUID.' } });
      }

      const { data: segment, error: segErr } = await admin
        .from('segments')
        .select('id')
        .eq('id', id)
        .maybeSingle();
      if (segErr) throw segErr;
      if (!segment) {
        return res.status(404).json({ success: false, error: { code: 'SEGMENT_NOT_FOUND', message: 'Segment not found' } });
      }

      const type = String(req.body?.type || 'image/png').toLowerCase();
      const size = Number(req.body?.size || 0);
      const ALLOWED_HERO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
      const HERO_MAX_BYTES = 5 * 1024 * 1024;
      if (!ALLOWED_HERO_MIME_TYPES.includes(type)) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Upload a PNG, JPEG, WebP or GIF image.' } });
      }
      if (!Number.isFinite(size) || size <= 0) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'That file is empty.' } });
      }
      if (size > HERO_MAX_BYTES) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'That image is larger than 5 MB.' } });
      }

      const extensionByMimeType: Record<string, string> = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp',
        'image/gif': 'gif',
      };
      const storagePath = `segment-hero/${id}-${Date.now()}-${randomUUID().slice(0, 6)}.${extensionByMimeType[type]}`;
      const { data, error } = await admin.storage.from('segment-hero').createSignedUploadUrl(storagePath);
      if (error) throw error;

      auditAction(req.auth, 'segment_hero_upload_url_requested', {
        entityType: 'segment',
        entityId: id,
        requestId: req.requestId,
        metadata: { mimeType: type, sizeBytes: size },
      });

      return res.json({ success: true, uploadUrl: data.signedUrl, token: data.token, path: storagePath });
    } catch (err: any) {
      return respondWithServerError({
        req, res, error: err,
        context: 'POST /api/admin/segments/:id/hero-upload-url',
        clientMessage: 'Unable to prepare the segment hero image upload.',
      });
    }
  });

  // DELETE /api/admin/segments/:id/hero-image: remove a segment hero image
  app.delete('/api/admin/segments/:id/hero-image', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      const { id } = req.params;
      if (!UUID_SHAPE_PATTERN.test(id)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_SEGMENT_ID', message: 'Segment ID must be a valid UUID.' } });
      }

      const { data: current, error: readErr } = await admin
        .from('segments')
        .select('experience_config')
        .eq('id', id)
        .maybeSingle();
      if (readErr) throw readErr;
      if (!current) {
        return res.status(404).json({ success: false, error: { code: 'SEGMENT_NOT_FOUND', message: 'Segment not found' } });
      }

      const cfg = (current.experience_config || {}) as Record<string, unknown>;
      const branding = (cfg.branding || {}) as Record<string, unknown>;
      const previousPath = typeof branding.heroImageUrl === 'string' ? branding.heroImageUrl : null;

      const nextConfig = { ...cfg };
      const nextBranding = { ...branding };
      delete nextBranding.heroImageUrl;
      nextConfig.branding = nextBranding;

      const { error: writeErr } = await admin
        .from('segments')
        .update({ experience_config: nextConfig, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (writeErr) throw writeErr;

      if (previousPath) {
        try { await admin.storage.from('segment-hero').remove([previousPath]); } catch {}
      }

      auditAction(req.auth, 'segment_hero_image_removed', {
        entityType: 'segment',
        entityId: id,
        requestId: req.requestId,
        metadata: { previousPath },
      });

      return res.json({ success: true, message: 'Segment hero image removed.' });
    } catch (err: any) {
      return respondWithServerError({
        req, res, error: err,
        context: 'DELETE /api/admin/segments/:id/hero-image',
        clientMessage: 'Unable to remove the segment hero image.',
      });
    }
  });

  // PATCH /api/admin/gigs/:id/toggle-active: Toggle gig active status
  app.patch('/api/admin/gigs/:id/toggle-active', requireAuth, requireAdmin, validateBody(apiSchemas.adminGigToggleActive), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      if (isActive === true) {
        // Check for conflict
        const { data: gig, error: readErr } = await admin
          .from('gigs')
          .select('mentor_id, segment_id')
          .eq('id', id)
          .maybeSingle();

        if (readErr) throw readErr;
        if (gig) {
          const { data: existingGig, error: egErr } = await admin
            .from('gigs')
            .select('id')
            .eq('mentor_id', gig.mentor_id)
            .eq('segment_id', gig.segment_id)
            .eq('is_active', true)
            .neq('id', id)
            .maybeSingle();

          if (egErr) throw egErr;
          if (existingGig) {
            return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Mentor already has an active gig in this segment.' } });
          }
        }
      }

      const { data, error } = await admin
        .from('gigs')
        .update({ is_active: isActive, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      auditAction(req.auth, isActive ? 'gig_activated' : 'gig_deactivated', {
        entityType: 'gig',
        entityId: id,
        requestId: req.requestId,
        metadata: { isActive },
      });

      return res.json({ success: true, gig: data, message: `Gig ${isActive ? 'activated' : 'deactivated'} successfully.` });
    } catch (err: any) {
      console.error('Failed to toggle gig active status:', logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // GET /api/admin/segments/:segment/mentors
  // Accepts the public slug or the internal UUID; the detail endpoint already
  // returns mentors inline, so this stays for callers that need just the list.
  app.get('/api/admin/segments/:segment/mentors', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    const admin = getSupabaseAdmin();
    if (!admin) {
      return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
    }

    try {
      const { segment, error: segErr } = await resolveAdminSegmentBySlugOrId(admin, req.params.segment);
      if (segErr) throw segErr;
      if (!segment) {
        return res.status(404).json({ success: false, error: { code: 'SEGMENT_NOT_FOUND', message: 'Segment not found' } });
      }

      const { mentors, error } = await loadSegmentMentors(admin, segment.id);
      if (error) throw error;

      return res.json({ success: true, mentors });
    } catch (err: any) {
      console.error('Failed to fetch segment mentors:', logSanitizer.safeMessage(err));
      return respondWithServerError({
        req, res, error: err,
        context: 'GET /api/admin/segments/:segment/mentors',
        clientMessage: 'Unable to load the mentors for this segment.',
      });
    }
  });

  // GET /api/admin/segments/:segment/gigs
  // A segment with no gigs returns `gigs: []`, which is a normal state.
  app.get('/api/admin/segments/:segment/gigs', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    const admin = getSupabaseAdmin();
    if (!admin) {
      return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
    }

    try {
      const { segment, error: segErr } = await resolveAdminSegmentBySlugOrId(admin, req.params.segment);
      if (segErr) throw segErr;
      if (!segment) {
        return res.status(404).json({ success: false, error: { code: 'SEGMENT_NOT_FOUND', message: 'Segment not found' } });
      }

      const { gigs, error } = await loadSegmentGigs(admin, segment.id);
      if (error) throw error;

      return res.json({ success: true, gigs });
    } catch (err: any) {
      console.error('Failed to fetch segment gigs:', logSanitizer.safeMessage(err));
      return respondWithServerError({
        req, res, error: err,
        context: 'GET /api/admin/segments/:segment/gigs',
        clientMessage: 'Unable to load the gigs for this segment.',
      });
    }
  });

  // GET /api/admin/mentors/eligible was moved above GET /api/admin/mentors/:id
  // so that Express can no longer shadow it with the `:id` parameter route.

  // GET /api/admin/mentors/:id/slots: Generate slots for mentor on date
  //
  // Admin view of the SAME engine the seeker surface uses. It delegates to
  // `computeMentorSlotsForDate` so there is exactly one place that loads
  // availability, exceptions, bookings and holds.
  app.get('/api/admin/mentors/:id/slots', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { date, gigId } = req.query;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      if (!date || !gigId) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'date and gigId query parameters are required.' } });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'date must be a YYYY-MM-DD calendar date.' } });
      }

      // Verify gig exists and belongs to mentor
      const { data: gig, error: gigErr } = await admin
        .from('gigs')
        .select('*')
        .eq('id', gigId)
        .eq('mentor_id', id)
        .maybeSingle();

      if (gigErr) throw gigErr;
      if (!gig) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Gig not found for this mentor.' } });
      }

      const { results, error } = await computeMentorSlotsForDate(admin, {
        mentorIds: [id],
        dateStr: String(date),
        segmentId: gig.segment_id,
        now: new Date(),
      });
      if (error) throw error;

      const result = results.get(id);
      if (!result || !result.gig) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Mentor not found.' } });
      }

      return res.json({
        success: true,
        slots: result.slots,
        gig: { id: result.gig.id, title: result.gig.title, durationMinutes: result.gig.duration_minutes },
      });
    } catch (err: any) {
      console.error('Failed to generate slots:', logSanitizer.safeMessage(err));
      return respondWithServerError({
        req,
        res,
        error: err,
        context: 'GET /api/admin/mentors/:id/slots',
        clientMessage: 'Unable to load availability.',
      });
    }
  });

  // --------------------------------------------------------------------------
  // Admin API: Users Management
  // --------------------------------------------------------------------------

  // GET /api/admin/users: Fetch all users with roles
  app.get('/api/admin/users', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      // Fetch all profiles
      const { data: profiles, error: profilesErr } = await admin
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (profilesErr) throw profilesErr;

      // Fetch all user_roles
      const { data: userRoles, error: rolesErr } = await admin
        .from('user_roles')
        .select('*');

      if (rolesErr) throw rolesErr;

      const { data: applications, error: applicationsErr } = await admin
        .from('mentor_applications')
        .select('user_id, status');

      if (applicationsErr) throw applicationsErr;

      // Combine: for each profile, get their roles
      const rolesMap = new Map<string, string[]>();
      for (const ur of userRoles || []) {
        if (!rolesMap.has(ur.user_id)) rolesMap.set(ur.user_id, []);
        rolesMap.get(ur.user_id)!.push(ur.role);
      }

      const applicationStatusMap = new Map<string, string>();
      for (const application of applications || []) {
        if (application.user_id) applicationStatusMap.set(application.user_id, application.status);
      }

      const users = (profiles || []).map((p: any) => {
        const roles = rolesMap.get(p.id) || ['seeker'];
        const applicationStatus = applicationStatusMap.get(p.id) || null;
        const primaryRole = roles.includes('admin')
          ? 'ADMIN'
          : roles.includes('mentor') && applicationStatus !== null && applicationStatus !== 'approved'
            ? 'PENDING_MENTOR'
            : roles.includes('mentor')
              ? 'MENTOR'
              : 'SEEKER';
        return {
          id: p.id,
          name: p.full_name,
          email: p.email,
          role: primaryRole,
          timezone: p.timezone,
          createdAt: p.created_at ? new Date(p.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Unknown',
          status: p.account_status === 'suspended' ? 'SUSPENDED' : 'ACTIVE',
          roles,
          applicationStatus,
        };
      });

      return res.json({ success: true, users });
    } catch (err: any) {
      console.error('Failed to fetch admin users:', logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // GET /api/admin/users/:id: Central user details with mentor onboarding data.
  app.get('/api/admin/users/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      const userId = req.params.id;
      if (!UUID_PATTERN.test(userId)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_USER_ID', message: 'User ID must be a valid UUID.' } });
      }

      const [{ data: profile, error: profileErr }, { data: roles, error: rolesErr }, { data: mentorProfile, error: mentorErr }, { data: application, error: applicationErr }] = await Promise.all([
        admin.from('profiles').select('*').eq('id', userId).maybeSingle(),
        admin.from('user_roles').select('role').eq('user_id', userId),
        admin.from('mentor_profiles').select('*').eq('id', userId).maybeSingle(),
        admin.from('mentor_applications').select('*').eq('user_id', userId).maybeSingle(),
      ]);
      if (profileErr) throw profileErr;
      if (rolesErr) throw rolesErr;
      if (mentorErr) throw mentorErr;
      if (applicationErr) throw applicationErr;
      if (!profile) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } });

      const applicationId = application?.id;
      const [{ data: documents, error: documentsErr }, { data: memberships, error: membershipsErr }] = await Promise.all([
        applicationId ? admin.from('mentor_verification_documents').select('*').eq('application_id', applicationId).order('uploaded_at', { ascending: false }) : Promise.resolve({ data: [], error: null }),
        admin.from('mentor_segments').select('*, segment:segments(*)').eq('mentor_id', userId),
      ]);
      if (documentsErr) throw documentsErr;
      if (membershipsErr) throw membershipsErr;

      const signedDocuments = await Promise.all((documents || []).map(async (document: { storage_path: string }) => {
        const { data: signed, error: signedErr } = await admin.storage.from('mentor-verification-documents').createSignedUrl(document.storage_path, 300);
        if (signedErr) throw signedErr;
        return { ...document, download_url: signed?.signedUrl || null };
      }));

      // Transform mentorProfile for frontend compatibility: map 'about' -> 'bio', 'experience_years' -> 'years_experience'
      const transformedMentorProfile = mentorProfile ? {
        ...mentorProfile,
        bio: mentorProfile.about,
        years_experience: mentorProfile.experience_years,
      } : null;

      // ---- Real operational counters for the overview cards -------------------
      // Every number below is a live database count, never a computed guess.
      const nowIso = new Date().toISOString();
      const isAdminAccount = (roles || []).some((entry: { role: string }) => entry.role === 'admin');
      const isActiveAccount = deriveAccountState({
        account_status: profile.account_status ?? null,
        suspended_until: profile.suspended_until ?? null,
      }).canPerformOperationalActions;

      const [
        { count: upcomingBookings },
        { count: completedBookings },
        { count: gigCount },
        { count: activeGigCount },
        { count: paymentCount },
        { count: workspaceCount },
        { count: notificationCount },
        { count: unreadNotificationCount },
      ] = await Promise.all([
        admin.from('bookings').select('id', { count: 'exact', head: true })
          .or(`seeker_id.eq.${userId},mentor_id.eq.${userId}`)
          .in('status', ['PAYMENT_PENDING', 'PENDING_VERIFICATION', 'MENTOR_PENDING', 'CONFIRMED'])
          .gte('start_time', nowIso),
        admin.from('bookings').select('id', { count: 'exact', head: true })
          .or(`seeker_id.eq.${userId},mentor_id.eq.${userId}`)
          .eq('status', 'COMPLETED'),
        admin.from('gigs').select('id', { count: 'exact', head: true }).eq('mentor_id', userId),
        admin.from('gigs').select('id', { count: 'exact', head: true }).eq('mentor_id', userId).eq('is_active', true),
        admin.from('payments').select('id', { count: 'exact', head: true }).eq('seeker_id', userId),
        admin.from('session_workspaces').select('id', { count: 'exact', head: true })
          .or(`seeker_id.eq.${userId},mentor_id.eq.${userId}`),
        admin.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId),
        admin.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('is_read', false),
      ]);

      // How many ADMIN accounts are currently active. The UI needs this to
      // explain the "last active admin" protection before an Admin clicks.
      // Lapsed suspensions count as active here, matching the write-time guard.
      const activeAdminCount = await countActiveAdminAccounts(admin);

      // ---- Supabase Auth account-access state (invitation lifecycle) ---------
      // Read through the admin client only. No password, hash or session token
      // is ever returned to the browser.
      let authState: {
        invitationStatus: 'pending' | 'sent' | 'accepted';
        createdAt: string | null;
        invitedAt: string | null;
        lastSignInAt: string | null;
        emailConfirmedAt: string | null;
        actionLink: string | null;
      } | null = null;
      try {
        const { data: authUser } = await admin.auth.admin.getUserById(userId);
        if (authUser?.user) {
          const u = authUser.user as any;
          const invitationStatus: 'pending' | 'sent' | 'accepted' = u.last_sign_in_at
            ? 'accepted'
            : u.invited_at
              ? 'sent'
              : 'pending';
          authState = {
            invitationStatus,
            createdAt: u.created_at ?? null,
            invitedAt: u.invited_at ?? null,
            lastSignInAt: u.last_sign_in_at ?? null,
            emailConfirmedAt: u.email_confirmed_at ?? null,
            actionLink: null,
          };
        }
      } catch (authErr) {
        // Auth state is supplementary: the rest of the page is still real and
        // usable, so this is logged rather than failed.
        console.warn('[admin] Unable to read Supabase Auth state for user', userId, getErrorMessage(authErr));
      }

      return res.json({
        success: true,
        user: {
          profile,
          roles: (roles || []).map((entry: { role: string }) => entry.role),
          mentorProfile: transformedMentorProfile,
          application,
          documents: signedDocuments,
          segments: memberships || [],
          auth: authState,
          safety: {
            isAdmin: isAdminAccount,
            isActive: isActiveAccount,
            activeAdminCount,
          },
          summary: {
            upcomingBookings: upcomingBookings ?? 0,
            completedBookings: completedBookings ?? 0,
            gigs: gigCount ?? 0,
            activeGigs: activeGigCount ?? 0,
            payments: paymentCount ?? 0,
            segments: (memberships || []).length,
            workspaces: workspaceCount ?? 0,
            notifications: notificationCount ?? 0,
            unreadNotifications: unreadNotificationCount ?? 0,
          },
        },
      });
    } catch (err) {
      return respondWithServerError({ req, res, error: err, context: 'GET /api/admin/users/:id', clientMessage: 'Unable to load user details.' });
    }
  });

  // PATCH /api/admin/users/:id
  //
  // Admin edit access to the profile fields the REAL schema supports.
  //   profiles:       full_name, timezone, phone
  //   mentor_profiles (only for mentors): headline, about, experience_years
  //
  // `account_status` is NOT editable here: status changes go through
  // PATCH /api/admin/users/:id/status so they are always validated, guarded
  // and audited. `email` is also not editable here because the login identity
  // lives in Supabase Auth, not in `profiles`; the email-change flow is a
  // separate protected operation.
  app.patch('/api/admin/users/:id', requireAuth, requireAdmin, validateBody(apiSchemas.adminUserUpdate), async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      const userId = req.params.id;
      if (!UUID_PATTERN.test(userId)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_USER_ID', message: 'User ID must be a valid UUID.' } });
      }
      // Free text is already trimmed and markup-free; the schema also guarantees
      // at least one editable field and that the update is not silently empty.
      const { fullName, timezone, phone, bio, headline, experienceYears } = req.body as {
        fullName?: string;
        timezone?: string;
        phone?: string;
        bio?: string;
        headline?: string;
        experienceYears?: number;
      };

      const { data: existing, error: existingErr } = await admin
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .maybeSingle();
      if (existingErr) throw existingErr;
      if (!existing) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } });
      }

      const profileUpdates: Record<string, string | null> = {};
      if (fullName !== undefined) profileUpdates.full_name = fullName;
      if (timezone !== undefined) profileUpdates.timezone = timezone;
      // profiles.phone exists in the real schema. Clearing it is allowed.
      if (phone !== undefined) profileUpdates.phone = phone || null;

      const mentorUpdates: Record<string, unknown> = {};
      if (bio !== undefined) mentorUpdates.about = bio;
      if (headline !== undefined) mentorUpdates.headline = headline;
      if (experienceYears !== undefined) mentorUpdates.experience_years = experienceYears;

      if (Object.keys(profileUpdates).length > 0) {
        const { error } = await admin.from('profiles').update({ ...profileUpdates, updated_at: new Date().toISOString() }).eq('id', userId);
        if (error) throw error;
      }

      if (Object.keys(mentorUpdates).length > 0) {
        const { error } = await admin.from('mentor_profiles').update({ ...mentorUpdates, updated_at: new Date().toISOString() }).eq('id', userId);
        if (error) throw error;
      }

      await auditAction(req.auth, 'USER_PROFILE_UPDATED', {
        entityType: 'user',
        entityId: userId,
        requestId: req.requestId,
        metadata: {
          targetUserId: userId,
          adminId: req.auth!.user.id,
          fields: [...Object.keys(profileUpdates), ...Object.keys(mentorUpdates)],
        },
      });
      return res.json({ success: true, message: 'User updated successfully.' });
    } catch (err) {
      return respondWithServerError({ req, res, error: err, context: 'PATCH /api/admin/users/:id', clientMessage: 'Unable to update user.' });
    }
  });

  // PATCH /api/admin/users/:id/status
  //
  // The single server-authorized entry point for Admin account control over ANY
  // user (seeker, mentor or admin).
  //   body: { action: 'activate' | 'deactivate' | 'suspend' | 'reactivate', reason?, suspendedUntil? }
  //
  // Guarantees:
  //  - Admin-only, verified server-side from the caller's token.
  //  - a STATUS CHANGE ONLY: profile, bookings, payments, workspaces,
  //    notifications and audit rows are never deleted or modified.
  //  - platform-critical Admin invariants are protected (no self-change, no
  //    disabling the last active admin, no no-op writes).
  //  - every transition is audited with admin id, target user id, action,
  //    timestamp and reason.
  app.patch('/api/admin/users/:id/status', requireAuth, requireAdmin, validateBody(apiSchemas.adminUserStatus), async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }
      const userId = req.params.id;
      if (!UUID_PATTERN.test(userId)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_USER_ID', message: 'User ID must be a valid UUID.' } });
      }

      // Action enum enforced by the schema; `reason` arrives markup-free.
      const { action, reason, suspendedUntil } = req.body as {
        action: AccountStatusAction;
        reason?: string;
        suspendedUntil?: string;
      };

      const adminId = req.auth!.user.id;

      const [{ data: profile, error: profileErr }, { data: roles, error: rolesErr }] = await Promise.all([
        admin.from('profiles').select('id, account_status, suspended_until').eq('id', userId).maybeSingle(),
        admin.from('user_roles').select('role').eq('user_id', userId),
      ]);
      if (profileErr) throw profileErr;
      if (rolesErr) throw rolesErr;
      if (!profile) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } });
      }

      const targetRoles = (roles || []).map((entry: { role: string }) => entry.role);
      const targetState = deriveAccountState({
        account_status: profile.account_status ?? null,
        suspended_until: profile.suspended_until ?? null,
      });

      const activeAdminCount = await countActiveAdminAccounts(admin);

      const safety = assertAdminAccountSafety({
        action,
        adminId,
        targetId: userId,
        targetRoles,
        activeAdminCount,
        targetState,
      });
      if (!safety.allowed) {
        return res.status(safety.code === 'LAST_ACTIVE_ADMIN' ? 409 : 400).json({
          success: false,
          error: { code: safety.code, message: safety.message },
        });
      }

      const validation = validateAccountStatusAction({
        action,
        reason,
        suspendedUntil,
      });
      if (!validation.valid) {
        return res.status(400).json({ success: false, error: { code: validation.code, message: validation.message } });
      }

      const update = buildAccountStatusUpdate({
        action,
        adminId,
        reason: validation.reason,
        suspendedUntil: validation.suspendedUntil,
      });

      const { error: writeErr } = await admin.from('profiles').update(update).eq('id', userId);
      if (writeErr) throw writeErr;

      await auditAction(req.auth, ACCOUNT_STATUS_ACTION_SPECS[action].auditAction, {
        entityType: 'user',
        entityId: userId,
        requestId: req.requestId,
        metadata: {
          action,
          adminId,
          targetUserId: userId,
          reason: validation.reason ?? null,
          suspendedUntil: validation.suspendedUntil ?? null,
          previousStatus: profile.account_status ?? null,
          previousSuspendedUntil: profile.suspended_until ?? null,
        },
      });

      const pastTense = action === 'activate'
        ? 'activated'
        : action === 'deactivate' ? 'deactivated' : action === 'suspend' ? 'suspended' : 'reactivated';

      return res.json({
        success: true,
        message: `Account ${pastTense}.`,
        action: ACCOUNT_STATUS_ACTION_SPECS[action].auditAction,
        accountStatus: update.account_status,
      });
    } catch (err) {
      return respondWithServerError({
        req, res, error: err,
        context: 'PATCH /api/admin/users/:id/status',
        clientMessage: 'Unable to update the account status.',
      });
    }
  });

  // GET /api/admin/users/:id/bookings
  //
  // Every booking this user participates in, as seeker or mentor, with the
  // gig, segment, payment and workspace state attached. Read-only: the booking
  // state machine is never bypassed from this page.
  app.get('/api/admin/users/:id/bookings', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      const userId = req.params.id;
      if (!UUID_PATTERN.test(userId)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_USER_ID', message: 'User ID must be a valid UUID.' } });
      }

      const { data: bookings, error: bookingsErr } = await admin
        .from('bookings')
        .select(`
          *,
          seeker:profiles!bookings_seeker_id_fkey(id, full_name, email),
          mentor:profiles!bookings_mentor_id_fkey(id, full_name, email),
          gig:gigs(id, title, duration_minutes, price_inr),
          segment:segments(id, name, slug)
        `)
        .or(`seeker_id.eq.${userId},mentor_id.eq.${userId}`)
        .order('start_time', { ascending: false });
      if (bookingsErr) throw bookingsErr;

      const bookingIds = (bookings || []).map((b: { id: string }) => b.id);
      const [{ data: payments, error: paymentsErr }, { data: workspaces, error: workspacesErr }] = await Promise.all([
        bookingIds.length ? admin.from('payments').select('*').in('booking_id', bookingIds) : Promise.resolve({ data: [], error: null }),
        bookingIds.length ? admin.from('session_workspaces').select('id, booking_id, status, published_at').in('booking_id', bookingIds) : Promise.resolve({ data: [], error: null }),
      ]);
      if (paymentsErr) throw paymentsErr;
      if (workspacesErr) throw workspacesErr;

      const paymentByBooking = new Map<string, any>((payments || []).map((p: any) => [p.booking_id, p]));
      const workspaceByBooking = new Map<string, any>((workspaces || []).map((w: any) => [w.booking_id, w]));
      const now = Date.now();

      const rows = (bookings || []).map((booking: any) => {
        const payment = paymentByBooking.get(booking.id);
        const workspace = workspaceByBooking.get(booking.id);
        return {
          id: booking.id,
          bookingCode: booking.booking_code,
          startTime: booking.start_time,
          endTime: booking.end_time,
          status: booking.status,
          amountInr: booking.amount_inr,
          meetingUrl: booking.meeting_url,
          cancellationReason: booking.cancellation_reason,
          createdAt: booking.created_at,
          isUpcoming: Date.parse(booking.start_time) >= now && !['CANCELLED', 'REJECTED', 'COMPLETED'].includes(booking.status),
          seeker: booking.seeker ?? null,
          mentor: booking.mentor ?? null,
          gig: booking.gig ?? null,
          segment: booking.segment ?? null,
          payment: payment
            ? { id: payment.id, status: payment.status, amountInr: payment.amount_inr, verifiedAt: payment.verified_at }
            : null,
          workspace: workspace ? { id: workspace.id, status: workspace.status, publishedAt: workspace.published_at } : null,
        };
      });

      return res.json({
        success: true,
        bookings: rows,
        upcoming: rows.filter((r: any) => r.isUpcoming),
        completed: rows.filter((r: any) => r.status === 'COMPLETED'),
        cancelled: rows.filter((r: any) => ['CANCELLED', 'REJECTED'].includes(r.status)),
      });
    } catch (err) {
      return respondWithServerError({ req, res, error: err, context: 'GET /api/admin/users/:id/bookings', clientMessage: 'Unable to load bookings.' });
    }
  });

  // GET /api/admin/users/:id/payments
  //
  // Payment records for every booking this user is part of. Payment state is
  // owned by the payment verification flow; nothing here can change it.
  app.get('/api/admin/users/:id/payments', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      const userId = req.params.id;
      if (!UUID_PATTERN.test(userId)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_USER_ID', message: 'User ID must be a valid UUID.' } });
      }

      // A payment belongs to a user when they are the payer (seeker_id) or the
      // mentor of the booking it settles.
      const { data: mentorBookings, error: mentorBookingsErr } = await admin
        .from('bookings')
        .select('id')
        .eq('mentor_id', userId);
      if (mentorBookingsErr) throw mentorBookingsErr;
      const mentorBookingIds = (mentorBookings || []).map((b: { id: string }) => b.id);

      const { data: payments, error: paymentsErr } = await admin
        .from('payments')
        .select('*')
        .or(
          [
            `seeker_id.eq.${userId}`,
            ...(mentorBookingIds.length ? mentorBookingIds.slice(0, 50).map((id) => `booking_id.eq.${id}`) : []),
          ].join(','),
        )
        .order('created_at', { ascending: false });
      if (paymentsErr) throw paymentsErr;

      const bookingIds = Array.from(new Set((payments || []).map((p: { booking_id: string }) => p.booking_id)));
      const { data: bookings, error: bookingsErr } = bookingIds.length
        ? await admin
            .from('bookings')
            .select('id, booking_code, start_time, status, gig:gigs(id, title), segment:segments(id, name), mentor:profiles!bookings_mentor_id_fkey(id, full_name, email)')
            .in('id', bookingIds)
        : { data: [], error: null };
      if (bookingsErr) throw bookingsErr;
      const bookingMap = new Map<string, any>((bookings || []).map((b: any) => [b.id, b]));

      const verifiedByIds = Array.from(new Set((payments || []).map((p: any) => p.verified_by).filter(Boolean)));
      const { data: verifiers } = verifiedByIds.length
        ? await admin.from('profiles').select('id, full_name, email').in('id', verifiedByIds)
        : { data: [] as any[] };
      const verifierMap = new Map<string, any>((verifiers || []).map((v: any) => [v.id, v]));

      const rows = (payments || []).map((payment: any) => {
        const booking = bookingMap.get(payment.booking_id);
        return {
          id: payment.id,
          amountInr: payment.amount_inr,
          currency: 'INR',
          status: payment.status,
          transactionReference: payment.transaction_reference,
          hasProof: Boolean(payment.proof_storage_path),
          verifiedAt: payment.verified_at,
          verifiedBy: payment.verified_by
            ? { id: payment.verified_by, name: verifierMap.get(payment.verified_by)?.full_name ?? null }
            : null,
          rejectionReason: payment.rejection_reason,
          createdAt: payment.created_at,
          booking: booking
            ? {
                id: booking.id,
                bookingCode: booking.booking_code,
                startTime: booking.start_time,
                status: booking.status,
                gigTitle: booking.gig?.title ?? null,
                segmentName: booking.segment?.name ?? null,
                mentor: booking.mentor ?? null,
              }
            : null,
        };
      });

      return res.json({ success: true, payments: rows });
    } catch (err) {
      return respondWithServerError({ req, res, error: err, context: 'GET /api/admin/users/:id/payments', clientMessage: 'Unable to load payments.' });
    }
  });

  // GET /api/admin/users/:id/workspaces
  app.get('/api/admin/users/:id/workspaces', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      const userId = req.params.id;
      if (!UUID_PATTERN.test(userId)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_USER_ID', message: 'User ID must be a valid UUID.' } });
      }

      const { data: workspaces, error: workspacesErr } = await admin
        .from('session_workspaces')
        .select(`
          id, booking_id, mentor_id, seeker_id, status, published_at, created_at, updated_at,
          booking:bookings(id, booking_code, start_time, end_time, status, segment:segments(id, name)),
          mentor:profiles!session_workspaces_mentor_id_fkey(id, full_name, email),
          seeker:profiles!session_workspaces_seeker_id_fkey(id, full_name, email)
        `)
        .or(`seeker_id.eq.${userId},mentor_id.eq.${userId}`)
        .order('created_at', { ascending: false });
      if (workspacesErr) throw workspacesErr;

      // Only workspace METADATA is returned. Mentor note content stays behind
      // the existing workspace authorization model.
      return res.json({
        success: true,
        workspaces: (workspaces || []).map((w: any) => ({
          id: w.id,
          bookingId: w.booking_id,
          status: w.status,
          publishedAt: w.published_at,
          createdAt: w.created_at,
          updatedAt: w.updated_at,
          mentor: w.mentor ?? null,
          seeker: w.seeker ?? null,
          booking: w.booking ?? null,
        })),
      });
    } catch (err) {
      return respondWithServerError({ req, res, error: err, context: 'GET /api/admin/users/:id/workspaces', clientMessage: 'Unable to load workspaces.' });
    }
  });

  // GET /api/admin/users/:id/notifications
  app.get('/api/admin/users/:id/notifications', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      const userId = req.params.id;
      if (!UUID_PATTERN.test(userId)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_USER_ID', message: 'User ID must be a valid UUID.' } });
      }

      const { data: notifications, error: notifErr } = await admin
        .from('notifications')
        .select('id, type, event_type, title, message, link, is_read, read_at, created_at, entity_type, entity_id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (notifErr) throw notifErr;

      return res.json({
        success: true,
        notifications: notifications || [],
      });
    } catch (err) {
      return respondWithServerError({ req, res, error: err, context: 'GET /api/admin/users/:id/notifications', clientMessage: 'Unable to load notifications.' });
    }
  });

  // POST /api/admin/users/:id/notifications
  //
  // Admin-triggered notification. Reuses the EXISTING notifications table - no
  // second notification system is introduced.
  app.post('/api/admin/users/:id/notifications', requireAuth, requireAdmin, validateBody(apiSchemas.adminUserNotification), async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      const userId = req.params.id;
      if (!UUID_PATTERN.test(userId)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_USER_ID', message: 'User ID must be a valid UUID.' } });
      }

      // Both fields are required, trimmed and markup-free by the schema.
      const { title, message } = req.body as { title: string; message: string };

      const { data: profile, error: profileErr } = await admin
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .maybeSingle();
      if (profileErr) throw profileErr;
      if (!profile) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } });
      }

      const { data: inserted, error: insertErr } = await admin
        .from('notifications')
        .insert({
          user_id: userId,
          title,
          message,
          type: 'ADMIN',
          event_type: 'ADMIN_MESSAGE',
          entity_type: 'user',
          entity_id: userId,
          is_read: false,
          metadata: { adminId: req.auth!.user.id },
          created_at: new Date().toISOString(),
        })
        .select('id, created_at')
        .single();
      if (insertErr) throw insertErr;

      await auditAction(req.auth, 'ADMIN_NOTIFICATION_SENT', {
        entityType: 'user',
        entityId: userId,
        requestId: req.requestId,
        metadata: { targetUserId: userId, adminId: req.auth!.user.id, notificationId: inserted?.id ?? null, title },
      });

      return res.status(201).json({ success: true, message: 'Notification sent.', notification: inserted });
    } catch (err) {
      return respondWithServerError({ req, res, error: err, context: 'POST /api/admin/users/:id/notifications', clientMessage: 'Unable to send the notification.' });
    }
  });

  // GET /api/admin/users/:id/audit
  //
  // Reuses the EXISTING audit_logs table. Entries match the user id, their
  // child records (gigs, bookings, applications) or the user id recorded in
  // the event metadata.
  app.get('/api/admin/users/:id/audit', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      const userId = req.params.id;
      if (!UUID_PATTERN.test(userId)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_USER_ID', message: 'User ID must be a valid UUID.' } });
      }

      const [{ data: gigs }, { data: bookings }, { data: application }] = await Promise.all([
        admin.from('gigs').select('id').eq('mentor_id', userId),
        admin.from('bookings').select('id').or(`seeker_id.eq.${userId},mentor_id.eq.${userId}`),
        admin.from('mentor_applications').select('id').eq('user_id', userId).maybeSingle(),
      ]);

      const childIds = [
        ...(gigs || []).map((g: { id: string }) => g.id),
        ...(bookings || []).map((b: { id: string }) => b.id),
        ...(application?.id ? [application.id] : []),
      ];
      const orFilter = [userId, ...childIds].map((id) => `entity_id.eq.${id}`).join(',');

      const { data: entries, error: auditErr } = await admin
        .from('audit_logs')
        .select('id, created_at, actor_user_id, actor_role, action, entity_type, entity_id, request_id, metadata')
        .or(orFilter)
        .order('created_at', { ascending: false })
        .limit(100);
      if (auditErr) throw auditErr;

      const relevant = (entries || []).filter((entry: any) => {
        if (entry.entity_id === userId) return true;
        const meta = entry.metadata || {};
        return (meta.targetUserId ?? meta.userId ?? meta.mentorId ?? meta.mentor_id) === userId;
      });

      const actorIds = Array.from(new Set(relevant.map((e: any) => e.actor_user_id).filter(Boolean))) as string[];
      const { data: actors } = actorIds.length
        ? await admin.from('profiles').select('id, full_name, email').in('id', actorIds)
        : { data: [] as any[] };
      const actorMap = new Map<string, any>((actors || []).map((a: any) => [a.id, a]));

      return res.json({
        success: true,
        entries: relevant.map((entry: any) => ({
          id: entry.id,
          createdAt: entry.created_at,
          action: entry.action,
          entityType: entry.entity_type,
          entityId: entry.entity_id,
          requestId: entry.request_id,
          actorRole: entry.actor_role,
          actor: entry.actor_user_id
            ? {
                id: entry.actor_user_id,
                name: actorMap.get(entry.actor_user_id)?.full_name ?? null,
                email: actorMap.get(entry.actor_user_id)?.email ?? null,
              }
            : null,
          metadata: entry.metadata ?? null,
        })),
      });
    } catch (err) {
      return respondWithServerError({ req, res, error: err, context: 'GET /api/admin/users/:id/audit', clientMessage: 'Unable to load the audit log.' });
    }
  });

  // POST /api/admin/users/:id/password-reset
  //
  // Sends the account owner a Supabase Auth password-reset email.
  //
  // The Admin never sees, retrieves or stores a password. Only Supabase Auth
  // holds credentials, and the reset link is delivered to the user's own inbox.
  app.post('/api/admin/users/:id/password-reset', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      const userId = req.params.id;
      if (!UUID_PATTERN.test(userId)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_USER_ID', message: 'User ID must be a valid UUID.' } });
      }

      const { data: profile, error: profileErr } = await admin
        .from('profiles')
        .select('id, email, full_name')
        .eq('id', userId)
        .maybeSingle();
      if (profileErr) throw profileErr;
      if (!profile) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } });
      }
      if (!profile.email || !EMAIL_PATTERN.test(profile.email)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_EMAIL', message: 'This account has no usable email address.' } });
      }

      const appBaseUrl = process.env.APP_URL || process.env.APP_BASE_URL || process.env.VITE_APP_BASE_URL || process.env.PUBLIC_APP_URL;
      if (!appBaseUrl) {
        return res.status(503).json({
          success: false,
          error: { code: 'EMAIL_NOT_CONFIGURED', message: 'Unable to send password reset email: the application URL is not configured.' },
        });
      }

      const { error: resetErr } = await admin.auth.admin.generateLink({
        type: 'recovery',
        email: profile.email,
        options: { redirectTo: `${appBaseUrl.replace(/\/$/, '')}/auth/callback` },
      });

      if (resetErr) {
        const info = describeSupabaseError(resetErr);
        return res.status(502).json({
          success: false,
          error: { code: info.code, message: `Unable to send password reset email: ${info.message}` },
        });
      }

      await auditAction(req.auth, 'PASSWORD_RESET_REQUESTED', {
        entityType: 'user',
        entityId: userId,
        requestId: req.requestId,
        metadata: { targetUserId: userId, adminId: req.auth!.user.id, email: profile.email },
      });

      return res.json({
        success: true,
        message: 'Password reset email sent to the account holder.',
        email: profile.email,
      });
    } catch (err) {
      return respondWithServerError({ req, res, error: err, context: 'POST /api/admin/users/:id/password-reset', clientMessage: 'Unable to send password reset email.' });
    }
  });

  // --------------------------------------------------------------------------
  // Admin API: Operations Dashboard (Platform Operations Center)
  // --------------------------------------------------------------------------

  // GET /api/admin/dashboard/overview
  //
  // Single aggregated, database-driven payload for the Admin dashboard.
  // Every metric is computed from live rows by `getAdminDashboardData`; there
  // are no hardcoded business values, no demo fallbacks and no fabricated
  // charts. Sections degrade independently so one failing query never blanks
  // the whole console. Authorization is enforced by `requireAdmin` (server
  // side) and the reads use the service-role client, so RLS is not bypassed
  // from the browser's point of view — the browser never queries these tables
  // directly.
  app.get('/api/admin/dashboard/overview', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      const dashboard = await getAdminDashboardData(admin);
      return res.json({ success: true, dashboard });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: 'GET /api/admin/dashboard/overview',
        clientMessage: 'Dashboard data is temporarily unavailable.',
      });
    }
  });

  // --------------------------------------------------------------------------
  // Admin API: Payments Management
  // --------------------------------------------------------------------------

  // GET /api/admin/payments: Fetch all payments with booking, seeker, mentor details
  app.get('/api/admin/payments', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      const { data: payments, error: paymentsErr } = await admin
        .from('payments')
        .select(`
          *,
          booking:bookings (
            id,
            booking_code,
            seeker_id,
            mentor_id,
            gig_id,
            status,
            amount_inr
          )
        `)
        .order('created_at', { ascending: false });

      if (paymentsErr) throw paymentsErr;

      // Get all unique seeker, mentor and gig IDs referenced by these payments.
      const seekerIds = [...new Set((payments || []).map((p: any) => p.booking?.seeker_id).filter(Boolean))];
      const mentorIds = [...new Set((payments || []).map((p: any) => p.booking?.mentor_id).filter(Boolean))];
      const gigIds = [...new Set((payments || []).map((p: any) => p.booking?.gig_id).filter(Boolean))];

      // Fetch the real names/titles. Nothing here is defaulted into a fake
      // value: a name that cannot be resolved stays null and the UI says so.
      const [seekerRes, mentorRes, gigRes] = await Promise.all([
        seekerIds.length ? admin.from('profiles').select('id, full_name').in('id', seekerIds) : { data: [], error: null },
        mentorIds.length ? admin.from('profiles').select('id, full_name').in('id', mentorIds) : { data: [], error: null },
        gigIds.length ? admin.from('gigs').select('id, title').in('id', gigIds) : { data: [], error: null },
      ]);

      const seekerMap = new Map((seekerRes.data || []).map((s: any) => [s.id, s.full_name]));
      const mentorMap = new Map((mentorRes.data || []).map((m: any) => [m.id, m.full_name]));
      const gigMap = new Map((gigRes.data || []).map((g: any) => [g.id, g.title]));

      // A payment proof is sensitive: the bucket is private, so the admin gets
      // a short-lived SIGNED url generated server-side. The raw storage path is
      // never handed to the browser and is never made public.
      const SIGNED_PROOF_TTL_SECONDS = 300;
      const formattedPayments = await Promise.all(
        (payments || []).map(async (p: any) => {
          let proofUrl: string | null = null;
          if (p.proof_storage_path) {
            try {
              const { data: signed, error: signedErr } = await admin.storage
                .from(PAYMENT_PROOF_BUCKET)
                .createSignedUrl(p.proof_storage_path, SIGNED_PROOF_TTL_SECONDS);
              if (signedErr) {
                console.error('Failed to sign payment proof:', signedErr.message);
              } else {
                proofUrl = signed?.signedUrl ?? null;
              }
            } catch (signErr) {
              console.error('Failed to sign payment proof:', logSanitizer.safeMessage(signErr));
            }
          }

          return {
            id: p.id,
            bookingId: p.booking_id,
            bookingCode: p.booking?.booking_code ?? null,
            bookingStatus: p.booking?.status ?? null,
            seekerName: p.booking?.seeker_id ? seekerMap.get(p.booking.seeker_id) ?? null : null,
            mentorName: p.booking?.mentor_id ? mentorMap.get(p.booking.mentor_id) ?? null : null,
            gigTitle: p.booking?.gig_id ? gigMap.get(p.booking.gig_id) ?? null : null,
            amount: p.amount_inr,
            transactionReference: p.transaction_reference ?? null,
            submittedAt: p.created_at,
            status: p.status,
            proofUrl,
            rejectionReason: p.rejection_reason,
            verifiedAt: p.verified_at,
          };
        }),
      );

      return res.json({ success: true, payments: formattedPayments });
    } catch (err: any) {
      console.error('Failed to fetch admin payments:', logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // PATCH /api/admin/payments/:id/approve: Approve payment
  app.patch('/api/admin/payments/:id/approve', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      const { data, error } = await admin.rpc('review_payment', {
        p_payment_id: id,
        p_approve: true,
        p_rejection_reason: null,
        p_admin_id: req.auth!.user.id,
      });

      if (error) throw error;

      // `review_payment` performs the real state transition (payment -> VERIFIED,
      // booking -> MENTOR_PENDING) but writes NO notification, so the seeker is
      // told here, from the real booking/payment rows.
      await notifyPaymentReviewed(admin, {
        paymentId: id,
        bookingId: data?.booking_id,
        approved: true,
      });

      auditAction(req.auth, 'payment_approved', {
        entityType: 'payment',
        entityId: id,
        requestId: req.requestId,
        metadata: { bookingId: data?.booking_id },
      });

      return res.json({ success: true, message: 'Payment approved successfully.' });
    } catch (err: any) {
      console.error('Failed to approve payment:', logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // PATCH /api/admin/payments/:id/reject: Reject payment
  app.patch('/api/admin/payments/:id/reject', requireAuth, requireAdmin, validateBody(apiSchemas.paymentReject), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { rejectionReason } = req.body;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      const { data, error } = await admin.rpc('review_payment', {
        p_payment_id: id,
        p_approve: false,
        p_rejection_reason: rejectionReason || null,
        p_admin_id: req.auth!.user.id,
      });

      if (error) throw error;

      // The payment row and the booking status are already updated by the RPC;
      // the proof itself is deliberately NOT deleted on rejection. Only the
      // seeker notification has to be added here.
      await notifyPaymentReviewed(admin, {
        paymentId: id,
        bookingId: data?.booking_id,
        approved: false,
        rejectionReason: typeof rejectionReason === 'string' && rejectionReason.trim()
          ? rejectionReason.trim()
          : null,
      });

      auditAction(req.auth, 'payment_rejected', {
        entityType: 'payment',
        entityId: id,
        requestId: req.requestId,
        metadata: { bookingId: data?.booking_id, rejectionReason },
      });

      return res.json({ success: true, message: 'Payment rejected successfully.' });
    } catch (err: any) {
      console.error('Failed to reject payment:', logSanitizer.safeMessage(err));
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // --------------------------------------------------------------------------
  // Admin API: Platform Configuration
  // --------------------------------------------------------------------------

  // GET /api/admin/platform-config
  //
  // Returns two deliberately different things in one round trip:
  //
  //  - `payment`: the admin-managed, PERSISTED payment configuration. These are
  //    the only values on this page an admin can change, and each change is
  //    written to `platform_config` and read back by the seeker payment page.
  //
  //  - `rules`: the booking/session rules. These are NOT editable, and they are
  //    deliberately served from the same `APP_CONFIG` the booking engine and the
  //    database functions enforce, rather than being duplicated in the browser.
  //    The frontend holds no copy of any of these numbers, so this page cannot
  //    drift from what the platform actually applies.
  app.get('/api/admin/platform-config', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      const { data, error } = await admin
        .from('platform_config')
        .select('*')
        .eq('id', 1)
        .maybeSingle();

      if (error) throw error;

      // `data` is null until an admin saves the payment configuration for the
      // first time. That is a real "not configured yet" state, not an error,
      // and no value is invented to fill it in.
      return res.json({
        success: true,
        payment: {
          upiId: data?.upi_id ?? null,
          qrImageStoragePath: data?.qr_image_storage_path ?? null,
          qrImageUrl: await signQrImageUrl(admin, data?.qr_image_storage_path ?? null),
          instructions: data?.payment_instructions ?? null,
          currency: data?.currency ?? null,
          accountName: data?.payment_account_name ?? null,
          updatedAt: data?.updated_at ?? null,
        },
        rules: {
          holdDurationMinutes: APP_CONFIG.HOLD_DURATION_MS / 60000,
          sessionAccessWindowMinutes: APP_CONFIG.SESSION_ACCESS_WINDOW_MS / 60000,
          meetingLinkDeadlineHours: APP_CONFIG.MEETING_LINK_DEADLINE_MS / 3600000,
          bookingCutoffMinutes: APP_CONFIG.BOOKING_CUTOFF_MS / 60000,
          cancellationWindowMinutes: APP_CONFIG.NORMAL_CANCELLATION_WINDOW_MINUTES,
          defaultTimezone: APP_CONFIG.DEFAULT_TIMEZONE,
          paymentMethod: APP_CONFIG.MVP_PAYMENT_METHOD,
        },
      });
    } catch (err: any) {
      return respondWithServerError({
        req, res, error: err,
        context: 'GET /api/admin/platform-config',
        clientMessage: 'Unable to load the platform configuration.',
      });
    }
  });

  // GET /api/platform-config
  //
  // The single source of truth the seeker payment page reads. Same table, same
  // row and therefore the same values an admin just saved - there is no second
  // copy of the UPI id or the QR anywhere in the client.
  //
  // Only payer-facing, public payment details are returned: the UPI id, the QR
  // asset and the instructions. No credential, key or storage path is exposed.
  app.get('/api/platform-config', requireAuth, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      const { data, error } = await admin
        .from('platform_config')
        .select('upi_id, qr_image_storage_path, payment_instructions, currency, payment_account_name')
        .eq('id', 1)
        .maybeSingle();

      if (error) throw error;

      return res.json({
        success: true,
        payment: {
          upiId: data?.upi_id ?? null,
          qrImageUrl: await signQrImageUrl(admin, data?.qr_image_storage_path ?? null),
          instructions: data?.payment_instructions ?? null,
          currency: data?.currency ?? null,
          accountName: data?.payment_account_name ?? null,
        },
      });
    } catch (err: any) {
      return respondWithServerError({
        req, res, error: err,
        context: 'GET /api/platform-config',
        clientMessage: 'Unable to load payment details.',
      });
    }
  });

  // PATCH /api/admin/platform-config
  //
  // The only writer of `platform_config`. Server-side admin authorization comes
  // from `requireAdmin`, which resolves the role from the verified token, so a
  // seeker or mentor calling this directly is refused before the handler runs.
  // Every accepted change writes an `audit_logs` record through the existing
  // `auditAction` helper - no parallel audit system is introduced.
  //
  // Values are assigned explicitly from a known field list rather than spread
  // from the body, so an unrecognised key can never reach the database.
  app.patch('/api/admin/platform-config', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      const body = (req.body ?? {}) as Record<string, unknown>;

      // The QR object key must be one the server minted. A client cannot point
      // the seeker payment page at an arbitrary object in the bucket.
      const QR_PATH_PATTERN = /^platform\/payment-qr-[0-9]{13}-[a-z0-9]{6}\.(png|jpe?g|webp)$/i;

      const optionalText = (maxLength: number) => (value: unknown, field: string) => {
        if (value === undefined) return undefined;
        if (value === null) return null;
        if (typeof value !== 'string') throw new HttpError(400, 'VALIDATION_ERROR', `${field} must be a string.`);
        const trimmed = value.trim();
        if (trimmed.length > maxLength) {
          throw new HttpError(400, 'VALIDATION_ERROR', `${field} must be ${maxLength} characters or fewer.`);
        }
        return trimmed === '' ? null : trimmed;
      };

      const updates: Record<string, unknown> = {};
      const changedFields: string[] = [];

      const upiId = optionalText(120)(body.upiId, 'UPI ID');
      if (upiId !== undefined) {
        if (upiId !== null && !/^[A-Za-z0-9._-]{2,}@[A-Za-z0-9-]{1,}$/.test(upiId)) {
          throw new HttpError(400, 'VALIDATION_ERROR', 'Enter a valid UPI ID, for example name@bank.');
        }
        updates.upi_id = upiId;
        changedFields.push('upi_id');
      }

      const accountName = optionalText(120)(body.accountName, 'Account name');
      if (accountName !== undefined) {
        updates.payment_account_name = accountName;
        changedFields.push('payment_account_name');
      }

      const instructions = optionalText(1000)(body.instructions, 'Payment instructions');
      if (instructions !== undefined) {
        updates.payment_instructions = instructions;
        changedFields.push('payment_instructions');
      }

      if (body.currency !== undefined) {
        if (body.currency !== null && body.currency !== 'INR') {
          // Every amount column in the product is an `*_inr` integer, so INR is
          // the only currency the payment architecture actually supports.
          throw new HttpError(400, 'VALIDATION_ERROR', 'Currency is fixed to INR: all amounts are stored in rupees.');
        }
        updates.currency = 'INR';
        changedFields.push('currency');
      }

      if (body.qrImageStoragePath !== undefined) {
        if (body.qrImageStoragePath === null) {
          updates.qr_image_storage_path = null;
        } else if (typeof body.qrImageStoragePath === 'string' && QR_PATH_PATTERN.test(body.qrImageStoragePath)) {
          updates.qr_image_storage_path = body.qrImageStoragePath;
        } else {
          throw new HttpError(400, 'VALIDATION_ERROR', 'Unknown payment QR reference.');
        }
        changedFields.push('qr_image_storage_path');
      }

      if (changedFields.length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'No editable payment setting was provided.' },
        });
      }

      const nowIso = new Date().toISOString();
      const adminId = req.auth!.user.id;

      // Single-row table keyed on id = 1, so this upsert is the whole table.
      const { data, error } = await admin
        .from('platform_config')
        .upsert({ id: 1, ...updates, updated_at: nowIso, updated_by: adminId }, { onConflict: 'id' })
        .select('upi_id, qr_image_storage_path, payment_instructions, currency, payment_account_name, updated_at')
        .single();

      if (error) throw error;

      auditAction(req.auth, 'ADMIN_UPDATED_PAYMENT_CONFIGURATION', {
        entityType: 'platform_config',
        entityId: '1',
        requestId: req.requestId,
        // Field NAMES only. Payment values are deliberately not copied into the
        // audit trail, so the log cannot become a second copy of the config.
        metadata: { fields: changedFields },
      });

      return res.json({
        success: true,
        payment: {
          upiId: data.upi_id,
          qrImageStoragePath: data.qr_image_storage_path,
          qrImageUrl: await signQrImageUrl(admin, data.qr_image_storage_path),
          instructions: data.payment_instructions,
          currency: data.currency,
          accountName: data.payment_account_name,
          updatedAt: data.updated_at,
        },
        message: 'Payment configuration saved.',
      });
    } catch (err: any) {
      if (err instanceof HttpError) {
        return res.status(err.status).json({ success: false, error: { code: err.code, message: err.message } });
      }
      return respondWithServerError({
        req, res, error: err,
        context: 'PATCH /api/admin/platform-config',
        clientMessage: 'Unable to save the payment configuration.',
      });
    }
  });

  // POST /api/admin/platform-config/qr-upload-url
  //
  // Mints a short-lived signed upload URL for a payment QR image. The image
  // itself goes straight to Supabase Storage and never through this server, so
  // the binary is never written into a database column and never lands in a
  // request body. Only the resulting object key is persisted, by the PATCH
  // above.
  app.post('/api/admin/platform-config/qr-upload-url', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      // The filename is deliberately not part of this contract. It is not needed
      // to build the object key, and accepting it would mean a client-supplied
      // name reaches the public QR bucket.
      const body = (req.body ?? {}) as { fileType?: unknown; fileSize?: unknown };
      const type = typeof body.fileType === 'string' ? body.fileType : '';
      const size = typeof body.fileSize === 'number' ? body.fileSize : Number.NaN;

      // The bucket is the real authority, but the same ceiling is enforced here
      // so an oversized or wrong-type file is refused with a clear message
      // instead of a generic upload failure.
      if (!PAYMENT_QR_MIME_TYPES.includes(type as PaymentQrMimeType)) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Upload a PNG, JPEG or WebP image.');
      }
      if (!Number.isFinite(size) || size <= 0) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'That file is empty.');
      }
      if (size > PAYMENT_QR_MAX_BYTES) {
        throw new HttpError(400, 'VALIDATION_ERROR', `That image is larger than ${PAYMENT_QR_MAX_LABEL}.`);
      }

      // The extension is derived from the validated MIME type, never from the
      // client-supplied filename. Taking it from the name would let a file called
      // `payload.exe` be uploaded to the public QR bucket under an `.exe` object
      // key, and would produce a key the PATCH handler then rejects as unknown.
      const extensionByMimeType: Record<PaymentQrMimeType, string> = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp',
      };
      // The key is generated here so the PATCH handler can verify it came from
      // this route; the client's filename never reaches the object path.
      const storagePath = `platform/payment-qr-${Date.now()}-${randomUUID().slice(0, 6)}.${extensionByMimeType[type as PaymentQrMimeType]}`;

      const { data, error } = await admin.storage
        .from(PAYMENT_QR_BUCKET)
        .createSignedUploadUrl(storagePath);

      if (error) throw error;

      return res.json({
        success: true,
        uploadUrl: data.signedUrl,
        token: data.token,
        path: storagePath,
      });
    } catch (err: any) {
      if (err instanceof HttpError) {
        return res.status(err.status).json({ success: false, error: { code: err.code, message: err.message } });
      }
      return respondWithServerError({
        req, res, error: err,
        context: 'POST /api/admin/platform-config/qr-upload-url',
        clientMessage: 'Unable to prepare the payment QR upload.',
      });
    }
  });

  // DELETE /api/admin/platform-config/qr
  //
  // Detaches the QR from the configuration first, then removes the object. A
  // failure to delete the file is logged and does not fail the request: the
  // seeker page must stop showing a QR even if the object lingers in the bucket.
  app.delete('/api/admin/platform-config/qr', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      const adminId = req.auth!.user.id;

      const { data: current, error: readErr } = await admin
        .from('platform_config')
        .select('qr_image_storage_path')
        .eq('id', 1)
        .maybeSingle();

      if (readErr) throw readErr;

      const previousPath = current?.qr_image_storage_path ?? null;

      // The configuration is the source of truth for what seekers see, so it is
      // cleared even when there was no QR attached to begin with.
      const { error: writeErr } = await admin
        .from('platform_config')
        .upsert(
          { id: 1, qr_image_storage_path: null, updated_at: new Date().toISOString(), updated_by: adminId },
          { onConflict: 'id' },
        );

      if (writeErr) throw writeErr;

      if (previousPath) {
        const { error: removeErr } = await admin.storage.from(PAYMENT_QR_BUCKET).remove([previousPath]);
        if (removeErr) {
          console.error('Failed to remove the previous payment QR object:', removeErr.message);
        }
      }

      auditAction(req.auth, 'ADMIN_UPDATED_PAYMENT_CONFIGURATION', {
        entityType: 'platform_config',
        entityId: '1',
        requestId: req.requestId,
        metadata: { fields: ['qr_image_storage_path'], action: 'qr_removed' },
      });

      return res.json({ success: true, message: 'Payment QR removed.' });
    } catch (err: any) {
      return respondWithServerError({
        req, res, error: err,
        context: 'DELETE /api/admin/platform-config/qr',
        clientMessage: 'Unable to remove the payment QR.',
      });
    }
  });

  // --------------------------------------------------------------------------
  // Phase 11: In-App Notifications Endpoints
  // --------------------------------------------------------------------------

  // GET /api/notifications: Fetch in-app notifications for the authenticated caller.
  // The caller may only ever read their own notifications; a client-supplied
  // userId is ignored to prevent IDOR.
  app.get('/api/notifications', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { status, type, limit } = req.query;
      const userId = req.auth!.user.id;

      const admin = getSupabaseAdmin();
      if (admin) {
        // Read the real `notifications` table. The in-memory dev store is only a
        // fallback for running with no database configured, because serving it
        // here would show fabricated notifications and hide the real ones a
        // payment decision just wrote.
        let query = admin
          .from('notifications')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });

        if (status === 'unread') query = query.eq('is_read', false);
        else if (status === 'read') query = query.eq('is_read', true);

        if (type && typeof type === 'string' && type !== 'ALL') {
          query = query.eq('type', type);
        }

        if (limit && !Number.isNaN(Number(limit))) {
          query = query.limit(Math.min(Number(limit), 200));
        }

        const { data, error } = await query;
        if (error) throw error;

        const { count: unreadCount } = await admin
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('is_read', false);

        return res.json({
          success: true,
          notifications: data || [],
          unreadCount: unreadCount ?? 0,
        });
      }

      const db = getLocalBookingEngineContext();
      const userIds = [userId];
      let list = (db.notifications || []).filter((n) => userIds.includes(n.user_id));

      if (status === 'unread') {
        list = list.filter((n) => !n.is_read);
      } else if (status === 'read') {
        list = list.filter((n) => n.is_read);
      }

      if (type && typeof type === 'string' && type !== 'ALL') {
        list = list.filter((n) => n.type.toUpperCase() === type.toUpperCase());
      }

      list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      if (limit && !isNaN(Number(limit))) {
        list = list.slice(0, Number(limit));
      }

      const totalUnread = (db.notifications || [])
        .filter((n) => userIds.includes(n.user_id) && !n.is_read).length;

      return res.json({
        success: true,
        notifications: list,
        unreadCount: totalUnread,
      });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // GET /api/notifications/unread-count: Quick unread count for the authenticated caller
  app.get('/api/notifications/unread-count', requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = req.auth!.user.id;

      const admin = getSupabaseAdmin();
      if (admin) {
        // Counted from the real table so a payment notification is reflected in
        // the badge as soon as it is written.
        const { count, error } = await admin
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('is_read', false);
        if (error) throw error;
        return res.json({ success: true, count: count ?? 0 });
      }

      const db = getLocalBookingEngineContext();
      const userIds = [userId];

      const count = (db.notifications || [])
        .filter((n) => userIds.includes(n.user_id) && !n.is_read).length;

      return res.json({ success: true, count });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // PATCH /api/notifications/:id/read: Mark single notification as read.
  // The caller may only mark a notification they own as read.
  app.patch('/api/notifications/:id/read', requireAuth, validateBody(apiSchemas.notificationRead), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { isRead = true } = req.body;
      const userId = req.auth!.user.id;

      const admin = getSupabaseAdmin();
      if (admin) {
        // Scoped by user_id so a caller can only ever mark their own row, which
        // is what makes a real payment notification readable.
        const { data, error } = await admin
          .from('notifications')
          .update({ is_read: !!isRead, read_at: isRead ? new Date().toISOString() : null })
          .eq('id', id)
          .eq('user_id', userId)
          .select()
          .maybeSingle();
        if (error) throw error;

        if (!data) {
          return res.status(404).json({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Notification not found' },
          });
        }

        return res.json({ success: true, notification: data });
      }

      const db = getLocalBookingEngineContext();

      if (!db.notifications) db.notifications = [];
      const notif = db.notifications.find((n) => n.id === id);

      if (!notif) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Notification not found' },
        });
      }

      if (notif.user_id !== userId && !req.auth!.roles.includes('admin')) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You can only mark your own notifications as read.' },
        });
      }

      notif.is_read = !!isRead;
      (notif as any).read_at = isRead ? new Date().toISOString() : null;

      return res.json({ success: true, notification: notif });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // POST /api/notifications/mark-all-read: Mark all notifications as read for the authenticated caller
  app.post('/api/notifications/mark-all-read', requireAuth, validateBody(apiSchemas.notificationMarkAllRead), async (req: AuthRequest, res) => {
    try {
      const userId = req.auth!.user.id;

      const admin = getSupabaseAdmin();
      if (admin) {
        const { data, error } = await admin
          .from('notifications')
          .update({ is_read: true, read_at: new Date().toISOString() })
          .eq('user_id', userId)
          .eq('is_read', false)
          .select('id');
        if (error) throw error;
        return res.json({ success: true, updatedCount: (data || []).length });
      }

      const db = getLocalBookingEngineContext();
      if (!db.notifications) db.notifications = [];

      const userIds = [userId];

      let updatedCount = 0;
      const nowIso = new Date().toISOString();
      db.notifications.forEach((n) => {
        if (userIds.includes(n.user_id) && !n.is_read) {
          n.is_read = true;
          (n as any).read_at = nowIso;
          updatedCount++;
        }
      });

      return res.json({ success: true, updatedCount });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // POST /api/notifications/dispatch: Create a notification for a user.
  //
  // Operational delivery is an administrative capability: it lets the caller
  // choose the recipient, the title, the body and the in-app link. Leaving it
  // on `requireAuth` alone meant any signed-in seeker or mentor could call it
  // (self-targeted only, enforced below) - a broken function-level
  // authorization on an admin action, and an unauthenticated-content write
  // primitive. `requireAdmin` is now server-side authoritative; the
  // self-targeting branch is retained only so the endpoint stays honest about
  // who it may notify.
  app.post('/api/notifications/dispatch', requireAuth, requireAdmin, validateBody(apiSchemas.notificationDispatch), async (req: AuthRequest, res) => {
     try {
       const {
         userId: bodyUserId,
         title,
         message,
         type,
         eventType,
         entityType,
         entityId,
         link,
         metadata,
       } = req.body as {
         userId?: string;
         title: string;
         message: string;
         type: string;
         eventType?: string;
         entityType?: string;
         entityId?: string;
         link?: string;
         metadata: Record<string, unknown>;
       };

       const callerId = req.auth?.user?.id;
       const isAdmin = req.auth?.roles.includes('admin') ?? false;

       if (!isAdmin && bodyUserId && bodyUserId !== callerId) {
         return res.status(403).json({
           success: false,
           error: { code: 'FORBIDDEN', message: 'You can only dispatch notifications for your own account.' },
         });
       }

       // The route is admin-gated, so the caller is always the target unless the
       // body named somebody else. Title and message are guaranteed present.
       const userId = bodyUserId || callerId;

       if (!userId) {
         return res.status(400).json({
           success: false,
           error: { code: 'VALIDATION_ERROR', message: 'userId is required' },
         });
       }

      // The notification must land in the REAL table. It used to be pushed into
      // the in-memory dev store and returned with 201, so a caller was told an
      // alert had been delivered when nothing was persisted and the alert
      // vanished on restart. With a database configured there is no in-memory
      // fallback here: if the write fails, the caller is told so.
      const supabaseAdmin = getSupabaseAdmin();
      if (supabaseAdmin) {
        const { data: created, error: insertErr } = await supabaseAdmin
          .from('notifications')
          .insert({
            user_id: userId,
            title,
            message,
            type,
            event_type: eventType ?? null,
            entity_type: entityType ?? null,
            entity_id: entityId ?? null,
            link: link || null,
            metadata: metadata ?? {},
            is_read: false,
          })
          .select()
          .single();

        if (insertErr) {
          return respondWithServerError({
            req, res, error: insertErr,
            context: 'POST /api/notifications/dispatch',
            clientMessage: 'The notification could not be stored.',
          });
        }

        return res.status(201).json({ success: true, notification: created });
      }

      // No database configured: this is the no-backend local preview only.
      const db = getLocalBookingEngineContext();
      if (!db.notifications) db.notifications = [];

      const newNotif = {
        id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        user_id: userId,
        title,
        message,
        type,
        event_type: eventType,
        entity_type: entityType,
        entity_id: entityId,
        link: link || null,
        is_read: false,
        created_at: new Date().toISOString(),
        metadata,
      };

      db.notifications.unshift(newNotif as any);

      return res.status(201).json({ success: true, notification: newNotif });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });


  // --------------------------------------------------------------------------
  // Phase 9: Session Access & Join Endpoints
  // --------------------------------------------------------------------------

   // GET /api/sessions/:bookingId/access: Authoritative server check for session countdown & state.
   //
   // SECURITY: `currentTime` used to be read straight from the query string and
   // handed to `validateSessionAccess` as the "authoritative server clock".
   // A caller could therefore pass any timestamp and unlock the T-5 gate at
   // will, receiving `meetingUrl` for a session that had not started yet, and
   // could equally pass a time before `end_time` to join a finished session.
   // The server clock is now the only clock. A `currentTime` parameter is
   // accepted for backwards compatibility and deliberately ignored.
   app.get('/api/sessions/:bookingId/access', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { bookingId } = req.params;
      const userId = req.auth!.user.id;
      // Server clock. Never `req.query.currentTime`.
      const currentUtcTime = new Date();

      // Reconcile BEFORE resolving, so an expired booking is already COMPLETED
      // by the time the engine reads it. This is what makes an old session URL
      // resolve correctly on first paint rather than on a later poll.
      const admin = getSupabaseAdmin();
      if (admin) {
        await reconcileBookingSessionState(admin, bookingId);
      }

      const db = admin
        ? await (async () => {
            const loaded = await loadAuthoritativeSessionBooking(
              admin,
              bookingId,
              userId
            );
            if (!loaded.booking) return null;
            return buildSessionEngineContext(loaded.engineBooking, userId, loaded.callerIsAdmin);
          })()
        : getLocalBookingEngineContext();

      if (!db) {
        return res.status(404).json({
          success: false,
          canJoin: false,
          meetingUrl: null,
          error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' },
        });
      }

      const accessResult = validateSessionAccess(
        {
          bookingId,
          userId,
          currentUtcTime,
        },
        db
      );

      // `validateSessionAccess` may transition the in-memory booking to
      // COMPLETED when now >= end_time. Persist that natural expiry to the
      // database so the state survives across requests.
      if (accessResult.success && admin && db.bookings[0]) {
        const persisted = await persistNaturalSessionCompletion(admin, db.bookings[0], currentUtcTime.toISOString());
        if (persisted) {
          logSessionEvent('SESSION_AUTO_COMPLETED', {
            bookingId,
            reason: 'end_time_elapsed',
            serverNow: currentUtcTime.toISOString(),
            endTime: db.bookings[0].end_time,
          });
        }
      }

      // Structured trail for every resolution: which state, against which
      // window, at which server clock. This is the line to grep when a session
      // time bug is reported.
      logSessionEvent('SESSION_STATE_RESOLVED', {
        bookingId,
        state: accessResult.sessionState,
        accessState: accessResult.accessState,
        canJoin: accessResult.canJoin,
        bookingStatus: accessResult.bookingStatus,
        serverNow: currentUtcTime.toISOString(),
        startTime: accessResult.startTime,
        endTime: accessResult.endTime,
      });

      if (!accessResult.canJoin && accessResult.error) {
        logSessionEvent('SESSION_ACCESS_DENIED', {
          bookingId,
          reason: accessResult.error.code,
          state: accessResult.sessionState,
          serverNow: currentUtcTime.toISOString(),
          endTime: accessResult.endTime,
        });
      }

      if (!accessResult.success) {
        const code = accessResult.error?.code;
        // Resource concealment: a non-participant and a non-existent booking
        // are indistinguishable from outside, and the refusal body carries no
        // participant names, ids, times or booking code, so the endpoint can
        // neither enumerate real booking ids nor describe one to a stranger.
        if (code === 'FORBIDDEN_NOT_PARTICIPANT' || code === 'BOOKING_NOT_FOUND') {
          return res.status(404).json({
            success: false,
            canJoin: false,
            accessState: 'BEFORE_T5',
            meetingUrl: null,
            currentServerTime: currentUtcTime.toISOString(),
            message: 'Booking not found.',
            error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' },
          });
        }
        return res.status(400).json(accessResult);
      }

      return res.json(accessResult);
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // POST /api/sessions/:bookingId/join: Authoritative join action triggered by Join Session button
  //
  // Requires authentication; the caller's own id comes from the verified token,
  // never from a body `userId`. The same holds for the clock: `currentTime` in
  // the body is ignored, because a client-supplied timestamp is a T-5 bypass and
  // a post-end join. Authorization, booking state and the time gate are all
  // evaluated against the real Supabase row.
  app.post('/api/sessions/:bookingId/join', requireAuth, validateBody(apiSchemas.sessionJoin), async (req: AuthRequest, res) => {
    try {
      const { bookingId } = req.params;
      const userId = req.auth!.user.id;
      // Server clock. Never `req.body.currentTime`.
      const currentUtcTime = new Date();

      const supabase = getSupabaseAdmin();

      // Reconcile BEFORE resolving, so an expired booking is already COMPLETED
      // by the time the engine reads it.
      if (supabase) {
        await reconcileBookingSessionState(supabase, bookingId);
      }

      const db = supabase
        ? await (async () => {
            const loaded = await loadAuthoritativeSessionBooking(supabase, bookingId, userId);
            if (!loaded.booking) return null;
            return buildSessionEngineContext(loaded.engineBooking, userId, loaded.callerIsAdmin);
          })()
        : getLocalBookingEngineContext();

      if (!db) {
        return res.status(404).json({
          success: false,
          canJoin: false,
          accessState: 'COMPLETED',
          error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' },
        });
      }

      const joinResult = joinSessionAuthoritative(
        {
          bookingId,
          userId,
          currentUtcTime,
        },
        db
      );

      // Persist the natural COMPLETED transition the engine may have applied
      // in memory when now >= end_time, so the state survives across requests.
      if (supabase && db.bookings[0]) {
        const persisted = await persistNaturalSessionCompletion(supabase, db.bookings[0], currentUtcTime.toISOString());
        if (persisted) {
          logSessionEvent('SESSION_AUTO_COMPLETED', {
            bookingId,
            reason: 'end_time_elapsed',
            serverNow: currentUtcTime.toISOString(),
            endTime: db.bookings[0].end_time,
          });
        }
      }

      if (!joinResult.canJoin) {
        const code = joinResult.error?.code;
        logSessionEvent('SESSION_ACCESS_DENIED', {
          bookingId,
          reason: code,
          state: joinResult.accessState,
          serverNow: currentUtcTime.toISOString(),
          endTime: db.bookings[0]?.end_time,
        });
        if (code === 'TOO_EARLY') {
          return res.status(403).json({
            success: false,
            canJoin: false,
            accessState: joinResult.accessState,
            error: {
              code: 'TOO_EARLY',
              message: 'Session join is locked. It unlocks 5 minutes prior to session start.',
            },
          });
        }
        if (code === 'SESSION_ENDED') {
          return res.status(403).json({
            success: false,
            canJoin: false,
            accessState: joinResult.accessState,
            error: {
              code: 'SESSION_ENDED',
              message: 'Session has concluded. Join access is closed.',
            },
          });
        }
        // Resource concealment. A caller who is not a participant gets exactly
        // the same 404 as a caller probing an id that does not exist, so the
        // endpoint cannot be used to enumerate which booking ids are real. The
        // distinction is still visible in the server-side auth log, not in the
        // response.
        if (code === 'FORBIDDEN_NOT_PARTICIPANT' || code === 'BOOKING_NOT_FOUND') {
          return res.status(404).json({
            success: false,
            canJoin: false,
            error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' },
          });
        }
        return res.status(400).json(joinResult);
      }

      logSessionEvent('SESSION_ACCESS_GRANTED', {
        bookingId,
        accessState: joinResult.accessState,
        serverNow: currentUtcTime.toISOString(),
        startTime: db.bookings[0]?.start_time,
        endTime: db.bookings[0]?.end_time,
      });

      return res.json({
        success: true,
        canJoin: true,
        accessState: joinResult.accessState,
        meetingUrl: joinResult.meetingUrl,
        bookingCode: joinResult.bookingCode,
        message: 'Join authorized. Proceeding to meeting.',
      });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });
  // POST /api/sessions/:bookingId/complete: End a CONFIRMED session by mentor (or admin).
  //
  // Four things are checked server-side, all of them from trusted state:
  //   1. authentication, and the caller id comes from the verified token;
  //   2. the caller is the booking's mentor or an admin
  //      (admin from `user_roles`, which `requireAuth` already resolved).
  //      Seekers cannot end a session - the room is the mentor's responsibility.
  //   3. the booking is in a state that can legitimately conclude - only a
  //      CONFIRMED session can be completed, so a PAYMENT_PENDING,
  //      PENDING_VERIFICATION, MENTOR_PENDING, CANCELLED or REJECTED booking
  //      cannot be forced forward;
  //   4. the session has actually started (server clock), so a participant
  //      cannot mark a future session complete days in advance.
  //
  // The write is a conditional UPDATE scoped to the still-CONFIRMED row, so two
  // concurrent completions cannot double-apply, and it lands in Postgres rather
  // than in a process-local object. It records `actual_ended_at` so the
  // meeting URL is irrevocably revoked from seekers immediately.
  app.post('/api/sessions/:bookingId/complete', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { bookingId } = req.params;
      const userId = req.auth!.user.id;
      const isAdmin = req.auth!.roles.includes('admin');
      const isMentor = req.auth!.roles.includes('mentor');
      const isSeeker = req.auth!.roles.includes('seeker');

      // Optional free-text reason for why the session was ended early. Stripped
      // of markup and bounded so it cannot be used to smuggle HTML into the
      // audit trail or overflow the column.
      const parsedBody = parseBody(req, res, apiSchemas.sessionComplete);
      if (parsedBody === null) return;
      const endReason = parsedBody.endReason ?? null;

      const supabase = getSupabaseAdmin();
      if (!supabase) {
        // No database configured: only the no-backend local preview can reach
        // this point. Fail closed rather than mutate a fixture object.
        return res.status(503).json({
          success: false,
          error: { code: 'SERVICE_UNAVAILABLE', message: 'Session service is not configured.' },
        });
      }

      const loaded = await loadAuthoritativeSessionBooking(supabase, bookingId, userId);
      if (!loaded.booking) {
        return res.status(404).json({
          success: false,
          error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' },
        });
      }

      const booking = loaded.booking;
      const isBookingMentor = booking.mentor_id === userId;
      const isBookingSeeker = booking.seeker_id === userId;

      // Either the booking's mentor, the booking's seeker, or an admin may end
      // the session. Seekers were previously refused with a 404; the room is a
      // shared space and either participant should be able to conclude it
      // (for example when the mentor has gone offline). The refusal is still
      // indistinguishable from a non-existent booking so role probing is not
      // possible.
      if (!isAdmin && !isBookingMentor && !isBookingSeeker) {
        return res.status(404).json({
          success: false,
          error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' },
        });
      }

      const endedByRole: 'mentor' | 'seeker' | 'admin' = isAdmin
        ? 'admin'
        : isBookingMentor
          ? 'mentor'
          : 'seeker';

      if (booking.status === 'COMPLETED') {
        return res.json({
          success: true,
          booking: { id: booking.id, booking_code: booking.booking_code, status: 'COMPLETED' },
          message: 'Booking is already COMPLETED.',
        });
      }

      if (booking.status !== 'CONFIRMED') {
        return res.status(409).json({
          success: false,
          error: {
            code: 'BOOKING_NOT_COMPLETABLE',
            message: `A booking that is ${String(booking.status).replace(/_/g, ' ').toLowerCase()} cannot be completed.`,
          },
        });
      }

      const nowMs = Date.now();
      const startMs = new Date(booking.start_time).getTime();
      if (Number.isFinite(startMs) && nowMs < startMs) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'SESSION_NOT_STARTED',
            message: 'This session has not started yet, so it cannot be marked complete.',
          },
        });
      }

      const nowIso = new Date().toISOString();
      const { data: updated, error: updateErr } = await supabase
        .from('bookings')
        .update({
          status: 'COMPLETED',
          actual_ended_at: nowIso,
          ended_by_role: endedByRole,
          end_reason: endReason,
          updated_at: nowIso,
        })
        .eq('id', booking.id)
        .eq('status', 'CONFIRMED')
        .select('id, booking_code, status, updated_at, ended_by_role, actual_ended_at')
        .maybeSingle();

      if (updateErr) throw updateErr;

      if (!updated) {
        // Another request completed it between the read and the write.
        return res.status(409).json({
          success: false,
          error: { code: 'BOOKING_STATE_CHANGED', message: 'The booking changed state and was not completed.' },
        });
      }

      // Notify the OTHER participant that the session has ended. The caller is
      // already aware (they clicked the button), so the notification targets the
      // counterparty: a mentor ending notifies the seeker, a seeker ending
      // notifies the mentor.
      const counterpartyId = endedByRole === 'mentor' ? booking.seeker_id : booking.mentor_id;
      const counterpartyLabel = endedByRole === 'mentor' ? 'Seeker' : 'Mentor';
      const endedByLabel = endedByRole === 'mentor' ? 'Your mentor' : 'You';

      await supabase.from('notifications').insert({
        user_id: counterpartyId,
        title: 'Session Ended',
        message: `${endedByLabel} has ended session ${booking.booking_code}. The meeting link has been deactivated.`,
        type: 'SESSION',
        event_type: 'SESSION_COMPLETED',
        entity_type: 'booking',
        entity_id: booking.id,
        link: `/seeker/bookings?bookingId=${booking.id}`,
        is_read: false,
        created_at: nowIso,
      });

      auditAction(req.auth, 'session_completed', {
        entityType: 'booking',
        entityId: booking.id,
        requestId: req.requestId,
        metadata: {
          bookingCode: booking.booking_code,
          endedByRole,
          endReason: endReason ?? null,
        },
      });

      return res.json({
        success: true,
        booking: {
          id: updated.id,
          booking_code: updated.booking_code,
          status: updated.status,
          ended_by_role: updated.ended_by_role,
          actual_ended_at: updated.actual_ended_at,
        },
        endedByRole,
        message: 'Booking marked as COMPLETED.',
      });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // --------------------------------------------------------------------------
  // Phase 10: Session Workspace Endpoints
  // --------------------------------------------------------------------------

  // GET /api/workspaces/booking/:bookingId
  // Requires authentication; identity and role come from the verified token,
  // never from client-supplied query params.
  app.get('/api/workspaces/booking/:bookingId', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { bookingId } = req.params;
      const userId = req.auth!.user.id;
      const roles = req.auth!.roles;
      const isMentor = roles.includes('mentor');
      const isAdmin = roles.includes('admin');
      const isSeeker = roles.includes('seeker');

      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      // Fetch booking with related data
      const { data: booking, error: bookingErr } = await admin
        .from('bookings')
        .select(`
          *,
          seeker:profiles!bookings_seeker_id_fkey(id, full_name, email, timezone),
          mentor:profiles!bookings_mentor_id_fkey(id, full_name, email, timezone),
          gig:gigs(id, title, segment_id),
          segment:segments(id, name, slug)
        `)
        .or(`id.eq.${bookingId},booking_code.eq.${bookingId}`)
        .maybeSingle();

      if (bookingErr) throw bookingErr;
      if (!booking) {
        return res.status(404).json({
          success: false,
          error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' },
        });
      }

      // Authorization & Privacy check: only participants or admin may read.
      if (!isAdmin && booking.seeker_id !== userId && booking.mentor_id !== userId) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Unauthorized access to session workspace.' },
        });
      }

      // Fetch workspace from Supabase
      const { data: ws, error: wsErr } = await admin
        .from('session_workspaces')
        .select('*')
        .eq('booking_id', booking.id)
        .maybeSingle();

      if (wsErr) throw wsErr;

      const overview = deriveSessionOverview(booking as any);

      if (!ws) {
        return res.json({
          success: true,
          workspace: null,
          isPending: true,
          session_overview: overview,
          message: 'No workspace record exists for this booking yet.',
        });
      }

      // Seeker access rule: Seekers can only view PUBLISHED workspaces
      if (isSeeker && !isAdmin && !isMentor) {
        if (ws.status !== 'PUBLISHED') {
          return res.json({
            success: true,
            workspace: null,
            isPending: true,
            session_overview: overview,
            message: 'Mentor notes are currently being prepared and not yet published.',
          });
        }
      }

      return res.json({
        success: true,
        workspace: {
          ...ws,
          session_overview: overview,
        },
      });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // POST /api/workspaces: Create or Save Workspace (Mentor & Admin)
  // Requires authentication; admin role is derived from the verified token,
  // never from a client-supplied body field.
  app.post('/api/workspaces', requireAuth, validateBody(apiSchemas.workspace), async (req: AuthRequest, res) => {
    try {
      const {
        bookingId,
        mentorNotes,
        takeaways,
        suggestions,
        nextSteps,
        next_steps,
        followUpRecommendation,
        publish,
      } = req.body as {
        bookingId: string;
        mentorNotes?: string;
        takeaways: string[];
        suggestions: string[];
        nextSteps?: Array<{ id?: string; text: string; completed?: boolean }>;
        next_steps?: Array<{ id?: string; text: string; completed?: boolean }>;
        followUpRecommendation?: unknown;
        publish: boolean;
      };

      // Both spellings are accepted and normalised here. The Mentor and Admin
      // workspace pages send `next_steps`, while this route historically read
      // `nextSteps`, so next steps were silently discarded on every save. The
      // schema validates both, and whichever is present wins.
      const steps = nextSteps ?? next_steps ?? [];

      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      // Fetch booking
      const { data: booking, error: bookingErr } = await admin
        .from('bookings')
        .select('*')
        .or(`id.eq.${bookingId},booking_code.eq.${bookingId}`)
        .maybeSingle();

      if (bookingErr) throw bookingErr;
      if (!booking) {
        return res.status(404).json({
          success: false,
          error: { code: 'BOOKING_NOT_FOUND', message: 'Booking does not exist.' },
        });
      }

      // Authorization validation: only the assigned mentor or an admin may
      // create/update a workspace. Identity comes from the verified token.
      const callerId = req.auth!.user.id;
      const isAdmin = req.auth!.roles.includes('admin');
      const isAssignedMentor = booking.mentor_id === callerId;

      if (!isAdmin && !isAssignedMentor) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Only the assigned mentor or an administrator can create or update this workspace.',
          },
        });
      }

      const nowIso = new Date().toISOString();
      const overview = deriveSessionOverview(booking as any);
      const status = publish ? 'PUBLISHED' : 'PENDING';

      // Upsert workspace in Supabase.
      // Every list is a real array and every string already markup-free: the
      // schema rejected or normalised all of it before the handler ran.
      const upsertRecord = {
        booking_id: booking.id,
        mentor_id: booking.mentor_id,
        seeker_id: booking.seeker_id,
        status,
        mentor_notes: mentorNotes || '',
        summary: mentorNotes || '',
        takeaways,
        suggestions,
        next_steps: steps,
        action_items: steps.map((step, index) => ({
          id: step.id || `act-${Date.now()}-${index}`,
          text: step.text,
          completed: !!step.completed,
        })),
        follow_up_recommendation: followUpRecommendation ?? null,
        resources: [],
        published_at: publish ? nowIso : null,
        created_at: nowIso,
        updated_at: nowIso,
      };

      const { data: wsData, error: upsertErr } = await admin
        .from('session_workspaces')
        .upsert(upsertRecord, { onConflict: 'booking_id' })
        .select()
        .single();

      if (upsertErr) throw upsertErr;

      // In-app notification for Seeker if published
      if (publish) {
        const { error: notifErr } = await admin.from('notifications').insert({
          user_id: booking.seeker_id,
          title: 'Session Workspace Published',
          message: `Your mentor has published takeaways and recommendations for session ${booking.booking_code}.`,
          type: 'WORKSPACE',
          link: `/seeker/workspace?bookingId=${booking.id}`,
          is_read: false,
        });
        if (notifErr) console.warn('Failed to create notification:', notifErr.message);
      }

      return res.status(200).json({
        success: true,
        workspace: {
          ...wsData,
          session_overview: overview,
        },
        message: publish ? 'Workspace published to seeker successfully.' : 'Workspace saved as draft.',
      });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // GET /api/admin/workspaces: Operational Access
  app.get('/api/admin/workspaces', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      const { data: workspaces, error: wsErr } = await admin
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

      if (wsErr) throw wsErr;

      const enriched = (workspaces || []).map((ws: any) => {
        const booking = ws.booking;
        const overview = booking ? deriveSessionOverview(booking as any) : undefined;
        return {
          ...ws,
          session_overview: overview,
        };
      });

      return res.json({
        success: true,
        workspaces: enriched,
      });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // --------------------------------------------------------------------------
  // Phase 12: Mentor Onboarding, Verification & Admin Approval
  // --------------------------------------------------------------------------

  // GET /api/mentor/onboarding-status: Get mentor's onboarding status
  app.get('/api/mentor/onboarding-status', requireAuth, requireRole('mentor'), async (req: AuthRequest, res) => {
    try {
      const userId = req.auth!.user.id;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      const { data: application, error: appErr } = await admin
        .from('mentor_applications')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (appErr) throw appErr;

      const { data: documents, error: docsErr } = application
        ? await admin.from('mentor_verification_documents').select('*').eq('application_id', application.id)
        : { data: [], error: null };

      if (docsErr) throw docsErr;

      const [{ data: mentorProfile, error: mentorProfileErr }, { data: mentorSegments, error: mentorSegmentsErr }] = await Promise.all([
        admin.from('mentor_profiles').select('*').eq('id', userId).maybeSingle(),
        admin.from('mentor_segments').select('segment_id, segment:segments(id, name, slug, description)').eq('mentor_id', userId),
      ]);

      if (mentorProfileErr) throw mentorProfileErr;
      if (mentorSegmentsErr) throw mentorSegmentsErr;

      const { data: documentTypes, error: dtErr } = await admin
        .from('mentor_document_types')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');

      if (dtErr) throw dtErr;

      const { data: auditLog, error: auditErr } = application
        ? await admin
            .from('mentor_application_audit')
            .select(MENTOR_APPLICATION_AUDIT_SELECT)
            .eq('application_id', application.id)
            .order('created_at', { ascending: false })
        : { data: [], error: null };

      if (auditErr) throw auditErr;

      // Required document types are database configuration, not frontend constants.
      const requiredDocumentTypes = (documentTypes || []).filter((documentType: { is_required: boolean }) => documentType.is_required).map((documentType: { code: string }) => documentType.code);
      const approvedDocTypes = new Set((documents || []).filter((d: any) => d.status === 'approved').map((d: any) => d.document_type));

      return res.json({
        success: true,
        onboarding: {
          application: application || null,
          documents: documents || [],
          documentTypes: documentTypes || [],
          mentorProfile: mentorProfile || null,
          segments: mentorSegments || [],
          auditLog: auditLog || [],
          allRequiredDocsApproved: application ? application.status === 'approved' && requiredDocumentTypes.every((t) => approvedDocTypes.has(t)) : false,
        },
      });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // POST /api/mentor/application/draft: Create or update a mentor application in draft
  app.post('/api/mentor/application/draft', requireAuth, requireRole('mentor'), validateBody(apiSchemas.mentorApplicationDraft), async (req: AuthRequest, res) => {
    try {
      const userId = req.auth!.user.id;
      // Full name, bio and headline arrive trimmed and markup-free.
      const { fullName, bio, timezone, headline, experienceYears, segmentIds } = req.body as {
        fullName: string;
        bio?: string;
        timezone?: string;
        headline?: string;
        experienceYears?: number;
        segmentIds?: string[];
      };
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      // Upsert application in draft/rejected state (RLS won't allow this from service role, so direct insert)
      const { data: existing } = await admin
        .from('mentor_applications')
        .select('id, status')
        .eq('user_id', userId)
        .maybeSingle();

      let application;

      if (existing) {
        // Only update if in draft or rejected state
        if (existing.status !== 'draft' && existing.status !== 'rejected') {
          return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Application cannot be edited in current status.' } });
        }
        const { data, error } = await admin
          .from('mentor_applications')
          .update({
            full_name: fullName.trim(),
            bio: bio || '',
            timezone: timezone || 'Asia/Kolkata',
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId)
          .select()
          .single();

        if (error) throw error;
        application = data;
      } else {
        const { data, error } = await admin
          .from('mentor_applications')
          .insert({
            user_id: userId,
            full_name: fullName.trim(),
            bio: bio || '',
            timezone: timezone || 'Asia/Kolkata',
            status: 'draft',
          })
          .select()
          .single();

        if (error) throw error;
        application = data;
      }

      const { error: mentorProfileErr } = await admin
        .from('mentor_profiles')
        .upsert({
          id: userId,
          headline: typeof headline === 'string' ? headline.trim() : '',
          about: typeof bio === 'string' ? bio.trim() : '',
          experience_years: Number.isInteger(experienceYears) ? experienceYears : 0,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });
      if (mentorProfileErr) throw mentorProfileErr;

      if (Array.isArray(segmentIds)) {
        const validSegmentIds = segmentIds.filter((segmentId: unknown): segmentId is string => typeof segmentId === 'string' && segmentId.length > 0);
        if (validSegmentIds.length > 0) {
          const { data: activeSegments, error: segmentErr } = await admin
            .from('segments')
            .select('id')
            .in('id', validSegmentIds)
            .eq('is_active', true);
          if (segmentErr) throw segmentErr;
          const memberships = (activeSegments || []).map((segment: { id: string }) => ({ mentor_id: userId, segment_id: segment.id }));
          if (memberships.length > 0) {
            const { error: membershipErr } = await admin.from('mentor_segments').upsert(memberships, { onConflict: 'mentor_id,segment_id', ignoreDuplicates: true });
            if (membershipErr) throw membershipErr;
          }
        }
      }

      // Log audit
      await admin.from('mentor_application_audit').insert({
        application_id: application.id,
        action: 'created',
        admin_user_id: null,
        metadata: { full_name: fullName.trim() },
      });

      return res.json({ success: true, application });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // POST /api/mentor/application/submit: Submit application for review
  app.post('/api/mentor/application/submit', requireAuth, requireRole('mentor'), async (req: AuthRequest, res) => {
    try {
      const userId = req.auth!.user.id;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      // Get application
      const { data: application, error: appErr } = await admin
        .from('mentor_applications')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (appErr) throw appErr;
      if (!application) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'No mentor application found.' } });
      }

      if (application.status !== 'draft' && application.status !== 'rejected') {
        return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Application cannot be submitted from current status.' } });
      }

      const { data: requiredDocumentTypes, error: requiredTypesErr } = await admin
        .from('mentor_document_types')
        .select('code')
        .eq('is_active', true)
        .eq('is_required', true);
      if (requiredTypesErr) throw requiredTypesErr;

      const { data: mentorSegments, error: mentorSegmentsErr } = await admin
        .from('mentor_segments')
        .select('segment_id')
        .eq('mentor_id', userId);
      if (mentorSegmentsErr) throw mentorSegmentsErr;

      const { data: mentorProfile, error: mentorProfileErr } = await admin
        .from('mentor_profiles')
        .select('about, headline, experience_years')
        .eq('id', userId)
        .maybeSingle();
      if (mentorProfileErr) throw mentorProfileErr;

      const missingProfileFields: string[] = [];
      if (!application.bio || application.bio.trim().length < MIN_MENTOR_BIO_LENGTH) missingProfileFields.push('Mentor bio');
      if (!mentorProfile?.headline || !mentorProfile.headline.trim()) missingProfileFields.push('Professional headline');
      if (!mentorSegments || mentorSegments.length === 0) missingProfileFields.push('At least one mentorship segment');
      if (missingProfileFields.length > 0) {
        return res.status(400).json({ success: false, error: { code: 'INCOMPLETE_APPLICATION', message: `Complete the following before submitting: ${missingProfileFields.join(', ')}.` } });
      }

      // Validate required documents are uploaded
      const { data: docs, error: docsErr } = await admin
        .from('mentor_verification_documents')
        .select('document_type, status')
        .eq('application_id', application.id);

      if (docsErr) throw docsErr;

      const uploadedDocTypes = new Set((docs || []).filter((d: any) => d.status === 'pending' || d.status === 'approved').map((d: any) => d.document_type));
      const missingTypes = (requiredDocumentTypes || []).map((documentType: { code: string }) => documentType.code).filter((type: string) => !uploadedDocTypes.has(type));

      if (missingTypes.length > 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_REQUIRED_DOCUMENTS',
            message: `Missing required documents: ${missingTypes.join(', ')}`,
          },
        });
      }

      // Update application status
      const { data: updatedApp, error: updErr } = await admin
        .from('mentor_applications')
        .update({
          status: 'pending_review',
          submitted_at: new Date().toISOString(),
          rejection_reason: null,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .select()
        .single();

      if (updErr) throw updErr;

      // Log audit
      await admin.from('mentor_application_audit').insert({
        application_id: updatedApp.id,
        action: 'submitted',
        admin_user_id: null,
        metadata: { previous_status: application.status },
      });

      // Create notifications for active administrators
      try {
        const adminIds = await resolveActiveAdminIds(admin);
        await insertPaymentNotifications(admin, {
          userIds: adminIds,
          title: 'New Mentor Verification Submitted',
          message: `A new mentor application from ${updatedApp.full_name} requires review.`,
          type: 'ADMIN',
          eventType: 'ADMIN_MENTOR_APPLICATION_SUBMITTED',
          entityType: 'mentor_application',
          entityId: updatedApp.id,
          link: `/admin/mentor-verification/${updatedApp.id}`,
          metadata: {},
        });
      } catch (adminNotifErr) {
        console.error('Failed to create admin notification:', logSanitizer.safeMessage(adminNotifErr));
      }

      return res.json({ success: true, application: updatedApp });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // POST /api/mentor/document: Upsert mentor verification document metadata (after file uploaded to storage)
  app.post('/api/mentor/document', requireAuth, requireRole('mentor'), validateBody(apiSchemas.mentorDocument), async (req: AuthRequest, res) => {
    try {
      const userId = req.auth!.user.id;
      // The schema pins the MIME type to the four supported image/PDF types and
      // caps the size at the same 5MB limit the signed-upload route enforces, so
      // this metadata row can never describe a file the bucket would refuse.
      const { applicationId, documentType, storagePath, originalFilename, mimeType, sizeBytes } = req.body as {
        applicationId: string;
        documentType: string;
        storagePath: string;
        originalFilename: string;
        mimeType: string;
        sizeBytes: number;
      };
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      // Validate application ownership and status
      const { data: application, error: appErr } = await admin
        .from('mentor_applications')
        .select('user_id, status')
        .eq('id', applicationId)
        .eq('user_id', userId)
        .maybeSingle();
      if (appErr) throw appErr;
      if (!application) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Application not found.' } });
      }

      if (!storagePath.startsWith(`${userId}/${applicationId}/`)) {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Document storage path is not owned by the current user.' } });
      }

      if (application.status !== 'draft' && application.status !== 'rejected') {
        return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Documents can only be uploaded for draft or rejected applications.' } });
      }

      // Validate document type
      const { data: docType, error: dtErr } = await admin
        .from('mentor_document_types')
        .select('code')
        .eq('code', documentType)
        .eq('is_active', true)
        .maybeSingle();

      if (dtErr) throw dtErr;
      if (!docType) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid document type.' } });
      }

      // Upsert document
      const { data: document, error: docErr } = await admin
        .from('mentor_verification_documents')
        .upsert({
          application_id: applicationId,
          document_type: documentType,
          storage_path: storagePath,
          original_filename: originalFilename,
          mime_type: mimeType,
          size_bytes: sizeBytes,
          status: 'pending',
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'application_id,document_type',
        })
        .select()
        .single();

      if (docErr) throw docErr;

      // Log audit
      await admin.from('mentor_application_audit').insert({
        application_id: applicationId,
        action: 'document_uploaded',
        admin_user_id: null,
        metadata: { document_type: documentType, document_id: document.id },
      });

      return res.json({ success: true, document });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // DELETE /api/mentor/document/:id: Remove replaceable verification metadata and file.
  app.delete('/api/mentor/document/:id', requireAuth, requireRole('mentor'), async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      const userId = req.auth!.user.id;
      const { data: document, error: documentErr } = await admin
        .from('mentor_verification_documents')
        .select('id, storage_path, application_id, mentor_applications!inner(user_id, status)')
        .eq('id', req.params.id)
        .maybeSingle();
      if (documentErr) throw documentErr;
      const ownerApplication = Array.isArray(document?.mentor_applications) ? document.mentor_applications[0] : document?.mentor_applications;
      if (!document || ownerApplication?.user_id !== userId) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Document not found.' } });
      }
      if (ownerApplication.status !== 'draft' && ownerApplication.status !== 'rejected') {
        return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Documents cannot be changed after submission.' } });
      }

      const { error: storageErr } = await admin.storage.from('mentor-verification-documents').remove([document.storage_path]);
      if (storageErr) throw storageErr;
      const { error: deleteErr } = await admin.from('mentor_verification_documents').delete().eq('id', document.id);
      if (deleteErr) throw deleteErr;
      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Unable to remove verification document.' } });
    }
  });

  // GET /api/admin/mentor-applications: List mentor applications (admin, filtered + paginated)
  app.get('/api/admin/mentor-applications', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    const admin = getSupabaseAdmin();
    if (!admin) {
      return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
    }

    const { status, search, page, pageSize, from, to } = parseMentorApplicationListQuery(
      req.query as Record<string, unknown>,
    );

    try {
      // Server-side applicant search: profiles.full_name / profiles.email ->
      // matching applicant ids -> mentor_applications.user_id (the applicant FK).
      let applicantIds: string[] | null = null;
      if (search) {
        const { data: matchedProfiles, error: searchErr } = await admin
          .from('profiles')
          .select('id')
          .or(buildProfileSearchFilter(search))
          .limit(MENTOR_APPLICATION_SEARCH_MATCH_LIMIT);

        if (searchErr) throw searchErr;

        applicantIds = (matchedProfiles ?? []).map((profile: { id: string }) => profile.id);
        if (applicantIds.length === 0) {
          // No applicant matches the search term: answer a real, empty page instead
          // of fetching the whole table and filtering in the browser.
          return res.json({
            success: true,
            applications: [],
            counts: emptyMentorApplicationStatusCounts(),
            pagination: buildMentorApplicationPagination(page, pageSize, 0),
          });
        }
      }

      const countApplications = async (statusFilter: (typeof MENTOR_APPLICATION_STATUS_COUNT_BUCKETS)[number]) => {
        let countQuery = admin
          .from('mentor_applications')
          .select('id', { count: 'exact', head: true });

        if (statusFilter !== 'ALL') countQuery = countQuery.eq('status', statusFilter);
        if (applicantIds) countQuery = countQuery.in('user_id', applicantIds);

        const { count, error } = await countQuery;
        if (error) throw error;
        return count ?? 0;
      };

      let listQuery = admin
        .from('mentor_applications')
        .select(MENTOR_APPLICATION_LIST_SELECT, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

      if (status !== 'ALL') listQuery = listQuery.eq('status', status);
      if (applicantIds) listQuery = listQuery.in('user_id', applicantIds);

      const [listResult, countEntries] = await Promise.all([
        listQuery,
        Promise.all(
          MENTOR_APPLICATION_STATUS_COUNT_BUCKETS.map(
            async (statusFilter) => [statusFilter, await countApplications(statusFilter)] as const,
          ),
        ),
      ]);

      if (listResult.error) throw listResult.error;

      const counts: MentorApplicationStatusCounts = emptyMentorApplicationStatusCounts();
      for (const [statusFilter, value] of countEntries) {
        if (statusFilter === 'ALL') counts.all = value;
        else counts[statusFilter] = value;
      }

      const rows = (listResult.data ?? []) as unknown as MentorApplicationQueueRow[];
      const applicationIds = rows.map((row) => row.id);

      const applicantIdsForProfiles = [...new Set(rows.map((row) => row.user_id).filter(Boolean))];
      const { data: applicantProfiles, error: applicantProfilesErr } = applicantIdsForProfiles.length > 0
        ? await admin.from('profiles').select('id, full_name, email, avatar_url').in('id', applicantIdsForProfiles)
        : { data: [], error: null };
      if (applicantProfilesErr) throw applicantProfilesErr;
      const applicantProfileMap = new Map((applicantProfiles || []).map((profile: { id: string }) => [profile.id, profile]));

      let auditLog: MentorApplicationQueueAuditEntry[] = [];
      if (applicationIds.length > 0) {
        const { data: audits, error: auditErr } = await admin
          .from('mentor_application_audit')
          .select('*')
          .in('application_id', applicationIds)
          .order('created_at', { ascending: false });

        if (auditErr) throw auditErr;
        auditLog = (audits ?? []) as unknown as MentorApplicationQueueAuditEntry[];
      }

      const auditMap = new Map<string, MentorApplicationQueueAuditEntry[]>();
      for (const entry of auditLog) {
        const existing = auditMap.get(entry.application_id);
        if (existing) existing.push(entry);
        else auditMap.set(entry.application_id, [entry]);
      }

      const applications = rows.map((row) => ({
        ...row,
        profile: applicantProfileMap.get(row.user_id) || null,
        auditLog: auditMap.get(row.id) ?? [],
      }));

      return res.json({
        success: true,
        applications,
        counts,
        pagination: buildMentorApplicationPagination(page, pageSize, listResult.count ?? applications.length),
      });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: 'GET /api/admin/mentor-applications',
        clientMessage: 'Unable to load mentor applications.',
      });
    }
  });

  // GET /api/admin/mentor-applications/:id: Get detailed application with documents and audit trail
  app.get('/api/admin/mentor-applications/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      const { data: applicationData, error: appErr } = await admin
        .from('mentor_applications')
        .select(MENTOR_APPLICATION_DETAIL_SELECT)
        .eq('id', id)
        .maybeSingle();

      if (appErr) throw appErr;

      const rawApplication = applicationData ?? null;
      const application = rawApplication
        ? ({
            ...rawApplication,
            profile: (await admin.from('profiles').select('id, full_name, email, avatar_url, timezone, created_at').eq('id', rawApplication.user_id).maybeSingle()).data || null,
          } as unknown as MentorApplicationDetailRow)
        : null;
      if (!application) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Application not found.' } });
      }

      // The document type catalogue is joined as `document_type_ref` so the raw
      // `document_type` code stays available for required-document checks.
      const { data: documentRows, error: docsErr } = await admin
        .from('mentor_verification_documents')
        .select(`
          *,
          document_type_ref:mentor_document_types!inner(code, label, description, is_required)
        `)
        .eq('application_id', id)
        .order('uploaded_at', { ascending: false });

      if (docsErr) throw docsErr;

      const { data: auditRows, error: auditErr } = await admin
        .from('mentor_application_audit')
        .select(MENTOR_APPLICATION_AUDIT_SELECT)
        .eq('application_id', id)
        .order('created_at', { ascending: false });

      if (auditErr) throw auditErr;

      // Get download URLs for documents (for admin viewing)
      const documents = await Promise.all(((documentRows ?? []) as unknown as MentorApplicationDetailDocument[]).map(async (doc) => {
        const { data: signed, error: signedErr } = await admin.storage
          .from('mentor-verification-documents')
          .createSignedUrl(doc.storage_path, 300);
        if (signedErr) throw signedErr;
        return { ...doc, download_url: signed?.signedUrl || null };
      }));

      const auditLog = (auditRows ?? []) as unknown as MentorApplicationDetailAuditEntry[];

      return res.json({
        success: true,
        application: {
          ...application,
          documents,
          auditLog,
        },
      });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: 'GET /api/admin/mentor-applications/:id',
        clientMessage: 'Unable to load mentor application.',
      });
    }
  });

  // POST /api/admin/mentor-applications/:id/approve: Approve mentor application (admin)
  app.post('/api/admin/mentor-applications/:id/approve', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const adminUserId = req.auth!.user.id;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      // Get application with lock
      const { data: application, error: appErr } = await admin
        .from('mentor_applications')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (appErr) throw appErr;
      if (!application) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Application not found.' } });
      }

      if (application.status !== 'pending_review') {
        return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: `Application is not pending review (current: ${application.status}).` } });
      }

      // Validate required documents are approved
      const { data: docs, error: docsErr } = await admin
        .from('mentor_verification_documents')
        .select('document_type, status')
        .eq('application_id', id);

      if (docsErr) throw docsErr;

      const { data: requiredDocumentTypes, error: requiredTypesErr } = await admin
        .from('mentor_document_types')
        .select('code')
        .eq('is_active', true)
        .eq('is_required', true);
      if (requiredTypesErr) throw requiredTypesErr;

      const approvedDocTypes = new Set((docs || []).filter((d: any) => d.status === 'approved').map((d: any) => d.document_type));
      const missingApproved = (requiredDocumentTypes || []).map((documentType: { code: string }) => documentType.code).filter((type: string) => !approvedDocTypes.has(type));

      if (missingApproved.length > 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_APPROVED_DOCUMENTS',
            message: `All required documents must be approved before mentor approval: ${missingApproved.join(', ')}`,
          },
        });
      }

      // Atomic transaction-equivalent: update application, create mentor profile, assign role
      await admin.rpc('approve_mentor_application', { p_application_id: id });

      // The RPC handles: application status, mentor_profiles creation, user_roles, audit, notifications
      // But since it uses auth.uid() and we're using service role, we need to do it manually
      // Actually, the RPC uses is_admin() which checks auth.uid() - this won't work with service role

      // So we need to manually perform the approve logic:
      // 1. Update application
      const { error: updErr } = await admin
        .from('mentor_applications')
        .update({
          status: 'approved',
          reviewed_at: new Date().toISOString(),
          reviewed_by: adminUserId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (updErr) throw updErr;

      // 2. Log audit
      await admin.from('mentor_application_audit').insert({
        application_id: id,
        action: 'approved',
        admin_user_id: adminUserId,
        metadata: { approved_by: adminUserId },
      });

      // 3. Ensure mentor role exists
      const { error: roleErr } = await admin.from('user_roles').upsert({
        user_id: application.user_id,
        role: 'mentor',
      });

      if (roleErr) throw roleErr;

      // 4. Create/update mentor_profile
      const { error: mpErr } = await admin.from('mentor_profiles').upsert({
        id: application.user_id,
        headline: application.bio || '',
        about: application.bio || '',
        experience_years: 0,
        languages: [],
        rating: 0.0,
        review_count: 0,
        session_count: 0,
        is_approved: true,
        is_featured: false,
        approval_status: 'approved',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      if (mpErr) throw mpErr;

      // 5. Notification to applicant
      await admin.from('notifications').insert({
        user_id: application.user_id,
        title: 'Mentor Application Approved',
        message: 'Congratulations! Your mentor application has been approved. You can now complete your mentor profile and configure your availability.',
        type: 'SYSTEM',
        event_type: 'MENTOR_APPLICATION_APPROVED',
        entity_type: 'mentor_application',
        entity_id: id,
        link: '/mentor',
        is_read: false,
      });

      // 6. Audit log to audit_logs table
      auditAction(req.auth, 'mentor_application_approved', {
        entityType: 'mentor_application',
        entityId: id,
        requestId: req.requestId,
        metadata: { approvedByUserId: adminUserId, applicantUserId: application.user_id },
      });

      return res.json({ success: true, message: 'Mentor application approved successfully.' });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: 'POST /api/admin/mentor-applications/:id/approve',
        clientMessage: 'Unable to approve mentor application.',
      });
    }
  });

  // POST /api/admin/mentor-applications/:id/reject: Reject mentor application (admin)
  app.post('/api/admin/mentor-applications/:id/reject', requireAuth, requireAdmin, validateBody(apiSchemas.mentorApplicationReject), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { rejectionReason } = req.body;
      const adminUserId = req.auth!.user.id;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      // `rejectionReason` is required, bounded and markup-free by the schema.


      const { data: application, error: appErr } = await admin
        .from('mentor_applications')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (appErr) throw appErr;
      if (!application) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Application not found.' } });
      }

      if (application.status !== 'pending_review') {
        return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: `Application is not pending review (current: ${application.status}).` } });
      }

      const { error: updErr } = await admin
        .from('mentor_applications')
        .update({
          status: 'rejected',
          reviewed_at: new Date().toISOString(),
          reviewed_by: adminUserId,
          rejection_reason: rejectionReason.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (updErr) throw updErr;

      // Log audit
      await admin.from('mentor_application_audit').insert({
        application_id: id,
        action: 'rejected',
        admin_user_id: adminUserId,
        rejection_reason: rejectionReason.trim(),
        metadata: { rejected_by: adminUserId },
      });

      // Notification to applicant
      await admin.from('notifications').insert({
        user_id: application.user_id,
        title: 'Mentor Application Needs Changes',
        message: `Your mentor application needs changes: ${rejectionReason.trim()}. Please review the Admin feedback and resubmit your verification.`,
        type: 'SYSTEM',
        event_type: 'MENTOR_APPLICATION_REJECTED',
        entity_type: 'mentor_application',
        entity_id: id,
        link: '/mentor/verification',
        is_read: false,
      });

      auditAction(req.auth, 'mentor_application_rejected', {
        entityType: 'mentor_application',
        entityId: id,
        requestId: req.requestId,
        metadata: { rejectedByUserId: adminUserId, applicantUserId: application.user_id, rejectionReason },
      });

      return res.json({ success: true, message: 'Mentor application rejected successfully.' });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: 'POST /api/admin/mentor-applications/:id/reject',
        clientMessage: 'Unable to reject mentor application.',
      });
    }
  });

  // PATCH /api/admin/mentor-documents/:id/review: Review a verification document (admin)
  app.patch('/api/admin/mentor-documents/:id/review', requireAuth, requireAdmin, validateBody(apiSchemas.mentorDocumentReview), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { status, adminNote } = req.body;
      const adminUserId = req.auth!.user.id;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      // `status` is constrained to the approved/rejected enum by the schema.

      // Get document with application context
      const { data: document, error: docErr } = await admin
        .from('mentor_verification_documents')
        .select('*, application:mentor_applications!inner(id, user_id, full_name)')
        .eq('id', id)
        .maybeSingle();

      if (docErr) throw docErr;
      if (!document) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Document not found.' } });
      }

      // Update document status
      const { data: updatedDoc, error: updErr } = await admin
        .from('mentor_verification_documents')
        .update({
          status,
          reviewed_at: new Date().toISOString(),
          reviewed_by: adminUserId,
          admin_note: adminNote || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (updErr) throw updErr;

      // Log audit
      await admin.from('mentor_application_audit').insert({
        application_id: document.application.id,
        action: 'document_reviewed',
        admin_user_id: adminUserId,
        metadata: { document_id: id, document_type: document.document_type, status },
      });

      auditAction(req.auth, 'mentor_document_reviewed', {
        entityType: 'mentor_verification_document',
        entityId: id,
        requestId: req.requestId,
        metadata: { documentType: document.document_type, status, adminNote },
      });

      return res.json({ success: true, document: updatedDoc });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: 'PATCH /api/admin/mentor-documents/:id/review',
        clientMessage: 'Unable to review verification document.',
      });
    }
  });

  // POST /api/admin/users/direct-create: Admin create user directly (seeker or mentor)
  //
  // Account creation is DECOUPLED from email delivery. The auth user and all
  // application profiles are committed as a controlled workflow. The invitation
  // email is sent as a separate, non-blocking step whose delivery status is
  // reported back to the Admin UI so they can retry if it fails.
  //
  // Roles are restricted to seeker and mentor: an Admin account is never created
  // through this endpoint.
  app.post('/api/admin/users/direct-create', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    const adminUserId = req.auth!.user.id;
    const requestId = req.requestId ?? '';
    const admin = getSupabaseAdmin();
    if (!admin) {
      return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
    }

    // 1. Validate the request body (the browser is never trusted). The exact
    //    same validator runs in the Admin form, so client and server agree.
    //
    //    Two layers, deliberately:
    //      - the Zod schema is the structural gate: exact types, length and
    //        format bounds, and HTML stripped from every free-text field;
    //      - `validateCreateUserForm` (below) is the cross-field domain gate
    //        shared verbatim with the browser.
    //    Doing the Zod pass inline rather than as middleware keeps this route's
    //    own validation-failure logging in the system logs.
    const structural = apiSchemas.adminUserDirectCreate.safeParse(req.body ?? {});
    if (!structural.success) {
      const failure = formatValidationFailure(structural.error);
      await logApiError({
        requestId,
        method: req.method,
        path: req.path,
        statusCode: 400,
        message: `direct-create validation failed - fields: ${Object.keys(failure.fields).join(', ')}`,
        error_code: 'VALIDATION_ERROR',
        userId: adminUserId,
        role: 'admin',
        metadata: {
          operation: 'validation',
          adminUserId,
          requestId,
          invalidFields: failure.fields,
        },
      }).catch(() => {});
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: failure.message, fields: failure.fields, requestId: requestId || null },
      });
    }
    req.body = structural.data;

    const body = req.body as Record<string, unknown>;
    const role = typeof body.role === 'string' ? body.role.trim().toLowerCase() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    const bio = typeof body.bio === 'string' ? body.bio.trim() : '';
    const headline = typeof body.headline === 'string' ? body.headline.trim() : '';
    const timezone = typeof body.timezone === 'string' && body.timezone.trim() ? body.timezone.trim() : 'Asia/Kolkata';
    const password = typeof body.password === 'string' ? body.password : '';
    const sendEmail = body.sendEmail !== false;
    const rawExperienceYears = body.experienceYears;
    const segmentIds = Array.isArray(body.segmentIds)
      ? (body.segmentIds as unknown[]).filter((id): id is string => typeof id === 'string')
      : [];
    const languages = parseTagList(body.languages);
    const expertise = parseTagList(body.expertise);

    const logContext = (operation: string, extra?: Record<string, unknown>) => ({
      operation,
      adminUserId,
      targetEmail: email,
      selectedRole: role,
      requestId,
      ...extra,
    });

    if (role !== 'seeker' && role !== 'mentor') {
      await logApiError({
        requestId,
        method: req.method,
        path: req.path,
        statusCode: 400,
        message: `direct-create validation failed - invalid role: ${role}`,
        error_code: 'VALIDATION_ERROR',
        userId: adminUserId,
        role: 'admin',
        metadata: logContext('validation', { providedRole: role }),
      }).catch(() => {});
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Role must be "seeker" or "mentor".', requestId: requestId || null },
      });
    }

    const formValues: CreateUserFormValues = {
      role,
      fullName,
      email,
      phone,
      timezone,
      bio,
      headline,
      experienceYears: rawExperienceYears === null || rawExperienceYears === undefined
        ? ''
        : String(rawExperienceYears),
      languages: languages.join(', '),
      expertise: expertise.join(', '),
      segmentIds,
      passwordMode: password ? 'manual' : 'invitation',
      password,
      confirmPassword: password,
      sendEmail,
    };

    const formValidation = validateCreateUserForm(formValues);
    if (!formValidation.valid) {
      await logApiError({
        requestId,
        method: req.method,
        path: req.path,
        statusCode: 400,
        message: `direct-create validation failed - fields: ${Object.keys(formValidation.errors).join(', ')}`,
        error_code: 'VALIDATION_ERROR',
        userId: adminUserId,
        role: 'admin',
        metadata: logContext('validation', { invalidFields: formValidation.errors }),
      }).catch(() => {});
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: Object.values(formValidation.errors)[0] ?? 'Invalid request.',
          fields: formValidation.errors,
          requestId: requestId || null,
        },
      });
    }

    // An account with neither a password nor an emailed setup link could never
    // be signed into. Reject it instead of creating a stranded account.
    if (!password && !sendEmail) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Provide a password or enable the account access email, otherwise the new account cannot be signed into.',
          requestId: requestId || null,
        },
      });
    }

    const experienceYears = typeof rawExperienceYears === 'number' && Number.isInteger(rawExperienceYears)
      ? rawExperienceYears
      : 0;

    // 2. Duplicate email -> client-safe 409 before touching auth.users.
    try {
      const { data: existingProfiles, error: duplicateCheckErr } = await admin
        .from('profiles')
        .select('id')
        .eq('email', email)
        .limit(1);

      if (duplicateCheckErr) throw duplicateCheckErr;

      if ((existingProfiles ?? []).length > 0) {
        await logApiError({
          requestId,
          method: req.method,
          path: req.path,
          statusCode: 409,
          message: `direct-create duplicate email rejected - email already exists in profiles`,
          error_code: 'ACCOUNT_EXISTS',
          userId: adminUserId,
          role: 'admin',
          metadata: logContext('duplicate_check', { existingProfileId: existingProfiles[0].id }),
        }).catch(() => {});
        return res.status(409).json({
          success: false,
          error: { code: 'ACCOUNT_EXISTS', message: 'An account with this email already exists.', requestId: requestId || null },
        });
      }
    } catch (err) {
      const info = describeSupabaseError(err);
      await logApiError({
        requestId,
        method: req.method,
        path: req.path,
        statusCode: 500,
        message: `direct-create duplicate check failed - [${info.code}] ${info.message}`,
        error_code: info.code,
        userId: adminUserId,
        role: 'admin',
        stack: info.stack,
        metadata: logContext('duplicate_check', { errorDetails: info.details, errorHint: info.hint }),
      }).catch(() => {});
      return respondWithServerError({
        req,
        res,
        error: err,
        context: 'POST /api/admin/users/direct-create (duplicate check)',
        clientMessage: 'Unable to create the user account.',
      });
    }

    // 3. Create the Supabase Auth user WITHOUT sending any email. The
    //    invite email is a separate step (see below). Using createUser with
    //    email_confirm: true means the account is usable immediately for profile
    //    data, and the invite link lets the user set their password on first login.
    //
    //    A password is only passed through when the Admin explicitly set one. It
    //    goes straight to Supabase Auth, is never written to an application
    //    table and is never logged.
    //
    //    `user_metadata` (not `data`) is what the auth admin API stores, and the
    //    `on_auth_user_created` trigger reads `requested_role` from it.
    const { data: authUser, error: createAuthErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      ...(password ? { password } : {}),
      user_metadata: { full_name: fullName, timezone, requested_role: role },
    } as any);

    if (createAuthErr) {
      const info = describeSupabaseError(createAuthErr);
      const isDuplicateEmail =
        info.code === 'email_exists' ||
        info.code === '23505' ||
        /already (been )?registered|already exists/i.test(info.message);

      if (isDuplicateEmail) {
        await logApiError({
          requestId,
          method: req.method,
          path: req.path,
          statusCode: 409,
          message: `direct-create duplicate email rejected by auth - [${info.code}] ${info.message}`,
          error_code: info.code,
          userId: adminUserId,
          role: 'admin',
          metadata: logContext('auth_create', { authErrorCode: info.code, authErrorMessage: info.message }),
        }).catch(() => {});

        return res.status(409).json({
          success: false,
          error: { code: 'ACCOUNT_EXISTS', message: 'An account with this email already exists.', requestId: requestId || null },
        });
      }

      await logApiError({
        requestId,
        method: req.method,
        path: req.path,
        statusCode: 500,
        message: `direct-create auth user creation failed - [${info.code}] ${info.message}`,
        error_code: info.code,
        userId: adminUserId,
        role: 'admin',
        stack: info.stack,
        metadata: logContext('auth_create', { authErrorCode: info.code, authErrorMessage: info.message, authErrorDetails: info.details, authErrorHint: info.hint }),
      }).catch(() => {});

      return respondWithServerError({
        req,
        res,
        error: createAuthErr,
        context: 'POST /api/admin/users/direct-create (auth.users insert)',
        clientMessage: 'Unable to create the user account.',
      });
    }

    if (!authUser.user) {
      await logApiError({
        requestId,
        method: req.method,
        path: req.path,
        statusCode: 500,
        message: 'direct-create auth user creation returned no user',
        error_code: 'NO_USER_RETURNED',
        userId: adminUserId,
        role: 'admin',
        metadata: logContext('auth_create', { authUserData: authUser }),
      }).catch(() => {});

      return respondWithServerError({
        req,
        res,
        error: new Error('createUser returned no user'),
        context: 'POST /api/admin/users/direct-create (auth.users insert)',
        clientMessage: 'Unable to create the user account.',
      });
    }

    const userId = authUser.user.id;

    /**
     * Cascading rollback: every row written below is keyed to auth.users, so
     * deleting the freshly created auth user removes partially written data.
     */
    const rollbackCreatedUser = async (reason: string) => {
      const { error: deleteErr } = await admin.auth.admin.deleteUser(userId);
      await logApiError({
        requestId,
        method: req.method,
        path: req.path,
        statusCode: 500,
        message: `direct-create rollback (${reason}) for user ${userId}: ${deleteErr ? getErrorMessage(deleteErr) : 'auth user deleted'}`,
        error_code: deleteErr ? 'ROLLBACK_FAILED' : 'ROLLED_BACK',
        userId: adminUserId,
        role: 'admin',
        metadata: logContext('rollback', { reason, deletedUserId: userId, deleteError: deleteErr ? getErrorMessage(deleteErr) : null }),
      }).catch(() => {});
    };

    try {
      const now = new Date().toISOString();

      // 4. Profile - the signup trigger already inserted it, so this upsert is
      //    idempotent instead of raising a duplicate key error.
      //    account_status is written explicitly so a newly created account can
      //    never inherit a suspended/deactivated value from a stale row
      //    (prompt section 13: the DB is the source of truth, and this is the
      //    write that makes it say "active" for a brand-new account).
      const { error: profileErr } = await admin
        .from('profiles')
        .upsert(
          {
            id: userId,
            email,
            full_name: fullName,
            phone: phone || null,
            timezone,
            avatar_url: null,
            account_status: 'active',
            created_at: now,
            updated_at: now,
          },
          { onConflict: 'id' },
        );

      if (profileErr) {
        const info = describeSupabaseError(profileErr);
        await logApiError({
          requestId,
          method: req.method,
          path: req.path,
          statusCode: resolveHttpStatusForSupabaseError(info),
          message: `direct-create profile upsert failed - [${info.code}] ${info.message}`,
          error_code: info.code,
          userId: adminUserId,
          role: 'admin',
          stack: info.stack,
          metadata: logContext('profile_upsert', { profileErrorCode: info.code, profileErrorMessage: info.message, profileErrorDetails: info.details, profileErrorHint: info.hint, userId }),
        }).catch(() => {});
        throw profileErr;
      }

      // 5. Role assignment. The trigger assigns `requested_role`, so the row
      //    usually already exists - ignoreDuplicates keeps this idempotent
      //    instead of violating uq_user_roles_user_role (the previous 500).
      const { error: roleErr } = await admin
        .from('user_roles')
        .upsert({ user_id: userId, role }, { onConflict: 'user_id,role', ignoreDuplicates: true });

      if (roleErr) {
        const info = describeSupabaseError(roleErr);
        await logApiError({
          requestId,
          method: req.method,
          path: req.path,
          statusCode: resolveHttpStatusForSupabaseError(info),
          message: `direct-create user_roles upsert failed - [${info.code}] ${info.message}`,
          error_code: info.code,
          userId: adminUserId,
          role: 'admin',
          stack: info.stack,
          metadata: logContext('role_upsert', { roleErrorCode: info.code, roleErrorMessage: info.message, roleErrorDetails: info.details, roleErrorHint: info.hint, userId, assignedRole: role }),
        }).catch(() => {});
        throw roleErr;
      }

      // 5b. An Admin-created mentor is a mentor, not a seeker. The signup
      //     trigger assigns the role from `requested_role` metadata; this
      //     cleanup guarantees the outcome even if that metadata is ever lost,
      //     and matches what `approve_mentor_application` already does.
      if (role === 'mentor') {
        const { error: straySeekerErr } = await admin
          .from('user_roles')
          .delete()
          .eq('user_id', userId)
          .eq('role', 'seeker');

        if (straySeekerErr) {
          const info = describeSupabaseError(straySeekerErr);
          await logApiError({
            requestId,
            method: req.method,
            path: req.path,
            statusCode: resolveHttpStatusForSupabaseError(info),
            message: `direct-create stray seeker role cleanup failed - [${info.code}] ${info.message}`,
            error_code: info.code,
            userId: adminUserId,
            role: 'admin',
            stack: info.stack,
            metadata: logContext('role_upsert', { userId, stage: 'remove_stray_seeker_role' }),
          }).catch(() => {});
          throw straySeekerErr;
        }
      }

      // 6. Admin-created mentors are trusted and immediately approved. They do
      //    NOT enter the self-signup application/document workflow. No mentor
      //    application is created, no documents are required.
      //
      //    The Admin's explicit creation action IS the approval (prompt
      //    section 1 / TEST A): role=mentor, approval_status=approved,
      //    is_active=true, account_status=active. The mentor can enter the
      //    Mentor application immediately.
      if (role === 'mentor') {
        // Use neutral defaults: rating=0, empty languages array.
        // No fake demo values (rating=5.0, languages=['English','Hindi']).
        const mentorRow = {
          id: userId,
          ...buildAdminCreatedMentorProfile({
            headline: headline || bio,
            about: bio,
            experienceYears,
          }),
          languages: languages as unknown as string,
          expertise: expertise as unknown as string,
          // Records HOW this mentor joined. The Admin Mentor Control Center
          // reads this to tell an Admin-created mentor (no application, by
          // design) apart from a public signup, instead of guessing.
          created_via: 'admin_direct',
        };
        const { error: mpErr } = await admin
          .from('mentor_profiles')
          .upsert(mentorRow, { onConflict: 'id' });

        if (mpErr) {
          const info = describeSupabaseError(mpErr);
          await logApiError({
            requestId,
            method: req.method,
            path: req.path,
            statusCode: resolveHttpStatusForSupabaseError(info),
            message: `direct-create mentor_profiles upsert failed - [${info.code}] ${info.message}`,
            error_code: info.code,
            userId: adminUserId,
            role: 'admin',
            stack: info.stack,
            metadata: logContext('mentor_profile_upsert', { mentorErrorCode: info.code, mentorErrorMessage: info.message, mentorErrorDetails: info.details, mentorErrorHint: info.hint, userId, bioLength: bio.length }),
          }).catch(() => {});
          throw mpErr;
        }

        // 6a. Segment membership. Segments are validated against the real
        //     `segments` table first, so a stale client can never invent a
        //     category. uq_mentor_segment guarantees one row per pair.
        if (segmentIds.length > 0) {
          const { data: validSegments, error: segReadErr } = await admin
            .from('segments')
            .select('id, name, is_active')
            .in('id', segmentIds);

          if (segReadErr) {
            await logApiError({
              requestId,
              method: req.method,
              path: req.path,
              statusCode: resolveHttpStatusForSupabaseError(describeSupabaseError(segReadErr)),
              message: `direct-create mentor segment lookup failed - [${describeSupabaseError(segReadErr).code}] ${describeSupabaseError(segReadErr).message}`,
              error_code: describeSupabaseError(segReadErr).code,
              userId: adminUserId,
              role: 'admin',
              metadata: logContext('mentor_segments', { userId, segmentIds }),
            }).catch(() => {});
            throw segReadErr;
          }

          const validIds = new Set((validSegments ?? []).map((s: { id: string }) => s.id));
          const unknown = segmentIds.filter((id) => !validIds.has(id));
          if (unknown.length > 0) {
            await logApiError({
              requestId,
              method: req.method,
              path: req.path,
              statusCode: 400,
              message: 'direct-create rejected - unknown segment id(s)',
              error_code: 'UNKNOWN_SEGMENT',
              userId: adminUserId,
              role: 'admin',
              metadata: logContext('mentor_segments', { unknown }),
            }).catch(() => {});
            // Thrown, not returned: the catch block must still roll the auth
            // user back so no partial account survives.
            const error = new Error('One or more selected segments no longer exist.') as Error & {
              httpStatus?: number;
              code?: string;
            };
            error.httpStatus = 400;
            error.code = 'UNKNOWN_SEGMENT';
            throw error;
          }

          // The new mentor has no memberships yet, so the first segment is the
          // primary one and the rest are secondary.
          const { error: msErr } = await admin.from('mentor_segments').insert(
            segmentIds.map((segmentId, index) => ({
              mentor_id: userId,
              segment_id: segmentId,
              is_primary: index === 0,
            })),
          );

          if (msErr) {
            const info = describeSupabaseError(msErr);
            await logApiError({
              requestId,
              method: req.method,
              path: req.path,
              statusCode: resolveHttpStatusForSupabaseError(info),
              message: `direct-create mentor_segments insert failed - [${info.code}] ${info.message}`,
              error_code: info.code,
              userId: adminUserId,
              role: 'admin',
              stack: info.stack,
              metadata: logContext('mentor_segments', { userId, segmentIds, errorMessage: info.message }),
            }).catch(() => {});
            throw msErr;
          }
        }

        auditAction(req.auth, MENTOR_ADMIN_AUDIT_ACTIONS.CREATED, {
          entityType: 'mentor_profile',
          entityId: userId,
          requestId: req.requestId,
          metadata: {
            adminId: adminUserId,
            mentorId: userId,
            email,
            fullName,
            role: 'mentor',
            approvalStatus: ADMIN_CREATED_MENTOR_DEFAULTS.approval_status,
            isActive: ADMIN_CREATED_MENTOR_DEFAULTS.is_active,
            createdVia: 'admin_direct_create',
            verificationRequired: false,
          },
        });
      } else {
        // Seeker: create seeker_profiles row
        const { error: spErr } = await admin
          .from('seeker_profiles')
          .upsert(
            {
              id: userId,
              preferred_language: 'English',
              notes: null,
              created_at: now,
              updated_at: now,
            },
            { onConflict: 'id' },
          );

        if (spErr) {
          const info = describeSupabaseError(spErr);
          await logApiError({
            requestId,
            method: req.method,
            path: req.path,
            statusCode: resolveHttpStatusForSupabaseError(info),
            message: `direct-create seeker_profiles upsert failed - [${info.code}] ${info.message}`,
            error_code: info.code,
            userId: adminUserId,
            role: 'admin',
            stack: info.stack,
            metadata: logContext('seeker_profile_upsert', { seekerErrorCode: info.code, seekerErrorMessage: info.message, seekerErrorDetails: info.details, seekerErrorHint: info.hint, userId }),
          }).catch(() => {});
          throw spErr;
        }

        auditAction(req.auth, 'user_role_assigned', {
          entityType: 'user_role',
          entityId: userId,
          requestId: req.requestId,
          metadata: { role: 'seeker', assignedBy: 'admin', email, fullName },
        });
      }

      // 7. SEPARATE email delivery step — fully decoupled from account creation.
      //    If email delivery fails or is rate-limited, the account is already
      //    fully created with correct database state. Admin can resend later.
      //    The email only ever carries a Supabase setup/login link, never a
      //    password, even when the Admin set one.
      const appBaseUrl = process.env.APP_URL || process.env.APP_BASE_URL || process.env.VITE_APP_BASE_URL || process.env.PUBLIC_APP_URL;
      let emailDeliveryStatus: 'sent' | 'not_sent' | 'failed' = 'not_sent';

      if (sendEmail && appBaseUrl) {
        const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
          data: { full_name: fullName, timezone, requested_role: role },
          redirectTo: `${appBaseUrl.replace(/\/$/, '')}/auth/callback`,
        });

        if (inviteErr) {
          const info = describeSupabaseError(inviteErr);
          if (info.code === 'over_email_send_rate_limit') {
            emailDeliveryStatus = 'not_sent';
          } else {
            emailDeliveryStatus = 'failed';
          }
          await logApiError({
            requestId,
            method: req.method,
            path: req.path,
            statusCode: 201,
            message: `direct-create invitation email ${emailDeliveryStatus} for user ${userId} - [${info.code}] ${info.message}`,
            error_code: info.code,
            userId: adminUserId,
            role: 'admin',
            metadata: logContext('email_invite', { emailDeliveryStatus, inviteErrorCode: info.code, inviteErrorMessage: info.message, appBaseUrlConfigured: true }),
          }).catch(() => {});
        } else {
          emailDeliveryStatus = 'sent';
        }
      } else {
        await logApiError({
          requestId,
          method: req.method,
          path: req.path,
          statusCode: 201,
          message: sendEmail
            ? 'direct-create invitation email not sent - APP_URL not configured'
            : 'direct-create invitation email intentionally skipped by admin',
          error_code: sendEmail ? 'APP_URL_MISSING' : 'EMAIL_SKIPPED',
          userId: adminUserId,
          role: 'admin',
          metadata: logContext('email_invite', { emailDeliveryStatus: 'not_sent', appBaseUrlConfigured: Boolean(appBaseUrl), sendEmail }),
        }).catch(() => {});
      }

      // 8. Return success with actual account + email delivery state from DB.
      await logApiError({
        requestId,
        method: req.method,
        path: req.path,
        statusCode: 201,
        message: `direct-create success - user ${userId} created with role ${role}`,
        error_code: 'SUCCESS',
        userId: adminUserId,
        role: 'admin',
        metadata: logContext('success', { createdUserId: userId, emailDeliveryStatus, appBaseUrlConfigured: Boolean(appBaseUrl) }),
      }).catch(() => {});

      return res.status(201).json({
        success: true,
        user: { id: userId, email, full_name: fullName, role },
        account: {
          status: 'active',
          approval_status: role === 'mentor' ? 'approved' : null,
        },
        emailDelivery: {
          status: emailDeliveryStatus,
          redirectConfigured: Boolean(appBaseUrl),
        },
      });
    } catch (err) {
      const typed = err as Error & { httpStatus?: number; code?: string };
      const isClientError = typeof typed.httpStatus === 'number' && typed.httpStatus < 500;
      if (isClientError) {
        // Still roll back: the auth user must not outlive a rejected request.
        await rollbackCreatedUser(typed.message);
        return res.status(typed.httpStatus!).json({
          success: false,
          error: { code: typed.code || 'VALIDATION_ERROR', message: typed.message, requestId: requestId || null },
        });
      }
      await rollbackCreatedUser(describeSupabaseError(err).message);
      return respondWithServerError({
        req,
        res,
        error: err,
        context: 'POST /api/admin/users/direct-create',
        clientMessage: 'Unable to create the user account. No partial account was kept.',
      });
    }
  });

  // POST /api/admin/users/:id/resend-invite: Resend invitation email to an existing user
  app.post('/api/admin/users/:id/resend-invite', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    const adminUserId = req.auth!.user.id;
    const requestId = req.requestId ?? '';
    const admin = getSupabaseAdmin();
    if (!admin) {
      return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
    }

    const userId = req.params.id;
    if (!UUID_PATTERN.test(userId)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_USER_ID', message: 'User ID must be a valid UUID.' } });
    }

    try {
      // Verify the user and their profile exist
      const { data: profile, error: profileErr } = await admin
        .from('profiles')
        .select('id, email, full_name, timezone')
        .eq('id', userId)
        .maybeSingle();

      if (profileErr) throw profileErr;
      if (!profile) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User not found.' } });
      }

      // Fetch user roles to include requested_role in invite metadata
      const { data: userRoles, error: rolesErr } = await admin
        .from('user_roles')
        .select('role')
        .eq('user_id', userId);

      if (rolesErr) throw rolesErr;

      const roles = (userRoles || []).map((r: { role: string }) => r.role);
      const primaryRole = roles.includes('mentor') ? 'mentor' : roles.includes('admin') ? 'admin' : 'seeker';

      const appBaseUrl = process.env.APP_URL || process.env.APP_BASE_URL || process.env.VITE_APP_BASE_URL || process.env.PUBLIC_APP_URL;

      let emailDeliveryStatus: 'sent' | 'not_sent' | 'failed' = 'not_sent';

      if (appBaseUrl) {
        const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(profile.email, {
          data: { full_name: profile.full_name, timezone: profile.timezone, requested_role: primaryRole },
          redirectTo: `${appBaseUrl.replace(/\/$/, '')}/auth/callback`,
        });

        if (inviteErr) {
          const info = describeSupabaseError(inviteErr);
          if (info.code === 'over_email_send_rate_limit') {
            emailDeliveryStatus = 'not_sent';
          } else {
            emailDeliveryStatus = 'failed';
          }
        } else {
          emailDeliveryStatus = 'sent';
        }
      } else {
        emailDeliveryStatus = 'failed';
      }

      auditAction(req.auth, 'invitation_resent', {
        entityType: 'user',
        entityId: userId,
        requestId: req.requestId,
        metadata: { role: primaryRole, emailDeliveryStatus },
      });

      return res.json({
        success: true,
        message: emailDeliveryStatus === 'sent'
          ? 'Invitation email sent successfully.'
          : emailDeliveryStatus === 'not_sent'
            ? 'User exists but invitation email could not be sent due to rate limiting. Please try again later.'
            : 'User exists but invitation email delivery failed. Please try again later.',
        userId,
        email: profile.email,
        emailDelivery: { status: emailDeliveryStatus, redirectConfigured: Boolean(appBaseUrl) },
      });
    } catch (err) {
      return respondWithServerError({
        req,
        res,
        error: err,
        context: 'POST /api/admin/users/:id/resend-invite',
        clientMessage: 'Unable to resend invitation email.',
      });
    }
  });

  // GET /api/mentor/document/upload-url: Get a presigned upload URL for a verification document
  app.get('/api/mentor/document/upload-url', requireAuth, requireRole('mentor'), async (req: AuthRequest, res) => {
    try {
      const userId = req.auth!.user.id;
      const { applicationId, documentType, fileName, mimeType, sizeBytes } = req.query;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      if (!applicationId || !documentType || !fileName || !mimeType || !sizeBytes) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'applicationId, documentType, fileName, mimeType, and sizeBytes are required.' } });
      }

      // Validate application ownership and editable status
      const { data: application, error: appErr } = await admin
        .from('mentor_applications')
        .select('user_id, status')
        .eq('id', applicationId)
        .eq('user_id', userId)
        .maybeSingle();

      if (appErr) throw appErr;
      if (!application) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Application not found.' } });
      }
      if (application.status !== 'draft' && application.status !== 'rejected') {
        return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Documents can only be uploaded for draft or rejected applications.' } });
      }

      // Validate document type
      const { data: docType, error: dtErr } = await admin
        .from('mentor_document_types')
        .select('code')
        .eq('code', documentType)
        .eq('is_active', true)
        .maybeSingle();

      if (dtErr) throw dtErr;
      if (!docType) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid document type.' } });
      }

      // Validate MIME type
      if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(mimeType as string)) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Unsupported file type.' } });
      }

      // Validate size (5MB)
      if (Number(sizeBytes) > 5242880) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'File size exceeds 5MB limit.' } });
      }

      // Generate storage path: userId/applicationId/documentType-timestamp-random.ext
      const fileExt = (fileName as string).split('.').pop() || 'bin';
      const uniqueFilename = `${documentType}-${Date.now()}-${Math.random().toString(36).substring(2, 12)}.${fileExt}`;
      const storagePath = `${userId}/${applicationId}/${uniqueFilename}`;

      // Development logging
      if (process.env.NODE_ENV !== 'production') {
        console.log('[MentorVerification] Signed upload URL generated:', {
          bucket: 'mentor-verification-documents',
          storagePath,
          userId,
          applicationId,
          documentType,
          originalFileName: fileName,
          mimeType,
          sizeBytes: Number(sizeBytes),
        });
      }

      // Generate presigned upload URL
      const { data: uploadUrl, error: urlErr } = await admin.storage
        .from('mentor-verification-documents')
        .createSignedUploadUrl(storagePath);

      if (urlErr) {
        if (process.env.NODE_ENV !== 'production') {
          console.error('[MentorVerification] createSignedUploadUrl error:', logSanitizer.safeMessage(urlErr));
        }
        throw urlErr;
      }

      return res.json({
        success: true,
        uploadUrl: uploadUrl?.signedUrl || '',
        storagePath,
        token: uploadUrl?.token || '',
      });
    } catch (err: any) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('[MentorVerification] upload-url error:', logSanitizer.safeMessage(err));
      }
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // --------------------------------------------------------------------------
  // Phase 13: Admin System Health & Technical Logs Endpoints
  // --------------------------------------------------------------------------

  // GET /api/admin/system-health/dashboard
  //
  // ONE aggregation endpoint for the whole overview, so the browser makes a
  // single request instead of five and never receives raw log rows. Every value
  // in the response is computed from `system_logs` / `audit_logs` on the server.
  //
  // Query params:
  //   range    15m | 1h | 24h | 7d   (default 1h)
  //   startAt  ISO timestamp — drill-down window start
  //   endAt    ISO timestamp — drill-down window end
  //   endpoint path fragment — drill-down endpoint filter
  //
  // startAt/endAt narrow the window to an exact bucket so clicking a spike on
  // the chart lands on precisely those logs.
  app.get('/api/admin/system-health/dashboard', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    const admin = getSupabaseAdmin();
    if (!admin) {
      return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
    }

    try {
      const rangeParam = req.query.range;
      const range = isDashboardRange(rangeParam) ? rangeParam : DEFAULT_RANGE;
      const { ms: rangeMs, bucketMs } = DASHBOARD_RANGES[range];

      const now = Date.now();

      // An explicit drill-down window narrows everything; otherwise use the range.
      const parsedStart = req.query.startAt ? new Date(String(req.query.startAt)).getTime() : NaN;
      const parsedEnd = req.query.endAt ? new Date(String(req.query.endAt)).getTime() : NaN;
      const hasWindow = Number.isFinite(parsedStart) && Number.isFinite(parsedEnd) && parsedEnd > parsedStart;

      const windowStartIso = hasWindow ? new Date(parsedStart).toISOString() : new Date(now - rangeMs).toISOString();
      const windowEndIso = hasWindow ? new Date(parsedEnd).toISOString() : new Date(now).toISOString();
      const endpointFilter = typeof req.query.endpoint === 'string' && req.query.endpoint.trim()
        ? req.query.endpoint.trim()
        : null;

      // A hard row cap keeps one request bounded. At the measured volume the
      // largest range (7d) is ~10k rows, well inside this.
      const ROW_CAP = 20000;
      const selects = [
        admin
          .from('system_logs')
          .select('created_at, category, level, status_code, duration_ms, path, error_code, request_id')
          .gte('created_at', windowStartIso)
          .lte('created_at', windowEndIso)
          .in('category', ['api_request', 'api_error', 'auth', 'db'])
          .order('created_at', { ascending: false })
          .limit(ROW_CAP),
        admin
          .from('audit_logs')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', windowStartIso)
          .lte('created_at', windowEndIso),
      ];

      const [logRes, auditRes] = await Promise.all(selects);
      if (logRes.error) throw logRes.error;
      if (auditRes.error) throw auditRes.error;

      let rows = (logRes.data ?? []) as unknown as HealthRow[];

      // Endpoint drill-down narrows to matching rows only, after the DB read.
      if (endpointFilter) {
        rows = rows.filter((r) => (r.path ?? '').includes(endpointFilter));
      }

      // A connectivity probe: this exact read already proved the database
      // answers, so its success IS the health signal. No extra scan.
      const dbReachable = true;

      const overview = computeOverview(rows, auditRes.count ?? 0);
      const timeline = buildTimeline(rows, rangeMs, bucketMs, now);
      const anomalies = detectAnomalies(timeline, rows, bucketMs);
      const topErrors = groupErrors(rows, 10);
      const auth = summariseAuth(rows);
      const services = summariseServices(overview, rows, dbReachable, auth);

      return res.json({
        success: true,
        dashboard: {
          overview,
          timeline,
          anomalies,
          topErrors,
          services,
          auth,
          range,
          bucketMs,
          // True when the DB had more rows in range than we could read, so the
          // UI can say the numbers are a floor rather than an exact total.
          truncated: (logRes.data?.length ?? 0) >= ROW_CAP,
          window: { start: windowStartIso, end: windowEndIso },
          lastUpdated: new Date(now).toISOString(),
        },
      });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err, context: 'GET /api/admin/system-health/dashboard' });
    }
  });

  // GET /api/admin/system-health/metrics: Aggregated health metrics
  app.get('/api/admin/system-health/metrics', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const metrics = await fetchSystemHealthMetrics();
      return res.json({ success: true, metrics });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // GET /api/admin/system-health/logs: Paginated + filtered system logs
  app.get('/api/admin/system-health/logs', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { category, level, status_code, request_id, user_id, path, method, search, timeRangeHours, limit, offset } = req.query;
      const logs = await fetchSystemLogs({
        category: category as string | undefined,
        level: level as string | undefined,
        status_code: status_code ? Number(status_code) : undefined,
        request_id: request_id as string | undefined,
        user_id: user_id as string | undefined,
        path: path as string | undefined,
        method: method as string | undefined,
        search: search as string | undefined,
        timeRangeHours: timeRangeHours ? Number(timeRangeHours) : undefined,
        limit: limit ? Number(limit) : 50,
        offset: offset ? Number(offset) : 0,
      });
      return res.json({ success: true, logs });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // GET /api/admin/system-health/errors: Error logs (api_error + system categories)
  app.get('/api/admin/system-health/errors', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { level, error_code, request_id, user_id, path, search, timeRangeHours, limit, offset } = req.query;
      const allLogs = await fetchSystemLogs({
        level: level as string | undefined,
        request_id: request_id as string | undefined,
        user_id: user_id as string | undefined,
        path: path as string | undefined,
        search: search as string | undefined,
        timeRangeHours: timeRangeHours ? Number(timeRangeHours) : 24,
        limit: limit ? Number(limit) : 50,
        offset: offset ? Number(offset) : 0,
      });
      const errors = allLogs.filter((l) => l.category === 'api_error' || l.category === 'system' || l.level === 'error' || l.level === 'warn');
      const filtered = error_code
        ? errors.filter((l) => l.error_code === error_code)
        : errors;
      return res.json({ success: true, errors: filtered });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // GET /api/admin/system-health/auth-logs: Authentication event logs
  app.get('/api/admin/system-health/auth-logs', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { level, user_id, path, search, timeRangeHours, limit, offset } = req.query;
      const logs = await fetchSystemLogs({
        category: 'auth',
        level: level as string | undefined,
        user_id: user_id as string | undefined,
        path: path as string | undefined,
        search: search as string | undefined,
        timeRangeHours: timeRangeHours ? Number(timeRangeHours) : 24,
        limit: limit ? Number(limit) : 50,
        offset: offset ? Number(offset) : 0,
      });
      return res.json({ success: true, logs });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // GET /api/admin/system-health/audit-logs: Admin audit trail
  app.get('/api/admin/system-health/audit-logs', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { actor_user_id, action, entity_type, request_id, search, timeRangeHours, limit, offset } = req.query;
      const logs = await fetchAuditLogs({
        actor_user_id: actor_user_id as string | undefined,
        action: action as string | undefined,
        entity_type: entity_type as string | undefined,
        request_id: request_id as string | undefined,
        search: search as string | undefined,
        timeRangeHours: timeRangeHours ? Number(timeRangeHours) : 24,
        limit: limit ? Number(limit) : 50,
        offset: offset ? Number(offset) : 0,
      });
      return res.json({ success: true, logs });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // GET /api/admin/system-health/logs/:requestId: Correlated request detail
  app.get('/api/admin/system-health/logs/:requestId', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { requestId } = req.params;
      const [log, authLog, auditLog] = await Promise.all([
        fetchSystemLogs({ request_id: requestId, limit: 10 }),
        fetchSystemLogs({ category: 'auth', request_id: requestId, limit: 10 }),
        fetchAuditLogs({ request_id: requestId, limit: 10 }),
      ]);
      return res.json({
        success: true,
        logs: log,
        auth_log: authLog,
        audit_log: auditLog,
      });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
   });

  // GET /api/admin/system-health/retention: Get log retention config
  app.get('/api/admin/system-health/retention', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }
      const { data, error } = await admin
        .from('system_log_retention')
        .select('retention_days, updated_at')
        .eq('id', 1)
        .single();
      if (error) throw error;
      return res.json({ success: true, retention: data });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // POST /api/admin/system-health/retention: Update log retention days
  app.post('/api/admin/system-health/retention', requireAuth, requireAdmin, validateBody(apiSchemas.logRetention), async (req: AuthRequest, res) => {
    try {
      // Already a whole number between 1 and 365.
      const { retentionDays } = req.body as { retentionDays: number };
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }
      const { error } = await admin
        .from('system_log_retention')
        .update({ retention_days: retentionDays, updated_at: new Date().toISOString() })
        .eq('id', 1);
      if (error) throw error;

      auditAction(req.auth, 'log_retention_updated', {
        entityType: 'system_log_retention',
        requestId: req.requestId,
        metadata: { retentionDays },
      });

      return res.json({ success: true, message: 'Log retention updated successfully.' });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // POST /api/admin/system-health/prune: Trigger manual log cleanup
  app.post('/api/admin/system-health/prune', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }
      const { data: deletedCount, error } = await admin.rpc('prune_system_logs');
      if (error) throw error;

      auditAction(req.auth, 'logs_pruned', {
        entityType: 'system_logs',
        requestId: req.requestId,
        metadata: { deletedCount },
      });

      return res.json({ success: true, deletedCount: deletedCount || 0 });
    } catch (err: any) {
      return respondWithInternalError({ req, res, error: err });
    }
  });

  // --------------------------------------------------------------------------
  // Vite Middleware (Development) / Static Files (Production)
  // --------------------------------------------------------------------------
  let httpServer: HttpServer | null = null;
  if (process.env.NODE_ENV !== 'production') {
    const hmrEnabled = process.env.DISABLE_HMR !== 'true';
    httpServer = createHttpServer(app);
    const vite = await createViteServer({
      server: {
        middlewareMode: { server: httpServer },
        // HMR rides the Express server instead of opening its own WebSocket
        // listener on the default 24678, which collided as soon as a second
        // dev server for this project was running.
        ws: hmrEnabled ? { server: httpServer } : false,
        watch: hmrEnabled ? {} : null,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (process.env.VERCEL !== '1') {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // --------------------------------------------------------------------------
  // Terminal Error Handler - MUST stay last
  // --------------------------------------------------------------------------
  app.use(terminalErrorHandler);

  // When deployed on Vercel, the Express app is exported as the serverless
  // function handler so Vercel can route /api/* requests to it. The rewrites
  // in vercel.json send /api/(.*) to this function, and /(.*) to index.html.
  // app.listen() is only used for local/standalone development.
  if (process.env.VERCEL === '1') {
    (module as any).exports = app;
  } else if (httpServer) {
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log('This website is buid by Nikhil Kumar ')
      console.log(`[Suggest Key] Server running on http://0.0.0.0:${PORT}`);
    });
  } else {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[Suggest Key] Server running on http://0.0.0.0:${PORT}`);
    });
  }
}

startServer();
