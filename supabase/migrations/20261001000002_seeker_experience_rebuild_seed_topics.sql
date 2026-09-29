-- =============================================================================
-- SUGGEST KEY — SEEKER EXPERIENCE COMPLETE REBUILD
-- Seed: canonical topics for the three existing segments.
--
-- These are DATABASE rows, not React constants. The seeker topic bar reads
-- them through the public endpoint, so an admin adding a topic in the CMS
-- needs no deployment, and a topic set inactive here simply stops being
-- offered without a code change.
--
-- Deterministic UUIDs keep the seed idempotent (ON CONFLICT DO UPDATE) and
-- keep future `gig_topics` references stable.
--
-- A fourth segment created by an admin works identically: it has topics, a
-- config and an accent, and nothing in the frontend knows its slug.
-- =============================================================================

-- AUTISM MENTOR
INSERT INTO public.segment_topics (id, segment_id, name, slug, description, priority, is_active) VALUES
  ('a1000001-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000002', 'Early signs',      'early-signs',         'What to look for in the first years, and when to raise it with a doctor.', 10, TRUE),
  ('a1000001-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000002', 'Diagnosis',        'diagnosis',           'Getting assessed, what a diagnosis means, and what to do next.', 20, TRUE),
  ('a1000001-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000002', 'Therapies',        'therapies',           'Choosing between speech, occupational and behavioural therapy, and what progress looks like.', 30, TRUE),
  ('a1000001-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000002', 'Speech & language','speech-and-language', 'Communication milestones, alternatives to speech, and supporting a child who is not speaking.', 40, TRUE),
  ('a1000001-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000002', 'Schooling',        'schooling',           'School choices, accommodations and everyday classroom support.', 50, TRUE),
  ('a1000001-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000002', 'Behaviour',        'behaviour',           'Meltdowns, routines, and what sits behind a behaviour — without blame.', 60, TRUE),
  ('a1000001-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000002', 'Sensory needs',    'sensory-needs',       'Overload, sensory diets, and a home that regulates rather than escalates.', 70, TRUE),
  ('a1000001-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000002', 'Adult life',       'adult-life',          'College, work, relationships and independence beyond school.', 80, TRUE),
  ('a1000001-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000002', 'Parent wellbeing', 'parent-wellbeing',    'Looking after the caregiver, guilt, respite, and asking for help.', 90, TRUE)
ON CONFLICT (segment_id, slug) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    priority = EXCLUDED.priority,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();

-- RELATIONSHIP ADVISOR
INSERT INTO public.segment_topics (id, segment_id, name, slug, description, priority, is_active) VALUES
  ('b2000002-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000001', 'Couples',             'couples',              'Living together, ordinary friction, and rebuilding closeness.', 10, TRUE),
  ('b2000002-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000001', 'Marriage decisions', 'marriage-decisions',  'Staying, separating, and deciding without pressure from family.', 20, TRUE),
  ('b2000002-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000001', 'Communication',       'communication',        'Conversations that go somewhere, and breaking the argument loop.', 30, TRUE),
  ('b2000002-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000001', 'Family & in-laws',    'family-and-in-laws',   'Boundaries with family, cultural expectations and joint decisions.', 40, TRUE),
  ('b2000002-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000001', 'Dating',              'dating',               'Meeting people, first impressions, and what you are actually looking for.', 50, TRUE),
  ('b2000002-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000001', 'Breakups & divorce',  'breakups-and-divorce', 'Getting through a separation, and the first year afterwards.', 60, TRUE),
  ('b2000002-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000001', 'Trust & infidelity', 'trust-and-infidelity', 'Rebuilding trust, or deciding it cannot be rebuilt.', 70, TRUE),
  ('b2000002-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000001', 'Intimacy',            'intimacy',             'Closeness, desire mismatch, and conversations that are hard to start.', 80, TRUE),
  ('b2000002-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000001', 'Parenting together',  'parenting-together',   'Co-parenting, alignment, and disagreeing without damaging the children.', 90, TRUE)
ON CONFLICT (segment_id, slug) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    priority = EXCLUDED.priority,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();

-- CAREER MENTOR
INSERT INTO public.segment_topics (id, segment_id, name, slug, description, priority, is_active) VALUES
  ('c3000003-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000003', 'Career change',      'career-change',     'Moving sideways or into a different field without starting over.', 10, TRUE),
  ('c3000003-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000003', 'First job',          'first-job',         'Getting the first offer, and surviving the first ninety days.', 20, TRUE),
  ('c3000003-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000003', 'Interviews',         'interviews',        'Preparation, telling your story, and reading the room in a real loop.', 30, TRUE),
  ('c3000003-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000003', 'Salary negotiation', 'salary-negotiation','Asking for more, anchoring well, and knowing your market number.', 40, TRUE),
  ('c3000003-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000003', 'Leadership',         'leadership',        'Leading people, difficult conversations, and being credible to a team.', 50, TRUE),
  ('c3000003-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000003', 'Study abroad',       'study-abroad',      'Applications, funding, and choosing where to actually go.', 60, TRUE),
  ('c3000003-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000003', 'Entrance exams',     'entrance-exams',    'UPSC, CAT, NEET, banking — preparation that survives a working life.', 70, TRUE),
  ('c3000003-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000003', 'Burnout',            'burnout',           'Exhaustion that rest does not fix, and getting work back under control.', 80, TRUE),
  ('c3000003-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000003', 'Returning to work',  'returning-to-work', 'Coming back after a career break, a caregiving gap, or a health pause.', 90, TRUE)
ON CONFLICT (segment_id, slug) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    priority = EXCLUDED.priority,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();

-- -----------------------------------------------------------------------------
-- Link the seeded gigs to real topics.
--
-- Only ACTIVE topics of the SAME segment are linked, so this insert can never
-- trip trg_gig_topics_segment_ownership. ON CONFLICT DO NOTHING keeps the
-- UNIQUE (gig_id, topic_id) constraint intact on re-run.
-- -----------------------------------------------------------------------------
INSERT INTO public.gig_topics (gig_id, topic_id)
SELECT g.id, t.id
FROM public.gigs g
JOIN public.segment_topics t ON t.segment_id = g.segment_id
WHERE t.is_active = TRUE
  AND t.slug IN (
    -- Career gig
    'career-change', 'leadership', 'returning-to-work', 'burnout',
    -- Relationship gig
    'communication', 'couples', 'marriage-decisions',
    -- Autism gig
    'sensory-needs', 'early-signs', 'diagnosis'
  )
ON CONFLICT (gig_id, topic_id) DO NOTHING;
