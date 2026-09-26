-- Phase 16 — Role integrity backfill
--
-- WHY
-- `public.user_roles` is the single canonical role source. Both the server
-- (`requireAuth` in src/lib/supabaseServer.ts) and the client (`fetchUserRoles`
-- in src/lib/supabase.ts) read it and nothing else. Any authenticated account
-- with no row in that table resolves to ZERO roles server-side, so every
-- role-gated endpoint rejects it (e.g. POST /api/bookings/hold returning
-- "Role 'seeker' required.").
--
-- The `on_auth_user_created` trigger already inserts exactly one role per
-- signup, but a row can still be absent (older accounts predating the trigger,
-- a signup whose insert did not persist, or a manually created account). When
-- that happens the platform has an account that can sign in but can do nothing.
--
-- WHAT
-- Backfill a role for every authenticated user that has none, derived ONLY from
-- facts already in the database — never from a guess and never from a role the
-- client asserted:
--
--   * has a `mentor_profiles` row                  -> 'mentor'
--   * otherwise                                    -> 'seeker'  (the trigger's
--     own default, applied to an account that has no mentor identity at all)
--
-- This introduces no new role system: it materialises the same values the
-- existing trigger and RLS policies already model, and it is idempotent.

INSERT INTO public.user_roles (user_id, role, created_at)
SELECT
  u.id,
  CASE
    WHEN EXISTS (SELECT 1 FROM public.mentor_profiles mp WHERE mp.id = u.id) THEN 'mentor'
    ELSE 'seeker'
  END,
  NOW()
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id
)
ON CONFLICT (user_id, role) DO NOTHING;

-- Keep the trigger honest for future signups. The function already inserts the
-- role; this only guarantees a profile without a role can never be created
-- again by re-running the signup path with missing metadata.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role TEXT;
  v_full_name TEXT;
  v_timezone TEXT;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1));
  v_timezone := COALESCE(NEW.raw_user_meta_data->>'timezone', 'Asia/Kolkata');

  INSERT INTO public.profiles (id, email, full_name, timezone, created_at, updated_at)
  VALUES (NEW.id, NEW.email, v_full_name, v_timezone, NOW(), NOW())
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      updated_at = NOW();

  -- Prevent arbitrary self-assignment of 'admin' through signup metadata.
  v_role := LOWER(COALESCE(NEW.raw_user_meta_data->>'requested_role', 'seeker'));
  IF v_role NOT IN ('seeker', 'mentor') THEN
    v_role := 'seeker';
  END IF;

  INSERT INTO public.user_roles (user_id, role, created_at)
  VALUES (NEW.id, v_role, NOW())
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$function$;
