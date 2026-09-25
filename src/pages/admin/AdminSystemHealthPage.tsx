import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  Server,
  Clock,
  AlertTriangle,
  AlertCircle,
  CheckCircle,
  Database,
  Shield,
  FileText,
  Search,
  Filter,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  User,
} from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/src/components/ui/Card';
import { Skeleton, SkeletonText } from '@/src/components/ui/Skeleton';
import { Modal } from '@/src/components/ui/Modal';
import { apiFetch } from '@/src/lib/apiClient';
import type { SystemLog, AuditLog, SystemHealthMetrics, ErrorGroup } from '@/src/types/systemLogs';

type TabId = 'overview' | 'requests' | 'errors' | 'auth' | 'audit';

interface MetricsResponse {
  success: boolean;
  metrics: SystemHealthMetrics;
}

interface LogsResponse {
  success: boolean;
  logs: SystemLog[];
}

interface ErrorsResponse {
  success: boolean;
  errors: SystemLog[];
}

interface AuthLogsResponse {
  success: boolean;
  logs: SystemLog[];
}

interface AuditLogsResponse {
  success: boolean;
  logs: AuditLog[];
}

interface RequestDetailResponse {
  success: boolean;
  logs: SystemLog[];
  auth_log: SystemLog[];
  audit_log: AuditLog[];
}

const TAB_CONFIG: Array<{ id: TabId; label: string; icon: React.ElementType }> = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'requests', label: 'API Requests', icon: FileText },
  { id: 'errors', label: 'Errors', icon: AlertTriangle },
  { id: 'auth', label: 'Auth Logs', icon: Shield },
  { id: 'audit', label: 'Audit Logs', icon: Database },
];

const STATUS_COLORS: Record<string, string> = {
  info: 'bg-blue-100 text-blue-800 border-blue-200',
  warn: 'bg-amber-100 text-amber-800 border-amber-200',
  error: 'bg-rose-100 text-rose-800 border-rose-200',
  debug: 'bg-slate-100 text-slate-800 border-slate-200',
};

function StatusBadge({ level }: { level: SystemLog['level'] }) {
  const label = level?.toUpperCase() || 'INFO';
  const colorClass = STATUS_COLORS[level] || STATUS_COLORS.info;
  return (
    <Badge className={colorClass}>{label}</Badge>
  );
}

function CodeBadge({ code }: { code: string | null }) {
  if (!code) return <span className="text-[var(--color-shell-text-subtle)] text-xs">—</span>;
  return (
    <code className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-text)]">
      {code}
    </code>
  );
}

function formatDuration(ms: number | null) {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTimestamp(ts: string) {
  try {
    return new Date(ts).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  } catch {
    return ts;
  }
}

function getRoleBadge(role: string | null) {
  if (!role) return null;
  const roleUpper = role.toUpperCase();
  const variant = role === 'admin' ? 'destructive' : role === 'mentor' ? 'warning' : 'default';
  return <Badge variant={variant} className="text-[9px]">{roleUpper}</Badge>;
}

interface LogRowProps {
  log: SystemLog;
  onClick?: () => void;
}

const LogRow: React.FC<LogRowProps> = ({ log, onClick }) => {
  const handleClick = onClick || (log.request_id ? () => {} : undefined);
  return (
    <div
      className="grid grid-cols-12 gap-2 items-center py-2.5 px-3 border-b border-[var(--color-shell-border)] hover:bg-[var(--color-shell-surface-elevated)]/50 text-xs cursor-pointer transition-colors"
      onClick={handleClick}
    >
      <div className="col-span-3 font-mono text-[var(--color-shell-text-subtle)] truncate">
        {log.request_id}
      </div>
      <div className="col-span-1">
        <StatusBadge level={log.level} />
      </div>
      <div className="col-span-2 truncate" title={log.path || ''}>
        {log.path ? <code className="text-[var(--color-shell-text-subtle)]">{log.path}</code> : '—'}
      </div>
      <div className="col-span-1 text-center">
        <Badge
          variant={log.status_code && log.status_code >= 500 ? 'destructive' : log.status_code && log.status_code >= 400 ? 'warning' : 'success'}
          className="text-[9px] w-10 h-5 justify-center"
        >
          {log.status_code || '—'}
        </Badge>
      </div>
      <div className="col-span-1 text-center text-[var(--color-shell-text-subtle)]">
        {formatDuration(log.duration_ms)}
      </div>
      <div className="col-span-2 truncate" title={log.message || ''}>
        {log.message || <span className="text-[var(--color-shell-text-subtle)]">—</span>}
      </div>
      <div className="col-span-1 text-right text-[var(--color-shell-text-subtle)]">
        {formatTimestamp(log.created_at)}
      </div>
    </div>
  );
};

interface AuditLogRowProps {
  log: AuditLog;
  onClick?: () => void;
}

const AuditLogRow: React.FC<AuditLogRowProps> = ({ log, onClick }) => {
  const handleClick = onClick || (log.request_id ? () => {} : undefined);
  return (
    <div
      className="grid grid-cols-12 gap-2 items-center py-2.5 px-3 border-b border-[var(--color-shell-border)] hover:bg-[var(--color-shell-surface-elevated)]/50 text-xs cursor-pointer transition-colors"
      onClick={handleClick}
    >
      <div className="col-span-2 font-mono text-[var(--color-shell-text-subtle)] truncate">
        {formatTimestamp(log.created_at)}
      </div>
      <div className="col-span-2 truncate font-medium text-[var(--color-shell-text)]">
        {log.action}
      </div>
      <div className="col-span-1 text-[var(--color-shell-text-subtle)]">
        {log.actor_role ? log.actor_role : '—'}
      </div>
      <div className="col-span-2 font-mono text-[var(--color-shell-text-subtle)] truncate">
        {log.request_id || '—'}
      </div>
      <div className="col-span-2 truncate" title={log.entity_type || ''}>
        <Badge variant="secondary" className="text-[9px]">
          {log.entity_type || 'system'}
        </Badge>
      </div>
      <div className="col-span-3 text-[var(--color-shell-text-subtle)] truncate">
        {log.entity_id || '—'}
      </div>
    </div>
  );
};

export const AdminSystemHealthPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [metrics, setMetrics] = useState<SystemHealthMetrics | null>(null);
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [errors, setErrors] = useState<SystemLog[]>([]);
  const [authLogs, setAuthLogs] = useState<SystemLog[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [requestDetail, setRequestDetail] = useState<RequestDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [retention, setRetention] = useState<{ retention_days: number; updated_at: string } | null>(null);
  const [retentionLoading, setRetentionLoading] = useState(false);
  const [retentionDaysInput, setRetentionDaysInput] = useState('');
  const [pruneLoading, setPruneLoading] = useState(false);
  const [pruneResult, setPruneResult] = useState<number | null>(null);

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [metricsRes, logsRes, errorsRes, authRes, auditRes] = await Promise.all([
        apiFetch('/api/admin/system-health/metrics'),
        apiFetch('/api/admin/system-health/logs'),
        apiFetch('/api/admin/system-health/errors'),
        apiFetch('/api/admin/system-health/auth-logs'),
        apiFetch('/api/admin/system-health/audit-logs'),
      ]);

      const metricsData = await metricsRes.json() as MetricsResponse;
      const logsData = await logsRes.json() as LogsResponse;
      const errorsData = await errorsRes.json() as ErrorsResponse;
      const authData = await authRes.json() as AuthLogsResponse;
      const auditData = await auditRes.json() as AuditLogsResponse;

      if (metricsData.success) setMetrics(metricsData.metrics);
      if (logsData.success) setLogs(logsData.logs);
      if (errorsData.success) setErrors(errorsData.errors);
      if (authData.success) setAuthLogs(authData.logs);
      if (auditData.success) setAuditLogs(auditData.logs);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch system health data');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRetention = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/system-health/retention');
      const data = await res.json();
      if (data.success) setRetention(data.retention);
    } catch (err: any) {
      console.error('Failed to fetch retention:', err);
    }
  }, []);

  const updateRetention = useCallback(async () => {
    if (!retention) return;
    const newDays = parseInt(retentionDaysInput) || retention.retention_days;
    if (newDays < 1 || newDays > 365) return;
    setRetentionLoading(true);
    try {
      const res = await apiFetch('/api/admin/system-health/retention', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retentionDays: newDays }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchRetention();
        setRetentionDaysInput('');
      }
    } catch (err: any) {
      console.error('Failed to update retention:', err);
    } finally {
      setRetentionLoading(false);
    }
  }, [retention, retentionDaysInput, fetchRetention]);

  const pruneLogs = useCallback(async () => {
    setPruneLoading(true);
    setPruneResult(null);
    try {
      const res = await apiFetch('/api/admin/system-health/prune', { method: 'POST' });
      const data = await res.json();
      if (data.success) setPruneResult(data.deletedCount || 0);
    } catch (err: any) {
      console.error('Failed to prune logs:', err);
    } finally {
      setPruneLoading(false);
    }
  }, []);

  const fetchRequestDetail = useCallback(async (requestId: string) => {
    setDetailLoading(true);
    setSelectedRequestId(requestId);
    try {
      const res = await apiFetch(`/api/admin/system-health/logs/${requestId}`);
      const data = await res.json() as RequestDetailResponse;
      if (data.success) {
        setRequestDetail(data);
      }
    } catch (err: any) {
      console.error('Failed to fetch request detail:', err);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAllData();
    fetchRetention();
  }, [fetchAllData, fetchRetention]);

  const filteredLogs = logs.filter(
    (l) =>
      l.request_id?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.path?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.error_code?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.message?.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const filteredErrors = errors.filter(
    (l) =>
      l.error_code?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.message?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.path?.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const filteredAuthLogs = authLogs.filter(
    (l) =>
      l.request_id?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.message?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.path?.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const filteredAuditLogs = auditLogs.filter(
    (l) =>
      l.action?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.request_id?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      JSON.stringify(l.metadata || {})?.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const renderOverview = () => {
    if (loading) {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="p-4">
              <Skeleton className="h-3 w-20 mb-2" />
              <Skeleton className="h-7 w-16" />
            </Card>
          ))}
        </div>
      );
    }

    if (!metrics) return null;

    const {
      total_requests,
      successful_requests,
      error_4xx,
      error_5xx,
      average_latency_ms,
      slow_requests,
      error_rate,
      total_audit_events,
      error_groups,
    } = metrics;

    const successRate = total_requests > 0 ? Math.round(((successful_requests || 0) / total_requests) * 100) : 100;

    return (
      <div className="space-y-6">
        {/* Health Summary Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="text-xs text-[var(--color-shell-text-subtle)] font-semibold uppercase">
              Total Requests
            </div>
            <div className="text-2xl font-bold text-[var(--color-shell-text)] mt-1">
              {total_requests.toLocaleString()}
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-[var(--color-shell-text-subtle)] font-semibold uppercase">
                  Success Rate
                </div>
                <div className="text-2xl font-bold text-[var(--color-shell-text)] mt-1">
                  {successRate}%
                </div>
              </div>
              <CheckCircle className={`h-6 w-6 ${successRate >= 95 ? 'text-[var(--color-shell-success)]' : successRate >= 90 ? 'text-[var(--color-shell-warning)]' : 'text-[var(--color-shell-error)]'}`} />
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-[var(--color-shell-text-subtle)] font-semibold uppercase">
                  Error Rate
                </div>
                <div className="text-2xl font-bold mt-1">
                  <span className={error_rate > 5 ? 'text-[var(--color-shell-error)]' : error_rate > 1 ? 'text-[var(--color-shell-warning)]' : 'text-[var(--color-shell-success)]'}>
                    {error_rate}%
                  </span>
                </div>
              </div>
              <AlertTriangle className={`h-6 w-6 ${error_rate > 5 ? 'text-[var(--color-shell-error)]' : error_rate > 1 ? 'text-[var(--color-shell-warning)]' : 'text-[var(--color-shell-success)]'}`} />
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-[var(--color-shell-text-subtle)] font-semibold uppercase">
                  Avg Latency
                </div>
                <div className="text-2xl font-bold text-[var(--color-shell-text)] mt-1">
                  {formatDuration(average_latency_ms)}
                </div>
              </div>
              <Clock className="h-6 w-6 text-[var(--color-shell-text-muted)]" />
            </div>
          </Card>
        </div>

        {/* Error Breakdown */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="text-xs text-[var(--color-shell-text-subtle)] font-semibold uppercase">4xx Errors</div>
            <div className="text-xl font-bold text-[var(--color-shell-warning)] mt-1">{error_4xx}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-[var(--color-shell-text-subtle)] font-semibold uppercase">5xx Errors</div>
            <div className="text-xl font-bold text-[var(--color-shell-error)] mt-1">{error_5xx}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-[var(--color-shell-text-subtle)] font-semibold uppercase">Slow Requests (&gt;1s)</div>
            <div className="text-xl font-bold text-[var(--color-shell-warning)] mt-1">{slow_requests}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-[var(--color-shell-text-subtle)] font-semibold uppercase">Audit Events</div>
            <div className="text-xl font-bold text-[var(--color-shell-text)] mt-1">{total_audit_events}</div>
          </Card>
        </div>

        {/* Error Groups Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertCircle className="h-4 w-4 text-[var(--color-shell-error)]" />
              Top Error Patterns
            </CardTitle>
            <CardDescription className="text-xs">
              Aggregated API errors grouped by endpoint and status code.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {error_groups.length === 0 ? (
              <div className="p-4 text-center text-xs text-[var(--color-shell-text-subtle)]">
                No errors detected. System is healthy.
              </div>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                {error_groups.map((group) => (
                  <ErrorGroupRow key={`${group.endpoint}|${group.status_code}|${group.error_type}`} group={group} onRequestIdClick={fetchRequestDetail} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Log Retention Management */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Database className="h-4 w-4 text-[var(--color-shell-accent)]" />
              Log Retention Management
            </CardTitle>
            <CardDescription className="text-xs">
              Logs are automatically pruned after {retention?.retention_days || 30} days.
              Last updated: {retention?.updated_at ? formatTimestamp(retention.updated_at) : 'never'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="1"
                  max="365"
                  placeholder="Enter retention days"
                  value={retentionDaysInput}
                  onChange={(e) => setRetentionDaysInput(e.target.value)}
                  className="flex-1 px-3 py-2 text-xs rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-shell-accent)]"
                />
                <Button size="sm" onClick={updateRetention} isLoading={retentionLoading} className="text-xs">
                  Update
                </Button>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" onClick={pruneLogs} isLoading={pruneLoading} className="text-xs">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Run Manual Cleanup
                </Button>
                {pruneResult !== null && (
                  <span className="text-xs text-[var(--color-shell-text-subtle)]">
                    {pruneResult} records deleted
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  const renderLogTable = (
    data: SystemLog[],
    emptyMessage: string,
    onRowClick?: (requestId: string) => void,
  ) => {
    if (loading) {
      return <SkeletonText lines={8} />;
    }
    if (data.length === 0) {
      return (
        <div className="text-center py-8 text-xs text-[var(--color-shell-text-subtle)]">
          {emptyMessage}
        </div>
      );
    }
    return (
      <div className="max-h-[500px] overflow-y-auto border border-[var(--color-shell-border)] rounded-lg">
        <div className="grid grid-cols-12 gap-2 items-center py-2 px-3 bg-[var(--color-shell-surface-elevated)] text-[10px] font-semibold text-[var(--color-shell-text-subtle)] uppercase sticky top-0 border-b border-[var(--color-shell-border)]">
          <div className="col-span-3">Request ID</div>
          <div className="col-span-1">Level</div>
          <div className="col-span-2">Path</div>
          <div className="col-span-1 text-center">Status</div>
          <div className="col-span-1 text-center">Duration</div>
          <div className="col-span-2">Message</div>
          <div className="col-span-1 text-right">Time</div>
        </div>
        {data.map((log) => (
          <LogRow key={log.id} log={log} onClick={log.request_id ? () => onRowClick?.(log.request_id) : undefined} />
        ))}
      </div>
    );
  };

  const renderAuditTable = (data: AuditLog[]) => {
    if (loading) {
      return <SkeletonText lines={8} />;
    }
    if (data.length === 0) {
      return (
        <div className="text-center py-8 text-xs text-[var(--color-shell-text-subtle)]">
          No audit events.
        </div>
      );
    }
    return (
      <div className="max-h-[500px] overflow-y-auto border border-[var(--color-shell-border)] rounded-lg">
        <div className="grid grid-cols-12 gap-2 items-center py-2 px-3 bg-[var(--color-shell-surface-elevated)] text-[10px] font-semibold text-[var(--color-shell-text-subtle)] uppercase sticky top-0 border-b border-[var(--color-shell-border)]">
          <div className="col-span-2">Timestamp</div>
          <div className="col-span-2">Action</div>
          <div className="col-span-1">Actor Role</div>
          <div className="col-span-2">Request ID</div>
          <div className="col-span-2">Entity Type</div>
          <div className="col-span-3">Entity ID</div>
        </div>
        {data.map((log) => (
          <AuditLogRow key={log.id} log={log} onClick={log.request_id ? () => fetchRequestDetail(log.request_id!) : undefined} />
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6" data-testid="admin-system-health">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">
            System Health
          </h1>
          <p className="mt-1 text-xs text-zinc-500">
            Real-time server-side request logging, error tracking, auth events, and audit trails.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchAllData} disabled={loading} className="text-xs gap-1.5">
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </Button>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-1 p-1 bg-zinc-100 rounded-lg border border-zinc-200">
        {TAB_CONFIG.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-all cursor-pointer ${
                isActive
                  ? 'bg-white text-zinc-900 shadow-xs'
                  : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Search Bar (tabs that have logs) */}
      {activeTab !== 'overview' && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
          <input
            type="text"
            placeholder="Search logs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-zinc-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )}

      {/* Tab Content */}
      <div data-testid={`tab-${activeTab}`}>
        {activeTab === 'overview' && renderOverview()}

        {activeTab === 'requests' && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">API Request Logs</CardTitle>
              <CardDescription className="text-xs">
                Every API request with duration, status code, and user context.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {renderLogTable(
                filteredLogs,
                'No API request logs found.',
                fetchRequestDetail,
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === 'errors' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 text-rose-600" />
                Error Logs
              </CardTitle>
              <CardDescription className="text-xs">
                API errors (4xx/5xx), auth failures, and system exceptions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {renderLogTable(
                filteredErrors,
                'No error logs found. System is clean.',
                fetchRequestDetail,
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === 'auth' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Shield className="h-4 w-4 text-blue-600" />
                Auth Event Logs
              </CardTitle>
              <CardDescription className="text-xs">
                Login successes, failures, token validation, and authorization checks.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {renderLogTable(
                filteredAuthLogs,
                'No auth events found.',
                (requestId) => fetchRequestDetail(requestId),
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === 'audit' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Database className="h-4 w-4 text-purple-600" />
                Audit Trail
              </CardTitle>
              <CardDescription className="text-xs">
                Admin actions: approvals, edits, activations, payment changes.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {renderAuditTable(filteredAuditLogs)}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Request Detail Modal */}
      <Modal
        isOpen={!!selectedRequestId}
        onClose={() => {
          setSelectedRequestId(null);
          setRequestDetail(null);
        }}
        title={`Request: ${selectedRequestId || ''}`}
        description="Correlated system logs, auth events, and audit trail for this request."
        maxWidth="2xl"
      >
        {detailLoading ? (
          <SkeletonText lines={6} />
        ) : requestDetail ? (
          <div className="space-y-4 max-h-[500px] overflow-y-auto">
            {/* API Logs */}
            {requestDetail.logs && requestDetail.logs.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-[var(--color-shell-text-subtle)] uppercase mb-2 flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  API Logs
                </h4>
                {requestDetail.logs.map((log) => (
                  <div key={log.id} className="space-y-1 pb-2 border-b border-[var(--color-shell-border)]">
                    <div className="flex items-center gap-2">
                      <StatusBadge level={log.level} />
                      <Badge variant={log.status_code && log.status_code >= 500 ? 'destructive' : log.status_code && log.status_code >= 400 ? 'warning' : 'success'} className="text-[9px]">
                        {log.method} {log.status_code || '—'}
                      </Badge>
                      <code className="text-[9px] text-[var(--color-shell-text-subtle)]">{log.path}</code>
                      <span className="text-[9px] text-[var(--color-shell-text-subtle)]">{formatTimestamp(log.created_at)}</span>
                    </div>
                    {log.error_code && <CodeBadge code={log.error_code} />}
                    {log.message && <div className="text-[10px] text-[var(--color-shell-text)] mt-1">{log.message}</div>}
                    {log.duration_ms && <div className="text-[9px] text-[var(--color-shell-text-subtle)]">Duration: {formatDuration(log.duration_ms)}</div>}
                  </div>
                ))}
              </div>
            )}

            {/* Auth Logs */}
            {requestDetail.auth_log && requestDetail.auth_log.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-[var(--color-shell-text-subtle)] uppercase mb-2 flex items-center gap-1">
                  <Shield className="h-3 w-3" />
                  Auth Events
                </h4>
                {requestDetail.auth_log.map((log) => (
                  <div key={log.id} className="pb-1.5 border-b border-[var(--color-shell-border)]">
                    <div className="flex items-center gap-2">
                      <StatusBadge level={log.level} />
                      <span className="text-xs text-[var(--color-shell-text)]">{log.message}</span>
                    </div>
                    <div className="text-[9px] text-[var(--color-shell-text-subtle)] mt-0.5">
                      {log.user_id && <span>User: {log.user_id} · </span>}
                      {log.role && <span>Role: {log.role} · </span>}
                      {formatTimestamp(log.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Audit Logs */}
            {requestDetail.audit_log && requestDetail.audit_log.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-[var(--color-shell-text-subtle)] uppercase mb-2 flex items-center gap-1">
                  <Database className="h-3 w-3" />
                  Audit Events
                </h4>
                {requestDetail.audit_log.map((log) => (
                  <div key={log.id} className="pb-1.5 border-b border-[var(--color-shell-border)]">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-[var(--color-shell-text)]">{log.action}</span>
                      <Badge variant="secondary" className="text-[9px]">{log.entity_type || 'system'}</Badge>
                    </div>
                    <div className="text-[9px] text-[var(--color-shell-text-subtle)] mt-0.5">
                      Actor: {log.actor_role || 'system'} · {formatTimestamp(log.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Empty state for this request */}
            {(!requestDetail.logs?.length && !requestDetail.auth_log?.length && !requestDetail.audit_log?.length) && (
              <div className="text-center py-4 text-xs text-[var(--color-shell-text-subtle)]">
                No records found for this request ID.
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-4 text-xs text-[var(--color-shell-text-subtle)]">
            Select a log entry to view correlated request details.
          </div>
        )}
      </Modal>
    </div>
  );
};

const ErrorGroupRow: React.FC<{
  group: ErrorGroup;
  onRequestIdClick: (requestId: string) => void;
}> = ({ group, onRequestIdClick }) => {
  const is5xx = group.status_code !== null && group.status_code >= 500;
  const is4xx = group.status_code !== null && group.status_code >= 400 && group.status_code < 500;
  const statusVariant = is5xx ? 'destructive' : is4xx ? 'warning' : 'default';

  return (
    <div className="p-3 border-b border-[var(--color-shell-border)] last:border-0">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <code className="text-xs text-[var(--color-shell-text)]">{group.endpoint || 'unknown'}</code>
          <Badge variant={statusVariant} className="text-[9px]">
            {group.status_code || '—'}
          </Badge>
          {group.error_type && <CodeBadge code={group.error_type} />}
        </div>
        <Badge variant="outline" className="text-[9px] self-start sm:self-auto">
          {group.occurrences} occurrence{group.occurrences !== 1 ? 's' : ''}
        </Badge>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 text-[9px]">
        <span className="text-[var(--color-shell-text-subtle)]">
          First: {formatTimestamp(group.first_seen)}
        </span>
        <span className="text-[var(--color-shell-text-subtle)] hidden sm:inline"> · </span>
        <span className="text-[var(--color-shell-text-subtle)]">
          Last: {formatTimestamp(group.last_seen)}
        </span>
        {group.request_id && (
          <>
            <span className="text-[var(--color-shell-text-subtle)] hidden sm:inline"> · </span>
            <button
              onClick={() => onRequestIdClick(group.request_id)}
              className="text-[var(--color-shell-accent)] hover:text-[var(--color-shell-accent-hover)] font-mono cursor-pointer"
            >
              {group.request_id}
            </button>
          </>
        )}
      </div>
    </div>
  );
};
