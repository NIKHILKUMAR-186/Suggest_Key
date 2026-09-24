import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '@/src/lib/utils';
import { Button } from '@/src/components/ui/Button';

export interface SuccessStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  className?: string;
}

export const SuccessState: React.FC<SuccessStateProps> = ({
  icon: Icon = CheckCircle2,
  title,
  description,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  className,
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      role="status"
      aria-live="polite"
      className={cn(
        'flex min-h-[260px] w-full flex-col items-center justify-center rounded-2xl border border-[var(--color-shell-success)]/30 bg-[var(--color-shell-success-soft)] p-8 sm:p-12 text-center',
        className
      )}
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-shell-success-soft)] text-[var(--color-shell-success)] mb-4 border border-[var(--color-shell-success)]/30 shadow-xs">
        <Icon className="h-7 w-7" />
      </div>
      <h3 className="text-lg sm:text-xl font-bold text-[var(--color-shell-text)] tracking-tight">{title}</h3>
      <p className="mt-1.5 text-xs sm:text-sm text-[var(--color-shell-text-muted)] max-w-md leading-relaxed">{description}</p>
      
      {(actionLabel || secondaryActionLabel) && (
        <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
          {actionLabel && onAction && (
            <Button onClick={onAction} size="sm" className="bg-[var(--color-shell-success)] hover:bg-[var(--color-shell-success)]/80 text-white shadow-xs">
              {actionLabel}
            </Button>
          )}
          {secondaryActionLabel && onSecondaryAction && (
            <Button onClick={onSecondaryAction} variant="outline" size="sm" className="border-[var(--color-shell-success)]/40 text-[var(--color-shell-success)] hover:bg-[var(--color-shell-success-soft)]">
              {secondaryActionLabel}
            </Button>
          )}
        </div>
      )}
    </motion.div>
  );
};
