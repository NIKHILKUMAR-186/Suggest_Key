/**
 * Session workspace persistence.
 *
 * Extracted from the `POST /api/workspaces` handler so the draft/publish
 * decision and the ownership rules are testable without a database, and so
 * the route is a thin adapter over them.
 *
 * WHY THE WRITE PATH IS NOT A BLIND UPSERT
 * ----------------------------------------
 * The original handler issued a single `upsert(record, { onConflict:
 * 'booking_id' })` that carried `created_at` and `published_at` in the payload.
 * Two things were wrong with that:
 *
 *   1. `created_at` was rewritten to "now" on every save, so a workspace's
 *      real creation time was lost the first time a mentor edited a draft.
 *   2. `published_at` was rewritten to "now" on every publish, and `resources`
 *      was rewritten to `[]`, so republishing silently re-dated the
 *      publication and erased mentor-authored resources.
 *
 * Publishing an existing workspace has to be an UPDATE of that row, and it has
 * to be safe to do twice. So the write is now an explicit
 * read -> insert-or-update against the single row identified by `booking_id`.
 *
 * WHY THE COLUMNS ARE DECLARED IN ONE PLACE
 * -----------------------------------------
 * The 500 this replaces was a PostgREST `PGRST204`: the handler wrote
 * `mentor_notes`, `suggestions`, `next_steps` and `follow_up_recommendation`,
 * none of which existed on the live `session_workspaces` table. PostgREST
 * resolves the whole payload against its schema cache before emitting SQL, so
 * one unknown column aborted the entire statement. `WORKSPACE_WRITE_COLUMNS`
 * below is the single list of columns this write path depends on, and
 * `tests/workspace_publish.test.ts` asserts it against the migration history,
 * so the next schema drift fails the suite instead of production.
 *
 * SECURITY
 * --------
 * `authorizeWorkspaceWrite` is the ownership gate and it is deliberately
 * duplicated by RLS rather than replaced by it: the service-role client
 * bypasses RLS, so this check is the only thing standing between a signed-in
 * seeker and a forged publish. Both conditions from the requirement are
 * enforced:
 *
 *   - the caller must be the booking's assigned mentor, or an admin, and
 *   - the existing row, if any, must already belong to that same mentor, so a
 *     row can never be re-pointed at a different pair of participants.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserRole } from '@/src/types/auth';
import type { WorkspaceStatus } from '@/src/types/database';

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

export interface SessionWorkspaceRow {
  id: string;
  booking_id: string;
  mentor_id: string;
  seeker_id: string;
  status: WorkspaceStatus;
  mentor_notes: string;
  summary: string;
  takeaways: unknown[];
  suggestions: unknown[];
  next_steps: unknown[];
  action_items: unknown[];
  follow_up_recommendation: unknown;
  resources: unknown[];
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

/** The subset of a booking this module needs. Identity only, never content. */
export interface WorkspaceBooking {
  id: string;
  booking_code: string;
  mentor_id: string;
  seeker_id: string;
}

/** The validated, caller-supplied workspace content. */
export interface WorkspaceWriteInput {
  mentorNotes?: string;
  takeaways: string[];
  suggestions: string[];
  nextSteps: Array<{ id?: string; text: string; completed?: boolean }>;
  followUpRecommendation?: unknown;
  publish: boolean;
}

export interface WorkspaceStore {
  findByBookingId(bookingId: string): Promise<SessionWorkspaceRow | null>;
  insertWorkspace(record: SessionWorkspaceRow): Promise<SessionWorkspaceRow>;
  updateWorkspace(id: string, patch: Partial<SessionWorkspaceRow>): Promise<SessionWorkspaceRow | null>;
  notifySeekerPublished(input: { userId: string; bookingCode: string; bookingId: string }): Promise<void>;
}

/**
 * Every column `POST /api/workspaces` depends on. If the table loses one of
 * these the route 500s with PGRST204, so the migration-history test pins the
 * set rather than each call site.
 */
export const WORKSPACE_WRITE_COLUMNS = [
  'id',
  'booking_id',
  'mentor_id',
  'seeker_id',
  'status',
  'mentor_notes',
  'summary',
  'takeaways',
  'suggestions',
  'next_steps',
  'action_items',
  'follow_up_recommendation',
  'resources',
  'published_at',
  'created_at',
  'updated_at',
] as const;

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

export type WorkspaceWriteDenial =
  | 'BOOKING_NOT_FOUND'
  | 'FORBIDDEN'
  /**
   * The stored row's participants are not the booking's participants.
   *
   * Distinct from FORBIDDEN on purpose: the caller IS the booking's mentor, so
   * this is not an authorization failure and retrying will never help. It is
   * stored data that disagrees with the booking, and the honest response is to
   * refuse the write and say so rather than publish a document whose visibility
   * is decided by a `seeker_id` that does not belong to this session.
   */
  | 'PARTICIPANT_MISMATCH';

export type WorkspaceWriteAuth =
  | { allowed: true }
  | { allowed: false; reason: WorkspaceWriteDenial };

/**
 * Only the booking's assigned mentor, or an admin, may write a workspace.
 *
 * A seeker is deliberately not a special case: the seeker is a participant of
 * the session and may READ the workspace once it is published, but must never
 * be able to author or publish one. Roles come from the verified token, never
 * from the request body.
 *
 * The mentor check requires the `mentor` role in addition to matching
 * `booking.mentor_id`, which mirrors the RLS INSERT policy
 * (`mentor_id = auth.uid() AND has_role(auth.uid(), 'mentor')`). Matching the
 * id alone would trust that a token carrying only `seeker` had a booking that
 * named it as mentor, which is not a relationship the role system guarantees.
 */
export function authorizeWorkspaceWrite(params: {
  booking: WorkspaceBooking | null;
  callerId: string;
  roles: readonly UserRole[];
}): WorkspaceWriteAuth {
  const { booking, callerId, roles } = params;
  if (!booking) return { allowed: false, reason: 'BOOKING_NOT_FOUND' };
  if (roles.includes('admin')) return { allowed: true };
  if (roles.includes('mentor') && booking.mentor_id === callerId) return { allowed: true };
  return { allowed: false, reason: 'FORBIDDEN' };
}

/**
 * Guards the update branch specifically: the row being written must already
 * belong to the booking's assigned mentor, and to the booking's seeker.
 *
 * Without the mentor check, a workspace whose stored `mentor_id` had drifted
 * from the booking could be rewritten onto the current caller, and the
 * participants a published document is visible to would follow the row rather
 * than the booking.
 *
 * The seeker check is not symmetric and must not be skipped. RLS gates seeker
 * visibility on the ROW's `seeker_id`
 * (`seeker_id = auth.uid() AND status = 'PUBLISHED'`), never on
 * `bookings.seeker_id`. A row whose `seeker_id` drifted is therefore invisible
 * to the seeker who booked the session - who is shown "Awaiting Mentor Notes"
 * for ever - while being readable by whoever the drifted value names. The
 * mentor looking at their own booking sees PUBLISHED, so both screens look
 * correct in isolation and the session looks permanently unpublished.
 *
 * `PARTICIPANT_MISMATCH` is returned rather than `FORBIDDEN` because the caller
 * is genuinely authorized; the stored row is what is wrong, and it must be
 * repaired by an operator instead of being silently rewritten to match.
 */
export function authorizeExistingWorkspace(params: {
  existing: Pick<SessionWorkspaceRow, 'mentor_id' | 'seeker_id'>;
  booking: WorkspaceBooking;
  callerId: string;
  roles: readonly UserRole[];
}): WorkspaceWriteAuth {
  if (
    params.existing.mentor_id !== params.booking.mentor_id ||
    params.existing.seeker_id !== params.booking.seeker_id
  ) {
    return { allowed: false, reason: 'PARTICIPANT_MISMATCH' };
  }
  return authorizeWorkspaceWrite(params);
}

/**
 * Seekers may read a workspace only once it is PUBLISHED.
 *
 * This mirrors the RLS SELECT policy
 * (`(seeker_id = auth.uid() AND status = 'PUBLISHED') OR mentor_id =
 * auth.uid() OR is_admin()`) so the API and the database agree on what "the
 * mentor's notes are ready" means.
 */
export function isWorkspaceVisibleToSeeker(
  workspace: Pick<SessionWorkspaceRow, 'status'>,
  roles: readonly UserRole[],
): boolean {
  if (roles.includes('admin') || roles.includes('mentor')) return true;
  return workspace.status === 'PUBLISHED';
}

// ---------------------------------------------------------------------------
// Record construction
// ---------------------------------------------------------------------------

/**
 * Stable action-item ids.
 *
 * The previous implementation used `Date.now()`, so the same next step got a
 * new id on every save and a republished document could not be diffed against
 * the draft. The index is deterministic and the caller-supplied id wins.
 */
function toActionItems(steps: WorkspaceWriteInput['nextSteps']): Array<{
  id: string;
  text: string;
  completed: boolean;
}> {
  return steps.map((step, index) => ({
    id: step.id || `act-${index + 1}`,
    text: step.text,
    completed: !!step.completed,
  }));
}

export type WorkspaceWritePlan =
  | { mode: 'insert'; record: SessionWorkspaceRow }
  | { mode: 'update'; id: string; patch: Partial<SessionWorkspaceRow> };

/**
 * Decides the exact write for a save.
 *
 * Insert when the booking has no workspace yet; update the existing row
 * otherwise. On update, `created_at`, the original `published_at` and
 * mentor-authored `resources` are carried over from the stored row rather than
 * recomputed, which is what makes a second publish a no-op instead of a
 * re-dating and a data loss.
 */
export function planWorkspaceWrite(params: {
  booking: WorkspaceBooking;
  input: WorkspaceWriteInput;
  existing: SessionWorkspaceRow | null;
  nowIso: string;
  newId: string;
}): WorkspaceWritePlan {
  const { booking, input, existing, nowIso, newId } = params;

  const status: WorkspaceStatus = input.publish ? 'PUBLISHED' : 'PENDING';
  const notes = input.mentorNotes || '';

  // A republish keeps the original publication time. Only the first publish
  // stamps a new one.
  const publishedAt = input.publish ? existing?.published_at ?? nowIso : null;

  const content = {
    status,
    mentor_notes: notes,
    summary: notes,
    takeaways: input.takeaways,
    suggestions: input.suggestions,
    next_steps: input.nextSteps,
    action_items: toActionItems(input.nextSteps),
    follow_up_recommendation: input.followUpRecommendation ?? null,
    published_at: publishedAt,
    updated_at: nowIso,
  };

  if (existing) {
    return {
      mode: 'update',
      id: existing.id,
      patch: {
        ...content,
        // Mentor-authored resources are not part of this payload, so an edit
        // must not clear them.
        resources: existing.resources,
      },
    };
  }

  return {
    mode: 'insert',
    record: {
      id: newId,
      booking_id: booking.id,
      mentor_id: booking.mentor_id,
      seeker_id: booking.seeker_id,
      resources: [],
      created_at: nowIso,
      ...content,
    },
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export type SaveWorkspaceResult =
  | { ok: true; workspace: SessionWorkspaceRow; created: boolean; published: boolean }
  | { ok: false; reason: WorkspaceWriteDenial };

/**
 * Saves a workspace: authorize, read, insert-or-update, notify.
 *
 * The notification is emitted only on a successful write, so a rejected
 * request never tells the seeker a document is ready.
 */
export async function saveWorkspace(params: {
  store: WorkspaceStore;
  booking: WorkspaceBooking | null;
  input: WorkspaceWriteInput;
  callerId: string;
  roles: readonly UserRole[];
  nowIso: string;
  newId: string;
}): Promise<SaveWorkspaceResult> {
  const { store, booking, input, callerId, roles, nowIso, newId } = params;

  const auth = authorizeWorkspaceWrite({ booking, callerId, roles });
  if (!auth.allowed) return { ok: false, reason: auth.reason };

  const resolvedBooking = booking as WorkspaceBooking;
  const existing = await store.findByBookingId(resolvedBooking.id);

  if (existing) {
    const existingAuth = authorizeExistingWorkspace({
      existing,
      booking: resolvedBooking,
      callerId,
      roles,
    });
    if (!existingAuth.allowed) return { ok: false, reason: existingAuth.reason };
  }

  const plan = planWorkspaceWrite({ booking: resolvedBooking, input, existing, nowIso, newId });

  let workspace: SessionWorkspaceRow;
  if (plan.mode === 'insert') {
    workspace = await store.insertWorkspace(plan.record);
  } else {
    const updated = await store.updateWorkspace(plan.id, plan.patch);
    if (!updated) {
      // The row was read a moment ago, so this means it was deleted
      // concurrently. Failing is correct: reporting the stale pre-read row as
      // a successful save would claim a write that never landed.
      throw new Error('Session workspace disappeared during update');
    }
    workspace = updated;
  }

  if (input.publish) {
    await store.notifySeekerPublished({
      userId: resolvedBooking.seeker_id,
      bookingCode: resolvedBooking.booking_code,
      bookingId: resolvedBooking.id,
    });
  }

  return {
    ok: true,
    workspace,
    created: plan.mode === 'insert',
    published: input.publish,
  };
}

// ---------------------------------------------------------------------------
// Supabase adapter
// ---------------------------------------------------------------------------

const WORKSPACE_COLUMNS = WORKSPACE_WRITE_COLUMNS.join(', ');

const readWorkspace = (row: Record<string, unknown> | null): SessionWorkspaceRow | null => {
  if (!row || typeof row.id !== 'string') return null;
  return {
    id: row.id,
    booking_id: String(row.booking_id ?? ''),
    mentor_id: String(row.mentor_id ?? ''),
    seeker_id: String(row.seeker_id ?? ''),
    status: row.status as WorkspaceStatus,
    mentor_notes: String(row.mentor_notes ?? row.summary ?? ''),
    summary: String(row.summary ?? ''),
    takeaways: Array.isArray(row.takeaways) ? row.takeaways : [],
    suggestions: Array.isArray(row.suggestions) ? row.suggestions : [],
    next_steps: Array.isArray(row.next_steps) ? row.next_steps : [],
    action_items: Array.isArray(row.action_items) ? row.action_items : [],
    follow_up_recommendation: row.follow_up_recommendation ?? null,
    resources: Array.isArray(row.resources) ? row.resources : [],
    published_at: (row.published_at as string | null) ?? null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
};

export function createSupabaseWorkspaceStore(client: SupabaseClient): WorkspaceStore {
  return {
    async findByBookingId(bookingId) {
      const { data, error } = await client
        .from('session_workspaces')
        .select(WORKSPACE_COLUMNS)
        .eq('booking_id', bookingId)
        .maybeSingle();
      if (error) throw error;
      return readWorkspace(data as Record<string, unknown> | null);
    },

    async insertWorkspace(record) {
      const { data, error } = await client
        .from('session_workspaces')
        .insert(record)
        .select(WORKSPACE_COLUMNS)
        .single();
      if (error) throw error;
      const row = readWorkspace(data as unknown as Record<string, unknown> | null);
      if (!row) throw new Error('Workspace insert returned no row');
      return row;
    },

    async updateWorkspace(id, patch) {
      const { data, error } = await client
        .from('session_workspaces')
        .update(patch)
        .eq('id', id)
        .select(WORKSPACE_COLUMNS)
        .maybeSingle();
      if (error) throw error;
      return readWorkspace(data as unknown as Record<string, unknown> | null);
    },

    async notifySeekerPublished({ userId, bookingCode, bookingId }) {
      const { error } = await client.from('notifications').insert({
        user_id: userId,
        title: 'Session Workspace Published',
        message: `Your mentor has published takeaways and recommendations for session ${bookingCode}.`,
        type: 'WORKSPACE',
        link: `/seeker/workspace?bookingId=${bookingId}`,
        is_read: false,
      });
      // A failed notification must not fail the publish that already
      // succeeded, so this is surfaced and swallowed deliberately.
      if (error) console.warn('Failed to create workspace notification:', error.message);
    },
  };
}
