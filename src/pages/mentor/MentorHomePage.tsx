import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, Clock, Video, AlertCircle, CheckCircle2, Loader2, User, ShieldCheck } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { fetchMentorBookings } from '@/src/lib/bookingService';
import { apiFetch } from '@/src/lib/apiClient';

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
  const { user, profile, onboardingStatus } = useAuth();
  const { navigate } = useNavigation();
  const [actionBooking, setActionBooking] = useState<Booking | null>(null);
  const [meetingUrl, setMeetingUrl] = useState('');
  const [todaySessions, setTodaySessions] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  const mentorApproved =
    onboardingStatus?.application?.status === 'approved' ||
    (onboardingStatus?.mentorProfile?.is_approved === true
      && onboardingStatus.mentorProfile.approval_status === 'approved'
      && onboardingStatus.mentorProfile.is_active === true);

  const fetchData = useCallback(async () => {
    if (!user?.id || !mentorApproved) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const bookings = await fetchMentorBookings(user.id);
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

      const today = bookings.filter((b) => {
        const start = new Date(b.start_time);
        return start >= todayStart && start < todayEnd && b.status === 'CONFIRMED';
      });
      setTodaySessions(today);

      // Find MENTOR_PENDING booking that needs action
      const pending = bookings.find((b) => b.status === 'MENTOR_PENDING' && !b.meeting_url);
      setActionBooking(pending || null);
    } catch (err: any) {
      console.error('Failed to fetch mentor home data:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id, mentorApproved]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleConfirm = async () => {
    if (!actionBooking || !meetingUrl.trim()) return;
    if (!meetingUrl.startsWith('https://')) {
      alert('Meeting URL must be a valid HTTPS link.');
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
    } catch (err: any) {
      alert('Failed to confirm session: ' + err.message);
    }
  };

  const formatSessionTime = (start: string, end: string, tz: string) => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    return `${startDate.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: tz })} – ${endDate.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: tz })}`;
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-[var(--color-shell-border)] rounded animate-pulse w-1/4" />
        <div className="h-32 bg-[var(--color-shell-border)] rounded animate-pulse" />
        <div className="h-32 bg-[var(--color-shell-border)] rounded animate-pulse" />
      </div>
    );
  }

  const application = onboardingStatus?.application;
  if (!mentorApproved) {
    const statusMessage = application?.status === 'pending_review'
      ? 'Your mentor application is under Admin review.'
      : application?.status === 'rejected'
        ? application.rejection_reason || 'Your mentor application needs updates before it can be reviewed again.'
        : application?.status === 'draft'
          ? 'Continue your mentor application and submit it for review.'
          : 'Complete your mentor profile and submit your application for review.';

    return (
      <div className="max-w-2xl mx-auto py-12">
        <div className="rounded-xl border border-[var(--color-shell-warning)]/30 bg-[var(--color-shell-warning-soft)] p-6 text-center space-y-4">
          <ShieldCheck className="h-10 w-10 mx-auto text-[var(--color-shell-warning)]" />
          <h1 className="text-xl font-bold text-[var(--color-shell-text)]">
            {application?.status === 'pending_review' ? 'Under Admin Review' : 'Mentor Verification Required'}
          </h1>
          <p className="text-sm text-[var(--color-shell-text-muted)]">{statusMessage}</p>
          {application?.submitted_at && <p className="text-xs text-[var(--color-shell-text-subtle)]">Submitted {new Date(application.submitted_at).toLocaleString()}</p>}
          <Button onClick={() => navigate('/mentor/verification')} size="md">
            {application?.status === 'pending_review' ? 'View Application' : application?.status === 'draft' || application?.status === 'rejected' ? 'Continue Verification' : 'Complete Verification'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Action Required Banner */}
      {actionBooking && (
        <div className="rounded-xl border border-[var(--color-shell-warning)] bg-[var(--color-shell-warning-soft)]/50 p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-[var(--color-shell-warning)]/70 flex items-center justify-center font-bold text-[var(--status-warning-strong)] text-sm">
                {actionBooking.seeker?.full_name?.charAt(0) || 'S'}
              </div>
              <div>
                <h3 className="text-base font-bold text-[var(--color-shell-text)]">{actionBooking.seeker?.full_name || 'Seeker'}</h3>
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

          <div className="flex flex-col sm:flex-row items-center gap-3 shrink-0">
            <input
              type="url"
              placeholder="https://meet.google.com/your-meeting-link"
              value={meetingUrl}
              onChange={(e) => setMeetingUrl(e.target.value)}
              className="flex-1 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] px-3 py-2 text-xs text-[var(--color-shell-text)]"
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

          <div className="text-[11px] text-[var(--color-shell-warning)]/80 flex items-center gap-1.5 pt-1">
            <AlertCircle className="h-3.5 w-3.5" />
            <span>Recommended deadline: Add meeting URL at least 2 hours before start. System records missed deadlines for platform audit.</span>
          </div>
        </div>
      )}

      {/* Today's Schedule Overview */}
      <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-xs space-y-4">
        <h2 className="text-base font-bold text-[var(--color-shell-text)] border-b border-[var(--color-shell-border)] pb-3 flex items-center justify-between">
          <span>Today's Confirmed Sessions</span>
          <span className="text-xs font-normal text-[var(--color-shell-text-muted)]">Local Time: {profile?.timezone || 'Asia/Kolkata'}</span>
        </h2>

        {todaySessions.length === 0 ? (
          <div className="p-4 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg-hover)]/70 text-center text-xs text-[var(--color-shell-text-muted)]">
            No confirmed sessions scheduled for today.
          </div>
        ) : (
          todaySessions.map((session) => (
            <div key={session.id} className="p-4 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg-hover)]/70 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="success">CONFIRMED</Badge>
                  <span className="font-bold text-sm text-[var(--color-shell-text)]">
                    {session.seeker?.full_name || 'Seeker'} · {session.segment?.name || 'Unknown Segment'}
                  </span>
                </div>
                <p className="text-xs text-[var(--color-shell-text-muted)]">
                  {formatSessionTime(session.start_time, session.end_time, session.mentor_timezone)} · {session.meeting_url ? 'Google Meet Attached' : 'Meeting link pending'}
                </p>
              </div>
              <Button
                onClick={() => navigate(`/mentor/booking-detail?id=${session.id}`)}
                variant="outline"
                size="sm"
                className="text-xs"
              >
                Session Details
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};