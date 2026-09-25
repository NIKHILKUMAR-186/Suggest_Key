-- ==============================================================================
-- PHASE 10: SESSION WORKSPACE MIGRATION & RLS POLICIES
-- Supports Mentor create/edit/save, Seeker completed session view, Admin operational audit
-- ==============================================================================

-- 1. Ensure table schema has all Phase 10 sections
CREATE TABLE IF NOT EXISTS public.session_workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  mentor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  seeker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PUBLISHED')),
  mentor_notes TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  takeaways JSONB NOT NULL DEFAULT '[]'::jsonb,
  suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
  next_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  action_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  follow_up_recommendation JSONB DEFAULT NULL,
  resources JSONB NOT NULL DEFAULT '[]'::jsonb,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_session_workspace_booking UNIQUE (booking_id)
);

-- Ensure newly added columns exist if table was already created in Phase 4
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'session_workspaces' AND column_name = 'mentor_notes') THEN
    ALTER TABLE public.session_workspaces ADD COLUMN mentor_notes TEXT NOT NULL DEFAULT '';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'session_workspaces' AND column_name = 'suggestions') THEN
    ALTER TABLE public.session_workspaces ADD COLUMN suggestions JSONB NOT NULL DEFAULT '[]'::jsonb;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'session_workspaces' AND column_name = 'next_steps') THEN
    ALTER TABLE public.session_workspaces ADD COLUMN next_steps JSONB NOT NULL DEFAULT '[]'::jsonb;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'session_workspaces' AND column_name = 'follow_up_recommendation') THEN
    ALTER TABLE public.session_workspaces ADD COLUMN follow_up_recommendation JSONB DEFAULT NULL;
  END IF;
END $$;

-- Indexes for lightning fast lookups
CREATE INDEX IF NOT EXISTS idx_session_workspaces_booking_id ON public.session_workspaces(booking_id);
CREATE INDEX IF NOT EXISTS idx_session_workspaces_mentor_id ON public.session_workspaces(mentor_id);
CREATE INDEX IF NOT EXISTS idx_session_workspaces_seeker_id ON public.session_workspaces(seeker_id);
CREATE INDEX IF NOT EXISTS idx_session_workspaces_status ON public.session_workspaces(status);

-- 2. ENABLE ROW LEVEL SECURITY
ALTER TABLE public.session_workspaces ENABLE ROW LEVEL SECURITY;

-- Drop prior policies to avoid conflicts
DROP POLICY IF EXISTS "Session participants and admin can view workspaces" ON public.session_workspaces;
DROP POLICY IF EXISTS "Seeker view published or completed, mentor view own, admin view" ON public.session_workspaces;
DROP POLICY IF EXISTS "Mentors can create own workspace, admin operational access" ON public.session_workspaces;
DROP POLICY IF EXISTS "Mentors and admin can create workspaces" ON public.session_workspaces;
DROP POLICY IF EXISTS "Mentors can update own workspace, admin operational access" ON public.session_workspaces;
DROP POLICY IF EXISTS "Mentors and admin can update workspaces" ON public.session_workspaces;
DROP POLICY IF EXISTS "Seekers can view published completed workspaces" ON public.session_workspaces;
DROP POLICY IF EXISTS "Mentors can manage own workspaces" ON public.session_workspaces;
DROP POLICY IF EXISTS "Admin operational access to all workspaces" ON public.session_workspaces;
DROP POLICY IF EXISTS "Admin operational delete access" ON public.session_workspaces;

-- ------------------------------------------------------------------------------
-- RLS POLICY: SELECT
-- 1. Seeker: can view completed session workspace IF status = 'PUBLISHED'
-- 2. Mentor: can view own workspaces in all states (PENDING draft & PUBLISHED)
-- 3. Admin: operational view access to all workspaces
-- ------------------------------------------------------------------------------
CREATE POLICY "Seeker view published or completed, mentor view own, admin view all"
  ON public.session_workspaces FOR SELECT
  USING (
    (seeker_id = auth.uid() AND status = 'PUBLISHED') OR
    mentor_id = auth.uid() OR
    public.is_admin()
  );

-- ------------------------------------------------------------------------------
-- RLS POLICY: INSERT
-- Mentor can create workspace for bookings where they are the assigned mentor.
-- Admin has operational access to create workspace.
-- ------------------------------------------------------------------------------
CREATE POLICY "Mentors can create own workspace, admin operational access"
  ON public.session_workspaces FOR INSERT
  WITH CHECK (
    (mentor_id = auth.uid() AND public.has_role(auth.uid(), 'mentor')) OR
    public.is_admin()
  );

-- ------------------------------------------------------------------------------
-- RLS POLICY: UPDATE
-- Mentor can edit and save own workspace.
-- Admin has operational access to update/moderate workspace.
-- Seeker CANNOT update workspace.
-- ------------------------------------------------------------------------------
CREATE POLICY "Mentors can update own workspace, admin operational access"
  ON public.session_workspaces FOR UPDATE
  USING (mentor_id = auth.uid() OR public.is_admin())
  WITH CHECK (mentor_id = auth.uid() OR public.is_admin());

-- ------------------------------------------------------------------------------
-- RLS POLICY: DELETE
-- Admin only for operational cleanup. Mentors and Seekers cannot delete records.
-- ------------------------------------------------------------------------------
CREATE POLICY "Admin operational delete access"
  ON public.session_workspaces FOR DELETE
  USING (public.is_admin());
