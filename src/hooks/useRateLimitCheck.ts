/**
 * Hook to check if the application is currently rate limited.
 * Used by polling hooks to pause during rate limit cooldown.
 */
import { useRateLimit } from '@/src/context/RateLimitContext';

export function useRateLimitCheck(): { isRateLimited: boolean; remainingSeconds: number } {
  const { isRateLimited, remainingSeconds } = useRateLimit();
  return { isRateLimited, remainingSeconds };
}