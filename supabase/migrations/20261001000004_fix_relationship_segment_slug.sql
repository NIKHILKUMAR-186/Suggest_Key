-- =============================================================================
-- Correct the relationship segment's public slug and display name.
--
-- The row shipped as `relationship-advisior` / "Relationship Advisior" - a
-- typo in both. It is a real bug, not cosmetic: the seeker URL is the source
-- of truth for which segment renders, so `/seeker?segment=relationship-advisor`
-- matched nothing, silently fell back to the highest-priority segment and
-- rendered the WRONG experience. The stylesheet's
-- `[data-segment="relationship-advisor"]` palette never matched either.
--
-- Only the public-facing identifier and label change. The primary key is
-- untouched, so every foreign key that points at this segment
-- (`mentor_segments`, `gigs`, `segment_topics`, `experience_config`) is
-- unaffected.
--
-- Idempotent: a re-run updates nothing.
-- =============================================================================

UPDATE public.segments
   SET slug = 'relationship-advisor',
       name = 'Relationship Advisor',
       updated_at = now()
 WHERE slug = 'relationship-advisior';

-- -----------------------------------------------------------------------------
-- The relationship experience was the only segment saved without a configured
-- accent, so it silently inherited the generic brand purple while every other
-- segment carried its own identity. Give it the same rose the stylesheet's
-- `[data-segment="relationship-advisor"]` palette already uses, so the saved
-- config and the CSS agree.
--
-- Additive only: an admin who has since chosen a different accent keeps it.
-- -----------------------------------------------------------------------------

UPDATE public.segments
   SET experience_config = jsonb_set(experience_config, '{branding,accent}', '"#db2777"'::jsonb, true),
       updated_at = now()
 WHERE slug = 'relationship-advisor'
   AND (COALESCE(experience_config, '{}'::jsonb) #>> '{branding,accent}') IS NULL;
