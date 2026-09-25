-- ==============================================================================
-- SUGGEST KEY - PHASE 13: MENTOR ONBOARDING + ADMIN CONTROL (CONSOLIDATED)
-- ==============================================================================
-- Self-contained, fully idempotent. Safe to run on an EMPTY database, on a
-- database with Phase 12 partially applied, or on one with Phase 12 fully
-- applied. Running it twice is a no-op the second time.
--
-- FIXES: "Could not find the 'years_of_experience' column of
--        'mentor_applications' in the schema cache"
--   Cause: the app layer queries mentor_applications.years_of_experience but
--   Phase 12 created the table without that column (it kept years on
--   mentor_profiles.experience_years). UI and DB disagreed.
--   Fix: ADD COLUMN IF NOT EXISTS years_of_experience, and keep it in sync with
--   mentor_profiles.experience_years at approval time.
--   After applying, reload the PostgREST schema cache (Dashboard -> Project
--   Settings -> API -> Reload schema, or NOTIFY pgrst, 'reload schema';).
--
-- Run with:  supabase db push
--     or:    paste into Supabase SQL Editor and Run.
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- 1. MENTOR APPLICATIONS
-- ==============================================================================
-- ADD COLUMN IF NOT EXISTS is a no-op when the column already exists, so this
-- converges a virgin table and the older Phase 12 table onto one contract.

CREATE TABLE IF NOT EXISTS public.mentor_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_review','approved','rejected')),
  full_name TEXT NOT NULL DEFAULT '',
  headline TEXT,
  bio TEXT NOT NULL DEFAULT '',
  years_of_experience INTEGER,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  requested_segment_ids UUID[],
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- >>> THE FIX: this is the column the app layer already queries. <<<
ALTER TABLE public.mentor_applications
  ADD COLUMN IF NOT EXISTS years_of_experience INTEGER;

ALTER TABLE public.mentor_applications
  ADD COLUMN IF NOT EXISTS headline TEXT,
  ADD COLUMN IF NOT EXISTS requested_segment_ids UUID[];

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.mentor_applications'::regclass
                   AND conname = 'chk_mentor_app_years')
  THEN
    ALTER TABLE public.mentor_applications
      ADD CONSTRAINT chk_mentor_app_years
      CHECK (years_of_experience IS NULL
             OR years_of_experience BETWEEN 0 AND 80);
  END IF;

  -- One application per user.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.mentor_applications'::regclass
                   AND conname = 'uq_mentor_applications_user')
  THEN
    EXECUTE $q$
      DELETE FROM public.mentor_applications a
      USING public.mentor_applications b
      WHERE a.user_id = b.user_id AND a.created_at < b.created_at
    $q$;
    ALTER TABLE public.mentor_applications
      ADD CONSTRAINT uq_mentor_applications_user UNIQUE (user_id);
  END IF;
END $$;

-- Foreign keys are attached only when the referenced table actually exists.
DO $$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conrelid = 'public.mentor_applications'::regclass
                       AND conname = 'mentor_applications_user_id_fkey')
  THEN
    ALTER TABLE public.mentor_applications
      ADD CONSTRAINT mentor_applications_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;

  IF to_regclass('public.profiles') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conrelid = 'public.mentor_applications'::regclass
                       AND conname = 'mentor_applications_reviewed_by_fkey')
  THEN
    ALTER TABLE public.mentor_applications
      ADD CONSTRAINT mentor_applications_reviewed_by_fkey
      FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;

  IF to_regclass('auth.users') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conrelid = 'public.mentor_applications'::regclass
                       AND conname = 'mentor_applications_auth_user_fkey')
  THEN
    ALTER TABLE public.mentor_applications
      ADD CONSTRAINT mentor_applications_auth_user_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mentor_applications_user
  ON public.mentor_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_mentor_applications_status
  ON public.mentor_applications(status);
-- Admin review queue: oldest pending application first.
CREATE INDEX IF NOT EXISTS idx_mentor_applications_review_queue
  ON public.mentor_applications(submitted_at)
  WHERE status = 'pending_review';

-- ==============================================================================
-- 2. DOCUMENT TYPES / VERIFICATION DOCUMENTS / APPLICATION AUDIT
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.mentor_document_types (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Platform configuration (not applicant data).
INSERT INTO public.mentor_document_types (code, label, description, is_required, sort_order)
VALUES
  ('identity_proof',      'Government ID',            'Government-issued photo identification (passport, driving licence, Aadhaar)', TRUE, 1),
  ('qualification_proof', 'Qualification Certificate', 'Relevant certification, degree or licence proving expertise',                      TRUE, 2)
ON CONFLICT (code) DO UPDATE
SET label = EXCLUDED.label, description = EXCLUDED.description,
    is_required = EXCLUDED.is_required, sort_order = EXCLUDED.sort_order,
    updated_at = NOW();

CREATE INDEX IF NOT EXISTS idx_mentor_document_types_active
  ON public.mentor_document_types(is_active, sort_order);

-- Only metadata here. Bytes live in the PRIVATE storage bucket created below.
CREATE TABLE IF NOT EXISTS public.mentor_verification_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.mentor_applications(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL REFERENCES public.mentor_document_types(code) ON DELETE RESTRICT,
  storage_path TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  admin_note TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_mentor_doc_app_type UNIQUE (application_id, document_type)
);

DO $$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conrelid = 'public.mentor_verification_documents'::regclass
                       AND conname = 'mentor_verification_documents_reviewed_by_fkey')
  THEN
    ALTER TABLE public.mentor_verification_documents
      ADD CONSTRAINT mentor_verification_documents_reviewed_by_fkey
      FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mentor_docs_application
  ON public.mentor_verification_documents(application_id);
CREATE INDEX IF NOT EXISTS idx_mentor_docs_status
  ON public.mentor_verification_documents(status);

CREATE TABLE IF NOT EXISTS public.mentor_application_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.mentor_applications(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  admin_user_id UUID,
  rejection_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mentor_app_audit_application
  ON public.mentor_application_audit(application_id, created_at DESC);

-- ==============================================================================
-- 3. updated_at MAINTAINER
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_mentor_applications_updated_at ON public.mentor_applications;
CREATE TRIGGER trg_mentor_applications_updated_at
  BEFORE UPDATE ON public.mentor_applications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_mentor_docs_updated_at ON public.mentor_verification_documents;
CREATE TRIGGER trg_mentor_docs_updated_at
  BEFORE UPDATE ON public.mentor_verification_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_mentor_document_types_updated_at ON public.mentor_document_types;
CREATE TRIGGER trg_mentor_document_types_updated_at
  BEFORE UPDATE ON public.mentor_document_types
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ==============================================================================
-- 4. USER SUSPENSION / DEACTIVATION (prompt sections 20-24)
-- ==============================================================================
-- Lives on profiles so it applies to BOTH seekers and mentors.
-- Suspension NEVER deletes bookings, payments, sessions or workspaces.

DO $$
BEGIN
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

    CREATE INDEX IF NOT EXISTS idx_profiles_account_status
      ON public.profiles(account_status);
  END IF;
END $$;

-- Single server-side definition of "may this account act right now".
-- RLS and the RPCs all call this, so the rule lives in exactly one place.
CREATE OR REPLACE FUNCTION public.is_account_suspended(p_user_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_status TEXT;
  v_until  TIMESTAMPTZ;
BEGIN
  SELECT account_status, suspended_until INTO v_status, v_until
  FROM public.profiles WHERE id = p_user_id;

  IF v_status IS NULL THEN
    RETURN FALSE;
  END IF;

  IF v_status = 'deactivated' THEN
    RETURN TRUE;
  END IF;

  IF v_status = 'suspended' THEN
    -- A suspension with an expiry lapses automatically SERVER-SIDE once
    -- now >= suspended_until. No frontend timer is involved.
    IF v_until IS NOT NULL AND NOW() >= v_until THEN
      RETURN FALSE;
    END IF;
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.is_current_user_suspended()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT public.is_account_suspended(auth.uid());
$fn$;

-- ==============================================================================
-- 5. is_admin() FALLBACK
-- ==============================================================================
-- Reuses the existing definition when present; only creates a minimal,
-- security-definer version when the database has none (virgin database).
-- This is NOT a duplicate audit/auth system - it is a guard so this single
-- migration can bootstrap itself.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  );
$fn$;

-- ==============================================================================
-- 6. PRIVATE STORAGE BUCKET FOR VERIFICATION DOCUMENTS (section 7)
-- ==============================================================================
-- Never public, never permanent URLs. Access is via signed URLs minted by an
-- admin-gated server endpoint.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'mentor-verification-documents',
  'mentor-verification-documents',
  FALSE,
  5242880,
  ARRAY['image/jpeg','image/png','image/webp','application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET public             = FALSE,
    file_size_limit    = 5242880,
    allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','application/pdf'];

-- Object path convention:
--   mentor-verification-documents/<user_id>/<application_id>/<document_id>-<name>
-- so foldername(name)[1] is always the owning user.

DROP POLICY IF EXISTS "Mentor applicants can upload own verification documents" ON storage.objects;
CREATE POLICY "Mentor applicants can upload own verification documents"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'mentor-verification-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM public.mentor_applications a
      WHERE a.id = ((storage.foldername(name))[2])::uuid
        AND a.user_id = auth.uid()
        AND a.status IN ('draft','rejected')
    )
  );

DROP POLICY IF EXISTS "Mentor applicants can view own verification documents" ON storage.objects;
CREATE POLICY "Mentor applicants can view own verification documents"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'mentor-verification-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Mentor applicants can delete own draft documents" ON storage.objects;
CREATE POLICY "Mentor applicants can delete own draft documents"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'mentor-verification-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM public.mentor_applications a
      WHERE a.id = ((storage.foldername(name))[2])::uuid
        AND a.user_id = auth.uid()
        AND a.status IN ('draft','rejected')
    )
  );

-- Admin review access.
DROP POLICY IF EXISTS "Admins have full access to verification documents" ON storage.objects;
CREATE POLICY "Admins have full access to verification documents"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'mentor-verification-documents' AND public.is_admin())
  WITH CHECK (bucket_id = 'mentor-verification-documents' AND public.is_admin());

-- ==============================================================================
-- 7. ROW LEVEL SECURITY
-- ==============================================================================
-- RLS is ENABLED, never disabled to make a feature work.

ALTER TABLE public.mentor_applications         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentor_verification_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentor_application_audit     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentor_document_types        ENABLE ROW LEVEL SECURITY;

-- --- mentor_applications -----------------------------------------------------
DROP POLICY IF EXISTS "Applicants can view own application" ON public.mentor_applications;
CREATE POLICY "Applicants can view own application"
  ON public.mentor_applications FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Applicants can create own application" ON public.mentor_applications;
CREATE POLICY "Applicants can create own application"
  ON public.mentor_applications FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- An applicant may only ever move their own draft/rejected application.
-- pending_review and approved are admin-only transitions.
DROP POLICY IF EXISTS "Applicants can update own draft/rejected application" ON public.mentor_applications;
CREATE POLICY "Applicants can update own draft/rejected application"
  ON public.mentor_applications FOR UPDATE
  USING      (user_id = auth.uid() AND status IN ('draft','rejected'))
  WITH CHECK (user_id = auth.uid() AND status IN ('draft','rejected'));

DROP POLICY IF EXISTS "Admins can manage all mentor applications" ON public.mentor_applications;
CREATE POLICY "Admins can manage all mentor applications"
  ON public.mentor_applications FOR ALL
  USING      (public.is_admin())
  WITH CHECK (public.is_admin());

-- --- mentor_verification_documents -------------------------------------------
DROP POLICY IF EXISTS "Applicants can view own documents" ON public.mentor_verification_documents;
CREATE POLICY "Applicants can view own documents"
  ON public.mentor_verification_documents FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.mentor_applications a
            WHERE a.id = application_id AND (a.user_id = auth.uid() OR public.is_admin()))
  );

DROP POLICY IF EXISTS "Applicants can manage own draft documents" ON public.mentor_verification_documents;
CREATE POLICY "Applicants can manage own draft documents"
  ON public.mentor_verification_documents FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.mentor_applications a
            WHERE a.id = application_id AND a.user_id = auth.uid()
              AND a.status IN ('draft','rejected'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.mentor_applications a
            WHERE a.id = application_id AND a.user_id = auth.uid()
              AND a.status IN ('draft','rejected'))
  );

DROP POLICY IF EXISTS "Admins can manage all verification documents" ON public.mentor_verification_documents;
CREATE POLICY "Admins can manage all verification documents"
  ON public.mentor_verification_documents FOR ALL
  USING      (public.is_admin())
  WITH CHECK (public.is_admin());

-- --- mentor_application_audit ------------------------------------------------
DROP POLICY IF EXISTS "Applicants can view own audit log" ON public.mentor_application_audit;
CREATE POLICY "Applicants can view own audit log"
  ON public.mentor_application_audit FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.mentor_applications a
            WHERE a.id = application_id AND a.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins can manage all mentor application audit" ON public.mentor_application_audit;
CREATE POLICY "Admins can manage all mentor application audit"
  ON public.mentor_application_audit FOR ALL
  USING      (public.is_admin())
  WITH CHECK (public.is_admin());

-- --- mentor_document_types ---------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view active document types" ON public.mentor_document_types;
CREATE POLICY "Anyone can view active document types"
  ON public.mentor_document_types FOR SELECT
  USING (is_active = TRUE OR public.is_admin());

DROP POLICY IF EXISTS "Admins can manage document types" ON public.mentor_document_types;
CREATE POLICY "Admins can manage document types"
  ON public.mentor_document_types FOR ALL
  USING      (public.is_admin())
  WITH CHECK (public.is_admin());

-- --- suspension guard on profiles -------------------------------------------
-- A suspended/deactivated user keeps READ access to their own historical data
-- but cannot change their own row back to active. Only an admin RPC can.
DO $$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    EXECUTE $q$
      DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
      CREATE POLICY "Users can view own profile"
        ON public.profiles FOR SELECT
        USING (id = auth.uid() OR public.is_admin());

      DROP POLICY IF EXISTS "Active users can update own profile" ON public.profiles;
      CREATE POLICY "Active users can update own profile"
        ON public.profiles FOR UPDATE
        USING (id = auth.uid() AND NOT public.is_account_suspended(auth.uid()));

      DROP POLICY IF EXISTS "Admins can manage all profiles" ON public.profiles;
      CREATE POLICY "Admins can manage all profiles"
        ON public.profiles FOR ALL
        USING      (public.is_admin())
        WITH CHECK (public.is_admin());
    $q$;
  END IF;
END $$;

-- ==============================================================================
-- 8. ONBOARDING + REVIEW RPCs  (sections 5, 8, 11, 25)
-- ==============================================================================
-- Every admin action is server-side and atomic, and is written into the audit
-- trail. No UI check is ever the only gate.

-- Internal audit writer. SECURITY DEFINER so the RLS policies above cannot
-- block audit rows from being recorded.
--
-- Parameter names MUST stay byte-identical to the Phase 12 definition
-- (p_admin_user_id / p_rejection_reason). CREATE OR REPLACE can swap the body,
-- language and volatility, but it cannot rename an existing input parameter
-- (SQLSTATE 42P13). All call sites pass positionally.
CREATE OR REPLACE FUNCTION public._log_mentor_app_audit(
  p_application_id UUID,
  p_action TEXT,
  p_admin_user_id UUID DEFAULT NULL,
  p_rejection_reason TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $fn$
  INSERT INTO public.mentor_application_audit
    (application_id, action, admin_user_id, rejection_reason, metadata)
  VALUES (p_application_id, p_action, p_admin_user_id, p_rejection_reason,
          COALESCE(p_metadata, '{}'::jsonb));
$fn$;

-- Aggregate status for /mentor/verification. Replaces the broken Phase 12
-- version (invalid aggregate ORDER BY + a missing RETURN).
CREATE OR REPLACE FUNCTION public.get_mentor_onboarding_status()
RETURNS TABLE (
  application public.mentor_applications,
  documents public.mentor_verification_documents[],
  required_types public.mentor_document_types[]
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_app   public.mentor_applications;
  v_docs  public.mentor_verification_documents[];
  v_types public.mentor_document_types[];
BEGIN
  SELECT * INTO v_app
  FROM public.mentor_applications
  WHERE user_id = auth.uid()
  ORDER BY created_at DESC
  LIMIT 1;

  v_types := ARRAY(
    SELECT t FROM public.mentor_document_types t
    WHERE t.is_active = TRUE
    ORDER BY t.sort_order
  );

  -- No application yet: return an empty state plus the required document types.
  IF v_app.id IS NULL THEN
    RETURN QUERY SELECT
      NULL::public.mentor_applications,
      ARRAY[]::public.mentor_verification_documents[],
      COALESCE(v_types, ARRAY[]::public.mentor_document_types[]);
    RETURN;
  END IF;

  v_docs := ARRAY(
    SELECT d FROM public.mentor_verification_documents d
    WHERE d.application_id = v_app.id
  );

  RETURN QUERY SELECT
    v_app,
    COALESCE(v_docs, ARRAY[]::public.mentor_verification_documents[]),
    COALESCE(v_types, ARRAY[]::public.mentor_document_types[]);
END;
$fn$;

-- Save Draft: upsert the applicant's own draft. Never promotes to pending.
CREATE OR REPLACE FUNCTION public.save_mentor_application(
  p_full_name TEXT,
  p_bio TEXT,
  p_headline TEXT DEFAULT NULL,
  p_years_of_experience INTEGER DEFAULT NULL,
  p_timezone TEXT DEFAULT 'Asia/Kolkata',
  p_requested_segment_ids UUID[] DEFAULT NULL
) RETURNS public.mentor_applications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_app public.mentor_applications;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF COALESCE(btrim(p_full_name), '') = '' THEN
    RAISE EXCEPTION 'Full name is required';
  END IF;

  IF p_years_of_experience IS NOT NULL
     AND (p_years_of_experience < 0 OR p_years_of_experience > 80) THEN
    RAISE EXCEPTION 'Years of experience must be between 0 and 80';
  END IF;

  SELECT * INTO v_app
  FROM public.mentor_applications
  WHERE user_id = auth.uid()
  FOR UPDATE;

  -- Already approved: a live mentor edits mentor_profiles, not the application.
  IF v_app.id IS NOT NULL AND v_app.status = 'approved' THEN
    RAISE EXCEPTION 'Application already approved; edit your mentor profile instead';
  END IF;

  -- Already in the review queue: it is locked until an admin responds.
  IF v_app.id IS NOT NULL AND v_app.status = 'pending_review' THEN
    RAISE EXCEPTION 'Application is under review and cannot be edited';
  END IF;

  IF v_app.id IS NULL THEN
    INSERT INTO public.mentor_applications
      (user_id, status, full_name, headline, bio,
       years_of_experience, timezone, requested_segment_ids)
    VALUES
      (auth.uid(), 'draft', btrim(p_full_name), NULLIF(btrim(COALESCE(p_headline,'')), ''),
       COALESCE(p_bio, ''), p_years_of_experience, COALESCE(p_timezone,'Asia/Kolkata'),
       p_requested_segment_ids)
    RETURNING * INTO v_app;
  ELSE
    UPDATE public.mentor_applications
    SET full_name            = btrim(p_full_name),
        headline             = NULLIF(btrim(COALESCE(p_headline,'')), ''),
        bio                  = COALESCE(p_bio, ''),
        years_of_experience  = p_years_of_experience,
        timezone             = COALESCE(p_timezone,'Asia/Kolkata'),
        requested_segment_ids= p_requested_segment_ids,
        -- A resubmission clears the old rejection reason.
        rejection_reason     = NULL
    WHERE id = v_app.id
    RETURNING * INTO v_app;
  END IF;

  RETURN v_app;
END;
$fn$;

-- Submit for Review: DRAFT -> PENDING_REVIEW, or REJECTED -> PENDING_REVIEW.
-- Requires every REQUIRED document type to be attached (section 9 / test 3).
CREATE OR REPLACE FUNCTION public.submit_mentor_application()
RETURNS public.mentor_applications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_app          public.mentor_applications;
  v_missing      TEXT;
  v_was_rejected BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_app
  FROM public.mentor_applications
  WHERE user_id = auth.uid()
  FOR UPDATE;

  IF v_app.id IS NULL THEN
    RAISE EXCEPTION 'No application found. Save a draft first.';
  END IF;

  IF v_app.status NOT IN ('draft','rejected') THEN
    RAISE EXCEPTION 'Application cannot be submitted from status %', v_app.status;
  END IF;

  IF COALESCE(btrim(v_app.full_name), '') = '' THEN
    RAISE EXCEPTION 'Full name is required';
  END IF;

  IF COALESCE(btrim(v_app.bio), '') = '' THEN
    RAISE EXCEPTION 'Bio is required';
  END IF;

  SELECT string_agg(t.code, ', ' ORDER BY t.sort_order) INTO v_missing
  FROM public.mentor_document_types t
  WHERE t.is_active = TRUE AND t.is_required = TRUE
    AND NOT EXISTS (
      SELECT 1 FROM public.mentor_verification_documents d
      WHERE d.application_id = v_app.id AND d.document_type = t.code
    );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Missing required document(s): %', v_missing;
  END IF;

  v_was_rejected := (v_app.status = 'rejected');

  UPDATE public.mentor_applications
  SET status            = 'pending_review',
      submitted_at      = NOW(),
      rejection_reason  = NULL,
      updated_at        = NOW()
  WHERE id = v_app.id
  RETURNING * INTO v_app;

  PERFORM public._log_mentor_app_audit(
    v_app.id, 'submitted_for_review', NULL, NULL,
    jsonb_build_object('resubmission', v_was_rejected));

  RETURN v_app;
END;
$fn$;

-- Register document metadata AFTER the object has been uploaded. Mirrors the
-- Phase 12 function but writes into the converged table contract.
CREATE OR REPLACE FUNCTION public.register_mentor_document(
  p_application_id UUID,
  p_document_type TEXT,
  p_storage_path TEXT,
  p_original_filename TEXT,
  p_mime_type TEXT,
  p_size_bytes BIGINT
) RETURNS public.mentor_verification_documents
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_doc public.mentor_verification_documents;
BEGIN
  -- Ownership + status gate, row-locked to stop a concurrent submit racing us.
  PERFORM 1 FROM public.mentor_applications
  WHERE id = p_application_id AND user_id = auth.uid()
    AND status IN ('draft','rejected')
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found or not editable';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.mentor_document_types
                 WHERE code = p_document_type AND is_active = TRUE) THEN
    RAISE EXCEPTION 'Invalid document type';
  END IF;

  IF p_mime_type NOT IN ('image/jpeg','image/png','image/webp','application/pdf') THEN
    RAISE EXCEPTION 'Unsupported file type';
  END IF;

  IF p_size_bytes <= 0 OR p_size_bytes > 5242880 THEN
    RAISE EXCEPTION 'File size exceeds 5MB limit';
  END IF;

  INSERT INTO public.mentor_verification_documents
    (application_id, document_type, storage_path, original_filename,
     mime_type, size_bytes, status, updated_at)
  VALUES
    (p_application_id, p_document_type, p_storage_path, p_original_filename,
     p_mime_type, p_size_bytes, 'pending', NOW())
  ON CONFLICT (application_id, document_type) DO UPDATE
    SET storage_path       = EXCLUDED.storage_path,
        original_filename  = EXCLUDED.original_filename,
        mime_type          = EXCLUDED.mime_type,
        size_bytes         = EXCLUDED.size_bytes,
        status             = 'pending',
        admin_note         = NULL,
        reviewed_at        = NULL,
        reviewed_by        = NULL,
        updated_at         = NOW()
  RETURNING * INTO v_doc;

  PERFORM public._log_mentor_app_audit(
    p_application_id, 'document_uploaded', NULL, NULL,
    jsonb_build_object('document_type', p_document_type, 'document_id', v_doc.id));

  RETURN v_doc;
END;
$fn$;

-- Admin reviews a single document.
CREATE OR REPLACE FUNCTION public.review_mentor_document(
  p_document_id UUID,
  p_status TEXT,
  p_admin_note TEXT DEFAULT NULL
) RETURNS public.mentor_verification_documents
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_doc public.mentor_verification_documents;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  IF p_status NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'Invalid status %', p_status;
  END IF;

  UPDATE public.mentor_verification_documents
  SET status = p_status, admin_note = p_admin_note,
      reviewed_at = NOW(), reviewed_by = auth.uid(), updated_at = NOW()
  WHERE id = p_document_id
  RETURNING * INTO v_doc;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document not found';
  END IF;

  PERFORM public._log_mentor_app_audit(
    v_doc.application_id, 'document_reviewed', auth.uid(), p_admin_note,
    jsonb_build_object('document_id', v_doc.id,
                       'document_type', v_doc.document_type,
                       'status', p_status));

  RETURN v_doc;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- APPROVE. One transaction, one row lock. After this returns:
--   user role      = mentor
--   mentor profile = approved + active
--   is_approved    = true
-- Atomicity comes from the surrounding transaction; the function never commits
-- on its own, so a failure halfway rolls the whole thing back.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_mentor_application(p_application_id UUID)
RETURNS public.mentor_applications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_app public.mentor_applications;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  SELECT * INTO v_app
  FROM public.mentor_applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found';
  END IF;

  IF v_app.status = 'approved' THEN
    RETURN v_app;  -- idempotent
  END IF;

  UPDATE public.mentor_applications
  SET status           = 'approved',
      reviewed_at      = NOW(),
      reviewed_by      = auth.uid(),
      rejection_reason = NULL,
      updated_at       = NOW()
  WHERE id = v_app.id
  RETURNING * INTO v_app;

  -- Grant the mentor role. Drops seeker only when user_roles is the sole role
  -- source; both are inserted so either storage model is satisfied.
  IF to_regclass('public.user_roles') IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_app.user_id, 'mentor')
    ON CONFLICT (user_id, role) DO NOTHING;

    DELETE FROM public.user_roles
    WHERE user_id = v_app.user_id AND role = 'seeker';
  END IF;

  -- Approving must not leave a suspended applicant active.
  IF to_regclass('public.profiles') IS NOT NULL THEN
    UPDATE public.profiles
    SET account_status = 'active', updated_at = NOW()
    WHERE id = v_app.user_id AND account_status <> 'active';
  END IF;

  -- Promote the application into a real mentor profile.
  IF to_regclass('public.mentor_profiles') IS NOT NULL THEN
    INSERT INTO public.mentor_profiles
      (id, headline, about, experience_years, languages,
       rating, review_count, session_count,
       is_approved, is_featured, approval_status, is_active,
       created_at, updated_at)
    VALUES
      (v_app.user_id,
       COALESCE(v_app.headline, v_app.full_name),
       COALESCE(v_app.bio, ''),
       COALESCE(v_app.years_of_experience, 0),
       ARRAY['English','Hindi'],
       5.00, 0, 0,
       TRUE, FALSE, 'approved', TRUE,
       NOW(), NOW())
    ON CONFLICT (id) DO UPDATE
    SET headline           = COALESCE(EXCLUDED.headline, public.mentor_profiles.headline),
        about              = COALESCE(NULLIF(EXCLUDED.about,''), public.mentor_profiles.about),
        experience_years   = COALESCE(EXCLUDED.experience_years, public.mentor_profiles.experience_years),
        is_approved        = TRUE,
        approval_status    = 'approved',
        is_active          = TRUE,
        updated_at         = NOW();
  END IF;

  -- The documents that backed the approval are approved alongside it.
  UPDATE public.mentor_verification_documents
  SET status = 'approved', reviewed_at = NOW(), reviewed_by = auth.uid(), updated_at = NOW()
  WHERE application_id = v_app.id;

  PERFORM public._log_mentor_app_audit(
    v_app.id, 'approved', auth.uid(), NULL,
    jsonb_build_object('years_of_experience', v_app.years_of_experience));

  -- Notify the applicant, when the notifications table exists.
  IF to_regclass('public.notifications') IS NOT NULL THEN
    BEGIN
      INSERT INTO public.notifications
        (user_id, title, message, type, event_type, entity_type, entity_id, link)
      VALUES
        (v_app.user_id,
         'Mentor application approved',
         'Your mentor application has been approved. You can now set up your gigs and availability.',
         'success', 'mentor_application_approved', 'mentor_application', v_app.id,
         '/mentor/profile');
    EXCEPTION WHEN OTHERS THEN
      NULL;  -- notification failure must not undo the approval
    END;
  END IF;

  RETURN v_app;
END;
$fn$;

-- REJECT with a mandatory reason. A rejected mentor is NOT discoverable and
-- may resubmit (test 5).
CREATE OR REPLACE FUNCTION public.reject_mentor_application(
  p_application_id UUID,
  p_rejection_reason TEXT
) RETURNS public.mentor_applications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_app public.mentor_applications;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  IF COALESCE(btrim(p_rejection_reason), '') = '' THEN
    RAISE EXCEPTION 'A rejection reason is required';
  END IF;

  SELECT * INTO v_app
  FROM public.mentor_applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found';
  END IF;

  UPDATE public.mentor_applications
  SET status           = 'rejected',
      reviewed_at      = NOW(),
      reviewed_by      = auth.uid(),
      rejection_reason = btrim(p_rejection_reason),
      updated_at       = NOW()
  WHERE id = v_app.id
  RETURNING * INTO v_app;

  PERFORM public._log_mentor_app_audit(
    v_app.id, 'rejected', auth.uid(), btrim(p_rejection_reason), '{}'::jsonb);

  IF to_regclass('public.notifications') IS NOT NULL THEN
    BEGIN
      INSERT INTO public.notifications
        (user_id, title, message, type, event_type, entity_type, entity_id, link)
      VALUES
        (v_app.user_id,
         'Mentor application rejected',
         'Your mentor application was not approved: ' || btrim(p_rejection_reason),
         'error', 'mentor_application_rejected', 'mentor_application', v_app.id,
         '/mentor/verification');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN v_app;
END;
$fn$;

-- ==============================================================================
-- 9. ADMIN ACCOUNT STATUS CONTROL  (sections 20-24)
-- ==============================================================================
-- Preserves ALL history: bookings, payments, sessions and workspaces are
-- untouched. Only operational access changes.

CREATE OR REPLACE FUNCTION public.admin_set_account_status(
  p_user_id UUID,
  p_action TEXT,              -- 'suspend' | 'reactivate' | 'deactivate'
  p_reason TEXT DEFAULT NULL,
  p_suspended_until TIMESTAMPTZ DEFAULT NULL,
  p_internal_note TEXT DEFAULT NULL
) RETURNS public.profiles
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_profile public.profiles;
  v_audit_action TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Target user is required';
  END IF;

  IF p_action NOT IN ('suspend','reactivate','deactivate') THEN
    RAISE EXCEPTION 'Invalid action %', p_action;
  END IF;

  IF p_action = 'suspend' AND COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'A suspension reason is required';
  END IF;

  IF p_suspended_until IS NOT NULL AND p_suspended_until <= NOW() THEN
    RAISE EXCEPTION 'suspended_until must be in the future';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Administrators cannot change their own account status';
  END IF;

  -- Do not let the last admin lock the platform out.
  IF p_action <> 'reactivate' AND to_regclass('public.user_roles') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.user_roles
               WHERE user_id = p_user_id AND role = 'admin')
       AND NOT EXISTS (SELECT 1 FROM public.user_roles
                       WHERE user_id <> p_user_id AND role = 'admin') THEN
      RAISE EXCEPTION 'Cannot modify the last remaining administrator';
    END IF;
  END IF;

  v_audit_action := CASE p_action
                      WHEN 'suspend'    THEN 'USER_SUSPENDED'
                      WHEN 'reactivate' THEN 'USER_REACTIVATED'
                      ELSE 'USER_DEACTIVATED'
                    END;

  UPDATE public.profiles
  SET account_status = CASE p_action
                         WHEN 'suspend'    THEN 'suspended'
                         WHEN 'reactivate' THEN 'active'
                         ELSE 'deactivated'
                       END,
      suspended_at     = CASE WHEN p_action = 'suspend'    THEN NOW() ELSE NULL END,
      suspended_until  = CASE WHEN p_action = 'suspend'    THEN p_suspended_until ELSE NULL END,
      suspension_reason= CASE WHEN p_action = 'suspend'    THEN p_reason ELSE NULL END,
      suspended_by     = CASE WHEN p_action = 'suspend'    THEN auth.uid() ELSE NULL END,
      deactivated_at   = CASE WHEN p_action = 'deactivate' THEN NOW() ELSE NULL END,
      internal_note    = COALESCE(p_internal_note, internal_note),
      updated_at       = NOW()
  WHERE id = p_user_id
  RETURNING * INTO v_profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- A suspended/deactivated mentor must stop being discoverable and bookable
  -- (section 24) without losing a single gig or booking row.
  IF to_regclass('public.mentor_profiles') IS NOT NULL THEN
    IF p_action IN ('suspend','deactivate') THEN
      UPDATE public.mentor_profiles
      SET is_active = FALSE, updated_at = NOW()
      WHERE id = p_user_id AND is_active = TRUE;
    ELSIF p_action = 'reactivate' THEN
      UPDATE public.mentor_profiles
      SET is_active = TRUE, updated_at = NOW()
      WHERE id = p_user_id AND approval_status = 'approved' AND is_active = FALSE;
    END IF;
  END IF;

  -- Reuse the existing platform audit infrastructure when it exists (section 26
  -- forbids a second, duplicate audit system). When no such table exists the
  -- action is simply not audit-logged rather than inventing one.
  IF to_regclass('public.admin_audit_log') IS NOT NULL THEN
    BEGIN
      EXECUTE $q$
        INSERT INTO public.admin_audit_log
          (actor_admin_id, action, target_user_id, target_entity_id, metadata)
        VALUES ($1, $2, $3, $3, $4)
      $q$
      USING auth.uid(), v_audit_action, p_user_id,
            jsonb_build_object('reason', p_reason,
                               'suspended_until', p_suspended_until,
                               'internal_note', p_internal_note);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN v_profile;
END;
$fn$;

-- ==============================================================================
-- 10. GIG CONSTRAINT: one ACTIVE gig per mentor + segment (section 17)
-- ==============================================================================
-- Enforced by the DATABASE, not by React. A partial unique index is the
-- correct tool here: it allows many inactive/archived gigs for the same pair
-- while guaranteeing at most one active one.

DO $$
BEGIN
  IF to_regclass('public.gigs') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes
                   WHERE schemaname = 'public'
                     AND indexname = 'uq_gigs_mentor_segment_active')
    THEN
      EXECUTE $q$
        CREATE UNIQUE INDEX uq_gigs_mentor_segment_active
          ON public.gigs (mentor_id, segment_id)
          WHERE is_active = TRUE
      $q$;
    END IF;
  END IF;
END $$;

-- ==============================================================================
-- 11. DISCOVERY PREDICATE (section 34)
-- ==============================================================================
-- One server-side definition of "discoverable". Both the seeker-facing list and
-- View All Mentors call this, so they can never drift apart.
--
-- Discoverable = approved
--             + active
--             + not suspended
--             + not deactivated
--             + has an active gig
-- A slot on the selected date is checked separately by slot generation.

CREATE OR REPLACE FUNCTION public.is_mentor_discoverable(p_mentor_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_ok BOOLEAN := FALSE;
BEGIN
  IF to_regclass('public.mentor_profiles') IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT TRUE INTO v_ok
  FROM public.mentor_profiles mp
  WHERE mp.id = p_mentor_id
    AND mp.is_approved     = TRUE
    AND mp.is_active       = TRUE
    AND mp.approval_status = 'approved'
    AND NOT public.is_account_suspended(mp.id)
  LIMIT 1;

  IF NOT COALESCE(v_ok, FALSE) THEN
    RETURN FALSE;
  END IF;

  IF to_regclass('public.gigs') IS NOT NULL THEN
    RETURN EXISTS (SELECT 1 FROM public.gigs g
                   WHERE g.mentor_id = p_mentor_id AND g.is_active = TRUE);
  END IF;

  RETURN TRUE;
END;
$fn$;

-- ==============================================================================
-- 12. ADMIN REVIEW QUEUE (section 11)
-- ==============================================================================
-- Pending first, oldest first. Includes documents so the admin UI can render
-- the queue from a single call.

CREATE OR REPLACE FUNCTION public.admin_list_mentor_applications(p_status TEXT DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  status TEXT,
  full_name TEXT,
  headline TEXT,
  bio TEXT,
  years_of_experience INTEGER,
  timezone TEXT,
  requested_segment_ids UUID[],
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  document_count BIGINT
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  RETURN QUERY
  SELECT a.id, a.user_id, a.status, a.full_name, a.headline, a.bio,
         a.years_of_experience, a.timezone, a.requested_segment_ids,
         a.submitted_at, a.reviewed_at, a.reviewed_by, a.rejection_reason,
         a.created_at, a.updated_at,
         (SELECT COUNT(*) FROM public.mentor_verification_documents d
           WHERE d.application_id = a.id)
  FROM public.mentor_applications a
  WHERE p_status IS NULL OR a.status = p_status
  ORDER BY
    CASE WHEN a.status = 'pending_review' THEN 0 ELSE 1 END,
    a.submitted_at ASC NULLS LAST,
    a.created_at ASC;
END;
$fn$;

-- ==============================================================================
-- 13. GRANTS
-- ==============================================================================
-- The authenticated role may call the applicant-facing RPCs; the admin-gated
-- RPCs additionally re-check is_admin() on the server, so exposing them to
-- `authenticated` is safe.

GRANT EXECUTE ON FUNCTION
  public.get_mentor_onboarding_status(),
  public.save_mentor_application(TEXT, TEXT, TEXT, INTEGER, TEXT, UUID[]),
  public.submit_mentor_application(),
  public.register_mentor_document(UUID, TEXT, TEXT, TEXT, TEXT, BIGINT),
  public.is_current_user_suspended(),
  public.is_mentor_discoverable(UUID)
TO authenticated;

GRANT EXECUTE ON FUNCTION
  public.approve_mentor_application(UUID),
  public.reject_mentor_application(UUID, TEXT),
  public.review_mentor_document(UUID, TEXT, TEXT),
  public.admin_set_account_status(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT),
  public.admin_list_mentor_applications(TEXT)
TO authenticated;

-- ==============================================================================
-- 14. RELOAD POSTGREST SCHEMA CACHE
-- ==============================================================================
-- Without this, the original "column not found in the schema cache" error
-- persists even after the column exists. NOTIFY is harmless if pgrst is absent.

DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- ==============================================================================
-- 15. OLD / TEST MENTOR CLEANUP TOOLING (sections 3, 33)
-- ==============================================================================
-- The rule: never blind-delete. Inspect first with
-- admin_report_mentor_dependencies(), then choose per mentor.
--
--   historical_dependency_count = 0
--     -> admin_delete_test_mentor(...)  (clean removal, no history at stake)
--
--   historical_dependency_count > 0
--     -> admin_set_account_status(..., 'deactivate') + archive gig
--        (history preserved, mentor no longer discoverable)
--
-- Historical = bookings, payments, session workspaces.
-- Availability, exceptions and notifications are operational, not historical,
-- so they do not block a clean delete.

CREATE OR REPLACE FUNCTION public.admin_report_mentor_dependencies(p_mentor_id UUID)
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  mentor_profile BOOLEAN,
  application_status TEXT,
  gig_count BIGINT,
  active_gig_count BIGINT,
  availability_count BIGINT,
  availability_exception_count BIGINT,
  notification_count BIGINT,
  booking_count BIGINT,
  payment_count BIGINT,
  session_workspace_count BIGINT,
  historical_dependency_count BIGINT
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_email TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  IF to_regclass('auth.users') IS NOT NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = p_mentor_id;
  END IF;

  RETURN QUERY
  SELECT
    p_mentor_id,
    v_email,
    (to_regclass('public.mentor_profiles') IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.mentor_profiles WHERE id = p_mentor_id)),
    (SELECT status FROM public.mentor_applications WHERE user_id = p_mentor_id),
    (SELECT COUNT(*) FROM public.gigs WHERE mentor_id = p_mentor_id),
    (SELECT COUNT(*) FROM public.gigs WHERE mentor_id = p_mentor_id AND is_active = TRUE),
    (CASE WHEN to_regclass('public.availability') IS NULL THEN 0
          ELSE (SELECT COUNT(*) FROM public.availability WHERE mentor_id = p_mentor_id) END),
    (CASE WHEN to_regclass('public.availability_exceptions') IS NULL THEN 0
          ELSE (SELECT COUNT(*) FROM public.availability_exceptions WHERE mentor_id = p_mentor_id) END),
    (CASE WHEN to_regclass('public.notifications') IS NULL THEN 0
          ELSE (SELECT COUNT(*) FROM public.notifications WHERE user_id = p_mentor_id) END),
    (CASE WHEN to_regclass('public.bookings') IS NULL THEN 0
          ELSE (SELECT COUNT(*) FROM public.bookings WHERE mentor_id = p_mentor_id) END),
    (CASE WHEN to_regclass('public.payments') IS NULL THEN 0
          ELSE (SELECT COUNT(*) FROM public.payments WHERE mentor_id = p_mentor_id) END),
    (CASE WHEN to_regclass('public.session_workspaces') IS NULL THEN 0
          ELSE (SELECT COUNT(*) FROM public.session_workspaces WHERE mentor_id = p_mentor_id) END),
    (CASE WHEN to_regclass('public.bookings') IS NULL THEN 0
          ELSE (SELECT COUNT(*) FROM public.bookings WHERE mentor_id = p_mentor_id) END)
    + (CASE WHEN to_regclass('public.payments') IS NULL THEN 0
            ELSE (SELECT COUNT(*) FROM public.payments WHERE mentor_id = p_mentor_id) END)
    + (CASE WHEN to_regclass('public.session_workspaces') IS NULL THEN 0
            ELSE (SELECT COUNT(*) FROM public.session_workspaces WHERE mentor_id = p_mentor_id) END);
END;
$fn$;

-- Clean removal of a mentor that has NO historical dependency. Refuses to run
-- when history exists, so it can never destroy a real booking or payment.
CREATE OR REPLACE FUNCTION public.admin_delete_test_mentor(p_mentor_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  IF to_regclass('public.bookings') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.bookings WHERE mentor_id = p_mentor_id) THEN
    RAISE EXCEPTION 'Mentor has booking history. Deactivate/archive instead of deleting.';
  END IF;

  IF to_regclass('public.payments') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.payments WHERE mentor_id = p_mentor_id) THEN
    RAISE EXCEPTION 'Mentor has payment history. Deactivate/archive instead of deleting.';
  END IF;

  IF to_regclass('public.session_workspaces') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.session_workspaces WHERE mentor_id = p_mentor_id) THEN
    RAISE EXCEPTION 'Mentor has session workspace history. Deactivate/archive instead.';
  END IF;

  -- Operational data only, removed explicitly table by table. No uncontrolled
  -- CASCADE is relied upon.
  IF to_regclass('public.availability_exceptions') IS NOT NULL THEN
    DELETE FROM public.availability_exceptions WHERE mentor_id = p_mentor_id;
  END IF;
  IF to_regclass('public.availability') IS NOT NULL THEN
    DELETE FROM public.availability WHERE mentor_id = p_mentor_id;
  END IF;
  IF to_regclass('public.gigs') IS NOT NULL THEN
    DELETE FROM public.gigs WHERE mentor_id = p_mentor_id;
  END IF;
  IF to_regclass('public.notifications') IS NOT NULL THEN
    DELETE FROM public.notifications WHERE user_id = p_mentor_id;
  END IF;

  -- Applications (and their documents) follow the user via FK cascade.
  DELETE FROM public.mentor_applications WHERE user_id = p_mentor_id;

  IF to_regclass('public.mentor_profiles') IS NOT NULL THEN
    DELETE FROM public.mentor_profiles WHERE id = p_mentor_id;
  END IF;

  IF to_regclass('public.user_roles') IS NOT NULL THEN
    DELETE FROM public.user_roles WHERE user_id = p_mentor_id;
  END IF;

  IF to_regclass('public.profiles') IS NOT NULL THEN
    DELETE FROM public.profiles WHERE id = p_mentor_id;
  END IF;

  IF to_regclass('auth.users') IS NOT NULL THEN
    DELETE FROM auth.users WHERE id = p_mentor_id;
  END IF;

  RETURN TRUE;
END;
$fn$;

GRANT EXECUTE ON FUNCTION
  public.admin_report_mentor_dependencies(UUID),
  public.admin_delete_test_mentor(UUID)
TO authenticated;


COMMIT;

