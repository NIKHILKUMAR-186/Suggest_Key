import React, { useState, useEffect, useCallback } from 'react';
import { Layers, Plus, CheckCircle2, Clock, AlertCircle, ShieldAlert, Loader2 } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { Modal } from '@/src/components/ui/Modal';
import { useAuth } from '@/src/context/AuthContext';
import { apiFetch } from '@/src/lib/apiClient';

interface Segment {
  id: string;
  name: string;
  slug: string;
  status: 'APPROVED' | 'PENDING' | 'INACTIVE';
  approvedAt?: string;
  appliedAt?: string;
  gigsCount: number;
}

interface AvailableSegment {
  id: string;
  name: string;
  slug: string;
  description: string;
}

export const MentorSegmentsPage: React.FC = () => {
  const { user } = useAuth();
  const [isApplyOpen, setIsApplyOpen] = useState(false);
  const [selectedSegmentToApply, setSelectedSegmentToApply] = useState('');
  const [segments, setSegments] = useState<Segment[]>([]);
  const [availableSegments, setAvailableSegments] = useState<AvailableSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState('');

  const fetchSegments = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/mentor/segments?mentorId=${user.id}`);
      const data = await res.json();
      if (data.success) {
        setSegments(data.segments);
      }
    } catch (err: any) {
      console.error('Failed to fetch segments:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  const fetchAvailableSegments = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await apiFetch(`/api/mentor/available-segments?mentorId=${user.id}`);
      const data = await res.json();
      if (data.success) {
        setAvailableSegments(data.segments);
        if (data.segments.length > 0 && !selectedSegmentToApply) {
          setSelectedSegmentToApply(data.segments[0].id);
        }
      }
    } catch (err: any) {
      console.error('Failed to fetch available segments:', err);
    }
  }, [user?.id, selectedSegmentToApply]);

  useEffect(() => {
    fetchSegments();
    fetchAvailableSegments();
  }, [fetchSegments, fetchAvailableSegments]);

  const handleApply = async () => {
    if (!user?.id || !selectedSegmentToApply) return;
    setApplying(true);
    setApplyError('');
    try {
      const res = await apiFetch('/api/mentor/segments/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segmentId: selectedSegmentToApply }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to apply');

      // Refresh segments
      await fetchSegments();
      await fetchAvailableSegments();
      setIsApplyOpen(false);
      setSelectedSegmentToApply('');
    } catch (err: any) {
      setApplyError(err.message || 'Failed to apply for segment');
    } finally {
      setApplying(false);
    }
  };

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
          onClick={() => {
            fetchAvailableSegments().then(() => setIsApplyOpen(true));
          }}
          size="md"
          className="gap-1.5 text-xs self-start"
          disabled={availableSegments.length === 0 && !isApplyOpen}
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
        {loading ? (
          <div className="p-8 text-center">
            <Loader2 className="h-8 w-8 text-zinc-400 mx-auto animate-spin" />
            <p className="mt-2 text-xs text-zinc-500">Loading segments...</p>
          </div>
        ) : segments.length === 0 ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center">
            <Layers className="h-12 w-12 text-zinc-300 mx-auto mb-3" />
            <h3 className="font-semibold text-zinc-900 mb-1">No Segments Yet</h3>
            <p className="text-xs text-zinc-500 mb-4">Apply for a mentorship segment to get started.</p>
            <Button
              size="sm"
              onClick={() => {
                fetchAvailableSegments().then(() => setIsApplyOpen(true));
              }}
            >
              <Plus className="h-4 w-4" />
              <span>Apply for Segment</span>
            </Button>
          </div>
        ) : (
          segments.map((seg) => (
            <div
              key={seg.id}
              className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2.5">
                  <h3 className="text-base font-bold text-zinc-950">{seg.name}</h3>
                  <Badge
                    variant={seg.status === 'APPROVED' ? 'success' : seg.status === 'PENDING' ? 'warning' : 'secondary'}
                    className="text-xs"
                  >
                    {seg.status}
                  </Badge>
                </div>
                <p className="text-xs text-zinc-500">
                  {seg.status === 'APPROVED'
                    ? `Approved · {seg.gigsCount} Active Gig{seg.gigsCount !== 1 ? 's' : ''} Published`
                    : `Application submitted · Under Administrative Review`}
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
          ))
        )}
      </div>

      {/* Apply Modal */}
      <Modal
        isOpen={isApplyOpen}
        onClose={() => {
          setIsApplyOpen(false);
          setApplyError('');
        }}
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
              disabled={availableSegments.length === 0}
            >
              {availableSegments.map((seg) => (
                <option key={seg.id} value={seg.id}>{seg.name}</option>
              ))}
              {availableSegments.length === 0 && (
                <option value="">No additional segments available to apply</option>
              )}
            </select>
            {availableSegments.length === 0 && (
              <p className="text-[11px] text-zinc-500">You have applied for or are approved in all active segments.</p>
            )}
          </div>

          {selectedSegmentToApply && (
            <p className="text-xs text-zinc-500 leading-relaxed">
              {availableSegments.find(s => s.id === selectedSegmentToApply)?.description || 'Upon applying, your credentials will be submitted to the Admin review queue. You will receive an in-app notification once verified.'}
            </p>
          )}

          {applyError && (
            <div className="text-xs text-rose-600 bg-rose-50 p-2 rounded">{applyError}</div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setIsApplyOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleApply}
              disabled={applying || !selectedSegmentToApply}
            >
              {applying ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Submitting...</span>
                </>
              ) : (
                'Submit Application'
              )}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};