-- =============================================================================
-- SUGGEST KEY - PHASE 39: COUPON LIFECYCLE + ORIGINAL PRICE
-- =============================================================================
-- Problem
--   A booking's payable amount (`bookings.amount_inr`) is written once, at hold
--   creation, from `gigs.price_inr`, and never changes. There is no discount
--   concept, and no way to show a seeker what a session "used to cost".
--
-- Fix
--   1. `gigs.original_price_inr` - the pre-discount price. Nullable, and
--      constrained to be strictly GREATER than `price_inr`, so a "was
--      ₹2,499 / now ₹1,999" card can never be a fake saving: if there is no
--      genuine reduction there is no original price and the UI shows one
--      number, not two.
--   2. `coupons` + `coupon_usage` - the discount and its per-booking state.
--   3. Three booking snapshot columns (`base_amount_inr`,
--      `discount_amount_inr`, `original_amount_inr`) plus `coupon_id` /
--      `coupon_code`. `amount_inr` remains the snapshotted FINAL payable
--      amount, so Razorpay order creation (which already reads only
--      `bookings.amount_inr`) needs no change.
--   4. Two RPCs, `apply_coupon_to_booking` and `remove_coupon_from_booking`,
--      which are the ONLY writers of the pricing snapshot.
--   5. Status triggers on `bookings`, which is what makes the lifecycle
--      correct everywhere at once.
--
-- Why triggers rather than calls sprinkled through the server
--   The lifecycle has to fire from more than one place, and every place is a
--   place that can be forgotten:
--
--     bookings -> MENTOR_PENDING   payment verified (Razorpay capture), OR
--                                  payment approved (manual, `review_payment`)
--     bookings -> REJECTED         admin rejected a manual proof
--     bookings -> CANCELLED        hold expiry, seeker cancel, mentor cancel
--
--   All four write `bookings.status`, and all four already exist as SQL or as a
--   conditional update in `razorpayStore.markBookingMentorPending`. One AFTER
--   UPDATE trigger therefore covers manual QR, Razorpay browser verification,
--   the Razorpay webhook, and the cron sweep, with no fourth implementation to
--   keep in sync and no path that can pay out without redeeming the coupon.
--
-- Concurrency
--   `apply_coupon_to_booking` takes `SELECT ... FOR UPDATE` on the coupon row
--   BEFORE counting usage. Every reservation for one coupon therefore
--   serialises on that row, so the `max_total_uses` / `max_uses_per_user`
--   checks read a committed count and the last writer cannot overshoot the
--   limit. The booking row is locked first for the same reason, so two
--   concurrent applies cannot both write the snapshot.
--
-- Why not a nullable `base_amount_inr`
--   It is NOT NULL. Existing rows are backfilled to their own `amount_inr`
--   (a booking created before coupons existed genuinely had a base equal to
--   what it paid) and then the column is locked with
--   `amount_inr = base_amount_inr - discount_amount_inr`, so the arithmetic
--   cannot drift from the amount Razorpay actually charges.
--
-- Deliberately NOT done here
--   - No historical booking is repriced. `amount_inr` for existing rows is
--     untouched and a booking created before this migration keeps its original
--     payable amount forever.
--   - `original_price_inr` is mentor/admin-authored through the existing gig
--     write routes. It is not derived from a coupon, so a coupon expiring
--     never silently rewrites a published price.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. GIG ORIGINAL PRICE
-- -----------------------------------------------------------------------------
-- `> price_inr`, not `>=`: a zero-saving "original price" is the exact thing
-- that makes a struck-through price a lie.
ALTER TABLE public.gigs
  ADD COLUMN IF NOT EXISTS original_price_inr INTEGER
    CHECK (original_price_inr IS NULL OR (original_price_inr > price_inr AND original_price_inr <= 10000000));

COMMENT ON COLUMN public.gigs.original_price_inr IS
  'Pre-discount list price in INR. NULL when the gig has never been reduced, which is the only case in which no original price is shown.';

-- -----------------------------------------------------------------------------
-- 2. COUPONS
-- -----------------------------------------------------------------------------
-- `discount_type = 'FIXED'` uses `discount_value` as rupees;
-- `PERCENTAGE` uses it as whole percent and is additionally capped by
-- `max_discount_inr` when set. Exactly one of the two is meaningful per row and
-- the CHECK below keeps the percentage inside 1..100.
CREATE TABLE IF NOT EXISTS public.coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Upper-case, digits and underscores only. The code is typed by humans into a
  -- checkout field, so the alphabet is deliberately narrow and a CHECK (not just
  -- application validation) is the authority on it.
  code TEXT NOT NULL UNIQUE
    CHECK (code ~ '^[A-Z0-9_]{4,24}$'),
  description TEXT
    CHECK (description IS NULL OR length(description) <= 300),
  discount_type TEXT NOT NULL
    CHECK (discount_type IN ('PERCENTAGE', 'FIXED')),
  discount_value INTEGER NOT NULL
    CHECK (discount_value > 0 AND (discount_type = 'FIXED' OR discount_value <= 100)),
  -- Only meaningful for PERCENTAGE: the ceiling on a percentage discount.
  max_discount_inr INTEGER
    CHECK (max_discount_inr IS NULL OR (max_discount_inr > 0 AND discount_type = 'PERCENTAGE')),
  min_order_amount_inr INTEGER NOT NULL DEFAULT 0
    CHECK (min_order_amount_inr >= 0),
  -- Targeting. NULL means "applies everywhere"; both NULL is the general
  -- platform-wide coupon. Both set is never meaningful and is refused so an
  -- admin cannot believe they have written an AND that is really an OR.
  segment_id UUID REFERENCES public.segments(id) ON DELETE CASCADE,
  mentor_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- NULL = unlimited.
  max_total_uses INTEGER CHECK (max_total_uses IS NULL OR max_total_uses > 0),
  max_uses_per_user INTEGER CHECK (max_uses_per_user IS NULL OR max_uses_per_user > 0),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
    CHECK (expires_at IS NULL OR expires_at > starts_at),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_coupon_not_fully_scoped CHECK (NOT (segment_id IS NOT NULL AND mentor_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_coupons_status_window
  ON public.coupons(status, starts_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_coupons_segment ON public.coupons(segment_id) WHERE segment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coupons_mentor  ON public.coupons(mentor_id)  WHERE mentor_id  IS NOT NULL;

COMMENT ON TABLE public.coupons IS
  'Admin-authored discount codes. Targeting is OR: a coupon with only segment_id applies to every mentor in that segment, and with only mentor_id to every gig of that mentor.';

DROP TRIGGER IF EXISTS trg_coupons_updated_at ON public.coupons;
CREATE TRIGGER trg_coupons_updated_at
  BEFORE UPDATE ON public.coupons
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. COUPON USAGE
-- -----------------------------------------------------------------------------
-- One row per booking that touches a coupon. `UNIQUE (booking_id)` is what
-- makes "one coupon per booking" a database fact rather than an application
-- convention, and it is also what lets the status trigger find the row without
-- a lookup that could race.
--
-- RESERVED is the state that holds a slot in the coupon's limit; it is created
-- when the seeker applies the code and released on removal, rejection, hold
-- expiry or abandonment. REDEEMED means money moved and the redemption counts
-- permanently against the limit.
CREATE TABLE IF NOT EXISTS public.coupon_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id UUID NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL UNIQUE REFERENCES public.bookings(id) ON DELETE CASCADE,
  seeker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'RESERVED'
    CHECK (status IN ('RESERVED', 'REDEEMED', 'RELEASED')),
  -- The amount actually taken off, snapshotted. A coupon edited or archived
  -- afterwards must not rewrite what a past booking was charged.
  discount_amount_inr INTEGER NOT NULL CHECK (discount_amount_inr > 0),
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  redeemed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  release_reason TEXT
    CHECK (release_reason IS NULL OR length(release_reason) <= 200)
);

-- The only query the limit checks run: active usage for one coupon, optionally
-- narrowed to one seeker.
CREATE INDEX IF NOT EXISTS idx_coupon_usage_coupon_status
  ON public.coupon_usage(coupon_id, status);

CREATE INDEX IF NOT EXISTS idx_coupon_usage_coupon_user_status
  ON public.coupon_usage(coupon_id, seeker_id, status);

CREATE INDEX IF NOT EXISTS idx_coupon_usage_reserved
  ON public.coupon_usage(reserved_at) WHERE status = 'RESERVED';

COMMENT ON COLUMN public.coupon_usage.status IS
  'RESERVED holds a place in the coupon limit and is released if the seeker never pays. REDEEMED is permanent. Only RESERVED and REDEEMED count against max_total_uses / max_uses_per_user.';

-- -----------------------------------------------------------------------------
-- 4. BOOKING PRICING SNAPSHOT
-- -----------------------------------------------------------------------------
-- `amount_inr` is deliberately left alone: it stays the final payable amount,
-- which is what `razorpayService` mints the gateway order from. Only additive
-- columns are added, so no existing read path changes shape.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS base_amount_inr INTEGER,
  ADD COLUMN IF NOT EXISTS discount_amount_inr INTEGER NOT NULL DEFAULT 0
    CHECK (discount_amount_inr >= 0),
  ADD COLUMN IF NOT EXISTS original_amount_inr INTEGER,
  -- RESTRICT, not SET NULL / CASCADE: `coupon_id` is part of a HISTORICAL
  -- snapshot. `chk_booking_coupon_snapshot_complete` requires that a booking
  -- carrying a discount also carries its code, so nulling `coupon_id` on delete
  -- would leave `coupon_code` + `discount_amount_inr > 0` with no coupon_id and
  -- fail the CHECK (and SET NULL would silently rewrite a charged booking's
  -- provenance). Archiving is the correct way to retire a coupon; a coupon that
  -- any booking references simply cannot be hard-deleted.
  ADD COLUMN IF NOT EXISTS coupon_id UUID REFERENCES public.coupons(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS coupon_code TEXT
    CHECK (coupon_code IS NULL OR coupon_code ~ '^[A-Z0-9_]{4,24}$');

-- Backfill BEFORE the NOT NULL / CHECK, so the invariant holds for rows that
-- already exist: a pre-coupon booking's base was exactly what it paid.
UPDATE public.bookings
SET base_amount_inr = amount_inr
WHERE base_amount_inr IS NULL;

ALTER TABLE public.bookings
  ALTER COLUMN base_amount_inr SET NOT NULL;

-- The arithmetic cannot drift from the charged amount. `amount_inr` is written
-- by the RPCs below, and this is what makes a hand-edited or client-supplied
-- discount impossible at rest.
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS chk_booking_pricing_arithmetic;

ALTER TABLE public.bookings
  ADD CONSTRAINT chk_booking_pricing_arithmetic
    CHECK (amount_inr = base_amount_inr - discount_amount_inr);

-- A coupon that would take the payable amount to zero is refused. Razorpay
-- cannot take a ₹0 order, and a ₹0 session would be free capacity that a
-- global coupon could hand out without an admin intending it.
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS chk_booking_discount_floor;

ALTER TABLE public.bookings
  ADD CONSTRAINT chk_booking_discount_floor
    CHECK (coupon_id IS NULL OR amount_inr >= 1);

-- A coupon snapshot and a discount are present together or not at all.
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS chk_booking_coupon_snapshot_complete;

ALTER TABLE public.bookings
  ADD CONSTRAINT chk_booking_coupon_snapshot_complete
    CHECK (
      (coupon_id IS NOT NULL AND coupon_code IS NOT NULL AND discount_amount_inr > 0)
      OR (coupon_id IS NULL AND coupon_code IS NULL AND discount_amount_inr = 0)
    );

COMMENT ON COLUMN public.bookings.base_amount_inr IS
  'Gig price at the moment the hold was created, before any coupon. amount_inr = base_amount_inr - discount_amount_inr is enforced by a CHECK constraint.';
COMMENT ON COLUMN public.bookings.original_amount_inr IS
  'Gig original_price_inr at hold time, or NULL when the gig had no genuine reduction. Historical: never recomputed from the current gig row.';

-- -----------------------------------------------------------------------------
-- 5. create_booking_with_hold: SNAPSHOT THE FULL PRICE BREAKDOWN
-- -----------------------------------------------------------------------------
-- Replaces the phase 31 body. The only behavioural change is that the INSERT
-- also writes the pricing snapshot, so a booking is born knowing what it cost
-- before a coupon and what it was reduced from. Every hold, availability,
-- overlap, cutoff and gig/segment check from phase 31 is preserved verbatim.
CREATE OR REPLACE FUNCTION public.create_booking_with_hold(
  p_seeker_id uuid,
  p_mentor_id uuid,
  p_segment_id uuid,
  p_gig_id uuid,
  p_start_time timestamp with time zone,
  p_end_time timestamp with time zone
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hold public.slot_holds;
  v_gig public.gigs;
  v_booking public.bookings;
  v_exception public.mentor_availability_exceptions;
  v_mentor_tz TEXT;
  v_seeker_tz TEXT;
  v_booking_code TEXT;
  v_local_start timestamp;
  v_local_end timestamp;
  v_local_date date;
  v_local_dow int;
  v_duration_minutes int;
  v_now timestamp with time zone;
BEGIN
  -- 1. Input sanity checks
  IF p_start_time >= p_end_time THEN
    RAISE EXCEPTION 'code: INVALID_INTERVAL, Slot start time must be earlier than end time';
  END IF;

  v_now := clock_timestamp();

  IF p_start_time <= v_now THEN
    RAISE EXCEPTION 'code: PAST_SLOT_FORBIDDEN, Cannot hold a slot that begins in the past';
  END IF;

  -- 1b. Booking cutoff. `p_start_time` is an absolute instant, so this is the
  --     mentor's own local start compared against the current instant and is
  --     correct for any mentor timezone.
  IF p_start_time < v_now + INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'code: BOOKING_CUTOFF_REACHED, This slot can no longer be booked because it starts in less than 5 minutes';
  END IF;

  -- 2. Explicit pessimistic lock on the mentor's profile row to serialize
  --    concurrent booking attempts. Every check below and the hold insert run
  --    under this lock, so two seekers racing for one slot cannot both win.
  PERFORM 1 FROM public.profiles WHERE id = p_mentor_id FOR UPDATE;

  -- 3. Re-read the wall clock after acquiring the lock. A request that waited
  --    behind another booking may have crossed the cutoff while queued, so the
  --    boundary is re-tested against the instant the hold would actually be
  --    written, not the one that arrived on the wire.
  v_now := clock_timestamp();
  IF p_start_time < v_now + INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'code: BOOKING_CUTOFF_REACHED, This slot can no longer be booked because it starts in less than 5 minutes';
  END IF;

  -- 4. Expire stale holds for this mentor
  UPDATE public.slot_holds
  SET status = 'EXPIRED'
  WHERE mentor_id = p_mentor_id
    AND status = 'ACTIVE'
    AND expires_at <= clock_timestamp();

  -- 5. Fetch gig + timezones before any availability decision
  SELECT * INTO v_gig FROM public.gigs WHERE id = p_gig_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'code: GIG_NOT_FOUND, Associated gig not found';
  END IF;

  -- 5a. The gig must be an ACTIVE offer of THIS mentor in THIS segment.
  --
  --     `gigs.segment_id` is the only thing that decides which segment a gig
  --     belongs to, so it is the only thing consulted. Comparing the caller's
  --     `p_segment_id` against the gig's own column is what makes the two
  --     arguments mutually constraining: there is no pair of values that
  --     describes one booking and spans two segments.
  IF NOT v_gig.is_active OR v_gig.mentor_id <> p_mentor_id OR v_gig.segment_id <> p_segment_id THEN
    RAISE EXCEPTION 'code: GIG_MISMATCH, Gig is not an active offer of this mentor in this segment';
  END IF;

  SELECT timezone INTO v_mentor_tz FROM public.profiles WHERE id = p_mentor_id;
  SELECT timezone INTO v_seeker_tz FROM public.profiles WHERE id = p_seeker_id;
  v_mentor_tz := COALESCE(v_mentor_tz, 'Asia/Kolkata');
  v_seeker_tz := COALESCE(v_seeker_tz, 'Asia/Kolkata');

  -- 6. Duration must equal the ACTIVE gig duration, never a client constant
  v_duration_minutes := ROUND(EXTRACT(EPOCH FROM (p_end_time - p_start_time)) / 60.0)::int;
  IF v_duration_minutes <> v_gig.duration_minutes THEN
    RAISE EXCEPTION 'code: DURATION_MISMATCH, Slot duration (%) must equal the active gig duration (%)', v_duration_minutes, v_gig.duration_minutes;
  END IF;

  -- 7. Re-validate the requested interval against the mentor's LIVE availability.
  --    Both instants are resolved in the mentor's own timezone, so a session that
  --    straddles local midnight is rejected rather than silently booked.
  v_local_start := p_start_time AT TIME ZONE v_mentor_tz;
  v_local_end := p_end_time AT TIME ZONE v_mentor_tz;
  v_local_date := v_local_start::date;
  v_local_dow := EXTRACT(DOW FROM v_local_start)::int;

  IF v_local_start::date <> v_local_end::date THEN
    RAISE EXCEPTION 'code: OUTSIDE_AVAILABILITY, Slot crosses the mentor local calendar day';
  END IF;

  SELECT * INTO v_exception
  FROM public.mentor_availability_exceptions
  WHERE mentor_id = p_mentor_id
    AND exception_date = v_local_date;

  IF FOUND THEN
    -- A date exception is authoritative for that date and never merges with
    -- the recurring weekly schedule.
    IF NOT v_exception.is_available THEN
      RAISE EXCEPTION 'code: DATE_EXCEPTION_UNAVAILABLE, Mentor is marked unavailable on this date';
    END IF;

    IF v_exception.start_time IS NULL
       OR v_exception.end_time IS NULL
       OR v_local_start::time < v_exception.start_time
       OR v_local_end::time > v_exception.end_time THEN
      RAISE EXCEPTION 'code: OUTSIDE_EXCEPTION_HOURS, Slot falls outside the custom hours set for this date';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM public.mentor_availability a
      WHERE a.mentor_id = p_mentor_id
        AND a.is_enabled
        AND a.day_of_week = v_local_dow
        AND a.start_time <= v_local_start::time
        AND a.end_time >= v_local_end::time
    ) THEN
      RAISE EXCEPTION 'code: OUTSIDE_AVAILABILITY, Slot falls outside the mentor current availability';
    END IF;
  END IF;

  -- 8. Check for overlapping non-cancelled bookings
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE mentor_id = p_mentor_id
      AND status NOT IN ('CANCELLED', 'REJECTED')
      AND tstzrange(start_time, end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)')
  ) THEN
    RAISE EXCEPTION 'code: SLOT_ALREADY_BOOKED, Requested slot is already booked';
  END IF;

  -- 9. Check for overlapping active holds
  IF EXISTS (
    SELECT 1 FROM public.slot_holds
    WHERE mentor_id = p_mentor_id
      AND status = 'ACTIVE'
      AND expires_at > clock_timestamp()
      AND tstzrange(start_time, end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)')
  ) THEN
    RAISE EXCEPTION 'code: SLOT_HELD_BY_OTHER, Requested slot is currently on hold by another seeker';
  END IF;

  -- 10. Generate booking code
  v_booking_code := 'BK-' || TO_CHAR(clock_timestamp(), 'YYMMDDHH24MI') || '-' || SUBSTRING(gen_random_uuid()::text FROM 1 FOR 4);

  -- 11. Create the slot hold, expiring when the canonical hold window elapses
  INSERT INTO public.slot_holds (
    mentor_id, seeker_id, gig_id, start_time, end_time, status, expires_at, created_at
  ) VALUES (
    p_mentor_id, p_seeker_id, p_gig_id, p_start_time, p_end_time, 'ACTIVE',
    clock_timestamp() + public.hold_duration_interval(), clock_timestamp()
  )
  RETURNING * INTO v_hold;

  -- 12. Create PAYMENT_PENDING booking
  --
  --     `gig_id` comes from the resolved gig row and `segment_id` from the
  --     validated argument. Step 5a proved they describe the same offer, so the
  --     stored pair can never contradict itself or the screen it was booked from.
  --
  --     The price snapshot is taken from the SAME resolved gig row, so what the
  --     seeker is shown and what they are charged cannot come from two different
  --     reads of a price that changed in between. `amount_inr` is the gig price
  --     and stays the amount charged; a coupon can only lower it later, through
  --     `apply_coupon_to_booking`.
  INSERT INTO public.bookings (
    booking_code, mentor_id, seeker_id, gig_id, segment_id, hold_id,
    start_time, end_time, seeker_timezone, mentor_timezone,
    amount_inr, base_amount_inr, discount_amount_inr, original_amount_inr,
    status, created_at, updated_at
  ) VALUES (
    v_booking_code, p_mentor_id, p_seeker_id, v_gig.id, p_segment_id, v_hold.id,
    p_start_time, p_end_time, v_seeker_tz, v_mentor_tz,
    v_gig.price_inr, v_gig.price_inr, 0, v_gig.original_price_inr,
    'PAYMENT_PENDING', clock_timestamp(), clock_timestamp()
  )
  RETURNING * INTO v_booking;

  -- 13. Return the canonical booking record (with hold_id and status)
  RETURN json_build_object(
    'success', true,
    'booking', json_build_object(
      'id', v_booking.id,
      'booking_code', v_booking.booking_code,
      'mentor_id', v_booking.mentor_id,
      'seeker_id', v_booking.seeker_id,
      'gig_id', v_booking.gig_id,
      'segment_id', v_booking.segment_id,
      'hold_id', v_booking.hold_id,
      'start_time', v_booking.start_time,
      'end_time', v_booking.end_time,
      'seeker_timezone', v_booking.seeker_timezone,
      'mentor_timezone', v_booking.mentor_timezone,
      'amount_inr', v_booking.amount_inr,
      'base_amount_inr', v_booking.base_amount_inr,
      'discount_amount_inr', v_booking.discount_amount_inr,
      'original_amount_inr', v_booking.original_amount_inr,
      'status', v_booking.status,
      'created_at', v_booking.created_at,
      'updated_at', v_booking.updated_at
    ),
    'hold', json_build_object(
      'id', v_hold.id,
      'mentor_id', v_hold.mentor_id,
      'seeker_id', v_hold.seeker_id,
      'gig_id', v_hold.gig_id,
      'start_time', v_hold.start_time,
      'end_time', v_hold.end_time,
      'status', v_hold.status,
      'expires_at', v_hold.expires_at,
      'created_at', v_hold.created_at
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_booking_with_hold(uuid, uuid, uuid, uuid, timestamp with time zone, timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_with_hold(uuid, uuid, uuid, uuid, timestamp with time zone, timestamp with time zone) TO service_role;

-- -----------------------------------------------------------------------------
-- 6. apply_coupon_to_booking
-- -----------------------------------------------------------------------------
-- The only writer of the discount snapshot. SECURITY DEFINER so the whole
-- check-and-write runs in ONE transaction under row locks; doing this from the
-- server as three separate statements would leave a window in which two seekers
-- both pass a `max_total_uses = 1` check.
--
-- Every value that reaches the pricing snapshot is read from a locked row. The
-- request carries a code and a booking id and nothing else: no amount, no
-- discount, no identity, no limit.
CREATE OR REPLACE FUNCTION public.apply_coupon_to_booking(
  p_booking_id uuid,
  p_coupon_code text,
  p_seeker_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings;
  v_coupon public.coupons;
  v_usage public.coupon_usage;
  v_hold_expires_at timestamptz;
  v_base integer;
  v_discount integer;
  v_total integer;
  v_active_uses integer;
  v_user_uses integer;
  v_code text := upper(btrim(COALESCE(p_coupon_code, '')));
BEGIN
  IF p_seeker_id IS NULL THEN
    RAISE EXCEPTION 'code: UNAUTHORIZED, Sign in to use a coupon';
  END IF;

  IF v_code !~ '^[A-Z0-9_]{4,24}$' THEN
    RAISE EXCEPTION 'code: COUPON_CODE_INVALID, Enter a valid coupon code';
  END IF;

  -- 1. Lock the booking. Serialises two concurrent applies against one booking,
  --    so the snapshot cannot be written twice from two different codes.
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'code: BOOKING_NOT_FOUND, Booking not found';
  END IF;

  -- 2. Ownership. Checked against the row, never against a body field.
  IF v_booking.seeker_id <> p_seeker_id THEN
    RAISE EXCEPTION 'code: FORBIDDEN_NOT_BOOKING_OWNER, This booking belongs to someone else';
  END IF;

  -- 3. Only a still-payable booking may be repriced. Once a payment is in
  --    flight or the booking has moved on, changing the amount would invalidate
  --    an amount already promised to a gateway or an admin.
  IF v_booking.status <> 'PAYMENT_PENDING' THEN
    RAISE EXCEPTION 'code: COUPON_BOOKING_NOT_PAYABLE, A coupon can only be applied while the booking is awaiting payment';
  END IF;

  -- 3b. A live payment is the real freeze, and `bookings.status` cannot express
  --     it. `razorpayService` deliberately leaves the booking at PAYMENT_PENDING
  --     while an order is live (see its comment on the booking not moving to
  --     PAYMENT_PROCESSING), so the status check above passes even after Razorpay
  --     has been told an amount. Repricing then would leave a gateway order for
  --     one amount sitting against a booking for another.
  --     Only a payment that has definitively not happened (FAILED, REJECTED) may
  --     be repriced; PENDING_VERIFICATION is a proof an admin is about to read
  --     against a specific amount, so it freezes too.
  IF EXISTS (
    SELECT 1 FROM public.payments
    WHERE booking_id = v_booking.id
      AND status NOT IN ('FAILED', 'REJECTED')
  ) THEN
    RAISE EXCEPTION 'code: COUPON_PAYMENT_IN_FLIGHT, A payment for this booking is already in progress';
  END IF;

  -- 4. The hold must still be live. An expired hold means the booking is about
  --    to be cancelled, and reserving a coupon against it would burn a
  --    redemption for a session nobody can pay for.
  SELECT h.expires_at INTO v_hold_expires_at
  FROM public.slot_holds h
  WHERE h.id = v_booking.hold_id AND h.status = 'ACTIVE';

  IF v_booking.hold_id IS NOT NULL AND (v_hold_expires_at IS NULL OR v_hold_expires_at <= clock_timestamp()) THEN
    RAISE EXCEPTION 'code: COUPON_HOLD_EXPIRED, The payment window for this booking has closed';
  END IF;

  -- 5. Lock the coupon. THIS is the concurrency gate for usage limits: every
  --    reservation of this coupon now queues behind this row, so the counts
  --    below are read from a state no other apply can be mid-way through.
  SELECT * INTO v_coupon FROM public.coupons WHERE code = v_code FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'code: COUPON_NOT_FOUND, That coupon code was not recognised';
  END IF;

  IF v_coupon.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'code: COUPON_INACTIVE, That coupon is no longer active';
  END IF;

  IF v_coupon.starts_at > clock_timestamp() THEN
    RAISE EXCEPTION 'code: COUPON_NOT_STARTED, That coupon is not active yet';
  END IF;

  IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'code: COUPON_EXPIRED, That coupon has expired';
  END IF;

  -- 6. Targeting. OR, not AND: a segment coupon covers every mentor in the
  --    segment, a mentor coupon covers every gig of that mentor. `chk_coupon_
  --    not_fully_scoped` guarantees a row can never claim to be both.
  IF v_coupon.segment_id IS NOT NULL AND v_coupon.segment_id <> v_booking.segment_id THEN
    RAISE EXCEPTION 'code: COUPON_NOT_TARGETED, That coupon does not apply to this session';
  END IF;

  IF v_coupon.mentor_id IS NOT NULL AND v_coupon.mentor_id <> v_booking.mentor_id THEN
    RAISE EXCEPTION 'code: COUPON_NOT_TARGETED, That coupon does not apply to this mentor';
  END IF;

  -- 7. The base is the booking's own snapshotted gig price. NEVER the current
  --    `gigs.price_inr`: a price edit between hold and checkout must not move
  --    what this booking is discounted from.
  v_base := v_booking.base_amount_inr;

  IF v_base < v_coupon.min_order_amount_inr THEN
    RAISE EXCEPTION 'code: COUPON_MINIMUM_NOT_MET, This coupon needs a session of at least Rs %', v_coupon.min_order_amount_inr;
  END IF;

  -- 8. Usage limits. RESERVED counts as well as REDEEMED: a seeker who holds a
  --    slot has a real claim on the discount, and excluding RESERVED would let
  --    `max_total_uses = 1` be taken by every simultaneous checkout.
  --    This booking's OWN row is excluded. Otherwise re-entering a code already
  --    reserved on this booking would count itself and report a limit reached
  --    for a coupon the seeker already holds, so applying twice would fail
  --    instead of being idempotent. Excluding it is also what keeps the upsert
  --    below honest: the slot it already holds is not double-counted.
  SELECT count(*) INTO v_active_uses
  FROM public.coupon_usage
  WHERE coupon_id = v_coupon.id
    AND status IN ('RESERVED', 'REDEEMED')
    AND booking_id <> v_booking.id;

  IF v_coupon.max_total_uses IS NOT NULL AND v_active_uses >= v_coupon.max_total_uses THEN
    RAISE EXCEPTION 'code: COUPON_LIMIT_REACHED, That coupon has been fully claimed';
  END IF;

  IF v_coupon.max_uses_per_user IS NOT NULL THEN
    SELECT count(*) INTO v_user_uses
    FROM public.coupon_usage
    WHERE coupon_id = v_coupon.id
      AND seeker_id = p_seeker_id
      AND status IN ('RESERVED', 'REDEEMED')
      AND booking_id <> v_booking.id;

    IF v_user_uses >= v_coupon.max_uses_per_user THEN
      RAISE EXCEPTION 'code: COUPON_LIMIT_REACHED, You have already used that coupon';
    END IF;
  END IF;

  -- 9. Compute the discount, floored so the payable amount can never reach 0.
  IF v_coupon.discount_type = 'PERCENTAGE' THEN
    v_discount := (v_base * v_coupon.discount_value) / 100;
    IF v_coupon.max_discount_inr IS NOT NULL AND v_discount > v_coupon.max_discount_inr THEN
      v_discount := v_coupon.max_discount_inr;
    END IF;
  ELSE
    v_discount := v_coupon.discount_value;
  END IF;

  IF v_discount > v_base - 1 THEN
    v_discount := v_base - 1;
  END IF;

  IF v_discount < 1 THEN
    RAISE EXCEPTION 'code: COUPON_NO_EFFECT, That coupon does not reduce this session price';
  END IF;

  v_total := v_base - v_discount;

  -- 10. Reserve. `UNIQUE (booking_id)` means this booking has at most one
  --     coupon_usage row for its whole life, so this is an UPSERT and not a
  --     release-then-insert: releasing the old row first would leave a RELEASED
  --     row behind and the INSERT would violate that unique constraint. The row
  --     is the booking's CURRENT claim, so switching code overwrites it, which
  --     also frees the previous coupon's slot automatically - nothing still
  --     references the old coupon, so its count drops on its own.
  --     Safe against clobbering REDEEMED: a redeemed usage implies the booking
  --     reached MENTOR_PENDING, which step 3 refuses.
  INSERT INTO public.coupon_usage (coupon_id, booking_id, seeker_id, discount_amount_inr)
  VALUES (v_coupon.id, v_booking.id, p_seeker_id, v_discount)
  ON CONFLICT (booking_id) DO UPDATE
  SET coupon_id = EXCLUDED.coupon_id,
      seeker_id = EXCLUDED.seeker_id,
      discount_amount_inr = EXCLUDED.discount_amount_inr,
      status = 'RESERVED',
      reserved_at = clock_timestamp(),
      redeemed_at = NULL,
      released_at = NULL,
      release_reason = NULL
  RETURNING * INTO v_usage;

  -- 11. Write the snapshot. `amount_inr` becomes the new payable amount, which
  --     is what Razorpay order creation already reads.
  UPDATE public.bookings
  SET amount_inr = v_total,
      discount_amount_inr = v_discount,
      coupon_id = v_coupon.id,
      coupon_code = v_coupon.code,
      updated_at = clock_timestamp()
  WHERE id = v_booking.id;

  RETURN jsonb_build_object(
    'success', true,
    'coupon_code', v_coupon.code,
    'discount_type', v_coupon.discount_type,
    'discount_value', v_coupon.discount_value,
    'discount_amount_inr', v_discount,
    'base_amount_inr', v_base,
    'amount_inr', v_total,
    'original_amount_inr', v_booking.original_amount_inr
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. remove_coupon_from_booking
-- -----------------------------------------------------------------------------
-- Restores `amount_inr` to the snapshotted base. Separate from apply because
-- removing a code is the one action that must work when the code that was
-- applied is no longer valid - a coupon archived after it was reserved must
-- still be removable.
CREATE OR REPLACE FUNCTION public.remove_coupon_from_booking(
  p_booking_id uuid,
  p_seeker_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings;
BEGIN
  -- A NULL seeker_id makes the ownership comparison below evaluate to NULL,
  -- which is not TRUE, so without this an unauthenticated caller would fall
  -- straight through it. The server always supplies the authenticated id; this
  -- keeps the function safe on its own terms too.
  IF p_seeker_id IS NULL THEN
    RAISE EXCEPTION 'code: UNAUTHORIZED, Sign in to use a coupon';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'code: BOOKING_NOT_FOUND, Booking not found';
  END IF;

  IF v_booking.seeker_id <> p_seeker_id THEN
    RAISE EXCEPTION 'code: FORBIDDEN_NOT_BOOKING_OWNER, This booking belongs to someone else';
  END IF;

  -- Only a payable booking can be repriced, for the same reason apply cannot
  -- reprice a moved-on booking: the amount is already committed.
  IF v_booking.status <> 'PAYMENT_PENDING' THEN
    RAISE EXCEPTION 'code: COUPON_BOOKING_NOT_PAYABLE, The coupon on this booking can no longer be changed';
  END IF;

  -- The same in-flight freeze apply enforces. Removing a code raises the amount
  -- back to base, so it would strand a live Razorpay order or an admin's
  -- pending proof just as badly as lowering it would.
  IF EXISTS (
    SELECT 1 FROM public.payments
    WHERE booking_id = v_booking.id
      AND status NOT IN ('FAILED', 'REJECTED')
  ) THEN
    RAISE EXCEPTION 'code: COUPON_PAYMENT_IN_FLIGHT, A payment for this booking is already in progress';
  END IF;

  UPDATE public.coupon_usage
  SET status = 'RELEASED',
      released_at = clock_timestamp(),
      release_reason = 'REMOVED_BY_SEEKER'
  WHERE booking_id = v_booking.id
    AND status = 'RESERVED';

  UPDATE public.bookings
  SET amount_inr = v_booking.base_amount_inr,
      discount_amount_inr = 0,
      coupon_id = NULL,
      coupon_code = NULL,
      updated_at = clock_timestamp()
  WHERE id = v_booking.id;

  RETURN jsonb_build_object(
    'success', true,
    'coupon_code', NULL,
    'discount_amount_inr', 0,
    'base_amount_inr', v_booking.base_amount_inr,
    'amount_inr', v_booking.base_amount_inr,
    'original_amount_inr', v_booking.original_amount_inr
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 8. THE LIFECYCLE, IN ONE PLACE
-- -----------------------------------------------------------------------------
-- Terminal states a coupon reservation can end in. MENTOR_PENDING is the only
-- state that means "the money moved": it is reached by a verified payment
-- (Razorpay capture via `markBookingMentorPending`, or an approved manual proof
-- via `review_payment`), and by nothing else.
CREATE OR REPLACE FUNCTION public.sync_coupon_usage_for_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A trigger function must return `NEW` (or NULL) for every path; a bare
  -- RETURN is only legal for a `RETURNS void` function, which this is not.
  -- `NEW` keeps the updated row exactly as written by the caller.
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  -- PAID -> the reservation becomes a permanent redemption.
  IF NEW.status = 'MENTOR_PENDING' THEN
    UPDATE public.coupon_usage
    SET status = 'REDEEMED',
        redeemed_at = COALESCE(redeemed_at, clock_timestamp()),
        release_reason = NULL
    WHERE booking_id = NEW.id
      AND status = 'RESERVED';
    RETURN NEW;
  END IF;

  -- DEAD END -> the claim on the coupon is given back.
  IF NEW.status IN ('CANCELLED', 'REJECTED') THEN
    UPDATE public.coupon_usage
    SET status = 'RELEASED',
        released_at = COALESCE(released_at, clock_timestamp()),
        release_reason = COALESCE(release_reason, 'BOOKING_' || NEW.status)
    WHERE booking_id = NEW.id
      AND status = 'RESERVED';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_coupon_usage ON public.bookings;
CREATE TRIGGER trg_bookings_coupon_usage
  AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.sync_coupon_usage_for_booking();

-- -----------------------------------------------------------------------------
-- 9. RLS
-- -----------------------------------------------------------------------------
-- Both tables are admin-only. There is no client read path: the seeker learns
-- the outcome from the booking row's own snapshot (`coupon_code`,
-- `discount_amount_inr`, `amount_inr`), which is a column on a table whose RLS
-- already scopes it to the two participants. Granting a coupon read would let
-- one seeker enumerate every other's usage and discount history, and a coupon
-- list is never rendered in the product.
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupon_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage coupons" ON public.coupons;
CREATE POLICY "Admins can manage coupons"
  ON public.coupons FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can manage coupon usage" ON public.coupon_usage;
CREATE POLICY "Admins can manage coupon usage"
  ON public.coupon_usage FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- -----------------------------------------------------------------------------
-- 10. GRANTS
-- -----------------------------------------------------------------------------
-- Server-only. The RPCs are SECURITY DEFINER, so phase 29's blanket revoke of
-- EXECUTE from PUBLIC/anon/authenticated covers them by default and the only
-- role granted here is the trusted backend. `authenticated` gets SELECT on
-- nothing new: the snapshot travels on the booking row it already owns.
REVOKE ALL ON public.coupons FROM anon, authenticated;
REVOKE ALL ON public.coupon_usage FROM anon, authenticated;
GRANT ALL ON public.coupons TO service_role;
GRANT ALL ON public.coupon_usage TO service_role;

-- Phase 29's containment loop already ran, and it only ever visited functions
-- that existed at that moment. Postgres grants EXECUTE on a NEW function to
-- PUBLIC, so each of these three inherits EXECUTE by default and would be
-- reachable by the publishable-key role until explicitly revoked. That revoke
-- is what the post-condition below then verifies.
REVOKE EXECUTE ON FUNCTION public.apply_coupon_to_booking(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.remove_coupon_from_booking(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_coupon_usage_for_booking() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_coupon_to_booking(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.remove_coupon_from_booking(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_coupon_usage_for_booking() TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_coupon_to_booking(uuid, text, uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.remove_coupon_from_booking(uuid, uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.sync_coupon_usage_for_booking() TO postgres;

-- The pricing snapshot on bookings is read by the two participants and written
-- only by the RPCs (which are SECURITY DEFINER, so they are unaffected by
-- column privileges). Nothing here grants a client a write on any of it.
REVOKE UPDATE (base_amount_inr, discount_amount_inr, original_amount_inr, coupon_id, coupon_code)
  ON public.bookings FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 11. POST-CONDITION: anon must not be able to reach any of this
-- -----------------------------------------------------------------------------
-- Required because Postgres grants EXECUTE on a new function to PUBLIC, and
-- phase 29 already ran. Without this check a future rerun of phase 39 on a
-- database where the containment migration was skipped would silently expose
-- three SECURITY DEFINER functions that write a booking's price.
DO $$
DECLARE
  leaked text;
BEGIN
  SELECT string_agg(p.proname, ', ')
    INTO leaked
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN (
       'apply_coupon_to_booking',
       'remove_coupon_from_booking',
       'sync_coupon_usage_for_booking'
     )
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
          OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));

  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'Coupon containment incomplete: a client role can still EXECUTE: %', leaked;
  END IF;

  RAISE NOTICE 'Coupon containment verified: no client role can execute the coupon RPCs.';
END $$;
