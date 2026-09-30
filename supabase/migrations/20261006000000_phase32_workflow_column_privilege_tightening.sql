-- Corrects column-level privilege escalation on the two remaining workflow
-- tables, `session_workspaces` and `mentor_applications`.
--
-- This is the same class of defect already fixed on `profiles` and
-- `mentor_profiles`, and the same correction style already used on `bookings`
-- in 20260927070000_phase24c_bookings_privilege_tightening.sql.
--
-- WHY A COLUMN-LEVEL REVOKE ALONE IS INERT
-- ----------------------------------------
-- `authenticated` holds TABLE-level INSERT and UPDATE on both tables. Postgres
-- treats table-level and column-level privileges independently, so a table
-- grant keeps every column writable no matter how narrow the column grants
-- below are. The table-level grant must be revoked FIRST, exactly as phase24c
-- had to do for `bookings`.
--
-- VERIFIED BEFORE CHANGING ANYTHING
-- ---------------------------------
-- Every browser-side access to these two tables is a SELECT:
--   session_workspaces -> src/lib/workspaceService.ts:94  (fetchWorkspaceByBooking)
--   session_workspaces -> src/lib/workspaceService.ts:348 (fetchAdminWorkspacesAuthoritative)
--   mentor_applications -> src/lib/adminDashboardData.ts:170 (queue count)
-- There is no client-side insert, update or upsert against either table
-- anywhere in src/. Every write path is server-side with the service-role key,
-- which bypasses these grants entirely:
--   POST /api/workspaces              -> server.ts:10382 (upsert)
--   POST /api/mentor/application/draft -> server.ts:10574 (update) / 10589 (insert)
--   POST /api/mentor/application/submit -> server.ts:10722 (update)
--   POST /api/admin/mentor-applications/:id/approve -> server.ts:11155 (update)
--   POST /api/admin/mentor-applications/:id/reject  -> server.ts:11265 (update)
-- The SECURITY DEFINER RPCs that also touch these tables
-- (`save_mentor_application`, `submit_mentor_application`,
-- `approve_mentor_application`, `reject_mentor_application`,
-- `register_mentor_document`, `upsert_mentor_document`) are all NOT executable
-- by `authenticated`, so the browser cannot reach the workflow through RPC
-- either. So the table-level grant was protecting nothing.
--
-- PROVEN EXPLOITABLE BEFORE THIS MIGRATION
-- -----------------------------------------
-- Executed as `authenticated` with a forged JWT, inside a transaction that was
-- forced to roll back:
--
--   mentor_applications: an applicant forged the admin decision fields on their
--   own application while keeping `status` inside the RLS-permitted set:
--     reviewed_by = a8222dcd-...  reviewed_at = 2026-09-30 07:19:42  rejection_reason = 'forged by applicant'
--   (`status` itself is already blocked by the RLS USING/WITH CHECK clause,
--   which restricts it to draft/rejected - but `reviewed_by` had no such
--   protection, so an applicant could impersonate a reviewer and write a
--   rejection reason onto their own application.)
--
--   session_workspaces: a mentor set `status = 'PUBLISHED'` and rewrote
--   `seeker_id` on their own workspace:
--     status = PUBLISHED  published_at = 2026-09-30 07:20:55  seeker_id = <mentor's own id>
--   Publishing is a server-side decision derived from the validated `publish`
--   request flag, and the RLS SELECT policy keys seeker visibility off
--   `status = 'PUBLISHED'`, so a client-side PUBLISHED write makes the mentor's
--   own notes visible to the seeker without ever going through the server.
--   Rewriting `seeker_id`/`mentor_id` re-points a workspace at a different
--   pair of participants entirely.
--
-- TRUNCATE IS REVOKED TOO, AND THIS IS NOT COSMETIC
-- ------------------------------------------------
-- TRUNCATE is one of the few statements RLS does not cover at all, so a
-- table-level grant on it is a real data-destruction path rather than a
-- theoretical one. phase24c made the same call on `bookings`.
--
-- updated_at AND THE TRIGGER
-- -------------------------
-- `mentor_applications` has `BEFORE UPDATE ... set_updated_at()`. That trigger
-- fires as the table owner and does not require `authenticated` to hold UPDATE
-- on `updated_at`, so stamping stays correct. Verified before revoking: an
-- `authenticated` UPDATE touching only `full_name` still advanced `updated_at`
-- (2026-09-27 09:50:46 -> 2026-09-30 07:18:50). `updated_at` is therefore
-- deliberately absent from the grant list below.

-- =============================================================================
-- 1. session_workspaces
-- =============================================================================

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.session_workspaces FROM authenticated, anon;

-- Content the assigned mentor legitimately authors. `status`, `published_at`
-- and the participant columns stay service-role only so publishing remains a
-- server decision and a workspace cannot be re-pointed at another pair of
-- participants.
GRANT UPDATE (
  summary,
  takeaways,
  action_items,
  resources
) ON public.session_workspaces TO authenticated, anon;

-- Insert is needed for the create case, but only with server-controlled
-- defaults. `status` and `published_at` are absent, so a client-created
-- workspace always starts PENDING and unpublished.
GRANT INSERT (
  booking_id,
  mentor_id,
  seeker_id,
  summary,
  takeaways,
  action_items,
  resources
) ON public.session_workspaces TO authenticated, anon;

COMMENT ON TABLE public.session_workspaces IS
  'Mentor-authored content (summary, takeaways, action_items, resources) is the only client-writable surface. Workflow state (status, published_at) and participant identity (booking_id, mentor_id, seeker_id) are service-role only. RLS remains the ownership layer: mentor_id = auth.uid() OR is_admin().';

-- =============================================================================
-- 2. mentor_applications
-- =============================================================================

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.mentor_applications FROM authenticated, anon;

-- Applicant-authored content only. The review decision (status, submitted_at,
-- reviewed_at, reviewed_by, rejection_reason) and the applicant identity
-- (user_id) are deliberately absent.
GRANT UPDATE (
  full_name,
  bio,
  timezone,
  headline,
  years_of_experience,
  requested_segment_ids
) ON public.mentor_applications TO authenticated, anon;

-- `user_id` is included because the RLS INSERT policy
-- ("Applicants can create own application") is WITH CHECK (user_id = auth.uid()),
-- so it must be settable on insert for that policy to be satisfiable.
-- `status` is absent so an inserted row takes the 'draft' column default and an
-- applicant cannot pre-approve or pre-submit their own application.
GRANT INSERT (
  user_id,
  full_name,
  bio,
  timezone,
  headline,
  years_of_experience,
  requested_segment_ids
) ON public.mentor_applications TO authenticated, anon;

COMMENT ON TABLE public.mentor_applications IS
  'Applicant content (full_name, bio, timezone, headline, years_of_experience, requested_segment_ids) is the only client-writable surface. The review decision (status, submitted_at, reviewed_at, reviewed_by, rejection_reason) and applicant identity (user_id) are service-role only. RLS remains the ownership layer: user_id = auth.uid(), and UPDATE is further restricted to draft/rejected rows.';
