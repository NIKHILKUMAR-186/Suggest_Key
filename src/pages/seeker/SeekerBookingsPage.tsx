import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Calendar, Clock, Video, FileText, AlertTriangle, CreditCard, Trash2, Timer, Lock, ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@/src/components/ui/Button';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { PageHeading } from '@/src/components/booking/PageHeading';
import { StatusPill } from '@/src/components/booking/StatusPill';
import { InlineNotice } from '@/src/components/booking/StatePanel';
import { describeBookingStatus, describePaymentStatus } from '@/src/components/booking/statusTone';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import { toUserMessage } from '@/src/lib/errorMessages';
import { fetchSeekerBookings, EnrichedBookingRecord } from '@/src/lib/bookingService';
import { usePaymentSync } from '@/src/hooks/seeker/usePaymentSync';
import {
  isBookingUpcoming,
  isAccessGranted,
  resolveSessionLifecycle,
  formatSessionDate,
  formatClockTime,
  formatZoneLabel,
  sessionDurationMinutes,
  type SessionLifecycleState,
} from '@/src/lib/sessionState';
import type { BookingStatus, Payment } from '@/src/types/database';
import { APP_CONFIG } from '@/src/config/app';

/**
 * The label My Bookings shows for a payment.
 *
 * The wording comes from the shared status vocabulary, so the same `REJECTED`
 * payment reads identically here, on the payment page and on the booking detail
 * page. It is derived from the `payments` row only, so it never depends on
 * whether the seeker happened to open the payment page: a refresh or an admin
 * decision always yields the true state.
 */
const paymentStateLabel = (payment: Payment | null | undefined): string | null =>
  payment ? describePaymentStatus(payment.status).label : null;
export const SeekerBookingsPage: React.FC = () => {
  const { navigate } = useNavigation();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'upcoming' | 'history' | 'cancelled'>('upcoming');
  const [bookings, setBookings] = useState<EnrichedBookingRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const seekerId = user?.id;

  // Authoritative server clock. The list endpoint reconciles expired CONFIRMED
  // rows to COMPLETED and attaches `isUpcoming` / `sessionState` to every
  // booking, so grouping never reads `status` alone. The server clock is only
  // consulted by the isBookingUpcoming fallback when those server fields are
  // absent (older cached shape / dev fixture).
  const serverNowMsRef = useRef<number | null>(null);
  const serverNowMs = (): number => serverNowMsRef.current ?? Date.now();

  const resolveUpcoming = (b: EnrichedBookingRecord): boolean => {
    const server = (b as EnrichedBookingRecord & { isUpcoming?: boolean }).isUpcoming;
    if (typeof server === 'boolean') return server;
    return isBookingUpcoming(b, serverNowMs());
  };

  const resolveLifecycle = (b: EnrichedBookingRecord): SessionLifecycleState => {
    const inline = (b as EnrichedBookingRecord & { sessionState?: SessionLifecycleState }).sessionState;
    if (inline !== undefined && inline !== null) return inline;
    return resolveSessionLifecycle(b, serverNowMs());
  };

  const isCancelledBooking = (b: EnrichedBookingRecord): boolean =>
    b.status === 'CANCELLED' || b.status === 'REJECTED';

  // A silent refetch used by the payment sync: it must not blank the list or
  // raise the skeleton, otherwise an admin's approval would make the whole
  // page flash while the seeker is reading it.
  const refreshBookings = useCallback(async () => {
    if (!seekerId) return;
    try {
      const data = await fetchSeekerBookings(seekerId);
      if (serverNowMsRef.current === null) serverNowMsRef.current = Date.now();
      setBookings(data);
      setError(null);
    } catch {
      // Keep the previously rendered data rather than replacing a working list
      // with an error because a background refresh failed.
    }
  }, [seekerId]);

  const loadBookings = useCallback(async () => {
    if (!seekerId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSeekerBookings(seekerId);
      if (serverNowMsRef.current === null) serverNowMsRef.current = Date.now();
      setBookings(data);
    } catch (err: any) {
      setError(toUserMessage(err, 'Failed to load bookings.'));
    } finally {
      setLoading(false);
    }
  }, [seekerId]);

  // Reflects an admin's approve/reject decision without a manual reload.
  usePaymentSync({ seekerId, onInvalidate: refreshBookings });

  useEffect(() => {
    loadBookings();
  }, [loadBookings]);

  const filteredBookings = bookings.filter((b) => {
    if (activeTab === 'cancelled') return isCancelledBooking(b);
    if (activeTab === 'history') return !isCancelledBooking(b) && !resolveUpcoming(b);
    return !isCancelledBooking(b) && resolveUpcoming(b);
  });

  const upcomingCount = bookings.filter((b) => !isCancelledBooking(b) && resolveUpcoming(b)).length;
  const cancelledCount = bookings.filter(isCancelledBooking).length;

  const getBookingStatusBadge = (status: BookingStatus) => {
    const descriptor = describeBookingStatus(status);
    return <StatusPill tone={descriptor.tone} label={descriptor.label} />;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.23, 1, 0.31, 1] }}
      className="space-y-6"
    >
      <PageHeading
        title="My Bookings"
        description="Active sessions, upcoming countdowns, past notes and session workspaces."
      />

      <div
        className="flex overflow-x-auto border-b border-[var(--color-shell-border)] text-xs sm:text-sm sm:gap-6"
        role="tablist"
        aria-label="Booking tabs"
      >
        {(
          [
            { id: 'upcoming', label: 'Upcoming', count: upcomingCount },
            { id: 'history', label: 'History', count: 0 },
            { id: 'cancelled', label: 'Cancelled', count: cancelledCount },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`relative flex shrink-0 cursor-pointer items-center gap-2 border-b-2 px-1 pb-3 font-semibold capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] sm:px-0 ${
              activeTab === tab.id
                ? 'border-[var(--segment-accent)] text-[var(--color-shell-text)]'
                : 'border-transparent text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)]'
            }`}
          >
            <span>{tab.label}</span>
            {tab.count > 0 && activeTab !== tab.id && (
              <StatusPill tone="neutral" label={String(tab.count)} className="tabular-nums" />
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col items-center justify-center gap-2 py-16 text-xs text-[var(--color-shell-text-subtle)]"
        >
          <Calendar className="h-6 w-6 animate-spin text-[var(--color-shell-text-muted)] motion-reduce:animate-none" aria-hidden="true" />
          <span>Synchronizing bookings with real database...</span>
        </div>
      ) : error ? (
        <InlineNotice
          tone="danger"
          role="alert"
          icon={AlertTriangle}
          title="Could not load your bookings"
          actions={
            <Button size="sm" variant="outline" onClick={loadBookings}>
              Retry
            </Button>
          }
        >
          {error}
        </InlineNotice>
      ) : filteredBookings.length === 0 ? (
        <EmptyState
          icon={Calendar}
          title={`No ${activeTab} Bookings`}
          description="Bookings will reflect your authoritative database records. Meeting access opens 5 minutes before a confirmed session."
          actionLabel="Find Mentors"
          onAction={() => navigate('/seeker')}
        />
      ) : (
        <motion.div
          initial="hidden"
          animate="show"
          variants={{
            hidden: { opacity: 0 },
            show: { opacity: 1, transition: { staggerChildren: 0.05 } },
          }}
          className="space-y-4"
        >
          {activeTab === 'upcoming' &&
            filteredBookings.map((booking) => {
              const minutesUntilStart = Math.max(0, Math.floor((new Date(booking.start_time).getTime() - serverNowMs()) / (1000 * 60)));
              const canCancelNormally = minutesUntilStart >= APP_CONFIG.NORMAL_CANCELLATION_WINDOW_MINUTES &&
                ['PAYMENT_PENDING', 'PENDING_VERIFICATION', 'MENTOR_PENDING', 'CONFIRMED'].includes(booking.status);
              const sessionState = resolveLifecycle(booking);
              const canJoinNow = isAccessGranted(sessionState);
              return (
                <motion.div
                  key={booking.id}
                  variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
                  className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-xs space-y-4 hover:border-[var(--color-shell-border-strong)] transition-all"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--color-shell-border)] pb-3">
                    <div className="flex items-center gap-2">
                      {getBookingStatusBadge(booking.status)}
                      <span className="text-xs text-[var(--color-shell-text-subtle)] font-mono">
                        Booking #{booking.booking_code}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {booking.status === 'CONFIRMED' && !canJoinNow && (
                        <StatusPill
                          tone="neutral"
                          label="Meeting unlocks at T-5 minutes"
                        />
                      )}
                      {paymentStateLabel(booking.payment) && (
                        <StatusPill
                          tone={describePaymentStatus(booking.payment!.status).tone}
                          label={paymentStateLabel(booking.payment)!}
                        />
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <h2 className="text-base font-bold text-[var(--color-shell-text)]">
                        {booking.gig?.title || '1:1 Guidance Session'}
                      </h2>
                      <p className="text-xs text-[var(--color-shell-text-muted)] mt-0.5">
                        Mentor: {booking.mentor?.full_name || 'Mentor'} · Segment:{' '}
                        {booking.segment?.name || 'N/A'}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-[var(--color-shell-text-muted)] mt-2 font-medium flex-wrap">
                        <span className="flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5 text-[var(--color-shell-text-subtle)]" />
                          {formatSessionDate(booking.start_time, booking.seeker_timezone)}
                        </span>
                        <span>·</span>
                        <span className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-[var(--color-shell-text-subtle)]" />
                          {formatClockTime(booking.start_time, booking.seeker_timezone)} – {formatClockTime(booking.end_time, booking.seeker_timezone)}{' '}
                          {formatZoneLabel(booking.seeker_timezone)}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5">
                      {(booking.status === 'PAYMENT_PENDING' || booking.status === 'PENDING_VERIFICATION') && (
                        <Button
                          onClick={() => navigate(`/seeker/payment?bookingId=${booking.id}`)}
                          size="sm"
                          className="gap-1.5 text-xs font-semibold shadow-xs"
                        >
                          <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>
                            {booking.status === 'PAYMENT_PENDING' ? 'Pay now' : 'View payment status'}
                          </span>
                        </Button>
                      )}
                      {canJoinNow ? (
                        <Button
                          onClick={() => navigate(`/seeker/session?bookingId=${booking.id}`)}
                          size="sm"
                          className="gap-1.5 text-xs font-semibold shadow-xs"
                        >
                          <Video className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Join Session Room</span>
                        </Button>
                      ) : (
                        <Button
                          onClick={() =>
                            navigate(`/seeker/booking-detail?bookingId=${booking.id}`)
                          }
                          variant="outline"
                          size="sm"
                          className="gap-1.5 text-xs font-medium"
                        >
                          <span>Booking Details</span>
                          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      )}
                      {canCancelNormally && (
                        <Button
                          onClick={() => navigate(`/seeker/booking-detail?bookingId=${booking.id}`)}
                          variant="outline"
                          size="sm"
                          className="gap-1.5 text-xs font-medium text-[var(--color-shell-error)] hover:bg-[var(--color-shell-error-soft)]"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Cancel</span>
                        </Button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}

          {activeTab === 'history' &&
            filteredBookings.map((booking) => {
              const duration = sessionDurationMinutes(booking);
              const durationLabel = duration >= 60
                ? `${Math.floor(duration / 60)}h ${duration % 60}m`
                : `${duration} Minutes`;
              return (
                <motion.div
                  key={booking.id}
                  variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
                  className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-xs space-y-4 hover:border-[var(--color-shell-border-strong)] transition-all"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-shell-border)] pb-3">
                    <div className="flex items-center gap-2">
                      {resolveLifecycle(booking) === 'COMPLETED' ? (
                        <StatusPill tone="neutral" label="Completed" />
                      ) : (
                        getBookingStatusBadge(booking.status)
                      )}
                      <span className="text-xs text-[var(--color-shell-text-subtle)] font-mono">
                        {formatSessionDate(booking.start_time, booking.seeker_timezone)}
                      </span>
                    </div>
                    <StatusPill tone="success" label="Workspace notes available" />
                  </div>

                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <h2 className="text-base font-bold text-[var(--color-shell-text)]">
                        {booking.gig?.title || '1:1 Guidance Session'}
                      </h2>
                      <p className="text-xs text-[var(--color-shell-text-muted)] mt-0.5">
                        Mentor: {booking.mentor?.full_name || 'Mentor'} · Segment:{' '}
                        {booking.segment?.name || 'N/A'}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-[var(--color-shell-text-muted)] mt-2 font-medium flex-wrap">
                        <span className="flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5 text-[var(--color-shell-text-subtle)]" />
                          {formatSessionDate(booking.start_time, booking.seeker_timezone)}
                        </span>
                        <span>·</span>
                        <span className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-[var(--color-shell-text-subtle)]" />
                          {formatClockTime(booking.start_time, booking.seeker_timezone)} – {formatClockTime(booking.end_time, booking.seeker_timezone)}{' '}
                          {formatZoneLabel(booking.seeker_timezone)}
                        </span>
                        <span>·</span>
                        <span className="flex items-center gap-1.5">
                          <Timer className="h-3.5 w-3.5 text-[var(--color-shell-text-subtle)]" />
                          {durationLabel}
                        </span>
                      </div>
                    </div>
                    <Button
                      onClick={() => navigate(`/seeker/workspace?bookingId=${booking.id}`)}
                      size="sm"
                      className="gap-1.5 text-xs font-semibold"
                    >
                      <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Open Session Workspace</span>
                    </Button>
                  </div>
                </motion.div>
              );
            })}

          {activeTab === 'cancelled' &&
            filteredBookings.map((booking) => (
              <motion.div
                key={booking.id}
                variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
                className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-xs space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {getBookingStatusBadge(booking.status)}
                  <span className="text-xs text-[var(--color-shell-text-subtle)] font-medium">
                    {booking.cancellation_reason || 'Cancelled'}
                  </span>
                </div>
                <h2 className="text-sm font-bold text-[var(--color-shell-text)]">
                  {booking.gig?.title || '1:1 Guidance Session'}
                </h2>
                <p className="text-xs text-[var(--color-shell-text-muted)]">
                  {booking.mentor?.full_name || 'Mentor'} ·{' '}
                  {formatSessionDate(booking.start_time, booking.seeker_timezone)}
                </p>
                <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-[var(--color-shell-text-subtle)]">
                  <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>
                    Normal cancellation policy: permitted up to{' '}
                    {APP_CONFIG.NORMAL_CANCELLATION_WINDOW_MINUTES} minutes before the session starts.
                  </span>
                </p>
              </motion.div>
            ))}
        </motion.div>
      )}
    </motion.div>
  );
};

export default SeekerBookingsPage;
