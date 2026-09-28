import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAYMENT_PROOF_BUCKET,
  PAYMENT_PROOF_MAX_BYTES,
  PAYMENT_PROOF_MAX_LABEL,
  PAYMENT_STATUS_PENDING,
  buildProofStoragePath,
  decodeBase64Image,
  formatFileSize,
  isPayableBookingStatus,
  normaliseTransactionReference,
  sanitiseProofFileName,
  validateProofFile,
} from '../src/lib/paymentProof';

describe('payment proof: transaction reference (UTR)', () => {
  test('accepts a real reference and trims surrounding whitespace', () => {
    const result = normaliseTransactionReference('  412345678901  ');
    assert.equal(result.ok, true);
    assert.ok(result.ok && result.value === '412345678901');
  });

  test('accepts alphanumeric references with dashes and underscores', () => {
    for (const reference of ['UPI-REF-90214481', 'gpay_22981', 'ABC123']) {
      const result = normaliseTransactionReference(reference);
      assert.equal(result.ok, true, `${reference} should be accepted`);
    }
  });

  test('rejects empty and whitespace-only input', () => {
    for (const value of ['', '   ', '\t\n']) {
      const result = normaliseTransactionReference(value);
      assert.equal(result.ok, false, `"${value}" must be rejected`);
    }
  });

  test('rejects non-string input rather than coercing it', () => {
    for (const value of [undefined, null, 12345, {}, []]) {
      const result = normaliseTransactionReference(value);
      assert.equal(result.ok, false, `${JSON.stringify(value)} must be rejected`);
    }
  });

  test('rejects an implausibly short reference', () => {
    assert.equal(normaliseTransactionReference('ab').ok, false);
  });

  test('rejects an implausibly long reference', () => {
    assert.equal(normaliseTransactionReference('a'.repeat(65)).ok, false);
  });

  test('rejects characters that cannot appear in a UTR', () => {
    for (const value of ['1234 5678', 'ref#123', '<script>', '1234/5678']) {
      assert.equal(normaliseTransactionReference(value).ok, false, `${value} must be rejected`);
    }
  });

  test('never returns a generated value for invalid input', () => {
    // Guards the specific regression this flow had: a prefilled/fabricated UTR.
    for (const value of ['', '   ', '!!!', 42, null, undefined]) {
      const result = normaliseTransactionReference(value);
      if (result.ok) assert.fail('invalid input must not produce a reference');
    }
  });
});

describe('payment proof: file validation', () => {
  const validFile = { name: 'payment-proof.jpg', type: 'image/jpeg', size: 245 * 1024 };

  test('accepts PNG, JPG/JPEG and WEBP', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      assert.equal(validateProofFile({ ...validFile, type }).ok, true, `${type} should be accepted`);
    }
  });

  test('rejects a missing file', () => {
    assert.equal(validateProofFile(null).ok, false);
    assert.equal(validateProofFile(undefined).ok, false);
  });

  test('rejects an empty file', () => {
    assert.equal(validateProofFile({ ...validFile, size: 0 }).ok, false);
  });

  test('rejects unsupported MIME types with a clear message', () => {
    for (const type of ['application/pdf', 'image/gif', 'text/plain', 'application/octet-stream', '']) {
      const result = validateProofFile({ ...validFile, type });
      assert.equal(result.ok, false, `${type} must be rejected`);
      if (!result.ok) {
        assert.match(result.message, /PNG, JPG, or WebP/);
      }
    }
  });

  test('rejects a file above the 5MB bucket limit and names the limit', () => {
    const result = validateProofFile({ ...validFile, size: PAYMENT_PROOF_MAX_BYTES + 1 });
    assert.equal(result.ok, false);
    if (!result.ok) {
      // The limit shown to the user is derived from the real byte ceiling.
      assert.match(result.message, /larger than the supported limit/);
      assert.match(result.message, /smaller than 5 MB/);
    }
    // Exactly at the limit is still allowed.
    assert.equal(validateProofFile({ ...validFile, size: PAYMENT_PROOF_MAX_BYTES }).ok, true);
  });

  test('exposes the limit as a label derived from the real ceiling', () => {
    assert.equal(PAYMENT_PROOF_MAX_LABEL, `${PAYMENT_PROOF_MAX_BYTES / (1024 * 1024)} MB`);
  });
});

describe('payment proof: payability', () => {
  test('accepts the two payable booking states', () => {
    assert.equal(isPayableBookingStatus('PAYMENT_PENDING'), true);

describe('payment proof: storage path', () => {
  const seeker = 'seeker-1';
  const booking = 'booking-1';

  test('starts with the owning seeker so the live storage RLS policy applies', () => {
    const path = buildProofStoragePath(seeker, booking, 'proof.png', 'unique-1');
    assert.equal(path.split('/')[0], seeker);
    assert.equal(path.split('/')[1], booking);
    assert.ok(path.endsWith('-proof.png'));
  });

  test('strips directory traversal out of the client filename', () => {
    const path = buildProofStoragePath(seeker, booking, '../../../etc/passwd', 'unique-1');
    assert.ok(!path.includes('..'), path);
    assert.ok(path.startsWith(`${seeker}/${booking}/`));
  });

  test('strips Windows path separators out of the client filename', () => {
    const path = buildProofStoragePath(seeker, booking, 'C:\\Windows\\evil.png', 'unique-1');
    assert.ok(!path.includes('\\'), path);
    assert.ok(path.startsWith(`${seeker}/${booking}/`));
  });

  test('falls back to a safe name when no filename is supplied', () => {
    assert.equal(sanitiseProofFileName(undefined), 'proof.png');
    assert.equal(sanitiseProofFileName(''), 'proof.png');
    assert.equal(sanitiseProofFileName('...'), 'proof.png');
  });

  test('gives two submissions distinct object keys', () => {
    const first = buildProofStoragePath(seeker, booking, 'proof.png', 'uuid-a');
    const second = buildProofStoragePath(seeker, booking, 'proof.png', 'uuid-b');
    assert.notEqual(first, second);
  });

  test('uses the existing private bucket and the pending status', () => {
    assert.equal(PAYMENT_PROOF_BUCKET, 'payment-proofs');
    assert.equal(PAYMENT_STATUS_PENDING, 'PENDING_VERIFICATION');
  });
});

describe('payment proof: base64 decoding', () => {
  test('decodes a data URL into bytes', () => {
    const bytes = decodeBase64Image('data:image/png;base64,aGVsbG8=');
    assert.ok(bytes);
    assert.equal(bytes!.toString('utf8'), 'hello');
  });

  test('decodes a bare base64 payload too', () => {
    const bytes = decodeBase64Image('aGVsbG8=');
    assert.ok(bytes);
    assert.equal(bytes!.toString('utf8'), 'hello');
  });

  test('returns null for empty or unusable input', () => {
    for (const value of ['', 'data:image/png;base64,', undefined as unknown as string, null as unknown as string]) {
      assert.equal(decodeBase64Image(value), null);
    }
  });
});

describe('payment proof: file size formatting', () => {
  test('formats bytes, KB and MB for the file chip', () => {
    assert.equal(formatFileSize(512), '512 B');
    assert.equal(formatFileSize(245 * 1024), '245 KB');
    assert.equal(formatFileSize(3 * 1024 * 1024), '3.0 MB');
  });

  test('returns an empty string for invalid sizes instead of a fake number', () => {
    assert.equal(formatFileSize(-1), '');
    assert.equal(formatFileSize(Number.NaN), '');
  });
});

    assert.equal(isPayableBookingStatus('PENDING_VERIFICATION'), true);
  });

  test('rejects every state a booking can no longer be paid in', () => {
    for (const status of ['MENTOR_PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REJECTED', null, undefined, 42]) {
      assert.equal(isPayableBookingStatus(status), false, `${String(status)} must not be payable`);
    }
  });
});
