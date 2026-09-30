-- ==============================================================================
-- SUGGEST KEY - PHASE 30: RESCHEDULE REQUESTS (mentor-approved time change)
-- ==============================================================================
-- Problem
--   `POST /api/seeker/bookings/:id/reschedule` moved a booking immediately: it
--   acquired a new slot hold, overwrote `bookings.start_time`/`end_time`,
--   reset the booking to PAYMENT_PENDING and invalidated the payment. The
--   seeker's time change was never shown to, or agreed by, the mentor. The
--   route also carried a "New gig must belong to the same mentor and segment"
--   rule, which is conceptually wrong for a reschedule: a reschedule changes
--   TIME only. mentor_id, segment_id and gig_id are immutable here.
--
--   Worse, `acquire_slot_hold` performed no availability-window, date-exception
--   or cutoff check, and the server compensated only for duration, so a slot
--   outside the mentor's live hours could be written onto a booking.
--
-- Model
--   Rescheduling is now a REQUEST. The booking is untouched until the mentor
--   accepts. The requested slot is protected by a real `slot_holds` row (so
--   the global `no_overlapping_active_holds` exclusion blocks anyone else for
--   the decision window) with a long, explicit expiry, released on rejection
--   or expiry.
--
-- Global availability
--   Every availability decision in this file is keyed on `mentor_id` and the
--   requested instant only. Gig and segment are carried along for display and
--   for the booking's own duration, never used to scope the timeline. A mentor's
--   5 PM Relationship booking therefore blocks 5 PM for an Autism reschedule,
--   and a free 5 PM is requestable for an existing Autism booking.
--
-- Concurrency
--   The mentor's `profiles` row is locked `FOR UPDATE` on every state change,
--   matching `acquire_slot_hold` and `create_booking_with_hold`, so two
--   seekers racing for the same slot cannot both win, and a mentor cannot
--   approve into a slot that was taken while the request sat PENDING.
--
-- Idempotent: safe to re-run.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. CANONICAL CONFIG
-- ------------------------------------------------------------------------------
-- Two numbers this feature needs, kept next to the existing
-- `hold_duration_minutes` so the platform owns them and no function carries a
-- literal:
--   reschedule_request_expiry_hours - how long a PENDING request holds its slot
--   reschedule_window_minutes      - lead time before the ORIGINAL start_time,
--                                     mirroring APP_CONFIG.NORMAL_CANCELLATION_WINDOW_MINUTES

ALTER TABLE public.platform_config
  ADD COLUMN IF NOT EXISTS reschedule_request_expiry_hours INTEGER NOT NULL DEFAULT 24;

ALTER TABLE public.platform_config
  ADD COLUMN IF NOT EXISTS reschedule_window_minutes INTEGER NOT NULL DEFAULT 10;

INSERT INTO public.platform_config (id, hold_duration_minutes, reschedule_request_expiry_hours, reschedule_window_minutes)
VALUES (1, 5, 24, 10)
ON CONFLICT (id) DO UPDATE
  SET reschedule_request_expiry_hours = 24,
      reschedule_window_minutes = 10,
      updated_at = NOW();

CREATE OR REPLACE FUNCTION public.reschedule_request_expiry_interval()
RETURNS interval
LANGUAGE sql
STABLE
AS $$
  SELECT make_interval(
    hours => COALESCE(
      (SELECT reschedule_request_expiry_hours FROM public.platform_config WHERE id = 1),
      24
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.reschedule_window_interval()
RETURNS interval
LANGUAGE sql
STABLE
AS $$
  SELECT make_interval(
    mins => COALESCE(
      (SELECT reschedule_window_minutes FROM public.platform_config WHERE id = 1),
      10
    )
  );
$$;

-- ------------------------------------------------------------------------------
-- 2. RESCHEDULE_REQUESTS
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.reschedule_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  seeker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  mentor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  -- Snapshot of the booking's timing at the moment the request was made. The
  -- mentor compares these two rows, so they must not drift when the booking
  -- changes underneath them.
  original_start_time TIMESTAMPTZ NOT NULL,
  original_end_time TIMESTAMPTZ NOT NULL,
  requested_start_time TIMESTAMPTZ NOT NULL,
  requested_end_time TIMESTAMPTZ NOT NULL,

  -- The temporary reservation protecting `requested_start_time`.
  hold_id UUID NULL REFERENCES public.slot_holds(id) ON DELETE SET NULL,

  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED')),
  mentor_response TEXT NULL CHECK (mentor_response IN ('ACCEPTED', 'REJECTED')),
  rejection_reason TEXT NULL,

  seeker_requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mentor_responded_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_reschedule_requested_interval CHECK (requested_start_time < requested_end_time),
  CONSTRAINT chk_reschedule_original_interval CHECK (original_start_time < original_end_time),
  CONSTRAINT chk_reschedule_expiry_after_creation CHECK (expires_at > created_at),
  CONSTRAINT chk_reschedule_mentor_responded
    CHECK (
      (status = 'PENDING' AND mentor_responded_at IS NULL)
      OR (status <> 'PENDING' AND mentor_responded_at IS NOT NULL)
    )
);

-- A booking has at most one open request. Two PENDING requests on one booking
-- would each hold a slot, and "which one does the mentor answer?" would be
-- unanswerable.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reschedule_requests_pending_booking
  ON public.reschedule_requests (booking_id)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_reschedule_requests_mentor_status
  ON public.reschedule_requests (mentor_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reschedule_requests_booking
  ON public.reschedule_requests (booking_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reschedule_requests_seeker
  ON public.reschedule_requests (seeker_id, created_at DESC);

-- Partial index used by the expiry sweep; without it the sweep scans history.
CREATE INDEX IF NOT EXISTS idx_reschedule_requests_expiry
  ON public.reschedule_requests (expires_at)
  WHERE status = 'PENDING';

-- RLS. Every state change goes through the SECURITY DEFINER RPCs below, which
-- re-check ownership against the row, so these policies are defence in depth
-- for direct table reads only. No INSERT/UPDATE/DELETE policy is created:
-- participants may read their own requests and nobody may write one directly.
ALTER TABLE public.reschedule_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants can view their own reschedule requests" ON public.reschedule_requests;
CREATE POLICY "Participants can view their own reschedule requests"
  ON public.reschedule_requests FOR SELECT
  USING (auth.uid() = seeker_id OR auth.uid() = mentor_id OR public.is_admin());

-- updated_at maintenance, matching the rest of the schema.
DROP TRIGGER IF EXISTS trg_reschedule_requests_updated_at ON public.reschedule_requests;
CREATE TRIGGER trg_reschedule_requests_updated_at
  BEFORE UPDATE ON public.reschedule_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------------------------
-- 3. EXPIRE_STALE_HOLDS: DO NOT REAP A LIVE RESCHEDULE REQUEST'S HOLD
-- ------------------------------------------------------------------------------
-- `expire_stale_holds` ends with a sweep that RELEASEs any ACTIVE hold whose
-- booking is not PAYMENT_PENDING. A reschedule request's hold is attached to
-- `reschedule_requests`, not to a payment-pending booking, so without this
-- change the next cron tick would silently release every pending request's
-- slot reservation and another seeker could take the requested time.
--
-- Only the reschedule predicate is added. Every other behaviour of the function
-- - the `expires_at` sweep, the PAYMENT_PENDING cancellation, the count
-- returned to the cron - is byte-identical to phase 26.
CREATE OR REPLACE FUNCTION public.expire_stale_holds()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expired_count integer := 0;
BEGIN
  -- Expire ACTIVE holds where expires_at <= NOW()
  UPDATE public.slot_holds
  SET status = 'EXPIRED'
  WHERE status = 'ACTIVE'
    AND expires_at <= NOW();

  GET DIAGNOSTICS expired_count = ROW_COUNT;

  -- Cancel PAYMENT_PENDING bookings linked to now-expired holds
  UPDATE public.bookings
  SET status = 'CANCELLED',
      cancellation_reason = 'Payment window expired (slot hold elapsed without payment proof)',
      updated_at = NOW()
  WHERE status = 'PAYMENT_PENDING'
    AND hold_id IN (
      SELECT id FROM public.slot_holds WHERE status = 'EXPIRED'
    );

  -- Also expire holds that are ACTIVE but whose booking is no longer PAYMENT_PENDING
  -- (e.g., payment was submitted and booking advanced to PENDING_VERIFICATION)
  -- These should be CONVERTED or RELEASED.
  --
  -- A hold backing a PENDING reschedule request has no PAYMENT_PENDING booking
  -- by design, and the booking it belongs to is already CONFIRMED. It is
  -- deliberately skipped here and is governed by `expires_at` on the request
  -- instead, swept by `expire_stale_reschedule_requests()`.
  UPDATE public.slot_holds
  SET status = 'RELEASED'
  WHERE status = 'ACTIVE'
    AND id IN (
      SELECT hold_id FROM public.bookings
      WHERE hold_id = slot_holds.id
        AND status NOT IN ('PAYMENT_PENDING')
    )
    AND id NOT IN (
      SELECT hold_id FROM public.reschedule_requests
      WHERE hold_id IS NOT NULL
        AND status = 'PENDING'
    );

  RETURN expired_count;
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. EXPIRE_STALE_RESCHEDULE_REQUESTS
-- ------------------------------------------------------------------------------
-- Called by the same schedule as `expire_stale_holds`. A PENDING request past
-- its expiry releases its hold and closes as EXPIRED, so an unanswered request
-- cannot hold a mentor's calendar slot indefinitely. The booking is untouched:
-- the seeker's original time stands.
CREATE OR REPLACE FUNCTION public.expire_stale_reschedule_requests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expired_count integer := 0;
BEGIN
  -- Release the slot reservations first so the freed time is bookable even if
  -- the request update below is somehow skipped.
  UPDATE public.slot_holds h
  SET status = 'EXPIRED'
  WHERE h.status = 'ACTIVE'
    AND h.id IN (
      SELECT rr.hold_id
      FROM public.reschedule_requests rr
      WHERE rr.status = 'PENDING'
        AND rr.hold_id IS NOT NULL
        AND rr.expires_at <= NOW()
    );

  UPDATE public.reschedule_requests
  SET status = 'EXPIRED',
      mentor_response = NULL,
      mentor_responded_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE status = 'PENDING'
    AND expires_at <= NOW();

  GET DIAGNOSTICS expired_count = ROW_COUNT;

  RETURN expired_count;
END;
$$;

-- ------------------------------------------------------------------------------
-- 4b. SCHEDULE THE SWEEP
-- ------------------------------------------------------------------------------
-- Same schedule as `expire_stale_holds`. `cron.schedule` upserts on job name, so
-- re-running this migration does not stack duplicate jobs. Guarded on pg_cron
-- being present for the same reason phase 21 enabled it: a database without the
-- extension must still be able to apply this file.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'expire-stale-reschedule-requests-every-minute',
      '* * * * *',
      'SELECT public.expire_stale_reschedule_requests();'
    );
  ELSE
    RAISE NOTICE 'pg_cron not installed: schedule expire-stale-reschedule-requests-every-minute manually.';
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 5. CREATE_RESCHEDULE_REQUEST  (seeker)
-- ------------------------------------------------------------------------------
-- The seeker asks the mentor to move one of THEIR OWN bookings. Nothing about
-- the booking's identity changes: mentor_id, segment_id, gig_id and amount are
-- read from the booking and never accepted as arguments, so a reschedule can
-- neither hop mentors nor change gig or segment.
--
-- The requested interval is validated against the MENTOR'S GLOBAL TIMELINE:
-- live recurring hours or the date exception, plus every non-cancelled booking
-- and every unexpired active hold for that mentor across all of their gigs.
CREATE OR REPLACE FUNCTION public.create_reschedule_request(
  p_booking_id UUID,
  p_seeker_id UUID,
  p_requested_start_time TIMESTAMPTZ,
  p_requested_end_time TIMESTAMPTZ
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings;
  v_gig public.gigs;
  v_existing public.reschedule_requests;
  v_hold public.slot_holds;
  v_request public.reschedule_requests;
  v_exception public.mentor_availability_exceptions;
  v_mentor_tz TEXT;
  v_local_start timestamp;
  v_local_end timestamp;
  v_local_date date;
  v_local_dow int;
  v_duration_minutes int;
  v_now timestamp with time zone;
BEGIN
  -- 1. Interval shape
  IF p_requested_start_time IS NULL OR p_requested_end_time IS NULL
     OR p_requested_start_time >= p_requested_end_time THEN
    RAISE EXCEPTION 'code: INVALID_INTERVAL, Slot start time must be earlier than end time';
  END IF;

  v_now := clock_timestamp();

  IF p_requested_start_time <= v_now THEN
    RAISE EXCEPTION 'code: PAST_SLOT_FORBIDDEN, Cannot request a slot that begins in the past';
  END IF;

  -- 2. Same 5-minute booking cutoff as an initial booking. Rescheduling is not
  --    a way to sneak past it.
  IF p_requested_start_time < v_now + INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'code: BOOKING_CUTOFF_REACHED, This slot can no longer be booked because it starts in less than 5 minutes';
  END IF;

  -- 3. Ownership. A seeker may only request a reschedule of their own booking.
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'code: BOOKING_NOT_FOUND, Booking not found';
  END IF;

  IF v_booking.seeker_id <> p_seeker_id THEN
    RAISE EXCEPTION 'code: FORBIDDEN_NOT_BOOKING_OWNER, You are not authorized to reschedule this booking';
  END IF;

  -- 4. Only a live, pre-session booking is movable. CANCELLED, REJECTED,
  --    COMPLETED and the unpaid states are all out: a time change on an unpaid
  --    booking is a re-book, which goes through the normal gig flow.
  IF v_booking.status NOT IN ('MENTOR_PENDING', 'CONFIRMED') THEN
    RAISE EXCEPTION 'code: BOOKING_NOT_RESCHEDULABLE, This booking cannot be rescheduled because it is not an active confirmed session';
  END IF;

  -- 5. Lead time on the ORIGINAL slot, re-read under the mentor lock below.
  IF v_booking.start_time < v_now + public.reschedule_window_interval() THEN
    RAISE EXCEPTION 'code: RESCHEDULE_WINDOW_CLOSED, This session is too close to its start time to reschedule';
  END IF;

  -- 6. Serialize on the mentor row, exactly like the booking RPCs do.
  PERFORM 1 FROM public.profiles WHERE id = v_booking.mentor_id FOR UPDATE;

  -- 7. Re-read the clock and re-test both deadlines: this request may have
  --    waited behind another booking and crossed either boundary while queued.
  v_now := clock_timestamp();

  IF v_booking.start_time < v_now + public.reschedule_window_interval() THEN
    RAISE EXCEPTION 'code: RESCHEDULE_WINDOW_CLOSED, This session is too close to its start time to reschedule';
  END IF;

  IF p_requested_start_time < v_now + INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'code: BOOKING_CUTOFF_REACHED, This slot can no longer be booked because it starts in less than 5 minutes';
  END IF;

  -- 8. The booking is only still movable if it is the row we validated.
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF v_booking.status NOT IN ('MENTOR_PENDING', 'CONFIRMED') THEN
    RAISE EXCEPTION 'code: BOOKING_NOT_RESCHEDULABLE, This booking is no longer in a reschedulable state';
  END IF;

  -- 9. At most one open request per booking.
  SELECT * INTO v_existing
  FROM public.reschedule_requests
  WHERE booking_id = p_booking_id AND status = 'PENDING';

  IF FOUND THEN
    RAISE EXCEPTION 'code: RESCHEDULE_REQUEST_PENDING, A reschedule request for this booking is already awaiting a mentor decision';
  END IF;

  -- 10. Duration is the BOOKING's own gig duration. This is the only place the
  --     gig is consulted, and only for its length: gig and segment are never
  --     allowed to influence the timeline.
  SELECT * INTO v_gig FROM public.gigs WHERE id = v_booking.gig_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'code: GIG_NOT_FOUND, The gig for this booking no longer exists';
  END IF;

  v_duration_minutes := ROUND(EXTRACT(EPOCH FROM (p_requested_end_time - p_requested_start_time)) / 60.0)::int;
  IF v_duration_minutes <> v_gig.duration_minutes THEN
    RAISE EXCEPTION 'code: DURATION_MISMATCH, Slot duration (%) must equal the gig duration (%)', v_duration_minutes, v_gig.duration_minutes;
  END IF;

  -- 11. Global availability: the mentor's own clock, recurring hours or the
  --     authoritative date exception. No gig, no segment.
  SELECT timezone INTO v_mentor_tz FROM public.profiles WHERE id = v_booking.mentor_id;
  v_mentor_tz := COALESCE(v_mentor_tz, 'Asia/Kolkata');

  v_local_start := p_requested_start_time AT TIME ZONE v_mentor_tz;
  v_local_end := p_requested_end_time AT TIME ZONE v_mentor_tz;
  v_local_date := v_local_start::date;
  v_local_dow := EXTRACT(DOW FROM v_local_start)::int;

  IF v_local_start::date <> v_local_end::date THEN
    RAISE EXCEPTION 'code: OUTSIDE_AVAILABILITY, Slot crosses the mentor local calendar day';
  END IF;

  SELECT * INTO v_exception
  FROM public.mentor_availability_exceptions
  WHERE mentor_id = v_booking.mentor_id
    AND exception_date = v_local_date;

  IF FOUND THEN
    IF NOT v_exception.is_available THEN
      RAISE EXCEPTION 'code: DATE_EXCEPTION_UNAVAILABLE, Mentor is marked unavailable on this date';
    END IF;

    IF v_exception.start_time IS NULL
       OR v_exception.end_time IS NULL
       OR v_local_start::time < v_exception.start_time
       OR v_local_end::time > v_exception.end_time THEN
      RAISE EXCEPTION 'code: OUTSIDE_EXCEPTION_HOURS, Slot falls outside the custom hours set for this date';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM public.mentor_availability a
      WHERE a.mentor_id = v_booking.mentor_id
        AND a.is_enabled
        AND a.day_of_week = v_local_dow
        AND a.start_time <= v_local_start::time
        AND a.end_time >= v_local_end::time
    ) THEN
      RAISE EXCEPTION 'code: OUTSIDE_AVAILABILITY, Slot falls outside the mentor current availability';
    END IF;
  END IF;

  -- 12. A booking for this mentor already occupies it, on any gig, in any
  --     segment. This booking's own row is excluded: its CURRENT time is being
  --     changed, not consumed.
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE mentor_id = v_booking.mentor_id
      AND id <> v_booking.id
      AND status NOT IN ('CANCELLED', 'REJECTED')
      AND tstzrange(start_time, end_time, '[)') && tstzrange(p_requested_start_time, p_requested_end_time, '[)')
  ) THEN
    RAISE EXCEPTION 'code: SLOT_ALREADY_BOOKED, Requested slot is already booked';
  END IF;

  -- 13. Somebody else already holds it, on any gig.
  IF EXISTS (
    SELECT 1 FROM public.slot_holds
    WHERE mentor_id = v_booking.mentor_id
      AND status = 'ACTIVE'
      AND expires_at > clock_timestamp()
      AND tstzrange(start_time, end_time, '[)') && tstzrange(p_requested_start_time, p_requested_end_time, '[)')
  ) THEN
    RAISE EXCEPTION 'code: SLOT_HELD_BY_OTHER, Requested slot is currently on hold by another seeker';
  END IF;

  -- 14. Reserve the requested slot. `no_overlapping_active_holds` makes this
  --     insert itself the concurrency control: if another seeker commits a hold
  --     for the same instant first, this statement fails and the whole
  --     transaction rolls back, so there is never a PENDING request without a
  --     hold behind it.
  INSERT INTO public.slot_holds (
    mentor_id, seeker_id, gig_id, start_time, end_time, status, expires_at, created_at
  ) VALUES (
    v_booking.mentor_id, v_booking.seeker_id, v_booking.gig_id,
    p_requested_start_time, p_requested_end_time, 'ACTIVE',
    v_now + public.reschedule_request_expiry_interval(), v_now
  )
  RETURNING * INTO v_hold;

  -- 15. Record the request. The original times are snapshotted here, so the
  --     mentor always compares against what the seeker actually saw.
  INSERT INTO public.reschedule_requests (
    booking_id, seeker_id, mentor_id,
    original_start_time, original_end_time,
    requested_start_time, requested_end_time,
    hold_id, status, seeker_requested_at, expires_at, created_at, updated_at
  ) VALUES (
    v_booking.id, v_booking.seeker_id, v_booking.mentor_id,
    v_booking.start_time, v_booking.end_time,
    p_requested_start_time, p_requested_end_time,
    v_hold.id, 'PENDING', v_now, v_now + public.reschedule_request_expiry_interval(), v_now, v_now
  )
  RETURNING * INTO v_request;

  -- 16. The booking is NOT modified. It stays exactly as it was until the
  --     mentor accepts, and its slot stays blocked to other seekers meanwhile.

  -- 17. Tell the mentor, with both times in the message.
  INSERT INTO public.notifications (
    user_id, title, message, type, event_type, entity_type, entity_id, link, is_read, created_at
  ) VALUES (
    v_booking.mentor_id,
    'Reschedule Request',
    format(
      'A seeker asked to move booking %s from %s to %s. The original time stays confirmed until you decide.',
      v_booking.booking_code,
      to_char(v_booking.start_time AT TIME ZONE v_mentor_tz, 'DD Mon, HH12:MI AM'),
      to_char(p_requested_start_time AT TIME ZONE v_mentor_tz, 'DD Mon, HH12:MI AM')
    ),
    'BOOKING',
    'MENTOR_RESCHEDULE_REQUESTED',
    'booking',
    v_booking.id::text,
    format('/mentor/booking-detail?bookingId=%s', v_booking.id),
    FALSE,
    v_now
  );

  RETURN json_build_object(
    'success', true,
    'request', json_build_object(
      'id', v_request.id,
      'booking_id', v_request.booking_id,
      'seeker_id', v_request.seeker_id,
      'mentor_id', v_request.mentor_id,
      'original_start_time', v_request.original_start_time,
      'original_end_time', v_request.original_end_time,
      'requested_start_time', v_request.requested_start_time,
      'requested_end_time', v_request.requested_end_time,
      'status', v_request.status,
      'seeker_requested_at', v_request.seeker_requested_at,
      'mentor_responded_at', v_request.mentor_responded_at,
      'mentor_response', v_request.mentor_response,
      'rejection_reason', v_request.rejection_reason,
      'expires_at', v_request.expires_at,
      'created_at', v_request.created_at,
      'updated_at', v_request.updated_at
    ),
    'hold_expires_at', v_hold.expires_at
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. RESPOND_TO_RESCHEDULE_REQUEST  (mentor)
-- ------------------------------------------------------------------------------
-- APPROVED -> the requested time becomes the booking's time. The booking's
--             mentor_id, segment_id, gig_id, amount and status are not in the
--             UPDATE list, so they cannot change. The old slot is released and
--             the request's hold is CONVERTED rather than deleted, so the
--             exclusion constraint sees exactly one reservation.
-- REJECTED -> the booking is not touched at all; only the hold is released.
--
-- A PENDING request that has passed its expiry closes as EXPIRED here rather
-- than being approved into a slot nobody is protecting any more.
CREATE OR REPLACE FUNCTION public.respond_to_reschedule_request(
  p_request_id UUID,
  p_mentor_id UUID,
  p_decision TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.reschedule_requests;
  v_booking public.bookings;
  v_updated_booking public.bookings;
  v_mentor_tz TEXT;
  v_now timestamp with time zone;
BEGIN
  IF p_decision IS NULL OR p_decision NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'code: INVALID_DECISION, Decision must be either APPROVED or REJECTED';
  END IF;

  v_now := clock_timestamp();

  -- 1. Ownership. Only the mentor attached to this request may answer it.
  SELECT * INTO v_request
  FROM public.reschedule_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'code: RESCHEDULE_REQUEST_NOT_FOUND, Reschedule request not found';
  END IF;

  IF v_request.mentor_id <> p_mentor_id THEN
    RAISE EXCEPTION 'code: FORBIDDEN_NOT_BOOKING_OWNER, You are not authorized to respond to this reschedule request';
  END IF;

  -- 2. Open, and not already answered or expired.
  IF v_request.status <> 'PENDING' THEN
    RAISE EXCEPTION 'code: RESCHEDULE_REQUEST_CLOSED, This reschedule request has already been closed';
  END IF;

  IF v_request.expires_at <= v_now THEN
    UPDATE public.reschedule_requests
    SET status = 'EXPIRED', mentor_responded_at = v_now, updated_at = v_now
    WHERE id = v_request.id;

    UPDATE public.slot_holds
    SET status = 'EXPIRED'
    WHERE id = v_request.hold_id AND status = 'ACTIVE';

    RAISE EXCEPTION 'code: RESCHEDULE_REQUEST_EXPIRED, This reschedule request expired before it was answered';
  END IF;

  -- 3. Serialize on the mentor row so approval cannot race another booking.
  PERFORM 1 FROM public.profiles WHERE id = v_request.mentor_id FOR UPDATE;

  SELECT * INTO v_booking FROM public.bookings WHERE id = v_request.booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'code: BOOKING_NOT_FOUND, Booking not found';
  END IF;

  SELECT timezone INTO v_mentor_tz FROM public.profiles WHERE id = v_request.mentor_id;
  v_mentor_tz := COALESCE(v_mentor_tz, 'Asia/Kolkata');

  IF p_decision = 'REJECTED' THEN
    -- 4a. Release the requested slot so somebody else can take it. The
    --     booking is not read into any UPDATE.
    UPDATE public.slot_holds
    SET status = 'RELEASED'
    WHERE id = v_request.hold_id AND status = 'ACTIVE';

    UPDATE public.reschedule_requests
    SET status = 'REJECTED',
        mentor_response = 'REJECTED',
        rejection_reason = NULLIF(TRIM(COALESCE(p_reason, '')), ''),
        mentor_responded_at = v_now,
        updated_at = v_now
    WHERE id = v_request.id
    RETURNING * INTO v_request;

    INSERT INTO public.notifications (
      user_id, title, message, type, event_type, entity_type, entity_id, link, is_read, created_at
    ) VALUES (
      v_request.seeker_id,
      'Reschedule request declined',
      CASE
        WHEN NULLIF(TRIM(COALESCE(p_reason, '')), '') IS NOT NULL
          THEN format('Your mentor declined the requested time for booking %s. Reason: %s. Your original time is unchanged.',
                      v_booking.booking_code, TRIM(p_reason))
        ELSE format('Your mentor declined the requested time for booking %s. Your original time is unchanged.',
                    v_booking.booking_code)
      END,
      'BOOKING',
      'RESCHEDULE_REJECTED',
      'booking',
      v_booking.id::text,
      format('/seeker/booking-detail?bookingId=%s', v_booking.id),
      FALSE,
      v_now
    );

    RETURN json_build_object(
      'success', true,
      'decision', 'REJECTED',
      'request_id', v_request.id,
      'booking', json_build_object(
        'id', v_booking.id,
        'start_time', v_booking.start_time,
        'end_time', v_booking.end_time,
        'status', v_booking.status
      )
    );
  END IF;

  -- 5. APPROVED. The booking must still be the row the request was made
  --    against; a cancelled or completed booking cannot be moved.
  IF v_booking.status NOT IN ('MENTOR_PENDING', 'CONFIRMED') THEN
    UPDATE public.reschedule_requests
    SET status = 'CANCELLED', mentor_responded_at = v_now, updated_at = v_now
    WHERE id = v_request.id;

    UPDATE public.slot_holds
    SET status = 'RELEASED'
    WHERE id = v_request.hold_id AND status = 'ACTIVE';

    RAISE EXCEPTION 'code: BOOKING_NOT_RESCHEDULABLE, This booking is no longer in a reschedulable state';
  END IF;

  -- 6. The requested slot must still be free apart from this request's own
  --    hold. The request's hold is excluded: it is the reservation being
  --    converted, not a competing one.
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE mentor_id = v_request.mentor_id
      AND id <> v_booking.id
      AND status NOT IN ('CANCELLED', 'REJECTED')
      AND tstzrange(start_time, end_time, '[)') && tstzrange(v_request.requested_start_time, v_request.requested_end_time, '[)')
  ) THEN
    RAISE EXCEPTION 'code: SLOT_ALREADY_BOOKED, The requested slot has since been booked by someone else';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.slot_holds
    WHERE mentor_id = v_request.mentor_id
      AND id IS DISTINCT FROM v_request.hold_id
      AND status = 'ACTIVE'
      AND expires_at > v_now
      AND tstzrange(start_time, end_time, '[)') && tstzrange(v_request.requested_start_time, v_request.requested_end_time, '[)')
  ) THEN
    RAISE EXCEPTION 'code: SLOT_HELD_BY_OTHER, The requested slot is currently on hold by another seeker';
  END IF;

  -- 7. Release the old slot first, so the old reservation cannot survive a
  --    failure partway through this transaction. It is a separate row, so
  --    releasing it cannot affect the new one.
  IF v_booking.hold_id IS NOT NULL THEN
    UPDATE public.slot_holds
    SET status = 'RELEASED'
    WHERE id = v_booking.hold_id AND status = 'ACTIVE';
  END IF;

  -- 8. Convert this request's hold. CONVERTED is outside the
  --    `no_overlapping_active_holds` predicate, so the booking below is free
  --    to occupy exactly this interval.
  UPDATE public.slot_holds
  SET status = 'CONVERTED'
  WHERE id = v_request.hold_id AND status = 'ACTIVE';

  -- 9. Move the booking. mentor_id, segment_id, gig_id, amount_inr and status
  --    are deliberately absent: a reschedule is a time change and nothing else.
  UPDATE public.bookings
  SET start_time = v_request.requested_start_time,
      end_time = v_request.requested_end_time,
      hold_id = NULL,
      updated_at = v_now
  WHERE id = v_booking.id
  RETURNING * INTO v_updated_booking;

  UPDATE public.reschedule_requests
  SET status = 'APPROVED',
      mentor_response = 'ACCEPTED',
      rejection_reason = NULL,
      mentor_responded_at = v_now,
      updated_at = v_now
  WHERE id = v_request.id
  RETURNING * INTO v_request;

  INSERT INTO public.notifications (
    user_id, title, message, type, event_type, entity_type, entity_id, link, is_read, created_at
  ) VALUES (
    v_request.seeker_id,
    'Reschedule approved',
    format('Your mentor moved booking %s to %s. Your original time has been released.',
           v_booking.booking_code,
           to_char(v_request.requested_start_time AT TIME ZONE v_mentor_tz, 'DD Mon, HH12:MI AM')),
    'BOOKING',
    'RESCHEDULE_APPROVED',
    'booking',
    v_booking.id::text,
    format('/seeker/booking-detail?bookingId=%s', v_booking.id),
    FALSE,
    v_now
  );

  RETURN json_build_object(
    'success', true,
    'decision', 'APPROVED',
    'request_id', v_request.id,
    'booking', json_build_object(
      'id', v_updated_booking.id,
      'mentor_id', v_updated_booking.mentor_id,
      'segment_id', v_updated_booking.segment_id,
      'gig_id', v_updated_booking.gig_id,
      'start_time', v_updated_booking.start_time,
      'end_time', v_updated_booking.end_time,
      'status', v_updated_booking.status
    )
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. CANCEL_RESCHEDULE_REQUEST  (seeker withdraws their own request)
-- ------------------------------------------------------------------------------
-- The status machine is PENDING -> {APPROVED, REJECTED, EXPIRED, CANCELLED}.
-- A seeker withdrawing is the only way to reach CANCELLED from the app, and it
-- releases the held slot exactly like a rejection does.
CREATE OR REPLACE FUNCTION public.cancel_reschedule_request(
  p_request_id UUID,
  p_seeker_id UUID
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.reschedule_requests;
  v_now timestamp with time zone;
BEGIN
  v_now := clock_timestamp();

  SELECT * INTO v_request
  FROM public.reschedule_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'code: RESCHEDULE_REQUEST_NOT_FOUND, Reschedule request not found';
  END IF;

  IF v_request.seeker_id <> p_seeker_id THEN
    RAISE EXCEPTION 'code: FORBIDDEN_NOT_BOOKING_OWNER, You are not authorized to cancel this reschedule request';
  END IF;

  IF v_request.status <> 'PENDING' THEN
    RAISE EXCEPTION 'code: RESCHEDULE_REQUEST_CLOSED, This reschedule request has already been closed';
  END IF;

  UPDATE public.slot_holds
  SET status = 'RELEASED'
  WHERE id = v_request.hold_id AND status = 'ACTIVE';

  UPDATE public.reschedule_requests
  SET status = 'CANCELLED',
      mentor_responded_at = v_now,
      updated_at = v_now
  WHERE id = v_request.id
  RETURNING * INTO v_request;

  INSERT INTO public.notifications (
    user_id, title, message, type, event_type, entity_type, entity_id, link, is_read, created_at
  ) VALUES (
    v_request.mentor_id,
    'Reschedule Request Withdrawn',
    'The seeker withdrew their reschedule request. The original session time is unchanged.',
    'BOOKING',
    'MENTOR_RESCHEDULE_CANCELLED',
    'booking',
    v_request.booking_id::text,
    format('/mentor/booking-detail?bookingId=%s', v_request.booking_id),
    FALSE,
    v_now
  );

  RETURN json_build_object('success', true, 'request_id', v_request.id, 'status', v_request.status);
END;
$$;

-- ------------------------------------------------------------------------------
-- 8. GET_RESCHEDULE_REQUEST_FOR_BOOKING  (read helper)
-- ------------------------------------------------------------------------------
-- One row per booking, latest first, so both the seeker detail page and the
-- mentor detail page can render the same object without each writing its own
-- query. Ownership is re-checked here rather than trusted from the caller: the
-- RPC is service-role only, so the HTTP layer is not a boundary on its own.
CREATE OR REPLACE FUNCTION public.get_reschedule_request_for_booking(
  p_booking_id UUID,
  p_caller_id UUID
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings;
  v_request public.reschedule_requests;
  v_pending public.reschedule_requests;
  v_is_admin boolean;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'code: BOOKING_NOT_FOUND, Booking not found';
  END IF;

  v_is_admin := public.is_admin();

  IF NOT (v_is_admin OR v_booking.seeker_id = p_caller_id OR v_booking.mentor_id = p_caller_id) THEN
    RAISE EXCEPTION 'code: FORBIDDEN_NOT_BOOKING_OWNER, You are not authorized to view this booking';
  END IF;

  -- The open request, if any, wins over history: the mentor's decision UI must
  -- never be pointed at a stale row while a newer one is waiting.
  SELECT * INTO v_pending
  FROM public.reschedule_requests
  WHERE booking_id = p_booking_id AND status = 'PENDING'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_pending.id IS NOT NULL THEN
    v_request := v_pending;
  ELSE
    SELECT * INTO v_request
    FROM public.reschedule_requests
    WHERE booking_id = p_booking_id
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  IF v_request.id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN json_build_object(
    'id', v_request.id,
    'booking_id', v_request.booking_id,
    'seeker_id', v_request.seeker_id,
    'mentor_id', v_request.mentor_id,
    'original_start_time', v_request.original_start_time,
    'original_end_time', v_request.original_end_time,
    'requested_start_time', v_request.requested_start_time,
    'requested_end_time', v_request.requested_end_time,
    'status', v_request.status,
    'seeker_requested_at', v_request.seeker_requested_at,
    'mentor_responded_at', v_request.mentor_responded_at,
    'mentor_response', v_request.mentor_response,
    'rejection_reason', v_request.rejection_reason,
    'expires_at', v_request.expires_at,
    'created_at', v_request.created_at,
    'updated_at', v_request.updated_at
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 9. EXECUTE GRANTS
-- ------------------------------------------------------------------------------
-- Phase 29 revoked EXECUTE from PUBLIC/anon/authenticated on every SECURITY
-- DEFINER function. Postgres re-grants PUBLIC on a newly created function, so
-- that containment has to be re-applied to the four functions above, or `anon`
-- could call them directly and bypass every ownership check in their bodies.
-- The server holds the service key and is the only intended caller.
-- ------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.reschedule_request_expiry_interval() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reschedule_window_interval()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_stale_reschedule_requests() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_reschedule_request(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.respond_to_reschedule_request(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_reschedule_request(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_reschedule_request_for_booking(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_stale_holds() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reschedule_request_expiry_interval() TO service_role;
GRANT EXECUTE ON FUNCTION public.reschedule_window_interval()        TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_reschedule_requests() TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_holds()                TO service_role;
GRANT EXECUTE ON FUNCTION public.create_reschedule_request(uuid, uuid, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.respond_to_reschedule_request(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_reschedule_request(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_reschedule_request_for_booking(uuid, uuid) TO service_role;

-- Re-apply phase 29's containment to the two functions recreated above.
ALTER FUNCTION public.expire_stale_holds() SET search_path = public;

-- ------------------------------------------------------------------------------
-- 10. POST-CONDITION
-- ------------------------------------------------------------------------------
-- `anon` must not be able to reach any of these, or the ownership checks in
-- their bodies become decorative. Mirrors the phase 29 assertion.
DO $$
DECLARE
  leaked text;
BEGIN
  SELECT string_agg(p.proname, ', ')
    INTO leaked
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN (
       'create_reschedule_request', 'respond_to_reschedule_request',
       'cancel_reschedule_request', 'get_reschedule_request_for_booking',
       'expire_stale_reschedule_requests', 'reschedule_request_expiry_interval',
       'reschedule_window_interval'
     )
     AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 30 containment incomplete: anon can still EXECUTE: %', leaked;
  END IF;
END $$;

-- ==============================================================================
-- VERIFICATION
-- ==============================================================================
-- SELECT * FROM public.reschedule_requests ORDER BY created_at DESC;
--
-- Concurrency, two seekers racing for the same target instant:
--   BEGIN; SELECT * FROM create_reschedule_request(<b1>, <s1>, t0, t1);  -- holds
--   BEGIN; SELECT * FROM create_reschedule_request(<b2>, <s2>, t0, t1);
--   -- second call raises: no_overlapping_active_holds OR SLOT_HELD_BY_OTHER
--
-- One open request per booking:
--   SELECT booking_id, count(*) FROM public.reschedule_requests
--    WHERE status = 'PENDING' GROUP BY booking_id HAVING count(*) > 1;  -- 0 rows
--
-- A pending request's hold survives the hold sweeper:
--   SELECT h.status, h.expires_at FROM public.slot_holds h
--     JOIN public.reschedule_requests r ON r.hold_id = h.id WHERE r.status = 'PENDING';
-- ==============================================================================
