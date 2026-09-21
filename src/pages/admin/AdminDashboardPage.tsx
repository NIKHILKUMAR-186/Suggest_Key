import React, { useState } from 'react';
import { CreditCard, CheckCircle2, Clock, Users, ShieldAlert, AlertTriangle, ArrowRight, Layers, Calendar } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { useNavigation } from '@/src/context/NavigationContext';

export const AdminDashboardPage: React.FC = () => {
  const { navigate } = useNavigation();
  const [viewState, setViewState] = useState<'operational' | 'quiet'>('operational');

  return (
    <div className="space-y-6">
      {/* Header & Review State Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">
            Operational Dashboard
          </h1>
          <p className="mt-1 text-xs text-zinc-500">
            Real-time platform ledger, payment queue, mentor approvals, and SLA compliance.
          </p>
        </div>

        <div className="flex items-center gap-1 bg-zinc-100 p-1 rounded-lg self-start text-xs">
          <button
            onClick={() => setViewState('operational')}
            className={`px-2.5 py-1 rounded-md capitalize font-medium ${
              viewState === 'operational' ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-600'
            }`}
          >
            Active Action Queues
          </button>
          <button
            onClick={() => setViewState('quiet')}
            className={`px-2.5 py-1 rounded-md capitalize font-medium ${
              viewState === 'quiet' ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-600'
            }`}
          >
            Zero Backlog State
          </button>
        </div>
      </div>

      {/* Primary Operational Counters (Denser, operational, non-vanity) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div
          onClick={() => navigate('/admin/payments')}
          className="rounded-lg border border-amber-200 bg-amber-50/40 p-4 cursor-pointer hover:border-amber-300 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-900">Payments Pending Review</span>
            <Badge variant="warning" className="text-[10px]">Action Required</Badge>
          </div>
          <div className="mt-2 text-2xl font-bold text-amber-950">
            {viewState === 'operational' ? '3' : '0'}
          </div>
          <span className="text-[11px] text-amber-800">Manual QR receipts awaiting verification</span>
        </div>

        <div
          onClick={() => navigate('/admin/mentors')}
          className="rounded-lg border border-zinc-200 bg-white p-4 cursor-pointer hover:border-zinc-300 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-700">Pending Mentor Approvals</span>
            <span className="text-xs text-zinc-400">Queue</span>
          </div>
          <div className="mt-2 text-2xl font-bold text-zinc-950">
            {viewState === 'operational' ? '2' : '0'}
          </div>
          <span className="text-[11px] text-zinc-500">Mentors awaiting segment authorization</span>
        </div>

        <div
          onClick={() => navigate('/admin/bookings')}
          className="rounded-lg border border-zinc-200 bg-white p-4 cursor-pointer hover:border-zinc-300 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-700">Active Bookings Today</span>
            <Badge variant="success" className="text-[10px]">Scheduled</Badge>
          </div>
          <div className="mt-2 text-2xl font-bold text-zinc-950">
            {viewState === 'operational' ? '8' : '0'}
          </div>
          <span className="text-[11px] text-zinc-500">Atomic slots locked & confirmed</span>
        </div>

        <div
          onClick={() => navigate('/admin/segments')}
          className="rounded-lg border border-zinc-200 bg-white p-4 cursor-pointer hover:border-zinc-300 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-700">Active Segments</span>
            <span className="text-xs text-zinc-400">System</span>
          </div>
          <div className="mt-2 text-2xl font-bold text-zinc-950">3</div>
          <span className="text-[11px] text-zinc-500">Highest priority: Relationship Advisor</span>
        </div>
      </div>

      {viewState === 'operational' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Urgent Payment Proofs Queue */}
          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
              <div className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-amber-600" />
                <h2 className="text-sm font-bold text-zinc-950">Pending Payment Verifications</h2>
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
              {[
                { id: 'PAY-901', seeker: 'Aman Kumar', mentor: 'Rahul Sharma', amount: 999, time: '6m ago' },
                { id: 'PAY-902', seeker: 'Pooja V.', mentor: 'Ananya Patel', amount: 1200, time: '18m ago' },
              ].map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-zinc-100 bg-zinc-50/70 text-xs"
                >
                  <div>
                    <span className="font-bold text-zinc-900 block">{p.seeker} ➔ {p.mentor}</span>
                    <span className="text-[11px] text-zinc-500">{p.id} · Submitted {p.time}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-zinc-900">₹{p.amount}</span>
                    <Button
                      onClick={() => navigate('/admin/payments')}
                      size="sm"
                      className="text-xs py-1 h-7"
                    >
                      Inspect Proof
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Missed Confirmation / SLA Audit Alert */}
          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-rose-600" />
                <h2 className="text-sm font-bold text-zinc-950">Mentor SLA & Deadline Tracking</h2>
              </div>
              <Badge variant="secondary" className="text-[10px]">Authoritative Log</Badge>
            </div>

            <div className="p-3.5 rounded-lg border border-zinc-100 bg-zinc-50/70 text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-zinc-900">Recommended 2-Hour Deadline Compliance</span>
                <span className="text-emerald-700 font-semibold">100% On-Time</span>
              </div>
              <p className="text-[11px] text-zinc-500 leading-relaxed">
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
        <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/50 p-12 text-center text-xs text-zinc-500">
          Operational queues are empty. Platform is running in optimal state with zero backlog.
        </div>
      )}
    </div>
  );
};
