import React from 'react';
import { cn } from '@/src/lib/utils';

export type MentorBadgeVariant =
  | 'default'
  | 'success'
  | 'warning'
  | 'destructive'
  | 'info'
  | 'pending'
  | 'confirmed'
  | 'completed'
  | 'cancelled';

export interface MentorBadgeProps {
  children: React.ReactNode;
  variant?: MentorBadgeVariant;
  size?: 'sm' | 'md';
  className?: string;
}

const variantStyles: Record<MentorBadgeVariant, string> = {
  default: 'bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-text)] border-transparent',
  success: 'bg-[var(--color-shell-success-soft)] text-[var(--color-shell-success)] border-[var(--color-shell-success)]/30',
  warning: 'bg-[var(--color-shell-warning-soft)] text-[var(--color-shell-warning)] border-[var(--color-shell-warning)]/30',
  destructive: 'bg-[var(--color-shell-error-soft)] text-[var(--color-shell-error)] border-[var(--color-shell-error)]/30',
  info: 'bg-[var(--color-shell-info-soft)] text-[var(--color-shell-info)] border-[var(--color-shell-info)]/30',
  pending: 'bg-[var(--color-shell-warning-soft)] text-[var(--color-shell-warning)] border-[var(--color-shell-warning)]/30',
  confirmed: 'bg-[var(--color-shell-success-soft)] text-[var(--color-shell-success)] border-[var(--color-shell-success)]/30',
  completed: 'bg-[var(--color-shell-info-soft)] text-[var(--color-shell-info)] border-[var(--color-shell-info)]/30',
  cancelled: 'bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-text-muted)] border-[var(--color-shell-border)]',
};

const sizeStyles = {
  sm: 'px-2 py-0.5 text-[10px]',
  md: 'px-2.5 py-0.5 text-xs',
};

export const MentorBadge: React.FC<MentorBadgeProps> = ({
  children,
  variant = 'default',
  size = 'md',
  className,
}) => (
  <span
    className={cn(
      'inline-flex items-center rounded-full border font-semibold whitespace-nowrap',
      variantStyles[variant],
      sizeStyles[size],
      className
    )}
  >
    {children}
  </span>
);