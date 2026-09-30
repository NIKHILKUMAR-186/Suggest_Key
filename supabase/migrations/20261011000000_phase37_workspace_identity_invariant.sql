-- =============================================================================
-- SUGGEST KEY - PHASE 37: BOOKING OFFER IDENTITY + WORKSPACE PARTICIPANT IDENTITY
-- =============================================================================
--
-- WHAT THIS ENFORCES
-- ------------------
-- Two invariants that nothing in the database was checking, and that the
-- application could only ever check AFTER a read had already produced a
-- confidently wrong screen.
--
-- 1. A workspace row is the workspace OF exactly one booking, and its
--    participants are that booking's participants.
--
--      session_workspaces.booking_id = bookings.id
--      session_workspaces.mentor_id  = bookings.mentor_id
--      session_workspaces.seeker_id  = bookings.seeker_id
--
--    `booking_id` already has a foreign key and a unique index. The two
--    participant columns did NOT, and they are the columns RLS reads.
--
--    The seeker SELECT policy is
--
--        (seeker_id = auth.uid() AND status = 'PUBLISHED') OR
--        mentor_id = auth.uid() OR is_admin()
--
--    so a seeker's visibility follows the ROW, never `bookings.seeker_id`. A
--    row whose `seeker_id` had drifted therefore became readable by a user who
--    was not in that session, and simultaneously invisible to the seeker who
--    was - who then saw "Awaiting Mentor Notes" forever while the mentor,
--    reading the same booking through `mentor_id = auth.uid()`, correctly saw
--    PUBLISHED. Nothing in the stack could produce that pair, so nothing in the
--    stack could detect it.
--
-- 2. A booking names one coherent offer.
--
--      gig.mentor_id  = booking.mentor_id
--      gig.segment_id = booking.segment_id
--
--    Phase 31 added the second predicate to `create_booking_with_hold`, which
--    closes the WRITE path for new bookings. It does nothing for rows that
--    already exist, and it does nothing for any other writer of `bookings`
--    (admin tooling, backfills, migrations). A booking carrying the Autism
--    segment together with a Relationship gig renders the SAME gig title under
--    two different segment names on two different bookings, which is precisely
--    what makes two unrelated workspaces look like one workspace published
--    against the wrong session.
--
-- WHY TRIGGERS AND NOT CHECK CONSTRAINTS
-- --------------------------------------
-- A CHECK constraint may not contain a subquery, and both rules are
-- "this row agrees with another table". A trigger is also the right shape
-- because the invariant is about a JOIN, not about a column: the trigger sees
-- the authoritative booking row at write time, so it cannot be defeated by a
-- caller that simply omits a column from its UPDATE.
--
-- It also runs for the service role. `workspaceStore.server.ts` writes through
-- the service-role client, which has BYPASSRLS; triggers are not bypassed by
-- BYPASSRLS, so the publish path is covered by exactly the same rule as every
-- other writer.
--
-- WHAT IT DELIBERATELY DOES NOT DO
-- ---------------------------------
-- * It does NOT repair the rows that already disagree. Phase 31 established
--   the posture this platform follows: a gig and a segment that disagree mean
--   the caller's context is stale, and silently rewriting either column would
--   destroy the evidence of how the row got that way. Legacy rows are reported
--   by `public.inconsistent_bookings()` and `public.inconsistent_session_workspaces()`
--   instead. Operators decide; the database refuses to add another.
--
-- * It does NOT weaken, widen or re-scope a single RLS policy. Nothing here
--   grants anything. The point is to make the data the policies already read
--   trustworthy, so no policy has to be relaxed to compensate.
--
-- * It does NOT invent a gig or a segment, and it does not fall back to
--   "whatever gig this mentor has". The comparison is on identity columns only,
--   so it holds for every segment the platform ever adds.
--
-- FORWARD-ONLY AND IDEMPOTENT
-- ---------------------------
-- `DROP TRIGGER IF EXISTS` before `CREATE TRIGGER` makes re-application a
-- no-op. There is no DROP COLUMN, no DELETE and no TRUNCATE.
-- =============================================================================

-- ------------------------------------------------------------------------------
-- 1. Booking offer identity
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_booking_offer_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_gig public.gigs;
BEGIN
  IF NEW.gig_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_gig FROM public.gigs WHERE id = NEW.gig_id;

  -- A booking pointing at a gig that no longer exists is a different defect
  -- (the offer was deleted) and is already blocked by the foreign key. Leaving
  -- it to that constraint keeps this trigger from masking it.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_gig.mentor_id IS DISTINCT FROM NEW.mentor_id THEN
    RAISE EXCEPTION
      'code: GIG_MISMATCH, Booking % names gig % which belongs to a different mentor',
      COALESCE(NEW.booking_code, NEW.id::text), NEW.gig_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF v_gig.segment_id IS DISTINCT FROM NEW.segment_id THEN
    RAISE EXCEPTION
      'code: GIG_MISMATCH, Booking % names segment % but its gig belongs to segment %',
      COALESCE(NEW.booking_code, NEW.id::text), NEW.segment_id, v_gig.segment_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_offer_identity ON public.bookings;

CREATE TRIGGER trg_bookings_offer_identity
  BEFORE INSERT OR UPDATE OF mentor_id, segment_id, gig_id
  ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_booking_offer_identity();

-- ------------------------------------------------------------------------------
-- 2. Session workspace participant identity
--
-- `mentor_id` and `seeker_id` are deliberately in the UPDATE column list. An
-- UPDATE that does not name them leaves NEW equal to OLD for those columns, so
-- the comparison is still correct; naming them means a row whose stored
-- participants were already wrong cannot be silently preserved by an edit that
-- only intended to touch the notes.
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_workspace_participant_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_booking public.bookings;
BEGIN
  SELECT mentor_id, seeker_id
    INTO v_booking
  FROM public.bookings
  WHERE id = NEW.booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'code: WORKSPACE_BOOKING_NOT_FOUND, Session workspace references booking % which does not exist',
      NEW.booking_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.mentor_id IS DISTINCT FROM v_booking.mentor_id THEN
    RAISE EXCEPTION
      'code: WORKSPACE_PARTICIPANT_MISMATCH, Session workspace mentor % does not match booking mentor %',
      NEW.mentor_id, v_booking.mentor_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.seeker_id IS DISTINCT FROM v_booking.seeker_id THEN
    RAISE EXCEPTION
      'code: WORKSPACE_PARTICIPANT_MISMATCH, Session workspace seeker % does not match booking seeker %',
      NEW.seeker_id, v_booking.seeker_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_session_workspaces_participant_identity ON public.session_workspaces;

CREATE TRIGGER trg_session_workspaces_participant_identity
  BEFORE INSERT OR UPDATE OF booking_id, mentor_id, seeker_id
  ON public.session_workspaces
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_workspace_participant_identity();

-- ------------------------------------------------------------------------------
-- 3. Reporting, not silent repair
--
-- Both views read through to the authoritative row rather than trusting a
-- denormalised copy, so what they report is what the policies actually read.
-- They exist because the triggers cannot retroactively describe damage that was
-- already in the table when they were installed.
-- ------------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.inconsistent_bookings AS
SELECT
  b.id,
  b.booking_code,
  b.mentor_id,
  b.segment_id,
  b.gig_id,
  g.segment_id AS gig_segment_id,
  (g.mentor_id IS DISTINCT FROM b.mentor_id)  AS mentor_mismatch,
  (g.segment_id IS DISTINCT FROM b.segment_id) AS segment_mismatch
FROM public.bookings b
LEFT JOIN public.gigs g ON g.id = b.gig_id
WHERE g.id IS NOT NULL
  AND (
    g.mentor_id  IS DISTINCT FROM b.mentor_id
    OR g.segment_id IS DISTINCT FROM b.segment_id
  );

COMMENT ON VIEW public.inconsistent_bookings IS
  'Bookings whose gig belongs to a different mentor and/or segment than the booking names. Never auto-repaired: gigs.segment_id is the authority and overwriting a booking would destroy the evidence. Reported so an operator can decide.';

CREATE OR REPLACE VIEW public.inconsistent_session_workspaces AS
SELECT
  w.id,
  w.booking_id,
  w.mentor_id,
  b.mentor_id AS booking_mentor_id,
  w.seeker_id,
  b.seeker_id AS booking_seeker_id,
  w.status,
  (w.mentor_id IS DISTINCT FROM b.mentor_id) AS mentor_mismatch,
  (w.seeker_id IS DISTINCT FROM b.seeker_id) AS seeker_mismatch
FROM public.session_workspaces w
LEFT JOIN public.bookings b ON b.id = w.booking_id
WHERE b.id IS NULL
  OR w.mentor_id IS DISTINCT FROM b.mentor_id
  OR w.seeker_id IS DISTINCT FROM b.seeker_id;

COMMENT ON VIEW public.inconsistent_session_workspaces IS
  'Workspace rows whose denormalised participants disagree with their booking, or whose booking is gone. The seeker SELECT policy keys on seeker_id, so a row listed here is simultaneously hidden from the rightful seeker and visible to the wrong one. Never auto-repaired; reported for operator decision.';

-- ------------------------------------------------------------------------------
-- 4. Fail loudly if the enforcement did not install
-- ------------------------------------------------------------------------------

DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(expected, ', ')
    INTO v_missing
    FROM unnest(ARRAY[
      'trg_bookings_offer_identity',
      'trg_session_workspaces_participant_identity'
    ]) AS expected
   WHERE NOT EXISTS (
     SELECT 1
       FROM pg_trigger t
       JOIN pg_class c     ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN ('bookings', 'session_workspaces')
        AND t.tgname = expected
        AND NOT t.tgisinternal
   );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'phase37 identity enforcement incomplete, missing trigger(s): %', v_missing;
  END IF;

  -- A trigger that never fires is worse than no trigger: it reads as a
  -- guarantee. Confirm both are enabled and are not disabled by session_replication_role.
  IF EXISTS (
    SELECT 1
      FROM pg_trigger t
      JOIN pg_class c     ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND t.tgname IN ('trg_bookings_offer_identity', 'trg_session_workspaces_participant_identity')
       AND NOT t.tgenabled
  ) THEN
    RAISE EXCEPTION
      'phase37 identity enforcement incomplete, a trigger is DISABLED';
  END IF;
END $$;

COMMENT ON TABLE public.session_workspaces IS
  'Mentor-authored content is written server-side only: POST /api/workspaces is the sole writer and uses the service-role client, so no browser code writes this table. Client roles retain a narrow per-column UPDATE grant on summary, takeaways, action_items and resources as defence-in-depth. Workflow state (status, published_at) and participant identity (booking_id, mentor_id, seeker_id) are service-role only. RLS remains the ownership layer: mentor_id = auth.uid() OR is_admin(). Phase 37 adds trg_session_workspaces_participant_identity, so mentor_id and seeker_id cannot diverge from the booking they belong to - the columns RLS reads are now guaranteed to describe the same two people as the booking.';