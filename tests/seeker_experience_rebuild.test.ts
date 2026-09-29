/**
 * SEEKER EXPERIENCE REBUILD — behaviour of the page the seeker actually sees.
 *
 * The three bugs this file exists to pin down were all found by looking at the
 * running app, not by reading the code:
 *
 *  1. `parseExperienceQuery` was fed a full location path, so every segment in
 *     the URL resolved to null and the page fell back to the default segment.
 *     /seeker?segment=relationship-advisor rendered Autism.
 *  2. The mentor error was a STALE SERVER, not a client bug: the routes were
 *     correct but an old `tsx server.ts` process served the SPA HTML for the
 *     new endpoints, and the client reported that as "Unable to load mentors".
 *  3. `isSafeSegmentUrl` only accepted absolute http(s) URLs, so a CTA pointing
 *     at `/mentors` was dropped during normalization and NO button rendered.
 *
 * The pure logic is asserted directly. The wiring is asserted at source level,
 * which is how the existing suite catches the regressions that only show up
 * once the pieces are assembled.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ALL_TOPICS,
  buildExperienceQuery,
  parseExperienceQuery,
} from '../src/lib/segmentTopics';
import {
  isSafeSegmentLink,
  isSafeSegmentUrl,
  normalizeSegmentExperience,
  sanitizeSegmentIcon,
  isSegmentSectionEnabled,
  type SegmentExperienceConfig,
} from '../src/lib/segmentExperience';
import { deriveSegmentTheme } from '../src/lib/segmentTheme';

const readSource = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');
/** Strip comments so a mention in prose cannot mask or fake a violation. */
const code = (relative: string) =>
  readSource(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const HOMEPAGE = 'src/pages/seeker/SeekerHomePage.tsx';
const RENDERER = 'src/components/seeker/SegmentExperienceRenderer.tsx';
const PAGE = 'src/components/seeker/SegmentExperiencePage.tsx';
const GRID = 'src/components/seeker/SegmentMentorGrid.tsx';
const TOPIC_BAR = 'src/components/seeker/SegmentTopicBar.tsx';
const CARD = 'src/components/seeker/SegmentMentorCard.tsx';
const HOOK = 'src/hooks/useSegmentMentorsByTopic.ts';
const TOPICS_HOOK = 'src/hooks/useSegmentTopics.ts';
const DATA = 'src/lib/segmentTopics.ts';
const THEME_CONTEXT = 'src/context/SegmentThemeContext.tsx';

/** Every segment the seeded marketplace actually contains. */
const SEED_SLUGS = ['autism-mentor', 'relationship-advisor', 'career-mentor'] as const;

// ---------------------------------------------------------------------------
// 1-3. The URL segment decides everything
// ---------------------------------------------------------------------------

describe('the URL segment is the only source of segment state', () => {
  it('resolves each seeded segment from its own URL', () => {
    const segments = [
      { id: '1', slug: 'autism-mentor' },
      { id: '2', slug: 'relationship-advisor' },
      { id: '3', slug: 'career-mentor' },
    ];

    for (const seg of segments) {
      const { segment } = parseExperienceQuery(`/seeker?segment=${seg.slug}`);
      const match = segments.find((s) => s.slug === segment);
      assert.ok(match, `${seg.slug} must resolve from the URL`);
      assert.equal(match.id, seg.id, `${seg.slug} must resolve to its own row`);
    }
  });

  it('derives the config, topic and mentor query from that one slug', () => {
    // The experience provider, the topic hook and the mentor hook are all
    // driven by the same resolved segment, never by a second independent state.
    const page = code(HOMEPAGE);
    assert.match(page, /parseExperienceQuery\(currentPath\)/);
    assert.match(page, /slug=\{selectedSegment\?\.slug \?\? null\}/);
    assert.match(page, /segment=\{activeSegment\}/);

    const experience = code(PAGE);
    assert.match(experience, /useSegmentTopics\(segmentId, segmentSlug\)/);
    assert.match(experience, /useSegmentMentorsByTopic\(segmentSlug, selectedTopic, selectedDate\)/);
  });

  it('resets the topic to "all" whenever the segment changes', () => {
    // A topic belongs to exactly one segment, so carrying it across would
    // filter the new segment by a topic it does not own.
    const page = code(HOMEPAGE);
    assert.match(
      page,
      /navigate\(`\/seeker\$\{buildExperienceQuery\(segment\.slug, ALL_TOPICS\)\}`\)/,
      'switching segment must navigate with ALL_TOPICS',
    );
  });

  it('writes the selected topic into the URL without a reload', () => {
    assert.equal(
      buildExperienceQuery('career-mentor', 'salary-negotiation'),
      '?segment=career-mentor&topic=salary-negotiation',
    );
    // "All" is the empty selection, so the parameter is simply absent.
    assert.equal(buildExperienceQuery('career-mentor', ALL_TOPICS), '?segment=career-mentor');

    // Navigation is a pushState, never a location assignment.
    const nav = code('src/context/NavigationContext.tsx');
    assert.match(nav, /history\.pushState/);
    assert.doesNotMatch(nav, /location\.(href|assign|replace)\s*=/);
  });

  it('has no segment-specific branch in the seeker tree', () => {
    for (const file of [HOMEPAGE, PAGE, RENDERER, GRID, CARD, TOPIC_BAR]) {
      const src = code(file);
      for (const slug of SEED_SLUGS) {
        assert.ok(
          !src.includes(slug),
          `${file} must not mention ${slug}: a new segment has to work with no code change`,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Topic filtering is a database join
// ---------------------------------------------------------------------------

describe('topic filtering happens server-side', () => {
  it('sends the topic as a query parameter to the marketplace endpoint', () => {
    const data = code(DATA);
    assert.match(data, /\/api\/seeker\/segments\/\$\{encodeURIComponent\(segmentSlug\)\}\/mentors/);
    assert.match(data, /params\.set\('topic', options\.topicSlug\)/);
  });

  it('never filters an already-fetched mentor list in the browser', () => {
    const hook = code(HOOK);
    // The hook stores exactly what the endpoint returned.
    assert.match(hook, /setMentors\(rows\)/);
    // No .filter on the mentor array after a fetch.
    assert.doesNotMatch(hook, /mentors\.filter|\.filter\(\(?m\)?\s*=>\s*m\./);
  });

  it('scopes the topic to the segment, so a foreign topic yields nothing', () => {
    const server = code('server.ts');
    assert.match(server, /\.eq\('segment_id', segment\.id\)/);
    assert.match(server, /findGigIdsForTopic/);
  });
});

// ---------------------------------------------------------------------------
// 5-6. Loading / empty / error are three different states
// ---------------------------------------------------------------------------

describe('the marketplace distinguishes loading, empty and failure', () => {
  it('renders skeleton cards while loading', () => {
    const grid = code(GRID);
    assert.match(grid, /if \(isLoading\)[\s\S]*CardSkeleton/);
    assert.match(grid, /aria-busy="true"/);
  });

  it('renders a distinct empty state, worded differently per topic', () => {
    const grid = code(GRID);
    assert.match(grid, /No mentors found for this topic yet/);
    assert.match(grid, /No mentors available yet/);
  });

  it('renders an error with a retry, never an empty grid', () => {
    const grid = code(GRID);
    assert.match(grid, /if \(error\)[\s\S]*role="alert"[\s\S]*onClick=\{onRetry\}/);
    // An error is checked BEFORE the empty branch, so a failure can never be
    // rendered as "0 mentors".
    assert.ok(grid.indexOf('if (error)') < grid.indexOf('if (mentors.length === 0)'));
  });

  it('retries the same request rather than navigating or mutating state', () => {
    const hook = code(HOOK);
    assert.match(hook, /const reload = useCallback\(\(\) => setReloadToken\(\(t\) => t \+ 1\)/);
    // The retry token is a dependency of the fetching effect, so a retry re-runs
    // exactly the same request for the same segment/topic/date.
    assert.match(hook, /\}, \[segmentSlug, topicSlug, dateStr, reloadToken\]\)/);

    const page = code(PAGE);
    assert.match(page, /onRetry=\{reloadMentors\}/);
  });

  it('reports a failure as a failure, never as zero results', () => {
    const hook = code(HOOK);
    assert.match(hook, /setError\('Unable to load mentors right now\.'\)/);
  });
});

// ---------------------------------------------------------------------------
// 7-8. The hero is configured, never hardcoded
// ---------------------------------------------------------------------------

describe('the hero is driven by configuration', () => {
  it('takes its image from branding.heroImageUrl', () => {
    const renderer = code(RENDERER);
    assert.match(renderer, /branding\.heroImageUrl/);
    assert.match(renderer, /isSafeSegmentUrl\(branding\.heroImageUrl\)/);
  });

  it('never invents an image URL when none is configured', () => {
    const renderer = code(RENDERER);
    // A single source for the URL: the config. No literal, no per-segment map.
    assert.doesNotMatch(renderer, /https?:\/\/[^'"`]*\.(png|jpe?g|webp|svg)/i);
    for (const slug of SEED_SLUGS) assert.ok(!renderer.includes(slug));
  });

  it('has a deliberate fallback rather than a broken image or an empty box', () => {
    // The fallback is a CSS composition on the media panel, not an <img>.
    const css = code('src/index.css');
    assert.match(css, /\.sk-hero-media::after/);
    assert.match(css, /\.sk-hero-media \{/);
  });

  it('uses a real image only when the URL is a safe http(s) URL', () => {
    for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAA', '//evil.example/x.png']) {
      assert.equal(isSafeSegmentUrl(bad), false, `${bad} must be refused as an image`);
    }
    assert.equal(isSafeSegmentUrl('https://cdn.example/hero.png'), true);
  });
});

// ---------------------------------------------------------------------------
// 9-10. Nothing is fabricated
// ---------------------------------------------------------------------------

describe('the renderer never invents content', () => {
  const config: SegmentExperienceConfig = { guides: [], stories: [] };

  it('drops a guide that has no title and a story that has no name', () => {
    const normalized = normalizeSegmentExperience({
      guides: [{ title: '  ' }, { title: 'Real guide' }],
      stories: [{ quote: 'Great', name: '' }, { quote: 'Real', name: 'A person' }],
    });
    assert.equal(normalized.guides?.length, 1);
    assert.equal(normalized.stories?.length, 1);
    // An empty array normalizes away entirely, so the section is hidden.
    assert.equal(normalizeSegmentExperience(config).guides, undefined);
    assert.equal(normalizeSegmentExperience(config).stories, undefined);
  });

  it('hides both sections when nothing is configured', () => {
    const renderer = code(RENDERER);
    assert.match(renderer, /const Guides[\s\S]*if \(guides\.length === 0\) return null/);
    assert.match(renderer, /const Stories[\s\S]*if \(stories\.length === 0\) return null/);
    // A mentor is a person to book, never turned into a story or a guide.
    assert.doesNotMatch(renderer, /config\.mentors|mentors\.map\(.*(?:story|guide)/i);
  });

  it('never turns mentor data into social proof on the card', () => {
    const card = code(CARD);
    // A rating row is conditional on real reviews existing.
    assert.match(card, /const hasRating = Number\(mentor\.review_count\) > 0/);
    assert.match(card, /\{hasRating &&/);
  });

  it('only renders icons that exist in the registry', () => {
    assert.equal(sanitizeSegmentIcon('briefcase'), 'briefcase');
    assert.equal(sanitizeSegmentIcon('NotAnIcon'), undefined);
    assert.equal(sanitizeSegmentIcon('<img onerror=alert(1)>'), undefined);
    // The renderer resolves through the registry, never from a component name.
    const renderer = code(RENDERER);
    assert.match(renderer, /resolveSegmentIcon\(/);
    assert.doesNotMatch(renderer, /item\.icon\]/);
  });
});

// ---------------------------------------------------------------------------
// 11. The CTA contract
// ---------------------------------------------------------------------------

describe('the CTA uses title / description / buttonText / buttonUrl', () => {
  it('never treats the button label as the heading', () => {
    const cta = normalizeSegmentExperience({
      cta: { title: 'One session before your next move', buttonText: 'See career mentors', buttonUrl: '/mentors' },
    }).cta;
    assert.equal(cta?.title, 'One session before your next move');
    assert.equal(cta?.buttonText, 'See career mentors');
    assert.equal(cta?.buttonUrl, '/mentors');
  });

  it('still accepts the legacy { text, url } pair, mapped the right way round', () => {
    const cta = normalizeSegmentExperience({ cta: { text: 'Get started', url: '/mentors' } }).cta;
    assert.equal(cta?.buttonText, 'Get started');
    assert.equal(cta?.buttonUrl, '/mentors');
    assert.equal(cta?.title, undefined, 'a button label must never become a heading');
  });

  it('keeps an internal destination', () => {
    // Regression: the image rule rejects relative paths, so applying it to a
    // CTA silently removed every "See X mentors" button.
    assert.equal(isSafeSegmentLink('/mentors'), true);
    assert.equal(isSafeSegmentLink('/seeker/bookings'), true);
    assert.equal(isSafeSegmentUrl('/mentors'), false, 'the image rule stays strict');
  });

  it('still refuses anything that could escape the application', () => {
    for (const bad of ['//evil.example/x', 'javascript:alert(1)', 'data:text/html,x', '', '   ']) {
      assert.equal(isSafeSegmentLink(bad), false, `${bad} must be refused`);
    }
  });
});

// ---------------------------------------------------------------------------
// 12. Theme comes from config, for a segment that does not exist yet
// ---------------------------------------------------------------------------

describe('the segment theme is derived from configuration', () => {
  it('derives a complete palette from a config with a single accent', () => {
    const theme = deriveSegmentTheme({ branding: { accent: '#0d9488' } }, 'light');
    assert.equal(theme.accent, '#0d9488');
    assert.equal(theme.isConfigDriven, true);
    for (const value of Object.values(theme.variables)) {
      assert.ok(typeof value === 'string' && value.length > 0);
    }
  });

  it('works for a brand-new segment that no code has ever heard of', () => {
    // No slug parameter exists, so this cannot be a lookup table.
    const theme = deriveSegmentTheme({ branding: { accent: '#c2410c' } }, 'light');
    assert.equal(theme.accent, '#c2410c');
    // A different accent, a different palette - with zero code changes.
    assert.notEqual(theme.variables['--segment-accent'], deriveSegmentTheme(null, 'light').variables['--segment-accent']);
  });

  it('falls back to the brand palette for an unconfigured segment', () => {
    const theme = deriveSegmentTheme({}, 'dark');
    assert.equal(theme.isConfigDriven, false);
    assert.ok(theme.variables['--segment-accent']);
  });

  it('refuses a colour that is not a plain hex triplet', () => {
    const theme = deriveSegmentTheme(
      { branding: { accent: 'red; background: url(javascript:alert(1))' } as never },
      'light',
    );
    assert.equal(theme.isConfigDriven, false);
  });

  it('re-derives the palette when the colour mode changes', () => {
    // The inline custom properties win over the stylesheet's dark rules, so a
    // theme toggle has to re-derive them or the accent stays in light mode.
    assert.match(code(THEME_CONTEXT), /MutationObserver/);
  });
});

// ---------------------------------------------------------------------------
// The card hands off to the existing booking flow
// ---------------------------------------------------------------------------

describe('a mentor card links into the existing booking flow', () => {
  it('uses the parameter names the detail page actually reads', () => {
    // Regression: the card sent `segment=`, which SeekerMentorDetailPage does
    // not read (it reads `segmentSlug`/`segmentId`), so every "Book session"
    // button landed on "Mentor not found".
    const card = code(CARD);
    assert.match(card, /segmentSlug: mentor\.segment\?\.slug/);
    assert.doesNotMatch(card, /[?&]segment: mentor/);

    const detail = code('src/pages/seeker/SeekerMentorDetailPage.tsx');
    assert.match(detail, /searchParams\.get\('segmentSlug'\)/);
  });

  it('reuses the existing detail route rather than a booking shortcut', () => {
    const card = code(CARD);
    assert.match(card, /\/seeker\/mentor-detail\?/);
    // No availability, hold, slot or payment logic leaks into the card.
    assert.doesNotMatch(card, /slot_holds|createBookingHold|payment/i);
  });
});

// ---------------------------------------------------------------------------
// Section visibility and the topic bar
// ---------------------------------------------------------------------------

describe('sections and topics stay configuration-driven', () => {
  it('treats an absent section toggle as enabled', () => {
    assert.equal(isSegmentSectionEnabled(undefined, 'hero'), true);
    assert.equal(isSegmentSectionEnabled({}, 'hero'), true);
    assert.equal(isSegmentSectionEnabled({ hero: { enabled: false } }, 'hero'), false);
  });

  it('always offers "All", and offers nothing that is not active', () => {
    const bar = code(TOPIC_BAR);
    assert.match(bar, /onSelect\(ALL_TOPICS\)/);
    assert.match(bar, /aria-pressed=\{selectedSlug === ALL_TOPICS\}/);
    // A segment with no topics renders "All" alone rather than invented chips.
    assert.match(bar, /const hasTopics = topics\.length > 0/);
  });

  it('scrolls the rail instead of overflowing the page', () => {
    const css = code('src/index.css');
    assert.match(css, /\.sk-topic-rail \{[^}]*overflow-x: auto/s);
  });

  it('never re-fetches on a timer', () => {
    for (const file of [HOOK, TOPICS_HOOK]) {
      const src = code(file);
      assert.doesNotMatch(src, /setInterval/, `${file} must not poll`);
      assert.doesNotMatch(src, /setTimeout\(/, `${file} must not schedule a re-fetch`);
    }
  });
});
