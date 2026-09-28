-- Phase 7b: Segment hero image storage
--
-- Admins configure a per-segment hero visual (image URL or upload). The image
-- lives in its own PUBLIC bucket so the seeker page can render it without an
-- authenticated request, and without exposing the private payment-proof
-- bucket. Only admins may write; everyone may read.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'segment-hero',
  'segment-hero',
  true,
  5 * 1024 * 1024, -- 5 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Anyone can read segment hero images (public bucket).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'buckets'
      AND policyname = 'Anyone can read segment hero images'
  ) THEN
    CREATE POLICY "Anyone can read segment hero images"
      ON storage.buckets
      FOR SELECT
      TO public
      USING (id = 'segment-hero');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Anyone can read segment hero objects'
  ) THEN
    CREATE POLICY "Anyone can read segment hero objects"
      ON storage.objects
      FOR SELECT
      TO public
      USING (bucket_id = 'segment-hero');
  END IF;
END
$$;

-- Admins can upload / replace / delete segment hero images.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Admins can manage segment hero objects'
  ) THEN
    CREATE POLICY "Admins can manage segment hero objects"
      ON storage.objects
      FOR ALL
      TO authenticated
      USING (
        bucket_id = 'segment-hero'
        AND public.is_admin()
      )
      WITH CHECK (
        bucket_id = 'segment-hero'
        AND public.is_admin()
      );
  END IF;
END
$$;