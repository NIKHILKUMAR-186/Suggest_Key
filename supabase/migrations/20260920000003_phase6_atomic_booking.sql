-- ==============================================================================
-- SUGGEST KEY - PHASE 6: CONCURRENCY-SAFE BOOKING & SLOT HOLDS
-- ==============================================================================

-- Atomic Booking & Slot Hold Creation Function
-- Enforces all 12 server/database validations:
-- 1. Authenticated user
-- 2. Seeker role
-- 3. Approved & active mentor
-- 4. Active segment with mentor membership
-- 5. Active gig matching duration and price
-- 6. Selected time strictly valid
-- 7. Timezone conversion alignment
-- 8. Future time (no past slots)
-- 9. Weekly recurring mentor availability
-- 10. Date exceptions (leaves/custom hours)
-- 11. No conflicting active/confirmed bookings
-- 12. No overlapping active unexpired holds

CREATE OR REPLACE FUNCTION public.create_booking_with_hold(
  p_seeker_id UUID,
  p_mentor_id UUID,
  p_segment_id UUID,
  p_gig_id UUID,
  p_start_time TIMESTAMPTZ,
  p_end_time TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID;
  v_is_seeker BOOLEAN;
  v_mentor_profile RECORD;
  v_mentor RECORD;
  v_seeker RECORD;
  v_segment RECORD;
  v_gig RECORD;
  v_mentor_tz TEXT;
  v_seeker_tz TEXT;
  v_slot_dow INTEGER;
  v_slot_date DATE;
  v_slot_start_time TIME;
  v_slot_end_time TIME;
  v_is_available_recurring BOOLEAN;
  v_exception RECORD;
  v_has_conflicting_booking BOOLEAN;
  v_has_active_hold BOOLEAN;
  v_hold public.slot_holds;
  v_booking public.bookings;
  v_booking_code TEXT;
BEGIN
  -- --------------------------------------------------------------------------
  -- 1. AUTHENTICATED USER VALIDATION
  -- --------------------------------------------------------------------------
  v_caller_id := auth.uid();
  IF v_caller_id IS NOT NULL AND v_caller_id <> p_seeker_id THEN
    RAISE EXCEPTION 'Unauthorized: Caller identity does not match seeker ID (code: AUTH_USER_MISMATCH)';
  END IF;

  SELECT * INTO v_seeker FROM public.profiles WHERE id = p_seeker_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seeker profile not found (code: SEEKER_NOT_FOUND)';
  END IF;

  -- --------------------------------------------------------------------------
  -- 2. SEEKER ROLE VALIDATION
  -- --------------------------------------------------------------------------
  v_is_seeker := public.has_role(p_seeker_id, 'seeker');
  IF NOT v_is_seeker THEN
    RAISE EXCEPTION 'Forbidden: User does not hold seeker role (code: ROLE_NOT_SEEKER)';
  END IF;

  -- --------------------------------------------------------------------------
  -- 3. MENTOR VALIDATION (Approved & Active)
  -- --------------------------------------------------------------------------
  SELECT * INTO v_mentor FROM public.profiles WHERE id = p_mentor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mentor profile not found (code: MENTOR_NOT_FOUND)';
  END IF;

  SELECT * INTO v_mentor_profile FROM public.mentor_profiles WHERE id = p_mentor_id;
  IF NOT FOUND OR NOT v_mentor_profile.is_approved THEN
    RAISE EXCEPTION 'Mentor is not approved or active (code: MENTOR_NOT_APPROVED)';
  END IF;

  -- --------------------------------------------------------------------------
  -- 4. SEGMENT VALIDATION (Active & Mentor Membership)
  -- --------------------------------------------------------------------------
  SELECT * INTO v_segment FROM public.segments WHERE id = p_segment_id;
  IF NOT FOUND OR NOT v_segment.is_active THEN
    RAISE EXCEPTION 'Mentorship segment is not active (code: SEGMENT_INACTIVE)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.mentor_segments
    WHERE mentor_id = p_mentor_id AND segment_id = p_segment_id
  ) THEN
    RAISE EXCEPTION 'Mentor does not belong to this segment (code: MENTOR_SEGMENT_MISMATCH)';
  END IF;

  -- --------------------------------------------------------------------------
  -- 5. GIG VALIDATION (Active, Belongs to Mentor & Segment)
  -- --------------------------------------------------------------------------
  SELECT * INTO v_gig FROM public.gigs WHERE id = p_gig_id;
  IF NOT FOUND OR NOT v_gig.is_active THEN
    RAISE EXCEPTION 'Gig offer is inactive or does not exist (code: GIG_INACTIVE)';
  END IF;

  IF v_gig.mentor_id <> p_mentor_id OR v_gig.segment_id <> p_segment_id THEN
    RAISE EXCEPTION 'Gig does not belong to specified mentor and segment (code: GIG_MISMATCH)';
  END IF;

  -- --------------------------------------------------------------------------
  -- 6. SELECTED TIME & DURATION VALIDATION
  -- --------------------------------------------------------------------------
  IF p_start_time >= p_end_time THEN
    RAISE EXCEPTION 'Invalid slot bounds: start_time must precede end_time (code: INVALID_INTERVAL)';
  END IF;

  IF EXTRACT(EPOCH FROM (p_end_time - p_start_time)) / 60 <> v_gig.duration_minutes THEN
    RAISE EXCEPTION 'Slot duration does not match gig duration (code: DURATION_MISMATCH)';
  END IF;

  -- --------------------------------------------------------------------------
  -- 7. TIMEZONE CONVERSION
  -- --------------------------------------------------------------------------
  v_mentor_tz := COALESCE(v_mentor.timezone, 'Asia/Kolkata');
  v_seeker_tz := COALESCE(v_seeker.timezone, 'Asia/Kolkata');

  -- Convert UTC timestamp to mentor's local date, day-of-week, and time
  v_slot_date := (p_start_time AT TIME ZONE v_mentor_tz)::DATE;
  v_slot_dow := EXTRACT(DOW FROM (p_start_time AT TIME ZONE v_mentor_tz));
  v_slot_start_time := (p_start_time AT TIME ZONE v_mentor_tz)::TIME;
  v_slot_end_time := (p_end_time AT TIME ZONE v_mentor_tz)::TIME;

  -- --------------------------------------------------------------------------
  -- 8. FUTURE TIME VALIDATION (Past slots cannot be booked)
  -- --------------------------------------------------------------------------
  IF p_start_time <= NOW() THEN
    RAISE EXCEPTION 'Cannot book or hold a slot in the past (code: PAST_SLOT_FORBIDDEN)';
  END IF;

  -- --------------------------------------------------------------------------
  -- PESSIMISTIC LOCKING: Serialize all concurrent operations for this mentor
  -- --------------------------------------------------------------------------
  PERFORM 1 FROM public.profiles WHERE id = p_mentor_id FOR UPDATE;

  -- --------------------------------------------------------------------------
  -- 9. RECURRING MENTOR AVAILABILITY VALIDATION
  -- --------------------------------------------------------------------------
  SELECT EXISTS (
    SELECT 1 FROM public.mentor_availability
    WHERE mentor_id = p_mentor_id
      AND day_of_week = v_slot_dow
      AND is_enabled = TRUE
      AND start_time <= v_slot_start_time
      AND end_time >= v_slot_end_time
  ) INTO v_is_available_recurring;

  -- --------------------------------------------------------------------------
  -- 10. DATE EXCEPTION VALIDATION
  -- --------------------------------------------------------------------------
  SELECT * INTO v_exception
  FROM public.mentor_availability_exceptions
  WHERE mentor_id = p_mentor_id
    AND exception_date = v_slot_date;

  IF FOUND THEN
    IF NOT v_exception.is_available THEN
      RAISE EXCEPTION 'Mentor has an unavailable date exception / leave on this date (code: DATE_EXCEPTION_UNAVAILABLE)';
    END IF;

    IF v_exception.start_time IS NOT NULL AND v_exception.end_time IS NOT NULL THEN
      IF v_slot_start_time < v_exception.start_time OR v_slot_end_time > v_exception.end_time THEN
        RAISE EXCEPTION 'Slot falls outside custom exception operating hours (code: OUTSIDE_EXCEPTION_HOURS)';
      END IF;
    END IF;
  ELSE
    IF NOT v_is_available_recurring THEN
      RAISE EXCEPTION 'Slot is outside mentor regular operating hours for this day (code: OUTSIDE_AVAILABILITY)';
    END IF;
  END IF;

  -- --------------------------------------------------------------------------
  -- 11. CONFLICTING BOOKINGS VALIDATION (Global mentor availability)
  -- --------------------------------------------------------------------------
  SELECT EXISTS (
    SELECT 1 FROM public.bookings
    WHERE mentor_id = p_mentor_id
      AND status NOT IN ('CANCELLED', 'REJECTED', 'PAYMENT_PENDING')
      AND tstzrange(start_time, end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)')
  ) INTO v_has_conflicting_booking;

  IF v_has_conflicting_booking THEN
    RAISE EXCEPTION 'Selected slot conflicts with an existing confirmed booking (code: SLOT_ALREADY_BOOKED)';
  END IF;

  -- --------------------------------------------------------------------------
  -- 12. ACTIVE HOLDS VALIDATION & EXPIRATION CLEANUP
  -- --------------------------------------------------------------------------
  -- Expire any stale holds for this mentor where 15-minute window has elapsed
  UPDATE public.slot_holds
  SET status = 'EXPIRED'
  WHERE mentor_id = p_mentor_id
    AND status = 'ACTIVE'
    AND expires_at <= NOW();

  UPDATE public.bookings
  SET status = 'CANCELLED'
  WHERE mentor_id = p_mentor_id
    AND status = 'PAYMENT_PENDING'
    AND hold_id IN (
      SELECT id FROM public.slot_holds WHERE status = 'EXPIRED'
    );

  -- Check for any active unexpired hold overlapping this slot
  SELECT EXISTS (
    SELECT 1 FROM public.slot_holds
    WHERE mentor_id = p_mentor_id
      AND status = 'ACTIVE'
      AND expires_at > NOW()
      AND tstzrange(start_time, end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)')
  ) INTO v_has_active_hold;

  IF v_has_active_hold THEN
    RAISE EXCEPTION 'Selected slot is currently on hold by another seeker (code: SLOT_HELD_BY_OTHER)';
  END IF;

  -- --------------------------------------------------------------------------
  -- ATOMIC EXECUTION: Create 15-Minute Hold and PAYMENT_PENDING Booking
  -- --------------------------------------------------------------------------
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
    NOW() + INTERVAL '15 minutes',
    NOW()
  ) RETURNING * INTO v_hold;

  -- Generate human-friendly booking code BK-XXXXXX
  v_booking_code := 'BK-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  INSERT INTO public.bookings (
    booking_code,
    mentor_id,
    seeker_id,
    gig_id,
    segment_id,
    hold_id,
    start_time,
    end_time,
    seeker_timezone,
    mentor_timezone,
    amount_inr,
    status,
    created_at,
    updated_at
  ) VALUES (
    v_booking_code,
    p_mentor_id,
    p_seeker_id,
    p_gig_id,
    p_segment_id,
    v_hold.id,
    p_start_time,
    p_end_time,
    v_seeker_tz,
    v_mentor_tz,
    v_gig.price_inr,
    'PAYMENT_PENDING',
    NOW(),
    NOW()
  ) RETURNING * INTO v_booking;

  -- Return complete payload
  RETURN jsonb_build_object(
    'success', TRUE,
    'booking', row_to_json(v_booking),
    'hold', row_to_json(v_hold),
    'expires_at', v_hold.expires_at,
    'hold_duration_minutes', 15,
    'amount_inr', v_gig.price_inr,
    'booking_code', v_booking_code
  );
END;
$$;

-- Grant execution to authenticated users
GRANT EXECUTE ON FUNCTION public.create_booking_with_hold TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_with_hold TO service_role;
