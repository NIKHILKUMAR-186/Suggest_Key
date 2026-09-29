-- =============================================================================
-- SUGGEST KEY - PHASE 29: SECURITY DEFINER EXECUTE CONTAINMENT (CRITICAL-01)
-- =============================================================================
-- Problem
--   Postgres grants EXECUTE on new functions to PUBLIC by default. Every
--   SECURITY DEFINER function in `public` was therefore reachable by `anon`,
--   which is the role behind the browser's publishable Supabase key. Because
--   these functions are SECURITY DEFINER owned by postgres, calling one
--   bypasses RLS entirely.
--
--   33 of those functions performed no caller validation at all. The worst was
--   admin_upsert_profile, which writes user_roles with a caller-supplied role:
--   any anonymous internet visitor could have granted themselves `admin`.
--
--   admin_upsert_profile happened to abort on a reference to the dropped column
--   profiles.onboarded. That is an accidental blocker, not a control, and it
--   is not relied upon here.
--
-- Fix
--   1. REVOKE EXECUTE ... FROM PUBLIC on every function in `public`. This is
--      what actually removed `anon`, which held no explicit grant and
--      inherited EXECUTE solely from PUBLIC.
--   2. REVOKE EXECUTE ... FROM anon and from authenticated on every function,
--      then re-grant the smallest set each role genuinely needs.
--   3. Re-grant to service_role on everything: the server is the trusted
--      backend and already holds the service key.
--   4. Re-grant to `authenticated` ONLY the four functions that RLS policies
--      must be able to evaluate. Without these, every policy would fail at
--      runtime with "permission denied for function".
--   5. Re-grant handle_new_user to supabase_auth_admin, the role that inserts
--      into auth.users and fires the trigger.
--
-- Deliberately NOT done here
--   - No function was dropped. Dropping is irreversible; containment fully
--     mitigates CRITICAL-01, and the obsolete-function cleanup is handled
--     separately under review.
--   - Only SECURITY DEFINER functions are affected. Plain functions execute
--     with the invoker's own privileges and are not an escalation vector, and
--     several are trigger bodies that must stay invocable by `authenticated`.
--   - No table, policy, or RLS setting was changed.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Remove EXECUTE from the three client-reachable roles.
--
--    Scoped to SECURITY DEFINER functions only. Plain functions execute with
--    the invoker's own privileges and are therefore not an escalation vector;
--    more importantly, several of them are trigger bodies
--    (set_updated_at, enforce_gig_topic_segment_ownership) that fire on rows
--    written by `authenticated`, and revoking them would break ordinary user
--    writes. A blanket `ON ALL FUNCTIONS ... FROM authenticated` would do
--    exactly that, so it is deliberately avoided.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.sig);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The server is the trusted backend: restore full function access there.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- ---------------------------------------------------------------------------
-- 3. RLS predicate support for `authenticated`.
--
--    These four are referenced by RLS policies, so they must be executable by
--    whichever role the policy is evaluated as. `anon` is deliberately NOT
--    granted them: anon holds no table-level privilege in this schema, so it
--    can never reach policy evaluation, and direct RPC access to them is
--    exactly the vector being closed.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.is_admin()                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, text)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_account_suspended(uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.mentor_is_publicly_visible(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Trigger support. handle_new_user fires on auth.users, written by
--    supabase_auth_admin. Removing the PUBLIC grant would otherwise break
--    signup for every new account.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Pin search_path on the two SECURITY DEFINER functions that were missing
--    it, matching every other function in the schema.
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.create_booking_with_hold(uuid, uuid, uuid, uuid, timestamptz, timestamptz)
  SET search_path = public;
ALTER FUNCTION public.get_user_role(uuid)
  SET search_path = public;

-- ---------------------------------------------------------------------------
-- 6. Post-conditions. These must hold after this migration runs; if any row
--    reports true, containment has regressed and the migration must be
--    re-applied before traffic continues.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  leaked text;
BEGIN
  SELECT string_agg(proname, ', ')
    INTO leaked
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosecdef
     AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'CRITICAL-01 containment incomplete: anon can still EXECUTE: %', leaked;
  END IF;

  RAISE NOTICE 'CRITICAL-01 contained: no SECURITY DEFINER function in public is executable by anon.';
END $$;
