import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, Loader2 } from 'lucide-react';

import { Badge } from '@/src/components/ui/Badge';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { apiFetch } from '@/src/lib/apiClient';
import { toUserMessage } from '@/src/lib/errorMessages';

/**
 * The reschedule request queue, platform-wide.
 *
 * The participant reader answers one booking at a time; an operator needs the
 * whole queue — what is PENDING, what expired unanswered, who rejected what.
 * Decisions stay with the mentor through the audited RPC: this page reads, and
 * only reads. Status comes straight from `reschedule_requests.status`, so the
 * queue here can never disagree with what the seeker or mentor sees.
 */

type RescheduleFilter = 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';

const FILTERS: Array<{ key: RescheduleFilter; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'EXPIRED', label: 'Expired' },
  { key: 'CANCELLED', label: 'Cancelled' },
];

const STATUS_VARIANT: Record<RescheduleFilter, 'success' | 'warning' | 'secondary' | 'outline' | 'destructive'> = {
  ALL: 'outline',
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'destructive',
  EXPIRED: 'secondary',
  CANCELLED: 'outline',
};

interface AdminRescheduleRow {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';
  original_start_time: string;
  original_end_time: string;
  requested_start_time: string;
  requested_end_time: string;
  rejection_reason: string | null;
  seeker_requested_at: string;
  mentor_responded_at: string | null;
  expires_at: string;
  created_at: string;
  seeker: { id: string; full_name: string | null } | null;
  mentor: { id: string; full_name: string | null } | null;
  booking: { id: string; booking_code: string; start_time: string; end_time: string; status: string } | null;
}

const formatSlot = (value: string): string =>
  new Date(value).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export const AdminReschedulesPage: React.FC = () => {
  const [requests, setRequests] = useState<AdminRescheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RescheduleFilter>('ALL');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = filter === 'ALL' ? '' : `?status=${encodeURIComponent(filter)}`;
      const res = await apiFetch(`/api/admin/reschedules${qs}`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || 'Failed to load reschedule requests');
      }
      setRequests(data.requests || []);
    } catch (err) {
      setError(toUserMessage(err, 'Failed to load reschedule requests'));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-[var(--color-shell-border)] pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-shell-text)] sm:text-3xl">
            Reschedules
          </h1>
          <p className="mt-1 text-xs text-[var(--color-shell-text-muted)]">
            Every seeker request to move a session: what is waiting on the mentor, what expired
            unanswered, who rejected what. Read-only — decisions are the mentor's, made through the
            audited flow.
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
            <p className="mt-2 text-xs text-[var(--color-shell-text-muted)]">
              Loading reschedule requests…
            </p>
          </div>
        ) : requests.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title={filter === 'ALL' ? 'No reschedule requests' : `No ${filter.toLowerCase()} requests`}
            description={
              filter === 'ALL' || filter === 'PENDING'
                ? 'A request appears here the moment a seeker asks to move a confirmed session. While it is PENDING the original time stays booked.'
                : 'No request has reached this state in the recent window.'
            }
          />
        ) : (
          <div className="table-scroll">
            <table className="w-full text-left text-xs text-[var(--color-shell-text-muted)]">
              <thead className="border-b border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] text-[11px] font-semibold uppercase tracking-wider text-[var(--color-shell-text)]">
                <tr>
                  <th className="px-4 py-3">Booking</th>
                  <th className="px-4 py-3">Original → Requested</th>
                  <th className="px-4 py-3">Seeker</th>
                  <th className="px-4 py-3">Mentor</th>
                  <th className="px-4 py-3">Decision window</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-shell-border)]">
                {requests.map((req) => (
                  <tr key={req.id} className="transition-colors hover:bg-[var(--color-shell-bg)]">
                    <td className="px-4 py-3">
                      <span className="block font-mono font-bold text-[var(--color-shell-text)]">
                        {req.booking?.booking_code || '—'}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-[var(--color-shell-text-subtle)]">
                        requested {formatSlot(req.seeker_requested_at)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="block text-[11px] text-[var(--color-shell-text-subtle)] line-through">
                        {formatSlot(req.original_start_time)}
                      </span>
                      <span className="mt-0.5 block font-semibold text-[var(--color-shell-text)]">
                        {formatSlot(req.requested_start_time)}
                      </span>
                    </td>
                    <td className="px-4 py-3">{req.seeker?.full_name || 'Unknown'}</td>
                    <td className="px-4 py-3">{req.mentor?.full_name || 'Unknown'}</td>
                    <td className="px-4 py-3 text-[11px]">
                      {req.status === 'PENDING' ? (
                        <span className="font-semibold text-[var(--color-shell-text)]">
                          Expires {formatSlot(req.expires_at)}
                        </span>
                      ) : req.mentor_responded_at ? (
                        <span className="text-[var(--color-shell-text-subtle)]">
                          Decided {formatSlot(req.mentor_responded_at)}
                          {req.rejection_reason && (
                            <span className="mt-0.5 block max-w-[200px] truncate" title={req.rejection_reason}>
                              “{req.rejection_reason}”
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-[var(--color-shell-text-subtle)]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={STATUS_VARIANT[req.status] || 'outline'}
                        className="text-[10px]"
                      >
                        {req.status}
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
        While a request is PENDING the original time stays booked and the requested slot is held
        for the mentor. EXPIRED means the mentor never answered and the hold was released — the
        session keeps its original time.
      </p>
    </div>
  );
};


