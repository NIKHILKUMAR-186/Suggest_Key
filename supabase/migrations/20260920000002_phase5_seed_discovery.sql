-- ==============================================================================
-- SUGGEST KEY - PHASE 5: REAL MENTOR DISCOVERY & AVAILABILITY SEED MIGRATION
-- ==============================================================================

-- 1. RLS Adjustment: Allow seekers & public discovery to view mentor profile names/avatars/timezones
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'profiles' AND policyname = 'Anyone can view approved mentor profiles'
  ) THEN
    CREATE POLICY "Anyone can view approved mentor profiles"
      ON public.profiles
      FOR SELECT
      USING (public.has_role(id, 'mentor'));
  END IF;
END $$;

-- 2. SEED ACTIVE SEGMENTS (Priority 1 = Highest Priority)
INSERT INTO public.segments (id, name, slug, description, priority, is_active)
VALUES
  (
    '00000000-0000-0000-0000-000000000001',
    'Relationship Advisor',
    'relationship-advisor',
    'Expert 1:1 guidance on interpersonal relationships, emotional intelligence, and relational conflict resolution.',
    1,
    TRUE
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    'Autism Mentor',
    'autism-mentor',
    'Specialized neurodivergent support, sensory navigation, and individualized growth coaching.',
    2,
    TRUE
  ),
  (
    '00000000-0000-0000-0000-000000000003',
    'Career Mentor',
    'career-mentor',
    'Executive career development, transition planning, leadership communication, and compensation negotiations.',
    3,
    TRUE
  )
ON CONFLICT (slug) DO UPDATE
SET priority = EXCLUDED.priority,
    is_active = EXCLUDED.is_active,
    description = EXCLUDED.description;

-- ==============================================================================
-- 2.5 SEED AUTH USERS (auth.users)
-- Satisfies the foreign key constraint: profiles.id REFERENCES auth.users(id)
-- ==============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'users') THEN
    -- Remove any conflicting mock accounts that use the same seed emails with different random UUIDs
    DELETE FROM auth.users
    WHERE email IN (
      'mentor.rahul@suggestkey.com',
      'mentor.ananya@suggestkey.com',
      'mentor.vikram@suggestkey.com',
      'seeker.aman@suggestkey.com',
      'admin.operations@suggestkey.com'
    )
    AND id NOT IN (
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
      '33333333-3333-3333-3333-333333333333',
      '88888888-8888-8888-8888-888888888881',
      '88888888-8888-8888-8888-888888888880'
    );

    -- Insert seed users into Supabase auth.users
    INSERT INTO auth.users (
      id,
      instance_id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    )
    VALUES
      (
        '11111111-1111-1111-1111-111111111111',
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        'mentor.rahul@suggestkey.com',
        '$2a$10$wT8KzU48z3Y2x4QJ6c6kqu1mN3m7P0qQkQzJ6x4QJ6c6kqu1mN3m7',
        NOW(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"full_name":"Rahul Sharma","requested_role":"mentor","timezone":"Asia/Kolkata"}'::jsonb,
        NOW(),
        NOW()
      ),
      (
        '22222222-2222-2222-2222-222222222222',
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        'mentor.ananya@suggestkey.com',
        '$2a$10$wT8KzU48z3Y2x4QJ6c6kqu1mN3m7P0qQkQzJ6x4QJ6c6kqu1mN3m7',
        NOW(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"full_name":"Ananya Patel","requested_role":"mentor","timezone":"Asia/Kolkata"}'::jsonb,
        NOW(),
        NOW()
      ),
      (
        '33333333-3333-3333-3333-333333333333',
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        'mentor.vikram@suggestkey.com',
        '$2a$10$wT8KzU48z3Y2x4QJ6c6kqu1mN3m7P0qQkQzJ6x4QJ6c6kqu1mN3m7',
        NOW(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"full_name":"Dr. Vikram Joshi","requested_role":"mentor","timezone":"Asia/Kolkata"}'::jsonb,
        NOW(),
        NOW()
      ),
      (
        '88888888-8888-8888-8888-888888888881',
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        'seeker.aman@suggestkey.com',
        '$2a$10$wT8KzU48z3Y2x4QJ6c6kqu1mN3m7P0qQkQzJ6x4QJ6c6kqu1mN3m7',
        NOW(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"full_name":"Aman Kumar","requested_role":"seeker","timezone":"Asia/Kolkata"}'::jsonb,
        NOW(),
        NOW()
      ),
      (
        '88888888-8888-8888-8888-888888888880',
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        'admin.operations@suggestkey.com',
        '$2a$10$wT8KzU48z3Y2x4QJ6c6kqu1mN3m7P0qQkQzJ6x4QJ6c6kqu1mN3m7',
        NOW(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"full_name":"Admin Operations","requested_role":"admin","timezone":"Asia/Kolkata"}'::jsonb,
        NOW(),
        NOW()
      )
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      raw_user_meta_data = EXCLUDED.raw_user_meta_data,
      updated_at = NOW();
  END IF;
END $$;

-- Optional: Seed auth.identities if table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'identities') THEN
    INSERT INTO auth.identities (
      id,
      user_id,
      identity_data,
      provider,
      provider_id,
      last_sign_in_at,
      created_at,
      updated_at
    )
    SELECT
      u.id,
      u.id,
      jsonb_build_object('sub', u.id::text, 'email', u.email),
      'email',
      u.id::text,
      NOW(),
      NOW(),
      NOW()
    FROM auth.users u
    WHERE u.id IN (
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
      '33333333-3333-3333-3333-333333333333',
      '88888888-8888-8888-8888-888888888881',
      '88888888-8888-8888-8888-888888888880'
    )
    ON CONFLICT DO NOTHING;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 3. SEED REAL MENTOR USERS & PROFILES
-- Mentor 1: Rahul Sharma
INSERT INTO public.profiles (id, email, full_name, timezone)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'mentor.rahul@suggestkey.com',
  'Rahul Sharma',
  'Asia/Kolkata'
)
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, timezone = EXCLUDED.timezone;

INSERT INTO public.user_roles (user_id, role)
VALUES ('11111111-1111-1111-1111-111111111111', 'mentor')
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.mentor_profiles (id, headline, about, experience_years, languages, rating, review_count, session_count, is_approved, is_featured)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'Relationship Counselor & Interpersonal Strategist',
  'Experienced relationship counselor with specialized practice in emotional intelligence, conflict de-escalation, and family dynamics.',
  6,
  ARRAY['English', 'Hindi'],
  4.95,
  38,
  142,
  TRUE,
  TRUE
)
ON CONFLICT (id) DO UPDATE
SET headline = EXCLUDED.headline,
    about = EXCLUDED.about,
    is_approved = EXCLUDED.is_approved;

-- Mentor 2: Ananya Patel
INSERT INTO public.profiles (id, email, full_name, timezone)
VALUES (
  '22222222-2222-2222-2222-222222222222',
  'mentor.ananya@suggestkey.com',
  'Ananya Patel',
  'Asia/Kolkata'
)
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, timezone = EXCLUDED.timezone;

INSERT INTO public.user_roles (user_id, role)
VALUES ('22222222-2222-2222-2222-222222222222', 'mentor')
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.mentor_profiles (id, headline, about, experience_years, languages, rating, review_count, session_count, is_approved, is_featured)
VALUES (
  '22222222-2222-2222-2222-222222222222',
  'Certified Family Systems & Dialogue Practitioner',
  'Specialist in family transitions, partner dialogue, and pre-marital relational health with evidence-based counseling methodologies.',
  8,
  ARRAY['English', 'Hindi', 'Gujarati'],
  4.98,
  52,
  210,
  TRUE,
  FALSE
)
ON CONFLICT (id) DO UPDATE
SET headline = EXCLUDED.headline,
    about = EXCLUDED.about,
    is_approved = EXCLUDED.is_approved;

-- Mentor 3: Dr. Vikram Joshi
INSERT INTO public.profiles (id, email, full_name, timezone)
VALUES (
  '33333333-3333-3333-3333-333333333333',
  'mentor.vikram@suggestkey.com',
  'Dr. Vikram Joshi',
  'Asia/Kolkata'
)
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, timezone = EXCLUDED.timezone;

INSERT INTO public.user_roles (user_id, role)
VALUES ('33333333-3333-3333-3333-333333333333', 'mentor')
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.mentor_profiles (id, headline, about, experience_years, languages, rating, review_count, session_count, is_approved, is_featured)
VALUES (
  '33333333-3333-3333-3333-333333333333',
  'Neurodiversity Specialist & Autism Guidance Mentor',
  'Passionate about guiding autistic adolescents and adults, parents, and caregivers through sensory integration and life transitions.',
  10,
  ARRAY['English', 'Hindi', 'Marathi'],
  5.00,
  64,
  320,
  TRUE,
  TRUE
)
ON CONFLICT (id) DO UPDATE
SET headline = EXCLUDED.headline,
    about = EXCLUDED.about,
    is_approved = EXCLUDED.is_approved;

-- 4. LINK MENTORS TO SEGMENTS
-- Rahul Sharma -> Relationship Advisor & Career Mentor
INSERT INTO public.mentor_segments (mentor_id, segment_id, is_primary)
VALUES
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', TRUE),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000003', FALSE)
ON CONFLICT (mentor_id, segment_id) DO NOTHING;

-- Ananya Patel -> Relationship Advisor
INSERT INTO public.mentor_segments (mentor_id, segment_id, is_primary)
VALUES
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000001', TRUE)
ON CONFLICT (mentor_id, segment_id) DO NOTHING;

-- Dr. Vikram Joshi -> Autism Mentor
INSERT INTO public.mentor_segments (mentor_id, segment_id, is_primary)
VALUES
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000002', TRUE)
ON CONFLICT (mentor_id, segment_id) DO NOTHING;

-- 5. SEED ACTIVE GIGS (Enforce exactly 1 active gig per mentor per segment)
-- Rahul Sharma: Relationship Guidance
INSERT INTO public.gigs (id, mentor_id, segment_id, title, description, duration_minutes, price_inr, is_active)
VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111',
  '00000000-0000-0000-0000-000000000001',
  '1:1 Relationship Guidance Session',
  'In this structured 60-minute session, we explore current communication patterns, uncover root causes of friction, and formulate concrete relational action steps.',
  60,
  999,
  TRUE
)
ON CONFLICT (id) DO UPDATE SET is_active = EXCLUDED.is_active, price_inr = EXCLUDED.price_inr;

-- Rahul Sharma: Career Mentorship
INSERT INTO public.gigs (id, mentor_id, segment_id, title, description, duration_minutes, price_inr, is_active)
VALUES (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '11111111-1111-1111-1111-111111111111',
  '00000000-0000-0000-0000-000000000003',
  'Career Communication & Workplace Boundary Coaching',
  'Master interpersonal influence, executive communication, and professional boundary management.',
  45,
  1299,
  TRUE
)
ON CONFLICT (id) DO UPDATE SET is_active = EXCLUDED.is_active, price_inr = EXCLUDED.price_inr;

-- Ananya Patel: Deep Communication Reset
INSERT INTO public.gigs (id, mentor_id, segment_id, title, description, duration_minutes, price_inr, is_active)
VALUES (
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  '22222222-2222-2222-2222-222222222222',
  '00000000-0000-0000-0000-000000000001',
  'Deep Communication Reset & Dialogue Coaching',
  'Focused dialogue session to unpack relationship dynamics and develop supportive behavioral routines.',
  45,
  1200,
  TRUE
)
ON CONFLICT (id) DO UPDATE SET is_active = EXCLUDED.is_active, price_inr = EXCLUDED.price_inr;

-- Dr. Vikram Joshi: Autism Navigational Mentorship
INSERT INTO public.gigs (id, mentor_id, segment_id, title, description, duration_minutes, price_inr, is_active)
VALUES (
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  '33333333-3333-3333-3333-333333333333',
  '00000000-0000-0000-0000-000000000002',
  'Autism Navigational & Sensory Mentorship',
  'Structured 1:1 strategy session covering sensory regulation, accommodation strategies, and executive functioning.',
  60,
  1500,
  TRUE
)
ON CONFLICT (id) DO UPDATE SET is_active = EXCLUDED.is_active, price_inr = EXCLUDED.price_inr;

-- 6. SEED RECURRING AVAILABILITY RULES (Mon to Sat for each mentor in Asia/Kolkata)
-- Rahul Sharma: Monday (1) through Saturday (6), 10:00 - 18:00 IST
INSERT INTO public.mentor_availability (mentor_id, day_of_week, start_time, end_time, timezone, is_enabled)
SELECT 
  '11111111-1111-1111-1111-111111111111',
  d,
  '10:00:00'::TIME,
  '18:00:00'::TIME,
  'Asia/Kolkata',
  TRUE
FROM generate_series(1, 6) AS d
ON CONFLICT (mentor_id, day_of_week, start_time, end_time) DO NOTHING;

-- Ananya Patel: Monday (1) through Saturday (6), 11:00 - 19:00 IST
INSERT INTO public.mentor_availability (mentor_id, day_of_week, start_time, end_time, timezone, is_enabled)
SELECT 
  '22222222-2222-2222-2222-222222222222',
  d,
  '11:00:00'::TIME,
  '19:00:00'::TIME,
  'Asia/Kolkata',
  TRUE
FROM generate_series(1, 6) AS d
ON CONFLICT (mentor_id, day_of_week, start_time, end_time) DO NOTHING;

-- Dr. Vikram Joshi: Monday (1) through Friday (5), 09:00 - 17:00 IST
INSERT INTO public.mentor_availability (mentor_id, day_of_week, start_time, end_time, timezone, is_enabled)
SELECT 
  '33333333-3333-3333-3333-333333333333',
  d,
  '09:00:00'::TIME,
  '17:00:00'::TIME,
  'Asia/Kolkata',
  TRUE
FROM generate_series(1, 5) AS d
ON CONFLICT (mentor_id, day_of_week, start_time, end_time) DO NOTHING;
