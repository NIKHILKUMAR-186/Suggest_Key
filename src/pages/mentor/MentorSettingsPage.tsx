import React, { useState } from 'react';
import { User, Globe, Bell, Shield, Camera, Check, Briefcase, Layers, ArrowRight } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { Textarea } from '@/src/components/ui/Textarea';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';

export const MentorSettingsPage: React.FC = () => {
  const { navigate } = useNavigation();
  const { profile, user } = useAuth();
  const [activeTab, setActiveTab] = useState<'profile' | 'security' | 'notifications'>('profile');
  const [savedMessage, setSavedMessage] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedMessage(true);
    setTimeout(() => setSavedMessage(false), 3000);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">
          Mentor Settings
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Manage your mentor profile, timezone for availability calculations, and credentials.
        </p>
      </div>

      {/* Quick Links for Gigs & Segments */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div
          onClick={() => navigate('/mentor/gigs')}
          className="rounded-xl border border-zinc-200 bg-white p-4 shadow-xs flex items-center justify-between hover:border-zinc-400 cursor-pointer transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-zinc-100 text-zinc-800">
              <Briefcase className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-950">Gig Management</h3>
              <p className="text-xs text-zinc-500">Create & edit session packages and pricing</p>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-zinc-400" />
        </div>

        <div
          onClick={() => navigate('/mentor/segments')}
          className="rounded-xl border border-zinc-200 bg-white p-4 shadow-xs flex items-center justify-between hover:border-zinc-400 cursor-pointer transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-zinc-100 text-zinc-800">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-950">Segment Applications</h3>
              <p className="text-xs text-zinc-500">Apply for new mentorship specializations</p>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-zinc-400" />
        </div>
      </div>

      <div className="flex border-b border-zinc-200">
        <button
          onClick={() => setActiveTab('profile')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'profile'
              ? 'border-zinc-900 text-zinc-950'
              : 'border-transparent text-zinc-500 hover:text-zinc-700'
          }`}
        >
          Profile
        </button>
        <button
          onClick={() => setActiveTab('security')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'security'
              ? 'border-zinc-900 text-zinc-950'
              : 'border-transparent text-zinc-500 hover:text-zinc-700'
          }`}
        >
          Security
        </button>
        <button
          onClick={() => setActiveTab('notifications')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'notifications'
              ? 'border-zinc-900 text-zinc-950'
              : 'border-transparent text-zinc-500 hover:text-zinc-700'
          }`}
        >
          Notifications
        </button>
      </div>

      {activeTab === 'profile' && (
        <form onSubmit={handleSave} className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-zinc-950">Profile Information</h3>
            {savedMessage && (
              <span className="text-xs text-emerald-700 flex items-center gap-1">
                <Check className="h-3.5 w-3.5" />
                Saved
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-500">
            This information appears on your public mentor profile and discovery cards.
          </p>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-zinc-700">Email</label>
            <Input
              label="Email"
              value={profile?.email || user?.email || ''}
              disabled
              className="bg-zinc-50"
            />
            <p className="text-[11px] text-zinc-400">Email cannot be changed from settings.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Full Name"
              defaultValue={profile?.full_name || ''}
              placeholder="Your full name"
            />
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-zinc-700">
                Mentor Timezone
              </label>
              <select
                defaultValue={profile?.timezone || 'Asia/Kolkata'}
                className="flex h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-hidden"
              >
                <option value="Asia/Kolkata">Asia/Kolkata (IST · UTC+5:30)</option>
                <option value="America/New_York">America/New_York (EST · UTC-5:00)</option>
                <option value="Europe/London">Europe/London (GMT · UTC+0:00)</option>
                <option value="Asia/Dubai">Asia/Dubai (GST · UTC+4:00)</option>
              </select>
              <p className="text-[11px] text-zinc-400">
                Authoritative base timezone for your recurring availability and slot generator.
              </p>
            </div>
          </div>

          <Textarea
            label="Professional Bio & Credentials"
            placeholder="Describe your expertise, credentials, and mentoring approach..."
            rows={4}
          />

          <div className="pt-2 flex justify-end">
            <Button type="submit" size="md" className="text-xs">
              Save Mentor Profile
            </Button>
          </div>
        </form>
      )}

      {activeTab === 'security' && (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-zinc-900 border-b border-zinc-100 pb-3">
            Account Security
          </h3>
          <div className="space-y-3 max-w-sm">
            <Button variant="outline" size="sm" className="w-full justify-start gap-2">
              <Shield className="h-4 w-4" />
              <span>Change Password</span>
            </Button>
            <Button variant="outline" size="sm" className="w-full justify-start gap-2">
              <Camera className="h-4 w-4" />
              <span>Update Avatar</span>
            </Button>
            <Button variant="outline" size="sm" className="w-full justify-start gap-2 text-rose-700 border-rose-200 hover:bg-rose-50">
              <User className="h-4 w-4" />
              <span>Deactivate Account</span>
            </Button>
          </div>
        </div>
      )}

      {activeTab === 'notifications' && (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-zinc-900 border-b border-zinc-100 pb-3">
            Notification Preferences
          </h3>
          <div className="space-y-3 max-w-md">
            <label className="flex items-center justify-between cursor-pointer">
              <div className="flex items-center gap-3">
                <Bell className="h-5 w-5 text-zinc-500" />
                <div>
                  <p className="text-sm font-medium text-zinc-900">Email Notifications</p>
                  <p className="text-xs text-zinc-500">Receive booking and session updates via email</p>
                </div>
              </div>
              <input type="checkbox" defaultChecked className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900" />
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <div className="flex items-center gap-3">
                <Bell className="h-5 w-5 text-zinc-500" />
                <div>
                  <p className="text-sm font-medium text-zinc-900">In-App Notifications</p>
                  <p className="text-xs text-zinc-500">Receive real-time alerts in the notification center</p>
                </div>
              </div>
              <input type="checkbox" defaultChecked className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900" />
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <div className="flex items-center gap-3">
                <Bell className="h-5 w-5 text-zinc-500" />
                <div>
                  <p className="text-sm font-medium text-zinc-900">Marketing Emails</p>
                  <p className="text-xs text-zinc-500">Occasional platform updates and tips</p>
                </div>
              </div>
              <input type="checkbox" className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900" />
            </label>
          </div>
        </div>
      )}
    </div>
  );
};