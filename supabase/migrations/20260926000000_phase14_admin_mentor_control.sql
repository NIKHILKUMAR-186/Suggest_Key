-- ==============================================================================
-- SUGGEST KEY - PHASE 14: ADMIN MENTOR OPERATIONAL CONTROL
-- ==============================================================================
-- Backstop for "Admin-created mentors are auto-verified" and "Admin can always
-- activate / deactivate / suspend / reactivate any mentor".
--
-- The application layer (server.ts) already enforces every rule in the API.
-- This migration makes the SAME rules hold at the database level so a
-- deactivated or suspended mentor cannot leak into public discovery even if
-- some future query bypasses the API.
--
-- Idempotent. Safe on an empty database or one that already has Phase 12 /
-- Phase 13 applied. Re-running is a no-op.
--
-- Run with:  supabase db push
--     or:    paste into Supabase SQL Editor and Run.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. REQUIRED COLUMNS
-- ------------------------------------------------------------------------------
-- Phase 12 added approval_status / is_active to mentor_profiles and Phase 13
-- added the suspension columns to profiles. Both are re-asserted here with IF
-- NOT EXISTS so this migration stands on its own.

DO $$
BEGIN
  IF to_regclass('public.mentor_profiles') IS NOT NULL THEN
    ALTER TABLE public.mentor_profiles
      ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'draft';
    ALTER TABLE public.mentor_profiles
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT FALSE;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = 'public.mentor_profiles'::regclass
                     AND conname = 'chk_mentor_profiles_approval_status')
    THEN
      ALTER TABLE public.mentor_profiles
        ADD CONSTRAINT chk_mentor_profiles_approval_status
        CHECK (approval_status IN ('draft','pending_review','approved','rejected'));
    END IF;
  END IF;

  IF to_regclass('public.profiles') IS NOT NULL THEN
    ALTER TABLE public.profiles
      ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active';
    ALTER TABLE public.profiles
      ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS suspension_reason TEXT,
      ADD COLUMN IF NOT EXISTS suspended_by UUID,
      ADD COLUMN IF NOT EXISTS internal_note TEXT,
      ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = 'public.profiles'::regclass
                     AND conname = 'chk_profiles_account_status')
    THEN
      ALTER TABLE public.profiles
        ADD CONSTRAINT chk_profiles_account_status
        CHECK (account_status IN ('active','suspended','deactivated'));
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mentor_profiles_approval ON public.mentor_profiles(approval_status);
CREATE INDEX IF NOT EXISTS idx_mentor_profiles_active   ON public.mentor_profiles(is_active);
CREATE INDEX IF NOT EXISTS idx_profiles_account_status  ON public.profiles(account_status);

-- ------------------------------------------------------------------------------
-- 2. ADMIN-CREATED MENTORS ARE APPROVED AND ACTIVE
-- ------------------------------------------------------------------------------
-- Phase 12 backfilled mentors that were already approved. This extends the same
-- treatment to any mentor whose is_approved flag is true but whose
-- approval_status was never migrated, so no approved mentor is left in 'draft'.
--
-- The inverse is deliberately NOT done: a DEACTIVATED mentor keeps
-- approval_status='approved', so reactivation never re-opens verification
-- (prompt section 6).

UPDATE public.mentor_profiles
SET approval_status = 'approved'
WHERE is_approved = TRUE
  AND (approval_status IS NULL OR approval_status = 'draft');


-- ------------------------------------------------------------------------------
-- 3. SINGLE DISCOVERY PREDICATE
-- ------------------------------------------------------------------------------
-- One database-side definition of "may this mentor be publicly discovered",
-- mirroring is_mentor_discoverable() from Phase 13 and the checks in
-- src/lib/adminMentorControl.ts.
--
-- Public visibility requires ALL of:
--   approved (approval_status='approved' AND is_approved)
-- + active  (is_active)
-- + not suspended and not deactivated (account_status)
--
-- Seeker discovery additionally requires an eligible segment, an active gig
-- and a valid bookable slot; those stay in the application because they depend
-- on the requested date (prompt section 4).

CREATE OR REPLACE FUNCTION public.mentor_is_publicly_visible(p_mentor_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT COALESCE((
    SELECT (
      mp.is_approved = TRUE
      AND mp.approval_status = 'approved'
      AND mp.is_active = TRUE
      AND NOT public.is_account_suspended(mp.id)
    )
    FROM public.mentor_profiles mp
    WHERE mp.id = p_mentor_id
  ), FALSE);
$fn$;

-- ------------------------------------------------------------------------------
-- 4. RLS: PUBLIC DISCOVERY MUST NOT SEE INACTIVE MENTORS
-- ------------------------------------------------------------------------------
-- The Phase 4 policies keyed public visibility off `is_approved` alone, so a
-- DEACTIVATED mentor (is_active = false) stayed publicly readable. They are
-- replaced with the full predicate.
--
-- Deliberately NOT tightened: verification documents, internal notes,
-- suspension reasons and audit records are never exposed here, and the
-- Admin-only policies from Phase 13 remain in place. Admin access is not public
-- access (prompt section 11).

DO $$
BEGIN
  IF to_regclass('public.mentor_profiles') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Anyone can view approved mentor profiles" ON public.mentor_profiles;
    CREATE POLICY "Anyone can view approved mentor profiles"
      ON public.mentor_profiles FOR SELECT
      USING (
        public.mentor_is_publicly_visible(id)
        OR id = auth.uid()
        OR public.is_admin()
      );
  END IF;

  IF to_regclass('public.gigs') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Anyone can view active gigs of approved mentors" ON public.gigs;
    CREATE POLICY "Anyone can view active gigs of approved mentors"
      ON public.gigs FOR SELECT
      USING (
        (is_active = TRUE AND public.mentor_is_publicly_visible(mentor_id))
        OR mentor_id = auth.uid()
        OR public.is_admin()
      );
  END IF;
END $$;

-- mentor_segments, mentor_availability and mentor_availability_exceptions were
-- previously world-readable. An inactive mentor's operational data is no longer
-- public, but the mentor keeps read access to their own rows so their
-- dashboard history stays intact (prompt section 5).
DO $$
BEGIN
  IF to_regclass('public.mentor_segments') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Anyone can view mentor segments" ON public.mentor_segments;
    CREATE POLICY "Anyone can view mentor segments"
      ON public.mentor_segments FOR SELECT
      USING (
        public.mentor_is_publicly_visible(mentor_id)
        OR mentor_id = auth.uid()
        OR public.is_admin()
      );
  END IF;

  IF to_regclass('public.mentor_availability') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Anyone can view mentor availability rules" ON public.mentor_availability;
    CREATE POLICY "Anyone can view mentor availability rules"
      ON public.mentor_availability FOR SELECT
      USING (
        public.mentor_is_publicly_visible(mentor_id)
        OR mentor_id = auth.uid()
        OR public.is_admin()
      );
  END IF;

  IF to_regclass('public.mentor_availability_exceptions') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Anyone can view mentor availability exceptions" ON public.mentor_availability_exceptions;
    CREATE POLICY "Anyone can view mentor availability exceptions"
      ON public.mentor_availability_exceptions FOR SELECT
      USING (
        public.mentor_is_publicly_visible(mentor_id)
        OR mentor_id = auth.uid()
        OR public.is_admin()
      );
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 5. GRANTS
-- ------------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.mentor_is_publicly_visible(UUID) TO authenticated, anon;

-- Reload the PostgREST schema cache so the new columns are visible to the API.
DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

COMMIT;
