import React from 'react';
import { cn } from '@/src/lib/utils';
import { Button } from '@/src/components/ui/Button';
import type { LucideIcon } from 'lucide-react';

export interface MentorActionBannerProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  actionLabel?: string;
  onAction?: () => void;
  actionVariant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'accent';
  className?: string;
}

export const MentorActionBanner: React.FC<MentorActionBannerProps> = ({
  title,
  description,
  icon: Icon,
  actionLabel,
  onAction,
  actionVariant = 'default',
  className,
}) => {
  return (
    <div
      className={cn(
        'rounded-xl border border-[var(--color-shell-border)]',
        'bg-[var(--color-shell-primary-soft)]',
        'px-5 py-4 sm:px-6 sm:py-5',
        className
      )}
    >
      <div className="flex items-start gap-4">
        {Icon && (
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-shell-primary-soft)]">
            <Icon className="h-5 w-5 text-[var(--color-shell-primary)]" aria-hidden="true" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-[var(--color-shell-text)]">
            {title}
          </h3>
          {description && (
            <p className="mt-1 text-sm text-[var(--color-shell-text-muted)]">
              {description}
            </p>
          )}
        </div>
        {actionLabel && onAction && (
          <div className="ml-4 shrink-0">
            <Button onClick={onAction} variant={actionVariant} size="sm">
              {actionLabel}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
