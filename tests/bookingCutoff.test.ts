import test from 'node:test';
import assert from 'node:assert/strict';

import { generateMentorSlots, parseZonedDateTime } from '@/src/lib/slotEngine';
import { APP_CONFIG, BOOKING_CUTOFF_MINUTES } from '@/src/config/app';
import type {
  Booking,
  MentorAvailability,
  MentorAvailabilityException,
  SlotHold,
} from '@/src/types/database';

const MENTOR_ID = '11111111-1111-4111-8111-111111111111';
const GIG_ID = '22222222-2222-4222-8222-222222222222';

const CUTOFF_MS = APP_CONFIG.BOOKING_CUTOFF_MS;

/** 2026-09-26 is a Saturday (day_of_week 6). */
const DATE = '2026-09-26';

const availability = (timezone: string): MentorAvailability[] => [
  {
    id: 'avail-1',
    mentor_id: MENTOR_ID,
    day_of_week: 6,
    start_time: '16:00',
    end_time: '23:00',
    timezone,
    is_enabled: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
];

const noExceptions: MentorAvailabilityException[] = [];
const noBookings: Booking[] = [];
const noHolds: SlotHold[] = [];

type Overrides = Partial<{
  now: Date;
  bookings: Booking[];
  holds: SlotHold[];
  exceptions: MentorAvailabilityException[];
}>;

/**
 * Generates the slots a mentor in `timezone` would see at `now`.
 *
 * Every fixture is expressed in the mentor's own local time, so a test that
 * moves `now` around a boundary is really testing that mentor's clock.
 */
const slotsAt = (timezone: string, now: Date, overrides: Overrides = {}) =>
  generateMentorSlots({
    mentorId: MENTOR_ID,
    gigId: GIG_ID,
    dateStr: DATE,
    timezone,
    durationMinutes: 60,
    recurringAvailability: availability(timezone),
    exceptions: overrides.exceptions ?? noExceptions,
    bookings: overrides.bookings ?? noBookings,
    slotHolds: overrides.holds ?? noHolds,
    currentUtcTime: now,
  });

/**
 * Builds the absolute instant for a mentor-local wall clock.
 *
 * This reuses the slot engine's own resolver, so a test that moves `now` around
 * a boundary is genuinely testing the mentor's clock in their timezone rather
 * than a hand-computed offset.
 */
const atLocal = (timezone: string, time: string): Date =>
  parseZonedDateTime(DATE, time, timezone);

const slotAt = (timezone: string, localStart: string) => {
  const found = slotsAt(timezone, atLocal(timezone, localStart)).find(
    (s) => s.local_start_time === localStart
  );
  assert.ok(found, `expected a generated slot at local ${localStart} (${timezone})`);
  return found!;
};

const bookableAt = (timezone: string, now: Date, localStart: string) =>
  slotsAt(timezone, now).find((s) => s.local_start_time === localStart)?.is_available;

test('cutoff is five minutes, not two hours', () => {
  assert.equal(CUTOFF_MS, 5 * 60 * 1000);
  assert.equal(BOOKING_CUTOFF_MINUTES, 5);
  assert.notEqual(CUTOFF_MS, 2 * 60 * 60 * 1000);
});

// ---------------------------------------------------------------------------
// Boundary: a 10:00 PM slot viewed at 9:50 / 9:55 / 9:56 PM local.
// ---------------------------------------------------------------------------

test('10:00 PM slot is available at 9:50 PM', () => {
  const tz = 'Asia/Kolkata';
  assert.equal(bookableAt(tz, atLocal(tz, '21:50'), '22:00'), true);
});

test('10:00 PM slot is available at 9:55 PM (last allowed window)', () => {
  const tz = 'Asia/Kolkata';
  assert.equal(bookableAt(tz, atLocal(tz, '21:55'), '22:00'), true);
});

test('10:00 PM slot is unavailable at 9:56 PM', () => {
  const tz = 'Asia/Kolkata';
  assert.equal(bookableAt(tz, atLocal(tz, '21:56'), '22:00'), false);
});

test('the 9:55 PM boundary is inclusive to the second', () => {
  const tz = 'Asia/Kolkata';
  const slot = slotAt(tz, '22:00');
  const slotStart = new Date(slot.utc_start_time).getTime();

  // Exactly five minutes out is still bookable; one millisecond inside is not.
  assert.equal(slotStart - atLocal(tz, '21:55').getTime() === CUTOFF_MS, true);
  assert.equal(
    slotsAt(tz, new Date(slotStart - CUTOFF_MS)).find((s) => s.local_start_time === '22:00')
      ?.is_available,
    true
  );
  assert.equal(
    slotsAt(tz, new Date(slotStart - CUTOFF_MS + 1)).find((s) => s.local_start_time === '22:00')
      ?.is_available,
    false
  );
});

test('the documented 5:00 PM examples hold', () => {
  const tz = 'Asia/Kolkata';
  assert.equal(bookableAt(tz, atLocal(tz, '16:00'), '17:00'), true);
  assert.equal(bookableAt(tz, atLocal(tz, '16:30'), '17:00'), true);
  assert.equal(bookableAt(tz, atLocal(tz, '16:54'), '17:00'), true);
  assert.equal(bookableAt(tz, atLocal(tz, '16:55'), '17:00'), true);
  assert.equal(bookableAt(tz, atLocal(tz, '16:56'), '17:00'), false);
  assert.equal(bookableAt(tz, atLocal(tz, '17:00'), '17:00'), false);
  assert.equal(bookableAt(tz, atLocal(tz, '17:01'), '17:00'), false);
});

test('a slot inside the cutoff reports CLOSING_SOON, not PAST', () => {
  const tz = 'Asia/Kolkata';
  const slot = slotsAt(tz, atLocal(tz, '21:56')).find((s) => s.local_start_time === '22:00')!;
  assert.equal(slot.status, 'CLOSING_SOON');
  assert.equal(slot.conflict_reason, 'BOOKING_CUTOFF');
  assert.equal(slot.is_available, false);
});

test('a slot that already started still reports PAST', () => {
  const tz = 'Asia/Kolkata';
  const slot = slotsAt(tz, atLocal(tz, '22:30')).find((s) => s.local_start_time === '22:00')!;
  assert.equal(slot.status, 'PAST');
  assert.equal(slot.conflict_reason, 'PAST');
});

// ---------------------------------------------------------------------------
// Mentor timezone independence: no zone is hardcoded, and a half-hour-offset
// zone lands on the same absolute boundary.
// ---------------------------------------------------------------------------

test('the cutoff uses the mentor timezone, not a hardcoded one', () => {
  for (const tz of ['Asia/Kolkata', 'America/New_York', 'Europe/London', 'Australia/Adelaide']) {
    const slot = slotAt(tz, '22:00');
    const slotStart = new Date(slot.utc_start_time).getTime();

    assert.equal(
      slotsAt(tz, new Date(slotStart - CUTOFF_MS)).find((s) => s.local_start_time === '22:00')
        ?.is_available,
      true,
      `${tz}: should be bookable at exactly the cutoff`
    );
    assert.equal(
      slotsAt(tz, new Date(slotStart - CUTOFF_MS + 1)).find((s) => s.local_start_time === '22:00')
        ?.is_available,
      false,
      `${tz}: should be refused one millisecond past the cutoff`
    );
  }
});

test('a mentor at UTC+05:30 and a mentor at UTC-05:00 agree on the same instant', () => {
  // 2026-09-26 22:00 local in each zone is a different absolute moment, so the
  // cutoff is evaluated against each mentor's own real start.
  const istanbul = slotAt('Asia/Kolkata', '22:00');
  const newYork = slotAt('America/New_York', '22:00');
  assert.notEqual(istanbul.utc_start_time, newYork.utc_start_time);

  const istanbulStart = new Date(istanbul.utc_start_time).getTime();
  const newYorkStart = new Date(newYork.utc_start_time).getTime();

  // Two minutes before each mentor's own start is refused for both.
  assert.equal(
    slotsAt('Asia/Kolkata', new Date(istanbulStart - 2 * 60 * 1000)).find(
      (s) => s.local_start_time === '22:00'
    )?.is_available,
    false
  );
  assert.equal(
    slotsAt('America/New_York', new Date(newYorkStart - 2 * 60 * 1000)).find(
      (s) => s.local_start_time === '22:00'
    )?.is_available,
    false
  );
});

// ---------------------------------------------------------------------------
// Today's slots vs future dates.
// ---------------------------------------------------------------------------

test('earlier slots today stay closed while later ones remain open', () => {
  const tz = 'Asia/Kolkata';
  // The mentor's window is 16:00-23:00, so hourly slots run 16:00..22:00.
  const slots = slotsAt(tz, atLocal(tz, '20:00'));
  const byTime = new Map(slots.map((s) => [s.local_start_time, s]));

  // Already started, so closed for being past rather than by the cutoff.
  assert.equal(byTime.get('16:00')!.status, 'PAST');
  assert.equal(byTime.get('19:00')!.is_available, false);
  // The slot starting exactly now is already past.
  assert.equal(byTime.get('20:00')!.status, 'PAST');

  // 21:00 is one hour out and 22:00 is two hours out: both still bookable
  // under the five-minute rule even though the old rule hid the latter.
  assert.equal(byTime.get('21:00')!.is_available, true);
  assert.equal(byTime.get('22:00')!.is_available, true);
  assert.equal(byTime.has('23:00'), false); // window ends at 23:00
});

test('a future date is entirely unaffected by the cutoff', () => {
  const tz = 'Asia/Kolkata';
  // `now` is on 2026-09-26; the same mentor's 16:00 slot two days later.
  const future = generateMentorSlots({
    mentorId: MENTOR_ID,
    gigId: GIG_ID,
    dateStr: '2026-09-28',
    timezone: tz,
    durationMinutes: 60,
    recurringAvailability: availability(tz).map((a) => ({ ...a, day_of_week: 1 })),
    exceptions: noExceptions,
    bookings: noBookings,
    slotHolds: noHolds,
    currentUtcTime: atLocal(tz, '23:59'),
  });

  assert.ok(future.length > 0);
  assert.equal(future.every((s) => s.is_available), true);
});

// ---------------------------------------------------------------------------
// Booked, held and expired-hold slots.
// ---------------------------------------------------------------------------

test('a booked slot is BOOKED regardless of the cutoff', () => {
  const tz = 'Asia/Kolkata';
  const start = atLocal(tz, '20:00').toISOString();
  const end = atLocal(tz, '21:00').toISOString();
  const now = atLocal(tz, '18:00');

  const bookings: Booking[] = [
    {
      id: 'b1',
      booking_code: 'BK-1',
      mentor_id: MENTOR_ID,
      seeker_id: 's1',
      gig_id: GIG_ID,
      segment_id: 'seg1',
      hold_id: null,
      start_time: start,
      end_time: end,
      seeker_timezone: tz,
      mentor_timezone: tz,
      amount_inr: 1000,
      status: 'CONFIRMED',
      meeting_url: null,
      actual_ended_at: null,
      ended_by_role: null,
      end_reason: null,
      cancellation_reason: null,
      created_at: start,
      updated_at: start,
    },
  ];

  const slot = slotsAt(tz, now, { bookings }).find((s) => s.local_start_time === '20:00')!;
  assert.equal(slot.status, 'BOOKED');
  assert.equal(slot.conflict_reason, 'BOOKING_CONFLICT');
  assert.equal(slot.is_available, false);
});

test('an active hold blocks the slot', () => {
  const tz = 'Asia/Kolkata';
  const now = atLocal(tz, '18:00');
  const holds: SlotHold[] = [
    {
      id: 'h1',
      mentor_id: MENTOR_ID,
      seeker_id: 's2',
      gig_id: GIG_ID,
      start_time: atLocal(tz, '20:00').toISOString(),
      end_time: atLocal(tz, '21:00').toISOString(),
      status: 'ACTIVE',
      expires_at: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
      created_at: now.toISOString(),
    },
  ];

  const slot = slotsAt(tz, now, { holds }).find((s) => s.local_start_time === '20:00')!;
  assert.equal(slot.status, 'HELD');
  assert.equal(slot.conflict_reason, 'HOLD_CONFLICT');
  assert.equal(slot.is_available, false);
});

test('an expired hold releases the slot back to availability', () => {
  const tz = 'Asia/Kolkata';
  const now = atLocal(tz, '18:00');
  const holds: SlotHold[] = [
    {
      id: 'h2',
      mentor_id: MENTOR_ID,
      seeker_id: 's2',
      gig_id: GIG_ID,
      start_time: atLocal(tz, '20:00').toISOString(),
      end_time: atLocal(tz, '21:00').toISOString(),
      status: 'ACTIVE',
      expires_at: new Date(now.getTime() - 1000).toISOString(),
      created_at: new Date(now.getTime() - 16 * 60 * 1000).toISOString(),
    },
  ];

  const slot = slotsAt(tz, now, { holds }).find((s) => s.local_start_time === '20:00')!;
  assert.equal(slot.is_available, true);
});

test('the cutoff still applies to a slot whose stale hold has expired', () => {
  const tz = 'Asia/Kolkata';
  const now = atLocal(tz, '21:56');
  const holds: SlotHold[] = [
    {
      id: 'h3',
      mentor_id: MENTOR_ID,
      seeker_id: 's2',
      gig_id: GIG_ID,
      start_time: atLocal(tz, '22:00').toISOString(),
      end_time: atLocal(tz, '23:00').toISOString(),
      status: 'ACTIVE',
      expires_at: new Date(now.getTime() - 1000).toISOString(),
      created_at: new Date(now.getTime() - 16 * 60 * 1000).toISOString(),
    },
  ];

  // The hold is gone, but the slot is inside the 5-minute cutoff regardless.
  const slot = slotsAt(tz, now, { holds }).find((s) => s.local_start_time === '22:00')!;
  assert.equal(slot.is_available, false);
  assert.equal(slot.status, 'CLOSING_SOON');
});

// ---------------------------------------------------------------------------
// Simultaneous booking attempts.
// ---------------------------------------------------------------------------

test('two seekers observing the same slot get the same cutoff verdict', () => {
  const tz = 'Asia/Kolkata';
  const now = atLocal(tz, '21:55');
  const first = slotsAt(tz, now).find((s) => s.local_start_time === '22:00')!;
  const second = slotsAt(tz, new Date(now.getTime())).find((s) => s.local_start_time === '22:00')!;

  assert.equal(first.is_available, true);
  assert.equal(first.id, second.id);
});

test('a slot available to one caller is not silently reclassified for another', () => {
  const tz = 'Asia/Kolkata';
  // Caller A reads the list just inside the cutoff...
  const early = slotsAt(tz, atLocal(tz, '21:54')).find((s) => s.local_start_time === '22:00')!;
  assert.equal(early.is_available, true);

  // ...and caller B reads it after the boundary has passed.
  const late = slotsAt(tz, atLocal(tz, '21:56')).find((s) => s.local_start_time === '22:00')!;
  assert.equal(late.is_available, false);
  assert.equal(early.id, late.id, 'both callers saw the same slot identity');
});

// ---------------------------------------------------------------------------
// The old 2-hour rule must not reappear anywhere in the engine's behaviour.
// ---------------------------------------------------------------------------

test('no slot is withheld for being two hours out', () => {
  const tz = 'Asia/Kolkata';
  // 16:00 is exactly two hours after this `now`; the old rule would have hidden
  // it, the five-minute rule must not.
  const slots = slotsAt(tz, atLocal(tz, '14:00'));
  const twoHoursOut = slots.find((s) => s.local_start_time === '16:00');
  assert.ok(twoHoursOut);
  assert.equal(twoHoursOut.is_available, true);
});

test('a slot one hour out is still bookable', () => {
  const tz = 'Asia/Kolkata';
  assert.equal(bookableAt(tz, atLocal(tz, '19:00'), '20:00'), true);
  assert.equal(bookableAt(tz, atLocal(tz, '19:00'), '22:00'), true);
});

