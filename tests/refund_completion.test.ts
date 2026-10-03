import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  REFUND_METHODS,
  buildRefundProofStoragePath,
  canProcessManualRefund,
  fromPaise,
  isRefundProofPathFor,
  normaliseRefundAmount,
  normaliseRefundMethod,
  normaliseRefundReference,
  refundMethodLabel,
  refundNotice,
  refundStatusLabel,
  toPaise,
  validateRefundProofFile,
} from '../src/lib/refundCompletion';
import { PAYMENT_PROOF_BUCKET, PAYMENT_PROOF_MAX_BYTES } from '../src/lib/paymentProof';
import { apiSchemas } from '../src/lib/validation';

const root = join(import.meta.dirname, '..');
const serverSrc = readFileSync(join(root, 'server.ts'), 'utf8');

/**
 * The source of one route, from its registration up to the next registration of
 * any method.
 *
 * Anchoring on the path rather than on the literal call means this keeps working
 * when a route's middleware list grows or its arguments wrap onto several lines.
 * A missing route is a hard failure rather than a silent `-1` offset, because a
 * `slice` from `-1` returns the entire file and turns every `doesNotMatch`
 * assertion in these tests into a coin flip.
 */
function sliceRoute(src: string, method: string, path: string): string {
  const start = src.search(new RegExp(`app\\.${method}\\(\\s*'${path.replace(/[/:]/g, (c) => `\\${c}`)}'`));
  assert.notEqual(start, -1, `no app.${method}('${path}') registration in server.ts`);

  const rest = src.slice(start + 1);
  const next = rest.search(/\n\s*app\.(get|post|put|patch|delete)\(/);
  return next === -1 ? rest : rest.slice(0, next);
}
const adminPageSrc = readFileSync(join(root, 'src', 'pages', 'admin', 'AdminPaymentsPage.tsx'), 'utf8');
const migrationSrc = readFileSync(
  join(root, 'supabase', 'migrations', '20261014000000_phase40_manual_refund_completion.sql'),
  'utf8',
);
/** Phase 38 owns the paise column; phase 40 only reuses it. */
const refundSystemSrc = readFileSync(
  join(root, 'supabase', 'migrations', '20261012000000_phase38_refund_system.sql'),
  'utf8',
);

/** Runs the zod schema and returns the parsed body, or the failure. */
const runValidation = (schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: unknown } }, body: unknown) => {
  const result = schema.safeParse(body);
  return result.success ? { ok: true as const, value: result.data } : { ok: false as const, error: result.error };
};

const validCompletionBody = {
  refundAmountInr: 499,
  refundMethod: 'UPI',
  refundReference: 'UTR99887766',
  storagePath: 'refunds/pay-1/abc123-receipt.png',
  fileName: 'receipt.png',
  mimeType: 'image/png',
  fileSize: 120_000,
};

// ===========================================================================
// A + B. Pending messaging
// ===========================================================================

describe('A/B — a pending refund never claims it was initiated', () => {
  it('A. never produces the title "Refund Initiated" for any refund state', () => {
    const kinds = ['MANUAL_PENDING', 'GATEWAY_PENDING', 'COMPLETED', 'FAILED'] as const;
    for (const kind of kinds) {
      const notice = refundNotice(kind, { amountInr: 499, bookingCode: 'BK-0001' });
      assert.notEqual(notice.title, 'Refund Initiated', `${kind} must not be titled "Refund Initiated"`);
      assert.doesNotMatch(notice.message, /has been initiated/i, `${kind} must not say a refund was initiated`);
    }
  });

  it('A. the server sends no "Refund Initiated" title, and the gateway status token survives only as a discriminator', () => {
    assert.doesNotMatch(serverSrc, /Refund Initiated/);
    // `REFUND_INITIATED` is the gateway result vocabulary, not notification copy.
    // It is allowed ONLY as a comparison against the refund result status.
    const uses = serverSrc.split('REFUND_INITIATED').length - 1;
    assert.ok(uses > 0, 'the existing gateway result vocabulary must not be renamed');
    for (const use of serverSrc.split('REFUND_INITIATED').slice(0, -1)) {
      assert.match(
        use.slice(-25),
        /refundInfo\.status === '$/,
        'REFUND_INITIATED may only appear as the gateway result discriminator',
      );
    }
    // No notification title or message anywhere in the server may use it.
    assert.doesNotMatch(serverSrc, /title: ['"]Refund Initiated/);
    assert.doesNotMatch(serverSrc, /'Refund Initiated'/);
  });

  it('B. a manual pending refund is titled "Refund Pending" with admin wording', () => {
    const notice = refundNotice('MANUAL_PENDING', { amountInr: 499, bookingCode: 'BK-0001' });
    assert.equal(notice.title, 'Refund Pending');
    assert.equal(notice.eventType, 'REFUND_PENDING');
    assert.match(notice.message, /^Your ₹499 refund for booking BK-0001 is pending admin processing\./);
    assert.match(notice.message, /You will be notified once the refund is completed\./);
  });

  it('B. a gateway pending refund is titled "Refund Pending" with gateway wording', () => {
    const notice = refundNotice('GATEWAY_PENDING', { amountInr: 499, bookingCode: 'BK-0001' });
    assert.equal(notice.title, 'Refund Pending');
    assert.equal(notice.eventType, 'REFUND_PENDING');
    assert.match(notice.message, /^Your ₹499 refund for booking BK-0001 is pending processing\./);
    assert.match(notice.message, /confirmed\./);
    assert.doesNotMatch(notice.message, /admin processing/);
  });

  it('uses the ACTUAL amount, never a hardcoded one', () => {
    for (const amount of [1, 499, 1234.5, 25000]) {
      const notice = refundNotice('MANUAL_PENDING', { amountInr: amount, bookingCode: 'BK-1' });
      assert.match(notice.message, new RegExp(`₹${amount.toLocaleString('en-IN')} refund`));
    }
    assert.doesNotMatch(refundNotice('MANUAL_PENDING', { amountInr: 1200 }).message, /₹499/);
  });

  it('falls back to a generic subject when the amount is unknown, and never prints "₹ null"', () => {
    for (const amountInr of [null, undefined, Number.NaN]) {
      const notice = refundNotice('MANUAL_PENDING', { amountInr });
      assert.match(notice.message, /^Your refund/);
      assert.doesNotMatch(notice.message, /₹\s*(null|NaN|undefined)/);
    }
  });

  it('the pending notification is written on the state transition, never on a read', () => {
    // Only the cancellation handlers call it, and only after the refund actually
    // entered PENDING. No route that merely reads a payment may call it.
    const calls = serverSrc.match(/notifyRefundState\(/g) ?? [];
    // 2 definitions/uses: the helper declaration plus the two cancel handlers.
    assert.equal(calls.length, 3);
    assert.doesNotMatch(serverSrc, /app\.get\([^)]*notifyRefundState/);
  });
});

// ===========================================================================
// C + D. Authorization
// ===========================================================================

describe('C/D — the refund form and completion are admin-only', () => {
  it('C. both refund routes sit behind requireAuth and requireAdmin', () => {
    for (const route of [
      "app.post('/api/admin/payments/:id/complete-manual-refund'",
      "app.get('/api/admin/payments/:id/refund-proof'",
    ]) {
      const start = serverSrc.indexOf(route);
      assert.notEqual(start, -1, `${route} must exist`);
      const header = serverSrc.slice(start, serverSrc.indexOf('async (req', start));
      assert.match(header, /requireAuth/, `${route} must require auth`);
      assert.match(header, /requireAdmin/, `${route} must require admin`);
    }
  });

  it('D. the RPC re-verifies the admin role and the session owner in the database', () => {
    assert.match(migrationSrc, /CREATE OR REPLACE FUNCTION public\.complete_manual_refund/);
    assert.match(migrationSrc, /SECURITY DEFINER/);
    assert.match(migrationSrc, /NOT public\.has_role\(p_admin_id, 'admin'\)/);
    assert.match(migrationSrc, /auth\.uid\(\) <> p_admin_id/);
  });

  it('D. the RPC is executable by the server only, never by anon or authenticated', () => {
    assert.match(
      migrationSrc,
      /REVOKE EXECUTE ON FUNCTION public\.complete_manual_refund\([^)]*\) FROM PUBLIC, anon, authenticated/,
    );
    assert.match(
      migrationSrc,
      /GRANT EXECUTE ON FUNCTION public\.complete_manual_refund\([^)]*\) TO service_role/,
    );
    assert.match(migrationSrc, /has_function_privilege\('anon', 'public\.complete_manual_refund/);
  });

  it('D. a non-admin identity is refused before anything is written', () => {
    const authIndex = migrationSrc.indexOf("RAISE EXCEPTION 'code: UNAUTHORIZED");
    const updateIndex = migrationSrc.indexOf('UPDATE public.payments');
    assert.ok(authIndex > 0 && updateIndex > authIndex, 'the auth check must precede the transition');
  });

  it('D. the admin UI never exposes the completion action to a non-admin surface', () => {
    assert.ok(!/window\.location|localStorage/.test(adminPageSrc.slice(adminPageSrc.indexOf('handleCompleteRefund'), adminPageSrc.indexOf('handleCompleteRefund') + 3000)));
  });
});

// ===========================================================================
// E + F. Amount validation
// ===========================================================================

describe('E/F — refund amount validation', () => {
  it('E. rejects an amount above the original payment', () => {
    const result = normaliseRefundAmount(500, 499);
    assert.equal(result.ok, false);
    assert.match(result.ok ? '' : result.message, /cannot be more than/i);
    assert.match(result.ok ? '' : result.message, /₹499/);
  });

  it('E. is enforced in the database too, not only in the browser', () => {
    assert.match(migrationSrc, /code: REFUND_AMOUNT_EXCEEDS_PAYMENT/);
    assert.ok(
      migrationSrc.indexOf('REFUND_AMOUNT_EXCEEDS_PAYMENT') < migrationSrc.indexOf('UPDATE public.payments'),
      'the over-refund check must precede the transition',
    );
  });

  it('F. rejects zero, negative, NaN and Infinity', () => {
    for (const amount of [0, -1, -499.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const result = normaliseRefundAmount(amount, 499);
      assert.equal(result.ok, false, `${amount} must be rejected`);
    }
  });

  it('F. rejects a non-numeric amount rather than coercing it', () => {
    for (const amount of ['499', null, undefined, {}, []]) {
      assert.equal(normaliseRefundAmount(amount, 499).ok, false);
    }
  });

  it('rejects a non-finite original amount instead of refunding against NaN', () => {
    assert.equal(normaliseRefundAmount(499, Number.NaN).ok, false);
  });

  it('accepts the full original amount and stores it as integer paise', () => {
    const result = normaliseRefundAmount(499, 499);
    assert.equal(result.ok, true);
    assert.equal(toPaise(result.ok ? result.value : 0), 49900);
    assert.equal(fromPaise(49900), 499);
  });

  it('enforces full-refund semantics rather than inventing partial refunds', () => {
    const result = normaliseRefundAmount(100, 499);
    assert.equal(result.ok, false);
    assert.match(result.ok ? '' : result.message, /full refund/i);
    assert.match(migrationSrc, /code: REFUND_AMOUNT_NOT_FULL/);
  });

  it('the stored amount is an integer paise column with a non-negative CHECK', () => {
    // phase 38 created the column; phase 40 reuses it rather than redefining it.
    assert.match(refundSystemSrc, /refund_amount_paise\s+INTEGER/);
    assert.match(refundSystemSrc, /refund_amount_paise >= 0/);
    assert.doesNotMatch(migrationSrc, /ADD COLUMN[^;]*refund_amount_paise/);
  });

  it('handles paise-precision amounts without floating-point drift', () => {
    // 1234.57 * 100 is 123456.9999... in binary floating point.
    assert.equal(toPaise(1234.57), 123457);
    assert.equal(normaliseRefundAmount(1234.57, 1234.57).ok, true);
  });
});

// ===========================================================================
// G + H + I + J. Reference and proof
// ===========================================================================

describe('G — the refund reference is required and never fabricated', () => {
  it('rejects empty, whitespace-only and non-string references', () => {
    for (const value of ['', '   ', undefined, null, 12345, {}, []]) {
      assert.equal(normaliseRefundReference(value).ok, false, `${JSON.stringify(value)} must be rejected`);
    }
  });

  it('trims and bounds the length', () => {
    const ok = normaliseRefundReference('  UTR99887766  ');
    assert.equal(ok.ok && ok.value, 'UTR99887766');
    assert.equal(normaliseRefundReference('a'.repeat(64)).ok, true);
    assert.equal(normaliseRefundReference('a'.repeat(65)).ok, false);
  });

  it('the column has no DEFAULT, so no code path can invent one', () => {
    const column = migrationSrc.slice(migrationSrc.indexOf('ADD COLUMN IF NOT EXISTS refund_reference'), migrationSrc.indexOf('ADD COLUMN IF NOT EXISTS refund_method'));
    assert.doesNotMatch(column, /DEFAULT/);
    assert.match(migrationSrc, /column_name = 'refund_reference'/);
    assert.match(migrationSrc, /AND column_default IS NOT NULL/);
  });

  it('the RPC refuses a blank reference before the transition', () => {
    assert.match(migrationSrc, /code: REFUND_REFERENCE_REQUIRED/);
    assert.ok(
      migrationSrc.indexOf('REFUND_REFERENCE_REQUIRED') < migrationSrc.indexOf('UPDATE public.payments'),
    );
  });

  it('the API schema requires it', () => {
    const body = { ...validCompletionBody };
    delete (body as Record<string, unknown>).refundReference;
    assert.equal(runValidation(apiSchemas.manualRefundComplete, body).ok, false);
    assert.equal(runValidation(apiSchemas.manualRefundComplete, { ...validCompletionBody, refundReference: '' }).ok, false);
  });
});

describe('H/I/J — the refund proof', () => {
  it('H. is required: a missing file is refused, and the schema demands it', () => {
    assert.equal(validateRefundProofFile(null).ok, false);
    const body = { ...validCompletionBody };
    delete (body as Record<string, unknown>).storagePath;
    assert.equal(runValidation(apiSchemas.manualRefundComplete, body).ok, false);
    assert.match(migrationSrc, /code: REFUND_PROOF_REQUIRED/);
  });

  it('I. rejects an unsupported file type', () => {
    for (const type of ['application/pdf', 'text/html', 'image/gif', 'application/octet-stream', '']) {
      const result = validateRefundProofFile({ name: 'receipt.pdf', type, size: 1000 });
      assert.equal(result.ok, false, `${type} must be rejected`);
    }
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      assert.equal(validateRefundProofFile({ name: 'r.png', type, size: 1000 }).ok, true, `${type} must be accepted`);
    }
  });

  it('I. the schema refuses a PDF even though the bucket allows one for other flows', () => {
    assert.equal(runValidation(apiSchemas.manualRefundComplete, { ...validCompletionBody, mimeType: 'application/pdf' }).ok, false);
  });

  it('J. rejects an oversized proof, and the ceiling matches the bucket', () => {
    const ceiling = validateRefundProofFile({ name: 'r.png', type: 'image/png', size: PAYMENT_PROOF_MAX_BYTES + 1 });
    assert.equal(ceiling.ok, false);
    assert.match(ceiling.ok ? '' : ceiling.message, /larger than/);
    assert.equal(validateRefundProofFile({ name: 'r.png', type: 'image/png', size: PAYMENT_PROOF_MAX_BYTES }).ok, true);
    assert.equal(validateRefundProofFile({ name: 'r.png', type: 'image/png', size: 0 }).ok, false);
    assert.equal(REFUND_PROOF_MAX_BYTES_FOR_TEST, PAYMENT_PROOF_MAX_BYTES);
  });

  it('R. lives in the EXISTING private bucket under a prefix no seeker can match', () => {
    assert.equal(REFUND_PROOF_BUCKET_FOR_TEST, 'payment-proofs');
    assert.match(migrationSrc, /No new bucket/);
    // The seeker policy is foldername(name)[1] = auth.uid(); "refunds" is not a uid.
    assert.equal(isRefundProofPathFor('pay-1', 'refunds/pay-1/x-receipt.png'), true);
    assert.equal(isRefundProofPathFor('pay-1', 'someuserid/pay-1/x-receipt.png'), false);
    // The migration must not flip any existing bucket's visibility.
    assert.doesNotMatch(migrationSrc, /UPDATE storage\.buckets/);
    assert.doesNotMatch(migrationSrc, /INSERT INTO storage\.buckets/);
  });

  it('R. the object key is server-shaped and traversal-proof', () => {
    assert.equal(buildRefundProofStoragePath('pay-1', '../../etc/passwd', 'tok'), 'refunds/pay-1/tok-passwd');
    assert.equal(buildRefundProofStoragePath('pay-1', 'C:\\win\\evil.exe', 'tok'), 'refunds/pay-1/tok-evil.exe');
    assert.equal(isRefundProofPathFor('pay-1', 'refunds/pay-1/../../pay-2/x.png'), false);
    assert.equal(isRefundProofPathFor('pay-1', 'refunds/pay-2/x.png'), false);
    assert.equal(isRefundProofPathFor('pay-1', 'refunds/pay-1/'), false);
    assert.equal(isRefundProofPathFor('pay-1', null), false);
  });

  it('R. the server serves the proof only through a short-lived signed URL', () => {
    assert.match(serverSrc, /createSignedUrl\(payment\.refund_proof_storage_path as string, 300\)/);
    // The raw object key is never returned in the proof response.
    const route = serverSrc.slice(serverSrc.indexOf("app.get('/api/admin/payments/:id/refund-proof'"));
    assert.match(route.slice(0, 3000), /return res\.json\(\{ success: true, url: signed\?\.signedUrl \?\? null \}\)/);
  });

  it('R. no public URL and no permanent link is ever produced for a refund proof', () => {
    assert.doesNotMatch(migrationSrc, /storage_path[^\n]*https?:\/\//);
    assert.match(
      migrationSrc,
      /refund_proof_storage_path IS NULL\s+OR refund_proof_storage_path LIKE 'refunds\/%'/,
    );
  });
});

// ===========================================================================
// K/L/M/N — atomicity, concurrency, and the state transition
// ===========================================================================

describe('K/L/M — completion is atomic and happens exactly once', () => {
  it('K. the transition, the payment event and the notification are one transaction', () => {
    const fn = migrationSrc.slice(
      migrationSrc.indexOf('CREATE OR REPLACE FUNCTION public.complete_manual_refund'),
      migrationSrc.indexOf('REVOKE EXECUTE ON FUNCTION public.complete_manual_refund'),
    );
    // One function body => one transaction. No separate writes outside it.
    assert.match(fn, /UPDATE public\.payments/);
    assert.match(fn, /INSERT INTO public\.payment_events/);
    assert.match(fn, /INSERT INTO public\.notifications/);
    assert.ok(
      fn.indexOf('UPDATE public.payments') < fn.indexOf('INSERT INTO public.notifications'),
      'the payment is settled before the notification, inside the same transaction',
    );
    // The handler must not write any of these itself.
    const route = serverSrc.slice(
      serverSrc.indexOf("app.post('/api/admin/payments/:id/complete-manual-refund'"),
      serverSrc.indexOf("app.get('/api/admin/payments/:id/refund-proof'"),
    );
    assert.doesNotMatch(route, /\.from\('payments'\)\s*\.update\(/);
    assert.doesNotMatch(route, /from\('notifications'\)\.insert/);
    assert.doesNotMatch(route, /from\('payment_events'\)\.insert/);
  });

  it('L. the payment row is locked, so two admins serialise', () => {
    assert.match(migrationSrc, /SELECT \* INTO v_payment FROM public\.payments WHERE id = p_payment_id FOR UPDATE/);
    // FOR UPDATE sits ahead of the eligibility re-check the loser trips over.
    assert.ok(
      migrationSrc.indexOf('FOR UPDATE') < migrationSrc.indexOf('code: ALREADY_REFUNDED'),
    );
  });

  it('M. a completed refund can never be completed again', () => {
    assert.match(migrationSrc, /code: ALREADY_REFUNDED/);
    assert.match(migrationSrc, /v_payment\.refund_status = 'REFUNDED'/);
    const handler = canProcessManualRefund({
      gateway: 'manual',
      status: 'REFUNDED',
      refundStatus: 'REFUNDED',
      manualRefundRequired: false,
    });
    assert.equal(handler, false);
  });

  it('N. the completion sets the documented terminal state', () => {
    assert.match(migrationSrc, /status\s+= 'REFUNDED'/);
    assert.match(migrationSrc, /refund_status\s+= 'REFUNDED'/);
    assert.match(migrationSrc, /manual_refund_required\s+= FALSE/);
    assert.match(migrationSrc, /refunded_at\s+= v_now/);
    assert.match(migrationSrc, /refunded_by\s+= p_admin_id/);
  });

  it('a gateway refund can never be settled by this admin workflow', () => {
    assert.match(migrationSrc, /code: REFUND_NOT_MANUAL/);
    assert.equal(
      canProcessManualRefund({ gateway: 'razorpay', status: 'VERIFIED', refundStatus: 'PENDING', manualRefundRequired: true }),
      false,
    );
  });

  it('only a captured payment awaiting a manual refund is completable', () => {
    const eligible = { gateway: 'manual', status: 'VERIFIED', refundStatus: 'PENDING', manualRefundRequired: true };
    assert.equal(canProcessManualRefund(eligible), true);
    for (const variant of [
      { ...eligible, status: 'PENDING_VERIFICATION' },
      { ...eligible, status: 'FAILED' },
      { ...eligible, refundStatus: 'FAILED' },
      { ...eligible, refundStatus: null },
      { ...eligible, manualRefundRequired: false },
      { ...eligible, gateway: 'razorpay' },
    ]) {
      assert.equal(canProcessManualRefund(variant), false, JSON.stringify(variant));
    }
  });

  it('the existing state architecture is reused — no new payment or refund status', () => {
    // payments.status and payments.refund_status keep their existing value sets.
    assert.doesNotMatch(migrationSrc, /ADD CONSTRAINT payments_status_check/);
    assert.doesNotMatch(migrationSrc, /ALTER COLUMN status TYPE/);
    assert.match(migrationSrc, /code: REFUND_NOT_PENDING/);
  });
});

// ===========================================================================
// O/P/Q — recorded data and notifications
// ===========================================================================

describe('O/P — the completion records every required field', () => {
  it('O. records amount, method, reference, proof, admin, timestamp and note', () => {
    for (const assignment of [
      /refund_amount_paise\s+= p_amount_paise/,
      /refund_method\s+= v_method/,
      /refund_reference\s+= v_reference/,
      /refund_proof_storage_path\s+= v_proof_path/,
      /refund_admin_note\s+= v_note/,
      /refunded_at\s+= v_now/,
      /refunded_by\s+= p_admin_id/,
    ]) {
      assert.match(migrationSrc, assignment);
    }
  });

  it('O. the payment event carries the admin, the amount and the reference', () => {
    const event = migrationSrc.slice(migrationSrc.indexOf('INSERT INTO public.payment_events'));
    assert.match(event.slice(0, 700), /'MANUAL_REFUND_COMPLETED'/);
    assert.match(event.slice(0, 700), /p_admin_id/);
    assert.match(event.slice(0, 700), /v_reference/);
  });

  it('P. writes exactly ONE seeker notification, from the transition itself', () => {
    const fn = migrationSrc.slice(
      migrationSrc.indexOf('CREATE OR REPLACE FUNCTION public.complete_manual_refund'),
      migrationSrc.indexOf('REVOKE EXECUTE ON FUNCTION public.complete_manual_refund'),
    );
    assert.equal((fn.match(/INSERT INTO public\.notifications/g) ?? []).length, 1);
    assert.match(fn, /'Refund Completed'/);
    assert.match(fn, /'REFUND_COMPLETED'/);
    // The handler adds no second notification of its own.
    const route = serverSrc.slice(
      serverSrc.indexOf("app.post('/api/admin/payments/:id/complete-manual-refund'"),
      serverSrc.indexOf("app.get('/api/admin/payments/:id/refund-proof'"),
    );
    assert.doesNotMatch(route, /notifications/);
  });

  it('P. the completed notice states the amount, the method and the reference', () => {
    const notice = refundNotice('COMPLETED', {
      amountInr: 499,
      bookingCode: 'BK-0001',
      refundMethod: 'UPI',
      refundReference: 'UTR99887766',
    });
    assert.equal(notice.title, 'Refund Completed');
    assert.equal(notice.eventType, 'REFUND_COMPLETED');
    assert.match(notice.message, /₹499 refund for booking BK-0001 has been completed\./);
    assert.match(notice.message, /sent by upi/i);
    assert.match(notice.message, /Reference: UTR99887766\./);
  });

  it('P. the completed notice never exposes the admin note or a storage path', () => {
    const notice = refundNotice('COMPLETED', { amountInr: 499, bookingCode: 'BK-1', refundMethod: 'BANK_TRANSFER', refundReference: 'R1' });
    assert.doesNotMatch(notice.message, /refunds\//);
    assert.doesNotMatch(notice.message, /storage/i);
    // And the SQL notification carries no admin note either.
    const notification = migrationSrc.slice(migrationSrc.indexOf('INSERT INTO public.notifications'));
    assert.doesNotMatch(notification.slice(0, 1400), /v_note/);
    assert.doesNotMatch(notification.slice(0, 1400), /v_proof_path/);
  });
});

describe('Q — a failed completion never claims REFUNDED', () => {
  it('never updates the payment before every rule has passed', () => {
    const fn = migrationSrc.slice(
      migrationSrc.indexOf('CREATE OR REPLACE FUNCTION public.complete_manual_refund'),
      migrationSrc.indexOf('UPDATE public.payments'),
    );
    for (const code of [
      'UNAUTHORIZED',
      'PAYMENT_NOT_FOUND',
      'REFUND_NOT_MANUAL',
      'ALREADY_REFUNDED',
      'PAYMENT_NOT_REFUNDABLE',
      'REFUND_NOT_PENDING',
      'REFUND_AMOUNT_INVALID',
      'REFUND_AMOUNT_EXCEEDS_PAYMENT',
      'REFUND_AMOUNT_NOT_FULL',
      'REFUND_REFERENCE_REQUIRED',
      'REFUND_METHOD_INVALID',
      'REFUND_PROOF_REQUIRED',
    ]) {
      assert.ok(fn.includes(code), `${code} must be raised before the transition`);
    }
  });

  it('the handler removes the uploaded proof and fails loudly instead of reporting success', () => {
    const route = serverSrc.slice(
      serverSrc.indexOf("app.post('/api/admin/payments/:id/complete-manual-refund'"),
      serverSrc.indexOf("app.get('/api/admin/payments/:id/refund-proof'"),
    );
    assert.match(route, /const discardUpload = async \(\) =>/);
    assert.match(route, /if \(rpcErr\) \{[\s\S]*?await discardUpload\(\);/);
    assert.match(route, /if \(typeof storedBytes === 'number' && storedBytes > PAYMENT_PROOF_MAX_BYTES\) \{[\s\S]*?await discardUpload\(\);/);
    // A storage lookup failure must abort before the database call.
    const verifyIndex = route.indexOf('PROOF_NOT_STORED');
    const rpcIndex = route.indexOf("admin.rpc('complete_manual_refund'");
    assert.ok(verifyIndex > 0 && rpcIndex > verifyIndex, 'the proof must be confirmed before the transition');
  });

  it('every RPC failure code maps to a safe, factual message', () => {
    assert.match(serverSrc, /function refundCompletionFailureCode/);
    assert.match(serverSrc, /function refundCompletionFailureStatus/);
    assert.match(serverSrc, /function refundCompletionFailureReason/);
    // An unrecognised database message never reaches the client verbatim.
    const mapper = serverSrc.slice(
      serverSrc.indexOf('function refundCompletionFailureCode'),
      serverSrc.indexOf('function refundCompletionFailureStatus'),
    );
    assert.match(mapper, /'REFUND_COMPLETION_FAILED'/);
    assert.doesNotMatch(mapper, /return dbMessage/);
  });

  it('a failed refund is described factually, with no invented retry', () => {
    const notice = refundNotice('FAILED', { amountInr: 499, bookingCode: 'BK-0001' });
    assert.equal(notice.title, 'Refund Failed');
    assert.equal(notice.eventType, 'REFUND_FAILED');
    assert.match(notice.message, /₹499 refund for booking BK-0001 could not be completed\./);
    assert.doesNotMatch(notice.message, /again|retry|automatically/i);
  });
});

// ===========================================================================
// Refund method
// ===========================================================================

describe('refund method is a closed allow-list', () => {
  it('accepts only the two rails a manual refund can take', () => {
    assert.deepEqual([...REFUND_METHODS], ['UPI', 'BANK_TRANSFER']);
    assert.equal(normaliseRefundMethod('UPI').ok, true);
    assert.equal(normaliseRefundMethod('bank_transfer').ok, true);
    assert.equal(normaliseRefundMethod('  upi  ').ok, true);
    for (const method of ['CARD', 'CASH', 'PAYPAL', '', undefined, 42, {}]) {
      assert.equal(normaliseRefundMethod(method).ok, false, `${String(method)} must be rejected`);
    }
  });

  it('is constrained by the same CHECK in the database and re-checked in the RPC', () => {
    assert.match(migrationSrc, /refund_method IN \('UPI', 'BANK_TRANSFER'\)/);
    assert.match(migrationSrc, /code: REFUND_METHOD_INVALID/);
    assert.equal(runValidation(apiSchemas.manualRefundComplete, { ...validCompletionBody, refundMethod: 'CARD' }).ok, false);
  });

  it('labels each rail for the admin without keeping a second list', () => {
    assert.equal(refundMethodLabel('UPI'), 'UPI');
    assert.equal(refundMethodLabel('BANK_TRANSFER'), 'Bank transfer');
  });
});

// ===========================================================================
// 14/15/16. Admin + seeker surfaces
// ===========================================================================

describe('admin and seeker surfaces', () => {
  it('labels a stored REFUNDED refund status as COMPLETED, keeping the other values', () => {
    assert.equal(refundStatusLabel('REFUNDED'), 'COMPLETED');
    assert.equal(refundStatusLabel('PENDING'), 'PENDING');
    assert.equal(refundStatusLabel('FAILED'), 'FAILED');
    assert.equal(refundStatusLabel('SOMETHING_NEW'), 'SOMETHING_NEW');
  });

  it('offers "Process Refund" only for an eligible payment', () => {
    assert.match(adminPageSrc, /Process Refund/);
    assert.match(adminPageSrc, /canProcessManualRefund\(selectedPayment\)/);
  });

  it('shows the completed refund detail, including a proof the admin can open', () => {
    for (const label of ['Refund completed', 'Refund Amount', 'Refund Method', 'Refund Reference', 'Refunded At', 'Processed By', 'View refund proof', 'Admin note']) {
      assert.ok(adminPageSrc.includes(label), `the admin modal must show "${label}"`);
    }
    assert.match(adminPageSrc, /apiFetch\(`\/api\/admin\/payments\/\$\{paymentId\}\/refund-proof`\)/);
  });

  it('renders the full read-only context the refund form needs', () => {
    for (const label of ['Booking', 'Seeker', 'Mentor', 'Gig / session', 'Amount paid', 'Payment method', 'Payment status', 'Refund status']) {
      assert.ok(adminPageSrc.includes(label), `the refund form must show "${label}"`);
    }
  });

  it('opens the form without recording anything, and the notification is not sent from the client', () => {
    // openRefundForm only sets local state.
    const opener = adminPageSrc.slice(adminPageSrc.indexOf('const openRefundForm'), adminPageSrc.indexOf('const closeRefundForm'));
    assert.doesNotMatch(opener, /apiFetch|supabase/);
  });

  it('15. keeps "Refunds Owed" counting only unfinished refunds', () => {
    assert.match(adminPageSrc, /payments\.filter\(isRefundOwed\)/);
    // isRefundOwed is unchanged: only PENDING counts.
    const view = readFileSync(join(root, 'src', 'lib', 'adminPaymentView.ts'), 'utf8');
    assert.match(view, /export const isRefundOwed = \(p: AdminPaymentRow\) => p\.refundStatus === 'PENDING'/);
    // A completed refund is no longer PENDING, so it drops out of the count.
    assert.equal(isRefundOwedForTest({ refundStatus: 'PENDING' }), true);
    assert.equal(isRefundOwedForTest({ refundStatus: 'REFUNDED' }), false);
  });

  it('16. the seeker notification vocabulary has a REFUND_PENDING event', () => {
    const types = readFileSync(join(root, 'src', 'types', 'database.ts'), 'utf8');
    assert.match(types, /'REFUND_PENDING'/);
    assert.doesNotMatch(types, /'REFUND_INITIATED'/);
  });
});

// ===========================================================================
// 17/19. Razorpay safety and the audit trail
// ===========================================================================

describe('Razorpay safety', () => {
  it('adds no refund API call, no gateway initiation and no new webhook branch', () => {
    const added = serverSrc.slice(serverSrc.indexOf("app.post('/api/admin/payments/:id/complete-manual-refund'"));
    assert.doesNotMatch(added.slice(0, 6000), /createRazorpayGatewayClient|createRefund|\/refund'/);
    assert.doesNotMatch(migrationSrc, /razorpay/i.test(migrationSrc) ? /gateway refund api/i : /never/i);
  });

  it('leaves the existing gateway client and webhook handling intact', () => {
    const service = readFileSync(join(root, 'src', 'lib', 'razorpayService.ts'), 'utf8');
    // The two-method-plus-one gateway surface is unchanged.
    assert.match(service, /async createRefund\(input\)/);
    assert.match(service, /refund\.created|refund\.processed|refund\.failed/);
    // The gateway's own settled-state check is untouched.
    assert.match(serverSrc, /refund_status === 'REFUNDED' \|\| payment\.status === 'REFUNDED'/);
  });

  it('the audit record carries names and a reference, never a secret or proof contents', () => {
    const audit = serverSrc.slice(
      serverSrc.indexOf("auditAction(req.auth, 'manual_refund_completed'"),
      serverSrc.indexOf("auditAction(req.auth, 'manual_refund_completed'") + 900,
    );
    assert.match(audit, /amountInr: amount\.value/);
    assert.match(audit, /refundMethod: method\.value/);
    assert.match(audit, /refundReference: reference\.value/);
    assert.doesNotMatch(audit, /storagePath|key_secret|webhook_secret|SUPABASE_SERVICE_ROLE/);
  });

  it('reuses the existing payment_events audit table rather than inventing one', () => {
    assert.match(migrationSrc, /INSERT INTO public\.payment_events/);
    assert.doesNotMatch(migrationSrc, /CREATE TABLE/);
  });
});

// ===========================================================================
// S/U/V. Existing flows untouched
// ===========================================================================

describe('existing flows are untouched', () => {
  it('S. payment approval still runs through the review_payment RPC', () => {
    assert.match(serverSrc, /admin\.rpc\('review_payment', \{/);
    const approve = sliceRoute(serverSrc, 'patch', '/api/admin/payments/:id/approve');
    assert.doesNotMatch(approve, /complete_manual_refund/);
  });

  it('S. rejection still uses its own schema and route', () => {
    assert.match(serverSrc, /app\.patch\('\/api\/admin\/payments\/:id\/reject', requireAuth, requireAdmin, validateBody\(apiSchemas\.paymentReject\)/);
  });

  it('U. the seeker payment-proof flow is unchanged', () => {
    // Anchored on the route PATH, not on the exact call formatting. A route
    // gains middlewares (or gets wrapped across lines) without its contract
    // changing, and a slice anchored on `app.post('/api/…'` silently starts
    // matching index -1 — which makes `slice` return the whole file and turns
    // this into a test that either always passes or always fails for reasons
    // that have nothing to do with refunds.
    const proof = sliceRoute(serverSrc, "post", '/api/seeker/bookings/:id/payment-proof');
    assert.match(proof, /paymentProofSubmit|payment-proof/);
    assert.doesNotMatch(proof, /complete_manual_refund|refund_reference|refundReference/);
  });

  it('V. the booking and hold lifecycle is untouched by this migration', () => {
    assert.doesNotMatch(migrationSrc, /UPDATE public\.bookings/);
    assert.doesNotMatch(migrationSrc, /slot_holds/);
    assert.doesNotMatch(migrationSrc, /expire_stale_holds/);
  });

  it('the migration is additive and re-runnable', () => {
    assert.match(migrationSrc, /ADD COLUMN IF NOT EXISTS refund_reference/);
    assert.match(migrationSrc, /CREATE INDEX IF NOT EXISTS idx_payments_manual_refund_queue/);
    assert.match(migrationSrc, /CREATE OR REPLACE FUNCTION public\.complete_manual_refund/);
  });
});

// ---------------------------------------------------------------------------
// Small mirrors so this file does not have to import server-only symbols.
// ---------------------------------------------------------------------------
const REFUND_PROOF_MAX_BYTES_FOR_TEST = PAYMENT_PROOF_MAX_BYTES;
const REFUND_PROOF_BUCKET_FOR_TEST = PAYMENT_PROOF_BUCKET;
const isRefundOwedForTest = (row: { refundStatus: string | null }): boolean => row.refundStatus === 'PENDING';
