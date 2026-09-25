import 'dotenv/config';
import express from 'express';
import path from 'path';
import { timingSafeEqual } from 'crypto';
import { createServer as createViteServer } from 'vite';
import {
  executeAtomicBookingWithHold,
  confirmSessionByMentor,
  getOverdueBookings,
  validateSessionAccess,
  joinSessionAuthoritative,
  transitionExpiredBookingsToCompleted,
  BookingEngineContext,
} from './src/lib/bookingEngine';
import { generateMentorSlots } from './src/lib/slotEngine';
import { getLocalBookingEngineContext, enrichBooking } from './src/lib/bookingService';
import {
  getLocalWorkspaces,
  deriveSessionOverview,
} from './src/lib/workspaceService';
import {
  requireAuth,
  requireAdmin,
  requireRole,
  getSupabaseAdmin,
  createDemoToken,
  type AuthRequest,
} from './src/lib/supabaseServer';
import { generateRequestId } from './src/lib/requestId';
import { logApiRequest, requestIdMiddleware, requestLoggerMiddleware, fetchSystemLogs, fetchAuditLogs, fetchSystemHealthMetrics, logApiError } from './src/lib/logger';
import { auditAction } from './src/lib/auditLogger';
import { POSTGREST_RELATIONSHIPS } from './src/lib/postgrestRelationships';
import { describeSupabaseError, getErrorMessage, respondWithServerError, resolveHttpStatusForSupabaseError } from './src/lib/supabaseErrors';
import {
  MENTOR_APPLICATION_STATUSES,
  buildMentorApplicationPagination,
  buildProfileSearchFilter,
  emptyMentorApplicationStatusCounts,
  parseMentorApplicationListQuery,
  type MentorApplicationStatusCounts,
} from './src/lib/mentorApplicationsQuery';
import type {
  MentorApplicationDetailAuditEntry,
  MentorApplicationDetailDocument,
  MentorApplicationDetailRow,
  MentorApplicationQueueAuditEntry,
  MentorApplicationQueueRow,
} from './src/types/database';

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
const MIN_MENTOR_BIO_LENGTH = 20;
const MIN_PASSWORD_LENGTH = 6;


async function startServer() {
  const app = express();
  const PORT = 3000;

  type DemoRole = 'seeker' | 'mentor' | 'admin';

  interface DemoAccount {
    id: string;
    email: string;
    full_name: string;
    password: string;
    role: DemoRole;
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
    },
    mentor: {
      id: 'usr-mentor-rahul',
      email: 'mentor@suggestkey.com',
      full_name: 'Rahul Sharma',
      password: 'password123',
      role: 'mentor',
    },
    admin: {
      id: process.env.ADMIN_EMAIL || 'admin@suggestkey.local',
      email: process.env.ADMIN_EMAIL || 'admin@suggestkey.local',
      full_name: 'Platform Administrator',
      password: process.env.ADMIN_PASSWORD || '',
      role: 'admin',
    },
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

  app.use(express.json());

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
  // API Routes
  // --------------------------------------------------------------------------
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'suggest-key-api',
      timestamp: new Date().toISOString(),
    });
  });

  app.post('/api/auth/demo-login', (req, res) => {
    res.set('Cache-Control', 'no-store');
    // DEMO-ONLY: Demo login is explicitly disabled in production.
    if (process.env.NODE_ENV === 'production' && process.env.ENABLE_DEMO_PERSONAS !== 'true') {
      return res.status(404).json({
        success: false,
        error: { code: 'DEMO_LOGIN_DISABLED', message: 'Demo login is unavailable.' },
      });
    }
    const body = req.body as { email?: unknown; password?: unknown; persona?: unknown };
    const persona = typeof body.persona === 'string' ? body.persona.toLowerCase() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

    let account: DemoAccount | undefined;
    if (persona && Object.prototype.hasOwnProperty.call(demoAccounts, persona)) {
      if (process.env.NODE_ENV === 'production' && process.env.ENABLE_DEMO_PERSONAS !== 'true') {
        return res.status(404).json({
          success: false,
          error: { code: 'DEMO_LOGIN_DISABLED', message: 'Demo login is unavailable.' },
        });
      }
      account = demoAccounts[persona as DemoRole];
    } else if (email) {
      account = Object.values(demoAccounts).find(
        (candidate) => candidate.email.toLowerCase() === email
      );
      if (account && !passwordsMatch(account.password, typeof body.password === 'string' ? body.password : '')) {
        account = undefined;
      }
    }

    if (!account) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_DEMO_CREDENTIALS', message: 'Invalid demo credentials.' },
      });
    }

    return res.json({ success: true, ...demoAuthResponse(account) });
  });

  // POST /api/bookings/hold: Complete Phase 6 Atomic Booking & Hold Endpoint
  app.post('/api/bookings/hold', requireAuth, requireRole('seeker'), async (req: AuthRequest, res) => {
    try {
      const { mentorId, segmentId, gigId, startTime, endTime } = req.body;
      const seekerId = req.auth!.user.id;

      if (!mentorId || !segmentId || !gigId || !startTime || !endTime) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_REQUIRED_FIELDS',
            message: 'mentorId, segmentId, gigId, startTime, and endTime are required.',
          },
        });
      }

      const admin = getSupabaseAdmin();
      if (admin) {
        const { data, error } = await admin.rpc('create_booking_with_hold', {
          p_seeker_id: seekerId,
          p_mentor_id: mentorId,
          p_segment_id: segmentId,
          p_gig_id: gigId,
          p_start_time: startTime,
          p_end_time: endTime,
        });

        if (error) {
          const codeMatch = error.message.match(/code:\s*([A-Z0-9_]+)/i);
          const code = codeMatch?.[1]?.toUpperCase() || 'BOOKING_FAILED';
          const status = ['SLOT_ALREADY_BOOKED', 'SLOT_HELD_BY_OTHER', 'BOOKING_CONFLICT'].includes(code)
            ? 409
            : code === 'UNAUTHORIZED' || code === 'ROLE_NOT_SEEKER'
              ? 403
              : 400;
          return res.status(status).json({
            success: false,
            error: { code, message: error.message },
          });
        }

        return res.status(201).json(data);
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
      console.error('Unhandled booking error:', err);
      return res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: err.message || 'An unexpected server error occurred.',
        },
      });
    }
  });

  // --------------------------------------------------------------------------
  // Phase 8: Mentor Confirmation & Bookings Endpoints
  // --------------------------------------------------------------------------

  // GET /api/mentor/bookings: Get bookings for a mentor with optional status filter
  app.get('/api/mentor/bookings', requireAuth, requireRole('mentor'), (req: AuthRequest, res) => {
    try {
      const { status } = req.query;
      const mentorId = req.auth!.user.id;

      const db = getLocalBookingEngineContext();
      const mentorIds = [mentorId];

      let matched = db.bookings.filter((b) => mentorIds.includes(b.mentor_id));
      if (status && typeof status === 'string' && status !== 'ALL') {
        matched = matched.filter((b) => b.status === status);
      }

      matched.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
      const enriched = matched.map((b) => enrichBooking(b, db));

      return res.json({ success: true, bookings: enriched });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  });

  // GET /api/mentor/bookings/:id: Get booking detail with authorization check
  app.get('/api/mentor/bookings/:id', requireAuth, requireRole('mentor'), (req: AuthRequest, res) => {
    try {
      const bookingId = req.params.id;
      const callerId = req.auth!.user.id;

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
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  });

  // POST /api/mentor/bookings/:id/confirm: Server-side mentor confirmation
  app.post('/api/mentor/bookings/:id/confirm', requireAuth, requireRole('mentor'), async (req: AuthRequest, res) => {
    try {
      const bookingId = req.params.id;
      const mentorId = req.auth!.user.id;
      const { meetingUrl } = req.body;

      if (!meetingUrl) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MEETING_URL_REQUIRED',
            message: 'Meeting link is required to confirm session.',
          },
        });
      }

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
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
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
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
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
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
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
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  });

  // POST /api/mentor/gigs: Create a new gig for authenticated mentor
  app.post('/api/mentor/gigs', requireAuth, requireRole('mentor'), async (req: AuthRequest, res) => {
    try {
      const { title, segmentId, durationMinutes, priceInr, description } = req.body;
      const mentorId = req.auth!.user.id;
      if (!title || !segmentId || !durationMinutes || priceInr === undefined) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Missing required fields.' },
        });
      }

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
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  });

  // PATCH /api/mentor/gigs/:id: Update gig
  app.patch('/api/mentor/gigs/:id', requireAuth, requireRole('mentor'), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { title, durationMinutes, priceInr, description, isActive } = req.body;
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
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  });

  // DELETE /api/mentor/gigs/:id: Delete gig
  app.delete('/api/mentor/gigs/:id', requireAuth, requireRole('mentor'), async (req: AuthRequest, res) => {
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
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  });

  // GET /api/mentor/available-segments: Get all active segments for mentor to apply
  app.get('/api/mentor/available-segments', async (req, res) => {
    try {
      const { mentorId } = req.query;
      if (!mentorId || typeof mentorId !== 'string') {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_MENTOR_ID', message: 'mentorId query parameter is required.' },
        });
      }

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
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  });

  // POST /api/mentor/segments/apply: Apply for a new segment
  app.post('/api/mentor/segments/apply', async (req, res) => {
    try {
      const { mentorId, segmentId } = req.body;
      if (!mentorId || !segmentId) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'mentorId and segmentId are required.' },
        });
      }

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
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
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

      const mentors = [];
      for (const [mentorId, profile] of mentorMap) {
        const mp = mpMap.get(mentorId);
        const segments = msMap.get(mentorId) || [];
        const mentorGigs = gigMap.get(mentorId) || [];

        // Determine primary segment for display
        const primarySegment = segments.find((s: any) => s.is_primary) || segments[0];

        mentors.push({
          id: mentorId,
          name: profile.full_name,
          email: profile.email,
          segmentName: primarySegment?.segment?.name || 'No Segment',
          status: mp?.is_approved ? 'APPROVED' : 'PENDING',
          experienceYears: mp?.experience_years || 0,
          bio: mp?.about || '',
          appliedDate: profile.created_at ? new Date(profile.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Unknown',
          isApproved: mp?.is_approved || false,
          isActive: true, // could be derived from gigs/segments
          profile: mp,
          segments: segments.map((s: any) => s.segment),
          gigs: mentorGigs,
        });
      }

      return res.json({ success: true, mentors });
    } catch (err: any) {
      console.error('Failed to fetch admin mentors:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
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
      console.error('Failed to approve mentor:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
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
      console.error('Failed to reject mentor:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
    }
  });

  // PATCH /api/admin/mentors/:id/toggle-active: Activate/Deactivate mentor
  app.patch('/api/admin/mentors/:id/toggle-active', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      // Toggle mentor approval status (used as active/inactive)
      const { error } = await admin
        .from('mentor_profiles')
        .update({ is_approved: isActive, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;

      auditAction(req.auth, isActive ? 'mentor_activated' : 'mentor_deactivated', {
        entityType: 'mentor_profile',
        entityId: id,
        requestId: req.requestId,
        metadata: { isActive },
      });

      return res.json({ success: true, message: `Mentor ${isActive ? 'activated' : 'deactivated'} successfully.` });
    } catch (err: any) {
      console.error('Failed to toggle mentor active status:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
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
              if (approvedMentorIds.has(g.mentor_id)) {
                mentorCounts[g.segment_id] = (mentorCounts[g.segment_id] || 0) + 1;
              }
            }
          }
        }
      }

      const segmentsWithCounts = (segments || []).map((s: any) => ({
        ...s,
        mentorsCount: mentorCounts[s.id] || 0,
      }));

      return res.json({ success: true, segments: segmentsWithCounts });
    } catch (err: any) {
      console.error('Failed to fetch admin segments:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
    }
  });

  // POST /api/admin/segments: Create new segment
  app.post('/api/admin/segments', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { name, slug, priority, isActive } = req.body;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      if (!name || !slug) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Name and slug are required.' } });
      }

      const { data, error } = await admin
        .from('segments')
        .insert({
          name,
          slug,
          priority: priority || 10,
          is_active: isActive !== false,
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') { // unique violation
          return res.status(409).json({ success: false, error: { code: 'DUPLICATE', message: 'Segment name or slug already exists.' } });
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
      console.error('Failed to create segment:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
    }
  });

  // PATCH /api/admin/segments/:id: Update segment
  app.patch('/api/admin/segments/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { name, slug, priority, isActive, description } = req.body;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      const updateData: Record<string, any> = { updated_at: new Date().toISOString() };
      if (name !== undefined) updateData.name = name;
      if (slug !== undefined) updateData.slug = slug;
      if (priority !== undefined) updateData.priority = priority;
      if (isActive !== undefined) updateData.is_active = isActive;
      if (description !== undefined) updateData.description = description;

      const { data, error } = await admin
        .from('segments')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          return res.status(409).json({ success: false, error: { code: 'DUPLICATE', message: 'Segment name or slug already exists.' } });
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
      console.error('Failed to update segment:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
    }
  });

  // PATCH /api/admin/segments/:id/toggle-active: Toggle segment active status
  app.patch('/api/admin/segments/:id/toggle-active', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
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
      console.error('Failed to toggle segment active status:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
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
      console.error('Failed to fetch admin users:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
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

      return res.json({ success: true, user: { profile, roles: (roles || []).map((entry: { role: string }) => entry.role), mentorProfile: transformedMentorProfile, application, documents: signedDocuments, segments: memberships || [] } });
    } catch (err) {
      return respondWithServerError({ req, res, error: err, context: 'GET /api/admin/users/:id', clientMessage: 'Unable to load user details.' });
    }
  });

  // PATCH /api/admin/users/:id: Edit approved profile fields and mentor profile data.
  app.patch('/api/admin/users/:id', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      const userId = req.params.id;
      const body = (req.body || {}) as Record<string, unknown>;
      const profileUpdates: Record<string, string> = {};
      if (typeof body.fullName === 'string' && body.fullName.trim()) profileUpdates.full_name = body.fullName.trim();
      if (typeof body.timezone === 'string' && body.timezone.trim()) profileUpdates.timezone = body.timezone.trim();
      // account_status column does not exist in profiles table; ignore if sent

      const mentorUpdates: Record<string, unknown> = {};
      if (typeof body.bio === 'string') mentorUpdates.about = body.bio.trim();
      if (typeof body.headline === 'string') mentorUpdates.headline = body.headline.trim();
      if (typeof body.experienceYears === 'number' && Number.isInteger(body.experienceYears) && body.experienceYears >= 0) mentorUpdates.experience_years = body.experienceYears;

      if (Object.keys(profileUpdates).length === 0 && Object.keys(mentorUpdates).length === 0) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No editable fields were provided.' } });
      }

      if (Object.keys(profileUpdates).length > 0) {
        const { error } = await admin.from('profiles').update({ ...profileUpdates, updated_at: new Date().toISOString() }).eq('id', userId);
        if (error) throw error;
      }

      if (Object.keys(mentorUpdates).length > 0) {
        const { error } = await admin.from('mentor_profiles').update({ ...mentorUpdates, updated_at: new Date().toISOString() }).eq('id', userId);
        if (error) throw error;
      }

      auditAction(req.auth, 'admin_user_updated', { entityType: 'user', entityId: userId, requestId: req.requestId, metadata: { fields: [...Object.keys(profileUpdates), ...Object.keys(mentorUpdates)] } });
      return res.json({ success: true, message: 'User updated successfully.' });
    } catch (err) {
      return respondWithServerError({ req, res, error: err, context: 'PATCH /api/admin/users/:id', clientMessage: 'Unable to update user.' });
    }
  });

  // --------------------------------------------------------------------------
  // Admin API: Dashboard Metrics
  // --------------------------------------------------------------------------

  // GET /api/admin/dashboard/metrics: Fetch real-time dashboard metrics
  app.get('/api/admin/dashboard/metrics', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      // Parallel queries for all metrics
      const [
        { count: totalMentors },
        { count: totalSeekers },
        { count: pendingApprovals },
        { count: activeSegments },
        { data: pendingPayments },
        { data: todaysBookings },
      ] = await Promise.all([
        // Total mentors
        admin.from('user_roles').select('*', { count: 'exact', head: true }).eq('role', 'mentor'),
        // Total seekers
        admin.from('user_roles').select('*', { count: 'exact', head: true }).eq('role', 'seeker'),
        // Pending mentor approvals (mentors with is_approved = false)
        admin.from('mentor_profiles').select('*', { count: 'exact', head: true }).eq('is_approved', false),
        // Active segments
        admin.from('segments').select('*', { count: 'exact', head: true }).eq('is_active', true),
        // Pending payments
        admin.from('payments').select('*').eq('status', 'PENDING_VERIFICATION').order('created_at', { ascending: false }).limit(10),
        // Today's bookings
        admin.from('bookings').select('*').gte('start_time', new Date(new Date().setHours(0, 0, 0, 0)).toISOString()).lt('start_time', new Date(new Date().setHours(23, 59, 59, 999)).toISOString()),
      ]);

      // Format pending payments for dashboard
      const formattedPayments = (pendingPayments || []).map((p: any) => ({
        id: p.id,
        bookingId: p.booking_id,
        seeker: p.seeker_id, // will be resolved below
        mentor: 'Mentor', // will be resolved below
        amount: p.amount_inr,
        time: new Date(p.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      }));

      // Resolve seeker/mentor names for payments
      if (formattedPayments.length > 0) {
        const bookingIds = formattedPayments.map((p: any) => p.bookingId);
        const { data: bookings } = await admin
          .from('bookings')
          .select('id, seeker_id, mentor_id')
          .in('id', bookingIds);

        const seekerIds = [...new Set(bookings?.map((b: any) => b.seeker_id) || [])];
        const mentorIds = [...new Set(bookings?.map((b: any) => b.mentor_id) || [])];

        const [{ data: seekers }, { data: mentors }] = await Promise.all([
          admin.from('profiles').select('id, full_name').in('id', seekerIds),
          admin.from('profiles').select('id, full_name').in('id', mentorIds),
        ]);

        const seekerMap = new Map(seekers?.map((s: any) => [s.id, s.full_name]) || []);
        const mentorMap = new Map(mentors?.map((m: any) => [m.id, m.full_name]) || []);

        for (const payment of formattedPayments) {
          const booking = bookings?.find((b: any) => b.id === payment.bookingId);
          if (booking) {
            payment.seeker = seekerMap.get(booking.seeker_id) || 'Unknown';
            payment.mentor = mentorMap.get(booking.mentor_id) || 'Unknown';
          }
        }
      }

      // Get default active segment (lowest priority)
      const { data: defaultSegment } = await admin
        .from('segments')
        .select('name')
        .eq('is_active', true)
        .order('priority', { ascending: true })
        .limit(1)
        .maybeSingle();

      return res.json({
        success: true,
        metrics: {
          totalMentors: totalMentors || 0,
          totalSeekers: totalSeekers || 0,
          pendingApprovals: pendingApprovals || 0,
          activeSegments: activeSegments || 0,
          pendingPaymentsCount: pendingPayments?.length || 0,
          todaysBookingsCount: todaysBookings?.length || 0,
          pendingPayments: formattedPayments,
          defaultSegment: defaultSegment?.name || 'None',
        },
      });
    } catch (err: any) {
      console.error('Failed to fetch dashboard metrics:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
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

      // Get all unique seeker and mentor IDs
      const seekerIds = [...new Set((payments || []).map((p: any) => p.booking?.seeker_id).filter(Boolean))];
      const mentorIds = [...new Set((payments || []).map((p: any) => p.booking?.mentor_id).filter(Boolean))];

      // Fetch profiles for seekers and mentors
      const [{ data: seekers }, { data: mentors }] = await Promise.all([
        admin.from('profiles').select('id, full_name').in('id', seekerIds),
        admin.from('profiles').select('id, full_name').in('id', mentorIds),
      ]);

      const seekerMap = new Map(seekers?.map((s: any) => [s.id, s.full_name]) || []);
      const mentorMap = new Map(mentors?.map((m: any) => [m.id, m.full_name]) || []);

      const formattedPayments = (payments || []).map((p: any) => ({
        id: p.id,
        bookingId: p.booking?.booking_code || p.booking_id,
        seekerName: p.booking?.seeker_id ? seekerMap.get(p.booking.seeker_id) || 'Unknown' : 'Unknown',
        mentorName: p.booking?.mentor_id ? mentorMap.get(p.booking.mentor_id) || 'Unknown' : 'Unknown',
        amount: p.amount_inr,
        submittedAt: p.created_at ? new Date(p.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : 'Unknown',
        status: p.status,
        proofUrl: p.proof_storage_path,
        rejectionReason: p.rejection_reason,
      }));

      return res.json({ success: true, payments: formattedPayments });
    } catch (err: any) {
      console.error('Failed to fetch admin payments:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
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

      auditAction(req.auth, 'payment_approved', {
        entityType: 'payment',
        entityId: id,
        requestId: req.requestId,
        metadata: { bookingId: data?.booking_id },
      });

      return res.json({ success: true, message: 'Payment approved successfully.' });
    } catch (err: any) {
      console.error('Failed to approve payment:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
    }
  });

  // PATCH /api/admin/payments/:id/reject: Reject payment
  app.patch('/api/admin/payments/:id/reject', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
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

      auditAction(req.auth, 'payment_rejected', {
        entityType: 'payment',
        entityId: id,
        requestId: req.requestId,
        metadata: { bookingId: data?.booking_id, rejectionReason },
      });

      return res.json({ success: true, message: 'Payment rejected successfully.' });
    } catch (err: any) {
      console.error('Failed to reject payment:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
    }
  });

  // --------------------------------------------------------------------------
  // Phase 11: In-App Notifications Endpoints
  // --------------------------------------------------------------------------

  // GET /api/notifications: Fetch in-app notifications for user
  app.get('/api/notifications', (req, res) => {
    try {
      const { userId, status, type, limit } = req.query;
      if (!userId || typeof userId !== 'string') {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_USER_ID', message: 'userId query parameter is required.' },
        });
      }

      const db = getLocalBookingEngineContext();
      
      // Normalize user aliases
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
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  });

  // GET /api/notifications/unread-count: Quick unread count for badges
  app.get('/api/notifications/unread-count', (req, res) => {
    try {
      const { userId } = req.query;
      if (!userId || typeof userId !== 'string') {
        return res.status(400).json({ success: false, error: 'userId is required' });
      }

      const db = getLocalBookingEngineContext();
      const userIds = [userId];

      const count = (db.notifications || [])
        .filter((n) => userIds.includes(n.user_id) && !n.is_read).length;

      return res.json({ success: true, count });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // PATCH /api/notifications/:id/read: Mark single notification as read
  app.patch('/api/notifications/:id/read', (req, res) => {
    try {
      const { id } = req.params;
      const { isRead = true } = req.body;
      const db = getLocalBookingEngineContext();

      if (!db.notifications) db.notifications = [];
      const notif = db.notifications.find((n) => n.id === id);

      if (!notif) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Notification not found' },
        });
      }

      notif.is_read = !!isRead;
      (notif as any).read_at = isRead ? new Date().toISOString() : null;

      return res.json({ success: true, notification: notif });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  });

  // POST /api/notifications/mark-all-read: Mark all notifications as read for a user
  app.post('/api/notifications/mark-all-read', (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_USER_ID', message: 'userId is required' },
        });
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
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  });

   // POST /api/notifications/dispatch: Dispatch new notification (admin or self only)
   app.post('/api/notifications/dispatch', requireAuth, (req: AuthRequest, res) => {
     try {
       const {
         userId: bodyUserId,
         title,
         message,
         type = 'SYSTEM',
         eventType,
         entityType,
         entityId,
         link,
         metadata = {},
       } = req.body;

       const callerId = req.auth?.user?.id;
       const isAdmin = req.auth?.roles.includes('admin') ?? false;

       if (!isAdmin && bodyUserId && bodyUserId !== callerId) {
         return res.status(403).json({
           success: false,
           error: { code: 'FORBIDDEN', message: 'You can only dispatch notifications for your own account.' },
         });
       }

       const userId = bodyUserId || callerId;

      if (!userId || !title || !message) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'userId, title, and message are required' },
        });
      }

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
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  });


  // --------------------------------------------------------------------------
  // Phase 9: Session Access & Join Endpoints
  // --------------------------------------------------------------------------

   // GET /api/sessions/:bookingId/access: Authoritative server check for session countdown & state
   app.get('/api/sessions/:bookingId/access', requireAuth, (req: AuthRequest, res) => {
     try {
       const { bookingId } = req.params;
       const callerId = req.auth?.user?.id;
       const userId = (callerId || req.query.userId) as string | undefined;
       const currentTime = req.query.currentTime;

       if (!userId || typeof userId !== 'string') {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_USER_ID', message: 'userId query parameter is required.' },
        });
      }

      const db = getLocalBookingEngineContext();
      const currentUtcTime = currentTime && typeof currentTime === 'string' ? new Date(currentTime) : new Date();

      const accessResult = validateSessionAccess(
        {
          bookingId,
          userId,
          currentUtcTime,
        },
        db
      );

      if (!accessResult.success) {
        const code = accessResult.error?.code;
        if (code === 'FORBIDDEN_NOT_PARTICIPANT') {
          return res.status(403).json(accessResult);
        }
        if (code === 'BOOKING_NOT_FOUND') {
          return res.status(404).json(accessResult);
        }
        return res.status(400).json(accessResult);
      }

      return res.json(accessResult);
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  });

  // POST /api/sessions/:bookingId/join: Authoritative join action triggered by Join Session button
  app.post('/api/sessions/:bookingId/join', (req, res) => {
    try {
      const { bookingId } = req.params;
      const { userId, currentTime } = req.body;

      if (!userId) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_USER_ID', message: 'userId is required in request body.' },
        });
      }

      const db = getLocalBookingEngineContext();
      const currentUtcTime = currentTime ? new Date(currentTime) : new Date();

      const joinResult = joinSessionAuthoritative(
        {
          bookingId,
          userId,
          currentUtcTime,
        },
        db
      );

      if (!joinResult.canJoin) {
        const code = joinResult.error?.code;
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
        if (code === 'FORBIDDEN_NOT_PARTICIPANT') {
          return res.status(403).json(joinResult);
        }
        return res.status(400).json(joinResult);
      }

      return res.json({
        success: true,
        canJoin: true,
        accessState: joinResult.accessState,
        meetingUrl: joinResult.meetingUrl,
        bookingCode: joinResult.bookingCode,
        message: 'Join authorized. Proceeding to meeting.',
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  });

  // POST /api/sessions/:bookingId/complete: Transition session/booking to COMPLETED
  app.post('/api/sessions/:bookingId/complete', (req, res) => {
    try {
      const { bookingId } = req.params;
      const db = getLocalBookingEngineContext();
      const booking = db.bookings.find(
        (b) => b.id === bookingId || b.booking_code.toUpperCase() === bookingId.toUpperCase()
      );

      if (!booking) {
        return res.status(404).json({
          success: false,
          error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' },
        });
      }

      booking.status = 'COMPLETED';
      booking.updated_at = new Date().toISOString();

      return res.json({
        success: true,
        booking,
        message: 'Booking marked as COMPLETED.',
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  });

  // --------------------------------------------------------------------------
  // Phase 10: Session Workspace Endpoints
  // --------------------------------------------------------------------------

  // GET /api/workspaces/booking/:bookingId
  app.get('/api/workspaces/booking/:bookingId', (req, res) => {
    try {
      const { bookingId } = req.params;
      const { userId, role } = req.query;

      const db = getLocalBookingEngineContext();
      const booking = db.bookings.find(
        (b) => b.id === bookingId || b.booking_code.toUpperCase() === bookingId.toUpperCase()
      );

      if (!booking) {
        return res.status(404).json({
          success: false,
          error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' },
        });
      }

      // Authorization & Privacy check
      const isMentor = (userId && booking.mentor_id === userId) || role === 'mentor';
      const isAdmin = role === 'admin';
      const isSeeker = (userId && booking.seeker_id === userId) || role === 'seeker';

      if (!isMentor && !isAdmin && !isSeeker) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Unauthorized access to session workspace.' },
        });
      }

      const workspaces = getLocalWorkspaces();
      const ws = workspaces.find((w) => w.booking_id === booking.id);
      const overview = deriveSessionOverview(booking);

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
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  });

  // POST /api/workspaces: Create or Save Workspace (Mentor & Admin)
  app.post('/api/workspaces', (req, res) => {
    try {
      const {
        bookingId,
        mentorId,
        mentorNotes,
        takeaways = [],
        suggestions = [],
        nextSteps = [],
        followUpRecommendation = null,
        publish = false,
        userId,
        role,
      } = req.body;

      if (!bookingId) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_BOOKING_ID', message: 'bookingId is required.' },
        });
      }

      const db = getLocalBookingEngineContext();
      const booking = db.bookings.find(
        (b) => b.id === bookingId || b.booking_code.toUpperCase() === bookingId.toUpperCase()
      );

      if (!booking) {
        return res.status(404).json({
          success: false,
          error: { code: 'BOOKING_NOT_FOUND', message: 'Booking does not exist.' },
        });
      }

      // Authorization validation
      const isAdmin = role === 'admin';
      const isAssignedMentor = (userId && booking.mentor_id === userId) || (mentorId && booking.mentor_id === mentorId);

      if (!isAdmin && !isAssignedMentor) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Only the assigned mentor or an administrator can create or update this workspace.',
          },
        });
      }

      const workspaces = getLocalWorkspaces();
      let wsIndex = workspaces.findIndex((w) => w.booking_id === booking.id);
      const nowIso = new Date().toISOString();
      const overview = deriveSessionOverview(booking);
      const status = publish ? 'PUBLISHED' : 'PENDING';

      const updatedWorkspace = {
        id: wsIndex >= 0 ? workspaces[wsIndex].id : `ws-${Date.now()}`,
        booking_id: booking.id,
        mentor_id: booking.mentor_id,
        seeker_id: booking.seeker_id,
        status: status as 'PENDING' | 'PUBLISHED',
        mentor_notes: mentorNotes || '',
        summary: mentorNotes || '',
        takeaways: Array.isArray(takeaways) ? takeaways : [],
        suggestions: Array.isArray(suggestions) ? suggestions : [],
        next_steps: Array.isArray(nextSteps) ? nextSteps : [],
        action_items: Array.isArray(nextSteps)
          ? nextSteps.map((ns: any) => ({
              id: ns.id || `act-${Date.now()}`,
              text: ns.text || '',
              completed: !!ns.completed,
            }))
          : [],
        follow_up_recommendation: followUpRecommendation || null,
        resources: wsIndex >= 0 ? workspaces[wsIndex].resources : [],
        published_at: publish ? nowIso : (wsIndex >= 0 ? workspaces[wsIndex].published_at : null),
        created_at: wsIndex >= 0 ? workspaces[wsIndex].created_at : nowIso,
        updated_at: nowIso,
        session_overview: overview,
      };

      if (wsIndex >= 0) {
        workspaces[wsIndex] = updatedWorkspace;
      } else {
        workspaces.push(updatedWorkspace);
      }

      // In-app notification for Seeker if published
      if (publish && db.notifications) {
        const mentorProfile = db.profiles.find((p) => p.id === booking.mentor_id);
        db.notifications.unshift({
          id: `notif-ws-${Date.now()}`,
          user_id: booking.seeker_id,
          title: 'Session Workspace Published',
          message: `${mentorProfile?.full_name || 'Your mentor'} has published takeaways and recommendations for session ${booking.booking_code}.`,
          type: 'WORKSPACE',
          link: `/seeker/workspace?bookingId=${booking.id}`,
          is_read: false,
          created_at: nowIso,
        });
      }

      return res.status(200).json({
        success: true,
        workspace: updatedWorkspace,
        message: publish ? 'Workspace published to seeker successfully.' : 'Workspace saved as draft.',
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
    }
  });

  // GET /api/admin/workspaces: Operational Access
  app.get('/api/admin/workspaces', requireAuth, requireAdmin, (req: AuthRequest, res) => {
    try {
      const db = getLocalBookingEngineContext();
      const workspaces = getLocalWorkspaces();

      const enriched = workspaces.map((ws) => {
        const booking = db.bookings.find((b) => b.id === ws.booking_id);
        return {
          ...ws,
          session_overview: booking ? deriveSessionOverview(booking) : undefined,
        };
      });

      return res.json({
        success: true,
        workspaces: enriched,
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
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
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
    }
  });

  // POST /api/mentor/application/draft: Create or update a mentor application in draft
  app.post('/api/mentor/application/draft', requireAuth, requireRole('mentor'), async (req: AuthRequest, res) => {
    try {
      const userId = req.auth!.user.id;
      const { fullName, bio, timezone, headline, experienceYears, segmentIds } = req.body;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      if (!fullName || typeof fullName !== 'string' || fullName.trim() === '') {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Full name is required.' } });
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
          bio: typeof bio === 'string' ? bio.trim() : '',
          years_experience: Number.isInteger(experienceYears) ? experienceYears : 0,
          experience_years: Number.isInteger(experienceYears) ? experienceYears : 0,
          timezone: typeof timezone === 'string' && timezone.trim() ? timezone.trim() : 'Asia/Kolkata',
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
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
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

      // Create notification for administrators
      const { error: notifErr } = await admin.from('notifications').insert({
        user_id: null,
        title: 'New Mentor Verification Submitted',
        message: `A new mentor application from ${updatedApp.full_name} requires review.`,
        type: 'ADMIN',
        event_type: 'ADMIN_MENTOR_APPLICATION_SUBMITTED',
        entity_type: 'mentor_application',
        entity_id: updatedApp.id,
        link: `/admin/mentor-verification/${updatedApp.id}`,
        is_read: false,
      });

      if (notifErr) console.error('Failed to create admin notification:', notifErr.message);

      return res.json({ success: true, application: updatedApp });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
    }
  });

  // POST /api/mentor/document: Upsert mentor verification document metadata (after file uploaded to storage)
  app.post('/api/mentor/document', requireAuth, requireRole('mentor'), async (req: AuthRequest, res) => {
    try {
      const userId = req.auth!.user.id;
      const { applicationId, documentType, storagePath, originalFilename, mimeType, sizeBytes } = req.body;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      if (!applicationId || !documentType || !storagePath || !originalFilename || !mimeType || !sizeBytes) {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'All document fields are required.' } });
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
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
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
  app.post('/api/admin/mentor-applications/:id/reject', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { rejectionReason } = req.body;
      const adminUserId = req.auth!.user.id;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      if (!rejectionReason || typeof rejectionReason !== 'string' || rejectionReason.trim() === '') {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Rejection reason is required.' } });
      }

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
  app.patch('/api/admin/mentor-documents/:id/review', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { status, adminNote } = req.body;
      const adminUserId = req.auth!.user.id;
      const admin = getSupabaseAdmin();
      if (!admin) {
        return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
      }

      if (status !== 'approved' && status !== 'rejected') {
        return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Status must be "approved" or "rejected".' } });
      }

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
  app.post('/api/admin/users/direct-create', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    const adminUserId = req.auth!.user.id;
    const requestId = req.requestId ?? '';
    const admin = getSupabaseAdmin();
    if (!admin) {
      return res.status(503).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Admin client not configured.' } });
    }

    // 1. Validate the request body (the browser is never trusted).
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
    const role = typeof body.role === 'string' ? body.role.trim().toLowerCase() : '';
    const bio = typeof body.bio === 'string' ? body.bio.trim() : '';
    const timezone = typeof body.timezone === 'string' && body.timezone.trim() ? body.timezone.trim() : 'Asia/Kolkata';

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

    const invalidFields: string[] = [];
    if (!email || !EMAIL_PATTERN.test(email)) invalidFields.push('a valid email address');
    if (!fullName) invalidFields.push('fullName');

    if (invalidFields.length > 0) {
      await logApiError({
        requestId,
        method: req.method,
        path: req.path,
        statusCode: 400,
        message: `direct-create validation failed - missing fields: ${invalidFields.join(', ')}`,
        error_code: 'VALIDATION_ERROR',
        userId: adminUserId,
        role: 'admin',
        metadata: logContext('validation', { invalidFields }),
      }).catch(() => {});
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Please provide ${invalidFields.join(', ')}.`,
          requestId: requestId || null,
        },
      });
    }

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
    // invite email is a separate step (see below). Using createUser with
    // email_confirm: true means the account is usable immediately for profile
    // data, and the invite link lets the user set their password on first login.
    const { data: authUser, error: createAuthErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      data: { full_name: fullName, timezone, requested_role: role },
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
      const { error: profileErr } = await admin
        .from('profiles')
        .upsert(
          { id: userId, email, full_name: fullName, timezone, avatar_url: null, created_at: now, updated_at: now },
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

      // 6. Admin-created mentors are trusted and immediately approved. They do
      //    NOT enter the self-signup application/document workflow. No mentor
      //    application is created, no documents are required.
      if (role === 'mentor') {
        // Use neutral defaults: rating=0, empty languages array.
        // No fake demo values (rating=5.0, languages=['English','Hindi']).
        const { error: mpErr } = await admin
          .from('mentor_profiles')
          .upsert(
            {
              id: userId,
              headline: bio || '',
              about: bio || null,
              experience_years: 0,
              languages: [] as unknown as string,
              rating: 0.0,
              review_count: 0,
              session_count: 0,
              is_approved: true,
              is_featured: false,
              approval_status: 'approved',
              is_active: true,
              created_at: now,
              updated_at: now,
            },
            { onConflict: 'id' },
          );

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

        auditAction(req.auth, 'user_role_assigned', {
          entityType: 'user_role',
          entityId: userId,
          requestId: req.requestId,
          metadata: { role: 'mentor', assignedBy: 'admin', email, fullName },
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
      const appBaseUrl = process.env.APP_URL || process.env.APP_BASE_URL || process.env.VITE_APP_BASE_URL || process.env.PUBLIC_APP_URL;
      let emailDeliveryStatus: 'sent' | 'not_sent' | 'failed' = 'not_sent';

      if (appBaseUrl) {
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
          message: 'direct-create invitation email not sent - APP_URL not configured',
          error_code: 'APP_URL_MISSING',
          userId: adminUserId,
          role: 'admin',
          metadata: logContext('email_invite', { emailDeliveryStatus: 'not_sent', appBaseUrlConfigured: false }),
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
          console.error('[MentorVerification] createSignedUploadUrl error:', urlErr);
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
        console.error('[MentorVerification] upload-url error:', err);
      }
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
    }
  });

  // --------------------------------------------------------------------------
  // Phase 13: Admin System Health & Technical Logs Endpoints
  // --------------------------------------------------------------------------

  // GET /api/admin/system-health/metrics: Aggregated health metrics
  app.get('/api/admin/system-health/metrics', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const metrics = await fetchSystemHealthMetrics();
      return res.json({ success: true, metrics });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
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
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
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
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
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
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
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
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
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
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: err.message },
      });
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
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
    }
  });

  // POST /api/admin/system-health/retention: Update log retention days
  app.post('/api/admin/system-health/retention', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { retentionDays } = req.body;
      if (typeof retentionDays !== 'number' || retentionDays < 1 || retentionDays > 365) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'retentionDays must be a number between 1 and 365.' },
        });
      }
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
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
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
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
    }
  });

  // --------------------------------------------------------------------------
  // Vite Middleware (Development) / Static Files (Production)
  // --------------------------------------------------------------------------
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Suggest Key] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
