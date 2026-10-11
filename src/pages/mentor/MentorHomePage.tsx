import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, Clock, Video, AlertCircle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { useToast } from '@/src/context/ToastContext';
import { fetchMentorBookings } from '@/src/lib/bookingService';
import { apiFetch } from '@/src/lib/apiClient';
import { toUserMessage } from '@/src/lib/errorMessages';
import { logSanitizer } from '@/src/lib/logSanitizer';
import { isBookingUpcoming } from '@/src/lib/sessionState';
import { MEETING_LINK_DEADLINE_MINUTES } from '@/src/config/app';
import { MentorActionBanner } from '@/src/components/mentor/MentorActionBanner';
import { MentorEmptyState } from '@/src/components/mentor/MentorEmptyState';
import type { EnrichedBookingRecord } from '@/src/lib/bookingService';

interface Booking {
  id: string;
  booking_code: string;
  mentor_id: string;
  seeker_id: string;
  gig_id: string;
  segment_id: string;
  hold_id: string | null;
  start_time: string;
  end_time: string;
  seeker_timezone: string;
  mentor_timezone: string;
  amount_inr: number;
  status: string;
  meeting_url: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
  seeker?: { full_name: string };
  gig?: { title: string };
  segment?: { name: string };
}

export const MentorHomePage: React.FC = () => {
  const { user, profile, onboardingStatus, mentorVerificationState } = useAuth();
  const { navigate } = useNavigation();
  const toast = useToast();
  const [actionBooking, setActionBooking] = useState<Booking | null>(null);
  const [meetingUrl, setMeetingUrl] = useState('');
  const [todaySessions, setTodaySessions] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  const isVerified = mentorVerificationState === 'verified';
  const isNotVerified = mentorVerificationState === 'not_verified';
  const isVerificationLoading = mentorVerificationState === 'loading';

  const fetchData = useCallback(async () => {
    if (!user?.id || !isVerified) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const bookings = await fetchMentorBookings(user.id) as unknown as Booking[];
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

      const stillActionable = (b: Booking): boolean => {
        const server = (b as Booking & { isUpcoming?: boolean }).isUpcoming;
        if (typeof server === 'boolean') return server;
        return isBookingUpcoming(b, Date.now());
      };

      const today = bookings.filter((b) => {
        const start = new Date(b.start_time);
        if (Number.isNaN(start.getTime())) return false;
        return start >= todayStart && start < todayEnd && stillActionable(b);
      });
      setTodaySessions(today);

      const pending = bookings.find((b) => b.status === 'MENTOR_PENDING' && !b.meeting_url);
      setActionBooking(pending || null);
    } catch (err: any) {
      console.error('Failed to fetch mentor home data:', logSanitizer.safeMessage(err));
    } finally {
      setLoading(false);
    }
  }, [user?.id, isVerified]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleConfirm = async () => {
    if (!actionBooking || !meetingUrl.trim()) return;
    if (!meetingUrl.startsWith('https://')) {
      toast.error('The meeting link must be a valid HTTPS address.', { title: 'Link not accepted' });
      return;
    }
    try {
      const res = await apiFetch(`/api/mentor/bookings/${actionBooking.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingUrl }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to confirm session');
      await fetchData();
      setActionBooking(null);
      setMeetingUrl('');
      toast.success('The seeker has been notified that this session is confirmed.', {
        title: 'Session confirmed',
      });
    } catch (err: unknown) {
      toast.error(toUserMessage(err, 'We could not confirm this session. Please try again.', { action: 'confirm_session' }), {
        title: 'Confirmation failed',
      });
    }
  };

  const formatSessionTime = (start: string, end: string, tz: string) => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    return `${startDate.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: tz })} – ${endDate.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: tz })}`;
  };

  if (loading || isVerificationLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-[var(--color-shell-border)] rounded animate-pulse w-1/4" />
        <div className="h-32 bg-[var(--color-shell-border)] rounded animate-pulse" />
        <div className="h-32 bg-[var(--color-shell-border)] rounded animate-pulse" />
      </div>
    );
  }

  const application = onboardingStatus?.application;
  if (isNotVerified) {
    return (
      <div className="max-w-2xl mx-auto py-12">
        <div className="rounded-xl border border-[var(--color-shell-warning)]/30 bg-[var(--color-shell-warning-soft)] p-6 text-center space-y-4">
          <ShieldCheck className="h-10 w-10 mx-auto text-[var(--color-shell-warning)]" />
          <h1 className="text-xl font-bold text-[var(--color-shell-text)]">
            {application?.status === 'pending_review' ? 'Under Admin Review' : 'Mentor Verification Required'}
          </h1>
          <p className="text-sm text-[var(--color-shell-text-muted)]">
            {application?.status === 'pending_review'
              ? 'Your mentor application is under Admin review.'
              : application?.status === 'rejected'
                ? application.rejection_reason || 'Your mentor application needs updates before it can be reviewed again.'
                : application?.status === 'draft'
                  ? 'Continue your mentor application and submit it for review.'
                  : 'Complete your mentor profile and submit your application for review.'}
          </p>
          {application?.submitted_at && (
            <p className="text-xs text-[var(--color-shell-text-subtle)]">
              Submitted {new Date(application.submitted_at).toLocaleString()}
            </p>
          )}
          <Button onClick={() => navigate('/mentor/verification')} size="md">
            {application?.status === 'pending_review'
              ? 'View Application'
              : application?.status === 'draft' || application?.status === 'rejected'
                ? 'Continue Verification'
                : 'Complete Verification'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-shell-text)] sm:text-3xl">
            Mentor Dashboard
          </h1>
          <p className="mt-1.5 text-sm text-[var(--color-shell-text-muted)] max-w-2xl">
            Your operational command center. Confirm upcoming sessions, manage your calendar, and review past bookings — all in one place.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            onClick={() => navigate('/mentor/availability')}
            variant="secondary"
            size="sm"
            className="gap-1.5 text-xs"
          >
            <Calendar className="h-3.5 w-3.5" />
            <span>Manage Availability</span>
          </Button>
          <Button
            onClick={() => navigate('/mentor/bookings')}
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
          >
            <span>View All Bookings</span>
          </Button>
        </div>
      </div>

      {/* Action Required Banner */}
      {actionBooking && (
        <div className="rounded-xl border border-[var(--color-shell-warning)]/40 bg-[var(--color-shell-warning-soft)] p-5 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 shrink-0 rounded-full bg-[var(--color-shell-warning)]/70 flex items-center justify-center font-bold text-[var(--status-warning-strong)] text-sm">
                {actionBooking.seeker?.full_name?.charAt(0) || 'S'}
              </div>
              <div>
                <h3 className="text-base font-bold text-[var(--color-shell-text)]">
                  Action Required: {actionBooking.seeker?.full_name || 'Seeker'}
                </h3>
                <p className="text-xs text-[var(--color-shell-text-muted)]">
                  Segment: {actionBooking.segment?.name || 'Unknown'} · Gig: {actionBooking.gig?.title || 'Unknown'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--color-shell-text-muted)] font-medium pt-1">
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5 text-[var(--color-shell-text-subtle)]" />
                {new Date(actionBooking.start_time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
              <span>·</span>
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5 text-[var(--color-shell-text-subtle)]" />
                {formatSessionTime(actionBooking.start_time, actionBooking.end_time, actionBooking.mentor_timezone)}
              </span>
              <span>·</span>
              <span className="font-bold text-[var(--color-shell-success)]">Fee: ₹{actionBooking.amount_inr} Verified</span>
            </div>
          </div>

          <div className="mt-4 flex flex-col sm:flex-row items-center gap-3">
            <input
              type="url"
              placeholder="https://meet.google.com/your-meeting-link"
              value={meetingUrl}
              onChange={(e) => setMeetingUrl(e.target.value)}
              className="flex-1 rounded-lg border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-surface)] px-3 py-2 text-xs text-[var(--color-shell-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-shell-primary)]"
            />
            <Button
              onClick={handleConfirm}
              className="w-full sm:w-auto gap-1.5 text-xs"
              size="md"
              disabled={!meetingUrl.trim()}
            >
              <Video className="h-3.5 w-3.5" />
              <span>Add Link & Confirm Session</span>
            </Button>
          </div>

          <div className="mt-2 text-[11px] text-[var(--color-shell-text-subtle)] flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5 text-[var(--color-shell-warning)]" />
            <span>Recommended deadline: Add meeting URL at least {MEETING_LINK_DEADLINE_MINUTES} minutes before start. System records missed deadlines for platform audit.</span>
          </div>
        </div>
      )}

      {/* Today's Schedule */}
      <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-[var(--color-shell-border)]">
          <h2 className="text-base font-bold text-[var(--color-shell-text)]">
            Today's Confirmed Sessions
          </h2>
          <span className="text-xs text-[var(--color-shell-text-muted)]">
            Local Time: {profile?.timezone || 'Asia/Kolkata'}
          </span>
        </div>

        {todaySessions.length === 0 ? (
          <MentorEmptyState
            title="No sessions today"
            description="You have no confirmed sessions scheduled for today. Your upcoming sessions will appear here when you confirm them."
            actionLabel="View All Bookings"
            onAction={() => navigate('/mentor/bookings')}
          />
        ) : (
          <div className="space-y-2">
            {todaySessions.map((session) => (
              <div
                key={session.id}
                className="group rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg-hover)]/50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors"
              >
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="success" className="text-xs">
                      CONFIRMED
                    </Badge>
                    <span className="font-bold text-sm text-[var(--color-shell-text)]">
                      {session.seeker?.full_name || 'Seeker'} · {session.segment?.name || 'Unknown Segment'}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--color-shell-text-muted)]">
                    {formatSessionTime(session.start_time, session.end_time, session.mentor_timezone)} · {session.meeting_url ? 'Google Meet Attached' : 'Meeting link pending'}
                  </p>
                </div>
                <Button
                  onClick={() => navigate(`/mentor/booking-detail?bookingId=${session.id}`)}
                  variant="outline"
                  size="sm"
                  className="text-xs gap-1.5 shrink-0"
                >
                  Session Details
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-xs">
        <h2 className="text-base font-bold text-[var(--color-shell-text)] mb-4">
          Quick Actions
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Button
            onClick={() => navigate('/mentor/bookings')}
            variant="secondary"
            size="sm"
            className="h-auto py-3 flex flex-col items-center gap-1.5 text-xs"
          >
            <Clock className="h-5 w-5 text-[var(--color-shell-text-muted)]" />
            <span>Review Pending Confirmations</span>
          </Button>
          <Button
            onClick={() => navigate('/mentor/availability')}
            variant="secondary"
            size="sm"
            className="h-auto py-3 flex flex-col items-center gap-1.5 text-xs"
          >
            <Calendar className="h-5 w-5 text-[var(--color-shell-text-muted)]" />
            <span>Edit Availability</span>
          </Button>
          <Button
            onClick={() => navigate('/mentor/notifications')}
            variant="secondary"
            size="sm"
            className="h-auto py-3 flex flex-col items-center gap-1.5 text-xs"
          >
            <AlertCircle className="h-5 w-5 text-[var(--color-shell-text-muted)]" />
            <span>Check Notifications</span>
          </Button>
        </div>
      </div>
    </div>
  );
};
