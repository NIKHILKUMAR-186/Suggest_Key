-- ==============================================================================
-- SUGGEST KEY - PHASE 38: REFUND SYSTEM ENHANCEMENTS
-- ==============================================================================
-- Adds comprehensive refund tracking to the payments table for the automated
-- refund system. Supports both Razorpay gateway refunds and manual payment
-- refunds requiring admin action.
-- ==============================================================================

-- ==============================================================================
-- 1. PAYMENTS — Additional refund tracking columns
-- ==============================================================================

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS refund_amount_paise  INTEGER
                                          CHECK (refund_amount_paise IS NULL OR refund_amount_paise >= 0),
  ADD COLUMN IF NOT EXISTS refunded_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refund_reason       TEXT
                                          CHECK (refund_reason IS NULL
                                             OR refund_reason IN (
                                               'seeker_cancellation_within_window',
                                               'seeker_cancellation_outside_window',
                                               'mentor_cancellation',
                                               'mentor_rejection',
                                               'admin_refund',
                                               'manual_payment_refund'
                                             )),
  ADD COLUMN IF NOT EXISTS manual_refund_required BOOLEAN NOT NULL DEFAULT FALSE;

-- Add index for refund queries
CREATE INDEX IF NOT EXISTS idx_payments_refund_status
  ON public.payments(refund_status)
  WHERE refund_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_manual_refund_required
  ON public.payments(manual_refund_required)
  WHERE manual_refund_required = TRUE;

-- ==============================================================================
-- 2. PAYMENT_EVENTS — Add refund event types
-- ==============================================================================
-- The existing payment_events table already supports arbitrary event_type values.
-- We just document the new event types here for reference:
--   REFUND_INITIATED      - Refund request sent to gateway (Razorpay)
--   REFUND_PROCESSED      - Refund completed successfully
--   REFUND_FAILED         - Refund failed (gateway or internal)
--   MANUAL_REFUND_REQUIRED - Manual payment marked for admin refund action
--   MANUAL_REFUND_COMPLETED - Admin completed manual refund
-- No schema change needed - event_type is TEXT.

-- ==============================================================================
-- 3. NOTIFICATIONS — Add refund notification event types
-- ==============================================================================
-- The existing notifications table uses TEXT for event_type.
-- New event types for refunds:
--   REFUND_INITIATED      - Refund has been initiated
--   REFUND_COMPLETED      - Refund has been processed
--   REFUND_FAILED         - Refund failed
--   MANUAL_REFUND_REQUIRED - Manual payment needs admin refund action
-- No schema change needed - event_type is TEXT.

-- ==============================================================================
-- 4. PLATFORM_CONFIG — Add refund configuration
-- ==============================================================================

ALTER TABLE public.platform_config
  ADD COLUMN IF NOT EXISTS normal_cancellation_window_minutes INTEGER NOT NULL DEFAULT 10;

-- Update existing row if it doesn't have the new column value
UPDATE public.platform_config
SET normal_cancellation_window_minutes = 10
WHERE id = 1 AND normal_cancellation_window_minutes IS NULL;

-- ==============================================================================
-- 5. RLS POLICIES — Ensure new columns are accessible
-- ==============================================================================
-- Existing RLS policies on payments table already cover all columns.
-- No additional policies needed since the columns are part of the payments table.

-- ==============================================================================
-- 6. GRANTS — Follow existing pattern
-- ==============================================================================
-- Existing grants on payments table already cover all columns.
-- No additional grants needed.