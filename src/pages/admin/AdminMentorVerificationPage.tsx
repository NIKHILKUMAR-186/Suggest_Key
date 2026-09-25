import React, { useCallback, useEffect, useState } from 'react';
import { Clock, Search, AlertTriangle, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { apiFetch, getLastResponseRequestId } from '@/src/lib/apiClient';
import { useNavigation } from '@/src/context/NavigationContext';
import { DEFAULT_MENTOR_APPLICATION_PAGE_SIZE } from '@/src/lib/mentorApplicationsQuery';
import type {
  AdminMentorApplicationsResponse,
  MentorApplicationPaginationPayload,
  MentorApplicationQueueItem,
  MentorApplicationStatus,
  MentorApplicationStatusCountsPayload,
} from '@/src/types/database';

type StatusFilter = 'ALL' | MentorApplicationStatus;

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending_review', label: 'Pending Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

const EMPTY_COUNTS: MentorApplicationStatusCountsPayload = {
  all: 0,
  draft: 0,
  pending_review: 0,
  approved: 0,
  rejected: 0,
};

const EMPTY_PAGINATION: MentorApplicationPaginationPayload = {
  page: 1,
  pageSize: DEFAULT_MENTOR_APPLICATION_PAGE_SIZE,
  total: 0,
  totalPages: 1,
  hasPrevious: false,
  hasNext: false,
};

/** Debounce window (ms) applied to the search box before hitting the API. */
const SEARCH_DEBOUNCE_MS = 350;

const getStatusBadgeVariant = (status: MentorApplicationStatus) => {
  switch (status) {
    case 'approved':
      return 'success';
    case 'pending_review':
      return 'warning';
    case 'rejected':
      return 'destructive';
    case 'draft':
    default:
      return 'secondary';
  }
};

const formatStatusLabel = (status: MentorApplicationStatus) =>
  status.replace('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

const formatDate = (value: string | null): string => {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

interface LoadErrorState {
  message: string;
  requestId: string | null;
}

export const AdminMentorVerificationPage: React.FC = () => {
  const { navigate } = useNavigation();

  const [applications, setApplications] = useState<MentorApplicationQueueItem[]>([]);
  const [counts, setCounts] = useState<MentorApplicationStatusCountsPayload>(EMPTY_COUNTS);
  const [pagination, setPagination] = useState<MentorApplicationPaginationPayload>(EMPTY_PAGINATION);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoadErrorState | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);

  /**
   * Explicit reload trigger: only the Retry button increments it, so Retry is an
   * intentional, user driven action. A failing request can never re-trigger
   * itself because the fetch effect only depends on primitive values.
   */
  const [reloadToken, setReloadToken] = useState(0);

  // Debounced server-side search: the query is applied after the user pauses.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(handle);
  }, [searchInput]);

  const fetchApplications = useCallback(
    async (signal: AbortSignal): Promise<void> => {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (searchQuery) params.set('search', searchQuery);
      params.set('page', String(page));
      params.set('pageSize', String(DEFAULT_MENTOR_APPLICATION_PAGE_SIZE));

      const res = await apiFetch(`/api/admin/mentor-applications?${params.toString()}`, { signal });
      const data = (await res.json()) as Partial<AdminMentorApplicationsResponse> & {
        error?: { message?: string };
      };

      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || 'Unable to load mentor applications.');
      }

      setApplications(data.applications ?? []);
      setCounts(data.counts ?? EMPTY_COUNTS);
      setPagination(data.pagination ?? EMPTY_PAGINATION);
    },
    [page, searchQuery, statusFilter],
  );

  useEffect(() => {
    const controller = new AbortController();
    let isActive = true;

    setLoading(true);
    setError(null);

    fetchApplications(controller.signal)
      .catch((err: unknown) => {
        if (!isActive) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;

        // The API never returns database internals, so the UI fails generically.
        // The request id lets an admin locate the diagnostic entry in
        // Admin -> System Health.
        console.error('Failed to fetch mentor applications:', err);
        setApplications([]);
        setCounts(EMPTY_COUNTS);
        setPagination(EMPTY_PAGINATION);
        setError({ message: 'Unable to load mentor applications.', requestId: getLastResponseRequestId() });
      })
      .finally(() => {
        if (isActive) setLoading(false);
      });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [fetchApplications, reloadToken]);

  const handleRetry = () => {
    setReloadToken((token) => token + 1);
  };

  const handleStatusFilterChange = (nextFilter: StatusFilter) => {
    setStatusFilter(nextFilter);
    setPage(1);
  };

  const handleClearFilters = () => {
    setStatusFilter('ALL');
    setSearchInput('');
    setSearchQuery('');
    setPage(1);
  };

  const getCount = (filter: StatusFilter): number => (filter === 'ALL' ? counts.all : counts[filter]);

  const firstRowNumber = applications.length === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const lastRowNumber = applications.length === 0 ? 0 : firstRowNumber + applications.length - 1;
  const hasActiveFilters = statusFilter !== 'ALL' || searchQuery.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[var(--color-shell-border)] pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-shell-text)] sm:text-3xl">
            Mentor Verification
          </h1>
          <p className="mt-1 text-sm text-[var(--color-shell-text-muted)]">
            Review mentor applications and verification documents. Only approved mentors appear in seeker searches.
          </p>
        </div>
        {counts.pending_review > 0 && (
          <Badge variant="warning" className="text-xs">
            {counts.pending_review} pending
          </Badge>
        )}
      </div>

      {/* Filters (server-side status + search) */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-3 text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-[var(--color-shell-text-muted)]">Status:</span>
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              onClick={() => handleStatusFilterChange(filter.value)}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                statusFilter === filter.value
                  ? 'bg-[var(--color-shell-primary)] text-[var(--color-shell-text-contrast)]'
                  : 'text-[var(--color-shell-text-muted)] hover:bg-[var(--color-shell-surface-elevated)]'
              }`}
            >
              {filter.label} ({getCount(filter.value)})
            </button>
          ))}
        </div>

        <div className="w-full sm:w-72">
          <div className="relative">
            <Search className="absolute top-1.5 left-2.5 h-3.5 w-3.5 text-[var(--color-shell-text-subtle)]" />
            <input
              type="text"
              placeholder="Search by name or email..."
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              className="w-full rounded-md border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] pl-8 pr-3 py-1.5 text-xs text-[var(--color-shell-text)] focus:border-[var(--color-shell-accent)] focus:outline-none"
            />
          </div>
          <p className="mt-1 text-[10px] text-[var(--color-shell-text-subtle)]">
            Search matches applicant name or email in the database.
          </p>
        </div>
      </div>

      {/* Applications Table */}
      <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] overflow-hidden shadow-xs">
        {loading ? (
          <div className="p-8 text-center">
            <Loader2 className="h-8 w-8 text-[var(--color-shell-text-subtle)] mx-auto animate-spin" />
            <p className="mt-2 text-sm text-[var(--color-shell-text-subtle)]">Loading mentor applications...</p>
          </div>
        ) : error ? (
          <div className="p-6 text-center text-[var(--color-shell-error)]">
            <AlertTriangle className="h-6 w-6 mx-auto mb-2" />
            <p className="text-sm font-medium">{error.message}</p>
            {error.requestId && (
              <p className="mt-1 text-[10px] font-mono text-[var(--color-shell-text-subtle)]">
                Request ID: {error.requestId} (see Admin → System Health)
              </p>
            )}
            <Button variant="outline" size="sm" onClick={handleRetry} className="mt-3">
              Retry
            </Button>
          </div>
        ) : applications.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="No mentor applications found."
            description={
              hasActiveFilters
                ? 'No applications match the current status filter or search term.'
                : 'No mentor applications found in the database yet.'
            }
            actionLabel={hasActiveFilters ? 'Clear Filters' : undefined}
            onAction={hasActiveFilters ? handleClearFilters : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[var(--color-shell-text-muted)]">
              <thead className="bg-[var(--color-shell-surface-elevated)]/50 border-b border-[var(--color-shell-border-strong)] text-[var(--color-shell-text)] font-semibold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-4">Applicant</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Documents</th>
                  <th className="py-3 px-4">Submitted</th>
                  <th className="py-3 px-4">Last Updated</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-shell-border)]">
                {applications.map((application) => {
                  const approvedDocs = application.documents.filter((doc) => doc.status === 'approved').length;
                  const pendingDocs = application.documents.filter((doc) => doc.status === 'pending').length;
                  const rejectedDocs = application.documents.filter((doc) => doc.status === 'rejected').length;

                  return (
                    <tr key={application.id} className="hover:bg-[var(--color-shell-surface-elevated)]/30 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-[var(--color-shell-text)]">
                          {application.profile?.full_name || application.full_name}
                        </div>
                        <div className="text-[11px] text-[var(--color-shell-text-subtle)] font-mono">
                          {application.profile?.email || '—'}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={getStatusBadgeVariant(application.status)} className="text-[10px]">
                          {formatStatusLabel(application.status)}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2 text-[10px]">
                          <span className="text-[var(--color-shell-success)]">{approvedDocs} approved</span>
                          {pendingDocs > 0 && <span className="text-amber-600">{pendingDocs} pending</span>}
                          {rejectedDocs > 0 && (
                            <span className="text-[var(--color-shell-error)]">{rejectedDocs} rejected</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-[var(--color-shell-text-subtle)]">
                        {formatDate(application.submitted_at)}
                      </td>
                      <td className="py-3 px-4 text-[var(--color-shell-text-subtle)]">
                        {formatDate(application.updated_at)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs py-1 h-7"
                          onClick={() => navigate(`/admin/mentor-verification/${application.id}`)}
                        >
                          Review
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error && applications.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 border-t border-[var(--color-shell-border)] px-4 py-3 text-[11px] text-[var(--color-shell-text-muted)]">
            <span>
              Showing {firstRowNumber}–{lastRowNumber} of {pagination.total} applications
            </span>
            <div className="flex items-center gap-2">
              <span>
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 py-1 text-xs gap-1"
                disabled={!pagination.hasPrevious}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                <ChevronLeft className="h-3 w-3" />
                Prev
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 py-1 text-xs gap-1"
                disabled={!pagination.hasNext}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
                <ChevronRight className="h-3 w-3" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
