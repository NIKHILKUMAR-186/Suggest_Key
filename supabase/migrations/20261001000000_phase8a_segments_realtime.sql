-- Phase 8a: realtime publication for `public.segments`
--
-- A segment's appearance and experience content live in the
-- `segments.experience_config` JSONB column. For an admin edit to reach an
-- already-open seeker page without a refresh, that table must be part of the
-- `supabase_realtime` publication — the earlier Phase 17 / Phase 25 migrations
-- added the availability and payment tables, but NOT `segments`, so no
-- postgres_changes event for a segment could ever reach the browser.
--
-- RLS IS NOT CHANGED HERE.
--
-- Realtime evaluates the SUBSCRIBER's policies, and the existing policy from
-- phase4_mvp_schema.sql is:
--
--   CREATE POLICY "Anyone can view active segments"
--     ON public.segments FOR SELECT
--     USING (is_active = TRUE OR public.is_admin());
--
-- That is already exactly the guarantee we want, so adding the table to the
-- publication is sufficient and safe:
--
--   * Public/anonymous clients receive events ONLY for rows where
--     is_active = TRUE. An inactive (draft/unpublished) segment is never
--     delivered to a non-admin subscriber.
--   * Admin-only writes remain governed by the unchanged
--     "Admins can manage segments" policy.
--   * No other table, policy or grant is touched, and no booking, payment,
--     availability or authentication policy is modified.
--
-- `segments` is a low-churn catalogue table (admin edits only), so replicating
-- it adds negligible replication volume while removing the need for any
-- client-side polling.
--
-- Idempotent: safe to re-run; it only adds the table when it is not already a
-- member of the publication.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END
$$;

-- Ensure UPDATE events include the full new row (including experience_config)
-- so realtime subscribers receive the updated config without needing a refetch.
DO $$
BEGIN
  -- REPLICA IDENTITY FULL ensures the full new row is sent on UPDATE
  ALTER TABLE public.segments REPLICA IDENTITY FULL;
EXCEPTION WHEN OTHERS THEN
  -- Ignore if already set or table doesn't exist
  NULL;
END
$$;

DO $$
DECLARE
  t text := 'public.segments';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = split_part(t, '.', 1)
      AND tablename = split_part(t, '.', 2)
  ) THEN
    EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %s;', t);
  END IF;
END
$$;

COMMENT ON TABLE public.segments IS
  'Advisory segments. Experience/branding config lives in experience_config; the row is replicated via supabase_realtime so admin edits reach open seeker pages. Public SELECT is limited to is_active = TRUE by RLS.';
