-- ==============================================================================
-- SUGGEST KEY - PHASE 12: MENTOR ONBOARDING, VERIFICATION & ADMIN APPROVAL
-- ==============================================================================

-- 1. Mentor Document Types (configurable, extensible)
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

-- Seed two baseline document types (platform configuration, not fake applicant data)
INSERT INTO public.mentor_document_types (code, label, description, is_required, sort_order)
VALUES
  ('identity_proof', 'Government ID', 'Government-issued photo identification (passport, driver\'s license, Aadhaar)', TRUE, 1),
  ('qualification_proof', 'Qualification Certificate', 'Relevant certification, degree, or license proving expertise', TRUE, 2)
ON CONFLICT (code) DO UPDATE
SET label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_required = EXCLUDED.is_required,
    sort_order = EXCLUDED.sort_order,
    updated_at = NOW();

CREATE INDEX IF NOT EXISTS idx_mentor_document_types_active ON public.mentor_document_types(is_active, sort_order);

-- 2. Mentor Applications
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.mentor_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_review', 'approved', 'rejected')),
  full_name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_mentor_applications_user UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_mentor_applications_user ON public.mentor_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_mentor_applications_status ON public.mentor_applications(status);
CREATE INDEX IF NOT EXISTS idx_mentor_applications_submitted ON public.mentor_applications(submitted_at DESC);

-- 3. Mentor Verification Documents
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.mentor_verification_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.mentor_applications(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL REFERENCES public.mentor_document_types(code) ON DELETE RESTRICT,
  storage_path TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880), -- 5MB
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_note TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_mentor_verification_doc_app_type UNIQUE (application_id, document_type)
);

CREATE INDEX IF NOT EXISTS idx_mentor_verification_docs_app ON public.mentor_verification_documents(application_id);
CREATE INDEX IF NOT EXISTS idx_mentor_verification_docs_status ON public.mentor_verification_documents(status);

-- 4. Mentor Application Audit Log
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.mentor_application_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.mentor_applications(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'submitted', 'approved', 'rejected', 'resubmitted', 'document_uploaded', 'document_reviewed')),
  admin_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  rejection_reason TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mentor_app_audit_app ON public.mentor_application_audit(application_id);
CREATE INDEX IF NOT EXISTS idx_mentor_app_audit_created ON public.mentor_application_audit(created_at DESC);

-- 5. Extend mentor_profiles with approval status
-- ==============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'mentor_profiles' AND column_name = 'approval_status') THEN
    ALTER TABLE public.mentor_profiles ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'draft' CHECK (approval_status IN ('draft', 'pending_review', 'approved', 'rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'mentor_profiles' AND column_name = 'is_active') THEN
    ALTER TABLE public.mentor_profiles ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;

-- Backfill existing approved mentors
UPDATE public.mentor_profiles
SET approval_status = 'approved', is_active = TRUE
WHERE is_approved = TRUE AND approval_status = 'draft';

CREATE INDEX IF NOT EXISTS idx_mentor_profiles_approval ON public.mentor_profiles(approval_status);
CREATE INDEX IF NOT EXISTS idx_mentor_profiles_active ON public.mentor_profiles(is_active);

-- 6. Private Storage Bucket for Mentor Verification Documents
-- ==============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'mentor-verification-documents',
  'mentor-verification-documents',
  FALSE,
  5242880, -- 5MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET public = FALSE,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

-- Storage RLS policies
-- Mentor applicant: can upload/view own documents (path: mentor-verification-documents/<user_id>/<application_id>/<document_id>-<filename>)
CREATE POLICY "Mentor applicants can upload own verification documents"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'mentor-verification-documents' AND
    (storage.foldername(name))[1] = auth.uid()::text AND
    EXISTS (
      SELECT 1 FROM public.mentor_applications a
      WHERE a.id = ((storage.foldername(name))[2])::uuid
        AND a.user_id = auth.uid()
        AND a.status IN ('draft', 'rejected')
    )
  );

CREATE POLICY "Mentor applicants can view own verification documents"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'mentor-verification-documents' AND
    (storage.foldername(name))[1] = auth.uid()::text AND
    EXISTS (
      SELECT 1 FROM public.mentor_applications a
      WHERE a.id = ((storage.foldername(name))[2])::uuid
        AND a.user_id = auth.uid()
    )
  );

-- Admin: full access to verification documents
CREATE POLICY "Admins have full access to verification documents"
  ON storage.objects FOR ALL
  TO authenticated
  USING (
    bucket_id = 'mentor-verification-documents' AND public.is_admin()
  );

-- 7. RLS Policies for Mentor Applications
-- ==============================================================================
ALTER TABLE public.mentor_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentor_verification_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentor_application_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentor_document_types ENABLE ROW LEVEL SECURITY;

-- Mentor Applications: applicant can SELECT/INSERT/UPDATE own (draft/rejected only)
DROP POLICY IF EXISTS "Applicants can view own application" ON public.mentor_applications;
CREATE POLICY "Applicants can view own application"
  ON public.mentor_applications FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Applicants can create own application" ON public.mentor_applications;
CREATE POLICY "Applicants can create own application"
  ON public.mentor_applications FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Applicants can update own draft/rejected application" ON public.mentor_applications;
CREATE POLICY "Applicants can update own draft/rejected application"
  ON public.mentor_applications FOR UPDATE
  USING (user_id = auth.uid() AND status IN ('draft', 'rejected'))
  WITH CHECK (user_id = auth.uid() AND status IN ('draft', 'rejected'));

-- Admin: full access
DROP POLICY IF EXISTS "Admins can manage all mentor applications" ON public.mentor_applications;
CREATE POLICY "Admins can manage all mentor applications"
  ON public.mentor_applications FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Mentor Verification Documents: applicant can manage own (draft/rejected app), admin full
DROP POLICY IF EXISTS "Applicants can view own documents" ON public.mentor_verification_documents;
CREATE POLICY "Applicants can view own documents"
  ON public.mentor_verification_documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.mentor_applications a
      WHERE a.id = application_id AND (a.user_id = auth.uid() OR public.is_admin())
    )
  );

DROP POLICY IF EXISTS "Applicants can insert own documents" ON public.mentor_verification_documents;
CREATE POLICY "Applicants can insert own documents"
  ON public.mentor_verification_documents FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.mentor_applications a
      WHERE a.id = application_id AND a.user_id = auth.uid() AND a.status IN ('draft', 'rejected')
    )
  );

DROP POLICY IF EXISTS "Applicants can update own draft/rejected documents" ON public.mentor_verification_documents;
CREATE POLICY "Applicants can update own draft/rejected documents"
  ON public.mentor_verification_documents FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.mentor_applications a
      WHERE a.id = application_id AND a.user_id = auth.uid() AND a.status IN ('draft', 'rejected')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.mentor_applications a
      WHERE a.id = application_id AND a.user_id = auth.uid() AND a.status IN ('draft', 'rejected')
    )
  );

DROP POLICY IF EXISTS "Admins can manage all verification documents" ON public.mentor_verification_documents;
CREATE POLICY "Admins can manage all verification documents"
  ON public.mentor_verification_documents FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Audit: applicant can view own, admin full
DROP POLICY IF EXISTS "Applicants can view own audit log" ON public.mentor_application_audit;
CREATE POLICY "Applicants can view own audit log"
  ON public.mentor_application_audit FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.mentor_applications a
      WHERE a.id = application_id AND (a.user_id = auth.uid() OR public.is_admin())
    )
  );

DROP POLICY IF EXISTS "Admins can manage audit log" ON public.mentor_application_audit;
CREATE POLICY "Admins can manage audit log"
  ON public.mentor_application_audit FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Document Types: public read, admin manage
DROP POLICY IF EXISTS "Anyone can view active document types" ON public.mentor_document_types;
CREATE POLICY "Anyone can view active document types"
  ON public.mentor_document_types FOR SELECT
  USING (is_active = TRUE OR public.is_admin());

DROP POLICY IF EXISTS "Admins can manage document types" ON public.mentor_document_types;
CREATE POLICY "Admins can manage document types"
  ON public.mentor_document_types FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 8. SECURITY DEFINER RPCs
-- ==============================================================================

-- Helper: log audit entry
CREATE OR REPLACE FUNCTION public._log_mentor_app_audit(
  p_application_id UUID,
  p_action TEXT,
  p_admin_user_id UUID DEFAULT NULL,
  p_rejection_reason TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.mentor_application_audit (application_id, action, admin_user_id, rejection_reason, metadata)
  VALUES (p_application_id, p_action, p_admin_user_id, p_rejection_reason, p_metadata);
END;
$$;

-- Create or update mentor application (draft/rejected only)
CREATE OR REPLACE FUNCTION public.create_or_update_mentor_application(
  p_full_name TEXT,
  p_bio TEXT DEFAULT '',
  p_timezone TEXT DEFAULT 'Asia/Kolkata'
) RETURNS public.mentor_applications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app public.mentor_applications;
BEGIN
  -- Upsert: create new or update existing draft/rejected
  INSERT INTO public.mentor_applications (user_id, full_name, bio, timezone, status, updated_at)
  VALUES (auth.uid(), p_full_name, p_bio, p_timezone, 'draft', NOW())
  ON CONFLICT (user_id) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        bio = EXCLUDED.bio,
        timezone = EXCLUDED.timezone,
        updated_at = NOW(),
        status = CASE
          WHEN mentor_applications.status IN ('draft', 'rejected') THEN mentor_applications.status
          ELSE mentor_applications.status -- keep approved/pending_review unchanged
        END
  RETURNING * INTO v_app;

  PERFORM public._log_mentor_app_audit(v_app.id, 'created', NULL, NULL, jsonb_build_object('full_name', p_full_name));

  RETURN v_app;
END;
$$;

-- Submit application for review (draft/rejected -> pending_review)
CREATE OR REPLACE FUNCTION public.submit_mentor_application(
  p_application_id UUID
) RETURNS public.mentor_applications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app public.mentor_applications;
  v_required_types TEXT[];
  v_uploaded_types TEXT[];
BEGIN
  -- Lock application row
  SELECT * INTO v_app
  FROM public.mentor_applications
  WHERE id = p_application_id AND user_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found or not authorized';
  END IF;

  IF v_app.status NOT IN ('draft', 'rejected') THEN
    RAISE EXCEPTION 'Application cannot be submitted from status: %', v_app.status;
  END IF;

  -- Validate required info
  IF v_app.full_name IS NULL OR v_app.full_name = '' THEN
    RAISE EXCEPTION 'Full name is required';
  END IF;

  -- Check required document types exist (at least one document per required type)
  SELECT array_agg(code) INTO v_required_types
  FROM public.mentor_document_types
  WHERE is_required = TRUE AND is_active = TRUE;

  IF v_required_types IS NOT NULL AND array_length(v_required_types, 1) > 0 THEN
    SELECT array_agg(DISTINCT document_type) INTO v_uploaded_types
    FROM public.mentor_verification_documents
    WHERE application_id = p_application_id
      AND status IN ('pending', 'approved');

    IF v_uploaded_types IS NULL OR NOT (v_required_types <@ v_uploaded_types) THEN
      RAISE EXCEPTION 'All required documents must be uploaded before submission';
    END IF;
  END IF;

  -- Update status
  UPDATE public.mentor_applications
  SET status = 'pending_review',
      submitted_at = NOW(),
      updated_at = NOW(),
      rejection_reason = NULL -- clear previous rejection reason on resubmit
  WHERE id = p_application_id
  RETURNING * INTO v_app;

  -- Log audit
  PERFORM public._log_mentor_app_audit(v_app.id, 'submitted', NULL, NULL, jsonb_build_object('previous_status', 'draft_or_rejected'));

  -- Notifications
  -- Applicant
  INSERT INTO public.notifications (user_id, title, message, type, event_type, entity_type, entity_id, link)
  VALUES (
    v_app.user_id,
    'Verification Submitted',
    'Your mentor application has been submitted successfully. Our Admin team will review your information and documents.',
    'SYSTEM',
    'MENTOR_APPLICATION_SUBMITTED',
    'mentor_application',
    v_app.id::text,
    '/mentor/verification'
  );

  -- Admins
  INSERT INTO public.notifications (user_id, title, message, type, event_type, entity_type, entity_id, link)
  SELECT ur.user_id,
    'New Mentor Verification Submitted',
    'A new mentor application from ' || v_app.full_name || ' requires review.',
    'ADMIN',
    'ADMIN_MENTOR_APPLICATION_SUBMITTED',
    'mentor_application',
    v_app.id::text,
    '/admin/mentor-verification/' || v_app.id
  FROM public.user_roles ur
  WHERE ur.role = 'admin';

  RETURN v_app;
END;
$$;

-- Admin approve mentor application (atomic)
CREATE OR REPLACE FUNCTION public.approve_mentor_application(
  p_application_id UUID
) RETURNS public.mentor_applications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app public.mentor_applications;
  v_required_types TEXT[];
  v_approved_docs TEXT[];
  v_profile public.profiles;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  -- Lock application
  SELECT * INTO v_app
  FROM public.mentor_applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found';
  END IF;

  IF v_app.status <> 'pending_review' THEN
    RAISE EXCEPTION 'Application is not pending review (current: %)', v_app.status;
  END IF;

  -- Verify all required document types have approved documents
  SELECT array_agg(code) INTO v_required_types
  FROM public.mentor_document_types
  WHERE is_required = TRUE AND is_active = TRUE;

  IF v_required_types IS NOT NULL AND array_length(v_required_types, 1) > 0 THEN
    SELECT array_agg(DISTINCT document_type) INTO v_approved_docs
    FROM public.mentor_verification_documents
    WHERE application_id = p_application_id
      AND status = 'approved';

    IF v_approved_docs IS NULL OR NOT (v_required_types <@ v_approved_docs) THEN
      RAISE EXCEPTION 'All required documents must be approved before mentor approval';
    END IF;
  END IF;

  -- Get user profile
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_app.user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;

  -- Atomic updates
  UPDATE public.mentor_applications
  SET status = 'approved',
      reviewed_at = NOW(),
      reviewed_by = auth.uid(),
      updated_at = NOW()
  WHERE id = p_application_id
  RETURNING * INTO v_app;

  -- Ensure mentor role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_app.user_id, 'mentor')
  ON CONFLICT (user_id, role) DO NOTHING;

  -- Create/update mentor profile
  INSERT INTO public.mentor_profiles (id, headline, about, experience_years, languages, rating, review_count, session_count, is_approved, is_featured, approval_status, is_active, created_at, updated_at)
  VALUES (
    v_app.user_id,
    v_app.bio, -- using bio as headline initially
    v_app.bio,
    0,
    ARRAY['English', 'Hindi'],
    5.00,
    0,
    0,
    TRUE,
    FALSE,
    'approved',
    TRUE,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE
  SET about = EXCLUDED.about,
      is_approved = TRUE,
      approval_status = 'approved',
      is_active = TRUE,
      updated_at = NOW();

  -- Audit
  PERFORM public._log_mentor_app_audit(v_app.id, 'approved', auth.uid(), NULL, jsonb_build_object('approved_by', auth.uid()));

  -- Notifications
  -- Applicant
  INSERT INTO public.notifications (user_id, title, message, type, event_type, entity_type, entity_id, link)
  VALUES (
    v_app.user_id,
    'Mentor Application Approved',
    'Congratulations! Your mentor application has been approved. You can now complete your mentor profile and configure your availability.',
    'SYSTEM',
    'MENTOR_APPLICATION_APPROVED',
    'mentor_application',
    v_app.id::text,
    '/mentor'
  );

  -- Admins
  INSERT INTO public.notifications (user_id, title, message, type, event_type, entity_type, entity_id, link)
  SELECT ur.user_id,
    'Mentor Application Approved',
    'Mentor application for ' || v_app.full_name || ' has been approved by ' || (SELECT full_name FROM public.profiles WHERE id = auth.uid()) || '.',
    'ADMIN',
    'ADMIN_MENTOR_APPLICATION_APPROVED',
    'mentor_application',
    v_app.id::text,
    '/admin/mentor-verification/' || v_app.id
  FROM public.user_roles ur
  WHERE ur.role = 'admin';

  RETURN v_app;
END;
$$;

-- Admin reject mentor application
CREATE OR REPLACE FUNCTION public.reject_mentor_application(
  p_application_id UUID,
  p_rejection_reason TEXT
) RETURNS public.mentor_applications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app public.mentor_applications;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  IF p_rejection_reason IS NULL OR trim(p_rejection_reason) = '' THEN
    RAISE EXCEPTION 'Rejection reason is required';
  END IF;

  SELECT * INTO v_app
  FROM public.mentor_applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found';
  END IF;

  IF v_app.status <> 'pending_review' THEN
    RAISE EXCEPTION 'Application is not pending review (current: %)', v_app.status;
  END IF;

  UPDATE public.mentor_applications
  SET status = 'rejected',
      reviewed_at = NOW(),
      reviewed_by = auth.uid(),
      rejection_reason = p_rejection_reason,
      updated_at = NOW()
  WHERE id = p_application_id
  RETURNING * INTO v_app;

  -- Audit
  PERFORM public._log_mentor_app_audit(v_app.id, 'rejected', auth.uid(), p_rejection_reason, jsonb_build_object('rejected_by', auth.uid()));

  -- Notification to applicant
  INSERT INTO public.notifications (user_id, title, message, type, event_type, entity_type, entity_id, link)
  VALUES (
    v_app.user_id,
    'Mentor Application Needs Changes',
    'Your mentor application needs changes: ' || p_rejection_reason || '. Please review the Admin feedback and resubmit your verification.',
    'SYSTEM',
    'MENTOR_APPLICATION_REJECTED',
    'mentor_application',
    v_app.id::text,
    '/mentor/verification'
  );

  -- Admins
  INSERT INTO public.notifications (user_id, title, message, type, event_type, entity_type, entity_id, link)
  SELECT ur.user_id,
    'Mentor Application Rejected',
    'Mentor application for ' || v_app.full_name || ' has been rejected.',
    'ADMIN',
    'ADMIN_MENTOR_APPLICATION_REJECTED',
    'mentor_application',
    v_app.id::text,
    '/admin/mentor-verification/' || v_app.id
  FROM public.user_roles ur
  WHERE ur.role = 'admin';

  RETURN v_app;
END;
$$;

-- Upsert mentor document metadata (called after upload)
CREATE OR REPLACE FUNCTION public.upsert_mentor_document(
  p_application_id UUID,
  p_document_type TEXT,
  p_storage_path TEXT,
  p_original_filename TEXT,
  p_mime_type TEXT,
  p_size_bytes BIGINT
) RETURNS public.mentor_verification_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc public.mentor_verification_documents;
  v_app public.mentor_applications;
BEGIN
  -- Verify ownership and app status
  SELECT * INTO v_app
  FROM public.mentor_applications
  WHERE id = p_application_id AND user_id = auth.uid() AND status IN ('draft', 'rejected')
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found or not editable';
  END IF;

  -- Validate document type exists
  IF NOT EXISTS (SELECT 1 FROM public.mentor_document_types WHERE code = p_document_type AND is_active = TRUE) THEN
    RAISE EXCEPTION 'Invalid document type';
  END IF;

  -- Validate MIME type
  IF p_mime_type NOT IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') THEN
    RAISE EXCEPTION 'Unsupported file type';
  END IF;

  -- Validate size (5MB)
  IF p_size_bytes > 5242880 THEN
    RAISE EXCEPTION 'File size exceeds 5MB limit';
  END IF;

  -- Upsert document
  INSERT INTO public.mentor_verification_documents (application_id, document_type, storage_path, original_filename, mime_type, size_bytes, status, updated_at)
  VALUES (p_application_id, p_document_type, p_storage_path, p_original_filename, p_mime_type, p_size_bytes, 'pending', NOW())
  ON CONFLICT (application_id, document_type) DO UPDATE
    SET storage_path = EXCLUDED.storage_path,
        original_filename = EXCLUDED.original_filename,
        mime_type = EXCLUDED.mime_type,
        size_bytes = EXCLUDED.size_bytes,
        status = 'pending',
        updated_at = NOW()
  RETURNING * INTO v_doc;

  PERFORM public._log_mentor_app_audit(p_application_id, 'document_uploaded', NULL, NULL, jsonb_build_object('document_type', p_document_type, 'document_id', v_doc.id));

  RETURN v_doc;
END;
$$;

-- Admin review document
CREATE OR REPLACE FUNCTION public.review_mentor_document(
  p_document_id UUID,
  p_status TEXT, -- 'approved' or 'rejected'
  p_admin_note TEXT DEFAULT NULL
) RETURNS public.mentor_verification_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc public.mentor_verification_documents;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin authorization required';
  END IF;

  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;

  SELECT * INTO v_doc
  FROM public.mentor_verification_documents
  WHERE id = p_document_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document not found';
  END IF;

  UPDATE public.mentor_verification_documents
  SET status = p_status,
      reviewed_at = NOW(),
      reviewed_by = auth.uid(),
      admin_note = p_admin_note,
      updated_at = NOW()
  WHERE id = p_document_id
  RETURNING * INTO v_doc;

  PERFORM public._log_mentor_app_audit(v_doc.application_id, 'document_reviewed', auth.uid(), NULL, jsonb_build_object('document_id', v_doc.id, 'document_type', v_doc.document_type, 'status', p_status));

  RETURN v_doc;
END;
$$;

-- Get mentor onboarding status (for UI)
CREATE OR REPLACE FUNCTION public.get_mentor_onboarding_status()
RETURNS TABLE (
  application public.mentor_applications,
  documents public.mentor_verification_documents[],
  required_types public.mentor_document_types[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app public.mentor_applications;
  v_docs public.mentor_verification_documents[];
  v_types public.mentor_document_types[];
BEGIN
  -- Get or create draft application
  SELECT * INTO v_app
  FROM public.mentor_applications
  WHERE user_id = auth.uid()
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    -- Return empty state
    RETURN QUERY SELECT NULL::public.mentor_applications, ARRAY[]::public.mentor_verification_documents[], 
      (SELECT array_agg(mdt) FROM public.mentor_document_types mdt WHERE mdt.is_active = TRUE ORDER BY mdt.sort_order);
  END IF;

  SELECT array_agg(d) INTO v_docs
  FROM public.mentor_verification_documents d
  WHERE d.application_id = v_app.id;

  SELECT array_agg(mdt) INTO v_types
  FROM public.mentor_document_types mdt
  WHERE mdt.is_active = TRUE
  ORDER BY mdt.sort_order;

  RETURN QUERY SELECT v_app, COALESCE(v_docs, ARRAY[]::public.mentor_verification_documents[]), COALESCE(v_types, ARRAY[]::public.mentor_document_types[]);
END;
$$;