/**
 * Admin User Detail (/admin/users/:userId)
 *
 * "Account & Operations Control Center" for one user account.
 *
 * Everything rendered here is read from the Admin-gated API and every control
 * calls a server-authorized endpoint. There is no UI-only state and no
 * hardcoded business data: status, bookings, payments, workspaces,
 * notifications and audit entries all come from Supabase.
 *
 * Role-aware: a SEEKER gets the seeker tabs, a MENTOR additionally gets
 * verification, and an ADMIN account is shown administrative information with
 * the destructive status controls withheld (an Admin must never be able to
 * lock the platform out of its own admin area).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Download,
  KeyRound,
  Mail,
  Pencil,
  Plus,
  ShieldAlert,
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
  ACCOUNT_BADGE_LABELS,
  ACCOUNT_STATUS_ACTION_SPECS,
  availableAccountStatusActions,
  deriveAccountState,
  type AccountBadge,
  type AccountState,
  type AccountStatusAction,
} from '@/src/lib/adminAccountControl';
import {
  MENTOR_CREATION_SOURCE_LABELS,
  resolveMentorCreationSource,
  type MentorCreationSource,
} from '@/src/lib/adminMentorControl';

// ---------------------------------------------------------------------------
// API shapes
// ---------------------------------------------------------------------------

interface UserProfile {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  timezone: string | null;
  phone: string | null;
  account_status: string | null;
  suspended_at: string | null;
  suspended_until: string | null;
  suspension_reason: string | null;
  suspended_by: string | null;
  deactivated_at: string | null;
  internal_note: string | null;
  created_at: string;
  updated_at: string;
}

interface UserApplication {
  id: string;
  status: string;
  bio: string | null;
  full_name: string;
  headline: string | null;
  years_of_experience: number | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
}

interface UserDocument {
  id: string;
  document_type: string;
  original_filename: string;
  status: string;
  admin_note: string | null;
  uploaded_at: string;
  download_url?: string | null;
}

interface UserDetail {
  profile: UserProfile;
  roles: string[];
  mentorProfile: {
    headline?: string;
    about?: string | null;
    experience_years?: number;
    approval_status?: string | null;
    is_active?: boolean;
    created_via?: string | null;
  } | null;
  application: UserApplication | null;
  documents: UserDocument[];
  segments: Array<{ id: string; segment?: { name?: string; slug?: string } | null }>;
  auth: {
    invitationStatus: 'pending' | 'sent' | 'accepted';
    createdAt: string | null;
    invitedAt: string | null;
    lastSignInAt: string | null;
    emailConfirmedAt: string | null;
  } | null;
  safety: { isAdmin: boolean; isActive: boolean; activeAdminCount: number };
  summary: {
    upcomingBookings: number;
    completedBookings: number;
    gigs: number;
    activeGigs: number;
    payments: number;
    segments: number;
    workspaces: number;
    notifications: number;
    unreadNotifications: number;
  };
}

interface UserBooking {
  id: string;
  bookingCode: string;
  startTime: string;
  endTime: string;
  status: string;
  amountInr: number;
  meetingUrl: string | null;
  cancellationReason: string | null;
  createdAt: string;
  isUpcoming: boolean;
  seeker: { id: string; full_name: string | null; email: string | null } | null;
  mentor: { id: string; full_name: string | null; email: string | null } | null;
  gig: { id: string; title: string; duration_minutes: number; price_inr: number } | null;
  segment: { id: string; name: string; slug: string } | null;
  payment: { id: string; status: string; amountInr: number; verifiedAt: string | null } | null;
  workspace: { id: string; status: string; publishedAt: string | null } | null;
}

interface UserPayment {
  id: string;
  amountInr: number;
  currency: string;
  status: string;
  transactionReference: string | null;
  hasProof: boolean;
  verifiedAt: string | null;
  verifiedBy: { id: string; name: string | null } | null;
  rejectionReason: string | null;
  createdAt: string;
  booking: {
    id: string;
    bookingCode: string;
    startTime: string;
    status: string;
    gigTitle: string | null;
    segmentName: string | null;
    mentor: { id: string; full_name: string | null; email: string | null } | null;
  } | null;
}

interface UserWorkspace {
  id: string;
  bookingId: string;
  status: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  mentor: { id: string; full_name: string | null; email: string | null } | null;
  seeker: { id: string; full_name: string | null; email: string | null } | null;
  booking: {
    id: string;
    booking_code: string;
    start_time: string;
    end_time: string;
    status: string;
    segment: { id: string; name: string } | null;
  } | null;
}

interface UserNotification {
  id: string;
  type: string;
  event_type: string | null;
  title: string;
  message: string;
  link: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  entity_type: string | null;
  entity_id: string | null;
}

interface AuditEntry {
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

// ---------------------------------------------------------------------------
// Presentational helpers
// ---------------------------------------------------------------------------

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

function InlineError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-[var(--color-shell-error)] bg-[var(--color-shell-error-soft)] p-2.5 text-xs text-[var(--color-shell-error)]">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function InlineNotice({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-[var(--color-shell-success-border)] bg-[var(--color-shell-success-soft)] p-2.5 text-xs text-[var(--color-shell-success)]">
      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function InlineWarning({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-[var(--color-shell-warning)]/30 bg-[var(--color-shell-warning-soft)] p-2.5 text-xs text-[var(--color-shell-warning)]">
      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function SummaryCard({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-shell-text-subtle)]">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold tracking-tight text-[var(--color-shell-text)]">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-[var(--color-shell-text-subtle)]">{hint}</p>}
    </div>
  );
}

const BADGE_VARIANT: Record<AccountBadge, 'success' | 'warning' | 'destructive' | 'secondary'> = {
  active: 'success',
  deactivated: 'secondary',
  suspended: 'destructive',
  suspended_lapsed: 'warning',
};

const PAYMENT_VARIANT: Record<string, 'success' | 'destructive' | 'warning' | 'secondary'> = {
  VERIFIED: 'success',
  REJECTED: 'destructive',
  PENDING_VERIFICATION: 'warning',
};

const BOOKING_VARIANT: Record<string, 'success' | 'destructive' | 'warning' | 'secondary'> = {
  CONFIRMED: 'success',
  COMPLETED: 'success',
  CANCELLED: 'secondary',
  REJECTED: 'destructive',
  MENTOR_PENDING: 'warning',
  PAYMENT_PENDING: 'warning',
  PENDING_VERIFICATION: 'warning',
};

const INVITATION_LABELS: Record<'pending' | 'sent' | 'accepted', string> = {
  pending: 'Invitation Pending',
  sent: 'Invitation Sent',
  accepted: 'Invitation Accepted',
};

async function readApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(`Request failed (${response.status}).`);
  }
  const data = (await response.json()) as T & { success?: boolean; error?: { message?: string } };
  if (!response.ok || !data.success) {
    throw new Error(data.error?.message || 'The request could not be completed.');
  }
  return data;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export const AdminUserDetailPage: React.FC = () => {
  const { currentPath, navigate } = useNavigation();
  const userId = currentPath.split('/').filter(Boolean).pop() || '';

  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tabError, setTabError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState('overview');

  // Account status action
  const [pendingAction, setPendingAction] = useState<AccountStatusAction | null>(null);
  const [reason, setReason] = useState('');
  const [suspendedUntil, setSuspendedUntil] = useState('');
  const [isRunning, setIsRunning] = useState(false);

  // Profile editor
  const [editingProfile, setEditingProfile] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [bio, setBio] = useState('');
  const [headline, setHeadline] = useState('');
  const [experienceYears, setExperienceYears] = useState('');

  // Lazily loaded tab data
  const [bookings, setBookings] = useState<UserBooking[] | null>(null);
  const [payments, setPayments] = useState<UserPayment[] | null>(null);
  const [workspaces, setWorkspaces] = useState<UserWorkspace[] | null>(null);
  const [notifications, setNotifications] = useState<UserNotification[] | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[] | null>(null);

  // Send notification
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyTitle, setNotifyTitle] = useState('');
  const [notifyMessage, setNotifyMessage] = useState('');

  const load = useCallback(async () => {
    if (!userId) {
      setError('Invalid user id.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await readApi<{ user: UserDetail }>(`/api/admin/users/${encodeURIComponent(userId)}`);
      setDetail(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load user details.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  // Seed every editor from the LOADED database row, never from a guess.
  useEffect(() => {
    if (!detail) return;
    setFullName(detail.profile.full_name || '');
    setEmail(detail.profile.email || '');
    setPhone(detail.profile.phone || '');
    setTimezone(detail.profile.timezone || 'Asia/Kolkata');
    setBio(typeof detail.mentorProfile?.about === 'string' ? detail.mentorProfile.about : detail.application?.bio || '');
    setHeadline(detail.mentorProfile?.headline || detail.application?.headline || '');
    setExperienceYears(String(detail.mentorProfile?.experience_years ?? detail.application?.years_of_experience ?? ''));
  }, [detail]);

  const accountState: AccountState | null = useMemo(
    () =>
      detail
        ? deriveAccountState({
            account_status: detail.profile.account_status,
            suspended_until: detail.profile.suspended_until,
          })
        : null,
    [detail],
  );

  const badge: AccountBadge = accountState
    ? accountState.isDeactivated
      ? 'deactivated'
      : accountState.isSuspended
        ? 'suspended'
        : accountState.isSuspensionLapsed
          ? 'suspended_lapsed'
          : 'active'
    : 'active';

  const isAdminAccount = detail?.safety.isAdmin === true;
  const isMentorAccount = detail?.roles.includes('mentor') === true;
  const availableActions = accountState && !isAdminAccount ? availableAccountStatusActions(accountState) : [];

  // Run a mutation and re-read from the database afterwards, so the UI always
  // reflects persisted state.
  const mutate = useCallback(
    async (path: string, init: RequestInit, successMessage: string): Promise<boolean> => {
      setBusy(true);
      setActionError(null);
      setTabError(null);
      try {
        const data = await readApi<{ message?: string }>(path, {
          ...init,
          headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
        });
        setNotice(data.message || successMessage);
        await load();
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'The change failed.';
        setActionError(message);
        setTabError(message);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const loadBookings = useCallback(async () => {
    setTabError(null);
    try {
      const data = await readApi<{ bookings: UserBooking[] }>(`/api/admin/users/${encodeURIComponent(userId)}/bookings`);
      setBookings(data.bookings || []);
    } catch (err) {
      setTabError(err instanceof Error ? err.message : 'Unable to load bookings.');
      setBookings([]);
    }
  }, [userId]);

  const loadPayments = useCallback(async () => {
    setTabError(null);
    try {
      const data = await readApi<{ payments: UserPayment[] }>(`/api/admin/users/${encodeURIComponent(userId)}/payments`);
      setPayments(data.payments || []);
    } catch (err) {
      setTabError(err instanceof Error ? err.message : 'Unable to load payments.');
      setPayments([]);
    }
  }, [userId]);

  const loadWorkspaces = useCallback(async () => {
    setTabError(null);
    try {
      const data = await readApi<{ workspaces: UserWorkspace[] }>(`/api/admin/users/${encodeURIComponent(userId)}/workspaces`);
      setWorkspaces(data.workspaces || []);
    } catch (err) {
      setTabError(err instanceof Error ? err.message : 'Unable to load workspaces.');
      setWorkspaces([]);
    }
  }, [userId]);

  const loadNotifications = useCallback(async () => {
    setTabError(null);
    try {
      const data = await readApi<{ notifications: UserNotification[] }>(`/api/admin/users/${encodeURIComponent(userId)}/notifications`);
      setNotifications(data.notifications || []);
    } catch (err) {
      setTabError(err instanceof Error ? err.message : 'Unable to load notifications.');
      setNotifications([]);
    }
  }, [userId]);

  const loadAudit = useCallback(async () => {
    setTabError(null);
    try {
      const data = await readApi<{ entries: AuditEntry[] }>(`/api/admin/users/${encodeURIComponent(userId)}/audit`);
      setAuditEntries(data.entries || []);
    } catch (err) {
      setTabError(err instanceof Error ? err.message : 'Unable to load the audit log.');
      setAuditEntries([]);
    }
  }, [userId]);

  useEffect(() => {
    if (activeTab === 'bookings' && bookings === null) loadBookings();
    if (activeTab === 'payments' && payments === null) loadPayments();
    if (activeTab === 'workspaces' && workspaces === null) loadWorkspaces();
    if (activeTab === 'notifications' && notifications === null) loadNotifications();
    if (activeTab === 'audit' && auditEntries === null) loadAudit();
  }, [activeTab, bookings, payments, workspaces, notifications, auditEntries, loadBookings, loadPayments, loadWorkspaces, loadNotifications, loadAudit]);

  const runStatusAction = async (action: AccountStatusAction) => {
    setIsRunning(true);
    setActionError(null);
    setNotice(null);
    try {
      const data = await readApi<{ message: string }>(`/api/admin/users/${encodeURIComponent(userId)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          reason: reason.trim() || undefined,
          suspendedUntil: suspendedUntil ? new Date(suspendedUntil).toISOString() : undefined,
        }),
      });
      setNotice(data.message);
      setPendingAction(null);
      setReason('');
      setSuspendedUntil('');
      await load();
      if (activeTab === 'audit') await loadAudit();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'The action failed.');
    } finally {
      setIsRunning(false);
    }
  };

  const sendPasswordReset = () =>
    mutate(
      `/api/admin/users/${encodeURIComponent(userId)}/password-reset`,
      { method: 'POST' },
      'Password reset email sent to the account holder.',
    );

  const resendInvitation = () =>
    mutate(
      `/api/admin/users/${encodeURIComponent(userId)}/resend-invite`,
      { method: 'POST' },
      'Invitation email sent successfully.',
    );

  const saveProfile = async () => {
    const ok = await mutate(
      `/api/admin/users/${encodeURIComponent(userId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          fullName,
          phone,
          timezone,
          bio: isMentorAccount ? bio : undefined,
          headline: isMentorAccount ? headline : undefined,
          experienceYears: isMentorAccount && experienceYears !== '' ? Number(experienceYears) : undefined,
        }),
      },
      'Profile updated.',
    );
    if (ok) setEditingProfile(false);
  };

  const sendNotification = async () => {
    const ok = await mutate(
      `/api/admin/users/${encodeURIComponent(userId)}/notifications`,
      { method: 'POST', body: JSON.stringify({ title: notifyTitle, message: notifyMessage }) },
      'Notification sent.',
    );
    if (ok) {
      setNotifyOpen(false);
      setNotifyTitle('');
      setNotifyMessage('');
      setNotifications(null);
      if (activeTab === 'notifications') await loadNotifications();
    }
  };

  if (loading) return <LoadingState message="Loading user control center…" />;

  if (error || !detail || !accountState) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => navigate('/admin/users')}
          className="-ml-1 inline-flex items-center gap-1.5 rounded-md p-1 text-xs font-semibold text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Users
        </button>
        <ErrorState
          title="User not available"
          message={error || 'This user could not be loaded.'}
          onRetry={load}
        />
      </div>
    );
  }

  const creationSource: MentorCreationSource = isMentorAccount
    ? resolveMentorCreationSource({ createdVia: detail.mentorProfile?.created_via ?? null, hasApplication: Boolean(detail.application) })
    : 'unknown';

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'profile', label: 'Profile' },
    ...(isMentorAccount ? [{ id: 'verification', label: 'Verification' }] : []),
    { id: 'account', label: 'Account' },
    { id: 'bookings', label: 'Bookings', count: bookings?.length },
    { id: 'payments', label: 'Payments', count: payments?.length },
    { id: 'workspaces', label: 'Workspaces', count: workspaces?.length },
    { id: 'notifications', label: 'Notifications', count: notifications?.length },
    { id: 'audit', label: 'Audit Log', count: auditEntries?.length },
  ];

  return (
    <div className="space-y-5">
      <button
        onClick={() => navigate('/admin/users')}
        className="-ml-1 inline-flex items-center gap-1.5 rounded-md p-1 text-xs font-semibold text-[var(--color-shell-text-muted)] transition-colors hover:text-[var(--color-shell-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        <span>Back to Users</span>
      </button>

      {/* ================= HEADER ================= */}
      <header className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[var(--color-shell-surface-elevated)] text-xl font-bold text-[var(--color-shell-text-muted)]">
              {detail.profile.avatar_url ? (
                <img src={detail.profile.avatar_url} alt="" className="h-full w-full object-cover" />
              ) : (
                (detail.profile.full_name || 'U').charAt(0).toUpperCase()
              )}
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight text-[var(--color-shell-text)]">
                {detail.profile.full_name || 'Unnamed user'}
              </h1>
              <p className="mt-0.5 font-mono text-xs text-[var(--color-shell-text-muted)]">
                {detail.profile.email}
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {detail.roles.map((role) => (
                  <Badge key={role} variant="secondary" className="text-[10px] uppercase">
                    {role}
                  </Badge>
                ))}
                <Badge variant={BADGE_VARIANT[badge]} className="text-[10px]">
                  {ACCOUNT_BADGE_LABELS[badge]}
                </Badge>
                {detail.auth && (
                  <Badge variant="outline" className="text-[10px]">
                    {INVITATION_LABELS[detail.auth.invitationStatus]}
                  </Badge>
                )}
              </div>
              <p className="mt-2 text-[11px] text-[var(--color-shell-text-subtle)]">
                Created {formatDate(detail.profile.created_at)} · Updated {formatDate(detail.profile.updated_at, true)}
              </p>
            </div>
          </div>

          {/* Only the actions appropriate to the CURRENT state are rendered.
              The server re-validates all of them. */}
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
            <Button size="sm" variant="outline" className="gap-1.5" onClick={sendPasswordReset} isLoading={busy}>
              <KeyRound className="h-3.5 w-3.5" />
              <span>Send Password Reset</span>
            </Button>
            {detail.auth?.invitationStatus !== 'accepted' && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={resendInvitation} isLoading={busy}>
                <Mail className="h-3.5 w-3.5" />
                <span>Resend Invitation</span>
              </Button>
            )}
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
                {ACCOUNT_STATUS_ACTION_SPECS[action].label}
              </Button>
            ))}
          </div>
        </div>
      </header>

      {notice && <InlineNotice message={notice} />}
      {actionError && <InlineError message={actionError} />}

      {/* ================= TABS ================= */}
      <ControlTabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {tabError && <InlineError message={tabError} />}

      {/* ================= OVERVIEW ================= */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {isMentorAccount ? (
              <>
                <SummaryCard label="Active Gigs" value={detail.summary.activeGigs} hint={`${detail.summary.gigs} total`} />
                <SummaryCard label="Assigned Segments" value={detail.summary.segments} />
                <SummaryCard label="Upcoming Bookings" value={detail.summary.upcomingBookings} />
                <SummaryCard label="Completed Sessions" value={detail.summary.completedBookings} />
              </>
            ) : (
              <>
                <SummaryCard label="Upcoming Bookings" value={detail.summary.upcomingBookings} />
                <SummaryCard label="Completed Sessions" value={detail.summary.completedBookings} />
                <SummaryCard label="Payments" value={detail.summary.payments} hint="Payment records" />
                <SummaryCard label="Account Status" value={ACCOUNT_BADGE_LABELS[badge]} />
              </>
            )}
          </div>

          <Section title="At a glance">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field label="Roles" value={detail.roles.join(', ') || '—'} />
              <Field label="Account status" value={detail.profile.account_status || 'active'} />
              <Field label="Timezone" value={detail.profile.timezone || '—'} />
              <Field label="Phone" value={detail.profile.phone || '—'} />
              <Field label="Sessions / workspaces" value={String(detail.summary.workspaces)} />
              <Field label="Notifications" value={`${detail.summary.unreadNotifications} unread / ${detail.summary.notifications}`} />
              <Field label="Last sign-in" value={formatDate(detail.auth?.lastSignInAt, true)} />
              <Field label="Invited" value={formatDate(detail.auth?.invitedAt, true)} />
            </dl>
          </Section>

          {isMentorAccount && (
            <Section
              title="Mentor operations"
              action={
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate(`/admin/mentors/${userId}`)}>
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span>Open Mentor Control Center</span>
                </Button>
              }
            >
              <p className="text-xs leading-relaxed text-[var(--color-shell-text-muted)]">
                Segments, gigs, availability and date exceptions are managed in the Mentor Control Center,
                which uses the same server-authorized endpoints and the same audit trail.
              </p>
            </Section>
          )}
        </div>
      )}

      {/* ================= PROFILE ================= */}
      {activeTab === 'profile' && (
        <Section
          title="Profile"
          action={
            <Button
              size="sm"
              variant={editingProfile ? 'default' : 'outline'}
              className="gap-1.5"
              onClick={() => setEditingProfile((v) => !v)}
            >
              <Pencil className="h-3.5 w-3.5" />
              <span>{editingProfile ? 'Cancel' : 'Edit'}</span>
            </Button>
          }
        >
          {editingProfile ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="Display name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
                <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
                <Input label="Timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
                <Input
                  label="Email"
                  value={email}
                  disabled
                  helperText="The login identity lives in Supabase Auth and is not edited here."
                />
              </div>
              {isMentorAccount && (
                <>
                  <Input label="Headline" value={headline} onChange={(e) => setHeadline(e.target.value)} />
                  <Input
                    label="Years of experience"
                    type="number"
                    min={0}
                    value={experienceYears}
                    onChange={(e) => setExperienceYears(e.target.value)}
                  />
                  <Textarea label="Bio" value={bio} onChange={(e) => setBio(e.target.value)} rows={5} />
                </>
              )}
              {actionError && <InlineError message={actionError} />}
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditingProfile(false)}>Cancel</Button>
                <Button size="sm" isLoading={busy} onClick={saveProfile}>Save changes</Button>
              </div>
            </div>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Field label="Display name" value={detail.profile.full_name || '—'} />
                <Field label="Email" value={detail.profile.email || '—'} />
                <Field label="Phone" value={detail.profile.phone || '—'} />
                <Field label="Timezone" value={detail.profile.timezone || '—'} />
                <Field label="Account status" value={detail.profile.account_status || 'active'} />
                <Field label="Internal note" value={detail.profile.internal_note || '—'} />
              </dl>
              {isMentorAccount && (
                <>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-shell-text-subtle)]">Headline</p>
                    <p className="mt-1 text-xs text-[var(--color-shell-text)]">{detail.mentorProfile?.headline || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-shell-text-subtle)]">Bio</p>
                    <p className="mt-1 whitespace-pre-wrap rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] p-3 text-xs leading-relaxed text-[var(--color-shell-text)]">
                      {detail.mentorProfile?.about || 'No bio provided.'}
                    </p>
                  </div>
                </>
              )}
            </>
          )}
        </Section>
      )}

      {/* ================= VERIFICATION (mentor only) ================= */}
      {activeTab === 'verification' && isMentorAccount && (
        <Section title="Verification">
          {creationSource === 'admin_direct' ? (
            <div className="space-y-3">
              <div className="flex items-start gap-3 rounded-lg border border-[var(--color-shell-success-border)] bg-[var(--color-shell-success-soft)] p-4">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-shell-success)]" />
                <div className="space-y-1">
                  <p className="text-sm font-bold text-[var(--color-shell-success)]">Admin Verified Mentor</p>
                  <p className="text-xs leading-relaxed text-[var(--color-shell-text-muted)]">
                    This mentor was created directly by an administrator and is already verified. No public
                    verification application is required.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant={detail.mentorProfile?.approval_status === 'approved' ? 'success' : 'warning'} className="text-[10px]">
                  Approval: {detail.mentorProfile?.approval_status || 'unknown'}
                </Badge>
                <Badge variant={detail.mentorProfile?.is_active ? 'success' : 'destructive'} className="text-[10px]">
                  {detail.mentorProfile?.is_active ? 'Active' : 'Inactive'}
                </Badge>
                <Badge variant="outline" className="text-[10px]">No application required</Badge>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="text-[10px]">
                  Source: {MENTOR_CREATION_SOURCE_LABELS[creationSource]}
                </Badge>
                <Badge
                  variant={detail.mentorProfile?.approval_status === 'approved' ? 'success' : detail.mentorProfile?.approval_status === 'rejected' ? 'destructive' : 'warning'}
                  className="text-[10px]"
                >
                  {detail.mentorProfile?.approval_status || 'unknown'}
                </Badge>
                {detail.application && (
                  <Badge variant="outline" className="text-[10px]">Application: {detail.application.status}</Badge>
                )}
              </div>
              {detail.application ? (
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <Field label="Submitted" value={formatDate(detail.application.submitted_at, true)} />
                  <Field label="Reviewed" value={formatDate(detail.application.reviewed_at, true)} />
                  <Field label="Documents" value={String(detail.documents.length)} />
                </dl>
              ) : (
                <p className="text-xs text-[var(--color-shell-text-subtle)]">
                  No mentor application on record and no admin-creation audit event, so the creation source
                  cannot be determined from the database.
                </p>
              )}
              {detail.application?.rejection_reason && (
                <p className="rounded-lg border border-[var(--color-shell-error)]/30 bg-[var(--color-shell-error-soft)] p-3 text-xs text-[var(--color-shell-error)]">
                  <span className="font-semibold">Rejection reason:</span> {detail.application.rejection_reason}
                </p>
              )}
              {detail.documents.length > 0 && (
                <ul className="space-y-1.5">
                  {detail.documents.map((doc) => (
                    <li key={doc.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] p-2.5 text-xs">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-[var(--color-shell-text)]">{doc.original_filename}</p>
                        <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
                          {doc.document_type} · {doc.status}
                        </p>
                      </div>
                      {doc.download_url && (
                        <a href={doc.download_url} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 font-semibold text-[var(--color-shell-primary)] hover:underline">
                          <Download className="h-3 w-3" /> View
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Section>
      )}

      {/* ================= ACCOUNT ================= */}
      {activeTab === 'account' && (
        <Section title="Account">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={BADGE_VARIANT[badge]} className="text-[10px]">{ACCOUNT_BADGE_LABELS[badge]}</Badge>
            <Badge variant="outline" className="text-[10px]">account_status: {detail.profile.account_status || 'active'}</Badge>
            <Badge variant="outline" className="text-[10px]">
              Active admins: {detail.safety.activeAdminCount}
            </Badge>
          </div>

          {isAdminAccount && (
            <InlineWarning message="You're changing an administrator account. This can affect platform access. Status controls are withheld here so the platform cannot be locked out of its own admin area." />
          )}

          <div className="flex flex-wrap gap-2">
            {availableActions.length === 0 && !isAdminAccount && (
              <p className="text-xs text-[var(--color-shell-text-subtle)]">No status action is available for the current state.</p>
            )}
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
                {ACCOUNT_STATUS_ACTION_SPECS[action].label}
              </Button>
            ))}
          </div>

          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Suspended at" value={formatDate(detail.profile.suspended_at, true)} />
            <Field label="Suspended until" value={formatDate(detail.profile.suspended_until, true)} />
            <Field label="Deactivated at" value={formatDate(detail.profile.deactivated_at, true)} />
            <Field label="Invitation status" value={detail.auth ? INVITATION_LABELS[detail.auth.invitationStatus] : 'unknown'} />
            <Field label="Last sign-in" value={formatDate(detail.auth?.lastSignInAt, true)} />
            <Field label="Email confirmed" value={formatDate(detail.auth?.emailConfirmedAt, true)} />
          </dl>

          {detail.profile.suspension_reason && (
            <p className="rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] p-3 text-xs text-[var(--color-shell-text-muted)]">
              <span className="font-semibold text-[var(--color-shell-text)]">Suspension reason:</span>{' '}
              {detail.profile.suspension_reason}
            </p>
          )}

          <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
            Deactivate and Suspend are status changes only. Profile, bookings, payments, workspaces,
            notifications and audit history are all preserved, and no account is ever deleted from this page.
          </p>
        </Section>
      )}

      {/* ================= BOOKINGS ================= */}
      {activeTab === 'bookings' && (
        <Section title="Bookings" action={<Button size="sm" variant="outline" onClick={loadBookings}>Refresh</Button>}>
          {bookings === null ? (
            <LoadingState message="Loading bookings…" />
          ) : bookings.length === 0 ? (
            <p className="text-xs text-[var(--color-shell-text-subtle)]">No bookings for this account.</p>
          ) : (
            <ul className="space-y-2">
              {bookings.map((booking) => (
                <li key={booking.id} className="rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] p-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-[var(--color-shell-text)]">{booking.bookingCode}</span>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant={BOOKING_VARIANT[booking.status] || 'secondary'} className="text-[10px]">{booking.status}</Badge>
                      {booking.payment && (
                        <Badge variant={PAYMENT_VARIANT[booking.payment.status] || 'secondary'} className="text-[10px]">
                          Payment: {booking.payment.status}
                        </Badge>
                      )}
                      {booking.workspace && (
                        <Badge variant="outline" className="text-[10px]">Workspace: {booking.workspace.status}</Badge>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] text-[var(--color-shell-text-muted)] sm:grid-cols-3">
                    <span>Segment: {booking.segment?.name || '—'}</span>
                    <span>Gig: {booking.gig?.title || '—'}</span>
                    <span>Duration: {booking.gig?.duration_minutes ?? '—'} min</span>
                    <span>Seeker: {booking.seeker?.full_name || booking.seeker?.email || '—'}</span>
                    <span>Mentor: {booking.mentor?.full_name || booking.mentor?.email || '—'}</span>
                    <span>Amount: ₹{booking.amountInr} INR</span>
                    <span>Start: {formatDate(booking.startTime, true)}</span>
                    <span>End: {formatDate(booking.endTime, true)}</span>
                    <span>Created: {formatDate(booking.createdAt, true)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
            Bookings are read-only here. Status changes must go through the booking state machine, so no
            arbitrary status can be written from this page.
          </p>
        </Section>
      )}

      {/* ================= PAYMENTS ================= */}
      {activeTab === 'payments' && (
        <Section title="Payments" action={<Button size="sm" variant="outline" onClick={loadPayments}>Refresh</Button>}>
          {payments === null ? (
            <LoadingState message="Loading payments…" />
          ) : payments.length === 0 ? (
            <p className="text-xs text-[var(--color-shell-text-subtle)]">No payment records for this account.</p>
          ) : (
            <ul className="space-y-2">
              {payments.map((payment) => (
                <li key={payment.id} className="rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] p-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-[var(--color-shell-text)]">₹{payment.amountInr} {payment.currency}</span>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant={PAYMENT_VARIANT[payment.status] || 'secondary'} className="text-[10px]">{payment.status}</Badge>
                      <Badge variant="outline" className="text-[10px]">Verification: {payment.verifiedAt ? 'verified' : 'pending'}</Badge>
                    </div>
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] text-[var(--color-shell-text-muted)] sm:grid-cols-3">
                    <span>Booking: {payment.booking?.bookingCode || '—'}</span>
                    <span>Booking status: {payment.booking?.status || '—'}</span>
                    <span>Segment: {payment.booking?.segmentName || '—'}</span>
                    <span>Gig: {payment.booking?.gigTitle || '—'}</span>
                    <span>Reference: {payment.transactionReference || '—'}</span>
                    <span>Created: {formatDate(payment.createdAt, true)}</span>
                  </div>
                  {payment.rejectionReason && (
                    <p className="mt-1.5 text-[11px] text-[var(--color-shell-error)]">Rejection reason: {payment.rejectionReason}</p>
                  )}
                  <p className="mt-1 text-[11px] text-[var(--color-shell-text-subtle)]">
                    Payment proof: {payment.hasProof ? 'uploaded (private storage)' : 'not uploaded'}. Storage paths and secrets are never exposed.
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
            Payment status is owned by the Admin verification flow and cannot be edited from this page.
          </p>
        </Section>
      )}

      {/* ================= WORKSPACES ================= */}
      {activeTab === 'workspaces' && (
        <Section title="Workspaces / Session History" action={<Button size="sm" variant="outline" onClick={loadWorkspaces}>Refresh</Button>}>
          {workspaces === null ? (
            <LoadingState message="Loading workspaces…" />
          ) : workspaces.length === 0 ? (
            <p className="text-xs text-[var(--color-shell-text-subtle)]">No session workspaces for this account.</p>
          ) : (
            <ul className="space-y-2">
              {workspaces.map((workspace) => (
                <li key={workspace.id} className="rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] p-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-[var(--color-shell-text)]">
                      {workspace.booking?.booking_code || workspace.bookingId}
                    </span>
                    <Badge variant={workspace.status === 'PUBLISHED' ? 'success' : 'secondary'} className="text-[10px]">
                      {workspace.status}
                    </Badge>
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] text-[var(--color-shell-text-muted)] sm:grid-cols-3">
                    <span>Mentor: {workspace.mentor?.full_name || workspace.mentor?.email || '—'}</span>
                    <span>Seeker: {workspace.seeker?.full_name || workspace.seeker?.email || '—'}</span>
                    <span>Segment: {workspace.booking?.segment?.name || '—'}</span>
                    <span>Session: {formatDate(workspace.booking?.start_time, true)}</span>
                    <span>Booking status: {workspace.booking?.status || '—'}</span>
                    <span>Published: {formatDate(workspace.publishedAt, true)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
            Workspace metadata only. Mentor note content stays behind the existing workspace authorization model.
          </p>
        </Section>
      )}

      {/* ================= NOTIFICATIONS ================= */}
      {activeTab === 'notifications' && (
        <Section
          title="Notifications"
          action={
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={loadNotifications}>Refresh</Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setActionError(null); setNotifyOpen(true); }}>
                <Plus className="h-3.5 w-3.5" /> Send Notification
              </Button>
            </div>
          }
        >
          {notifications === null ? (
            <LoadingState message="Loading notifications…" />
          ) : notifications.length === 0 ? (
            <p className="text-xs text-[var(--color-shell-text-subtle)]">No notifications for this account.</p>
          ) : (
            <ul className="space-y-1.5">
              {notifications.map((notification) => (
                <li key={notification.id} className="rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] p-2.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-[var(--color-shell-text)]">{notification.title}</span>
                    <div className="flex gap-1.5">
                      <Badge variant="outline" className="text-[10px]">{notification.type}</Badge>
                      <Badge variant={notification.is_read ? 'secondary' : 'warning'} className="text-[10px]">
                        {notification.is_read ? 'Read' : 'Unread'}
                      </Badge>
                    </div>
                  </div>
                  <p className="mt-0.5 text-[11px] text-[var(--color-shell-text-muted)]">{notification.message}</p>
                  <p className="mt-0.5 text-[11px] text-[var(--color-shell-text-subtle)]">
                    {formatDate(notification.created_at, true)}
                    {notification.read_at ? ` · read ${formatDate(notification.read_at, true)}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {/* ================= AUDIT ================= */}
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

      {/* ================= STATUS CONFIRMATION ================= */}
      <Modal
        isOpen={pendingAction !== null}
        onClose={() => { if (!isRunning) setPendingAction(null); }}
        title={pendingAction ? `${ACCOUNT_STATUS_ACTION_SPECS[pendingAction].label} account` : ''}
        description={pendingAction ? ACCOUNT_STATUS_ACTION_SPECS[pendingAction].confirmation : ''}
      >
        <div className="space-y-3 pt-1">
          {pendingAction === 'suspend' && (
            <>
              <Input
                label="Reason"
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Repeated no-shows"
              />
              <Input
                label="Suspended until (optional)"
                type="datetime-local"
                value={suspendedUntil}
                onChange={(e) => setSuspendedUntil(e.target.value)}
                helperText="Leave blank for an indefinite suspension."
              />
            </>
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

      {/* ================= SEND NOTIFICATION ================= */}
      <Modal
        isOpen={notifyOpen}
        onClose={() => { if (!busy) setNotifyOpen(false); }}
        title="Send notification"
        description="Delivered to the existing in-app notification inbox."
      >
        <div className="space-y-3 pt-1">
          <Input label="Title" required value={notifyTitle} onChange={(e) => setNotifyTitle(e.target.value)} />
          <Textarea label="Message" required value={notifyMessage} onChange={(e) => setNotifyMessage(e.target.value)} rows={4} />
          {actionError && <InlineError message={actionError} />}
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => setNotifyOpen(false)} disabled={busy}>Cancel</Button>
            <Button
              size="sm"
              isLoading={busy}
              disabled={!notifyTitle.trim() || !notifyMessage.trim()}
              onClick={sendNotification}
            >
              Send
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
