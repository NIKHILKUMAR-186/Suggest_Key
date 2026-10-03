-- ===========================================================================
-- Phase 44b - Set-based discovery readiness for the mentor directory
-- ===========================================================================
--
-- WHY
--
-- `AdminMentorsPage` labelled a row "Discoverable" / "Not discoverable" from
-- `deriveMentorAccountState(...).isEligible`, which is mentor-level eligibility
-- (approved + active + account not suspended). That is NOT discoverability:
-- `is_mentor_discoverable()` also requires an active gig. An approved, active
-- mentor with no gig was therefore reported as "Discoverable", which is the
-- same class of error as the original incident - a page asserting a discovery
-- answer the database never gave it.
--
-- `mentor_discovery_readiness(mentor_id)` from Phase 44 is the authoritative
-- calculation, but calling it once per row is an N+1 on a directory page. This is
-- the same answer for every mentor in one statement.
--
-- It deliberately DELEGATES to `mentor_is_publicly_visible()` and
-- `is_mentor_discoverable()` rather than restating their predicates. Those two
-- functions are what the RLS policies and seeker discovery already use, so they
-- are the canonical rules; a third copy of the predicate in this file would be
-- precisely the duplication this migration exists to remove.

CREATE OR REPLACE FUNCTION public.mentor_discovery_readiness_for_all()
RETURNS TABLE (
  mentor_id            UUID,
  approval_status      TEXT,
  is_approved_legacy   BOOLEAN,
  is_active            BOOLEAN,
  is_publicly_visible  BOOLEAN,
  is_discoverable      BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    mp.id,
    mp.approval_status,
    mp.is_approved,
    mp.is_active,
    public.mentor_is_publicly_visible(mp.id),
    public.is_mentor_discoverable(mp.id)
  FROM public.mentor_profiles mp;
$fn$;

COMMENT ON FUNCTION public.mentor_discovery_readiness_for_all() IS
  'Discovery readiness for every mentor_profiles row in one statement, for the admin mentor directory. Delegates to mentor_is_publicly_visible()/is_mentor_discoverable() so the directory cannot state a different rule from seeker discovery. Rows with no mentor_profiles entry are absent; the directory resolves those from the roles table as before.';

-- Same containment as Phase 44: service role only. This exposes every mentor's
-- moderation state, so it must not be reachable from a browser client.
REVOKE ALL ON FUNCTION public.mentor_discovery_readiness_for_all() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mentor_discovery_readiness_for_all() TO service_role;

DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN OTHERS THEN
  NULL;  -- harmless when pgrst is absent
END $$;

-- Postgres re-grants EXECUTE to PUBLIC on every NEW function, so the REVOKE
-- above must be proven rather than assumed. This function exposes every mentor's
-- moderation state, so a silent regression here is a data leak.
DO $$
DECLARE
  v_leaked TEXT;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_leaked
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'approve_mentor_application', 'reject_mentor_application',
      'review_mentor_document', 'mentor_discovery_readiness',
      'mentor_discovery_readiness_for_all'
    )
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'Phase 44b containment failed: anon still has EXECUTE on %', v_leaked;
  END IF;
END $$;
