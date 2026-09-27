-- =============================================================================
-- SUGGEST KEY - PHASE 24: SERVER-AUTHORITATIVE SESSION TIME STATE
-- =============================================================================
-- Problem this migration fixes
-- -------------------------
-- `bookings.status` was allowed to sit at 'CONFIRMED' forever after `end_time`
-- had passed, because nothing ever reconciled it:
--
--   * public.complete_expired_sessions() existed but was bound to a
--     `public.sessions` table that does not exist in this schema, so it would
--     raise at runtime, and nothing called it anyway.
--   * public.can_join_session() had the same phantom-table bug.
--   * The only transition to COMPLETED lived in the Node process
--     (`persistNaturalSessionCompletion` in server.ts) and ran only when a user
--     happened to hit GET /api/sessions/:id/access or POST /api/sessions/:id/join.
--
-- Consequence, reproduced in live data: booking BK-2609262151-7763 still had
-- status='CONFIRMED' with a live meeting_url more than ten hours after its
-- end_time, and every list view that groups on raw status filed it under
-- "Upcoming" permanently.
--
-- This migration moves the authority into the database:
--   1. resolve_session_state()    - the ONE server-side state resolver
--   2. complete_expired_sessions() - idempotent reconciliation, now on `bookings`
--   3. reconcile_expired_sessions() - per-booking read-path reconciliation
--   4. get_session_access()       - fixed (it wrote an 'IN_PROGRESS' status that
--                                   violates bookings_status_check)
--   5. can_join_session()         - repointed from the phantom `sessions` table
--   6. session_completed notification, emitted at most once ever
--   7. pg_cron job so a past session completes even if nobody opens the page
--   8. RLS/grant tightening so the browser cannot write session state at all
--
-- All timestamps stay timestamptz (UTC). No stored timestamp is rewritten to a
-- local zone anywhere in this file.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Supporting indexes
-- -----------------------------------------------------------------------------
-- The reconciliation predicate is always `status = 'CONFIRMED' AND end_time <=
-- now()`. Without a partial index on exactly that predicate Postgres seq-scans
-- `bookings` on every cron tick and on every session read. This keeps the
-- per-minute job O(expired rows) rather than O(table).
CREATE INDEX IF NOT EXISTS idx_bookings_open_end_time
  ON public.bookings (end_time)
  WHERE status = 'CONFIRMED';

-- Supports the Upcoming/History split used by every list endpoint, which is the
-- same predicate evaluated against a caller-supplied clock.
CREATE INDEX IF NOT EXISTS idx_bookings_status_end_time
  ON public.bookings (status, end_time);


-- -----------------------------------------------------------------------------
-- 1. The one centralized session-state resolver
-- -----------------------------------------------------------------------------
-- Every page, endpoint and job resolves state through this function so the T-5
-- rule exists exactly once in the codebase.
--
-- Returns the five states the product spec defines:
--   SCHEDULED     now < start - 5min          -> access DENIED
--   ACCESS_OPEN   start - 5min <= now < start -> access ALLOWED (early arrival)
--   IN_PROGRESS   start <= now < end          -> access ALLOWED
--   COMPLETED     now >= end                  -> access DENIED
--   CANCELLED     status is CANCELLED/REJECTED
--
-- STABLE, not IMMUTABLE: the default clock is now(), and marking a function that
-- reads the current time as immutable would let the planner fold it and cache a
-- stale answer. Callers may pass an explicit instant to exercise the test
-- matrix; every production call path uses the database clock, so the browser can
-- never influence a business decision through it.
CREATE OR REPLACE FUNCTION public.resolve_session_state(
  p_status          text,
  p_start_time      timestamptz,
  p_end_time        timestamptz,
  p_actual_ended_at timestamptz DEFAULT NULL,
  p_now             timestamptz DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_now   timestamptz := COALESCE(p_now, now());
  v_t5    timestamptz;
BEGIN
  -- Terminal non-attendable states win over every clock rule. A cancelled
  -- session must not read as "in progress" just because the clock says so.
  IF p_status IN ('CANCELLED', 'REJECTED') THEN
    RETURN 'CANCELLED';
  END IF;

  -- Fail closed on unusable timestamps. An unreadable window is never treated as
  -- "probably still open".
  IF p_start_time IS NULL OR p_end_time IS NULL
     OR NOT isfinite(p_start_time) OR NOT isfinite(p_end_time) THEN
    RETURN 'COMPLETED';
  END IF;

  -- A manual end is terminal regardless of the clock: a participant ended the
  -- room, so access is revoked immediately even if end_time is still ahead.
  IF p_actual_ended_at IS NOT NULL AND isfinite(p_actual_ended_at) THEN
    RETURN 'COMPLETED';
  END IF;

  IF p_status = 'COMPLETED' THEN
    RETURN 'COMPLETED';
  END IF;

  v_t5 := p_start_time - interval '5 minutes';

  -- After end_time. This branch is what makes a stale CONFIRMED row read as
  -- COMPLETED: the stored status is advisory, the clock is authoritative.
  IF v_now >= p_end_time THEN
    RETURN 'COMPLETED';
  END IF;

  -- From T-5 onwards access is open; the session is live only past its start.
  IF v_now >= v_t5 THEN
    IF v_now >= p_start_time THEN
      RETURN 'IN_PROGRESS';
    END IF;
    RETURN 'ACCESS_OPEN';
  END IF;

  RETURN 'SCHEDULED';
END;
$$;

COMMENT ON FUNCTION public.resolve_session_state(text, timestamptz, timestamptz, timestamptz, timestamptz) IS
  'Single source of truth for session lifecycle. Derives SCHEDULED / ACCESS_OPEN / IN_PROGRESS / COMPLETED / CANCELLED from server time plus the booking window. Never called with a client-supplied clock in production.';

GRANT EXECUTE ON FUNCTION public.resolve_session_state(text, timestamptz, timestamptz, timestamptz, timestamptz) TO authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 2. Notification idempotency
-- -----------------------------------------------------------------------------
-- The reconciliation job and the manual End Session endpoint can fire in the
-- same instant. A plain INSERT would then produce two "session completed"
-- notifications, so the insert is protected by a unique index rather than by a
-- check-then-insert race.
--
-- Partial and NOT NULL on entity_id, so only genuine completion events take
-- part, ordinary notifications are unaffected, and the index stays tiny.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_notifications_session_completed
  ON public.notifications (user_id, event_type, entity_id)
  WHERE event_type = 'SESSION_COMPLETED'
    AND entity_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 3. Idempotent automatic completion
-- -----------------------------------------------------------------------------
-- Replaces the previous definition, which referenced the non-existent
-- public.sessions table and would have raised `relation "sessions" does not
-- exist` on every call.
--
-- Idempotency has three independent layers:
--   a. the UPDATE is scoped to `status = 'CONFIRMED'`, so a second concurrent
--      run matches zero rows and notifies for nobody;
--   b. `actual_ended_at` is set to the booking's own `end_time`, not now(), so
--      the recorded end instant is a function of the data rather than of when
--      the job happened to run - re-running can never change it;
--   c. the notification insert is ON CONFLICT DO NOTHING against the unique
--      index above.
--
-- Only rows transitioned by THIS invocation are notified. The previous draft
-- re-selected every already-COMPLETED booking, which would have backfilled
-- notifications for the entire historical backlog on first run.
CREATE OR REPLACE FUNCTION public.complete_expired_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids      uuid[] := ARRAY[]::uuid[];
  v_rows     record;
  v_completed integer := 0;
  v_notified  integer := 0;
BEGIN
  -- Reconcile every open booking whose window has closed. ended_by_role and
  -- end_reason stay NULL: a natural expiry is not a manual end, and the
  -- ended_by_role check constraint permits NULL.
  FOR v_rows IN
    UPDATE public.bookings b
       SET status          = 'COMPLETED',
           actual_ended_at = b.end_time,
           updated_at      = now()
     WHERE b.status = 'CONFIRMED'
       AND b.end_time IS NOT NULL
       AND b.end_time <= now()
    RETURNING b.id
  LOOP
    v_ids := array_append(v_ids, v_rows.id);
  END LOOP;

  v_completed := COALESCE(array_length(v_ids, 1), 0);

  IF v_completed = 0 THEN
    RETURN 0;
  END IF;

  -- Emit the completion notification for both participants, exactly once per
  -- participant per booking, ever. entity_type/entity_id mirror the existing
  -- convention in this schema (there is no related_entity_* column).
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
   WHERE b.id = ANY(v_ids)
     AND r.user_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_notified = ROW_COUNT;

  RAISE NOTICE 'complete_expired_sessions: completed % expired booking(s), % new notification(s)',
    v_completed, v_notified;

  RETURN v_completed;
END;
$$;

COMMENT ON FUNCTION public.complete_expired_sessions() IS
  'Reconciles CONFIRMED bookings whose end_time has passed to COMPLETED. Idempotent; safe to run every minute from pg_cron and from any read path.';

REVOKE EXECUTE ON FUNCTION public.complete_expired_sessions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_expired_sessions() TO service_role;


-- -----------------------------------------------------------------------------
-- 4. Read-path reconciliation
-- -----------------------------------------------------------------------------
-- Belt-and-braces for the requirement that a past session must never look
-- joinable because nobody was online at end_time. pg_cron guarantees the row is
-- corrected within a minute; this guarantees it is corrected *before the first
-- request that touches the booking*, so a stale row can never even be served.
--
-- Scoped to one authorized booking, so it cannot become the "expensive global job
-- that scans the whole table per request" the spec forbids.
CREATE OR REPLACE FUNCTION public.reconcile_expired_sessions(p_booking_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  IF NOT FOUND THEN
    RETURN 'CANCELLED';
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
      -- Same ON CONFLICT DO NOTHING guard as the cron path. If a manual End
      -- Session already transitioned the row, this UPDATE matches nothing and
      -- no notification is produced here - that endpoint owns its own.
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
$$;

COMMENT ON FUNCTION public.reconcile_expired_sessions(uuid) IS
  'Reconciles one authorized booking to COMPLETED if its window has closed, then returns the resolved session state. Called on every session and booking read path.';

GRANT EXECUTE ON FUNCTION public.reconcile_expired_sessions(uuid) TO authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 5. Fix get_session_access()
-- -----------------------------------------------------------------------------
-- Two defects in the previous version:
--   * it wrote `status = 'IN_PROGRESS'`, which violates bookings_status_check
--     (allowed: PAYMENT_PENDING, PENDING_VERIFICATION, MENTOR_PENDING,
--     CONFIRMED, COMPLETED, CANCELLED, REJECTED). During an actually-live
--     session the function therefore raised a check-constraint violation instead
--     of returning the meeting URL.
--   * on `now >= end_time` it returned SESSION_ENDED but left the row at
--     CONFIRMED forever - the stale-state bug this phase exists to fix.
--
-- IN_PROGRESS is a *resolved* state, not a stored one: the window defines it,
-- so it must never be written to the column.
CREATE OR REPLACE FUNCTION public.get_session_access(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings;
  v_state   text;
  v_now     timestamptz := now();
  v_t5      timestamptz;
  v_sec_t5  integer;
  v_sec_start integer;
  v_sec_end  integer;
BEGIN
  SELECT * INTO v_booking FROM public.bookings
   WHERE id = p_booking_id
     AND (seeker_id = auth.uid() OR mentor_id = auth.uid() OR public.is_admin());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found (code: BOOKING_NOT_FOUND)';
  END IF;

  -- Reconcile first, so an expired booking is already COMPLETED by the time we
  -- answer rather than after.
  v_state := public.reconcile_expired_sessions(p_booking_id);
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;

  v_t5 := v_booking.start_time - interval '5 minutes';
  v_sec_t5   := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_t5           - v_now)))::int);
  v_sec_start:= GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_booking.start_time - v_now)))::int);
  v_sec_end  := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_booking.end_time   - v_now)))::int);

  -- Deny before disclosing anything. meeting_url is deliberately absent from
  -- the object in every denying branch: this is the security boundary, not a
  -- UI concern.
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
      'seconds_until_t5',    v_sec_t5,
      'seconds_until_start', v_sec_start,
      'seconds_until_end',   v_sec_end
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
      'seconds_until_t5',    v_sec_t5,
      'seconds_until_start', v_sec_start,
      'seconds_until_end',   v_sec_end
    );
  END IF;

  -- ACCESS_OPEN / IN_PROGRESS. The only branch that may carry a meeting URL.
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
$$;

COMMENT ON FUNCTION public.get_session_access(uuid) IS
  'Authoritative session access. Reconciles expiry first, then releases meeting_url only inside [start-5m, end). The URL is absent from every denying response.';


-- -----------------------------------------------------------------------------
-- 6. Fix can_join_session()
-- -----------------------------------------------------------------------------
-- Repointed from the phantom public.sessions table (student_id / scheduled_time /
-- duration_mins / lowercase 'confirmed') to the real bookings table. Kept because
-- existing grants let anon and authenticated call it; leaving a callable function
-- that raises on every invocation is a liability, and a working one is what the
-- spec asks for.
--
-- Signature and return shape are unchanged, so no caller breaks.
CREATE OR REPLACE FUNCTION public.can_join_session(p_booking_id uuid, p_user_id uuid)
RETURNS TABLE(can_join boolean, meeting_link text, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Reconcile this specific booking before deciding, so a stale CONFIRMED row
  -- can never authorize a join.
  v_state := public.reconcile_expired_sessions(p_booking_id);
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;

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
$$;

COMMENT ON FUNCTION public.can_join_session(uuid, uuid) IS
  'Legacy-compatible join gate, repointed at the real bookings table. Releases the meeting link only inside [start-5m, end).';


-- -----------------------------------------------------------------------------
-- 7. Shared Upcoming / History predicate
-- -----------------------------------------------------------------------------
-- One function so seeker bookings, mentor bookings, mentor home and workspace all
-- bucket a booking the same way, computed from the same clock as the join gate.
-- STABLE because it reads now().
CREATE OR REPLACE FUNCTION public.booking_is_upcoming(p_end_time timestamptz, p_status text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT p_status NOT IN ('COMPLETED', 'CANCELLED', 'REJECTED')
     AND p_end_time IS NOT NULL
     AND p_end_time > now();
$$;

COMMENT ON FUNCTION public.booking_is_upcoming(timestamptz, text) IS
  'True while a booking is still in the future, so lists can split Upcoming vs History from server time rather than the stored status.';

GRANT EXECUTE ON FUNCTION public.booking_is_upcoming(timestamptz, text) TO authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 8. Remove the browser's ability to write session state
-- -----------------------------------------------------------------------------
-- `authenticated` previously held UPDATE on every bookings column, so a client
-- could set its own row to COMPLETED, rewrite meeting_url, or forge
-- actual_ended_at to simulate a manual end. Nothing in the browser writes these
-- columns - the only browser-side access to bookings is SELECT - and every
-- legitimate write already goes through server.ts with the service-role key,
-- which bypasses per-column grants entirely. The SECURITY DEFINER RPCs
-- (set_meeting_link, mentor_confirm_booking, ...) are likewise unaffected.
--
-- Revoking just the session-state columns keeps the existing RLS policies and
-- the legitimate service-role write paths intact.
REVOKE UPDATE (status, actual_ended_at, ended_by_role, end_reason, meeting_url, start_time, end_time)
  ON public.bookings FROM authenticated, anon;


-- -----------------------------------------------------------------------------
-- 9. Cron
-- -----------------------------------------------------------------------------
-- The guarantee the spec asks for: a past session completes even if the mentor
-- never opens the page and the seeker returns hours later. Runs every minute and
-- touches only rows that are already expired, thanks to the partial index.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'complete-expired-sessions-every-minute') THEN
    PERFORM cron.schedule(
      'complete-expired-sessions-every-minute',
      '* * * * *',
      'SELECT public.complete_expired_sessions();'
    );
  END IF;
END;
$$;


-- =============================================================================
-- VERIFICATION
-- =============================================================================
-- SELECT jobname, schedule, active FROM cron.job
--   WHERE jobname = 'complete-expired-sessions-every-minute';
-- SELECT status, count(*) FROM public.bookings GROUP BY 1 ORDER BY 1;
--
-- -- the 60-minute matrix, start 10:00Z / end 11:00Z
-- SELECT t, public.resolve_session_state('CONFIRMED',
--          '2026-10-01T10:00:00Z'::timestamptz,
--          '2026-10-01T11:00:00Z'::timestamptz, NULL, t) FROM (VALUES
--   ('09:54'::text,'2026-10-01T09:54:00Z'::timestamptz),
--   ('09:55','2026-10-01T09:55:00Z'),
--   ('10:00','2026-10-01T10:00:00Z'),
--   ('10:30','2026-10-01T10:30:00Z'),
--   ('10:59','2026-10-01T10:59:00Z'),
--   ('11:00','2026-10-01T11:00:00Z'),
--   ('11:01','2026-10-01T11:01:00Z'),
--   ('15:00','2026-10-01T15:00:00Z')) v(t, ts);
-- =============================================================================
