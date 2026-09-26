-- ==============================================================================
-- SUGGEST KEY - PHASE 19: SECURITY LOCKDOWN - REVOKE ANON ACCESS
-- ==============================================================================
-- Defense-in-depth hardening. RLS policies already block row-level access for
-- anonymous users, but the `anon` role still holds:
--
--   1. ALL table-level privileges (SELECT, INSERT, UPDATE, DELETE, ...) on every
--      table in `public`, `storage`, and `realtime` schemas.
--   2. EXECUTE on EVERY function in `public` — including admin-only SECURITY
--      DEFINER functions that bypass RLS and run with the owner's full privileges.
--   3. CREATE on every schema, allowing anon to create new objects.
--   4. Default privileges that auto-grant ALL to `anon` on new tables/functions.
--
-- This migration:
--   * Revokes every table, function, sequence, and schema privilege from `anon`.
--   * Locks the `realtime` schema tables (which have NO RLS).
--   * Closes default privileges so future objects are not auto-exposed to anon.
--   * Re-asserts `authenticated` and `service_role` full access.
--   * Reloads the PostgREST schema cache.
--
-- Impact: Anonymous (unauthenticated) requests via the client SDK or PostgREST
-- are denied at the table level. All data access must go through:
--   - An authenticated user session (RLS-enforced), or
--   - The backend server using the service_role key.
--
-- Run with:  supabase db push
--     or:    paste into Supabase SQL Editor and Run.
-- ==============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- 1. REVOKE TABLE-LEVEL PRIVILEGES FROM anon
-- --------------------------------------------------------------------------
-- Removes SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
-- from every existing table so anonymous users cannot read or write any data
-- row directly, regardless of RLS policy configuration.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA storage FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA realtime FROM anon;

-- --------------------------------------------------------------------------
-- 2. REVOKE FUNCTION EXECUTION FROM anon
-- --------------------------------------------------------------------------
-- SECURITY DEFINER functions execute with the owner's privileges and bypass
-- RLS entirely. anon must not be able to invoke any of them via RPC.
-- (Authenticated users and the backend service_role retain EXECUTE.)

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA realtime FROM anon;

-- --------------------------------------------------------------------------
-- 3. REVOKE SEQUENCE PRIVILEGES FROM anon
-- --------------------------------------------------------------------------

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA storage FROM anon;

-- --------------------------------------------------------------------------
-- 4. LOCK DOWN SCHEMA-LEVEL PRIVILEGES
-- --------------------------------------------------------------------------
-- anon loses CREATE on every schema (prevents creating rogue tables,
-- functions, or buckets). USAGE on `public` and `storage` is intentionally
-- retained so PostgreSQL can resolve object names; without any table-level
-- privileges, USAGE alone grants zero data access.
-- USAGE on `auth` is retained so auth.uid() / auth.jwt() remain callable
-- during any RLS evaluation path PostgREST may trigger.

REVOKE CREATE ON SCHEMA public FROM anon;
REVOKE CREATE ON SCHEMA storage FROM anon;
REVOKE CREATE ON SCHEMA auth FROM anon;
REVOKE CREATE ON SCHEMA realtime FROM anon;

-- --------------------------------------------------------------------------
-- 5. LOCK DOWN DEFAULT PRIVILEGES (future-proof)
-- --------------------------------------------------------------------------
-- By default, Supabase auto-grants ALL on new tables/functions/sequences to
-- anon. These ALTER DEFAULT PRIVILEGES ensure that any table, function, or
-- sequence created AFTER this migration is automatically locked from anon.

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA storage
  REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA storage
  REVOKE ALL ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA storage
  REVOKE ALL ON SEQUENCES FROM anon;

-- --------------------------------------------------------------------------
-- 6. RE-ASSERT authenticated AND service_role ACCESS
-- --------------------------------------------------------------------------
-- authenticated: needs table-level privileges for PostgREST to evaluate RLS
--   (table privilege is the gate; RLS is the filter). Also needs EXECUTE on
--   all public functions including the RLS helper functions is_admin(), has_role(),
--   mentor_is_publicly_visible(), is_account_suspended(), etc.
-- service_role: full bypass of RLS for backend operations.

-- authenticated retains everything it needs
GRANT USAGE, CREATE ON SCHEMA public, storage, realtime, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA storage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA realtime TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA realtime TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA storage TO authenticated;

-- Default privileges for authenticated (so future objects are accessible)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA storage
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

-- service_role: full access, bypasses RLS
GRANT ALL ON ALL TABLES IN SCHEMA public, storage, realtime, auth TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public, realtime, auth TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public, storage TO service_role;
GRANT USAGE, CREATE ON SCHEMA public, storage, realtime, auth, extensions, graphql, graphql_public, vault TO service_role;

-- Default privileges for service_role
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA storage
  GRANT ALL ON TABLES TO service_role;

-- --------------------------------------------------------------------------
-- 7. STORAGE BUCKET LOCKDOWN
-- --------------------------------------------------------------------------
-- Ensure no storage bucket is accidentally marked public. All buckets in
-- this project are private (public=false) by design.

UPDATE storage.buckets SET public = FALSE WHERE public = TRUE;

-- --------------------------------------------------------------------------
-- 8. RELOAD POSTGREST SCHEMA CACHE
-- --------------------------------------------------------------------------

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
