import React, { useState } from 'react';
import {
  Brain,
  ShieldCheck,
  Play,
} from 'lucide-react';
import { FOREX_PAIRS, ForexSymbol, ResearchExperiment, RuleFamily } from '../../types/index.js';

interface ModelLabViewProps {
  experiments: ResearchExperiment[];
  onExperimentComplete: (exp: ResearchExperiment) => void;
}

export const ModelLabView: React.FC<ModelLabViewProps> = ({
  experiments,
  onExperimentComplete,
}) => {
  const [selectedPair, setSelectedPair] = useState<ForexSymbol>('EUR/USD');
  const [selectedRule, setSelectedRule] = useState<RuleFamily>('momentum_5');
  const [selectedHorizon, setSelectedHorizon] = useState<number>(10);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [activeExp, setActiveExp] = useState<ResearchExperiment | null>(null);

  const handleRunExperiment = async () => {
    setIsRunning(true);
    setErrorMessage('');
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: selectedPair,
          ruleFamily: selectedRule,
          horizon: selectedHorizon,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Research experiment failed.');
      setActiveExp(data.experiment);
      onExperimentComplete(data.experiment);
    } catch (e: any) {
      setErrorMessage(e.message || 'Failed to run experiment.');
      console.error('Failed to run experiment:', e);
    } finally {
      setIsRunning(false);
    }
  };

  const exp = activeExp || experiments.find(item => item.experimentType !== 'LIVE_TRADE' && item.experimentType !== 'FORWARD_OBSERVATION') || null;

  return (
    <div className="w-full bg-[#17212D] text-[#E8E5DE] p-4 lg:p-6 space-y-6 font-sans pb-16 lg:pb-8">
      {/* Configuration Header */}
      <div className="bg-[#222B36] border border-[#354251] rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
          <div>
            <label className="text-[#AAB4BF] block text-[10px] uppercase font-semibold">Forex Asset</label>
            <select
              value={selectedPair}
              onChange={e => setSelectedPair(e.target.value as ForexSymbol)}
              className="bg-[#17212D] border border-[#354251] rounded px-2.5 py-1 text-[#E8E5DE] text-xs mt-1 focus:outline-none focus:border-[#6C9D91]"
            >
              {FOREX_PAIRS.map(p => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[#AAB4BF] block text-[10px] uppercase font-semibold">Rule Family</label>
            <select
              value={selectedRule}
              onChange={e => setSelectedRule(e.target.value as RuleFamily)}
              className="bg-[#17212D] border border-[#354251] rounded px-2.5 py-1 text-[#E8E5DE] text-xs mt-1 focus:outline-none focus:border-[#6C9D91]"
            >
              <option value="momentum_5">Momentum 5</option>
              <option value="mean_reversion_20">Mean Reversion 20</option>
              <option value="wick_reversal">Wick Liquidity Reversal</option>
              <option value="range_breakout">Range Breakout & ATR</option>
            </select>
          </div>

          <div>
            <label className="text-[#AAB4BF] block text-[10px] uppercase font-semibold">Horizon</label>
            <select
              value={selectedHorizon}
              onChange={e => setSelectedHorizon(Number(e.target.value))}
              className="bg-[#17212D] border border-[#354251] rounded px-2.5 py-1 text-[#E8E5DE] text-xs mt-1 focus:outline-none focus:border-[#6C9D91]"
            >
              <option value={5}>5 Candles (5m)</option>
              <option value={10}>10 Candles (10m)</option>
              <option value={15}>15 Candles (15m)</option>
              <option value={20}>20 Candles (20m)</option>
              <option value={30}>30 Candles (30m)</option>
            </select>
          </div>
        </div>

        <button
          onClick={handleRunExperiment}
          disabled={isRunning}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#17212D] bg-[#72A98B] hover:bg-[#72A98B]/90 rounded transition-colors disabled:opacity-50 cursor-pointer"
        >
          <Play className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : ''}`} />
          <span>{isRunning ? 'Validating Purged Split...' : 'Run Purged Walk-Forward'}</span>
        </button>
      </div>

      {errorMessage && (
        <div className="bg-[#B7797D]/15 border border-[#B7797D]/40 rounded-lg px-4 py-3 text-xs text-[#B7797D]">
          {errorMessage}
        </div>
      )}

      {exp ? (
        <div className="space-y-6">
          {/* Top Metric Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <div className="bg-[#222B36] border border-[#354251] rounded-lg p-3 text-xs font-mono">
              <span className="text-[#AAB4BF] text-[10px] block font-semibold">Untouched Test Acc · n={exp.metrics.sampleSize}</span>
              <span className="text-lg font-bold text-[#E8E5DE] tabular-nums">
                {(exp.metrics.testAccuracy * 100).toFixed(1)}%
              </span>
              <span className="text-[10px] text-[#AAB4BF] block mt-0.5">
                95% CI: [{(exp.metrics.confidenceInterval95[0] * 100).toFixed(0)}%,{' '}
                {(exp.metrics.confidenceInterval95[1] * 100).toFixed(0)}%]
              </span>
            </div>

            <div className="bg-[#222B36] border border-[#354251] rounded-lg p-3 text-xs font-mono">
              <span className="text-[#AAB4BF] text-[10px] block font-semibold">Balanced Acc</span>
              <span className="text-lg font-bold text-[#72A98B] tabular-nums">
                {(exp.metrics.balancedAccuracy * 100).toFixed(1)}%
              </span>
              <span className="text-[10px] text-[#AAB4BF] block mt-0.5">Class-balanced</span>
            </div>

            <div className="bg-[#222B36] border border-[#354251] rounded-lg p-3 text-xs font-mono">
              <span className="text-[#AAB4BF] text-[10px] block font-semibold">F1 Score</span>
              <span className="text-lg font-bold text-[#E8E5DE] tabular-nums">
                {exp.metrics.f1Score.toFixed(3)}
              </span>
              <span className="text-[10px] text-[#AAB4BF] block mt-0.5">
                Prec: {exp.metrics.precision} · Rec: {exp.metrics.recall}
              </span>
            </div>

            <div className="bg-[#222B36] border border-[#354251] rounded-lg p-3 text-xs font-mono">
              <span className="text-[#AAB4BF] text-[10px] block font-semibold">Brier Calibration</span>
              <span className="text-lg font-bold text-[#E8E5DE] tabular-nums">
                {exp.metrics.brierScore.toFixed(4)}
              </span>
              <span className="text-[10px] text-[#AAB4BF] block mt-0.5">
                {exp.metrics.brierScore < 0.22 ? 'Well-calibrated' : 'Calibration concern'}
              </span>
            </div>

            <div className="bg-[#222B36] border border-[#354251] rounded-lg p-3 text-xs font-mono">
              <span className="text-[#AAB4BF] text-[10px] block font-semibold">Profit Factor</span>
              <span className="text-lg font-bold text-[#E8E5DE] tabular-nums">
                {exp.metrics.profitFactor}
              </span>
              <span className="text-[10px] text-[#AAB4BF] block mt-0.5">
                After modeled spread
              </span>
            </div>

            <div className="bg-[#222B36] border border-[#354251] rounded-lg p-3 text-xs font-mono">
              <span className="text-[#AAB4BF] text-[10px] block font-semibold">Max Drawdown</span>
              <span className="text-lg font-bold text-[#B7797D] tabular-nums">
                {exp.metrics.maxDrawdownPips.toFixed(1)} pips
              </span>
              <span className="text-[10px] text-[#AAB4BF] block mt-0.5">Net peak-to-trough</span>
            </div>
          </div>

          {/* Chronological Walk-Forward Split Visualization */}
          <div className="bg-[#222B36] border border-[#354251] rounded-lg p-4 space-y-3 font-mono text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-[#E8E5DE]">
                Chronological Purged Walk-Forward Partitioning
              </h4>
              <span className="text-[11px] text-[#72A98B]">
                Purged Embargo: {exp.purgedWindowCandles} M1 candles
              </span>
            </div>

            {/* Visual Timeline Bar */}
            <div className="w-full h-8 bg-[#17212D] rounded flex overflow-hidden border border-[#354251] text-[10px] font-semibold">
              <div className="w-[60%] bg-[#6C9D91]/25 border-r border-[#354251] flex items-center justify-center text-[#E8E5DE]">
                TRAIN · n={exp.metrics.trainSampleSize} · {(exp.metrics.trainAccuracy * 100).toFixed(1)}%
              </div>
              <div className="w-[5%] bg-[#17212D] border-r border-[#354251] flex items-center justify-center text-[#AAB4BF]">
                EMB
              </div>
              <div className="w-[17%] bg-[#C5A36A]/25 border-r border-[#354251] flex items-center justify-center text-[#C5A36A]">
                VAL · n={exp.metrics.validationSampleSize} · {(exp.metrics.valAccuracy * 100).toFixed(1)}%
              </div>
              <div className="w-[5%] bg-[#17212D] border-r border-[#354251] flex items-center justify-center text-[#AAB4BF]">
                EMB
              </div>
              <div className="w-[13%] bg-[#72A98B]/25 flex items-center justify-center text-[#72A98B]">
                TEST · n={exp.metrics.sampleSize} · {(exp.metrics.testAccuracy * 100).toFixed(1)}%
              </div>
            </div>

            <p className="text-[10px] text-[#AAB4BF]">
              Timeline widths are schematic; exact partition sample counts are shown in each segment. Embargoes reduce overlap between forward outcome windows.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[#AAB4BF] pt-2 text-[11px]">
              <div>
                <strong className="text-[#E8E5DE]">Scaling Isolation:</strong> Feature means and standard deviations are fitted only on the training partition and then held fixed.
              </div>
              <div>
                <strong className="text-[#E8E5DE]">Overfitting Delta:</strong> Train ({exp.metrics.trainAccuracy}) vs
                Validation ({exp.metrics.valAccuracy}) Delta ={' '}
                {((exp.metrics.trainAccuracy - exp.metrics.valAccuracy) * 100).toFixed(1)}%.
              </div>
            </div>
          </div>

          {/* Confusion Matrix & Skeptical Auditor Box */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Confusion Matrix */}
            <div className="bg-[#222B36] border border-[#354251] rounded-lg p-4 font-mono text-xs space-y-3">
              <h4 className="text-sm font-semibold text-[#E8E5DE]">Out-of-Sample Confusion Matrix</h4>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="bg-[#17212D] p-3 rounded border border-[#354251]">
                  <span className="text-[10px] text-[#AAB4BF] block font-semibold">True Positives (TP)</span>
                  <span className="text-base font-bold text-[#72A98B] tabular-nums">
                    {exp.metrics.confusionMatrix.tp}
                  </span>
                </div>
                <div className="bg-[#17212D] p-3 rounded border border-[#354251]">
                  <span className="text-[10px] text-[#AAB4BF] block font-semibold">False Positives (FP)</span>
                  <span className="text-base font-bold text-[#B7797D] tabular-nums">
                    {exp.metrics.confusionMatrix.fp}
                  </span>
                </div>
                <div className="bg-[#17212D] p-3 rounded border border-[#354251]">
                  <span className="text-[10px] text-[#AAB4BF] block font-semibold">False Negatives (FN)</span>
                  <span className="text-base font-bold text-[#C5A36A] tabular-nums">
                    {exp.metrics.confusionMatrix.fn}
                  </span>
                </div>
                <div className="bg-[#17212D] p-3 rounded border border-[#354251]">
                  <span className="text-[10px] text-[#AAB4BF] block font-semibold">True Negatives (TN)</span>
                  <span className="text-base font-bold text-[#E8E5DE] tabular-nums">
                    {exp.metrics.confusionMatrix.tn}
                  </span>
                </div>
              </div>
            </div>

            {/* Auditor Review Verdict */}
            <div className="bg-[#222B36] border border-[#354251] rounded-lg p-4 font-mono text-xs space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-[#E8E5DE] flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#C5A36A]" />
                  <span>Skeptical Auditor Gate</span>
                </h4>
                <span
                  className={`font-semibold px-2 py-0.5 rounded text-[11px] ${
                    exp.auditorVerdict === 'ACCEPTED'
                      ? 'bg-[#72A98B]/15 text-[#72A98B] border border-[#72A98B]/40'
                      : exp.auditorVerdict === 'PROVISIONAL'
                      ? 'bg-[#C5A36A]/15 text-[#C5A36A] border border-[#C5A36A]/40'
                      : 'bg-[#B7797D]/15 text-[#B7797D] border border-[#B7797D]/40'
                  }`}
                >
                  {exp.auditorVerdict}
                </span>
              </div>

              <div className="bg-[#17212D] p-3 rounded border border-[#354251] space-y-1.5 text-[#E8E5DE]">
                {exp.auditorConcerns.length > 0 ? (
                  exp.auditorConcerns.map((c, i) => (
                    <div key={i} className="flex gap-2 text-[#B7797D]">
                      <span>•</span>
                      <span>{c}</span>
                    </div>
                  ))
                ) : (
                  <div className="text-[#72A98B]">
                    ✓ Passed all leakage, calibration, and transaction-cost checks. Eligible for
                    candidate consideration.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="h-64 flex flex-col items-center justify-center text-center text-[#AAB4BF] font-mono text-xs bg-[#222B36] border border-[#354251] rounded-lg">
          <Brain className="w-8 h-8 text-[#354251] mb-2" />
          <p className="text-[#E8E5DE] font-medium text-sm">No Models Evaluated Yet</p>
          <p className="mt-1 text-[#AAB4BF]">Select an asset and rule family above, then click &quot;Run Purged Walk-Forward&quot;.</p>
        </div>
      )}
    </div>
  );
};
