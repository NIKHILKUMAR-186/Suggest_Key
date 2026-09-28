/**
 * Config-driven segment theming.
 *
 * This module replaces a hardcoded slug -> colour lookup. It turns an
 * admin-configured `experience_config.branding` into the CSS custom properties
 * the stylesheet already consumes, so a segment created yesterday
 * ("finance-mentor") renders its configured identity today without anyone
 * editing frontend source.
 *
 * Design rules:
 *
 *  - No slug is ever consulted. The only inputs are the config and the mode.
 *  - No unsafe CSS can be produced. Every value is either a validated hex
 *    colour or a value this module computes itself.
 *  - Everything has a safe fallback, so a brand-new segment with no config at
 *    all still renders a coherent, on-brand experience.
 *  - Colours are resolved independently for light and dark so both modes stay
 *    legible when an admin configures a single accent.
 */

import {
  normalizeSegmentExperience,
  type SegmentExperienceConfig,
} from '@/src/lib/segmentExperience';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A `Record<--custom-property, value>` map, ready to spread onto a `style`
 * attribute or applied to an element.
 */
export type SegmentCssVariables = Record<string, string>;

export type SegmentColorMode = 'light' | 'dark';

export interface SegmentTheme {
  /** Ready-to-apply custom properties for the given mode. */
  variables: SegmentCssVariables;
  /** The accent actually in use, after fallbacks. */
  accent: string;
  /** True when the config supplied the accent (i.e. no fallback was needed). */
  isConfigDriven: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * The Suggest Key brand fallback, mirroring the `--segment-*` tokens declared
 * in `index.css`. Used whenever a segment has not configured that particular
 * colour, so the page always has a complete, valid palette.
 */
const BRAND_FALLBACK: Record<SegmentColorMode, { accent: string; accentSecondary: string }> = {
  light: { accent: '#663af3', accentSecondary: '#2563eb' },
  dark: { accent: '#8b5cf6', accentSecondary: '#60a5fa' },
};

// ---------------------------------------------------------------------------
// Colour maths
// ---------------------------------------------------------------------------

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse `#rrggbb` into channels. Callers must validate the hex first. */
function hexToRgb(hex: string): Rgb {
  const value = hex.slice(1);
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const channel = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** `rgba()` string from a hex colour — used for the soft/alpha tokens. */
function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Blend two hex colours. `amount` 0 = `a`, 1 = `b`. */
function mix(a: string, b: string, amount: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex({
    r: ca.r + (cb.r - ca.r) * amount,
    g: ca.g + (cb.g - ca.g) * amount,
    b: ca.b + (cb.b - ca.b) * amount,
  });
}

/** Move a colour toward black (negative amount) or white (positive). */
function shade(hex: string, amount: number): string {
  return mix(hex, amount < 0 ? '#000000' : '#ffffff', Math.abs(amount));
}

/**
 * Relative luminance per WCAG 2.1, used to pick readable foreground text on a
 * saturated accent.
 */
function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (raw: number) => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio between two hex colours (1–21). */
function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Pick the readable foreground for a given surface.
 *
 * `textMode: 'light' | 'dark'` forces the admin's choice. `auto` (the default)
 * compares the two candidates and takes whichever actually has more contrast,
 * so a pale yellow accent still gets dark text rather than unreadable white.
 */
function readableTextColor(background: string, textMode: 'auto' | 'light' | 'dark' | undefined): string {
  if (textMode === 'light') return '#ffffff';
  if (textMode === 'dark') return '#0b0d1a';

  const onWhite = contrastRatio(background, '#ffffff');
  const onDark = contrastRatio(background, '#0b0d1a');
  return onWhite >= onDark ? '#ffffff' : '#0b0d1a';
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/**
 * Derive the CSS custom properties for a segment from its experience config.
 *
 * @param rawConfig Raw `experience_config` (unnormalised is fine).
 * @param mode      Which mode's palette to build.
 *
 * Note there is no slug parameter: appearance comes from data, never from a
 * hardcoded lookup table.
 */
export function deriveSegmentTheme(
  rawConfig: SegmentExperienceConfig | null | undefined,
  mode: SegmentColorMode = 'light',
): SegmentTheme {
  const config = normalizeSegmentExperience(rawConfig ?? null);
  // An absent branding block simply means "use the brand fallback for
  // everything", which is why this is an empty object rather than undefined.
  const branding = config.branding ?? {};

  const fallback = BRAND_FALLBACK[mode];

  // An admin-supplied accent is used for BOTH modes. In dark mode a very dark
  // accent would be invisible against the deep background, so it is lifted
  // toward white until it clears a minimum contrast. This keeps one configured
  // colour usable in both themes.
  let accent = branding.accent ?? fallback.accent;
  const minContrastAgainstBackground = mode === 'dark' ? 3 : 2.2;
  const background = mode === 'dark' ? '#05060f' : '#ffffff';
  let guard = 0;
  while (contrastRatio(accent, background) < minContrastAgainstBackground && guard < 10) {
    accent = shade(accent, mode === 'dark' ? 0.08 : -0.06);
    guard += 1;
  }

  const accentSecondary =
    branding.accentSecondary ??
    (branding.accent ? mix(accent, fallback.accentSecondary, 0.35) : fallback.accentSecondary);

  // The hero wash/tint. `heroTint` is the dedicated control; `tintColor` is the
  // older field and is honoured so existing configs keep their look.
  const heroTint = branding.heroTint ?? branding.tintColor ?? accent;

  const gradientStart = branding.gradientStart ?? accent;
  const gradientEnd = branding.gradientEnd ?? accentSecondary;

  const onAccent = readableTextColor(accent, branding.textMode);

  const variables: SegmentCssVariables = {
    '--segment-accent': accent,
    '--segment-accent-hover': shade(accent, mode === 'dark' ? 0.1 : -0.08),
    '--segment-accent-soft': branding.accentSoft ?? withAlpha(accent, mode === 'dark' ? 0.14 : 0.1),
    '--segment-accent-secondary': accentSecondary,
    '--segment-accent-secondary-hover': shade(accentSecondary, mode === 'dark' ? 0.1 : -0.08),
    '--segment-accent-secondary-soft': withAlpha(accentSecondary, mode === 'dark' ? 0.14 : 0.1),
    '--segment-gradient-primary': `linear-gradient(135deg, ${gradientStart} 0%, ${mix(gradientStart, gradientEnd, 0.5)} 50%, ${gradientEnd} 100%)`,
    '--segment-section-glow': withAlpha(accent, mode === 'dark' ? 0.16 : 0.09),
    '--segment-border-accent': withAlpha(accent, mode === 'dark' ? 0.55 : 0.42),

    // Explicit hero tokens.
    '--segment-hero-tint': heroTint,
    '--segment-gradient-start': gradientStart,
    '--segment-gradient-end': gradientEnd,
    '--segment-on-accent': onAccent,
  };

  return {
    variables,
    accent,
    // "Config driven" means the admin actually chose the accent, not that we
    // silently substituted the brand default.
    isConfigDriven: Boolean(branding.accent),
  };
}

/**
 * Apply a segment's derived variables to a DOM element.
 *
 * Kept separate from the derivation so the same function serves both the seeker
 * (document root) and any scoped admin preview container.
 */
export function applySegmentCssVariables(element: HTMLElement, variables: SegmentCssVariables): void {
  for (const [name, value] of Object.entries(variables)) {
    element.style.setProperty(name, value);
  }
}
