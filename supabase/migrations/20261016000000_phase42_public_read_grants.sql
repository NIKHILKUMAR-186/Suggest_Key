-- ==============================================================================
-- SUGGEST KEY - PHASE 42: PUBLIC READ GRANTS FOR ANON
-- ==============================================================================
-- Phase 19 revoked ALL table and function privileges from anon. Subsequent
-- phases added RLS policies that allow public read access, but without the
-- underlying GRANT PostgREST cannot evaluate those policies for anonymous
-- visitors.
--
-- This migration restores only the minimum privileges that the existing
-- public RLS policies require:
--
-- Table SELECT for the public-read surfaces:
--   segments         - "Anyone can view active segments"
--   mentor_profiles  - "Anyone can view approved mentor profiles"
--   gigs             - "Anyone can view active gigs of approved mentors"
--   mentor_segments  - "Anyone can view mentor segments"
--   profiles         - required for the profile:profiles() relation on
--                      mentor_profiles; RLS still restricts anon to 0 rows
--
-- Function EXECUTE for RLS helper functions used in public policies:
--   is_admin()                  - returns false for anon (auth.uid() is null)
--   has_role()                  - returns false for anon (auth.uid() is null)
--   mentor_is_publicly_visible() - SECURITY DEFINER, safe for anon
--   is_account_suspended()      - SECURITY DEFINER, safe for anon
--
-- No RLS policy is changed. No new table or column is added.
-- Idempotent: safe to re-run.

BEGIN;

GRANT SELECT ON public.segments TO anon;
GRANT SELECT ON public.mentor_profiles TO anon;
GRANT SELECT ON public.gigs TO anon;
GRANT SELECT ON public.mentor_segments TO anon;
GRANT SELECT ON public.profiles TO anon;

GRANT EXECUTE ON FUNCTION public.is_admin() TO anon;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, text) TO anon;
GRANT EXECUTE ON FUNCTION public.mentor_is_publicly_visible(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.is_account_suspended(UUID) TO anon;

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
