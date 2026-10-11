import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Users, Plus, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { apiFetch } from '@/src/lib/apiClient';
import { useNavigation } from '@/src/context/NavigationContext';
import { toUserMessage } from '@/src/lib/errorMessages';
import { usePaginatedQuery } from '@/src/hooks/usePaginatedQuery';

interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: 'SEEKER' | 'PENDING_MENTOR' | 'MENTOR' | 'ADMIN';
  timezone: string;
  createdAt: string;
  status: 'ACTIVE' | 'SUSPENDED';
  roles: string[];
  applicationStatus: string | null;
}

interface ApiUser {
  id: string;
  name: string;
  email: string;
  role: 'SEEKER' | 'PENDING_MENTOR' | 'MENTOR' | 'ADMIN';
  timezone: string;
  createdAt: string;
  status: 'ACTIVE' | 'SUSPENDED';
  roles: string[];
  applicationStatus: string | null;
}

export const AdminUsersPage: React.FC = () => {
  const { navigate } = useNavigation();
  const [roleFilter, setRoleFilter] = useState<'ALL' | 'SEEKER' | 'PENDING_MENTOR' | 'MENTOR' | 'ADMIN'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [viewState, setViewState] = useState<'table' | 'skeleton' | 'empty'>('table');

  const {
    data: users = [],
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    loadMore,
    refetch,
  } = usePaginatedQuery<UserRecord>({
    url: '/api/admin/users',
    pageSize: 6,
    enabled: true,
  });

  // `usePaginatedQuery` already performs the initial fetch inside its own
  // `useEffect` and exposes `refetch` for manual refresh. Wrapping that in a
  // second `useEffect([fetchUsers])` here created an infinite loop: the hook
  // rebuilt `fetchUsers` on every render, the wrapper fired again, the page
  // re-rendered, and the request repeated until the shared API rate limit
  // rejected the admin with 429. The loading state never settled because the
  // request never stopped firing. `refetch` is the single entry point.
  const fetchUsers = refetch;

  const filteredUsers = useMemo(() => 
    users.filter((u) => {
      const matchesRole = roleFilter === 'ALL' || u.role === roleFilter;
      const matchesSearch =
        u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.email.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesRole && matchesSearch;
    }),
  [users, roleFilter, searchTerm]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[var(--color-shell-border)] pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-shell-text)] sm:text-3xl">
            User Management
          </h1>
          <p className="mt-1 text-xs text-[var(--color-shell-text-muted)]">
            Authoritative directory of registered Seekers, Mentors, and Administrators.
          </p>
        </div>

        {/* State Toggle for Review */}
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            onClick={() => navigate('/admin/users/create')}
            className="text-xs gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add User</span>
          </Button>

        </div>
      </div>

      {/* Operational Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-3 text-xs">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="font-semibold text-[var(--color-shell-text)]">Filter Role:</span>
          {(['ALL', 'SEEKER', 'PENDING_MENTOR', 'MENTOR', 'ADMIN'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRoleFilter(r)}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                roleFilter === r
                  ? 'bg-[var(--color-shell-text)] text-[var(--color-shell-text-contrast)]'
                  : 'bg-[var(--color-shell-bg-hover)] hover:bg-[var(--color-shell-border)] text-[var(--color-shell-text)]'
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        <div className="w-full sm:w-64">
          <input
            type="text"
            placeholder="Search by name or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-md border border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] px-3 py-1.5 text-xs text-[var(--color-shell-text)] focus:border-[var(--color-shell-text)] focus:outline-hidden"
          />
        </div>
      </div>

      {viewState === 'empty' && (
        <EmptyState
          icon={Users}
          title="No Users Found"
          description="No user records match the selected filter criteria."
          actionLabel="Reset Filters"
          onAction={() => {
            setRoleFilter('ALL');
            setSearchTerm('');
          }}
        />
      )}

      {viewState === 'skeleton' && (
        <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-4 space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center justify-between py-2 border-b border-[var(--color-shell-border)]">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-6 w-16" />
            </div>
          ))}
        </div>
      )}

      {viewState === 'table' && (
        <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] overflow-hidden shadow-xs">
          {isLoading ? (
            <div className="p-8 text-center">
              <Loader2 className="h-8 w-8 text-[var(--color-shell-text-subtle)] mx-auto animate-spin" />
              <p className="mt-2 text-xs text-[var(--color-shell-text-muted)]">Loading users...</p>
            </div>
          ) : error ? (
            <div className="p-6 text-center">
              <p className="text-xs text-[var(--color-shell-text-muted)]">
                {toUserMessage(error, 'We could not load the user directory. Please try again.')}
              </p>
              <p className="mt-1 text-[11px] text-[var(--color-shell-text-subtle)]">
                {error instanceof Error && error.name === 'RateLimitError'
                  ? 'Requests are paused. Wait for the banner to clear, then press Retry.'
                  : 'If this keeps happening, check the System Health page.'}
              </p>
              <Button variant="outline" size="sm" onClick={fetchUsers} className="mt-2">
                Retry
              </Button>
            </div>
          ) : filteredUsers.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No Users Found"
              description="No user records match the selected filter criteria."
              actionLabel="Reset Filters"
              onAction={() => {
                setRoleFilter('ALL');
                setSearchTerm('');
              }}
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-[var(--color-shell-text-muted)]">
                  <thead className="bg-[var(--color-shell-bg-hover)]/70 border-b border-[var(--color-shell-border)] text-[var(--color-shell-text)] font-semibold uppercase tracking-wider text-[11px]">
                    <tr>
                      <th className="py-3 px-4">User</th>
                      <th className="py-3 px-4">Role</th>
                      <th className="py-3 px-4">Timezone</th>
                      <th className="py-3 px-4">Registered</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-shell-border)]">
                    {filteredUsers.map((user) => (
                      <tr key={user.id} className="hover:bg-[var(--color-shell-bg-hover)]/50 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-bold text-[var(--color-shell-text)]">{user.name}</div>
                          <div className="text-[11px] text-[var(--color-shell-text-subtle)] font-mono">{user.email}</div>
                        </td>
                        <td className="py-3 px-4">
                          <Badge
                            variant={
                              user.role === 'ADMIN'
                                ? 'destructive'
                                : user.role === 'MENTOR'
                                ? 'warning'
                                : 'secondary'
                            }
                            className="text-[10px]"
                          >
                            {user.role}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] text-[var(--color-shell-text-muted)]">
                          {user.timezone}
                        </td>
                        <td className="py-3 px-4 text-[var(--color-shell-text-muted)]">{user.createdAt}</td>
                        <td className="py-3 px-4">
                          <span className="inline-flex items-center gap-1 font-semibold text-[var(--color-shell-success)]">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {user.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => navigate(`/admin/users/${user.id}`)}
                            className="text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)] font-medium underline"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {hasMore && !isLoadingMore && (
                <div className="flex justify-center p-4 border-t border-[var(--color-shell-border)]">
                  <Button
                    onClick={loadMore}
                    variant="outline"
                    size="lg"
                    className="min-w-[200px]"
                    aria-label="Load more users"
                  >
                    Load more users
                  </Button>
                </div>
              )}
              {isLoadingMore && (
                <div className="flex justify-center p-4 border-t border-[var(--color-shell-border)]">
                  <Button
                    variant="outline"
                    size="lg"
                    className="min-w-[200px]"
                    disabled
                  >
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    Loading...
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};