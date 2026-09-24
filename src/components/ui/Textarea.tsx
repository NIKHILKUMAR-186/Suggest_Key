import React from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/src/lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
  showCount?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, helperText, showCount, id, rows = 4, maxLength, value, onChange, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : generatedId);
    const errorId = error ? `${inputId}-error` : undefined;
    const helperId = helperText ? `${inputId}-helper` : undefined;

    const currentLength = typeof value === 'string' ? value.length : 0;

    return (
      <div className="w-full space-y-1.5">
        <div className="flex items-center justify-between">
          {label && (
            <label htmlFor={inputId} className="block text-xs font-semibold text-[var(--color-shell-text)]">
              {label}
              {props.required && <span className="text-[var(--color-shell-error)] ml-0.5">*</span>}
            </label>
          )}
          {showCount && maxLength && (
            <span className="text-[11px] font-mono text-[var(--color-shell-text-subtle)]">
              {currentLength}/{maxLength}
            </span>
          )}
        </div>
        <div className="relative">
          <textarea
            id={inputId}
            rows={rows}
            ref={ref}
            maxLength={maxLength}
            value={value}
            onChange={onChange}
            aria-invalid={!!error}
            aria-describedby={errorId || helperId}
            className={cn(
              'flex w-full rounded-lg border bg-[var(--color-shell-bg)] p-3 text-base sm:text-sm text-[var(--color-shell-text)] placeholder:text-[var(--color-shell-text-subtle)] transition-all resize-y',
              'border-[var(--color-shell-border-strong)] focus:border-[var(--color-shell-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-shell-accent-soft)]',
              'disabled:cursor-not-allowed disabled:bg-[var(--color-shell-surface)] disabled:text-[var(--color-shell-text-subtle)]',
              error && 'border-[var(--color-shell-error)] focus:border-[var(--color-shell-error)] focus:ring-[var(--color-shell-error-soft)]',
              className
            )}
            {...props}
          />
        </div>
        {error && (
          <p id={errorId} className="text-xs text-[var(--color-shell-error)] font-medium flex items-center gap-1 mt-1">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
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
Textarea.displayName = 'Textarea';

