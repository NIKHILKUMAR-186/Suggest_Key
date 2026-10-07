-- =============================================================================
-- SUGGEST KEY - PHASE 43: AUTO-CANCELLATION OF OVERDUE MENTOR BOOKINGS
-- =============================================================================
-- Problem this migration fixes
-- -------------------------
-- A MENTOR_PENDING booking whose meeting-link deadline (start_time - 5 min)
-- has passed with no link supplied used to sit in the mentor's "Overdue" tab
-- indefinitely. Nothing in code ever cancelled it: phase 8 states a missed
-- deadline "never cancels the booking", and the mentor confirmation RPC still
-- accepted late links.
--
-- This migration changes that. A missed meeting-link deadline now cancels the
-- booking and starts the refund workflow that the existing mentor/seeker
-- self-cancellation endpoints already use.
--
-- What this file adds
--   1. confirm_booking() — now REJECTS meeting links submitted past the
--      5-minute deadline. A late link is no longer a soft audit event; it is a
--      hard refusal with code MEETING_LINK_DEADLINE_PASSED.
--   2. cancel_overdue_mentor_bookings() — a SECURITY DEFINER, idempotent
--      reconciliation that runs from pg_cron and cancels every MENTOR_PENDING
--      booking with a NULL meeting_url whose deadline has elapsed, using the
--      cancellation_reason 'MENTOR_MEETING_LINK_DEADLINE_MISSED'.
--   3. A pg_cron job that calls the function every minute.
--   4. A partial index so the per-minute scan is O(overdue rows), not O(table).
--   5. A unique notification index so a late boundary + a cron tick can never
--      emit duplicate "session cancelled" notifications.
--   6. Notifications for mentor, seeker, and all admins when auto-cancellation occurs.
--      Seeker notification uses gateway-appropriate wording: "pending admin processing"
--      for manual UPI/QR, "initiated and being processed" for Razorpay.
--
-- What this file deliberately does NOT do
--   - Refund the payment. Refunds require an outbound HTTP call to the payment
--     gateway for Razorpay payments, which cannot be made from PL/pgSQL. The
--     cancellation sets refund_reason so the server-side
--     `reconcileAutoCancelledRefunds` reader can start `runCreateRazorpayRefund`
--     on the next admin read. For manual UPI/QR payments the same reader marks
--     the admin queue. `payments.status` is never advanced to REFUNDED here.
--   - Touch the `bookings.status` CHECK constraint. No OVERDUE status is added;
--     the booking moves straight to CANCELLED.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Reject late mentor confirmations
-- -----------------------------------------------------------------------------
-- confirm_booking previously accepted any HTTPS link regardless of how late.
-- Phase 8's "audit only, never blocks" policy meant a late link was stored and
-- the lateness was recorded for audit. The new rule is that the 5-minute window
-- is a HARD deadline: once it has elapsed the mentor cannot confirm and the
-- booking is (or will shortly be) auto-cancelled by the cron below.
CREATE OR REPLACE FUNCTION public.confirm_booking(
  p_booking_id uuid,
  p_meeting_url text,
  p_mentor_id uuid DEFAULT NULL::uuid
)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_booking public.bookings;
  v_url TEXT := trim(p_meeting_url);
BEGIN
  IF p_mentor_id IS NULL OR NOT public.has_role(p_mentor_id, 'mentor')
     OR (auth.uid() IS NOT NULL AND auth.uid() <> p_mentor_id) THEN
    RAISE EXCEPTION 'Unauthorized (code: UNAUTHORIZED)';
  END IF;

  IF v_url IS NULL OR v_url !~* '^https://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'Meeting URL must be HTTPS (code: INVALID_MEETING_URL)';
  END IF;

  SELECT * INTO v_booking FROM public.bookings
  WHERE id = p_booking_id AND mentor_id = p_mentor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found (code: BOOKING_NOT_FOUND)'; END IF;

  IF v_booking.status <> 'MENTOR_PENDING' THEN
    RAISE EXCEPTION 'Invalid booking state (code: INVALID_STATE_TRANSITION)';
  END IF;

  -- The 5-minute meeting-link deadline is a HARD gate. A link submitted after
  -- start_time - 5min is refused so a mentor cannot retroactively rescue a
  -- booking the cron is about to (or has already) auto-cancelled.
  IF v_booking.start_time - interval '5 minutes' <= now() THEN
    RAISE EXCEPTION 'Meeting link deadline has passed; this booking will be (or has been) auto-cancelled (code: MEETING_LINK_DEADLINE_PASSED)';
  END IF;

  UPDATE public.bookings SET meeting_url = v_url, status = 'CONFIRMED', updated_at = NOW()
  WHERE id = v_booking.id RETURNING * INTO v_booking;

  INSERT INTO public.notifications
    (user_id, title, message, type, event_type, entity_type, entity_id, link, metadata)
  VALUES
    (v_booking.seeker_id, 'Session confirmed',
     'Your mentor added a secure meeting link for booking ' || v_booking.booking_code || '.',
     'SESSION', 'MENTOR_CONFIRMED', 'booking', v_booking.id::text,
     '/seeker/bookings?bookingId=' || v_booking.id::text,
     jsonb_build_object('bookingId', v_booking.id, 'bookingCode', v_booking.booking_code));

  RETURN v_booking;
END;
$$;

COMMENT ON FUNCTION public.confirm_booking(uuid, text, uuid) IS
  'Transitions MENTOR_PENDING to CONFIRMED and stores the meeting link. Refuses links submitted after start_time - 5min (MEETING_LINK_DEADLINE_PASSED). service_role only.';


-- -----------------------------------------------------------------------------
-- 2. Index for the overdue scan
-- -----------------------------------------------------------------------------
-- The cron predicate is always
--   status = 'MENTOR_PENDING' AND meeting_url IS NULL
--   AND start_time - interval '5 minutes' <= now()
-- A partial index on exactly the leading predicates lets the scan touch only
-- the rows that can possibly match.
CREATE INDEX IF NOT EXISTS idx_bookings_overdue_mentor_lookup
  ON public.bookings (start_time)
  WHERE status = 'MENTOR_PENDING' AND meeting_url IS NULL;


-- -----------------------------------------------------------------------------
-- 3. Idempotency guard for auto-cancellation notifications
-- -----------------------------------------------------------------------------
-- The cron and a manual admin reconciliation can fire in the same minute. A
-- plain INSERT would then produce two "session cancelled" notifications, so
-- the insert is protected by a unique index rather than a check-then-insert
-- race. Partial on the auto-cancelled event_type so ordinary notifications are
-- unaffected and the index stays small.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_notifications_auto_cancelled
  ON public.notifications (user_id, event_type, entity_id)
  WHERE event_type = 'BOOKING_AUTO_CANCELLED'
    AND entity_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 4. Idempotent automatic cancellation
-- -----------------------------------------------------------------------------
-- Replaces the phase-8 policy that left overdue MENTOR_PENDING bookings uncancelled.
--
-- Idempotency layers:
--   a. The UPDATE is scoped to MENTOR_PENDING + NULL meeting_url + past deadline,
--      so a second cron tick matches zero rows.
--   b. Each notification insert is ON CONFLICT DO NOTHING against the unique
--      index above.
--   c. The payment transition is scoped to refund_status IS NULL, so a re-run
--      after a failed server-side refund attempt is a no-op.
--
-- Only rows transitioned by THIS invocation produce notifications.
CREATE OR REPLACE FUNCTION public.cancel_overdue_mentor_bookings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_ids       uuid[] := ARRAY[]::uuid[];
  v_rows      record;
  v_cancelled integer := 0;
  v_now       TIMESTAMPTZ := clock_timestamp();
  v_payment   public.payments;
  v_refund_reason TEXT := 'mentor_rejection';
BEGIN
  -- Reconcile every MENTOR_PENDING booking whose meeting-link deadline has
  -- elapsed with no link. ended_at/ended_by_role stay NULL: an auto-cancelled
  -- booking is not a manual end, and the ended_by_role check constraint permits
  -- NULL.
  FOR v_rows IN
    UPDATE public.bookings b
       SET status            = 'CANCELLED',
           cancellation_reason = 'MENTOR_MEETING_LINK_DEADLINE_MISSED',
           meeting_url       = NULL,
           updated_at        = v_now
     WHERE b.status = 'MENTOR_PENDING'
       AND b.meeting_url IS NULL
       AND b.start_time - interval '5 minutes' <= v_now
    RETURNING b.id
  LOOP
    v_ids := array_append(v_ids, v_rows.id);
  END LOOP;

  v_cancelled := COALESCE(array_length(v_ids, 1), 0);

  IF v_cancelled = 0 THEN
    RETURN 0;
  END IF;

  -- Mark each cancelled booking's payment as refund-pending. The payment stays
  -- VERIFIED — it is NOT advanced to REFUNDED here. For manual UPI/QR payments
  -- this sets the admin queue flag so the support centre can act; for Razorpay
  -- payments it leaves refund_id NULL so the server-side
  -- `reconcileAutoCancelledRefunds` reader can call the gateway API.
   FOR v_rows IN
     SELECT id, payment_id, refund_status, p.gateway as gateway
       FROM public.bookings b
       JOIN public.payments p ON p.booking_id = b.id
      WHERE b.id = ANY(v_ids)
        AND p.status = 'VERIFIED'
        AND p.refund_status IS NULL
   LOOP
     -- Conditional update: only succeeds once. A concurrent server-side
     -- runCreateRazorpayRefund wins the race; this UPDATE then matches the
     -- already-PENDING row and is a no-op.
     UPDATE public.payments
        SET refund_status = 'PENDING',
            refund_reason = v_refund_reason,
            manual_refund_required = CASE WHEN v_rows.gateway = 'manual' THEN TRUE ELSE manual_refund_required END,
            updated_at = v_now
      WHERE id = v_rows.payment_id
        AND status = 'VERIFIED'
        AND refund_status IS NULL;
   END LOOP;

  -- One notification per participant per booking, ever. ON CONFLICT DO NOTHING
  -- collapses any race between the cron and a manual admin reconciliation into a
  -- single row.
  -- Notifies mentor, seeker (with gateway-appropriate refund wording), and all admins.
  WITH cancelled_bookings AS (
    SELECT b.id, b.booking_code, b.mentor_id, b.seeker_id, b.start_time, b.amount_inr,
           p.gateway,
           to_char((b.start_time - interval '5 minutes') AT TIME ZONE 'UTC', 'HH24:MI "UTC"') AS deadline_utc
    FROM public.bookings b
    LEFT JOIN public.payments p ON p.booking_id = b.id AND p.status = 'VERIFIED'
    WHERE b.id = ANY(v_ids)
  ),
  mentor_seeker_notifs AS (
    SELECT r.user_id,
           'Session Cancelled (Meeting Link Deadline)',
           CASE
             WHEN cb.gateway = 'manual' THEN
               'Your session (' || coalesce(cb.booking_code, 'session')
                 || ') has been automatically cancelled. The mentor did not provide a meeting link before the deadline: '
                 || cb.deadline_utc
                 || '. Your refund is pending admin processing.'
             ELSE
               'Your session (' || coalesce(cb.booking_code, 'session')
                 || ') has been automatically cancelled. The mentor did not provide a meeting link before the deadline: '
                 || cb.deadline_utc
                 || '. A full refund has been initiated and is being processed.'
           END AS message,
           'BOOKING',
           'BOOKING_AUTO_CANCELLED',
           'booking',
           cb.id::text,
           '/seeker/bookings',
           FALSE,
           jsonb_build_object('bookingId', cb.id, 'auto_cancellation', true, 'reason', 'MENTOR_MEETING_LINK_DEADLINE_MISSED'),
           v_now
    FROM cancelled_bookings cb
    CROSS JOIN LATERAL (VALUES (cb.mentor_id), (cb.seeker_id)) AS r(user_id)
    WHERE r.user_id IS NOT NULL
  ),
  admin_notifs AS (
    SELECT ur.user_id,
           'Booking Auto-Cancelled (Meeting Link Deadline)',
           'Booking ' || coalesce(cb.booking_code, 'session')
             || ' was automatically cancelled because the mentor did not provide a meeting link before the deadline. '
             || 'Session: ' || to_char(cb.start_time AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI "UTC"')
             || '. Amount: ₹' || coalesce(cb.amount_inr::text, '0')
             || '. Gateway: ' || coalesce(cb.gateway, 'unknown')
             || '. Refund status: ' || CASE WHEN cb.gateway = 'manual' THEN 'pending admin processing' ELSE 'processing' END
             || '.',
           'BOOKING',
           'BOOKING_AUTO_CANCELLED_ADMIN',
           'booking',
           cb.id::text,
           '/admin/bookings',
           FALSE,
           jsonb_build_object('bookingId', cb.id, 'auto_cancellation', true, 'reason', 'MENTOR_MEETING_LINK_DEADLINE_MISSED', 'gateway', cb.gateway),
           v_now
    FROM cancelled_bookings cb
    CROSS JOIN LATERAL (
      SELECT u.user_id FROM public.user_roles u WHERE u.role = 'admin'
    ) AS ur(user_id)
  )
  INSERT INTO public.notifications (
    user_id, title, message, type, event_type, entity_type, entity_id, link, is_read, metadata, created_at
  )
  SELECT user_id, title, message, type, event_type, entity_type, entity_id, link, is_read, metadata, created_at
  FROM mentor_seeker_notifs
  UNION ALL
  SELECT user_id, title, message, type, event_type, entity_type, entity_id, link, is_read, metadata, created_at
  FROM admin_notifs
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'cancel_overdue_mentor_bookings: auto-cancelled % overdue booking(s)', v_cancelled;

  RETURN v_cancelled;
END;
$$;

COMMENT ON FUNCTION public.cancel_overdue_mentor_bookings() IS
  'Auto-cancels MENTOR_PENDING bookings past their meeting-link deadline (start_time - 5min), sets cancellation_reason to MENTOR_MEETING_LINK_DEADLINE_MISSED, marks payments refund-pending, and notifies mentor, seeker, and all admins. Idempotent; safe to run every minute from pg_cron.';


-- -----------------------------------------------------------------------------
-- 5. Execute grants
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.confirm_booking(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_booking(uuid, text, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.cancel_overdue_mentor_bookings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_overdue_mentor_bookings() TO service_role;


-- -----------------------------------------------------------------------------
-- 6. Cron
-- -----------------------------------------------------------------------------
-- Reuses the same every-minute schedule as complete_expired_sessions and
-- expire_stale_holds. The `mentor-meeting-link-deadline` prefix keeps the job
-- name distinct so operators can disable just this rule.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cancel-overdue-mentor-bookings') THEN
      PERFORM cron.schedule(
        'cancel-overdue-mentor-bookings',
        '* * * * *',
        'SELECT public.cancel_overdue_mentor_bookings();'
      );
    END IF;
  ELSE
    RAISE NOTICE 'pg_cron not installed: schedule cancel-overdue-mentor-bookings every minute manually.';
  END IF;
END;
$$;
