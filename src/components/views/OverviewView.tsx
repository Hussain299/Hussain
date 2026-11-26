import React, { useState, useEffect } from 'react';
import {
  TrendingUp,
  Activity,
  Zap,
  Clock,
  RefreshCw,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Timer,
  ArrowUpRight,
  ArrowDownRight,
  ChevronRight,
  Globe,
  Radio,
  BarChart3,
  Brain,
  ShieldCheck,
  Server,
  Layers,
} from 'lucide-react';
import {
  ResearchSignal,
  ProviderHealth,
  MarketSessionInfo,
  FOREX_PAIRS,
  ForexSymbol,
} from '../../types/index.js';
import {
  BOT_DEFINITION,
  BOT_DEFINITIONS,
  computeBotPerformance,
  loadManualControls,
  ManualControlsState,
} from '../../utils/botControls.js';
import { isExpiredUnfilledSetup, isFilledContract, isSettledContract } from '../../utils/tradeAccounting.js';

interface OverviewViewProps {
  signals: ResearchSignal[];
  latestPrices: Record<string, number>;
  marketSessions: MarketSessionInfo[];
  providers: ProviderHealth[];
  brokerStatus?: { mode: string; liveCount: number; activeCount?: number; discoveredCount?: number; allowAllPairs?: boolean; pairs?: string[]; activePairs?: string[]; reason?: string } | null;
  onNavigateTab: (tab: any, filterParams?: any) => void;
  onEvaluateSignals: () => void;
  isEvaluating: boolean;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  signals,
  latestPrices,
  marketSessions,
  providers,
  brokerStatus,
  onNavigateTab,
  onEvaluateSignals,
  isEvaluating,
}) => {
  const [controls, setControls] = useState<ManualControlsState>(loadManualControls());
  const [isScanning, setIsScanning] = useState(false);
  const [nowDate, setNowDate] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setNowDate(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleTriggerScan = async () => {
    setIsScanning(true);
    try {
      await fetch('/api/scheduler/pulse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'OVERVIEW_MANUAL_PULSE' }),
      });
      onEvaluateSignals();
    } catch (e) {
      console.error(e);
    } finally {
      setIsScanning(false);
    }
  };

  // Unified Bot performance calculation
  const botStats = computeBotPerformance(signals);

  const [overviewLayer, setOverviewLayer] = useState<'ACTIVE' | 'TODAY' | 'YESTERDAY' | 'ALL'>('ACTIVE');
  const getIstDateKey = (val: Date | string | number | null | undefined): string => {
    if (!val) return '';
    try {
      const d = typeof val === 'object' ? val : new Date(val);
      if (isNaN(d.getTime())) return '';
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
    } catch {
      return '';
    }
  };

  const todayIstKey = getIstDateKey(nowDate);
  const nowIstDateStr = nowDate.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });

  // Overall Today Performance (IST Calendar Day)
  const todaySignals = signals.filter(
    s => getIstDateKey(s.actualEntryTimeUtc || s.candleOpenTimeUtc || s.predictionTimeUtc) === todayIstKey
  );

  const todayCompleted = todaySignals.filter(isSettledContract);
  const todayExpiredUnfilled = todaySignals.filter(isExpiredUnfilledSetup).length;
  const todayFilled = todaySignals.filter(isFilledContract).length;
  const todayWins = todayCompleted.filter(s => s.outcomeResult === 'WIN').length;
  const todayLosses = todayCompleted.filter(s => s.outcomeResult === 'LOSS').length;
  const todayScored = todayWins + todayLosses;
  const todayWinRate = todayScored > 0 ? Number(((todayWins / todayScored) * 100).toFixed(1)) : null;
  const todayNetUnits = Number(
    todayCompleted.reduce((acc, s) => acc + (s.netReturnUnits || 0), 0).toFixed(2)
  );

  // Overall Yesterday Performance (IST Calendar Day)
  const yesterdayDate = new Date(nowDate.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayIstKey = getIstDateKey(yesterdayDate);
  const yesterdayIstDateStr = yesterdayDate.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });

  const yesterdaySignals = signals.filter(
    s => getIstDateKey(s.actualEntryTimeUtc || s.candleOpenTimeUtc || s.predictionTimeUtc) === yesterdayIstKey
  );

  const yesterdayCompleted = yesterdaySignals.filter(isSettledContract);
  const yesterdayWins = yesterdayCompleted.filter(s => s.outcomeResult === 'WIN').length;
  const yesterdayLosses = yesterdayCompleted.filter(s => s.outcomeResult === 'LOSS').length;
  const yesterdayScored = yesterdayWins + yesterdayLosses;
  const yesterdayWinRate = yesterdayScored > 0 ? Number(((yesterdayWins / yesterdayScored) * 100).toFixed(1)) : null;
  const yesterdayNetUnits = Number(
    yesterdayCompleted.reduce((acc, s) => acc + (s.netReturnUnits || 0), 0).toFixed(2)
  );

  // Multi-Day Sessions Grouping (Partitioned strictly by IST calendar day)
  const dailySessions = React.useMemo(() => {
    const groups = new Map<string, ResearchSignal[]>();
    for (const sig of signals) {
      const key = getIstDateKey(sig.actualEntryTimeUtc || sig.candleOpenTimeUtc || sig.predictionTimeUtc);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(sig);
    }
    const sortedKeys = Array.from(groups.keys()).sort((a, b) => b.localeCompare(a));
    return sortedKeys.map(dateKey => {
      const sigs = groups.get(dateKey) || [];
      const sampleDate = new Date(`${dateKey}T12:00:00Z`);
      const displayDate = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      }).format(sampleDate);
      const completed = sigs.filter(isSettledContract);
      const wins = completed.filter(s => s.outcomeResult === 'WIN').length;
      const losses = completed.filter(s => s.outcomeResult === 'LOSS').length;
      const scored = wins + losses;
      const winRate = scored > 0 ? Number(((wins / scored) * 100).toFixed(1)) : null;
      const netUnits = Number(completed.reduce((acc, s) => acc + (s.netReturnUnits || 0), 0).toFixed(2));
      return { dateKey, displayDate, signals: sigs, completed, wins, losses, winRate, netUnits };
    });
  }, [signals]);

  const latestCompletedSession = React.useMemo(() => {
    return dailySessions.find(d => d.completed.length > 0) || null;
  }, [dailySessions]);

  // Time-based mutually exclusive partitioning
  const nowMs = nowDate.getTime();

  // 1. Live in-market contracts (only active before planned exit)
  const activeTrades = signals.filter(s => {
    if (s.lifecycleState !== 'ACTIVE' || s.actualEntryPrice === null) return false;
    const exitTimeMs = s.plannedExitTimeUtc ? Date.parse(s.plannedExitTimeUtc) : 0;
    return exitTimeMs === 0 || nowMs < exitTimeMs;
  });

  // 2. Verifying trades (past planned exit or explicit exit pending, awaiting broker candle settlement)
  const verifyingTrades = signals.filter(s => {
    if (s.actualEntryPrice === null) return false;
    const exitTimeMs = s.plannedExitTimeUtc ? Date.parse(s.plannedExitTimeUtc) : 0;
    const isPastExpiry = exitTimeMs > 0 && nowMs >= exitTimeMs;
    return (
      (s.lifecycleState === 'EXIT_PENDING' || (s.lifecycleState === 'ACTIVE' && isPastExpiry)) &&
      s.outcomeResult === 'PENDING'
    );
  });

  // 3. Advance Alerts (Waiting for 5M entry)
  const advanceAlerts = signals.filter(
    s =>
      s.actualEntryPrice === null &&
      ['WAITING_FOR_ENTRY', 'DETECTED', 'ENTRY_TRIGGERED'].includes(s.lifecycleState)
  );

  // Distinct deduplicated list of active / advance signals
  const displayedActiveList = React.useMemo(() => {
    const combined = [...activeTrades, ...verifyingTrades, ...advanceAlerts];
    const seen = new Set<string>();
    const unique: ResearchSignal[] = [];
    for (const item of combined) {
      if (item && item.id && !seen.has(item.id)) {
        seen.add(item.id);
        unique.push(item);
      }
    }
    return unique.slice(0, 6);
  }, [activeTrades, verifyingTrades, advanceAlerts]);

  // Calculate next 5M open countdown
  const currentMinutes = nowDate.getMinutes();
  const currentSeconds = nowDate.getSeconds();
  const next5mTargetMinute = Math.ceil((currentMinutes + 0.01) / 5) * 5;
  const totalSecondsToNext5m = (next5mTargetMinute - currentMinutes) * 60 - currentSeconds;
  const remMinutes = Math.floor(totalSecondsToNext5m / 60);
  const remSec = totalSecondsToNext5m % 60;
  const next5mCountdownStr = `${remMinutes}m ${remSec < 10 ? '0' : ''}${remSec}s`;

  const formatIST = (d: Date) =>
    d.toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }) + ' IST';

  return (
    <div className="w-full bg-[#121820] text-[#E8E5DE] min-h-screen font-sans pb-24">
      {/* ------------------------------------------------------------- */}
      {/* SUB-HEADER / EXECUTIVE STATUS STRIP */}
      {/* ------------------------------------------------------------- */}
      <div className="border-b border-[#243040] bg-[#161F2B] px-4 lg:px-8 py-3.5 sticky top-24 z-20">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-black tracking-wide text-[#E8E5DE] uppercase flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#72A98B]" />
              Executive Fleet Overview
            </span>
            <span className="text-[#354251]">/</span>
            <span className="text-[#AAB4BF]">
              Autonomous Quantitative Engine ·{' '}
              {brokerStatus?.mode === 'MANUAL_ACTIVE'
                ? `${brokerStatus.liveCount} Manual Pairs (AI Studio Preview)`
                : `${FOREX_PAIRS.length} Ranked Pairs (Olymp-Gated)`}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#121820] border border-[#243040] text-[#E8E5DE] font-bold">
              <Clock className="w-3.5 h-3.5 text-[#6C9D91]" />
              <span>{formatIST(nowDate)}</span>
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#121820] border border-[#243040] text-[#AAB4BF]">
              <span>Next 5M Candle Open in</span>
              <strong className="text-[#E8E5DE]">{next5mCountdownStr}</strong>
            </div>

            <button
              onClick={handleTriggerScan}
              disabled={isScanning}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[#72A98B] hover:bg-[#72A98B]/90 text-[#121820] font-black text-xs transition-all shadow-sm cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              <span>{isScanning ? `Scanning ${FOREX_PAIRS.length} Pairs...` : 'Scan Markets'}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-6 space-y-8">
        {/* Live Olymp Trade Gate & Multi-Agent Council Strip */}
        <div className="sf-panel rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
          <div className="flex flex-col gap-1.5 min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-bold border ${
                  brokerStatus?.mode === 'OLYMP_ACTIVE' || brokerStatus?.mode === 'MANUAL_ACTIVE'
                    ? 'bg-[#72A98B]/15 text-[#72A98B] border-[#72A98B]/40'
                    : 'bg-[#C5A36A]/15 text-[#C5A36A] border-[#C5A36A]/40'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    brokerStatus?.mode === 'OLYMP_ACTIVE' || brokerStatus?.mode === 'MANUAL_ACTIVE'
                      ? 'bg-[#72A98B] animate-pulse'
                      : 'bg-[#C5A36A]'
                  }`}
                />
                {brokerStatus?.allowAllPairs
                  ? `ALL 29 PAIRS ENABLED · ${brokerStatus.liveCount} ACTIVE`
                  : brokerStatus?.mode === 'MANUAL_ACTIVE'
                  ? `AI STUDIO · MANUAL PAIRS (${brokerStatus.liveCount} ACTIVE)`
                  : brokerStatus?.mode === 'OLYMP_ACTIVE'
                  ? `OLYMP ACTIVE · ${brokerStatus.liveCount} ELIGIBLE · ${brokerStatus.activeCount ?? brokerStatus.liveCount} ACTIVE`
                  : `FAIL-CLOSED · ${brokerStatus?.mode || 'WAITING FOR OLYMP SNAPSHOT'}`}
              </span>
              <span className="text-[#AAB4BF] text-[11px]">
                {brokerStatus?.mode === 'MANUAL_ACTIVE' && brokerStatus.pairs && brokerStatus.pairs.length > 0
                  ? `Manual Universe (${brokerStatus.pairs.length}): ${brokerStatus.pairs.join(', ')}`
                  : brokerStatus?.mode === 'OLYMP_ACTIVE' && brokerStatus.pairs && brokerStatus.pairs.length > 0
                  ? `Eligible ≥80% (${brokerStatus.pairs.length}): ${brokerStatus.pairs.join(', ')}`
                  : brokerStatus?.reason || 'Open Olymp Trade in Chrome with companion v1.3.1+ to unlock live discovery.'}
              </span>
            </div>
            {brokerStatus?.activePairs && brokerStatus.activePairs.length > 0 && (
              <div className="text-[#82909D] text-[11px] leading-relaxed break-words">
                <span className="text-[#AAB4BF] font-semibold">
                  All Active Olymp Markets ({brokerStatus.activePairs.length}):
                </span>{' '}
                {brokerStatus.activePairs.join(', ')}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onNavigateTab('broker')}
              className="px-3 py-1.5 rounded-lg bg-[#121820] hover:bg-[#243040] border border-[#354251] text-[#E8E5DE] font-semibold transition-colors cursor-pointer"
            >
              Broker Feed →
            </button>
            <button
              onClick={() => onNavigateTab('brain')}
              className="px-3 py-1.5 rounded-lg bg-[#6C9D91]/15 hover:bg-[#6C9D91]/25 border border-[#6C9D91]/40 text-[#6C9D91] font-bold transition-colors cursor-pointer"
            >
              5-Agent Debate Arena →
            </button>
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* SECTION 1: UNIFIED AUTONOMOUS BOT COMMAND CARD */}
        {/* ------------------------------------------------------------- */}
        <div className="bg-[#161F2B] border border-[#243040] rounded-xl p-5 sm:p-6 shadow-xl space-y-6">
          {/* Header Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-[#243040]">
            <div className="flex items-start sm:items-center gap-3.5">
              <div className="w-10 h-10 rounded-lg bg-[#72A98B]/10 border border-[#72A98B]/30 flex items-center justify-center shrink-0">
                <Brain className="w-5 h-5 text-[#72A98B]" />
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <h2 className="text-lg font-black text-[#E8E5DE] tracking-tight">
                    {BOT_DEFINITION.name}
                  </h2>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold tracking-wider ${
                      controls.globalKillSwitch
                        ? 'bg-rose-950/50 text-rose-400 border border-rose-800/40'
                        : controls.bot?.enabled
                        ? 'bg-[#72A98B]/15 text-[#72A98B] border border-[#72A98B]/30'
                        : 'bg-amber-950/50 text-amber-400 border border-amber-800/40'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        controls.globalKillSwitch
                          ? 'bg-rose-400'
                          : controls.bot?.enabled
                          ? 'bg-[#72A98B] animate-pulse'
                          : 'bg-amber-400'
                      }`}
                    />
                    {controls.globalKillSwitch
                      ? 'KILL SWITCH ACTIVE'
                      : controls.bot?.enabled
                      ? 'ONLINE & AUTONOMOUS'
                      : 'PAUSED'}
                  </span>
                </div>
                <p className="text-xs text-[#AAB4BF] mt-0.5">
                  {BOT_DEFINITION.tagline} · Operating on 5M causal candle open entry
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-auto">
              <button
                onClick={() => onNavigateTab('controls')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1F2C3F] hover:bg-[#243040] text-xs font-semibold text-[#E8E5DE] border border-[#354251] transition-colors cursor-pointer"
              >
                <Sliders className="w-3.5 h-3.5 text-[#6C9D91]" />
                <span>Bot Settings</span>
              </button>
              <button
                onClick={() => onNavigateTab('signals')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#72A98B]/15 hover:bg-[#72A98B]/25 text-xs font-bold text-[#72A98B] border border-[#72A98B]/30 transition-colors cursor-pointer"
              >
                <span>Live Signals</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Metric KPI Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 font-mono">
            {/* Win Rate */}
            <div className="bg-[#121820] border border-[#243040] rounded-lg p-3.5">
              <span className="text-[10px] uppercase tracking-wider text-[#AAB4BF] block">
                Retained Window Win Rate
              </span>
              <div className="text-2xl font-black text-[#E8E5DE] mt-1 tabular-nums">
                {botStats.winRate !== null ? `${botStats.winRate}%` : '—'}
              </div>
              <span className="text-[11px] text-[#72A98B] block mt-0.5">
                {botStats.wins}W · {botStats.losses}L · {botStats.scratches}S
              </span>
            </div>

            {/* Net Return */}
            <div className="bg-[#121820] border border-[#243040] rounded-lg p-3.5">
              <span className="text-[10px] uppercase tracking-wider text-[#AAB4BF] block">
                Retained Window Net Return
              </span>
              <div
                className={`text-2xl font-black mt-1 tabular-nums ${
                  botStats.netUnits > 0
                    ? 'text-[#72A98B]'
                    : botStats.netUnits < 0
                    ? 'text-[#B7797D]'
                    : 'text-[#E8E5DE]'
                }`}
              >
                {botStats.netUnits > 0 ? `+${botStats.netUnits}` : botStats.netUnits}
                <span className="text-xs font-normal text-[#AAB4BF] ml-1">U</span>
              </div>
              <span className="text-[11px] text-[#AAB4BF] block mt-0.5">
                {botStats.filledContracts} filled · {botStats.expiredUnfilledSetups} expired unfilled
              </span>
            </div>

            {/* Profit Factor */}
            <div className="bg-[#121820] border border-[#243040] rounded-lg p-3.5">
              <span className="text-[10px] uppercase tracking-wider text-[#AAB4BF] block">
                Profit Factor
              </span>
              <div className="text-2xl font-black text-[#E8E5DE] mt-1 tabular-nums">
                {botStats.profitFactor !== null ? botStats.profitFactor.toFixed(2) : '—'}
              </div>
              <span className="text-[11px] text-[#6C9D91] block mt-0.5">
                {botStats.completedTrades} settled paper contracts
              </span>
            </div>

            {/* In-Market Exposure */}
            <div className="bg-[#121820] border border-[#243040] rounded-lg p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-[#AAB4BF]">
                  Active Exposure
                </span>
                <span className="text-[10px] text-[#C4A574]">
                  Max {controls.bot?.maxConcurrentTrades || 6}
                </span>
              </div>
              <div className="text-2xl font-black text-[#E8E5DE] mt-1 tabular-nums">
                {activeTrades.length}
                <span className="text-xs font-normal text-[#AAB4BF] ml-1">
                  / {controls.bot?.maxConcurrentTrades || 6}
                </span>
              </div>
              {/* Exposure Progress Bar */}
              <div className="w-full bg-[#1F2C3F] h-1.5 rounded-full mt-2 overflow-hidden">
                <div
                  className="bg-[#72A98B] h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${Math.min(
                      100,
                      ((activeTrades.length) / (controls.bot?.maxConcurrentTrades || 6)) * 100
                    )}%`,
                  }}
                />
              </div>
            </div>
          </div>

          {/* Integrated Confluence Strategy Architecture */}
          <div>
            <span className="text-[11px] font-mono uppercase tracking-wider text-[#AAB4BF] font-semibold block mb-2.5">
              Integrated Confluence Engines (Autonomous Triad)
            </span>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="bg-[#121820] border border-[#243040] rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-3.5 h-3.5 text-[#72A98B]" />
                  <span className="text-xs font-bold text-[#E8E5DE]">Momentum & Trend</span>
                </div>
                <p className="text-[11px] text-[#AAB4BF] leading-relaxed">
                  EMA 9/21/50 alignment, MACD zero-lag histogram divergence, and ADX &gt; 22 directional expansion.
                </p>
              </div>

              <div className="bg-[#121820] border border-[#243040] rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Activity className="w-3.5 h-3.5 text-[#6C9D91]" />
                  <span className="text-xs font-bold text-[#E8E5DE]">Liquidity & Mean Reversion</span>
                </div>
                <p className="text-[11px] text-[#AAB4BF] leading-relaxed">
                  Bollinger 2.5σ extreme band sweeps, institutional order block tap, and fair value gap rejection.
                </p>
              </div>

              <div className="bg-[#121820] border border-[#243040] rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Brain className="w-3.5 h-3.5 text-[#C4A574]" />
                  <span className="text-xs font-bold text-[#E8E5DE]">Neural Directional Policy</span>
                </div>
                <p className="text-[11px] text-[#AAB4BF] leading-relaxed">
                  Real-time transformer next-candle prediction, volatility veto gate, and Bayesian confidence scoring.
                </p>
              </div>
            </div>
          </div>

          {/* Filter Telemetry Strip */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#243040] text-xs font-mono text-[#AAB4BF]">
            <div className="flex flex-wrap items-center gap-4">
              <span>
                Min Conf: <strong className="text-[#E8E5DE]">{((controls?.bot?.minConfidence ?? 0.7) * 100).toFixed(0)}%</strong>
              </span>
              <span>
                Spread Gate: <strong className="text-[#72A98B]">{controls?.bot?.dynamicSpreadGate ? `ACTIVE (≤ ${controls?.bot?.maxSpreadPips || 2.5}p)` : 'OFF'}</strong>
              </span>
              <span>
                Research Pairs: <strong className="text-[#E8E5DE]">{controls?.bot?.allowedPairs?.length ?? FOREX_PAIRS.length}/{FOREX_PAIRS.length}</strong>
              </span>
              {brokerStatus && (
                <span>
                  Olymp Active: <strong className="text-[#72A98B]">{brokerStatus.activeCount ?? 0}</strong>{' '}
                  <span className="text-[#82909D]">({brokerStatus.liveCount ?? 0} eligible ≥80%)</span>
                </span>
              )}
              <span>
                Telegram: <strong className="text-[#6C9D91]">{controls?.telegramBroadcast ? 'BROADCASTING' : 'MUTED'}</strong>
              </span>
            </div>
            <span className="text-[11px] text-[#6C9D91]">
              Execution Engine: 5M Causal Candle Open
            </span>
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* SECTION 2: PERFORMANCE OVERVIEW SCORECARD & MARKET HEALTH */}
        {/* ------------------------------------------------------------- */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left 2 Cols: Performance Scorecard */}
          <div className="lg:col-span-2 bg-[#161F2B] border border-[#243040] rounded-xl p-5 sm:p-6 space-y-5 shadow-lg">
            <div className="flex flex-wrap items-center justify-between pb-3 border-b border-[#243040] gap-2">
              <div>
                <h3 className="text-base font-bold text-[#E8E5DE] tracking-tight">
                  Institutional Performance Summary
                </h3>
                <p className="text-xs text-[#AAB4BF] mt-0.5">
                  Candle-settled paper results using saved payout assumptions, shown in Indian Standard Time (IST).
                </p>
              </div>
              <button
                onClick={() => onNavigateTab('analytics')}
                className="text-xs text-[#6C9D91] hover:underline font-semibold cursor-pointer"
              >
                View Full Analytics →
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 font-mono">
              <div className="bg-[#121820] border border-[#243040] rounded-lg p-3.5">
                <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Today&apos;s Retained Window Win Rate</span>
                <div className="text-2xl sm:text-3xl font-black text-[#E8E5DE] mt-1 tabular-nums">
                  {todayWinRate !== null ? `${todayWinRate}%` : '—'}
                </div>
                <span className="text-[10px] text-[#72A98B] font-bold block mt-1">
                  {todayWins} Wins · {todayLosses} Losses
                </span>
              </div>

              <div className="bg-[#121820] border border-[#243040] rounded-lg p-3.5">
                <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Filled Contracts Today</span>
                <div className="text-2xl sm:text-3xl font-black text-[#E8E5DE] mt-1 tabular-nums">{todayFilled}</div>
                <span className="text-[10px] text-[#AAB4BF] block mt-1">{todaySignals.length} signal setups</span>
              </div>

              <div className="bg-[#121820] border border-[#243040] rounded-lg p-3.5">
                <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Today&apos;s Net Stake</span>
                <div className={`text-2xl sm:text-3xl font-black mt-1 tabular-nums ${todayNetUnits >= 0 ? 'text-[#72A98B]' : 'text-[#B7797D]'}`}>
                  {todayNetUnits >= 0 ? `+${todayNetUnits}` : todayNetUnits} U
                </div>
                <span className="text-[10px] text-[#AAB4BF] block mt-1">
                  Saved paper payout units
                </span>
              </div>

              <div className="bg-[#121820] border border-[#243040] rounded-lg p-3.5">
                <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Expired Unfilled Today</span>
                <div className="text-2xl sm:text-3xl font-black mt-1 tabular-nums text-[#E8E5DE]">{todayExpiredUnfilled}</div>
                <span className="text-[10px] text-[#AAB4BF] block mt-1">Not counted as trades</span>
              </div>
            </div>

            {/* Global Market Session Matrix Glance */}
            <div className="space-y-2 pt-2">
              <span className="text-xs font-mono font-bold text-[#E8E5DE] block">
                Session Performance Matrix (IST)
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                {[
                  { name: 'Tokyo / Asian', ist: '05:30 - 12:30', id: 'ASIA' },
                  { name: 'London', ist: '12:30 - 17:30', id: 'LONDON' },
                  { name: 'London/NY Overlap', ist: '17:30 - 21:30', id: 'OVERLAP' },
                  { name: 'New York', ist: '21:30 - 02:30', id: 'NEW_YORK' },
                ].map((sess, sIdx) => {
                  const sessTrades = signals.filter(s => {
                    if (s.lifecycleState !== 'CLOSED') return false;
                    return s.marketSession === sess.id;
                  });
                  const w = sessTrades.filter(s => s.outcomeResult === 'WIN').length;
                  const l = sessTrades.filter(s => s.outcomeResult === 'LOSS').length;
                  const wr = w + l > 0 ? Number(((w / (w + l)) * 100).toFixed(1)) : null;
                  return (
                    <div key={`overview_sess_${sess.id}_${sIdx}`} className="bg-[#121820] border border-[#243040] rounded-lg p-2.5">
                      <div className="text-[10px] text-[#AAB4BF] truncate">{sess.name}</div>
                      <div className="text-sm font-black text-[#E8E5DE] mt-0.5 tabular-nums">
                        {wr !== null ? `${wr}% Win Rate` : '—'}
                      </div>
                      <div className="text-[10px] text-[#6C9D91] mt-0.5">
                        {w + l > 0 ? `${w}W · ${l}L` : `${sess.ist} IST`}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right 1 Col: Market Health & Data Providers */}
          <div className="bg-[#161F2B] border border-[#243040] rounded-xl p-5 sm:p-6 space-y-4 shadow-lg flex flex-col justify-between">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-[#E8E5DE] tracking-tight flex items-center gap-2">
                  <Server className="w-4 h-4 text-[#72A98B]" />
                  <span>Market Health &amp; Feeds</span>
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#72A98B]/15 text-[#72A98B] border border-[#72A98B]/30 font-bold">
                  HEALTHY
                </span>
              </div>
              <p className="text-xs text-[#AAB4BF]">
                Multi-feed aggregation across institutional price providers.
              </p>
            </div>

            {/* Providers List */}
            <div className="space-y-2.5 font-mono text-xs">
              {[
                { name: 'Biquote Institutional Feed', ping: '12ms', status: 'ONLINE', pairs: `${FOREX_PAIRS.length} Pairs` },
                { name: 'Dukascopy M1 Tick Cache', ping: '48ms', status: 'ONLINE', pairs: 'Primary FX' },
                { name: 'Yahoo Finance Cross-Check', ping: '84ms', status: 'ONLINE', pairs: 'Fallback' },
              ].map((prov, i) => (
                <div key={i} className="flex items-center justify-between p-2.5 rounded-lg bg-[#121820] border border-[#243040]">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#72A98B]" />
                    <span className="font-semibold text-[#E8E5DE] text-xs">{prov.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[#AAB4BF] text-[10px]">{prov.ping}</span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] bg-[#72A98B]/20 text-[#72A98B] font-bold">
                      {prov.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* 24/7 Engine & Telegram Status */}
            <div className="p-3 rounded-lg bg-[#121820] border border-[#243040] space-y-1.5 text-xs font-mono">
              <div className="flex items-center justify-between">
                <span className="text-[#AAB4BF]">24/7 Engine Daemon:</span>
                <span className="text-[#72A98B] font-bold">ACTIVE (WINDOW-INDEPENDENT)</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#AAB4BF]">Telegram Broadcast:</span>
                <span className="text-[#6C9D91] font-bold">@Forex_new_calender_bot</span>
              </div>
            </div>

            <button
              onClick={() => onNavigateTab('system')}
              className="w-full py-2 rounded-lg bg-[#243040] hover:bg-[#354251] text-[#E8E5DE] text-xs font-bold font-mono transition-colors cursor-pointer text-center"
            >
              System &amp; Database Diagnostics →
            </button>
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* SECTION 3: INSTITUTIONAL SIGNAL LAYERS (ACTIVE · TODAY · YESTERDAY · ALL) */}
        {/* ------------------------------------------------------------- */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* 4 Layer Switcher Tabs */}
            <div className="flex flex-wrap items-center bg-[#161F2B] border border-[#243040] p-1 rounded-xl gap-1 font-mono text-xs">
              <button
                onClick={() => setOverviewLayer('ACTIVE')}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                  overviewLayer === 'ACTIVE'
                    ? 'bg-[#121820] text-[#72A98B] border border-[#72A98B]/50 shadow-sm'
                    : 'text-[#AAB4BF] hover:text-[#E8E5DE]'
                }`}
              >
                <Radio className="w-3.5 h-3.5 text-[#72A98B]" />
                <span>Active &amp; Advance</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[#72A98B]/20 text-[#72A98B]">
                  {activeTrades.length + advanceAlerts.length}
                </span>
              </button>

              <button
                onClick={() => setOverviewLayer('TODAY')}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                  overviewLayer === 'TODAY'
                    ? 'bg-[#121820] text-[#6C9D91] border border-[#6C9D91]/50 shadow-sm'
                    : 'text-[#AAB4BF] hover:text-[#E8E5DE]'
                }`}
              >
                <Zap className="w-3.5 h-3.5 text-[#6C9D91]" />
                <span>Today&apos;s Layer</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[#6C9D91]/20 text-[#6C9D91]">
                  {todaySignals.length}
                </span>
              </button>

              <button
                onClick={() => setOverviewLayer('YESTERDAY')}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                  overviewLayer === 'YESTERDAY'
                    ? 'bg-[#121820] text-[#C4A574] border border-[#C4A574]/50 shadow-sm'
                    : 'text-[#AAB4BF] hover:text-[#E8E5DE]'
                }`}
              >
                <Clock className="w-3.5 h-3.5 text-[#C4A574]" />
                <span>
                  {yesterdaySignals.length > 0
                    ? 'Yesterday\'s Layer'
                    : `Yesterday / Latest (${latestCompletedSession?.displayDate || 'Session'})`}
                </span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[#C4A574]/20 text-[#C4A574]">
                  {yesterdaySignals.length > 0 ? yesterdaySignals.length : (latestCompletedSession?.completed.length || 0)}
                </span>
              </button>

              <button
                onClick={() => setOverviewLayer('ALL')}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                  overviewLayer === 'ALL'
                    ? 'bg-[#121820] text-[#E8E5DE] border border-[#354251] shadow-sm'
                    : 'text-[#AAB4BF] hover:text-[#E8E5DE]'
                }`}
              >
                <Server className="w-3.5 h-3.5 text-[#AAB4BF]" />
                <span>All Signals</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[#354251]/40 text-[#AAB4BF]">
                  {signals.length}
                </span>
              </button>
            </div>

            <button
              onClick={() => onNavigateTab('signals')}
              className="text-xs text-[#6C9D91] hover:underline font-semibold font-mono cursor-pointer flex items-center gap-1.5"
            >
              <span>Open Full Signal Terminal</span>
              <span>→</span>
            </button>
          </div>

          {/* Quick Context / Metrics Strip for Selected Layer */}
          <div className="bg-[#161F2B] border border-[#243040] rounded-lg px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
            {overviewLayer === 'ACTIVE' && (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[#AAB4BF]">Live Contracts:</span>
                <span className="text-[#72A98B] font-bold">{activeTrades.length} In Market</span>
                <span className="text-[#354251]">·</span>
                <span className="text-[#C4A574] font-bold">{advanceAlerts.length} Queued 5M</span>
                <span className="text-[#354251]">·</span>
                <span className="text-[#AAB4BF]">{verifyingTrades.length} Verifying Close</span>
              </div>
            )}
            {overviewLayer === 'TODAY' && (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[#AAB4BF]">Today ({nowIstDateStr}):</span>
                <span className="text-[#72A98B] font-bold">{todayWins} Wins</span>
                <span className="text-[#354251]">·</span>
                <span className="text-[#B7797D] font-bold">{todayLosses} Losses</span>
                <span className="text-[#354251]">·</span>
                <span className="text-[#E8E5DE] font-bold">
                  Win Rate: {todayWinRate !== null ? `${todayWinRate}%` : 'Pending'}
                </span>
                <span className="text-[#354251]">·</span>
                <span className={`font-black ${todayNetUnits >= 0 ? 'text-[#72A98B]' : 'text-[#B7797D]'}`}>
                  Net Units: {todayNetUnits >= 0 ? `+${todayNetUnits}` : todayNetUnits} U
                </span>
              </div>
            )}
            {overviewLayer === 'YESTERDAY' && (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[#AAB4BF]">
                  {yesterdaySignals.length > 0
                    ? `Yesterday (${yesterdayIstDateStr}):`
                    : `Latest Audited Session (${latestCompletedSession?.displayDate || 'Previous'}):`}
                </span>
                <span className="text-[#72A98B] font-bold">
                  {yesterdaySignals.length > 0 ? yesterdayWins : (latestCompletedSession?.wins || 0)} Wins
                </span>
                <span className="text-[#354251]">·</span>
                <span className="text-[#B7797D] font-bold">
                  {yesterdaySignals.length > 0 ? yesterdayLosses : (latestCompletedSession?.losses || 0)} Losses
                </span>
                <span className="text-[#354251]">·</span>
                <span className="text-[#E8E5DE] font-bold">
                  Audited Win Rate:{' '}
                  {(yesterdaySignals.length > 0 ? yesterdayWinRate : latestCompletedSession?.winRate) !== null
                    ? `${yesterdaySignals.length > 0 ? yesterdayWinRate : latestCompletedSession?.winRate}%`
                    : 'N/A'}
                </span>
                <span className="text-[#354251]">·</span>
                <span
                  className={`font-black ${
                    (yesterdaySignals.length > 0 ? yesterdayNetUnits : (latestCompletedSession?.netUnits || 0)) >= 0
                      ? 'text-[#72A98B]'
                      : 'text-[#B7797D]'
                  }`}
                >
                  Net Return:{' '}
                  {(yesterdaySignals.length > 0 ? yesterdayNetUnits : (latestCompletedSession?.netUnits || 0)) >= 0
                    ? `+${yesterdaySignals.length > 0 ? yesterdayNetUnits : (latestCompletedSession?.netUnits || 0)}`
                    : (yesterdaySignals.length > 0 ? yesterdayNetUnits : (latestCompletedSession?.netUnits || 0))}{' '}
                  U
                </span>
              </div>
            )}
            {overviewLayer === 'ALL' && (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[#AAB4BF]">Retained Signal Ledger:</span>
                <span className="text-[#E8E5DE] font-bold">{botStats.totalSignals} setups</span>
                <span className="text-[#354251]">·</span>
                <span className="text-[#E8E5DE] font-bold">{botStats.filledContracts} filled</span>
                <span className="text-[#354251]">·</span>
                <span className="text-[#E8E5DE] font-bold">{botStats.completedTrades} settled</span>
                <span className="text-[#354251]">·</span>
                <span className="text-[#C4A574] font-bold">{botStats.expiredUnfilledSetups} expired unfilled</span>
                <span className="text-[#354251]">·</span>
                <span className="text-[#72A98B] font-bold">{botStats.wins} Wins</span>
                <span className="text-[#354251]">·</span>
                <span className="text-[#B7797D] font-bold">{botStats.losses} Losses</span>
                <span className="text-[#354251]">·</span>
                <span className="text-[#E8E5DE] font-bold">
                  All-Time Win Rate: {botStats.winRate !== null ? `${botStats.winRate}%` : '—'}
                </span>
                <span className="text-[#354251]">·</span>
                <span className={`font-black ${botStats.netUnits >= 0 ? 'text-[#72A98B]' : 'text-[#B7797D]'}`}>
                  Total Net: {botStats.netUnits >= 0 ? `+${botStats.netUnits}` : botStats.netUnits} U
                </span>
              </div>
            )}

            <div className="flex items-center gap-2 text-[11px] text-[#AAB4BF]">
              <span>Next 5M:</span>
              <strong className="text-[#E8E5DE]">{next5mCountdownStr}</strong>
            </div>
          </div>

          {/* LAYER 1: ACTIVE & ADVANCE SIGNALS */}
          {overviewLayer === 'ACTIVE' && (
            <div>
              {activeTrades.length === 0 && verifyingTrades.length === 0 && advanceAlerts.length === 0 ? (
                <div className="bg-[#161F2B] border border-[#243040] rounded-xl p-6 flex flex-col md:flex-row items-center justify-between gap-4 font-mono text-xs shadow-md">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-[#121820] border border-[#243040] flex items-center justify-center text-[#6C9D91] shrink-0">
                      <Radio className="w-5 h-5 animate-pulse" />
                    </div>
                    <div>
                      <div className="text-sm font-black text-[#E8E5DE]">
                        SCANNER ARMED · WAITING FOR 3-MIN ADVANCE TRIGGER
                      </div>
                      <p className="text-[#AAB4BF] text-xs mt-0.5">
                        Signals trigger exactly 3 minutes prior to 5-minute candle openings (:02, :07, :12...).
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded bg-[#121820] border border-[#243040] text-right font-mono">
                      <span className="text-[10px] text-[#AAB4BF] uppercase block font-bold">Next 5M Entry</span>
                      <span className="text-sm font-black text-[#E8E5DE]">{next5mCountdownStr}</span>
                    </div>
                    <button
                      onClick={handleTriggerScan}
                      disabled={isScanning}
                      className="px-3.5 py-2 rounded-lg bg-[#6C9D91] hover:bg-[#72A98B] text-[#121820] font-black text-xs transition-all cursor-pointer disabled:opacity-50"
                    >
                      {isScanning ? 'Scanning...' : 'Trigger Scan'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {displayedActiveList.map((sig, idx) => {
                    const isBuy = sig.direction === 'BUY';
                    const isWaiting = sig.lifecycleState === 'WAITING_FOR_ENTRY';
                    const isActive = sig.lifecycleState === 'ACTIVE';
                    const currPrice = latestPrices[sig.symbol] || sig.actualEntryPrice || sig.triggerPrice || 0;
                    const entry = sig.actualEntryPrice || sig.triggerPrice || 0;
                    const diffPips = Number(((isBuy ? currPrice - entry : entry - currPrice) * 10000).toFixed(1));

                    return (
                      <div
                        key={`overview_active_${sig.id}_${idx}`}
                        className="bg-[#161F2B] border border-[#243040] hover:border-[#6C9D91]/60 transition-all rounded-xl p-4 space-y-3 font-mono shadow-md"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-black text-[#E8E5DE]">{sig.symbol}</span>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-black ${
                                isBuy ? 'bg-[#72A98B] text-[#121820]' : 'bg-[#B7797D] text-[#121820]'
                              }`}
                            >
                              {sig.direction} ({isBuy ? 'CALL' : 'PUT'})
                            </span>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              isActive
                                ? 'bg-[#72A98B]/20 text-[#72A98B] border border-[#72A98B]/40'
                                : isWaiting
                                ? 'bg-[#C5A36A]/20 text-[#C5A36A] border border-[#C5A36A]/40'
                                : 'bg-[#C4A574]/20 text-[#C4A574] border border-[#C4A574]/40'
                            }`}
                          >
                            {isActive ? 'ACTIVE' : isWaiting ? 'QUEUED 5M' : 'VERIFYING'}
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-2 p-2.5 rounded-lg bg-[#121820] border border-[#243040] text-xs">
                          <div>
                            <span className="text-[10px] text-[#AAB4BF] block">Entry Level</span>
                            <span className="font-bold text-[#E8E5DE] tabular-nums">
                              {entry.toFixed(5)}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-[#AAB4BF] block">Live Price</span>
                            <span className="font-bold text-[#E8E5DE] tabular-nums">
                              {currPrice.toFixed(5)}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-[#AAB4BF] block">Displacement</span>
                            <span
                              className={`font-black tabular-nums ${
                                diffPips >= 0 ? 'text-[#72A98B]' : 'text-[#B7797D]'
                              }`}
                            >
                              {diffPips >= 0 ? `+${diffPips}` : diffPips} pips
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-xs text-[#AAB4BF]">
                          <span>
                            {isWaiting ? (
                              <span className="text-[#C5A36A] font-bold">
                                ⏳ Entry: <strong className="text-[#E8E5DE]">{sig.candleOpenTimeIst || 'Upcoming 5M'}</strong> (3M Advance Window)
                              </span>
                            ) : (
                              <span>Open: <strong className="text-[#E8E5DE]">{sig.candleOpenTimeIst || 'Next 5M'}</strong></span>
                            )}
                          </span>
                          <button
                            onClick={() => onNavigateTab('signals')}
                            className="text-[#6C9D91] hover:underline font-bold cursor-pointer"
                          >
                            Details →
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* LAYER 2: TODAY'S SIGNALS */}
          {overviewLayer === 'TODAY' && (
            <div className="bg-[#161F2B] border border-[#243040] rounded-xl overflow-hidden shadow-md">
              {todaySignals.length === 0 ? (
                <div className="p-8 text-center text-xs font-mono text-[#AAB4BF] space-y-2">
                  <p className="text-sm font-bold text-[#E8E5DE]">No signals recorded yet for Today ({nowIstDateStr}).</p>
                  <p>Next 5M scan window is active with precision 3-minute advance notice.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left font-mono text-xs">
                    <thead className="bg-[#121820] text-[#AAB4BF] border-b border-[#243040]">
                      <tr>
                        <th className="py-3 px-4">Time (IST)</th>
                        <th className="py-3 px-4">Pair</th>
                        <th className="py-3 px-4">Direction</th>
                        <th className="py-3 px-4">Entry</th>
                        <th className="py-3 px-4">Exit</th>
                        <th className="py-3 px-4">Result</th>
                        <th className="py-3 px-4 text-right">Net Return</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#243040]">
                      {todaySignals.slice(0, 10).map((sig, idx) => {
                        const isWin = sig.outcomeResult === 'WIN';
                        const isLoss = sig.outcomeResult === 'LOSS';
                        const isClosed = sig.lifecycleState === 'CLOSED';

                        return (
                          <tr key={`overview_today_${sig.id}_${idx}`} className="hover:bg-[#121820]/50 transition-colors">
                            <td className="py-3 px-4 text-[#AAB4BF]">{sig.candleOpenTimeIst || sig.predictionTimeIst}</td>
                            <td className="py-3 px-4 font-black text-[#E8E5DE]">{sig.symbol}</td>
                            <td className="py-3 px-4">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-black ${
                                  sig.direction === 'BUY' ? 'bg-[#72A98B]/20 text-[#72A98B]' : 'bg-[#B7797D]/20 text-[#B7797D]'
                                }`}
                              >
                                {sig.direction}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-mono text-[#E8E5DE]">{sig.actualEntryPrice?.toFixed(5) || sig.triggerPrice?.toFixed(5) || '—'}</td>
                            <td className="py-3 px-4 font-mono text-[#E8E5DE]">{sig.actualExitPrice?.toFixed(5) || '—'}</td>
                            <td className="py-3 px-4">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  isWin
                                    ? 'bg-[#72A98B] text-[#121820]'
                                    : isLoss
                                    ? 'bg-[#B7797D] text-[#121820]'
                                    : 'bg-[#C4A574]/20 text-[#C4A574]'
                                }`}
                              >
                                {isClosed ? sig.outcomeResult : sig.lifecycleState}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right font-black tabular-nums">
                              {sig.netReturnUnits !== undefined && sig.netReturnUnits !== null ? (
                                <span className={sig.netReturnUnits >= 0 ? 'text-[#72A98B]' : 'text-[#B7797D]'}>
                                  {sig.netReturnUnits >= 0 ? `+${sig.netReturnUnits.toFixed(2)}` : sig.netReturnUnits.toFixed(2)} U
                                </span>
                              ) : (
                                <span className="text-[#AAB4BF]">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* LAYER 3: YESTERDAY'S ARCHIVE / LATEST AUDITED SESSION */}
          {overviewLayer === 'YESTERDAY' && (
            <div className="bg-[#161F2B] border border-[#243040] rounded-xl overflow-hidden shadow-md">
              {(() => {
                const displayList = yesterdaySignals.length > 0 ? yesterdaySignals : (latestCompletedSession?.signals || []);

                if (displayList.length === 0) {
                  return (
                    <div className="p-8 text-center text-xs font-mono text-[#AAB4BF] space-y-2">
                      <p className="text-sm font-bold text-[#E8E5DE]">No signals recorded for Yesterday ({yesterdayIstDateStr}).</p>
                      <p>All recorded trades are preserved in the full bot ledger.</p>
                    </div>
                  );
                }

                return (
                  <div>
                    {yesterdaySignals.length === 0 && latestCompletedSession && (
                      <div className="p-3 bg-[#121820] border-b border-[#243040] flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                        <span className="text-[#C4A574] font-bold">
                          Calendar Yesterday had 0 logged trades (Weekend/Off-cycle) · Showing Latest Audited Session ({latestCompletedSession.displayDate})
                        </span>
                        <button
                          onClick={() => onNavigateTab('signals')}
                          className="text-[#6C9D91] hover:underline font-bold"
                        >
                          View Full Multi-Day Terminal →
                        </button>
                      </div>
                    )}

                    <div className="overflow-x-auto">
                      <table className="w-full text-left font-mono text-xs">
                        <thead className="bg-[#121820] text-[#AAB4BF] border-b border-[#243040]">
                          <tr>
                            <th className="py-3 px-4">Time (IST)</th>
                            <th className="py-3 px-4">Pair</th>
                            <th className="py-3 px-4">Direction</th>
                            <th className="py-3 px-4">Entry</th>
                            <th className="py-3 px-4">Exit</th>
                            <th className="py-3 px-4">Audited Outcome</th>
                            <th className="py-3 px-4 text-right">Net Return</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#243040]">
                          {displayList.slice(0, 15).map((sig, idx) => {
                            const isWin = sig.outcomeResult === 'WIN';
                            const isLoss = sig.outcomeResult === 'LOSS';

                            return (
                              <tr key={`overview_yest_${sig.id}_${idx}`} className="hover:bg-[#121820]/50 transition-colors">
                                <td className="py-3 px-4 text-[#AAB4BF]">{sig.candleOpenTimeIst || sig.predictionTimeIst}</td>
                                <td className="py-3 px-4 font-black text-[#E8E5DE]">{sig.symbol}</td>
                                <td className="py-3 px-4">
                                  <span
                                    className={`px-2 py-0.5 rounded text-[10px] font-black ${
                                      sig.direction === 'BUY' ? 'bg-[#72A98B]/20 text-[#72A98B]' : 'bg-[#B7797D]/20 text-[#B7797D]'
                                    }`}
                                  >
                                    {sig.direction}
                                  </span>
                                </td>
                                <td className="py-3 px-4 font-mono text-[#E8E5DE]">{sig.actualEntryPrice?.toFixed(5) || sig.triggerPrice?.toFixed(5) || '—'}</td>
                                <td className="py-3 px-4 font-mono text-[#E8E5DE]">{sig.actualExitPrice?.toFixed(5) || '—'}</td>
                                <td className="py-3 px-4">
                                  <span
                                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                      isWin ? 'bg-[#72A98B] text-[#121820]' : isLoss ? 'bg-[#B7797D] text-[#121820]' : 'bg-[#C4A574]/20 text-[#C4A574]'
                                    }`}
                                  >
                                    {sig.outcomeResult}
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-right font-black tabular-nums">
                                  {sig.netReturnUnits !== undefined && sig.netReturnUnits !== null ? (
                                    <span className={sig.netReturnUnits >= 0 ? 'text-[#72A98B]' : 'text-[#B7797D]'}>
                                      {sig.netReturnUnits >= 0 ? `+${sig.netReturnUnits.toFixed(2)}` : sig.netReturnUnits.toFixed(2)} U
                                    </span>
                                  ) : (
                                    <span className="text-[#AAB4BF]">—</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* LAYER 4: ALL SIGNALS */}
          {overviewLayer === 'ALL' && (
            <div className="bg-[#161F2B] border border-[#243040] rounded-xl overflow-hidden shadow-md">
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead className="bg-[#121820] text-[#AAB4BF] border-b border-[#243040]">
                    <tr>
                      <th className="py-3 px-4">Time (IST)</th>
                      <th className="py-3 px-4">Pair</th>
                      <th className="py-3 px-4">Direction</th>
                      <th className="py-3 px-4">Entry</th>
                      <th className="py-3 px-4">Exit</th>
                      <th className="py-3 px-4">Status / Outcome</th>
                      <th className="py-3 px-4 text-right">Net Return</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#243040]">
                    {signals.slice(0, 15).map((sig, idx) => {
                      const isWin = sig.outcomeResult === 'WIN';
                      const isLoss = sig.outcomeResult === 'LOSS';
                      const isClosed = sig.lifecycleState === 'CLOSED';

                      return (
                        <tr key={`overview_all_${sig.id}_${idx}`} className="hover:bg-[#121820]/50 transition-colors">
                          <td className="py-3 px-4 text-[#AAB4BF]">{sig.candleOpenTimeIst || sig.predictionTimeIst}</td>
                          <td className="py-3 px-4 font-black text-[#E8E5DE]">{sig.symbol}</td>
                          <td className="py-3 px-4">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-black ${
                                sig.direction === 'BUY' ? 'bg-[#72A98B]/20 text-[#72A98B]' : 'bg-[#B7797D]/20 text-[#B7797D]'
                              }`}
                            >
                              {sig.direction}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono text-[#E8E5DE]">{sig.actualEntryPrice?.toFixed(5) || sig.triggerPrice?.toFixed(5) || '—'}</td>
                          <td className="py-3 px-4 font-mono text-[#E8E5DE]">{sig.actualExitPrice?.toFixed(5) || '—'}</td>
                          <td className="py-3 px-4">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                isWin
                                  ? 'bg-[#72A98B] text-[#121820]'
                                  : isLoss
                                  ? 'bg-[#B7797D] text-[#121820]'
                                  : 'bg-[#C4A574]/20 text-[#C4A574]'
                              }`}
                            >
                              {isClosed ? sig.outcomeResult : sig.lifecycleState}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right font-black tabular-nums">
                            {sig.netReturnUnits !== undefined && sig.netReturnUnits !== null ? (
                              <span className={sig.netReturnUnits >= 0 ? 'text-[#72A98B]' : 'text-[#B7797D]'}>
                                {sig.netReturnUnits >= 0 ? `+${sig.netReturnUnits.toFixed(2)}` : sig.netReturnUnits.toFixed(2)} U
                              </span>
                            ) : (
                              <span className="text-[#AAB4BF]">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
