import React, { useState, useEffect } from 'react';
import { ArrowLeft, Calendar, Clock, Video, FileText, AlertCircle, ShieldCheck, XCircle } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { useNavigation } from '@/src/context/NavigationContext';
import { fetchBookingDetail, EnrichedBookingRecord } from '@/src/lib/bookingService';
import { formatLocalTimeLabel } from '@/src/lib/slotEngine';
import { BookingStatus } from '@/src/types/database';

export const SeekerBookingDetailPage: React.FC = () => {
  const { navigate, currentPath } = useNavigation();

  const getBookingIdFromUrl = (): string => {
    const params = new URLSearchParams(currentPath.includes('?') ? currentPath.split('?')[1] : '');
    return params.get('bookingId') || '';
  };

  const [bookingId, setBookingId] = useState<string>(getBookingIdFromUrl());
  const [booking, setBooking] = useState<EnrichedBookingRecord | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadBooking = async () => {
    if (!bookingId) {
      setLoading(false);
      setError('No booking reference provided.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchBookingDetail(bookingId);
      setBooking(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load booking details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBooking();
  }, [bookingId]);

  const statusSteps = (status: BookingStatus) => {
    const allSteps = [
      { label: 'Payment Verified', statuses: ['CONFIRMED', 'COMPLETED'] },
      { label: 'Mentor Confirmed', statuses: ['CONFIRMED', 'COMPLETED'] },
      { label: 'Scheduled (T-5 Join)', statuses: ['CONFIRMED', 'COMPLETED'] },
      { label: 'Workspace & Notes', statuses: ['COMPLETED'] },
    ];
    return allSteps.map((step) => ({
      ...step,
      isComplete: step.statuses.includes(status),
      isCurrent: status === 'MENTOR_PENDING' && step.label === 'Payment Verified',
    }));
  };

  const steps = booking ? statusSteps(booking.status) : [];

  const canCancel = booking && booking.status === 'CONFIRMED';
  const isConfirmed = booking?.status === 'CONFIRMED';

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <button
        onClick={() => navigate('/seeker/bookings')}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)] transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        <span>Back to My Bookings</span>
      </button>

      {loading ? (
        <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-12 text-center space-y-3">
          <Calendar className="h-8 w-8 text-[var(--color-shell-text-subtle)] mx-auto animate-spin" />
          <h3 className="text-sm font-semibold text-[var(--color-shell-text)]">Loading Booking Details...</h3>
          <p className="text-xs text-[var(--color-shell-text-muted)]">Retrieving booking information from database.</p>
        </div>
      ) : error || !booking ? (
        <EmptyState
          icon={AlertCircle}
          title="Booking Not Found"
          description={error || `Could not find booking ${bookingId}. It may have been cancelled or does not exist.`}
          actionLabel="View My Bookings"
          onAction={() => navigate('/seeker/bookings')}
        />
      ) : (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--color-shell-border)] pb-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-[var(--color-shell-text)]">Booking #{booking.booking_code}</h1>
                <Badge variant={isConfirmed ? 'success' : booking.status === 'COMPLETED' ? 'secondary' : 'warning'}>
                  {booking.status}
                </Badge>
              </div>
              <p className="text-xs text-[var(--color-shell-text-muted)] mt-0.5">
                {isConfirmed
                  ? `Confirmed by mentor ${booking.mentor?.full_name || 'Mentor'} · Meeting URL ${booking.meeting_url ? 'attached' : 'pending'}`
                  : `Status: ${booking.status} · Awaiting next action`}
              </p>
            </div>

            {isConfirmed && (
              <Button
                onClick={() => navigate(`/seeker/session?bookingId=${booking.id}`)}
                size="sm"
                className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <Video className="h-3.5 w-3.5" />
                <span>Join Session Room</span>
              </Button>
            )}
          </div>

          <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-5 shadow-xs space-y-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-shell-text-subtle)]">
              Booking Lifecycle Progression
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
              {steps.map((step, idx) => (
                <div
                  key={idx}
                  className={`p-2.5 rounded-lg ${
                    step.isComplete
                      ? 'bg-emerald-50 text-emerald-800 font-bold border border-emerald-200'
                      : 'bg-zinc-100 text-[var(--color-shell-text-muted)] font-medium'
                  }`}
                >
                  {idx + 1}. {step.label}
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-xs space-y-4">
              <h3 className="text-sm font-bold text-[var(--color-shell-text)] border-b border-[var(--color-shell-border)] pb-2">
                Session Details
              </h3>
              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-[var(--color-shell-text-muted)]">Mentor:</span>
                  <span className="font-semibold text-[var(--color-shell-text)]">{booking.mentor?.full_name || 'Mentor'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-shell-text-muted)]">Segment:</span>
                  <span className="text-[var(--color-shell-text)]">{booking.segment?.name || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-shell-text-muted)]">Gig:</span>
                  <span className="text-[var(--color-shell-text)]">{booking.gig?.title || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-shell-text-muted)]">Duration:</span>
                  <span className="font-medium text-[var(--color-shell-text)]">{booking.gig?.duration_minutes || 60} Minutes</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-shell-text-muted)]">Scheduled Time:</span>
                  <span className="font-semibold text-[var(--color-shell-text)]">
                    {new Date(booking.start_time).toLocaleDateString('en-IN', {
                      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
                    })} · {formatLocalTimeLabel(booking.start_time)} – {formatLocalTimeLabel(booking.end_time)} (IST)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-shell-text-muted)]">Booking Ref:</span>
                  <span className="font-mono text-[var(--color-shell-text)]">#{booking.booking_code}</span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-xs space-y-3 text-xs text-[var(--color-shell-text-muted)]">
              <h3 className="text-sm font-bold text-[var(--color-shell-text)] border-b border-[var(--color-shell-border)] pb-2">
                Policies & Actions
              </h3>
              <div className="flex items-start gap-2 text-[var(--color-shell-warning)] bg-[var(--color-shell-warning-soft)] p-3 rounded-lg border border-[var(--color-shell-warning)]/30">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  <strong>24-Hour Policy:</strong> Standard seeker cancellation or rescheduling is allowed only ≥ 24 hours prior to session start.
                </span>
              </div>

              <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
                For emergency rescheduling within 24 hours, contact platform administration.
              </p>

              <div className="pt-2 flex flex-col gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs text-[var(--color-shell-text-subtle)] border-[var(--color-shell-border)] cursor-not-allowed"
                  disabled
                >
                  Cancel Session (Locked &lt; 24h)
                </Button>
                {!canCancel && (
                  <p className="text-[10px] text-[var(--color-shell-text-subtle)] text-center">
                    {booking.status === 'MENTOR_PENDING'
                      ? 'Cancellation available after mentor confirmation and 24h before session.'
                      : booking.status === 'COMPLETED'
                      ? 'Session completed. No cancellation available.'
                      : 'Session confirmed within 24h window. Cancellation locked.'}
                  </p>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};