import React from 'react';
import { cn } from '@/src/lib/utils';
import { motion } from 'motion/react';

export interface MentorCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onAnimationStart' | 'onAnimationEnd' | 'onTransitionStart' | 'onTransitionEnd'> {
  variant?: 'default' | 'elevated' | 'glass';
  hoverable?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const paddingStyles = {
  none: '',
  sm: 'p-4',
  md: 'p-5 sm:p-6',
  lg: 'p-6 sm:p-8',
};

const variantStyles = {
  default: 'border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] shadow-xs',
  elevated: 'border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] shadow-md',
  glass: 'border border-[var(--color-shell-border)]/60 bg-[var(--color-shell-surface)]/80 backdrop-blur-sm shadow-sm',
};

export const MentorCard = React.forwardRef<HTMLDivElement, MentorCardProps>(
  ({ className, variant = 'default', hoverable = false, padding = 'md', children, ...props }, ref) => (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn(
        'rounded-2xl transition-all',
        variantStyles[variant],
        paddingStyles[padding],
        hoverable && 'hover:shadow-md hover:border-zinc-300 cursor-pointer',
        className
      )}
      {...(props as React.ComponentProps<typeof motion.div>)}
    >
      {children}
    </motion.div>
  )
);
MentorCard.displayName = 'MentorCard';