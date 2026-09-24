import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/src/lib/utils';

export interface PasswordInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string | null;
  helperText?: string;
  id?: string;
}

export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, type = 'password', label, error, helperText, id, ...props }, ref) => {
    const [visible, setVisible] = useState(false);
    const generatedId = React.useId();
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : generatedId);
    const errorId = error ? `${inputId}-error` : undefined;
    const helperId = helperText ? `${inputId}-helper` : undefined;

    const toggleVisibility = () => setVisible((prev) => !prev);

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
            type={visible ? 'text' : 'password'}
            ref={ref}
            aria-invalid={!!error}
            aria-describedby={errorId || helperId}
            className={cn(
              'flex h-12 w-full rounded-lg border bg-[var(--color-shell-surface)] px-3 py-2 text-base text-[var(--color-shell-text)] placeholder:text-[var(--color-shell-text-subtle)] transition-all',
              'border-[var(--color-shell-border-strong)] focus:border-[var(--color-shell-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--color-shell-accent-soft)]',
              'disabled:cursor-not-allowed disabled:bg-[var(--color-shell-bg)] disabled:text-[var(--color-shell-text-subtle)]',
              error && 'border-[var(--color-shell-error)] focus:border-[var(--color-shell-error)] focus:ring-[rgba(220,38,38,0.10)] pr-11',
              className
            )}
            {...props}
          />
          <button
            type="button"
            onClick={toggleVisibility}
            aria-label={visible ? 'Hide password' : 'Show password'}
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-[var(--color-shell-text-subtle)] hover:text-[var(--color-shell-text)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] rounded"
          >
            {visible ? (
              <EyeOff className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Eye className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
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
PasswordInput.displayName = 'PasswordInput';