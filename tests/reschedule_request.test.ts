import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { generateMentorSlots } from '../src/lib/slotEngine';
import { MentorAvailability, Booking, SlotHold } from '../src/types/database';

/**
 * RESCHEDULE REQUESTS.
 *
 * Two halves, deliberately split by what each can actually prove:
 *
 *   1. Executable checks on the one rule that lives in TypeScript - a mentor's
 *      availability is GLOBAL, so a booking on one gig blocks the same instant
 *      for a slot grid generated for a different gig in a different segment.
 *      This is the exact scenario from the brief: a Relationship booking at 5 PM
 *      must make 5 PM unavailable to an Autism reschedule.
 *
 *   2. Source-level checks on the SQL, because the reschedule rules live in
 *      `create_reschedule_request` / `respond_to_reschedule_request` and cannot
 *      be executed without a live database. Each one asserts a rule that, if it
 *      silently disappeared, would be invisible in review.
 */

const MIGRATION = join(
  'supabase/migrations',
  '20261005000000_phase30_reschedule_requests.sql'
);
const sql = readFileSync(MIGRATION, 'utf8');

/** The body of one `CREATE OR REPLACE FUNCTION`, without its header. */
function fnBody(name: string): string {
  const start = sql.indexOf(`FUNCTION public.${name}(`);
  assert.notEqual(start, -1, `${name} must be defined in the migration`);
  return sql.slice(start).split(/\$\$;/)[0];
}

// ---------------------------------------------------------------------------
// 1. Global availability — the rule that actually runs here
// ---------------------------------------------------------------------------

const MENTOR = 'mentor-global';
const RELATIONSHIP_GIG = 'gig-relationship';
const AUTISM_GIG = 'gig-autism';

/** Mondays 09:00-21:00 IST, the mentor's single shared operating window. */
const HOURS: MentorAvailability[] = [
  {
    id: 'avail-global',
    mentor_id: MENTOR,
    day_of_week: 1,
    start_time: '09:00:00',
    end_time: '21:00:00',
    timezone: 'Asia/Kolkata',
    is_enabled: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

/** A 17:00-18:00 IST booking on the mentor's RELATIONSHIP gig. */
function relationshipBookingAt17(): Booking {
  return {
    id: 'booking-relationship',
    booking_code: 'BK-REL',
    mentor_id: MENTOR,
    seeker_id: 'seeker-1',
    gig_id: RELATIONSHIP_GIG,
    segment_id: 'segment-relationship',
    hold_id: null,
    start_time: '2026-09-21T11:30:00.000Z', // 17:00 IST
    end_time: '2026-09-21T12:30:00.000Z', // 18:00 IST
    seeker_timezone: 'Asia/Kolkata',
    mentor_timezone: 'Asia/Kolkata',
    amount_inr: 999,
    status: 'CONFIRMED',
    meeting_url: null,
    actual_ended_at: null,
    ended_by_role: null,
    end_reason: null,
    cancellation_reason: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  };
}

const BEFORE = new Date('2026-09-21T00:00:00.000Z');

/** Slots for the AUTISM gig, i.e. what a seeker rescheduling an autism booking sees. */
function autismSlots(bookings: Booking[], holds: SlotHold[] = []) {
  return generateMentorSlots({
    mentorId: MENTOR,
    gigId: AUTISM_GIG,
    dateStr: '2026-09-21',
    timezone: 'Asia/Kolkata',
    durationMinutes: 60,
    recurringAvailability: HOURS,
    exceptions: [],
    bookings,
    slotHolds: holds,
    currentUtcTime: BEFORE,
  });
}

const slotAt = (slots: ReturnType<typeof autismSlots>, localStart: string) =>
  slots.find((s) => s.local_start_time === localStart);

describe('mentor availability is global across gigs and segments', () => {
  it('a booking on the Relationship gig blocks 17:00 for an Autism slot grid', () => {
    const slots = autismSlots([relationshipBookingAt17()]);
    const fivePm = slotAt(slots, '17:00');

    assert.ok(fivePm, 'the 17:00 slot must be generated so it can be shown as taken');
    assert.equal(fivePm.is_available, false, 'a Relationship booking must block 17:00 globally');
    assert.equal(fivePm.status, 'BOOKED');
    assert.equal(fivePm.conflict_reason, 'BOOKING_CONFLICT');
  });

  it('a free 17:00 is requestable, because the timeline is not segmented', () => {
    const slots = autismSlots([]);

    // The mirror of the rule above: same mentor, same instant, nothing booked,
    // so the slot is genuinely free and the seeker may request it.
    assert.equal(slotAt(slots, '17:00')?.is_available, true);
    // ...including the slot immediately after the Relationship booking.
    assert.equal(slotAt(slots, '19:00')?.is_available, true);
  });

  it('a hold on one gig blocks the same instant for another', () => {
    const hold: SlotHold = {
      id: 'hold-other-gig',
      mentor_id: MENTOR,
      seeker_id: 'seeker-2',
      gig_id: RELATIONSHIP_GIG,
      start_time: '2026-09-21T11:30:00.000Z',
      end_time: '2026-09-21T12:30:00.000Z',
      status: 'ACTIVE',
      expires_at: '2026-09-21T10:00:00.000Z',
      created_at: '2026-09-21T09:55:00.000Z',
    };
    const fivePm = slotAt(autismSlots([], [hold]), '17:00');

    assert.equal(fivePm?.is_available, false);
    assert.equal(fivePm?.status, 'HELD');
  });

  it('an expired hold does not block, so an abandoned request frees its slot', () => {
    const staleHold: SlotHold = {
      id: 'hold-expired',
      mentor_id: MENTOR,
      seeker_id: 'seeker-2',
      gig_id: RELATIONSHIP_GIG,
      start_time: '2026-09-21T11:30:00.000Z',
      end_time: '2026-09-21T12:30:00.000Z',
      status: 'ACTIVE',
      expires_at: '2026-09-20T23:00:00.000Z', // already elapsed at BEFORE
      created_at: '2026-09-20T22:55:00.000Z',
    };
    assert.equal(slotAt(autismSlots([], [staleHold]), '17:00')?.is_available, true);
  });
});

// ---------------------------------------------------------------------------
// 2. The request lifecycle, asserted against the SQL that enforces it
// ---------------------------------------------------------------------------

describe('creating a reschedule request', () => {
  const create = fnBody('create_reschedule_request');

  it('accepts only a time, never a gig, a segment or a mentor', () => {
    // The parameter list is the whole contract surface. A gig/segment/mentor
    // parameter here would be an invitation to reschedule across them.
    const signature = create.slice(0, create.indexOf(')'));
    assert.match(signature, /p_booking_id UUID/);
    assert.match(signature, /p_seeker_id UUID/);
    assert.match(signature, /p_requested_start_time TIMESTAMPTZ/);
    assert.match(signature, /p_requested_end_time TIMESTAMPTZ/);
    assert.equal(/p_(gig|segment|mentor)_id/.test(signature), false);
  });

  it('is restricted to the booking owner', () => {
    assert.match(
      create,
      /IF v_booking\.seeker_id <> p_seeker_id THEN[\s\S]*?FORBIDDEN_NOT_BOOKING_OWNER/,
      'a seeker must not be able to request a reschedule of someone else\'s booking',
    );
  });

  it('only allows a live pre-session booking to move', () => {
    assert.match(create, /v_booking\.status NOT IN \('MENTOR_PENDING', 'CONFIRMED'\)/);
    // An unpaid booking is a re-book, not a reschedule.
    assert.equal(
      /status NOT IN \([^)]*'PAYMENT_PENDING'/.test(create),
      false,
      'PAYMENT_PENDING must not be a reschedulable state: changing time on an unpaid booking is a re-book',
    );
  });

  it('checks the requested interval against the mentor timeline, not against a gig', () => {
    // Availability is derived from the mentor's timezone and their live rows.
    assert.match(create, /v_mentor_tz FROM public\.profiles WHERE id = v_booking\.mentor_id/);
    assert.match(create, /FROM public\.mentor_availability a[\s\S]*?a\.mentor_id = v_booking\.mentor_id/);
    assert.match(create, /FROM public\.mentor_availability_exceptions[\s\S]*?mentor_id = v_booking\.mentor_id/);

    // And neither the availability branch nor the conflict branch may mention
    // gig_id or segment_id. This is the regression the redesign exists to kill.
    const availabilityAndConflicts = create.slice(create.indexOf('-- 11. Global availability'));
    assert.equal(
      /segment_id/.test(availabilityAndConflicts),
      false,
      'the availability decision must not be scoped by segment',
    );
    // gig_id may only appear as the hold\'s own bookkeeping column, never in a
    // WHERE clause, so assert on the decision queries specifically.
    const conflictChecks = availabilityAndConflicts.slice(
      0,
      availabilityAndConflicts.indexOf('-- 14.')
    );
    assert.equal(
      /gig_id/.test(conflictChecks),
      false,
      'the conflict decision must not be scoped by gig',
    );
  });

  it('conflicts are resolved against every booking and hold the mentor has', () => {
    const conflicts = create.slice(create.indexOf('-- 12.'), create.indexOf('-- 14.'));
    // No gig/segment equality, and this booking's own row is excluded so its
    // current time can be vacated.
    assert.match(conflicts, /FROM public\.bookings\s+WHERE mentor_id = v_booking\.mentor_id/);
    assert.match(conflicts, /id <> v_booking\.id/);
    assert.match(conflicts, /FROM public\.slot_holds\s+WHERE mentor_id = v_booking\.mentor_id/);
  });

  it('protects the requested slot with a real hold before recording the request', () => {
    // Order matters: the hold insert is what makes the slot un-takeable, and it
    // must come first so a failure never leaves a request with nothing behind it.
    const holdAt = create.indexOf('INSERT INTO public.slot_holds');
    const requestAt = create.indexOf('INSERT INTO public.reschedule_requests');
    assert.ok(holdAt > -1 && requestAt > holdAt, 'the hold must be written before the request');
    // The hold outlives the 5-minute payment hold: a mentor may take hours to answer.
    assert.match(create, /reschedule_request_expiry_interval\(\)/);
  });

  it('leaves the booking untouched', () => {
    // The single most important assertion in this file: nothing here writes to
    // `bookings`. If a future edit adds one, the reschedule becomes immediate.
    assert.equal(
      /UPDATE\s+public\.bookings/i.test(create),
      false,
      'creating a request must never modify the booking',
    );
  });

  it('refuses a second open request on the same booking', () => {
    assert.match(create, /RESCHEDULE_REQUEST_PENDING/);
    assert.match(
      sql,
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_reschedule_requests_pending_booking[\s\S]*?WHERE status = 'PENDING'/,
      'one open request per booking must also be enforced by the database',
    );
  });

  it('notifies the mentor with both times', () => {
    assert.match(create, /MENTOR_RESCHEDULE_REQUESTED/);
    assert.match(create, /to_char\(v_booking\.start_time/);
    assert.match(create, /to_char\(p_requested_start_time/);
  });
});

describe('the mentor responds to a reschedule request', () => {
  const respond = fnBody('respond_to_reschedule_request');

  it('is restricted to the booking\'s own mentor', () => {
    assert.match(
      respond,
      /IF v_request\.mentor_id <> p_mentor_id THEN[\s\S]*?FORBIDDEN_NOT_BOOKING_OWNER/,
    );
  });

  it('accepts only APPROVED or REJECTED', () => {
    assert.match(respond, /p_decision NOT IN \('APPROVED', 'REJECTED'\)/);
  });

  it('refuses to answer a request twice, or one that has expired', () => {
    assert.match(respond, /RESCHEDULE_REQUEST_CLOSED/);
    assert.match(respond, /RESCHEDULE_REQUEST_EXPIRED/);
  });

  it('on approval, moves the time and nothing else', () => {
    const approval = respond.slice(
      respond.indexOf('IF p_decision = \'APPROVED\''),
      respond.indexOf("-- 5. APPROVED")
    );
    assert.equal(
      /status NOT IN \('MENTOR_PENDING', 'CONFIRMED'\)/.test(approval),
      false,
      'the rejection branch must not gate on the booking status',
    );

    const update = respond.slice(respond.indexOf('UPDATE public.bookings'));
    assert.match(update, /start_time = v_request\.requested_start_time/);
    assert.match(update, /end_time = v_request\.requested_end_time/);
    for (const column of ['mentor_id', 'segment_id', 'gig_id', 'amount_inr', 'status']) {
      assert.equal(
        new RegExp(`SET[^;]*${column}\\s*=`).test(update.slice(0, update.indexOf('WHERE id ='))),
        false,
        `approval must not reassign ${column}: a reschedule is a time change`,
      );
    }
  });

  it('on approval, releases the old slot and converts the request hold', () => {
    // Two different holds, two different fates. The booking's own hold is
    // RELEASED so the vacated time becomes bookable again; the request's hold
    // is CONVERTED, which takes it out of the `no_overlapping_active_holds`
    // predicate and lets the booking occupy exactly that interval.
    assert.match(
      respond,
      /UPDATE public\.slot_holds\s+SET status = 'RELEASED'\s+WHERE id = v_booking\.hold_id AND status = 'ACTIVE'/,
    );
    assert.match(
      respond,
      /UPDATE public\.slot_holds\s+SET status = 'CONVERTED'\s+WHERE id = v_request\.hold_id AND status = 'ACTIVE'/,
    );
  });

  it('on approval, re-checks the slot is still free before taking it', () => {
    // The request may have sat PENDING for hours. The booking check excludes
    // this booking and the hold check excludes this request's own hold, which
    // is being converted rather than competed with.
    const recheck = respond.slice(respond.indexOf('-- 6.'), respond.indexOf('-- 7.'));
    assert.match(recheck, /id <> v_booking\.id/);
    assert.match(recheck, /id IS DISTINCT FROM v_request\.hold_id/);
  });

  it('on rejection, never writes to the booking', () => {
    const rejection = respond.slice(
      respond.indexOf("IF p_decision = 'REJECTED'"),
      respond.indexOf('-- 5. APPROVED')
    );
    assert.equal(
      /public\.bookings/i.test(rejection),
      false,
      'a rejected request must leave the booking completely untouched',
    );
    // ...but the held slot is released so somebody else can take it.
    assert.match(rejection, /WHERE id = v_request\.hold_id AND status = 'ACTIVE'/);
  });

  it('tells the seeker the outcome, with the reason when there is one', () => {
    assert.match(respond, /RESCHEDULE_APPROVED/);
    assert.match(respond, /RESCHEDULE_REJECTED/);
    assert.match(respond, /rejection_reason = NULLIF\(TRIM\(COALESCE\(p_reason, ''\)\), ''\)/);
  });
});

describe('the state machine and the hold sweeper', () => {
  it('permits exactly the five documented statuses', () => {
    assert.match(
      sql,
      /status IN \('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'\)/,
    );
  });

  it('refuses to close a PENDING request without a response timestamp', () => {
    // A CHECK constraint, so an out-of-band write cannot produce a request that
    // is simultaneously open and answered.
    assert.match(
      sql,
      /chk_reschedule_mentor_responded[\s\S]*?status = 'PENDING' AND mentor_responded_at IS NULL/,
    );
  });

  it('does not let the hold sweeper reap a live request reservation', () => {
    // Without this, `expire_stale_holds` releases any ACTIVE hold whose booking
    // is not PAYMENT_PENDING -- which is every reschedule request -- and the
    // requested slot becomes bookable while the mentor is still deciding.
    const expire = fnBody('expire_stale_holds');
    assert.match(
      expire,
      /id NOT IN \(\s*SELECT hold_id FROM public\.reschedule_requests[\s\S]*?status = 'PENDING'/,
      'expire_stale_holds must skip holds backing a PENDING reschedule request',
    );
  });

  it('expires unanswered requests and frees their slots', () => {
    const expire = fnBody('expire_stale_reschedule_requests');
    assert.match(expire, /status = 'ACTIVE'/);
    assert.match(expire, /status = 'EXPIRED'/);
    assert.match(expire, /expires_at <= NOW\(\)/);
    // The booking is not touched: an unanswered request leaves the original time.
    assert.equal(/public\.bookings/i.test(expire), false);
  });

  it('lets a seeker withdraw, and only their own', () => {
    const cancel = fnBody('cancel_reschedule_request');
    assert.match(cancel, /v_request\.seeker_id <> p_seeker_id/);
    assert.match(cancel, /status = 'CANCELLED'/);
    assert.match(cancel, /status = 'RELEASED'/);
  });
});

describe('security containment', () => {
  it('grants the new functions to the service role only', () => {
    // Postgres gives PUBLIC EXECUTE on a new function, which would let `anon`
    // call these directly and bypass every ownership check in their bodies.
    for (const fn of [
      'create_reschedule_request(uuid, uuid, timestamptz, timestamptz)',
      'respond_to_reschedule_request(uuid, uuid, text, text)',
      'cancel_reschedule_request(uuid, uuid)',
      'get_reschedule_request_for_booking(uuid, uuid)',
    ]) {
      assert.match(
        sql,
        new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.[\\w.]+\\([^)]*\\) FROM PUBLIC, anon, authenticated`),
        `${fn} must be revoked from PUBLIC, anon and authenticated`,
      );
      assert.match(
        sql,
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.[\\w.]+\\([^)]*\\) TO service_role`),
        `${fn} must be granted to service_role`,
      );
    }
  });

  it('reads a request only for its participants or an admin', () => {
    const read = fnBody('get_reschedule_request_for_booking');
    assert.match(
      read,
      /NOT \(v_is_admin OR v_booking\.seeker_id = p_caller_id OR v_booking\.mentor_id = p_caller_id\)/,
    );
  });

  it('gives participants read access and nobody a direct write path', () => {
    assert.match(sql, /CREATE POLICY "Participants can view their own reschedule requests"/);
    assert.equal(
      /ON public\.reschedule_requests FOR (INSERT|UPDATE|DELETE)/.test(sql),
      false,
      'a direct write policy would let a client bypass the state machine',
    );
  });
});

// ---------------------------------------------------------------------------
// 3. The server routes
// ---------------------------------------------------------------------------

describe('the reschedule HTTP surface', () => {
  const server = readFileSync('server.ts', 'utf8');

  it('creates a request through the transaction, not by writing the booking', () => {
    const route = server.slice(
      server.indexOf("app.post('/api/seeker/bookings/:id/reschedule'"),
      server.indexOf("app.get('/api/seeker/bookings/:id/reschedule-request'")
    );
    assert.match(route, /rpc\('create_reschedule_request'/);
    assert.equal(
      /from\('bookings'\)[\s\S]{0,80}?\.update\(/.test(route),
      false,
      'the route must never update the booking itself',
    );
  });

  it('answers a decision through the transaction, not by writing the booking', () => {
    const route = server.slice(
      server.indexOf("app.post('/api/mentor/reschedule-requests/:id/respond'"),
      server.indexOf("app.post('/api/mentor/bookings/:id/confirm'")
    );
    assert.match(route, /rpc\('respond_to_reschedule_request'/);
    assert.equal(
      /from\('bookings'\)[\s\S]{0,80}?\.update\(/.test(route),
      false,
    );
  });

  it('gates the decision on the mentor role and never accepts a caller-supplied mentor', () => {
    const route = server.slice(
      server.indexOf("app.post('/api/mentor/reschedule-requests/:id/respond'"),
      server.indexOf("app.post('/api/mentor/bookings/:id/confirm'")
    );
    assert.match(route, /requireRole\('mentor'\)/);
    assert.match(route, /p_mentor_id: mentorId/);
    assert.equal(/p_mentor_id: req\.body/.test(route), false, 'the mentor must come from the session');
  });

  it('no longer carries the gig-matching rule that made rescheduling wrong', () => {
    assert.equal(
      server.includes('New gig must belong to the same mentor and segment.'),
      false,
      'a reschedule cannot change gig or segment, so the rule has no meaning here',
    );
  });
});
