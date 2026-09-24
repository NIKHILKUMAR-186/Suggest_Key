import React, { useState, useEffect, useCallback } from 'react';
import { Layers, Plus, ArrowUpDown, Check, AlertCircle, Edit, Trash2, Loader2, Save } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { Badge } from '@/src/components/ui/Badge';
import { Modal } from '@/src/components/ui/Modal';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { apiFetch } from '@/src/lib/apiClient';

interface Segment {
  id: string;
  name: string;
  slug: string;
  priority: number;
  isActive: boolean;
  createdAt: string;
  mentorsCount: number;
  description: string | null;
  updatedAt: string;
}

interface ApiSegment {
  id: string;
  name: string;
  slug: string;
  priority: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  description: string | null;
  mentorsCount: number;
}

export const AdminSegmentsPage: React.FC = () => {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [priority, setPriority] = useState('4');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchSegments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/admin/segments');
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to fetch segments');
      setSegments((data.segments || []).map((s: ApiSegment) => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        priority: s.priority,
        isActive: s.is_active,
        createdAt: s.created_at ? new Date(s.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Unknown',
        mentorsCount: s.mentorsCount,
        description: s.description,
        updatedAt: s.updated_at,
      })));
    } catch (err: any) {
      setError(err.message || 'Failed to load segments');
      console.error('Failed to fetch segments:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSegments();
  }, [fetchSegments]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) return;

    setCreating(true);
    try {
      const res = await apiFetch('/api/admin/segments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim().toLowerCase().replace(/\s+/g, '-'),
          priority: parseInt(priority, 10) || 10,
          isActive: true,
          description: description.trim() || null,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to create segment');
      setIsCreateOpen(false);
      setName('');
      setSlug('');
      setPriority('4');
      setDescription('');
      await fetchSegments();
    } catch (err: any) {
      console.error('Failed to create segment:', err);
      alert('Failed to create segment: ' + err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (id: string, currentActive: boolean) => {
    try {
      const res = await apiFetch(`/api/admin/segments/${id}/toggle-active`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !currentActive }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to toggle segment');
      await fetchSegments();
    } catch (err: any) {
      console.error('Failed to toggle segment:', err);
      alert('Failed to update segment: ' + err.message);
    }
  };

  const sortedSegments = [...segments].sort((a, b) => a.priority - b.priority);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">
            Mentorship Segments
          </h1>
          <p className="mt-1 text-xs text-zinc-500">
            Define platform specializations, ordering priority, and active publication status.
          </p>
        </div>

        <Button
          onClick={() => setIsCreateOpen(true)}
          size="md"
          className="gap-1.5 text-xs self-start"
        >
          <Plus className="h-4 w-4" />
          <span>Add Segment</span>
        </Button>
      </div>

      {/* Priority rule notice */}
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600 flex items-start gap-2">
        <ArrowUpDown className="h-4 w-4 text-zinc-500 shrink-0 mt-0.5" />
        <span>
          <strong>Priority Invariant:</strong> The segment with the lowest priority integer (Priority 1) is automatically auto-selected by default on the Seeker discovery home screen.
        </span>
      </div>

      {/* Segments Table */}
      <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden shadow-xs">
        {loading ? (
          <div className="p-8 text-center">
            <Loader2 className="h-8 w-8 text-zinc-400 mx-auto animate-spin" />
            <p className="mt-2 text-xs text-zinc-500">Loading segments...</p>
          </div>
        ) : error ? (
          <div className="p-6 text-center text-rose-600">
            <AlertCircle className="h-6 w-6 mx-auto mb-2" />
            <p className="text-xs">{error}</p>
            <Button variant="outline" size="sm" onClick={fetchSegments} className="mt-2">
              Retry
            </Button>
          </div>
        ) : sortedSegments.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="No Segments Found"
            description="No segment records found in the system."
          />
        ) : (
          <table className="w-full text-left text-xs text-zinc-600">
            <thead className="bg-zinc-50/70 border-b border-zinc-200 text-zinc-900 font-semibold uppercase tracking-wider text-[11px]">
              <tr>
                <th className="py-3 px-4">Priority</th>
                <th className="py-3 px-4">Segment Name</th>
                <th className="py-3 px-4">URL Slug</th>
                <th className="py-3 px-4">Approved Mentors</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {sortedSegments.map((seg) => (
                <tr key={seg.id} className="hover:bg-zinc-50/50 transition-colors">
                  <td className="py-3 px-4 font-mono font-bold text-zinc-900">
                    #{seg.priority}
                  </td>
                  <td className="py-3 px-4">
                    <span className="font-bold text-zinc-950">{seg.name}</span>
                    {seg.priority === 1 && (
                      <span className="ml-2 text-[10px] bg-zinc-900 text-white px-1.5 py-0.5 rounded font-medium">
                        Default Active
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono text-zinc-500">{seg.slug}</td>
                  <td className="py-3 px-4">{seg.mentorsCount} Active</td>
                  <td className="py-3 px-4">
                    <button
                      onClick={() => handleToggleActive(seg.id, seg.isActive)}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition-colors ${
                        seg.isActive
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-zinc-100 text-zinc-500'
                      }`}
                    >
                      {seg.isActive ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button className="text-zinc-500 hover:text-zinc-900 font-medium underline">
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Modal */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Add Mentorship Segment"
        description="Segments organize gigs and define high-level mentor capabilities."
      >
        <form onSubmit={handleCreate} className="space-y-4 pt-2">
          <Input
            label="Segment Name"
            placeholder="e.g. Parental Advisor"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'));
            }}
            required
          />

          <Input
            label="URL Slug (unique)"
            placeholder="parental-advisor"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
          />

          <Input
            label="Description (optional)"
            placeholder="Brief description of this segment"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <Input
            label="Ordering Priority (lower = higher priority)"
            type="number"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            required
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={creating}>
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              <span>{creating ? 'Creating...' : 'Save Segment'}</span>
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};