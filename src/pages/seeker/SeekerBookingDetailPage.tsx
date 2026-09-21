import React from 'react';
import { ArrowLeft, Calendar, Clock, Video, FileText, AlertCircle, ShieldCheck, XCircle } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { useNavigation } from '@/src/context/NavigationContext';

export const SeekerBookingDetailPage: React.FC = () => {
  const { navigate } = useNavigation();

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <button
        onClick={() => navigate('/seeker/bookings')}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        <span>Back to My Bookings</span>
      </button>

      {/* Header & Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-200 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-zinc-950">Booking #BK-9021</h1>
            <Badge variant="success">CONFIRMED</Badge>
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">
            Confirmed by mentor Rahul Sharma · Meeting URL attached
          </p>
        </div>

        <Button
          onClick={() => navigate('/seeker/session')}
          size="sm"
          className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          <Video className="h-3.5 w-3.5" />
          <span>Join Session Room</span>
        </Button>
      </div>

      {/* State Machine Step Indicator */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs space-y-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Booking Lifecycle Progression
        </span>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
          <div className="p-2.5 rounded-lg bg-zinc-100 text-zinc-600 font-medium">
            1. Payment Verified
          </div>
          <div className="p-2.5 rounded-lg bg-zinc-100 text-zinc-600 font-medium">
            2. Mentor Confirmed
          </div>
          <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-800 font-bold border border-emerald-200">
            3. Scheduled (T-5 Join)
          </div>
          <div className="p-2.5 rounded-lg bg-zinc-50 text-zinc-400">
            4. Workspace & Notes
          </div>
        </div>
      </div>

      {/* Booking Particulars */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-zinc-950 border-b border-zinc-100 pb-2">
            Session Details
          </h3>
          <div className="space-y-2.5 text-xs">
            <div className="flex justify-between">
              <span className="text-zinc-500">Mentor:</span>
              <span className="font-semibold text-zinc-900">Rahul Sharma</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Segment:</span>
              <span className="text-zinc-800">Relationship Advisor</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Gig:</span>
              <span className="text-zinc-800">1:1 Relationship Guidance</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Duration:</span>
              <span className="font-medium text-zinc-900">60 Minutes</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Scheduled Time:</span>
              <span className="font-semibold text-zinc-900">Today, 4:00 PM – 5:00 PM (IST)</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-zinc-950 border-b border-zinc-100 pb-2">
            Policies & Actions
          </h3>
          <div className="space-y-3 text-xs text-zinc-600">
            <div className="flex items-start gap-2 text-amber-800 bg-amber-50 p-3 rounded-lg border border-amber-200">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                <strong>24-Hour Policy:</strong> Standard seeker cancellation or rescheduling is allowed only ≥ 24 hours prior to session start.
              </span>
            </div>

            <p className="text-[11px] text-zinc-400">
              For emergency rescheduling within 24 hours, contact platform administration.
            </p>

            <div className="pt-2 flex flex-col gap-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs text-zinc-400 border-zinc-200 cursor-not-allowed"
                disabled
              >
                Cancel Session (Locked &lt; 24h)
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
