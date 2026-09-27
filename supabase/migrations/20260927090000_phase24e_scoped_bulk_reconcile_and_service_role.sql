-- Two fixes to the reconciliation surface used by server.ts.
--
-- 1. reconcile_expired_sessions(uuid) is called through the SERVICE-ROLE client,
--    not the caller's session client. A service-role request carries no
--    end-user JWT, so auth.uid() is NULL and the participant check
--    (auth.uid() IN (seeker_id, mentor_id)) is never true: the function always
--    returned NULL and the per-booking reconcile silently did nothing. Allow
--    the service role explicitly rather than relying on auth.uid().
--
-- 2. New reconcile_expired_bookings(uuid[]) for the list endpoints. Those pages
--    hold up to N rows and must not pay N round trips, but a single PostgREST
--    .update() cannot write a per-row value and actual_ended_at must be each
--    booking's OWN end_time. This applies the same per-row expression as
--    complete_expired_sessions(), restricted to the ids on the page.

CREATE OR REPLACE FUNCTION public.reconcile_expired_sessions(p_booking_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_state text;
BEGIN
  IF p_booking_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- service_role is the server's own key: it has already authorised the request
  -- upstream and deliberately carries no end-user uid, so requiring
  -- auth.uid() here made the function a no-op on every real call. Anyone else
  -- must still be a participant on the row.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public.bookings b
       WHERE b.id = p_booking_id
         AND auth.uid() IN (b.seeker_id, b.mentor_id)
    ) THEN
      RETURN NULL;
    END IF;
  END IF;

  UPDATE public.bookings b
     SET status          = 'COMPLETED',
         -- The scheduled end, not the moment we noticed, so the recorded
         -- instant is identical no matter which path completed the row.
         actual_ended_at = b.end_time,
         updated_at      = now()
   WHERE b.id = p_booking_id
     AND b.status = 'CONFIRMED'
     AND b.end_time IS NOT NULL
     AND b.end_time <= now();

  SELECT public.resolve_session_state(b.status, b.start_time, b.end_time, b.actual_ended_at)
    INTO v_state
    FROM public.bookings b
   WHERE b.id = p_booking_id;

  RETURN v_state;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.reconcile_expired_bookings(p_booking_ids uuid[])
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_done uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_booking_ids IS NULL OR array_length(p_booking_ids, 1) IS NULL THEN
    RETURN v_done;
  END IF;

  -- service_role only. The caller supplies ids it has already authorised, and
  -- the companion single-row function keeps the participant check for anything
  -- that arrives with a real end-user session.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN v_done;
  END IF;

  -- A CTE, not ARRAY(UPDATE ...): a data-modifying statement is not allowed
  -- inside an ARRAY() constructor.
  WITH transitioned AS (
    UPDATE public.bookings b
       SET status          = 'COMPLETED',
           actual_ended_at = b.end_time,
           updated_at      = now()
     WHERE b.id = ANY(p_booking_ids)
       AND b.status = 'CONFIRMED'
       AND b.end_time IS NOT NULL
       AND b.end_time <= now()
    RETURNING b.id
  )
  SELECT COALESCE(array_agg(t.id), ARRAY[]::uuid[])
    INTO v_done
    FROM transitioned t;

  RETURN v_done;
END;
$fn$;

REVOKE ALL ON FUNCTION public.reconcile_expired_bookings(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_expired_bookings(uuid[]) TO service_role;

COMMENT ON FUNCTION public.reconcile_expired_bookings(uuid[]) IS
  'Service-role only. Bulk variant of reconcile_expired_sessions(uuid) for list endpoints: completes elapsed CONFIRMED rows among the given ids, setting actual_ended_at to each row''s own end_time. Returns the ids actually transitioned.';