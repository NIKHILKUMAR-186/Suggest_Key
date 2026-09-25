import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  UserPlus,
  User,
  Mail,
  Phone,
  Clock,
  Globe,
  AlertCircle,
  Loader2,
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  ShieldCheck,
  Sparkles,
  Eye,
  EyeOff,
  Copy,
  Briefcase,
  Layers,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { Badge } from '@/src/components/ui/Badge';
import { apiFetch } from '@/src/lib/apiClient';
import { useNavigation } from '@/src/context/NavigationContext';
import {
  buildCreateUserPayload,
  generateTemporaryPassword,
  listTimezones,
  parseTagInput,
  validateCreateUserForm,
  type AdminCreatableRole,
  type CreateUserFieldErrorKey,
  type CreateUserFieldErrors,
  type CreateUserFormValues,
} from '@/src/lib/adminCreateUser';

interface SegmentOption {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  priority: number;
}

const EMPTY_FORM: CreateUserFormValues = {
  role: 'seeker',
  fullName: '',
  email: '',
  phone: '',
  timezone: 'Asia/Kolkata',
  bio: '',
  headline: '',
  experienceYears: '',
  languages: '',
  expertise: '',
  segmentIds: [],
  passwordMode: 'invitation',
  password: '',
  confirmPassword: '',
  sendEmail: true,
};

function SectionHeader({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-shell-primary)]/10 text-[var(--color-shell-primary)]">
        {icon}
      </span>
      <div>
        <h2 className="text-sm font-bold text-[var(--color-shell-text)]">{title}</h2>
        <p className="text-xs text-[var(--color-shell-text-muted)]">{description}</p>
      </div>
    </div>
  );
}

const selectClass =
  'w-full h-12 rounded-lg border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] px-3 py-2 text-base text-[var(--color-shell-text)] focus:border-[var(--color-shell-accent)] focus:outline-none cursor-pointer';

const textareaClass =
  'w-full rounded-lg border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] px-3 py-2 text-sm text-[var(--color-shell-text)] placeholder-[var(--color-shell-text-subtle)] focus:border-[var(--color-shell-primary)] focus:outline-none resize-y';

export const AdminCreateUserPage: React.FC = () => {
  const { navigate } = useNavigation();
  const [values, setValues] = useState<CreateUserFormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<CreateUserFieldErrors>({});
  const [segments, setSegments] = useState<SegmentOption[]>([]);
  const [segmentsLoading, setSegmentsLoading] = useState(true);
  const [segmentsError, setSegmentsError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [createdUserId, setCreatedUserId] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);

  const timezones = useMemo(() => listTimezones(), []);
  const isMentor = values.role === 'mentor';
  const passwordRequired = values.passwordMode === 'manual';

  // Segments come from the database. Nothing about a mentorship category is
  // hardcoded, and only active segments are offered for a new mentor.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSegmentsLoading(true);
      setSegmentsError(null);
      try {
        const res = await apiFetch('/api/admin/segments');
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error?.message || 'Unable to load segments.');
        const rows: any[] = Array.isArray(data.segments) ? data.segments : [];
        if (cancelled) return;
        setSegments(
          rows.map((row) => ({
            id: row.id,
            name: row.name,
            slug: row.slug,
            isActive: row.is_active !== false,
            priority: typeof row.priority === 'number' ? row.priority : 0,
          })),
        );
      } catch (err) {
        if (!cancelled) setSegmentsError(err instanceof Error ? err.message : 'Unable to load segments.');
      } finally {
        if (!cancelled) setSegmentsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback(<K extends keyof CreateUserFormValues>(key: K, value: CreateUserFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      // Only some form keys map to a field error; ignore the rest.
      const field = key as CreateUserFieldErrorKey;
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setError(null);
    setErrorCode(null);
  }, []);

  const generatePassword = useCallback(() => {
    try {
      update('password', generateTemporaryPassword());
      setShowPassword(true);
      setCopied(false);
    } catch {
      setError('This browser cannot generate a secure password. Set one manually instead.');
    }
  }, [update]);

  const copyPassword = useCallback(() => {
    if (!values.password) return;
    void navigator.clipboard?.writeText(values.password).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }, [values.password]);

  const toggleSegment = useCallback((segmentId: string) => {
    setValues((current) => ({
      ...current,
      segmentIds: current.segmentIds.includes(segmentId)
        ? current.segmentIds.filter((id) => id !== segmentId)
        : [...current.segmentIds, segmentId],
    }));
    setErrors((current) => (current.segmentIds ? { ...current, segmentIds: undefined } : current));
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setErrorCode(null);

    const validation = validateCreateUserForm(values);
    setErrors(validation.errors);
    if (!validation.valid) {
      setError('Please correct the highlighted fields before creating the account.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiFetch('/api/admin/users/direct-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildCreateUserPayload(values)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        const code = data.error?.code || 'SERVER_ERROR';
        setErrorCode(code);
        if (code === 'ACCOUNT_EXISTS') {
          setErrors((current) => ({ ...current, email: 'This email is already registered.' }));
        }
        if (code === 'VALIDATION_ERROR') {
          setError(data.error?.message || 'Some of the details provided are not valid.');
        } else {
          setError(data.error?.message || 'Unable to create the user account.');
        }
        return;
      }

      setCreatedUserId(data.user?.id || null);
      // Clear the secret from component state the moment the account exists.
      setValues((current) => ({ ...current, password: '', confirmPassword: '' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create the user account.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Success state
  // -------------------------------------------------------------------------
  if (createdUserId) {
    const detailPath = isMentor ? `/admin/mentors/${createdUserId}` : `/admin/users/${createdUserId}`;
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="rounded-xl border border-[var(--color-shell-success-border)] bg-[var(--color-shell-success-soft)] p-6">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-shell-success)]" />
            <div className="space-y-1">
              <h2 className="text-base font-bold text-[var(--color-shell-text)]">
                {isMentor ? 'Verified mentor created' : 'Seeker account created'}
              </h2>
              <p className="text-sm text-[var(--color-shell-text-muted)]">
                {values.fullName} now has a Supabase Auth account and a{' '}
                {isMentor ? 'mentor' : 'seeker'} profile.
              </p>
            </div>
          </div>
        </div>

        {isMentor && (
          <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="success">
                <ShieldCheck className="mr-1 h-3 w-3" /> Verified Mentor
              </Badge>
              <Badge variant="success">Active</Badge>
            </div>
            <p className="mt-2 text-xs text-[var(--color-shell-text-muted)]">
              Mentors created by Admin are automatically verified and activated. No public mentor
              verification was required.
            </p>
          </div>
        )}

        <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-5">
          <h3 className="text-sm font-bold text-[var(--color-shell-text)]">
            {isMentor ? 'Finish setting up this mentor' : 'Next steps'}
          </h3>
          <p className="mt-1 text-xs text-[var(--color-shell-text-muted)]">
            {isMentor
              ? 'Gigs, availability and bookings are managed from the mentor detail page.'
              : 'You can edit the profile and change the account status from the user detail page.'}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => navigate(detailPath)}>
              {isMentor ? 'Open Mentor Detail' : 'Open User Detail'}
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" onClick={() => navigate('/admin/users/create')}>
              Create Another User
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Form
  // -------------------------------------------------------------------------
  const activeSegments = segments.filter((segment) => segment.isActive);
  const displayTimezone =
    timezones.find((zone) => zone === values.timezone) ??
    (values.timezone ? values.timezone : 'Select a timezone');

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <button
        onClick={() => navigate('/admin/users')}
        className="-ml-1 flex items-center gap-1.5 rounded-md p-1 text-xs font-semibold text-[var(--color-shell-text-muted)] transition-colors hover:text-[var(--color-shell-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        <span>Back to Users</span>
      </button>

      <div className="flex items-start justify-between gap-4 border-b border-[var(--color-shell-border)] pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-shell-text)] sm:text-3xl">
            Create New User
          </h1>
          <p className="mt-1 text-sm text-[var(--color-shell-text-muted)]">
            Create a seeker account, or a trusted mentor that is approved and activated immediately.
          </p>
        </div>
        <UserPlus className="h-6 w-6 shrink-0 text-[var(--color-shell-primary)]" />
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-[var(--color-shell-error)] bg-[var(--color-shell-error-soft)] p-3 text-xs text-[var(--color-shell-error)]"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {errorCode === 'ACCOUNT_EXISTS' && (
        <p className="rounded-lg border border-[var(--color-shell-warning)]/40 bg-[var(--color-shell-warning-soft)] p-3 text-xs text-[var(--color-shell-text-muted)]">
          This email is already registered. No account was created. Use a different email address, or
          open the existing user to manage it.
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* 1. Account Role ---------------------------------------------------- */}
        <section className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-5 space-y-4">
          <SectionHeader
            icon={<User className="h-4 w-4" />}
            title="Account Role"
            description="Determines the account type and which sections apply. Admin accounts are not created here."
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(
              [
                { value: 'seeker', label: 'Seeker', copy: 'Discovers mentors and books sessions.' },
                { value: 'mentor', label: 'Mentor', copy: 'Offers mentorship and conducts sessions.' },
              ] as const
            ).map((option) => {
              const selected = values.role === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => update('role', option.value as AdminCreatableRole)}
                  className={`cursor-pointer rounded-lg border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] ${
                    selected
                      ? 'border-[var(--color-shell-primary)] bg-[var(--color-shell-accent-soft)]/20 ring-1 ring-[var(--color-shell-primary)]'
                      : 'border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] hover:border-[var(--color-shell-border)]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                        selected ? 'border-[var(--color-shell-primary)]' : 'border-[var(--color-shell-border-strong)]'
                      }`}
                    >
                      {selected && <span className="h-2 w-2 rounded-full bg-[var(--color-shell-primary)]" />}
                    </span>
                    <span
                      className={`text-xs font-semibold ${
                        selected ? 'text-[var(--color-shell-primary)]' : 'text-[var(--color-shell-text)]'
                      }`}
                    >
                      {option.label}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-[var(--color-shell-text-subtle)]">{option.copy}</p>
                </button>
              );
            })}
          </div>

          {isMentor && (
            <div className="flex items-start gap-2 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] p-3 text-xs text-[var(--color-shell-text-muted)]">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-shell-primary)]" />
              <p>
                <span className="font-semibold text-[var(--color-shell-text)]">Verified Mentor.</span> Mentors
                created by Admin are automatically verified and activated. There is no submission step, no
                pending verification state and no document review.
              </p>
            </div>
          )}
        </section>

        {/* 2. Personal Information -------------------------------------------- */}
        <section className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-5 space-y-4">
          <SectionHeader
            icon={<User className="h-4 w-4" />}
            title="Personal Information"
            description="The name, contact details and timezone stored on the user's profile."
          />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input
              label="Full Name"
              required
              placeholder="e.g. Priya Sharma"
              value={values.fullName}
              onChange={(event) => update('fullName', event.target.value)}
              error={errors.fullName}
              autoComplete="off"
            />
            <Input
              label="Email Address"
              type="email"
              required
              placeholder="e.g. user@example.com"
              value={values.email}
              onChange={(event) => update('email', event.target.value)}
              error={errors.email}
              helperText="Used to sign in. Must not already be registered."
              autoComplete="off"
            />
            <Input
              label="Phone Number"
              type="tel"
              placeholder="e.g. +91 98765 43210"
              value={values.phone}
              onChange={(event) => update('phone', event.target.value)}
              error={errors.phone}
              helperText="Optional. Contact number only — it is never used to sign in."
              autoComplete="off"
            />
            <div className="space-y-1.5">
              <label
                htmlFor="create-user-timezone"
                className="block text-xs font-semibold text-[var(--color-shell-text)]"
              >
                Timezone <span className="ml-0.5 text-[var(--color-shell-error)]">*</span>
              </label>
              <select
                id="create-user-timezone"
                value={values.timezone}
                onChange={(event) => update('timezone', event.target.value)}
                className={selectClass}
                aria-invalid={!!errors.timezone}
              >
                <option value="">Select a timezone</option>
                {timezones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
              {errors.timezone ? (
                <p className="text-xs font-medium text-[var(--color-shell-error)]">{errors.timezone}</p>
              ) : (
                <p className="text-xs text-[var(--color-shell-text-subtle)]">
                  All availability and session times are interpreted in this timezone.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="create-user-bio" className="block text-xs font-semibold text-[var(--color-shell-text)]">
              Bio / About
            </label>
            <textarea
              id="create-user-bio"
              rows={3}
              value={values.bio}
              onChange={(event) => update('bio', event.target.value)}
              placeholder={isMentor ? 'Shown on the mentor profile. The mentor can edit this later.' : 'A short introduction. Optional.'}
              className={textareaClass}
            />
            <p className="text-xs text-[var(--color-shell-text-subtle)]">
              {isMentor
                ? 'These details are used on the mentor profile. Save a separate professional headline below for the one-line summary.'
                : 'Optional. The user can edit this from their own settings.'}
            </p>
          </div>
        </section>

        {/* 3. Account Access -------------------------------------------------- */}
        <section className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-5 space-y-4">
          <SectionHeader
            icon={<KeyRound className="h-4 w-4" />}
            title="Account Access"
            description="Choose how this user will receive access to their account. Passwords are never stored in an application table — Supabase Auth owns them."
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(
              [
                {
                  value: 'invitation' as const,
                  label: 'Send a secure setup link',
                  copy: 'Recommended. The user sets their own password from an emailed link.',
                },
                {
                  value: 'manual' as const,
                  label: 'Set the password manually',
                  copy: 'Useful when handing the password over out of band. Share it over a secure channel.',
                },
              ]
            ).map((option) => {
              const selected = values.passwordMode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    update('passwordMode', option.value);
                    setErrors((current) => ({
                      ...current,
                      password: undefined,
                      confirmPassword: undefined,
                    }));
                  }}
                  className={`cursor-pointer rounded-lg border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] ${
                    selected
                      ? 'border-[var(--color-shell-primary)] bg-[var(--color-shell-accent-soft)]/20 ring-1 ring-[var(--color-shell-primary)]'
                      : 'border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] hover:border-[var(--color-shell-border)]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                        selected ? 'border-[var(--color-shell-primary)]' : 'border-[var(--color-shell-border-strong)]'
                      }`}
                    >
                      {selected && <span className="h-2 w-2 rounded-full bg-[var(--color-shell-primary)]" />}
                    </span>
                    <span
                      className={`text-xs font-semibold ${
                        selected ? 'text-[var(--color-shell-primary)]' : 'text-[var(--color-shell-text)]'
                      }`}
                    >
                      {option.label}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-[var(--color-shell-text-subtle)]">{option.copy}</p>
                </button>
              );
            })}
          </div>

          {passwordRequired && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="create-user-password" className="block text-xs font-semibold text-[var(--color-shell-text)]">
                  Password <span className="ml-0.5 text-[var(--color-shell-error)]">*</span>
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      id="create-user-password"
                      type={showPassword ? 'text' : 'password'}
                      value={values.password}
                      onChange={(event) => update('password', event.target.value)}
                      autoComplete="new-password"
                      className="h-12 w-full rounded-lg border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] px-3 py-2 pr-10 text-base text-[var(--color-shell-text)] focus:border-[var(--color-shell-accent)] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-[var(--color-shell-text-subtle)] hover:text-[var(--color-shell-text)]"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <Button type="button" variant="outline" onClick={generatePassword} className="h-12 shrink-0">
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Generate</span>
                  </Button>
                </div>
                {errors.password ? (
                  <p className="text-xs font-medium text-[var(--color-shell-error)]">{errors.password}</p>
                ) : (
                  <p className="text-xs text-[var(--color-shell-text-subtle)]">
                    Minimum 8 characters. Generated passwords are cleared from this screen once the account
                    is created.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <label htmlFor="create-user-confirm" className="block text-xs font-semibold text-[var(--color-shell-text)]">
                  Confirm Password <span className="ml-0.5 text-[var(--color-shell-error)]">*</span>
                </label>
                <input
                  id="create-user-confirm"
                  type={showPassword ? 'text' : 'password'}
                  value={values.confirmPassword}
                  onChange={(event) => update('confirmPassword', event.target.value)}
                  autoComplete="new-password"
                  className="h-12 w-full rounded-lg border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] px-3 py-2 text-base text-[var(--color-shell-text)] focus:border-[var(--color-shell-accent)] focus:outline-none"
                />
                {errors.confirmPassword && (
                  <p className="text-xs font-medium text-[var(--color-shell-error)]">{errors.confirmPassword}</p>
                )}
              </div>
              {values.password && (
                <div className="md:col-span-2 flex items-center justify-between gap-3 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] px-3 py-2">
                  <code className="truncate font-mono text-xs text-[var(--color-shell-text-muted)]">
                    {values.password}
                  </code>
                  <Button type="button" size="sm" variant="ghost" onClick={copyPassword} disabled={!values.password}>
                    {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </Button>
                </div>
              )}
            </div>
          )}

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-bg)] p-3">
            <input
              type="checkbox"
              checked={values.sendEmail}
              onChange={(event) => update('sendEmail', event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--color-shell-primary)]"
            />
            <span className="space-y-0.5">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-shell-text)]">
                <Mail className="h-3.5 w-3.5" /> Send account access email
              </span>
              <span className="block text-[11px] text-[var(--color-shell-text-subtle)]">
                Sends a secure setup/login link. No password is ever included in the email. You can resend it
                from the user detail page if delivery fails.
              </span>
            </span>
          </label>
        </section>

        {/* 4. Professional Information (mentor only) -------------------------- */}
        {isMentor && (
          <section className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-5 space-y-4">
            <SectionHeader
              icon={<Briefcase className="h-4 w-4" />}
              title="Professional Information"
              description="These details are used on the mentor profile."
            />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="create-user-headline" className="block text-xs font-semibold text-[var(--color-shell-text)]">
                  Professional Headline
                </label>
                <input
                  id="create-user-headline"
                  value={values.headline}
                  onChange={(event) => update('headline', event.target.value)}
                  placeholder="e.g. Relationship & career mentor"
                  className="h-12 w-full rounded-lg border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] px-3 py-2 text-base text-[var(--color-shell-text)] focus:border-[var(--color-shell-accent)] focus:outline-none"
                />
                <p className="text-xs text-[var(--color-shell-text-subtle)]">One line shown at the top of the mentor profile.</p>
              </div>
              <Input
                label="Years of Experience"
                type="number"
                min={0}
                max={80}
                step={1}
                placeholder="e.g. 6"
                value={values.experienceYears}
                onChange={(event) => update('experienceYears', event.target.value)}
                error={errors.experienceYears}
                helperText="Whole number of years. Leave blank if not known yet."
              />
              <Input
                label="Languages"
                placeholder="Hindi, English"
                value={values.languages}
                onChange={(event) => update('languages', event.target.value)}
                onBlur={() => update('languages', parseTagInput(values.languages))}
                helperText="Comma separated. The mentor can add more later."
              />
              <Input
                label="Areas of Expertise"
                placeholder="Relationships, Communication"
                value={values.expertise}
                onChange={(event) => update('expertise', event.target.value)}
                onBlur={() => update('expertise', parseTagInput(values.expertise))}
                helperText="Comma separated topics this mentor covers."
              />
            </div>
          </section>
        )}

        {/* 5. Mentorship Segments (mentor only) ------------------------------- */}
        {isMentor && (
          <section className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-5 space-y-4">
            <SectionHeader
              icon={<Layers className="h-4 w-4" />}
              title="Mentorship Segments"
              description="The categories this mentor will be listed under. Loaded live from the segments table."
            />

            {segmentsLoading ? (
              <div className="flex items-center gap-2 text-xs text-[var(--color-shell-text-muted)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading segments…
              </div>
            ) : segmentsError ? (
              <div className="flex items-start gap-2 rounded-lg border border-[var(--color-shell-error)] bg-[var(--color-shell-error-soft)] p-3 text-xs text-[var(--color-shell-error)]">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{segmentsError}</span>
              </div>
            ) : activeSegments.length === 0 ? (
              <p className="text-xs text-[var(--color-shell-text-subtle)]">
                No active segments exist yet. Create a segment before adding a mentor.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {activeSegments.map((segment) => {
                    const selected = values.segmentIds.includes(segment.id);
                    return (
                      <button
                        key={segment.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleSegment(segment.id)}
                        className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-shell-focus)] ${
                          selected
                            ? 'border-[var(--color-shell-primary)] bg-[var(--color-shell-accent-soft)]/20 text-[var(--color-shell-primary)]'
                            : 'border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] text-[var(--color-shell-text-muted)] hover:border-[var(--color-shell-border)]'
                        }`}
                      >
                        {segment.name}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-[var(--color-shell-text-subtle)]">
                  {values.segmentIds.length === 0
                    ? 'Select at least one segment.'
                    : `${values.segmentIds.length} segment${values.segmentIds.length === 1 ? '' : 's'} selected. One gig can then be created per segment.`}
                </p>
                {errors.segmentIds && (
                  <p className="text-xs font-medium text-[var(--color-shell-error)]">{errors.segmentIds}</p>
                )}
              </>
            )}
          </section>
        )}

        {/* 6. Review & Create -------------------------------------------------- */}
        <section className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-5 space-y-4">
          <SectionHeader
            icon={<CheckCircle2 className="h-4 w-4" />}
            title="Review & Create"
            description="Check the summary below, then create the account."
          />

          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
            {[
              ['Role', values.role === 'mentor' ? 'Mentor (verified & active on creation)' : 'Seeker'],
              ['Full name', values.fullName.trim() || '—'],
              ['Email', values.email.trim() || '—'],
              ['Phone', values.phone.trim() || 'Not provided'],
              ['Timezone', displayTimezone],
              [
                'Account access',
                values.passwordMode === 'manual' ? 'Password set by Admin' : 'Secure setup link',
              ],
              ['Access email', values.sendEmail ? 'Will be sent' : 'Not sent'],
              ...(isMentor
                ? [
                    ['Segments', values.segmentIds.length > 0 ? `${values.segmentIds.length} selected` : 'None selected'],
                    ['Experience', values.experienceYears.trim() ? `${values.experienceYears.trim()} years` : 'Not provided'],
                    ['Languages', values.languages.trim() || 'Not provided'],
                    ['Expertise', values.expertise.trim() || 'Not provided'],
                  ]
                : []),
            ].map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-3 border-b border-[var(--color-shell-border)] pb-1.5">
                <dt className="text-[var(--color-shell-text-subtle)]">{label}</dt>
                <dd className="truncate text-right font-medium text-[var(--color-shell-text)]">{value}</dd>
              </div>
            ))}
          </dl>

          {isMentor && (
            <p className="flex items-start gap-2 text-[11px] text-[var(--color-shell-text-muted)]">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-shell-primary)]" />
              After creation you will be taken to the mentor detail page to add the first gig and manage
              availability. Availability is global to the mentor, not per gig.
            </p>
          )}

          <div className="flex items-center justify-end gap-3 border-t border-[var(--color-shell-border)] pt-4">
            <Button type="button" variant="outline" onClick={() => navigate('/admin/users')} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isSubmitting} loadingText="Creating…">
              {isSubmitting ? <UserPlus className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
              <span>{isMentor ? 'Create Verified Mentor' : 'Create Seeker'}</span>
            </Button>
          </div>
        </section>
      </form>
    </div>
  );
};
