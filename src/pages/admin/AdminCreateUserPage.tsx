import React, { useState } from 'react';
import {
  UserPlus,
  User,
  Mail,
  FileText,
  Clock,
  AlertCircle,
  Loader2,
  ArrowLeft,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { Badge } from '@/src/components/ui/Badge';
import { apiFetch } from '@/src/lib/apiClient';
import { useNavigation } from '@/src/context/NavigationContext';
import type { UserRole } from '@/src/types/auth';

export const AdminCreateUserPage: React.FC = () => {
  const { navigate } = useNavigation();
  const [role, setRole] = useState<UserRole>('seeker');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [bio, setBio] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [emailDeliveryStatus, setEmailDeliveryStatus] = useState<'sent' | 'not_sent' | 'failed' | null>(null);

  const [fullNameError, setFullNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const validateEmail = (): boolean => {
    const trimmed = email.trim();
    if (!trimmed) {
      setEmailError('Email is required.');
      return false;
    }
    const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!pattern.test(trimmed)) {
      setEmailError('Enter a valid email address.');
      return false;
    }
    setEmailError(null);
    return true;
  };

  const validateFullName = (): boolean => {
    if (!fullName.trim()) {
      setFullNameError('Full name is required.');
      return false;
    }
    setFullNameError(null);
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setEmailDeliveryStatus(null);

    if (!validateFullName() || !validateEmail()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await apiFetch('/api/admin/users/direct-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          fullName: fullName.trim(),
          role,
          bio: bio.trim() || undefined,
          timezone,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to create user');

      const status = data.emailDelivery?.status;
      setEmailDeliveryStatus(status || 'not_sent');

      let successMsg: string;
      if (role === 'mentor') {
        if (status === 'sent') {
          successMsg = `Trusted mentor "${fullName.trim()}" was created and auto-approved. An invitation email was sent to ${email.trim()}.`;
        } else if (status === 'not_sent') {
          successMsg = `Trusted mentor "${fullName.trim()}" was created and auto-approved. The invitation email could not be sent (rate-limited). Click "Resend invitation" on the user details page later.`;
        } else {
          successMsg = `Trusted mentor "${fullName.trim()}" was created and auto-approved. The invitation email delivery failed. Click "Resend invitation" on the user details page later.`;
        }
      } else {
        successMsg = status === 'sent'
          ? `User "${fullName.trim()}" was created with role: ${role}. An invitation email was sent to ${email.trim()}.`
          : `User "${fullName.trim()}" was created with role: ${role}. The invitation email could not be sent. You can resend it from the user details page.`;
      }
      setSuccess(successMsg);

      setFullName('');
      setEmail('');
      setBio('');
      window.setTimeout(() => navigate('/admin/users'), 900);
    } catch (err: any) {
      setError(err.message || 'Failed to create user');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <button
        onClick={() => navigate('/admin/users')}
        className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)] transition-colors rounded-md p-1 -ml-1 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        <span>Back to Users</span>
      </button>

      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--color-shell-border)] pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-shell-text)] sm:text-3xl">
            Create New User
          </h1>
          <p className="mt-1 text-sm text-[var(--color-shell-text-muted)]">
            Create a new seeker or trusted, immediately approved mentor account directly.
          </p>
        </div>
        <UserPlus className="h-6 w-6 text-[var(--color-shell-primary)]" />
      </div>

      {/* Error / Success */}
      {error && (
        <div className="rounded-lg bg-[var(--color-shell-error-soft)] border border-[var(--color-shell-error)] p-3 text-xs text-[var(--color-shell-error)] flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-[var(--color-shell-error)] shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="rounded-lg bg-[var(--color-shell-success-soft)] border border-[var(--color-shell-success-border)] p-3 text-xs text-[var(--color-shell-success)] flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 text-[var(--color-shell-success)] shrink-0 mt-0.5" />
          <span>{success}</span>
        </div>
      )}

      {/* Form */}
      <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 space-y-6">
        <h2 className="text-sm font-semibold text-[var(--color-shell-text)]">User Details</h2>

        {/* Role Selection */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-[var(--color-shell-text-muted)]">Account Role</label>
          <div className="grid grid-cols-2 gap-3">
            {(['seeker', 'mentor'] as const).map((r) => {
              const IconComponent = r === 'seeker' ? User : r === 'mentor' ? UserPlus : UserPlus;
              const label = r.charAt(0).toUpperCase() + r.slice(1);
              const isSelected = role === r;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    setRole(r);
                    setError(null);
                    setSuccess(null);
                    setEmailDeliveryStatus(null);
                  }}
                  className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'border-[var(--color-shell-primary)] bg-[var(--color-shell-accent-soft)]/20 ring-1 ring-[var(--color-shell-primary)]'
                      : 'border-[var(--color-shell-border-strong)] hover:border-[var(--color-shell-border)] bg-[var(--color-shell-bg)]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <IconComponent
                      className={`h-4 w-4 ${
                        isSelected ? 'text-[var(--color-shell-primary)]' : 'text-[var(--color-shell-text-subtle)]'
                      }`}
                    />
                    <span className={`font-semibold text-xs ${
                      isSelected ? 'text-[var(--color-shell-primary)]' : 'text-[var(--color-shell-text)]'
                    }`}>
                      {label}
                    </span>
                  </div>
                  <p className="text-[10px] text-[var(--color-shell-text-subtle)] mt-0.5">
                    {r === 'mentor'
                      ? 'Offer mentorship and conduct sessions'
                      : 'Discover mentors and book sessions'}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Full Name"
            placeholder="e.g. Priya Sharma"
            value={fullName}
            onChange={(e) => {
              setFullName(e.target.value);
              setFullNameError(null);
              setError(null);
            }}
            onBlur={validateFullName}
            error={fullNameError}
            className="auth-input"
          />

          <Input
            label="Email Address"
            type="email"
            placeholder="e.g. user@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError(null);
              setError(null);
            }}
            onBlur={validateEmail}
            error={emailError}
            autoComplete="email"
            className="auth-input md:col-span-2"
          />

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-[var(--color-shell-text-muted)]">Timezone</label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full rounded-lg border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] px-3 py-2 text-sm text-[var(--color-shell-text)] focus:border-[var(--color-shell-accent)] focus:outline-none cursor-pointer"
            >
              <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
              <option value="America/New_York">America/New_York (EST)</option>
              <option value="America/Los_Angeles">America/Los_Angeles (PST)</option>
              <option value="Europe/London">Europe/London (GMT)</option>
              <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
            </select>
          </div>
        </div>

        {/* Bio - Mentor Only, optional for admin-created mentors */}
        {role === 'mentor' && (
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-[var(--color-shell-text-muted)]">
              Mentor Bio
            </label>
            <div className="relative">
              <FileText className="absolute top-2 left-3 h-4 w-4 text-[var(--color-shell-text-subtle)]" />
              <textarea
                value={bio}
                onChange={(e) => {
                  setBio(e.target.value);
                  setError(null);
                }}
                placeholder="Brief background, expertise, or leave blank (admin can edit later)..."
                rows={4}
                maxLength={500}
                className="w-full rounded-lg border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] pl-10 pr-3 py-2 text-xs text-[var(--color-shell-text)] placeholder-[var(--color-shell-text-subtle)] focus:border-[var(--color-shell-primary)] focus:outline-none resize-y"
              />
            </div>
            <p className="text-[10px] text-[var(--color-shell-text-subtle)]">
              Optional. Used for the mentor profile headline and about text. The admin can edit this later from the user detail page.
            </p>
          </div>
        )}

        <div className="pt-4 border-t border-[var(--color-shell-border-strong)] flex items-center justify-end gap-3">
          <Button
            variant="outline"
            size="md"
            onClick={() => navigate('/admin/users')}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            size="md"
            disabled={isSubmitting}
            onClick={handleSubmit}
          >
            {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
            <span>{isSubmitting ? 'Creating...' : 'Create User'}</span>
          </Button>
        </div>

        {role === 'mentor' && (
          <div className="rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)]/50 p-3.5 text-xs text-[var(--color-shell-text-muted)] space-y-1">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 text-[var(--color-shell-text-subtle)] shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-[var(--color-shell-text)]">Trusted Mentor Account</p>
                <p>
                  This mentor is created as trusted and automatically approved — no application or
                  document review is required. The mentor appears in discovery immediately. An
                  invitation email with a secure password-setup link is sent separately; if it fails
                  to send, you can retry from the user detail page.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
