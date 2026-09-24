import React, { useState, useEffect, useCallback } from 'react';
import { CreditCard, CheckCircle2, XCircle, FileImage, ShieldCheck, AlertCircle, Eye, Loader2 } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { Modal } from '@/src/components/ui/Modal';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { apiFetch } from '@/src/lib/apiClient';

interface PaymentItem {
  id: string;
  bookingId: string;
  seekerName: string;
  mentorName: string;
  amount: number;
  submittedAt: string;
  status: 'PENDING_VERIFICATION' | 'VERIFIED' | 'REJECTED';
  proofUrl: string;
  rejectionReason?: string;
}

interface ApiPayment {
  id: string;
  bookingId: string;
  seekerName: string;
  mentorName: string;
  amount: number;
  submittedAt: string;
  status: 'PENDING_VERIFICATION' | 'VERIFIED' | 'REJECTED';
  proofUrl: string;
  rejectionReason?: string;
}

export const AdminPaymentsPage: React.FC = () => {
  const [selectedPayment, setSelectedPayment] = useState<PaymentItem | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [isRejecting, setIsRejecting] = useState(false);
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/admin/payments');
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to fetch payments');
      setPayments(data.payments || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load payments');
      console.error('Failed to fetch payments:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  const handleApprove = async (id: string) => {
    setSelectedPayment(null);
    try {
      const res = await apiFetch(`/api/admin/payments/${id}/approve`, { method: 'PATCH' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to approve payment');
      await fetchPayments();
    } catch (err: any) {
      console.error('Failed to approve payment:', err);
      alert('Failed to approve payment: ' + err.message);
    }
  };

  const handleReject = async (id: string) => {
    setSelectedPayment(null);
    setIsRejecting(false);
    try {
      const res = await apiFetch(`/api/admin/payments/${id}/reject`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejectionReason: rejectReason || 'Invalid transaction screenshot' }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to reject payment');
      setRejectReason('');
      await fetchPayments();
    } catch (err: any) {
      console.error('Failed to reject payment:', err);
      alert('Failed to reject payment: ' + err.message);
    }
  };

  const pendingCount = payments.filter((p) => p.status === 'PENDING_VERIFICATION').length;

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

        <Badge variant="warning" className="self-start text-xs font-semibold">
          {pendingCount} Awaiting Verification
        </Badge>
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
        ) : payments.length === 0 ? (
          <EmptyState
            icon={CreditCard}
            title="No Payments Found"
            description="No payment records found in the system."
          />
        ) : (
          <table className="w-full text-left text-xs text-zinc-600">
            <thead className="bg-zinc-50/70 border-b border-zinc-200 text-zinc-900 font-semibold uppercase tracking-wider text-[11px]">
              <tr>
                <th className="py-3 px-4">Payment / Booking</th>
                <th className="py-3 px-4">Seeker</th>
                <th className="py-3 px-4">Mentor</th>
                <th className="py-3 px-4">Amount</th>
                <th className="py-3 px-4">Submitted</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Inspect Proof</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {payments.map((p) => (
                <tr key={p.id} className="hover:bg-zinc-50/50 transition-colors">
                  <td className="py-3 px-4 font-mono">
                    <span className="font-bold text-zinc-950 block">{p.id}</span>
                    <span className="text-[11px] text-zinc-400">{p.bookingId}</span>
                  </td>
                  <td className="py-3 px-4 font-semibold text-zinc-900">{p.seekerName}</td>
                  <td className="py-3 px-4">{p.mentorName}</td>
                  <td className="py-3 px-4 font-bold text-zinc-950">₹{p.amount}</td>
                  <td className="py-3 px-4 text-zinc-500">{p.submittedAt}</td>
                  <td className="py-3 px-4">
                    <Badge
                      variant={
                        p.status === 'VERIFIED'
                          ? 'success'
                          : p.status === 'PENDING_VERIFICATION'
                          ? 'warning'
                          : 'destructive'
                      }
                      className="text-[10px]"
                    >
                      {p.status}
                    </Badge>
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
        )}
      </div>

      {/* Payment Inspection Modal */}
      {selectedPayment && (
        <Modal
          isOpen={!!selectedPayment}
          onClose={() => setSelectedPayment(null)}
          title={`Payment Verification: ${selectedPayment.id}`}
          description={`Booking ${selectedPayment.bookingId} · ${selectedPayment.seekerName} ➔ ${selectedPayment.mentorName}`}
        >
          <div className="space-y-4 pt-2 text-xs">
            {/* Payment Details */}
            <div className="grid grid-cols-2 gap-3 bg-zinc-50 p-3 rounded-lg">
              <div>
                <span className="text-zinc-400 block text-[11px]">Amount Claimed</span>
                <span className="text-base font-bold text-zinc-950">₹{selectedPayment.amount} INR</span>
              </div>
              <div>
                <span className="text-zinc-400 block text-[11px]">Status</span>
                <Badge variant="secondary">{selectedPayment.status}</Badge>
              </div>
            </div>

            {/* Proof Screenshot Inspection Box */}
            <div className="space-y-1.5">
              <span className="font-semibold text-zinc-700 block">Uploaded Transaction Screenshot</span>
              <div className="rounded-lg border border-zinc-200 bg-zinc-100 p-8 flex flex-col items-center justify-center text-center space-y-2">
                <FileImage className="h-10 w-10 text-zinc-400" />
                <span className="font-mono text-xs text-zinc-800 font-medium">
                  {selectedPayment.proofUrl}
                </span>
                <span className="text-[11px] text-zinc-500">
                  Stored in private Supabase bucket: payment-proofs
                </span>
              </div>
            </div>

            {isRejecting ? (
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
              <div className="flex justify-end pt-2">
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