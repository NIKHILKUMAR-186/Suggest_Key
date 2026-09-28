import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '@/src/lib/utils';

export interface EmptyMentorStateAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'outline';
}

export interface EmptyMentorStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  contextLabel?: string | null;
  actions?: EmptyMentorStateAction[];
  className?: string;
}

/**
 * Intentional, compact empty state for the seeker marketplace.
 *
 * Enhanced with:
 * - Better icon treatment with segment-aware glow
 * - Improved typography hierarchy
 * - Better action button styling
 * - Subtle ambient background
 */
export const EmptyMentorState: React.FC<EmptyMentorStateProps> = ({
  icon: Icon,
  title,
  description,
  contextLabel,
  actions = [],
  className,
}) => (
  <motion.div
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.35, ease: 'easeOut' }}
    role="status"
    className={cn(
      'seeker-empty-halo relative mx-auto flex w-full max-w-2xl flex-col items-center rounded-3xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] px-6 py-10 text-center sm:px-10 sm:py-12',
      className
    )}
  >
    {/* Ambient glow */}
    <div
      className="pointer-events-none absolute left-1/2 top-0 h-48 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--seeker-empty-halo)] opacity-30 blur-3xl"
      aria-hidden="true"
    />

    {Icon && (
      <div className="relative mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-primary)] shadow-sm">
        <Icon className="h-7 w-7" aria-hidden="true" />
      </div>
    )}

    <h3 className="relative font-display text-xl font-bold tracking-tight text-[var(--color-shell-text)] sm:text-2xl">
      {title}
    </h3>
    <p className="relative mt-3 max-w-md text-sm leading-relaxed text-[var(--color-shell-text-muted)]">
      {description}
    </p>

    {contextLabel && (
      <p className="relative mt-5 inline-flex items-center rounded-full border border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] px-4 py-1.5 font-mono text-[11px] font-medium text-[var(--color-shell-text-subtle)]">
        {contextLabel}
      </p>
    )}

    {actions.length > 0 && (
      <div className="relative mt-7 flex flex-wrap items-center justify-center gap-3">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            className={cn(
              'inline-flex min-h-[48px] cursor-pointer items-center justify-center gap-2 rounded-xl px-5 text-[14px] font-semibold transition-all duration-150 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--color-shell-focus)] focus-visible:outline-offset-2',
              action.variant === 'outline'
                ? 'border border-[var(--color-shell-border-strong)] bg-transparent text-[var(--color-shell-text-muted)] hover:border-[var(--color-shell-primary)]/50 hover:text-[var(--color-shell-text)] hover:bg-[var(--color-shell-bg)]'
                : 'bg-[var(--color-shell-primary)] text-[var(--color-shell-text-contrast)] shadow-[var(--shadow-md)] hover:bg-[var(--color-shell-primary-hover)] hover:shadow-[var(--shadow-lg)] active:scale-[0.98]'
            )}
          >
            {action.label}
          </button>
        ))}
      </div>
    )}
  </motion.div>
);
