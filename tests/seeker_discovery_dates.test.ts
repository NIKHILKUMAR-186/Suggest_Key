import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getDateStringInTimezone,
  addDaysToDateString,
  generateMentorSlots,
} from '../src/lib/slotEngine';
import { MentorAvailability } from '../src/types/database';

describe('Live date derivation (no hardcoded calendar dates)', () => {
  it('derives today from the supplied timezone, not UTC', () => {
    // 2026-09-25T18:30:00Z is already the 26th in Kolkata (UTC+5:30) but
    // still the 25th in UTC. The seeker must see their own calendar day.
    const instant = new Date('2026-09-25T18:30:00.000Z');
    assert.equal(getDateStringInTimezone(instant, 'UTC'), '2026-09-25');
    assert.equal(getDateStringInTimezone(instant, 'Asia/Kolkata'), '2026-09-26');
  });

  it('derives today in a negative-offset timezone', () => {
    const instant = new Date('2026-09-25T03:00:00.000Z');
    assert.equal(getDateStringInTimezone(instant, 'America/New_York'), '2026-09-24');
  });

  it('falls back to the UTC calendar day for an unknown timezone', () => {
    const instant = new Date('2026-09-25T18:30:00.000Z');
    assert.equal(getDateStringInTimezone(instant, 'Not/AZone'), '2026-09-25');
  });

  it('computes tomorrow as exactly one calendar day after today', () => {
    assert.equal(addDaysToDateString('2026-09-26', 1), '2026-09-27');
    assert.equal(addDaysToDateString('2026-12-31', 1), '2027-01-01');
    assert.equal(addDaysToDateString('2026-03-01', -1), '2026-02-28');
  });

  it('rolls a live clock over to a new day without any hardcoded date', () => {
    const before = new Date('2026-09-25T18:30:00.000Z');
    const after = new Date('2026-09-26T18:30:00.000Z');
    const todayBefore = getDateStringInTimezone(before, 'Asia/Kolkata');
    const tomorrowBefore = addDaysToDateString(todayBefore, 1);
    const todayAfter = getDateStringInTimezone(after, 'Asia/Kolkata');

    assert.equal(tomorrowBefore, todayAfter);
  });
});

describe('Available vs All mentors slot distinction', () => {
  const availability: MentorAvailability[] = [
    {
      id: 'a1',
      mentor_id: 'mentor-1',
      day_of_week: 1, // Monday
      start_time: '10:00',
      end_time: '18:00',
      timezone: 'Asia/Kolkata',
      is_enabled: true,
      created_at: '',
      updated_at: '',
    },
  ];

  // 2026-09-28 is a Monday.
  it('exposes bookable slots for a mentor that has recurring availability', () => {
    const slots = generateMentorSlots({
      mentorId: 'mentor-1',
      gigId: 'gig-1',
      dateStr: '2026-09-28',
      timezone: 'Asia/Kolkata',
      durationMinutes: 60,
      recurringAvailability: availability,
      exceptions: [],
      bookings: [],
      slotHolds: [],
      currentUtcTime: new Date('2026-09-27T00:00:00.000Z'),
    });

    const open = slots.filter((s) => s.is_available);
    assert.equal(open.length, 8);
  });

  it('blocks a booked interval globally across the mentor timeline', () => {
    const slots = generateMentorSlots({
      mentorId: 'mentor-1',
      gigId: 'gig-2', // a different segment's gig
      dateStr: '2026-09-28',
      timezone: 'Asia/Kolkata',
      durationMinutes: 60,
      recurringAvailability: availability,
      exceptions: [],
      bookings: [
        {
          id: 'b1',
          booking_code: 'BK-1',
          mentor_id: 'mentor-1',
          seeker_id: 'seeker-1',
          gig_id: 'gig-1', // booked under the OTHER segment
          segment_id: 'seg-1',
          hold_id: null,
          start_time: '2026-09-28T08:30:00.000Z', // 14:00 IST
          end_time: '2026-09-28T09:30:00.000Z', // 15:00 IST
          seeker_timezone: 'Asia/Kolkata',
          mentor_timezone: 'Asia/Kolkata',
          amount_inr: 999,
          status: 'CONFIRMED',
          meeting_url: null,
          actual_ended_at: null,
          ended_by_role: null,
          end_reason: null,
          cancellation_reason: null,
          created_at: '',
          updated_at: '',
        },
      ],
      slotHolds: [],
      currentUtcTime: new Date('2026-09-27T00:00:00.000Z'),
    });

    const open = slots.filter((s) => s.is_available);
    assert.equal(open.length, 7);
    assert.equal(slots.find((s) => s.local_start_time === '14:00')?.status, 'BOOKED');
  });

  it('produces no slots when the mentor has never configured availability', () => {
    const slots = generateMentorSlots({
      mentorId: 'mentor-2',
      gigId: 'gig-1',
      dateStr: '2026-09-28',
      timezone: 'Asia/Kolkata',
      durationMinutes: 60,
      recurringAvailability: [],
      exceptions: [],
      bookings: [],
      slotHolds: [],
      currentUtcTime: new Date('2026-09-27T00:00:00.000Z'),
    });

    // Zero open slots means the mentor is absent from "Available Mentors"
    // while remaining present in "View All Mentors".
    assert.equal(slots.filter((s) => s.is_available).length, 0);
  });

  it('honours an unavailable date exception over recurring availability', () => {
    const slots = generateMentorSlots({
      mentorId: 'mentor-1',
      gigId: 'gig-1',
      dateStr: '2026-09-28',
      timezone: 'Asia/Kolkata',
      durationMinutes: 60,
      recurringAvailability: availability,
      exceptions: [
        {
          id: 'e1',
          mentor_id: 'mentor-1',
          exception_date: '2026-09-28',
          is_available: false,
          start_time: null,
          end_time: null,
          reason: 'Leave',
          created_at: '',
        },
      ],
      bookings: [],
      slotHolds: [],
      currentUtcTime: new Date('2026-09-27T00:00:00.000Z'),
    });

    assert.equal(slots.length, 0);
  });
});

