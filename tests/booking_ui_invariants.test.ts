import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Design-system and correctness invariants for the seeker booking, payment and
 * account surfaces.
 *
 * These are properties of the *source*, not of behaviour, because each one
 * describes a class of defect that typechecking cannot catch and that a
 * component test would only catch if it happened to render the exact case.
 * Every check here corresponds to a real defect that was present in these files:
 *
 *   - Raw Tailwind palette utilities (`bg-emerald-600`, `text-amber-900`) were
 *     used for status colours. Those resolve to fixed hex values, so they ignore
 *     the dark-mode tokens and the active segment theme entirely, which is why
 *     these screens were the least polished part of the product in dark mode.
 *   - `BookingSummary` passed a full ISO timestamp to `formatLocalTimeLabel`,
 *     which splits on ':' and expects a bare "HH:MM". `Number("2026-09-28T14")`
 *     is NaN, so the summary rendered a literal "NaN:30 AM" for every booking.
 *   - The hold countdown fell back to a hardcoded 900 seconds on a hold that is
 *     five minutes long, resurrecting an already-expired hold as "15:00".
 *   - The notifications page caught a failed load with `console.error` and then
 *     rendered "No Notifications", telling a seeker they had nothing when the
 *     truth was that the list could not be fetched.
 *   - Four files each defined their own status-to-colour switch, so the same
 *     status read differently on different screens.
 *
 * The file-scanning style follows `razorpay_frontend_review.test.ts`, which does
 * the same thing for the payment integration's source-level invariants.
 */

const REPO_ROOT = join(import.meta.dirname, '..');

/** Everything this phase owns, as repo-relative paths. */
const OWNED_FILES = [
  'src/components/booking/PageHeading.tsx',
  'src/components/booking/SegmentScope.tsx',
  'src/components/booking/StatePanel.tsx',
  'src/components/booking/StatusPill.tsx',
  'src/components/booking/BookingSummary.tsx',
  'src/components/booking/HoldCountdown.tsx',
  'src/components/booking/statusTone.ts',
  'src/components/booking/tokens.tsx',
  'src/components/notifications/NotificationCard.tsx',
  'src/components/seeker/RazorpayCheckoutCard.tsx',
  'src/pages/seeker/SeekerMentorDetailPage.tsx',
  'src/pages/seeker/SeekerPaymentPage.tsx',
  'src/pages/seeker/SeekerBookingDetailPage.tsx',
  'src/pages/seeker/SeekerBookingsPage.tsx',
  'src/pages/seeker/SeekerSessionPage.tsx',
  'src/pages/seeker/SeekerNotificationsPage.tsx',
  'src/pages/seeker/SeekerSettingsPage.tsx',
];

const read = (relativePath: string): string =>
  readFileSync(join(REPO_ROOT, relativePath), 'utf8');

/** Strips comments and template/string bodies so prose cannot fail a check. */
function code(relativePath: string): string {
  return read(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

// ---------------------------------------------------------------------------
// 1. Status colour comes from the design tokens, not a literal palette
// ---------------------------------------------------------------------------

describe('the seeker booking and account surfaces use themed status colour', () => {
  it('uses no raw Tailwind palette utility in any owned file', () => {
    // A palette utility is a fixed hex value. It cannot respond to the theme
    // switch or the active segment, so any use of one is a dark-mode or
    // per-segment contrast bug that no type or unit test would reveal.
    const PALETTE =
      /\b(?:bg|text|border|from|to|ring|fill|stroke|outline|decoration|divide|shadow|accent|caret)-(?:emerald|amber|zinc|rose|sky|red|blue|indigo|violet|green|yellow|orange|purple|slate|gray|neutral|stone)-\d{2,3}\b/;

    const offenders = OWNED_FILES.filter((file) => PALETTE.test(code(file)));
    assert.deepEqual(offenders, [], `a literal palette colour is in: ${offenders.join(', ')}`);
  });

  it('reaches its status colour through the token maps, not ad-hoc strings', () => {
    // The point of the token module is that every tone resolves through one
    // lookup. A page that reinvents the mapping drifts from the rest.
    //
    // `tokens.tsx` is exempt from the surface check below: it is the one file
    // that legitimately spells the raw status surfaces out, since it is where
    // they are defined.
    const TOKEN_MODULE = 'src/components/booking/tokens.tsx';

    for (const file of OWNED_FILES) {
      const source = code(file);
      // These are the shapes of drift that actually happened. A file that
      // defines its own tone map, or re-derives a payment tint inline, is
      // bypassing the shared vocabulary.
      assert.ok(
        !/const\s+TONE_CLASSES\b/.test(source),
        `${file} defines its own tone map instead of using the shared tokens`
      );
      assert.ok(
        !/const\s+paymentStateTone\b/.test(source),
        `${file} re-derives a payment tint locally instead of using describePaymentStatus`
      );
      if (file !== TOKEN_MODULE) {
        // A bare status surface is a panel or chip whose *background* carries the
        // status; that is what TONE_SURFACE exists for. A prefixed variant
        // (`hover:`, `focus:`) is a transient interaction state on one control
        // and legitimately pairs a soft tint with its matching text, so it is
        // out of scope here. The lookbehind is what separates the two.
        const BARE_STATUS_SURFACE =
          /(?<![\w:-])bg-\[var\(--color-shell-(?:success|warning|error|info)-soft\)\]/;
        assert.ok(
          !BARE_STATUS_SURFACE.test(source),
          `${file} hand-rolls a status surface instead of using TONE_SURFACE`
        );
      }
    }
  });

  it('keeps the tone maps total, so no status can render an unstyled chip', () => {
    const tones = code('src/components/booking/tokens.tsx');
    const statusTone = code('src/components/booking/statusTone.ts');

    for (const tone of ['success', 'warning', 'danger', 'info', 'neutral']) {
      assert.ok(
        new RegExp(`${tone}:\\s*'[^']+--color-shell`).test(tones),
        `TONE_SURFACE has no entry for ${tone}`
      );
    }
    assert.ok(
      /export type StatusTone = 'success' \| 'warning' \| 'danger' \| 'info' \| 'neutral'/.test(
        statusTone
      ),
      'StatusTone must stay the five tints the tokens define'
    );
  });
});

// ---------------------------------------------------------------------------
// 2. A booking's time is rendered in a named zone, from a real parser
// ---------------------------------------------------------------------------

describe('booking times are formatted for a real timezone', () => {
  it('never feeds an ISO timestamp to the bare "HH:MM" slot formatter', () => {
    // `formatLocalTimeLabel` splits its argument on ':' and reads the first two
    // parts as hours and minutes. It is correct for a generated slot's
    // `local_start_time` ("14:30") and wrong for every other timestamp in the
    // system: Number("2026-09-28T14") is NaN, and the component then renders
    // "NaN:30 AM". This is the exact defect that shipped in BookingSummary.
    const ISO = /\b(?!.*(?:local_start_time|local_end_time))[\w.?]*formatLocalTimeLabel\(\s*(?:booking|activeBooking|new Date)/;

    for (const file of OWNED_FILES) {
      assert.ok(
        !ISO.test(code(file)),
        `${file} passes a timestamp to formatLocalTimeLabel, which expects "HH:MM"`
      );
    }
  });

  it('renders the summary date and time in a named timezone, not the browser default', () => {
    const summary = code('src/components/booking/BookingSummary.tsx');

    // The card states below the fold that times are in the mentor's zone. A
    // date rendered with toLocaleDateString and no `timeZone` uses the viewer's
    // zone, so a seeker abroad sees a different calendar day than the slot
    // falls on — contradicting the card's own text.
    assert.ok(!/\.toLocaleDateString\([^)]*\)\s*\}\)/.test(summary), 'BookingSummary formats a date without a timeZone');
    assert.match(summary, /formatSessionDate\(booking\.start_time, displayZone\)/);
    assert.match(summary, /formatClockTime\(booking\.start_time, displayZone\)/);
    assert.match(
      summary,
      /const displayZone = mentorZone \|\| seekerZone/,
      'the display zone must prefer the mentor zone, which is authoritative for the slot'
    );
  });

  it('uses the zone-aware formatters everywhere a booking time is shown', () => {
    // The account area has exactly one pair of timezone-aware formatters. Any
    // other rendering of a booking's start_time is either browser-local or
    // unzoned, and both are wrong for a seeker in a different zone.
    const formatters = /formatClockTime|formatSessionDate/;
    for (const file of [
      'src/components/booking/BookingSummary.tsx',
      'src/pages/seeker/SeekerBookingsPage.tsx',
      'src/pages/seeker/SeekerSessionPage.tsx',
      'src/pages/seeker/SeekerBookingDetailPage.tsx',
    ]) {
      assert.ok(formatters.test(code(file)), `${file} shows booking times without a zone-aware formatter`);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. The hold countdown reflects the hold that actually exists
// ---------------------------------------------------------------------------

describe('the hold countdown reflects the hold the server created', () => {
  it('never falls back to a hardcoded hold length', () => {
    // `calculateRemainingHoldSeconds` returns 0 for an expired or unparseable
    // `expires_at`. A `|| 900` after it therefore resurrects a dead hold as a
    // 15-minute countdown on a hold that is five minutes long — telling a
    // seeker they have time they do not have. The configured value must come
    // from the app config instead.
    const MENTOR_DETAIL = 'src/pages/seeker/SeekerMentorDetailPage.tsx';
    const source = code(MENTOR_DETAIL);

    assert.ok(
      !/calculateRemainingHoldSeconds\([^)]*\)\s*\|\|/.test(source),
      'the hold seconds must not be defaulted with `||`, which hides an expired hold'
    );
    assert.ok(
      !/\b900\b/.test(source),
      'no literal 15-minute hold may remain on a five-minute hold page'
    );
  });

  it('takes the hold length from the single configured value everywhere', () => {
    // Two spellings of the same five minutes is how the 15-minute copy came
    // back in the first place. Both must derive from APP_CONFIG.
    for (const file of [
      'src/pages/seeker/SeekerMentorDetailPage.tsx',
      'src/pages/seeker/SeekerPaymentPage.tsx',
      'src/pages/seeker/SeekerBookingDetailPage.tsx',
    ]) {
      const source = code(file);
      assert.ok(
        /HOLDOUT_MINUTES|HOLD_DURATION_MS/.test(source),
        `${file} shows a hold length without referencing the configured value`
      );
    }

    const config = read('src/config/app.ts');
    // HOLDOUT_MINUTES is derived, so no page can disagree with it.
    assert.match(
      config,
      /export const HOLDOUT_MINUTES = \(APP_CONFIG\.HOLD_DURATION_MS \/ \(60 \* 1000\)\) \| 0/,
      'HOLDOUT_MINUTES must stay derived from HOLD_DURATION_MS'
    );
  });

  it('speaks seconds inside the final minute, not "0 minutes"', () => {
    const countdown = code('src/components/booking/HoldCountdown.tsx');

    // The screen-reader announcement floors to whole minutes, so in the last
    // minute it said "0 minutes remaining" — the moment the seeker most needs
    // to hear something specific.
    assert.match(countdown, /remaining < 60/, 'the final minute must be announced in seconds');
    assert.ok(
      /second\$\{remaining === 1 \? '' : 's'\} remaining/.test(countdown),
      'the seconds announcement must be pluralised'
    );
  });
});

// ---------------------------------------------------------------------------
// 4. A failed load is never reported as an empty list
// ---------------------------------------------------------------------------

describe('a failed load is shown as a failure, not as absence of data', () => {
  it('does not swallow a notification load error', () => {
    const page = code('src/pages/seeker/SeekerNotificationsPage.tsx');

    // This page used to `console.error` a failed fetch and then fall through to
    // an empty array, which rendered "No Notifications". To a seeker that is
    // indistinguishable from having nothing, so a network failure read as a
    // fact about their account.
    assert.ok(
      !/console\.(error|log)\([^)]*notification/i.test(page),
      'a notification load failure must reach the UI, not the console'
    );
    assert.match(page, /catch \(err\)/, 'the load must have a catch that stores the error');
    assert.match(page, /setError\(/, 'the load error must be stored in state');
    assert.match(page, /Could not load your notifications/, 'a failure state must be rendered');
    assert.match(page, /onClick=\{loadNotifs\}/, 'the failure state must offer a retry');
  });

  it('renders the notifications failure state before the empty state', () => {
    // Ordering is what decides which one a seeker sees. If the empty branch
    // comes first, a failed load is reported as "you have no notifications"
    // again the moment the error branch is added in the wrong place.
    const page = code('src/pages/seeker/SeekerNotificationsPage.tsx');
    const errorBranch = page.indexOf('error ?');
    const emptyBranch = page.indexOf('notifications.length === 0');

    assert.ok(errorBranch > -1 && emptyBranch > -1, 'both branches must exist');
    assert.ok(
      errorBranch < emptyBranch,
      'the error branch must be evaluated before the empty branch'
    );
  });

  it('does not offer controls for a state the platform does not store', () => {
    // The settings page presented three notification "preferences" as a list
    // that looked like toggles. There is no per-type preference anywhere, so
    // the controls would have done nothing when pressed.
    const settings = code('src/pages/seeker/SeekerSettingsPage.tsx');
    assert.ok(
      !/type=["']checkbox["']/.test(settings),
      'settings must not render notification toggles for a preference that is not stored'
    );
    assert.match(
      settings,
      /cannot be switched off individually/,
      'the alerts panel must say plainly that these are not preferences'
    );
  });
});

// ---------------------------------------------------------------------------
// 5. One status vocabulary, consulted by every surface
// ---------------------------------------------------------------------------

describe('every booking surface reads the shared status vocabulary', () => {
  it('has no local status-to-label switch of its own', () => {
    // Four files each carried a switch statement, which is how `MENTOR_PENDING`
    // ended up as "Waiting for Mentor" on the list and "Awaiting mentor" on the
    // detail page. The shared module is the only place a label may be chosen.
    const LOCAL_LABELERS = [
      /const\s+getStatusDisplay\b/,
      /const\s+paymentStateLabel\s*=\s*\([^)]*\)\s*=>\s*\{/,
      /function\s+StateBadge\b[\s\S]{0,80}?switch/,
    ];

    for (const file of OWNED_FILES) {
      const source = code(file);
      for (const pattern of LOCAL_LABELERS) {
        assert.ok(
          !pattern.test(source),
          `${file} derives a status label locally instead of using statusTone`
        );
      }
    }
  });

  it('has every surface import the shared describe* helpers it needs', () => {
    const expected: Record<string, RegExp> = {
      'src/pages/seeker/SeekerBookingsPage.tsx': /describeBookingStatus[\s\S]*describePaymentStatus/,
      'src/pages/seeker/SeekerBookingDetailPage.tsx': /describeBookingStatus/,
      'src/pages/seeker/SeekerSessionPage.tsx': /describeSessionState/,
      'src/components/booking/StatusPill.tsx': /from '@\/src\/components\/booking\/tokens'/,
      'src/components/booking/StatePanel.tsx': /TONE_SURFACE[\s\S]*TONE_TEXT/,
    };

    for (const [file, pattern] of Object.entries(expected)) {
      assert.ok(pattern.test(code(file)), `${file} does not read the shared status vocabulary`);
    }
  });

  it('derives a notification card’s icon and its chip from one classification', () => {
    const card = code('src/components/notifications/NotificationCard.tsx');

    // The card used to run two independent classifiers, one choosing the icon
    // and one the chip, so a notification could render a "needs attention" icon
    // beside a "success" chip for the same event.
    assert.match(
      card,
      /function presentNotification\(n: Notification\): NotificationPresentation/,
      'the card must resolve tone, label and icon together'
    );
    assert.match(card, /const \{ tone, label, icon: EventIcon \} = presentNotification\(n\)/);
    assert.ok(
      !/function getEventIcon\b/.test(card),
      'a second, independent event classifier must not exist'
    );
  });

  it('never shows a raw database constant as a user-facing status label', () => {
    // `event_type` is SCREAMING_SNAKE. A label is only rendered after being
    // reformatted; the fallback case renders no chip at all rather than the
    // constant, which is what a missing-type row would otherwise produce.
    const card = code('src/components/notifications/NotificationCard.tsx');
    assert.match(card, /function humaniseEventType/);
    assert.ok(
      !/label:\s*n\.type\s*[,}]/.test(card),
      'a raw type constant must not be used as a chip label'
    );
    assert.match(card, /\{label && <StatusPill/, 'the chip must be conditional on a real label');
  });
});

// ---------------------------------------------------------------------------
// 6. The cancellation window is explained against the server's clock
// ---------------------------------------------------------------------------

describe('the cancellation window is measured against the server clock', () => {
  it('uses the authoritative server time, not the browser clock alone', () => {
    const page = code('src/pages/seeker/SeekerBookingDetailPage.tsx');

    // The server enforces the window against its own clock. Deciding it from
    // Date.now() means a device with a skewed clock can hide a Cancel button
    // the server would still accept. The session-access payload the page
    // already fetches carries `currentServerTime`, so the offset is free.
    assert.match(page, /currentServerTime/, 'the server clock must be read');
    assert.match(
      page,
      /const authoritativeNowMs = Date\.now\(\) - \(serverClockOffsetMs \?\? 0\)/,
      'the window must be measured against the corrected clock'
    );
    assert.ok(
      !/minutesUntilStart[\s\S]{0,120}new Date\(booking\.start_time\)\.getTime\(\) - Date\.now\(\)/.test(
        page
      ),
      'the window must not be measured from the raw browser clock'
    );
  });

  it('mirrors the server’s cancellable status list', () => {
    const page = code('src/pages/seeker/SeekerBookingDetailPage.tsx');
    const server = read('server.ts');

    // A status the server refuses must never be presented as changeable. The
    // client list is a mirror, so it is asserted against the server's own.
    const match = server.match(/const cancellableStatuses = \[([^\]]+)\]/);
    assert.ok(match, 'the server cancellable list must be findable');

    const serverStatuses = [...match[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
    const clientMatch = page.match(
      /const CANCELLABLE_BOOKING_STATUSES: BookingStatus\[\] = \[([\s\S]*?)\];/
    );
    assert.ok(clientMatch, 'the client must declare a named cancellable list');
    const clientStatuses = [...clientMatch[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();

    assert.deepEqual(
      clientStatuses,
      serverStatuses,
      'the client cancellable list has drifted from the server'
    );
  });
});

// ---------------------------------------------------------------------------
// 7. Shared components are actually shared
// ---------------------------------------------------------------------------

describe('the shared booking components are used, not re-implemented', () => {
  it('are imported by the surfaces they exist for', () => {
    const usage: Record<string, RegExp> = {
      'src/pages/seeker/SeekerPaymentPage.tsx': /from '@\/src\/components\/booking\/(PageHeading|StatePanel|BookingSummary|HoldCountdown)'/,
      'src/pages/seeker/SeekerBookingDetailPage.tsx': /from '@\/src\/components\/booking\/(PageHeading|StatePanel|BookingSummary)/,
      'src/pages/seeker/SeekerMentorDetailPage.tsx': /from '@\/src\/components\/booking\/(SectionCard|StatePanel|HoldCountdown|StatusPill)'/,
      'src/pages/seeker/SeekerBookingsPage.tsx': /from '@\/src\/components\/booking\/(PageHeading|StatusPill|StatePanel)'/,
      'src/pages/seeker/SeekerSettingsPage.tsx': /from '@\/src\/components\/booking\/(PageHeading|StatePanel)'/,
      'src/pages/seeker/SeekerSessionPage.tsx': /from '@\/src\/components\/booking\/(StatePanel|StatusPill)'/,
    };

    for (const [file, pattern] of Object.entries(usage)) {
      assert.ok(pattern.test(code(file)), `${file} does not use the shared booking components`);
    }
  });

  it('are each exported under the name the pages import', () => {
    // A component that exists but is exported under a name no page uses is
    // dead code that looks like the design system.
    const exports: Record<string, RegExp[]> = {
      'src/components/booking/StatePanel.tsx': [
        /export const StatePanel/,
        /export const InlineNotice/,
        /export const SectionCard/,
        /export const DetailList/,
        /export const DetailItem/,
        /export const TotalRow/,
      ],
      'src/components/booking/StatusPill.tsx': [/export const StatusPill/, /export const StatusCallout/],
      'src/components/booking/PageHeading.tsx': [/export const PageHeading/, /export function SegmentedTabs/],
      'src/components/booking/BookingSummary.tsx': [/export const BookingSummary/, /export const AmountDue/],
      'src/components/booking/HoldCountdown.tsx': [/export const HoldCountdown/, /export const LiveCountdown/],
      'src/components/booking/SegmentScope.tsx': [/export const SegmentScope/],
    };

    for (const [file, patterns] of Object.entries(exports)) {
      for (const pattern of patterns) {
        assert.ok(pattern.test(code(file)), `${file} is missing ${pattern}`);
      }
    }
  });

  it('applies the segment theme as an attribute, never as inline colour', () => {
    // SegmentScope sets the attribute the stylesheet keys on. If it ever wrote
    // a colour value directly it would hard-code a palette and defeat both the
    // light/dark and the per-segment theming.
    const scope = code('src/components/booking/SegmentScope.tsx');
    assert.match(scope, /'data-segment': slug/, 'the segment must be applied as data-segment');
    assert.ok(
      !/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i.test(scope),
      'SegmentScope must not contain a literal colour'
    );

    // And the booking pages that use it must actually pass a slug.
    for (const file of [
      'src/pages/seeker/SeekerMentorDetailPage.tsx',
      'src/pages/seeker/SeekerBookingDetailPage.tsx',
    ]) {
      assert.match(code(file), /<SegmentScope slug=/, `${file} renders SegmentScope with no slug`);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Every owned file is a real, non-empty source file
// ---------------------------------------------------------------------------

describe('the owned file set is accurate', () => {
  it('lists only files that exist', () => {
    for (const file of OWNED_FILES) {
      assert.ok(statSync(join(REPO_ROOT, file)).isFile(), `${file} is listed but does not exist`);
    }
  });

  it('covers every file in the shared booking component directory', () => {
    // A new shared component that is never added here escapes every invariant
    // above, which is how the palette rule would quietly stop applying.
    const dir = join(REPO_ROOT, 'src', 'components', 'booking');
    const onDisk = readdirSync(dir)
      .filter((entry) => /\.(ts|tsx)$/.test(entry))
      .map((entry) => relative(REPO_ROOT, join(dir, entry)).replace(/\\/g, '/'));

    const missing = onDisk.filter((file) => !OWNED_FILES.includes(file));
    assert.deepEqual(missing, [], `shared components not covered: ${missing.join(', ')}`);
  });
});
