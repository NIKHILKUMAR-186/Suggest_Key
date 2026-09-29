/**
 * SEGMENT TOPICS - the canonical, database-backed topic taxonomy.
 *
 * A topic is a real row in `public.segment_topics` owned by exactly one
 * segment. The seeker topic bar, the mentor gig editor and the admin CMS all
 * read and write these rows; nothing in this file hardcodes a topic name.
 *
 * The two properties this module guarantees:
 *
 *  1. OWNERSHIP. A topic belongs to exactly one segment, and a gig may only
 *     reference topics of its own segment. `isTopicOwnedBySegment` is the
 *     client-side mirror of the database trigger of the same name - it exists
 *     so the UI can explain the error clearly, not to replace the database.
 *
 *  2. URL STATE. The selected segment and topic survive a refresh and a
 *     back/forward navigation, and switching either never triggers a full
 *     page load. The helpers below are pure string functions precisely so
 *     this is testable without a browser.
 */

import { supabase, isSupabaseConfigured } from '@/src/lib/supabase';
import { apiFetch } from '@/src/lib/apiClient';
import { logSanitizer } from '@/src/lib/logSanitizer';
import { isValidTopicSlug, slugifyTopicName } from '@/src/lib/topicSlug';

export { isValidTopicSlug, slugifyTopicName };

/** A topic exactly as `public.segment_topics` stores it. */
export interface SegmentTopic {
  id: string;
  segment_id: string;
  name: string;
  slug: string;
  description: string | null;
  priority: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** A topic plus the derived shape the UI actually needs. */
export interface SegmentTopicView {
  id: string;
  name: string;
  slug: string;
  description: string;
  priority: number;
}

/** Topic rows as returned by the admin endpoints, which include usage counts. */
export interface AdminSegmentTopic extends SegmentTopic {
  /** How many gigs currently reference this topic. */
  gig_count: number;
}

/** A gig as the topic-filtered marketplace endpoint returns it. */
export interface TopicGig {
  id: string;
  title: string;
  description: string;
  duration_minutes: number;
  price_inr: number;
}

/** A mentor as the topic-filtered marketplace endpoint returns them. */
export interface TopicMentor {
  id: string;
  full_name: string;
  avatar_url: string | null;
  timezone: string;
  headline: string;
  about: string | null;
  experience_years: number;
  languages: string[];
  expertise: string[] | null;
  rating: number;
  review_count: number;
  session_count: number;
  is_featured: boolean;
  is_primary_segment: boolean;
  segment: { id: string; name: string; slug: string };
  gigs: TopicGig[];
  /** The gig that represents this mentor inside this segment. */
  gig: TopicGig;
  /** Present only when the request was date-scoped. */
  available_slots?: Array<{ start_time: string; end_time: string; is_available: boolean }>;
}
// ---------------------------------------------------------------------------
// Pure helpers (no I/O - directly unit-testable)
// ---------------------------------------------------------------------------

/**
 * Whether `topic` may be attached to a gig in `segmentId`.
 *
 * The counterpart of `enforce_gig_topic_segment_ownership()` in Postgres. A
 * Career topic can therefore never be selected for a Relationship gig in the
 * mentor UI, and the server re-checks the same rule independently.
 */
export function isTopicOwnedBySegment(
  topic: Pick<SegmentTopic, 'segment_id'> | null | undefined,
  segmentId: string | null | undefined,
): boolean {
  if (!topic || !segmentId) return false;
  return topic.segment_id === segmentId;
}

/**
 * Keep only the topics that belong to `segmentId`, in priority order.
 *
 * Inactive topics are excluded unless `includeInactive` is set, which the
 * admin CMS uses to show a retired topic that gigs still reference.
 */
export function selectSegmentTopics<T extends SegmentTopic>(
  topics: T[] | null | undefined,
  segmentId: string | null | undefined,
  options: { includeInactive?: boolean } = {},
): T[] {
  if (!Array.isArray(topics) || !segmentId) return [];
  const { includeInactive = false } = options;
  return topics
    .filter((topic) => topic && topic.segment_id === segmentId)
    .filter((topic) => includeInactive || topic.is_active)
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

/** Map raw rows to the compact shape the topic bar renders. */
export function toTopicViews(topics: SegmentTopic[]): SegmentTopicView[] {
  return (topics || []).map((topic) => ({
    id: topic.id,
    name: topic.name,
    slug: topic.slug,
    description: topic.description ?? '',
    priority: topic.priority,
  }));
}

// ---------------------------------------------------------------------------
// URL state
// ---------------------------------------------------------------------------

/** The empty selection, represented as "everything". */
export const ALL_TOPICS = 'all';

/**
 * Parse the `segment` and `topic` selection out of a location.
 *
 * Accepts EITHER a bare search string (`?segment=x`) OR a full location path
 * (`/seeker?segment=x`), because the app's navigation context hands out the
 * latter. Handing `"/seeker?segment=career-mentor"` straight to
 * `URLSearchParams` parses the whole thing as one key named
 * `"/seeker?segment"`, so `get('segment')` returns null and every segment
 * silently fell back to the default one - which is exactly the bug this
 * function exists to prevent. Everything up to the first `?` is dropped first.
 *
 * Tolerates a missing, empty or hostile topic value: anything that is not a
 * valid topic slug collapses to `all`, so a hand-edited URL can never put the
 * page into a state the UI cannot render.
 */
export function parseExperienceQuery(location: string): { segment: string | null; topic: string } {
  const queryStart = (location || '').indexOf('?');
  const search = queryStart === -1 ? '' : (location || '').slice(queryStart + 1);

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return { segment: null, topic: ALL_TOPICS };
  }

  const segmentRaw = params.get('segment');
  const segment = segmentRaw && /^[a-z0-9-]{2,60}$/.test(segmentRaw) ? segmentRaw : null;

  const topicRaw = params.get('topic');
  const topic = topicRaw && isValidTopicSlug(topicRaw) ? topicRaw : ALL_TOPICS;

  return { segment, topic };
}

/**
 * Build the search string for a selection.
 *
 * `all` is written as an absent `topic` parameter rather than `?topic=all`, so
 * the canonical URL for "no filter" stays clean and shareable.
 */
export function buildExperienceQuery(
  segmentSlug: string | null | undefined,
  topicSlug: string | null | undefined,
): string {
  const params = new URLSearchParams();
  if (segmentSlug) params.set('segment', segmentSlug);
  if (topicSlug && topicSlug !== ALL_TOPICS && isValidTopicSlug(topicSlug)) {
    params.set('topic', topicSlug);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}
// ---------------------------------------------------------------------------
// Seeker data access
// ---------------------------------------------------------------------------

/**
 * Load the ACTIVE topics of a segment, in display order.
 *
 * Reads the public endpoint rather than querying Supabase directly, so the
 * response is the same one every other client sees - including the server's
 * own `is_active` filtering. A failure returns an empty list plus an error:
 * the topic bar then renders "All" only, which is honest, rather than
 * inventing topics.
 */
export async function fetchSegmentTopics(
  segmentSlug: string | null | undefined,
): Promise<{ topics: SegmentTopicView[]; error: Error | null }> {
  if (!segmentSlug || !isSupabaseConfigured()) {
    return { topics: [], error: null };
  }

  try {
    const res = await apiFetch(`/api/seeker/segments/${encodeURIComponent(segmentSlug)}/topics`);

    let payload: any = null;
    try {
      payload = await res.json();
    } catch {
      return { topics: [], error: new Error('Topics returned an unreadable response.') };
    }

    if (!res.ok || !payload?.success) {
      return { topics: [], error: new Error(payload?.error?.message || 'Unable to load topics.') };
    }

    const rows: SegmentTopic[] = Array.isArray(payload.topics) ? payload.topics : [];
    return { topics: toTopicViews(rows), error: null };
  } catch (err) {
    console.error('Error fetching segment topics:', logSanitizer.safeMessage(err));
    return {
      topics: [],
      error: err instanceof Error ? err : new Error('Unable to load topics.'),
    };
  }
}

/**
 * Directly read a segment's active topics over Supabase Realtime.
 *
 * Used by the seeker's live subscription so an admin adding or retiring a
 * topic updates the open page. The RLS policy on `segment_topics` restricts a
 * non-admin subscriber to active topics of an active segment, so this query
 * can never surface a draft.
 */
export async function fetchSegmentTopicsRealtime(
  segmentId: string | null | undefined,
): Promise<SegmentTopic[]> {
  if (!segmentId || !isSupabaseConfigured()) return [];
  try {
    const { data, error } = await supabase
      .from('segment_topics')
      .select('id, segment_id, name, slug, description, priority, is_active, created_at, updated_at')
      .eq('segment_id', segmentId)
      .eq('is_active', true)
      .order('priority', { ascending: true });
    if (error) throw error;
    return (data as SegmentTopic[]) || [];
  } catch (err) {
    console.error('Error fetching segment topics (realtime path):', logSanitizer.safeMessage(err));
    return [];
  }
}
/**
 * The real marketplace list for a segment, optionally narrowed to one topic.
 *
 * This is the data layer behind the topic chips. The filter is applied in the
 * database through `gig_topics`, not in the browser, so "Interviews" shows
 * exactly the mentors whose ACTIVE gig covers Interviews - never a
 * client-side guess over an already-fetched list.
 *
 * `dateStr` additionally requires a real free slot, computed by the existing
 * server-side availability engine. There is no fallback list: a failure is
 * returned as an error for the UI to render.
 */
export async function fetchSegmentMentorsByTopic(
  segmentSlug: string | null | undefined,
  options: { topicSlug?: string | null; dateStr?: string | null } = {},
): Promise<{ mentors: TopicMentor[]; error: Error | null }> {
  if (!segmentSlug || !isSupabaseConfigured()) {
    return { mentors: [], error: null };
  }

  const params = new URLSearchParams();
  if (options.topicSlug && options.topicSlug !== ALL_TOPICS) {
    params.set('topic', options.topicSlug);
  }
  if (options.dateStr) params.set('date', options.dateStr);
  const query = params.toString();

  try {
    const res = await apiFetch(
      `/api/seeker/segments/${encodeURIComponent(segmentSlug)}/mentors${query ? `?${query}` : ''}`,
    );

    let payload: any = null;
    try {
      payload = await res.json();
    } catch {
      return { mentors: [], error: new Error('Mentors returned an unreadable response.') };
    }
    if (!res.ok || !payload?.success) {
      return { mentors: [], error: new Error(payload?.error?.message || 'Unable to load mentors.') };
    }

    return { mentors: Array.isArray(payload.mentors) ? payload.mentors : [], error: null };
  } catch (err) {
    console.error('Error fetching segment mentors:', logSanitizer.safeMessage(err));
    return {
      mentors: [],
      error: err instanceof Error ? err : new Error('Unable to load mentors.'),
    };
  }
}
// ---------------------------------------------------------------------------
// Admin data access
// ---------------------------------------------------------------------------

/** Every topic of a segment, including inactive ones, with usage counts. */
export async function fetchAdminSegmentTopics(
  segmentId: string | null | undefined,
): Promise<{ topics: AdminSegmentTopic[]; error: Error | null }> {
  if (!segmentId) return { topics: [], error: null };

  const res = await apiFetch(`/api/admin/segments/${encodeURIComponent(segmentId)}/topics`);
  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    return { topics: [], error: new Error('Topics returned an unreadable response.') };
  }
  if (!res.ok || !payload?.success) {
    return { topics: [], error: new Error(payload?.error?.message || 'Unable to load topics.') };
  }
  return { topics: Array.isArray(payload.topics) ? payload.topics : [], error: null };
}

/** Create a topic. The slug is derived server-side from the name. */
export async function createSegmentTopic(
  segmentId: string,
  input: { name: string; description?: string; isActive?: boolean },
): Promise<{ topic: AdminSegmentTopic | null; error: Error | null }> {
  const res = await apiFetch(`/api/admin/segments/${encodeURIComponent(segmentId)}/topics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    return { topic: null, error: new Error('The server returned an unreadable response.') };
  }
  if (!res.ok || !payload?.success) {
    return { topic: null, error: new Error(payload?.error?.message || 'Unable to create the topic.') };
  }
  return { topic: payload.topic ?? null, error: null };
}

/** Edit a topic, toggle it, or move it in the display order. */
export async function updateSegmentTopic(
  segmentId: string,
  topicId: string,
  patch: { name?: string; description?: string; isActive?: boolean; priority?: number },
): Promise<{ topic: AdminSegmentTopic | null; error: Error | null }> {
  const res = await apiFetch(
    `/api/admin/segments/${encodeURIComponent(segmentId)}/topics/${encodeURIComponent(topicId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
  );
  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    return { topic: null, error: new Error('The server returned an unreadable response.') };
  }
  if (!res.ok || !payload?.success) {
    return { topic: null, error: new Error(payload?.error?.message || 'Unable to update the topic.') };
  }
  return { topic: payload.topic ?? null, error: null };
}

/**
 * Delete a topic.
 *
 * The server refuses with 409 while any gig still references it, so the UI
 * never has to warn about data loss it cannot actually cause - deactivating
 * the topic is the safe retirement path.
 */
export async function deleteSegmentTopic(
  segmentId: string,
  topicId: string,
): Promise<{ deleted: boolean; error: Error | null }> {
  const res = await apiFetch(
    `/api/admin/segments/${encodeURIComponent(segmentId)}/topics/${encodeURIComponent(topicId)}`,
    { method: 'DELETE' },
  );
  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    return { deleted: false, error: new Error('The server returned an unreadable response.') };
  }
  if (!res.ok || !payload?.success) {
    return {
      deleted: false,
      error: new Error(payload?.error?.message || 'Unable to delete the topic.'),
    };
  }
  return { deleted: true, error: null };
}
/** Replace the topic selection of a gig (server-validated for ownership). */
export async function setGigTopics(
  gigId: string,
  topicIds: string[],
): Promise<{ topicIds: string[] | null; error: Error | null }> {
  const res = await apiFetch(`/api/admin/gigs/${encodeURIComponent(gigId)}/topics`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topicIds }),
  });
  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    return { topicIds: null, error: new Error('The server returned an unreadable response.') };
  }
  if (!res.ok || !payload?.success) {
    return { topicIds: null, error: new Error(payload?.error?.message || 'Unable to save topics.') };
  }
  return { topicIds: payload.topicIds ?? [], error: null };
}

/** The topics currently attached to a gig. */
export async function fetchGigTopics(
  gigId: string,
): Promise<{ topicIds: string[]; error: Error | null }> {
  const res = await apiFetch(`/api/admin/gigs/${encodeURIComponent(gigId)}/topics`);
  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    return { topicIds: [], error: new Error('The server returned an unreadable response.') };
  }
  if (!res.ok || !payload?.success) {
    return { topicIds: [], error: new Error(payload?.error?.message || 'Unable to load topics.') };
  }
  return { topicIds: Array.isArray(payload.topicIds) ? payload.topicIds : [], error: null };
}