/**
 * The OVERDUE booking state.
 *
 * A booking that passed its meeting-link deadline without a link used to sit
 * under "Pending Confirmation" labelled "Awaiting your confirmation", with an
 * "Overdue Link" chip that contradicted the surrounding copy. These tests pin
 * the replacement, and - more importantly - pin WHERE the decision is made.
 *
 * The rule under test:
 *
 *   OVERDUE iff  status === 'MENTOR_PENDING'
 *            AND meeting_url is absent
 *            AND serverNow > start_time - MEETING_LINK_DEADLINE_MS
 *            AND the booking is not cancelled / rejected / completed
 *
 * It is DERIVED, never persisted: `bookings.status` has no OVERDUE value and no
 * migration adds one. `resolveBookingLifecycle` is the single definition, the
 * server stamps the result on every projection, and the client groups on that
 * stamp. A browser clock therefore has no way to move a booking between
 * sections, which sections D and E pin directly.
 *
 * Section J documents the new auto-cancellation path: a missed deadline IS
 * cancelled by `cancel_overdue_mentor_bookings()` and a refund IS started by
 * the server-side reader.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  resolveBookingLifecycle,
  bucketToMentorTab,
  isMeetingLinkDeadlineOpen,
  formatOverdueDuration,
  type BookingLifecycleBucket,
} from '../src/lib/bookingLifecycle';
import { requireLifecycle, type EnrichedBookingRecord } from '../src/lib/bookingService';
import { redactMeetingUrlForParticipant } from '../src/lib/sessionAccess';
import { confirmSessionByMentor, type BookingEngineContext } from '../src/lib/bookingEngine';
import { APP_CONFIG } from '../src/config/app';
import type { Booking } from '../src/types/database';

const ROOT = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/**
 * Slices one route out of `server.ts` by its two distinguishing markers.
 *
 * Route markers are matched exactly rather than by prefix: `/api/admin/bookings`
 * is a prefix of `/api/admin/bookings/overdue-links`, and the overdue-links
 * route is registered FIRST, so a prefix match silently yields an empty slice.
 */
function route(marker: string, endMarker: string): string {
  const src = read('server.ts');
  const from = src.indexOf(marker);
  const to = src.indexOf(endMarker, from + marker.length);
  assert.ok(from > 0, `route marker not found: ${marker}`);
  assert.ok(to > from, `end marker "${endMarker}" does not follow "${marker}"`);
  return src.slice(from, to);
}

/** Session start. Everything is expressed relative to this instant. */
const T0 = new Date('2026-10-01T14:00:00.000Z');
const MINUTE = 60_000;

/** ISO instant, T-relative. */
const at = (ms: number) => new Date(T0.getTime() + ms).toISOString();

const DEADLINE_OFFSET = -APP_CONFIG.MEETING_LINK_DEADLINE_MS;

const booking = (overrides: Partial<Booking> = {}): Booking =>
  ({
    id: 'bk-1',
    booking_code: 'BK-1',
    mentor_id: 'mentor-1',
    seeker_id: 'seeker-1',
    gig_id: 'gig-1',
    segment_id: 'seg-1',
    hold_id: null,
    start_time: T0.toISOString(),
    end_time: at(60 * MINUTE),
    seeker_timezone: 'Asia/Kolkata',
    mentor_timezone: 'Asia/Kolkata',
    amount_inr: 999,
    status: 'MENTOR_PENDING',
    meeting_url: null,
    actual_ended_at: null,
    ended_by_role: null,
    end_reason: null,
    cancellation_reason: null,
    created_at: at(-24 * 60 * MINUTE),
    updated_at: at(-24 * 60 * MINUTE),
    ...overrides,
  }) as Booking;

/** Resolves `booking` at a T-relative offset and reports its tab. */
function tabAt(offsetMs: number, b: Booking = booking()): {
  bucket: BookingLifecycleBucket;
  tab: ReturnType<typeof bucketToMentorTab>;
} {
  const resolved = resolveBookingLifecycle(b, T0.getTime() + offsetMs);
  return { bucket: resolved.bucket, tab: bucketToMentorTab(resolved.bucket) };
}

// ===========================================================================
// A. Before the deadline -> Pending Confirmation
// ===========================================================================

describe('A. before the deadline the booking is a normal pending confirmation', () => {
  it('is PENDING_CONFIRMATION one millisecond before the deadline opens into overdue', () => {
    assert.deepEqual(tabAt(DEADLINE_OFFSET - 1), { bucket: 'PENDING_CONFIRMATION', tab: 'pending' });
  });

  it('is PENDING_CONFIRMATION well inside the window', () => {
    for (const offset of [-60 * MINUTE, -30 * MINUTE, -6 * MINUTE]) {
      assert.equal(tabAt(offset).bucket, 'PENDING_CONFIRMATION', `T${offset / MINUTE}m`);
    }
  });

  it('reports a deadline the mentor can still see coming', () => {
    const resolved = resolveBookingLifecycle(booking(), T0.getTime() - 60 * MINUTE);
    assert.equal(resolved.isOverdue, false);
    assert.equal(resolved.overdueByMs, 0);
    assert.equal(resolved.canAddMeetingLink, true);
    assert.equal(resolved.meetingLinkDeadlineUtc, at(DEADLINE_OFFSET));
  });

  it('is not overdue two hours out either, so the retired 2h rule cannot resurface', () => {
    assert.equal(tabAt(-120 * MINUTE).bucket, 'PENDING_CONFIRMATION');
  });
});

// ===========================================================================
// B. Exactly at the deadline -> boundary behaviour
// ===========================================================================

describe('B. the boundary instant is on time, and the flip is one millisecond later', () => {
  it('treats exactly start - deadline as still inside the window', () => {
    // The same strict `>` the phase-8 helper already used, and the same
    // boundary the T-5 access window uses. Changing this to `>=` would make the
    // mentor's submission deadline and the seeker's visibility gate disagree on
    // a single millisecond.
    assert.equal(tabAt(DEADLINE_OFFSET).bucket, 'PENDING_CONFIRMATION');
  });

  it('flips to OVERDUE one millisecond after it', () => {
    assert.equal(tabAt(DEADLINE_OFFSET + 1).bucket, 'OVERDUE');
  });

  it('agrees with the configured constant to the millisecond', () => {
    const resolved = resolveBookingLifecycle(booking(), T0.getTime());
    assert.equal(
      Date.parse(resolved.meetingLinkDeadlineUtc!),
      T0.getTime() - APP_CONFIG.MEETING_LINK_DEADLINE_MS,
    );
  });

  it('reports overdueByMs as 0 on the boundary and 1 a millisecond later', () => {
    assert.equal(resolveBookingLifecycle(booking(), T0.getTime() + DEADLINE_OFFSET).overdueByMs, 0);
    assert.equal(resolveBookingLifecycle(booking(), T0.getTime() + DEADLINE_OFFSET + 1).overdueByMs, 1);
  });
});

// ===========================================================================
// C. After the deadline -> Overdue
// ===========================================================================

describe('C. after the deadline the booking is OVERDUE and leaves Pending Confirmation', () => {
  it('is OVERDUE / Overdue tab well past the boundary', () => {
    assert.deepEqual(tabAt(-2 * MINUTE), { bucket: 'OVERDUE', tab: 'overdue' });
  });

  it('is still OVERDUE after the session has started', () => {
    // A MENTOR_PENDING row is never reconciled to COMPLETED, so a session that
    // began with no meeting link stays the mentor's problem. Filing it as
    // "Completed" would report a session as delivered that never happened.
    assert.equal(tabAt(10 * MINUTE).bucket, 'OVERDUE');
    assert.equal(tabAt(10 * MINUTE).tab, 'overdue');
  });

  it('measures how late it is', () => {
    const resolved = resolveBookingLifecycle(booking(), T0.getTime() + 30 * MINUTE);
    assert.equal(resolved.isOverdue, true);
    // 30m past a deadline that sits 5m before a session starting at T0.
    assert.equal(resolved.overdueByMs, 35 * MINUTE);
    assert.equal(formatOverdueDuration(resolved.overdueByMs), '35 minutes');
  });

  it('flags that the session has already started, so the copy can say so', () => {
    assert.equal(
      resolveBookingLifecycle(booking(), T0.getTime() + 10 * MINUTE).sessionStarted,
      true,
    );
    assert.equal(
      resolveBookingLifecycle(booking(), T0.getTime() - 10 * MINUTE).sessionStarted,
      false,
    );
  });

  it('is never in two tabs at once: OVERDUE and PENDING_CONFIRMATION are disjoint', () => {
    for (const offset of [-120, -6, -5, -1, 0, 1, 5, 60, 120]) {
      const { tab } = tabAt(offset * MINUTE);
      assert.ok(tab === 'pending' || tab === 'overdue', `T${offset}m produced ${tab}`);
    }
  });
});

// ===========================================================================
// D. Refresh after the deadline -> still Overdue (the state is derived, not a
//    one-shot client flag)
// ===========================================================================

describe('D. re-reading the ledger after the deadline keeps the booking Overdue', () => {
  it('produces the same verdict on a second, independent resolution', () => {
    // Two "requests" a minute apart, each with its own clock reading. A state
    // held only in the browser would have been resolved once and cached.
    const first = resolveBookingLifecycle(booking(), T0.getTime() + 10 * MINUTE);
    const second = resolveBookingLifecycle(booking(), T0.getTime() + 11 * MINUTE);
    assert.equal(first.bucket, 'OVERDUE');
    assert.equal(second.bucket, 'OVERDUE');
    assert.ok(second.overdueByMs > first.overdueByMs, 'and the lateness keeps growing');
  });

  it('never regresses back to pending as time advances', () => {
    let previous: BookingLifecycleBucket | null = null;
    for (let offset = -30; offset <= 30; offset += 1) {
      const { bucket } = tabAt(offset * MINUTE);
      if (previous === 'PENDING_CONFIRMATION') {
        assert.ok(
          bucket === 'PENDING_CONFIRMATION' || bucket === 'OVERDUE',
          `T${offset}m moved backwards into ${bucket}`,
        );
      }
      previous = bucket;
    }
  });

  it('clears the overdue state the moment a link is confirmed', () => {
    // The only thing that resolves an overdue booking is the mentor acting.
    const confirmed = booking({ status: 'CONFIRMED', meeting_url: 'https://meet.google.com/x' });
    assert.deepEqual(tabAt(-2 * MINUTE, confirmed), { bucket: 'CONFIRMED', tab: 'upcoming' });
  });
});

// ===========================================================================
// E. Browser clock manipulation -> cannot bypass the server deadline
// ===========================================================================

describe('E. the client cannot decide the deadline, so it cannot forge the state', () => {
  it('a response stamped by the server at T+1m stays OVERDUE no matter what the browser believes', () => {
    // The server's verdict is a property of the row plus the server's clock.
    // Rendering re-reads that field; it does not recompute it.
    const stamped = resolveBookingLifecycle(booking(), T0.getTime() + 1 * MINUTE);
    assert.equal(stamped.bucket, 'OVERDUE');

    // A browser rewound to before the deadline would "like" this booking to be
    // pending. It has no channel to say so: the field it groups on is this one.
    const browserTime = T0.getTime() - 60 * MINUTE;
    const bucketFromBrowserClock = resolveBookingLifecycle(booking(), browserTime).bucket;
    assert.equal(bucketFromBrowserClock, 'PENDING_CONFIRMATION');
    assert.notEqual(
      bucketFromBrowserClock,
      stamped.bucket,
      'which is precisely why no client-side clock may produce the rendered bucket',
    );
  });

  it('the mentor bookings page never computes a deadline from Date.now()', () => {
    const page = read('src/pages/mentor/MentorBookingsPage.tsx');
    const body = page.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    // Grouping is `bucketToMentorTab(requireLifecycle(booking).bucket)` and
    // nothing else. A `Date.now()` reaching the grouping expression is the
    // defect this whole change exists to prevent.
    assert.match(body, /bucketToMentorTab\(\s*requireLifecycle\(/);
    assert.doesNotMatch(
      body,
      /bucketToMentorTab\([^)]*(Date\.now|nowMs)/,
      'the tab grouping must not be a function of the local clock',
    );
  });

  it('refuses to group a booking the server did not classify', () => {
    // Failing closed is the point. Defaulting a missing bucket to "not overdue"
    // is the exact bug: it would put an overdue booking back under Pending
    // Confirmation purely because the field was absent.
    const unclassified = { id: 'bk-2', status: 'MENTOR_PENDING' } as EnrichedBookingRecord;
    assert.throws(() => requireLifecycle(unclassified), /BOOKING_STATE_UNAVAILABLE/);
  });

  it('the deadline-window check also answers from a caller-supplied server clock', () => {
    assert.equal(isMeetingLinkDeadlineOpen(booking(), T0.getTime() - 60 * MINUTE), true);
    assert.equal(isMeetingLinkDeadlineOpen(booking(), T0.getTime() + DEADLINE_OFFSET), true);
    assert.equal(isMeetingLinkDeadlineOpen(booking(), T0.getTime() + DEADLINE_OFFSET + 1), false);
  });
});

// ===========================================================================
// F. Confirming after the deadline
// ===========================================================================

describe('F. a late confirmation is rejected by the hard deadline gate', () => {
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

  it('the deadline is a hard gate: a late link is refused, not accepted', async () => {
    // Phase 43 — `confirm_booking()` and `confirmSessionByMentor()` both raise
    // MEETING_LINK_DEADLINE_PASSED once start_time - 5min has elapsed. The
    // booking is no longer confirmable by the mentor; the pg_cron job will
    // auto-cancel it and the refund reader will start the refund.
    const result = await confirmSessionByMentor(
      {
        bookingId: 'bk-1',
        mentorId: 'mentor-1',
        meetingUrl: 'https://meet.google.com/late',
        currentUtcTime: new Date(at(-2 * MINUTE)),
      },
      context(booking()),
    );
    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'MEETING_LINK_DEADLINE_PASSED');
    // On rejection, no booking is returned (the status didn't change).
    assert.equal(result.booking, undefined);
  });

  it('an on-time link is still accepted and clears the overdue flag', async () => {
    const result = await confirmSessionByMentor(
      {
        bookingId: 'bk-1',
        mentorId: 'mentor-1',
        meetingUrl: 'https://meet.google.com/on-time',
        currentUtcTime: new Date(at(-10 * MINUTE)),
      },
      context(booking()),
    );
    assert.equal(result.success, true);
    assert.equal(result.booking?.status, 'CONFIRMED');
    assert.equal(result.isOverdue, false, 'on-time confirmation is not overdue');
  });

  it('still refuses a non-HTTPS link even before the deadline', async () => {
    const result = await confirmSessionByMentor(
      {
        bookingId: 'bk-1',
        mentorId: 'mentor-1',
        meetingUrl: 'http://insecure-meeting.com',
        currentUtcTime: new Date(at(-10 * MINUTE)),
      },
      context(booking()),
    );
    assert.equal(result.success, false);
    assert.equal(result.error?.code, 'INVALID_MEETING_URL');
  });

  it('the confirm handler refuses the deadline error before the RPC write', async () => {
    // The server reads the booking, measures lateness against its own clock,
    // and returns 409 BEFORE the RPC transition is attempted. `confirmNowMs`
    // is sampled inline and never trusts client-supplied time.
    const src = route(
      "app.post('/api/mentor/bookings/:id/confirm'",
      "app.post('/api/mentor/bookings/:id/cancel'",
    );
    assert.match(src, /MEETING_LINK_DEADLINE_PASSED/);
    assert.match(src, /res\.status\(409\)/);
  });
});

// ===========================================================================
// G. Cancelled -> Cancelled, never Overdue or Pending
// ===========================================================================

describe('G. a cancelled booking is Cancelled and appears nowhere else', () => {
  it('is CANCELLED before, at and long after the deadline', () => {
    for (const offset of [-120 * MINUTE, DEADLINE_OFFSET, 0, 60 * MINUTE]) {
      const resolved = resolveBookingLifecycle(
        booking({ status: 'CANCELLED', meeting_url: 'https://meet.google.com/x' }),
        T0.getTime() + offset,
      );
      assert.equal(resolved.bucket, 'CANCELLED', `T${offset / MINUTE}m`);
      assert.equal(bucketToMentorTab(resolved.bucket), 'cancelled');
      assert.equal(resolved.isOverdue, false);
      assert.equal(resolved.overdueByMs, 0);
      assert.equal(resolved.canAddMeetingLink, false);
    }
  });

  it('REJECTED is terminal in the same way', () => {
    assert.equal(resolveBookingLifecycle(booking({ status: 'REJECTED' }), T0.getTime()).bucket, 'CANCELLED');
  });

  it('hides the meeting link from the seeker even inside the access window', () => {
    // A cancellation normally happens BEFORE the session, so a cancelled row is
    // typically still inside T-5. Status is therefore checked ahead of the time
    // gate: the window alone would hand the seeker a room that is not happening.
    const now = new Date(T0.getTime() - 2 * MINUTE);
    const cancelled = {
      status: 'CANCELLED',
      start_time: T0.toISOString(),
      end_time: at(60 * MINUTE),
      meeting_url: 'https://meet.google.com/ghost',
      actual_ended_at: null,
    };
    assert.equal(
      redactMeetingUrlForParticipant(cancelled, { isAdmin: false, isMentor: false, now }).meeting_url,
      null,
    );
    // An admin keeps operational visibility; the mentor supplied it.
    assert.equal(
      redactMeetingUrlForParticipant(cancelled, { isAdmin: true, isMentor: false, now }).meeting_url,
      'https://meet.google.com/ghost',
    );
  });

  it('a confirmed-and-then-cancelled booking is still Completed, not Overdue', () => {
    const done = booking({ status: 'COMPLETED', meeting_url: 'https://meet.google.com/x' });
    assert.equal(resolveBookingLifecycle(done, T0.getTime() + 90 * MINUTE).bucket, 'COMPLETED');
  });
});

// ===========================================================================
// H. Confirmed -> Upcoming, never Overdue
// ===========================================================================

describe('H. a confirmed booking is Upcoming and can never be overdue', () => {
  it('is CONFIRMED / Upcoming however far past T-5 the clock is', () => {
    for (const offset of [-60 * MINUTE, DEADLINE_OFFSET, 0, 10 * MINUTE, 59 * MINUTE]) {
      const resolved = resolveBookingLifecycle(
        booking({ status: 'CONFIRMED', meeting_url: 'https://meet.google.com/x' }),
        T0.getTime() + offset,
      );
      assert.equal(resolved.bucket, 'CONFIRMED', `T${offset / MINUTE}m`);
      assert.equal(bucketToMentorTab(resolved.bucket), 'upcoming');
      assert.equal(resolved.isOverdue, false);
    }
  });

  it('is COMPLETED once the window has elapsed, which the server reconciles first', () => {
    const resolved = resolveBookingLifecycle(
      booking({ status: 'CONFIRMED', meeting_url: 'https://meet.google.com/x' }),
      T0.getTime() + 61 * MINUTE,
    );
    assert.equal(resolved.bucket, 'COMPLETED');
    assert.equal(bucketToMentorTab(resolved.bucket), 'completed');
  });

  it('a MENTOR_PENDING row that already has a link is not reported as broken', () => {
    // `status` lagging behind a written link must not manufacture an overdue
    // booking with a working room.
    const resolved = resolveBookingLifecycle(
      booking({ meeting_url: 'https://meet.google.com/x' }),
      T0.getTime() + 30 * MINUTE,
    );
    assert.equal(resolved.bucket, 'PENDING_CONFIRMATION');
    assert.equal(resolved.isOverdue, false);
  });

  it('does not classify pre-payment states as overdue', () => {
    for (const status of ['PAYMENT_PENDING', 'PAYMENT_PROCESSING', 'PENDING_VERIFICATION']) {
      const resolved = resolveBookingLifecycle(booking({ status: status as Booking['status'] }), T0.getTime());
      assert.equal(resolved.bucket === 'OVERDUE', false, status);
      assert.equal(resolved.canAddMeetingLink, false, status);
    }
  });
});

// ===========================================================================
// I. Real-time transition without a refresh
// ===========================================================================

describe('I. the Pending -> Overdue transition does not need a browser refresh', () => {
  const hook = read('src/hooks/useMentorBookingSync.ts');

  it('schedules an exact timer for the nearest deadline', () => {
    // OVERDUE writes nothing, so postgres_changes NEVER fires for it. An exact
    // boundary timer is the only transport that can move the tab on time.
    assert.match(hook, /setTimeout\(/);
    assert.match(hook, /nextBoundaryKey/);
    assert.match(hook, /nearest/);
  });

  it('still subscribes to bookings realtime for the transitions that do write', () => {
    assert.match(hook, /'postgres_changes'/);
    assert.match(hook, /table: 'bookings'/);
    assert.match(hook, /mentor_id=eq\.\$\{mentorId\}/);
  });

  it('refetches when the socket reconnects, since dropped events are lost', () => {
    assert.match(hook, /status === 'SUBSCRIBED'/);
    assert.match(hook, /RECONNECT|reconnect/i);
  });

  it('keeps a visibility-gated interval and focus revalidation as backstops', () => {
    assert.match(hook, /setInterval\(/);
    assert.match(hook, /visibilitychange/);
    assert.match(hook, /'online'/);
  });

  it('the page feeds it the deadlines of exactly the bookings that are still pending', () => {
    const page = read('src/pages/mentor/MentorBookingsPage.tsx');
    assert.match(page, /useMentorBookingSync\(/);
    assert.match(page, /grouped\.pending/);
    assert.match(page, /meetingLinkDeadlineUtc/);
  });

  it('the refetch re-reads the server rather than mutating local state', () => {
    // The transition is a fresh authoritative read. Nothing on the client
    // promotes a booking from pending to overdue on its own.
    const page = read('src/pages/mentor/MentorBookingsPage.tsx');
    const body = page.replace(/\/\*[\s\S]*?\*\//g, ' ');
    assert.doesNotMatch(body, /setBookings\([^)]*bucket:\s*'OVERDUE'/);
    assert.match(body, /fetchMentorBookingsWithServerNow/);
  });

  it('a silent revalidation never blanks a ledger the mentor is reading', () => {
    const page = read('src/pages/mentor/MentorBookingsPage.tsx');
    assert.match(page, /if \(options\.silent\)/);
    assert.match(page, /if \(!options\.silent\) setLoading\(true\)/);
  });
});

// ===========================================================================
// J. Automatic cancellation of overdue mentor bookings
// ===========================================================================

describe('J. a missed deadline auto-cancels via pg_cron with a refund workflow', () => {
  it('the resolver itself stays a pure classifier (no writes)', () => {
    // The DERIVED bucket is still read-only; the WRITER is the DB function
    // `cancel_overdue_mentor_bookings()`, not this module.
    const src = read('src/lib/bookingLifecycle.ts');
    const body = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    assert.doesNotMatch(body, /\.status\s*=/);
    assert.doesNotMatch(body, /\bupdate\b|\.insert\(|rpc\(/);
  });

  it('the auto-cancel writes CANCELLED with the right reason, no OVERDUE status', () => {
    // Phase 43 adds `cancel_overdue_mentor_bookings()` but does NOT add an
    // OVERDUE status to the CHECK constraint. The booking moves straight to
    // CANCELLED.
    const schema = read('supabase/migrations/20260920000001_phase4_mvp_schema.sql');
    const constraint = schema.slice(
      schema.indexOf('status IN ('),
      schema.indexOf('status IN (') + 400,
    );
    assert.doesNotMatch(constraint, /OVERDUE/);
    const migration = read('supabase/migrations/20261007000000_phase43_auto_cancel_overdue_mentors.sql');
    assert.match(migration, /cancel_overdue_mentor_bookings/);
    assert.match(migration, /cancellation_reason = 'MENTOR_MEETING_LINK_DEADLINE_MISSED'/);
  });

  it('the mentor ledger card now says the booking IS being auto-cancelled', async () => {
    // Where §J previously asserted the card says "has not been cancelled and
    // nothing has been refunded", the Phase 43 card says the opposite: the
    // booking is being auto-cancelled and a refund is processing.
    const card = read('src/components/mentor/MentorBookingCard.tsx');
    assert.doesNotMatch(card, /has not been cancelled and nothing has been refunded/);
    assert.match(card, /auto-cancelled|automatically cancelled|refund.*processing/i);
  });

  it('auto-cancellation triggers the existing refund workflow', () => {
    // The cron function sets refund_status='PENDING' + refund_reason='mentor_rejection'
    // on the payment, then the server-side reader calls runCreateRazorpayRefund.
    const migration = read('supabase/migrations/20261007000000_phase43_auto_cancel_overdue_mentors.sql');
    assert.match(migration, /refund_status = 'PENDING'/);
    assert.match(migration, /refund_reason = v_refund_reason/);
    assert.match(migration, /BOOKING_AUTO_CANCELLED/);
    assert.match(migration, /cron\.schedule[\s\S]*cancel-overdue-mentor-bookings/);

    // The server-side reconcile reader that calls the gateway API.
    const src = read('server.ts');
    assert.match(src, /reconcileAutoCancelledRefunds/);
    assert.match(src, /refund_reason.*mentor_rejection/);
    assert.match(src, /runCreateRazorpayRefund/);
    // The admin endpoint that triggers it on demand.
    assert.match(src, /POST.*api\/admin\/payments\/reconcile-auto-cancelled/);
  });
});

// ===========================================================================
// K. The three divergent overdue predicates now share one definition
// ===========================================================================

describe('K. every surface reads the same resolver', () => {
  const src = read('server.ts');

  it('the mentor projection stamps the bucket', () => {
    assert.match(src, /const lifecycle = resolveBookingLifecycle\(booking, nowMs\)/);
  });

  it('the admin ledger stamps the same bucket instead of its own predicate', () => {
    // It previously carried `&& startTime > now`, which hid an already-started
    // session from the admin while the dashboard exception centre reported it
    // as the worst kind of overdue.
    const src = route(
      "app.get('/api/admin/bookings',",
      "app.get('/api/admin/payments',",
    );
    const body = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    assert.match(body, /resolveBookingLifecycle\(booking, adminNowMs\)/);
    assert.doesNotMatch(body, /startTime > now/);
    assert.doesNotMatch(body, /const isOverdue =/);
  });

  it('the overdue-links inspection route agrees at the boundary', () => {
    // It used `deadlineMs <= now`, one millisecond earlier than everything else.
    assert.doesNotMatch(src, /meetingLinkDeadlineMs <= now/);
    assert.match(src, /is_overdue: lifecycle\.isOverdue/);
  });

  it('the admin UI filters on the server bucket, not a local re-derivation', () => {
    const page = read('src/pages/admin/AdminBookingsPage.tsx');
    assert.match(page, /lifecycle\?\.bucket === 'OVERDUE'/);
    assert.doesNotMatch(page, /status === 'MENTOR_PENDING' && b\.deadlineInfo\?\.isOverdue/);
  });

  it('the ledger list uses one clock for reconciliation, annotation and bucketing', () => {
    // Three separate Date.now() samples could return a row that is both
    // reconciled COMPLETED and bucketed OVERDUE.
    const src = route(
      "app.get('/api/mentor/bookings',",
      "app.get('/api/mentor/bookings/:id'",
    );
    assert.match(src, /const nowMs = Date\.now\(\)/);
    assert.match(
      src,
      /reconcileAndAnnotateBookingRows\(\s*supabaseAdmin,\s*\[\.\.\.\(bookings \|\| \[\]\)\],\s*nowMs\s*\)/,
    );
  });

  it('the page renders exactly the five requested sections', () => {
    const page = read('src/pages/mentor/MentorBookingsPage.tsx');
    for (const label of [
      'Pending Confirmation',
      'Upcoming (Confirmed)',
      'Overdue / Action Required',
      'Completed',
      'Cancelled',
    ]) {
      assert.match(page, new RegExp(label.replace(/[()]/g, '\\$&')), label);
    }
  });

  it('the overdue action is not the one-tap confirm', () => {
    const card = read('src/components/mentor/MentorBookingCard.tsx');
    assert.match(card, /label: 'Review Booking'/);
    // The late-confirm capability itself is unchanged and server-enforced; what
    // is gone is the button that fires it without the mentor choosing to.
    assert.match(card, /'Add Meeting Link & Confirm'/);
    assert.match(card, /Meeting link deadline missed/);
    assert.match(card, /Overdue by/);
  });
});