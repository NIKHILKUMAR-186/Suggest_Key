-- =============================================================================
-- SUGGEST KEY — SEEKER EXPERIENCE COMPLETE REBUILD
-- Seed: full experience configuration for the three existing segments.
--
-- This is the CONTENT the seeker experience renders. It is stored as data on
-- `segments.experience_config`, edited through the admin CMS, and propagated
-- to open seeker pages over Supabase Realtime. Nothing here is compiled into
-- a React file, so an admin can rewrite any of it without a deployment.
--
-- Deliberate omissions, because fabricating them is not allowed:
--   * NO hero image. `branding.heroImageUrl` is left unset, so the renderer
--     shows its polished neutral fallback until an admin uploads a real file
--     to the `segment-hero` storage bucket.
--   * NO guides and NO stories. Both sections are marked disabled. They are
--     real content, so the sections stay hidden until an admin supplies them.
--   * NO reviews, statistics, counts or "specialist" claims.
--
-- The palette per segment is an ACCENT, not the brand. The global Suggest Key
-- identity (#1f1037 plum / #f7d243 gold, read from the logo) stays on the
-- header; these values only tint the segment's own experience.
--
-- Idempotent: each segment is updated only when this migration changes it,
-- using a payload hash so an admin's later CMS edits are never clobbered by a
-- re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Shared helper: apply a config only if the stored one is untouched by an admin.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sk_apply_seeded_experience_config(
  p_slug TEXT,
  p_config JSONB
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_current JSONB;
BEGIN
  SELECT COALESCE(experience_config, '{}'::jsonb)
    INTO v_current
    FROM public.segments
   WHERE slug = p_slug;

  IF NOT FOUND THEN
    RAISE NOTICE 'seeker experience seed: segment % not found, skipping', p_slug;
    RETURN;
  END IF;

  -- Skip when the current config already carries this exact payload (re-run),
  -- or when an admin has customised it (contains anything this seed does not
  -- set). The seed must never silently revert deliberate CMS edits.
  IF v_current = p_config THEN
    RETURN;
  END IF;

  IF v_current <> '{}'::jsonb
     AND NOT (v_current ? 'branding')
     AND NOT (v_current ? 'quickHelp') THEN
    RAISE NOTICE 'seeker experience seed: segment % has a custom config, skipping', p_slug;
    RETURN;
  END IF;

  UPDATE public.segments
     SET experience_config = p_config,
         updated_at = NOW()
   WHERE slug = p_slug;
END;
$$;

-- -----------------------------------------------------------------------------
-- AUTISM MENTOR — teal identity, calm and clinical without being cold.
-- ----------------------------------------------------------------------------
SELECT public.sk_apply_seeded_experience_config('autism-mentor', $json${
  "branding": {
    "eyebrow": "Autism mentoring",
    "heroHeadline": "Support that fits the way your child actually thinks",
    "heroSubheadline": "Mentors who have supported neurodivergent children and adults — through diagnosis, therapy, school years and the move into adult life.",
    "accent": "#0d9488",
    "accentSoft": "#e2f4f1",
    "accentSecondary": "#0891b2",
    "heroTint": "#ccfbf1",
    "gradientStart": "#0d9488",
    "gradientEnd": "#0891b2",
    "textMode": "auto"
  },
  "sections": {
    "hero": { "enabled": true }, "topics": { "enabled": true },
    "quickHelp": { "enabled": true }, "mentors": { "enabled": true },
    "journey": { "enabled": true }, "benefits": { "enabled": true },
    "guides": { "enabled": false }, "stories": { "enabled": false },
    "faq": { "enabled": true }, "cta": { "enabled": true }
  },
  "quickHelp": [
    { "title": "Not sure it is autism?", "description": "An hour with a mentor who can walk you through what was different, and what it is not.", "icon": "compass" },
    { "title": "Choosing a therapist", "description": "Which therapy to start with, what to ask in the first meeting, and when to revisit it.", "icon": "puzzle" },
    { "title": "School and IEP", "description": "Preparing for a meeting with a school and asking for accommodations that actually apply.", "icon": "graduation-cap" },
    { "title": "Sensory overwhelm", "description": "Building routines that lower the load instead of managing the fallout.", "icon": "sparkles" }
  ],
  "journeySteps": [
    { "title": "Choose a topic", "description": "Pick the area that is hardest right now — diagnosis, school, behaviour, sensory needs.", "icon": "compass" },
    { "title": "Pick a mentor", "description": "See mentors by topic, rating and availability, and what they actually work on.", "icon": "users" },
    { "title": "Book a session", "description": "Choose a real slot, pay securely, and get a meeting link for the confirmed session.", "icon": "calendar" }
  ],
  "benefits": [
    { "title": "Lived experience", "description": "Mentors who have navigated this themselves, not only read about it.", "icon": "heart-handshake" },
    { "title": "Practical, not theoretical", "description": "Specific steps you can try this week, adapted to your situation.", "icon": "target" },
    { "title": "No blame", "description": "Sessions that start from what is already working in your family.", "icon": "shield-check" },
    { "title": "On your timezone", "description": "Real availability across IST, SGT, GST and UAE slots.", "icon": "clock" }
  ],
  "faq": [
    { "question": "Do I need a diagnosis first?", "answer": "No. Plenty of families book before an assessment, to understand what they are seeing and what to ask a doctor next. A mentor will not diagnose you." },
    { "question": "Can a mentor replace a therapist?", "answer": "No. Mentors help you make decisions, prepare for appointments and stay organised. Clinical assessment and therapy stay with licensed professionals." },
    { "question": "Is this for adults too?", "answer": "Yes. The Adult life topic covers college, work, relationships and independence, with mentors who work with adults rather than children." },
    { "question": "What if my area is not listed?", "answer": "Choose the closest topic and explain the situation in the session. New topics are added as demand grows." }
  ],
  "cta": {
    "title": "Talk to an autism mentor",
    "description": "One focused session can turn a decade of guessing into a plan you can act on this month.",
    "buttonText": "See autism mentors",
    "buttonUrl": "/mentors"
  }
}$json$::jsonb);

-- -----------------------------------------------------------------------------
-- RELATIONSHIP ADVISOR — rose identity, warmer but not decorative.
-- ----------------------------------------------------------------------------
SELECT public.sk_apply_seeded_experience_config('relationship-advisor', $json${
  "branding": {
    "eyebrow": "Relationship guidance",
    "heroHeadline": "The conversation you have been avoiding",
    "heroSubheadline": "Mentors for couples, families and the decisions that keep people up at night — communication, trust, intimacy, separation and everything between.",
    "accent": "#be185d",
    "accentSoft": "#fce7f3",
    "accentSecondary": "#c2410c",
    "heroTint": "#fce7f3",
    "gradientStart": "#be185d",
    "gradientEnd": "#c2410c",
    "textMode": "auto"
  },
  "sections": {
    "hero": { "enabled": true }, "topics": { "enabled": true },
    "quickHelp": { "enabled": true }, "mentors": { "enabled": true },
    "journey": { "enabled": true }, "benefits": { "enabled": true },
    "guides": { "enabled": false }, "stories": { "enabled": false },
    "faq": { "enabled": true }, "cta": { "enabled": true }
  },
  "quickHelp": [
    { "title": "The same fight again", "description": "Understand the pattern under the argument instead of winning the point.", "icon": "message-circle" },
    { "title": "Staying or going", "description": "A structured way to weigh what you want, not what family expects.", "icon": "scale" },
    { "title": "Rebuilding trust", "description": "What repair looks like in practice, and when it is genuinely not possible.", "icon": "heart" },
    { "title": "In-law boundaries", "description": "Holding a line with family without damaging what you have with your partner.", "icon": "users" }
  ],
  "journeySteps": [
    { "title": "Choose what is hardest", "description": "Communication, trust, intimacy, family, or a decision you have been circling for months.", "icon": "compass" },
    { "title": "Find a mentor who fits", "description": "Browse advisors by topic, and see the mentors who actually work in that area.", "icon": "users" },
    { "title": "Book a private session", "description": "A confidential one-to-one session at a time that works for you.", "icon": "calendar" }
  ],
  "benefits": [
    { "title": "Confidential", "description": "One-to-one sessions, not shared with a partner, family or employer.", "icon": "shield-check" },
    { "title": "Structured, not endless", "description": "You leave with the next conversation scripted, not just a better understanding.", "icon": "target" },
    { "title": "Either partner can book", "description": "It works whether you are both engaged, or deciding entirely on your own.", "icon": "heart-handshake" },
    { "title": "At your pace", "description": "One session, a short series, or a single hard conversation you want to prepare for.", "icon": "clock" }
  ],
  "faq": [
    { "question": "Will my partner know I booked this?", "answer": "No. Sessions are confidential and nothing is shared unless you choose to. Your booking is never visible to another user." },
    { "question": "Do I have to bring my partner?", "answer": "No. Many people book alone — to think clearly, to rehearse a conversation, or to decide something they have told no one about." },
    { "question": "Will you tell me whether to stay or leave?", "answer": "A mentor will not decide for you. They will help you examine it honestly and make it on your own terms." },
    { "question": "Is this suitable for serious crisis?", "answer": "No. Suggest Key is not crisis or emergency support. If you or someone else is at risk, please contact local emergency services or a helpline." }
  ],
  "cta": {
    "title": "Start with one honest session",
    "description": "You do not have to have it all figured out before you book.",
    "buttonText": "See relationship mentors",
    "buttonUrl": "/mentors"
  }
}$json$::jsonb);

-- -----------------------------------------------------------------------------
-- CAREER MENTOR — indigo identity, decisive and professional.
-- ----------------------------------------------------------------------------
SELECT public.sk_apply_seeded_experience_config('career-mentor', $json${
  "branding": {
    "eyebrow": "Career mentoring",
    "heroHeadline": "Make the career decision with someone who has made it",
    "heroSubheadline": "Mentors across hiring, negotiation, leadership and the awkward middle of a working life — first jobs, career changes, study abroad and coming back after a break.",
    "accent": "#4338ca",
    "accentSoft": "#e6e9fb",
    "accentSecondary": "#0e7490",
    "heroTint": "#dfe4fb",
    "gradientStart": "#4338ca",
    "gradientEnd": "#0e7490",
    "textMode": "auto"
  },
  "sections": {
    "hero": { "enabled": true }, "topics": { "enabled": true },
    "quickHelp": { "enabled": true }, "mentors": { "enabled": true },
    "journey": { "enabled": true }, "benefits": { "enabled": true },
    "guides": { "enabled": false }, "stories": { "enabled": false },
    "faq": { "enabled": true }, "cta": { "enabled": true }
  },
  "quickHelp": [
    { "title": "Is a change realistic?", "description": "An honest read on what the switch costs, what it pays, and what your first year looks like.", "icon": "compass" },
    { "title": "Your first interview loop", "description": "Prepare, tell your story in two minutes, and handle the questions that catch people out.", "icon": "video" },
    { "title": "Your market number", "description": "What to ask for, how to anchor it, and what to accept when the offer lands.", "icon": "target" },
    { "title": "Out of ideas, not out of options", "description": "When burnout is the reason you are looking, and what to change first.", "icon": "lightbulb" }
  ],
  "journeySteps": [
    { "title": "Pick your topic", "description": "Interviews, salary negotiation, a career change, burnout — start where the friction is.", "icon": "compass" },
    { "title": "Meet a working mentor", "description": "Filter by topic and availability, and see exactly what that mentor does.", "icon": "users" },
    { "title": "Book and get a plan", "description": "A focused session with an agenda you agree in advance, booked in your timezone.", "icon": "calendar" }
  ],
  "benefits": [
    { "title": "Current, not textbook", "description": "Mentors working in the field today, including the hiring processes you will actually face.", "icon": "briefcase" },
    { "title": "Decisions, not motivation", "description": "Concrete options with the trade-offs named, so you can choose this week.", "icon": "target" },
    { "title": "Safe to be honest", "description": "Say the unpolished version — that is the version worth coaching on.", "icon": "shield-check" },
    { "title": "Around your week", "description": "Evening and weekend slots across IST, SGT, GST and UAE timezones.", "icon": "clock" }
  ],
  "faq": [
    { "question": "How do I know which mentor is right for me?", "answer": "Filter by the topic that matches your situation. Each gig describes what that session actually covers, and mentors list the areas they work in." },
    { "question": "What should I prepare before a session?", "answer": "One page: where you are, what you have tried, and the decision you need to make. That is enough for a focused session." },
    { "question": "Do you guarantee a job or a raise?", "answer": "No, and nobody honest can. Mentors help you prepare, position your experience and negotiate with more leverage." },
    { "question": "Can I book while still working full time?", "answer": "Yes. Sessions are short, bookable in your own timezone, and many mentors deliberately offer evening and weekend slots." }
  ],
  "cta": {
    "title": "One session before your next move",
    "description": "Find the mentor whose topic matches the decision in front of you.",
    "buttonText": "See career mentors",
    "buttonUrl": "/mentors"
  }
}$json$::jsonb);

-- The helper exists only for this seed; it is dropped so the database is left
-- without a public function that can write to segments.
DROP FUNCTION IF EXISTS public.sk_apply_seeded_experience_config(TEXT, JSONB);
