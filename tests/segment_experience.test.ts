import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { z } from 'zod';

import { apiSchemas, formatValidationFailure, validateBody, stripHtmlTags } from '../src/lib/validation';
import { getSegmentExperienceFallback, normalizeSegmentExperience } from '../src/lib/segmentExperience';

/** Run the middleware the way Express does and report what it did. */
function runValidation<T>(schema: z.ZodType<T>, body: unknown) {
  const req = { body } as unknown as { body: unknown };
  let statusCode: number | null = null;
  let payload: unknown = null;
  let nexted = false;

  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(value: unknown) {
      payload = value;
      return res;
    },
  };

  const next = () => {
    nexted = true;
  };

  (validateBody(schema) as unknown as (r: unknown, s: unknown, n: unknown) => void)(req, res, next);
  return { statusCode, payload, nexted, req };
}

// ---------------------------------------------------------------------------
// segmentExperience fallback
// ---------------------------------------------------------------------------

describe('segmentExperience fallback', () => {
  it('returns an empty config object when raw is null', () => {
    assert.deepEqual(getSegmentExperienceFallback(), {});
  });

  it('normalizes null to an empty config', () => {
    assert.deepEqual(normalizeSegmentExperience(null), {});
  });

  it('normalizes undefined to an empty config', () => {
    assert.deepEqual(normalizeSegmentExperience(undefined), {});
  });

  it('passes through a valid object', () => {
    const input = { branding: { heroHeadline: 'Hello' } };
    assert.deepEqual(normalizeSegmentExperience(input), input);
  });
});

// ---------------------------------------------------------------------------
// segmentExperience validation
// ---------------------------------------------------------------------------

describe('segmentExperience validation', () => {
  it('accepts an empty body as valid', () => {
    const result = runValidation(apiSchemas.segmentExperience, {});
    assert.equal(result.statusCode, null);
    assert.equal(result.nexted, true);
  });

  it('accepts null as valid', () => {
    const result = runValidation(apiSchemas.segmentExperience, null);
    assert.equal(result.statusCode, null);
    assert.equal(result.nexted, true);
  });

  it('accepts a fully populated config', () => {
    const body = {
      branding: { heroHeadline: 'Find your guide', heroSubheadline: 'One session at a time.', tintColor: '#0d9488' },
      topics: [{ title: 'Careers', description: 'Explore roles', icon: 'compass' }],
      quickHelp: [{ title: 'How it works', description: 'Pick a mentor', icon: 'help-circle' }],
      journeySteps: [{ title: 'Book', description: 'Reserve a slot', icon: 'calendar' }],
      benefits: [{ title: 'Flexible', description: 'Learn on your terms', icon: 'zap' }],
      faq: [{ question: 'What is this?', answer: 'A mentorship segment.' }],
      cta: { text: 'Get started', url: 'https://example.com' },
    };
    const result = runValidation(apiSchemas.segmentExperience, body);
    assert.equal(result.statusCode, null);
    assert.equal(result.nexted, true);
  });

  it('rejects an invalid tintColor hex', () => {
    const result = runValidation(apiSchemas.segmentExperience, { branding: { tintColor: 'not-a-color' } });
    assert.equal(result.statusCode, 400);
    const failure = result.payload as { success: boolean; error: { fields: Record<string, string> } };
    assert.equal(failure.success, false);
    assert.ok(failure.error.fields['branding.tintColor']);
  });

  it('rejects more than 8 topics', () => {
    const topics = Array.from({ length: 9 }, (_, i) => ({ title: `T${i}`, description: 'D', icon: '' }));
    const result = runValidation(apiSchemas.segmentExperience, { topics });
    assert.equal(result.statusCode, 400);
    const failure = result.payload as { success: boolean; error: { message: string } };
    assert.ok(failure.error.message.includes('at most 8'));
  });

  it('rejects more than 6 quickHelp items', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ title: `Q${i}`, description: 'D', icon: '' }));
    const result = runValidation(apiSchemas.segmentExperience, { quickHelp: items });
    assert.equal(result.statusCode, 400);
    const failure = result.payload as { success: boolean; error: { message: string } };
    assert.ok(failure.error.message.includes('at most 6'));
  });

  it('rejects more than 6 journeySteps items', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ title: `J${i}`, description: 'D', icon: '' }));
    const result = runValidation(apiSchemas.segmentExperience, { journeySteps: items });
    assert.equal(result.statusCode, 400);
    const failure = result.payload as { success: boolean; error: { message: string } };
    assert.ok(failure.error.message.includes('at most 6'));
  });

  it('rejects more than 6 benefits items', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ title: `B${i}`, description: 'D', icon: '' }));
    const result = runValidation(apiSchemas.segmentExperience, { benefits: items });
    assert.equal(result.statusCode, 400);
    const failure = result.payload as { success: boolean; error: { message: string } };
    assert.ok(failure.error.message.includes('at most 6'));
  });

  it('rejects more than 8 FAQ items', () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ question: `Q${i}`, answer: 'A' }));
    const result = runValidation(apiSchemas.segmentExperience, { faq: items });
    assert.equal(result.statusCode, 400);
    const failure = result.payload as { success: boolean; error: { message: string } };
    assert.ok(failure.error.message.includes('at most 8'));
  });

  it('strips HTML from free-text fields', () => {
    const result = runValidation(apiSchemas.segmentExperience, {
      branding: { heroHeadline: '<script>alert(1)</script>Hello' },
    });
    assert.equal(result.statusCode, null);
    assert.equal(result.nexted, true);
    const body = (result.req as { body: unknown }).body as Record<string, unknown>;
    assert.equal((body.branding as Record<string, string>).heroHeadline, 'Hello');
  });

  it('rejects an invalid CTA URL', () => {
    const result = runValidation(apiSchemas.segmentExperience, { cta: { text: 'Go', url: 'not-a-url' } });
    assert.equal(result.statusCode, 400);
    const failure = result.payload as { success: boolean; error: { fields: Record<string, string> } };
    assert.ok(failure.error.fields['cta.url']);
  });
});
