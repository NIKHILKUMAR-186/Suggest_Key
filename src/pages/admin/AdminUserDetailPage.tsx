import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Edit3, FileText, Loader2, Mail, Save, ShieldCheck, XCircle } from 'lucide-react';
import { Badge } from '@/src/components/ui/Badge';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { apiFetch } from '@/src/lib/apiClient';
import { useNavigation } from '@/src/context/NavigationContext';

interface UserProfile {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  timezone: string | null;
  account_status: string;
  created_at: string;
  updated_at: string;
  phone_number?: string | null;
}

interface UserApplication {
  id: string;
  status: string;
  bio: string | null;
  full_name: string;
  timezone: string | null;
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
  storage_path: string;
  download_url?: string | null;
}

interface UserDetail {
  profile: UserProfile;
  roles: string[];
  mentorProfile: Record<string, unknown> | null;
  application: UserApplication | null;
  documents: UserDocument[];
  segments: Array<{ id: string; segment?: { name?: string; slug?: string } }>;
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') || '';
  const body = await response.text();
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(`Request failed (${response.status})`);
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`Request returned invalid JSON (${response.status})`);
  }
}

export const AdminUserDetailPage: React.FC = () => {
  const { currentPath, navigate } = useNavigation();
  const userId = currentPath.split('/').pop() || '';
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [bio, setBio] = useState('');
  const [headline, setHeadline] = useState('');
  const [experienceYears, setExperienceYears] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [resendLoading, setResendLoading] = useState(false);
  const [resendStatus, setResendStatus] = useState<'sent' | 'not_sent' | 'failed' | null>(null);

  const loadDetail = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/admin/users/${userId}`);
      const data = await parseApiResponse<{ success?: boolean; user?: UserDetail; error?: { message?: string } }>(response);
      if (!response.ok || !data.success || !data.user) throw new Error(data.error?.message || 'Unable to load user details.');
      setDetail(data.user);
      setFullName(data.user.profile.full_name || '');
      setTimezone(data.user.profile.timezone || '');
      setBio(typeof data.user.mentorProfile?.bio === 'string' ? data.user.mentorProfile.bio : data.user.application?.bio || '');
      setHeadline(typeof data.user.mentorProfile?.headline === 'string' ? data.user.mentorProfile.headline : '');
      // `years_experience` is the server-side alias of the real `mentor_profiles.experience_years` column.
      // `mentor_applications` has no experience column, so it must never be read as a fallback.
      setExperienceYears(String(data.user.mentorProfile?.years_experience ?? ''));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load user details.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          timezone,
          bio,
          headline,
          experienceYears: experienceYears ? Number(experienceYears) : undefined,
        }),
      });
      const data = await parseApiResponse<{ success?: boolean; error?: { message?: string } }>(response);
      if (!response.ok || !data.success) throw new Error(data.error?.message || 'Unable to update user.');
      await loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update user.');
    } finally {
      setSaving(false);
    }
  };

  const reviewApplication = async (decision: 'approve' | 'reject') => {
    if (!detail?.application) return;
    if (decision === 'reject' && !rejectionReason.trim()) {
      setError('A reason is required when requesting changes or rejecting an application.');
      return;
    }
    setAction(decision);
    setError(null);
    try {
      const response = await apiFetch(`/api/admin/mentor-applications/${detail.application.id}/${decision}`, {
        method: 'POST',
        ...(decision === 'reject' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rejectionReason: rejectionReason.trim() }) } : {}),
      });
      const data = await parseApiResponse<{ success?: boolean; error?: { message?: string } }>(response);
      if (!response.ok || !data.success) throw new Error(data.error?.message || `Unable to ${decision} application.`);
      setRejectionReason('');
      await loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to ${decision} application.`);
    } finally {
      setAction(null);
    }
   };

  const resendInvitation = async () => {
    if (!userId) return;
    setResendLoading(true);
    setResendStatus(null);
    setError(null);
    try {
      const response = await apiFetch(`/api/admin/users/${userId}/resend-invite`, { method: 'POST' });
      const data = await parseApiResponse<{ success?: boolean; emailDelivery?: { status: string }; error?: { message?: string } }>(response);
      if (!response.ok || !data.success) throw new Error(data.error?.message || 'Unable to resend invitation.');
      const status = data.emailDelivery?.status;
      if (status === 'sent') {
        setResendStatus('sent');
      } else if (status === 'not_sent') {
        setResendStatus('not_sent');
      } else {
        setResendStatus('failed');
      }
    } catch (err) {
      setResendStatus('failed');
      setError(err instanceof Error ? err.message : 'Unable to resend invitation.');
    } finally {
      setResendLoading(false);
    }
  };

  if (loading) return <div className="py-16 flex justify-center"><Loader2 className="h-7 w-7 animate-spin" /></div>;
  if (!detail) return <div className="space-y-4"><p className="text-sm text-[var(--color-shell-error)]">{error || 'User not found.'}</p><Button onClick={() => navigate('/admin/users')}>Back to Users</Button></div>;

  const isMentor = detail.roles.includes('mentor') || Boolean(detail.application) || Boolean(detail.mentorProfile);
  const status = detail.application?.status || (detail.roles.includes('mentor') ? 'approved' : 'active');

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <button onClick={() => navigate('/admin/users')} className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)]">
        <ArrowLeft className="h-4 w-4" /> Back to Users
      </button>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 border-b border-[var(--color-shell-border)] pb-5">
        <div><h1 className="text-2xl font-bold text-[var(--color-shell-text)]">{detail.profile.full_name || detail.profile.email}</h1><p className="text-xs text-[var(--color-shell-text-muted)]">{detail.profile.email}</p></div>
        <div className="flex items-center gap-3">
          <Badge variant={status === 'approved' ? 'success' : status === 'pending_review' ? 'warning' : 'secondary'}>{status.replace('_', ' ')}</Badge>
          <Button size="sm" variant="outline" onClick={resendInvitation} disabled={resendLoading}>
            {resendLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
            <span>{resendLoading ? 'Sending...' : 'Resend Invitation'}</span>
          </Button>
        </div>
      </div>
      {resendStatus === 'sent' && <div className="rounded-lg border border-[var(--color-shell-success-border)] bg-[var(--color-shell-success-soft)] p-2 text-xs text-[var(--color-shell-success)]">Invitation email sent successfully.</div>}
      {resendStatus === 'not_sent' && <div className="rounded-lg border border-[var(--color-shell-warning)]/30 bg-[var(--color-shell-warning-soft)] p-2 text-xs text-[var(--color-shell-warning)]">Email not sent (rate-limited). Please try again later.</div>}
      {resendStatus === 'failed' && <div className="rounded-lg border border-[var(--color-shell-error)] bg-[var(--color-shell-error-soft)] p-2 text-xs text-[var(--color-shell-error)]">Email delivery failed. Please try again later or contact support.</div>}
      {error && <div className="rounded-lg border border-[var(--color-shell-error)] bg-[var(--color-shell-error-soft)] p-3 text-xs text-[var(--color-shell-error)]">{error}</div>}

      <form onSubmit={saveProfile} className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-5 space-y-4">
        <div className="flex items-center justify-between"><h2 className="text-sm font-bold">Profile</h2><Edit3 className="h-4 w-4 text-[var(--color-shell-text-subtle)]" /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Display name" value={fullName} onChange={(event) => setFullName(event.target.value)} />
          <Input label="Timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} />
          <Input label="Email" value={detail.profile.email || ''} disabled />
          <Input label="Account status" value={detail.profile.account_status} disabled />
        </div>
        {isMentor && <div className="grid gap-4 sm:grid-cols-2"><Input label="Mentor headline" value={headline} onChange={(event) => setHeadline(event.target.value)} /><Input label="Years of experience" type="number" min="0" value={experienceYears} onChange={(event) => setExperienceYears(event.target.value)} /><label className="sm:col-span-2 text-xs font-semibold">Mentor bio<textarea value={bio} onChange={(event) => setBio(event.target.value)} rows={4} className="mt-1 w-full rounded-lg border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] p-2 text-xs font-normal" /></label></div>}
        <Button type="submit" disabled={saving} size="sm"><Save className="h-3.5 w-3.5" /> {saving ? 'Saving...' : 'Save changes'}</Button>
      </form>

      {isMentor && <>
        <section className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-5 space-y-4">
          <div className="flex items-center justify-between"><h2 className="text-sm font-bold">Mentor application and verification</h2><ShieldCheck className="h-4 w-4 text-[var(--color-shell-accent)]" /></div>
          {detail.application ? <><div className="grid gap-3 sm:grid-cols-3 text-xs"><div><span className="text-[var(--color-shell-text-subtle)]">Submitted</span><p>{detail.application.submitted_at ? new Date(detail.application.submitted_at).toLocaleString() : 'Not submitted'}</p></div><div><span className="text-[var(--color-shell-text-subtle)]">Reviewed</span><p>{detail.application.reviewed_at ? new Date(detail.application.reviewed_at).toLocaleString() : 'Not reviewed'}</p></div><div><span className="text-[var(--color-shell-text-subtle)]">Documents</span><p>{detail.documents.length} uploaded</p></div></div><p className="text-xs whitespace-pre-wrap">{detail.application.bio || 'No bio submitted.'}</p><div className="space-y-2">{detail.documents.length === 0 ? <p className="text-xs text-[var(--color-shell-text-subtle)]">No verification documents uploaded.</p> : detail.documents.map((document) => <div key={document.id} className="flex items-center justify-between border-t border-[var(--color-shell-border)] pt-2 text-xs"><span className="flex items-center gap-2"><FileText className="h-4 w-4" />{document.document_type} · {document.original_filename}</span><span className="flex items-center gap-2">{document.status}{document.download_url ? <a href={document.download_url} target="_blank" rel="noreferrer" className="underline">View</a> : null}</span></div>)}</div>{detail.application.status === 'pending_review' && <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => reviewApplication('approve')} disabled={action !== null}><CheckCircle2 className="h-3.5 w-3.5" />{action === 'approve' ? 'Approving...' : 'Approve'}</Button><Button size="sm" variant="outline" onClick={() => reviewApplication('reject')} disabled={action !== null}><XCircle className="h-3.5 w-3.5" />{action === 'reject' ? 'Saving...' : 'Request changes / Reject'}</Button></div>} {detail.application.status === 'pending_review' && <Input label="Review reason" value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} placeholder="Required for request changes or rejection" />}</> : <div className="rounded-lg border border-[var(--color-shell-success-border)] bg-[var(--color-shell-success-soft)] p-3 text-xs"><p className="font-semibold text-[var(--color-shell-success)]">Admin Verified Mentor</p><p className="mt-1 text-[var(--color-shell-text-muted)]">This mentor was created directly by an administrator and is already verified. No public verification application is required. <a className="font-semibold text-[var(--color-shell-primary)] underline" href={`/admin/mentors/${userId}`}>Open the Mentor Control Center</a></p></div>}
        </section>
        <section className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-5"><h2 className="text-sm font-bold mb-3">Segments</h2>{detail.segments.length === 0 ? <p className="text-xs text-[var(--color-shell-text-subtle)]">No segment memberships.</p> : <div className="flex flex-wrap gap-2">{detail.segments.map((membership) => <Badge key={membership.id}>{membership.segment?.name || membership.segment?.slug || membership.id}</Badge>)}</div>}</section>
      </>}
      <p className="text-[11px] text-[var(--color-shell-text-subtle)]">Created {new Date(detail.profile.created_at).toLocaleString()} · Updated {new Date(detail.profile.updated_at).toLocaleString()}</p>
    </div>
  );
};
