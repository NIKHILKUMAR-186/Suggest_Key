import React from 'react';
import { CalendarDays, Check } from 'lucide-react';
import { formatShortDate } from '@/src/lib/seekerFormat';
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
 * Formats an existing 'YYYY-MM-DD' string for display.
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
 * The second line of a date chip: "Thu, 1 Oct" -> "1 Oct".
 *
 * Split off the weekday because it is already the chip's first line for the
 * "Today"/"Tomorrow" entries, and repeating it reads as noise.
 */
const dateChipDayMonth = (value: string): string => {
  const label = formatShortDate(value);
  const comma = label.indexOf(',');
  return comma === -1 ? label : label.slice(comma + 1).trim();
};

/**
 * Booking date discovery control.
 *
 * A horizontally scrollable strip of date chips, each showing the relative day
 * ("Today", "Tomorrow", "Sat") over its real calendar date, plus the native
 * date input for any date outside the window. Nothing here hardcodes a date:
 * `quickDates` is built from the seeker's own timezone by `buildQuickDates`.
 *
 * The selected chip carries three independent signals - `aria-pressed`, a tick,
 * and the accent fill - so the state never depends on colour alone.
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

      <div className="seeker-panel flex items-center gap-1.5 overflow-x-auto rounded-2xl p-1.5 sm:flex-wrap sm:overflow-x-visible">
        {quickDates.map((d) => {
          const isSelected = selectedDate === d.value;
          return (
            <button
              key={d.value}
              type="button"
              onClick={() => onSelect(d.value)}
              aria-pressed={isSelected}
              aria-label={`${d.label}, ${formatSelectedDateLabel(d.value)}`}
              data-selected={isSelected}
              data-stacked="true"
              className="seeker-date-chip shrink-0 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--segment-accent)] focus-visible:outline-offset-2"
            >
              <span className="seeker-date-chip-relative">
                {isSelected && (
                  <Check className="h-3 w-3" aria-hidden="true" />
                )}
                {d.label}
              </span>
              <span className="seeker-date-chip-date">{dateChipDayMonth(d.value)}</span>
            </button>
          );
        })}

        {!isQuickDate && selectedDate && (
          <span
            className="seeker-date-chip shrink-0"
            data-selected="true"
            data-stacked="true"
            aria-current="date"
          >
            <span className="seeker-date-chip-relative">
              <Check className="h-3 w-3" aria-hidden="true" />
              Selected
            </span>
            <span className="seeker-date-chip-date">{dateChipDayMonth(selectedDate)}</span>
          </span>
        )}

        <span className="mx-1 hidden h-8 w-px shrink-0 bg-[var(--color-shell-border)] sm:block" aria-hidden="true" />

        <div className="relative flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-[var(--color-shell-text-muted)]">
          <CalendarDays className="h-4 w-4 shrink-0 text-[var(--segment-accent)]" aria-hidden="true" />
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