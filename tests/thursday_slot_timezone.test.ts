import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateMentorSlots,
  getDayOfWeekFromDateString,
  getWeekdayShort,
  getDateStringInTimezone,
  parseZonedDateTime,
  formatTimeInTimezone,
  formatLocalTimeLabel,
  timeStringToMinutes,
} from '../src/lib/slotEngine';
import { DAYS_OF_WEEK } from '../src/config/app';
import { apiSchemas } from '../src/lib/validation';
import type { MentorAvailability, Booking } from '../src/types/database';

/**
 * Regression cover for the reported mismatch: the mentor's Thursday schedule
 * (Asia/Kolkata) did not correspond to the slots the seeker was shown for
 * 2026-10-01.
 *
 * The failure was NOT a weekday or timezone bug — both are correct and are
 * pinned below. It was a corrupt `mentor_availability` row: Thursday's first
 * window was stored as 01:10 -> 13:15 (a 12h05m block) instead of the intended
 * 13:10 -> 13:15. Slot generation faithfully expanded that oversized window
 * into twelve 60-minute slots beginning 01:10 IST, which the seeker saw as
 * "2:10 AM ..." because the 01:10 slot was already past.
 */
const MENTOR_ID = 'a8222dcd-6124-4ade-9c2a-8d226d16e632';
const THURSDAY_DATE = '2026-10-01';
const TZ = 'Asia/Kolkata';

/** Well before the date under test, so nothing is filtered as PAST. */
const BEFORE = new Date('2026-09-30T00:00:00.000Z');

/** The four windows as the mentor's availability page displays them. */
const thursdayWindows: Array<[string, string]> = [
  ['13:10', '13:15'],
  ['13:15', '13:30'],
  ['13:40', '13:50'],
  ['14:20', '15:20'],
];

const rule = (dayOfWeek: number, start: string, end: string): MentorAvailability => ({
  id: `avail-${dayOfWeek}-${start}`,
  mentor_id: MENTOR_ID,
  day_of_week: dayOfWeek,
  start_time: `${start}:00`,
  end_time: `${end}:00`,
  timezone: TZ,
  is_enabled: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

const thursdayRules = thursdayWindows.map(([s, e]) => rule(4, s, e));

const generate = (overrides: Partial<Parameters<typeof generateMentorSlots>[0]> = {}) =>
  generateMentorSlots({
    mentorId: MENTOR_ID,
    gigId: '8c8bf8a1-8a02-4a36-82a4-3328e86cb696',
    dateStr: THURSDAY_DATE,
    timezone: TZ,
    durationMinutes: 60,
    recurringAvailability: thursdayRules,
    exceptions: [],
    bookings: [],
    slotHolds: [],
    currentUtcTime: BEFORE,
    ...overrides,
  });

describe('Thursday 2026-10-01: weekday resolution', () => {
  it('A. 2026-10-01 is Thursday in Asia/Kolkata', () => {
    // Noon-UTC is safe for every IANA offset, so this holds for IST too.
    assert.equal(getDayOfWeekFromDateString(THURSDAY_DATE), 4);
    assert.equal(getWeekdayShort(THURSDAY_DATE), 'Thu');

    // Confirm the same instant reads as Thursday inside the mentor's timezone.
    const instant = parseZonedDateTime(THURSDAY_DATE, '12:00', TZ);
    assert.equal(
      new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long' }).format(instant),
      'Thursday'
    );
    // The calendar date must not roll over into Wed or Fri under IST.
    assert.equal(getDateStringInTimezone(instant, TZ), THURSDAY_DATE);
  });

  it('B. day 4 is Thursday, matching the stored day_of_week convention', () => {
    // The DB column is smallint 0=Sun..6=Sat and JS getDay() agrees, so the
    // whole week maps 1:1 with no off-by-one.
    const expected = [
      'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
    ];
    for (let i = 0; i < 7; i++) {
      assert.equal(DAYS_OF_WEEK[i].index, i);
      assert.equal(DAYS_OF_WEEK[i].name, expected[i]);
    }
    assert.equal(DAYS_OF_WEEK[4].name, 'Thursday');
  });

  it('B. Thursday rules are selected; Wednesday and Friday rules are ignored', () => {
    // Same mentor, a distinct window on each neighbouring day. Only the
    // Thursday windows may produce slots for a Thursday.
    const mixed = [
      rule(3, '09:00', '11:00'), // Wednesday
      ...thursdayRules,
      rule(5, '16:00', '18:00'), // Friday
    ];

    const slots = generate({ recurringAvailability: mixed });
    assert.deepEqual(
      slots.map((s) => s.local_start_time),
      ['14:20']
    );
    // A different date resolves to a different stored day: Wednesday picks up
    // only the Wednesday window, and never a Thursday or Friday one.
    const wednesday = generateMentorSlots({
      mentorId: MENTOR_ID,
      gigId: 'g',
      dateStr: '2026-09-30', // Wednesday
      timezone: TZ,
      durationMinutes: 60,
      recurringAvailability: mixed,
      exceptions: [],
      bookings: [],
      slotHolds: [],
      currentUtcTime: BEFORE,
    });
    assert.deepEqual(
      wednesday.map((s) => s.local_start_time),
      ['09:00', '10:00']
    );

    // Saturday has no rules at all.
    assert.equal(
      generateMentorSlots({
        mentorId: MENTOR_ID,
        gigId: 'g',
        dateStr: '2026-10-03', // Saturday
        timezone: TZ,
        durationMinutes: 60,
        recurringAvailability: mixed,
        exceptions: [],
        bookings: [],
        slotHolds: [],
        currentUtcTime: BEFORE,
      }).length,
      0
    );
  });
});

describe('Thursday 2026-10-01: window validation for a 60-minute session', () => {
  it('C. a 01:10 PM -> 01:15 PM window cannot produce a 60-minute slot', () => {
    assert.equal(generate({ recurringAvailability: [rule(4, '13:10', '13:15')] }).length, 0);
  });

  it('D. a 01:15 PM -> 01:30 PM window cannot produce a 60-minute slot', () => {
    assert.equal(generate({ recurringAvailability: [rule(4, '13:15', '13:30')] }).length, 0);
  });

  it('E. a 01:40 PM -> 01:50 PM window cannot produce a 60-minute slot', () => {
    assert.equal(generate({ recurringAvailability: [rule(4, '13:40', '13:50')] }).length, 0);
  });

  it('F. a 02:20 PM -> 03:20 PM window produces exactly one 60-minute slot', () => {
    const slots = generate({ recurringAvailability: [rule(4, '14:20', '15:20')] });

    assert.equal(slots.length, 1);
    assert.equal(slots[0].local_start_time, '14:20');
    assert.equal(slots[0].local_end_time, '15:20');
    assert.equal(slots[0].duration_minutes, 60);
    assert.equal(slots[0].status, 'AVAILABLE');
  });

  it('F. no generated slot ever runs past the end of its own window', () => {
    for (const [start, end] of thursdayWindows) {
      for (const slot of generate({ recurringAvailability: [rule(4, start, end)] })) {
        assert.ok(
          timeStringToMinutes(slot.local_end_time) <= timeStringToMinutes(end),
          `slot ${slot.local_start_time}-${slot.local_end_time} exceeds window ${start}-${end}`
        );
        assert.equal(
          timeStringToMinutes(slot.local_end_time) - timeStringToMinutes(slot.local_start_time),
          60
        );
      }
    }
  });

  it('the four Thursday windows together yield only the 02:20 PM slot', () => {
    const slots = generate();
    assert.deepEqual(slots.map((s) => `${s.local_start_time}-${s.local_end_time}`), ['14:20-15:20']);
  });
});

describe('Thursday 2026-10-01: no phantom early-morning slot', () => {
  it('G. no 2:10 AM (or any 02:xx) slot comes from these Thursday windows', () => {
    const slots = generate();
    for (const slot of slots) {
      assert.notEqual(formatLocalTimeLabel(slot.local_start_time), '2:10 AM');
      assert.ok(
        timeStringToMinutes(slot.local_start_time) >= timeStringToMinutes('14:20'),
        `unexpected early slot ${slot.local_start_time}`
      );
    }
    assert.equal(slots.filter((s) => s.local_start_time.startsWith('02:')).length, 0);
  });

  it('G. the reported corrupt row is what produced the 2:10 AM slot, and is not a code path', () => {
    // Documents the production defect precisely: 01:10 -> 13:15 is a 12h05m
    // window, so a faithful engine yields twelve 60-minute slots from 01:10.
    // The engine is right; the stored row was wrong.
    const corrupt = generate({ recurringAvailability: [rule(4, '01:10', '13:15')] });
    assert.equal(corrupt.length, 12);
    assert.equal(corrupt[0].local_start_time, '01:10');
    assert.equal(corrupt[1].local_start_time, '02:10');
  });
});

describe('Thursday 2026-10-01: no UTC/IST double conversion', () => {
  it('H. local mentor times resolve to the correct UTC instants', () => {
    // 14:20 IST = 08:50 UTC (IST is UTC+5:30, no DST).
    const slot = generate()[0];
    assert.equal(slot.utc_start_time, '2026-10-01T08:50:00.000Z');
    assert.equal(slot.utc_end_time, '2026-10-01T09:50:00.000Z');
  });

  it('H. round-tripping local -> UTC -> local is lossless', () => {
    for (const [start, end] of thursdayWindows) {
      for (const local of [start, end]) {
        const instant = parseZonedDateTime(THURSDAY_DATE, local, TZ);
        assert.equal(
          formatTimeInTimezone(instant, TZ, { hour12: false }),
          local,
          `${local} did not round-trip`
        );
      }
    }
  });

  it('H. a 5h30m shift is never applied', () => {
    // The IST offset is exactly -5:30 from UTC (local clock is ahead). A double
    // conversion would give 0, or -11:00, instead.
    const instant = parseZonedDateTime(THURSDAY_DATE, '14:20', TZ);
    const offsetMinutes = (instant.getTime() - Date.UTC(2026, 9, 1, 14, 20)) / 60000;
    assert.equal(offsetMinutes, -330);
    assert.equal(instant.toISOString(), '2026-10-01T08:50:00.000Z');
  });

  it('H. the slot is labelled in the mentor timezone, not the browser timezone', () => {
    const slot = generate()[0];
    assert.equal(slot.timezone, TZ);
    assert.equal(formatLocalTimeLabel(slot.local_start_time), '2:20 PM');
    assert.equal(
      formatTimeInTimezone(slot.utc_start_time, TZ, { hour12: false }),
      '14:20'
    );
  });
});

describe('Thursday 2026-10-01: the 12-hour window typo is rejected at the boundary', () => {
  // The production defect was a stored 01:10 -> 13:15 row. The engine cannot
  // tell a deliberate 12-hour window from a clock mix-up, so the write path
  // refuses one outright rather than silently booking the mentor all day.
  const parse = apiSchemas.availability.safeParse;

  it('rejects the exact corrupt shape: 01:10 -> 13:15', () => {
    const result = parse({
      rules: [{ dayOfWeek: 4, startTime: '01:10', endTime: '13:15' }],
      timezone: TZ,
    });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.match(result.error.issues[0].message, /12 hours or longer/);
    }
  });

  it('still accepts the four intended Thursday windows', () => {
    const result = parse({
      rules: thursdayWindows.map(([startTime, endTime]) => ({ dayOfWeek: 4, startTime, endTime })),
      timezone: TZ,
    });
    assert.equal(result.success, true, JSON.stringify(result.success ? {} : result.error.issues));
  });

  it('rejects a 24-hour window and a 12:00 -> 23:59 window is fine', () => {
    assert.equal(
      parse({ rules: [{ dayOfWeek: 4, startTime: '00:00', endTime: '12:00' }], timezone: TZ }).success,
      false
    );
    assert.equal(
      parse({ rules: [{ dayOfWeek: 4, startTime: '12:00', endTime: '23:59' }], timezone: TZ }).success,
      true
    );
  });

  it('applies the same rule to date exceptions', () => {
    assert.equal(
      apiSchemas.availabilityExceptions.safeParse({
        exceptions: [
          {
            exceptionDate: THURSDAY_DATE,
            isAvailable: true,
            startTime: '01:10',
            endTime: '13:15',
          },
        ],
      }).success,
      false
    );
  });

  it('leaves unavailable exceptions and short windows alone', () => {
    assert.equal(
      apiSchemas.availabilityExceptions.safeParse({
        exceptions: [{ exceptionDate: THURSDAY_DATE, isAvailable: false }],
      }).success,
      true
    );
    assert.equal(
      parse({ rules: [{ dayOfWeek: 4, startTime: '09:00', endTime: '17:00' }], timezone: TZ }).success,
      true
    );
  });
});

describe('Thursday 2026-10-01: existing invariants still hold', () => {
  const booked: Booking = {
    id: 'bk-1',
    booking_code: 'BK-1',
    mentor_id: MENTOR_ID,
    seeker_id: 'someone-else',
    gig_id: 'other-gig-in-another-segment',
    segment_id: 'other-segment',
    hold_id: null,
    start_time: '2026-10-01T08:50:00.000Z', // 14:20 IST
    end_time: '2026-10-01T09:50:00.000Z', // 15:20 IST
    seeker_timezone: TZ,
    mentor_timezone: TZ,
    amount_inr: 1299,
    status: 'CONFIRMED',
    meeting_url: null,
    actual_ended_at: null,
    ended_by_role: null,
    end_reason: null,
    cancellation_reason: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  it('I. a booking on another gig/segment still blocks the mentor-wide slot', () => {
    const slots = generate({ bookings: [booked] });
    assert.equal(slots.length, 1);
    assert.equal(slots[0].status, 'BOOKED');
    assert.equal(slots[0].conflict_reason, 'BOOKING_CONFLICT');
    assert.equal(slots[0].is_available, false);
  });

  it('I. a cancelled booking does not block anything', () => {
    const slots = generate({ bookings: [{ ...booked, status: 'CANCELLED' }] });
    assert.equal(slots[0].status, 'AVAILABLE');
  });

  it('J. the gig id and duration passed in are echoed, never re-resolved', () => {
    const slots = generate({ gigId: 'gig-autism-60', durationMinutes: 60 });
    assert.equal(slots[0].gig_id, 'gig-autism-60');
    assert.equal(slots[0].mentor_id, MENTOR_ID);
    assert.equal(slots[0].date, THURSDAY_DATE);
  });

  it('J. a different gig duration changes the grid but not the window bounds', () => {
    // 30-minute sessions fit inside 14:20-15:20 twice; the 5- and 10-minute
    // windows still yield nothing, and nothing starts before 14:20.
    const slots = generate({ durationMinutes: 30 });
    assert.deepEqual(
      slots.map((s) => `${s.local_start_time}-${s.local_end_time}`),
      ['14:20-14:50', '14:50-15:20']
    );
  });

  it('J. a date exception still overrides the weekly Thursday rule', () => {
    const slots = generate({
      recurringAvailability: [],
      exceptions: [
        {
          id: 'exc-1',
          mentor_id: MENTOR_ID,
          exception_date: THURSDAY_DATE,
          is_available: true,
          start_time: '09:00:00',
          end_time: '10:00:00',
          reason: 'workshop',
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
    });
    assert.deepEqual(slots.map((s) => s.local_start_time), ['09:00']);
    assert.equal(slots[0].utc_start_time, '2026-10-01T03:30:00.000Z');
  });

  it('an unavailable exception yields no slots at all', () => {
    assert.equal(
      generate({
        exceptions: [
          {
            id: 'exc-2',
            mentor_id: MENTOR_ID,
            exception_date: THURSDAY_DATE,
            is_available: false,
            start_time: null,
            end_time: null,
            reason: 'holiday',
            created_at: '2026-01-01T00:00:00Z',
          },
        ],
      }).length,
      0
    );
  });
});
