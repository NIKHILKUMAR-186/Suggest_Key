import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/src/lib/utils';

export interface PageHeadingProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Renders a back link above the title. */
  back?: { label: string; onClick: () => void };
  /** Status chip, filter tabs or similar control aligned to the right. */
  aside?: React.ReactNode;
  eyebrow?: string;
  className?: string;
  children?: React.ReactNode;
}

/**
 * The page header used across the seeker account area.
 *
 * Centralised so the back affordance, the heading scale and the gutter are
 * identical on the booking, payment, session and account pages. It wraps in a
 * `<header>` so each page still exposes exactly one top-level landmark.
 */
export const PageHeading: React.FC<PageHeadingProps> = ({
  title,
  description,
  back,
  aside,
  eyebrow,
  className,
  children,
}) => (
  <header className={cn('space-y-4', className)}>
    {back && (
      <button
        type="button"
        onClick={back.onClick}
        className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg px-1.5 text-[13px] font-medium text-[var(--color-shell-text-muted)] transition-colors hover:text-[var(--color-shell-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] focus-visible:ring-offset-2"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        <span>{back.label}</span>
      </button>
    )}

    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--color-shell-text-subtle)]">
            {eyebrow}
          </p>
        )}
        <h1 className="font-display text-2xl font-bold leading-tight tracking-tight text-[var(--color-shell-text)] sm:text-[28px]">
          {title}
        </h1>
        {description && (
          <div className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[var(--color-shell-text-muted)]">
            {description}
          </div>
        )}
      </div>
      {aside && <div className="flex shrink-0 flex-wrap items-center gap-2">{aside}</div>}
    </div>

    {children}
  </header>
);

export interface SegmentedTabsProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ id: T; label: string; count?: number }>;
  ariaLabel: string;
  className?: string;
}

/**
 * Tab-style filter control with roving `aria-selected` semantics.
 *
 * Replaces the hand-rolled underline-tab strips these pages used, whose active
 * state was pinned to a literal Tailwind palette value. The active tab is now
 * defined by the theme tokens in both modes and under any segment theme, and
 * the whole strip is keyboard reachable as a real tablist.
 */
export function SegmentedTabs<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: SegmentedTabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'flex flex-wrap items-center gap-1 rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] p-1.5',
        className
      )}
    >
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.id)}
            className={cn(
              'inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-semibold transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-shell-surface-elevated)]',
              selected
                ? 'border-[var(--segment-border-accent)] bg-[var(--color-shell-surface)] text-[var(--color-shell-text)] shadow-xs'
                : 'border-transparent text-[var(--color-shell-text-muted)] hover:bg-[var(--color-shell-surface)] hover:text-[var(--color-shell-text)]'
            )}
          >
            <span>{option.label}</span>
            {typeof option.count === 'number' && option.count > 0 && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums',
                  selected
                    ? 'bg-[var(--segment-accent-soft)] text-[var(--color-shell-text)]'
                    : 'bg-[var(--color-shell-bg-hover)] text-[var(--color-shell-text-muted)]'
                )}
              >
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
