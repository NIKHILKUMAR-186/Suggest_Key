import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/src/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'accent';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  loadingText?: string;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'default',
      size = 'md',
      isLoading = false,
      loadingText,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const variantStyles = {
      default: 'bg-[var(--color-shell-primary)] text-[var(--color-shell-text-contrast)] hover:bg-[var(--color-shell-primary-hover)] hover:shadow-[var(--shadow-md)] hover:-translate-y-0.5 active:scale-[0.98] shadow-sm transition-all duration-150',
      outline: 'border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-surface)] text-[var(--color-shell-text)] hover:bg-[var(--color-shell-bg)] hover:border-[var(--color-shell-border-strong)] active:scale-[0.98]',
      secondary: 'bg-[var(--color-shell-bg)] text-[var(--color-shell-text)] hover:bg-[var(--color-shell-bg-hover)] active:scale-[0.98]',
      ghost: 'text-[var(--color-shell-text-muted)] hover:bg-[var(--color-shell-bg)] hover:text-[var(--color-shell-text)]',
      destructive: 'bg-[var(--color-shell-error)] text-[var(--color-shell-text-contrast)] hover:bg-[var(--color-shell-error)]/90 shadow-sm active:scale-[0.98]',
      accent: 'bg-[var(--color-shell-accent)] text-[var(--color-shell-text-contrast)] hover:bg-[var(--color-shell-accent-hover)] shadow-sm active:scale-[0.98] font-semibold',
    };

    const sizeStyles = {
      sm: 'h-9 px-3 text-xs rounded-lg gap-1.5 min-h-[36px]',
      md: 'h-12 px-4 py-2 text-sm rounded-lg gap-2 min-h-[48px]',
      lg: 'h-12 px-6 text-base rounded-xl gap-2.5 min-h-[48px]',
    };

    const isDisabled = disabled || isLoading;

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        aria-busy={isLoading}
        className={cn(
          'inline-flex items-center justify-center font-medium transition-all select-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] focus-visible:ring-offset-2',
          'disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
          variantStyles[variant],
          sizeStyles[size],
          className
        )}
        {...props}
      >
        {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
        {isLoading && loadingText ? <span>{loadingText}</span> : children}
      </button>
    );
  }
);

Button.displayName = 'Button';