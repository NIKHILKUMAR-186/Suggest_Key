import React, { useState } from 'react';
import { Clock, Calendar as CalendarIcon, Plus, Trash2, ShieldCheck, Check, AlertCircle } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';

interface TimeWindow {
  id: string;
  start: string;
  end: string;
}

interface DaySchedule {
  day: string;
  enabled: boolean;
  windows: TimeWindow[];
}

export const MentorAvailabilityPage: React.FC = () => {
  const [mentorTimezone, setMentorTimezone] = useState('Asia/Kolkata');
  const [saveAlert, setSaveAlert] = useState(false);

  // Prototype recurring days representation
  const [recurringDays, setRecurringDays] = useState<DaySchedule[]>([
    { day: 'Monday', enabled: true, windows: [{ id: '1', start: '10:00', end: '13:00' }, { id: '2', start: '17:00', end: '20:00' }] },
    { day: 'Tuesday', enabled: true, windows: [{ id: '3', start: '09:00', end: '12:00' }] },
    { day: 'Wednesday', enabled: true, windows: [{ id: '4', start: '17:00', end: '21:00' }] },
    { day: 'Thursday', enabled: false, windows: [] },
    { day: 'Friday', enabled: true, windows: [{ id: '5', start: '14:00', end: '18:00' }] },
    { day: 'Saturday', enabled: true, windows: [{ id: '6', start: '10:00', end: '14:00' }] },
    { day: 'Sunday', enabled: false, windows: [] },
  ]);

  // Date exceptions
  const [exceptions, setExceptions] = useState([
    { date: '2026-03-25', status: 'custom', start: '14:00', end: '18:00', note: 'Custom afternoon window' },
    { date: '2026-03-28', status: 'unavailable', note: 'All-day unavailable' },
  ]);

  const handleSave = () => {
    setSaveAlert(true);
    setTimeout(() => setSaveAlert(false), 3000);
  };

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

        <Button onClick={handleSave} size="md" className="self-start text-xs">
          Save Availability Settings
        </Button>
      </div>

      {saveAlert && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800">
          <Check className="h-4 w-4 text-emerald-600" />
          <span>Availability saved to mentor_availability with atomic timeline validation.</span>
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
                {mentorTimezone}
              </Badge>
            </div>

            <div className="space-y-4">
              {recurringDays.map((schedule, idx) => (
                <div
                  key={schedule.day}
                  className={`p-3.5 rounded-lg border transition-colors ${
                    schedule.enabled
                      ? 'border-zinc-200 bg-white'
                      : 'border-zinc-100 bg-zinc-50/60 opacity-60'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={schedule.enabled}
                        onChange={(e) => {
                          const updated = [...recurringDays];
                          updated[idx].enabled = e.target.checked;
                          if (e.target.checked && updated[idx].windows.length === 0) {
                            updated[idx].windows.push({ id: Math.random().toString(), start: '09:00', end: '17:00' });
                          }
                          setRecurringDays(updated);
                        }}
                        className="rounded border-zinc-300"
                        id={`check-${schedule.day}`}
                      />
                      <label htmlFor={`check-${schedule.day}`} className="text-xs font-bold text-zinc-900 cursor-pointer">
                        {schedule.day}
                      </label>
                    </div>

                    {schedule.enabled && (
                      <button
                        type="button"
                        onClick={() => {
                          const updated = [...recurringDays];
                          updated[idx].windows.push({ id: Math.random().toString(), start: '18:00', end: '20:00' });
                          setRecurringDays(updated);
                        }}
                        className="text-[11px] font-medium text-zinc-600 hover:text-zinc-950 inline-flex items-center gap-1"
                      >
                        <Plus className="h-3 w-3" /> Add Window
                      </button>
                    )}
                  </div>

                  {schedule.enabled ? (
                    <div className="space-y-2 pt-1">
                      {schedule.windows.map((w, wIdx) => (
                        <div key={w.id} className="flex items-center gap-2 text-xs">
                          <input
                            type="time"
                            value={w.start}
                            onChange={(e) => {
                              const updated = [...recurringDays];
                              updated[idx].windows[wIdx].start = e.target.value;
                              setRecurringDays(updated);
                            }}
                            className="rounded-md border border-zinc-200 px-2 py-1 bg-zinc-50"
                          />
                          <span className="text-zinc-400">to</span>
                          <input
                            type="time"
                            value={w.end}
                            onChange={(e) => {
                              const updated = [...recurringDays];
                              updated[idx].windows[wIdx].end = e.target.value;
                              setRecurringDays(updated);
                            }}
                            className="rounded-md border border-zinc-200 px-2 py-1 bg-zinc-50"
                          />
                          {schedule.windows.length > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                const updated = [...recurringDays];
                                updated[idx].windows = updated[idx].windows.filter((_, i) => i !== wIdx);
                                setRecurringDays(updated);
                              }}
                              className="text-zinc-400 hover:text-red-600 p-1"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[11px] text-zinc-400 italic">Marked Unavailable</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Col: Date Exceptions */}
        <div className="space-y-6">
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-4">
            <div className="border-b border-zinc-100 pb-3">
              <h2 className="text-base font-bold text-zinc-950">Date Exceptions</h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                Date-specific exceptions override normal recurring availability.
              </p>
            </div>

            <div className="space-y-3">
              {exceptions.map((ex, idx) => (
                <div key={idx} className="p-3 rounded-lg border border-zinc-200 bg-zinc-50/60 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-zinc-900">{ex.date}</span>
                    <Badge variant={ex.status === 'unavailable' ? 'destructive' : 'secondary'} className="text-[10px]">
                      {ex.status === 'unavailable' ? 'Unavailable' : 'Custom Hours'}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-zinc-500">
                    {ex.note} {ex.start && `(${ex.start} – ${ex.end})`}
                  </p>
                </div>
              ))}
            </div>

            <Button variant="outline" size="sm" className="w-full gap-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" />
              <span>Add Date Override</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
