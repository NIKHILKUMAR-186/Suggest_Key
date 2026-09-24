import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, Clock, Video, FileText, AlertTriangle, CheckCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import { fetchSeekerBookings, EnrichedBookingRecord } from '@/src/lib/bookingService';
import { BookingStatus } from '@/src/types/database';

export const SeekerBookingsPage: React.FC = () => {
  const { navigate } = useNavigation();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'upcoming' | 'history' | 'cancelled'>('upcoming');
  const [bookings, setBookings] = useState<EnrichedBookingRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const seekerId = user?.id;

  const loadBookings = useCallback(async () => {
    if (!seekerId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSeekerBookings(seekerId);
      setBookings(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load bookings.');
    } finally {
      setLoading(false);
    }
  }, [seekerId]);

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
    switch (status) {
      case 'CONFIRMED':
        return <Badge variant="success" className="text-[10px] font-bold">CONFIRMED</Badge>;
      case 'MENTOR_PENDING':
        return <Badge variant="warning" className="text-[10px] font-bold">MENTOR_PENDING</Badge>;
      case 'PAYMENT_PENDING':
      case 'PENDING_VERIFICATION':
        return <Badge variant="secondary" className="text-[10px] font-bold">VERIFICATION</Badge>;
      case 'COMPLETED':
        return <Badge variant="secondary" className="text-[10px] font-bold">COMPLETED</Badge>;
      case 'CANCELLED':
        return <Badge variant="destructive" className="text-[10px] font-bold">CANCELLED</Badge>;
      case 'REJECTED':
        return <Badge variant="destructive" className="text-[10px] font-bold">REJECTED</Badge>;
      default:
        return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
    }
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
              <Badge className="ml-1.5 text-[10px] bg-zinc-100 text-[var(--color-shell-text-muted)]">
                {upcomingCount}
              </Badge>
            )}
            {tab.id === 'cancelled' && cancelledCount > 0 && activeTab !== 'cancelled' && (
              <Badge className="ml-1.5 text-[10px] bg-zinc-100 text-[var(--color-shell-text-muted)]">
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
            filteredBookings.map((booking) => (
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

                  <div className="flex items-center gap-2.5">
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
            ))}

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
                  <span className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
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
                  Normal cancellation policy: Permitted ≥24 hours before start.
                </p>
              </motion.div>
            ))}
        </motion.div>
      )}
    </motion.div>
  );
};

export default SeekerBookingsPage;
