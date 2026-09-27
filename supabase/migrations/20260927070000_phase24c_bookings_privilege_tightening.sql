-- Corrects phase24 section 8, which did not take effect.
--
-- A column-level REVOKE is inert while a TABLE-level grant exists: Postgres
-- treats table-level and column-level privileges independently, and the table
-- grant keeps every column writable. `authenticated` holds table-level
-- UPDATE (and DELETE, and TRUNCATE) on bookings, so after phase24 the
-- column_privileges view still showed status, meeting_url, actual_ended_at,
-- start_time and end_time as client-writable - exactly the session-state
-- columns the revoke was meant to protect.
--
-- Verified before changing anything: every browser-side access to the bookings
-- table is a SELECT (workspaceService, adminDashboardData), and every write
-- path goes through server.ts with the service-role key, which bypasses these
-- grants entirely, or through a SECURITY DEFINER RPC such as
-- mentor_confirm_booking / set_meeting_link. So the table-level grant was
-- protecting nothing.
--
-- TRUNCATE is revoked too and this is not cosmetic: TRUNCATE is one of the few
-- statements RLS does not cover, so a table-level grant on it is a genuine
-- data-loss path rather than a theoretical one.

REVOKE UPDATE, DELETE, TRUNCATE ON public.bookings FROM authenticated, anon;

-- Re-grant only the columns a participant could legitimately need, in case an
-- unaudited flow writes them directly. The session-state columns are
-- deliberately absent and are reachable only through the service role or an
-- RPC:
--
--   status, actual_ended_at, ended_by_role, end_reason, meeting_url,
--   start_time, end_time
--
-- Writing any of those from a client would let a seeker mark their own session
-- completed, forge a manual end, move a booking's window, or swap the meeting
-- link. None of them appear below.
GRANT UPDATE (
  cancellation_reason,
  updated_at
) ON public.bookings TO authenticated, anon;

COMMENT ON TABLE public.bookings IS
  'Session state (status, actual_ended_at, ended_by_role, end_reason, meeting_url, start_time, end_time) is service-role and SECURITY DEFINER RPC only. The authenticated role holds SELECT, INSERT, and UPDATE on cancellation_reason/updated_at only.';