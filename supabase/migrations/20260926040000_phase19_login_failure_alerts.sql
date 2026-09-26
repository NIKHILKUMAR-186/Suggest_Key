-- ==============================================================================
-- SUGGEST KEY - PHASE 19: LOGIN FAILURE ALERTING (5 CONSECUTIVE FAILURES)
-- ==============================================================================
-- Detects credential-stuffing / brute-force login attempts and raises a single
-- alert into the existing `system_logs` table, so the alert shows up in the
-- Admin "System Health" console with no new UI.
--
-- PRIVACY: no raw email address or IP address is ever stored. Callers pass an
-- opaque `identifier_key`, which is an HMAC-SHA256 of the normalised identity
-- computed server-side with a secret salt. The database alone cannot reverse
-- it back to a person, and no password, token or card data is involved.
--
-- SCOPE: this is DETECTION TELEMETRY, not an authorisation gate. Supabase
-- password sign-in happens in the browser, so the server cannot see a failed
-- password attempt directly; the client reports it. A hostile client can simply
-- not report. Enforcement of a lockout must live where credential verification
-- happens (Supabase Auth / an edge function), not here.

-- ==============================================================================
-- 1. CONFIG
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.login_failure_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  failure_threshold INTEGER NOT NULL DEFAULT 5 CHECK (failure_threshold BETWEEN 2 AND 100),
  window_minutes INTEGER NOT NULL DEFAULT 15 CHECK (window_minutes BETWEEN 1 AND 1440),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

INSERT INTO public.login_failure_config (id, failure_threshold, window_minutes, updated_at)
VALUES (1, 5, 15, NOW())
ON CONFLICT (id) DO NOTHING;

-- ==============================================================================
-- 2. TRACKER TABLE (one row per identity, holds only the current streak)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.login_failure_trackers (
  identifier_key TEXT PRIMARY KEY,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  first_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_failure_reason TEXT,
  alerted_at TIMESTAMPTZ,
  alert_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_failure_trackers_last_failed
  ON public.login_failure_trackers(last_failed_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_failure_trackers_alerted
  ON public.login_failure_trackers(alerted_at DESC)
  WHERE alerted_at IS NOT NULL;

-- ==============================================================================
-- 3. ROW LEVEL SECURITY — ADMIN READ ONLY
-- Service-role writes go through the SECURITY DEFINER helpers below.
-- ==============================================================================
ALTER TABLE public.login_failure_trackers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_failure_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read login_failure_trackers" ON public.login_failure_trackers;
CREATE POLICY "Admins can read login_failure_trackers"
  ON public.login_failure_trackers FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can manage login_failure_config" ON public.login_failure_config;
CREATE POLICY "Admins can manage login_failure_config"
  ON public.login_failure_config FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ==============================================================================
-- 4. RECORD A FAILURE  (returns the streak length and whether to alert)
-- ==============================================================================
-- Consecutive means consecutive: a success resets the streak, and a failure
-- that lands outside the configured window starts a new streak at 1.
CREATE OR REPLACE FUNCTION public.record_login_failure(
  p_identifier_key TEXT,
  p_failure_reason TEXT DEFAULT NULL
)
RETURNS TABLE(consecutive_failures INTEGER, should_alert BOOLEAN, alert_raised BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
-- `consecutive_failures` is both an OUT parameter and a column of
-- login_failure_trackers. Without this, plpgsql's default variable_conflict
-- of `error` makes every bare `consecutive_failures` reference ambiguous and
-- the function fails on its first call with ERROR 42702. `use_column` resolves
-- those to the column; the trailing `consecutive_failures := v_streak` is a
-- plpgsql assignment, not a SQL reference, so it still targets the OUT param.
#variable_conflict use_column
DECLARE
  v_threshold INTEGER;
  v_window_minutes INTEGER;
  v_streak INTEGER;
  v_alert_raised BOOLEAN := FALSE;
  v_previous_alert TIMESTAMPTZ;
  v_last_failed_at TIMESTAMPTZ;
  v_tracker public.login_failure_trackers;
BEGIN
  IF p_identifier_key IS NULL OR length(p_identifier_key) < 8 THEN
    RAISE EXCEPTION 'invalid identifier key';
  END IF;

  SELECT c.failure_threshold, c.window_minutes
  INTO v_threshold, v_window_minutes
  FROM public.login_failure_config c WHERE c.id = 1;

  v_threshold := COALESCE(v_threshold, 5);
  v_window_minutes := COALESCE(v_window_minutes, 15);

  SELECT t.consecutive_failures, t.last_failed_at, t.alerted_at
  INTO v_streak, v_last_failed_at, v_previous_alert
  FROM public.login_failure_trackers t
  WHERE t.identifier_key = p_identifier_key
  FOR UPDATE;

  -- No existing streak, or the previous failure fell outside the window:
  -- this is a brand new run of attempts, so the streak restarts at 1.
  IF v_streak IS NULL
     OR v_last_failed_at < NOW() - (v_window_minutes || ' minutes')::INTERVAL THEN
    v_streak := 1;
  ELSE
    v_streak := v_streak + 1;
  END IF;

  INSERT INTO public.login_failure_trackers (
    identifier_key, consecutive_failures, first_failed_at, last_failed_at,
    last_failure_reason
  ) VALUES (
    p_identifier_key, v_streak, NOW(), NOW(),
    left(COALESCE(p_failure_reason, 'UNKNOWN'), 120)
  )
  ON CONFLICT (identifier_key) DO UPDATE SET
    consecutive_failures = EXCLUDED.consecutive_failures,
    first_failed_at = CASE
      WHEN EXCLUDED.consecutive_failures = 1 THEN EXCLUDED.first_failed_at
      ELSE public.login_failure_trackers.first_failed_at
    END,
    last_failed_at = EXCLUDED.last_failed_at,
    last_failure_reason = EXCLUDED.last_failure_reason
  RETURNING * INTO v_tracker;

  -- Alert once per streak, not on every subsequent failure: re-arm only after
  -- the streak has been cleared (alerted_at is reset by reset_login_failures).
  IF v_streak >= v_threshold AND v_previous_alert IS NULL THEN
    v_alert_raised := TRUE;

    UPDATE public.login_failure_trackers
    SET alerted_at = NOW(), alert_count = alert_count + 1
    WHERE identifier_key = p_identifier_key;

    PERFORM public.insert_system_log(
      p_request_id := 'sec_login',
      p_level := 'error',
      p_category := 'auth',
      p_method := 'POST',
      p_path := '/api/auth/login-failure',
      p_status_code := 401,
      p_error_code := 'LOGIN_BRUTE_FORCE_SUSPECTED',
      p_message := 'LOGIN_BRUTE_FORCE_SUSPECTED',
      p_metadata := jsonb_build_object(
        'consecutive_failures', v_streak,
        'threshold', v_threshold,
        'window_minutes', v_window_minutes,
        'identifier_key_prefix', left(p_identifier_key, 12),
        'last_failure_reason', left(COALESCE(p_failure_reason, 'UNKNOWN'), 120),
        'first_failed_at', v_tracker.first_failed_at
      )
    );
  END IF;

  consecutive_failures := v_streak;
  should_alert := v_streak >= v_threshold;
  alert_raised := v_alert_raised;
  RETURN NEXT;
END;
$$;

-- ==============================================================================
-- 5. RESET ON SUCCESS (a correct password breaks the streak)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.reset_login_failures(p_identifier_key TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_previous_streak INTEGER;
BEGIN
  SELECT consecutive_failures INTO v_previous_streak
  FROM public.login_failure_trackers
  WHERE identifier_key = p_identifier_key;

  IF v_previous_streak IS NULL THEN
    RETURN 0;
  END IF;

  DELETE FROM public.login_failure_trackers WHERE identifier_key = p_identifier_key;
  RETURN v_previous_streak;
END;
$$;

-- ==============================================================================
-- 6. CURRENT THREAT VIEW (for the admin console / on-call)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.list_active_login_threats(p_limit INTEGER DEFAULT 50)
RETURNS TABLE(
  identifier_key TEXT,
  consecutive_failures INTEGER,
  first_failed_at TIMESTAMPTZ,
  last_failed_at TIMESTAMPTZ,
  last_failure_reason TEXT,
  alerted_at TIMESTAMPTZ,
  alert_count INTEGER
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.identifier_key, t.consecutive_failures, t.first_failed_at, t.last_failed_at,
         t.last_failure_reason, t.alerted_at, t.alert_count
  FROM public.login_failure_trackers t
  WHERE t.consecutive_failures > 0
  ORDER BY t.consecutive_failures DESC, t.last_failed_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 500));
$$;

-- ==============================================================================
-- 7. PRUNE IDLE STREAKS
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.prune_login_failure_trackers(p_older_than_minutes INTEGER DEFAULT 1440)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  WITH removed AS (
    DELETE FROM public.login_failure_trackers
    WHERE last_failed_at < NOW() - (GREATEST(1, COALESCE(p_older_than_minutes, 1440)) || ' minutes')::INTERVAL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_deleted FROM removed;
  RETURN v_deleted;
END;
$$;
