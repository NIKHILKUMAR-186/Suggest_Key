import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  isRefundOwed,
  projectAdminPayment,
  type AdminPaymentRow,
  type AdminPaymentSource,
} from '../src/lib/adminPaymentView';

const root = join(import.meta.dirname, '..');
const serverSrc = readFileSync(join(root, 'server.ts'), 'utf8');

/** A manual UPI/QR payment: the pre-existing shape, with no gateway columns. */
const manualRow: AdminPaymentSource = {
  id: 'pay-1',
  booking_id: 'bk-1',
  amount_inr: 499,
  created_at: '2026-09-01T10:00:00.000Z',
  status: 'PENDING_VERIFICATION',
  transaction_reference: 'UPIREF123',
  rejection_reason: null,
  verified_at: null,
  booking: { booking_code: 'SK-1', status: 'PENDING_VERIFICATION', seeker_id: 's1', mentor_id: 'm1', gig_id: 'g1' },
};

/** A gateway payment, as the optional Razorpay path would write it. */
const gatewayRow: AdminPaymentSource = {
  id: 'pay-2',
  booking_id: 'bk-2',
  amount_inr: 999,
  created_at: '2026-09-02T10:00:00.000Z',
  status: 'FAILED',
  transaction_reference: null,
  gateway: 'razorpay',
  razorpay_order_id: 'order_ABC',
  razorpay_payment_id: 'pay_XYZ',
  refund_status: 'PENDING',
  refund_id: null,
  failure_reason: 'gateway returned BAD_REQUEST_ERROR',
  booking: { booking_code: 'SK-2', status: 'PAYMENT_PENDING', seeker_id: 's2', mentor_id: 'm2', gig_id: 'g2' },
};


describe('Admin payment view — manual UPI/QR (P2-5)', () => {
  it('preserves every field the admin queue already showed', () => {
    const row = projectAdminPayment(manualRow, {
      seekerName: 'Asha',
      mentorName: 'Vikram',
      gigTitle: 'Career Session',
      proofUrl: 'https://signed.example/proof.png',
    });

    assert.equal(row.id, 'pay-1');
    assert.equal(row.bookingCode, 'SK-1');
    assert.equal(row.bookingStatus, 'PENDING_VERIFICATION');
    assert.equal(row.seekerName, 'Asha');
    assert.equal(row.mentorName, 'Vikram');
    assert.equal(row.gigTitle, 'Career Session');
    assert.equal(row.amount, 499);
    assert.equal(row.transactionReference, 'UPIREF123');
    assert.equal(row.status, 'PENDING_VERIFICATION');
    assert.equal(row.proofUrl, 'https://signed.example/proof.png');
  });

  it('reports a missing gateway as manual, not as a null the UI must interpret', () => {
    assert.equal(projectAdminPayment(manualRow).gateway, 'manual');
  });

  it('leaves the Razorpay and refund fields null instead of inventing values', () => {
    const row = projectAdminPayment(manualRow);
    assert.equal(row.razorpayOrderId, null);
    assert.equal(row.razorpayPaymentId, null);
    assert.equal(row.refundStatus, null);
    assert.equal(row.refundId, null);
    assert.equal(row.failureReason, null);
  });

  it('does not fabricate a name when the joined id is absent', () => {
    const row = projectAdminPayment(
      { ...manualRow, booking: { booking_code: 'SK-1', seeker_id: null, mentor_id: null, gig_id: null } },
      { seekerName: 'Asha', mentorName: 'Vikram', gigTitle: 'Career Session' },
    );
    assert.equal(row.seekerName, null);
    assert.equal(row.mentorName, null);
    assert.equal(row.gigTitle, null);
  });
});

describe('Admin payment view — gateway payments (P2-5)', () => {
  it('exposes the gateway and both Razorpay identifiers', () => {
    const row = projectAdminPayment(gatewayRow);
    assert.equal(row.gateway, 'razorpay');
    assert.equal(row.razorpayOrderId, 'order_ABC');
    assert.equal(row.razorpayPaymentId, 'pay_XYZ');
  });

  it('returns refund_status, refund_id and failure_reason exactly as stored', () => {
    const row = projectAdminPayment(gatewayRow);
    assert.equal(row.refundStatus, 'PENDING');
    assert.equal(row.refundId, null);
    assert.equal(row.failureReason, 'gateway returned BAD_REQUEST_ERROR');

describe('Admin payment view — refunds owed filter (P2-5)', () => {
  const project = (src: Partial<AdminPaymentSource> & { id: string }): AdminPaymentRow =>
    projectAdminPayment({
      booking_id: 'bk',
      amount_inr: 100,
      created_at: null,
      status: 'VERIFIED',
      ...src,
    });

  it('flags only a PENDING refund, not a settled or failed one', () => {
    assert.equal(isRefundOwed(project({ id: 'a', refund_status: 'PENDING' })), true);
    assert.equal(isRefundOwed(project({ id: 'b', refund_status: 'REFUNDED' })), false);
    assert.equal(isRefundOwed(project({ id: 'c', refund_status: 'FAILED' })), false);
    assert.equal(isRefundOwed(project({ id: 'd', refund_status: null })), false);
    assert.equal(isRefundOwed(project({ id: 'e' })), false);
  });

  it('treats refund_status as independent of payment status', () => {
    // A verified payment can still be owed a refund; conflating the two columns
    // would hide exactly the rows an operator needs to see.
    assert.equal(isRefundOwed(project({ id: 'f', status: 'VERIFIED', refund_status: 'PENDING' })), true);
  });
});

describe('Admin payment view — security boundaries (P2-5)', () => {
  it('serves the extended projection only behind requireAuth and requireAdmin', () => {
    const route = serverSrc.slice(serverSrc.indexOf("app.get('/api/admin/payments'"));
    const header = route.slice(0, route.indexOf('async (req'));
    assert.match(header, /requireAuth/);
    assert.match(header, /requireAdmin/);
  });

  it('never projects the gateway signature or any secret', () => {
    assert.doesNotMatch(serverSrc, /gateway_signature|webhook_secret|key_secret/);
  });

  it('does not write, refund, or reconcile from the read model', () => {
    const lib = readFileSync(join(root, 'src', 'lib', 'adminPaymentView.ts'), 'utf8');
    // A read model only reads: no client, no network, no mutation verbs.
    assert.doesNotMatch(lib, /supabase|\.insert\(|\.update\(|\.upsert\(|fetch\(/i);
  });
});

  });

  it('returns a completed refund id when one exists', () => {
    const row = projectAdminPayment({
      ...gatewayRow,
      status: 'REFUNDED',
      refund_status: 'REFUNDED',
      refund_id: 'rfnd_123',
    });
    assert.equal(row.refundStatus, 'REFUNDED');
    assert.equal(row.refundId, 'rfnd_123');
    assert.equal(row.status, 'REFUNDED');
  });
});
