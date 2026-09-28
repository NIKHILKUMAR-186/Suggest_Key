-- ==============================================================================
-- SUGGEST KEY - PHASE 25: PAYMENT FOUNDATION (Razorpay-ready)
-- ==============================================================================
-- Extends the manual-UQR payment flow so the same tables can also carry
-- gateway-originated payments without a schema redesign.
--
-- Changes
--   1. platform_config  — idempotent create + hold_duration_minutes column
--   2. payments         — Razorpay columns (all nullable, safe for existing rows)
--   3. payments         — proof_storage_path becomes nullable
--   4. bookings.status  — add PAYMENT_PROCESSING to CHECK
--   5. payments.status  — add PAYMENT_PENDING, PAYMENT_PROCESSING, FAILED,
--                         REFUNDED, REFUND_FAILED to CHECK
--   6. payment_events   — new append-only lifecycle log
--   7. webhook_events   — new idempotent gateway-event store
--   8. indexes          — Razorpay lookup + payment_events + webhook_events
--   9. realtime         — payments, payment_events, webhook_events added
--  10. RLS + grants     — new tables locked to admin/service_role paths
-- ==============================================================================

-- ==============================================================================
-- 1. PLATFORM_CONFIG
-- ==============================================================================
-- The table already exists in production (created via SQL editor); this block
-- is idempotent and adds hold_duration_minutes without touching existing rows.

CREATE TABLE IF NOT EXISTS public.platform_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  upi_id TEXT,
  qr_image_storage_path TEXT,
  payment_instructions TEXT,
  currency TEXT,
  payment_account_name TEXT,
  hold_duration_minutes INTEGER NOT NULL DEFAULT 5,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.platform_config
  ADD COLUMN IF NOT EXISTS hold_duration_minutes INTEGER NOT NULL DEFAULT 5;

-- Seed default if the row is empty (idempotent)
INSERT INTO public.platform_config (id, hold_duration_minutes)
VALUES (1, 5)
ON CONFLICT (id) DO UPDATE
  SET hold_duration_minutes = COALESCE(platform_config.hold_duration_minutes, 5);


-- ==============================================================================
-- 2. PAYMENTS — Razorpay gateway columns (all nullable; safe for existing rows)
-- ==============================================================================

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS gateway           TEXT DEFAULT 'manual'
                                          CHECK (gateway IN ('manual', 'razorpay')),
  ADD COLUMN IF NOT EXISTS razorpay_order_id  TEXT,
  ADD COLUMN IF NOT EXISTS razorpay_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS razorpay_signature  TEXT,
  ADD COLUMN IF NOT EXISTS captured_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refund_id          TEXT,
  ADD COLUMN IF NOT EXISTS refund_status      TEXT
                                          CHECK (refund_status IS NULL
                                            OR refund_status IN ('PENDING', 'FAILED', 'REFUNDED')),
  ADD COLUMN IF NOT EXISTS failure_reason     TEXT,
  ADD COLUMN IF NOT EXISTS gateway_payload    JSONB;


-- ==============================================================================
-- 3. PAYMENTS — proof_storage_path nullable (gateway payments have no proof)
-- ==============================================================================

ALTER TABLE public.payments ALTER COLUMN proof_storage_path DROP NOT NULL;


-- ==============================================================================
-- 4. BOOKINGS.status — extend CHECK with PAYMENT_PROCESSING
-- ==============================================================================
-- The inline CHECK created in phase4 is auto-named bookings_status_check by
-- PostgreSQL. Drop it by that name and re-add with the extended enum.

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;

ALTER TABLE public.bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN (
    'PAYMENT_PENDING',
    'PAYMENT_PROCESSING',
    'PENDING_VERIFICATION',
    'MENTOR_PENDING',
    'CONFIRMED',
    'COMPLETED',
    'CANCELLED',
    'REJECTED'
  ));


-- ==============================================================================
-- 5. PAYMENTS.status — extend CHECK with Razorpay-compatible statuses
-- ==============================================================================

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_status_check;

ALTER TABLE public.payments ADD CONSTRAINT payments_status_check
  CHECK (status IN (
    'PENDING_VERIFICATION',
    'VERIFIED',
    'REJECTED',
    'PAYMENT_PENDING',
    'PAYMENT_PROCESSING',
    'FAILED',
    'REFUNDED',
    'REFUND_FAILED'
  ));


-- ==============================================================================
-- 6. PAYMENT_EVENTS — append-only payment lifecycle log
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.payment_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id      UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  status          TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  gateway         TEXT,
  gateway_payment_id TEXT,
  amount_inr      INTEGER CHECK (amount_inr >= 0),
  reason          TEXT,
  created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_events_payment_id
  ON public.payment_events(payment_id);

CREATE INDEX IF NOT EXISTS idx_payment_events_status
  ON public.payment_events(status);


-- ==============================================================================
-- 7. WEBHOOK_EVENTS — idempotent gateway-event store
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway       TEXT NOT NULL,
  event_id      TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  payload       JSONB NOT NULL,
  processed     BOOLEAN NOT NULL DEFAULT FALSE,
  processed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_webhook_gateway_event UNIQUE (gateway, event_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_processed
  ON public.webhook_events(processed)
  WHERE processed = FALSE;

CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at
  ON public.webhook_events(created_at);


-- ==============================================================================
-- 8. INDEXES — Razorpay lookups
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_payments_razorpay_order
  ON public.payments(razorpay_order_id)
  WHERE razorpay_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_razorpay_payment
  ON public.payments(razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_gateway_status
  ON public.payments(gateway, status);


-- ==============================================================================
-- 9. REALTIME PUBLICATION — add new tables
-- ==============================================================================
-- Follows the idempotent DO-block pattern from phase17.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'public.mentor_availability',
      'public.mentor_availability_exceptions',
      'public.slot_holds',
      'public.bookings',
      'public.gigs',
      'public.payments',
      'public.payment_events',
      'public.webhook_events'
    ])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = split_part(t, '.', 1)
        AND tablename = split_part(t, '.', 2)
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %s;', t);
    END IF;
  END LOOP;
END
$$;


-- ==============================================================================
-- 10. ROW LEVEL SECURITY — new tables
-- ==============================================================================

ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;


-- payment_events: seeker views own booking's events; admin full access
DROP POLICY IF EXISTS "Seekers can view own payment events"
  ON public.payment_events;
CREATE POLICY "Seekers can view own payment events"
  ON public.payment_events FOR SELECT
  USING (
    payment_id IN (
      SELECT pe.payment_id
      FROM public.payment_events pe
      JOIN public.payments p ON p.id = pe.payment_id
      WHERE p.seeker_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins can manage payment events"
  ON public.payment_events;
CREATE POLICY "Admins can manage payment events"
  ON public.payment_events FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- webhook_events: admin full access; no browser read path
DROP POLICY IF EXISTS "Admins can manage webhook events"
  ON public.webhook_events;
CREATE POLICY "Admins can manage webhook events"
  ON public.webhook_events FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ==============================================================================
-- 11. GRANTS — follow phase19 lockdown pattern for new tables
-- ==============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_events    TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.webhook_events   TO authenticated, service_role;
GRANT ALL ON public.payment_events                               TO service_role;
GRANT ALL ON public.webhook_events                              TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public           TO authenticated;
