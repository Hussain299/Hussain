import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  BarChart3,
  Clock3,
  Crosshair,
  Filter,
  Layers3,
  Target,
  TrendingUp,
} from 'lucide-react';
import { FOREX_PAIRS } from '../../types/index.js';
import {
  ACCURACY_SESSIONS,
  AccuracyPeriod,
  AccuracySessionFilter,
  buildAccuracyReport,
} from '../../utils/accuracyAnalytics.js';
import { ResearchSignal } from '../../types/index.js';

interface AccuracyViewProps {
  signals: ResearchSignal[];
}

type PairSort = 'winRate' | 'scoredTrades' | 'netReturnUnits';

const PERIODS: Array<{ id: AccuracyPeriod; label: string }> = [
  { id: '24H', label: '24 Hours' },
  { id: '7D', label: '7 Days' },
  { id: '30D', label: '30 Days' },
  { id: 'ALL', label: 'All Available' },
];

function formatUnits(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)} U`;
}

function accuracyColor(value: number | null): string {
  if (value === null) return 'text-[#7F8B99]';
  if (value >= 60) return 'text-[#72A98B]';
  if (value >= 50) return 'text-[#C4A574]';
  return 'text-[#C98286]';
}

function accuracyBarColor(value: number | null): string {
  if (value === null) return 'bg-[#354251]';
  if (value >= 60) return 'bg-[#72A98B]';
  if (value >= 50) return 'bg-[#C4A574]';
  return 'bg-[#C98286]';
}

export const AccuracyView: React.FC<AccuracyViewProps> = ({ signals }) => {
  const [period, setPeriod] = useState<AccuracyPeriod>('7D');
  const [activeView, setActiveView] = useState<'SESSIONS' | 'PAIRS'>('SESSIONS');
  const [pairSession, setPairSession] = useState<AccuracySessionFilter>('ALL');
  const [pairSort, setPairSort] = useState<PairSort>('winRate');

  const report = useMemo(
    () => buildAccuracyReport(signals, { period, pairSession }),
    [signals, period, pairSession]
  );

  const sortedPairs = useMemo(() => {
    return [...report.pairs].sort((a, b) => {
      if (pairSort === 'scoredTrades') return b.scoredTrades - a.scoredTrades;
      if (pairSort === 'netReturnUnits') return b.netReturnUnits - a.netReturnUnits;
      return (b.winRatePct ?? -1) - (a.winRatePct ?? -1) ||
        b.scoredTrades - a.scoredTrades;
    });
  }, [report.pairs, pairSort]);

  const summary = report.summary;
  const hasSettlements = summary.settlements > 0;

  return (
    <div className="w-full min-h-screen bg-[#121820] text-[#E8E5DE] font-sans pb-24">
      <div className="border-b border-[#243040] bg-[#161F2B] px-4 lg:px-8 py-5">
        <div className="max-w-7xl mx-auto space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-[#72A98B] mb-1">
                <Target className="w-4 h-4" />
                <span className="text-[10px] tracking-[0.18em] font-bold uppercase font-mono">Performance Intelligence</span>
              </div>
              <h1 className="text-xl sm:text-2xl font-black tracking-tight">Session &amp; Pair Accuracy</h1>
              <p className="text-xs text-[#AAB4BF] mt-1 max-w-2xl">
                See where the scanner performs best across the four market sessions and all 29 configured currency pairs.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-[#121820] border border-[#243040]">
              {PERIODS.map(item => (
                <button
                  key={item.id}
                  onClick={() => setPeriod(item.id)}
                  className={`px-3 py-2 rounded-lg text-[11px] font-bold transition-colors cursor-pointer whitespace-nowrap ${
                    period === item.id
                      ? 'bg-[#72A98B] text-[#121820]'
                      : 'text-[#AAB4BF] hover:text-[#E8E5DE]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#121820] border border-[#243040]">
              <button
                onClick={() => setActiveView('SESSIONS')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                  activeView === 'SESSIONS' ? 'bg-[#243040] text-[#E8E5DE]' : 'text-[#AAB4BF] hover:text-[#E8E5DE]'
                }`}
              >
                <Clock3 className="w-3.5 h-3.5" />
                Session-wise
              </button>
              <button
                onClick={() => setActiveView('PAIRS')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                  activeView === 'PAIRS' ? 'bg-[#243040] text-[#E8E5DE]' : 'text-[#AAB4BF] hover:text-[#E8E5DE]'
                }`}
              >
                <Layers3 className="w-3.5 h-3.5" />
                Pair-wise
              </button>
            </div>

            <div className="text-[10px] text-[#7F8B99] font-mono flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5" />
              AUTO-UPDATES WITH THE TRADE LEDGER
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <div className="bg-[#161F2B] border border-[#243040] rounded-xl p-4">
            <div className="flex items-center justify-between text-[10px] text-[#AAB4BF] uppercase font-bold tracking-wider">
              Verified Settlements
              <BarChart3 className="w-4 h-4 text-[#72A98B]" />
            </div>
            <div className="text-3xl font-black tabular-nums mt-2">{summary.settlements}</div>
            <div className="text-[10px] text-[#7F8B99] mt-1">{summary.scoredTrades} scored · {summary.scratches} scratches</div>
          </div>

          <div className="bg-[#161F2B] border border-[#243040] rounded-xl p-4">
            <div className="flex items-center justify-between text-[10px] text-[#AAB4BF] uppercase font-bold tracking-wider">
              Observed Win Rate
              <Target className="w-4 h-4 text-[#72A98B]" />
            </div>
            <div className={`text-3xl font-black tabular-nums mt-2 ${accuracyColor(summary.winRatePct)}`}>
              {summary.winRatePct === null ? '—' : `${summary.winRatePct.toFixed(1)}%`}
            </div>
            <div className="text-[10px] text-[#7F8B99] mt-1">{summary.wins} wins / {summary.losses} losses</div>
          </div>

          <div className="bg-[#161F2B] border border-[#243040] rounded-xl p-4">
            <div className="flex items-center justify-between text-[10px] text-[#AAB4BF] uppercase font-bold tracking-wider">
              Net Paper Return
              <TrendingUp className="w-4 h-4 text-[#C4A574]" />
            </div>
            <div className={`text-3xl font-black tabular-nums mt-2 ${summary.netReturnUnits >= 0 ? 'text-[#72A98B]' : 'text-[#C98286]'}`}>
              {formatUnits(summary.netReturnUnits)}
            </div>
            <div className="text-[10px] text-[#7F8B99] mt-1">Recorded payout units, not pip estimates</div>
          </div>

          <div className="bg-[#161F2B] border border-[#243040] rounded-xl p-4">
            <div className="flex items-center justify-between text-[10px] text-[#AAB4BF] uppercase font-bold tracking-wider">
              Pairs With Results
              <Layers3 className="w-4 h-4 text-[#72A98B]" />
            </div>
            <div className="text-3xl font-black tabular-nums mt-2">{report.pairsWithScoredSettlements}<span className="text-base text-[#7F8B99]"> / {FOREX_PAIRS.length}</span></div>
            <div className="text-[10px] text-[#7F8B99] mt-1">Pairs with at least one WIN or LOSS</div>
          </div>
        </div>

        {activeView === 'SESSIONS' ? (
          <section className="bg-[#161F2B] border border-[#243040] rounded-2xl p-4 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#243040] pb-4">
              <div>
                <h2 className="text-base font-black">Accuracy by Market Session</h2>
                <p className="text-[11px] text-[#AAB4BF] mt-1">Session is assigned from the signal's prediction time.</p>
              </div>
              <span className="text-[10px] font-mono text-[#7F8B99]">4 PRIMARY SESSIONS</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {report.sessions.filter(session => session.key !== 'UNCLASSIFIED').map((session, index) => {
                const definition = ACCURACY_SESSIONS.find(item => item.id === session.key)!;
                const rate = session.winRatePct;
                return (
                  <div key={session.key} className="bg-[#121820] border border-[#2A3644] rounded-xl p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-[#7F8B99] font-mono">0{index + 1}</span>
                          <h3 className="text-sm font-black">{session.label}</h3>
                        </div>
                        <div className="text-[10px] text-[#AAB4BF] mt-1">{definition.istRange}</div>
                        <div className="text-[10px] text-[#7F8B99] mt-0.5 font-mono">{definition.utcRange}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`text-2xl font-black tabular-nums ${accuracyColor(rate)}`}>
                          {rate === null ? '—' : `${rate.toFixed(1)}%`}
                        </div>
                        <div className="text-[9px] text-[#7F8B99] uppercase tracking-wider">Win rate</div>
                      </div>
                    </div>

                    <div className="h-2 rounded-full bg-[#243040] overflow-hidden">
                      <div
                        className={`h-full rounded-full ${accuracyBarColor(rate)}`}
                        style={{ width: `${rate === null ? 0 : rate}%` }}
                      />
                    </div>

                    <div className="grid grid-cols-4 gap-2 border-t border-[#243040] pt-3">
                      <div>
                        <div className="text-[9px] text-[#7F8B99] uppercase">Scored</div>
                        <div className="text-sm font-bold tabular-nums">{session.scoredTrades}</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-[#7F8B99] uppercase">Wins</div>
                        <div className="text-sm font-bold text-[#72A98B] tabular-nums">{session.wins}</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-[#7F8B99] uppercase">Losses</div>
                        <div className="text-sm font-bold text-[#C98286] tabular-nums">{session.losses}</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-[#7F8B99] uppercase">Net</div>
                        <div className={`text-sm font-bold tabular-nums ${session.netReturnUnits >= 0 ? 'text-[#72A98B]' : 'text-[#C98286]'}`}>
                          {formatUnits(session.netReturnUnits)}
                        </div>
                      </div>
                    </div>
                    <div className="text-[10px] text-[#7F8B99]">{session.scratches} scratch / tie outcomes excluded from win-rate calculation</div>
                  </div>
                );
              })}
            </div>

            {report.sessions.some(session => session.key === 'UNCLASSIFIED') && (
              <div className="text-[11px] text-[#AAB4BF] bg-[#121820] border border-[#243040] rounded-lg p-3">
                {report.sessions.find(session => session.key === 'UNCLASSIFIED')?.settlements} verified settlements have no recoverable session assignment. They remain in overall and pair totals.
              </div>
            )}
          </section>
        ) : (
          <section className="bg-[#161F2B] border border-[#243040] rounded-2xl p-4 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#243040] pb-4">
              <div>
                <h2 className="text-base font-black">Accuracy by Currency Pair</h2>
                <p className="text-[11px] text-[#AAB4BF] mt-1">All 29 configured pairs remain visible, including pairs with no settled results.</p>
              </div>
              <label className="flex items-center gap-2 text-[10px] text-[#AAB4BF] font-bold uppercase">
                <Filter className="w-3.5 h-3.5" />
                <select
                  value={pairSession}
                  onChange={event => setPairSession(event.target.value as AccuracySessionFilter)}
                  className="bg-[#121820] border border-[#354251] rounded-lg px-3 py-2 text-xs text-[#E8E5DE] normal-case outline-none"
                >
                  <option value="ALL">All sessions</option>
                  {ACCURACY_SESSIONS.map(session => (
                    <option key={session.id} value={session.id}>{session.label}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[10px] text-[#7F8B99]">{report.pairsWithScoredSettlements} of {FOREX_PAIRS.length} pairs have scored outcomes in this selection.</div>
              <div className="flex flex-wrap gap-1 p-1 bg-[#121820] border border-[#243040] rounded-lg">
                {([
                  ['winRate', 'Win rate'],
                  ['scoredTrades', 'Sample size'],
                  ['netReturnUnits', 'Net units'],
                ] as Array<[PairSort, string]>).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setPairSort(key)}
                    className={`px-2.5 py-1.5 rounded-md text-[10px] font-bold cursor-pointer ${
                      pairSort === key ? 'bg-[#243040] text-[#E8E5DE]' : 'text-[#7F8B99] hover:text-[#E8E5DE]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <span className="flex items-center px-1 text-[#7F8B99]">
                  {pairSort === 'netReturnUnits' ? <ArrowDownWideNarrow className="w-3 h-3" /> : <ArrowUpWideNarrow className="w-3 h-3" />}
                </span>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-[#243040]">
              <table className="w-full min-w-[760px] text-xs">
                <thead className="bg-[#121820] text-[#AAB4BF] uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="text-left px-4 py-3 font-bold">Currency pair</th>
                    <th className="text-right px-4 py-3 font-bold">Win rate</th>
                    <th className="text-left px-4 py-3 font-bold w-[22%]">Accuracy bar</th>
                    <th className="text-right px-4 py-3 font-bold">Scored</th>
                    <th className="text-right px-4 py-3 font-bold">W / L / S</th>
                    <th className="text-right px-4 py-3 font-bold">Net return</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPairs.map(pair => (
                    <tr key={pair.key} className="border-t border-[#243040] hover:bg-[#1B2632]">
                      <td className="px-4 py-3">
                        <span className="font-black text-[#E8E5DE]">{pair.label}</span>
                        {pair.scoredTrades > 0 && pair.scoredTrades < 30 && (
                          <span className="ml-2 text-[9px] text-[#C4A574] uppercase">Limited sample</span>
                        )}
                      </td>
                      <td className={`px-4 py-3 text-right font-black tabular-nums ${accuracyColor(pair.winRatePct)}`}>
                        {pair.winRatePct === null ? '—' : `${pair.winRatePct.toFixed(1)}%`}
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-2 rounded-full bg-[#243040] overflow-hidden">
                          <div
                            className={`h-full rounded-full ${accuracyBarColor(pair.winRatePct)}`}
                            style={{ width: `${pair.winRatePct === null ? 0 : pair.winRatePct}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{pair.scoredTrades}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className="text-[#72A98B]">{pair.wins}</span>
                        <span className="text-[#7F8B99]"> / </span>
                        <span className="text-[#C98286]">{pair.losses}</span>
                        <span className="text-[#7F8B99]"> / {pair.scratches}</span>
                      </td>
                      <td className={`px-4 py-3 text-right font-bold tabular-nums ${pair.netReturnUnits >= 0 ? 'text-[#72A98B]' : 'text-[#C98286]'}`}>
                        {formatUnits(pair.netReturnUnits)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <div className="flex items-start gap-2 bg-[#161F2B] border border-[#243040] rounded-xl p-4 text-[11px] text-[#AAB4BF] leading-relaxed">
          <Crosshair className="w-4 h-4 text-[#C4A574] shrink-0 mt-0.5" />
          <p>
            <strong className="text-[#E8E5DE]">Calculation:</strong> Win rate = WIN ÷ (WIN + LOSS). Scratch/tie outcomes are shown separately and excluded from the percentage. Only closed, filled contracts with recorded entry and exit prices, timestamps, payout and net return are included. Pending, cancelled, expired-unfilled and test records are excluded. Session attribution uses the session saved at prediction time; older records without it are assigned from their UTC prediction timestamp.
          </p>
        </div>

        {!hasSettlements && (
          <div className="bg-[#161F2B] border border-[#354251] rounded-xl p-8 text-center">
            <BarChart3 className="w-8 h-8 mx-auto text-[#7F8B99] mb-3" />
            <h3 className="text-sm font-bold text-[#E8E5DE]">No verified settlements in this period</h3>
            <p className="text-xs text-[#AAB4BF] mt-1">This view will populate automatically when filled contracts receive verified WIN, LOSS or SCRATCH outcomes.</p>
          </div>
        )}
      </div>
    </div>
  );
};
