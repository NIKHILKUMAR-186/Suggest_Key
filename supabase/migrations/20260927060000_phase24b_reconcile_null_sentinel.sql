-- Follow-up to phase24: reconcile_expired_sessions() used 'CANCELLED' as its
-- not-found sentinel, which is semantically wrong and produced a misleading
-- refusal reason.
--
-- Symptom, reproduced against live data: calling can_join_session() for a
-- booking that had genuinely COMPLETED returned reason = 'Session was
-- cancelled'. The row was not cancelled. The function's own SELECT was scoped
-- to `seeker_id = auth.uid() OR mentor_id = auth.uid() OR is_admin()`, which
-- yields no row when auth.uid() is NULL (a raw SQL or service-role call with no
-- user JWT), so NOT FOUND was reported as 'CANCELLED' and the caller faithfully
-- turned a bookkeeping sentinel into a user-facing lie.
--
-- 'CANCELLED' is a real business state and must only ever come from the
-- booking's own status. "I could not see this booking" is a different fact and
-- needs a different value, so it is now NULL and every caller branches on it.

CREATE OR REPLACE FUNCTION public.reconcile_expired_sessions(p_booking_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_status text;
  v_start  timestamptz;
  v_end    timestamptz;
  v_ended  timestamptz;
BEGIN
  SELECT status, start_time, end_time, actual_ended_at
    INTO v_status, v_start, v_end, v_ended
    FROM public.bookings
   WHERE id = p_booking_id
     AND (seeker_id = auth.uid() OR mentor_id = auth.uid() OR public.is_admin());

  -- Not visible to this caller. NULL is "unknown", never "cancelled".
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_status = 'CONFIRMED' AND v_end IS NOT NULL AND v_end <= now() THEN
    -- Conditional UPDATE scoped to the still-CONFIRMED row, so a concurrent
    -- manual End Session and this reconciliation cannot both apply.
    UPDATE public.bookings
       SET status          = 'COMPLETED',
           actual_ended_at = v_end,
           updated_at      = now()
     WHERE id = p_booking_id
       AND status = 'CONFIRMED';

    IF FOUND THEN
      INSERT INTO public.notifications (
        user_id, title, message, type, link, is_read,
        event_type, entity_type, entity_id, metadata
      )
      SELECT r.user_id,
             'Session completed',
             'Your 1:1 session (' || coalesce(b.booking_code, 'session')
               || ') has ended. The meeting room is now closed and the session workspace is available.',
             'SESSION',
             '/seeker/session?bookingId=' || b.id,
             false,
             'SESSION_COMPLETED',
             'booking',
             b.id::text,
             jsonb_build_object('bookingId', b.id, 'auto_completed', true)
        FROM public.bookings b
        CROSS JOIN LATERAL (VALUES (b.mentor_id), (b.seeker_id)) AS r(user_id)
       WHERE b.id = p_booking_id
         AND r.user_id IS NOT NULL
      ON CONFLICT DO NOTHING;
    END IF;

    v_status := 'COMPLETED';
  END IF;

  RETURN public.resolve_session_state(v_status, v_start, v_end, v_ended, now());
END;
$fn$;

COMMENT ON FUNCTION public.reconcile_expired_sessions(uuid) IS
  'Reconciles one authorized booking to COMPLETED if its window has closed, then returns the resolved session state. Returns NULL when the caller may not see the booking; NULL means "unknown" and must never be rendered as a business state.';

-- get_session_access: the caller has already proven it may see the booking
-- before reaching this point, so a NULL here means the row vanished mid-request
-- (a concurrent delete) and must not be treated as a state.
CREATE OR REPLACE FUNCTION public.get_session_access(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_booking   public.bookings;
  v_state     text;
  v_now       timestamptz := now();
  v_sec_t5    integer;
  v_sec_start integer;
  v_sec_end   integer;
BEGIN
  SELECT * INTO v_booking FROM public.bookings
   WHERE id = p_booking_id
     AND (seeker_id = auth.uid() OR mentor_id = auth.uid() OR public.is_admin());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found (code: BOOKING_NOT_FOUND)';
  END IF;

  v_state := public.reconcile_expired_sessions(p_booking_id);
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;

  -- Fail closed: an unresolvable state must deny, never fall through to a
  -- branch that would hand out a meeting URL.
  IF v_state IS NULL OR v_state NOT IN
       ('SCHEDULED', 'ACCESS_OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') THEN
    RETURN jsonb_build_object(
      'allowed',      false,
      'reason',       'SESSION_STATE_UNAVAILABLE',
      'state',        'COMPLETED',
      'can_join',     false,
      'access_state', 'COMPLETED',
      'server_now',   v_now
    );
  END IF;

  v_sec_t5    := GREATEST(0, CEIL(EXTRACT(EPOCH FROM ((v_booking.start_time - interval '5 minutes') - v_now)))::int);
  v_sec_start := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_booking.start_time - v_now)))::int);
  v_sec_end   := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_booking.end_time   - v_now)))::int);

  IF v_state IN ('COMPLETED', 'CANCELLED') THEN
    RETURN jsonb_build_object(
      'allowed',         false,
      'reason',          CASE WHEN v_state = 'CANCELLED' THEN 'SESSION_CANCELLED' ELSE 'SESSION_ENDED' END,
      'state',           v_state,
      'can_join',        false,
      'access_state',    v_state,
      'server_now',      v_now,
      'start_time',      v_booking.start_time,
      'end_time',        v_booking.end_time,
      'actual_ended_at', v_booking.actual_ended_at,
      'booking_status',  v_booking.status,
      'seconds_until_t5',     v_sec_t5,
      'seconds_until_start',  v_sec_start,
      'seconds_until_end',    v_sec_end
    );
  END IF;

  IF v_state = 'SCHEDULED' THEN
    RETURN jsonb_build_object(
      'allowed',         false,
      'reason',          'TOO_EARLY',
      'state',           v_state,
      'can_join',        false,
      'access_state',    'BEFORE_T5',
      'server_now',      v_now,
      'start_time',      v_booking.start_time,
      'end_time',        v_booking.end_time,
      'booking_status',  v_booking.status,
      'seconds_until_t5',     v_sec_t5,
      'seconds_until_start',  v_sec_start,
      'seconds_until_end',    v_sec_end
    );
  END IF;

  IF v_booking.meeting_url IS NULL THEN
    RETURN jsonb_build_object(
      'allowed',         false,
      'reason',          'MEETING_LINK_NOT_SET',
      'state',           v_state,
      'can_join',        false,
      'access_state',    v_state,
      'server_now',      v_now,
      'start_time',      v_booking.start_time,
      'end_time',        v_booking.end_time,
      'booking_status',  v_booking.status
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed',         true,
    'reason',          'OK',
    'state',           v_state,
    'can_join',        true,
    'access_state',    CASE WHEN v_state = 'ACCESS_OPEN' THEN 'T5_WINDOW' ELSE 'IN_PROGRESS' END,
    'meeting_url',     v_booking.meeting_url,
    'server_now',      v_now,
    'start_time',      v_booking.start_time,
    'end_time',        v_booking.end_time,
    'booking_status',  v_booking.status,
    'seconds_until_end', v_sec_end
  );
END;
$fn$;

-- can_join_session: it already performs its own participant check with the
-- explicitly passed p_user_id, which is not the same identity as auth.uid().
-- When reconciliation cannot see the row for that reason, fall back to resolving
-- from the row we already proved we may read, rather than inventing a state.
CREATE OR REPLACE FUNCTION public.can_join_session(p_booking_id uuid, p_user_id uuid)
RETURNS TABLE(can_join boolean, meeting_link text, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_booking public.bookings;
  v_state   text;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::text, 'Session not found';
    RETURN;
  END IF;

  IF v_booking.seeker_id <> p_user_id AND v_booking.mentor_id <> p_user_id THEN
    RETURN QUERY SELECT false, NULL::text, 'Not authorized';
    RETURN;
  END IF;

  -- Reconcile before deciding, so a stale CONFIRMED row cannot authorize a join.
  v_state := public.reconcile_expired_sessions(p_booking_id);

  IF v_state IS NULL THEN
    v_state := public.resolve_session_state(
      v_booking.status, v_booking.start_time, v_booking.end_time,
      v_booking.actual_ended_at, now()
    );
  END IF;

  IF v_state = 'CANCELLED' THEN
    RETURN QUERY SELECT false, NULL::text, 'Session was cancelled';
    RETURN;
  END IF;

  IF v_state = 'SCHEDULED' THEN
    RETURN QUERY SELECT false, NULL::text, 'Session not yet started (join available 5 minutes before)';
    RETURN;
  END IF;

  IF v_state = 'COMPLETED' THEN
    RETURN QUERY SELECT false, NULL::text, 'Session has ended';
    RETURN;
  END IF;

  IF v_booking.meeting_url IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, 'Meeting link not set';
    RETURN;
  END IF;

  RETURN QUERY SELECT true, v_booking.meeting_url, 'OK';
END;
$fn$;