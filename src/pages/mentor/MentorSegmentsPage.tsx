import React, { useState } from 'react';
import { Layers, Plus, CheckCircle2, Clock, AlertCircle, ShieldAlert } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { Modal } from '@/src/components/ui/Modal';

export const MentorSegmentsPage: React.FC = () => {
  const [isApplyOpen, setIsApplyOpen] = useState(false);
  const [selectedSegmentToApply, setSelectedSegmentToApply] = useState('autism-mentor');

  const [segments, setSegments] = useState([
    {
      id: 'seg-1',
      name: 'Relationship Advisor',
      slug: 'relationship-advisor',
      status: 'APPROVED',
      approvedAt: '10 Feb 2026',
      gigsCount: 2,
    },
    {
      id: 'seg-2',
      name: 'Autism Mentor',
      slug: 'autism-mentor',
      status: 'PENDING',
      appliedAt: '12 Mar 2026',
      gigsCount: 0,
    },
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">
            My Segments
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            View segment approvals and apply for verification in additional mentorship specializations.
          </p>
        </div>

        <Button
          onClick={() => setIsApplyOpen(true)}
          size="md"
          className="gap-1.5 text-xs self-start"
        >
          <Plus className="h-4 w-4" />
          <span>Apply for New Segment</span>
        </Button>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3.5 text-xs text-zinc-600 flex items-start gap-2.5">
        <ShieldAlert className="h-4 w-4 text-zinc-500 shrink-0 mt-0.5" />
        <span>
          <strong>Approval Requirement:</strong> Mentors can only create gigs and accept bookings in segments with <strong className="font-semibold text-zinc-900">APPROVED</strong> status. Platform Admin audits credentials prior to activation.
        </span>
      </div>

      <div className="space-y-4">
        {segments.map((seg) => (
          <div
            key={seg.id}
            className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2.5">
                <h3 className="text-base font-bold text-zinc-950">{seg.name}</h3>
                <Badge
                  variant={seg.status === 'APPROVED' ? 'success' : 'warning'}
                  className="text-xs"
                >
                  {seg.status}
                </Badge>
              </div>
              <p className="text-xs text-zinc-500">
                {seg.status === 'APPROVED'
                  ? `Approved on ${seg.approvedAt} · ${seg.gigsCount} Active Gigs Published`
                  : `Application submitted on ${seg.appliedAt} · Under Administrative Review`}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {seg.status === 'APPROVED' ? (
                <span className="text-xs text-emerald-700 font-medium flex items-center gap-1">
                  <CheckCircle2 className="h-4 w-4" /> Ready for Gigs
                </span>
              ) : (
                <span className="text-xs text-amber-700 font-medium flex items-center gap-1">
                  <Clock className="h-4 w-4" /> Verification Pending
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Apply Modal */}
      <Modal
        isOpen={isApplyOpen}
        onClose={() => setIsApplyOpen(false)}
        title="Apply for Mentorship Segment"
        description="Select an active platform segment to request mentor verification."
      >
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-zinc-700">Available Segments</label>
            <select
              value={selectedSegmentToApply}
              onChange={(e) => setSelectedSegmentToApply(e.target.value)}
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900"
            >
              <option value="career-mentor">Career Mentor</option>
              <option value="autism-mentor">Autism Mentor</option>
            </select>
          </div>

          <p className="text-xs text-zinc-500 leading-relaxed">
            Upon applying, your credentials will be submitted to the Admin review queue. You will receive an in-app notification once verified.
          </p>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setIsApplyOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setSegments([
                  ...segments,
                  {
                    id: `seg-${Date.now()}`,
                    name: selectedSegmentToApply === 'career-mentor' ? 'Career Mentor' : 'Autism Mentor',
                    slug: selectedSegmentToApply,
                    status: 'PENDING',
                    appliedAt: 'Today',
                    gigsCount: 0,
                  },
                ]);
                setIsApplyOpen(false);
              }}
            >
              Submit Application
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
