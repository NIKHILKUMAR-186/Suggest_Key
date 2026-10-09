import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, Filter, Clock, Video, CheckCircle2, AlertCircle, AlertTriangle, Eye, ShieldCheck, RefreshCw, Undo2, Loader2 } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { Modal } from '@/src/components/ui/Modal';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { ShortId } from '@/src/components/shared/ShortId';
import { toUserMessage } from '@/src/lib/errorMessages';
import { apiFetch } from '@/src/lib/apiClient';
import { usePaginatedQuery } from '@/src/hooks/usePaginatedQuery';
import { APP_CONFIG, MEETING_LINK_DEADLINE_MINUTES } from '@/src/config/app';
import { formatOverdueDuration, type BookingLifecycle } from '@/src/lib/bookingLifecycle';
import { useToast } from '@/src/context/ToastContext';
import { formatInr } from '@/src/lib/seekerFormat';
import {
  canInitiateRefund,
  type AdminPaymentRow,
} from '@/src/lib/adminPaymentView';
import {
  REFUND_METHODS,
  canProcessManualRefund,
  fromPaise,
  refundMethodLabel,
  refundStatusLabel,
  validateRefundProofFile,
} from '@/src/lib/refundCompletion';
import { supabase, isSupabaseConfigured } from '@/src/lib/supabase';

interface EnrichedBookingRecord {
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
  seeker?: { id: string; full_name: string; email: string; timezone: string } | null;
  mentor?: { id: string; full_name: string; email: string; timezone: string } | null;
  gig?: { id: string; title: string; duration_minutes: number; price_inr: number; segment_id: string } | null;
  segment?: { id: string; name: string; slug: string } | null;
  payment?: {
    id: string;
    status: string;
    amount_inr: number;
    verified_at: string | null;
    proof_storage_path: string | null;
    transaction_reference: string | null;
    gateway: string | null;
    refund_status: string | null;
    refund_id: string | null;
    refund_amount_paise: number | null;
    refund_method: string | null;
    refund_reference: string | null;
    refunded_at: string | null;
    refunded_by: string | null;
    refund_admin_note: string | null;
    failure_reason: string | null;
    manual_refund_required: boolean | null;
  } | null;
  deadlineInfo?: {
    deadlineUtc: string;
    isOverdue: boolean;
    hoursUntilSession: number;
    minutesUntilSession: number;
  };
  /**
   * The server-resolved lifecycle bucket, stamped by `GET /api/admin/bookings`
   * from the same resolver the mentor ledger uses.
   *
   * This page filters on `lifecycle.bucket === 'OVERDUE'` rather than on its own
   * `status + deadlineInfo.isOverdue` predicate, so an admin and a mentor can
   * never be looking at two different overdue sets for the same booking.
   */
  lifecycle?: BookingLifecycle;
}

export const AdminBookingsPage: React.FC = () => {
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [selectedBooking, setSelectedBooking] = useState<EnrichedBookingRecord | null>(null);
  const [overdueCount, setOverdueCount] = useState<number>(0);
  const [isConfirmingRefund, setIsConfirmingRefund] = useState(false);
  const [isInitiatingRefund, setIsInitiatingRefund] = useState(false);
  const [isRefunding, setIsRefunding] = useState(false);
  const [refundForm, setRefundForm] = useState({ amount: '', method: 'UPI', reference: '', note: '' });
  const [refundFile, setRefundFile] = useState<File | null>(null);
  const [isSubmittingRefund, setIsSubmittingRefund] = useState(false);

  const {
    data: bookings = [],
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    loadMore,
    refetch,
  } = usePaginatedQuery<EnrichedBookingRecord>({
    url: '/api/admin/bookings',
    pageSize: 6,
    enabled: true,
  });

  const loadBookings = useCallback(async () => {
    await refetch();
  }, [refetch]);

  useEffect(() => {
    loadBookings();
  }, [loadBookings]);

  // Calculate overdue count when bookings change
  useEffect(() => {
    const overdue = bookings.filter((b) => b.lifecycle?.bucket === 'OVERDUE');
    setOverdueCount(overdue.length);
  }, [bookings]);

  const filtered = bookings.filter((b) => {
    if (filterStatus === 'ALL') return true;
    if (filterStatus === 'OVERDUE_LINKS') {
      return b.lifecycle?.bucket === 'OVERDUE';
    }
    return b.status === filterStatus;
  });

  /**
   * Renders a UTC instant in the MENTOR's own timezone, which the booking row
   * stores in `mentor_timezone`. The platform default is only a fallback for a
   * row that somehow has no recorded zone; a zone is never invented per render.
   */
  const formatScheduledTime = (isoString: string, timeZone?: string | null) => {
    const zone = timeZone || APP_CONFIG.DEFAULT_TIMEZONE;
    try {
      return new Date(isoString).toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: zone,
      });
    } catch {
      return isoString;
    }
  };

  const toast = useToast();

  const handleInitiateRefund = async (booking: EnrichedBookingRecord) => {
    if (!booking.payment?.id) return;
    setIsConfirmingRefund(false);
    setIsInitiatingRefund(true);
    try {
      const res = await apiFetch(`/api/admin/payments/${booking.payment.id}/initiate-refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error?.message || 'The refund could not be initiated.');
      await loadBookings();
      toast.success(data.refund?.message ?? 'The refund has been initiated.', { title: 'Refund initiated' });
    } catch (err: unknown) {
      toast.error(toUserMessage(err, 'The refund could not be initiated. Nothing was recorded.', { action: 'initiate-refund' }), { title: 'Refund not initiated' });
    } finally {
      setIsInitiatingRefund(false);
    }
  };

  const handleCompleteRefund = async (booking: EnrichedBookingRecord) => {
    if (!booking.payment?.id) return;
    const checked = validateRefundProofFile(refundFile ? { name: refundFile.name, type: refundFile.type, size: refundFile.size } : null);
    if (!checked.ok) {
      toast.error(checked.message, { title: 'Proof required' });
      return;
    }
    const amount = Number(refundForm.amount);
    if (!Number.isFinite(amount)) {
      toast.error('Enter the refund amount as a number.', { title: 'Amount required' });
      return;
    }
    const reference = refundForm.reference.trim();
    if (!reference) {
      toast.error('Enter the refund reference / UTR from the transfer receipt.', { title: 'Reference required' });
      return;
    }
    setIsSubmittingRefund(true);
    let storagePath: string | null = null;
    try {
      const random = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      storagePath = `refunds/${booking.payment.id}/${random}-${refundFile!.name}`;
      const { error: uploadErr } = await supabase.storage.from('payment-proofs').upload(storagePath, refundFile!, { contentType: refundFile!.type, upsert: false, cacheControl: '3600' });
      if (uploadErr) throw uploadErr;
      const res = await apiFetch(`/api/admin/payments/${booking.payment.id}/complete-manual-refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refundAmountInr: amount,
          refundMethod: refundForm.method,
          refundReference: reference,
          storagePath,
          fileName: refundFile!.name,
          mimeType: refundFile!.type,
          fileSize: refundFile!.size,
          ...(refundForm.note.trim() ? { adminNote: refundForm.note.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error?.message || 'The refund could not be completed.');
      setSelectedBooking(null);
      setIsRefunding(false);
      setRefundFile(null);
      setRefundForm({ amount: '', method: 'UPI', reference: '', note: '' });
      await loadBookings();
      toast.success(`The refund of ₹${amount.toLocaleString('en-IN')} has been recorded as completed and the seeker has been notified.`, { title: 'Refund completed' });
    } catch (err: unknown) {
      toast.error(toUserMessage(err, 'The refund could not be completed. Nothing was recorded.', { action: 'complete-refund' }), { title: 'Refund not completed' });
    } finally {
      setIsSubmittingRefund(false);
    }
  };

  const openRefundForm = () => {
    const payment = selectedBooking?.payment;
    setRefundForm({ amount: payment ? String(payment.amount_inr) : '', method: 'UPI', reference: '', note: '' });
    setRefundFile(null);
    setIsRefunding(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[var(--color-shell-border)] pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-shell-text)] sm:text-3xl">
            Bookings Ledger
          </h1>
          <p className="mt-1 text-xs text-[var(--color-shell-text-muted)]">
            Authoritative state machine timeline of all slot holds, payments, and confirmations.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={loadBookings} variant="outline" size="sm" className="text-xs gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh Ledger</span>
          </Button>

          <div className="flex flex-wrap items-center gap-1 bg-[var(--color-shell-bg-hover)] p-1 rounded-lg self-start text-xs">
            {[
              { id: 'ALL', label: 'ALL' },
              { id: 'OVERDUE_LINKS', label: `OVERDUE LINKS (${overdueCount})`, isAlert: overdueCount > 0 },
              { id: 'MENTOR_PENDING', label: 'MENTOR_PENDING' },
              { id: 'CONFIRMED', label: 'CONFIRMED' },
              { id: 'PAYMENT_PENDING', label: 'PAYMENT_PENDING' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilterStatus(tab.id)}
                className={`px-2.5 py-1 rounded-md font-medium text-[11px] transition-colors cursor-pointer flex items-center gap-1 ${
                  filterStatus === tab.id
                    ? tab.id === 'OVERDUE_LINKS'
                      ? 'bg-[var(--color-shell-warning)] text-[var(--color-shell-text-contrast)] font-bold shadow-xs'
                      : 'bg-[var(--color-shell-surface)] text-[var(--color-shell-text)] shadow-xs font-bold'
                    : tab.isAlert
                    ? 'text-[var(--color-shell-warning)] font-semibold hover:bg-[var(--color-shell-warning-soft)]'
                    : 'text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)]'
                }`}
              >
                {tab.isAlert && <AlertTriangle className="h-3 w-3 shrink-0" />}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Overdue Links Admin Advisory */}
      {overdueCount > 0 && (
        <>
          <div className="rounded-xl border border-[var(--color-shell-warning)] bg-[var(--color-shell-warning-soft)] p-4 flex items-start justify-between gap-3 text-xs text-[var(--status-warning-strong)]">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 text-[var(--color-shell-warning)] shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-sm block">
                  {overdueCount} Overdue Mentor Meeting Link(s) Identified
                </span>
                <p className="mt-0.5 text-[var(--color-shell-text-muted)] leading-relaxed">
                  Platform Rule: Recommended deadline is {MEETING_LINK_DEADLINE_MINUTES} minutes before session. Missing the deadline does <strong>not</strong> automatically cancel the session. Admins can audit and send mentor reminders.
                </p>
              </div>
            </div>

            <Button
              size="sm"
              onClick={() => setFilterStatus('OVERDUE_LINKS')}
              className="text-xs shrink-0 bg-[var(--color-shell-warning)] text-[var(--color-shell-text-contrast)] hover:bg-[var(--color-shell-warning)]/90"
            >
              Filter Overdue
            </Button>
          </div>
        </>
      )}

      {isLoading ? (
        <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-12 text-center space-y-3">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-[var(--color-shell-primary)] border-t-transparent mx-auto" />
          <p className="text-xs text-[var(--color-shell-text-muted)]">Loading operational ledger...</p>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center space-y-2">
          <AlertCircle className="h-6 w-6 text-rose-600 mx-auto" />
          <p className="text-xs text-rose-900">{error.message}</p>
          <p className="text-[11px] text-rose-700">
            The ledger is unavailable. No booking data is being shown, and no value below is a placeholder.
          </p>
          <Button size="sm" variant="outline" onClick={loadBookings} className="text-xs">
            Retry
          </Button>
        </div>
      ) : (
        <>
          {/* Bookings Table */}
          <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] shadow-xs overflow-hidden">
            <div className="table-scroll">
            <table className="w-full text-left text-xs text-[var(--color-shell-text-muted)]">
              <thead className="bg-[var(--color-shell-bg-hover)]/70 border-b border-[var(--color-shell-border)] text-[var(--color-shell-text)] font-semibold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-4">Booking Code</th>
                  <th className="py-3 px-4">Seeker ➔ Mentor</th>
                  <th className="py-3 px-4">Gig ➔ Segment</th>
                  <th className="py-3 px-4">Scheduled Time</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Meeting Link Deadline</th>
                  <th className="py-3 px-4">Payment</th>
                  <th className="py-3 px-4 text-right">Audit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-shell-border)]">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-[var(--color-shell-text-subtle)]">
                      No bookings found matching filter "{filterStatus}".
                    </td>
                  </tr>
                ) : (
                  filtered.map((b) => {
const isOverdue = b.lifecycle?.bucket === 'OVERDUE';
                  const minutesLeft = b.deadlineInfo?.minutesUntilSession;

                return (
                  <tr
                    key={b.id}
                    className={`hover:bg-zinc-50/50 transition-colors ${
                      isOverdue ? 'bg-amber-50/30' : ''
                    }`}
                  >
                    <td className="py-3 px-4 font-mono font-bold text-zinc-950">
                      #{b.booking_code}
                    </td>
                    <td className="py-3 px-4">
                      <span className="block font-bold text-zinc-900 break-words">
                        {b.seeker?.full_name || 'Seeker'}
                      </span>
                      <span className="text-[11px] text-zinc-400">
                        Mentor: {b.mentor?.full_name || 'Mentor'}
                      </span>
                      {b.mentor_id && (
                        <span className="text-[10px] text-zinc-400">
                          <ShortId value={b.mentor_id} label="Mentor ID" />
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className="block font-bold text-zinc-900 break-words">
                        {b.gig?.title || 'Gig unavailable'}
                      </span>
                      <span className="text-[11px] text-zinc-400">
                        {b.segment?.name || 'Segment unavailable'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-zinc-700">
                      {formatScheduledTime(b.start_time, b.mentor_timezone)}
                    </td>
                    <td className="py-3 px-4">
                      <Badge
                        variant={
                          b.status === 'CONFIRMED'
                            ? 'success'
                            : b.status === 'MENTOR_PENDING'
                            ? 'warning'
                            : 'secondary'
                        }
                        className="text-[10px]"
                      >
                        {b.status}
                      </Badge>
                    </td>
                    <td className="py-3 px-4">
                      {b.meeting_url ? (
                        <span className="text-emerald-700 font-medium flex items-center gap-1 text-[11px]">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          <span>Confirmed (HTTPS)</span>
                        </span>
                      ) : isOverdue ? (
                        <span className="inline-flex items-center gap-1 text-amber-900 font-bold bg-amber-100 px-2 py-0.5 rounded text-[11px] border border-amber-300">
                          <AlertTriangle className="h-3 w-3 text-amber-700" />
                          OVERDUE · {formatOverdueDuration(b.lifecycle?.overdueByMs ?? 0)}
                        </span>
                      ) : b.status === 'MENTOR_PENDING' ? (
                        <span className="text-zinc-500 text-[11px]">
                          Due {MEETING_LINK_DEADLINE_MINUTES}m before ({minutesLeft !== undefined && minutesLeft > 0 ? `~${minutesLeft}m left` : 'Pending'})
                        </span>
                      ) : (
                        <span className="text-zinc-400 italic text-[11px]">N/A</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-semibold text-zinc-900">
                      ₹{b.amount_inr}
                      {b.payment?.status === 'VERIFIED' && (
                        <span className="ml-1 text-[10px] text-emerald-600 font-normal">
                          (Verified)
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => setSelectedBooking(b)}
                        className="text-zinc-500 hover:text-zinc-900 p-1 rounded cursor-pointer"
                        title="View Detailed Audit"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
            </tbody>
        </table>
        </div>
      </div>

      {hasMore && !isLoadingMore && (
        <div className="flex justify-center p-4 border-t border-[var(--color-shell-border)]">
          <Button
            onClick={loadMore}
            variant="outline"
            size="lg"
            className="min-w-[200px]"
            aria-label="Load more bookings"
          >
            Load more bookings
          </Button>
        </div>
      )}
      {isLoadingMore && (
        <div className="flex justify-center p-4 border-t border-[var(--color-shell-border)]">
          <Button
            variant="outline"
            size="lg"
            className="min-w-[200px]"
            disabled
          >
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            Loading...
          </Button>
        </div>
      )}

      {/* Booking Detail Modal */}
      {selectedBooking && (
        <Modal
          isOpen={!!selectedBooking}
          onClose={() => setSelectedBooking(null)}
          title={`Booking Audit: #${selectedBooking.booking_code}`}
          description={`Session: ${selectedBooking.gig?.title || 'Gig unavailable'}`}
        >
          <div className="space-y-4 pt-2 text-xs">
            <div className="grid grid-cols-2 gap-3 bg-zinc-50 p-3.5 rounded-lg border border-zinc-100">
              <div>
                <span className="text-zinc-400 block text-[11px]">Seeker</span>
                <span className="font-bold text-zinc-900 break-words">
                  {selectedBooking.seeker?.full_name || 'Seeker'}
                </span>
                {selectedBooking.seeker?.email && (
                  <a
                    href={`mailto:${selectedBooking.seeker.email}`}
                    className="text-zinc-500 hover:text-zinc-900 hover:underline break-all text-[10px]"
                  >
                    {selectedBooking.seeker.email}
                  </a>
                )}
                <span className="text-zinc-400 block text-[10px]">
                  <ShortId value={selectedBooking.seeker_id} label="Seeker ID" />
                </span>
              </div>
              <div>
                <span className="text-zinc-400 block text-[11px]">Mentor</span>
                <span className="font-bold text-zinc-900 break-words">
                  {selectedBooking.mentor?.full_name || 'Mentor'}
                </span>
                {selectedBooking.mentor?.email && (
                  <a
                    href={`mailto:${selectedBooking.mentor.email}`}
                    className="text-zinc-500 hover:text-zinc-900 hover:underline break-all text-[10px]"
                  >
                    {selectedBooking.mentor.email}
                  </a>
                )}
                <span className="text-zinc-400 block text-[10px]">
                  <ShortId value={selectedBooking.mentor_id} label="Mentor ID" />
                </span>
              </div>
              <div>
                <span className="text-zinc-400 block text-[11px]">Scheduled Start</span>
                <span className="text-zinc-800">
                  {formatScheduledTime(selectedBooking.start_time, selectedBooking.mentor_timezone)}
                </span>
              </div>
              <div>
                <span className="text-zinc-400 block text-[11px]">Status</span>
                <Badge
                  variant={
                    selectedBooking.status === 'CONFIRMED'
                      ? 'success'
                      : selectedBooking.status === 'MENTOR_PENDING'
                      ? 'warning'
                      : 'secondary'
                  }
                >
                  {selectedBooking.status}
                </Badge>
              </div>
            </div>

            {/* Meeting Link & Deadline Inspection */}
            <div className="p-3 bg-zinc-50 rounded-lg border border-zinc-200 space-y-1.5">
              <span className="font-semibold text-zinc-900 block text-xs">
                Meeting Link & Deadline
              </span>
              <div className="text-zinc-700 space-y-1">
                <div>
                  <strong>Meeting Link: </strong>
                  {selectedBooking.meeting_url ? (
                    <span className="font-mono text-emerald-800 break-all">
                      {selectedBooking.meeting_url}
                    </span>
                  ) : (
                    <span className="text-amber-700 italic">Not yet provided by mentor</span>
                  )}
                </div>
                <div>
                  <strong>Deadline Status: </strong>
                  {selectedBooking.lifecycle?.bucket === 'OVERDUE' ? (
                    <span className="text-amber-800 font-bold">
                      OVERDUE — deadline was {selectedBooking.deadlineInfo?.deadlineUtc ? new Date(selectedBooking.deadlineInfo.deadlineUtc).toLocaleString('en-IN') : 'T-5min'} before session start, missed by{' '}
                      {formatOverdueDuration(selectedBooking.lifecycle?.overdueByMs ?? 0)}. The booking is NOT auto-cancelled and no refund has been raised.
                    </span>
                  ) : (
                    <span className="text-zinc-600">
                      Recommended {MEETING_LINK_DEADLINE_MINUTES} min before session start.
                    </span>
                  )}
                </div>
              </div>
            </div>

            {selectedBooking.payment && (
              <div className="rounded-lg border border-zinc-200 p-3 space-y-2">
                <span className="font-semibold text-zinc-700 block text-xs">Payment & Refund</span>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-zinc-400 block text-[11px]">Payment Status</span>
                    <Badge variant={selectedBooking.payment.status === 'VERIFIED' ? 'success' : selectedBooking.payment.status === 'PENDING_VERIFICATION' ? 'warning' : 'secondary'} className="text-[10px]">
                      {selectedBooking.payment.status}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-zinc-400 block text-[11px]">Refund Status</span>
                    {selectedBooking.payment.refund_status ? (
                      <Badge variant={selectedBooking.payment.refund_status === 'REFUNDED' ? 'success' : selectedBooking.payment.refund_status === 'PENDING' ? 'warning' : 'destructive'} className="text-[10px]">
                        {refundStatusLabel(selectedBooking.payment.refund_status)}
                      </Badge>
                    ) : (
                      <span className="text-zinc-500">—</span>
                    )}
                  </div>
                  <div>
                    <span className="text-zinc-400 block text-[11px]">Amount</span>
                    <span className="font-bold text-zinc-900">{formatInr(selectedBooking.payment.amount_inr)}</span>
                  </div>
                  <div>
                    <span className="text-zinc-400 block text-[11px]">Gateway</span>
                    <span className="text-zinc-900">{selectedBooking.payment.gateway === 'razorpay' ? 'Razorpay' : 'Manual UPI / QR'}</span>
                  </div>
                  {selectedBooking.payment.transaction_reference && (
                    <div className="col-span-2">
                      <span className="text-zinc-400 block text-[11px]">Transaction Reference</span>
                      <span className="font-mono text-zinc-900 break-all">{selectedBooking.payment.transaction_reference}</span>
                    </div>
                  )}
                  {selectedBooking.payment.refund_status === 'REFUNDED' && (
                    <>
                      <div>
                        <span className="text-zinc-400 block text-[11px]">Refund Amount</span>
                        <span className="font-bold text-zinc-900">{formatInr(fromPaise(selectedBooking.payment.refund_amount_paise) ?? selectedBooking.payment.amount_inr)}</span>
                      </div>
                      <div>
                        <span className="text-zinc-400 block text-[11px]">Refund Method</span>
                        <span className="text-zinc-900">{selectedBooking.payment.refund_method ? refundMethodLabel(selectedBooking.payment.refund_method) : '—'}</span>
                      </div>
                      {selectedBooking.payment.refund_reference && (
                        <div className="col-span-2">
                          <span className="text-zinc-400 block text-[11px]">Refund Reference</span>
                          <span className="font-mono text-zinc-900 break-all">{selectedBooking.payment.refund_reference}</span>
                        </div>
                      )}
                      {selectedBooking.payment.refunded_at && (
                        <div>
                          <span className="text-zinc-400 block text-[11px]">Refunded At</span>
                          <span className="text-zinc-900">{new Date(selectedBooking.payment.refunded_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                        </div>
                      )}
                      {selectedBooking.payment.refund_admin_note && (
                        <div className="col-span-2">
                          <span className="text-zinc-400 block text-[11px]">Admin Note</span>
                          <span className="text-zinc-900">{selectedBooking.payment.refund_admin_note}</span>
                        </div>
                      )}
                    </>
                  )}
                  {selectedBooking.payment.failure_reason && (
                    <div className="col-span-2">
                      <span className="text-zinc-400 block text-[11px]">Failure Reason</span>
                      <span className="text-rose-700">{selectedBooking.payment.failure_reason}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Refund confirmation dialog */}
            {isConfirmingRefund && selectedBooking.payment && (
              <div className="space-y-3 pt-2 border-t border-zinc-100">
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    {selectedBooking.payment.gateway === 'razorpay'
                      ? 'This will call the payment gateway to issue a refund of the full captured amount. The seeker will be notified that the refund is pending. The original payment method will be credited — this can take several business days. This action cannot be undone.'
                      : 'This will queue a manual refund. You must transfer the money yourself, then use "Process Refund" to record the transfer with the UTR and receipt. The seeker is notified only once the transfer is recorded.'}
                  </span>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="outline" size="sm" onClick={() => setIsConfirmingRefund(false)} disabled={isInitiatingRefund}>
                    Cancel
                  </Button>
                  <Button size="sm" className="gap-1 bg-amber-600 hover:bg-amber-700 text-white" disabled={isInitiatingRefund} onClick={() => handleInitiateRefund(selectedBooking)}>
                    {isInitiatingRefund ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                    {isInitiatingRefund ? 'Initiating…' : 'Confirm Refund'}
                  </Button>
                </div>
              </div>
            )}

            {/* Manual refund form */}
            {isRefunding && selectedBooking.payment && (
              <div className="space-y-3 pt-2 border-t border-zinc-100">
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    Record this <strong>after</strong> you have transferred the money yourself. The money does not move through Suggest Key — this form records the transfer as evidence. The seeker is notified only once it is saved.
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="font-semibold text-zinc-900">Refund amount *</span>
                    <input type="number" min="1" step="0.01" value={refundForm.amount} onChange={(e) => setRefundForm((f) => ({ ...f, amount: e.target.value }))} className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-900" />
                    <span className="text-[11px] text-zinc-500 block mt-0.5">Full refunds only. Must equal ₹{selectedBooking.payment.amount_inr.toLocaleString('en-IN')}.</span>
                  </label>
                  <label className="block">
                    <span className="font-semibold text-zinc-900">Refund method *</span>
                    <select value={refundForm.method} onChange={(e) => setRefundForm((f) => ({ ...f, method: e.target.value }))} className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-900">
                      {REFUND_METHODS.map((m) => (
                        <option key={m} value={m}>{refundMethodLabel(m)}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="block">
                  <span className="font-semibold text-zinc-900">Refund reference / UTR *</span>
                  <input type="text" maxLength={64} placeholder="Copy the reference from your transfer receipt" value={refundForm.reference} onChange={(e) => setRefundForm((f) => ({ ...f, reference: e.target.value }))} className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-900" />
                </label>
                <label className="block">
                  <span className="font-semibold text-zinc-900">Refund proof *</span>
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setRefundFile(e.target.files?.[0] ?? null)} className="mt-1 w-full text-xs text-zinc-700" />
                  <span className="text-[11px] text-zinc-500 block mt-0.5">Screenshot of the transfer confirmation, up to 5 MB. Stored in a private bucket, viewable by admins only.</span>
                </label>
                <label className="block">
                  <span className="font-semibold text-zinc-900">Admin note (optional)</span>
                  <textarea rows={2} maxLength={500} value={refundForm.note} onChange={(e) => setRefundForm((f) => ({ ...f, note: e.target.value }))} className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-900" />
                  <span className="text-[11px] text-zinc-500 block mt-0.5">Internal only. Never shown to the seeker.</span>
                </label>
                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="outline" size="sm" onClick={() => { setIsRefunding(false); setRefundFile(null); setRefundForm({ amount: '', method: 'UPI', reference: '', note: '' }); }} disabled={isSubmittingRefund}>
                    Back
                  </Button>
                  <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white" disabled={isSubmittingRefund} onClick={() => handleCompleteRefund(selectedBooking)}>
                    {isSubmittingRefund ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                    {isSubmittingRefund ? 'Recording…' : 'Confirm refund completed'}
                  </Button>
                </div>
              </div>
            )}

            <div className="p-3 bg-zinc-100 rounded-lg text-[11px] text-zinc-600 space-y-1">
              <span className="font-semibold text-zinc-800 block">Platform Security Invariant:</span>
              <p>
                Only valid HTTPS meeting links are accepted. Direct meeting link is concealed from seeker until 5 minutes before scheduled start time.
              </p>
            </div>

            {selectedBooking.payment && !isConfirmingRefund && !isRefunding && (
              <div className="flex justify-end gap-2 pt-2">
                {canInitiateRefund({
                  status: selectedBooking.payment.status,
                  refundStatus: selectedBooking.payment.refund_status,
                  gateway: selectedBooking.payment.gateway ?? 'manual',
                  manualRefundRequired: selectedBooking.payment.manual_refund_required ?? false,
                } as any) && (
                  <Button size="sm" variant="outline" className="gap-1 border-amber-200 text-amber-700 hover:bg-amber-50" onClick={() => setIsConfirmingRefund(true)}>
                    <Undo2 className="h-3.5 w-3.5" />
                    Initiate Refund
                  </Button>
                )}
                {canProcessManualRefund({
                  gateway: selectedBooking.payment.gateway ?? 'manual',
                  status: selectedBooking.payment.status,
                  refundStatus: selectedBooking.payment.refund_status,
                  manualRefundRequired: selectedBooking.payment.manual_refund_required ?? false,
                } as any) && (
                  <Button size="sm" variant="outline" className="gap-1 border-emerald-200 text-emerald-700 hover:bg-emerald-50" onClick={openRefundForm}>
                    <Undo2 className="h-3.5 w-3.5" />
                    Process Refund
                  </Button>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
        </>
      )}
    </div>
  );
};
