import React from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/src/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string | null;
  helperText?: string;
  success?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', label, error, helperText, success, id, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : generatedId);
    const errorId = error ? `${inputId}-error` : undefined;
    const helperId = helperText ? `${inputId}-helper` : undefined;

    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label htmlFor={inputId} className="block text-xs font-semibold text-[var(--color-shell-text)]">
            {label}
            {props.required && <span className="text-[var(--color-shell-error)] ml-0.5">*</span>}
          </label>
        )}
        <div className="relative">
          <input
            id={inputId}
            type={type}
            ref={ref}
            aria-invalid={!!error}
            aria-describedby={errorId || helperId}
            className={cn(
              'flex h-12 w-full rounded-lg border bg-[var(--color-shell-surface)] px-3 py-2 text-base text-[var(--color-shell-text)] placeholder:text-[var(--color-shell-text-subtle)] transition-all',
              'border-[var(--color-shell-border-strong)] focus:border-[var(--color-shell-accent)] focus:outline-none focus:ring-3 focus:ring-[rgba(184,134,11,0.12)]',
              'disabled:cursor-not-allowed disabled:bg-[var(--color-shell-bg)] disabled:text-[var(--color-shell-text-subtle)]',
              error && 'border-[var(--color-shell-error)] focus:border-[var(--color-shell-error)] focus:ring-[rgba(220,38,38,0.10)] pr-9',
              success && !error && 'border-[var(--color-shell-success)] focus:border-[var(--color-shell-success)] focus:ring-[rgba(22,163,74,0.10)] pr-9',
              className
            )}
            {...props}
          />
          {error && (
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
              <AlertCircle className="h-4 w-4 text-[var(--color-shell-error)]" aria-hidden="true" />
            </div>
          )}
          {success && !error && (
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
              <CheckCircle2 className="h-4 w-4 text-[var(--color-shell-success)]" aria-hidden="true" />
            </div>
          )}
        </div>
        {error && (
          <p id={errorId} className="text-xs text-[var(--color-shell-error)] font-medium flex items-center gap-1 mt-1" role="alert">
            <span>{error}</span>
          </p>
        )}
        {helperText && !error && (
          <p id={helperId} className="text-xs text-[var(--color-shell-text-subtle)] mt-1">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);
Input.displayName = 'Input';