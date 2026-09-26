-- ==============================================================================
-- SUGGEST KEY - PHASE 22: SESSION END TRACKING (actual_ended_at)
-- ==============================================================================
-- Records the authoritative instant a mentor manually ends a CONFIRMED session.
--
-- A null actual_ended_at means the session has NOT yet been manually ended.
-- The row is transitioned to COMPLETED either by:
--   - the mentor End Session action (sets actual_ended_at + COMPLETED), or
--   - natural expiration at scheduled end_time (sets COMPLETED, actual_ended_at stays null).
--
-- In every case where actual_ended_at IS set, the meeting_url is revoked from
-- seekers so the link cannot be reused after the mentor has closed the room.
-- ==============================================================================

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS actual_ended_at TIMESTAMPTZ;

-- Index to accelerate "is this session manually ended?" lookups
CREATE INDEX IF NOT EXISTS idx_bookings_actual_ended_at
  ON public.bookings(actual_ended_at)
  WHERE actual_ended_at IS NOT NULL;

-- Index to accelerate mentor end-of-session sweeps
CREATE INDEX IF NOT EXISTS idx_bookings_mentor_status_completed
  ON public.bookings(mentor_id, status, actual_ended_at)
  WHERE status = 'CONFIRMED' AND actual_ended_at IS NULL;
