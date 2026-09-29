-- =============================================================================
-- SUGGEST KEY - PHASE 28: UNMATCHED RAZORPAY CAPTURE LEDGER (P0-1)
-- =============================================================================
-- Fixes the money-loss path found in `payment_audit.md` (P0-1).
--
-- The problem
-- ----------
-- A `payment.captured` webhook is signed, valid, and the money has moved, but
-- `resolveWebhookPayment()` cannot find a local `payments` row (the row was
-- never written, was purged, or a retry re-armed it and cleared its gateway
-- ids). The old behaviour was to return `handled = 'unmatched'`, write
-- nothing, and let the route answer 200. Razorpay therefore stopped retrying
-- and the captured money had NO local record and NO way to discover one.
--
-- Why a new table
-- ---------------
-- `webhook_events` already stores the payload, but it cannot represent this
-- state safely:
--   * it has no financial identifiers (no payment id, order id, amount or
--     currency as queryable columns),
--   * it carries no `reconciliation_status`, so a capture awaiting a human is
--     indistinguishable from one that was handled,
--   * and it is completed (`processed = true`) on acknowledgement, so a row
--     that represents an unresolved capture would be skipped as a duplicate on
--     redelivery instead of being resumed.
-- `payment_events` cannot be used either: it is FK-bound to a real `payments`
-- row, and this fix must never fabricate one.
--
-- So a new, narrowly scoped ledger is added. It is an EXCEPTION / RECONCILIATION
-- record only. It is never written by the normal capture path, never implies a
-- confirmed payment, and never advances a booking.
--
-- Nothing in this file touches `payments`, `payment_events`, `webhook_events`,
-- `bookings`, or any existing CHECK constraint. Manual UPI/QR is unaffected.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. THE LEDGER
-- -----------------------------------------------------------------------------
-- Idempotency
-- -----------
-- `uq_unmatched_capture_financial UNIQUE (gateway, razorpay_payment_id)` is the
-- financial identity of the exception: one captured gateway payment produces at
-- most ONE row, no matter how many deliveries or how many distinct event ids
-- describe it. This is strictly stronger than keying on `(gateway, event_id)`,
-- which would still let a re-signed replay create a second financial record.
-- A redelivery or a new event id for the same payment therefore collides and is
-- absorbed by an upsert that bumps `delivery_count` and `last_event_id`, so the
-- first-seen evidence is preserved while the redelivery count stays auditable.
--
-- `amount_paise INTEGER` matches the project's existing integer-money convention
-- (`payments.amount_inr INTEGER`, `payment_events.amount_inr INTEGER`). The
-- service only writes a value it has already range-checked.
--
-- `resolved_payment_id` references `payments(id)` ON DELETE SET NULL: it records
-- what an operator attached the capture to, and survives the payment being
-- removed. It is a record of the reconciliation, never an instruction to pay.

CREATE TABLE IF NOT EXISTS public.razorpay_unmatched_captures (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway             TEXT NOT NULL DEFAULT 'razorpay'
                        CHECK (gateway IN ('razorpay')),
  -- First event id that revealed the exception. Kept even after redeliveries.
  event_id            TEXT NOT NULL,
  -- Most recent event id seen for the same captured payment.
  last_event_id       TEXT,
  event_type          TEXT NOT NULL,
  razorpay_payment_id TEXT NOT NULL,
  razorpay_order_id   TEXT,
  amount_paise        INTEGER,
  currency            TEXT,
  received_at         TIMESTAMPTZ NOT NULL,
  -- Machine-readable, e.g. PAYMENT_ROW_NOT_FOUND.
  reason              TEXT NOT NULL,
  -- The original webhook payload, retained verbatim for later reconciliation.
  payload             JSONB NOT NULL,
  reconciliation_status TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (reconciliation_status IN ('PENDING', 'RESOLVED', 'CONFLICT')),
  -- How many deliveries have been absorbed for this captured payment.
  delivery_count      INTEGER NOT NULL DEFAULT 1,
  last_received_at    TIMESTAMPTZ,
  resolved_payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
  resolved_at         TIMESTAMPTZ,
  resolved_by         UUID,
  resolution_note     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_unmatched_capture_financial UNIQUE (gateway, razorpay_payment_id)
);



-- -----------------------------------------------------------------------------
-- 2. INDEXES
-- -----------------------------------------------------------------------------
-- The operational queue: what an operator has to work through.
CREATE INDEX IF NOT EXISTS idx_unmatched_captures_pending
  ON public.razorpay_unmatched_captures (received_at)
  WHERE reconciliation_status = 'PENDING';

-- Reconciliation matches on the order id when the payment id is unknown.
CREATE INDEX IF NOT EXISTS idx_unmatched_captures_order_id
  ON public.razorpay_unmatched_captures (razorpay_order_id)
  WHERE razorpay_order_id IS NOT NULL;

-- Traceability of an individual gateway event.
CREATE INDEX IF NOT EXISTS idx_unmatched_captures_event_id
  ON public.razorpay_unmatched_captures (event_id);


-- -----------------------------------------------------------------------------
-- 3. RLS AND GRANTS
-- -----------------------------------------------------------------------------
-- Service role is the only writer. Admins may inspect and reconcile. A browser
-- (seeker or otherwise) can neither create nor modify a row: the single policy
-- is admin-gated, and the grant below gives `authenticated` SELECT only, so a
-- non-admin browser caller has neither the row-level permission nor a policy
-- that would let it read.
--
-- `is_admin()` is the project's existing authorization helper; no new
-- authorization mechanism is introduced.

ALTER TABLE public.razorpay_unmatched_captures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage razorpay unmatched captures"
  ON public.razorpay_unmatched_captures;
CREATE POLICY "Admins can manage razorpay unmatched captures"
  ON public.razorpay_unmatched_captures
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Writers use the service role, which bypasses RLS. `authenticated` is granted
-- SELECT only so the admin UI can read through the policy above while no client
-- can write, even if some future code path tried.
GRANT SELECT ON public.razorpay_unmatched_captures TO authenticated;
GRANT ALL    ON public.razorpay_unmatched_captures TO service_role;

COMMENT ON TABLE public.razorpay_unmatched_captures IS
  'Exception ledger for Razorpay captures that could not be matched to a local payments row (audit P0-1). A row here means money moved and the platform has no confirmed payment for it. It is never a confirmed payment and never advances a booking. Rows are written only by the service role on a correctly signed webhook, are unique per captured gateway payment, and are resolved by an explicit operator reconciliation.';

