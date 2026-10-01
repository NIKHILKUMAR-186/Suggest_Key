import React, { useState, useEffect } from 'react';
import { MEETING_LINK_DEADLINE_MINUTES } from '@/src/config/app';
import { formatOverdueDuration } from '@/src/lib/bookingLifecycle';
import {
  ArrowLeft,
  Video,
  CheckCircle2,
  Clock,
  Calendar,
  ExternalLink,
  Loader2,
  Copy,
  Check,
  User,
  CreditCard,
  BellRing,
  FileText,
  AlertCircle,
  Info,
  LifeBuoy,
  Timer,
} from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { Badge } from '@/src/components/ui/Badge';
import { Modal } from '@/src/components/ui/Modal';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import { useToast } from '@/src/context/ToastContext';
import { ShortId } from '@/src/components/shared/ShortId';
import { toUserMessage } from '@/src/lib/errorMessages';
import { formatInr } from '@/src/lib/seekerFormat';
import {
  fetchBookingDetail,
  confirmMentorBooking,
  endSessionByMentor,
  respondToRescheduleRequest,
  EnrichedBookingRecord,
} from '@/src/lib/bookingService';
import { validateMeetingUrl } from '@/src/lib/bookingEngine';
import { resolveSessionLifecycle, type SessionLifecycleState } from '@/src/lib/sessionState';

const STATUS_ORDER = ['PAYMENT_PENDING', 'PENDING_VERIFICATION', 'MENTOR_PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REJECTED'];

const STATUS_LABEL: Record<string, string> = {
  PAYMENT_PENDING: 'Payment Required',
  PENDING_VERIFICATION: 'Payment Pending',
  MENTOR_PENDING: 'Awaiting Confirmation',
  CONFIRMED: 'Confirmed',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected',
};

/**
 * A reschedule window as the mentor reads it: `30 Sep, 2:00 PM – 3:00 PM`.
 *
 * Rendered in the MENTOR's timezone, because the decision is the mentor's and
 * the slot the mentor gave up was in the mentor's own calendar. Showing it in
 * the seeker's zone would make "5:00 PM" ambiguous, which is precisely the
 * mistake that makes a reschedule look like it moved to the wrong hour.
 */
function formatRescheduleWindow(startIso: string, endIso: string, timeZone: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone,
    });
  return `${fmt(startIso)} – ${fmt(endIso).split(', ').pop()}`;
}

export const MentorBookingDetailPage: React.FC = () => {
  const { navigate, currentPath } = useNavigation();
  const toast = useToast();
  const { user } = useAuth();

  const getBookingIdFromUrl = (): string => {
    try {
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const fromQuery = params.get('bookingId');
        if (fromQuery) return fromQuery;
      }
      if (currentPath && currentPath.includes('bookingId=')) {
        const parts = currentPath.split('bookingId=');
        if (parts[1]) return parts[1].split('&')[0];
      }
    } catch {
      // Ignore
    }
    return '';
  };

  const [bookingId, setBookingId] = useState<string>(getBookingIdFromUrl());
  const [booking, setBooking] = useState<EnrichedBookingRecord | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [meetingUrl, setMeetingUrl] = useState<string>('');
  const [urlError, setUrlError] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [showEndModal, setShowEndModal] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endReason, setEndReason] = useState<string>('');
  const [copiedLink, setCopiedLink] = useState(false);

  const mentorId = user?.id;

  const loadBooking = async (idToLoad: string) => {
    if (!mentorId) return;
    setLoading(true);
    setFeedbackError(null);
    try {
      const data = await fetchBookingDetail(idToLoad, mentorId);
      if (data) {
        setBooking(data);
        if (data.meeting_url) {
          setMeetingUrl(data.meeting_url);
        }
      } else {
        setFeedbackError('That booking could not be found, or it does not belong to your mentor account.');
      }
    } catch (err: unknown) {
      setFeedbackError(
        toUserMessage(err, 'We could not load this booking. Please try again.', { bookingId: idToLoad })
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const id = getBookingIdFromUrl();
    setBookingId(id);
    loadBooking(id);
  }, [currentPath, mentorId]);

  const handleUrlChange = (val: string) => {
    setMeetingUrl(val);
    setFeedbackSuccess(null);
    setFeedbackError(null);

    const validation = validateMeetingUrl(val);
    if (!validation.isValid) {
      setUrlError(validation.error || 'Invalid meeting URL.');
    } else {
      setUrlError('');
    }
  };

  const handleEndSession = async () => {
    if (!booking || ending) return;
    setEnding(true);
    setFeedbackError(null);
    setFeedbackSuccess(null);
    try {
      const result = await endSessionByMentor(booking.id, endReason.trim() || undefined);
      if (result.success) {
        setBooking((prev) =>
          prev
            ? {
                ...prev,
                status: 'COMPLETED',
                actual_ended_at: result.booking?.actual_ended_at || new Date().toISOString(),
                ended_by_role: (result.endedByRole || 'mentor') as any,
                updated_at: new Date().toISOString(),
              }
            : null
        );
        setFeedbackSuccess('Session ended. The seeker has been notified.');
        setShowEndModal(false);
        setEndReason('');
        toast.success('Session ended and seeker notified.', { title: 'Session Ended' });
      } else {
        const message = result.error?.message || 'Failed to end session.';
        setFeedbackError(message);
        toast.error(message, { title: 'End Session Failed' });
      }
    } catch (err: unknown) {
      const message = toUserMessage(err, 'Failed to end session. Please try again.');
      setFeedbackError(message);
      toast.error(message, { title: 'End Session Failed' });
    } finally {
      setEnding(false);
    }
  };

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!booking) return;

    const validation = validateMeetingUrl(meetingUrl);
    if (!validation.isValid) {
      setUrlError(validation.error || 'A valid HTTPS URL is required.');
      return;
    }

    setUrlError('');
    setSubmitting(true);
    setFeedbackError(null);
    setFeedbackSuccess(null);

    try {
      if (!mentorId) return;
      const result = await confirmMentorBooking(booking.id, mentorId, meetingUrl.trim());

      if (result.success && result.booking) {
        setBooking((prev) =>
          prev
            ? {
                ...prev,
                status: 'CONFIRMED',
                meeting_url: meetingUrl.trim(),
                updated_at: new Date().toISOString(),
              }
            : null
        );
        setFeedbackSuccess('Session confirmed. The seeker has been notified in-app.');
        toast.success('The meeting link was saved and the seeker has been notified.', {
          title: 'Session confirmed',
        });
        loadBooking(booking.id);
      } else {
        const message = toUserMessage(
          result.error?.message,
          'We could not confirm this session. Please check the meeting link and try again.',
          { bookingId: booking.id }
        );
        setFeedbackError(message);
        toast.error(message, { title: 'Confirmation failed' });
      }
    } catch (err: unknown) {
      const message = toUserMessage(
        err,
        'We could not confirm this session. Please check your connection and try again.',
        { bookingId: booking.id }
      );
      setFeedbackError(message);
      toast.error(message, { title: 'Confirmation failed' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const formatSessionTime = (startTimeIso: string, endTimeIso: string, timezone: string = 'Asia/Kolkata') => {
    try {
      const start = new Date(startTimeIso);
      const end = new Date(endTimeIso);
      const dateStr = start.toLocaleDateString('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: timezone,
      });
      const timeStart = start.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: timezone,
      });
      const timeEnd = end.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: timezone,
      });
      return `${dateStr} · ${timeStart} – ${timeEnd} (${timezone === 'Asia/Kolkata' ? 'IST' : timezone})`;
    } catch {
      return `${startTimeIso} – ${endTimeIso}`;
    }
  };

  const formatDuration = (booking: EnrichedBookingRecord): string => {
    if (typeof booking.duration_minutes === 'number' && booking.duration_minutes > 0) {
      const minutes = booking.duration_minutes;
      if (minutes < 60) return `${minutes} Minutes`;
      const hours = minutes / 60;
      return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} Hour${hours === 1 ? '' : 's'}`;
    }
    const start = new Date(booking.start_time).getTime();
    const end = new Date(booking.end_time).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 'Not recorded';
    const minutes = Math.round((end - start) / 60000);
    if (minutes < 60) return `${minutes} Minutes`;
    const hours = minutes / 60;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} Hour${hours === 1 ? '' : 's'}`;
  };

  const getSessionLifecycleStage = (status: string): number => {
    const idx = STATUS_ORDER.indexOf(status);
    return idx === -1 ? 0 : idx + 1;
  };

  // ---- Derived state ----
  //
  // A one-second local tick drives presentation only. It never issues a request
  // and never decides access: the server remains the authority, and any action
  // still round-trips and is re-checked there.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // The server annotates every booking with `sessionState`, derived from its own
  // clock and `end_time` after reconciling an elapsed row. That is authoritative
  // and is what the raw `status` used to be read for. Deriving the lifecycle
  // locally as a fallback keeps the page correct if the annotation is missing,
  // which matters because a page left open across `end_time` would otherwise
  // keep showing a stale state until a manual refresh.
  const serverSessionState = (booking as (EnrichedBookingRecord | null) & {
    sessionState?: SessionLifecycleState;
  })?.sessionState;

  const sessionState: SessionLifecycleState =
    serverSessionState ?? (booking ? resolveSessionLifecycle(booking, nowMs) : 'SCHEDULED');

  const isConfirmed = sessionState === 'ACCESS_OPEN' || sessionState === 'IN_PROGRESS';
  const isPending = booking?.status === 'MENTOR_PENDING';
  // CANCELLED is deliberately not folded into `isCompleted`: it gates the
  // "Open Workspace" affordance, and a cancelled session never had one.
  const isCompleted = sessionState === 'COMPLETED';
  // The server's bucket, not a local recomputation. `deadlineInfo.isOverdue` is
  // purely arithmetic and is true for every booking past T-5m including
  // confirmed ones, so it must never be the thing that decides this.
  const isOverdue = booking?.lifecycle?.bucket === 'OVERDUE';
  const overdueByMs = booking?.lifecycle?.overdueByMs ?? 0;

  const paymentStatus =
    (booking?.payment?.status || '').toLowerCase() === 'verified' ? 'verified' : 'pending';
  const amountLabel = formatInr(booking?.amount_inr || 0) || 'Not recorded';
  const gigTitle = booking?.gig?.title || 'Gig no longer listed';
  const segmentName = booking?.segment?.name || 'Not recorded';
  const sessionDurationLabel = booking ? formatDuration(booking) : 'Not recorded';
  const minutesLeft = booking?.deadlineInfo?.minutesUntilSession;

  // Session lifecycle timing.
  const startMs = booking ? new Date(booking.start_time).getTime() : 0;
  const endMs = booking ? new Date(booking.end_time).getTime() : 0;
  const hasStarted = Number.isFinite(startMs) && nowMs >= startMs;
  // A session is over when it was ended manually OR its scheduled window has
  // elapsed. Reading only `actual_ended_at` treated an elapsed-but-not-yet-
  // reconciled row as still live, which surfaced an "End Session" button for a
  // session that had already finished and labelled it "AWAITING START".
  const hasEnded = !!booking?.actual_ended_at || (Number.isFinite(endMs) && nowMs >= endMs);
  const isLive = sessionState === 'IN_PROGRESS' && hasStarted && !hasEnded;

  // Countdown for live sessions, derived from the shared tick above rather than
  // a second interval reading `Date.now()` directly, so the countdown and the
  // lifecycle state above can never disagree.
  const countdown = isLive && Number.isFinite(endMs)
    ? Math.max(0, Math.ceil((endMs - nowMs) / 1000))
    : 0;

  const formatCountdown = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Only while the server says the session is actually running. Gating on the
  // stored status let a finished-but-unreconciled booking keep its End Session
  // button; the server rejects that call anyway, so the button was a dead end.
  const canEndSession = sessionState === 'IN_PROGRESS' && hasStarted && !hasEnded;

  // ---- Reschedule request ----
  //
  // A reschedule is a request, not an edit. The booking is still at
  // `start_time`; the request is a separate row that names the time the seeker
  // wants instead. Accepting moves the booking, rejecting leaves it alone, and
  // both go through the server, which re-checks ownership and the slot's
  // availability inside the same transaction.
  const rescheduleRequest = booking?.rescheduleRequest || null;
  const isReschedulePending = rescheduleRequest?.status === 'PENDING';
  const [responding, setResponding] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const handleRescheduleDecision = async (decision: 'APPROVED' | 'REJECTED', reason?: string) => {
    if (!rescheduleRequest || responding) return;
    const bookingId = booking?.id;
    if (!bookingId) return;
    setResponding(true);
    setFeedbackError(null);
    setFeedbackSuccess(null);
    try {
      const result = await respondToRescheduleRequest(rescheduleRequest.id, decision, reason);
      if (result.success) {
        setShowRejectModal(false);
        setRejectReason('');
        setFeedbackSuccess(
          decision === 'APPROVED'
            ? 'Reschedule approved. The seeker has been notified and the previous slot is free again.'
            : 'Reschedule request declined. The original session time is unchanged and the seeker has been notified.'
        );
        toast.success(
          decision === 'APPROVED' ? 'Reschedule approved.' : 'Reschedule request declined.',
          { title: decision === 'APPROVED' ? 'Reschedule approved' : 'Request declined' }
        );
        await loadBooking(bookingId);
      } else {
        const message = result.error?.message || 'We could not record your decision.';
        setFeedbackError(message);
        toast.error(message, { title: 'Decision not recorded' });
      }
    } catch (err: unknown) {
      const message = toUserMessage(err, 'We could not record your decision. Please try again.');
      setFeedbackError(message);
      toast.error(message, { title: 'Decision not recorded' });
    } finally {
      setResponding(false);
    }
  };

  // ---- Render ----
  if (loading) {
    return (
      <div className="max-w-3xl mx-auto py-16 flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--color-shell-text-muted)]" />
        <span className="text-sm font-medium text-[var(--color-shell-text-muted)]">Loading session details...</span>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center space-y-4">
        <AlertCircle className="h-10 w-10 text-[var(--color-shell-error)] mx-auto" />
        <h2 className="text-lg font-bold text-[var(--color-shell-text)]">Booking Not Found</h2>
        <p className="text-sm text-[var(--color-shell-text-muted)]">
          {feedbackError || 'That booking could not be found, or it does not belong to your mentor account.'}
        </p>
        <Button onClick={() => navigate('/mentor/bookings')} variant="outline" size="sm">
          Return to Mentor Bookings
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back button */}
      <button
        onClick={() => navigate('/mentor/bookings')}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)] transition-colors cursor-pointer"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        <span>Back to Mentor Bookings</span>
      </button>

      {/* Header: Booking code, status badge */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--color-shell-border)] pb-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-shell-text-subtle)]">
              Mentor Booking Details
            </span>
            <span className="text-2xl font-bold text-[var(--color-shell-text)] font-mono">
              #{booking.booking_code}
            </span>
            <Badge variant={isConfirmed ? 'success' : isPending ? 'warning' : 'secondary'}>
              {STATUS_LABEL[booking.status] || booking.status}
            </Badge>
          </div>
          <h2 className="mt-2 text-xl font-bold leading-snug text-[var(--color-shell-text)]">{gigTitle}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {booking.segment?.name ? (
              <span className="inline-flex items-center rounded-md border border-[var(--color-shell-border)] bg-[var(--color-shell-bg-hover)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-shell-text-muted)]">
                {segmentName}
              </span>
            ) : null}
            <span className="text-[11px] font-medium text-[var(--color-shell-text-muted)]">{sessionDurationLabel}</span>
            <span
              className={`text-[11px] font-medium px-2 py-0.5 rounded border ${
                paymentStatus === 'verified'
                  ? 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-900/20 dark:border-emerald-800/50'
                  : 'text-zinc-600 bg-zinc-50 border-zinc-200 dark:text-zinc-400 dark:bg-zinc-800 dark:border-zinc-700'
              }`}
            >
              {paymentStatus === 'verified' ? `Payment verified · ${amountLabel}` : 'Payment not verified yet'}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
  {isCompleted && (
            <Button
              onClick={() => navigate(`/mentor/workspace?bookingId=${booking.id}`)}
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs"
            >
              <FileText className="h-3.5 w-3.5" />
              <span>Open Session Workspace</span>
            </Button>
          )}
          {/* Support for this booking, carrying the human-readable code only. */}
          <Button
            onClick={() =>
              navigate(`/mentor/support?bookingCode=${encodeURIComponent(booking.booking_code)}`)
            }
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs"
          >
            <LifeBuoy className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Help &amp; Support</span>
          </Button>
        </div>
      </div>

      {/* Feedback messages */}
      {feedbackSuccess && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 p-4 flex items-start gap-3 text-xs text-emerald-900 dark:text-emerald-100">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <span className="font-bold block text-sm">Confirmation Dispatched!</span>
            <p>{feedbackSuccess}</p>
          </div>
        </div>
      )}

      {feedbackError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-900/20 p-4 flex items-start gap-3 text-xs text-rose-900 dark:text-rose-100">
          <AlertCircle className="h-5 w-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold block text-sm">Action Blocked</span>
            <p>{feedbackError}</p>
          </div>
        </div>
      )}

      {/* Overdue warning */}
      {isPending && isOverdue && (
        <div className="rounded-xl border border-[var(--color-shell-warning)]/40 bg-[var(--color-shell-warning-soft)] p-4 flex items-start gap-3 text-xs text-[var(--color-shell-text)]">
          <AlertCircle className="h-5 w-5 text-[var(--color-shell-warning)] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-bold block text-sm">
              Meeting link deadline missed by {formatOverdueDuration(overdueByMs)}
            </span>
            <p>
              This is no longer a routine pending confirmation. The booking has <strong>not</strong>{' '}
              been cancelled and no refund has been raised &mdash; {booking?.seeker?.full_name || 'the seeker'} is
              still waiting. You can still attach a link and confirm (it will be recorded as a late
              confirmation), or cancel the booking, which releases the slot and starts a refund.
            </p>
          </div>
        </div>
      )}

      {/* ===== Reschedule Request ===== */}
      {rescheduleRequest && (
        <div
          id="reschedule-request-panel"
          className={`rounded-xl border p-6 shadow-xs space-y-5 ${
            isReschedulePending
              ? 'border-amber-300 bg-amber-50 dark:bg-amber-900/10'
              : 'border-[var(--color-shell-border)] bg-[var(--color-shell-surface)]'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-inherit pb-3">
            <h3 className="text-sm font-bold text-[var(--color-shell-text)] flex items-center gap-1.5">
              <Calendar className="h-4 w-4 text-[var(--color-shell-text-muted)]" />
              Reschedule Request
            </h3>
            <Badge variant={isReschedulePending ? 'warning' : rescheduleRequest.status === 'APPROVED' ? 'success' : 'secondary'}>
              {isReschedulePending
                ? 'Awaiting your decision'
                : rescheduleRequest.status === 'APPROVED'
                  ? 'Approved'
                  : rescheduleRequest.status === 'REJECTED'
                    ? 'Declined'
                    : rescheduleRequest.status === 'EXPIRED'
                      ? 'Expired'
                      : 'Withdrawn'}
            </Badge>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-3">
              <span className="block font-medium text-[var(--color-shell-text-muted)]">Current</span>
              <span className="mt-0.5 block font-semibold text-[var(--color-shell-text)]">
                {formatRescheduleWindow(rescheduleRequest.original_start_time, rescheduleRequest.original_end_time, booking.mentor_timezone)}
              </span>
            </div>
            <div className="rounded-lg border border-amber-300 bg-amber-50/60 dark:bg-amber-900/20 p-3">
              <span className="block font-medium text-amber-800 dark:text-amber-200">Requested</span>
              <span className="mt-0.5 block font-semibold text-amber-900 dark:text-amber-100">
                {formatRescheduleWindow(rescheduleRequest.requested_start_time, rescheduleRequest.requested_end_time, booking.mentor_timezone)}
              </span>
            </div>
          </div>

          <p className="text-xs text-[var(--color-shell-text-muted)]">
            {booking.seeker?.full_name || 'The seeker'} · {gigTitle} · {segmentName}.{' '}
            {isReschedulePending
              ? 'The current time stays confirmed and the requested time is held until you decide.'
              : rescheduleRequest.status === 'APPROVED'
                ? `Approved ${new Date(rescheduleRequest.mentor_responded_at || rescheduleRequest.updated_at).toLocaleString('en-IN')}.`
                : rescheduleRequest.status === 'REJECTED'
                  ? rescheduleRequest.rejection_reason || 'The seeker was notified that the original time stands.'
                  : 'This request closed without a change.'}
          </p>

          {isReschedulePending && (
            <div className="flex flex-col sm:flex-row gap-2.5">
              <Button
                id="btn-accept-reschedule"
                onClick={() => handleRescheduleDecision('APPROVED')}
                disabled={responding}
                isLoading={responding}
                className="gap-1.5 text-xs"
              >
                {!responding && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                <span>Accept</span>
              </Button>
              <Button
                id="btn-reject-reschedule"
                onClick={() => setShowRejectModal(true)}
                variant="outline"
                disabled={responding}
                className="gap-1.5 text-xs"
              >
                <span>Reject</span>
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ===== Session Control Center (Live / Scheduled / Ended) ===== */}
      <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-xs space-y-5">
        <div className="flex items-center justify-between border-b border-[var(--color-shell-border)] pb-3">
          <h3 className="text-sm font-bold text-[var(--color-shell-text)] flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-[var(--color-shell-text-muted)]" />
            Session Lifecycle Control Center
          </h3>
          <Badge variant={isLive ? 'success' : hasEnded ? 'secondary' : isConfirmed ? 'warning' : 'outline'}>
            {isLive ? '● LIVE IN PROGRESS' : hasEnded ? 'ENDED' : isConfirmed ? 'AWAITING START' : STATUS_LABEL[booking.status]}
          </Badge>
        </div>

        {/* Live countdown timer for in-progress sessions */}
        {isLive && (
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5 text-[var(--color-shell-text-muted)]">
              <Timer className="h-3.5 w-3.5 text-[var(--color-shell-error)] animate-pulse" />
              <span className="font-medium">Time remaining in session</span>
            </div>
            <div className="font-mono text-lg font-bold text-[var(--color-shell-text)]">
              {formatCountdown(countdown)}
            </div>
          </div>
        )}

        {/* Lifecycle timeline */}
        <div className="space-y-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-shell-text-subtle)]">
            Booking Lifecycle Progression
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
            {STATUS_ORDER.slice(0, 5).map((status, idx) => {
              const stageIdx = idx + 1;
              const currentStage = getSessionLifecycleStage(booking.status);
              const isComplete = stageIdx <= currentStage;
              const isCurrent = stageIdx === currentStage;
              const isFinal = status === 'COMPLETED';
              return (
                <div
                  key={status}
                  className={`p-2.5 rounded-lg border text-center transition-all ${
                    isComplete
                      ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-200 font-bold border-emerald-200 dark:border-emerald-800/50'
                      : 'bg-[var(--color-shell-bg-hover)] text-[var(--color-shell-text-muted)] border-[var(--color-shell-border)] font-medium'
                  }`}
                >
                  <div className="flex items-center justify-center gap-1.5 mb-0.5">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        isComplete ? 'bg-emerald-500 dark:bg-emerald-400' : isCurrent ? 'bg-[var(--color-shell-accent)]' : 'bg-[var(--color-shell-text-subtle)]/40'
                      }`}
                    />
                    <span>{STATUS_LABEL[status] || status}</span>
                  </div>
                  {isComplete && <div className="w-4 h-0.5 bg-emerald-500 dark:bg-emerald-400 rounded-full mx-auto" />}
                </div>
              );
            })}
          </div>
        </div>

        {/* End Session action (only when live) */}
        {isConfirmed && !hasEnded && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-2 border-t border-[var(--color-shell-border)] text-xs">
            <div className="space-y-1">
              <p className="font-semibold text-[var(--color-shell-text)]">
                {hasStarted && !hasEnded
                  ? 'The session is currently in progress.'
                  : 'The session is awaiting its scheduled start.'}
              </p>
              <p className="text-[var(--color-shell-text-muted)]">
                Ending the session now will deactivate the meeting link for the seeker and mark this booking as COMPLETED.
              </p>
              {booking.meeting_url && (
                <p className="text-[var(--color-shell-text-subtle)]">
                  Meeting link: {booking.meeting_url}
                </p>
              )}
            </div>
            <Button
              id="btn-end-session"
              onClick={() => setShowEndModal(true)}
              variant="destructive"
              size="sm"
              className="gap-1.5 text-xs shrink-0"
              disabled={!canEndSession}
            >
              <Video className="h-3.5 w-3.5" />
              <span>End Session</span>
            </Button>
          </div>
        )}

        {/* Ended state info */}
        {hasEnded && booking.actual_ended_at && (
          <div className="flex items-start gap-3 text-xs">
            <CheckCircle2 className="h-4 w-4 text-[var(--color-shell-success)] shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-semibold text-[var(--color-shell-text)]">Session Concluded</p>
              <p className="text-[var(--color-shell-text-muted)]">
                This session was ended on{' '}
                {new Date(booking.actual_ended_at).toLocaleDateString('en-IN', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: true,
                })}
                {booking.ended_by_role && ` by ${booking.ended_by_role}.`}
                . The meeting link is deactivated and the seeker has been notified.
              </p>
            </div>
          </div>
        )}

        {!hasStarted && isConfirmed && (
          <div className="flex items-start gap-3 text-xs">
            <Clock className="h-4 w-4 text-[var(--color-shell-warning)] shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-semibold text-[var(--color-shell-text)]">Session Scheduled</p>
              <p className="text-[var(--color-shell-text-muted)]">
                The session has not started yet. The "End Session" action will become available once the session is in progress.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ===== Confirmation & Meeting Link ===== */}
      {isPending && (
        <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--color-shell-border)] pb-3">
            <div>
              <h3 className="text-sm font-bold text-[var(--color-shell-text)]">Confirm Session & Attach Meeting Link</h3>
              <p className="text-xs text-[var(--color-shell-text-muted)] mt-0.5">
                Enter your video conference link (Google Meet, Zoom, MS Teams, etc.).
              </p>
            </div>
            <div className="text-xs">
              {booking.deadlineInfo && (
                <span
                  className={`inline-flex items-center gap-1 font-medium px-2 py-0.5 rounded ${
                    isOverdue
                      ? 'bg-amber-100 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200'
                      : 'bg-[var(--color-shell-bg-hover)] text-[var(--color-shell-text-muted)]'
                  }`}
                >
                  <Clock className="h-3 w-3" />
                  Deadline: {MEETING_LINK_DEADLINE_MINUTES}m before start (
                  {isOverdue
                    ? `overdue by ${formatOverdueDuration(overdueByMs)}`
                    : `~${minutesLeft}m remaining`}
                  )
                </span>
              )}
            </div>
          </div>

          <form onSubmit={handleConfirm} className="space-y-4">
            <Input
              id="meeting-url-input"
              label="HTTPS Video Meeting URL"
              value={meetingUrl}
              onChange={(e) => handleUrlChange(e.target.value)}
              placeholder="https://meet.google.com/xxx-xxxx-xxx"
              error={urlError}
              helperText="Must be a valid HTTPS URL. Cannot confirm session without a valid link."
            />

            <div className="rounded-lg bg-[var(--color-shell-bg-hover)] p-3.5 text-xs space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-[var(--color-shell-text)]">
                <BellRing className="h-3.5 w-3.5 text-[var(--color-shell-text-muted)]" />
                <span>Platform Secrecy & Notification Rules</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-[var(--color-shell-text-muted)] pl-1">
                <li>
                  <strong>Confirmation Requirement:</strong> Session cannot be confirmed without a verified HTTPS meeting link.
                </li>
                <li>
                  <strong>Seeker Notification:</strong> Confirming changes status to <code className="bg-[var(--color-shell-border)] px-1 py-0.5 rounded text-[11px]">CONFIRMED</code> and immediately dispatches an in-app notification to the seeker.
                </li>
                <li>
                  <strong>Link Privacy:</strong> The actual video link remains hidden from the seeker until 5 minutes before the scheduled start.
                </li>
              </ul>
            </div>

            <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="text-xs text-[var(--color-shell-text-muted)] flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5 text-[var(--color-shell-text-subtle)]" />
                <span>In-app alert will be pushed to {booking.seeker?.full_name || 'seeker'}</span>
              </div>
              <Button
                id="btn-confirm-session"
                type="submit"
                size="md"
                disabled={submitting || !!urlError || !meetingUrl.trim()}
                className="w-full sm:w-auto gap-2 text-xs bg-[var(--color-shell-primary)] hover:bg-[var(--color-shell-primary-hover)] text-white cursor-pointer"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Processing Confirmation...</span>
                  </>
                ) : (
                  <>
                    <Video className="h-3.5 w-3.5" />
                    <span>Confirm Session & Share Link</span>
                  </>
                )}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* ===== Confirmed session: meeting link management ===== */}
      {isConfirmed && booking.meeting_url && (
        <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-[var(--color-shell-border)] pb-2">
            <h3 className="text-sm font-bold text-[var(--color-shell-text)] flex items-center gap-1.5">
              <Video className="h-4 w-4 text-[var(--color-shell-text-muted)]" />
              Meeting Link
            </h3>
            <Badge variant="success" className="text-xs">
              Active
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <div className="font-mono text-[var(--color-shell-text-muted)] flex-1 break-all bg-[var(--color-shell-bg-hover)] px-3 py-2 rounded-lg border border-[var(--color-shell-border)]">
              {booking.meeting_url}
            </div>
            <Button
              onClick={() => handleCopyLink(booking.meeting_url!)}
              variant="outline"
              size="sm"
              className="gap-1 text-xs shrink-0"
            >
              {copiedLink ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copiedLink ? 'Copied' : 'Copy'}</span>
            </Button>
            <a
              href={booking.meeting_url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[var(--color-shell-accent)] hover:text-[var(--color-shell-accent-hover)] shrink-0"
              aria-label="Open meeting link"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
            This link will unlock for the seeker 5 minutes before the session starts and is revoked when the session ends.
          </p>
        </div>
      )}

      {/* ===== Confirmed but no meeting link yet ===== */}
      {isConfirmed && !booking.meeting_url && !booking.actual_ended_at && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/10 p-4 flex items-start gap-3 text-xs text-amber-800 dark:text-amber-100">
          <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <span className="font-bold block text-sm">No Meeting Link Set</span>
            <p>The meeting URL is not yet attached. Use the form below to confirm this session.</p>
          </div>
        </div>
      )}

      {/* ===== Reject Reschedule Request Modal ===== */}
      <Modal
        isOpen={showRejectModal}
        onClose={() => setShowRejectModal(false)}
        title="Decline this reschedule?"
        description="The booking keeps its current date and time. The requested slot is released and the seeker is told."
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="reschedule-reject-reason" className="block text-xs font-medium text-[var(--color-shell-text)]">
              Reason (optional)
            </label>
            <textarea
              id="reschedule-reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              maxLength={500}
              className="w-full rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-3 text-sm text-[var(--color-shell-text)] placeholder:text-[var(--color-shell-text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--color-shell-accent)] focus:border-transparent resize-none"
              placeholder="e.g., I am not free at that time that day."
            />
            <div className="text-[10px] text-[var(--color-shell-text-subtle)] text-right">
              {rejectReason.length}/500
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              onClick={() => setShowRejectModal(false)}
              variant="outline"
              size="sm"
              className="flex-1"
              disabled={responding}
            >
              Keep Request Open
            </Button>
            <Button
              onClick={() => handleRescheduleDecision('REJECTED', rejectReason)}
              variant="destructive"
              size="sm"
              isLoading={responding}
              loadingText="Declining..."
              className="flex-1"
            >
              Decline
            </Button>
          </div>
        </div>
      </Modal>

      {/* ===== End Session Confirmation Modal ===== */}
      <Modal
        isOpen={showEndModal}
        onClose={() => setShowEndModal(false)}
        title="End Session?"
        description={`This will permanently deactivate the meeting link for the seeker and mark booking #${booking?.booking_code || ''} as COMPLETED.`}
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--color-shell-warning)]/30 bg-[var(--color-shell-warning-soft)]/50 p-3 text-xs">
            <div className="flex items-start gap-2 text-[var(--color-shell-warning)]">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>This action cannot be undone. The seeker will be notified that the session has ended.</span>
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="end-reason" className="block text-xs font-medium text-[var(--color-shell-text)]">
              Reason for ending (optional)
            </label>
            <textarea
              id="end-reason"
              value={endReason}
              onChange={(e) => setEndReason(e.target.value)}
              rows={3}
              maxLength={500}
              className="w-full rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-3 text-sm text-[var(--color-shell-text)] placeholder:text-[var(--color-shell-text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--color-shell-accent)] focus:border-transparent resize-none"
              placeholder="e.g., Session complete, connectivity issue, etc."
            />
            <div className="text-[10px] text-[var(--color-shell-text-subtle)] text-right">
              {endReason.length}/500
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              onClick={() => setShowEndModal(false)}
              variant="outline"
              size="sm"
              className="flex-1"
              disabled={ending}
            >
              Keep Session Open
            </Button>
            <Button
              onClick={handleEndSession}
              variant="destructive"
              size="sm"
              isLoading={ending}
              loadingText="Ending..."
              className="flex-1"
            >
              End Session
            </Button>
          </div>
        </div>
      </Modal>

      {/* ===== 2-Column Info Grid ===== */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Seeker Information */}
        <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-[var(--color-shell-border)] pb-2">
            <h3 className="text-sm font-bold text-[var(--color-shell-text)] flex items-center gap-1.5">
              <User className="h-4 w-4 text-[var(--color-shell-text-muted)]" />
              Seeker Profile
            </h3>
            <span className="text-[11px] font-mono text-[var(--color-shell-text-subtle)]">
              <ShortId value={booking.seeker_id} label="Seeker ID" />
            </span>
          </div>

          <div className="space-y-3 text-xs">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 shrink-0 rounded-full bg-[var(--color-shell-bg-hover)] font-bold text-[var(--color-shell-text-muted)] flex items-center justify-center border border-[var(--color-shell-border)] text-sm">
                {booking.seeker?.full_name
                  ? booking.seeker.full_name
                      .split(' ')
                      .map((n) => n[0])
                      .join('')
                      .substring(0, 2)
                      .toUpperCase()
                  : 'SK'}
              </div>
              <div className="min-w-0">
                <span className="font-bold text-sm text-[var(--color-shell-text)] block truncate">
                  {booking.seeker?.full_name || 'Seeker name unavailable'}
                </span>
                {booking.seeker?.email ? (
                  <a
                    href={`mailto:${booking.seeker.email}`}
                    className="text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)] hover:underline break-all"
                  >
                    {booking.seeker.email}
                  </a>
                ) : (
                  <span className="text-[var(--color-shell-text-muted)]">No email on file</span>
                )}
              </div>
            </div>

            <div className="space-y-1.5 pt-1">
              <div className="flex justify-between gap-3">
                <span className="text-[var(--color-shell-text-muted)]">Seeker Timezone:</span>
                <span className="font-medium text-[var(--color-shell-text)] text-right break-words">
                  {booking.seeker_timezone || 'Not recorded'}
                </span>
              </div>
            </div>

            <div className="pt-2">
              <span className="text-[var(--color-shell-text-subtle)] block text-[11px] font-medium uppercase tracking-wider">
                Topic & Pre-session Note
              </span>
              <p className="text-[var(--color-shell-text-muted)] mt-1 leading-relaxed bg-[var(--color-shell-bg-hover)] p-2.5 rounded-lg border border-[var(--color-shell-border)]">
                The seeker has not added a pre-session note for this booking.
              </p>
            </div>
          </div>
        </div>

        {/* Schedule & Payment Verification */}
        <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-[var(--color-shell-border)] pb-2">
            <h3 className="text-sm font-bold text-[var(--color-shell-text)] flex items-center gap-1.5">
              <CreditCard className="h-4 w-4 text-[var(--color-shell-text-muted)]" />
              Schedule & Payment Verification
            </h3>
            <span
              className={`text-[11px] font-medium px-2 py-0.5 rounded border ${
                paymentStatus === 'verified'
                  ? 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-900/20 dark:border-emerald-800/50'
                  : 'text-zinc-600 bg-zinc-50 border-zinc-200 dark:text-zinc-400 dark:bg-zinc-800 dark:border-zinc-700'
              }`}
            >
              {paymentStatus === 'verified' ? 'Payment verified' : 'Payment pending'}
            </span>
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="flex justify-between gap-3">
              <span className="text-[var(--color-shell-text-muted)]">Segment:</span>
              <span className="font-medium text-[var(--color-shell-text)] text-right break-words">
                {segmentName}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--color-shell-text-muted)]">Gig:</span>
              <span className="font-medium text-[var(--color-shell-text)] text-right break-words">
                {gigTitle}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--color-shell-text-muted)]">Session Timing:</span>
              <span className="font-semibold text-[var(--color-shell-text)] text-right">
                {formatSessionTime(booking.start_time, booking.end_time, booking.mentor_timezone)}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--color-shell-text-muted)]">Duration:</span>
              <span className="font-medium text-[var(--color-shell-text)]">{sessionDurationLabel}</span>
            </div>
            <div className="flex justify-between gap-3 border-t border-[var(--color-shell-border)] pt-2">
              <span className="text-[var(--color-shell-text-muted)]">Payment Amount:</span>
              <span className="font-bold text-[var(--color-shell-text)]">{amountLabel}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--color-shell-text-muted)]">Payment Status:</span>
              <span className="font-semibold text-[var(--color-shell-text)] text-right break-words">
                {booking.payment?.status || 'Not recorded'}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--color-shell-text-muted)]">Txn Reference:</span>
              <span className="font-mono text-[11px] text-[var(--color-shell-text-muted)] text-right break-all">
                {booking.payment?.transaction_reference || 'Not submitted'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Workspace shortcut for confirmed/completed sessions */}
      {(isConfirmed || isCompleted) && (
        <div className="flex justify-end">
          <Button
            onClick={() => navigate(`/mentor/workspace?bookingId=${booking.id}`)}
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs border-[var(--color-shell-border)] hover:border-[var(--color-shell-text)] cursor-pointer"
          >
            <FileText className="h-3.5 w-3.5 text-[var(--color-shell-text-muted)]" />
            <span>Session Workspace</span>
          </Button>
        </div>
      )}
    </div>
  );
};