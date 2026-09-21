import React, { useState } from 'react';
import { User, Globe, Bell, Shield, Camera, Check, Briefcase, Layers, ArrowRight } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { Textarea } from '@/src/components/ui/Textarea';
import { useNavigation } from '@/src/context/NavigationContext';

export const MentorSettingsPage: React.FC = () => {
  const { navigate } = useNavigation();
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
              <h3 className="text-sm font-bold text-zinc-950">Segment Management</h3>
              <p className="text-xs text-zinc-500">View approved categories & apply for new specializations</p>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-zinc-400" />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-200 gap-8 text-sm font-medium">
        {[
          { id: 'profile', label: 'Mentor Profile', icon: User },
          { id: 'security', label: 'Security & Auth', icon: Shield },
          { id: 'notifications', label: 'Notification Preferences', icon: Bell },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 pb-3 transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? 'border-b-2 border-zinc-900 text-zinc-950 font-bold'
                  : 'text-zinc-500 hover:text-zinc-800'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {savedMessage && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800">
          <Check className="h-4 w-4 text-emerald-600" />
          <span>Mentor profile updated successfully.</span>
        </div>
      )}

      {activeTab === 'profile' && (
        <form onSubmit={handleSave} className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-6">
          <div className="flex items-center gap-5 border-b border-zinc-100 pb-6">
            <div className="relative">
              <div className="h-20 w-20 rounded-full bg-zinc-100 border border-zinc-200 flex items-center justify-center font-bold text-xl text-zinc-700">
                RS
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
              <h3 className="text-sm font-bold text-zinc-900">Mentor Public Avatar</h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Displays on mentor discovery cards and booking confirmation screens.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Full Name"
              defaultValue="Rahul Sharma"
              placeholder="Your full name"
            />
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-zinc-700">
                Mentor Timezone
              </label>
              <select
                defaultValue="Asia/Kolkata"
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
            defaultValue="Experienced relationship counselor with 6+ years specializing in pre-marital alignment, communication barriers, and emotional intelligence."
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
            <Input label="Email Address" defaultValue="mentor.rahul@suggestkey.com" disabled />
            <Input label="New Password" type="password" placeholder="••••••••" />
          </div>
          <Button size="sm" className="text-xs">Update Password</Button>
        </div>
      )}

      {activeTab === 'notifications' && (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-zinc-900 border-b border-zinc-100 pb-3">
            Mentor Notification Settings
          </h3>
          <div className="space-y-3 text-xs">
            {[
              { title: 'New Paid Bookings', desc: 'Instant alert when admin verifies payment and requests your meeting URL' },
              { title: '2-Hour Deadline Warnings', desc: 'Alert if meeting URL has not been provided 2 hours before session' },
              { title: 'Seeker Cancellation', desc: 'Notification if a seeker cancels a session ≥24 hours prior' },
            ].map((item, i) => (
              <label key={i} className="flex items-start gap-3 p-3 rounded-lg border border-zinc-100 hover:bg-zinc-50 cursor-pointer">
                <input type="checkbox" defaultChecked className="mt-0.5 rounded border-zinc-300" />
                <div>
                  <span className="font-semibold text-zinc-900 block">{item.title}</span>
                  <span className="text-zinc-500">{item.desc}</span>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
