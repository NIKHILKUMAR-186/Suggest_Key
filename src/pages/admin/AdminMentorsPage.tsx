import React, { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, CheckCircle2, XCircle, Clock, Search, Filter, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { Modal } from '@/src/components/ui/Modal';
import { EmptyState } from '@/src/components/shared/EmptyState';
import { apiFetch } from '@/src/lib/apiClient';

interface MentorRecord {
  id: string;
  name: string;
  email: string;
  segmentName: string;
  status: 'APPROVED' | 'PENDING' | 'REJECTED';
  experienceYears: number;
  bio: string;
  appliedDate: string;
  isApproved: boolean;
  isActive: boolean;
  profile?: any;
  segments?: any[];
  gigs?: any[];
}

interface ApiMentor {
  id: string;
  name: string;
  email: string;
  segmentName: string;
  status: 'APPROVED' | 'PENDING' | 'REJECTED';
  experienceYears: number;
  bio: string;
  appliedDate: string;
  isApproved: boolean;
  isActive: boolean;
  profile?: any;
  segments?: any[];
  gigs?: any[];
}

export const AdminMentorsPage: React.FC = () => {
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'PENDING' | 'APPROVED'>('ALL');
  const [selectedMentor, setSelectedMentor] = useState<MentorRecord | null>(null);
  const [mentors, setMentors] = useState<MentorRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMentors = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/admin/mentors');
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to fetch mentors');
      setMentors(data.mentors || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load mentors');
      console.error('Failed to fetch mentors:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMentors();
  }, [fetchMentors]);

  const handleApprove = async (id: string) => {
    setSelectedMentor(null);
    try {
      const res = await apiFetch(`/api/admin/mentors/${id}/approve`, { method: 'PATCH' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to approve mentor');
      await fetchMentors();
    } catch (err: any) {
      console.error('Failed to approve mentor:', err);
      alert('Failed to approve mentor: ' + err.message);
    }
  };

  const handleReject = async (id: string) => {
    setSelectedMentor(null);
    try {
      const res = await apiFetch(`/api/admin/mentors/${id}/reject`, { method: 'PATCH' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Failed to reject mentor');
      await fetchMentors();
    } catch (err: any) {
      console.error('Failed to reject mentor:', err);
      alert('Failed to reject mentor: ' + err.message);
    }
  };

  const filtered = mentors.filter((m) => {
    if (filterStatus === 'ALL') return true;
    return m.status === filterStatus;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-950 sm:text-3xl">
            Mentor Approvals & Segments
          </h1>
          <p className="mt-1 text-xs text-zinc-500">
            Audit mentor segment applications. Only approved mentors appear in seeker search results.
          </p>
        </div>

        <div className="flex items-center gap-1.5 bg-zinc-100 p-1 rounded-lg self-start text-xs">
          {(['ALL', 'PENDING', 'APPROVED'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-2.5 py-1 rounded-md capitalize font-medium ${
                filterStatus === s ? 'bg-white text-zinc-900 shadow-xs' : 'text-zinc-600'
              }`}
            >
              {s.toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Mentor Table */}
      <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden shadow-xs">
        {loading ? (
          <div className="p-8 text-center">
            <Loader2 className="h-8 w-8 text-zinc-400 mx-auto animate-spin" />
            <p className="mt-2 text-xs text-zinc-500">Loading mentors...</p>
          </div>
        ) : error ? (
          <div className="p-6 text-center text-rose-600">
            <AlertTriangle className="h-6 w-6 mx-auto mb-2" />
            <p className="text-xs">{error}</p>
            <Button variant="outline" size="sm" onClick={fetchMentors} className="mt-2">
              Retry
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No Mentors Found"
            description={filterStatus === 'ALL' ? 'No mentor records found in the system.' : `No mentors with status "${filterStatus}".`}
          />
        ) : (
          <table className="w-full text-left text-xs text-zinc-600">
            <thead className="bg-zinc-50/70 border-b border-zinc-200 text-zinc-900 font-semibold uppercase tracking-wider text-[11px]">
              <tr>
                <th className="py-3 px-4">Mentor Profile</th>
                <th className="py-3 px-4">Requested Segment</th>
                <th className="py-3 px-4">Experience</th>
                <th className="py-3 px-4">Applied</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filtered.map((mentor) => (
                <tr key={mentor.id} className="hover:bg-zinc-50/50 transition-colors">
                  <td className="py-3 px-4">
                    <span className="font-bold text-zinc-950 block">{mentor.name}</span>
                    <span className="text-[11px] text-zinc-400 font-mono">{mentor.email}</span>
                  </td>
                  <td className="py-3 px-4">
                    <Badge variant="secondary" className="text-[10px]">
                      {mentor.segmentName}
                    </Badge>
                  </td>
                  <td className="py-3 px-4">{mentor.experienceYears} Years</td>
                  <td className="py-3 px-4 text-zinc-500">{mentor.appliedDate}</td>
                  <td className="py-3 px-4">
                    <Badge
                      variant={
                        mentor.status === 'APPROVED'
                          ? 'success'
                          : mentor.status === 'PENDING'
                          ? 'warning'
                          : 'destructive'
                      }
                      className="text-[10px]"
                    >
                      {mentor.status}
                    </Badge>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs py-1 h-7"
                      onClick={() => setSelectedMentor(mentor)}
                    >
                      Audit Details
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Review Modal */}
      {selectedMentor && (
        <Modal
          isOpen={!!selectedMentor}
          onClose={() => setSelectedMentor(null)}
          title={`Review Mentor: ${selectedMentor.name}`}
          description={`Application for segment: ${selectedMentor.segmentName}`}
        >
          <div className="space-y-4 pt-2 text-xs">
            <div>
              <span className="font-bold text-zinc-700 block">Professional Bio & Qualifications</span>
              <p className="text-zinc-600 mt-1 leading-relaxed bg-zinc-50 p-3 rounded-lg border border-zinc-100">
                {selectedMentor.bio || 'No bio provided.'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4 bg-zinc-50 p-3 rounded-lg">
              <div>
                <span className="text-zinc-400 block text-[11px]">Experience</span>
                <span className="font-semibold text-zinc-900">{selectedMentor.experienceYears} Years</span>
              </div>
              <div>
                <span className="text-zinc-400 block text-[11px]">Current Status</span>
                <span className="font-semibold text-zinc-900">{selectedMentor.status}</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-zinc-100">
              <Button
                variant="outline"
                size="sm"
                className="text-rose-700 border-rose-200 hover:bg-rose-50"
                onClick={() => handleReject(selectedMentor.id)}
              >
                Reject Application
              </Button>
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => handleApprove(selectedMentor.id)}
              >
                Approve for {selectedMentor.segmentName}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};