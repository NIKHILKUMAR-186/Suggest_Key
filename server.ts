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
import { logger } from './src/lib/logger';
import { auditAction } from './src/lib/auditLogger';

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

    res.on('finish', () => {
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

      logger.requestEnd(
        {
          requestId: authReq.requestId,
          start: authReq.logStart || Date.now(),
          method: req.method,
          path: req.path,
          userId,
          role,
        },
        statusCode,
        errorCode,
        errorMessage || undefined,
        {
          durationMs,
          statusCode,
          error: errorMessage
            ? {
                code: errorCode,
                message: errorMessage,
              }
            : undefined,
        },
      );
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
  app.post('/api/bookings/hold', async (req, res) => {
    try {
      const { seekerId, mentorId, segmentId, gigId, startTime, endTime } = req.body;

      if (!seekerId || !mentorId || !segmentId || !gigId || !startTime || !endTime) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_REQUIRED_FIELDS',
            message: 'seekerId, mentorId, segmentId, gigId, startTime, and endTime are required.',
          },
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
  app.get('/api/mentor/bookings', (req, res) => {
    try {
      const { mentorId, status } = req.query;
      if (!mentorId || typeof mentorId !== 'string') {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_MENTOR_ID', message: 'mentorId query parameter is required.' },
        });
      }

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
  app.get('/api/mentor/bookings/:id', (req, res) => {
    try {
      const bookingId = req.params.id;
      const { mentorId } = req.query;

      const db = getLocalBookingEngineContext();
      const booking = db.bookings.find((b) => b.id === bookingId || b.booking_code === bookingId);

      if (!booking) {
        return res.status(404).json({
          success: false,
          error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found.' },
        });
      }

      if (mentorId && typeof mentorId === 'string') {
        const isOwner = booking.mentor_id === mentorId;

        if (!isOwner) {
          return res.status(403).json({
            success: false,
            error: {
              code: 'FORBIDDEN_NOT_BOOKING_OWNER',
              message: 'Forbidden: You are not authorized to view this booking.',
            },
          });
        }
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
  app.post('/api/mentor/bookings/:id/confirm', async (req, res) => {
    try {
      const bookingId = req.params.id;
      const { mentorId, meetingUrl } = req.body;

      if (!mentorId) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'AUTH_REQUIRED',
            message: 'Mentor authentication required to confirm session.',
          },
        });
      }

      if (!meetingUrl) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MEETING_URL_REQUIRED',
            message: 'Meeting link is required to confirm session.',
          },
        });
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
  app.get('/api/mentor/segments', async (req, res) => {
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
  app.get('/api/mentor/gigs', async (req, res) => {
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
  app.post('/api/mentor/gigs', async (req, res) => {
    try {
      const { mentorId, title, segmentId, durationMinutes, priceInr, description } = req.body;
      if (!mentorId || !title || !segmentId || !durationMinutes || priceInr === undefined) {
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
  app.patch('/api/mentor/gigs/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { mentorId, title, durationMinutes, priceInr, description, isActive } = req.body;

      if (!mentorId) {
        return res.status(401).json({
          success: false,
          error: { code: 'AUTH_REQUIRED', message: 'Mentor authentication required.' },
        });
      }

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
  app.delete('/api/mentor/gigs/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { mentorId } = req.query;

      if (!mentorId || typeof mentorId !== 'string') {
        return res.status(401).json({
          success: false,
          error: { code: 'AUTH_REQUIRED', message: 'Mentor authentication required.' },
        });
      }

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

      // Combine: for each profile, get their roles
      const rolesMap = new Map<string, string[]>();
      for (const ur of userRoles || []) {
        if (!rolesMap.has(ur.user_id)) rolesMap.set(ur.user_id, []);
        rolesMap.get(ur.user_id)!.push(ur.role);
      }

      const users = (profiles || []).map((p: any) => {
        const roles = rolesMap.get(p.id) || ['seeker'];
        const primaryRole = roles.includes('admin') ? 'ADMIN' : roles.includes('mentor') ? 'MENTOR' : 'SEEKER';
        return {
          id: p.id,
          name: p.full_name,
          email: p.email,
          role: primaryRole,
          timezone: p.timezone,
          createdAt: p.created_at ? new Date(p.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Unknown',
          status: 'ACTIVE', // Could be derived from a status field if added
          roles,
        };
      });

      return res.json({ success: true, users });
    } catch (err: any) {
      console.error('Failed to fetch admin users:', err);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
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

      const { error } = await admin
        .from('payments')
        .update({ status: 'VERIFIED', verified_by: req.auth?.user?.id, verified_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;

      // Also update the associated booking status to MENTOR_PENDING
      const { data: payment } = await admin.from('payments').select('booking_id').eq('id', id).single();
      if (payment?.booking_id) {
        await admin.from('bookings').update({ status: 'MENTOR_PENDING' }).eq('id', payment.booking_id);
      }

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

      const { error } = await admin
        .from('payments')
        .update({ status: 'REJECTED', rejection_reason: rejectionReason || 'Invalid transaction screenshot', verified_by: req.auth?.user?.id, verified_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;

      // Also update the associated booking status back to PAYMENT_PENDING
      const { data: payment } = await admin.from('payments').select('booking_id').eq('id', id).single();
      if (payment?.booking_id) {
        await admin.from('bookings').update({ status: 'PAYMENT_PENDING' }).eq('id', payment.booking_id);
      }

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
