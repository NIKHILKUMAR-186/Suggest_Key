import React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/src/lib/utils';

export interface MentorSearchProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/**
 * Hero search field — primary discovery action.
 *
 * Enhanced with:
 * - Larger, more prominent input
 * - Better focus states with segment-aware ring
 * - Improved icon treatment
 * - Clear button with hover state
 */
export const MentorSearch: React.FC<MentorSearchProps> = ({ value, onChange, className }) => (
  <div className={cn('relative', className)} role="search">
    <div className="seeker-panel pointer-events-none absolute inset-0 rounded-2xl" aria-hidden="true" />
    <div className="relative flex items-center">
      <span
        className="pointer-events-none absolute left-3.5 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-shell-primary-soft)] text-[var(--color-shell-primary)]"
        aria-hidden="true"
      >
        <Search className="h-[20px] w-[20px]" />
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search mentors, expertise, topics…"
        aria-label="Search mentors by name, expertise, language, or topic"
        autoComplete="off"
        className="input-glass h-[60px] sm:h-[64px] rounded-2xl pl-16 pr-14 text-[15px] sm:text-base font-medium"
      />
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-3 flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-[var(--color-shell-text-subtle)] transition-all duration-150 hover:bg-[var(--color-shell-bg-hover)] hover:text-[var(--color-shell-text)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--color-shell-focus)] focus-visible:outline-offset-2"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  </div>
);
