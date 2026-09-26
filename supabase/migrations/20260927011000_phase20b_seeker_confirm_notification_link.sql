-- ==============================================================================
-- PHASE 20b: SEEKER NOTIFICATION POINTS AT THE EXACT BOOKING ON CONFIRMATION
-- ==============================================================================
--
-- Problem
--   `confirm_booking` (the mentor confirmation RPC) wrote the seeker
--   notification with a bare `link = '/seeker/bookings'` and no
--   `event_type`/`entity_id`, so "Session confirmed" could not be traced back
--   to - or opened at - the booking it was about.
--
-- Fix
--   The notification now carries the real booking id and links to that booking.
--   The authorisation check, the HTTPS-only meeting URL validation, the
--   MENTOR_PENDING -> CONFIRMED transition and the meeting URL write are all
--   unchanged. No new status is introduced.
-- ==============================================================================

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
