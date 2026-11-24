import React from 'react';
import { BarChart3, TrendingUp, Activity, AlertTriangle } from 'lucide-react';
import { ResearchExperiment, ResearchSignal } from '../../types/index.js';

interface PerformanceAnalyticsViewProps {
  experiments: ResearchExperiment[];
  signals: ResearchSignal[];
}

export const PerformanceAnalyticsView: React.FC<PerformanceAnalyticsViewProps> = ({
  experiments,
  signals,
}) => {
  const completedSignals = signals.filter(
    signal => signal.lifecycleState === 'CLOSED' &&
      ['WIN', 'LOSS', 'SCRATCH'].includes(signal.outcomeResult)
  );
  const scoredSignals = completedSignals.filter(
    signal => signal.outcomeResult === 'WIN' || signal.outcomeResult === 'LOSS'
  );
  const wins = scoredSignals.filter(signal => signal.outcomeResult === 'WIN').length;
  const losses = scoredSignals.filter(signal => signal.outcomeResult === 'LOSS').length;
  const scratches = completedSignals.filter(signal => signal.outcomeResult === 'SCRATCH').length;
  const winRate = scoredSignals.length > 0 ? (wins / scoredSignals.length) * 100 : null;
  const totalNetPips = completedSignals.reduce((sum, signal) => sum + (signal.netReturnPips || 0), 0);
  const avgNetPips = completedSignals.length > 0 ? totalNetPips / completedSignals.length : null;

  const backtests = experiments
    .filter(experiment => experiment.experimentType !== 'LIVE_TRADE' && experiment.experimentType !== 'FORWARD_OBSERVATION')
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const latestBacktest = backtests[0] || null;

  return (
    <div className="w-full bg-[#17212D] text-[#E8E5DE] p-4 lg:p-6 space-y-6 font-sans">
      <div className="pb-4 border-b border-[#354251]">
        <h3 className="text-base font-bold text-[#E8E5DE] font-mono flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-[#6C9D91]" />
          <span>Performance Analytics &amp; Evidence</span>
        </h3>
        <p className="text-xs text-[#AAB4BF] font-mono mt-1">
          Candle-based forward paper outcomes and historical out-of-sample experiments are reported separately; broker fills are not connected.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 font-mono text-xs">
        <div className="bg-[#222B36] border border-[#354251] rounded-lg p-4">
          <span className="text-[#AAB4BF] text-[10px] block uppercase">Forward Signal Win Rate</span>
          <span className={`text-2xl font-bold tabular-nums ${winRate !== null && winRate >= 70 ? 'text-[#72A98B]' : winRate !== null && winRate >= 55.6 ? 'text-[#C5A36A]' : winRate !== null ? 'text-[#B7797D]' : 'text-[#AAB4BF]'}`}>
            {winRate === null ? 'No data' : `${winRate.toFixed(1)}%`}
          </span>
          <span className="text-[10px] text-[#AAB4BF] block mt-1">
            {wins}W / {losses}L · n={scoredSignals.length} · {scratches} scratches
          </span>
        </div>

        <div className="bg-[#222B36] border border-[#354251] rounded-lg p-4">
          <span className="text-[#AAB4BF] text-[10px] block uppercase">Cumulative Forward Net Pips</span>
          <span className={`text-2xl font-bold tabular-nums ${totalNetPips >= 0 ? 'text-[#72A98B]' : 'text-[#B7797D]'}`}>
            {completedSignals.length === 0 ? 'No data' : `${totalNetPips >= 0 ? '+' : ''}${totalNetPips.toFixed(1)}`}
          </span>
          <span className="text-[10px] text-[#AAB4BF] block mt-1">
            {avgNetPips === null ? 'No completed outcomes' : `${avgNetPips > 0 ? '+' : ''}${avgNetPips.toFixed(2)} pips per completed forward outcome`}
          </span>
        </div>

        <div className="bg-[#222B36] border border-[#354251] rounded-lg p-4">
          <span className="text-[#AAB4BF] text-[10px] block uppercase">Historical Experiments</span>
          <span className="text-2xl font-bold text-[#E8E5DE] tabular-nums">{backtests.length}</span>
          <span className="text-[10px] text-[#AAB4BF] block mt-1">Historical backtests only · forward observations excluded</span>
        </div>

        <div className="bg-[#222B36] border border-[#354251] rounded-lg p-4">
          <span className="text-[#AAB4BF] text-[10px] block uppercase">Latest Untouched Test</span>
          <span className="text-2xl font-bold text-[#E8E5DE] tabular-nums">
            {latestBacktest ? `${(latestBacktest.metrics.testAccuracy * 100).toFixed(1)}%` : 'No data'}
          </span>
          <span className="text-[10px] text-[#AAB4BF] block mt-1">
            {latestBacktest ? `n=${latestBacktest.metrics.sampleSize} · ${latestBacktest.symbol} · ${latestBacktest.horizonMinutes}m` : 'Import historical candles and run a test'}
          </span>
        </div>
      </div>

      <div className="bg-[#222B36] border border-[#354251] rounded-xl p-5 space-y-3">
        <h4 className="text-sm font-semibold text-[#E8E5DE] flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-[#72A98B]" />
          Latest Historical Backtest
        </h4>
        {latestBacktest ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
            <div className="bg-[#17212D] rounded-lg border border-[#354251] p-3">
              <span className="text-[#AAB4BF] block text-[10px]">Test directional accuracy</span>
              <strong className="text-[#E8E5DE] text-lg">{(latestBacktest.metrics.testAccuracy * 100).toFixed(1)}%</strong>
              <span className="text-[#AAB4BF] block text-[10px]">scored n={latestBacktest.metrics.scoredTradeSampleSize} / total n={latestBacktest.metrics.sampleSize}</span>
            </div>
            <div className="bg-[#17212D] rounded-lg border border-[#354251] p-3">
              <span className="text-[#AAB4BF] block text-[10px]">Net-positive trade rate</span>
              <strong className="text-[#72A98B] text-lg">{(latestBacktest.metrics.winRate * 100).toFixed(1)}%</strong>
              <span className="text-[#AAB4BF] block text-[10px]">After modeled spread · scored n={latestBacktest.metrics.scoredTradeSampleSize}</span>
            </div>
            <div className="bg-[#17212D] rounded-lg border border-[#354251] p-3">
              <span className="text-[#AAB4BF] block text-[10px]">Expected value</span>
              <strong className="text-[#E8E5DE] text-lg">{latestBacktest.metrics.expectedValuePips.toFixed(2)}</strong>
              <span className="text-[#AAB4BF] block text-[10px]">Pips per sample</span>
            </div>
            <div className="bg-[#17212D] rounded-lg border border-[#354251] p-3">
              <span className="text-[#AAB4BF] block text-[10px]">Profit factor</span>
              <strong className="text-[#E8E5DE] text-lg">{latestBacktest.metrics.profitFactor.toFixed(2)}</strong>
              <span className="text-[#AAB4BF] block text-[10px]">Spread-adjusted simulation</span>
            </div>
            <div className="col-span-2 md:col-span-4 text-[#AAB4BF] text-xs">
              {latestBacktest.name} · Test period: {latestBacktest.testPeriod.start} – {latestBacktest.testPeriod.end}
              <br />
              95% CI for net-positive rate (scored n={latestBacktest.metrics.scoredTradeSampleSize}): {(latestBacktest.metrics.confidenceInterval95[0] * 100).toFixed(1)}%–{(latestBacktest.metrics.confidenceInterval95[1] * 100).toFixed(1)}%.
            </div>
          </div>
        ) : (
          <p className="text-xs text-[#AAB4BF]">No historical experiment has completed yet. Synthetic fallback data is not eligible for research results.</p>
        )}
      </div>

      <div className="bg-[#C5A36A]/10 border border-[#C5A36A]/40 rounded-lg p-4 flex gap-3 text-xs text-[#E8E5DE]">
        <AlertTriangle className="w-4 h-4 text-[#C5A36A] shrink-0 mt-0.5" />
        <div>
          <strong className="text-[#C5A36A]">Cost-model limitation:</strong> Historical results use configured spread assumptions, not tick-by-tick broker bid/ask quotes, variable slippage or commission. They are research estimates, not guaranteed execution results. Always compare them with the forward paper outcome ledger.
        </div>
      </div>

      <div className="bg-[#222B36] border border-[#354251] rounded-lg p-4 text-xs text-[#AAB4BF]">
        <div className="flex items-center gap-2 text-[#E8E5DE] font-semibold mb-1">
          <Activity className="w-4 h-4 text-[#6C9D91]" />
          Evidence policy
        </div>
        Forward paper win rate excludes scratches from the win/loss denominator but includes their net pips in cumulative PnL. Every rate is displayed with its scored sample count; total predictions and scratches are also reported. A single winning trade is never treated as proof that a strategy is validated.
      </div>
    </div>
  );
};
