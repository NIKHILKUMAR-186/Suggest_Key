import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveNotificationLink,
  notificationActionLabel,
} from '../src/lib/notificationService';
import {
  PAYMENT_QR_MAX_BYTES,
  PAYMENT_QR_MAX_LABEL,
  validateQrFile,
  validateUpiId,
} from '../src/lib/paymentProof';

const PAYMENT_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const BOOKING_ID = '9c858901-8a57-4791-81fe-4c455b099bc9';

describe('admin notification routing: never lands on a participant page', () => {
  test('a seeker payment link resolves to the admin payment queue', () => {
    const link = resolveNotificationLink('/seeker/payment?bookingId=abc', 'admin', null);
    assert.ok(link);
    assert.ok(link!.startsWith('/admin/payments'), `expected an admin route, got ${link}`);
  });

  test('a payment notification carries its own payment record id to the queue', () => {
    // entityId is the payment id the server wrote for this notification, so the
    // destination identifies the real record rather than a hardcoded one.
    const link = resolveNotificationLink('/seeker/payment?bookingId=abc', 'admin', PAYMENT_ID);
    assert.equal(link, `/admin/payments?paymentId=${PAYMENT_ID}`);
  });

  test('a booking link resolves to the admin bookings ledger', () => {
    const link = resolveNotificationLink('/seeker/bookings', 'admin', BOOKING_ID);
    assert.equal(link, `/admin/bookings?bookingId=${BOOKING_ID}`);
  });

  test('a workspace link resolves to the admin workspaces queue', () => {
    const link = resolveNotificationLink('/seeker/workspace?bookingId=abc', 'admin', null);
    assert.ok(link);
    assert.ok(link!.startsWith('/admin/workspaces'), `expected an admin route, got ${link}`);
  });

  test('a mentor link resolves to an admin route, never to /mentor', () => {
    for (const source of ['/mentor/bookings', '/mentor/booking-detail?bookingId=abc', '/mentor/workspace']) {
      const link = resolveNotificationLink(source, 'admin', null);
      assert.ok(link);
      assert.ok(link!.startsWith('/admin/'), `${source} must not resolve to ${link}`);
    }
  });

  test('an unknown participant path falls back to the admin bookings ledger', () => {
    // An unrecognised /seeker/* path is still known to be about a booking, so it
    // resolves to the admin bookings ledger and carries the record reference.
    assert.equal(
      resolveNotificationLink('/seeker/something-new', 'admin', BOOKING_ID),
      `/admin/bookings?bookingId=${BOOKING_ID}`,
    );
  });

  test('a path outside every known area falls back to the admin console', () => {
    assert.equal(resolveNotificationLink('/unknown/place', 'admin', null), '/admin');
    assert.equal(resolveNotificationLink('/', 'admin', null), '/admin');
  });

  test('an already-admin link is preserved but stripped of participant query state', () => {
    assert.equal(resolveNotificationLink('/admin/payments', 'admin', null), '/admin/payments');
    assert.equal(
      resolveNotificationLink('/admin/payments?bookingId=abc', 'admin', null),
      '/admin/payments',
    );
  });

  test('exhaustive: no admin resolution may ever start with /seeker or /mentor', () => {
    const sources = [
      null,
      undefined,
      '',
      '/',
      '/seeker/payment?bookingId=abc',
      '/seeker/bookings?bookingId=abc',
      '/seeker/session?bookingId=abc',
      '/seeker/workspace?bookingId=abc',
      '/mentor/bookings',
      '/mentor/booking-detail?bookingId=abc',
      '/mentor/workspace?bookingId=abc',
      '/admin/payments',
      '/admin/bookings?bookingId=abc',
      '/admin/mentor-verification/abc',
      'javascript:alert(1)',
      'https://evil.example.com/payments',
    ];
    for (const source of sources) {
      const link = resolveNotificationLink(source as string | null, 'admin', BOOKING_ID);
      if (link === null) continue;
      assert.ok(
        !link.startsWith('/seeker') && !link.startsWith('/mentor') && !link.startsWith('//'),
        `${String(source)} resolved to a non-admin route: ${link}`,
      );
      assert.ok(
        link === '/admin' || link.startsWith('/admin/'),
        `${String(source)} resolved outside the admin area: ${link}`,
      );
    }
  });

  test('a non-uuid record id is not forwarded as a record reference', () => {
    // Prevents an arbitrary string from the database being spliced into a URL.
    const link = resolveNotificationLink('/seeker/payment', 'admin', 'not-a-uuid');
    assert.equal(link, '/admin/payments');
  });
});

describe('admin notification routing: participants are kept in their own area', () => {
  test('a seeker is never sent to an admin or mentor page', () => {
    for (const source of ['/admin/payments', '/mentor/bookings', '/seeker/bookings']) {
      const link = resolveNotificationLink(source, 'seeker', null);
      assert.ok(link);
      assert.ok(
        !link!.startsWith('/admin') && !link!.startsWith('/mentor'),
        `${source} resolved to ${link} for a seeker`,
      );
    }
  });

  test('a mentor is never sent to an admin page', () => {
    const link = resolveNotificationLink('/admin/payments', 'mentor', null);
    assert.equal(link, '/mentor');
  });

  test('a participant link is left untouched', () => {
    const source = '/seeker/bookings?bookingId=abc';
    assert.equal(resolveNotificationLink(source, 'seeker', null), source);
  });
});

describe('notification action label', () => {
  test('labels follow the resolved destination, not the raw link', () => {
    assert.equal(notificationActionLabel('/admin/payments?paymentId=x'), 'Review Payment');
    assert.equal(notificationActionLabel('/admin/bookings?bookingId=x'), 'View Booking');
    assert.equal(notificationActionLabel('/admin/workspaces?bookingId=x'), 'Open Workspace');
    assert.equal(notificationActionLabel('/admin/mentor-verification/abc'), 'Review Application');
    assert.equal(notificationActionLabel('/admin/settings'), 'Open Settings');
    assert.equal(notificationActionLabel('/admin'), 'View Details');
  });

  test('has no button when there is no destination', () => {
    assert.equal(notificationActionLabel(null), null);
  });
});

describe('payment QR validation', () => {
  test('accepts a real PNG under the size limit', () => {
    const result = validateQrFile({ name: 'qr.png', type: 'image/png', size: 40_000 });
    assert.equal(result.ok, true);
  });

  test('accepts every MIME type the bucket allows', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      const result = validateQrFile({ name: 'qr', type, size: 1_000 });
      assert.equal(result.ok, true, `${type} should be accepted`);
    }
  });

  test('rejects a PDF, which is not scannable as a QR', () => {
    const result = validateQrFile({ name: 'qr.pdf', type: 'application/pdf', size: 1_000 });
    assert.equal(result.ok, false);
  });

  test('rejects an empty file', () => {
    assert.equal(validateQrFile({ name: 'qr.png', type: 'image/png', size: 0 }).ok, false);
  });

  test('rejects a file over the real byte ceiling', () => {
    const result = validateQrFile({ name: 'qr.png', type: 'image/png', size: PAYMENT_QR_MAX_BYTES + 1 });
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.message.includes(PAYMENT_QR_MAX_LABEL));
  });

  test('rejects a missing file', () => {
    assert.equal(validateQrFile(null).ok, false);
    assert.equal(validateQrFile(undefined).ok, false);
  });
});

describe('UPI id validation', () => {
  test('accepts a realistic handle and trims whitespace', () => {
    const result = validateUpiId('  suggestkey@oksbi  ');
    assert.equal(result.ok, true);
    assert.ok(result.ok && result.value === 'suggestkey@oksbi');
  });

  test('rejects a handle with no provider', () => {
    const result = validateUpiId('suggestkey');
    assert.equal(result.ok, false);
  });

  test('rejects an empty or whitespace-only value', () => {
    for (const value of ['', '   ', null, undefined, 42]) {
      assert.equal(validateUpiId(value as unknown).ok, false, `${JSON.stringify(value)} must be rejected`);
    }
  });

  test('rejects an implausibly long value', () => {
    assert.equal(validateUpiId(`${'a'.repeat(200)}@bank`).ok, false);
  });
});
