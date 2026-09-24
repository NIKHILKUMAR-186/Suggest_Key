import React from 'react';
import { cn } from '@/src/lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive';
}

export const Badge: React.FC<BadgeProps> = ({
  className,
  variant = 'default',
  ...props
}) => {
  const variantStyles = {
    default: 'bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-text)] border-[var(--color-shell-border)]',
    secondary: 'bg-[var(--color-shell-bg)] text-[var(--color-shell-text-muted)] border-[var(--color-shell-border)]',
    outline: 'text-[var(--color-shell-text)] border-[var(--color-shell-border)]',
    success: 'bg-[var(--color-shell-success-soft)] text-[var(--color-shell-success)] border-[var(--color-shell-success)]/30',
    warning: 'bg-[var(--color-shell-warning-soft)] text-[var(--color-shell-warning)] border-[var(--color-shell-warning)]/30',
    destructive: 'bg-[var(--color-shell-error-soft)] text-[var(--color-shell-error)] border-[var(--color-shell-error)]/30',
  };

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap transition-colors',
        variantStyles[variant],
        className
      )}
      {...props}
    />
  );
};
