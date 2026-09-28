import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  CreditCard,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Zap,
  ShieldCheck,
  Lock,
  HelpCircle,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { formatInr } from '@/src/lib/seekerFormat';
import { toUserMessage } from '@/src/lib/errorMessages';
import { cn } from '@/src/lib/utils';
import type { EnrichedBookingRecord } from '@/src/lib/bookingService';
import type { RazorpayCheckoutOptions, RazorpayCheckoutResponse } from '@/src/lib/razorpayClient';
import {
  createRazorpayOrder,
  verifyRazorpayPayment,
  loadRazorpayScript,
  buildRazorpayCheckoutOptions,
  mapRazorpayErrorCode,
  isProcessingState,
  isRetryableState,
  isTerminalState,
  type RazorpayUiState,
  type RazorpayOrderData,
} from '@/src/lib/razorpayClient';
import { SectionCard, StatePanel, InlineNotice } from '@/src/components/booking/StatePanel';
import { StatusPill } from '@/src/components/booking/StatusPill';

/**
 * Props for the Razorpay Checkout card component.
 *
 * This component is self-contained: it manages the entire checkout flow
 * (order creation → script load → checkout open → verification) and
 * communicates completion via `onPaymentVerified`.
 */
export interface RazorpayCheckoutCardProps {
  /** The booking being paid for (provides amount, booking_code, etc.). */
  booking: EnrichedBookingRecord;
  /** Seeker's name for checkout prefill. */
  userName?: string;
  /** Seeker's email for checkout prefill. */
  userEmail?: string;
  /** Called when the payment is successfully verified. Parent should refresh state. */
  onPaymentVerified: () => void;
  /** Optional callback for navigation when the booking is no longer payable. */
  onUnavailable?: () => void;
}

/** The step a seeker is actually looking at, for every UI state. */
const STATE_COPY: Record<RazorpayUiState, { title: string; description: string; live: 'status' | 'alert' | 'region' }> = {
  idle: {
    title: 'Pay securely with Razorpay',
    description:
      'Razorpay opens its own checkout window. Pay by UPI, card, netbanking or wallet — nothing is stored on our servers.',
    live: 'region',
  },
  loading_config: {
    title: 'Checking payment availability',
    description: 'Confirming that online payment is configured for this platform.',
    live: 'status',
  },
  creating_order: {
    title: 'Preparing your payment',
    description: 'Creating a payment order. This usually takes a moment.',
    live: 'status',
  },
  opening_checkout: {
    title: 'Opening Razorpay checkout',
    description: 'Loading the secure checkout window. It will open in a moment.',
    live: 'status',
  },
  processing: {
    title: 'Complete payment in the Razorpay window',
    description:
      'Finish the payment in the Razorpay window that is open. If you closed it by accident, reopen it below.',
    live: 'status',
  },
  verifying: {
    title: 'Verifying your payment',
    description: 'Confirming the payment with the gateway. This is usually instant.',
    live: 'status',
  },
  success: {
    title: 'Payment confirmed',
    description:
      'Your payment has been verified. The mentor will now add the meeting link for your session.',
    live: 'status',
  },
  failed: {
    title: 'Payment could not be completed',
    description: 'Nothing was charged. You can try again while your hold is still active.',
    live: 'alert',
  },
  expired: {
    title: 'Payment window expired',
    description:
      'Your reservation window has ended and the slot was released. Pick a session to book it again.',
    live: 'alert',
  },
  already_completed: {
    title: 'This booking is already paid',
    description: 'No further payment is needed. Your session is confirmed.',
    live: 'status',
  },
  unavailable: {
    title: 'This booking cannot be paid online',
    description: 'Online payment is not available for this booking right now.',
    live: 'alert',
  },
  not_enabled: {
    title: 'Online payment is not enabled',
    description:
      'Razorpay checkout is currently disabled for this platform. Please use the manual UPI option instead.',
    live: 'region',
  },
  config_error: {
    title: 'Payment configuration problem',
    description: 'We could not load the payment configuration. Please try again shortly.',
    live: 'alert',
  },
};

const RazorpayCheckoutCard: React.FC<RazorpayCheckoutCardProps> = ({
  booking,
  userName,
  userEmail,
  onPaymentVerified,
  onUnavailable,
}) => {
  const [uiState, setUiState] = useState<RazorpayUiState>('idle');
  const [orderData, setOrderData] = useState<RazorpayOrderData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const razorpayRef = useRef<{ open: () => void; close: () => void } | null>(null);
  const isProcessingRef = useRef(false);
  const modalOpenRef = useRef(false);
  const orderIdRef = useRef<string | null>(null);

  // Clean up the Razorpay instance on unmount or when order changes
  useEffect(() => {
    return () => {
      if (razorpayRef.current) {
        try {
          razorpayRef.current.close();
        } catch {
          // Ignore cleanup errors
        }
        razorpayRef.current = null;
      }
    };
  }, [orderData]);

  const resetToIdle = useCallback(() => {
    setUiState('idle');
    setOrderData(null);
    setErrorMessage(null);
    orderIdRef.current = null;
    razorpayRef.current = null;
    modalOpenRef.current = false;
  }, []);

  const handleDismiss = useCallback(() => {
    modalOpenRef.current = false;
    // If the modal was dismissed without payment, go back to idle
    // so the user can retry (the order is still valid for the hold window)
    if (uiState === 'processing') {
      setUiState('idle');
    }
  }, [uiState]);

  const handlePayClick = useCallback(async () => {
    if (isProcessingRef.current) return;
    if (isProcessingState(uiState)) return;

    isProcessingRef.current = true;
    setIsProcessing(true);
    setErrorMessage(null);

    try {
      setUiState('creating_order');

      const orderResult = await createRazorpayOrder(booking.id);

      if (!orderResult.success) {
        const mappedState = mapRazorpayErrorCode(orderResult.code);
        setUiState(mappedState);
        setErrorMessage(toUserMessage(orderResult.message, 'We could not start the payment. Please try again.'));
        isProcessingRef.current = false;
        setIsProcessing(false);
        return;
      }

      setOrderData(orderResult.data);
      orderIdRef.current = orderResult.data.razorpayOrderId;

      // Load the Razorpay script and open checkout
      setUiState('opening_checkout');

      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded) {
        setUiState('failed');
        setErrorMessage('Could not load the payment gateway. Please check your connection and try again.');
        isProcessingRef.current = false;
        setIsProcessing(false);
        return;
      }

      setUiState('processing');
      modalOpenRef.current = true;

      // Create and open the Razorpay checkout instance
      const checkoutOptions = buildRazorpayCheckoutOptions({
        keyId: orderResult.data.razorpayKeyId,
        orderId: orderResult.data.razorpayOrderId,
        amountInr: orderResult.data.amountInr,
        currency: orderResult.data.currency,
        bookingCode: booking.booking_code,
        prefillName: userName,
        prefillEmail: userEmail,
        handler: async (response: RazorpayCheckoutResponse) => {
          modalOpenRef.current = false;

          if (isProcessingRef.current) return;
          isProcessingRef.current = true;
          setIsProcessing(true);

          setUiState('verifying');

          try {
            const verifyResult = await verifyRazorpayPayment(booking.id, {
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            });

            if (!verifyResult.success) {
              const mappedState = mapRazorpayErrorCode(verifyResult.code);
              setUiState(mappedState);
              setErrorMessage(toUserMessage(verifyResult.message, 'We could not verify this payment. Please try again.'));
            } else {
              setUiState('success');
              // Give the success toast a moment to show, then notify parent
              setTimeout(() => {
                onPaymentVerified();
              }, 500);
            }
          } catch (err) {
            setUiState('failed');
            setErrorMessage(toUserMessage(err, 'We could not verify this payment. Please try again.'));
          } finally {
            isProcessingRef.current = false;
            setIsProcessing(false);
          }
        },
        onDismiss: handleDismiss,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const RazorpayConstructor = (window as any).Razorpay;
      if (typeof RazorpayConstructor !== 'function') {
        throw new Error('Razorpay constructor not available');
      }

      const rzpInstance = new RazorpayConstructor(checkoutOptions);
      razorpayRef.current = rzpInstance;
      rzpInstance.open();

    } catch (err) {
      modalOpenRef.current = false;
      setUiState('failed');
      setErrorMessage(toUserMessage(err, 'We could not start the payment. Please try again.'));
    } finally {
      isProcessingRef.current = false;
      setIsProcessing(false);
    }
  }, [booking.id, booking.booking_code, userName, userEmail, uiState, handleDismiss, onPaymentVerified]);

  const handleRetry = useCallback(() => {
    resetToIdle();
    // Immediately start a new payment attempt
    handlePayClick();
  }, [resetToIdle, handlePayClick]);

  const copy = STATE_COPY[uiState] ?? STATE_COPY.idle;
  const amount = formatInr(booking.amount_inr ?? booking.gig?.price_inr) || '—';
  const isBusy = isProcessingState(uiState) && uiState !== 'verifying';
  const statusTone = isBusy
    ? ('info' as const)
    : uiState === 'success' || uiState === 'already_completed'
      ? ('success' as const)
      : isTerminalState(uiState) && (uiState === 'failed' || uiState === 'expired' || uiState === 'config_error' || uiState === 'unavailable')
        ? ('danger' as const)
        : ('neutral' as const);

  /* ------------------------------------------------------------------ */
  /* Idle — the amount and the single primary action                     */
  /* ------------------------------------------------------------------ */
  const renderIdle = () => (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] px-4 py-3.5">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] text-[var(--color-shell-accent)]"
          >
            <CreditCard className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-[var(--color-shell-text)]">Online payment</p>
            <p className="text-[11.5px] text-[var(--color-shell-text-muted)]">
              UPI, cards, netbanking or wallets
            </p>
          </div>
        </div>
        <span className="text-xl font-bold tabular-nums text-[var(--color-shell-text)]">{amount}</span>
      </div>

      <InlineNotice tone="neutral" icon={Lock} title="Nothing is stored here">
        Razorpay handles your payment details in its own checkout. No card data ever reaches our
        servers, and your session is confirmed as soon as the gateway confirms the payment.
      </InlineNotice>

      <Button
        disabled={isProcessing}
        isLoading={isProcessing && uiState === 'creating_order'}
        loadingText="Creating order..."
        onClick={handlePayClick}
        className="w-full gap-2 font-semibold shadow-xs"
        size="lg"
      >
        {!isProcessing && <CreditCard className="h-4 w-4" aria-hidden="true" />}
        <span>Pay {amount} with Razorpay</span>
      </Button>
    </div>
  );

  /* ------------------------------------------------------------------ */
  /* In flight — creating order, opening checkout, awaiting payment      */
  /* ------------------------------------------------------------------ */
  const renderBusy = () => (
    <StatePanel
      tone="info"
      busy
      live="polite"
      icon={uiState === 'processing' ? CreditCard : Loader2}
      title={copy.title}
      description={copy.description}
    >
      {uiState === 'processing' && (
        <div className="mt-5 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => razorpayRef.current?.open()}
            disabled={!modalOpenRef.current}
            className="gap-2"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Reopen checkout</span>
          </Button>
        </div>
      )}
    </StatePanel>
  );

  const renderVerifying = () => (
    <StatePanel
      tone="info"
      busy
      live="polite"
      icon={Loader2}
      title={STATE_COPY.verifying.title}
      description={STATE_COPY.verifying.description}
    />
  );

  const renderSuccess = () => (
    <StatePanel
      tone="success"
      live="polite"
      icon={CheckCircle2}
      title={copy.title}
      description={copy.description}
      facts={[
        { label: 'Booking', value: booking.booking_code },
        { label: 'Amount', value: amount },
      ]}
    />
  );

  const renderFailed = () => (
    <StatePanel
      tone="danger"
      live="assertive"
      icon={AlertCircle}
      title={copy.title}
      description={errorMessage || copy.description}
      actions={
        isRetryableState(uiState) ? (
          <Button onClick={handleRetry} className="w-full gap-2 sm:w-auto">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            <span>Retry payment</span>
          </Button>
        ) : undefined
      }
    />
  );

  const renderExpired = () => (
    <StatePanel
      tone="danger"
      live="assertive"
      icon={AlertCircle}
      title={copy.title}
      description={copy.description}
      actions={
        onUnavailable ? (
          <Button onClick={onUnavailable} className="w-full gap-2 sm:w-auto">
            <Zap className="h-4 w-4" aria-hidden="true" />
            <span>Find another session</span>
          </Button>
        ) : undefined
      }
    />
  );

  const renderTerminalNotice = (
    tone: 'success' | 'warning' | 'danger',
    icon: typeof CheckCircle2,
  ) => (
    <StatePanel
      tone={tone}
      live={tone === 'success' ? 'polite' : 'assertive'}
      icon={icon}
      title={copy.title}
      description={errorMessage || copy.description}
      actions={
        tone === 'warning' && onUnavailable ? (
          <Button onClick={onUnavailable} variant="outline" className="w-full sm:w-auto">
            Back to my bookings
          </Button>
        ) : undefined
      }
    />
  );

  // Main render
  let content: React.ReactNode;

  switch (uiState) {
    case 'idle':
      content = renderIdle();
      break;
    case 'loading_config':
      content = renderBusy();
      break;
    case 'creating_order':
    case 'opening_checkout':
    case 'processing':
      content = renderBusy();
      break;
    case 'verifying':
      content = renderVerifying();
      break;
    case 'success':
      content = renderSuccess();
      break;
    case 'failed':
      content = renderFailed();
      break;
    case 'expired':
      content = renderExpired();
      break;
    case 'already_completed':
      content = renderTerminalNotice('success', CheckCircle2);
      break;
    case 'unavailable':
      content = renderTerminalNotice('danger', AlertCircle);
      break;
    case 'not_enabled':
      content = renderTerminalNotice('warning', HelpCircle);
      break;
    case 'config_error':
      content = renderTerminalNotice('danger', AlertCircle);
      break;
    default:
      content = renderIdle();
  }

  return (
    <SectionCard
      title="Online payment"
      description="Pay by UPI, card, netbanking or wallet through Razorpay checkout."
      icon={ShieldCheck}
      aside={
        <StatusPill
          tone={statusTone}
          label={isBusy ? 'In progress' : 'Razorpay'}
          dot={isBusy}
          pulse={isBusy}
        />
      }
    >
      <div className="space-y-5">
        {content}

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-[var(--color-shell-border)] pt-3.5 text-[12px] text-[var(--color-shell-text-subtle)]">
          <span>Session total</span>
          <span className="font-semibold tabular-nums text-[var(--color-shell-text)]">{amount}</span>
        </div>
      </div>
    </SectionCard>
  );
};

RazorpayCheckoutCard.displayName = 'RazorpayCheckoutCard';

export default RazorpayCheckoutCard;
