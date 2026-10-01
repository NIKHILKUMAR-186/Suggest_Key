import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MEETING_LINK_DEADLINE_MINUTES,
  buildDashboardExceptions,
  countBookingsByStatus,
  countDistinctUsersByRole,
  formatRelativeAge,
  getBookingStatusMeta,
  getDisplayDayBoundsUtc,
  humanizeAuditAction,
  isKnownBookingStatus,
  isSameDisplayDay,
  isStaleSlotHold,
  selectHighestPrioritySegment,
  type DeadlineCandidate,
} from '../src/lib/adminDashboard';
import { APP_CONFIG } from '../src/config/app';

const IST = 'Asia/Kolkata';

describe('Admin dashboard — booking state counts', () => {
  it('counts every authoritative booking state and ignores unknown values', () => {
    const counts = countBookingsByStatus([
      { status: 'CONFIRMED' },
      { status: 'CONFIRMED' },
      { status: 'MENTOR_PENDING' },
      { status: 'PAYMENT_PENDING' },
      { status: 'SOMETHING_ELSE' },
    ]);

    assert.equal(counts.CONFIRMED, 2);
    assert.equal(counts.MENTOR_PENDING, 1);
    assert.equal(counts.PAYMENT_PENDING, 1);
    assert.equal(counts.CANCELLED, 0);
    assert.equal(counts.COMPLETED, 0);
  });

  it('recognises only the states defined by the booking state machine', () => {
    assert.equal(isKnownBookingStatus('CONFIRMED'), true);
    assert.equal(isKnownBookingStatus('NOT_A_STATE'), false);
    assert.equal(getBookingStatusMeta('CONFIRMED').tone, 'confirmed');
    assert.equal(getBookingStatusMeta('NOT_A_STATE').tone, 'neutral');
    assert.equal(getBookingStatusMeta(null).label, 'Unknown');
  });
});

describe('Admin dashboard — user role counting', () => {
  it('never counts the same user twice', () => {
    const counts = countDistinctUsersByRole([
      { user_id: 'u1', role: 'seeker' },
      { user_id: 'u1', role: 'mentor' },
      { user_id: 'u2', role: 'seeker' },
      { user_id: 'u3', role: 'admin' },
    ]);

    assert.equal(counts.seeker, 2);
    assert.equal(counts.mentor, 1);
    assert.equal(counts.admin, 1);
  });

  it('skips malformed rows instead of throwing', () => {
    const counts = countDistinctUsersByRole([
      { user_id: '', role: 'seeker' },
      { user_id: 'u9', role: '' },
    ]);
    assert.equal(counts.seeker ?? 0, 0);
  });
});

describe('Admin dashboard — highest priority segment', () => {
  it('picks the lowest priority number among active segments', () => {
    const segments = [
      { id: '3', name: 'Career Mentor', priority: 3 },
      { id: '1', name: 'Relationship Advisior', priority: 1 },
      { id: '2', name: 'Autism Mentor', priority: 2 },
    ];
    assert.equal(selectHighestPrioritySegment(segments)?.name, 'Relationship Advisior');
  });

  it('returns null when no segment is active — no hardcoded fallback name', () => {
    assert.equal(selectHighestPrioritySegment([]), null);
  });

  it('follows a database change without any code change', () => {
    const before = [{ id: '1', name: 'Autism Mentor', priority: 1 }];
    const after = [
      { id: '1', name: 'Autism Mentor', priority: 1 },
      { id: '2', name: 'Career Mentor', priority: 0 },
    ];
    assert.equal(selectHighestPrioritySegment(before)?.name, 'Autism Mentor');
    assert.equal(selectHighestPrioritySegment(after)?.name, 'Career Mentor');
  });
});

describe('Admin dashboard — display day boundaries', () => {
  it('resolves the IST day window in UTC', () => {
    // 2026-09-26T18:30:00Z === 2026-09-27 00:00 IST
    const bounds = getDisplayDayBoundsUtc(new Date('2026-09-26T18:30:00.000Z'), IST);
    assert.equal(bounds.startUtc, '2026-09-26T18:30:00.000Z');
    assert.equal(bounds.endUtc, '2026-09-27T18:30:00.000Z');
  });

  it('classifies instants against the display day, not browser-local time', () => {
    const now = new Date('2026-09-26T06:00:00.000Z'); // 11:30 IST on 26 Sep
    // 10:30 IST on 26 Sep -> same display day
    assert.equal(isSameDisplayDay('2026-09-26T05:00:00.000Z', now, IST), true);
    // 15:30 IST on 25 Sep -> previous display day
    assert.equal(isSameDisplayDay('2026-09-25T10:00:00.000Z', now, IST), false);
    // 01:30 IST on 26 Sep -> still the same display day (UTC date differs)
    assert.equal(isSameDisplayDay('2026-09-25T20:00:00.000Z', now, IST), true);
  });
});

describe('Admin dashboard — meeting-link exception centre', () => {
  const now = new Date('2026-09-26T10:00:00.000Z');

  const candidate = (overrides: Partial<DeadlineCandidate>): DeadlineCandidate => ({
    id: 'b1',
    booking_code: 'BK-1',
    status: 'MENTOR_PENDING',
    start_time: '2026-09-26T14:00:00.000Z',
    meeting_url: null,
    ...overrides,
  });

  it('flags a booking inside the final 5 minutes with no link as overdue', () => {
    // Session at 10:03Z -> deadline 09:58Z, already passed at "now" (10:00Z).
    const exceptions = buildDashboardExceptions(
      [candidate({ start_time: '2026-09-26T10:03:00.000Z' })],
      [],
      now,
    );
    assert.equal(exceptions.length, 1);
    assert.equal(exceptions[0].kind, 'MEETING_LINK_OVERDUE');
    assert.equal(exceptions[0].severity, 'critical');
    // The business rule is preserved: an exception never implies cancellation.
    assert.match(exceptions[0].detail, /NOT auto-cancelled/);
  });

  it('does not flag a booking the old 2-hour rule would have caught', () => {
    // Session at 11:00Z is 60 minutes out. The 2-hour rule called this overdue;
    // the 5-minute rule must not.
    const exceptions = buildDashboardExceptions(
      [candidate({ start_time: '2026-09-26T11:00:00.000Z' })],
      [],
      now,
    );
    assert.equal(exceptions[0].kind, 'MEETING_LINK_DUE_SOON');
    assert.equal(exceptions[0].severity, 'warning');
  });

  it('flags an approaching deadline as a warning, not a critical', () => {
    // Session at 12:30Z -> far outside the 5-minute window, so not yet overdue.
    const exceptions = buildDashboardExceptions(
      [candidate({ start_time: '2026-09-26T12:30:00.000Z' })],
      [],
      now,
    );
    assert.equal(exceptions[0].kind, 'MEETING_LINK_DUE_SOON');
    assert.equal(exceptions[0].severity, 'warning');
  });

  it('ignores bookings that already have a meeting link or are not MENTOR_PENDING', () => {
    const exceptions = buildDashboardExceptions(
      [
        candidate({ meeting_url: 'https://meet.google.com/abc-defg-hij' }),
        candidate({ id: 'b2', status: 'CONFIRMED' }),
      ],
      [],
      now,
    );
    assert.equal(exceptions.length, 0);
  });

  it('reports a session that already started without a meeting link', () => {
    const exceptions = buildDashboardExceptions(
      [candidate({ start_time: '2026-09-26T09:00:00.000Z' })],
      [],
      now,
    );
    assert.equal(exceptions[0].kind, 'MEETING_LINK_OVERDUE');
    assert.match(exceptions[0].title, /without a meeting link/);
  });

  it('detects expired slot holds from real expiry timestamps', () => {
    assert.equal(
      isStaleSlotHold({ status: 'ACTIVE', expires_at: '2026-09-26T09:59:00.000Z' }, now),
      true,
    );
    assert.equal(
      isStaleSlotHold({ status: 'ACTIVE', expires_at: '2026-09-26T10:05:00.000Z' }, now),
      false,
    );
    assert.equal(
      isStaleSlotHold({ status: 'CONVERTED', expires_at: '2026-09-26T09:00:00.000Z' }, now),
      false,
    );

    const exceptions = buildDashboardExceptions(
      [],
      [{ id: 'h1', status: 'ACTIVE', expires_at: '2026-09-26T09:00:00.000Z' }],
      now,
    );
    assert.equal(exceptions[0].kind, 'STALE_SLOT_HOLD');
  });

  it('orders critical exceptions first and caps the list', () => {
    const exceptions = buildDashboardExceptions(
      [
        candidate({ id: 'b2', start_time: '2026-09-26T10:02:00.000Z' }),
        candidate({ id: 'b1' }),
      ],
      [{ id: 'h1', status: 'ACTIVE', expires_at: '2026-09-26T09:00:00.000Z' }],
      now,
      { limit: 2 },
    );
    assert.equal(exceptions.length, 2);
    assert.equal(exceptions[0].severity, 'critical');
  });

  it('uses the project meeting-link deadline rule of 5 minutes', () => {
    assert.equal(MEETING_LINK_DEADLINE_MINUTES, 5);
    assert.equal(MEETING_LINK_DEADLINE_MINUTES, APP_CONFIG.MEETING_LINK_DEADLINE_MS / 60_000);
    assert.notEqual(MEETING_LINK_DEADLINE_MINUTES, 120);
  });
});

describe('Admin dashboard — activity presentation', () => {
  it('humanises real audit actions without inventing new ones', () => {
    assert.equal(humanizeAuditAction('MENTOR_APPROVED'), 'Mentor approved');
    assert.equal(humanizeAuditAction('MENTOR_AVAILABILITY_UPDATED_BY_ADMIN'), 'Mentor availability updated by admin');
    assert.equal(humanizeAuditAction(''), 'System event');
  });

  it('formats a relative age from real timestamps', () => {
    const now = new Date('2026-09-26T10:00:00.000Z');
    assert.equal(formatRelativeAge('2026-09-26T09:56:00.000Z', now), '4m ago');
    assert.equal(formatRelativeAge('2026-09-26T07:00:00.000Z', now), '3h ago');
    assert.equal(formatRelativeAge('not-a-date', now), '—');
  });
});
