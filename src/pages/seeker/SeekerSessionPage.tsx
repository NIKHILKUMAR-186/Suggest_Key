import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  Check,
  Circle,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  Lock,
  Radio,
  ShieldCheck,
  Timer,
  Video,
  XCircle,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { Modal } from '@/src/components/ui/Modal';
import { Textarea } from '@/src/components/ui/Textarea';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { useNavigation } from '@/src/context/NavigationContext';
import { toUserMessage } from '@/src/lib/errorMessages';
import { useAuth } from '@/src/context/AuthContext';
import {
  fetchSessionAccess,
  joinSessionRequest,
  endSessionBySeeker,
  fetchBookingDetail,
  type SessionAccessResult,
} from '@/src/lib/bookingService';
import { useSessionSync } from '@/src/hooks/useSessionSync';
import {
  resolveSessionLifecycle,
  isAccessGranted,
  secondsUntilAccessOpens,
  secondsUntilSessionEnd,
  secondsUntilSessionStart,
  formatCountdown,
  formatSessionDate,
  formatClockTime,
  formatZoneLabel,
  sessionDurationMinutes,
  type SessionLifecycleState,
} from '@/src/lib/sessionState';

/**
 * The seeker's live session control page.
 *
 * The single rule this page obeys: it renders whatever the server last said,
 * corrected for clock drift, and it authorizes nothing. The Join button's
 * visibility is `isAccessGranted(state)` where `state` came from the server
 * payload, and clicking it still round-trips to `POST /api/sessions/:id/join`,
 * which re-reads the server clock and can refuse.
 *
 * `useSessionSync` owns all revalidation: a 20s poll, focus/visibility/online
 * re-sync, a one-second local tick for the countdown, and a Realtime
 * subscription scoped to this one booking. This file never sets an interval
 * that calls the API, and never reads `Date.now()` for a business decision.
 */

/** Fallback display zone when the booking has not told us the seeker's zone. */
const FALLBACK_TIMEZONE = 'Asia/Kolkata';

interface BookingContext {
  gigTitle: string | null;
  segmentName: string | null;
  seekerTimezone: string | null;
  mentorTimezone: string | null;
}

function bookingIdFromLocation(currentPath: string | undefined): string {
  try {
    if (typeof window !== 'undefined') {
      const fromSearch = new URLSearchParams(window.location.search).get('bookingId');
      if (fromSearch) return fromSearch;
    }
  } catch {
    // Fall through to the router path.
  }
  if (currentPath && currentPath.includes('bookingId=')) {
    const after = currentPath.split('bookingId=')[1];
    if (after) return after.split('&')[0];
  }
  return '';
}

export const SeekerSessionPage: React.FC = () => {
  const { navigate, currentPath } = useNavigation();
  const { user } = useAuth();
  const userId = user?.id;

  const bookingId = useMemo(() => bookingIdFromLocation(currentPath), [currentPath]);

  const [joining, setJoining] = useState(false);
  const [copied, setCopied] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showEndModal, setShowEndModal] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endReason, setEndReason] = useState('');

  // Static display metadata (gig, segment, timezone). Fetched once; it does not
  // change over the life of a session, so it is deliberately not re-synced.
  const [ctx, setCtx] = useState<BookingContext>({
    gigTitle: null,
    segmentName: null,
    seekerTimezone: null,
    mentorTimezone: null,
  });

  useEffect(() => {
    if (!bookingId || !userId) return;
    let cancelled = false;
    void (async () => {
      try {
        const detail = await fetchBookingDetail(bookingId, userId);
        if (cancelled || !detail) return;
        const b = detail as Record<string, any>;
        setCtx({
          gigTitle: b?.gig?.title ?? null,
          segmentName: b?.segment?.name ?? null,
          seekerTimezone: b?.seeker_timezone ?? null,
          mentorTimezone: b?.mentor_timezone ?? null,
        });
      } catch {
        // Purely cosmetic metadata: a failure here must not block the session
        // controls, which all come from the access payload.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookingId, userId]);

  // The authoritative fetch. It is a stable useCallback so the hook's timers and
  // Realtime subscription are registered once rather than on every render.
  //
  // The server clock is mirrored into its own state rather than read back off
  // `data`, because the hook needs it as an input while it is still producing
  // that very `data` — reading it from the result would be circular.
  const [serverNowIso, setServerNowIso] = useState<string | null>(null);

  const fetcher = useCallback(async (): Promise<SessionAccessResult | null> => {
    if (!userId || !bookingId) return null;
    const result = await fetchSessionAccess(bookingId, userId);
    setServerNowIso(result?.currentServerTime ?? null);
    return result;
  }, [userId, bookingId]);

  const {
    data: access,
    serverNowMs,
    loading,
    error: syncError,
    revalidate,
  } = useSessionSync<SessionAccessResult | null>({
    fetcher,
    serverNow: serverNowIso,
    // Sample the clock off the awaited payload so the corrected time is correct
    // on the very first paint, not from the first poll onwards.
    getServerNow: (result) => result?.currentServerTime,
    bookingId,
    enabled: Boolean(userId && bookingId),
  });

  // Corrected "now" on every render. The hook's 1s tick forces the re-render
  // that makes this number move, and the offset makes it track SERVER time even
  // when the browser clock is wrong.
  const nowMs = serverNowMs();

  // The one booking shape every resolver below needs.
  const lifecycleBooking = useMemo(
    () =>
      access
        ? {
            status: access.bookingStatus,
            start_time: access.startTime,
            end_time: access.endTime,
            actual_ended_at: null,
          }
        : null,
    [access]
  );

  // The SERVER's state. Authoritative. This is what gates access, never the
  // local mirror: the browser may be wrong about the time, the server is not.
  const serverState: SessionLifecycleState = access?.sessionState ?? 'SCHEDULED';

  // A presentation-only mirror derived from the corrected clock. It can never
  // grant access on its own; it exists so the page repaints the instant the
  // T-5 window opens or the end_time passes, instead of sitting on a stale
  // label until the next poll. Every render site below reads this, so the
  // panel, badge and countdown all move together on the same clock.
  const state: SessionLifecycleState = useMemo(
    () => (lifecycleBooking ? resolveSessionLifecycle(lifecycleBooking, nowMs) : 'SCHEDULED'),
    // `nowMs` intentionally drives this: the 1s tick changes it every second.
    [lifecycleBooking, nowMs]
  );

  // When the corrected clock and the server disagree, the server has not yet
  // observed the boundary. Ask it to re-read immediately — once per distinct
  // state, so a clock that stays behind cannot turn into a request per second.
  const lastDivergentRef = useRef<SessionLifecycleState | null>(null);
  useEffect(() => {
    if (!access || state === serverState) {
      lastDivergentRef.current = null;
      return;
    }
    if (lastDivergentRef.current === state) return;
    lastDivergentRef.current = state;
    void revalidate();
  }, [access, state, serverState, revalidate]);

  // Access is granted by the SERVER's state, never by the local mirror.
  const granted = isAccessGranted(serverState);
  const timeZone = ctx.seekerTimezone || FALLBACK_TIMEZONE;

  const secondsToAccess = lifecycleBooking ? secondsUntilAccessOpens(lifecycleBooking, nowMs) : 0;
  const secondsToEnd = lifecycleBooking ? secondsUntilSessionEnd(lifecycleBooking, nowMs) : 0;
  const secondsToStart = lifecycleBooking ? secondsUntilSessionStart(lifecycleBooking, nowMs) : 0;

  /**
   * Ask the server to confirm a boundary the moment the local countdown crosses
   * it, rather than deciding the transition locally. The page will optimistically
   * re-render, but the Join button still only appears once the server has
   * answered with a granted state.
   */
  const askedForT5 = useRef(false);
  const askedForEnd = useRef(false);
  useEffect(() => {
    if (!access) return;
    if (state === 'SCHEDULED' && secondsToAccess === 0 && !askedForT5.current) {
      askedForT5.current = true;
      void revalidate();
    }
    if (state === 'IN_PROGRESS' && secondsToEnd === 0 && !askedForEnd.current) {
      askedForEnd.current = true;
      void revalidate();
    }
  }, [access, state, secondsToAccess, secondsToEnd, revalidate]);

  const handleJoin = useCallback(async () => {
    if (!bookingId || !userId) return;
    setJoining(true);
    setServerError(null);
    setNotice(null);
    try {
      // The server re-reads its own clock. A stale page, a wrong browser clock
      // or a replayed click cannot produce a join here.
      const result = await joinSessionRequest(bookingId, userId);
      if (!result.success || !result.canJoin) {
        setServerError(
          toUserMessage(
            result.error?.message,
            'We could not let you join this session. Please try again in a moment.'
          )
        );
        await revalidate();
        return;
      }
      if (result.meetingUrl) {
        setNotice('Verified. Opening your secure meeting room…');
        window.open(result.meetingUrl, '_blank', 'noopener,noreferrer');
      } else {
        setServerError('The meeting room link is not available right now.');
      }
    } catch (err: any) {
      setServerError(toUserMessage(err, 'We could not reach the session service. Please try again.'));
    } finally {
      setJoining(false);
    }
  }, [bookingId, userId, revalidate]);

  const handleConfirmEnd = useCallback(async () => {
    if (!bookingId) return;
    setEnding(true);
    setServerError(null);
    try {
      const result = await endSessionBySeeker(bookingId, endReason.trim() || undefined);
      if (!result.success) {
        setServerError(
          toUserMessage(result.error?.message, 'We could not end this session. Please try again.')
        );
        return;
      }
      setShowEndModal(false);
      setEndReason('');
      setNotice('Session ended. Meeting access is now closed for both participants.');
      // Re-sync immediately so the Join button and the meeting URL disappear in
      // the same paint as the confirmation.
      await revalidate();
    } catch (err: any) {
      setServerError(toUserMessage(err, 'We could not reach the session service.'));
    } finally {
      setEnding(false);
    }
  }, [bookingId, endReason, revalidate]);

  const handleCopy = useCallback((url: string) => {
    void navigator.clipboard?.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, []);

  if (!bookingId) {
    return (
      <div className="max-w-3xl mx-auto pb-12">
        <EmptyState
          icon={AlertCircle}
          title="No Booking Reference"
          description="No booking id was provided in the URL. Open a session from your bookings list."
          actionLabel="View My Bookings"
          onAction={() => navigate('/seeker/bookings')}
        />
      </div>
    );
  }

  if (loading && !access) {
    return (
      <div className="max-w-3xl mx-auto py-20 flex flex-col items-center gap-3 text-[var(--color-shell-text-subtle)]">
        <Calendar className="h-6 w-6 animate-spin text-[var(--color-shell-text-muted)]" />
        <span className="text-xs">Loading authoritative session state from the server…</span>
      </div>
    );
  }

  const banner = syncError ?? serverError;

  return (
    <div className="max-w-3xl mx-auto space-y-5 pb-12">
      {/* ---------------------------------------------------------------- */}
      {/* Header                                                          */}
      {/* ---------------------------------------------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={() => navigate('/seeker/bookings')}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)] transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to My Bookings</span>
        </button>
        <div className="flex items-center gap-2">
          <StateBadge state={state} />
          <span className="font-mono text-[11px] text-[var(--color-shell-text-subtle)]">
            {access?.bookingCode ? `BOOKING #${access.bookingCode}` : ''}
          </span>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Hero                                                            */}
      {/* ---------------------------------------------------------------- */}
      <section
        className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 sm:p-7 shadow-xs space-y-5"
        aria-label="Session summary"
      >
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {ctx.segmentName && (
              <Badge variant="secondary" className="text-[11px] font-normal">
                {ctx.segmentName}
              </Badge>
            )}
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--color-shell-text)]">
            {ctx.gigTitle || access?.sessionTitle || '1:1 Relationship Guidance Session'}
          </h1>
          {ctx.gigTitle && access?.sessionTitle && ctx.gigTitle !== access.sessionTitle && (
            <p className="text-xs text-[var(--color-shell-text-muted)]">{access.sessionTitle}</p>
          )}
        </div>

        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 border-t border-[var(--color-shell-border)] pt-5 text-xs">
          <div>
            <dt className="text-[var(--color-shell-text-subtle)] uppercase tracking-wider text-[10px] font-semibold">
              Mentor
            </dt>
            <dd className="mt-0.5 font-medium text-[var(--color-shell-text)]">
              {access?.mentorName || '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--color-shell-text-subtle)] uppercase tracking-wider text-[10px] font-semibold">
              Segment
            </dt>
            <dd className="mt-0.5 font-medium text-[var(--color-shell-text)]">
              {ctx.segmentName || '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--color-shell-text-subtle)] uppercase tracking-wider text-[10px] font-semibold">
              Date
            </dt>
            <dd className="mt-0.5 font-medium text-[var(--color-shell-text)]">
              {access?.startTime ? formatSessionDate(access.startTime, timeZone) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--color-shell-text-subtle)] uppercase tracking-wider text-[10px] font-semibold">
              Time
            </dt>
            <dd className="mt-0.5 font-medium text-[var(--color-shell-text)]">
              {access?.startTime ? (
                <>
                  {formatClockTime(access.startTime, timeZone)} –{' '}
                  {formatClockTime(access.endTime, timeZone)}
                  <span className="ml-1.5 text-[var(--color-shell-text-subtle)] font-normal">
                    ({formatZoneLabel(timeZone) || timeZone})
                  </span>
                </>
              ) : (
                '—'
              )}
            </dd>
          </div>
        </dl>
      </section>

      {banner && (
        <div
          role="alert"
          className="rounded-xl border border-[var(--color-shell-error)]/30 bg-[var(--color-shell-error-soft)] p-4 text-xs text-[var(--color-shell-error)] flex items-start gap-2.5"
        >
          <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold">Session service notice</span>
            <p className="text-[var(--color-shell-text-muted)]">{banner}</p>
          </div>
        </div>
      )}

      {notice && !banner && (
        <div
          role="status"
          className="rounded-xl border border-[var(--color-shell-success)]/30 bg-[var(--color-shell-success-soft)] p-3.5 text-xs text-[var(--color-shell-success)] flex items-center gap-2"
        >
          <Check className="h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* SESSION STATUS                                                  */}
      {/* ---------------------------------------------------------------- */}
      <section
        className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] p-6 sm:p-7 space-y-4"
        aria-label="Session status"
      >
        <SectionLabel>Session status</SectionLabel>

        {state === 'SCHEDULED' && (
          <StatusBlock
            tone="warning"
            icon={Timer}
            headline="Scheduled"
            detail="Meeting access opens 5 minutes before your session."
            aside={
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider font-semibold text-[var(--color-shell-warning)]">
                  Access opens in
                </div>
                <div className="text-2xl font-mono font-bold tabular-nums text-[var(--color-shell-text)]">
                  {formatCountdown(secondsToAccess)}
                </div>
              </div>
            }
          />
        )}

        {state === 'ACCESS_OPEN' && (
          <StatusBlock
            tone="warning"
            icon={Radio}
            headline="Meeting access open"
            detail="You can enter the room now and test your audio and video before the session begins."
            aside={
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider font-semibold text-[var(--color-shell-warning)]">
                  Starts in
                </div>
                <div className="text-2xl font-mono font-bold tabular-nums text-[var(--color-shell-text)]">
                  {formatCountdown(secondsToStart)}
                </div>
              </div>
            }
          />
        )}

        {state === 'IN_PROGRESS' && (
          <StatusBlock
            tone="success"
            icon={Video}
            headline="Live"
            detail="Your session is in progress. Meeting access is open until the scheduled end time."
            live
            aside={
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider font-semibold text-[var(--color-shell-success)]">
                  Remaining
                </div>
                <div className="text-2xl font-mono font-bold tabular-nums text-[var(--color-shell-text)]">
                  {formatCountdown(secondsToEnd)}
                </div>
              </div>
            }
          />
        )}

        {state === 'COMPLETED' && (
          <StatusBlock
            tone="muted"
            icon={Check}
            headline="Session completed"
            detail={
              access?.endTime
                ? `Your session ended at ${formatClockTime(access.endTime, timeZone)}.`
                : 'Your session has ended.'
            }
          />
        )}

        {state === 'CANCELLED' && (
          <StatusBlock
            tone="error"
            icon={XCircle}
            headline="Session cancelled"
            detail="This session was cancelled and no meeting was held."
          />
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* MEETING ACCESS                                                  */}
      {/* ---------------------------------------------------------------- */}
      <section
        className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] p-6 sm:p-7 space-y-4"
        aria-label="Meeting access"
      >
        <SectionLabel>Meeting access</SectionLabel>

        {!granted ? (
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-xl border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] p-4">
            <div
              className="h-11 w-11 rounded-full bg-[var(--color-shell-surface)] border border-[var(--color-shell-border)] flex items-center justify-center shrink-0"
              aria-hidden="true"
            >
              <Lock className="h-5 w-5 text-[var(--color-shell-text-muted)]" />
            </div>
            <div className="space-y-1 flex-1">
              <p className="text-sm font-semibold text-[var(--color-shell-text)]">
                {state === 'SCHEDULED' ? 'Locked' : 'Closed'}
              </p>
              <p className="text-xs text-[var(--color-shell-text-muted)]">
                {state === 'SCHEDULED'
                  ? 'Meeting access opens 5 minutes before your session.'
                  : state === 'CANCELLED'
                    ? 'This session was cancelled, so the meeting room was never opened.'
                    : 'Meeting access ended when the session completed.'}
              </p>
            </div>
            <Button
              disabled
              size="md"
              className="shrink-0 cursor-not-allowed bg-[var(--color-shell-surface)] text-[var(--color-shell-text-subtle)] border border-[var(--color-shell-border)] shadow-none"
            >
              <Lock className="h-3.5 w-3.5" />
              <span>
                {state === 'SCHEDULED' ? 'Join locked' : state === 'CANCELLED' ? 'Not available' : 'Access closed'}
              </span>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--color-shell-success)]/30 bg-[var(--color-shell-success-soft)] p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-[var(--color-shell-text-muted)]">
                  Your meeting access is active.
                </p>
                <Button
                  onClick={handleJoin}
                  disabled={joining}
                  size="lg"
                  className="shrink-0 gap-2 bg-[var(--color-shell-primary)] hover:bg-[var(--color-shell-primary-hover)] text-[var(--color-shell-primary-contrast,#fff)] font-semibold shadow-sm"
                >
                  <Video className="h-4 w-4" />
                  <span>{joining ? 'Authorizing…' : 'Join Session'}</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {access?.meetingUrl && (
              <div className="space-y-2">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-shell-text-subtle)]">
                  Verified meeting link
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] px-3 py-2.5 font-mono text-xs text-[var(--color-shell-text)] truncate select-all">
                    {access.meetingUrl}
                  </div>
                  <Button
                    onClick={() => handleCopy(access.meetingUrl!)}
                    variant="outline"
                    size="sm"
                    className="gap-1.5 shrink-0"
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-[var(--color-shell-success)]" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </Button>
                </div>
              </div>
            )}

            {state === 'IN_PROGRESS' && (
              <div className="pt-1">
                <Button
                  onClick={() => setShowEndModal(true)}
                  variant="outline"
                  size="md"
                  className="gap-2 border-[var(--color-shell-error)]/40 text-[var(--color-shell-error)] hover:bg-[var(--color-shell-error-soft)]"
                >
                  <XCircle className="h-4 w-4" />
                  <span>End Session</span>
                </Button>
                <p className="mt-2 text-[11px] text-[var(--color-shell-text-subtle)]">
                  Ending the session closes meeting access for both participants immediately. The
                  session workspace stays available.
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* SESSION TIMELINE                                                */}
      {/* ---------------------------------------------------------------- */}
      <section
        className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] p-6 sm:p-7 space-y-4"
        aria-label="Session timeline"
      >
        <SectionLabel>Session timeline</SectionLabel>
        <Timeline access={access} state={state} nowMs={nowMs} timeZone={timeZone} />
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* COMPLETED ACTIONS                                               */}
      {/* ---------------------------------------------------------------- */}
      {state === 'COMPLETED' && (
        <div className="flex flex-wrap gap-2.5">
          <Button onClick={() => navigate(`/seeker/workspace?bookingId=${bookingId}`)} size="md" className="gap-2">
            <FileText className="h-4 w-4" />
            <span>Open Session Workspace</span>
          </Button>
          <Button onClick={() => navigate('/seeker/bookings')} variant="outline" size="md">
            <span>Back to My Bookings</span>
          </Button>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Footer                                                          */}
      {/* ---------------------------------------------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-shell-border)] pt-4 text-[11px] text-[var(--color-shell-text-subtle)]">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-[var(--color-shell-success)]" />
          <span className="font-medium text-[var(--color-shell-text-muted)]">
            Server-authoritative time gate
          </span>
        </div>
        <div>
          <span>Server time </span>
          <span className="font-mono text-[var(--color-shell-text-muted)]">
            {access?.currentServerTime
              ? formatClockTime(access.currentServerTime, timeZone)
              : 'synced'}
          </span>
        </div>
      </div>

      <Modal
        isOpen={showEndModal}
        onClose={() => (ending ? undefined : setShowEndModal(false))}
        title="End this session?"
        description="Meeting access closes immediately for you and your mentor. The session workspace remains available afterwards."
        maxWidth="sm"
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="end-reason"
              className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-shell-text-subtle)]"
            >
              Reason (optional)
            </label>
            <Textarea
              id="end-reason"
              value={endReason}
              onChange={(e) => setEndReason(e.target.value)}
              rows={3}
              placeholder="e.g. Mentor unavailable today"
              maxLength={500}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowEndModal(false)} disabled={ending}>
              <span>Keep session open</span>
            </Button>
            <Button
              onClick={handleConfirmEnd}
              disabled={ending}
              className="gap-2 bg-[var(--color-shell-error)] text-white hover:opacity-90"
            >
              <XCircle className="h-4 w-4" />
              <span>{ending ? 'Ending…' : 'End session'}</span>
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-shell-text-subtle)]">
      {children}
    </h2>
  );
}

function StateBadge({ state }: { state: SessionLifecycleState }) {
  if (state === 'IN_PROGRESS') {
    return (
      <Badge variant="success" className="gap-1.5 text-[11px]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-shell-success)] animate-pulse" aria-hidden="true" />
        LIVE
      </Badge>
    );
  }
  if (state === 'ACCESS_OPEN') return <Badge variant="warning" className="text-[11px]">ACCESS OPEN</Badge>;
  if (state === 'COMPLETED') return <Badge variant="secondary" className="text-[11px]">COMPLETED</Badge>;
  if (state === 'CANCELLED') return <Badge variant="destructive" className="text-[11px]">CANCELLED</Badge>;
  return <Badge variant="outline" className="text-[11px]">CONFIRMED</Badge>;
}

type Tone = 'success' | 'warning' | 'muted' | 'error';

const TONE_CLASSES: Record<Tone, { wrap: string; icon: string }> = {
  success: {
    wrap: 'border-[var(--color-shell-success)]/30 bg-[var(--color-shell-success-soft)]',
    icon: 'text-[var(--color-shell-success)]',
  },
  warning: {
    wrap: 'border-[var(--color-shell-warning)]/30 bg-[var(--color-shell-warning-soft)]',
    icon: 'text-[var(--color-shell-warning)]',
  },
  muted: {
    wrap: 'border-[var(--color-shell-border)] bg-[var(--color-shell-surface)]',
    icon: 'text-[var(--color-shell-text-muted)]',
  },
  error: {
    wrap: 'border-[var(--color-shell-error)]/30 bg-[var(--color-shell-error-soft)]',
    icon: 'text-[var(--color-shell-error)]',
  },
};

function StatusBlock({
  tone,
  icon: Icon,
  headline,
  detail,
  aside,
  live = false,
}: {
  tone: Tone;
  icon: React.ComponentType<{ className?: string }>;
  headline: string;
  detail: string;
  aside?: React.ReactNode;
  live?: boolean;
}) {
  const t = TONE_CLASSES[tone];
  return (
    <div className={`rounded-xl border p-4 sm:p-5 ${t.wrap}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <span
            className={`h-10 w-10 rounded-full bg-[var(--color-shell-surface)] border border-[var(--color-shell-border)] flex items-center justify-center shrink-0 ${t.icon}`}
            aria-hidden="true"
          >
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--color-shell-text)]">
              {headline}
              {live && (
                <span className="h-2 w-2 rounded-full bg-[var(--color-shell-success)] animate-ping" aria-hidden="true" />
              )}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-shell-text-muted)]">{detail}</p>
          </div>
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
    </div>
  );
}

/**
 * The session timeline.
 *
 * Every stage is derived from the server payload and the corrected clock. A
 * stage is only ticked when it has provably happened, and no timestamp is ever
 * invented: the only real times available are `start_time`, `end_time` and
 * `actual_ended_at`, so a stage with no recorded time renders its tick without
 * one.
 */
function Timeline({
  access,
  state,
  nowMs,
  timeZone,
}: {
  access: SessionAccessResult | null;
  state: SessionLifecycleState;
  nowMs: number;
  timeZone: string;
}) {
  const bookingStatus = access?.bookingStatus ?? 'PENDING_VERIFICATION';
  const startMs = access?.startTime ? new Date(access.startTime).getTime() : Number.NaN;
  const endMs = access?.endTime ? new Date(access.endTime).getTime() : Number.NaN;
  const accessOpenMs = Number.isFinite(startMs) ? startMs - 5 * 60_000 : Number.NaN;

  const paymentVerified = !['PAYMENT_PENDING', 'PENDING_VERIFICATION'].includes(bookingStatus);
  const mentorConfirmed = !['PAYMENT_PENDING', 'PENDING_VERIFICATION', 'MENTOR_PENDING'].includes(
    bookingStatus
  );
  const accessOpened =
    state === 'ACCESS_OPEN' || state === 'IN_PROGRESS' || state === 'COMPLETED' ||
    (Number.isFinite(accessOpenMs) && nowMs >= accessOpenMs);
  const started =
    state === 'IN_PROGRESS' || state === 'COMPLETED' ||
    (Number.isFinite(startMs) && nowMs >= startMs);
  const completed = state === 'COMPLETED';

  const stages: Array<{ label: string; done: boolean; at: string | null }> = [
    { label: 'Payment verified', done: paymentVerified, at: null },
    { label: 'Mentor confirmed', done: mentorConfirmed, at: null },
    {
      label: 'Meeting access opened',
      done: accessOpened,
      at: Number.isFinite(accessOpenMs) ? formatClockTime(new Date(accessOpenMs).toISOString(), timeZone) : null,
    },
    {
      label: 'Session started',
      done: started,
      at: Number.isFinite(startMs) ? formatClockTime(access?.startTime ?? null, timeZone) : null,
    },
    {
      label: 'Session completed',
      done: completed,
      at: Number.isFinite(endMs) ? formatClockTime(access?.endTime ?? null, timeZone) : null,
    },
  ];

  return (
    <ol className="space-y-0.5">
      {stages.map((stage, i) => {
        const isLast = i === stages.length - 1;
        return (
          <li key={stage.label} className="flex gap-3">
            <div className="flex flex-col items-center shrink-0">
              <span
                className={
                  stage.done
                    ? 'h-6 w-6 rounded-full bg-[var(--color-shell-success-soft)] border border-[var(--color-shell-success)]/40 flex items-center justify-center'
                    : 'h-6 w-6 rounded-full border border-[var(--color-shell-border-strong)] flex items-center justify-center'
                }
                aria-hidden="true"
              >
                {stage.done ? (
                  <Check className="h-3.5 w-3.5 text-[var(--color-shell-success)]" />
                ) : (
                  <Circle className="h-2 w-2 text-[var(--color-shell-text-subtle)]" />
                )}
              </span>
              {!isLast && (
                <span
                  className={
                    stage.done
                      ? 'w-px flex-1 min-h-4 bg-[var(--color-shell-success)]/30'
                      : 'w-px flex-1 min-h-4 bg-[var(--color-shell-border)]'
                  }
                  aria-hidden="true"
                />
              )}
            </div>
            <div className={`flex items-baseline justify-between gap-3 flex-1 ${isLast ? '' : 'pb-3'}`}>
              <span
                className={
                  stage.done
                    ? 'text-xs font-medium text-[var(--color-shell-text)]'
                    : 'text-xs text-[var(--color-shell-text-subtle)]'
                }
              >
                {stage.label}
              </span>
              <span className="font-mono text-[11px] text-[var(--color-shell-text-subtle)]">
                {stage.done ? stage.at ?? '' : 'pending'}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
