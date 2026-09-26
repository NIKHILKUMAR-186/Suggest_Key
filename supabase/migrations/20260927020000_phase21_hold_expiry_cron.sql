-- ==============================================================================
-- SUGGEST KEY - PHASE 21: AUTOMATIC HOLD EXPIRATION & SLOT RELEASE
-- ==============================================================================
-- Enables pg_cron and schedules automatic cleanup of expired slot holds.
-- When a hold expires, the associated PAYMENT_PENDING booking is cancelled
-- and the slot becomes available for new bookings.
-- ==============================================================================

-- Enable pg_cron extension (available in Supabase)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Function to expire stale holds and cancel associated PAYMENT_PENDING bookings
CREATE OR REPLACE FUNCTION public.expire_stale_holds()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expired_count integer := 0;
BEGIN
  -- Expire ACTIVE holds where expires_at <= NOW()
  UPDATE public.slot_holds
  SET status = 'EXPIRED'
  WHERE status = 'ACTIVE'
    AND expires_at <= NOW();

  GET DIAGNOSTICS expired_count = ROW_COUNT;

  -- Cancel PAYMENT_PENDING bookings linked to now-expired holds
  UPDATE public.bookings
  SET status = 'CANCELLED',
      cancellation_reason = 'Payment window expired (15-minute hold elapsed without payment proof)',
      updated_at = NOW()
  WHERE status = 'PAYMENT_PENDING'
    AND hold_id IN (
      SELECT id FROM public.slot_holds WHERE status = 'EXPIRED'
    );

  -- Also expire holds that are ACTIVE but whose booking is no longer PAYMENT_PENDING
  -- (e.g., payment was submitted and booking advanced to PENDING_VERIFICATION)
  -- These should be CONVERTED or RELEASED
  UPDATE public.slot_holds
  SET status = 'RELEASED'
  WHERE status = 'ACTIVE'
    AND id IN (
      SELECT hold_id FROM public.bookings
      WHERE hold_id = slot_holds.id
        AND status NOT IN ('PAYMENT_PENDING')
    );

  RETURN expired_count;
END;
$$;

-- Grant execute to service role for cron
GRANT EXECUTE ON FUNCTION public.expire_stale_holds() TO service_role;

-- Schedule the function to run every minute
-- This ensures holds expire promptly and slots are released
SELECT cron.schedule(
  'expire-stale-holds-every-minute',
  '* * * * *',  -- every minute
  'SELECT public.expire_stale_holds();'
);

-- ==============================================================================
-- VERIFICATION: Check scheduled jobs
-- ==============================================================================
-- SELECT * FROM cron.job WHERE jobname = 'expire-stale-holds-every-minute';