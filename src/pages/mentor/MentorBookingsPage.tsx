import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AlertTriangle, Loader2, Clock } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { MentorBookingCard } from '@/src/components/mentor/MentorBookingCard';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import { fetchMentorBookings, EnrichedBookingRecord } from '@/src/lib/bookingService';
import { MEETING_LINK_DEADLINE_MINUTES } from '@/src/config/app';
import {
  isBookingUpcoming,
  resolveSessionLifecycle,
  secondsUntilAccessOpens,
  secondsUntilSessionEnd,
  formatCountdown,
  type SessionLifecycleState,
} from '@/src/lib/sessionState';

export const MentorBookingsPage: React.FC = () => {
  const { navigate } = useNavigation();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'pending' | 'upcoming' | 'completed' | 'cancelled'>('pending');
  const [bookings, setBookings] = useState<EnrichedBookingRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const mentorId = user?.id;

  // Server clock reference, sampled once when the ledger first arrives. The list
  // endpoint reconciles expired CONFIRMED rows to COMPLETED and attaches
  // `isUpcoming` / `sessionState` to every booking, so grouping prefers those
  // server fields; the sample is only the fallback when they are absent.
  const serverNowMsRef = useRef<number | null>(null);
  const serverNowMs = (): number => serverNowMsRef.current ?? Date.now();

  // Display-only ticking clock so the "Starts in" / "Access opens in" hint and
  // the IN_PROGRESS live indicator advance without a manual refresh. It never
  // drives tab grouping, which is server-authoritative.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const resolveUpcoming = (b: EnrichedBookingRecord): boolean => {
    const server = (b as EnrichedBookingRecord & { isUpcoming?: boolean }).isUpcoming;
    if (typeof server === 'boolean') return server;
    return isBookingUpcoming(b, serverNowMs());
  };

  const resolveLifecycleLive = (b: EnrichedBookingRecord): SessionLifecycleState => {
    const inline = (b as EnrichedBookingRecord & { sessionState?: SessionLifecycleState }).sessionState;
    if (inline !== undefined && inline !== null) return inline;
    return resolveSessionLifecycle(b, nowMs);
  };

  const renderSessionHint = (b: EnrichedBookingRecord): React.ReactNode => {
    const state = resolveLifecycleLive(b);
    if (state === 'IN_PROGRESS') {
      const endsIn = formatCountdown(Math.max(0, Math.ceil(secondsUntilSessionEnd(b, nowMs))));
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-shell-success)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-shell-success)] animate-pulse" />
          ● LIVE · Ends in {endsIn}
        </span>
      );
    }
    if (state === 'SCHEDULED') {
      const opensIn = formatCountdown(Math.max(0, Math.ceil(secondsUntilAccessOpens(b, nowMs))));
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-shell-warning)]">
          <Clock className="h-3 w-3" />
          Access opens in {opensIn}
        </span>
      );
    }
    if (state === 'ACCESS_OPEN') {
      const startMs = new Date(b.start_time).getTime();
      const startsIn = formatCountdown(Math.max(0, Math.ceil((startMs - nowMs) / 1000)));
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-shell-info)]">
          <Clock className="h-3 w-3" />
          Starts in {startsIn}
        </span>
      );
    }
    if (state === 'COMPLETED') {
      return (
        <Badge variant="outline" className="text-xs text-[var(--color-shell-text-muted)] border-[var(--color-shell-border-strong)]">
          Meeting Access Closed
        </Badge>
      );
    }
    return null;
  };

  const loadData = useCallback(async () => {
    if (!mentorId) return;
    setLoading(true);
    setLoadError(null);
    try {
      // No status filter: every tab is derived from the same live booking rows
      // so a booking can never be in one tab and missing from another.
      const data = await fetchMentorBookings(mentorId);
      if (serverNowMsRef.current === null) serverNowMsRef.current = Date.now();
      setBookings(data);
    } catch (err) {
      // A failed load is NOT an empty ledger. Reporting it as "no bookings"
      // would hide a real booking that exists in the database.
      const code = err instanceof Error ? err.message : '';
      setBookings([]);
      setLoadError(
        code === 'AUTH_REQUIRED'
          ? 'Your session has expired. Sign in again to load your bookings.'
          : code === 'FORBIDDEN_NOT_BOOKING_OWNER'
          ? 'This account is not authorised to read mentor bookings.'
          : 'We could not load your bookings from the server. Please refresh and try again.'
      );
      console.error('Failed to load mentor bookings:', err);
    } finally {
      setLoading(false);
    }
  }, [mentorId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Tab filtering. Upcoming/Completed are server-resolved (isUpcoming with the
  // isBookingUpcoming fallback); an expired CONFIRMED row is never "upcoming".
  const pendingBookings = bookings.filter((b) => b.status === 'MENTOR_PENDING');
  const upcomingBookings = bookings.filter((b) => b.status === 'CONFIRMED' && resolveUpcoming(b));
  const completedBookings = bookings.filter(
    (b) => b.status === 'COMPLETED' || (b.status === 'CONFIRMED' && !resolveUpcoming(b))
  );
  const cancelledBookings = bookings.filter((b) => b.status === 'CANCELLED' || b.status === 'REJECTED');

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">
            Mentor Bookings
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Confirm sessions the admin has verified, provide secure HTTPS meeting links, and manage
            upcoming schedules.
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
              You have session(s) starting within {MEETING_LINK_DEADLINE_MINUTES} minutes without a confirmed meeting link. Missing the recommended deadline does not cancel the session, but prompt submission ensures seeker readiness.
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
        ) : loadError ? (
          <div className="rounded-xl border border-rose-300 bg-rose-50 p-5 flex items-start gap-3 text-xs text-rose-900">
            <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="space-y-2">
              <span className="font-bold block text-sm">Bookings could not be loaded</span>
              <p>{loadError}</p>
              <Button onClick={loadData} variant="outline" size="sm" className="text-xs">
                Try again
              </Button>
            </div>
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
                ? 'Sessions appear here once the admin has verified the seeker payment and you still need to attach the meeting link.'
                : activeTab === 'upcoming'
                ? 'Confirmed sessions move here as soon as you attach a valid HTTPS meeting link.'
                : activeTab === 'completed'
                ? 'Sessions you have already delivered will appear here with their workspace notes.'
                : 'Cancelled and rejected sessions are listed here for your records.'
            }
            actionLabel={activeTab === 'pending' ? 'View Availability' : undefined}
            onAction={activeTab === 'pending' ? () => navigate('/mentor/availability') : undefined}
          />
        ) : (
          currentList.map((booking) => {
            const hint = renderSessionHint(booking);
            return (
              <div key={booking.id}>
                {hint ? (
                  <div className="px-1 pb-1 flex items-center gap-1.5">
                    {hint}
                  </div>
                ) : null}
                <MentorBookingCard
                  booking={booking}
                  onAction={(b) => {
                    if (b.status === 'COMPLETED' || resolveLifecycleLive(b) === 'COMPLETED') {
                      navigate(`/mentor/workspace?bookingId=${b.id}`);
                      return;
                    }
                    navigate(`/mentor/booking-detail?bookingId=${b.id}`);
                  }}
                  onSecondaryAction={(b) => navigate(`/mentor/booking-detail?bookingId=${b.id}`)}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
