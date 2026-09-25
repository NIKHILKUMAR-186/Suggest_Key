-- ==============================================================================
-- SUGGEST KEY - PHASE 13: SYSTEM HEALTH & TECHNICAL LOGS
-- ==============================================================================
-- Centralized request/error/auth/audit logging for the Admin "System Health"
-- console. All tables are admin-only via RLS and SECURITY DEFINER helpers.
-- No secrets (tokens, cookies, passwords, payment data) are ever persisted.

-- ==============================================================================
-- 1. SYSTEM LOGS TABLE
-- One row per important API request / server event.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.system_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
  category TEXT NOT NULL CHECK (category IN (
    'api_request',
    'api_error',
    'auth',
    'db',
    'business',
    'system'
  )),
  method TEXT,
  path TEXT,
  status_code INTEGER,
  duration_ms INTEGER,
  user_id UUID,
  role TEXT,
  error_code TEXT,
  message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Recommended indexes
CREATE INDEX IF NOT EXISTS idx_system_logs_created_at ON public.system_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_logs_request_id ON public.system_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_system_logs_status_code ON public.system_logs(status_code);
CREATE INDEX IF NOT EXISTS idx_system_logs_user_id ON public.system_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_system_logs_category ON public.system_logs(category);
CREATE INDEX IF NOT EXISTS idx_system_logs_level ON public.system_logs(level);
CREATE INDEX IF NOT EXISTS idx_system_logs_path ON public.system_logs(path);
CREATE INDEX IF NOT EXISTS idx_system_logs_created_category ON public.system_logs(created_at DESC, category);

-- ==============================================================================
-- 2. AUDIT LOGS TABLE
-- One row per important admin / business action.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_user_id UUID,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  request_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Recommended indexes
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_user_id ON public.audit_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type ON public.audit_logs(entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_request_id ON public.audit_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_action ON public.audit_logs(created_at DESC, action);

-- ==============================================================================
-- 3. LOG RETENTION CONFIGURATION (server-side / admin-controlled)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.system_log_retention (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  retention_days INTEGER NOT NULL DEFAULT 30 CHECK (retention_days >= 1 AND retention_days <= 365),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

INSERT INTO public.system_log_retention (id, retention_days, updated_at)
VALUES (1, 30, NOW())
ON CONFLICT (id) DO NOTHING;

-- ==============================================================================
-- 4. ROW LEVEL SECURITY (RLS) — ADMIN ONLY
-- ==============================================================================

ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_log_retention ENABLE ROW LEVEL SECURITY;

-- system_logs: admin full access; everyone else denied.
DROP POLICY IF EXISTS "Admins can manage system_logs" ON public.system_logs;
CREATE POLICY "Admins can manage system_logs"
  ON public.system_logs FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- audit_logs: admin full access; everyone else denied.
DROP POLICY IF EXISTS "Admins can manage audit_logs" ON public.audit_logs;
CREATE POLICY "Admins can manage audit_logs"
  ON public.audit_logs FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- retention config: admin read/write.
DROP POLICY IF EXISTS "Admins can manage log retention" ON public.system_log_retention;
CREATE POLICY "Admins can manage log retention"
  ON public.system_log_retention FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ==============================================================================
-- 5. SECURITY DEFINER HELPERS
-- ==============================================================================

-- Insert a system log row bypassing RLS (used by the server-side logger,
-- which runs with the service role key via the admin client).
CREATE OR REPLACE FUNCTION public.insert_system_log(
  p_request_id TEXT,
  p_level TEXT,
  p_category TEXT,
  p_method TEXT DEFAULT NULL,
  p_path TEXT DEFAULT NULL,
  p_status_code INTEGER DEFAULT NULL,
  p_duration_ms INTEGER DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_role TEXT DEFAULT NULL,
  p_error_code TEXT DEFAULT NULL,
  p_message TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS public.system_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log public.system_logs;
BEGIN
  INSERT INTO public.system_logs (
    request_id, level, category, method, path, status_code,
    duration_ms, user_id, role, error_code, message, metadata
  ) VALUES (
    p_request_id, p_level, p_category, p_method, p_path, p_status_code,
    p_duration_ms, p_user_id, p_role, p_error_code, p_message,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING * INTO v_log;
  RETURN v_log;
END;
$$;

-- Insert an audit log row bypassing RLS.
CREATE OR REPLACE FUNCTION public.insert_audit_log(
  p_actor_user_id UUID,
  p_actor_role TEXT,
  p_action TEXT,
  p_entity_type TEXT DEFAULT NULL,
  p_entity_id TEXT DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS public.audit_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log public.audit_logs;
BEGIN
  INSERT INTO public.audit_logs (
    actor_user_id, actor_role, action, entity_type, entity_id, request_id, metadata
  ) VALUES (
    p_actor_user_id, p_actor_role, p_action, p_entity_type, p_entity_id,
    p_request_id, COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING * INTO v_log;
  RETURN v_log;
END;
$$;

-- Server-side prune of expired logs (called by an admin/cron).
CREATE OR REPLACE FUNCTION public.prune_system_logs(p_retention_days INTEGER DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retention INTEGER;
  v_deleted INTEGER;
BEGIN
  SELECT COALESCE(p_retention_days, retention_days) INTO v_retention
  FROM public.system_log_retention WHERE id = 1;

  IF v_retention IS NULL THEN
    v_retention := 30;
  END IF;

  WITH deleted AS (
    DELETE FROM public.system_logs
    WHERE created_at < NOW() - (v_retention || ' days')::INTERVAL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_deleted FROM deleted;

  RETURN v_deleted;
END;
$$;