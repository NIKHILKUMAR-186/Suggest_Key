import React, { useState, useEffect } from 'react';
import { Shield, Check, Bell, KeyRound, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { PageHeading, SegmentedTabs } from '@/src/components/booking/PageHeading';
import { SectionCard } from '@/src/components/booking/StatePanel';
import { SupportPage } from '@/src/components/support/SupportPage';
import { TONE_SURFACE, TONE_TEXT } from '@/src/components/booking/tokens';
import { useAuth } from '@/src/context/AuthContext';
import { useNavigation } from '@/src/context/NavigationContext';
import { useToast } from '@/src/context/ToastContext';
import { toUserMessage } from '@/src/lib/errorMessages';
import { upsertUserProfile } from '@/src/lib/supabase';

interface ProfileUpdate {
  full_name?: string;
  timezone?: string;
  avatar_url?: string;
}

type SettingsTab = 'profile' | 'security' | 'notifications' | 'support';

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'profile', label: 'Profile' },
  { id: 'security', label: 'Security' },
  { id: 'notifications', label: 'Alerts' },
  { id: 'support', label: 'Help & Support' },
];

/**
 * The notification types the platform actually sends.
 *
 * This is a description of what a seeker will receive, not a set of toggles:
 * there is no per-type preference stored anywhere, so it is presented as
 * information rather than as switches that would do nothing when pressed.
 */
const NOTIFICATION_KINDS = [
  {
    title: 'Payment verification',
    desc: 'Sent when an admin approves or rejects your payment proof.',
  },
  {
    title: 'Meeting link unlock',
    desc: 'Sent 5 minutes before your session, when the video call room opens.',
  },
  {
    title: 'Workspace published',
    desc: 'Sent when your mentor posts takeaways and notes.',
  },
];

export const SeekerSettingsPage: React.FC = () => {
  const { profile, user } = useAuth();
  const { navigate } = useNavigation();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');
  const [savedMessage, setSavedMessage] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [displayName, setDisplayName] = useState<string>(
    profile?.full_name || user?.user_metadata?.full_name || ''
  );
  const [timezone, setTimezone] = useState<string>(profile?.timezone || 'Asia/Kolkata');

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.full_name);
      setTimezone(profile.timezone || 'Asia/Kolkata');
    }
  }, [profile, user]);

  const userEmail = user?.email || 'Not set';
  const userInitials = displayName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase() || 'U';

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setIsSaving(true);
    try {
      const updates: ProfileUpdate = {
        full_name: displayName,
        timezone: timezone,
      };
      const { error } = await upsertUserProfile({
        id: profile.id,
        email: profile.email || '',
        ...updates,
      });
      if (error) throw error;
      setSavedMessage(true);
      toast.success('Your profile details are up to date.', { title: 'Profile updated' });
    } catch (err: unknown) {
      toast.error(
        toUserMessage(err, 'We could not save your profile. Please try again.', { action: 'save-seeker-profile' }),
        { title: 'Save failed' }
      );
    } finally {
      setIsSaving(false);
      setTimeout(() => setSavedMessage(false), 3000);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeading
        title="Account Settings"
        description="Manage your profile, local timezone, security credentials and the alerts you receive."
      />

      {/* Tabs */}
      <SegmentedTabs
        value={activeTab}
        onChange={setActiveTab}
        ariaLabel="Settings sections"
        options={SETTINGS_TABS.map((t) => ({ id: t.id, label: t.label }))}
      />

      <AnimatePresence>
        {savedMessage && (
          <motion.div
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className={`flex items-center gap-2 rounded-lg border p-3 text-xs ${TONE_SURFACE.success} ${TONE_TEXT.success}`}
          >
            <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Profile updated successfully.</span>
          </motion.div>
        )}
      </AnimatePresence>

      {activeTab === 'profile' && (
        <motion.form
          onSubmit={handleSave}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <SectionCard title="Profile" description="How you appear to mentors and how your session times are shown.">
            <div className="flex flex-wrap items-center gap-5 border-b border-[var(--color-shell-border)] pb-6">
              <div
                aria-hidden="true"
                className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] font-display text-xl font-bold text-[var(--color-shell-text-muted)]"
              >
                {userInitials}
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-[var(--color-shell-text)]">Profile Avatar</h3>
                <p className="mt-0.5 text-xs text-[var(--color-shell-text-subtle)]">
                  Your initials are shown until a photo is set on your account.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Display Name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your full name"
              />
              <div className="space-y-1.5">
                <label
                  htmlFor="seeker-timezone"
                  className="block text-xs font-medium text-[var(--color-shell-text-muted)]"
                >
                  Local Timezone
                </label>
                <select
                  id="seeker-timezone"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="flex h-10 w-full cursor-pointer rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] px-3 py-2 text-sm text-[var(--color-shell-text)] focus:border-[var(--color-shell-accent)] focus:outline-hidden focus:ring-2 focus:ring-[var(--color-shell-accent)]/15"
                >
                  <option value="Asia/Kolkata">Asia/Kolkata (IST · UTC+5:30)</option>
                  <option value="America/New_York">America/New_York (EST · UTC-5:00)</option>
                  <option value="Europe/London">Europe/London (GMT · UTC+0:00)</option>
                  <option value="Asia/Singapore">Asia/Singapore (SGT · UTC+8:00)</option>
                </select>
                <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
                  All booking slot selections are presented in your local timezone.
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end border-t border-[var(--color-shell-border)] pt-5">
              <Button type="submit" size="md" className="gap-1.5 text-xs" disabled={isSaving} isLoading={isSaving} loadingText="Saving…">
                {!isSaving && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                <span>Save Settings</span>
              </Button>
            </div>
          </SectionCard>
        </motion.form>
      )}

      {activeTab === 'security' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <SectionCard title="Security" description="How your account is authenticated.">
            <p className="text-xs leading-relaxed text-[var(--color-shell-text-muted)]">
              Your password is managed by Suggest Key and is never stored in plain text. Request a
              reset link and we will email it to the address on your account.
            </p>
            <div className="mt-5 max-w-sm space-y-3">
              <Input label="Email Address" value={userEmail} disabled />
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-[var(--color-shell-border)] pt-5">
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${TONE_SURFACE.success} ${TONE_TEXT.success}`}>
                <Shield className="h-3 w-3" aria-hidden="true" />
                Secured authentication
              </span>
              <Button size="sm" className="gap-1.5 text-xs" onClick={() => navigate('/auth/forgot-password')}>
                <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Change Password</span>
              </Button>
            </div>
          </SectionCard>
        </motion.div>
      )}

      {activeTab === 'notifications' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <SectionCard
            title="Alerts"
            description="The updates Suggest Key sends you, and where to read them."
          >
            <p className="flex items-start gap-2 text-xs leading-relaxed text-[var(--color-shell-text-muted)]">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                These alerts are sent automatically and cannot be switched off individually. Review
                and dismiss them at any time from your notification centre.
              </span>
            </p>
            <ul className="mt-5 space-y-3 text-xs">
              {NOTIFICATION_KINDS.map((item) => (
                <li
                  key={item.title}
                  className="flex items-start gap-3 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface-elevated)] p-3"
                >
                  <Bell className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-shell-accent)]" aria-hidden="true" />
                  <div className="min-w-0">
                    <span className="block font-semibold text-[var(--color-shell-text)]">{item.title}</span>
                    <span className="text-[var(--color-shell-text-muted)]">{item.desc}</span>
                  </div>
                </li>
              ))}
            </ul>
          </SectionCard>
        </motion.div>
      )}

      {activeTab === 'support' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <SupportPage showHeading={false} />
        </motion.div>
      )}
    </div>
  );
};

export default SeekerSettingsPage;
