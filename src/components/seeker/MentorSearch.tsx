import React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/src/lib/utils';

export interface MentorSearchProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/**
 * Hero search field. Presentation only — the caller owns the query value and
 * all filtering logic.
 */
export const MentorSearch: React.FC<MentorSearchProps> = ({ value, onChange, className }) => (
  <div className={cn('relative', className)} role="search">
    <div className="seeker-panel pointer-events-none absolute inset-0 rounded-2xl" aria-hidden="true" />
    <div className="relative flex items-center">
      <span
        className="pointer-events-none absolute left-2 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-shell-primary-soft)] text-[var(--color-shell-primary)]"
        aria-hidden="true"
      >
        <Search className="h-[18px] w-[18px]" />
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search mentors, expertise, topics…"
        aria-label="Search mentors by name, expertise, language, or topic"
        autoComplete="off"
        className="h-16 w-full rounded-2xl border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-surface-elevated)] pl-16 pr-14 text-[15px] font-medium text-[var(--color-shell-text)] shadow-[var(--seeker-panel-shadow)] transition-[border-color,box-shadow,background-color] duration-200 placeholder:font-normal placeholder:text-[var(--color-shell-text-subtle)] hover:border-[var(--color-shell-primary)]/40 focus:border-[var(--color-shell-primary)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--color-shell-focus)] focus-visible:outline-offset-2 [&::-webkit-search-cancel-button]:appearance-none"
      />
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-3 flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-[var(--color-shell-text-subtle)] transition-colors duration-150 hover:bg-[var(--color-shell-bg-hover)] hover:text-[var(--color-shell-text)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--color-shell-focus)] focus-visible:outline-offset-2"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  </div>
);
