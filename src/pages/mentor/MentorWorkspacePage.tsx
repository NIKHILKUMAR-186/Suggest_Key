import React, { useState, useEffect } from 'react';
import {
  FileText,
  Target,
  Lightbulb,
  ArrowRight,
  Save,
  Send,
  Eye,
  Edit3,
  Plus,
  Trash2,
  CheckCircle2,
  Clock,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Calendar,
  User,
  Sparkles,
  Loader2,
  RefreshCw,
  ExternalLink,
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
import { fetchMentorBookings, EnrichedBookingRecord } from '@/src/lib/bookingService';
import {
  SessionWorkspace,
  NextStepItem,
  FollowUpRecommendation,
} from '@/src/types/database';

export const MentorWorkspacePage: React.FC = () => {
  const { currentPath, navigate } = useNavigation();
  const { user } = useAuth();
  const mentorId = user?.id || 'usr-8802';

  // Read bookingId from query parameter if present
  const queryBookingId = new URLSearchParams(window.location.search || '').get('bookingId') || '';

  // Bookings list for mentor selection
  const [mentorBookings, setMentorBookings] = useState<EnrichedBookingRecord[]>([]);
  const [selectedBookingId, setSelectedBookingId] = useState<string>(queryBookingId);
  const [selectedBooking, setSelectedBooking] = useState<EnrichedBookingRecord | null>(null);

  // Workspace form state
  const [workspace, setWorkspace] = useState<SessionWorkspace | null>(null);
  const [mentorNotes, setMentorNotes] = useState<string>('');
  const [takeaways, setTakeaways] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [nextSteps, setNextSteps] = useState<NextStepItem[]>([]);
  const [recommendFollowUp, setRecommendFollowUp] = useState<boolean>(false);
  const [followUpTimeframe, setFollowUpTimeframe] = useState<string>('2-3 weeks');
  const [followUpTopic, setFollowUpTopic] = useState<string>('');
  const [followUpNotes, setFollowUpNotes] = useState<string>('');

  // UI state
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<boolean>(false);

  // New item draft inputs
  const [newTakeaway, setNewTakeaway] = useState<string>('');
  const [newSuggestion, setNewSuggestion] = useState<string>('');
  const [newNextStepText, setNewNextStepText] = useState<string>('');
  const [newNextStepDue, setNewNextStepDue] = useState<string>('In 7 days');

  // Load mentor's eligible bookings (completed or active)
  useEffect(() => {
    let mounted = true;
    const loadBookings = async () => {
      try {
        const bookings = await fetchMentorBookings(mentorId);
        if (mounted) {
          setMentorBookings(bookings);

          // Find requested or first completed booking
          let target = bookings.find((b) => b.id === queryBookingId || b.booking_code === queryBookingId);
          if (!target && bookings.length > 0) {
            target = bookings.find((b) => b.status === 'COMPLETED') || bookings[0];
          }

          if (target) {
            setSelectedBookingId(target.id);
            setSelectedBooking(target);
          }
        }
      } catch (err: any) {
        console.error('Failed to load mentor bookings:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadBookings();
    return () => {
      mounted = false;
    };
  }, [mentorId, queryBookingId]);

  // Load workspace for selected booking
  useEffect(() => {
    if (!selectedBookingId) return;

    let mounted = true;
    const loadWorkspace = async () => {
      setLoading(true);
      setFeedbackError(null);
      setFeedbackSuccess(null);

      try {
        const res = await fetchWorkspaceByBooking(selectedBookingId, mentorId, 'mentor');
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
          // Initialize empty draft for this booking
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

    // Update selected booking object
    const foundBooking = mentorBookings.find((b) => b.id === selectedBookingId);
    if (foundBooking) {
      setSelectedBooking(foundBooking);
    }

    loadWorkspace();
    return () => {
      mounted = false;
    };
  }, [selectedBookingId, mentorBookings, mentorId]);

  // Handler: Add Takeaway
  const handleAddTakeaway = () => {
    if (!newTakeaway.trim()) return;
    setTakeaways([...takeaways, newTakeaway.trim()]);
    setNewTakeaway('');
  };

  const handleRemoveTakeaway = (index: number) => {
    setTakeaways(takeaways.filter((_, i) => i !== index));
  };

  // Handler: Add Suggestion
  const handleAddSuggestion = () => {
    if (!newSuggestion.trim()) return;
    setSuggestions([...suggestions, newSuggestion.trim()]);
    setNewSuggestion('');
  };

  const handleRemoveSuggestion = (index: number) => {
    setSuggestions(suggestions.filter((_, i) => i !== index));
  };

  // Handler: Add Next Step
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

  // Handler: Save workspace (Draft or Publish)
  const handleSave = async (publish: boolean) => {
    if (!selectedBookingId) {
      setFeedbackError('Please select a session booking first.');
      return;
    }

    if (publish && !mentorNotes.trim()) {
      setFeedbackError('Please provide mentor notes before publishing to the seeker.');
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
          booking_id: selectedBookingId,
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
            ? 'Workspace published successfully! Seeker has been alerted via in-app notification.'
            : 'Workspace draft saved successfully. Only you and admins can view it.'
        );
      } else {
        setFeedbackError(result.error?.message || 'Failed to save workspace.');
      }
    } catch (err: any) {
      setFeedbackError(err.message || 'Unexpected network error.');
    } finally {
      setSaving(false);
    }
  };

  const overview = selectedBooking ? deriveSessionOverview(selectedBooking) : workspace?.session_overview;

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      {/* Header & Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-200 pb-4">
        <div>
          <button
            onClick={() => navigate('/mentor/bookings')}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 transition-colors mb-2 cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to Mentor Bookings</span>
          </button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">
              Mentor Session Workspace
            </h1>
            {workspace?.status === 'PUBLISHED' ? (
              <Badge variant="success" className="text-xs">
                PUBLISHED
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-xs">
                DRAFT / PENDING
              </Badge>
            )}
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            Author and publish post-consultation takeaways, action items, and follow-up guidance.
          </p>
        </div>

        {/* View mode toggle */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="flex items-center bg-zinc-100 p-1 rounded-lg text-xs">
            <button
              onClick={() => setPreviewMode(false)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
                !previewMode ? 'bg-white text-zinc-950 shadow-xs font-bold' : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              <Edit3 className="h-3.5 w-3.5" />
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

      {/* Session Booking Selector */}
      <div className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <label className="text-xs font-bold text-zinc-700 block">
            Select Consultation Session
          </label>
          <p className="text-[11px] text-zinc-500">
            Workspaces attach directly to individual confirmed or completed bookings.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            id="select-mentor-booking"
            value={selectedBookingId}
            onChange={(e) => setSelectedBookingId(e.target.value)}
            className="w-full md:w-80 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-900 focus:border-zinc-900 focus:outline-hidden"
          >
            {mentorBookings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.booking_code} · {b.seeker?.full_name || 'Seeker'} ({b.status})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Feedback Alerts */}
      {feedbackSuccess && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-xs text-emerald-900 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span className="font-medium">{feedbackSuccess}</span>
          </div>
          <button
            onClick={() => setFeedbackSuccess(null)}
            className="text-emerald-700 hover:text-emerald-900 text-xs font-bold"
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
            className="text-rose-700 hover:text-rose-900 text-xs font-bold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-12 text-center space-y-3">
          <Loader2 className="h-8 w-8 text-zinc-400 mx-auto animate-spin" />
          <h3 className="text-sm font-semibold text-zinc-900">Loading Session Workspace...</h3>
          <p className="text-xs text-zinc-500">Fetching authoritative Supabase records and session metadata.</p>
        </div>
      ) : !overview ? (
        /* Empty State */
        <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-12 text-center space-y-3">
          <Calendar className="h-8 w-8 text-zinc-400 mx-auto" />
          <h3 className="text-base font-semibold text-zinc-900">No Booking Selected</h3>
          <p className="text-xs text-zinc-500 max-w-sm mx-auto">
            Please choose an eligible consultation from your bookings list above to begin drafting workspace notes.
          </p>
        </div>
      ) : previewMode ? (
        /* ------------------------------------------------------------- */
        /* SEEKER PREVIEW MODE                                           */
        /* ------------------------------------------------------------- */
        <div className="space-y-6">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 flex items-center gap-2">
            <Eye className="h-4 w-4 text-amber-700 shrink-0" />
            <span>
              <strong>Seeker Preview Mode:</strong> This is an accurate simulation of what your seeker client will see when they access this workspace. Private contact information is strictly hidden.
            </span>
          </div>

          {/* Section 1: Session Overview */}
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-zinc-950">Session Workspace</h2>
                  <Badge variant={overview.bookingStatus === 'COMPLETED' ? 'secondary' : 'default'}>
                    {overview.bookingStatus}
                  </Badge>
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
                <span className="text-zinc-400 block text-[11px]">Mentor Advisor</span>
                <span className="font-semibold text-zinc-900">{overview.mentorName}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs bg-zinc-50 p-4 rounded-lg">
              <div>
                <span className="text-zinc-400 block text-[11px]">Client</span>
                <span className="font-medium text-zinc-900">{overview.seekerName}</span>
              </div>
              <div>
                <span className="text-zinc-400 block text-[11px]">Segment</span>
                <span className="font-medium text-zinc-900">{overview.segmentTitle}</span>
              </div>
              <div>
                <span className="text-zinc-400 block text-[11px]">Topic / Gig</span>
                <span className="font-medium text-zinc-900">{overview.gigTitle}</span>
              </div>
              <div>
                <span className="text-zinc-400 block text-[11px]">Duration</span>
                <span className="font-medium text-zinc-900">{overview.durationMinutes} Minutes</span>
              </div>
            </div>
          </div>

          {/* Section 2: Mentor Notes */}
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-2">
            <h3 className="text-sm font-bold text-zinc-950 flex items-center gap-2">
              <FileText className="h-4 w-4 text-zinc-500" />
              Mentor Session Summary & Notes
            </h3>
            {mentorNotes ? (
              <p className="text-xs text-zinc-700 leading-relaxed whitespace-pre-line pt-1">
                {mentorNotes}
              </p>
            ) : (
              <p className="text-xs text-zinc-400 italic pt-1">No session notes recorded.</p>
            )}
          </div>

          {/* Section 3: Key Takeaways */}
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

          {/* Section 4: Suggestions */}
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-3">
            <h3 className="text-sm font-bold text-zinc-950 flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              Practical Suggestions & Recommendations
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

          {/* Section 5: Next Steps */}
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-3">
            <h3 className="text-sm font-bold text-zinc-950 flex items-center gap-2">
              <ArrowRight className="h-4 w-4 text-zinc-700" />
              Actionable Next Steps
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

          {/* Section 6: Optional Follow-up Recommendation */}
          {recommendFollowUp && (
            <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-6 space-y-2">
              <h3 className="text-sm font-bold text-blue-950">Mentor Follow-up Recommendation</h3>
              <p className="text-xs text-blue-900">
                <strong>Recommended Cadence:</strong> {followUpTimeframe}
              </p>
              {followUpTopic && (
                <p className="text-xs text-blue-900">
                  <strong>Recommended Topic:</strong> {followUpTopic}
                </p>
              )}
              {followUpNotes && <p className="text-xs text-blue-800 italic">"{followUpNotes}"</p>}
              <div className="pt-2">
                <Button size="sm" className="gap-1.5 text-xs bg-blue-900 text-white cursor-pointer">
                  <span>Book Follow-up Session</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ------------------------------------------------------------- */
        /* MENTOR EDIT MODE                                              */
        /* ------------------------------------------------------------- */
        <div className="space-y-6">
          {/* Section 1: Session Overview (Read-only Card) */}
          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
              <h2 className="text-sm font-bold text-zinc-950 flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-zinc-500" />
                Section 1: Session Overview
              </h2>
              <span className="text-xs font-mono text-zinc-400">{overview.bookingCode}</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-zinc-50 p-3.5 rounded-lg border border-zinc-100">
              <div>
                <span className="text-zinc-400 block text-[11px]">Seeker Name</span>
                <span className="font-semibold text-zinc-900">{overview.seekerName}</span>
              </div>
              <div>
                <span className="text-zinc-400 block text-[11px]">Segment</span>
                <span className="font-medium text-zinc-900">{overview.segmentTitle}</span>
              </div>
              <div>
                <span className="text-zinc-400 block text-[11px]">Session Topic</span>
                <span className="font-medium text-zinc-900">{overview.gigTitle}</span>
              </div>
              <div>
                <span className="text-zinc-400 block text-[11px]">Scheduled Duration</span>
                <span className="font-medium text-zinc-900">{overview.durationMinutes} Minutes</span>
              </div>
            </div>
          </div>

          {/* Section 2: Mentor Notes */}
          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-zinc-950 flex items-center gap-1.5">
                <FileText className="h-4 w-4 text-zinc-500" />
                Section 2: Mentor Notes & Session Summary
              </h2>
              <span className="text-[11px] text-zinc-400">{mentorNotes.length} characters</span>
            </div>

            <textarea
              id="input-mentor-notes"
              rows={4}
              value={mentorNotes}
              onChange={(e) => setMentorNotes(e.target.value)}
              placeholder="Summarize the core conversation themes, client strengths observed, and mindset shifts discussed during the session..."
              className="w-full rounded-lg border border-zinc-300 p-3 text-xs text-zinc-900 focus:border-zinc-900 focus:outline-hidden leading-relaxed"
            />
          </div>

          {/* Section 3: Key Takeaways */}
          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-zinc-950 flex items-center gap-1.5">
                <Target className="h-4 w-4 text-emerald-600" />
                Section 3: Key Takeaways ({takeaways.length})
              </h2>
              <span className="text-[11px] text-zinc-400">High-impact insights for the seeker</span>
            </div>

            {/* List */}
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
                      title="Remove takeaway"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add Input */}
            <div className="flex items-center gap-2 pt-1">
              <input
                id="input-new-takeaway"
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

          {/* Section 4: Suggestions */}
          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-zinc-950 flex items-center gap-1.5">
                <Lightbulb className="h-4 w-4 text-amber-500" />
                Section 4: Practical Suggestions ({suggestions.length})
              </h2>
              <span className="text-[11px] text-zinc-400">Tactical guidance and habits</span>
            </div>

            {/* List */}
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
                      title="Remove suggestion"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add Input */}
            <div className="flex items-center gap-2 pt-1">
              <input
                id="input-new-suggestion"
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

          {/* Section 5: Next Steps */}
          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-zinc-950 flex items-center gap-1.5">
                <ArrowRight className="h-4 w-4 text-zinc-700" />
                Section 5: Actionable Next Steps ({nextSteps.length})
              </h2>
              <span className="text-[11px] text-zinc-400">Clear deliverables with target timeframes</span>
            </div>

            {/* List */}
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
                      title="Remove step"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add Input */}
            <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
              <input
                id="input-next-step-text"
                type="text"
                value={newNextStepText}
                onChange={(e) => setNewNextStepText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddNextStep())}
                placeholder="e.g. Log 3 conversational friction instances in journal..."
                className="w-full sm:flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-xs text-zinc-900 focus:border-zinc-900 focus:outline-hidden"
              />
              <select
                id="select-next-step-due"
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

          {/* Section 6: Optional Follow-up Recommendation */}
          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-blue-600" />
                <h2 className="text-sm font-bold text-zinc-950">
                  Section 6: Follow-up Recommendation (Optional)
                </h2>
              </div>

              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-zinc-700">
                <input
                  id="toggle-follow-up"
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
                      id="select-follow-up-timeframe"
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
                      Recommended Follow-up Topic / Goal
                    </label>
                    <input
                      id="input-follow-up-topic"
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
                    id="input-follow-up-notes"
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

          {/* Action Footer: Save Draft & Publish Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-zinc-200">
            <div className="text-xs text-zinc-500">
              {workspace?.updated_at && (
                <span>Last updated: {new Date(workspace.updated_at).toLocaleTimeString('en-IN')}</span>
              )}
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              {/* Save as Draft */}
              <Button
                id="btn-save-draft"
                type="button"
                variant="outline"
                size="md"
                disabled={saving}
                onClick={() => handleSave(false)}
                className="w-full sm:w-auto gap-2 text-xs cursor-pointer"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                <span>Save as Draft</span>
              </Button>

              {/* Publish to Seeker */}
              <Button
                id="btn-publish-workspace"
                type="button"
                size="md"
                disabled={saving}
                onClick={() => handleSave(true)}
                className="w-full sm:w-auto gap-2 text-xs bg-zinc-900 text-white hover:bg-zinc-800 cursor-pointer shadow-xs"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                <span>Publish to Seeker</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
