import React from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@/src/lib/utils';

export interface MarketplaceBadgeProps {
  className?: string;
}

export const MarketplaceBadge: React.FC<MarketplaceBadgeProps> = ({ className }) => (
  <span
    className={cn(
      'badge',
      className
    )}
    style={{
      background: 'var(--seeker-trust-bg)',
      color: 'var(--color-shell-text-muted)',
      border: '1px solid var(--seeker-trust-border)',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
    }}
  >
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--seeker-trust-icon-bg)] text-[var(--color-shell-warning)]">
      <Sparkles className="h-3 w-3" aria-hidden="true" />
    </span>
    <span>Verified 1:1 Mentorship Marketplace</span>
  </span>
);
