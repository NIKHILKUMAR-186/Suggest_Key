import React from 'react';
import { cn } from '@/src/lib/utils';
import { Badge } from '@/src/components/ui/Badge';
import { Button } from '@/src/components/ui/Button';
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

const formatDate = (dateStr: string) => {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
};

export const MentorExceptionList: React.FC<MentorExceptionListProps> = ({
  exceptions,
  timezone,
  onAdd,
  onEdit,
  onRemove,
  className,
}) => {
  const upcoming = exceptions
    .filter((e) => new Date(e.exception_date + 'T00:00:00') >= new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00'))
    .sort((a, b) => new Date(a.exception_date).getTime() - new Date(b.exception_date).getTime());

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center justify-between border-b border-[var(--color-shell-border)] pb-3">
        <div>
          <h2 className="text-base font-bold text-[var(--color-shell-text)]">Date Exceptions</h2>
          <p className="text-xs text-[var(--color-shell-text-muted)] mt-0.5">
            Date-specific overrides take precedence over recurring hours.
          </p>
        </div>
        {onAdd && (
          <Button size="sm" variant="outline" onClick={onAdd} className="text-xs gap-1.5">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add Override
          </Button>
        )}
      </div>

      {upcoming.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--color-shell-border)] bg-[var(--color-shell-surface)]/60 p-6 text-center">
          <p className="text-xs text-[var(--color-shell-text-muted)]">
            No upcoming date exceptions. Your recurring schedule applies.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {upcoming.map((ex) => (
            <motion.div
              key={ex.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center justify-between gap-3 p-3 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)]"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex flex-col items-center justify-center h-10 w-10 rounded-lg bg-[var(--color-shell-surface-elevated)] shrink-0">
                  <span className="text-[10px] font-bold text-[var(--color-shell-text-subtle)] uppercase">
                    {formatDate(ex.exception_date).split(' ')[0]}
                  </span>
                  <span className="text-sm font-bold text-[var(--color-shell-text)] leading-none">
                    {formatDate(ex.exception_date).split(' ')[1].replace(',', '')}
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[var(--color-shell-text)]">
                      {formatDate(ex.exception_date)}
                    </span>
                    <Badge
                      variant={ex.is_available ? 'success' : 'destructive'}
                      className="text-[10px]"
                    >
                      {ex.is_available ? 'Custom Hours' : 'Unavailable'}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-[var(--color-shell-text-muted)]">
                    {ex.is_available && ex.start_time && ex.end_time
                      ? `${ex.start_time.slice(0, 5)} – ${ex.end_time.slice(0, 5)}`
                      : ex.reason || 'All-day unavailable'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {onEdit && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onEdit(ex)}
                    className="h-7 w-7 p-0"
                    aria-label="Edit exception"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
                    </svg>
                  </Button>
                )}
                {onRemove && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onRemove(ex)}
                    className="h-7 w-7 p-0 text-[var(--color-shell-text-subtle)] hover:text-[var(--color-shell-error)]"
                    aria-label="Remove exception"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m-9 0v14a2 2 0 002 2h6a2 2 0 002-2V6" />
                    </svg>
                  </Button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};