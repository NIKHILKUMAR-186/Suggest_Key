import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseZonedDateTime,
  formatTimeInTimezone,
  intervalsOverlap,
  generateMentorSlots,
} from '../src/lib/slotEngine';
import {
  MentorAvailability,
  MentorAvailabilityException,
  Booking,
  SlotHold,
} from '../src/types/database';

describe('Phase 5: Availability & Discovery Test Suite', () => {
  // --------------------------------------------------------------------------
  // 1. Timezone Conversion Tests
  // --------------------------------------------------------------------------
  describe('Timezone Conversion', () => {
    it('accurately converts Asia/Kolkata (IST = UTC+5:30) clock times to exact UTC ISO timestamps', () => {
      // 09:00 IST on 2026-09-21 must be 03:30:00.000Z
      const utcDate = parseZonedDateTime('2026-09-21', '09:00', 'Asia/Kolkata');
      assert.equal(utcDate.toISOString(), '2026-09-21T03:30:00.000Z');

      // 18:30 IST on 2026-09-21 must be 13:00:00.000Z
      const utcEvening = parseZonedDateTime('2026-09-21', '18:30', 'Asia/Kolkata');
      assert.equal(utcEvening.toISOString(), '2026-09-21T13:00:00.000Z');
    });

    it('accurately converts America/New_York (EDT = UTC-4:00) clock times to exact UTC ISO timestamps', () => {
      // 09:00 EDT on 2026-09-21 must be 13:00:00.000Z
      const utcDate = parseZonedDateTime('2026-09-21', '09:00', 'America/New_York');
      assert.equal(utcDate.toISOString(), '2026-09-21T13:00:00.000Z');

      // 15:00 EDT on 2026-09-21 must be 19:00:00.000Z
      const utcAfternoon = parseZonedDateTime('2026-09-21', '15:00', 'America/New_York');
      assert.equal(utcAfternoon.toISOString(), '2026-09-21T19:00:00.000Z');
    });

    it('handles UTC timezone conversions without drift', () => {
      const utcDate = parseZonedDateTime('2026-09-21', '10:00', 'UTC');
      assert.equal(utcDate.toISOString(), '2026-09-21T10:00:00.000Z');
    });

    it('formats UTC ISO timestamp back into mentor timezone faithfully', () => {
      const utcDate = new Date('2026-09-21T03:30:00.000Z');
      const formatted = formatTimeInTimezone(utcDate, 'Asia/Kolkata', { hour12: false });
      assert.equal(formatted, '09:00');
    });
  });

  // --------------------------------------------------------------------------
  // 2. Past Slots Filtering Tests
  // --------------------------------------------------------------------------
  describe('Past Slots Filtering', () => {
    it('marks all slots that started at or prior to authoritative current UTC time as PAST and unavailable', () => {
      // Current UTC time: 2026-09-21 06:00:00Z (which is 11:30 AM IST)
      const currentUtcTime = new Date('2026-09-21T06:00:00.000Z');

      const recurringAvailability: MentorAvailability[] = [
        {
          id: 'avail-1',
          mentor_id: 'mentor-1',
          day_of_week: 1, // Monday
          start_time: '09:00:00', // IST
          end_time: '14:00:00', // IST
          timezone: 'Asia/Kolkata',
          is_enabled: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ];

      const slots = generateMentorSlots({
        mentorId: 'mentor-1',
        gigId: 'gig-1',
        dateStr: '2026-09-21', // Monday
        timezone: 'Asia/Kolkata',
        durationMinutes: 60,
        recurringAvailability,
        exceptions: [],
        bookings: [],
        slotHolds: [],
        currentUtcTime,
      });

      // Total 5 slots: 09:00-10:00, 10:00-11:00, 11:00-12:00, 12:00-13:00, 13:00-14:00 IST
      assert.equal(slots.length, 5);

      // Slot 0 (09:00-10:00 IST = 03:30-04:30 UTC): past
      assert.equal(slots[0].status, 'PAST');
      assert.equal(slots[0].is_available, false);
      assert.equal(slots[0].conflict_reason, 'PAST');

      // Slot 1 (10:00-11:00 IST = 04:30-05:30 UTC): past
      assert.equal(slots[1].status, 'PAST');
      assert.equal(slots[1].is_available, false);

      // Slot 2 (11:00-12:00 IST = 05:30-06:30 UTC): started at 05:30 UTC <= 06:00 UTC -> past
      assert.equal(slots[2].status, 'PAST');
      assert.equal(slots[2].is_available, false);

      // Slot 3 (12:00-13:00 IST = 06:30-07:30 UTC): starts at 06:30 UTC > 06:00 UTC -> available!
      assert.equal(slots[3].status, 'AVAILABLE');
      assert.equal(slots[3].is_available, true);

      // Slot 4 (13:00-14:00 IST = 07:30-08:30 UTC): available!
      assert.equal(slots[4].status, 'AVAILABLE');
      assert.equal(slots[4].is_available, true);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Date Exceptions Tests
  // --------------------------------------------------------------------------
  describe('Date Exceptions', () => {
    it('returns zero slots when mentor exception marks date as unavailable (holiday/leave)', () => {
      const recurringAvailability: MentorAvailability[] = [
        {
          id: 'avail-1',
          mentor_id: 'mentor-1',
          day_of_week: 1, // Monday
          start_time: '09:00:00',
          end_time: '18:00:00',
          timezone: 'Asia/Kolkata',
          is_enabled: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ];

      const exceptions: MentorAvailabilityException[] = [
        {
          id: 'exc-1',
          mentor_id: 'mentor-1',
          exception_date: '2026-09-21',
          is_available: false, // Day off
          start_time: null,
          end_time: null,
          reason: 'Personal Leave',
          created_at: '2026-01-01T00:00:00Z',
        },
      ];

      const slots = generateMentorSlots({
        mentorId: 'mentor-1',
        gigId: 'gig-1',
        dateStr: '2026-09-21',
        timezone: 'Asia/Kolkata',
        durationMinutes: 60,
        recurringAvailability,
        exceptions,
        bookings: [],
        slotHolds: [],
        currentUtcTime: new Date('2026-09-20T00:00:00.000Z'),
      });

      assert.equal(slots.length, 0);
    });

    it('overrides recurring schedule with custom exception hours when is_available is true', () => {
      const recurringAvailability: MentorAvailability[] = [
        {
          id: 'avail-1',
          mentor_id: 'mentor-1',
          day_of_week: 1,
          start_time: '09:00:00',
          end_time: '18:00:00',
          timezone: 'Asia/Kolkata',
          is_enabled: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ];

      // On this specific date, mentor works only a special 2-hour shift: 14:00 to 16:00
      const exceptions: MentorAvailabilityException[] = [
        {
          id: 'exc-2',
          mentor_id: 'mentor-1',
          exception_date: '2026-09-21',
          is_available: true,
          start_time: '14:00:00',
          end_time: '16:00:00',
          reason: 'Special Afternoon Workshop Availability',
          created_at: '2026-01-01T00:00:00Z',
        },
      ];

      const slots = generateMentorSlots({
        mentorId: 'mentor-1',
        gigId: 'gig-1',
        dateStr: '2026-09-21',
        timezone: 'Asia/Kolkata',
        durationMinutes: 60,
        recurringAvailability,
        exceptions,
        bookings: [],
        slotHolds: [],
        currentUtcTime: new Date('2026-09-20T00:00:00.000Z'),
      });

      // Exactly 2 slots: 14:00-15:00 and 15:00-16:00
      assert.equal(slots.length, 2);
      assert.equal(slots[0].local_start_time, '14:00');
      assert.equal(slots[0].local_end_time, '15:00');
      assert.equal(slots[1].local_start_time, '15:00');
      assert.equal(slots[1].local_end_time, '16:00');
    });
  });

  // --------------------------------------------------------------------------
  // 4. Overlapping Bookings Filtering Tests
  // --------------------------------------------------------------------------
  describe('Overlapping Bookings Conflict Filtering', () => {
    it('marks conflicting slots as BOOKED and preserves adjacent non-conflicting slots', () => {
      const recurringAvailability: MentorAvailability[] = [
        {
          id: 'avail-1',
          mentor_id: 'mentor-1',
          day_of_week: 1,
          start_time: '10:00:00', // IST
          end_time: '14:00:00', // IST
          timezone: 'Asia/Kolkata',
          is_enabled: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ];

      // Existing confirmed booking from 11:00 to 12:00 IST (05:30 - 06:30 UTC)
      const bookings: Booking[] = [
        {
          id: 'bk-1',
          booking_code: 'BK-101',
          mentor_id: 'mentor-1',
          seeker_id: 'seeker-1',
          gig_id: 'gig-1',
          segment_id: 'seg-1',
          hold_id: null,
          start_time: '2026-09-21T05:30:00.000Z',
          end_time: '2026-09-21T06:30:00.000Z',
          seeker_timezone: 'Asia/Kolkata',
          mentor_timezone: 'Asia/Kolkata',
          amount_inr: 999,
          status: 'CONFIRMED',
          meeting_url: null,
          cancellation_reason: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ];

      const slots = generateMentorSlots({
        mentorId: 'mentor-1',
        gigId: 'gig-1',
        dateStr: '2026-09-21',
        timezone: 'Asia/Kolkata',
        durationMinutes: 60,
        recurringAvailability,
        exceptions: [],
        bookings,
        slotHolds: [],
        currentUtcTime: new Date('2026-09-20T00:00:00.000Z'),
      });

      // 4 slots: 10:00-11:00, 11:00-12:00, 12:00-13:00, 13:00-14:00
      assert.equal(slots.length, 4);

      // Slot 10:00-11:00 is AVAILABLE (adjacent interval does not overlap)
      assert.equal(slots[0].local_start_time, '10:00');
      assert.equal(slots[0].status, 'AVAILABLE');
      assert.equal(slots[0].is_available, true);

      // Slot 11:00-12:00 is BOOKED
      assert.equal(slots[1].local_start_time, '11:00');
      assert.equal(slots[1].status, 'BOOKED');
      assert.equal(slots[1].is_available, false);
      assert.equal(slots[1].conflict_reason, 'BOOKING_CONFLICT');

      // Slot 12:00-13:00 is AVAILABLE
      assert.equal(slots[2].local_start_time, '12:00');
      assert.equal(slots[2].status, 'AVAILABLE');
      assert.equal(slots[2].is_available, true);

      // Slot 13:00-14:00 is AVAILABLE
      assert.equal(slots[3].local_start_time, '13:00');
      assert.equal(slots[3].status, 'AVAILABLE');
      assert.equal(slots[3].is_available, true);
    });

    it('ignores CANCELLED and REJECTED bookings so released intervals become available', () => {
      const recurringAvailability: MentorAvailability[] = [
        {
          id: 'avail-1',
          mentor_id: 'mentor-1',
          day_of_week: 1,
          start_time: '10:00:00',
          end_time: '12:00:00',
          timezone: 'Asia/Kolkata',
          is_enabled: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ];

      const bookings: Booking[] = [
        {
          id: 'bk-cancelled',
          booking_code: 'BK-102',
          mentor_id: 'mentor-1',
          seeker_id: 'seeker-1',
          gig_id: 'gig-1',
          segment_id: 'seg-1',
          hold_id: null,
          start_time: '2026-09-21T05:30:00.000Z', // 11:00 IST
          end_time: '2026-09-21T06:30:00.000Z', // 12:00 IST
          seeker_timezone: 'Asia/Kolkata',
          mentor_timezone: 'Asia/Kolkata',
          amount_inr: 999,
          status: 'CANCELLED',
          meeting_url: null,
          cancellation_reason: 'Seeker schedule conflict',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ];

      const slots = generateMentorSlots({
        mentorId: 'mentor-1',
        gigId: 'gig-1',
        dateStr: '2026-09-21',
        timezone: 'Asia/Kolkata',
        durationMinutes: 60,
        recurringAvailability,
        exceptions: [],
        bookings,
        slotHolds: [],
        currentUtcTime: new Date('2026-09-20T00:00:00.000Z'),
      });

      assert.equal(slots[1].status, 'AVAILABLE');
      assert.equal(slots[1].is_available, true);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Overlapping Holds Filtering Tests
  // --------------------------------------------------------------------------
  describe('Active-Hold Conflict Filtering', () => {
    it('blocks slots that overlap an ACTIVE and UNEXPIRED hold', () => {
      const recurringAvailability: MentorAvailability[] = [
        {
          id: 'avail-1',
          mentor_id: 'mentor-1',
          day_of_week: 1,
          start_time: '14:00:00', // IST
          end_time: '16:00:00', // IST
          timezone: 'Asia/Kolkata',
          is_enabled: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ];

      const currentUtcTime = new Date('2026-09-21T07:00:00.000Z');

      // Hold is ACTIVE and expires 10 minutes into the future
      const slotHolds: SlotHold[] = [
        {
          id: 'hold-1',
          mentor_id: 'mentor-1',
          seeker_id: 'seeker-2',
          gig_id: 'gig-1',
          start_time: '2026-09-21T08:30:00.000Z', // 14:00 IST
          end_time: '2026-09-21T09:30:00.000Z', // 15:00 IST
          created_at: '2026-09-21T06:55:00.000Z',
          expires_at: '2026-09-21T07:10:00.000Z', // Active
          status: 'ACTIVE',
        },
      ];

      const slots = generateMentorSlots({
        mentorId: 'mentor-1',
        gigId: 'gig-1',
        dateStr: '2026-09-21',
        timezone: 'Asia/Kolkata',
        durationMinutes: 60,
        recurringAvailability,
        exceptions: [],
        bookings: [],
        slotHolds,
        currentUtcTime,
      });

      assert.equal(slots[0].status, 'HELD');
      assert.equal(slots[0].is_available, false);
      assert.equal(slots[0].conflict_reason, 'HOLD_CONFLICT');

      // Next slot (15:00 - 16:00 IST) is AVAILABLE
      assert.equal(slots[1].status, 'AVAILABLE');
      assert.equal(slots[1].is_available, true);
    });

    it('releases slots if hold has already expired past the 15-minute window', () => {
      const recurringAvailability: MentorAvailability[] = [
        {
          id: 'avail-1',
          mentor_id: 'mentor-1',
          day_of_week: 1,
          start_time: '14:00:00',
          end_time: '16:00:00',
          timezone: 'Asia/Kolkata',
          is_enabled: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ];

      const currentUtcTime = new Date('2026-09-21T07:30:00.000Z');

      // Hold expired at 07:15:00Z
      const slotHolds: SlotHold[] = [
        {
          id: 'hold-expired',
          mentor_id: 'mentor-1',
          seeker_id: 'seeker-2',
          gig_id: 'gig-1',
          start_time: '2026-09-21T08:30:00.000Z',
          end_time: '2026-09-21T09:30:00.000Z',
          created_at: '2026-09-21T07:00:00.000Z',
          expires_at: '2026-09-21T07:15:00.000Z', // Expired
          status: 'ACTIVE',
        },
      ];

      const slots = generateMentorSlots({
        mentorId: 'mentor-1',
        gigId: 'gig-1',
        dateStr: '2026-09-21',
        timezone: 'Asia/Kolkata',
        durationMinutes: 60,
        recurringAvailability,
        exceptions: [],
        bookings: [],
        slotHolds,
        currentUtcTime,
      });

      assert.equal(slots[0].status, 'AVAILABLE');
      assert.equal(slots[0].is_available, true);
    });
  });

  // --------------------------------------------------------------------------
  // 6. Global Mentor Availability Tests
  // --------------------------------------------------------------------------
  describe('Global Mentor Availability Invariant', () => {
    it('blocks slots across ALL segments and gigs when booked on a different segment', () => {
      // Mentor Rahul operates under two segments:
      // Gig A: Relationship Advisor (gig-rel-1, 60 mins)
      // Gig B: Career Mentor (gig-car-1, 60 mins)
      const recurringAvailability: MentorAvailability[] = [
        {
          id: 'avail-rahul',
          mentor_id: 'mentor-rahul',
          day_of_week: 1,
          start_time: '10:00:00', // IST
          end_time: '13:00:00', // IST
          timezone: 'Asia/Kolkata',
          is_enabled: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ];

      // A seeker booked Rahul under "Gig B: Career Mentor" from 11:00 to 12:00 IST
      const careerBooking: Booking = {
        id: 'bk-career-01',
        booking_code: 'BK-CAR-1',
        mentor_id: 'mentor-rahul',
        seeker_id: 'seeker-career',
        gig_id: 'gig-car-1', // Under Career gig!
        segment_id: 'seg-car',
        hold_id: null,
        start_time: '2026-09-21T05:30:00.000Z', // 11:00 IST
        end_time: '2026-09-21T06:30:00.000Z', // 12:00 IST
        seeker_timezone: 'Asia/Kolkata',
        mentor_timezone: 'Asia/Kolkata',
        amount_inr: 1299,
        status: 'CONFIRMED',
        meeting_url: null,
        cancellation_reason: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };

      // Now a seeker explores "Gig A: Relationship Advisor" for Rahul on that same date
      const relationshipSlots = generateMentorSlots({
        mentorId: 'mentor-rahul',
        gigId: 'gig-rel-1', // Generating for Relationship gig
        dateStr: '2026-09-21',
        timezone: 'Asia/Kolkata',
        durationMinutes: 60,
        recurringAvailability,
        exceptions: [],
        bookings: [careerBooking], // Career booking passed into Rahul's global check
        slotHolds: [],
        currentUtcTime: new Date('2026-09-20T00:00:00.000Z'),
      });

      assert.equal(relationshipSlots.length, 3);
      // 10:00 - 11:00 IST is AVAILABLE
      assert.equal(relationshipSlots[0].status, 'AVAILABLE');

      // 11:00 - 12:00 IST is BOOKED on Relationship gig because Rahul is occupied on Career gig!
      assert.equal(relationshipSlots[1].status, 'BOOKED');
      assert.equal(relationshipSlots[1].is_available, false);
      assert.equal(relationshipSlots[1].conflict_reason, 'BOOKING_CONFLICT');

      // 12:00 - 13:00 IST is AVAILABLE
      assert.equal(relationshipSlots[2].status, 'AVAILABLE');
    });

    it('blocks slots across different gig durations accurately using interval overlap', () => {
      // Mentor has availability 10:00 - 12:00 IST
      const recurringAvailability: MentorAvailability[] = [
        {
          id: 'avail-1',
          mentor_id: 'mentor-1',
          day_of_week: 1,
          start_time: '10:00:00',
          end_time: '12:00:00',
          timezone: 'Asia/Kolkata',
          is_enabled: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ];

      // A 45-minute booking exists from 10:30 to 11:15 IST (05:00 - 05:45 UTC)
      const booking45Min: Booking = {
        id: 'bk-45',
        booking_code: 'BK-45',
        mentor_id: 'mentor-1',
        seeker_id: 'seeker-1',
        gig_id: 'gig-other',
        segment_id: 'seg-other',
        hold_id: null,
        start_time: '2026-09-21T05:00:00.000Z', // 10:30 IST
        end_time: '2026-09-21T05:45:00.000Z', // 11:15 IST
        seeker_timezone: 'Asia/Kolkata',
        mentor_timezone: 'Asia/Kolkata',
        amount_inr: 800,
        status: 'CONFIRMED',
        meeting_url: null,
        cancellation_reason: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };

      // Candidate 60-minute slots:
      // Slot 1: 10:00 - 11:00 IST (overlaps with 10:30-11:15)
      // Slot 2: 11:00 - 12:00 IST (overlaps with 10:30-11:15)
      const slots = generateMentorSlots({
        mentorId: 'mentor-1',
        gigId: 'gig-60',
        dateStr: '2026-09-21',
        timezone: 'Asia/Kolkata',
        durationMinutes: 60,
        recurringAvailability,
        exceptions: [],
        bookings: [booking45Min],
        slotHolds: [],
        currentUtcTime: new Date('2026-09-20T00:00:00.000Z'),
      });

      assert.equal(slots.length, 2);
      assert.equal(slots[0].status, 'BOOKED');
      assert.equal(slots[1].status, 'BOOKED');
    });
  });

  // --------------------------------------------------------------------------
  // 7. Mentor Discoverability Invariant Tests
  // --------------------------------------------------------------------------
  describe('Mentor Discoverability Invariant', () => {
    it('excludes mentor from discovery when all slots on the selected date are booked or in the past', () => {
      // 10:00 - 11:00 IST availability (only 1 slot)
      const recurringAvailability: MentorAvailability[] = [
        {
          id: 'avail-single',
          mentor_id: 'mentor-busy',
          day_of_week: 1,
          start_time: '10:00:00',
          end_time: '11:00:00',
          timezone: 'Asia/Kolkata',
          is_enabled: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ];

      // A confirmed booking occupying that single slot
      const fullBooking: Booking = {
        id: 'bk-full',
        booking_code: 'BK-FULL',
        mentor_id: 'mentor-busy',
        seeker_id: 'seeker-1',
        gig_id: 'gig-1',
        segment_id: 'seg-1',
        hold_id: null,
        start_time: '2026-09-21T04:30:00.000Z', // 10:00 IST
        end_time: '2026-09-21T05:30:00.000Z', // 11:00 IST
        seeker_timezone: 'Asia/Kolkata',
        mentor_timezone: 'Asia/Kolkata',
        amount_inr: 999,
        status: 'CONFIRMED',
        meeting_url: null,
        cancellation_reason: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };

      const slots = generateMentorSlots({
        mentorId: 'mentor-busy',
        gigId: 'gig-1',
        dateStr: '2026-09-21',
        timezone: 'Asia/Kolkata',
        durationMinutes: 60,
        recurringAvailability,
        exceptions: [],
        bookings: [fullBooking],
        slotHolds: [],
        currentUtcTime: new Date('2026-09-20T00:00:00.000Z'),
      });

      const availableSlots = slots.filter((s) => s.is_available);
      // Invariant: If availableSlots.length === 0, mentor must NOT be discoverable on that date
      assert.equal(availableSlots.length, 0);
    });

    it('includes mentor in discovery when at least one future valid slot exists on the date', () => {
      const recurringAvailability: MentorAvailability[] = [
        {
          id: 'avail-multi',
          mentor_id: 'mentor-avail',
          day_of_week: 1,
          start_time: '10:00:00',
          end_time: '12:00:00',
          timezone: 'Asia/Kolkata',
          is_enabled: true,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ];

      // Booking only covers first slot (10:00 - 11:00 IST)
      const partialBooking: Booking = {
        id: 'bk-part',
        booking_code: 'BK-PART',
        mentor_id: 'mentor-avail',
        seeker_id: 'seeker-1',
        gig_id: 'gig-1',
        segment_id: 'seg-1',
        hold_id: null,
        start_time: '2026-09-21T04:30:00.000Z', // 10:00 IST
        end_time: '2026-09-21T05:30:00.000Z', // 11:00 IST
        seeker_timezone: 'Asia/Kolkata',
        mentor_timezone: 'Asia/Kolkata',
        amount_inr: 999,
        status: 'CONFIRMED',
        meeting_url: null,
        cancellation_reason: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };

      const slots = generateMentorSlots({
        mentorId: 'mentor-avail',
        gigId: 'gig-1',
        dateStr: '2026-09-21',
        timezone: 'Asia/Kolkata',
        durationMinutes: 60,
        recurringAvailability,
        exceptions: [],
        bookings: [partialBooking],
        slotHolds: [],
        currentUtcTime: new Date('2026-09-20T00:00:00.000Z'),
      });

      const availableSlots = slots.filter((s) => s.is_available);
      assert.equal(availableSlots.length, 1);
      assert.equal(availableSlots[0].local_start_time, '11:00');
    });
  });
});
