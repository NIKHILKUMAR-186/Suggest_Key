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
  }

  const demoAccounts: Record<DemoRole, DemoAccount> = {
    seeker: {
      id: 'demo-seeker',
      email: 'seeker@suggestkey.com',
      full_name: 'Aman Kumar',
      password: 'password123',
      role: 'seeker',
    },
    mentor: {
      id: 'demo-mentor',
      email: 'mentor@suggestkey.com',
      full_name: 'Rahul Sharma',
      password: 'password123',
      role: 'mentor',
    },
    admin: {
      id: process.env.ADMIN_EMAIL || 'suggestkey1505@gmail.com',
      email: process.env.ADMIN_EMAIL || 'suggestkey1505@gmail.com',
      full_name: 'Suggest Key Admin',
      password: process.env.ADMIN_PASSWORD || 'password',
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
    };
  };

  app.use(express.json());

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
  app.get('/api/admin/bookings/overdue-links', (req, res) => {
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

  // POST /api/notifications/dispatch: Dispatch new notification
  app.post('/api/notifications/dispatch', (req, res) => {
    try {
      const {
        userId,
        title,
        message,
        type = 'SYSTEM',
        eventType,
        entityType,
        entityId,
        link,
        metadata = {},
      } = req.body;

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
  app.get('/api/sessions/:bookingId/access', (req, res) => {
    try {
      const { bookingId } = req.params;
      const { userId, currentTime } = req.query;

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
  app.get('/api/admin/workspaces', (req, res) => {
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
