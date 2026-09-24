import React from 'react';
import { cn } from '@/src/lib/utils';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { LoadingState } from '@/src/components/shared/LoadingState';
import type { LucideIcon } from 'lucide-react';

export interface MetricCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  description?: string;
  tone?: 'default' | 'success' | 'warning' | 'error' | 'info';
  className?: string;
}

const toneBorder: Record<NonNullable<MetricCardProps['tone']>, string> = {
  default: 'border-[var(--color-shell-border)]',
  success: 'border-[var(--color-shell-success)]/30',
  warning: 'border-[var(--color-shell-warning)]/30',
  error: 'border-[var(--color-shell-error)]/30',
  info: 'border-[var(--color-shell-border)]',
};

const toneIconBg: Record<NonNullable<MetricCardProps['tone']>, string> = {
  default: 'bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-text-muted)]',
  success: 'bg-[var(--color-shell-success-soft)] text-[var(--color-shell-success)]',
  warning: 'bg-[var(--color-shell-warning-soft)] text-[var(--color-shell-warning)]',
  error: 'bg-[var(--color-shell-error-soft)] text-[var(--color-shell-error)]',
  info: 'bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-text-muted)]',
};

export const MentorMetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  icon: Icon,
  description,
  tone = 'default',
  className,
}) => (
  <div
    className={cn(
      'rounded-xl border bg-[var(--color-shell-surface)] p-5 shadow-xs space-y-3',
      toneBorder[tone],
      className
    )}
  >
    <div className="flex items-start justify-between">
      <div className="space-y-1">
        <p className="text-xs font-medium text-[var(--color-shell-text-muted)] uppercase tracking-wider">
          {title}
        </p>
        <p className="text-2xl font-bold text-[var(--color-shell-text)]">{value}</p>
        {description && <p className="text-[11px] text-[var(--color-shell-text-subtle)]">{description}</p>}
      </div>
      <div className={cn('p-2.5 rounded-lg shrink-0', toneIconBg[tone])}>
        <Icon className="h-5 w-5" />
      </div>
    </div>
  </div>
);

export const MentorMetricsGrid: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <div className={cn('grid grid-cols-2 lg:grid-cols-4 gap-4', className)}>{children}</div>
);

export const MentorMetricsSkeleton: React.FC<{ count?: number }> = ({ count = 4 }) => (
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="rounded-xl border border-zinc-200 bg-white p-5 space-y-3 shadow-xs">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-12" />
          </div>
          <Skeleton variant="circular" className="h-9 w-9" />
        </div>
      </div>
    ))}
  </div>
);

export const MentorStateView: React.FC<{
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: LucideIcon;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  onRetry?: () => void;
  loadingMessage?: string;
  children: React.ReactNode;
}> = ({
  loading,
  error,
  empty,
  emptyTitle,
  emptyDescription,
  emptyIcon,
  emptyActionLabel,
  onEmptyAction,
  onRetry,
  loadingMessage = 'Loading…',
  children,
}) => {
  if (loading) {
    return (
      <LoadingState
        message={loadingMessage}
        className="min-h-[200px]"
      />
    );
  }
  if (error) {
    return (
      <ErrorState
        title="Unable to load"
        message={error}
        onRetry={onRetry}
        className="min-h-[200px]"
      />
    );
  }
  if (empty) {
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle || 'No data'}
        description={emptyDescription || 'There is nothing to display yet.'}
        actionLabel={emptyActionLabel}
        onAction={onEmptyAction}
      />
    );
  }
  return <>{children}</>;
};