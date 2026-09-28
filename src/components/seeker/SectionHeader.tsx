import React from 'react';
import { cn } from '@/src/lib/utils';

export interface SectionHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  id?: string;
}

/**
 * Reusable section header with consistent visual hierarchy.
 *
 * Used across discovery sections for:
 * - Consistent eyebrow + title + description pattern
 * - Badge/actions alignment
 * - Responsive wrapping
 */
export const SectionHeader: React.FC<SectionHeaderProps> = ({
  eyebrow,
  title,
  description,
  badge,
  actions,
  className,
  id,
}) => {
  return (
    <div className={cn('section-header', className)}>
      <div className="section-header-content">
        {eyebrow && (
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-shell-text-subtle)]">
            {eyebrow}
          </p>
        )}
        <h2
          id={id}
          className="mt-2.5 font-display text-2xl font-bold leading-tight tracking-tight text-[var(--color-shell-text)] sm:text-3xl"
        >
          {title}
        </h2>
        {description && (
          <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-[var(--color-shell-text-muted)]">
            {description}
          </p>
        )}
      </div>

      {(badge || actions) && (
        <div className="section-header-actions">
          {badge}
          {actions}
        </div>
      )}
    </div>
  );
};
