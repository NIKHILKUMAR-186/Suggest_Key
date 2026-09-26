import React, { useState, useEffect } from 'react';
import { Globe, Bell, Shield, Check, Briefcase, Layers, ArrowRight, KeyRound } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import { useToast } from '@/src/context/ToastContext';
import { toUserMessage } from '@/src/lib/errorMessages';
import { upsertUserProfile } from '@/src/lib/supabase';

export const MentorSettingsPage: React.FC = () => {
  const { navigate } = useNavigation();
  const { profile, user } = useAuth();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<'profile' | 'security'>('profile');
  const [isSaving, setIsSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState(false);

  const [displayName, setDisplayName] = useState<string>(profile?.full_name || '');
  const [timezone, setTimezone] = useState<string>(profile?.timezone || 'Asia/Kolkata');

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.full_name || '');
      setTimezone(profile.timezone || 'Asia/Kolkata');
    }
  }, [profile]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setIsSaving(true);
    try {
      const { error } = await upsertUserProfile({
        id: profile.id,
        email: profile.email || '',
        full_name: displayName.trim(),
        timezone,
      });
      if (error) throw error;
      setSavedMessage(true);
      toast.success('Your name and timezone are up to date.', { title: 'Profile updated' });
    } catch (err: unknown) {
      toast.error(
        toUserMessage(err, 'We could not save your profile. Please try again.', { action: 'save-mentor-profile' }),
        { title: 'Save failed' }
      );
    } finally {
      setIsSaving(false);
      setTimeout(() => setSavedMessage(false), 3000);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-shell-text)] sm:text-3xl">
          Mentor Settings
        </h1>
        <p className="mt-1 text-sm text-[var(--color-shell-text-muted)]">
          Manage your mentor profile and the timezone used for your availability.
        </p>
      </div>

      {/* Quick Links for Gigs & Segments */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          onClick={() => navigate('/mentor/gigs')}
          className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-4 shadow-xs flex items-center justify-between gap-3 text-left hover:border-[var(--color-shell-border-strong)] cursor-pointer transition-colors"
        >
          <span className="flex items-center gap-3 min-w-0">
            <span className="shrink-0 p-2.5 rounded-lg bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-text)]">
              <Briefcase className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold text-[var(--color-shell-text)]">Gig Management</span>
              <span className="block text-xs text-[var(--color-shell-text-muted)]">Create &amp; edit session packages and pricing</span>
            </span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-[var(--color-shell-text-subtle)]" aria-hidden="true" />
        </button>

        <button
          onClick={() => navigate('/mentor/segments')}
          className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-4 shadow-xs flex items-center justify-between gap-3 text-left hover:border-[var(--color-shell-border-strong)] cursor-pointer transition-colors"
        >
          <span className="flex items-center gap-3 min-w-0">
            <span className="shrink-0 p-2.5 rounded-lg bg-[var(--color-shell-surface-elevated)] text-[var(--color-shell-text)]">
              <Layers className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold text-[var(--color-shell-text)]">Segment Applications</span>
              <span className="block text-xs text-[var(--color-shell-text-muted)]">Apply for new mentorship specializations</span>
            </span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-[var(--color-shell-text-subtle)]" aria-hidden="true" />
        </button>
      </div>

      <div className="flex border-b border-[var(--color-shell-border)]" role="tablist" aria-label="Settings sections">
        {[
          { id: 'profile' as const, label: 'Profile' },
          { id: 'security' as const, label: 'Security' },
        ].map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`min-h-[44px] px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 ${
              activeTab === tab.id
                ? 'border-[var(--color-shell-primary)] text-[var(--color-shell-text)]'
                : 'border-transparent text-[var(--color-shell-text-muted)] hover:text-[var(--color-shell-text)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'profile' && (
        <form onSubmit={handleSave} className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-xs space-y-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-bold text-[var(--color-shell-text)]">Profile Information</h3>
            <AnimatePresence>
              {savedMessage && (
                <motion.span
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="inline-flex items-center gap-1 text-xs text-[var(--color-shell-success)]"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Saved
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <p className="text-xs text-[var(--color-shell-text-muted)]">
            Your name and timezone appear on your mentor profile and drive your availability.
          </p>

          <div className="space-y-1.5">
            <label htmlFor="mentor-settings-email" className="block text-xs font-medium text-[var(--color-shell-text-muted)]">
              Email
            </label>
            <Input
              id="mentor-settings-email"
              value={profile?.email || user?.email || ''}
              disabled
              className="bg-[var(--color-shell-surface-elevated)]"
            />
            <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
              Email cannot be changed from settings.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Full Name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your full name"
              required
            />
            <div className="space-y-1.5">
              <label htmlFor="mentor-settings-timezone" className="block text-xs font-medium text-[var(--color-shell-text-muted)]">
                Mentor Timezone
              </label>
              <select
                id="mentor-settings-timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="flex h-12 w-full rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] px-3 py-2 text-sm text-[var(--color-shell-text)] focus:border-[var(--color-shell-accent)] focus:outline-hidden focus:ring-2 focus:ring-[var(--color-shell-accent)]/15"
              >
                <option value="Asia/Kolkata">Asia/Kolkata (IST · UTC+5:30)</option>
                <option value="America/New_York">America/New_York (EST · UTC-5:00)</option>
                <option value="Europe/London">Europe/London (GMT · UTC+0:00)</option>
                <option value="Asia/Dubai">Asia/Dubai (GST · UTC+4:00)</option>
                <option value="Asia/Singapore">Asia/Singapore (SGT · UTC+8:00)</option>
              </select>
              <p className="text-[11px] text-[var(--color-shell-text-subtle)]">
                Authoritative base timezone for your recurring availability and slot generator.
              </p>
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <Button type="submit" size="md" className="text-xs gap-1.5" disabled={isSaving} isLoading={isSaving} loadingText="Saving…">
              {!isSaving && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
              <span>Save Profile</span>
            </Button>
          </div>
        </form>
      )}

      {activeTab === 'security' && (
        <div className="rounded-xl border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] p-6 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-[var(--color-shell-text)] border-b border-[var(--color-shell-border)] pb-3">
            Account Security
          </h3>
          <p className="text-xs text-[var(--color-shell-text-muted)]">
            Your password is managed by Suggest Key. Request a reset link and we will email it
            to the address on your account.
          </p>
          <div className="space-y-3 max-w-sm">
            <Button variant="outline" size="md" className="w-full justify-start gap-2" onClick={() => navigate('/auth/forgot-password')}>
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              <span>Change Password</span>
            </Button>
          </div>
          <p className="flex items-start gap-2 text-[11px] text-[var(--color-shell-text-subtle)]">
            <Shield className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            Sign-in history and session management are handled by the authentication provider and
            are not editable from this page.
          </p>
        </div>
      )}

      <p className="flex items-center gap-2 text-[11px] text-[var(--color-shell-text-subtle)]">
        <Globe className="h-3.5 w-3.5" aria-hidden="true" />
        Booking notifications are delivered in-app from the notification centre.
        <Bell className="h-3.5 w-3.5" aria-hidden="true" />
      </p>
    </div>
  );
};
