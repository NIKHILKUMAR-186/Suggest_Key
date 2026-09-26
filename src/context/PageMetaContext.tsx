import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigation } from '@/src/context/NavigationContext';
import { applyPageMeta, resolvePageMeta, type PageMeta } from '@/src/lib/pageMeta';

interface PageMetaContextValue {
  /** Page-specific override (e.g. the mentor name on a mentor profile). */
  override: Partial<PageMeta> | null;
  setOverride: (value: Partial<PageMeta> | null) => void;
}

const PageMetaContext = createContext<PageMetaContextValue | undefined>(undefined);

/**
 * Holds an optional page-specific metadata override. The override is bound to
 * the route it was set on, so it can never leak onto the next page.
 */
export const PageMetaProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<{ path: string; value: Partial<PageMeta> | null }>({
    path: '',
    value: null,
  });

  const { currentPath } = useNavigation();
  const pathname = currentPath.split('?')[0];

  // The setter reads the current route from a ref so its identity never
  // changes. A consumer effect may safely depend on it: writing an override
  // re-renders the provider, but it can never retrigger the effect that wrote
  // it, which is what an unstable setter would cause.
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const setOverride = useCallback((value: Partial<PageMeta> | null) => {
    const path = pathnameRef.current;
    setState((prev) => (prev.path === path && prev.value === value ? prev : { path, value }));
  }, []);

  const value = useMemo<PageMetaContextValue>(
    () => ({
      // An override recorded for a different route is stale: ignore it.
      override: state.path === pathname ? state.value : null,
      setOverride,
    }),
    [state.path, state.value, pathname, setOverride]
  );

  return <PageMetaContext.Provider value={value}>{children}</PageMetaContext.Provider>;
};

/**
 * Applies the resolved metadata to <head> for the current route.
 *
 * Rendered once next to the router so every page gets a correct title and
 * robots directive without each page having to remember to set one.
 */
export const PageMetaRunner: React.FC = () => {
  const { currentPath } = useNavigation();
  const context = useContext(PageMetaContext);
  const pathname = currentPath.split('?')[0];
  const override = context && context.override ? context.override : null;

  const meta = useMemo<PageMeta>(() => {
    const base = resolvePageMeta(pathname);
    if (!override) return base;
    return {
      name: override.name ?? base.name,
      // An override must never un-hide a private page to search engines.
      description: base.noindex ? '' : (override.description ?? base.description),
      noindex: base.noindex || override.noindex === true,
    };
  }, [pathname, override]);

  useEffect(() => {
    applyPageMeta(meta);
  }, [meta]);

  return null;
};

/**
 * Optional per-page metadata override.
 *
 * `usePageMeta({ name: mentor.full_name })` produces
 * "Suggest Key — <mentor name>" instead of the generic route title. Pass `null`
 * to fall back to the route default.
 */
export function usePageMeta(meta: Partial<PageMeta> | null) {
  const context = useContext(PageMetaContext);
  const { currentPath } = useNavigation();
  const pathname = currentPath.split('?')[0];
  const serialized = meta ? JSON.stringify(meta) : '';

  // Depend on the stable setter, never on the context object: the context value
  // is recreated on every override write, which would make this effect retrigger
  // itself forever.
  const setOverride = context ? context.setOverride : null;

  useEffect(() => {
    if (!setOverride) return;
    if (!meta) {
      setOverride(null);
      return;
    }
    setOverride(meta);
    return () => setOverride(null);
    // `serialized` keeps the effect stable for callers passing an inline object.
  }, [setOverride, pathname, serialized]);
}
