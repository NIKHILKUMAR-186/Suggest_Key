import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_CREATABLE_ROLES,
  MAX_EXPERIENCE_YEARS,
  MAX_TAGS,
  MIN_PASSWORD_LENGTH,
  buildCreateUserPayload,
  generateTemporaryPassword,
  isValidEmail,
  isValidPhone,
  isValidTimezone,
  listTimezones,
  normalizeEmail,
  parseAdminCreatableRole,
  parseTagInput,
  parseTagList,
  validateCreateUserForm,
  type CreateUserFormValues,
} from '../src/lib/adminCreateUser';

function baseForm(overrides: Partial<CreateUserFormValues> = {}): CreateUserFormValues {
  return {
    role: 'seeker',
    fullName: 'Priya Sharma',
    email: '  Priya@Example.COM ',
    phone: '',
    timezone: 'Asia/Kolkata',
    bio: '',
    headline: '',
    experienceYears: '',
    languages: '',
    expertise: '',
    segmentIds: [],
    passwordMode: 'invitation',
    password: '',
    confirmPassword: '',
    sendEmail: true,
    ...overrides,
  };
}

const SEGMENT_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const SEGMENT_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

describe('Admin create user — role selection', () => {
  it('offers exactly seeker and mentor', () => {
    assert.deepEqual([...ADMIN_CREATABLE_ROLES], ['seeker', 'mentor']);
  });

  it('rejects any other role, including admin', () => {
    assert.equal(parseAdminCreatableRole('admin'), null);
    assert.equal(parseAdminCreatableRole('ADMIN'), null);
    assert.equal(parseAdminCreatableRole(''), null);
    assert.equal(parseAdminCreatableRole(undefined), null);
    assert.equal(parseAdminCreatableRole(42), null);
  });

  it('accepts the two creatable roles', () => {
    assert.equal(parseAdminCreatableRole('seeker'), 'seeker');
    assert.equal(parseAdminCreatableRole('mentor'), 'mentor');
  });
});

describe('Admin create user — field validators', () => {
  it('normalises email', () => {
    assert.equal(normalizeEmail('  Priya@Example.COM '), 'priya@example.com');
    assert.equal(normalizeEmail(undefined), '');
  });

  it('validates email', () => {
    assert.equal(isValidEmail('a@b.co'), true);
    assert.equal(isValidEmail('a@b'), false);
    assert.equal(isValidEmail('no-at-sign'), false);
    assert.equal(isValidEmail(''), false);
  });

  it('validates timezone against the runtime', () => {
    assert.equal(isValidTimezone('Asia/Kolkata'), true);
    assert.equal(isValidTimezone('UTC'), true);
    assert.equal(isValidTimezone('Mars/Olympus'), false);
    assert.equal(isValidTimezone(''), false);
  });

  it('lists real timezones, never an empty list', () => {
    const zones = listTimezones();
    assert.ok(zones.length > 0);
    assert.ok(zones.includes('Asia/Kolkata'));
  });

  it('treats phone as optional but rejects junk', () => {
    assert.equal(isValidPhone(''), true);
    assert.equal(isValidPhone('   '), true);
    assert.equal(isValidPhone(undefined), true);
    assert.equal(isValidPhone('+91 98765 43210'), true);
    assert.equal(isValidPhone('12345'), false);
    assert.equal(isValidPhone('call me'), false);
  });

  it('parses tag lists and de-duplicates case-insensitively', () => {
    assert.deepEqual(parseTagList(' Hindi , english ,, RUST '), ['Hindi', 'english', 'RUST']);
    assert.deepEqual(parseTagList(['Hindi', 'hindi', 'English']), ['Hindi', 'English']);
    assert.deepEqual(parseTagList(undefined), []);
    assert.equal(parseTagInput('a,b, a'), 'a, b');
  });

  it('caps the number of tags', () => {
    const many = Array.from({ length: 40 }, (_, i) => `tag${i}`).join(',');
    assert.equal(parseTagList(many).length, MAX_TAGS);
  });
});

describe('Admin create user — temporary password', () => {
  it('generates a long password with mixed character classes', () => {
    const password = generateTemporaryPassword();
    assert.ok(password.length >= 12);
    assert.match(password, /[a-z]/);
    assert.match(password, /[A-Z]/);
    assert.match(password, /[0-9]/);
    assert.match(password, /[^A-Za-z0-9]/);
  });

  it('honours an explicit length within bounds', () => {
    assert.equal(generateTemporaryPassword(20).length, 20);
    assert.equal(generateTemporaryPassword(4).length, 12);
  });

  it('excludes ambiguous glyphs', () => {
    for (let i = 0; i < 20; i += 1) {
      assert.doesNotMatch(generateTemporaryPassword(32), /[0O1lI]/);
    }
  });

  it('does not repeat itself', () => {
    const generated = new Set(Array.from({ length: 25 }, () => generateTemporaryPassword()));
    assert.equal(generated.size, 25);
  });
});

describe('Admin create user — form validation', () => {
  it('accepts a minimal seeker form with the invitation flow', () => {
    const result = validateCreateUserForm(baseForm());
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, {});
  });

  it('requires a full name', () => {
    const result = validateCreateUserForm(baseForm({ fullName: '   ' }));
    assert.equal(result.valid, false);
    assert.match(result.errors.fullName!, /required/i);
  });

  it('requires a valid email', () => {
    assert.equal(validateCreateUserForm(baseForm({ email: '' })).errors.email, 'Email address is required.');
    assert.equal(validateCreateUserForm(baseForm({ email: 'nope' })).errors.email, 'Enter a valid email address.');
  });

  it('requires a timezone', () => {
    assert.equal(validateCreateUserForm(baseForm({ timezone: '' })).errors.timezone, 'Timezone is required.');
    assert.equal(validateCreateUserForm(baseForm({ timezone: 'Mars/Olympus' })).errors.timezone, 'Select a valid timezone.');
  });

  it('validates phone only when provided', () => {
    assert.equal(validateCreateUserForm(baseForm({ phone: 'not a phone' })).errors.phone !== undefined, true);
    assert.equal(validateCreateUserForm(baseForm({ phone: '' })).errors.phone, undefined);
  });

  it('does not require a password in invitation mode', () => {
    const result = validateCreateUserForm(baseForm({ passwordMode: 'invitation' }));
    assert.equal(result.valid, true);
  });

  it('requires a password in manual mode', () => {
    const result = validateCreateUserForm(baseForm({ passwordMode: 'manual' }));
    assert.equal(result.valid, false);
    assert.equal(result.errors.password, 'Password is required.');
    assert.equal(result.errors.confirmPassword, 'Confirm the password.');
  });

  it('rejects a short password in manual mode', () => {
    const result = validateCreateUserForm(
      baseForm({ passwordMode: 'manual', password: 'a'.repeat(MIN_PASSWORD_LENGTH - 1), confirmPassword: 'a'.repeat(MIN_PASSWORD_LENGTH - 1) }),
    );
    assert.match(result.errors.password!, new RegExp(`at least ${MIN_PASSWORD_LENGTH}`));
  });

  it('requires matching confirmation', () => {
    const result = validateCreateUserForm(
      baseForm({ passwordMode: 'manual', password: 'Str0ng!Passw0rd', confirmPassword: 'Str0ng!Passw0rD' }),
    );
    assert.equal(result.errors.confirmPassword, 'Passwords do not match.');
  });

  it('accepts a matching manual password', () => {
    const result = validateCreateUserForm(
      baseForm({ passwordMode: 'manual', password: 'Str0ng!Passw0rd', confirmPassword: 'Str0ng!Passw0rd' }),
    );
    assert.equal(result.valid, true);
  });

  it('does not require mentor fields for a seeker', () => {
    const result = validateCreateUserForm(
      baseForm({ role: 'seeker', segmentIds: [], experienceYears: '', headline: '' }),
    );
    assert.equal(result.valid, true);
  });

  it('requires at least one segment for a mentor', () => {
    const result = validateCreateUserForm(baseForm({ role: 'mentor' }));
    assert.equal(result.valid, false);
    assert.equal(result.errors.segmentIds, 'Select at least one mentorship segment.');
  });

  it('accepts a complete mentor form', () => {
    const result = validateCreateUserForm(
      baseForm({
        role: 'mentor',
        segmentIds: [SEGMENT_A, SEGMENT_B],
        headline: 'Relationship advisor',
        experienceYears: '6',
        languages: 'Hindi, English',
        expertise: 'Relationships',
        bio: 'Ten years of practice.',
      }),
    );
    assert.deepEqual(result.errors, {});
  });

  it('validates years of experience only for a mentor and only when filled', () => {
    assert.equal(validateCreateUserForm(baseForm({ role: 'mentor', segmentIds: [SEGMENT_A], experienceYears: '' })).valid, true);
    assert.equal(validateCreateUserForm(baseForm({ role: 'mentor', segmentIds: [SEGMENT_A], experienceYears: '2.5' })).valid, false);
    assert.equal(validateCreateUserForm(baseForm({ role: 'mentor', segmentIds: [SEGMENT_A], experienceYears: '-1' })).valid, false);
    assert.equal(
      validateCreateUserForm(baseForm({ role: 'mentor', segmentIds: [SEGMENT_A], experienceYears: String(MAX_EXPERIENCE_YEARS + 1) })).valid,
      false,
    );
  });

  it('reports every broken field at once', () => {
    const result = validateCreateUserForm(
      baseForm({ fullName: '', email: 'x', timezone: '', phone: 'nope', role: 'mentor' }),
    );
    assert.equal(result.valid, false);
    assert.ok(result.errors.fullName);
    assert.ok(result.errors.email);
    assert.ok(result.errors.timezone);
    assert.ok(result.errors.phone);
    assert.ok(result.errors.segmentIds);
  });
});

describe('Admin create user — request payload', () => {
  it('normalises the seeker payload and omits mentor-only keys', () => {
    const payload = buildCreateUserPayload(baseForm({ phone: '  ' }));
    assert.deepEqual(payload, {
      role: 'seeker',
      email: 'priya@example.com',
      fullName: 'Priya Sharma',
      phone: null,
      timezone: 'Asia/Kolkata',
      bio: null,
      sendEmail: true,
    });
    assert.equal('segmentIds' in payload, false);
    assert.equal('headline' in payload, false);
  });

  it('sends the phone number when provided', () => {
    const payload = buildCreateUserPayload(baseForm({ phone: ' +91 98765 43210 ' }));
    assert.equal(payload.phone, '+91 98765 43210');
  });

  it('includes the password only in manual mode', () => {
    assert.equal('password' in buildCreateUserPayload(baseForm()), false);
    const manual = buildCreateUserPayload(
      baseForm({ passwordMode: 'manual', password: 'Str0ng!Passw0rd', confirmPassword: 'Str0ng!Passw0rd' }),
    );
    assert.equal(manual.password, 'Str0ng!Passw0rd');
  });

  it('builds the mentor payload with normalised tags and segments', () => {
    const payload = buildCreateUserPayload(
      baseForm({
        role: 'mentor',
        segmentIds: [SEGMENT_A, SEGMENT_B],
        headline: '  Relationship advisor  ',
        experienceYears: '6',
        languages: ' Hindi, english , Hindi ',
        expertise: 'Relationships, communication',
        bio: '  Ten years of practice.  ',
      }),
    );
    assert.equal(payload.headline, 'Relationship advisor');
    assert.equal(payload.experienceYears, 6);
    assert.deepEqual(payload.languages, ['Hindi', 'english']);
    assert.deepEqual(payload.expertise, ['Relationships', 'communication']);
    assert.deepEqual(payload.segmentIds, [SEGMENT_A, SEGMENT_B]);
    assert.equal(payload.bio, 'Ten years of practice.');
  });

  it('sends null experience when the field is blank', () => {
    const payload = buildCreateUserPayload(baseForm({ role: 'mentor', segmentIds: [SEGMENT_A] }));
    assert.equal(payload.experienceYears, null);
  });
});
