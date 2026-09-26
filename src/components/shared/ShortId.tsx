import React from 'react';
import { cn } from '@/src/lib/utils';

/**
 * Human-readable short form of an opaque identifier.
 *
 * A 36-character UUID forces the surrounding row to either truncate
 * arbitrarily or overflow on a phone. Showing the first 8 characters is enough
 * for a person to recognise a record, and the full value stays available as
 * the tooltip / accessible name so nothing becomes unreachable.
 */
export function shortId(id: string | null | undefined, length = 8): string {
  if (!id) return '—';
  const clean = String(id).replace(/-/g, '');
  if (clean.length <= length) return String(id);
  return clean.slice(0, length).toUpperCase();
}

export interface ShortIdProps {
  value: string | null | undefined;
  /** Human label for the record this id belongs to, e.g. "Booking". */
  label?: string;
  length?: number;
  className?: string;
}

/**
 * Renders `shortId` in a monospace, non-wrapping token that can never widen its
 * container. The full identifier is exposed through `title` and `aria-label`.
 */
export const ShortId: React.FC<ShortIdProps> = ({ value, label, length, className }) => {
  if (!value) return <span className={cn('text-[var(--color-shell-text-subtle)]', className)}>—</span>;
  const full = String(value);
  return (
    <span
      title={label ? `${label}: ${full}` : full}
      aria-label={label ? `${label} ${full}` : full}
      className={cn('font-mono text-[11px] tabular-nums tracking-tight text-[var(--color-shell-text-muted)]', className)}
    >
      {shortId(full, length)}
    </span>
  );
};
