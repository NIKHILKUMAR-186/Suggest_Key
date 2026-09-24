import React, { useState, useEffect, useCallback } from 'react';
import { Users, Search, Filter, Shield, MoreVertical, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { apiFetch } from '@/src/lib/apiClient';

interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: 'SEEKER' | 'MENTOR' | 'ADMIN';
  timezone: string;
  createdAt: string;
  status: 'ACTIVE' | 'SUSPENDED';
  roles: string[];
}

interface ApiUser {
  id: string;
  name: string;
  email: string;
  role: 'SEEKER' | 'MENTOR' | 'ADMIN';
  timezone: string;
  createdAt: string;
  status: 'ACTIVE' | 'SUSPENDED';
  roles: string[];
}

export const AdminUsersPage: React.FC = () => {
  const [roleFilter, setRoleFilter] = useState<'ALL' | 'SEEKER' | 'MENTOR' | 'ADMIN'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [viewState, setViewState] = useState<'table' | 'skeleton' | 'empty'>('table');
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/admin/users');
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to fetch users');
      setUsers(data.users || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load users');
      console.error('Failed to fetch users:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const filteredUsers = users.filter((u) => {
    const matchesRole = roleFilter === 'ALL' || u.role === roleFilter;
    const matchesSearch =
      u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesRole && matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">
            User Management
          </h1>
          <p className="mt-1 text-xs text-zinc-500">
            Authoritative directory of registered Seekers, Mentors, and Administrators.
          </p>
        </div>

        {/* State Toggle for Review */}
        <div className="flex items-center gap-1 bg-zinc-100 p-1 rounded-lg self-start text-xs">
          {(['table', 'skeleton', 'empty'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setViewState(s)}
              className={`px-2.5 py-1 rounded-md capitalize font-medium ${
                viewState === s ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-600'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Operational Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-3 text-xs">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="font-semibold text-zinc-700">Filter Role:</span>
          {(['ALL', 'SEEKER', 'MENTOR', 'ADMIN'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRoleFilter(r)}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                roleFilter === r
                  ? 'bg-zinc-900 text-white'
                  : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-700'
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
            className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-900 focus:border-zinc-900 focus:outline-hidden"
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
        <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center justify-between py-2 border-b border-zinc-100">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-6 w-16" />
            </div>
          ))}
        </div>
      )}

      {viewState === 'table' && (
        <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden shadow-xs">
          {loading ? (
            <div className="p-8 text-center">
              <Loader2 className="h-8 w-8 text-zinc-400 mx-auto animate-spin" />
              <p className="mt-2 text-xs text-zinc-500">Loading users...</p>
            </div>
          ) : error ? (
            <div className="p-6 text-center text-rose-600">
              <p className="text-xs">{error}</p>
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
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-zinc-600">
                <thead className="bg-zinc-50/70 border-b border-zinc-200 text-zinc-900 font-semibold uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="py-3 px-4">User</th>
                    <th className="py-3 px-4">Role</th>
                    <th className="py-3 px-4">Timezone</th>
                    <th className="py-3 px-4">Registered</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {filteredUsers.map((user) => (
                    <tr key={user.id} className="hover:bg-zinc-50/50 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-bold text-zinc-950">{user.name}</div>
                        <div className="text-[11px] text-zinc-400 font-mono">{user.email}</div>
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
                      <td className="py-3 px-4 font-mono text-[11px] text-zinc-500">
                        {user.timezone}
                      </td>
                      <td className="py-3 px-4 text-zinc-500">{user.createdAt}</td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {user.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button className="text-zinc-500 hover:text-zinc-950 font-medium underline">
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};