import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, Clock, Video, AlertCircle, CheckCircle2, Loader2, User } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { fetchMentorBookings } from '@/src/lib/bookingService';

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
  const { user, profile } = useAuth();
  const { navigate } = useNavigation();
  const [actionBooking, setActionBooking] = useState<Booking | null>(null);
  const [meetingUrl, setMeetingUrl] = useState('');
  const [todaySessions, setTodaySessions] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!user?.id) return;
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
  }, [user?.id]);

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
      const res = await fetch(`/api/mentor/bookings/${actionBooking.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mentorId: user?.id, meetingUrl }),
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
        <div className="h-8 bg-zinc-100 rounded animate-pulse w-1/4" />
        <div className="h-32 bg-zinc-100 rounded animate-pulse" />
        <div className="h-32 bg-zinc-100 rounded animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Action Required Banner */}
      {actionBooking && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-amber-200/70 flex items-center justify-center font-bold text-amber-950 text-sm">
                {actionBooking.seeker?.full_name?.charAt(0) || 'S'}
              </div>
              <div>
                <h3 className="text-base font-bold text-zinc-950">{actionBooking.seeker?.full_name || 'Seeker'}</h3>
                <p className="text-xs text-zinc-600">
                  Segment: {actionBooking.segment?.name || 'Unknown'} · Gig: {actionBooking.gig?.title || 'Unknown'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-700 font-medium pt-1">
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5 text-zinc-500" />
                {new Date(actionBooking.start_time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
              <span>·</span>
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5 text-zinc-500" />
                {formatSessionTime(actionBooking.start_time, actionBooking.end_time, actionBooking.mentor_timezone)}
              </span>
              <span>·</span>
              <span className="font-bold text-emerald-800">Fee: ₹{actionBooking.amount_inr} Verified</span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-3 shrink-0">
            <input
              type="url"
              placeholder="https://meet.google.com/your-meeting-link"
              value={meetingUrl}
              onChange={(e) => setMeetingUrl(e.target.value)}
              className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900"
            />
            <Button
              onClick={handleConfirm}
              className="w-full sm:w-auto gap-1.5 text-xs bg-zinc-900 hover:bg-zinc-800 text-white"
              size="md"
              disabled={!meetingUrl.trim()}
            >
              <Video className="h-3.5 w-3.5" />
              <span>Add Link & Confirm Session</span>
            </Button>
          </div>

          <div className="text-[11px] text-amber-800/80 flex items-center gap-1.5 pt-1">
            <AlertCircle className="h-3.5 w-3.5" />
            <span>Recommended deadline: Add meeting URL at least 2 hours before start. System records missed deadlines for platform audit.</span>
          </div>
        </div>
      )}

      {/* Today's Schedule Overview */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-4">
        <h2 className="text-base font-bold text-zinc-950 border-b border-zinc-100 pb-3 flex items-center justify-between">
          <span>Today's Confirmed Sessions</span>
          <span className="text-xs font-normal text-zinc-500">Local Time: {profile?.timezone || 'Asia/Kolkata'}</span>
        </h2>

        {todaySessions.length === 0 ? (
          <div className="p-4 rounded-lg border border-zinc-100 bg-zinc-50/70 text-center text-xs text-zinc-500">
            No confirmed sessions scheduled for today.
          </div>
        ) : (
          todaySessions.map((session) => (
            <div key={session.id} className="p-4 rounded-lg border border-zinc-100 bg-zinc-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="success">CONFIRMED</Badge>
                  <span className="font-bold text-sm text-zinc-900">
                    {session.seeker?.full_name || 'Seeker'} · {session.segment?.name || 'Unknown Segment'}
                  </span>
                </div>
                <p className="text-xs text-zinc-500">
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