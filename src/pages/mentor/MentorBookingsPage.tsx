import React, { useState, useEffect } from 'react';
import { Calendar, Clock, Video, FileText, CheckCircle2, AlertCircle, AlertTriangle, ChevronRight, ShieldCheck, Loader2 } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import { fetchMentorBookings, EnrichedBookingRecord } from '@/src/lib/bookingService';

export const MentorBookingsPage: React.FC = () => {
  const { navigate } = useNavigation();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'pending' | 'upcoming' | 'completed' | 'cancelled'>('pending');
  const [bookings, setBookings] = useState<EnrichedBookingRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const mentorId = user?.id;

  const loadData = async () => {
    if (!mentorId) return;
    setLoading(true);
    try {
      const data = await fetchMentorBookings(mentorId);
      setBookings(data);
    } catch (err) {
      console.error('Failed to load mentor bookings:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [mentorId]);

  // Tab filtering
  const pendingBookings = bookings.filter((b) => b.status === 'MENTOR_PENDING');
  const upcomingBookings = bookings.filter((b) => b.status === 'CONFIRMED');
  const completedBookings = bookings.filter((b) => b.status === 'COMPLETED');
  const cancelledBookings = bookings.filter((b) => b.status === 'CANCELLED');

  const getFilteredBookings = () => {
    switch (activeTab) {
      case 'pending':
        return pendingBookings;
      case 'upcoming':
        return upcomingBookings;
      case 'completed':
        return completedBookings;
      case 'cancelled':
        return cancelledBookings;
      default:
        return [];
    }
  };

  const currentList = getFilteredBookings();

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">
            Mentor Bookings
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Confirm pending sessions, provide secure HTTPS meeting links, and manage upcoming schedules.
          </p>
        </div>

        <Button
          onClick={loadData}
          variant="outline"
          size="sm"
          className="text-xs self-start"
          disabled={loading}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
          Refresh Ledger
        </Button>
      </div>

      {/* Overdue alert banner if any pending bookings are overdue */}
      {pendingBookings.some((b) => b.deadlineInfo?.isOverdue) && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex items-start gap-3 text-xs text-amber-900">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-bold block text-sm">Action Required: Overdue Meeting Links</span>
            <p>
              You have session(s) scheduled in less than 2 hours without a confirmed meeting link. Missing the recommended deadline does not cancel the session, but prompt submission ensures seeker readiness.
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-zinc-200 gap-8 text-sm font-medium overflow-x-auto">
        {[
          { id: 'pending', label: 'Pending Confirmation', count: pendingBookings.length },
          { id: 'upcoming', label: 'Upcoming (Confirmed)', count: upcomingBookings.length },
          { id: 'completed', label: 'Completed (Workspaces)', count: completedBookings.length },
          { id: 'cancelled', label: 'Cancelled', count: cancelledBookings.length },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`pb-3 capitalize transition-colors whitespace-nowrap cursor-pointer flex items-center gap-2 ${
              activeTab === tab.id
                ? 'border-b-2 border-zinc-900 text-zinc-950 font-bold'
                : 'text-zinc-500 hover:text-zinc-800'
            }`}
          >
            <span>{tab.label}</span>
            {tab.count > 0 && (
              <span
                className={`px-1.5 py-0.5 text-[11px] rounded-full font-semibold ${
                  activeTab === tab.id
                    ? tab.id === 'pending'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-zinc-900 text-white'
                    : 'bg-zinc-100 text-zinc-600'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="space-y-4">
        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center text-zinc-400 gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-zinc-600" />
            <span className="text-xs">Loading booking ledger...</span>
          </div>
        ) : currentList.length === 0 ? (
          <EmptyState
            title={
              activeTab === 'pending'
                ? 'No Pending Confirmations'
                : activeTab === 'upcoming'
                ? 'No Confirmed Upcoming Sessions'
                : activeTab === 'completed'
                ? 'No Completed Sessions Yet'
                : 'No Cancelled Sessions'
            }
            description={
              activeTab === 'pending'
                ? 'All caught up! New bookings verified by Admin will arrive here for you to provide the meeting link.'
                : 'Upcoming confirmed bookings will appear here once you attach a valid HTTPS meeting link.'
            }
            actionLabel={activeTab === 'pending' ? 'View Availability' : undefined}
            onAction={activeTab === 'pending' ? () => navigate('/mentor/availability') : undefined}
          />
        ) : (
          currentList.map((booking) => {
            const isPending = booking.status === 'MENTOR_PENDING';
            const isConfirmed = booking.status === 'CONFIRMED';
            const isOverdue = booking.deadlineInfo?.isOverdue;
            const hoursLeft = booking.deadlineInfo?.hoursUntilSession;

            return (
              <div
                key={booking.id}
                className={`rounded-xl border bg-white p-6 shadow-xs space-y-4 transition-all ${
                  isPending
                    ? isOverdue
                      ? 'border-amber-400 bg-amber-50/20'
                      : 'border-amber-200'
                    : 'border-zinc-200'
                }`}
              >
                {/* Header status bar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-100 pb-3">
                  <div className="flex items-center gap-2">
                    <Badge variant={isPending ? 'warning' : isConfirmed ? 'success' : 'secondary'}>
                      {booking.status}
                    </Badge>
                    <span className="text-xs font-mono font-bold text-zinc-600">
                      #{booking.booking_code}
                    </span>
                    {booking.payment && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        <ShieldCheck className="h-3 w-3" />
                        Payment Verified (₹{booking.amount_inr})
                      </span>
                    )}
                  </div>

                  {/* Deadline & Warning Indicators */}
                  {isPending && (
                    <div className="flex items-center gap-2">
                      {isOverdue ? (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-800 bg-amber-100 px-2.5 py-1 rounded-md border border-amber-300">
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-700" />
                          OVERDUE LINK (&lt;2h until session)
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-zinc-500">
                          Recommended link deadline: 2h before session
                          {hoursLeft !== undefined && hoursLeft > 0 ? ` (~${hoursLeft}h left)` : ''}
                        </span>
                      )}
                    </div>
                  )}

                  {isConfirmed && booking.meeting_url && (
                    <span className="text-xs font-medium text-emerald-700 flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      HTTPS Meeting Link Attached
                    </span>
                  )}
                </div>

                {/* Booking Body */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2.5">
                      <div className="h-9 w-9 rounded-full bg-zinc-100 font-bold text-zinc-800 text-xs flex items-center justify-center border border-zinc-200 shrink-0">
                        {booking.seeker?.full_name
                          ? booking.seeker.full_name
                              .split(' ')
                              .map((n) => n[0])
                              .join('')
                              .substring(0, 2)
                              .toUpperCase()
                          : 'SK'}
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-zinc-950">
                          {booking.seeker?.full_name || 'Seeker Client'}
                        </h3>
                        <p className="text-xs text-zinc-500">
                          {booking.segment?.name || 'Segment'} · {booking.gig?.title || 'Session'}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-700 pt-1">
                      <span className="flex items-center gap-1 font-medium">
                        <Clock className="h-3.5 w-3.5 text-zinc-400" />
                        {formatSessionTime(booking.start_time, booking.end_time, booking.mentor_timezone)}
                      </span>
                    </div>

                    {booking.meeting_url && (
                      <div className="text-xs text-zinc-600 pt-1 font-mono break-all">
                        <span className="text-zinc-400 select-none">Meeting Link: </span>
                        <a
                          href={booking.meeting_url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-zinc-900 underline hover:text-zinc-600"
                        >
                          {booking.meeting_url}
                        </a>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {isPending ? (
                      <Button
                        onClick={() => navigate(`/mentor/booking-detail?bookingId=${booking.id}`)}
                        size="sm"
                        className="gap-1.5 text-xs bg-zinc-900 text-white hover:bg-zinc-800 shadow-xs"
                      >
                        <Video className="h-3.5 w-3.5" />
                        <span>Add Meeting Link & Confirm</span>
                      </Button>
                    ) : isConfirmed ? (
                      <Button
                        onClick={() => navigate(`/mentor/booking-detail?bookingId=${booking.id}`)}
                        variant="outline"
                        size="sm"
                        className="text-xs gap-1"
                      >
                        <span>View / Edit Details</span>
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <Button
                        onClick={() => navigate(`/mentor/workspace?bookingId=${booking.id}`)}
                        size="sm"
                        variant="outline"
                        className="gap-1.5 text-xs"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        <span>Workspace Notes</span>
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
