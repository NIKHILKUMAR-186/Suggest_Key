import React, { useState } from 'react';
import { Briefcase, Plus, Clock, IndianRupee, Check, AlertCircle, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import { Textarea } from '@/src/components/ui/Textarea';
import { Badge } from '@/src/components/ui/Badge';
import { Modal } from '@/src/components/ui/Modal';
import { EmptyState } from '@/src/components/shared/EmptyState';

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

export const MentorGigsPage: React.FC = () => {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [gigs, setGigs] = useState<Gig[]>([
    {
      id: 'gig-1',
      title: '1:1 Relationship Guidance Session',
      segmentName: 'Relationship Advisor',
      segmentSlug: 'relationship-advisor',
      durationMinutes: 60,
      priceInr: 999,
      isActive: true,
      description: 'Personalized 60-minute consultation focusing on communication barriers, conflict de-escalation, and boundary formulation.',
    },
    {
      id: 'gig-2',
      title: 'Premarital Preparation Deep-Dive',
      segmentName: 'Relationship Advisor',
      segmentSlug: 'relationship-advisor',
      durationMinutes: 90,
      priceInr: 1499,
      isActive: true,
      description: 'Comprehensive 90-minute alignment session covering expectations, financial transparency, and family dynamics.',
    },
  ]);

  // Form states
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState('60');
  const [price, setPrice] = useState('999');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState('');

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const durNum = parseInt(duration, 10);
    const priceNum = parseInt(price, 10);

    if (!title.trim()) {
      setFormError('Title is required.');
      return;
    }
    if (isNaN(durNum) || durNum < 15 || durNum > 240) {
      setFormError('Duration must be a positive integer between 15 and 240 minutes.');
      return;
    }
    if (isNaN(priceNum) || priceNum < 0) {
      setFormError('Price must be a non-negative integer (INR).');
      return;
    }

    const newGig: Gig = {
      id: `gig-${Date.now()}`,
      title,
      segmentName: 'Relationship Advisor',
      segmentSlug: 'relationship-advisor',
      durationMinutes: durNum,
      priceInr: priceNum,
      isActive: true,
      description,
    };

    setGigs([...gigs, newGig]);
    setIsCreateOpen(false);
    setTitle('');
    setDescription('');
    setFormError('');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">
            Gig Management
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Define your session offerings, duration, pricing, and active publication status.
          </p>
        </div>

        <Button
          onClick={() => setIsCreateOpen(true)}
          size="md"
          className="gap-1.5 text-xs self-start"
        >
          <Plus className="h-4 w-4" />
          <span>Create New Gig</span>
        </Button>
      </div>

      {/* Invariant Note */}
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3.5 text-xs text-zinc-600 flex items-start gap-2.5">
        <AlertCircle className="h-4 w-4 text-zinc-500 shrink-0 mt-0.5" />
        <span>
          <strong>Gig Rules:</strong> Gigs can only be mapped to segments you have been approved for by Platform Admin. Duration must be between 15 and 240 minutes.
        </span>
      </div>

      {gigs.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No Gigs Created Yet"
          description="Create your first gig to start appearing in search results for your approved segments."
          actionLabel="Create Gig"
          onAction={() => setIsCreateOpen(true)}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {gigs.map((gig) => (
            <div
              key={gig.id}
              className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs flex flex-col justify-between space-y-4 hover:border-zinc-300 transition-colors"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Badge variant="secondary" className="text-[10px]">
                    {gig.segmentName}
                  </Badge>
                  <button
                    onClick={() => {
                      setGigs(gigs.map((g) => (g.id === gig.id ? { ...g, isActive: !g.isActive } : g)));
                    }}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold cursor-pointer transition-colors ${
                      gig.isActive
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-zinc-100 text-zinc-500'
                    }`}
                  >
                    {gig.isActive ? 'Active & Bookable' : 'Inactive'}
                  </button>
                </div>

                <h3 className="text-base font-bold text-zinc-950">{gig.title}</h3>
                <p className="text-xs text-zinc-600 leading-relaxed line-clamp-2">
                  {gig.description}
                </p>
              </div>

              <div className="border-t border-zinc-100 pt-3 flex items-center justify-between text-xs">
                <div className="flex items-center gap-4 text-zinc-600">
                  <span className="flex items-center gap-1 font-medium">
                    <Clock className="h-3.5 w-3.5 text-zinc-400" />
                    {gig.durationMinutes} min
                  </span>
                  <span>·</span>
                  <span className="font-bold text-zinc-950">
                    ₹{gig.priceInr} INR
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal for Creating New Gig */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Create New Mentorship Gig"
        description="Gigs define specific session formats you offer within your approved segment."
      >
        <form onSubmit={handleCreate} className="space-y-4 pt-2">
          {formError && (
            <div className="rounded-md bg-red-50 p-2.5 text-xs text-red-700">
              {formError}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-zinc-700">Approved Segment</label>
            <select
              disabled
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700"
            >
              <option>Relationship Advisor (Approved)</option>
            </select>
            <p className="text-[11px] text-zinc-400">
              * To offer gigs in other segments, apply in Segment Management.
            </p>
          </div>

          <Input
            label="Gig Title"
            placeholder="e.g. 1:1 Emotional Intelligence Strategy"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Duration (minutes: 15–240)"
              type="number"
              min={15}
              max={240}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              required
            />
            <Input
              label="Price (INR)"
              type="number"
              min={0}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
            />
          </div>

          <Textarea
            label="Gig Description"
            placeholder="Explain session structure and expected outcomes..."
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <div className="pt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm">
              Publish Gig
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
