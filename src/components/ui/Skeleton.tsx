import React from 'react';
import { cn } from '@/src/lib/utils';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'rectangular' | 'circular' | 'rounded';
  width?: string | number;
  height?: string | number;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  className,
  variant = 'rounded',
  width,
  height,
  style,
  ...props
}) => {
  const variantStyles = {
    rectangular: 'rounded-none',
    rounded: 'rounded-lg',
    circular: 'rounded-full',
  };

  const customStyle: React.CSSProperties = {
    ...(width !== undefined ? { width: typeof width === 'number' ? `${width}px` : width } : {}),
    ...(height !== undefined ? { height: typeof height === 'number' ? `${height}px` : height } : {}),
    ...style,
  };

  return (
    <div
      className={cn(
        'animate-pulse bg-gradient-to-r from-[var(--color-shell-surface-elevated)] via-[var(--color-shell-surface)] to-[var(--color-shell-surface-elevated)]',
        variantStyles[variant],
        className
      )}
      style={customStyle}
      aria-hidden="true"
      {...props}
    />
  );
};

export const SkeletonText: React.FC<{ lines?: number; className?: string }> = ({
  lines = 3,
  className,
}) => {
  return (
    <div className={cn('space-y-2', className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn(
            'h-3.5',
            i === lines - 1 ? 'w-3/5' : i === 0 ? 'w-full' : 'w-4/5'
          )}
        />
      ))}
    </div>
  );
};

export const SkeletonCard: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <div
      className={cn('rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-5 space-y-4 shadow-xs', className)}
      aria-hidden="true"
    >
      <div className="flex items-center gap-3">
        <Skeleton variant="circular" className="h-10 w-10 shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-1/4" />
        </div>
      </div>
      <SkeletonText lines={2} />
      <div className="flex items-center justify-between pt-2 border-t border-[var(--color-shell-border)]">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>
    </div>
  );
};

export const SkeletonTableRow: React.FC<{ cols?: number; className?: string }> = ({
  cols = 4,
  className,
}) => {
  return (
    <div className={cn('flex items-center justify-between py-3 px-4 border-b border-[var(--color-shell-border)] gap-4', className)} aria-hidden="true">
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton key={i} className={cn('h-4', i === 0 ? 'w-1/4' : 'w-1/6')} />
      ))}
    </div>
  );
};

