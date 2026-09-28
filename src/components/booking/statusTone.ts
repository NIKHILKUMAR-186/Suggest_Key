/**
 * Transactional status vocabulary (presentation only).
 *
 * A single source of truth for how a status is *labelled* and *tinted* across
 * the booking, payment and session surfaces. Before this existed each page kept
 * its own switch statement, which is how the same `CONFIRMED` state ended up
 * green on one screen and neutral on the next.
 *
 * Every value here maps onto a real record the backend already returned. No
 * state is inferred, invented or optimised away: a status with no label renders
 * as the raw database value rather than as a friendly fiction.
 */

import type { BookingStatus, Payment } from '@/src/types/database';
import type { SessionLifecycleState } from '@/src/lib/sessionState';

/**
 * The five tints the design system can guarantee contrast for in both themes.
 * Anything more specific than this belongs in a token, not a Tailwind palette.
 */
export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface StatusDescriptor {
  label: string;
  tone: StatusTone;
  /**
   * Optional secondary line explaining what the seeker is expected to do next.
   * Only set where a real, actionable next step exists.
   */
  hint?: string;
}

/* -------------------------------------------------------------------------- */
/* Booking status                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The booking lifecycle, in the order a session actually moves through it.
 * The index of a status in this list is what the progress stepper renders, so
 * a status that is not listed (a new one added server-side) degrades to a
 * "no position known" render rather than to a wrong position.
 */
export const BOOKING_LIFECYCLE: BookingStatus[] = [
  'PAYMENT_PENDING',
  'PENDING_VERIFICATION',
  'MENTOR_PENDING',
  'CONFIRMED',
  'COMPLETED',
];

export const BOOKING_STATUS_COPY: Record<BookingStatus, StatusDescriptor> = {
  PAYMENT_PENDING: {
    label: 'Payment required',
    tone: 'warning',
    hint: 'This time is held for you until payment is completed.',
  },
  PENDING_VERIFICATION: {
    label: 'Payment under review',
    tone: 'info',
    hint: 'Your payment proof was received and is being checked.',
  },
  MENTOR_PENDING: {
    label: 'Awaiting mentor',
    tone: 'info',
    hint: 'Payment accepted. The mentor has been asked to confirm.',
  },
  CONFIRMED: {
    label: 'Confirmed',
    tone: 'success',
    hint: 'The session is booked. Meeting access opens 5 minutes before it starts.',
  },
  COMPLETED: {
    label: 'Completed',
    tone: 'neutral',
    hint: 'This session has finished. Notes are available in the session workspace.',
  },
  CANCELLED: {
    label: 'Cancelled',
    tone: 'neutral',
  },
  REJECTED: {
    label: 'Rejected',
    tone: 'danger',
  },
};

/** A closed (cancelled/rejected) booking is a terminal state, not a failure to fix. */
export function isClosedBookingStatus(status: BookingStatus): boolean {
  return status === 'CANCELLED' || status === 'REJECTED';
}

/**
 * Describes a booking status. An unknown status falls through to the raw
 * database value with a neutral tone: a new server-side status must be visible,
 * not silently rendered as "Confirmed".
 */
export function describeBookingStatus(status: BookingStatus | string): StatusDescriptor {
  const known = BOOKING_STATUS_COPY[status as BookingStatus];
  if (known) return known;
  return { label: String(status || 'Unknown'), tone: 'neutral' };
}

/**
 * 1-based position in the lifecycle, or 0 when the status has no position.
 *
 * Accepts any string, not just a `BookingStatus`, because the 0 case is the
 * point: a status the server adds before this list is updated must report "no
 * known position" rather than defaulting to a step the booking has not reached.
 */
export function bookingLifecyclePosition(status: BookingStatus | string): number {
  const idx = (BOOKING_LIFECYCLE as string[]).indexOf(status);
  return idx === -1 ? 0 : idx + 1;
}

/* -------------------------------------------------------------------------- */
/* Payment status                                                              */
/* -------------------------------------------------------------------------- */

type PaymentStatus = Payment['status'];

export const PAYMENT_STATUS_COPY: Record<PaymentStatus, StatusDescriptor> = {
  PENDING_VERIFICATION: {
    label: 'Under review',
    tone: 'info',
    hint: 'Your reference and screenshot were received. An admin verifies them manually.',
  },
  VERIFIED: {
    label: 'Verified',
    tone: 'success',
    hint: 'Payment accepted. The mentor can now add the meeting link.',
  },
  REJECTED: {
    label: 'Action required',
    tone: 'danger',
    hint: 'This payment could not be verified.',
  },
  // Gateway-side states. A seeker only ever sees these while a Razorpay
  // attempt is in flight or has just failed, so the copy says exactly that
  // rather than implying a decision has been made.
  PAYMENT_PENDING: { label: 'Not started', tone: 'warning' },
  PAYMENT_PROCESSING: { label: 'Processing', tone: 'info', hint: 'The gateway is confirming this payment.' },
  FAILED: {
    label: 'Payment failed',
    tone: 'danger',
    hint: 'The payment could not be completed. Nothing was charged.',
  },
  REFUNDED: { label: 'Refunded', tone: 'neutral', hint: 'This payment has been returned to your account.' },
  REFUND_FAILED: {
    label: 'Refund pending',
    tone: 'warning',
    hint: 'A refund was requested but has not completed yet. Contact support if it does not arrive.',
  },
};

export function describePaymentStatus(status: PaymentStatus | string): StatusDescriptor {
  const known = PAYMENT_STATUS_COPY[status as PaymentStatus];
  if (known) return known;
  return { label: String(status || 'Unknown'), tone: 'neutral' };
}

/* -------------------------------------------------------------------------- */
/* Session lifecycle state                                                     */
/* -------------------------------------------------------------------------- */

export const SESSION_STATE_COPY: Record<SessionLifecycleState, StatusDescriptor> = {
  SCHEDULED: {
    label: 'Scheduled',
    tone: 'warning',
    hint: 'Meeting access opens 5 minutes before the session.',
  },
  ACCESS_OPEN: {
    label: 'Access open',
    tone: 'warning',
    hint: 'You can enter the room now and check your audio and video.',
  },
  IN_PROGRESS: {
    label: 'Live now',
    tone: 'success',
    hint: 'Your session is in progress.',
  },
  COMPLETED: {
    label: 'Completed',
    tone: 'neutral',
  },
  CANCELLED: {
    label: 'Cancelled',
    tone: 'neutral',
  },
};

export function describeSessionState(state: SessionLifecycleState): StatusDescriptor {
  return SESSION_STATE_COPY[state] ?? { label: state, tone: 'neutral' };
}

/* -------------------------------------------------------------------------- */
/* Cancellation & reschedule window                                            */
/* -------------------------------------------------------------------------- */

export type ChangeWindowTone = 'open' | 'closed' | 'unavailable';

export interface ChangeWindowState {
  tone: ChangeWindowTone;
  title: string;
  body: string;
  /** False when cancellation/rescheduling is genuinely unavailable. */
  canChange: boolean;
}

/**
 * Describes the seeker's ability to cancel or reschedule.
 *
 * The caller supplies the two facts it already knows — whether the booking is
 * in a status that permits changes, and how long until the session starts — and
 * this only turns them into an explanation. It never decides eligibility on its
 * own, so it cannot disagree with the server about what is allowed.
 */
export function describeChangeWindow(input: {
  allowsChange: boolean;
  minutesUntilStart: number;
  windowMinutes: number;
  waitingOn: 'payment' | 'verification' | 'mentor' | 'none';
  closedBecauseConfirmed?: boolean;
}): ChangeWindowState {
  const { allowsChange, minutesUntilStart, windowMinutes, waitingOn } = input;

  if (!allowsChange) {
    if (input.closedBecauseConfirmed) {
      return {
        tone: 'unavailable',
        title: 'Cancellation is no longer available',
        body: 'This session is confirmed with a meeting link. Contact platform administration if you need an exceptional change.',
        canChange: false,
      };
    }
    return {
      tone: 'unavailable',
      title: 'Cancellation is not available yet',
      body:
        waitingOn === 'payment'
          ? 'Complete payment first. You can cancel or reschedule once the booking moves forward.'
          : 'This booking has reached a final state.',
      canChange: false,
    };
  }

  if (minutesUntilStart < windowMinutes) {
    return {
      tone: 'closed',
      title: 'The change window has closed',
      body: `This session starts in ${minutesUntilStart} minute${minutesUntilStart === 1 ? '' : 's'}. Normal cancellation and rescheduling close ${windowMinutes} minutes before the start.`,
      canChange: false,
    };
  }

  return {
    tone: 'open',
    title: 'You can cancel or reschedule',
    body: `Both remain available until ${windowMinutes} minutes before the session starts.`,
    canChange: true,
  };
}
