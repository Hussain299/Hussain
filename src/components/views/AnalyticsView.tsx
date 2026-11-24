import React, { useState, useMemo } from 'react';
import {
  BarChart3,
  TrendingUp,
  Activity,
  Globe,
  PieChart,
  ArrowUpRight,
  ArrowDownRight,
  Sliders,
  CheckCircle2,
  XCircle,
  Clock,
  Layers,
} from 'lucide-react';
import {
  ResearchExperiment,
  ResearchSignal,
  FOREX_PAIRS,
  ForexSymbol,
  MarketSessionInfo,
} from '../../types/index.js';
import {
  BOT_DEFINITION,
  computeBotPerformance,
} from '../../utils/botControls.js';
import { getForwardObservations, summarizeForwardObservations } from '../../utils/tradeAccounting.js';

interface AnalyticsViewProps {
  signals: ResearchSignal[];
  experiments: ResearchExperiment[];
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ signals, experiments }) => {
  const [assetSortKey, setAssetSortKey] = useState<'winRate' | 'trades' | 'netUnits'>('winRate');

  // The append-only forward journal is the canonical all-time paper-outcome source.
  const forwardObservations = useMemo(() => getForwardObservations(experiments), [experiments]);
  const forwardStats = useMemo(() => summarizeForwardObservations(forwardObservations), [forwardObservations]);
  const wins = forwardStats.wins;
  const losses = forwardStats.losses;
  const scratches = forwardStats.scratches;
  const winRate = forwardStats.winRate;
  const totalNetUnits = forwardStats.netReturnUnits;

  // Operational counts such as currently active fills still come from the signal stream.
  const botStats = computeBotPerformance(signals);

  // Cumulative binary return uses each forward record's stored payout units.
  // No assumed 85% return or forex-pip fallback is applied to missing values.
  const equityPoints = useMemo(() => {
    const sorted = forwardObservations
      .filter(row => typeof row.observedNetReturnUnits === 'number' && Number.isFinite(row.observedNetReturnUnits))
      .sort((a, b) => {
        const ta = Date.parse(a.valPeriod?.end || a.createdAt || '0');
        const tb = Date.parse(b.valPeriod?.end || b.createdAt || '0');
        return ta - tb;
      });

    let cumUnits = 0;
    const points: Array<{ index: number; symbol: string; change: number; cumUnits: number; isWin: boolean; isScratch: boolean; time: string }> = [
      { index: 0, symbol: 'START', change: 0, cumUnits: 0, isWin: true, isScratch: false, time: 'Baseline' },
    ];

    sorted.forEach((row, i) => {
      const units = row.observedNetReturnUnits as number;
      cumUnits = Number((cumUnits + units).toFixed(2));
      points.push({
        index: i + 1,
        symbol: row.symbol,
        change: units,
        cumUnits,
        isWin: row.liveOutcome === 'WIN',
        isScratch: row.liveOutcome === 'SCRATCH',
        time: row.valPeriod?.end || row.createdAt || `Outcome ${i + 1}`,
      });
    });

    return points;
  }, [forwardObservations]);

  // Asset / Currency Pair Breakdown from retained forward outcomes.
  const pairStats = useMemo(() => {
    return FOREX_PAIRS.map(pair => {
      const pairTrades = forwardObservations.filter(row => row.symbol === pair);
      const pwins = pairTrades.filter(row => row.liveOutcome === 'WIN').length;
      const plosses = pairTrades.filter(row => row.liveOutcome === 'LOSS').length;
      const scored = pwins + plosses;
      const pwinRate = scored > 0 ? Number(((pwins / scored) * 100).toFixed(1)) : null;
      const pnetUnits = Number(
        pairTrades.reduce((acc, row) => acc + (typeof row.observedNetReturnUnits === 'number' ? row.observedNetReturnUnits : 0), 0).toFixed(2)
      );

      return {
        pair,
        totalTrades: pairTrades.length,
        scored,
        wins: pwins,
        losses: plosses,
        winRate: pwinRate,
        netUnits: pnetUnits,
      };
    }).sort((a, b) => {
      if (assetSortKey === 'winRate') {
        const wrA = a.winRate ?? -1;
        const wrB = b.winRate ?? -1;
        return wrB - wrA;
      }
      if (assetSortKey === 'trades') {
        return b.totalTrades - a.totalTrades;
      }
      return b.netUnits - a.netUnits;
    });
  }, [forwardObservations, assetSortKey]);

  // Global Market Session Matrix
  const sessionMatrix = useMemo(() => {
    const sessions = [
      { id: 'ASIA', name: 'Tokyo / Asian Session', ist: '05:30 AM - 12:30 PM IST' },
      { id: 'LONDON', name: 'London / European Session', ist: '12:30 PM - 05:30 PM IST' },
      { id: 'OVERLAP', name: 'London / NY Overlap', ist: '05:30 PM - 09:30 PM IST' },
      { id: 'NEW_YORK', name: 'New York Session', ist: '09:30 PM - 02:30 AM IST' },
    ];

    return sessions.map(sess => {
      const sTrades = forwardObservations.filter(row => String(row.parameters?.marketSession || '') === sess.id);
      const swins = sTrades.filter(row => row.liveOutcome === 'WIN').length;
      const slosses = sTrades.filter(row => row.liveOutcome === 'LOSS').length;
      const scored = swins + slosses;
      const swinRate = scored > 0 ? Number(((swins / scored) * 100).toFixed(1)) : null;
      const snetUnits = Number(
        sTrades.reduce((acc, row) => acc + (typeof row.observedNetReturnUnits === 'number' ? row.observedNetReturnUnits : 0), 0).toFixed(2)
      );

      return {
        ...sess,
        total: sTrades.length,
        wins: swins,
        losses: slosses,
        winRate: swinRate,
        netUnits: snetUnits,
      };
    });
  }, [forwardObservations]);

  // Equity SVG Path Calculation
  const svgWidth = 800;
  const svgHeight = 220;
  const padding = 35;

  const minUnits = Math.min(0, ...equityPoints.map(p => p.cumUnits));
  const maxUnits = Math.max(3, ...equityPoints.map(p => p.cumUnits));
  const unitsRange = maxUnits - minUnits || 1;

  const getSvgX = (index: number) => {
    if (equityPoints.length <= 1) return padding;
    return padding + (index / (equityPoints.length - 1)) * (svgWidth - padding * 2);
  };

  const getSvgY = (units: number) => {
    const normalized = (units - minUnits) / unitsRange;
    return svgHeight - padding - normalized * (svgHeight - padding * 2);
  };

  const polylinePoints = equityPoints
    .map(p => `${getSvgX(p.index)},${getSvgY(p.cumUnits)}`)
    .join(' ');

  const zeroY = getSvgY(0);

  return (
    <div className="w-full bg-[#121820] text-[#E8E5DE] min-h-screen font-sans pb-24">
      {/* Header */}
      <div className="border-b border-[#243040] bg-[#161F2B] px-4 lg:px-8 py-3.5 sticky top-16 z-20">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[#72A98B]" />
            <span className="text-sm font-black tracking-wide text-[#E8E5DE] uppercase">
              Quantitative Performance Analytics
            </span>
            <span className="text-[#354251]">/</span>
            <span className="text-[#AAB4BF]">
              Candle-Settled Paper Data &amp; Payout Curves
            </span>
          </div>

          <div className="text-xs text-[#AAB4BF]">
            Total Forward Outcomes: <strong className="text-[#E8E5DE]">{forwardStats.observations}</strong>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-6 space-y-8">
        {/* ------------------------------------------------------------- */}
        {/* SECTION 1: CUMULATIVE RETURN & EQUITY TRAJECTORY CHART */}
        {/* ------------------------------------------------------------- */}
        <div className="bg-[#161F2B] border border-[#243040] rounded-xl p-5 sm:p-6 space-y-4 shadow-lg font-mono">
          <div className="flex flex-wrap items-center justify-between pb-3 border-b border-[#243040] gap-3">
            <div>
              <h2 className="text-base font-bold text-[#E8E5DE] tracking-tight">
                Cumulative Net Units Trajectory
              </h2>
              <p className="text-xs text-[#AAB4BF] mt-0.5">
                Real binary payout compounding (+payout on win, -1 on loss) across all bot trades.
              </p>
            </div>

            <div className="flex items-center gap-4 text-xs">
              <div className="text-right">
                <span className="text-[10px] text-[#AAB4BF] block uppercase">Net Stake Gain</span>
                <span className={`text-xl font-black tabular-nums ${totalNetUnits >= 0 ? 'text-[#72A98B]' : 'text-[#B7797D]'}`}>
                  {totalNetUnits >= 0 ? `+${totalNetUnits}` : totalNetUnits} U
                </span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-[#AAB4BF] block uppercase">Scored Outcomes</span>
                <span className="text-xl font-black tabular-nums text-[#E8E5DE]">
                  {forwardStats.scoredOutcomes}
                </span>
              </div>
            </div>
          </div>

          {/* SVG Equity Chart */}
          <div className="w-full overflow-x-auto bg-[#121820] border border-[#243040] rounded-lg p-3">
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="w-full h-48 sm:h-64 overflow-visible"
            >
              <defs>
                <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#72A98B" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#72A98B" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Grid Lines */}
              <line
                x1={padding}
                y1={zeroY}
                x2={svgWidth - padding}
                y2={zeroY}
                stroke="#354251"
                strokeDasharray="3 3"
                strokeWidth="1"
              />
              <text
                x={padding - 5}
                y={zeroY + 3}
                fill="#AAB4BF"
                fontSize="9"
                textAnchor="end"
                fontFamily="monospace"
              >
                0.0 U
              </text>

              <line
                x1={padding}
                y1={getSvgY(maxUnits)}
                x2={svgWidth - padding}
                y2={getSvgY(maxUnits)}
                stroke="#243040"
                strokeWidth="1"
              />
              <text
                x={padding - 5}
                y={getSvgY(maxUnits) + 3}
                fill="#72A98B"
                fontSize="9"
                textAnchor="end"
                fontFamily="monospace"
              >
                +{maxUnits.toFixed(1)} U
              </text>

              {/* Area fill */}
              {equityPoints.length > 1 && (
                <polygon
                  points={`${padding},${zeroY} ${polylinePoints} ${getSvgX(equityPoints.length - 1)},${zeroY}`}
                  fill="url(#equityGrad)"
                />
              )}

              {/* Line */}
              {equityPoints.length > 1 ? (
                <polyline
                  points={polylinePoints}
                  fill="none"
                  stroke="#72A98B"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : (
                <text
                  x={svgWidth / 2}
                  y={svgHeight / 2}
                  fill="#AAB4BF"
                  fontSize="12"
                  textAnchor="middle"
                  fontFamily="monospace"
                >
                  Accumulating executed trade outcomes...
                </text>
              )}

              {/* Data Dots */}
              {equityPoints.map((p, i) => {
                if (i === 0) return null;
                const cx = getSvgX(p.index);
                const cy = getSvgY(p.cumUnits);
                return (
                  <circle
                    key={i}
                    cx={cx}
                    cy={cy}
                    r={3}
                    fill={p.isScratch ? '#AAB4BF' : p.isWin ? '#72A98B' : '#B7797D'}
                    stroke="#121820"
                    strokeWidth="1.5"
                  />
                );
              })}
            </svg>
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* SECTION 2: AUTONOMOUS BOT PERFORMANCE & STATISTICAL EDGE */}
        {/* ------------------------------------------------------------- */}
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-bold text-[#E8E5DE] tracking-tight">
              {BOT_DEFINITION.name} — Statistical Edge &amp; Attribution
            </h2>
            <p className="text-xs text-[#AAB4BF] mt-0.5">
              Unified quantitative telemetry across real-time 5M causal execution and multi-strategy confluence.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 font-mono">
            {/* Card 1: Execution Edge */}
            <div className="bg-[#161F2B] border border-[#243040] rounded-xl p-5 space-y-4 shadow-md">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">
                    Core Accuracy
                  </span>
                  <h3 className="text-base font-black text-[#E8E5DE] mt-0.5">Execution Edge</h3>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold border bg-[#72A98B]/15 text-[#72A98B] border-[#72A98B]/30">
                  PAPER
                </span>
              </div>

              <div className="space-y-2.5 py-3 border-y border-[#243040] text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[#AAB4BF]">Realized Win Rate:</span>
                  <span className="text-base font-black text-[#E8E5DE] tabular-nums">
                    {winRate !== null ? `${winRate}%` : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#AAB4BF]">Record (W / L / S):</span>
                  <span className="text-[#72A98B] font-bold">
                    {wins}W / {losses}L / {scratches}S
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#AAB4BF]">Settled Trades:</span>
                  <span className="text-[#E8E5DE] font-bold tabular-nums">
                    {forwardStats.observations}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#AAB4BF]">Active In-Market:</span>
                  <span className="text-[#C4A574] font-bold tabular-nums">
                    {botStats.activeCount}
                  </span>
                </div>
              </div>

              <div className="text-[11px] text-[#AAB4BF] leading-relaxed">
                Evaluated at binary candle close with zero-lag candle open entry.
              </div>
            </div>

            {/* Card 2: Compounding & Risk Metrics */}
            <div className="bg-[#161F2B] border border-[#243040] rounded-xl p-5 space-y-4 shadow-md">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">
                    Financial Expectancy
                  </span>
                  <h3 className="text-base font-black text-[#E8E5DE] mt-0.5">Risk &amp; Payoff</h3>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold border bg-[#6C9D91]/15 text-[#6C9D91] border-[#6C9D91]/30">
                  METRICS
                </span>
              </div>

              <div className="space-y-2.5 py-3 border-y border-[#243040] text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[#AAB4BF]">Profit Factor:</span>
                  <span className="text-base font-black text-[#E8E5DE] tabular-nums">
                    {forwardStats.profitFactor !== null ? forwardStats.profitFactor.toFixed(2) : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#AAB4BF]">Net P&amp;L Units:</span>
                  <span className={`font-black ${botStats.netUnits >= 0 ? 'text-[#72A98B]' : 'text-[#B7797D]'}`}>
                    {totalNetUnits >= 0 ? `+${totalNetUnits}` : totalNetUnits} U
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#AAB4BF]">Records missing return:</span>
                  <span className="font-bold text-[#E8E5DE]">{forwardStats.missingReturnCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#AAB4BF]">Target R:R:</span>
                  <span className="text-[#72A98B] font-bold">+1.5 : 1 (12p TP / 8p SL)</span>
                </div>
              </div>

              <div className="text-[11px] text-[#AAB4BF] leading-relaxed">
                Candle-based paper settlement at the saved payout; broker fills are not verified.
              </div>
            </div>

            {/* Card 3: Confluence Architecture */}
            <div className="bg-[#161F2B] border border-[#243040] rounded-xl p-5 space-y-4 shadow-md">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">
                    Engine Pillars
                  </span>
                  <h3 className="text-base font-black text-[#E8E5DE] mt-0.5">Confluence Triad</h3>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold border bg-[#C4A574]/15 text-[#C4A574] border-[#C4A574]/30">
                  AUTONOMOUS
                </span>
              </div>

              <div className="space-y-2.5 py-3 border-y border-[#243040] text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[#AAB4BF]">Pillar 1: Momentum</span>
                  <span className="text-[#72A98B] font-bold">EMA 9/21/50 + ADX &gt; 22</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#AAB4BF]">Pillar 2: Reversion</span>
                  <span className="text-[#6C9D91] font-bold">Bollinger 2.5σ + OB</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#AAB4BF]">Pillar 3: Neural</span>
                  <span className="text-[#C4A574] font-bold">Policy Probability Veto</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#AAB4BF]">Candle Execution</span>
                  <span className="text-[#E8E5DE] font-bold">5M Fixed Binary Settlement</span>
                </div>
              </div>

              <div className="text-[11px] text-[#AAB4BF] leading-relaxed">
                All three quantitative disciplines are fused into every autonomous trade decision.
              </div>
            </div>
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* SECTION 3: ASSET & CURRENCY PAIR PERFORMANCE MATRIX */}
        {/* ------------------------------------------------------------- */}
        <div className="bg-[#161F2B] border border-[#243040] rounded-xl p-5 sm:p-6 space-y-4 shadow-lg font-mono">
          <div className="flex flex-wrap items-center justify-between pb-3 border-b border-[#243040] gap-3">
            <div>
              <h2 className="text-base font-bold text-[#E8E5DE] tracking-tight">
                Currency Pair Asset Performance Matrix
              </h2>
              <p className="text-xs text-[#AAB4BF] mt-0.5">
                Observed trade accuracy and net return distribution across all 20 monitored pairs.
              </p>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-[#AAB4BF]">Sort By:</span>
              <div className="flex items-center bg-[#121820] border border-[#243040] p-0.5 rounded">
                <button
                  onClick={() => setAssetSortKey('winRate')}
                  className={`px-2.5 py-1 rounded text-xs cursor-pointer transition-colors ${
                    assetSortKey === 'winRate' ? 'bg-[#243040] text-[#E8E5DE] font-bold' : 'text-[#AAB4BF]'
                  }`}
                >
                  Win Rate
                </button>
                <button
                  onClick={() => setAssetSortKey('trades')}
                  className={`px-2.5 py-1 rounded text-xs cursor-pointer transition-colors ${
                    assetSortKey === 'trades' ? 'bg-[#243040] text-[#E8E5DE] font-bold' : 'text-[#AAB4BF]'
                  }`}
                >
                  Volume
                </button>
                <button
                  onClick={() => setAssetSortKey('netUnits')}
                  className={`px-2.5 py-1 rounded text-xs cursor-pointer transition-colors ${
                    assetSortKey === 'netUnits' ? 'bg-[#243040] text-[#E8E5DE] font-bold' : 'text-[#AAB4BF]'
                  }`}
                >
                  Net Units
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {pairStats.map(item => {
              const wr = item.winRate ?? 0;
              const hasTrades = item.totalTrades > 0;

              return (
                <div
                  key={item.pair}
                  className="bg-[#121820] border border-[#243040] rounded-lg p-3 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-black text-sm text-[#E8E5DE]">{item.pair}</span>
                    <span
                      className={`font-bold tabular-nums text-sm ${
                        item.winRate === null
                          ? 'text-[#AAB4BF]'
                          : wr >= 70
                          ? 'text-[#72A98B]'
                          : wr >= 55.6
                          ? 'text-[#C5A36A]'
                          : 'text-[#B7797D]'
                      }`}
                    >
                      {item.winRate !== null ? `${item.winRate}%` : 'Standby'}
                    </span>
                  </div>

                  {/* Win rate visual progress bar */}
                  <div className="h-1.5 w-full bg-[#161F2B] rounded-full overflow-hidden">
                    <div
                      style={{ width: `${item.winRate !== null ? Math.min(100, wr) : 0}%` }}
                      className={`h-full ${
                        wr >= 70 ? 'bg-[#72A98B]' : wr >= 55.6 ? 'bg-[#C5A36A]' : 'bg-[#B7797D]'
                      }`}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-[#AAB4BF] pt-0.5">
                    <span>
                      {hasTrades ? `${item.wins}W · ${item.losses}L` : '0 Trades'}
                    </span>
                    <span className={item.netUnits >= 0 ? 'text-[#72A98B] font-bold' : 'text-[#B7797D] font-bold'}>
                      {item.netUnits >= 0 ? `+${item.netUnits}` : item.netUnits} U
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* SECTION 4: GLOBAL TRADING SESSION ACCURACY MATRIX */}
        {/* ------------------------------------------------------------- */}
        <div className="bg-[#161F2B] border border-[#243040] rounded-xl p-5 sm:p-6 space-y-4 shadow-lg font-mono">
          <div className="pb-3 border-b border-[#243040]">
            <h2 className="text-base font-bold text-[#E8E5DE] tracking-tight">
              Global Market Session Accuracy Matrix (IST)
            </h2>
            <p className="text-xs text-[#AAB4BF] mt-0.5">
              Historical performance stratified across regional institutional liquidity centers.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            {sessionMatrix.map((sess, idx) => (
              <div
                key={`analytics_sess_${sess.id}_${idx}`}
                className="bg-[#121820] border border-[#243040] rounded-lg p-4 space-y-2.5 flex flex-col justify-between"
              >
                <div>
                  <div className="text-[#AAB4BF] text-[10px] uppercase font-bold">{sess.name}</div>
                  <div className="text-2xl font-black text-[#E8E5DE] mt-1 tabular-nums">
                    {sess.winRate !== null ? `${sess.winRate}%` : '—'}
                  </div>
                  <div className="text-[10px] text-[#72A98B] font-bold mt-0.5">
                    {sess.wins} Wins · {sess.losses} Losses
                  </div>
                </div>

                <div className="pt-2 border-t border-[#243040] text-[11px] space-y-1">
                  <div className="flex items-center justify-between text-[#AAB4BF]">
                    <span>Window:</span>
                    <strong className="text-[#E8E5DE]">{sess.ist}</strong>
                  </div>
                  <div className="flex items-center justify-between text-[#AAB4BF]">
                    <span>Net Gain:</span>
                    <strong className={sess.netUnits >= 0 ? 'text-[#72A98B]' : 'text-[#B7797D]'}>
                      {sess.netUnits >= 0 ? `+${sess.netUnits}` : sess.netUnits} U
                    </strong>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
