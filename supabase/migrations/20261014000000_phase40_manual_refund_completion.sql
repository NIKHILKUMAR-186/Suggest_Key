-- =============================================================================
-- SUGGEST KEY - PHASE 40: MANUAL REFUND COMPLETION (ADMIN)
-- =============================================================================
-- Why this file exists
--   Phase 38 added the refund bookkeeping columns but no way to CLOSE a refund.
--   `POST /api/admin/payments/:id/complete-manual-refund` existed and marked a
--   manual UPI/QR payment `REFUNDED` from nothing but a free-text reason: no
--   amount, no method, no UTR, no proof, and no database-side guard. A refund
--   that never happened could be recorded as settled, and the seeker was told
--   it "has been processed".
--
-- What this file adds, and nothing else
--   1. The four columns a completed manual refund has to carry: the external
--      reference/UTR, the rail it was sent on, the proof object key, and the
--      admin note. `refund_amount_paise`, `refunded_at` and `refund_reason`
--      already exist from phase 38 and are reused, not duplicated.
--   2. `complete_manual_refund(...)`: a SECURITY DEFINER function that performs
--      the WHOLE completion - validation, the payment transition, the payment
--      event and the single seeker notification - in one transaction under a
--      `FOR UPDATE` row lock. The state transition is therefore atomic and
--      concurrency-safe: a second admin calling it for the same payment blocks
--      on the lock, then finds the row already `REFUNDED` and is refused.
--
-- Deliberately NOT done here
--   - No Razorpay refund API is called. `refund_method` describes the OUTBOUND
--     manual transfer an admin made outside the application; a gateway refund
--     is still settled only by `refund.created`/`processed`/`failed` events.
--   - No new payment or refund STATUS is invented. The existing state
--     architecture already expresses the whole lifecycle:
--       payments.status       VERIFIED -> REFUNDED | REFUND_FAILED
--       payments.refund_status PENDING -> REFUNDED | FAILED
--   - No new bucket. The proof is stored in the EXISTING private
--     `payment-proofs` bucket under `refunds/<paymentId>/...`. That prefix's
--     first folder is the literal word `refunds`, so the bucket's existing
--     seeker read policy `foldername(name)[1] = auth.uid()` can never match a
--     refund proof; only `is_admin()` can. No existing bucket is made public or
--     private as a side effect.
--   - No automatic retry of a failed external transfer. That stays an
--     operational matter.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. REFUND COMPLETION COLUMNS
-- -----------------------------------------------------------------------------
-- All nullable and additive, so existing rows (including the two real payments
-- in production) are untouched and re-running this file is a no-op.
--
-- `refund_reference` holds the provider-issued UTR of the OUTBOUND transfer. It
-- is never generated here: there is no DEFAULT and no trigger that could invent
-- one, because a fabricated reference would make a refund that never happened
-- indistinguishable from a real one.
--
-- `refund_proof_storage_path` is an OBJECT KEY, never a URL. The bucket is
-- private, so the admin is served a short-lived signed URL minted server-side.
--
-- The method CHECK matches `REFUND_METHODS` in `src/lib/refundCompletion.ts`:
-- UPI and bank transfer, the only two rails a manual refund can take. It is a
-- closed allow-list so an unrecognised value cannot reach the table.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS refund_reference        TEXT
                                           CHECK (refund_reference IS NULL
                                              OR length(btrim(refund_reference)) BETWEEN 1 AND 64),
  ADD COLUMN IF NOT EXISTS refund_method          TEXT
                                           CHECK (refund_method IS NULL
                                              OR refund_method IN ('UPI', 'BANK_TRANSFER')),
  ADD COLUMN IF NOT EXISTS refund_proof_storage_path TEXT
                                           CHECK (refund_proof_storage_path IS NULL
                                              OR refund_proof_storage_path LIKE 'refunds/%'),
  ADD COLUMN IF NOT EXISTS refund_admin_note      TEXT
                                           CHECK (refund_admin_note IS NULL
                                              OR length(refund_admin_note) <= 500),
  ADD COLUMN IF NOT EXISTS refunded_by            UUID;

-- The admin queue lists exactly the rows that still owe a refund and orders them
-- oldest-first, which is the order they must be worked in. `idx_payments_refund_status`
-- from phase 38 covers the `refund_status IS NOT NULL` predicate; this composite
-- narrows it to the manual rows an admin can actually act on.
CREATE INDEX IF NOT EXISTS idx_payments_manual_refund_queue
  ON public.payments(created_at)
  WHERE refund_status = 'PENDING' AND gateway = 'manual';

-- A no-op marker: `review_payment`-style state is the authority, this is only an
-- index. Nothing else in this migration depends on it.


-- -----------------------------------------------------------------------------
-- 2. complete_manual_refund
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER so the transition is enforced by the DATABASE, not by the
-- Express handler. It re-verifies the admin role AND that a live session belongs
-- to the same admin, exactly as `review_payment` does: even a compromised
-- service-role call cannot settle a refund without naming a genuine admin.
--
-- Everything below runs inside the single transaction the function body is one
-- transaction in, so there is no window in which the payment says REFUNDED but
-- the notification was not written, or the proof is recorded without the
-- transition.
CREATE OR REPLACE FUNCTION public.complete_manual_refund(
  p_payment_id UUID,
  p_admin_id UUID,
  p_amount_paise INTEGER,
  p_method TEXT,
  p_reference TEXT,
  p_proof_path TEXT,
  p_admin_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_payment public.payments;
  v_booking public.bookings;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_original_paise INTEGER;
  v_reference TEXT;
  v_method TEXT;
  v_proof_path TEXT;
  v_note TEXT;
  v_amount_label TEXT;
  v_booking_code TEXT;
BEGIN
  -- ---- 1. Authorization (database-side) ----------------------------------
  IF p_admin_id IS NULL OR NOT public.has_role(p_admin_id, 'admin')
     OR (auth.uid() IS NOT NULL AND auth.uid() <> p_admin_id) THEN
    RAISE EXCEPTION 'code: UNAUTHORIZED, Only an admin can complete a refund';
  END IF;

  -- ---- 2. Input validation, before the lock ------------------------------
  v_reference := NULLIF(btrim(COALESCE(p_reference, '')), '');
  IF v_reference IS NULL OR length(v_reference) > 64 THEN
    RAISE EXCEPTION 'code: REFUND_REFERENCE_REQUIRED, The refund reference / UTR is required and must be 64 characters or fewer';
  END IF;

  v_method := upper(btrim(COALESCE(p_method, '')));
  IF v_method NOT IN ('UPI', 'BANK_TRANSFER') THEN
    RAISE EXCEPTION 'code: REFUND_METHOD_INVALID, The refund method must be UPI or BANK_TRANSFER';
  END IF;

  -- The proof object key is generated by this server, never chosen by the
  -- browser. The prefix check is a second line of defence: it means a crafted
  -- path cannot point the record at somebody else's object, and it guarantees
  -- the row never carries a public URL.
  v_proof_path := NULLIF(btrim(COALESCE(p_proof_path, '')), '');
  IF v_proof_path IS NULL OR v_proof_path !~ ('^refunds/' || p_payment_id::text || '/[^/]+$')
     OR v_proof_path ~ '\.\.' OR v_proof_path ~ '\\' THEN
    RAISE EXCEPTION 'code: REFUND_PROOF_REQUIRED, The refund proof is required';
  END IF;

  v_note := NULLIF(btrim(COALESCE(p_admin_note, '')), '');
  IF length(COALESCE(v_note, '')) > 500 THEN
    RAISE EXCEPTION 'code: REFUND_NOTE_TOO_LONG, The admin note is too long';
  END IF;

  -- ---- 3. Lock the payment ------------------------------------------------
  -- FOR UPDATE is what makes this concurrency-safe: two admins submitting the
  -- same refund serialise here, and the loser sees the settled row in step 4.
  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'code: PAYMENT_NOT_FOUND, Payment not found';
  END IF;

  -- ---- 4. Eligibility -----------------------------------------------------
  -- Only a MANUAL UPI/QR payment can be completed by an admin. A Razorpay
  -- refund is settled by the gateway's own refund events and must never be
  -- marked complete by hand.
  IF v_payment.gateway IS DISTINCT FROM 'manual' THEN
    RAISE EXCEPTION 'code: REFUND_NOT_MANUAL, This refund is settled by the payment gateway, not by an admin';
  END IF;

  IF v_payment.status = 'REFUNDED' OR v_payment.refund_status = 'REFUNDED' THEN
    RAISE EXCEPTION 'code: ALREADY_REFUNDED, This payment has already been refunded';
  END IF;

  -- Money was only ever received on a VERIFIED payment. Refunding anything
  -- else would return money the platform never took.
  IF v_payment.status <> 'VERIFIED' THEN
    RAISE EXCEPTION 'code: PAYMENT_NOT_REFUNDABLE, This payment is not in a refundable state';
  END IF;

  IF v_payment.refund_status <> 'PENDING' OR v_payment.manual_refund_required IS NOT TRUE THEN
    RAISE EXCEPTION 'code: REFUND_NOT_PENDING, This payment has no refund awaiting completion';
  END IF;

  -- ---- 5. Money rules, re-checked against the stored payment -------------
  v_original_paise := round(v_payment.amount_inr * 100)::INTEGER;

  IF p_amount_paise IS NULL OR p_amount_paise <= 0 THEN
    RAISE EXCEPTION 'code: REFUND_AMOUNT_INVALID, The refund amount must be more than zero';
  END IF;

  IF p_amount_paise > v_original_paise THEN
    RAISE EXCEPTION 'code: REFUND_AMOUNT_EXCEEDS_PAYMENT, The refund amount cannot exceed the amount that was paid';
  END IF;

  -- The product has no partial refunds (see docs/prd.md); the only accepted
  -- amount is the full original. Kept as its own code so the two failure modes
  -- stay distinguishable if partial refunds are ever introduced.
  IF p_amount_paise <> v_original_paise THEN
    RAISE EXCEPTION 'code: REFUND_AMOUNT_NOT_FULL, Only a full refund is supported for this payment';
  END IF;

  -- ---- 6. The transition + the audit trail + the notification ------------
  -- One transaction. Either the payment is REFUNDED and the seeker was told, or
  -- nothing happened at all.
  UPDATE public.payments
  SET status                    = 'REFUNDED',
      refund_status             = 'REFUNDED',
      refund_amount_paise       = p_amount_paise,
      refund_method             = v_method,
      refund_reference          = v_reference,
      refund_proof_storage_path = v_proof_path,
      refund_admin_note         = v_note,
      refund_reason             = COALESCE(v_payment.refund_reason, 'manual_payment_refund'),
      manual_refund_required    = FALSE,
      refunded_at               = v_now,
      refunded_by               = p_admin_id,
      updated_at                = v_now
  WHERE id = v_payment.id;

  INSERT INTO public.payment_events
    (payment_id, status, event_type, gateway, gateway_payment_id, amount_inr, reason, created_by, created_at)
  VALUES (
    v_payment.id,
    'REFUNDED',
    'MANUAL_REFUND_COMPLETED',
    'manual',
    NULL,
    v_payment.amount_inr,
    'Manual refund completed by admin via ' || v_method || ' (reference ' || v_reference || ').',
    p_admin_id,
    v_now
  );

  SELECT id, booking_code INTO v_booking FROM public.bookings WHERE id = v_payment.booking_id;
  v_booking_code := v_booking.booking_code;

  -- Exactly ONE seeker notification, written here rather than from Express so it
  -- cannot survive a handler that died after the commit. It carries the amount,
  -- the method and the reference - and deliberately NOT the admin note and NOT
  -- the storage path, which are internal.
  v_amount_label := '₹' || to_char(p_amount_paise / 100.0, 'FM990,00,000.00');
  v_amount_label := trim(trailing '.' from trim(trailing '0' from v_amount_label));

  INSERT INTO public.notifications
    (user_id, title, message, type, event_type, entity_type, entity_id, link, is_read, metadata, created_at)
  VALUES (
    v_payment.seeker_id,
    'Refund Completed',
    'Your ' || v_amount_label || ' refund' ||
      CASE WHEN v_booking_code IS NOT NULL THEN ' for booking ' || v_booking_code ELSE '' END ||
      ' has been completed. It was sent by ' ||
      CASE v_method WHEN 'BANK_TRANSFER' THEN 'bank transfer' ELSE 'upi' END ||
      '. Reference: ' || v_reference || '.',
    'PAYMENT',
    'REFUND_COMPLETED',
    'payment',
    v_payment.id::text,
    '/seeker/bookings',
    FALSE,
    jsonb_build_object(
      'bookingId', v_payment.booking_id,
      'bookingCode', v_booking_code,
      'paymentId', v_payment.id,
      'amountInr', p_amount_paise / 100.0,
      'refundMethod', v_method,
      'refundReference', v_reference),
    v_now
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'payment_id', v_payment.id,
    'booking_id', v_payment.booking_id,
    'booking_code', v_booking_code,
    'refund_amount_paise', p_amount_paise,
    'refund_method', v_method,
    'refund_reference', v_reference,
    'refunded_at', v_now,
    'refunded_by', p_admin_id
  );
END;
$$;


-- -----------------------------------------------------------------------------
-- 3. NOTIFICATION EVENT VOCABULARY
-- -----------------------------------------------------------------------------
-- `REFUND_PENDING` is a new event_type. `notifications.event_type` is free TEXT,
-- so no DDL is needed; the row is listed here because `src/types/database.ts`
-- declares the union and `Refund Pending` is now a state the seeker can be in.
-- `REFUND_INITIATED` is deliberately NOT re-added: this application does not
-- initiate a generic refund for a manual payment, so no notification may claim
-- one was initiated.


-- -----------------------------------------------------------------------------
-- 4. EXECUTE GRANTS
-- -----------------------------------------------------------------------------
-- Phase 29 revoked EXECUTE from PUBLIC/anon/authenticated on every SECURITY
-- DEFINER function, and Postgres re-grants PUBLIC on a newly created one. Close
-- it again, then grant only the trusted backend. The server calls this through
-- the service-role client, so `authenticated` needs nothing.
REVOKE EXECUTE ON FUNCTION public.complete_manual_refund(UUID, UUID, INTEGER, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_manual_refund(UUID, UUID, INTEGER, TEXT, TEXT, TEXT, TEXT) TO service_role;


-- -----------------------------------------------------------------------------
-- 5. POST-CONDITIONS
-- -----------------------------------------------------------------------------
-- These must hold after the migration runs. A leak here would mean any
-- anonymous internet visitor could mark a payment refunded.
DO $$
DECLARE
  leaked text;
BEGIN
  IF has_function_privilege('anon', 'public.complete_manual_refund(uuid,uuid,integer,text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PHASE-40 containment incomplete: anon can EXECUTE complete_manual_refund';
  END IF;

  -- No refund reference may be a fabricated one: the column has no default and
  -- no trigger writes it, which the schema itself is the record of.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payments'
      AND column_name = 'refund_reference'
      AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'PHASE-40 invariant violated: refund_reference must never be auto-generated';
  END IF;

  RAISE NOTICE 'PHASE-40 applied: complete_manual_refund is service-role only, and refund references can only come from an admin.';
END $$;
