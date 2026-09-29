import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getSegmentTheme } from '@/src/lib/segmentThemes';
import { applySegmentCssVariables, deriveSegmentTheme } from '@/src/lib/segmentTheme';
import type { Segment } from '@/src/types/database';
import type { SegmentExperienceConfig } from '@/src/lib/segmentExperience';

interface SegmentThemeContextValue {
  /** The currently active segment (null = default brand theme) */
  activeSegment: Segment | null;
  /** Set the active segment — theme updates immediately */
  setActiveSegment: (segment: Segment | null) => void;
  /** Current segment slug for easy access */
  activeSegmentSlug: string | null;
  /** Whether a non-default segment theme is active */
  hasCustomTheme: boolean;
}

const SegmentThemeContext = createContext<SegmentThemeContextValue | null>(null);

interface SegmentThemeProviderProps {
  children: React.ReactNode;
  /** Initial segment (e.g., from server-side render or URL) */
  initialSegment?: Segment | null;
  /**
   * A live experience config, typically from `useSegmentExperience()`.
   * When supplied it takes precedence over the segment row's copy, so a realtime
   * update moves the theme as well as the content.
   */
  liveConfig?: SegmentExperienceConfig | null;
}

/**
 * Provider that manages the active segment's visual theme.
 *
 * It maintains a single `data-segment` attribute on the document root; the
 * `[data-segment="…"]` and `.dark[data-segment="…"]` rules in index.css turn
 * that into the full palette, so the theme cascades to every child and stays
 * in sync with light/dark mode automatically.
 */
export const SegmentThemeProvider: React.FC<SegmentThemeProviderProps> = ({
  children,
  initialSegment = null,
  liveConfig = null,
}) => {
  const [activeSegment, setActiveSegmentState] = useState<Segment | null>(initialSegment);

  // Stable identity — consumers put this in effect dependency arrays, so a new
  // function identity on every provider render would refetch in a loop.
  const setActiveSegment = useCallback((segment: Segment | null) => {
    setActiveSegmentState(segment);
  }, []);

  // Keep the provider in sync when the owner resolves the segment asynchronously
  // (e.g. segments load after first paint) — callers re-pass `initialSegment`
  // on every render, so it acts as the source of truth when supplied.
  useEffect(() => {
    setActiveSegmentState(initialSegment);
  }, [initialSegment]);

  // Unknown, empty or missing segments simply carry no attribute, which leaves
  // the `:root` default brand theme in place instead of crashing the page.
  const activeSegmentSlug = activeSegment?.slug ?? null;

  // The attribute is the single mechanism: `[data-segment="…"]` and
  // `.dark[data-segment="…"]` in index.css own every token. Nothing is written
  // inline, so light/dark and future token changes are pure CSS concerns.
  useEffect(() => {
    const root = document.documentElement;

    if (activeSegmentSlug) {
      root.setAttribute('data-segment', activeSegmentSlug);
    } else {
      root.removeAttribute('data-segment');
    }

    return () => {
      root.removeAttribute('data-segment');
    };
  }, [activeSegmentSlug]);

  // Config-driven appearance. The source of truth is the segment's
  // `experience_config`; the derived custom properties are written onto the
  // document root, so every descendant picks up the configured identity with no
  // per-component work and no slug lookup.
  //
  // `liveConfig` lets the owner hand down a fresher config than the one on the
  // cached segment row. Without it, a realtime update would change the rendered
  // content but leave the colours stale, because the row itself is not refetched.
  //
  // `data-segment` is still set above for the legacy `[data-segment="…"]` rules
  // in index.css, which remain a fallback for segments with no configured theme.
  useEffect(() => {
    const root = document.documentElement;

    const config = liveConfig ?? activeSegment?.experience_config;

    // Only override the custom properties when the segment actually configures
    // a theme. Otherwise the :root defaults (or the data-segment rules) stand.
    if (!config || Object.keys(config).length === 0) return;

    // Dark mode is resolved from the document so the palette matches the theme
    // the user is actually looking at.
    const isDark = root.classList.contains('dark');
    const theme = deriveSegmentTheme(config, isDark ? 'dark' : 'light');

    applySegmentCssVariables(root, theme.variables);

    // The palette differs between modes, so it has to be RE-DERIVED when the
    // user toggles the theme. Without this observer the inline custom
    // properties - which win over the stylesheet's `.dark[data-segment="…"]`
    // rules - would keep the light-mode accent after a toggle to dark.
    const observer = new MutationObserver(() => {
      const next = deriveSegmentTheme(config, root.classList.contains('dark') ? 'dark' : 'light');
      applySegmentCssVariables(root, next.variables);
      theme.variables = next.variables;
    });
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });

    return () => {
      observer.disconnect();
      // Remove only the properties this effect set, so a segment switch cannot
      // leave a stale accent behind on the root element.
      for (const name of Object.keys(theme.variables)) {
        root.style.removeProperty(name);
      }
    };
  }, [activeSegment, liveConfig]);

  const value = useMemo(
    () => ({
      activeSegment,
      setActiveSegment,
      activeSegmentSlug,
      hasCustomTheme: activeSegment !== null,
    }),
    [activeSegment, setActiveSegment, activeSegmentSlug]
  );

  return <SegmentThemeContext.Provider value={value}>{children}</SegmentThemeContext.Provider>;
};

/**
 * Hook to access the active segment theme.
 * Must be used within a SegmentThemeProvider.
 */
export function useSegmentTheme(): SegmentThemeContextValue {
  const ctx = useContext(SegmentThemeContext);
  if (!ctx) {
    throw new Error('useSegmentTheme must be used within a SegmentThemeProvider');
  }
  return ctx;
}

/**
 * Hook that returns only the active segment's theme tokens (light + dark).
 * Useful for components that need to read theme values directly.
 */
export function useSegmentThemeTokens(): { light: ReturnType<typeof getSegmentTheme>['light']; dark: ReturnType<typeof getSegmentTheme>['dark'] } {
  const { activeSegmentSlug } = useSegmentTheme();
  return getSegmentTheme(activeSegmentSlug);
}