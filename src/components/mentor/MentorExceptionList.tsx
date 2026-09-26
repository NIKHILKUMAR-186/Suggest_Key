import React from 'react';
import { CalendarClock, CalendarX2, Pencil, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { motion } from 'motion/react';
import type { MentorAvailabilityException } from '@/src/types/database';

export interface MentorExceptionListProps {
  exceptions: MentorAvailabilityException[];
  timezone: string;
  onAdd?: () => void;
  onEdit?: (exception: MentorAvailabilityException) => void;
  onRemove?: (exception: MentorAvailabilityException) => void;
  className?: string;
}

/** Parses a `YYYY-MM-DD` string as a calendar date (never a UTC instant). */
const parseDate = (dateStr: string) => new Date(`${dateStr}T00:00:00`);

const todayISO = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
};

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Deterministic `26 Sep 2026` — avoids locale-dependent month abbreviations. */
const formatDate = (dateStr: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return dateStr;
  const [, year, month, day] = match;
  return `${day} ${MONTHS[Number(month) - 1] ?? month} ${year}`;
};

const formatWeekday = (dateStr: string) => {
  try {
    return parseDate(dateStr).toLocaleDateString('en-GB', { weekday: 'long' });
  } catch {
    return '';
  }
};

const ActionButton: React.FC<{
  onClick: () => void;
  label: string;
  srLabel: string;
  danger?: boolean;
  icon: React.ReactNode;
}> = ({ onClick, label, srLabel, danger, icon }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={srLabel}
    className={cn(
      'inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold',
      'text-[var(--color-shell-text-muted)] transition-colors',
      danger
        ? 'hover:bg-[var(--color-shell-error-soft)] hover:text-[var(--color-shell-error)]'
        : 'hover:bg-[var(--color-shell-bg-hover)] hover:text-[var(--color-shell-text)]',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] focus-visible:ring-offset-2'
    )}
  >
    {icon}
    <span>{label}</span>
  </button>
);

export const MentorExceptionList: React.FC<MentorExceptionListProps> = ({
  exceptions,
  timezone,
  onAdd,
  onEdit,
  onRemove,
  className,
}) => {
  const today = todayISO();
  const upcoming = exceptions
    .filter((e) => e.exception_date >= today)
    .sort((a, b) => a.exception_date.localeCompare(b.exception_date));
  const pastCount = exceptions.length - upcoming.length;

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold tracking-tight text-[var(--color-shell-text)]">
            Date exceptions
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-shell-text-muted)]">
            Override your recurring schedule for specific dates. Times use{' '}
            <span className="font-mono text-[var(--color-shell-text)]">{timezone}</span>.
          </p>
        </div>
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className={cn(
              'inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-lg border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-surface)] px-3 text-xs font-semibold',
              'text-[var(--color-shell-text)] transition-colors',
              'hover:border-[var(--color-shell-primary)] hover:bg-[var(--color-shell-primary-soft)] hover:text-[var(--color-shell-primary)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] focus-visible:ring-offset-2'
            )}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Add exception</span>
          </button>
        )}
      </div>
      {upcoming.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--color-shell-border-strong)] px-5 py-7 text-center">
          <CalendarClock
            className="mx-auto h-7 w-7 text-[var(--color-shell-text-subtle)]"
            aria-hidden="true"
          />
          <p className="mt-3 text-sm font-semibold text-[var(--color-shell-text)]">
            No date exceptions
          </p>
          <p className="mx-auto mt-1 max-w-[28ch] text-xs leading-relaxed text-[var(--color-shell-text-muted)]">
            Your recurring schedule is currently used for all dates.
          </p>
          {onAdd && (
            <button
              type="button"
              onClick={onAdd}
              className={cn(
                'mt-4 inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[var(--color-shell-primary)] px-3.5 text-xs font-semibold',
                'text-[var(--color-shell-primary)] transition-colors hover:bg-[var(--color-shell-primary-soft)]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] focus-visible:ring-offset-2'
              )}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Add date exception</span>
            </button>
          )}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {upcoming.map((ex) => {
            const hasCustomHours = Boolean(ex.is_available && ex.start_time && ex.end_time);
            return (
              <motion.li
                key={ex.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className="rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] p-4 shadow-xs"
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border',
                      hasCustomHours
                        ? 'border-[color-mix(in_srgb,var(--color-shell-primary)_28%,transparent)] bg-[var(--color-shell-primary-soft)] text-[var(--color-shell-primary)]'
                        : 'border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] text-[var(--color-shell-text-subtle)]'
                    )}
                    aria-hidden="true"
                  >
                    {hasCustomHours ? (
                      <CalendarClock className="h-5 w-5" />
                    ) : (
                      <CalendarX2 className="h-5 w-5" />
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-shell-text-subtle)]">
                      {formatWeekday(ex.exception_date)}
                    </p>
                    <p className="mt-0.5 text-sm font-bold tracking-tight text-[var(--color-shell-text)]">
                      {formatDate(ex.exception_date)}
                    </p>
                    <p
                      className={cn(
                        'mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold',
                        hasCustomHours
                          ? 'border-[color-mix(in_srgb,var(--color-shell-primary)_28%,transparent)] bg-[var(--color-shell-primary-soft)] text-[var(--color-shell-primary)]'
                          : 'border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] text-[var(--color-shell-text-muted)]'
                      )}
                    >
                      {hasCustomHours ? 'Custom hours' : 'Unavailable'}
                    </p>
                    <p className="mt-2 text-xs font-medium text-[var(--color-shell-text-muted)]">
                      {hasCustomHours ? (
                        <span className="font-mono tabular-nums">
                          {ex.start_time?.slice(0, 5)} – {ex.end_time?.slice(0, 5)}
                        </span>
                      ) : (
                        'No sessions bookable on this date'
                      )}
                    </p>
                    {ex.reason && (
                      <p className="mt-1 text-xs italic text-[var(--color-shell-text-subtle)]">
                        {ex.reason}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-1 border-t border-[var(--color-shell-border)] pt-2">
                  {onEdit && (
                    <ActionButton
                      onClick={() => onEdit(ex)}
                      label="Edit"
                      srLabel={`Edit date exception for ${formatDate(ex.exception_date)}`}
                      icon={<Pencil className="h-3.5 w-3.5" aria-hidden="true" />}
                    />
                  )}
                  {onRemove && (
                    <ActionButton
                      onClick={() => onRemove(ex)}
                      label="Delete"
                      srLabel={`Delete date exception for ${formatDate(ex.exception_date)}`}
                      danger
                      icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                    />
                  )}
                </div>
              </motion.li>
            );
          })}
        </ul>
      )}

      {pastCount > 0 && (
        <p className="px-1 text-[11px] text-[var(--color-shell-text-subtle)]">
          {pastCount} past {pastCount === 1 ? 'exception is' : 'exceptions are'} hidden because
          past dates are never bookable.
        </p>
      )}
    </div>
  );
};
