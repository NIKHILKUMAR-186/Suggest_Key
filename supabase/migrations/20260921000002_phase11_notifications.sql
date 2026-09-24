-- ==============================================================================
-- SUGGEST KEY - PHASE 11: IN-APP NOTIFICATIONS SCHEMA, RLS & SEED DATA
-- ==============================================================================

-- 1. Ensure public.notifications table exists and has all Phase 11 fields
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'SYSTEM',
  link TEXT,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure extended columns exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notifications' AND column_name = 'event_type') THEN
    ALTER TABLE public.notifications ADD COLUMN event_type TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notifications' AND column_name = 'entity_type') THEN
    ALTER TABLE public.notifications ADD COLUMN entity_type TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notifications' AND column_name = 'entity_id') THEN
    ALTER TABLE public.notifications ADD COLUMN entity_id TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notifications' AND column_name = 'read_at') THEN
    ALTER TABLE public.notifications ADD COLUMN read_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notifications' AND column_name = 'metadata') THEN
    ALTER TABLE public.notifications ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- Drop obsolete check constraint on type if exists so all categories work smoothly
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_event_type ON public.notifications(event_type);
CREATE INDEX IF NOT EXISTS idx_notifications_entity ON public.notifications(entity_type, entity_id);

-- 2. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can mark own notifications as read" ON public.notifications;
DROP POLICY IF EXISTS "Users can view own or admin view all notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update own or admin update notifications" ON public.notifications;
DROP POLICY IF EXISTS "Allow service and admins to insert notifications" ON public.notifications;

-- Policy: Users can view their own notifications; Admins can view all
CREATE POLICY "Users can view own or admin view all notifications"
  ON public.notifications FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());

-- Policy: Users can mark their own notifications as read (or admin)
CREATE POLICY "Users can update own or admin update notifications"
  ON public.notifications FOR UPDATE
  USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

-- Policy: Users can insert notifications for themselves; Admins can insert for any user
CREATE POLICY "Allow authenticated users to insert own or admin can insert for any user"
  ON public.notifications FOR INSERT
  WITH CHECK (auth.uid() = user_id OR public.is_admin());

-- 3. RPC FUNCTIONS FOR NOTIFICATION LIFECYCLE
CREATE OR REPLACE FUNCTION public.mark_notification_as_read(p_notification_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.notifications
  SET is_read = TRUE,
      read_at = NOW()
  WHERE id = p_notification_id
    AND (user_id = p_user_id OR public.is_admin());
  
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_as_read(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE public.notifications
  SET is_read = TRUE,
      read_at = NOW()
  WHERE user_id = p_user_id
    AND is_read = FALSE;
  
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

-- ==============================================================================
-- 3b. ENSURE SEED PROFILES EXIST (self-contained; safe if Phase 5 already ran)
-- Only inserts when the matching auth.users row exists, so the FK to auth.users
-- (profiles.id -> auth.users.id) is always satisfied.
-- ==============================================================================
DO $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, timezone)
  SELECT id, email, full_name, timezone
  FROM (VALUES
    ('88888888-8888-8888-8888-888888888881'::uuid, 'seeker.aman@suggestkey.com', 'Aman Kumar', 'Asia/Kolkata'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'mentor.rahul@suggestkey.com', 'Rahul Sharma', 'Asia/Kolkata'),
    ('88888888-8888-8888-8888-888888888880'::uuid, 'admin.operations@suggestkey.com', 'Admin Operations', 'Asia/Kolkata')
  ) AS v(id, email, full_name, timezone)
  WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v.id)
  ON CONFLICT (id) DO NOTHING;
END $$;

-- ==============================================================================
-- 4. REAL DATABASE SEED NOTIFICATIONS
-- Matches all required events across Seeker, Mentor, and Admin roles
-- ==============================================================================

-- Clean prior seed demo notifications to prevent duplicate key clutter
DELETE FROM public.notifications 
WHERE id IN (
  'e0000001-0000-0000-0000-000000000001',
  'e0000001-0000-0000-0000-000000000002',
  'e0000001-0000-0000-0000-000000000003',
  'e0000001-0000-0000-0000-000000000004',
  'e0000001-0000-0000-0000-000000000005',
  'e0000001-0000-0000-0000-000000000006',
  'e0000001-0000-0000-0000-000000000007',
  'e0000001-0000-0000-0000-000000000008',
  'e0000001-0000-0000-0000-000000000009',
  'e0000001-0000-0000-0000-000000000010',
  'e0000001-0000-0000-0000-000000000011',
  -- Mentor seeds
  'e0000002-0000-0000-0000-000000000001',
  'e0000002-0000-0000-0000-000000000002',
  'e0000002-0000-0000-0000-000000000003',
  'e0000002-0000-0000-0000-000000000004',
  'e0000002-0000-0000-0000-000000000005',
  'e0000002-0000-0000-0000-000000000006',
  'e0000002-0000-0000-0000-000000000007',
  'e0000002-0000-0000-0000-000000000008',
  -- Admin seeds
  'e0000003-0000-0000-0000-000000000001',
  'e0000003-0000-0000-0000-000000000002',
  'e0000003-0000-0000-0000-000000000003',
  'e0000003-0000-0000-0000-000000000004'
);

-- ------------------------------------------------------------------------------
-- A. SEEKER NOTIFICATIONS (Aman Kumar: usr-8801 / 88888888-8888-8888-8888-888888888881)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = '88888888-8888-8888-8888-888888888881') THEN
    INSERT INTO public.notifications (
      id, user_id, title, message, type, event_type, entity_type, entity_id, link, is_read, created_at
    )
    VALUES
  -- 1. booking created
  (
    'e0000001-0000-0000-0000-000000000001',
    '88888888-8888-8888-8888-888888888881',
    'Booking Created',
    'Consultation slot reserved with Rahul Sharma for Relationship Advisor. Please complete UPI payment verification.',
    'BOOKING',
    'BOOKING_CREATED',
    'booking',
    'bk-9021',
    '/seeker/bookings?bookingId=bk-9021',
    TRUE,
    NOW() - INTERVAL '3 days'
  ),
  -- 2. payment submitted
  (
    'e0000001-0000-0000-0000-000000000002',
    '88888888-8888-8888-8888-888888888881',
    'Payment Submitted',
    'Your UPI transaction screenshot (₹999) has been uploaded and queued for admin ledger verification.',
    'PAYMENT',
    'PAYMENT_SUBMITTED',
    'payment',
    'bk-9021',
    '/seeker/bookings?bookingId=bk-9021',
    TRUE,
    NOW() - INTERVAL '2 days'
  ),
  -- 3. payment approved
  (
    'e0000001-0000-0000-0000-000000000003',
    '88888888-8888-8888-8888-888888888881',
    'Payment Approved',
    'Your payment of ₹999 for BK-9020 has been verified by the platform team. Awaiting mentor confirmation.',
    'PAYMENT',
    'PAYMENT_APPROVED',
    'payment',
    'bk-9020',
    '/seeker/bookings?bookingId=bk-9020',
    TRUE,
    NOW() - INTERVAL '28 hours'
  ),
  -- 4. payment rejected
  (
    'e0000001-0000-0000-0000-000000000004',
    '88888888-8888-8888-8888-888888888881',
    'Payment Verification Rejected',
    'Payment receipt for BK-9017 could not be verified: UPI reference number does not match banking statement. Please re-upload.',
    'PAYMENT',
    'PAYMENT_REJECTED',
    'payment',
    'bk-9017',
    '/seeker/bookings?bookingId=bk-9017',
    TRUE,
    NOW() - INTERVAL '40 hours'
  ),
  -- 5. mentor confirmation
  (
    'e0000001-0000-0000-0000-000000000005',
    '88888888-8888-8888-8888-888888888881',
    'Mentor Confirmed Session',
    'Rahul Sharma has confirmed your consultation BK-9020. Your spot is officially secured.',
    'BOOKING',
    'MENTOR_CONFIRMED',
    'booking',
    'bk-9020',
    '/seeker/bookings?bookingId=bk-9020',
    FALSE,
    NOW() - INTERVAL '5 hours'
  ),
  -- 6. meeting link available
  (
    'e0000001-0000-0000-0000-000000000006',
    '88888888-8888-8888-8888-888888888881',
    'Meeting Link Available',
    'Your Google Meet link for BK-SESSION-SOON is now accessible. You can join 5 minutes before scheduled start time.',
    'SESSION',
    'MEETING_LINK_AVAILABLE',
    'session',
    'bk-session-soon',
    '/seeker/session?bookingId=bk-session-soon',
    FALSE,
    NOW() - INTERVAL '45 minutes'
  ),
  -- 7. session reminder
  (
    'e0000001-0000-0000-0000-000000000007',
    '88888888-8888-8888-8888-888888888881',
    'Session Reminder: Starting in 15 Minutes',
    'Your 1:1 consultation with Rahul Sharma begins shortly. Test your audio and video in the session room.',
    'SESSION',
    'SESSION_REMINDER',
    'session',
    'bk-session-soon',
    '/seeker/session?bookingId=bk-session-soon',
    FALSE,
    NOW() - INTERVAL '15 minutes'
  ),
  -- 8. cancellation
  (
    'e0000001-0000-0000-0000-000000000008',
    '88888888-8888-8888-8888-888888888881',
    'Booking Cancelled',
    'Your previous consultation BK-9019 was cancelled upon request. A credit receipt has been logged.',
    'BOOKING',
    'CANCELLATION',
    'booking',
    'bk-9019',
    '/seeker/bookings?bookingId=bk-9019',
    TRUE,
    NOW() - INTERVAL '5 days'
  ),
  -- 9. rescheduling
  (
    'e0000001-0000-0000-0000-000000000009',
    '88888888-8888-8888-8888-888888888881',
    'Session Rescheduled',
    'Session BK-9018 was updated to match your requested time adjustment with Rahul Sharma.',
    'BOOKING',
    'RESCHEDULING',
    'booking',
    'bk-9018',
    '/seeker/bookings?bookingId=bk-9018',
    TRUE,
    NOW() - INTERVAL '4 days'
  ),
  -- 10. session completed
  (
    'e0000001-0000-0000-0000-000000000010',
    '88888888-8888-8888-8888-888888888881',
    'Session Completed',
    'Your 60-minute consultation has concluded. The mentor is now drafting your post-session workspace takeaways.',
    'SESSION',
    'SESSION_COMPLETED',
    'session',
    'bk-session-ended',
    '/seeker/workspace?bookingId=bk-session-ended',
    FALSE,
    NOW() - INTERVAL '2 hours'
  ),
  -- 11. workspace updated
  (
    'e0000001-0000-0000-0000-000000000011',
    '88888888-8888-8888-8888-888888888881',
    'Workspace Notes Published',
    'Rahul Sharma has published your consultation takeaways, personalized suggestions, and next steps in your workspace.',
    'WORKSPACE',
    'WORKSPACE_UPDATED',
    'workspace',
    'bk-session-ended',
    '/seeker/workspace?bookingId=bk-session-ended',
    FALSE,
    NOW() - INTERVAL '1 hour'
  );
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- B. MENTOR NOTIFICATIONS (Rahul Sharma: usr-8802 / 11111111-1111-1111-1111-111111111111)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = '11111111-1111-1111-1111-111111111111') THEN
    INSERT INTO public.notifications (
      id, user_id, title, message, type, event_type, entity_type, entity_id, link, is_read, created_at
    )
    VALUES
  -- 1. payment approved
  (
    'e0000002-0000-0000-0000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    'Seeker Payment Verified',
    'Payment for BK-9021 (₹999) has been verified by Admin. Please provide your HTTPS meeting link to confirm.',
    'PAYMENT',
    'PAYMENT_APPROVED',
    'booking',
    'bk-9021',
    '/mentor/booking-detail?bookingId=bk-9021',
    FALSE,
    NOW() - INTERVAL '3 hours'
  ),
  -- 2. new booking
  (
    'e0000002-0000-0000-0000-000000000002',
    '11111111-1111-1111-1111-111111111111',
    'New Booking Request',
    'Aman Kumar reserved a 60-minute Relationship Guidance session for BK-9025.',
    'BOOKING',
    'NEW_BOOKING',
    'booking',
    'bk-9025',
    '/mentor/bookings',
    TRUE,
    NOW() - INTERVAL '2 days'
  ),
  -- 3. meeting link deadline
  (
    'e0000002-0000-0000-0000-000000000003',
    '11111111-1111-1111-1111-111111111111',
    'Action Required: Meeting Link Deadline',
    'Session BK-9021 starts today. Policy mandates providing meeting URL at least 2 hours before start time.',
    'SESSION',
    'MEETING_LINK_DEADLINE',
    'booking',
    'bk-9021',
    '/mentor/booking-detail?bookingId=bk-9021',
    FALSE,
    NOW() - INTERVAL '2 hours'
  ),
  -- 4. overdue meeting link
  (
    'e0000002-0000-0000-0000-000000000004',
    '11111111-1111-1111-1111-111111111111',
    'URGENT: Meeting Link Overdue (<2h)',
    'Session BK-9022 starts in 75 minutes. Add meeting URL immediately to prevent administrative escalation.',
    'SESSION',
    'OVERDUE_MEETING_LINK',
    'booking',
    'bk-9022',
    '/mentor/booking-detail?bookingId=bk-9022',
    FALSE,
    NOW() - INTERVAL '30 minutes'
  ),
  -- 5. session reminder
  (
    'e0000002-0000-0000-0000-000000000005',
    '11111111-1111-1111-1111-111111111111',
    'Upcoming Consultation Reminder',
    'Your session with Aman Kumar (BK-SESSION-SOON) begins in 15 minutes. Authoritative join unlocks at T-5.',
    'SESSION',
    'MENTOR_SESSION_REMINDER',
    'booking',
    'bk-session-soon',
    '/mentor/booking-detail?bookingId=bk-session-soon',
    FALSE,
    NOW() - INTERVAL '15 minutes'
  ),
  -- 6. cancellation
  (
    'e0000002-0000-0000-0000-000000000006',
    '11111111-1111-1111-1111-111111111111',
    'Session Cancelled by Seeker',
    'Consultation BK-9019 was cancelled by seeker. The calendar slot has been reopened for bookings.',
    'BOOKING',
    'MENTOR_CANCELLATION',
    'booking',
    'bk-9019',
    '/mentor/bookings',
    TRUE,
    NOW() - INTERVAL '4 days'
  ),
  -- 7. rescheduling
  (
    'e0000002-0000-0000-0000-000000000007',
    '11111111-1111-1111-1111-111111111111',
    'Session Rescheduled',
    'Consultation BK-9018 was shifted to Friday 16:00 IST according to your updated calendar.',
    'BOOKING',
    'MENTOR_RESCHEDULING',
    'booking',
    'bk-9018',
    '/mentor/bookings',
    TRUE,
    NOW() - INTERVAL '3 days'
  ),
  -- 8. completion
  (
    'e0000002-0000-0000-0000-000000000008',
    '11111111-1111-1111-1111-111111111111',
    'Session Concluded: Workspace Draft Ready',
    'Consultation BK-SESSION-ENDED has completed. Please prepare takeaways, action steps, and publish to seeker.',
    'WORKSPACE',
    'SESSION_COMPLETION',
    'workspace',
    'bk-session-ended',
    '/mentor/workspace?bookingId=bk-session-ended',
    FALSE,
    NOW() - INTERVAL '90 minutes'
  );
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- C. ADMIN NOTIFICATIONS (Admin Ops: usr-8800 / 88888888-8888-8888-8888-888888888880)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = '88888888-8888-8888-8888-888888888880') THEN
    INSERT INTO public.notifications (
      id, user_id, title, message, type, event_type, entity_type, entity_id, link, is_read, created_at
    )
    VALUES
  -- 1. payment proof submitted
  (
    'e0000003-0000-0000-0000-000000000001',
    '88888888-8888-8888-8888-888888888880',
    'Payment Verification Required',
    'New UPI receipt uploaded for BK-9021 (₹999) by Aman Kumar. Awaiting ledger verification.',
    'PAYMENT',
    'ADMIN_PAYMENT_PROOF_SUBMITTED',
    'payment',
    'bk-9021',
    '/admin/payments',
    FALSE,
    NOW() - INTERVAL '3 hours'
  ),
  -- 2. overdue mentor link
  (
    'e0000003-0000-0000-0000-000000000002',
    '88888888-8888-8888-8888-888888888880',
    'SLA Breach: Overdue Mentor Link',
    'Mentor Rahul Sharma has not provided meeting URL for BK-9022 starting in 75 minutes. Overdue SLA triggered.',
    'SESSION',
    'ADMIN_OVERDUE_MENTOR_LINK',
    'booking',
    'bk-9022',
    '/admin/bookings',
    FALSE,
    NOW() - INTERVAL '30 minutes'
  ),
  -- 3. mentor cancellation
  (
    'e0000003-0000-0000-0000-000000000003',
    '88888888-8888-8888-8888-888888888880',
    'Mentor Emergency Cancellation Logged',
    'Mentor Dr. Vikram Joshi submitted an emergency cancellation for consultation BK-9016.',
    'BOOKING',
    'ADMIN_MENTOR_CANCELLATION',
    'booking',
    'bk-9016',
    '/admin/bookings',
    TRUE,
    NOW() - INTERVAL '1 day'
  ),
  -- 4. booking intervention required
  (
    'e0000003-0000-0000-0000-000000000004',
    '88888888-8888-8888-8888-888888888880',
    'Booking Intervention Required: Urgent',
    'Session BK-9022 reaches T-60m with missing meeting link. Administrative manual override or outreach advised.',
    'BOOKING',
    'ADMIN_BOOKING_INTERVENTION',
    'booking',
    'bk-9022',
    '/admin/bookings',
    FALSE,
    NOW() - INTERVAL '10 minutes'
  );
  END IF;
END $$;
