import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  AlertCircle,
  Calendar,
  Check,
  Clock,
  Copy,
  CreditCard,
  FileImage,
  HelpCircle,
  Loader2,
  Lock,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Upload,
  Video,
  X,
  Zap,
} from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import { useToast } from '@/src/context/ToastContext';
import { toUserMessage } from '@/src/lib/errorMessages';
import { fetchBookingDetail, EnrichedBookingRecord } from '@/src/lib/bookingService';
import { formatInr } from '@/src/lib/seekerFormat';
import { fetchPaymentState, submitPaymentProof } from '@/src/lib/paymentService';
import { fetchPaymentConfiguration, type PublicPaymentConfiguration } from '@/src/lib/platformConfig';
import { fetchRazorpayConfig, type RazorpayApiResult } from '@/src/lib/razorpayClient';
import RazorpayCheckoutCard from '@/src/components/seeker/RazorpayCheckoutCard';
import {
  PAYMENT_PROOF_MIME_TYPES,
  formatFileSize,
  normaliseTransactionReference,
  validateProofFile,
} from '@/src/lib/paymentProof';
import type { Payment } from '@/src/types/database';
import { APP_CONFIG, HOLDOUT_MINUTES } from '@/src/config/app';
import { PageHeading } from '@/src/components/booking/PageHeading';
import { SegmentScope } from '@/src/components/booking/SegmentScope';
import { StatusPill } from '@/src/components/booking/StatusPill';
import { InlineNotice, SectionCard, StatePanel } from '@/src/components/booking/StatePanel';
import { HoldCountdown } from '@/src/components/booking/HoldCountdown';
import { BookingSummary } from '@/src/components/booking/BookingSummary';
import { TONE_SURFACE, TONE_TEXT } from '@/src/components/booking/tokens';
import { describeBookingStatus, describePaymentStatus } from '@/src/components/booking/statusTone';
import { cn } from '@/src/lib/utils';

// Type for the stored Razorpay config data (from the API response data field)
type RazorpayConfigData = {
  enabled: boolean;
  currency: string | null;
  razorpayKeyId: string | null;
};

/**
 * Shown when the gateway itself is unreachable, as distinct from "the platform
 * has not finished configuring Razorpay". The two read very differently to a
 * seeker, so they are never given the same wording.
 */
const FALLBACK_RAZORPAY_ERROR = 'Online payment is temporarily unavailable.';

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

  // Razorpay config and payment method selection
  const [razorpayConfig, setRazorpayConfig] = useState<RazorpayConfigData | null>(null);
  const [razorpayConfigError, setRazorpayConfigError] = useState<string | null>(null);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<'manual' | 'razorpay'>('manual');

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
  //
  // The two probes are independent by design. A Razorpay outage must degrade to
  // manual UPI, never to a dead payment page, so neither request is awaited by,
  // or allowed to fail, the other.
  useEffect(() => {
    let cancelled = false;

    const loadPaymentDetails = async () => {
      try {
        const paymentConfig = await fetchPaymentConfiguration();
        if (cancelled) return;
        setPaymentDetails(paymentConfig);
        setPaymentDetailsError(null);
      } catch (err) {
        if (cancelled) return;
        setPaymentDetails(null);
        setPaymentDetailsError(
          toUserMessage(
            err,
            'Payment details are temporarily unavailable. Please try again shortly.'
          )
        );
      }
    };

    const loadRazorpay = async () => {
      try {
        const razorpayResult = await fetchRazorpayConfig();
        if (cancelled) return;
        if (razorpayResult.success) {
          setRazorpayConfig(razorpayResult.data);
          setRazorpayConfigError(null);
          // Razorpay is preselected only when it is genuinely enabled AND keyed;
          // anything less stays on the manual flow, silently.
          setSelectedPaymentMethod(
            razorpayResult.data.enabled && razorpayResult.data.razorpayKeyId
              ? 'razorpay'
              : 'manual'
          );
        } else {
          setRazorpayConfig(null);
          setRazorpayConfigError(toUserMessage(razorpayResult.message, FALLBACK_RAZORPAY_ERROR));
          setSelectedPaymentMethod('manual');
        }
      } catch (err) {
        if (cancelled) return;
        setRazorpayConfig(null);
        setRazorpayConfigError(toUserMessage(err, FALLBACK_RAZORPAY_ERROR));
        setSelectedPaymentMethod('manual');
      }
    };

    void loadPaymentDetails();
    void loadRazorpay();

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

  const backToBookings = () => navigate('/seeker/bookings');

  if (!bookingId) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <PageHeading
          title="Complete your booking"
          back={{ label: 'Back to my bookings', onClick: backToBookings }}
        />
        <EmptyState
          icon={QrCode}
          title="No booking selected"
          description="Select a booking to proceed to payment."
          actionLabel="View my bookings"
          onAction={backToBookings}
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <PageHeading title="Complete your booking" back={{ label: 'Back to my bookings', onClick: backToBookings }} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SectionCard aria-label="Booking summary">
            <div className="flex items-center gap-3.5">
              <Skeleton variant="circular" className="h-12 w-12 shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
            <Skeleton className="mt-5 h-16 w-full" />
            <div className="mt-5 grid grid-cols-2 gap-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
            <Skeleton className="mt-5 h-6 w-1/3" />
          </SectionCard>
          <SectionCard aria-label="Payment">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="mt-4 h-12 w-full" />
            <Skeleton className="mt-4 h-40 w-full" />
          </SectionCard>
        </div>
        <p className="sr-only" role="status" aria-live="polite">
          Loading your booking and payment details.
        </p>
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <PageHeading title="Complete your booking" back={{ label: 'Back to my bookings', onClick: backToBookings }} />
        <ErrorState
          title="Booking not found"
          message={error || 'This booking could not be found. It may have been cancelled, or the link may be incorrect.'}
          onRetry={loadBooking}
        />
      </div>
    );
  }

  const isPaymentPending = booking.status === 'PAYMENT_PENDING';
  const isPendingVerification = booking.status === 'PENDING_VERIFICATION';
  const isMentorPending = booking.status === 'MENTOR_PENDING';
  const canShowPaymentForm = (isPaymentPending || isPendingVerification) && !payment && !isExpired;

  // Payment is only offered once the platform has configured WHERE to pay. A
  // UPI id is the minimum: it is what the seeker transfers to, and it is enough
  // on its own. The QR is an additional convenience rendered only when one is
  // configured, so a UPI-only setup still works rather than being blocked.
  const hasPaymentDestination = Boolean(paymentDetails?.upiId);
  const razorpayEnabled = Boolean(razorpayConfig?.enabled && razorpayConfig?.razorpayKeyId);
  const amount = formatInr(booking.amount_inr ?? booking.gig?.price_inr) || '—';

  const bookingDescriptor = describeBookingStatus(booking.status);
  const statusTone = isPaymentPending
    ? ('warning' as const)
    : isPendingVerification
      ? ('info' as const)
      : isMentorPending
        ? ('info' as const)
        : ('success' as const);

  return (
    <SegmentScope slug={booking.segment?.slug} className="mx-auto w-full max-w-5xl">
      <div className="space-y-6">
        <PageHeading
          eyebrow={`Booking ${booking.booking_code}`}
          title="Complete your booking"
          description="Pay to confirm your session. Your slot stays held until the timer below runs out."
          back={{ label: 'Back to my bookings', onClick: backToBookings }}
          aside={
            <>
              <StatusPill tone={statusTone} label={bookingDescriptor.label} size="md" />
              {razorpayEnabled && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] px-3 py-1 text-[11px] font-semibold text-[var(--color-shell-text-muted)]">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  Secured payment
                </span>
              )}
            </>
          }
        />

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          {/* ================= LEFT: what is being paid for ================= */}
          <div className="min-w-0 space-y-4 lg:sticky lg:top-20">
            <SectionCard
              title="Booking summary"
              description="Everything below comes from your confirmed booking record."
              icon={Calendar}
            >
              <BookingSummary booking={booking} />
            </SectionCard>

            <InlineNotice tone="neutral" icon={ShieldCheck} title="How verification works">
              <p>
                Pay the exact amount shown above, then send us the transaction reference and a
                screenshot. A member of the team verifies the payment manually — usually within a
                few minutes — and the status on this page updates as soon as that happens.
              </p>
            </InlineNotice>
          </div>

          {/* ================= RIGHT: the payment surface ================= */}
          <div className="min-w-0 space-y-4">
            {paymentDetailsError && canShowPaymentForm ? (
              <ErrorState title="Payment details unavailable" message={paymentDetailsError} />
            ) : canShowPaymentForm && (hasPaymentDestination || razorpayEnabled) ? (
              <>
                <PaymentMethodSelector
                  hasManualPayment={hasPaymentDestination}
                  razorpayEnabled={razorpayEnabled}
                  selectedMethod={selectedPaymentMethod}
                  onSelectMethod={setSelectedPaymentMethod}
                  amount={amount}
                />
                {selectedPaymentMethod === 'razorpay' && razorpayEnabled ? (
                  <RazorpayCheckoutCard
                    booking={booking}
                    userName={booking.seeker?.full_name}
                    userEmail={booking.seeker?.email}
                    onPaymentVerified={loadBooking}
                    onUnavailable={() => navigate('/seeker/bookings')}
                  />
                  ) : selectedPaymentMethod === 'manual' && hasPaymentDestination ? (
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
              ) : razorpayEnabled ? (
                <RazorpayCheckoutCard
                  booking={booking}
                  userName={booking.seeker?.full_name}
                  userEmail={booking.seeker?.email}
                  onPaymentVerified={loadBooking}
                  onUnavailable={() => navigate('/seeker/bookings')}
                />
                ) : hasPaymentDestination ? (
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
              ) : (
                <PaymentUnavailableCard onBackToBookings={backToBookings} />
              )}
              {razorpayConfigError && (
                <InlineNotice
                  tone="warning"
                  icon={AlertCircle}
                  title="Online payment is currently unavailable"
                >
                  {razorpayConfigError} The manual UPI option is unaffected.
                </InlineNotice>
              )}
            </>
          ) : canShowPaymentForm ? (
              <PaymentUnavailableCard onBackToBookings={backToBookings} />
            ) : isExpired && isPaymentPending && !payment ? (
              <ExpiredStateCard
                onFindAnother={() => navigate('/seeker')}
                onBackToBookings={backToBookings}
              />
            ) : payment ? (
              <PaymentStatusPanel
                payment={payment}
                bookingCode={booking.booking_code}
                onViewBookings={backToBookings}
                onRefresh={loadBooking}
              />
            ) : (
              <BookingConfirmedCard
                booking={booking}
                onViewSession={() => navigate(`/seeker/session?bookingId=${booking.id}`)}
                onViewBookings={backToBookings}
              />
            )}
          </div>
        </div>
      </div>
    </SegmentScope>
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
  const amount = formatInr(booking.amount_inr ?? booking.gig?.price_inr) || '—';

  return (
    <SectionCard
      title="Pay by UPI"
      description="Transfer to the account below, then send us the reference and a screenshot."
      icon={QrCode}
      aside={<StatusPill tone="info" label="Manual verification" />}
    >
      <div className="space-y-5">
        <HoldCountdown
          secondsRemaining={countdownSeconds}
          totalSeconds={APP_CONFIG.HOLD_DURATION_MS / 1000}
          expired={isExpired}
          expiredBody={`Your ${HOLDOUT_MINUTES}-minute reservation window has ended. The slot has been released and may now be available to another seeker.`}
        />

        {/* The QR is the image an admin uploaded, served from Supabase Storage.
            There is no decorative stand-in: this branch only renders when a
            real QR is configured. */}
        <div className="flex flex-col items-center gap-3 rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] p-5 text-center">
          {paymentDetails.qrImageUrl ? (
            <img
              src={paymentDetails.qrImageUrl}
              alt="Payment QR code — scan with any UPI app"
              className="h-40 w-40 rounded-xl border border-[var(--color-shell-border)] bg-white object-contain p-1.5"
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex h-40 w-40 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--color-shell-border-strong)] px-3 text-center"
            >
              <QrCode className="h-7 w-7 text-[var(--color-shell-text-subtle)]" />
              <span className="text-[11px] leading-snug text-[var(--color-shell-text-subtle)]">
                No QR configured — use the UPI ID below
              </span>
            </div>
          )}

          <div className="space-y-0.5">
            <p className="text-[13px] font-bold text-[var(--color-shell-text)]">
              Scan with any UPI app
            </p>
            {paymentDetails.accountName && (
              <p className="text-[11.5px] text-[var(--color-shell-text-subtle)]">
                Payee: {paymentDetails.accountName}
              </p>
            )}
          </div>

          <div className="flex max-w-full items-center gap-1.5">
            <span className="token-wrap rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] px-2.5 py-1.5 font-mono text-[12.5px] text-[var(--color-shell-text-muted)]">
              {paymentDetails.upiId}
            </span>
            <button
              type="button"
              onClick={handleCopyUpi}
              className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] text-[var(--color-shell-text-muted)] transition-colors hover:bg-[var(--color-shell-surface-elevated)] hover:text-[var(--color-shell-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)]"
              aria-label="Copy UPI ID"
              title="Copy UPI ID"
            >
              {copiedUpi ? (
                <Check className="h-3.5 w-3.5 text-[var(--color-shell-success)]" aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
          </div>
          <p aria-live="polite" className="sr-only">
            {copiedUpi ? 'UPI ID copied to clipboard' : ''}
          </p>
        </div>

        {paymentDetails.instructions && (
          <div
            role="note"
            className="flex items-start gap-2 rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] p-3.5 text-[12.5px] leading-relaxed text-[var(--color-shell-text-muted)]"
          >
            <HelpCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="whitespace-pre-wrap">{paymentDetails.instructions}</span>
          </div>
        )}

        <PaymentStepsCard amount={amount} />

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
          <label htmlFor="payment-proof-file" className="block text-xs font-semibold text-[var(--color-shell-text)]">
            Upload payment screenshot
            <span className="ml-0.5 text-[var(--color-shell-error)]">*</span>
          </label>

          <input
            ref={fileInputRef}
            id="payment-proof-file"
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
            <div className={cn('flex items-center gap-3 rounded-xl border p-3', TONE_SURFACE.success)}>
              <FileImage
                className={cn('h-7 w-7 shrink-0', TONE_TEXT.success)}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-[var(--color-shell-text)]" title={proofFile.name}>
                  {proofFile.name}
                </p>
                <p className="text-[11.5px] text-[var(--color-shell-text-muted)]">
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
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
                <span>Change</span>
              </Button>
              <button
                type="button"
                onClick={clearProofFile}
                disabled={isSubmitting}
                aria-label="Remove selected screenshot"
                className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-[var(--color-shell-text-muted)] transition-colors hover:bg-[var(--color-shell-error-soft)] hover:text-[var(--color-shell-error)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                setProofFile(e.dataTransfer.files?.[0]);
              }}
              disabled={isSubmitting}
              aria-describedby="payment-proof-hint"
              className={cn(
                'flex w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)]',
                'disabled:cursor-not-allowed disabled:opacity-60',
                isDragging
                  ? 'border-[var(--segment-accent)] bg-[var(--segment-accent-soft)]'
                  : 'border-[var(--color-shell-border-strong)] bg-[var(--color-shell-surface-elevated)] hover:border-[var(--color-shell-text-subtle)]'
              )}
            >
              <Upload className="mb-2 h-6 w-6 text-[var(--color-shell-text-subtle)]" aria-hidden="true" />
              <span className="text-[13px] font-semibold text-[var(--color-shell-text)]">
                Click or drag to select your screenshot
              </span>
              <span id="payment-proof-hint" className="mt-1 text-[11px] text-[var(--color-shell-text-subtle)]">
                PNG, JPG, JPEG or WEBP · up to 5 MB · stored in a private bucket
              </span>
            </button>
          )}

          {proofError && (
            <p className="flex items-center gap-1 text-xs font-medium text-[var(--color-shell-error)]" role="alert">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{proofError}</span>
            </p>
          )}
        </div>

        {submitError && (
          <InlineNotice tone="danger" role="alert" icon={AlertCircle} title="We could not submit your proof">
            {submitError}
          </InlineNotice>
        )}

        <Button
          disabled={isSubmitting || !transactionRef.trim() || !proofFile}
          isLoading={isSubmitting}
          loadingText={isUploading ? 'Uploading screenshot...' : 'Submitting proof...'}
          onClick={handleSubmit}
          className="w-full gap-2 font-semibold shadow-xs"
          size="lg"
        >
          {!isSubmitting && <Lock className="h-4 w-4" aria-hidden="true" />}
          <span>Submit payment proof</span>
        </Button>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[12px] text-[var(--color-shell-text-subtle)]">
          <span>Session total</span>
          <span className="font-semibold tabular-nums text-[var(--color-shell-text)]">{amount}</span>
        </div>

        <p className="text-center text-[11.5px] leading-relaxed text-[var(--color-shell-text-subtle)]">
          Submitting a proof does not confirm your payment. A member of the team verifies it before
          the booking is confirmed, and the status above updates when they do.
        </p>
      </div>
    </SectionCard>
  );
};

/**
 * The three manual steps, with the exact amount attached.
 *
 * The amount is passed in rather than hard-coded so the instructions and the
 * figure being verified can never disagree.
 */
const PaymentStepsCard: React.FC<{ amount: string }> = ({ amount }) => {
  const steps = [
    { number: '01', label: 'Pay the exact amount', description: `Send ${amount} to the UPI ID above` },
    { number: '02', label: 'Keep your transaction reference', description: 'Copy the UTR from your payment receipt' },
    { number: '03', label: 'Upload your payment proof', description: 'Submit the reference and screenshot for verification' },
  ];

  return (
    <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] p-4">
      <h4 className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-shell-text-subtle)]">
        Payment steps
      </h4>
      <ol className="mt-3 space-y-3">
        {steps.map((step) => (
          <li key={step.number} className="flex items-start gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--segment-accent-soft)] font-mono text-[11px] font-bold text-[var(--segment-accent)]">
              {step.number}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-[var(--color-shell-text)]">{step.label}</p>
              <p className="text-[11.5px] text-[var(--color-shell-text-muted)]">{step.description}</p>
            </div>
          </li>
        ))}
      </ol>
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
  <StatePanel
    tone="warning"
    icon={AlertCircle}
    title="Payment is not yet available"
    description="This booking is waiting for payment, but the platform has not finished setting up its payment details. Your slot is still reserved — please check back shortly or contact support."
    live="polite"
    actions={
      <Button onClick={onBackToBookings} variant="outline">
        Back to my bookings
      </Button>
    }
  />
);

const ExpiredStateCard: React.FC<ExpiredStateCardProps> = ({ onFindAnother, onBackToBookings }) => (
  <StatePanel
    tone="danger"
    icon={Clock}
    title="Payment window expired"
    description={`Your ${HOLDOUT_MINUTES}-minute reservation window has ended. The slot has been released and may now be available to another seeker.`}
    live="assertive"
    actions={
      <>
        <Button onClick={onFindAnother} className="gap-2">
          <Zap className="h-4 w-4" aria-hidden="true" />
          <span>Find another session</span>
        </Button>
        <Button onClick={onBackToBookings} variant="outline">
          Back to my bookings
        </Button>
      </>
    }
  />
);

interface PaymentStatusPanelProps {
  payment: Payment;
  bookingCode: string;
  onViewBookings: () => void;
  onRefresh: () => void;
}

const PaymentStatusPanel: React.FC<PaymentStatusPanelProps> = ({
  payment,
  bookingCode,
  onViewBookings,
  onRefresh,
}) => {
  const descriptor = describePaymentStatus(payment.status);
  const tone = descriptor.tone;

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

  const facts = [
    { label: 'Booking', value: bookingCode },
    { label: 'Status', value: <StatusPill tone={tone} label={descriptor.label} /> },
    ...(payment.transaction_reference
      ? [{ label: 'Reference', value: <span className="font-mono text-[12.5px]">{payment.transaction_reference}</span> }]
      : []),
    { label: 'Amount', value: formatInr(payment.amount_inr) || '—' },
    ...(payment.verified_at
      ? [
          {
            label: 'Verified',
            value: new Date(payment.verified_at).toLocaleString('en-IN', {
              dateStyle: 'medium',
              timeStyle: 'short',
            }),
          },
        ]
      : []),
  ];

  return (
    <StatePanel
      tone={tone}
      icon={payment.status === 'VERIFIED' ? Check : payment.status === 'REJECTED' ? AlertCircle : ShieldCheck}
      title={
        payment.status === 'VERIFIED'
          ? 'Payment verified'
          : payment.status === 'REJECTED'
            ? 'This payment needs your attention'
            : 'Payment proof submitted'
      }
      description={description}
      facts={facts}
      live="polite"
      actions={
        <>
          <Button onClick={onViewBookings} className="gap-2">
            <Calendar className="h-4 w-4" aria-hidden="true" />
            <span>View my booking</span>
          </Button>
          <Button onClick={onRefresh} variant="outline" className="gap-2">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            <span>Refresh status</span>
          </Button>
        </>
      }
    />
  );
};

interface BookingConfirmedCardProps {
  booking: EnrichedBookingRecord;
  onViewSession: () => void;
  onViewBookings: () => void;
}

const BookingConfirmedCard: React.FC<BookingConfirmedCardProps> = ({
  booking,
  onViewSession,
  onViewBookings,
}) => (
  <StatePanel
    tone="success"
    icon={Check}
    title="Booking confirmed"
    description="Your session is confirmed. The meeting link unlocks 5 minutes before the scheduled start time."
    facts={[
      { label: 'Booking', value: booking.booking_code },
      { label: 'Status', value: <StatusPill tone="success" label="Confirmed" /> },
      { label: 'Amount', value: formatInr(booking.amount_inr ?? booking.gig?.price_inr) || '—' },
    ]}
    live="polite"
    actions={
      <>
        <Button onClick={onViewSession} className="gap-2">
          <Video className="h-4 w-4" aria-hidden="true" />
          <span>Open session room</span>
        </Button>
        <Button onClick={onViewBookings} variant="outline" className="gap-2">
          <Calendar className="h-4 w-4" aria-hidden="true" />
          <span>My bookings</span>
        </Button>
      </>
    }
  />
);

interface PaymentMethodSelectorProps {
  hasManualPayment: boolean;
  razorpayEnabled: boolean;
  selectedMethod: 'manual' | 'razorpay';
  onSelectMethod: (method: 'manual' | 'razorpay') => void;
  amount: string;
}

const PAYMENT_METHODS = [
  {
    id: 'manual' as const,
    label: 'Pay by UPI',
    description: 'Scan the QR or use the UPI ID, then upload your proof',
    icon: QrCode,
  },
  {
    id: 'razorpay' as const,
    label: 'Razorpay checkout',
    description: 'UPI, cards, netbanking or wallets — verified instantly',
    icon: CreditCard,
  },
];

const PaymentMethodSelector: React.FC<PaymentMethodSelectorProps> = ({
  hasManualPayment,
  razorpayEnabled,
  selectedMethod,
  onSelectMethod,
  amount,
}) => {
  // If only one method is available, auto-select it and show a compact indicator
  if (hasManualPayment && !razorpayEnabled) {
    return (
      <div className={cn('flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-center', TONE_SURFACE.neutral)}>
        <StatusPill tone="info" label="Pay by UPI" />
        <span className="text-[12.5px] text-[var(--color-shell-text-muted)]">
          Paying <span className="font-semibold tabular-nums text-[var(--color-shell-text)]">{amount}</span> via UPI
        </span>
      </div>
    );
  }

  if (!hasManualPayment && razorpayEnabled) {
    return (
      <div className={cn('flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-center', TONE_SURFACE.neutral)}>
        <StatusPill tone="info" label="Razorpay" />
        <span className="text-[12.5px] text-[var(--color-shell-text-muted)]">
          Paying <span className="font-semibold tabular-nums text-[var(--color-shell-text)]">{amount}</span> via Razorpay
        </span>
      </div>
    );
  }

  // Both available - show selector as a real radiogroup
  const options = PAYMENT_METHODS.filter((m) =>
    m.id === 'manual' ? hasManualPayment : razorpayEnabled
  );

  return (
    <fieldset className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-4 shadow-xs sm:p-5">
      <legend className="px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-shell-text-subtle)]">
        Choose how to pay
      </legend>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {options.map((option) => {
          const Icon = option.icon;
          const selected = selectedMethod === option.id;
          return (
            <label
              key={option.id}
              className={cn(
                'group flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors',
                'focus-within:ring-2 focus-within:ring-[var(--color-shell-focus)] focus-within:ring-offset-2 focus-within:ring-offset-[var(--color-shell-surface)]',
                selected
                  ? 'border-[var(--segment-border-accent)] bg-[var(--segment-accent-soft)]'
                  : 'border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] hover:border-[var(--color-shell-border-strong)]'
              )}
            >
              <input
                type="radio"
                name="payment-method"
                value={option.id}
                checked={selected}
                onChange={() => onSelectMethod(option.id)}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={cn(
                  'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
                  selected
                    ? 'border-[var(--segment-border-accent)] bg-[var(--color-shell-surface)] text-[var(--segment-accent)]'
                    : 'border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] text-[var(--color-shell-text-muted)]'
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-shell-text)]">
                  {option.label}
                  {selected && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                </span>
                <span className="mt-0.5 block text-[11.5px] leading-relaxed text-[var(--color-shell-text-muted)]">
                  {option.description}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
};

export default SeekerPaymentPage;
