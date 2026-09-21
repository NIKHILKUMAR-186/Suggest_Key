import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '@/src/lib/utils';
import { Button } from '@/src/components/ui/Button';

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
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
      role="status"
      className={cn(
        'flex min-h-[300px] w-full flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-white/60 p-8 sm:p-12 text-center',
        className
      )}
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100/90 text-zinc-500 mb-4 border border-zinc-200/60 shadow-xs">
        <Icon className="h-6 w-6 text-zinc-600" />
      </div>
      <h3 className="text-base sm:text-lg font-bold text-zinc-950 tracking-tight">{title}</h3>
      <p className="mt-1.5 text-xs sm:text-sm text-zinc-500 max-w-sm leading-relaxed">{description}</p>
      {actionLabel && onAction && (
        <Button onClick={onAction} variant="outline" size="sm" className="mt-6 font-medium shadow-xs">
          {actionLabel}
        </Button>
      )}
    </motion.div>
  );
};

