-- =============================================================================
-- PHASE 42: PAYMENT QR BUCKET - ENSURE PRIVATE
-- =============================================================================
--
-- WHY THIS EXISTS
-- ---------------
-- The Phase 27 migration (20261002000000) created the `payment-qr` bucket with
-- `public = FALSE` but used `ON CONFLICT (id) DO NOTHING`. This means if the
-- bucket already existed in production (which it did, created manually), its
-- `public` flag was NOT changed - it remains `TRUE` (public).
--
-- The application DOES NOT depend on public reads:
--   * Admin uploads: server mints a signed upload URL (service-role client)
--   * Seeker reads: server mints a signed download URL via `signQrImageUrl()`
--     (service-role client, 3600s TTL)
--   * Admin reads: same signed download URL flow
--
-- Both flows use the service-role Supabase client which bypasses RLS entirely.
-- Making the bucket private is therefore safe and removes the risk of an
-- accidental direct public URL exposure.
--
-- This migration uses ON CONFLICT DO UPDATE to ensure the public flag is
-- corrected even on an existing bucket.
--
-- VERIFICATION
-- ------------
-- After applying, run the verification function:
--   SELECT * FROM verify_payment_qr_bucket_private();
-- It returns a single row with bucket_id, is_public, and a status message.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Ensure the payment-qr bucket is PRIVATE
-- -----------------------------------------------------------------------------
-- Use DO UPDATE to force the public flag to FALSE even if the bucket exists.
-- This is idempotent: re-running it keeps the bucket private.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-qr',
  'payment-qr',
  FALSE,
  2097152, -- 2MB, mirrors PAYMENT_QR_MAX_BYTES
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = FALSE,
  file_size_limit = 2097152,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp'];


-- -----------------------------------------------------------------------------
-- 2. Verification function: confirms bucket is private
-- -----------------------------------------------------------------------------
-- Returns one row with bucket_id, is_public, and a human-readable status.
-- Use this in CI, a manual check, or a post-deploy smoke test.
CREATE OR REPLACE FUNCTION public.verify_payment_qr_bucket_private()
RETURNS TABLE (
  bucket_id text,
  is_public boolean,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Containment: ensure 'anon' cannot execute this SECURITY DEFINER function
  IF has_function_privilege('anon', 'public.verify_payment_qr_bucket_private()', 'EXECUTE') THEN
    RAISE EXCEPTION 'SECURITY DEFINER containment violated: anon has EXECUTE on verify_payment_qr_bucket_private';
  END IF;

  RETURN QUERY
  SELECT
    b.id AS bucket_id,
    b.public AS is_public,
    CASE
      WHEN b.id IS NULL THEN 'BUCKET_NOT_FOUND: payment-qr bucket does not exist'
      WHEN b.public THEN 'FAIL: payment-qr bucket is PUBLIC (should be private)'
      ELSE 'OK: payment-qr bucket is private'
    END AS status
  FROM storage.buckets b
  WHERE b.id = 'payment-qr';
END;
$$;

COMMENT ON FUNCTION public.verify_payment_qr_bucket_private() IS
  'Verifies the payment-qr storage bucket is private (public = FALSE). '
  'Returns OK/FAIL status. Safe to call from any context - SECURITY DEFINER '
  'runs with the function owner''s privileges.';


-- -----------------------------------------------------------------------------
-- 3. RLS policy already exists from Phase 27 (Admins have full access)
--    No changes needed - the policy correctly restricts direct access to admins.
--    The signed-URL flow via service-role client bypasses RLS and continues
--    to work when the bucket is private.
-- =============================================================================