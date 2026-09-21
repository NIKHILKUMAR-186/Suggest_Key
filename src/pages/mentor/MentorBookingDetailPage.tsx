import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Video,
  CheckCircle2,
  ShieldCheck,
  Clock,
  Calendar,
  AlertCircle,
  AlertTriangle,
  ExternalLink,
  Loader2,
  Lock,
  User,
  CreditCard,
  BellRing,
  FileText,
} from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { Badge } from '@/src/components/ui/Badge';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import {
  fetchBookingDetail,
  confirmMentorBooking,
  EnrichedBookingRecord,
} from '@/src/lib/bookingService';
import { validateMeetingUrl } from '@/src/lib/bookingEngine';

export const MentorBookingDetailPage: React.FC = () => {
  const { navigate, currentPath } = useNavigation();
  const { user } = useAuth();

  // Extract bookingId from current route or window location query string
  const getBookingIdFromUrl = (): string => {
    try {
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const fromQuery = params.get('bookingId');
        if (fromQuery) return fromQuery;
      }
      if (currentPath && currentPath.includes('bookingId=')) {
        const parts = currentPath.split('bookingId=');
        if (parts[1]) return parts[1].split('&')[0];
      }
    } catch {
      // Ignore
    }
    return 'bk-9021';
  };

  const [bookingId, setBookingId] = useState<string>(getBookingIdFromUrl());
  const [booking, setBooking] = useState<EnrichedBookingRecord | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [meetingUrl, setMeetingUrl] = useState<string>('');
  const [urlError, setUrlError] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  const mentorId = user?.id || 'usr-8802';

  const loadBooking = async (idToLoad: string) => {
    setLoading(true);
    setFeedbackError(null);
    try {
      const data = await fetchBookingDetail(idToLoad, mentorId);
      if (data) {
        setBooking(data);
        if (data.meeting_url) {
          setMeetingUrl(data.meeting_url);
        } else if (!meetingUrl) {
          setMeetingUrl('https://meet.google.com/');
        }
      } else {
        setFeedbackError(`Booking ${idToLoad} not found or access denied.`);
      }
    } catch (err: any) {
      setFeedbackError(err.message || 'Failed to load booking details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const id = getBookingIdFromUrl();
    setBookingId(id);
    loadBooking(id);
  }, [currentPath, mentorId]);

  const handleUrlChange = (val: string) => {
    setMeetingUrl(val);
    setFeedbackSuccess(null);
    setFeedbackError(null);

    const validation = validateMeetingUrl(val);
    if (!validation.isValid) {
      setUrlError(validation.error || 'Invalid meeting URL.');
    } else {
      setUrlError('');
    }
  };

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!booking) return;

    // Validate URL client-side first for responsive feedback
    const validation = validateMeetingUrl(meetingUrl);
    if (!validation.isValid) {
      setUrlError(validation.error || 'A valid HTTPS URL is required.');
      return;
    }

    setUrlError('');
    setSubmitting(true);
    setFeedbackError(null);
    setFeedbackSuccess(null);

    try {
      const result = await confirmMentorBooking(booking.id, mentorId, meetingUrl.trim());

      if (result.success && result.booking) {
        setBooking((prev) =>
          prev
            ? {
                ...prev,
                status: 'CONFIRMED',
                meeting_url: meetingUrl.trim(),
                updated_at: new Date().toISOString(),
              }
            : null
        );
        setFeedbackSuccess(
          'Session confirmed successfully! In-app notification has been dispatched to the seeker.'
        );
        // Reload to sync latest state
        loadBooking(booking.id);
      } else {
        setFeedbackError(result.error?.message || 'Failed to confirm booking.');
      }
    } catch (err: any) {
      setFeedbackError(err.message || 'Unexpected network error during confirmation.');
    } finally {
      setSubmitting(false);
    }
  };

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

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto py-16 flex flex-col items-center justify-center text-zinc-400 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-600" />
        <span className="text-sm font-medium">Loading session details...</span>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center space-y-4">
        <AlertCircle className="h-10 w-10 text-amber-600 mx-auto" />
        <h2 className="text-lg font-bold text-zinc-950">Booking Not Found</h2>
        <p className="text-sm text-zinc-600">
          {feedbackError || `The booking #${bookingId} does not exist or does not belong to your mentor account.`}
        </p>
        <Button onClick={() => navigate('/mentor/bookings')} variant="outline" size="sm">
          Return to Mentor Bookings
        </Button>
      </div>
    );
  }

  const isConfirmed = booking.status === 'CONFIRMED';
  const isPending = booking.status === 'MENTOR_PENDING';
  const isOverdue = booking.deadlineInfo?.isOverdue;
  const hoursLeft = booking.deadlineInfo?.hoursUntilSession;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <button
        onClick={() => navigate('/mentor/bookings')}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 transition-colors cursor-pointer"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        <span>Back to Mentor Bookings</span>
      </button>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-200 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-zinc-950 font-mono">
              Booking #{booking.booking_code}
            </h1>
            <Badge variant={isConfirmed ? 'success' : isPending ? 'warning' : 'secondary'}>
              {booking.status}
            </Badge>
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">
            Admin Verified Payment · ₹{booking.amount_inr} INR
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => navigate(`/mentor/workspace?bookingId=${booking.id}`)}
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs border-zinc-300 hover:border-zinc-900 cursor-pointer"
          >
            <FileText className="h-3.5 w-3.5 text-zinc-600" />
            <span>Session Workspace</span>
          </Button>

          {/* Quick switcher between sample bookings if in demo */}
          <span className="text-[11px] text-zinc-400">Switch Demo Booking:</span>
          {['bk-9021', 'bk-9022', 'bk-9020'].map((id) => (
            <button
              key={id}
              onClick={() => {
                setBookingId(id);
                loadBooking(id);
              }}
              className={`px-2 py-0.5 text-xs font-mono rounded border cursor-pointer ${
                booking.id === id
                  ? 'bg-zinc-900 text-white border-zinc-900'
                  : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'
              }`}
            >
              {id.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Feedback Messages */}
      {feedbackSuccess && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex items-start gap-3 text-xs text-emerald-900">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <span className="font-bold block text-sm">Confirmation Dispatched!</span>
            <p>{feedbackSuccess}</p>
          </div>
        </div>
      )}

      {feedbackError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 flex items-start gap-3 text-xs text-rose-900">
          <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold block text-sm">Action Blocked</span>
            <p>{feedbackError}</p>
          </div>
        </div>
      )}

      {/* Overdue Warning if within 2h and still pending */}
      {isPending && isOverdue && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex items-start gap-3 text-xs text-amber-900">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-bold block text-sm">Overdue Meeting Link Notice (&lt;2h)</span>
            <p>
              This session begins in less than 2 hours. While missing the recommended 2-hour deadline does not cancel your session, prompt submission is required so the seeker can prepare.
            </p>
          </div>
        </div>
      )}

      {/* Confirmation State Details if already confirmed */}
      {isConfirmed && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 flex items-start gap-3 text-xs text-emerald-800">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-bold block text-sm">Session Confirmed</span>
            <p>
              The booking status is <strong>CONFIRMED</strong>. The meeting link has been securely stored and registered. In accordance with platform policy, the direct video link will be revealed to the seeker 5 minutes prior to session start.
            </p>
            {booking.meeting_url && (
              <div className="pt-2 flex flex-wrap items-center gap-3">
                <div className="font-mono text-zinc-900 flex items-center gap-1.5 break-all">
                  <span>Active Link:</span>
                  <a
                    href={booking.meeting_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline hover:text-zinc-600 inline-flex items-center gap-1"
                  >
                    {booking.meeting_url}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <Button
                  onClick={() => navigate(`/seeker/session?bookingId=${booking.id}`)}
                  size="sm"
                  className="gap-1.5 text-xs bg-emerald-700 hover:bg-emerald-800 text-white"
                >
                  <Video className="h-3.5 w-3.5" />
                  <span>Enter Session Access Room</span>
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2-Column Info Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Seeker Information */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
            <h3 className="text-sm font-bold text-zinc-950 flex items-center gap-1.5">
              <User className="h-4 w-4 text-zinc-500" />
              Seeker Profile
            </h3>
            <span className="text-[11px] font-mono text-zinc-400">ID: {booking.seeker_id}</span>
          </div>

          <div className="space-y-3 text-xs">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-zinc-100 font-bold text-zinc-700 flex items-center justify-center border border-zinc-200 text-sm">
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
                <span className="font-bold text-sm text-zinc-900 block">
                  {booking.seeker?.full_name || 'Aman Kumar'}
                </span>
                <span className="text-zinc-500">
                  {booking.seeker?.email || 'seeker@suggestkey.com'}
                </span>
              </div>
            </div>

            <div className="space-y-1.5 pt-1">
              <div className="flex justify-between">
                <span className="text-zinc-500">Seeker Timezone:</span>
                <span className="font-medium text-zinc-800">
                  {booking.seeker_timezone || 'Asia/Kolkata'}
                </span>
              </div>
            </div>

            <div className="pt-2">
              <span className="text-zinc-400 block text-[11px] font-medium uppercase tracking-wider">
                Topic & Pre-session Note
              </span>
              <p className="text-zinc-700 mt-1 leading-relaxed bg-zinc-50 p-2.5 rounded-lg border border-zinc-100">
                "Discussion on interpersonal communication strategies and constructive conflict resolution."
              </p>
            </div>
          </div>
        </div>

        {/* Schedule & Payment Verification */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
            <h3 className="text-sm font-bold text-zinc-950 flex items-center gap-1.5">
              <CreditCard className="h-4 w-4 text-zinc-500" />
              Schedule & Payment Verification
            </h3>
            <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
              Verified
            </span>
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="flex justify-between">
              <span className="text-zinc-500">Segment:</span>
              <span className="font-medium text-zinc-900">
                {booking.segment?.name || 'Relationship Advisor'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Gig:</span>
              <span className="font-medium text-zinc-900">
                {booking.gig?.title || '1:1 Relationship Guidance'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Session Timing:</span>
              <span className="font-semibold text-zinc-900 text-right">
                {formatSessionTime(booking.start_time, booking.end_time, booking.mentor_timezone)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Duration:</span>
              <span className="font-medium text-zinc-900">60 Minutes</span>
            </div>
            <div className="flex justify-between border-t border-zinc-100 pt-2">
              <span className="text-zinc-500">Payment Amount:</span>
              <span className="font-bold text-zinc-950">₹{booking.amount_inr} INR</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Payment Status:</span>
              <span className="font-semibold text-emerald-700">
                {booking.payment?.status || 'VERIFIED'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Txn Reference:</span>
              <span className="font-mono text-[11px] text-zinc-600">
                {booking.payment?.transaction_reference || 'UPI-REF-90214481'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation & Meeting Link Form */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-100 pb-3">
          <div>
            <h3 className="text-sm font-bold text-zinc-950">
              {isConfirmed ? 'Manage Meeting Link' : 'Confirm Session & Attach Meeting Link'}
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              Enter your video conference link (Google Meet, Zoom, MS Teams, etc.).
            </p>
          </div>

          <div className="text-xs">
            {booking.deadlineInfo && (
              <span
                className={`inline-flex items-center gap-1 font-medium px-2 py-0.5 rounded ${
                  isOverdue
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-zinc-100 text-zinc-600'
                }`}
              >
                <Clock className="h-3 w-3" />
                Deadline: 2h before start ({isOverdue ? 'Overdue' : `~${hoursLeft}h remaining`})
              </span>
            )}
          </div>
        </div>

        <form onSubmit={handleConfirm} className="space-y-4">
          <Input
            id="meeting-url-input"
            label="HTTPS Video Meeting URL"
            value={meetingUrl}
            onChange={(e) => handleUrlChange(e.target.value)}
            placeholder="https://meet.google.com/xxx-xxxx-xxx"
            error={urlError}
            helperText="Must be a valid HTTPS URL. Cannot confirm session without a valid link."
          />

          <div className="rounded-lg bg-zinc-50 p-3.5 text-xs text-zinc-600 border border-zinc-200 space-y-1.5">
            <div className="flex items-center gap-1.5 font-semibold text-zinc-800">
              <Lock className="h-3.5 w-3.5 text-zinc-500" />
              <span>Platform Secrecy & Notification Rules</span>
            </div>
            <ul className="list-disc list-inside space-y-1 text-zinc-600 pl-1">
              <li>
                <strong>Confirmation Requirement:</strong> Session cannot be confirmed without a verified HTTPS meeting link.
              </li>
              <li>
                <strong>Seeker Notification:</strong> Confirming changes status to <code className="bg-zinc-200 px-1 py-0.5 rounded text-[11px]">CONFIRMED</code> and immediately dispatches an in-app notification to the seeker.
              </li>
              <li>
                <strong>Link Privacy:</strong> The actual video link remains hidden from the seeker until 5 minutes before the scheduled start time.
              </li>
            </ul>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-xs text-zinc-500 flex items-center gap-1.5">
              <BellRing className="h-3.5 w-3.5 text-zinc-400" />
              <span>In-app alert will be pushed to {booking.seeker?.full_name || 'seeker'}</span>
            </div>

            <Button
              id="btn-confirm-session"
              type="submit"
              size="md"
              disabled={submitting || !!urlError || !meetingUrl.trim()}
              className="w-full sm:w-auto gap-2 text-xs bg-zinc-900 text-white hover:bg-zinc-800 cursor-pointer"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Processing Confirmation...</span>
                </>
              ) : (
                <>
                  <Video className="h-3.5 w-3.5" />
                  <span>{isConfirmed ? 'Update Meeting Link' : 'Confirm Session'}</span>
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
