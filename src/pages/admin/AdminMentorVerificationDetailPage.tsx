import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Send,
  FileImage,
  FileText as FileIcon,
  Shield,
  Download,
} from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { apiFetch } from '@/src/lib/apiClient';
import { useNavigation } from '@/src/context/NavigationContext';
import { useToast } from '@/src/context/ToastContext';
import { mailtoHref } from '@/src/lib/contact';
import { ShortId } from '@/src/components/shared/ShortId';
import { useMentorVerificationSync } from '@/src/hooks/useMentorVerificationSync';
import {
  canDispatchApproval,
  reconcileApproveConflict,
} from '@/src/lib/mentorApplicationApproval';
import type {
  AdminMentorApplicationDetailResponse,
  MentorApplicationDetailRow,
} from '@/src/types/database';

const getErrorMessage = (err: unknown, fallback: string): string => {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
};

/**
 * Application detail payload returned by
 * GET /api/admin/mentor-applications/:id.
 *
 * The applicant identity always comes from the `user_id` foreign key
 * (mentor_applications_user_id_fkey) - never from `reviewed_by`.
 */
type MentorApplication = MentorApplicationDetailRow;

const FILE_ICONS: Record<string, React.ElementType> = {
  'image/jpeg': FileImage,
  'image/png': FileImage,
  'image/webp': FileImage,
  'application/pdf': FileIcon,
};

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const REQUIRED_DOC_TYPES = ['identity_proof', 'qualification_proof'];

export const AdminMentorVerificationDetailPage: React.FC = () => {
  const { navigate, currentPath } = useNavigation();
  const toast = useToast();
  // Derived, not frozen in state: the Router renders this same component for
  // every `/admin/mentor-verification/<id>` path, so React reuses the instance
  // when the admin moves from one application straight to another. Capturing
  // the id once left the page showing (and approving) the previous application.
  const applicationId = useMemo(() => {
    const pathParts = currentPath.split('/');
    return pathParts[pathParts.length - 1] || '';
  }, [currentPath]);
  const [application, setApplication] = useState<MentorApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [docReviewLoading, setDocReviewLoading] = useState<string | null>(null);
  // ponytail: synchronous re-entry guard for the approve action. The button's
  // `disabled` prop is driven by async setState, so a fast double-click (or a
  // stale render under multi-tab/another-admin concurrency) can dispatch a
  // second POST before the DOM is actually inert. A ref is checked
  // synchronously and blocks the second invocation instantly.
  const approveInFlightRef = useRef(false);
  const rejectInFlightRef = useRef(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejectionReasonError, setRejectionReasonError] = useState<string | null>(null);

  // Guards against applying a response that has already been superseded, and
  // against writing state after the Router unmounted this component.
  const latestFetchIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * Reads the application from the server — the single source of truth for the
   * status shown on this page. No caller ever writes a status locally.
   *
   * `background: true` is used for revalidation (after an action, and when the
   * tab regains focus) so the already-rendered page updates in place. Blanking
   * to a skeleton there would hide the very transition the admin needs to see,
   * and would make a reconciliation look like a page reload.
   */
  const fetchApplication = useCallback(
    async (options?: { background?: boolean }) => {
      if (!applicationId) return undefined;
      const fetchId = ++latestFetchIdRef.current;
      if (!options?.background) setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/api/admin/mentor-applications/${applicationId}`);
        const data = (await res.json()) as Partial<AdminMentorApplicationDetailResponse> & {
          error?: { message?: string };
        };
        if (!res.ok || !data.success || !data.application) {
          throw new Error(data.error?.message || 'Failed to fetch application');
        }
        // A slower earlier request must never overwrite a newer one, but the
        // caller still gets this result so a 409 handler can reconcile on it.
        if (mountedRef.current && fetchId === latestFetchIdRef.current) {
          setApplication(data.application);
        }
        return data.application as MentorApplication;
      } catch (err) {
        if (mountedRef.current && fetchId === latestFetchIdRef.current) {
          setError(getErrorMessage(err, 'Failed to load application'));
          console.error('Failed to fetch application:', err);
        }
        return undefined;
      } finally {
        if (mountedRef.current && fetchId === latestFetchIdRef.current) setLoading(false);
      }
    },
    [applicationId],
  );

  useEffect(() => {
    fetchApplication();
  }, [fetchApplication]);

  // A stale page must reconcile on its own rather than waiting for the admin to
  // press Approve and eat a 409. Another tab or another admin can move this
  // application off pending_review at any time; refetching when the admin comes
  // back to this tab re-renders it as Approved and drops the Approve button.
  //
  // The hook covers focus/visibility/online/pageshow, a realtime event on this
  // application, its documents, the synchronised mentor profile/account, and an
  // authoritative refetch every time the channel re-joins. It replaced a local
  // focus/visibility listener so the two cannot both refetch on one resume.
  useMentorVerificationSync({
    scope: 'application-detail',
    applicationId,
    // Only meaningful once the applicant is known: the profile rows are
    // synchronised by the same transaction that decides this application.
    mentorId: application?.user_id ?? null,
    onInvalidate: () => {
      // Never race an in-flight mutation — its own revalidation is authoritative.
      if (approveInFlightRef.current || rejectInFlightRef.current) return;
      if (document.visibilityState === 'hidden') return;
      void fetchApplication({ background: true });
    },
  });

  const handleDocumentReview = async (docId: string, status: 'approved' | 'rejected', note?: string) => {
    if (docReviewLoading !== null) return;
    setDocReviewLoading(docId);
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/mentor-documents/${docId}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // `adminNote` is optional AND nullable on the API
        // (apiSchemas.mentorDocumentReview): null is how "no note" is sent.
        body: JSON.stringify({ status, adminNote: note ?? null }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        error?: { code?: string; message?: string; fields?: Record<string, string> };
      };
      if (!res.ok || !data.success) {
        // Prefer the server's own wording — a validation 400 carries a message
        // per field, and the top-level one names the first field that failed.
        const fieldDetail = data.error?.fields ? Object.values(data.error.fields)[0] : undefined;
        throw new Error(data.error?.message || fieldDetail || `Failed to ${status} document`);
      }
      await fetchApplication({ background: true });
      toast.success(`Document ${status === 'approved' ? 'approved' : 'rejected'}.`);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to review document'));
    } finally {
      setDocReviewLoading(null);
    }
  };

  const handleRejectDocument = (docId: string) => {
    const note = window.prompt('Rejection reason for this document:');
    if (note === null) return;
    if (!note.trim()) {
      setError('A rejection reason is required to reject a document.');
      return;
    }
    void handleDocumentReview(docId, 'rejected', note.trim());
  };

  const handleApproveApplication = async () => {
    // Ref guard: blocks a fast double-click / Enter / a second wired-up
    // listener from dispatching a concurrent POST before the `disabled` prop can
    // take effect on the next render.
    if (approveInFlightRef.current) return;
    approveInFlightRef.current = true;

    // The cached `application` may be stale (another tab/admin already moved it
    // off pending_review). Re-check the authoritative cached status before
    // mutating so we don't fire a POST the server is guaranteed to 409.
    if (!canDispatchApproval(application?.status)) {
      approveInFlightRef.current = false;
      return;
    }

    setActionLoading('approve');
    setError(null);
    const approvedDocs = application?.documents.filter((d) => d.status === 'approved');
    const approvedDocTypes = new Set(approvedDocs?.map((d) => d.document_type) || []);
    const missing = REQUIRED_DOC_TYPES.filter((t) => !approvedDocTypes.has(t));

    if (missing.length > 0) {
      setError(`All required documents must be approved before application approval. Missing: ${missing.join(', ')}`);
      approveInFlightRef.current = false;
      setActionLoading(null);
      return;
    }

    try {
      const res = await apiFetch(`/api/admin/mentor-applications/${applicationId}/approve`, {
        method: 'POST',
      });
      const data = (await res.json()) as { success?: boolean; error?: { code?: string; message?: string } };

      // 409 Conflict: this request lost the race — usually the second of a
      // double-click, or another admin/tab beat us to it. Re-read the
      // authoritative row and reconcile the UI to whatever the server says,
      // instead of surfacing the raw conflict text.
      if (res.status === 409) {
        const refreshed = await fetchApplication({ background: true });
        const reconciliation = reconcileApproveConflict(refreshed?.status, data.error?.message);
        if (reconciliation.kind === 'conflict') {
          // A genuine conflict that re-reading could not explain: keep the
          // server's own wording rather than hiding it.
          setError(reconciliation.message);
        } else {
          toast.info(reconciliation.message);
        }
        return;
      }

      if (!res.ok || !data.success) throw new Error(data.error?.message || 'Failed to approve application');
      await fetchApplication({ background: true });
      toast.success('Application approved. The mentor can now create gigs.');
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to approve application'));
    } finally {
      setActionLoading(null);
      approveInFlightRef.current = false;
    }
  };

  const handleRejectApplication = async () => {
    // Same synchronous guard as approve: the `disabled` prop is async, so a
    // second click before React commits would fire a duplicate reject.
    if (rejectInFlightRef.current) return;
    if (!rejectionReason.trim()) {
      setRejectionReasonError('Rejection reason is required.');
      return;
    }
    rejectInFlightRef.current = true;
    setRejectionReasonError(null);
    setActionLoading('reject');
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/mentor-applications/${applicationId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rejectionReason: rejectionReason.trim() }),
      });
      const data = (await res.json()) as { success?: boolean; error?: { message?: string } };
      if (res.status === 409) {
        // Someone else decided first; show their outcome rather than the raw conflict.
        const refreshed = await fetchApplication({ background: true });
        toast.info(
          refreshed?.status === 'rejected'
            ? 'This application has already been rejected.'
            : 'This application is no longer pending review.',
        );
        return;
      }
      if (!res.ok || !data.success) throw new Error(data.error?.message || 'Failed to reject application');
      await fetchApplication({ background: true });
      setRejectionReason('');
      toast.success('Application rejected and the mentor has been notified.');
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to reject application'));
    } finally {
      setActionLoading(null);
      rejectInFlightRef.current = false;
    }
  };

  const canApprove = canDispatchApproval(application?.status);
  const allRequiredDocsApproved = REQUIRED_DOC_TYPES.every((type) =>
    application?.documents.some((d) => d.document_type === type && d.status === 'approved')
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-[var(--color-shell-surface-elevated)] rounded animate-pulse w-1/4" />
        <div className="h-64 bg-[var(--color-shell-surface-elevated)] rounded animate-pulse" />
      </div>
    );
  }

  if (!application) {
    return (
      <div className="space-y-6">
        <div className="text-center py-12">
          <AlertCircle className="h-12 w-12 text-[var(--color-shell-text-subtle)] mx-auto mb-4" />
          <h2 className="text-lg font-bold text-[var(--color-shell-text)] mb-2">Application Not Found</h2>
          <p className="text-sm text-[var(--color-shell-text-muted)] mb-4">
            The requested mentor application could not be found.
          </p>
          <Button onClick={() => navigate('/admin/mentor-verification')}>
            Back to Verification Queue
          </Button>
        </div>
      </div>
    );
  }

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'approved':
        return 'success';
      case 'pending_review':
        return 'warning';
      case 'rejected':
        return 'destructive';
      default:
        return 'secondary';
    }
  };

  const formatStatus = (status: string) => {
    return status.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <button
        onClick={() => navigate('/admin/mentor-verification')}
        className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)] transition-colors rounded-md p-1 -ml-1 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        <span>Back to Verification Queue</span>
      </button>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[var(--color-shell-border)] pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-shell-text)] sm:text-3xl">
            Mentor Verification Detail
          </h1>
          <p className="mt-1 text-sm text-[var(--color-shell-text-muted)]">
            Application #{application.id.split('-')[1]?.substring(0, 8) || application.id.substring(0, 8)}
          </p>
        </div>
        <Badge variant={getStatusBadgeVariant(application.status)} className="text-xs">
          {formatStatus(application.status)}
        </Badge>
      </div>

      {/* Error Display */}
      {error && (
        <div className="rounded-lg bg-[var(--color-shell-error-soft)] border border-[var(--color-shell-error)] p-3 text-xs text-[var(--color-shell-error)] flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Applicant Info */}
      <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 space-y-4">
        <h3 className="text-sm font-semibold text-[var(--color-shell-text)]">Applicant Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <span className="text-[10px] text-[var(--color-shell-text-muted)] uppercase tracking-wider">Full Name</span>
            <p className="text-sm font-medium text-[var(--color-shell-text)] mt-0.5">
              {application.profile?.full_name || application.full_name}
            </p>
          </div>
          <div>
            <span className="text-[10px] text-[var(--color-shell-text-muted)] uppercase tracking-wider">Email</span>
            <p className="text-sm font-medium text-[var(--color-shell-text)] mt-0.5 break-words">
              {application.profile?.email ? (
                <a
                  href={mailtoHref(application.profile.email) || undefined}
                  className="hover:underline underline-offset-2"
                >
                  {application.profile.email}
                </a>
              ) : (
                '—'
              )}
            </p>
          </div>
          <div>
            <span className="text-[10px] text-[var(--color-shell-text-muted)] uppercase tracking-wider">User ID</span>
            <p className="text-sm font-mono text-[var(--color-shell-text-subtle)] mt-0.5 break-all">
              <ShortId value={application.user_id} label="User ID" className="text-sm" />
            </p>
          </div>
        </div>
      </div>

      {/* Bio */}
      <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 space-y-4">
        <h3 className="text-sm font-semibold text-[var(--color-shell-text)]">Mentor Bio</h3>
        <div className="rounded-lg border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] p-4">
          <p className="text-sm text-[var(--color-shell-text)] leading-relaxed whitespace-pre-wrap">
            {application.bio || 'No bio provided.'}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
          <div>
            <span className="text-[var(--color-shell-text-muted)]">Timezone</span>
            <p className="font-medium text-[var(--color-shell-text)]">{application.timezone}</p>
          </div>
          <div>
            <span className="text-[var(--color-shell-text-muted)]">Submitted At</span>
            <p className="font-medium text-[var(--color-shell-text)]">{formatDate(application.submitted_at)}</p>
          </div>
          <div>
            <span className="text-[var(--color-shell-text-muted)]">Created At</span>
            <p className="font-medium text-[var(--color-shell-text)]">{formatDate(application.created_at)}</p>
          </div>
        </div>
        {application.status === 'rejected' && application.rejection_reason && (
          <div className="rounded-lg border border-[var(--color-shell-error-border)] bg-[var(--color-shell-error-soft)]/50 p-3">
            <span className="font-semibold text-[var(--color-shell-error)] text-xs">Admin Rejection Note:</span>
            <p className="text-xs text-[var(--color-shell-error)] mt-1">{application.rejection_reason}</p>
          </div>
        )}
      </div>

      {/* Documents */}
      <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-shell-text)]">Verification Documents</h3>
          {allRequiredDocsApproved && (
            <Badge variant="success" className="text-[10px]">
              All Required Approved
            </Badge>
          )}
        </div>

        <div className="space-y-3">
          {application.documents.map((doc) => {
            const isApproved = doc.status === 'approved';
            const isPending = doc.status === 'pending';
            const isRejected = doc.status === 'rejected';
            const IconComponent = FILE_ICONS[doc.mime_type] || FileIcon;
            // A document is reviewable once: the server only moves a document
            // out of `pending`, so the buttons are offered only for a document
            // that still has no decision.
            const isReviewable =
              (application.status === 'pending_review' || application.status === 'draft') && isPending;
            const isReviewBusy = docReviewLoading !== null;

            return (
              <div
                key={doc.id}
                className={`border rounded-lg p-4 space-y-3 transition-colors ${
                  isApproved
                    ? 'border-[var(--color-shell-success-border)] bg-[var(--color-shell-success-soft)]/30'
                    : isPending
                    ? 'border-amber-200 bg-amber-50/30'
                    : isRejected
                    ? 'border-[var(--color-shell-error-border)] bg-[var(--color-shell-error-soft)]/30'
                    : 'border-[var(--color-shell-border-strong)]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <IconComponent className="h-6 w-6 text-[var(--color-shell-text-subtle)]" />
                    <div>
                      <p className="text-sm font-medium text-[var(--color-shell-text)]">
                        {doc.document_type_ref?.label || doc.document_type}
                        {doc.document_type_ref?.is_required && (
                          <span className="text-[var(--color-shell-error)] ml-1">*</span>
                        )}
                      </p>
                      <p className="text-xs text-[var(--color-shell-text-subtle)]">
                        {doc.original_filename} · {formatFileSize(doc.size_bytes)}
                      </p>
                    </div>
                  </div>
                  <Badge
                    variant={isApproved ? 'success' : isPending ? 'warning' : 'destructive'}
                    className="text-[10px]"
                  >
                    {doc.status}
                  </Badge>
                </div>

                {doc.admin_note && (
                  <div className="rounded border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] p-2">
                    <span className="text-[10px] text-[var(--color-shell-text-muted)] font-medium">Note:</span>
                    <p className="text-xs text-[var(--color-shell-text)] mt-0.5">{doc.admin_note}</p>
                  </div>
                )}

                <div className="flex items-center justify-between pt-1">
                  <div className="text-xs text-[var(--color-shell-text-subtle)]">
                    Uploaded: {formatDate(doc.uploaded_at)}
                    {doc.reviewed_at && (
                      <>
                        {' · Reviewed: '}
                        {formatDate(doc.reviewed_at)}
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {doc.download_url && (
                      <a
                        href={doc.download_url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 cursor-pointer text-xs text-[var(--color-shell-accent)] hover:text-[var(--color-shell-accent-hover)]"
                      >
                        <Download className="h-3 w-3" />
                        View
                      </a>
                    )}

                    {isReviewable && (
                      <>
                        <button
                          onClick={() => void handleDocumentReview(doc.id, 'approved')}
                          disabled={isReviewBusy}
                          className="text-xs text-[var(--color-shell-success)] hover:text-[var(--color-shell-success)]/80 flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                        >
                          {docReviewLoading === doc.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                          Approve
                        </button>
                        <button
                          onClick={() => handleRejectDocument(doc.id)}
                          disabled={isReviewBusy}
                          className="text-xs text-[var(--color-shell-error)] hover:text-[var(--color-shell-error)]/80 flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                        >
                          <XCircle className="h-3 w-3" />
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {application.documents.length === 0 && (
            <div className="text-center py-8 text-[var(--color-shell-text-subtle)]">
              <FileIcon className="h-8 w-8 mx-auto mb-2" />
              <p className="text-sm">No verification documents uploaded yet.</p>
            </div>
          )}
        </div>
      </div>

      {/* Application Actions */}
      {canApprove && (
        <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 space-y-4">
          <h3 className="text-sm font-semibold text-[var(--color-shell-text)]">Application Actions</h3>

          {allRequiredDocsApproved && (
            <Button
              type="button"
              size="sm"
              className="bg-[var(--color-shell-success)] hover:bg-[var(--color-shell-success)]/90 text-white"
              disabled={actionLoading === 'approve'}
              aria-busy={actionLoading === 'approve'}
              onClick={handleApproveApplication}
            >
              {actionLoading === 'approve' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Approving...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Approve Application</span>
                </>
              )}
            </Button>
          )}

          {!allRequiredDocsApproved && (
            <div className="text-xs text-amber-700 bg-amber-50/50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                All required documents must be approved before the application can be approved.
              </span>
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-[var(--color-shell-text-muted)]">
              Reject Application (with reason)
            </label>
            <textarea
              value={rejectionReason}
              onChange={(e) => {
                setRejectionReason(e.target.value);
                setRejectionReasonError(null);
              }}
              placeholder="Explain why this application is being rejected..."
              rows={3}
              maxLength={500}
              className="w-full rounded-lg border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] px-3 py-2 text-xs text-[var(--color-shell-text)] placeholder-[var(--color-shell-text-subtle)] focus:border-[var(--color-shell-error)] focus:outline-none resize-y"
            />
            {rejectionReasonError && <p className="text-[10px] text-[var(--color-shell-error)]">{rejectionReasonError}</p>}
            <Button
              variant="destructive"
              size="sm"
              disabled={actionLoading === 'reject' || !rejectionReason.trim()}
              onClick={handleRejectApplication}
            >
              {actionLoading === 'reject' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              <span>Reject Application</span>
            </Button>
          </div>
        </div>
      )}

      {/* Audit Trail */}
      {application.auditLog && application.auditLog.length > 0 && (
        <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 space-y-3">
          <h3 className="text-sm font-semibold text-[var(--color-shell-text)]">Audit Trail</h3>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {application.auditLog.map((entry) => (
              <div key={entry.id} className="flex items-start gap-3 text-xs border-b border-[var(--color-shell-border-strong)] pb-2 last:border-0">
                <Clock className="h-3.5 w-3.5 text-[var(--color-shell-text-subtle)] shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[var(--color-shell-text-muted)]">{entry.action}</span>
                    <span className="text-[var(--color-shell-text-subtle)]">·</span>
                    <span className="text-[var(--color-shell-text-subtle)]">
                      {new Date(entry.created_at).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    {entry.admin_user && (
                      <>
                        <span className="text-[var(--color-shell-text-subtle)]">·</span>
                        <span className="font-medium text-[var(--color-shell-text-muted)]">
                          by {entry.admin_user.full_name}
                        </span>
                      </>
                    )}
                  </div>
                  {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                    <pre className="text-[10px] text-[var(--color-shell-text-subtle)] mt-1 whitespace-pre-wrap">
                      {JSON.stringify(entry.metadata, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
