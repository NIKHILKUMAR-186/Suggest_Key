import React from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@/src/lib/utils';

export interface MarketplaceBadgeProps {
  className?: string;
}

/**
 * Small trust / context indicator shown above the seeker hero headline.
 * Presentation only — carries no data of its own.
 */
export const MarketplaceBadge: React.FC<MarketplaceBadgeProps> = ({ className }) => (
  <span
    className={cn(
      'inline-flex items-center gap-2.5 rounded-full border border-[var(--seeker-trust-border)] bg-[var(--seeker-trust-bg)] px-3.5 py-1.5 text-[11px] font-semibold tracking-wide text-[var(--color-shell-text-muted)] backdrop-blur-sm',
      className
    )}
  >
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--seeker-trust-icon-bg)] text-[var(--color-shell-warning)]">
      <Sparkles className="h-3 w-3" aria-hidden="true" />
    </span>
    <span>Verified 1:1 Mentorship Marketplace</span>
  </span>
);
