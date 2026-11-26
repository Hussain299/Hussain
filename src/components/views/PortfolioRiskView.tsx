import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Gauge,
  Layers,
  RotateCw,
  ShieldCheck,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { InstitutionalSignalRiskAudit } from '../../types/index.js';

interface CurrencyStrengthEntry {
  currency: string;
  score: number;
  pairsSampled: number;
  rank: number;
  bias: 'STRONG' | 'NEUTRAL' | 'WEAK';
}

interface CurrencyExposureRow {
  currency: string;
  netExposureUnits: number;
  longCount: number;
  shortCount: number;
  openPairs: string[];
}

interface PromotionCandidateGate {
  candidateName: string;
  sampleCount: number;
  minRequiredSamples: number;
  winRatePct: number | null;
  wilson95LowerPct: number | null;
  breakEvenPct: number;
  brierScore: number | null;
  brierSkillVsPrevalence: number | null;
  ece: number | null;
  netReturnUnits: number;
  checks: {
    hasMinSample: boolean;
    beatsBreakEvenOnWilsonLower: boolean;
    positiveNetUnits: boolean;
    positiveBrierSkill: boolean;
  };
  progressPct: number;
  status: 'READY_FOR_PROMOTION' | 'COLLECTING_EVIDENCE' | 'INSUFFICIENT_EDGE';
}

interface InstitutionalDeskPayload {
  generatedAtUtc: string;
  currencyStrength: {
    updatedAtUtc: string;
    activePairsCount: number;
    currencies: CurrencyStrengthEntry[];
  };
  exposureMatrix: CurrencyExposureRow[];
  portfolioStats: {
    settledCount: number;
    wins: number;
    losses: number;
    scratches: number;
    winRatePct: number | null;
    wilson95LowerPct: number | null;
    wilson95UpperPct: number | null;
    netReturnUnits: number;
    expectancyUnitsPerTrade: number;
    profitFactor: number;
    sharpePerTrade: number;
    sortinoPerTrade: number;
    maxDrawdownUnits: number;
    currentDrawdownUnits: number;
    var95Units: number;
    cvar95Units: number;
    longestWinStreak: number;
    longestLossStreak: number;
    drawdownMode: 'NORMAL' | 'CAUTION_HALF' | 'DEFENSE_QUARTER';
    drawdownThrottleFactor: number;
  };
  promotionGate: {
    minRequiredSamples: number;
    breakEvenAt80Pct: number;
    shadowCalibrator: PromotionCandidateGate;
    agentCouncil: PromotionCandidateGate;
  };
  recentRiskSnapshots: Array<{
    signalId: string;
    symbol: string;
    direction: 'BUY' | 'SELL';
    predictionTimeUtc: string;
    predictionTimeIst: string;
    lifecycleState: string;
    outcomeResult: string;
    netReturnUnits?: number | null;
    institutionalRisk: InstitutionalSignalRiskAudit;
  }>;
}

export const PortfolioRiskView: React.FC = () => {
  const [data, setData] = useState<InstitutionalDeskPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDesk = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/quant/institutional', { cache: 'no-store' });
      if (res.ok) {
        setData(await res.json());
      }
    } catch (e) {
      console.warn('Failed to fetch institutional quant desk telemetry:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDesk();
    const timer = setInterval(() => void fetchDesk(), 10_000);
    return () => clearInterval(timer);
  }, []);

  const stats = data?.portfolioStats;
  const strength = data?.currencyStrength;
  const exposures = data?.exposureMatrix || [];
  const promo = data?.promotionGate;

  const renderCheckPill = (ok: boolean, label: string) => (
    <div className="flex items-center justify-between text-[11px] py-1 border-b border-[#243040]/50 last:border-b-0">
      <span className="text-[#AAB4BF]">{label}</span>
      <span className={`inline-flex items-center gap-1 font-bold ${ok ? 'text-[#72A98B]' : 'text-[#C4A574]'}`}>
        {ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5 text-[#AAB4BF]/60" />}
        {ok ? 'PASS' : 'PENDING'}
      </span>
    </div>
  );

  return (
    <div className="w-full bg-[#121820] text-[#E8E5DE] min-h-screen font-sans pb-24">
      {/* Sticky Desk Header */}
      <div className="border-b border-[#243040] bg-[#161F2B] px-4 lg:px-8 py-3.5 sticky top-24 z-20">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-[#72A98B]" />
            <span className="text-sm font-black tracking-wide text-[#E8E5DE] uppercase">
              Institutional Quant Desk &amp; Portfolio Risk
            </span>
            <span className="text-[#354251]">·</span>
            <span className="text-[#AAB4BF]">
              Quarter-Kelly Sizing · 8-Currency Factor Exposure · Statistical Promotion Gate
            </span>
          </div>
          <div className="flex items-center gap-2">
            {stats && (
              <span
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                  stats.drawdownMode === 'NORMAL'
                    ? 'bg-[#72A98B]/15 text-[#72A98B] border-[#72A98B]/35'
                    : stats.drawdownMode === 'CAUTION_HALF'
                      ? 'bg-[#C4A574]/15 text-[#C4A574] border-[#C4A574]/35'
                      : 'bg-[#B7797D]/15 text-[#B7797D] border-[#B7797D]/35'
                }`}
              >
                RISK MODE: {stats.drawdownMode} ({stats.drawdownThrottleFactor}x)
              </span>
            )}
            <button
              onClick={() => void fetchDesk()}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#121820] hover:bg-[#243040] border border-[#243040] text-[#AAB4BF] hover:text-[#E8E5DE] font-semibold transition-colors cursor-pointer"
            >
              <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#72A98B]' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-6 space-y-6 font-mono text-xs">
        {/* 1. Portfolio Risk-Adjusted Performance KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="sf-panel rounded-xl p-4 space-y-1">
            <span className="text-[10px] text-[#AAB4BF] uppercase block">Settled Win Rate</span>
            <div className="text-xl font-black text-[#E8E5DE] tabular-nums">
              {stats?.winRatePct !== null && stats?.winRatePct !== undefined ? `${stats.winRatePct}%` : '—'}
            </div>
            <span className="text-[10px] text-[#AAB4BF] block">
              95% CI Low: {stats?.wilson95LowerPct !== null && stats?.wilson95LowerPct !== undefined ? `${stats.wilson95LowerPct}%` : '—'}
            </span>
          </div>

          <div className="sf-panel rounded-xl p-4 space-y-1">
            <span className="text-[10px] text-[#AAB4BF] uppercase block">Net Return</span>
            <div
              className={`text-xl font-black tabular-nums ${
                (stats?.netReturnUnits ?? 0) >= 0 ? 'text-[#72A98B]' : 'text-[#B7797D]'
              }`}
            >
              {(stats?.netReturnUnits ?? 0) >= 0 ? '+' : ''}
              {(stats?.netReturnUnits ?? 0).toFixed(2)} U
            </div>
            <span className="text-[10px] text-[#AAB4BF] block">
              EV: {(stats?.expectancyUnitsPerTrade ?? 0) >= 0 ? '+' : ''}
              {(stats?.expectancyUnitsPerTrade ?? 0).toFixed(3)} U/trade
            </span>
          </div>

          <div className="sf-panel rounded-xl p-4 space-y-1">
            <span className="text-[10px] text-[#AAB4BF] uppercase block">Sharpe / Sortino</span>
            <div className="text-xl font-black text-[#6C9D91] tabular-nums">
              {stats?.sharpePerTrade?.toFixed(2) ?? '0.00'} <span className="text-sm text-[#AAB4BF]">/ {stats?.sortinoPerTrade?.toFixed(2) ?? '0.00'}</span>
            </div>
            <span className="text-[10px] text-[#AAB4BF] block">Per settled contract</span>
          </div>

          <div className="sf-panel rounded-xl p-4 space-y-1">
            <span className="text-[10px] text-[#AAB4BF] uppercase block">Profit Factor</span>
            <div className="text-xl font-black text-[#C4A574] tabular-nums">
              {stats?.profitFactor?.toFixed(2) ?? '0.00'}
            </div>
            <span className="text-[10px] text-[#AAB4BF] block">
              {stats?.wins ?? 0}W - {stats?.losses ?? 0}L ({stats?.scratches ?? 0}T)
            </span>
          </div>

          <div className="sf-panel rounded-xl p-4 space-y-1">
            <span className="text-[10px] text-[#AAB4BF] uppercase block">Max Drawdown</span>
            <div className="text-xl font-black text-[#B7797D] tabular-nums">
              -{stats?.maxDrawdownUnits?.toFixed(2) ?? '0.00'} U
            </div>
            <span className="text-[10px] text-[#AAB4BF] block">
              Current DD: -{stats?.currentDrawdownUnits?.toFixed(2) ?? '0.00'} U
            </span>
          </div>

          <div className="sf-panel rounded-xl p-4 space-y-1">
            <span className="text-[10px] text-[#AAB4BF] uppercase block">Tail 95% CVaR</span>
            <div className="text-xl font-black text-[#E8E5DE] tabular-nums">
              -{stats?.cvar95Units?.toFixed(2) ?? '0.00'} U
            </div>
            <span className="text-[10px] text-[#AAB4BF] block">
              Max Loss Streak: {stats?.longestLossStreak ?? 0}
            </span>
          </div>
        </div>

        {/* 2. Currency Strength Heatmap & Active Factor Exposure */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="sf-panel rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between pb-2.5 border-b border-[#243040]">
              <div className="flex items-center gap-2">
                <Gauge className="w-4 h-4 text-[#6C9D91]" />
                <span className="text-sm font-bold text-[#E8E5DE]">Cross-Sectional 8-Currency Strength</span>
              </div>
              <span className="text-[10px] text-[#AAB4BF]">
                Sampled Pairs: {strength?.activePairsCount ?? 0}
              </span>
            </div>

            <div className="space-y-2.5">
              {(strength?.currencies || []).map((c) => {
                const absPct = Math.min(100, Math.abs(c.score));
                const isPos = c.score >= 0;
                return (
                  <div key={c.currency} className="flex items-center gap-3">
                    <span className="w-8 font-bold text-[#E8E5DE]">{c.currency}</span>
                    <div className="flex-1 h-2.5 rounded-full bg-[#121820] border border-[#243040] overflow-hidden relative">
                      <div
                        style={{ width: `${absPct}%` }}
                        className={`h-full rounded-full transition-all ${
                          isPos ? 'bg-[#72A98B]' : 'bg-[#B7797D]'
                        }`}
                      />
                    </div>
                    <span
                      className={`w-14 text-right font-bold tabular-nums ${
                        isPos ? 'text-[#72A98B]' : 'text-[#B7797D]'
                      }`}
                    >
                      {isPos ? '+' : ''}
                      {c.score.toFixed(1)}
                    </span>
                    <span
                      className={`w-16 text-center px-1.5 py-0.5 rounded text-[9px] font-bold ${
                        c.bias === 'STRONG'
                          ? 'bg-[#72A98B]/15 text-[#72A98B]'
                          : c.bias === 'WEAK'
                            ? 'bg-[#B7797D]/15 text-[#B7797D]'
                            : 'bg-[#243040]/60 text-[#AAB4BF]'
                      }`}
                    >
                      {c.bias}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="sf-panel rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between pb-2.5 border-b border-[#243040]">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#C4A574]" />
                <span className="text-sm font-bold text-[#E8E5DE]">Open Portfolio Currency Factor Exposure</span>
              </div>
              <span className="text-[10px] text-[#AAB4BF]">Prevents correlated risk stacking</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {exposures.map((row) => (
                <div
                  key={row.currency}
                  className={`p-3 rounded-lg border bg-[#121820] space-y-1 ${
                    Math.abs(row.netExposureUnits) >= 2
                      ? 'border-[#C4A574]/60'
                      : 'border-[#243040]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#E8E5DE]">{row.currency}</span>
                    <span
                      className={`font-black tabular-nums ${
                        row.netExposureUnits > 0
                          ? 'text-[#72A98B]'
                          : row.netExposureUnits < 0
                            ? 'text-[#B7797D]'
                            : 'text-[#AAB4BF]'
                      }`}
                    >
                      {row.netExposureUnits > 0 ? `+${row.netExposureUnits}` : row.netExposureUnits}
                    </span>
                  </div>
                  <div className="text-[10px] text-[#AAB4BF]">
                    +{row.longCount}L / -{row.shortCount}S
                  </div>
                </div>
              ))}
            </div>
            <div className="p-3 rounded-lg bg-[#121820] border border-[#243040] text-[11px] text-[#AAB4BF]">
              <strong className="text-[#E8E5DE]">Correlation Policy:</strong> Stacking &ge; 2 open positions on the same currency factor flags <span className="text-[#C4A574] font-bold">HIGH</span> correlation load in signal risk audits.
            </div>
          </div>
        </div>

        {/* 3. Shadow-to-Live Automated Promotion Readiness Gate */}
        {promo && (
          <div className="sf-panel rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between pb-2.5 border-b border-[#243040] gap-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#72A98B]" />
                <span className="text-sm font-bold text-[#E8E5DE]">
                  Shadow-to-Live Statistical Promotion Gate (Required before autonomous live replacement)
                </span>
              </div>
              <span className="text-[10px] text-[#C4A574]">
                Break-even @ 80% payout: {promo.breakEvenAt80Pct}% · Min sample: n &ge; {promo.minRequiredSamples}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[promo.shadowCalibrator, promo.agentCouncil].map((cand) => (
                <div key={cand.candidateName} className="p-4 rounded-xl bg-[#121820] border border-[#243040] space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-[#E8E5DE]">{cand.candidateName}</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        cand.status === 'READY_FOR_PROMOTION'
                          ? 'bg-[#72A98B]/20 text-[#72A98B] border border-[#72A98B]/40'
                          : cand.status === 'COLLECTING_EVIDENCE'
                            ? 'bg-[#C4A574]/20 text-[#C4A574] border border-[#C4A574]/40'
                            : 'bg-[#B7797D]/20 text-[#B7797D] border border-[#B7797D]/40'
                      }`}
                    >
                      {cand.status}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-[#AAB4BF]">
                      <span>Evidence Sample Progress</span>
                      <span>
                        {cand.sampleCount} / {cand.minRequiredSamples} ({cand.progressPct}%)
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-[#161F2B] border border-[#243040] overflow-hidden">
                      <div
                        style={{ width: `${cand.progressPct}%` }}
                        className="h-full bg-[#6C9D91] transition-all"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center bg-[#161F2B] p-2.5 rounded-lg border border-[#243040]">
                    <div>
                      <span className="text-[9px] text-[#AAB4BF] block">Win Rate</span>
                      <span className="font-bold text-[#E8E5DE]">
                        {cand.winRatePct !== null ? `${cand.winRatePct}%` : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] text-[#AAB4BF] block">Wilson 95% Low</span>
                      <span className="font-bold text-[#C4A574]">
                        {cand.wilson95LowerPct !== null ? `${cand.wilson95LowerPct}%` : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] text-[#AAB4BF] block">Net Units</span>
                      <span className={`font-bold ${cand.netReturnUnits >= 0 ? 'text-[#72A98B]' : 'text-[#B7797D]'}`}>
                        {cand.netReturnUnits >= 0 ? '+' : ''}
                        {cand.netReturnUnits.toFixed(2)} U
                      </span>
                    </div>
                  </div>

                  <div className="space-y-0.5 pt-1">
                    {renderCheckPill(cand.checks.hasMinSample, `Sample size n >= ${cand.minRequiredSamples}`)}
                    {renderCheckPill(cand.checks.beatsBreakEvenOnWilsonLower, `Wilson 95% Lower >= ${cand.breakEvenPct}%`)}
                    {renderCheckPill(cand.checks.positiveNetUnits, 'Positive Realized Net Return Units')}
                    {renderCheckPill(cand.checks.positiveBrierSkill, 'Brier Skill > Prevalence Baseline')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 4. Recent Per-Signal Kelly & Microstructure Risk Audits */}
        <div className="sf-panel rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between pb-2.5 border-b border-[#243040]">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#72A98B]" />
              <span className="text-sm font-bold text-[#E8E5DE]">Recent Signal Kelly Sizing &amp; Multi-Timeframe Risk Audits</span>
            </div>
            <span className="text-[10px] text-[#AAB4BF]">Quarter-Kelly cap 3.0% equity/trade</span>
          </div>

          {(!data?.recentRiskSnapshots || data.recentRiskSnapshots.length === 0) ? (
            <div className="p-6 rounded-lg bg-[#121820] border border-[#243040] text-center text-[#AAB4BF]">
              No new signals have recorded Quarter-Kelly &amp; M5/M15 microstructure audits yet. New active Olymp Trade signals automatically populate this ledger.
            </div>
          ) : (
            <div className="overflow-x-auto border border-[#243040] rounded-xl bg-[#121820]">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#243040] text-[#AAB4BF] text-[10px] uppercase">
                    <th className="py-2.5 px-4">Pair</th>
                    <th className="py-2.5 px-3">Quarter-Kelly Stake</th>
                    <th className="py-2.5 px-3">M5 / M15 Bias</th>
                    <th className="py-2.5 px-3">MTF Align</th>
                    <th className="py-2.5 px-3">Currency Spread</th>
                    <th className="py-2.5 px-3">Corr Risk</th>
                    <th className="py-2.5 px-3">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentRiskSnapshots.map((row) => {
                    const r = row.institutionalRisk;
                    return (
                      <tr key={row.signalId} className="border-b border-[#243040]/50 hover:bg-[#161F2B]/50">
                        <td className="py-2.5 px-4 font-bold text-[#E8E5DE]">
                          {row.symbol} <span className={row.direction === 'BUY' ? 'text-[#72A98B]' : 'text-[#B7797D]'}>{row.direction}</span>
                        </td>
                        <td className="py-2.5 px-3 font-bold text-[#6C9D91] tabular-nums">
                          {r.suggestedStakePct.toFixed(2)}%
                        </td>
                        <td className="py-2.5 px-3 text-[#E8E5DE]">
                          {r.m5TrendBias} / {r.m15TrendBias}
                        </td>
                        <td className={`py-2.5 px-3 font-bold tabular-nums ${r.mtfAlignmentScore >= 0 ? 'text-[#72A98B]' : 'text-[#B7797D]'}`}>
                          {r.mtfAlignmentScore >= 0 ? '+' : ''}
                          {r.mtfAlignmentScore.toFixed(2)}
                        </td>
                        <td className={`py-2.5 px-3 font-bold tabular-nums ${r.currencyStrengthSpread >= 0 ? 'text-[#72A98B]' : 'text-[#B7797D]'}`}>
                          {r.currencyStrengthSpread >= 0 ? '+' : ''}
                          {r.currencyStrengthSpread.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              r.correlationRiskLevel === 'LOW'
                                ? 'bg-[#72A98B]/15 text-[#72A98B]'
                                : r.correlationRiskLevel === 'MODERATE'
                                  ? 'bg-[#C4A574]/15 text-[#C4A574]'
                                  : 'bg-[#B7797D]/15 text-[#B7797D]'
                            }`}
                          >
                            {r.correlationRiskLevel} ({r.sameFactorOpenCount})
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-[#AAB4BF]">{row.outcomeResult}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
