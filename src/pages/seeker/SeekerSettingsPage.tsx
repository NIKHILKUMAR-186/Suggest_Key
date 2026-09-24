import React, { useState, useEffect } from 'react';
import { User, Shield, Camera, Check, Bell } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { Badge } from '@/src/components/ui/Badge';
import { useAuth } from '@/src/context/AuthContext';
import { upsertUserProfile } from '@/src/lib/supabase';

interface ProfileUpdate {
  full_name?: string;
  timezone?: string;
  avatar_url?: string;
}

export const SeekerSettingsPage: React.FC = () => {
  const { profile, user } = useAuth();
  const [activeTab, setActiveTab] = useState<'profile' | 'security' | 'notifications'>('profile');
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
    } catch (err) {
      console.error('Failed to save profile:', err);
    } finally {
      setIsSaving(false);
      setTimeout(() => setSavedMessage(false), 3000);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl font-display">
          Account Settings
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Manage your personal profile, local timezone, security credentials, and notifications.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-200 gap-8 text-sm font-medium">
        {[
          { id: 'profile', label: 'Profile & Bio', icon: User },
          { id: 'security', label: 'Security & Auth', icon: Shield },
          { id: 'notifications', label: 'Preferences', icon: Bell },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 pb-3 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded-xs ${
                activeTab === tab.id
                  ? 'border-b-2 border-amber-600 text-amber-900 font-bold'
                  : 'text-zinc-500 hover:text-zinc-800'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <AnimatePresence>
        {savedMessage && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800"
          >
            <Check className="h-4 w-4 text-emerald-600" />
            <span>Profile configuration updated in Supabase store.</span>
          </motion.div>
        )}
      </AnimatePresence>

      {activeTab === 'profile' && (
        <motion.form
          onSubmit={handleSave}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-xs space-y-6"
        >
          <div className="flex items-center gap-5 border-b border-zinc-100 pb-6">
            <div className="relative">
              <div className="h-20 w-20 rounded-full bg-zinc-100 border border-zinc-200 flex items-center justify-center font-bold text-xl text-zinc-700 font-display">
                {userInitials}
              </div>
              <button
                type="button"
                className="absolute bottom-0 right-0 p-1.5 rounded-full bg-zinc-900 text-white hover:bg-zinc-800 shadow-xs"
                title="Change Photo"
              >
                <Camera className="h-3.5 w-3.5" />
              </button>
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-900">Profile Avatar</h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                PNG, JPG or WebP up to 2MB. Stored securely in profile bucket.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Display Name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your full name"
            />
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-zinc-700">
                Local Timezone
              </label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="flex h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-amber-400 focus:outline-hidden focus:ring-2 focus:ring-amber-500/15"
              >
                <option value="Asia/Kolkata">Asia/Kolkata (IST · UTC+5:30)</option>
                <option value="America/New_York">America/New_York (EST · UTC-5:00)</option>
                <option value="Europe/London">Europe/London (GMT · UTC+0:00)</option>
                <option value="Asia/Singapore">Asia/Singapore (SGT · UTC+8:00)</option>
              </select>
              <p className="text-[11px] text-zinc-400">
                All booking slot selections are presented in your local timezone.
              </p>
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <Button type="submit" size="md" className="text-xs gap-1.5" disabled={isSaving}>
              {isSaving ? 'Saving…' : (
                <>
                  <Check className="h-3.5 w-3.5" />
                  <span>Save Settings</span>
                </>
              )}
            </Button>
          </div>
        </motion.form>
      )}

      {activeTab === 'security' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-xs space-y-5"
        >
          <h3 className="text-sm font-bold text-zinc-900 border-b border-zinc-100 pb-3">
            Authentication & Security
          </h3>
          <p className="text-xs text-zinc-600">
            Authentication is managed via Supabase Auth. Passwords and credentials are never stored in plain text.
          </p>
          <div className="space-y-3 max-w-sm">
            <Input label="Email Address" defaultValue={userEmail} disabled />
            <Input label="New Password" type="password" placeholder="••••••••" />
            <Input label="Confirm New Password" type="password" placeholder="••••••••" />
          </div>
          <div className="pt-1">
            <Badge variant="secondary" className="text-[10px]">
              Connected via Supabase Auth
            </Badge>
          </div>
          <Button size="sm" className="text-xs gap-1.5">
            <Check className="h-3.5 w-3.5" />
            <span>Update Password</span>
          </Button>
        </motion.div>
      )}

      {activeTab === 'notifications' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-xs space-y-4"
        >
          <h3 className="text-sm font-bold text-zinc-900 border-b border-zinc-100 pb-3">
            In-App Notification Preferences
          </h3>
          <div className="space-y-3 text-xs">
            {[
              { title: 'Payment Verification', desc: 'Alert when admin approves or rejects your payment proof' },
              { title: 'Meeting Link Unlock', desc: 'Alert at T-5 minutes when video call room opens' },
              { title: 'Workspace Published', desc: 'Alert when your mentor posts takeaways and notes' },
            ].map((item, i) => (
              <label
                key={i}
                className="flex items-start gap-3 p-3 rounded-lg border border-zinc-100 hover:bg-zinc-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  defaultChecked
                  className="mt-0.5 rounded border-zinc-300 focus:ring-amber-500"
                />
                <div>
                  <span className="font-semibold text-zinc-900 block">{item.title}</span>
                  <span className="text-zinc-500">{item.desc}</span>
                </div>
              </label>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
};

export default SeekerSettingsPage;
