import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Calendar,
  FileText,
  Target,
  Lightbulb,
  ArrowRight,
  Sparkles,
  AlertCircle,
  Loader2,
  RefreshCw,
  Printer,
} from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import {
  fetchWorkspaceByBooking,
  deriveSessionOverview,
} from '@/src/lib/workspaceService';
import { fetchBookingDetail, EnrichedBookingRecord } from '@/src/lib/bookingService';
import {
  bookingMatchesRequestedId,
  evaluateBookingOfferIdentity,
  resolveRequestedBookingId,
} from '@/src/lib/workspaceIdentity';
import { SessionWorkspace, NextStepItem } from '@/src/types/database';

export const SeekerWorkspacePage: React.FC = () => {
  const { navigate, currentPath } = useNavigation();
  const { user } = useAuth();
  const seekerId = user?.id;

  const queryBookingId = resolveRequestedBookingId(currentPath, window.location.search);

  const [booking, setBooking] = useState<EnrichedBookingRecord | null>(null);
  const [workspace, setWorkspace] = useState<SessionWorkspace | null>(null);
  const [isPending, setIsPending] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [completedSteps, setCompletedSteps] = useState<Record<string, boolean>>({});
  const [bookingNotFound, setBookingNotFound] = useState<boolean>(false);
  const missingBookingId = !queryBookingId;
  const [authorizationError, setAuthorizationError] = useState<string | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);

  // Everything below describes ONE booking. When the requested booking changes
  // the previous booking's state must not survive into the new render: the route
  // path is unchanged, so React reuses this component instance and `navigate()`
  // uses pushState, which fires no popstate of its own. Holding the old booking
  // here is how a page ends up rendering - and, in the mentor's editor,
  // publishing - one session's workspace under another session's URL.
  useEffect(() => {
    if (!queryBookingId) return;
    setBooking(null);
    setWorkspace(null);
    setIsPending(false);
    setError(null);
    setIdentityError(null);
    setBookingNotFound(false);
    setCompletedSteps({});
    setLoading(true);
  }, [queryBookingId]);

  useEffect(() => {
    if (!queryBookingId || !seekerId) return;

    let mounted = true;
    const loadBooking = async () => {
      setLoading(true);
      setBookingNotFound(false);
      setAuthorizationError(null);
      setIdentityError(null);
      setError(null);

      try {
        // The requested booking, resolved by the server and scoped to this
        // seeker - not by scanning the seeker's whole booking list in the
        // browser, which resolves against whatever list came back.
        const found = await fetchBookingDetail(queryBookingId);
        if (!mounted) return;

        if (!found) {
          setBookingNotFound(true);
          setBooking(null);
          return;
        }

        // The response must be the booking the URL asked for. A booking that
        // matched no requested identifier is a different session, whatever it
        // happens to be.
        if (!bookingMatchesRequestedId(found, queryBookingId)) {
          setIdentityError(
            'This workspace link does not match the booking it opened. Nothing is shown, because the session behind it cannot be identified.'
          );
          setBooking(null);
          return;
        }

        if (found.seeker_id !== seekerId) {
          setAuthorizationError("You don't have access to this workspace.");
          setBooking(null);
          return;
        }

        const offer = evaluateBookingOfferIdentity(found);
        if (!offer.unverified && !(offer.segmentConsistent && offer.mentorConsistent)) {
          setIdentityError(
            'This booking lists a segment that does not match its own gig, so the session it describes cannot be shown reliably. Please contact support.'
          );
          setBooking(null);
          return;
        }

        setBooking(found);
      } catch (err: any) {
        if (mounted) {
          setError(err.message || 'Failed to load booking details.');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadBooking();
    return () => {
      mounted = false;
    };
  }, [queryBookingId, seekerId]);

  /**
   * The single state-setting entry point for the workspace.
   *
   * Hoisted out of the mount effect so the "Retry" and "Check for Updates"
   * buttons run the exact same load. They used to call
   * `fetchWorkspaceByBooking` directly and discard the result, which set no
   * state at all and so made both buttons look completely inert.
   *
   * `isActive` lets the mount effect keep its unmount guard without the button
   * handlers having to know about it.
   */
  const reloadWorkspace = useCallback(
    async (isActive: () => boolean = () => true) => {
      if (!booking?.id) return;

      setLoading(true);
      setError(null);
      setIsPending(false);

      try {
        const res = await fetchWorkspaceByBooking(booking.id, seekerId, 'seeker');

        if (!isActive()) return;

        if (res.failure === 'WORKSPACE_PARTICIPANT_MISMATCH') {
          // Not "pending". The row exists for this booking but names a different
          // pair of people, and RLS reads that row's seeker_id - so reporting it
          // as merely unpublished would describe a document this seeker is not
          // the audience for while showing them the mentor's session as awaiting.
          setIdentityError(
            'This workspace is linked to different participants than this booking. Please contact support.'
          );
          setError(null);
          setWorkspace(null);
          setIsPending(false);
          return;
        }

        if (res.failure === 'BOOKING_OFFER_MISMATCH') {
          setIdentityError(
            'This booking lists a segment that does not match its own gig, so the session it describes cannot be shown reliably. Please contact support.'
          );
          setError(null);
          setWorkspace(null);
          setIsPending(false);
          return;
        }

        if (res.error) {
          setError(res.error.message);
          setWorkspace(null);
          setIsPending(false);
        } else if (res.isPending || !res.workspace || res.workspace.status === 'PENDING') {
          setIsPending(true);
          setWorkspace(null);
        } else {
          setWorkspace(res.workspace);
          setIsPending(false);

          if (res.workspace.next_steps) {
            const initialChecks: Record<string, boolean> = {};
            res.workspace.next_steps.forEach((item) => {
              initialChecks[item.id] = !!item.completed;
            });
            setCompletedSteps(initialChecks);
          }
        }
      } catch (err: any) {
        if (isActive()) {
          setError(err.message || 'We could not reach Suggest Key. Check your connection and try again.');
        }
      } finally {
        if (isActive()) setLoading(false);
      }
    },
    [booking?.id, seekerId]
  );

  useEffect(() => {
    if (!booking?.id) return;

    let mounted = true;
    reloadWorkspace(() => mounted);
    return () => {
      mounted = false;
    };
  }, [booking?.id, reloadWorkspace]);

  const toggleStepCompleted = (stepId: string) => {
    setCompletedSteps((prev) => ({
      ...prev,
      [stepId]: !prev[stepId],
    }));
  };

  const handlePrint = () => {
    window.print();
  };

  // The rendered session must be the requested session. `booking` is nulled
  // whenever the request changes, so this can only be false in the frame between
  // an identity mismatch being detected and the state clearing - and in that
  // frame nothing is rendered at all.
  const overview =
    booking && bookingMatchesRequestedId(booking, queryBookingId)
      ? deriveSessionOverview(booking)
      : undefined;

  const renderMissingBookingId = () => (
    <div className="max-w-2xl mx-auto py-16 text-center space-y-4">
      <AlertCircle className="h-10 w-10 text-amber-600 mx-auto" />
      <h2 className="text-lg font-bold text-zinc-950">Workspace Unavailable</h2>
      <p className="text-sm text-zinc-600">Please open a workspace from your booking history.</p>
      <Button onClick={() => navigate('/seeker/bookings')} variant="outline" size="sm">
        Back to My Bookings
      </Button>
    </div>
  );

  const renderBookingNotFound = () => (
    <div className="max-w-2xl mx-auto py-16 text-center space-y-4">
      <AlertCircle className="h-10 w-10 text-rose-600 mx-auto" />
      <h2 className="text-lg font-bold text-zinc-950">Booking Not Found</h2>
      <p className="text-sm text-zinc-600">
        This booking may have been cancelled or is no longer available.
      </p>
      <Button onClick={() => navigate('/seeker/bookings')} variant="outline" size="sm">
        Back to My Bookings
      </Button>
    </div>
  );

  const renderAuthorizationError = () => (
    <div className="max-w-2xl mx-auto py-16 text-center space-y-4">
      <AlertCircle className="h-10 w-10 text-rose-600 mx-auto" />
      <h2 className="text-lg font-bold text-zinc-950">Access Denied</h2>
      <p className="text-sm text-zinc-600">
        {authorizationError || "You don't have access to this workspace."}
      </p>
      <Button onClick={() => navigate('/seeker/bookings')} variant="outline" size="sm">
        Back to My Bookings
      </Button>
    </div>
  );

  if (missingBookingId) {
    return (
      <div className="max-w-4xl mx-auto">
        {renderMissingBookingId()}
      </div>
    );
  }

  if (bookingNotFound) {
    return (
      <div className="max-w-4xl mx-auto">
        {renderBookingNotFound()}
      </div>
    );
  }

  if (authorizationError) {
    return (
      <div className="max-w-4xl mx-auto">
        {renderAuthorizationError()}
      </div>
    );
  }

  // A session whose identity cannot be established is never rendered as
  // "awaiting" and never rendered as content. This is deliberately a distinct
  // screen from both: it tells the truth about a data problem instead of
  // implying the mentor simply has not written anything yet.
  if (identityError) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center space-y-4">
        <AlertCircle className="h-10 w-10 text-rose-600 mx-auto" />
        <h2 className="text-lg font-bold text-zinc-950">Workspace Unavailable</h2>
        <p className="text-sm text-zinc-600">{identityError}</p>
        <Button onClick={() => navigate('/seeker/bookings')} variant="outline" size="sm">
          Back to My Bookings
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="rounded-xl border border-zinc-200 bg-white p-12 text-center space-y-3">
          <Loader2 className="h-8 w-8 text-zinc-400 mx-auto animate-spin" />
          <h3 className="text-sm font-semibold text-zinc-900">Retrieving Session Workspace...</h3>
          <p className="text-xs text-zinc-500">Checking authoritative database records...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-900 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => reloadWorkspace()}
            className="text-xs"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-12 text-center space-y-3">
          <Calendar className="h-8 w-8 text-zinc-400 mx-auto" />
          <h3 className="text-base font-semibold text-zinc-900">No Completed Sessions Found</h3>
          <p className="text-xs text-zinc-500 max-w-sm mx-auto">
            Once a consultation session concludes, your mentor will publish key takeaways, customized
            action steps, and resources here.
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
      </div>
    );
  }

  if (isPending) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-zinc-950">Session Workspace</h1>
                <Badge variant="secondary">Concluded</Badge>
              </div>
              <p className="text-xs text-zinc-500 mt-0.5">
                Booking #{overview.bookingCode} ·{' '}
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
              <span className="font-semibold text-zinc-600">Awaiting Mentor Notes</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-12 text-center space-y-3">
          <Clock className="h-8 w-8 text-zinc-400 mx-auto animate-pulse" />
          <h3 className="text-base font-semibold text-zinc-900">Mentor Notes Pending</h3>
          <p className="text-xs text-zinc-500 max-w-md mx-auto leading-relaxed">
            Your mentor <strong>{overview.mentorName}</strong> is currently preparing your session
            summary, key takeaways, and action items. You will receive an in-app notification the
            moment they publish.
          </p>
          <div className="pt-2">
            <Button
              onClick={() => reloadWorkspace()}
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
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-16 print:p-0 print:space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 print:hidden">
        <button
          onClick={() => navigate('/seeker/bookings')}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to My Bookings</span>
        </button>
        {workspace && !isPending && (
          <Button
            onClick={handlePrint}
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs cursor-pointer"
          >
            <Printer className="h-3.5 w-3.5" />
            <span>Print / Save PDF</span>
          </Button>
        )}
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-zinc-950">Session Workspace</h1>
              <Badge variant="secondary">Completed Session</Badge>
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">
              Booking #{overview.bookingCode} ·{' '}
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
            <span className="text-zinc-400 block text-[11px]">Mentor</span>
            <span className="font-medium text-zinc-900">{overview.mentorName}</span>
          </div>
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
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-2">
        <h2 className="text-sm font-bold text-zinc-950 flex items-center gap-2">
          <FileText className="h-4 w-4 text-zinc-500" />
          Mentor's Session Summary
        </h2>
        <p className="text-xs text-zinc-700 leading-relaxed whitespace-pre-line">
          {workspace?.mentor_notes || workspace?.summary || 'No session notes recorded.'}
        </p>
      </div>

      {workspace?.takeaways && workspace.takeaways.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-3">
          <h2 className="text-sm font-bold text-zinc-950 flex items-center gap-2">
            <Target className="h-4 w-4 text-emerald-600" />
            Key Takeaways
          </h2>
          <ul className="space-y-2.5 text-xs text-zinc-700">
            {workspace.takeaways.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2.5">
                <span className="flex items-center justify-center h-5 w-5 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-bold shrink-0 mt-0.5">
                  {idx + 1}
                </span>
                <span className="leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {workspace?.suggestions && workspace.suggestions.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-3">
          <h2 className="text-sm font-bold text-zinc-950 flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-amber-500" />
            Practical Suggestions
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

      {workspace?.next_steps && workspace.next_steps.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-zinc-950 flex items-center gap-2">
              <ArrowRight className="h-4 w-4 text-zinc-700" />
              Your Next Steps
            </h2>
            <span className="text-[11px] text-zinc-500">
              {Object.values(completedSteps).filter(Boolean).length} of {workspace.next_steps.length}{' '}
              completed
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
                      ? 'bg-zinc-50 border-zinc-200 text-zinc-500'
                      : 'bg-white border-zinc-200 hover:border-zinc-300 text-zinc-900'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {}}
                      className="rounded text-zinc-900 focus:ring-zinc-900 h-4 w-4"
                    />
                    <span className={isChecked ? 'line-through text-zinc-500' : 'font-medium'}>
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

      {workspace?.follow_up_recommendation && workspace.follow_up_recommendation.recommended && (
        <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-6 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-blue-600" />
              <h2 className="text-sm font-bold text-blue-950">Follow-up Recommendation</h2>
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
              &ldquo;{workspace.follow_up_recommendation.notes}&rdquo;
            </p>
          )}
        </div>
      )}
    </div>
  );
};
