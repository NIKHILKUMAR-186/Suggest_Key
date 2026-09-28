/**
 * API REQUEST VALIDATION (Zod)
 * =============================
 * One authoritative layer between the network and the route handlers. Every
 * POST / PUT / PATCH body is parsed, bounds-checked, and sanitised here before
 * a handler ever reads it.
 *
 * Three jobs, in this order:
 *
 *   1. SHAPE.  Exact types, required-vs-optional, array/object nesting. The
 *      object schemas are strict, so an unrecognised key is a 400 instead of a
 *      silently ignored field (or, worse, a mass-assignment of a column the
 *      handler did not intend to expose).
 *   2. BOUNDS. Length, range and format limits that match the real database
 *      columns, so an over-long bio is rejected at the edge rather than failing
 *      a write deeper in the stack.
 *   3. SANITISE. Free text is stripped of HTML (see `stripHtmlTags`) so a
 *      `<script>` payload submitted by a user is never persisted, even if some
 *      future surface renders that text as HTML instead of escaping it.
 *
 * The failure response is deliberately flat and human-readable:
 *
 *   { success: false, error: { code: 'VALIDATION_ERROR', message, fields } }
 *
 * `message` is the first human-readable problem, so a form can show it without
 * walking `fields`; `fields` maps each failing path to its own message so a form
 * can highlight the exact inputs.
 */

import { z } from 'zod';
import type { NextFunction, Request, Response } from 'express';

// ---------------------------------------------------------------------------
// HTML / control-character sanitising
// ---------------------------------------------------------------------------

/**
 * Remove markup from a user-supplied string.
 *
 * Notes on the shapes this has to survive:
 *  - `<script>alert(1)</script>` and friends are dropped *with their contents*,
 *    because stripping only the tags would leave a live `alert(1)` string behind.
 *  - `>` inside a quoted attribute (`<a title="a > b">`) must not end the tag
 *    early, hence the alternation that consumes quoted spans.
 *  - A dangling `<b` at the very end of the value is still removed.
 *  - `<` that is NOT tag-like is preserved, so ordinary prose such as
 *    "under 5000" or "a < b" survives untouched. This is why the opener
 *    character class requires a letter, `/`, `!` or `?` immediately after `<`.
 */
export function stripHtmlTags(input: string): string {
  return input
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<([a-zA-Z/!?])(?:[^<>"']|"[^"]*"|'[^']*')*>/g, '')
    .replace(/<[a-zA-Z/!?][^<>]*$/, '')
    // C0 control characters (tab / LF / CR are intentionally kept).
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

// ---------------------------------------------------------------------------
// Shared field builders
// ---------------------------------------------------------------------------

/**
 * A UUID in the shape the database stores.
 *
 * Deliberately NOT `z.uuid()`: that enforces the RFC 4122 version/variant
 * nibbles, and the seeded platform rows use nil-prefixed ids, so a strict check
 * would reject legitimate ids. The database stays the authority on whether the
 * row exists.
 */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HHMM = /^\d{2}:\d{2}(:\d{2})?$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ALLOWED_DOCUMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const ALLOWED_GIG_DURATIONS = [30, 45, 60, 90, 120] as const;
const MAX_AVAILABILITY_RULES = 50;
const MAX_AVAILABILITY_EXCEPTIONS = 200;

export const MAX_BIO_LENGTH = 2000;
export const MAX_HEADLINE_LENGTH = 140;
export const MAX_TITLE_LENGTH = 200;
export const MAX_NAME_LENGTH = 120;
export const MAX_SEGMENT_DESCRIPTION_LENGTH = 500;
export const MAX_REASON_LENGTH = 500;
export const MAX_TAG_LENGTH = 40;
export const MAX_TAGS = 12;
export const MAX_EXPERIENCE_YEARS = 80;

/**
 * Free text: trimmed, HTML-stripped, and length-bounded.
 *
 * Sanitising happens BEFORE the length check, so padding a field with markup
 * cannot be used to slip past a column limit, and a value that is only markup
 * collapses to empty and is then correctly rejected as required.
 */
export function text(options: { min?: number; max: number; label: string; multiline?: boolean }) {
  const { min = 0, max, label, multiline = false } = options;
  return z
    .string()
    .transform((value) => {
      const stripped = stripHtmlTags(value).trim();
      return multiline ? stripped.replace(/\r\n/g, '\n') : stripped;
    })
    .pipe(
      z
        .string()
        .min(min, min === 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`)
        .max(max, `${label} must be ${max} characters or fewer.`)
    );
}

/** Free text that may be omitted entirely. */
export function optionalText(options: { max: number; label: string; multiline?: boolean }) {
  return z.union([text({ ...options, min: 0 }), z.literal('').transform(() => '')]).optional();
}

/** Email: trimmed, lower-cased, then format-checked. */
export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address.'));

/**
 * Treat a blank string as "field not supplied".
 *
 * HTML forms submit `""` for an input the user never typed into, and
 * `JSON.stringify` keeps that key present. Without this, an untouched optional
 * field would fail a `min(1)` or `.email()` rule even though the user did
 * nothing wrong. Applied to OPTIONAL fields only — a genuinely required field
 * must still complain about a blank value.
 */
const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export const httpUrlField = z
  .string()
  .trim()
  .pipe(z.url('Enter a valid URL.'))
  .refine((value) => /^https?:\/\//i.test(value), 'Only http and https links are allowed.');

export const uuidField = z
  .string()
  .trim()
  .pipe(
    z
      .string()
      .regex(UUID_SHAPE, 'Enter a valid ID.')
  );

/**
 * Any non-empty opaque identifier.
 *
 * Used where the value is only ever compared against a database column (a
 * booking code, a notification id) and the real table is the authority, so
 * pinning it to a UUID shape would reject legitimate codes.
 */
export const idField = z.string().trim().min(1, 'This value is required.').max(200, 'This value is too long.');

/** A timezone the runtime can actually resolve. */
export function isValidTimezone(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false;
  const candidate = value.trim();
  if (candidate === 'UTC') return true;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return true;
  } catch {
    return false;
  }
}

/**
 * Timezone, optional.
 *
 * A blank string is treated as "not supplied" so an untouched form field keeps
 * falling back to the platform default instead of failing; a non-blank value
 * that is not a real zone is a 400.
 */
export const timezoneField = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .refine(isValidTimezone, 'Select a valid timezone.')
    .optional()
);

export const isoDateTimeField = z.iso.datetime({ offset: true, message: 'Enter a valid date and time.' });

/** A clock time for availability windows: `HH:MM` or `HH:MM:SS`. */
export const clockTimeField = z
  .string()
  .trim()
  .pipe(z.string().regex(HHMM, 'Use a HH:MM time, for example 09:30.'));

/**
 * True when the client sent at least one of the fields the schema knows about.
 *
 * An EMPTY ARRAY still counts as supplied: `segmentIds: []` is a meaningful
 * instruction ("remove every segment"), not an empty request. Only a body
 * whose every key is absent is rejected.
 */
function hasAtLeastOneField(body: Record<string, unknown>): boolean {
  return Object.values(body).some((value) => value !== undefined);
}

/** Languages / expertise tags: bounded count, each tag sanitised. */
const tagArray = () =>
  z.array(text({ max: MAX_TAG_LENGTH, label: 'Each tag' })).max(MAX_TAGS, `Use at most ${MAX_TAGS} tags.`);

/**
 * Tag list for a field that is written straight to a `text[]` column.
 * Defaults to `[]` so an absent field clears nothing and writes nothing.
 */
const tagListField = tagArray().optional().default([]);

/**
 * Same, but `null` is also accepted because the handler maps it onto SQL NULL
 * to CLEAR the column — a distinct outcome from writing an empty array.
 */
const nullableTagListField = tagArray().nullable().optional().default([]);

const experienceYearsField = z
  .int('Years of experience must be a whole number.')
  .min(0, 'Years of experience cannot be negative.')
  .max(MAX_EXPERIENCE_YEARS, `Years of experience must be ${MAX_EXPERIENCE_YEARS} or fewer.`);

const gigDurationField = z
  .int('Duration must be a whole number of minutes.')
  .refine(
    (value) => (ALLOWED_GIG_DURATIONS as readonly number[]).includes(value),
    'Duration must be one of 30, 45, 60, 90 or 120 minutes.'
  );

const priceField = z
  .number('Price must be a number.')
  .finite('Price must be a number.')
  .min(0, 'Price cannot be negative.')
  .max(10_000_000, 'Price is unrealistically high.');

const slugField = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z
      .string()
      .min(1, 'Slug is required.')
      .max(60, 'Slug must be 60 characters or fewer.')
      .regex(SLUG, 'Use lowercase letters, numbers and single hyphens, for example relationship-advisor.')
  );

const accountActionField = z.enum(['activate', 'deactivate', 'suspend', 'reactivate'], {
  message: 'Action must be one of: activate, deactivate, suspend, reactivate.',
});

const suspendedUntilField = isoDateTimeField.optional();

// ---------------------------------------------------------------------------
// Nested availability payloads (shared by the mentor and admin routes)
// ---------------------------------------------------------------------------

const availabilityRuleSchema = z
  .strictObject({
    dayOfWeek: z.int('Day must be a whole number.').min(0, 'Day must be between 0 and 6.').max(6, 'Day must be between 0 and 6.'),
    startTime: clockTimeField,
    endTime: clockTimeField,
    isEnabled: z.boolean().optional().default(true),
  })
  .refine((rule) => rule.startTime < rule.endTime, {
    message: 'Start time must be earlier than end time.',
    path: ['startTime'],
  });

const availabilityExceptionSchema = z
  .strictObject({
    exceptionDate: z
      .string()
      .trim()
      .pipe(z.string().regex(YMD, 'Use a YYYY-MM-DD date, for example 2026-09-27.')),
    isAvailable: z.boolean().optional().default(false),
    startTime: clockTimeField.nullish(),
    endTime: clockTimeField.nullish(),
    reason: optionalText({ max: MAX_REASON_LENGTH, label: 'Reason' }),
  })
  .refine(
    (exception) =>
      !exception.isAvailable ||
      (Boolean(exception.startTime) &&
        Boolean(exception.endTime) &&
      exception.startTime! < exception.endTime!),
    {
      message: 'An available day needs an end time later than its start time.',
      path: ['startTime'],
    }
  );

const availabilitySchema = z.strictObject({
  rules: z
    .array(availabilityRuleSchema)
    .max(MAX_AVAILABILITY_RULES, `A mentor may not have more than ${MAX_AVAILABILITY_RULES} recurring windows.`),
  timezone: timezoneField,
});

const availabilityExceptionsSchema = z.strictObject({
  exceptions: z
    .array(availabilityExceptionSchema)
    .max(MAX_AVAILABILITY_EXCEPTIONS, `A mentor may not have more than ${MAX_AVAILABILITY_EXCEPTIONS} date exceptions.`),
});

// ---------------------------------------------------------------------------
// Gigs
// ---------------------------------------------------------------------------

const gigTitleField = text({ min: 1, max: MAX_TITLE_LENGTH, label: 'Title' });
const gigDescriptionField = optionalText({ max: MAX_BIO_LENGTH, label: 'Description', multiline: true });

const gigCreateShape = {
  title: gigTitleField,
  segmentId: uuidField,
  durationMinutes: gigDurationField,
  priceInr: priceField,
  description: gigDescriptionField,
};

const gigUpdateShape = {
  title: gigTitleField.optional(),
  durationMinutes: gigDurationField.optional(),
  priceInr: priceField.optional(),
  description: optionalText({ max: MAX_BIO_LENGTH, label: 'Description', multiline: true }),
  isActive: z.boolean().optional(),
};

/** Create and update share their field definitions; only requiredness differs. */
const gigUpdateSchema = z.strictObject(gigUpdateShape).refine(
  hasAtLeastOneField,
  { message: 'No editable fields were provided.' }
);

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

const segmentNameField = text({ min: 1, max: MAX_NAME_LENGTH, label: 'Segment name' });
const segmentDescriptionField = optionalText({
  max: MAX_SEGMENT_DESCRIPTION_LENGTH,
  label: 'Description',
  multiline: true,
});
const segmentPriorityField = z.int().min(0, 'Priority cannot be negative.').max(10_000, 'Priority is too large.');

/** A create needs name + slug; an update takes any subset. */
const segmentCreateShape = {
  name: segmentNameField,
  slug: slugField,
  priority: segmentPriorityField.optional(),
  isActive: z.boolean().optional(),
  description: segmentDescriptionField,
};

const segmentUpdateShape = {
  name: segmentNameField.optional(),
  slug: slugField.optional(),
  priority: segmentPriorityField.optional(),
  isActive: z.boolean().optional(),
  description: segmentDescriptionField,
};

// ---------------------------------------------------------------------------
// Profile fields shared by the mentor and admin user edit routes
// ---------------------------------------------------------------------------

const fullNameField = text({ min: 1, max: MAX_NAME_LENGTH, label: 'Full name' });
const phoneField = z
  .string()
  .trim()
  .transform((value) => (value ? value : ''))
  .pipe(z.string().max(25, 'Phone number must be 25 characters or fewer.').refine(isValidPhone, 'Enter a valid phone number or leave it blank.'))
  .optional();

/** Permissive on purpose: digits, spaces, brackets, dashes and a leading `+`. */
function isValidPhone(value: string): boolean {
  if (!value) return true;
  if (!/^\+?[\d\s().-]{6,25}$/.test(value)) return false;
  return (value.match(/\d/g) || []).length >= 6;
}

const headlineField = optionalText({ max: MAX_HEADLINE_LENGTH, label: 'Headline' });
const bioField = optionalText({ max: MAX_BIO_LENGTH, label: 'Bio', multiline: true });

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

const nextStepItemSchema = z.strictObject({
  id: z.string().trim().min(1).max(100).optional(),
  text: text({ max: MAX_TITLE_LENGTH, label: 'Next step' }),
  due_date: z.string().trim().max(60).optional(),
  completed: z.boolean().optional(),
});

const followUpSchema = z.union([
  z.strictObject({
    recommended: z.boolean(),
    timeframe: text({ min: 1, max: 80, label: 'Timeframe' }),
    topic: optionalText({ max: MAX_HEADLINE_LENGTH, label: 'Topic' }),
    notes: optionalText({ max: MAX_BIO_LENGTH, label: 'Notes', multiline: true }),
  }),
  optionalText({ max: MAX_BIO_LENGTH, label: 'Follow-up recommendation', multiline: true }),
  z.null(),
]);

// ---------------------------------------------------------------------------
// Error formatting
// ---------------------------------------------------------------------------

export type ValidationFieldErrors = Record<string, string>;

export interface ValidationFailure {
  code: 'VALIDATION_ERROR';
  message: string;
  fields: ValidationFieldErrors;
}

/**
 * Turn Zod issues into the app's error envelope.
 *
 * Issues that carry no path (a whole-object `.refine`, or a strict-object
 * "unrecognised key") are filed under `_` so the shape stays stable, and the
 * top-level `message` is the first readable one so a caller can display
 * something sensible without inspecting `fields`.
 */
export function formatValidationFailure(error: z.ZodError): ValidationFailure {
  const fields: ValidationFieldErrors = {};

  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    if (!(key in fields)) fields[key] = issue.message;
  }

  const first = error.issues[0];
  return {
    code: 'VALIDATION_ERROR',
    message: first ? first.message : 'The request was not valid.',
    fields,
  };
}

/**
 * Parse and replace `req.body` with the sanitised, typed result.
 *
 * `req.body` is deliberately overwritten: the handler then reads values that
 * are already trimmed, tag-free and type-correct, so no route can accidentally
 * fall back to the raw payload.
 */
export function validateBody<T>(schema: z.ZodType<T>) {
  return function validateBodyMiddleware(req: Request, res: Response, next: NextFunction): void {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      res.status(400).json({ success: false, error: formatValidationFailure(result.error) });
      return;
    }
    req.body = result.data;
    next();
  };
}

/**
 * Parse `req.body` inside a handler and return `null` after replying with the
 * 400. For routes that must read the body before validating (for example to
 * read an existing row first) or that need to branch on the outcome.
 */
export function parseBody<T>(req: Request, res: Response, schema: z.ZodType<T>): T | null {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) {
    res.status(400).json({ success: false, error: formatValidationFailure(result.error) });
    return null;
  }
  req.body = result.data;
  return result.data;
}

// ---------------------------------------------------------------------------
// Route schemas, keyed by the route they belong to
// ---------------------------------------------------------------------------

export const apiSchemas = {
  // -- auth -----------------------------------------------------------------
  /**
   * The login form posts `{ email, password }`, and the persona buttons post
   * `{ persona }`. Either string can legitimately be blank when the user typed
   * nothing, so both are optional and blank-tolerant; a wrong value still falls
   * through to the handler's 401 rather than being revealed as a 400.
   */
  demoLogin: z.strictObject({
    persona: z.preprocess(
      blankToUndefined,
      z.enum(['seeker', 'mentor', 'admin'], { message: 'Unknown demo persona.' }).optional()
    ),
    email: z.preprocess(blankToUndefined, emailField.optional()),
    password: z.preprocess(
      blankToUndefined,
      z.string().min(1, 'Password is required.').max(200, 'Password is too long.').optional()
    ),
  }),

  // -- seeker booking -------------------------------------------------------
  bookingHold: z.strictObject({
    mentorId: uuidField,
    segmentId: uuidField,
    gigId: uuidField,
    startTime: isoDateTimeField,
    endTime: isoDateTimeField,
  }),

  bookingCancel: z.strictObject({
    reason: optionalText({ max: MAX_REASON_LENGTH, label: 'Reason', multiline: true }),
  }),

  bookingReschedule: z.strictObject({
    newStartTime: isoDateTimeField,
    newEndTime: isoDateTimeField,
    newGigId: uuidField.optional(),
  }),

  // -- mentor ---------------------------------------------------------------
  mentorBookingConfirm: z.strictObject({
    meetingUrl: httpUrlField,
  }),

  gigCreate: z.strictObject(gigCreateShape),
  gigUpdate: gigUpdateSchema,

  segmentApply: z.strictObject({
    segmentId: uuidField,
  }),

  availability: availabilitySchema,
  availabilityExceptions: availabilityExceptionsSchema,

  mentorApplicationDraft: z.strictObject({
    fullName: fullNameField,
    bio: bioField,
    timezone: timezoneField,
    headline: headlineField,
    experienceYears: experienceYearsField.optional(),
    segmentIds: z.array(uuidField, { message: 'Segment ids must be a list of IDs.' }).max(MAX_TAGS).optional(),
  }),

  mentorDocument: z.strictObject({
    applicationId: uuidField,
    documentType: z
      .string()
      .trim()
      .min(1, 'Document type is required.')
      .max(60, 'Document type is too long.')
      .regex(/^[a-z0-9_]+$/i, 'Document type must be a code, for example aadhar_front.'),
    storagePath: z.string().trim().min(1, 'Storage path is required.').max(500, 'Storage path is too long.'),
    originalFilename: z.string().trim().min(1, 'File name is required.').max(255, 'File name is too long.'),
    mimeType: z.enum(ALLOWED_DOCUMENT_MIME_TYPES, { message: 'Upload a JPG, PNG, WEBP or PDF file.' }),
    sizeBytes: z
      .int('File size must be a whole number of bytes.')
      .positive('File size must be greater than zero.')
      .max(MAX_DOCUMENT_BYTES, 'File size exceeds the 5MB limit.'),
  }),

  // -- admin: mentors -------------------------------------------------------
  mentorStatus: z.strictObject({
    action: accountActionField,
    reason: optionalText({ max: MAX_REASON_LENGTH, label: 'Reason', multiline: true }),
    suspendedUntil: suspendedUntilField,
  }),

  adminMentorProfile: z
    .strictObject({
      fullName: fullNameField.optional(),
      timezone: timezoneField,
      phone: phoneField,
      avatarUrl: z.union([httpUrlField, z.literal(''), z.null()]).optional(),
      headline: headlineField,
      bio: bioField,
      experienceYears: experienceYearsField.optional(),
      languages: tagListField,
      expertise: nullableTagListField,
      isFeatured: z.boolean().optional(),
      segmentIds: z.array(uuidField, { message: 'Segment ids must be a list of IDs.' }).max(MAX_TAGS).optional(),
    })
    .refine(hasAtLeastOneField, { message: 'No editable fields were provided.' }),

  adminMentorGigCreate: z.strictObject(gigCreateShape),
  adminMentorGigUpdate: gigUpdateSchema,
  adminMentorSegments: z.strictObject({
    segmentIds: z.array(uuidField, { message: 'Segment ids must be a list of IDs.' }).max(MAX_TAGS),
    primarySegmentId: uuidField.optional(),
  }),

  // -- admin: segments and gigs --------------------------------------------
  segmentCreate: z.strictObject(segmentCreateShape),
  segmentUpdate: z
    .strictObject(segmentUpdateShape)
    .refine(hasAtLeastOneField, {
      message: 'No editable fields were provided.',
    }),

  segmentToggleActive: z.strictObject({
    isActive: z.boolean('isActive must be true or false.'),
  }),

  segmentPriority: z.strictObject({
    direction: z.enum(['up', 'down'], { message: 'Direction must be "up" or "down".' }),
  }),

  segmentExperience: z.strictObject({
    branding: z.strictObject({
      heroHeadline: text({ max: 120, label: 'Hero headline' }).optional(),
      heroSubheadline: text({ max: 200, label: 'Hero subheadline', multiline: true }).optional(),
      tintColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #0d9488.').optional(),
      accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #0d9488.').optional(),
      accentSoft: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #0d9488.').optional(),
      accentSecondary: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #0d9488.').optional(),
      heroTint: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #0d9488.').optional(),
      gradientStart: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #0d9488.').optional(),
      gradientEnd: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #0d9488.').optional(),
      textMode: z.enum(['auto', 'light', 'dark']).optional(),
      heroImageUrl: httpUrlField.optional(),
    }).optional(),
    topics: z.array(z.strictObject({
      title: text({ max: 80, label: 'Title' }),
      description: text({ max: 200, label: 'Description', multiline: true }),
      icon: z.string().trim().max(40).optional(),
    })).max(8, 'Use at most 8 topics.').optional(),
    quickHelp: z.array(z.strictObject({
      title: text({ max: 80, label: 'Title' }),
      description: text({ max: 200, label: 'Description', multiline: true }),
      icon: z.string().trim().max(40).optional(),
    })).max(6, 'Use at most 6 quick help items.').optional(),
    journeySteps: z.array(z.strictObject({
      title: text({ max: 80, label: 'Title' }),
      description: text({ max: 200, label: 'Description', multiline: true }),
      icon: z.string().trim().max(40).optional(),
    })).max(6, 'Use at most 6 journey steps.').optional(),
    benefits: z.array(z.strictObject({
      title: text({ max: 80, label: 'Title' }),
      description: text({ max: 200, label: 'Description', multiline: true }),
      icon: z.string().trim().max(40).optional(),
    })).max(6, 'Use at most 6 benefits.').optional(),
    faq: z.array(z.strictObject({
      question: text({ max: 200, label: 'Question' }),
      answer: text({ max: 1000, label: 'Answer', multiline: true }),
    })).max(8, 'Use at most 8 FAQ items.').optional(),
    guides: z.array(z.strictObject({
      topic: optionalText({ max: 80, label: 'Topic' }),
      title: text({ max: 200, label: 'Title' }),
      description: text({ max: 400, label: 'Description', multiline: true }),
      readingTime: optionalText({ max: 40, label: 'Reading time' }),
      cta: z.strictObject({
        text: text({ max: 60, label: 'CTA text' }),
        url: httpUrlField,
      }).optional(),
    })).max(6, 'Use at most 6 guides.').optional(),
    stories: z.array(z.strictObject({
      quote: text({ max: 600, label: 'Quote', multiline: true }),
      name: text({ min: 1, max: 80, label: 'Name' }),
      context: optionalText({ max: 120, label: 'Context' }),
      avatar: httpUrlField.optional(),
    })).max(6, 'Use at most 6 stories.').optional(),
    cta: z.strictObject({
      text: text({ max: 60, label: 'CTA text' }),
      url: httpUrlField,
    }).optional(),
  }).optional(),

  segmentAddMentor: z.strictObject({
    mentorId: uuidField,
    isPrimary: z.boolean().optional().default(false),
  }),

  segmentGigCreate: z.strictObject({
    mentorId: uuidField,
    ...gigCreateShape,
    isActive: z.boolean().optional(),
  }),

  adminGigUpdate: z
    .strictObject({
      title: gigTitleField.optional(),
      description: optionalText({ max: MAX_BIO_LENGTH, label: 'Description', multiline: true }),
      durationMinutes: gigDurationField.optional(),
      priceInr: priceField.optional(),
      isActive: z.boolean().optional(),
    })
    .refine(hasAtLeastOneField, {
      message: 'No editable fields were provided.',
    }),

  adminGigToggleActive: z.strictObject({
    isActive: z.boolean('isActive must be true or false.'),
  }),

  // -- admin: users ---------------------------------------------------------
  adminUserUpdate: z
    .strictObject({
      fullName: fullNameField.optional(),
      timezone: timezoneField,
      phone: phoneField,
      bio: bioField,
      headline: headlineField,
      experienceYears: experienceYearsField.optional(),
    })
    .refine(hasAtLeastOneField, {
      message: 'No editable fields were provided.',
    }),

  adminUserStatus: z.strictObject({
    action: accountActionField,
    reason: optionalText({ max: MAX_REASON_LENGTH, label: 'Reason', multiline: true }),
    suspendedUntil: suspendedUntilField,
  }),

  adminUserNotification: z.strictObject({
    title: text({ min: 1, max: MAX_TITLE_LENGTH, label: 'Title' }),
    message: text({ min: 1, max: MAX_BIO_LENGTH, label: 'Message', multiline: true }),
  }),

  /**
   * Structural layer for direct-create. The richer cross-field rules (password
   * mode, "a mentor needs a segment", tag de-duplication) stay in
   * `validateCreateUserForm`, which is shared verbatim with the browser form, so
   * this schema deliberately does not duplicate them.
   */
  adminUserDirectCreate: z.strictObject({
    role: z.enum(['seeker', 'mentor'], { message: 'Role must be "seeker" or "mentor".' }),
    email: emailField,
    fullName: fullNameField,
    phone: phoneField,
    bio: bioField,
    headline: headlineField,
    timezone: timezoneField,
    password: z
      .string()
      .max(200, 'Password must be 200 characters or fewer.')
      .optional()
      .default(''),
    sendEmail: z.boolean().optional().default(true),
    experienceYears: z.union([experienceYearsField, z.literal(''), z.null()]).optional(),
    segmentIds: z
      .array(z.union([uuidField, z.literal('')]), { message: 'Segment ids must be a list of IDs.' })
      .max(MAX_TAGS)
      .optional()
      .default([]),
    languages: z
      .union([
        z.array(text({ max: MAX_TAG_LENGTH, label: 'Each language' })).max(MAX_TAGS),
        z.string().max(400, 'Too many languages.'),
      ])
      .optional()
      .default([]),
    expertise: z
      .union([
        z.array(text({ max: MAX_TAG_LENGTH, label: 'Each expertise' })).max(MAX_TAGS),
        z.string().max(400, 'Too many areas of expertise.'),
      ])
      .optional()
      .default([]),
  }),

  // -- admin: payments, applications, documents, system ---------------------
  paymentReject: z.strictObject({
    rejectionReason: text({ min: 1, max: MAX_REASON_LENGTH, label: 'Rejection reason', multiline: true }),
  }),

  mentorApplicationReject: z.strictObject({
    rejectionReason: text({ min: 1, max: MAX_REASON_LENGTH, label: 'Rejection reason', multiline: true }),
  }),

  mentorDocumentReview: z.strictObject({
    status: z.enum(['approved', 'rejected'], { message: 'Status must be "approved" or "rejected".' }),
    adminNote: optionalText({ max: MAX_REASON_LENGTH, label: 'Admin note', multiline: true }),
  }),

  logRetention: z.strictObject({
    retentionDays: z
      .int('Retention must be a whole number of days.')
      .min(1, 'Retention must be at least 1 day.')
      .max(365, 'Retention must be 365 days or fewer.'),
  }),

  // -- notifications, sessions, workspaces ---------------------------------
  notificationRead: z.strictObject({
    isRead: z.boolean().optional().default(true),
  }),

  notificationMarkAllRead: z.strictObject({
    userId: idField,
  }),

  notificationDispatch: z.strictObject({
    userId: idField.optional(),
    title: text({ min: 1, max: MAX_TITLE_LENGTH, label: 'Title' }),
    message: text({ min: 1, max: MAX_BIO_LENGTH, label: 'Message', multiline: true }),
    type: z.string().trim().min(1).max(40).optional().default('SYSTEM'),
    eventType: z.string().trim().max(80).optional(),
    entityType: z.string().trim().max(60).optional(),
    entityId: z.string().trim().max(200).optional(),
    link: z.string().trim().max(500).optional(),
    metadata: z.record(z.string(), z.unknown()).optional().default({}),
  }),

  // The caller identity is taken from the verified bearer token, never from
  // the body, so `userId` is accepted for backwards compatibility but must not
  // be required. `currentTime` is likewise accepted and deliberately ignored:
  // the T-5 gate is evaluated against the server clock, and a client-supplied
  // timestamp would otherwise be a way to unlock the meeting link early.
  sessionJoin: z.strictObject({
    userId: idField.optional(),
    currentTime: isoDateTimeField.optional(),
  }),

  /**
   * POST /api/sessions/:bookingId/complete — End a CONFIRMED session.
   *
   * Either the mentor or the seeker may end their own session (the room is a
   * shared space), and an admin may end any session. The caller's identity and
   * role come from the verified bearer token, never from the body, so the
   * fields below are all optional. `endReason` is free text: stripped of markup
   * and bounded so it cannot smuggle HTML into the audit trail or overflow the
   * column.
   */
  sessionComplete: z.strictObject({
    endReason: optionalText({ max: MAX_REASON_LENGTH, label: 'Reason', multiline: true }),
  }),

  workspace: z.strictObject({
    bookingId: idField,
    mentorId: uuidField.optional(),
    mentorNotes: optionalText({ max: 10_000, label: 'Mentor notes', multiline: true }),
    takeaways: z
      .array(text({ max: MAX_TITLE_LENGTH, label: 'Takeaway' }))
      .max(50, 'Use at most 50 takeaways.')
      .optional()
      .default([]),
    suggestions: z
      .array(text({ max: MAX_TITLE_LENGTH, label: 'Suggestion' }))
      .max(50, 'Use at most 50 suggestions.')
      .optional()
      .default([]),
    /**
     * Accepted under both spellings: the handler historically read `nextSteps`
     * while the Mentor and Admin workspace pages send `next_steps`. Normalising
     * here keeps both callers working and strips markup from every step.
     */
    nextSteps: z.array(nextStepItemSchema).max(50, 'Use at most 50 next steps.').optional(),
    next_steps: z.array(nextStepItemSchema).max(50, 'Use at most 50 next steps.').optional(),
    followUpRecommendation: followUpSchema.optional(),
    publish: z.boolean().optional().default(false),
    userId: idField.optional(),
    role: z.string().trim().max(20).optional(),
  }),
} as const;
