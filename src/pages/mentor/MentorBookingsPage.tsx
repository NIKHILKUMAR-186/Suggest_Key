import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { AlertTriangle, Loader2, Clock, ShieldAlert } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { EmptyState } from '@/src/components/shared/EmptyState';
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

  /**
   * The offset between this browser's clock and the server's, sampled from the
   * `serverNow` the ledger response carries.
   *
   * The display tick adds this so countdowns and "Access opens in" read against
   * the server's time rather than a laptop whose clock is minutes out. It is a
   * presentation correction only: no tab ever moves because of it, and the
   * original page's `serverNowMsRef` - which was seeded from `Date.now()` and so
   * corrected nothing - is gone rather than kept as a second unsynced clock.
   */
  const clockOffsetMsRef = useRef<number>(0);
  const serverNowMs = (): number => Date.now() + clockOffsetMsRef.current;

  /**
   * Display-only ticking clock so the "Starts in" / "Access opens in" hint and
   * the live indicator advance without a manual refresh, and so an overdue
   * duration keeps counting up while the page is open. It is corrected to the
   * server clock and it never drives tab grouping, which is server-authoritative.
   */
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
    // An overdue booking has already missed the deadline, so a countdown to it
    // would be noise. The card renders the overdue duration instead.
    if (b.lifecycle?.bucket === 'OVERDUE') return null;

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

  const loadData = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!mentorId) return;
      // A background revalidation must never blank the ledger the mentor is
      // reading; only an explicit first load shows the loading state.
      if (!options.silent) setLoading(true);
      setLoadError(null);
      try {
        // No status filter: every tab is derived from the same live booking rows
        // so a booking can never be in one tab and missing from another.
        const { bookings: data, serverNowMs: serverNowMsValue } =
          await fetchMentorBookingsWithServerNow(mentorId);

        // Fail closed on an unclassified booking. Guessing "not overdue" here
        // is exactly the defect this page was rebuilt to remove, so an
        // unclassifiable row is an error the mentor can retry, not a silent
        // demotion into Pending Confirmation.
        for (const booking of data) requireLifecycle(booking);

        if (serverNowMsValue !== null) {
          clockOffsetMsRef.current = serverNowMsValue - Date.now();
        }
        setBookings(data);
      } catch (err) {
        // A failed load is NOT an empty ledger. Reporting it as "no bookings"
        // would hide a real booking that exists in the database.
        const code = err instanceof Error ? err.message : '';
        if (options.silent) {
          // Keep whatever was on screen and log the miss; a transient realtime
          // or network blip must not destroy the mentor's current view.
          console.error('Background mentor booking revalidation failed:', err);
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
        console.error('Failed to load mentor bookings:', err);
      } finally {
        if (!options.silent) setLoading(false);
      }
    },
    [mentorId]
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  /**
   * Tab filtering, grouped on the SERVER's lifecycle bucket.
   *
   * This is the whole point of the change: nothing here reads `Date.now()` to
   * decide whether a deadline passed. An overdue booking is absent from Pending
   * Confirmation because the server put it in OVERDUE, not because this browser
   * noticed the clock had moved.
   */
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

  /**
   * Deadlines still ahead of the server clock. Handing these to the sync hook is
   * what moves a booking from Pending to Overdue on its own, at the exact
   * instant, with no refresh.
   */
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-950 dark:text-[var(--color-shell-text)] sm:text-3xl">
            Mentor Bookings
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-[var(--color-shell-text-muted)]">
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

      {/* Overdue summary. Warning, not alarm: nothing has been cancelled and the
          booking is still the mentor's to resolve. */}
      {overdueCount > 0 && (
        <div className="rounded-xl border border-[var(--color-shell-warning)]/40 bg-[var(--color-shell-warning-soft)] p-4 flex items-start gap-3 text-xs text-[var(--color-shell-text)]">
          <ShieldAlert className="h-5 w-5 text-[var(--color-shell-warning)] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-bold block text-sm">
              {overdueCount} session{overdueCount === 1 ? '' : 's'} past the meeting-link deadline
            </span>
            <p>
              These are no longer routine pending confirmations. Missing the deadline does not
              cancel a booking and nothing has been refunded &mdash; the seeker is still waiting. Add a
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
      <div className="flex border-b border-zinc-200 dark:border-[var(--color-shell-border)] gap-8 text-sm font-medium overflow-x-auto">
        {TABS.map((tab) => {
          const count = grouped[tab.id].length;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`pb-3 transition-colors whitespace-nowrap cursor-pointer flex items-center gap-2 ${
                isActive
                  ? 'border-b-2 border-[var(--color-shell-text)] text-[var(--color-shell-text)] font-bold'
                  : 'text-zinc-500 dark:text-[var(--color-shell-text-muted)] hover:text-zinc-800 dark:hover:text-[var(--color-shell-text)]'
              }`}
            >
              <span>{tab.label}</span>
              {count > 0 && (
                <span
                  className={`px-1.5 py-0.5 text-[11px] rounded-full font-semibold ${
                    isActive
                      ? tab.alert
                        ? 'bg-[var(--color-shell-warning)] text-[var(--color-shell-text-contrast)]'
                        : 'bg-[var(--color-shell-text)] text-[var(--color-shell-surface)]'
                      : tab.alert
                        ? 'bg-[var(--color-shell-warning-soft)] text-[var(--color-shell-warning)]'
                        : 'bg-zinc-100 text-zinc-600 dark:bg-[var(--color-shell-bg-hover)] dark:text-[var(--color-shell-text-muted)]'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
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
              <Button onClick={() => loadData()} variant="outline" size="sm" className="text-xs">
                Try again
              </Button>
            </div>
          </div>
        ) : currentList.length === 0 ? (
          <EmptyState
            title={emptyCopy.title}
            description={emptyCopy.description}
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
                    if (b.lifecycle?.bucket === 'COMPLETED') {
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