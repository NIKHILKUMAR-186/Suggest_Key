import React, { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import { cn } from '@/src/lib/utils';

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterBarProps {
  availableLanguages: string[];
  languageFilter: string;
  onLanguageChange: (value: string) => void;
  languageMenuOpen: boolean;
  onLanguageMenuToggle: () => void;
  onLanguageMenuClose: () => void;
  experienceOptions: FilterOption[];
  experienceFilter: string;
  onExperienceChange: (value: string) => void;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  className?: string;
}

const triggerBase =
  'inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[13px] font-semibold transition-colors duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--color-shell-focus)] focus-visible:outline-offset-2';

/**
 * Compact filter row that sits directly above the results section.
 * Exposes only filters the app already supports; the language list is built
 * from real mentor/eligible-language data by the caller.
 */
export const FilterBar: React.FC<FilterBarProps> = ({
  availableLanguages,
  languageFilter,
  onLanguageChange,
  languageMenuOpen,
  onLanguageMenuToggle,
  onLanguageMenuClose,
  experienceOptions,
  experienceFilter,
  onExperienceChange,
  hasActiveFilters,
  onClearFilters,
  className,
}) => {
  const languageTriggerRef = useRef<HTMLButtonElement>(null);

  // Escape closes the language menu and returns focus to its trigger.
  useEffect(() => {
    if (!languageMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onLanguageMenuClose();
        languageTriggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [languageMenuOpen, onLanguageMenuClose]);

  return (
    <div className={cn('flex flex-wrap items-center gap-2.5', className)}>
      <span className="hidden text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-shell-text-subtle)] sm:inline">
        Refine
      </span>

      {/* Language */}
      <div className="relative">
        <button
          ref={languageTriggerRef}
          type="button"
          onClick={onLanguageMenuToggle}
          aria-haspopup="listbox"
          aria-expanded={languageMenuOpen}
          className={cn(
            triggerBase,
            languageFilter !== 'all'
              ? 'border-[var(--seeker-date-active-border)] bg-[var(--seeker-date-active-bg)] text-[var(--color-shell-text)]'
              : 'border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] text-[var(--color-shell-text-muted)] hover:border-[var(--color-shell-border-strong)] hover:text-[var(--color-shell-text)]'
          )}
        >
          <span className="text-[var(--color-shell-text-subtle)]">Language</span>
          <span className="font-bold text-[var(--color-shell-text)]">
            {languageFilter === 'all' ? 'All' : languageFilter}
          </span>
          <ChevronDown
            className={cn('h-3.5 w-3.5 transition-transform duration-200', languageMenuOpen && 'rotate-180')}
            aria-hidden="true"
          />
        </button>

        <AnimatePresence>
          {languageMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={onLanguageMenuClose} aria-hidden="true" />
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -4 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="absolute left-0 top-full z-20 mt-2 w-56 overflow-hidden rounded-2xl border border-[var(--seeker-panel-border)] bg-[var(--color-shell-surface-elevated)] p-1.5 shadow-[var(--shadow-xl)]"
                role="listbox"
                aria-label="Filter by language"
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={languageFilter === 'all'}
                  onClick={() => {
                    onLanguageChange('all');
                    onLanguageMenuClose();
                  }}
                  className={cn(
                    'flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-colors',
                    languageFilter === 'all'
                      ? 'bg-[var(--color-shell-primary-soft)] text-[var(--color-shell-text)]'
                      : 'text-[var(--color-shell-text-muted)] hover:bg-[var(--color-shell-bg-hover)]'
                  )}
                >
                  <span>All languages</span>
                  {languageFilter === 'all' && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                </button>
                {availableLanguages.map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    role="option"
                    aria-selected={languageFilter === lang}
                    onClick={() => {
                      onLanguageChange(lang);
                      onLanguageMenuClose();
                    }}
                    className={cn(
                      'flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-colors',
                      languageFilter === lang
                        ? 'bg-[var(--color-shell-primary-soft)] text-[var(--color-shell-text)]'
                        : 'text-[var(--color-shell-text-muted)] hover:bg-[var(--color-shell-bg-hover)]'
                    )}
                  >
                    <span>{lang}</span>
                    {languageFilter === lang && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                  </button>
                ))}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      {/* Experience */}
      <div className="relative">
        <SlidersHorizontal
          className="pointer-events-none absolute left-3 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-shell-text-subtle)]"
          aria-hidden="true"
        />
        <select
          value={experienceFilter}
          onChange={(e) => onExperienceChange(e.target.value)}
          aria-label="Filter by experience"
          className={cn(
            triggerBase,
            'appearance-none pl-9 pr-9',
            experienceFilter !== 'all'
              ? 'border-[var(--seeker-date-active-border)] bg-[var(--seeker-date-active-bg)] text-[var(--color-shell-text)]'
              : 'border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] text-[var(--color-shell-text-muted)] hover:border-[var(--color-shell-border-strong)] hover:text-[var(--color-shell-text)]'
          )}
        >
          {experienceOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-shell-text-subtle)]"
          aria-hidden="true"
        />
      </div>

      {hasActiveFilters && (
        <button
          type="button"
          onClick={onClearFilters}
          className={cn(
            triggerBase,
            'border-[var(--color-shell-border)] bg-transparent text-[var(--color-shell-text-muted)] hover:border-[var(--color-shell-error)]/40 hover:text-[var(--color-shell-error)]'
          )}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          Clear all
        </button>
      )}
    </div>
  );
};
