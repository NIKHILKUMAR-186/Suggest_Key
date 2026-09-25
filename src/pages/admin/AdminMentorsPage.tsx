import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ShieldCheck, AlertTriangle, Loader2, Eye } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { apiFetch } from '@/src/lib/apiClient';
import { useNavigation } from '@/src/context/NavigationContext';
import {
  MENTOR_ACCOUNT_BADGE_LABELS,
  deriveMentorAccountState,
  mentorAccountBadge,
  type MentorAccountBadge,
} from '@/src/lib/adminMentorControl';

/**
 * Admin mentor directory.
 *
 * Every status shown here is derived from the values returned by
 * GET /api/admin/mentors, which reads them from the database. Nothing is
 * hardcoded and no status is assumed (prompt section 13).
 */

type FilterKey = 'ALL' | 'ACTIVE' | 'DEACTIVATED' | 'SUSPENDED' | 'PENDING';

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'DEACTIVATED', label: 'Deactivated' },
  { key: 'SUSPENDED', label: 'Suspended' },
  { key: 'PENDING', label: 'Pending Verification' },
];

const BADGE_VARIANT: Record<
  MentorAccountBadge,
  'success' | 'warning' | 'destructive' | 'secondary'
> = {
  active: 'success',
  deactivated: 'secondary',
  suspended: 'destructive',
  suspended_lapsed: 'warning',
  pending: 'warning',
};

interface ApiMentor {
  id: string;
  name: string;
  email: string;
  segmentName: string;
  status: 'APPROVED' | 'PENDING' | 'REJECTED';
  experienceYears: number;
  bio: string;
  appliedDate: string;
  isApproved: boolean;
  isActive: boolean;
  isSuspended: boolean;
  isDeactivated: boolean;
  isEligible: boolean;
  approvalStatus: string | null;
  accountStatus: string;
  suspendedUntil: string | null;
  suspensionReason: string | null;
}

export const AdminMentorsPage: React.FC = () => {
  const { navigate } = useNavigation();
  const [filter, setFilter] = useState<FilterKey>('ALL');
  const [mentors, setMentors] = useState<ApiMentor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMentors = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/admin/mentors');
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to fetch mentors');
      setMentors(data.mentors || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load mentors');
      console.error('Failed to fetch mentors:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMentors();
  }, [fetchMentors]);

  // Derive the badge from the stored columns, exactly as the detail page does.
  const rows = useMemo(
    () =>
      mentors.map((mentor) => {
        const state = deriveMentorAccountState({
          approval_status: mentor.approvalStatus,
          is_approved: mentor.isApproved,
          is_active: mentor.isActive,
          account_status: mentor.accountStatus,
          suspended_until: mentor.suspendedUntil,
        });
        return { mentor, state, badge: mentorAccountBadge(state) };
      }),
    [mentors],
  );

  const filtered = useMemo(
    () =>
      rows.filter(({ state }) => {
        if (filter === 'ALL') return true;
        if (filter === 'ACTIVE') return state.isEligible;
        if (filter === 'DEACTIVATED') return state.isDeactivated;
        if (filter === 'SUSPENDED') return state.isSuspended || state.isSuspensionLapsed;
        return !state.isApproved;
      }),
    [rows, filter],
  );

  const countFor = (key: FilterKey) =>
    rows.filter(({ state }) => {
      if (key === 'ALL') return true;
      if (key === 'ACTIVE') return state.isEligible;
      if (key === 'DEACTIVATED') return state.isDeactivated;
      if (key === 'SUSPENDED') return state.isSuspended || state.isSuspensionLapsed;
      return !state.isApproved;
    }).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-[var(--color-shell-border)] pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-shell-text)] sm:text-3xl">
            Mentors
          </h1>
          <p className="mt-1 text-xs text-[var(--color-shell-text-muted)]">
            Full operational control over every mentor. Activate, deactivate, suspend or reactivate
            at any time — no account ever needs to be recreated.
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
              <span className="ml-1.5 opacity-60">{countFor(option.key)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Mentor table */}
      <div className="overflow-hidden rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)]">
        {loading ? (
          <div className="p-8 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-[var(--color-shell-text-subtle)]" />
            <p className="mt-2 text-xs text-[var(--color-shell-text-muted)]">Loading mentors…</p>
          </div>
        ) : error ? (
          <div className="p-6 text-center text-[var(--color-shell-error)]">
            <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
            <p className="text-xs">{error}</p>
            <Button variant="outline" size="sm" onClick={fetchMentors} className="mt-2">
              Retry
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No mentors found"
            description={
              filter === 'ALL'
                ? 'No mentor records found in the system.'
                : `No mentors match the "${FILTERS.find((f) => f.key === filter)?.label}" filter.`
            }
          />
        ) : (
          <table className="w-full text-left text-xs text-[var(--color-shell-text-muted)]">
            <thead className="border-b border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] text-[11px] font-semibold uppercase tracking-wider text-[var(--color-shell-text)]">
              <tr>
                <th className="px-4 py-3">Mentor</th>
                <th className="px-4 py-3">Segment</th>
                <th className="px-4 py-3">Experience</th>
                <th className="px-4 py-3">Account</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-shell-border)]">
              {filtered.map(({ mentor, state, badge }) => (
                <tr key={mentor.id} className="transition-colors hover:bg-[var(--color-shell-bg)]">
                  <td className="px-4 py-3">
                    <span className="block font-bold text-[var(--color-shell-text)]">{mentor.name}</span>
                    <span className="font-mono text-[11px] text-[var(--color-shell-text-subtle)]">{mentor.email}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="secondary" className="text-[10px]">{mentor.segmentName}</Badge>
                  </td>
                  <td className="px-4 py-3">{mentor.experienceYears} yrs</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={BADGE_VARIANT[badge]} className="text-[10px]">
                        {MENTOR_ACCOUNT_BADGE_LABELS[badge]}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {state.isEligible ? 'Discoverable' : 'Not discoverable'}
                      </Badge>
                    </div>
                    {state.isSuspended && mentor.suspensionReason && (
                      <p className="mt-1 max-w-[220px] truncate text-[10px] text-[var(--color-shell-text-subtle)]">
                        {mentor.suspensionReason}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1.5 py-1 text-xs"
                      onClick={() => navigate(`/admin/mentors/${mentor.id}`)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span>View Details</span>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
        Mentors created by an Admin are approved and active immediately. Public mentor signups stay
        in the verification queue until an Admin approves them.
      </p>
    </div>
  );
};


