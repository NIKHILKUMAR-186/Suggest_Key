import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeft, Clock, QrCode, Upload, ShieldCheck, CheckCircle2, Copy, Check, AlertCircle, FileImage, X, RefreshCw } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { Input } from '@/src/components/ui/Input';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { useNavigation } from '@/src/context/NavigationContext';
import { fetchBookingDetail, EnrichedBookingRecord } from '@/src/lib/bookingService';
import { formatLocalTimeLabel } from '@/src/lib/slotEngine';
import { formatInr } from '@/src/lib/seekerFormat';
import { fetchPaymentState, submitPaymentProof } from '@/src/lib/paymentService';
import {
  PAYMENT_PROOF_MIME_TYPES,
  formatFileSize,
  normaliseTransactionReference,
  validateProofFile,
} from '@/src/lib/paymentProof';
import type { Payment } from '@/src/types/database';

export const SeekerPaymentPage: React.FC = () => {
  const { navigate, currentPath } = useNavigation();

  const getBookingIdFromUrl = (): string => {
    const params = new URLSearchParams(currentPath.includes('?') ? currentPath.split('?')[1] : '');
    return params.get('bookingId') || '';
  };

  const [bookingId] = useState<string>(getBookingIdFromUrl());
  const [booking, setBooking] = useState<EnrichedBookingRecord | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);

  // The UTR field starts EMPTY and is never populated by any code path.
  const [transactionRef, setTransactionRef] = useState('');
  const [referenceError, setReferenceError] = useState<string | null>(null);

  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [copiedUpi, setCopiedUpi] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // A plain <input type="file"> is visually hidden and driven programmatically,
  // so the whole drop zone stays a real button that opens the OS file picker.
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadBooking = useCallback(async () => {
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

      // Load the REAL payment state so a refresh (or a return visit) shows what
      // the database actually holds rather than resetting to an empty form.
      const state = await fetchPaymentState(bookingId);
      if (state.success) setPayment(state.payment);
    } catch (err: any) {
      setError(err.message || 'Failed to load booking details.');
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  useEffect(() => {
    loadBooking();
  }, [loadBooking]);

  const handleCopyUpi = () => {
    navigator.clipboard.writeText('suggestkey@upi');
    setCopiedUpi(true);
    setTimeout(() => setCopiedUpi(false), 2000);
  };

  const selectProofFile = (file: File | null | undefined) => {
    setSubmitError(null);
    if (!file) {
      setProofFile(null);
      setProofError('Select your payment screenshot.');
      return;
    }
    const result = validateProofFile({ name: file.name, type: file.type, size: file.size });
    if (!result.ok) {
      setProofFile(null);
      setProofError(result.message);
      return;
    }
    setProofFile(file);
    setProofError(null);
  };

  const clearProofFile = () => {
    setProofFile(null);
    setProofError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async () => {
    // Guards against a double click / accidental repeat submission.
    if (isSubmitting) return;

    setSubmitError(null);

    const reference = normaliseTransactionReference(transactionRef);
    if (!reference.ok) {
      setReferenceError(reference.message);
      return;
    }
    setReferenceError(null);

    const proof = validateProofFile(proofFile ? { name: proofFile.name, type: proofFile.type, size: proofFile.size } : null);
    if (!proof.ok) {
      setProofError(proof.message);
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await submitPaymentProof({
        bookingId,
        transactionReference: reference.value,
        file: proofFile!,
      });

      if (!result.success) {
        setSubmitError(result.error?.message || 'We could not submit your payment proof. Please try again.');
        // A verified payment is a terminal state: reflect it instead of
        // pretending the form can still be submitted.
        if (result.payment) setPayment(result.payment);
        return;
      }

      setPayment(result.payment);
      // Clear the form so a second click cannot re-send the same proof.
      setTransactionRef('');
      clearProofFile();
      // Re-read from the server so the summary reflects the real stored state.
      await loadBooking();
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!bookingId) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <button
          onClick={() => navigate('/seeker/bookings')}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)] transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Bookings</span>
        </button>
        <EmptyState
          icon={QrCode}
          title="No Booking Selected"
          description="Select a booking to proceed to payment."
          actionLabel="View My Bookings"
          onAction={() => navigate('/seeker/bookings')}
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <button
          onClick={() => navigate('/seeker/bookings')}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)] transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Bookings</span>
        </button>
        <div className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-12 text-center space-y-3">
          <Clock className="h-8 w-8 text-[var(--color-shell-text-subtle)] mx-auto animate-spin" />
          <h3 className="text-sm font-semibold text-[var(--color-shell-text)]">Loading Booking Details...</h3>
          <p className="text-xs text-[var(--color-shell-text-muted)]">Retrieving booking and payment information.</p>
        </div>
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <button
          onClick={() => navigate('/seeker/bookings')}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)] transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Bookings</span>
        </button>
        <ErrorState
          title="Booking Not Found"
          message={error || `Could not find booking ${bookingId}. It may have been cancelled or does not exist.`}
          onRetry={loadBooking}
        />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <button
        onClick={() => navigate('/seeker/bookings')}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)] transition-colors p-1 -ml-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 cursor-pointer"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        <span>Cancel & Back to Bookings</span>
      </button>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-[var(--color-shell-warning)]/30 bg-[var(--color-shell-warning-soft)]/70 p-4 shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-[var(--color-shell-text)] shrink-0">
            <Clock className="h-5 w-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-[var(--color-shell-text)]">Slot Hold Active</h2>
              <Badge variant="warning" className="text-[10px] font-bold">15-Min Lock</Badge>
            </div>
            <p className="text-xs text-[var(--color-shell-text)] mt-0.5 leading-relaxed">
              This slot is temporarily locked exclusively for you. If payment proof is not submitted within 15 minutes, the slot is automatically released.
            </p>
          </div>
        </div>
      </div>

      {payment ? (
        <PaymentStatusPanel
          payment={payment}
          bookingCode={booking.booking_code}
          onViewBookings={() => navigate('/seeker/bookings')}
          onRefresh={loadBooking}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-2xs space-y-5">
            <h2 className="text-base font-bold text-[var(--color-shell-text)] border-b border-[var(--color-shell-border)] pb-3 font-display">
              Booking Summary
            </h2>
            <div className="space-y-3 text-xs">
              <div className="flex justify-between items-center gap-4">
                <span className="text-[var(--color-shell-text-muted)]">Booking:</span>
                <span className="font-mono font-bold text-[var(--color-shell-text)]">{booking.booking_code}</span>
              </div>
              <div className="flex justify-between items-center gap-4">
                <span className="text-[var(--color-shell-text-muted)]">Mentor:</span>
                <span className="font-bold text-[var(--color-shell-text)] text-right">{booking.mentor?.full_name || '—'}</span>
              </div>
              <div className="flex justify-between items-center gap-4">
                <span className="text-[var(--color-shell-text-muted)]">Segment:</span>
                <span className="font-semibold text-[var(--color-shell-text)] text-right">{booking.segment?.name || '—'}</span>
              </div>
              <div className="flex justify-between items-center gap-4">
                <span className="text-[var(--color-shell-text-muted)]">Gig:</span>
                <span className="font-semibold text-[var(--color-shell-text)] text-right">{booking.gig?.title || '—'}</span>
              </div>
              <div className="flex justify-between items-center gap-4">
                <span className="text-[var(--color-shell-text-muted)]">Date &amp; Time:</span>
                <span className="font-semibold text-[var(--color-shell-text)] text-right">
                  {new Date(booking.start_time).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })} ·{' '}
                  {formatLocalTimeLabel(booking.start_time).replace(' ', ' – ').replace('PM', 'PM (IST)')}
                </span>
              </div>
              <div className="flex justify-between items-center gap-4">
                <span className="text-[var(--color-shell-text-muted)]">Duration:</span>
                <span className="font-semibold text-[var(--color-shell-text)]">
                  {booking.gig?.duration_minutes ? `${booking.gig.duration_minutes} Minutes` : '—'}
                </span>
              </div>
              <div className="flex justify-between items-center border-t border-[var(--color-shell-border)] pt-3 text-sm font-bold text-[var(--color-shell-text)]">
                <span>Amount due</span>
                <span className="text-base">
                  {formatInr(booking.amount_inr ?? booking.gig?.price_inr)}
                </span>
              </div>
            </div>

            <div className="rounded-xl bg-[var(--color-shell-surface-elevated)] border border-[var(--color-shell-border)]/80 p-3.5 text-[11px] text-[var(--color-shell-text-muted)] space-y-1">
              <span className="font-bold text-[var(--color-shell-text)] block">Payment Invariant Note:</span>
              <p className="leading-relaxed">
                MVP uses Manual QR verification. The payment layer is provider-abstracted for future Razorpay integration without altering availability or booking state machines.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-2xs space-y-5">
            <h2 className="text-base font-bold text-[var(--color-shell-text)] border-b border-[var(--color-shell-border)] pb-3 font-display">
              Manual QR Payment (MVP)
            </h2>

            <div className="flex flex-col items-center justify-center p-4 border border-[var(--color-shell-border)] rounded-xl bg-[var(--color-shell-surface-elevated)] text-center space-y-2.5">
              <div className="h-32 w-32 bg-[var(--color-shell-surface)] border border-zinc-300 rounded-xl flex items-center justify-center shadow-xs">
                <QrCode className="h-20 w-20 text-[var(--color-shell-text)]" />
              </div>
              <span className="text-xs font-bold text-[var(--color-shell-text)]">Scan via Any UPI App</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-mono text-[var(--color-shell-text-muted)] bg-[var(--color-shell-surface)] border border-[var(--color-shell-border)] px-2.5 py-1 rounded-lg">
                  suggestkey@upi
                </span>
                <button
                  onClick={handleCopyUpi}
                  className="p-1.5 text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)] rounded-lg hover:bg-zinc-200/60 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950"
                  aria-label="Copy UPI ID"
                  title="Copy UPI ID"
                >
                  {copiedUpi ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            <Input
              label="Transaction UTR / Reference ID"
              placeholder="Enter the reference from your receipt"
              value={transactionRef}
              onChange={(e) => {
                setTransactionRef(e.target.value);
                if (referenceError) setReferenceError(null);
              }}
              error={referenceError}
              helperText="Copy this exactly from your UPI receipt. It is never filled in for you."
              autoComplete="off"
              spellCheck={false}
              maxLength={64}
              disabled={isSubmitting}
              required
            />

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-[var(--color-shell-text)]">
                Upload Payment Screenshot
                <span className="text-[var(--color-shell-error)] ml-0.5">*</span>
              </label>

              {/* The real file input. It is hidden but fully functional, and the
                  drop zone below forwards clicks and keyboard activation to it,
                  so this opens the OS/browser file picker for real. */}
              <input
                ref={fileInputRef}
                type="file"
                accept={PAYMENT_PROOF_MIME_TYPES.join(',')}
                className="sr-only"
                aria-label="Payment proof screenshot file"
                onChange={(e) => {
                  selectProofFile(e.target.files?.[0]);
                  // Allows re-selecting the same file after a Remove.
                  e.target.value = '';
                }}
              />

              {proofFile ? (
                <div className="flex items-center gap-3 rounded-xl border border-emerald-500/60 bg-emerald-50/50 p-3">
                  <FileImage className="h-8 w-8 shrink-0 text-emerald-700" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-[var(--color-shell-text)]" title={proofFile.name}>
                      {proofFile.name}
                    </p>
                    <p className="text-[11px] text-[var(--color-shell-text-muted)]">
                      {formatFileSize(proofFile.size)} · Ready to upload
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 min-h-[32px] shrink-0 gap-1 px-2 text-[11px]"
                    disabled={isSubmitting}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <RefreshCw className="h-3 w-3" />
                    <span>Change</span>
                  </Button>
                  <button
                    type="button"
                    onClick={clearProofFile}
                    disabled={isSubmitting}
                    aria-label="Remove selected screenshot"
                    className="shrink-0 rounded-md p-1.5 text-[var(--color-shell-text-muted)] hover:bg-emerald-100/70 hover:text-[var(--color-shell-error)] disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    selectProofFile(e.dataTransfer.files?.[0]);
                  }}
                  disabled={isSubmitting}
                  aria-describedby="payment-proof-hint"
                  className={`flex w-full flex-col items-center justify-center p-4 border-2 border-dashed rounded-xl transition-all cursor-pointer text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 disabled:cursor-not-allowed disabled:opacity-60 ${
                    isDragging
                      ? 'border-emerald-500 bg-emerald-50/50'
                      : 'border-[var(--color-shell-border)] hover:border-zinc-400 bg-[var(--color-shell-surface-elevated)]/50'
                  }`}
                >
                  <Upload className="h-5 w-5 mb-1.5 text-[var(--color-shell-text-subtle)]" />
                  <span className="text-xs font-semibold text-[var(--color-shell-text)]">
                    Click to select payment screenshot
                  </span>
                  <span id="payment-proof-hint" className="text-[10px] text-[var(--color-shell-text-subtle)] mt-0.5">
                    PNG, JPG, JPEG or WEBP · up to 5 MB · stored in a private bucket
                  </span>
                </button>
              )}

              {proofError && (
                <p className="text-xs font-medium text-[var(--color-shell-error)] flex items-center gap-1" role="alert">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{proofError}</span>
                </p>
              )}
            </div>

            {submitError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-[var(--color-shell-error)]/40 bg-[var(--color-shell-error-soft)] p-3 text-xs font-medium text-[var(--color-shell-error)]"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{submitError}</span>
              </div>
            )}

            <Button
              disabled={isSubmitting}
              isLoading={isSubmitting}
              loadingText={isSubmitting ? 'Uploading & submitting proof...' : undefined}
              onClick={handleSubmit}
              className="w-full text-xs font-semibold shadow-xs min-h-[40px]"
              size="md"
            >
              Submit Payment Proof
            </Button>
            <p className="text-[11px] text-[var(--color-shell-text-subtle)] text-center">
              Submitting a proof does not confirm your payment. An admin verifies it before the booking is confirmed.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Renders the payment state that is actually stored in the database.
 *
 * Every field shown here comes from the `payments` row — never from "the user
 * just submitted", so a page refresh, a second visit, or an admin decision all
 * produce the same truthful screen. In particular the pending state says
 * "verification pending", never "payment successful".
 */
const PaymentStatusPanel: React.FC<{
  payment: Payment;
  bookingCode: string;
  onViewBookings: () => void;
  onRefresh: () => void;
}> = ({ payment, bookingCode, onViewBookings, onRefresh }) => {
  const tone = (() => {
    switch (payment.status) {
      case 'VERIFIED':
        return {
          wrap: 'border-emerald-200/90 bg-emerald-50/40',
          icon: 'bg-emerald-100 text-emerald-700 border-emerald-200/80',
          title: 'text-emerald-950',
          body: 'text-emerald-800',
        };
      case 'REJECTED':
        return {
          wrap: 'border-amber-200/90 bg-amber-50/40',
          icon: 'bg-amber-100 text-amber-700 border-amber-200/80',
          title: 'text-amber-950',
          body: 'text-amber-800',
        };
      default:
        return {
          wrap: 'border-sky-200/90 bg-sky-50/40',
          icon: 'bg-sky-100 text-sky-700 border-sky-200/80',
          title: 'text-sky-950',
          body: 'text-sky-800',
        };
    }
  })();

  const heading = (() => {
    switch (payment.status) {
      case 'VERIFIED':
        return 'Payment verified';
      case 'REJECTED':
        return 'Payment verification requires attention';
      default:
        return 'Payment proof submitted';
    }
  })();

  const description = (() => {
    switch (payment.status) {
      case 'VERIFIED':
        return 'An admin has verified your payment. The mentor will now add the meeting link for your session.';
      case 'REJECTED':
        return payment.rejection_reason
          ? `Your payment proof could not be verified: ${payment.rejection_reason}`
          : 'Your payment proof could not be verified. Please contact support or rebook the session.';
      default:
        return 'Your payment reference and proof have been submitted for verification. An admin will review them shortly.';
    }
  })();

  return (
    <div className={`flex w-full flex-col items-center justify-center rounded-2xl border p-8 text-center space-y-4 sm:p-12 ${tone.wrap}`}>
      <div className={`flex h-14 w-14 items-center justify-center rounded-2xl border shadow-xs ${tone.icon}`}>
        {payment.status === 'VERIFIED' ? <CheckCircle2 className="h-7 w-7" /> : <ShieldCheck className="h-7 w-7" />}
      </div>

      <h3 className={`text-lg font-bold tracking-tight sm:text-xl ${tone.title}`}>{heading}</h3>
      <p className={`max-w-md text-xs leading-relaxed sm:text-sm ${tone.body}`}>{description}</p>

      <dl className="w-full max-w-sm space-y-2 rounded-xl border border-black/5 bg-white/60 p-4 text-left text-xs">
        <div className="flex items-center justify-between gap-4">
          <dt className={tone.body}>Booking</dt>
          <dd className="font-mono font-bold text-[var(--color-shell-text)]">{bookingCode}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className={tone.body}>Status</dt>
          <dd>
            <Badge variant={payment.status === 'VERIFIED' ? 'success' : payment.status === 'REJECTED' ? 'destructive' : 'warning'} className="text-[10px] font-bold">
              {payment.status === 'PENDING_VERIFICATION' ? 'PAYMENT VERIFICATION PENDING' : payment.status}
            </Badge>
          </dd>
        </div>
        {payment.transaction_reference && (
          <div className="flex items-center justify-between gap-4">
            <dt className={tone.body}>Reference</dt>
            <dd className="font-mono font-semibold text-[var(--color-shell-text)]">{payment.transaction_reference}</dd>
          </div>
        )}
        <div className="flex items-center justify-between gap-4">
          <dt className={tone.body}>Amount</dt>
          <dd className="font-bold text-[var(--color-shell-text)]">{formatInr(payment.amount_inr)}</dd>
        </div>
        {payment.verified_at && (
          <div className="flex items-center justify-between gap-4">
            <dt className={tone.body}>Verified</dt>
            <dd className="font-semibold text-[var(--color-shell-text)]">
              {new Date(payment.verified_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
            </dd>
          </div>
        )}
      </dl>

      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        <Button onClick={onViewBookings} size="sm" className="shadow-xs">
          View My Booking
        </Button>
        <Button onClick={onRefresh} variant="outline" size="sm" className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Refresh status</span>
        </Button>
      </div>
    </div>
  );
};
