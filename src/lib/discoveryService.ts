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

/**
 * 1. Fetch all active segments ordered by priority (priority 1 = highest priority).
 */
export async function fetchActiveSegments(): Promise<{ segments: Segment[]; error: Error | null }> {
  if (!isSupabaseConfigured()) {
    return { segments: [], error: null };
  }

  try {
    const { data, error } = await supabase
      .from('segments')
      .select('*')
      .eq('is_active', true)
      .order('priority', { ascending: true })
      .order('name', { ascending: true });

    if (error) throw error;
    return { segments: (data as Segment[]) || [], error: null };
  } catch (err: any) {
    console.error('Error fetching segments from Supabase:', err);
    return { segments: [], error: err };
  }
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
  if (!isSupabaseConfigured()) {
    return { mentors: [], error: null };
  }

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
        languages: mp.languages || [],
        rating: Number(mp.rating) || 0,
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
    console.error('Error fetching discoverable mentors from Supabase:', err);
    return { mentors: [], error: err };
  }
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
  if (!isSupabaseConfigured()) {
    return { mentor: null, error: new Error('Supabase not configured') };
  }

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
          languages: mpData.languages || [],
          rating: Number(mpData.rating) || 0,
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
    console.error('Error fetching mentor detail from Supabase:', err);
  }

  return { mentor: null, error: new Error('Mentor or gig not found') };
}