/**
 * Segment Experience Configuration (frontend presentation only).
 *
 * A mentor has ONE global profile, can belong to multiple segments, and can
 * have segment-specific gigs. This module owns the shape of the per-segment
 * "experience" the admin configures and the seeker renders.
 *
 * Nothing here invents a value: every field is optional and the fallback is an
 * empty config, which the renderer treats as "use defaults". The UI must work
 * tomorrow if an admin creates a brand-new segment called "Finance Mentor"
 * without any frontend code change.
 */

/** A validated hex color, e.g. "#0d9488". */
export type SegmentColor = string;

/**
 * Branding controls the segment's visual identity.
 *
 * `heroImageUrl` is the optional admin-configured hero visual. When absent the
 * renderer falls back to a polished CSS/gradient illustration — never a broken
 * <img>.
 *
 * Field names follow the existing persisted shape (`heroHeadline`,
 * `heroSubheadline`, `tintColor`) so the config already stored in the database
 * keeps working without a backfill.
 */
export interface SegmentExperienceBranding {
  /** Small label above the hero headline (e.g. "Career"). */
  eyebrow?: string;
  heroHeadline?: string;
  heroSubheadline?: string;
  tintColor?: SegmentColor;
  /** Primary accent for the segment (buttons, highlights, active states). */
  accent?: SegmentColor;
  /** Soft background for chips/badges/selected states. */
  accentSoft?: SegmentColor;
  /** Secondary accent for gradients and supporting elements. */
  accentSecondary?: SegmentColor;
  /** Hero background tint (used as a wash behind the hero content). */
  heroTint?: SegmentColor;
  /** Optional gradient start for the hero atmosphere. */
  gradientStart?: SegmentColor;
  /** Optional gradient end for the hero atmosphere. */
  gradientEnd?: SegmentColor;
  /** Text mode: 'auto' derives contrast from the accent; 'light'/'dark' force it. */
  textMode?: 'auto' | 'light' | 'dark';
  /** Optional admin-configured hero image URL or storage path. */
  heroImageUrl?: string;
}

export interface SegmentExperienceItem {
  title: string;
  description: string;
  /** A safe registry identifier (see SEGMENT_ICON_KEYS), never a component name. */
  icon?: SegmentIconKey;
  /** Admin toggle. Items default to enabled when the field is absent. */
  enabled?: boolean;
}

/**
 * The final call to action.
 *
 * `title` / `description` / `buttonText` / `buttonUrl` is the intended shape.
 * The previously persisted `{ text, url }` pair is still accepted on read and
 * mapped onto the new fields so already-saved segments keep rendering, but
 * nothing is ever mapped the wrong way round: `text` is the button label, not
 * the heading.
 */
export interface SegmentExperienceCTA {
  title?: string;
  description?: string;
  buttonText?: string;
  buttonUrl?: string;
}

// ---------------------------------------------------------------------------
// Icon registry
// ---------------------------------------------------------------------------

/**
 * The closed set of icon identifiers a segment may use.
 *
 * These are DATA identifiers, never component names. A later UI layer maps an
 * identifier to a concrete lucide component through an explicit lookup, so a
 * value coming from the database can never select or execute an arbitrary
 * component. Unknown identifiers are dropped during normalization.
 */
export const SEGMENT_ICON_KEYS = [
  'sparkles',
  'briefcase',
  'heart',
  'message-circle',
  'graduation-cap',
  'compass',
  'life-buoy',
  'users',
  'calendar',
  'clock',
  'target',
  'book-open',
  'lightbulb',
  'shield-check',
  'star',
  'map',
  'phone',
  'video',
  'globe',
  'brain',
  'heart-handshake',
  'scale',
  'puzzle',
  'mic',
  'pen-line',
] as const;

export type SegmentIconKey = (typeof SEGMENT_ICON_KEYS)[number];

const SEGMENT_ICON_KEY_SET: ReadonlySet<string> = new Set(SEGMENT_ICON_KEYS);

/** True when `value` is an icon identifier this app knows how to render. */
export function isSafeSegmentIcon(value: unknown): value is SegmentIconKey {
  return typeof value === 'string' && SEGMENT_ICON_KEY_SET.has(value.trim().toLowerCase());
}

/**
 * Coerce an arbitrary DB value into a safe icon identifier.
 * Returns undefined for anything not in the registry.
 */
export function sanitizeSegmentIcon(value: unknown): SegmentIconKey | undefined {
  if (!isSafeSegmentIcon(value)) return undefined;
  return value.trim().toLowerCase() as SegmentIconKey;
}

/**
 * A single testimonial / story. Only real, admin-configured stories are ever
 * rendered — there is no fabricated social proof.
 */
export interface SegmentStory {
  quote: string;
  name: string;
  context?: string;
  avatar?: string;
}

/**
 * A guide / article entry. When the platform has no guide CMS this array is
 * simply absent and the renderer hides the section.
 */
export interface SegmentGuide {
  topic?: string;
  title: string;
  description: string;
  readingTime?: string;
  cta?: SegmentExperienceCTA;
}

export interface SegmentExperienceConfig {
  branding?: SegmentExperienceBranding;
  topics?: SegmentExperienceItem[];
  quickHelp?: SegmentExperienceItem[];
  journeySteps?: SegmentExperienceItem[];
  benefits?: SegmentExperienceItem[];
  faq?: Array<{ question: string; answer: string; enabled?: boolean }>;
  cta?: SegmentExperienceCTA;
  guides?: SegmentGuide[];
  stories?: SegmentStory[];
}

// ---------------------------------------------------------------------------
// Colour + URL safety
// ---------------------------------------------------------------------------

/** 6-digit hex, the only colour form the API schema accepts. */
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * True when `value` is a plain 6-digit hex colour.
 *
 * This is deliberately stricter than "looks like a colour": the value is
 * interpolated into CSS custom properties, so anything that is not a hex triplet
 * (a `url(...)`, a `var(...)`, a function call, an expression) must be refused
 * rather than sanitised. Anything that fails is simply not configured, and the
 * derived theme falls back to a safe default.
 */
export function isSafeHexColor(value: unknown): value is SegmentColor {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value.trim());
}

/**
 * Normalise a configured colour into a safe `#rrggbb` string.
 * Returns undefined when the value is not a valid hex colour, so an invalid
 * config can never inject a CSS value.
 */
export function sanitizeSegmentColor(value: unknown): SegmentColor | undefined {
  if (!isSafeHexColor(value)) return undefined;
  return value.trim().toLowerCase();
}

/**
 * True when `value` is a URL safe to place in an href/src.
 *
 * Only absolute http(s) URLs are accepted. This rejects `javascript:`,
 * `data:` and protocol-relative URLs, none of which the product needs, and all
 * of which would be a injection vector on a value an admin typed into a form.
 */
export function isSafeSegmentUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Normalise a configured URL, or undefined when it is not safe to use. */
export function sanitizeSegmentUrl(value: unknown): string | undefined {
  return isSafeSegmentUrl(value) ? value.trim() : undefined;
}

// ---------------------------------------------------------------------------
// Write contract
// ---------------------------------------------------------------------------

/**
 * The shape ACCEPTED by `PUT /api/admin/segments/:id/experience`.
 *
 * This is deliberately looser than the normalized read model: an admin form
 * holds free text while it is being typed, so icons arrive as arbitrary strings
 * and the CTA may still use the legacy `{ text, url }` pair. The server's Zod
 * schema is the authority that validates a write; the client normalises the
 * response with `normalizeSegmentExperience` before storing it as a
 * `SegmentExperienceConfig`.
 *
 * Keeping the two apart is what stops a half-typed admin form from having to
 * pretend its values are already safe.
 */
export interface SegmentExperienceDraftItem {
  title: string;
  description: string;
  icon?: string;
  enabled?: boolean;
}

export interface SegmentExperienceDraftCta {
  title?: string;
  description?: string;
  buttonText?: string;
  buttonUrl?: string;
  /** Legacy button label, still accepted by the API. */
  text?: string;
  /** Legacy button destination, still accepted by the API. */
  url?: string;
}

export interface SegmentExperienceDraft {
  branding?: Record<string, string | undefined>;
  topics?: SegmentExperienceDraftItem[];
  quickHelp?: SegmentExperienceDraftItem[];
  journeySteps?: SegmentExperienceDraftItem[];
  benefits?: SegmentExperienceDraftItem[];
  faq?: Array<{ question: string; answer: string; enabled?: boolean }>;
  cta?: SegmentExperienceDraftCta;
  guides?: SegmentGuide[];
  stories?: SegmentStory[];
}

export const EMPTY_EXPERIENCE_CONFIG: SegmentExperienceConfig = {};

export function getSegmentExperienceFallback(): SegmentExperienceConfig {
  return { ...EMPTY_EXPERIENCE_CONFIG };
}

/**
 * Normalise a raw JSONB payload into a safe, typed config.
 *
 * The server validates the payload with Zod before it reaches the database, but
 * this is a defensive coercion layer for every other path a config can arrive
 * through — notably a Supabase Realtime event, whose payload shape we do not
 * fully control.
 *
 * Two rules govern everything here:
 *
 *  1. Never fabricate. A field the admin did not supply stays absent. Nothing is
 *     invented from mentors, and no default copy, testimonial or fallback story
 *     is ever generated.
 *  2. Never trust. Colours must be hex, URLs must be http(s), icons must exist
 *     in the closed registry. Anything else is dropped rather than passed
 *     through, so a malformed or hostile value cannot reach the DOM.
 */
export function normalizeSegmentExperience(raw: unknown): SegmentExperienceConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return getSegmentExperienceFallback();
  const r = raw as Record<string, unknown>;
  const out: SegmentExperienceConfig = {};

  /** Trimmed non-empty string, or undefined. */
  const str = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  const boolean = (value: unknown): boolean | undefined =>
    typeof value === 'boolean' ? value : undefined;

  // -- branding -------------------------------------------------------------

  if (r.branding && typeof r.branding === 'object' && !Array.isArray(r.branding)) {
    const b = r.branding as Record<string, unknown>;
    const branding: SegmentExperienceBranding = {};

    const eyebrow = str(b.eyebrow);
    if (eyebrow) branding.eyebrow = eyebrow;

    const heroHeadline = str(b.heroHeadline);
    if (heroHeadline) branding.heroHeadline = heroHeadline;

    const heroSubheadline = str(b.heroSubheadline);
    if (heroSubheadline) branding.heroSubheadline = heroSubheadline;

    // Colours: only valid hex survives. An invalid value leaves the field
    // unset, and the derived theme falls back to a safe default.
    const tintColor = sanitizeSegmentColor(b.tintColor);
    if (tintColor) branding.tintColor = tintColor;
    const accent = sanitizeSegmentColor(b.accent);
    if (accent) branding.accent = accent;
    const accentSoft = sanitizeSegmentColor(b.accentSoft);
    if (accentSoft) branding.accentSoft = accentSoft;
    const accentSecondary = sanitizeSegmentColor(b.accentSecondary);
    if (accentSecondary) branding.accentSecondary = accentSecondary;
    const heroTint = sanitizeSegmentColor(b.heroTint);
    if (heroTint) branding.heroTint = heroTint;
    const gradientStart = sanitizeSegmentColor(b.gradientStart);
    if (gradientStart) branding.gradientStart = gradientStart;
    const gradientEnd = sanitizeSegmentColor(b.gradientEnd);
    if (gradientEnd) branding.gradientEnd = gradientEnd;

    if (b.textMode === 'auto' || b.textMode === 'light' || b.textMode === 'dark') {
      branding.textMode = b.textMode;
    }

    const heroImageUrl = sanitizeSegmentUrl(b.heroImageUrl);
    if (heroImageUrl) branding.heroImageUrl = heroImageUrl;

    if (Object.keys(branding).length > 0) out.branding = branding;
  }

  const readItemArray = (key: string): SegmentExperienceItem[] | undefined => {
    const value = r[key];
    if (!Array.isArray(value)) return undefined;
    const items: SegmentExperienceItem[] = [];
    for (const entry of value) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const e = entry as Record<string, unknown>;
      const title = str(e.title);
      // title is the only required field; description may be omitted so a
      // short pill-style entry is representable.
      if (!title) continue;
      const item: SegmentExperienceItem = { title, description: str(e.description) ?? '' };

      const icon = sanitizeSegmentIcon(e.icon);
      if (icon) item.icon = icon;

      const enabled = boolean(e.enabled);
      if (enabled !== undefined) item.enabled = enabled;

      items.push(item);
    }
    return items.length > 0 ? items : undefined;
  };

  const topics = readItemArray('topics');
  if (topics) out.topics = topics;
  const quickHelp = readItemArray('quickHelp');
  if (quickHelp) out.quickHelp = quickHelp;
  const journeySteps = readItemArray('journeySteps');
  if (journeySteps) out.journeySteps = journeySteps;
  const benefits = readItemArray('benefits');
  if (benefits) out.benefits = benefits;

  // -- faq ------------------------------------------------------------------

  if (Array.isArray(r.faq)) {
    const faq: Array<{ question: string; answer: string; enabled?: boolean }> = [];
    for (const entry of r.faq) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const e = entry as Record<string, unknown>;
      const question = str(e.question);
      const answer = str(e.answer);
      if (!question || !answer) continue;
      const item: { question: string; answer: string; enabled?: boolean } = { question, answer };
      const enabled = boolean(e.enabled);
      if (enabled !== undefined) item.enabled = enabled;
      faq.push(item);
    }
    if (faq.length > 0) out.faq = faq;
  }

  // -- guides ---------------------------------------------------------------

  if (Array.isArray(r.guides)) {
    const guides: SegmentGuide[] = [];
    for (const entry of r.guides) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const e = entry as Record<string, unknown>;
      const title = str(e.title);
      if (!title) continue;
      const guide: SegmentGuide = { title, description: str(e.description) ?? '' };
      const topic = str(e.topic);
      if (topic) guide.topic = topic;
      const readingTime = str(e.readingTime);
      if (readingTime) guide.readingTime = readingTime;
      const guideCta = readCta(e.cta);
      if (guideCta) guide.cta = guideCta;
      guides.push(guide);
    }
    if (guides.length > 0) out.guides = guides;
  }

  // -- stories --------------------------------------------------------------

  // Only real, admin-configured stories. Nothing is ever synthesised here: if
  // no stories are configured the key stays absent and the UI hides the section.
  if (Array.isArray(r.stories)) {
    const stories: SegmentStory[] = [];
    for (const entry of r.stories) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const e = entry as Record<string, unknown>;
      const quote = str(e.quote);
      const name = str(e.name);
      if (!quote || !name) continue;
      const story: SegmentStory = { quote, name };
      const context = str(e.context);
      if (context) story.context = context;
      const avatar = sanitizeSegmentUrl(e.avatar);
      if (avatar) story.avatar = avatar;
      stories.push(story);
    }
    if (stories.length > 0) out.stories = stories;
  }

  // -- cta ------------------------------------------------------------------

  const cta = readCta(r.cta);
  if (cta) out.cta = cta;

  return out;
}

/**
 * Read a CTA object in the intended shape, tolerating the legacy
 * `{ text, url }` pair that earlier versions persisted.
 *
 * `text` is the BUTTON label and `url` is the BUTTON destination — it is never
 * treated as the heading. The CTA is kept only if it has something to show and
 * somewhere to send the user.
 */
function readCta(value: unknown): SegmentExperienceCTA | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const c = value as Record<string, unknown>;

  const pickString = (...candidates: unknown[]): string | undefined => {
    for (const candidate of candidates) {
      if (typeof candidate === 'string') {
        const trimmed = candidate.trim();
        if (trimmed.length > 0) return trimmed;
      }
    }
    return undefined;
  };

  const title = pickString(c.title);
  const description = pickString(c.description);
  // Legacy `text` is the button label.
  const buttonText = pickString(c.buttonText, c.text);
  const buttonUrl = sanitizeSegmentUrl(pickString(c.buttonUrl, c.url));

  if (!title && !description && !buttonText && !buttonUrl) return undefined;

  const cta: SegmentExperienceCTA = {};
  if (title) cta.title = title;
  if (description) cta.description = description;
  if (buttonText) cta.buttonText = buttonText;
  if (buttonUrl) cta.buttonUrl = buttonUrl;
  return cta;
}