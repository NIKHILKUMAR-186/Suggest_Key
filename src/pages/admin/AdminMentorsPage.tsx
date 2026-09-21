import React, { useState } from 'react';
import { ShieldCheck, CheckCircle2, XCircle, Clock, Search, Filter, AlertTriangle } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Badge } from '@/src/components/ui/Badge';
import { Modal } from '@/src/components/ui/Modal';
import { EmptyState } from '@/src/components/shared/EmptyState';

interface MentorRecord {
  id: string;
  name: string;
  email: string;
  segmentName: string;
  status: 'APPROVED' | 'PENDING' | 'REJECTED';
  experienceYears: number;
  bio: string;
  appliedDate: string;
}

export const AdminMentorsPage: React.FC = () => {
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'PENDING' | 'APPROVED'>('ALL');
  const [selectedMentor, setSelectedMentor] = useState<MentorRecord | null>(null);

  const [mentors, setMentors] = useState<MentorRecord[]>([
    {
      id: 'm-1',
      name: 'Rahul Sharma',
      email: 'mentor.rahul@suggestkey.com',
      segmentName: 'Relationship Advisor',
      status: 'APPROVED',
      experienceYears: 6,
      bio: 'Pre-marital and relationship communication specialist with 6+ years of clinical counseling.',
      appliedDate: '10 Feb 2026',
    },
    {
      id: 'm-2',
      name: 'Ananya Patel',
      email: 'mentor.ananya@suggestkey.com',
      segmentName: 'Relationship Advisor',
      status: 'APPROVED',
      experienceYears: 5,
      bio: 'Family systems and active listening mentor.',
      appliedDate: '15 Feb 2026',
    },
    {
      id: 'm-3',
      name: 'Vikram Seth',
      email: 'vikram.seth@example.com',
      segmentName: 'Autism Mentor',
      status: 'PENDING',
      experienceYears: 8,
      bio: 'Neurodivergent sensory regulation and executive functioning mentor for adolescents and parents.',
      appliedDate: '17 Mar 2026',
    },
  ]);

  const handleApprove = (id: string) => {
    setMentors(mentors.map((m) => (m.id === id ? { ...m, status: 'APPROVED' } : m)));
    setSelectedMentor(null);
  };

  const handleReject = (id: string) => {
    setMentors(mentors.map((m) => (m.id === id ? { ...m, status: 'REJECTED' } : m)));
    setSelectedMentor(null);
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
                {selectedMentor.bio}
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
