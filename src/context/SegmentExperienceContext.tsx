import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { fetchSegmentExperience } from '@/src/lib/discoveryService';
import { useSegmentExperienceRealtime } from '@/src/hooks/useSegmentExperienceRealtime';
import {
  getSegmentExperienceFallback,
  normalizeSegmentExperience,
  type SegmentExperienceConfig,
} from '@/src/lib/segmentExperience';

export interface SegmentExperienceContextValue {
  /** The normalized config for the active segment. Never null. */
  config: SegmentExperienceConfig;
  /** True only for the very first load of a slug. */
  isLoading: boolean;
  /** A safe, user-facing message, or null. */
  error: string | null;
  /** The slug currently loaded. */
  slug: string | null;
  /** True once at least one successful load or realtime update has landed. */
  isReady: boolean;
  /** True when the segment has no configured experience at all. */
  isFallback: boolean;
  /** Re-run the initial fetch for the active slug. */
  reload: () => void;
}

const SegmentExperienceContext = createContext<SegmentExperienceContextValue | null>(null);

export interface SegmentExperienceProviderProps {
  children: React.ReactNode;
  /** The active segment slug. Changing it swaps config and resubscribes. */
  slug: string | null;
  /** Set false to keep the provider mounted but inert. */
  enabled?: boolean;
}

/** True when a config carries no renderable content at all. */
function isEmptyConfig(config: SegmentExperienceConfig): boolean {
  return Object.keys(config).length === 0;
}

/**
 * Owns the active segment's experience configuration.
 *
 * Flow:
 *
 *   slug changes
 *     -> fetch once for that slug
 *     -> normalize the response
 *     -> subscribe to that segment's row via Supabase Realtime
 *     -> on a row UPDATE, normalize the payload and replace the config
 *
 * Switching segments unsubscribes the previous channel before subscribing the
 * next, so exactly one subscription exists per mounted provider and no event
 * from a previously-viewed segment can land on the new one.
 *
 * There is NO polling: no setInterval, no focus or visibility refetch, and no
 * self-triggering effect. Updates are event-driven only.
 */
export const SegmentExperienceProvider: React.FC<SegmentExperienceProviderProps> = ({
  children,
  slug,
  enabled = true,
}) => {
  const [config, setConfig] = useState<SegmentExperienceConfig>(() =>
    getSegmentExperienceFallback(),
  );
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(slug));
  const [error, setError] = useState<string | null>(null);
  const [loadedSlug, setLoadedSlug] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState<number>(0);

  // Guards every state write: an in-flight request for a segment the user has
  // already navigated away from must not overwrite the current config.
  const activeSlugRef = useRef<string | null>(slug);
  activeSlugRef.current = slug;

  // Clear immediately on switch so no content from the previous segment is ever
  // visible under the new one.
  useEffect(() => {
    setConfig(getSegmentExperienceFallback());
    setError(null);
    setLoadedSlug(null);
    setIsLoading(Boolean(slug));
  }, [slug]);

  useEffect(() => {
    if (!enabled || !slug) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        const { experience, error: fetchError } = await fetchSegmentExperience(slug);
        if (cancelled) return;
        // A slow response for a segment we are no longer viewing is discarded.
        if (activeSlugRef.current !== slug) return;

        if (fetchError) {
          // A recoverable error keeps the safe fallback rather than a raw message.
          setError(fetchError.message);
          setConfig(getSegmentExperienceFallback());
          return;
        }

        setConfig(experience?.experience_config ?? getSegmentExperienceFallback());
        setLoadedSlug(slug);
      } catch {
        if (cancelled) return;
        setError('Unable to load this experience right now.');
        setConfig(getSegmentExperienceFallback());
      } finally {
        if (!cancelled && activeSlugRef.current === slug) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug, enabled, reloadToken]);

  const handleRealtimeConfig = useCallback((next: SegmentExperienceConfig) => {
    // The hook is already slug-scoped, but re-normalising here guarantees a
    // malformed or hostile payload can never reach the renderer.
    setConfig(normalizeSegmentExperience(next));
  }, []);

  useSegmentExperienceRealtime({
    slug: enabled ? slug : null,
    onConfigChange: handleRealtimeConfig,
  });

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  const value = useMemo<SegmentExperienceContextValue>(
    () => ({
      config,
      isLoading,
      error,
      slug,
      isReady: loadedSlug !== null,
      isFallback: isEmptyConfig(config),
      reload,
    }),
    [config, isLoading, error, slug, loadedSlug, reload],
  );

  return (
    <SegmentExperienceContext.Provider value={value}>{children}</SegmentExperienceContext.Provider>
  );
};

/**
 * Read the active segment experience.
 *
 * Returns a safe default outside a provider rather than throwing, so a component
 * can never crash the page because a provider was omitted in a preview context.
 */
export function useSegmentExperience(): SegmentExperienceContextValue {
  const ctx = useContext(SegmentExperienceContext);
  if (ctx) return ctx;

  return {
    config: getSegmentExperienceFallback(),
    isLoading: false,
    error: null,
    slug: null,
    isReady: false,
    isFallback: true,
    reload: () => undefined,
  };
}
