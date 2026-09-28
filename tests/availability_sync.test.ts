import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateMentorSlots,
  parseZonedDateTime,
  getDateStringInTimezone,
  addDaysToDateString,
} from '../src/lib/slotEngine';
import {
  MentorAvailability,
  MentorAvailabilityException,
  Booking,
  SlotHold,
} from '../src/types/database';

const IST = 'Asia/Kolkata';

const window = (
  mentorId: string,
  dayOfWeek: number,
  start: string,
  end: string
): MentorAvailability => ({
  id: `avail-${mentorId}-${dayOfWeek}-${start}`,
  mentor_id: mentorId,
  day_of_week: dayOfWeek,
  start_time: `${start}:00`,
  end_time: `${end}:00`,
  timezone: IST,
  is_enabled: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

const exception = (
  mentorId: string,
  date: string,
  isAvailable: boolean,
  start: string | null,
  end: string | null
): MentorAvailabilityException => ({
  id: `exc-${mentorId}-${date}`,
  mentor_id: mentorId,
  exception_date: date,
  is_available: isAvailable,
  start_time: start ? `${start}:00` : null,
  end_time: end ? `${end}:00` : null,
  reason: null,
  created_at: '2026-01-01T00:00:00Z',
});

const booking = (mentorId: string, startIso: string, endIso: string): Booking => ({
  id: `bk-${startIso}`,
  booking_code: 'BK-TEST',
  mentor_id: mentorId,
  seeker_id: 'seeker-x',
  gig_id: 'gig-x',
  segment_id: 'seg-x',
  hold_id: null,
  start_time: startIso,
  end_time: endIso,
  seeker_timezone: IST,
  mentor_timezone: IST,
  amount_inr: 500,
  status: 'CONFIRMED',
  meeting_url: null,
  actual_ended_at: null,
  ended_by_role: null,
  end_reason: null,
  cancellation_reason: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

const hold = (mentorId: string, startIso: string, endIso: string, expiresIso: string): SlotHold => ({
  id: `hold-${startIso}`,
  mentor_id: mentorId,
  seeker_id: 'seeker-y',
  gig_id: 'gig-x',
  start_time: startIso,
  end_time: endIso,
  created_at: '2026-01-01T00:00:00Z',
  expires_at: expiresIso,
  status: 'ACTIVE',
});

describe('Authoritative slot engine â€” live schedule, exceptions, reservations', () => {
  // --------------------------------------------------------------------------
  // Gig duration must come from the active gig, never from a constant.
  // --------------------------------------------------------------------------
  describe('Gig duration drives slot generation', () => {
    const saturday = window('m1', 6, '10:00', '13:00'); // 3 hours

    it('produces 60-minute sessions for a 3-hour window when the gig is 60 minutes', () => {
      const slots = generateMentorSlots({
        mentorId: 'm1',
        gigId: 'g1',
        dateStr: '2026-10-03',
        timezone: IST,
        durationMinutes: 60,
        recurringAvailability: [saturday],
        exceptions: [],
        bookings: [],
        slotHolds: [],
        currentUtcTime: new Date('2026-09-26T00:00:00Z'),
      });

      assert.equal(slots.length, 3);
      assert.deepEqual(
        slots.map((s) => s.local_start_time),
        ['10:00', '11:00', '12:00']
      );
      assert.equal(slots[0].duration_minutes, 60);
    });

    it('adapts automatically when the same window is sold as a 45-minute session', () => {
      const slots = generateMentorSlots({
        mentorId: 'm1',
        gigId: 'g2',
        dateStr: '2026-10-03',
        timezone: IST,
        durationMinutes: 45,
        recurringAvailability: [saturday],
        exceptions: [],
        bookings: [],
        slotHolds: [],
        currentUtcTime: new Date('2026-09-26T00:00:00Z'),
      });

      assert.equal(slots.length, 4);
      assert.deepEqual(
        slots.map((s) => s.local_start_time),
        ['10:00', '10:45', '11:30', '12:15']
      );
    });

    it('yields no candidate at all when the window is shorter than the session', () => {
      // 15:45-15:50 cannot host a 60-minute session and must not be padded.
      const tiny = window('m1', 6, '15:45', '15:50');
      const slots = generateMentorSlots({
        mentorId: 'm1',
        gigId: 'g1',
        dateStr: '2026-10-03',
        timezone: IST,
        durationMinutes: 60,
        recurringAvailability: [tiny],
        exceptions: [],
        bookings: [],
        slotHolds: [],
        currentUtcTime: new Date('2026-09-26T00:00:00Z'),
      });

      assert.equal(slots.length, 0);
    });
  });

  // --------------------------------------------------------------------------
  // A date exception is authoritative for that date and never merges with the
  // recurring schedule.
  // --------------------------------------------------------------------------
  describe('Date exceptions are authoritative, not additive', () => {
    it('replaces the recurring Saturday windows with the exception window only', () => {
      const slots = generateMentorSlots({
        mentorId: 'm1',
        gigId: 'g1',
        dateStr: '2026-10-03',
        timezone: IST,
        durationMinutes: 60,
        recurringAvailability: [
          window('m1', 6, '10:00', '11:00'),
          window('m1', 6, '11:30', '12:30'),
          window('m1', 6, '14:00', '16:00'),
        ],
        exceptions: [exception('m1', '2026-10-03', true, '19:00', '21:00')],
        bookings: [],
        slotHolds: [],
        currentUtcTime: new Date('2026-09-26T00:00:00Z'),
      });

      // Only the exception hours survive: 10:00, 11:30 and 14:00 are NOT merged in.
      assert.equal(slots.length, 2);
      assert.deepEqual(
        slots.map((s) => s.local_start_time),
        ['19:00', '20:00']
      );
    });

    it('removes every slot when the exception marks the date unavailable', () => {
      const slots = generateMentorSlots({
        mentorId: 'm1',
        gigId: 'g1',
        dateStr: '2026-10-03',
        timezone: IST,
        durationMinutes: 60,
        recurringAvailability: [window('m1', 6, '10:00', '18:00')],
        exceptions: [exception('m1', '2026-10-03', false, null, null)],
        bookings: [],
        slotHolds: [],
        currentUtcTime: new Date('2026-09-26T00:00:00Z'),
      });

      assert.equal(slots.length, 0);
    });

    it('applies an exception to one mentor only', () => {
      const slots = generateMentorSlots({
        mentorId: 'm2',
        gigId: 'g1',
        dateStr: '2026-10-03',
        timezone: IST,
        durationMinutes: 60,
        recurringAvailability: [window('m2', 6, '10:00', '12:00')],
        exceptions: [exception('m1', '2026-10-03', false, null, null)],
        bookings: [],
        slotHolds: [],
        currentUtcTime: new Date('2026-09-26T00:00:00Z'),
      });

      assert.equal(slots.length, 2);
    });
  });

  // --------------------------------------------------------------------------
  // Past filtering must be correct for today AND for future dates.
  // --------------------------------------------------------------------------
  describe('Past-slot filtering', () => {
    const saturday = window('m1', 6, '10:00', '18:00');

    it('drops only the slots that already started for today, in mentor local time', () => {
      // 2026-10-03 15:18 IST == 09:48 UTC
      const slots = generateMentorSlots({
        mentorId: 'm1',
        gigId: 'g1',
        dateStr: '2026-10-03',
        timezone: IST,
        durationMinutes: 60,
        recurringAvailability: [saturday],
        exceptions: [],
        bookings: [],
        slotHolds: [],
        currentUtcTime: new Date('2026-10-03T09:48:00Z'),
      });

      const available = slots.filter((s) => s.is_available);
      // 10:00 through 15:00 have started; 16:00 and 17:00 remain bookable.
      assert.deepEqual(
        available.map((s) => s.local_start_time),
        ['16:00', '17:00']
      );
      assert.equal(slots.filter((s) => s.status === 'PAST').length, 6);
    });

    it('marks nothing as past for a future date', () => {
      const slots = generateMentorSlots({
        mentorId: 'm1',
        gigId: 'g1',
        dateStr: '2026-10-03',
        timezone: IST,
        durationMinutes: 60,
        recurringAvailability: [saturday],
        exceptions: [],
        bookings: [],
        slotHolds: [],
        currentUtcTime: new Date('2026-09-26T09:48:00Z'),
      });

      assert.equal(slots.filter((s) => s.status === 'PAST').length, 0);
      assert.equal(slots.filter((s) => s.is_available).length, 8);
    });
  });

  // --------------------------------------------------------------------------
  // Holds are temporary: expiring one must return the slot to the pool.
  // --------------------------------------------------------------------------
  describe('Hold lifecycle', () => {
    const saturday = window('m1', 6, '14:00', '16:00');

    it('reports HELD (not BOOKED) while the hold is unexpired', () => {
      const slots = generateMentorSlots({
        mentorId: 'm1',
        gigId: 'g1',
        dateStr: '2026-10-03',
        timezone: IST,
        durationMinutes: 60,
        recurringAvailability: [saturday],
        exceptions: [],
        bookings: [],
        slotHolds: [
          hold('m1', '2026-10-03T08:30:00Z', '2026-10-03T09:30:00Z', '2026-10-03T10:00:00Z'),
        ],
        // 12:30 IST, well before the 14:00 slot begins.
        currentUtcTime: new Date('2026-10-03T07:00:00Z'),
      });

      assert.equal(slots[0].status, 'HELD');
      assert.equal(slots[0].conflict_reason, 'HOLD_CONFLICT');
      assert.equal(slots[0].is_available, false);
      assert.equal(slots[1].status, 'AVAILABLE');
    });

    it('returns the slot to AVAILABLE once the hold expires', () => {
      const slots = generateMentorSlots({
        mentorId: 'm1',
        gigId: 'g1',
        dateStr: '2026-10-03',
        timezone: IST,
        durationMinutes: 60,
        recurringAvailability: [saturday],
        exceptions: [],
        bookings: [],
        // Same hold, evaluated after expires_at but before the slot starts.
        slotHolds: [
          hold('m1', '2026-10-03T08:30:00Z', '2026-10-03T09:30:00Z', '2026-10-03T08:00:00Z'),
        ],
        currentUtcTime: new Date('2026-10-03T08:10:00Z'),
      });

      assert.equal(slots[0].status, 'AVAILABLE');
      assert.equal(slots[0].is_available, true);
    });
  });

  // --------------------------------------------------------------------------
  // The timezone comes from the mentor, not from a global constant.
  // --------------------------------------------------------------------------
  describe('Mentor timezone resolution', () => {
    it('generates the same local clock times in a non-IST timezone', () => {
      const nyWindow: MentorAvailability = {
        ...window('m1', 6, '10:00', '12:00'),
        timezone: 'America/New_York',
      };

      const slots = generateMentorSlots({
        mentorId: 'm1',
        gigId: 'g1',
        dateStr: '2026-10-03',
        timezone: 'America/New_York',
        durationMinutes: 60,
        recurringAvailability: [nyWindow],
        exceptions: [],
        bookings: [],
        slotHolds: [],
        currentUtcTime: new Date('2026-09-26T00:00:00Z'),
      });

      assert.equal(slots.length, 2);
      assert.equal(slots[0].local_start_time, '10:00');
      // 10:00 EDT == 14:00 UTC, not 04:30 UTC as it would be in Asia/Kolkata.
      assert.equal(slots[0].utc_start_time, '2026-10-03T14:00:00.000Z');
      assert.equal(slots[0].timezone, 'America/New_York');
    });

    it('resolves the mentor calendar date without a UTC day shift', () => {
      // 2026-09-26 22:00 UTC is already 2026-09-27 in Asia/Kolkata, but still
      // 2026-09-26 in New York.
      const instant = new Date('2026-09-26T22:00:00Z');
      assert.equal(getDateStringInTimezone(instant, IST), '2026-09-27');
      assert.equal(getDateStringInTimezone(instant, 'America/New_York'), '2026-09-26');
      assert.equal(addDaysToDateString('2026-09-26', 7), '2026-10-03');
    });

    it('round-trips a local slot boundary to the correct UTC instant', () => {
      assert.equal(
        parseZonedDateTime('2026-10-03', '10:00', 'America/New_York').toISOString(),
        '2026-10-03T14:00:00.000Z'
      );
    });
  });

  // --------------------------------------------------------------------------
  // A reservation by ANY seeker removes the slot, not just a known one.
  // --------------------------------------------------------------------------
  describe('Reservations remove slots regardless of who owns them', () => {
    it('removes a slot held by a different seeker and by a confirmed booking alike', () => {
      const slots = generateMentorSlots({
        mentorId: 'm1',
        gigId: 'g1',
        dateStr: '2026-10-03',
        timezone: IST,
        durationMinutes: 60,
        recurringAvailability: [window('m1', 6, '10:00', '13:00')],
        exceptions: [],
        bookings: [
          booking('m1', '2026-10-03T05:30:00Z', '2026-10-03T06:30:00Z'), // 11:00 IST
        ],
        slotHolds: [
          hold('m1', '2026-10-03T08:30:00Z', '2026-10-03T09:30:00Z', '2026-10-03T09:00:00Z'), // 14:00 IST
        ],
        currentUtcTime: new Date('2026-09-26T00:00:00Z'),
      });

      // 10:00 available, 11:00 booked by another seeker, 12:00 available.
      assert.equal(slots[0].is_available, true);
      assert.equal(slots[1].status, 'BOOKED');
      assert.equal(slots[1].is_available, false);
      assert.equal(slots[2].is_available, true);

      // The count a seeker sees must be the selectable count.
      assert.equal(slots.filter((s) => s.is_available).length, 2);
      assert.notEqual(slots.filter((s) => s.is_available).length, slots.length);
    });

    it('ignores a cancelled booking so the interval reopens', () => {
      const cancelled = {
        ...booking('m1', '2026-10-03T05:30:00Z', '2026-10-03T06:30:00Z'),
        status: 'CANCELLED' as const,
      };
      const slots = generateMentorSlots({
        mentorId: 'm1',
        gigId: 'g1',
        dateStr: '2026-10-03',
        timezone: IST,
        durationMinutes: 60,
        recurringAvailability: [window('m1', 6, '10:00', '13:00')],
        exceptions: [],
        bookings: [cancelled],
        slotHolds: [],
        currentUtcTime: new Date('2026-09-26T00:00:00Z'),
      });

      assert.equal(slots.filter((s) => s.is_available).length, 3);
    });
  });
});

