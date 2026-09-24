import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Calendar,
  FileText,
  Target,
  Lightbulb,
  ArrowRight,
  User,
  Sparkles,
  AlertCircle,
  Loader2,
  RefreshCw,
  Printer,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import {
  fetchWorkspaceByBooking,
  deriveSessionOverview,
} from '@/src/lib/workspaceService';
import { fetchSeekerBookings, EnrichedBookingRecord } from '@/src/lib/bookingService';
import { SessionWorkspace, NextStepItem } from '@/src/types/database';

export const SeekerWorkspacePage: React.FC = () => {
  const { currentPath, navigate } = useNavigation();
  const { user } = useAuth();
  const seekerId = user?.id;

  // Read bookingId from URL query param
  const queryBookingId = new URLSearchParams(window.location.search || '').get('bookingId') || '';

  const [completedBookings, setCompletedBookings] = useState<EnrichedBookingRecord[]>([]);
  const [selectedBookingId, setSelectedBookingId] = useState<string>(queryBookingId);
  const [selectedBooking, setSelectedBooking] = useState<EnrichedBookingRecord | null>(null);

  const [workspace, setWorkspace] = useState<SessionWorkspace | null>(null);
  const [isPending, setIsPending] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Client-side checklist tracking for seeker personal progress
  const [completedSteps, setCompletedSteps] = useState<Record<string, boolean>>({});

  // 1. Load seeker's completed bookings
  useEffect(() => {
    let mounted = true;
    const loadBookings = async () => {
      if (!seekerId) return;
      try {
        const bookings = await fetchSeekerBookings(seekerId);
        if (!mounted) return;

        // Filter bookings that have completed or have past sessions
        const completed = bookings.filter(
          (b: EnrichedBookingRecord) => b.status === 'COMPLETED'
        );

        setCompletedBookings(completed);

        // Determine initial selected booking
        let target = completed.find((b: EnrichedBookingRecord) => b.id === queryBookingId || b.booking_code === queryBookingId);
        if (!target && completed.length > 0) {
          target = completed[0];
        }

        if (target) {
          setSelectedBookingId(target.id);
          setSelectedBooking(target);
        }
      } catch (err: any) {
        console.error('Failed to load seeker bookings:', err);
      }
    };

    loadBookings();
    return () => {
      mounted = false;
    };
  }, [seekerId, queryBookingId]);

  // 2. Fetch workspace for chosen booking
  const loadWorkspace = async (bookingId: string) => {
    if (!bookingId || !seekerId) return;

    setLoading(true);
    setError(null);
    setIsPending(false);

    try {
      const res = await fetchWorkspaceByBooking(bookingId, seekerId, 'seeker');

      if (res.error) {
        setError(res.error.message || 'Failed to load workspace.');
        setWorkspace(null);
      } else if (res.isPending || !res.workspace || res.workspace.status === 'PENDING') {
        setIsPending(true);
        setWorkspace(null);
      } else {
        setWorkspace(res.workspace);
        setIsPending(false);

        // Initialize checklist state
        if (res.workspace.next_steps) {
          const initialChecks: Record<string, boolean> = {};
          res.workspace.next_steps.forEach((item) => {
            initialChecks[item.id] = !!item.completed;
          });
          setCompletedSteps(initialChecks);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Network error fetching workspace.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedBookingId) {
      const b = completedBookings.find((item) => item.id === selectedBookingId);
      if (b) setSelectedBooking(b);
      loadWorkspace(selectedBookingId);
    }
  }, [selectedBookingId, completedBookings]);

  const toggleStepCompleted = (stepId: string) => {
    setCompletedSteps((prev) => ({
      ...prev,
      [stepId]: !prev[stepId],
    }));
  };

  const handlePrint = () => {
    window.print();
  };

  const overview = selectedBooking ? deriveSessionOverview(selectedBooking) : workspace?.session_overview;

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-16 print:p-0 print:space-y-4">
      {/* Top Header / Back Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 print:hidden">
        <button
          onClick={() => navigate('/seeker/bookings')}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to My Bookings</span>
        </button>

        <div className="flex items-center gap-3">
          {/* Booking Selector Dropdown if multiple completed sessions exist */}
          {completedBookings.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Session:</span>
              <select
                id="select-seeker-completed-session"
                value={selectedBookingId}
                onChange={(e) => setSelectedBookingId(e.target.value)}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-900 focus:border-zinc-900 focus:outline-hidden"
              >
                {completedBookings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.booking_code} · {b.gig?.title || 'Session'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {workspace && !isPending && (
            <Button
              onClick={handlePrint}
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs cursor-pointer"
            >
              <Printer className="h-3.5 w-3.5 text-zinc-600" />
              <span>Print / Save PDF</span>
            </Button>
          )}
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-900 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => loadWorkspace(selectedBookingId)}
            className="text-xs"
          >
            Retry
          </Button>
        </div>
      )}

      {/* Loading State */}
      {loading ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-12 text-center space-y-3 shadow-xs">
          <Loader2 className="h-8 w-8 text-zinc-400 mx-auto animate-spin" />
          <h3 className="text-sm font-semibold text-zinc-900">Retrieving Session Workspace...</h3>
          <p className="text-xs text-zinc-500">
            Checking authoritative database records for verified takeaways and guidance.
          </p>
        </div>
      ) : !overview ? (
        /* Empty State: No completed bookings */
        <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/70 p-12 text-center space-y-3">
          <Calendar className="h-8 w-8 text-zinc-400 mx-auto" />
          <h3 className="text-base font-semibold text-zinc-900">No Completed Sessions Found</h3>
          <p className="text-xs text-zinc-500 max-w-sm mx-auto">
            Once a consultation session concludes, your mentor will publish key takeaways, customized action steps, and resources here.
          </p>
          <div className="pt-2">
            <Button
              onClick={() => navigate('/seeker/mentors')}
              size="sm"
              className="text-xs bg-zinc-900 text-white"
            >
              Explore Mentors & Book Session
            </Button>
          </div>
        </div>
      ) : isPending ? (
        /* Empty / Pending State: Session complete but Mentor Notes not yet published */
        <div className="space-y-6">
          {/* Section 1: Session Overview */}
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold text-zinc-950">Session Workspace</h1>
                  <Badge variant="secondary">Concluded</Badge>
                </div>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Booking #{overview.bookingCode} · Conducted on{' '}
                  {new Date(overview.startTime).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </p>
              </div>

              <div className="text-right text-xs">
                <span className="text-zinc-400 block text-[11px]">Mentor</span>
                <span className="font-semibold text-zinc-900">{overview.mentorName}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs bg-zinc-50 p-4 rounded-lg">
              <div>
                <span className="text-zinc-400 block text-[11px]">Segment</span>
                <span className="font-medium text-zinc-900">{overview.segmentTitle}</span>
              </div>
              <div>
                <span className="text-zinc-400 block text-[11px]">Gig</span>
                <span className="font-medium text-zinc-900">{overview.gigTitle}</span>
              </div>
              <div>
                <span className="text-zinc-400 block text-[11px]">Duration</span>
                <span className="font-medium text-zinc-900">{overview.durationMinutes} Minutes</span>
              </div>
              <div>
                <span className="text-zinc-400 block text-[11px]">Status</span>
                <span className="font-semibold text-zinc-700">Awaiting Mentor Notes</span>
              </div>
            </div>
          </div>

          {/* Pending Banner */}
          <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/70 p-12 text-center space-y-3">
            <Clock className="h-8 w-8 text-zinc-400 mx-auto animate-pulse" />
            <h3 className="text-base font-semibold text-zinc-900">Mentor Notes Pending</h3>
            <p className="text-xs text-zinc-500 max-w-md mx-auto leading-relaxed">
              Your mentor <strong>{overview.mentorName}</strong> is currently preparing your session summary, key takeaways, and action items. You will receive an in-app notification the moment they publish.
            </p>
            <div className="pt-2">
              <Button
                onClick={() => loadWorkspace(selectedBookingId)}
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Check for Updates</span>
              </Button>
            </div>
          </div>
        </div>
      ) : workspace ? (
        /* Success State: All 6 Workspace Sections Rendered */
        <div className="space-y-6">
          {/* Section 1: Session Overview */}
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold text-zinc-950">Session Workspace</h1>
                  <Badge variant="secondary">Completed Session</Badge>
                </div>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Booking #{overview.bookingCode} · Conducted on{' '}
                  {new Date(overview.startTime).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </p>
              </div>

              <div className="text-right text-xs">
                <span className="text-zinc-400 block text-[11px]">Mentor</span>
                <span className="font-semibold text-zinc-900">{overview.mentorName}</span>
                {overview.mentorHeadline && (
                  <span className="text-zinc-500 text-[11px] block">{overview.mentorHeadline}</span>
                )}
              </div>
            </div>

            {/* Session Overview Grid (No unrelated private user info) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs bg-zinc-50 p-4 rounded-lg">
              <div>
                <span className="text-zinc-400 block text-[11px]">Segment</span>
                <span className="font-medium text-zinc-900">{overview.segmentTitle}</span>
              </div>
              <div>
                <span className="text-zinc-400 block text-[11px]">Topic</span>
                <span className="font-medium text-zinc-900">{overview.gigTitle}</span>
              </div>
              <div>
                <span className="text-zinc-400 block text-[11px]">Duration</span>
                <span className="font-medium text-zinc-900">{overview.durationMinutes} Minutes</span>
              </div>
              <div>
                <span className="text-zinc-400 block text-[11px]">Status</span>
                <span className="font-semibold text-emerald-700">Concluded</span>
              </div>
            </div>
          </div>

          {/* Section 2: Mentor Notes */}
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-2">
            <h2 className="text-sm font-bold text-zinc-950 flex items-center gap-2">
              <FileText className="h-4 w-4 text-zinc-500" />
              Mentor Notes & Session Summary
            </h2>
            <p className="text-xs text-zinc-700 leading-relaxed pt-1 whitespace-pre-line">
              {workspace.mentor_notes || workspace.summary}
            </p>
          </div>

          {/* Section 3: Key Takeaways */}
          {workspace.takeaways && workspace.takeaways.length > 0 && (
            <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-3">
              <h2 className="text-sm font-bold text-zinc-950 flex items-center gap-2">
                <Target className="h-4 w-4 text-emerald-600" />
                Key Takeaways
              </h2>
              <ul className="space-y-2.5 text-xs text-zinc-700">
                {workspace.takeaways.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span className="leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Section 4: Suggestions */}
          {workspace.suggestions && workspace.suggestions.length > 0 && (
            <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-3">
              <h2 className="text-sm font-bold text-zinc-950 flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-amber-500" />
                Practical Suggestions & Recommendations
              </h2>
              <ul className="space-y-2 text-xs text-zinc-700">
                {workspace.suggestions.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0 mt-1.5" />
                    <span className="leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Section 5: Next Steps (Actionable with Checkboxes) */}
          {workspace.next_steps && workspace.next_steps.length > 0 && (
            <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-zinc-950 flex items-center gap-2">
                  <ArrowRight className="h-4 w-4 text-zinc-700" />
                  Actionable Next Steps
                </h2>
                <span className="text-[11px] text-zinc-400">
                  {Object.values(completedSteps).filter(Boolean).length} of {workspace.next_steps.length} completed
                </span>
              </div>

              <div className="space-y-2 text-xs">
                {workspace.next_steps.map((step) => {
                  const isChecked = !!completedSteps[step.id];
                  return (
                    <div
                      key={step.id}
                      onClick={() => toggleStepCompleted(step.id)}
                      className={`p-3 rounded-lg border transition-colors cursor-pointer flex items-center justify-between gap-3 ${
                        isChecked
                          ? 'bg-zinc-50 border-zinc-200 text-zinc-400'
                          : 'bg-white border-zinc-200 hover:border-zinc-300 text-zinc-800'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}} // handled by parent div
                          className="rounded text-zinc-900 focus:ring-zinc-900 h-4 w-4"
                        />
                        <span className={isChecked ? 'line-through text-zinc-400' : 'font-medium'}>
                          {step.text}
                        </span>
                      </div>
                      {step.due_date && (
                        <Badge variant={isChecked ? 'secondary' : 'default'} className="shrink-0 text-[10px]">
                          {step.due_date}
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Section 6: Optional Follow-up Recommendation */}
          {workspace.follow_up_recommendation && workspace.follow_up_recommendation.recommended && (
            <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-6 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-blue-600" />
                  <h2 className="text-sm font-bold text-blue-950">
                    Mentor Follow-up Recommendation
                  </h2>
                </div>
                <Badge variant="secondary" className="bg-blue-100 text-blue-800 border-blue-200 text-[11px]">
                  {workspace.follow_up_recommendation.timeframe}
                </Badge>
              </div>

              {workspace.follow_up_recommendation.topic && (
                <p className="text-xs text-blue-900 font-semibold">
                  Focus: {workspace.follow_up_recommendation.topic}
                </p>
              )}

              {workspace.follow_up_recommendation.notes && (
                <p className="text-xs text-blue-800 leading-relaxed italic">
                  "{workspace.follow_up_recommendation.notes}"
                </p>
              )}

              <div className="pt-2 print:hidden">
                <Button
                  id="btn-book-follow-up"
                  onClick={() => navigate('/seeker/mentors')}
                  size="sm"
                  className="gap-1.5 text-xs bg-blue-900 text-white hover:bg-blue-800 cursor-pointer shadow-xs"
                >
                  <span>Book Follow-up Consultation</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
};
