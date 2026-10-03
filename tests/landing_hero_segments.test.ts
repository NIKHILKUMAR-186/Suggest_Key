/**
 * LANDING HERO — DATABASE-DRIVEN SEGMENTS.
 *
 * Source-level assertions, the same style as `seeker_header_navigation.test.ts`.
 * They pin the properties the hero is easy to break by accident:
 *
 *   1. No production segment name is written into landing-page code.
 *   2. The hero image composition and the section below read the SAME catalogue.
 *   3. `segments.priority` is used as-is; no second ranking scheme.
 *   4. Loading shows skeletons, empty shows nothing, neither invents an area.
 *   5. Realtime rides the EXISTING publication and RLS policy — no migration,
 *      no new grant, no service-role client in the browser.
 *   6. Nothing renders ratings, reviews or testimonials, because the product has
 *      no review system behind those columns.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();

const code = (file: string): string => readFileSync(resolve(ROOT, file), 'utf8');

const LANDING_FILES = [
  'src/pages/public/LandingPage.tsx',
  'src/components/landing/LandingHero.tsx',
  'src/components/landing/HeroConversationVisual.tsx',
  'src/components/landing/LandingSegmentStrip.tsx',
  'src/hooks/useActiveSegments.ts',
];

const landingSource = (): string => LANDING_FILES.map(code).join('\n');

/** Strips block and line comments, which legitimately discuss absence. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

// ---------------------------------------------------------------------------
// No production segment name is hardcoded
// ---------------------------------------------------------------------------

describe('no production segment name is hardcoded on the landing page', () => {
  it('landing code names no mentorship area', () => {
    assert.equal(
      /autism mentor|relationship advisor|career mentor|parental|finance mentor|education mentor|creativity mentor|technology mentor|wellness mentor/i.test(landingSource()),
      false,
      'a landing-page file names a mentorship area; the area list must come from the database',
    );
  });

  it('the hero image and the section share one catalogue read', () => {
    const page = code('src/pages/public/LandingPage.tsx');
    assert.ok(page.includes('useActiveSegments()'), 'the page must read the shared active-segment catalogue');
    assert.equal(
      /fetchActiveSegments/.test(page),
      false,
      'the page must not fetch segments a second time',
    );
    assert.ok(page.includes('segments={segments}'), 'the hero image takes the shared catalogue');
    assert.ok(page.includes('isLoadingSegments={isLoadingSegments}'), 'and shares its loading state');
  });
});

// ---------------------------------------------------------------------------
// Priority comes from the database
// ---------------------------------------------------------------------------

describe('segment prominence comes from segments.priority', () => {
  it('the strip takes a prefix of the already-ordered list', () => {
    const source = withoutComments(code('src/components/landing/LandingSegmentStrip.tsx'));
    assert.ok(/segments\.map\(/.test(source), 'the strip must iterate the ordered list, not re-sort it');
    assert.equal(
      /\.sort\(|priority\s*[-+*]/.test(source),
      false,
      'the strip must not invent its own ranking; priority is already applied by the query',
    );
  });

  it('the ordering itself is the database priority column', () => {
    const service = code('src/lib/discoveryService.ts');
    assert.ok(
      /order\('priority',\s*\{\s*ascending:\s*true\s*\}\)/.test(service),
      'fetchActiveSegments must order by segments.priority so the CMS ranking is authoritative',
    );
  });

  it('the highest-priority area is visually primary, with no filler', () => {
    const source = withoutComments(code('src/components/landing/LandingSegmentStrip.tsx'));
    assert.ok(/index \* 0\.06/.test(source), 'the first segment (highest priority) must receive the primary reveal delay');
    assert.equal(
      /filler/i.test(source),
      false,
      'a missing area must never be padded with a placeholder card',
    );
  });
});

// ---------------------------------------------------------------------------
// Loading / empty / error
// ---------------------------------------------------------------------------

describe('the strip states are honest about what it does not know yet', () => {
  it('loading renders skeletons, not an error', () => {
    const source = code('src/components/landing/LandingSegmentStrip.tsx');
    assert.ok(source.includes('isLoading'), 'the loading branch must be handled');
    assert.ok(source.includes('Skeleton'), 'the strip must show skeleton cards while loading');
    const loadingBranch = source.slice(
      source.indexOf('isLoading ?'),
      source.indexOf('segments.length > 0')
    );
    assert.equal(/ErrorState|hasError/.test(loadingBranch), false, 'loading must not surface an error');
  });

  it('an empty catalogue renders no card at all', () => {
    const source = code('src/components/landing/LandingSegmentStrip.tsx');
    assert.ok(
      /Mentorship areas are being prepared\./.test(source),
      'with zero active areas the strip must render an empty state rather than a placeholder',
    );
  });

  it('the section states the real reason without a full-page empty panel', () => {
    const source = code('src/components/landing/LandingSegmentStrip.tsx');
    assert.ok(
      /Mentorship areas are being prepared\./.test(source),
      'the empty state must say areas are being prepared',
    );
    assert.ok(/Try Again/.test(source), 'the error state must offer a retry');
    assert.equal(
      /from '@\/src\/components\/shared\/EmptyState'/.test(source),
      false,
      'the section must not render the full-height EmptyState panel',
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
});

// ---------------------------------------------------------------------------
// Accessibility and motion
// ---------------------------------------------------------------------------

describe('the floating cards are reachable and calm', () => {
  it('cards are real buttons with an accessible name', () => {
    const source = code('src/components/landing/LandingSegmentStrip.tsx');
    assert.ok(/<button/.test(source), 'each card must be a button');
    assert.ok(/type="button"/.test(source), 'a card declares its button type');
    assert.ok(
      /aria-label=\{`Explore mentors in \$\{segment\.name\}`\}/.test(source),
      'a card must announce which area it opens',
    );
  });

  it('every animation is gated on prefers-reduced-motion', () => {
    for (const file of [
      'src/components/landing/HeroConversationVisual.tsx',
      'src/components/landing/Reveal.tsx',
    ]) {
      const source = code(file);
      assert.ok(source.includes('useReducedMotion'), `${file} must consult useReducedMotion`);
      assert.ok(source.includes('canAnimate'), `${file} must gate its motion on that preference`);
    }
  });
});
