import React, { useState } from 'react';
import { ArrowLeft, Clock, QrCode, Upload, ShieldCheck, CheckCircle2, Copy, Check } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { Input } from '@/src/components/ui/Input';
import { SuccessState } from '@/src/components/shared/SuccessState';
import { useNavigation } from '@/src/context/NavigationContext';

export const SeekerPaymentPage: React.FC = () => {
  const { navigate } = useNavigation();
  const [proofUploaded, setProofUploaded] = useState(false);
  const [transactionRef, setTransactionRef] = useState('');
  const [copiedUpi, setCopiedUpi] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleCopyUpi = () => {
    navigator.clipboard.writeText('suggestkey@upi');
    setCopiedUpi(true);
    setTimeout(() => setCopiedUpi(false), 2000);
  };

  const handleSubmit = () => {
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      setSubmitted(true);
    }, 600);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back button */}
      <button
        onClick={() => navigate('/seeker/mentor-detail')}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-500 hover:text-zinc-950 transition-colors p-1 -ml-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 cursor-pointer"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        <span>Cancel & Back to Mentor</span>
      </button>

      {/* 15-Minute Slot Hold Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-900 shrink-0">
            <Clock className="h-5 w-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-amber-950">Slot Hold Active: 14:32 Remaining</h2>
              <Badge variant="warning" className="text-[10px] font-bold">15-Min Lock</Badge>
            </div>
            <p className="text-xs text-amber-900 mt-0.5 leading-relaxed">
              This slot is temporarily locked exclusively for you. If payment proof is not submitted within 15 minutes, the slot is automatically released.
            </p>
          </div>
        </div>
      </div>

      {submitted ? (
        <SuccessState
          title="Payment Proof Submitted"
          description="Your payment is now in PENDING_VERIFICATION status. Admin will inspect the transaction proof. Once approved, the booking moves to MENTOR_PENDING for the mentor to attach the HTTPS meeting URL."
          actionLabel="View in My Bookings"
          onAction={() => navigate('/seeker/bookings')}
          secondaryActionLabel="Explore More Mentors"
          onSecondaryAction={() => navigate('/seeker')}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left Column: Order Context */}
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xs space-y-5">
            <h2 className="text-base font-bold text-zinc-950 border-b border-zinc-100 pb-3 font-display">
              Booking Summary
            </h2>
            <div className="space-y-3 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-zinc-500">Mentor:</span>
                <span className="font-bold text-zinc-900">Rahul Sharma</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-zinc-500">Segment:</span>
                <span className="font-semibold text-zinc-800">Relationship Advisor</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-zinc-500">Gig:</span>
                <span className="font-semibold text-zinc-800">1:1 Relationship Guidance</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-zinc-500">Date & Time:</span>
                <span className="font-semibold text-zinc-900">Today · 4:00 PM – 5:00 PM (IST)</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-zinc-500">Duration:</span>
                <span className="font-semibold text-zinc-800">60 Minutes</span>
              </div>
              <div className="flex justify-between items-center border-t border-zinc-100 pt-3 text-sm font-bold text-zinc-950">
                <span>Amount Due:</span>
                <span className="font-mono text-base">₹999 INR</span>
              </div>
            </div>

            <div className="rounded-xl bg-zinc-50 border border-zinc-200/80 p-3.5 text-[11px] text-zinc-600 space-y-1">
              <span className="font-bold text-zinc-900 block">Payment Invariant Note:</span>
              <p className="leading-relaxed">
                MVP uses Manual QR verification. The payment layer is provider-abstracted for future Razorpay integration without altering availability or booking state machines.
              </p>
            </div>
          </div>

          {/* Right Column: QR Code & Proof Upload */}
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xs space-y-5">
            <h2 className="text-base font-bold text-zinc-950 border-b border-zinc-100 pb-3 font-display">
              Manual QR Payment (MVP)
            </h2>

            {/* QR Placeholder Box */}
            <div className="flex flex-col items-center justify-center p-4 border border-zinc-200 rounded-xl bg-zinc-50 text-center space-y-2.5">
              <div className="h-32 w-32 bg-white border border-zinc-300 rounded-xl flex items-center justify-center shadow-xs">
                <QrCode className="h-20 w-20 text-zinc-900" />
              </div>
              <span className="text-xs font-bold text-zinc-950">Scan via Any UPI App</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-mono text-zinc-700 bg-white border border-zinc-200 px-2.5 py-1 rounded-lg">
                  suggestkey@upi
                </span>
                <button
                  onClick={handleCopyUpi}
                  className="p-1.5 text-zinc-500 hover:text-zinc-950 rounded-lg hover:bg-zinc-200/60 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950"
                  aria-label="Copy UPI ID"
                  title="Copy UPI ID"
                >
                  {copiedUpi ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            {/* UTR / Reference ID Field */}
            <Input
              label="Transaction UTR / Reference ID"
              placeholder="e.g. 123456789012"
              value={transactionRef}
              onChange={(e) => setTransactionRef(e.target.value)}
              helperText="Enter the 12-digit UPI reference number from your receipt"
            />

            {/* Payment Proof Upload Dropzone */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-zinc-800">
                Upload Payment Screenshot
              </label>
              <div
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setProofUploaded(!proofUploaded);
                  }
                }}
                onClick={() => setProofUploaded(!proofUploaded)}
                className={`flex flex-col items-center justify-center p-4 border-2 border-dashed rounded-xl transition-all cursor-pointer text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 ${
                  proofUploaded
                    ? 'border-emerald-500 bg-emerald-50/50 shadow-2xs'
                    : 'border-zinc-200 hover:border-zinc-400 bg-zinc-50/50'
                }`}
              >
                <Upload className={`h-5 w-5 mb-1.5 ${proofUploaded ? 'text-emerald-600' : 'text-zinc-400'}`} />
                <span className="text-xs font-semibold text-zinc-900">
                  {proofUploaded ? 'payment_receipt_2026.png attached' : 'Click to select payment screenshot'}
                </span>
                <span className="text-[10px] text-zinc-400 mt-0.5">
                  Private bucket storage (payment-proofs)
                </span>
              </div>
            </div>

            <Button
              disabled={!proofUploaded}
              isLoading={isSubmitting}
              loadingText="Submitting Proof..."
              onClick={handleSubmit}
              className="w-full text-xs font-semibold shadow-xs min-h-[40px]"
              size="md"
            >
              Submit Payment Proof
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

