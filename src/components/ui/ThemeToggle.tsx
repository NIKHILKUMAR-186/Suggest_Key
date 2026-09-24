import React, { useEffect, useRef, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { useTheme, type ThemeMode } from '@/src/context/ThemeContext';

const MODE_OPTIONS: Array<{ value: ThemeMode; label: string; icon: React.FC<{ className?: string }>; hint: string }> = [
  { value: 'light', label: 'Light', icon: Sun, hint: 'Bright interface' },
  { value: 'dark', label: 'Dark', icon: Moon, hint: 'Low-light interface' },
  { value: 'system', label: 'System', icon: Monitor, hint: "Match your device's setting" },
];

export interface ThemeToggleProps {
  /** Visual style: compact icon button (default) or full labeled button */
  variant?: 'icon' | 'labeled';
  className?: string;
}

/**
 * Global theme switcher — the ONE shared theme toggle for the whole app
 * (landing header, auth pages, seeker/mentor top navigation, admin sidebar,
 * and every mobile menu). Uses the Light / Dark / System menu UX.
 */
export const ThemeToggle: React.FC<ThemeToggleProps> = ({ variant = 'icon', className }) => {
  const { mode, theme, setMode } = useTheme();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const ActiveIcon = theme === 'dark' ? Moon : Sun;

  const handleSelect = (next: ThemeMode) => {
    setMode(next);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Change theme"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Change theme"
        className={cn(
          'inline-flex items-center justify-center rounded-lg border border-[var(--color-shell-border)]',
          'bg-[var(--color-shell-surface)] text-[var(--color-shell-text-muted)]',
          'hover:bg-[var(--color-shell-surface-hover)] hover:text-[var(--color-shell-text)]',
          'transition-colors cursor-pointer select-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-shell-bg)]',
          variant === 'icon' ? 'h-9 w-9' : 'h-9 gap-2 px-3 text-xs font-medium'
        )}
      >
        <ActiveIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
        {variant === 'labeled' && <span>Theme</span>}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Theme options"
          className={cn(
            'absolute right-0 z-[70] mt-2 w-44 overflow-hidden rounded-xl border p-1',
            'border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] shadow-lg'
          )}
        >
          <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-shell-text-subtle)]">
            Theme
          </p>
          {MODE_OPTIONS.map(({ value, label, icon: Icon, hint }) => {
            const selected = mode === value;
            return (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => handleSelect(value)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors cursor-pointer',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)]',
                  selected
                    ? 'bg-[var(--color-shell-primary-soft)] text-[var(--color-shell-text)] font-semibold'
                    : 'text-[var(--color-shell-text-muted)] hover:bg-[var(--color-shell-surface-hover)] hover:text-[var(--color-shell-text)]'
                )}
              >
                <Icon className={cn('h-4 w-4 shrink-0', selected ? 'text-[var(--color-shell-primary)]' : '')} aria-hidden="true" />
                <span className="flex-1">
                  <span className="block leading-tight">{label}</span>
                  <span className="block text-[10px] font-normal text-[var(--color-shell-text-subtle)] leading-tight">
                    {hint}
                  </span>
                </span>
                {selected && (
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-shell-primary)]"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ThemeToggle;