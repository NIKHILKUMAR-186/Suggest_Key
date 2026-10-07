import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Briefcase, Loader2, Pause, Play, Search, X } from 'lucide-react';

import { Badge } from '@/src/components/ui/Badge';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { apiFetch } from '@/src/lib/apiClient';
import { toUserMessage } from '@/src/lib/errorMessages';
import { formatInr } from '@/src/lib/seekerFormat';

/**
 * Platform-wide gig ledger.
 *
 * Read + pause/resume only. Title, price, duration and topics keep their own
 * audited endpoints on the mentor and segment surfaces, and no price,
 * duration or eligibility rule is decided in this browser. What this page owns
 * is the operator question "what is live, who owns it, and in which segment" —
 * answered by GET /api/admin/gigs, which joins mentor, segment and topic names
 * server-side over a bounded result set — plus the one safe state transition:
 * PATCH /api/admin/gigs/:id/toggle-active, which enforces the one-active-gig
 * per mentor per segment invariant (409 on conflict) and audits every flip.
 */

type ActiveFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

const FILTERS: Array<{ key: ActiveFilter; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'INACTIVE', label: 'Paused' },
];

interface AdminGigRow {
  id: string;
  title: string;
  description: string | null;
  duration_minutes: number;
  price_inr: number;
  original_price_inr: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  mentor_id: string;
  segment_id: string | null;
  topics: string[];
  mentor: { id: string; full_name: string | null; email: string | null } | null;
  segment: { id: string; name: string; slug: string } | null;
}

export const AdminGigsPage: React.FC = () => {
  const [gigs, setGigs] = useState<AdminGigRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ActiveFilter>('ALL');
  const [searchInput, setSearchInput] = useState('');
  // Applied on submit so typing does not fire a request per keystroke; the
  // server owns the text search (client-side filtering would disagree with
  // the `count` the endpoint reports).
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<AdminGigRow | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (filter === 'ACTIVE') params.set('active', 'true');
      if (filter === 'INACTIVE') params.set('active', 'false');
      const qs = params.toString();
      const res = await apiFetch(`/api/admin/gigs${qs ? `?${qs}` : ''}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error?.message || 'Failed to load gigs');
      setGigs(data.gigs || []);
    } catch (err) {
      setError(toUserMessage(err, 'Failed to load gigs'));
    } finally {
      setLoading(false);
    }
  }, [filter, query]);

  useEffect(() => {
    void load();
  }, [load]);

  // Pause/resume is the one safe transition: the server enforces the
  // one-active-gig invariant (409 when the mentor already has a live gig in
  // the segment) and audits the flip. The ledger reloads so the badge, the
  // counts and the drawer can never disagree.
  const toggleActive = async (gig: AdminGigRow) => {
    setBusyId(gig.id);
    setActionError(null);
    try {
      const res = await apiFetch(`/api/admin/gigs/${gig.id}/toggle-active`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !gig.is_active }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error?.message || 'Failed to update gig');
      setSelected((prev) => (prev?.id === gig.id ? { ...gig, is_active: !gig.is_active } : prev));
      await load();
    } catch (err) {
      setActionError(toUserMessage(err, 'Failed to update gig'));
    } finally {
      setBusyId(null);
    }
  };

  const counts = useMemo(
    () => ({
      ALL: gigs.length,
      ACTIVE: gigs.filter((g) => g.is_active).length,
      INACTIVE: gigs.filter((g) => !g.is_active).length,
    }),
    [gigs],
  );

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setQuery(searchInput);
  };

  const stamp = (value: string): string =>
    new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-[var(--color-shell-border)] pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-shell-text)] sm:text-3xl">
            Gigs
          </h1>
          <p className="mt-1 text-xs text-[var(--color-shell-text-muted)]">
            Every session offer on the platform, who owns it and where it is listed. Read-only —
            edits happen on the mentor and segment surfaces, each with its own audit trail.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start">
          <form onSubmit={submitSearch} className="flex items-center gap-2">
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search title, mentor, segment…"
              className="h-9 w-56 text-xs"
              aria-label="Search gigs"
            />
            <Button type="submit" size="sm" variant="outline" className="h-9">
              <Search className="h-3.5 w-3.5" />
              <span>Search</span>
            </Button>
          </form>

          <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-[var(--color-shell-bg)] p-1 text-xs">
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
                <span className="ml-1.5 opacity-60">{counts[option.key]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-[var(--color-shell-error)]/35 bg-[var(--color-shell-error-soft)] px-4 py-3 text-xs text-[var(--color-shell-error)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {actionError && (
        <div className="flex items-start gap-2 rounded-xl border border-[var(--color-shell-error)]/35 bg-[var(--color-shell-error-soft)] px-4 py-3 text-xs text-[var(--color-shell-error)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{actionError}</span>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)]">
        {loading ? (
          <div className="p-8 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-[var(--color-shell-text-subtle)]" />
            <p className="mt-2 text-xs text-[var(--color-shell-text-muted)]">Loading gigs…</p>
          </div>
        ) : gigs.length === 0 ? (
          <EmptyState
            icon={Briefcase}
            title="No gigs found"
            description={
              query || filter !== 'ALL'
                ? 'No gigs match this search. Clear the filters to see the full ledger.'
                : 'Gigs are created by mentors on their workspace, or by an admin on a mentor detail page.'
            }
          />
        ) : (
          <div className="table-scroll">
            <table className="w-full text-left text-xs text-[var(--color-shell-text-muted)]">
              <thead className="border-b border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] text-[11px] font-semibold uppercase tracking-wider text-[var(--color-shell-text)]">
                <tr>
                  <th className="px-4 py-3">Gig</th>
                  <th className="px-4 py-3">Mentor</th>
                  <th className="px-4 py-3">Segment</th>
                  <th className="px-4 py-3">Price</th>
                  <th className="px-4 py-3">Duration</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-shell-border)]">
                {gigs.map((gig) => (
                  <tr
                    key={gig.id}
                    onClick={() => { setSelected(gig); setActionError(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(gig); setActionError(null); } }}
                    tabIndex={0}
                    className="cursor-pointer transition-colors hover:bg-[var(--color-shell-bg)] focus-visible:outline-2 focus-visible:outline-[var(--color-shell-accent)]"
                  >
                    <td className="px-4 py-3">
                      <span className="block font-semibold text-[var(--color-shell-text)]">
                        {gig.title}
                      </span>
                      <span className="mt-0.5 block font-mono text-[10px] text-[var(--color-shell-text-subtle)]">
                        {gig.id.slice(0, 8)}…
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="block text-[var(--color-shell-text)]">
                        {gig.mentor?.full_name || 'Unknown mentor'}
                      </span>
                      {gig.mentor?.email && (
                        <span className="mt-0.5 block text-[11px] text-[var(--color-shell-text-subtle)]">
                          {gig.mentor.email}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">{gig.segment?.name || 'Unassigned'}</td>
                    <td className="px-4 py-3 font-semibold text-[var(--color-shell-text)]">
                      {formatInr(gig.price_inr)}
                    </td>
                    <td className="px-4 py-3">{gig.duration_minutes} min</td>
                    <td className="px-4 py-3">
                      <Badge variant={gig.is_active ? 'success' : 'secondary'} className="text-[10px]">
                        {gig.is_active ? 'ACTIVE' : 'PAUSED'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right text-[11px] text-[var(--color-shell-text-subtle)]">
                      {stamp(gig.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
        Select a row for the full record — description, topics, timestamps, and pause/resume. A
        paused gig stops appearing to seekers immediately, but keeps every booking and workspace
        it already produced. Nothing here is ever deleted.
      </p>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          onClick={() => setSelected(null)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Gig: ${selected.title}`}
            className="w-full max-w-lg space-y-4 rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-bold text-[var(--color-shell-text)]">{selected.title}</h2>
                <p className="mt-0.5 font-mono text-[10px] text-[var(--color-shell-text-subtle)]">{selected.id}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={selected.is_active ? 'success' : 'secondary'} className="text-[10px]">
                  {selected.is_active ? 'ACTIVE' : 'PAUSED'}
                </Badge>
                <Button size="sm" variant="outline" onClick={() => setSelected(null)} aria-label="Close gig details">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {selected.description && (
              <p className="text-xs leading-relaxed text-[var(--color-shell-text-muted)]">{selected.description}</p>
            )}

            <dl className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-shell-text-subtle)]">Mentor</dt>
                <dd className="mt-0.5 text-[var(--color-shell-text)]">{selected.mentor?.full_name || 'Unknown mentor'}</dd>
                {selected.mentor?.email && <dd className="text-[11px] text-[var(--color-shell-text-subtle)]">{selected.mentor.email}</dd>}
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-shell-text-subtle)]">Segment</dt>
                <dd className="mt-0.5 text-[var(--color-shell-text)]">{selected.segment?.name || 'Unassigned'}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-shell-text-subtle)]">Price</dt>
                <dd className="mt-0.5 font-semibold text-[var(--color-shell-text)]">{formatInr(selected.price_inr)}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-shell-text-subtle)]">Duration</dt>
                <dd className="mt-0.5 text-[var(--color-shell-text)]">{selected.duration_minutes} min</dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-shell-text-subtle)]">Created</dt>
                <dd className="mt-0.5 text-[var(--color-shell-text)]">{stamp(selected.created_at)}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-shell-text-subtle)]">Updated</dt>
                <dd className="mt-0.5 text-[var(--color-shell-text)]">{stamp(selected.updated_at)}</dd>
              </div>
            </dl>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-shell-text-subtle)]">Topic tags</p>
              {(selected.topics ?? []).length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {(selected.topics ?? []).map((topic) => (
                    <Badge key={topic} variant="outline" className="text-[10px]">{topic}</Badge>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-[11px] text-[var(--color-shell-text-subtle)]">No topics attached.</p>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-[var(--color-shell-border)] pt-4">
              <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
                {selected.is_active ? 'Pausing hides it from seekers at once.' : 'Resuming is refused when the mentor already has a live gig here.'}
              </p>
              <Button
                size="sm"
                variant={selected.is_active ? 'outline' : 'default'}
                disabled={busyId === selected.id}
                onClick={() => void toggleActive(selected)}
              >
                {busyId === selected.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : selected.is_active ? (
                  <Pause className="h-3.5 w-3.5" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                <span>{selected.is_active ? 'Pause' : 'Resume'}</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


