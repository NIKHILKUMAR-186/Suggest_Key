-- =============================================================================
-- SUGGEST KEY — SEEKER EXPERIENCE COMPLETE REBUILD
-- Canonical segment topics + the gig <-> topic relation.
--
-- The seeker topic bar ("All / Career change / First job / Interviews …")
-- must be REAL database content, not a hardcoded list in React, so an admin
-- can add a topic and have it appear without a deployment. Topics belong to
-- exactly one segment, and a gig may only reference topics of its own
-- segment — that ownership rule is enforced by the database, not by the UI.
--
--   segments 1---N segment_topics N---M gig_topics M---N gigs
--
-- `gig_topics` is a relation table, never a duplicated name array on `gigs`,
-- so renaming a topic updates every gig at once.
--
-- Security posture
--   * RLS is ENABLED on both new tables (no exceptions).
--   * Public clients may SELECT only ACTIVE topics of an ACTIVE segment.
--   * Only public.is_admin() may INSERT/UPDATE/DELETE.
--   * A BEFORE INSERT OR UPDATE trigger refuses any pair whose
--     topic.segment_id <> gig.segment_id, so a mentor can never attach a
--     Career topic to a Relationship gig even via a direct API call.
--   * No booking, payment, availability, hold, session or auth object is
--     touched by this migration.
--
-- Idempotent: every statement is IF NOT EXISTS / guarded, safe to re-run.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.segment_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id UUID NOT NULL REFERENCES public.segments(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  slug TEXT NOT NULL CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description TEXT CHECK (description IS NULL OR length(description) <= 200),
  priority INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Unique WITHIN its segment, never globally: two segments may
  -- legitimately both have "Leadership".
  CONSTRAINT uq_segment_topics_segment_slug UNIQUE (segment_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_segment_topics_segment_id ON public.segment_topics(segment_id);

CREATE TABLE IF NOT EXISTS public.gig_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gig_id UUID NOT NULL REFERENCES public.gigs(id) ON DELETE CASCADE,
  topic_id UUID NOT NULL REFERENCES public.segment_topics(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A topic cannot be attached to the same gig twice, even under a race.
  CONSTRAINT uq_gig_topics_gig_topic UNIQUE (gig_id, topic_id)
);

CREATE INDEX IF NOT EXISTS idx_gig_topics_topic_id ON public.gig_topics(topic_id);
CREATE INDEX IF NOT EXISTS idx_gig_topics_gig_id ON public.gig_topics(gig_id);

COMMENT ON TABLE public.gig_topics IS
  'Many-to-many link between a gig and the segment topics it covers. Names live on segment_topics, never duplicated here.';

-- Ownership invariant: topic.segment_id MUST equal gig.segment_id.
-- The application also validates, but a check that only exists in
-- application code can be bypassed by a direct PostgREST call.
CREATE OR REPLACE FUNCTION public.enforce_gig_topic_segment_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_gig_segment UUID;
  v_topic_segment UUID;
BEGIN
  SELECT segment_id INTO v_gig_segment FROM public.gigs WHERE id = NEW.gig_id;
  SELECT segment_id INTO v_topic_segment FROM public.segment_topics WHERE id = NEW.topic_id;

  -- The foreign keys already prevent this; the explicit guard produces a
  -- clean error instead of a NULL comparison that would silently pass.
  IF v_gig_segment IS NULL OR v_topic_segment IS NULL THEN
    RAISE EXCEPTION 'gig_topics: gig or topic does not exist'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_gig_segment <> v_topic_segment THEN
    RAISE EXCEPTION 'Topic % belongs to a different segment than gig %', NEW.topic_id, NEW.gig_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gig_topics_segment_ownership ON public.gig_topics;
CREATE TRIGGER trg_gig_topics_segment_ownership
  BEFORE INSERT OR UPDATE ON public.gig_topics
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_gig_topic_segment_ownership();

CREATE INDEX IF NOT EXISTS idx_segment_topics_active_priority
  ON public.segment_topics(segment_id, priority, name) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_segment_topics_slug ON public.segment_topics(slug);

ALTER TABLE public.segment_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gig_topics ENABLE ROW LEVEL SECURITY;

-- Public read: only ACTIVE topics belonging to an ACTIVE segment.
DROP POLICY IF EXISTS "Anyone can view active segment topics" ON public.segment_topics;
CREATE POLICY "Anyone can view active segment topics"
  ON public.segment_topics
  FOR SELECT
  TO public
  USING (
    is_active = TRUE
    AND EXISTS (
      SELECT 1 FROM public.segments s
      WHERE s.id = segment_topics.segment_id AND s.is_active = TRUE
    )
  );

DROP POLICY IF EXISTS "Admins can manage segment topics" ON public.segment_topics;
CREATE POLICY "Admins can manage segment topics"
  ON public.segment_topics
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- gig_topics is only meaningful together with both parents, so a public
-- reader sees a link only when the gig, its segment and the topic are all
-- active. A draft gig, hidden segment or retired topic stays invisible.
DROP POLICY IF EXISTS "Anyone can view active gig topics" ON public.gig_topics;
CREATE POLICY "Anyone can view active gig topics"
  ON public.gig_topics
  FOR SELECT
  TO public
  USING (
    EXISTS (
      SELECT 1
      FROM public.gigs g
      JOIN public.segments s ON s.id = g.segment_id
      JOIN public.segment_topics t ON t.id = gig_topics.topic_id
      WHERE g.id = gig_topics.gig_id
        AND t.id = gig_topics.topic_id
        AND t.segment_id = g.segment_id
        AND g.is_active = TRUE
        AND t.is_active = TRUE
        AND s.is_active = TRUE
    )
  );

DROP POLICY IF EXISTS "Admins can manage gig topics" ON public.gig_topics;
CREATE POLICY "Admins can manage gig topics"
  ON public.gig_topics
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Realtime: a topic added or retired by an admin must reach an already-open
-- seeker page. The public SELECT policy above is exactly the guarantee a
-- subscriber needs — an anonymous client receives rows only where BOTH the
-- topic and its segment are active. No other policy or grant is modified.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END
$$;

DO $$
DECLARE
  t text := 'public.segment_topics';
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


COMMENT ON TABLE public.segment_topics IS
  'Admin-managed topic taxonomy for a segment. Powers the seeker topic bar and per-gig topic selection. Scoped to exactly one segment.';
