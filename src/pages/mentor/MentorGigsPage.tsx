import React, { useState, useEffect, useCallback } from 'react';
import { Briefcase, Plus, Clock, IndianRupee, Check, AlertCircle, Edit, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { Textarea } from '@/src/components/ui/Textarea';
import { Badge } from '@/src/components/ui/Badge';
import { Modal } from '@/src/components/ui/Modal';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { useAuth } from '@/src/context/AuthContext';
import { apiFetch } from '@/src/lib/apiClient';

interface Gig {
  id: string;
  title: string;
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
      setError(err.message || 'Failed to load gigs');
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

      // Refresh gigs
      await fetchGigs();

      // Reset form
      setTitle('');
      setSegmentId('');
      setDuration('60');
      setPrice('999');
      setDescription('');
      setIsCreateOpen(false);
    } catch (err: any) {
      setFormError(err.message || 'Failed to create gig');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (gig: Gig) => {
    if (!user?.id) return;
    try {
      const res = await apiFetch(`/api/mentor/gigs/${gig.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !gig.isActive }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to update gig');
      await fetchGigs();
    } catch (err: any) {
      console.error('Failed to toggle gig:', err);
      alert('Failed to update gig: ' + err.message);
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
    } catch (err: any) {
      console.error('Failed to delete gig:', err);
      alert('Failed to delete gig: ' + err.message);
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
                <tr key={gig.id} className="hover:bg-zinc-50/50 transition-colors">
                  <td className="py-3 px-4 font-medium text-zinc-900">{gig.title}</td>
                  <td className="py-3 px-4">
                    <Badge variant="secondary" className="text-[10px]">{gig.segmentName}</Badge>
                  </td>
                  <td className="py-3 px-4">
                    <Clock className="h-3.5 w-3.5 inline-block mr-1 text-zinc-400" />
                    {gig.durationMinutes} min
                  </td>
                  <td className="py-3 px-4 font-bold text-zinc-950">₹{gig.priceInr}</td>
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
              ))}
            </tbody>
          </table>
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
                You have no approved segments. <Button variant="ghost" size="sm" className="p-0 h-auto text-[11px]" onClick={() => { setIsCreateOpen(false); }}>Apply for a segment first</Button>.
              </p>
            )}
          </div>

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