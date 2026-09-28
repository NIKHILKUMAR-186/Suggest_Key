/**
 * Segment visual theme mapping (frontend presentation only).
 *
 * The database does not store theme metadata for segments. This file provides
 * a deterministic, slug-based fallback so every segment renders with a
 * distinct visual identity without duplicating business data.
 *
 * Add new entries here when new segments are created in the admin panel.
 * Unknown segments safely fall back to the default brand theme.
 */

export interface SegmentThemeTokens {
  /** Primary accent for the segment (used for selections, CTAs, highlights) */
  accent: string;
  /** Hover/active state for the primary accent */
  accentHover: string;
  /** Soft background for chips, badges, selected states */
  accentSoft: string;
  /** Secondary accent for gradients and supporting elements */
  accentSecondary: string;
  /** Hover state for secondary accent */
  accentSecondaryHover: string;
  /** Soft background for secondary accent */
  accentSecondarySoft: string;
  /** Gradient for selected segment pill / hero accents */
  gradientPrimary: string;
  /** Subtle radial glow for section atmosphere */
  sectionGlow: string;
  /** Border color for selected/active states */
  borderAccent: string;
}

/** Default brand theme (violet + blue) — used when no segment match is found. */
export const DEFAULT_SEGMENT_THEME: SegmentThemeTokens = {
  accent: '#663af3',
  accentHover: '#5a30e0',
  accentSoft: 'rgba(102, 57, 243, 0.10)',
  accentSecondary: '#2563eb',
  accentSecondaryHover: '#1d4ed8',
  accentSecondarySoft: 'rgba(37, 99, 235, 0.10)',
  gradientPrimary: 'linear-gradient(135deg, #663af3 0%, #7c3aed 50%, #2563eb 100%)',
  sectionGlow: 'rgba(102, 57, 243, 0.09)',
  borderAccent: 'rgba(102, 57, 243, 0.42)',
};

/** Dark mode overrides for the default theme. */
export const DEFAULT_SEGMENT_THEME_DARK: SegmentThemeTokens = {
  accent: '#8b5cf6',
  accentHover: '#7c3aed',
  accentSoft: 'rgba(139, 92, 246, 0.12)',
  accentSecondary: '#60a5fa',
  accentSecondaryHover: '#4f8ad6',
  accentSecondarySoft: 'rgba(96, 165, 250, 0.12)',
  gradientPrimary: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 50%, #60a5fa 100%)',
  sectionGlow: 'rgba(102, 57, 243, 0.16)',
  borderAccent: 'rgba(139, 92, 246, 0.55)',
};

/**
 * Segment-specific themes keyed by slug.
 *
 * Each theme defines a cohesive palette that works in both light and dark modes.
 * Colors are chosen for accessibility (WCAG AA contrast on both backgrounds).
 */
export const SEGMENT_THEMES: Record<string, { light: SegmentThemeTokens; dark: SegmentThemeTokens }> = {
  // Relationship / interpersonal segments — warm pink/rose palette
  'relationship-advisor': {
    light: {
      accent: '#db2777',
      accentHover: '#be185d',
      accentSoft: 'rgba(219, 39, 119, 0.10)',
      accentSecondary: '#f43f5e',
      accentSecondaryHover: '#e11d48',
      accentSecondarySoft: 'rgba(244, 63, 94, 0.10)',
      gradientPrimary: 'linear-gradient(135deg, #db2777 0%, #f43f5e 50%, #fb7185 100%)',
      sectionGlow: 'rgba(219, 39, 119, 0.09)',
      borderAccent: 'rgba(219, 39, 119, 0.42)',
    },
    dark: {
      accent: '#f472b6',
      accentHover: '#f9a8d4',
      accentSoft: 'rgba(244, 114, 182, 0.12)',
      accentSecondary: '#fb7185',
      accentSecondaryHover: '#fda4af',
      accentSecondarySoft: 'rgba(251, 113, 133, 0.12)',
      gradientPrimary: 'linear-gradient(135deg, #f472b6 0%, #fb7185 50%, #fda4af 100%)',
      sectionGlow: 'rgba(219, 39, 119, 0.16)',
      borderAccent: 'rgba(244, 114, 182, 0.55)',
    },
  },

  // Career / professional growth — emerald/green palette
  'career-mentor': {
    light: {
      accent: '#059669',
      accentHover: '#047857',
      accentSoft: 'rgba(5, 150, 105, 0.10)',
      accentSecondary: '#10b981',
      accentSecondaryHover: '#059669',
      accentSecondarySoft: 'rgba(16, 185, 129, 0.10)',
      gradientPrimary: 'linear-gradient(135deg, #059669 0%, #10b981 50%, #34d399 100%)',
      sectionGlow: 'rgba(5, 150, 105, 0.09)',
      borderAccent: 'rgba(5, 150, 105, 0.42)',
    },
    dark: {
      accent: '#34d399',
      accentHover: '#6ee7b7',
      accentSoft: 'rgba(52, 211, 153, 0.12)',
      accentSecondary: '#6ee7b7',
      accentSecondaryHover: '#a7f3d0',
      accentSecondarySoft: 'rgba(110, 231, 183, 0.12)',
      gradientPrimary: 'linear-gradient(135deg, #34d399 0%, #6ee7b7 50%, #a7f3d0 100%)',
      sectionGlow: 'rgba(5, 150, 105, 0.16)',
      borderAccent: 'rgba(52, 211, 153, 0.55)',
    },
  },

  // Autism / neurodiversity support — purple/violet palette (distinct from default)
  'autism-mentor': {
    light: {
      accent: '#7c3aed',
      accentHover: '#6d28d9',
      accentSoft: 'rgba(124, 58, 237, 0.10)',
      accentSecondary: '#a855f7',
      accentSecondaryHover: '#9333ea',
      accentSecondarySoft: 'rgba(168, 85, 247, 0.10)',
      gradientPrimary: 'linear-gradient(135deg, #7c3aed 0%, #a855f7 50%, #c084fc 100%)',
      sectionGlow: 'rgba(124, 58, 237, 0.09)',
      borderAccent: 'rgba(124, 58, 237, 0.42)',
    },
    dark: {
      accent: '#a855f7',
      accentHover: '#c084fc',
      accentSoft: 'rgba(168, 85, 247, 0.12)',
      accentSecondary: '#c084fc',
      accentSecondaryHover: '#d8b4fe',
      accentSecondarySoft: 'rgba(192, 132, 252, 0.12)',
      gradientPrimary: 'linear-gradient(135deg, #a855f7 0%, #c084fc 50%, #d8b4fe 100%)',
      sectionGlow: 'rgba(124, 58, 237, 0.16)',
      borderAccent: 'rgba(168, 85, 247, 0.55)',
    },
  },

  // Parenting / family — amber/orange palette
  'parental-advisor': {
    light: {
      accent: '#d97706',
      accentHover: '#b45309',
      accentSoft: 'rgba(217, 119, 6, 0.10)',
      accentSecondary: '#f59e0b',
      accentSecondaryHover: '#d97706',
      accentSecondarySoft: 'rgba(245, 158, 11, 0.10)',
      gradientPrimary: 'linear-gradient(135deg, #d97706 0%, #f59e0b 50%, #fbbf24 100%)',
      sectionGlow: 'rgba(217, 119, 6, 0.09)',
      borderAccent: 'rgba(217, 119, 6, 0.42)',
    },
    dark: {
      accent: '#fbbf24',
      accentHover: '#fcd34d',
      accentSoft: 'rgba(251, 191, 36, 0.12)',
      accentSecondary: '#fcd34d',
      accentSecondaryHover: '#fde047',
      accentSecondarySoft: 'rgba(253, 224, 71, 0.12)',
      gradientPrimary: 'linear-gradient(135deg, #fbbf24 0%, #fcd34d 50%, #fde047 100%)',
      sectionGlow: 'rgba(217, 119, 6, 0.16)',
      borderAccent: 'rgba(251, 191, 36, 0.55)',
    },
  },

  // Health / wellness — teal/cyan palette
  'health-wellness': {
    light: {
      accent: '#0d9488',
      accentHover: '#0f766e',
      accentSoft: 'rgba(13, 148, 136, 0.10)',
      accentSecondary: '#14b8a6',
      accentSecondaryHover: '#0d9488',
      accentSecondarySoft: 'rgba(20, 184, 166, 0.10)',
      gradientPrimary: 'linear-gradient(135deg, #0d9488 0%, #14b8a6 50%, #2dd4bf 100%)',
      sectionGlow: 'rgba(13, 148, 136, 0.09)',
      borderAccent: 'rgba(13, 148, 136, 0.42)',
    },
    dark: {
      accent: '#2dd4bf',
      accentHover: '#5eead4',
      accentSoft: 'rgba(45, 212, 191, 0.12)',
      accentSecondary: '#5eead4',
      accentSecondaryHover: '#99f6e4',
      accentSecondarySoft: 'rgba(94, 234, 212, 0.12)',
      gradientPrimary: 'linear-gradient(135deg, #2dd4bf 0%, #5eead4 50%, #99f6e4 100%)',
      sectionGlow: 'rgba(13, 148, 136, 0.16)',
      borderAccent: 'rgba(45, 212, 191, 0.55)',
    },
  },

  // Finance / money — green/emerald (distinct from career)
  'finance-mentor': {
    light: {
      accent: '#166534',
      accentHover: '#14532d',
      accentSoft: 'rgba(22, 101, 52, 0.10)',
      accentSecondary: '#22c55e',
      accentSecondaryHover: '#16a34a',
      accentSecondarySoft: 'rgba(34, 197, 94, 0.10)',
      gradientPrimary: 'linear-gradient(135deg, #166534 0%, #22c55e 50%, #4ade80 100%)',
      sectionGlow: 'rgba(22, 101, 52, 0.09)',
      borderAccent: 'rgba(22, 101, 52, 0.42)',
    },
    dark: {
      accent: '#4ade80',
      accentHover: '#86efac',
      accentSoft: 'rgba(74, 222, 128, 0.12)',
      accentSecondary: '#86efac',
      accentSecondaryHover: '#bbf7d0',
      accentSecondarySoft: 'rgba(134, 239, 172, 0.12)',
      gradientPrimary: 'linear-gradient(135deg, #4ade80 0%, #86efac 50%, #bbf7d0 100%)',
      sectionGlow: 'rgba(22, 101, 52, 0.16)',
      borderAccent: 'rgba(74, 222, 128, 0.55)',
    },
  },

  // Education / learning — indigo/blue palette
  'education-mentor': {
    light: {
      accent: '#4338ca',
      accentHover: '#3730a3',
      accentSoft: 'rgba(67, 56, 202, 0.10)',
      accentSecondary: '#6366f1',
      accentSecondaryHover: '#4f46e5',
      accentSecondarySoft: 'rgba(99, 102, 241, 0.10)',
      gradientPrimary: 'linear-gradient(135deg, #4338ca 0%, #6366f1 50%, #818cf8 100%)',
      sectionGlow: 'rgba(67, 56, 202, 0.09)',
      borderAccent: 'rgba(67, 56, 202, 0.42)',
    },
    dark: {
      accent: '#818cf8',
      accentHover: '#a5b4fc',
      accentSoft: 'rgba(129, 140, 248, 0.12)',
      accentSecondary: '#a5b4fc',
      accentSecondaryHover: '#c7d2fe',
      accentSecondarySoft: 'rgba(165, 180, 252, 0.12)',
      gradientPrimary: 'linear-gradient(135deg, #818cf8 0%, #a5b4fc 50%, #c7d2fe 100%)',
      sectionGlow: 'rgba(67, 56, 202, 0.16)',
      borderAccent: 'rgba(129, 140, 248, 0.55)',
    },
  },

  // Creativity / arts — orange/red palette
  'creativity-mentor': {
    light: {
      accent: '#c2410c',
      accentHover: '#9a3412',
      accentSoft: 'rgba(194, 65, 12, 0.10)',
      accentSecondary: '#ea580c',
      accentSecondaryHover: '#c2410c',
      accentSecondarySoft: 'rgba(234, 88, 12, 0.10)',
      gradientPrimary: 'linear-gradient(135deg, #c2410c 0%, #ea580c 50%, #fb923c 100%)',
      sectionGlow: 'rgba(194, 65, 12, 0.09)',
      borderAccent: 'rgba(194, 65, 12, 0.42)',
    },
    dark: {
      accent: '#fb923c',
      accentHover: '#fdba74',
      accentSoft: 'rgba(251, 146, 60, 0.12)',
      accentSecondary: '#fdba74',
      accentSecondaryHover: '#ffedd5',
      accentSecondarySoft: 'rgba(253, 186, 116, 0.12)',
      gradientPrimary: 'linear-gradient(135deg, #fb923c 0%, #fdba74 50%, #ffedd5 100%)',
      sectionGlow: 'rgba(194, 65, 12, 0.16)',
      borderAccent: 'rgba(251, 146, 60, 0.55)',
    },
  },

  // Technology / coding — slate/blue palette
  'technology-mentor': {
    light: {
      accent: '#1e40af',
      accentHover: '#1e3a8a',
      accentSoft: 'rgba(30, 64, 175, 0.10)',
      accentSecondary: '#3b82f6',
      accentSecondaryHover: '#2563eb',
      accentSecondarySoft: 'rgba(59, 130, 246, 0.10)',
      gradientPrimary: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 50%, #60a5fa 100%)',
      sectionGlow: 'rgba(30, 64, 175, 0.09)',
      borderAccent: 'rgba(30, 64, 175, 0.42)',
    },
    dark: {
      accent: '#60a5fa',
      accentHover: '#93c5fd',
      accentSoft: 'rgba(96, 165, 250, 0.12)',
      accentSecondary: '#93c5fd',
      accentSecondaryHover: '#bfdbfe',
      accentSecondarySoft: 'rgba(147, 197, 253, 0.12)',
      gradientPrimary: 'linear-gradient(135deg, #60a5fa 0%, #93c5fd 50%, #bfdbfe 100%)',
      sectionGlow: 'rgba(30, 64, 175, 0.16)',
      borderAccent: 'rgba(96, 165, 250, 0.55)',
    },
  },
};

/**
 * Resolves the theme tokens for a given segment slug.
 * Falls back to the default brand theme if no match is found.
 */
export function getSegmentTheme(slug: string | null | undefined): {
  light: SegmentThemeTokens;
  dark: SegmentThemeTokens;
} {
  if (!slug) return { light: DEFAULT_SEGMENT_THEME, dark: DEFAULT_SEGMENT_THEME_DARK };
  const normalized = slug.toLowerCase().trim();
  return SEGMENT_THEMES[normalized] ?? { light: DEFAULT_SEGMENT_THEME, dark: DEFAULT_SEGMENT_THEME_DARK };
}