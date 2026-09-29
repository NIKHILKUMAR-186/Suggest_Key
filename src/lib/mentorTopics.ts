/**
 * Mentor-side topic selection.
 *
 * A mentor sees only the ACTIVE topics of segments they actually belong to,
 * and the gig editor further narrows that list to the gig's own segment. That
 * narrowing is the user-facing half of the ownership rule; the server
 * re-verifies it on every write and the database trigger enforces it
 * independently, so the UI is a convenience and never the control.
 */

import { apiFetch } from '@/src/lib/apiClient';
import { logSanitizer } from '@/src/lib/logSanitizer';

export interface MentorTopic {
  id: string;
  segment_id: string;
  name: string;
  slug: string;
  description: string | null;
  priority: number;
  segmentName: string;
}

/** Every active topic across the mentor's segments. */
export async function fetchMentorTopics(): Promise<{
  topics: MentorTopic[];
  error: Error | null;
}> {
  try {
    const res = await apiFetch('/api/mentor/topics');
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
  } catch (err) {
    console.error('Error fetching mentor topics:', logSanitizer.safeMessage(err));
    return { topics: [], error: err instanceof Error ? err : new Error('Unable to load topics.') };
  }
}

/**
 * The topics a gig editor may offer for `segmentId`.
 *
 * A pure filter so the ownership rule is testable without a network call: a
 * topic from another segment is dropped rather than disabled, so it cannot be
 * selected at all.
 */
export function topicsForSegment(
  topics: MentorTopic[] | null | undefined,
  segmentId: string | null | undefined,
): MentorTopic[] {
  if (!Array.isArray(topics) || !segmentId) return [];
  return topics.filter((t) => t.segment_id === segmentId);
}

/** The topics currently attached to a gig. */
export async function fetchMentorGigTopics(gigId: string): Promise<string[]> {
  try {
    const res = await apiFetch(`/api/mentor/gigs/${encodeURIComponent(gigId)}/topics`);
    const payload = await res.json();
    if (!res.ok || !payload?.success) return [];
    return Array.isArray(payload.topicIds) ? payload.topicIds : [];
  } catch (err) {
    console.error('Error fetching gig topics:', logSanitizer.safeMessage(err));
    return [];
  }
}

/** Replace a gig's topics. The server validates ownership before writing. */
export async function saveMentorGigTopics(
  gigId: string,
  topicIds: string[],
): Promise<{ saved: boolean; error: Error | null }> {
  try {
    const res = await apiFetch(`/api/mentor/gigs/${encodeURIComponent(gigId)}/topics`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topicIds }),
    });
    let payload: any = null;
    try {
      payload = await res.json();
    } catch {
      return { saved: false, error: new Error('The server returned an unreadable response.') };
    }
    if (!res.ok || !payload?.success) {
      return {
        saved: false,
        error: new Error(payload?.error?.message || 'Unable to save topics.'),
      };
    }
    return { saved: true, error: null };
  } catch (err) {
    console.error('Error saving gig topics:', logSanitizer.safeMessage(err));
    return { saved: false, error: err instanceof Error ? err : new Error('Unable to save topics.') };
  }
}