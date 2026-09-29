-- =============================================================================
-- SUGGEST KEY - PHASE 27: PAYMENT QR BUCKET + platform_config.updated_by
-- =============================================================================
-- Addresses two findings from `payment_audit.md` (P1-1 and P2-2). Both are
-- version-control gaps, not behaviour changes: nothing in this file alters a
-- payment state machine, a booking, a hold, the Razorpay service, or the
-- frontend. Manual UPI/QR remains the default and always-available payment
-- path; Razorpay remains optional and still gated solely on RAZORPAY_ENABLED
-- and the existing credential checks.
--
-- 1. `payment-qr` bucket. `PAYMENT_QR_BUCKET` is referenced by `server.ts`
--    (signQrImageUrl, qr-upload-url, qr delete) and declared in
--    `src/lib/paymentProof.ts`, but no migration ever created the bucket, so a
--    database built purely from `supabase/migrations/` could not accept the
--    admin's UPI QR upload.
--
-- 2. `platform_config.updated_by`. The live table carries this column and
--    `server.ts` writes it on every admin payment-config change, but it appears
--    in no migration. This file captures it so the migration history matches
--    production.
--
-- Everything below is idempotent and additive: `ADD COLUMN IF NOT EXISTS` for
-- the column, `ON CONFLICT DO NOTHING` for the bucket, and
-- `DROP POLICY IF EXISTS` before each `CREATE POLICY` - the same pattern the
-- existing storage migrations in phase4 / phase12 / phase13 already use.
--
-- No existing `payment-proofs` object, policy, or bucket configuration is
-- touched, and no other bucket is read or written by this migration.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. platform_config.updated_by
-- -----------------------------------------------------------------------------
-- Nullable UUID, deliberately WITHOUT a foreign key. The live column has no FK
-- and none is invented here; the requirement is to record the column the
-- production schema already has, not to redesign it. The two sibling columns
-- of this name in the project (`system_log_retention.updated_by`,
-- `login_failure_config.updated_by`) do carry
-- `REFERENCES public.profiles(id) ON DELETE SET NULL`, so a follow-up migration
-- MAY add that constraint if referential integrity is wanted - that is a
-- separate decision and is not taken unilaterally here.
--
-- Adding a nullable column with no default is metadata-only in Postgres, so
-- this neither rewrites the table nor touches the existing single row
-- (`id = 1`). Existing `updated_by` values are preserved untouched.

ALTER TABLE public.platform_config
  ADD COLUMN IF NOT EXISTS updated_by UUID;


-- -----------------------------------------------------------------------------
-- 2. PRIVATE STORAGE BUCKET FOR THE PAYMENT QR
-- -----------------------------------------------------------------------------
-- Object path convention, already enforced server-side by `QR_PATH_PATTERN`
-- at `server.ts:8627`:
--   payment-qr/platform/payment-qr-<13 digits>-<6 chars>.<png|jpg|webp>
-- so every object lives under the `platform/` prefix and nothing else does.
--
-- 2 MB and image/png|jpeg|webp mirror `PAYMENT_QR_MAX_BYTES` and
-- `PAYMENT_QR_MIME_TYPES` in `src/lib/paymentProof.ts`. `application/pdf` is
-- intentionally absent: a payment QR must be scannable straight off a phone
-- screen, which is the same reasoning `validateQrFile()` applies.
--
-- `ON CONFLICT (id) DO NOTHING` - NOT `DO UPDATE`. The bucket already exists in
-- the live project, created by hand, and its `public` flag is currently TRUE.
-- Overwriting `public` here would silently change live behaviour as a side
-- effect of running a migration, so the flag is deliberately NOT touched; see
-- the operator note below. The idempotency goal is "create it if absent", and
-- that is exactly what DO NOTHING guarantees.
--
-- OPERATOR NOTE (an explicit action, not an automated one): the live bucket is
-- public. The application already reads the QR exclusively through a
-- server-minted signed URL (`signQrImageUrl()`, 3600 s TTL, service-role
-- client), so no page depends on public reads. Setting `public = FALSE` for
-- that bucket in the Supabase dashboard is therefore safe and recommended, and
-- is left as a visible operator action rather than hidden inside a migration
-- that also has to be safe to re-run.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-qr',
  'payment-qr',
  FALSE,
  2097152, -- 2MB, mirrors PAYMENT_QR_MAX_BYTES
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;


-- -----------------------------------------------------------------------------
-- 3. STORAGE RLS POLICIES
-- -----------------------------------------------------------------------------
-- Reuses the project's existing `public.is_admin()` authorization helper - the
-- same one `payment-proofs` and `mentor-verification-documents` already use.
-- No new authorization mechanism is introduced.
--
-- Policy shape follows "Admins have full access to verification documents"
-- (phase13) exactly: `FOR ALL TO authenticated` with both `USING` and
-- `WITH CHECK`, so the write path is covered as well as the read path.
--
-- There is deliberately NO policy for `anon`, and none for plain
-- `authenticated` non-admins. Consequences:
--   * anonymous callers can neither list nor fetch objects in this bucket;
--   * a signed-in non-admin cannot read objects directly.
-- Seekers still see the QR, because the application serves it through
-- `GET /api/platform-config` -> `signQrImageUrl()`, which mints a short-lived
-- signed URL using the service-role client. Service-role access bypasses RLS,
-- so that existing flow keeps working unchanged. This is the "server/signed-URL
-- flow" the requirement refers to, and it means no broad read grant is needed.
--
-- This does not weaken `payment-proofs`: that bucket's three policies are not
-- referenced here.

DROP POLICY IF EXISTS "Admins have full access to payment QR" ON storage.objects;
CREATE POLICY "Admins have full access to payment QR"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (
    bucket_id = 'payment-qr' AND public.is_admin()
  )
  WITH CHECK (
    bucket_id = 'payment-qr' AND public.is_admin()
  );
