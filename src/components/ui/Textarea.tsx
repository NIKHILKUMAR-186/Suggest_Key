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
            <label htmlFor={inputId} className="block text-xs font-semibold text-zinc-800">
              {label}
              {props.required && <span className="text-rose-500 ml-0.5">*</span>}
            </label>
          )}
          {showCount && maxLength && (
            <span className="text-[11px] font-mono text-zinc-400">
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
              'flex w-full rounded-lg border border-zinc-200 bg-white p-3 text-base sm:text-sm text-zinc-900 placeholder:text-zinc-400 transition-all resize-y',
              'focus:border-zinc-950 focus:outline-none focus:ring-2 focus:ring-zinc-950/10',
              'disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500',
              error && 'border-rose-500 focus:border-rose-600 focus:ring-rose-500/10',
              className
            )}
            {...props}
          />
        </div>
        {error && (
          <p id={errorId} className="text-xs text-rose-600 font-medium flex items-center gap-1 mt-1">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </p>
        )}
        {helperText && !error && (
          <p id={helperId} className="text-xs text-zinc-500 mt-1">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);
Textarea.displayName = 'Textarea';

