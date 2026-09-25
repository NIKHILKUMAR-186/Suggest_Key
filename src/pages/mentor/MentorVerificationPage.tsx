import React, { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  Upload,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  Loader2,
  FileImage,
  FileText as FileIcon,
  Shield,
  RefreshCw,
  Save,
  Send,
  Trash2,
} from 'lucide-react';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { Badge } from '@/src/components/ui/Badge';
import { apiFetch } from '@/src/lib/apiClient';
import { supabase } from '@/src/lib/supabase';

interface MentorApplication {
  id: string;
  user_id: string;
  status: 'draft' | 'pending_review' | 'approved' | 'rejected';
  full_name: string;
  bio: string;
  timezone: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface MentorDocumentType {
  code: string;
  label: string;
  description: string | null;
  is_required: boolean;
  sort_order: number;
  is_active: boolean;
}

interface MentorDocument {
  id: string;
  application_id: string;
  document_type: string;
  storage_path: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  status: 'pending' | 'approved' | 'rejected';
  admin_note: string | null;
  uploaded_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

interface OnboardingStatus {
  application: MentorApplication | null;
  documents: MentorDocument[];
  documentTypes: MentorDocumentType[];
  mentorProfile: { headline?: string | null; about?: string | null; experience_years?: number | null } | null;
  segments: Array<{ segment_id: string; segment?: SegmentOption | null }>;
  auditLog: any[];
  allRequiredDocsApproved: boolean;
}

interface SegmentOption {
  id: string;
  name: string;
  description: string | null;
}

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_FILE_SIZE = 5 * 1024 * 1024;

const FILE_ICONS: Record<string, React.ElementType> = {
  'image/jpeg': FileImage,
  'image/png': FileImage,
  'image/webp': FileImage,
  'application/pdf': FileText,
};

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const MentorVerificationPage: React.FC = () => {
  const { user, profile } = useAuth();
  const { navigate } = useNavigation();

  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingBio, setSavingBio] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  const [bioText, setBioText] = useState('');
  const [headline, setHeadline] = useState('');
  const [experienceYears, setExperienceYears] = useState('');
  const [segments, setSegments] = useState<SegmentOption[]>([]);
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<string[]>([]);
  const [bioError, setBioError] = useState<string | null>(null);

  const editableStatuses = ['draft', 'rejected'];
  const isEditable = onboarding?.application && editableStatuses.includes(onboarding.application.status);

  const fetchOnboarding = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/mentor/onboarding-status');
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to fetch onboarding status');
      setOnboarding(data.onboarding);
    } catch (err: any) {
      setError(err.message || 'Failed to load onboarding status');
      console.error('Failed to fetch onboarding status:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.id) {
      fetchOnboarding();
    }
  }, [user?.id, fetchOnboarding]);

  useEffect(() => {
    if (!onboarding) return;
    setBioText(onboarding.application?.bio || onboarding.mentorProfile?.about || '');
    setHeadline(onboarding.mentorProfile?.headline || '');
    setExperienceYears(onboarding.mentorProfile?.experience_years == null ? '' : String(onboarding.mentorProfile.experience_years));
    setSelectedSegmentIds(onboarding.segments.map((segment) => segment.segment_id));
    const currentSegments = onboarding.segments
      .map((membership) => membership.segment)
      .filter((segment): segment is SegmentOption => Boolean(segment));
    setSegments((availableSegments) => {
      const merged = new Map(availableSegments.map((segment) => [segment.id, segment]));
      currentSegments.forEach((segment) => merged.set(segment.id, segment));
      return Array.from(merged.values());
    });
  }, [onboarding]);

  useEffect(() => {
    if (!user?.id) return;
    apiFetch(`/api/mentor/available-segments?mentorId=${encodeURIComponent(user.id)}`).then(async (availableResponse) => {
      const available = await availableResponse.json() as { segments?: SegmentOption[] };
      setSegments((currentSegments) => {
        const merged = new Map(currentSegments.map((segment) => [segment.id, segment]));
        (available.segments || []).forEach((segment) => merged.set(segment.id, segment));
        return Array.from(merged.values());
      });
    }).catch(() => setSegments([]));
  }, [user?.id]);

  const validateBio = (): boolean => {
    if (!bioText.trim()) {
      setBioError('Bio is required.');
      return false;
    }
    if (bioText.trim().length < 20) {
      setBioError('Bio must be at least 20 characters.');
      return false;
    }
    setBioError(null);
    return true;
  };

  const handleSaveDraft = async (): Promise<boolean> => {
    if (!validateBio()) return false;
    setSavingBio(true);
    setError(null);
    try {
      const res = await apiFetch('/api/mentor/application/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: profile?.full_name || user?.email?.split('@')[0] || '',
          bio: bioText,
          headline,
          experienceYears: experienceYears ? Number(experienceYears) : 0,
          segmentIds: selectedSegmentIds,
          timezone: onboarding?.application?.timezone || 'Asia/Kolkata',
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to save application');
      setOnboarding((prev) => prev ? { ...prev, application: data.application } : null);
      return true;
    } catch (err: any) {
      setError(err.message || 'Failed to save application');
      return false;
    } finally {
      setSavingBio(false);
    }
  };

  const handleStartApplication = async () => {
    if (!user?.id) return;
    setSavingBio(true);
    setError(null);
    try {
      const res = await apiFetch('/api/mentor/application/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: profile?.full_name || user.email || 'Mentor',
          bio: '',
          headline: '',
          experienceYears: 0,
          segmentIds: [],
          timezone: profile?.timezone || 'Asia/Kolkata',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error?.message || 'Unable to start your application.');
      await fetchOnboarding();
    } catch (err: any) {
      setError(err.message || 'Unable to start your application.');
    } finally {
      setSavingBio(false);
    }
  };

  const handleSubmit = async () => {
    if (!validateBio()) return;
    const saved = await handleSaveDraft();
    if (!saved) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch('/api/mentor/application/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to submit application');
      await fetchOnboarding();
    } catch (err: any) {
      setError(err.message || 'Failed to submit application');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUploadDocument = async (e: React.ChangeEvent<HTMLInputElement>, docTypeCode: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileType = file.type;

    if (!ALLOWED_MIME_TYPES.includes(fileType)) {
      setError('Unsupported file. Upload JPG, PNG, WEBP, or PDF up to 5 MB.');
      return;
    }

    if (file.size === 0) {
      setError('File is empty. Please select a valid file.');
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setError('Unsupported file. Upload JPG, PNG, WEBP, or PDF up to 5 MB.');
      return;
    }

    setUploadingDoc(docTypeCode);
    setError(null);

    try {
      const applicationId = onboarding!.application!.id;
      const uploadUrlRes = await apiFetch(
        `/api/mentor/document/upload-url?applicationId=${encodeURIComponent(applicationId)}&documentType=${encodeURIComponent(docTypeCode)}&fileName=${encodeURIComponent(file.name)}&mimeType=${encodeURIComponent(fileType)}&sizeBytes=${file.size}`,
        { method: 'GET' }
      );
      const uploadUrlData = await uploadUrlRes.json();
      if (!uploadUrlData.success) throw new Error(uploadUrlData.error?.message || 'Failed to get upload URL');

      // Development logging
      if (import.meta.env.DEV) {
        console.log('[MentorVerification] Upload details:', {
          bucket: 'mentor-verification-documents',
          storagePath: uploadUrlData.storagePath,
          fileName: file.name,
          fileSize: file.size,
          fileType: fileType,
          operation: 'createSignedUploadUrl + uploadToSignedUrl',
          userId: user?.id,
          applicationId,
          documentType: docTypeCode,
        });
      }

      // Use Supabase client's uploadToSignedUrl for proper signed upload
      const { error: uploadError } = await supabase.storage
        .from('mentor-verification-documents')
        .uploadToSignedUrl(uploadUrlData.storagePath, uploadUrlData.token, file);

      if (uploadError) {
        if (import.meta.env.DEV) {
          console.error('[MentorVerification] Upload failed:', {
            message: uploadError.message,
            statusCode: uploadError.statusCode,
            error: uploadError,
          });
        }
        throw new Error(`File upload failed: ${uploadError.message}`);
      }

      const recordRes = await apiFetch('/api/mentor/document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          applicationId,
          documentType: docTypeCode,
          storagePath: uploadUrlData.storagePath,
          originalFilename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
      });
      const recordData = await recordRes.json();
      if (!recordData.success) throw new Error(recordData.error?.message || 'Failed to record document');

      await fetchOnboarding();
    } catch (err: any) {
      if (import.meta.env.DEV) {
        console.error('[MentorVerification] Upload error:', err);
      }
      setError(err.message || 'Failed to upload document');
    } finally {
      setUploadingDoc(null);
      e.target.value = '';
    }
  };

  const removeDocument = async (docId: string) => {
    // Note: The API doesn't have a delete endpoint yet, so we remove locally
    // In a real implementation this would call DELETE /api/mentor/document/:id
    try {
      const res = await apiFetch(`/api/mentor/document/${docId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to remove document');
      await fetchOnboarding();
    } catch (err: any) {
      setError(err.message || 'Failed to remove document');
      console.error('Failed to remove document:', err);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return <Badge variant="success" className="text-[10px]">Approved</Badge>;
      case 'pending_review':
        return <Badge variant="warning" className="text-[10px]">Under Review</Badge>;
      case 'rejected':
        return <Badge variant="destructive" className="text-[10px]">Revision Required</Badge>;
      case 'draft':
      default:
        return <Badge variant="secondary" className="text-[10px]">Not Submitted</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-[var(--color-shell-surface-elevated)] rounded animate-pulse w-1/4" />
        <div className="h-64 bg-[var(--color-shell-surface-elevated)] rounded animate-pulse" />
        <div className="h-48 bg-[var(--color-shell-surface-elevated)] rounded animate-pulse" />
      </div>
    );
  }

  const application = onboarding?.application;

  if (error && !onboarding) {
    return (
      <div className="max-w-xl mx-auto py-12 text-center space-y-4">
        <AlertCircle className="h-10 w-10 text-[var(--color-shell-error)] mx-auto" />
        <h2 className="text-lg font-bold text-[var(--color-shell-text)]">Unable to load your mentor application</h2>
        <p className="text-xs text-[var(--color-shell-text-muted)]">{error}</p>
        <Button onClick={fetchOnboarding} variant="outline">Retry</Button>
      </div>
    );
  }

  if (!application) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)]/50 p-8 text-center">
          <FileText className="h-12 w-12 text-[var(--color-shell-text-subtle)] mx-auto mb-4" />
          <h2 className="text-lg font-bold text-[var(--color-shell-text)] mb-2">Start your mentor application</h2>
          <p className="text-sm text-[var(--color-shell-text-muted)] mb-4">
            Complete your mentor profile and submit your application for review.
          </p>
          <Button onClick={handleStartApplication} disabled={savingBio}>
            {savingBio ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {savingBio ? 'Starting...' : 'Start Application'}
          </Button>
        </div>
      </div>
    );
  }

  const requiredDocTypes = onboarding?.documentTypes.filter((dt) => dt.is_required) || [];
  const uploadedDocTypes = new Set(onboarding?.documents.map((d) => d.document_type));

  return (
    <div className="space-y-6">
      {/* Status Banner */}
      <div
        className={`rounded-xl border p-5 space-y-3 ${
          application.status === 'approved'
            ? 'border-[var(--color-shell-success-border)] bg-[var(--color-shell-success-soft)]'
            : application.status === 'pending_review'
            ? 'border-amber-200 bg-amber-50/50'
            : application.status === 'rejected'
            ? 'border-[var(--color-shell-error-border)] bg-[var(--color-shell-error-soft)]'
            : 'border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)]/50'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {application.status === 'approved' ? (
              <CheckCircle2 className="h-6 w-6 text-[var(--color-shell-success)]" />
            ) : application.status === 'pending_review' ? (
              <Clock className="h-6 w-6 text-amber-600" />
            ) : application.status === 'rejected' ? (
              <XCircle className="h-6 w-6 text-[var(--color-shell-error)]" />
            ) : (
              <Shield className="h-6 w-6 text-[var(--color-shell-text-subtle)]" />
            )}
            <h2 className="text-lg font-bold text-[var(--color-shell-text)]">
              {application.status === 'approved'
                ? 'Application Approved'
                : application.status === 'pending_review'
                ? 'Under Admin Review'
                : application.status === 'rejected'
                ? 'Revision Required'
                : 'Application Draft'}
            </h2>
          </div>
          {getStatusBadge(application.status)}
        </div>

        {application.status === 'approved' && (
          <p className="text-sm text-[var(--color-shell-success)]">
            Your mentor application has been approved. You can now configure your availability and create gigs.
          </p>
        )}

        {application.status === 'rejected' && application.rejection_reason && (
          <div className="rounded-lg border border-[var(--color-shell-error-border)] bg-[var(--color-shell-error-soft)]/50 p-3">
            <p className="font-semibold text-xs text-[var(--color-shell-error)]">Admin Feedback:</p>
            <p className="text-xs text-[var(--color-shell-error)] mt-1">{application.rejection_reason}</p>
          </div>
        )}

        {application.status === 'pending_review' && (
          <p className="text-sm text-amber-800">
            Your application is being reviewed by our Admin team. You will be notified once verification is complete.
          </p>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-[var(--color-shell-error-soft)] border border-[var(--color-shell-error)] p-3 text-xs text-[var(--color-shell-error)] flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-[var(--color-shell-error)] shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Application Form (Bio) */}
      <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 space-y-4">
        <h3 className="text-sm font-semibold text-[var(--color-shell-text)]">Mentor Profile</h3>
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-[var(--color-shell-text-muted)]">
            Bio / Mentorship Background
          </label>
          <textarea
            value={bioText}
            onChange={(e) => {
              setBioText(e.target.value);
              setBioError(null);
            }}
            onBlur={isEditable ? validateBio : undefined}
            disabled={!isEditable}
            placeholder="Describe your background, expertise, and what you hope to mentor on..."
            rows={5}
            maxLength={500}
            className="w-full rounded-lg border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] px-3 py-2 text-xs text-[var(--color-shell-text)] placeholder-[var(--color-shell-text-subtle)] focus:border-[var(--color-shell-primary)] focus:outline-none resize-y disabled:opacity-50 disabled:cursor-not-allowed"
          />
          {bioError && <p className="text-[10px] text-[var(--color-shell-error)]">{bioError}</p>}
          <p className="text-[10px] text-[var(--color-shell-text-subtle)]">
            Minimum 20 characters. This will be reviewed by Admin during verification.
          </p>
        </div>

        {isEditable && (
          <>
          <div className="flex items-center gap-2 pt-2">
            <Button
              size="sm"
              variant="outline"
              disabled={savingBio || !bioText.trim()}
              onClick={handleSaveDraft}
            >
              {savingBio ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              <span>{savingBio ? 'Saving...' : 'Save Draft'}</span>
            </Button>
            <Button
              size="sm"
              disabled={submitting || uploadingDoc !== null || requiredDocTypes.length === 0 || !uploadedDocTypes.size}
              onClick={handleSubmit}
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              <span>{submitting ? 'Submitting...' : 'Submit for Review'}</span>
            </Button>
          </div>

          <Input
            label="Professional headline"
            value={headline}
            onChange={(event) => setHeadline(event.target.value)}
            placeholder="e.g. Career transition mentor"
            className="auth-input"
          />

          <Input
            label="Years of experience"
            type="number"
            min="0"
            value={experienceYears}
            onChange={(event) => setExperienceYears(event.target.value)}
            className="auth-input"
          />

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-[var(--color-shell-text-muted)]">Mentorship segments</label>
            <div className="space-y-2 rounded-lg border border-[var(--color-shell-border)] p-3">
              {segments.length === 0 ? <p className="text-[11px] text-[var(--color-shell-text-subtle)]">No active segments are available yet.</p> : segments.map((segment) => (
                <label key={segment.id} className="flex items-start gap-2 text-xs">
                  <input type="checkbox" checked={selectedSegmentIds.includes(segment.id)} onChange={(event) => setSelectedSegmentIds((current) => event.target.checked ? [...current, segment.id] : current.filter((id) => id !== segment.id))} />
                  <span><strong>{segment.name}</strong>{segment.description ? <span className="block text-[11px] text-[var(--color-shell-text-subtle)]">{segment.description}</span> : null}</span>
                </label>
              ))}
            </div>
          </div>
          </>
        )}
      </div>

      {/* Document Upload Section */}
      <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-shell-text)]">Verification Documents</h3>
          {application.status !== 'draft' && application.status !== 'rejected' && (
            <Badge variant="secondary" className="text-[10px]">Read-only</Badge>
          )}
        </div>

        <div className="space-y-4">
          {(onboarding?.documentTypes || []).map((docType) => {
            const uploadedDoc = onboarding?.documents.find((d) => d.document_type === docType.code);
            const isRequired = docType.is_required;
            const isUploading = uploadingDoc === docType.code;

            return (
              <div key={docType.code} className="border border-[var(--color-shell-border-strong)] rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-semibold text-[var(--color-shell-text)]">
                      {docType.label}
                      {isRequired && <span className="text-[var(--color-shell-error)] ml-0.5">*</span>}
                    </label>
                    {docType.description && (
                      <p className="text-[10px] text-[var(--color-shell-text-subtle)] mt-0.5">
                        {docType.description}
                      </p>
                    )}
                  </div>
                  {uploadedDoc && (
                    <Badge
                      variant={
                        uploadedDoc.status === 'approved'
                          ? 'success'
                          : uploadedDoc.status === 'rejected'
                          ? 'destructive'
                          : 'warning'
                      }
                      className="text-[10px]"
                    >
                      {uploadedDoc.status}
                    </Badge>
                  )}
                </div>

                {uploadedDoc ? (
                  <div className="flex items-center justify-between p-2 bg-[var(--color-shell-bg)] rounded-lg">
                    <div className="flex items-center gap-3">
                      {React.createElement(FILE_ICONS[uploadedDoc.mime_type] || FileIcon, {
                        className: 'h-5 w-5 text-[var(--color-shell-text-subtle)]',
                      })}
                      <div>
                        <p className="text-xs font-medium text-[var(--color-shell-text)]">
                          {uploadedDoc.original_filename}
                        </p>
                        <p className="text-[10px] text-[var(--color-shell-text-subtle)]">
                          {formatFileSize(uploadedDoc.size_bytes)} · Uploaded {new Date(uploadedDoc.uploaded_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {uploadedDoc.admin_note && (
                        <span title={uploadedDoc.admin_note} className="cursor-help">
                          <AlertCircle className="h-3.5 w-3.5 text-[var(--color-shell-error)]" />
                        </span>
                      )}
                      {isEditable && (
                        <button
                          onClick={() => removeDocument(uploadedDoc.id)}
                          className="text-[var(--color-shell-text-subtle)] hover:text-[var(--color-shell-error)]"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ) : isEditable ? (
                  <label
                    className={`flex items-center justify-center gap-2 border border-[var(--color-shell-border-strong)] border-dashed rounded-lg p-3 cursor-pointer hover:bg-[var(--color-shell-surface-elevated)] transition-colors ${
                      isUploading ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                  >
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      onChange={(e) => handleUploadDocument(e, docType.code)}
                      disabled={isUploading}
                      className="hidden"
                    />
                    {isUploading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-[var(--color-shell-accent)]" />
                    ) : (
                      <Upload className="h-4 w-4 text-[var(--color-shell-text-subtle)]" />
                    )}
                    <span className="text-xs text-[var(--color-shell-text-muted)]">
                      {isUploading ? 'Uploading...' : 'Upload File'}
                    </span>
                  </label>
                ) : (
                  <div className="text-[10px] text-[var(--color-shell-text-subtle)]">
                    No file uploaded
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {requiredDocTypes.length > 0 && (
          <div className="text-[10px] text-[var(--color-shell-text-subtle)] space-y-1">
            <p>
              Required documents: {requiredDocTypes.map((dt) => dt.label).join(', ')}
            </p>
            <p>
              Accepted formats: JPG, PNG, WEBP, PDF (max 5MB each)
            </p>
          </div>
        )}
      </div>

      {/* Audit Trail */}
      {onboarding?.auditLog && onboarding.auditLog.length > 0 && (
        <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 space-y-3">
          <h3 className="text-sm font-semibold text-[var(--color-shell-text)]">Activity History</h3>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {onboarding.auditLog.map((entry, idx) => (
              <div key={entry.id || idx} className="flex items-start gap-2 text-[10px]">
                <Clock className="h-3 w-3 text-[var(--color-shell-text-subtle)] shrink-0 mt-0.5" />
                <div>
                  <span className="font-medium text-[var(--color-shell-text-muted)]">
                    {entry.action}
                  </span>
                  <span className="text-[var(--color-shell-text-subtle)] mx-1">·</span>
                  <span className="text-[var(--color-shell-text-subtle)]">
                    {new Date(entry.created_at).toLocaleString()}
                  </span>
                  {entry.admin_user && (
                    <>
                      <span className="text-[var(--color-shell-text-subtle)] mx-1">·</span>
                      <span className="text-[var(--color-shell-text-muted)]">
                        by {entry.admin_user.full_name}
                      </span>
                    </>
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
