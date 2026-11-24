import React, { useState } from 'react';
import { History, ShieldCheck, CheckCircle2, XCircle, AlertTriangle, Search } from 'lucide-react';
import { ResearchExperiment } from '../../types/index.js';

interface ExperimentHistoryViewProps {
  experiments: ResearchExperiment[];
}

export const ExperimentHistoryView: React.FC<ExperimentHistoryViewProps> = ({ experiments }) => {
  const [search, setSearch] = useState('');
  const [filterVerdict, setFilterVerdict] = useState<'ALL' | 'ACCEPTED' | 'REJECTED'>('ALL');
  const [selectedExp, setSelectedExp] = useState<ResearchExperiment | null>(null);

  const filtered = experiments.filter(e => {
    const matchSearch =
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.symbol.toLowerCase().includes(search.toLowerCase()) ||
      e.ruleFamily.toLowerCase().includes(search.toLowerCase());
    const matchVerdict = filterVerdict === 'ALL' || e.auditorVerdict === filterVerdict;
    return matchSearch && matchVerdict;
  });

  return (
    <div className="w-full bg-[#17212D] text-[#E8E5DE] font-sans pb-16">
      {/* Subheader Toolbar */}
      <div className="border-b border-[#354251] px-4 lg:px-6 py-3 flex flex-wrap items-center justify-between gap-3 bg-[#222B36]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-[#AAB4BF] font-mono">
            <span className="text-[#E8E5DE] font-semibold">EXPERIMENT HISTORY</span>
            <span>·</span>
            <span>{experiments.length} PERMANENT EXPERIMENT RUNS</span>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center bg-[#17212D] border border-[#354251] rounded-lg px-2.5 py-1 text-xs font-mono">
            <Search className="w-3.5 h-3.5 text-[#AAB4BF] mr-2" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search experiments..."
              className="bg-transparent text-[#E8E5DE] outline-none w-36 sm:w-48 placeholder:text-[#AAB4BF]/50"
            />
          </div>

          <div className="flex items-center bg-[#17212D] p-0.5 rounded-lg border border-[#354251] text-xs font-mono">
            <button
              onClick={() => setFilterVerdict('ALL')}
              className={`px-2.5 py-1 rounded transition-colors ${
                filterVerdict === 'ALL' ? 'bg-[#222B36] text-[#E8E5DE] font-bold' : 'text-[#AAB4BF]'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilterVerdict('ACCEPTED')}
              className={`px-2.5 py-1 rounded transition-colors ${
                filterVerdict === 'ACCEPTED' ? 'bg-[#222B36] text-[#72A98B] font-bold' : 'text-[#AAB4BF]'
              }`}
            >
              Accepted
            </button>
            <button
              onClick={() => setFilterVerdict('REJECTED')}
              className={`px-2.5 py-1 rounded transition-colors ${
                filterVerdict === 'REJECTED' ? 'bg-[#222B36] text-[#B7797D] font-bold' : 'text-[#AAB4BF]'
              }`}
            >
              Rejected
            </button>
          </div>
        </div>
      </div>

      {/* Main Table Content */}
      <div className="w-full p-4 lg:p-6">
        {filtered.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center text-[#AAB4BF] font-mono text-xs bg-[#222B36] border border-[#354251] rounded-xl p-8">
            <History className="w-8 h-8 text-[#AAB4BF]/60 mb-2" />
            <p className="text-[#E8E5DE] font-medium text-sm">No Experiments Matched</p>
            <p className="mt-1">Run an experiment from the Model Lab or trigger a research cycle.</p>
          </div>
        ) : (
          <div className="border border-[#354251] rounded-xl overflow-x-auto bg-[#222B36]">
            <table className="w-full text-left font-mono text-xs">
              <thead className="bg-[#17212D] border-b border-[#354251] text-[#AAB4BF] uppercase text-[10px]">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">Type / Experiment</th>
                  <th className="py-2.5 px-4 font-semibold">Pair</th>
                  <th className="py-2.5 px-4 font-semibold">Rule &amp; Horizon</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Train Dir. Acc</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Val Dir. Acc</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Test Dir. Acc</th>
                  <th className="py-2.5 px-4 font-semibold text-right">F1 Score</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Profit Factor</th>
                  <th className="py-2.5 px-4 font-semibold text-center">Auditor Verdict</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#354251]">
                {filtered.map(exp => {
                  const isForwardObservation = exp.experimentType === 'LIVE_TRADE' || exp.experimentType === 'FORWARD_OBSERVATION';
                  return (
                    <tr
                      key={exp.id}
                      onClick={() => setSelectedExp(exp)}
                      className="hover:bg-[#17212D]/60 cursor-pointer transition-colors"
                    >
                      <td className="py-2.5 px-4">
                        <span className="text-[#AAB4BF]">{isForwardObservation ? 'FORWARD' : `G${exp.generation}`}</span> ·{' '}
                        <strong className="text-[#E8E5DE]">{exp.name}</strong>
                      </td>
                      <td className="py-2.5 px-4 text-[#E8E5DE] font-semibold">{exp.symbol}</td>
                      <td className="py-2.5 px-4 text-[#AAB4BF]">
                        {exp.ruleFamily} ({exp.horizonMinutes}m)
                      </td>
                      <td className="py-2.5 px-4 text-right text-[#AAB4BF] tabular-nums">
                        {isForwardObservation ? '—' : `${(exp.metrics.trainAccuracy * 100).toFixed(1)}% (n=${exp.metrics.trainSampleSize})`}
                      </td>
                      <td className="py-2.5 px-4 text-right text-[#AAB4BF] tabular-nums">
                        {isForwardObservation ? '—' : `${(exp.metrics.valAccuracy * 100).toFixed(1)}% (n=${exp.metrics.validationSampleSize})`}
                      </td>
                      <td className="py-2.5 px-4 text-right font-semibold text-[#E8E5DE] tabular-nums">
                        {isForwardObservation ? `${exp.liveOutcome || 'OUTCOME'} (n=1)` : `${(exp.metrics.testAccuracy * 100).toFixed(1)}% (n=${exp.metrics.sampleSize})`}
                      </td>
                      <td className="py-2.5 px-4 text-right text-[#72A98B] tabular-nums">
                        {isForwardObservation ? '—' : exp.metrics.f1Score.toFixed(3)}
                      </td>
                      <td className="py-2.5 px-4 text-right text-[#AAB4BF] tabular-nums">
                        {isForwardObservation ? '—' : exp.metrics.profitFactor}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <span
                          className={`inline-block font-semibold ${
                            exp.auditorVerdict === 'ACCEPTED'
                              ? 'text-[#72A98B]'
                              : exp.auditorVerdict === 'PROVISIONAL'
                              ? 'text-[#C5A36A]'
                              : 'text-[#B7797D]'
                          }`}
                        >
                          {exp.auditorVerdict}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedExp && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#222B36] border border-[#354251] rounded-xl max-w-2xl w-full p-6 text-xs font-mono text-[#E8E5DE] space-y-4 max-h-[85vh] overflow-y-auto shadow-2xl">
            <div className="flex justify-between items-center pb-3 border-b border-[#354251]">
              <div>
                <span className="text-[10px] text-[#AAB4BF] uppercase">
                  {(selectedExp.experimentType === 'LIVE_TRADE' || selectedExp.experimentType === 'FORWARD_OBSERVATION') ? 'Single Forward Paper Observation' : `Experiment Dossier G${selectedExp.generation}`}
                </span>
                <h4 className="text-base font-bold text-[#E8E5DE]">{selectedExp.name}</h4>
              </div>
              <button
                onClick={() => setSelectedExp(null)}
                className="text-[#AAB4BF] hover:text-[#E8E5DE] px-2.5 py-1 rounded bg-[#17212D] border border-[#354251]"
              >
                Close
              </button>
            </div>

            {(selectedExp.experimentType === 'LIVE_TRADE' || selectedExp.experimentType === 'FORWARD_OBSERVATION') && (
              <div className="bg-[#17212D] p-3 rounded-lg border border-[#354251] space-y-1">
                <div className="text-[#E8E5DE] font-semibold">Observed forward paper outcome: {selectedExp.liveOutcome || 'RECORDED'}</div>
                <div className="text-[#AAB4BF]">Candle-based paper observation only. This record is not a broker fill, historical backtest or strategy win-rate estimate.</div>
                <div className="text-[#72A98B]">
                  Net binary return: {typeof selectedExp.observedNetReturnUnits === 'number' && Number.isFinite(selectedExp.observedNetReturnUnits)
                    ? `${selectedExp.observedNetReturnUnits > 0 ? '+' : ''}${selectedExp.observedNetReturnUnits.toFixed(2)} U`
                    : 'Not recorded'}
                </div>
                <div className="text-[#AAB4BF]">
                  Saved payout: {typeof selectedExp.observedPayoutPct === 'number' && selectedExp.observedPayoutPct > 0
                    ? `${selectedExp.observedPayoutPct}%`
                    : 'Not recorded'}
                </div>
              </div>
            )}
            <div>
              <h5 className="text-[10px] uppercase text-[#AAB4BF] font-semibold mb-1">
                Scientist Falsifiable Hypothesis
              </h5>
              <p className="bg-[#17212D] p-3 rounded-lg border border-[#354251] text-[#E8E5DE]">
                {selectedExp.scientistHypothesis}
              </p>
            </div>

            <div>
              <h5 className="text-[10px] uppercase text-[#AAB4BF] font-semibold mb-1">
                Disproof Condition
              </h5>
              <p className="bg-[#17212D] p-3 rounded-lg border border-[#354251] text-[#B7797D]">
                {selectedExp.scientistDisproofCondition}
              </p>
            </div>

            <div>
              <h5 className="text-[10px] uppercase text-[#AAB4BF] font-semibold mb-1">
                Engineer Isolation Notes
              </h5>
              <p className="bg-[#17212D] p-3 rounded-lg border border-[#354251] text-[#AAB4BF]">
                {selectedExp.engineerConfigNotes}
              </p>
            </div>

            <div>
              <h5 className="text-[10px] uppercase text-[#AAB4BF] font-semibold mb-1">
                Skeptical Auditor Audit Trail &amp; Objections
              </h5>
              <div className="bg-[#17212D] p-3 rounded-lg border border-[#354251] space-y-1">
                <div className="font-semibold text-[#E8E5DE]">
                  Verdict: <span className={selectedExp.auditorVerdict === 'ACCEPTED' ? 'text-[#72A98B]' : selectedExp.auditorVerdict === 'PROVISIONAL' ? 'text-[#C5A36A]' : 'text-[#B7797D]'}>{selectedExp.auditorVerdict}</span>
                </div>
                {selectedExp.auditorConcerns.map((c, i) => (
                  <div key={i} className="text-[#B7797D]">
                    • {c}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
