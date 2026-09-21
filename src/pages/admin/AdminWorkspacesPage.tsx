import React, { useState, useEffect } from 'react';
import {
  FileText,
  Search,
  Filter,
  Eye,
  CheckCircle2,
  Clock,
  Sparkles,
  AlertCircle,
  RefreshCw,
  Edit3,
  Calendar,
  User,
  Target,
  Lightbulb,
  ArrowRight,
  ShieldCheck,
  Save,
  Loader2,
} from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { Modal } from '@/src/components/ui/Modal';
import { useAuth } from '@/src/context/AuthContext';
import {
  fetchAdminWorkspacesAuthoritative,
  saveWorkspaceAuthoritative,
} from '@/src/lib/workspaceService';
import { SessionWorkspace } from '@/src/types/database';

export const AdminWorkspacesPage: React.FC = () => {
  const { user } = useAuth();
  const adminId = user?.id || 'usr-8800';

  const [workspaces, setWorkspaces] = useState<SessionWorkspace[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PUBLISHED' | 'PENDING'>('ALL');

  // Inspection & Moderation Modal
  const [selectedWorkspace, setSelectedWorkspace] = useState<SessionWorkspace | null>(null);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editNotes, setEditNotes] = useState<string>('');
  const [savingEdit, setSavingEdit] = useState<boolean>(false);
  const [modalFeedback, setModalFeedback] = useState<string | null>(null);

  const loadWorkspaces = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminWorkspacesAuthoritative();
      setWorkspaces(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch operational workspaces.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWorkspaces();
  }, []);

  const openAuditModal = (ws: SessionWorkspace) => {
    setSelectedWorkspace(ws);
    setEditNotes(ws.mentor_notes || ws.summary || '');
    setIsEditing(false);
    setModalFeedback(null);
  };

  const handleAdminSaveNotes = async () => {
    if (!selectedWorkspace) return;

    setSavingEdit(true);
    setModalFeedback(null);

    try {
      const res = await saveWorkspaceAuthoritative(
        {
          booking_id: selectedWorkspace.booking_id,
          mentor_id: selectedWorkspace.mentor_id,
          mentor_notes: editNotes.trim(),
          takeaways: selectedWorkspace.takeaways || [],
          suggestions: selectedWorkspace.suggestions || [],
          next_steps: selectedWorkspace.next_steps || [],
          follow_up_recommendation: selectedWorkspace.follow_up_recommendation,
          publish: selectedWorkspace.status === 'PUBLISHED',
        },
        adminId,
        'admin'
      );

      if (res.success && res.workspace) {
        setSelectedWorkspace(res.workspace);
        setIsEditing(false);
        setModalFeedback('Operational update applied successfully.');
        loadWorkspaces();
      } else {
        setModalFeedback(res.error?.message || 'Failed to apply update.');
      }
    } catch (err: any) {
      setModalFeedback(err.message || 'Network error applying update.');
    } finally {
      setSavingEdit(false);
    }
  };

  // Filtered list
  const filteredWorkspaces = workspaces.filter((ws) => {
    if (statusFilter !== 'ALL' && ws.status !== statusFilter) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const code = ws.session_overview?.bookingCode?.toLowerCase() || '';
      const mentor = ws.session_overview?.mentorName?.toLowerCase() || '';
      const seeker = ws.session_overview?.seekerName?.toLowerCase() || '';
      const topic = ws.session_overview?.gigTitle?.toLowerCase() || '';
      return code.includes(q) || mentor.includes(q) || seeker.includes(q) || topic.includes(q);
    }

    return true;
  });

  // Metrics
  const totalCount = workspaces.length;
  const publishedCount = workspaces.filter((w) => w.status === 'PUBLISHED').length;
  const pendingCount = workspaces.filter((w) => w.status === 'PENDING').length;
  const followUpCount = workspaces.filter((w) => w.follow_up_recommendation?.recommended).length;

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-200 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">
              Session Workspaces Ledger
            </h1>
            <Badge variant="secondary" className="gap-1 text-xs">
              <ShieldCheck className="h-3.5 w-3.5 text-zinc-600" />
              <span>Admin Operations</span>
            </Badge>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Authoritative platform oversight of post-session takeaways, action deliverables, and mentor recommendations.
          </p>
        </div>

        <Button
          onClick={loadWorkspaces}
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs self-start sm:self-auto cursor-pointer"
        >
          <RefreshCw className="h-3.5 w-3.5 text-zinc-500" />
          <span>Refresh</span>
        </Button>
      </div>

      {/* Metrics Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-xs">
          <span className="text-zinc-500 text-xs block">Total Workspaces</span>
          <span className="text-2xl font-bold text-zinc-950 mt-1 block">{totalCount}</span>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-xs">
          <span className="text-zinc-500 text-xs block">Published to Seeker</span>
          <span className="text-2xl font-bold text-emerald-700 mt-1 block">{publishedCount}</span>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-xs">
          <span className="text-zinc-500 text-xs block">Draft / In Preparation</span>
          <span className="text-2xl font-bold text-amber-700 mt-1 block">{pendingCount}</span>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-xs">
          <span className="text-zinc-500 text-xs block">Follow-ups Advised</span>
          <span className="text-2xl font-bold text-blue-700 mt-1 block">{followUpCount}</span>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
          <input
            type="text"
            placeholder="Search by code, mentor, seeker, or topic..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 bg-white pl-9 pr-3 py-1.5 text-xs text-zinc-900 focus:border-zinc-900 focus:outline-hidden"
          />
        </div>

        <div className="flex items-center gap-1 bg-zinc-100 p-1 rounded-lg text-xs self-start sm:self-auto">
          {(['ALL', 'PUBLISHED', 'PENDING'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setStatusFilter(tab)}
              className={`px-3 py-1 rounded-md font-medium text-xs transition-colors cursor-pointer ${
                statusFilter === tab
                  ? 'bg-white text-zinc-950 font-bold shadow-xs'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Main Table */}
      {loading ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-12 text-center space-y-3 shadow-xs">
          <Loader2 className="h-8 w-8 text-zinc-400 mx-auto animate-spin" />
          <h3 className="text-sm font-semibold text-zinc-900">Loading Operational Ledger...</h3>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center space-y-2">
          <AlertCircle className="h-6 w-6 text-rose-600 mx-auto" />
          <p className="text-xs text-rose-900">{error}</p>
          <Button size="sm" variant="outline" onClick={loadWorkspaces} className="text-xs">
            Retry
          </Button>
        </div>
      ) : filteredWorkspaces.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-12 text-center space-y-2">
          <FileText className="h-8 w-8 text-zinc-400 mx-auto" />
          <h3 className="text-sm font-semibold text-zinc-900">No Workspaces Found</h3>
          <p className="text-xs text-zinc-500">No session workspace records match the active criteria.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xs">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-zinc-200 bg-zinc-50/70 text-[11px] font-semibold text-zinc-600 uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Booking Code</th>
                <th className="py-3 px-4">Topic / Gig</th>
                <th className="py-3 px-4">Mentor</th>
                <th className="py-3 px-4">Seeker</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Follow-up</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 text-zinc-800">
              {filteredWorkspaces.map((ws) => (
                <tr key={ws.id} className="hover:bg-zinc-50/60 transition-colors">
                  <td className="py-3 px-4 font-mono font-medium text-zinc-900">
                    {ws.session_overview?.bookingCode || ws.booking_id}
                  </td>
                  <td className="py-3 px-4">
                    <span className="font-semibold text-zinc-900 block truncate max-w-[200px]">
                      {ws.session_overview?.gigTitle || 'Consultation'}
                    </span>
                    <span className="text-[11px] text-zinc-400">
                      {ws.session_overview?.segmentTitle}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-medium text-zinc-900">
                    {ws.session_overview?.mentorName || ws.mentor_id}
                  </td>
                  <td className="py-3 px-4 text-zinc-700">
                    {ws.session_overview?.seekerName || ws.seeker_id}
                  </td>
                  <td className="py-3 px-4">
                    <Badge variant={ws.status === 'PUBLISHED' ? 'success' : 'secondary'} className="text-[10px]">
                      {ws.status}
                    </Badge>
                  </td>
                  <td className="py-3 px-4">
                    {ws.follow_up_recommendation?.recommended ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700">
                        <Sparkles className="h-3 w-3" />
                        {ws.follow_up_recommendation.timeframe}
                      </span>
                    ) : (
                      <span className="text-zinc-400 text-[11px]">None</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <Button
                      onClick={() => openAuditModal(ws)}
                      size="sm"
                      variant="outline"
                      className="gap-1 text-xs cursor-pointer"
                    >
                      <Eye className="h-3.5 w-3.5 text-zinc-500" />
                      <span>Audit</span>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Operational Inspection Modal */}
      {selectedWorkspace && (
        <Modal
          isOpen={!!selectedWorkspace}
          onClose={() => setSelectedWorkspace(null)}
          title={`Workspace Audit: ${selectedWorkspace.session_overview?.bookingCode || selectedWorkspace.booking_id}`}
        >
          <div className="space-y-5 max-h-[75vh] overflow-y-auto pr-1">
            {/* Feedback notification in modal */}
            {modalFeedback && (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-900 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>{modalFeedback}</span>
              </div>
            )}

            {/* Section 1: Session Overview */}
            <div className="rounded-lg bg-zinc-50 p-3.5 border border-zinc-200 space-y-2">
              <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider block">
                Session Overview & Identity
              </span>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-zinc-400 block text-[10px]">Mentor</span>
                  <span className="font-semibold text-zinc-900">
                    {selectedWorkspace.session_overview?.mentorName}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-400 block text-[10px]">Seeker</span>
                  <span className="font-semibold text-zinc-900">
                    {selectedWorkspace.session_overview?.seekerName}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-400 block text-[10px]">Segment</span>
                  <span className="text-zinc-800">{selectedWorkspace.session_overview?.segmentTitle}</span>
                </div>
                <div>
                  <span className="text-zinc-400 block text-[10px]">Topic</span>
                  <span className="text-zinc-800">{selectedWorkspace.session_overview?.gigTitle}</span>
                </div>
              </div>
            </div>

            {/* Section 2: Mentor Notes */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-900 flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-zinc-500" />
                  Mentor Notes
                </span>
                <button
                  onClick={() => setIsEditing(!isEditing)}
                  className="text-xs text-blue-700 hover:text-blue-900 font-semibold cursor-pointer flex items-center gap-1"
                >
                  <Edit3 className="h-3 w-3" />
                  <span>{isEditing ? 'Cancel Edit' : 'Edit Notes'}</span>
                </button>
              </div>

              {isEditing ? (
                <div className="space-y-2">
                  <textarea
                    rows={4}
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    className="w-full rounded-lg border border-zinc-300 p-2.5 text-xs text-zinc-900 focus:border-zinc-900 focus:outline-hidden"
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      disabled={savingEdit}
                      onClick={handleAdminSaveNotes}
                      className="gap-1.5 text-xs bg-zinc-900 text-white cursor-pointer"
                    >
                      {savingEdit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      <span>Save Operational Changes</span>
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-zinc-700 bg-white p-3 rounded-lg border border-zinc-200 leading-relaxed whitespace-pre-line">
                  {selectedWorkspace.mentor_notes || selectedWorkspace.summary || 'No notes written.'}
                </p>
              )}
            </div>

            {/* Section 3: Takeaways */}
            <div className="space-y-1.5">
              <span className="text-xs font-bold text-zinc-900 flex items-center gap-1.5">
                <Target className="h-3.5 w-3.5 text-emerald-600" />
                Key Takeaways ({selectedWorkspace.takeaways?.length || 0})
              </span>
              <ul className="space-y-1.5 text-xs text-zinc-700">
                {selectedWorkspace.takeaways?.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2 bg-zinc-50 p-2 rounded-md">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                )) || <li className="text-zinc-400 italic">None</li>}
              </ul>
            </div>

            {/* Section 4: Suggestions */}
            <div className="space-y-1.5">
              <span className="text-xs font-bold text-zinc-900 flex items-center gap-1.5">
                <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
                Suggestions ({selectedWorkspace.suggestions?.length || 0})
              </span>
              <ul className="space-y-1.5 text-xs text-zinc-700">
                {selectedWorkspace.suggestions?.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2 bg-zinc-50 p-2 rounded-md">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0 mt-1.5" />
                    <span>{item}</span>
                  </li>
                )) || <li className="text-zinc-400 italic">None</li>}
              </ul>
            </div>

            {/* Section 5: Next Steps */}
            <div className="space-y-1.5">
              <span className="text-xs font-bold text-zinc-900 flex items-center gap-1.5">
                <ArrowRight className="h-3.5 w-3.5 text-zinc-700" />
                Next Steps ({selectedWorkspace.next_steps?.length || 0})
              </span>
              <div className="space-y-1 text-xs">
                {selectedWorkspace.next_steps?.map((step) => (
                  <div key={step.id} className="p-2 bg-zinc-50 rounded-md flex items-center justify-between">
                    <span className="text-zinc-800">{step.text}</span>
                    {step.due_date && <Badge variant="secondary" className="text-[10px]">{step.due_date}</Badge>}
                  </div>
                )) || <p className="text-zinc-400 italic">None</p>}
              </div>
            </div>

            {/* Section 6: Follow-up */}
            {selectedWorkspace.follow_up_recommendation?.recommended && (
              <div className="rounded-lg bg-blue-50/60 p-3.5 border border-blue-100 text-xs space-y-1 text-blue-900">
                <div className="flex items-center gap-1.5 font-bold">
                  <Sparkles className="h-3.5 w-3.5 text-blue-600" />
                  <span>Follow-up Advised: {selectedWorkspace.follow_up_recommendation.timeframe}</span>
                </div>
                {selectedWorkspace.follow_up_recommendation.topic && (
                  <p><strong>Topic:</strong> {selectedWorkspace.follow_up_recommendation.topic}</p>
                )}
                {selectedWorkspace.follow_up_recommendation.notes && (
                  <p className="italic text-blue-800">"{selectedWorkspace.follow_up_recommendation.notes}"</p>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};
