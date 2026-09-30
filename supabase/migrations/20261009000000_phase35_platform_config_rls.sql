-- =============================================================================
-- PHASE 35: platform_config ROW LEVEL SECURITY
-- =============================================================================
--
-- WHY THIS EXISTS
-- ---------------
-- DRIFT.md item 3. Production has had RLS enabled on `platform_config` since
-- before this repository's migration lineage was applied, and carries the
-- policy `Admins can manage platform config` (FOR ALL, USING is_admin(),
-- WITH CHECK is_admin()). Neither the `ALTER TABLE ... ENABLE ROW LEVEL
-- SECURITY` nor the policy exists in any migration file: the table is created
-- in `20260927110000_phase25_payment_foundation.sql:27` without them.
--
-- So a database built purely from migration history ships this table with NO
-- row-level protection, while `20260914000018_permissions_authenticated_anon`
-- has already granted `authenticated` full table privileges on every table that
-- exists at that point.
--
-- WHY THAT MATTERS ON THIS TABLE SPECIFICALLY
-- -------------------------------------------
-- `platform_config` holds payment destination data, not user data:
--
--   upi_id, payment_account_name, payment_instructions,
--   qr_image_storage_path, currency,
--   hold_duration_minutes, reschedule_request_expiry_hours,
--   reschedule_window_minutes
--
-- With RLS absent and table-level UPDATE granted, any signed-in user could
-- rewrite `upi_id` and `qr_image_storage_path`, redirecting subsequent
-- payments to an account they control. `hold_duration_minutes` is likewise
-- reachable, which would collapse the booking slot-hold window. This is the
-- single-row table (`id = 1`), so "all rows" means "the config".
--
-- This migration brings the history in line with what production already
-- enforces. It does not change production behaviour.
--
-- VERIFIED BEFORE WRITING THIS
-- ----------------------------
--   production relrowsecurity = true
--   production policy         = `Admins can manage platform config`
--                                cmd=ALL roles={public}
--                                qual=is_admin() with_check=is_admin()
--   production grants         = authenticated: SELECT, INSERT, UPDATE, DELETE,
--                                TRUNCATE, TRIGGER, REFERENCES (table level)
--
-- The policy is recreated with identical semantics and the identical name, so
-- applying it to production is a no-op and applying it to a fresh database
-- closes the gap. `DROP POLICY IF EXISTS` first keeps it idempotent.
--
-- The privileges are deliberately left as they are. RLS is the control that
-- matters here: `is_admin()` is false for every non-admin, so the existing
-- table-level grants grant nothing in practice. Narrowing them to the same
-- per-column treatment used on `profiles` / `mentor_profiles` would be a
-- separate, larger change with no security benefit while RLS is on.

ALTER TABLE public.platform_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage platform config" ON public.platform_config;

CREATE POLICY "Admins can manage platform config"
  ON public.platform_config
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

COMMENT ON TABLE public.platform_config IS
  'Payment and booking-window configuration (single row, id = 1). Server-written only via admin routes using the service-role client. RLS restricts every operation to admins: no browser code reads or writes this table. Absent RLS, the table-level authenticated grants would let any signed-in user rewrite upi_id and redirect payments.';
