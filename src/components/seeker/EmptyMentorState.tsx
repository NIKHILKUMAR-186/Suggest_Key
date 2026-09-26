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
  /** Optional real context line, e.g. "Relationship Advisor · 26 Sep". */
  contextLabel?: string | null;
  actions?: EmptyMentorStateAction[];
  className?: string;
}

/**
 * Intentional, compact empty state for the seeker marketplace.
 *
 * A zero-result response is a valid backend outcome, so it is presented as a
 * designed state rather than a blank rectangle. It never invents mentors.
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
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.25, ease: 'easeOut' }}
    role="status"
    className={cn(
      'seeker-empty-halo relative mx-auto flex w-full max-w-xl flex-col items-center rounded-3xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] px-6 py-10 text-center sm:px-10 sm:py-12',
      className
    )}
  >
    {Icon && (
      <>
        <div
          className="pointer-events-none absolute left-1/2 top-0 h-40 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--seeker-empty-halo)] opacity-40 blur-3xl"
          aria-hidden="true"
        />
        <div className="relative mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-primary)]">
          <Icon className="h-7 w-7" aria-hidden="true" />
        </div>
      </>
    )}

    <h3 className="relative font-display text-lg font-bold tracking-tight text-[var(--color-shell-text)] sm:text-xl">
      {title}
    </h3>
    <p className="relative mt-2 max-w-sm text-sm leading-relaxed text-[var(--color-shell-text-muted)]">
      {description}
    </p>

    {contextLabel && (
      <p className="relative mt-4 inline-flex items-center rounded-full border border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] px-3 py-1 font-mono text-[11px] font-medium text-[var(--color-shell-text-subtle)]">
        {contextLabel}
      </p>
    )}

    {actions.length > 0 && (
      <div className="relative mt-7 flex flex-wrap items-center justify-center gap-2.5">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            className={cn(
              'inline-flex min-h-[42px] cursor-pointer items-center justify-center gap-2 rounded-xl px-4 text-[13px] font-semibold transition-all duration-150 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--color-shell-focus)] focus-visible:outline-offset-2',
              action.variant === 'outline'
                ? 'border border-[var(--color-shell-border-strong)] bg-transparent text-[var(--color-shell-text-muted)] hover:border-[var(--color-shell-primary)]/50 hover:text-[var(--color-shell-text)]'
                : 'bg-[var(--color-shell-primary)] text-[var(--color-shell-text-contrast)] shadow-[var(--shadow-md)] hover:bg-[var(--color-shell-primary-hover)] active:scale-[0.98]'
            )}
          >
            {action.label}
          </button>
        ))}
      </div>
    )}
  </motion.div>
);
