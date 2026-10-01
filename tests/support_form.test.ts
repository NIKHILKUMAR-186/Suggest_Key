/**
 * SUPPORT / HELP & SUPPORT (Formspree).
 *
 * The support form is one shared component, so the properties worth pinning are
 * the ones that would silently break that sharing or leak something:
 *
 *   1. Role -> categories is a pure function of the authenticated role, so a
 *      seeker can never be offered admin categories and the role cannot be
 *      smuggled in through the form body.
 *   2. The payload is built from an allow-list and carries nothing else, so a
 *      token, a Razorpay secret or an internal UUID has no path to Formspree.
 *   3. Seeker and mentor keep their existing navigation; only the admin sidebar
 *      gains Support, because admin is the one role with a sidebar.
 *   4. The endpoint lives in exactly one config file, and no secret is readable
 *      from any module the browser actually bundles.
 *
 * Source-level assertions on purpose, matching the other frontend invariants in
 * this repo: these are structural claims about what may be sent, not UI pixels.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  HONEYPOT_FIELD,
  SUPPORT_CATEGORIES,
  SUPPORT_PAYLOAD_FIELDS,
  buildSupportPayload,
  isBookingRelatedCategory,
  isValidBookingReference,
  validateSupportForm,
} from '../src/config/support';

const ROOT = process.cwd();
const code = (file: string): string => readFileSync(resolve(ROOT, file), 'utf8');

const CONFIG = 'src/config/support.ts';
const FORM = 'src/components/support/SupportForm.tsx';
const PAGE = 'src/components/support/SupportPage.tsx';
const NAV = 'src/config/navigation.ts';
const ROUTER = 'src/routes/Router.tsx';

const baseInput = {
  name: 'Asha Rao',
  email: 'asha@example.com',
  role: 'seeker' as const,
  category: 'Booking',
  subject: 'Session did not start',
  message: 'My session room never opened and the mentor never joined the call.',
  bookingCode: '',
  currentPage: '/seeker/booking-detail',
};

// ---------------------------------------------------------------------------
// Role -> categories
// ---------------------------------------------------------------------------

describe('support categories come from the role, never from the form', () => {
  it('offers each role exactly its own list', () => {
    assert.deepEqual(SUPPORT_CATEGORIES.seeker, [
      'Booking', 'Payment', 'Session', 'Mentor', 'Account', 'Technical Issue', 'Other',
    ]);
    assert.deepEqual(SUPPORT_CATEGORIES.mentor, [
      'Booking', 'Availability', 'Payment', 'Session', 'Profile', 'Technical Issue', 'Other',
    ]);
    assert.deepEqual(SUPPORT_CATEGORIES.admin, [
      'User Issue', 'Mentor Issue', 'Booking Issue', 'Payment Issue',
      'System Issue', 'Technical Issue', 'Other',
    ]);
  });

  it('keeps the admin categories out of the customer lists', () => {
    for (const adminOnly of ['User Issue', 'Mentor Issue', 'Booking Issue', 'System Issue']) {
      assert.equal(SUPPORT_CATEGORIES.seeker.includes(adminOnly), false);
      assert.equal(SUPPORT_CATEGORIES.mentor.includes(adminOnly), false);
    }
    // A seeker has no Availability category; a mentor has no Account one.
    assert.equal(SUPPORT_CATEGORIES.seeker.includes('Availability'), false);
    assert.equal(SUPPORT_CATEGORIES.mentor.includes('Account'), false);
  });

  it('never leaves a role without an Other escape hatch', () => {
    for (const categories of Object.values(SUPPORT_CATEGORIES)) {
      assert.ok(categories.includes('Other'), 'a user must always be able to write freely');
    }
  });

  it('builds the category options from the authenticated role, not from a prop', () => {
    const source = code(FORM);
    assert.ok(
      /const role = activeRole \?\? 'seeker'/.test(source),
      'the role must come from the auth context',
    );
    assert.ok(source.includes('SUPPORT_CATEGORIES[role]'), 'the list must follow that role');
    // A submitted role cannot widen the options: the select only renders the
    // categories the role owns, whatever the request body claimed.
    assert.ok(
      /categories\.map\(\(option\) =>/.test(source),
      'the select must render exactly the role list',
    );
  });
});

// ---------------------------------------------------------------------------
// The payload is an allow-list
// ---------------------------------------------------------------------------

describe('a support submission carries only support-safe fields', () => {
  it('sends exactly the allow-listed keys', () => {
    const payload = buildSupportPayload({ ...baseInput, bookingCode: 'BK-9021' });
    assert.deepEqual(Object.keys(payload).sort(), [...SUPPORT_PAYLOAD_FIELDS].sort());
  });

  it('omits the booking reference entirely when there is none', () => {
    // An empty string would look like a booking with a blank code.
    const payload = buildSupportPayload(baseInput);
    assert.equal('booking_code' in payload, false);
  });

  it('never carries an authentication object, a token or a payment secret', () => {
    const payload = buildSupportPayload({ ...baseInput, bookingCode: 'BK-9021' });
    const serialised = JSON.stringify(payload);

    for (const forbidden of [
      'access_token',
      'refresh_token',
      'SUPABASE_SERVICE_ROLE_KEY',
      'RAZORPAY_KEY_SECRET',
      'RAZORPAY_WEBHOOK_SECRET',
      'password',
      'authorization',
      'booking_id',
      'storage_path',
      'razorpay_payment_id',
    ]) {
      assert.equal(serialised.includes(forbidden), false, `${forbidden} must never be submitted`);
    }
  });

  it('reports the role as context only, as one of the three known roles', () => {
    const payload = buildSupportPayload({ ...baseInput, role: 'admin' });
    assert.equal(payload.role, 'admin');
    // There is no authorization decision anywhere downstream of this string:
    // access is decided by the route guard and by the server, never by a field.
    assert.deepEqual(Object.keys(SUPPORT_CATEGORIES).sort(), ['admin', 'mentor', 'seeker']);
  });

  it('drops the query string, so an internal booking UUID is never forwarded', () => {
    const payload = buildSupportPayload({
      ...baseInput,
      currentPage: '/seeker/booking-detail?bookingId=44444444-4444-4444-8444-444444444444',
    });
    assert.equal(payload.current_page, '/seeker/booking-detail');
    assert.equal(
      JSON.stringify(payload).includes('44444444-4444-4444-8444-444444444444'),
      false,
      'an internal id must not reach the support inbox',
    );
  });

  it('sends the Formspree honeypot as an empty string for a human', () => {
    assert.equal(buildSupportPayload(baseInput)._gotcha, '');
  });

  it('trims the user-facing values', () => {
    const payload = buildSupportPayload({
      ...baseInput,
      name: '  Asha Rao  ',
      subject: '  Session did not start  ',
      bookingCode: '  BK-9021  ',
    });
    assert.equal(payload.name, 'Asha Rao');
    assert.equal(payload.subject, 'Session did not start');
    assert.equal(payload.booking_code, 'BK-9021');
  });

  it('normalises a typed booking reference to the platform’s format', () => {
    const payload = buildSupportPayload({ ...baseInput, bookingCode: ' bk-9021 ' });
    assert.equal(payload.booking_code, 'BK-9021');
  });
});

// ---------------------------------------------------------------------------
// Booking reference
// ---------------------------------------------------------------------------

describe('a booking reference is a human code, never an internal id', () => {
  it('accepts the codes the platform generates', () => {
    for (const code of ['BK-9021', 'BK-ABCD1234', 'bk-9021', 'BK-SOON-01']) {
      assert.equal(isValidBookingReference(code), true, `${code} should be accepted`);
    }
  });

  it('refuses an internal UUID, an empty value and anything over-long', () => {
    for (const value of [
      '',
      '   ',
      'BK-',
      '9021',
      '44444444-4444-4444-8444-444444444444',
      `BK-${'A'.repeat(33)}`,
      'BK-9021 <script>',
    ]) {
      assert.equal(isValidBookingReference(value), false, `${value} must be refused`);
    }
  });

  it('shows the booking field only for booking-shaped categories, and never requires it', () => {
    for (const related of ['Booking', 'Payment Issue', 'Session', 'Availability']) {
      assert.equal(isBookingRelatedCategory(related), true, `${related} should offer the field`);
    }
    for (const general of ['Other', 'Mentor', 'Account', 'Technical Issue', 'Profile']) {
      assert.equal(isBookingRelatedCategory(general), false, `${general} should not offer the field`);
    }

    // Optional everywhere: an empty reference is not an error.
    assert.deepEqual(
      validateSupportForm({
        subject: 'Session did not start',
        message: 'My session room never opened and the mentor never joined the call.',
        bookingCode: '',
      }),
      {},
    );
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('the form refuses an unusable message before it is sent', () => {
  it('requires a subject and a message with real content', () => {
    assert.ok(validateSupportForm({ subject: '', message: '', bookingCode: '' }).subject);
    assert.ok(validateSupportForm({ subject: 'ok', message: 'short', bookingCode: '' }).message);
    assert.deepEqual(
      validateSupportForm({ subject: 'Room did not open', message: 'a'.repeat(30), bookingCode: '' }),
      {},
      'a real subject and message pass',
    );
  });

  it('does not count padding as content', () => {
    const errors = validateSupportForm({ subject: '      ', message: '            '.repeat(3), bookingCode: '' });
    assert.ok(errors.subject, 'whitespace is not a subject');
    assert.ok(errors.message, 'whitespace is not a message');
  });

  it('bounds both fields at the documented limits', () => {
    const long = validateSupportForm({ subject: 'a'.repeat(121), message: 'a'.repeat(30), bookingCode: '' });
    assert.ok(long.subject);
    const huge = validateSupportForm({ subject: 'a'.repeat(30), message: 'a'.repeat(4001), bookingCode: '' });
    assert.ok(huge.message);
  });

  it('rejects a malformed booking reference but accepts a blank one', () => {
    assert.ok(
      validateSupportForm({
        subject: 'Session did not start',
        message: 'My session room never opened and the mentor never joined the call.',
        bookingCode: 'nope',
      }).bookingCode,
    );
  });
});

// ---------------------------------------------------------------------------
// Navigation placement
// ---------------------------------------------------------------------------

describe('Support is placed where each role expects it', () => {
  it('leaves the seeker top navigation exactly as it was', () => {
    const nav = code(NAV);
    const seeker = nav.slice(nav.indexOf("seeker: {"), nav.indexOf('mentor: {'));
    assert.equal(/support/i.test(seeker), false, 'Support must not become a seeker nav item');
    for (const label of ["label: 'Home'", "label: 'My Bookings'", "label: 'Notifications'", "label: 'Settings'"]) {
      assert.ok(seeker.includes(label), `${label} must remain a seeker nav item`);
    }
  });

  it('leaves the mentor top navigation exactly as it was', () => {
    const nav = code(NAV);
    const mentor = nav.slice(nav.indexOf('mentor: {'), nav.indexOf('admin: {'));
    assert.equal(/support/i.test(mentor), false, 'Support must not become a mentor nav item');
    assert.ok(mentor.includes("label: 'Availability'"), 'Availability must remain a mentor nav item');
  });

  it('gives the admin sidebar a dedicated Support entry', () => {
    const nav = code(NAV);
    const admin = nav.slice(nav.indexOf('admin: {'));
    assert.ok(admin.includes("id: 'admin-support'"), 'the sidebar needs a Support item');
    assert.ok(admin.includes("href: '/admin/support'"), 'it must point at the admin support route');
    // Existing order is untouched: Support is inserted, nothing is reordered.
    assert.ok(
      admin.indexOf("id: 'admin-system-health'") < admin.indexOf("id: 'admin-support'"),
      'Support sits after System Health',
    );
    assert.ok(
      admin.indexOf("id: 'admin-support'") < admin.indexOf("id: 'admin-settings'"),
      'and before Settings',
    );
  });

  it('serves one shared Support page from all three role guards', () => {
    const router = code(ROUTER);
    for (const path of ['/seeker/support', '/mentor/support', '/admin/support']) {
      assert.ok(
        new RegExp(`pathname === '${path}'\\) return <SupportPage />`).test(router),
        `${path} must render the shared SupportPage`,
      );
    }
    // One import, three routes: not three forked pages.
    assert.equal(
      [...router.matchAll(/import \{ SupportPage \}/g)].length,
      1,
      'SupportPage must be defined once and reused',
    );
    assert.equal(/SupportPage >/.test(router), false, 'the page must not be given per-role props');
  });
});

// ---------------------------------------------------------------------------
// Submission contract
// ---------------------------------------------------------------------------

describe('the submission itself', () => {
  it('POSTs to the configured endpoint, never to a hard-coded URL', () => {
    assert.equal(
      /formspree\.io/.test(code(FORM)) || /formspree\.io/.test(code(PAGE)),
      false,
      'no component may hard-code the Formspree URL',
    );
    assert.ok(
      /fetch\(endpoint/.test(code(FORM)),
      'the form must submit to the single configured endpoint',
    );
    assert.equal(
      (code(CONFIG).match(/VITE_FORMSPREE_SUPPORT_ENDPOINT/g) ?? []).length,
      1,
      'the endpoint is read once, in the one config file',
    );
  });

  it('reads only the support-safe identity, from the auth context', () => {
    const source = code(FORM);
    assert.ok(source.includes('profile?.full_name'), 'the name comes from the profile');
    assert.ok(source.includes("profile?.email || user?.email || ''"), 'the email comes from the account');
    // The read-only identity fields are never edited, so the submitted values are
    // always the account's own.
    assert.ok(/id="support-email"[\s\S]{0,200}readOnly/.test(source));
    assert.ok(/id="support-role"[\s\S]{0,200}readOnly/.test(source));
  });

  it('blocks a duplicate submission and labels the in-flight button', () => {
    const source = code(FORM);
    assert.ok(source.includes('if (inFlight.current) return'), 'a second tap must not send twice');
    assert.ok(/disabled=\{isSending\}/.test(source), 'the button is disabled while sending');
    assert.ok(source.includes('loadingText="Sending..."'), 'the in-flight label is "Sending..."');
    assert.ok(source.includes('<span>Send Message</span>'), 'the idle label is "Send Message"');
  });

  it('confirms only after a 2xx, and never leaks the provider error', () => {
    const source = code(FORM);
    assert.ok(/if \(!response\.ok\) throw/.test(source), 'a rejected send is a failure');
    // The success copy and the failure copy are fixed strings, so a Formspree or
    // network reason can never be rendered to the user.
    assert.ok(source.includes('Thanks for contacting Suggest Key. Our support team will review your message and get back to you.'));
    assert.ok(source.includes('Unable to send your message right now. Please try again.'));
    assert.equal(
      /response\.(json|text)\(\)/.test(source),
      false,
      'the provider response body must never be read into the UI',
    );
  });

  it('clears the draft only once the send is confirmed', () => {
    const source = code(FORM);
    const handler = source.slice(source.indexOf('if (!response.ok) throw'));
    assert.ok(
      /setSubject\(''\)/.test(handler),
      'the reset must come after the response is accepted, not before the request',
    );
    assert.ok(
      handler.indexOf("setState('sent')") < handler.indexOf('} catch'),
      'the success state is set on the confirmed path only',
    );
  });

  it('uses Formspree’s real honeypot rather than a pretend one', () => {
    const source = code(FORM);
    assert.ok(source.includes('HONEYPOT_FIELD'), 'the field name comes from the config');
    assert.equal(HONEYPOT_FIELD, '_gotcha', 'Formspree discards submissions that fill _gotcha');
    assert.ok(/tabIndex=\{-1\}/.test(source), 'the trap is out of the tab order');
    assert.ok(/aria-hidden="true"/.test(source), 'and hidden from assistive technology');
  });
});

// ---------------------------------------------------------------------------
// Security: nothing secret is browser-readable because of this feature
// ---------------------------------------------------------------------------

describe('support adds no way into the client bundle', () => {
  const SUPPORT_FILES = [CONFIG, FORM, PAGE, ROUTER, 'src/config/navigation.ts'];

  it('reads no server-side credential from any support module', () => {
    for (const file of SUPPORT_FILES) {
      const source = code(file);
      for (const secret of [
        'SUPABASE_SERVICE_ROLE_KEY',
        'RAZORPAY_KEY_SECRET',
        'RAZORPAY_WEBHOOK_SECRET',
        'DEMO_TOKEN_SECRET',
        'ADMIN_PASSWORD',
      ]) {
        assert.equal(source.includes(secret), false, `${file} must not mention ${secret}`);
      }
    }
  });

  it('keeps the Formspree endpoint out of the server-only secret space', () => {
    // The endpoint is client-visible by design, so it must be VITE_ prefixed and
    // must never be paired with anything secret behind the same name.
    assert.ok(code(CONFIG).includes('VITE_FORMSPREE_SUPPORT_ENDPOINT'));
    assert.equal(
      /VITE_FORMSPREE_SUPPORT_ENDPOINT/.test(code('.env.example')),
      true,
      '.env.example must document the variable',
    );
  });

  it('does not add a support API route, table or bucket', () => {
    // The whole architecture is user -> form -> Formspree -> email. A support
    // endpoint or migration would mean the feature quietly grew a backend.
    for (const file of SUPPORT_FILES) {
      assert.equal(/from\('support_tickets'\)|support_messages/.test(code(file)), false, file);
    }
  });

  it('keeps the role guards untouched: Support sits inside the existing ones', () => {
    const router = code(ROUTER);
    const admin = router.slice(router.indexOf("pathname.startsWith('/admin')"), router.indexOf('Mentor Directory'));
    assert.ok(admin.includes("<ProtectedRoute allowedRoles={['admin']}>"), '/admin/support stays admin-only');
    const mentor = router.slice(router.indexOf("pathname.startsWith('/mentor')"), router.indexOf("// 5. Seeker Routes"));
    assert.ok(
      mentor.includes("<ProtectedRoute allowedRoles={['mentor', 'admin']}>"),
      '/mentor/support keeps the existing mentor guard',
    );
    assert.ok(
      /pathname === '\/mentor\/support'\) return <SupportPage \/>;/.test(mentor),
      'the mentor support route must be inside that guard, before its 404',
    );
  });
});
