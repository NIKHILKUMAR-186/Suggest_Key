-- ==============================================================================
-- SUGGEST KEY - PHASE 15: MENTOR CREATION SOURCE (created_via)
-- ==============================================================================
-- WHY THIS EXISTS
-- ---------------
-- A mentor can join the platform two ways:
--   A. public_signup  -> /mentor/signup -> application -> documents -> review
--   B. admin_direct   -> Admin -> Create User -> Mentor (already approved+active)
--
-- The Admin Mentor Control Center must tell these apart from REAL database
-- state, never by guessing, and must never show an Admin-created mentor the
-- "No mentor application exists" error state (it has no application BY DESIGN).
--
-- Verified against the LIVE schema on 2026-09-25 (not assumed):
--   - mentor_profiles had NO created_via column
--   - profiles.phone       EXISTS
--   - mentor_profiles.expertise EXISTS
--   - the real experience column is mentor_profiles.experience_years;
--     mentor_applications.years_of_experience is a DIFFERENT column. That
--     mismatch is the historical cause of the "column not found in the schema
--     cache" bug, so the UI must use experience_years for the mentor.
--   - audit_logs ALREADY records MENTOR_CREATED_BY_ADMIN with
--     entity_type='mentor_profile' and entity_id = the mentor's user id
--
-- That audit trail is the existing source signal, so the backfill below is
-- derived from recorded data rather than inferred.
--
-- Idempotent. Safe on an empty database or an already-migrated one.
-- Run with:  supabase db push
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. created_via COLUMN
-- ------------------------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('public.mentor_profiles') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'mentor_profiles'
        AND column_name = 'created_via'
    ) THEN
      ALTER TABLE public.mentor_profiles
        ADD COLUMN created_via TEXT;

      COMMENT ON COLUMN public.mentor_profiles.created_via IS
        'How this mentor joined: public_signup | admin_direct. NULL = a legacy row '
        'written before this column existed; the server then falls back to the '
        'MENTOR_CREATED_BY_ADMIN audit record, and finally to application presence.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = 'public.mentor_profiles'::regclass
                     AND conname = 'chk_mentor_profiles_created_via')
    THEN
      ALTER TABLE public.mentor_profiles
        ADD CONSTRAINT chk_mentor_profiles_created_via
        CHECK (created_via IS NULL OR created_via IN ('public_signup','admin_direct'));
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mentor_profiles_created_via
  ON public.mentor_profiles(created_via);

-- ------------------------------------------------------------------------------
-- 2. BACKFILL FROM REAL DATA
-- ------------------------------------------------------------------------------
-- Priority (most authoritative first):
--   1. a recorded MENTOR_CREATED_BY_ADMIN audit event  -> admin_direct
--   2. a mentor_applications row exists                -> public_signup
--   3. otherwise leave NULL - genuinely unknown. The UI shows a neutral
--      "source unknown" state rather than inventing a source.
--
-- A submitted application only counts once it was actually submitted, so a
-- draft the mentor abandoned is not treated as a completed public signup.

UPDATE public.mentor_profiles mp
SET created_via = 'admin_direct'
WHERE mp.created_via IS NULL
  AND to_regclass('public.audit_logs') IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.audit_logs al
    WHERE al.entity_id = mp.id::text
      AND al.action = 'MENTOR_CREATED_BY_ADMIN'
  );

UPDATE public.mentor_profiles mp
SET created_via = 'public_signup'
WHERE mp.created_via IS NULL
  AND to_regclass('public.mentor_applications') IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.mentor_applications ma
    WHERE ma.user_id = mp.id
      AND ma.submitted_at IS NOT NULL
  );

-- A mentor with only a draft application and no admin-creation audit record is
-- still a public signup: they reached the mentor table through signup, not
-- through the Admin Create User button.
UPDATE public.mentor_profiles mp
SET created_via = 'public_signup'
WHERE mp.created_via IS NULL
  AND to_regclass('public.mentor_applications') IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.mentor_applications ma
    WHERE ma.user_id = mp.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.audit_logs al
    WHERE al.entity_id = mp.id::text
      AND al.action = 'MENTOR_CREATED_BY_ADMIN'
  );

-- Reload the PostgREST schema cache so the new column is immediately usable.
DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

COMMIT;
