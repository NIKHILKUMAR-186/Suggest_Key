import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'sk-theme-mode';
export const THEME_TRANSITION_CLASS = 'theme-transition';
export const THEME_TRANSITION_MS = 220;
export const DEFAULT_THEME_MODE: ThemeMode = 'light';

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyThemeToDocument(theme: ResolvedTheme) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.classList.remove('light', 'dark');
  root.classList.add(theme);
  root.style.colorScheme = theme;

  const bg = theme === 'dark' ? '#05060f' : '#f4f7fc';
  root.style.backgroundColor = bg;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', bg);
}

interface ThemeContextValue {
  mode: ThemeMode;
  theme: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Global theme provider.
 *
 * Theme switching is temporarily disabled: the application always resolves
 * to Light Mode regardless of any previously persisted preference.
 * The existing theme infrastructure (context API, CSS variables, data-theme
 * attribute, SegmentThemeContext observers) is preserved so it can be
 * re-enabled later without rebuilding the styling system.
 */
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<ResolvedTheme>('light');

  useEffect(() => {
    applyThemeToDocument('light');
  }, []);

  const setMode = useCallback((_next: ThemeMode) => {
    setTheme('light');
    applyThemeToDocument('light');
  }, []);

  const toggle = useCallback(() => {
    setTheme('light');
    applyThemeToDocument('light');
  }, []);

  const value = useMemo(
    (): ThemeContextValue => ({ mode: 'light', theme, setMode, toggle }),
    [theme, setMode, toggle]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}