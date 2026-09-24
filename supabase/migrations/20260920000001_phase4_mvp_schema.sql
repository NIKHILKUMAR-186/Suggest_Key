-- ==============================================================================
-- SUGGEST KEY - PHASE 4: COMPLETE MVP DATABASE SCHEMA
-- ==============================================================================
-- Extensions required for concurrency-safe non-overlapping booking intervals
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- ==============================================================================
-- 1. SEGMENTS TABLE
-- Master catalog of consultation domains (e.g., Relationship Advisor, Autism Mentor)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_segments_slug ON public.segments(slug);
CREATE INDEX IF NOT EXISTS idx_segments_active_priority ON public.segments(is_active, priority DESC);

-- ==============================================================================
-- 2. MENTOR PROFILES TABLE
-- Professional credentials, ratings, and mentor domain profile
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.mentor_profiles (
  id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  headline TEXT NOT NULL DEFAULT '',
  about TEXT,
  experience_years INTEGER NOT NULL DEFAULT 0 CHECK (experience_years >= 0),
  languages TEXT[] NOT NULL DEFAULT ARRAY['English', 'Hindi'],
  rating NUMERIC(3, 2) NOT NULL DEFAULT 5.00 CHECK (rating >= 0 AND rating <= 5.00),
  review_count INTEGER NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  session_count INTEGER NOT NULL DEFAULT 0 CHECK (session_count >= 0),
  is_approved BOOLEAN NOT NULL DEFAULT TRUE,
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mentor_profiles_approved ON public.mentor_profiles(is_approved);
CREATE INDEX IF NOT EXISTS idx_mentor_profiles_rating ON public.mentor_profiles(rating DESC);

-- ==============================================================================
-- 3. MENTOR SEGMENTS (JUNCTION TABLE)
-- Associates mentors with segments they are authorized to offer consultations in
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.mentor_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  segment_id UUID NOT NULL REFERENCES public.segments(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_mentor_segment UNIQUE (mentor_id, segment_id)
);

CREATE INDEX IF NOT EXISTS idx_mentor_segments_mentor_id ON public.mentor_segments(mentor_id);
CREATE INDEX IF NOT EXISTS idx_mentor_segments_segment_id ON public.mentor_segments(segment_id);

-- ==============================================================================
-- 4. SEEKER PROFILES TABLE
-- Seeker preferences and consultation history tracking
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.seeker_profiles (
  id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  preferred_language TEXT NOT NULL DEFAULT 'English',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- 5. GIGS TABLE
-- Specific mentorship consultation offerings (duration, pricing, segment)
-- INVARIANT: Exactly one active gig per mentor per segment
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.gigs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  segment_id UUID NOT NULL REFERENCES public.segments(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes IN (30, 45, 60, 90, 120)),
  price_inr INTEGER NOT NULL CHECK (price_inr >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gigs_mentor_id ON public.gigs(mentor_id);
CREATE INDEX IF NOT EXISTS idx_gigs_segment_id ON public.gigs(segment_id);
CREATE INDEX IF NOT EXISTS idx_gigs_active ON public.gigs(is_active);

-- BUSINESS INVARIANT ENFORCEMENT: Enforce ONE active gig per mentor/segment
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_gig_per_mentor_segment 
  ON public.gigs (mentor_id, segment_id) 
  WHERE (is_active = TRUE);

-- ==============================================================================
-- 6. MENTOR AVAILABILITY TABLE
-- Weekly recurring availability rules stored with timezone context
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.mentor_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sun, 1=Mon, ..., 6=Sat
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_availability_time CHECK (start_time < end_time)
);

-- Ensure the unique constraint exists (needed for ON CONFLICT in phase5 seed)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_mentor_availability_slot'
      AND conrelid = 'public.mentor_availability'::regclass
  ) THEN
    ALTER TABLE public.mentor_availability
      ADD CONSTRAINT uq_mentor_availability_slot UNIQUE (mentor_id, day_of_week, start_time, end_time);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mentor_availability_lookup 
  ON public.mentor_availability(mentor_id, day_of_week, is_enabled);

-- ==============================================================================
-- 7. MENTOR AVAILABILITY EXCEPTIONS TABLE
-- Specific date overrides (holidays, custom hours, unavailable days)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.mentor_availability_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  exception_date DATE NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT FALSE,
  start_time TIME,
  end_time TIME,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_mentor_date_exception UNIQUE (mentor_id, exception_date),
  CONSTRAINT chk_exception_times CHECK (
    is_available = FALSE OR (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time)
  )
);

CREATE INDEX IF NOT EXISTS idx_mentor_exceptions_lookup 
  ON public.mentor_availability_exceptions(mentor_id, exception_date);

-- ==============================================================================
-- 8. SLOT HOLDS TABLE
-- 15-minute temporary reservation during checkout to prevent double-booking
-- CONCURRENCY INVARIANT: No two active holds can overlap for the same mentor
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.slot_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  seeker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  gig_id UUID NOT NULL REFERENCES public.gigs(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CONVERTED', 'EXPIRED', 'RELEASED')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_hold_time CHECK (start_time < end_time),
  CONSTRAINT chk_hold_expiry CHECK (expires_at > created_at),
  -- Exclusion constraint guarantees at engine level that no overlapping ACTIVE holds exist for a mentor
  CONSTRAINT no_overlapping_active_holds EXCLUDE USING gist (
    mentor_id WITH =,
    tstzrange(start_time, end_time, '[)') WITH &&
  ) WHERE (status = 'ACTIVE')
);

CREATE INDEX IF NOT EXISTS idx_slot_holds_mentor_status ON public.slot_holds(mentor_id, status);
CREATE INDEX IF NOT EXISTS idx_slot_holds_expires_at ON public.slot_holds(expires_at) WHERE status = 'ACTIVE';

-- ==============================================================================
-- 9. BOOKINGS TABLE
-- Confirmed and scheduled consultation bookings
-- CONCURRENCY INVARIANT: No overlapping non-cancelled bookings for the same mentor
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_code TEXT NOT NULL UNIQUE,
  mentor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  seeker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  gig_id UUID NOT NULL REFERENCES public.gigs(id) ON DELETE RESTRICT,
  segment_id UUID NOT NULL REFERENCES public.segments(id) ON DELETE RESTRICT,
  hold_id UUID REFERENCES public.slot_holds(id) ON DELETE SET NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  seeker_timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  mentor_timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  amount_inr INTEGER NOT NULL CHECK (amount_inr >= 0),
  status TEXT NOT NULL DEFAULT 'PAYMENT_PENDING' CHECK (status IN (
    'PAYMENT_PENDING',
    'PENDING_VERIFICATION',
    'MENTOR_PENDING',
    'CONFIRMED',
    'COMPLETED',
    'CANCELLED',
    'REJECTED'
  )),
  meeting_url TEXT,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_booking_time CHECK (start_time < end_time),
  CONSTRAINT chk_meeting_url_https CHECK (meeting_url IS NULL OR meeting_url ~* '^https://'),
  -- Exclusion constraint prevents ANY overlapping active bookings for the same mentor
  CONSTRAINT no_overlapping_mentor_bookings EXCLUDE USING gist (
    mentor_id WITH =,
    tstzrange(start_time, end_time, '[)') WITH &&
  ) WHERE (status NOT IN ('CANCELLED', 'REJECTED'))
);

CREATE INDEX IF NOT EXISTS idx_bookings_mentor_status ON public.bookings(mentor_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_seeker_status ON public.bookings(seeker_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_start_time ON public.bookings(start_time);
CREATE INDEX IF NOT EXISTS idx_bookings_code ON public.bookings(booking_code);

-- ==============================================================================
-- 10. PAYMENTS TABLE
-- Manual UPI QR payment receipts & admin verification tracking
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  seeker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  amount_inr INTEGER NOT NULL CHECK (amount_inr >= 0),
  status TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION' CHECK (status IN ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED')),
  proof_storage_path TEXT NOT NULL,
  transaction_reference TEXT,
  verified_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_payment_booking UNIQUE (booking_id)
);

CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_seeker_id ON public.payments(seeker_id);

-- ==============================================================================
-- 11. NOTIFICATIONS TABLE
-- Real-time & persistent notification stream for users
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'SYSTEM' CHECK (type IN ('BOOKING', 'PAYMENT', 'SESSION', 'WORKSPACE', 'SYSTEM')),
  link TEXT,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications(user_id, is_read, created_at DESC);

-- ==============================================================================
-- 12. SESSION WORKSPACES TABLE
-- Post-consultation takeaways, action items, and resources
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.session_workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  mentor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  seeker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PUBLISHED')),
  summary TEXT NOT NULL DEFAULT '',
  takeaways JSONB NOT NULL DEFAULT '[]'::jsonb,
  action_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  resources JSONB NOT NULL DEFAULT '[]'::jsonb,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_workspace_booking UNIQUE (booking_id)
);

CREATE INDEX IF NOT EXISTS idx_workspaces_booking_id ON public.session_workspaces(booking_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_seeker_id ON public.session_workspaces(seeker_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_mentor_id ON public.session_workspaces(mentor_id);

-- ==============================================================================
-- 13. CONCURRENCY-SAFE TRANSACTION RPCs
-- Atomically acquire hold and confirm booking with row locks
-- ==============================================================================

-- Atomically cleans expired holds and acquires a new 15-minute slot hold
CREATE OR REPLACE FUNCTION public.acquire_slot_hold(
  p_mentor_id UUID,
  p_seeker_id UUID,
  p_gig_id UUID,
  p_start_time TIMESTAMPTZ,
  p_end_time TIMESTAMPTZ
)
RETURNS public.slot_holds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hold public.slot_holds;
  v_conflicting_booking BOOLEAN;
  v_conflicting_hold BOOLEAN;
BEGIN
  -- 1. Input sanity checks
  IF p_start_time >= p_end_time THEN
    RAISE EXCEPTION 'Invalid interval: start_time must be strictly before end_time';
  END IF;

  IF p_start_time <= NOW() THEN
    RAISE EXCEPTION 'Cannot hold a slot in the past';
  END IF;

  -- 2. Explicit pessimistic lock on the mentor's profile row to serialize concurrent booking attempts
  PERFORM 1 FROM public.profiles WHERE id = p_mentor_id FOR UPDATE;

  -- 3. Expire stale holds for this mentor
  UPDATE public.slot_holds
  SET status = 'EXPIRED'
  WHERE mentor_id = p_mentor_id
    AND status = 'ACTIVE'
    AND expires_at <= NOW();

  -- 4. Check for overlapping non-cancelled bookings
  SELECT EXISTS (
    SELECT 1 FROM public.bookings
    WHERE mentor_id = p_mentor_id
      AND status NOT IN ('CANCELLED', 'REJECTED')
      AND tstzrange(start_time, end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)')
  ) INTO v_conflicting_booking;

  IF v_conflicting_booking THEN
    RAISE EXCEPTION 'Requested slot is already booked';
  END IF;

  -- 5. Check for overlapping active holds
  SELECT EXISTS (
    SELECT 1 FROM public.slot_holds
    WHERE mentor_id = p_mentor_id
      AND status = 'ACTIVE'
      AND expires_at > NOW()
      AND tstzrange(start_time, end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)')
  ) INTO v_conflicting_hold;

  IF v_conflicting_hold THEN
    RAISE EXCEPTION 'Requested slot is currently on hold by another seeker';
  END IF;

  -- 6. Insert new slot hold with 15-minute expiration
  INSERT INTO public.slot_holds (
    mentor_id,
    seeker_id,
    gig_id,
    start_time,
    end_time,
    status,
    expires_at,
    created_at
  ) VALUES (
    p_mentor_id,
    p_seeker_id,
    p_gig_id,
    p_start_time,
    p_end_time,
    'ACTIVE',
    NOW() + INTERVAL '15 minutes',
    NOW()
  )
  RETURNING * INTO v_hold;

  RETURN v_hold;
END;
$$;

-- Atomically converts a hold into a booking and records pending payment
CREATE OR REPLACE FUNCTION public.convert_hold_to_booking(
  p_hold_id UUID,
  p_seeker_id UUID,
  p_booking_code TEXT,
  p_proof_storage_path TEXT,
  p_transaction_reference TEXT DEFAULT NULL
)
RETURNS public.bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hold public.slot_holds;
  v_gig public.gigs;
  v_booking public.bookings;
  v_mentor_tz TEXT;
  v_seeker_tz TEXT;
BEGIN
  -- 1. Pessimistic lock on the slot hold record
  SELECT * INTO v_hold
  FROM public.slot_holds
  WHERE id = p_hold_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Slot hold not found';
  END IF;

  IF v_hold.seeker_id <> p_seeker_id THEN
    RAISE EXCEPTION 'Unauthorized: Slot hold does not belong to this user';
  END IF;

  IF v_hold.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Slot hold is no longer active (status: %)', v_hold.status;
  END IF;

  IF v_hold.expires_at <= NOW() THEN
    UPDATE public.slot_holds SET status = 'EXPIRED' WHERE id = p_hold_id;
    RAISE EXCEPTION 'Slot hold has expired';
  END IF;

  -- 2. Fetch gig details
  SELECT * INTO v_gig FROM public.gigs WHERE id = v_hold.gig_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Associated gig not found';
  END IF;

  -- 3. Fetch timezones
  SELECT timezone INTO v_mentor_tz FROM public.profiles WHERE id = v_hold.mentor_id;
  SELECT timezone INTO v_seeker_tz FROM public.profiles WHERE id = p_seeker_id;

  v_mentor_tz := COALESCE(v_mentor_tz, 'Asia/Kolkata');
  v_seeker_tz := COALESCE(v_seeker_tz, 'Asia/Kolkata');

  -- 4. Mark hold as CONVERTED
  UPDATE public.slot_holds
  SET status = 'CONVERTED'
  WHERE id = p_hold_id;

  -- 5. Insert Booking
  INSERT INTO public.bookings (
    booking_code,
    mentor_id,
    seeker_id,
    gig_id,
    segment_id,
    hold_id,
    start_time,
    end_time,
    seeker_timezone,
    mentor_timezone,
    amount_inr,
    status,
    created_at,
    updated_at
  ) VALUES (
    p_booking_code,
    v_hold.mentor_id,
    v_hold.seeker_id,
    v_gig.id,
    v_gig.segment_id,
    v_hold.id,
    v_hold.start_time,
    v_hold.end_time,
    v_seeker_tz,
    v_mentor_tz,
    v_gig.price_inr,
    'PENDING_VERIFICATION',
    NOW(),
    NOW()
  )
  RETURNING * INTO v_booking;

  -- 6. Insert Payment Record
  INSERT INTO public.payments (
    booking_id,
    seeker_id,
    amount_inr,
    status,
    proof_storage_path,
    transaction_reference,
    created_at,
    updated_at
  ) VALUES (
    v_booking.id,
    p_seeker_id,
    v_gig.price_inr,
    'PENDING_VERIFICATION',
    p_proof_storage_path,
    p_transaction_reference,
    NOW(),
    NOW()
  );

  -- 7. Initialize Blank Session Workspace
  INSERT INTO public.session_workspaces (
    booking_id,
    mentor_id,
    seeker_id,
    status,
    summary,
    takeaways,
    action_items,
    resources,
    created_at,
    updated_at
  ) VALUES (
    v_booking.id,
    v_hold.mentor_id,
    p_seeker_id,
    'PENDING',
    '',
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    NOW(),
    NOW()
  );

  -- 8. Create Notification for Admin & Seeker
  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (
    p_seeker_id,
    'Payment Submitted',
    'Your payment for booking #' || p_booking_code || ' has been submitted for admin verification.',
    'PAYMENT',
    '/seeker/bookings'
  );

  RETURN v_booking;
END;
$$;

-- ==============================================================================
-- 14. PRIVATE STORAGE BUCKET FOR PAYMENT PROOFS
-- Payment screenshots stored in private bucket with strict access controls
-- ==============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-proofs',
  'payment-proofs',
  FALSE,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET public = FALSE,
    file_size_limit = 5242880;

-- Storage RLS on payment-proofs
DROP POLICY IF EXISTS "Seekers can upload own payment proofs" ON storage.objects;
CREATE POLICY "Seekers can upload own payment proofs"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'payment-proofs' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Seekers can view own payment proofs" ON storage.objects;
CREATE POLICY "Seekers can view own payment proofs"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'payment-proofs' AND (
      (storage.foldername(name))[1] = auth.uid()::text OR
      public.is_admin()
    )
  );

DROP POLICY IF EXISTS "Admins have full access to payment proofs" ON storage.objects;
CREATE POLICY "Admins have full access to payment proofs"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (
    bucket_id = 'payment-proofs' AND public.is_admin()
  );

-- ==============================================================================
-- 15. ROW LEVEL SECURITY (RLS) POLICIES FOR ALL TABLES
-- ==============================================================================

-- Enable RLS
ALTER TABLE public.segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentor_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentor_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seeker_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gigs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentor_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentor_availability_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slot_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_workspaces ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- SEGMENTS POLICIES
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view active segments" ON public.segments;
CREATE POLICY "Anyone can view active segments"
  ON public.segments FOR SELECT
  USING (is_active = TRUE OR public.is_admin());

DROP POLICY IF EXISTS "Admins can manage segments" ON public.segments;
CREATE POLICY "Admins can manage segments"
  ON public.segments FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ------------------------------------------------------------------------------
-- MENTOR PROFILES POLICIES
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view approved mentor profiles" ON public.mentor_profiles;
CREATE POLICY "Anyone can view approved mentor profiles"
  ON public.mentor_profiles FOR SELECT
  USING (is_approved = TRUE OR id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Mentors can update own profile" ON public.mentor_profiles;
CREATE POLICY "Mentors can update own profile"
  ON public.mentor_profiles FOR UPDATE
  USING (id = auth.uid() OR public.is_admin())
  WITH CHECK (id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Mentors or admin can insert mentor profile" ON public.mentor_profiles;
CREATE POLICY "Mentors or admin can insert mentor profile"
  ON public.mentor_profiles FOR INSERT
  WITH CHECK (id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Only admin can delete mentor profiles" ON public.mentor_profiles;
CREATE POLICY "Only admin can delete mentor profiles"
  ON public.mentor_profiles FOR DELETE
  USING (public.is_admin());

-- ------------------------------------------------------------------------------
-- MENTOR SEGMENTS POLICIES
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view mentor segments" ON public.mentor_segments;
CREATE POLICY "Anyone can view mentor segments"
  ON public.mentor_segments FOR SELECT
  USING (TRUE);

DROP POLICY IF EXISTS "Mentors or admin can manage mentor segments" ON public.mentor_segments;
CREATE POLICY "Mentors or admin can manage mentor segments"
  ON public.mentor_segments FOR ALL
  USING (mentor_id = auth.uid() OR public.is_admin())
  WITH CHECK (mentor_id = auth.uid() OR public.is_admin());

-- ------------------------------------------------------------------------------
-- SEEKER PROFILES POLICIES
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Seekers can view own profile or admin" ON public.seeker_profiles;
CREATE POLICY "Seekers can view own profile or admin"
  ON public.seeker_profiles FOR SELECT
  USING (id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Seekers can manage own profile" ON public.seeker_profiles;
CREATE POLICY "Seekers can manage own profile"
  ON public.seeker_profiles FOR ALL
  USING (id = auth.uid() OR public.is_admin())
  WITH CHECK (id = auth.uid() OR public.is_admin());

-- ------------------------------------------------------------------------------
-- GIGS POLICIES
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view active gigs of approved mentors" ON public.gigs;
CREATE POLICY "Anyone can view active gigs of approved mentors"
  ON public.gigs FOR SELECT
  USING (
    (is_active = TRUE AND EXISTS (
      SELECT 1 FROM public.mentor_profiles
      WHERE mentor_profiles.id = gigs.mentor_id AND mentor_profiles.is_approved = TRUE
    )) OR
    mentor_id = auth.uid() OR
    public.is_admin()
  );

DROP POLICY IF EXISTS "Mentors can create own gigs" ON public.gigs;
CREATE POLICY "Mentors can create own gigs"
  ON public.gigs FOR INSERT
  WITH CHECK (
    (mentor_id = auth.uid() AND public.has_role(auth.uid(), 'mentor')) OR
    public.is_admin()
  );

DROP POLICY IF EXISTS "Mentors can update own gigs" ON public.gigs;
CREATE POLICY "Mentors can update own gigs"
  ON public.gigs FOR UPDATE
  USING (mentor_id = auth.uid() OR public.is_admin())
  WITH CHECK (mentor_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Mentors can delete own gigs" ON public.gigs;
CREATE POLICY "Mentors can delete own gigs"
  ON public.gigs FOR DELETE
  USING (mentor_id = auth.uid() OR public.is_admin());

-- ------------------------------------------------------------------------------
-- MENTOR AVAILABILITY & EXCEPTIONS POLICIES
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view mentor availability rules" ON public.mentor_availability;
CREATE POLICY "Anyone can view mentor availability rules"
  ON public.mentor_availability FOR SELECT
  USING (TRUE);

DROP POLICY IF EXISTS "Mentors can manage own availability" ON public.mentor_availability;
CREATE POLICY "Mentors can manage own availability"
  ON public.mentor_availability FOR ALL
  USING (mentor_id = auth.uid() OR public.is_admin())
  WITH CHECK (mentor_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Anyone can view mentor availability exceptions" ON public.mentor_availability_exceptions;
CREATE POLICY "Anyone can view mentor availability exceptions"
  ON public.mentor_availability_exceptions FOR SELECT
  USING (TRUE);

DROP POLICY IF EXISTS "Mentors can manage own exceptions" ON public.mentor_availability_exceptions;
CREATE POLICY "Mentors can manage own exceptions"
  ON public.mentor_availability_exceptions FOR ALL
  USING (mentor_id = auth.uid() OR public.is_admin())
  WITH CHECK (mentor_id = auth.uid() OR public.is_admin());

-- ------------------------------------------------------------------------------
-- SLOT HOLDS POLICIES
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Participants and admin can view slot holds" ON public.slot_holds;
CREATE POLICY "Participants and admin can view slot holds"
  ON public.slot_holds FOR SELECT
  USING (
    seeker_id = auth.uid() OR
    mentor_id = auth.uid() OR
    public.is_admin()
  );

DROP POLICY IF EXISTS "Seekers can create slot holds" ON public.slot_holds;
CREATE POLICY "Seekers can create slot holds"
  ON public.slot_holds FOR INSERT
  WITH CHECK (seeker_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Seekers or admin can update slot holds" ON public.slot_holds;
CREATE POLICY "Seekers or admin can update slot holds"
  ON public.slot_holds FOR UPDATE
  USING (seeker_id = auth.uid() OR public.is_admin())
  WITH CHECK (seeker_id = auth.uid() OR public.is_admin());

-- ------------------------------------------------------------------------------
-- BOOKINGS POLICIES
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Participants and admin can view bookings" ON public.bookings;
CREATE POLICY "Participants and admin can view bookings"
  ON public.bookings FOR SELECT
  USING (
    seeker_id = auth.uid() OR
    mentor_id = auth.uid() OR
    public.is_admin()
  );

DROP POLICY IF EXISTS "Seekers can insert initial bookings" ON public.bookings;
CREATE POLICY "Seekers can insert initial bookings"
  ON public.bookings FOR INSERT
  WITH CHECK (seeker_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Participants can update bookings within authorization" ON public.bookings;
CREATE POLICY "Participants can update bookings within authorization"
  ON public.bookings FOR UPDATE
  USING (
    seeker_id = auth.uid() OR
    mentor_id = auth.uid() OR
    public.is_admin()
  )
  WITH CHECK (
    seeker_id = auth.uid() OR
    mentor_id = auth.uid() OR
    public.is_admin()
  );

-- ------------------------------------------------------------------------------
-- PAYMENTS POLICIES (Strict Seeker & Admin privacy)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Seekers and admins can view payments" ON public.payments;
CREATE POLICY "Seekers and admins can view payments"
  ON public.payments FOR SELECT
  USING (
    seeker_id = auth.uid() OR
    public.is_admin()
  );

DROP POLICY IF EXISTS "Seekers can submit payment proofs" ON public.payments;
CREATE POLICY "Seekers can submit payment proofs"
  ON public.payments FOR INSERT
  WITH CHECK (seeker_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Only admins can update payment verification status" ON public.payments;
CREATE POLICY "Only admins can update payment verification status"
  ON public.payments FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ------------------------------------------------------------------------------
-- NOTIFICATIONS POLICIES
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
CREATE POLICY "Users can view own notifications"
  ON public.notifications FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can mark own notifications as read" ON public.notifications;
CREATE POLICY "Users can mark own notifications as read"
  ON public.notifications FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ------------------------------------------------------------------------------
-- SESSION WORKSPACES POLICIES
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Session participants and admin can view workspaces" ON public.session_workspaces;
CREATE POLICY "Session participants and admin can view workspaces"
  ON public.session_workspaces FOR SELECT
  USING (
    (seeker_id = auth.uid() AND status = 'PUBLISHED') OR
    mentor_id = auth.uid() OR
    public.is_admin()
  );

DROP POLICY IF EXISTS "Mentors and admin can create workspaces" ON public.session_workspaces;
CREATE POLICY "Mentors and admin can create workspaces"
  ON public.session_workspaces FOR INSERT
  WITH CHECK (mentor_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Mentors and admin can update workspaces" ON public.session_workspaces;
CREATE POLICY "Mentors and admin can update workspaces"
  ON public.session_workspaces FOR UPDATE
  USING (mentor_id = auth.uid() OR public.is_admin())
  WITH CHECK (mentor_id = auth.uid() OR public.is_admin());
