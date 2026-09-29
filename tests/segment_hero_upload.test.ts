import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { validateHeroUploadPayload, extractSegmentHeroStoragePath } from '../server';

const ORIGINAL_SUPABASE_URL = process.env.VITE_SUPABASE_URL;

after(() => {
  process.env.VITE_SUPABASE_URL = ORIGINAL_SUPABASE_URL;
});

describe('segment hero upload payload validation', () => {
  it('A. rejects a body with no fileSize (the original production bug)', () => {
    const result = validateHeroUploadPayload({ contentType: 'image/png' });
    assert.equal(result.valid, false);
    assert.equal(result.error.message, 'That file is empty.');
  });

  it('A2. rejects an empty body with a MIME error because contentType is absent', () => {
    const result = validateHeroUploadPayload({});
    assert.equal(result.valid, false);
    assert.equal(result.error.message, 'Upload a PNG, JPEG, WebP or GIF image.');
  });

  it('B. rejects a zero-byte file', () => {
    const result = validateHeroUploadPayload({ contentType: 'image/jpeg', fileSize: 0 });
    assert.equal(result.valid, false);
    assert.equal(result.error.message, 'That file is empty.');
  });

  it('B2. rejects a negative file size', () => {
    const result = validateHeroUploadPayload({ contentType: 'image/png', fileSize: -1 });
    assert.equal(result.valid, false);
    assert.equal(result.error.message, 'That file is empty.');
  });

  it('C. accepts a valid PNG file', () => {
    const result = validateHeroUploadPayload({ contentType: 'image/png', fileSize: 1024 });
    assert.equal(result.valid, true);
    assert.equal(result.type, 'image/png');
    assert.equal(result.size, 1024);
  });

  it('C2. accepts a valid JPEG file', () => {
    const result = validateHeroUploadPayload({ contentType: 'image/jpeg', fileSize: 2048 });
    assert.equal(result.valid, true);
    assert.equal(result.type, 'image/jpeg');
  });

  it('C3. accepts a valid WebP file', () => {
    const result = validateHeroUploadPayload({ contentType: 'image/webp', fileSize: 512 });
    assert.equal(result.valid, true);
    assert.equal(result.type, 'image/webp');
  });

  it('C4. accepts a valid GIF file', () => {
    const result = validateHeroUploadPayload({ contentType: 'image/gif', fileSize: 300 });
    assert.equal(result.valid, true);
    assert.equal(result.type, 'image/gif');
  });

  it('D. rejects an invalid MIME type (text/plain)', () => {
    const result = validateHeroUploadPayload({ contentType: 'text/plain', fileSize: 100 });
    assert.equal(result.valid, false);
    assert.equal(result.error.message, 'Upload a PNG, JPEG, WebP or GIF image.');
  });

  it('D2. rejects an executable MIME type', () => {
    const result = validateHeroUploadPayload({ contentType: 'application/pdf', fileSize: 1000 });
    assert.equal(result.valid, false);
    assert.equal(result.error.message, 'Upload a PNG, JPEG, WebP or GIF image.');
  });

  it('D3. is case-insensitive for MIME types', () => {
    const result = validateHeroUploadPayload({ contentType: 'IMAGE/PNG', fileSize: 1024 });
    assert.equal(result.valid, true);
    assert.equal(result.type, 'image/png');
  });

  it('E. rejects a file larger than 5 MB', () => {
    const result = validateHeroUploadPayload({ contentType: 'image/png', fileSize: 5 * 1024 * 1024 + 1 });
    assert.equal(result.valid, false);
    assert.equal(result.error.message, 'That image is larger than 5 MB.');
  });

  it('E2. accepts exactly 5 MB', () => {
    const result = validateHeroUploadPayload({ contentType: 'image/png', fileSize: 5 * 1024 * 1024 });
    assert.equal(result.valid, true);
  });

  it('F. rejects non-object bodies without crashing', () => {
    for (const body of [null, undefined, 42, 'string', true, []]) {
      const result = validateHeroUploadPayload(body);
      assert.equal(result.valid, false);
      assert.equal(result.error.message, 'Upload a PNG, JPEG, WebP or GIF image.');
    }
  });

  it('G. coerces numeric fileSize from a string', () => {
    const result = validateHeroUploadPayload({ contentType: 'image/jpeg', fileSize: '2048' });
    assert.equal(result.valid, true);
    assert.equal(result.size, 2048);
  });

  it('H. defaults contentType to empty string when missing', () => {
    const result = validateHeroUploadPayload({ fileSize: 100 });
    assert.equal(result.valid, false);
    assert.equal(result.error.message, 'Upload a PNG, JPEG, WebP or GIF image.');
  });
});

describe('extractSegmentHeroStoragePath', () => {
  const SUPABASE_URL = 'https://testproject.supabase.co';

  before(() => {
    process.env.VITE_SUPABASE_URL = SUPABASE_URL;
  });

  it('A. extracts a bare storage path with bucket prefix', () => {
    assert.equal(extractSegmentHeroStoragePath('segment-hero/abc.webp'), 'segment-hero/abc.webp');
  });

  it('A2. extracts a bare storage path with segment id and timestamp', () => {
    assert.equal(
      extractSegmentHeroStoragePath('segment-hero/123e4567-e89b-12d3-a456-426614174000-1720000000000-abc123.jpg'),
      'segment-hero/123e4567-e89b-12d3-a456-426614174000-1720000000000-abc123.jpg',
    );
  });

  it('B. extracts path from a full public Supabase URL', () => {
    const url = `${SUPABASE_URL}/storage/v1/object/public/segment-hero/segment-hero/abc.webp`;
    assert.equal(extractSegmentHeroStoragePath(url), 'segment-hero/abc.webp');
  });

  it('B2. extracts path from full URL with segment id and timestamp', () => {
    const path = 'segment-hero/123e4567-e89b-12d3-a456-426614174000-1720000000000-abc123.jpg';
    const url = `${SUPABASE_URL}/storage/v1/object/public/segment-hero/${path}`;
    assert.equal(extractSegmentHeroStoragePath(url), path);
  });

  it('C. decodes URL-encoded characters in the path', () => {
    const url = `${SUPABASE_URL}/storage/v1/object/public/segment-hero/segment-hero/abc%20def.webp`;
    assert.equal(extractSegmentHeroStoragePath(url), 'segment-hero/abc def.webp');
  });

  it('C2. decodes URL-encoded slashes and rejects traversal', () => {
    const url = `${SUPABASE_URL}/storage/v1/object/public/segment-hero/segment-hero/..%2F..%2Fetc%2Fpasswd`;
    assert.equal(extractSegmentHeroStoragePath(url), null);
  });

  it('D. returns null for null input', () => {
    assert.equal(extractSegmentHeroStoragePath(null), null);
  });

  it('E. returns null for undefined input', () => {
    assert.equal(extractSegmentHeroStoragePath(undefined), null);
  });

  it('F. returns null for empty string', () => {
    assert.equal(extractSegmentHeroStoragePath(''), null);
  });

  it('G. returns null for wrong bucket in full URL', () => {
    const url = `${SUPABASE_URL}/storage/v1/object/public/payment-proofs/segment-hero/abc.jpg`;
    assert.equal(extractSegmentHeroStoragePath(url), null);
  });

  it('H. returns null for wrong hostname', () => {
    const url = 'https://evil.com/storage/v1/object/public/segment-hero/segment-hero/abc.webp';
    assert.equal(extractSegmentHeroStoragePath(url), null);
  });

  it('I. returns null for path traversal in bare path', () => {
    assert.equal(extractSegmentHeroStoragePath('segment-hero/../../etc/passwd'), null);
  });

  it('I2. returns null for absolute path', () => {
    assert.equal(extractSegmentHeroStoragePath('/etc/passwd'), null);
  });

  it('I3. returns null for path traversal in full URL', () => {
    const url = `${SUPABASE_URL}/storage/v1/object/public/segment-hero/segment-hero/../other/abc.webp`;
    assert.equal(extractSegmentHeroStoragePath(url), null);
  });

  it('J. replacement scenario: different old and new public URLs produce different paths', () => {
    const oldUrl = `${SUPABASE_URL}/storage/v1/object/public/segment-hero/segment-hero/old-123.jpg`;
    const newUrl = `${SUPABASE_URL}/storage/v1/object/public/segment-hero/segment-hero/new-456.jpg`;
    const oldPath = extractSegmentHeroStoragePath(oldUrl);
    const newPath = extractSegmentHeroStoragePath(newUrl);
    assert.equal(oldPath, 'segment-hero/old-123.jpg');
    assert.equal(newPath, 'segment-hero/new-456.jpg');
    assert.notEqual(oldPath, newPath);
  });

  it('N. same old and new public URL produces identical paths → no deletion needed', () => {
    const url = `${SUPABASE_URL}/storage/v1/object/public/segment-hero/segment-hero/abc.webp`;
    const oldPath = extractSegmentHeroStoragePath(url);
    const newPath = extractSegmentHeroStoragePath(url);
    assert.equal(oldPath, newPath);
  });

  it('O. legacy bare-path heroImageUrl is still accepted', () => {
    assert.equal(extractSegmentHeroStoragePath('segment-hero/legacy-image.webp'), 'segment-hero/legacy-image.webp');
  });

  it('returns null for random URL strings', () => {
    assert.equal(extractSegmentHeroStoragePath('https://example.com/image.jpg'), null);
    assert.equal(extractSegmentHeroStoragePath('just-a-string'), null);
    assert.equal(extractSegmentHeroStoragePath('   '), null);
  });
});
