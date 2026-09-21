import React, { useState } from 'react';
import { Calendar, Clock, ChevronRight, Video, FileText, AlertTriangle, ShieldCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { useNavigation } from '@/src/context/NavigationContext';

export const SeekerBookingsPage: React.FC = () => {
  const { navigate } = useNavigation();
  const [activeTab, setActiveTab] = useState<'upcoming' | 'history' | 'cancelled'>('upcoming');
  const [viewState, setViewState] = useState<'sample' | 'empty'>('sample');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl font-display">
            My Bookings
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            View active sessions, countdown timers, historical notes, and session workspaces.
          </p>
        </div>

        {/* State Toggle for Review */}
        <div className="flex items-center gap-1 bg-zinc-100/80 p-1 rounded-xl self-start text-xs border border-zinc-200">
          <button
            onClick={() => setViewState('sample')}
            className={`px-3 py-1.5 rounded-lg capitalize font-semibold transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 ${
              viewState === 'sample' ? 'bg-white text-zinc-950 shadow-xs' : 'text-zinc-600 hover:text-zinc-950'
            }`}
          >
            Structure Preview
          </button>
          <button
            onClick={() => setViewState('empty')}
            className={`px-3 py-1.5 rounded-lg capitalize font-semibold transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 ${
              viewState === 'empty' ? 'bg-white text-zinc-950 shadow-xs' : 'text-zinc-600 hover:text-zinc-950'
            }`}
          >
            Empty State
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-200 gap-6 text-xs sm:text-sm font-semibold" role="tablist" aria-label="Booking tabs">
        {(['upcoming', 'history', 'cancelled'] as const).map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-3 capitalize transition-all cursor-pointer relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 rounded-xs ${
              activeTab === tab
                ? 'text-zinc-950 font-bold'
                : 'text-zinc-500 hover:text-zinc-800'
            }`}
          >
            <span>{tab} Sessions</span>
            {activeTab === tab && (
              <motion.div
                layoutId="booking-tab-indicator"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-zinc-950 rounded-full"
                transition={{ duration: 0.2 }}
              />
            )}
          </button>
        ))}
      </div>

      {viewState === 'empty' ? (
        <EmptyState
          icon={Calendar}
          title={`No ${activeTab} Bookings`}
          description="Bookings will reflect your authoritative database records. T-5 minute session unlock countdown will activate upon confirmation."
          actionLabel="Find Mentors"
          onAction={() => navigate('/seeker')}
        />
      ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="space-y-4"
          >
            {activeTab === 'upcoming' && (
              <>
                {/* Confirmed Session Card with T-5 countdown UX */}
                <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xs space-y-4 hover:border-zinc-300 transition-all">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-100 pb-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="success" className="text-[10px] font-bold">CONFIRMED</Badge>
                      <span className="text-xs text-zinc-400 font-mono">Booking #BK-9021</span>
                    </div>
                    <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-100 px-2.5 py-1 rounded-full">
                      Meeting unlocks at T-5 minutes (3:55 PM)
                    </span>
                  </div>

                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <h2 className="text-base font-bold text-zinc-950">1:1 Relationship Guidance Session</h2>
                      <p className="text-xs text-zinc-500 mt-0.5">Mentor: Rahul Sharma · Segment: Relationship Advisor</p>
                      <div className="flex items-center gap-3 text-xs text-zinc-600 mt-2 font-medium flex-wrap">
                        <span className="flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5 text-zinc-400" /> Today (18 Mar 2026)
                        </span>
                        <span>·</span>
                        <span className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-zinc-400" /> 4:00 PM – 5:00 PM (IST)
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5">
                      <Button
                        onClick={() => navigate('/seeker/booking-detail')}
                        variant="outline"
                        size="sm"
                        className="text-xs font-medium"
                      >
                        Booking Details
                      </Button>
                      <Button
                        onClick={() => navigate('/seeker/session?bookingId=bk-session-soon')}
                        size="sm"
                        className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-2xs"
                      >
                        <Video className="h-3.5 w-3.5" />
                        <span>Join Session Room</span>
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Mentor Pending Confirmation Card */}
                <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xs space-y-4 hover:border-zinc-300 transition-all">
                  <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="warning" className="text-[10px] font-bold">MENTOR_PENDING</Badge>
                      <span className="text-xs text-zinc-400 font-mono">Booking #BK-9024</span>
                    </div>
                    <span className="text-xs text-zinc-500 font-medium">Payment Verified by Admin</span>
                  </div>

                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <h2 className="text-base font-bold text-zinc-950">Deep Communication Reset</h2>
                      <p className="text-xs text-zinc-500 mt-0.5">Mentor: Ananya Patel · Segment: Relationship Advisor</p>
                      <p className="text-xs text-zinc-600 mt-1.5 font-medium">Tomorrow · 6:30 PM – 7:15 PM (IST)</p>
                    </div>
                    <Button
                      onClick={() => navigate('/seeker/booking-detail')}
                      variant="outline"
                      size="sm"
                      className="text-xs font-medium"
                    >
                      View Status
                    </Button>
                  </div>
                </div>
              </>
            )}

            {activeTab === 'history' && (
              <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xs space-y-4 hover:border-zinc-300 transition-all">
                <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px] font-bold">COMPLETED</Badge>
                    <span className="text-xs text-zinc-400 font-mono">15 March 2026</span>
                  </div>
                  <span className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
                    <FileText className="h-3.5 w-3.5" /> Workspace Notes Available
                  </span>
                </div>

                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-bold text-zinc-950">1:1 Relationship Guidance Session</h2>
                    <p className="text-xs text-zinc-500 mt-0.5">Mentor: Rahul Sharma · Relationship Advisor</p>
                  </div>
                  <Button
                    onClick={() => navigate('/seeker/workspace')}
                    size="sm"
                    className="gap-1.5 text-xs font-semibold"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    <span>Open Session Workspace</span>
                  </Button>
                </div>
              </div>
            )}

            {activeTab === 'cancelled' && (
              <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xs space-y-2">
                <div className="flex items-center justify-between">
                  <Badge variant="destructive" className="text-[10px] font-bold">CANCELLED</Badge>
                  <span className="text-xs text-zinc-400 font-medium">Cancelled ≥24h Prior</span>
                </div>
                <h2 className="text-sm font-bold text-zinc-950">Career Strategy Consult</h2>
                <p className="text-xs text-zinc-500">Normal cancellation policy: Permitted ≥24 hours before start.</p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
};

