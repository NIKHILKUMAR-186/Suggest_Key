import React from 'react';
import { Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '@/src/lib/utils';

export interface LoadingStateProps {
  message?: string;
  description?: string;
  className?: string;
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  message = 'Loading data...',
  description,
  className,
}) => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      role="status"
      aria-live="polite"
      className={cn(
        'flex min-h-[220px] w-full flex-col items-center justify-center p-8 text-center',
        className
      )}
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--color-shell-surface-elevated)] mb-3 text-[var(--color-shell-accent)] shadow-xs border border-[var(--color-shell-border)]">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--color-shell-accent)]" />
      </div>
      <p className="text-sm font-semibold text-[var(--color-shell-text)] tracking-tight">{message}</p>
      {description && <p className="mt-1 text-xs text-[var(--color-shell-text-muted)] max-w-sm leading-relaxed">{description}</p>}
      <span className="sr-only">{message}</span>
    </motion.div>
  );
};

