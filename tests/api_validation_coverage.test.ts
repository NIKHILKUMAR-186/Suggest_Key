/**
 * REQUEST VALIDATION COVERAGE.
 * ============================
 * Two guarantees, one behavioural and one structural.
 *
 * 1. BEHAVIOURAL. The schemas added for the last group of write routes
 *    (auth telemetry, payment proof, Razorpay verification, platform payment
 *    config) really do bound length and format, and really do strip markup.
 *
 * 2. STRUCTURAL. Every POST / PUT / PATCH route in `server.ts` that reads
 *    `req.body` passes the body through a validator first.
 *
 * The structural half is the part that matters over time. `apiSchemas` being
 * complete proves nothing on its own: a new route can read `req.body` and never
 * reference a schema, and the whole layer silently stops applying to it. This
 * scans the route registrations themselves, so that failure fails a test
 * instead of shipping.
 *
 * Routes that take no body at all are outside the concern and are not listed
 * here — they never read `req.body`, so the scanner skips them on its own.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { apiSchemas } from '../src/lib/validation';
import { PAYMENT_PROOF_MAX_BYTES } from '../src/lib/paymentProof';

const ROOT = process.cwd();

/**
 * The server source with whole-line comments removed.
 *
 * Comments are the scanner's main false-positive source: the Razorpay webhook
 * route documents *why* it must never touch `req.body` ("Using `req.body` here
 * would fail verification"), which is a paragraph containing the literal string
 * `req.body` sitting inside the route's own block. Scanning raw source reports
 * that route as reading an unvalidated body, which is the opposite of the truth.
 *
 * Only lines whose trimmed content starts with `//` are dropped. That is
 * deliberately conservative — an inline comment after code is left in place,
 * because removing trailing comments reliably also mangles string literals like
 * `'https://…'`, and a mangled route registration is a much worse failure than
 * an occasional false positive.
 */
const serverSource = readFileSync(resolve(ROOT, 'server.ts'), 'utf8')
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('//'))
  .join('\n');

// ---------------------------------------------------------------------------
// Structural: every body-reading write route is validated
// ---------------------------------------------------------------------------

/**
 * Routes that validate their body without going through `apiSchemas`.
 *
 * Each entry names the validator that covers it. A new exemption has to say
 * WHY, because "we forgot" is the failure this test exists to catch and it
 * looks exactly like "we had a good reason".
 */
const NON_ZOD_VALIDATORS: Record<string, string> = {
  '/api/admin/segments/:id/hero-upload-url':
    'validateHeroUploadPayload (MIME allow-list + size ceiling, covered by segment_hero_upload.test.ts)',
};

/** Any registration of a write route, capturing its path. */
const ROUTE_REGISTRATION = /\n\s*app\.(post|put|patch)\(\s*\n?\s*'([^']+)'/g;

/** Anything that means "the body has been parsed and checked". */
const VALIDATOR_CALL = /validateBody\(|parseBody\(|\.safeParse\(|validateHeroUploadPayload\(/;

interface RouteBlock {
  method: string;
  path: string;
  text: string;
}

function writeRouteBlocks(): RouteBlock[] {
  const starts: Array<{ method: string; path: string; index: number }> = [];
  for (const match of serverSource.matchAll(ROUTE_REGISTRATION)) {
    starts.push({ method: match[1], path: match[2], index: match.index });
  }

  return starts.map((route, i) => {
    // A route's source runs until the next route registration of any kind, so
    // the block cannot leak `validateBody` from its neighbour.
    const next = starts[i + 1]?.index ?? serverSource.length;
    return {
      method: route.method,
      path: route.path,
      text: serverSource.slice(route.index, next),
    };
  });
}

describe('every write route that reads a body validates it first', () => {
  const blocks = writeRouteBlocks();
  const offenders: string[] = [];
  let checked = 0;

  for (const block of blocks) {
    if (!block.text.includes('req.body')) continue;
    checked += 1;
    if (VALIDATOR_CALL.test(block.text)) continue;
    const exemption = NON_ZOD_VALIDATORS[block.path];
    if (exemption) continue;
    offenders.push(`${block.method.toUpperCase()} ${block.path}`);
  }

  it('scans a meaningful number of body-reading write routes', () => {
    // Guards against the scanner silently matching nothing, which would make
    // every assertion below pass for the wrong reason.
    assert.ok(checked >= 40, `expected 40+ body-reading write routes, found ${checked}`);
  });

  it('has no unvalidated body', () => {
    assert.deepEqual(
      offenders,
      [],
      'these write routes read req.body with no validator in front of it.\n' +
        'Add a schema to apiSchemas in src/lib/validation.ts, or — if the route ' +
        'legitimately needs a hand-written validator — add it to NON_ZOD_VALIDATORS ' +
        'above with the reason:\n' +
        offenders.join('\n'),
    );
  });

  it('the scanner finds every write route it is meant to find', () => {
    // Spot-check that the registration regex still parses both the single-line
    // and the multi-line registration styles.
    const paths = blocks.map((b) => b.path);
    assert.ok(paths.includes('/api/bookings/hold'), 'single-line registration');
    assert.ok(
      paths.includes('/api/seeker/bookings/:id/coupon'),
      'multi-line registration',
    );
    assert.ok(blocks.every((b) => ['post', 'put', 'patch'].includes(b.method)));
  });

  it('every exemption is justified and still points at a real route', () => {
    const paths = new Set(blocks.map((b) => b.path));
    for (const [path, reason] of Object.entries(NON_ZOD_VALIDATORS)) {
      assert.ok(reason.trim().length > 20, `${path} needs a real reason, not a token one`);
      assert.ok(paths.has(path), `${path} is exempted but is not a registered route`);
    }
  });
});

// ---------------------------------------------------------------------------
// Auth telemetry
// ---------------------------------------------------------------------------

describe('login telemetry bodies are bounded', () => {
  it('accepts an email-only failure report', () => {
    const result = apiSchemas.loginFailureReport.safeParse({ email: '  Seeker@Example.com ' });
    assert.equal(result.success, true);
    // Normalised the same way the tracker normalises it, so a padded or
    // upper-cased report still lands on the same identifier key.
    assert.equal(result.success && result.data.email, 'seeker@example.com');
  });

  it('accepts a report with no email at all, because the tracker also keys on IP', () => {
    assert.equal(apiSchemas.loginFailureReport.safeParse({}).success, true);
  });

  it('rejects a malformed email rather than storing it as an identifier', () => {
    const result = apiSchemas.loginFailureReport.safeParse({ email: 'not-an-email' });
    assert.equal(result.success, false);
  });

  it('strips markup out of the free-text reason', () => {
    const result = apiSchemas.loginFailureReport.safeParse({
      reason: '<script>alert(1)</script>bad password',
    });
    assert.equal(result.success, true);
    assert.equal(result.success && result.data.reason, 'bad password');
  });

  it('bounds the reason so it cannot be used as a write amplifier', () => {
    const result = apiSchemas.loginFailureReport.safeParse({ reason: 'x'.repeat(5000) });
    assert.equal(result.success, false);
  });

  it('rejects an unrecognised key instead of dropping it', () => {
    assert.equal(apiSchemas.loginFailureReport.safeParse({ email: 'a@b.co', ip: '1.2.3.4' }).success, false);
  });

  it('a success report cannot clear an arbitrary account', () => {
    // The body has no user id and no ip: the tracker key is email + the
    // caller's real IP, so there is nothing here that names another account.
    assert.equal(apiSchemas.loginSuccessReport.safeParse({ userId: 'someone-else' }).success, false);
    assert.equal(apiSchemas.loginSuccessReport.safeParse({}).success, true);
  });
});

// ---------------------------------------------------------------------------
// Payment proof
// ---------------------------------------------------------------------------

const validProof = {
  transactionReference: 'UTR1234567890',
  fileName: 'screenshot.png',
  mimeType: 'image/png',
  fileSize: 2048,
  storagePath: 'seeker-id/booking-id/abc123-proof.png',
};

describe('payment proof submission', () => {
  it('accepts a well-formed proof', () => {
    assert.equal(apiSchemas.paymentProofSubmit.safeParse(validProof).success, true);
  });

  it('refuses a proof whose mime type is not an allowed screenshot format', () => {
    for (const mimeType of ['application/pdf', 'image/svg+xml', 'text/html']) {
      const result = apiSchemas.paymentProofSubmit.safeParse({ ...validProof, mimeType });
      assert.equal(result.success, false, `${mimeType} must be refused`);
    }
  });

  it('refuses an oversize or empty file', () => {
    assert.equal(
      apiSchemas.paymentProofSubmit.safeParse({ ...validProof, fileSize: PAYMENT_PROOF_MAX_BYTES + 1 }).success,
      false,
    );
    assert.equal(apiSchemas.paymentProofSubmit.safeParse({ ...validProof, fileSize: 0 }).success, false);
    assert.equal(apiSchemas.paymentProofSubmit.safeParse({ ...validProof, fileSize: -5 }).success, false);
  });

  it('strips markup out of the transaction reference', () => {
    const result = apiSchemas.paymentProofSubmit.safeParse({
      ...validProof,
      transactionReference: '<img src=x onerror=alert(1)>UTR123',
    });
    assert.equal(result.success, true);
    assert.ok(!(result.success && result.data.transactionReference).includes('<'));
  });

  it('rejects a reference that is nothing but markup, rather than storing it', () => {
    const result = apiSchemas.paymentProofSubmit.safeParse({
      ...validProof,
      transactionReference: '<script>alert(1)</script>',
    });
    assert.equal(result.success, false);
  });

  it('cannot assert a payment status the server decides', () => {
    assert.equal(apiSchemas.paymentProofSubmit.safeParse({ ...validProof, status: 'VERIFIED' }).success, false);
  });

  it('cannot name its own booking', () => {
    assert.equal(apiSchemas.paymentProofSubmit.safeParse({ ...validProof, bookingId: 'other' }).success, false);
  });

  it('requires a storage path', () => {
    const { storagePath, ...withoutPath } = validProof;
    assert.equal(apiSchemas.paymentProofSubmit.safeParse(withoutPath).success, false);
  });
});

// ---------------------------------------------------------------------------
// Razorpay verification
// ---------------------------------------------------------------------------

const validVerify = {
  razorpayOrderId: 'order_ABC123',
  razorpayPaymentId: 'pay_XYZ789',
  razorpaySignature: 'a1b2c3d4e5f6',
};

describe('razorpay payment verification', () => {
  it('accepts the three gateway values the checkout returns', () => {
    assert.equal(apiSchemas.razorpayVerify.safeParse(validVerify).success, true);
  });

  it('requires all three', () => {
    for (const key of Object.keys(validVerify)) {
      const partial: Record<string, unknown> = { ...validVerify };
      delete partial[key];
      const result = apiSchemas.razorpayVerify.safeParse(partial);
      assert.equal(result.success, false, `${key} must be required`);
    }
  });

  it('rejects an empty or non-string gateway value', () => {
    assert.equal(apiSchemas.razorpayVerify.safeParse({ ...validVerify, razorpaySignature: '' }).success, false);
    assert.equal(apiSchemas.razorpayVerify.safeParse({ ...validVerify, razorpayOrderId: 42 }).success, false);
  });

  it('bounds the signature instead of accepting an unbounded blob', () => {
    const result = apiSchemas.razorpayVerify.safeParse({
      ...validVerify,
      razorpaySignature: 'a'.repeat(5000),
    });
    assert.equal(result.success, false);
  });

  it('does NOT trim the signature, because a stray space is a real HMAC mismatch', () => {
    const result = apiSchemas.razorpayVerify.safeParse({
      ...validVerify,
      razorpaySignature: ' a1b2c3d4e5f6',
    });
    assert.equal(result.success, true);
    assert.equal(result.success && result.data.razorpaySignature, ' a1b2c3d4e5f6');
  });

  it('cannot state the amount or the currency it is paying', () => {
    // The amount is read from the STORED payment row, so a body that could
    // assert one would be a body that could lie about what was paid.
    for (const smuggled of [{ amount: 1 }, { amountInr: 1 }, { currency: 'USD' }, { status: 'PAID' }]) {
      const result = apiSchemas.razorpayVerify.safeParse({ ...validVerify, ...smuggled });
      assert.equal(result.success, false, `${JSON.stringify(smuggled)} must be refused`);
    }
  });
});

// ---------------------------------------------------------------------------
// Platform payment configuration
// ---------------------------------------------------------------------------

describe('platform payment configuration', () => {
  it('accepts a single setting change', () => {
    assert.equal(apiSchemas.platformConfigUpdate.safeParse({ upiId: 'name@bank' }).success, true);
  });

  it('strips markup out of every free-text setting it stores', () => {
    const result = apiSchemas.platformConfigUpdate.safeParse({
      accountName: '<script>alert(1)</script>Acme',
      instructions: '<img src=x onerror=alert(1)>Pay via UPI',
    });
    assert.equal(result.success, true);
    if (!result.success) return;
    assert.equal(result.data.accountName, 'Acme');
    assert.equal(result.data.instructions, 'Pay via UPI');
  });

  it('bounds the long instruction field', () => {
    const result = apiSchemas.platformConfigUpdate.safeParse({ instructions: 'x'.repeat(2000) });
    assert.equal(result.success, false);
  });

  it('treats a blank value as clearing the setting, and an absent key as leaving it', () => {
    const cleared = apiSchemas.platformConfigUpdate.safeParse({ instructions: '   ' });
    assert.equal(cleared.success, true);
    assert.equal(cleared.success && cleared.data.instructions, null);

    const untouched = apiSchemas.platformConfigUpdate.safeParse({ upiId: 'name@bank' });
    assert.equal(untouched.success, true);
    assert.equal(untouched.success && untouched.data.instructions, undefined);
  });

  it('refuses a patch that changes nothing', () => {
    assert.equal(apiSchemas.platformConfigUpdate.safeParse({}).success, false);
  });

  it('refuses any currency other than INR', () => {
    assert.equal(apiSchemas.platformConfigUpdate.safeParse({ currency: 'INR' }).success, true);
    assert.equal(apiSchemas.platformConfigUpdate.safeParse({ currency: 'USD' }).success, false);
  });

  it('only accepts a QR object key this server minted', () => {
    const minted = 'platform/payment-qr-1756000000000-a1b2c3.png';
    assert.equal(apiSchemas.platformConfigUpdate.safeParse({ qrImageStoragePath: minted }).success, true);
    // Cleared with null.
    assert.equal(apiSchemas.platformConfigUpdate.safeParse({ qrImageStoragePath: null }).success, true);
    // An arbitrary object in the bucket is refused.
    for (const path of [
      'platform/anything-else.png',
      'seeker-id/booking-id/proof.png',
      '../../etc/passwd',
      'platform/payment-qr-1756000000000-a1b2c3.php',
    ]) {
      assert.equal(
        apiSchemas.platformConfigUpdate.safeParse({ qrImageStoragePath: path }).success,
        false,
        `${path} must be refused`,
      );
    }
  });

  it('rejects an unrecognised column rather than writing it', () => {
    assert.equal(apiSchemas.platformConfigUpdate.safeParse({ upiId: 'a@b', razorpay_key_secret: 'x' }).success, false);
  });
});

// ---------------------------------------------------------------------------
// Platform QR upload request
// ---------------------------------------------------------------------------

describe('platform QR upload request', () => {
  it('accepts a supported image type at a supported size', () => {
    assert.equal(
      apiSchemas.platformQrUploadRequest.safeParse({ fileType: 'image/png', fileSize: 1024 }).success,
      true,
    );
  });

  it('refuses an unsupported type, including anything executable', () => {
    for (const fileType of ['application/pdf', 'image/svg+xml', 'application/x-msdownload']) {
      assert.equal(
        apiSchemas.platformQrUploadRequest.safeParse({ fileType, fileSize: 1024 }).success,
        false,
        `${fileType} must be refused`,
      );
    }
  });

  it('refuses an empty or oversize file', () => {
    assert.equal(apiSchemas.platformQrUploadRequest.safeParse({ fileType: 'image/png', fileSize: 0 }).success, false);
    assert.equal(
      apiSchemas.platformQrUploadRequest.safeParse({ fileType: 'image/png', fileSize: 2 * 1024 * 1024 + 1 }).success,
      false,
    );
  });

  it('takes no filename, so a client cannot name its own object key', () => {
    assert.equal(
      apiSchemas.platformQrUploadRequest.safeParse({ fileType: 'image/png', fileSize: 10, fileName: 'payload.exe' })
        .success,
      false,
    );
  });
});