import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Hourglass, Loader2 } from 'lucide-react';

import { Badge } from '@/src/components/ui/Badge';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { apiFetch } from '@/src/lib/apiClient';
import { toUserMessage } from '@/src/lib/errorMessages';

/**
 * Active slot holds, and the terminal states for when something else happened.
 *
 * Holds are the short-lived reservations that subtract availability from the
 * slot engine — a 5-minute payment hold or a 24-hour reschedule hold — and a
 * cron sweeps them. The operational question is always "what is held right
 * now, and until when", so ACTIVE is the default view, ordered by expiry, and
 * every countdown is measured against the SERVER clock (`serverNow`), never
 * the browser's, so a wrong laptop clock cannot render a hold as expired.
 *
 * Read-only: releasing or converting a hold is a server-side transition
 * triggered by payment or cron, not by this page.
 */

type HoldFilter = 'ACTIVE' | 'CONVERTED' | 'EXPIRED' | 'RELEASED' | 'ALL';

const FILTERS: Array<{ key: HoldFilter; label: string }> = [
  { key: 'ACTIVE', label: 'Active' },
  { key: 'CONVERTED', label: 'Converted' },
  { key: 'EXPIRED', label: 'Expired' },
  { key: 'RELEASED', label: 'Released' },
  { key: 'ALL', label: 'All' },
];

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'secondary' | 'outline'> = {
  ACTIVE: 'warning',
  CONVERTED: 'success',
  EXPIRED: 'secondary',
  RELEASED: 'outline',
};

interface AdminHoldRow {
  id: string;
  status: string;
  start_time: string;
  end_time: string;
  expires_at: string;
  created_at: string;
  mentor: { id: string; full_name: string | null } | null;
  seeker: { id: string; full_name: string | null } | null;
  gig: { id: string; title: string; duration_minutes: number } | null;
}

/** "2m 14s left" / "expired 41s ago", measured against the server clock. */
const describeExpiry = (expiresAt: string, serverNowMs: number): string => {
  const deltaMs = Date.parse(expiresAt) - serverNowMs;
  if (Number.isNaN(deltaMs)) return '—';
  const seconds = Math.round(Math.abs(deltaMs) / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const span = m > 0 ? `${m}m ${s}s` : `${s}s`;
  return deltaMs >= 0 ? `${span} left` : `expired ${span} ago`;
};

export const AdminHoldsPage: React.FC = () => {
  const [holds, setHolds] = useState<AdminHoldRow[]>([]);
  const [serverNow, setServerNow] = useState<number>(Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<HoldFilter>('ACTIVE');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/holds?status=${encodeURIComponent(filter)}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error?.message || 'Failed to load holds');
      setHolds(data.holds || []);
      // The server stamps every response; countdowns are relative to it.
      setServerNow(data.serverNow ? Date.parse(data.serverNow) : Date.now());
    } catch (err) {
      setError(toUserMessage(err, 'Failed to load holds'));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  // Active holds are a live queue: refresh the snapshot every 15s so an
  // operator watching a countdown is not reading a stale list. Only the
  // ACTIVE view needs this — terminal states do not move.
  useEffect(() => {
    if (filter !== 'ACTIVE') return;
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void load();
    }, 15_000);
    return () => clearInterval(timer);
  }, [filter, load]);

  const activeCount = useMemo(() => holds.filter((h) => h.status === 'ACTIVE').length, [holds]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-[var(--color-shell-border)] pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-shell-text)] sm:text-3xl">
            Active Holds
          </h1>
          <p className="mt-1 text-xs text-[var(--color-shell-text-muted)]">
            Short-lived reservations that subtract a slot from availability while a payment or a
            reschedule decision is in flight. Counting down against the server clock.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 self-start rounded-lg bg-[var(--color-shell-bg)] p-1 text-xs">
          {FILTERS.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={filter === option.key}
              onClick={() => setFilter(option.key)}
              className={`cursor-pointer rounded-md px-2.5 py-1.5 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] ${
                filter === option.key
                  ? 'bg-[var(--color-shell-surface)] text-[var(--color-shell-primary)] shadow-xs'
                  : 'text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)]'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {filter === 'ACTIVE' && !loading && !error && (
        <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
          {activeCount === 0
            ? 'No slot is held right now.'
            : `${activeCount} slot${activeCount === 1 ? ' is' : 's are'} held. An ACTIVE hold expires on its own; the cron sweep releases it within a minute of expiry.`}
        </p>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-[var(--color-shell-error)]/35 bg-[var(--color-shell-error-soft)] px-4 py-3 text-xs text-[var(--color-shell-error)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)]">
        {loading ? (
          <div className="p-8 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-[var(--color-shell-text-subtle)]" />
            <p className="mt-2 text-xs text-[var(--color-shell-text-muted)]">Loading holds…</p>
          </div>
        ) : holds.length === 0 ? (
          <EmptyState
            icon={Hourglass}
            title={filter === 'ACTIVE' ? 'No active holds' : 'No holds in this state'}
            description={
              filter === 'ACTIVE'
                ? 'Nothing is reserving a slot right now. Active holds appear here the moment a seeker starts booking or asks for a reschedule.'
                : `No hold has reached the ${filter.toLowerCase()} state in the recent window.`
            }
          />
        ) : (
          <div className="table-scroll">
            <table className="w-full text-left text-xs text-[var(--color-shell-text-muted)]">
              <thead className="border-b border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] text-[11px] font-semibold uppercase tracking-wider text-[var(--color-shell-text)]">
                <tr>
                  <th className="px-4 py-3">Slot</th>
                  <th className="px-4 py-3">Gig</th>
                  <th className="px-4 py-3">Seeker</th>
                  <th className="px-4 py-3">Mentor</th>
                  <th className="px-4 py-3">Expires</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-shell-border)]">
                {holds.map((hold) => (
                  <tr key={hold.id} className="transition-colors hover:bg-[var(--color-shell-bg)]">
                    <td className="px-4 py-3">
                      <span className="block font-semibold text-[var(--color-shell-text)]">
                        {new Date(hold.start_time).toLocaleString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-[var(--color-shell-text-subtle)]">
                        →{' '}
                        {new Date(hold.end_time).toLocaleTimeString('en-IN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="block text-[var(--color-shell-text)]">
                        {hold.gig?.title || 'Unknown gig'}
                      </span>
                      {hold.gig && (
                        <span className="mt-0.5 block text-[11px] text-[var(--color-shell-text-subtle)]">
                          {hold.gig.duration_minutes} min
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">{hold.seeker?.full_name || 'Unknown'}</td>
                    <td className="px-4 py-3">{hold.mentor?.full_name || 'Unknown'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`block font-mono text-[11px] font-semibold ${
                          hold.status === 'ACTIVE'
                            ? 'text-[var(--color-shell-text)]'
                            : 'text-[var(--color-shell-text-subtle)]'
                        }`}
                      >
                        {hold.status === 'ACTIVE'
                          ? describeExpiry(hold.expires_at, serverNow)
                          : new Date(hold.expires_at).toLocaleTimeString('en-IN', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-[var(--color-shell-text-subtle)]">
                        held {new Date(hold.created_at).toLocaleString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={STATUS_VARIANT[hold.status] || 'outline'}
                        className="text-[10px]"
                      >
                        {hold.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
        CONVERTED means the money or reschedule landed and the booking owns the slot now.
        EXPIRED and RELEASED holds no longer subtract availability. This page never releases a
        hold itself — expiry is the cron sweep's job.
      </p>
    </div>
  );
};


