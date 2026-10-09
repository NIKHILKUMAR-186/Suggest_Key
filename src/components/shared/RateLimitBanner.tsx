/**
 * RateLimitBanner / RateLimitNotice — user-facing rate-limit notifications.
 *
 * The banner is mounted ONCE at the application root (see App.tsx) so that five
 * simultaneous 429 responses render exactly ONE countdown. The countdown is
 * derived from the absolute `retryAt` timestamp stored by the rate-limit manager,
 * which avoids timer drift and keeps ticking correctly when the tab is
 * backgrounded.
 *
 * Accessibility contract (fixed): the outer container is NOT a live region, and
 * the ticking seconds are marked `aria-live="off"`. Only a separate, visually
 * hidden live region announces the meaningful state changes - "paused" and
 * "cleared" plus a coarse duration bucket. Without that split, a polite live
 * region with `aria-atomic` re-announced the whole card once per second and made
 * the app unusable with a screen reader.
 */
import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Clock, RefreshCw, CheckCircle } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { formatRateLimitDuration, getRemainingSeconds } from '@/src/lib/rateLimitUtils';
import { useRateLimit } from '@/src/context/RateLimitContext';

/**
 * How the cooldown is described to assistive technology.
 *
 * Deliberately coarse: the value only changes every 30 seconds of the countdown
 * and once more when it clears, so a screen reader hears the transition instead
 * of every tick. Returns a NEW string only when the bucket changes, which is
 * what keeps the live region quiet in between.
 */
export function rateLimitAnnouncement(remaining: number, isReady: boolean): string {
  if (isReady) {
    return 'Rate limit cleared. You can try again now. You do not need to refresh this page.';
  }
  const bucket = Math.max(1, Math.ceil(remaining / 30)) * 30;
  return `Requests are paused for about ${bucket} seconds while the limit resets. You do not need to refresh this page.`;
}

export function RateLimitBanner() {
  const { isRateLimited, retryAt, remainingSeconds, clearRateLimit } = useRateLimit();

  if (!isRateLimited) return null;

  const remaining = retryAt ? getRemainingSeconds(retryAt) : remainingSeconds;
  const isReady = remaining <= 0;
  const duration = formatRateLimitDuration(remaining);
  const announcement = rateLimitAnnouncement(remaining, isReady);

  return (
    <AnimatePresence>
      {isRateLimited && (
        <motion.div
          key="rate-limit-banner"
          initial={{ opacity: 0, y: -20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.98 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          role="group"
          aria-label="Request pacing notice"
          className="fixed top-0 left-0 right-0 z-50 flex justify-center px-3 sm:px-4 pt-3"
        >
          <Card
            className={cn(
              'w-full max-w-lg border border-[var(--color-shell-warning)]/40 bg-[var(--color-shell-warning-soft)] shadow-lg',
            )}
          >
            <div className="p-4 sm:p-5">
              {/* The only live region on the card. It changes at a coarse cadence,
                  never once per second, so the countdown is never read aloud. */}
              <p className="sr-only" aria-live="polite" aria-atomic="true">
                {announcement}
              </p>

              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-shell-warning-soft)] border border-[var(--color-shell-warning)]/30 text-[var(--color-shell-warning)]">
                  {isReady ? (
                    <CheckCircle className="h-5 w-5" aria-hidden="true" />
                  ) : (
                    <Clock className="h-5 w-5" aria-hidden="true" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-[var(--color-shell-text)] tracking-tight">
                    Take a short pause
                  </h3>
                  <p className="mt-1 text-xs text-[var(--color-shell-text-muted)] max-w-md leading-relaxed">
                    You&apos;re making requests a little too quickly. We&apos;ve
                    temporarily paused new requests to keep things running
                    smoothly.
                  </p>
                </div>
              </div>

              <div className="mt-4">
                {isReady ? (
                  <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-shell-success)]">
                    <CheckCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>You&apos;re ready to try again.</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2" role="timer" aria-live="off">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-shell-warning)]/15 border border-[var(--color-shell-warning)]/30 px-3 py-1.5 text-sm font-mono font-semibold text-[var(--color-shell-warning)]"
                      aria-label={`Try again in ${duration}`}
                    >
                      <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="tabular-nums">Try again in {duration}</span>
                    </span>
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <p className="text-xs text-[var(--color-shell-text-subtle)]">
                  You don&apos;t need to refresh this page.
                </p>
                {isReady && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      // Clears the LOCAL cooldown only. It never re-submits
                      // anything, so a financial operation cannot be fired twice.
                      clearRateLimit();
                    }}
                    className="gap-1.5 border-[var(--color-shell-warning)]/40 text-[var(--color-shell-warning)] hover:bg-[var(--color-shell-warning-soft)] hover:border-[var(--color-shell-warning)]/60"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Try again</span>
                  </Button>
                )}
              </div>
            </div>

            {!isReady && (
              <motion.div
                key={`progress-${String(retryAt)}`}
                initial={{ scaleX: 1 }}
                animate={{ scaleX: 0 }}
                transition={{ duration: remaining, ease: 'linear' }}
                className="h-1 bg-[var(--color-shell-warning)]/40 origin-left"
                aria-hidden="true"
              />
            )}
          </Card>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * RateLimitNotice — inline version for embedding in specific UI areas (forms,
 * modals, etc.) rather than rendering the global banner.
 */
export function RateLimitNotice({
  className,
  onRetry,
}: {
  className?: string;
  onRetry?: () => void;
}) {
  const { isRateLimited, retryAt, remainingSeconds } = useRateLimit();

  if (!isRateLimited) return null;

  const remaining = retryAt ? getRemainingSeconds(retryAt) : remainingSeconds;
  const isReady = remaining <= 0;
  const duration = formatRateLimitDuration(remaining);
  const announcement = rateLimitAnnouncement(remaining, isReady);

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      role="group"
      aria-label="Request pacing notice"
      className={cn(
        'rounded-xl border border-[var(--color-shell-warning)]/40 bg-[var(--color-shell-warning-soft)] p-4',
        className,
      )}
    >
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-shell-warning-soft)] border border-[var(--color-shell-warning)]/30 text-[var(--color-shell-warning)]">
          {isReady ? (
            <CheckCircle className="h-4.5 w-4.5" aria-hidden="true" />
          ) : (
            <Clock className="h-4.5 w-4.5" aria-hidden="true" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-[var(--color-shell-text)]">
            {isReady ? 'Ready to continue' : 'Take a short pause'}
          </h4>
          <p className="mt-1 text-xs text-[var(--color-shell-text-muted)]">
            {isReady
              ? 'The rate limit has expired. You can now retry your action.'
              : "You're making requests a little too quickly. Please wait before trying again."}
          </p>
          {!isReady && (
            <div className="mt-2 flex items-center gap-2">
              <span
                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-shell-warning)]/15 border border-[var(--color-shell-warning)]/30 px-2.5 py-1 text-xs font-mono font-semibold text-[var(--color-shell-warning)]"
                aria-label={`Try again in ${duration}`}
                role="timer"
                aria-live="off"
              >
                <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="tabular-nums">Try again in {duration}</span>
              </span>
            </div>
          )}
          {isReady && onRetry && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRetry}
              className="mt-3 gap-1.5 border-[var(--color-shell-warning)]/40 text-[var(--color-shell-warning)] hover:bg-[var(--color-shell-warning-soft)] hover:border-[var(--color-shell-warning)]/60"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Try again</span>
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
