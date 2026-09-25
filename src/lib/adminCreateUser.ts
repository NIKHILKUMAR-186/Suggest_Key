/**
 * ADMIN CREATE USER — form domain rules
 * ======================================
 * Pure validation, normalisation and password generation for the Admin
 * "Create New User" page.
 *
 * The SAME functions run in the browser (inline field errors) and on the server
 * (authoritative rejection of a bad request), so the client can never be the
 * only place a rule is enforced.
 *
 * Everything here is deliberately dependency-free: no React, no Supabase.
 *
 * Schema reality (public.profiles / public.mentor_profiles):
 *   profiles         full_name, email, phone, avatar_url, timezone
 *   mentor_profiles  headline, about, experience_years, languages, expertise
 *
 * There is no `admin` option in this form: Admin accounts are provisioned
 * out of band, never through this page.
 */

export const ADMIN_CREATABLE_ROLES = ['seeker', 'mentor'] as const;
export type AdminCreatableRole = (typeof ADMIN_CREATABLE_ROLES)[number];

export function isAdminCreatableRole(value: unknown): value is AdminCreatableRole {
  return typeof value === 'string' && (ADMIN_CREATABLE_ROLES as readonly string[]).includes(value);
}

export function parseAdminCreatableRole(value: unknown): AdminCreatableRole | null {
  return isAdminCreatableRole(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: unknown): boolean {
  return typeof value === 'string' && EMAIL_PATTERN.test(value.trim());
}

export function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

// ---------------------------------------------------------------------------
// Timezone
// ---------------------------------------------------------------------------

/**
 * The real list of IANA zones, straight from the platform. Falls back to a short
 * curated set only on runtimes without `Intl.supportedValuesOf`.
 */
const FALLBACK_TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'UTC',
];

/**
 * Every IANA zone the platform knows about, plus the aliases the product relies
 * on (notably `Asia/Kolkata`, which is the database default timezone and is not
 * always present in the runtime's canonical list).
 */
export function listTimezones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  const zones = new Set<string>(FALLBACK_TIMEZONES);
  if (typeof intl.supportedValuesOf === 'function') {
    try {
      for (const zone of intl.supportedValuesOf('timeZone')) zones.add(zone);
    } catch {
      // keep the curated list only
    }
  }
  return [...zones].sort((a, b) => a.localeCompare(b));
}

/** A timezone is only accepted if the runtime can actually resolve it. */
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

// ---------------------------------------------------------------------------
// Phone
// ---------------------------------------------------------------------------

/**
 * Permissive by design: digits, spaces, brackets, dashes, an optional leading
 * `+`. We only reject characters that cannot appear in a phone number, so
 * international formats are not broken by an over-strict rule.
 */
const PHONE_ALLOWED = /^\+?[\d\s().-]{6,25}$/;

export function isValidPhone(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true; // optional
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return true;
  return PHONE_ALLOWED.test(trimmed) && (trimmed.match(/\d/g) || []).length >= 6;
}

export function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

// ---------------------------------------------------------------------------
// Tag lists (languages, areas of expertise)
// ---------------------------------------------------------------------------

export const MAX_TAG_LENGTH = 40;
export const MAX_TAGS = 12;

/** "Hindi, English , , rust " -> ["Hindi", "English", "rust"] */
export function parseTagList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return dedupeTags(value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()));
  }
  if (typeof value !== 'string') return [];
  return dedupeTags(value.split(',').map((tag) => tag.trim()));
}

export function parseTagInput(value: unknown): string {
  return parseTagList(value).join(', ');
}

function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    if (!tag) continue;
    if (tag.length > MAX_TAG_LENGTH) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out.slice(0, MAX_TAGS);
}

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

export const MIN_PASSWORD_LENGTH = 8;

/**
 * Ambiguous glyphs (0/O, 1/l/I) are excluded so a temporary password can be
 * dictated or copied from a screen without mistakes.
 */
const PASSWORD_LOWER = 'abcdefghjkmnpqrstuvwxyz';
const PASSWORD_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const PASSWORD_DIGITS = '23456789';
const PASSWORD_SYMBOLS = '!@#$%^&*-_=+';

export interface GeneratedPassword {
  password: string;
  /** True when the value came from a CSPRNG rather than user input. */
  generated: boolean;
}

/**
 * Generate a strong temporary password using the platform CSPRNG. There is no
 * `Math.random` fallback: a weak "temporary" password is worse than none, and
 * the caller can always set one manually.
 */
export function generateTemporaryPassword(length = 16): string {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj || typeof cryptoObj.getRandomValues !== 'function') {
    throw new Error('Secure random generation is not available in this environment.');
  }
  const size = Math.max(12, Math.min(64, Math.floor(length)));
  const all = PASSWORD_LOWER + PASSWORD_UPPER + PASSWORD_DIGITS + PASSWORD_SYMBOLS;
  const out: string[] = [];

  // Guarantee at least one character from every class.
  for (const pool of [PASSWORD_LOWER, PASSWORD_UPPER, PASSWORD_DIGITS, PASSWORD_SYMBOLS]) {
    out.push(pick(pool));
  }
  while (out.length < size) {
    out.push(pick(all));
  }

  // Fisher-Yates with a CSPRNG so the guaranteed characters are not positionally
  // predictable.
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}

function randomInt(bound: number): number {
  const cryptoObj = globalThis.crypto!;
  const limit = Math.floor(0xffffffff / bound) * bound;
  const buffer = new Uint32Array(1);
  let value = limit;
  while (value >= limit) {
    cryptoObj.getRandomValues(buffer);
    value = buffer[0];
  }
  return value % bound;
}

function pick(pool: string): string {
  return pool[randomInt(pool.length)];
}

/**
 * The product ships a secure invitation flow (Supabase invites the user and the
 * account is set up from the emailed link), so a password is only REQUIRED when
 * the Admin explicitly chooses to set one.
 */
export function isValidPassword(value: unknown): boolean {
  return typeof value === 'string' && value.length >= MIN_PASSWORD_LENGTH;
}

// ---------------------------------------------------------------------------
// Form validation
// ---------------------------------------------------------------------------

export type CreateUserFieldErrorKey =
  | 'fullName'
  | 'email'
  | 'phone'
  | 'timezone'
  | 'password'
  | 'confirmPassword'
  | 'experienceYears'
  | 'segmentIds';

export type CreateUserFieldErrors = Partial<Record<CreateUserFieldErrorKey, string>>;

export interface CreateUserFormValues {
  role: AdminCreatableRole;
  fullName: string;
  email: string;
  phone: string;
  timezone: string;
  bio: string;
  headline: string;
  experienceYears: string;
  languages: string;
  expertise: string;
  segmentIds: string[];
  passwordMode: 'invitation' | 'manual';
  password: string;
  confirmPassword: string;
  sendEmail: boolean;
}

export const MAX_BIO_LENGTH = 2000;
export const MAX_HEADLINE_LENGTH = 140;
export const MAX_EXPERIENCE_YEARS = 80;

export interface CreateUserValidation {
  valid: boolean;
  errors: CreateUserFieldErrors;
}

/**
 * Field-level validation shared by the browser and the API. Returns the first
 * error per field so the UI can render them inline.
 */
export function validateCreateUserForm(values: CreateUserFormValues): CreateUserValidation {
  const errors: CreateUserFieldErrors = {};

  if (!values.fullName.trim()) errors.fullName = 'Full name is required.';

  if (!values.email.trim()) {
    errors.email = 'Email address is required.';
  } else if (!isValidEmail(values.email)) {
    errors.email = 'Enter a valid email address.';
  }

  if (!values.timezone.trim()) {
    errors.timezone = 'Timezone is required.';
  } else if (!isValidTimezone(values.timezone)) {
    errors.timezone = 'Select a valid timezone.';
  }

  if (!isValidPhone(values.phone)) {
    errors.phone = 'Enter a valid phone number or leave it blank.';
  }

  // The password is only mandatory in manual mode; the invitation flow sets the
  // password itself from the emailed link.
  if (values.passwordMode === 'manual') {
    if (!values.password) {
      errors.password = 'Password is required.';
    } else if (!isValidPassword(values.password)) {
      errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (!values.confirmPassword) {
      errors.confirmPassword = 'Confirm the password.';
    } else if (values.confirmPassword !== values.password) {
      errors.confirmPassword = 'Passwords do not match.';
    }
  }

  if (values.role === 'mentor') {
    const years = values.experienceYears.trim();
    if (years) {
      const parsed = Number(years);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_EXPERIENCE_YEARS) {
        errors.experienceYears = `Years of experience must be a whole number between 0 and ${MAX_EXPERIENCE_YEARS}.`;
      }
    }
    if (values.segmentIds.length === 0) {
      errors.segmentIds = 'Select at least one mentorship segment.';
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

export interface CreateUserPayload {
  role: AdminCreatableRole;
  email: string;
  fullName: string;
  phone: string | null;
  timezone: string;
  bio: string | null;
  sendEmail: boolean;
  password?: string;
  headline?: string | null;
  experienceYears?: number | null;
  languages?: string[];
  expertise?: string[];
  segmentIds?: string[];
}

/**
 * Turn validated form state into the exact request body the API expects. Email
 * and phone are normalised here so the client and the server agree.
 */
export function buildCreateUserPayload(values: CreateUserFormValues): CreateUserPayload {
  const payload: CreateUserPayload = {
    role: values.role,
    email: normalizeEmail(values.email),
    fullName: values.fullName.trim(),
    phone: normalizePhone(values.phone),
    timezone: values.timezone.trim(),
    bio: values.bio.trim() ? values.bio.trim().slice(0, MAX_BIO_LENGTH) : null,
    sendEmail: values.sendEmail,
  };

  if (values.passwordMode === 'manual' && values.password) {
    payload.password = values.password;
  }

  if (values.role === 'mentor') {
    payload.headline = values.headline.trim() ? values.headline.trim().slice(0, MAX_HEADLINE_LENGTH) : null;
    const years = values.experienceYears.trim();
    payload.experienceYears = years ? Number(years) : null;
    payload.languages = parseTagList(values.languages);
    payload.expertise = parseTagList(values.expertise);
    payload.segmentIds = [...values.segmentIds];
  }

  return payload;
}
