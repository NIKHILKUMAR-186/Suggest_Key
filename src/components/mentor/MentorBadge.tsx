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
  default: 'bg-zinc-900 text-zinc-50 border-transparent',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  destructive: 'bg-rose-50 text-rose-700 border-rose-200',
  info: 'bg-blue-50 text-blue-700 border-blue-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  confirmed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  completed: 'bg-blue-50 text-blue-700 border-blue-200',
  cancelled: 'bg-zinc-100 text-zinc-600 border-zinc-200',
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