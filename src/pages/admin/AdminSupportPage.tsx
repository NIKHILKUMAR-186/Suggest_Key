import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LifeBuoy,
  Lock,
  Paperclip,
  Search,
  Send,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { PageHeading } from '@/src/components/booking/PageHeading';
import { InlineNotice, SectionCard } from '@/src/components/booking/StatePanel';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { Textarea } from '@/src/components/ui/Textarea';
import { SupportPriorityBadge, SupportStatusBadge, TicketCodeChip } from '@/src/components/support/SupportBadges';
import { LoadingState } from '@/src/components/shared/LoadingState';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { useNavigation } from '@/src/context/NavigationContext';
import {
  SUPPORT_STATUS_TRANSITIONS,
  SUPPORT_TICKET_PRIORITIES,
  SUPPORT_TICKET_STATUSES,
  formatInr,
  formatTicketDate,
  isSupportTicketReplyable,
  relativeTime,
  supportCategoryLabel,
  supportPriorityPresentation,
  supportStatusPresentation,
  type SupportTicketStatus,
} from '@/src/lib/supportDomain';
import {
  SupportApiError,
  addInternalNote,
  getSupportMetrics,
  getSupportTicket,
  listSupportTickets,
  replyToSupportTicket,
  resolveSupportTicket,
  updateSupportTicket,
  type SupportMetrics,
  type SupportTicketDetail,
  type SupportTicketSummary,
} from '@/src/lib/supportService';

/**
 * The admin Support Center: a real operational queue over real rows.
 *
 * Dense rather than friendly - this is a work surface. Three columns on a
 * desktop (queue, filters, detail), collapsing to list-then-detail on a narrow
 * screen.
 *
 * Nothing here is trusted. Status, priority and assignment all go to an admin-only
 * RPC that re-verifies the role; internal notes go to a different admin-only RPC
 * whose output the user-facing API can never return; and the queue itself is
 * read through `list_support_tickets(..., scope => 'ADMIN')`, which refuses a
 * non-admin caller server-side.
 *
 * REFUNDS. There is deliberately no refund action on this screen. The refund
 * lifecycle is the payments feature's, settled by `complete_manual_refund` or by
 * a gateway event, and a ticket carries no authority to move money. What this
 * screen shows is the payment's REAL refund state, read from the database, so
 * an admin can answer "where is my refund" truthfully instead of guessing.
 */

const STATUS_TABS: Array<{ id: 'ALL' | SupportTicketStatus; label: string }> = [
  { id: 'ALL', label: 'All' },
  { id: 'OPEN', label: 'Open' },
  { id: 'IN_PROGRESS', label: 'In Progress' },
  { id: 'WAITING_FOR_USER', label: 'Waiting' },
  { id: 'RESOLVED', label: 'Resolved' },
  { id: 'CLOSED', label: 'Closed' },
];

export const AdminSupportPage: React.FC<{ initialTicketCode?: string }> = ({ initialTicketCode }) => {
  const { currentPath } = useNavigation();

  // Support notifications deep-link as `/admin/support?ticketCode=SK-...`, so the
  // queue opens that ticket rather than an empty detail pane.
  const linkedTicketCode =
    initialTicketCode ?? new URLSearchParams(currentPath.split('?')[1] ?? '').get('ticketCode') ?? undefined;

  const [tickets, setTickets] = useState<SupportTicketSummary[]>([]);
  const [metrics, setMetrics] = useState<SupportMetrics | null>(null);
  const [statusTab, setStatusTab] = useState<'ALL' | SupportTicketStatus>('ALL');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(linkedTicketCode ?? null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const [queue, counts] = await Promise.all([
        listSupportTickets({
          scope: 'ADMIN',
          ...(statusTab === 'ALL' ? {} : { status: statusTab }),
          ...(search.trim() ? { search: search.trim() } : {}),
        }),
        // Metrics are the unfiltered truth. Filtering the queue must not make
        // the dashboard numbers lie.
        getSupportMetrics().catch(() => null),
      ]);
      setTickets(queue.tickets);
      setMetrics(counts);
      setError(null);
    } catch (err) {
      setError(err instanceof SupportApiError ? err.message : 'We could not load the support queue.');
    } finally {
      setLoading(false);
    }
  }, [statusTab, search]);

  useEffect(() => {
    // Debounced so typing in the search box does not fire a query per keystroke.
    const timer = setTimeout(() => void loadQueue(), search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [loadQueue, search]);

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: tickets.length };
    for (const status of SUPPORT_TICKET_STATUSES) {
      counts[status] = tickets.filter((t) => t.status === status).length;
    }
    return counts;
  }, [tickets]);

  return (
    <div className="space-y-6">
      <PageHeading
        eyebrow="Support Center"
        title="Support queue"
        description="Every ticket below is a real record with a real conversation. Internal notes are never shown to the user."
        aside={<QueueMetrics metrics={metrics} />}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <section aria-label="Ticket queue" className="min-w-0 space-y-3">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter by status">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={statusTab === tab.id}
                onClick={() => setStatusTab(tab.id)}
                className={`min-h-[32px] cursor-pointer rounded-lg border px-2.5 py-1 text-[12.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] ${
                  statusTab === tab.id
                    ? 'border-[var(--segment-border-accent)] bg-[var(--color-shell-surface)] text-[var(--color-shell-text)]'
                    : 'border-[var(--color-shell-border)] text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)]'
                }`}
              >
                {tab.label}
                {tabCounts[tab.id] > 0 && <span className="ml-1.5 tabular-nums opacity-70">{tabCounts[tab.id]}</span>}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--color-shell-text-subtle)]"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code, subject, name or email"
              aria-label="Search support tickets"
              className="pl-9"
            />
          </div>

          {loading ? (
            <LoadingState message="Loading the queue" />
          ) : error ? (
            <ErrorState title="We could not load the queue" message={error} onRetry={loadQueue} />
          ) : tickets.length === 0 ? (
            <InlineNotice tone="neutral" icon={LifeBuoy}>
              No tickets match this filter.
            </InlineNotice>
          ) : (
            <ul className="space-y-2" aria-label="Support tickets">
              {tickets.map((ticket) => (
                <li key={ticket.ticketCode}>
                  <button
                    type="button"
                    onClick={() => setSelected(ticket.ticketCode)}
                    aria-current={selected === ticket.ticketCode || undefined}
                    className={`w-full cursor-pointer rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] ${
                      selected === ticket.ticketCode
                        ? 'border-[var(--segment-border-accent)] bg-[var(--color-shell-surface-elevated)]'
                        : 'border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] hover:border-[var(--segment-border-accent)]'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <TicketCodeChip code={ticket.ticketCode} />
                      <SupportPriorityBadge priority={ticket.priority} />
                    </div>
                    <p className="mt-1.5 text-[13.5px] font-semibold text-[var(--color-shell-text)]">
                      {ticket.subject}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-[var(--color-shell-text-muted)]">
                      <SupportStatusBadge status={ticket.status} />
                      <span>{supportCategoryLabel(ticket.category)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="capitalize">{ticket.requesterRole}</span>
                      <span aria-hidden="true">·</span>
                      <span>{relativeTime(ticket.updatedAt)}</span>
                      {!ticket.assignedAdminId && (
                        <span className="rounded-full border border-[var(--color-shell-warning)]/40 px-1.5 text-[var(--color-shell-warning)]">
                          Unassigned
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Ticket detail" className="min-w-0">
          {selected ? (
            <AdminTicketDetail
              ticketCode={selected}
              onChanged={loadQueue}
              onClose={() => setSelected(null)}
            />
          ) : (
            <SectionCard as="h2" className="min-h-[280px]">
              <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-center">
                <LifeBuoy className="h-8 w-8 text-[var(--color-shell-text-subtle)]" aria-hidden="true" />
                <p className="mt-3 text-[14px] font-semibold text-[var(--color-shell-text)]">Select a ticket</p>
                <p className="mt-1 max-w-sm text-[13px] text-[var(--color-shell-text-muted)]">
                  Pick a ticket from the queue to read the conversation, add an internal note, and resolve it.
                </p>
              </div>
            </SectionCard>
          )}
        </section>
      </div>
    </div>
  );
};

/** Real counts from the database. Nothing here is a fabricated number. */
const QueueMetrics: React.FC<{ metrics: SupportMetrics | null }> = ({ metrics }) => {
  if (!metrics) return null;

  const tiles = [
    { label: 'Open', value: metrics.open },
    { label: 'In Progress', value: metrics.inProgress },
    { label: 'Waiting', value: metrics.waitingForUser },
    { label: 'Urgent', value: metrics.urgent },
    { label: 'Resolved today', value: metrics.resolvedToday },
  ];

  return (
    <dl className="flex flex-wrap items-center gap-x-5 gap-y-2" aria-label="Support queue totals">
      {tiles.map((tile) => (
        <div key={tile.label} className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-shell-text-subtle)]">
            {tile.label}
          </dt>
          <dd className="text-lg font-bold tabular-nums text-[var(--color-shell-text)]">{tile.value}</dd>
        </div>
      ))}
    </dl>
  );
};

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

const AdminTicketDetail: React.FC<{
  ticketCode: string;
  onChanged: () => void;
  onClose: () => void;
}> = ({ ticketCode, onChanged, onClose }) => {
  const [detail, setDetail] = useState<SupportTicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const [resolution, setResolution] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDetail(await getSupportTicket(ticketCode));
      setError(null);
    } catch (err) {
      setError(err instanceof SupportApiError ? err.message : 'We could not load that ticket.');
    } finally {
      setLoading(false);
    }
  }, [ticketCode]);

  useEffect(() => {
    setReply('');
    setNote('');
    setResolution('');
    void load();
  }, [load]);

  // Same polling cadence as the user view. An open ticket is live work, and the
  // existing notification surface is polling-based, so this adds no second
  // transport.
  useEffect(() => {
    if (!detail || !isSupportTicketReplyable(detail.ticket.status)) return;
    const timer = setInterval(() => void load(), 20000);
    return () => clearInterval(timer);
  }, [detail, load]);

  /** Wraps an admin action so failure surfaces once and success reloads. */
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      await load();
      onChanged();
      return true;
    } catch (err) {
      setActionError(err instanceof SupportApiError ? err.message : 'That action could not be completed.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingState message={`Loading ${ticketCode}`} />;
  if (error) return <ErrorState title="We could not open that ticket" message={error} onRetry={load} />;
  if (!detail) return null;

  const { ticket, messages, attachments, auditEvents, booking, payment } = detail;
  const publicMessages = messages.filter((m) => !m.isInternal);
  const internalNotes = messages.filter((m) => m.isInternal);
  const transitions = SUPPORT_STATUS_TRANSITIONS[ticket.status] ?? [];

  return (
    <div className="space-y-5">
      <SectionCard
        as="h2"
        title={ticket.subject}
        aside={
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <TicketCodeChip code={ticket.ticketCode} />
          <SupportStatusBadge status={ticket.status} />
          <SupportPriorityBadge priority={ticket.priority} />
        </div>

        <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-3">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-shell-text-subtle)]">
              Requester
            </dt>
            <dd className="mt-1 text-[13.5px] font-medium text-[var(--color-shell-text)]">
              {ticket.requesterName ?? '—'}
              <span className="block text-[12px] font-normal text-[var(--color-shell-text-muted)]">
                {ticket.requesterEmail} · <span className="capitalize">{ticket.requesterRole}</span>
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-shell-text-subtle)]">
              Category
            </dt>
            <dd className="mt-1 text-[13.5px] font-medium text-[var(--color-shell-text)]">
              {supportCategoryLabel(ticket.category)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-shell-text-subtle)]">
              Opened
            </dt>
            <dd className="mt-1 text-[13.5px] font-medium text-[var(--color-shell-text)]">
              {formatTicketDate(ticket.createdAt)}
              <span className="block text-[12px] font-normal text-[var(--color-shell-text-muted)]">
                updated {relativeTime(ticket.updatedAt)}
              </span>
            </dd>
          </div>
        </dl>

        {(booking || payment) && (
          <div className="mt-4 rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-shell-text-subtle)]">
              Context
            </p>
            {booking && (
              <p className="mt-1.5 text-[13px] text-[var(--color-shell-text)]">
                Booking <span className="font-mono text-[12.5px]">{booking.bookingCode}</span> ·{' '}
                {booking.status.replace(/_/g, ' ').toLowerCase()} · {formatInr(booking.amountInr)} ·{' '}
                {new Date(booking.startTime).toLocaleString('en-IN')}
              </p>
            )}
            {payment && (
              <p className="mt-1.5 text-[13px] text-[var(--color-shell-text)]">
                Payment {formatInr(payment.amountInr)} · {payment.status.replace(/_/g, ' ').toLowerCase()}
                {payment.refundStatus ? ` · refund ${payment.refundStatus.toLowerCase()}` : ''}
                {payment.refundAmountInr ? ` (${formatInr(payment.refundAmountInr)})` : ''}
              </p>
            )}
            {payment?.manualRefundRequired && (
              <p className="mt-1.5 text-[12.5px] text-[var(--color-shell-text-muted)]">
                This manual payment has a refund awaiting completion. Settle it in Payments, not here: a
                support ticket carries no authority to move money.
              </p>
            )}
          </div>
        )}
      </SectionCard>

      {/* ---- Operational actions ------------------------------------------ */}
      <SectionCard as="h2" title="Actions">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-0 text-[12px] font-semibold text-[var(--color-shell-text)]">
            Status
            <select
              value={ticket.status}
              disabled={busy || transitions.length === 0}
              onChange={(e) =>
                void run(() =>
                  updateSupportTicket(ticket.ticketCode, {
                    status: e.target.value as Exclude<SupportTicketStatus, 'RESOLVED'>,
                  }),
                )
              }
              className="mt-1 block min-h-[36px] rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] px-2.5 text-[13px] font-medium text-[var(--color-shell-text)] disabled:opacity-50"
            >
              {transitions.length === 0 ? (
                <option value={ticket.status}>{supportStatusPresentation(ticket.status).label}</option>
              ) : (
                transitions.map((next) => (
                  <option key={next} value={next}>
                    {supportStatusPresentation(next).label}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="min-w-0 text-[12px] font-semibold text-[var(--color-shell-text)]">
            Priority
            <select
              value={ticket.priority}
              disabled={busy}
              onChange={(e) =>
                void run(() =>
                  updateSupportTicket(ticket.ticketCode, {
                    priority: e.target.value as (typeof SUPPORT_TICKET_PRIORITIES)[number],
                  }),
                )
              }
              className="mt-1 block min-h-[36px] rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] px-2.5 text-[13px] font-medium text-[var(--color-shell-text)] disabled:opacity-50"
            >
              {SUPPORT_TICKET_PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {supportPriorityPresentation(value).label}
                </option>
              ))}
            </select>
          </label>

          <Button
            variant="outline"
            size="sm"
            disabled={busy || !ticket.assignedAdminId}
            onClick={() => void run(() => updateSupportTicket(ticket.ticketCode, { assignedAdminId: null }))}
          >
            Unassign
          </Button>
        </div>
        <p className="mt-2 text-[11.5px] text-[var(--color-shell-text-subtle)]">
          Priority and status changes are written to the ticket's audit trail. RESOLVED is not a status
          option here: resolving needs a resolution message, below.
        </p>
      </SectionCard>

      {/* ---- Conversation -------------------------------------------------- */}
      <SectionCard as="h2" title="Conversation" aria-label="Public conversation">
        <ol className="space-y-3">
          {publicMessages.map((msg) => (
            <li
              key={msg.id}
              className={`rounded-xl border p-3 ${
                msg.senderRole === 'admin'
                  ? 'border-[var(--segment-border-accent)] bg-[var(--color-shell-surface-elevated)]'
                  : 'border-[var(--color-shell-border)] bg-[var(--color-shell-surface)]'
              }`}
            >
              <div className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-[var(--color-shell-text-subtle)]">
                <span className="font-semibold text-[var(--color-shell-text)]">
                  {msg.senderRole === 'admin' ? 'Support (admin)' : `${msg.senderRole} · ${ticket.requesterName ?? 'user'}`}
                </span>
                <span aria-hidden="true">·</span>
                <time dateTime={msg.createdAt}>{relativeTime(msg.createdAt)}</time>
              </div>
              <p className="mt-1.5 text-[13.5px] leading-relaxed whitespace-pre-wrap text-[var(--color-shell-text)]">
                {msg.message}
              </p>
            </li>
          ))}
        </ol>

        {attachments.length > 0 && (
          <ul className="mt-4 space-y-1 border-t border-[var(--color-shell-border)] pt-3" aria-label="Attachments">
            {attachments.map((file) => (
              <li key={file.id} className="flex items-center gap-2 text-[12.5px]">
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-[var(--color-shell-text-subtle)]" aria-hidden="true" />
                <AdminAttachmentLink ticketCode={ticket.ticketCode} attachmentId={file.id} fileName={file.fileName} />
              </li>
            ))}
          </ul>
        )}

        {isSupportTicketReplyable(ticket.status) ? (
          <form
            className="mt-5 space-y-2.5 border-t border-[var(--color-shell-border)] pt-4"
            onSubmit={(event) => {
              event.preventDefault();
              const text = reply.trim();
              if (!text) return;
              void run(async () => {
                await replyToSupportTicket(ticket.ticketCode, text);
                setReply('');
              });
            }}
          >
            <Textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={3}
              maxLength={4000}
              aria-label="Public reply to the user"
              placeholder="Reply to the user — they will see this."
            />
            <Button type="submit" size="sm" disabled={busy || reply.trim() === ''}>
              <Send className="h-4 w-4" aria-hidden="true" />
              Send reply
            </Button>
          </form>
        ) : (
          <p className="mt-4 flex items-center gap-1.5 border-t border-[var(--color-shell-border)] pt-4 text-[12.5px] text-[var(--color-shell-text-muted)]">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            This ticket is {supportStatusPresentation(ticket.status).label.toLowerCase()} and takes no new
            public reply.
          </p>
        )}
      </SectionCard>

      {/* ---- Internal notes ------------------------------------------------ */}
      <SectionCard as="h2" title="Internal notes" aria-label="Internal notes">
        <p className="mb-3 flex items-center gap-1.5 text-[12px] text-[var(--color-shell-text-muted)]">
          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Visible to admins only. Never returned by any user-facing endpoint.
        </p>

        {internalNotes.length > 0 ? (
          <ol className="mb-4 space-y-2.5">
            {internalNotes.map((msg) => (
              <li key={msg.id} className="rounded-xl border border-dashed border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] p-3">
                <div className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-[var(--color-shell-text-subtle)]">
                  <span className="font-semibold text-[var(--color-shell-text)]">Internal note</span>
                  <span aria-hidden="true">·</span>
                  <time dateTime={msg.createdAt}>{relativeTime(msg.createdAt)}</time>
                </div>
                <p className="mt-1.5 text-[13.5px] leading-relaxed whitespace-pre-wrap text-[var(--color-shell-text)]">
                  {msg.message}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mb-4 text-[12.5px] text-[var(--color-shell-text-subtle)]">No internal notes yet.</p>
        )}

        <form
          className="space-y-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            const text = note.trim();
            if (!text) return;
            void run(async () => {
              await addInternalNote(ticket.ticketCode, text);
              setNote('');
            });
          }}
        >
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={4000}
            aria-label="New internal note"
            placeholder="Checked the gateway refund event; awaiting confirmation."
          />
          <Button type="submit" variant="outline" size="sm" disabled={busy || note.trim() === ''}>
            Add internal note
          </Button>
        </form>
      </SectionCard>

      {/* ---- Resolve -------------------------------------------------------- */}
      <SectionCard as="h2" title="Resolve">
        <form
          className="space-y-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            const text = resolution.trim();
            if (text.length < 5) return;
            void run(async () => {
              await resolveSupportTicket(ticket.ticketCode, text);
              setResolution('');
            });
          }}
        >
          <p className="text-[12.5px] text-[var(--color-shell-text-muted)]">
            The resolution is posted as a public reply and is what the user reads as the outcome. It is
            required.
          </p>
          <Textarea
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            rows={3}
            maxLength={4000}
            aria-label="Resolution message for the user"
            placeholder="Your refund has been confirmed and should appear according to the payment provider's processing timeline."
          />
          <Button type="submit" size="sm" disabled={busy || resolution.trim().length < 5}>
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Resolve ticket
          </Button>
        </form>
      </SectionCard>

      {actionError && <InlineNotice tone="danger" role="alert" icon={LifeBuoy}>{actionError}</InlineNotice>}

      {/* ---- Audit trail ---------------------------------------------------- */}
      {auditEvents.length > 0 && (
        <SectionCard as="h2" title="History" aria-label="Ticket audit trail">
          <ol className="space-y-1.5">
            {auditEvents.map((event) => (
              <li key={event.id} className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                <span className="font-mono text-[var(--color-shell-text-muted)]">{event.eventType}</span>
                <span aria-hidden="true">·</span>
                <time dateTime={event.createdAt} className="text-[var(--color-shell-text-subtle)]">
                  {formatTicketDate(event.createdAt)}
                </time>
                {typeof event.metadata?.to === 'string' && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-[var(--color-shell-text-muted)]">{event.metadata.to}</span>
                  </>
                )}
              </li>
            ))}
          </ol>
        </SectionCard>
      )}
    </div>
  );
};

/** Admin attachment link: a short-lived signed URL, never the storage path. */
const AdminAttachmentLink: React.FC<{
  ticketCode: string;
  attachmentId: string;
  fileName: string;
}> = ({ ticketCode, attachmentId, fileName }) => {
  const [href, setHref] = useState<string | null>(null);

  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="font-medium text-[var(--color-shell-text)] underline">
        {fileName}
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={async () => {
        const { getSupportAttachmentUrl } = await import('@/src/lib/supportService');
        try {
          setHref(await getSupportAttachmentUrl(ticketCode, attachmentId));
        } catch {
          // Nothing useful to show an admin here; the link simply does not resolve.
        }
      }}
      className="cursor-pointer font-medium text-[var(--color-shell-text)] underline underline-offset-2"
    >
      View {fileName}
    </button>
  );
};

export default AdminSupportPage;