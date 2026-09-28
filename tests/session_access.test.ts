import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  isBookingIdShape,
  isBookingCodeShape,
  isSafeBookingIdentifier,
  isInsideSessionAccessWindow,
  redactMeetingUrlForParticipant,
  SESSION_ACCESS_WINDOW_MS,
} from '@/src/lib/sessionAccess';
import {
  validateSessionAccess,
  joinSessionAuthoritative,
  type BookingEngineContext,
} from '@/src/lib/bookingEngine';
import {
  resolveSessionLifecycle,
  isAccessGranted,
  isBookingUpcoming,
  secondsUntilAccessOpens,
  secondsUntilSessionEnd,
  formatCountdown,
  sessionDurationMinutes,
} from '@/src/lib/sessionState';
import type { Booking } from '@/src/types/database';

// ---------------------------------------------------------------------------
// Regression tests for the session-access window.
//
// Finding: `GET /api/sessions/:bookingId/access` read `?currentTime=` and
// `POST /api/sessions/:bookingId/join` read `body.currentTime`, then handed that
// value to `validateSessionAccess` as the authoritative server clock. A caller
// could therefore supply any timestamp and (a) unlock the T-5 gate early,
// receiving `meetingUrl` for a session that had not started, and (b) pass a time
// before `end_time` to join a session that had already finished.
//
// The engine still accepts an explicit `currentUtcTime` because that is how it
// is unit-tested and how the server passes its own clock; what changed is that
// the HTTP layer can no longer influence it. These tests pin the window rules
// the server now relies on.
// ---------------------------------------------------------------------------

const SEEKER_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const MENTOR_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
const STRANGER_ID = 'cccccccc-3333-4333-8333-333333333333';
const ADMIN_ID = 'dddddddd-4444-4444-8444-444444444444';

const T0 = new Date('2026-10-01T12:00:00.000Z');
const at = (offsetMs: number) => new Date(T0.getTime() + offsetMs);

function booking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'eeeeeeee-5555-4555-8555-555555555555',
    booking_code: 'BK-5555',
    mentor_id: MENTOR_ID,
    seeker_id: SEEKER_ID,
    gig_id: 'ffffffff-6666-4666-8666-666666666666',
    segment_id: '00000000-0000-0000-0000-000000000002',
    hold_id: null,
    start_time: T0.toISOString(),
    end_time: at(60 * 60 * 1000).toISOString(),
    seeker_timezone: 'Asia/Kolkata',
    mentor_timezone: 'Asia/Kolkata',
    amount_inr: 999,
    status: 'CONFIRMED',
    meeting_url: 'https://meet.google.com/secret-room',
    cancellation_reason: null,
    created_at: at(-24 * 60 * 60 * 1000).toISOString(),
    updated_at: at(-24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  } as Booking;
}

function context(b: Booking, roles: Array<{ user_id: string; role: string }> = []): BookingEngineContext {
  return {
    profiles: [],
    userRoles: roles,
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
  } as unknown as BookingEngineContext;
}

describe('Session access window', () => {
  describe('T-5 gate', () => {
    it('denies the meeting link one millisecond before the window opens', () => {
      const result = validateSessionAccess(
        { bookingId: booking().id, userId: SEEKER_ID, currentUtcTime: at(-SESSION_ACCESS_WINDOW_MS - 1) },
        context(booking())
      );
      assert.equal(result.canJoin, false);
      assert.equal(result.accessState, 'BEFORE_T5');
      assert.equal(result.meetingUrl, null, 'the link must not be released before T-5');
    });

    it('releases the meeting link exactly at T-5', () => {
      const result = validateSessionAccess(
        { bookingId: booking().id, userId: SEEKER_ID, currentUtcTime: at(-SESSION_ACCESS_WINDOW_MS) },
        context(booking())
      );
      assert.equal(result.canJoin, true);
      assert.equal(result.meetingUrl, 'https://meet.google.com/secret-room');
    });

    it('keeps the link available for the mentor and the seeker during the session', () => {
      for (const userId of [SEEKER_ID, MENTOR_ID]) {
        const result = validateSessionAccess(
          { bookingId: booking().id, userId, currentUtcTime: at(10 * 60 * 1000) },
          context(booking())
        );
        assert.equal(result.canJoin, true, `${userId} should be able to join in progress`);
      }
    });

    it('denies the meeting link at and after end_time', () => {
      const b = booking();
      for (const offset of [60 * 60 * 1000, 60 * 60 * 1000 + 1]) {
        const result = validateSessionAccess(
          { bookingId: b.id, userId: SEEKER_ID, currentUtcTime: at(offset) },
          context(b)
        );
        assert.equal(result.canJoin, false, 'join must be closed once the session has ended');
        assert.equal(result.meetingUrl, null, 'the link must be hidden after the session');
        assert.equal(result.accessState, 'COMPLETED');
      }
    });
  });

  describe('joinSessionAuthoritative', () => {
    it('refuses to join before T-5', () => {
      const result = joinSessionAuthoritative(
        { bookingId: booking().id, userId: SEEKER_ID, currentUtcTime: at(-10 * 60 * 1000) },
        context(booking())
      );
      assert.equal(result.canJoin, false);
      assert.equal(result.error?.code, 'TOO_EARLY');
      assert.equal(result.meetingUrl, undefined);
    });

    it('refuses to join after the session ended', () => {
      const b = booking();
      const result = joinSessionAuthoritative(
        { bookingId: b.id, userId: SEEKER_ID, currentUtcTime: at(3 * 60 * 60 * 1000) },
        context(b)
      );
      assert.equal(result.canJoin, false);
      assert.equal(result.meetingUrl, undefined);
    });

    it('refuses a user who is neither participant nor admin', () => {
      const result = joinSessionAuthoritative(
        { bookingId: booking().id, userId: STRANGER_ID, currentUtcTime: at(10 * 60 * 1000) },
        context(booking())
      );
      assert.equal(result.canJoin, false);
      assert.equal(result.error?.code, 'FORBIDDEN_NOT_PARTICIPANT');
      assert.equal(result.meetingUrl, undefined, 'no booking detail may leak to a stranger');
    });

    it('refuses a booking that has not been confirmed yet', () => {
      for (const status of ['PAYMENT_PENDING', 'PENDING_VERIFICATION', 'MENTOR_PENDING', 'CANCELLED', 'REJECTED'] as const) {
        const b = booking({ status });
        const result = joinSessionAuthoritative(
          { bookingId: b.id, userId: SEEKER_ID, currentUtcTime: at(10 * 60 * 1000) },
          context(b)
        );
        assert.equal(result.canJoin, false, `${status} must not be joinable`);
        assert.equal(result.meetingUrl, undefined);
      }
    });
  });

  describe('projection redaction', () => {
    const far = booking({
      start_time: at(24 * 60 * 60 * 1000).toISOString(),
      end_time: at(25 * 60 * 60 * 1000).toISOString(),
    });

    it('strips meeting_url from a seeker projection outside the window', () => {
      const redacted = redactMeetingUrlForParticipant(far, { isAdmin: false, isMentor: false, now: T0 });
      assert.equal(redacted.meeting_url, null);
    });

    it('strips meeting_url from a seeker projection after the session ended', () => {
      const past = booking({
        start_time: at(-2 * 60 * 60 * 1000).toISOString(),
        end_time: at(-60 * 60 * 1000).toISOString(),
      });
      const redacted = redactMeetingUrlForParticipant(past, { isAdmin: false, isMentor: false, now: T0 });
      assert.equal(redacted.meeting_url, null);
    });

    it('keeps meeting_url for the seeker inside the window', () => {
      const soon = booking({
        start_time: at(2 * 60 * 1000).toISOString(),
        end_time: at(62 * 60 * 1000).toISOString(),
      });
      const kept = redactMeetingUrlForParticipant(soon, { isAdmin: false, isMentor: false, now: T0 });
      assert.equal(kept.meeting_url, 'https://meet.google.com/secret-room');
    });

    it('never redacts for an admin or the mentor', () => {
      assert.equal(
        redactMeetingUrlForParticipant(far, { isAdmin: true, isMentor: false, now: T0 }).meeting_url,
        'https://meet.google.com/secret-room'
      );
      assert.equal(
        redactMeetingUrlForParticipant(far, { isAdmin: false, isMentor: true, now: T0 }).meeting_url,
        'https://meet.google.com/secret-room'
      );
    });

    it('fails closed when the timestamps are unparseable', () => {
      const broken = booking({ start_time: 'not-a-date', end_time: undefined });
      assert.equal(
        redactMeetingUrlForParticipant(broken, { isAdmin: false, isMentor: false, now: T0 }).meeting_url,
        null
      );
      assert.equal(isInsideSessionAccessWindow(broken, T0), false);
    });
  });

  describe('booking identifier shape', () => {
    it('accepts a uuid and an opaque booking code', () => {
      assert.equal(isBookingIdShape('eeeeeeee-5555-4555-8555-555555555555'), true);
      assert.equal(isBookingCodeShape('BK-9021'), true);
      assert.equal(isSafeBookingIdentifier('BK-9021'), true);
    });

    it('rejects anything that could inject extra PostgREST filter clauses', () => {
      for (const hostile of [
        "x,id.neq.00000000-0000-0000-0000-000000000000",
        'id.eq.1',
        "1' OR 1=1--",
        'a) OR (1=1',
        '&select=*',
        '',
        'BK-9021;drop',
        null,
        undefined,
        42,
      ]) {
        assert.equal(
          isSafeBookingIdentifier(hostile as unknown),
          false,
          `${String(hostile)} must not reach a database filter`
        );
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Time-based test matrix (spec §27)
//
// A 60-minute session, start 10:00Z / end 11:00Z. Every row is checked twice:
// once through the server engine that authorizes joins, and once through the
// shared browser resolver that renders the page. They must agree at every
// instant, because the page may be wrong about how long the countdown says -
// never about whether the room is open.
//
// The same matrix is verified against `public.resolve_session_state(...)` in
// the database; see supabase/migrations/20260927050000_phase24_session_time_authority.sql.
// ---------------------------------------------------------------------------

/** start 10:00Z, end 11:00Z — a 60 minute session. */
const MATRIX_START = new Date('2026-10-01T10:00:00.000Z');
const MATRIX_END = new Date('2026-10-01T11:00:00.000Z');
const atClock = (hhmm: string) => new Date(`2026-10-01T${hhmm}:00.000Z`);

interface MatrixRow {
  clock: string;
  offsetMs: number;
  canJoin: boolean;
  state: 'SCHEDULED' | 'ACCESS_OPEN' | 'IN_PROGRESS' | 'COMPLETED';
}

const MATRIX: MatrixRow[] = [
  // One minute before T-5. The spec lists 09:54 with the expectation DENIED;
  // the gate opens at 09:55 exactly.
  { clock: '09:54', offsetMs: -6 * 60_000, canJoin: false, state: 'SCHEDULED' },
  { clock: '09:55', offsetMs: -5 * 60_000, canJoin: true, state: 'ACCESS_OPEN' },
  { clock: '10:00', offsetMs: 0, canJoin: true, state: 'IN_PROGRESS' },
  { clock: '10:30', offsetMs: 30 * 60_000, canJoin: true, state: 'IN_PROGRESS' },
  { clock: '10:59', offsetMs: 59 * 60_000, canJoin: true, state: 'IN_PROGRESS' },
  { clock: '11:00', offsetMs: 60 * 60_000, canJoin: false, state: 'COMPLETED' },
  { clock: '11:01', offsetMs: 61 * 60_000, canJoin: false, state: 'COMPLETED' },
  { clock: '15:00', offsetMs: 5 * 60 * 60_000, canJoin: false, state: 'COMPLETED' },
];

function matrixBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'eeeeeeee-5555-4555-8555-555555555555',
    booking_code: 'BK-MATRIX',
    mentor_id: MENTOR_ID,
    seeker_id: SEEKER_ID,
    gig_id: 'ffffffff-6666-4666-8666-666666666666',
    segment_id: '00000000-0000-0000-0000-000000000002',
    hold_id: null,
    start_time: MATRIX_START.toISOString(),
    end_time: MATRIX_END.toISOString(),
    seeker_timezone: 'Asia/Kolkata',
    mentor_timezone: 'Asia/Kolkata',
    amount_inr: 999,
    status: 'CONFIRMED',
    meeting_url: 'https://meet.google.com/matrix-room',
    actual_ended_at: null,
    ended_by_role: null,
    end_reason: null,
    cancellation_reason: null,
    created_at: atClock('08:00').toISOString(),
    updated_at: atClock('08:00').toISOString(),
    ...overrides,
  } as Booking;
}

describe('Time-based matrix: 60 minute session 10:00-11:00', () => {
  describe('server join authorization (validateSessionAccess)', () => {
    for (const row of MATRIX) {
      it(`${row.clock} -> join ${row.canJoin ? 'ALLOWED' : 'DENIED'}`, () => {
        const now = new Date(MATRIX_START.getTime() + row.offsetMs);
        const b = matrixBooking();
        const result = validateSessionAccess(
          { bookingId: b.id, userId: SEEKER_ID, currentUtcTime: now },
          context(b)
        );
        assert.equal(
          result.canJoin,
          row.canJoin,
          `join at ${row.clock} must be ${row.canJoin ? 'allowed' : 'denied'}`
        );
        assert.equal(result.sessionState, row.state);
        if (!row.canJoin) {
          assert.equal(
            result.meetingUrl,
            null,
            `the meeting link must never be released at ${row.clock}`
          );
        }
      });
    }
  });

  describe('client resolver agrees with the server at every instant', () => {
    for (const row of MATRIX) {
      it(`${row.clock} -> ${row.state}, access ${row.canJoin ? 'granted' : 'denied'}`, () => {
        const nowMs = MATRIX_START.getTime() + row.offsetMs;
        const state = resolveSessionLifecycle(matrixBooking(), nowMs);
        assert.equal(state, row.state, `resolver state at ${row.clock}`);
        assert.equal(
          isAccessGranted(state),
          row.canJoin,
          `access gate at ${row.clock} must match the server's join decision`
        );
      });
    }

    it('resolves to COMPLETED on the following day', () => {
      const nextDay = new Date('2026-10-02T10:00:00.000Z').getTime();
      assert.equal(resolveSessionLifecycle(matrixBooking(), nextDay), 'COMPLETED');
      assert.equal(isAccessGranted(resolveSessionLifecycle(matrixBooking(), nextDay)), false);
    });
  });

  describe('joinSessionAuthoritative over the whole matrix', () => {
    for (const row of MATRIX) {
      it(`${row.clock} -> ${row.canJoin ? 'returns the room' : 'refuses and leaks no URL'}`, () => {
        const now = new Date(MATRIX_START.getTime() + row.offsetMs);
        const b = matrixBooking();
        const result = joinSessionAuthoritative(
          { bookingId: b.id, userId: SEEKER_ID, currentUtcTime: now },
          context(b)
        );
        assert.equal(result.canJoin, row.canJoin);
        if (row.canJoin) {
          assert.equal(result.meetingUrl, 'https://meet.google.com/matrix-room');
        } else {
          assert.equal(
            result.meetingUrl,
            undefined,
            `a denied join at ${row.clock} must not carry a meeting URL`
          );
          assert.ok(result.error?.code, 'a denied join must state a reason');
        }
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Past session reconciliation (spec §4, §15, §28)
// The row still says CONFIRMED. The clock says otherwise. The clock wins.
// ---------------------------------------------------------------------------

describe('Past session reconciliation', () => {
  const pastStart = new Date('2026-09-26T22:05:00.000Z');
  const pastEnd = new Date('2026-09-26T23:05:00.000Z');
  // Reproduces the real production data: a session that ended ~10h before the
  // request, still stored as CONFIRMED with a live meeting_url.
  const muchLater = new Date('2026-09-27T09:48:00.000Z');

  function staleRow(overrides: Partial<Booking> = {}): Booking {
    return matrixBooking({
      start_time: pastStart.toISOString(),
      end_time: pastEnd.toISOString(),
      ...overrides,
    });
  }

  it('refuses a join hours after end_time even though the row says CONFIRMED', () => {
    const b = staleRow();
    const result = joinSessionAuthoritative(
      { bookingId: b.id, userId: SEEKER_ID, currentUtcTime: muchLater },
      context(b)
    );
    assert.equal(result.canJoin, false, 'a stale CONFIRMED row must not be joinable');
    assert.equal(result.sessionState, 'COMPLETED');
    assert.equal(result.meetingUrl, undefined, 'no meeting URL may be returned');
  });

  it('resolves to COMPLETED and releases no URL for the same stale row', () => {
    const b = staleRow();
    const result = validateSessionAccess(
      { bookingId: b.id, userId: SEEKER_ID, currentUtcTime: muchLater },
      context(b)
    );
    assert.equal(result.sessionState, 'COMPLETED');
    assert.equal(result.meetingUrl, null);
  });

  it('redacts the meeting URL for a seeker on a stale CONFIRMED row', () => {
    const redacted = redactMeetingUrlForParticipant(staleRow(), {
      isAdmin: false,
      isMentor: false,
      now: muchLater,
    });
    assert.equal(redacted.meeting_url, null);
  });

  it('classifies a stale CONFIRMED row as History, not Upcoming', () => {
    assert.equal(isBookingUpcoming(staleRow(), muchLater.getTime()), false);
  });

  it('transitions the stored row to COMPLETED so the fix survives the request', () => {
    const b = staleRow();
    const db = context(b);
    validateSessionAccess(
      { bookingId: b.id, userId: SEEKER_ID, currentUtcTime: muchLater },
      db
    );
    // The engine mutates its context object; the server persists it. Asserting
    // the mutation here is what makes a missed persist a visible failure.
    assert.equal(
      (db.bookings[0] as Booking).status,
      'COMPLETED',
      'the engine must transition the row, not merely report on it'
    );
  });
});

// ---------------------------------------------------------------------------
// Manual end is terminal regardless of the clock (spec §13, §14)
// ---------------------------------------------------------------------------

describe('Manual end revokes access immediately', () => {
  it('closes a room whose scheduled end is still in the future', () => {
    const midSession = new Date(MATRIX_START.getTime() + 10 * 60_000);
    const ended = matrixBooking({
      actual_ended_at: midSession.toISOString(),
      ended_by_role: 'mentor',
    });
    const result = validateSessionAccess(
      { bookingId: ended.id, userId: SEEKER_ID, currentUtcTime: midSession },
      context(ended)
    );
    assert.equal(result.canJoin, false, 'a manually ended room must close at once');
    assert.equal(result.sessionState, 'COMPLETED');
    assert.equal(result.meetingUrl, null);
  });

  it('reports an early manual end as ENDED rather than a natural completion', () => {
    const midSession = new Date(MATRIX_START.getTime() + 10 * 60_000);
    const ended = matrixBooking({
      actual_ended_at: midSession.toISOString(),
      ended_by_role: 'mentor',
    });
    const result = validateSessionAccess(
      { bookingId: ended.id, userId: SEEKER_ID, currentUtcTime: midSession },
      context(ended)
    );
    assert.equal(result.accessState, 'ENDED');
    assert.equal(result.sessionState, 'COMPLETED');
  });

  it('redacts the meeting URL for a seeker once the room is manually ended', () => {
    const ended = matrixBooking({
      actual_ended_at: new Date(MATRIX_START.getTime() + 10 * 60_000).toISOString(),
    });
    const redacted = redactMeetingUrlForParticipant(ended, {
      isAdmin: false,
      isMentor: false,
      now: new Date(MATRIX_START.getTime() + 11 * 60_000),
    });
    assert.equal(
      redacted.meeting_url,
      null,
      'an early end must revoke the link even inside the T-5 window'
    );
  });
});

// ---------------------------------------------------------------------------
// Resolver hardening
// ---------------------------------------------------------------------------

describe('resolveSessionLifecycle hardening', () => {
  it('reports CANCELLED whatever the clock says', () => {
    const midSession = MATRIX_START.getTime() + 10 * 60_000;
    for (const status of ['CANCELLED', 'REJECTED'] as const) {
      assert.equal(resolveSessionLifecycle(matrixBooking({ status }), midSession), 'CANCELLED');
    }
  });

  it('fails closed on an unparseable window', () => {
    const nowMs = MATRIX_START.getTime() - 60_000;
    assert.equal(
      resolveSessionLifecycle(
        { status: 'CONFIRMED', start_time: 'not-a-date', end_time: undefined },
        nowMs
      ),
      'COMPLETED',
      'an unreadable window must never read as open'
    );
  });

  it('grants access only inside the T-5 window and at no other time', () => {
    for (const state of ['SCHEDULED', 'COMPLETED', 'CANCELLED'] as const) {
      assert.equal(isAccessGranted(state), false, `${state} must not grant access`);
    }
    for (const state of ['ACCESS_OPEN', 'IN_PROGRESS'] as const) {
      assert.equal(isAccessGranted(state), true, `${state} must grant access`);
    }
  });

  it('counts down to T-5, not to start', () => {
    const at09_54 = atClock('09:54').getTime();
    const b = matrixBooking();
    assert.equal(secondsUntilAccessOpens(b, at09_54), 60, 'one minute until access opens');
    assert.equal(secondsUntilAccessOpens(b, atClock('09:55').getTime()), 0, 'access is open at T-5');
  });

  it('clamps countdowns at zero once the window has passed', () => {
    const muchAfter = atClock('15:00').getTime();
    const b = matrixBooking();
    assert.equal(secondsUntilAccessOpens(b, muchAfter), 0);
    assert.equal(secondsUntilSessionEnd(b, muchAfter), 0);
  });

  it('derives the session duration from the UTC window, not from a formatted string', () => {
    assert.equal(sessionDurationMinutes(matrixBooking()), 60);
  });

  it('formats countdowns for display', () => {
    assert.equal(formatCountdown(65), '01:05');
    assert.equal(formatCountdown(3_665), '01:01:05');
    assert.equal(formatCountdown(-10), '00:00', 'a negative duration must clamp at zero');
  });
});
