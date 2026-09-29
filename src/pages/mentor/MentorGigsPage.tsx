import React, { Fragment, useState, useEffect, useCallback } from 'react';
import { useNavigation } from '@/src/context/NavigationContext';
import { Briefcase, Plus, Clock, Check, AlertCircle, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { Textarea } from '@/src/components/ui/Textarea';
import { Badge } from '@/src/components/ui/Badge';
import { Modal } from '@/src/components/ui/Modal';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { useAuth } from '@/src/context/AuthContext';
import { useToast } from '@/src/context/ToastContext';
import { toUserMessage } from '@/src/lib/errorMessages';
import { formatInr } from '@/src/lib/seekerFormat';
import { apiFetch } from '@/src/lib/apiClient';
import {
  fetchMentorGigTopics,
  fetchMentorTopics,
  saveMentorGigTopics,
  topicsForSegment,
  type MentorTopic,
} from '@/src/lib/mentorTopics';

interface Gig {
  id: string;
  title: string;
  segmentId: string;
  segmentName: string;
  segmentSlug: string;
  durationMinutes: number;
  priceInr: number;
  isActive: boolean;
  description: string;
}

interface SegmentOption {
  id: string;
  name: string;
  slug: string;
}

export const MentorGigsPage: React.FC = () => {
  const { user } = useAuth();
  const toast = useToast();
  const { navigate } = useNavigation();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [gigs, setGigs] = useState<Gig[]>([]);
  const [segments, setSegments] = useState<SegmentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [title, setTitle] = useState('');
  const [segmentId, setSegmentId] = useState('');
  const [duration, setDuration] = useState('60');
  const [price, setPrice] = useState('999');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // --- Gig topics -----------------------------------------------------------
  // Topics are real `segment_topics` rows belonging to the segments this
  // mentor is a member of. The editor for a gig only ever offers the topics of
  // THAT gig's segment, so a cross-segment topic cannot be selected here; the
  // server re-checks on save and the database trigger enforces it too.
  const [allTopics, setAllTopics] = useState<MentorTopic[]>([]);
  const [topicSelection, setTopicSelection] = useState<Record<string, string[]>>({});
  const [openTopicEditorFor, setOpenTopicEditorFor] = useState<string | null>(null);
  const [newGigTopicIds, setNewGigTopicIds] = useState<string[]>([]);
  const [savingTopicsFor, setSavingTopicsFor] = useState<string | null>(null);

  const fetchAllTopics = useCallback(async () => {
    const { topics } = await fetchMentorTopics();
    setAllTopics(topics);
  }, []);

  useEffect(() => {
    void fetchAllTopics();
  }, [fetchAllTopics]);

  /** Open a gig's topic editor, loading its current selection first. */
  const openTopicEditor = useCallback(async (gig: Gig) => {
    setOpenTopicEditorFor(gig.id);
    const ids = await fetchMentorGigTopics(gig.id);
    setTopicSelection((current) => ({ ...current, [gig.id]: ids }));
  }, []);

  const toggleTopic = useCallback((gigId: string, topicId: string) => {
    setTopicSelection((current) => {
      const existing = current[gigId] ?? [];
      const next = existing.includes(topicId)
        ? existing.filter((id) => id !== topicId)
        : [...existing, topicId];
      return { ...current, [gigId]: next };
    });
  }, []);

  const saveTopics = useCallback(
    async (gigId: string) => {
      setSavingTopicsFor(gigId);
      const { saved, error } = await saveMentorGigTopics(gigId, topicSelection[gigId] ?? []);
      setSavingTopicsFor(null);
      if (!saved) {
        toast.error(error?.message || 'Unable to save topics.');
        return;
      }
      toast.success('Topics updated.');
      setOpenTopicEditorFor(null);
    },
    [topicSelection, toast],
  );
  const fetchGigs = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/mentor/gigs?mentorId=${user.id}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to fetch gigs');
      setGigs(data.gigs || []);
    } catch (err: any) {
      setError(toUserMessage(err, 'Failed to load gigs'));
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  const fetchSegments = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await apiFetch(`/api/mentor/segments?mentorId=${user.id}`);
      const data = await res.json();
      if (data.success) {
        setSegments(data.segments.map((s: any) => ({ id: s.id, name: s.name, slug: s.slug })));
      }
    } catch (err: any) {
      console.error('Failed to fetch segments:', err);
    }
  }, [user?.id]);

  const fetchAvailableSegments = useCallback(async (): Promise<SegmentOption[]> => {
    if (!user?.id) return [];
    try {
      const res = await apiFetch(`/api/mentor/available-segments?mentorId=${user.id}`);
      const data = await res.json();
      if (data.success) return data.segments;
    } catch (err: any) {
      console.error('Failed to fetch available segments:', err);
    }
    return [];
  }, [user?.id]);

  useEffect(() => {
    fetchGigs();
    fetchSegments();
  }, [fetchGigs, fetchSegments]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id) return;
    setFormError('');
    setSubmitting(true);

    const durNum = parseInt(duration, 10);
    const priceNum = parseInt(price, 10);

    if (!title.trim()) {
      setFormError('Title is required.');
      setSubmitting(false);
      return;
    }
    if (!segmentId) {
      setFormError('Please select a segment.');
      setSubmitting(false);
      return;
    }
    if (isNaN(durNum) || durNum < 15 || durNum > 240) {
      setFormError('Duration must be a positive integer between 15 and 240 minutes.');
      setSubmitting(false);
      return;
    }
    if (isNaN(priceNum) || priceNum < 0) {
      setFormError('Price must be a non-negative integer (INR).');
      setSubmitting(false);
      return;
    }

    try {
      const res = await apiFetch('/api/mentor/gigs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          segmentId,
          durationMinutes: durNum,
          priceInr: priceNum,
          description,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to create gig');

      // Attach the topics the mentor selected. This is a separate call because
      // the gig id only exists once the gig is created; a failure here leaves
      // the gig published but untagged, which the mentor can fix and retry.
      if (data.gig?.id && newGigTopicIds.length > 0) {
        const { saved: topicsSaved } = await saveMentorGigTopics(data.gig.id, newGigTopicIds);
        if (!topicsSaved) {
          toast.error(
            'The gig was created, but its topics could not be saved. Edit the gig to try again.'
          );
        }
      }

      // Refresh gigs
      await fetchGigs();

      // Reset form
      setTitle('');
      setSegmentId('');
      setDuration('60');
      setPrice('999');
      setDescription('');
      setNewGigTopicIds([]);
      setIsCreateOpen(false);
      toast.success('Gig published successfully.');
    } catch (err: any) {
      setFormError(toUserMessage(err, 'Failed to create gig'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (gig: Gig) => {
    if (!user?.id) return;
    const nextActive = !gig.isActive;
    try {
      const res = await apiFetch(`/api/mentor/gigs/${gig.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: nextActive }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to update gig');
      await fetchGigs();
      toast.success(`Gig ${nextActive ? 'activated' : 'paused'}.`);
    } catch (err: any) {
      toast.error(toUserMessage(err, 'Failed to update gig'));
    }
  };

  const handleDelete = async (gigId: string) => {
    if (!user?.id) return;
    if (!confirm('Are you sure you want to delete this gig?')) return;
    try {
      const res = await apiFetch(`/api/mentor/gigs/${gigId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to delete gig');
      await fetchGigs();
      toast.success('Gig deleted.');
    } catch (err: any) {
      toast.error(toUserMessage(err, 'Failed to delete gig'));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">
            My Gigs
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Manage your active session offerings. Only approved segments can have gigs published.
          </p>
        </div>

        <Button
          onClick={() => setIsCreateOpen(true)}
          size="md"
          className="gap-1.5 text-xs self-start"
        >
          <Plus className="h-4 w-4" />
          <span>Create Gig</span>
        </Button>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3.5 text-xs text-zinc-600 flex items-start gap-2.5">
        <AlertCircle className="h-4 w-4 text-zinc-500 shrink-0 mt-0.5" />
        <span>
          <strong>Approval Gate:</strong> You can only create gigs in segments where your mentor status is <strong className="font-semibold text-zinc-900">APPROVED</strong>.
        </span>
      </div>

      {/* Gigs Table */}
      <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden shadow-xs">
        {loading ? (
          <div className="p-8 text-center">
            <Loader2 className="h-8 w-8 text-zinc-400 mx-auto animate-spin" />
            <p className="mt-2 text-xs text-zinc-500">Loading gigs...</p>
          </div>
        ) : error ? (
          <div className="p-6 text-center text-rose-600">
            <AlertCircle className="h-6 w-6 mx-auto mb-2" />
            <p className="text-xs">{error}</p>
            <Button variant="outline" size="sm" onClick={fetchGigs} className="mt-2">
              Retry
            </Button>
          </div>
        ) : gigs.length === 0 ? (
          <EmptyState
            icon={Briefcase}
            title="No Gigs Created Yet"
            description="Create your first gig to start accepting bookings."
            actionLabel="Create Gig"
            onAction={() => setIsCreateOpen(true)}
          />
        ) : (
          <div className="table-scroll">
          <table className="w-full text-left text-xs text-zinc-600">
            <thead className="bg-zinc-50/70 border-b border-zinc-200 text-zinc-900 font-semibold uppercase tracking-wider text-[11px]">
              <tr>
                <th className="py-3 px-4">Gig Title</th>
                <th className="py-3 px-4">Segment</th>
                <th className="py-3 px-4">Duration</th>
                <th className="py-3 px-4">Price</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {gigs.map((gig) => (
                <Fragment key={gig.id}>
                <tr className="hover:bg-zinc-50/50 transition-colors">
                  <td className="py-3 px-4 font-medium text-zinc-900">{gig.title}</td>
                  <td className="py-3 px-4">
                    <Badge variant="secondary" className="text-[10px]">{gig.segmentName}</Badge>
                  </td>
                  <td className="py-3 px-4">
                    <Clock className="h-3.5 w-3.5 inline-block mr-1 text-zinc-400" />
                    {gig.durationMinutes} min
                  </td>
                  <td className="py-3 px-4 font-bold text-zinc-950">{formatInr(gig.priceInr)}</td>
                  <td className="py-3 px-4">
                    <Badge variant={gig.isActive ? 'success' : 'secondary'} className="text-[10px]">
                      {gig.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-7 py-1 gap-1"
                        onClick={() => (openTopicEditorFor === gig.id ? setOpenTopicEditorFor(null) : openTopicEditor(gig))}
                        aria-expanded={openTopicEditorFor === gig.id}
                      >
                        <Briefcase className="h-3.5 w-3.5" />
                        <span>Topics</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-7 py-1 gap-1"
                        onClick={() => handleToggleActive(gig)}
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>{gig.isActive ? 'Deactivate' : 'Activate'}</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-7 py-1 gap-1 text-rose-700 border-rose-200 hover:bg-rose-50"
                        onClick={() => handleDelete(gig.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Delete</span>
                      </Button>
                    </div>
                  </td>
                </tr>
                {openTopicEditorFor === gig.id && (
                  <tr>
                    <td colSpan={6} className="border-t border-zinc-100 bg-zinc-50/60 px-4 py-4">
                      {(() => {
                        const options = topicsForSegment(allTopics, gig.segmentId);
                        const selected = topicSelection[gig.id] ?? [];
                        return (
                          <div className="space-y-3">
                            <p className="text-[11px] font-semibold text-zinc-700">
                              Which {gig.segmentName} topics does this gig cover?
                            </p>
                            {options.length === 0 ? (
                              <p className="text-[11px] text-zinc-500">
                                This segment has no active topics yet, so there is nothing to
                                select. A Suggest Key admin adds them from the segment CMS.
                              </p>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {options.map((topic) => {
                                  const isSelected = selected.includes(topic.id);
                                  return (
                                    <button
                                      key={topic.id}
                                      type="button"
                                      aria-pressed={isSelected}
                                      onClick={() => toggleTopic(gig.id, topic.id)}
                                      className={isSelected
                                        ? "min-h-[36px] rounded-full border border-zinc-900 bg-zinc-900 px-3 py-1.5 text-[11px] font-semibold text-white"
                                        : "min-h-[36px] rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-zinc-700 hover:border-zinc-400"
                                      }
                                    >
                                      {topic.name}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                onClick={() => saveTopics(gig.id)}
                                disabled={savingTopicsFor === gig.id}
                              >
                                {savingTopicsFor === gig.id && (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                )}
                                <span>Save topics</span>
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setOpenTopicEditorFor(null)}
                              >
                                <span>Cancel</span>
                              </Button>
                            </div>
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* Create Gig Modal */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => {
          setIsCreateOpen(false);
          setFormError('');
        }}
        title="Create New Gig"
        description="Define a new session offering in an approved segment."
      >
        <form onSubmit={handleCreate} className="space-y-4 pt-2">
          <Input
            label="Gig Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. 1:1 Relationship Guidance Session"
            error={formError}
          />

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-zinc-700">Segment</label>
            <select
              value={segmentId}
              onChange={(e) => setSegmentId(e.target.value)}
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900"
              disabled={segments.length === 0}
            >
              <option value="">Select an approved segment...</option>
              {segments.map((seg) => (
                <option key={seg.id} value={seg.id}>{seg.name}</option>
              ))}
              {segments.length === 0 && <option value="">No approved segments available</option>}
            </select>
            {segments.length === 0 && (
              <p className="text-[11px] text-amber-700">
                You have no approved segments.{' '}
                <button
                  type="button"
                  className="font-semibold underline underline-offset-2"
                  onClick={() => { setIsCreateOpen(false); navigate('/mentor/segments'); }}
                >
                  Apply for a segment
                </button>{' '}
                first.
              </p>
            )}
          </div>

          {/* Topics for the new gig. Only the topics of the selected segment are
              offered, so a cross-segment topic cannot be chosen here at all. The
              server checks ownership again when the selection is saved. */}
          {segmentId && (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-zinc-700">
                Topics this gig covers
              </label>
              {(() => {
                const options = topicsForSegment(allTopics, segmentId);
                if (options.length === 0) {
                  return (
                    <p className="text-[11px] text-zinc-500">
                      This segment has no active topics yet. You can still publish the gig and
                      add topics once an admin creates them.
                    </p>
                  );
                }
                return (
                  <div className="flex flex-wrap gap-2">
                    {options.map((topic) => {
                      const isSelected = newGigTopicIds.includes(topic.id);
                      return (
                        <button
                          key={topic.id}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() =>
                            setNewGigTopicIds((current) =>
                              current.includes(topic.id)
                                ? current.filter((id) => id !== topic.id)
                                : [...current, topic.id],
                            )
                          }
                          className={isSelected
                            ? 'min-h-[36px] rounded-full border border-zinc-900 bg-zinc-900 px-3 py-1.5 text-[11px] font-semibold text-white'
                            : 'min-h-[36px] rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-zinc-700 hover:border-zinc-400'}
                        >
                          {topic.name}
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Duration (minutes)"
              type="number"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="60"
              min={15}
              max={240}
            />
            <Input
              label="Price (INR)"
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="999"
              min={0}
            />
          </div>

          <Textarea
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what this session covers..."
            rows={3}
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" type="button" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              type="submit"
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Creating...</span>
                </>
              ) : (
                'Create Gig'
              )}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};