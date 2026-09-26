-- Realtime publication for mentor availability / booking synchronisation.
--
-- `supabase_realtime` existed but was EMPTY, so no postgres_changes event could
-- ever reach the browser. Adding exactly the rows the slot engine reads.
--
-- Note on RLS: Supabase Realtime evaluates the subscriber's RLS policies for
-- postgres_changes. `mentor_availability` and `mentor_availability_exceptions`
-- are already readable by anyone for a publicly visible mentor, so a mentor's
-- schedule edit propagates to open seeker pages immediately. `bookings` and
-- `slot_holds` are participant-scoped by policy, so a seeker receives events
-- for their own reservations only; changes made by other seekers are picked up
-- by the targeted revalidation in the client instead.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'public.mentor_availability',
      'public.mentor_availability_exceptions',
      'public.slot_holds',
      'public.bookings',
      'public.gigs'
    ])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = split_part(t, '.', 1)
        AND tablename = split_part(t, '.', 2)
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %s;', t);
    END IF;
  END LOOP;
END
$$;

-- Realtime DELETE events are only filterable on primary-key columns unless the
-- table carries a full replica identity. `mentor_availability` is written with
-- replace-all semantics (DELETE the mentor's windows, then INSERT the new set),
-- so without this a client filtering on `mentor_id=eq.<uuid>` would never see the
-- deletions and would keep rendering times the mentor has just removed.
ALTER TABLE public.mentor_availability REPLICA IDENTITY FULL;
ALTER TABLE public.mentor_availability_exceptions REPLICA IDENTITY FULL;
ALTER TABLE public.slot_holds REPLICA IDENTITY FULL;
ALTER TABLE public.bookings REPLICA IDENTITY FULL;
ALTER TABLE public.gigs REPLICA IDENTITY FULL;
