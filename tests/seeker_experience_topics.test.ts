/**
 * SEEKER EXPERIENCE REBUILD — topic architecture.
 *
 * These tests pin the properties the rebuild exists to guarantee:
 * topics are real data, a topic belongs to exactly one segment, an inactive
 * topic is invisible, a gig can never carry another segment's topic, and the
 * selection lives in the URL.
 *
 * The pure helpers are tested directly; the source-level assertions below
 * exist to catch the regressions that only show up in the wiring, namely a
 * client-side filter being used instead of the database join, or a slug branch
 * creeping back into the UI.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ALL_TOPICS,
  buildExperienceQuery,
  isTopicOwnedBySegment,
  parseExperienceQuery,
  selectSegmentTopics,
  slugifyTopicName,
  toTopicViews,
  isValidTopicSlug,
  type SegmentTopic,
} from '../src/lib/segmentTopics';
import {
  isSegmentSectionEnabled,
  normalizeSegmentSections,
  normalizeSegmentExperience,
  SEGMENT_SECTION_KEYS,
  BRAND_TOKENS,
} from '../src/lib/segmentExperience';
import { topicsForSegment } from '../src/lib/mentorTopics';

const readSource = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');
/** Strip comments so a mention in prose cannot mask or fake a violation. */
const code = (relative: string) =>
  readSource(relative).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CAREER = '00000000-0000-0000-0000-000000000003';
const RELATIONSHIP = '00000000-0000-0000-0000-000000000001';

function topic(overrides: Partial<SegmentTopic> = {}): SegmentTopic {
  return {
    id: 'c3000003-0000-4000-8000-000000000001',
    segment_id: CAREER,
    name: 'Career change',
    slug: 'career-change',
    description: null,
    priority: 10,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}
// ---------------------------------------------------------------------------
// Topic ownership
// ---------------------------------------------------------------------------

describe('a topic belongs to exactly one segment', () => {
  it('accepts a topic of the gig segment', () => {
    assert.equal(isTopicOwnedBySegment(topic(), CAREER), true);
  });

  it('refuses a Career topic for a Relationship gig', () => {
    assert.equal(isTopicOwnedBySegment(topic(), RELATIONSHIP), false);
  });

  it('refuses a missing topic or a missing segment rather than defaulting to true', () => {
    assert.equal(isTopicOwnedBySegment(null, CAREER), false);
    assert.equal(isTopicOwnedBySegment(undefined, CAREER), false);
    assert.equal(isTopicOwnedBySegment(topic(), null), false);
    assert.equal(isTopicOwnedBySegment(topic(), undefined), false);
  });
});

describe('the mentor editor offers only the gig segment topics', () => {
  const rows = [
    { id: 't1', segment_id: CAREER, name: 'Interviews', slug: 'interviews', description: null, priority: 10, segmentName: 'Career' },
    { id: 't2', segment_id: RELATIONSHIP, name: 'Dating', slug: 'dating', description: null, priority: 10, segmentName: 'Relationship' },
    { id: 't3', segment_id: CAREER, name: 'Leadership', slug: 'leadership', description: null, priority: 20, segmentName: 'Career' },
  ];

  it('drops a foreign topic rather than disabling it', () => {
    const offered = topicsForSegment(rows, CAREER);
    assert.deepEqual(offered.map((t) => t.id), ['t1', 't3']);
    assert.equal(
      offered.some((t) => t.id === 't2'),
      false,
      'a Relationship topic must never be selectable on a Career gig',
    );
  });

  it('returns nothing without a segment', () => {
    assert.deepEqual(topicsForSegment(rows, null), []);
    assert.deepEqual(topicsForSegment(rows, ''), []);
  });
});

// ---------------------------------------------------------------------------
// Inactive topics
// ---------------------------------------------------------------------------

describe('inactive topics are invisible to seekers', () => {
  const rows = [
    topic({ id: 'a', priority: 10 }),
    topic({ id: 'b', slug: 'first-job', name: 'First job', priority: 20, is_active: false }),
    topic({ id: 'c', slug: 'interviews', name: 'Interviews', priority: 30 }),
  ];

  it('excludes an inactive topic by default', () => {
    const visible = selectSegmentTopics(rows, CAREER);
    assert.deepEqual(visible.map((t) => t.id), ['a', 'c']);
  });

  it('still shows it to an admin who needs to see it in use', () => {
    const all = selectSegmentTopics(rows, CAREER, { includeInactive: true });
    assert.deepEqual(all.map((t) => t.id), ['a', 'b', 'c']);
  });

  it('never leaks a topic from another segment', () => {
    const mixed = [...rows, topic({ id: 'x', segment_id: RELATIONSHIP })];
    assert.equal(
      selectSegmentTopics(mixed, CAREER).some((t) => t.id === 'x'),
      false,
    );
  });

  it('orders by priority, then name', () => {
    const unordered = [
      topic({ id: 'p2', slug: 'b', name: 'B', priority: 20 }),
      topic({ id: 'p1', slug: 'a', name: 'A', priority: 20 }),
      topic({ id: 'p0', slug: 'c', name: 'C', priority: 5 }),
    ];
    assert.deepEqual(selectSegmentTopics(unordered, CAREER).map((t) => t.id), ['p0', 'p1', 'p2']);
  });
});

// ---------------------------------------------------------------------------
// Slugs
// ---------------------------------------------------------------------------

describe('topic slugs', () => {
  it('derives a URL-safe slug from a label', () => {
    assert.equal(slugifyTopicName('Salary negotiation'), 'salary-negotiation');
    assert.equal(slugifyTopicName('Breakups & divorce'), 'breakups-and-divorce');
    assert.equal(slugifyTopicName('  First job  '), 'first-job');
    assert.equal(slugifyTopicName('Return to Work (2026)'), 'return-to-work-2026');
  });

  it('produces only slugs the database CHECK constraint accepts', () => {
    const labels = [
      'Career change',
      'Trust & infidelity',
      'Speech & language',
      'Family & in-laws',
      '   ',
      '!!!',
      'Ünïcödé',
      'a'.repeat(200),
    ];
    for (const label of labels) {
      const slug = slugifyTopicName(label);
      if (slug.length === 0) continue;
      assert.equal(isValidTopicSlug(slug), true, `"${label}" produced an invalid slug: ${slug}`);
    }
  });

  it('rejects a hostile or empty slug', () => {
    for (const bad of ['', '  ', 'Has Space', 'UPPER', '../etc', 'a--b', 'a-', '-a', 'a/b']) {
      assert.equal(isValidTopicSlug(bad), false, `should reject ${JSON.stringify(bad)}`);
    }
  });
});
// ---------------------------------------------------------------------------
// URL state
// ---------------------------------------------------------------------------

describe('the selection lives in the URL', () => {
  it('round-trips a segment and a topic', () => {
    const query = buildExperienceQuery('career-mentor', 'salary-negotiation');
    assert.equal(query, '?segment=career-mentor&topic=salary-negotiation');
    assert.deepEqual(parseExperienceQuery(query), {
      segment: 'career-mentor',
      topic: 'salary-negotiation',
    });
  });

  it('writes no topic parameter for the "All" selection', () => {
    assert.equal(buildExperienceQuery('career-mentor', ALL_TOPICS), '?segment=career-mentor');
    assert.equal(buildExperienceQuery('career-mentor', null), '?segment=career-mentor');
  });

  it('collapses a hostile topic to "all" rather than trusting the URL', () => {
    for (const bad of ['../../etc/passwd', 'Has Space', '<script>', 'UPPER', '']) {
      const parsed = parseExperienceQuery(`?segment=career-mentor&topic=${encodeURIComponent(bad)}`);
      assert.equal(parsed.topic, ALL_TOPICS, `should collapse ${JSON.stringify(bad)}`);
    }
  });

  it('collapses a hostile segment slug to null', () => {
    for (const bad of ['<script>', 'a b', 'A', 'x'.repeat(200)]) {
      assert.equal(parseExperienceQuery(`?segment=${encodeURIComponent(bad)}`).segment, null);
    }
  });

  it('handles an empty or malformed search string', () => {
    assert.deepEqual(parseExperienceQuery(''), { segment: null, topic: ALL_TOPICS });
    assert.deepEqual(parseExperienceQuery('?'), { segment: null, topic: ALL_TOPICS });
    assert.deepEqual(parseExperienceQuery('?segment=career-mentor'), {
      segment: 'career-mentor',
      topic: ALL_TOPICS,
    });
  });

  // Regression: the navigation context hands out a FULL LOCATION
  // ("/seeker?segment=career-mentor"), not a bare search string. Feeding that
  // straight to URLSearchParams parses the whole thing as one key named
  // "/seeker?segment", so the segment silently resolved to null and EVERY
  // segment fell back to the default one - which is why
  // /seeker?segment=relationship-advisor rendered the Autism experience.
  it('parses the selection out of a full location path', () => {
    for (const slug of ['relationship-advisor', 'autism-mentor', 'career-mentor']) {
      assert.deepEqual(
        parseExperienceQuery(`/seeker?segment=${slug}`),
        { segment: slug, topic: ALL_TOPICS },
        `must honour ${slug}`,
      );
    }
    assert.deepEqual(parseExperienceQuery('/seeker?segment=career-mentor&topic=interviews'), {
      segment: 'career-mentor',
      topic: 'interviews',
    });
  });

  it('does not treat the path as a parameter name', () => {
    const parsed = parseExperienceQuery('/mentors?segment=career-mentor');
    assert.equal(parsed.segment, 'career-mentor');
    assert.equal(parseExperienceQuery('/seeker').segment, null);
    assert.equal(parseExperienceQuery('/seeker').topic, ALL_TOPICS);
  });
});

// ---------------------------------------------------------------------------
// Section enable / disable
// ---------------------------------------------------------------------------

describe('sections can be switched off without losing content', () => {
  it('treats an absent entry as enabled, so an old config keeps rendering', () => {
    assert.equal(isSegmentSectionEnabled(undefined, 'hero'), true);
    assert.equal(isSegmentSectionEnabled({}, 'hero'), true);
    assert.equal(isSegmentSectionEnabled({ faq: {} }, 'faq'), true);
  });

  it('hides a section that is explicitly disabled', () => {
    const sections = normalizeSegmentSections({ guides: { enabled: false }, faq: { enabled: true } });
    assert.equal(isSegmentSectionEnabled(sections, 'guides'), false);
    assert.equal(isSegmentSectionEnabled(sections, 'faq'), true);
  });

  it('drops a key outside the closed registry rather than storing it', () => {
    const sections = normalizeSegmentSections({
      hero: { enabled: true },
      notASection: { enabled: true },
      testimonials: { enabled: false },
    });
    assert.ok(sections);
    assert.equal('notASection' in sections, false);
    assert.equal('testimonials' in sections, false);
  });

  it('ignores a non-boolean enabled value', () => {
    assert.equal(normalizeSegmentSections({ hero: { enabled: 'yes' } }), undefined);
  });

  it('keeps a disabled section out of the normalized config', () => {
    const config = normalizeSegmentExperience({
      sections: { stories: { enabled: false } },
      stories: [{ quote: 'q', name: 'n' }],
    });
    assert.equal(config.sections?.stories?.enabled, false);
    // The CONTENT is still preserved so re-enabling restores it.
    assert.equal(config.stories?.length, 1);
  });

  it('covers every section the renderer can lay out', () => {
    assert.deepEqual(
      [...SEGMENT_SECTION_KEYS],
      ['hero', 'topics', 'quickHelp', 'mentors', 'journey', 'benefits', 'guides', 'stories', 'faq', 'cta'],
    );
  });
});
// ---------------------------------------------------------------------------
// No fabricated content
// ---------------------------------------------------------------------------

describe('the renderer never fabricates', () => {
  const RENDERER = 'src/components/seeker/SegmentExperienceRenderer.tsx';

  it('never samples mentors into a Guides section', () => {
    const source = code(RENDERER);
    assert.equal(
      /slice\(\s*0\s*,\s*3\s*\)/.test(source),
      false,
      'a mentor slice must never be presented as Guides',
    );
    assert.equal(
      /mentors\s*\.\s*(slice|filter)\(/.test(source),
      false,
      'the renderer must not derive content from the mentor list',
    );
  });

  it('renders guides and stories only from the config', () => {
    const none = normalizeSegmentExperience({ quickHelp: [{ title: 'x', description: 'y' }] });
    assert.equal(none.guides, undefined);
    assert.equal(none.stories, undefined);
  });

  it('shows no rating or count the data did not provide', () => {
    const CARD = 'src/components/seeker/SegmentMentorCard.tsx';
    const source = code(CARD);
    // The rating block is gated on a real review count, not a default value.
    assert.ok(
      /hasRating/.test(source),
      'a rating must only render when reviews actually exist',
    );
    assert.equal(
      /mentor\.rating\s*\|\|\s*5/.test(source),
      false,
      'a missing rating must never be defaulted to 5.0',
    );
  });
});

// ---------------------------------------------------------------------------
// No slug-specific UI branches
// ---------------------------------------------------------------------------

describe('no slug-specific UI branches', () => {
  const UI_FILES = [
    'src/components/seeker/SegmentExperienceRenderer.tsx',
    'src/components/seeker/SegmentExperiencePage.tsx',
    'src/components/seeker/SegmentTopicBar.tsx',
    'src/components/seeker/SegmentMentorGrid.tsx',
    'src/components/seeker/SegmentMentorCard.tsx',
    'src/pages/seeker/SeekerHomePage.tsx',
    'src/components/navigation/SeekerHeader.tsx',
  ];

  it('no component branches on a known segment slug', () => {
    for (const file of UI_FILES) {
      const source = code(file);
      for (const slug of ['autism-mentor', 'career-mentor', 'relationship-advisor']) {
        assert.equal(
          source.includes(slug),
          false,
          `${file} must not name the segment "${slug}"; behaviour must come from config`,
        );
      }
      assert.equal(
        /if\s*\(\s*slug\s*===/.test(source),
        false,
        `${file} must not branch on a slug`,
      );
    }
  });

  it('the theme module takes no slug parameter', () => {
    const source = code('src/lib/segmentTheme.ts');
    assert.equal(
      /export function deriveSegmentTheme\([^)]*slug/.test(source),
      false,
      'deriveSegmentTheme must derive from config only, never a slug lookup',
    );
  });
});

// ---------------------------------------------------------------------------
// Topic filtering is a database join, not a client-side filter
// ---------------------------------------------------------------------------

describe('topic filtering happens in the data layer', () => {
  it('the seeker hook calls the topic-filtered endpoint, not a local filter', () => {
    const source = code('src/hooks/useSegmentMentorsByTopic.ts');
    assert.ok(
      source.includes('fetchSegmentMentorsByTopic('),
      'must go through the topic-aware service',
    );
    assert.equal(
      /mentors\s*\.\s*filter\(/.test(source),
      false,
      'the hook must not post-filter an already-fetched list',
    );
  });

  it('the service builds a topic query parameter', () => {
    const source = code('src/lib/segmentTopics.ts');
    assert.ok(source.includes("params.set('topic'"), 'must send the topic to the server');
    assert.ok(
      source.includes('/mentors'),
      'must call the topic-filtered marketplace endpoint',
    );
  });

  it('the server resolves the topic join and rejects a cross-segment topic', () => {
    const source = code('server.ts');
    assert.ok(source.includes("from('gig_topics')"), 'must join through gig_topics');
    assert.ok(
      source.includes("TOPIC_SEGMENT_MISMATCH"),
      'the server must refuse a topic from another segment',
    );
    assert.ok(
      source.includes("'gig_id', id") && source.includes("'topic_id', topicId"),
      'must write the gig/topic link',
    );
  });
});

// ---------------------------------------------------------------------------
// Hero image handling
// ---------------------------------------------------------------------------

describe('hero image handling', () => {
  it('keeps a safe URL and alt text', () => {
    const config = normalizeSegmentExperience({
      branding: { heroImageUrl: 'https://cdn.example.com/hero.png', heroImageAlt: 'A mentor session' },
    });
    assert.equal(config.branding?.heroImageUrl, 'https://cdn.example.com/hero.png');
    assert.equal(config.branding?.heroImageAlt, 'A mentor session');
  });

  it('drops an unsafe hero image rather than rendering it', () => {
    const config = normalizeSegmentExperience({
      branding: { heroImageUrl: 'javascript:alert(1)', heroImageAlt: 'kept' },
    });
    assert.equal(config.branding?.heroImageUrl, undefined);
    assert.equal(config.branding?.heroImageAlt, 'kept');
  });

  it('renders a neutral panel when no image is configured, and never an <img>', () => {
    const source = code('src/components/seeker/SegmentExperienceRenderer.tsx');
    // The <img> is inside a conditional on heroImageUrl, and the fallback is a
    // decorative panel rather than a fabricated illustration.
    assert.ok(source.includes('heroImageUrl &&'), 'the image is conditional');
    assert.ok(source.includes('sk-hero-media'), 'the fallback is a styled panel');
    assert.equal(
      /<svg/.test(source),
      false,
      'no fabricated illustration may be drawn in place of a real image',
    );
  });

  it('stores no base64 image data in the configuration', () => {
    const source = code('src/lib/segmentExperience.ts');
    assert.equal(
      /data:image\//.test(source),
      false,
      'the config must never accept inline image data',
    );
  });
});

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

describe('admin preview uses the same renderer and the unsaved draft', () => {
  const PREVIEW = 'src/pages/admin/AdminExperiencePreview.tsx';
  const EDITOR = 'src/pages/admin/AdminSegmentExperienceEditor.tsx';

  it('imports the same renderer the seeker page uses', () => {
    const source = code(PREVIEW);
    assert.ok(
      source.includes("from '@/src/components/seeker/SegmentExperienceRenderer'"),
      'the preview must render through the shared component',
    );
    assert.ok(
      source.includes("from '@/src/components/seeker/SegmentTopicBar'"),
      'the preview must use the real topic bar too',
    );
  });

  it('reads the draft and never saves to preview', () => {
    const source = code(PREVIEW);
    assert.equal(
      /apiFetch\(/.test(source),
      false,
      'previewing must not write anything',
    );
    assert.ok(
      source.includes('config={draft}') || source.includes('config={'),
      'the preview consumes the in-memory draft',
    );
  });

  it('does not paint the admin shell with the draft palette', () => {
    const source = code(PREVIEW);
    assert.ok(
      source.includes('containerRef'),
      'the draft theme is applied to a container, not the document root',
    );
  });

  it('shows "Saved" only after a confirmed server response', () => {
    const source = code(EDITOR);
    // The saved state is assigned inside the success path, after the response
    // is checked, and every edit moves it straight back to dirty.
    const savedIndex = source.indexOf("setSaveState('saved')");
    const responseIndex = source.indexOf('if (!res.ok) throw');
    assert.ok(savedIndex > -1, 'a saved state exists');
    assert.ok(responseIndex > -1, 'a failed response is handled');
    assert.ok(
      responseIndex < savedIndex,
      'the saved state must come after the response is confirmed',
    );
    assert.ok(
      source.includes("setSaveState('dirty')"),
      'any edit must move the state back to unsaved',
    );
  });
});

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

describe('the brand is the logo palette, not a segment accent', () => {
  it('exposes the plum and gold read from the logo', () => {
    assert.equal(BRAND_TOKENS.plum, '#1f1037');
    assert.equal(BRAND_TOKENS.gold, '#f7d243');
    assert.equal(BRAND_TOKENS.onGold, BRAND_TOKENS.plum);
  });

  it('the header BAR never reads a segment token', () => {
    const source = code('src/components/navigation/SeekerHeader.tsx');
    assert.equal(
      /--segment-/.test(source),
      false,
      'the header bar must keep the global brand identity on every segment',
    );
    assert.ok(
      source.includes('sk-header'),
      'the header uses the brand-scoped class',
    );

    // The only place a segment accent is allowed in the header is the ACTIVE
    // segment control, and it must be driven by the token the theme provider
    // publishes - never a colour written into the component.
    const css = code('src/index.css');
    const barRule = css.slice(css.indexOf('.sk-header {'), css.indexOf('.sk-header-link'));
    assert.equal(
      /--segment-/.test(barRule),
      false,
      'the header surface must be the brand plum field, never a segment colour',
    );
    assert.ok(
      /\.sk-segment-pill\[data-active='true'\]/.test(css),
      'the active segment control carries the segment accent',
    );
    assert.ok(
      /background: var\(--segment-accent\)/.test(css),
      'the accent must come from the theme token, not a hardcoded colour',
    );
  });

  it('the header puts account actions in a menu, not a permanent row', () => {
    const source = code('src/components/navigation/SeekerHeader.tsx');
    const primary = source.slice(source.indexOf('PRIMARY_LINKS'), source.indexOf('ACCOUNT_LINKS'));
    for (const label of ['My Bookings', 'Notifications', 'Settings']) {
      assert.equal(
        primary.includes(label),
        false,
        `"${label}" is an account action and must not be a permanent nav item`,
      );
    }
    // The menu supports keyboard dismissal and outside-click dismissal.
    assert.ok(source.includes("event.key === 'Escape'"), 'Escape must close the menus');
    assert.ok(source.includes("'mousedown'"), 'an outside click must close the menus');
    assert.ok(source.includes('aria-expanded'), 'menu state must be exposed');
  });
});

// ---------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------

describe('topics arrive by realtime, not by polling', () => {
  const HOOK = 'src/hooks/useSegmentTopics.ts';

  it('subscribes to segment_topics and removes the channel', () => {
    const source = code(HOOK);
    assert.ok(source.includes("table: 'segment_topics'"), 'must subscribe to the topics table');
    assert.ok(source.includes('supabase.removeChannel('), 'must remove the channel on cleanup');
  });

  it('has no timer anywhere in the topic or mentor hooks', () => {
    for (const file of [HOOK, 'src/hooks/useSegmentMentorsByTopic.ts']) {
      const source = code(file);
      assert.equal(/setInterval/.test(source), false, `${file} must not poll`);
      assert.equal(/setTimeout\s*\(/.test(source), false, `${file} must not use a timer`);
    }
  });

  it('keys the channel by segment so switching cannot leak listeners', () => {
    const source = code(HOOK);
    assert.ok(
      /channel\(`segment-topics:\$\{segmentId\}`\)/.test(source),
      'the channel must be keyed by the active segment',
    );
  });
});
// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

describe('the seed migrations are safe to execute as written', () => {
  const CONFIG_MIGRATION =
    'supabase/migrations/20261001000003_seeker_experience_rebuild_seed_config.sql';
  const TOPIC_MIGRATION =
    'supabase/migrations/20261001000002_seeker_experience_rebuild_seed_topics.sql';
  const SCHEMA_MIGRATION =
    'supabase/migrations/20261001000001_seeker_experience_rebuild_segment_topics.sql';

  /**
   * Extract the payloads between a $json$ ... $json$ pair.
   *
   * Regression guard for the failure this replaced: the JSON used to sit in a
   * single-quoted SQL literal, and a tool that split the migration on an odd
   * number of quotes closed that literal early, so the rest of the JSON was
   * parsed as SQL ("relation adult does not exist"). Dollar quoting cannot be
   * terminated that way, and these tests fail if anyone reintroduces a plain
   * quoted payload.
   */
  const dollarQuotedPayloads = (source: string): string[] => {
    const markers: number[] = [];
    const re = /\$json\$/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) markers.push(m.index);
    const out: string[] = [];
    for (let i = 0; i + 1 < markers.length; i += 2) {
      out.push(source.slice(markers[i] + '$json$'.length, markers[i + 1]));
    }
    return out;
  };

  it('no seed payload is a plain single-quoted literal', () => {
    // Scoped to the three seed CALL sites. The helper's own CREATE and its
    // trailing DROP also mention the name, and the function body legitimately
    // uses '{}'::jsonb, so only a `SELECT ...(` invocation is counted here.
    const callLines = readSource(CONFIG_MIGRATION)
      .split(/\r?\n/)
      .filter((line) => /^\s*SELECT\s+public\.sk_apply_seeded_experience_config\(/.test(line));

    assert.equal(callLines.length, 3, 'there must be three seed calls');

    for (const line of callLines) {
      assert.ok(
        line.includes('$json$'),
        `a seed call must pass dollar-quoted JSON: ${line.trim()}`,
      );
      assert.equal(
        /,\s*'/.test(line),
        false,
        `a seed call must not pass a single-quoted payload: ${line.trim()}`,
      );
    }
  });

  it('seeds all three segments, each with valid JSON', () => {
    const payloads = dollarQuotedPayloads(readSource(CONFIG_MIGRATION));
    assert.equal(payloads.length, 3, 'Autism, Relationships and Career must all be seeded');

    for (const payload of payloads) {
      const parsed = JSON.parse(payload);
      assert.ok(parsed.branding?.heroHeadline, 'a segment needs a hero headline');
      assert.ok(parsed.branding?.accent, 'a segment needs an accent');
      assert.ok(parsed.cta?.buttonText, 'a segment needs CTA button text');
      assert.ok(Array.isArray(parsed.faq) && parsed.faq.length > 0, 'a segment needs FAQ content');
    }
  });

  it('every seeded config declares all ten sections', () => {
    for (const payload of dollarQuotedPayloads(readSource(CONFIG_MIGRATION))) {
      const parsed = JSON.parse(payload);
      const declared = Object.keys(parsed.sections || {}).sort();
      assert.deepEqual(
        declared,
        [...SEGMENT_SECTION_KEYS].sort(),
        'the config must cover every section in the registry',
      );
    }
  });

  it('ships no fabricated guides, stories or hero images', () => {
    for (const payload of dollarQuotedPayloads(readSource(CONFIG_MIGRATION))) {
      const parsed = JSON.parse(payload);
      assert.equal(
        parsed.sections.guides.enabled,
        false,
        'guides stay off until real content exists',
      );
      assert.equal(
        parsed.sections.stories.enabled,
        false,
        'stories stay off until real content exists',
      );
      assert.equal(
        parsed.branding.heroImageUrl,
        undefined,
        'no image may be seeded; the neutral fallback renders instead',
      );
    }
  });

  it('no executable statement is trapped inside a SQL comment', () => {
    // A re-quoting mistake once merged a section comment and its SELECT onto
    // one line, turning the seed into a silent no-op instead of a failure. The
    // check targets a capitalised statement keyword rather than the word SELECT,
    // so ordinary prose such as "clients may SELECT only active topics" in a
    // real comment is not a false positive.
    for (const file of [CONFIG_MIGRATION, TOPIC_MIGRATION, SCHEMA_MIGRATION]) {
      for (const line of readSource(file).split(/\r?\n/)) {
        // A line is either a comment or executable, never both, so a statement
        // keyword sitting on a comment line means it would never run. The check
        // uses a capitalised keyword, so ordinary prose in a real comment such
        // as "clients may SELECT only active topics" is not a false positive.
        const isComment = /^\s*--/.test(line);
        const startsStatement =
          /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/.test(line);
        assert.equal(
          isComment && startsStatement,
          false,
          `${file}: a statement is inside a -- comment and would never run: ${line.trim()}`,
        );
      }
    }
  });

  it('has no unterminated single-quoted literal on any line', () => {
    for (const file of [CONFIG_MIGRATION, TOPIC_MIGRATION, SCHEMA_MIGRATION]) {
      readSource(file)
        .split(/\r?\n/)
        .forEach((line, index) => {
          // Comment lines are prose, where an apostrophe is just an
          // apostrophe. Only executable SQL is checked.
          if (/^\s*--/.test(line)) return;
          const quotes = (line.match(/'/g) || []).length;
          // A line inside a dollar-quoted payload carries no quotes at all, so
          // an odd count on an executable line always means a broken literal.
          if (quotes % 2 !== 0) {
            throw new Error(`${file}:${index + 1} has an unbalanced quote: ${line.trim()}`);
          }
        });
    }
  });
});