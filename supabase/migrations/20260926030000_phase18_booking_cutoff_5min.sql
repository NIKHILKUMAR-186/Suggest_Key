-- Five-minute booking cutoff for slot holds.
--
-- Replaces the old 2-hour advance booking restriction, which no longer exists.
-- The rule is now: a slot may be reserved while
--
--     slot_start - now >= 5 minutes
--
-- measured on absolute instants, so it holds for every mentor timezone and
-- never needs a hardcoded zone. The boundary is inclusive at exactly 5
-- minutes: a 5:00 PM slot is still bookable at 4:55 PM and refused at 4:56 PM.
--
-- This is NOT the mentor meeting-link deadline. That operational rule is
-- unchanged and is enforced by the mentor UI, never by booking creation.
--
-- The check uses `clock_timestamp()` rather than `NOW()` so it reflects the wall
-- clock at the instant it is evaluated instead of the transaction start, and it
-- runs inside the same transaction and under the same `FOR UPDATE` mentor row
-- lock as the hold insert, so a seeker cannot cross the boundary between the
-- check and the hold.

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

  -- 11. Create 15-minute slot hold
  INSERT INTO public.slot_holds (
    mentor_id, seeker_id, gig_id, start_time, end_time, status, expires_at, created_at
  ) VALUES (
    p_mentor_id, p_seeker_id, p_gig_id, p_start_time, p_end_time, 'ACTIVE',
    clock_timestamp() + INTERVAL '15 minutes', clock_timestamp()
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
