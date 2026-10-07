import React from 'react';
import { cn } from '@/src/lib/utils';
import { Button } from '@/src/components/ui/Button';
import { Inbox } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';

export interface MentorEmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export const MentorEmptyState: React.FC<MentorEmptyStateProps> = ({
  icon: Icon = Inbox,
  title,
  description,
  actionLabel,
  onAction,
  className,
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={cn(
        'flex min-h-[320px] w-full flex-col items-center justify-center rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-8 sm:p-10 text-center',
        className
      )}
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-text-subtle)] mb-4 border border-[var(--color-shell-border)] shadow-xs">
        <Icon className="h-6 w-6 text-[var(--color-shell-text-subtle)]" />
      </div>
      <h3 className="text-base sm:text-lg font-bold text-[var(--color-shell-text)] tracking-tight">
        {title}
      </h3>
      <p className="mt-1.5 text-xs sm:text-sm text-[var(--color-shell-text-muted)] max-w-sm leading-relaxed">
        {description}
      </p>
      {actionLabel && onAction && (
        <Button onClick={onAction} variant="outline" size="sm" className="mt-6 font-medium shadow-xs">
          {actionLabel}
        </Button>
      )}
    </motion.div>
  );
};
