-- ==============================================================================
-- SUGGEST KEY - PHASE 4: BOOKING HOLD 15 MIN -> 5 MIN
-- ==============================================================================
-- Single source of truth: `platform_config.hold_duration_minutes` (default 5).
--
-- `create_booking_with_hold` and `acquire_slot_hold` previously carried a
-- hardcoded `INTERVAL '15 minutes'` when writing `slot_holds.expires_at`. That
-- literal is the only thing replaced here: both functions are otherwise
-- byte-identical to their previous versions, so every validation, the mentor
-- row lock, the booking cutoff and the overlap checks are untouched.
--
-- `expire_stale_holds()` already compared `expires_at <= NOW()`, so shortening
-- the window needs no logic change there; only the cancellation reason, which
-- named the old duration, is reworded.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. CANONICAL CONFIG
-- ------------------------------------------------------------------------------
-- Idempotent: the row and column may already exist from phase 25.

CREATE TABLE IF NOT EXISTS public.platform_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  upi_id TEXT,
  qr_image_storage_path TEXT,
  payment_instructions TEXT,
  currency TEXT,
  payment_account_name TEXT,
  hold_duration_minutes INTEGER NOT NULL DEFAULT 5,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.platform_config
  ADD COLUMN IF NOT EXISTS hold_duration_minutes INTEGER NOT NULL DEFAULT 5;

INSERT INTO public.platform_config (id, hold_duration_minutes)
VALUES (1, 5)
ON CONFLICT (id) DO UPDATE
  SET hold_duration_minutes = 5,
      updated_at = NOW();

-- ------------------------------------------------------------------------------
-- 2. SINGLE READER
-- ------------------------------------------------------------------------------
-- One place that turns the config row into an interval, so no function can
-- reintroduce a literal. Falls back to 5 minutes if the row is missing.
-- ponytail: ceiling is a per-call SELECT; fine at booking volume, cache it if
-- this ever runs on a hot path.

CREATE OR REPLACE FUNCTION public.hold_duration_interval()
RETURNS interval
LANGUAGE sql
STABLE
AS $$
  SELECT make_interval(
    mins => COALESCE(
      (SELECT hold_duration_minutes FROM public.platform_config WHERE id = 1),
      5
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.hold_duration_interval() TO authenticated;
GRANT EXECUTE ON FUNCTION public.hold_duration_interval() TO service_role;

-- ------------------------------------------------------------------------------
-- 3. ACQUIRE_SLOT_HOLD (reschedule path)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acquire_slot_hold(
  p_mentor_id UUID,
  p_seeker_id UUID,
  p_gig_id UUID,
  p_start_time TIMESTAMPTZ,
  p_end_time TIMESTAMPTZ
)
RETURNS public.slot_holds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hold public.slot_holds;
  v_conflicting_booking BOOLEAN;
  v_conflicting_hold BOOLEAN;
BEGIN
  -- 1. Input sanity checks
  IF p_start_time >= p_end_time THEN
    RAISE EXCEPTION 'Invalid interval: start_time must be strictly before end_time';
  END IF;

  IF p_start_time <= NOW() THEN
    RAISE EXCEPTION 'Cannot hold a slot in the past';
  END IF;

  -- 2. Explicit pessimistic lock on the mentor's profile row to serialize concurrent booking attempts
  PERFORM 1 FROM public.profiles WHERE id = p_mentor_id FOR UPDATE;

  -- 3. Expire stale holds for this mentor
  UPDATE public.slot_holds
  SET status = 'EXPIRED'
  WHERE mentor_id = p_mentor_id
    AND status = 'ACTIVE'
    AND expires_at <= NOW();

  -- 4. Check for overlapping non-cancelled bookings
  SELECT EXISTS (
    SELECT 1 FROM public.bookings
    WHERE mentor_id = p_mentor_id
      AND status NOT IN ('CANCELLED', 'REJECTED')
      AND tstzrange(start_time, end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)')
  ) INTO v_conflicting_booking;

  IF v_conflicting_booking THEN
    RAISE EXCEPTION 'Requested slot is already booked';
  END IF;

  -- 5. Check for overlapping active holds
  SELECT EXISTS (
    SELECT 1 FROM public.slot_holds
    WHERE mentor_id = p_mentor_id
      AND status = 'ACTIVE'
      AND expires_at > NOW()
      AND tstzrange(start_time, end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)')
  ) INTO v_conflicting_hold;

  IF v_conflicting_hold THEN
    RAISE EXCEPTION 'Requested slot is currently on hold by another seeker';
  END IF;

  -- 6. Insert new slot hold, expiring when the canonical hold window elapses
  INSERT INTO public.slot_holds (
    mentor_id,
    seeker_id,
    gig_id,
    start_time,
    end_time,
    status,
    expires_at,
    created_at
  ) VALUES (
    p_mentor_id,
    p_seeker_id,
    p_gig_id,
    p_start_time,
    p_end_time,
    'ACTIVE',
    NOW() + public.hold_duration_interval(),
    NOW()
  )
  RETURNING * INTO v_hold;

  RETURN v_hold;
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. CREATE_BOOKING_WITH_HOLD (initial booking path)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_booking_with_hold(
  p_seeker_id uuid,
  p_mentor_id uuid,
  p_segment_id uuid,
  p_gig_id uuid,
  p_start_time timestamp with time zone,
  p_end_time timestamp with time zone
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hold public.slot_holds;
  v_gig public.gigs;
  v_booking public.bookings;
  v_exception public.mentor_availability_exceptions;
  v_mentor_tz TEXT;
  v_seeker_tz TEXT;
  v_booking_code TEXT;
  v_local_start timestamp;
  v_local_end timestamp;
  v_local_date date;
  v_local_dow int;
  v_duration_minutes int;
  v_now timestamp with time zone;
BEGIN
  -- 1. Input sanity checks
  IF p_start_time >= p_end_time THEN
    RAISE EXCEPTION 'code: INVALID_INTERVAL, Slot start time must be earlier than end time';
  END IF;

  v_now := clock_timestamp();

  IF p_start_time <= v_now THEN
    RAISE EXCEPTION 'code: PAST_SLOT_FORBIDDEN, Cannot hold a slot that begins in the past';
  END IF;

  -- 1b. Booking cutoff. `p_start_time` is an absolute instant, so this is the
  --     mentor's own local start compared against the current instant and is
  --     correct for any mentor timezone.
  IF p_start_time < v_now + INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'code: BOOKING_CUTOFF_REACHED, This slot can no longer be booked because it starts in less than 5 minutes';
  END IF;

  -- 2. Explicit pessimistic lock on the mentor's profile row to serialize
  --    concurrent booking attempts. Every check below and the hold insert run
  --    under this lock, so two seekers racing for one slot cannot both win.
  PERFORM 1 FROM public.profiles WHERE id = p_mentor_id FOR UPDATE;

  -- 3. Re-read the wall clock after acquiring the lock. A request that waited
  --    behind another booking may have crossed the cutoff while queued, so the
  --    boundary is re-tested against the instant the hold would actually be
  --    written, not the one that arrived on the wire.
  v_now := clock_timestamp();
  IF p_start_time < v_now + INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'code: BOOKING_CUTOFF_REACHED, This slot can no longer be booked because it starts in less than 5 minutes';
  END IF;

  -- 4. Expire stale holds for this mentor
  UPDATE public.slot_holds
  SET status = 'EXPIRED'
  WHERE mentor_id = p_mentor_id
    AND status = 'ACTIVE'
    AND expires_at <= clock_timestamp();

  -- 5. Fetch gig + timezones before any availability decision
  SELECT * INTO v_gig FROM public.gigs WHERE id = p_gig_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'code: GIG_NOT_FOUND, Associated gig not found';
  END IF;

  IF NOT v_gig.is_active OR v_gig.mentor_id <> p_mentor_id THEN
    RAISE EXCEPTION 'code: GIG_MISMATCH, Gig is not an active offer of this mentor';
  END IF;

  SELECT timezone INTO v_mentor_tz FROM public.profiles WHERE id = p_mentor_id;
  SELECT timezone INTO v_seeker_tz FROM public.profiles WHERE id = p_seeker_id;
  v_mentor_tz := COALESCE(v_mentor_tz, 'Asia/Kolkata');
  v_seeker_tz := COALESCE(v_seeker_tz, 'Asia/Kolkata');

  -- 6. Duration must equal the ACTIVE gig duration, never a client constant
  v_duration_minutes := ROUND(EXTRACT(EPOCH FROM (p_end_time - p_start_time)) / 60.0)::int;
  IF v_duration_minutes <> v_gig.duration_minutes THEN
    RAISE EXCEPTION 'code: DURATION_MISMATCH, Slot duration (%) must equal the active gig duration (%)', v_duration_minutes, v_gig.duration_minutes;
  END IF;

  -- 7. Re-validate the requested interval against the mentor's LIVE availability.
  --    Both instants are resolved in the mentor's own timezone, so a session that
  --    straddles local midnight is rejected rather than silently booked.
  v_local_start := p_start_time AT TIME ZONE v_mentor_tz;
  v_local_end := p_end_time AT TIME ZONE v_mentor_tz;
  v_local_date := v_local_start::date;
  v_local_dow := EXTRACT(DOW FROM v_local_start)::int;

  IF v_local_start::date <> v_local_end::date THEN
    RAISE EXCEPTION 'code: OUTSIDE_AVAILABILITY, Slot crosses the mentor local calendar day';
  END IF;

  SELECT * INTO v_exception
  FROM public.mentor_availability_exceptions
  WHERE mentor_id = p_mentor_id
    AND exception_date = v_local_date;

  IF FOUND THEN
    -- A date exception is authoritative for that date and never merges with the
    -- recurring weekly schedule.
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
      WHERE a.mentor_id = p_mentor_id
        AND a.is_enabled
        AND a.day_of_week = v_local_dow
        AND a.start_time <= v_local_start::time
        AND a.end_time >= v_local_end::time
    ) THEN
      RAISE EXCEPTION 'code: OUTSIDE_AVAILABILITY, Slot falls outside the mentor current availability';
    END IF;
  END IF;

  -- 8. Check for overlapping non-cancelled bookings
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE mentor_id = p_mentor_id
      AND status NOT IN ('CANCELLED', 'REJECTED')
      AND tstzrange(start_time, end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)')
  ) THEN
    RAISE EXCEPTION 'code: SLOT_ALREADY_BOOKED, Requested slot is already booked';
  END IF;

  -- 9. Check for overlapping active holds
  IF EXISTS (
    SELECT 1 FROM public.slot_holds
    WHERE mentor_id = p_mentor_id
      AND status = 'ACTIVE'
      AND expires_at > clock_timestamp()
      AND tstzrange(start_time, end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)')
  ) THEN
    RAISE EXCEPTION 'code: SLOT_HELD_BY_OTHER, Requested slot is currently on hold by another seeker';
  END IF;

  -- 10. Generate booking code
  v_booking_code := 'BK-' || TO_CHAR(clock_timestamp(), 'YYMMDDHH24MI') || '-' || SUBSTRING(gen_random_uuid()::text FROM 1 FOR 4);

  -- 11. Create the slot hold, expiring when the canonical hold window elapses
  INSERT INTO public.slot_holds (
    mentor_id, seeker_id, gig_id, start_time, end_time, status, expires_at, created_at
  ) VALUES (
    p_mentor_id, p_seeker_id, p_gig_id, p_start_time, p_end_time, 'ACTIVE',
    clock_timestamp() + public.hold_duration_interval(), clock_timestamp()
  )
  RETURNING * INTO v_hold;

  -- 12. Create PAYMENT_PENDING booking
  INSERT INTO public.bookings (
    booking_code, mentor_id, seeker_id, gig_id, segment_id, hold_id,
    start_time, end_time, seeker_timezone, mentor_timezone,
    amount_inr, status, created_at, updated_at
  ) VALUES (
    v_booking_code, p_mentor_id, p_seeker_id, v_gig.id, p_segment_id, v_hold.id,
    p_start_time, p_end_time, v_seeker_tz, v_mentor_tz,
    v_gig.price_inr, 'PAYMENT_PENDING', clock_timestamp(), clock_timestamp()
  )
  RETURNING * INTO v_booking;

  -- 13. Return the canonical booking record (with hold_id and status)
  RETURN json_build_object(
    'success', true,
    'booking', json_build_object(
      'id', v_booking.id,
      'booking_code', v_booking.booking_code,
      'mentor_id', v_booking.mentor_id,
      'seeker_id', v_booking.seeker_id,
      'gig_id', v_booking.gig_id,
      'segment_id', v_booking.segment_id,
      'hold_id', v_booking.hold_id,
      'start_time', v_booking.start_time,
      'end_time', v_booking.end_time,
      'seeker_timezone', v_booking.seeker_timezone,
      'mentor_timezone', v_booking.mentor_timezone,
      'amount_inr', v_booking.amount_inr,
      'status', v_booking.status,
      'created_at', v_booking.created_at,
      'updated_at', v_booking.updated_at
    ),
    'hold', json_build_object(
      'id', v_hold.id,
      'mentor_id', v_hold.mentor_id,
      'seeker_id', v_hold.seeker_id,
      'gig_id', v_hold.gig_id,
      'start_time', v_hold.start_time,
      'end_time', v_hold.end_time,
      'status', v_hold.status,
      'expires_at', v_hold.expires_at,
      'created_at', v_hold.created_at
    )
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. EXPIRE_STALE_HOLDS
-- ------------------------------------------------------------------------------
-- Logic unchanged: it already expires on `expires_at <= NOW()`, so it picks up
-- the shorter window with no edit. Only the reason string named the old
-- duration. The status filter is unchanged, so CONFIRMED/ACTIVE bookings are
-- still never touched.
-- ------------------------------------------------------------------------------

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
  -- These should be CONVERTED or RELEASED
  UPDATE public.slot_holds
  SET status = 'RELEASED'
  WHERE status = 'ACTIVE'
    AND id IN (
      SELECT hold_id FROM public.bookings
      WHERE hold_id = slot_holds.id
        AND status NOT IN ('PAYMENT_PENDING')
    );

  RETURN expired_count;
END;
$$;

-- ==============================================================================
-- VERIFICATION
-- ==============================================================================
-- SELECT hold_duration_minutes FROM public.platform_config WHERE id = 1;  -- 5
-- SELECT public.hold_duration_interval();                                  -- 00:05:00
-- No booking-hold literal may remain:
--   SELECT proname, prosrc FROM pg_proc
--   WHERE proname IN ('create_booking_with_hold', 'acquire_slot_hold',
--                     'expire_stale_holds', 'hold_duration_interval')
--     AND prosrc LIKE '%15 minutes%';
