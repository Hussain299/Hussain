import React, { useState } from 'react';
import { Users, FlaskConical, Wrench, ShieldAlert } from 'lucide-react';
import { AgentReview } from '../../types/index.js';

interface ResearchAgentsViewProps {
  reviews: AgentReview[];
}

export const ResearchAgentsView: React.FC<ResearchAgentsViewProps> = ({ reviews }) => {
  const [selectedRole, setSelectedRole] = useState<'ALL' | 'SCIENTIST' | 'ENGINEER' | 'SKEPTICAL_AUDITOR'>('ALL');

  const filtered = reviews.filter(r => selectedRole === 'ALL' || r.role === selectedRole);

  const formatIST = (timestampStr?: string) => {
    if (!timestampStr) return '--:--:-- IST';
    try {
      const d = new Date(timestampStr);
      if (isNaN(d.getTime())) return timestampStr;
      return (
        d.toLocaleTimeString('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }) + ' IST'
      );
    } catch {
      return timestampStr;
    }
  };

  const getRoleIcon = (role: AgentReview['role']) => {
    switch (role) {
      case 'SCIENTIST':
        return <FlaskConical className="w-4 h-4 text-[#6C9D91]" />;
      case 'ENGINEER':
        return <Wrench className="w-4 h-4 text-[#AAB4BF]" />;
      case 'SKEPTICAL_AUDITOR':
        return <ShieldAlert className="w-4 h-4 text-[#C5A36A]" />;
    }
  };

  const getRoleBadgeColor = (role: AgentReview['role']) => {
    switch (role) {
      case 'SCIENTIST':
        return 'text-[#6C9D91]';
      case 'ENGINEER':
        return 'text-[#AAB4BF]';
      case 'SKEPTICAL_AUDITOR':
        return 'text-[#C5A36A]';
    }
  };

  return (
    <div className="w-full bg-[#17212D] text-[#E8E5DE] p-4 lg:p-6 space-y-6 font-sans pb-16 lg:pb-8">
      {/* Subheader Toolbar */}
      <div className="bg-[#222B36] border border-[#354251] rounded-lg p-3 lg:p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="text-[#E8E5DE] font-semibold">RESEARCH TRINITY</span>
          <span className="text-[#AAB4BF]">·</span>
          <span className="text-[#AAB4BF]">ROLE-SEPARATED DELIBERATION AUDIT LOG</span>
        </div>

        {/* Filter */}
        <div className="flex flex-wrap items-center bg-[#17212D] p-0.5 rounded border border-[#354251] text-xs font-mono">
          <button
            onClick={() => setSelectedRole('ALL')}
            className={`px-2.5 py-1 rounded transition-colors ${
              selectedRole === 'ALL' ? 'bg-[#222B36] text-[#E8E5DE] font-semibold' : 'text-[#AAB4BF] hover:text-[#E8E5DE]'
            }`}
          >
            All Roles ({reviews.length})
          </button>
          <button
            onClick={() => setSelectedRole('SCIENTIST')}
            className={`px-2.5 py-1 rounded transition-colors ${
              selectedRole === 'SCIENTIST' ? 'bg-[#222B36] text-[#6C9D91] font-semibold' : 'text-[#AAB4BF] hover:text-[#6C9D91]'
            }`}
          >
            Scientist
          </button>
          <button
            onClick={() => setSelectedRole('ENGINEER')}
            className={`px-2.5 py-1 rounded transition-colors ${
              selectedRole === 'ENGINEER' ? 'bg-[#222B36] text-[#AAB4BF] font-semibold' : 'text-[#AAB4BF] hover:text-[#E8E5DE]'
            }`}
          >
            Engineer
          </button>
          <button
            onClick={() => setSelectedRole('SKEPTICAL_AUDITOR')}
            className={`px-2.5 py-1 rounded transition-colors ${
              selectedRole === 'SKEPTICAL_AUDITOR' ? 'bg-[#222B36] text-[#C5A36A] font-semibold' : 'text-[#AAB4BF] hover:text-[#C5A36A]'
            }`}
          >
            Skeptical Auditor
          </button>
        </div>
      </div>

      {/* Reviews Stream */}
      <div className="space-y-4">
        {filtered.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center text-[#AAB4BF] font-mono text-xs bg-[#222B36] border border-[#354251] rounded-lg">
            <Users className="w-8 h-8 text-[#354251] mb-2" />
            <p className="text-[#E8E5DE] font-medium text-sm">No Agent Deliberations Logged</p>
            <p className="mt-1 text-[#AAB4BF]">Deliberations are generated automatically during model walk-forward evaluations.</p>
          </div>
        ) : (
          filtered.map(rev => (
            <div
              key={rev.id}
              className="bg-[#222B36] border border-[#354251] rounded-lg p-5 font-mono text-xs space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between pb-2 border-b border-[#354251] gap-2">
                <div className="flex items-center gap-2">
                  {getRoleIcon(rev.role)}
                  <span className={`font-bold ${getRoleBadgeColor(rev.role)}`}>{rev.role}</span>
                  <span className="text-[#354251]">·</span>
                  <span className="text-[#E8E5DE] font-medium">{rev.title}</span>
                </div>

                <div className="flex items-center gap-3">
                  {rev.verdict && (
                    <span
                      className={`font-semibold px-2 py-0.5 rounded text-[10px] ${
                        rev.verdict === 'PROCEED'
                          ? 'bg-[#72A98B]/15 text-[#72A98B] border border-[#72A98B]/40'
                          : rev.verdict === 'HOLD'
                          ? 'bg-[#C5A36A]/15 text-[#C5A36A] border border-[#C5A36A]/40'
                          : 'bg-[#B7797D]/15 text-[#B7797D] border border-[#B7797D]/40'
                      }`}
                    >
                      {rev.verdict}
                    </span>
                  )}

                  <span className="text-[11px] text-[#AAB4BF]">
                    {formatIST(rev.timestamp)}
                  </span>
                </div>
              </div>

              <div className="text-[#E8E5DE] whitespace-pre-line leading-relaxed bg-[#17212D] p-4 rounded border border-[#354251]">
                {rev.content}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
