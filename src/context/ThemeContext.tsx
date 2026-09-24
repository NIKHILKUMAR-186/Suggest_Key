import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'sk-theme-mode';
export const THEME_TRANSITION_CLASS = 'theme-transition';
export const THEME_TRANSITION_MS = 220;

function getStoredMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    /* localStorage unavailable */
  }
  return 'system';
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? getSystemTheme() : mode;
}

function applyThemeToDocument(theme: ResolvedTheme) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.classList.remove('light', 'dark');
  root.classList.add(theme);
  root.style.colorScheme = theme;

  // Keep native widgets (scrollbars, inputs, autofill) consistent + update browser UI color.
  const bg = theme === 'dark' ? '#05060f' : '#f4f7fc';
  root.style.backgroundColor = bg;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', bg);
}

interface ThemeContextValue {
  /** The user-selected preference: 'light' | 'dark' | 'system' */
  mode: ThemeMode;
  /** The theme actually rendered right now (resolves 'system') */
  theme: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  /** Convenience toggle between light and dark (resolves from current render) */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Global theme provider.
 *
 * Initial state is read from localStorage ('sk-theme-mode'). When no explicit
 * preference is stored, the OS/browser preference is used ('system').
 *
 * A pre-paint script (public/theme-early.js) has already applied the correct
 * theme class to <html> BEFORE first render — this provider simply syncs
 * React state with it, then keeps <html> in sync on changes.
 */
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<ThemeMode>(() => getStoredMode());
  const [theme, setTheme] = useState<ResolvedTheme>(() => resolveTheme(getStoredMode()));

  // Re-apply on mount (covers HMR remounts) and keep in sync when 'system'.
  useEffect(() => {
    const resolved = resolveTheme(mode);
    setTheme(resolved);
    applyThemeToDocument(resolved);

    if (mode !== 'system') return;

    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const next = getSystemTheme();
      setTheme(next);
      applyThemeToDocument(next);
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    const root = document.documentElement;

    // Short, polished transition — only while switching (avoids polluting interactions).
    root.classList.add(THEME_TRANSITION_CLASS);
    window.setTimeout(() => root.classList.remove(THEME_TRANSITION_CLASS), THEME_TRANSITION_MS);

    setModeState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* persistence is best-effort */
    }
  }, []);

  const toggle = useCallback(() => {
    setMode(resolveTheme(getStoredMode()) === 'dark' ? 'light' : 'dark');
  }, [setMode]);

  const value = useMemo(
    () => ({ mode, theme, setMode, toggle }),
    [mode, theme, setMode, toggle]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}