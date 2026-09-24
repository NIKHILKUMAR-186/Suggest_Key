import React from 'react';
import { cn } from '@/src/lib/utils';
import { motion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';

export interface MentorStatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: { value: string; label: string; positive?: boolean };
  className?: string;
}

export const MentorStatCard: React.FC<MentorStatCardProps> = ({
  title,
  value,
  icon: Icon,
  trend,
  className,
}) => (
  <motion.div
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.3 }}
    className={cn(
      'rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-5 sm:p-6 shadow-xs transition-shadow hover:shadow-sm',
      className
    )}
  >
    <div className="flex items-start justify-between">
      <div className="flex-1">
        <p className="text-xs font-medium text-[var(--color-shell-text-muted)] uppercase tracking-wider">
          {title}
        </p>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl sm:text-3xl font-bold text-[var(--color-shell-text)]">
            {value}
          </span>
          {trend && (
            <span
              className={cn(
                'text-xs font-semibold px-2 py-0.5 rounded-full',
                trend.positive
                  ? 'bg-[var(--color-shell-success-soft)] text-[var(--color-shell-success)]'
                  : 'bg-[var(--color-shell-error-soft)] text-[var(--color-shell-error)]'
              )}
            >
              {trend.value} {trend.label}
            </span>
          )}
        </div>
      </div>
      <div className="p-3 rounded-xl bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-accent)] shrink-0">
        <Icon className="h-5 w-5" />
      </div>
    </div>
  </motion.div>
);