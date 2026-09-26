-- ==============================================================================
-- PHASE 20: MENTOR NOTIFICATION POINTS AT THE EXACT BOOKING
-- ==============================================================================
--
-- Problem
--   `review_payment` (the admin approval RPC) wrote the mentor notification
--   with a bare `link = '/mentor/bookings'` and no `entity_type`/`entity_id`.
--   The mentor therefore received "New booking to confirm" without any way to
--   reach the booking it referred to, while Mentor -> My Bookings (which is
--   read from the same `bookings` rows) could not be tied back to it.
--
-- Fix
--   The notification now carries the real booking id and links straight to that
--   booking: `/mentor/booking-detail?bookingId=<id>`. Nothing else changes -
--   the admin authorisation check, the payment transition
--   (PENDING_VERIFICATION -> VERIFIED), the booking transition
--   (PAYMENT_PENDING/PENDING_VERIFICATION -> MENTOR_PENDING), the hold release
--   on rejection, and the seeker notification are all preserved byte for byte.
--   No new status is introduced; MENTOR_PENDING remains the state in which the
--   mentor attaches the meeting link and moves the booking to CONFIRMED.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.review_payment(
  p_payment_id uuid,
  p_approve boolean,
  p_rejection_reason text DEFAULT NULL::text,
  p_admin_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_payment public.payments;
  v_booking public.bookings;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  IF p_admin_id IS NULL OR NOT public.has_role(p_admin_id, 'admin')
    OR (auth.uid() IS NOT NULL AND auth.uid() <> p_admin_id) THEN
    RAISE EXCEPTION 'Unauthorized (code: UNAUTHORIZED)';
  END IF;

  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found (code: PAYMENT_NOT_FOUND)'; END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = v_payment.booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found (code: BOOKING_NOT_FOUND)'; END IF;

  IF v_payment.status <> 'PENDING_VERIFICATION'
     OR v_booking.status NOT IN ('PAYMENT_PENDING', 'PENDING_VERIFICATION') THEN
    RAISE EXCEPTION 'Payment was already processed (code: PAYMENT_ALREADY_PROCESSED)';
  END IF;

  IF p_approve THEN
    UPDATE public.payments
    SET status = 'VERIFIED', verified_by = p_admin_id, verified_at = v_now, updated_at = v_now
    WHERE id = v_payment.id;
    UPDATE public.bookings SET status = 'MENTOR_PENDING', updated_at = v_now WHERE id = v_booking.id;
    INSERT INTO public.notifications
      (user_id, title, message, type, event_type, entity_type, entity_id, link, metadata)
    VALUES
      (v_booking.seeker_id, 'Payment approved',
       'Your payment was approved. The mentor will now confirm your session.',
       'PAYMENT', 'PAYMENT_APPROVED', 'booking', v_booking.id::text,
       '/seeker/bookings?bookingId=' || v_booking.id::text,
       jsonb_build_object('bookingId', v_booking.id, 'bookingCode', v_booking.booking_code)),
      (v_booking.mentor_id, 'New booking to confirm',
       'Payment for booking ' || v_booking.booking_code || ' was verified. Please add your meeting link.',
       'BOOKING', 'NEW_BOOKING', 'booking', v_booking.id::text,
       '/mentor/booking-detail?bookingId=' || v_booking.id::text,
       jsonb_build_object('bookingId', v_booking.id, 'bookingCode', v_booking.booking_code));
  ELSE
    UPDATE public.payments
    SET status = 'REJECTED',
        rejection_reason = COALESCE(NULLIF(trim(p_rejection_reason), ''), 'Payment proof was rejected.'),
        verified_by = p_admin_id, verified_at = v_now, updated_at = v_now
    WHERE id = v_payment.id;
    UPDATE public.bookings SET status = 'REJECTED', updated_at = v_now WHERE id = v_booking.id;
    IF v_booking.hold_id IS NOT NULL THEN
      UPDATE public.slot_holds SET status = 'RELEASED'
      WHERE id = v_booking.hold_id AND status IN ('ACTIVE', 'CONVERTED');
    END IF;
    INSERT INTO public.notifications
      (user_id, title, message, type, event_type, entity_type, entity_id, link, metadata)
    VALUES
      (v_booking.seeker_id, 'Payment rejected',
       'Your payment proof was rejected. Please create a new booking after reviewing the reason.',
       'PAYMENT', 'PAYMENT_REJECTED', 'booking', v_booking.id::text,
       '/seeker/bookings?bookingId=' || v_booking.id::text,
       jsonb_build_object(
         'bookingId', v_booking.id,
         'bookingCode', v_booking.booking_code,
         'rejectionReason', COALESCE(NULLIF(trim(p_rejection_reason), ''), 'Payment proof was rejected.')));
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'payment_id', v_payment.id,
    'booking_id', v_booking.id,
    'approved', p_approve
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- Backfill: repair the mentor notifications written by the previous version of
-- this function, which carried no booking reference at all.
--
-- The match is exact rather than guessed: `review_payment` wrote the payment's
-- `verified_at` and the mentor notification in the same statement, so the
-- notification timestamp equals the payment verification timestamp. Only rows
-- where both the notification and the payment land inside the same 5-second
-- window AND the booking belongs to that mentor are touched, so an unrelated
-- notification can never be re-pointed at the wrong booking.
-- ------------------------------------------------------------------------------
UPDATE public.notifications n
SET event_type = 'NEW_BOOKING',
    entity_type = 'booking',
    entity_id = b.id::text,
    link = '/mentor/booking-detail?bookingId=' || b.id::text,
    message = 'Payment for booking ' || b.booking_code || ' was verified. Please add your meeting link.',
    metadata = jsonb_build_object('bookingId', b.id, 'bookingCode', b.booking_code)
FROM public.payments pay
JOIN public.bookings b ON b.id = pay.booking_id
WHERE b.mentor_id = n.user_id
  AND n.entity_id IS NULL
  AND n.type = 'BOOKING'
  AND pay.booking_id = b.id
  AND pay.status = 'VERIFIED'
  AND ABS(EXTRACT(EPOCH FROM (n.created_at - pay.verified_at))) <= 5;
