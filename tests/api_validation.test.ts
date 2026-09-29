/**
 * Request validation layer
 * ========================
 * Covers the three guarantees the API depends on:
 *   - the friendly 400 shape (`code` / `message` / `fields`),
 *   - the length, range and format bounds on real inputs,
 *   - HTML stripping on every free-text field, so no stored string can carry a
 *     script payload.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { z } from 'zod';

import {
  apiSchemas,
  formatValidationFailure,
  stripHtmlTags,
  validateBody,
  MAX_BIO_LENGTH,
  MAX_NAME_LENGTH,
  MAX_TITLE_LENGTH,
} from '../src/lib/validation';

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
// stripHtmlTags
// ---------------------------------------------------------------------------

describe('stripHtmlTags', () => {
  it('removes a script element together with its contents', () => {
    assert.equal(stripHtmlTags('hello<script>alert(1)</script>world'), 'helloworld');
  });

  it('removes a style element together with its contents', () => {
    assert.equal(stripHtmlTags('a<style>body{display:none}</style>b'), 'ab');
  });

  it('removes ordinary tags but keeps the text between them', () => {
    assert.equal(stripHtmlTags('<b>bold</b> and <i>italic</i>'), 'bold and italic');
  });

  it('removes img and other void tags including attributes', () => {
    assert.equal(stripHtmlTags('x<img src=x onerror=alert(1)>y'), 'xy');
  });

  it('does not end a tag at a > inside a quoted attribute', () => {
    assert.equal(stripHtmlTags('<a title="a > b">link</a>'), 'link');
  });

  it('removes a dangling unterminated tag at the end of the value', () => {
    assert.equal(stripHtmlTags('safe<script'), 'safe');
  });

  it('preserves a bare < that is not tag-like, so ordinary prose survives', () => {
    assert.equal(stripHtmlTags('costs < 5000 and a < b'), 'costs < 5000 and a < b');
  });

  it('strips C0 control characters but keeps tabs and newlines', () => {
    assert.equal(stripHtmlTags('a\u0000b\tc\nd'), 'ab\tc\nd');
  });

  it('neutralises a case-varied closing tag', () => {
    assert.equal(stripHtmlTags('<ScRiPt>alert(1)</ScRiPt>'), '');
  });
});

// ---------------------------------------------------------------------------
// Error shape
// ---------------------------------------------------------------------------

describe('formatValidationFailure', () => {
  it('exposes the first readable message plus a per-field map', () => {
    const result = runValidation(apiSchemas.gigCreate, {
      title: '',
      segmentId: 'not-a-uuid',
      durationMinutes: 7,
      priceInr: -1,
    });

    assert.equal(result.statusCode, 400);
    assert.equal(result.nexted, false);

    const error = (result.payload as { error: { code: string; message: string; fields: Record<string, string> } }).error;
    assert.equal(error.code, 'VALIDATION_ERROR');
    assert.equal(typeof error.message, 'string');
    assert.ok(error.message.length > 0);

    // Every failing field is addressable by the client.
    assert.ok('title' in error.fields);
    assert.ok('segmentId' in error.fields);
    assert.ok('durationMinutes' in error.fields);
    assert.ok('priceInr' in error.fields);
  });

  it('reports an unrecognised key instead of silently ignoring it', () => {
    const result = runValidation(apiSchemas.segmentToggleActive, { isActive: true, sneaky: 1 });
    assert.equal(result.statusCode, 400);
    const error = (result.payload as { error: { fields: Record<string, string> } }).error;
    assert.match(error.fields._, /nrecognized key/i);
  });

  it('replaces req.body with the parsed value on success', () => {
    const result = runValidation(apiSchemas.mentorBookingConfirm, { meetingUrl: '  https://meet.example/abc  ' });
    assert.equal(result.statusCode, null);
    assert.equal(result.nexted, true);
    assert.equal((result.req.body as { meetingUrl: string }).meetingUrl, 'https://meet.example/abc');
  });

  it('treats an absent body as an empty object rather than crashing', () => {
    const result = runValidation(apiSchemas.segmentToggleActive, undefined);
    assert.equal(result.statusCode, 400);
  });
});

// ---------------------------------------------------------------------------
// Lengths, formats and ranges
// ---------------------------------------------------------------------------

describe('bounds and formats', () => {
  it('rejects a gig title longer than the column limit', () => {
    const result = runValidation(apiSchemas.gigCreate, {
      title: 'x'.repeat(MAX_TITLE_LENGTH + 1),
      segmentId: '3f2b1c0a-1111-4222-8333-444455556666',
      durationMinutes: 30,
      priceInr: 100,
    });
    assert.equal(result.statusCode, 400);
  });

  it('accepts a title at exactly the limit', () => {
    const result = runValidation(apiSchemas.gigCreate, {
      title: 'x'.repeat(MAX_TITLE_LENGTH),
      segmentId: '3f2b1c0a-1111-4222-8333-444455556666',
      durationMinutes: 30,
      priceInr: 100,
    });
    assert.equal(result.nexted, true);
  });

  it('rejects a bio longer than the column limit', () => {
    const result = runValidation(apiSchemas.adminUserDirectCreate, {
      role: 'seeker',
      email: 'seeker@example.com',
      fullName: 'Aman Kumar',
      bio: 'x'.repeat(MAX_BIO_LENGTH + 1),
    });
    assert.equal(result.statusCode, 400);
  });

  it('rejects a malformed email and accepts a padded one', () => {
    const bad = runValidation(apiSchemas.adminUserDirectCreate, {
      role: 'seeker',
      email: 'not-an-email',
      fullName: 'Aman Kumar',
    });
    assert.equal(bad.statusCode, 400);
    assert.match(
      (bad.payload as { error: { fields: Record<string, string> } }).error.fields.email,
      /valid email/i,
    );

    const good = runValidation(apiSchemas.adminUserDirectCreate, {
      role: 'seeker',
      email: '  Seeker@Example.COM  ',
      fullName: 'Aman Kumar',
    });
    assert.equal(good.nexted, true);
    assert.equal((good.req.body as { email: string }).email, 'seeker@example.com');
  });

  it('rejects a gig duration outside the allowed set', () => {
    for (const durationMinutes of [7, 0, -30, 61]) {
      const result = runValidation(apiSchemas.gigCreate, {
        title: 'Career clarity',
        segmentId: '3f2b1c0a-1111-4222-8333-444455556666',
        durationMinutes,
        priceInr: 100,
      });
      assert.equal(result.statusCode, 400, `expected ${durationMinutes} to be rejected`);
    }
  });

  it('rejects a negative price', () => {
    const result = runValidation(apiSchemas.gigCreate, {
      title: 'Career clarity',
      segmentId: '3f2b1c0a-1111-4222-8333-444455556666',
      durationMinutes: 30,
      priceInr: -1,
    });
    assert.equal(result.statusCode, 400);
  });

  it('rejects a full name past the limit but allows the boundary', () => {
    const bad = runValidation(apiSchemas.mentorApplicationDraft, { fullName: 'x'.repeat(MAX_NAME_LENGTH + 1) });
    assert.equal(bad.statusCode, 400);

    const good = runValidation(apiSchemas.mentorApplicationDraft, { fullName: 'x'.repeat(MAX_NAME_LENGTH) });
    assert.equal(good.nexted, true);
  });

  it('rejects a meeting link that is not http(s)', () => {
    const result = runValidation(apiSchemas.mentorBookingConfirm, { meetingUrl: 'javascript:alert(1)' });
    assert.equal(result.statusCode, 400);
  });

  it('rejects a slug that is not kebab-case', () => {
    const result = runValidation(apiSchemas.segmentCreate, { name: 'Advisors', slug: 'Not A Slug' });
    assert.equal(result.statusCode, 400);
  });

  it('rejects out-of-range retention days', () => {
    assert.equal(runValidation(apiSchemas.logRetention, { retentionDays: 0 }).statusCode, 400);
    assert.equal(runValidation(apiSchemas.logRetention, { retentionDays: 366 }).statusCode, 400);
    assert.equal(runValidation(apiSchemas.logRetention, { retentionDays: 30 }).nexted, true);
  });

  it('rejects an availability window whose start is not before its end', () => {
    const result = runValidation(apiSchemas.availability, {
      rules: [{ dayOfWeek: 1, startTime: '18:00', endTime: '09:00' }],
    });
    assert.equal(result.statusCode, 400);
  });

  it('rejects a day-of-week outside 0-6', () => {
    const result = runValidation(apiSchemas.availability, {
      rules: [{ dayOfWeek: 7, startTime: '09:00', endTime: '17:00' }],
    });
    assert.equal(result.statusCode, 400);
  });

  it('rejects an available exception with no usable window', () => {
    const result = runValidation(apiSchemas.availabilityExceptions, {
      exceptions: [{ exceptionDate: '2026-09-27', isAvailable: true }],
    });
    assert.equal(result.statusCode, 400);
  });

  it('rejects an exception date that is not YYYY-MM-DD', () => {
    const result = runValidation(apiSchemas.availabilityExceptions, {
      exceptions: [{ exceptionDate: '27-09-2026', isAvailable: false }],
    });
    assert.equal(result.statusCode, 400);
  });

  it('rejects a booking hold with non-ISO instants', () => {
    const result = runValidation(apiSchemas.bookingHold, {
      mentorId: '3f2b1c0a-1111-4222-8333-444455556666',
      segmentId: '3f2b1c0a-1111-4222-8333-444455556666',
      gigId: '3f2b1c0a-1111-4222-8333-444455556666',
      startTime: 'tomorrow',
      endTime: '2026-09-27T11:00:00.000Z',
    });
    assert.equal(result.statusCode, 400);
  });

  it('accepts the millisecond ISO instants the slot engine emits', () => {
    const result = runValidation(apiSchemas.bookingHold, {
      mentorId: '3f2b1c0a-1111-4222-8333-444455556666',
      segmentId: '3f2b1c0a-1111-4222-8333-444455556666',
      gigId: '3f2b1c0a-1111-4222-8333-444455556666',
      startTime: '2026-09-27T10:00:00.000Z',
      endTime: '2026-09-27T11:00:00.000Z',
    });
    assert.equal(result.nexted, true);
  });

  it('accepts nil-prefixed seeded ids, which a version-strict uuid check would reject', () => {
    const result = runValidation(apiSchemas.segmentApply, {
      segmentId: '00000000-0000-0000-0000-000000000001',
    });
    assert.equal(result.nexted, true);
  });

  it('rejects a document upload with an unsupported mime type or oversize file', () => {
    const base = {
      applicationId: '3f2b1c0a-1111-4222-8333-444455556666',
      documentType: 'aadhar_front',
      storagePath: 'u/a/file.png',
      originalFilename: 'file.png',
    };

    assert.equal(runValidation(apiSchemas.mentorDocument, { ...base, mimeType: 'text/html', sizeBytes: 10 }).statusCode, 400);
    assert.equal(runValidation(apiSchemas.mentorDocument, { ...base, mimeType: 'image/png', sizeBytes: 6 * 1024 * 1024 }).statusCode, 400);
    assert.equal(runValidation(apiSchemas.mentorDocument, { ...base, mimeType: 'image/png', sizeBytes: 1024 }).nexted, true);
  });

  it('rejects an account status action outside the allowed set', () => {
    const result = runValidation(apiSchemas.adminUserStatus, { action: 'obliterate' });
    assert.equal(result.statusCode, 400);
  });

  it('rejects an update body that carries no editable field', () => {
    const result = runValidation(apiSchemas.adminGigUpdate, {});
    assert.equal(result.statusCode, 400);
  });

  it('treats an empty tag list as a real instruction to clear, not an empty request', () => {
    const result = runValidation(apiSchemas.adminMentorProfile, { segmentIds: [] });
    assert.equal(result.nexted, true);
  });
});

// ---------------------------------------------------------------------------
// Segment experience: the write schema must agree with the read model
// ---------------------------------------------------------------------------

describe('segment experience write contract', () => {
  it('accepts an internal relative CTA, the value the product actually uses', () => {
    // Regression: the write schema demanded an absolute http(s) URL while the
    // renderer's `isSafeSegmentLink` accepted `/mentors`, so "See autism
    // mentors" could never be saved back.
    const result = runValidation(apiSchemas.segmentExperience, {
      cta: { title: 'Talk to an autism mentor', buttonText: 'See autism mentors', buttonUrl: '/mentors' },
    });
    assert.equal(result.statusCode, null);
    assert.equal(result.nexted, true);
    assert.equal((result.req.body as { cta: { buttonUrl: string } }).cta.buttonUrl, '/mentors');
  });

  it('accepts every internal path shape the app routes on', () => {
    for (const url of ['/', '/seeker', '/mentors', '/mentor/123', '/seeker?segment=career-mentor']) {
      const result = runValidation(apiSchemas.segmentExperience, { cta: { buttonUrl: url } });
      assert.equal(result.nexted, true, `${url} must be accepted`);
    }
  });

  it('accepts an absolute https CTA, so external links still work', () => {
    const result = runValidation(apiSchemas.segmentExperience, {
      cta: { buttonUrl: 'https://example.com/careers' },
    });
    assert.equal(result.nexted, true);
  });

  it('still refuses every URL that could escape the application', () => {
    for (const url of [
      'javascript:alert(1)',
      'javascript://comment%0Aalert(1)',
      'data:text/html,<script>alert(1)</script>',
      '//evil.example',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'ht!tp://nope',
    ]) {
      const result = runValidation(apiSchemas.segmentExperience, { cta: { buttonUrl: url } });
      assert.equal(result.statusCode, 400, `${url} must be rejected`);
    }
  });

  it('refuses an unsafe guide CTA the same way as a main CTA', () => {
    const bad = runValidation(apiSchemas.segmentExperience, {
      guides: [{ title: 'Guide', description: 'd', cta: { text: 'Read', url: 'javascript:alert(1)' } }],
    });
    assert.equal(bad.statusCode, 400);

    const good = runValidation(apiSchemas.segmentExperience, {
      guides: [{ title: 'Guide', description: 'd', cta: { text: 'Read', url: '/guides/one' } }],
    });
    assert.equal(good.nexted, true);
  });

  it('keeps the image rule strict: a hero image must be an absolute http(s) URL', () => {
    // A hero image is NOT a navigation link, so it must not inherit the
    // relative-path allowance. The renderer uses `isSafeSegmentUrl` for it.
    for (const url of ['/hero.png', 'javascript:alert(1)', 'data:image/png;base64,x', '//evil.example/x.png']) {
      const result = runValidation(apiSchemas.segmentExperience, { branding: { heroImageUrl: url } });
      assert.equal(result.statusCode, 400, `${url} must be rejected as an image URL`);
    }

    const good = runValidation(apiSchemas.segmentExperience, {
      branding: {
        heroImageUrl: 'https://abc.supabase.co/storage/v1/object/public/segment-hero/segment-hero/a-1-b.png',
        heroImageAlt: 'A mentor session',
      },
    });
    assert.equal(good.nexted, true);
  });

  it('saves a config carrying a hero image alongside a relative CTA', () => {
    const result = runValidation(apiSchemas.segmentExperience, {
      branding: {
        heroImageUrl: 'https://abc.supabase.co/storage/v1/object/public/segment-hero/segment-hero/a-1-b.png',
        heroImageAlt: 'A mentor session',
        accent: '#0d9488',
      },
      cta: { title: 'Talk to an autism mentor', buttonText: 'See autism mentors', buttonUrl: '/mentors' },
      sections: { hero: { enabled: true } },
    });
    assert.equal(result.nexted, true);
    const body = result.req.body as { branding: { heroImageUrl: string; heroImageAlt: string } };
    assert.match(body.branding.heroImageUrl, /^https:\/\//);
    assert.equal(body.branding.heroImageAlt, 'A mentor session');
  });

  it('accepts the section toggles the admin UI writes', () => {
    // Regression: `sections` was a separate top-level schema, so a config
    // containing it was refused as an unrecognised key and no save succeeded.
    const result = runValidation(apiSchemas.segmentExperience, {
      sections: {
        hero: { enabled: true },
        guides: { enabled: false },
        stories: { enabled: false },
        cta: { enabled: true },
      },
    });
    assert.equal(result.nexted, true);
  });

  it('refuses a section key outside the closed registry', () => {
    const result = runValidation(apiSchemas.segmentExperience, { sections: { sneaky: { enabled: true } } });
    assert.equal(result.statusCode, 400);
  });

  it('accepts a per-item enabled flag the read model already honours', () => {
    const result = runValidation(apiSchemas.segmentExperience, {
      quickHelp: [{ title: 'Choosing a therapist', description: 'd', enabled: false }],
      faq: [{ question: 'q', answer: 'a', enabled: false }],
    });
    assert.equal(result.nexted, true);
  });

  it('saves the stored config of all three shipped segments', () => {
    // The exact shape stored in the database, reduced to the fields the schema
    // governs. Before the fix every one of these returned 400.
    const stored: Array<Record<string, unknown>> = [
      {
        cta: {
          title: 'Talk to an autism mentor',
          buttonUrl: '/mentors',
          buttonText: 'See autism mentors',
          description: 'One focused session can turn a decade of guessing into a plan you can act on this month.',
        },
        sections: { hero: { enabled: true }, guides: { enabled: false }, stories: { enabled: false } },
        branding: { accent: '#0d9488', eyebrow: 'Autism mentoring', heroTint: '#ccfbf1', textMode: 'auto' },
        topics: [{ icon: 'compass', title: 'Diagnosis', description: 'd' }],
        quickHelp: [{ icon: 'compass', title: 'Not sure it is autism?', description: 'd' }],
        journeySteps: [{ icon: 'calendar', title: 'Book a session', description: 'd' }],
        benefits: [{ icon: 'heart-handshake', title: 'Lived experience', description: 'd' }],
        faq: [{ question: 'Do I need a diagnosis first?', answer: 'No.' }],
      },
      {
        cta: {
          title: 'One session before your next move',
          buttonUrl: '/mentors',
          buttonText: 'See career mentors',
          description: 'Find the mentor whose topic matches the decision in front of you.',
        },
        sections: { hero: { enabled: true }, guides: { enabled: false } },
        branding: { accent: '#4338ca', eyebrow: 'Career mentoring', heroTint: '#dfe4fb', textMode: 'auto' },
        topics: [{ icon: 'briefcase', title: 'Current, not textbook', description: 'd' }],
        faq: [{ question: 'How do I know which mentor is right for me?', answer: 'Filter by topic.' }],
      },
      {
        // relationship-advisor: empty descriptions and empty icons, as stored.
        topics: [{ icon: '', title: 'Couples', description: '' }],
        quickHelp: [{ icon: '', title: 'Couples session', description: '' }],
        journeySteps: [{ icon: '', title: 'Figuring it out', description: '' }],
        branding: { accent: '#db2777', eyebrow: 'Relationship mentoring', tintColor: '#f60195' },
      },
    ];

    for (const config of stored) {
      const result = runValidation(apiSchemas.segmentExperience, config);
      assert.equal(result.nexted, true, JSON.stringify((result.payload as { error?: unknown } | null)?.error ?? {}));
    }
  });
});

// ---------------------------------------------------------------------------
// Sanitisation reaching the stored value
// ---------------------------------------------------------------------------

describe('sanitisation', () => {
  it('strips markup out of a gig title before the handler sees it', () => {
    const result = runValidation(apiSchemas.gigCreate, {
      title: '<script>alert(1)</script>Career clarity',
      segmentId: '3f2b1c0a-1111-4222-8333-444455556666',
      durationMinutes: 30,
      priceInr: 100,
    });
    assert.equal(result.nexted, true);
    assert.equal((result.req.body as { title: string }).title, 'Career clarity');
  });

  it('strips markup out of a bio, description and rejection reason', () => {
    const gig = runValidation(apiSchemas.gigCreate, {
      title: 'Session',
      segmentId: '3f2b1c0a-1111-4222-8333-444455556666',
      durationMinutes: 30,
      priceInr: 100,
      description: '<img src=x onerror=alert(1)>deep dive',
    });
    assert.equal((gig.req.body as { description: string }).description, 'deep dive');

    const reason = runValidation(apiSchemas.paymentReject, { rejectionReason: '<b>wrong</b> amount' });
    assert.equal((reason.req.body as { rejectionReason: string }).rejectionReason, 'wrong amount');
  });

  it('strips markup out of every workspace list item and the mentor notes', () => {
    const result = runValidation(apiSchemas.workspace, {
      bookingId: 'bk-1',
      mentorNotes: '<script>alert(1)</script>Summary',
      takeaways: ['<b>one</b>', 'two'],
      nextSteps: [{ id: 'a', text: '<i>do</i> this' }],
    });
    assert.equal(result.nexted, true);
    const body = result.req.body as {
      mentorNotes?: string;
      takeaways: string[];
      nextSteps?: Array<{ text: string }>;
    };
    assert.equal(body.mentorNotes, 'Summary');
    assert.deepEqual(body.takeaways, ['one', 'two']);
    assert.equal(body.nextSteps?.[0]?.text, 'do this');
  });

  it('strips markup out of mentor application free text', () => {
    const result = runValidation(apiSchemas.mentorApplicationDraft, {
      fullName: '<b>Rahul</b> Sharma',
      bio: '<script>alert(1)</script>Ten years of mentoring.',
      headline: '<i>Career</i> coach',
    });
    assert.equal(result.nexted, true);
    const body = result.req.body as { fullName: string; bio?: string; headline?: string };
    assert.equal(body.fullName, 'Rahul Sharma');
    assert.equal(body.bio, 'Ten years of mentoring.');
    assert.equal(body.headline, 'Career coach');
  });

  it('strips markup out of tag lists', () => {
    const result = runValidation(apiSchemas.adminMentorProfile, { languages: ['<b>Hindi</b>', 'English'] });
    assert.equal(result.nexted, true);
    assert.deepEqual((result.req.body as { languages: string[] }).languages, ['Hindi', 'English']);
  });

  it('rejects a required field that is nothing but markup', () => {
    const result = runValidation(apiSchemas.gigCreate, {
      title: '<script>alert(1)</script>',
      segmentId: '3f2b1c0a-1111-4222-8333-444455556666',
      durationMinutes: 30,
      priceInr: 100,
    });
    assert.equal(result.statusCode, 400);
  });

  it('rejects a document type that is not a code', () => {
    const result = runValidation(apiSchemas.mentorDocument, {
      applicationId: '3f2b1c0a-1111-4222-8333-444455556666',
      documentType: '<b>aadhar</b>',
      storagePath: 'u/a/file.png',
      originalFilename: 'file.png',
      mimeType: 'image/png',
      sizeBytes: 1024,
    });
    assert.equal(result.statusCode, 400);
  });
});

// ---------------------------------------------------------------------------
// Blank optional fields must not be treated as bad input
// ---------------------------------------------------------------------------

describe('blank optional fields', () => {
  it('treats a blank email on demo login as absent rather than invalid', () => {
    const result = runValidation(apiSchemas.demoLogin, { persona: 'seeker', email: '', password: '' });
    assert.equal(result.nexted, true);
    const body = result.req.body as { persona?: string; email?: string; password?: string };
    assert.equal(body.persona, 'seeker');
    assert.equal(body.email, undefined);
    assert.equal(body.password, undefined);
  });

  it('accepts an email-only demo login', () => {
    const result = runValidation(apiSchemas.demoLogin, { email: 'seeker@suggestkey.com', password: 'password123' });
    assert.equal(result.nexted, true);
  });

  it('falls back to the platform default when timezone is blank', () => {
    const result = runValidation(apiSchemas.availability, { rules: [], timezone: '' });
    assert.equal(result.nexted, true);
    assert.equal((result.req.body as { timezone?: string }).timezone, undefined);
  });

  it('rejects a non-blank timezone that is not a real zone', () => {
    const result = runValidation(apiSchemas.availability, { rules: [], timezone: 'Mars/Olympus' });
    assert.equal(result.statusCode, 400);
  });

  it('rejects an unknown demo persona', () => {
    const result = runValidation(apiSchemas.demoLogin, { persona: 'root' });
    assert.equal(result.statusCode, 400);
  });
});
