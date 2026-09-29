/**
 * ADMIN TOPIC MANAGEMENT.
 *
 * Add, edit, reorder, deactivate and safely delete the topics behind the
 * seeker topic bar. Every operation goes through the real endpoints, so a
 * change here reaches open seeker pages over Supabase Realtime with no
 * deployment.
 *
 * Two rules the UI enforces visibly, both backed by the database:
 *
 *  * USAGE IS SHOWN BEFORE A DELETE. The server refuses a delete with 409
 *    while a gig still references the topic, so the button is disabled and the
 *    reason is stated, rather than letting an admin discover it by clicking.
 *  * DEACTIVATION IS THE SAFE RETIREMENT. It hides the chip without touching a
 *    single gig, which is why it is offered alongside delete.
 *
 * The list is re-fetched after every mutation rather than optimistically
 * patched, because the server owns the resulting slug and priority.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import {
  createSegmentTopic,
  deleteSegmentTopic,
  fetchAdminSegmentTopics,
  updateSegmentTopic,
  type AdminSegmentTopic,
} from '@/src/lib/segmentTopics';
import { slugifyTopicName } from '@/src/lib/topicSlug';
import { cn } from '@/src/lib/utils';

export interface AdminSegmentTopicManagerProps {
  segmentId: string;
  /** Notified after every change so a preview can re-render with live data. */
  onTopicsChanged?: () => void;
  className?: string;
}

interface Draft {
  id: string | null;
  name: string;
  description: string;
}

const EMPTY_DRAFT: Draft = { id: null, name: '', description: '' };

export const AdminSegmentTopicManager: React.FC<AdminSegmentTopicManagerProps> = ({
  segmentId,
  onTopicsChanged,
  className,
}) => {
  const [topics, setTopics] = useState<AdminSegmentTopic[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState<boolean>(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { topics: rows, error: fetchError } = await fetchAdminSegmentTopics(segmentId);
      if (fetchError) throw fetchError;
      setTopics(rows);
    } catch (err: any) {
      setError(err?.message || 'Unable to load topics.');
      setTopics([]);
    } finally {
      setIsLoading(false);
    }
  }, [segmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(
    () => [...topics].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name)),
    [topics],
  );

  const handleSaveDraft = async () => {
    if (!draft || !draft.name.trim()) {
      setDraftError('A topic needs a name.');
      return;
    }
    setIsSavingDraft(true);
    setDraftError(null);

    const { error: saveError } = draft.id
      ? await updateSegmentTopic(segmentId, draft.id, {
          name: draft.name.trim(),
          description: draft.description.trim(),
        })
      : await createSegmentTopic(segmentId, {
          name: draft.name.trim(),
          description: draft.description.trim() || undefined,
        });

    setIsSavingDraft(false);
    if (saveError) {
      setDraftError(saveError.message);
      return;
    }
    setDraft(null);
    await load();
    onTopicsChanged?.();
  };

  const handleToggle = async (topic: AdminSegmentTopic) => {
    setBusyId(topic.id);
    setError(null);
    const { error: toggleError } = await updateSegmentTopic(segmentId, topic.id, {
      isActive: !topic.is_active,
    });
    setBusyId(null);
    if (toggleError) {
      setError(toggleError.message);
      return;
    }
    await load();
    onTopicsChanged?.();
  };

  /**
   * Move a topic one place. Priorities are steps of 10, so swapping two
   * adjacent values is a genuine reorder rather than a reindex of everything.
   */
  const handleMove = async (topic: AdminSegmentTopic, direction: -1 | 1) => {
    const index = sorted.findIndex((t) => t.id === topic.id);
    const swapWith = sorted[index + direction];
    if (!swapWith) return;

    setBusyId(topic.id);
    setError(null);
    // Two writes, then a reload: the display order is only correct once both
    // rows have swapped, and the reload is what proves it.
    const first = await updateSegmentTopic(segmentId, topic.id, { priority: swapWith.priority });
    if (first.error) {
      setBusyId(null);
      setError(first.error.message);
      return;
    }
    const second = await updateSegmentTopic(segmentId, swapWith.id, { priority: topic.priority });
    setBusyId(null);
    if (second.error) {
      setError(second.error.message);
      await load();
      return;
    }
    await load();
    onTopicsChanged?.();
  };

  const handleDelete = async (topic: AdminSegmentTopic) => {
    if (topic.gig_count > 0) {
      setError(
        `"${topic.name}" is used by ${topic.gig_count} gig${
          topic.gig_count === 1 ? '' : 's'
        }. Deactivate it instead so those gigs keep their topic.`,
      );
      return;
    }
    setBusyId(topic.id);
    setError(null);
    const { deleted, error: deleteError } = await deleteSegmentTopic(segmentId, topic.id);
    setBusyId(null);
    if (!deleted) {
      setError(deleteError?.message || 'Unable to delete the topic.');
      return;
    }
    await load();
    onTopicsChanged?.();
  };

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">Topics</h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            These are the chips a seeker sees, in this order. Adding one needs no deployment.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setDraft({ ...EMPTY_DRAFT });
            setDraftError(null);
          }}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add topic
        </Button>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <span className="flex items-center gap-2 font-semibold">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-xs font-semibold underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {draft && (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-600">
            {draft.id ? 'Edit topic' : 'New topic'}
          </p>
          <div className="mt-3 space-y-3">
            <Input
              label="Name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Salary negotiation"
            />
            {draft.name.trim() && (
              <p className="text-[11px] text-zinc-500">
                Link: <code className="rounded bg-white px-1 py-0.5">/{slugifyTopicName(draft.name)}</code>
              </p>
            )}
            <Input
              label="Description (optional)"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="Shown under the chip when it is selected."
            />
          </div>
          {draftError && (
            <p className="mt-2 text-xs font-medium text-red-600" role="alert">
              {draftError}
            </p>
          )}
          <div className="mt-4 flex gap-2">
            <Button size="sm" onClick={handleSaveDraft} disabled={isSavingDraft}>
              {isSavingDraft ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {draft.id ? 'Save topic' : 'Create topic'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Cancel
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="flex items-center gap-2 py-4 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading topics...
        </p>
      ) : sorted.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-500">
          No topics yet. Add the first one — it appears on the seeker page immediately.
        </p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((topic, index) => {
            const isBusy = busyId === topic.id;
            return (
              <li
                key={topic.id}
                className={cn(
                  'flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3.5 py-3',
                  !topic.is_active && 'opacity-60',
                )}
              >
                <span className="w-6 shrink-0 text-center text-[11px] font-semibold text-zinc-400">
                  {index + 1}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-zinc-900">{topic.name}</p>
                    {!topic.is_active && (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                        Inactive
                      </span>
                    )}
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                        topic.gig_count > 0
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-zinc-100 text-zinc-500',
                      )}
                      title="Gigs currently tagged with this topic"
                    >
                      {topic.gig_count} {topic.gig_count === 1 ? 'gig' : 'gigs'}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                    <code>{topic.slug}</code>
                    {topic.description ? ` — ${topic.description}` : ''}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleMove(topic, -1)}
                    disabled={isBusy || index === 0}
                    aria-label={`Move ${topic.name} up`}
                    className="min-h-[36px] min-w-[36px] rounded-lg border border-zinc-200 p-2 text-zinc-600 disabled:opacity-40 hover:bg-zinc-50"
                  >
                    <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMove(topic, 1)}
                    disabled={isBusy || index === sorted.length - 1}
                    aria-label={`Move ${topic.name} down`}
                    className="min-h-[36px] min-w-[36px] rounded-lg border border-zinc-200 p-2 text-zinc-600 disabled:opacity-40 hover:bg-zinc-50"
                  >
                    <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft({
                        id: topic.id,
                        name: topic.name,
                        description: topic.description ?? '',
                      });
                      setDraftError(null);
                    }}
                    disabled={isBusy}
                    aria-label={`Edit ${topic.name}`}
                    className="min-h-[36px] min-w-[36px] rounded-lg border border-zinc-200 p-2 text-zinc-600 hover:bg-zinc-50"
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggle(topic)}
                    disabled={isBusy}
                    className="min-h-[36px] rounded-lg border border-zinc-200 px-2.5 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-50"
                  >
                    {topic.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(topic)}
                    disabled={isBusy || topic.gig_count > 0}
                    title={
                      topic.gig_count > 0
                        ? 'Used by a gig. Deactivate it instead of deleting.'
                        : 'Delete this topic'
                    }
                    aria-label={`Delete ${topic.name}`}
                    className="min-h-[36px] min-w-[36px] rounded-lg border border-red-200 p-2 text-red-600 disabled:opacity-40 hover:bg-red-50"
                  >
                    {isBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default AdminSegmentTopicManager;