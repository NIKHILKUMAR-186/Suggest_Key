-- ==============================================================================
-- SUGGEST KEY - PHASE 43: RESTORE PUBLIC SEGMENT-HERO BUCKET
-- ==============================================================================
-- Phase 7b created the `segment-hero` bucket as public so landing-page hero
-- images could be served without authentication. Phase 19's security lockdown
-- blanket-set every bucket to `public = FALSE`, which broke those public URLs.
--
-- This migration restores the intended public access for the `segment-hero`
-- bucket only. All other buckets remain private. The storage RLS policies from
-- Phase 7b already allow public SELECT on this bucket's objects, so no policy
-- change is required.

UPDATE storage.buckets
SET public = TRUE
WHERE id = 'segment-hero'
  AND public = FALSE;
