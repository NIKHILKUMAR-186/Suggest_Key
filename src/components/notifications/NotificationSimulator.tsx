import React, { useState } from 'react';
import { Play, Sparkles, Loader2, Check } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import {
  NOTIFICATION_EVENT_PRESETS,
  simulateNotificationEvent,
} from '@/src/lib/notificationService';
import type { NotificationEventType } from '@/src/types/database';

interface NotificationSimulatorProps {
  userId: string;
  role: 'seeker' | 'mentor' | 'admin';
  onEventDispatched: () => void;
}

export const NotificationSimulator: React.FC<NotificationSimulatorProps> = ({
  userId,
  role,
  onEventDispatched,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<NotificationEventType | ''>('');
  const [bookingCode, setBookingCode] = useState('BK-9021');
  const [isTriggering, setIsTriggering] = useState(false);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const presets = NOTIFICATION_EVENT_PRESETS.filter((p) => p.category === role);

  const handleTrigger = async () => {
    if (!selectedEvent) return;
    setIsTriggering(true);
    try {
      const result = await simulateNotificationEvent(selectedEvent, userId, bookingCode);
      if (result) {
        setSuccessNotice(`Dispatched real "${result.title}" event to database!`);
        setTimeout(() => setSuccessNotice(null), 4000);
        onEventDispatched();
        setSelectedEvent('');
      }
    } catch (err) {
      console.error('Trigger failed:', err);
    } finally {
      setIsTriggering(false);
    }
  };

  return (
    <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50/70 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-zinc-200 text-zinc-700">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-zinc-900">
              Event Trigger Simulator ({role.toUpperCase()})
            </h4>
            <p className="text-[11px] text-zinc-500">
              Instantly simulate any authoritative lifecycle event and commit it directly to the database.
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsOpen(!isOpen)}
          className="text-xs font-medium text-zinc-600 hover:text-zinc-900 underline cursor-pointer"
        >
          {isOpen ? 'Hide Panel' : 'Show Event Catalog'}
        </button>
      </div>

      {isOpen && (
        <div className="pt-2 border-t border-zinc-200/80 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-medium text-zinc-600 mb-1">
                Select Lifecycle Event ({presets.length} presets available)
              </label>
              <select
                id="simulator-event-select"
                value={selectedEvent}
                onChange={(e) => setSelectedEvent(e.target.value as NotificationEventType)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-800 focus:border-zinc-950 focus:outline-hidden"
              >
                <option value="">-- Choose an event type --</option>
                {presets.map((p) => (
                  <option key={p.eventType} value={p.eventType}>
                    {p.title} ({p.eventType})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-zinc-600 mb-1">
                Booking Reference
              </label>
              <input
                type="text"
                value={bookingCode}
                onChange={(e) => setBookingCode(e.target.value)}
                placeholder="BK-9021"
                className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-800 focus:border-zinc-950 focus:outline-hidden font-mono uppercase"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-[11px] text-zinc-500">
              {selectedEvent ? (
                <span>
                  Target URL: <code className="bg-zinc-200/60 px-1 py-0.5 rounded text-[10px]">{presets.find(p => p.eventType === selectedEvent)?.linkTemplate(bookingCode)}</code>
                </span>
              ) : (
                'Select an event above to inspect preview payload'
              )}
            </span>

            <Button
              id="simulator-trigger-btn"
              onClick={handleTrigger}
              disabled={!selectedEvent || isTriggering}
              size="sm"
              className="gap-1.5 text-xs h-8"
            >
              {isTriggering ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5 fill-current" />
              )}
              <span>Commit Event to DB</span>
            </Button>
          </div>
        </div>
      )}

      {successNotice && (
        <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-medium animate-in fade-in duration-200">
          <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <span>{successNotice}</span>
        </div>
      )}
    </div>
  );
};
