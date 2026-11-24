import React from 'react';
import { BarChart3, TrendingUp, Activity, AlertTriangle } from 'lucide-react';
import { ResearchExperiment, ResearchSignal } from '../../types/index.js';
import { getForwardObservations, summarizeForwardObservations, summarizeSignalAccounting } from '../../utils/tradeAccounting.js';

interface PerformanceAnalyticsViewProps {
  experiments: ResearchExperiment[];
  signals: ResearchSignal[];
}

export const PerformanceAnalyticsView: React.FC<PerformanceAnalyticsViewProps> = ({
  experiments,
  signals,
}) => {
  // The append-only forward journal is the all-time performance source.
  // The signal list is a rolling operational view and may no longer contain older settled rows.
  const forwardObservations = getForwardObservations(experiments);
  const forwardStats = summarizeForwardObservations(forwardObservations);
  const signalStats = summarizeSignalAccounting(signals);
  const wins = forwardStats.wins;
  const losses = forwardStats.losses;
  const scratches = forwardStats.scratches;
  const winRate = forwardStats.winRate;
  const totalNetUnits = forwardStats.netReturnUnits;

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
          All-time forward paper results come from the retained outcome ledger. They use candle prices and saved payout assumptions, not verified broker executions.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 font-mono text-xs">
        <div className="bg-[#222B36] border border-[#354251] rounded-lg p-4">
          <span className="text-[#AAB4BF] text-[10px] block uppercase">Forward Signal Win Rate</span>
          <span className={`text-2xl font-bold tabular-nums ${winRate !== null && winRate >= 70 ? 'text-[#72A98B]' : winRate !== null && winRate >= 55.6 ? 'text-[#C5A36A]' : winRate !== null ? 'text-[#B7797D]' : 'text-[#AAB4BF]'}`}>
            {winRate === null ? 'No data' : `${winRate.toFixed(1)}%`}
          </span>
          <span className="text-[10px] text-[#AAB4BF] block mt-1">
            {wins}W / {losses}L · n={forwardStats.scoredOutcomes} · {scratches} scratches
          </span>
        </div>

        <div className="bg-[#222B36] border border-[#354251] rounded-lg p-4">
          <span className="text-[#AAB4BF] text-[10px] block uppercase">Cumulative Forward Return</span>
          <span className={`text-2xl font-bold tabular-nums ${totalNetUnits >= 0 ? 'text-[#72A98B]' : 'text-[#B7797D]'}`}>
            {forwardStats.observations === 0 ? 'No data' : `${totalNetUnits >= 0 ? '+' : ''}${totalNetUnits.toFixed(2)} U`}
          </span>
          <span className="text-[10px] text-[#AAB4BF] block mt-1">
            {forwardStats.missingReturnCount ? `${forwardStats.missingReturnCount} observations missing return units` : 'Net binary payout in stake units'}
          </span>
        </div>

        <div className="bg-[#222B36] border border-[#354251] rounded-lg p-4">
          <span className="text-[#AAB4BF] text-[10px] block uppercase">Forward Outcome Records</span>
          <span className="text-2xl font-bold tabular-nums text-[#E8E5DE]">{forwardStats.observations}</span>
          <span className="text-[10px] text-[#AAB4BF] block mt-1">{scratches} scratches · retained independently of signal history</span>
        </div>

        <div className="bg-[#222B36] border border-[#354251] rounded-lg p-4">
          <span className="text-[#AAB4BF] text-[10px] block uppercase">Current Signal Setups</span>
          <span className="text-2xl font-bold tabular-nums text-[#E8E5DE]">{signalStats.signalSetups}</span>
          <span className="text-[10px] text-[#AAB4BF] block mt-1">Rolling signal window, not trade count</span>
        </div>

        <div className="bg-[#222B36] border border-[#354251] rounded-lg p-4">
          <span className="text-[#AAB4BF] text-[10px] block uppercase">Filled / Expired Unfilled</span>
          <span className="text-2xl font-bold tabular-nums text-[#E8E5DE]">{signalStats.filledContracts} / {signalStats.expiredUnfilledSetups}</span>
          <span className="text-[10px] text-[#AAB4BF] block mt-1">Expired setups are excluded from trading results</span>
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
        Forward paper win rate excludes scratches from the win/loss denominator. Net return is reported only in stake units using each record's saved payout; missing values are not replaced with invented pips or default payouts. A single winning trade is never treated as proof that a strategy is validated.
      </div>
    </div>
  );
};
