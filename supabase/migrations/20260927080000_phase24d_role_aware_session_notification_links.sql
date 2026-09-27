-- Role-aware deep links for SESSION_COMPLETED notifications.
--
-- complete_expired_sessions() sent BOTH participants to '/seeker/session'.
-- That route only resolves for a seeker: Router.tsx matches /seeker/session
-- exclusively, and /mentor/booking-detail is the mentor equivalent. A mentor
-- clicking a session-completion notice landed on a route their app does not
-- render.
--
-- The convention already existed in this table and this function simply did not
-- follow it: NEW_BOOKING -> '/mentor/booking-detail?bookingId=<id>',
-- and MENTOR_CONFIRMED / PAYMENT_APPROVED -> '/seeker/bookings?bookingId=<id>'.
-- Verified against live rows before changing anything.

CREATE OR REPLACE FUNCTION public.complete_expired_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_ids       uuid[] := ARRAY[]::uuid[];
  v_row       record;
  v_completed integer := 0;
  v_notified  integer := 0;
BEGIN
  -- ended_by_role / end_reason stay NULL: a natural expiry is not a manual end.
  FOR v_row IN
    UPDATE public.bookings b
       SET status          = 'COMPLETED',
           actual_ended_at = b.end_time,
           updated_at      = now()
     WHERE b.status = 'CONFIRMED'
       AND b.end_time IS NOT NULL
       AND b.end_time <= now()
    RETURNING b.id
  LOOP
    v_ids := array_append(v_ids, v_row.id);
  END LOOP;

  v_completed := COALESCE(array_length(v_ids, 1), 0);
  IF v_completed = 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO public.notifications (
    user_id, title, message, type, link, is_read,
    event_type, entity_type, entity_id, metadata
  )
  SELECT r.user_id,
         'Session completed',
         'Your 1:1 session (' || coalesce(b.booking_code, 'session')
           || ') has ended. The meeting room is now closed and the session workspace is available.',
         'SESSION',
         CASE
           WHEN r.user_id = b.seeker_id
             THEN '/seeker/session?bookingId=' || b.id
           ELSE '/mentor/booking-detail?bookingId=' || b.id
         END,
         false,
         'SESSION_COMPLETED',
         'booking',
         b.id::text,
         jsonb_build_object(
           'bookingId', b.id,
           'auto_completed', true,
           'recipientRole', CASE WHEN r.user_id = b.seeker_id THEN 'seeker' ELSE 'mentor' END
         )
    FROM public.bookings b
    CROSS JOIN LATERAL (VALUES (b.mentor_id), (b.seeker_id)) AS r(user_id)
   WHERE b.id = ANY(v_ids)
     AND r.user_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_notified = ROW_COUNT;

  RAISE NOTICE 'complete_expired_sessions: completed % expired booking(s), % new notification(s)',
    v_completed, v_notified;

  RETURN v_completed;
END;
$fn$;

-- Repair the one row the previous definition already sent to the wrong route.
-- Keyed on event_type + entity_id + recipient so it touches only mentor-targeted
-- SESSION_COMPLETED notices and can never rewrite a seeker's own link.
UPDATE public.notifications n
   SET link = '/mentor/booking-detail?bookingId=' || n.entity_id,
       metadata = coalesce(n.metadata, '{}'::jsonb)
                  || jsonb_build_object('recipientRole', 'mentor')
  FROM public.bookings b
 WHERE n.event_type = 'SESSION_COMPLETED'
   AND n.entity_id = b.id::text
   AND n.user_id = b.mentor_id
   AND n.link = '/seeker/session?bookingId=' || b.id;

-- Backfill recipientRole for seeker rows created by the previous definition,
-- so metadata is uniform regardless of which version sent the notice.
UPDATE public.notifications n
   SET metadata = coalesce(n.metadata, '{}'::jsonb) || jsonb_build_object('recipientRole','seeker')
  FROM public.bookings b
 WHERE n.event_type = 'SESSION_COMPLETED'
   AND n.entity_id = b.id::text
   AND n.user_id = b.seeker_id
   AND n.metadata->>'recipientRole' is distinct from 'seeker';