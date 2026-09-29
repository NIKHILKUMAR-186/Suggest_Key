/**
 * SEEKER HEADER & NAVIGATION.
 *
 * The header is the marketplace's front door, so the invariants that matter are
 * structural: the segment switcher is database-driven, the URL stays the single
 * source of truth for the selection, account actions live behind the hamburger,
 * and the bar itself never takes a segment's colour.
 *
 * These are source-level assertions on purpose. The header is a thin projection
 * of data that already exists, and the tests that matter are the ones that fail
 * if someone reintroduces a hardcoded slug, a second selection system, or a
 * permanently pinned account button.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();

function code(file: string): string {
  return readFileSync(resolve(ROOT, file), 'utf8');
}

const HEADER = 'src/components/navigation/SeekerHeader.tsx';
const HOOK = 'src/hooks/useActiveSegments.ts';
const CSS = 'src/index.css';

const header = () => code(HEADER);

// ---------------------------------------------------------------------------
// The structure
// ---------------------------------------------------------------------------

describe('the header is brand, segments, home, menu', () => {
  it('the brand mark is the shipped logo asset, never retyped or re-drawn', () => {
    const source = header();
    assert.ok(source.includes('src="/logo.png"'), 'must use the existing logo asset');
    assert.equal(
      /linear-gradient/.test(source),
      false,
      'the header must not substitute a gradient for the brand mark',
    );
  });

  it('the logo navigates home through the existing navigation mechanism', () => {
    const source = header();
    assert.ok(source.includes('useNavigation()'), 'must use the app navigation context');
    assert.ok(source.includes('aria-label="Suggest Key home"'), 'the brand must be labelled');
    assert.ok(
      /homeHref = SEEKER_HOME/.test(source),
      'the brand defaults to the seeker home',
    );
  });

  it('home is a permanent destination and clears the discovery state', () => {
    const source = header();
    assert.ok(
      /id: 'home', label: 'Home', href: SEEKER_HOME/.test(source),
      'Home must point at the seeker home, not at a segment URL',
    );
    // Going home is a bare path, so the segment AND the topic are both cleared.
    assert.equal(
      /buildExperienceQuery\([^)]*SEGMENT_HOME|buildExperienceQuery\([^)]*HOME/.test(source),
      false,
      'Home must navigate to a bare /seeker so no query state survives it',
    );
  });

  it('no notification bell, avatar, theme toggle or sign out is pinned to the bar', () => {
    const source = header();
    const barMarkup = source.slice(source.indexOf('RIGHT — home'), source.indexOf('Mobile: the same menu'));
    for (const label of ['Notifications', 'My Bookings', 'Sign out', 'Profile']) {
      assert.equal(
        barMarkup.includes(`>${label}<`),
        false,
        `"${label}" is an account action and must not be a permanent bar item`,
      );
    }
    // Notifications is reachable only from the menu, and the bell is not in the bar.
    assert.equal(
      /<Bell[^>]*\/>\s*\{\s*unreadCount > 0 && \(/.test(barMarkup),
      false,
      'the notification bell must not be a bar control',
    );
  });
});

// ---------------------------------------------------------------------------
// Database-driven segments, URL-owned selection
// ---------------------------------------------------------------------------

describe('the segment switcher is driven by the database', () => {
  it('renders the real active segments from the shared catalogue hook', () => {
    const source = header();
    assert.ok(
      source.includes('useActiveSegments()'),
      'the header must read the same active-segment catalogue the page uses',
    );
    assert.ok(source.includes('segments.map('), 'it must render whatever segments exist');
    assert.ok(
      /aria-label="Mentorship segments"/.test(source),
      'the switcher needs an accessible name',
    );
  });

  it('the shared hook reads active segments, so no slug is written into the header', () => {
    const source = code(HOOK);
    assert.ok(
      source.includes('fetchActiveSegments()'),
      'the catalogue must come from the existing data layer',
    );
    assert.equal(
      /autism|career|relationship/i.test(source),
      false,
      'the hook must not name any segment',
    );
  });

  it('selection is written to the URL, and the header holds no segment state', () => {
    const source = header();
    assert.ok(
      source.includes('parseExperienceQuery(currentPath).segment'),
      'the active segment must be READ from the URL, exactly as the page reads it',
    );
    assert.ok(
      source.includes('buildExperienceQuery(segment.slug, ALL_TOPICS)'),
      'selecting a segment must write /seeker?segment=<slug> and clear the topic',
    );
    // A second selection system would be local state that outlives the URL.
    assert.equal(
      /useState[^\n]*segment/i.test(source),
      false,
      'the header must not keep segment state of its own',
    );
  });

  it('the switcher is navigation, not the page content section', () => {
    const source = header();
    assert.equal(
      source.includes('SegmentSelector'),
      false,
      'the header must not reuse the large page-level segment section',
    );
    assert.ok(source.includes('sk-segment-pill'), 'it uses the compact header pill');
  });
});

// ---------------------------------------------------------------------------
// The hamburger
// ---------------------------------------------------------------------------

describe('the hamburger holds every secondary action', () => {
  it('the desktop popover and the mobile drawer render one shared menu', () => {
    const source = header();
    assert.equal(
      /renderMenuPanel\(/.test(source),
      true,
      'the menu must be one definition, so desktop and mobile can never drift',
    );
    assert.ok(
      /menuOpen && isDesktop/.test(source) && /menuOpen && !isDesktop/.test(source),
      'the same menu is a popover on desktop and a drawer on mobile',
    );
  });

  it('keeps every account action that existed before, on its existing route', () => {
    const source = header();
    for (const [label, href] of [
      ['Profile', '/seeker/settings'],
      ['My Bookings', '/seeker/bookings'],
      ['Notifications', '/seeker/notifications'],
      ['Settings', '/seeker/settings'],
    ]) {
      assert.ok(
        source.includes(`label: '${label}', href: '${href}'`),
        `${label} must remain reachable at ${href}`,
      );
    }
    assert.ok(source.includes('handleSignOut'), 'sign out must remain available');
    assert.ok(
      source.includes('<ThemeToggle />'),
      'the existing shared theme control must be reused, not reimplemented',
    );
  });

  it('never invents a route: every destination is an in-app path', () => {
    const source = header();
    const hrefs = [...source.matchAll(/href: '([^']+)'/g)].map((match) => match[1]);
    assert.ok(hrefs.length > 0);
    for (const href of hrefs) {
      assert.ok(href.startsWith('/'), `${href} must be an in-app route`);
    }
    // The one non-route navigation is the sign-out redirect.
    assert.ok(source.includes("navigate('/auth/login')"));
  });

  it('closes on outside click, on Escape, on navigation and on selection', () => {
    const source = header();
    assert.ok(source.includes("addEventListener('mousedown'"), 'an outside click must close it');
    assert.ok(source.includes("event.key === 'Escape'"), 'Escape must close it');
    assert.ok(
      /useEffect\(\(\) => \{\s*closeMenus\(\);\s*\}, \[currentPath/.test(source),
      'navigating must close it, including back/forward',
    );
    assert.ok(
      /const go = useCallback\([\s\S]*?closeMenus\(\);[\s\S]*?navigate\(href\);/.test(source),
      'choosing any menu action must close the menu and navigate',
    );
  });

  it('is keyboard and screen-reader accessible', () => {
    const source = header();
    assert.ok(source.includes('aria-expanded={menuOpen}'), 'the trigger exposes its state');
    assert.ok(source.includes('aria-haspopup="menu"'), 'the trigger declares the menu');
    assert.ok(source.includes('role="menu"'), 'the menu has menu semantics');
    assert.ok(source.includes('role="menuitem"'), 'its actions are menu items');
    assert.ok(
      source.includes('role="group"'),
      'sections (account, preferences) are grouped inside the menu',
    );
    assert.ok(
      /menuButtonRef\.current\?\.focus\(\)/.test(source),
      'Escape returns focus to the trigger',
    );
    assert.ok(
      source.includes('panelRef.current?.focus()'),
      'opening the menu moves focus into it',
    );
  });

  it('shows the real user, and a neutral state when signed out', () => {
    const source = header();
    assert.ok(
      source.includes('profile?.full_name || user?.email'),
      'identity must come from the authenticated user, never a literal',
    );
    assert.ok(source.includes('>Sign in<'), 'signed-out users get a sign-in action');
    assert.ok(
      source.includes("go('/auth/login')"),
      'and it must go to the real login route',
    );
  });
});

// ---------------------------------------------------------------------------
// Mobile
// ---------------------------------------------------------------------------

describe('the mobile header is not a shrunken desktop header', () => {
  it('shows the current space behind a trigger instead of every segment', () => {
    const source = header();
    assert.ok(source.includes('sk-segment-trigger'), 'a single current-space trigger');
    assert.ok(
      /activeSegment \? activeSegment\.name/.test(source),
      'the trigger names the current space',
    );
    assert.ok(
      source.includes('Choose your space'),
      'the picker states what it is for',
    );
  });

  it('the mobile picker writes the same URL the desktop pills do', () => {
    const source = header();
    const picker = source.slice(
      source.indexOf('const renderSegmentPicker'),
      source.indexOf('<header'),
    );
    assert.ok(
      picker.includes('selectSegment(segment)'),
      'the picker must reuse the one selection path',
    );
    assert.equal(
      /useState[^)]*segment/i.test(picker),
      false,
      'there is no separate mobile-only segment state',
    );
  });

  it('the drawer locks the page behind it and closes on a backdrop press', () => {
    const source = header();
    assert.ok(
      source.includes("document.body.style.overflow = 'hidden'"),
      'the drawer must lock background scroll',
    );
    assert.ok(
      /aria-label="Close menu"[\s\S]{0,120}onClick=\{closeMenus\}/.test(source),
      'the backdrop must dismiss the drawer',
    );
  });
});

// ---------------------------------------------------------------------------
// Visual contract
// ---------------------------------------------------------------------------

describe('the bar is brand, only the active control is the segment', () => {
  it('the header surface is the brand plum field in both modes', () => {
    const css = code(CSS);
    assert.ok(
      /\.sk-header\s*\{[^}]*background: var\(--sk-brand-header-bg\)/.test(css),
      'the bar is the brand token',
    );
    assert.ok(
      /\.sk-header\s*\{[^}]*border-bottom: 1px solid var\(--sk-brand-header-border\)/.test(css),
      'the bar has a subtle brand border',
    );
  });

  it('the active pill is filled with the configured accent and nothing else is', () => {
    const css = code(CSS);
    const rule = css.slice(
      css.indexOf(".sk-segment-pill[data-active='true']"),
      css.indexOf('.sk-segment-pill:empty'),
    );
    assert.ok(
      /background: var\(--segment-accent\)/.test(rule),
      'the active control is filled with the live accent token',
    );
    assert.ok(
      /color: var\(--segment-on-accent, #ffffff\)/.test(rule),
      'and its text is the contrast-checked foreground',
    );
    const inactive = css.slice(css.indexOf('.sk-segment-pill {'), css.indexOf('.sk-segment-pill:hover'));
    assert.ok(
      /background: transparent/.test(inactive),
      'inactive pills stay transparent',
    );
    assert.ok(css.includes('.sk-segment-pill:hover'), 'inactive pills have a hover state');
  });

  it('the switcher animates on switch', () => {
    const css = code(CSS);
    const rule = css.slice(
      css.indexOf('.sk-segment-pill {'),
      css.indexOf('.sk-segment-pill:hover'),
    );
    assert.ok(/transition:/.test(rule), 'switching segments should not snap');
  });
});
