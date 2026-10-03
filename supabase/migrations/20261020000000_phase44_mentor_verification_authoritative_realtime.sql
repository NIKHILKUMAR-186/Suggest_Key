-- ===========================================================================
-- Phase 44 - Mentor verification becomes database-authoritative + realtime
-- ===========================================================================
--
-- WHY THIS MIGRATION EXISTS
--
-- `POST /api/admin/mentor-applications/:id/approve` performed SIX independent
-- writes. The FIRST one committed `mentor_applications.status = 'approved'`
-- and only afterwards did it try to synchronise `mentor_profiles`. Any failure
-- after the first write left the database in a self-contradictory state:
--
--   mentor_applications.status = 'approved'
--   mentor_profiles.approval_status = 'draft', is_active = false
--
-- That is exactly the reported incident (application 9ace5bf7..., approved
-- 2026-10-03 20:44:38Z: application approved, mentor_profiles still `draft`,
-- no approval notification, no audit_logs row). Because the route refuses to
-- re-approve anything that is not `pending_review` (correctly, as a 409), the
-- drift was UNREPAIRABLE through the product: the admin saw "Approved" on the
-- verification page and "draft / Pending Verification" on the mentor page for
-- the same mentor, forever.
--
-- Two independent defects are fixed here:
--
--   1. ATOMICITY. The approval is now one transaction inside one function,
--      under one row lock. It either writes every required field or none.
--   2. AUTHORISATION. The function takes the acting admin's id as a PARAMETER
--      and re-verifies the admin role against `user_roles` itself. The previous
--      `approve_mentor_application` gated on `auth.uid()`, which is NULL on the
--      service-role client the API route uses - that is why the route could not
--      call it and ended up hand-rolling six writes. Server-side authorisation
--      is now inside the transaction, so a handler bug cannot widen access.
--
-- STATE MODEL - four SEPARATE concepts, deliberately not collapsed
--
--   1. APPLICATION APPROVAL      mentor_applications.status
--   2. MENTOR PROFILE APPROVAL   mentor_profiles.approval_status
--                                mentor_profiles.is_approved (legacy)
--   3. ACCOUNT / ACTIVE STATE    profiles.account_status (moderation)
--                                mentor_profiles.is_active (discovery switch)
--   4. DISCOVERY READINESS       computed - see mentor_discovery_readiness()
--
-- Approving an application synchronises 1 -> 2 and flips `is_active`, because
-- that is the lifecycle this product already had (both the previous SQL
-- function and the previous route did it). It does NOT touch
-- `profiles.account_status`: an admin suspension is a moderation decision and
-- must not be undone by an approval click. It does NOT create gigs,
-- availability or segments.
--
-- APPROVED is therefore NOT the same as DISCOVERABLE. A mentor still needs an
-- eligible segment, an active gig and recurring availability, and that
-- calculation stays in the database where it always was
-- (`mentor_is_publicly_visible` / `is_mentor_discoverable`), now exposed
-- read-only through `mentor_discovery_readiness()` so no component re-derives
-- the rules.

-- ===========================================================================
-- 1. ATOMIC APPROVAL
-- ===========================================================================
--
-- Replaces the 1-argument version. The new signature takes the acting admin so
-- authorisation can be proven under the same lock as the writes, and returns a
-- structured outcome rather than raising for ordinary business results, so the
-- route can map each one to the HTTP status it already returns (409 / 400 /
-- 403 / 404) without re-deriving the rules.
--
-- Expected outcomes:
--   approved | forbidden | not_found | not_pending_review | missing_documents
--
-- Anything else (a genuine fault) raises, rolls the whole transaction back,
-- and surfaces as a 5xx. There is no partially-approved state to recover from.

CREATE OR REPLACE FUNCTION public.approve_mentor_application(
  p_application_id  UUID,
  p_admin_user_id   UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_app            public.mentor_applications;
  v_required       TEXT[];
  v_approved_docs  TEXT[];
  v_missing        TEXT[];
BEGIN
  ---------------------------------------------------------------------------
  -- Authorisation FIRST, before any existence read, so a non-admin learns
  -- nothing about the row. Verified against `user_roles`, not against the
  -- caller, which is the service role and therefore not an admin.
  ---------------------------------------------------------------------------
  IF p_admin_user_id IS NULL
     OR NOT EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = p_admin_user_id AND ur.role = 'admin'
        )
  THEN
    RETURN jsonb_build_object('outcome', 'forbidden');
  END IF;

  ---------------------------------------------------------------------------
  -- One row lock for the whole decision. A concurrent approve/reject blocks
  -- here, then re-reads the committed status and is refused as a conflict
  -- rather than interleaving into a contradictory outcome.
  ---------------------------------------------------------------------------
  SELECT * INTO v_app
  FROM public.mentor_applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  ---------------------------------------------------------------------------
  -- State-transition validation. Only `pending_review -> approved` is legal.
  --
  -- This is deliberately NOT idempotent. The previous function returned early
  -- for an already-approved application, which meant a drifted row could never
  -- be repaired: the early return skipped the mentor_profiles sync entirely.
  -- A repeat decision is a conflict the caller must reconcile against, which
  -- is what the route has always answered with 409.
  ---------------------------------------------------------------------------
  IF v_app.status <> 'pending_review' THEN
    RETURN jsonb_build_object(
      'outcome', 'not_pending_review',
      'current_status', v_app.status
    );
  END IF;

  ---------------------------------------------------------------------------
  -- Required-document gate, inside the same transaction and under the same
  -- lock as the transition. Previously this was a separate round trip.
  ---------------------------------------------------------------------------
  SELECT COALESCE(array_agg(code ORDER BY sort_order), ARRAY[]::TEXT[])
    INTO v_required
  FROM public.mentor_document_types
  WHERE is_required = TRUE AND is_active = TRUE;

  IF array_length(v_required, 1) > 0 THEN
    SELECT COALESCE(array_agg(DISTINCT document_type), ARRAY[]::TEXT[])
      INTO v_approved_docs
    FROM public.mentor_verification_documents
    WHERE application_id = p_application_id AND status = 'approved';

    SELECT COALESCE(array_agg(r ORDER BY r), ARRAY[]::TEXT[])
      INTO v_missing
    FROM unnest(v_required) AS r
    WHERE NOT (r = ANY (v_approved_docs));

    IF array_length(v_missing, 1) > 0 THEN
      RETURN jsonb_build_object(
        'outcome', 'missing_documents',
        'missing', to_jsonb(v_missing)
      );
    END IF;
  END IF;

  ---------------------------------------------------------------------------
  -- The authoritative transition: application status.
  ---------------------------------------------------------------------------
  UPDATE public.mentor_applications
  SET status           = 'approved',
      reviewed_at      = NOW(),
      reviewed_by      = p_admin_user_id,
      rejection_reason = NULL,
      updated_at       = NOW()
  WHERE id = v_app.id
  RETURNING * INTO v_app;

  ---------------------------------------------------------------------------
  -- Mentor role. The `seeker` row is deliberately NOT removed: holding both
  -- roles is harmless to every check in this codebase, and deleting a role is
  -- not something an approval click should do.
  ---------------------------------------------------------------------------
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_app.user_id, 'mentor')
  ON CONFLICT (user_id, role) DO NOTHING;

  ---------------------------------------------------------------------------
  -- Synchronise MENTOR PROFILE APPROVAL + the discovery switch. This is the
  -- write whose absence produced the reported contradiction.
  --
  -- On conflict ONLY the approval fields are touched. The previous route
  -- upserted headline/about/experience_years/languages/rating as well, which
  -- overwrote a mentor's real profile content with the application bio and
  -- reset their rating - destructive, and not required by the lifecycle.
  ---------------------------------------------------------------------------
  INSERT INTO public.mentor_profiles
    (id, headline, about, experience_years, languages,
     rating, review_count, session_count,
     is_approved, is_featured, approval_status, is_active,
     created_at, updated_at)
  VALUES
    (v_app.user_id,
     COALESCE(NULLIF(v_app.headline, ''), v_app.full_name),
     COALESCE(v_app.bio, ''),
     COALESCE(v_app.years_of_experience, 0),
     ARRAY['English', 'Hindi'],
     5.00, 0, 0,
     TRUE, FALSE, 'approved', TRUE,
     NOW(), NOW())
  ON CONFLICT (id) DO UPDATE
  SET approval_status = 'approved',
      is_approved     = TRUE,
      is_active       = TRUE,
      updated_at      = NOW();

  ---------------------------------------------------------------------------
  -- Audit, inside the transaction: an approval that rolled back must leave no
  -- audit trail claiming it happened.
  ---------------------------------------------------------------------------
  PERFORM public._log_mentor_app_audit(
    v_app.id, 'approved', p_admin_user_id, NULL,
    jsonb_build_object('years_of_experience', v_app.years_of_experience));

  ---------------------------------------------------------------------------
  -- Notification. Deliberately isolated in a sub-block: losing a notification
  -- must not undo an approval that has already been decided and audited. This
  -- is the existing rule, preserved.
  ---------------------------------------------------------------------------
  BEGIN
    INSERT INTO public.notifications
      (user_id, title, message, type, event_type, entity_type, entity_id, link)
    VALUES
      (v_app.user_id,
       'Mentor Application Approved',
       'Congratulations! Your mentor application has been approved. You can now complete your mentor profile and configure your availability.',
       'SYSTEM',
       'MENTOR_APPLICATION_APPROVED',
       'mentor_application',
       v_app.id,
       '/mentor');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'outcome', 'approved',
    'application_id', v_app.id,
    'application_status', v_app.status,
    'mentor_user_id', v_app.user_id,
    'approval_status', 'approved',
    'is_approved', TRUE,
    'is_active', TRUE
  );
END;
$fn$;

COMMENT ON FUNCTION public.approve_mentor_application(UUID, UUID) IS
  'Atomically approves a pending_review mentor application and synchronises the mentor profile (approval_status/is_approved/is_active) in the same transaction. Authorises p_admin_user_id against user_roles. Returns a structured outcome: approved | forbidden | not_found | not_pending_review | missing_documents. Never returns early for an already-approved application, so drifted state stays repairable.';

-- ===========================================================================
-- 2. ATOMIC REJECTION - same transaction, same lock, same authorisation
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.reject_mentor_application(
  p_application_id     UUID,
  p_rejection_reason   TEXT,
  p_admin_user_id      UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_app public.mentor_applications;
BEGIN
  IF p_admin_user_id IS NULL
     OR NOT EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = p_admin_user_id AND ur.role = 'admin'
        )
  THEN
    RETURN jsonb_build_object('outcome', 'forbidden');
  END IF;

  IF COALESCE(btrim(p_rejection_reason), '') = '' THEN
    RETURN jsonb_build_object('outcome', 'reason_required');
  END IF;

  SELECT * INTO v_app
  FROM public.mentor_applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  -- A rejected application carries no mentor profile and no role. Overwriting
  -- an already-decided application is a conflict, never a second decision.
  IF v_app.status <> 'pending_review' THEN
    RETURN jsonb_build_object(
      'outcome', 'not_pending_review',
      'current_status', v_app.status
    );
  END IF;

  UPDATE public.mentor_applications
  SET status           = 'rejected',
      reviewed_at      = NOW(),
      reviewed_by      = p_admin_user_id,
      rejection_reason = btrim(p_rejection_reason),
      updated_at       = NOW()
  WHERE id = v_app.id
  RETURNING * INTO v_app;

  PERFORM public._log_mentor_app_audit(
    v_app.id, 'rejected', p_admin_user_id, btrim(p_rejection_reason), '{}'::jsonb);

  BEGIN
    INSERT INTO public.notifications
      (user_id, title, message, type, event_type, entity_type, entity_id, link)
    VALUES
      (v_app.user_id,
       'Mentor Application Needs Changes',
       'Your mentor application needs changes: ' || btrim(p_rejection_reason) || '. Please review the Admin feedback and resubmit your verification.',
       'SYSTEM',
       'MENTOR_APPLICATION_REJECTED',
       'mentor_application',
       v_app.id,
       '/mentor/verification');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'outcome', 'rejected',
    'application_id', v_app.id,
    'application_status', v_app.status,
    'mentor_user_id', v_app.user_id
  );
END;
$fn$;

COMMENT ON FUNCTION public.reject_mentor_application(UUID, TEXT, UUID) IS
  'Atomically rejects a pending_review mentor application with its audit row and notification. Outcomes: rejected | forbidden | reason_required | not_found | not_pending_review.';

-- ===========================================================================
-- 3. ATOMIC DOCUMENT REVIEW
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.review_mentor_document(
  p_document_id     UUID,
  p_status          TEXT,
  p_admin_note      TEXT,
  p_admin_user_id   UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_doc       public.mentor_verification_documents;
  v_app_id    UUID;
BEGIN
  IF p_admin_user_id IS NULL
     OR NOT EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = p_admin_user_id AND ur.role = 'admin'
        )
  THEN
    RETURN jsonb_build_object('outcome', 'forbidden');
  END IF;

  -- The document vocabulary is pending | approved | rejected. `pending_review`
  -- is the APPLICATION's word and must never reach a document row.
  IF p_status NOT IN ('approved', 'rejected') THEN
    RETURN jsonb_build_object('outcome', 'invalid_status');
  END IF;

  SELECT * INTO v_doc
  FROM public.mentor_verification_documents
  WHERE id = p_document_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  v_app_id := v_doc.application_id;

  -- A document is reviewable once. The predicate lives under the row lock, so
  -- two admins clicking Approve on the same document produce one decision and
  -- one conflict.
  IF v_doc.status <> 'pending' THEN
    RETURN jsonb_build_object(
      'outcome', 'already_reviewed',
      'current_status', v_doc.status
    );
  END IF;

  UPDATE public.mentor_verification_documents
  SET status      = p_status,
      admin_note  = p_admin_note,
      reviewed_at = NOW(),
      reviewed_by = p_admin_user_id,
      updated_at  = NOW()
  WHERE id = p_document_id
  RETURNING * INTO v_doc;

  PERFORM public._log_mentor_app_audit(
    v_app_id, 'document_reviewed', p_admin_user_id, p_admin_note,
    jsonb_build_object(
      'document_id',   v_doc.id,
      'document_type', v_doc.document_type,
      'status',        p_status));

  RETURN jsonb_build_object(
    'outcome', 'reviewed',
    'document_id', v_doc.id,
    'application_id', v_app_id,
    'document_type', v_doc.document_type,
    'status', v_doc.status
  );
END;
$fn$;

COMMENT ON FUNCTION public.review_mentor_document(UUID, TEXT, TEXT, UUID) IS
  'Atomically records one admin decision on a pending verification document with its audit row. Outcomes: reviewed | forbidden | invalid_status | not_found | already_reviewed.';

-- ===========================================================================
-- 4. CANONICAL DISCOVERY READINESS
-- ===========================================================================
--
-- The mentor Control Center used to re-derive these six rules in React from the
-- detail payload. That is a second copy of a business rule that the database
-- already owns, and the two can disagree. This function is the single
-- calculation; the API returns it and the page renders it verbatim.
--
-- Note what it does NOT say: approval alone is never enough. `isDiscoverable`
-- is delegated to the existing `is_mentor_discoverable()`, which additionally
-- requires an active gig.

CREATE OR REPLACE FUNCTION public.mentor_discovery_readiness(p_mentor_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row            public.mentor_profiles;
  v_account_status TEXT;
  v_deactivated_at TIMESTAMPTZ;
  v_approved       BOOLEAN := FALSE;
  v_legacy_ok      BOOLEAN := FALSE;
  v_active         BOOLEAN := FALSE;
  v_segment        BOOLEAN := FALSE;
  v_gig            BOOLEAN := FALSE;
  v_availability   BOOLEAN := FALSE;
  v_suspended      BOOLEAN := FALSE;
  v_deactivated   BOOLEAN := FALSE;
BEGIN
  IF p_mentor_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not_found', 'mentorId', NULL);
  END IF;

  SELECT * INTO v_row
  FROM public.mentor_profiles
  WHERE id = p_mentor_id;

  SELECT account_status, deactivated_at INTO v_account_status, v_deactivated_at
  FROM public.profiles
  WHERE id = p_mentor_id;

  v_deactivated := (v_account_status = 'deactivated')
                   OR (v_deactivated_at IS NOT NULL);
  v_suspended := public.is_account_suspended(p_mentor_id) OR v_deactivated;

  IF v_row.id IS NOT NULL THEN
    -- `approval_status` is the authoritative approval state. The legacy
    -- `is_approved` boolean is NOT a second source: it only has to agree,
    -- because the database's own visibility functions require both columns, so
    -- a row where they disagree would silently be undiscoverable. The
    -- disagreement itself is reported as `approvalStatusConsistent=false` so the
    -- Control Center can show it rather than hide it.
    v_legacy_ok := COALESCE(v_row.is_approved, FALSE);
    v_approved  := (v_row.approval_status = 'approved') AND v_legacy_ok;
    v_active    := v_row.is_active;
  END IF;

  -- "Eligible" means a segment that is itself active: membership in a retired
  -- segment does not make a mentor discoverable.
  SELECT EXISTS (
    SELECT 1
    FROM public.mentor_segments ms
    JOIN public.segments s ON s.id = ms.segment_id
    WHERE ms.mentor_id = p_mentor_id
      AND s.is_active = TRUE
  ) INTO v_segment;

  SELECT EXISTS (
    SELECT 1 FROM public.gigs g
    WHERE g.mentor_id = p_mentor_id AND g.is_active = TRUE
  ) INTO v_gig;

  SELECT EXISTS (
    SELECT 1 FROM public.mentor_availability a
    WHERE a.mentor_id = p_mentor_id AND a.is_enabled = TRUE
  ) INTO v_availability;

  RETURN jsonb_build_object(
    'outcome', 'ok',
    'mentorId', p_mentor_id,
    'hasMentorProfile', v_row.id IS NOT NULL,
    'checks', jsonb_build_object(
      'approved', v_approved,
      'active', v_active,
      'notSuspended', NOT v_suspended,
      'hasEligibleSegment', v_segment,
      'hasActiveGig', v_gig,
      'hasRecurringAvailability', v_availability
    ),
    -- Raw authoritative columns, so a consumer never has to infer approval from
    -- a boolean. `approvalStatus` is the source of truth; `isApprovedLegacy` is
    -- reported only so an inconsistency is visible instead of silent.
    'approvalStatus', v_row.approval_status,
    'isApprovedLegacy', v_legacy_ok,
    'isActive', v_active,
    'accountStatus', COALESCE(v_account_status, 'active'),
    'approvalStatusConsistent',
      COALESCE(
        (v_row.id IS NOT NULL)
        AND ((v_row.approval_status = 'approved') = v_legacy_ok),
        FALSE),
    -- The authoritative answers, delegated to the functions the RLS policies
    -- and seeker discovery already use.
    'isPubliclyVisible', public.mentor_is_publicly_visible(p_mentor_id),
    'isDiscoverable', public.is_mentor_discoverable(p_mentor_id)
  );
END;
$fn$;

COMMENT ON FUNCTION public.mentor_discovery_readiness(UUID) IS
  'Single database-authoritative calculation of mentor discovery readiness: approval, active switch, suspension/deactivation, eligible segment, active gig and recurring availability, plus the delegated is_mentor_discoverable()/mentor_is_publicly_visible() answers. approvalStatus is the authoritative approval state; isApprovedLegacy is reported only so a disagreement is visible. Approved does NOT imply discoverable.';

-- ===========================================================================
-- 5. DROP THE SUPERSEDED SIGNATURES
-- ===========================================================================
--
-- They gated on auth.uid(), which is NULL on the service-role client, so they
-- could never authorise an API-driven approval. Their bodies are replaced
-- above. Only service_role held EXECUTE, and nothing calls them.

DROP FUNCTION IF EXISTS public.approve_mentor_application(UUID);
DROP FUNCTION IF EXISTS public.reject_mentor_application(UUID, TEXT);
DROP FUNCTION IF EXISTS public.review_mentor_document(UUID, TEXT, TEXT);

-- ===========================================================================
-- 6. EXECUTE CONTAINMENT
-- ===========================================================================
--
-- Unchanged policy: these functions read mentor verification state and, for the
-- approval functions, WRITE it. They are callable only by the service role,
-- which is the API. No anon/authenticated client can approve an application,
-- review a document, or probe a mentor's readiness. Same posture as Phase 29.

REVOKE ALL ON FUNCTION public.approve_mentor_application(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_mentor_application(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.review_mentor_document(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mentor_discovery_readiness(UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.approve_mentor_application(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_mentor_application(UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.review_mentor_document(UUID, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.mentor_discovery_readiness(UUID) TO service_role;

-- ===========================================================================
-- 7. REALTIME PUBLICATION
-- ===========================================================================
--
-- The admin verification and mentor Control Center pages were never
-- realtime-enabled: every required table was missing from `supabase_realtime`,
-- so no amount of client-side subscribing could have worked. Verified against
-- the live publication before writing this migration.
--
--   already published: gigs, mentor_availability, mentor_availability_exceptions,
--                      segments, bookings, slot_holds, payments, ...
--   added here:      mentor_profiles, profiles, mentor_applications,
--                     mentor_verification_documents, mentor_segments
--
-- REPLICA IDENTITY is set ONLY where it is technically required, i.e. only on
-- the tables a subscription filters on a NON-PRIMARY-KEY column. Supabase
-- matches a client filter against the replica identity, so a filter on
-- `mentor_id`, `user_id` or `application_id` cannot match UPDATE/DELETE events
-- unless the whole old row is published.
--
--   mentor_profiles                  filter id         -> id IS the PK   -> default is enough
--   profiles                         filter id         -> id IS the PK   -> default is enough
--   mentor_applications              detail page filters id, Control Center filters user_id
--                                                              -> user_id is not the PK -> FULL required
--   mentor_segments                  filter mentor_id  -> not the PK     -> FULL required
--   mentor_verification_documents    filter application_id -> not the PK -> FULL required
--
-- The two hot tables (`profiles`, `mentor_profiles`) deliberately keep the
-- default identity: FULL on those would publish every column of every profile
-- change on every replica. The three tables that do need FULL are all
-- admin-decision tables with one row per applicant/mentor, not hot paths.
--
-- `notifications` is intentionally NOT added: it already has a dedicated
-- realtime hook (useNotificationSync) and would duplicate that subscription.

DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'mentor_profiles',
    'profiles',
    'mentor_applications',
    'mentor_verification_documents',
    'mentor_segments'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_rel pr
      JOIN pg_publication p ON p.oid = pr.prpubid
      JOIN pg_class c ON c.oid = pr.prrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE p.pubname = 'supabase_realtime'
        AND n.nspname = 'public'
        AND c.relname = v_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
    END IF;
  END LOOP;
END;
$$;

-- Filter-on-non-PK tables only. See the reasoning above.
ALTER TABLE public.mentor_applications             REPLICA IDENTITY FULL;
ALTER TABLE public.mentor_segments               REPLICA IDENTITY FULL;
ALTER TABLE public.mentor_verification_documents REPLICA IDENTITY FULL;

-- ===========================================================================
-- 8. REPAIR THE DRIFTED ROWS
-- ===========================================================================
--
-- Applications that are already `approved` but whose mentor profile never
-- reached the same state - exactly the reported incident. This is the repair the
-- product could not perform, because re-approving an approved application is a
-- 409 by design.
--
-- Idempotent: it selects only rows that are actually out of sync, so a fresh
-- environment with no data is a no-op and a re-run repairs nothing twice. It
-- preserves the same minimal-write discipline as the function above: approval
-- fields only, never the mentor's own profile content, and never
-- profiles.account_status.

DO $$
DECLARE
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT a.id AS application_id, a.user_id,
           COALESCE(NULLIF(a.headline, ''), a.full_name) AS headline,
           COALESCE(a.bio, '') AS bio,
           COALESCE(a.years_of_experience, 0) AS years
    FROM public.mentor_applications a
    LEFT JOIN public.mentor_profiles mp ON mp.id = a.user_id
    WHERE a.status = 'approved'
      AND (
        mp.id IS NULL
        OR mp.approval_status IS DISTINCT FROM 'approved'
        OR mp.is_approved IS DISTINCT FROM TRUE
        OR mp.is_active IS DISTINCT FROM TRUE
      )
  LOOP
    -- Only ever INSERTed for an approved applicant who has no mentor profile at
    -- all; for an existing profile the ON CONFLICT branch below touches the
    -- approval fields and nothing else, so the mentor's own headline, about
    -- text and rating are never overwritten.
    INSERT INTO public.mentor_profiles
      (id, headline, about, experience_years, languages,
       rating, review_count, session_count,
       is_approved, is_featured, approval_status, is_active,
       created_at, updated_at)
    VALUES
      (v_row.user_id, COALESCE(v_row.headline, ''), v_row.bio, v_row.years,
       ARRAY['English', 'Hindi'],
       5.00, 0, 0,
       TRUE, FALSE, 'approved', TRUE,
       NOW(), NOW())
    ON CONFLICT (id) DO UPDATE
    SET approval_status = 'approved',
        is_approved     = TRUE,
        is_active       = TRUE,
        updated_at      = NOW();

    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_row.user_id, 'mentor')
    ON CONFLICT (user_id, role) DO NOTHING;

    PERFORM public._log_mentor_app_audit(
      v_row.application_id, 'approved', NULL, NULL,
      jsonb_build_object('repaired', TRUE, 'reason', 'mentor_profile_state_synchronised'));

    INSERT INTO public.audit_logs
      (actor_user_id, actor_role, action, entity_type, entity_id, metadata)
    VALUES
      (NULL, 'system', 'mentor_application_state_synchronised',
       'mentor_application', v_row.application_id::TEXT,
       jsonb_build_object(
         'mentorId', v_row.user_id,
         'reason', 'Approved application had no matching mentor profile approval state.'));
  END LOOP;
END;
$$;

-- ===========================================================================
-- 9. RELOAD THE POSTGREST SCHEMA CACHE + PROVE THE CONTAINMENT HELD
-- ===========================================================================
--
-- This migration DROPS three functions and adds three with new signatures, so
-- PostgREST's cached schema is stale until it is told. Without this the API's
-- first `.rpc('approve_mentor_application', ...)` after deploy fails with a
-- "function not found in the schema cache" error. NOTIFY is harmless when
-- pgrst is absent.
--
-- Phase 29 revoked EXECUTE from PUBLIC on every pre-existing SECURITY DEFINER
-- function. Postgres re-grants EXECUTE to PUBLIC on every NEW function, so this
-- migration must re-assert containment AND verify it took effect. A silent
-- regression here would expose mentor verification writes to an anonymous
-- client, so the check raises rather than warns.

DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN OTHERS THEN
  NULL;  -- harmless when pgrst is absent
END $$;

-- Phase 29 revoked EXECUTE from PUBLIC on every pre-existing SECURITY DEFINER
-- function, but Postgres re-grants EXECUTE to PUBLIC on every NEW function. The
-- REVOKEs above re-assert containment; this proves they took effect, because a
-- silent regression would expose mentor verification WRITES to an anonymous
-- client. It raises rather than warns.
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
      'review_mentor_document', 'mentor_discovery_readiness'
    )
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'Phase 44 containment failed: anon still has EXECUTE on %', v_leaked;
  END IF;
END $$;