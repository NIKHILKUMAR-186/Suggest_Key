-- =============================================================================
-- SUGGEST KEY - PHASE 43: EMAIL VERIFICATION RATE LIMIT LEDGER
-- =============================================================================
-- WHY THIS EXISTS
-- ---------------
-- /mentor/signup sends its verification email through Supabase Auth
-- (`supabase.auth.signUp` / `supabase.auth.resend`), and GoTrue answers with
-- `over_email_send_rate_limit` / "Email rate limit exceeded". That response
-- carries NO remaining-attempt count and NO retry-after, and GoTrue exposes no
-- endpoint to ask for them, so the UI could only ever print the bare message.
--
-- The two rate-limit mechanisms already in this repo cannot answer the
-- question either:
--
--   * `apiRateLimiter` / `expensiveRouteLimiter` (src/lib/rateLimit.ts) are
--     in-process express-rate-limit stores keyed per IP. Correct for one
--     instance, per-instance on serverless, and they say nothing about
--     verification emails specifically.
--   * `login_failure_trackers` (phase 19) is explicitly documented in its own
--     migration as "DETECTION TELEMETRY, not an authorisation gate".
--
-- So the verification budget was enforced somewhere we could not read it. This
-- migration adds the smallest thing that makes it readable: a per-recipient
-- ledger, held in the database, that the server consults before it lets a
-- verification email be attempted.
--
-- WHAT THIS IS *NOT*
-- ------------------
-- It does not replace, relax or raise the GoTrue limiter. GoTrue remains the
-- hard enforcement point for every actual send and still runs unchanged. This
-- ledger is an authoritative *pre-flight gate and read model* in front of it:
-- it stops our own UI from spending GoTrue's budget blindly, and it is what
-- lets the countdown be computed from a server timestamp rather than guessed in
-- the browser. GoTrue's own limiter is the backstop, and stays the backstop
-- even if every row here were deleted.
--
-- PRIVACY
-- -------
-- Identical to phase 19: no raw email address and no IP address is ever
-- stored. Callers pass an opaque `identifier_key`, an HMAC-SHA256 of the
-- normalised identity computed server-side with a secret salt. No password,
-- token or card data is involved.
--
-- IDEMPOTENT: safe to re-run.

-- =============================================================================
-- 1. CONFIG (single row, id = 1)
-- =============================================================================
-- Defaults are deliberately GENEROUS relative to a real SMTP/GoTrue send
-- budget. This ledger exists to give the user accurate feedback and to stop our
-- own UI from hammering GoTrue; it is not the anti-abuse boundary, so it must
-- never be the reason a legitimate mentor cannot finish signing up.
--
--   attempt_limit     5  verification emails per recipient per window
--   window_minutes   60  a rolling window an hour wide
--   cooldown_seconds 600  how long an upstream (GoTrue) block is honoured
CREATE TABLE IF NOT EXISTS public.email_verification_rate_limit_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  attempt_limit INTEGER NOT NULL DEFAULT 5 CHECK (attempt_limit BETWEEN 1 AND 100),
  window_minutes INTEGER NOT NULL DEFAULT 60 CHECK (window_minutes BETWEEN 1 AND 1440),
  cooldown_seconds INTEGER NOT NULL DEFAULT 600 CHECK (cooldown_seconds BETWEEN 30 AND 86400),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

INSERT INTO public.email_verification_rate_limit_config
  (id, attempt_limit, window_minutes, cooldown_seconds, updated_at)
VALUES (1, 5, 60, 600, NOW())
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.email_verification_rate_limit_config IS
  'Verification-email rate-limit tuning (single row, id = 1). Read only by the SECURITY DEFINER helpers below. Generous by design: the hard boundary is the Supabase Auth email rate limit, which this ledger gates and reports on, never loosens.';

-- =============================================================================
-- 2. LEDGER TABLE (one row per recipient/IP pair)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.email_verification_rate_limits (
  identifier_key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Set only when the upstream provider told us it refused the send. This is
  -- what turns "we think the budget is spent" into "the provider has already
  -- refused, wait until this instant".
  blocked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_rate_limits_updated
  ON public.email_verification_rate_limits(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_verification_rate_limits_blocked
  ON public.email_verification_rate_limits(blocked_until DESC)
  WHERE blocked_until IS NOT NULL;

COMMENT ON TABLE public.email_verification_rate_limits IS
  'Verification-email attempt ledger, keyed on an opaque HMAC of the recipient address and caller IP. Holds only counts and instants - never an address. No raw email or IP is stored, so this cannot identify a person on its own.';

-- =============================================================================
-- 3. ROW LEVEL SECURITY - ADMIN READ, ADMIN MANAGE CONFIG
-- =============================================================================
-- The application never talks to this table directly. The server reaches it
-- through the SECURITY DEFINER helpers below with the service-role client, and
-- an admin may inspect it from the admin console. Nothing here is reachable by
-- `anon` or by a signed-in mentor, so no client can read, extend or reset its
-- own budget.
ALTER TABLE public.email_verification_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_verification_rate_limit_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read email_verification_rate_limits"
  ON public.email_verification_rate_limits;
CREATE POLICY "Admins can read email_verification_rate_limits"
  ON public.email_verification_rate_limits FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can manage email_verification_rate_limit_config"
  ON public.email_verification_rate_limit_config;
CREATE POLICY "Admins can manage email_verification_rate_limit_config"
  ON public.email_verification_rate_limit_config FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ------------------------------------------------------------------------------
-- 3a. TABLE PRIVILEGES - NO CLIENT ACCESS AT ALL
-- ------------------------------------------------------------------------------
-- RLS alone is not enough here, and phase 35 spells out why: `permissions_
-- authenticated_anon` (and Supabase's own default privileges, closed for `anon`
-- by phase 19) leave `authenticated` holding table-level SELECT/INSERT/UPDATE/
-- DELETE on every table in `public`, including ones created after those runs.
-- A table that a client role can write but whose RLS policy is wrong would be a
-- self-service budget reset. Both roles are therefore revoked outright, matching
-- phase 39's treatment of `coupons`.
--
-- `service_role` keeps everything: the server is the only writer and the only
-- reader, and it bypasses RLS to do it. The admin policies above are retained
-- so the admin console and a future operator script can still inspect the
-- ledger through a service-role connection.
REVOKE ALL ON public.email_verification_rate_limits      FROM anon, authenticated;
REVOKE ALL ON public.email_verification_rate_limit_config FROM anon, authenticated;

GRANT ALL ON public.email_verification_rate_limits      TO service_role;
GRANT ALL ON public.email_verification_rate_limit_config TO service_role;

-- =============================================================================
-- 4. READ THE CURRENT STATE WITHOUT CONSUMING AN ATTEMPT
-- =============================================================================
-- This is what the signup page calls on load, on refresh and when a countdown
-- reaches zero. It is strictly read-only: a client can call it as often as it
-- likes without affecting its own budget, which is what makes the "rehydrate
-- from server state instead of resetting locally" behaviour possible without
-- turning the read path into an attack surface.
CREATE OR REPLACE FUNCTION public.read_email_verification_rate_limit(
  p_identifier_key TEXT
)
RETURNS TABLE(allowed BOOLEAN, remaining INTEGER, retry_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt_limit INTEGER;
  v_window_minutes INTEGER;
  v_cooldown_seconds INTEGER;
  v_row public.email_verification_rate_limits;
  v_effective_attempts INTEGER;
  v_allowed BOOLEAN;
  v_remaining INTEGER;
  v_retry_at TIMESTAMPTZ;
BEGIN
  IF p_identifier_key IS NULL OR length(p_identifier_key) < 8 THEN
    RAISE EXCEPTION 'invalid identifier key';
  END IF;

  SELECT c.attempt_limit, c.window_minutes, c.cooldown_seconds
  INTO v_attempt_limit, v_window_minutes, v_cooldown_seconds
  FROM public.email_verification_rate_limit_config c
  WHERE c.id = 1;

  -- COALESCE guards against a half-applied config row: a missing config must
  -- never widen the limit to "unlimited".
  v_attempt_limit := COALESCE(v_attempt_limit, 5);
  v_window_minutes := COALESCE(v_window_minutes, 60);
  v_cooldown_seconds := COALESCE(v_cooldown_seconds, 600);

  SELECT * INTO v_row
  FROM public.email_verification_rate_limits t
  WHERE t.identifier_key = p_identifier_key;

  -- An expired window resets the run of attempts to zero.
  IF v_row.identifier_key IS NULL
     OR v_row.window_started_at < NOW() - (v_window_minutes || ' minutes')::INTERVAL THEN
    v_effective_attempts := 0;
  ELSE
    v_effective_attempts := v_row.attempts;
  END IF;

  v_allowed := v_effective_attempts < v_attempt_limit;
  v_remaining := GREATEST(v_attempt_limit - v_effective_attempts, 0);

  -- The provider's own block outranks our arithmetic: if GoTrue has already
  -- refused a send, the caller must wait for that instant even though the local
  -- budget would have allowed another attempt.
  IF v_row.blocked_until IS NOT NULL AND v_row.blocked_until > NOW() THEN
    v_allowed := FALSE;
    v_remaining := 0;
    v_retry_at := v_row.blocked_until;
  ELSIF NOT v_allowed THEN
    -- Our own budget is spent. The window is what has to elapse.
    v_retry_at := COALESCE(v_row.window_started_at, NOW())
                  + (v_window_minutes || ' minutes')::INTERVAL;
  END IF;

  allowed := v_allowed;
  remaining := v_remaining;
  retry_at := v_retry_at;
  RETURN NEXT;
END;
$$;

-- =============================================================================
-- 5. CONSUME ONE ATTEMPT
-- =============================================================================
-- The enforcement point. Called before the client is allowed to ask Supabase
-- Auth for a verification email. When it answers `allowed = false` the caller
-- MUST NOT attempt the send, and `retry_at` is the server-authoritative
-- instant the caller may ask again.
--
-- The whole read-modify-write runs under `FOR UPDATE` so two concurrent tabs
-- cannot both observe the last remaining attempt and both spend it.
CREATE OR REPLACE FUNCTION public.consume_email_verification_attempt(
  p_identifier_key TEXT
)
RETURNS TABLE(allowed BOOLEAN, remaining INTEGER, retry_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt_limit INTEGER;
  v_window_minutes INTEGER;
  v_row public.email_verification_rate_limits;
  v_effective_attempts INTEGER;
  v_allowed BOOLEAN;
  v_remaining INTEGER;
  v_retry_at TIMESTAMPTZ;
BEGIN
  IF p_identifier_key IS NULL OR length(p_identifier_key) < 8 THEN
    RAISE EXCEPTION 'invalid identifier key';
  END IF;

  SELECT c.attempt_limit, c.window_minutes
  INTO v_attempt_limit, v_window_minutes
  FROM public.email_verification_rate_limit_config c
  WHERE c.id = 1;

  v_attempt_limit := COALESCE(v_attempt_limit, 5);
  v_window_minutes := COALESCE(v_window_minutes, 60);

  SELECT * INTO v_row
  FROM public.email_verification_rate_limits t
  WHERE t.identifier_key = p_identifier_key
  FOR UPDATE;

  IF v_row.identifier_key IS NULL
     OR v_row.window_started_at < NOW() - (v_window_minutes || ' minutes')::INTERVAL THEN
    v_effective_attempts := 0;
  ELSE
    v_effective_attempts := v_row.attempts;
  END IF;

  v_allowed := v_effective_attempts < v_attempt_limit;
  v_remaining := GREATEST(v_attempt_limit - v_effective_attempts, 0);

  IF v_row.blocked_until IS NOT NULL AND v_row.blocked_until > NOW() THEN
    -- An upstream refusal is not ours to spend past. The attempt is refused
    -- AND the counter is left alone, so the block cannot be used to burn budget
    -- or to extend itself.
    v_allowed := FALSE;
    v_remaining := 0;
    v_retry_at := v_row.blocked_until;
  ELSIF NOT v_allowed THEN
    v_retry_at := COALESCE(v_row.window_started_at, NOW())
                  + (v_window_minutes || ' minutes')::INTERVAL;
  ELSE
    v_effective_attempts := v_effective_attempts + 1;
    v_remaining := GREATEST(v_attempt_limit - v_effective_attempts, 0);

    INSERT INTO public.email_verification_rate_limits (
      identifier_key, attempts, window_started_at, created_at, updated_at
    ) VALUES (
      p_identifier_key, v_effective_attempts, NOW(), NOW(), NOW()
    )
    ON CONFLICT (identifier_key) DO UPDATE SET
      attempts = EXCLUDED.attempts,
      window_started_at = EXCLUDED.window_started_at,
      updated_at = EXCLUDED.updated_at;
  END IF;

  allowed := v_allowed;
  remaining := v_remaining;
  retry_at := v_retry_at;
  RETURN NEXT;
END;
$$;

-- =============================================================================
-- 6. RECORD AN UPSTREAM REFUSAL
-- =============================================================================
-- Supabase Auth answered `over_email_send_rate_limit`. GoTrue sends no
-- retry-after, so the cooldown length comes from `cooldown_seconds` in the
-- config table - a value the operator owns and this repository never hardcodes
-- in the browser. `blocked_until` is absolute and stored, so calling this
-- repeatedly cannot push the block further out.
CREATE OR REPLACE FUNCTION public.mark_email_verification_upstream_blocked(
  p_identifier_key TEXT
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cooldown_seconds INTEGER;
  v_retry_at TIMESTAMPTZ;
BEGIN
  IF p_identifier_key IS NULL OR length(p_identifier_key) < 8 THEN
    RAISE EXCEPTION 'invalid identifier key';
  END IF;

  SELECT c.cooldown_seconds INTO v_cooldown_seconds
  FROM public.email_verification_rate_limit_config c
  WHERE c.id = 1;

  v_cooldown_seconds := COALESCE(v_cooldown_seconds, 600);
  v_retry_at := NOW() + (v_cooldown_seconds || ' seconds')::INTERVAL;

  INSERT INTO public.email_verification_rate_limits (
    identifier_key, attempts, window_started_at, blocked_until, created_at, updated_at
  ) VALUES (
    p_identifier_key, 0, NOW(), v_retry_at, NOW(), NOW()
  )
  ON CONFLICT (identifier_key) DO UPDATE SET
    blocked_until = GREATEST(
      COALESCE(public.email_verification_rate_limits.blocked_until, v_retry_at),
      v_retry_at
    ),
    updated_at = NOW();

  RETURN v_retry_at;
END;
$$;

-- =============================================================================
-- 7. PRUNE IDLED ROWS
-- =============================================================================
CREATE OR REPLACE FUNCTION public.prune_email_verification_rate_limits(
  p_older_than_minutes INTEGER DEFAULT 1440
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  WITH removed AS (
    DELETE FROM public.email_verification_rate_limits
    WHERE updated_at < NOW() - (GREATEST(1, COALESCE(p_older_than_minutes, 1440)) || ' minutes')::INTERVAL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_deleted FROM removed;
  RETURN v_deleted;
END;
$$;

-- =============================================================================
-- 8. EXECUTE CONTAINMENT (CRITICAL-01)
-- =============================================================================
-- Phase 29 revoked EXECUTE from PUBLIC, anon and authenticated on every
-- SECURITY DEFINER function that existed at the time. Postgres re-grants
-- EXECUTE to PUBLIC on every NEW function, so the revoke has to be re-applied
-- here. Without it, `anon` - the role behind the browser's publishable key -
-- could call these helpers directly and read or reset anybody's budget by
-- brute-forcing identifier keys.
REVOKE EXECUTE ON FUNCTION public.read_email_verification_rate_limit(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_email_verification_attempt(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_email_verification_upstream_blocked(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prune_email_verification_rate_limits(INTEGER) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.read_email_verification_rate_limit(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.consume_email_verification_attempt(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.mark_email_verification_upstream_blocked(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.prune_email_verification_rate_limits(INTEGER) FROM anon;

REVOKE EXECUTE ON FUNCTION public.read_email_verification_rate_limit(TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_email_verification_attempt(TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_email_verification_upstream_blocked(TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.prune_email_verification_rate_limits(INTEGER) FROM authenticated;

-- The server is the trusted backend and reaches these with the service key.
GRANT EXECUTE ON FUNCTION public.read_email_verification_rate_limit(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_email_verification_attempt(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_email_verification_upstream_blocked(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.prune_email_verification_rate_limits(INTEGER) TO service_role;

-- =============================================================================
-- 9. POST-CONDITIONS
-- =============================================================================
-- These must hold after this migration runs; if any row reports true,
-- containment has regressed and this migration must be re-applied before
-- traffic continues.
DO $$
DECLARE
  leaked text;
BEGIN
  SELECT string_agg(p.proname, ', ')
    INTO leaked
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN (
       'read_email_verification_rate_limit',
       'consume_email_verification_attempt',
       'mark_email_verification_upstream_blocked',
       'prune_email_verification_rate_limits'
     )
     AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'CRITICAL-01 containment incomplete: anon can still EXECUTE: %', leaked;
  END IF;

  RAISE NOTICE
    'CRITICAL-01 contained: no email verification rate-limit function in public is executable by anon.';
END $$;

-- The ledger must never be reachable by a client role, with or without RLS.
DO $$
DECLARE
  client_writable text;
BEGIN
  IF has_table_privilege('anon', 'public.email_verification_rate_limits', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.email_verification_rate_limits', 'SELECT,INSERT,UPDATE,DELETE') THEN
    client_writable := 'email_verification_rate_limits';
  END IF;

  IF has_table_privilege('anon', 'public.email_verification_rate_limit_config', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.email_verification_rate_limit_config', 'SELECT,INSERT,UPDATE,DELETE') THEN
    client_writable := COALESCE(client_writable || ', ', '') || 'email_verification_rate_limit_config';
  END IF;

  IF client_writable IS NOT NULL THEN
    RAISE EXCEPTION
      'email verification rate-limit state is reachable by a client role: %', client_writable;
  END IF;
END $$;