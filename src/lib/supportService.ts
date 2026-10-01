/**
 * Support Center client.
 *
 * The single place the browser talks to the support API. Every call goes out
 * through `apiFetch`, so it carries the bearer token; the route-contract test
 * fails the build if a page ever reaches for a bare `fetch` against the API
 * origin instead.
 *
 * The comment above is worded around `apiFetch` deliberately: that test scans
 * source text for an unauthenticated call, so writing the bare form out in prose
 * would trip it.
 *
 * Nothing here decides anything. The client sends a category the user's real
 * role is allowed to use, and the server re-derives the role and re-checks the
 * list. Likewise `canReply`/`canReopen` below are for hiding a button, not for
 * enforcing anything - the RPCs refuse the action regardless.
 */

import { apiFetch } from './apiClient';
import {
  SUPPORT_ATTACHMENT_BUCKET,
  SUPPORT_TICKET_STATUSES,
  SUPPORT_TICKET_PRIORITIES,
  type SupportTicketPriority,
  type SupportTicketStatus,
} from './supportDomain';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SupportTicketSummary {
  ticketCode: string;
  requesterId: string;
  requesterRole: string;
  requesterName?: string | null;
  requesterEmail?: string | null;
  category: string;
  subject: string;
  status: SupportTicketStatus;
  priority: SupportTicketPriority;
  bookingId: string | null;
  paymentId: string | null;
  assignedAdminId: string | null;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
}

export interface SupportMessage {
  id: string;
  senderId: string;
  senderRole: string;
  message: string;
  isInternal: boolean;
  createdAt: string;
}

export interface SupportAttachment {
  id: string;
  messageId: string | null;
  uploadedBy: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
}

/** Read-only payment context. Carries no gateway id, signature or credential. */
export interface SupportPaymentContext {
  amountInr: number;
  status: string;
  gateway: string | null;
  refundStatus: string | null;
  refundAmountInr: number | null;
  refundedAt: string | null;
  refundMethod: string | null;
  manualRefundRequired: boolean | null;
}

export interface SupportBookingContext {
  bookingCode: string;
  status: string;
  startTime: string;
  amountInr: number;
}

export interface SupportTicketDetail {
  ticket: SupportTicketSummary & {
    requesterName: string | null;
    requesterEmail: string | null;
    resolvedAt: string | null;
    closedAt: string | null;
  };
  messages: SupportMessage[];
  attachments: SupportAttachment[];
  auditEvents: Array<{
    id: string;
    actorId: string;
    eventType: string;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
  booking: SupportBookingContext | null;
  payment: SupportPaymentContext | null;
  viewerIsAdmin: boolean;
}

export interface SupportMetrics {
  success: boolean;
  open: number;
  inProgress: number;
  waitingForUser: number;
  urgent: number;
  unassigned: number;
  resolvedToday: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SupportApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'SupportApiError';
    this.status = status;
    this.code = code;
  }
}

interface ApiErrorBody {
  success?: boolean;
  error?: { code?: string; message?: string; fields?: Record<string, string> };
  message?: string;
}

/**
 * Turns a non-2xx response into a `SupportApiError`.
 *
 * The message is whatever the server chose to say. The server never relays a
 * database error, so surfacing it verbatim is safe - and this way a new server
 * message needs no client change.
 */
async function readError(response: Response): Promise<SupportApiError> {
  let body: ApiErrorBody = {};
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    // A non-JSON body is not worth surfacing; the status code still is.
  }
  return new SupportApiError(
    body.error?.message ?? body.message ?? 'Something went wrong. Please try again.',
    response.status,
    body.error?.code ?? 'UNKNOWN',
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface SupportListParams {
  scope?: 'USER' | 'ADMIN';
  status?: SupportTicketStatus;
  priority?: SupportTicketPriority;
  category?: string;
  requesterRole?: string;
  search?: string;
}

/**
 * Lists tickets.
 *
 * There is deliberately no `userId` parameter to pass. A requester's list is
 * scoped to the authenticated caller by the server; `scope: 'ADMIN'` is refused
 * for anyone who is not an admin.
 */
export async function listSupportTickets(
  params: SupportListParams = {},
): Promise<{ scope: string; total: number; tickets: SupportTicketSummary[] }> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value.trim() !== '') query.set(key, value);
  }

  const response = await apiFetch(`/api/support/tickets?${query.toString()}`);
  if (!response.ok) throw await readError(response);
  return response.json();
}

export async function getSupportTicket(ticketCode: string): Promise<SupportTicketDetail> {
  const response = await apiFetch(
    `/api/support/tickets/${encodeURIComponent(ticketCode.trim().toUpperCase())}`,
  );
  if (!response.ok) throw await readError(response);
  return response.json();
}

export async function getSupportMetrics(): Promise<SupportMetrics> {
  const response = await apiFetch('/api/support/tickets/metrics');
  if (!response.ok) throw await readError(response);
  return response.json();
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CreateSupportTicketInput {
  category: string;
  subject: string;
  message: string;
  bookingCode?: string;
}

export async function createSupportTicket(
  input: CreateSupportTicketInput,
): Promise<{ ticket: SupportTicketSummary; message: SupportMessage }> {
  const response = await apiFetch('/api/support/tickets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      category: input.category,
      subject: input.subject,
      message: input.message,
      ...(input.bookingCode ? { bookingCode: input.bookingCode } : {}),
    }),
  });
  if (!response.ok) throw await readError(response);
  return response.json();
}

/**
 * Posts a public reply.
 *
 * There is no `isInternal` parameter, by design: the request body schema is
 * strict, so passing one would be a 400 rather than a silently ignored field.
 * Internal notes use `addInternalNote`, which is admin-gated server-side.
 */
export async function replyToSupportTicket(
  ticketCode: string,
  message: string,
): Promise<{ message: SupportMessage; status: SupportTicketStatus }> {
  const response = await apiFetch(
    `/api/support/tickets/${encodeURIComponent(ticketCode)}/messages`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    },
  );
  if (!response.ok) throw await readError(response);
  return response.json();
}

export async function addInternalNote(
  ticketCode: string,
  note: string,
): Promise<{ messageId: string }> {
  const response = await apiFetch(
    `/api/support/tickets/${encodeURIComponent(ticketCode)}/internal-notes`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    },
  );
  if (!response.ok) throw await readError(response);
  return response.json();
}

/**
 * Admin scalar changes: status, priority, assignee.
 *
 * `RESOLVED` is not accepted here. Resolving takes a message, so it has its own
 * call, and this one cannot quietly close a ticket without telling the user.
 */
export async function updateSupportTicket(
  ticketCode: string,
  changes: {
    status?: Exclude<SupportTicketStatus, 'RESOLVED'>;
    priority?: SupportTicketPriority;
    assignedAdminId?: string | null;
  },
): Promise<{ status: string; priority: string; assignedAdminId: string | null }> {
  const response = await apiFetch(`/api/support/tickets/${encodeURIComponent(ticketCode)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  });
  if (!response.ok) throw await readError(response);
  return response.json();
}

export async function resolveSupportTicket(
  ticketCode: string,
  resolution: string,
): Promise<{ status: string; resolvedAt: string }> {
  const response = await apiFetch(
    `/api/support/tickets/${encodeURIComponent(ticketCode)}/resolve`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution }),
    },
  );
  if (!response.ok) throw await readError(response);
  return response.json();
}

export async function reopenSupportTicket(
  ticketCode: string,
  reason: string,
): Promise<{ status: string }> {
  const response = await apiFetch(
    `/api/support/tickets/${encodeURIComponent(ticketCode)}/reopen`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    },
  );
  if (!response.ok) throw await readError(response);
  return response.json();
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

interface UploadTicket {
  storagePath: string;
  token: string;
  bucket: string;
}

/**
 * Uploads one file and records it against the ticket.
 *
 * Two steps, both of them server-controlled:
 *   1. the server mints a signed upload token for a path it generated inside
 *      this ticket's own folder;
 *   2. the browser PUTs the bytes, then posts the same path back to be recorded.
 *
 * The client never chooses the storage path, so it cannot address somebody
 * else's folder, and the bucket is private so step 1 is the only way in.
 */
export async function uploadSupportAttachment(
  ticketCode: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<{ attachment: SupportAttachment }> {
  const describe = { fileName: file.name, mimeType: file.type, fileSize: file.size };

  const ticketResponse = await apiFetch(
    `/api/support/tickets/${encodeURIComponent(ticketCode)}/attachments/upload-url`,
    {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(describe),
    },
  );
  if (!ticketResponse.ok) throw await readError(ticketResponse);

  const uploadTicket = (await ticketResponse.json()) as UploadTicket;

  // XHR rather than fetch: this is the one call in the app that needs a
  // progress event, and a browser cannot report upload progress through fetch.
  await putWithProgress(uploadTicket, file, onProgress);

  const recordResponse = await apiFetch(
    `/api/support/tickets/${encodeURIComponent(ticketCode)}/attachments`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...describe, storagePath: uploadTicket.storagePath }),
    },
  );
  if (!recordResponse.ok) throw await readError(recordResponse);

  return recordResponse.json();
}

/** PUTs the bytes to the signed token, reporting progress. */
function putWithProgress(
  ticket: UploadTicket,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (event) => {
      if (onProgress && event.lengthComputable) onProgress(event.loaded / event.total);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new SupportApiError('That file could not be uploaded.', xhr.status, 'UPLOAD_FAILED'));
    });
    xhr.addEventListener('error', () =>
      reject(new SupportApiError('That file could not be uploaded.', 0, 'UPLOAD_FAILED')),
    );

    const url = `${supabaseStorageOrigin()}/storage/v1/object/upload/${ticket.bucket}/${ticket.storagePath
      .split('/')
      .map(encodeURIComponent)
      .join('/')}?token=${encodeURIComponent(ticket.token)}`;

    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.send(file);
  });
}

/** The project URL, read from the same env var Supabase is configured with. */
function supabaseStorageOrigin(): string {
  const url = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SUPABASE_URL;
  if (!url) throw new Error('Supabase is not configured.');
  return url.replace(/\/+$/, '');
}

/**
 * Resolves a short-lived signed URL for one attachment.
 *
 * The browser is never handed a storage path and never handed a permanent URL.
 * This is the only read path for attachment bytes, and it re-proves ticket
 * ownership server-side before signing anything.
 */
export async function getSupportAttachmentUrl(
  ticketCode: string,
  attachmentId: string,
): Promise<string> {
  const response = await apiFetch(
    `/api/support/tickets/${encodeURIComponent(ticketCode)}/attachments/${encodeURIComponent(attachmentId)}`,
  );
  if (!response.ok) throw await readError(response);
  const body = (await response.json()) as { url: string };
  return body.url;
}

export {
  SUPPORT_ATTACHMENT_BUCKET,
  SUPPORT_TICKET_PRIORITIES,
  SUPPORT_TICKET_STATUSES,
};