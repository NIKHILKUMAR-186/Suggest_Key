import React, { useState, useEffect } from 'react';
import {
  FileText,
  Target,
  Lightbulb,
  ArrowRight,
  Save,
  Send,
  Eye,
  Plus,
  Trash2,
  CheckCircle2,
  Clock,
  AlertCircle,
  ArrowLeft,
  Calendar,
  User,
  Sparkles,
  Loader2,
  RefreshCw,
  HelpCircle,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { useNavigation } from '@/src/context/NavigationContext';
import { useAuth } from '@/src/context/AuthContext';
import {
  fetchWorkspaceByBooking,
  saveWorkspaceAuthoritative,
  deriveSessionOverview,
} from '@/src/lib/workspaceService';
import { fetchBookingDetail, EnrichedBookingRecord } from '@/src/lib/bookingService';
import {
  SessionWorkspace,
  NextStepItem,
  FollowUpRecommendation,
  WorkspaceStatus,
} from '@/src/types/database';

type WorkspaceDraftStatus = 'PENDING' | 'DRAFT' | 'PUBLISHED';

export const MentorWorkspacePage: React.FC = () => {
  const getWorkspaceStatus = (): WorkspaceDraftStatus => {
    if (!workspace) return 'PENDING';
    if (workspace.status === 'PUBLISHED') return 'PUBLISHED';
    return 'DRAFT';
  };
  const { navigate } = useNavigation();
  const { user } = useAuth();
  const mentorId = user?.id;

  const queryBookingId = new URLSearchParams(window.location.search || '').get('bookingId') || '';

  const [booking, setBooking] = useState<EnrichedBookingRecord | null>(null);
  const [workspace, setWorkspace] = useState<SessionWorkspace | null>(null);
  const [mentorNotes, setMentorNotes] = useState<string>('');
  const [takeaways, setTakeaways] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [nextSteps, setNextSteps] = useState<NextStepItem[]>([]);
  const [recommendFollowUp, setRecommendFollowUp] = useState<boolean>(false);
  const [followUpTimeframe, setFollowUpTimeframe] = useState<string>('2-3 weeks');
  const [followUpTopic, setFollowUpTopic] = useState<string>('');
  const [followUpNotes, setFollowUpNotes] = useState<string>('');

  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<boolean>(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState<boolean>(false);

  const [newTakeaway, setNewTakeaway] = useState<string>('');
  const [newSuggestion, setNewSuggestion] = useState<string>('');
  const [newNextStepText, setNewNextStepText] = useState<string>('');
  const [newNextStepDue, setNewNextStepDue] = useState<string>('In 7 days');

  const [authorizationError, setAuthorizationError] = useState<string | null>(null);
  const [bookingNotFound, setBookingNotFound] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;
    const loadBooking = async () => {
      if (!queryBookingId || !mentorId) {
        if (mounted) {
          setLoading(false);
          setBookingNotFound(!queryBookingId);
        }
        return;
      }

      setLoading(true);
      setBookingNotFound(false);
      setAuthorizationError(null);

      try {
        const data = await fetchBookingDetail(queryBookingId, mentorId);
        if (!mounted) return;

        if (!data) {
          setBookingNotFound(true);
          setBooking(null);
          return;
        }

        if (data.mentor_id !== mentorId) {
          setAuthorizationError('You do not have access to this workspace.');
          setBooking(null);
          return;
        }

        setBooking(data);
      } catch (err: any) {
        if (mounted) {
          setBookingNotFound(true);
          setBooking(null);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadBooking();
    return () => {
      mounted = false;
    };
  }, [queryBookingId, mentorId]);

  useEffect(() => {
    if (!booking?.id) return;

    let mounted = true;
    const loadWorkspace = async () => {
      setLoading(true);
      setFeedbackError(null);
      setFeedbackSuccess(null);

      try {
        const res = await fetchWorkspaceByBooking(booking.id, mentorId, 'mentor');
        if (!mounted) return;

        if (res.workspace) {
          setWorkspace(res.workspace);
          setMentorNotes(res.workspace.mentor_notes || res.workspace.summary || '');
          setTakeaways(res.workspace.takeaways || []);
          setSuggestions(res.workspace.suggestions || []);
          setNextSteps(res.workspace.next_steps || []);

          if (res.workspace.follow_up_recommendation) {
            setRecommendFollowUp(!!res.workspace.follow_up_recommendation.recommended);
            setFollowUpTimeframe(res.workspace.follow_up_recommendation.timeframe || '2-3 weeks');
            setFollowUpTopic(res.workspace.follow_up_recommendation.topic || '');
            setFollowUpNotes(res.workspace.follow_up_recommendation.notes || '');
          } else {
            setRecommendFollowUp(false);
            setFollowUpTopic('');
            setFollowUpNotes('');
          }
        } else {
          setWorkspace(null);
          setMentorNotes('');
          setTakeaways([]);
          setSuggestions([]);
          setNextSteps([]);
          setRecommendFollowUp(false);
          setFollowUpTopic('');
          setFollowUpNotes('');
        }
      } catch (err: any) {
        if (mounted) {
          setFeedbackError(err.message || 'Failed to load session workspace.');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadWorkspace();
    return () => {
      mounted = false;
    };
  }, [booking?.id, mentorId]);

  const handleAddTakeaway = () => {
    if (!newTakeaway.trim()) return;
    setTakeaways([...takeaways, newTakeaway.trim()]);
    setNewTakeaway('');
  };

  const handleRemoveTakeaway = (index: number) => {
    setTakeaways(takeaways.filter((_, i) => i !== index));
  };

  const handleAddSuggestion = () => {
    if (!newSuggestion.trim()) return;
    setSuggestions([...suggestions, newSuggestion.trim()]);
    setNewSuggestion('');
  };

  const handleRemoveSuggestion = (index: number) => {
    setSuggestions(suggestions.filter((_, i) => i !== index));
  };

  const handleAddNextStep = () => {
    if (!newNextStepText.trim()) return;
    const newItem: NextStepItem = {
      id: `ns-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      text: newNextStepText.trim(),
      due_date: newNextStepDue.trim() || undefined,
      completed: false,
    };
    setNextSteps([...nextSteps, newItem]);
    setNewNextStepText('');
  };

  const handleRemoveNextStep = (id: string) => {
    setNextSteps(nextSteps.filter((item) => item.id !== id));
  };

  const handleSave = async (publish: boolean) => {
    if (!booking?.id || !mentorId) {
      setFeedbackError('Missing booking information. Please refresh and try again.');
      return;
    }

    if (publish && !mentorNotes.trim()) {
      setFeedbackError('Please provide session notes before publishing to the seeker.');
      return;
    }

    setSaving(true);
    setFeedbackError(null);
    setFeedbackSuccess(null);

    const followUpPayload: FollowUpRecommendation | null = recommendFollowUp
      ? {
          recommended: true,
          timeframe: followUpTimeframe,
          topic: followUpTopic.trim() || undefined,
          notes: followUpNotes.trim() || undefined,
        }
      : null;

    try {
      const result = await saveWorkspaceAuthoritative(
        {
          booking_id: booking.id,
          mentor_id: mentorId,
          mentor_notes: mentorNotes.trim(),
          takeaways,
          suggestions,
          next_steps: nextSteps,
          follow_up_recommendation: followUpPayload,
          publish,
        },
        mentorId,
        'mentor'
      );

      if (result.success && result.workspace) {
        setWorkspace(result.workspace);
        setFeedbackSuccess(
          publish
            ? 'Workspace published successfully! The seeker has been notified.'
            : 'Draft saved successfully.'
        );
      } else {
        setFeedbackError(result.error?.message || 'Failed to save workspace.');
      }
    } catch (err: any) {
      setFeedbackError(err.message || 'Unexpected network error.');
    } finally {
      setSaving(false);
      setShowPublishConfirm(false);
    }
  };

  const workspaceStatus = getWorkspaceStatus();

  const sessionStatusLabel =
    workspaceStatus === 'PUBLISHED'
      ? 'PUBLISHED'
      : workspaceStatus === 'DRAFT'
      ? 'DRAFT'
      : 'NOT_STARTED';

  const sessionStatusVariant =
    workspaceStatus === 'PUBLISHED'
      ? 'success'
      : workspaceStatus === 'DRAFT'
      ? 'secondary'
      : 'warning';

  const overview = booking ? deriveSessionOverview(booking) : workspace?.session_overview;

  const renderMissingBookingId = () => (
    <div className="max-w-2xl mx-auto py-16 text-center space-y-4">
      <HelpCircle className="h-10 w-10 text-amber-600 mx-auto" />
      <h2 className="text-lg font-bold text-zinc-950">Workspace Unavailable</h2>
      <p className="text-sm text-zinc-600">
        Please open a workspace from your booking history.
      </p>
      <Button onClick={() => navigate('/mentor/bookings')} variant="outline" size="sm">
        Back to Mentor Bookings
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
      <Button onClick={() => navigate('/mentor/bookings')} variant="outline" size="sm">
        Back to Mentor Bookings
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
      <Button onClick={() => navigate('/mentor/bookings')} variant="outline" size="sm">
        Back to Mentor Bookings
      </Button>
    </div>
  );

  if (!queryBookingId) {
    return (
      <div className="max-w-5xl mx-auto">
        {renderMissingBookingId()}
      </div>
    );
  }

  if (bookingNotFound) {
    return (
      <div className="max-w-5xl mx-auto">
        {renderBookingNotFound()}
      </div>
    );
  }

  if (authorizationError) {
    return (
      <div className="max-w-5xl mx-auto">
        {renderAuthorizationError()}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="rounded-xl border border-zinc-200 bg-white p-12 text-center space-y-3">
          <Loader2 className="h-8 w-8 text-zinc-400 mx-auto animate-spin" />
          <h3 className="text-sm font-semibold text-zinc-900">Loading Session Workspace...</h3>
          <p className="text-xs text-zinc-500">Loading booking details and workspace...</p>
        </div>
      </div>
    );
  }

  if (!booking || !overview) {
    return (
      <div className="max-w-5xl mx-auto">
        {renderBookingNotFound()}
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-24">
      {/* TOP HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-200 pb-4">
        <div className="space-y-1">
          <button
            onClick={() => navigate('/mentor/bookings')}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 transition-colors cursor-pointer mb-2"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to Mentor Bookings</span>
          </button>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">
              Session Workspace
            </h1>
            <Badge variant={sessionStatusVariant} className="text-xs">
              {sessionStatusLabel}
            </Badge>
          </div>
          <p className="text-xs text-zinc-500 max-w-xl">
            Capture the outcome of this mentoring session and turn it into useful follow-up guidance for
            the seeker.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="flex items-center bg-zinc-100 p-1 rounded-lg text-xs">
            <button
              onClick={() => setPreviewMode(false)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                !previewMode
                  ? 'bg-white text-zinc-950 shadow-xs font-bold'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              <span>Editor</span>
            </button>
            <button
              onClick={() => setPreviewMode(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                previewMode ? 'bg-white text-zinc-950 shadow-xs font-bold' : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              <Eye className="h-3.5 w-3.5" />
              <span>Seeker Preview</span>
            </button>
          </div>
        </div>
      </div>

      {/* FEEDBACK ALERTS */}
      {feedbackSuccess && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-xs text-emerald-900 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span className="font-medium">{feedbackSuccess}</span>
          </div>
          <button
            onClick={() => setFeedbackSuccess(null)}
            className="text-emerald-700 hover:text-emerald-900 text-xs font-bold cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {feedbackError && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 p-4 text-xs text-rose-900 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
            <span className="font-medium">{feedbackError}</span>
          </div>
          <button
            onClick={() => setFeedbackError(null)}
            className="text-rose-700 hover:text-rose-900 text-xs font-bold cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {previewMode ? (
        /* SEEKER PREVIEW */
        <div className="space-y-6">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 flex items-center gap-2">
            <Eye className="h-4 w-4 text-amber-700 shrink-0" />
            <span>
              <strong>Seeker Preview:</strong> This preview shows exactly what the seeker will see after
              you publish.
            </span>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-4">
              <div>
                <h2 className="text-lg font-bold text-zinc-950">Session Workspace</h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Booking #{overview.bookingCode} ·{' '}
                  {new Date(overview.startTime).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </p>
              </div>
              <Badge variant={overview.bookingStatus === 'COMPLETED' ? 'secondary' : 'default'}>
                {overview.bookingStatus}
              </Badge>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs bg-zinc-50 p-4 rounded-lg">
              <div>
                <span className="text-zinc-400 block text-[11px]">Seeker</span>
                <span className="font-medium text-zinc-900">{overview.seekerName}</span>
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
            <h3 className="text-sm font-bold text-zinc-950 flex items-center gap-2">
              <FileText className="h-4 w-4 text-zinc-500" />
              Session Summary
            </h3>
            {mentorNotes ? (
              <p className="text-xs text-zinc-700 leading-relaxed whitespace-pre-line pt-1">
                {mentorNotes}
              </p>
            ) : (
              <p className="text-xs text-zinc-400 italic pt-1">No session notes recorded.</p>
            )}
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-3">
            <h3 className="text-sm font-bold text-zinc-950 flex items-center gap-2">
              <Target className="h-4 w-4 text-emerald-600" />
              Key Takeaways
            </h3>
            {takeaways.length > 0 ? (
              <ul className="space-y-2 text-xs text-zinc-700">
                {takeaways.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-zinc-400 italic">No takeaways added yet.</p>
            )}
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-3">
            <h3 className="text-sm font-bold text-zinc-950 flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              Practical Suggestions
            </h3>
            {suggestions.length > 0 ? (
              <ul className="space-y-2 text-xs text-zinc-700">
                {suggestions.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0 mt-1.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-zinc-400 italic">No suggestions provided.</p>
            )}
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-3">
            <h3 className="text-sm font-bold text-zinc-950 flex items-center gap-2">
              <ArrowRight className="h-4 w-4 text-zinc-700" />
              Next Steps
            </h3>
            {nextSteps.length > 0 ? (
              <div className="space-y-2 text-xs">
                {nextSteps.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 bg-zinc-50 rounded-lg border border-zinc-100 flex items-center justify-between gap-3"
                  >
                    <span className="font-medium text-zinc-900">{item.text}</span>
                    {item.due_date && <Badge variant="secondary">{item.due_date}</Badge>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-400 italic">No next steps listed.</p>
            )}
          </div>

          {recommendFollowUp && (
            <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-6 space-y-2">
              <h3 className="text-sm font-bold text-blue-950">Follow-up Recommendation</h3>
              <p className="text-xs text-blue-900">
                <strong>Timeframe:</strong> {followUpTimeframe}
              </p>
              {followUpTopic && (
                <p className="text-xs text-blue-900">
                  <strong>Topic:</strong> {followUpTopic}
                </p>
              )}
              {followUpNotes && <p className="text-xs text-blue-800 italic">"{followUpNotes}"</p>}
            </div>
          )}
        </div>
      ) : (
        /* MENTOR EDITOR */
        <div className="space-y-6">
          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
              <h2 className="text-sm font-bold text-zinc-950 flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-zinc-500" />
                Active Session
              </h2>
              <span className="text-xs font-mono text-zinc-500">Booking #{overview.bookingCode}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-zinc-400 block text-[11px]">Seeker</span>
                <span className="font-semibold text-zinc-900">{overview.seekerName}</span>
              </div>
              <div>
                <span className="text-zinc-400 block text-[11px]">Gig</span>
                <span className="font-medium text-zinc-900">{overview.gigTitle}</span>
              </div>
              <div>
                <span className="text-zinc-400 block text-[11px]">Segment</span>
                <span className="font-medium text-zinc-900">{overview.segmentTitle}</span>
              </div>
              <div>
                <span className="text-zinc-400 block text-[11px]">Duration</span>
                <span className="font-medium text-zinc-900">{overview.durationMinutes} Minutes</span>
              </div>
            </div>
            <div className="text-[11px] text-zinc-500 space-y-0.5">
              <p>
                <span className="font-semibold text-zinc-600">Mentor:</span> {overview.mentorName}
              </p>
              <p>
                <span className="font-semibold text-zinc-600">Date:</span>{' '}
                {new Date(overview.startTime).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </p>
              <p>
                <span className="font-semibold text-zinc-600">Time:</span>{' '}
                {new Date(overview.startTime).toLocaleTimeString('en-IN', {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: true,
                })}{' '}
                –{' '}
                {new Date(overview.endTime).toLocaleTimeString('en-IN', {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: true,
                })}{' '}
                IST
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs space-y-3">
            <h2 className="text-sm font-bold text-zinc-950 flex items-center gap-1.5">
              <FileText className="h-4 w-4 text-zinc-500" />
              Session Summary
            </h2>
            <p className="text-[11px] text-zinc-500">
              Summarize the key themes, observations and context from the conversation.
            </p>
            <textarea
              rows={5}
              value={mentorNotes}
              onChange={(e) => setMentorNotes(e.target.value)}
              placeholder="Summarize the core conversation themes, client strengths observed, and mindset shifts discussed during the session..."
              className="w-full rounded-lg border border-zinc-300 p-3 text-xs text-zinc-900 focus:border-zinc-900 focus:outline-hidden leading-relaxed"
            />
            <p className="text-[11px] text-zinc-400 text-right">{mentorNotes.length} characters</p>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-zinc-950 flex items-center gap-1.5">
                <Target className="h-4 w-4 text-emerald-600" />
                Key Takeaways
              </h2>
              <span className="text-[11px] text-zinc-400">
                Key Takeaways ({takeaways.length})
              </span>
            </div>
            <p className="text-[11px] text-zinc-500">
              What should the seeker remember after today's session?
            </p>

            {takeaways.length > 0 && (
              <div className="space-y-2">
                {takeaways.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-zinc-50 border border-zinc-200 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <span className="text-zinc-800">{item}</span>
                    </div>
                    <button
                      onClick={() => handleRemoveTakeaway(idx)}
                      className="text-zinc-400 hover:text-rose-600 p-1 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={newTakeaway}
                onChange={(e) => setNewTakeaway(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTakeaway())}
                placeholder="e.g. Distinguish between emotional trigger and reactive impulse..."
                className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-xs text-zinc-900 focus:border-zinc-900 focus:outline-hidden"
              />
              <Button
                type="button"
                onClick={handleAddTakeaway}
                size="sm"
                variant="outline"
                className="gap-1 text-xs shrink-0 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Takeaway</span>
              </Button>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-zinc-950 flex items-center gap-1.5">
                <Lightbulb className="h-4 w-4 text-amber-500" />
                Practical Suggestions
              </h2>
              <span className="text-[11px] text-zinc-400">
                Suggestions ({suggestions.length})
              </span>
            </div>
            <p className="text-[11px] text-zinc-500">
              Turn the conversation into actionable guidance.
            </p>

            {suggestions.length > 0 && (
              <div className="space-y-2">
                {suggestions.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-zinc-50 border border-zinc-200 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                      <span className="text-zinc-800">{item}</span>
                    </div>
                    <button
                      onClick={() => handleRemoveSuggestion(idx)}
                      className="text-zinc-400 hover:text-rose-600 p-1 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={newSuggestion}
                onChange={(e) => setNewSuggestion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddSuggestion())}
                placeholder="e.g. Read Nonviolent Communication Chapter 3; use 2-min pause rule..."
                className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-xs text-zinc-900 focus:border-zinc-900 focus:outline-hidden"
              />
              <Button
                type="button"
                onClick={handleAddSuggestion}
                size="sm"
                variant="outline"
                className="gap-1 text-xs shrink-0 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Suggestion</span>
              </Button>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-zinc-950 flex items-center gap-1.5">
                <ArrowRight className="h-4 w-4 text-zinc-700" />
                Action Plan
              </h2>
              <span className="text-[11px] text-zinc-400">
                Next Steps ({nextSteps.length})
              </span>
            </div>
            <p className="text-[11px] text-zinc-500">
              Clear deliverables with target timeframes.
            </p>

            {nextSteps.length > 0 && (
              <div className="space-y-2">
                {nextSteps.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-zinc-50 border border-zinc-200 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-zinc-900">{item.text}</span>
                      {item.due_date && <Badge variant="secondary">{item.due_date}</Badge>}
                    </div>
                    <button
                      onClick={() => handleRemoveNextStep(item.id)}
                      className="text-zinc-400 hover:text-rose-600 p-1 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
              <input
                type="text"
                value={newNextStepText}
                onChange={(e) => setNewNextStepText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddNextStep())}
                placeholder="e.g. Log 3 conversational friction instances in journal..."
                className="w-full sm:flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-xs text-zinc-900 focus:border-zinc-900 focus:outline-hidden"
              />
              <select
                value={newNextStepDue}
                onChange={(e) => setNewNextStepDue(e.target.value)}
                className="w-full sm:w-36 rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-xs text-zinc-900 focus:border-zinc-900 focus:outline-hidden"
              >
                <option value="In 3 days">In 3 days</option>
                <option value="In 7 days">In 7 days</option>
                <option value="In 14 days">In 14 days</option>
                <option value="Before next call">Before next call</option>
                <option value="Optional">Optional</option>
              </select>
              <Button
                type="button"
                onClick={handleAddNextStep}
                size="sm"
                variant="outline"
                className="w-full sm:w-auto gap-1 text-xs shrink-0 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Step</span>
              </Button>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-blue-600" />
                <h2 className="text-sm font-bold text-zinc-950">Follow-up Recommendation</h2>
              </div>
              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-zinc-700">
                <input
                  type="checkbox"
                  checked={recommendFollowUp}
                  onChange={(e) => setRecommendFollowUp(e.target.checked)}
                  className="rounded text-zinc-900 focus:ring-zinc-900"
                />
                <span>Recommend Follow-up</span>
              </label>
            </div>

            {recommendFollowUp && (
              <div className="space-y-3 pt-2 bg-blue-50/40 p-4 rounded-lg border border-blue-100">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-bold text-zinc-700 block mb-1">
                      Recommended Timeframe
                    </label>
                    <select
                      value={followUpTimeframe}
                      onChange={(e) => setFollowUpTimeframe(e.target.value)}
                      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-900 focus:border-zinc-900 focus:outline-hidden"
                    >
                      <option value="1 week">1 week</option>
                      <option value="2-3 weeks">2-3 weeks (Recommended standard)</option>
                      <option value="1 month">1 month</option>
                      <option value="As needed">As needed / On-demand</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-zinc-700 block mb-1">
                      Recommended Topic / Goal
                    </label>
                    <input
                      type="text"
                      value={followUpTopic}
                      onChange={(e) => setFollowUpTopic(e.target.value)}
                      placeholder="e.g. Active listening review & boundary script rehearsal"
                      className="w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-xs text-zinc-900 focus:border-zinc-900 focus:outline-hidden"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-bold text-zinc-700 block mb-1">
                    Guidance Notes for Client
                  </label>
                  <textarea
                    rows={2}
                    value={followUpNotes}
                    onChange={(e) => setFollowUpNotes(e.target.value)}
                    placeholder="Explain why this follow-up interval will benefit the seeker's progress..."
                    className="w-full rounded-lg border border-zinc-300 p-2 text-xs text-zinc-900 focus:border-zinc-900 focus:outline-hidden"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* PUBLISH CONFIRMATION MODAL */}
      {showPublishConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setShowPublishConfirm(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-zinc-950">Publish this workspace?</h2>
            <p className="text-xs text-zinc-600">
              Once published, the seeker will be able to view the session notes and guidance.
            </p>
            <div className="flex gap-3 pt-2">
              <Button
                onClick={() => setShowPublishConfirm(false)}
                variant="outline"
                size="sm"
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={() => handleSave(true)}
                size="sm"
                className="flex-1 bg-zinc-900 text-white hover:bg-zinc-800 cursor-pointer"
                disabled={saving}
              >
                {saving ? 'Publishing...' : 'Publish'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* BOTTOM ACTION BAR */}
      {!previewMode && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-200 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/70">
          <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3">
            <div className="text-xs text-zinc-500">
              {workspace?.updated_at && (
                <span>Last saved: {new Date(workspace.updated_at).toLocaleTimeString('en-IN')}</span>
              )}
              {!workspace && <span>Draft not started</span>}
            </div>
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => handleSave(false)}
                className="w-full sm:w-auto gap-2 text-xs cursor-pointer"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                <span>Save Draft</span>
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={saving}
                onClick={() => setShowPublishConfirm(true)}
                className="w-full sm:w-auto gap-2 text-xs bg-zinc-900 text-white hover:bg-zinc-800 cursor-pointer shadow-xs"
              >
                <Send className="h-3.5 w-3.5" />
                <span>Publish Workspace</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
