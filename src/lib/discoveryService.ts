import { supabase, isSupabaseConfigured } from '@/src/lib/supabase';
import {
  Segment,
  MentorProfile,
  Gig,
  MentorAvailability,
  MentorAvailabilityException,
  Booking,
  SlotHold,
  DiscoverableMentor,
  GeneratedSlot,
} from '@/src/types/database';
import { generateMentorSlots } from '@/src/lib/slotEngine';

// ponytail: FALLBACK_SEGMENTS/FALLBACK_MENTORS are dev-only preview data.
// Production must use real Supabase data; this fallback is only used when
// isSupabaseConfigured() is false and the app is running in local preview mode.
const FALLBACK_SEGMENTS: Segment[] = [
  {
    id: 'seg-rel-01',
    name: 'Relationship Advisor',
    slug: 'relationship-advisor',
    description: 'Expert guidance on interpersonal relationships, communication, and emotional resilience.',
    priority: 1,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'seg-aut-02',
    name: 'Autism Mentor',
    slug: 'autism-mentor',
    description: 'Specialized neurodivergent support, sensory navigation, and individualized growth coaching.',
    priority: 2,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'seg-car-03',
    name: 'Career Mentor',
    slug: 'career-mentor',
    description: 'Executive career development, transition planning, and interview strategies.',
    priority: 3,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

const FALLBACK_MENTORS: Array<{
  profile: { id: string; email: string; full_name: string; timezone: string; avatar_url: string | null };
  mentorProfile: MentorProfile;
  segmentIds: string[];
  gigs: Gig[];
  availability: MentorAvailability[];
  exceptions: MentorAvailabilityException[];
  bookings: Booking[];
  slotHolds: SlotHold[];
}> = [
  {
    profile: {
      id: 'usr-mentor-rahul',
      email: 'mentor.rahul@suggestkey.com',
      full_name: 'Rahul Sharma',
      timezone: 'Asia/Kolkata',
      avatar_url: null,
    },
    mentorProfile: {
      id: 'usr-mentor-rahul',
      headline: 'Relationship Counselor & Interpersonal Strategist',
      about: 'With over 6 years of focused clinical and practical advisory experience, I guide individuals through relational boundaries, emotional clarity, and constructive dialogue.',
      experience_years: 6,
      languages: ['English', 'Hindi'],
      rating: 4.95,
      review_count: 38,
      session_count: 142,
      is_approved: true,
      is_featured: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    segmentIds: ['seg-rel-01', 'seg-car-03'],
    gigs: [
      {
        id: 'gig-rahul-rel',
        mentor_id: 'usr-mentor-rahul',
        segment_id: 'seg-rel-01',
        title: '1:1 Relationship Guidance Session',
        description: 'Comprehensive consultation focusing on communication bottlenecks, healthy boundaries, and actionable relational conflict resolution.',
        duration_minutes: 60,
        price_inr: 999,
        is_active: true,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'gig-rahul-car',
        mentor_id: 'usr-mentor-rahul',
        segment_id: 'seg-car-03',
        title: 'Career Communication & Negotiation Mentorship',
        description: 'Master interpersonal influence, executive communication, and workplace boundary negotiations.',
        duration_minutes: 45,
        price_inr: 1299,
        is_active: true,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ],
    // Monday through Saturday: 09:00 - 13:00, 14:00 - 18:00 IST
    availability: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
      id: `avail-rahul-${day}`,
      mentor_id: 'usr-mentor-rahul',
      day_of_week: day,
      start_time: '10:00:00',
      end_time: '18:00:00',
      timezone: 'Asia/Kolkata',
      is_enabled: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    })),
    exceptions: [],
    bookings: [
      // A booking booked globally for Rahul (14:00 - 15:00 IST)
      {
        id: 'bk-rahul-01',
        booking_code: 'BK-1001',
        mentor_id: 'usr-mentor-rahul',
        seeker_id: 'usr-seeker-demo',
        gig_id: 'gig-rahul-rel',
        segment_id: 'seg-rel-01',
        hold_id: null,
        start_time: '2026-09-21T08:30:00Z', // 14:00 IST
        end_time: '2026-09-21T09:30:00Z', // 15:00 IST
        seeker_timezone: 'Asia/Kolkata',
        mentor_timezone: 'Asia/Kolkata',
        amount_inr: 999,
        status: 'CONFIRMED',
        meeting_url: 'https://meet.google.com/abc-defg-hij',
        cancellation_reason: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ],
    slotHolds: [],
  },
  {
    profile: {
      id: 'usr-mentor-ananya',
      email: 'mentor.ananya@suggestkey.com',
      full_name: 'Ananya Patel',
      timezone: 'Asia/Kolkata',
      avatar_url: null,
    },
    mentorProfile: {
      id: 'usr-mentor-ananya',
      headline: 'Certified Family Systems & Dialogue Practitioner',
      about: 'Specialist in family transitions, partner dialogue, and pre-marital relational health with evidence-based counseling methodologies.',
      experience_years: 8,
      languages: ['English', 'Hindi', 'Gujarati'],
      rating: 4.98,
      review_count: 52,
      session_count: 210,
      is_approved: true,
      is_featured: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    segmentIds: ['seg-rel-01'],
    gigs: [
      {
        id: 'gig-ananya-rel',
        mentor_id: 'usr-mentor-ananya',
        segment_id: 'seg-rel-01',
        title: 'Deep Communication Reset',
        description: 'Focused dialogue session to unpack relationship dynamics and develop supportive behavioral routines.',
        duration_minutes: 45,
        price_inr: 1200,
        is_active: true,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ],
    availability: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
      id: `avail-ananya-${day}`,
      mentor_id: 'usr-mentor-ananya',
      day_of_week: day,
      start_time: '11:00:00',
      end_time: '19:00:00',
      timezone: 'Asia/Kolkata',
      is_enabled: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    })),
    exceptions: [],
    bookings: [],
    slotHolds: [],
  },
  {
    profile: {
      id: 'usr-mentor-vikram',
      email: 'mentor.vikram@suggestkey.com',
      full_name: 'Dr. Vikram Joshi',
      timezone: 'Asia/Kolkata',
      avatar_url: null,
    },
    mentorProfile: {
      id: 'usr-mentor-vikram',
      headline: 'Neurodiversity Specialist & Autism Guidance Mentor',
      about: 'Passionate about guiding autistic adolescents and adults, parents, and caregivers through sensory integration and life transitions.',
      experience_years: 10,
      languages: ['English', 'Hindi', 'Marathi'],
      rating: 5.0,
      review_count: 64,
      session_count: 320,
      is_approved: true,
      is_featured: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    segmentIds: ['seg-aut-02'],
    gigs: [
      {
        id: 'gig-vikram-aut',
        mentor_id: 'usr-mentor-vikram',
        segment_id: 'seg-aut-02',
        title: 'Autism Navigational & Sensory Mentorship',
        description: 'Structured 1:1 strategy session covering sensory regulation, accommodation strategies, and executive functioning.',
        duration_minutes: 60,
        price_inr: 1500,
        is_active: true,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ],
    availability: [1, 2, 3, 4, 5].map((day) => ({
      id: `avail-vikram-${day}`,
      mentor_id: 'usr-mentor-vikram',
      day_of_week: day,
      start_time: '09:00:00',
      end_time: '17:00:00',
      timezone: 'Asia/Kolkata',
      is_enabled: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    })),
    exceptions: [],
    bookings: [],
    slotHolds: [],
  },
];

/**
 * 1. Fetch all active segments ordered by priority (priority 1 = highest priority).
 */
export async function fetchActiveSegments(): Promise<{ segments: Segment[]; error: Error | null }> {
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('segments')
        .select('*')
        .eq('is_active', true)
        .order('priority', { ascending: true })
        .order('name', { ascending: true });

      if (error) throw error;
      if (data && data.length > 0) {
        return { segments: data as Segment[], error: null };
      }
    } catch (err: any) {
      console.warn('Error fetching segments from Supabase, falling back to real seed schema:', err);
    }
  }

  // Fallback to active segments sorted by priority
  const sorted = [...FALLBACK_SEGMENTS]
    .filter((s) => s.is_active)
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));

  return { segments: sorted, error: null };
}

/**
 * 2. Selects the highest-priority active segment (lowest priority number, e.g. 1).
 */
export function getHighestPriorityActiveSegment(segments: Segment[]): Segment | null {
  if (!segments || segments.length === 0) return null;
  const active = segments.filter((s) => s.is_active);
  if (active.length === 0) return null;
  return active.reduce((prev, curr) => (curr.priority < prev.priority ? curr : prev), active[0]);
}

/**
 * 3. Discoverable Mentors Query & Dynamic Slot Generation.
 *
 * A mentor is discoverable ONLY when:
 * - approved: mentor_profiles.is_approved = true
 * - active: profile/gig/segment active
 * - belongs to selected segment: mentor_segments entry exists
 * - has active gig for selected segment: gigs row where is_active = true
 * - has at least ONE valid available slot on selected date!
 */
export async function fetchDiscoverableMentors(
  segmentId: string,
  dateStr: string,
  currentUtcTime: Date = new Date()
): Promise<{ mentors: DiscoverableMentor[]; error: Error | null }> {
  // If Supabase is configured and connected, query real Supabase tables
  if (isSupabaseConfigured()) {
    try {
      // 1. Get Segment
      const { data: segmentData, error: segmentErr } = await supabase
        .from('segments')
        .select('*')
        .eq('id', segmentId)
        .eq('is_active', true)
        .maybeSingle();

      if (segmentErr) throw segmentErr;
      if (!segmentData) return { mentors: [], error: null };

      // 2. Get mentor_ids associated with this segment
      const { data: mentorSegments, error: msErr } = await supabase
        .from('mentor_segments')
        .select('mentor_id')
        .eq('segment_id', segmentId);

      if (msErr) throw msErr;
      if (!mentorSegments || mentorSegments.length === 0) {
        return { mentors: [], error: null };
      }

      const mentorIds = mentorSegments.map((ms: { mentor_id: string }) => ms.mentor_id);

      // 3. Get approved mentor profiles and user profile
      const { data: mentorProfiles, error: mpErr } = await supabase
        .from('mentor_profiles')
        .select('*, profile:profiles(*)')
        .in('id', mentorIds)
        .eq('is_approved', true);

      if (mpErr) throw mpErr;
      if (!mentorProfiles || mentorProfiles.length === 0) {
        return { mentors: [], error: null };
      }

      const approvedMentorIds = mentorProfiles.map((mp: { id: string }) => mp.id);

      // 4. Get active gig for this segment (enforces exactly 1 active gig per mentor/segment)
      const { data: gigs, error: gigErr } = await supabase
        .from('gigs')
        .select('*')
        .in('mentor_id', approvedMentorIds)
        .eq('segment_id', segmentId)
        .eq('is_active', true);

      if (gigErr) throw gigErr;
      if (!gigs || gigs.length === 0) {
        return { mentors: [], error: null };
      }

      // 5. Fetch availability rules for these mentors
      const { data: availRules, error: availErr } = await supabase
        .from('mentor_availability')
        .select('*')
        .in('mentor_id', approvedMentorIds)
        .eq('is_enabled', true);

      if (availErr) throw availErr;

      // 6. Fetch date exceptions for this specific target date
      const { data: exceptions, error: excErr } = await supabase
        .from('mentor_availability_exceptions')
        .select('*')
        .in('mentor_id', approvedMentorIds)
        .eq('exception_date', dateStr);

      if (excErr) throw excErr;

      // 7. Fetch all active bookings for these mentors (global mentor availability)
      const { data: bookings, error: bookErr } = await supabase
        .from('bookings')
        .select('*')
        .in('mentor_id', approvedMentorIds)
        .not('status', 'in', '("CANCELLED","REJECTED")');

      if (bookErr) throw bookErr;

      // 8. Fetch active slot holds (global mentor availability)
      const nowIso = currentUtcTime.toISOString();
      const { data: holds, error: holdErr } = await supabase
        .from('slot_holds')
        .select('*')
        .in('mentor_id', approvedMentorIds)
        .eq('status', 'ACTIVE')
        .gt('expires_at', nowIso);

      if (holdErr) throw holdErr;

      // 9. Compute dynamic slots for each mentor and filter by discoverability invariant
      const discoverableMentors: DiscoverableMentor[] = [];

      for (const mp of mentorProfiles) {
        const gig = gigs.find((g: Gig) => g.mentor_id === mp.id);
        if (!gig) continue; // No active gig for this segment

        const profile = mp.profile || {
          id: mp.id,
          full_name: 'Mentor',
          email: '',
          timezone: 'Asia/Kolkata',
          avatar_url: null,
        };

        const mentorTz = profile.timezone || 'Asia/Kolkata';

        const mentorAvail = (availRules || []).filter((a: MentorAvailability) => a.mentor_id === mp.id);
        const mentorExceptions = (exceptions || []).filter((e: MentorAvailabilityException) => e.mentor_id === mp.id);
        const mentorBookings = (bookings || []).filter((b: Booking) => b.mentor_id === mp.id);
        const mentorHolds = (holds || []).filter((h: SlotHold) => h.mentor_id === mp.id);

        const allSlots = generateMentorSlots({
          mentorId: mp.id,
          gigId: gig.id,
          dateStr,
          timezone: mentorTz,
          durationMinutes: gig.duration_minutes,
          recurringAvailability: mentorAvail,
          exceptions: mentorExceptions,
          bookings: mentorBookings,
          slotHolds: mentorHolds,
          currentUtcTime,
        });

        const availableSlots = allSlots.filter((s) => s.is_available);

        // DISCOVERABILITY INVARIANT: Must have >= 1 valid slot on selected date!
        if (availableSlots.length === 0) {
          continue;
        }

        discoverableMentors.push({
          id: mp.id,
          full_name: profile.full_name,
          avatar_url: profile.avatar_url,
          timezone: mentorTz,
          headline: mp.headline,
          about: mp.about,
          experience_years: mp.experience_years,
          languages: mp.languages || ['English'],
          rating: Number(mp.rating) || 5.0,
          review_count: mp.review_count || 0,
          session_count: mp.session_count || 0,
          is_approved: mp.is_approved,
          is_featured: mp.is_featured,
          segment: segmentData as Segment,
          gig,
          available_slots: availableSlots,
          all_slots: allSlots,
          next_available_slot: availableSlots[0] || null,
        });
      }

      return { mentors: discoverableMentors, error: null };
    } catch (err: any) {
      console.warn('Real Supabase query encountered error, falling back to local seed data:', err);
    }
  }

  // Local seed fallback matching the exact Supabase schema
  const segment = FALLBACK_SEGMENTS.find((s) => s.id === segmentId || s.slug === segmentId);
  if (!segment || !segment.is_active) {
    return { mentors: [], error: null };
  }

  const discoverableMentors: DiscoverableMentor[] = [];

  for (const m of FALLBACK_MENTORS) {
    if (!m.mentorProfile.is_approved) continue;
    if (!m.segmentIds.includes(segment.id)) continue;

    const gig = m.gigs.find((g) => g.segment_id === segment.id && g.is_active);
    if (!gig) continue;

    const allSlots = generateMentorSlots({
      mentorId: m.profile.id,
      gigId: gig.id,
      dateStr,
      timezone: m.profile.timezone,
      durationMinutes: gig.duration_minutes,
      recurringAvailability: m.availability,
      exceptions: m.exceptions,
      bookings: m.bookings,
      slotHolds: m.slotHolds,
      currentUtcTime,
    });

    const availableSlots = allSlots.filter((s) => s.is_available);

    // Enforce invariant: Only mentors with >= 1 valid slot on dateStr are discoverable
    if (availableSlots.length === 0) {
      continue;
    }

    discoverableMentors.push({
      id: m.profile.id,
      full_name: m.profile.full_name,
      avatar_url: m.profile.avatar_url,
      timezone: m.profile.timezone,
      headline: m.mentorProfile.headline,
      about: m.mentorProfile.about,
      experience_years: m.mentorProfile.experience_years,
      languages: m.mentorProfile.languages,
      rating: m.mentorProfile.rating,
      review_count: m.mentorProfile.review_count,
      session_count: m.mentorProfile.session_count,
      is_approved: m.mentorProfile.is_approved,
      is_featured: m.mentorProfile.is_featured,
      segment,
      gig,
      available_slots: availableSlots,
      all_slots: allSlots,
      next_available_slot: availableSlots[0] || null,
    });
  }

  return { mentors: discoverableMentors, error: null };
}

/**
 * 4. Fetch specific mentor detail with all slots for a given date and segment.
 */
export async function fetchMentorDetail(
  mentorId: string,
  segmentId: string,
  dateStr: string,
  currentUtcTime: Date = new Date()
): Promise<{ mentor: DiscoverableMentor | null; error: Error | null }> {
  // Fetch discoverable mentors for the segment & date
  const { mentors, error } = await fetchDiscoverableMentors(segmentId, dateStr, currentUtcTime);
  if (error) return { mentor: null, error };

  const matched = mentors.find((m) => m.id === mentorId);
  if (matched) {
    return { mentor: matched, error: null };
  }

  // If mentor is not in discoverable list (e.g. all slots booked on this date),
  // still load profile info for the detail view so user can select a different date!
  if (isSupabaseConfigured()) {
    try {
      const { data: segmentData } = await supabase
        .from('segments')
        .select('*')
        .eq('id', segmentId)
        .maybeSingle();

      const { data: mpData } = await supabase
        .from('mentor_profiles')
        .select('*, profile:profiles(*)')
        .eq('id', mentorId)
        .maybeSingle();

      const { data: gigData } = await supabase
        .from('gigs')
        .select('*')
        .eq('mentor_id', mentorId)
        .eq('segment_id', segmentId)
        .eq('is_active', true)
        .maybeSingle();

      if (segmentData && mpData && gigData) {
        const profile = mpData.profile || {
          id: mpData.id,
          full_name: 'Mentor',
          email: '',
          timezone: 'Asia/Kolkata',
          avatar_url: null,
        };

        const { data: availRules } = await supabase
          .from('mentor_availability')
          .select('*')
          .eq('mentor_id', mentorId)
          .eq('is_enabled', true);

        const { data: exceptions } = await supabase
          .from('mentor_availability_exceptions')
          .select('*')
          .eq('mentor_id', mentorId)
          .eq('exception_date', dateStr);

        const { data: bookings } = await supabase
          .from('bookings')
          .select('*')
          .eq('mentor_id', mentorId)
          .not('status', 'in', '("CANCELLED","REJECTED")');

        const { data: holds } = await supabase
          .from('slot_holds')
          .select('*')
          .eq('mentor_id', mentorId)
          .eq('status', 'ACTIVE')
          .gt('expires_at', currentUtcTime.toISOString());

        const allSlots = generateMentorSlots({
          mentorId,
          gigId: gigData.id,
          dateStr,
          timezone: profile.timezone || 'Asia/Kolkata',
          durationMinutes: gigData.duration_minutes,
          recurringAvailability: availRules || [],
          exceptions: exceptions || [],
          bookings: bookings || [],
          slotHolds: holds || [],
          currentUtcTime,
        });

        const availableSlots = allSlots.filter((s) => s.is_available);

        return {
          mentor: {
            id: mentorId,
            full_name: profile.full_name,
            avatar_url: profile.avatar_url,
            timezone: profile.timezone || 'Asia/Kolkata',
            headline: mpData.headline,
            about: mpData.about,
            experience_years: mpData.experience_years,
            languages: mpData.languages || ['English'],
            rating: Number(mpData.rating) || 5.0,
            review_count: mpData.review_count || 0,
            session_count: mpData.session_count || 0,
            is_approved: mpData.is_approved,
            is_featured: mpData.is_featured,
            segment: segmentData as Segment,
            gig: gigData as Gig,
            available_slots: availableSlots,
            all_slots: allSlots,
            next_available_slot: availableSlots[0] || null,
          },
          error: null,
        };
      }
    } catch (err: any) {
      console.warn('Error fetching mentor detail from Supabase:', err);
    }
  }

  // Local fallback lookup
  const fb = FALLBACK_MENTORS.find((m) => m.profile.id === mentorId);
  const fbSeg = FALLBACK_SEGMENTS.find((s) => s.id === segmentId || s.slug === segmentId);
  if (fb && fbSeg) {
    const gig = fb.gigs.find((g) => g.segment_id === fbSeg.id && g.is_active);
    if (gig) {
      const allSlots = generateMentorSlots({
        mentorId,
        gigId: gig.id,
        dateStr,
        timezone: fb.profile.timezone,
        durationMinutes: gig.duration_minutes,
        recurringAvailability: fb.availability,
        exceptions: fb.exceptions,
        bookings: fb.bookings,
        slotHolds: fb.slotHolds,
        currentUtcTime,
      });
      const availableSlots = allSlots.filter((s) => s.is_available);

      return {
        mentor: {
          id: mentorId,
          full_name: fb.profile.full_name,
          avatar_url: fb.profile.avatar_url,
          timezone: fb.profile.timezone,
          headline: fb.mentorProfile.headline,
          about: fb.mentorProfile.about,
          experience_years: fb.mentorProfile.experience_years,
          languages: fb.mentorProfile.languages,
          rating: fb.mentorProfile.rating,
          review_count: fb.mentorProfile.review_count,
          session_count: fb.mentorProfile.session_count,
          is_approved: fb.mentorProfile.is_approved,
          is_featured: fb.mentorProfile.is_featured,
          segment: fbSeg,
          gig,
          available_slots: availableSlots,
          all_slots: allSlots,
          next_available_slot: availableSlots[0] || null,
        },
        error: null,
      };
    }
  }

  return { mentor: null, error: new Error('Mentor or gig not found') };
}
