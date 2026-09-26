import React from 'react';
import { cn } from '@/src/lib/utils';
import { Badge } from '@/src/components/ui/Badge';
import { Button } from '@/src/components/ui/Button';
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
  const formatTime = (t: string) => t?.slice(0, 5) || t;

  return (
    <div className={cn('space-y-3', className)}>
      {days.map((day, idx) => (
        <motion.div
          key={day.dayName}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: idx * 0.03 }}
          className={cn(
            'rounded-xl border p-4 transition-colors',
            day.enabled
              ? 'border-[var(--color-shell-border)] bg-[var(--color-shell-surface)]'
              : 'border-[var(--color-shell-border)]/60 bg-[var(--color-shell-surface)]/50 opacity-70'
          )}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2.5">
              <input
                type="checkbox"
                checked={day.enabled}
                onChange={(e) => onToggleDay?.(day.dayIndex, e.target.checked)}
                className="rounded border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)]"
                id={`day-${day.dayName}`}
              />
              <label
                htmlFor={`day-${day.dayName}`}
                className={cn(
                  'text-sm font-bold cursor-pointer',
                  day.enabled ? 'text-[var(--color-shell-text)]' : 'text-[var(--color-shell-text-subtle)]'
                )}
              >
                {day.dayName}
              </label>
              {day.enabled && day.windows.length === 0 && (
                <Badge variant="warning" className="text-[10px]">
                  No windows
                </Badge>
              )}
            </div>
            {day.enabled && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onAddWindow?.(day.dayIndex)}
                className="text-[11px] gap-1 h-7 px-2"
              >
                + Add Window
              </Button>
            )}
          </div>

          {day.enabled ? (
            day.windows.length > 0 ? (
              <div className="space-y-2">
                {day.windows.map((w, wIdx) => (
                  <div
                    key={wIdx}
                    className="flex items-center gap-2 text-sm"
                  >
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        type="time"
                        value={w.start}
                        onChange={(e) => onEdit?.({ ...day, windows: day.windows.map((win, i) => i === wIdx ? { ...win, start: e.target.value } : win) })}
                        className="rounded-md border border-[var(--color-shell-border-strong)] px-2 py-1 bg-[var(--color-shell-bg)] text-xs text-[var(--color-shell-text)]"
                      />
                      <span className="text-[var(--color-shell-text-subtle)] text-xs">to</span>
                      <input
                        type="time"
                        value={w.end}
                        onChange={(e) => onEdit?.({ ...day, windows: day.windows.map((win, i) => i === wIdx ? { ...win, end: e.target.value } : win) })}
                        className="rounded-md border border-[var(--color-shell-border-strong)] px-2 py-1 bg-[var(--color-shell-bg)] text-xs text-[var(--color-shell-text)]"
                      />
                    </div>
                    {day.windows.length > 0 && (
                      <button
                        type="button"
                        onClick={() => onRemoveWindow?.(day.dayIndex, wIdx)}
                        className="text-[var(--color-shell-text-subtle)] hover:text-[var(--color-shell-error)] p-1"
                        aria-label="Remove window"
                      >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m-9 0v14a2 2 0 002 2h6a2 2 0 002-2V6" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <span className="text-[11px] text-[var(--color-shell-text-subtle)] italic">Marked available — add a time window to begin</span>
            )
          ) : (
            <span className="text-[11px] text-[var(--color-shell-text-subtle)] italic">Marked Unavailable</span>
          )}

          {day.enabled && (errors?.[idx]?.length ?? 0) > 0 && (
            <ul className="mt-2 space-y-0.5">
              {errors?.[idx]?.map((msg, eIdx) => (
                <li key={eIdx} className="flex items-start gap-1.5 text-[11px] text-[var(--color-shell-error)]">
                  <span aria-hidden="true">&#9679;</span>
                  <span>{msg}</span>
                </li>
              ))}
            </ul>
          )}
        </motion.div>
      ))}
      <div className="flex items-center gap-2 pt-1">
        <Badge variant="secondary" className="text-[11px] font-mono">
          {timezone}
        </Badge>
        <span className="text-[11px] text-[var(--color-shell-text-subtle)]">
          All times interpreted in your mentor timezone
        </span>
      </div>
    </div>
  );
};