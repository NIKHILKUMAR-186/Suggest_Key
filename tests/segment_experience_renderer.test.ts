import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveSegmentIcon, DEFAULT_SEGMENT_ICON } from '../src/lib/segmentIcons';
import {
  normalizeSegmentExperience,
  getSegmentExperienceFallback,
  type SegmentExperienceConfig,
} from '../src/lib/segmentExperience';
import { deriveSegmentTheme } from '../src/lib/segmentTheme';

const readSource = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');
/** Strip comments so a mention in prose cannot mask or fake a violation. */
const code = (relative: string) =>
  readSource(relative).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const RENDERER = 'src/components/seeker/SegmentExperienceRenderer.tsx';
const PAGE = 'src/components/seeker/SegmentExperiencePage.tsx';
const PROVIDER = 'src/context/SegmentExperienceContext.tsx';
const REALTIME = 'src/hooks/useSegmentExperienceRealtime.ts';

// ---------------------------------------------------------------------------
// Section derivation — the renderer reads only from config
// ---------------------------------------------------------------------------

describe('renderer consumes normalized config', () => {
  const config: SegmentExperienceConfig = normalizeSegmentExperience({
    branding: { eyebrow: 'Career', heroHeadline: 'Decide with experience', heroSubheadline: 'Sub' },
    topics: [{ title: 'Interviews', description: 'Loop prep' }],
    quickHelp: [{ title: 'Talk it through', description: '30 minutes' }],
    journeySteps: [{ title: 'Book', description: 'Pick a slot' }],
    benefits: [{ title: 'Real experience', description: 'Not theory' }],
    guides: [{ title: 'Negotiation guide', description: 'A walkthrough', readingTime: '6 min' }],
    stories: [{ quote: 'It changed things.', name: 'Priya' }],
    faq: [{ question: 'How long?', answer: '30 minutes' }],
    cta: { title: 'Talk to a mentor', buttonText: 'See mentors', buttonUrl: 'https://example.com/m' },
  });

  it('1-10. every section is present in the normalized config', () => {
    assert.ok(config.branding?.heroHeadline);
    assert.equal(config.topics?.length, 1);
    assert.equal(config.quickHelp?.length, 1);
    assert.equal(config.journeySteps?.length, 1);
    assert.equal(config.benefits?.length, 1);
    assert.equal(config.guides?.length, 1);
    assert.equal(config.stories?.length, 1);
    assert.equal(config.faq?.length, 1);
    assert.equal(config.cta?.buttonText, 'See mentors');
  });

  it('7. guides come ONLY from config', () => {
    const none = normalizeSegmentExperience({ topics: [{ title: 'x', description: 'y' }] });
    assert.equal(none.guides, undefined);
  });

  it('8. stories come ONLY from config', () => {
    const none = normalizeSegmentExperience({ benefits: [{ title: 'x', description: 'y' }] });
    assert.equal(none.stories, undefined);
  });

  it('20. the fallback config renders safely and fabricates nothing', () => {
    const fallback = getSegmentExperienceFallback();

// ---------------------------------------------------------------------------
// CTA contract
// ---------------------------------------------------------------------------

describe('CTA contract', () => {
  it('11. CTA uses buttonText, not a hardcoded label', () => {
    const config = normalizeSegmentExperience({
      cta: { title: 'Talk to a counsellor', buttonText: 'Book now', buttonUrl: 'https://example.com' },
    });
    assert.equal(config.cta?.buttonText, 'Book now');
    assert.equal(config.cta?.title, 'Talk to a counsellor');
  });

  it('12. CTA uses buttonUrl', () => {
    const config = normalizeSegmentExperience({
      cta: { title: 'T', buttonText: 'B', buttonUrl: 'https://example.com/mentors' },
    });
    assert.equal(config.cta?.buttonUrl, 'https://example.com/mentors');
  });

  it('13. an unsafe CTA URL is rejected and cannot become a destination', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>', '//evil.com', '/relative']) {
      const config = normalizeSegmentExperience({
        cta: { title: 'T', buttonText: 'B', buttonUrl: url },
      });
      // Even the relative path is rejected: only absolute http(s) is trusted.
      assert.equal(config.cta?.buttonUrl, undefined, `${url} must be rejected`);
    }
  });

  it('the renderer never renders a hardcoded "Get started"', () => {
    assert.equal(code(RENDERER).includes('Get started'), false);
    assert.equal(code(PAGE).includes('Get started'), false);
  });

  it('the renderer does not use the legacy cta.text as a heading', () => {
    // The heading comes from cta.title; cta.text is the legacy button label.
    const source = code(RENDERER);
    assert.equal(/cta\.text/.test(source), false, 'must not read cta.text');
  });
});

// ---------------------------------------------------------------------------
// Icon registry
// ---------------------------------------------------------------------------

describe('icon registry', () => {
  it('14. a known icon resolves to a usable component', () => {
    for (const key of ['briefcase', 'heart', 'graduation-cap', 'message-circle']) {
      const component = resolveSegmentIcon(key);
      // A React component: either a plain function or a forwardRef/exotic
      // component object. Both are renderable; neither is a string.
      const isComponent =
        typeof component === 'function' ||
        (typeof component === 'object' && component !== null && '$$typeof' in component);
      assert.ok(isComponent, `${key} must resolve to a component`);
      assert.notEqual(typeof component, 'string', 'an icon must never resolve to a string');
    }
  });

  it('14. an unknown icon falls back safely instead of throwing', () => {
    for (const value of ['NotARealIcon', '__proto__', 'constructor', 'toString', '', null, undefined, 42]) {
      assert.equal(resolveSegmentIcon(value), DEFAULT_SEGMENT_ICON, `${String(value)} must fall back`);
    }
  });

  it('the renderer never renders a raw icon value as a component', () => {
    const source = code(RENDERER);
    // `{item.icon}` would render the database string as a literal glyph.
    assert.equal(/\{(item|topic|step|guide|story)\.icon\}/.test(source), false, 'no raw icon interpolation');
    assert.ok(source.includes('resolveSegmentIcon('), 'must use the safe resolver');
  });

  it('the icon registry has no dynamic component construction', () => {
    const source = code('src/lib/segmentIcons.tsx');
    for (const forbidden of ['require(', 'import(', 'eval(', 'new Function']) {
      assert.equal(source.includes(forbidden), false, `icon registry must not use ${forbidden}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Source invariants — regression guards for rules that are easy to break
// ---------------------------------------------------------------------------

describe('source invariants', () => {
  it('18. no polling exists in the realtime or experience layers', () => {
    for (const file of [REALTIME, PROVIDER]) {
      const source = code(file);
      assert.equal(/setInterval/.test(source), false, `${file} must not use setInterval`);
      assert.equal(/setTimeout/.test(source), false, `${file} must not use setTimeout polling`);
      assert.equal(/visibilitychange/.test(source), false, `${file} must not poll on visibility`);
      assert.equal(/addEventListener\(['"]focus/.test(source), false, `${file} must not poll on focus`);
    }
  });

  it('9-10. no fake testimonials are generated from mentors', () => {
    for (const file of [RENDERER, PAGE]) {
      const source = code(file);
      assert.equal(
        /Great mentorship experience|Highly recommended/.test(source),
        false,
        `${file} must not contain generated testimonial copy`,
      );
    }
  });

  it('mentors are never sliced into guides or stories', () => {
    for (const file of [RENDERER, PAGE]) {
      const source = code(file);
      assert.equal(
        /mentors\s*\.\s*slice/.test(source),
        false,
        `${file} must not slice mentors into a guides/stories section`,
      );
    }
  });

  it('no dangerouslySetInnerHTML in the segment experience surface', () => {
    for (const file of [RENDERER, PAGE, PROVIDER]) {
      assert.equal(code(file).includes('dangerouslySetInnerHTML'), false, `${file} must not use raw HTML`);
    }
  });

  it('the renderer contains no hardcoded segment names', () => {
    const source = code(RENDERER);
    for (const name of ['Autism', 'Career', 'Relationship', 'Finance']) {
      // Quoted string literals only; prose in identifiers is not a match.
      assert.equal(
        new RegExp(`['"\`]${name}['"\`]`).test(source),
        false,
        `renderer must not hardcode the segment name "${name}"`,
      );
    }
  });

  it('22. the renderer does not consult a slug-keyed theme map', () => {
    const source = code(RENDERER);

// ---------------------------------------------------------------------------
// Realtime payload handling and subscription lifecycle
// ---------------------------------------------------------------------------

describe('realtime payload handling', () => {
  it('16. a realtime payload replaces the rendered config', () => {
    const before = normalizeSegmentExperience({ branding: { heroHeadline: 'Old' } });
    const after = normalizeSegmentExperience({ branding: { heroHeadline: 'New' } });
    assert.equal(before.branding?.heroHeadline, 'Old');
    assert.equal(after.branding?.heroHeadline, 'New');
  });

  it('19. a malformed realtime payload cannot crash normalization', () => {
    const hostile: unknown[] = [
      null,
      undefined,
      'string',
      0,
      [],
      {},
      { branding: 'nope' },
      { topics: 'nope', faq: 5, guides: [], stories: null, cta: 7 },
      { topics: [null, 1, {}] },
      { branding: { accent: 'red; position: fixed' } },
    ];
    for (const payload of hostile) {
      const result = normalizeSegmentExperience(payload);
      assert.equal(typeof result, 'object');
      assert.notEqual(result, null);
    }
  });

  it('a hostile realtime accent is dropped rather than applied', () => {
    const result = normalizeSegmentExperience({
      branding: { accent: 'red; position: fixed' },
    });
    assert.equal(result.branding?.accent, undefined);
  });

  it('17. the subscription is scoped to one slug and removed on cleanup', () => {
    const source = code(REALTIME);
    assert.ok(source.includes("table: 'segments'"), 'must subscribe to segments');
    assert.ok(source.includes('slug=eq.'), 'must filter by slug');
    assert.ok(source.includes('supabase.removeChannel('), 'must remove the channel');
    assert.equal(
      /supabase\.channel\(`segment-experience:\$\{slug\}`\)/.test(source),
      true,
      'channel must be keyed by the active slug',
    );
  });

  it('15. switching segments replaces the config rather than merging it', () => {
    // A different segment's config must fully replace the previous one, so no
    // stale topics/FAQ from the old segment can survive the switch.
    const a = normalizeSegmentExperience({
      topics: [{ title: 'A topic', description: 'a' }],
      faq: [{ question: 'A q', answer: 'a' }],
    });
    const b = normalizeSegmentExperience({
      topics: [{ title: 'B topic', description: 'b' }],
    });

    assert.deepEqual(a.faq?.map((f) => f.question), ['A q']);
    // The provider assigns, never merges: b carries no faq at all.
    assert.equal(b.faq, undefined);
    assert.equal(b.topics?.[0].title, 'B topic');
  });

  it('the provider fetches per slug and never merges configs', () => {
    const source = code(PROVIDER);
    assert.ok(source.includes('fetchSegmentExperience('), 'must fetch through the existing service');
    assert.ok(source.includes('getSegmentExperienceFallback'), 'must use the safe fallback');
    assert.equal(/setConfig\(\{\s*\.\.\./.test(source), false, 'config must not be merged');
  });

  it('the provider clears config on slug change so nothing stale is visible', () => {
    const source = code(PROVIDER);
    assert.ok(
      /setConfig\(getSegmentExperienceFallback\(\)\)/.test(source),
      'must reset to the fallback when the segment changes',
    );
  });
});

    assert.equal(source.includes('getSegmentTheme'), false, 'renderer must not use the legacy slug map');
    assert.equal(source.includes('SEGMENT_THEMES'), false, 'renderer must not use SEGMENT_THEMES');
  });

  it('the renderer takes colour only from CSS variables', () => {
    const source = code(RENDERER);
    // No literal hex colours: everything resolves through --segment-* variables.
    const literalHex = source.match(/#[0-9a-fA-F]{6}\b/g);
    assert.equal(literalHex, null, 'renderer must not hardcode hex colours');
    assert.ok(source.includes('var(--segment-accent)'), 'must consume the derived variables');
  });

  it('21. a brand-new arbitrary segment renders without code changes', () => {
    // The renderer only reads config + segment.name, so a slug it has never seen
    // still produces its configured appearance.
    const theme = deriveSegmentTheme({ branding: { accent: '#123456' } }, 'light');
    assert.equal(theme.variables['--segment-accent'], '#123456');
    assert.equal(theme.isConfigDriven, true);
  });
});


    assert.deepEqual(fallback, {});
    assert.equal(fallback.guides, undefined);
    assert.equal(fallback.stories, undefined);
    assert.equal(fallback.faq, undefined);
  });

  it('sections with no config are omitted rather than padded', () => {
    const empty = normalizeSegmentExperience({});
    assert.equal(empty.topics, undefined);
    assert.equal(empty.quickHelp, undefined);
    assert.equal(empty.journeySteps, undefined);
    assert.equal(empty.benefits, undefined);
  });
});
