import React, { useState, useEffect } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle2,
  CreditCard,
  FileText,
  Info,
  LifeBuoy,
  Lock,
  RotateCcw,
  Trash2,
  Video,
} from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Modal } from '@/src/components/ui/Modal';
import { Textarea } from '@/src/components/ui/Textarea';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import { useToast } from '@/src/context/ToastContext';
import { apiFetch } from '@/src/lib/apiClient';
import {
  fetchBookingDetail,
  fetchSessionAccess,
  endSessionBySeeker,
  EnrichedBookingRecord,
  SessionAccessState,
} from '@/src/lib/bookingService';
import { formatClockTime, formatClockRange, formatZoneLabel } from '@/src/lib/sessionState';
import type { BookingStatus } from '@/src/types/database';
import { toUserMessage } from '@/src/lib/errorMessages';
import { APP_CONFIG, CANCELLATION_WINDOW_MS, HOLDOUT_MINUTES } from '@/src/config/app';
import { PageHeading } from '@/src/components/booking/PageHeading';
import { SegmentScope } from '@/src/components/booking/SegmentScope';
import { StatusPill } from '@/src/components/booking/StatusPill';
import { InlineNotice, SectionCard } from '@/src/components/booking/StatePanel';
import { LiveCountdown } from '@/src/components/booking/HoldCountdown';
import { BookingSummary } from '@/src/components/booking/BookingSummary';
import {
  BOOKING_LIFECYCLE,
  bookingLifecyclePosition,
  describeBookingStatus,
  describeChangeWindow,
  describePaymentStatus,
  isClosedBookingStatus,
  type ChangeWindowTone,
} from '@/src/components/booking/statusTone';
import { TONE_SURFACE, TONE_TEXT } from '@/src/components/booking/tokens';
import { cn } from '@/src/lib/utils';

/**
 * The booking statuses the server will accept a cancellation or reschedule for.
 *
 * This mirrors the `cancellableStatuses` list in the cancel and reschedule
 * routes. It is duplicated rather than imported because the server owns the rule;
 * keeping the two lists adjacent here means a status added on the server shows up
 * as "not available" here rather than as a button that fails on click.
 */
const CANCELLABLE_BOOKING_STATUSES: BookingStatus[] = [
  'PAYMENT_PENDING',
  'PENDING_VERIFICATION',
  'MENTOR_PENDING',
  'CONFIRMED',
];

const CHANGE_WINDOW_TONE: Record<ChangeWindowTone, { wrap: string; text: string }> = {
  open: { wrap: TONE_SURFACE.success, text: TONE_TEXT.success },
  closed: { wrap: TONE_SURFACE.warning, text: TONE_TEXT.warning },
  unavailable: { wrap: TONE_SURFACE.neutral, text: TONE_TEXT.neutral },
};

export const SeekerBookingDetailPage: React.FC = () => {
  const { navigate, currentPath } = useNavigation();
  const toast = useToast();

  const getBookingIdFromUrl = (): string => {
    const params = new URLSearchParams(currentPath.includes('?') ? currentPath.split('?')[1] : '');
    return params.get('bookingId') || '';
  };

  const [bookingId] = useState<string>(getBookingIdFromUrl());
  const [booking, setBooking] = useState<EnrichedBookingRecord | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancellationReason, setCancellationReason] = useState('');
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [sessionAccessState, setSessionAccessState] = useState<SessionAccessState | null>(null);
  /**
   * `Date.now() - serverNow`, in ms.
   *
   * The cancellation window is enforced by the server against its own clock, so
   * deciding it against the browser clock lets a seeker with a skewed device see
   * either a button that is rejected on click, or — worse — no button at all
   * while the server would still accept the change. The session-access response
   * already carries the authoritative `currentServerTime`, so the offset comes
   * for free from a request this page makes anyway.
   *
   * Session access is only requested for a CONFIRMED booking, so this stays null
   * for pre-confirmation statuses and the local clock is used there. That is
   * acceptable: the window is effectively always open before confirmation, so
   * skew is very unlikely to flip the decision, whereas a confirmed booking
   * sitting near its cutoff is exactly where it matters. The server still has the
   * last word in every case.
   */
  const [serverClockOffsetMs, setServerClockOffsetMs] = useState<number | null>(null);
  const [sessionAccessLoading, setSessionAccessLoading] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endReason, setEndReason] = useState('');

  const { user } = useAuth();
  const userId = user?.id;

  const loadBooking = async () => {
    if (!bookingId) {
      setLoading(false);
      setError('No booking reference provided.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchBookingDetail(bookingId);
      setBooking(data);
      if (data && userId && data.status === 'CONFIRMED') {
        setSessionAccessLoading(true);
        try {
          const requestedAt = Date.now();
          const accessData = await fetchSessionAccess(bookingId, userId);
          setSessionAccessState(accessData.accessState);
          // Correct for the round trip so a slow response cannot look like a
          // fast clock.
          const serverNow = Date.parse(accessData.currentServerTime);
          if (Number.isFinite(serverNow)) {
            setServerClockOffsetMs(serverNow - (requestedAt + (Date.now() - requestedAt) / 2));
          }
        } catch {
          setSessionAccessState(null);
        } finally {
          setSessionAccessLoading(false);
        }
      }
    } catch (err: any) {
      setError(toUserMessage(err, 'Failed to load booking details.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBooking();
  }, [bookingId]);

  // Countdown timer for live sessions
  const endMs = booking ? new Date(booking.end_time).getTime() : 0;
  const [countdown, setCountdown] = useState<number>(0);

  useEffect(() => {
    const isLive = booking && sessionAccessState === 'IN_PROGRESS';
    if (!isLive) return;
    const update = () => {
      setCountdown(Math.max(0, Math.ceil((endMs - Date.now()) / 1000)));
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [booking, sessionAccessState, endMs]);


  const handleEndSession = async () => {
    if (!booking || ending) return;
    setEnding(true);
    try {
      const result = await endSessionBySeeker(booking.id, endReason.trim() || undefined);
      if (result.success) {
        setBooking((prev) =>
          prev
            ? {
                ...prev,
                status: 'COMPLETED',
                actual_ended_at: result.booking?.actual_ended_at || new Date().toISOString(),
                ended_by_role: (result.endedByRole || 'seeker') as any,
                updated_at: new Date().toISOString(),
              }
            : null
        );
        setSessionAccessState('COMPLETED');
        setShowEndModal(false);
        setEndReason('');
        toast.success('Session ended. Your mentor has been notified.', { title: 'Session Ended' });
      } else {
        toast.error(result.error?.message || 'Failed to end session.', { title: 'End Session Failed' });
      }
    } catch (err: any) {
      toast.error(toUserMessage(err, 'Failed to end session.'), { title: 'End Session Failed' });
    } finally {
      setEnding(false);
    }
  };

  const canEndSession = booking?.status === 'CONFIRMED' && sessionAccessState === 'IN_PROGRESS';
  const isLive = canEndSession;

  const handleCancel = async () => {
    if (!booking || cancelling) return;
    setCancelling(true);
    try {
      const res = await apiFetch(`/api/seeker/bookings/${encodeURIComponent(booking.id)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: cancellationReason || 'Cancelled by seeker' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || 'Failed to cancel booking');
      }
      toast.success('Booking cancelled successfully');
      setShowCancelModal(false);
      await loadBooking();
    } catch (err: any) {
      toast.error(toUserMessage(err, 'Failed to cancel booking'));
    } finally {
      setCancelling(false);
    }
  };

  const handleReschedule = () => {
    if (!booking) return;
    navigate(`/seeker/reschedule?bookingId=${booking.id}`);
  };

  const backToBookings = () => navigate('/seeker/bookings');

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <PageHeading title="Booking details" back={{ label: 'Back to my bookings', onClick: backToBookings }} />
        <SectionCard aria-label="Loading booking details">
          <div className="flex items-center gap-3.5">
            <Skeleton variant="circular" className="h-12 w-12 shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
          <Skeleton className="mt-5 h-24 w-full" />
        </SectionCard>
        <p className="sr-only" role="status" aria-live="polite">
          Loading your booking details.
        </p>
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <PageHeading title="Booking details" back={{ label: 'Back to my bookings', onClick: backToBookings }} />
        <EmptyState
          icon={AlertCircle}
          title="Booking not found"
          description={error || 'This booking could not be found. It may have been cancelled, or the link may be incorrect.'}
          actionLabel="View my bookings"
          onAction={backToBookings}
        />
      </div>
    );
  }

  const descriptor = describeBookingStatus(booking.status);
  const isConfirmed = booking.status === 'CONFIRMED';
  const isCompleted = booking.status === 'COMPLETED';
  const isPaymentPending = booking.status === 'PAYMENT_PENDING';
  const isClosed = isClosedBookingStatus(booking.status);

  const meetingUnlocked = sessionAccessState === 'T5_WINDOW' || sessionAccessState === 'IN_PROGRESS';
  const meetingFinished =
    sessionAccessState === 'ENDED' || sessionAccessState === 'COMPLETED' || isCompleted;

  // Mirrors `BookingSummary`, so every time on this page is read in one zone
  // rather than a mix of the mentor's and the viewer's.
  const displayZone = booking.mentor_timezone || booking.seeker_timezone || null;

  // Measured against the server's clock when it is known, so this estimate
  // agrees with the one the server will actually enforce.
  const authoritativeNowMs = Date.now() - (serverClockOffsetMs ?? 0);
  const minutesUntilStart = Math.max(
    0,
    Math.floor((new Date(booking.start_time).getTime() - authoritativeNowMs) / (1000 * 60))
  );
  // Mirrors the server's `cancellableStatuses` exactly (server.ts). A status the
  // server does not accept is never presented as changeable.
  const allowsChange = CANCELLABLE_BOOKING_STATUSES.includes(booking.status);
  const changeWindow = describeChangeWindow({
    allowsChange,
    minutesUntilStart,
    windowMinutes: APP_CONFIG.NORMAL_CANCELLATION_WINDOW_MINUTES,
    waitingOn:
      booking.status === 'MENTOR_PENDING'
        ? 'mentor'
        : booking.status === 'PENDING_VERIFICATION'
          ? 'verification'
          : booking.status === 'PAYMENT_PENDING'
            ? 'payment'
            : 'none',
    closedBecauseConfirmed: isConfirmed && !allowsChange,
  });
  const changeTone = CHANGE_WINDOW_TONE[changeWindow.tone];
  const cancellationDeadline = new Date(new Date(booking.start_time).getTime() - CANCELLATION_WINDOW_MS);

  // An open request means the mentor has not answered yet. The booking is still
  // at its current time, and a second request would be refused, so the button is
  // disabled and the request is shown in place of a fresh prompt.
  const openReschedule = booking.rescheduleRequest?.status === 'PENDING' ? booking.rescheduleRequest : null;
  const hasPendingReschedule = !!openReschedule;
  const lastReschedule =
    !hasPendingReschedule && booking.rescheduleRequest ? booking.rescheduleRequest : null;

  return (
    <SegmentScope slug={booking.segment?.slug} className="mx-auto w-full max-w-4xl">
      <div className="space-y-5">
        <PageHeading
          eyebrow={`Booking ${booking.booking_code}`}
          title={booking.gig?.title || 'Session details'}
          description={descriptor.hint}
          back={{ label: 'Back to my bookings', onClick: backToBookings }}
          aside={
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  navigate(
                    `/seeker/support?bookingCode=${encodeURIComponent(booking.booking_code)}&new=1`,
                  )
                }
              >
                <LifeBuoy className="h-4 w-4" aria-hidden="true" />
                Contact support
              </Button>
              <StatusPill tone={descriptor.tone} label={descriptor.label} size="md" srPrefix="Status" />
            </>
          }
        />

        {/* Live countdown for in-progress sessions */}
        {isLive && (
          <LiveCountdown
            secondsRemaining={countdown}
            label="Session in progress — time remaining"
          />
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Primary action, chosen by what the booking actually needs next     */}
        {/* ---------------------------------------------------------------- */}
        {isPaymentPending && (
          <SectionCard
            title="Payment required"
            description={`This slot is held for you. Complete payment to confirm the session before your ${HOLDOUT_MINUTES}-minute timer runs out.`}
            icon={CreditCard}
            aside={<StatusPill tone="warning" label="Action needed" dot />}
          >
            <Button
              onClick={() => navigate(`/seeker/payment?bookingId=${booking.id}`)}
              size="lg"
              className="w-full gap-2 sm:w-auto"
            >
              <CreditCard className="h-4 w-4" aria-hidden="true" />
              <span>Complete payment</span>
            </Button>
          </SectionCard>
        )}

        {isConfirmed && (
          <SectionCard
            title="Your session"
            icon={Video}
            aside={
              sessionAccessLoading ? (
                <StatusPill tone="neutral" label="Checking access…" />
              ) : meetingUnlocked ? (
                <StatusPill tone="success" label="Room open" dot pulse />
              ) : meetingFinished ? (
                <StatusPill tone="neutral" label="Session finished" />
              ) : (
                <StatusPill tone="warning" label="Opens at T-5" />
              )
            }
          >
            {meetingUnlocked ? (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[13.5px] leading-relaxed text-[var(--color-shell-text-muted)]">
                  Your meeting room is open. Join when you are ready — you can enter a few minutes
                  early to check your audio and video.
                </p>
                <Button
                  onClick={() => navigate(`/seeker/session?bookingId=${booking.id}`)}
                  size="lg"
                  className="w-full shrink-0 gap-2 sm:w-auto"
                >
                  <Video className="h-4 w-4" aria-hidden="true" />
                  <span>Join session room</span>
                </Button>
              </div>
            ) : meetingFinished ? (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[13.5px] leading-relaxed text-[var(--color-shell-text-muted)]">
                  This session has ended. Your mentor&rsquo;s notes and takeaways are in the session
                  workspace.
                </p>
                <Button
                  onClick={() => navigate(`/seeker/workspace?bookingId=${booking.id}`)}
                  variant="outline"
                  className="w-full shrink-0 gap-2 sm:w-auto"
                >
                  <FileText className="h-4 w-4" aria-hidden="true" />
                  <span>Open session workspace</span>
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-2 text-[13.5px] leading-relaxed text-[var(--color-shell-text-muted)]">
                  <Lock className="h-4 w-4 shrink-0 text-[var(--color-shell-text-subtle)]" aria-hidden="true" />
                  The meeting link unlocks 5 minutes before your session starts.
                </p>
                <Button
                  onClick={() => navigate(`/seeker/session?bookingId=${booking.id}`)}
                  variant="outline"
                  className="w-full shrink-0 gap-2 sm:w-auto"
                  aria-describedby="join-locked-hint"
                >
                  <Lock className="h-4 w-4" aria-hidden="true" />
                  <span>Join locked (opens at T-5)</span>
                </Button>
              </div>
            )}
          </SectionCard>
        )}

        {isCompleted && (
          <SectionCard
            title="This session is complete"
            description="Your mentor's notes and takeaways are available in the session workspace."
            icon={FileText}
            aside={<StatusPill tone="neutral" label="Completed" />}
          >
            <Button
              onClick={() => navigate(`/seeker/workspace?bookingId=${booking.id}`)}
              variant="outline"
              className="w-full gap-2 sm:w-auto"
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
              <span>Open session workspace</span>
            </Button>
          </SectionCard>
        )}

        {/* Reach support from the booking itself, carrying the human-readable
            booking code. The internal booking UUID is never forwarded. */}
        <SectionCard
          title="Need help with this booking?"
          description="Send the Suggest Key support team a message about this booking without leaving your account."
          icon={LifeBuoy}
        >
          <Button
            onClick={() =>
              navigate(
                `/seeker/support?bookingCode=${encodeURIComponent(booking.booking_code)}`,
              )
            }
            variant="outline"
            className="w-full gap-2 sm:w-auto"
          >
            <LifeBuoy className="h-4 w-4" aria-hidden="true" />
            <span>Help &amp; Support</span>
          </Button>
        </SectionCard>

        {/* End Session action for live sessions */}
        {canEndSession && (
          <InlineNotice
            tone="danger"
            role="alert"
            icon={AlertTriangle}
            title="End this session early?"
            actions={
              <Button onClick={() => setShowEndModal(true)} variant="destructive" className="gap-2">
                <Video className="h-4 w-4" aria-hidden="true" />
                <span>End session</span>
              </Button>
            }
          >
            Ending the session deactivates the meeting link for your mentor and marks this booking as
            completed.
          </InlineNotice>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-5">
            {/* ---------------- Session details ---------------- */}
            <SectionCard
              title="Session details"
              icon={Calendar}
              aside={
                booking.payment ? (
                  <StatusPill
                    tone={describePaymentStatus(booking.payment.status).tone}
                    label={describePaymentStatus(booking.payment.status).label}
                  />
                ) : undefined
              }
            >
              <BookingSummary booking={booking} />
            </SectionCard>

            {/* ---------------- Lifecycle ---------------- */}
            {!isClosed && (
              <SectionCard
                title="Booking progress"
                description="Where this booking currently sits in the confirmation flow."
              >
                <ol className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                  {BOOKING_LIFECYCLE.map((status, index) => {
                    const position = index + 1;
                    const current = bookingLifecyclePosition(booking.status);
                    const done = current > 0 && position < current;
                    const currentStep = position === current;
                    return (
                      <li key={status} className="flex min-w-0 flex-1 items-center gap-2 sm:flex-col sm:items-stretch sm:gap-1.5">
                        <div
                          aria-hidden="true"
                          className={cn(
                            'h-1.5 w-full rounded-full sm:h-1',
                            done
                              ? 'bg-[var(--color-shell-success)]'
                              : currentStep
                                ? 'bg-[var(--segment-accent)]'
                                : 'bg-[var(--color-shell-border)]'
                          )}
                        />
                        <span
                          className={cn(
                            'truncate text-[11.5px]',
                            currentStep
                              ? 'font-bold text-[var(--color-shell-text)]'
                              : done
                                ? 'font-medium text-[var(--color-shell-text-muted)]'
                                : 'text-[var(--color-shell-text-subtle)]'
                          )}
                        >
                          {describeBookingStatus(status).label}
                        </span>
                        {currentStep && <span className="sr-only">(current step)</span>}
                      </li>
                    );
                  })}
                </ol>
              </SectionCard>
            )}
          </div>

          {/* ---------------- Cancellation & rescheduling ---------------- */}
          <div className="min-w-0">
            <SectionCard title="Cancellation & rescheduling" icon={Trash2}>
              <div className="space-y-4">
                <div className={cn('rounded-xl border p-4', changeTone.wrap)}>
                  <p className={cn('flex items-center gap-2 text-[13.5px] font-bold', changeTone.text)}>
                    {changeWindow.tone === 'open' ? (
                      <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
                    ) : changeWindow.tone === 'closed' ? (
                      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                    ) : (
                      <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
                    )}
                    <span>{changeWindow.title}</span>
                  </p>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--color-shell-text-muted)]">
                    {changeWindow.body}
                  </p>

                  {changeWindow.tone === 'open' && (
                    <dl className="mt-3 space-y-1 border-t border-[var(--color-shell-border)] pt-3 text-[12px]">
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-[var(--color-shell-text-muted)]">Session starts</dt>
                        <dd className="font-semibold tabular-nums text-[var(--color-shell-text)]">
                          {formatClockTime(booking.start_time, displayZone)}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-[var(--color-shell-text-muted)]">Changes close</dt>
                        <dd className="font-semibold tabular-nums text-[var(--color-shell-text)]">
                          {formatClockTime(cancellationDeadline.toISOString(), displayZone)}
                        </dd>
                      </div>
                      {displayZone && (
                        <p className="pt-1 text-[11px] text-[var(--color-shell-text-subtle)]">
                          Shown in {formatZoneLabel(displayZone) || displayZone}, the same timezone
                          as the session summary.
                        </p>
                      )}
                    </dl>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <Button
                    onClick={() => setShowCancelModal(true)}
                    variant="destructive"
                    className="w-full gap-2"
                    disabled={!changeWindow.canChange}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    <span>
                      {changeWindow.canChange
                        ? 'Cancel booking'
                        : changeWindow.tone === 'closed'
                          ? 'Cancel (window closed)'
                          : 'Cancel (not available)'}
                    </span>
                  </Button>
                  <Button
                    onClick={handleReschedule}
                    variant="outline"
                    className="w-full gap-2"
                    disabled={!changeWindow.canChange || hasPendingReschedule}
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    <span>
                      {hasPendingReschedule
                        ? 'Reschedule request sent'
                        : changeWindow.canChange
                          ? 'Request Reschedule'
                          : changeWindow.tone === 'closed'
                            ? 'Reschedule (window closed)'
                            : 'Reschedule (not available)'}
                    </span>
                  </Button>
                </div>
              </div>
            </SectionCard>

            {openReschedule && (
              <InlineNotice
                tone="info"
                role="status"
                icon={RotateCcw}
                title="Reschedule request sent to mentor"
              >
                You asked to move this session to{' '}
                <strong className="font-semibold">
                  {formatClockRange(
                    openReschedule.requested_start_time,
                    openReschedule.requested_end_time,
                    displayZone
                  )}
                </strong>
                . Your current time stays confirmed until your mentor responds.
              </InlineNotice>
            )}

            {!openReschedule && lastReschedule && (
              <InlineNotice
                tone={lastReschedule.status === 'APPROVED' ? 'success' : 'neutral'}
                role="status"
                icon={lastReschedule.status === 'APPROVED' ? CheckCircle2 : Info}
                title={
                  lastReschedule.status === 'APPROVED'
                    ? 'Reschedule approved'
                    : 'Reschedule request declined'
                }
              >
                {lastReschedule.status === 'APPROVED'
                  ? `Your mentor moved this session to ${formatClockRange(
                      lastReschedule.requested_start_time,
                      lastReschedule.requested_end_time,
                      displayZone
                    )}.`
                  : lastReschedule.rejection_reason ||
                    'Your mentor kept the original time.'}
              </InlineNotice>
            )}
          </div>
        </div>
      </div>

      {/* End Session Modal */}
      <Modal
        isOpen={showEndModal}
        onClose={() => setShowEndModal(false)}
        title="End this session?"
        description="Ending the session now will deactivate the meeting link for your mentor and mark this booking as completed."
      >
        <div className="space-y-4">
          <InlineNotice
            tone="warning"
            role="alert"
            icon={AlertTriangle}
            title="This action cannot be undone"
          >
            Your mentor will be notified that the session has ended.
          </InlineNotice>

          <div className="space-y-1.5">
            <label
              htmlFor="end-reason-seeker"
              className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-shell-text-subtle)]"
            >
              Reason for ending (optional)
            </label>
            <Textarea
              id="end-reason-seeker"
              value={endReason}
              onChange={(e) => setEndReason(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="e.g. Session complete, technical issues, etc."
            />
            <p className="text-right text-[11px] text-[var(--color-shell-text-subtle)]">
              {endReason.length}/500
            </p>
          </div>

          <div className="flex flex-col gap-2.5 sm:flex-row">
            <Button
              onClick={() => setShowEndModal(false)}
              variant="outline"
              className="flex-1"
              disabled={ending}
            >
              Keep session open
            </Button>
            <Button
              onClick={handleEndSession}
              variant="destructive"
              isLoading={ending}
              loadingText="Ending..."
              className="flex-1"
            >
              End session
            </Button>
          </div>
        </div>
      </Modal>

      {/* Cancel Modal */}
      <Modal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        title="Cancel this booking?"
        description="The slot is released back to the mentor. This cannot be undone from this screen."
      >
        <div className="space-y-4">
          <p className="text-[13.5px] leading-relaxed text-[var(--color-shell-text-muted)]">
            You are about to cancel booking{' '}
            <strong className="font-mono text-[var(--color-shell-text)]">{booking.booking_code}</strong>
            . The slot is released back to the mentor&rsquo;s calendar.
          </p>

          <div className="space-y-1.5">
            <label
              htmlFor="cancel-reason"
              className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-shell-text-subtle)]"
            >
              Reason (optional)
            </label>
            <Textarea
              id="cancel-reason"
              value={cancellationReason}
              onChange={(e) => setCancellationReason(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="e.g. Schedule conflict, no longer needed, etc."
            />
          </div>

          <div className="flex flex-col gap-2.5 sm:flex-row">
            <Button onClick={() => setShowCancelModal(false)} variant="outline" className="flex-1">
              Keep booking
            </Button>
            <Button
              onClick={handleCancel}
              variant="destructive"
              isLoading={cancelling}
              loadingText="Cancelling..."
              className="flex-1"
            >
              Cancel booking
            </Button>
          </div>
        </div>
      </Modal>
    </SegmentScope>
  );
};

export default SeekerBookingDetailPage;
