import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { AlertTriangle, Loader2, ShieldAlert, Clock } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { MentorBookingCard } from '@/src/components/mentor/MentorBookingCard';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import {
  fetchMentorBookingsWithServerNow,
  requireLifecycle,
  type EnrichedBookingRecord,
} from '@/src/lib/bookingService';
import {
  bucketToMentorTab,
  type MentorBookingTab,
} from '@/src/lib/bookingLifecycle';
import { useMentorBookingSync } from '@/src/hooks/useMentorBookingSync';
import {
  isBookingUpcoming,
  resolveSessionLifecycle,
  secondsUntilAccessOpens,
  secondsUntilSessionEnd,
  formatCountdown,
  type SessionLifecycleState,
} from '@/src/lib/sessionState';
import { MentorEmptyState } from '@/src/components/mentor/MentorEmptyState';
import { logSanitizer } from '@/src/lib/logSanitizer';

interface TabDescriptor {
  id: MentorBookingTab;
  label: string;
  alert: boolean;
}

const TABS: readonly TabDescriptor[] = [
  { id: 'pending', label: 'Pending Confirmation', alert: false },
  { id: 'upcoming', label: 'Upcoming (Confirmed)', alert: false },
  { id: 'overdue', label: 'Overdue / Action Required', alert: true },
  { id: 'completed', label: 'Completed', alert: false },
  { id: 'cancelled', label: 'Cancelled', alert: false },
];

const EMPTY_COPY: Record<MentorBookingTab, { title: string; description: string }> = {
  pending: {
    title: 'No Pending Confirmations',
    description:
      'Sessions appear here once the admin has verified the seeker payment, while you are still inside the meeting-link deadline.',
  },
  upcoming: {
    title: 'No Confirmed Upcoming Sessions',
    description:
      'Confirmed sessions move here as soon as you attach a valid HTTPS meeting link.',
  },
  overdue: {
    title: 'Nothing Overdue',
    description:
      'Every session waiting on you is still inside its meeting-link deadline. Anything that misses it appears here instead.',
  },
  completed: {
    title: 'No Completed Sessions Yet',
    description: 'Sessions you have already delivered will appear here with their workspace notes.',
  },
  cancelled: {
    title: 'No Cancelled Sessions',
    description: 'Cancelled and rejected sessions are listed here for your records.',
  },
};

export const MentorBookingsPage: React.FC = () => {
  const { navigate } = useNavigation();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<MentorBookingTab>('pending');
  const [bookings, setBookings] = useState<EnrichedBookingRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const mentorId = user?.id;

  const clockOffsetMsRef = useRef<number>(0);
  const serverNowMs = (): number => Date.now() + clockOffsetMsRef.current;

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now() + clockOffsetMsRef.current), 1000);
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
    if (b.lifecycle?.bucket === 'OVERDUE') return null;

    const state = resolveLifecycleLive(b);
    if (state === 'IN_PROGRESS') {
      const endsIn = formatCountdown(Math.max(0, Math.ceil(secondsUntilSessionEnd(b, nowMs))));
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-shell-success)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-shell-success)] animate-pulse" />
          LIVE · Ends in {endsIn}
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
        <span className="text-xs text-[var(--color-shell-text-muted)]">Meeting access closed</span>
      );
    }
    return null;
  };

  const loadData = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!mentorId) return;
      if (!options.silent) setLoading(true);
      setLoadError(null);
      try {
        const { bookings: data, serverNowMs: serverNowMsValue } =
          await fetchMentorBookingsWithServerNow(mentorId);

        for (const booking of data) requireLifecycle(booking);

        if (serverNowMsValue !== null) {
          clockOffsetMsRef.current = serverNowMsValue - Date.now();
        }
        setBookings(data);
      } catch (err) {
        const code = err instanceof Error ? err.message : '';
        if (options.silent) {
          console.error('Background mentor booking revalidation failed:', logSanitizer.safeMessage(err));
          return;
        }
        setBookings([]);
        setLoadError(
          code === 'AUTH_REQUIRED'
            ? 'Your session has expired. Sign in again to load your bookings.'
            : code === 'FORBIDDEN_NOT_BOOKING_OWNER'
            ? 'This account is not authorised to read mentor bookings.'
            : code === 'BOOKING_STATE_UNAVAILABLE'
            ? 'The server did not return a confirmed lifecycle state for these bookings, so they cannot be grouped safely. Refresh to try again.'
            : 'We could not load your bookings from the server. Please refresh and try again.'
        );
        console.error('Failed to load mentor bookings:', logSanitizer.safeMessage(err));
      } finally {
        if (!options.silent) setLoading(false);
      }
    },
    [mentorId]
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  const grouped = useMemo(() => {
    const buckets: Record<MentorBookingTab, EnrichedBookingRecord[]> = {
      pending: [],
      upcoming: [],
      overdue: [],
      completed: [],
      cancelled: [],
    };
    for (const booking of bookings) {
      const tab = bucketToMentorTab(requireLifecycle(booking).bucket);
      if (tab) buckets[tab].push(booking);
    }
    return buckets;
  }, [bookings]);

  const overdueBookings = grouped.overdue;
  const overdueCount = overdueBookings.length;

  const upcomingDeadlines = useMemo(
    () =>
      [...grouped.pending]
        .map((b) => b.lifecycle?.meetingLinkDeadlineUtc ?? null)
        .filter((d): d is string => typeof d === 'string'),
    [grouped.pending]
  );

  useMentorBookingSync({
    mentorId: mentorId ?? null,
    deadlinesUtc: upcomingDeadlines,
    onInvalidate: useCallback(() => {
      void loadData({ silent: true });
    }, [loadData]),
  });

  const currentList = grouped[activeTab];
  const emptyCopy = EMPTY_COPY[activeTab];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-shell-text)] sm:text-3xl">
            Mentor Bookings
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-[var(--color-shell-text-muted)]">
            Confirm sessions the admin has verified, provide secure HTTPS meeting links, and manage
            upcoming schedules.
          </p>
        </div>
        <Button
          onClick={() => loadData()}
          variant="outline"
          size="sm"
          className="text-xs self-start"
          disabled={loading}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
          Refresh Ledger
        </Button>
      </div>

      {/* Overdue summary */}
      {overdueCount > 0 && (
        <div className="rounded-xl border border-[var(--color-shell-warning)]/40 bg-[var(--color-shell-warning-soft)] p-4 flex items-start gap-3 text-xs text-[var(--color-shell-text)]">
          <ShieldAlert className="h-5 w-5 text-[var(--color-shell-warning)] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-bold block text-sm">
              {overdueCount} session{overdueCount === 1 ? '' : 's'} past the meeting-link deadline
            </span>
            <p>
              These are no longer routine pending confirmations. Missing the deadline does not
              cancel a booking and nothing has been refunded — the seeker is still waiting. Add a
              meeting link to confirm, or cancel the booking to release the slot and start a refund.
            </p>
            <button
              type="button"
              onClick={() => setActiveTab('overdue')}
              className="font-semibold underline underline-offset-2 cursor-pointer"
            >
              Review overdue sessions
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-[var(--color-shell-border)]">
        <nav className="-mb-px flex gap-8 overflow-x-auto text-sm font-medium" aria-label="Booking tabs">
          {TABS.map((tab) => {
            const count = grouped[tab.id].length;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`relative -mb-px border-b-2 py-3 whitespace-nowrap text-xs font-semibold transition-colors ${
                  isActive
                    ? 'border-[var(--color-shell-primary)] text-[var(--color-shell-text)]'
                    : 'border-transparent text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)] hover:border-[var(--color-shell-border-strong)]'
                }`}
              >
                {tab.label}
                {count > 0 && (
                  <span
                    className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      isActive
                        ? tab.alert
                          ? 'bg-[var(--color-shell-warning)] text-[var(--color-shell-text-contrast)]'
                          : 'bg-[var(--color-shell-primary)] text-[var(--color-shell-text-contrast)]'
                        : tab.alert
                          ? 'bg-[var(--color-shell-warning-soft)] text-[var(--color-shell-warning)]'
                          : 'bg-[var(--color-shell-bg-hover)] text-[var(--color-shell-text-muted)]'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="space-y-4">
        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center text-[var(--color-shell-text-muted)] gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--color-shell-text-muted)]" />
            <span className="text-xs">Loading booking ledger...</span>
          </div>
        ) : loadError ? (
          <div className="rounded-xl border border-rose-300 bg-rose-50 p-5 flex items-start gap-3 text-xs text-rose-900">
            <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="space-y-2">
              <span className="font-bold block text-sm">Bookings could not be loaded</span>
              <p>{loadError}</p>
              <Button onClick={() => loadData()} variant="outline" size="sm" className="text-xs">
                Try again
              </Button>
            </div>
          </div>
        ) : currentList.length === 0 ? (
          <MentorEmptyState
            title={emptyCopy.title}
            description={emptyCopy.description}
            actionLabel={activeTab === 'pending' ? 'View Availability' : undefined}
            onAction={activeTab === 'pending' ? () => navigate('/mentor/availability') : undefined}
          />
        ) : (
          <div className="divide-y divide-[var(--color-shell-border)] overflow-hidden rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] shadow-xs">
            {currentList.map((booking) => {
              const hint = renderSessionHint(booking);
              return (
                <div key={booking.id} className="p-1">
                  {hint ? (
                    <div className="px-3 pb-1.5 flex items-center gap-1.5 bg-[var(--color-shell-surface-elevated)]/50">
                      {hint}
                    </div>
                  ) : null}
                  <MentorBookingCard
                    booking={booking}
                    onAction={(b) => {
                      if (b.lifecycle?.bucket === 'COMPLETED') {
                        navigate(`/mentor/workspace?bookingId=${b.id}`);
                        return;
                      }
                      navigate(`/mentor/bookings/${b.id}`);
                    }}
                    onSecondaryAction={(b) => navigate(`/mentor/bookings/${b.id}`)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
