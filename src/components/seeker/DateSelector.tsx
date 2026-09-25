import React from 'react';
import { CalendarDays, Check } from 'lucide-react';
import { cn } from '@/src/lib/utils';

export interface QuickDate {
  label: string;
  value: string;
}

export interface DateSelectorProps {
  selectedDate: string;
  minDate: string;
  quickDates: QuickDate[];
  onSelect: (value: string) => void;
  className?: string;
}

/**
 * Formats an existing 'YYYY-MM-DD' string for display. No date is ever
 * invented here — only the value the app already resolved is formatted.
 */
export const formatSelectedDateLabel = (value: string): string => {
  if (!value) return '';
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return value;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
};

/**
 * Booking date discovery control.
 *
 * All values ("Today", "Tomorrow", the selected date) come from the date logic
 * already in the page. This component only changes presentation.
 */
export const DateSelector: React.FC<DateSelectorProps> = ({
  selectedDate,
  minDate,
  quickDates,
  onSelect,
  className,
}) => {
  const isQuickDate = quickDates.some((d) => d.value === selectedDate);
  const selectedLabel = formatSelectedDateLabel(selectedDate);

  return (
    <div className={cn('space-y-3', className)}>
      <p
        id="seeker-date-heading"
        className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-shell-text-subtle)]"
      >
        When would you like to talk?
      </p>

      <div className="seeker-panel flex flex-wrap items-center gap-1.5 rounded-2xl p-1.5">
        {quickDates.map((d) => {
          const isSelected = selectedDate === d.value;
          return (
            <button
              key={d.value}
              type="button"
              onClick={() => onSelect(d.value)}
              aria-pressed={isSelected}
              data-selected={isSelected}
              className="seeker-date-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)]"
            >
              {isSelected && <Check className="h-3.5 w-3.5 text-[var(--color-shell-primary)]" aria-hidden="true" />}
              <span>{d.label}</span>
            </button>
          );
        })}

        {!isQuickDate && selectedDate && (
          <span
            className="seeker-date-chip"
            data-selected="true"
            aria-current="date"
          >
            <Check className="h-3.5 w-3.5 text-[var(--color-shell-primary)]" aria-hidden="true" />
            <span>{selectedLabel}</span>
          </span>
        )}

        <span className="mx-1 hidden h-6 w-px bg-[var(--color-shell-border)] sm:block" aria-hidden="true" />

        <div className="relative flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl px-4 text-[var(--color-shell-text-muted)] sm:flex-none">
          <CalendarDays className="h-4 w-4 shrink-0 text-[var(--color-shell-primary)]" aria-hidden="true" />
          <span className="truncate text-[13px] font-semibold">{selectedLabel}</span>
          {/* Real, still-native date input layered invisibly over the visual
              trigger so keyboard and pointer both open the existing picker. */}
          <input
            type="date"
            value={selectedDate}
            min={minDate}
            onChange={(e) => onSelect(e.target.value)}
            aria-label="Select session date"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </div>
      </div>
    </div>
  );
};
