import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { CreditCard, CheckCircle2, XCircle, FileImage, ShieldCheck, AlertCircle, Eye, Loader2, Undo2, Paperclip } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { Modal } from '@/src/components/ui/Modal';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { ShortId } from '@/src/components/shared/ShortId';
import { useNavigation } from '@/src/context/NavigationContext';
import { useToast } from '@/src/context/ToastContext';
import { toUserMessage } from '@/src/lib/errorMessages';
import { formatInr } from '@/src/lib/seekerFormat';
import { apiFetch } from '@/src/lib/apiClient';
import {
  isRefundOwed,
  type AdminPaymentRow,
} from '@/src/lib/adminPaymentView';
import { supabase, isSupabaseConfigured } from '@/src/lib/supabase';
import {
  PAYMENT_PROOF_BUCKET,
  formatFileSize,
} from '@/src/lib/paymentProof';
import {
  REFUND_METHODS,
  buildRefundProofStoragePath,
  canProcessManualRefund,
  fromPaise,
  refundMethodLabel,
  refundStatusLabel,
  validateRefundProofFile,
} from '@/src/lib/refundCompletion';

/** The read model and its rules live in one place so the API projection and
 *  this page can never drift apart. */
type PaymentItem = AdminPaymentRow;

/** Renders a stored timestamp, or an explicit "—" when the column is null. */
const formatSubmittedAt = (value: string | null): string => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
};

/** A short random token for the object key. `crypto.randomUUID` needs a secure context. */
const randomToken = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

export const AdminPaymentsPage: React.FC = () => {
  const { currentPath } = useNavigation();
  const [selectedPayment, setSelectedPayment] = useState<PaymentItem | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [isRejecting, setIsRejecting] = useState(false);
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 'all' | 'refunds_owed' — a refund the platform owes but has not issued.
  const [filter, setFilter] = useState<'all' | 'refunds_owed'>('all');
  // Refund completion form state. Held only while the modal is open, so opening
  // the form can never itself be mistaken for completing the refund.
  const [isRefunding, setIsRefunding] = useState(false);
  const [refundForm, setRefundForm] = useState({ amount: '', method: 'UPI', reference: '', note: '' });
  const [refundFile, setRefundFile] = useState<File | null>(null);
  const [isSubmittingRefund, setIsSubmittingRefund] = useState(false);
  const [refundProofUrl, setRefundProofUrl] = useState<string | null>(null);
  const toast = useToast();

  /**
   * The payment id an admin notification was written for, taken from the URL.
   *
   * This is how "Review Payment" lands on the exact record the event concerns
   * instead of dropping the operator at the top of an undifferentiated queue. It
   * is a real id from a real notification row; nothing here is a default.
   */
  const focusedPaymentId = useMemo(() => {
    const query = currentPath.includes('?') ? currentPath.split('?')[1] : '';
    return new URLSearchParams(query).get('paymentId');
  }, [currentPath]);

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/admin/payments');
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to fetch payments');
      setPayments(data.payments || []);
    } catch (err: unknown) {
      setError(toUserMessage(err, 'The payment queue could not be loaded. Please try again.', { page: 'admin-payments' }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  // Open the referenced record once the real rows have arrived. Matching is by
  // id against the fetched payments, so the review modal can only ever show a
  // payment that actually exists in the database.
  useEffect(() => {
    if (!focusedPaymentId || loading) return;
    const match = payments.find((p) => p.id === focusedPaymentId);
    if (!match) return;
    setSelectedPayment(match);
    setIsRejecting(false);
  }, [focusedPaymentId, payments, loading]);

  /** Opens the refund form pre-filled from the payment. Records nothing. */
  const openRefundForm = (payment: PaymentItem) => {
    setRefundForm({ amount: String(payment.amount), method: 'UPI', reference: '', note: '' });
    setRefundFile(null);
    setIsRefunding(true);
  };

  const closeRefundForm = () => {
    setIsRefunding(false);
    setRefundFile(null);
    setRefundForm({ amount: '', method: 'UPI', reference: '', note: '' });
  };

  /**
   * Fetches the refund receipt as a short-lived signed URL from the private
   * bucket. The raw object key is never exposed to the browser.
   */
  const viewRefundProof = async (paymentId: string) => {
    try {
      const res = await apiFetch(`/api/admin/payments/${paymentId}/refund-proof`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error?.message || 'The refund proof could not be opened.');
      setRefundProofUrl(data.url ?? null);
    } catch (err: unknown) {
      toast.error(toUserMessage(err, 'The refund proof could not be opened.', { action: 'view-refund-proof' }), {
        title: 'Proof unavailable',
      });
    }
  };

  /**
   * Completes a manual refund: uploads the receipt to the private bucket, then
   * tells the API to run the atomic completion. The seeker is notified by the
   * database transition, not by anything on this page.
   */
  const handleCompleteRefund = async (payment: PaymentItem) => {
    const checked = validateRefundProofFile(
      refundFile ? { name: refundFile.name, type: refundFile.type, size: refundFile.size } : null,
    );
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
      if (!isSupabaseConfigured()) throw new Error('Refund uploads are unavailable right now.');

      storagePath = buildRefundProofStoragePath(payment.id, refundFile!.name, randomToken());
      const { error: uploadErr } = await supabase.storage
        .from(PAYMENT_PROOF_BUCKET)
        .upload(storagePath, refundFile!, { contentType: refundFile!.type, upsert: false, cacheControl: '3600' });
      if (uploadErr) throw uploadErr;

      const res = await apiFetch(`/api/admin/payments/${payment.id}/complete-manual-refund`, {
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

      setSelectedPayment(null);
      closeRefundForm();
      await fetchPayments();
      toast.success(`The refund of ₹${amount.toLocaleString('en-IN')} has been recorded as completed and the seeker has been notified.`, {
        title: 'Refund completed',
      });
    } catch (err: unknown) {
      toast.error(toUserMessage(err, 'The refund could not be completed. Nothing was recorded.', { action: 'complete-refund' }), {
        title: 'Refund not completed',
      });
    } finally {
      setIsSubmittingRefund(false);
    }
  };

  const handleApprove = async (id: string) => {
    setSelectedPayment(null);
    try {
      const res = await apiFetch(`/api/admin/payments/${id}/approve`, { method: 'PATCH' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to approve payment');
      await fetchPayments();
      toast.success('The payment was verified and the booking has advanced to mentor confirmation.', {
        title: 'Payment approved',
      });
    } catch (err: unknown) {
      toast.error(toUserMessage(err, 'The payment could not be approved. Please try again.', { action: 'approve-payment' }), {
        title: 'Approval failed',
      });
    }
  };

  const handleReject = async (id: string) => {
    setSelectedPayment(null);
    setIsRejecting(false);
    try {
      // The reason is optional in the database. When the admin leaves it blank
      // nothing is stored, and the seeker is told the proof simply could not be
      // verified — rather than being told a reason they never chose.
      const body = rejectReason.trim() ? { rejectionReason: rejectReason.trim() } : {};
      const res = await apiFetch(`/api/admin/payments/${id}/reject`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to reject payment');
      setRejectReason('');
      await fetchPayments();
      toast.success('The payment proof was rejected and the seeker has been notified.', {
        title: 'Payment rejected',
      });
    } catch (err: unknown) {
      toast.error(toUserMessage(err, 'The payment could not be rejected. Please try again.', { action: 'reject-payment' }), {
        title: 'Rejection failed',
      });
    }
  };

  const pendingCount = payments.filter((p) => p.status === 'PENDING_VERIFICATION').length;
  // ponytail: a refund is OWED, not paid. This view only surfaces the list; no
  // refund is ever issued from here.
  const refundsOwedCount = payments.filter(isRefundOwed).length;
  const visiblePayments = filter === 'refunds_owed' ? payments.filter(isRefundOwed) : payments;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">
            Manual QR Payment Queue
          </h1>
          <p className="mt-1 text-xs text-zinc-500">
            Inspect seeker UPI screenshots. Approved payments advance bookings to MENTOR_PENDING.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start">
          {refundsOwedCount > 0 && (
            <Button
              size="sm"
              variant={filter === 'refunds_owed' ? 'default' : 'outline'}
              onClick={() => setFilter(filter === 'refunds_owed' ? 'all' : 'refunds_owed')}
            >
              {filter === 'refunds_owed' ? 'Showing Refunds Owed' : `Refunds Owed (${refundsOwedCount})`}
            </Button>
          )}
          <Badge variant="warning" className="text-xs font-semibold">
            {pendingCount} Awaiting Verification
          </Badge>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600 flex items-start gap-2">
        <ShieldCheck className="h-4 w-4 text-zinc-600 shrink-0 mt-0.5" />
        <span>
          <strong>State Machine Invariant:</strong> Approving a payment transitions the associated booking into <code className="font-mono font-semibold text-zinc-900">MENTOR_PENDING</code> and triggers an action prompt to the mentor for the meeting URL.
        </span>
      </div>

      {/* Payment Table */}
      <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden shadow-xs">
        {loading ? (
          <div className="p-8 text-center">
            <Loader2 className="h-8 w-8 text-zinc-400 mx-auto animate-spin" />
            <p className="mt-2 text-xs text-zinc-500">Loading payments...</p>
          </div>
        ) : error ? (
          <div className="p-6 text-center text-rose-600">
            <AlertCircle className="h-6 w-6 mx-auto mb-2" />
            <p className="text-xs">{error}</p>
            <Button variant="outline" size="sm" onClick={fetchPayments} className="mt-2">
              Retry
            </Button>
          </div>
        ) : visiblePayments.length === 0 ? (
          <EmptyState
            icon={CreditCard}
            title={filter === 'refunds_owed' ? 'No Refunds Owed' : 'No Payments Found'}
            description={
              filter === 'refunds_owed'
                ? 'No payment is currently marked as awaiting a refund.'
                : 'No payment records found in the system.'
            }
          />
        ) : (
          <div className="table-scroll">
          <table className="w-full text-left text-xs text-zinc-600">
            <thead className="bg-zinc-50/70 border-b border-zinc-200 text-zinc-900 font-semibold uppercase tracking-wider text-[11px]">
              <tr>
                <th className="py-3 px-4">Booking / Gig</th>
                <th className="py-3 px-4">Seeker</th>
                <th className="py-3 px-4">Mentor</th>
                <th className="py-3 px-4">Method</th>
                <th className="py-3 px-4">Reference</th>
                <th className="py-3 px-4">Amount</th>
                <th className="py-3 px-4">Submitted</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Refund</th>
                <th className="py-3 px-4 text-right">Inspect Proof</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {visiblePayments.map((p) => (
                <tr key={p.id} className="hover:bg-zinc-50/50 transition-colors">
                  <td className="py-3 px-4 font-mono">
                    {p.bookingCode ? (
                      <span className="font-bold text-zinc-950 block">#{p.bookingCode}</span>
                    ) : (
                      <ShortId value={p.bookingId} label="Booking ID" />
                    )}
                    <span className="text-[11px] text-zinc-400">{p.gigTitle || 'Gig unavailable'}</span>
                  </td>
                  <td className="py-3 px-4 font-semibold text-zinc-900 break-words">{p.seekerName || '—'}</td>
                  <td className="py-3 px-4 break-words">{p.mentorName || '—'}</td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    <Badge variant={p.gateway === 'razorpay' ? 'default' : 'secondary'} className="text-[10px]">
                      {p.gateway === 'razorpay' ? 'Razorpay' : 'UPI / QR'}
                    </Badge>
                  </td>
                  <td className="py-3 px-4 font-mono text-zinc-700 break-all">
                    {p.transactionReference || '—'}
                  </td>
                  <td className="py-3 px-4 font-bold text-zinc-950 whitespace-nowrap">
                    {formatInr(p.amount) || '—'}
                  </td>
                  <td className="py-3 px-4 text-zinc-500 whitespace-nowrap">{formatSubmittedAt(p.submittedAt)}</td>
                  <td className="py-3 px-4">
                    <Badge
                      variant={
                        p.status === 'VERIFIED'
                          ? 'success'
                          : p.status === 'PENDING_VERIFICATION'
                          ? 'warning'
                          : p.status === 'REJECTED' || p.status === 'FAILED' || p.status === 'REFUND_FAILED'
                          ? 'destructive'
                          : 'secondary'
                      }
                      className="text-[10px]"
                    >
                      {p.status}
                    </Badge>
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    {p.refundStatus ? (
                      <Badge
                        variant={p.refundStatus === 'REFUNDED' ? 'success' : p.refundStatus === 'PENDING' ? 'warning' : 'destructive'}
                        className="text-[10px]"
                      >
                        {refundStatusLabel(p.refundStatus)}
                      </Badge>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <Button
                      size="sm"
                      variant={p.status === 'PENDING_VERIFICATION' ? 'default' : 'outline'}
                      className="text-xs py-1 h-7 gap-1"
                      onClick={() => {
                        setSelectedPayment(p);
                        setIsRejecting(false);
                      }}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span>{p.status === 'PENDING_VERIFICATION' ? 'Verify Proof' : 'View'}</span>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* Payment Inspection Modal */}
      {selectedPayment && (
        <Modal
          isOpen={!!selectedPayment}
          onClose={() => setSelectedPayment(null)}
          title={`Payment Verification: ${selectedPayment.bookingCode || selectedPayment.bookingId}`}
          description={`${selectedPayment.seekerName || 'Unknown seeker'} → ${selectedPayment.mentorName || 'Unknown mentor'} · submitted ${formatSubmittedAt(selectedPayment.submittedAt)}`}
        >
          <div className="space-y-4 pt-2 text-xs">
            {/* Payment Details */}
            <div className="grid grid-cols-2 gap-3 bg-zinc-50 p-3 rounded-lg">
              <div>
                <span className="text-zinc-400 block text-[11px]">Amount Paid</span>
                <span className="text-base font-bold text-zinc-950">₹{selectedPayment.amount}</span>
              </div>
              <div>
                <span className="text-zinc-400 block text-[11px]">Status</span>
                <Badge variant="secondary">{selectedPayment.status}</Badge>
              </div>
              <div className="col-span-2">
                <span className="text-zinc-400 block text-[11px]">Transaction Reference</span>
                <span className="font-mono text-sm font-semibold text-zinc-950">
                  {selectedPayment.transactionReference || 'Not provided'}
                </span>
              </div>
              <div className="col-span-2">
                <span className="text-zinc-400 block text-[11px">Gig</span>
                <span className="text-xs font-medium text-zinc-900">{selectedPayment.gigTitle || '—'}</span>
              </div>
            </div>

            {/* Gateway / refund state. For a manual UPI/QR payment there is no
                gateway, so these are stated as not applicable instead of being
                rendered as empty rows an admin has to interpret. */}
            <div className="rounded-lg border border-zinc-200 p-3 space-y-2">
              <span className="font-semibold text-zinc-700 block">
                {selectedPayment.gateway === 'razorpay' ? 'Gateway (Razorpay)' : 'Payment Method'}
              </span>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-zinc-400 block text-[11px">Method</span>
                  <Badge variant="secondary">
                    {selectedPayment.gateway === 'razorpay' ? 'Razorpay' : 'Manual UPI / QR'}
                  </Badge>
                </div>
                <div>
                  <span className="text-zinc-400 block text-[11px">Refund Status</span>
                  {selectedPayment.refundStatus ? (
                    <Badge
                      variant={
                        selectedPayment.refundStatus === 'REFUNDED'
                          ? 'success'
                          : selectedPayment.refundStatus === 'PENDING'
                          ? 'warning'
                          : 'destructive'
                      }
                    >
                      {refundStatusLabel(selectedPayment.refundStatus)}
                    </Badge>
                  ) : (
                    <span className="text-zinc-500">—</span>
                  )}
                </div>
                {selectedPayment.gateway === 'razorpay' && (
                  <>
                    <div className="col-span-2">
                      <span className="text-zinc-400 block text-[11px]">Razorpay Order ID</span>
                      <span className="font-mono break-all">
                        {selectedPayment.razorpayOrderId || 'Not recorded'}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-zinc-400 block text-[11px]">Razorpay Payment ID</span>
                      <span className="font-mono break-all">
                        {selectedPayment.razorpayPaymentId || 'Not recorded'}
                      </span>
                    </div>
                  </>
                )}
                {selectedPayment.refundId && (
                  <div className="col-span-2">
                    <span className="text-zinc-400 block text-[11px]">Refund ID</span>
                    <span className="font-mono break-all">{selectedPayment.refundId}</span>
                  </div>
                )}
              </div>
              {selectedPayment.failureReason && (
                <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-rose-800">
                  <span className="font-semibold block">Failure reason</span>
                  <span>{selectedPayment.failureReason}</span>
                </div>
              )}
            </div>

            {/* A COMPLETED refund: what the platform actually did, and who. */}
            {selectedPayment.refundStatus === 'REFUNDED' && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-2">
                <span className="font-semibold text-emerald-900 block">Refund completed</span>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-zinc-500 block text-[11px]">Refund Amount</span>
                    <span className="font-bold text-emerald-950">
                      {formatInr(fromPaise(selectedPayment.refundAmountPaise) ?? selectedPayment.amount)}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[11px]">Refund Method</span>
                    <span className="font-medium text-zinc-900">
                      {selectedPayment.refundMethod ? refundMethodLabel(selectedPayment.refundMethod) : '—'}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-zinc-500 block text-[11px]">Refund Reference</span>
                    <span className="font-mono break-all text-zinc-900">
                      {selectedPayment.refundReference || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[11px]">Refunded At</span>
                    <span className="text-zinc-900">{formatSubmittedAt(selectedPayment.refundedAt)}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[11px]">Processed By</span>
                    <span className="text-zinc-900">
                      {selectedPayment.refundedBy ? 'Admin' : '—'}
                      {selectedPayment.refundedBy && (
                        <span className="font-mono text-[11px] text-zinc-500">
                          {' '}({selectedPayment.refundedBy.slice(0, 8)})
                        </span>
                      )}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() => viewRefundProof(selectedPayment.id)}
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                    View refund proof
                  </Button>
                  {refundProofUrl && (
                    <a
                      href={refundProofUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-[11px] underline text-emerald-800"
                    >
                      Open signed image
                    </a>
                  )}
                </div>
                <span className="text-[11px] text-emerald-800 block">
                  Served via a short-lived signed URL from the private Supabase bucket{' '}
                  <code className="font-mono">payment-proofs</code>. Admin-only.
                </span>
                {selectedPayment.refundAdminNote && (
                  <div className="rounded-md border border-emerald-200 bg-white p-2 text-emerald-900">
                    <span className="font-semibold block">Admin note</span>
                    <span>{selectedPayment.refundAdminNote}</span>
                  </div>
                )}
              </div>
            )}

            {/* Proof Screenshot Inspection Box */}
            <div className="space-y-1.5">
              <span className="font-semibold text-zinc-700 block">Uploaded Transaction Screenshot</span>
              {selectedPayment.proofUrl ? (
                <>
                  <img
                    src={selectedPayment.proofUrl}
                    alt={`Payment proof for booking ${selectedPayment.bookingCode || selectedPayment.bookingId}`}
                    className="w-full max-h-[420px] object-contain rounded-lg border border-zinc-200 bg-zinc-100"
                  />
                  <span className="text-[11px] text-zinc-500">
                    Served via a short-lived signed URL from the private Supabase bucket <code className="font-mono">payment-proofs</code>.
                  </span>
                </>
              ) : (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 flex flex-col items-center justify-center text-center space-y-2">
                  <FileImage className="h-8 w-8 text-amber-500" />
                  <span className="text-xs font-semibold text-amber-900">Payment proof is not available</span>
                  <span className="text-[11px] text-amber-700">
                    No image is stored for this payment, or the signed link could not be generated.
                  </span>
                </div>
              )}
            </div>

            {selectedPayment.rejectionReason && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                <span className="font-semibold block">Rejection reason</span>
                <span>{selectedPayment.rejectionReason}</span>
              </div>
            )}

            {isRefunding ? (
              /* The refund form. Read-only context first, then only the fields an
                 admin actually has to supply: the amount they sent, the rail, the
                 UTR from the receipt, the receipt itself, and an optional note. */
              <div className="space-y-3 pt-2 border-t border-zinc-100">
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    Record this <strong>after</strong> you have transferred the money yourself. The money does not
                    move through Suggest Key — this form records the transfer as evidence. The seeker is notified
                    only once it is saved.
                  </span>
                </div>

                <dl className="grid grid-cols-2 gap-2 rounded-lg bg-zinc-50 p-3 text-[11px]">
                  <div>
                    <dt className="text-zinc-400">Booking</dt>
                    <dd className="font-mono font-semibold text-zinc-900">
                      {selectedPayment.bookingCode || selectedPayment.bookingId}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-400">Seeker</dt>
                    <dd className="font-medium text-zinc-900">{selectedPayment.seekerName || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-400">Mentor</dt>
                    <dd className="font-medium text-zinc-900">{selectedPayment.mentorName || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-400">Gig / session</dt>
                    <dd className="font-medium text-zinc-900">{selectedPayment.gigTitle || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-400">Amount paid</dt>
                    <dd className="font-bold text-zinc-900">{formatInr(selectedPayment.amount)}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-400">Payment method</dt>
                    <dd className="font-medium text-zinc-900">
                      {selectedPayment.gateway === 'razorpay' ? 'Razorpay' : 'Manual UPI / QR'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-400">Payment status</dt>
                    <dd className="font-medium text-zinc-900">{selectedPayment.status}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-400">Refund status</dt>
                    <dd className="font-medium text-zinc-900">
                      {selectedPayment.refundStatus ? refundStatusLabel(selectedPayment.refundStatus) : '—'}
                    </dd>
                  </div>
                </dl>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="font-semibold text-zinc-900">Refund amount *</span>
                    <input
                      type="number"
                      min="1"
                      step="0.01"
                      value={refundForm.amount}
                      onChange={(e) => setRefundForm((f) => ({ ...f, amount: e.target.value }))}
                      className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-900"
                    />
                    <span className="text-[11px] text-zinc-500 block mt-0.5">
                      Full refunds only. Must equal ₹{selectedPayment.amount.toLocaleString('en-IN')}.
                    </span>
                  </label>

                  <label className="block">
                    <span className="font-semibold text-zinc-900">Refund method *</span>
                    <select
                      value={refundForm.method}
                      onChange={(e) => setRefundForm((f) => ({ ...f, method: e.target.value }))}
                      className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-900"
                    >
                      {REFUND_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {refundMethodLabel(m)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="block">
                  <span className="font-semibold text-zinc-900">Refund reference / UTR *</span>
                  <input
                    type="text"
                    maxLength={64}
                    placeholder="Copy the reference from your transfer receipt"
                    value={refundForm.reference}
                    onChange={(e) => setRefundForm((f) => ({ ...f, reference: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-900"
                  />
                </label>

                <label className="block">
                  <span className="font-semibold text-zinc-900">Refund proof *</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => setRefundFile(e.target.files?.[0] ?? null)}
                    className="mt-1 w-full text-xs text-zinc-700"
                  />
                  <span className="text-[11px] text-zinc-500 block mt-0.5">
                    Screenshot of the transfer confirmation, up to {formatFileSize(5 * 1024 * 1024)}. Stored in a
                    private bucket, viewable by admins only.
                  </span>
                </label>

                <label className="block">
                  <span className="font-semibold text-zinc-900">Admin note (optional)</span>
                  <textarea
                    rows={2}
                    maxLength={500}
                    value={refundForm.note}
                    onChange={(e) => setRefundForm((f) => ({ ...f, note: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-900"
                  />
                  <span className="text-[11px] text-zinc-500 block mt-0.5">
                    Internal only. Never shown to the seeker.
                  </span>
                </label>

                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="outline" size="sm" onClick={closeRefundForm} disabled={isSubmittingRefund}>
                    Back
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                    disabled={isSubmittingRefund}
                    onClick={() => handleCompleteRefund(selectedPayment)}
                  >
                    {isSubmittingRefund ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                    {isSubmittingRefund ? 'Recording…' : 'Confirm refund completed'}
                  </Button>
                </div>
              </div>
            ) : isRejecting ? (
              <div className="space-y-2 pt-2 border-t border-zinc-100">
                <label className="block font-semibold text-zinc-900">Rejection Reason</label>
                <input
                  type="text"
                  placeholder="e.g. Incomplete transaction ID or blurry screenshot"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="w-full rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-900"
                />
                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="outline" size="sm" onClick={() => setIsRejecting(false)}>
                    Back
                  </Button>
                  <Button
                    size="sm"
                    className="bg-rose-600 hover:bg-rose-700 text-white"
                    onClick={() => handleReject(selectedPayment.id)}
                  >
                    Confirm Rejection
                  </Button>
                </div>
              </div>
            ) : selectedPayment.status === 'PENDING_VERIFICATION' ? (
              <div className="flex justify-end gap-2 pt-3 border-t border-zinc-100">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-rose-700 border-rose-200 hover:bg-rose-50"
                  onClick={() => setIsRejecting(true)}
                >
                  Reject Proof
                </Button>
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => handleApprove(selectedPayment.id)}
                >
                  Approve & Advance Booking
                </Button>
              </div>
            ) : (
              <div className="flex justify-end gap-2 pt-2">
                {/* Offered only while a manual refund is genuinely outstanding. A
                    gateway refund is settled by the gateway's own events, and a
                    completed refund must never be completable a second time. */}
                {canProcessManualRefund(selectedPayment) && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                    onClick={() => openRefundForm(selectedPayment)}
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                    Process Refund
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => setSelectedPayment(null)}>
                  Close
                </Button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};