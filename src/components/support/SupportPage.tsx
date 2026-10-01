import React, { useCallback, useEffect, useState } from 'react';
import { LifeBuoy, Plus, Send, Paperclip, RotateCcw } from 'lucide-react';
import { PageHeading } from '@/src/components/booking/PageHeading';
import { InlineNotice, SectionCard } from '@/src/components/booking/StatePanel';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { Textarea } from '@/src/components/ui/Textarea';
import { SupportPriorityBadge, SupportStatusBadge, TicketCodeChip } from '@/src/components/support/SupportBadges';
import { LoadingState } from '@/src/components/shared/LoadingState';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import {
  SUPPORT_ATTACHMENT_MAX_BYTES,
  SUPPORT_ATTACHMENT_MIME_TYPES,
  SUPPORT_MESSAGE_MAX,
  SUPPORT_MESSAGE_MIN,
  SUPPORT_SUBJECT_MAX,
  SUPPORT_SUBJECT_MIN,
  SUPPORT_TICKET_CATEGORIES,
  formatTicketDate,
  isSupportTicketReplyable,
  isSupportTicketReopenable,
  isValidBookingCode,
  relativeTime,
  supportCategoryLabel,
} from '@/src/lib/supportDomain';
import {
  SupportApiError,
  createSupportTicket,
  getSupportTicket,
  listSupportTickets,
  reopenSupportTicket,
  replyToSupportTicket,
  uploadSupportAttachment,
  type SupportTicketDetail,
  type SupportTicketSummary,
} from '@/src/lib/supportService';

/**
 * Help & Support for a seeker or a mentor.
 *
 * A real ticket list, a real conversation, and a real resolution - not a
 * contact form. Mounted at `/seeker/support` and `/mentor/support`, and as the
 * Settings -> Help & Support tab for both.
 *
 * Security-relevant behaviour, all of it enforced again by the database:
 *   - identity comes from the session, so there is no field for a user id;
 *   - the category list is filtered by the caller's real role;
 *   - a booking reference is validated against the caller's OWN bookings by the
 *     server, and is a human code rather than a UUID;
 *   - "Reply" and "Reopen" are hidden when the ticket will not accept them, but
 *     the server refuses those actions regardless.
 */

export interface SupportPageProps {
  /** Set when embedded in Settings, which already owns the page heading. */
  showHeading?: boolean;
  /** Pre-selected ticket, used when arriving from a notification link. */
  initialTicketCode?: string;
  /** A booking the user is already looking at, offered as context. */
  contextBookingCode?: string;
  contextBookingLabel?: string;
}

type View = { kind: 'list' } | { kind: 'ticket'; code: string } | { kind: 'new' };

export const SupportPage: React.FC<SupportPageProps> = ({
  showHeading = true,
  initialTicketCode,
  contextBookingCode,
  contextBookingLabel,
}) => {
  const { activeRole } = useAuth();
  const { currentPath } = useNavigation();
  const role = activeRole ?? 'seeker';

  // Support notifications deep-link as `/seeker/support?ticketCode=SK-...`.
  const query = new URLSearchParams(currentPath.split('?')[1] ?? '');
  const linkedTicketCode = initialTicketCode ?? query.get('ticketCode') ?? undefined;
  const linkedBookingCode = contextBookingCode ?? query.get('bookingCode') ?? undefined;

  const [view, setView] = useState<View>(
    linkedTicketCode ? { kind: 'ticket', code: linkedTicketCode } : { kind: 'list' },
  );
  const [tickets, setTickets] = useState<SupportTicketSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reloadList = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listSupportTickets();
      setTickets(result.tickets);
      setError(null);
    } catch (err) {
      setError(err instanceof SupportApiError ? err.message : 'We could not load your tickets.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view.kind === 'list') void reloadList();
  }, [view.kind, reloadList]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      {showHeading && (
        <PageHeading
          title="Help & Support"
          description="Raise a ticket and follow it here. Every reply is kept on the ticket, so nothing gets lost in an inbox."
          aside={
            view.kind !== 'new' ? (
              <Button onClick={() => setView({ kind: 'new' })} size="sm">
                <Plus className="h-4 w-4" aria-hidden="true" />
                New ticket
              </Button>
            ) : undefined
          }
        />
      )}

      {view.kind === 'list' && (
        <TicketList
          tickets={tickets}
          loading={loading}
          error={error}
          onRetry={reloadList}
          onOpen={(code) => setView({ kind: 'ticket', code })}
          onCreate={() => setView({ kind: 'new' })}
        />
      )}

      {view.kind === 'new' && (
        <NewTicketForm
          role={role}
          contextBookingCode={linkedBookingCode}
          contextBookingLabel={contextBookingLabel}
          onCancel={() => setView({ kind: 'list' })}
          onCreated={(code) => setView({ kind: 'ticket', code })}
        />
      )}

      {view.kind === 'ticket' && (
        <TicketConversation
          ticketCode={view.code}
          viewerRole={role}
          onBack={() => setView({ kind: 'list' })}
          onChanged={reloadList}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

const TicketList: React.FC<{
  tickets: SupportTicketSummary[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpen: (code: string) => void;
  onCreate: () => void;
}> = ({ tickets, loading, error, onRetry, onOpen, onCreate }) => {
  if (loading) return <LoadingState message="Loading your tickets" />;
  if (error) return <ErrorState title="We could not load your tickets" message={error} onRetry={onRetry} />;

  if (tickets.length === 0) {
    return (
      <EmptyState
        title="No support tickets yet"
        description="If something is not working, raise a ticket and we will reply here."
        icon={LifeBuoy}
        actionLabel="Create your first ticket"
        onAction={onCreate}
      />
    );
  }

  return (
    <ul className="space-y-3" aria-label="Your support tickets">
      {tickets.map((ticket) => (
        <li key={ticket.ticketCode}>
          <button
            type="button"
            onClick={() => onOpen(ticket.ticketCode)}
            className="w-full cursor-pointer rounded-2xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-4 text-left shadow-xs transition-colors hover:border-[var(--segment-border-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] focus-visible:ring-offset-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <TicketCodeChip code={ticket.ticketCode} />
              <div className="flex flex-wrap items-center gap-1.5">
                <SupportStatusBadge status={ticket.status} />
                <SupportPriorityBadge priority={ticket.priority} />
              </div>
            </div>
            <p className="mt-2 text-[14px] font-semibold text-[var(--color-shell-text)]">{ticket.subject}</p>
            <p className="mt-1 text-[12.5px] text-[var(--color-shell-text-muted)]">
              {supportCategoryLabel(ticket.category)} · updated {relativeTime(ticket.updatedAt) || formatTicketDate(ticket.updatedAt)}
            </p>
          </button>
        </li>
      ))}
    </ul>
  );
};

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

const NewTicketForm: React.FC<{
  role: 'seeker' | 'mentor' | 'admin';
  contextBookingCode?: string;
  contextBookingLabel?: string;
  onCancel: () => void;
  onCreated: (code: string) => void;
}> = ({ role, contextBookingCode, contextBookingLabel, onCancel, onCreated }) => {
  const categories = SUPPORT_TICKET_CATEGORIES[role] ?? SUPPORT_TICKET_CATEGORIES.seeker;
  const [category, setCategory] = useState<string>(categories[0]);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [bookingCode, setBookingCode] = useState(contextBookingCode ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Context from a booking detail page is pre-filled, but the field stays
  // editable: a seeker may raise a ticket about something that is not the
  // booking they came from.
  useEffect(() => {
    if (contextBookingCode) setBookingCode(contextBookingCode);
  }, [contextBookingCode]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await createSupportTicket({
        category,
        subject: subject.trim(),
        message: message.trim(),
        ...(bookingCode.trim() ? { bookingCode: bookingCode.trim().toUpperCase() } : {}),
      });
      onCreated(result.ticket.ticketCode);
    } catch (err) {
      setError(err instanceof SupportApiError ? err.message : 'We could not create that ticket.');
    } finally {
      setBusy(false);
    }
  };

  const bookingCodeInvalid = bookingCode.trim() !== '' && !isValidBookingCode(bookingCode);

  return (
    <SectionCard
      title="Raise a support ticket"
      description="Tell us what happened and we will reply on this ticket."
      icon={LifeBuoy}
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="support-category" className="mb-1.5 block text-[13px] font-semibold text-[var(--color-shell-text)]">
            Category
          </label>
          <select
            id="support-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="min-h-[40px] w-full rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] px-3 text-[14px] text-[var(--color-shell-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)]"
          >
            {categories.map((value) => (
              <option key={value} value={value}>
                {supportCategoryLabel(value)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="support-subject" className="mb-1.5 block text-[13px] font-semibold text-[var(--color-shell-text)]">
            Subject
          </label>
          <Input
            id="support-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
            minLength={SUPPORT_SUBJECT_MIN}
            maxLength={SUPPORT_SUBJECT_MAX}
            placeholder="Payment deducted but booking cancelled"
          />
        </div>

        <div>
          <label htmlFor="support-message" className="mb-1.5 block text-[13px] font-semibold text-[var(--color-shell-text)]">
            What happened?
          </label>
          <Textarea
            id="support-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            required
            minLength={SUPPORT_MESSAGE_MIN}
            maxLength={SUPPORT_MESSAGE_MAX}
            rows={6}
            placeholder="Include dates, amounts and anything you have already tried."
          />
          <p className="mt-1 text-[11.5px] text-[var(--color-shell-text-subtle)]">
            {SUPPORT_MESSAGE_MIN}–{SUPPORT_MESSAGE_MAX} characters. The more detail, the faster we can help.
          </p>
        </div>

        <div>
          <label htmlFor="support-booking" className="mb-1.5 block text-[13px] font-semibold text-[var(--color-shell-text)]">
            Booking reference <span className="font-normal text-[var(--color-shell-text-subtle)]">(optional)</span>
          </label>
          <Input
            id="support-booking"
            value={bookingCode}
            onChange={(e) => setBookingCode(e.target.value)}
            placeholder="BK-1234"
            aria-invalid={bookingCodeInvalid || undefined}
            aria-describedby={bookingCodeInvalid ? 'support-booking-error' : 'support-booking-help'}
          />
          {bookingCodeInvalid ? (
            <p id="support-booking-error" className="mt-1 text-[12px] font-medium text-[var(--color-shell-error)]">
              Use the booking code from your booking, for example BK-1234.
            </p>
          ) : (
            <p id="support-booking-help" className="mt-1 text-[11.5px] text-[var(--color-shell-text-subtle)]">
              {contextBookingLabel
                ? `Pre-filled from ${contextBookingLabel}. We will only accept a booking that belongs to you.`
                : 'We will only accept a booking that belongs to you.'}
            </p>
          )}
        </div>

        {error && <InlineNotice tone="danger" role="alert" icon={LifeBuoy}>{error}</InlineNotice>}

        <div className="flex flex-wrap gap-2.5">
          <Button type="submit" disabled={busy || bookingCodeInvalid}>
            {busy ? 'Creating ticket…' : 'Create ticket'}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      </form>
    </SectionCard>
  );
};

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

const TicketConversation: React.FC<{
  ticketCode: string;
  viewerRole: 'seeker' | 'mentor' | 'admin';
  onBack: () => void;
  onChanged: () => void;
}> = ({ ticketCode, viewerRole, onBack, onChanged }) => {
  const [detail, setDetail] = useState<SupportTicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

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
    void load();
  }, [load]);

  // Poll while the ticket is open. The existing notification surface is
  // polling-based too, so this adds no second transport: messages are always
  // persisted correctly, and a stale view self-corrects within one tick.
  useEffect(() => {
    if (!detail || !isSupportTicketReplyable(detail.ticket.status)) return;
    const timer = setInterval(() => void load(), 20000);
    return () => clearInterval(timer);
  }, [detail, load]);

  const sendReply = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    setActionError(null);
    try {
      await replyToSupportTicket(ticketCode, text);
      setDraft('');
      await load();
      onChanged();
    } catch (err) {
      setActionError(err instanceof SupportApiError ? err.message : 'We could not send that reply.');
    } finally {
      setSending(false);
    }
  };

  const reopen = async () => {
    setSending(true);
    setActionError(null);
    try {
      await reopenSupportTicket(ticketCode, 'This issue is not resolved.');
      await load();
      onChanged();
    } catch (err) {
      setActionError(err instanceof SupportApiError ? err.message : 'We could not reopen that ticket.');
    } finally {
      setSending(false);
    }
  };

  const attach = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setUploading(true);
    setActionError(null);
    try {
      await uploadSupportAttachment(ticketCode, file);
      await load();
    } catch (err) {
      setActionError(err instanceof SupportApiError ? err.message : 'That file could not be attached.');
    } finally {
      setUploading(false);
    }
  };

  if (loading) return <LoadingState message={`Loading ticket ${ticketCode}`} />;
  if (error) return <ErrorState title="We could not open that ticket" message={error} onRetry={load} />;
  if (!detail) return null;

  const { ticket, messages, attachments, booking, payment } = detail;
  const canReply = isSupportTicketReplyable(ticket.status);
  const canReopen = isSupportTicketReopenable(ticket.status);

  return (
    <div className="space-y-6">
      <PageHeading
        back={{ label: 'All tickets', onClick: onBack }}
        eyebrow={supportCategoryLabel(ticket.category)}
        title={ticket.subject}
        aside={
          <div className="flex flex-wrap items-center gap-1.5">
            <SupportStatusBadge status={ticket.status} />
            <SupportPriorityBadge priority={ticket.priority} />
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-[var(--color-shell-text-muted)]">
          <TicketCodeChip code={ticket.ticketCode} />
          <span>Opened {formatTicketDate(ticket.createdAt)}</span>
        </div>
      </PageHeading>

      {ticket.status === 'WAITING_FOR_USER' && (
        <InlineNotice tone="warning" title="Support is waiting for information from you">
          Reply below with what was asked for, and the ticket will go back into progress.
        </InlineNotice>
      )}

      {ticket.status === 'RESOLVED' && ticket.resolution && (
        <SectionCard title="Resolution" icon={LifeBuoy}>
          <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-[var(--color-shell-text)]">
            {ticket.resolution}
          </p>
        </SectionCard>
      )}

      {ticket.status === 'CLOSED' && (
        <InlineNotice tone="neutral" title="This ticket is closed">
          If the issue comes back, please raise a new ticket so we have a fresh record.
        </InlineNotice>
      )}

      {(booking || payment) && (
        <SectionCard title="Related booking and payment" as="h2">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {booking && (
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-shell-text-subtle)]">
                  Booking
                </dt>
                <dd className="mt-1 text-[14px] font-medium text-[var(--color-shell-text)]">
                  <span className="font-mono text-[13px]">{booking.bookingCode}</span> ·{' '}
                  {booking.status.replace(/_/g, ' ').toLowerCase()}
                </dd>
              </div>
            )}
            {payment && (
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-shell-text-subtle)]">
                  Payment
                </dt>
                <dd className="mt-1 text-[14px] font-medium text-[var(--color-shell-text)]">
                  {payment.status.replace(/_/g, ' ').toLowerCase()}
                  {payment.refundStatus ? ` · refund ${payment.refundStatus.toLowerCase()}` : ''}
                </dd>
              </div>
            )}
          </dl>
        </SectionCard>
      )}

      <SectionCard title="Conversation" aria-label="Ticket conversation">
        <ol className="space-y-4">
          {messages.map((msg) => {
            const fromAdmin = msg.senderRole === 'admin';
            const mine = msg.senderId === ticket.requesterId;
            return (
              <li
                key={msg.id}
                className={`rounded-xl border p-3.5 ${
                  fromAdmin
                    ? 'border-[var(--segment-border-accent)] bg-[var(--color-shell-surface-elevated)]'
                    : mine
                      ? 'ml-8 border-[var(--color-shell-border)] bg-[var(--color-shell-bg)]'
                      : 'border-[var(--color-shell-border)] bg-[var(--color-shell-surface)]'
                }`}
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-[var(--color-shell-text-subtle)]">
                  <span className="font-semibold text-[var(--color-shell-text)]">
                    {fromAdmin ? 'Suggest Key Support' : mine ? 'You' : msg.senderRole}
                  </span>
                  <span aria-hidden="true">·</span>
                  <time dateTime={msg.createdAt}>{relativeTime(msg.createdAt)}</time>
                </div>
                <p className="mt-1.5 text-[14px] leading-relaxed whitespace-pre-wrap text-[var(--color-shell-text)]">
                  {msg.message}
                </p>
              </li>
            );
          })}
        </ol>

        {attachments.length > 0 && (
          <ul className="mt-5 space-y-1.5 border-t border-[var(--color-shell-border)] pt-4" aria-label="Attachments">
            {attachments.map((file) => (
              <li key={file.id} className="flex items-center gap-2 text-[13px]">
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-[var(--color-shell-text-subtle)]" aria-hidden="true" />
                <AttachmentLink ticketCode={ticketCode} attachmentId={file.id} fileName={file.fileName} />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {actionError && <InlineNotice tone="danger" role="alert" icon={LifeBuoy}>{actionError}</InlineNotice>}

      {canReply && (
        <SectionCard title="Reply" aria-label="Reply to this ticket">
          <form onSubmit={sendReply} className="space-y-3">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={SUPPORT_MESSAGE_MAX}
              rows={4}
              required
              aria-label="Your reply"
              placeholder="Add anything that would help us resolve this."
            />
            <div className="flex flex-wrap items-center gap-2.5">
              <Button type="submit" disabled={sending || draft.trim() === ''}>
                <Send className="h-4 w-4" aria-hidden="true" />
                {sending ? 'Sending…' : 'Send'}
              </Button>

              <label className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)] focus-within:ring-2 focus-within:ring-[var(--color-shell-focus)]">
                <Paperclip className="h-4 w-4" aria-hidden="true" />
                {uploading ? 'Uploading…' : 'Attach a file'}
                <input
                  type="file"
                  className="sr-only"
                  accept={SUPPORT_ATTACHMENT_MIME_TYPES.join(',')}
                  disabled={uploading}
                  onChange={attach}
                />
              </label>
              <span className="text-[11.5px] text-[var(--color-shell-text-subtle)]">
                Image or PDF, up to {SUPPORT_ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB
              </span>
            </div>
          </form>
        </SectionCard>
      )}

      {canReopen && (
        <SectionCard title="Not resolved?" as="h2">
          <p className="text-[13px] leading-relaxed text-[var(--color-shell-text-muted)]">
            If the issue is still open, reopen this ticket and it goes straight back into the support queue.
          </p>
          <Button className="mt-3" variant="outline" onClick={reopen} disabled={sending}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Reopen ticket
          </Button>
        </SectionCard>
      )}
    </div>
  );
};

/**
 * An attachment link that fetches a short-lived signed URL on click.
 *
 * The storage path is never rendered and never linked directly: this asks the
 * server for a URL it will only mint for a caller that owns the ticket.
 */
const AttachmentLink: React.FC<{
  ticketCode: string;
  attachmentId: string;
  fileName: string;
}> = ({ ticketCode, attachmentId, fileName }) => {
  const [href, setHref] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    if (href) return;
    try {
      const { getSupportAttachmentUrl } = await import('@/src/lib/supportService');
      setHref(await getSupportAttachmentUrl(ticketCode, attachmentId));
    } catch {
      setError('We could not open that file.');
    }
  };

  if (error) return <span className="text-[var(--color-shell-error)]">{error}</span>;

  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="font-medium text-[var(--color-shell-text)] underline">
      {fileName}
    </a>
  ) : (
    <button
      type="button"
      onClick={open}
      className="cursor-pointer font-medium text-[var(--color-shell-text)] underline underline-offset-2"
    >
      View {fileName}
    </button>
  );
};

export default SupportPage;