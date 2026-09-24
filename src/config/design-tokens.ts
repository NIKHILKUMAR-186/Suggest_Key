// Design tokens extracted from auth_design.md
// "Frosted glass cathedral at midnight"

export const colors = {
  // Core palette
  midnightCanvas: '#05060f',
  steelPlate: '#2f343e',
  fogVeil: '#9da7ba',
  moonMist: '#c7d3ea',
  frostGlow: '#d1e4fa',
  iceHighlight: '#d8ecf8',
  pureWhite: '#ffffff',
  voidViolet: '#663af3',
  blueprintBlue: '#b6d9fc',
  emberGlow: '#e46d4c',
  signalBlue: '#027dea',
  deepTeal: '#269684',
  gridlineBlue: '#3f4959',

  // Glass/overlay
  glassEdge: 'rgba(186, 215, 247, 0.12)',
  luminousFill: 'rgba(199, 211, 234, 0.12)',
  frostedGlass: 'rgba(186, 214, 247, 0.03)',
  deepGlass: 'rgba(5, 6, 15, 0.97)',
  glassEdgeInset: 'rgba(186, 215, 247, 0.12)',
  glassHighlight: 'rgba(216, 236, 248, 0.2)',
  glassMidGlow: 'rgba(168, 216, 245, 0.06)',
  glassDrop: 'rgba(0, 0, 0, 0.3)',

  // Gradients
  iceHighlightGradient: 'linear-gradient(0deg, #d8ecf8 0%, #98c0ef 100%)',
  skyWashGradient: 'linear-gradient(0deg, #d8ecf8 0%, #98c0ef 100%)',
  gridlineGradient: 'rgba(186, 215, 247, 0.06)',
};

export const typography = {
  fontFamilies: {
    untitledSans: "'Untitled Sans', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    aeonikPro: "'aeonikPro', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    dotDigital: "'dotDigital', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },

  // Fallbacks for fonts that may not be available
  fontFamiliesFallback: {
    untitledSans: "'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    aeonikPro: "'Space Grotesk', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    dotDigital: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },

  scale: {
    caption: { size: '12px', lineHeight: '1.33', tracking: '0px' },
    bodySm: { size: '14px', lineHeight: '1.43', tracking: '0px' },
    body: { size: '16px', lineHeight: '1.5', tracking: '-0.16px' },
    subheading: { size: '18px', lineHeight: '1.33', tracking: '0px' },
    headingSm: { size: '24px', lineHeight: '1.17', tracking: '-0.24px' },
    heading: { size: '28px', lineHeight: '1.14', tracking: '0px' },
    headingLg: { size: '44px', lineHeight: '1.16', tracking: '0px' },
    display: { size: '48px', lineHeight: '1.17', tracking: '0px' },
  },

  weights: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
};

export const spacing = {
  base: '4px',
  scale: {
    4: '4px',
    8: '8px',
    12: '12px',
    16: '16px',
    20: '20px',
    24: '24px',
    32: '32px',
    36: '36px',
    40: '40px',
    48: '48px',
    56: '56px',
    100: '100px',
    120: '120px',
    200: '200px',
  },
  sectionGap: '120px',
  cardPadding: '24px',
  elementGap: '16px',
};

export const radius = {
  sm: '2px',
  md: '6px',
  lg: '10px',
  xl: '16px',
  '2xl': '24px',
  '3xl': '28px',
  '3xl-2': '44px',
  full: '999px',
  'full-2': '4999.5px',
  'full-3': '9999px',

  // Named radii
  cards: '16px',
  badges: '6px',
  inputs: '6px',
  modals: '16px',
  buttons: '999px',
  iconContainers: '9999px',
};

export const shadows = {
  sm: 'rgba(186, 207, 247, 0.32) 0px 0px 6px 0px',
  md: 'rgba(238, 186, 247, 0.24) 0px 0px 12px 0px',
  subtle: 'rgba(186, 215, 247, 0.12) 0px 0px 0px 1px inset',
  'subtle-2': 'rgba(199, 211, 234, 0.12) -0.5px 0.5px 1px 0px inset, rgba(186, 215, 247, 0.08) 0px 0px 96px 0px inset',
  'subtle-3': 'rgba(186, 214, 247, 0.06) 0px 0px 0px 1px inset',
  'subtle-4': 'rgba(199, 211, 234, 0.12) 0px 1px 1px 0px inset, rgba(199, 211, 234, 0.05) 0px 24px 48px 0px inset, rgba(6, 6, 14, 0.7) 0px 24px 32px 0px',
  'subtle-5': 'rgba(255, 255, 255, 0.1) 0px 0px 0px 1px inset',
  'subtle-6': 'rgba(216, 236, 248, 0.2) 0px 1px 1px 0px inset, rgba(168, 216, 245, 0.06) 0px 24px 48px 0px inset, rgba(0, 0, 0, 0.3) 0px 16px 32px 0px',
  'subtle-7': 'rgba(216, 236, 248, 0.2) 0px 1px 1px 0px inset, rgba(168, 216, 245, 0.06) 0px 24px 48px 0px inset',
  'subtle-8': 'rgba(216, 236, 248, 0.2) 0px 1px 1px 0px inset, rgba(168, 216, 245, 0.06) 0px 24px 48px 0px inset, rgba(199, 211, 234, 0.08) 0px 0px 0px 1px inset',
  'subtle-9': 'rgba(186, 214, 247, 0.24) 0px 0px 0px 1px inset',

  // Auth-form modal card elevation
  authCard: 'inset 0 1px 1px rgba(216, 236, 248, 0.2), inset 0 24px 48px rgba(168, 216, 245, 0.06), 0 16px 32px rgba(0, 0, 0, 0.3)',
  // Feature card elevation
  featureCard: 'inset 0 1px 1px rgba(199, 211, 234, 0.12), inset 0 24px 48px rgba(199, 211, 234, 0.05), 0 24px 32px rgba(6, 6, 14, 0.7)',
  // Glow halo behind hero
  glowHalo: '0 0 6px rgba(186, 207, 247, 0.32), 0 0 12px rgba(238, 186, 247, 0.24)',
};

export const layout = {
  pageMaxWidth: '1200px',
  sectionGap: '120px',
  cardPadding: '24px',
  elementGap: '16px',
};

export const surfaces = {
  level0: colors.midnightCanvas,      // Midnight Canvas
  level1: colors.steelPlate,          // Steel Plate
  level2: colors.frostedGlass,        // Frosted Glass
  level3: colors.deepGlass,           // Deep Glass
};

export const mentorTheme = {
  // Premium base palette (slate / warm amber / deep navy)
  base: '#ffffff',
  baseAlt: '#faf9f6',          // warm off-white background
  baseHover: '#f4f2ed',
  surface: '#ffffff',
  surfaceHover: '#fefefc',
  surfaceAlt: '#f8f6f1',
  textPrimary: '#1c1b1a',      // deep charcoal
  textSecondary: '#6b6763',
  textTertiary: '#9b9793',
  border: '#e8e5dc',
  borderStrong: '#d8d4ca',
  borderAccent: '#e6d6b0',     // warm amber border

  // Accent (warm amber — primary CTA / links)
  accent: '#b8860b',
  accentHover: '#9d7209',
  accentSoft: '#f3eada',
  accentBorder: '#e6d6b0',

  // Deep navy (for headings / premium contrast)
  navy: '#1e293b',
  navyHover: '#1e2a46',

  // Status
  success: '#16a34a',
  successSoft: '#dcfce7',
  warning: '#d97706',
  warningSoft: '#fef3c7',
  error: '#dc2626',
  errorSoft: '#fee2e2',

  // Glass
  glassHighlight: 'rgba(184, 134, 11, 0.04)',
  glassBorder: 'rgba(184, 134, 11, 0.12)',
  glassBg: 'rgba(255, 255, 255, 0.72)',

  // Gradients
  accentGradient: 'linear-gradient(135deg, #b8860b 0%, #9d7209 100%)',
  surfaceGradient: 'linear-gradient(180deg, #ffffff 0%, #faf9f6 100%)',
};

export const mentorTypography = {
  fontFamily: {
    body: "'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    heading: "'Space Grotesk', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
  scale: {
    h1: 'text-2xl font-bold tracking-tight sm:text-3xl',
    h2: 'text-xl font-bold tracking-tight',
    h3: 'text-sm font-bold text-zinc-950',
    bodySm: 'text-xs text-zinc-500',
    body: 'text-sm text-zinc-600',
    caption: 'text-[11px] text-zinc-400',
  },
};