/**
 * Global Rate Limit Context
 *
 * React view over the framework-agnostic `rateLimitManager` singleton.
 * There is exactly ONE source of truth for rate-limit state (the manager);
 * this context only bridges it into React so components can re-render and the
 * RateLimitBanner can mount/unmount via AnimatePresence.
 *
 * State shape mirrors the manager's snapshot:
 *   { isRateLimited, retryAt, remainingSeconds, message }
 */
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  rateLimitManager,
  type RateLimitState,
} from '@/src/lib/rateLimitManager';

export type { RateLimitState };

export interface RateLimitContextValue extends RateLimitState {
  clearRateLimit: () => void;
}

const RateLimitContext = createContext<RateLimitContextValue | null>(null);

export function RateLimitProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RateLimitState>(() => rateLimitManager.getSnapshot());

  useEffect(() => {
    return rateLimitManager.subscribe(() => {
      setState(rateLimitManager.getSnapshot());
    });
  }, []);

  const clearRateLimit = () => rateLimitManager.clear();

  const value = useMemo<RateLimitContextValue>(
    () => ({ ...state, clearRateLimit }),
    [state, clearRateLimit],
  );

  return (
    <RateLimitContext.Provider value={value}>
      {children}
    </RateLimitContext.Provider>
  );
}

export function useRateLimit(): RateLimitContextValue {
  const context = useContext(RateLimitContext);
  if (!context) {
    throw new Error('useRateLimit must be used within a RateLimitProvider');
  }
  return context;
}
