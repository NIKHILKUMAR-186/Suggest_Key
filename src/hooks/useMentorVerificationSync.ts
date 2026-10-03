import { useEffect, useMemo, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/src/lib/supabase';

/**
 * Mentor verification / mentor Control Center realtime.
 *
 * WHY THIS EXISTS
 *
 * These are ADMIN pages whose whole job is to show the authoritative state of a
 * verification decision. Before this hook they were read-once: two admins in two
 * tabs would disagree about an application for as long as both stayed open, and
 * a mentor approved in the verification queue kept showing as "Pending
 * Verification" in the mentor directory until someone hit reload.
 *
 * The event is a signal, never data. Every trigger funnels into the same
 * `onInvalidate`, and the consumer re-reads the authoritative answer from the
 * API. No component infers a status from a realtime payload: a payload is one
 * transaction's worth of columns and says nothing about the other tables the
 * page displays, so "apply the new row locally" is how a stale page becomes a
 * confidently wrong page.
 *
 * WHY THE TABLES HAVE TO BE IN THE PUBLICATION
 *
 * Every table listed in `WATCHED_TABLES` was missing from the
 * `supabase_realtime` publication, so no amount of subscribing could ever have
 * delivered an event. They are added in
 * supabase/migrations/20261020000000_phase44_mentor_verification_authoritative_realtime.sql,
 * together with `REPLICA IDENTITY FULL` on exactly the tables this hook filters
 * on a non-primary-key column (`mentor_id`, `user_id`, `application_id`) -
 * without it Supabase cannot match a client filter to an UPDATE/DELETE event.
 * That is also why the hot tables (`profiles`, `mentor_profiles`) are filtered
 * on their primary key only: they keep the default replica identity, and a
 * filter on `id` works without it.
 */

export type MentorVerificationTable =
  | 'mentor_applications'
  | 'mentor_verification_documents'
  | 'mentor_profiles'
  | 'profiles'
  | 'mentor_segments';

/**
 * Which page is asking, which decides the tables and the filters.
 *
 * Each scope is deliberately as narrow as the page allows:
 *
 * - `application-detail` — one application, its documents, and the mentor
 *   profile/account the approval will synchronise. `id`/`application_id` filters
 *   on primary keys plus the one non-PK filter the document table needs.
 * - `verification-queue` — the queue spans every application, so nothing can be
 *   filtered. Burst coalescing keeps the refetch count down instead.
 * - `mentor-detail` — one mentor: profile, account, segments, and the
 *   application that belongs to them. This is the scope that needs the
 *   `mentor_applications` non-PK `user_id` filter.
 * - `mentors-list` — every mentor, so the directory's account and approval
 *   columns can never be stale.
 */
export type MentorVerificationScope =
  | 'application-detail'
  | 'verification-queue'
  | 'mentor-detail'
  | 'mentors-list';

interface WatchSpec {
  table: MentorVerificationTable;
  /** Supabase filter string, or undefined for an intentionally unfiltered table. */
  filter?: string;
}

/**
 * The exact subscription set per scope.
 *
 * Exported so the regression tests can assert the narrowness: a page must never
 * subscribe to a table it does not display, and a scoped page must never leave a
 * filter off a table that could be filtered.
 */
export function buildMentorVerificationWatches(
  scope: MentorVerificationScope,
  ids: { applicationId?: string | null; mentorId?: string | null },
): WatchSpec[] {
  const applicationId = ids.applicationId ?? null;
  const mentorId = ids.mentorId ?? null;

  switch (scope) {
    case 'application-detail': {
      // The mentor profile only changes when this application is decided, so the
      // profile/account tables are only worth watching once the mentor is known.
      const specs: WatchSpec[] = [
        { table: 'mentor_applications', filter: applicationId ? `id=eq.${applicationId}` : undefined },
        {
          table: 'mentor_verification_documents',
          filter: applicationId ? `application_id=eq.${applicationId}` : undefined,
        },
      ];
      if (mentorId) {
        specs.push(
          { table: 'mentor_profiles', filter: `id=eq.${mentorId}` },
          { table: 'profiles', filter: `id=eq.${mentorId}` },
          { table: 'mentor_segments', filter: `mentor_id=eq.${mentorId}` },
        );
      }
      return specs;
    }

    case 'verification-queue':
      // Deliberately unfiltered: the queue is a view over every application.
      return [{ table: 'mentor_applications' }, { table: 'mentor_verification_documents' }];

    case 'mentor-detail': {
      if (!mentorId) return [];
      return [
        { table: 'mentor_profiles', filter: `id=eq.${mentorId}` },
        { table: 'profiles', filter: `id=eq.${mentorId}` },
        { table: 'mentor_segments', filter: `mentor_id=eq.${mentorId}` },
        // The Control Center shows `applicationStatus`, and an application row is
        // keyed by `user_id`, not `id` - hence REPLICA IDENTITY FULL on that
        // table in the migration.
        { table: 'mentor_applications', filter: `user_id=eq.${mentorId}` },
      ];
    }

    case 'mentors-list':
      return [
        { table: 'mentor_profiles' },
        { table: 'profiles' },
        { table: 'mentor_applications' },
        { table: 'mentor_segments' },
      ];

    default: {
      const exhaustive: never = scope;
      void exhaustive;
      return [];
    }
  }
}

export interface MentorVerificationSyncOptions {
  scope: MentorVerificationScope;
  /** Required for `application-detail`; optional there, mandatory for `mentor-detail`. */
  applicationId?: string | null;
  /** Required for `mentor-detail` and for the profile half of `application-detail`. */
  mentorId?: string | null;
  /**
   * Called when a watched row changed, or with no argument when the trigger was
   * a focus/visibility/reconnect revalidation. Should re-read the authoritative
   * answer from the API rather than patching local state from an event.
   */
  onInvalidate: (source?: MentorVerificationTable | 'trigger') => void;
  enabled?: boolean;
}

/**
 * A single approval is several statements in one transaction and therefore a
 * burst of events (`mentor_applications`, `mentor_profiles`, `profiles`,
 * `user_roles`...). Coalescing the burst into one refetch is the difference
 * between one authoritative round trip and several racing ones.
 */
const BURST_WINDOW_MS = 300;

let channelSequence = 0;

/** Dev-only structured trace. Silent in production, and never logs credentials. */
function trace(event: string, fields: Record<string, unknown> = {}): void {
  if (!import.meta.env?.DEV) return;
  console.debug(`[MentorVerificationSync] ${event}`, fields);
}

/**
 * Keeps one admin verification / mentor view synchronised with the database.
 *
 * Triggers, all funnelling into `onInvalidate`:
 *
 *  1. Supabase Realtime `postgres_changes`, filtered to this scope's rows.
 *     Immediate and targeted; there is no polling interval, because every state
 *     change on these pages is a database write and therefore emits an event.
 *  2. `visibilitychange` / `focus` / `online` / `pageshow` — a machine that
 *     slept, a backgrounded tab and a dropped network all mean the same thing:
 *     events were missed, so re-read the authoritative answer.
 *  3. An authoritative refetch on every channel re-join, for events published
 *     while the socket was down.
 *
 * Deliberately NOT included: a visibility-gated interval like
 * `useAvailabilitySync` has. That hook exists because a slot hold lapses with no
 * write at all; a verification decision always writes, so an interval here would
 * be cost with no coverage it alone provides.
 *
 * Exactly one channel exists per hook instance and it is torn down when the ids
 * change, the consumer unmounts, or the user navigates away.
 */
export function useMentorVerificationSync({
  scope,
  applicationId = null,
  mentorId = null,
  onInvalidate,
  enabled = true,
}: MentorVerificationSyncOptions): void {
  // Read the callback through a ref so re-subscribing is driven purely by the
  // ids. An inline arrow in a component would otherwise rebuild the channel on
  // every render, and each rebuild is a dropped-and-joined websocket.
  const handlerRef = useRef<(source?: MentorVerificationTable | 'trigger') => void>(() => undefined);
  handlerRef.current = onInvalidate;

  const watches = useMemo(
    () => buildMentorVerificationWatches(scope, { applicationId, mentorId }),
    [scope, applicationId, mentorId],
  );

  // A stable identity for the watch set, so the effect below does not re-run
  // because `useMemo` handed back a fresh array.
  const watchKey = useMemo(() => watches.map((w) => `${w.table}:${w.filter ?? ''}`).join('|'), [watches]);

  useEffect(() => {
    if (!enabled || watches.length === 0) return;

    let burstTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    /**
     * `supabase.channel(topic)` REUSES a channel with the same topic and only
     * drops it from the client's registry once the async unsubscribe has
     * completed. Under React StrictMode the effect mounts, tears down and
     * remounts in the same tick, and the remount can be handed the
     * half-torn-down channel — listeners get re-registered on a channel that is
     * being unsubscribed and the resulting subscription never delivers an
     * event. A per-instance topic makes reuse impossible. Same reasoning as
     * `useAvailabilitySync`.
     */
    const topic = `mentor-verification:${scope}:${applicationId ?? '-'}:${mentorId ?? '-'}:${++channelSequence}`;

    const notify = (source?: MentorVerificationTable | 'trigger') => {
      trace('INVALIDATE', { scope, source: source ?? 'trigger' });
      if (burstTimer) clearTimeout(burstTimer);
      burstTimer = setTimeout(() => {
        burstTimer = null;
        handlerRef.current(source);
      }, BURST_WINDOW_MS);
    };

    let channel: RealtimeChannel | null = null;

    if (isSupabaseConfigured()) {
      channel = supabase.channel(topic) as RealtimeChannel;

      for (const spec of watches) {
        channel.on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: spec.table,
            ...(spec.filter ? { filter: spec.filter } : {}),
          },
          (payload: any) => {
            // The payload is used for tracing only. State is never derived from
            // it: see the module header.
            trace('REALTIME_EVENT', {
              scope,
              event: payload?.eventType,
              table: spec.table,
            });
            notify(spec.table);
          },
        );
      }

      channel.subscribe((status: string) => {
        // 'SUBSCRIBED' fires on every join, including a reconnect after a
        // dropped socket. Events published during the gap were never delivered,
        // so the only safe response is to re-read the authoritative answer.
        if (status === 'SUBSCRIBED') {
          if (settled) {
            trace('RECONNECT', { topic });
            notify();
          }
          settled = true;
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // Never surfaced to the admin as an error: the focus/visibility and
          // reconnect triggers still cover the page, so a failed socket
          // degrades to "stale until you look away and back".
          trace('CHANNEL_DEGRADED', { topic, status });
        }
      });
    }

    const onResume = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      notify();
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onResume);
      window.addEventListener('focus', onResume);
      window.addEventListener('online', onResume);
      window.addEventListener('pageshow', onResume);
    }

    return () => {
      if (burstTimer) clearTimeout(burstTimer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onResume);
        window.removeEventListener('focus', onResume);
        window.removeEventListener('online', onResume);
        window.removeEventListener('pageshow', onResume);
      }
      // Removing the channel detaches every listener registered above, so
      // navigating back and forth cannot accumulate duplicate subscriptions.
      if (channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }
    };
    // `watchKey` stands in for `watches`, whose array identity changes on every
    // render even when its contents do not.
  }, [watchKey, scope, applicationId, mentorId, enabled]);
}
