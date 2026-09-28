import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  BOOKING_LIFECYCLE,
  BOOKING_STATUS_COPY,
  PAYMENT_STATUS_COPY,
  SESSION_STATE_COPY,
  bookingLifecyclePosition,
  describeBookingStatus,
  describeChangeWindow,
  describePaymentStatus,
  describeSessionState,
  isClosedBookingStatus,
} from '../src/components/booking/statusTone';
import type { BookingStatus } from '../src/types/database';
import type { SessionLifecycleState } from '../src/lib/sessionState';

/**
 * The transactional status vocabulary.
 *
 * This module is the single place that decides what a booking, payment or
 * session status is *called* and how it is *tinted*. It replaced four separate
 * switch statements across the payment page, the booking list, the booking
 * detail page and the session page, which had already drifted: the same
 * `MENTOR_PENDING` read "Waiting for Mentor" on the list and "Awaiting mentor"
 * on the detail page, and `PENDING_VERIFICATION` was a neutral "Verification
 * Pending" chip beside a `REJECTED` payment that was styled with a raw
 * `bg-rose-50` palette.
 *
 * Two properties are worth pinning down, and neither is obvious from reading
 * the table:
 *
 *   1. An unrecognised status must be shown, not smoothed over. A status added
 *      server-side and not yet known here has to be visible to the seeker with
 *      its raw value, because silently rendering it as "Confirmed" would state
 *      something untrue about a payment.
 *   2. The lifecycle position is what the progress stepper renders from, so a
 *      status with no known position must report none rather than defaulting to
 *      the first step.
 */

const ALL_BOOKING_STATUSES: BookingStatus[] = [
  'PAYMENT_PENDING',
  'PENDING_VERIFICATION',
  'MENTOR_PENDING',
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
];

const ALL_TONES = ['success', 'warning', 'danger', 'info', 'neutral'] as const;

describe('status vocabulary: every declared status has a real label and tint', () => {
  it('describes every BookingStatus the type can hold', () => {
    // The table is `Record<BookingStatus, ...>`, so this is structurally
    // guaranteed to compile. The test is here so that a status added to the
    // union but given a placeholder descriptor fails loudly rather than
    // shipping a chip that says "undefined".
    for (const status of ALL_BOOKING_STATUSES) {
      const descriptor = describeBookingStatus(status);

      assert.ok(descriptor.label.length > 0, `${status} has no label`);
      assert.ok(
        ALL_TONES.includes(descriptor.tone),
        `${status} has tone ${descriptor.tone}, which has no token mapping`
      );
      // A raw database constant is never shown to a user verbatim.
      assert.ok(!descriptor.label.includes('_'), `${status} renders as ${descriptor.label}`);
    }
  });

  it('gives the same answer to a caller and to the table it reads', () => {
    for (const status of ALL_BOOKING_STATUSES) {
      assert.deepEqual(describeBookingStatus(status), BOOKING_STATUS_COPY[status]);
    }
  });

  it('separates the three states a seeker most needs to tell apart', () => {
    // These three sit next to each other in the list and are the ones whose
    // labels previously disagreed between screens. A confirmed booking is a
    // green "Confirmed" everywhere; a payment awaiting an admin decision must
    // not read as either confirmed or failed.
    const confirmed = describeBookingStatus('CONFIRMED');
    const underReview = describeBookingStatus('PENDING_VERIFICATION');
    const awaitingMentor = describeBookingStatus('MENTOR_PENDING');

    assert.equal(confirmed.label, 'Confirmed');
    assert.equal(confirmed.tone, 'success');
    assert.equal(underReview.tone, 'info');
    assert.equal(awaitingMentor.tone, 'info');
    assert.notEqual(underReview.label, confirmed.label);
    assert.notEqual(awaitingMentor.label, confirmed.label);
  });

  it('treats a rejected booking as a failure and a cancelled one as closed', () => {
    // These are not the same thing: one is a problem to resolve, the other a
    // decision already taken, so they must not share a tint.
    assert.equal(describeBookingStatus('REJECTED').tone, 'danger');
    assert.equal(describeBookingStatus('CANCELLED').tone, 'neutral');

    assert.equal(isClosedBookingStatus('CANCELLED'), true);
    assert.equal(isClosedBookingStatus('REJECTED'), true);
    for (const status of ALL_BOOKING_STATUSES) {
      if (status !== 'CANCELLED' && status !== 'REJECTED') {
        assert.equal(isClosedBookingStatus(status), false, `${status} must not read as closed`);
      }
    }
  });
});

describe('status vocabulary: an unknown status is shown, never smoothed over', () => {
  it('falls back to the raw value with a neutral tint', () => {
    // This is the load-bearing case. A status the server adds before this table
    // is updated must reach the seeker as itself. Rendering it as "Confirmed"
    // would be a lie about a booking, and rendering it as an empty chip would
    // hide a payment state entirely.
    const unknown = describeBookingStatus('MENTOR_RESCHEDULED');

    assert.equal(unknown.label, 'MENTOR_RESCHEDULED');
    assert.equal(unknown.tone, 'neutral');
  });

  it('does not crash on an empty or absent status', () => {
    // A join that did not resolve should read as unknown, not throw during
    // render and blank the whole page.
    for (const value of ['', null, undefined] as Array<string | null | undefined>) {
      const descriptor = describeBookingStatus(value as string);
      assert.equal(descriptor.label, 'Unknown');
      assert.equal(descriptor.tone, 'neutral');
    }
  });

  it('reports no lifecycle position for a status it does not know', () => {
    // The stepper uses this as an index. Defaulting an unknown status to 0 or 1
    // would draw a progress bar claiming a stage the booking has not reached.
    assert.equal(bookingLifecyclePosition('CONFIRMED'), 4);
    assert.equal(bookingLifecyclePosition('MENTOR_RESCHEDULED'), 0);
  });

  it('places every lifecycle status at a strictly increasing position', () => {
    const positions = BOOKING_LIFECYCLE.map(bookingLifecyclePosition);
    assert.deepEqual(positions, [1, 2, 3, 4, 5]);

    for (let i = 1; i < positions.length; i += 1) {
      assert.ok(positions[i] > positions[i - 1], 'lifecycle order must be monotonic');
    }
  });

  it('gives a closed status no position in the progress flow', () => {
    // A cancelled or rejected booking is not "further along" than a confirmed
    // one; it left the flow.
    assert.equal(bookingLifecyclePosition('CANCELLED'), 0);
    assert.equal(bookingLifecyclePosition('REJECTED'), 0);
  });
});

describe('status vocabulary: payment states describe an in-flight gateway honestly', () => {
  it('describes every PaymentStatus the type can hold', () => {
    const statuses = [
      'PENDING_VERIFICATION',
      'VERIFIED',
      'REJECTED',
      'PAYMENT_PENDING',
      'PAYMENT_PROCESSING',
      'FAILED',
      'REFUNDED',
      'REFUND_FAILED',
    ] as const;

    for (const status of statuses) {
      const descriptor = describePaymentStatus(status);
      assert.ok(descriptor.label.length > 0, `${status} has no label`);
      assert.ok(ALL_TONES.includes(descriptor.tone), `${status} has an unmapped tone`);
      assert.deepEqual(descriptor, PAYMENT_STATUS_COPY[status]);
    }
  });

  it('never claims a payment is verified before the gateway says so', () => {
    // The three gateway states a seeker sees mid-attempt must be distinguishable
    // from a real decision, and must not borrow its language.
    assert.notEqual(describePaymentStatus('PAYMENT_PROCESSING').tone, 'success');
    assert.notEqual(describePaymentStatus('PAYMENT_PENDING').tone, 'success');
    assert.notEqual(describePaymentStatus('FAILED').tone, 'success');

    assert.equal(describePaymentStatus('VERIFIED').tone, 'success');
    assert.equal(describePaymentStatus('FAILED').tone, 'danger');
  });

  it('tells a seeker a failed payment was not charged', () => {
    // The single most consequential fact on a failure screen. If this copy is
    // removed the seeker cannot tell "declined" from "money gone".
    assert.match(describePaymentStatus('FAILED').hint ?? '', /nothing was charged/i);
  });

  it('shows an unknown payment status as itself', () => {
    assert.equal(describePaymentStatus('CHARGEBACK_PENDING').label, 'CHARGEBACK_PENDING');
  });
});

describe('status vocabulary: session states are distinct from booking states', () => {
  it('describes every SessionLifecycleState', () => {
    const states: SessionLifecycleState[] = [
      'SCHEDULED',
      'ACCESS_OPEN',
      'IN_PROGRESS',
      'COMPLETED',
      'CANCELLED',
    ];

    for (const state of states) {
      const descriptor = describeSessionState(state);
      assert.ok(descriptor.label.length > 0, `${state} has no label`);
      assert.ok(ALL_TONES.includes(descriptor.tone), `${state} has an unmapped tone`);
      assert.deepEqual(descriptor, SESSION_STATE_COPY[state]);
    }
  });

  it('marks only the running session as live', () => {
    assert.equal(describeSessionState('IN_PROGRESS').tone, 'success');
    // "Access open" is a warning, not a success: the session has not started,
    // and painting it green would claim the meeting is under way.
    assert.equal(describeSessionState('ACCESS_OPEN').tone, 'warning');
    assert.equal(describeSessionState('SCHEDULED').tone, 'warning');
  });
});

describe('the cancellation window, explained without ever deciding it', () => {
  const base = {
    allowsChange: true,
    windowMinutes: 10,
    waitingOn: 'none' as const,
  };

  it('reports an open window before the cutoff', () => {
    const state = describeChangeWindow({ ...base, minutesUntilStart: 120 });

    assert.equal(state.tone, 'open');
    assert.equal(state.canChange, true);
    assert.match(state.body, /10 minutes before/);
  });

  it('opens the window at exactly the cutoff minute, not before it', () => {
    // The server gate is `minutesUntilStart < windowMinutes`, so exactly 10
    // minutes must still be allowed. A client that closed at 10 would hide a
    // button the server accepts.
    assert.equal(describeChangeWindow({ ...base, minutesUntilStart: 10 }).tone, 'open');
    assert.equal(describeChangeWindow({ ...base, minutesUntilStart: 9 }).tone, 'closed');
  });

  it('pluralises the remaining time correctly', () => {
    assert.match(describeChangeWindow({ ...base, minutesUntilStart: 1 }).body, /in 1 minute\./);
    assert.match(describeChangeWindow({ ...base, minutesUntilStart: 3 }).body, /in 3 minutes\./);
  });

  it('never offers a change once the booking has reached a final state', () => {
    // `canChange` here is presentation only, but a seeker must never be told
    // they can cancel a cancelled booking.
    const state = describeChangeWindow({
      ...base,
      allowsChange: false,
      minutesUntilStart: 600,
      waitingOn: 'mentor',
    });

    assert.equal(state.canChange, false);
    assert.equal(state.tone, 'unavailable');
  });

  it('explains a payment-blocked cancellation differently from a finished one', () => {
    // "Complete payment first" is actionable; "this booking reached a final
    // state" is not. Collapsing them tells a seeker to wait for something that
    // will never happen.
    const waitingOnPayment = describeChangeWindow({
      ...base,
      allowsChange: false,
      minutesUntilStart: 600,
      waitingOn: 'payment',
    });
    const finished = describeChangeWindow({
      ...base,
      allowsChange: false,
      minutesUntilStart: 600,
      waitingOn: 'none',
    });

    assert.match(waitingOnPayment.body, /complete payment/i);
    assert.match(finished.body, /final state/i);
  });

  it('distinguishes a confirmed booking from an unfinished one when changes close', () => {
    // Both are closed, but a confirmed booking has a meeting link and a support
    // path, which is a different message from "not available yet".
    const confirmed = describeChangeWindow({
      ...base,
      allowsChange: false,
      minutesUntilStart: 600,
      waitingOn: 'none',
      closedBecauseConfirmed: true,
    });

    assert.equal(confirmed.canChange, false);
    assert.match(confirmed.body, /contact platform administration/i);
  });
});
