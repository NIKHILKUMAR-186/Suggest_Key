-- =============================================================================
-- PHASE 34: RESTORE THE NARROW WORKSPACE CONTENT BOUNDARY
-- =============================================================================
--
-- WHAT THIS DOES
-- --------------
-- `phase33_session_workspace_content_columns` was applied alongside
-- `phase33_session_workspaces_column_alignment`, which independently arrived at
-- the same PGRST204 root cause and added the same four columns. Both are
-- idempotent, so the columns are correctly present either way and no data moved.
--
-- The two migrations disagreed about one thing: whether the four restored
-- columns should be writable by the client roles.
--
--   phase33_content_columns        GRANT UPDATE (... mentor_notes,
--                                      suggestions, next_steps ...) TO
--                                      authenticated, anon
--   phase33_column_alignment       no new grant; service-role only
--
-- This migration resolves that in favour of the narrower posture, and it is the
-- one that matches the evidence:
--
--   * `src/lib/workspaceStore.server.ts` is the ONLY writer of this table, and
--     it writes through the service-role client, which has BYPASSRLS and full
--     table-level UPDATE. The `authenticated` column grant is never consulted.
--   * `src/lib/workspaceService.ts` performs no `.insert()`, `.update()` or
--     `.upsert()` on `session_workspaces`; both of its write paths call
--     `apiFetch('/api/workspaces')` and land on the server.
--
-- So the grant was unused surface. Narrowing it back is the least-privilege
-- outcome and restores phase32's boundary exactly: `summary`, `takeaways`,
-- `action_items` and `resources` only.
--
-- Publishing is unaffected. `status` and `published_at` are set by
-- `planWorkspaceWrite` from the validated `publish` flag and a server clock,
-- behind `authorizeWorkspaceWrite` / `authorizeExistingWorkspace`, which read
-- the verified token rather than the request body.
--
-- FORWARD-ONLY AND IDEMPOTENT
-- ---------------------------
-- REVOKE on a column that was never granted is a no-op, so this is safe to
-- re-run and safe on a database that never received phase33_content_columns.

REVOKE UPDATE (mentor_notes, suggestions, next_steps, follow_up_recommendation)
  ON public.session_workspaces FROM authenticated, anon;

COMMENT ON TABLE public.session_workspaces IS
  'Mentor-authored content is written server-side only: POST /api/workspaces is the sole writer and uses the service-role client, so no browser code writes this table. Client roles retain a narrow per-column UPDATE grant on summary, takeaways, action_items and resources as defence-in-depth. Workflow state (status, published_at) and participant identity (booking_id, mentor_id, seeker_id) are service-role only. RLS remains the ownership layer: mentor_id = auth.uid() OR is_admin().';
