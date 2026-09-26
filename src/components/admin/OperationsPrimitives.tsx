import React from 'react';
import { AlertTriangle, ArrowUpRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { Button } from '@/src/components/ui/Button';
import { getBookingStatusMeta, type BookingStatusTone } from '@/src/lib/adminDashboard';

const TONE_CLASSES: Record<BookingStatusTone, string> = {
  action: 'bg-[var(--status-warning-soft)] text-[var(--status-warning-strong)] border-[var(--status-warning-border)]',
  progress: 'bg-[var(--color-shell-info-soft)] text-[var(--status-info-strong)] border-[var(--status-info-border)]',
  confirmed: 'bg-[var(--status-success-soft)] text-[var(--status-success-strong)] border-[var(--status-success-border)]',
  done: 'bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-text-muted)] border-[var(--color-shell-border)]',
  closed: 'bg-[var(--status-error-soft)] text-[var(--status-error-strong)] border-[var(--status-error-border)]',
  neutral: 'bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-text-subtle)] border-[var(--color-shell-border)]',
};

/** Compact, theme-token driven status pill for a real booking state. */
export const StatusPill: React.FC<{ status: string | null | undefined; className?: string }> = ({
  status,
  className,
}) => {
  const meta = getBookingStatusMeta(status);
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide whitespace-nowrap',
        TONE_CLASSES[meta.tone],
        className,
      )}
    >
      {meta.label}
    </span>
  );
};

export const SectionCard: React.FC<{
  title: string;
  icon?: LucideIcon;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}> = ({ title, icon: Icon, subtitle, actionLabel, onAction, children, className, bodyClassName }) => (
  <section
    className={cn(
      'rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] shadow-xs flex flex-col',
      className,
    )}
  >
    <header className="flex items-start justify-between gap-3 border-b border-[var(--color-shell-border)] px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[13px] font-bold tracking-tight text-[var(--color-shell-text)]">
          {Icon ? <Icon className="h-4 w-4 shrink-0 text-[var(--color-shell-text-muted)]" /> : null}
          <span className="truncate">{title}</span>
        </h2>
        {subtitle ? (
          <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--color-shell-text-subtle)]">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actionLabel && onAction ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={onAction}
          className="h-8 min-h-[32px] shrink-0 gap-1 px-2 text-[11px] font-semibold"
        >
          {actionLabel}
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Button>
      ) : null}
    </header>
    <div className={cn('flex-1 px-4 py-3 sm:px-5', bodyClassName)}>{children}</div>
  </section>
);

/** Neutral, non-alarming placeholder for a panel that has nothing to show. */
export const PanelEmptyState: React.FC<{ title: string; description?: string; icon?: LucideIcon }> = ({
  title,
  description,
  icon: Icon = AlertTriangle,
}) => (
  <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--color-shell-border)] bg-[var(--color-shell-bg-hover)]/40 px-4 py-7 text-center">
    <Icon className="h-4 w-4 text-[var(--color-shell-text-subtle)]" />
    <p className="text-[12px] font-semibold text-[var(--color-shell-text-muted)]">{title}</p>
    {description ? (
      <p className="max-w-sm text-[11px] leading-relaxed text-[var(--color-shell-text-subtle)]">
        {description}
      </p>
    ) : null}
  </div>
);

/** Per-section failure state — one broken query never blanks the console. */
export const PanelErrorState: React.FC<{ message: string; onRetry?: () => void }> = ({
  message,
  onRetry,
}) => (
  <div
    role="alert"
    className="flex flex-col items-start gap-2 rounded-lg border border-[var(--color-shell-error)]/30 bg-[var(--color-shell-error-soft)] px-4 py-3"
  >
    <p className="text-[12px] font-semibold text-[var(--color-shell-error)]">{message}</p>
    {onRetry ? (
      <Button variant="outline" size="sm" onClick={onRetry} className="h-8 min-h-[32px] text-[11px]">
        Retry this section
      </Button>
    ) : null}
  </div>
);

/** Skeleton row used while a section's real value is still loading. */
export const MetricSkeleton: React.FC<{ lines?: number }> = ({ lines = 1 }) => (
  <div className="space-y-2" aria-hidden="true">
    {Array.from({ length: lines }).map((_, index) => (
      <Skeleton key={index} className={cn('h-3', index === 0 ? 'w-2/5' : 'w-3/5')} />
    ))}
  </div>
);

export interface ActionQueueCardProps {
  icon: LucideIcon;
  title: string;
  count: number | null;
  description: string;
  emptyDescription: string;
  href: string;
  ctaLabel: string;
  isLoading: boolean;
  error: string | null;
  onNavigate: (href: string) => void;
  onRetry?: () => void;
}

/**
 * An operational queue card. The count is always the real database value;
 * warning styling is applied ONLY when the queue is genuinely non-empty.
 */
export const ActionQueueCard: React.FC<ActionQueueCardProps> = ({
  icon: Icon,
  title,
  count,
  description,
  emptyDescription,
  href,
  ctaLabel,
  isLoading,
  error,
  onNavigate,
  onRetry,
}) => {
  const isEmpty = count === 0;

  return (
    <div
      className={cn(
        'relative flex h-full flex-col overflow-hidden rounded-xl border p-4 shadow-xs transition-colors',
        error
          ? 'border-[var(--color-shell-error)]/30 bg-[var(--color-shell-error-soft)]'
          : isEmpty
            ? 'border-[var(--color-shell-border)] bg-[var(--color-shell-surface)]'
            : 'border-[var(--status-warning-border)] bg-[var(--status-warning-soft)]',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-2 text-[12px] font-bold text-[var(--color-shell-text)]">
          <Icon
            className={cn(
              'h-4 w-4',
              !error && !isEmpty
                ? 'text-[var(--status-warning-strong)]'
                : 'text-[var(--color-shell-text-muted)]',
            )}
          />
          {title}
        </span>
        {!error && !isLoading && !isEmpty ? (
          <span className="rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-[var(--status-warning-strong)] text-white">
            Action required
          </span>
        ) : null}
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        {isLoading ? (
          <Skeleton className="h-8 w-12" />
        ) : error ? (
          <span className="text-[11px] font-semibold text-[var(--color-shell-error)]">Unavailable</span>
        ) : (
          <span
            className={cn(
              'text-3xl font-black leading-none tabular-nums',
              isEmpty ? 'text-[var(--color-shell-text-muted)]' : 'text-[var(--status-warning-strong)]',
            )}
          >
            {count}
          </span>
        )}
      </div>

      <p className="mt-2 flex-1 text-[12px] leading-relaxed text-[var(--color-shell-text-muted)]">
        {error
          ? 'This queue could not be read from the database.'
          : isEmpty
            ? emptyDescription
            : description}
      </p>

      <div className="mt-3">
        {error ? (
          onRetry ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onRetry}
              className="h-auto min-h-[32px] text-[11px] font-semibold"
            >
              Retry
            </Button>
          ) : null
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onNavigate(href)}
            className="h-auto min-h-0 px-0 text-[11px] font-bold text-[var(--color-shell-primary)] hover:text-[var(--color-shell-primary)] underline-offset-4 hover:underline hover:bg-transparent"
          >
            {ctaLabel}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
};

/** Read-only KPI tile. Never renders `0` while the value is still loading. */
export const MetricTile: React.FC<{
  label: string;
  icon: LucideIcon;
  value: number | null;
  hint?: string;
  isLoading: boolean;
  error?: string | null;
  onClick?: () => void;
}> = ({ label, icon: Icon, value, hint, isLoading, error, onClick }) => (
  <div
    onClick={onClick}
    className={cn(
      'rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-4 shadow-xs',
      onClick && 'cursor-pointer transition-colors hover:border-[var(--color-shell-border-strong)]',
    )}
  >
    <div className="flex items-center gap-2 text-[11px] font-semibold text-[var(--color-shell-text-subtle)]">
      <Icon className="h-3.5 w-3.5" />
      <span className="truncate">{label}</span>
    </div>
    {isLoading ? (
      <Skeleton className="mt-2.5 h-7 w-14" />
    ) : error ? (
      <p className="mt-2 text-[11px] font-semibold text-[var(--color-shell-error)]">Unavailable</p>
    ) : (
      <p className="mt-2 text-2xl font-black leading-none tabular-nums text-[var(--color-shell-text)]">
        {value ?? 0}
      </p>
    )}
    {hint && !isLoading && !error ? (
      <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-shell-text-subtle)]">{hint}</p>
    ) : null}
  </div>
);
