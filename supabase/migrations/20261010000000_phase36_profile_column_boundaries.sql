-- =============================================================================
-- PHASE 36: RECORD THE profiles / mentor_profiles COLUMN BOUNDARY
-- =============================================================================
--
-- WHY THIS EXISTS
-- ---------------
-- DRIFT.md items 1 and 2. Production has had a narrow per-column UPDATE grant on
-- both tables for a while, plus four RLS policies that no migration creates. A
-- database built purely from migration history ships the wide grant from
-- `20260914000018_permissions_authenticated_anon`, which is privilege
-- escalation on both tables.
--
-- This migration records the production state. It is a no-op against the live
-- database and closes the gap on a history-built one.
--
-- WHAT IT FIXES
-- -------------
-- `profiles`. `authenticated` could UPDATE every column, including:
--   account_status, internal_note, suspended_until, suspended_at,
--   deactivated_at, suspended_by, suspension_reason
-- so a user could clear their own suspension, reactivate a deactivated account,
-- or write to the admin-only `internal_note`.
--
-- `mentor_profiles`. `authenticated` could UPDATE:
--   is_approved, approval_status, is_active, is_featured,
--   rating, review_count, session_count
-- and because the public SELECT policy keys on `mentor_is_publicly_visible()`,
-- a self-approved mentor becomes publicly bookable without review.
--
-- Confirmed exploitable before the fix, as `authenticated` with a forged JWT
-- inside forced-rollback transactions:
--   internal_note_after: "SELF-ESCALATION PROBE", account_status_after: "active"
--   SELF-APPROVAL PROBE ... rows=1 is_featured f->t
--
-- ONLY THE FOUR AUTHENTICATED COLUMN GRANTS ARE TOUCHED
-- -----------------------------------------------------
-- `profiles` UPDATE stays on `avatar_url, full_name, phone, timezone`.
-- `mentor_profiles` UPDATE stays on `about, experience_years, expertise,
-- headline, languages`.
--
-- INSERT, SELECT, DELETE and REFERENCES are left exactly as they are. INSERT in
-- particular must keep every column: `src/lib/supabase.ts::upsertUserProfile`
-- is called from `AuthContext.tsx:161` on first sign-in and writes `id`,
-- `email` and `created_at`, and the RLS INSERT policy is
-- `WITH CHECK (auth.uid() = id)`. Narrowing INSERT would make new sign-ups
-- fail. Verified before writing: no application path TRUNCATEs either table.
--
-- `updated_at` is deliberately NOT granted. Neither table has a trigger
-- maintaining it, so a client that updates `full_name` will leave `updated_at`
-- stale. That is accepted rather than fixed here: granting `updated_at` would
-- be harmless in isolation, but the honest fix is a trigger, and adding one
-- changes write semantics beyond the scope of recording existing state.
--
-- THE TYPO IN A POLICY NAME IS INTENTIONAL
-- ----------------------------------------
-- The live policy is named `Users can update own own editable columns` - with
-- "own" twice. It is reproduced verbatim so that applying this migration to
-- production is a true no-op. Renaming it here would leave the old policy in
-- place alongside the new one and make the live state ambiguous.
--
-- TRUNCATE
-- --------
-- Both tables also carry a table-level TRUNCATE grant for `authenticated`.
-- TRUNCATE is one of the few statements RLS does not cover, so this is a real
-- data-destruction path rather than a theoretical one - the same reasoning as
-- the `bookings` correction in phase24c and the workspace tables in phase32.
-- No application path uses TRUNCATE (verified across src/, server.ts and
-- scripts/), and maintenance tooling connects with the service-role key, which
-- keeps its own grants. So this revokes the client path only. This also closes
-- DRIFT.md item 4 for `reschedule_requests`.

-- =============================================================================
-- 1. profiles
-- =============================================================================

REVOKE UPDATE ON public.profiles FROM authenticated;

GRANT UPDATE (
  avatar_url,
  full_name,
  phone,
  timezone
) ON public.profiles TO authenticated;

DROP POLICY IF EXISTS "Users can update own own editable columns" ON public.profiles;

CREATE POLICY "Users can update own own editable columns"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid() AND NOT is_account_suspended(auth.uid()))
  WITH CHECK (id = auth.uid() AND NOT is_account_suspended(auth.uid()));

DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;

CREATE POLICY "Admins can update any profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- =============================================================================
-- 2. mentor_profiles
-- =============================================================================

REVOKE UPDATE ON public.mentor_profiles FROM authenticated;

GRANT UPDATE (
  headline,
  about,
  experience_years,
  expertise,
  languages
) ON public.mentor_profiles TO authenticated;

DROP POLICY IF EXISTS "Mentors can update own editable profile fields" ON public.mentor_profiles;

CREATE POLICY "Mentors can update own editable profile fields"
  ON public.mentor_profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid() OR is_admin())
  WITH CHECK (id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "Admins can update any mentor profile" ON public.mentor_profiles;

CREATE POLICY "Admins can update any mentor profile"
  ON public.mentor_profiles
  FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- =============================================================================
-- 3. TRUNCATE, which RLS does not cover
-- =============================================================================

REVOKE TRUNCATE ON public.profiles FROM authenticated, anon;
REVOKE TRUNCATE ON public.mentor_profiles FROM authenticated, anon;
REVOKE TRUNCATE ON public.reschedule_requests FROM authenticated, anon;

-- =============================================================================
-- 4. Fail loudly rather than shipping a half-applied boundary
-- =============================================================================

DO $$
DECLARE
  v_leak text;
BEGIN
  -- A column the client must not write, but which it still holds UPDATE on,
  -- means the revoke above did not take effect.
  SELECT string_agg(format('%s.%s', table_name, column_name), ', ')
    INTO v_leak
    FROM information_schema.column_privileges
   WHERE table_schema = 'public'
     AND grantee = 'authenticated'
     AND privilege_type = 'UPDATE'
     AND (
       (table_name = 'profiles' AND column_name NOT IN
            ('avatar_url', 'full_name', 'phone', 'timezone'))
       OR
       (table_name = 'mentor_profiles' AND column_name NOT IN
            ('about', 'experience_years', 'expertise', 'headline', 'languages'))
     );

  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION
      'phase36 incomplete: authenticated can still UPDATE %', v_leak;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM information_schema.table_privileges
     WHERE table_schema = 'public'
       AND table_name IN ('profiles', 'mentor_profiles', 'reschedule_requests')
       AND grantee IN ('authenticated', 'anon')
       AND privilege_type = 'TRUNCATE'
  ) THEN
    RAISE EXCEPTION
      'phase36 incomplete: a client role still holds TRUNCATE';
  END IF;
END $$;

COMMENT ON TABLE public.profiles IS
  'UPDATE is limited to avatar_url, full_name, phone and timezone. Account lifecycle and moderation fields (account_status, suspended_*, deactivated_at, internal_note) are service-role only: granting them let a user clear their own suspension or write to the admin note. RLS keys ownership on id = auth.uid(), admin writes on is_admin().';

COMMENT ON TABLE public.mentor_profiles IS
  'UPDATE is limited to headline, about, experience_years, expertise and languages. Verification and moderation fields (is_approved, approval_status, is_active, is_featured, rating, review_count, session_count) are service-role only: granting them let a mentor self-approve and become publicly bookable, because the public SELECT policy keys on mentor_is_publicly_visible().';
