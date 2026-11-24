import React from 'react';
import { Dna, ShieldCheck, CheckCircle2, XCircle, Sparkles } from 'lucide-react';
import { EvolutionGeneration, FOREX_PAIRS, ForexSymbol } from '../../types/index.js';

interface StrategySearchCandidate {
  id: string;
  name: string;
  formula: string;
  status: string;
  testWinRate: number;
  testScoredTrades: number;
  validationWinRate: number;
  validationExpectedValueUnits: number;
  testExpectedValueUnits: number;
  testedOnHoldout: boolean;
  expectedValueUnits: number;
  minimumPayoutPct: number;
  testBlockWinRates: number[];
  reason?: string;
}

interface StrategySearchBatch {
  jobId: string;
  symbol: ForexSymbol;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  total: number;
  completed: number;
  passedHistorical: number;
  insufficientSample: number;
  rejected: number;
  replicationFinalists: number;
  approvedCount: number;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  topCandidates?: StrategySearchCandidate[];
}

interface EvolutionLabViewProps {
  generations: EvolutionGeneration[];
  onTriggerGeneration: () => void;
  isRunning: boolean;
}

export const EvolutionLabView: React.FC<EvolutionLabViewProps> = ({
  generations,
  onTriggerGeneration,
  isRunning,
}) => {
  const [searchPair, setSearchPair] = React.useState<ForexSymbol>('EUR/USD');
  const [historyCounts, setHistoryCounts] = React.useState<Record<string, number>>({});
  const [searchBatch, setSearchBatch] = React.useState<StrategySearchBatch | null>(null);
  const [isSearchingBatch, setIsSearchingBatch] = React.useState(false);
  const [searchError, setSearchError] = React.useState('');
  const [historyImportBusy, setHistoryImportBusy] = React.useState(false);
  const [historyImportStatus, setHistoryImportStatus] = React.useState('');

  const formatIST = (timestampStr?: string) => {
    if (!timestampStr) return '--:--:-- IST';
    try {
      const d = new Date(timestampStr);
      if (isNaN(d.getTime())) return timestampStr;
      return (
        d.toLocaleTimeString('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }) + ' IST'
      );
    } catch {
      return timestampStr;
    }
  };

  React.useEffect(() => {
    fetch('/api/research/candles/status')
      .then(response => response.json())
      .then(payload => {
        const counts: Record<string, number> = {};
        (payload.pairs || []).forEach((pair: { symbol: string; count: number }) => {
          counts[pair.symbol] = pair.count;
        });
        setHistoryCounts(counts);
        const readyPair = FOREX_PAIRS.find(pair => (counts[pair] || 0) >= 30_000);
        if (readyPair) setSearchPair(readyPair);
      })
      .catch(() => setSearchError('Could not read historical-data status.'));
  }, []);

  const importHistoricalCsv = async (file?: File) => {
    if (!file) return;
    setHistoryImportBusy(true);
    setHistoryImportStatus('');
    setSearchError('');
    try {
      const pairCode = searchPair.replace('/', '');
      const filePair = file.name.toUpperCase().match(/^([A-Z]{6})_DATA\.CSV$/)?.[1];
      if (filePair && filePair !== pairCode) {
        throw new Error(`This file contains ${filePair}, but the selected pair is ${pairCode}. Select the matching pair first.`);
      }

      const lines = (await file.text()).replace(/^\uFEFF/, '').trim().split(/\r?\n/);
      if (lines.length < 30_001) {
        throw new Error(`The file has only ${Math.max(0, lines.length - 1).toLocaleString()} data rows; at least 30,000 M1 rows are required.`);
      }
      const headers = lines[0].split(',').map(value => value.trim().toLowerCase().replaceAll('"', ''));
      const index = (name: string) => headers.indexOf(name);
      const fromIndex = index('from');
      const timeIndex = fromIndex >= 0 ? fromIndex : ['timestampms', 'timestamp', 'datetime', 'time', 'date'].map(index).find(value => value >= 0) ?? -1;
      const openIndex = index('open'), highIndex = index('high'), lowIndex = index('low'), closeIndex = index('close');
      const volumeIndex = index('volume');
      if ([timeIndex, openIndex, highIndex, lowIndex, closeIndex].some(value => value < 0)) {
        throw new Error('CSV must contain timestamp/from, open, high, low and close columns.');
      }

      const candles: Array<{ timestampMs: number; open: number; high: number; low: number; close: number; volume: number; source: string }> = [];
      let previousTimestamp = -Infinity;
      for (let i = 1; i < lines.length; i += 1) {
        const line = lines[i].trim();
        if (!line) continue;
        const columns = line.split(',');
        const rawTime = columns[timeIndex]?.trim().replaceAll('"', '');
        let timestampMs = Number(rawTime);
        if (!Number.isFinite(timestampMs)) {
          timestampMs = new Date(rawTime).getTime();
        }
        if (!Number.isFinite(timestampMs)) continue;
        if (timestampMs <= previousTimestamp) continue;
        previousTimestamp = timestampMs;

        const open = Number(columns[openIndex]);
        const high = Number(columns[highIndex]);
        const low = Number(columns[lowIndex]);
        const close = Number(columns[closeIndex]);
        const volume = volumeIndex >= 0 ? Number(columns[volumeIndex]) || 0 : 0;
        if ([open, high, low, close].some(v => !Number.isFinite(v))) continue;
        candles.push({
          timestampMs,
          open,
          high,
          low,
          close,
          volume,
          source: 'historical_csv',
        });
      }

      if (candles.length < 30_000) {
        throw new Error(`Parsed ${candles.length.toLocaleString()} valid chronological candles; 30,000 required.`);
      }

      setHistoryImportStatus(`Uploading ${candles.length.toLocaleString()} candles…`);
      const response = await fetch('/api/research/candles/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: searchPair, candles }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Import failed.');
      setHistoryCounts(prev => ({ ...prev, [searchPair]: result.count || candles.length }));
      setHistoryImportStatus(`Imported ${candles.length.toLocaleString()} candles for ${searchPair} into historical store.`);
    } catch (error: any) {
      setSearchError(error.message || 'CSV import failed.');
    } finally {
      setHistoryImportBusy(false);
    }
  };

  const runThreeHundredSearch = async () => {
    setIsSearchingBatch(true);
    setSearchError('');
    try {
      const response = await fetch('/api/research/strategy-search/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: searchPair }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to start strategy search.');

      const jobId = data.jobId;
      const poll = async () => {
        try {
          const statusRes = await fetch(`/api/research/strategy-search/status?jobId=${jobId}`);
          const statusData = await statusRes.json();
          setSearchBatch(statusData.batch);
          if (statusData.batch.status === 'RUNNING') {
            setTimeout(poll, 1500);
          } else {
            setIsSearchingBatch(false);
          }
        } catch {
          setIsSearchingBatch(false);
        }
      };
      setTimeout(poll, 1000);
    } catch (error: any) {
      setSearchError(error.message || 'Strategy search failed.');
      setIsSearchingBatch(false);
    }
  };

  const selectedHistoryCount = historyCounts[searchPair] || 0;
  const searchProgress = searchBatch ? Math.round((searchBatch.completed / 300) * 100) : 0;

  const steps = [
    '1. Collect Multi-Feed Forex Data',
    '2. Discover Market Anomalies',
    '3. Formulate Falsifiable Hypotheses',
    '4. Configure Isolated Splits',
    '5. Execute Purged Walk-Forward',
    '6. Evaluate Validation Performance',
    '7. Untouched Test Replication',
    '8. Skeptical Auditor Interrogation',
    '9. Candidate Fitness Ranking',
    '10. Archive Failure Lineage',
    '11. Sample New Candidate Parameters',
  ];

  return (
    <div className="w-full bg-[#17212D] text-[#E8E5DE] p-4 lg:p-6 space-y-6 font-sans pb-16 lg:pb-8">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#354251]">
        <div>
          <h3 className="text-base font-bold text-[#E8E5DE] font-mono flex items-center gap-2">
            <Dna className="w-4 h-4 text-[#72A98B]" />
            <span>Research Candidate Laboratory</span>
          </h3>
          <p className="text-xs text-[#AAB4BF] font-mono mt-1">
            Three hundred expressions are ranked on train/validation data; only the preselected finalists see the untouched holdout. Passing history only allows paper testing.
          </p>
        </div>

        <button
          onClick={onTriggerGeneration}
          disabled={isRunning}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#17212D] bg-[#72A98B] hover:bg-[#72A98B]/90 rounded transition-colors disabled:opacity-50 cursor-pointer"
        >
          <Sparkles className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : ''}`} />
          <span>{isRunning ? 'Running Research Cycle...' : 'Run Autonomous Research Cycle'}</span>
        </button>
      </div>

      {/* Large-scale symbolic discovery and evidence gate */}
      <section className="rounded-lg border border-[#354251] bg-[#222B36] p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h4 className="text-sm font-bold text-[#E8E5DE] flex items-center gap-2">
              <Dna className="w-4 h-4 text-[#6C9D91]" />
              Symbolic Strategy Discovery · 300 Candidate Search
            </h4>
            <p className="mt-1 text-xs leading-relaxed text-[#AAB4BF]">
              Generates 300 executable mathematical expressions using genetic crossover and mutation, then replays each one on imported real-market M1 history. Candidates are strictly verified before consideration.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={searchPair}
              onChange={event => setSearchPair(event.target.value as ForexSymbol)}
              disabled={isSearchingBatch}
              className="bg-[#17212D] border border-[#354251] rounded px-3 py-2 text-xs text-[#E8E5DE] focus:outline-none focus:border-[#6C9D91]"
            >
              {FOREX_PAIRS.map(pair => (
                <option key={pair} value={pair}>
                  {pair} · {(historyCounts[pair] || 0).toLocaleString()} M1
                </option>
              ))}
            </select>
            <button
              onClick={runThreeHundredSearch}
              disabled={isSearchingBatch || selectedHistoryCount < 30_000}
              className="flex items-center gap-2 rounded bg-[#6C9D91] px-4 py-2 text-xs font-bold text-[#17212D] hover:bg-[#6C9D91]/90 disabled:opacity-40 cursor-pointer"
            >
              <Sparkles className={`w-3.5 h-3.5 ${isSearchingBatch ? 'animate-spin' : ''}`} />
              {isSearchingBatch ? 'Testing 300 strategies…' : 'Generate & Test 300 Strategies'}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded border border-[#354251] bg-[#17212D] p-3">
          <label className="text-xs text-[#AAB4BF]" htmlFor="m1-history-upload">Import M1 CSV for {searchPair}</label>
          <input
            id="m1-history-upload"
            type="file"
            accept=".csv,text/csv"
            disabled={historyImportBusy || isSearchingBatch}
            onChange={event => {
              const file = event.target.files?.[0];
              void importHistoricalCsv(file);
              event.currentTarget.value = '';
            }}
            className="max-w-full text-[11px] text-[#AAB4BF] file:mr-3 file:rounded file:border-0 file:bg-[#222B36] file:border-[#354251] file:px-3 file:py-1.5 file:text-xs file:text-[#E8E5DE] cursor-pointer"
          />
          {historyImportBusy && <span className="text-xs text-[#6C9D91]">Importing…</span>}
        </div>

        {historyImportStatus && <p className="text-[11px] text-[#72A98B]">{historyImportStatus}</p>}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#AAB4BF]">
          <span>Imported history: <strong className="text-[#E8E5DE]">{selectedHistoryCount.toLocaleString()} / 30,000 M1 candles</strong></span>
          <span>Historic gate: <strong className="text-[#E8E5DE]">300 scored test trades · 70% validation and test WR</strong></span>
          <span>Final gate: <strong className="text-[#E8E5DE]">300 forward paper outcomes · 70% rolling WR</strong></span>
        </div>

        {searchError && (
          <div className="rounded border border-[#B7797D]/50 bg-[#B7797D]/15 p-3 text-xs text-[#B7797D]">{searchError}</div>
        )}

        {searchBatch && (
          <div className="space-y-3">
            <div className="flex flex-wrap justify-between gap-2 text-xs">
              <span className="text-[#E8E5DE] font-semibold">
                {searchBatch.status === 'RUNNING' ? 'Historical candidate tests running' : searchBatch.status === 'COMPLETED' ? 'Search completed' : 'Search failed'}
              </span>
              <span className="font-mono text-[#6C9D91]">{searchBatch.completed} / 300 · {searchProgress}%</span>
            </div>
            <div className="h-2 rounded bg-[#17212D] overflow-hidden border border-[#354251]">
              <div className="h-full bg-[#6C9D91] transition-all" style={{ width: `${searchProgress}%` }} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <div className="rounded bg-[#17212D] border border-[#354251] p-3">
                <div className="text-[10px] text-[#AAB4BF] font-semibold">Historical passes</div>
                <div className="text-xl font-bold text-[#72A98B]">{searchBatch.passedHistorical}</div>
              </div>
              <div className="rounded bg-[#17212D] border border-[#354251] p-3">
                <div className="text-[10px] text-[#AAB4BF] font-semibold">Insufficient sample</div>
                <div className="text-xl font-bold text-[#C5A36A]">{searchBatch.insufficientSample}</div>
              </div>
              <div className="rounded bg-[#17212D] border border-[#354251] p-3">
                <div className="text-[10px] text-[#AAB4BF] font-semibold">Failed 70% / EV gates</div>
                <div className="text-xl font-bold text-[#B7797D]">{searchBatch.rejected}</div>
              </div>
              <div className="rounded bg-[#17212D] border border-[#354251] p-3">
                <div className="text-[10px] text-[#AAB4BF] font-semibold">Blind holdout finalists</div>
                <div className="text-xl font-bold text-[#6C9D91]">{searchBatch.replicationFinalists}</div>
                <div className="text-[9px] text-[#AAB4BF]">Selected using validation only</div>
              </div>
              <div className="rounded bg-[#17212D] border border-[#354251] p-3">
                <div className="text-[10px] text-[#AAB4BF] font-semibold">Actionable strategies approved</div>
                <div className="text-xl font-bold text-[#E8E5DE]">{searchBatch.approvedCount}</div>
                <div className="text-[9px] text-[#AAB4BF]">approved after historical + forward 300 gates</div>
              </div>
            </div>

            {searchBatch.topCandidates && searchBatch.topCandidates.length > 0 && (
              <div className="overflow-x-auto rounded border border-[#354251]">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-[#17212D] text-[#AAB4BF] uppercase">
                    <tr>
                      <th className="p-2">Candidate / expression</th>
                      <th className="p-2">Validation WR</th>
                      <th className="p-2">Validation EV (units/trade)</th>
                      <th className="p-2">Blind test WR</th>
                      <th className="p-2">Test n</th>
                      <th className="p-2">Test blocks</th>
                      <th className="p-2">Holdout EV (units/trade)</th>
                      <th className="p-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {searchBatch.topCandidates.map(candidate => (
                      <tr key={candidate.id} className="border-t border-[#354251] align-top bg-[#222B36]/60">
                        <td className="p-2 min-w-[260px]">
                          <div className="font-semibold text-[#E8E5DE]">{candidate.name}</div>
                          <div className="mt-1 font-mono text-[10px] text-[#AAB4BF] break-all">{candidate.formula}</div>
                          {candidate.reason && <div className="mt-1 text-[10px] text-[#C5A36A]">{candidate.reason}</div>}
                        </td>
                        <td className="p-2 font-mono text-[#E8E5DE]">{candidate.validationWinRate > 0 ? `${(candidate.validationWinRate * 100).toFixed(1)}%` : '—'}</td>
                        <td className="p-2 font-mono text-[#AAB4BF]">{candidate.validationExpectedValueUnits.toFixed(4)}</td>
                        <td className="p-2 font-mono text-[#E8E5DE]">{candidate.testedOnHoldout ? `${(candidate.testWinRate * 100).toFixed(1)}%` : 'Not tested'}</td>
                        <td className="p-2 font-mono text-[#AAB4BF]">{candidate.testedOnHoldout ? candidate.testScoredTrades : '—'}</td>
                        <td className="p-2 font-mono text-[#AAB4BF]">{candidate.testBlockWinRates.length === 3 ? candidate.testBlockWinRates.map(rate => `${(rate * 100).toFixed(0)}%`).join(' / ') : '—'}</td>
                        <td className="p-2 font-mono text-[#AAB4BF]">{candidate.testedOnHoldout ? candidate.testExpectedValueUnits.toFixed(4) : '—'}</td>
                        <td className="p-2">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            candidate.status === 'PAPER_TRADING'
                              ? 'bg-[#72A98B]/15 text-[#72A98B] border border-[#72A98B]/40'
                              : 'bg-[#17212D] text-[#AAB4BF] border border-[#354251]'
                          }`}>
                            {candidate.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[10px] text-[#AAB4BF]">
              All 300 candidates are ranked on train/validation only. Up to 10 preselected finalists are replayed on the untouched holdout. Binary results assume an 80% payout unless broker payout is recorded. A historical pass still needs 300 forward paper outcomes.
            </p>
          </div>
        )}
      </section>

      {/* 11-Stage Evolution Lifecycle Pipeline */}
      <div className="bg-[#222B36] border border-[#354251] rounded-lg p-4 font-mono text-xs space-y-3">
        <h4 className="text-sm font-semibold text-[#E8E5DE]">Closed-Loop Scientific Method Flow</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 text-[11px]">
          {steps.map((st, i) => (
            <div
              key={i}
              className="bg-[#17212D] border border-[#354251] p-2.5 rounded text-[#AAB4BF] flex flex-col justify-between"
            >
              <span className="text-[#AAB4BF]/60 text-[10px] block font-semibold">Step {i + 1}</span>
              <span className="font-medium text-[#E8E5DE] mt-1">{st.substring(3)}</span>
            </div>
          ))}
          <div className="bg-[#72A98B]/15 border border-[#72A98B]/40 p-2.5 rounded text-[#72A98B] flex flex-col justify-between">
            <span className="text-[#72A98B]/80 text-[10px] block font-semibold">Step 12</span>
            <span className="font-semibold mt-1">Repeat Automatically</span>
          </div>
        </div>
      </div>

      {/* Generations Tree / History */}
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-[#E8E5DE] font-mono">Research Cycle Records</h4>

        {generations.length === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center text-center text-[#AAB4BF] font-mono text-xs bg-[#222B36] border border-[#354251] rounded-lg">
            <Dna className="w-8 h-8 text-[#354251] mb-2" />
            <p className="text-[#E8E5DE] font-medium text-sm">No Research Cycles Recorded Yet</p>
            <p className="mt-1 text-[#AAB4BF]">Run a research cycle when imported historical data is available.</p>
          </div>
        ) : (
          generations.map(gen => (
            <div
              key={gen.generation}
              className="bg-[#222B36] border border-[#354251] rounded-lg p-5 font-mono text-xs space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between pb-3 border-b border-[#354251] gap-2">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-[#E8E5DE]">Generation #{gen.generation}</span>
                  <span className="text-[#354251]">·</span>
                  <span className="text-[#AAB4BF]">{formatIST(gen.timestamp)}</span>
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5 text-[#72A98B]">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{gen.acceptedCount} Accepted</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[#B7797D]">
                    <XCircle className="w-3.5 h-3.5" />
                    <span>{gen.rejectedCount} Rejected</span>
                  </div>
                  <div className="flex items-center gap-1 text-[#E8E5DE] font-semibold">
                    <span>Best F1:</span>
                    <span className="tabular-nums text-[#72A98B]">{gen.bestF1Score.toFixed(3)}</span>
                  </div>
                </div>
              </div>

              <p className="text-[#E8E5DE] leading-relaxed">{gen.summary}</p>

              {/* Lessons Learned */}
              <div className="bg-[#17212D] p-3 rounded border border-[#354251] space-y-1 text-[#AAB4BF] text-[11px]">
                <div className="text-[#AAB4BF]/60 uppercase text-[10px] font-semibold mb-1">
                  Recorded Research Notes
                </div>
                {gen.lessonsLearned.map((lesson, i) => (
                  <div key={i} className="flex gap-2 text-[#E8E5DE]">
                    <span className="text-[#72A98B]">✓</span>
                    <span>{lesson}</span>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
