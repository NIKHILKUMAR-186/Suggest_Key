import React, { useState } from 'react';
import { Calendar, Clock, Video, CheckCircle2, AlertCircle, ArrowRight, User, ExternalLink } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { useNavigation } from '@/src/context/NavigationContext';

export const MentorHomePage: React.FC = () => {
  const { navigate } = useNavigation();
  const [viewState, setViewState] = useState<'action-required' | 'empty'>('action-required');

  return (
    <div className="space-y-8">
      {/* Header & View State Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">
            Mentor Workspace
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Operational agenda, pending confirmations, and upcoming 1:1 sessions.
          </p>
        </div>

        <div className="flex items-center gap-1 bg-zinc-100 p-1 rounded-lg self-start text-xs">
          <button
            onClick={() => setViewState('action-required')}
            className={`px-2.5 py-1 rounded-md capitalize font-medium ${
              viewState === 'action-required' ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-600'
            }`}
          >
            Action Queue Preview
          </button>
          <button
            onClick={() => setViewState('empty')}
            className={`px-2.5 py-1 rounded-md capitalize font-medium ${
              viewState === 'empty' ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-600'
            }`}
          >
            Clear Schedule
          </button>
        </div>
      </div>

      {viewState === 'empty' ? (
        <EmptyState
          icon={Calendar}
          title="All Caught Up"
          description="You have no pending confirmations or scheduled sessions for today. New bookings verified by Admin will arrive here."
          actionLabel="Check Global Availability"
          onAction={() => navigate('/mentor/availability')}
        />
      ) : (
        <div className="space-y-6">
          {/* Action Required: Pending Confirmations Queue (Section 28-31) */}
          <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-200/60 pb-3">
              <div className="flex items-center gap-2">
                <Badge variant="warning" className="bg-amber-100 text-amber-900 border-amber-300">
                  ACTION REQUIRED: PENDING CONFIRMATION
                </Badge>
                <span className="text-xs text-amber-800 font-medium">Payment Verified by Admin</span>
              </div>
              <span className="text-xs text-amber-900 font-semibold">
                Meeting link required before confirming
              </span>
            </div>

            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-amber-200/70 flex items-center justify-center font-bold text-amber-950 text-sm">
                    AK
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-zinc-950">Aman Kumar</h3>
                    <p className="text-xs text-zinc-600">
                      Segment: Relationship Advisor · Gig: 1:1 Relationship Guidance
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-700 font-medium pt-1">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5 text-zinc-500" /> Today (18 March 2026)
                  </span>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5 text-zinc-500" /> 4:00 PM – 5:00 PM (IST)
                  </span>
                  <span>·</span>
                  <span className="font-bold text-emerald-800">Fee: ₹999 Verified</span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-3 shrink-0">
                <Button
                  onClick={() => navigate('/mentor/booking-detail')}
                  className="w-full sm:w-auto gap-1.5 text-xs bg-zinc-900 hover:bg-zinc-800 text-white"
                  size="md"
                >
                  <Video className="h-3.5 w-3.5" />
                  <span>Add Link & Confirm Session</span>
                </Button>
              </div>
            </div>

            <div className="text-[11px] text-amber-800/80 flex items-center gap-1.5 pt-1">
              <AlertCircle className="h-3.5 w-3.5" />
              <span>Recommended deadline: Add meeting URL at least 2 hours before start. System records missed deadlines for platform audit.</span>
            </div>
          </div>

          {/* Today's Schedule Overview */}
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-4">
            <h2 className="text-base font-bold text-zinc-950 border-b border-zinc-100 pb-3 flex items-center justify-between">
              <span>Today's Confirmed Sessions</span>
              <span className="text-xs font-normal text-zinc-500">Local Time: Asia/Kolkata</span>
            </h2>

            <div className="p-4 rounded-lg border border-zinc-100 bg-zinc-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="success">CONFIRMED</Badge>
                  <span className="font-bold text-sm text-zinc-900">Rohan Mehta · Relationship Advisor</span>
                </div>
                <p className="text-xs text-zinc-500">6:30 PM – 7:30 PM · Google Meet Attached</p>
              </div>
              <Button
                onClick={() => navigate('/mentor/booking-detail')}
                variant="outline"
                size="sm"
                className="text-xs"
              >
                Session Details
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
