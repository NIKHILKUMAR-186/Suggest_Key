import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '@/src/lib/utils';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastOptions {
  /**
   * Optional short label shown above the message (e.g. "Settings saved").
   * Omit it for a single-line message.
   */
  title?: string;
  /** Milliseconds before auto-dismiss. `0` keeps the toast until dismissed. */
  durationMs?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  success: (message: string, options?: ToastOptions) => void;
  error: (message: string, options?: ToastOptions) => void;
  info: (message: string, options?: ToastOptions) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const DEFAULT_DURATION_MS = 5000;
const MAX_VISIBLE = 4;

const VARIANT_STYLES: Record<ToastVariant, { icon: typeof Info; className: string; iconClass: string }> = {
  success: {
    icon: CheckCircle2,
    className: 'border-[var(--color-shell-success)]/35 bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-success)]',
    iconClass: 'text-[var(--color-shell-success)]',
  },
  error: {
    icon: AlertCircle,
    className: 'border-[var(--color-shell-error)]/40 bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-error)]',
    iconClass: 'text-[var(--color-shell-error)]',
  },
  info: {
    icon: Info,
    className: 'border-[var(--color-shell-border-strong)] bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-accent)]',
    iconClass: 'text-[var(--color-shell-accent)]',
  },
};

/**
 * Lightweight toast host.
 *
 * Confirmation is always raised by the caller AFTER the backend call resolved,
 * so a toast can never report a success that did not happen. Messages are
 * user-facing copy only - the technical detail stays in the console and, for
 * server failures, in System Health.
 */
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (variant: ToastVariant, message: string, options?: ToastOptions) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, message, variant, ...options }].slice(-MAX_VISIBLE));
    },
    []
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      success: (message, options) => push('success', message, options),
      error: (message, options) => push('error', message, options),
      info: (message, options) => push('info', message, options),
      dismiss,
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
};

const ToastViewport: React.FC<{ toasts: ToastItem[]; onDismiss: (id: number) => void }> = ({
  toasts,
  onDismiss,
}) => {
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    for (const toast of toasts) {
      if (pending.has(toast.id)) continue;
      const duration = toast.durationMs ?? DEFAULT_DURATION_MS;
      if (duration <= 0) continue;
      pending.set(toast.id, setTimeout(() => onDismiss(toast.id), duration));
    }
    return () => {
      for (const id of Array.from(pending.keys())) {
        if (!toasts.some((t) => t.id === id)) {
          clearTimeout(pending.get(id));
          pending.delete(id);
        }
      }
    };
  }, [toasts, onDismiss]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return (
    <div
      // Bottom on mobile (thumb reach), top-right on larger screens.
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 px-3 pb-4 sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-0 sm:items-end sm:px-4 sm:pt-4"
      role="region"
      aria-label="Notifications"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const variant = VARIANT_STYLES[toast.variant];
          const Icon = variant.icon;
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              role={toast.variant === 'error' ? 'alert' : 'status'}
              aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
              className={cn(
                'pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border px-3.5 py-3 shadow-[var(--shadow-lg)] backdrop-blur-md',
                variant.className
              )}
            >
              <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', variant.iconClass)} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                {toast.title && (
                  <p className="text-[13px] font-bold leading-tight break-words">{toast.title}</p>
                )}
                <p
                  className={cn(
                    'text-[12px] leading-snug break-words text-[var(--color-shell-text-muted)]',
                    toast.title && 'mt-0.5'
                  )}
                >
                  {toast.message}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                aria-label="Dismiss notification"
                className="-m-1 shrink-0 cursor-pointer rounded-md p-1 text-[var(--color-shell-text-subtle)] transition-colors hover:bg-[var(--color-shell-bg-hover)] hover:text-[var(--color-shell-text)] focus-visible:outline-2 focus-visible:outline-offset-1"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
