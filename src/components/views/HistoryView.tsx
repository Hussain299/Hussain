import React, { useState, useMemo } from 'react';
import {
  History,
  Search,
  Filter,
  Download,
  Calendar,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCcw,
  SlidersHorizontal,
  FileSpreadsheet,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import { ResearchSignal, FOREX_PAIRS, ForexSymbol } from '../../types/index.js';
import { getBotForSignal, BotId, BOT_DEFINITIONS } from '../../utils/botControls.js';
import { TradeAuditModal } from '../common/TradeAuditModal.tsx';
import { useFirebase } from '../../contexts/FirebaseContext.tsx';
import { isExpiredUnfilledSetup, isTerminalUnfilledSetup, summarizeSignalAccounting } from '../../utils/tradeAccounting.js';

interface HistoryViewProps {
  signals: ResearchSignal[];
  onRefresh?: () => void;
}

type DateLayer = 'ALL' | 'TODAY' | 'YESTERDAY';
type StatusFilter = 'ALL' | 'WIN' | 'LOSS' | 'SCRATCH' | 'EXPIRED';
type DirectionFilter = 'ALL' | 'BUY' | 'SELL';

export const HistoryView: React.FC<HistoryViewProps> = ({ signals, onRefresh }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [dateLayer, setDateLayer] = useState<DateLayer>('ALL');
  const [strategyFilter, setStrategyFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [pairFilter, setPairFilter] = useState<string>('ALL');
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('ALL');
  const [selectedSignal, setSelectedSignal] = useState<ResearchSignal | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const { user, deleteClosedSignalsFromFirestore } = useFirebase();

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

  const now = new Date();
  const todayIstKey = getIstDateKey(now);
  const todayIstString = now.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });

  const yesterdayDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const yesterdayIstKey = getIstDateKey(yesterdayDate);
  const yesterdayIstString = yesterdayDate.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });

  // Separate Signals into Layers strictly by IST calendar day (canonical entry/alert timestamp)
  const todaySignals = useMemo(() => {
    return signals.filter(s => getIstDateKey(s.actualEntryTimeUtc || s.candleOpenTimeUtc || s.predictionTimeUtc) === todayIstKey);
  }, [signals, todayIstKey]);

  const yesterdaySignals = useMemo(() => {
    return signals.filter(s => getIstDateKey(s.actualEntryTimeUtc || s.candleOpenTimeUtc || s.predictionTimeUtc) === yesterdayIstKey);
  }, [signals, yesterdayIstKey]);

  // Base list depending on active DateLayer
  const baseSignals = useMemo(() => {
    if (dateLayer === 'TODAY') return todaySignals;
    if (dateLayer === 'YESTERDAY') return yesterdaySignals;
    return signals;
  }, [dateLayer, todaySignals, yesterdaySignals, signals]);

  // Apply Search and Multi-Dimensional Filters
  const filteredSignals = useMemo(() => {
    return baseSignals.filter(signal => {
      if (!signal) return false;

      // Search query (symbol, strategy, formula, ID)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesSymbol = (signal.symbol || '').toLowerCase().includes(q);
        const matchesStrategy = (signal.strategyName || '').toLowerCase().includes(q);
        const matchesRule = (signal.ruleFamily || '').toLowerCase().includes(q);
        const matchesId = (signal.id || '').toLowerCase().includes(q);
        if (!matchesSymbol && !matchesStrategy && !matchesRule && !matchesId) {
          return false;
        }
      }

      // Strategy filter
      if (strategyFilter !== 'ALL') {
        const strat = ((signal.strategyName || '') + ' ' + (signal.ruleFamily || '')).toLowerCase();
        if (strategyFilter === 'MOMENTUM' && !strat.includes('momentum') && !strat.includes('trend')) return false;
        if (strategyFilter === 'REVERSION' && !strat.includes('reversion') && !strat.includes('liquidity')) return false;
        if (strategyFilter === 'NEURAL' && !strat.includes('neural') && !strat.includes('agi')) return false;
      }

      // Status filter
      if (statusFilter === 'EXPIRED') {
        if (!isExpiredUnfilledSetup(signal)) return false;
      } else if (statusFilter !== 'ALL' && signal.outcomeResult !== statusFilter) {
        return false;
      }

      // Pair filter
      if (pairFilter !== 'ALL' && signal.symbol !== pairFilter) {
        return false;
      }

      // Direction filter
      if (directionFilter !== 'ALL' && signal.direction !== directionFilter) {
        return false;
      }

      return true;
    });
  }, [baseSignals, searchQuery, strategyFilter, statusFilter, pairFilter, directionFilter]);

  // All scorecard fields share the same explicit signal/fill/settlement definitions.
  const stats = useMemo(
    () => summarizeSignalAccounting(filteredSignals),
    [filteredSignals]
  );

  // CSV Export Handler
  const handleExportCSV = () => {
    if (filteredSignals.length === 0) return;
    const headers = [
      'Signal ID',
      'Symbol',
      'Direction',
      'Bot',
      'Strategy',
      'Alert Time (IST)',
      'Entry Time (IST)',
      'Expiry Time (IST)',
      'Entry Price',
      'Exit Price',
      'Outcome',
      'Net Return Units',
      'Payout Pct',
    ];

    const rows = filteredSignals.map(s => {
      const bot = getBotForSignal(s);
      return [
        `"${s.id}"`,
        `"${s.symbol}"`,
        `"${s.direction}"`,
        `"${bot.name}"`,
        `"${s.strategyName || s.ruleFamily}"`,
        `"${s.predictionTimeIst || ''}"`,
        `"${s.candleOpenTimeIst || ''}"`,
        `"${s.candleCloseTimeIst || ''}"`,
        s.actualEntryPrice ?? s.triggerPrice ?? '',
        s.actualExitPrice ?? '',
        `"${s.outcomeResult || s.lifecycleState}"`,
        s.netReturnUnits ?? '',
        s.payoutPct ?? '',
      ].join(',');
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `signalforge_trades_${dateLayer.toLowerCase()}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleClearHistory = async () => {
    setIsClearing(true);
    try {
      await fetch('/api/signals/clear-history', { method: 'POST' });
      if (user) {
        await deleteClosedSignalsFromFirestore();
      }
      setShowClearConfirm(false);
      if (onRefresh) onRefresh();
    } catch (e) {
      console.error(e);
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="w-full bg-[#121820] text-[#E8E5DE] min-h-screen font-sans pb-24">
      {/* ------------------------------------------------------------- */}
      {/* HEADER & ISOLATED DATE LAYER SWITCHER */}
      {/* ------------------------------------------------------------- */}
      <div className="border-b border-[#243040] bg-[#161F2B] px-4 lg:px-8 py-3.5 sticky top-16 z-20">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
          {/* Left: Section Title & Isolated Layer Tabs */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-black tracking-wide text-[#E8E5DE] uppercase flex items-center gap-2">
              <History className="w-4 h-4 text-[#72A98B]" />
              <span>Historical Trade Ledger</span>
            </span>

            <span className="text-[#354251] mx-1">/</span>

            {/* Segmented Layer Switcher */}
            <div className="flex items-center bg-[#121820] border border-[#243040] p-1 rounded-lg gap-1">
              <button
                onClick={() => setDateLayer('ALL')}
                className={`px-3 py-1.5 rounded-md font-bold transition-all cursor-pointer ${
                  dateLayer === 'ALL'
                    ? 'bg-[#161F2B] text-[#72A98B] border border-[#72A98B]/40 shadow-sm'
                    : 'text-[#AAB4BF] hover:text-[#E8E5DE]'
                }`}
              >
                <span>Signal Setups</span>
                <span className="ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] bg-[#243040] text-[#AAB4BF]">
                  {signals.length}
                </span>
              </button>

              <button
                onClick={() => setDateLayer('TODAY')}
                className={`px-3 py-1.5 rounded-md font-bold transition-all cursor-pointer ${
                  dateLayer === 'TODAY'
                    ? 'bg-[#161F2B] text-[#6C9D91] border border-[#6C9D91]/40 shadow-sm'
                    : 'text-[#AAB4BF] hover:text-[#E8E5DE]'
                }`}
              >
                <span>Today&apos;s Session</span>
                <span className="ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] bg-[#243040] text-[#AAB4BF]">
                  {todaySignals.length}
                </span>
              </button>

              <button
                onClick={() => setDateLayer('YESTERDAY')}
                className={`px-3 py-1.5 rounded-md font-bold transition-all cursor-pointer ${
                  dateLayer === 'YESTERDAY'
                    ? 'bg-[#161F2B] text-[#C4A574] border border-[#C4A574]/40 shadow-sm'
                    : 'text-[#AAB4BF] hover:text-[#E8E5DE]'
                }`}
              >
                <span>Yesterday&apos;s Archive</span>
                <span className="ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] bg-[#243040] text-[#AAB4BF]">
                  {yesterdaySignals.length}
                </span>
              </button>
            </div>
          </div>

          {/* Right: Actions (CSV Export & Clear) */}
          <div className="flex items-center gap-2.5">
            <button
              onClick={handleExportCSV}
              disabled={filteredSignals.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#121820] hover:bg-[#243040] border border-[#243040] text-[#E8E5DE] font-semibold transition-colors disabled:opacity-40 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-[#6C9D91]" />
              <span>Export CSV</span>
            </button>

            {signals.length > 0 && (
              <button
                onClick={() => setShowClearConfirm(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#121820] hover:bg-[#B7797D]/20 border border-[#243040] hover:border-[#B7797D]/40 text-[#B7797D] font-semibold transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Reset Closed</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-6 space-y-6">
        {/* ------------------------------------------------------------- */}
        {/* SCORECARD STRIP FOR CURRENT FILTERED SELECTION */}
        {/* ------------------------------------------------------------- */}
        <div className="bg-[#161F2B] border border-[#243040] rounded-xl p-5 shadow-lg space-y-4 font-mono">
          <div className="flex flex-wrap items-center justify-between pb-3 border-b border-[#243040] gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-[#E8E5DE] uppercase">
                Audited Performance Scorecard
              </span>
              <span className="text-xs text-[#AAB4BF]">
                ({dateLayer === 'ALL' ? 'Multi-Day Complete Ledger' : dateLayer === 'TODAY' ? todayIstString : yesterdayIstString})
              </span>
            </div>
            <div className="text-xs text-[#AAB4BF]">
              Showing <strong className="text-[#E8E5DE]">{filteredSignals.length}</strong> of {baseSignals.length} records
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
            <div className="bg-[#121820] border border-[#243040] rounded-lg p-3.5">
              <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Win Rate</span>
              <div className="text-2xl sm:text-3xl font-black text-[#E8E5DE] mt-1 tabular-nums">
                {stats.winRate !== null ? `${stats.winRate}%` : '—'}
              </div>
              <span className="text-[10px] text-[#72A98B] font-bold block mt-1">
                {stats.wins}W · {stats.losses}L · {stats.scratches}S
              </span>
            </div>

            <div className="bg-[#121820] border border-[#243040] rounded-lg p-3.5">
              <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Signal Setups</span>
              <div className="text-2xl sm:text-3xl font-black text-[#E8E5DE] mt-1 tabular-nums">{stats.signalSetups}</div>
              <span className="text-[10px] text-[#AAB4BF] block mt-1">Unique recorded signals</span>
            </div>

            <div className="bg-[#121820] border border-[#243040] rounded-lg p-3.5">
              <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Filled Contracts</span>
              <div className="text-2xl sm:text-3xl font-black text-[#E8E5DE] mt-1 tabular-nums">{stats.filledContracts}</div>
              <span className="text-[10px] text-[#AAB4BF] block mt-1">{stats.pendingFilledContracts} awaiting settlement</span>
            </div>

            <div className="bg-[#121820] border border-[#243040] rounded-lg p-3.5">
              <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Settled Outcomes</span>
              <div className="text-2xl sm:text-3xl font-black text-[#E8E5DE] mt-1 tabular-nums">{stats.settledContracts}</div>
              <span className="text-[10px] text-[#AAB4BF] block mt-1">{stats.scoredOutcomes} scored · {stats.scratches} scratches</span>
            </div>

            <div className="bg-[#121820] border border-[#243040] rounded-lg p-3.5">
              <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Expired Unfilled</span>
              <div className="text-2xl sm:text-3xl font-black text-[#E8E5DE] mt-1 tabular-nums">{stats.expiredUnfilledSetups}</div>
              <span className="text-[10px] text-[#AAB4BF] block mt-1">Not counted as trades</span>
            </div>

            <div className="bg-[#121820] border border-[#243040] rounded-lg p-3.5">
              <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Net Stake Return</span>
              <div className={`text-2xl sm:text-3xl font-black mt-1 tabular-nums ${stats.netReturnUnits >= 0 ? 'text-[#72A98B]' : 'text-[#B7797D]'}`}>
                {stats.netReturnUnits >= 0 ? `+${stats.netReturnUnits}` : stats.netReturnUnits} U
              </div>
              <span className="text-[10px] text-[#AAB4BF] block mt-1">{stats.missingReturnCount ? `${stats.missingReturnCount} missing return values` : 'Recorded binary payout units'}</span>
            </div>
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* COMPREHENSIVE FILTER TOOLBAR */}
        {/* ------------------------------------------------------------- */}
        <div className="bg-[#161F2B] border border-[#243040] rounded-xl p-4 space-y-3 font-mono text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[240px]">
              <Search className="w-3.5 h-3.5 text-[#AAB4BF] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search by pair, strategy name, or signal ID..."
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#121820] border border-[#243040] focus:border-[#72A98B] outline-none text-[#E8E5DE] placeholder:text-[#64748B] transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#AAB4BF] hover:text-[#E8E5DE]"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Quick Reset Filters Button */}
            {(searchQuery || strategyFilter !== 'ALL' || statusFilter !== 'ALL' || pairFilter !== 'ALL' || directionFilter !== 'ALL') && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setStrategyFilter('ALL');
                  setStatusFilter('ALL');
                  setPairFilter('ALL');
                  setDirectionFilter('ALL');
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#121820] hover:bg-[#243040] text-[#AAB4BF] hover:text-[#E8E5DE] transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Filters</span>
              </button>
            )}
          </div>

          {/* Sub-Filters: Strategy, Status, Pair, Direction */}
          <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-[#243040]">
            {/* Strategy Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-[#AAB4BF]">Strategy:</span>
              <select
                value={strategyFilter}
                onChange={e => setStrategyFilter(e.target.value)}
                className="bg-[#121820] border border-[#243040] rounded px-2.5 py-1 text-[#E8E5DE] outline-none cursor-pointer"
              >
                <option value="ALL">All Strategies</option>
                <option value="MOMENTUM">Momentum &amp; Trend</option>
                <option value="REVERSION">Liquidity &amp; Reversion</option>
                <option value="NEURAL">Neural Policy Confluence</option>
              </select>
            </div>

            {/* Status Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-[#AAB4BF]">Outcome:</span>
              <div className="flex items-center bg-[#121820] border border-[#243040] p-0.5 rounded">
                {(['ALL', 'WIN', 'LOSS', 'SCRATCH', 'EXPIRED'] as StatusFilter[]).map(st => (
                  <button
                    key={st}
                    onClick={() => setStatusFilter(st)}
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold cursor-pointer transition-colors ${
                      statusFilter === st
                        ? 'bg-[#243040] text-[#E8E5DE] font-bold'
                        : 'text-[#AAB4BF] hover:text-[#E8E5DE]'
                    }`}
                  >
                    {st === 'ALL' ? 'All' : st}
                  </button>
                ))}
              </div>
            </div>

            {/* Pair Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-[#AAB4BF]">Pair:</span>
              <select
                value={pairFilter}
                onChange={e => setPairFilter(e.target.value)}
                className="bg-[#121820] border border-[#243040] rounded px-2.5 py-1 text-[#E8E5DE] outline-none cursor-pointer"
              >
                <option value="ALL">All Pairs (20)</option>
                {FOREX_PAIRS.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            {/* Direction Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-[#AAB4BF]">Direction:</span>
              <select
                value={directionFilter}
                onChange={e => setDirectionFilter(e.target.value as DirectionFilter)}
                className="bg-[#121820] border border-[#243040] rounded px-2.5 py-1 text-[#E8E5DE] outline-none cursor-pointer"
              >
                <option value="ALL">Both Directions</option>
                <option value="BUY">BUY (CALL)</option>
                <option value="SELL">SELL (PUT)</option>
              </select>
            </div>
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* BLOOMBERG-GRADE DATA GRID */}
        {/* ------------------------------------------------------------- */}
        <div className="bg-[#161F2B] border border-[#243040] rounded-xl overflow-hidden shadow-xl">
          {filteredSignals.length === 0 ? (
            <div className="p-12 text-center space-y-3 font-mono">
              <FileSpreadsheet className="w-10 h-10 text-[#64748B] mx-auto" />
              <div className="text-base font-bold text-[#E8E5DE]">No Trades Match Selected Filter</div>
              <p className="text-xs text-[#AAB4BF] max-w-md mx-auto">
                No signal records match the active criteria. Try broadening your date layer or clearing the search query.
              </p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setStrategyFilter('ALL');
                  setStatusFilter('ALL');
                  setPairFilter('ALL');
                  setDirectionFilter('ALL');
                }}
                className="px-4 py-2 rounded-lg bg-[#243040] hover:bg-[#354251] text-[#E8E5DE] text-xs font-bold transition-colors cursor-pointer"
              >
                Reset All Filters
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse font-mono text-xs">
                <thead>
                  <tr className="border-b border-[#243040] bg-[#121820] text-[#AAB4BF] text-[10px] uppercase font-bold tracking-wider">
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Strategy</th>
                    <th className="py-3 px-4">Symbol / Direction</th>
                    <th className="py-3 px-4">Alert (IST)</th>
                    <th className="py-3 px-4">Entry (IST)</th>
                    <th className="py-3 px-4">Expiry (IST)</th>
                    <th className="py-3 px-4 text-right">Entry Price</th>
                    <th className="py-3 px-4 text-right">Exit Price</th>
                    <th className="py-3 px-4 text-right">Net Return</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#243040]">
                  {filteredSignals.map((trade, idx) => {
                    const bot = getBotForSignal(trade);
                    const isBuy = trade.direction === 'BUY';
                    const isWon = trade.outcomeResult === 'WIN';
                    const isLost = trade.outcomeResult === 'LOSS';
                    const isScratch = trade.outcomeResult === 'SCRATCH';
                    const isPending = trade.outcomeResult === 'PENDING' || !trade.outcomeResult;
                    const isExpiredUnfilled = isExpiredUnfilledSetup(trade);
                    const isTerminalUnfilled = isTerminalUnfilledSetup(trade);
                    const auditReason = [...(trade.lifecycleHistory || [])].reverse().find(event =>
                      ['EXPIRED', 'INVALIDATED', 'AMBIGUOUS'].includes(event.toState)
                    )?.reason || 'No entry fill was recorded; this setup is excluded from contract outcomes.';

                    return (
                      <tr
                        key={`hist_row_${trade.id}_${idx}`}
                        className="hover:bg-[#121820]/70 transition-colors"
                      >
                        {/* Status */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          {isWon && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold bg-[#72A98B]/15 text-[#72A98B] border border-[#72A98B]/30">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              WON
                            </span>
                          )}
                          {isLost && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold bg-[#B7797D]/15 text-[#B7797D] border border-[#B7797D]/30">
                              <XCircle className="w-3.5 h-3.5" />
                              LOST
                            </span>
                          )}
                          {isScratch && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold bg-[#C5A36A]/15 text-[#C5A36A] border border-[#C5A36A]/30">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              SCRATCH
                            </span>
                          )}
                          {isTerminalUnfilled ? (
                            <div className="max-w-[260px] space-y-1 rounded-md border border-[#C4A574]/50 bg-[#C4A574]/10 p-2 text-left">
                              <span className="block text-[10px] font-black text-[#C4A574]">AUDIT: UNSETTLED / NO ENTRY</span>
                              <span className="block text-[10px] font-bold text-[#E8E5DE]">{isExpiredUnfilled ? 'EXPIRED' : trade.lifecycleState}</span>
                              <span className="block whitespace-normal text-[10px] leading-relaxed text-[#AAB4BF]">{auditReason}</span>
                            </div>
                          ) : !isWon && !isLost && !isScratch && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] bg-[#C4A574]/15 text-[#C4A574] border border-[#C4A574]/30">
                              {trade.lifecycleState}
                            </span>
                          )}
                        </td>

                        {/* Strategy */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold border bg-[#72A98B]/10 text-[#72A98B] border-[#72A98B]/30">
                            {trade.strategyName || trade.ruleFamily || 'Momentum'}
                          </span>
                          <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border ${
                            trade.brokerEligibility
                              ? 'bg-[#72A98B]/15 text-[#72A98B] border-[#72A98B]/30'
                              : 'bg-[#C5A36A]/10 text-[#C5A36A] border-[#C5A36A]/25'
                          }`}>
                            {trade.brokerEligibility ? `OLYMP ${trade.brokerEligibility.payoutPct}%` : 'LEGACY'}
                          </span>
                        </td>

                        {/* Symbol & Direction */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="font-black text-sm text-[#E8E5DE]">{trade.symbol}</span>
                          <span
                            className={`text-xs font-bold ml-2 px-2 py-0.5 rounded ${
                              isBuy
                                ? 'bg-[#72A98B]/20 text-[#72A98B]'
                                : 'bg-[#B7797D]/20 text-[#B7797D]'
                            }`}
                          >
                            {trade.direction} ({isBuy ? 'CALL' : 'PUT'}) · {trade.expiryMinutes || 5}M
                          </span>
                        </td>

                        {/* Timings IST */}
                        <td className="py-3 px-4 whitespace-nowrap text-[#AAB4BF]">
                          {trade.predictionTimeIst || '—'}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-[#E8E5DE] font-bold">
                          {trade.candleOpenTimeIst || '—'}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-[#6C9D91] font-bold">
                          {trade.candleCloseTimeIst || '—'}
                        </td>

                        {/* Prices */}
                        <td className="py-3 px-4 whitespace-nowrap text-right font-bold tabular-nums text-[#E8E5DE]">
                          {trade.actualEntryPrice?.toFixed(5) || (
                            <span className="text-[#AAB4BF] text-[11px]">Trig: {trade.triggerPrice?.toFixed(5)}</span>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-right font-bold tabular-nums text-[#E8E5DE]">
                          {trade.actualExitPrice?.toFixed(5) || (
                            <span className="text-[#AAB4BF] text-[11px]">
                              {trade.lifecycleState === 'ACTIVE' ? 'In Market' : trade.lifecycleState === 'WAITING_FOR_ENTRY' ? 'Queued 5M' : 'Pending'}
                            </span>
                          )}
                        </td>

                        {/* Net Return Units */}
                        <td className="py-3 px-4 whitespace-nowrap text-right tabular-nums">
                          {trade.netReturnUnits !== undefined && trade.netReturnUnits !== null ? (
                            <span
                              className={`font-black text-sm ${
                                trade.netReturnUnits > 0
                                  ? 'text-[#72A98B]'
                                  : trade.netReturnUnits < 0
                                  ? 'text-[#B7797D]'
                                  : 'text-[#AAB4BF]'
                              }`}
                            >
                              {trade.netReturnUnits > 0 ? `+${trade.netReturnUnits.toFixed(2)}` : trade.netReturnUnits.toFixed(2)} U
                            </span>
                          ) : (
                            <span className="text-[#AAB4BF]">—</span>
                          )}
                        </td>

                        {/* Action: Audit */}
                        <td className="py-3 px-4 whitespace-nowrap text-right">
                          <button
                            onClick={() => setSelectedSignal(trade)}
                            className="px-2.5 py-1 rounded bg-[#121820] hover:bg-[#243040] border border-[#243040] text-xs font-semibold text-[#E8E5DE] transition-colors cursor-pointer"
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
          )}
        </div>
      </div>

      {/* Trade Audit Modal */}
      <TradeAuditModal
        signal={selectedSignal}
        onClose={() => setSelectedSignal(null)}
      />

      {/* Clear Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-[#161F2B] border border-[#B7797D]/50 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl text-xs font-sans">
            <div className="flex items-center gap-3 text-[#B7797D]">
              <div className="p-2 rounded-lg bg-[#121820] border border-[#B7797D]/40">
                <Trash2 className="w-5 h-5 text-[#B7797D]" />
              </div>
              <h3 className="text-base font-bold text-[#E8E5DE]">Clear Closed Signals?</h3>
            </div>
            <p className="text-[#AAB4BF] leading-relaxed text-xs">
              This purges settled trades from the active view while keeping active and pending signals intact.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2 font-mono">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-4 py-2 rounded-lg bg-[#121820] hover:bg-[#243040] border border-[#243040] text-[#AAB4BF] hover:text-[#E8E5DE] font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleClearHistory}
                disabled={isClearing}
                className="px-4 py-2 rounded-lg bg-[#B7797D] hover:bg-[#B7797D]/80 text-[#121820] font-bold cursor-pointer"
              >
                {isClearing ? 'Clearing...' : 'Confirm Purge'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
