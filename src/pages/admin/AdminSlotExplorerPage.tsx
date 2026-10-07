import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Info, Loader2, Search } from 'lucide-react';

import { Badge } from '@/src/components/ui/Badge';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { apiFetch } from '@/src/lib/apiClient';
import { toUserMessage } from '@/src/lib/errorMessages';
import type { GeneratedSlot, SlotStatus } from '@/src/types/database';

/**
 * Ask the slot engine what a mentor has open on a date.
 *
 * This page generates NOTHING in the browser. Slots are produced by the server
 * from `mentor_availability`, exceptions, gigs, bookings and `slot_holds` —
 * the same call the seeker flow makes — because a client-side query of those
 * tables would only see the caller's own reservations and would offer slots
 * that are already taken. If the request fails, the operator sees an error,
 * never invented times.
 *
 * Read-only: booking, holds and availability edits all stay on their own
 * surfaces.
 */

interface MentorOption {
  id: string;
  name: string;
  email: string;
  gigs: Array<{ id: string; title: string; is_active: boolean; duration_minutes: number }>;
}

interface SlotResult {
  mentor_id: string;
  timezone: string;
  gig: { id: string; title: string; duration_minutes: number; price_inr: number; is_active: boolean } | null;
  slots: GeneratedSlot[];
  available_count: number;
  next_hold_expires_at: string | null;
  next_slot_start_at: string | null;
}

const STATUS_TONE: Record<SlotStatus, string> = {
  AVAILABLE: 'border-[var(--status-success-border)] bg-[var(--status-success-soft)] text-[var(--status-success-strong)]',
  CLOSING_SOON: 'border-[var(--status-warning-border)] bg-[var(--status-warning-soft)] text-[var(--status-warning-strong)]',
  BOOKED: 'border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] text-[var(--color-shell-text-subtle)] line-through',
  HELD: 'border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-text-muted)]',
  PAST: 'border-[var(--color-shell-border)] bg-transparent text-[var(--color-shell-text-subtle)] opacity-60',
};

const todayIso = (): string => new Date().toISOString().slice(0, 10);

export const AdminSlotExplorerPage: React.FC = () => {
  const [mentors, setMentors] = useState<MentorOption[]>([]);
  const [mentorsLoading, setMentorsLoading] = useState(true);
  const [mentorsError, setMentorsError] = useState<string | null>(null);

  const [mentorId, setMentorId] = useState('');
  const [gigId, setGigId] = useState('');
  const [date, setDate] = useState(todayIso());

  const [result, setResult] = useState<SlotResult | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const loadMentors = useCallback(async () => {
    setMentorsLoading(true);
    setMentorsError(null);
    try {
      const res = await apiFetch('/api/admin/mentors');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error?.message || 'Failed to load mentors');
      setMentors(data.mentors || []);
    } catch (err) {
      setMentorsError(toUserMessage(err, 'Failed to load mentors'));
    } finally {
      setMentorsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMentors();
  }, [loadMentors]);

  const selectedMentor = useMemo(
    () => mentors.find((m) => m.id === mentorId) || null,
    [mentors, mentorId],
  );

  const search = useCallback(async () => {
    if (!mentorId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    setSlotsLoading(true);
    setSlotsError(null);
    setSearched(true);
    try {
      const params = new URLSearchParams({ mentorId, date });
      if (gigId) params.set('gigId', gigId);
      const res = await apiFetch(`/api/mentor-availability/slots?${params.toString()}`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || 'Unable to load availability.');
      }
      const first = (data.mentors || [])[0] as SlotResult | undefined;
      setResult(first ?? null);
      setGeneratedAt(data.generated_at || null);
      if (!first || first.slots.length === 0) {
        // Not an error: a day with no availability is a real, common answer.
        setResult(first ?? null);
      }
    } catch (err) {
      setResult(null);
      setGeneratedAt(null);
      setSlotsError(toUserMessage(err, 'Unable to load availability.'));
    } finally {
      setSlotsLoading(false);
    }
  }, [mentorId, gigId, date]);

  const grouped = useMemo(() => {
    if (!result) return [] as Array<{ label: string; slots: GeneratedSlot[] }>;
    const byDate = new Map<string, GeneratedSlot[]>();
    for (const slot of result.slots) {
      const bucket = byDate.get(slot.date) ?? [];
      bucket.push(slot);
      byDate.set(slot.date, bucket);
    }
    return [...byDate.entries()].map(([label, slots]) => ({ label, slots }));
  }, [result]);

  const counts = useMemo(() => {
    const total = result?.slots.length ?? 0;
    const available = result?.available_count ?? 0;
    const held = result?.slots.filter((s) => s.status === 'HELD').length ?? 0;
    const booked = result?.slots.filter((s) => s.status === 'BOOKED').length ?? 0;
    return { total, available, held, booked };
  }, [result]);

  return (
    <div className="space-y-6">
      <div className="border-b border-[var(--color-shell-border)] pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-shell-text)] sm:text-3xl">
          Slot Explorer
        </h1>
        <p className="mt-1 text-xs text-[var(--color-shell-text-muted)]">
          Ask the real slot engine what a mentor has open on a date. Every slot below was generated
          by the server from availability, exceptions, bookings and live holds — the browser never
          invents a time.
        </p>
      </div>

      {mentorsError && (
        <div className="flex items-start gap-2 rounded-xl border border-[var(--color-shell-error)]/35 bg-[var(--color-shell-error-soft)] px-4 py-3 text-xs text-[var(--color-shell-error)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{mentorsError}</span>
        </div>
      )}

      <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-4">
        {mentorsLoading ? (
          <div className="flex items-center gap-2 text-xs text-[var(--color-shell-text-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading mentors…
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label htmlFor="slot-mentor" className="block text-xs font-semibold text-[var(--color-shell-text)]">
                Mentor
              </label>
              <select
                id="slot-mentor"
                value={mentorId}
                onChange={(e) => {
                  setMentorId(e.target.value);
                  setGigId('');
                  setResult(null);
                  setSearched(false);
                }}
                className="h-10 w-full rounded-lg border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] px-3 text-sm text-[var(--color-shell-text)] focus:border-[var(--color-shell-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-shell-accent-soft)]"
              >
                <option value="">Choose a mentor…</option>
                {mentors.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.email ? ` · ${m.email}` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="slot-gig" className="block text-xs font-semibold text-[var(--color-shell-text)]">
                Gig (optional)
              </label>
              <select
                id="slot-gig"
                value={gigId}
                onChange={(e) => {
                  setGigId(e.target.value);
                  setResult(null);
                  setSearched(false);
                }}
                disabled={!selectedMentor || (selectedMentor.gigs?.length ?? 0) === 0}
                className="h-10 w-full rounded-lg border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] px-3 text-sm text-[var(--color-shell-text)] focus:border-[var(--color-shell-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-shell-accent-soft)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">All of this mentor's gigs</option>
                {(selectedMentor?.gigs ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                    {g.is_active ? '' : ' (paused)'}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="slot-date" className="block text-xs font-semibold text-[var(--color-shell-text)]">
                Date
              </label>
              <div className="flex gap-2">
                <Input
                  id="slot-date"
                  type="date"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setResult(null);
                    setSearched(false);
                  }}
                  className="h-10 flex-1 text-sm"
                />
                <Button
                  size="sm"
                  className="h-10 px-4"
                  disabled={!mentorId || slotsLoading}
                  onClick={() => void search()}
                >
                  {slotsLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                  <span>Explore</span>
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {slotsError && (
        <div className="flex items-start gap-2 rounded-xl border border-[var(--color-shell-error)]/35 bg-[var(--color-shell-error-soft)] px-4 py-3 text-xs text-[var(--color-shell-error)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{slotsError}</span>
        </div>
      )}
      {slotsError === null && result === null && (
        <EmptyState
          title={searched ? 'No slots generated' : 'Pick a mentor and a date'}
          description={
            searched
              ? 'The engine returned nothing for this combination. Try another date or gig.'
              : 'The explorer asks the server slot engine.'
          }
        />
      )}

      {slotsError === null && result !== null && (
        <div className="space-y-4 rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-shell-text-muted)]">
            <span>
              {counts.available} of {counts.total} open
            </span>
            {generatedAt ? <span>generated {new Date(generatedAt).toLocaleTimeString()}</span> : null}
            {result.next_slot_start_at ? (
              <span>Next change {new Date(result.next_slot_start_at).toLocaleTimeString()}</span>
            ) : null}
          </div>
          {result.slots.length === 0 ? (
            <EmptyState
              title="No slots on this date"
              description="Nothing was generated for this mentor on this date."
            />
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {result.slots.map((slot) => (
                <li
                  key={slot.id}
                  className={`flex items-center justify-between rounded-xl border px-3 py-2 text-xs ${STATUS_TONE[slot.status]}`}
                >
                  <span className="font-semibold tabular-nums">
                    {slot.local_start_time} - {slot.local_end_time}
                  </span>
                  <Badge variant={slot.is_available ? 'success' : 'secondary'}>{slot.status}</Badge>
                </li>
              ))}
            </ul>
          )}
          <p className="flex items-start gap-2 text-xs text-[var(--color-shell-text-muted)]">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Read-only preview of seeker-facing availability.</span>
          </p>
        </div>
      )}
    </div>
  );
};


