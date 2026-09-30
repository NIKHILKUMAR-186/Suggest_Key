-- ==============================================================================
-- PHASE 33: SESSION WORKSPACES COLUMN ALIGNMENT
--
-- WHY THIS EXISTS
-- ---------------
-- `POST /api/workspaces` (server.ts) writes a workspace row through the
-- service-role client, using an UPSERT on `booking_id`. That statement names
-- four columns that the live table does not have:
--
--   mentor_notes, suggestions, next_steps, follow_up_recommendation
--
-- The 20260921000001_phase10 migration file intended to add them, but this
-- project's applied migration lineage is a different one (the `mvp_*` /
-- `suggest_key_*` migrations), and the `session_workspaces` table was in fact
-- built by the earlier schema without those four columns. So the phase-10 file
-- is recorded in the repository but never ran here, and the app and the
-- database disagreed.
--
-- The failure is a hard 500, not a validation error:
--
--   PGRST204  Could not find the 'follow_up_recommendation' column of
--             'session_workspaces' in the schema cache
--
-- PostgREST resolves the whole payload against its schema cache before it
-- emits any SQL, so the single unknown column aborts the entire upsert. Every
-- mentor save and every publish failed the same way.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- 1. Adds exactly the four missing columns, with the same definitions the
--    phase-10 schema of record uses.
-- 2. Backfills `summary` into `mentor_notes` for existing rows so an already
--    created draft does not display as empty.
-- 3. Guarantees a UNIQUE index on `booking_id`, because that is what makes
--    `upsert(..., { onConflict: 'booking_id' })` resolve to an UPDATE against
--    the existing row rather than a second INSERT. Whichever migration built
--    the table, the publish path needs this.
--
-- WHAT IT DELIBERATELY DOES NOT DO
-- -------------------------------
-- * RLS stays ENABLED and no policy is weakened. The SELECT policy already
--   gates seeker visibility on `status = 'PUBLISHED'`, and the INSERT/UPDATE
--   policies already key on `mentor_id = auth.uid() OR is_admin()`. Ownership
--   remains the RLS layer's job.
-- * No new grant is issued to `authenticated` or `anon`. These four columns
--   stay service-role only, exactly like `status` and `published_at`: the
--   browser never writes this table, it goes through POST /api/workspaces, and
--   publishing is a server decision derived from the validated `publish` flag.
--   The 20261006000000_phase32 column tightening is unaffected - it names
--   `summary`, `takeaways`, `action_items` and `resources`, all of which
--   already exist.
-- * Forward-only and idempotent: ADD COLUMN IF NOT EXISTS, no DROP, no TRUNCATE.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. The four columns the application writes and the table was missing
-- ------------------------------------------------------------------------------

ALTER TABLE public.session_workspaces
  ADD COLUMN IF NOT EXISTS mentor_notes TEXT NOT NULL DEFAULT '';

ALTER TABLE public.session_workspaces
  ADD COLUMN IF NOT EXISTS suggestions JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.session_workspaces
  ADD COLUMN IF NOT EXISTS next_steps JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.session_workspaces
  ADD COLUMN IF NOT EXISTS follow_up_recommendation JSONB DEFAULT NULL;

-- ------------------------------------------------------------------------------
-- 2. Backfill: `summary` predates `mentor_notes` and held the same content
-- ------------------------------------------------------------------------------

UPDATE public.session_workspaces
   SET mentor_notes = summary
 WHERE mentor_notes = ''
   AND summary IS NOT NULL
   AND summary <> '';

-- ------------------------------------------------------------------------------
-- 3. The conflict target the publish path depends on
--
-- `upsert(..., { onConflict: 'booking_id' })` needs a unique index on exactly
-- that column. The table carries it today as a UNIQUE CONSTRAINT
-- (`uq_workspace_booking`); this is the idempotent guard for any environment
-- where it is absent, so a publish can never degrade into a duplicate row.
-- ------------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS uq_session_workspaces_booking_id
  ON public.session_workspaces (booking_id);

-- ------------------------------------------------------------------------------
-- 4. Fail loudly if the table is still not able to accept an upsert
-- ------------------------------------------------------------------------------

DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(expected, ', ')
    INTO v_missing
    FROM unnest(ARRAY[
      'booking_id', 'mentor_id', 'seeker_id', 'status', 'mentor_notes',
      'summary', 'takeaways', 'suggestions', 'next_steps', 'action_items',
      'follow_up_recommendation', 'resources', 'published_at'
    ]) AS expected
   WHERE NOT EXISTS (
     SELECT 1
       FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name   = 'session_workspaces'
        AND c.column_name  = expected
   );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'phase33 session_workspaces alignment incomplete, still missing: %', v_missing;
  END IF;

  -- A duplicate workspace for one booking would let two "published" documents
  -- exist for the same session, and `.single()` would then read at random.
  IF NOT EXISTS (
    SELECT 1
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'session_workspaces'
       AND i.indisunique
       AND i.indnatts = 1
       AND i.indkey[0] = (
         SELECT a.attnum
           FROM pg_attribute a
          WHERE a.attrelid = 'public.session_workspaces'::regclass
            AND a.attname  = 'booking_id'
       )
  ) THEN
    RAISE EXCEPTION
      'phase33 session_workspaces alignment incomplete, booking_id is not unique';
  END IF;
END $$;

COMMENT ON COLUMN public.session_workspaces.mentor_notes IS
  'Mentor-authored session notes. Server-written only; identical content to summary.';
COMMENT ON COLUMN public.session_workspaces.suggestions IS
  'Mentor-authored suggestions as a JSONB array. Server-written only.';
COMMENT ON COLUMN public.session_workspaces.next_steps IS
  'Mentor-authored next steps as a JSONB array. Server-written only.';
COMMENT ON COLUMN public.session_workspaces.follow_up_recommendation IS
  'Mentor follow-up recommendation, object or string or null. Server-written only.';
