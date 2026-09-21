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
  Sparkles,
  Info,
  Calendar,
  User,
  Radio,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
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

  // Extract bookingId from query string or default to 'bk-session-soon' or 'bk-9020'
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
    return 'bk-session-soon';
  };

  const [selectedBookingId, setSelectedBookingId] = useState<string>(getBookingIdFromUrl());
  const [sessionAccess, setSessionAccess] = useState<SessionAccessResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [joining, setJoining] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Time-shift simulation mode for thorough evaluation
  const [simulatedOffsetMinutes, setSimulatedOffsetMinutes] = useState<number | null>(null);

  // Countdown ticker states in seconds
  const [secondsUntilT5, setSecondsUntilT5] = useState<number>(0);
  const [secondsUntilStart, setSecondsUntilStart] = useState<number>(0);
  const [secondsUntilEnd, setSecondsUntilEnd] = useState<number>(0);

  const userId = user?.id || 'usr-8801';

  // Compute effective simulation timestamp if offset is applied
  const getEffectiveTime = useCallback((): Date | undefined => {
    if (simulatedOffsetMinutes === null) return undefined;
    return new Date(Date.now() + simulatedOffsetMinutes * 60 * 1000);
  }, [simulatedOffsetMinutes]);

  // Load authoritative session access state from server
  const loadSessionAccess = useCallback(
    async (bId: string) => {
      setLoading(true);
      setServerError(null);
      try {
        const effectiveTime = getEffectiveTime();
        const data = await fetchSessionAccess(bId, userId, effectiveTime);
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
    [userId, getEffectiveTime]
  );

  useEffect(() => {
    loadSessionAccess(selectedBookingId);
  }, [selectedBookingId, simulatedOffsetMinutes, loadSessionAccess]);

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
    setJoining(true);
    setServerError(null);
    setActionNotice(null);

    try {
      const effectiveTime = getEffectiveTime();
      const result = await joinSessionRequest(selectedBookingId, userId, effectiveTime);

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

  const handlePresetSimulation = (stateType: 'BEFORE_T5' | 'T5_WINDOW' | 'IN_PROGRESS' | 'COMPLETED') => {
    if (!sessionAccess) return;
    const now = Date.now();
    const startMs = new Date(sessionAccess.startTime).getTime();
    const endMs = new Date(sessionAccess.endTime).getTime();

    if (stateType === 'BEFORE_T5') {
      // Set time to 15 minutes before session start
      const targetTime = startMs - 15 * 60 * 1000;
      setSimulatedOffsetMinutes(Math.round((targetTime - now) / 60000));
    } else if (stateType === 'T5_WINDOW') {
      // Set time to 3 minutes before session start (inside T-5)
      const targetTime = startMs - 3 * 60 * 1000;
      setSimulatedOffsetMinutes(Math.round((targetTime - now) / 60000));
    } else if (stateType === 'IN_PROGRESS') {
      // Set time to 15 minutes into session
      const targetTime = startMs + 15 * 60 * 1000;
      setSimulatedOffsetMinutes(Math.round((targetTime - now) / 60000));
    } else if (stateType === 'COMPLETED') {
      // Set time to 5 minutes after session end
      const targetTime = endMs + 5 * 60 * 1000;
      setSimulatedOffsetMinutes(Math.round((targetTime - now) / 60000));
    }
  };

  const resetToRealTime = () => {
    setSimulatedOffsetMinutes(null);
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
      {/* Top Breadcrumb & Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/seeker/bookings')}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 transition-colors"
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
          <span className="text-xs text-zinc-400">#{sessionAccess?.bookingCode || 'BK'}</span>
        </div>
      </div>

      {/* Phase 9 Interactive State Simulator & Session Selector */}
      <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-3.5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-zinc-900">Select Test Session:</span>
            <select
              value={selectedBookingId}
              onChange={(e) => {
                setSelectedBookingId(e.target.value);
                setSimulatedOffsetMinutes(null);
              }}
              className="px-2 py-1 bg-white border border-zinc-300 rounded text-xs text-zinc-800 font-medium focus:outline-none focus:ring-1 focus:ring-zinc-500"
            >
              <option value="bk-session-soon">BK-SOON-01 (Starts in 3 mins · T-5 Early Entry)</option>
              <option value="bk-session-live">BK-LIVE-02 (Live In Progress · Started 12 mins ago)</option>
              <option value="bk-session-ended">BK-ENDED-03 (Concluded Session · Ended 20 mins ago)</option>
              <option value="bk-9020">BK-9020 (Starts Tomorrow · Locked Before T-5)</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 self-start">
            <button
              onClick={() => loadSessionAccess(selectedBookingId)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-white border border-zinc-200 text-zinc-600 hover:text-zinc-900 shadow-2xs"
              title="Refresh server authoritative state"
            >
              <RefreshCw className="h-3 w-3" />
              <span>Refresh</span>
            </button>
            {simulatedOffsetMinutes !== null && (
              <button
                onClick={resetToRealTime}
                className="px-2 py-1 rounded text-[11px] font-semibold bg-amber-100 text-amber-800 hover:bg-amber-200"
              >
                Reset Real-Time
              </button>
            )}
          </div>
        </div>

        {/* Quick Time Shift Controls */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-zinc-200/70 text-[11px]">
          <span className="text-zinc-500 mr-1">Authoritative Time-Gate Test:</span>
          <button
            onClick={() => handlePresetSimulation('BEFORE_T5')}
            className={`px-2 py-1 rounded transition-colors ${
              isBeforeT5
                ? 'bg-zinc-900 text-white font-medium'
                : 'bg-white border border-zinc-200 text-zinc-700 hover:bg-zinc-100'
            }`}
          >
            1. Before T-5 (Lock Active)
          </button>
          <button
            onClick={() => handlePresetSimulation('T5_WINDOW')}
            className={`px-2 py-1 rounded transition-colors ${
              isT5Window
                ? 'bg-amber-600 text-white font-medium'
                : 'bg-white border border-zinc-200 text-zinc-700 hover:bg-zinc-100'
            }`}
          >
            2. T-5 Window (Early Entry)
          </button>
          <button
            onClick={() => handlePresetSimulation('IN_PROGRESS')}
            className={`px-2 py-1 rounded transition-colors ${
              isInProgress
                ? 'bg-emerald-600 text-white font-medium'
                : 'bg-white border border-zinc-200 text-zinc-700 hover:bg-zinc-100'
            }`}
          >
            3. Live In-Progress
          </button>
          <button
            onClick={() => handlePresetSimulation('COMPLETED')}
            className={`px-2 py-1 rounded transition-colors ${
              isCompleted
                ? 'bg-zinc-600 text-white font-medium'
                : 'bg-white border border-zinc-200 text-zinc-700 hover:bg-zinc-100'
            }`}
          >
            4. Concluded (Completed)
          </button>
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
      <div className="rounded-xl border border-zinc-200 bg-white p-6 sm:p-8 shadow-xs space-y-6">
        {/* Session Metadata Header */}
        <div className="space-y-2 border-b border-zinc-100 pb-6 text-center sm:text-left">
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
            <Badge variant="secondary" className="text-xs font-normal">
              1:1 Advisory Session
            </Badge>
            <span className="text-xs text-zinc-400">·</span>
            <span className="text-xs font-medium text-zinc-600">
              Booking Ref: {sessionAccess?.bookingCode || 'BK-9021'}
            </span>
          </div>

          <h1 className="text-xl sm:text-2xl font-bold text-zinc-950">
            {sessionAccess?.sessionTitle || '1:1 Mentorship Guidance'}
          </h1>

          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-4 text-xs text-zinc-600 pt-1">
            <span className="inline-flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-zinc-400" />
              <span>Mentor: {sessionAccess?.mentorName || 'Rahul Sharma'}</span>
            </span>
            <span>·</span>
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-zinc-400" />
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
              <Clock className="h-3.5 w-3.5 text-zinc-400" />
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
          <div className="rounded-xl border border-amber-200/80 bg-amber-50/50 p-6 sm:p-8 text-center space-y-5">
            <div className="h-12 w-12 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center mx-auto shadow-2xs">
              <Lock className="h-6 w-6" />
            </div>

            <div className="space-y-1">
              <h2 className="text-lg font-bold text-amber-950">
                Session Locked Until T-5 Minutes
              </h2>
              <p className="text-xs text-amber-800/90 max-w-md mx-auto">
                Per security rules, the HTTPS meeting link is hidden and join access is denied until exactly 5 minutes prior to scheduled start.
              </p>
            </div>

            {/* Countdown Box to T-5 */}
            <div className="inline-flex items-center justify-center gap-3 bg-white/90 border border-amber-200 rounded-xl px-6 py-4 shadow-2xs">
              {t5Countdown.days > 0 && (
                <div className="text-center">
                  <div className="text-2xl sm:text-3xl font-mono font-bold text-amber-950">
                    {padZero(t5Countdown.days)}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-amber-700 font-medium">Days</div>
                </div>
              )}
              {t5Countdown.days > 0 && <span className="text-xl font-bold text-amber-300">:</span>}

              <div className="text-center">
                <div className="text-2xl sm:text-3xl font-mono font-bold text-amber-950">
                  {padZero(t5Countdown.hours)}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-amber-700 font-medium">Hours</div>
              </div>
              <span className="text-xl font-bold text-amber-300">:</span>

              <div className="text-center">
                <div className="text-2xl sm:text-3xl font-mono font-bold text-amber-950">
                  {padZero(t5Countdown.minutes)}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-amber-700 font-medium">Mins</div>
              </div>
              <span className="text-xl font-bold text-amber-300">:</span>

              <div className="text-center">
                <div className="text-2xl sm:text-3xl font-mono font-bold text-amber-950">
                  {padZero(t5Countdown.seconds)}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-amber-700 font-medium">Secs</div>
              </div>
            </div>

            {/* Concealed Meeting Link Placeholder */}
            <div className="max-w-md mx-auto rounded-lg border border-amber-200/70 bg-white/70 p-3 text-xs text-amber-900/80 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 truncate">
                <Lock className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                <span className="font-mono text-zinc-400 select-none">
                  https://meet.google.com/••••-••••-••••
                </span>
              </div>
              <Badge variant="outline" className="text-[10px] text-amber-800 border-amber-300 shrink-0">
                Concealed
              </Badge>
            </div>

            {/* Disabled Join Button */}
            <div className="pt-2">
              <Button
                disabled
                className="w-full sm:w-auto px-8 gap-2 text-xs opacity-60 cursor-not-allowed bg-zinc-300 text-zinc-600"
                size="lg"
              >
                <Lock className="h-3.5 w-3.5" />
                <span>Join Locked (Opens at T-5)</span>
              </Button>
              <p className="text-[11px] text-zinc-400 mt-2">
                Server authorization strictly denies joins before T-5 minutes.
              </p>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* STATE 2: T-5 WINDOW (Link available & Pre-Session Join Allowed)   */}
        {/* ------------------------------------------------------------------ */}
        {isT5Window && (
          <div className="rounded-xl border border-amber-300 bg-amber-50/40 p-6 sm:p-8 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-amber-200 pb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                  <Radio className="h-5 w-5 animate-pulse" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-amber-950">
                    Early Access Window Open
                  </h2>
                  <p className="text-xs text-amber-800">
                    You may join early to test audio/video before mentor Rahul Sharma begins.
                  </p>
                </div>
              </div>

              {/* Countdown to Session Start */}
              <div className="bg-white border border-amber-200 rounded-lg px-4 py-2 text-right self-start sm:self-auto">
                <div className="text-[10px] uppercase tracking-wider text-amber-700 font-semibold">
                  Starts In
                </div>
                <div className="text-lg font-mono font-bold text-amber-950">
                  {padZero(startCountdown.minutes)}m {padZero(startCountdown.seconds)}s
                </div>
              </div>
            </div>

            {/* Revealed Meeting Link Card */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-zinc-700">
                Verified HTTPS Meeting Link:
              </label>
              <div className="flex items-center gap-2">
                <div className="flex-1 p-3 bg-white rounded-lg border border-amber-200 font-mono text-xs text-zinc-800 truncate select-all">
                  {sessionAccess?.meetingUrl || 'https://meet.google.com/early-access-room'}
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
              <span className="text-xs text-zinc-500">
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
              <div className="bg-white border border-emerald-200 rounded-lg px-4 py-2 text-right self-start sm:self-auto">
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
              <label className="text-xs font-semibold text-zinc-700">
                Verified HTTPS Meeting Link:
              </label>
              <div className="flex items-center gap-2">
                <div className="flex-1 p-3 bg-white rounded-lg border border-emerald-200 font-mono text-xs text-zinc-800 truncate select-all">
                  {sessionAccess?.meetingUrl || 'https://meet.google.com/live-session-room'}
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
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-6 sm:p-8 space-y-6 text-center sm:text-left">
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-zinc-200 text-zinc-700 flex items-center justify-center shrink-0">
                <Check className="h-6 w-6 text-zinc-900" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-center sm:justify-start gap-2">
                  <Badge variant="secondary" className="text-xs font-semibold">
                    STATUS: COMPLETED
                  </Badge>
                </div>
                <h2 className="text-lg font-bold text-zinc-950">
                  Session Has Concluded
                </h2>
                <p className="text-xs text-zinc-500 max-w-lg">
                  Scheduled time has ended. The meeting link has been deactivated, and joining is permanently closed per server policy.
                </p>
              </div>
            </div>

            {/* Session Workspace Callout */}
            <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-md bg-zinc-100 text-zinc-700 shrink-0">
                  <FileText className="h-4 w-4" />
                </div>
                <div className="text-xs space-y-1">
                  <span className="font-semibold text-zinc-900">Session Workspace & Notes</span>
                  <p className="text-zinc-500">
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
                className="w-full sm:w-auto px-6 text-xs bg-zinc-200 text-zinc-500 cursor-not-allowed opacity-70"
                size="md"
              >
                <span>Join Denied (Session Ended)</span>
              </Button>
              <span className="text-[11px] text-zinc-400">
                End time elapsed at {sessionAccess?.endTime ? new Date(sessionAccess.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}.
              </span>
            </div>
          </div>
        )}

        {/* Security & Verification Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-zinc-400 pt-4 border-t border-zinc-100">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            <span className="font-medium text-zinc-600">Server Authoritative Time-Gate Enforced</span>
          </div>
          <div>
            <span>Server Time: </span>
            <span className="font-mono text-zinc-600">
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
  );
};
