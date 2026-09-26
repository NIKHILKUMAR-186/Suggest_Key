import React, { useState, useEffect } from 'react';
import { ArrowLeft, Calendar, Clock, Video, FileText, AlertCircle, ShieldCheck, XCircle, AlertTriangle, Trash2, RotateCcw, Info } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { useNavigation } from '@/src/context/NavigationContext';
import { fetchBookingDetail, EnrichedBookingRecord } from '@/src/lib/bookingService';
import { formatLocalTimeLabel } from '@/src/lib/slotEngine';
import { toUserMessage } from '@/src/lib/errorMessages';
import { BookingStatus } from '@/src/types/database';
import { APP_CONFIG, CANCELLATION_WINDOW_MS } from '@/src/config/app';
import { useToast } from '@/src/context/ToastContext';
import { apiFetch } from '@/src/lib/apiClient';

export const SeekerBookingDetailPage: React.FC = () => {
  const { navigate, currentPath } = useNavigation();
  const toast = useToast();

  const getBookingIdFromUrl = (): string => {
    const params = new URLSearchParams(currentPath.includes('?') ? currentPath.split('?')[1] : '');
    return params.get('bookingId') || '';
  };

  const [bookingId, setBookingId] = useState<string>(getBookingIdFromUrl());
  const [booking, setBooking] = useState<EnrichedBookingRecord | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancellationReason, setCancellationReason] = useState('');
  const [showCancelModal, setShowCancelModal] = useState(false);

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
    } catch (err: any) {
      setError(toUserMessage(err, 'Failed to load booking details.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBooking();
  }, [bookingId]);

  const statusSteps = (status: BookingStatus) => {
    const allSteps = [
      { label: 'Payment Verified', statuses: ['CONFIRMED', 'COMPLETED'] },
      { label: 'Mentor Confirmed', statuses: ['CONFIRMED', 'COMPLETED'] },
      { label: 'Scheduled (T-5 Join)', statuses: ['CONFIRMED', 'COMPLETED'] },
      { label: 'Workspace & Notes', statuses: ['COMPLETED'] },
    ];
    return allSteps.map((step) => ({
      ...step,
      isComplete: step.statuses.includes(status),
      isCurrent: status === 'MENTOR_PENDING' && step.label === 'Payment Verified',
    }));
  };

  const steps = booking ? statusSteps(booking.status) : [];

  const canCancelOrReschedule = booking && ['PAYMENT_PENDING', 'PENDING_VERIFICATION', 'MENTOR_PENDING', 'CONFIRMED'].includes(booking.status);
  const isConfirmed = booking?.status === 'CONFIRMED';
  const isMentorPending = booking?.status === 'MENTOR_PENDING';
  const isPendingVerification = booking?.status === 'PENDING_VERIFICATION';
  const isPaymentPending = booking?.status === 'PAYMENT_PENDING';

  const minutesUntilStart = booking
    ? Math.max(0, Math.floor((new Date(booking.start_time).getTime() - Date.now()) / (1000 * 60)))
    : 0;

  const canCancelNormally = booking && canCancelOrReschedule && minutesUntilStart >= APP_CONFIG.NORMAL_CANCELLATION_WINDOW_MINUTES;
  const cancellationDeadline = booking
    ? new Date(new Date(booking.start_time).getTime() - CANCELLATION_WINDOW_MS)
    : null;

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

  const handleReschedule = async () => {
    if (!booking) return;
    navigate(`/seeker/reschedule?bookingId=${booking.id}`);
  };

  const getStatusDisplay = (status: BookingStatus): { label: string; variant: 'success' | 'warning' | 'secondary' | 'destructive' | 'outline' } => {
    switch (status) {
      case 'CONFIRMED': return { label: 'Confirmed', variant: 'success' };
      case 'MENTOR_PENDING': return { label: 'Waiting for Mentor', variant: 'warning' };
      case 'PENDING_VERIFICATION': return { label: 'Payment Verification Pending', variant: 'secondary' };
      case 'PAYMENT_PENDING': return { label: 'Payment Required', variant: 'warning' };
      case 'COMPLETED': return { label: 'Completed', variant: 'secondary' };
      case 'CANCELLED': return { label: 'Cancelled', variant: 'destructive' };
      case 'REJECTED': return { label: 'Rejected', variant: 'destructive' };
      default: return { label: status, variant: 'outline' };
    }
  };

  const statusDisplay = booking ? getStatusDisplay(booking.status) : { label: '—', variant: 'outline' as const };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <button
        onClick={() => navigate('/seeker/bookings')}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)] transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        <span>Back to My Bookings</span>
      </button>

      {loading ? (
        <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-12 text-center space-y-3">
          <Calendar className="h-8 w-8 text-[var(--color-shell-text-subtle)] mx-auto animate-spin" />
          <h3 className="text-sm font-semibold text-[var(--color-shell-text)]">Loading Booking Details...</h3>
          <p className="text-xs text-[var(--color-shell-text-muted)]">Retrieving booking information from database.</p>
        </div>
      ) : error || !booking ? (
        <EmptyState
          icon={AlertCircle}
          title="Booking Not Found"
          description={error || 'This booking could not be found. It may have been cancelled, or the link may be incorrect.'}
          actionLabel="View My Bookings"
          onAction={() => navigate('/seeker/bookings')}
        />
      ) : (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--color-shell-border)] pb-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold text-[var(--color-shell-text)]">Booking #{booking.booking_code}</h1>
                <Badge variant={statusDisplay.variant}>{statusDisplay.label}</Badge>
              </div>
              <p className="text-xs text-[var(--color-shell-text-muted)] mt-0.5">
                {isConfirmed
                  ? `Confirmed by mentor ${booking.mentor?.full_name || 'Mentor'} · Meeting URL ${booking.meeting_url ? 'attached' : 'pending'}`
                  : isMentorPending
                  ? 'Awaiting mentor confirmation and meeting link'
                  : isPendingVerification
                  ? 'Payment proof submitted · Waiting for admin verification'
                  : isPaymentPending
                  ? 'Payment required within 15-minute hold window'
                  : `Status: ${booking.status} · Awaiting next action`}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {isConfirmed && (
                <Button
                  onClick={() => navigate(`/seeker/session?bookingId=${booking.id}`)}
                  size="sm"
                  className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <Video className="h-3.5 w-3.5" />
                  <span>Join Session Room</span>
                </Button>
              )}
              {isPaymentPending && (
                <Button
                  onClick={() => navigate(`/seeker/payment?bookingId=${booking.id}`)}
                  size="sm"
                  className="gap-1.5 text-xs bg-amber-600 hover:bg-amber-700 text-white font-semibold shadow-xs"
                >
                  <CreditCard className="h-3.5 w-3.5" />
                  <span>Complete Payment</span>
                </Button>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-5 shadow-xs space-y-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-shell-text-subtle)]">
              Booking Lifecycle Progression
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
              {steps.map((step, idx) => (
                <div
                  key={idx}
                  className={`p-2.5 rounded-lg ${
                    step.isComplete
                      ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-200 font-bold border border-emerald-200 dark:border-emerald-800/50'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-[var(--color-shell-text-muted)] font-medium'
                  }`}
                >
                  {idx + 1}. {step.label}
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-xs space-y-4">
              <h3 className="text-sm font-bold text-[var(--color-shell-text)] border-b border-[var(--color-shell-border)] pb-2">
                Session Details
              </h3>
              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-[var(--color-shell-text-muted)]">Mentor:</span>
                  <span className="font-semibold text-[var(--color-shell-text)]">{booking.mentor?.full_name || 'Mentor'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-shell-text-muted)]">Segment:</span>
                  <span className="text-[var(--color-shell-text)]">{booking.segment?.name || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-shell-text-muted)]">Gig:</span>
                  <span className="text-[var(--color-shell-text)]">{booking.gig?.title || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-shell-text-muted)]">Duration:</span>
                  <span className="font-medium text-[var(--color-shell-text)]">{booking.gig?.duration_minutes || 60} Minutes</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-shell-text-muted)]">Scheduled Time:</span>
                  <span className="font-semibold text-[var(--color-shell-text)]">
                    {new Date(booking.start_time).toLocaleDateString('en-IN', {
                      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
                    })} · {formatLocalTimeLabel(booking.start_time)} – {formatLocalTimeLabel(booking.end_time)} (IST)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-shell-text-muted)]">Booking Ref:</span>
                  <span className="font-mono text-[var(--color-shell-text)]">#{booking.booking_code}</span>
                </div>
                {booking.payment && (
                  <div className="flex justify-between border-t border-[var(--color-shell-border)] pt-3">
                    <span className="text-[var(--color-shell-text-muted)]">Payment:</span>
                    <span className="font-semibold text-[var(--color-shell-text)]">
                      {booking.payment.status === 'VERIFIED' ? 'Verified' :
                       booking.payment.status === 'REJECTED' ? 'Rejected' :
                       'Pending Verification'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-xs space-y-3 text-xs text-[var(--color-shell-text-muted)]">
              <h3 className="text-sm font-bold text-[var(--color-shell-text)] border-b border-[var(--color-shell-border)] pb-2">
                Cancellation & Rescheduling
              </h3>

              {canCancelNormally ? (
                <>
                  <div className="flex items-start gap-2 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 p-3 rounded-lg border border-emerald-200 dark:border-emerald-800/50">
                    <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-emerald-900 dark:text-emerald-100">Normal cancellation & rescheduling available</p>
                      <p className="text-[11px] text-emerald-700 dark:text-emerald-300 mt-0.5">
                        You can cancel or reschedule this session until <strong>{APP_CONFIG.NORMAL_CANCELLATION_WINDOW_MINUTES} minutes before start</strong>.
                      </p>
                      <p className="text-[11px] text-emerald-700 dark:text-emerald-300 mt-1">
                        Session starts: <strong>{new Date(booking.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong> ·{' '}
                        Cancellation closes: <strong>{cancellationDeadline?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
                      </p>
                    </div>
                  </div>

                  <div className="pt-2 flex flex-col gap-2">
                    <Button
                      onClick={() => setShowCancelModal(true)}
                      variant="destructive"
                      size="sm"
                      className="w-full text-xs font-medium gap-1.5"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Cancel Booking</span>
                    </Button>
                    <Button
                      onClick={handleReschedule}
                      variant="outline"
                      size="sm"
                      className="w-full text-xs font-medium gap-1.5"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Reschedule Session</span>
                    </Button>
                  </div>
                </>
              ) : canCancelOrReschedule ? (
                <>
                  <div className="flex items-start gap-2 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-200 dark:border-amber-800/50">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-amber-900 dark:text-amber-100">Cancellation & rescheduling window closed</p>
                      <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
                        This session starts in <strong>{minutesUntilStart} minutes</strong>. Normal seeker cancellation/rescheduling is only available until <strong>{APP_CONFIG.NORMAL_CANCELLATION_WINDOW_MINUTES} minutes before start</strong>.
                      </p>
                      <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1">
                        For emergency changes within {APP_CONFIG.NORMAL_CANCELLATION_WINDOW_MINUTES} minutes, contact platform administration.
                      </p>
                    </div>
                  </div>

                  <div className="pt-2 flex flex-col gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="w-full text-xs font-medium gap-1.5 cursor-not-allowed opacity-50"
                      disabled
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Cancel Booking (Window Closed)</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs font-medium gap-1.5 cursor-not-allowed opacity-50"
                      disabled
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Reschedule Session (Window Closed)</span>
                    </Button>
                  </div>
                </>
              ) : isConfirmed ? (
                <>
                  <div className="flex items-start gap-2 text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700">
                    <Info className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-zinc-900 dark:text-zinc-100">Session confirmed — cancellation not available</p>
                      <p className="text-[11px] text-zinc-600 dark:text-zinc-400 mt-0.5">
                        This session is confirmed with a meeting link. Normal seeker cancellation is no longer available.
                      </p>
                      <p className="text-[11px] text-zinc-600 dark:text-zinc-400 mt-1">
                        For exceptional circumstances, contact platform administration.
                      </p>
                    </div>
                  </div>

                  <div className="pt-2 flex flex-col gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="w-full text-xs font-medium gap-1.5 cursor-not-allowed opacity-50"
                      disabled
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Cancel Booking (Not Available)</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs font-medium gap-1.5 cursor-not-allowed opacity-50"
                      disabled
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Reschedule Session (Not Available)</span>
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-start gap-2 text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700">
                    <Info className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                        {isMentorPending
                          ? 'Cancellation available after mentor confirms'
                          : isPendingVerification
                          ? 'Cancellation available after payment verification'
                          : isPaymentPending
                          ? 'Complete payment first'
                          : 'Cancellation not available for this status'}
                      </p>
                      <p className="text-[11px] text-zinc-600 dark:text-zinc-400 mt-0.5">
                        {isMentorPending
                          ? 'Once the mentor confirms and the session is more than 10 minutes away, you can cancel or reschedule.'
                          : isPendingVerification
                          ? 'Once admin verifies your payment and the mentor confirms, you can cancel or reschedule if the session is more than 10 minutes away.'
                          : isPaymentPending
                          ? 'Complete payment within the 15-minute window to proceed.'
                          : 'This booking is in a final state.'}
                      </p>
                    </div>
                  </div>

                  <div className="pt-2 flex flex-col gap-2">
                    {isPaymentPending && (
                      <Button
                        onClick={() => navigate(`/seeker/payment?bookingId=${booking.id}`)}
                        size="sm"
                        className="w-full text-xs font-semibold gap-1.5 bg-amber-600 hover:bg-amber-700 text-white shadow-xs"
                      >
                        <CreditCard className="h-3.5 w-3.5" />
                        <span>Complete Payment</span>
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}

      <div
        className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 ${showCancelModal ? 'block' : 'hidden'}`}
        onClick={() => setShowCancelModal(false)}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-modal-title"
      >
        <div
          className="w-full max-w-md rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-xl space-y-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            <h2 id="cancel-modal-title" className="text-lg font-bold text-[var(--color-shell-text)]">Cancel Booking</h2>
            <button
              onClick={() => setShowCancelModal(false)}
              className="p-1 text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)] rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              aria-label="Close"
            >
              <XCircle className="h-5 w-5" />
            </button>
          </div>

          {booking && (
            <>
              <p className="text-sm text-[var(--color-shell-text-muted)]">
                Are you sure you want to cancel <strong>Booking #{booking.booking_code}</strong>?
              </p>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-[var(--color-shell-text)]">Reason (optional)</label>
                <textarea
                  value={cancellationReason}
                  onChange={(e) => setCancellationReason(e.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-3 text-sm text-[var(--color-shell-text)] placeholder:text-[var(--color-shell-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-shell-accent)] focus:border-transparent resize-none"
                  placeholder="e.g., Schedule conflict, no longer needed, etc."
                  maxLength={500}
                />
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <Button
                  onClick={() => setShowCancelModal(false)}
                  variant="outline"
                  className="flex-1"
                >
                  Keep Booking
                </Button>
                <Button
                  onClick={handleCancel}
                  variant="destructive"
                  isLoading={cancelling}
                  loadingText="Cancelling..."
                  className="flex-1"
                >
                  Cancel Booking
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

import { CreditCard } from 'lucide-react';

export default SeekerBookingDetailPage;