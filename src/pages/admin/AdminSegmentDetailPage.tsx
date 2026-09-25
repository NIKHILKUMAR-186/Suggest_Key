import React, { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Users, Briefcase, Plus, Edit, Trash2, Loader2, Save, X, CheckCircle2, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { Badge } from '@/src/components/ui/Badge';
import { Modal } from '@/src/components/ui/Modal';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { apiFetch } from '@/src/lib/apiClient';
import { useNavigation } from '@/src/context/NavigationContext';

interface Segment {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Mentor {
  id: string;
  name: string;
  email: string;
  headline: string;
  isPrimary: boolean;
  activeGig: string | null;
  approvalStatus: string;
  isActive: boolean;
}

interface Gig {
  id: string;
  title: string;
  description: string;
  durationMinutes: number;
  priceInr: number;
  isActive: boolean;
  segmentId: string;
  segmentName: string;
  createdAt: string;
  updatedAt: string;
}

interface ApiSegment {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  priority: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const AdminSegmentDetailPage: React.FC = () => {
  const { navigate, currentPath } = useNavigation();
  const segmentId = currentPath.split('/').pop() || '';

  const [segment, setSegment] = useState<Segment | null>(null);
  const [mentors, setMentors] = useState<Mentor[]>([]);
  const [gigs, setGigs] = useState<Gig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'mentors' | 'gigs'>('mentors');

  const [isAddMentorOpen, setIsAddMentorOpen] = useState(false);
  const [isCreateGigOpen, setIsCreateGigOpen] = useState(false);
  const [isEditGigOpen, setIsEditGigOpen] = useState(false);
  const [editingGig, setEditingGig] = useState<Gig | null>(null);
  const [eligibleMentors, setEligibleMentors] = useState<{ id: string; name: string; email: string }[]>([]);

  const [selectedMentorId, setSelectedMentorId] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const [gigTitle, setGigTitle] = useState('');
  const [gigDescription, setGigDescription] = useState('');
  const [gigDuration, setGigDuration] = useState('60');
  const [gigPrice, setGigPrice] = useState('');
  const [gigActive, setGigActive] = useState(true);
  const [adding, setAdding] = useState(false);
  const [creatingGig, setCreatingGig] = useState(false);
  const [editingGigState, setEditingGigState] = useState(false);

  const fetchSegment = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/admin/segments/${segmentId}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to fetch segment');
      const s = data.segment;
      setSegment({
        id: s.id,
        name: s.name,
        slug: s.slug,
        description: s.description,
        priority: s.priority,
        isActive: s.is_active,
        createdAt: s.created_at ? new Date(s.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Unknown',
        updatedAt: s.updated_at ? new Date(s.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Unknown',
      });
    } catch (err: any) {
      setError(err.message || 'Failed to load segment');
      console.error('Failed to fetch segment:', err);
    } finally {
      setLoading(false);
    }
  }, [segmentId]);

  const fetchMentors = useCallback(async () => {
    if (!segment) return;
    try {
      const res = await apiFetch(`/api/admin/segments/${segmentId}/mentors`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to fetch mentors');
      setMentors(data.mentors || []);
    } catch (err: any) {
      console.error('Failed to fetch mentors:', err);
    }
  }, [segmentId]);

  const fetchGigs = useCallback(async () => {
    if (!segment) return;
    try {
      const res = await apiFetch(`/api/admin/segments/${segmentId}/gigs`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to fetch gigs');
      setGigs(data.gigs || []);
    } catch (err: any) {
      console.error('Failed to fetch gigs:', err);
    }
  }, [segmentId]);

  const fetchEligibleMentors = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/mentors/eligible');
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to fetch eligible mentors');
      setEligibleMentors(data.mentors || []);
    } catch (err: any) {
      console.error('Failed to fetch eligible mentors:', err);
    }
  }, []);

  useEffect(() => {
    fetchSegment();
  }, [fetchSegment]);

  useEffect(() => {
    if (segment) {
      fetchMentors();
      fetchGigs();
    }
  }, [segment, fetchMentors, fetchGigs]);

  useEffect(() => {
    if (isAddMentorOpen) {
      fetchEligibleMentors();
    }
  }, [isAddMentorOpen, fetchEligibleMentors]);

  const handleAddMentor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMentorId) return;

    setAdding(true);
    try {
      const res = await apiFetch(`/api/admin/segments/${segmentId}/mentors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mentorId: selectedMentorId, isPrimary }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to add mentor');
      setIsAddMentorOpen(false);
      setSelectedMentorId('');
      setIsPrimary(false);
      await fetchMentors();
    } catch (err: any) {
      console.error('Failed to add mentor:', err);
      alert('Failed to add mentor: ' + err.message);
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveMentor = async (mentorId: string) => {
    if (!confirm('Remove this mentor from the segment? This action cannot be undone.')) return;

    try {
      const res = await apiFetch(`/api/admin/segments/${segmentId}/mentors/${mentorId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to remove mentor');
      await fetchMentors();
    } catch (err: any) {
      console.error('Failed to remove mentor:', err);
      alert('Failed to remove mentor: ' + err.message);
    }
  };

  const handleCreateGig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gigTitle || !gigPrice || !selectedMentorId) return;

    setCreatingGig(true);
    try {
      const res = await apiFetch(`/api/admin/segments/${segmentId}/gigs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mentorId: selectedMentorId,
          title: gigTitle,
          description: gigDescription,
          durationMinutes: parseInt(gigDuration, 10),
          priceInr: parseInt(gigPrice, 10),
          isActive: gigActive,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to create gig');
      setIsCreateGigOpen(false);
      setGigTitle('');
      setGigDescription('');
      setGigDuration('60');
      setGigPrice('');
      setGigActive(true);
      setSelectedMentorId('');
      await fetchGigs();
    } catch (err: any) {
      console.error('Failed to create gig:', err);
      alert('Failed to create gig: ' + err.message);
    } finally {
      setCreatingGig(false);
    }
  };

  const handleEditGig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingGig) return;

    setEditingGigState(true);
    try {
      const res = await apiFetch(`/api/admin/gigs/${editingGig.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: gigTitle,
          description: gigDescription,
          durationMinutes: parseInt(gigDuration, 10),
          priceInr: parseInt(gigPrice, 10),
          isActive: gigActive,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to update gig');
      setIsEditGigOpen(false);
      setEditingGig(null);
      await fetchGigs();
    } catch (err: any) {
      console.error('Failed to update gig:', err);
      alert('Failed to update gig: ' + err.message);
    } finally {
      setEditingGigState(false);
    }
  };

  const handleToggleGigActive = async (id: string, currentActive: boolean) => {
    try {
      const res = await apiFetch(`/api/admin/gigs/${id}/toggle-active`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !currentActive }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to toggle gig');
      await fetchGigs();
    } catch (err: any) {
      console.error('Failed to toggle gig:', err);
      alert('Failed to update gig: ' + err.message);
    }
  };

  const openEditGig = (gig: Gig) => {
    setEditingGig(gig);
    setGigTitle(gig.title);
    setGigDescription(gig.description);
    setGigDuration(String(gig.durationMinutes));
    setGigPrice(String(gig.priceInr));
    setGigActive(gig.isActive);
    setIsEditGigOpen(true);
  };

  const toggleSegmentActive = async () => {
    if (!segment) return;
    try {
      const res = await apiFetch(`/api/admin/segments/${segmentId}/toggle-active`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !segment.isActive }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to toggle segment');
      setSegment({ ...segment, isActive: !segment.isActive });
    } catch (err: any) {
      console.error('Failed to toggle segment:', err);
      alert('Failed to update segment: ' + err.message);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center">
        <Loader2 className="h-8 w-8 text-zinc-400 mx-auto animate-spin" />
        <p className="mt-2 text-xs text-zinc-500">Loading segment...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-center text-rose-600">
        <AlertCircle className="h-6 w-6 mx-auto mb-2" />
        <p className="text-xs">{error}</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/admin/segments')} className="mt-2">
          Back to Segments
        </Button>
      </div>
    );
  }

  if (!segment) {
    return (
      <div className="p-6 text-center text-rose-600">
        <AlertCircle className="h-6 w-6 mx-auto mb-2" />
        <p className="text-xs">Segment not found</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/admin/segments')} className="mt-2">
          Back to Segments
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-200 pb-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin/segments')} className="p-2">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">
              {segment.name}
            </h1>
            <p className="mt-1 text-xs text-zinc-500 flex items-center gap-2">
              <span className="font-mono text-zinc-400">{segment.slug}</span>
              <Badge variant={segment.priority === 1 ? 'default' : 'secondary'} className="text-[10px]">
                Priority #{segment.priority}
              </Badge>
              <Badge variant={segment.isActive ? 'success' : 'secondary'} className="text-[10px]">
                {segment.isActive ? 'Active' : 'Inactive'}
              </Badge>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start">
          <Button variant="outline" size="sm" onClick={toggleSegmentActive} className="gap-1.5 text-xs">
            {segment.isActive ? 'Deactivate' : 'Activate'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate(`/admin/segments/${segmentId}/edit`)} className="gap-1.5 text-xs">
            <Edit className="h-3.5 w-3.5" />
            Edit
          </Button>
        </div>
      </div>

      {/* Segment Info */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <p className="text-xs text-zinc-500">Description</p>
          <p className="text-sm text-zinc-900 mt-1">{segment.description || 'No description'}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <p className="text-xs text-zinc-500">Created</p>
          <p className="text-sm text-zinc-900 mt-1">{segment.createdAt}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <p className="text-xs text-zinc-500">Last Updated</p>
          <p className="text-sm text-zinc-900 mt-1">{segment.updatedAt}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden shadow-xs">
        <div className="border-b border-zinc-200">
          <nav className="flex" aria-label="Segment sections">
            <button
              onClick={() => setActiveTab('mentors')}
              className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
                activeTab === 'mentors'
                  ? 'border-emerald-600 text-emerald-600'
                  : 'border-transparent text-zinc-500 hover:text-zinc-900'
              }`}
            >
              <Users className="h-4 w-4" />
              <span>Mentors ({mentors.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('gigs')}
              className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
                activeTab === 'gigs'
                  ? 'border-emerald-600 text-emerald-600'
                  : 'border-transparent text-zinc-500 hover:text-zinc-900'
              }`}
            >
              <Briefcase className="h-4 w-4" />
              <span>Gigs ({gigs.length})</span>
            </button>
          </nav>
        </div>

        {/* Mentors Tab */}
        {activeTab === 'mentors' && (
          <div className="p-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
              <h3 className="text-sm font-semibold text-zinc-900">Assigned Mentors</h3>
              <Button size="sm" onClick={() => setIsAddMentorOpen(true)} className="gap-1.5 text-xs self-start">
                <Plus className="h-3.5 w-3.5" />
                <span>Add Mentor</span>
              </Button>
            </div>

            {mentors.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No Mentors Assigned"
                description="No mentors are assigned to this segment yet."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-zinc-600">
                  <thead className="bg-zinc-50/70 border-b border-zinc-200 text-zinc-900 font-semibold uppercase tracking-wider text-[11px]">
                    <tr>
                      <th className="py-3 px-4">Mentor</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Primary</th>
                      <th className="py-3 px-4">Active Gig</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {mentors.map((mentor) => (
                      <tr key={mentor.id} className="hover:bg-zinc-50/50 transition-colors">
                        <td className="py-3 px-4">
                          <span className="font-bold text-zinc-950 block">{mentor.name}</span>
                          <span className="text-[11px] text-zinc-400 font-mono">{mentor.email}</span>
                          {mentor.headline && <span className="text-[10px] text-zinc-500 block truncate max-w-xs">{mentor.headline}</span>}
                        </td>
                        <td className="py-3 px-4">
                          <Badge
                            variant={
                              mentor.approvalStatus === 'approved' ? 'success'
                              : mentor.approvalStatus === 'pending_review' ? 'warning'
                              : 'destructive'
                            }
                            className="text-[10px]"
                          >
                            {mentor.approvalStatus}
                          </Badge>
                          <Badge variant={mentor.isActive ? 'success' : 'secondary'} className="text-[10px] ml-1">
                            {mentor.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </td>
                        <td className="py-3 px-4">
                          {mentor.isPrimary ? (
                            <Badge variant="default" className="text-[10px]">Primary</Badge>
                          ) : (
                            <span className="text-zinc-400 text-[10px]">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {mentor.activeGig ? (
                            <span className="font-medium text-zinc-900">{mentor.activeGig}</span>
                          ) : (
                            <span className="text-zinc-400 text-[10px]">No active gig</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-rose-600 hover:text-rose-700 text-xs"
                            onClick={() => handleRemoveMentor(mentor.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>Remove</span>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Gigs Tab */}
        {activeTab === 'gigs' && (
          <div className="p-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
              <h3 className="text-sm font-semibold text-zinc-900">Gigs</h3>
              <Button size="sm" onClick={() => {
                setSelectedMentorId('');
                setGigTitle('');
                setGigDescription('');
                setGigDuration('60');
                setGigPrice('');
                setGigActive(true);
                setIsCreateGigOpen(true);
              }} className="gap-1.5 text-xs self-start">
                <Plus className="h-3.5 w-3.5" />
                <span>Create Gig</span>
              </Button>
            </div>

            {gigs.length === 0 ? (
              <EmptyState
                icon={Briefcase}
                title="No Gigs Created"
                description="No gigs have been created for this segment yet."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-zinc-600">
                  <thead className="bg-zinc-50/70 border-b border-zinc-200 text-zinc-900 font-semibold uppercase tracking-wider text-[11px]">
                    <tr>
                      <th className="py-3 px-4">Title</th>
                      <th className="py-3 px-4">Mentor</th>
                      <th className="py-3 px-4">Duration</th>
                      <th className="py-3 px-4">Price</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {gigs.map((gig) => (
                      <tr key={gig.id} className="hover:bg-zinc-50/50 transition-colors">
                        <td className="py-3 px-4">
                          <span className="font-bold text-zinc-950 block">{gig.title}</span>
                          {gig.description && <span className="text-[10px] text-zinc-500 block truncate max-w-xs">{gig.description}</span>}
                        </td>
                        <td className="py-3 px-4 font-mono text-zinc-500">{gig.segmentName}</td>
                        <td className="py-3 px-4">{gig.durationMinutes} min</td>
                        <td className="py-3 px-4 font-mono text-zinc-900">₹{gig.priceInr}</td>
                        <td className="py-3 px-4">
                          <button
                            onClick={() => handleToggleGigActive(gig.id, gig.isActive)}
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition-colors ${
                              gig.isActive
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-zinc-100 text-zinc-500'
                            }`}
                          >
                            {gig.isActive ? 'Active' : 'Inactive'}
                          </button>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-zinc-500 hover:text-zinc-900 font-medium text-xs"
                            onClick={() => openEditGig(gig)}
                          >
                            Edit
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add Mentor Modal */}
      <Modal
        isOpen={isAddMentorOpen}
        onClose={() => setIsAddMentorOpen(false)}
        title="Add Mentor to Segment"
        description="Select an eligible mentor to assign to this segment."
      >
        <form onSubmit={handleAddMentor} className="space-y-4 pt-2">
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-zinc-700">Mentor</label>
            <select
              value={selectedMentorId}
              onChange={(e) => setSelectedMentorId(e.target.value)}
              className="flex h-12 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-500 focus:outline-none focus:ring-3 focus:ring-emerald-100"
              required
            >
              <option value="">Select a mentor</option>
              {eligibleMentors.map((m) => (
                <option key={m.id} value={m.id}>{m.name} ({m.email})</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isPrimary"
              checked={isPrimary}
              onChange={(e) => setIsPrimary(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
            />
            <label htmlFor="isPrimary" className="text-xs text-zinc-600">
              Set as primary segment for this mentor
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setIsAddMentorOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={adding || !selectedMentorId}>
              {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              <span>{adding ? 'Adding...' : 'Add Mentor'}</span>
            </Button>
          </div>
        </form>
      </Modal>

      {/* Create Gig Modal */}
      <Modal
        isOpen={isCreateGigOpen}
        onClose={() => setIsCreateGigOpen(false)}
        title="Create Gig"
        description="Create a new offering for a mentor in this segment."
        maxWidth="lg"
      >
        <form onSubmit={handleCreateGig} className="space-y-4 pt-2">
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-zinc-700">Mentor</label>
            <select
              value={selectedMentorId}
              onChange={(e) => setSelectedMentorId(e.target.value)}
              className="flex h-12 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-500 focus:outline-none focus:ring-3 focus:ring-emerald-100"
              required
            >
              <option value="">Select a mentor</option>
              {mentors.filter(m => m.approvalStatus === 'approved' && m.isActive).map((m) => (
                <option key={m.id} value={m.id}>{m.name} ({m.email})</option>
              ))}
            </select>
          </div>

          <Input
            label="Title"
            placeholder="e.g. 60-min Relationship Coaching"
            value={gigTitle}
            onChange={(e) => setGigTitle(e.target.value)}
            required
          />

          <Input
            label="Description (optional)"
            placeholder="Brief description of this offering"
            value={gigDescription}
            onChange={(e) => setGigDescription(e.target.value)}
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Duration (minutes)"
              type="number"
              value={gigDuration}
              onChange={(e) => setGigDuration(e.target.value)}
              required
            />
            <Input
              label="Price (INR)"
              type="number"
              value={gigPrice}
              onChange={(e) => setGigPrice(e.target.value)}
              required
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="gigActive"
              checked={gigActive}
              onChange={(e) => setGigActive(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
            />
            <label htmlFor="gigActive" className="text-xs text-zinc-600">
              Active (only one active gig per mentor per segment allowed)
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setIsCreateGigOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={creatingGig || !selectedMentorId}>
              {creatingGig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              <span>{creatingGig ? 'Creating...' : 'Create Gig'}</span>
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Gig Modal */}
      <Modal
        isOpen={isEditGigOpen}
        onClose={() => { setIsEditGigOpen(false); setEditingGig(null); }}
        title="Edit Gig"
        description="Changes are saved directly to the database."
        maxWidth="lg"
      >
        <form onSubmit={handleEditGig} className="space-y-4 pt-2">
          <Input
            label="Title"
            placeholder="e.g. 60-min Relationship Coaching"
            value={gigTitle}
            onChange={(e) => setGigTitle(e.target.value)}
            required
          />

          <Input
            label="Description (optional)"
            placeholder="Brief description of this offering"
            value={gigDescription}
            onChange={(e) => setGigDescription(e.target.value)}
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Duration (minutes)"
              type="number"
              value={gigDuration}
              onChange={(e) => setGigDuration(e.target.value)}
              required
            />
            <Input
              label="Price (INR)"
              type="number"
              value={gigPrice}
              onChange={(e) => setGigPrice(e.target.value)}
              required
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="gigActiveEdit"
              checked={gigActive}
              onChange={(e) => setGigActive(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
            />
            <label htmlFor="gigActiveEdit" className="text-xs text-zinc-600">
              Active (only one active gig per mentor per segment allowed)
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => { setIsEditGigOpen(false); setEditingGig(null); }}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={editingGigState}>
              {editingGigState ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              <span>{editingGigState ? 'Saving...' : 'Save Changes'}</span>
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};