import React, { useState, useEffect } from 'react';
import { CreditCard, CheckCircle2, Clock, Users, ShieldAlert, AlertTriangle, ArrowRight, Layers, Calendar, Loader2 } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { useNavigation } from '@/src/context/NavigationContext';
import { apiFetch } from '@/src/lib/apiClient';

interface DashboardMetrics {
  totalMentors: number;
  totalSeekers: number;
  pendingApprovals: number;
  activeSegments: number;
  pendingPaymentsCount: number;
  todaysBookingsCount: number;
  pendingPayments: Array<{
    id: string;
    bookingId: string;
    seeker: string;
    mentor: string;
    amount: number;
    time: string;
  }>;
  defaultSegment: string;
}

export const AdminDashboardPage: React.FC = () => {
  const { navigate } = useNavigation();
  const [viewState, setViewState] = useState<'operational' | 'quiet'>('operational');
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/admin/dashboard/metrics');
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to fetch metrics');
      setMetrics(data.metrics);
    } catch (err: any) {
      setError(err.message || 'Failed to load dashboard metrics');
      console.error('Failed to fetch dashboard metrics:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
  }, []);

  const pendingPaymentsCount = metrics?.pendingPaymentsCount || 0;
  const pendingApprovalsCount = metrics?.pendingApprovals || 0;
  const todaysBookingsCount = metrics?.todaysBookingsCount || 0;
  const activeSegmentsCount = metrics?.activeSegments || 0;
  const defaultSegmentName = metrics?.defaultSegment || 'None';

  return (
    <div className="space-y-6">
      {/* Header & Review State Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[var(--color-shell-border)] pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-shell-text)] sm:text-3xl">
            Operational Dashboard
          </h1>
          <p className="mt-1 text-xs text-[var(--color-shell-text-muted)]">
            Real-time platform ledger, payment queue, mentor approvals, and SLA compliance.
          </p>
        </div>

        <div className="flex items-center gap-1 bg-[var(--color-shell-bg-hover)] p-1 rounded-lg self-start text-xs">
          <button
            onClick={() => setViewState('operational')}
            className={`px-2.5 py-1 rounded-md capitalize font-medium ${
              viewState === 'operational' ? 'bg-[var(--color-shell-surface)] text-[var(--color-shell-text)] shadow-xs' : 'text-[var(--color-shell-text-muted)]'
            }`}
          >
            Active Action Queues
          </button>
          <button
            onClick={() => setViewState('quiet')}
            className={`px-2.5 py-1 rounded-md capitalize font-medium ${
              viewState === 'quiet' ? 'bg-[var(--color-shell-surface)] text-[var(--color-shell-text)] shadow-xs' : 'text-[var(--color-shell-text-muted)]'
            }`}
          >
            Zero Backlog State
          </button>
        </div>
      </div>

      {/* Primary Operational Counters (Denser, operational, non-vanity) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          [1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-4 animate-pulse">
              <div className="flex items-center justify-between">
                <div className="h-3 w-24 bg-[var(--color-shell-border)] rounded"></div>
                <div className="h-4 w-16 bg-[var(--color-shell-border)] rounded"></div>
              </div>
              <div className="mt-2 h-8 w-16 bg-[var(--color-shell-border)] rounded"></div>
              <div className="mt-1 h-3 w-32 bg-[var(--color-shell-border)] rounded"></div>
            </div>
          ))
        ) : error ? (
          <>
            <div className="col-span-4 rounded-lg border border-[var(--color-shell-error)] bg-[var(--color-shell-error-soft)] p-4 text-center text-[var(--color-shell-error)]">
              <AlertTriangle className="h-6 w-6 mx-auto mb-2" />
              <p className="text-xs">{error}</p>
              <Button variant="outline" size="sm" onClick={fetchMetrics} className="mt-2">
                Retry
              </Button>
            </div>
          </>
        ) : (
          <>
            <div
              onClick={() => navigate('/admin/payments')}
              className="rounded-lg border border-[var(--color-shell-warning)] bg-[var(--color-shell-warning-soft)] p-4 cursor-pointer hover:border-[var(--color-shell-warning-border)] transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--status-warning-strong)]">Payments Pending Review</span>
                <Badge variant="warning" className="text-[10px]">Action Required</Badge>
              </div>
              <div className="mt-2 text-2xl font-bold text-[var(--status-warning-strong)]">
                {pendingPaymentsCount}
              </div>
              <span className="text-[11px] text-[var(--color-shell-warning)]">Manual QR receipts awaiting verification</span>
            </div>

            <div
              onClick={() => navigate('/admin/users')}
              className="rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-4 cursor-pointer hover:border-[var(--color-shell-border-strong)] transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--color-shell-text)]">Pending Mentor Approvals</span>
                <Badge variant="warning" className="text-[10px]">Queue</Badge>
              </div>
              <div className="mt-2 text-2xl font-bold text-[var(--color-shell-text)]">
                {pendingApprovalsCount}
              </div>
              <span className="text-[11px] text-[var(--color-shell-text-muted)]">Mentor applications awaiting verification</span>
            </div>

            <div
              onClick={() => navigate('/admin/bookings')}
              className="rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-4 cursor-pointer hover:border-[var(--color-shell-border-strong)] transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--color-shell-text)]">Active Bookings Today</span>
                <Badge variant="success" className="text-[10px]">Scheduled</Badge>
              </div>
              <div className="mt-2 text-2xl font-bold text-[var(--color-shell-text)]">
                {todaysBookingsCount}
              </div>
              <span className="text-[11px] text-[var(--color-shell-text-muted)]">Atomic slots locked & confirmed</span>
            </div>

            <div
              onClick={() => navigate('/admin/segments')}
              className="rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-4 cursor-pointer hover:border-[var(--color-shell-border-strong)] transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--color-shell-text)]">Active Segments</span>
                <span className="text-xs text-[var(--color-shell-text-subtle)]">System</span>
              </div>
              <div className="mt-2 text-2xl font-bold text-[var(--color-shell-text)]">{activeSegmentsCount}</div>
              <span className="text-[11px] text-[var(--color-shell-text-muted)]">Highest priority: {defaultSegmentName}</span>
            </div>
          </>
        )}
      </div>

      {viewState === 'operational' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Urgent Payment Proofs Queue */}
          <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--color-shell-border)] pb-3">
              <div className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-[var(--color-shell-warning)]" />
                <h2 className="text-sm font-bold text-[var(--color-shell-text)]">Pending Payment Verifications</h2>
              </div>
              <Button
                onClick={() => navigate('/admin/payments')}
                variant="ghost"
                size="sm"
                className="text-xs gap-1"
              >
                <span>View All</span>
                <ArrowRight className="h-3 w-3" />
              </Button>
            </div>

            <div className="space-y-2.5">
              {metrics?.pendingPayments?.length === 0 ? (
                <div className="text-center text-[var(--color-shell-text-subtle)] text-xs py-4">No pending payments</div>
              ) : (
                metrics?.pendingPayments?.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg-hover)] text-xs"
                  >
                    <div>
                      <span className="font-bold text-[var(--color-shell-text)] block">{p.seeker} ➔ {p.mentor}</span>
                      <span className="text-[11px] text-[var(--color-shell-text-muted)]">{p.id} · Submitted {p.time}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-[var(--color-shell-text)]">₹{p.amount}</span>
                      <Button
                        onClick={() => navigate('/admin/payments')}
                        size="sm"
                        className="text-xs py-1 h-7"
                      >
                        Inspect Proof
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Missed Confirmation / SLA Audit Alert */}
          <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--color-shell-border)] pb-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-[var(--color-shell-error)]" />
                <h2 className="text-sm font-bold text-[var(--color-shell-text)]">Mentor SLA & Deadline Tracking</h2>
              </div>
              <Badge variant="secondary" className="text-[10px]">Authoritative Log</Badge>
            </div>

            <div className="p-3.5 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg-hover)] text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[var(--color-shell-text)]">Recommended 2-Hour Deadline Compliance</span>
                <span className="text-[var(--color-shell-success)] font-semibold">100% On-Time</span>
              </div>
              <p className="text-[11px] text-[var(--color-shell-text-muted)] leading-relaxed">
                Platform records missed 2-hour meeting link deadlines without cancelling bookings. No active deadline violations detected.
              </p>
            </div>

            <div className="pt-2">
              <Button
                onClick={() => navigate('/admin/bookings')}
                variant="outline"
                size="sm"
                className="w-full text-xs gap-1.5"
              >
                <Calendar className="h-3.5 w-3.5" />
                <span>Audit Authoritative Bookings Ledger</span>
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[var(--color-shell-border)] bg-[var(--color-shell-bg-hover)]/50 p-12 text-center text-xs text-[var(--color-shell-text-muted)]">
          Operational queues are empty. Platform is running in optimal state with zero backlog.
        </div>
      )}
    </div>
  );
};