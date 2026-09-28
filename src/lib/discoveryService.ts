import { supabase, isSupabaseConfigured } from '@/src/lib/supabase';
import { apiFetch } from '@/src/lib/apiClient';
import { logSanitizer } from '@/src/lib/logSanitizer';
import {
  Segment,
  MentorProfile,
  Gig,
  DiscoverableMentor,
  DirectoryMentor,
  DirectoryPagination,
  GeneratedSlot,
} from '@/src/types/database';
import { deriveAccountState } from '@/src/lib/adminAccountControl';
import { normalizeSegmentExperience, type SegmentExperienceConfig } from '@/src/lib/segmentExperience';

/**
 * Shape returned by `GET /api/mentor-availability/slots` for one mentor.
 * Mirrors the server's `MentorSlotResult`.
 */
export interface MentorSlotResponse {
  mentor_id: string;
  timezone: string;
  gig: {
    id: string;
    segment_id: string;
    title: string;
    duration_minutes: number;
    price_inr: number;
  } | null;
  slots: GeneratedSlot[];
  available_count: number;
  next_hold_expires_at: string | null;
  next_slot_start_at: string | null;
}

export interface MentorSlotsResult {
  generated_at: string;
  byMentorId: Map<string, MentorSlotResponse>;
}

/**
 * THE single client entry point for slot availability.
 *
 * Slots are never generated in the browser and never copied into component
 * state: they are produced by the server from the live `mentor_availability`,
 * `mentor_availability_exceptions`, `gigs`, `bookings` and `slot_holds` tables.
 * That matters because the RLS policies on `bookings` and `slot_holds` are
 * participant-scoped â€” a client query would only ever see the caller's own
 * reservations and would offer slots that are already taken.
 *
 * There is no fallback slot list. If the request fails the caller receives an
 * error and must render an error state, never invented times.
 */
export async function fetchMentorSlots(
  query: { mentorId: string } | { segmentId: string },
  dateStr: string
): Promise<{ data: MentorSlotsResult | null; error: Error | null }> {
  if (!isSupabaseConfigured()) {
    return { data: null, error: new Error('Supabase is not configured') };
  }

  const params = new URLSearchParams({ date: dateStr });
  if ('mentorId' in query) {
    params.set('mentorId', query.mentorId);
  } else {
    params.set('segmentId', query.segmentId);
  }

  let res: Response;
  try {
    res = await apiFetch(`/api/mentor-availability/slots?${params.toString()}`);
  } catch {
    return { data: null, error: new Error('Unable to reach the availability service.') };
  }

  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    return { data: null, error: new Error('Availability service returned a malformed response.') };
  }

  if (!res.ok || !payload?.success) {
    return {
      data: null,
      error: new Error(payload?.error?.message || 'Unable to load availability.'),
    };
  }

  const byMentorId = new Map<string, MentorSlotResponse>();
  for (const entry of payload.mentors || []) {
    if (entry?.mentor_id) byMentorId.set(entry.mentor_id, entry as MentorSlotResponse);
  }

  return {
    data: {
      generated_at: payload.generated_at || new Date().toISOString(),
      byMentorId,
    },
    error: null,
  };
}

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
    console.error('Error fetching segments from Supabase:', logSanitizer.safeMessage(err));
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
      console.error('Error fetching segment by slug from Supabase:', logSanitizer.safeMessage(error));
      return null;
    }

    return (data as Segment) || null;
  } catch (err: any) {
    console.error('Error fetching segment by slug from Supabase:', logSanitizer.safeMessage(err));
    return null;
  }
}

export interface SegmentExperience {
  id: string;
  name: string;
  slug: string;
  experience_config: SegmentExperienceConfig;
}

export async function fetchSegmentExperience(slug: string): Promise<{ experience: SegmentExperience | null; error: Error | null }> {
  if (!isSupabaseConfigured()) {
    return { experience: null, error: null };
  }

  try {
    const res = await apiFetch(`/api/seeker/segments/${encodeURIComponent(slug)}/experience`);
    let payload: any = null;
    try {
      payload = await res.json();
    } catch {
      return { experience: null, error: new Error('Segment experience returned an unreadable response.') };
    }
    if (!res.ok || !payload?.success) {
      return { experience: null, error: new Error(payload?.error?.message || 'Unable to load segment experience.') };
    }
    return {
      experience: {
        id: payload.segment.id,
        name: payload.segment.name,
        slug: payload.segment.slug,
        experience_config: normalizeSegmentExperience(payload.segment.experience_config),
      },
      error: null,
    };
  } catch (err: any) {
    console.error('Error fetching segment experience:', logSanitizer.safeMessage(err));
    return { experience: null, error: err instanceof Error ? err : new Error('Unable to load segment experience.') };
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

    // 5. Slot availability comes from the server, which is the only principal
    //    that can read every booking and hold for these mentors. The browser
    //    cannot do this itself: RLS scopes `bookings` and `slot_holds` to the
    //    participants of a reservation, so a client-side query returns only the
    //    caller's own rows and would advertise slots other seekers already own.
    const { data: slotData, error: slotErr } = await fetchMentorSlots({ segmentId }, dateStr);
    if (slotErr) throw slotErr;

    // 6. Compute the discovery invariant from the authoritative slot list.
    const discoverableMentors: DiscoverableMentor[] = [];

    for (const mp of operableProfiles) {
      const slotResult = slotData?.byMentorId.get(mp.id);
      if (!slotResult?.gig) continue; // No active gig for this segment

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

      const allSlots = slotResult.slots;
      const availableSlots = allSlots.filter((s) => s.is_available);

      // DISCOVERABILITY INVARIANT: Must have >= 1 valid slot on selected date!
      if (availableSlots.length === 0) {
        continue;
      }

      discoverableMentors.push({
        id: mp.id,
        full_name: profile.full_name,
        avatar_url: profile.avatar_url,
        timezone: slotResult.timezone,
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
        gig: slotResult.gig as unknown as Gig,
        available_slots: availableSlots,
        all_slots: allSlots,
        next_available_slot: availableSlots[0] || null,
        next_hold_expires_at: slotResult.next_hold_expires_at,
        next_slot_start_at: slotResult.next_slot_start_at,
        availability_generated_at: slotData?.generated_at,
      });
    }

    return { mentors: discoverableMentors, error: null };
  } catch (err: any) {
    console.error('Error fetching discoverable mentors from Supabase:', logSanitizer.safeMessage(err));
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
 *
 * The slot list is produced by the server (`GET /api/mentor-availability/slots`),
 * never by this browser context, and the page keeps only the returned value — no
 * copied list of times is ever stored client-side. Switching `dateStr` re-runs
 * this call, so a new date always reflects the mentor's live schedule, their
 * bookings and any active holds.
 *
 * Unlike the discovery list, a mentor with zero bookable slots on this date is
 * still returned: the detail page must be able to explain that and offer
 * "Choose another date".
 */
export async function fetchMentorDetail(
  mentorId: string,
  segmentId: string,
  dateStr: string,
  currentUtcTime: Date = new Date()
): Promise<{ mentor: DiscoverableMentor | null; error: Error | null }> {
  if (!isSupabaseConfigured()) {
    return { mentor: null, error: new Error('Supabase is not configured') };
  }

  try {
    const [segmentRes, mentorRes, slotsRes] = await Promise.all([
      supabase
        .from('segments')
        .select('*')
        .eq('id', segmentId)
        .maybeSingle(),
      supabase
        .from('mentor_profiles')
        .select('*, profile:profiles(*)')
        .eq('id', mentorId)
        .maybeSingle(),
      fetchMentorSlots({ mentorId, segmentId }, dateStr),
    ]);

    if (segmentRes.error) throw segmentRes.error;
    if (mentorRes.error) throw mentorRes.error;
    if (slotsRes.error) throw slotsRes.error;

    const segmentData = segmentRes.data as Segment | null;
    const mpData = mentorRes.data as any;
    const slotResult = slotsRes.data?.byMentorId.get(mentorId) || null;

    if (!segmentData || !mpData || !slotResult?.gig) {
      return { mentor: null, error: null };
    }

    // Same rule as the discovery list: never invent an identity. Without a
    // readable `profiles` row there is no real mentor to show.
    const profile = mpData.profile;
    if (!profile?.full_name) {
      console.warn(
        `[discovery] Mentor detail unavailable for ${mentorId}: profiles row is not readable.`
      );
      return { mentor: null, error: null };
    }

    const allSlots = slotResult.slots;
    const availableSlots = allSlots.filter((s) => s.is_available);

    return {
      mentor: {
        id: mentorId,
        full_name: profile.full_name,
        avatar_url: profile.avatar_url,
        timezone: slotResult.timezone,
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
        segment: segmentData,
        gig: slotResult.gig as unknown as Gig,
        available_slots: availableSlots,
        all_slots: allSlots,
        next_available_slot: availableSlots[0] || null,
        next_hold_expires_at: slotResult.next_hold_expires_at,
        next_slot_start_at: slotResult.next_slot_start_at,
        availability_generated_at: slotsRes.data?.generated_at,
      },
      error: null,
    };
  } catch (err: any) {
    console.error('Error fetching mentor detail:', logSanitizer.safeMessage(err));
    return {
      mentor: null,
      error: new Error(err?.message || 'Unable to load availability.'),
    };
  }
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
    console.error('Error fetching all mentors from Supabase:', logSanitizer.safeMessage(err));
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
    console.error('Error fetching eligible languages from Supabase:', logSanitizer.safeMessage(err));
    return { languages: [], error: err };
  }
}
