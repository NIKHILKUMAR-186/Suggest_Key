import React, { useState } from 'react';
import { Sliders, ShieldCheck, CreditCard, Clock, QrCode, Check } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { Textarea } from '@/src/components/ui/Textarea';

export const AdminSettingsPage: React.FC = () => {
  const [saved, setSaved] = useState(false);
  const [upiId, setUpiId] = useState('suggestkey@upi');
  const [instructions, setInstructions] = useState(
    'Please transfer the exact fee using Google Pay, PhonePe, or Paytm, and upload a clear screenshot showing the Transaction/UTR Reference ID.'
  );

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="border-b border-zinc-200 pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">
          Platform Configuration & Rules
        </h1>
        <p className="mt-1 text-xs text-zinc-500">
          Enforce system-wide business rules, payment configurations, and security policies.
        </p>
      </div>

      {saved && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800">
          <Check className="h-4 w-4 text-emerald-600" />
          <span>Platform configuration updated and saved.</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Core MVP Invariant Constants */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-5">
          <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-zinc-950">Core Business Rule Invariants</h2>
              <p className="text-xs text-zinc-500 mt-0.5">Authoritative platform timings and locks.</p>
            </div>
            <span className="text-[11px] font-mono text-zinc-400 bg-zinc-100 px-2 py-0.5 rounded">
              Immutable MVP Defaults
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="p-3 bg-zinc-50 rounded-lg border border-zinc-100 space-y-1">
              <span className="font-semibold text-zinc-900 block">Slot Hold Duration</span>
              <span className="text-zinc-600">15 Minutes</span>
              <p className="text-[11px] text-zinc-400">Atomic hold expires automatically if proof not submitted.</p>
            </div>

            <div className="p-3 bg-zinc-50 rounded-lg border border-zinc-100 space-y-1">
              <span className="font-semibold text-zinc-900 block">Meeting Link Concealment</span>
              <span className="text-zinc-600">T-5 Minutes Before Session</span>
              <p className="text-[11px] text-zinc-400">Hidden from seeker and join button blocked until 5m prior.</p>
            </div>

            <div className="p-3 bg-zinc-50 rounded-lg border border-zinc-100 space-y-1">
              <span className="font-semibold text-zinc-900 block">Recommended Link Deadline</span>
              <span className="text-zinc-600">2 Hours Before Session</span>
              <p className="text-[11px] text-zinc-400">System records missed deadlines without cancelling session.</p>
            </div>

            <div className="p-3 bg-zinc-50 rounded-lg border border-zinc-100 space-y-1">
              <span className="font-semibold text-zinc-900 block">Seeker Cancellation Policy</span>
              <span className="text-zinc-600">≥ 24 Hours Prior</span>
              <p className="text-[11px] text-zinc-400">Within 24 hours of session start, cancellations are locked.</p>
            </div>
          </div>
        </div>

        {/* Manual QR Payment Settings */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-4">
          <div className="border-b border-zinc-100 pb-3">
            <h2 className="text-sm font-bold text-zinc-950 flex items-center gap-2">
              <QrCode className="h-4 w-4 text-zinc-700" />
              Manual QR Payment Gateway (MVP)
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Configure the receiver UPI ID and payment guidance presented to seekers.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Platform UPI VPA"
              value={upiId}
              onChange={(e) => setUpiId(e.target.value)}
              placeholder="e.g. suggestkey@upi"
              required
            />
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-zinc-700">Platform Currency</label>
              <input
                disabled
                value="INR (₹) - Indian Rupee"
                className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500"
              />
            </div>
          </div>

          <Textarea
            label="Payment Instructions for Seekers"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={3}
          />
        </div>

        <div className="flex justify-end">
          <Button type="submit" size="md" className="text-xs">
            Save Platform Settings
          </Button>
        </div>
      </form>
    </div>
  );
};
