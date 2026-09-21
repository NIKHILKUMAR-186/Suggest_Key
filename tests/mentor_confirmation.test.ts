import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  confirmSessionByMentor,
  validateMeetingUrl,
  calculateMeetingLinkDeadline,
  getOverdueBookings,
  BookingEngineContext,
} from '../src/lib/bookingEngine';
import { Profile } from '../src/types/auth';
import { Booking, Gig, MentorProfile, Segment } from '../src/types/database';

function createTestContext(): BookingEngineContext {
  const seekerProfile: Profile = {
    id: 'seeker-101',
    email: 'seeker@test.com',
    full_name: 'Aman Kumar',
    timezone: 'Asia/Kolkata',
    avatar_url: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  const mentorProfile: Profile = {
    id: 'mentor-201',
    email: 'mentor@test.com',
    full_name: 'Mentor Rahul',
    timezone: 'Asia/Kolkata',
    avatar_url: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  const otherMentorProfile: Profile = {
    id: 'mentor-999',
    email: 'other@test.com',
    full_name: 'Other Mentor',
    timezone: 'Asia/Kolkata',
    avatar_url: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  const segment: Segment = {
    id: 'seg-rel-01',
    slug: 'relationship-advisor',
    name: 'Relationship Advisor',
    description: 'Advisory segment',
    priority: 1,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  const gig: Gig = {
    id: 'gig-01',
    mentor_id: 'mentor-201',
    segment_id: 'seg-rel-01',
    title: '1:1 Relationship Session',
    description: 'Guided conversation',
    duration_minutes: 60,
    price_inr: 999,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  // Booking 1: MENTOR_PENDING, scheduled in 4 hours (> 2h deadline)
  const bookingValid: Booking = {
    id: 'bk-valid-01',
    booking_code: 'BK-1001',
    mentor_id: 'mentor-201',
    seeker_id: 'seeker-101',
    gig_id: 'gig-01',
    segment_id: 'seg-rel-01',
    hold_id: 'hold-01',
    start_time: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    end_time: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
    seeker_timezone: 'Asia/Kolkata',
    mentor_timezone: 'Asia/Kolkata',
    amount_inr: 999,
    status: 'MENTOR_PENDING',
    meeting_url: null,
    cancellation_reason: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Booking 2: MENTOR_PENDING, scheduled in 1 hour (< 2h deadline, overdue link!)
  const bookingOverdue: Booking = {
    id: 'bk-overdue-02',
    booking_code: 'BK-1002',
    mentor_id: 'mentor-201',
    seeker_id: 'seeker-101',
    gig_id: 'gig-01',
    segment_id: 'seg-rel-01',
    hold_id: 'hold-02',
    start_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    end_time: new Date(Date.now() + 120 * 60 * 1000).toISOString(),
    seeker_timezone: 'Asia/Kolkata',
    mentor_timezone: 'Asia/Kolkata',
    amount_inr: 999,
    status: 'MENTOR_PENDING',
    meeting_url: null,
    cancellation_reason: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Booking 3: Already CONFIRMED
  const bookingConfirmed: Booking = {
    id: 'bk-confirmed-03',
    booking_code: 'BK-1003',
    mentor_id: 'mentor-201',
    seeker_id: 'seeker-101',
    gig_id: 'gig-01',
    segment_id: 'seg-rel-01',
    hold_id: 'hold-03',
    start_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    end_time: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(),
    seeker_timezone: 'Asia/Kolkata',
    mentor_timezone: 'Asia/Kolkata',
    amount_inr: 999,
    status: 'CONFIRMED',
    meeting_url: 'https://meet.google.com/abc-def-ghi',
    cancellation_reason: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return {
    profiles: [seekerProfile, mentorProfile, otherMentorProfile],
    userRoles: [
      { user_id: 'seeker-101', role: 'seeker' },
      { user_id: 'mentor-201', role: 'mentor' },
      { user_id: 'mentor-999', role: 'mentor' },
    ],
    mentorProfiles: [],
    segments: [segment],
    mentorSegments: [{ mentor_id: 'mentor-201', segment_id: 'seg-rel-01' }],
    gigs: [gig],
    mentorAvailability: [],
    mentorAvailabilityExceptions: [],
    bookings: [bookingValid, bookingOverdue, bookingConfirmed],
    slotHolds: [],
    payments: [
      {
        id: 'pay-01',
        booking_id: 'bk-valid-01',
        seeker_id: 'seeker-101',
        amount_inr: 999,
        status: 'VERIFIED',
        proof_storage_path: 'proofs/upi-01.jpg',
        transaction_reference: 'UPI-01',
        verified_by: 'admin',
        verified_at: new Date().toISOString(),
        rejection_reason: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'pay-02',
        booking_id: 'bk-overdue-02',
        seeker_id: 'seeker-101',
        amount_inr: 999,
        status: 'VERIFIED',
        proof_storage_path: 'proofs/upi-02.jpg',
        transaction_reference: 'UPI-02',
        verified_by: 'admin',
        verified_at: new Date().toISOString(),
        rejection_reason: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    notifications: [],
  };
}

describe('Phase 8: Mentor Confirmation & Meeting Link Rules', () => {
  describe('Meeting Link URL Validation (validateMeetingUrl)', () => {
    it('accepts valid HTTPS meeting links', () => {
      assert.equal(validateMeetingUrl('https://meet.google.com/abc-defg-hij').isValid, true);
      assert.equal(validateMeetingUrl('https://us02web.zoom.us/j/1234567890?pwd=abc').isValid, true);
      assert.equal(validateMeetingUrl('https://teams.microsoft.com/l/meetup-join/19%3ameeting').isValid, true);
      assert.equal(validateMeetingUrl('https://myconsultation.clinic/room/99').isValid, true);
    });

    it('rejects HTTP (non-secure) links', () => {
      const res = validateMeetingUrl('http://meet.google.com/abc-defg-hij');
      assert.equal(res.isValid, false);
      assert.match(res.error || '', /HTTPS/i);
    });

    it('rejects plain text or malformed URLs', () => {
      assert.equal(validateMeetingUrl('').isValid, false);
      assert.equal(validateMeetingUrl('meet.google.com/abc').isValid, false);
      assert.equal(validateMeetingUrl('https://').isValid, false);
      assert.equal(validateMeetingUrl('javascript:alert(1)').isValid, false);
      assert.equal(validateMeetingUrl('https://not a valid url.com').isValid, false);
    });
  });

  describe('Deadline Calculation (calculateMeetingLinkDeadline)', () => {
    it('calculates deadline as exactly 2 hours before session start', () => {
      const startTime = '2026-03-25T14:00:00.000Z';
      const deadline = calculateMeetingLinkDeadline(startTime);
      assert.equal(deadline.deadlineUtc, '2026-03-25T12:00:00.000Z');
    });

    it('flags sessions < 2 hours away as overdue, while leaving > 2h as not overdue', () => {
      const now = new Date('2026-03-25T10:00:00.000Z');

      // 3 hours away -> not overdue
      const in3Hours = '2026-03-25T13:00:00.000Z';
      const res3 = calculateMeetingLinkDeadline(in3Hours, now);
      assert.equal(res3.isOverdue, false);
      assert.equal(res3.hoursUntilSession, 3);

      // 1 hour away -> overdue
      const in1Hour = '2026-03-25T11:00:00.000Z';
      const res1 = calculateMeetingLinkDeadline(in1Hour, now);
      assert.equal(res1.isOverdue, true);
      assert.equal(res1.hoursUntilSession, 1);
    });
  });

  describe('Session Confirmation (confirmSessionByMentor)', () => {
    it('successfully confirms a MENTOR_PENDING booking with valid HTTPS link', async () => {
      const db = createTestContext();
      const result = await confirmSessionByMentor(
        {
          bookingId: 'bk-valid-01',
          mentorId: 'mentor-201',
          meetingUrl: 'https://meet.google.com/test-session-1',
        },
        db
      );

      assert.equal(result.success, true);
      assert.equal(result.booking?.status, 'CONFIRMED');
      assert.equal(result.booking?.meeting_url, 'https://meet.google.com/test-session-1');

      // Check that seeker received an in-app notification
      const seekerNotif = db.notifications?.find((n) => n.user_id === 'seeker-101');
      assert.ok(seekerNotif, 'Seeker should receive an in-app notification');
      assert.match(seekerNotif.title, /Confirmed/i);
      assert.equal(seekerNotif.type, 'SESSION');

      // Check that mentor also received notification confirmation
      const mentorNotif = db.notifications?.find((n) => n.user_id === 'mentor-201');
      assert.ok(mentorNotif, 'Mentor should receive an in-app confirmation');
    });

    it('rejects confirmation if caller is NOT the owning mentor', async () => {
      const db = createTestContext();
      const result = await confirmSessionByMentor(
        {
          bookingId: 'bk-valid-01',
          mentorId: 'mentor-999', // Different mentor!
          meetingUrl: 'https://meet.google.com/unauthorized-link',
        },
        db
      );

      assert.equal(result.success, false);
      assert.equal(result.error?.code, 'FORBIDDEN_NOT_BOOKING_OWNER');

      // Booking status must NOT have changed
      const booking = db.bookings.find((b) => b.id === 'bk-valid-01');
      assert.equal(booking?.status, 'MENTOR_PENDING');
      assert.equal(booking?.meeting_url, null);
    });

    it('rejects confirmation without a meeting link or with non-HTTPS link', async () => {
      const db = createTestContext();

      // Non-HTTPS
      const resultHttp = await confirmSessionByMentor(
        {
          bookingId: 'bk-valid-01',
          mentorId: 'mentor-201',
          meetingUrl: 'http://insecure-meeting.com',
        },
        db
      );
      assert.equal(resultHttp.success, false);
      assert.equal(resultHttp.error?.code, 'INVALID_MEETING_URL');

      // Empty link
      const resultEmpty = await confirmSessionByMentor(
        {
          bookingId: 'bk-valid-01',
          mentorId: 'mentor-201',
          meetingUrl: '   ',
        },
        db
      );
      assert.equal(resultEmpty.success, false);
      assert.equal(resultEmpty.error?.code, 'INVALID_MEETING_URL');
    });

    it('rejects confirmation if booking is not in MENTOR_PENDING status', async () => {
      const db = createTestContext();
      const result = await confirmSessionByMentor(
        {
          bookingId: 'bk-confirmed-03', // Already CONFIRMED
          mentorId: 'mentor-201',
          meetingUrl: 'https://meet.google.com/already-confirmed',
        },
        db
      );

      assert.equal(result.success, false);
      assert.equal(result.error?.code, 'ALREADY_CONFIRMED');
    });

    it('overdue meeting link does NOT cancel session and can still be confirmed', async () => {
      const db = createTestContext();

      // Check that admin overdue helper identifies it
      const overdueList = getOverdueBookings(db);
      assert.equal(overdueList.length, 1);
      assert.equal(overdueList[0].id, 'bk-overdue-02');

      // Mentor confirms the overdue session
      const result = await confirmSessionByMentor(
        {
          bookingId: 'bk-overdue-02',
          mentorId: 'mentor-201',
          meetingUrl: 'https://meet.google.com/overdue-resolution',
        },
        db
      );

      assert.equal(result.success, true);
      assert.equal(result.isOverdue, true);
      assert.equal(result.booking?.status, 'CONFIRMED');
      assert.equal(result.booking?.meeting_url, 'https://meet.google.com/overdue-resolution');

      // Now it should no longer be in the overdue list since it is CONFIRMED
      const overdueListAfter = getOverdueBookings(db);
      assert.equal(overdueListAfter.length, 0);
    });
  });
});
