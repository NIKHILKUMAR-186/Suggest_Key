-- ==============================================================================
-- SUGGEST KEY - PHASE 23: SESSION END BY ROLE
-- ==============================================================================
-- Records WHO ended a CONFIRMED session when it was concluded early.
--
-- `ended_by_role` is null for sessions that completed naturally at their
-- scheduled end_time (no manual action). When a mentor or seeker clicks
-- "End Session" the column is set to the caller's role so the audit trail can
-- distinguish an early manual end from a natural conclusion without relying
-- on a heuristic comparison of actual_ended_at against end_time.
--
-- The column is deliberately nullable: a natural expiry writes COMPLETED
-- without touching it, and the existing rows keep working untouched.
-- ==============================================================================

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS ended_by_role text;

-- Constrain the column to the three roles that may ever end a session.
-- `CHECK` is added with a name so a re-run of this migration cannot fail on
-- an already-existing constraint.
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_ended_by_role_check
  CHECK (ended_by_role IS NULL OR ended_by_role IN ('mentor', 'seeker', 'admin'));

-- Index to accelerate "who ended this session" lookups for admin reporting.
CREATE INDEX IF NOT EXISTS idx_bookings_ended_by_role
  ON public.bookings(ended_by_role)
  WHERE ended_by_role IS NOT NULL;