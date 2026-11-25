import React, { useState, useEffect, useMemo } from 'react';
import {
  Clock,
  Target,
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Zap,
  Timer,
  Brain,
  Lightbulb,
  TrendingUp,
  X,
  RefreshCw,
  Sparkles,
  Trash2,
  Globe,
  Layers,
  Microscope,
  Award,
  AlertCircle,
  Calendar,
  Radio,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  Check,
  ChevronRight,
  History,
} from 'lucide-react';
import {
  AutopilotLog,
  MarketSessionId,
  MarketSessionInfo,
  ResearchSignal,
  FOREX_PAIRS,
  ForexSymbol,
} from '../../types/index.js';
import { AgiSelfLearningModal } from '../AgiSelfLearningModal.tsx';
import { useFirebase } from '../../contexts/FirebaseContext.tsx';
import { isExpiredUnfilledSetup, isFilledContract, isSettledContract, isTerminalUnfilledSetup } from '../../utils/tradeAccounting.js';

interface SignalTerminalViewProps {
  signals: ResearchSignal[];
  latestPrices?: Record<string, number>;
  marketSessions?: MarketSessionInfo[];
  autopilotLogs?: AutopilotLog[];
  onEvaluateSignals: () => void;
  isEvaluating: boolean;
}

type TerminalLayer = 'ACTIVE' | 'TODAY' | 'YESTERDAY' | 'DAILY_SESSIONS' | 'ALL' | 'SESSIONS';
type TradeStatusFilter = 'ALL' | 'EXECUTED' | 'WIN' | 'LOSS' | 'SCRATCH' | 'EXPIRED';

export interface DailySessionSummary {
  dateKey: string;
  displayDate: string;
  dayOfWeek: string;
  signals: ResearchSignal[];
  executedTrades: ResearchSignal[];
  settledTrades: ResearchSignal[];
  activeTrades: ResearchSignal[];
  wins: number;
  losses: number;
  winRate: number | null;
  netUnits: number;
  expiredUnfilledSetups: number;
  isToday: boolean;
  isYesterday: boolean;
}

/**
 * Format any Date or ISO string into canonical Indian Standard Time (IST)
 */
function formatIstTime(d: Date | string | number | null | undefined): string {
  if (!d) return '—';
  try {
    const dateObj = typeof d === 'object' ? d : new Date(d);
    if (isNaN(dateObj.getTime())) return '—';
    return (
      dateObj.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }) + ' IST'
    );
  } catch {
    return '—';
  }
}

function getIstDateKey(d: Date | string | number | null | undefined): string {
  if (!d) return '';
  try {
    const dateObj = typeof d === 'object' ? d : new Date(d);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(dateObj); // 'YYYY-MM-DD'
  } catch {
    return '';
  }
}

function formatIstDateHeading(d: Date | string | number | null | undefined): string {
  if (!d) return '';
  try {
    const dateObj = typeof d === 'object' ? d : new Date(d);
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(dateObj);
  } catch {
    return '';
  }
}

function getSessionFromTimestamp(timestampUtc: Date | string | number): {
  id: MarketSessionId;
  name: string;
  shortName: string;
} {
  const d = new Date(timestampUtc);
  const hour = d.getUTCHours();
  if (hour >= 12 && hour < 16) {
    return { id: 'OVERLAP', name: 'London / New York Overlap', shortName: 'Overlap' };
  } else if (hour >= 7 && hour < 12) {
    return { id: 'LONDON', name: 'London Session', shortName: 'London' };
  } else if (hour >= 16 && hour < 21) {
    return { id: 'NEW_YORK', name: 'New York Session', shortName: 'New York' };
  } else {
    return { id: 'ASIA', name: 'Tokyo / Asian Session', shortName: 'Asia' };
  }
}

interface ParsedTimings {
  alertTimeIst: string;
  entryTimeIst: string;
  expiryTimeIst: string;
  durationMinutes: number;
  isActualFill: boolean;
  isActualExit: boolean;
  entryTimestampMs: number | null;
  expiryTimestampMs: number | null;
}

function getSignalTimings(sig: ResearchSignal): ParsedTimings {
  const duration = sig.expiryMinutes || 5;
  const alertTimeIst = sig.predictionTimeIst || formatIstTime(sig.predictionTimeUtc);

  let entryDate: Date | null = null;
  let isActualFill = false;

  if (sig.actualEntryTimeUtc) {
    entryDate = new Date(sig.actualEntryTimeUtc);
    isActualFill = true;
  } else if (sig.candleOpenTimeUtc) {
    entryDate = new Date(sig.candleOpenTimeUtc);
  } else if (sig.entryWindowStartUtc) {
    entryDate = new Date(sig.entryWindowStartUtc);
  } else if (sig.predictionTimeUtc) {
    const pMs = new Date(sig.predictionTimeUtc).getTime();
    const next5m = Math.ceil(pMs / (5 * 60 * 1000)) * (5 * 60 * 1000);
    entryDate = new Date(next5m);
  }

  const entryTimeIst = sig.candleOpenTimeIst || formatIstTime(entryDate);

  let exitDate: Date | null = null;
  let isActualExit = false;

  if (sig.actualExitTimeUtc) {
    exitDate = new Date(sig.actualExitTimeUtc);
    isActualExit = true;
  } else if (sig.plannedExitTimeUtc) {
    exitDate = new Date(sig.plannedExitTimeUtc);
  } else if (entryDate && !isNaN(entryDate.getTime())) {
    exitDate = new Date(entryDate.getTime() + duration * 60 * 1000);
  }

  const expiryTimeIst = sig.candleCloseTimeIst || formatIstTime(exitDate);

  return {
    alertTimeIst,
    entryTimeIst,
    expiryTimeIst,
    durationMinutes: duration,
    isActualFill,
    isActualExit,
    entryTimestampMs: entryDate ? entryDate.getTime() : null,
    expiryTimestampMs: exitDate ? exitDate.getTime() : null,
  };
}

export const SignalTerminalView: React.FC<SignalTerminalViewProps> = ({
  signals,
  latestPrices = {},
  marketSessions = [],
  autopilotLogs = [],
  onEvaluateSignals,
  isEvaluating,
}) => {
  // Layer Selection: ALL (default: never 0) vs TODAY vs YESTERDAY vs SESSIONS
  const [activeLayer, setActiveLayer] = useState<TerminalLayer>('ALL');
  const [pairFilter, setPairFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<TradeStatusFilter>('ALL');
  const [selectedSignal, setSelectedSignal] = useState<ResearchSignal | null>(null);

  // Auxiliary Modals
  const [showAgiModal, setShowAgiModal] = useState<boolean>(false);
  const [isClearingHistory, setIsClearingHistory] = useState<boolean>(false);
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false);
  const [isScanningNow, setIsScanningNow] = useState<boolean>(false);
  const { user, deleteClosedSignalsFromFirestore } = useFirebase();

  const handleTriggerScan = async () => {
    setIsScanningNow(true);
    try {
      await fetch('/api/scheduler/pulse', { method: 'POST' });
      onEvaluateSignals();
    } catch (err) {
      console.error('Manual pulse failed:', err);
    } finally {
      setIsScanningNow(false);
    }
  };

  // Live Clock & Time Math
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [sessionData, setSessionData] = useState<MarketSessionInfo[]>([]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch session analytics
  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const sessRes = await fetch('/api/sessions/accuracy').then(r => r.json()).catch(() => ({ sessions: [] }));
        if (sessRes?.sessions) setSessionData(sessRes.sessions);
      } catch (err) {
        console.warn('Failed to load session accuracy:', err);
      }
    };
    fetchSessions();
  }, [signals.length]);

  // Weekend Forex Market Status
  const nowDate = new Date(nowMs);
  const dayOfWeek = nowDate.getUTCDay();
  const currentUtcHour = nowDate.getUTCHours();
  const isWeekendClosed =
    (dayOfWeek === 5 && currentUtcHour >= 21) ||
    dayOfWeek === 6 ||
    (dayOfWeek === 0 && currentUtcHour < 21);

  // 5-Minute Candle Boundary Synchronization
  const currentMinute = nowDate.getUTCMinutes();
  const currentSecond = nowDate.getUTCSeconds();
  const minuteIn5mCycle = currentMinute % 5;
  const secondsToNext5m = (4 - minuteIn5mCycle) * 60 + (60 - currentSecond);
  const next5mCountdownStr = `${Math.floor(secondsToNext5m / 60)
    .toString()
    .padStart(2, '0')}m ${(secondsToNext5m % 60).toString().padStart(2, '0')}s`;
  const isWithin3MinAdvanceWindow = secondsToNext5m <= 180 && secondsToNext5m >= 15;

  // IST Date Strings for Partitioning
  const todayIstKey = getIstDateKey(nowDate);
  const yesterdayDate = new Date(nowMs - 24 * 60 * 60 * 1000);
  const yesterdayIstKey = getIstDateKey(yesterdayDate);

  // -------------------------------------------------------------
  // ACTIVE & PENDING TRADES (ALWAYS RENDERED AT THE VERY TOP!)
  // -------------------------------------------------------------

  // 1. ACTIVE TRADES (Currently in market, live ticking before expiry)
  const activeTrades = useMemo(() => {
    const list = signals.filter(s => {
      const exitTimeMs = s.plannedExitTimeUtc ? Date.parse(s.plannedExitTimeUtc) : 0;
      const isNotYetExpired = exitTimeMs === 0 || nowMs < exitTimeMs;
      return s.lifecycleState === 'ACTIVE' && s.actualEntryPrice !== null && isNotYetExpired;
    });
    const map = new Map<string, ResearchSignal>();
    for (const s of list) {
      if (s && s.id && !map.has(s.id)) {
        map.set(s.id, s);
      }
    }
    return Array.from(map.values());
  }, [signals, nowMs]);

  // 2. SIGNAL ALERTS (Advance notices waiting for upcoming 5M open)
  const signalAlerts = useMemo(() => {
    const list = signals.filter(s => {
      return (
        s.actualEntryPrice === null &&
        ['WAITING_FOR_ENTRY', 'DETECTED', 'ENTRY_TRIGGERED'].includes(s.lifecycleState)
      );
    });
    const map = new Map<string, ResearchSignal>();
    for (const s of list) {
      if (s && s.id && !map.has(s.id)) {
        map.set(s.id, s);
      }
    }
    return Array.from(map.values());
  }, [signals]);

  // 3. RESULT VERIFYING (Past expiry, awaiting feed close tick)
  const verifyingTrades = useMemo(() => {
    const list = signals.filter(s => {
      const exitTimeMs = s.plannedExitTimeUtc ? Date.parse(s.plannedExitTimeUtc) : 0;
      const isPastExpiry = exitTimeMs > 0 && nowMs >= exitTimeMs;
      const isExitPending =
        s.lifecycleState === 'EXIT_PENDING' || (s.lifecycleState === 'ACTIVE' && isPastExpiry);
      return isExitPending && s.actualEntryPrice !== null && s.outcomeResult === 'PENDING';
    });
    const map = new Map<string, ResearchSignal>();
    for (const s of list) {
      if (s && s.id && !map.has(s.id)) {
        map.set(s.id, s);
      }
    }
    return Array.from(map.values());
  }, [signals, nowMs]);

  // -------------------------------------------------------------
  // REAL HISTORICAL & LIVE SIGNAL PARTITIONS (NO FAKE / DUMMY DATA)
  // -------------------------------------------------------------

  // Helper filter function for pair and status filters
  const applyFilters = (list: ResearchSignal[]) => {
    return list.filter(s => {
      if (pairFilter !== 'ALL' && s.symbol !== pairFilter) return false;
      if (statusFilter === 'EXECUTED') {
        return isFilledContract(s);
      }
      if (statusFilter === 'WIN') return s.outcomeResult === 'WIN';
      if (statusFilter === 'LOSS') return s.outcomeResult === 'LOSS';
      if (statusFilter === 'SCRATCH') return isSettledContract(s) && s.outcomeResult === 'SCRATCH';
      if (statusFilter === 'EXPIRED') return isExpiredUnfilledSetup(s);
      return true;
    });
  };

  // 1. ALL SIGNALS (Full Bot History - Never restarts to 0)
  const allSignals = useMemo(() => signals, [signals]);
  const allExecutedTrades = useMemo(() => allSignals.filter(isFilledContract), [allSignals]);
  const allSettledTrades = useMemo(() => allSignals.filter(isSettledContract), [allSignals]);
  const allWins = allSettledTrades.filter(t => t.outcomeResult === 'WIN').length;
  const allLosses = allSettledTrades.filter(t => t.outcomeResult === 'LOSS').length;
  const allScored = allWins + allLosses;
  const allWinRate = allScored > 0 ? Number(((allWins / allScored) * 100).toFixed(1)) : null;
  const allNetUnits = Number(allSettledTrades.reduce((acc, t) => acc + (t.netReturnUnits || 0), 0).toFixed(2));
  const allExpiredUnfilled = allSignals.filter(isExpiredUnfilledSetup).length;
  const displayedAllSignals = useMemo(() => applyFilters(allSignals), [allSignals, pairFilter, statusFilter]);

  // 2. DAILY SESSIONS GROUPING (Partitioned strictly by IST calendar day)
  const dailySessions = useMemo<DailySessionSummary[]>(() => {
    const groups = new Map<string, ResearchSignal[]>();

    for (const sig of signals) {
      const timeVal = sig.actualEntryTimeUtc || sig.candleOpenTimeUtc || sig.predictionTimeUtc;
      const key = getIstDateKey(timeVal);
      if (!key) continue;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(sig);
    }

    // Sort descending by dateKey (newest days first)
    const sortedKeys = Array.from(groups.keys()).sort((a, b) => b.localeCompare(a));

    return sortedKeys.map(dateKey => {
      const sigs = groups.get(dateKey) || [];
      const sampleDate = new Date(`${dateKey}T12:00:00Z`);
      const displayDate = formatIstDateHeading(sampleDate);
      const dayOfWeek = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long' }).format(sampleDate);

      const executed = sigs.filter(isFilledContract);
      const settled = sigs.filter(isSettledContract);
      const active = sigs.filter(s => s.lifecycleState === 'ACTIVE' || s.lifecycleState === 'WAITING_FOR_ENTRY' || s.lifecycleState === 'EXIT_PENDING');
      const wins = settled.filter(s => s.outcomeResult === 'WIN').length;
      const losses = settled.filter(s => s.outcomeResult === 'LOSS').length;
      const scored = wins + losses;
      const winRate = scored > 0 ? Number(((wins / scored) * 100).toFixed(1)) : null;
      const netUnits = Number(settled.reduce((acc, s) => acc + (s.netReturnUnits || 0), 0).toFixed(2));
      const expiredUnfilledSetups = sigs.filter(isExpiredUnfilledSetup).length;

      return {
        dateKey,
        displayDate,
        dayOfWeek,
        signals: sigs,
        executedTrades: executed,
        settledTrades: settled,
        activeTrades: active,
        wins,
        losses,
        winRate,
        netUnits,
        expiredUnfilledSetups,
        isToday: dateKey === todayIstKey,
        isYesterday: dateKey === yesterdayIstKey,
      };
    });
  }, [signals, todayIstKey, yesterdayIstKey]);

  // Latest completed trading session (for fallback when yesterday had 0 trades e.g. weekends/holidays)
  const latestCompletedSession = useMemo(() => {
    return dailySessions.find(d => d.settledTrades.length > 0 && !d.isToday) || dailySessions.find(d => d.settledTrades.length > 0) || null;
  }, [dailySessions]);

  const [selectedSessionDate, setSelectedSessionDate] = useState<string>('ALL');

  // 3. TODAY'S SIGNALS (Partitioned strictly by IST Today)
  const todaySignals = useMemo(() => {
    return signals.filter(s => {
      const dateKey = getIstDateKey(s.actualEntryTimeUtc || s.candleOpenTimeUtc || s.predictionTimeUtc);
      return dateKey === todayIstKey;
    });
  }, [signals, todayIstKey]);
  const todayExecutedTrades = useMemo(() => {
    return todaySignals.filter(isFilledContract);
  }, [todaySignals]);
  const todaySettledTrades = useMemo(() => {
    return todaySignals.filter(isSettledContract);
  }, [todayExecutedTrades]);
  const todayWins = todaySettledTrades.filter(t => t.outcomeResult === 'WIN').length;
  const todayLosses = todaySettledTrades.filter(t => t.outcomeResult === 'LOSS').length;
  const todayScored = todayWins + todayLosses;
  const todayWinRate = todayScored > 0 ? Number(((todayWins / todayScored) * 100).toFixed(1)) : null;
  const todayNetUnits = Number(todaySettledTrades.reduce((acc, t) => acc + (t.netReturnUnits || 0), 0).toFixed(2));
  const todayExpiredUnfilled = todaySignals.filter(isExpiredUnfilledSetup).length;
  const displayedTodaySignals = useMemo(() => applyFilters(todaySignals), [todaySignals, pairFilter, statusFilter]);

  // 4. YESTERDAY'S SIGNALS (Strict IST Yesterday)
  const yesterdaySignals = useMemo(() => {
    return signals.filter(s => {
      const dateKey = getIstDateKey(s.actualEntryTimeUtc || s.candleOpenTimeUtc || s.predictionTimeUtc);
      return dateKey === yesterdayIstKey;
    });
  }, [signals, yesterdayIstKey]);
  const yesterdayExecutedTrades = useMemo(() => {
    return yesterdaySignals.filter(isFilledContract);
  }, [yesterdaySignals]);
  const yesterdaySettledTrades = useMemo(() => {
    return yesterdaySignals.filter(isSettledContract);
  }, [yesterdayExecutedTrades]);
  const yesterdayWins = yesterdaySettledTrades.filter(t => t.outcomeResult === 'WIN').length;
  const yesterdayLosses = yesterdaySettledTrades.filter(t => t.outcomeResult === 'LOSS').length;
  const yesterdayScored = yesterdayWins + yesterdayLosses;
  const yesterdayWinRate = yesterdayScored > 0 ? Number(((yesterdayWins / yesterdayScored) * 100).toFixed(1)) : null;
  const yesterdayNetUnits = Number(yesterdaySettledTrades.reduce((acc, t) => acc + (t.netReturnUnits || 0), 0).toFixed(2));
  const yesterdayExpiredUnfilled = yesterdaySignals.filter(isExpiredUnfilledSetup).length;
  const displayedYesterdaySignals = useMemo(() => applyFilters(yesterdaySignals), [yesterdaySignals, pairFilter, statusFilter]);

  // Live Pip Displacement Calculation for active trade cards
  const calculateLiveDisplacement = (trade: ResearchSignal) => {
    if (!trade) {
      return { current: 0, diffPips: 0, isInTheMoney: false };
    }
    const symbol = trade.symbol || 'EUR/USD';
    const entryPrice = trade.actualEntryPrice || trade.triggerPrice || 0;
    const currentPrice = (latestPrices && latestPrices[symbol]) || entryPrice;
    const isJpy = typeof symbol === 'string' && symbol.includes('JPY');
    const pipMultiplier = isJpy ? 100 : 10000;
    const diffPips = Number(((currentPrice - entryPrice) * pipMultiplier).toFixed(1));
    const isBuy = trade.direction === 'BUY';
    const isInTheMoney = isBuy ? diffPips > 0 : diffPips < 0;
    return {
      current: currentPrice,
      diffPips: isBuy ? diffPips : -diffPips,
      isInTheMoney,
    };
  };

  const handleClearHistory = async () => {
    setIsClearingHistory(true);
    try {
      await fetch('/api/signals/clear-history', { method: 'POST' });
      if (user) {
        await deleteClosedSignalsFromFirestore();
      }
      onEvaluateSignals();
      setShowClearConfirm(false);
    } catch (err) {
      console.error('Failed to clear history:', err);
    } finally {
      setIsClearingHistory(false);
    }
  };

  const renderTradeTable = (tradeList: ResearchSignal[]) => {
    if (tradeList.length === 0) {
      return (
        <div className="p-8 text-center text-xs font-mono text-[#AAB4BF]">
          No matching signals found for current filter selection.
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left font-mono text-xs">
          <thead className="bg-[#17212D] border-b border-[#354251] text-[#AAB4BF] uppercase text-[11px] font-bold">
            <tr>
              <th className="py-3.5 px-4">Status</th>
              <th className="py-3.5 px-4">Pair &amp; Direction</th>
              <th className="py-3.5 px-4">Alert Time (IST)</th>
              <th className="py-3.5 px-4">5M Entry (IST)</th>
              <th className="py-3.5 px-4">Expiry Time (IST)</th>
              <th className="py-3.5 px-4 text-right">Entry Price</th>
              <th className="py-3.5 px-4 text-right">Exit Price</th>
              <th className="py-3.5 px-4 text-right">Net Return</th>
              <th className="py-3.5 px-4 text-right">Audit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#354251] bg-[#222B36]/60">
            {tradeList.map((trade, idx) => {
              const timings = getSignalTimings(trade);
              const isWin = trade.outcomeResult === 'WIN';
              const isLoss = trade.outcomeResult === 'LOSS';
              const isActive = trade.lifecycleState === 'ACTIVE';
              const isWaiting = trade.lifecycleState === 'WAITING_FOR_ENTRY';
              const isVerifying = trade.lifecycleState === 'EXIT_PENDING';
              const isScratch = trade.outcomeResult === 'SCRATCH';
              const isTerminalUnfilled = isTerminalUnfilledSetup(trade);
              const auditReason = [...(trade.lifecycleHistory || [])].reverse().find(event =>
                ['EXPIRED', 'INVALIDATED', 'AMBIGUOUS'].includes(event.toState)
              )?.reason || 'No entry fill was recorded; this setup is excluded from contract outcomes.';

              return (
                <tr key={`terminal_trade_${trade.id}_${idx}`} className="hover:bg-[#17212D]/60 transition-colors">
                  <td className="py-3.5 px-4">
                    {isWin && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-black bg-[#72A98B]/20 text-[#72A98B] border border-[#72A98B]/40">
                        <Check className="w-3.5 h-3.5" />
                        WON
                      </span>
                    )}
                    {isLoss && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-black bg-[#B7797D]/20 text-[#B7797D] border border-[#B7797D]/40">
                        <X className="w-3.5 h-3.5" />
                        LOST
                      </span>
                    )}
                    {isScratch && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-black bg-[#C5A36A]/20 text-[#C5A36A] border border-[#C5A36A]/40">SCRATCH</span>
                    )}
                    {isActive && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-black bg-[#72A98B]/20 text-[#72A98B] border border-[#72A98B]/40">
                        <span className="w-2 h-2 rounded-full bg-[#72A98B] animate-ping" />
                        ACTIVE
                      </span>
                    )}
                    {isWaiting && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold bg-[#C5A36A]/20 text-[#C5A36A] border border-[#C5A36A]/40">
                        <Timer className="w-3.5 h-3.5" />
                        QUEUED
                      </span>
                    )}
                    {isVerifying && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold bg-[#C5A36A]/20 text-[#C5A36A] border border-[#C5A36A]/40">
                        <Activity className="w-3.5 h-3.5 animate-pulse" />
                        VERIFYING
                      </span>
                    )}
                    {isTerminalUnfilled ? (
                      <div className="max-w-[260px] space-y-1 rounded-md border border-[#C4A574]/50 bg-[#C4A574]/10 p-2 text-left">
                        <span className="block text-[10px] font-black text-[#C4A574]">AUDIT: UNSETTLED / NO ENTRY</span>
                        <span className="block text-[10px] font-bold text-[#E8E5DE]">{trade.lifecycleState}</span>
                        <span className="block whitespace-normal text-[10px] leading-relaxed text-[#AAB4BF]">{auditReason}</span>
                      </div>
                    ) : !isWin && !isLoss && !isScratch && !isActive && !isWaiting && !isVerifying && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs bg-[#17212D] text-[#AAB4BF] border border-[#354251]">
                        {trade.lifecycleState}
                      </span>
                    )}
                  </td>
                  <td className="py-3.5 px-4">
                    <span className="font-black text-base text-[#E8E5DE]">{trade.symbol}</span>
                    <span className={`text-xs font-black ml-2.5 px-2 py-0.5 rounded-md ${trade.direction === 'BUY' ? 'bg-[#72A98B]/20 text-[#72A98B] border border-[#72A98B]/30' : 'bg-[#B7797D]/20 text-[#B7797D] border border-[#B7797D]/30'}`}>
                      {trade.direction} ({trade.direction === 'BUY' ? 'CALL' : 'PUT'}) · {trade.expiryMinutes || 5}M
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-xs font-medium text-[#AAB4BF]">{timings.alertTimeIst}</td>
                  <td className="py-3.5 px-4 text-sm font-bold text-[#E8E5DE]">{timings.entryTimeIst}</td>
                  <td className="py-3.5 px-4 text-sm font-bold text-[#6C9D91]">{timings.expiryTimeIst}</td>
                  <td className="py-3.5 px-4 text-right font-bold text-sm text-[#E8E5DE]">
                    {trade.actualEntryPrice?.toFixed(5) || (
                      <span className="text-[#AAB4BF] text-xs">Trig: {trade.triggerPrice?.toFixed(5)}</span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 text-right font-bold text-sm text-[#E8E5DE]">
                    {trade.actualExitPrice?.toFixed(5) || (
                      <span className="text-[#AAB4BF] text-xs">
                        {isActive ? 'In Market' : isWaiting ? 'Queued 5M' : isVerifying ? 'Verifying Tick' : 'Pending'}
                      </span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 text-right tabular-nums text-sm">
                    {trade.netReturnUnits !== undefined && trade.netReturnUnits !== null ? (
                      <span className={`font-black ${trade.netReturnUnits > 0 ? 'text-[#72A98B]' : trade.netReturnUnits < 0 ? 'text-[#B7797D]' : 'text-[#AAB4BF]'}`}>
                        {trade.netReturnUnits > 0 ? `+${trade.netReturnUnits.toFixed(2)}` : trade.netReturnUnits.toFixed(2)} U
                      </span>
                    ) : (
                      <span className="text-[#AAB4BF]">—</span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <button
                      onClick={() => setSelectedSignal(trade)}
                      className="px-3 py-1.5 rounded-lg bg-[#17212D] hover:bg-[#354251] border border-[#354251] text-xs font-bold text-[#E8E5DE] cursor-pointer transition-colors"
                    >
                      Audit
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="w-full bg-[#121820] text-[#E8E5DE] min-h-screen font-sans pb-20">
      {/* ------------------------------------------------------------- */}
      {/* 1. TOP HEADER & 24/7 BACKGROUND STATUS BAR */}
      {/* ------------------------------------------------------------- */}
      <header className="border-b border-[#243040] bg-[#161F2B] px-4 lg:px-8 py-3 sticky top-16 z-20">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
          {/* Left: Engine Identity & 24/7 Background Indicator */}
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-sm font-black font-mono tracking-wider text-[#E8E5DE] uppercase flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#6C9D91]" />
              Signal Terminal
            </span>
            <span className="text-[#354251]">/</span>
            <span className="px-2.5 py-0.5 rounded-full bg-[#72A98B]/15 border border-[#72A98B]/35 text-[#72A98B] font-bold text-[10px] flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#72A98B] animate-pulse" />
              24/5 AUTONOMOUS ENGINE ACTIVE (CRON READY)
            </span>
          </div>

          {/* Right: IST Clock, 5M Countdown, and Sync Button */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded bg-[#222B36] border border-[#354251] text-[#E8E5DE] font-bold">
              <Clock className="w-3.5 h-3.5 text-[#6C9D91]" />
              <span>{formatIstTime(nowDate)}</span>
            </div>

            {isWeekendClosed ? (
              <span className="px-2.5 py-1 rounded bg-[#C5A36A]/15 border border-[#C5A36A]/40 text-[#C5A36A] font-bold text-[11px]">
                WEEKEND PAUSED (MON 02:30 AM IST)
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded bg-[#222B36] border border-[#354251] text-[#AAB4BF] text-[11px]">
                Next 5M Open in <strong className="text-[#E8E5DE]">{next5mCountdownStr}</strong>
              </span>
            )}

            <button
              onClick={onEvaluateSignals}
              disabled={isEvaluating}
              className="px-3 py-1 rounded bg-[#222B36] hover:bg-[#354251] border border-[#354251] text-[#AAB4BF] hover:text-[#E8E5DE] font-bold flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isEvaluating ? 'animate-spin text-[#6C9D91]' : ''}`} />
              <span>Sync</span>
            </button>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------------- */}
      {/* 2. DEDICATED HIGH-VISIBILITY SIGNAL ALERT BROADCAST LAYER */}
      {/* ------------------------------------------------------------- */}
      <section className="bg-gradient-to-b from-[#222B36] to-[#17212D] border-b border-[#354251] px-4 lg:px-8 py-5">
        <div className="max-w-7xl mx-auto space-y-4">
          {/* Header Row */}
          <div className="flex flex-wrap items-center justify-between gap-3 font-mono">
            <div className="flex items-center gap-2.5">
              <span className="w-3 h-3 rounded-full bg-[#72A98B] animate-ping" />
              <h2 className="text-base sm:text-lg font-black text-[#E8E5DE] uppercase tracking-wider flex items-center gap-2">
                <Zap className="w-5 h-5 text-[#C4A574]" />
                <span>SIGNAL ALERT BROADCAST LAYER</span>
              </h2>
              <span className="text-xs text-[#AAB4BF] font-semibold hidden md:inline">
                ({signalAlerts.length} Advance Alerts · {activeTrades.length} Active Trades · {verifyingTrades.length} Verifying)
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleTriggerScan}
                disabled={isScanningNow}
                className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-[#6C9D91] hover:bg-[#72A98B] text-[#17212D] font-bold text-xs transition-all shadow-sm cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isScanningNow ? 'animate-spin' : ''}`} />
                <span>{isScanningNow ? 'Scanning ${FOREX_PAIRS.length} Pairs...' : 'Scan Markets Now'}</span>
              </button>
            </div>
          </div>

          {/* ------------------------------------------------------------- */}
          {/* A. 3-MINUTE ADVANCE SIGNAL ALERT HERO CARDS (WAITING FOR ENTRY) */}
          {/* ------------------------------------------------------------- */}
          {signalAlerts.length > 0 && (
            <div className="space-y-3">
              <div className="text-xs font-mono text-[#C4A574] font-black uppercase tracking-wider flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#C4A574] animate-pulse" />
                <span>🔔 HIGH-PRIORITY PRE-ENTRY ALERT — PREPARE FOR 5M CANDLE OPEN ENTRY</span>
              </div>
              <div className="grid grid-cols-1 gap-4">
                {signalAlerts.map((alert, idx) => {
                  const timings = getSignalTimings(alert);
                  const isBuy = alert.direction === 'BUY';
                  const livePrice = latestPrices[alert.symbol] || alert.triggerPrice;
                  const entryMs = timings.entryTimestampMs || (alert.candleOpenTimeUtc ? Date.parse(alert.candleOpenTimeUtc) : 0);
                  const msToEntry = entryMs ? Math.max(0, entryMs - nowMs) : 0;
                  const secToEntry = Math.floor(msToEntry / 1000);
                  const countdownToEntryStr = secToEntry > 0
                    ? `${Math.floor(secToEntry / 60)}m ${(secToEntry % 60).toString().padStart(2, '0')}s`
                    : 'Entering Now';

                  return (
                    <div
                      key={`terminal_alert_${alert.id}_${idx}`}
                      className="bg-[#17212D] border-2 border-[#C4A574] rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4 font-mono relative overflow-hidden"
                    >
                      {/* Top Accent Strip */}
                      <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#C4A574] via-[#6C9D91] to-[#72A98B]" />

                      {/* Row 1: Pair & Direction in Massive Typography */}
                      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                        <div className="flex items-center gap-3 sm:gap-4">
                          <span className="text-3xl sm:text-5xl font-black text-[#E8E5DE] tracking-tight">
                            {alert.symbol}
                          </span>
                          <span
                            className={`px-4 py-1.5 rounded-xl text-sm sm:text-base font-black flex items-center gap-2 shadow-md ${
                              isBuy
                                ? 'bg-[#72A98B] text-[#17212D]'
                                : 'bg-[#B7797D] text-[#17212D]'
                            }`}
                          >
                            {isBuy ? <ArrowUpRight className="w-5 h-5 stroke-[3]" /> : <ArrowDownRight className="w-5 h-5 stroke-[3]" />}
                            <span>{alert.direction} / {isBuy ? 'CALL (BUY)' : 'PUT (SELL)'}</span>
                          </span>
                        </div>

                        <div className="flex items-center gap-2 text-right">
                          <span className="px-3.5 py-1.5 rounded-full text-xs font-bold bg-[#C4A574]/20 border border-[#C4A574]/50 text-[#C4A574] flex items-center gap-2 shadow-inner">
                            <span className="w-2 h-2 rounded-full bg-[#C4A574] animate-ping" />
                            <span>⏳ Enters in {countdownToEntryStr}</span>
                            <span className="text-[#AAB4BF] font-normal border-l border-[#C4A574]/30 pl-1.5">3-Min Advance</span>
                          </span>
                        </div>
                      </div>

                      {/* Row 2: 4 Primary Financial Execution Pillars in Large Typography */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                        {/* 1. Scheduled 5M Entry Time in IST */}
                        <div className="p-4 rounded-xl bg-[#222B36] border border-[#354251] space-y-1">
                          <span className="text-[11px] font-bold text-[#AAB4BF] uppercase block tracking-wider">
                            5M Candle Open Entry (IST)
                          </span>
                          <div className="text-xl sm:text-2xl font-black text-[#E8E5DE] tabular-nums">
                            {timings.entryTimeIst}
                          </div>
                          <span className="text-[10px] text-[#72A98B] font-bold block flex items-center gap-1.5">
                            <span>⏳ Enters in {countdownToEntryStr}</span>
                            <span className="text-[#AAB4BF] font-normal">({timings.alertTimeIst} alert)</span>
                          </span>
                        </div>

                        {/* 2. Target Expiry Time in IST */}
                        <div className="p-4 rounded-xl bg-[#222B36] border border-[#354251] space-y-1">
                          <span className="text-[11px] font-bold text-[#AAB4BF] uppercase block tracking-wider">
                            Target Contract Expiry (IST)
                          </span>
                          <div className="text-xl sm:text-2xl font-black text-[#6C9D91] tabular-nums">
                            {timings.expiryTimeIst}
                          </div>
                          <span className="text-[10px] text-[#AAB4BF] block">
                            {alert.expiryMinutes || 5}-Minute Binary Horizon
                          </span>
                        </div>

                        {/* 3. Causal Trigger Level */}
                        <div className="p-4 rounded-xl bg-[#222B36] border border-[#354251] space-y-1">
                          <span className="text-[11px] font-bold text-[#AAB4BF] uppercase block tracking-wider">
                            Causal Trigger Price
                          </span>
                          <div className="text-2xl sm:text-3xl font-black text-[#72A98B] tabular-nums">
                            {alert.triggerPrice?.toFixed(5)}
                          </div>
                          <span className="text-[10px] text-[#AAB4BF] block">
                            Live market: {livePrice?.toFixed(5)}
                          </span>
                        </div>

                        {/* 4. AI Machine Conviction */}
                        <div className="p-4 rounded-xl bg-[#222B36] border border-[#354251] space-y-1">
                          <span className="text-[11px] font-bold text-[#AAB4BF] uppercase block tracking-wider">
                            AI Conviction Score
                          </span>
                          <div className="text-xl sm:text-2xl font-black text-[#E8E5DE] tabular-nums">
                            {((alert.confidence || 0.8) * 100).toFixed(1)}%
                          </div>
                          <span className="text-[10px] text-[#C4A574] font-bold block truncate">
                            {alert.strategyName || 'Multi-Model Confluence'}
                          </span>
                        </div>
                      </div>

                      {/* Row 3: Confluences & Details Footer */}
                      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#354251] text-xs">
                        <div className="flex flex-wrap items-center gap-2 text-[#AAB4BF]">
                          <span className="font-bold text-[#E8E5DE]">Mathematical Confluences:</span>
                          {(alert.confluenceStrategies || ['EMA Alignment', 'Liquidity Sweep', 'Order Flow']).slice(0, 3).map((conf, cIdx) => (
                            <span key={`conf_${alert.id}_${cIdx}`} className="px-2 py-0.5 rounded bg-[#222B36] border border-[#354251] text-[#E8E5DE] text-[11px]">
                              {conf}
                            </span>
                          ))}
                        </div>

                        <button
                          onClick={() => setSelectedSignal(alert)}
                          className="px-4 py-2 rounded-lg bg-[#222B36] hover:bg-[#354251] text-[#6C9D91] hover:text-[#E8E5DE] border border-[#354251] font-bold text-xs transition-colors cursor-pointer"
                        >
                          Inspect Setup &amp; Audit Trail →
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* B. ACTIVE IN-MARKET TRADE HERO CARDS (REAL-TIME CLOCK TICKING) */}
          {/* ------------------------------------------------------------- */}
          {activeTrades.length > 0 && (
            <div className="space-y-3">
              <div className="text-xs font-mono text-[#72A98B] font-black uppercase tracking-wider flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#72A98B] animate-ping" />
                <span>🔥 LIVE ACTIVE TRADES IN MARKET — COUNTDOWN TICKING</span>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {activeTrades.map((trade, idx) => {
                  const timings = getSignalTimings(trade);
                  const disp = calculateLiveDisplacement(trade);
                  const isBuy = trade.direction === 'BUY';
                  const remMs = timings.expiryTimestampMs ? timings.expiryTimestampMs - nowMs : 0;
                  const remSec = Math.max(0, Math.floor(remMs / 1000));
                  const remMinStr = `${Math.floor(remSec / 60).toString().padStart(2, '0')}:${(remSec % 60).toString().padStart(2, '0')}`;

                  return (
                    <div
                      key={`terminal_active_${trade.id}_${idx}`}
                      className="bg-[#17212D] border-2 border-[#72A98B] rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4 font-mono relative"
                    >
                      {/* Top Row: Symbol, Direction, Expiry Time */}
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="text-3xl sm:text-4xl font-black text-[#E8E5DE]">
                            {trade.symbol}
                          </span>
                          <span
                            className={`px-3 py-1 rounded-xl text-xs sm:text-sm font-black flex items-center gap-1.5 ${
                              isBuy ? 'bg-[#72A98B] text-[#17212D]' : 'bg-[#B7797D] text-[#17212D]'
                            }`}
                          >
                            {isBuy ? <ArrowUpRight className="w-4 h-4 stroke-[3]" /> : <ArrowDownRight className="w-4 h-4 stroke-[3]" />}
                            <span>{trade.direction} / {isBuy ? 'CALL' : 'PUT'}</span>
                          </span>
                        </div>

                        <div className="text-right">
                          <span className="text-[10px] text-[#AAB4BF] uppercase block font-bold">Target Expiry (IST)</span>
                          <span className="text-base font-black text-[#6C9D91]">{timings.expiryTimeIst}</span>
                        </div>
                      </div>

                      {/* 3-Metric Live Ticking Strip in Large Typography */}
                      <div className="grid grid-cols-3 gap-3">
                        <div className="p-3 rounded-xl bg-[#222B36] border border-[#354251]">
                          <span className="text-[10px] text-[#AAB4BF] uppercase block font-bold">Entry Fill</span>
                          <div className="text-lg sm:text-xl font-black text-[#E8E5DE] mt-0.5 tabular-nums">
                            {trade.actualEntryPrice?.toFixed(5) || trade.triggerPrice?.toFixed(5)}
                          </div>
                        </div>

                        <div className="p-3 rounded-xl bg-[#222B36] border border-[#354251]">
                          <span className="text-[10px] text-[#AAB4BF] uppercase block font-bold">Live Feed</span>
                          <div className="text-lg sm:text-xl font-black text-[#E8E5DE] mt-0.5 tabular-nums">
                            {(disp.current ?? 0).toFixed(5)}
                          </div>
                        </div>

                        <div className="p-3 rounded-xl bg-[#222B36] border border-[#354251]">
                          <span className="text-[10px] text-[#AAB4BF] uppercase block font-bold">Live Price Move (not settled P&amp;L)</span>
                          <div className={`text-lg sm:text-xl font-black mt-0.5 tabular-nums ${disp.isInTheMoney ? 'text-[#72A98B]' : 'text-[#B7797D]'}`}>
                            {(disp.diffPips ?? 0) >= 0 ? `+${disp.diffPips ?? 0}` : (disp.diffPips ?? 0)} pips
                          </div>
                        </div>
                      </div>

                      {/* Animated Progress Bar & Settlement Countdown */}
                      <div className="space-y-1.5 p-3 rounded-xl bg-[#222B36] border border-[#354251]">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-[#AAB4BF] flex items-center gap-1.5 font-bold">
                            <Timer className="w-4 h-4 text-[#72A98B]" />
                            <span>Time to Contract Settlement:</span>
                          </span>
                          <span className="font-black text-[#E8E5DE] text-sm tabular-nums">
                            {remMinStr} remaining
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-[#17212D] overflow-hidden border border-[#354251]">
                          <div
                            style={{
                              width: `${Math.min(100, Math.max(0, (remSec / (trade.expiryMinutes * 60)) * 100))}%`,
                            }}
                            className="h-full bg-[#72A98B] transition-all"
                          />
                        </div>
                      </div>

                      {/* Footer Actions */}
                      <div className="flex items-center justify-between pt-1 border-t border-[#354251] text-xs">
                        <span className="text-[#AAB4BF] truncate max-w-[280px]">
                          Strategy: <strong className="text-[#E8E5DE]">{trade.strategyName || trade.ruleFamily}</strong>
                        </span>
                        <button
                          onClick={() => setSelectedSignal(trade)}
                          className="text-xs text-[#6C9D91] hover:underline font-bold cursor-pointer"
                        >
                          Audit Signal Details →
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* C. VERIFYING TRADES ALERT */}
          {/* ------------------------------------------------------------- */}
          {verifyingTrades.length > 0 && (
            <div className="bg-[#17212D] border border-[#C4A574] rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
              <div className="flex items-center gap-2.5">
                <Clock className="w-4 h-4 text-[#C4A574] animate-spin" />
                <span className="text-[#E8E5DE] font-bold text-sm">
                  {verifyingTrades.length} Trade(s) Past Expiry:
                </span>
                <span className="text-[#AAB4BF]">
                  Awaiting 1-minute closed candle tick from broker feed to verify final settlement.
                </span>
              </div>
              <span className="px-3 py-1 rounded-md bg-[#C4A574]/20 text-[#C4A574] font-bold text-xs">
                RESULT VERIFYING
              </span>
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* D. STANDBY 5M RADAR (WHEN NO ACTIVE OR WAITING TRADES) */}
          {/* ------------------------------------------------------------- */}
          {activeTrades.length === 0 && signalAlerts.length === 0 && verifyingTrades.length === 0 && (
            <div className="bg-[#17212D] border border-[#354251] rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 font-mono text-xs shadow-lg">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-[#222B36] border border-[#6C9D91]/40 flex items-center justify-center text-[#6C9D91] shrink-0">
                  <Radio className="w-6 h-6 animate-pulse" />
                </div>
                <div className="space-y-1">
                  <div className="text-sm sm:text-base font-black text-[#E8E5DE] flex items-center gap-2">
                    <span>AUTONOMOUS 5M SIGNAL SCANNER ACTIVE</span>
                    <span className="px-2 py-0.5 rounded text-[10px] bg-[#72A98B]/20 text-[#72A98B] font-bold">
                      {FOREX_PAIRS.length} PAIRS MONITORED
                    </span>
                  </div>
                  <p className="text-[#AAB4BF] text-xs leading-relaxed max-w-2xl">
                    Signals trigger strictly 3 minutes prior to 5-minute candle openings (:02, :07, :12, :17, :22, :27, :32, :37, :42, :47, :52, :57).
                    Live alerts appear here immediately upon causal setup detection.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 shrink-0">
                <div className="p-3 rounded-xl bg-[#222B36] border border-[#354251] text-right font-mono">
                  <span className="text-[10px] text-[#AAB4BF] uppercase block font-bold">Next 5M Entry Window</span>
                  <span className="text-base font-black text-[#E8E5DE]">{next5mCountdownStr}</span>
                </div>
                <button
                  onClick={handleTriggerScan}
                  disabled={isScanningNow}
                  className="px-4 py-2.5 rounded-xl bg-[#6C9D91] hover:bg-[#72A98B] text-[#17212D] font-black text-xs transition-all shadow-md cursor-pointer disabled:opacity-50"
                >
                  {isScanningNow ? 'Scanning...' : 'Trigger Scan Setup'}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------------- */}
      {/* 3. DEDICATED SEPARATE LAYERS BAR: TODAY vs YESTERDAY vs DAILY SESSIONS */}
      {/* ------------------------------------------------------------- */}
      <nav className="border-b border-[#243040] bg-[#161F2B] px-4 lg:px-8 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          {/* Interactive Layer Switcher (6 Distinct Views) */}
          <div className="flex flex-wrap items-center bg-[#222B36] border border-[#354251] p-1 rounded-xl gap-1">
            <button
              onClick={() => setActiveLayer('ACTIVE')}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-xs font-bold font-mono transition-all cursor-pointer ${
                activeLayer === 'ACTIVE'
                  ? 'bg-[#17212D] text-[#72A98B] border border-[#72A98B]/50 shadow-sm'
                  : 'text-[#AAB4BF] hover:text-[#E8E5DE]'
              }`}
            >
              <Radio className="w-3.5 h-3.5 text-[#72A98B] animate-pulse" />
              <span>ACTIVE &amp; ADVANCE</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[#72A98B]/20 text-[#72A98B]">
                {activeTrades.length + signalAlerts.length}
              </span>
            </button>

            <button
              onClick={() => setActiveLayer('TODAY')}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-xs font-bold font-mono transition-all cursor-pointer ${
                activeLayer === 'TODAY'
                  ? 'bg-[#17212D] text-[#6C9D91] border border-[#6C9D91]/50 shadow-sm'
                  : 'text-[#AAB4BF] hover:text-[#E8E5DE]'
              }`}
            >
              <Zap className="w-3.5 h-3.5 text-[#6C9D91]" />
              <span>TODAY ({formatIstDateHeading(nowDate)})</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[#6C9D91]/20 text-[#6C9D91]">
                {todaySignals.length}
              </span>
            </button>

            <button
              onClick={() => setActiveLayer('YESTERDAY')}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-xs font-bold font-mono transition-all cursor-pointer ${
                activeLayer === 'YESTERDAY'
                  ? 'bg-[#17212D] text-[#C4A574] border border-[#C4A574]/50 shadow-sm'
                  : 'text-[#AAB4BF] hover:text-[#E8E5DE]'
              }`}
            >
              <History className="w-3.5 h-3.5 text-[#C4A574]" />
              <span>
                {yesterdaySignals.length > 0
                  ? `YESTERDAY (${formatIstDateHeading(yesterdayDate)})`
                  : `YESTERDAY / LATEST (${latestCompletedSession?.displayDate || 'Session'})`}
              </span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[#C4A574]/20 text-[#C4A574]">
                {yesterdaySignals.length > 0 ? yesterdaySignals.length : (latestCompletedSession?.settledTrades.length || 0)}
              </span>
            </button>

            <button
              onClick={() => setActiveLayer('DAILY_SESSIONS')}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-xs font-bold font-mono transition-all cursor-pointer ${
                activeLayer === 'DAILY_SESSIONS'
                  ? 'bg-[#17212D] text-[#72A98B] border border-[#72A98B]/50 shadow-sm'
                  : 'text-[#AAB4BF] hover:text-[#E8E5DE]'
              }`}
            >
              <Calendar className="w-3.5 h-3.5 text-[#72A98B]" />
              <span>DAILY SESSIONS</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[#72A98B]/20 text-[#72A98B]">
                {dailySessions.length} Days
              </span>
            </button>

            <button
              onClick={() => setActiveLayer('ALL')}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-xs font-bold font-mono transition-all cursor-pointer ${
                activeLayer === 'ALL'
                  ? 'bg-[#17212D] text-[#E8E5DE] border border-[#354251] shadow-sm'
                  : 'text-[#AAB4BF] hover:text-[#E8E5DE]'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-[#AAB4BF]" />
              <span>ALL BOT TRADES</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[#354251]/40 text-[#AAB4BF]">
                {allSignals.length}
              </span>
            </button>

            <button
              onClick={() => setActiveLayer('SESSIONS')}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-xs font-bold font-mono transition-all cursor-pointer ${
                activeLayer === 'SESSIONS'
                  ? 'bg-[#17212D] text-[#6C9D91] border border-[#6C9D91]/50 shadow-sm'
                  : 'text-[#AAB4BF] hover:text-[#E8E5DE]'
              }`}
            >
              <Globe className="w-3.5 h-3.5 text-[#6C9D91]" />
              <span>SESSION MATRIX</span>
            </button>
          </div>

          {/* Quick Sub-Filters for Status and Pairs */}
          {activeLayer !== 'SESSIONS' && (
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
              <span className="text-[#AAB4BF] text-[11px]">Status:</span>
              <button
                onClick={() => setStatusFilter('ALL')}
                className={`px-2.5 py-1 rounded cursor-pointer transition-colors ${
                  statusFilter === 'ALL'
                    ? 'bg-[#E8E5DE] text-[#17212D] font-bold'
                    : 'bg-[#222B36] text-[#AAB4BF] hover:text-[#E8E5DE] border border-[#354251]'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setStatusFilter('EXECUTED')}
                className={`px-2.5 py-1 rounded cursor-pointer transition-colors ${
                  statusFilter === 'EXECUTED'
                    ? 'bg-[#6C9D91] text-[#17212D] font-bold'
                    : 'bg-[#222B36] text-[#6C9D91] hover:text-[#E8E5DE] border border-[#354251]'
                }`}
              >
                Executed Fills
              </button>
              <button
                onClick={() => setStatusFilter('WIN')}
                className={`px-2.5 py-1 rounded cursor-pointer transition-colors ${
                  statusFilter === 'WIN'
                    ? 'bg-[#72A98B] text-[#17212D] font-bold'
                    : 'bg-[#222B36] text-[#72A98B] hover:text-[#E8E5DE] border border-[#354251]'
                }`}
              >
                Won
              </button>
              <button
                onClick={() => setStatusFilter('LOSS')}
                className={`px-2.5 py-1 rounded cursor-pointer transition-colors ${
                  statusFilter === 'LOSS'
                    ? 'bg-[#B7797D] text-[#17212D] font-bold'
                    : 'bg-[#222B36] text-[#B7797D] hover:text-[#E8E5DE] border border-[#354251]'
                }`}
              >
                Lost
              </button>
              <button
                onClick={() => setStatusFilter('SCRATCH')}
                className={`px-2.5 py-1 rounded cursor-pointer transition-colors ${
                  statusFilter === 'SCRATCH'
                    ? 'bg-[#C5A36A] text-[#17212D] font-bold'
                    : 'bg-[#222B36] text-[#C5A36A] hover:text-[#E8E5DE] border border-[#354251]'
                }`}
              >
                Scratch
              </button>
              <button
                onClick={() => setStatusFilter('EXPIRED')}
                className={`px-2.5 py-1 rounded cursor-pointer transition-colors ${
                  statusFilter === 'EXPIRED'
                    ? 'bg-[#C4A574] text-[#17212D] font-bold'
                    : 'bg-[#222B36] text-[#C4A574] hover:text-[#E8E5DE] border border-[#354251]'
                }`}
              >
                Expired Unfilled
              </button>

              <select
                value={pairFilter}
                onChange={e => setPairFilter(e.target.value)}
                className="bg-[#222B36] border border-[#354251] text-[#E8E5DE] rounded px-2 py-1 text-xs outline-none cursor-pointer"
              >
                <option value="ALL">All Pairs ({FOREX_PAIRS.length})</option>
                {FOREX_PAIRS.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </nav>

      {/* ------------------------------------------------------------- */}
      {/* 4. LAYER CONTENT: TODAY vs YESTERDAY vs SESSIONS */}
      {/* ------------------------------------------------------------- */}
      <main className="max-w-7xl mx-auto px-4 lg:px-8 py-6 space-y-6">
        {/* ========================================================= */}
        {/* LAYER: ACTIVE & ADVANCE SIGNALS */}
        {/* ========================================================= */}
        {activeLayer === 'ACTIVE' && (
          <div className="space-y-6 animate-in fade-in duration-150">
            {/* Active Execution Scorecard */}
            <div className="bg-[#222B36] border border-[#354251] rounded-2xl p-5 sm:p-6 shadow-xl space-y-4 font-mono">
              <div className="flex flex-wrap items-center justify-between pb-3 border-b border-[#354251] gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#72A98B] animate-ping" />
                  <h2 className="text-base font-black text-[#E8E5DE] uppercase tracking-wider">
                    ACTIVE IN-MARKET TRADES &amp; 3-MINUTE PRE-ENTRY ALERTS
                  </h2>
                </div>
                <div className="text-xs text-[#72A98B] font-bold">
                  24/5 Autonomous Execution Active • Live Multi-Feed Prices
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-[#17212D] border border-[#354251] rounded-xl p-4">
                  <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Active In-Market</span>
                  <div className="text-3xl sm:text-4xl font-black text-[#72A98B] mt-1 tabular-nums">
                    {activeTrades.length}
                  </div>
                  <span className="text-[10px] text-[#AAB4BF] mt-1 block">Live ticking contracts</span>
                </div>

                <div className="bg-[#17212D] border border-[#354251] rounded-xl p-4">
                  <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">3M Advance Alerts</span>
                  <div className="text-3xl sm:text-4xl font-black text-[#C4A574] mt-1 tabular-nums">
                    {signalAlerts.length}
                  </div>
                  <span className="text-[10px] text-[#AAB4BF] mt-1 block">Pre-entry setup window</span>
                </div>

                <div className="bg-[#17212D] border border-[#354251] rounded-xl p-4">
                  <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Settling / Verifying</span>
                  <div className="text-3xl sm:text-4xl font-black text-[#6C9D91] mt-1 tabular-nums">
                    {verifyingTrades.length}
                  </div>
                  <span className="text-[10px] text-[#AAB4BF] mt-1 block">Awaiting broker close</span>
                </div>

                <div className="bg-[#17212D] border border-[#354251] rounded-xl p-4">
                  <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Next 5M Entry</span>
                  <div className="text-2xl sm:text-3xl font-black text-[#E8E5DE] mt-1 tabular-nums">
                    {next5mCountdownStr}
                  </div>
                  <span className="text-[10px] text-[#72A98B] mt-1 block">Autonomous cycle online</span>
                </div>
              </div>
            </div>

            {/* Active Trades Table */}
            <div className="space-y-4">
              <h3 className="text-sm font-black font-mono text-[#E8E5DE] uppercase tracking-wider flex items-center gap-2">
                <Activity className="w-4 h-4 text-[#72A98B]" />
                <span>Active &amp; Advance Signal Ledger</span>
              </h3>
              {activeTrades.length === 0 && signalAlerts.length === 0 ? (
                <div className="bg-[#222B36] border border-[#354251] rounded-2xl p-8 text-center text-xs font-mono text-[#AAB4BF] space-y-3">
                  <Radio className="w-8 h-8 text-[#6C9D91] mx-auto animate-pulse" />
                  <div className="text-base font-black text-[#E8E5DE]">
                    NO ACTIVE CONTRACTS IN MARKET AT THIS SECOND
                  </div>
                  <p className="max-w-md mx-auto">
                    The 24/5 scanner runs every 20 seconds. Next 5-minute candle opening in{' '}
                    <strong className="text-[#E8E5DE]">{next5mCountdownStr}</strong>.
                    Pre-entry alerts trigger strictly 3 minutes prior (:02, :07, :12...).
                  </p>
                </div>
              ) : (
                renderTradeTable(applyFilters([...activeTrades, ...signalAlerts, ...verifyingTrades]))
              )}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* LAYER 1: ALL BOT TRADES (NEVER RESETS TO ZERO) */}
        {/* ========================================================= */}
        {activeLayer === 'ALL' && (
          <div className="space-y-6 animate-in fade-in duration-150">
            {/* All-Time Performance Scorecard */}
            <div className="bg-[#222B36] border border-[#354251] rounded-2xl p-5 sm:p-6 shadow-xl space-y-4 font-mono">
              <div className="flex flex-wrap items-center justify-between pb-3 border-b border-[#354251] gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#6C9D91]" />
                  <h2 className="text-base font-black text-[#E8E5DE] uppercase tracking-wider">
                    SIGNAL SETUPS &amp; SETTLED CONTRACT SCORECARD
                  </h2>
                </div>
                <div className="text-xs text-[#AAB4BF]">
                  Current signal window · older paper outcomes retained separately
                </div>
              </div>

              {/* Separate signal, fill and settlement counters; this is the retained signal window. */}
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
                <div className="bg-[#17212D] border border-[#354251] rounded-xl p-4">
                  <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Current Window Win Rate</span>
                  <div className="text-3xl sm:text-4xl font-black text-[#E8E5DE] mt-1 tabular-nums">
                    {allWinRate !== null ? `${allWinRate}%` : '—'}
                  </div>
                  <span className="text-[10px] text-[#72A98B] font-bold mt-1 block">
                    {allWins} Wins · {allLosses} Losses
                  </span>
                </div>

                <div className="bg-[#17212D] border border-[#354251] rounded-xl p-4">
                  <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Signal Setups</span>
                  <div className="text-3xl sm:text-4xl font-black text-[#E8E5DE] mt-1 tabular-nums">{allSignals.length}</div>
                  <span className="text-[10px] text-[#AAB4BF] mt-1 block">Unique retained records</span>
                </div>

                <div className="bg-[#17212D] border border-[#354251] rounded-xl p-4">
                  <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Filled Contracts</span>
                  <div className="text-3xl sm:text-4xl font-black text-[#E8E5DE] mt-1 tabular-nums">{allExecutedTrades.length}</div>
                  <span className="text-[10px] text-[#AAB4BF] mt-1 block">{Math.max(0, allExecutedTrades.length - allSettledTrades.length)} awaiting settlement</span>
                </div>

                <div className="bg-[#17212D] border border-[#354251] rounded-xl p-4">
                  <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Settled Outcomes</span>
                  <div className="text-3xl sm:text-4xl font-black text-[#E8E5DE] mt-1 tabular-nums">{allSettledTrades.length}</div>
                  <span className="text-[10px] text-[#AAB4BF] mt-1 block">{allWins}W · {allLosses}L · {allSettledTrades.filter(t => t.outcomeResult === 'SCRATCH').length} scratches</span>
                </div>

                <div className="bg-[#17212D] border border-[#354251] rounded-xl p-4">
                  <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Net Paper Return</span>
                  <div className={`text-3xl sm:text-4xl font-black mt-1 tabular-nums ${allNetUnits >= 0 ? 'text-[#72A98B]' : 'text-[#B7797D]'}`}>
                    {allNetUnits >= 0 ? `+${allNetUnits}` : allNetUnits} U
                  </div>
                  <span className="text-[10px] text-[#AAB4BF] mt-1 block">Recorded binary payout units</span>
                </div>

                <div className="bg-[#17212D] border border-[#354251] rounded-xl p-4">
                  <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Expired Unfilled Setups</span>
                  <div className="text-3xl sm:text-4xl font-black mt-1 tabular-nums text-[#E8E5DE]">{allExpiredUnfilled}</div>
                  <span className="text-[10px] text-[#AAB4BF] mt-1 block">Excluded from contract outcomes</span>
                </div>
              </div>
            </div>

            {/* All Trades Ledger */}
            <div className="bg-[#222B36] border border-[#354251] rounded-2xl overflow-hidden shadow-xl">
              <div className="p-4 bg-[#17212D] border-b border-[#354251] flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
                <div className="flex items-center gap-2">
                  <strong className="text-sm font-black text-[#E8E5DE]">
                    ALL SIGNALS &amp; TRADES AUDIT LEDGER ({displayedAllSignals.length})
                  </strong>
                  <span className="text-[#AAB4BF]">· Filter: {statusFilter}</span>
                </div>
                {allExecutedTrades.length > 0 && (
                  <button
                    onClick={() => setShowClearConfirm(true)}
                    className="text-xs text-[#B7797D] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear All History</span>
                  </button>
                )}
              </div>

              {renderTradeTable(displayedAllSignals)}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* LAYER 2: TODAY'S CALENDAR DAY TRADES */}
        {/* ========================================================= */}
        {activeLayer === 'TODAY' && (
          <div className="space-y-6 animate-in fade-in duration-150">
            {/* Today's Executive Scorecard */}
            <div className="bg-[#222B36] border border-[#354251] rounded-2xl p-5 sm:p-6 shadow-xl space-y-4 font-mono">
              <div className="flex flex-wrap items-center justify-between pb-3 border-b border-[#354251] gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#72A98B]" />
                  <h2 className="text-base font-black text-[#E8E5DE] uppercase">
                    TODAY&apos;S SETTLED PERFORMANCE SCORECARD
                  </h2>
                  <span className="text-xs text-[#AAB4BF]">({formatIstDateHeading(nowDate)})</span>
                </div>
                <div className="text-xs text-[#6C9D91]">
                  Strictly Today&apos;s Calendar Day • Indian Standard Time
                </div>
              </div>

              {/* 4-Stat High-Visibility Strip */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-[#17212D] border border-[#354251] rounded-xl p-4">
                  <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Today&apos;s Win Rate</span>
                  <div className="text-3xl sm:text-4xl font-black text-[#E8E5DE] mt-1 tabular-nums">
                    {todayWinRate !== null ? `${todayWinRate}%` : '—'}
                  </div>
                  <span className="text-[10px] text-[#72A98B] font-bold mt-1 block">
                    {todayWins} Wins · {todayLosses} Losses
                  </span>
                </div>

                <div className="bg-[#17212D] border border-[#354251] rounded-xl p-4">
                  <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Today&apos;s Executed Fills</span>
                  <div className="text-3xl sm:text-4xl font-black text-[#E8E5DE] mt-1 tabular-nums">
                    {todayExecutedTrades.length}
                  </div>
                  <span className="text-[10px] text-[#AAB4BF] mt-1 block">
                    {todaySignals.length} signals generated today
                  </span>
                </div>

                <div className="bg-[#17212D] border border-[#354251] rounded-xl p-4">
                  <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Today&apos;s Net Paper Return</span>
                  <div className={`text-3xl sm:text-4xl font-black mt-1 tabular-nums ${todayNetUnits >= 0 ? 'text-[#72A98B]' : 'text-[#B7797D]'}`}>
                    {todayNetUnits >= 0 ? `+${todayNetUnits}` : todayNetUnits} U
                  </div>
                  <span className="text-[10px] text-[#AAB4BF] mt-1 block">After broker payout ratio</span>
                </div>

                <div className="bg-[#17212D] border border-[#354251] rounded-xl p-4">
                <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Expired Unfilled Today</span>
                <div className="text-3xl sm:text-4xl font-black mt-1 tabular-nums text-[#E8E5DE]">{todayExpiredUnfilled}</div>
                <span className="text-[10px] text-[#AAB4BF] mt-1 block">Not counted as trades</span>
              </div>
              </div>
            </div>

            {/* Information Banner if Today has 0 settled trades */}
            {todaySettledTrades.length === 0 && (
              <div className="bg-[#17212D] border border-[#354251] rounded-xl p-4 text-xs font-mono text-[#AAB4BF] flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <strong className="text-[#E8E5DE] block">
                    Session In Progress ({formatIstDateHeading(nowDate)})
                  </strong>
                  <p>
                    {todaySignals.length > 0
                      ? `${todaySignals.length} signal(s) active/queued in market today. Completed binary contract outcomes will appear once 5M expiries settle.`
                      : `Today's 5M autonomous scanner is actively monitoring ${FOREX_PAIRS.length} Forex pairs.`}
                  </p>
                </div>
                {latestCompletedSession && (
                  <button
                    onClick={() => setActiveLayer('YESTERDAY')}
                    className="px-3.5 py-2 rounded-lg bg-[#6C9D91] hover:bg-[#72A98B] text-[#17212D] text-xs font-black whitespace-nowrap transition-colors cursor-pointer"
                  >
                    View Latest Completed Session ({latestCompletedSession.displayDate} · {latestCompletedSession.winRate}% WR) →
                  </button>
                )}
              </div>
            )}

            {/* Today's Completed Trades Table */}
            <div className="bg-[#222B36] border border-[#354251] rounded-2xl overflow-hidden shadow-xl">
              <div className="p-4 bg-[#17212D] border-b border-[#354251] flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
                <div className="flex items-center gap-2">
                  <strong className="text-sm font-black text-[#E8E5DE]">
                    TODAY&apos;S TRADES LEDGER ({displayedTodaySignals.length})
                  </strong>
                  <span className="text-[#AAB4BF]">· Never mixed with yesterday&apos;s trades</span>
                </div>
              </div>

              {renderTradeTable(displayedTodaySignals)}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 2: YESTERDAY'S AUDITED ARCHIVE LAYER */}
        {/* ========================================================= */}
        {activeLayer === 'YESTERDAY' && (
          <div className="space-y-6 animate-in fade-in duration-150">
            {/* Fallback Notice if Yesterday had 0 settled trades */}
            {yesterdaySignals.length === 0 && latestCompletedSession && (
              <div className="bg-[#222B36] border border-[#C4A574]/60 rounded-2xl p-4 sm:p-5 font-mono text-xs space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#C4A574] animate-pulse" />
                  <span className="text-[#C4A574] font-black text-sm uppercase">
                    CALENDAR YESTERDAY ({formatIstDateHeading(yesterdayDate)}): 0 SIGNALS LOGGED
                  </span>
                </div>
                <p className="text-[#AAB4BF] leading-relaxed">
                  Forex market was off-cycle or closed during yesterday&apos;s 24-hour calendar window.
                  Displaying <strong className="text-[#E8E5DE]">Latest Audited Trading Session ({latestCompletedSession.displayDate})</strong> below so all verified trades and accuracy statistics are readily available.
                </p>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <span className="px-2.5 py-1 rounded bg-[#17212D] text-[#72A98B] border border-[#72A98B]/40 font-bold">
                    {latestCompletedSession.displayDate} · {latestCompletedSession.settledTrades.length} Trades · {latestCompletedSession.winRate}% Win Rate · {latestCompletedSession.netUnits >= 0 ? `+${latestCompletedSession.netUnits}` : latestCompletedSession.netUnits} U
                  </span>
                  <button
                    onClick={() => setActiveLayer('DAILY_SESSIONS')}
                    className="text-xs text-[#6C9D91] hover:underline font-bold cursor-pointer"
                  >
                    View All {dailySessions.length} Daily Sessions →
                  </button>
                </div>
              </div>
            )}

            {/* Yesterday / Latest Session Executive Scorecard */}
            {(() => {
              const displaySigs = yesterdaySignals.length > 0 ? displayedYesterdaySignals : (latestCompletedSession ? applyFilters(latestCompletedSession.signals) : []);
              const sessionTitle = yesterdaySignals.length > 0 ? formatIstDateHeading(yesterdayDate) : (latestCompletedSession ? `${latestCompletedSession.displayDate} (Latest Session)` : 'Historical Session');
              const winRate = yesterdaySignals.length > 0 ? yesterdayWinRate : (latestCompletedSession?.winRate ?? null);
              const wins = yesterdaySignals.length > 0 ? yesterdayWins : (latestCompletedSession?.wins ?? 0);
              const losses = yesterdaySignals.length > 0 ? yesterdayLosses : (latestCompletedSession?.losses ?? 0);
              const execCount = yesterdaySignals.length > 0 ? yesterdayExecutedTrades.length : (latestCompletedSession?.executedTrades.length ?? 0);
              const totalLogged = yesterdaySignals.length > 0 ? yesterdaySignals.length : (latestCompletedSession?.signals.length ?? 0);
              const netUnits = yesterdaySignals.length > 0 ? yesterdayNetUnits : (latestCompletedSession?.netUnits ?? 0);
              const expiredUnfilled = yesterdaySignals.length > 0 ? yesterdayExpiredUnfilled : (latestCompletedSession?.expiredUnfilledSetups ?? 0);

              return (
                <div className="space-y-6">
                  <div className="bg-[#222B36] border-2 border-[#C4A574]/60 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4 font-mono">
                    <div className="flex flex-wrap items-center justify-between pb-3 border-b border-[#354251] gap-2">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#C4A574]" />
                        <h2 className="text-base font-black text-[#E8E5DE] uppercase">
                          {yesterdaySignals.length > 0 ? 'YESTERDAY\'S AUDITED PERFORMANCE SCORECARD' : 'LATEST AUDITED SESSION SCORECARD'}
                        </h2>
                        <span className="text-xs text-[#C4A574] font-bold">({sessionTitle})</span>
                      </div>
                      <div className="text-xs text-[#AAB4BF]">
                        Completely Isolated Historical Archive Layer
                      </div>
                    </div>

                    {/* 4-Stat High-Visibility Strip */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-[#17212D] border border-[#354251] rounded-xl p-4">
                        <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Audited Win Rate</span>
                        <div className="text-3xl sm:text-4xl font-black text-[#C4A574] mt-1 tabular-nums">
                          {winRate !== null ? `${winRate}%` : '—'}
                        </div>
                        <span className="text-[10px] text-[#72A98B] font-bold mt-1 block">
                          {wins} Wins · {losses} Losses
                        </span>
                      </div>

                      <div className="bg-[#17212D] border border-[#354251] rounded-xl p-4">
                        <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Executed Trades</span>
                        <div className="text-3xl sm:text-4xl font-black text-[#E8E5DE] mt-1 tabular-nums">
                          {execCount}
                        </div>
                        <span className="text-[10px] text-[#AAB4BF] mt-1 block">
                          {totalLogged} total signals logged
                        </span>
                      </div>

                      <div className="bg-[#17212D] border border-[#354251] rounded-xl p-4">
                        <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Net Return Units</span>
                        <div className={`text-3xl sm:text-4xl font-black mt-1 tabular-nums ${netUnits >= 0 ? 'text-[#72A98B]' : 'text-[#B7797D]'}`}>
                          {netUnits >= 0 ? `+${netUnits}` : netUnits} U
                        </div>
                        <span className="text-[10px] text-[#AAB4BF] mt-1 block">Recorded binary payout units</span>
                      </div>

                      <div className="bg-[#17212D] border border-[#354251] rounded-xl p-4">
                        <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Expired Unfilled Setups</span>
                        <div className="text-3xl sm:text-4xl font-black mt-1 tabular-nums text-[#E8E5DE]">{expiredUnfilled}</div>
                        <span className="text-[10px] text-[#AAB4BF] mt-1 block">Excluded from trade results</span>
                      </div>
                    </div>
                  </div>

                  {/* Completed Trades Table */}
                  <div className="bg-[#222B36] border border-[#354251] rounded-2xl overflow-hidden shadow-xl">
                    <div className="p-4 bg-[#17212D] border-b border-[#354251] flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
                      <div className="flex items-center gap-2">
                        <strong className="text-sm font-black text-[#E8E5DE]">
                          {yesterdaySignals.length > 0 ? 'YESTERDAY\'S AUDITED TRADES LEDGER' : `LATEST AUDITED SESSION LEDGER (${sessionTitle})`} ({displaySigs.length})
                        </strong>
                        <span className="text-[#C4A574]">· 100% Real Audited Data</span>
                      </div>
                      <div className="text-xs text-[#AAB4BF]">
                        Immutable Historical Ledger
                      </div>
                    </div>

                    {renderTradeTable(displaySigs)}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB: DAILY SESSIONS BREAKDOWN & MULTI-DAY EXPLORER */}
        {/* ========================================================= */}
        {activeLayer === 'DAILY_SESSIONS' && (
          <div className="space-y-6 animate-in fade-in duration-150">
            {/* Header & Day Selector Strip */}
            <div className="bg-[#222B36] border border-[#354251] rounded-2xl p-5 sm:p-6 shadow-xl space-y-4 font-mono">
              <div className="flex flex-wrap items-center justify-between pb-3 border-b border-[#354251] gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#72A98B]" />
                  <h2 className="text-base font-black text-[#E8E5DE] uppercase tracking-wider">
                    DAILY SESSIONS AUDIT MATRIX &amp; CALENDAR BREAKDOWN
                  </h2>
                </div>
                <div className="text-xs text-[#72A98B] font-bold">
                  {dailySessions.length} Recorded Calendar Sessions • 100% Real Audited Data (IST)
                </div>
              </div>

              {/* Day Selector Buttons */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  onClick={() => setSelectedSessionDate('ALL')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    selectedSessionDate === 'ALL'
                      ? 'bg-[#72A98B] text-[#17212D] shadow-sm'
                      : 'bg-[#17212D] text-[#AAB4BF] hover:text-[#E8E5DE] border border-[#354251]'
                  }`}
                >
                  All Days ({dailySessions.length})
                </button>

                {dailySessions.map(session => (
                  <button
                    key={session.dateKey}
                    onClick={() => setSelectedSessionDate(session.dateKey)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      selectedSessionDate === session.dateKey
                        ? 'bg-[#6C9D91] text-[#17212D] shadow-sm'
                        : 'bg-[#17212D] text-[#AAB4BF] hover:text-[#E8E5DE] border border-[#354251]'
                    }`}
                  >
                    <span>{session.displayDate}</span>
                    <span className="px-1.5 py-0.2 rounded text-[10px] bg-[#121820]/40 text-current">
                      {session.signals.length} {session.winRate !== null ? `· ${session.winRate}%` : ''}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Selected Session (or Daily Summary Cards) */}
            {selectedSessionDate === 'ALL' ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono">
                {dailySessions.map(session => (
                  <div
                    key={`card_${session.dateKey}`}
                    onClick={() => setSelectedSessionDate(session.dateKey)}
                    className="bg-[#222B36] hover:bg-[#222B36]/90 border border-[#354251] hover:border-[#6C9D91] rounded-2xl p-5 space-y-4 shadow-lg cursor-pointer transition-all"
                  >
                    <div className="flex items-center justify-between pb-2 border-b border-[#354251]">
                      <div>
                        <div className="text-base font-black text-[#E8E5DE]">{session.displayDate}</div>
                        <div className="text-[11px] text-[#AAB4BF]">{session.dayOfWeek}</div>
                      </div>
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                        session.isToday
                          ? 'bg-[#72A98B]/20 text-[#72A98B] border border-[#72A98B]/40'
                          : session.isYesterday
                          ? 'bg-[#C4A574]/20 text-[#C4A574] border border-[#C4A574]/40'
                          : 'bg-[#354251]/40 text-[#AAB4BF]'
                      }`}>
                        {session.isToday ? 'TODAY' : session.isYesterday ? 'YESTERDAY' : 'AUDITED'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="bg-[#17212D] border border-[#354251] p-3 rounded-xl">
                        <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Win Rate</span>
                        <div className="text-2xl font-black text-[#E8E5DE] mt-0.5">
                          {session.winRate !== null ? `${session.winRate}%` : 'Active'}
                        </div>
                        <span className="text-[10px] text-[#72A98B] block mt-0.5">
                          {session.wins}W · {session.losses}L
                        </span>
                      </div>

                      <div className="bg-[#17212D] border border-[#354251] p-3 rounded-xl">
                        <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Net Units</span>
                        <div className={`text-2xl font-black mt-0.5 ${session.netUnits >= 0 ? 'text-[#72A98B]' : 'text-[#B7797D]'}`}>
                          {session.netUnits >= 0 ? `+${session.netUnits}` : session.netUnits} U
                        </div>
                        <span className="text-[10px] text-[#AAB4BF] block mt-0.5">
                          {session.executedTrades.length} fills
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs text-[#6C9D91] pt-1">
                      <span>{session.signals.length} Total Signals Emitted</span>
                      <span className="font-bold">Inspect Day →</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* Specific Day Selected: Detailed Scorecard */
              (() => {
                const cur = dailySessions.find(d => d.dateKey === selectedSessionDate) || dailySessions[0];
                if (!cur) return null;
                const filteredSigs = applyFilters(cur.signals);

                return (
                  <div className="space-y-6">
                    <div className="bg-[#222B36] border-2 border-[#6C9D91]/60 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4 font-mono">
                      <div className="flex flex-wrap items-center justify-between pb-3 border-b border-[#354251] gap-2">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#6C9D91]" />
                          <h2 className="text-base font-black text-[#E8E5DE] uppercase">
                            SESSION AUDIT: {cur.displayDate} ({cur.dayOfWeek})
                          </h2>
                          <span className="text-xs text-[#6C9D91] font-bold">
                            {cur.isToday ? 'TODAY' : cur.isYesterday ? 'YESTERDAY' : 'COMPLETED SESSION'}
                          </span>
                        </div>
                        <button
                          onClick={() => setSelectedSessionDate('ALL')}
                          className="text-xs text-[#AAB4BF] hover:text-[#E8E5DE] underline cursor-pointer"
                        >
                          ← View All Days
                        </button>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-[#17212D] border border-[#354251] rounded-xl p-4">
                          <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Day Win Rate</span>
                          <div className="text-3xl sm:text-4xl font-black text-[#6C9D91] mt-1 tabular-nums">
                            {cur.winRate !== null ? `${cur.winRate}%` : '—'}
                          </div>
                          <span className="text-[10px] text-[#72A98B] font-bold mt-1 block">
                            {cur.wins} Wins · {cur.losses} Losses
                          </span>
                        </div>

                        <div className="bg-[#17212D] border border-[#354251] rounded-xl p-4">
                          <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Executed Trades</span>
                          <div className="text-3xl sm:text-4xl font-black text-[#E8E5DE] mt-1 tabular-nums">
                            {cur.executedTrades.length}
                          </div>
                          <span className="text-[10px] text-[#AAB4BF] mt-1 block">
                            {cur.signals.length} total signals
                          </span>
                        </div>

                        <div className="bg-[#17212D] border border-[#354251] rounded-xl p-4">
                          <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Day Net Units</span>
                          <div className={`text-3xl sm:text-4xl font-black mt-1 tabular-nums ${cur.netUnits >= 0 ? 'text-[#72A98B]' : 'text-[#B7797D]'}`}>
                            {cur.netUnits >= 0 ? `+${cur.netUnits}` : cur.netUnits} U
                          </div>
                          <span className="text-[10px] text-[#AAB4BF] mt-1 block">Binary contract returns</span>
                        </div>

                        <div className="bg-[#17212D] border border-[#354251] rounded-xl p-4">
                          <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Expired Unfilled Setups</span>
                          <div className="text-3xl sm:text-4xl font-black mt-1 tabular-nums text-[#E8E5DE]">{cur.expiredUnfilledSetups}</div>
                          <span className="text-[10px] text-[#AAB4BF] mt-1 block">Not entered, not a trade</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-[#222B36] border border-[#354251] rounded-2xl overflow-hidden shadow-xl">
                      <div className="p-4 bg-[#17212D] border-b border-[#354251] flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
                        <strong className="text-sm font-black text-[#E8E5DE]">
                          {cur.displayDate} AUDITED TRADES LEDGER ({filteredSigs.length})
                        </strong>
                        <span className="text-[#AAB4BF]">Indian Standard Time (IST)</span>
                      </div>
                      {renderTradeTable(filteredSigs)}
                    </div>
                  </div>
                );
              })()
            )}
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 3: SESSION ACCURACY MATRIX */}
        {/* ========================================================= */}
        {activeLayer === 'SESSIONS' && (
          <div className="space-y-6 animate-in fade-in duration-150">
            <div className="bg-[#222B36] border border-[#354251] rounded-2xl p-5 space-y-2 font-mono text-xs">
              <h2 className="text-base font-black text-[#E8E5DE] uppercase">
                GLOBAL MARKET SESSIONS MATRIX (IST SYNCHRONIZED)
              </h2>
              <p className="text-[#AAB4BF]">
                Live accuracy breakdown by geographic market session window.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-mono text-xs">
              {[
                {
                  id: 'ASIA',
                  name: 'Tokyo / Asian Session',
                  ist: '05:30 AM – 12:30 PM IST',
                  desc: 'Consolidation, JPY/AUD flows',
                },
                {
                  id: 'LONDON',
                  name: 'London / European Session',
                  ist: '12:30 PM – 05:30 PM IST',
                  desc: 'High institutional volume',
                },
                {
                  id: 'OVERLAP',
                  name: 'London / NY Overlap',
                  ist: '05:30 PM – 09:30 PM IST',
                  desc: 'Peak global liquidity',
                },
                {
                  id: 'NEW_YORK',
                  name: 'New York Session',
                  ist: '09:30 PM – 02:30 AM IST',
                  desc: 'USD momentum announcements',
                },
              ].map((sess, sIdx) => {
                const sessionTrades = signals.filter(s => {
                  if (s.lifecycleState !== 'CLOSED') return false;
                  const t = s.actualEntryTimeUtc || s.predictionTimeUtc;
                  return s.marketSession ? s.marketSession === sess.id : getSessionFromTimestamp(t).id === sess.id;
                });
                const wins = sessionTrades.filter(s => s.outcomeResult === 'WIN').length;
                const losses = sessionTrades.filter(s => s.outcomeResult === 'LOSS').length;
                const scored = wins + losses;
                const wr = scored > 0 ? Number(((wins / scored) * 100).toFixed(1)) : null;

                return (
                  <div
                    key={`terminal_sess_${sess.id}_${sIdx}`}
                    className="bg-[#222B36] border border-[#354251] rounded-xl p-5 space-y-3 flex flex-col justify-between"
                  >
                    <div>
                      <span className="text-[10px] text-[#6C9D91] font-bold uppercase">{sess.id}</span>
                      <h3 className="text-base font-bold text-[#E8E5DE] mt-0.5">{sess.name}</h3>
                      <div className="text-[11px] text-[#AAB4BF] mt-0.5">{sess.ist}</div>
                    </div>

                    <div className="p-3.5 rounded-lg bg-[#17212D] border border-[#354251]">
                      <div className="text-2xl font-black text-[#E8E5DE] tabular-nums">
                        {wr !== null ? `${wr}% Win Rate` : '—'}
                      </div>
                      <div className="text-[10px] text-[#72A98B] mt-0.5 font-semibold">
                        {scored > 0 ? `${wins} Wins / ${losses} Losses` : 'No settled trades yet'}
                      </div>
                    </div>

                    <div className="text-[10px] text-[#AAB4BF]">{sess.desc}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* ------------------------------------------------------------- */}
      {/* 5. AUDIT INSPECTOR MODAL */}
      {/* ------------------------------------------------------------- */}
      {selectedSignal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-[#222B36] border border-[#354251] rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl text-xs font-sans">
            <div className="p-5 bg-[#17212D] border-b border-[#354251] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-2xl font-black font-mono text-[#E8E5DE]">{selectedSignal.symbol}</span>
                <span
                  className={`px-2.5 py-1 rounded text-xs font-black font-mono ${
                    selectedSignal.direction === 'BUY' ? 'bg-[#72A98B] text-[#17212D]' : 'bg-[#B7797D] text-[#17212D]'
                  }`}
                >
                  {selectedSignal.direction}
                </span>
                <span className="text-xs font-mono text-[#AAB4BF]">ID: {selectedSignal.id}</span>
              </div>
              <button
                onClick={() => setSelectedSignal(null)}
                className="p-1.5 rounded-lg bg-[#222B36] text-[#AAB4BF] hover:text-[#E8E5DE] border border-[#354251] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 font-mono text-xs max-h-[75vh] overflow-y-auto">
              {(() => {
                const timings = getSignalTimings(selectedSignal);
                return (
                  <div className="p-4 rounded-xl bg-[#17212D] border border-[#354251] space-y-2">
                    <div className="text-[10px] text-[#6C9D91] uppercase font-bold tracking-wider">
                      Indian Standard Time (IST) Execution Trail
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>Alert Generated: <strong className="text-[#E8E5DE]">{timings.alertTimeIst}</strong></div>
                      <div>Entry Fill: <strong className="text-[#E8E5DE]">{timings.entryTimeIst}</strong></div>
                      <div>Target Expiry: <strong className="text-[#E8E5DE]">{timings.expiryTimeIst}</strong></div>
                      <div>Duration: <strong className="text-[#E8E5DE]">{timings.durationMinutes} Minutes</strong></div>
                    </div>
                  </div>
                );
              })()}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
                <div className="p-3 rounded-xl bg-[#17212D] border border-[#354251]">
                  <span className="text-[10px] text-[#AAB4BF] uppercase block">Entry Price</span>
                  <span className="text-sm font-bold text-[#E8E5DE]">
                    {selectedSignal.actualEntryPrice?.toFixed(5) || selectedSignal.triggerPrice?.toFixed(5)}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-[#17212D] border border-[#354251]">
                  <span className="text-[10px] text-[#AAB4BF] uppercase block">Exit Price</span>
                  <span className="text-sm font-bold text-[#E8E5DE]">
                    {selectedSignal.actualExitPrice?.toFixed(5) || 'Pending'}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-[#17212D] border border-[#354251]">
                  <span className="text-[10px] text-[#AAB4BF] uppercase block">Payout Ratio</span>
                  <span className="text-sm font-bold text-[#E8E5DE]">{selectedSignal.payoutPct || 85}%</span>
                </div>
                <div className="p-3 rounded-xl bg-[#17212D] border border-[#354251]">
                  <span className="text-[10px] text-[#AAB4BF] uppercase block">Result</span>
                  <span className="text-sm font-bold text-[#72A98B]">
                    {selectedSignal.outcomeResult || selectedSignal.lifecycleState}
                  </span>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#17212D] border border-[#354251] space-y-1">
                <div className="text-[10px] text-[#AAB4BF] uppercase font-bold">Strategy Logic</div>
                <div className="text-sm font-bold text-[#E8E5DE]">
                  {selectedSignal.strategyName || selectedSignal.ruleFamily}
                </div>
                <p className="text-[#AAB4BF] text-[11px] pt-1">{selectedSignal.entryCondition}</p>
              </div>

              {selectedSignal.lossAutopsy && (
                <div className="p-4 rounded-xl bg-[#B7797D]/10 border border-[#B7797D]/40 space-y-1.5">
                  <div className="flex items-center gap-2 text-[#B7797D] font-bold text-xs uppercase">
                    <Microscope className="w-4 h-4 text-[#B7797D]" />
                    <span>Forensic Loss Autopsy</span>
                  </div>
                  <div className="text-xs text-[#E8E5DE]">
                    <strong className="text-[#B7797D]">Root Cause:</strong> {selectedSignal.lossAutopsy.rootCause}
                  </div>
                  <p className="text-[#E8E5DE]/85 text-[11px] leading-relaxed">
                    {selectedSignal.lossAutopsy.rootCauseExplanation}
                  </p>
                </div>
              )}
            </div>

            <div className="p-4 bg-[#17212D] border-t border-[#354251] flex justify-end">
              <button
                onClick={() => setSelectedSignal(null)}
                className="px-4 py-2 bg-[#222B36] hover:bg-[#354251] text-[#E8E5DE] border border-[#354251] rounded-lg text-xs font-bold cursor-pointer"
              >
                Close Audit Inspector
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-[#222B36] border border-[#B7797D]/50 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl text-xs font-sans">
            <div className="flex items-center gap-3 text-[#B7797D]">
              <div className="p-2 rounded-lg bg-[#17212D] border border-[#B7797D]/40">
                <Trash2 className="w-5 h-5 text-[#B7797D]" />
              </div>
              <h3 className="text-base font-bold text-[#E8E5DE]">Reset Today&apos;s Trade Counter?</h3>
            </div>
            <p className="text-[#AAB4BF] leading-relaxed text-xs">
              This resets today&apos;s trade list to 0. Yesterday&apos;s archive layer and historical statistics remain preserved.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-4 py-2 rounded-lg bg-[#17212D] hover:bg-[#354251] border border-[#354251] text-[#AAB4BF] hover:text-[#E8E5DE] font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleClearHistory}
                disabled={isClearingHistory}
                className="px-4 py-2 rounded-lg bg-[#B7797D] hover:bg-[#B7797D]/80 text-[#17212D] font-bold cursor-pointer"
              >
                {isClearingHistory ? 'Resetting...' : 'Confirm Reset'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AGI Self-Learning Modal */}
      <AgiSelfLearningModal isOpen={showAgiModal} onClose={() => setShowAgiModal(false)} />
    </div>
  );
};
