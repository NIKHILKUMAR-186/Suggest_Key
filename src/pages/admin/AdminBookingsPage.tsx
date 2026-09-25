import React, { useState, useEffect } from 'react';
import { Calendar, Filter, Clock, Video, CheckCircle2, AlertCircle, AlertTriangle, Eye, ShieldCheck, RefreshCw } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { Modal } from '@/src/components/ui/Modal';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { getLocalBookingEngineContext, enrichBooking, EnrichedBookingRecord } from '@/src/lib/bookingService';
import { getOverdueBookings } from '@/src/lib/bookingEngine';

export const AdminBookingsPage: React.FC = () => {
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [selectedBooking, setSelectedBooking] = useState<EnrichedBookingRecord | null>(null);
  const [bookings, setBookings] = useState<EnrichedBookingRecord[]>([]);
  const [overdueCount, setOverdueCount] = useState<number>(0);

  const loadBookings = () => {
    try {
      const db = getLocalBookingEngineContext();
      const enriched = db.bookings.map((b) => enrichBooking(b, db));
      // Sort by start_time asc
      enriched.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
      setBookings(enriched);

      const overdue = getOverdueBookings(db);
      setOverdueCount(overdue.length);
    } catch (err) {
      console.error('Failed to load admin bookings:', err);
    }
  };

  useEffect(() => {
    loadBookings();
  }, []);

  const filtered = bookings.filter((b) => {
    if (filterStatus === 'ALL') return true;
    if (filterStatus === 'OVERDUE_LINKS') {
      return b.status === 'MENTOR_PENDING' && b.deadlineInfo?.isOverdue;
    }
    return b.status === filterStatus;
  });

  const formatScheduledTime = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Kolkata',
      }) + ' IST';
    } catch {
      return isoString;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[var(--color-shell-border)] pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-shell-text)] sm:text-3xl">
            Bookings Ledger
          </h1>
          <p className="mt-1 text-xs text-[var(--color-shell-text-muted)]">
            Authoritative state machine timeline of all 15-min holds, payments, and confirmations.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={loadBookings} variant="outline" size="sm" className="text-xs gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh Ledger</span>
          </Button>

          <div className="flex flex-wrap items-center gap-1 bg-[var(--color-shell-bg-hover)] p-1 rounded-lg self-start text-xs">
            {[
              { id: 'ALL', label: 'ALL' },
              { id: 'OVERDUE_LINKS', label: `OVERDUE LINKS (${overdueCount})`, isAlert: overdueCount > 0 },
              { id: 'MENTOR_PENDING', label: 'MENTOR_PENDING' },
              { id: 'CONFIRMED', label: 'CONFIRMED' },
              { id: 'PAYMENT_PENDING', label: 'PAYMENT_PENDING' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilterStatus(tab.id)}
                className={`px-2.5 py-1 rounded-md font-medium text-[11px] transition-colors cursor-pointer flex items-center gap-1 ${
                  filterStatus === tab.id
                    ? tab.id === 'OVERDUE_LINKS'
                      ? 'bg-[var(--color-shell-warning)] text-[var(--color-shell-text-contrast)] font-bold shadow-xs'
                      : 'bg-[var(--color-shell-surface)] text-[var(--color-shell-text)] shadow-xs font-bold'
                    : tab.isAlert
                    ? 'text-[var(--color-shell-warning)] font-semibold hover:bg-[var(--color-shell-warning-soft)]'
                    : 'text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)]'
                }`}
              >
                {tab.isAlert && <AlertTriangle className="h-3 w-3 shrink-0" />}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Overdue Links Admin Advisory */}
      {overdueCount > 0 && (
        <div className="rounded-xl border border-[var(--color-shell-warning)] bg-[var(--color-shell-warning-soft)] p-4 flex items-start justify-between gap-3 text-xs text-[var(--status-warning-strong)]">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-[var(--color-shell-warning)] shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-sm block">
                {overdueCount} Overdue Mentor Meeting Link(s) Identified
              </span>
              <p className="mt-0.5 text-[var(--color-shell-text-muted)] leading-relaxed">
                Platform Rule: Recommended deadline is 2 hours before session. Missing the deadline does <strong>not</strong> automatically cancel the session. Admins can audit and send mentor reminders.
              </p>
            </div>
          </div>

          <Button
            size="sm"
            onClick={() => setFilterStatus('OVERDUE_LINKS')}
            className="text-xs shrink-0 bg-[var(--color-shell-warning)] text-[var(--color-shell-text-contrast)] hover:bg-[var(--color-shell-warning)]/90"
          >
            Filter Overdue
          </Button>
        </div>
      )}

      {/* Bookings Table */}
      <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] overflow-hidden shadow-xs">
        <table className="w-full text-left text-xs text-[var(--color-shell-text-muted)]">
          <thead className="bg-[var(--color-shell-bg-hover)]/70 border-b border-[var(--color-shell-border)] text-[var(--color-shell-text)] font-semibold uppercase tracking-wider text-[11px]">
            <tr>
              <th className="py-3 px-4">Booking Code</th>
              <th className="py-3 px-4">Seeker ➔ Mentor</th>
              <th className="py-3 px-4">Scheduled Time</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Meeting Link Deadline</th>
              <th className="py-3 px-4">Payment</th>
              <th className="py-3 px-4 text-right">Audit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-shell-border)]">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-[var(--color-shell-text-subtle)]">
                  No bookings found matching filter "{filterStatus}".
                </td>
              </tr>
            ) : (
              filtered.map((b) => {
                const isOverdue = b.status === 'MENTOR_PENDING' && b.deadlineInfo?.isOverdue;
                const hoursLeft = b.deadlineInfo?.hoursUntilSession;

                return (
                  <tr
                    key={b.id}
                    className={`hover:bg-zinc-50/50 transition-colors ${
                      isOverdue ? 'bg-amber-50/30' : ''
                    }`}
                  >
                    <td className="py-3 px-4 font-mono font-bold text-zinc-950">
                      #{b.booking_code}
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-bold text-zinc-900 block">
                        {b.seeker?.full_name || b.seeker_id}
                      </span>
                      <span className="text-[11px] text-zinc-400">Mentor: {b.mentor_id}</span>
                    </td>
                    <td className="py-3 px-4 text-zinc-700">
                      {formatScheduledTime(b.start_time)}
                    </td>
                    <td className="py-3 px-4">
                      <Badge
                        variant={
                          b.status === 'CONFIRMED'
                            ? 'success'
                            : b.status === 'MENTOR_PENDING'
                            ? 'warning'
                            : 'secondary'
                        }
                        className="text-[10px]"
                      >
                        {b.status}
                      </Badge>
                    </td>
                    <td className="py-3 px-4">
                      {b.meeting_url ? (
                        <span className="text-emerald-700 font-medium flex items-center gap-1 text-[11px]">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          <span>Confirmed (HTTPS)</span>
                        </span>
                      ) : isOverdue ? (
                        <span className="inline-flex items-center gap-1 text-amber-900 font-bold bg-amber-100 px-2 py-0.5 rounded text-[11px] border border-amber-300">
                          <AlertTriangle className="h-3 w-3 text-amber-700" />
                          OVERDUE LINK (&lt;2h)
                        </span>
                      ) : b.status === 'MENTOR_PENDING' ? (
                        <span className="text-zinc-500 text-[11px]">
                          Due 2h before ({hoursLeft !== undefined && hoursLeft > 0 ? `~${hoursLeft}h left` : 'Pending'})
                        </span>
                      ) : (
                        <span className="text-zinc-400 italic text-[11px]">N/A</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-semibold text-zinc-900">
                      ₹{b.amount_inr}
                      {b.payment?.status === 'VERIFIED' && (
                        <span className="ml-1 text-[10px] text-emerald-600 font-normal">
                          (Verified)
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => setSelectedBooking(b)}
                        className="text-zinc-500 hover:text-zinc-900 p-1 rounded cursor-pointer"
                        title="View Detailed Audit"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Booking Detail Modal */}
      {selectedBooking && (
        <Modal
          isOpen={!!selectedBooking}
          onClose={() => setSelectedBooking(null)}
          title={`Booking Audit: #${selectedBooking.booking_code}`}
          description={`Session: ${selectedBooking.gig?.title || '1:1 Session'}`}
        >
          <div className="space-y-4 pt-2 text-xs">
            <div className="grid grid-cols-2 gap-3 bg-zinc-50 p-3.5 rounded-lg border border-zinc-100">
              <div>
                <span className="text-zinc-400 block text-[11px]">Seeker</span>
                <span className="font-bold text-zinc-900">
                  {selectedBooking.seeker?.full_name || selectedBooking.seeker_id}
                </span>
                <span className="text-zinc-400 block text-[10px]">
                  {selectedBooking.seeker?.email}
                </span>
              </div>
              <div>
                <span className="text-zinc-400 block text-[11px]">Mentor ID</span>
                <span className="font-bold text-zinc-900">{selectedBooking.mentor_id}</span>
              </div>
              <div>
                <span className="text-zinc-400 block text-[11px]">Scheduled Start</span>
                <span className="text-zinc-800">
                  {formatScheduledTime(selectedBooking.start_time)}
                </span>
              </div>
              <div>
                <span className="text-zinc-400 block text-[11px]">Status</span>
                <Badge
                  variant={
                    selectedBooking.status === 'CONFIRMED'
                      ? 'success'
                      : selectedBooking.status === 'MENTOR_PENDING'
                      ? 'warning'
                      : 'secondary'
                  }
                >
                  {selectedBooking.status}
                </Badge>
              </div>
            </div>

            {/* Meeting Link & Deadline Inspection */}
            <div className="p-3 bg-zinc-50 rounded-lg border border-zinc-200 space-y-1.5">
              <span className="font-semibold text-zinc-900 block text-xs">
                Phase 8: Meeting Link & Deadline Rules
              </span>
              <div className="text-zinc-700 space-y-1">
                <div>
                  <strong>Meeting Link: </strong>
                  {selectedBooking.meeting_url ? (
                    <span className="font-mono text-emerald-800 break-all">
                      {selectedBooking.meeting_url}
                    </span>
                  ) : (
                    <span className="text-amber-700 italic">Not yet provided by mentor</span>
                  )}
                </div>
                <div>
                  <strong>Deadline Status: </strong>
                  {selectedBooking.deadlineInfo?.isOverdue ? (
                    <span className="text-amber-800 font-bold">
                      OVERDUE (&lt;2h before session). Session remains active.
                    </span>
                  ) : (
                    <span className="text-zinc-600">
                      Recommended 2h before session start.
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="p-3 bg-zinc-100 rounded-lg text-[11px] text-zinc-600 space-y-1">
              <span className="font-semibold text-zinc-800 block">Platform Security Invariant:</span>
              <p>
                Only valid HTTPS meeting links are accepted. Direct meeting link is concealed from seeker until 5 minutes before scheduled start time.
              </p>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
