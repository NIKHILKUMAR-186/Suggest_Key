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
import { isSafeSegmentLink, SEGMENT_SECTION_KEYS } from './segmentExperience';
import {
  BOOKING_CODE_PATTERN,
  SUPPORT_ATTACHMENT_MAX_BYTES,
  SUPPORT_ATTACHMENT_MIME_TYPES,
  SUPPORT_MESSAGE_MAX,
  SUPPORT_MESSAGE_MIN,
  SUPPORT_RESOLUTION_MAX,
  SUPPORT_RESOLUTION_MIN,
  SUPPORT_SUBJECT_MAX,
  SUPPORT_SUBJECT_MIN,
  SUPPORT_TICKET_PRIORITIES,
  SUPPORT_TICKET_STATUSES,
} from './supportDomain';
import {
  PAYMENT_PROOF_MAX_BYTES,
  PAYMENT_PROOF_MAX_LABEL,
  PAYMENT_PROOF_MIME_TYPES,
  PAYMENT_QR_MAX_BYTES,
  PAYMENT_QR_MAX_LABEL,
  PAYMENT_QR_MIME_TYPES,
} from './paymentProof';

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
/** A refund proof is an image of a transfer receipt - never a PDF. */
const ALLOWED_REFUND_PROOF_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
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

/**
 * Optional free text where a blank value CLEARS the stored column.
 *
 * The distinction this exists for: an ABSENT key means "leave this setting
 * alone", while a key the admin submitted as empty means "clear it". The second
 * has to reach the database as `null`, not as `''`, so the handler's previous
 * behaviour — a trimmed empty string became NULL — is preserved exactly.
 *
 * Order matters, and getting it wrong is silent. `z.union([text(…), …])` tries
 * `text` first, and `text` happily returns `''` for a blank input, so the blank
 * branch below is never reached and the value is stored as an empty string
 * instead of being cleared. Mapping the blank to `null` before the union runs
 * removes that ordering hazard entirely.
 *
 * The emptiness test runs AFTER `stripHtmlTags` on purpose: a value that is
 * only markup is genuinely empty, and clearing it is the honest outcome rather
 * than storing a string of removed tags.
 */
export function nullableText(options: { max: number; label: string; multiline?: boolean }) {
  return z.preprocess(
    (value) => (typeof value === 'string' && stripHtmlTags(value).trim() === '' ? null : value),
    z.union([text(options), z.null()]),
  );
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

/**
 * A destination an admin can click in the CMS: an internal app path or an
 * absolute http(s) URL.
 *
 * This is the same contract as the frontend's `isSafeSegmentLink`, and the two
 * MUST agree. A segment CTA points at the app far more often than the outside
 * world ("See autism mentors" -> `/mentors`), so a schema that demanded an
 * absolute URL rejected the product's own intended value and the admin could
 * never save the config the renderer expects.
 *
 * Safety is unchanged by allowing the internal case: an internal link is a
 * single leading slash, so `//evil.example` (protocol-relative, which escapes
 * to another origin) is still refused, and `javascript:`, `data:`, `vbscript:`
 * and `file:` still fail both the slash test and the absolute http(s) test.
 */
const linkField = z
  .string()
  .trim()
  .refine(
    (value) => isSafeSegmentLink(value),
    'Enter a valid URL: use a path like /mentors, or an http(s) address.'
  );

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
 * A gateway-issued token (a Razorpay order id, payment id or HMAC signature).
 *
 * Bounded but NOT trimmed and NOT markup-stripped, deliberately: every one of
 * these values is compared byte-for-byte against what the gateway returned or
 * against an HMAC digest. Tidying whitespace or stripping a character would
 * turn a genuine mismatch into a 500 in the verification path, so the only rule
 * here is "a non-empty string that cannot be used as a free-text injection
 * vector". The character set is a superset of Razorpay's own ids and hex
 * signatures.
 */
function gatewayToken(label: string) {
  return z
    .string()
    .min(1, `${label} is required.`)
    .max(200, `${label} is too long.`);
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

/**
 * A single availability window longer than this is rejected.
 *
 * `startTime < endTime` already forbids wrapping past midnight, so a window
 * can never legitimately be 12 hours or more in a one-hour-per-session
 * scheduling product. In practice only a 12-hour clock mistake produces one:
 * a mentor meaning 13:10 -> 13:15 who typed "1:10" against an AM/PM clock
 * writes 01:10 -> 13:15, and the engine faithfully expands that 12h05m block
 * into twelve bookable 60-minute slots starting at 01:10 local time. Catching
 * it here turns a silent all-day availability into a form error the mentor can
 * see and fix.
 */
const MAX_AVAILABILITY_WINDOW_MINUTES = 12 * 60;

const windowMinutes = (time: string) => {
  const [hh, mm] = time.split(':').map(Number);
  return (hh || 0) * 60 + (mm || 0);
};

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
  })
  .refine(
    (rule) => windowMinutes(rule.endTime) - windowMinutes(rule.startTime) < MAX_AVAILABILITY_WINDOW_MINUTES,
    {
      message:
        'That time window is 12 hours or longer. Check the start and end times — a window this long is usually a 1:10 PM / 1:10 AM mix-up.',
      path: ['startTime'],
    }
  );

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
  )
  .refine(
    (exception) =>
      !exception.isAvailable ||
      !exception.startTime ||
      !exception.endTime ||
      windowMinutes(exception.endTime) - windowMinutes(exception.startTime) <
        MAX_AVAILABILITY_WINDOW_MINUTES,
    {
      message:
        'That time window is 12 hours or longer. Check the start and end times — a window this long is usually a 1:10 PM / 1:10 AM mix-up.',
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

/**
 * The pre-discount price, or null when the gig was never reduced.
 *
 * Accepted as `null` (or `''`) because "no original price" is the normal state
 * and an admin must be able to remove a struck-through price by clearing the
 * field. The `> price` rule is a database CHECK, so the real constraint message
 * is raised there rather than duplicated here with a second, drifting copy.
 */
const gigOriginalPriceField = z.union([priceField, z.literal('').transform(() => null), z.null()]);

const gigCreateShape = {
  title: gigTitleField,
  segmentId: uuidField,
  durationMinutes: gigDurationField,
  priceInr: priceField,
  // `.optional()` is required, not cosmetic: "no original price" is the normal
  // state and an omitted key must mean exactly that. Without it every existing
  // gig-create caller that doesn't send the field is rejected outright.
  originalPriceInr: gigOriginalPriceField.optional(),
  description: gigDescriptionField,
};

const gigUpdateShape = {
  title: gigTitleField.optional(),
  durationMinutes: gigDurationField.optional(),
  priceInr: priceField.optional(),
  originalPriceInr: gigOriginalPriceField.optional(),
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

/**
 * Per-section on/off toggles.
 *
 * The registry is taken from the frontend's own list rather than restated, so
 * a section the renderer knows can never be refused by the write schema (the
 * mismatch that made `sections` an unrecognised key and blocked every save).
 *
 * `partialRecord`, not `record`: an exhaustive record would demand all ten
 * toggles, and a config that only sets the two it cares about must save.
 */
const sectionToggles = z.partialRecord(
  z.enum(SEGMENT_SECTION_KEYS),
  z.strictObject({ enabled: z.boolean() }),
);

/**
 * A title/description/icon entry. Shared by topics, quick help, journey steps
 * and benefits, which are the same shape under different section keys.
 *
 * `enabled` is the per-item admin toggle the read model already honours, so the
 * write schema must accept it or a config using it can never be saved back.
 */
const experienceItemSchema = z.strictObject({
  title: text({ max: 80, label: 'Title' }),
  description: text({ max: 200, label: 'Description', multiline: true }),
  icon: z.string().trim().max(40).optional(),
  enabled: z.boolean().optional(),
});

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
 * Zod messages that carry no information for the person who submitted the form.
 *
 * `invalid_union` collapses every type mismatch of a `z.union` into one issue,
 * and its default text is exactly "Invalid input". Surfaced verbatim it told an
 * admin nothing about which field was wrong, so it is rewritten below.
 */
const UNINFORMATIVE_ZOD_MESSAGES = new Set(['Invalid input']);

/**
 * One issue turned into something displayable.
 *
 * Only the bare defaults are rewritten: a specific branch message (for example
 * "Admin note must be 500 characters or fewer.") is always preferred and is
 * never replaced. A union-level `error` override would have hidden those, which
 * is why the fix lives here rather than in the schemas.
 */
function readableIssueMessage(issue: z.core.$ZodIssue): string {
  if (!UNINFORMATIVE_ZOD_MESSAGES.has(issue.message)) return issue.message;
  const key = issue.path.length > 0 ? issue.path.join('.') : null;
  if (key) return `${key} was not a valid value for this field.`;
  return 'The request was not valid.';
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
    if (!(key in fields)) fields[key] = readableIssueMessage(issue);
  }

  const first = error.issues[0];
  return {
    code: 'VALIDATION_ERROR',
    message: first ? readableIssueMessage(first) : 'The request was not valid.',
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

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------

/**
 * Mirrors the `coupons` CHECK constraints.
 *
 * The database is the authority on every rule here; these exist so an admin
 * gets the rule in a form next to the field rather than as a constraint
 * violation after the fact.
 */
const couponCodeField = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(
    z
      .string()
      .regex(/^[A-Z0-9_]{4,24}$/, 'Use 4 to 24 letters, numbers or underscores.'),
  );

const couponDiscountValueField = z
  .int('Discount must be a whole number.')
  .min(1, 'Discount must be at least 1.')
  .max(10_000_000, 'Discount is unrealistically high.');

const couponUseLimitField = z
  .int('Limit must be a whole number.')
  .min(1, 'Limit must be at least 1.')
  .max(1_000_000, 'Limit is unrealistically high.');

/** `null` clears a limit, which is how the admin form expresses "unlimited". */
const nullablePositiveInt = (label: string) =>
  z.union([couponUseLimitField, z.literal('').transform(() => null), z.null()]).optional();

const couponShape = {
  code: couponCodeField,
  description: optionalText({ max: 300, label: 'Description', multiline: true }),
  discountType: z.enum(['PERCENTAGE', 'FIXED'], { message: 'Choose a percentage or a fixed amount.' }),
  discountValue: couponDiscountValueField,
  maxDiscountInr: z
    .union([priceField, z.literal('').transform(() => null), z.null()])
    .optional(),
  minOrderAmountInr: priceField.optional().default(0),
  segmentId: z.union([uuidField, z.literal('').transform(() => null), z.null()]).optional(),
  mentorId: z.union([uuidField, z.literal('').transform(() => null), z.null()]).optional(),
  maxTotalUses: nullablePositiveInt('Total use limit'),
  maxUsesPerUser: nullablePositiveInt('Per-user limit'),
  startsAt: isoDateTimeField.optional(),
  expiresAt: z.union([isoDateTimeField, z.literal('').transform(() => null), z.null()]).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional().default('ACTIVE'),
};

const couponUpdateShape: Record<string, z.ZodTypeAny> = {
  description: optionalText({ max: 300, label: 'Description', multiline: true }),
  discountType: z.enum(['PERCENTAGE', 'FIXED'], { message: 'Choose a percentage or a fixed amount.' }).optional(),
  discountValue: couponDiscountValueField.optional(),
  maxDiscountInr: z
    .union([priceField, z.literal('').transform(() => null), z.null()])
    .optional(),
  minOrderAmountInr: priceField.optional(),
  segmentId: z.union([uuidField, z.literal('').transform(() => null), z.null()]).optional(),
  mentorId: z.union([uuidField, z.literal('').transform(() => null), z.null()]).optional(),
  maxTotalUses: nullablePositiveInt('Total use limit'),
  maxUsesPerUser: nullablePositiveInt('Per-user limit'),
  startsAt: isoDateTimeField.optional(),
  expiresAt: z.union([isoDateTimeField, z.literal('').transform(() => null), z.null()]).optional(),
};

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

  /**
   * Body of `POST /api/auth/login-failure` — the brute-force alert telemetry.
   *
   * Supabase password sign-in happens in the browser, so the server never sees
   * the failed attempt and the client reports it here. Both fields are
   * deliberately optional: the tracker keys on `email` OR `ip`, and a client
   * that could not resolve the email it tried must still be able to report the
   * attempt by IP alone rather than have its telemetry silently dropped.
   *
   * `reason` is free text from an unauthenticated caller, so it is markup-
   * stripped and bounded here rather than being handed to the tracker as an
   * arbitrary `unknown`. It is only ever used for alerting, never for auth.
   */
  loginFailureReport: z.strictObject({
    email: z.preprocess(blankToUndefined, emailField.optional()),
    reason: optionalText({ max: 200, label: 'Reason' }),
  }),

  /**
   * Body of `POST /api/auth/login-success`.
   *
   * Reports a correct password to break the consecutive-failure streak. There is
   * deliberately no way to clear another account's streak: the tracker key is
   * derived from the reported email AND the caller's IP, and this route takes no
   * user id, so a caller can only ever clear their own streak. `email` is
   * optional for the same reason it is on the failure report — a client that
   * knows only its IP still resets the streak it just broke.
   */
  loginSuccessReport: z.strictObject({
    email: z.preprocess(blankToUndefined, emailField.optional()),
  }),

  /**
   * Body of `POST /api/auth/email-verification/attempt` - the pre-flight gate
   * in front of the verification email send.
   *
   * The whole body is the recipient address, and nothing else. There is
   * deliberately no `remaining`, `attempts` or `retryAt` field: the client
   * answers with those, and a strict object means a caller trying to assert one
   * gets a 400 rather than having it silently dropped. `emailField` trims,
   * lower-cases and format-checks, so the identifier key is computed from an
   * already-normalised value and `A@B.com` cannot dodge its own budget with
   * casing.
   */
  emailVerificationAttempt: z.strictObject({
    email: emailField,
  }),

  /**
   * Body of `POST /api/auth/email-verification/outcome` - what actually
   * happened when the client asked Supabase Auth to send.
   *
   * `outcome` is the only signal that matters. `rate_limited` is the one that
   * carries information the client cannot be trusted to report honestly about
   * itself (a hostile client could simply never report it), so it only ever
   * *lengthens* the block: it records that the provider refused and the ledger
   * stores an absolute deadline. Nothing in this route can extend a budget or
   * clear one.
   */
  emailVerificationOutcome: z.strictObject({
    email: emailField,
    outcome: z.enum(['sent', 'rate_limited', 'failed'], {
      message: 'Unknown verification email outcome.',
    }),
  }),

  // -- seeker booking -------------------------------------------------------
  bookingHold: z.strictObject({
    mentorId: uuidField,
    segmentId: uuidField,
    gigId: uuidField,
    startTime: isoDateTimeField,
    endTime: isoDateTimeField,
  }),

  /**
   * Body of `POST /api/seeker/bookings/:id/payment-proof`.
   *
   * The image bytes are NOT in this request. The browser PUTs them to the
   * private bucket through a signed URL and sends only the resulting object key,
   * which is what keeps a request at a few hundred bytes instead of a base64
   * image ~33% larger than the file.
   *
   * There is deliberately no `status` field: a submitted proof always lands in
   * `PENDING_VERIFICATION`, and because the object is strict a client that tried
   * to assert a status would get a 400 rather than silently have the field
   * dropped. There is no `bookingId` either — the booking comes from the path
   * segment, and `storagePath` must sit inside that booking's own folder, which
   * the handler re-checks against the verified caller.
   *
   * `transactionReference` is markup-stripped here and then re-normalised by
   * `normaliseTransactionReference`, which owns the provider-issued character
   * set. Both layers are kept: this one bounds the length before anything is
   * stored, that one owns the exact format.
   */
  paymentProofSubmit: z.strictObject({
    transactionReference: text({ min: 1, max: 64, label: 'Transaction reference' }),
    fileName: z.string().trim().min(1, 'File name is required.').max(255, 'File name is too long.'),
    mimeType: z.enum(PAYMENT_PROOF_MIME_TYPES, {
      message: 'Upload a PNG or JPG screenshot of your payment.',
    }),
    fileSize: z
      .int('File size must be a whole number of bytes.')
      .positive('That file is empty.')
      .max(PAYMENT_PROOF_MAX_BYTES, `Payment screenshots must be ${PAYMENT_PROOF_MAX_LABEL} or smaller.`),
    storagePath: idField,
  }),

  /**
   * Body of `POST /api/seeker/bookings/:id/razorpay/verify`.
   *
   * Exactly the three gateway values the checkout hands back, all required, all
   * bounded. There is deliberately no `amount`, no `currency`, no `bookingId`
   * and no `status`: the amount and currency are read from the STORED payment
   * row and compared against the gateway response, so a body that could state
   * them would be a body that could lie about what was paid. `strictObject` turns
   * such an attempt into a 400 instead of a silently ignored field.
   *
   * The signature is bounded rather than trimmed, because the value is compared
   * byte-for-byte against an HMAC — a leading or trailing space is a real
   * mismatch, not something to be tidied away.
   */
  razorpayVerify: z.strictObject({
    razorpayOrderId: gatewayToken('Order ID'),
    razorpayPaymentId: gatewayToken('Payment ID'),
    razorpaySignature: gatewayToken('Signature'),
  }),

  // -- admin: platform payment configuration ---------------------------------
  /**
   * Body of `PATCH /api/admin/platform-config`.
   *
   * Every field is optional (an admin may change one setting at a time) but at
   * least one must be present: an empty patch is a no-op that should read as a
   * mistake, not as a success.
   *
   * The free-text settings are markup-stripped. `payment_instructions` and
   * `payment_account_name` are rendered back to seekers on the payment page, so
   * storing raw markup there would put a script payload into a page every seeker
   * with an unpaid booking loads. A blank value maps to `null` so an admin can
   * CLEAR a setting — that is a distinct outcome from omitting the field, which
   * leaves the stored value alone.
   *
   * `qrImageStoragePath` is pattern-constrained to the exact key shape this
   * server mints in `POST /api/admin/platform-config/qr-upload-url`. A client
   * cannot point the seeker payment page at an arbitrary object in the bucket.
   */
  platformConfigUpdate: z
    .strictObject({
      upiId: nullableText({ max: 120, label: 'UPI ID' }).optional(),
      accountName: nullableText({ max: 120, label: 'Account name' }).optional(),
      instructions: nullableText({ max: 1000, label: 'Payment instructions', multiline: true }).optional(),
      // Every amount column is an `*_inr` integer, so INR is the only currency
      // the payment architecture supports. Anything else is refused here rather
      // than written and reinterpreted downstream.
      currency: z.enum(['INR'], {
        message: 'Currency is fixed to INR: all amounts are stored in rupees.',
      }).nullable().optional(),
      qrImageStoragePath: z
        .union([
          z
            .string()
            .trim()
            .regex(
              /^platform\/payment-qr-[0-9]{13}-[a-z0-9]{6}\.(png|jpe?g|webp)$/i,
              'Unknown payment QR reference.',
            ),
          z.null(),
        ])
        .optional(),
    })
    .refine(
      (body) =>
        body.upiId !== undefined ||
        body.accountName !== undefined ||
        body.instructions !== undefined ||
        body.currency !== undefined ||
        body.qrImageStoragePath !== undefined,
      { message: 'Change at least one setting.' },
    ),

  /**
   * Body of `POST /api/admin/platform-config/qr-upload-url`.
   *
   * A TYPE AND A SIZE, and nothing else. There is deliberately no `fileName`
   * field: the object key is built from a server timestamp and a server random
   * suffix, and the extension is derived from the validated MIME type. Accepting
   * a client-supplied name would let a file called `payload.exe` be uploaded to
   * the public QR bucket under an `.exe` key.
   */
  platformQrUploadRequest: z.strictObject({
    fileType: z.enum(PAYMENT_QR_MIME_TYPES, {
      message: 'Upload a PNG, JPEG or WebP image.',
    }),
    fileSize: z
      .int('File size must be a whole number of bytes.')
      .positive('That file is empty.')
      .max(PAYMENT_QR_MAX_BYTES, `That image is larger than ${PAYMENT_QR_MAX_LABEL}.`),
  }),

  bookingCancel: z.strictObject({
    reason: optionalText({ max: MAX_REASON_LENGTH, label: 'Reason', multiline: true }),
  }),

  /**
   * Body of `POST /api/seeker/bookings/:id/reschedule`.
   *
   * TIME ONLY. There is no `gigId`, `segmentId` or `mentorId` field, and that
   * omission is the rule: a reschedule may not change who the session is with
   * or what it is for. The server reads all three from the booking row itself,
   * so adding such a field here would be rejected as an unknown key rather than
   * silently ignored.
   */
  bookingReschedule: z.strictObject({
    newStartTime: isoDateTimeField,
    newEndTime: isoDateTimeField,
  }),

  // -- mentor reschedule decision -------------------------------------------
  /**
   * Body of `POST /api/mentor/reschedule-requests/:id/respond`. `reason` is
   * optional but honoured on both outcomes, so a mentor can tell a seeker why a
   * time did not work without the seeker having to ask.
   */
  rescheduleRespond: z.strictObject({
    decision: z.enum(['APPROVED', 'REJECTED'], { message: 'Decision must be APPROVED or REJECTED.' }),
    reason: optionalText({ max: MAX_REASON_LENGTH, label: 'Reason', multiline: true }),
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
      eyebrow: optionalText({ max: 60, label: 'Eyebrow' }),
      heroImageAlt: optionalText({ max: 160, label: 'Hero image alt text' }),
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
    topics: z.array(experienceItemSchema).max(8, 'Use at most 8 topics.').optional(),
    quickHelp: z.array(experienceItemSchema).max(6, 'Use at most 6 quick help items.').optional(),
    journeySteps: z.array(experienceItemSchema).max(6, 'Use at most 6 journey steps.').optional(),
    benefits: z.array(experienceItemSchema).max(6, 'Use at most 6 benefits.').optional(),
    faq: z.array(z.strictObject({
      question: text({ max: 200, label: 'Question' }),
      answer: text({ max: 1000, label: 'Answer', multiline: true }),
      enabled: z.boolean().optional(),
    })).max(8, 'Use at most 8 FAQ items.').optional(),
    guides: z.array(z.strictObject({
      topic: optionalText({ max: 80, label: 'Topic' }),
      title: text({ max: 200, label: 'Title' }),
      description: text({ max: 400, label: 'Description', multiline: true }),
      readingTime: optionalText({ max: 40, label: 'Reading time' }),
      cta: z.strictObject({
        text: text({ max: 60, label: 'CTA text' }),
        url: linkField,
      }).optional(),
    })).max(6, 'Use at most 6 guides.').optional(),
    stories: z.array(z.strictObject({
      quote: text({ max: 600, label: 'Quote', multiline: true }),
      name: text({ min: 1, max: 80, label: 'Name' }),
      context: optionalText({ max: 120, label: 'Context' }),
      avatar: httpUrlField.optional(),
    })).max(6, 'Use at most 6 stories.').optional(),
    // The CTA carries a heading, supporting copy and a button. The legacy
    // `{ text, url }` pair is still accepted so an older admin client keeps
    // working, and `text` is always the BUTTON label — never the heading.
    cta: z.strictObject({
      title: optionalText({ max: 120, label: 'CTA title' }),
      description: optionalText({ max: 300, label: 'CTA description', multiline: true }),
      buttonText: text({ max: 60, label: 'CTA button text' }).optional(),
      buttonUrl: linkField.optional(),
      text: text({ max: 60, label: 'CTA text' }).optional(),
      url: linkField.optional(),
    })
      .refine(
        (c) => Boolean(c.title || c.description || c.buttonText || c.text || c.url || c.buttonUrl),
        { message: 'Add a title, description or button to the CTA.' },
      )
      .optional(),

    /**
     * Per-section on/off. A section that is explicitly disabled is never
     * rendered, so an admin can hide a section without deleting its content.
     * Unknown keys are refused rather than stored, which keeps the payload
     * inside the closed registry the renderer knows.
     */
    sections: sectionToggles.optional(),
  }).optional(),

  segmentAddMentor: z.strictObject({
    mentorId: uuidField,
    isPrimary: z.boolean().optional().default(false),
  }),

  /**
   * Admin topic management.
   *
   * The slug is NEVER accepted from the client: it is derived server-side from
   * the name, so a topic's URL always matches its label and a rename updates
   * the link consistently. `priority` drives the order of the seeker topic bar.
   */
  segmentTopicCreate: z.strictObject({
    name: text({ min: 1, max: 80, label: 'Topic name' }),
    description: optionalText({ max: 200, label: 'Description', multiline: true }),
    isActive: z.boolean().optional(),
  }),

  segmentTopicUpdate: z
    .strictObject({
      name: text({ min: 1, max: 80, label: 'Topic name' }).optional(),
      description: optionalText({ max: 200, label: 'Description', multiline: true }),
      isActive: z.boolean().optional(),
      priority: z.int('Priority must be a whole number.').min(0).max(9999).optional(),
    })
    .refine(hasAtLeastOneField, {
      message: 'No editable fields were provided.',
    }),

  /**
   * Replace the topic set of a gig.
   *
   * The body is the COMPLETE desired selection, not a delta, so a save can
   * never leave a stale link behind. Ownership (topic.segment_id ===
   * gig.segment_id) is verified against the database before anything is
   * written — the UI filter is a convenience, this is the guarantee.
   */
  gigTopicsUpdate: z.strictObject({
    topicIds: z.array(uuidField).max(24, 'A gig can cover at most 24 topics.'),
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

  /**
   * Body of `POST /api/admin/payments/:id/complete-manual-refund`.
   *
   * The shape is the point: an admin records a transfer that has ALREADY
   * happened outside the application, so every field that makes the record
   * believable is required and nothing is defaulted. There is no
   * `paymentStatus`/`refundStatus` field - the transition is decided by the
   * database from the payment's real state, never by the caller.
   *
   * The money and reference rules are re-checked against the stored payment by
   * the `complete_manual_refund` RPC; this layer only bounds the shape.
   */
  manualRefundComplete: z.strictObject({
    refundAmountInr: z
      .number('Enter the refund amount as a number.')
      .finite('Enter the refund amount as a number.')
      .positive('The refund amount must be more than zero.')
      .max(10_000_000, 'Refund amount is unrealistically high.'),
    refundMethod: z.enum(['UPI', 'BANK_TRANSFER'], {
      message: 'Choose either UPI or bank transfer.',
    }),
    refundReference: text({ min: 1, max: 64, label: 'Refund reference' }),
    storagePath: idField,
    fileName: z.string().max(255, 'That filename is too long.'),
    mimeType: z.enum(ALLOWED_REFUND_PROOF_MIME_TYPES, {
      message: 'Upload a PNG, JPG, or WebP image.',
    }),
    fileSize: z
      .int('File size must be a whole number of bytes.')
      .positive('That file is empty.')
      .max(MAX_DOCUMENT_BYTES, `That image is larger than ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB.`),
    adminNote: optionalText({ max: MAX_REASON_LENGTH, label: 'Admin note', multiline: true }),
  }),

  mentorApplicationReject: z.strictObject({
    rejectionReason: text({ min: 1, max: MAX_REASON_LENGTH, label: 'Rejection reason', multiline: true }),
  }),

  /**
   * Body of `PATCH /api/admin/mentor-documents/:id/review`.
   *
   * `status` is the DOCUMENT vocabulary, not the application one: the database
   * check `mentor_verification_documents_status_check` allows only
   * `pending | approved | rejected`, so an admin review may only ever write the
   * two decided values. `pending_review` belongs to `mentor_applications` and
   * is rejected here.
   *
   * `adminNote` is `nullableText(...).optional()` and deliberately NOT
   * `optionalText(...)`. The column is nullable, so "no note" legitimately
   * arrives as an explicit `null` (the admin screen sends `adminNote: null`
   * when the note is empty) as well as as an absent key. `optionalText`
   * accepted only `string | '' | undefined`, so the union failed on `null`
   * and `validateBody` answered 400 with Zod's bare `invalid_union` message —
   * the literal "Invalid input" an admin saw on every plain approval. The
   * bounds (MAX_REASON_LENGTH), the HTML stripping and the strict key set are
   * all unchanged; only `null` joins the accepted values.
   */
  mentorDocumentReview: z.strictObject({
    status: z.enum(['approved', 'rejected'], { message: 'Status must be "approved" or "rejected".' }),
    adminNote: nullableText({ max: MAX_REASON_LENGTH, label: 'Admin note', multiline: true }).optional(),
  }),

  logRetention: z.strictObject({
    retentionDays: z
      .int('Retention must be a whole number of days.')
      .min(1, 'Retention must be at least 1 day.')
      .max(365, 'Retention must be 365 days or fewer.'),
  }),

  // -- coupons ---------------------------------------------------------------
  /**
   * The whole body of `POST /api/seeker/bookings/:id/coupon`.
   *
   * A CODE AND NOTHING ELSE. There is deliberately no `amountInr`,
   * `discountAmountInr`, `originalAmountInr` or `couponId` field, and that
   * omission is the rule: `apply_coupon_to_booking` is the only writer of the
   * pricing snapshot and it reads every number from a locked row. Adding such a
   * field here would be rejected as an unknown key rather than silently
   * ignored.
   */
  couponApply: z.strictObject({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .pipe(
        z
          .string()
          .regex(
            /^[A-Z0-9_]{4,24}$/,
            'Use 4 to 24 letters, numbers or underscores.',
          ),
      ),
  }),

  // -- admin: coupons --------------------------------------------------------
  /** Shared by create and update; only requiredness differs. */
  couponCreate: z.strictObject(couponShape).refine(
    // A coupon targeted at both a segment and a single mentor is refused by the
    // database CHECK, so it is refused here where the admin can be told why
    // rather than getting a constraint violation.
    (coupon) => !(coupon.segmentId && coupon.mentorId),
    {
      message: 'Target a segment or a mentor, not both.',
      path: ['segmentId'],
    },
  ),

  couponUpdate: z
    .strictObject(couponUpdateShape)
    .refine(hasAtLeastOneField, { message: 'No editable fields were provided.' }),

  couponStatus: z.strictObject({
    status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED'], {
      message: 'Status must be ACTIVE, INACTIVE or ARCHIVED.',
    }),
  }),

  // -- support ---------------------------------------------------------------
  /**
   * Body of `POST /api/support/tickets`.
   *
   * `strictObject` is the load-bearing part of this schema. There is
   * deliberately NO `requesterId`, `role`, `priority`, `status`,
   * `assignedAdminId`, `paymentId` or `isInternal` field, and because the object
   * is strict a client that sends one gets a 400 "unrecognized key" instead of
   * having it quietly dropped. Identity, role and the initial NORMAL priority
   * are derived server-side from the verified session.
   *
   * `bookingCode` is a human reference, not a UUID. The server resolves it
   * against `bookings` and refuses a booking that is not the caller's own.
   */
  supportTicketCreate: z.strictObject({
    category: z.enum(
      ['BOOKING', 'PAYMENT', 'SESSION', 'MENTOR', 'ACCOUNT', 'TECHNICAL', 'OTHER'],
      { message: 'Choose a category.' },
    ),
    subject: text({ min: SUPPORT_SUBJECT_MIN, max: SUPPORT_SUBJECT_MAX, label: 'Subject' }),
    message: text({ min: SUPPORT_MESSAGE_MIN, max: SUPPORT_MESSAGE_MAX, label: 'Message', multiline: true }),
    bookingCode: z
      .string()
      .trim()
      .max(40)
      .regex(BOOKING_CODE_PATTERN, 'Use the booking code from your booking, for example BK-1234.')
      .optional()
      .or(z.literal('').transform(() => undefined)),
  }),

  /**
   * Body of `POST /api/support/tickets/:ticketCode/messages`.
   *
   * There is no `isInternal` field. A public reply structurally cannot become
   * an internal note: the RPC that inserts it takes no such parameter, and the
   * separate admin-only RPC is the sole writer of `is_internal = TRUE`.
   */
  supportMessageCreate: z.strictObject({
    message: text({ min: 1, max: SUPPORT_MESSAGE_MAX, label: 'Message', multiline: true }),
  }),

  /** Body of `POST /api/support/tickets/:ticketCode/internal-notes`. Admin only. */
  supportInternalNote: z.strictObject({
    note: text({ min: 1, max: SUPPORT_MESSAGE_MAX, label: 'Note', multiline: true }),
  }),

  /**
   * Body of `POST /api/support/tickets/:ticketCode/resolve`. Admin only.
   *
   * The resolution is mandatory and is stored as a public conversation message,
   * so the user reads the same words the admin wrote.
   */
  supportResolve: z.strictObject({
    resolution: text({
      min: SUPPORT_RESOLUTION_MIN,
      max: SUPPORT_RESOLUTION_MAX,
      label: 'Resolution',
      multiline: true,
    }),
  }),

  /** Body of `POST /api/support/tickets/:ticketCode/reopen`. Requester or admin. */
  supportReopen: z.strictObject({
    reason: text({ min: 1, max: SUPPORT_MESSAGE_MAX, label: 'Reason', multiline: true }),
  }),
/**
   * Body of `GET /api/support/tickets/:ticketCode/attachments/upload-url`.
   *
   * The client describes the file; the server decides where it goes. There is
   * deliberately no `storagePath` here, so a client cannot name its own object
   * key - the signed upload URL is minted for a path the server generated.
   */
  supportAttachmentUploadRequest: z.strictObject({
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.enum(SUPPORT_ATTACHMENT_MIME_TYPES, {
      message: 'Only PNG, JPG, WebP or PDF files can be attached.',
    }),
    fileSize: z
      .int('File size must be a whole number of bytes.')
      .positive('That file is empty.')
      .max(SUPPORT_ATTACHMENT_MAX_BYTES, 'Attachments must be 5 MB or smaller.'),
  }),

  /**
   * Body of `POST /api/support/tickets/:ticketCode/attachments`.
   *
   * The bytes never reach this route. The browser PUTs them to a signed upload
   * URL the server minted for a path IT generated, then posts that path here.
   * `mimeType` is an allow-list rather than a free string, and the same list is
   * the bucket's `allowed_mime_types`, so an executable cannot be uploaded even
   * if this check were bypassed.
   */
  supportAttachmentCreate: z.strictObject({
    storagePath: idField,
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.enum(SUPPORT_ATTACHMENT_MIME_TYPES, {
      message: 'Only PNG, JPG, WebP or PDF files can be attached.',
    }),
    fileSize: z
      .int('File size must be a whole number of bytes.')
      .positive('That file is empty.')
      .max(SUPPORT_ATTACHMENT_MAX_BYTES, 'Attachments must be 5 MB or smaller.'),
  }),

  /**
   * Admin filters for `GET /api/support/tickets?scope=ADMIN`.
   *
   * There is deliberately no `userId` field. A requester's list is scoped to the
   * authenticated caller inside the RPC, so there is no parameter here that
   * could ask for somebody else's tickets.
   */
  supportQueueQuery: z.strictObject({
    scope: z.enum(['USER', 'ADMIN']).optional().default('USER'),
    status: z.enum(SUPPORT_TICKET_STATUSES).optional(),
    priority: z.enum(SUPPORT_TICKET_PRIORITIES).optional(),
    category: z.enum([
      'BOOKING', 'PAYMENT', 'SESSION', 'MENTOR', 'AVAILABILITY', 'PROFILE',
      'ACCOUNT', 'USER', 'SYSTEM', 'TECHNICAL', 'OTHER',
    ]).optional(),
    requesterRole: z.enum(['seeker', 'mentor', 'admin']).optional(),
    search: z.string().trim().max(120).optional(),
  }),

  /**
   * Body of the admin `PATCH /api/support/tickets/:ticketCode`.
   *
   * Three optional admin-only fields, at least one required. `RESOLVED` is
   * refused here on purpose: resolving requires a resolution message and goes
   * through `POST /api/support/tickets/:ticketCode/resolve`, so a status field
   * can never resolve a ticket without telling the user what was decided.
   *
   * There is no `status: 'RESOLVED'` path and no `requesterId`, no
   * `requesterRole`, no `ticketCode` and no `resolution` here: the RPC
   * re-verifies the admin, resolves the ticket by its code, and derives the
   * actor from the caller's verified session.
   */
  supportAdminUpdate: z
    .strictObject({
      status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'CLOSED']).optional(),
      priority: z.enum(SUPPORT_TICKET_PRIORITIES).optional(),
      // `null` unassigns. Only an admin id is accepted, and the RPC checks it.
      assignedAdminId: z.union([uuidField, z.null()]).optional(),
    })
    .refine(
      (body) =>
        body.status !== undefined || body.priority !== undefined || body.assignedAdminId !== undefined,
      { message: 'Change a status, a priority, or an assignee.' },
    ),

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
