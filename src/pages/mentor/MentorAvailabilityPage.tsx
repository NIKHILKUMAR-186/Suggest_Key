import React, { useState, useCallback, useEffect } from 'react';
import { ShieldCheck, AlertCircle, Check } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { Input } from '@/src/components/ui/Input';
import { Textarea } from '@/src/components/ui/Textarea';
import { Dialog } from '@/src/components/ui/Dialog';
import { useAuth } from '@/src/context/AuthContext';
import { apiFetch } from '@/src/lib/apiClient';
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

export const MentorAvailabilityPage: React.FC = () => {
  const { user, activeRole } = useAuth();
  const mentorId = activeRole === 'mentor' ? user?.id : undefined;

  const { timezone, days: loadedDays, exceptions: loadedExceptions, loading, error, refetch } = useMentorAvailability(mentorId);

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const [editException, setEditException] = useState<MentorAvailabilityException | null>(null);
  const [exceptionForm, setExceptionForm] = useState<ExceptionFormData>(initialExceptionForm);
  const [isExceptionDialogOpen, setIsExceptionDialogOpen] = useState(false);

  const [days, setDays] = useState<AvailabilityDay[]>([]);
  const [exceptions, setExceptions] = useState<MentorAvailabilityException[]>([]);

  useEffect(() => {
    setDays(loadedDays);
  }, [loadedDays]);

  useEffect(() => {
    setExceptions(loadedExceptions);
  }, [loadedExceptions]);

  const handleToggleDay = useCallback((dayIndex: number, enabled: boolean) => {
    setDays((prev) =>
      prev.map((day, idx) => {
        if (idx !== dayIndex) return day;
        return {
          ...day,
          enabled,
          windows: enabled && day.windows.length === 0 ? [{ start: '09:00', end: '17:00' }] : day.windows,
        };
      })
    );
  }, []);

  const handleAddWindow = useCallback((dayIndex: number) => {
    setDays((prev) =>
      prev.map((day, idx) => {
        if (idx !== dayIndex) return day;
        return {
          ...day,
          windows: [...day.windows, { start: '18:00', end: '20:00' }],
        };
      })
    );
  }, []);

  const handleRemoveWindow = useCallback((dayIndex: number, windowIndex: number) => {
    setDays((prev) =>
      prev.map((day, idx) => {
        if (idx !== dayIndex) return day;
        return {
          ...day,
          windows: day.windows.filter((_, i) => i !== windowIndex),
        };
      })
    );
  }, []);

  const handleEditDay = useCallback((day: AvailabilityDay) => {
    setDays((prev) =>
      prev.map((d) => (d.dayIndex === day.dayIndex ? day : d))
    );
  }, []);

  const openAddException = useCallback(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];
    setExceptionForm({ ...initialExceptionForm, exceptionDate: dateStr });
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

  const handleSaveException = useCallback(() => {
    if (!exceptionForm.exceptionDate) return;

    const newException: MentorAvailabilityException = {
      id: editException?.id || 'temp-' + Date.now(),
      mentor_id: mentorId || '',
      exception_date: exceptionForm.exceptionDate,
      is_available: exceptionForm.isAvailable,
      start_time: exceptionForm.isAvailable ? exceptionForm.startTime : null,
      end_time: exceptionForm.isAvailable ? exceptionForm.endTime : null,
      reason: exceptionForm.reason.trim() || null,
      created_at: new Date().toISOString(),
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

      setSaveStatus('success');
      refetch();
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err: any) {
      setSaveStatus('error');
      setSaveError(err.message);
      setTimeout(() => setSaveStatus('idle'), 5000);
    }
  };

  const hasAvailability = days.some((day) => day.enabled && day.windows.length > 0);

  if (loading) {
    return (
      <div className="space-y-8">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
          <span className="ml-3 text-sm text-muted">Loading availability...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-8">
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-6">
          <AlertCircle className="h-5 w-5 text-red-600 shrink-0" />
          <div>
            <p className="font-bold text-red-900">Failed to load availability</p>
            <p className="text-sm text-red-700 mt-1">{error}</p>
            <Button onClick={refetch} size="sm" variant="outline" className="mt-3">
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">
            Global Mentor Availability
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Availability is global across all your gigs. Stored in UTC and configured in your mentor timezone.
          </p>
        </div>

        <Button onClick={handleSave} size="md" className="self-start text-xs" disabled={saveStatus === 'saving'}>
          {saveStatus === 'saving' ? 'Saving...' : 'Save Availability Settings'}
        </Button>
      </div>

      {saveStatus === 'success' && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800">
          <Check className="h-4 w-4 text-emerald-600" />
          <span>Availability saved successfully.</span>
        </div>
      )}

      {saveStatus === 'error' && saveError && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-800">
          <AlertCircle className="h-4 w-4 text-red-600" />
          <span>{saveError}</span>
        </div>
      )}

      {/* Global Invariant Banner */}
      <div className="flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50/50 p-4 text-xs text-blue-900">
        <ShieldCheck className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <span className="font-bold text-sm">Fundamental Business Invariant:</span>
          <p className="text-blue-800 leading-relaxed">
            Availability belongs to you, not to any individual gig. A slot booked in one segment automatically locks your timeline across all other segments you mentor.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left 2 Cols: Recurring Weekly Windows */}
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-5">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
              <div>
                <h2 className="text-base font-bold text-zinc-950">Weekly Recurring Hours</h2>
                <p className="text-xs text-zinc-500 mt-0.5">Define your regular recurring availability.</p>
              </div>
              <Badge variant="secondary" className="text-[11px] font-mono">
                {timezone}
              </Badge>
            </div>

            <MentorAvailabilitySchedule
              days={days}
              timezone={timezone}
              onToggleDay={handleToggleDay}
              onAddWindow={handleAddWindow}
              onRemoveWindow={handleRemoveWindow}
              onEdit={handleEditDay}
            />

            {!hasAvailability && (
              <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50/60 p-6 text-center">
                <p className="text-xs text-zinc-500">No recurring availability configured.</p>
                <p className="text-[11px] text-zinc-400 mt-1">Enable a day and add a time window to begin.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Col: Date Exceptions */}
        <div className="space-y-6">
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-4">
            <MentorExceptionList
              exceptions={exceptions}
              timezone={timezone}
              onAdd={openAddException}
              onEdit={openEditException}
              onRemove={handleRemoveException}
            />
          </div>
        </div>
      </div>

      {/* Exception Dialog */}
      <Dialog
        open={isExceptionDialogOpen}
        onOpenChange={setIsExceptionDialogOpen}
        title={editException ? 'Edit Date Override' : 'Add Date Override'}
        description="Configure a date-specific exception to your recurring schedule."
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 mb-1">Date</label>
            <Input
              type="date"
              value={exceptionForm.exceptionDate}
              onChange={(e) => setExceptionForm({ ...exceptionForm, exceptionDate: e.target.value })}
              min={new Date().toISOString().split('T')[0]}
              className="w-full"
            />
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={exceptionForm.isAvailable}
                onChange={(e) => setExceptionForm({ ...exceptionForm, isAvailable: e.target.checked })}
                className="rounded border-zinc-300"
              />
              <span className="text-sm font-medium text-zinc-900">Available (custom hours)</span>
            </label>
          </div>

          {exceptionForm.isAvailable && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">Start Time</label>
                <Input
                  type="time"
                  value={exceptionForm.startTime}
                  onChange={(e) => setExceptionForm({ ...exceptionForm, startTime: e.target.value })}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">End Time</label>
                <Input
                  type="time"
                  value={exceptionForm.endTime}
                  onChange={(e) => setExceptionForm({ ...exceptionForm, endTime: e.target.value })}
                  className="w-full"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-zinc-700 mb-1">Reason (optional)</label>
            <Textarea
              value={exceptionForm.reason}
              onChange={(e) => setExceptionForm({ ...exceptionForm, reason: e.target.value })}
              placeholder={exceptionForm.isAvailable ? 'e.g., Extended hours for workshop' : 'e.g., Holiday, personal leave'}
              rows={2}
              className="w-full"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setIsExceptionDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveException} disabled={!exceptionForm.exceptionDate || (exceptionForm.isAvailable && (!exceptionForm.startTime || !exceptionForm.endTime || exceptionForm.startTime >= exceptionForm.endTime))}>
              {editException ? 'Save Changes' : 'Add Override'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
