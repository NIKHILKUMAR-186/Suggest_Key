import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ArrowLeft,
  Clock,
  QrCode,
  Upload,
  ShieldCheck,
  CheckCircle2,
  Copy,
  Check,
  AlertCircle,
  FileImage,
  X,
  RefreshCw,
  Loader2,
  CreditCard,
  CheckSquare,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Zap,
  Video,
  Calendar,
} from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { Input } from '@/src/components/ui/Input';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import { useToast } from '@/src/context/ToastContext';
import { toUserMessage } from '@/src/lib/errorMessages';
import { fetchBookingDetail, EnrichedBookingRecord } from '@/src/lib/bookingService';
import { formatLocalTimeLabel } from '@/src/lib/slotEngine';
import { formatInr } from '@/src/lib/seekerFormat';
import { fetchPaymentState, submitPaymentProof } from '@/src/lib/paymentService';
import { fetchPaymentConfiguration, type PublicPaymentConfiguration } from '@/src/lib/platformConfig';
import {
  PAYMENT_PROOF_MIME_TYPES,
  formatFileSize,
  normaliseTransactionReference,
  validateProofFile,
} from '@/src/lib/paymentProof';
import type { Payment } from '@/src/types/database';
import { APP_CONFIG, HOLDOUT_MINUTES } from '@/src/config/app';
import { formatCountdown } from '@/src/lib/bookingService';

export const SeekerPaymentPage: React.FC = () => {
  const { navigate, currentPath } = useNavigation();
  const { user } = useAuth();
  const toast = useToast();

  const getBookingIdFromUrl = (): string => {
    const params = new URLSearchParams(currentPath.includes('?') ? currentPath.split('?')[1] : '');
    return params.get('bookingId') || '';
  };

  const [bookingId] = useState<string>(getBookingIdFromUrl());
  const [booking, setBooking] = useState<EnrichedBookingRecord | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [holdExpiresAt, setHoldExpiresAt] = useState<string | null>(null);

  /**
   * Where to actually pay, as configured by an admin in the admin console.
   *
   * There is no fallback UPI id, stock QR or canned instruction in this file: if
   * the platform has not been configured, the payment form is not shown at all.
   * Showing a plausible-looking placeholder would let a seeker transfer money to
   * an address nobody controls.
   */
  const [paymentDetails, setPaymentDetails] = useState<PublicPaymentConfiguration | null>(null);
  const [paymentDetailsError, setPaymentDetailsError] = useState<string | null>(null);

  const [transactionRef, setTransactionRef] = useState('');
  const [referenceError, setReferenceError] = useState<string | null>(null);

  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [copiedUpi, setCopiedUpi] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const countdownRef = useRef<number | null>(null);
  const [countdownSeconds, setCountdownSeconds] = useState<number>(0);
  const [isExpired, setIsExpired] = useState(false);

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
      if (!data) {
        setError('Booking not found.');
        setLoading(false);
        return;
      }
      setBooking(data);

      if (data.hold?.expires_at) {
        setHoldExpiresAt(data.hold.expires_at);
      }

      const state = await fetchPaymentState(bookingId);
      if (state.success) setPayment(state.payment);
    } catch (err: any) {
      setError(toUserMessage(err, 'Failed to load booking details.'));
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  useEffect(() => {
    loadBooking();
  }, [loadBooking]);

  // Loaded once per page, independently of the booking: these are the platform's
  // current payment instructions, not anything about this booking.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const config = await fetchPaymentConfiguration();
        if (!cancelled) {
          setPaymentDetails(config);
          setPaymentDetailsError(null);
        }
      } catch (err: any) {
        if (cancelled) return;
        setPaymentDetails(null);
        setPaymentDetailsError(
          toUserMessage(err, 'Payment details are temporarily unavailable. Please try again shortly.'),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!holdExpiresAt || payment) return;

    const updateCountdown = () => {
      const expiresMs = new Date(holdExpiresAt).getTime();
      const nowMs = Date.now();
      const diffSec = Math.floor((expiresMs - nowMs) / 1000);

      if (diffSec <= 0) {
        setCountdownSeconds(0);
        setIsExpired(true);
        if (countdownRef.current) clearInterval(countdownRef.current);
        loadBooking();
      } else {
        setCountdownSeconds(diffSec);
      }
    };

    updateCountdown();
    countdownRef.current = window.setInterval(updateCountdown, 1000);

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [holdExpiresAt, payment, loadBooking]);

  const handleCopyUpi = () => {
    // Copies whatever the admin actually configured. With no configured UPI id
    // the form is not rendered, so this can never copy a placeholder.
    if (!paymentDetails?.upiId) return;
    navigator.clipboard.writeText(paymentDetails.upiId);
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
    if (!user?.id) {
      setSubmitError('You need to be signed in to submit a payment proof.');
      return;
    }

    setIsSubmitting(true);
    setIsUploading(true);
    try {
      const result = await submitPaymentProof({
        bookingId,
        transactionReference: reference.value,
        file: proofFile!,
        seekerId: user.id,
      });

      if (!result.success) {
        setSubmitError(
          toUserMessage(result.error?.message, 'We could not submit your payment proof. Please try again.'),
        );
        if (result.payment) setPayment(result.payment);
        return;
      }

      setPayment(result.payment);
      setTransactionRef('');
      clearProofFile();
      await loadBooking();
      toast.success('Payment proof submitted. We will verify it shortly.');
    } catch (err: any) {
      setSubmitError(toUserMessage(err, 'We could not submit your payment proof. Please try again.'));
    } finally {
      setIsSubmitting(false);
      setIsUploading(false);
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
          message={error || 'This booking could not be found. It may have been cancelled, or the link may be incorrect.'}
          onRetry={loadBooking}
        />
      </div>
    );
  }

  const isPaymentPending = booking.status === 'PAYMENT_PENDING';
  const isPendingVerification = booking.status === 'PENDING_VERIFICATION';
  const isMentorPending = booking.status === 'MENTOR_PENDING';
  const isConfirmed = booking.status === 'CONFIRMED';
  const isCompleted = booking.status === 'COMPLETED';
  const isCancelled = booking.status === 'CANCELLED' || booking.status === 'REJECTED';
  const canShowPaymentForm = (isPaymentPending || isPendingVerification) && !payment && !isExpired;

  // Payment is only offered once the platform has configured WHERE to pay. A
  // UPI id is the minimum: it is what the seeker transfers to, and it is enough
  // on its own. The QR is an additional convenience rendered only when one is
  // configured, so a UPI-only setup still works rather than being blocked.
  const hasPaymentDestination = Boolean(paymentDetails?.upiId);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <button
        onClick={() => navigate('/seeker/bookings')}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)] transition-colors p-1 -ml-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-accent)] cursor-pointer"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        <span>Back to My Bookings</span>
      </button>

      <div className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--color-shell-border)] pb-4">
          <div>
            <h1 className="text-xl font-bold text-[var(--color-shell-text)] font-display">Complete Your Booking</h1>
            <p className="text-xs text-[var(--color-shell-text-muted)] mt-1">Secure your session with payment</p>
          </div>
          <Badge variant={isPaymentPending ? 'warning' : isPendingVerification ? 'secondary' : 'success'} className="text-[10px] font-bold whitespace-nowrap shrink-0">
            {isPaymentPending ? 'Payment Required' : isPendingVerification ? 'Verification Pending' : isMentorPending ? 'Awaiting Mentor' : 'Confirmed'}
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <BookingSummaryCard booking={booking} />

          {paymentDetailsError && canShowPaymentForm ? (
            <ErrorState
              title="Payment Details Unavailable"
              message={paymentDetailsError}
            />
          ) : canShowPaymentForm && hasPaymentDestination ? (
            <PaymentFormCard
              booking={booking}
              paymentDetails={paymentDetails!}
              holdExpiresAt={holdExpiresAt}
              countdownSeconds={countdownSeconds}
              isExpired={isExpired}
              transactionRef={transactionRef}
              setTransactionRef={setTransactionRef}
              referenceError={referenceError}
              setReferenceError={setReferenceError}
              proofFile={proofFile}
              setProofFile={selectProofFile}
              clearProofFile={clearProofFile}
              proofError={proofError}
              isDragging={isDragging}
              setIsDragging={setIsDragging}
              copiedUpi={copiedUpi}
              setCopiedUpi={setCopiedUpi}
              isSubmitting={isSubmitting}
              isUploading={isUploading}
              submitError={submitError}
              fileInputRef={fileInputRef}
              handleCopyUpi={handleCopyUpi}
              handleSubmit={handleSubmit}
            />
          ) : canShowPaymentForm ? (
            <PaymentUnavailableCard onBackToBookings={() => navigate('/seeker/bookings')} />
          ) : isExpired && isPaymentPending && !payment ? (
            <ExpiredStateCard onFindAnother={() => navigate('/seeker')} onBackToBookings={() => navigate('/seeker/bookings')} />
          ) : payment ? (
            <PaymentStatusPanel
              payment={payment}
              bookingCode={booking.booking_code}
              onViewBookings={() => navigate('/seeker/bookings')}
              onRefresh={loadBooking}
            />
          ) : (
            <BookingConfirmedCard booking={booking} onViewSession={() => navigate(`/seeker/session?bookingId=${booking.id}`)} />
          )}
        </div>
      </div>
    </div>
  );
};

interface BookingSummaryCardProps {
  booking: EnrichedBookingRecord;
}

const BookingSummaryCard: React.FC<BookingSummaryCardProps> = ({ booking }) => {
  const startDate = new Date(booking.start_time);
  const endDate = new Date(booking.end_time);

  return (
    <div className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-sm space-y-5">
      <h2 className="text-base font-bold text-[var(--color-shell-text)] border-b border-[var(--color-shell-border)] pb-3 font-display">
        Booking Summary
      </h2>

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-shell-accent-soft)] text-[var(--color-shell-accent)] shrink-0">
            <CreditCard className="h-6 w-6" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-[var(--color-shell-text-muted)]">Booking Reference</p>
            <p className="font-mono font-bold text-[var(--color-shell-text)] truncate">{booking.booking_code}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-xs">
          <div>
            <p className="text-[var(--color-shell-text-muted)]">Mentor</p>
            <p className="font-semibold text-[var(--color-shell-text)] truncate">{booking.mentor?.full_name || '—'}</p>
          </div>
          <div>
            <p className="text-[var(--color-shell-text-muted)]">Segment</p>
            <p className="font-semibold text-[var(--color-shell-text)] truncate">{booking.segment?.name || '—'}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-xs">
          <div>
            <p className="text-[var(--color-shell-text-muted)]">Gig</p>
            <p className="font-semibold text-[var(--color-shell-text)] truncate">{booking.gig?.title || '—'}</p>
          </div>
          <div>
            <p className="text-[var(--color-shell-text-muted)]">Duration</p>
            <p className="font-semibold text-[var(--color-shell-text)]">{booking.gig?.duration_minutes ? `${booking.gig.duration_minutes} min` : '—'}</p>
          </div>
        </div>

        <div className="border-t border-[var(--color-shell-border)] pt-4 space-y-3 text-xs">
          <div className="flex items-center gap-2 text-[var(--color-shell-text-muted)]">
            <Calendar className="h-3.5 w-3.5 shrink-0" />
            <span>{startDate.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
          </div>
          <div className="flex items-center gap-2 text-[var(--color-shell-text-muted)]">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            <span>
              {formatLocalTimeLabel(booking.start_time).replace(' ', ' – ')}
              {' '}(IST)
            </span>
          </div>
          <div className="flex items-center gap-2 text-[var(--color-shell-text-muted)]">
            <HelpCircle className="h-3.5 w-3.5 shrink-0" />
            <span>Timezone: {booking.mentor_timezone || 'Asia/Kolkata'}</span>
          </div>
        </div>

        <div className="flex justify-between items-center border-t border-[var(--color-shell-border)] pt-4 text-lg font-bold text-[var(--color-shell-text)]">
          <span>Amount Due</span>
          <span className="text-xl">{formatInr(booking.amount_inr ?? booking.gig?.price_inr)}</span>
        </div>

        <div className="rounded-xl bg-[var(--color-shell-surface-elevated)] border border-[var(--color-shell-border)]/80 p-3.5 text-[11px] text-[var(--color-shell-text-muted)] space-y-1">
          <span className="font-bold text-[var(--color-shell-text)] block flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            How verification works
          </span>
          <p className="leading-relaxed">
            Pay the exact amount using the UPI QR code. Upload your payment screenshot with the transaction reference.
            Our team verifies payments manually, typically within a few minutes. You will see the status update here.
          </p>
        </div>
      </div>
    </div>
  );
};

interface PaymentFormCardProps {
  booking: EnrichedBookingRecord;
  paymentDetails: PublicPaymentConfiguration;
  holdExpiresAt: string | null;
  countdownSeconds: number;
  isExpired: boolean;
  transactionRef: string;
  setTransactionRef: (v: string) => void;
  referenceError: string | null;
  setReferenceError: (v: string | null) => void;
  proofFile: File | null;
  setProofFile: (file: File | null | undefined) => void;
  clearProofFile: () => void;
  proofError: string | null;
  isDragging: boolean;
  setIsDragging: (v: boolean) => void;
  copiedUpi: boolean;
  setCopiedUpi: (v: boolean) => void;
  isSubmitting: boolean;
  isUploading: boolean;
  submitError: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleCopyUpi: () => void;
  handleSubmit: () => Promise<void>;
}

const PaymentFormCard: React.FC<PaymentFormCardProps> = ({
  booking,
  paymentDetails,
  holdExpiresAt,
  countdownSeconds,
  isExpired,
  transactionRef,
  setTransactionRef,
  referenceError,
  setReferenceError,
  proofFile,
  setProofFile,
  clearProofFile,
  proofError,
  isDragging,
  setIsDragging,
  copiedUpi,
  setCopiedUpi,
  isSubmitting,
  isUploading,
  submitError,
  fileInputRef,
  handleCopyUpi,
  handleSubmit,
}) => {
  const progress = holdExpiresAt ? Math.max(0, Math.min(1, 1 - countdownSeconds / (APP_CONFIG.HOLD_DURATION_MS / 1000))) : 0;

  return (
    <div className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-sm space-y-5">
      <PaymentDeadlineCard
        holdExpiresAt={holdExpiresAt}
        countdownSeconds={countdownSeconds}
        isExpired={isExpired}
        progress={progress}
      />

      <div className="space-y-5">
        <h2 className="text-base font-bold text-[var(--color-shell-text)] border-b border-[var(--color-shell-border)] pb-3 font-display">
          Manual QR Payment
        </h2>

        <div className="flex flex-col items-center justify-center p-4 border border-[var(--color-shell-border)] rounded-xl bg-[var(--color-shell-surface-elevated)] text-center space-y-3">
          {/* The QR is the image an admin uploaded, served from Supabase Storage.
              There is no decorative stand-in: this branch only renders when a
              real QR is configured. */}
          {paymentDetails.qrImageUrl && (
            <img
              src={paymentDetails.qrImageUrl}
              alt="Payment QR code — scan with any UPI app"
              className="h-36 w-36 rounded-xl border border-[var(--color-shell-border)] bg-white object-contain p-1"
            />
          )}
          <span className="text-xs font-bold text-[var(--color-shell-text)]">Scan via Any UPI App</span>
          {paymentDetails.accountName && (
            <span className="text-[11px] text-[var(--color-shell-text-subtle)]">
              Payee: {paymentDetails.accountName}
            </span>
          )}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-mono text-[var(--color-shell-text-muted)] bg-[var(--color-shell-surface)] border border-[var(--color-shell-border)] px-2.5 py-1 rounded-lg break-all">
              {paymentDetails.upiId}
            </span>
            <button
              onClick={handleCopyUpi}
              className="p-1.5 text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)] rounded-lg hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-accent)]"
              aria-label="Copy UPI ID"
              title="Copy UPI ID"
            >
              {copiedUpi ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {paymentDetails.instructions && (
          <div
            role="note"
            className="flex items-start gap-2 rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] p-3 text-[11px] leading-relaxed text-[var(--color-shell-text-muted)]"
          >
            <HelpCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            <span className="whitespace-pre-wrap">{paymentDetails.instructions}</span>
          </div>
        )}

        <PaymentStepsCard />

        <Input
          label="Transaction Reference / UTR"
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

          <input
            ref={fileInputRef}
            type="file"
            accept={PAYMENT_PROOF_MIME_TYPES.join(',')}
            className="sr-only"
            aria-label="Payment proof screenshot file"
            onChange={(e) => {
              setProofFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />

          {proofFile ? (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-500/60 bg-emerald-50/50 dark:bg-emerald-900/20 p-3">
              <FileImage className="h-8 w-8 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-[var(--color-shell-text)]" title={proofFile.name}>
                  {proofFile.name}
                </p>
                <p className="text-[11px] text-[var(--color-shell-text-muted)]">
                  {isUploading ? (
                    <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--color-shell-text)]">
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                      Uploading…
                    </span>
                  ) : (
                    `${formatFileSize(proofFile.size)} · Ready to submit`
                  )}
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
                className="shrink-0 rounded-md p-1.5 text-[var(--color-shell-text-muted)] hover:bg-emerald-100/70 dark:hover:bg-emerald-900/30 hover:text-[var(--color-shell-error)] disabled:opacity-50 transition-colors cursor-pointer"
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
                setProofFile(e.dataTransfer.files?.[0]);
              }}
              disabled={isSubmitting}
              aria-describedby="payment-proof-hint"
              className={`flex w-full flex-col items-center justify-center p-6 border-2 border-dashed rounded-xl transition-all cursor-pointer text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-accent)] disabled:cursor-not-allowed disabled:opacity-60 ${
                isDragging
                  ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-900/20'
                  : 'border-[var(--color-shell-border)] hover:border-zinc-400 dark:hover:border-zinc-500 bg-[var(--color-shell-surface-elevated)]/50'
              }`}
            >
              <Upload className="h-6 w-6 mb-2 text-[var(--color-shell-text-subtle)]" />
              <span className="text-xs font-semibold text-[var(--color-shell-text)]">
                Click or drag to select payment screenshot
              </span>
              <span id="payment-proof-hint" className="text-[10px] text-[var(--color-shell-text-subtle)] mt-1">
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
          disabled={isSubmitting || !transactionRef.trim() || !proofFile}
          isLoading={isSubmitting}
          loadingText={isUploading ? 'Uploading screenshot...' : 'Submitting proof...'}
          onClick={handleSubmit}
          className="w-full text-xs font-semibold shadow-xs min-h-[44px]"
          size="md"
        >
          Submit Payment Proof
        </Button>

        <div className="flex items-center justify-between text-xs text-[var(--color-shell-text-subtle)]">
          <span>Session: {formatInr(booking.amount_inr ?? booking.gig?.price_inr)}</span>
          <span>Total: {formatInr(booking.amount_inr ?? booking.gig?.price_inr)}</span>
        </div>

        <p className="text-[11px] text-[var(--color-shell-text-subtle)] text-center">
          Submitting a proof does not confirm your payment. An admin verifies it before the booking is confirmed.
        </p>
      </div>
    </div>
  );
};

interface PaymentDeadlineCardProps {
  holdExpiresAt: string | null;
  countdownSeconds: number;
  isExpired: boolean;
  progress: number;
}

const PaymentDeadlineCard: React.FC<PaymentDeadlineCardProps> = ({
  holdExpiresAt,
  countdownSeconds,
  isExpired,
  progress,
}) => {
  if (!holdExpiresAt) return null;

  return (
    <div className={`relative rounded-xl border p-4 ${
      isExpired
        ? 'border-[var(--color-shell-error)]/40 bg-[var(--color-shell-error-soft)]'
        : 'border-[var(--color-shell-warning)]/30 bg-[var(--color-shell-warning-soft)]/70'
    }`}>
      <div className="flex items-start gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl shrink-0 ${
          isExpired
            ? 'bg-[var(--color-shell-error)]/10 text-[var(--color-shell-error)]'
            : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
        }`}>
          {isExpired ? <AlertCircle className="h-5 w-5" /> : <Clock className="h-5 w-5 animate-pulse" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className={`text-sm font-bold ${isExpired ? 'text-[var(--color-shell-error)]' : 'text-[var(--color-shell-text)]'}`}>
              {isExpired ? 'Payment Window Expired' : 'Payment Window'}
            </h3>
            {!isExpired && (
              <Badge variant="warning" className="text-[10px] font-bold">{HOLDOUT_MINUTES}-Min Hold</Badge>
            )}
          </div>
          <p className={`text-xs mt-0.5 leading-relaxed ${isExpired ? 'text-[var(--color-shell-error)]' : 'text-[var(--color-shell-text)]'}`}>
            {isExpired
              ? 'Your 15-minute reservation window has ended. The slot has been released and may now be available to another seeker.'
              : 'Complete payment within the countdown below. After the timer expires, the slot will be released automatically.'}
          </p>

          {!isExpired && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--color-shell-text-muted)]">Time Remaining</span>
                <span className="font-mono font-bold text-base tabular-nums text-[var(--color-shell-text)]">
                  {formatCountdown(countdownSeconds)}
                </span>
              </div>
              <div className="h-1.5 bg-[var(--color-shell-border)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-amber-600 transition-all duration-300 ease-out"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const PaymentStepsCard: React.FC = () => {
  const steps = [
    { number: '01', label: 'Pay the exact amount', description: 'Use any UPI app to scan the QR code' },
    { number: '02', label: 'Keep your transaction reference', description: 'Copy the UTR from your payment receipt' },
    { number: '03', label: 'Upload payment proof', description: 'Submit screenshot and reference for verification' },
  ];

  return (
    <div className="flex flex-col gap-3 p-4 rounded-xl bg-[var(--color-shell-surface-elevated)] border border-[var(--color-shell-border)]/50">
      <h4 className="text-xs font-bold text-[var(--color-shell-text-muted)] uppercase tracking-wider">Payment Steps</h4>
      <div className="space-y-3">
        {steps.map((step, idx) => (
          <div key={idx} className="flex items-start gap-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-shell-accent-soft)] text-[var(--color-shell-accent)] font-mono font-bold text-[11px] shrink-0 mt-0.5">
              {step.number}
            </span>
            <div className="flex-1">
              <p className="text-xs font-semibold text-[var(--color-shell-text)]">{step.label}</p>
              <p className="text-[10px] text-[var(--color-shell-text-muted)]">{step.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

interface ExpiredStateCardProps {
  onFindAnother: () => void;
  onBackToBookings: () => void;
}

/**
 * Shown instead of the payment form when the platform has no configured payment
 * destination.
 *
 * There is deliberately no form here: without a real UPI id a seeker has no way
 * to pay, and offering a form with a placeholder address would invite a transfer
 * to an account nobody controls. The hold still expires normally, so this is a
 * temporary state the admin resolves in the console.
 */
const PaymentUnavailableCard: React.FC<{ onBackToBookings: () => void }> = ({ onBackToBookings }) => (
  <div className="flex flex-col items-center justify-center rounded-2xl border border-[var(--color-shell-warning)]/30 bg-[var(--color-shell-warning-soft)] p-10 text-center space-y-4">
    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-shell-warning)]/10 text-[var(--color-shell-warning)]">
      <AlertCircle className="h-8 w-8" />
    </div>
    <div>
      <h3 className="text-lg font-bold text-[var(--color-shell-text)]">Payment Not Yet Available</h3>
      <p className="text-sm text-[var(--color-shell-text-muted)] mt-1 max-w-sm mx-auto">
        This booking is waiting for payment, but the platform has not finished setting up its payment details yet.
        Your slot is still reserved. Please check back shortly or contact support.
      </p>
    </div>
    <Button onClick={onBackToBookings} variant="outline" className="w-full sm:w-auto">
      Back to My Bookings
    </Button>
  </div>
);

const ExpiredStateCard: React.FC<ExpiredStateCardProps> = ({ onFindAnother, onBackToBookings }) => (
  <div className="flex flex-col items-center justify-center rounded-2xl border border-[var(--color-shell-error)]/30 bg-[var(--color-shell-error-soft)] p-10 text-center space-y-4">
    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-shell-error)]/10 text-[var(--color-shell-error)]">
      <AlertCircle className="h-8 w-8" />
    </div>
    <div>
      <h3 className="text-lg font-bold text-[var(--color-shell-error)]">Payment Window Expired</h3>
      <p className="text-sm text-[var(--color-shell-text-muted)] mt-1 max-w-sm mx-auto">
        Your 15-minute reservation window has ended. The slot has been released and may now be available to another seeker.
      </p>
    </div>
    <div className="flex flex-col sm:flex-row gap-3 pt-2">
      <Button onClick={onFindAnother} className="w-full sm:w-auto gap-1.5">
        <Zap className="h-3.5 w-3.5" />
        <span>Find Another Session</span>
      </Button>
      <Button onClick={onBackToBookings} variant="outline" className="w-full sm:w-auto">
        Back to My Bookings
      </Button>
    </div>
  </div>
);

interface PaymentStatusPanelProps {
  payment: Payment;
  bookingCode: string;
  onViewBookings: () => void;
  onRefresh: () => void;
}

const PaymentStatusPanel: React.FC<PaymentStatusPanelProps> = ({ payment, bookingCode, onViewBookings, onRefresh }) => {
  const tone = (() => {
    switch (payment.status) {
      case 'VERIFIED':
        return {
          wrap: 'border-emerald-200/90 bg-emerald-50/40 dark:border-emerald-900/30 dark:bg-emerald-900/20',
          icon: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200/80 dark:border-emerald-800/50',
          title: 'text-emerald-950 dark:text-emerald-100',
          body: 'text-emerald-800 dark:text-emerald-200',
        };
      case 'REJECTED':
        return {
          wrap: 'border-amber-200/90 bg-amber-50/40 dark:border-amber-900/30 dark:bg-amber-900/20',
          icon: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200/80 dark:border-amber-800/50',
          title: 'text-amber-950 dark:text-amber-100',
          body: 'text-amber-800 dark:text-amber-200',
        };
      default:
        return {
          wrap: 'border-sky-200/90 bg-sky-50/40 dark:border-sky-900/30 dark:bg-sky-900/20',
          icon: 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400 border-sky-200/80 dark:border-sky-800/50',
          title: 'text-sky-950 dark:text-sky-100',
          body: 'text-sky-800 dark:text-sky-200',
        };
    }
  })();

  const heading = (() => {
    switch (payment.status) {
      case 'VERIFIED': return 'Payment Verified';
      case 'REJECTED': return 'Payment Verification Requires Attention';
      default: return 'Payment Proof Submitted';
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

      <dl className="w-full max-w-sm space-y-2 rounded-xl border border-black/5 dark:border-white/10 bg-white/60 dark:bg-zinc-800/60 p-4 text-left text-xs">
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
          <span>Refresh Status</span>
        </Button>
      </div>
    </div>
  );
};

interface BookingConfirmedCardProps {
  booking: EnrichedBookingRecord;
  onViewSession: () => void;
}

const BookingConfirmedCard: React.FC<BookingConfirmedCardProps> = ({ booking, onViewSession }) => (
  <div className="rounded-2xl border border-emerald-200/90 bg-emerald-50/40 dark:border-emerald-900/30 dark:bg-emerald-900/20 p-8 text-center space-y-4">
    <div className="flex h-14 w-14 items-center justify-center rounded-2xl border shadow-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200/80 dark:border-emerald-800/50">
      <CheckCircle2 className="h-7 w-7" />
    </div>

    <h3 className="text-lg font-bold tracking-tight sm:text-xl text-emerald-950 dark:text-emerald-100">Booking Confirmed</h3>
    <p className="max-w-md text-xs leading-relaxed sm:text-sm text-emerald-800 dark:text-emerald-200">
      Your session is confirmed. The meeting link will unlock 5 minutes before the scheduled start time.
    </p>

    <dl className="w-full max-w-sm space-y-2 rounded-xl border border-black/5 dark:border-white/10 bg-white/60 dark:bg-zinc-800/60 p-4 text-left text-xs">
      <div className="flex items-center justify-between gap-4">
        <dt className="text-emerald-800 dark:text-emerald-200">Booking</dt>
        <dd className="font-mono font-bold text-[var(--color-shell-text)]">{booking.booking_code}</dd>
      </div>
      <div className="flex items-center justify-between gap-4">
        <dt className="text-emerald-800 dark:text-emerald-200">Status</dt>
        <dd>
          <Badge variant="success" className="text-[10px] font-bold">CONFIRMED</Badge>
        </dd>
      </div>
      <div className="flex items-center justify-between gap-4">
        <dt className="text-emerald-800 dark:text-emerald-200">Amount</dt>
        <dd className="font-bold text-[var(--color-shell-text)]">{formatInr(booking.amount_inr ?? booking.gig?.price_inr)}</dd>
      </div>
    </dl>

    <Button onClick={onViewSession} size="sm" className="shadow-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700">
      <Video className="h-3.5 w-3.5" />
      <span>Join Session Room</span>
    </Button>
  </div>
);

export default SeekerPaymentPage;