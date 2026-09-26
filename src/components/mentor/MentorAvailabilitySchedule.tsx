import React, { useState } from 'react';
import { ArrowRight, Globe2, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { motion } from 'motion/react';
import type { AvailabilityDay } from '@/src/hooks/mentor/useMentorAvailability';

export interface MentorAvailabilityScheduleProps {
  days: AvailabilityDay[];
  timezone: string;
  errors?: string[][];
  onEdit?: (day: AvailabilityDay) => void;
  onAddWindow?: (dayIndex: number) => void;
  onRemoveWindow?: (dayIndex: number, windowIndex: number) => void;
  onToggleDay?: (dayIndex: number, enabled: boolean) => void;
  className?: string;
}

/** Above this count a single day scrolls internally so the page stays usable. */
const SCROLL_AFTER_WINDOWS = 4;

const DayErrors: React.FC<{ messages: string[]; className?: string }> = ({
  messages,
  className,
}) => {
  if (messages.length === 0) return null;
  return (
    <ul className={cn('space-y-1.5', className)} role="alert">
      {messages.map((msg, i) => (
        <li
          key={i}
          className="rounded-lg bg-[var(--color-shell-error-soft)] px-3 py-2 text-xs font-medium text-[var(--color-shell-error)]"
        >
          {msg}
        </li>
      ))}
    </ul>
  );
};

const AddWindowButton: React.FC<{ onClick: () => void; dayName: string }> = ({
  onClick,
  dayName,
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={`Add time window to ${dayName}`}
    className={cn(
      'inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-[var(--color-shell-border-strong)] px-3 text-xs font-semibold',
      'text-[var(--color-shell-primary)] transition-colors',
      'hover:border-[var(--color-shell-primary)] hover:bg-[var(--color-shell-primary-soft)]',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] focus-visible:ring-offset-2'
    )}
  >
    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
    <span>Add time window</span>
  </button>
);

export const MentorAvailabilitySchedule: React.FC<MentorAvailabilityScheduleProps> = ({
  days,
  timezone,
  errors,
  onEdit,
  onAddWindow,
  onRemoveWindow,
  onToggleDay,
  className,
}) => {
  const [activeDay, setActiveDay] = useState<number | null>(null);

  return (
    <div className={cn('space-y-2.5', className)}>
      {days.map((day, idx) => {
        const dayErrors = errors?.[idx] ?? [];
        const isAvailable = day.enabled;
        const windowCount = day.windows.length;

        return (
          <motion.article
            key={day.dayIndex}
            data-state={isAvailable ? 'available' : 'unavailable'}
            data-active={activeDay === day.dayIndex}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, delay: Math.min(idx, 7) * 0.025 }}
            onFocusCapture={() => setActiveDay(day.dayIndex)}
            onBlurCapture={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setActiveDay(null);
            }}
            className="av-day overflow-hidden"
            aria-label={`${day.dayName} availability`}
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 sm:px-5">
              <label className="av-toggle min-w-[190px] flex-1">
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={isAvailable}
                  onChange={(e) => onToggleDay?.(day.dayIndex, e.target.checked)}
                />
                <span className="av-toggle-track" aria-hidden="true">
                  <span className="av-toggle-thumb" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-shell-text-subtle)]">
                    {day.dayName}
                  </span>
                  <span
                    className={cn(
                      'truncate text-sm font-semibold',
                      isAvailable
                        ? 'text-[var(--color-shell-text)]'
                        : 'text-[var(--color-shell-text-muted)]'
                    )}
                  >
                    {isAvailable
                      ? windowCount > 0
                        ? `Available · ${windowCount} time ${windowCount === 1 ? 'window' : 'windows'}`
                        : 'Available · no time windows yet'
                      : 'Unavailable'}
                  </span>
                </span>
              </label>

              {isAvailable && (
                <AddWindowButton
                  dayName={day.dayName}
                  onClick={() => onAddWindow?.(day.dayIndex)}
                />
              )}
            </div>
            {isAvailable && (
              <div className="space-y-2.5 border-t border-[var(--color-shell-border)] bg-[var(--color-shell-surface)]/60 px-4 py-4 sm:px-5">
                {windowCount === 0 ? (
                  <p className="rounded-xl border border-dashed border-[var(--color-shell-border)] px-4 py-5 text-center text-xs text-[var(--color-shell-text-muted)]">
                    This day is marked available but has no time windows yet. Add one to make it
                    bookable.
                  </p>
                ) : (
                  <div
                    className="av-window-list"
                    data-scroll={windowCount > SCROLL_AFTER_WINDOWS}
                  >
                    {day.windows.map((w, wIdx) => {
                      const invalid = !w.start || !w.end || w.start >= w.end;
                      return (
                        <div className="av-window" key={wIdx}>
                          <input
                            type="time"
                            className="av-time-input"
                            value={w.start}
                            aria-label={`${day.dayName}, time window ${wIdx + 1} start time`}
                            aria-invalid={invalid}
                            onChange={(e) =>
                              onEdit?.({
                                ...day,
                                windows: day.windows.map((win, i) =>
                                  i === wIdx ? { ...win, start: e.target.value } : win
                                ),
                              })
                            }
                          />
                          <ArrowRight
                            className="av-window-arrow h-4 w-4 shrink-0 text-[var(--color-shell-text-subtle)]"
                            aria-hidden="true"
                          />
                          <input
                            type="time"
                            className="av-time-input"
                            value={w.end}
                            aria-label={`${day.dayName}, time window ${wIdx + 1} end time`}
                            aria-invalid={invalid}
                            onChange={(e) =>
                              onEdit?.({
                                ...day,
                                windows: day.windows.map((win, i) =>
                                  i === wIdx ? { ...win, end: e.target.value } : win
                                ),
                              })
                            }
                          />
                          <button
                            type="button"
                            className="av-icon-btn"
                            onClick={() => onRemoveWindow?.(day.dayIndex, wIdx)}
                            aria-label={`Remove time window ${wIdx + 1} on ${day.dayName}`}
                            title="Remove time window"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <DayErrors messages={dayErrors} />
              </div>
            )}

            {!isAvailable && <DayErrors messages={dayErrors} className="px-4 pb-4 sm:px-5" />}
          </motion.article>
        );
      })}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 pt-2 text-xs text-[var(--color-shell-text-subtle)]">
        <Globe2 className="h-3.5 w-3.5" aria-hidden="true" />
        <span>
          All times are shown in your mentor timezone:{' '}
          <span className="font-mono font-semibold text-[var(--color-shell-text-muted)]">
            {timezone}
          </span>
        </span>
      </p>
    </div>
  );
};
