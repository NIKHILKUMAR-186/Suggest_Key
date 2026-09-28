import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  normalizeSegmentExperience,
  isSafeHexColor,
  sanitizeSegmentColor,
  isSafeSegmentUrl,
  sanitizeSegmentUrl,
  isSafeSegmentIcon,
  sanitizeSegmentIcon,
  SEGMENT_ICON_KEYS,
  type SegmentExperienceConfig,
} from '../src/lib/segmentExperience';
import { deriveSegmentTheme } from '../src/lib/segmentTheme';

describe('segment experience normalization', () => {
  it('A. does not crash on malformed configuration', () => {
    const hostile: unknown[] = [
      null,
      undefined,
      0,
      '',
      'a string',
      42,
      true,
      [],
      [1, 2, 3],
      { branding: 'not-an-object' },
      { branding: [] },
      { topics: 'nope', quickHelp: 7, faq: {}, guides: null, stories: 9 },
      { topics: [null, undefined, 5, 'x', [], {}] },
      { faq: [null, {}, { question: 'only-q' }, { answer: 'only-a' }] },
      { guides: [null, {}, { title: 5 }] },
      { stories: [null, {}, { quote: 'q' }, { name: 'n' }] },
      { cta: 'nope' },
      { cta: [] },
      { cta: {} },
    ];

    for (const value of hostile) {
      const result = normalizeSegmentExperience(value);
      assert.equal(typeof result, 'object');
      assert.notEqual(result, null);
      // Deterministic: the same input always yields the same output.
      assert.deepEqual(result, normalizeSegmentExperience(value));
    }
  });

  it('A2. returns an empty config for a non-object', () => {
    assert.deepEqual(normalizeSegmentExperience(null), {});
    assert.deepEqual(normalizeSegmentExperience('nope'), {});
    assert.deepEqual(normalizeSegmentExperience(7), {});
  });

  it('B. preserves every supported branding field', () => {
    const config = normalizeSegmentExperience({
      branding: {
        eyebrow: 'Career',
        heroHeadline: 'Stop guessing.',
        heroSubheadline: 'Decide with someone who has done it.',
        accent: '#123456',
        accentSoft: '#abcdef',
        accentSecondary: '#fedcba',
        heroTint: '#0d9488',
        tintColor: '#ff00aa',
        gradientStart: '#111111',
        gradientEnd: '#222222',
        textMode: 'dark',
        heroImageUrl: 'https://cdn.example.com/hero.png',
      },
    });

    assert.deepEqual(config.branding, {
      eyebrow: 'Career',
      heroHeadline: 'Stop guessing.',
      heroSubheadline: 'Decide with someone who has done it.',
      accent: '#123456',
      accentSoft: '#abcdef',
      accentSecondary: '#fedcba',
      heroTint: '#0d9488',
      tintColor: '#ff00aa',
      gradientStart: '#111111',
      gradientEnd: '#222222',
      textMode: 'dark',
      heroImageUrl: 'https://cdn.example.com/hero.png',
    });
  });

  it('B2. keeps branding colours lowercased and trimmed', () => {
    const config = normalizeSegmentExperience({ branding: { accent: '  #AABBCC  ' } });
    assert.equal(config.branding?.accent, '#aabbcc');
  });


  it('C. preserves topics', () => {
    const config = normalizeSegmentExperience({
      topics: [
        { title: 'Career change', description: 'Switching fields', icon: 'briefcase' },
        { title: 'Interviews', description: 'Acing the loop' },
      ],
    });
    assert.equal(config.topics?.length, 2);
    assert.equal(config.topics?.[0].title, 'Career change');
    assert.equal(config.topics?.[0].icon, 'briefcase');
  });

  it('D. preserves quick-help items', () => {
    const config = normalizeSegmentExperience({
      quickHelp: [{ title: 'Talk it through', description: '30 minutes', icon: 'message-circle' }],
    });
    assert.equal(config.quickHelp?.[0].title, 'Talk it through');
    assert.equal(config.quickHelp?.[0].icon, 'message-circle');
  });

  it('E. preserves journey steps', () => {
    const config = normalizeSegmentExperience({
      journeySteps: [{ title: 'Step one', description: 'Start here' }],
    });
    assert.equal(config.journeySteps?.[0].title, 'Step one');
  });

  it('F. preserves benefits', () => {
    const config = normalizeSegmentExperience({
      benefits: [{ title: 'Real experience', description: 'Not theory', icon: 'shield-check' }],
    });
    assert.equal(config.benefits?.[0].title, 'Real experience');
  });

  it('G. preserves guides', () => {
    const config = normalizeSegmentExperience({
      guides: [
        {
          topic: 'Career',
          title: 'How to negotiate',
          description: 'A practical walkthrough',
          readingTime: '6 min',
          cta: { title: 'Read guide', buttonText: 'Open', buttonUrl: 'https://example.com/g' },
        },
      ],
    });
    assert.equal(config.guides?.length, 1);
    assert.equal(config.guides?.[0].title, 'How to negotiate');
    assert.equal(config.guides?.[0].readingTime, '6 min');
    assert.equal(config.guides?.[0].cta?.buttonUrl, 'https://example.com/g');
  });

  it('H. preserves stories without fabricating any', () => {
    const config = normalizeSegmentExperience({
      stories: [
        {
          quote: 'This changed how I approached my career.',
          name: 'Priya',
          context: 'First job switch',
          avatar: 'https://cdn.example.com/p.png',
        },
      ],
    });
    assert.equal(config.stories?.length, 1);
    assert.equal(config.stories?.[0].name, 'Priya');

    // No stories configured => absent, never invented.
    const none = normalizeSegmentExperience({ topics: [{ title: 'x', description: 'y' }] });
    assert.equal(none.stories, undefined);
  });

  it('H2. drops stories missing a quote or a name', () => {
    assert.deepEqual(normalizeSegmentExperience({ stories: [{ quote: 'only quote' }] }).stories, undefined);
    assert.deepEqual(normalizeSegmentExperience({ stories: [{ name: 'only name' }] }).stories, undefined);
  });

  it('I. preserves FAQ entries', () => {
    const config = normalizeSegmentExperience({
      faq: [{ question: 'How long is a session?', answer: '30 minutes by default.' }],
    });
    assert.equal(config.faq?.length, 1);
    assert.equal(config.faq?.[0].answer, '30 minutes by default.');
  });

  it('J. preserves the CTA in its intended shape', () => {
    const config = normalizeSegmentExperience({
      cta: {
        title: 'Talk to a career mentor',
        description: 'Book a focused 30 minute conversation.',
        buttonText: 'See mentors',
        buttonUrl: 'https://example.com/mentors',
      },
    });
    assert.deepEqual(config.cta, {
      title: 'Talk to a career mentor',
      description: 'Book a focused 30 minute conversation.',
      buttonText: 'See mentors',
      buttonUrl: 'https://example.com/mentors',
    });
  });

  it('J2. maps legacy { text, url } onto button fields, not the heading', () => {
    const config = normalizeSegmentExperience({
      cta: { text: 'Get help', url: 'https://example.com/help' },
    });
    // `text` is the BUTTON label. It must not become the title.
    assert.equal(config.cta?.buttonText, 'Get help');
    assert.equal(config.cta?.buttonUrl, 'https://example.com/help');
    assert.equal(config.cta?.title, undefined);
  });

  it('K. invalid colours fall back safely instead of being kept', () => {
    const invalid = [
      'red',
      '#fff',            // 3-digit is not the accepted form
      '#12345',          // wrong length
      '#1234567',        // wrong length
      'rgb(1,2,3)',
      'var(--evil)',
      'url(javascript:alert(1))',
      '#12345g',
      '#12 34 56',
      'expression(alert(1))',
      '',
      null,
      123,
      {},
    ];

    for (const value of invalid) {
      assert.equal(sanitizeSegmentColor(value), undefined, `should reject ${JSON.stringify(value)}`);
      assert.equal(isSafeHexColor(value), false);
    }

    // An invalid configured colour is dropped, so the theme falls back.
    const config = normalizeSegmentExperience({
      branding: { accent: 'red; background: url(x)', heroHeadline: 'Kept' },
    });
    assert.equal(config.branding?.accent, undefined);
    assert.equal(config.branding?.heroHeadline, 'Kept');
  });

  it('K2. accepts valid 6-digit hex colours in any case', () => {
    assert.equal(sanitizeSegmentColor('#a1b2c3'), '#a1b2c3');
    assert.equal(sanitizeSegmentColor('#A1B2C3'), '#a1b2c3');
    assert.equal(isSafeHexColor('#000000'), true);
    assert.equal(isSafeHexColor('#ffffff'), true);
  });

  it('L. unsafe URLs never become trusted URLs', () => {
    const unsafe = [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      '//evil.example.com',
      '/relative/path',
      'file:///etc/passwd',
      'vbscript:msgbox(1)',
      '',
      '   ',
      null,
      42,
    ];

    for (const value of unsafe) {
      assert.equal(sanitizeSegmentUrl(value), undefined, `should reject ${JSON.stringify(value)}`);
      assert.equal(isSafeSegmentUrl(value), false);
    }

    assert.equal(sanitizeSegmentUrl('https://example.com/a'), 'https://example.com/a');
    assert.equal(sanitizeSegmentUrl('http://example.com/a'), 'http://example.com/a');
  });

  it('L2. an unsafe hero image and story avatar are dropped, not rendered', () => {
    const config = normalizeSegmentExperience({
      branding: { heroImageUrl: 'javascript:alert(1)', heroHeadline: 'Kept' },
      stories: [{ quote: 'q', name: 'n', avatar: 'javascript:alert(1)' }],
    });
    assert.equal(config.branding?.heroImageUrl, undefined);
    assert.equal(config.branding?.heroHeadline, 'Kept');
    assert.equal(config.stories?.[0].avatar, undefined);
  });

  it('treats icons as registry identifiers, never component names', () => {
    assert.equal(sanitizeSegmentIcon('briefcase'), 'briefcase');
    assert.equal(sanitizeSegmentIcon('  HEART  '), 'heart');
    assert.equal(sanitizeSegmentIcon('graduation-cap'), 'graduation-cap');

    // Anything not in the closed registry is refused, so a DB value can never
    // name a component to render.
    for (const value of [
      'constructor',
      '__proto__',
      'toString',
      'Component',
      'require("fs")',
      '../../etc/passwd',
      '',
      null,
      123,
    ]) {
      assert.equal(sanitizeSegmentIcon(value), undefined, `should reject ${JSON.stringify(value)}`);
      assert.equal(isSafeSegmentIcon(value), false);
    }

    for (const key of SEGMENT_ICON_KEYS) {
      assert.equal(isSafeSegmentIcon(key), true);
    }
  });

  it('drops an unknown icon from an otherwise valid item', () => {
    const config = normalizeSegmentExperience({
      topics: [{ title: 'Kept', description: 'd', icon: 'NotARealIcon' }],
    });
    assert.equal(config.topics?.[0].title, 'Kept');
    assert.equal(config.topics?.[0].icon, undefined);
  });

  it('preserves the enabled toggle and defaults to absent', () => {
    const config = normalizeSegmentExperience({
      topics: [
        { title: 'On', description: 'd', enabled: true },
        { title: 'Off', description: 'd', enabled: false },
      ],
    });
    assert.equal(config.topics?.[0].enabled, true);
    assert.equal(config.topics?.[1].enabled, false);

describe('config-driven segment theme', () => {
  it('M. a brand-new arbitrary segment slug needs no code change', () => {
    // Nothing named "finance-mentor" exists anywhere in the source. The theme is
    // derived purely from the config the admin saved.
    const config: SegmentExperienceConfig = { branding: { accent: '#123456' } };
    const theme = deriveSegmentTheme(config, 'light');

    assert.equal(theme.variables['--segment-accent'], '#123456');
    assert.equal(theme.accent, '#123456');
    assert.equal(theme.isConfigDriven, true);
  });

  it('M2. emits the documented CSS variables', () => {
    const theme = deriveSegmentTheme({ branding: { accent: '#123456' } }, 'light');
    for (const name of [
      '--segment-accent',
      '--segment-accent-soft',
      '--segment-accent-secondary',
      '--segment-hero-tint',
      '--segment-gradient-start',
      '--segment-gradient-end',
      '--segment-on-accent',
    ]) {
      assert.ok(theme.variables[name], `expected ${name} to be present`);
    }
  });

  it('N. no slug-keyed lookup is required to generate the theme', () => {
    const config: SegmentExperienceConfig = { branding: { accent: '#0d9488' } };
    // deriveSegmentTheme takes config + mode only. The signature has no slug,
    // so an unknown segment cannot fall back to a hardcoded palette.
    const theme = deriveSegmentTheme(config, 'light');
    assert.equal(theme.variables['--segment-accent'], '#0d9488');

    // Two different segments with different config produce different accents.
    const a = deriveSegmentTheme({ branding: { accent: '#111111' } }, 'light');
    const b = deriveSegmentTheme({ branding: { accent: '#222222' } }, 'light');
    assert.notEqual(a.variables['--segment-accent'], b.variables['--segment-accent']);
  });

  it('falls back to the brand palette when no config exists', () => {
    for (const empty of [null, undefined, {}, { branding: {} }]) {
      const theme = deriveSegmentTheme(empty, 'light');
      assert.equal(theme.variables['--segment-accent'], '#663af3');
      assert.equal(theme.isConfigDriven, false);
    }
  });

  it('keeps a configured accent usable in dark mode', () => {
    // A near-black accent would vanish on the dark background, so it is lifted
    // rather than used verbatim.
    const theme = deriveSegmentTheme({ branding: { accent: '#000000' } }, 'dark');
    assert.notEqual(theme.variables['--segment-accent'], '#000000');
    assert.match(theme.variables['--segment-accent'], /^#[0-9a-f]{6}$/);
  });

  it('never emits an invalid CSS colour', () => {
    const theme = deriveSegmentTheme(
      {
        branding: {
          accent: 'not-a-color',
          accentSecondary: 'url(javascript:alert(1))',
          gradientStart: '#zzz',
        },
      },
      'light',
    );

    const hexOnly = /^#[0-9a-f]{6}$/;
    for (const [name, value] of Object.entries(theme.variables)) {
      if (name === '--segment-gradient-primary') {
        // A gradient built from validated hexes only.
        assert.ok(!/javascript|url\(|expression/i.test(value), `${name} must not contain unsafe CSS`);
        continue;
      }
      if (name.endsWith('-soft') || name === '--segment-section-glow' || name === '--segment-border-accent') {
        assert.match(value, /^rgba\(\d{1,3}, \d{1,3}, \d{1,3}, [\d.]+\)$/, `${name} = ${value}`);
        continue;
      }
      assert.match(value, hexOnly, `${name} = ${value} must be a hex colour`);
    }
  });

  it('honours an explicit textMode for the on-accent colour', () => {
    assert.equal(
      deriveSegmentTheme({ branding: { accent: '#663af3', textMode: 'light' } }, 'light')
        .variables['--segment-on-accent'],
      '#ffffff',
    );
    assert.equal(
      deriveSegmentTheme({ branding: { accent: '#663af3', textMode: 'dark' } }, 'light')
        .variables['--segment-on-accent'],
      '#0b0d1a',
    );
  });

  it('auto text mode picks the readable foreground for a pale accent', () => {
    // A pale yellow accent must get dark text, not unreadable white.
    const onAccent = deriveSegmentTheme({ branding: { accent: '#fde68a' } }, 'light')
      .variables['--segment-on-accent'];
    assert.equal(onAccent, '#0b0d1a');
  });

  it('uses configured gradient and hero tokens', () => {
    const theme = deriveSegmentTheme(
      {
        branding: {
          accent: '#663af3',
          heroTint: '#0d9488',
          gradientStart: '#111111',
          gradientEnd: '#222222',
        },
      },
      'light',
    );
    assert.equal(theme.variables['--segment-hero-tint'], '#0d9488');
    assert.equal(theme.variables['--segment-gradient-start'], '#111111');
    assert.equal(theme.variables['--segment-gradient-end'], '#222222');
    assert.ok(theme.variables['--segment-gradient-primary'].includes('#111111'));
  });
});

describe('no polling in the segment realtime layer', () => {
  const readSource = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');

  it('O. the realtime hook contains no polling loop', () => {
    const source = readSource('src/hooks/useSegmentExperienceRealtime.ts');

    // Comments are stripped so a comment mentioning setInterval cannot mask a
    // real one, and cannot cause a false failure either.
    const withoutComments = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    assert.equal(/setInterval/.test(withoutComments), false, 'setInterval must not be used');
    assert.equal(/setTimeout/.test(withoutComments), false, 'setTimeout polling must not be used');
    assert.equal(/visibilitychange/.test(withoutComments), false, 'no visibility polling');
  });

  it('the realtime hook subscribes to the segments table and cleans up', () => {
    const source = readSource('src/hooks/useSegmentExperienceRealtime.ts');
    assert.ok(source.includes("table: 'segments'"), 'must subscribe to segments');
    assert.ok(source.includes('removeChannel'), 'must remove the channel on cleanup');
    assert.ok(source.includes('slug=eq.'), 'must filter by the selected slug');
  });
});

  });

  });
