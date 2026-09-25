import React, { useState, useEffect, useCallback } from 'react';
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
  const [applicationId] = useState<string>(() => {
    // Extract ID from path like /admin/mentor-verification/<id>
    const pathParts = currentPath.split('/');
    return pathParts[pathParts.length - 1] || '';
  });
  const [application, setApplication] = useState<MentorApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [docReviewLoading, setDocReviewLoading] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejectionReasonError, setRejectionReasonError] = useState<string | null>(null);

  const fetchApplication = useCallback(async () => {
    if (!applicationId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/mentor-applications/${applicationId}`);
      const data = (await res.json()) as Partial<AdminMentorApplicationDetailResponse> & {
        error?: { message?: string };
      };
      if (!res.ok || !data.success || !data.application) {
        throw new Error(data.error?.message || 'Failed to fetch application');
      }
      setApplication(data.application);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load application'));
      console.error('Failed to fetch application:', err);
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  useEffect(() => {
    fetchApplication();
  }, [fetchApplication]);

  const handleDocumentReview = async (docId: string, status: 'approved' | 'rejected', note?: string) => {
    setDocReviewLoading(docId);
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/mentor-documents/${docId}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, adminNote: note || null }),
      });
      const data = (await res.json()) as { success?: boolean; error?: { message?: string } };
      if (!res.ok || !data.success) throw new Error(data.error?.message || 'Failed to review document');
      await fetchApplication();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to review document'));
    } finally {
      setDocReviewLoading(null);
    }
  };

  const handleApproveApplication = async () => {
    setActionLoading('approve');
    setError(null);
    const approvedDocs = application?.documents.filter((d) => d.status === 'approved');
    const approvedDocTypes = new Set(approvedDocs?.map((d) => d.document_type) || []);
    const missing = REQUIRED_DOC_TYPES.filter((t) => !approvedDocTypes.has(t));

    if (missing.length > 0) {
      setError(`All required documents must be approved before application approval. Missing: ${missing.join(', ')}`);
      setActionLoading(null);
      return;
    }

    try {
      const res = await apiFetch(`/api/admin/mentor-applications/${applicationId}/approve`, {
        method: 'POST',
      });
      const data = (await res.json()) as { success?: boolean; error?: { message?: string } };
      if (!res.ok || !data.success) throw new Error(data.error?.message || 'Failed to approve application');
      await fetchApplication();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to approve application'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleRejectApplication = async () => {
    if (!rejectionReason.trim()) {
      setRejectionReasonError('Rejection reason is required.');
      return;
    }
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
      if (!res.ok || !data.success) throw new Error(data.error?.message || 'Failed to reject application');
      await fetchApplication();
      setRejectionReason('');
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to reject application'));
    } finally {
      setActionLoading(null);
    }
  };

  const canApprove = application?.status === 'pending_review';
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
            <p className="text-sm font-medium text-[var(--color-shell-text)] mt-0.5">
              {application.profile?.email || '—'}
            </p>
          </div>
          <div>
            <span className="text-[10px] text-[var(--color-shell-text-muted)] uppercase tracking-wider">User ID</span>
            <p className="text-sm font-mono text-[var(--color-shell-text-subtle)] mt-0.5 break-all">
              {application.user_id}
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
            const isReviewable = application.status === 'pending_review' || application.status === 'draft';

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
                    <button
                      onClick={() => window.open(doc.storage_path, '_blank')}
                      className="text-xs text-[var(--color-shell-accent)] hover:text-[var(--color-shell-accent-hover)] flex items-center gap-1 cursor-pointer"
                    >
                      <Download className="h-3 w-3" />
                      View
                    </button>

                    {isReviewable && (
                      <>
                        <button
                          onClick={() => handleDocumentReview(doc.id, 'approved')}
                          disabled={docReviewLoading === doc.id}
                          className="text-xs text-[var(--color-shell-success)] hover:text-[var(--color-shell-success)]/80 flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                        >
                          {docReviewLoading === doc.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                          Approve
                        </button>
                        <button
                          onClick={() => {
                            const note = prompt('Rejection reason for this document:');
                            if (note && note.trim()) {
                              handleDocumentReview(doc.id, 'rejected', note.trim());
                            }
                          }}
                          disabled={docReviewLoading === doc.id}
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
              size="sm"
              className="bg-[var(--color-shell-success)] hover:bg-[var(--color-shell-success)]/90 text-white"
              disabled={actionLoading === 'approve'}
              onClick={handleApproveApplication}
            >
              {actionLoading === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              <span>Approve Application</span>
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
