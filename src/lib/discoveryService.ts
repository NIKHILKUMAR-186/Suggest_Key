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
  DirectoryMentor,
  DirectoryPagination,
  GeneratedSlot,
} from '@/src/types/database';
import { generateMentorSlots } from '@/src/lib/slotEngine';
import { deriveAccountState } from '@/src/lib/adminAccountControl';

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
 * 1b. Resolves a public segment slug (e.g. "career-advisor") to the internal
 * UUID the backend queries require. Used by pages that receive a slug in the
 * URL and need to call UUID-keyed service functions.
 */
export async function fetchSegmentBySlug(slug: string): Promise<Segment | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('segments')
      .select('*')
      .eq('slug', slug)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      console.error('Error fetching segment by slug from Supabase:', error);
      return null;
    }

    return (data as Segment) || null;
  } catch (err: any) {
    console.error('Error fetching segment by slug from Supabase:', err);
    return null;
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

    // 3. Get approved AND active mentor profiles and user profile.
    //
    //    A deactivated or suspended mentor must disappear from seeker
    //    discovery IMMEDIATELY (prompt section 5), so this query filters on
    //    is_active as well as is_approved. The old filter keyed off
    //    is_approved alone, which let a deactivated mentor keep appearing.
    //
    //    `account_status` lives on `profiles` and is read through the joined
    //    row: 'suspended' (and not yet lapsed) or 'deactivated' both remove the
    //    mentor from the list.
    const { data: mentorProfiles, error: mpErr } = await supabase
      .from('mentor_profiles')
      .select('*, profile:profiles(*)')
      .in('id', mentorIds)
      .eq('is_approved', true)
      .eq('is_active', true);

    if (mpErr) throw mpErr;

    const nowMs = currentUtcTime.getTime();
    const operableProfiles = (mentorProfiles || []).filter((mp: any) => isMentorEligible(mp, nowMs));

    if (operableProfiles.length === 0) {
      return { mentors: [], error: null };
    }

    const approvedMentorIds = operableProfiles.map((mp: { id: string }) => mp.id);

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

    for (const mp of operableProfiles) {
      const gig = gigs.find((g: Gig) => g.mentor_id === mp.id);
      if (!gig) continue; // No active gig for this segment

      // A mentor is only presentable with their real identity row. The
      // previous code substituted a fabricated `{ full_name: 'Mentor' }`
      // object when the embed was unreadable, which put invented business
      // data in front of seekers. A mentor whose profile cannot be read is
      // skipped instead.
      const profile = mp.profile;
      if (!profile?.full_name) {
        console.warn(
          `[discovery] Skipping mentor ${mp.id}: profiles row is not readable, so no real name is available.`
        );
        continue;
      }

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
        expertise: mp.expertise || null,
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
 * Shared mentor-eligibility rule used by BOTH discovery queries.
 *
 * "All Mentors"      = approved + active + not suspended + not deactivated
 * "Available Mentors" = the same, PLUS segment/gig/valid-slot rules
 *
 * RLS already hides non-publicly-visible mentors through
 * `mentor_is_publicly_visible()`, but the predicate is repeated here so the
 * result set stays correct even if the query is executed with elevated rights.
 *
 * The account-state half is delegated to the SHARED `deriveAccountState` used
 * by the server and the Admin Control Center, so discovery, booking validation
 * and the Admin UI can never disagree about whether a suspension is still in
 * force. Notably, a time-boxed suspension whose window has already elapsed no
 * longer hides the mentor here, exactly as on the server.
 */
function isMentorEligible(profile: any, nowMs: number): boolean {
  const state = deriveAccountState(
    {
      account_status: profile?.profile?.account_status ?? null,
      suspended_until: profile?.profile?.suspended_until ?? null,
    },
    new Date(nowMs),
  );
  return state.canPerformOperationalActions;
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
      // Same rule as the discovery list: never invent an identity. Without a
      // readable `profiles` row there is no real mentor to show.
      const profile = mpData.profile;
      if (!profile?.full_name) {
        console.warn(
          `[discovery] Mentor detail unavailable for ${mentorId}: profiles row is not readable.`
        );
        return { mentor: null, error: null };
      }

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
          expertise: mpData.expertise || null,
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

// --------------------------------------------------------------------------
// 5. VIEW ALL MENTORS (directory) - deliberately NOT the same query as
//    "Available Mentors". Bookability is NOT a requirement here.
// --------------------------------------------------------------------------

export interface AllMentorsQuery {
  search?: string;
  segmentId?: string | null;
  language?: string | null;
  minExperience?: number | null;
  maxExperience?: number | null;
  page?: number;
  pageSize?: number;
}

export interface AllMentorsResult {
  mentors: DirectoryMentor[];
  pagination: DirectoryPagination;
  error: Error | null;
}

const EMPTY_PAGINATION: DirectoryPagination = {
  page: 1,
  pageSize: 12,
  total: 0,
  totalPages: 0,
  hasNextPage: false,
};

/**
 * 5. Fetch ALL eligible mentors for the "View All Mentors" directory.
 *
 * Eligibility (the ONLY gate):
 *   approved + active + not suspended + not deactivated
 *
 * A mentor with zero bookable slots on any date is still returned, which is
 * exactly how this differs from `fetchDiscoverableMentors`.
 *
 * The number of round-trips is constant (independent of the mentor count) so
 * there is no N+1 pattern: two id-resolution queries when a search term is
 * present, one paged query, then two batched joins for segments and gigs.
 */
export async function fetchAllMentors(
  query: AllMentorsQuery = {},
  currentUtcTime: Date = new Date()
): Promise<AllMentorsResult> {
  const page = Math.max(1, query.page || 1);
  const pageSize = Math.min(50, Math.max(1, query.pageSize || 12));
  const search = (query.search || '').trim();

  if (!isSupabaseConfigured()) {
    return { mentors: [], pagination: { ...EMPTY_PAGINATION, page, pageSize }, error: null };
  }

  try {
    let allowedIds: string[] | null = null;

    // 1. Resolve the search term against real database fields.
    //    `profiles.full_name` lives in a different table than the rest, and
    //    `expertise` is a text[] column that `ilike` cannot target, so the
    //    OR-union is resolved with three id-only queries merged in memory.
    if (search) {
      const pattern = `%${search}%`;
      const merged = new Set<string>();

      const { data: nameMatches, error: nameErr } = await supabase
        .from('profiles')
        .select('id')
        .ilike('full_name', pattern);
      if (nameErr) throw nameErr;
      (nameMatches || []).forEach((r: { id: string }) => merged.add(r.id));

      const { data: textMatches, error: textErr } = await supabase
        .from('mentor_profiles')
        .select('id')
        .or(`headline.ilike.${pattern},about.ilike.${pattern}`);
      if (textErr) throw textErr;
      (textMatches || []).forEach((r: { id: string }) => merged.add(r.id));

      const { data: expertiseMatches, error: expertiseErr } = await supabase
        .from('mentor_profiles')
        .select('id')
        .contains('expertise', [search]);
      if (expertiseErr) throw expertiseErr;
      (expertiseMatches || []).forEach((r: { id: string }) => merged.add(r.id));

      allowedIds = Array.from(merged);
      if (allowedIds.length === 0) {
        return { mentors: [], pagination: { ...EMPTY_PAGINATION, page, pageSize }, error: null };
      }
    }

    // 2. Paged, filtered query on the eligible mentor set.
    let mentorQuery = supabase
      .from('mentor_profiles')
      .select('*, profile:profiles(id, full_name, avatar_url, timezone, account_status, suspended_until)', {
        count: 'exact',
      })
      .eq('is_approved', true)
      .eq('is_active', true)
      .eq('approval_status', 'approved');

    if (allowedIds) mentorQuery = mentorQuery.in('id', allowedIds);
    if (query.language) mentorQuery = mentorQuery.contains('languages', [query.language]);
    if (typeof query.minExperience === 'number') {
      mentorQuery = mentorQuery.gte('experience_years', query.minExperience);
    }
    if (typeof query.maxExperience === 'number') {
      mentorQuery = mentorQuery.lte('experience_years', query.maxExperience);
    }

    const from = (page - 1) * pageSize;
    mentorQuery = mentorQuery
      .order('is_featured', { ascending: false })
      .order('rating', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);

    const { data: rows, error: rowsErr, count } = await mentorQuery;
    if (rowsErr) throw rowsErr;

    const nowMs = currentUtcTime.getTime();
    const eligibleRows = (rows || []).filter((r: any) => isMentorEligible(r, nowMs));
    const total = typeof count === 'number' ? count : eligibleRows.length;

    const pagination: DirectoryPagination = {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      hasNextPage: from + pageSize < total,
    };

    if (eligibleRows.length === 0) {
      return { mentors: [], pagination, error: null };
    }

    const pageMentorIds = eligibleRows.map((r: { id: string }) => r.id);

    // 3. Batched segment membership + segment definitions.
    const { data: mentorSegments, error: msErr } = await supabase
      .from('mentor_segments')
      .select('mentor_id, segment_id')
      .in('mentor_id', pageMentorIds);
    if (msErr) throw msErr;

    const segmentIds = Array.from(
      new Set((mentorSegments || []).map((ms: { segment_id: string }) => ms.segment_id))
    );

    let segmentById = new Map<string, Segment>();
    if (segmentIds.length > 0) {
      const { data: segRows, error: segErr } = await supabase
        .from('segments')
        .select('*')
        .in('id', segmentIds)
        .eq('is_active', true);
      if (segErr) throw segErr;
      segmentById = new Map((segRows || []).map((s: Segment) => [s.id, s]));
    }

    // 4. Batched active gigs for the mentors on this page.
    const { data: gigRows, error: gigErr } = await supabase
      .from('gigs')
      .select('*')
      .in('mentor_id', pageMentorIds)
      .eq('is_active', true);
    if (gigErr) throw gigErr;

    // 5. Optional segment filter applied after the batched segment join.
    const matchesSegment = (mentorId: string) => {
      if (!query.segmentId) return true;
      return (mentorSegments || []).some(
        (ms: { mentor_id: string; segment_id: string }) =>
          ms.mentor_id === mentorId && ms.segment_id === query.segmentId
      );
    };

    const mentors: DirectoryMentor[] = eligibleRows
      .filter((mp: any) => matchesSegment(mp.id))
      .map((mp: any) => {
        const profile = mp.profile || {};
        const segments = (mentorSegments || [])
          .filter((ms: { mentor_id: string }) => ms.mentor_id === mp.id)
          .map((ms: { segment_id: string }) => segmentById.get(ms.segment_id))
          .filter((s): s is Segment => Boolean(s));

        const gigs = (gigRows || []).filter((g: Gig) => g.mentor_id === mp.id);
        const prices = gigs.map((g: Gig) => g.price_inr);

        return {
          id: mp.id,
          full_name: profile.full_name || 'Mentor',
          avatar_url: profile.avatar_url || null,
          timezone: profile.timezone || 'Asia/Kolkata',
          headline: mp.headline || '',
          about: mp.about || null,
          experience_years: mp.experience_years ?? 0,
          languages: mp.languages || [],
          expertise: mp.expertise || null,
          rating: Number(mp.rating) || 0,
          review_count: mp.review_count || 0,
          session_count: mp.session_count || 0,
          is_featured: !!mp.is_featured,
          segments,
          gigs,
          starting_price_inr: prices.length > 0 ? Math.min(...prices) : null,
        };
      });

    return { mentors, pagination, error: null };
  } catch (err: any) {
    console.error('Error fetching all mentors from Supabase:', err);
    return {
      mentors: [],
      pagination: { ...EMPTY_PAGINATION, page, pageSize },
      error: err,
    };
  }
}

/**
 * 6. Collect the distinct languages spoken by every eligible mentor.
 *
 * Populates the language filter from real data instead of a hardcoded list.
 */
export async function fetchEligibleLanguages(): Promise<{ languages: string[]; error: Error | null }> {
  if (!isSupabaseConfigured()) {
    return { languages: [], error: null };
  }

  try {
    const { data, error } = await supabase
      .from('mentor_profiles')
      .select('languages')
      .eq('is_approved', true)
      .eq('is_active', true)
      .eq('approval_status', 'approved');

    if (error) throw error;

    const langs = new Set<string>();
    (data || []).forEach((row: { languages?: string[] | null }) => {
      (row.languages || []).forEach((l) => {
        if (l) langs.add(l);
      });
    });

    return { languages: Array.from(langs).sort(), error: null };
  } catch (err: any) {
    console.error('Error fetching eligible languages from Supabase:', err);
    return { languages: [], error: err };
  }
}