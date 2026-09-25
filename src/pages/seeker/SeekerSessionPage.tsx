import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  Clock,
  Video,
  ShieldCheck,
  Lock,
  ExternalLink,
  FileText,
  Copy,
  Check,
  AlertCircle,
  Calendar,
  User,
  Radio,
} from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import {
  fetchSessionAccess,
  joinSessionRequest,
  SessionAccessResult,
  SessionAccessState,
} from '@/src/lib/bookingService';

interface TimeBreakdown {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function formatCountdown(seconds: number): TimeBreakdown {
  const s = Math.max(0, seconds);
  const days = Math.floor(s / (24 * 3600));
  const hours = Math.floor((s % (24 * 3600)) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return { days, hours, minutes, seconds: secs };
}

function padZero(num: number): string {
  return num < 10 ? `0${num}` : `${num}`;
}

export const SeekerSessionPage: React.FC = () => {
  const { navigate, currentPath } = useNavigation();
  const { user } = useAuth();

  // Extract bookingId from query string
  const getBookingIdFromUrl = (): string => {
    try {
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const q = params.get('bookingId');
        if (q) return q;
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

  const [selectedBookingId, setSelectedBookingId] = useState<string>(getBookingIdFromUrl() || '');
  const [sessionAccess, setSessionAccess] = useState<SessionAccessResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [joining, setJoining] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Countdown ticker states in seconds
  const [secondsUntilT5, setSecondsUntilT5] = useState<number>(0);
  const [secondsUntilStart, setSecondsUntilStart] = useState<number>(0);
  const [secondsUntilEnd, setSecondsUntilEnd] = useState<number>(0);

  const userId = user?.id;

   // Load authoritative session access state from server
  const loadSessionAccess = useCallback(
    async (bId: string) => {
      if (!userId || !bId) {
        setSessionAccess(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setServerError(null);
      try {
        const data = await fetchSessionAccess(bId, userId);
        setSessionAccess(data);
        setSecondsUntilT5(data.secondsUntilT5);
        setSecondsUntilStart(data.secondsUntilStart);
        setSecondsUntilEnd(data.secondsUntilEnd);
      } catch (err: any) {
        setServerError(err.message || 'Failed to fetch session access state.');
      } finally {
        setLoading(false);
      }
    },
    [userId]
  );

  useEffect(() => {
    if (!selectedBookingId) {
      setLoading(false);
      return;
    }
    loadSessionAccess(selectedBookingId);
  }, [selectedBookingId, loadSessionAccess]);

  // Local 1-second countdown interval
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsUntilT5((prev) => {
        if (prev <= 1 && sessionAccess?.accessState === 'BEFORE_T5') {
          // Re-fetch authoritative state when T-5 window triggers
          loadSessionAccess(selectedBookingId);
          return 0;
        }
        return Math.max(0, prev - 1);
      });

      setSecondsUntilStart((prev) => {
        if (prev <= 1 && sessionAccess?.accessState === 'T5_WINDOW') {
          loadSessionAccess(selectedBookingId);
          return 0;
        }
        return Math.max(0, prev - 1);
      });

      setSecondsUntilEnd((prev) => {
        if (prev <= 1 && sessionAccess?.accessState === 'IN_PROGRESS') {
          // Session concluded!
          loadSessionAccess(selectedBookingId);
          return 0;
        }
        return Math.max(0, prev - 1);
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [sessionAccess?.accessState, selectedBookingId, loadSessionAccess]);

  // Handle authoritative join session action
  const handleJoinSession = async () => {
    if (!userId) return;
    setJoining(true);
    setServerError(null);
    setActionNotice(null);

    try {
      const result = await joinSessionRequest(selectedBookingId, userId);

      if (!result.success || !result.canJoin) {
        setServerError(
          result.error?.message ||
            'Server authoritative verification rejected the join attempt. Please check session timing.'
        );
        return;
      }

      if (result.meetingUrl) {
        setActionNotice('Authoritative join verified by server. Opening secure meeting room...');
        window.open(result.meetingUrl, '_blank', 'noopener,noreferrer');
      } else {
        setServerError('Meeting URL unavailable from server.');
      }
    } catch (err: any) {
      setServerError(err.message || 'Error occurred while contacting session server.');
    } finally {
      setJoining(false);
    }
  };

  const handleCopyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const accessState = sessionAccess?.accessState || 'BEFORE_T5';
  const isBeforeT5 = accessState === 'BEFORE_T5';
  const isT5Window = accessState === 'T5_WINDOW';
  const isInProgress = accessState === 'IN_PROGRESS';
  const isCompleted = accessState === 'COMPLETED';

  const t5Countdown = formatCountdown(secondsUntilT5);
  const startCountdown = formatCountdown(secondsUntilStart);
  const endCountdown = formatCountdown(secondsUntilEnd);

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      {!selectedBookingId && !loading && (
        <EmptyState
          icon={AlertCircle}
          title="No Booking Reference"
          description="No booking ID was provided in the URL. Navigate to this page from your bookings list."
          actionLabel="View My Bookings"
          onAction={() => navigate('/seeker/bookings')}
        />
      )}

      {loading && selectedBookingId && (
        <div className="py-16 flex flex-col justify-center items-center text-[var(--color-shell-text-subtle)] text-xs gap-2">
          <Calendar className="h-6 w-6 animate-spin text-[var(--color-shell-text-muted)]" />
          <span>Loading session access state from server...</span>
        </div>
      )}

      {selectedBookingId && !loading && (
      <div className="space-y-6">
        {/* Top Breadcrumb & Navigation */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate('/seeker/bookings')}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)] transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to Bookings</span>
          </button>

        <div className="flex items-center gap-2">
          <Badge
            variant={
              isInProgress
                ? 'success'
                : isT5Window
                ? 'warning'
                : isCompleted
                ? 'secondary'
                : 'outline'
            }
            className="text-[11px]"
          >
            {isInProgress
              ? '● LIVE IN PROGRESS'
              : isT5Window
              ? 'EARLY ACCESS WINDOW'
              : isCompleted
              ? 'COMPLETED'
              : 'UPCOMING (LOCKED)'}
          </Badge>
           <span className="text-xs text-[var(--color-shell-text-subtle)]">#{sessionAccess?.bookingCode || ''}</span>
        </div>
      </div>

      {/* Server Error / Notice Banner */}
      {serverError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-900 flex items-start gap-2.5">
          <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold">Server Authoritative Gate Notice:</span>
            <p>{serverError}</p>
          </div>
        </div>
      )}

      {actionNotice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 flex items-center gap-2">
          <Check className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>{actionNotice}</span>
        </div>
      )}

      {/* Main Session Access Room Card */}
      <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 sm:p-8 shadow-xs space-y-6">
        {/* Session Metadata Header */}
        <div className="space-y-2 border-b border-[var(--color-shell-border)] pb-6 text-center sm:text-left">
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
            <Badge variant="secondary" className="text-xs font-normal">
              1:1 Advisory Session
            </Badge>
            <span className="text-xs text-[var(--color-shell-text-subtle)]">·</span>
            <span className="text-xs font-medium text-[var(--color-shell-text-muted)]">
               Booking Ref: {sessionAccess?.bookingCode || '—'}
            </span>
          </div>

          <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-shell-text)]">
             {sessionAccess?.sessionTitle || '—'}
          </h1>

          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-4 text-xs text-[var(--color-shell-text-muted)] pt-1">
            <span className="inline-flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-[var(--color-shell-text-subtle)]" />
              <span>Mentor: {sessionAccess?.mentorName || '—'}</span>
            </span>
            <span>·</span>
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-[var(--color-shell-text-subtle)]" />
              <span>
                {sessionAccess?.startTime
                  ? new Date(sessionAccess.startTime).toLocaleDateString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : 'Today'}
              </span>
            </span>
            <span>·</span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-[var(--color-shell-text-subtle)]" />
              <span>
                {sessionAccess?.startTime
                  ? new Date(sessionAccess.startTime).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : ''}{' '}
                –{' '}
                {sessionAccess?.endTime
                  ? new Date(sessionAccess.endTime).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : ''}
              </span>
            </span>
          </div>
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* STATE 1: BEFORE T-5 (Link hidden & Join Denied)                   */}
        {/* ------------------------------------------------------------------ */}
        {isBeforeT5 && (
          <div className="rounded-xl border border-[var(--color-shell-warning)]/30/80 bg-[var(--color-shell-warning-soft)]/50 p-6 sm:p-8 text-center space-y-5">
            <div className="h-12 w-12 rounded-full bg-amber-100 text-[var(--color-shell-warning)] flex items-center justify-center mx-auto shadow-2xs">
              <Lock className="h-6 w-6" />
            </div>

            <div className="space-y-1">
              <h2 className="text-lg font-bold text-[var(--color-shell-text)]">
                Session Locked Until T-5 Minutes
              </h2>
              <p className="text-xs text-[var(--color-shell-warning)]/90 max-w-md mx-auto">
                Per security rules, the HTTPS meeting link is hidden and join access is denied until exactly 5 minutes prior to scheduled start.
              </p>
            </div>

            {/* Countdown Box to T-5 */}
            <div className="inline-flex items-center justify-center gap-3 bg-[var(--color-shell-surface)]/90 border border-[var(--color-shell-warning)]/30 rounded-xl px-6 py-4 shadow-2xs">
              {t5Countdown.days > 0 && (
                <div className="text-center">
                  <div className="text-2xl sm:text-3xl font-mono font-bold text-[var(--color-shell-text)]">
                    {padZero(t5Countdown.days)}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--color-shell-warning)] font-medium">Days</div>
                </div>
              )}
              {t5Countdown.days > 0 && <span className="text-xl font-bold text-amber-300">:</span>}

              <div className="text-center">
                <div className="text-2xl sm:text-3xl font-mono font-bold text-[var(--color-shell-text)]">
                  {padZero(t5Countdown.hours)}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--color-shell-warning)] font-medium">Hours</div>
              </div>
              <span className="text-xl font-bold text-amber-300">:</span>

              <div className="text-center">
                <div className="text-2xl sm:text-3xl font-mono font-bold text-[var(--color-shell-text)]">
                  {padZero(t5Countdown.minutes)}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--color-shell-warning)] font-medium">Mins</div>
              </div>
              <span className="text-xl font-bold text-amber-300">:</span>

              <div className="text-center">
                <div className="text-2xl sm:text-3xl font-mono font-bold text-[var(--color-shell-text)]">
                  {padZero(t5Countdown.seconds)}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--color-shell-warning)] font-medium">Secs</div>
              </div>
            </div>

            {/* Concealed Meeting Link Placeholder */}
            <div className="max-w-md mx-auto rounded-lg border border-[var(--color-shell-warning)]/30/70 bg-[var(--color-shell-surface)]/70 p-3 text-xs text-[var(--color-shell-text)]/80 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 truncate">
                <Lock className="h-3.5 w-3.5 text-[var(--color-shell-warning)] shrink-0" />
                <span className="font-mono text-[var(--color-shell-text-subtle)] select-none">
                  https://meet.google.com/••••-••••-••••
                </span>
              </div>
              <Badge variant="outline" className="text-[10px] text-[var(--color-shell-warning)] border-[var(--color-shell-warning)]/40 shrink-0">
                Concealed
              </Badge>
            </div>

            {/* Disabled Join Button */}
            <div className="pt-2">
              <Button
                disabled
                className="w-full sm:w-auto px-8 gap-2 text-xs opacity-60 cursor-not-allowed bg-zinc-300 text-[var(--color-shell-text-muted)]"
                size="lg"
              >
                <Lock className="h-3.5 w-3.5" />
                <span>Join Locked (Opens at T-5)</span>
              </Button>
              <p className="text-[11px] text-[var(--color-shell-text-subtle)] mt-2">
                Server authorization strictly denies joins before T-5 minutes.
              </p>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* STATE 2: T-5 WINDOW (Link available & Pre-Session Join Allowed)   */}
        {/* ------------------------------------------------------------------ */}
        {isT5Window && (
          <div className="rounded-xl border border-[var(--color-shell-warning)]/40 bg-[var(--color-shell-warning-soft)]/40 p-6 sm:p-8 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--color-shell-warning)]/30 pb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-amber-100 text-[var(--color-shell-warning)] flex items-center justify-center shrink-0">
                  <Radio className="h-5 w-5 animate-pulse" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-[var(--color-shell-text)]">
                    Early Access Window Open
                  </h2>
                  <p className="text-xs text-[var(--color-shell-warning)]">
                    You may join early to test audio/video before the session begins.
                  </p>
                </div>
              </div>

              {/* Countdown to Session Start */}
              <div className="bg-[var(--color-shell-surface)] border border-[var(--color-shell-warning)]/30 rounded-lg px-4 py-2 text-right self-start sm:self-auto">
                <div className="text-[10px] uppercase tracking-wider text-[var(--color-shell-warning)] font-semibold">
                  Starts In
                </div>
                <div className="text-lg font-mono font-bold text-[var(--color-shell-text)]">
                  {padZero(startCountdown.minutes)}m {padZero(startCountdown.seconds)}s
                </div>
              </div>
            </div>

            {/* Revealed Meeting Link Card */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-[var(--color-shell-text-muted)]">
                Verified HTTPS Meeting Link:
              </label>
              <div className="flex items-center gap-2">
                <div className="flex-1 p-3 bg-[var(--color-shell-surface)] rounded-lg border border-[var(--color-shell-warning)]/30 font-mono text-xs text-[var(--color-shell-text)] truncate select-all">
                   {sessionAccess?.meetingUrl || ''}
                </div>
                {sessionAccess?.meetingUrl && (
                  <Button
                    onClick={() => handleCopyLink(sessionAccess.meetingUrl!)}
                    variant="outline"
                    size="sm"
                    className="gap-1 text-xs shrink-0"
                  >
                    {copiedLink ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copiedLink ? 'Copied' : 'Copy'}</span>
                  </Button>
                )}
              </div>
            </div>

            {/* Authoritative Join Session Button */}
            <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
              <Button
                onClick={handleJoinSession}
                disabled={joining}
                className="w-full sm:w-auto px-8 gap-2 text-xs bg-amber-600 hover:bg-amber-700 text-white font-semibold shadow-xs"
                size="lg"
              >
                <Video className="h-4 w-4" />
                <span>{joining ? 'Validating Access...' : 'Enter Waiting Room / Join Early'}</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
              <span className="text-xs text-[var(--color-shell-text-muted)]">
                Official session starts at {sessionAccess?.startTime ? new Date(sessionAccess.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
              </span>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* STATE 3: IN PROGRESS (Link available & Live Join Allowed)         */}
        {/* ------------------------------------------------------------------ */}
        {isInProgress && (
          <div className="rounded-xl border border-emerald-300 bg-emerald-50/40 p-6 sm:p-8 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-emerald-200 pb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
                  <Video className="h-5 w-5 animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                    <h2 className="text-base font-bold text-emerald-950">
                      Session Is Live & In Progress
                    </h2>
                  </div>
                  <p className="text-xs text-emerald-800 mt-0.5">
                    Your 1:1 advisory session is currently underway.
                  </p>
                </div>
              </div>

              {/* Countdown to Session End */}
              <div className="bg-[var(--color-shell-surface)] border border-emerald-200 rounded-lg px-4 py-2 text-right self-start sm:self-auto">
                <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold">
                  Session Ends In
                </div>
                <div className="text-lg font-mono font-bold text-emerald-950">
                  {padZero(endCountdown.hours)}h {padZero(endCountdown.minutes)}m {padZero(endCountdown.seconds)}s
                </div>
              </div>
            </div>

            {/* Meeting Link Card */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-[var(--color-shell-text-muted)]">
                Verified HTTPS Meeting Link:
              </label>
              <div className="flex items-center gap-2">
                <div className="flex-1 p-3 bg-[var(--color-shell-surface)] rounded-lg border border-emerald-200 font-mono text-xs text-[var(--color-shell-text)] truncate select-all">
                   {sessionAccess?.meetingUrl || ''}
                </div>
                {sessionAccess?.meetingUrl && (
                  <Button
                    onClick={() => handleCopyLink(sessionAccess.meetingUrl!)}
                    variant="outline"
                    size="sm"
                    className="gap-1 text-xs shrink-0"
                  >
                    {copiedLink ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copiedLink ? 'Copied' : 'Copy'}</span>
                  </Button>
                )}
              </div>
            </div>

            {/* Join Session Button */}
            <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
              <Button
                onClick={handleJoinSession}
                disabled={joining}
                className="w-full sm:w-auto px-8 gap-2 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-xs"
                size="lg"
              >
                <Video className="h-4 w-4" />
                <span>{joining ? 'Authorizing...' : 'Join Session Now'}</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
              <span className="text-xs text-emerald-800 font-medium">
                Active window open until {sessionAccess?.endTime ? new Date(sessionAccess.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
              </span>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* STATE 4: COMPLETED / ENDED (Join Denied & Link Expired)           */}
        {/* ------------------------------------------------------------------ */}
        {isCompleted && (
          <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] p-6 sm:p-8 space-y-6 text-center sm:text-left">
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-zinc-200 text-[var(--color-shell-text-muted)] flex items-center justify-center shrink-0">
                <Check className="h-6 w-6 text-[var(--color-shell-text)]" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-center sm:justify-start gap-2">
                  <Badge variant="secondary" className="text-xs font-semibold">
                    STATUS: COMPLETED
                  </Badge>
                </div>
                <h2 className="text-lg font-bold text-[var(--color-shell-text)]">
                  Session Has Concluded
                </h2>
                <p className="text-xs text-[var(--color-shell-text-muted)] max-w-lg">
                  Scheduled time has ended. The meeting link has been deactivated, and joining is permanently closed per server policy.
                </p>
              </div>
            </div>

            {/* Session Workspace Callout */}
            <div className="rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-md bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-text-muted)] shrink-0">
                  <FileText className="h-4 w-4" />
                </div>
                <div className="text-xs space-y-1">
                  <span className="font-semibold text-[var(--color-shell-text)]">Session Workspace & Notes</span>
                  <p className="text-[var(--color-shell-text-muted)]">
                    Review notes, key takeaways, and action items recorded for this session.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  onClick={() => navigate(`/seeker/workspace?bookingId=${selectedBookingId}`)}
                  size="sm"
                  className="gap-1.5 text-xs"
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span>Open Session Workspace</span>
                </Button>
                <Button
                  onClick={() => navigate('/seeker/bookings')}
                  variant="outline"
                  size="sm"
                  className="text-xs"
                >
                  <span>View All Bookings</span>
                </Button>
              </div>
            </div>

            {/* Disabled Join Button */}
            <div className="pt-1 flex flex-col sm:flex-row items-center gap-3">
              <Button
                disabled
                className="w-full sm:w-auto px-6 text-xs bg-zinc-200 text-[var(--color-shell-text-muted)] cursor-not-allowed opacity-70"
                size="md"
              >
                <span>Join Denied (Session Ended)</span>
              </Button>
              <span className="text-[11px] text-[var(--color-shell-text-subtle)]">
                End time elapsed at {sessionAccess?.endTime ? new Date(sessionAccess.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}.
              </span>
            </div>
          </div>
        )}

        {/* Security & Verification Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-[var(--color-shell-text-subtle)] pt-4 border-t border-[var(--color-shell-border)]">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            <span className="font-medium text-[var(--color-shell-text-muted)]">Server Authoritative Time-Gate Enforced</span>
          </div>
          <div>
            <span>Server Time: </span>
            <span className="font-mono text-[var(--color-shell-text-muted)]">
              {sessionAccess?.currentServerTime
                ? new Date(sessionAccess.currentServerTime).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })
                : 'Synced'}
            </span>
          </div>
           </div>
         </div>
       </div>
      )}
    </div>
  );
};
