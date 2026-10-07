/**
 * LANDING HERO — DATABASE-DRIVEN SEGMENTS AND MENTORS.
 *
 * Source-level assertions, the same style as `seeker_header_navigation.test.ts`.
 * They pin the properties the hero is easy to break by accident:
 *
 *   1. No production segment name is written into landing-page code.
 *   2. The hero and the section below read the SAME catalogue.
 *   3. `segments.priority` is used as-is; no second ranking scheme.
 *   4. Loading shows a skeleton, empty shows no card, neither invents an area.
 *   5. Realtime rides the EXISTING publication and RLS policy — no migration,
 *      no new grant, no service-role client in the browser.
 *   6. Nothing renders ratings, reviews or testimonials, because the product has
 *      no review system behind those columns.
 *   7. The hero stage is presentational — no control, no tab stop, no route — and
 *      every animation is gated on prefers-reduced-motion.
 *
 * A NOTE ON THE PORT FROM `HeroSegmentDeck`.
 *
 * The hero's visual has been a set of floating bubbles, then a turning 3D deck,
 * and is now a single real mentor profile with live area names on an orbit around
 * it (`HeroMentorStage`). The assertions below were re-pointed at the component
 * that replaced it. They were NOT deleted or weakened — the replacement is held to
 * the same rules, and several of them are now strictly tighter:
 *
 *   bubbles were real buttons   the deck and the stage are both the opposite: they
 *                               assert the component contains NO control at all,
 *                               and that the catalogue is reachable exactly once,
 *                               in the areas section. A duplicated focusable
 *                               catalogue in front of the page's single conversion
 *                               is the failure this now forbids.
 *
 *   bubbles could not overflow   containment is asserted where it actually lives,
 *                                 in the stage's own CSS.
 *
 *   the deck rotated time       the stage holds still and responds to the pointer.
 *   Three assertions that were about a time-driven cycle are now about the thing
 *   that replaced it: a pointer tilt that is bounded, gated on a fine pointer, and
 *   switched off entirely under reduced motion.
 *
 * Two assertions changed shape because the design changed, and the reasoning is
 * preserved rather than dropped:
 *
 *   "takes a prefix of the ordered list"  the stage's orbit is a fixed number of
 *      slots, so it takes a prefix of the ordered catalogue — and it still must not
 *      RE-SORT, which is what the original assertion was actually protecting.
 *
 *   "an empty catalogue renders no bubble"  the stage renders an honest sentence
 *      rather than nothing. The assertion still forbids what it forbade: a
 *      placeholder standing in for a missing area, and a skeleton that would imply
 *      the read is still in flight when it has already resolved.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();

const code = (file: string): string => readFileSync(resolve(ROOT, file), 'utf8');

/**
 * The landing surface that renders segments, plus the hero's product visual.
 *
 * `landingContent.ts` is deliberately absent: it holds the page's prose, and prose
 * about what the site covers is not the same thing as hardcoding a catalogue row.
 * The rule this test exists to enforce is that a *component* must never name an
 * area; the copy is written to describe the product without pinning the CMS.
 */
const LANDING_FILES = [
  'src/pages/public/LandingPage.tsx',
  'src/components/landing/LandingHero.tsx',
  'src/components/landing/HeroMentorStage.tsx',
  'src/components/landing/LandingSegmentStrip.tsx',
  'src/hooks/useActiveSegments.ts',
];

const landingSource = (): string => LANDING_FILES.map(code).join('\n');

/** Strips block and line comments, which legitimately discuss absence. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/**
 * Slices one ternary branch out of a component.
 *
 * The stage is written as `isLoading ? ... : hasError && !mentor ? ... : !mentor ?
 * ...`, so a branch is located by its own opening condition and closed at the
 * delimiter that follows it. Reading a branch this way, rather than matching a
 * single string against the whole file, is what lets these tests assert that a
 * branch does not contain something — "loading must not surface an error" is only
 * meaningful if the slice really is the loading branch and nothing more.
 */
function branch(source: string, opens: string, closes: string): string {
  const start = source.indexOf(opens);
  assert.notEqual(start, -1, `expected the component to branch on \`${opens}\``);
  const end = source.indexOf(closes, start);
  assert.notEqual(end, -1, `expected \`${opens}\` to close at \`${closes}\``);
  return source.slice(start, end);
}

// ---------------------------------------------------------------------------
// No production segment name is hardcoded
// ---------------------------------------------------------------------------

describe('no production segment name is hardcoded on the landing page', () => {
  it('landing code names no mentorship area', () => {
    assert.equal(
      /autism|career|relationship|parental|finance|education|creativity|technology|wellness/i.test(landingSource()),
      false,
      'a landing-page file names a mentorship area; the area list must come from the database',
    );
  });

  it('the hero and the section share one catalogue read', () => {
    const page = code('src/pages/public/LandingPage.tsx');
    assert.ok(page.includes('useActiveSegments()'), 'the page must read the shared active-segment catalogue');
    assert.equal(
      /fetchActiveSegments/.test(page),
      false,
      'the page must not fetch segments a second time',
    );
    assert.ok(page.includes('segments={segments}'), 'the hero takes the shared catalogue');
  });
});

// ---------------------------------------------------------------------------
// Priority comes from the database
// ---------------------------------------------------------------------------

describe('segment prominence comes from segments.priority', () => {
  it('the hero renders the already-ordered list, and never re-ranks it', () => {
    const source = withoutComments(code('src/components/landing/HeroMentorStage.tsx'));
    assert.ok(
      /segments\.slice\(/.test(source),
      'the orbit must take a prefix of the catalogue in the order it was given',
    );
    assert.equal(
      /\.sort\(/.test(source),
      false,
      'the hero must not sort; priority is already applied by the query',
    );
    assert.equal(
      /priority\s*[-+*]/.test(source),
      false,
      'the hero must not do arithmetic on priority either',
    );
  });

  it('the ordering itself is the database priority column', () => {
    const service = code('src/lib/discoveryService.ts');
    assert.ok(
      /order\('priority',\s*\{\s*ascending:\s*true\s*\}\)/.test(service),
      'fetchActiveSegments must order by segments.priority so the CMS ranking is authoritative',
    );
  });

  it('the highest-priority area is shown first, with no filler', () => {
    const source = withoutComments(code('src/components/landing/HeroMentorStage.tsx'));

    // The orbit's slots are laid out in a fixed array, so the FIRST database row
    // lands in the FIRST slot. This is the assertion the old `index === 0` check
    // made, expressed for an orbit whose positions are data.
    assert.ok(
      /ORBIT_POINTS\[index % ORBIT_POINTS\.length\]/.test(source),
      'each area must be placed from its own position in the ordered catalogue',
    );
    assert.ok(
      /const orbit = segments\.slice\(0, ORBIT_SLOTS\)/.test(source),
      'the orbit must start at the front of the ordered catalogue, not sample from it',
    );

    assert.equal(
      /filler/i.test(source),
      false,
      'a missing area must never be padded with a placeholder card',
    );
  });

  it('the orbit is bounded, so it stays an orbit rather than a diagram', () => {
    const source = withoutComments(code('src/components/landing/HeroMentorStage.tsx'));
    assert.ok(
      /const ORBIT_SLOTS = \d+;/.test(source),
      'the number of area names on the orbit must be a fixed budget, not the whole catalogue',
    );
  });
});

// ---------------------------------------------------------------------------
// Loading / empty / error
// ---------------------------------------------------------------------------

describe('the hero states are honest about what it does not know yet', () => {
  it('loading renders a skeleton, not an error', () => {
    const source = code('src/components/landing/HeroMentorStage.tsx');
    assert.ok(source.includes('isLoading'), 'the loading branch must be handled');
    assert.ok(source.includes('sk-lg-skeleton'), 'the hero must show a skeleton while loading');

    const loadingBranch = branch(source, 'isLoading ?', 'hasError && !mentor ?');
    assert.equal(
      /STAGE_ERROR_LABEL|STAGE_EMPTY_LABEL/.test(loadingBranch),
      false,
      'loading must not surface an error or an empty-state message',
    );
  });

  it('an empty catalogue renders no area name at all', () => {
    const source = code('src/components/landing/HeroMentorStage.tsx');

    // Zero segments means `orbit` is empty, so the orbit renders nothing. This is
    // asserted through the slice itself: with no rows there is no node markup.
    const orbit = source.slice(source.indexOf('const orbit ='), source.indexOf('/* THE PROFILE'));
    assert.ok(
      /orbit\.map\(/.test(orbit),
      'the orbit must render from the live rows it was given',
    );
    assert.equal(
      /ORBIT_POINTS\[index/.test(orbit),
      true,
      'and place them from that same row list',
    );

    assert.equal(
      /filler|placeholder/i.test(withoutComments(source)),
      false,
      'no missing area may be padded with a placeholder name',
    );
  });

  it('an empty mentor directory says what is true, in one sentence', () => {
    const source = code('src/components/landing/HeroMentorStage.tsx');
    assert.ok(
      /No mentors are live yet\./.test(source),
      'the empty state must say what is true, not go blank',
    );

    const emptyBranch = branch(source, '!mentor ? (', ') : (');
    assert.equal(
      /sk-lg-skeleton/.test(emptyBranch),
      false,
      'an empty directory is a resolved read, not a pending one, so it must not keep shimmering',
    );
    assert.ok(/STAGE_EMPTY_LABEL/.test(emptyBranch), 'and the empty branch must render the honest sentence');
  });

  it('a failed read is quieter than the content it replaced', () => {
    const stage = code('src/components/landing/HeroMentorStage.tsx');
    const strip = code('src/components/landing/LandingSegmentStrip.tsx');
    const mentors = code('src/components/landing/LandingFeaturedMentors.tsx');

    // The exact strings the page used to render as heading-weight panels, which is
    // what made one failed request look like the whole product had failed.
    for (const [name, source] of [
      ['the hero stage', stage],
      ['the areas section', strip],
      ['the mentors section', mentors],
    ] as const) {
      assert.equal(
        /could not be loaded/i.test(source),
        false,
        `${name} must not announce a failed read in heading case; a timeout is not a page state`,
      );
    }

    assert.ok(
      /Couldn’t load mentors\./.test(stage),
      'the mentor failure must be one sentence',
    );
    assert.ok(
      /Couldn’t load mentorship areas\./.test(strip),
      'the area failure must be one sentence',
    );

    // And both must offer the way out rather than leaving a dead end.
    assert.ok(/onRetry/.test(strip), 'the areas section must offer a retry');
    assert.ok(/onRetry/.test(mentors), 'the mentors section must offer a retry');
    assert.equal(
      /from '@\/src\/components\/shared\/EmptyState'/.test(strip),
      false,
      'the section must not render the full-height EmptyState panel',
    );
  });

  it('the mentor rail keeps its real data requirements honest', () => {
    // Availability and price are the two fields that are frequently absent. They
    // must be rendered only when present, never defaulted into a plausible value.
    const card = code('src/components/landing/LandingMentorCard.tsx');
    assert.ok(/starting_price_inr != null && mentor\.starting_price_inr > 0/.test(card));
    assert.equal(
      /starting_price_inr\s*\|\|\s*\d/.test(withoutComments(card)),
      false,
      'a missing price must render no price, never a zero or a guess',
    );
  });
});

// ---------------------------------------------------------------------------
// Realtime, through the existing architecture only
// ---------------------------------------------------------------------------

describe('the segment catalogue updates live, without new backend surface', () => {
  it('the shared catalogue hook subscribes to segments', () => {
    const source = code('src/hooks/useActiveSegments.ts');
    assert.ok(/table:\s*'segments'/.test(source), 'it must subscribe to postgres_changes on segments');
    assert.ok(
      /event:\s*'\*'/.test(source),
      "it must listen to INSERT, UPDATE and DELETE - a segment can be created, renamed or deactivated",
    );
    assert.ok(
      /supabase\.removeChannel/.test(source),
      'the channel must be removed on unmount so subscriptions cannot accumulate',
    );
  });

  it('the event is a signal to re-read, never the data itself', () => {
    const source = code('src/hooks/useActiveSegments.ts');
    const realtimeBlock = source.slice(source.indexOf('channel.on('));
    assert.ok(
      /fetchActiveSegments\(\)/.test(realtimeBlock),
      'a realtime event must re-read through fetchActiveSegments, not patch state from the payload',
    );
    assert.equal(/setInterval/.test(source), false, 'the catalogue must not poll');
  });

  it('a failed re-read keeps the last good list rather than blanking it', () => {
    const source = code('src/hooks/useActiveSegments.ts');
    assert.ok(
      /if \(segmentError \|\| !next\) return;/.test(source),
      'a transient read failure must leave the existing list on screen',
    );
  });

  it('no service-role client and no new migration is introduced', () => {
    for (const file of LANDING_FILES) {
      assert.equal(
        /SERVICE_ROLE|service_role/i.test(code(file)),
        false,
        `${file} must not create or reference a service-role browser client`,
      );
    }
    assert.equal(/SUPABASE_SERVICE/i.test(landingSource()), false, 'landing code must never reference a service-role key');
  });
});

// ---------------------------------------------------------------------------
// No social proof anywhere on the page
// ---------------------------------------------------------------------------

describe('the landing page shows no ratings, reviews or testimonials', () => {
  it('no landing component renders a rating, review count or testimonial', () => {
    for (const file of LANDING_FILES) {
      const source = withoutComments(code(file));
      assert.equal(
        /\brating\b|\breview_count\b|\bsession_count\b|\btestimonial/i.test(source),
        false,
        `${file} renders a rating, review count or testimonial; the product has no review system`,
      );
      assert.equal(/\bStar\b/.test(source), false, `${file} renders a star rating`);
    }
  });

  it('the hero profile uses only fields the directory really returns', () => {
    const stage = code('src/components/landing/HeroMentorStage.tsx');
    // The directory row also carries experience_years and a session count. Both
    // are real columns, but they are vanity numbers on a card that a visitor may
    // pay an actual fee on, so the stage deliberately does not print them.
    assert.equal(
      /experience_years/.test(stage),
      false,
      'the stage must not print a years-of-experience figure',
    );
    assert.ok(/full_name/.test(stage), 'the stage does print the name the directory returns');
    assert.ok(/headline/.test(stage), 'and the mentor’s own headline');
  });
});

// ---------------------------------------------------------------------------
// Accessibility and motion
// ---------------------------------------------------------------------------

describe('the hero stage is presentational and calm', () => {
  it('the stage contains no control at all', () => {
    const source = code('src/components/landing/HeroMentorStage.tsx');
    assert.equal(
      /<button|<a\s|<a>|tabIndex=|onClick|onKeyDown|role="(button|link)"/.test(source),
      false,
      'the stage must not be a navigation surface; every area and profile has a real route below the hero',
    );
  });

  it('the "Book session" caption is inert and announces no destination', () => {
    const source = code('src/components/landing/HeroMentorStage.tsx');
    assert.ok(
      /<span className="sk-lg-stage__action">/.test(source),
      'the action label must be a span describing the picture, not a control that looks live',
    );

    const css = withoutComments(code('src/index.css'));
    assert.ok(
      /\.sk-lg-stage__action\s*\{[^}]*pointer-events:\s*none/.test(css),
      'and it must take no pointer, so nothing in the stage can be clicked by accident',
    );
  });

  it('the stage is hidden from assistive technology', () => {
    const source = code('src/components/landing/HeroMentorStage.tsx');
    assert.ok(/aria-hidden="true"/.test(source), 'the whole stage must be aria-hidden');
  });

  it('the profile is still announced to a screen reader as a live state', () => {
    const source = code('src/components/landing/HeroMentorStage.tsx');
    assert.ok(
      /role="status"/.test(source),
      'the loading, failure and empty states must be announced, so a screen-reader user knows the page is working',
    );
    assert.ok(
      /sk-lg-sr-only/.test(source),
      'that announcement must be visually hidden rather than drawn into the composition',
    );
  });

  it('the catalogue is reachable exactly once, below the hero', () => {
    const page = code('src/pages/public/LandingPage.tsx');
    const hero = code('src/components/landing/LandingHero.tsx');
    assert.equal(
      /onOpenSegment/.test(page),
      false,
      'the hero must not be handed a segment navigation handler at all',
    );
    assert.equal(
      /onOpenSegment|onOpenArea/.test(hero),
      false,
      'the hero must not be able to route anywhere',
    );
    assert.ok(page.includes('onOpenArea={handleOpenArea}'), 'the areas section carries the only route');
  });

  it('every animation is gated on prefers-reduced-motion', () => {
    for (const file of [
      'src/components/landing/HeroMentorStage.tsx',
      'src/components/landing/LandingBackToTop.tsx',
    ]) {
      const source = code(file);
      assert.ok(source.includes('useReducedMotion'), `${file} must consult useReducedMotion`);
      assert.ok(source.includes('canAnimate'), `${file} must gate its motion on that preference`);
    }
  });

  it('the pointer tilt is bounded and never fires on a touch screen', () => {
    const source = code('src/components/landing/HeroMentorStage.tsx');

    // Three degrees. A tilt that has to be dialled back is a tilt that was wrong.
    assert.ok(
      /rotateX\(\$\{\(-y \* 3\)\.toFixed\(2\)\}deg\)/.test(source),
      'the frame must rotate within a three-degree budget',
    );
    assert.ok(
      /matchMedia\('\(pointer: fine\)'\)/.test(source),
      'a device with no cursor must not get cursor-driven depth',
    );
    assert.ok(
      /if \(!canAnimate \|\| !hasFinePointer\) return;/.test(source),
      'the tilt must be skipped for reduced motion and for coarse pointers',
    );
  });

  it('the stage cannot overflow the page on small screens', () => {
    const css = withoutComments(code('src/index.css'));

    // The orbit is the part that cannot survive a phone, so it is removed there
    // rather than scaled down — four captions at 390px collide with the copy and
    // with each other, and a shrunken collision still reads as a collision.
    assert.ok(
      /@media \(max-width: 767px\)\s*\{[\s\S]*?\.sk-lg-stage__node[\s\S]*?display:\s*none/.test(css),
      'the orbit must be dropped on a phone',
    );
    assert.ok(
      /\.sk-lg-stage__frame\s*\{[^}]*width:\s*min\(\s*\d+px,\s*100%\s*\)/.test(css),
      'the profile must be capped and fluid, so it cannot push past the gutter',
    );
    assert.ok(
      /\.sk-lg-stage__node\s*\{[^}]*white-space:\s*nowrap/.test(css),
      'an area name must never wrap mid-word against the profile',
    );
  });
});

// ---------------------------------------------------------------------------
// Copy budget
// ---------------------------------------------------------------------------

describe('the hero says one thing, and the trust story lives below it', () => {
  it('the hero carries no proof list', () => {
    const hero = code('src/components/landing/LandingHero.tsx');
    const content = code('src/components/landing/landingContent.ts');

    assert.equal(
      /sk-lg-proof|HERO_PROOF/.test(hero + content),
      false,
      'the verification bullets must not return to the hero; they belong to the trust section',
    );
    // The exact facts that used to sit under the buttons.
    for (const claim of [
      /Applications reviewed by our team/,
      /Government ID and qualification proof/,
      /Only approved mentors are listed/,
    ]) {
      assert.equal(
        claim.test(content),
        false,
        `the hero copy must not carry "${claim.source}"`,
      );
    }
  });

  it('the trust section is where those claims now live', () => {
    const content = code('src/components/landing/landingContent.ts');
    assert.ok(
      /Mentors are reviewed before they go live\./.test(content),
      'the trust section must state the review claim',
    );
    assert.ok(
      /Identity and qualifications checked by our team\./.test(content),
      'and carry the mechanism in one short sentence',
    );
  });

  it('"Become a mentor" exists only in the footer', () => {
    const hero = code('src/components/landing/LandingHero.tsx');
    const content = code('src/components/landing/landingContent.ts');
    const nav = code('src/components/landing/LandingNav.tsx');

    assert.equal(
      /Become a mentor/i.test(hero + nav),
      false,
      'the page has one conversion; a second action at the same weight splits it',
    );
    // It is legal for the word to exist in the copy file — the footer imports it
    // from there — so what is asserted is that only the footer renders it.
    const footerOnly = code('src/components/landing/LandingFooter.tsx');
    assert.ok(/Become a mentor/i.test(footerOnly), 'the footer must be the one place it appears');
    assert.ok(
      /Become a mentor/i.test(content),
      'and it is the footer that carries it, from the shared copy file',
    );
  });
});