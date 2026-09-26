import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, Clock, Video, FileText, AlertTriangle, CheckCheck, CreditCard, RotateCcw, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import { toUserMessage } from '@/src/lib/errorMessages';
import { fetchSeekerBookings, EnrichedBookingRecord } from '@/src/lib/bookingService';
import { usePaymentSync } from '@/src/hooks/seeker/usePaymentSync';
import type { BookingStatus, Payment } from '@/src/types/database';
import { APP_CONFIG } from '@/src/config/app';

/**
 * Maps a stored payment status to the label My Bookings shows.
 *
 * The label is derived from the `payments` row only. It never depends on
 * whether the user happened to open the payment page, so a refresh or an
 * admin decision always yields the true state.
 */
const paymentStateLabel = (payment: Payment | null | undefined): string | null => {
  if (!payment) return null;
  switch (payment.status) {
    case 'VERIFIED':
      return 'Payment verified';
    case 'REJECTED':
      return 'Payment action required';
    default:
      return 'Payment pending verification';
  }
};

const paymentStateTone = (payment: Payment | null | undefined): string => {
  if (!payment) return '';
  switch (payment.status) {
    case 'VERIFIED':
      return 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-200 dark:border-emerald-800/50';
    case 'REJECTED':
      return 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-900/20 dark:text-rose-200 dark:border-rose-800/50';
    default:
      return 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-900/20 dark:text-sky-200 dark:border-sky-800/50';
  }
};

const getStatusDisplay = (status: BookingStatus): { label: string; variant: 'success' | 'warning' | 'secondary' | 'destructive' | 'outline' } => {
  switch (status) {
    case 'CONFIRMED': return { label: 'Confirmed', variant: 'success' };
    case 'MENTOR_PENDING': return { label: 'Waiting for Mentor', variant: 'warning' };
    case 'PENDING_VERIFICATION': return { label: 'Verification Pending', variant: 'secondary' };
    case 'PAYMENT_PENDING': return { label: 'Payment Required', variant: 'warning' };
    case 'COMPLETED': return { label: 'Completed', variant: 'secondary' };
    case 'CANCELLED': return { label: 'Cancelled', variant: 'destructive' };
    case 'REJECTED': return { label: 'Rejected', variant: 'destructive' };
    default: return { label: status, variant: 'outline' };
  }
};


export const SeekerBookingsPage: React.FC = () => {
  const { navigate } = useNavigation();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'upcoming' | 'history' | 'cancelled'>('upcoming');
  const [bookings, setBookings] = useState<EnrichedBookingRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const seekerId = user?.id;

  // A silent refetch used by the payment sync: it must not blank the list or
  // raise the skeleton, otherwise an admin's approval would make the whole
  // page flash while the seeker is reading it.
  const refreshBookings = useCallback(async () => {
    if (!seekerId) return;
    try {
      const data = await fetchSeekerBookings(seekerId);
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
    if (activeTab === 'upcoming') {
      return ['PAYMENT_PENDING', 'PENDING_VERIFICATION', 'MENTOR_PENDING', 'CONFIRMED'].includes(b.status);
    }
    if (activeTab === 'history') {
      return b.status === 'COMPLETED';
    }
    if (activeTab === 'cancelled') {
      return b.status === 'CANCELLED' || b.status === 'REJECTED';
    }
    return false;
  });

  const upcomingCount = bookings.filter((b) =>
    ['PAYMENT_PENDING', 'PENDING_VERIFICATION', 'MENTOR_PENDING', 'CONFIRMED'].includes(b.status)
  ).length;
  const cancelledCount = bookings.filter((b) => b.status === 'CANCELLED' || b.status === 'REJECTED').length;

  const getBookingStatusBadge = (status: BookingStatus) => {
    const display = getStatusDisplay(status);
    return <Badge variant={display.variant} className="text-[10px] font-bold">{display.label}</Badge>;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.23, 1, 0.31, 1] }}
      className="space-y-6"
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-shell-text)] sm:text-3xl font-display">
          My Bookings
        </h1>
        <p className="mt-1 text-sm text-[var(--color-shell-text-muted)]">
          View active sessions, countdown timers, historical notes, and session workspaces.
        </p>
      </div>

      <div
        className="flex border-b border-[var(--color-shell-border)] gap-6 text-xs sm:text-sm font-semibold"
        role="tablist"
        aria-label="Booking tabs"
      >
        {(
          [
            { id: 'upcoming', label: 'Upcoming' },
            { id: 'history', label: 'History' },
            { id: 'cancelled', label: 'Cancelled' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`pb-3 capitalize transition-all cursor-pointer relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-accent)] rounded-xs ${
              activeTab === tab.id
                ? 'text-[var(--color-shell-text)] font-bold border-amber-600 border-b-2'
                : 'text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)]'
            }`}
          >
            <span>{tab.label}</span>
            {tab.id === 'upcoming' && upcomingCount > 0 && activeTab !== 'upcoming' && (
              <Badge className="ml-1.5 text-[10px] bg-zinc-100 dark:bg-zinc-800 text-[var(--color-shell-text-muted)]">
                {upcomingCount}
              </Badge>
            )}
            {tab.id === 'cancelled' && cancelledCount > 0 && activeTab !== 'cancelled' && (
              <Badge className="ml-1.5 text-[10px] bg-zinc-100 dark:bg-zinc-800 text-[var(--color-shell-text-muted)]">
                {cancelledCount}
              </Badge>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 flex flex-col justify-center items-center text-[var(--color-shell-text-subtle)] text-xs gap-2">
          <Calendar className="h-6 w-6 animate-spin text-[var(--color-shell-text-muted)]" />
          <span>Synchronizing bookings with real database...</span>
        </div>
      ) : error ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-[var(--color-shell-error)]/30 bg-[var(--color-shell-error-soft)] p-4 text-xs text-[var(--color-shell-text)] flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[var(--color-shell-error)] shrink-0" />
            <span>{error}</span>
          </div>
          <Button size="sm" variant="outline" onClick={loadBookings}>
            Retry
          </Button>
        </motion.div>
      ) : filteredBookings.length === 0 ? (
        <EmptyState
          icon={Calendar}
          title={`No ${activeTab} Bookings`}
          description="Bookings will reflect your authoritative database records. T-5 minute session unlock countdown will activate upon confirmation."
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
              const minutesUntilStart = Math.max(0, Math.floor((new Date(booking.start_time).getTime() - Date.now()) / (1000 * 60)));
              const canCancelNormally = minutesUntilStart >= APP_CONFIG.NORMAL_CANCELLATION_WINDOW_MINUTES &&
                ['PAYMENT_PENDING', 'PENDING_VERIFICATION', 'MENTOR_PENDING', 'CONFIRMED'].includes(booking.status);
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
                    {booking.status === 'CONFIRMED' && (
                      <span className="text-xs font-semibold text-[var(--color-shell-warning)] bg-[var(--color-shell-warning-soft)] border border-[var(--color-shell-warning)]/20 px-2.5 py-1 rounded-full">
                        Meeting unlocks at T-5 minutes
                      </span>
                    )}
                    {paymentStateLabel(booking.payment) && (
                      <span
                        className={`inline-flex items-center gap-1.5 text-[11px] font-semibold border px-2.5 py-1 rounded-full ${paymentStateTone(booking.payment)}`}
                      >
                        <CreditCard className="h-3 w-3" aria-hidden="true" />
                        {paymentStateLabel(booking.payment)}
                      </span>
                    )}
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
                          {new Date(booking.start_time).toLocaleDateString('en-IN', {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </span>
                        <span>·</span>
                        <span className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-[var(--color-shell-text-subtle)]" />
                          {new Date(booking.start_time).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}{' '}
                          –{' '}
                          {new Date(booking.end_time).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}{' '}
                          (IST)
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5">
                      {(booking.status === 'PAYMENT_PENDING' || booking.status === 'PENDING_VERIFICATION') && (
                        <Button
                          onClick={() => navigate(`/seeker/payment?bookingId=${booking.id}`)}
                          size="sm"
                          className="gap-1.5 text-xs bg-amber-600 hover:bg-amber-700 text-white font-semibold shadow-xs"
                        >
                          <CreditCard className="h-3.5 w-3.5" />
                          <span>
                            {booking.status === 'PAYMENT_PENDING' ? 'Pay now' : 'View payment status'}
                          </span>
                        </Button>
                      )}
                      <Button
                        onClick={() =>
                          navigate(`/seeker/booking-detail?bookingId=${booking.id}`)
                        }
                        variant="outline"
                        size="sm"
                        className="text-xs font-medium"
                      >
                        Booking Details
                      </Button>
                      {canCancelNormally && (
                        <Button
                          onClick={() => navigate(`/seeker/booking-detail?bookingId=${booking.id}`)}
                          variant="outline"
                          size="sm"
                          className="text-xs font-medium gap-1.5 text-[var(--color-shell-error)] border-[var(--color-shell-error)] hover:bg-[var(--color-shell-error-soft)]"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>Cancel</span>
                        </Button>
                      )}
                      {booking.status === 'CONFIRMED' && (
                        <Button
                          onClick={() => navigate(`/seeker/session?bookingId=${booking.id}`)}
                          size="sm"
                          className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-xs"
                        >
                          <Video className="h-3.5 w-3.5" />
                          <span>Join Session Room</span>
                        </Button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}

          {activeTab === 'history' &&
            filteredBookings.map((booking) => (
              <motion.div
                key={booking.id}
                variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
                className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-xs space-y-4 hover:border-[var(--color-shell-border-strong)] transition-all"
              >
                <div className="flex items-center justify-between border-b border-[var(--color-shell-border)] pb-3">
                  <div className="flex items-center gap-2">
                    {getBookingStatusBadge(booking.status)}
                    <span className="text-xs text-[var(--color-shell-text-subtle)] font-mono">
                      {new Date(booking.start_time).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                  <span className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1">
                    <FileText className="h-3.5 w-3.5" /> Workspace Notes Available
                  </span>
                </div>

                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-bold text-[var(--color-shell-text)]">
                      {booking.gig?.title || '1:1 Guidance Session'}
                    </h2>
                    <p className="text-xs text-[var(--color-shell-text-muted)] mt-0.5">
                      Mentor: {booking.mentor?.full_name || 'Mentor'} ·{' '}
                      {booking.segment?.name || 'N/A'}
                    </p>
                  </div>
                  <Button
                    onClick={() => navigate('/seeker/workspace')}
                    size="sm"
                    className="gap-1.5 text-xs font-semibold"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    <span>Open Session Workspace</span>
                  </Button>
                </div>
              </motion.div>
            ))}

          {activeTab === 'cancelled' &&
            filteredBookings.map((booking) => (
              <motion.div
                key={booking.id}
                variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
                className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-xs space-y-2"
              >
                <div className="flex items-center justify-between">
                  {getBookingStatusBadge(booking.status)}
                  <span className="text-xs text-[var(--color-shell-text-subtle)] font-medium">
                    {booking.cancellation_reason || 'Cancelled'}
                  </span>
                </div>
                <h2 className="text-sm font-bold text-[var(--color-shell-text)]">
                  {booking.gig?.title || '1:1 Guidance Session'}
                </h2>
                <p className="text-xs text-[var(--color-shell-text-muted)]">
                  Normal cancellation policy: Permitted ≥{APP_CONFIG.NORMAL_CANCELLATION_WINDOW_MINUTES} minutes before start.
                </p>
              </motion.div>
            ))}
        </motion.div>
      )}
    </motion.div>
  );
};

export default SeekerBookingsPage;
