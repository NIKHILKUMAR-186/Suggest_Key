import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateMeetingLinkDeadline,
  confirmSessionByMentor,
  getOverdueBookings,
  validateMeetingUrl,
  validateSessionAccess,
  type BookingEngineContext,
} from '@/src/lib/bookingEngine';
import {
  isInsideSessionAccessWindow,
  redactMeetingUrlForParticipant,
  SESSION_ACCESS_WINDOW_MS,
} from '@/src/lib/sessionAccess';
import { buildDashboardExceptions } from '@/src/lib/adminDashboard';
import { APP_CONFIG, MEETING_LINK_DEADLINE_MINUTES } from '@/src/config/app';
import type { Booking } from '@/src/types/database';

// ---------------------------------------------------------------------------
// Meeting-link submission deadline: T-5m, not T-2h.
//
// Two rules that must not be confused:
//   * submission deadline  - when the mentor may still provide a link (T-5m)
//   * seeker visibility    - when the seeker can read the link (T-5m)
// They happen to share a boundary, but they are enforced by different code.
// Nothing here cancels a booking for a missed deadline.
// ---------------------------------------------------------------------------

const SEEKER_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const MENTOR_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
const T0 = new Date('2026-10-01T14:00:00.000Z');
const MINUTE = 60 * 1000;

/** T-relative instant, negative meaning "before the session". */
const at = (ms: number): Date => new Date(T0.getTime() + ms);

const booking = (overrides: Partial<Booking> = {}): Booking =>
  ({
    id: 'bk-1',
    booking_code: 'BK-1',
    mentor_id: MENTOR_ID,
    seeker_id: SEEKER_ID,
    gig_id: 'gig-1',
    segment_id: 'seg-1',
    hold_id: null,
    start_time: T0.toISOString(),
    end_time: at(60 * MINUTE).toISOString(),
    seeker_timezone: 'Asia/Kolkata',
    mentor_timezone: 'Asia/Kolkata',
    amount_inr: 999,
    status: 'MENTOR_PENDING',
    meeting_url: null,
    actual_ended_at: null,
    ended_by_role: null,
    end_reason: null,
    cancellation_reason: null,
    created_at: at(-24 * 60 * MINUTE).toISOString(),
    updated_at: at(-24 * 60 * MINUTE).toISOString(),
    ...overrides,
  }) as Booking;

const context = (b: Booking): BookingEngineContext =>
  ({
    profiles: [],
    userRoles: [],
    mentorProfiles: [],
    segments: [],
    mentorSegments: [],
    gigs: [],
    mentorAvailability: [],
    mentorAvailabilityExceptions: [],
    bookings: [b],
    slotHolds: [],
    payments: [],
    notifications: [],
  }) as unknown as BookingEngineContext;

describe('Meeting-link deadline rule', () => {
  it('is exactly 5 minutes, not 2 hours', () => {
    assert.equal(APP_CONFIG.MEETING_LINK_DEADLINE_MS, 5 * MINUTE);
    assert.equal(MEETING_LINK_DEADLINE_MINUTES, 5);
    assert.notEqual(APP_CONFIG.MEETING_LINK_DEADLINE_MS, 2 * 60 * MINUTE);
  });

  it('resolves to scheduledStart - 5 minutes', () => {
    const info = calculateMeetingLinkDeadline(T0.toISOString(), at(-60 * MINUTE));
    assert.equal(info.deadlineUtc, at(-5 * MINUTE).toISOString());
  });

  // A: at T-6m the mentor can still submit.
  it('A. leaves the mentor one minute of margin before the boundary', () => {
    const now = at(-6 * MINUTE);
    assert.equal(calculateMeetingLinkDeadline(T0.toISOString(), now).isOverdue, false);
  });

  it('A. accepts a valid HTTPS link at T-6m', async () => {
    const result = await confirmSessionByMentor(
      { bookingId: 'bk-1', mentorId: MENTOR_ID, meetingUrl: 'https://meet.google.com/t-6m', currentUtcTime: at(-6 * MINUTE) },
      context(booking()),
    );
    assert.equal(result.success, true);
    assert.equal(result.booking?.meeting_url, 'https://meet.google.com/t-6m');
    assert.equal(result.isOverdue, false);
  });

  // B: the T-5m boundary is followed consistently.
  it('B. flips to overdue immediately after the boundary', () => {
    // `isOverdue` is a strict `now > deadline`, so the boundary instant itself
    // is still on time and the flag appears one millisecond later.
    assert.equal(
      calculateMeetingLinkDeadline(T0.toISOString(), at(-5 * MINUTE)).isOverdue,
      false,
      'at exactly T-5m the mentor is still inside the window',
    );
    assert.equal(
      calculateMeetingLinkDeadline(T0.toISOString(), at(-5 * MINUTE + 1)).isOverdue,
      true,
      'one millisecond past T-5m the deadline has arrived',
    );
  });

  it('B. agrees with the configured constant to the millisecond', () => {
    const info = calculateMeetingLinkDeadline(T0.toISOString(), at(-60 * MINUTE));
    assert.equal(
      Date.parse(info.deadlineUtc),
      T0.getTime() - APP_CONFIG.MEETING_LINK_DEADLINE_MS,
    );
  });

  // C: the old 2-hour rule must not block the mentor.
  it('C. does not treat a session two hours out as overdue', () => {
    const now = at(-2 * 60 * MINUTE);
    const info = calculateMeetingLinkDeadline(T0.toISOString(), now);
    assert.equal(info.isOverdue, false);
    assert.equal(info.hoursUntilSession, 2);
  });

  it('C. accepts a valid HTTPS link at T-4m, where only the 5-minute rule applies', async () => {
    const result = await confirmSessionByMentor(
      { bookingId: 'bk-1', mentorId: MENTOR_ID, meetingUrl: 'https://meet.google.com/t-4m', currentUtcTime: at(-4 * MINUTE) },
      context(booking()),
    );
    assert.equal(result.success, true, 'the old 2-hour rule must not block a late submission');
    assert.equal(result.booking?.status, 'CONFIRMED');
    assert.equal(result.isOverdue, true, 'but it is recorded as overdue for audit');
  });

  it('C. never auto-cancels a booking for a missed deadline', async () => {
    const result = await confirmSessionByMentor(
      { bookingId: 'bk-1', mentorId: MENTOR_ID, meetingUrl: 'https://meet.google.com/late', currentUtcTime: at(-2 * MINUTE) },
      context(booking()),
    );
    assert.equal(result.booking?.status, 'CONFIRMED');
    assert.equal(result.booking?.cancellation_reason, null);
  });

  // D/E: seeker visibility is a separate gate at the same boundary.
  it('D. withholds the link from the seeker before T-5m', () => {
    for (const offset of [-60 * MINUTE, -6 * MINUTE, -5 * MINUTE - 1]) {
      const result = validateSessionAccess(
        { bookingId: 'bk-1', userId: SEEKER_ID, currentUtcTime: at(offset) },
        context(booking({ status: 'CONFIRMED', meeting_url: 'https://meet.google.com/secret' })),
      );
      assert.equal(result.canJoin, false, `T${offset / MINUTE}m should be denied`);
      assert.equal(result.accessState, 'BEFORE_T5');
      assert.equal(result.meetingUrl, null, `T${offset / MINUTE}m must not release the link`);
    }
  });

  it('E. releases the link to the seeker from T-5m', () => {
    assert.equal(SESSION_ACCESS_WINDOW_MS, 5 * MINUTE);
    const result = validateSessionAccess(
      { bookingId: 'bk-1', userId: SEEKER_ID, currentUtcTime: at(-5 * MINUTE) },
      context(booking({ status: 'CONFIRMED', meeting_url: 'https://meet.google.com/secret' })),
    );
    assert.equal(result.canJoin, true);
    assert.equal(result.accessState, 'T5_WINDOW');
    assert.equal(result.meetingUrl, 'https://meet.google.com/secret');
  });

  it('D. redacts the link from a seeker projection before T-5m', () => {
    const b = booking({ status: 'CONFIRMED', meeting_url: 'https://meet.google.com/secret' });
    assert.equal(
      redactMeetingUrlForParticipant(b, { isAdmin: false, isMentor: false, now: at(-6 * MINUTE) })
        .meeting_url,
      null,
    );
    assert.equal(
      redactMeetingUrlForParticipant(b, { isAdmin: false, isMentor: false, now: at(-5 * MINUTE) })
        .meeting_url,
      'https://meet.google.com/secret',
    );
  });

  it('D. the access window predicate matches the submission deadline boundary', () => {
    const b = booking();
    assert.equal(isInsideSessionAccessWindow(b, at(-5 * MINUTE - 1)), false);
    assert.equal(isInsideSessionAccessWindow(b, at(-5 * MINUTE)), true);
  });

  // F: a missing link inside the window produces the existing overdue state.
  it('F. flags a missing link at T-4m as overdue, and stops once confirmed', async () => {
    const now = at(-4 * MINUTE);
    const db = context(booking());
    assert.deepEqual(getOverdueBookings(db, now).map((b) => b.id), ['bk-1']);

    // Supplying the link and confirming is what clears the overdue state; the
    // booking is never cancelled for missing the deadline.
    const result = await confirmSessionByMentor(
      { bookingId: 'bk-1', mentorId: MENTOR_ID, meetingUrl: 'https://meet.google.com/fixed', currentUtcTime: now },
      db,
    );
    assert.equal(result.success, true);
    assert.deepEqual(getOverdueBookings(db, now), []);
  });

  it('F. surfaces the same overdue state in the admin exception centre', () => {
    const exceptions = buildDashboardExceptions([booking()], [], at(-4 * MINUTE));
    assert.equal(exceptions[0].kind, 'MEETING_LINK_OVERDUE');
    assert.equal(exceptions[0].severity, 'critical');
    assert.match(exceptions[0].detail, /NOT auto-cancelled/);
  });

  it('F. does not raise an overdue exception before the boundary', () => {
    const exceptions = buildDashboardExceptions([booking()], [], at(-6 * MINUTE));
    assert.equal(exceptions[0].kind, 'MEETING_LINK_DUE_SOON');
    assert.equal(exceptions[0].severity, 'warning');
  });

  // HTTPS-only validation is unchanged by the deadline change.
  it('still rejects a non-HTTPS link at T-4m', async () => {
    const result = await confirmSessionByMentor(
      { bookingId: 'bk-1', mentorId: MENTOR_ID, meetingUrl: 'http://meet.google.com/t-4m', currentUtcTime: at(-4 * MINUTE) },
      context(booking()),
    );
    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'INVALID_MEETING_URL');
    assert.equal(validateMeetingUrl('https://meet.google.com/ok').isValid, true);
    assert.equal(validateMeetingUrl('http://meet.google.com/nope').isValid, false);
  });

  it('leaves the payment hold and booking cutoff untouched', () => {
    assert.equal(APP_CONFIG.HOLD_DURATION_MS, 5 * MINUTE);
    assert.equal(APP_CONFIG.BOOKING_CUTOFF_MS, 5 * MINUTE);
  });
});
