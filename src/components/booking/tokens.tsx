import React from 'react';
import { cn } from '@/src/lib/utils';
import type { StatusTone } from '@/src/components/booking/statusTone';

/**
 * Token-driven tints for transactional surfaces.
 *
 * Every class references a `--color-shell-*` / `--status-*` custom property, so
 * a status looks correct in light mode, in dark mode, and under any active
 * segment theme. Hard-coded Tailwind palettes (emerald-600, amber-500 …) were
 * the reason these screens were the least polished part of the product: they
 * ignored both the theme switch and the dark-mode tokens.
 */
export const TONE_SURFACE: Record<StatusTone, string> = {
  success: 'border-[var(--color-shell-success)]/35 bg-[var(--color-shell-success-soft)]',
  warning: 'border-[var(--color-shell-warning)]/35 bg-[var(--color-shell-warning-soft)]',
  danger: 'border-[var(--color-shell-error)]/35 bg-[var(--color-shell-error-soft)]',
  info: 'border-[var(--color-shell-info)]/35 bg-[var(--color-shell-info-soft)]',
  neutral: 'border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)]',
};

export const TONE_TEXT: Record<StatusTone, string> = {
  success: 'text-[var(--color-shell-success)]',
  warning: 'text-[var(--color-shell-warning)]',
  danger: 'text-[var(--color-shell-error)]',
  info: 'text-[var(--color-shell-info)]',
  neutral: 'text-[var(--color-shell-text-muted)]',
};

export const TONE_CHIP: Record<StatusTone, string> = {
  success:
    'border-[var(--color-shell-success)]/35 bg-[var(--color-shell-success-soft)] text-[var(--color-shell-success)]',
  warning:
    'border-[var(--color-shell-warning)]/35 bg-[var(--color-shell-warning-soft)] text-[var(--color-shell-warning)]',
  danger:
    'border-[var(--color-shell-error)]/35 bg-[var(--color-shell-error-soft)] text-[var(--color-shell-error)]',
  info: 'border-[var(--color-shell-info)]/35 bg-[var(--color-shell-info-soft)] text-[var(--color-shell-info)]',
  neutral:
    'border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-text-muted)]',
};

export const TONE_DOT: Record<StatusTone, string> = {
  success: 'bg-[var(--color-shell-success)]',
  warning: 'bg-[var(--color-shell-warning)]',
  danger: 'bg-[var(--color-shell-error)]',
  info: 'bg-[var(--color-shell-info)]',
  neutral: 'bg-[var(--color-shell-text-subtle)]',
};

/** A small filled dot used to mark "live" without relying on colour alone. */
export function ToneDot({ tone, pulse = false }: { tone: StatusTone; pulse?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', TONE_DOT[tone], pulse && 'motion-safe:animate-pulse')}
    />
  );
}
