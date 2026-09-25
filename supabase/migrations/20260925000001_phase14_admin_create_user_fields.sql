-- Phase 14: fields required by the Admin "Create New User" form.
--
-- Scope is deliberately minimal. The Admin Create User form (seeker + admin-created
-- mentor) collects these values, so the columns must exist. Nothing else changes:
-- no tables, no policies, no RLS changes.
--
-- 1. profiles.phone
--    Both roles. Admin-supplied contact number. Nullable, free-form.
--
-- 2. mentor_profiles.expertise
--    Mentor-only "areas of expertise" tags. Nullable text[] so it composes with
--    the existing `languages` text[] column.
--
-- Everything else the form collects already exists:
--   profiles.full_name, profiles.email, profiles.timezone, profiles.avatar_url
--   mentor_profiles.headline, mentor_profiles.about,
--   mentor_profiles.experience_years, mentor_profiles.languages,
--   mentor_profiles.approval_status, mentor_profiles.is_active

-- ---------------------------------------------------------------------------
-- profiles.phone
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'phone'
  ) THEN
    ALTER TABLE public.profiles
      ADD COLUMN phone text;

    COMMENT ON COLUMN public.profiles.phone IS
      'Admin-supplied contact number. Nullable. Not used for authentication.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- mentor_profiles.expertise
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mentor_profiles' AND column_name = 'expertise'
  ) THEN
    ALTER TABLE public.mentor_profiles
      ADD COLUMN expertise text[];

    COMMENT ON COLUMN public.mentor_profiles.expertise IS
      'Mentor areas of expertise as free-form tags. NULL until an Admin or the mentor sets them.';
  END IF;
END $$;
