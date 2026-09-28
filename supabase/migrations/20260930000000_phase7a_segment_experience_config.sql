ALTER TABLE public.segments
ADD COLUMN IF NOT EXISTS experience_config JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.segments.experience_config IS 'MVP per-segment experience configuration rendered on the seeker side.';
