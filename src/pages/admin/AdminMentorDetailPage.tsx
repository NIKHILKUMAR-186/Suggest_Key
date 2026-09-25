
/**
 * Admin Mentor Detail (/admin/mentors/[mentorId])
 *
 * Full operational visibility for one mentor, plus the Admin account controls
 * (activate / deactivate / suspend / reactivate).
 *
 * Every value rendered here comes from GET /api/admin/mentors/:id, which is
 * Admin-gated server-side. Nothing on this page is UI-only state: the status
 * buttons call the API and the page re-reads from the database afterwards.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Plus,
  Pencil,
  Trash2,
  Download,
  ShieldCheck,
} from 'lucide-react';
import { Badge } from '@/src/components/ui/Badge';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { Textarea } from '@/src/components/ui/Textarea';
import { Modal } from '@/src/components/ui/Modal';
import { LoadingState } from '@/src/components/shared/LoadingState';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { ControlTabs } from '@/src/components/admin/ControlTabs';
import { apiFetch } from '@/src/lib/apiClient';
import { useNavigation } from '@/src/context/NavigationContext';
import {
  ADMIN_CREATED_MENTOR_HELPER,
  MENTOR_ACCOUNT_BADGE_LABELS,
  MENTOR_CREATION_SOURCE_LABELS,
  MENTOR_STATUS_ACTION_SPECS,
  availableMentorStatusActions,
  deriveMentorAccountState,
  isAdminCreatedMentor,
  mentorAccountBadge,
  type MentorAccountBadge,
  type MentorAccountState,
  type MentorStatusAction,
  type MentorCreationSource,
} from '@/src/lib/adminMentorControl';



export interface AdminMentorDocument {
  id: string;
  document_type: string;
  original_filename: string;
  status: string;
  uploaded_at: string;
  admin_note?: string | null;
  download_url?: string | null;
}

/** Shape returned by GET /api/admin/mentors/:id */
export interface AdminMentorDetail {
  profile: {
    id: string;
    fullName: string;
    email: string;
    phone: string | null;
    avatarUrl: string | null;
    timezone: string | null;
    createdAt: string;
    updatedAt: string;
  };
  roles: string[];
  mentorProfile: {
    headline: string;
    about: string | null;
    experienceYears: number;
    languages: string[] | null;
    expertise: string[] | null;
    rating: number;
    reviewCount: number;
    sessionCount: number;
    isFeatured: boolean;
    createdAt: string;
    updatedAt: string;
    /**
     * False when the account holds the `mentor` role but has no
     * mentor_profiles row yet - e.g. a public applicant who has not been
     * approved. The Control Center still opens and shows their real
     * verification state.
     */
    exists: boolean;
  };
  /**
   * How the mentor joined, resolved server-side from real database evidence
   * (created_via column, then the MENTOR_CREATED_BY_ADMIN audit record, then
   * application presence). Never inferred in the UI.
   */
  creation: {
    source: MentorCreationSource;
    createdVia: string | null;
    createdBy: { id: string; full_name: string | null; email: string | null } | null;
    createdAt: string;
  };
  verification: {
    approvalStatus: string | null;
    isApproved: boolean;
    applicationStatus: string | null;
    applicationId: string | null;
    submittedAt: string | null;
    reviewedAt: string | null;
    rejectionReason: string | null;
    approvedBy: { id: string; full_name: string | null; email: string | null } | null;
    documents: AdminMentorDocument[];
  };
  segments: Array<{
    segmentId: string;
    isPrimary: boolean;
    name: string | null;
    slug: string | null;
    isActive: boolean | null;
    createdAt: string;
  }>;
  gigs: Array<{
    id: string;
    title: string;
    description: string;
    priceInr: number;
    durationMinutes: number;
    isActive: boolean;
    segmentId: string;
    segmentName: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  availability: Array<{
    id: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    timezone: string;
    isEnabled: boolean;
  }>;
  availabilityExceptions: Array<{
    id: string;
    exceptionDate: string;
    isAvailable: boolean;
    startTime: string | null;
    endTime: string | null;
    reason: string | null;
  }>;
  account: {
    accountStatus: string;
    isActive: boolean;
    suspendedAt: string | null;
    suspendedUntil: string | null;
    suspensionReason: string | null;
    suspendedBy: string | null;
    deactivatedAt: string | null;
    internalNote: string | null;
  };
}

/** Shape returned by GET /api/admin/mentors/:id/bookings */
export interface AdminMentorBooking {
  id: string;
  bookingCode: string;
  startTime: string;
  endTime: string;
  amountInr: number;
  status: string;
  meetingUrl: string | null;
  cancellationReason: string | null;
  isUpcoming: boolean;
  seeker: { id: string; full_name: string | null; email: string | null } | null;
  payment: { id: string; status: string; amountInr: number; verifiedAt: string | null } | null;
}

/** Shape returned by GET /api/admin/mentors/:id/audit */
export interface AdminMentorAuditEntry {
  id: string;
  createdAt: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  requestId: string | null;
  actorRole: string | null;
  actor: { id: string; name: string | null; email: string | null } | null;
  metadata: Record<string, unknown> | null;
}

/** Shape returned by GET /api/admin/segments */
export interface AdminSegmentOption {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  is_active: boolean;
  priority: number;
}



function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="-ml-1 flex items-center gap-1.5 rounded-md p-1 text-xs font-semibold text-[var(--color-shell-text-muted)] transition-colors hover:text-[var(--color-shell-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)]"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      <span>Back to Mentors</span>
    </button>
  );
}

function formatDate(value: string | null | undefined, withTime = false): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}


const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Monday-first, matching how availability is presented to the mentor. */
const DAYS_OF_WEEK = [
  { name: 'Monday', index: 1 },
  { name: 'Tuesday', index: 2 },
  { name: 'Wednesday', index: 3 },
  { name: 'Thursday', index: 4 },
  { name: 'Friday', index: 5 },
  { name: 'Saturday', index: 6 },
  { name: 'Sunday', index: 0 },
];

function InlineError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-[var(--color-shell-error)] bg-[var(--color-shell-error-soft)] p-2.5 text-xs text-[var(--color-shell-error)]">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

/** A single discovery-readiness condition (prompt section 4). */
function ReadinessRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span
        className={
          ok
            ? 'inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-shell-success-soft)] text-[10px] text-[var(--color-shell-success)]'
            : 'inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-shell-error-soft)] text-[10px] text-[var(--color-shell-error)]'
        }
      >
        {ok ? '✓' : '✕'}
      </span>
      <span className={ok ? 'text-[var(--color-shell-text)]' : 'text-[var(--color-shell-text-muted)]'}>{label}</span>
    </li>
  );
}


function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  return String(value).slice(0, 5);
}

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)]">
      <header className="flex items-center justify-between border-b border-[var(--color-shell-border)] px-5 py-3.5">
        <h2 className="text-sm font-bold text-[var(--color-shell-text)]">{title}</h2>
        {action}
      </header>
      <div className="space-y-3 p-5">{children}</div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-shell-text-subtle)]">
        {label}
      </dt>
      <dd className="mt-0.5 text-xs text-[var(--color-shell-text)] break-words">{value}</dd>
    </div>
  );
}


/**
 * Verification panel for a PUBLIC mentor (prompt section 4).
 *
 * Shows the real application state, documents, submitted/reviewed dates,
 * reviewer and rejection reason. Only rendered when the mentor is NOT
 * admin-created.
 */
function PublicVerification({ mentor }: { mentor: AdminMentorDetail }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={
            mentor.verification.approvalStatus === 'approved'
              ? 'success'
              : mentor.verification.approvalStatus === 'rejected'
                ? 'destructive'
                : 'warning'
          }
          className="text-[10px]"
        >
          {mentor.verification.approvalStatus ?? 'unknown'}
        </Badge>
        <Badge variant="secondary" className="text-[10px]">
          Application: {mentor.verification.applicationStatus ?? 'none'}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {MENTOR_CREATION_SOURCE_LABELS[mentor.creation.source]}
        </Badge>
      </div>

      {mentor.verification.applicationId ? (
        <>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Submitted" value={formatDate(mentor.verification.submittedAt, true)} />
            <Field label="Reviewed" value={formatDate(mentor.verification.reviewedAt, true)} />
            <Field
              label="Reviewer"
              value={mentor.verification.approvedBy?.full_name || mentor.verification.approvedBy?.email || '—'}
            />
            <Field label="Documents" value={String(mentor.verification.documents.length)} />
          </dl>
          {mentor.verification.rejectionReason && (
            <p className="rounded-lg border border-[var(--color-shell-error)]/30 bg-[var(--color-shell-error-soft)] p-3 text-xs text-[var(--color-shell-error)]">
              <span className="font-semibold">Rejection reason:</span> {mentor.verification.rejectionReason}
            </p>
          )}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-shell-text-subtle)]">
              Verification documents
            </p>
            {mentor.verification.documents.length === 0 ? (
              <p className="mt-1 text-xs text-[var(--color-shell-text-subtle)]">No documents uploaded yet.</p>
            ) : (
              <ul className="mt-1.5 space-y-1.5">
                {mentor.verification.documents.map((doc) => (
                  <li
                    key={doc.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] p-2.5 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-[var(--color-shell-text)]">{doc.original_filename}</p>
                      <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
                        {doc.document_type} · uploaded {formatDate(doc.uploaded_at, true)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge
                        variant={doc.status === 'approved' ? 'success' : doc.status === 'rejected' ? 'destructive' : 'warning'}
                        className="text-[10px]"
                      >
                        {doc.status}
                      </Badge>
                      {doc.download_url && (
                        <a
                          href={doc.download_url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 font-semibold text-[var(--color-shell-primary)] hover:underline"
                        >
                          <Download className="h-3 w-3" />
                          View
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : (
        <p className="text-xs text-[var(--color-shell-text-subtle)]">
          This mentor has no application on record and no admin-creation audit event, so the creation
          source cannot be determined. Review the Audit Log tab for details.
        </p>
      )}

      <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
        Verification documents are visible to authorized Admins only and never appear in public mentor
        discovery.
      </p>
    </div>
  );
}

const STATUS_VARIANT: Record<MentorAccountBadge, 'success' | 'warning' | 'destructive' | 'secondary'> = {
  active: 'success',
  deactivated: 'secondary',
  suspended: 'destructive',
  suspended_lapsed: 'warning',
  pending: 'warning',
};

export const AdminMentorDetailPage: React.FC = () => {
  const { navigate, currentPath } = useNavigation();
  const mentorId = currentPath.split('/').filter(Boolean).pop() || '';

  const [mentor, setMentor] = useState<AdminMentorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Status action state
  const [pendingAction, setPendingAction] = useState<MentorStatusAction | null>(null);
  const [reason, setReason] = useState('');
  const [suspendedUntil, setSuspendedUntil] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  // Which control-center section is shown.
  const [activeTab, setActiveTab] = useState('overview');

  // Profile edit form
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [headline, setHeadline] = useState('');
  const [bio, setBio] = useState('');
  const [experienceYears, setExperienceYears] = useState('');
  const [languages, setLanguages] = useState('');
  const [expertise, setExpertise] = useState('');

  // Segment picker
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<string[]>([]);
  const [primarySegmentId, setPrimarySegmentId] = useState<string>('');

  // Gig editor
  const [gigTitle, setGigTitle] = useState('');
  const [gigDescription, setGigDescription] = useState('');
  const [gigSegmentId, setGigSegmentId] = useState('');
  const [gigDuration, setGigDuration] = useState('60');
  const [gigPrice, setGigPrice] = useState('');

  // Availability editor (weekly windows + date exceptions)
  const [availabilityEditorOpen, setAvailabilityEditorOpen] = useState(false);
  const [availTimezone, setAvailTimezone] = useState('Asia/Kolkata');
  const [availRows, setAvailRows] = useState<Array<{ id?: string; dayOfWeek: number; startTime: string; endTime: string; isEnabled: boolean }>>([]);
  const [exceptionRows, setExceptionRows] = useState<Array<{ exceptionDate: string; isAvailable: boolean; startTime: string; endTime: string; reason: string }>>([]);


  const load = useCallback(async () => {
    if (!mentorId) {
      setError('Invalid mentor id.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/mentors/${encodeURIComponent(mentorId)}`);
      const data = await res.json();
      if (!res.ok || !data.success || !data.mentor) {
        throw new Error(data.error?.message || 'Unable to load mentor details.');
      }
      setMentor(data.mentor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load mentor details.');
    } finally {
      setLoading(false);
    }
  }, [mentorId]);


  useEffect(() => {
    load();
  }, [load]);


  // Derive account state from the LOADED database row (prompt section 13).
  const accountState = useMemo<MentorAccountState | null>(
    () =>
      mentor
        ? deriveMentorAccountState({
            approval_status: mentor.verification.approvalStatus,
            is_approved: mentor.verification.isApproved,
            is_active: mentor.account.isActive,
            account_status: mentor.account.accountStatus,
            suspended_until: mentor.account.suspendedUntil,
          })
        : null,
    [mentor],
  );

  const availableActions = accountState ? availableMentorStatusActions(accountState) : [];
  const badge = accountState ? mentorAccountBadge(accountState) : 'active';


  const runStatusAction = async (action: MentorStatusAction) => {
    setIsRunning(true);
    setActionError(null);
    setNotice(null);
    try {
      const res = await apiFetch(`/api/admin/mentors/${encodeURIComponent(mentorId)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          reason: reason.trim() || undefined,
          suspendedUntil: suspendedUntil ? new Date(suspendedUntil).toISOString() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error?.message || 'The action failed.');
      setNotice(data.message);
      setPendingAction(null);
      setReason('');
      setSuspendedUntil('');
      // Re-read from the database rather than trusting the response.
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'The action failed.');
    } finally {
      setIsRunning(false);
    }
  };


  // Lazily-loaded tab data. Bookings and the audit trail are fetched on demand
  // rather than with the mentor payload, so the page stays fast.
  const [bookings, setBookings] = useState<AdminMentorBooking[] | null>(null);
  const [auditEntries, setAuditEntries] = useState<AdminMentorAuditEntry[] | null>(null);
  const [segments, setSegments] = useState<AdminSegmentOption[]>([]);

  // Editable resource state (null = closed).
  const [editingProfile, setEditingProfile] = useState(false);
  const [segmentEditorOpen, setSegmentEditorOpen] = useState(false);
  const [gigEditor, setGigEditor] = useState<{ mode: 'create' | 'edit'; gig?: AdminMentorDetail['gigs'][number] } | null>(null);
  const [busy, setBusy] = useState(false);

  const [tabError, setTabError] = useState<string | null>(null);

  const loadBookings = useCallback(async () => {
    setTabError(null);
    try {
      const res = await apiFetch(`/api/admin/mentors/${encodeURIComponent(mentorId)}/bookings`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error?.message || 'Unable to load bookings.');
      setBookings(data.bookings || []);
    } catch (err) {
      setTabError(err instanceof Error ? err.message : 'Unable to load bookings.');
      setBookings([]);
    }
  }, [mentorId]);

  const loadAudit = useCallback(async () => {
    setTabError(null);
    try {
      const res = await apiFetch(`/api/admin/mentors/${encodeURIComponent(mentorId)}/audit`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error?.message || 'Unable to load the audit log.');
      setAuditEntries(data.entries || []);
    } catch (err) {
      setTabError(err instanceof Error ? err.message : 'Unable to load the audit log.');
      setAuditEntries([]);
    }
  }, [mentorId]);

  const loadSegments = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/segments');
      const data = await res.json();
      if (!res.ok || !data.success) return;
      setSegments(Array.isArray(data.segments) ? data.segments : []);
    } catch {
      // Non-fatal: the segment editor simply offers fewer options.
    }
  }, []);

  useEffect(() => {
    loadSegments();
  }, [loadSegments]);

  // Load the section the Admin is actually looking at.
  useEffect(() => {
    if (activeTab === 'bookings' && bookings === null) loadBookings();
    if (activeTab === 'audit' && auditEntries === null) loadAudit();
  }, [activeTab, bookings, auditEntries, loadBookings, loadAudit]);

  // Seed every editor from the LOADED database row, so a form never shows a
  // stale or invented value.
  useEffect(() => {
    if (!mentor) return;
    setFullName(mentor.profile.fullName || '');
    setPhone(mentor.profile.phone || '');
    setTimezone(mentor.profile.timezone || 'Asia/Kolkata');
    setHeadline(mentor.mentorProfile.headline || '');
    setBio(mentor.mentorProfile.about || '');
    setExperienceYears(String(mentor.mentorProfile.experienceYears ?? 0));
    setLanguages((mentor.mentorProfile.languages || []).join(', '));
    setExpertise((mentor.mentorProfile.expertise || []).join(', '));
    setSelectedSegmentIds(mentor.segments.map((s) => s.segmentId));
    setPrimarySegmentId(mentor.segments.find((s) => s.isPrimary)?.segmentId || '');
    setAvailTimezone(mentor.profile.timezone || 'Asia/Kolkata');
    setAvailRows(
      mentor.availability.map((rule) => ({
        id: rule.id,
        dayOfWeek: rule.dayOfWeek,
        startTime: rule.startTime.slice(0, 5),
        endTime: rule.endTime.slice(0, 5),
        isEnabled: rule.isEnabled,
      })),
    );
    setExceptionRows(
      mentor.availabilityExceptions.map((exception) => ({
        exceptionDate: exception.exceptionDate,
        isAvailable: exception.isAvailable,
        startTime: exception.startTime ? exception.startTime.slice(0, 5) : '',
        endTime: exception.endTime ? exception.endTime.slice(0, 5) : '',
        reason: exception.reason || '',
      })),
    );
  }, [mentor]);

  const parseTagList = (value: string): string[] =>
    value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);

  const saveProfile = () =>
    mutate(
      `/api/admin/mentors/${encodeURIComponent(mentorId)}/profile`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          fullName,
          phone,
          timezone,
          headline,
          bio,
          experienceYears: experienceYears === '' ? undefined : Number(experienceYears),
          languages: parseTagList(languages),
          expertise: parseTagList(expertise),
        }),
      },
      'Profile updated.',
    ).then((ok) => {
      if (ok) setEditingProfile(false);
    });

  const saveSegments = () =>
    mutate(
      `/api/admin/mentors/${encodeURIComponent(mentorId)}/segments`,
      {
        method: 'PUT',
        body: JSON.stringify({
          segmentIds: selectedSegmentIds,
          primarySegmentId: primarySegmentId || undefined,
        }),
      },
      'Segments updated.',
    ).then((ok) => {
      if (ok) setSegmentEditorOpen(false);
    });

  const openGigEditor = (mode: 'create' | 'edit', gig?: AdminMentorDetail['gigs'][number]) => {
    setActionError(null);
    if (mode === 'edit' && gig) {
      setGigTitle(gig.title);
      setGigDescription(gig.description);
      setGigSegmentId(gig.segmentId);
      setGigDuration(String(gig.durationMinutes));
      setGigPrice(String(gig.priceInr));
    } else {
      setGigTitle('');
      setGigDescription('');
      setGigSegmentId(segments[0]?.id || mentor?.segments[0]?.segmentId || '');
      setGigDuration('60');
      setGigPrice('');
    }
    setGigEditor({ mode, gig });
  };

  const saveGig = () =>
    mutate(
      gigEditor?.mode === 'edit' && gigEditor.gig
        ? `/api/admin/mentors/gigs/${encodeURIComponent(gigEditor.gig.id)}`
        : `/api/admin/mentors/${encodeURIComponent(mentorId)}/gigs`,
      {
        method: gigEditor?.mode === 'edit' ? 'PATCH' : 'POST',
        body: JSON.stringify({
          title: gigTitle,
          description: gigDescription,
          segmentId: gigSegmentId,
          durationMinutes: Number(gigDuration),
          priceInr: gigPrice === '' ? undefined : Number(gigPrice),
        }),
      },
      gigEditor?.mode === 'edit' ? 'Gig updated.' : 'Gig created.',
    ).then((ok) => {
      if (ok) setGigEditor(null);
    });

  const setGigActive = (gig: AdminMentorDetail['gigs'][number], isActive: boolean) =>
    mutate(
      `/api/admin/mentors/gigs/${encodeURIComponent(gig.id)}`,
      { method: 'PATCH', body: JSON.stringify({ isActive }) },
      isActive ? 'Gig activated.' : 'Gig deactivated.',
    );

  const archiveGig = (gig: AdminMentorDetail['gigs'][number]) =>
    mutate(
      `/api/admin/mentors/gigs/${encodeURIComponent(gig.id)}/archive`,
      { method: 'PATCH' },
      'Gig archived. Booking history is preserved.',
    );

  const saveAvailability = async () => {
    const okRules = await mutate(
      `/api/admin/mentors/${encodeURIComponent(mentorId)}/availability`,
      {
        method: 'PUT',
        body: JSON.stringify({
          timezone: availTimezone,
          rules: availRows
            .filter((row) => row.startTime && row.endTime)
            .map((row) => ({
              dayOfWeek: row.dayOfWeek,
              startTime: row.startTime,
              endTime: row.endTime,
              isEnabled: row.isEnabled,
            })),
        }),
      },
      'Availability updated.',
    );
    if (!okRules) return;

    const okExceptions = await mutate(
      `/api/admin/mentors/${encodeURIComponent(mentorId)}/availability/exceptions`,
      {
        method: 'PUT',
        body: JSON.stringify({
          exceptions: exceptionRows
            .filter((row) => row.exceptionDate)
            .map((row) => ({
              exceptionDate: row.exceptionDate,
              isAvailable: row.isAvailable,
              startTime: row.isAvailable ? row.startTime || null : null,
              endTime: row.isAvailable ? row.endTime || null : null,
              reason: row.reason || null,
            })),
        }),
      },
      'Date exceptions updated.',
    );
    if (okExceptions) setAvailabilityEditorOpen(false);
  };

  // Run a mutation and refresh the mentor from the database afterwards, so the
  // UI always reflects persisted state rather than a local guess.
  const mutate = async (path: string, init: RequestInit, successMessage: string) => {
    setBusy(true);
    setActionError(null);
    setTabError(null);
    try {
      const res = await apiFetch(path, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error?.message || 'The change failed.');
      setNotice(successMessage);
      await load();
      if (activeTab === 'audit') await loadAudit();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The change failed.';
      setActionError(message);
      setTabError(message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <LoadingState message="Loading mentor control center…" />;
  }

  if (error || !mentor || !accountState) {
    return (
      <div className="space-y-4">
        <BackLink onClick={() => navigate('/admin/mentors')} />
        <ErrorState
          title="Mentor not available"
          message={error || 'This mentor could not be loaded.'}
          onRetry={load}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <BackLink onClick={() => navigate('/admin/mentors')} />

      {/* ============ HEADER (prompt section 7) ============ */}
      <header className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[var(--color-shell-surface-elevated)] text-xl font-bold text-[var(--color-shell-text-muted)]">
              {mentor.profile.avatarUrl ? (
                <img src={mentor.profile.avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                (mentor.profile.fullName || 'M').charAt(0).toUpperCase()
              )}
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight text-[var(--color-shell-text)]">
                {mentor.profile.fullName || 'Unnamed mentor'}
              </h1>
              <p className="mt-0.5 font-mono text-xs text-[var(--color-shell-text-muted)]">
                {mentor.profile.email}
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary" className="text-[10px]">Mentor</Badge>
                <Badge variant={accountState.isApproved ? 'success' : 'warning'} className="text-[10px]">
                  {accountState.isApproved ? '✓ Verified' : 'Pending Verification'}
                </Badge>
                <Badge variant={accountState.isEligible ? 'success' : 'destructive'} className="text-[10px]">
                  {accountState.isEligible ? '● Active' : MENTOR_ACCOUNT_BADGE_LABELS[badge]}
                </Badge>
                {!accountState.isEligible && (
                  <Badge variant="outline" className="text-[10px]">Not discoverable</Badge>
                )}
              </div>
              <p className="mt-2 text-[11px] text-[var(--color-shell-text-subtle)]">
                Created {formatDate(mentor.creation.createdAt)} · Updated {formatDate(mentor.profile.updatedAt, true)}
              </p>
            </div>
          </div>

          {/* Real server-side operations - never UI-only. */}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => { setEditingProfile(true); setActiveTab('profile'); }}
            >
              <Pencil className="h-3.5 w-3.5" />
              <span>Edit Profile</span>
            </Button>
            {availableActions.map((action) => (
              <Button
                key={action}
                size="sm"
                variant={action === 'activate' || action === 'reactivate' ? 'default' : 'destructive'}
                onClick={() => {
                  setPendingAction(action);
                  setActionError(null);
                  setReason('');
                  setSuspendedUntil('');
                }}
              >
                {MENTOR_STATUS_ACTION_SPECS[action].label}
              </Button>
            ))}
          </div>
        </div>
      </header>

      {notice && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--color-shell-success-border)] bg-[var(--color-shell-success-soft)] p-3 text-xs text-[var(--color-shell-success)]">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* ============ TABS (prompt section 6 / 21) ============ */}
      <ControlTabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'profile', label: 'Profile' },
          { id: 'verification', label: 'Verification' },
          { id: 'segments', label: 'Segments', count: mentor.segments.length },
          { id: 'gigs', label: 'Gigs', count: mentor.gigs.length },
          { id: 'availability', label: 'Availability' },
          { id: 'bookings', label: 'Bookings', count: bookings?.length },
          { id: 'account', label: 'Account Status' },
          { id: 'audit', label: 'Audit Log', count: auditEntries?.length },
        ]}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {tabError && <InlineError message={tabError} />}

      {activeTab === 'overview' && (
        <div className="space-y-4">
          {!mentor.mentorProfile.exists && (
            <div className="flex items-start gap-3 rounded-lg border border-[var(--color-shell-warning)]/30 bg-[var(--color-shell-warning-soft)] p-3 text-xs text-[var(--color-shell-warning)]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                This account holds the mentor role but has no mentor profile row yet, so it cannot be
                discovered or booked. Use the Verification tab to review its application.
              </span>
            </div>
          )}
          <Section title="At a glance">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field label="Role" value={mentor.roles.includes('mentor') ? 'Mentor' : mentor.roles.join(', ')} />
              <Field label="Approval" value={mentor.verification.approvalStatus ?? '—'} />
              <Field label="Account" value={mentor.account.accountStatus} />
              <Field label="is_active" value={String(mentor.account.isActive)} />
              <Field label="Source" value={MENTOR_CREATION_SOURCE_LABELS[mentor.creation.source]} />
              <Field label="Segments" value={String(mentor.segments.length)} />
              <Field label="Active gigs" value={String(mentor.gigs.filter((g) => g.isActive).length)} />
              <Field label="Sessions" value={String(mentor.mentorProfile.sessionCount ?? 0)} />
            </dl>
          </Section>
          <Section title="Discovery readiness">
            <ul className="space-y-1.5 text-xs">
              <ReadinessRow ok={accountState.isApproved} label="Approved" />
              <ReadinessRow ok={mentor.account.isActive} label="Active account" />
              <ReadinessRow ok={!accountState.isSuspended && !accountState.isDeactivated} label="Not suspended or deactivated" />
              <ReadinessRow ok={mentor.segments.length > 0} label="Has an eligible segment" />
              <ReadinessRow ok={mentor.gigs.some((g) => g.isActive)} label="Has an active gig" />
              <ReadinessRow ok={mentor.availability.length > 0} label="Has recurring availability" />
            </ul>
            <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
              A mentor only appears in seeker discovery when every row above is satisfied AND a valid
              bookable slot exists on the selected date.
            </p>
          </Section>
        </div>
      )}

      {activeTab === 'profile' && (
        <Section
          title="Profile"
          action={
            <Button size="sm" variant={editingProfile ? 'default' : 'outline'} className="gap-1.5" onClick={() => setEditingProfile((v) => !v)}>
              <Pencil className="h-3.5 w-3.5" />
              <span>{editingProfile ? 'Cancel' : 'Edit'}</span>
            </Button>
          }
        >
          {editingProfile ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
                <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
                <Input label="Timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
                <Input label="Years of experience" type="number" min={0} value={experienceYears} onChange={(e) => setExperienceYears(e.target.value)} />
              </div>
              <Input label="Headline" value={headline} onChange={(e) => setHeadline(e.target.value)} />
              <Textarea label="Bio" value={bio} onChange={(e) => setBio(e.target.value)} rows={5} />
              <Input label="Languages" value={languages} onChange={(e) => setLanguages(e.target.value)} helperText="Comma separated." />
              <Input label="Expertise" value={expertise} onChange={(e) => setExpertise(e.target.value)} helperText="Comma separated." />
              {actionError && <InlineError message={actionError} />}
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditingProfile(false)}>Cancel</Button>
                <Button size="sm" isLoading={busy} onClick={saveProfile}>Save changes</Button>
              </div>
            </div>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Field label="Display name" value={mentor.profile.fullName || '—'} />
                <Field label="Email" value={mentor.profile.email} />
                <Field label="Phone" value={mentor.profile.phone || '—'} />
                <Field label="Timezone" value={mentor.profile.timezone || '—'} />
                <Field label="Headline" value={mentor.mentorProfile.headline || '—'} />
                <Field label="Years of experience" value={String(mentor.mentorProfile.experienceYears ?? 0)} />
                <Field label="Languages" value={(mentor.mentorProfile.languages || []).join(', ') || '—'} />
                <Field label="Expertise" value={(mentor.mentorProfile.expertise || []).join(', ') || '—'} />
                <Field label="Created" value={formatDate(mentor.profile.createdAt)} />
                <Field label="Updated" value={formatDate(mentor.profile.updatedAt, true)} />
                <Field label="Mentor record updated" value={formatDate(mentor.mentorProfile.updatedAt, true)} />
              </dl>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-shell-text-subtle)]">Bio</p>
                <p className="mt-1 whitespace-pre-wrap rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] p-3 text-xs leading-relaxed text-[var(--color-shell-text)]">
                  {mentor.mentorProfile.about || 'No bio provided.'}
                </p>
              </div>
            </>
          )}
        </Section>
      )}

      {activeTab === 'verification' && (
        <Section title="Verification">
          {isAdminCreatedMentor(mentor.creation.source) ? (
            /* ADMIN-CREATED MENTOR: an application is NOT required, so this is a
               success state, never an error/empty state (prompt sections 2, 5, 9). */
            <div className="space-y-3">
              <div className="flex items-start gap-3 rounded-lg border border-[var(--color-shell-success-border)] bg-[var(--color-shell-success-soft)] p-4">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-shell-success)]" />
                <div className="space-y-1">
                  <p className="text-sm font-bold text-[var(--color-shell-success)]">Admin Verified Mentor</p>
                  <p className="text-xs leading-relaxed text-[var(--color-shell-text-muted)]">
                    {ADMIN_CREATED_MENTOR_HELPER}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant={mentor.verification.isApproved ? 'success' : 'warning'} className="text-[10px]">✓ Approved</Badge>
                <Badge variant={mentor.account.isActive ? 'success' : 'destructive'} className="text-[10px]">
                  {mentor.account.isActive ? '✓ Active' : '○ Inactive'}
                </Badge>
                <Badge variant="outline" className="text-[10px]">No application required</Badge>
              </div>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Field label="Source" value={MENTOR_CREATION_SOURCE_LABELS[mentor.creation.source]} />
                <Field label="Created by" value={mentor.creation.createdBy?.full_name || mentor.creation.createdBy?.email || 'Administrator'} />
                <Field label="Created date" value={formatDate(mentor.creation.createdAt, true)} />
              </dl>
              <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
                There is nothing to approve here. The Admin&apos;s creation action was the approval.
              </p>
            </div>
          ) : (
            <PublicVerification mentor={mentor} />
          )}
        </Section>
      )}

      {activeTab === 'segments' && (
        <Section
          title="Segments"
          action={
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setActionError(null); setSegmentEditorOpen(true); }}>
              <Pencil className="h-3.5 w-3.5" />
              <span>Manage</span>
            </Button>
          }
        >
          {mentor.segments.length === 0 ? (
            <p className="text-xs text-[var(--color-shell-text-subtle)]">
              No segments assigned. Without an eligible segment the mentor will not appear in discovery.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {mentor.segments.map((segment) => (
                <li key={segment.segmentId}>
                  <Badge variant={segment.isActive ? 'secondary' : 'destructive'} className="text-[10px]">
                    {segment.name || segment.segmentId}
                    {segment.isPrimary ? ' · primary' : ''}
                    {segment.isActive === false ? ' · inactive' : ''}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
            Segments are loaded from the database. Nothing is hardcoded.
          </p>
        </Section>
      )}

      {activeTab === 'gigs' && (
        <Section
          title="Gigs"
          action={
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openGigEditor('create')}>
              <Plus className="h-3.5 w-3.5" />
              <span>Add Gig</span>
            </Button>
          }
        >
          {mentor.gigs.length === 0 ? (
            <p className="text-xs text-[var(--color-shell-text-subtle)]">
              No gigs. A mentor needs an active gig to appear in discovery.
            </p>
          ) : (
            <ul className="space-y-2">
              {mentor.gigs.map((gig) => (
                <li key={gig.id} className="rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] p-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-[var(--color-shell-text)]">{gig.title}</span>
                    <Badge variant={gig.isActive ? 'success' : 'secondary'} className="text-[10px]">
                      {gig.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-[var(--color-shell-text-muted)]">
                    <span>Segment: {gig.segmentName || '—'}</span>
                    <span>₹{gig.priceInr} INR</span>
                    <span>{gig.durationMinutes} min</span>
                    <span>Created {formatDate(gig.createdAt)}</span>
                    <span>Updated {formatDate(gig.updatedAt, true)}</span>
                  </div>
                  {gig.description && (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-shell-text-subtle)]">{gig.description}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" className="h-7 gap-1 py-1 text-[11px]" onClick={() => openGigEditor('edit', gig)}>
                      <Pencil className="h-3 w-3" /> Edit
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 py-1 text-[11px]" isLoading={busy} onClick={() => setGigActive(gig, !gig.isActive)}>
                      {gig.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 gap-1 py-1 text-[11px]" isLoading={busy} onClick={() => archiveGig(gig)}>
                      <Trash2 className="h-3 w-3" /> Archive
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
            Archiving sets the gig inactive; it is never deleted, so booking and payment history keeps
            its reference. One active gig per mentor + segment is enforced by a database index.
          </p>
        </Section>
      )}

      {activeTab === 'availability' && (
        <Section
          title="Availability"
          action={
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setActionError(null); setAvailabilityEditorOpen(true); }}>
              <Pencil className="h-3.5 w-3.5" />
              <span>Manage</span>
            </Button>
          }
        >
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-shell-text-subtle)]">
              Weekly recurring hours
            </p>
            {mentor.availability.length === 0 ? (
              <p className="mt-1 text-xs text-[var(--color-shell-text-subtle)]">No recurring availability configured.</p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {DAYS_OF_WEEK.map(({ name, index }) => {
                  const windows = mentor.availability.filter((rule) => rule.dayOfWeek === index);
                  return (
                    <li key={name} className="flex items-center justify-between text-xs">
                      <span className="text-[var(--color-shell-text)]">{name}</span>
                      <span className="font-mono text-[var(--color-shell-text-muted)]">
                        {windows.length === 0
                          ? '—'
                          : windows.map((w) => `${formatTime(w.startTime)}–${formatTime(w.endTime)}`).join(', ')}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-shell-text-subtle)]">
              Date exceptions
            </p>
            {mentor.availabilityExceptions.length === 0 ? (
              <p className="mt-1 text-xs text-[var(--color-shell-text-subtle)]">No date exceptions.</p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {mentor.availabilityExceptions.map((exception) => (
                  <li key={exception.id} className="flex items-center justify-between text-xs">
                    <span className="font-mono text-[var(--color-shell-text)]">{exception.exceptionDate}</span>
                    <span className="text-[var(--color-shell-text-muted)]">
                      {exception.isAvailable
                        ? `${formatTime(exception.startTime)} – ${formatTime(exception.endTime)}`
                        : 'Unavailable'}
                      {exception.reason ? ` · ${exception.reason}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
            Availability is GLOBAL to the mentor and is never attached to an individual gig.
          </p>
        </Section>
      )}

      {activeTab === 'bookings' && (
        <Section title="Bookings" action={<Button size="sm" variant="outline" onClick={loadBookings}>Refresh</Button>}>
          {bookings === null ? (
            <LoadingState message="Loading bookings…" />
          ) : bookings.length === 0 ? (
            <p className="text-xs text-[var(--color-shell-text-subtle)]">No bookings yet.</p>
          ) : (
            <ul className="space-y-2">
              {bookings.map((booking) => (
                <li key={booking.id} className="rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] p-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-[var(--color-shell-text)]">{booking.bookingCode}</span>
                    <div className="flex gap-1.5">
                      <Badge variant="secondary" className="text-[10px]">{booking.status}</Badge>
                      {booking.payment && (
                        <Badge variant={booking.payment.status === 'VERIFIED' ? 'success' : booking.payment.status === 'REJECTED' ? 'destructive' : 'warning'} className="text-[10px]">
                          Payment: {booking.payment.status}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-[var(--color-shell-text-muted)]">
                    <span>Seeker: {booking.seeker?.full_name || booking.seeker?.email || '—'}</span>
                    <span>{formatDate(booking.startTime, true)}</span>
                    <span>₹{booking.amountInr} INR</span>
                    <span>{booking.isUpcoming ? 'Upcoming' : 'Past'}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
            Deactivating or suspending a mentor never removes booking or payment history.
          </p>
        </Section>
      )}

      {activeTab === 'account' && (
        <Section title="Account Status">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={accountState.isEligible ? 'success' : 'destructive'} className="text-[10px]">
              {MENTOR_ACCOUNT_BADGE_LABELS[badge]}
            </Badge>
            <Badge variant="outline" className="text-[10px]">is_active: {String(mentor.account.isActive)}</Badge>
            <Badge variant="outline" className="text-[10px]">account_status: {mentor.account.accountStatus}</Badge>
            <Badge variant="outline" className="text-[10px]">approval_status: {mentor.verification.approvalStatus ?? '—'}</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {availableActions.map((action) => (
              <Button
                key={action}
                size="sm"
                variant={action === 'activate' || action === 'reactivate' ? 'default' : 'destructive'}
                onClick={() => {
                  setPendingAction(action);
                  setActionError(null);
                  setReason('');
                  setSuspendedUntil('');
                }}
              >
                {MENTOR_STATUS_ACTION_SPECS[action].label}
              </Button>
            ))}
          </div>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Suspended at" value={formatDate(mentor.account.suspendedAt, true)} />
            <Field label="Suspended until" value={formatDate(mentor.account.suspendedUntil, true)} />
            <Field label="Deactivated at" value={formatDate(mentor.account.deactivatedAt, true)} />
          </dl>
          {mentor.account.suspensionReason && (
            <p className="rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] p-3 text-xs text-[var(--color-shell-text-muted)]">
              <span className="font-semibold text-[var(--color-shell-text)]">Suspension reason:</span>{' '}
              {mentor.account.suspensionReason}
            </p>
          )}
          {mentor.account.internalNote && (
            <p className="rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] p-3 text-xs text-[var(--color-shell-text-muted)]">
              <span className="font-semibold text-[var(--color-shell-text)]">Internal note:</span>{' '}
              {mentor.account.internalNote}
            </p>
          )}
          <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
            Activate, Deactivate, Suspend and Reactivate are permanent Admin powers. Reactivation never
            re-opens verification. Deactivation is a status change only: profile, gigs, availability,
            bookings, payments, workspaces, notifications and audit records are all preserved.
          </p>
        </Section>
      )}

      {activeTab === 'audit' && (
        <Section title="Audit Log" action={<Button size="sm" variant="outline" onClick={loadAudit}>Refresh</Button>}>
          {auditEntries === null ? (
            <LoadingState message="Loading audit log…" />
          ) : auditEntries.length === 0 ? (
            <p className="text-xs text-[var(--color-shell-text-subtle)]">No audit events recorded yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {auditEntries.map((entry) => (
                <li key={entry.id} className="rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] p-2.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-[var(--color-shell-text)]">{entry.action}</span>
                    <span className="text-[11px] text-[var(--color-shell-text-subtle)]">{formatDate(entry.createdAt, true)}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-[var(--color-shell-text-muted)]">
                    {entry.actor?.name || entry.actor?.email || 'System'}
                    {entry.entityType ? ` · ${entry.entityType}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
            Read from the existing audit_logs table. No separate audit system is used.
          </p>
        </Section>
      )}

      {/* ---- Status action confirmation ---- */}
      <Modal
        isOpen={pendingAction !== null}
        onClose={() => { if (!isRunning) setPendingAction(null); }}
        title={pendingAction ? MENTOR_STATUS_ACTION_SPECS[pendingAction].label : ''}
        description={
          pendingAction === 'deactivate'
            ? 'The mentor immediately disappears from seeker discovery and cannot perform operational actions. No data is deleted.'
            : pendingAction === 'suspend'
              ? 'The mentor is not discoverable and cannot receive new bookings. Historical data is preserved.'
              : pendingAction === 'reactivate'
                ? 'Suspension is lifted. No new verification is required.'
                : 'The mentor becomes eligible again, subject to the normal discovery requirements.'
        }
      >
        <div className="space-y-3 pt-1">
          {pendingAction && MENTOR_STATUS_ACTION_SPECS[pendingAction].requiresReason && (
            <Input
              label="Reason"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Repeated no-shows"
            />
          )}
          {pendingAction === 'suspend' && (
            <Input
              label="Suspended until (optional)"
              type="datetime-local"
              value={suspendedUntil}
              onChange={(e) => setSuspendedUntil(e.target.value)}
              helperText="Leave blank for an indefinite suspension."
            />
          )}
          {actionError && <InlineError message={actionError} />}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setPendingAction(null)} disabled={isRunning}>Cancel</Button>
            <Button
              size="sm"
              variant={pendingAction === 'activate' || pendingAction === 'reactivate' ? 'default' : 'destructive'}
              isLoading={isRunning}
              onClick={() => pendingAction && runStatusAction(pendingAction)}
            >
              Confirm
            </Button>
          </div>
        </div>
      </Modal>

      {/* ---- Segment manager ---- */}
      <Modal
        isOpen={segmentEditorOpen}
        onClose={() => { if (!busy) setSegmentEditorOpen(false); }}
        title="Manage segments"
        description="Assign the segments this mentor is authorized to offer. Loaded from the database."
        maxWidth="lg"
      >
        <div className="space-y-3 pt-1">
          {segments.length === 0 ? (
            <p className="text-xs text-[var(--color-shell-text-subtle)]">No segments available.</p>
          ) : (
            <ul className="space-y-1.5">
              {segments.map((segment) => {
                const checked = selectedSegmentIds.includes(segment.id);
                return (
                  <li
                    key={segment.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] p-2.5 text-xs"
                  >
                    <label className="flex flex-1 cursor-pointer items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!segment.is_active}
                        onChange={(e) => {
                          setSelectedSegmentIds((current) =>
                            e.target.checked ? [...current, segment.id] : current.filter((id) => id !== segment.id),
                          );
                          if (!e.target.checked && primarySegmentId === segment.id) setPrimarySegmentId('');
                        }}
                        className="h-4 w-4 accent-[var(--color-shell-primary)]"
                      />
                      <span className={segment.is_active ? 'text-[var(--color-shell-text)]' : 'text-[var(--color-shell-text-subtle)] line-through'}>
                        {segment.name}
                      </span>
                      {!segment.is_active && <Badge variant="destructive" className="text-[10px]">Inactive</Badge>}
                    </label>
                    <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-[var(--color-shell-text-muted)]">
                      <input
                        type="radio"
                        name="primary-segment"
                        checked={primarySegmentId === segment.id}
                        disabled={!checked}
                        onChange={() => setPrimarySegmentId(segment.id)}
                        className="accent-[var(--color-shell-primary)]"
                      />
                      Primary
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {actionError && <InlineError message={actionError} />}
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => setSegmentEditorOpen(false)} disabled={busy}>Cancel</Button>
            <Button size="sm" isLoading={busy} onClick={saveSegments}>Save segments</Button>
          </div>
        </div>
      </Modal>

      {/* ---- Gig editor ---- */}
      <Modal
        isOpen={gigEditor !== null}
        onClose={() => { if (!busy) setGigEditor(null); }}
        title={gigEditor?.mode === 'edit' ? 'Edit gig' : 'Add gig'}
        description="Price is in INR. One active gig per mentor + segment is enforced by the database."
        maxWidth="lg"
      >
        <div className="space-y-3 pt-1">
          <Input label="Title" required value={gigTitle} onChange={(e) => setGigTitle(e.target.value)} />
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-[var(--color-shell-text)]">Segment</label>
            <select
              value={gigSegmentId}
              onChange={(e) => setGigSegmentId(e.target.value)}
              className="w-full h-12 rounded-lg border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] px-3 text-sm text-[var(--color-shell-text)] focus:border-[var(--color-shell-accent)] focus:outline-none"
            >
              <option value="">Select a segment</option>
              {segments.filter((s) => s.is_active).map((segment) => (
                <option key={segment.id} value={segment.id}>{segment.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-[var(--color-shell-text)]">Duration (minutes)</label>
              <select
                value={gigDuration}
                onChange={(e) => setGigDuration(e.target.value)}
                className="w-full h-12 rounded-lg border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] px-3 text-sm text-[var(--color-shell-text)] focus:border-[var(--color-shell-accent)] focus:outline-none"
              >
                {[30, 45, 60, 90, 120].map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <Input label="Price (INR)" type="number" min={0} value={gigPrice} onChange={(e) => setGigPrice(e.target.value)} />
          </div>
          <Textarea label="Description" value={gigDescription} onChange={(e) => setGigDescription(e.target.value)} rows={3} />
          {actionError && <InlineError message={actionError} />}
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => setGigEditor(null)} disabled={busy}>Cancel</Button>
            <Button size="sm" isLoading={busy} onClick={saveGig}>
              {gigEditor?.mode === 'edit' ? 'Save gig' : 'Create gig'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ---- Availability editor (global, mentor level) ---- */}
      <Modal
        isOpen={availabilityEditorOpen}
        onClose={() => { if (!busy) setAvailabilityEditorOpen(false); }}
        title="Manage availability"
        description="Availability is global to the mentor and is never attached to an individual gig."
        maxWidth="2xl"
      >
        <div className="max-h-[60vh] space-y-4 overflow-y-auto pt-1">
          <Input label="Timezone" value={availTimezone} onChange={(e) => setAvailTimezone(e.target.value)} />

          <div>
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-shell-text-subtle)]">
                Weekly recurring hours
              </p>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 py-1 text-[11px]"
                onClick={() => setAvailRows((rows) => [...rows, { dayOfWeek: 1, startTime: '10:00', endTime: '13:00', isEnabled: true }])}
              >
                <Plus className="h-3 w-3" /> Add window
              </Button>
            </div>
            {availRows.length === 0 ? (
              <p className="mt-1.5 text-xs text-[var(--color-shell-text-subtle)]">No recurring windows.</p>
            ) : (
              <ul className="mt-1.5 space-y-1.5">
                {availRows.map((row, index) => (
                  <li key={index} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] p-2">
                    <select
                      value={row.dayOfWeek}
                      onChange={(e) => setAvailRows((rows) => rows.map((r, i) => (i === index ? { ...r, dayOfWeek: Number(e.target.value) } : r)))}
                      className="h-9 rounded-lg border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] px-2 text-xs"
                    >
                      {DAYS_OF_WEEK.map(({ name, index: dayIndex }) => (
                        <option key={name} value={dayIndex}>{name}</option>
                      ))}
                    </select>
                    <input
                      type="time"
                      value={row.startTime}
                      onChange={(e) => setAvailRows((rows) => rows.map((r, i) => (i === index ? { ...r, startTime: e.target.value } : r)))}
                      className="h-9 rounded-lg border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] px-2 text-xs"
                    />
                    <span className="text-xs text-[var(--color-shell-text-subtle)]">to</span>
                    <input
                      type="time"
                      value={row.endTime}
                      onChange={(e) => setAvailRows((rows) => rows.map((r, i) => (i === index ? { ...r, endTime: e.target.value } : r)))}
                      className="h-9 rounded-lg border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] px-2 text-xs"
                    />
                    <label className="flex items-center gap-1.5 text-[11px] text-[var(--color-shell-text-muted)]">
                      <input
                        type="checkbox"
                        checked={row.isEnabled}
                        onChange={(e) => setAvailRows((rows) => rows.map((r, i) => (i === index ? { ...r, isEnabled: e.target.checked } : r)))}
                        className="accent-[var(--color-shell-primary)]"
                      />
                      Enabled
                    </label>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto h-7 px-2 py-1"
                      onClick={() => setAvailRows((rows) => rows.filter((_, i) => i !== index))}
                      aria-label="Remove window"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-shell-text-subtle)]">
                Date exceptions
              </p>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 py-1 text-[11px]"
                onClick={() => setExceptionRows((rows) => [...rows, { exceptionDate: '', isAvailable: false, startTime: '', endTime: '', reason: '' }])}
              >
                <Plus className="h-3 w-3" /> Add exception
              </Button>
            </div>
            {exceptionRows.length === 0 ? (
              <p className="mt-1.5 text-xs text-[var(--color-shell-text-subtle)]">No date exceptions.</p>
            ) : (
              <ul className="mt-1.5 space-y-1.5">
                {exceptionRows.map((row, index) => (
                  <li key={index} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] p-2">
                    <input
                      type="date"
                      value={row.exceptionDate}
                      onChange={(e) => setExceptionRows((rows) => rows.map((r, i) => (i === index ? { ...r, exceptionDate: e.target.value } : r)))}
                      className="h-9 rounded-lg border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] px-2 text-xs"
                    />
                    <label className="flex items-center gap-1.5 text-[11px] text-[var(--color-shell-text-muted)]">
                      <input
                        type="checkbox"
                        checked={row.isAvailable}
                        onChange={(e) => setExceptionRows((rows) => rows.map((r, i) => (i === index ? { ...r, isAvailable: e.target.checked } : r)))}
                        className="accent-[var(--color-shell-primary)]"
                      />
                      Available
                    </label>
                    {row.isAvailable && (
                      <>
                        <input
                          type="time"
                          value={row.startTime}
                          onChange={(e) => setExceptionRows((rows) => rows.map((r, i) => (i === index ? { ...r, startTime: e.target.value } : r)))}
                          className="h-9 rounded-lg border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] px-2 text-xs"
                        />
                        <input
                          type="time"
                          value={row.endTime}
                          onChange={(e) => setExceptionRows((rows) => rows.map((r, i) => (i === index ? { ...r, endTime: e.target.value } : r)))}
                          className="h-9 rounded-lg border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] px-2 text-xs"
                        />
                      </>
                    )}
                    <input
                      type="text"
                      placeholder="Reason"
                      value={row.reason}
                      onChange={(e) => setExceptionRows((rows) => rows.map((r, i) => (i === index ? { ...r, reason: e.target.value } : r)))}
                      className="h-9 min-w-[120px] flex-1 rounded-lg border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] px-2 text-xs"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto h-7 px-2 py-1"
                      onClick={() => setExceptionRows((rows) => rows.filter((_, i) => i !== index))}
                      aria-label="Remove exception"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {actionError && <InlineError message={actionError} />}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setAvailabilityEditorOpen(false)} disabled={busy}>Cancel</Button>
            <Button size="sm" isLoading={busy} onClick={saveAvailability}>Save availability</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
