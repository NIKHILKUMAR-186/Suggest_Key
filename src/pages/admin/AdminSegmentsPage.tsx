import React, { useState } from 'react';
import { Layers, Plus, ArrowUpDown, Check, AlertCircle, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { Badge } from '@/src/components/ui/Badge';
import { Modal } from '@/src/components/ui/Modal';

interface Segment {
  id: string;
  name: string;
  slug: string;
  priority: number;
  isActive: boolean;
  createdAt: string;
  mentorsCount: number;
}

export const AdminSegmentsPage: React.FC = () => {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [segments, setSegments] = useState<Segment[]>([
    {
      id: 'seg-1',
      name: 'Relationship Advisor',
      slug: 'relationship-advisor',
      priority: 1,
      isActive: true,
      createdAt: '01 Jan 2026',
      mentorsCount: 2,
    },
    {
      id: 'seg-2',
      name: 'Autism Mentor',
      slug: 'autism-mentor',
      priority: 2,
      isActive: true,
      createdAt: '15 Jan 2026',
      mentorsCount: 1,
    },
    {
      id: 'seg-3',
      name: 'Career Mentor',
      slug: 'career-mentor',
      priority: 3,
      isActive: true,
      createdAt: '01 Feb 2026',
      mentorsCount: 0,
    },
  ]);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [priority, setPriority] = useState('4');

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) return;

    const newSeg: Segment = {
      id: `seg-${Date.now()}`,
      name,
      slug,
      priority: parseInt(priority, 10) || 10,
      isActive: true,
      createdAt: 'Today',
      mentorsCount: 0,
    };

    setSegments([...segments, newSeg]);
    setIsCreateOpen(false);
    setName('');
    setSlug('');
  };

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
            {segments
              .sort((a, b) => a.priority - b.priority)
              .map((seg) => (
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
                      onClick={() => {
                        setSegments(
                          segments.map((s) => (s.id === seg.id ? { ...s, isActive: !s.isActive } : s))
                        );
                      }}
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
            <Button type="submit" size="sm">
              Save Segment
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
