import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { executeAtomicBookingWithHold, BookingEngineContext } from '../src/lib/bookingEngine';
import { Profile } from '../src/types/auth';
import {
  Booking,
  Gig,
  MentorAvailability,
  MentorAvailabilityException,
  MentorProfile,
  Segment,
  SlotHold,
} from '../src/types/database';

function createFreshTestDbContext(): BookingEngineContext {
  const seekerProfile1: Profile = {
    id: 'seeker-1',
    email: 'seeker1@test.com',
    full_name: 'Seeker One',
    timezone: 'Asia/Kolkata',
    avatar_url: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  const seekerProfile2: Profile = {
    id: 'seeker-2',
    email: 'seeker2@test.com',
    full_name: 'Seeker Two',
    timezone: 'Asia/Kolkata',
    avatar_url: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  const mentorUser: Profile = {
    id: 'mentor-1',
    email: 'mentor@test.com',
    full_name: 'Mentor Rahul',
    timezone: 'Asia/Kolkata',
    avatar_url: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  const mentorProfile: MentorProfile = {
    id: 'mentor-1',
    headline: 'Certified Relationship Advisor',
    about: 'Experienced guidance',
    experience_years: 7,
    languages: ['English', 'Hindi'],
    rating: 5.0,
    review_count: 20,
    session_count: 50,
    is_approved: true,
    is_featured: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  const segment: Segment = {
    id: 'seg-rel',
    name: 'Relationship Advisor',
    slug: 'relationship-advisor',
    description: 'Relationship advisory',
    priority: 1,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  const gig: Gig = {
    id: 'gig-rel-60',
    mentor_id: 'mentor-1',
    segment_id: 'seg-rel',
    title: '1:1 Relationship Session',
    description: 'In-depth consultation',
    duration_minutes: 60,
    price_inr: 999,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  // Availability: Monday (1) 10:00 to 18:00 IST
  const availability: MentorAvailability[] = [
    {
      id: 'avail-1',
      mentor_id: 'mentor-1',
      day_of_week: 1, // Monday
      start_time: '10:00:00',
      end_time: '18:00:00',
      timezone: 'Asia/Kolkata',
      is_enabled: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ];

  return {
    profiles: [seekerProfile1, seekerProfile2, mentorUser],
    userRoles: [
      { user_id: 'seeker-1', role: 'seeker' },
      { user_id: 'seeker-2', role: 'seeker' },
      { user_id: 'mentor-1', role: 'mentor' },
    ],
    mentorProfiles: [mentorProfile],
    segments: [segment],
    mentorSegments: [{ mentor_id: 'mentor-1', segment_id: 'seg-rel' }],
    gigs: [gig],
    mentorAvailability: availability,
    mentorAvailabilityExceptions: [],
    bookings: [],
    slotHolds: [],
  };
}

describe('Phase 6: Concurrency-Safe Booking & Slot Holds', () => {
  let db: BookingEngineContext;

  // Authoritative server UTC time: Sunday Sep 20 2026, 20:00 UTC
  // Monday Sep 21 2026, 10:00 IST = 04:30 UTC
  // Monday Sep 21 2026, 11:00 IST = 05:30 UTC
  const fixedCurrentUtc = new Date('2026-09-20T20:00:00.000Z');
  const validFutureStartUtc = '2026-09-21T04:30:00.000Z'; // 10:00 IST
  const validFutureEndUtc = '2026-09-21T05:30:00.000Z'; // 11:00 IST (60 mins)

  beforeEach(() => {
    db = createFreshTestDbContext();
  });

  // --------------------------------------------------------------------------
  // Server-Side Validations 1 through 12
  // --------------------------------------------------------------------------
  describe('Server-Side Strict 12-Point Validation', () => {
    it('1. rejects unauthenticated or missing seeker profile (AUTH_REQUIRED)', async () => {
      const res = await executeAtomicBookingWithHold(
        {
          seekerId: 'non-existent-user',
          mentorId: 'mentor-1',
          segmentId: 'seg-rel',
          gigId: 'gig-rel-60',
          startTime: validFutureStartUtc,
          endTime: validFutureEndUtc,
          currentUtcTime: fixedCurrentUtc,
        },
        db
      );

      assert.equal(res.success, false);
      assert.equal(res.error?.code, 'SEEKER_NOT_FOUND');
      assert.equal(db.bookings.length, 0);
      assert.equal(db.slotHolds.length, 0);
    });

    it('2. rejects user without seeker role (ROLE_NOT_SEEKER)', async () => {
      // mentor-1 does not hold seeker role
      const res = await executeAtomicBookingWithHold(
        {
          seekerId: 'mentor-1',
          mentorId: 'mentor-1',
          segmentId: 'seg-rel',
          gigId: 'gig-rel-60',
          startTime: validFutureStartUtc,
          endTime: validFutureEndUtc,
          currentUtcTime: fixedCurrentUtc,
        },
        db
      );

      assert.equal(res.success, false);
      assert.equal(res.error?.code, 'ROLE_NOT_SEEKER');
      assert.equal(db.bookings.length, 0);
      assert.equal(db.slotHolds.length, 0);
    });

    it('3. rejects unapproved mentor (MENTOR_NOT_APPROVED)', async () => {
      db.mentorProfiles[0].is_approved = false;

      const res = await executeAtomicBookingWithHold(
        {
          seekerId: 'seeker-1',
          mentorId: 'mentor-1',
          segmentId: 'seg-rel',
          gigId: 'gig-rel-60',
          startTime: validFutureStartUtc,
          endTime: validFutureEndUtc,
          currentUtcTime: fixedCurrentUtc,
        },
        db
      );

      assert.equal(res.success, false);
      assert.equal(res.error?.code, 'MENTOR_NOT_APPROVED');
      assert.equal(db.bookings.length, 0);
    });

    it('4. rejects inactive segment or mentor segment mismatch (SEGMENT_INACTIVE)', async () => {
      db.segments[0].is_active = false;

      const res = await executeAtomicBookingWithHold(
        {
          seekerId: 'seeker-1',
          mentorId: 'mentor-1',
          segmentId: 'seg-rel',
          gigId: 'gig-rel-60',
          startTime: validFutureStartUtc,
          endTime: validFutureEndUtc,
          currentUtcTime: fixedCurrentUtc,
        },
        db
      );

      assert.equal(res.success, false);
      assert.equal(res.error?.code, 'SEGMENT_INACTIVE');
      assert.equal(db.bookings.length, 0);
    });

    it('5. rejects inactive gig or gig mismatch (GIG_INACTIVE)', async () => {
      db.gigs[0].is_active = false;

      const res = await executeAtomicBookingWithHold(
        {
          seekerId: 'seeker-1',
          mentorId: 'mentor-1',
          segmentId: 'seg-rel',
          gigId: 'gig-rel-60',
          startTime: validFutureStartUtc,
          endTime: validFutureEndUtc,
          currentUtcTime: fixedCurrentUtc,
        },
        db
      );

      assert.equal(res.success, false);
      assert.equal(res.error?.code, 'GIG_INACTIVE');
      assert.equal(db.bookings.length, 0);
    });

    it('6. rejects duration mismatch where slot bounds do not match gig duration', async () => {
      // Trying to book a 30-minute interval for a 60-minute gig
      const wrongEndUtc = '2026-09-21T05:00:00.000Z'; // 30 minutes

      const res = await executeAtomicBookingWithHold(
        {
          seekerId: 'seeker-1',
          mentorId: 'mentor-1',
          segmentId: 'seg-rel',
          gigId: 'gig-rel-60',
          startTime: validFutureStartUtc,
          endTime: wrongEndUtc,
          currentUtcTime: fixedCurrentUtc,
        },
        db
      );

      assert.equal(res.success, false);
      assert.equal(res.error?.code, 'DURATION_MISMATCH');
      assert.equal(db.bookings.length, 0);
    });

    it('8. rejects past slots (PAST_SLOT_FORBIDDEN)', async () => {
      // Server UTC is Sep 20, 2026, 20:00 UTC.
      // Attempting to book a slot that began in the past
      const pastStartUtc = '2026-09-20T10:00:00.000Z';
      const pastEndUtc = '2026-09-20T11:00:00.000Z';

      const res = await executeAtomicBookingWithHold(
        {
          seekerId: 'seeker-1',
          mentorId: 'mentor-1',
          segmentId: 'seg-rel',
          gigId: 'gig-rel-60',
          startTime: pastStartUtc,
          endTime: pastEndUtc,
          currentUtcTime: fixedCurrentUtc,
        },
        db
      );

      assert.equal(res.success, false);
      assert.equal(res.error?.code, 'PAST_SLOT_FORBIDDEN');
      assert.equal(db.bookings.length, 0);
    });

    it('9. rejects slots outside mentor recurring availability (OUTSIDE_AVAILABILITY)', async () => {
      // Mentor operates 10:00 - 18:00 IST on Monday.
      // Attempting to book 08:00 - 09:00 IST (02:30 - 03:30 UTC)
      const earlyStartUtc = '2026-09-21T02:30:00.000Z';
      const earlyEndUtc = '2026-09-21T03:30:00.000Z';

      const res = await executeAtomicBookingWithHold(
        {
          seekerId: 'seeker-1',
          mentorId: 'mentor-1',
          segmentId: 'seg-rel',
          gigId: 'gig-rel-60',
          startTime: earlyStartUtc,
          endTime: earlyEndUtc,
          currentUtcTime: fixedCurrentUtc,
        },
        db
      );

      assert.equal(res.success, false);
      assert.equal(res.error?.code, 'OUTSIDE_AVAILABILITY');
      assert.equal(db.bookings.length, 0);
    });

    it('10. rejects slots on mentor date exception leave (DATE_EXCEPTION_UNAVAILABLE)', async () => {
      db.mentorAvailabilityExceptions.push({
        id: 'exc-leave-1',
        mentor_id: 'mentor-1',
        exception_date: '2026-09-21',
        is_available: false,
        start_time: null,
        end_time: null,
        reason: 'Personal leave',
        created_at: '2026-01-01T00:00:00Z',
      });

      const res = await executeAtomicBookingWithHold(
        {
          seekerId: 'seeker-1',
          mentorId: 'mentor-1',
          segmentId: 'seg-rel',
          gigId: 'gig-rel-60',
          startTime: validFutureStartUtc,
          endTime: validFutureEndUtc,
          currentUtcTime: fixedCurrentUtc,
        },
        db
      );

      assert.equal(res.success, false);
      assert.equal(res.error?.code, 'DATE_EXCEPTION_UNAVAILABLE');
      assert.equal(db.bookings.length, 0);
    });

    it('11. rejects slots conflicting with existing non-cancelled bookings (SLOT_ALREADY_BOOKED)', async () => {
      // Existing confirmed booking on the slot
      db.bookings.push({
        id: 'bk-existing',
        booking_code: 'BK-EXISTING',
        mentor_id: 'mentor-1',
        seeker_id: 'seeker-2',
        gig_id: 'gig-rel-60',
        segment_id: 'seg-rel',
        hold_id: null,
        start_time: validFutureStartUtc,
        end_time: validFutureEndUtc,
        seeker_timezone: 'Asia/Kolkata',
        mentor_timezone: 'Asia/Kolkata',
        amount_inr: 999,
        status: 'CONFIRMED',
        meeting_url: null,
        cancellation_reason: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      });

      const res = await executeAtomicBookingWithHold(
        {
          seekerId: 'seeker-1',
          mentorId: 'mentor-1',
          segmentId: 'seg-rel',
          gigId: 'gig-rel-60',
          startTime: validFutureStartUtc,
          endTime: validFutureEndUtc,
          currentUtcTime: fixedCurrentUtc,
        },
        db
      );

      assert.equal(res.success, false);
      assert.equal(res.error?.code, 'SLOT_ALREADY_BOOKED');
      assert.equal(db.bookings.length, 1); // Only original existing booking exists
    });

    it('12. active hold blocks other seekers; expired hold releases slot', async () => {
      // Step A: Active unexpired hold by seeker-2
      const futureHoldExpires = new Date(fixedCurrentUtc.getTime() + 10 * 60 * 1000).toISOString(); // +10 min
      db.slotHolds.push({
        id: 'hold-active',
        mentor_id: 'mentor-1',
        seeker_id: 'seeker-2',
        gig_id: 'gig-rel-60',
        start_time: validFutureStartUtc,
        end_time: validFutureEndUtc,
        status: 'ACTIVE',
        expires_at: futureHoldExpires,
        created_at: fixedCurrentUtc.toISOString(),
      });

      // Seeker-1 tries to book the same slot
      const blockedRes = await executeAtomicBookingWithHold(
        {
          seekerId: 'seeker-1',
          mentorId: 'mentor-1',
          segmentId: 'seg-rel',
          gigId: 'gig-rel-60',
          startTime: validFutureStartUtc,
          endTime: validFutureEndUtc,
          currentUtcTime: fixedCurrentUtc,
        },
        db
      );

      assert.equal(blockedRes.success, false);
      assert.equal(blockedRes.error?.code, 'SLOT_HELD_BY_OTHER');

      // Step B: Hold expires (+16 min passes)
      const afterExpiryUtc = new Date(fixedCurrentUtc.getTime() + 16 * 60 * 1000);

      const successRes = await executeAtomicBookingWithHold(
        {
          seekerId: 'seeker-1',
          mentorId: 'mentor-1',
          segmentId: 'seg-rel',
          gigId: 'gig-rel-60',
          startTime: validFutureStartUtc,
          endTime: validFutureEndUtc,
          currentUtcTime: afterExpiryUtc,
        },
        db
      );

      assert.equal(successRes.success, true);
      assert.equal(successRes.booking?.status, 'PAYMENT_PENDING');
      assert.equal(successRes.hold?.status, 'ACTIVE');
      assert.equal(db.slotHolds[0].status, 'EXPIRED'); // Previous hold was expired
    });
  });

  // --------------------------------------------------------------------------
  // Complete Booking Creation Flow & Atomicity
  // --------------------------------------------------------------------------
  describe('Atomic Booking & 15-Minute Hold Creation', () => {
    it('creates 15-minute hold and PAYMENT_PENDING booking atomically', async () => {
      const res = await executeAtomicBookingWithHold(
        {
          seekerId: 'seeker-1',
          mentorId: 'mentor-1',
          segmentId: 'seg-rel',
          gigId: 'gig-rel-60',
          startTime: validFutureStartUtc,
          endTime: validFutureEndUtc,
          currentUtcTime: fixedCurrentUtc,
        },
        db
      );

      assert.equal(res.success, true);
      assert.ok(res.booking);
      assert.ok(res.hold);

      // Verify Hold
      assert.equal(res.hold.status, 'ACTIVE');
      assert.equal(res.hold.mentor_id, 'mentor-1');
      assert.equal(res.hold.seeker_id, 'seeker-1');
      const holdDurationMin =
        (new Date(res.hold.expires_at).getTime() - fixedCurrentUtc.getTime()) / 60000;
      assert.equal(holdDurationMin, 15);

      // Verify Booking
      assert.equal(res.booking.status, 'PAYMENT_PENDING');
      assert.equal(res.booking.amount_inr, 999);
      assert.equal(res.booking.hold_id, res.hold.id);
      assert.ok(res.booking.booking_code.startsWith('BK-'));

      // Both hold and booking committed to database
      assert.equal(db.slotHolds.length, 1);
      assert.equal(db.bookings.length, 1);
    });

    it('creates zero partial records on validation failure (atomic guarantee)', async () => {
      // Intentionally supply an invalid interval
      const res = await executeAtomicBookingWithHold(
        {
          seekerId: 'seeker-1',
          mentorId: 'mentor-1',
          segmentId: 'seg-rel',
          gigId: 'gig-rel-60',
          startTime: validFutureEndUtc,
          endTime: validFutureStartUtc, // invalid: start > end
          currentUtcTime: fixedCurrentUtc,
        },
        db
      );

      assert.equal(res.success, false);
      assert.equal(db.slotHolds.length, 0);
      assert.equal(db.bookings.length, 0);
    });
  });

  // --------------------------------------------------------------------------
  // SIMULTANEOUS BOOKING ATTEMPTS (Concurrency Testing)
  // --------------------------------------------------------------------------
  describe('Simultaneous Booking Attempts Concurrency Tests', () => {
    it('allows exactly ONE seeker to secure the slot when multiple seekers attempt simultaneous booking', async () => {
      // Seeker 1 and Seeker 2 fire simultaneous requests at the exact same millisecond
      const attempt1 = executeAtomicBookingWithHold(
        {
          seekerId: 'seeker-1',
          mentorId: 'mentor-1',
          segmentId: 'seg-rel',
          gigId: 'gig-rel-60',
          startTime: validFutureStartUtc,
          endTime: validFutureEndUtc,
          currentUtcTime: fixedCurrentUtc,
        },
        db
      );

      const attempt2 = executeAtomicBookingWithHold(
        {
          seekerId: 'seeker-2',
          mentorId: 'mentor-1',
          segmentId: 'seg-rel',
          gigId: 'gig-rel-60',
          startTime: validFutureStartUtc,
          endTime: validFutureEndUtc,
          currentUtcTime: fixedCurrentUtc,
        },
        db
      );

      const [res1, res2] = await Promise.all([attempt1, attempt2]);

      // Exactly one must succeed, and exactly one must fail with conflict
      const successes = [res1, res2].filter((r) => r.success);
      const failures = [res1, res2].filter((r) => !r.success);

      assert.equal(successes.length, 1, 'Exactly one concurrent booking must succeed');
      assert.equal(failures.length, 1, 'The competing concurrent booking must fail');

      const winningResult = successes[0];
      const losingResult = failures[0];

      assert.equal(winningResult.booking?.status, 'PAYMENT_PENDING');
      assert.equal(winningResult.hold?.status, 'ACTIVE');

      assert.equal(losingResult.error?.code, 'SLOT_HELD_BY_OTHER');

      // Database state reflects exactly 1 active hold and 1 payment_pending booking
      assert.equal(db.slotHolds.length, 1);
      assert.equal(db.bookings.length, 1);
      assert.equal(db.bookings[0].seeker_id, winningResult.booking?.seeker_id);
    });

    it('handles 5 concurrent requests for the same slot safely with only 1 winner', async () => {
      // Register 5 seeker profiles
      for (let i = 3; i <= 5; i++) {
        db.profiles.push({
          id: `seeker-${i}`,
          email: `seeker${i}@test.com`,
          full_name: `Seeker ${i}`,
          timezone: 'Asia/Kolkata',
          avatar_url: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        });
        db.userRoles.push({ user_id: `seeker-${i}`, role: 'seeker' });
      }

      const seekers = ['seeker-1', 'seeker-2', 'seeker-3', 'seeker-4', 'seeker-5'];

      const concurrentAttempts = seekers.map((sId) =>
        executeAtomicBookingWithHold(
          {
            seekerId: sId,
            mentorId: 'mentor-1',
            segmentId: 'seg-rel',
            gigId: 'gig-rel-60',
            startTime: validFutureStartUtc,
            endTime: validFutureEndUtc,
            currentUtcTime: fixedCurrentUtc,
          },
          db
        )
      );

      const results = await Promise.all(concurrentAttempts);

      const successful = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);

      assert.equal(successful.length, 1, 'Only 1 out of 5 simultaneous seekers can acquire the slot');
      assert.equal(failed.length, 4, 'The other 4 simultaneous seekers must be rejected');

      failed.forEach((f) => {
        assert.equal(f.error?.code, 'SLOT_HELD_BY_OTHER');
      });

      assert.equal(db.slotHolds.length, 1);
      assert.equal(db.bookings.length, 1);
    });
  });
});
