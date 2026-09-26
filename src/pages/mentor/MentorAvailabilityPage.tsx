import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  AlertCircle,
  Check,
  Globe2,
  Save,
  ShieldCheck,
  Undo2,
} from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { Textarea } from '@/src/components/ui/Textarea';
import { Dialog } from '@/src/components/ui/Dialog';
import { LoadingState } from '@/src/components/shared/LoadingState';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { useAuth } from '@/src/context/AuthContext';
import { apiFetch } from '@/src/lib/apiClient';
import { cn } from '@/src/lib/utils';
import { useMentorAvailability, type AvailabilityDay } from '@/src/hooks/mentor/useMentorAvailability';
import { MentorAvailabilitySchedule } from '@/src/components/mentor/MentorAvailabilitySchedule';
import { MentorExceptionList } from '@/src/components/mentor/MentorExceptionList';
import type { MentorAvailabilityException } from '@/src/types/database';

interface ExceptionFormData {
  exceptionDate: string;
  isAvailable: boolean;
  startTime: string;
  endTime: string;
  reason: string;
}

const initialExceptionForm: ExceptionFormData = {
  exceptionDate: '',
  isAvailable: true,
  startTime: '09:00',
  endTime: '17:00',
  reason: '',
};

/** Local calendar date — never `toISOString()`, which would shift across timezones. */
const localTodayISO = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
};

const toMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

/** Suggests a gap after the last window of a day so new rows are rarely invalid. */
const nextFreeWindow = (windows: { start: string; end: string }[]) => {
  const valid = windows.filter((w) => w.start && w.end);
  if (valid.length === 0) return { start: '09:00', end: '12:00' };
  const lastEnd = valid.reduce((max, w) => Math.max(max, toMinutes(w.end)), 0);
  const start = Math.min(lastEnd + 30, 22 * 60);
  const end = Math.min(start + 60, 24 * 60 - 1);
  const fmt = (mins: number) =>
    `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  return { start: fmt(start), end: fmt(end) };
};

/** Options exposed by the date-exception form. Maps directly to `is_available`. */
const EXCEPTION_TYPES = [
  { value: false, label: 'Unavailable', hint: 'No sessions bookable on this date' },
  { value: true, label: 'Custom hours', hint: 'Bookable within a set time window' },
] as const;

/** Stable signature used to detect unsaved edits. */
const signatureOf = (days: AvailabilityDay[], exceptions: MentorAvailabilityException[]) =>
  JSON.stringify({
    days: days.map((d) => [d.dayIndex, d.enabled, d.windows.map((w) => [w.start, w.end])]),
    exceptions: exceptions.map((e) => [
      e.exception_date,
      e.is_available,
      e.start_time,
      e.end_time,
      e.reason ?? '',
    ]),
  });

function validateDay(day: AvailabilityDay): string[] {
  const errors: string[] = [];
  if (!day.enabled) return errors;
  const { windows } = day;
  const seen = new Set<string>();
  for (let i = 0; i < windows.length; i++) {
    const { start, end } = windows[i];
    if (!start || !end) {
      errors.push(`Time window ${i + 1} needs both a start and an end time.`);
      continue;
    }
    if (start >= end) {
      errors.push(`Time window ${i + 1}: start time must be earlier than end time.`);
    }
    const key = `${start}-${end}`;
    if (seen.has(key)) {
      errors.push(`Time window ${i + 1} is a duplicate; remove or adjust it.`);
    }
    seen.add(key);
  }
  const valid = windows.filter((w) => w.start && w.end && w.start < w.end);
  if (valid.length > 1) {
    const sorted = [...valid].sort((a, b) => (a.start < b.start ? -1 : 1));
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i - 1].end > sorted[i].start) {
        errors.push('Time windows cannot overlap.');
        break;
      }
    }
  }
  return errors;
}

const SaveButton: React.FC<{
  status: 'idle' | 'saving' | 'success' | 'error';
  dirty: boolean;
  disabled: boolean;
  onClick: () => void;
  className?: string;
  size?: 'sm' | 'md';
}> = ({ status, dirty, disabled, onClick, className, size = 'md' }) => {
  if (status === 'success') {
    return (
      <span
        role="status"
        aria-live="polite"
        className={cn(
          'inline-flex items-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--color-shell-success)_32%,transparent)] bg-[var(--color-shell-success-soft)] px-3.5 font-semibold text-[var(--color-shell-success)]',
          size === 'md' ? 'h-12 text-sm' : 'h-9 text-xs',
          className
        )}
      >
        <Check className="h-4 w-4" aria-hidden="true" />
        Saved
      </span>
    );
  }

  return (
    <Button
      onClick={onClick}
      size={size}
      disabled={disabled}
      isLoading={status === 'saving'}
      loadingText="Saving…"
      className={cn('gap-2', className)}
    >
      {status !== 'saving' && <Save className="h-4 w-4" aria-hidden="true" />}
      <span>Save changes</span>
      {status !== 'saving' && dirty && (
        <span
          aria-hidden="true"
          className="ml-0.5 h-1.5 w-1.5 rounded-full bg-[var(--color-shell-text-contrast)]"
        />
      )}
    </Button>
  );
};

export const MentorAvailabilityPage: React.FC = () => {
  const { user, activeRole } = useAuth();
  const mentorId = activeRole === 'mentor' ? user?.id : undefined;

  const {
    timezone,
    days: loadedDays,
    exceptions: loadedExceptions,
    loading,
    error,
    refetch,
  } = useMentorAvailability(mentorId);

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const [editException, setEditException] = useState<MentorAvailabilityException | null>(null);
  const [exceptionForm, setExceptionForm] = useState<ExceptionFormData>(initialExceptionForm);
  const [isExceptionDialogOpen, setIsExceptionDialogOpen] = useState(false);

  const [days, setDays] = useState<AvailabilityDay[]>([]);
  const [exceptions, setExceptions] = useState<MentorAvailabilityException[]>([]);

  /** Last snapshot known to match the database, used for unsaved-change detection. */
  const savedSignature = useRef<string>('');

  useEffect(() => {
    setDays(loadedDays);
    savedSignature.current = signatureOf(loadedDays, loadedExceptions);
  }, [loadedDays, loadedExceptions]);

  useEffect(() => {
    setExceptions(loadedExceptions);
  }, [loadedExceptions]);

  const currentSignature = useMemo(
    () => signatureOf(days, exceptions),
    [days, exceptions]
  );
  const isDirty = currentSignature !== savedSignature.current;

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const handleToggleDay = useCallback((dayIndex: number, enabled: boolean) => {
    setDays((prev) =>
      prev.map((day, idx) => {
        if (idx !== dayIndex) return day;
        if (enabled && day.windows.length === 0) {
          return { ...day, enabled, windows: [nextFreeWindow(day.windows)] };
        }
        return { ...day, enabled };
      })
    );
  }, []);

  const handleAddWindow = useCallback((dayIndex: number) => {
    setDays((prev) =>
      prev.map((day, idx) => {
        if (idx !== dayIndex) return day;
        return { ...day, windows: [...day.windows, nextFreeWindow(day.windows)] };
      })
    );
  }, []);

  const handleRemoveWindow = useCallback((dayIndex: number, windowIndex: number) => {
    setDays((prev) =>
      prev.map((day, idx) => {
        if (idx !== dayIndex) return day;
        return { ...day, windows: day.windows.filter((_, i) => i !== windowIndex) };
      })
    );
  }, []);

  const handleEditDay = useCallback((day: AvailabilityDay) => {
    setDays((prev) => prev.map((d) => (d.dayIndex === day.dayIndex ? day : d)));
  }, []);

  const handleReset = useCallback(() => {
    setDays(loadedDays);
    setExceptions(loadedExceptions);
    setSaveStatus('idle');
    setSaveError(null);
  }, [loadedDays, loadedExceptions]);

  const dayErrors = useMemo(() => days.map(validateDay), [days]);

  const hasValidationErrors = dayErrors.some((e) => e.length > 0);

  const openAddException = useCallback(() => {
    setExceptionForm({ ...initialExceptionForm, exceptionDate: localTodayISO() });
    setEditException(null);
    setIsExceptionDialogOpen(true);
  }, []);

  const openEditException = useCallback((ex: MentorAvailabilityException) => {
    setEditException(ex);
    setExceptionForm({
      exceptionDate: ex.exception_date,
      isAvailable: ex.is_available,
      startTime: ex.start_time?.slice(0, 5) || '09:00',
      endTime: ex.end_time?.slice(0, 5) || '17:00',
      reason: ex.reason || '',
    });
    setIsExceptionDialogOpen(true);
  }, []);

  const handleRemoveException = useCallback((ex: MentorAvailabilityException) => {
    setExceptions((prev) => prev.filter((e) => e.id !== ex.id));
  }, []);

  const exceptionTimeError =
    exceptionForm.isAvailable && exceptionForm.startTime >= exceptionForm.endTime
      ? 'Start time must be earlier than end time.'
      : null;

  const exceptionDateError =
    exceptions.some(
      (e) =>
        e.exception_date === exceptionForm.exceptionDate &&
        e.id !== editException?.id
    )
      ? 'You already have an exception for this date.'
      : null;

  const handleSaveException = useCallback(() => {
    if (!exceptionForm.exceptionDate) return;

    const newException: MentorAvailabilityException = {
      id: editException?.id || `temp-${Date.now()}`,
      mentor_id: mentorId || '',
      exception_date: exceptionForm.exceptionDate,
      is_available: exceptionForm.isAvailable,
      start_time: exceptionForm.isAvailable ? exceptionForm.startTime : null,
      end_time: exceptionForm.isAvailable ? exceptionForm.endTime : null,
      reason: exceptionForm.reason.trim() || null,
      created_at: editException?.created_at || new Date().toISOString(),
    };

    if (editException) {
      setExceptions((prev) => prev.map((e) => (e.id === editException.id ? newException : e)));
    } else {
      setExceptions((prev) => [...prev, newException]);
    }

    setIsExceptionDialogOpen(false);
    setExceptionForm(initialExceptionForm);
    setEditException(null);
  }, [editException, exceptionForm, mentorId]);

  const handleSave = async () => {
    if (!mentorId) return;

    if (hasValidationErrors) {
      setSaveStatus('error');
      setSaveError('Please fix the highlighted availability errors before saving.');
      return;
    }

    setSaveStatus('saving');
    setSaveError(null);

    try {
      const rules = days
        .filter((day) => day.enabled)
        .flatMap((day) =>
          day.windows.map((w) => ({
            dayOfWeek: day.dayIndex,
            startTime: w.start,
            endTime: w.end,
            isEnabled: true,
          }))
        );

      const availRes = await apiFetch('/api/mentor/availability', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules, timezone }),
      });

      if (!availRes.ok) {
        const err = await availRes.json();
        throw new Error(err.error?.message || 'Failed to save availability');
      }

      const excRes = await apiFetch('/api/mentor/availability/exceptions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exceptions: exceptions.map((ex) => ({
            exceptionDate: ex.exception_date,
            isAvailable: ex.is_available,
            startTime: ex.start_time,
            endTime: ex.end_time,
            reason: ex.reason,
          })),
        }),
      });

      if (!excRes.ok) {
        const err = await excRes.json();
        throw new Error(err.error?.message || 'Failed to save date exceptions');
      }

      savedSignature.current = signatureOf(days, exceptions);
      setSaveStatus('success');
      refetch();
      setTimeout(() => setSaveStatus('idle'), 2500);
    } catch (err: any) {
      setSaveStatus('error');
      setSaveError(err.message);
      setTimeout(() => setSaveStatus('idle'), 5000);
    }
  };

  const enabledDayCount = days.filter((d) => d.enabled).length;
  const totalWindowCount = days.reduce((sum, d) => sum + (d.enabled ? d.windows.length : 0), 0);
  const saveDisabled = saveStatus === 'saving' || hasValidationErrors;

  if (loading) {
    return (
      <LoadingState
        message="Loading your availability"
        description="Fetching your recurring hours and date exceptions."
      />
    );
  }

  if (error) {
    return (
      <ErrorState
        title="Failed to load availability"
        message={error}
        onRetry={refetch}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6 pb-28 sm:space-y-7 lg:pb-8">
      {/* Page header */}
      <header className="av-panel p-5 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-shell-text)] sm:text-[28px]">
              Global mentor availability
            </h1>
            <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-[var(--color-shell-text-muted)]">
              Manage your recurring schedule and date-specific exceptions. Your availability applies
              across all active mentoring segments and gigs.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--color-shell-text-muted)]">
                <Globe2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="font-mono">{timezone}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] px-2.5 py-1 text-xs font-medium text-[var(--color-shell-text-muted)]">
                {enabledDayCount} of {days.length} days available
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] px-2.5 py-1 text-xs font-medium text-[var(--color-shell-text-muted)]">
                {totalWindowCount} weekly time {totalWindowCount === 1 ? 'window' : 'windows'}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
            {isDirty && (
              <span className="hidden items-center gap-1.5 text-xs font-medium text-[var(--color-shell-text-muted)] sm:inline-flex">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full bg-[var(--color-shell-warning)]"
                />
                Unsaved changes
              </span>
            )}
            <div className="hidden lg:block">
              <SaveButton
                status={saveStatus}
                dirty={isDirty}
                disabled={saveDisabled}
                onClick={handleSave}
              />
            </div>
          </div>
        </div>

        {saveStatus === 'error' && saveError && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2.5 rounded-xl border border-[color-mix(in_srgb,var(--color-shell-error)_30%,transparent)] bg-[var(--color-shell-error-soft)] px-4 py-3"
          >
            <AlertCircle
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-shell-error)]"
              aria-hidden="true"
            />
            <p className="text-sm font-medium text-[var(--color-shell-error)]">{saveError}</p>
          </div>
        )}
      </header>

      {/* Global availability callout */}
      <section
        className="av-callout flex items-start gap-3.5 px-5 py-4"
        aria-label="Global availability"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--color-shell-primary-soft)] text-[var(--color-shell-primary)]">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-[var(--color-shell-text)]">Global availability</p>
          <p className="mt-1 text-sm leading-relaxed text-[var(--color-shell-text-muted)]">
            Your schedule applies across all active mentoring services. When a session is booked, that
            time is automatically unavailable across your other mentoring segments.
          </p>
        </div>
      </section>
      {/* Main content */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
        <section className="av-panel overflow-hidden" aria-label="Weekly recurring hours">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-shell-border)] px-5 py-5 sm:px-6">
            <div className="min-w-0">
              <h2 className="text-base font-bold tracking-tight text-[var(--color-shell-text)] sm:text-lg">
                Weekly recurring hours
              </h2>
              <p className="mt-1 text-sm text-[var(--color-shell-text-muted)]">
                Define your regular weekly availability. Toggle a day on to add time windows.
              </p>
            </div>
          </div>

          <div className="space-y-4 p-4 sm:p-6">
            {enabledDayCount === 0 && (
              <p className="rounded-xl border border-dashed border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] px-4 py-4 text-center text-xs leading-relaxed text-[var(--color-shell-text-muted)]">
                No recurring availability configured yet. Enable a day and add a time window to
                start accepting bookings.
              </p>
            )}

            <MentorAvailabilitySchedule
              days={days}
              timezone={timezone}
              errors={dayErrors}
              onToggleDay={handleToggleDay}
              onAddWindow={handleAddWindow}
              onRemoveWindow={handleRemoveWindow}
              onEdit={handleEditDay}
            />
          </div>
        </section>

        <section
          className="av-panel p-5 sm:p-6 lg:sticky lg:top-6"
          aria-label="Date exceptions"
        >
          <MentorExceptionList
            exceptions={exceptions}
            timezone={timezone}
            onAdd={openAddException}
            onEdit={openEditException}
            onRemove={handleRemoveException}
          />
        </section>
      </div>

      {/* Mobile sticky save bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--color-shell-border)] bg-[var(--color-shell-surface)]/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-[1400px] items-center gap-2">
          {isDirty && (
            <>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-shell-text-muted)]">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full bg-[var(--color-shell-warning)]"
                />
                Unsaved
              </span>
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-[var(--color-shell-text-muted)] transition-colors hover:bg-[var(--color-shell-bg)] hover:text-[var(--color-shell-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)]"
              >
                <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                Reset
              </button>
            </>
          )}
          <div className="ml-auto">
            <SaveButton
              status={saveStatus}
              dirty={isDirty}
              disabled={saveDisabled}
              onClick={handleSave}
              size="sm"
            />
          </div>
        </div>
      </div>
      <Dialog
        open={isExceptionDialogOpen}
        onOpenChange={setIsExceptionDialogOpen}
        maxWidth="lg"
        title={editException ? 'Edit date exception' : 'Add date exception'}
        description="Date exceptions override your recurring weekly hours for that specific date."
      >
        <div className="space-y-5">
          <Input
            type="date"
            label="Date"
            required
            value={exceptionForm.exceptionDate}
            min={localTodayISO()}
            error={exceptionDateError}
            helperText={exceptionDateError ? undefined : `Times are in ${timezone}.`}
            onChange={(e) =>
              setExceptionForm({ ...exceptionForm, exceptionDate: e.target.value })
            }
          />

          <fieldset>
            <legend className="text-xs font-semibold text-[var(--color-shell-text)]">
              Exception type
            </legend>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {EXCEPTION_TYPES.map((option) => {
                const selected = exceptionForm.isAvailable === option.value;
                return (
                  <label
                    key={option.label}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors',
                      'focus-within:ring-2 focus-within:ring-[var(--color-shell-focus)] focus-within:ring-offset-2',
                      selected
                        ? 'border-[var(--color-shell-primary)] bg-[var(--color-shell-primary-soft)]'
                        : 'border-[var(--color-shell-border-strong)] bg-[var(--color-shell-surface)]'
                    )}
                  >
                    <input
                      type="radio"
                      name="exception-type"
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-shell-primary)]"
                      checked={selected}
                      onChange={() =>
                        setExceptionForm({ ...exceptionForm, isAvailable: option.value })
                      }
                    />
                    <span className="min-w-0">
                      <span
                        className={cn(
                          'block text-sm font-semibold',
                          selected
                            ? 'text-[var(--color-shell-primary)]'
                            : 'text-[var(--color-shell-text)]'
                        )}
                      >
                        {option.label}
                      </span>
                      <span className="mt-0.5 block text-xs text-[var(--color-shell-text-muted)]">
                        {option.hint}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {exceptionForm.isAvailable && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                type="time"
                label="Start time"
                value={exceptionForm.startTime}
                error={exceptionTimeError}
                onChange={(e) =>
                  setExceptionForm({ ...exceptionForm, startTime: e.target.value })
                }
              />
              <Input
                type="time"
                label="End time"
                value={exceptionForm.endTime}
                error={exceptionTimeError}
                onChange={(e) =>
                  setExceptionForm({ ...exceptionForm, endTime: e.target.value })
                }
              />
            </div>
          )}

          <Textarea
            label="Reason (optional)"
            value={exceptionForm.reason}
            rows={2}
            placeholder={
              exceptionForm.isAvailable
                ? 'e.g. Extended hours for a workshop'
                : 'e.g. Holiday, personal leave'
            }
            onChange={(e) => setExceptionForm({ ...exceptionForm, reason: e.target.value })}
          />

          <div className="flex flex-col-reverse gap-2 border-t border-[var(--color-shell-border)] pt-4 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setIsExceptionDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveException}
              disabled={
                !exceptionForm.exceptionDate ||
                Boolean(exceptionTimeError) ||
                Boolean(exceptionDateError)
              }
            >
              {editException ? 'Save exception' : 'Add exception'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};

