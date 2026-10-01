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
import {
  describeGigContextMismatch,
  GIG_CONTEXT_ERROR_MESSAGE,
} from '@/src/lib/gigContext';

/**
 * Shape returned by `GET /api/mentor-availability/slots` for one mentor.
 * Mirrors the server's `MentorSlotResult`.
 */
export interface MentorSlotResponse {
  mentor_id: string;
  timezone: string;
  /**
   * The single gig this slot list was generated from. The ownership columns are
   * echoed by the server so the caller can verify the gig it got is the gig it
   * asked for, rather than trusting that the lookup picked correctly.
   */
  gig: {
    id: string;
    mentor_id: string;
    segment_id: string;
    title: string;
    description: string | null;
    duration_minutes: number;
    price_inr: number;
    is_active: boolean;
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
 * A scope for the slot request.
 *
 * `mentorId`, `segmentId` and `gigId` are all forwarded when present. The bug
 * this replaces used `if ('mentorId' in query) ... else ...`, so asking for a
 * mentor WITH a segment silently dropped the segment: the server received the
 * mentor alone and had no segment to narrow the gig lookup on, which is how the
 * Autism Mentor segment could be answered with a Relationship Guidance gig.
 * Passing all three keeps the request an exact statement of intent.
 */
export type MentorSlotQuery = {
  mentorId?: string;
  segmentId?: string;
  gigId?: string;
};

/**
 * THE single client entry point for slot availability.
 *
 * Slots are never generated in the browser and never copied into component
 * state: they are produced by the server from the live `mentor_availability`,
 * `mentor_availability_exceptions`, `gigs`, `bookings` and `slot_holds` tables.
 * That matters because the RLS policies on `bookings` and `slot_holds` are
 * participant-scoped — a client query would only ever see the caller's own
 * reservations and would offer slots that are already taken.
 *
 * There is no fallback slot list. If the request fails the caller receives an
 * error and must render an error state, never invented times.
 */
export async function fetchMentorSlots(
  query: MentorSlotQuery,
  dateStr: string
): Promise<{ data: MentorSlotsResult | null; error: Error | null }> {
  if (!isSupabaseConfigured()) {
    return { data: null, error: new Error('Supabase is not configured') };
  }

  const params = new URLSearchParams({ date: dateStr });
  if (query.mentorId) params.set('mentorId', query.mentorId);
  if (query.segmentId) params.set('segmentId', query.segmentId);
  if (query.gigId) params.set('gigId', query.gigId);

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
 * `gigId` is optional but is the strongest signal available: when the caller
 * arrived from a specific offer, that exact gig must be the one resolved. It is
 * forwarded to the server so the slot grid is generated from that gig's
 * duration, and it is re-verified here so a mismatch can never be rendered.
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
  options: { gigId?: string | null } = {},
  currentUtcTime: Date = new Date()
): Promise<{ mentor: DiscoverableMentor | null; error: Error | null }> {
  if (!isSupabaseConfigured()) {
    return { mentor: null, error: new Error('Supabase is not configured') };
  }

  const requestedGigId = options.gigId || null;

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
      fetchMentorSlots({ mentorId, segmentId, gigId: requestedGigId ?? undefined }, dateStr),
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

    // -------------------------------------------------------------------------
    // GIG / SEGMENT / MENTOR VERIFICATION
    //
    // The gig the page is about to render must be provably the gig this call
    // asked for. All three ownership predicates are checked, plus the explicit
    // `gigId` when the route carried one. A failure is an error state, never a
    // substitution: showing this mentor's *other* gig under this segment's name
    // is the exact defect being fixed, and it is worse than showing nothing.
    // -------------------------------------------------------------------------
    const gig = slotResult.gig;
    const mismatchReason = describeGigContextMismatch({
      gig,
      mentorId,
      segmentId,
      requestedGigId,
    });
    if (mismatchReason) {
      console.warn(
        `[discovery] Mentor detail unavailable for ${mentorId}: ${mismatchReason}`
      );
      return { mentor: null, error: new Error(GIG_CONTEXT_ERROR_MESSAGE) };
    }

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
// 4b. PUBLIC MENTOR PROFILE
//
// The seeker-facing profile read model. Deliberately separate from
// `fetchMentorDetail`, which answers a booking question ("this gig, on this
// date, which slots are free") and therefore needs a segment and generates
// slots. A profile asks neither question, and asking it per segment would
// silently truncate a multi-segment mentor to one offer.
//
// `offers` is the whole list, never a single resolved gig: this function must
// not pick a default, because the database allows one ACTIVE gig per segment
// and a mentor may hold several. The caller chooses.
// --------------------------------------------------------------------------

/** One ACTIVE gig, joined to the ACTIVE segment it belongs to. */
export interface PublicMentorOffer {
  gigId: string;
  mentorId: string;
  segmentId: string;
  segmentName: string;
  segmentSlug: string;
  isPrimarySegment: boolean;
  title: string;
  description: string | null;
  durationMinutes: number;
  priceInr: number;
}

export interface PublicMentorSegment {
  id: string;
  name: string;
  slug: string;
  isPrimary: boolean;
}

/**
 * Exactly the fields the public profile is allowed to render.
 *
 * There is deliberately no `email`, `phone`, `internalNote`, `accountStatus`,
 * suspension or deactivation field here, and no verification, booking or payment
 * data: the server does not select those columns, so this type cannot grow one
 * by accident.
 */
export interface PublicMentorProfile {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  timezone: string;
  headline: string;
  about: string | null;
  experienceYears: number;
  languages: string[];
  expertise: string[] | null;
  isApproved: boolean;
  isFeatured: boolean;
  segments: PublicMentorSegment[];
  offers: PublicMentorOffer[];
}

function toPublicMentorProfile(raw: any): PublicMentorProfile | null {
  if (!raw || typeof raw.id !== 'string' || !raw.id) return null;
  return {
    id: raw.id,
    fullName: raw.fullName ?? '',
    avatarUrl: raw.avatarUrl ?? null,
    timezone: raw.timezone || 'Asia/Kolkata',
    headline: raw.headline ?? '',
    about: raw.about ?? null,
    experienceYears: Number(raw.experienceYears) || 0,
    languages: Array.isArray(raw.languages) ? raw.languages : [],
    expertise: Array.isArray(raw.expertise) ? raw.expertise : null,
    isApproved: Boolean(raw.isApproved),
    isFeatured: Boolean(raw.isFeatured),
    segments: Array.isArray(raw.segments) ? raw.segments : [],
    offers: Array.isArray(raw.offers) ? raw.offers : [],
  };
}

/**
 * Loads one mentor's public profile and every active offer they sell.
 *
 * There is no fallback and no cached copy: a failure is returned as an error so
 * the page can render an error state, never a partially invented mentor.
 *
 * A 404 means the mentor is not publicly visible (unapproved, inactive,
 * suspended, deactivated, or in no active segment). It is reported as a null
 * profile with no error, because that is an absent record rather than a failure
 * the seeker can retry.
 */
export async function fetchPublicMentorProfile(
  mentorId: string
): Promise<{ mentor: PublicMentorProfile | null; error: Error | null }> {
  if (!isSupabaseConfigured()) {
    return { mentor: null, error: new Error('Supabase is not configured') };
  }
  if (!mentorId) {
    return { mentor: null, error: null };
  }

  try {
    const res = await apiFetch(`/api/seeker/mentors/${encodeURIComponent(mentorId)}/profile`);

    let payload: any = null;
    try {
      payload = await res.json();
    } catch {
      return { mentor: null, error: new Error('Mentor profile returned an unreadable response.') };
    }

    if (res.status === 404) {
      return { mentor: null, error: null };
    }
    if (!res.ok || !payload?.success) {
      return {
        mentor: null,
        error: new Error(payload?.error?.message || 'Unable to load this mentor.'),
      };
    }

    return { mentor: toPublicMentorProfile(payload.mentor), error: null };
  } catch (err) {
    console.error('Error fetching public mentor profile:', logSanitizer.safeMessage(err));
    return {
      mentor: null,
      error: err instanceof Error ? err : new Error('Unable to load this mentor.'),
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

// --------------------------------------------------------------------------
// 7. AVAILABILITY SUMMARY FOR THE DIRECTORY — display only, never a filter
// --------------------------------------------------------------------------

/**
 * What the directory knows about one mentor on one date.
 *
 * `state` is three-valued on purpose. Collapsing "no slot on this date" and
 * "we could not reach the availability service" into one `none` value is what
 * makes a busy day look like a broken mentor, so the two stay apart.
 */
export type DirectoryAvailabilityState = 'available' | 'none' | 'unknown';

export interface DirectoryMentorAvailability {
  mentorId: string;
  state: DirectoryAvailabilityState;
  /** Real free slots on the date. Never a computed or estimated number. */
  availableCount: number;
  /** The earliest free slot's local start time, e.g. '18:30'. Null when none. */
  nextLocalStartTime: string | null;
  /** The segment whose offer the slot belongs to. Null when unknown. */
  segmentId: string | null;
  /** The offer the slot belongs to. Null when the mentor has no active offer. */
  gigId: string | null;
  /** When the server generated this. Absent on 'unknown'. */
  generatedAt: string | null;
}

export interface DirectoryAvailabilityResult {
  byMentorId: Map<string, DirectoryMentorAvailability>;
  /** True when at least one segment lookup failed, so the page can say so. */
  partial: boolean;
}

/**
 * Picks which of two availability answers for the SAME mentor should be shown.
 *
 * A mentor holds one active gig per segment, so `fetchMentorDirectoryAvailability`
 * receives them once per segment and this is where those collapse into one. The
 * ordering encodes the only three facts that matter:
 *
 *   1. A real slot beats no slot, always.
 *   2. Among real slots, the earliest is the one a seeker actually wants.
 *   3. Any answer beats none, so `first` stands until `second` beats it.
 *
 * `'unknown'` is deliberately NOT an input: a segment that failed to answer
 * never produces a candidate at all, so an unresolved segment can never
 * overwrite a real answer. "No slot" and "no answer" stay distinct facts all the
 * way to the card.
 */
export function pickBetterDirectoryAvailability(
  first: DirectoryMentorAvailability | null | undefined,
  second: DirectoryMentorAvailability | null | undefined
): DirectoryMentorAvailability | null {
  if (!first) return second ?? null;
  if (!second) return first;
  if (first.state !== 'available' && second.state === 'available') return second;
  if (first.state === 'available' && second.state === 'available') {
    const earlier = (second.nextLocalStartTime || '99:99') < (first.nextLocalStartTime || '99:99');
    return earlier ? second : first;
  }
  return first;
}

/**
 * Availability for every mentor on a page of the global directory, for ONE
 * date, used to render "Available on Oct 2" or "No slots on Oct 2".
 *
 * The critical property: this function CANNOT remove a mentor. It has no
 * filtering role at all — it returns a map, and the page decides what to draw
 * for a mentor that is missing from it. That is why the availability-first
 * discovery query (`fetchDiscoverableMentors`) and this one are separate: there,
 * a missing slot removes the mentor; here, a missing slot only changes a label.
 *
 * Bookability still comes from the server and never from the browser. Slots are
 * not generated here, not cached here and not inferred from the client's clock:
 * every number below is read from `GET /api/mentor-availability/slots`, the same
 * endpoint mentor detail uses, because RLS scopes `bookings` and `slot_holds` to
 * the participants of a reservation and a direct client query would only ever
 * see the caller's own rows.
 *
 * Round trips are per DISTINCT SEGMENT on the page, not per mentor: the endpoint
 * already answers for every mentor of a segment in one response, so a directory
 * page spanning four segments costs four calls rather than twelve.
 *
 * A segment whose lookup fails contributes nothing and leaves its mentors in
 * the `unknown` state. It is never downgraded to `none`, because "no slot" and
 * "no answer" are different facts and only one of them is a claim about the
 * mentor.
 */
export async function fetchMentorDirectoryAvailability(
  mentors: DirectoryMentor[],
  dateStr: string
): Promise<DirectoryAvailabilityResult> {
  const byMentorId = new Map<string, DirectoryMentorAvailability>();
  if (mentors.length === 0) return { byMentorId, partial: false };
  if (!isSupabaseConfigured()) return { byMentorId, partial: false };

  // Only segments the mentors on THIS page actually belong to are requested.
  const segmentIds = Array.from(
    new Set(mentors.flatMap((m) => (m.segments || []).map((s) => s.id)).filter(Boolean))
  );

  if (segmentIds.length === 0) return { byMentorId, partial: false };

  let partial = false;
  const responses = await Promise.all(
    segmentIds.map((segmentId) => fetchMentorSlots({ segmentId }, dateStr))
  );

  responses.forEach((response) => {
    if (response.error || !response.data) {
      partial = true;
      return;
    }
    for (const result of response.data.byMentorId.values()) {
      const availableSlots = (result.slots || []).filter((s) => s.is_available);
      const candidate: DirectoryMentorAvailability = {
        mentorId: result.mentor_id,
        state: availableSlots.length > 0 ? 'available' : 'none',
        availableCount: availableSlots.length,
        nextLocalStartTime: availableSlots[0]?.local_start_time ?? null,
        segmentId: result.gig?.segment_id ?? null,
        gigId: result.gig?.id ?? null,
        generatedAt: response.data?.generated_at ?? null,
      };

      const current = byMentorId.get(result.mentor_id);
      // A mentor may hold one active gig per segment, so they appear once per
      // segment. Keep the most useful answer rather than whichever segment
      // happened to be requested last: any real slot beats none, and among real
      // slots the earliest is the one a seeker actually wants.
      const best = pickBetterDirectoryAvailability(current, candidate);
      if (best) byMentorId.set(result.mentor_id, best);
    }
  });

  return { byMentorId, partial };
}
