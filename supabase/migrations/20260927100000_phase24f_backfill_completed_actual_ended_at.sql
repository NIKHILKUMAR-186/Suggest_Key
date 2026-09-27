-- Backfill actual_ended_at for bookings that were completed before the column
-- existed (added in phase22/23).
--
-- Every write path that sets status='COMPLETED' records the scheduled end, not
-- the moment it noticed: complete_expired_sessions(),
-- reconcile_expired_sessions(uuid), reconcile_expired_bookings(uuid[]), and
-- persistNaturalSessionCompletion() all write `actual_ended_at = end_time`.
-- Historical rows completed before that convention existed were left with
-- actual_ended_at NULL, which the mentor detail page reads to decide whether to
-- show the "This session was ended on ..." block - so those sessions rendered
-- as finished with no recorded end at all.
--
-- ended_by_role and end_reason stay NULL: a natural expiry is not a manual end,
-- and inventing an actor would misreport who did it.

UPDATE public.bookings
   SET actual_ended_at = end_time
 WHERE status = 'COMPLETED'
   AND end_time IS NOT NULL
   AND actual_ended_at IS NULL;