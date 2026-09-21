import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/src/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive';
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
      default: 'bg-zinc-950 text-zinc-50 hover:bg-zinc-800 shadow-xs active:scale-[0.98]',
      outline: 'border border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50 hover:border-zinc-300 active:scale-[0.98]',
      secondary: 'bg-zinc-100 text-zinc-900 hover:bg-zinc-200/80 active:scale-[0.98]',
      ghost: 'text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950',
      destructive: 'bg-rose-600 text-white hover:bg-rose-700 shadow-xs active:scale-[0.98]',
    };

    const sizeStyles = {
      sm: 'h-8 px-3 text-xs rounded-lg gap-1.5 min-h-[32px]',
      md: 'h-10 px-4 py-2 text-sm rounded-lg gap-2 min-h-[40px]',
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
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2',
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

