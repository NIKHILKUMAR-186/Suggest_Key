import React, { useState } from 'react';
import { CreditCard, CheckCircle2, XCircle, FileImage, ShieldCheck, AlertCircle, Eye } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { Modal } from '@/src/components/ui/Modal';
import { EmptyState } from '@/src/components/shared/EmptyState';

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

export const AdminPaymentsPage: React.FC = () => {
  const [selectedPayment, setSelectedPayment] = useState<PaymentItem | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [isRejecting, setIsRejecting] = useState(false);

  const [payments, setPayments] = useState<PaymentItem[]>([
    {
      id: 'PAY-901',
      bookingId: 'BK-9021',
      seekerName: 'Aman Kumar',
      mentorName: 'Rahul Sharma',
      amount: 999,
      submittedAt: '6 minutes ago',
      status: 'PENDING_VERIFICATION',
      proofUrl: 'upi_ref_0921_screenshot.png',
    },
    {
      id: 'PAY-902',
      bookingId: 'BK-9024',
      seekerName: 'Pooja Verma',
      mentorName: 'Ananya Patel',
      amount: 1200,
      submittedAt: '18 minutes ago',
      status: 'PENDING_VERIFICATION',
      proofUrl: 'gpay_receipt_tx109.png',
    },
    {
      id: 'PAY-899',
      bookingId: 'BK-9019',
      seekerName: 'Sneha Roy',
      mentorName: 'Rahul Sharma',
      amount: 999,
      submittedAt: '15 March 2026',
      status: 'VERIFIED',
      proofUrl: 'receipt_899.png',
    },
  ]);

  const handleApprove = (id: string) => {
    setPayments(
      payments.map((p) => (p.id === id ? { ...p, status: 'VERIFIED' } : p))
    );
    setSelectedPayment(null);
  };

  const handleReject = (id: string) => {
    setPayments(
      payments.map((p) =>
        p.id === id
          ? { ...p, status: 'REJECTED', rejectionReason: rejectReason || 'Invalid transaction screenshot' }
          : p
      )
    );
    setSelectedPayment(null);
    setIsRejecting(false);
    setRejectReason('');
  };

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
          {payments.filter((p) => p.status === 'PENDING_VERIFICATION').length} Awaiting Verification
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
