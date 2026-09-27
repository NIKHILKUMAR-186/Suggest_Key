import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Clock,
  CreditCard,
  Globe,
  History,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  Lock,
  Pencil,
  QrCode,
  ShieldCheck,
  Trash2,
  Upload,
  UserCog,
  X,
} from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { Input } from '@/src/components/ui/Input';
import { Textarea } from '@/src/components/ui/Textarea';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { ErrorState } from '@/src/components/shared/ErrorState';
import { useAuth } from '@/src/context/AuthContext';
import { useToast } from '@/src/context/ToastContext';
import { apiFetch } from '@/src/lib/apiClient';
import { logSanitizer } from '@/src/lib/logSanitizer';
import {
  fetchAdminPlatformConfiguration,
  savePaymentConfiguration,
  requestQrUploadTicket,
  uploadQrImage,
  deletePaymentQrImage,
  toSettingsErrorMessage,
  type AdminPlatformConfiguration,
  type PaymentConfiguration,
} from '@/src/lib/platformConfig';
import {
  PAYMENT_QR_MIME_TYPES,
  PAYMENT_QR_MAX_BYTES,
  PAYMENT_QR_MAX_LABEL,
  validateQrFile,
  validateUpiId,
} from '@/src/lib/paymentProof';

const ACCEPTED_IMAGE_TYPES = PAYMENT_QR_MIME_TYPES.join(',');

/** Currency the payment architecture actually supports: every amount is an `*_inr` integer. */
const SUPPORTED_CURRENCY = 'INR';

const TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Karachi',
  'Asia/Dhaka',
  'Asia/Kathmandu',
  'Asia/Colombo',
  'Asia/Ho_Chi_Minh',
  'Asia/Jakarta',
  'Asia/Manila',
  'Australia/Sydney',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'UTC',
];

/** The `profiles` row for the signed-in admin, as the admin user endpoint returns it. */
interface AdminProfileRecord {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  timezone: string;
  phone: string | null;
  account_status: string | null;
  created_at: string;
  updated_at: string;
}

interface AdminSelfResponse {
  profile: AdminProfileRecord;
  roles: string[];
  auth: {
    invitationStatus: 'pending' | 'sent' | 'accepted';
    createdAt: string | null;
    lastSignInAt: string | null;
    emailConfirmedAt: string | null;
  } | null;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

async function readApiErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const message = body?.error?.message;
    if (typeof message === 'string' && message.trim()) return message;
  } catch {
    // Non-JSON error body.
  }
  return 'The server rejected this request.';
}

/** Pulls a message out of a failed response, defaulting to a caller-supplied line. */
async function messageFromError(err: unknown, fallback: string): Promise<string> {
  if (err instanceof Error && err.message.trim()) return err.message;
  console.warn('Admin settings request failed:', logSanitizer.safeMessage(err));
  return fallback;
}

// ---------------------------------------------------------------------------
// Shared card shell
// ---------------------------------------------------------------------------

interface SectionCardProps {
  icon: React.ElementType;
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}

const SectionCard: React.FC<SectionCardProps> = ({ icon: Icon, title, description, action, children }) => (
  <section className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-xs space-y-5">
    <div className="flex items-start justify-between gap-3 border-b border-[var(--color-shell-border)] pb-3">
      <div className="flex items-start gap-2.5">
        <Icon className="h-4 w-4 mt-0.5 shrink-0 text-[var(--color-shell-text-muted)]" aria-hidden="true" />
        <div>
          <h2 className="text-sm font-bold text-[var(--color-shell-text)]">{title}</h2>
          <p className="text-xs text-[var(--color-shell-text-muted)] mt-0.5">{description}</p>
        </div>
      </div>
      {action}
    </div>
    {children}
  </section>
);

/** An inline stat: a read-only value the platform enforces, with its reason. */
const RuleItem: React.FC<{ label: string; value: string; note: string }> = ({ label, value, note }) => (
  <div className="p-3 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] space-y-1">
    <span className="font-semibold text-[var(--color-shell-text)] block text-xs">{label}</span>
    <span className="text-[var(--color-shell-text-muted)] break-words text-xs">{value}</span>
    <p className="text-[11px] text-[var(--color-shell-text-subtle)]">{note}</p>
  </div>
);

// ---------------------------------------------------------------------------
// Payment configuration
// ---------------------------------------------------------------------------

interface PaymentDraft {
  upiId: string;
  accountName: string;
  instructions: string;
}

const draftFromPayment = (payment: PaymentConfiguration): PaymentDraft => ({
  upiId: payment.upiId ?? '',
  accountName: payment.accountName ?? '',
  instructions: payment.instructions ?? '',
});

const PaymentConfigurationCard: React.FC<{
  payment: PaymentConfiguration;
  onSaved: (payment: PaymentConfiguration) => void;
}> = ({ payment, onSaved }) => {
  const toast = useToast();

  const [draft, setDraft] = useState<PaymentDraft>(() => draftFromPayment(payment));
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isRemovingQr, setIsRemovingQr] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Re-seed the form whenever the persisted values change underneath it, so a
  // refresh or a save from another tab is reflected rather than overwritten by a
  // stale draft.
  useEffect(() => {
    if (!isEditing) setDraft(draftFromPayment(payment));
  }, [payment, isEditing]);

  const startEditing = () => {
    setDraft(draftFromPayment(payment));
    setFieldError(null);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setDraft(draftFromPayment(payment));
    setFieldError(null);
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (isSaving) return;

    // Validate before the request so the reason is shown next to the field that
    // caused it. The server re-validates the same rule; this is not the only gate.
    const upi = validateUpiId(draft.upiId);
    if (!upi.ok) {
      setFieldError(upi.message);
      return;
    }
    if (draft.instructions.length > 1000) {
      setFieldError('Payment instructions must be 1000 characters or fewer.');
      return;
    }
    if (draft.accountName.length > 120) {
      setFieldError('The account name must be 120 characters or fewer.');
      return;
    }

    setFieldError(null);
    setIsSaving(true);
    try {
      const saved = await savePaymentConfiguration({
        upiId: upi.value,
        accountName: draft.accountName.trim() === '' ? null : draft.accountName.trim(),
        instructions: draft.instructions.trim() === '' ? null : draft.instructions,
        currency: SUPPORTED_CURRENCY,
      });
      onSaved(saved);
      setIsEditing(false);
      toast.success('Payment configuration saved. Seekers will see the new details on their next payment page load.', {
        title: 'Payment configuration updated',
      });
    } catch (err) {
      setFieldError(await messageFromError(err, 'The payment configuration could not be saved.'));
      toast.error(toSettingsErrorMessage(err, 'The payment configuration could not be saved.'), {
        title: 'Save failed',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleQrSelected = async (file: File | null | undefined) => {
    setQrError(null);
    if (!file) return;

    const validation = validateQrFile({ name: file.name, type: file.type, size: file.size });
    if (!validation.ok) {
      setQrError(validation.message);
      return;
    }

    setIsUploading(true);
    try {
      // Two steps, matching how payment proofs are already uploaded: ask the
      // server for a signed slot, push the bytes straight to Storage, then
      // persist only the resulting object key.
      const ticket = await requestQrUploadTicket(file);
      const storedPath = await uploadQrImage(ticket, file);

      const saved = await savePaymentConfiguration({ qrImageStoragePath: storedPath });
      onSaved(saved);
      toast.success('The payment QR was replaced and is now shown to seekers.', {
        title: 'Payment QR updated',
      });
    } catch (err) {
      setQrError(await messageFromError(err, 'The payment QR could not be uploaded.'));
      toast.error(toSettingsErrorMessage(err, 'The payment QR could not be uploaded.'), {
        title: 'Upload failed',
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveQr = async () => {
    if (isRemovingQr) return;
    setIsRemovingQr(true);
    setQrError(null);
    try {
      await deletePaymentQrImage();
      onSaved({ ...payment, qrImageStoragePath: null, qrImageUrl: null });
      toast.success('The payment QR was removed. Seekers now see the UPI ID only.', {
        title: 'Payment QR removed',
      });
    } catch (err) {
      setQrError(await messageFromError(err, 'The payment QR could not be removed.'));
      toast.error(toSettingsErrorMessage(err, 'The payment QR could not be removed.'), {
        title: 'Removal failed',
      });
    } finally {
      setIsRemovingQr(false);
    }
  };

  const hasQr = Boolean(payment.qrImageUrl);
  const isConfigured = Boolean(payment.upiId) && hasQr;

  return (
    <SectionCard
      icon={CreditCard}
      title="Payment Configuration"
      description="What seekers see on the payment page. Saved to the database and read from there by the seeker flow."
      action={
        isEditing ? (
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" onClick={cancelEditing} disabled={isSaving} className="h-8 text-xs gap-1.5">
              <X className="h-3.5 w-3.5" />
              <span>Cancel</span>
            </Button>
            <Button size="sm" onClick={handleSave} disabled={isSaving} className="h-8 text-xs gap-1.5">
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              <span>Save</span>
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={startEditing} className="h-8 shrink-0 text-xs gap-1.5">
            <Pencil className="h-3.5 w-3.5" />
            <span>Edit</span>
          </Button>
        )
      }
    >
      {!isConfigured && !isEditing && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--color-shell-warning)]/40 bg-[var(--color-shell-warning-soft)] p-3 text-xs text-[var(--color-shell-text)]">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-[var(--color-shell-warning)]" aria-hidden="true" />
          <span>
            Payment collection is not fully configured yet. Seekers cannot complete a payment until a UPI ID and a
            payment QR are both saved.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          {isEditing ? (
            <>
              <Input
                label="UPI ID"
                value={draft.upiId}
                onChange={(e) => setDraft((prev) => ({ ...prev, upiId: e.target.value }))}
                placeholder="name@bank"
                autoComplete="off"
                spellCheck={false}
                disabled={isSaving}
                maxLength={120}
                helperText="The address a seeker transfers to. Shown on the payment page and copyable."
                required
              />
              <Input
                label="Account display name"
                value={draft.accountName}
                onChange={(e) => setDraft((prev) => ({ ...prev, accountName: e.target.value }))}
                placeholder="Optional — shown beside the UPI ID"
                autoComplete="off"
                disabled={isSaving}
                maxLength={120}
                helperText="Helps seekers match the payee name in their UPI app."
              />
              <Textarea
                label="Payment instructions"
                value={draft.instructions}
                onChange={(e) => setDraft((prev) => ({ ...prev, instructions: e.target.value }))}
                placeholder="e.g. Add your name in the payment remarks so we can match your transfer."
                rows={4}
                disabled={isSaving}
                maxLength={1000}
                helperText="Optional. Displayed above the proof upload on the seeker payment page."
              />
            </>
          ) : (
            <div className="space-y-3">
              <div className="p-3 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] space-y-1">
                <span className="font-semibold text-[var(--color-shell-text)] block text-xs">UPI ID</span>
                {payment.upiId ? (
                  <span className="font-mono text-[var(--color-shell-text)] break-all text-xs">{payment.upiId}</span>
                ) : (
                  <span className="text-[var(--color-shell-text-subtle)] text-xs">Not configured</span>
                )}
                <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
                  The address seekers transfer to.
                </p>
              </div>

              <div className="p-3 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] space-y-1">
                <span className="font-semibold text-[var(--color-shell-text)] block text-xs">Account display name</span>
                <span className="text-[var(--color-shell-text-muted)] break-words text-xs">
                  {payment.accountName || 'Not set'}
                </span>
                <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
                  Shown beside the UPI ID so seekers can match the payee.
                </p>
              </div>

              <div className="p-3 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] space-y-1">
                <span className="font-semibold text-[var(--color-shell-text)] block text-xs">Payment instructions</span>
                <p className="text-[var(--color-shell-text-muted)] whitespace-pre-wrap text-xs">
                  {payment.instructions || 'None set'}
                </p>
                <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
                  Displayed above the proof upload.
                </p>
              </div>

              <div className="p-3 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] space-y-1">
                <span className="font-semibold text-[var(--color-shell-text)] block text-xs">Currency</span>
                <span className="text-[var(--color-shell-text-muted)] text-xs">
                  {SUPPORTED_CURRENCY} (₹) — Indian Rupee
                </span>
                <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
                  Fixed by the payment architecture: every amount is stored as an <code>*_inr</code> integer.
                </p>
              </div>
            </div>
          )}

          {fieldError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-[var(--color-shell-error)]/40 bg-[var(--color-shell-error-soft)] p-3 text-xs font-medium text-[var(--color-shell-error)]"
            >
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{fieldError}</span>
            </div>
          )}
        </div>

        {/* ---- QR image ---- */}
        <div className="space-y-3">
          <span className="text-xs font-semibold text-[var(--color-shell-text)]">Payment QR image</span>

          <div className="flex flex-col items-center gap-3 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] p-4">
            {hasQr ? (
              <img
                src={payment.qrImageUrl ?? undefined}
                alt="Current payment QR code"
                className="h-40 w-40 rounded-lg border border-[var(--color-shell-border)] bg-white object-contain p-1"
              />
            ) : (
              <div className="flex h-40 w-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--color-shell-border-strong)] bg-[var(--color-shell-surface)] text-center px-3">
                <QrCode className="h-8 w-8 text-[var(--color-shell-text-subtle)]" aria-hidden="true" />
                <span className="text-[11px] text-[var(--color-shell-text-subtle)]">No QR uploaded</span>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES}
              className="sr-only"
              aria-label="Payment QR image file"
              onChange={(e) => {
                void handleQrSelected(e.target.files?.[0]);
                e.target.value = '';
              }}
            />

            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                disabled={isUploading || isRemovingQr}
                onClick={() => fileInputRef.current?.click()}
              >
                {isUploading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : hasQr ? (
                  <Upload className="h-3.5 w-3.5" />
                ) : (
                  <ImageIcon className="h-3.5 w-3.5" />
                )}
                <span>{isUploading ? 'Uploading…' : hasQr ? 'Replace QR' : 'Upload QR'}</span>
              </Button>

              {hasQr && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5"
                  disabled={isUploading || isRemovingQr}
                  onClick={handleRemoveQr}
                >
                  {isRemovingQr ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  <span>{isRemovingQr ? 'Removing…' : 'Remove QR'}</span>
                </Button>
              )}
            </div>

            <p className="text-[10px] text-center text-[var(--color-shell-text-subtle)]">
              PNG, JPEG or WebP · up to {PAYMENT_QR_MAX_LABEL} · stored in Supabase Storage
            </p>
          </div>

          {qrError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-[var(--color-shell-error)]/40 bg-[var(--color-shell-error-soft)] p-3 text-xs font-medium text-[var(--color-shell-error)]"
            >
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{qrError}</span>
            </div>
          )}

          <p className="flex items-start gap-2 text-[11px] text-[var(--color-shell-text-subtle)]">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              The image is stored in Supabase Storage and only its reference is saved in the database. Replacing the QR
              applies immediately to every seeker payment page.
            </span>
          </p>
        </div>
      </div>

      <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
        {payment.updatedAt
          ? `Last changed ${formatTimestamp(payment.updatedAt)}.`
          : 'No payment configuration has been saved yet.'}
      </p>
    </SectionCard>
  );
};

// ---------------------------------------------------------------------------
// Admin profile
// ---------------------------------------------------------------------------

const AdminProfileCard: React.FC<{ adminId: string }> = ({ adminId }) => {
  const toast = useToast();

  const [profile, setProfile] = useState<AdminProfileRecord | null>(null);
  const [draft, setDraft] = useState({ fullName: '', phone: '', timezone: '' });
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  // Re-reads the admin's own `profiles` row from the database. Always keyed on
  // the real column names, so the form can never show a value the database does
  // not hold.
  const loadProfile = useCallback(async () => {
    const res = await apiFetch(`/api/admin/users/${adminId}`);
    if (!res.ok) throw new Error(await readApiErrorMessage(res));

    const body = await res.json();
    const record = body?.user?.profile as AdminProfileRecord | undefined;
    if (!record) throw new Error('The admin profile response was incomplete.');

    setProfile(record);
    setDraft({
      fullName: record.full_name ?? '',
      phone: record.phone ?? '',
      timezone: record.timezone ?? '',
    });
  }, [adminId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await loadProfile();
      } catch (err) {
        if (cancelled) return;
        console.warn('Unable to load the admin profile:', logSanitizer.safeMessage(err));
        setProfile(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadProfile]);

  const startEditing = () => {
    if (!profile) return;
    setDraft({
      fullName: profile.full_name ?? '',
      phone: profile.phone ?? '',
      timezone: profile.timezone ?? '',
    });
    setFieldError(null);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    if (profile) {
      setDraft({
        fullName: profile.full_name ?? '',
        phone: profile.phone ?? '',
        timezone: profile.timezone ?? '',
      });
    }
    setFieldError(null);
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (isSaving) return;

    const fullName = draft.fullName.trim();
    if (fullName.length < 2) {
      setFieldError('Enter your display name (at least 2 characters).');
      return;
    }
    if (fullName.length > 120) {
      setFieldError('The display name must be 120 characters or fewer.');
      return;
    }
    const phone = draft.phone.trim();
    if (phone && !/^[0-9+()\-\s]{6,20}$/.test(phone)) {
      setFieldError('Enter a valid contact number, or leave it blank.');
      return;
    }
    if (!draft.timezone) {
      setFieldError('Select a timezone.');
      return;
    }

    setFieldError(null);
    setIsSaving(true);
    try {
      // The existing admin-gated, audited profile endpoint. Reused rather than
      // duplicated: it is already the authorized writer for these columns.
      const res = await apiFetch(`/api/admin/users/${adminId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          phone: phone === '' ? '' : phone,
          timezone: draft.timezone,
        }),
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res));

      // Re-read rather than trusting the local draft, so what is shown afterwards
      // is what the database actually stored.
      await loadProfile();
      setIsEditing(false);
      toast.success('Your admin profile has been updated.', { title: 'Profile saved' });
    } catch (err) {
      setFieldError(await messageFromError(err, 'Your profile could not be saved.'));
      toast.error(toSettingsErrorMessage(err, 'Your profile could not be saved.'), { title: 'Save failed' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SectionCard
      icon={UserCog}
      title="Admin Profile"
      description="Your own operator details. Changes are written to your profiles row and audited."
      action={
        isEditing ? (
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" onClick={cancelEditing} disabled={isSaving} className="h-8 text-xs gap-1.5">
              <X className="h-3.5 w-3.5" />
              <span>Cancel</span>
            </Button>
            <Button size="sm" onClick={handleSave} disabled={isSaving} className="h-8 text-xs gap-1.5">
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              <span>Save</span>
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={startEditing}
            disabled={!profile}
            className="h-8 shrink-0 text-xs gap-1.5"
          >
            <Pencil className="h-3.5 w-3.5" />
            <span>Edit</span>
          </Button>
        )
      }
    >
      {!profile ? (
        <div className="space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : isEditing ? (
        <div className="space-y-4">
          <Input
            label="Display name"
            value={draft.fullName}
            onChange={(e) => setDraft((prev) => ({ ...prev, fullName: e.target.value }))}
            disabled={isSaving}
            maxLength={120}
            autoComplete="name"
            helperText="Shown across the admin console."
            required
          />
          <Input
            label="Contact number"
            value={draft.phone}
            onChange={(e) => setDraft((prev) => ({ ...prev, phone: e.target.value }))}
            placeholder="Optional"
            disabled={isSaving}
            maxLength={20}
            autoComplete="tel"
            helperText="An operator contact number. It is never used to sign in."
          />
          <div className="space-y-1.5">
            <label htmlFor="admin-timezone" className="block text-xs font-semibold text-[var(--color-shell-text)]">
              Timezone
            </label>
            <select
              id="admin-timezone"
              value={draft.timezone}
              onChange={(e) => setDraft((prev) => ({ ...prev, timezone: e.target.value }))}
              disabled={isSaving}
              className="flex h-12 w-full rounded-lg border border-[var(--color-shell-border-strong)] bg-[var(--color-shell-bg)] px-3 py-2 text-sm text-[var(--color-shell-text)] focus:border-[var(--color-shell-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--color-shell-accent-soft)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {/* Keeps a timezone that is not on the curated list selectable,
                  instead of silently rewriting an admin's stored value. */}
              {!TIMEZONES.includes(draft.timezone) && <option value={draft.timezone}>{draft.timezone}</option>}
              {TIMEZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
            <p className="text-xs text-[var(--color-shell-text-subtle)]">
              Used to interpret operational timestamps for your account.
            </p>
          </div>

          {fieldError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-[var(--color-shell-error)]/40 bg-[var(--color-shell-error-soft)] p-3 text-xs font-medium text-[var(--color-shell-error)]"
            >
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{fieldError}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] space-y-1">
            <span className="font-semibold text-[var(--color-shell-text)] block text-xs">Display name</span>
            <span className="text-[var(--color-shell-text-muted)] break-words text-xs">{profile.full_name}</span>
          </div>
          <div className="p-3 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] space-y-1">
            <span className="font-semibold text-[var(--color-shell-text)] block text-xs">Contact number</span>
            <span className="text-[var(--color-shell-text-muted)] break-words text-xs">{profile.phone || 'Not set'}</span>
          </div>
          <div className="p-3 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] space-y-1">
            <span className="font-semibold text-[var(--color-shell-text)] block text-xs">Timezone</span>
            <span className="text-[var(--color-shell-text-muted)] break-words text-xs">{profile.timezone}</span>
          </div>
          <div className="p-3 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] space-y-1">
            <span className="font-semibold text-[var(--color-shell-text)] block text-xs">Account status</span>
            <Badge variant={profile.account_status === 'active' ? 'success' : 'destructive'} className="text-[10px] font-bold uppercase">
              {profile.account_status ?? 'active'}
            </Badge>
          </div>
        </div>
      )}
    </SectionCard>
  );
};

// ---------------------------------------------------------------------------
// Account / security
// ---------------------------------------------------------------------------

const AccountSecurityCard: React.FC<{ adminId: string }> = ({ adminId }) => {
  const { user, updatePassword } = useAuth();
  const toast = useToast();

  const [authState, setAuthState] = useState<AdminSelfResponse['auth']>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch(`/api/admin/users/${adminId}`);
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled) setAuthState(body?.user?.auth ?? null);
      } catch (err) {
        // Supplementary only: the password form and the email below are still
        // real, so a failure here must not block the section.
        console.warn('Unable to load the admin auth state:', logSanitizer.safeMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adminId]);

  const handleChangePassword = async () => {
    if (isSaving) return;

    if (password.length < 8) {
      setFieldError('Choose a password of at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setFieldError('The two passwords do not match.');
      return;
    }

    setFieldError(null);
    setIsSaving(true);
    try {
      // The project's existing Supabase Auth password change. There is no admin
      // console path that writes a password to the database directly, and no
      // password is ever read into this page.
      const { error } = await updatePassword(password);
      if (error) throw error;

      setPassword('');
      setConfirmPassword('');
      toast.success('Your password has been changed.', { title: 'Password updated' });
    } catch (err) {
      setFieldError(await messageFromError(err, 'Your password could not be changed.'));
      toast.error(toSettingsErrorMessage(err, 'Your password could not be changed.'), { title: 'Change failed' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SectionCard
      icon={KeyRound}
      title="Account & Security"
      description="Your sign-in identity. Credentials stay inside Supabase Auth and are never sent to this console."
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="p-3 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] space-y-1">
          <span className="font-semibold text-[var(--color-shell-text)] block text-xs">Email address</span>
          <span className="text-[var(--color-shell-text-muted)] break-all text-xs">
            {user?.email ?? profileEmailFallback(user?.id)}
          </span>
          <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
            Managed by Supabase Auth. Not editable here.
          </p>
        </div>
        <div className="p-3 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] space-y-1">
          <span className="font-semibold text-[var(--color-shell-text)] block text-xs">Email confirmed</span>
          <span className="text-[var(--color-shell-text-muted)] text-xs">
            {authState ? (authState.emailConfirmedAt ? 'Confirmed' : 'Not confirmed') : '—'}
          </span>
        </div>
        <div className="p-3 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] space-y-1">
          <span className="font-semibold text-[var(--color-shell-text)] block text-xs">Last sign-in</span>
          <span className="text-[var(--color-shell-text-muted)] text-xs">
            {authState ? formatTimestamp(authState.lastSignInAt) : '—'}
          </span>
        </div>
        <div className="p-3 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] space-y-1">
          <span className="font-semibold text-[var(--color-shell-text)] block text-xs">Account created</span>
          <span className="text-[var(--color-shell-text-muted)] text-xs">
            {authState ? formatTimestamp(authState.createdAt) : '—'}
          </span>
        </div>
      </div>

      <div className="space-y-3 border-t border-[var(--color-shell-border)] pt-4">
        <h3 className="text-xs font-bold text-[var(--color-shell-text)]">Change password</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="New password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            disabled={isSaving}
            helperText="At least 8 characters."
          />
          <Input
            label="Confirm new password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            disabled={isSaving}
          />
        </div>

        {fieldError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-[var(--color-shell-error)]/40 bg-[var(--color-shell-error-soft)] p-3 text-xs font-medium text-[var(--color-shell-error)]"
          >
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{fieldError}</span>
          </div>
        )}

        <Button
          size="sm"
          onClick={handleChangePassword}
          disabled={isSaving || !password || !confirmPassword}
          className="h-8 text-xs gap-1.5"
        >
          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
          <span>Update password</span>
        </Button>
      </div>

      <p className="flex items-start gap-2 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] p-3 text-[11px] text-[var(--color-shell-text-muted)]">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
        <span>
          No password, token or service key is ever returned to the browser. Every admin mutation on this page is
          authorized server-side from your verified session, so the interface is not the security boundary.
        </span>
      </p>
    </SectionCard>
  );
};

const profileEmailFallback = (id: string | undefined): string => (id ? 'Available in Supabase Auth' : 'Not available');

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export const AdminSettingsPage: React.FC = () => {
  const { user } = useAuth();

  const [config, setConfig] = useState<AdminPlatformConfiguration | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const adminId = user?.id;

  const loadConfig = useCallback(async () => {
    if (!adminId) {
      setError('You are not signed in as an administrator.');
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      setConfig(await fetchAdminPlatformConfiguration());
    } catch (err) {
      setConfig(null);
      setError(toSettingsErrorMessage(err, 'The platform configuration could not be loaded.'));
    } finally {
      setIsLoading(false);
    }
  }, [adminId]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const rules = config?.rules;

  const rulesSection = rules ? (
    <>
      <SectionCard
        icon={Clock}
        title="Booking & Session Rules"
        description="Enforced in the booking engine and in the database, and served from that same source so this page cannot drift from what actually applies."
        action={
          <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-mono text-[var(--color-shell-text-muted)] bg-[var(--color-shell-surface-elevated)] px-2 py-0.5 rounded border border-[var(--color-shell-border)]">
            <Lock className="h-3 w-3" aria-hidden="true" />
            Server enforced
          </span>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <RuleItem
            label="Slot Hold Duration"
            value={`${rules.holdDurationMinutes} minutes`}
            note="The atomic hold expires automatically if payment proof is not submitted in time."
          />
          <RuleItem
            label="Booking Cut-off"
            value={`${rules.bookingCutoffMinutes} minutes before start`}
            note="A valid available slot stays bookable until this many minutes before it begins."
          />
          <RuleItem
            label="Meeting Link Concealment"
            value={`T-${rules.sessionAccessWindowMinutes} minutes before session`}
            note="The link is hidden from the seeker and the join control stays locked until this window opens."
          />
          <RuleItem
            label="Recommended Link Deadline"
            value={`${rules.meetingLinkDeadlineHours} hours before session`}
            note="An operational rule for mentors adding a meeting URL. It is recorded for audit and never blocks booking."
          />
          <RuleItem
            label="Seeker Cancellation Policy"
            value={`≥ ${rules.cancellationWindowMinutes} minutes prior`}
            note={`Cancellations inside ${rules.cancellationWindowMinutes} minutes of the session start are locked.`}
          />
          <RuleItem
            label="Collection Method"
            value={rules.paymentMethod === 'manual_qr' ? 'Manual QR verification' : rules.paymentMethod}
            note="An admin verifies each submitted payment proof before the booking advances."
          />
        </div>
      </SectionCard>

      <SectionCard
        icon={Globe}
        title="Timezone & Regional"
        description="The platform default applied when a user has not set a timezone of their own."
        action={
          <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-mono text-[var(--color-shell-text-muted)] bg-[var(--color-shell-surface-elevated)] px-2 py-0.5 rounded border border-[var(--color-shell-border)]">
            <Lock className="h-3 w-3" aria-hidden="true" />
            Server enforced
          </span>
        }
      >
        <RuleItem
          label="Default Timezone"
          value={rules.defaultTimezone}
          note="A fallback only. Every user and mentor can carry their own timezone, which always wins."
        />
      </SectionCard>
    </>
  ) : null;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="border-b border-[var(--color-shell-border)] pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-shell-text)] sm:text-3xl">
          Platform Configuration
        </h1>
        <p className="mt-1 text-xs text-[var(--color-shell-text-muted)]">
          The payment details seekers pay against, the rules the platform enforces, and your own operator account.
        </p>
      </div>

      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-44 w-full rounded-xl" />
          <Skeleton className="h-56 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      )}

      {!isLoading && error && (
        <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)]">
          <ErrorState
            title="Configuration Unavailable"
            message={error}
            onRetry={() => void loadConfig()}
          />
        </div>
      )}

      {!isLoading && !error && config && (
        <>
          {rulesSection}

          <PaymentConfigurationCard
            payment={config.payment}
            onSaved={(payment) => setConfig((prev) => (prev ? { ...prev, payment } : prev))}
          />

          <AdminProfileCard adminId={adminId ?? ''} />
          <AccountSecurityCard adminId={adminId ?? ''} />

          <SectionCard
            icon={History}
            title="Configuration Status"
            description="Where this page's values come from and what happens when they change."
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <RuleItem
                label="Payment details source"
                value="platform_config (database)"
                note="One row, written only through the audited admin endpoint. The seeker payment page reads the same row."
              />
              <RuleItem
                label="Booking rules source"
                value="Server booking engine"
                note="Read-only here. Changing them is a deployment change, not a console edit, so the UI cannot claim a value the engine is not applying."
              />
              <RuleItem
                label="Profile changes"
                value="Your profiles row"
                note="Written through the existing admin-authorized profile endpoint and recorded in the audit log."
              />
              <RuleItem
                label="Credentials"
                value="Supabase Auth"
                note="Held server-side. This page never receives a password, token or service-role key."
              />
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
};

export default AdminSettingsPage;
