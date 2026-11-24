/**
 * SignalForge ML — Express Backend API Router
 * Implements REST endpoints for forex feeds, causal signal management,
 * purged ML experiments, research trinity reviews, and Cloudflare D1 export.
 */

import { Router, Request, Response } from 'express';
import { FOREX_PAIRS, ForexSymbol, RuleFamily } from '../types/index.js';
import { dataFeedEngine } from './dataFeeds.js';
import { db } from './db.js';
import { entryExitEngine } from './entryExitEngine.js';
import { researchEngine } from './researchEngine.js';
import { autonomousScheduler } from './scheduler.js';
import { runAllVerificationTests } from './tests.js';
import { historicalDataStore } from './historicalData.js';
import { agiSelfLearningEngine } from './agiEngine.js';
import { onlinePolicyNetwork } from './onlinePolicyNetwork.js';
import { behaviouralEngine } from './behaviouralEngine.js';
import { botAuditor } from './botAuditor.js';
import { telegramService } from './telegramService.js';

interface StrategySearchJob {
  jobId: string;
  symbol: ForexSymbol;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  total: 300;
  completed: number;
  passedHistorical: number;
  insufficientSample: number;
  rejected: number;
  replicationFinalists: number;
  approvedCount: number;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  topCandidates?: Array<{
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
  }>;
}

const strategySearchJobs = new Map<string, StrategySearchJob>();

export const apiRouter = Router();

// Strictly prevent browser, proxy, or Service Worker caching of dynamic trading API responses
apiRouter.use((_req: Request, res: Response, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Healthcheck
apiRouter.get('/_healthcheck', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    system: 'SignalForge ML Autonomous Research Intelligence',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// GET /api/forex-candles?symbol=EURUSD&limit=100
apiRouter.get('/forex-candles', async (req: Request, res: Response) => {
  try {
    const rawSymbol = ((req.query.symbol as string) || 'EUR/USD').toUpperCase();
    let symbol: ForexSymbol = 'EUR/USD';
    const found = FOREX_PAIRS.find(p => p.replace('/', '') === rawSymbol.replace('/', ''));
    if (found) symbol = found;

    const limit = Math.min(500, Math.max(10, Number(req.query.limit) || 100));
    const result = await dataFeedEngine.fetchCandles(symbol, limit);

    res.json({
      symbol,
      count: result.candles.length,
      source: result.source,
      qualityScore: result.qualityScore,
      candles: result.candles,
      sessions: dataFeedEngine.getMarketSessions(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/scan — Market scan across all configured forex pairs
apiRouter.get('/scan', async (_req: Request, res: Response) => {
  try {
    const scanResults: Array<{
      symbol: ForexSymbol;
      lastPrice: number;
      change24hPct: number;
      source: string;
      qualityScore: number;
      activeSignals: number;
    }> = [];

    const activeSignals = db.getActiveSignals();

    for (const pair of FOREX_PAIRS) {
      const { candles, source, qualityScore } = await dataFeedEngine.fetchCandles(pair, 30);
      const lastCandle = candles[candles.length - 1];
      const firstCandle = candles[0];
      const change24hPct = firstCandle
        ? Number((((lastCandle.close - firstCandle.open) / firstCandle.open) * 100).toFixed(2))
        : 0;

      scanResults.push({
        symbol: pair,
        lastPrice: lastCandle?.close || 0,
        change24hPct,
        source,
        qualityScore,
        activeSignals: activeSignals.filter(s => s.symbol === pair).length,
      });
    }

    res.json({
      timestamp: new Date().toISOString(),
      sessions: dataFeedEngine.getMarketSessions(),
      pairs: scanResults,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/analyze — Deep quantitative analysis for a specific pair
apiRouter.post('/analyze', async (req: Request, res: Response) => {
  try {
    const rawSymbol = ((req.body.symbol as string) || 'EUR/USD').toUpperCase();
    const symbol = FOREX_PAIRS.find(p => p.replace('/', '') === rawSymbol.replace('/', '')) || 'EUR/USD';
    const horizon = Number(req.body.horizon) || 10;
    const ruleFamily = (req.body.ruleFamily as RuleFamily) || 'momentum_5';

    const candles = historicalDataStore.getCandles(symbol);
    if (candles.length < 10_000) {
      return res.status(409).json({
        error: `Insufficient uploaded historical data for research. Import at least 10,000 one-minute candles for ${symbol}; currently stored: ${candles.length}.`,
        symbol,
        storedCandles: candles.length,
        requiredCandles: 10_000,
      });
    }
    const exp = researchEngine.runWalkForwardExperiment(symbol, candles, ruleFamily, horizon, 1);
    const reviews = await researchEngine.generateTrinityReviews(exp);

    res.json({
      symbol,
      source: 'historical-import',
      experiment: exp,
      reviews,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/signals — Pure read-only ledger, latest pair prices, and today's execution statistics
apiRouter.get('/signals', (_req: Request, res: Response) => {
  const signals = db.getSignals();
  const latestPrices: Record<string, number> = {};
  for (const pair of FOREX_PAIRS) {
    const candles = db.getCandles(pair, 1);
    if (candles && candles.length > 0) {
      latestPrices[pair] = candles[candles.length - 1].close;
    }
  }

  // Precompute clean 24h execution categories
  const nowMs = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const recent24h = signals.filter(s => {
    const timeMs = s.predictionTimeUtc ? Date.parse(s.predictionTimeUtc) : 0;
    return nowMs - timeMs <= ONE_DAY_MS;
  });

  const activeTrades = recent24h.filter(s =>
    s.lifecycleState === 'ACTIVE' && s.actualEntryPrice !== null &&
    (s.plannedExitTimeUtc ? Date.parse(s.plannedExitTimeUtc) > nowMs : true)
  );

  const verifyingTrades = recent24h.filter(s =>
    (s.lifecycleState === 'EXIT_PENDING' || (s.lifecycleState === 'ACTIVE' && s.plannedExitTimeUtc && Date.parse(s.plannedExitTimeUtc) <= nowMs)) &&
    s.actualEntryPrice !== null &&
    s.outcomeResult === 'PENDING'
  );

  const completedTrades = recent24h.filter(s =>
    s.lifecycleState === 'CLOSED' && ['WIN', 'LOSS', 'SCRATCH'].includes(s.outcomeResult)
  );

  const unexecutedSignals = recent24h.filter(s =>
    s.actualEntryPrice === null || ['WAITING_FOR_ENTRY', 'DETECTED', 'EXPIRED', 'INVALIDATED', 'AMBIGUOUS'].includes(s.lifecycleState)
  );

  const wins = completedTrades.filter(t => t.outcomeResult === 'WIN').length;
  const losses = completedTrades.filter(t => t.outcomeResult === 'LOSS').length;
  const scratches = completedTrades.filter(t => t.outcomeResult === 'SCRATCH').length;
  const executedCount = activeTrades.length + verifyingTrades.length + completedTrades.length;
  const scoredCount = wins + losses;
  const winRate = scoredCount > 0 ? Number(((wins / scoredCount) * 100).toFixed(1)) : null;
  const netUnits = Number(completedTrades.reduce((acc, t) => acc + (t.netReturnUnits || 0), 0).toFixed(2));

  res.json({
    signals,
    latestPrices,
    todayStats: {
      executedTradesToday: executedCount,
      completedCount: completedTrades.length,
      activeCount: activeTrades.length,
      verifyingCount: verifyingTrades.length,
      unexecutedCount: unexecutedSignals.length,
      wins,
      losses,
      scratches,
      winRate,
      netUnits,
      timestamp: new Date().toISOString(),
    },
    activeCount: activeTrades.length,
    sessions: db.getSessionAccuracyBreakdown(),
  });
});

// GET /api/sessions/accuracy — Observed forward-outcome breakdown by trading session
apiRouter.get('/sessions/accuracy', (_req: Request, res: Response) => {
  res.json({
    sessions: db.getSessionAccuracyBreakdown(),
    marketTime: dataFeedEngine.getMarketSessions(),
  });
});

// GET /api/strategies/synthesized — Candidate, paper-trading and forward-approved strategy pool
apiRouter.get('/strategies/synthesized', (_req: Request, res: Response) => {
  const all = db.getSynthesizedStrategies();
  const promoted = db.getPromotedActiveStrategies();
  res.json({
    strategies: all.map(gene => ({
      ...gene,
      forwardPerformance: db.getStrategyPerformance().find(p => p.strategyId === gene.id) || null,
    })),
    promotedCount: promoted.length,
    paperTradingCount: db.getPaperTradingStrategies().filter(gene => gene.status === 'PAPER_TRADING').length,
    totalCount: all.length,
    generationsCount: db.getGenerations().length,
  });
});

// Historical market-data import and audit endpoints. Files are kept outside the rolling live cache.
apiRouter.post('/research/candles/import', (req: Request, res: Response) => {
  try {
    const rawSymbol = String(req.body.symbol || '').toUpperCase();
    const symbol = FOREX_PAIRS.find(p => p.replace('/', '') === rawSymbol.replace('/', ''));
    if (!symbol) return res.status(400).json({ error: 'Unknown or unsupported forex pair.' });
    const result = historicalDataStore.importCandles(symbol, req.body.candles);
    res.json({ success: true, result, nextStep: 'Validate candidate strategies for this pair.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.get('/research/candles/status', (_req: Request, res: Response) => {
  res.json({ pairs: FOREX_PAIRS.map(pair => historicalDataStore.getStats(pair)) });
});

apiRouter.get('/strategies/performance', (_req: Request, res: Response) => {
  res.json({ strategies: db.getStrategyPerformance() });
});

// Validate one generated candidate against its pair's uploaded historical candles.
apiRouter.post('/strategies/validate', (req: Request, res: Response) => {
  try {
    const gene = db.getSynthesizedStrategyById(String(req.body.geneId || ''));
    if (!gene) return res.status(404).json({ error: 'Strategy candidate not found.' });
    const symbol = gene.symbol || FOREX_PAIRS.find(p => p.replace('/', '') === String(req.body.symbol || '').toUpperCase().replace('/', ''));
    if (!symbol) return res.status(400).json({ error: 'The candidate has no currency pair. Supply a valid symbol.' });
    const candles = historicalDataStore.getCandles(symbol);
    const validated = researchEngine.validateSynthesizedStrategy({ ...gene, symbol }, candles);
    res.json({ success: true, gene: validated });
  } catch (err: any) {
    res.status(409).json({ error: err.message });
  }
});

// Run a real 300-candidate symbolic search against imported M1 history.
apiRouter.post('/strategies/search-batch', (req: Request, res: Response) => {
  try {
    const rawSymbol = String(req.body.symbol || '').toUpperCase();
    const symbol = FOREX_PAIRS.find(pair => pair.replace('/', '') === rawSymbol.replace('/', ''));
    if (!symbol) return res.status(400).json({ error: 'Choose a supported forex pair.' });
    const activeJob = [...strategySearchJobs.values()].find(job => job.status === 'RUNNING');
    if (activeJob) return res.status(409).json({ error: 'A 300-candidate strategy search is already running.', jobId: activeJob.jobId });

    const candles = historicalDataStore.getCandles(symbol);
    if (candles.length < 30_000) {
      return res.status(409).json({
        error: `${symbol} has ${candles.length.toLocaleString()} imported M1 candles. At least 30,000 are required for a meaningful 300-trade test, especially for 20–30 minute expiries.`,
        availableCandles: candles.length,
        requiredCandles: 30_000,
      });
    }

    const jobId = `strategy_search_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const latestGeneration = db.getGenerations()[0]?.generation || 7;
    const job: StrategySearchJob = {
      jobId,
      symbol,
      status: 'RUNNING',
      total: 300,
      completed: 0,
      passedHistorical: 0,
      insufficientSample: 0,
      rejected: 0,
      replicationFinalists: 0,
      approvedCount: db.getPromotedActiveStrategies().length,
      startedAt: new Date().toISOString(),
    };
    strategySearchJobs.set(jobId, job);

    void researchEngine.runNovelStrategySearchBatch(
      symbol,
      candles,
      jobId,
      latestGeneration + 1,
      progress => {
        job.completed = progress.completed;
        job.passedHistorical = progress.passedHistorical;
        job.insufficientSample = progress.insufficientSample;
        job.rejected = progress.rejected;
        job.replicationFinalists = progress.replicationFinalists;
      }
    ).then(results => {
      job.status = 'COMPLETED';
      job.finishedAt = new Date().toISOString();
      job.approvedCount = db.getPromotedActiveStrategies().length;
      job.topCandidates = [...results]
        .sort((a, b) =>
          Number(b.status === 'PAPER_TRADING') - Number(a.status === 'PAPER_TRADING') ||
          Number(!!b.backtestMetrics) - Number(!!a.backtestMetrics) ||
          (b.discoveryMetrics?.validationExpectedValueUnits ?? b.backtestMetrics?.validationWinRate ?? 0) -
            (a.discoveryMetrics?.validationExpectedValueUnits ?? a.backtestMetrics?.validationWinRate ?? 0) ||
          (b.discoveryMetrics?.validationWinRate ?? 0) - (a.discoveryMetrics?.validationWinRate ?? 0)
        )
        .slice(0, 10)
        .map(gene => ({
          id: gene.id,
          name: gene.name,
          formula: gene.mathematicalFormula,
          status: gene.status,
          testWinRate: gene.backtestMetrics?.testWinRate ?? 0,
          testScoredTrades: gene.backtestMetrics?.testScoredSampleSize ?? 0,
          validationWinRate: gene.discoveryMetrics?.validationWinRate ?? gene.backtestMetrics?.validationWinRate ?? 0,
          validationExpectedValueUnits: gene.discoveryMetrics?.validationExpectedValueUnits ?? 0,
          testExpectedValueUnits: gene.backtestMetrics?.expectedValueUnits ?? 0,
          testedOnHoldout: !!gene.backtestMetrics,
          expectedValueUnits: gene.discoveryMetrics?.validationExpectedValueUnits ?? gene.backtestMetrics?.expectedValueUnits ?? 0,
          testBlockWinRates: gene.backtestMetrics?.testBlockWinRates ?? [],
          minimumPayoutPct: gene.discoveryMetrics?.minimumPayoutPct ?? gene.backtestMetrics?.binaryPayoutPct ?? 0,
          reason: gene.validationFailureReason,
        }));
    }).catch(error => {
      job.status = 'FAILED';
      job.finishedAt = new Date().toISOString();
      job.error = error?.message || 'Strategy search failed.';
    });

    // Keep only the most recent jobs in memory.
    while (strategySearchJobs.size > 20) {
      const oldest = strategySearchJobs.keys().next().value;
      if (oldest) strategySearchJobs.delete(oldest);
      else break;
    }
    return res.status(202).json({ success: true, jobId, total: 300, symbol, status: 'RUNNING' });
  } catch (err: any) {
    return res.status(409).json({ error: err.message });
  }
});

apiRouter.get('/strategies/search-batch/:jobId', (req: Request, res: Response) => {
  const job = strategySearchJobs.get(String(req.params.jobId));
  if (!job) return res.status(404).json({ error: 'Strategy search job not found.' });
  return res.json(job);
});

// POST /api/strategies/evolve — Trigger immediate evolutionary synthesis of a novel strategy
apiRouter.post('/strategies/evolve', async (_req: Request, res: Response) => {
  try {
    const pair: ForexSymbol = FOREX_PAIRS[Math.floor(Math.random() * FOREX_PAIRS.length)];
    const { candles } = await dataFeedEngine.fetchCandles(pair, 60);
    const generations = db.getGenerations();
    const currentGen = (generations[0]?.generation || 7) + 1;
    const newGene = researchEngine.synthesizeInfiniteNovelStrategy(candles, pair, currentGen);
    
    res.json({
      success: true,
      gene: newGene,
      strategies: db.getSynthesizedStrategies(),
      promotedCount: db.getPromotedActiveStrategies().length,
      paperTradingCount: db.getPaperTradingStrategies().filter(gene => gene.status === 'PAPER_TRADING').length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/signals/clear-history — Purges closed trade history while keeping active/pending signals
apiRouter.post('/signals/clear-history', (_req: Request, res: Response) => {
  db.clearClosedSignalsHistory();
  res.json({
    success: true,
    message: 'Closed signals history cleared successfully',
    signals: db.getSignals(),
    activeCount: db.getActiveSignals().length,
  });
});

// POST /api/signals/hydrate-ledger — Restores immutable settled trades from persistent Firestore cloud ledger after cold start
apiRouter.post('/signals/hydrate-ledger', (req: Request, res: Response) => {
  const incoming = Array.isArray(req.body?.signals) ? req.body.signals : [];
  const { importedCount } = db.hydrateImmutableSignals(incoming);
  res.json({
    success: true,
    importedCount,
    signals: db.getSignals(),
  });
});

// POST /api/signals/evaluate — Step causal entry/exit engine on active signals
apiRouter.post('/signals/evaluate', async (_req: Request, res: Response) => {
  try {
    const candlesMap: Record<ForexSymbol, any> = {} as any;
    for (const pair of FOREX_PAIRS) {
      const { candles, source } = await dataFeedEngine.fetchCandles(pair, 60);
      const newest = candles[candles.length - 1];
      const ageMs = newest ? Date.now() - newest.timestampMs : Infinity;
      const hasFreshRealData =
        source !== 'synthetic' &&
        !!newest &&
        newest.source !== 'synthetic' &&
        ['biquote', 'dukascopy', 'yahoo', 'imported'].includes(newest.source) &&
        ageMs >= -60_000 &&
        ageMs <= 120_000;
      // Do not settle a pending trade using random continuity candles or stale data.
      candlesMap[pair] = hasFreshRealData
        ? candles.filter(c => c.source !== 'synthetic')
        : [];
    }

    const updated = entryExitEngine.evaluateSignals(candlesMap);
    const completed = updated.filter(signal =>
      signal.lifecycleState === 'CLOSED' &&
      ['WIN', 'LOSS', 'SCRATCH'].includes(signal.outcomeResult)
    );
    // A settled outcome is written once to the forward journal and strategy
    // ledger. recordStrategyOutcome de-duplicates signal IDs and uses only
    // payout-aware stake units for the 300-outcome approval window.
    for (const signal of completed) {
      db.recordForwardObservation(signal);
      db.recordStrategyOutcome(signal);
      db.updateBehaviouralMemoryOutcome(signal.id, signal.outcomeResult, signal.netReturnPips, signal.netReturnUnits);

      if (signal.outcomeResult === 'LOSS' && !signal.lossAutopsy) {
        const pairCandles = candlesMap[signal.symbol] || [];
        const lastCandle = pairCandles[pairCandles.length - 1] || {
          close: signal.actualExitPrice || signal.actualEntryPrice || 0,
          high: signal.actualExitPrice || signal.actualEntryPrice || 0,
          low: signal.actualExitPrice || signal.actualEntryPrice || 0,
          open: signal.actualEntryPrice || 0,
          volume: 100,
          timestamp: signal.actualExitTimeUtc || new Date().toISOString(),
          timestampMs: Date.now(),
          source: 'dukascopy',
          symbol: signal.symbol,
        };
        const { autopsy } = researchEngine.conductForensicLossAutopsy(signal, lastCandle);
        signal.lossAutopsy = autopsy;
        db.addLossAutopsy(autopsy);
        db.updateSignal(signal);
      }

      await telegramService.sendSettlementAlert(signal).catch(err => {
        console.error('[API] Telegram settlement audit dispatch error:', err.message);
      });
    }
    res.json({
      evaluatedCount: db.getActiveSignals().length,
      transitionedCount: updated.length,
      completedOutcomesRecorded: completed.length,
      signals: db.getSignals().slice(0, 50),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/evolution/run — Manually trigger an autonomous research generation
apiRouter.post('/evolution/run', async (_req: Request, res: Response) => {
  try {
    const result = await autonomousScheduler.executeFullResearchCycle('MANUAL_USER_TRIGGER');
    res.json({
      success: true,
      result,
      cronState: db.getCronState(),
    });
  } catch (err: any) {
    res.status(409).json({ error: err.message });
  }
});

// GET /api/evolution/state — Current evolutionary state and top candidates
apiRouter.get('/evolution/state', (_req: Request, res: Response) => {
  const generations = db.getGenerations();
  const experiments = db.getExperiments();
  const historicalExperiments = experiments.filter(e => e.experimentType !== 'LIVE_TRADE' && e.experimentType !== 'FORWARD_OBSERVATION');
  const accepted = historicalExperiments.filter(e => e.auditorVerdict === 'ACCEPTED');
  const rejected = historicalExperiments.filter(e => e.auditorVerdict === 'REJECTED');

  res.json({
    currentGeneration: generations.length > 0 ? generations[0].generation : 1,
    totalExperiments: historicalExperiments.length,
    totalForwardObservations: experiments.length - historicalExperiments.length,
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
    generations,
    topCandidates: accepted.slice(0, 10),
  });
});

// Detailed entry and learning audit. This endpoint is read-only.
apiRouter.get('/evolution/diagnostics', (_req: Request, res: Response) => {
  res.json(db.getEvolutionDiagnostics());
});

// Rebuild and reconcile learning state safely. Both operations are idempotent.
apiRouter.post('/evolution/reconcile', (_req: Request, res: Response) => {
  try {
    const onlineReplay = db.rebuildOnlineLearnerFromHistory();
    const outcomeRecovery = db.reconcileClosedSignalLearning();
    return res.json({
      onlineReplay,
      outcomeRecovery,
      diagnostics: db.getEvolutionDiagnostics(),
    });
  } catch (error: any) {
    console.error('[Learning] Manual reconciliation failed:', error);
    return res.status(500).json({
      error: 'Learning reconciliation failed.',
      details: error?.message || String(error),
    });
  }
});

// GET /api/research/history
apiRouter.get('/research/history', (_req: Request, res: Response) => {
  res.json({
    experiments: db.getExperiments(),
    generations: db.getGenerations(),
  });
});

// GET /api/research/agents — Scientist, Engineer, Auditor deliberation records
apiRouter.get('/research/agents', (_req: Request, res: Response) => {
  res.json({
    reviews: db.getReviews(),
  });
});

// GET /api/research/autopsies — Forensic Loss Investigations & Evolved Antidotes
apiRouter.get('/research/autopsies', (_req: Request, res: Response) => {
  const autopsies = db.getLossAutopsies();
  res.json({
    autopsies,
    totalCount: autopsies.length,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/system/health — Provider health, db statistics, cron status
apiRouter.get('/system/health', (_req: Request, res: Response) => {
  const cron = db.getCronState();
  res.json({
    uptimeSeconds: Math.floor(process.uptime()),
    dbType: 'JSON File Store',
    dbPath: 'data/signalforge.db.json',
    totalCandlesStored: db.getTotalCandlesCount(),
    activeSignalsCount: db.getActiveSignals().length,
    totalExperimentsRun: db.getExperiments().filter(e => e.experimentType !== 'LIVE_TRADE' && e.experimentType !== 'FORWARD_OBSERVATION').length,
    totalForwardObservations: db.getExperiments().filter(e => e.experimentType === 'LIVE_TRADE' || e.experimentType === 'FORWARD_OBSERVATION').length,
    lastCronRun: cron.lastRun,
    nextCronRun: cron.nextRun,
    isCronRunning: autonomousScheduler.isRunning(),
    cronHistory: cron.history,
    providers: db.getFeedHealthList(),
    sessions: dataFeedEngine.getMarketSessions(),
    uptimeTelemetry: autonomousScheduler.getUptimeTelemetry(),
  });
});

// GET /api/system/uptime-status — 24/5 runtime environment & external cron verification
apiRouter.get('/system/uptime-status', (req: Request, res: Response) => {
  const telemetry = autonomousScheduler.getUptimeTelemetry();
  const forwardedProto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
  const forwardedHost = (req.headers['x-forwarded-host'] as string) || req.get('host') || 'localhost:3000';
  const origin = `${forwardedProto}://${forwardedHost}`;

  res.json({
    ...telemetry,
    detectedOrigin: origin,
    cronTickUrl: `${origin}/api/cron/tick`,
    cloudflareWorkerKeepalive: `export default {\n  async scheduled(event, env, ctx) {\n    ctx.waitUntil(\n      fetch("${origin}/api/cron/tick?source=CLOUDFLARE_CRON", {\n        method: "GET",\n        headers: { "User-Agent": "SignalForge-24x5-Worker/1.0" }\n      })\n    );\n  }\n};`,
  });
});

// GET /api/scheduler/heartbeat — Service Worker keepalive & engine execution probe
apiRouter.get('/scheduler/heartbeat', (_req: Request, res: Response) => {
  const cron = db.getCronState();
  res.json({
    status: 'ONLINE',
    engine: 'SignalForge Autonomous Daemon',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    activeSignalsCount: db.getActiveSignals().length,
    totalSignalsCount: db.getSignals().length,
    lastPulse: cron.lastRun,
    isCronRunning: autonomousScheduler.isRunning(),
    dbSynced: true,
    version: '2.4.0',
    backgroundSyncSupported: true,
    uptimeTelemetry: autonomousScheduler.getUptimeTelemetry(),
  });
});

// Dedicated 24/5 External Cron Tick Handler (supports both GET and POST for cron-job.org, UptimeRobot, Cloud Scheduler, CF Workers)
const handleExternalCronTick = async (req: Request, res: Response) => {
  try {
    // Optional secret gate if CRON_SECRET env var is configured
    const expectedSecret = process.env.CRON_SECRET;
    if (expectedSecret) {
      const provided =
        (req.query.key as string) ||
        (req.headers['x-cron-key'] as string) ||
        (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (provided !== expectedSecret) {
        res.status(401).json({ error: 'Unauthorized cron key' });
        return;
      }
    }

    if (!autonomousScheduler.isRunning()) {
      autonomousScheduler.start();
    }

    const source =
      (req.query.source as string) ||
      (req.body?.source as string) ||
      (req.headers['user-agent']?.slice(0, 48)) ||
      'EXTERNAL_24_5_CRON';

    db.recordExternalCronPing(source);

    const beforeSignalIds = new Set(db.getSignals().map(s => s.id));
    const result = await autonomousScheduler.executeAutopilotPulse('EXTERNAL_24_5_CRON');

    const allSignals = db.getSignals();
    const newlySettled = allSignals.filter(s =>
      ['WIN', 'LOSS', 'SCRATCH'].includes(s.outcomeResult) &&
      s.actualExitTimeUtc &&
      Date.now() - Date.parse(s.actualExitTimeUtc) <= 120_000
    );
    const newlyEmitted = allSignals.filter(s =>
      !beforeSignalIds.has(s.id) &&
      s.confidence >= 0.70
    );

    const telemetry = autonomousScheduler.getUptimeTelemetry();
    const timestampIst = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(new Date()).toUpperCase() + ' IST';

    res.json({
      status: 'ok',
      mode: telemetry.runtimeMode,
      marketOpen: telemetry.marketOpen,
      marketStatusText: telemetry.marketStatusText,
      source,
      timestampUtc: new Date().toISOString(),
      timestampIst,
      uptimeSeconds: telemetry.uptimeSeconds,
      externalCronCount: telemetry.externalCronCount,
      summary: result,
      newlyEmittedCount: newlyEmitted.length,
      newlySettledCount: newlySettled.length,
      activeSignalsCount: db.getActiveSignals().length,
    });
  } catch (err: any) {
    res.status(500).json({ status: 'error', error: err.message });
  }
};

apiRouter.get('/cron/tick', handleExternalCronTick);
apiRouter.post('/cron/tick', handleExternalCronTick);
apiRouter.get('/scheduler/pulse', handleExternalCronTick);

// POST /api/scheduler/pulse — Triggered by Service Worker background sync or periodic pulse
apiRouter.post('/scheduler/pulse', async (req: Request, res: Response) => {
  try {
    const source = req.body?.source || 'SERVICE_WORKER_BACKGROUND_PULSE';
    if (!autonomousScheduler.isRunning()) {
      autonomousScheduler.start();
    }
    const beforeSignalIds = new Set(db.getSignals().map(s => s.id));

    const result = await autonomousScheduler.executeAutopilotPulse(source);

    const allSignals = db.getSignals();
    const newlySettled = allSignals.filter(s =>
      ['WIN', 'LOSS'].includes(s.outcomeResult) &&
      s.actualExitTimeUtc &&
      Date.now() - Date.parse(s.actualExitTimeUtc) <= 120_000
    );
    const newlyEmitted = allSignals.filter(s =>
      !beforeSignalIds.has(s.id) &&
      s.confidence >= 0.70
    );

    res.json({
      success: true,
      summary: result,
      newlySettled,
      newlyEmitted,
      activeSignalsCount: db.getActiveSignals().length,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/system/export-d1 — Cloudflare D1 SQL Schema & wrangler.toml
apiRouter.get('/system/export-d1', (_req: Request, res: Response) => {
  res.json({
    schemaSql: db.generateCloudflareD1Schema(),
    wranglerToml: db.generateWranglerToml(),
    notes: 'Deploy directly using: npx wrangler d1 execute signalforge-db --file=migrations/0001_initial.sql',
  });
});

// POST /api/test/run and /api/tests/run — Run automated verification test suite
const handleRunTests = async (_req: Request, res: Response) => {
  try {
    const report = await runAllVerificationTests();
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
apiRouter.post('/test/run', handleRunTests);
apiRouter.post('/tests/run', handleRunTests);

// GET /api/autopilot/logs — Real-time Autonomous Intelligence stream
apiRouter.get('/autopilot/logs', (_req: Request, res: Response) => {
  res.json({
    logs: db.getAutopilotLogs(40),
    activeCount: db.getActiveSignals().length,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/autopilot/status — Autonomous Engine health and status
apiRouter.get('/autopilot/status', (_req: Request, res: Response) => {
  res.json({
    status: 'ACTIVE_AUTOPILOT',
    mode: 'AUTOMATED_SIGNAL_AND_RESEARCH',
    activeSignalsCount: db.getActiveSignals().length,
    totalCandles: db.getTotalCandlesCount(),
    pairsMonitored: FOREX_PAIRS.length,
    intervalSeconds: 20,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/agi/state — Closed-loop self-learning telemetry
apiRouter.get('/agi/state', (_req: Request, res: Response) => {
  res.json({
    agi: agiSelfLearningEngine.getSelfLearningState(),
  });
});

// GET /api/online-model/telemetry — Neural network optimization stats
apiRouter.get('/online-model/telemetry', (_req: Request, res: Response) => {
  res.json({
    telemetry: onlinePolicyNetwork.getTelemetry(),
  });
});

// GET /api/online-model/weights — Real numerical weights snapshot
apiRouter.get('/online-model/weights', (_req: Request, res: Response) => {
  res.json({
    weights: onlinePolicyNetwork.getWeightsSnapshot(),
  });
});

// ==========================================
// BEHAVIOURAL INTELLIGENCE & BOT AUDITOR APIS
// ==========================================

// GET /api/behavioural/assessment — Real market behavioral assessments
apiRouter.get('/behavioural/assessment', async (req: Request, res: Response) => {
  try {
    const rawSymbol = ((req.query.symbol as string) || 'EUR/USD').toUpperCase();
    let symbol: ForexSymbol = 'EUR/USD';
    const found = FOREX_PAIRS.find(p => p.replace('/', '') === rawSymbol.replace('/', ''));
    if (found) symbol = found;

    const candleRes = await dataFeedEngine.fetchCandles(symbol, 60);
    const hypotheses = behaviouralEngine.assessMarketBehavior(symbol, candleRes.candles);
    const active = hypotheses.filter(h => h.isActive);

    res.json({
      symbol,
      candleCount: candleRes.candles.length,
      feedQualityScore: candleRes.qualityScore,
      hypotheses,
      activeCount: active.length,
      activeBehaviors: active.map(h => h.type),
      timestampIst: new Date().toLocaleTimeString('en-US', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }) + ' IST',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/behavioural/bot-auditor — Algorithmic self-monitoring state
apiRouter.get('/behavioural/bot-auditor', (_req: Request, res: Response) => {
  try {
    let state = db.getBotHealthState();
    if (!state) {
      state = botAuditor.auditBotHealth(db.getSignals(), db.getLossAutopsies());
      db.saveBotHealthState(state);
    }
    res.json({
      botHealth: state,
      evaluatedSignalsCount: db.getSignals().length,
      evaluatedLossesCount: db.getLossAutopsies().length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/behavioural/memory — Persistent auditable memory trail
apiRouter.get('/behavioural/memory', (_req: Request, res: Response) => {
  try {
    const memory = db.getBehaviouralMemory();
    res.json({
      records: memory,
      totalCount: memory.length,
      pendingCount: memory.filter(m => m.actualOutcome === 'PENDING').length,
      settledCount: memory.filter(m => ['WIN', 'LOSS', 'SCRATCH'].includes(m.actualOutcome)).length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/behavioural/shadow-comparison — Shadow vs Baseline experimentation
apiRouter.get('/behavioural/shadow-comparison', (_req: Request, res: Response) => {
  try {
    const comparison = db.getShadowComparison();
    res.json({
      comparison,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// TELEGRAM BOT INTEGRATION ENDPOINTS
// ==========================================

// GET /api/telegram/status — Get bot profile and subscriber status
apiRouter.get('/telegram/status', async (_req: Request, res: Response) => {
  try {
    const config = db.getTelegramConfig();
    const botInfo = await telegramService.getBotInfo();

    res.json({
      configured: Boolean(config.botToken),
      enabled: config.enabled,
      bot: botInfo.bot || {
        id: 8386549882,
        username: config.botUsername || 'Forex_new_calender_bot',
        firstName: config.botFirstName || 'Forex news',
      },
      botStatus: botInfo.ok ? 'ONLINE' : 'ERROR',
      botError: botInfo.error,
      subscribersCount: config.subscribers.length,
      subscribers: config.subscribers,
      notifyOnNewSignal: config.notifyOnNewSignal,
      notifyOnSettlement: config.notifyOnSettlement,
      minConfidence: config.minConfidence,
      lastSyncAt: config.lastSyncAt,
      botUrl: `https://t.me/${config.botUsername || 'Forex_new_calender_bot'}`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/telegram/sync — Trigger getUpdates to auto-discover subscribers
apiRouter.post('/api/telegram/sync', async (_req: Request, res: Response) => {
  try {
    const syncRes = await telegramService.syncSubscribersFromUpdates();
    res.json(syncRes);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Also support without /api prefix for router mounting convenience
apiRouter.post('/telegram/sync', async (_req: Request, res: Response) => {
  try {
    const syncRes = await telegramService.syncSubscribersFromUpdates();
    res.json(syncRes);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/telegram/subscribers — Manually add a subscriber (Chat ID or Channel)
apiRouter.post('/telegram/subscribers', (req: Request, res: Response) => {
  try {
    const { id, name, username, type } = req.body;
    if (!id) {
      return res.status(400).json({ error: 'Subscriber chat id is required' });
    }

    const nowIst = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(new Date()).toUpperCase() + ' IST';

    db.addTelegramSubscriber({
      id,
      name: name || `Subscriber ${id}`,
      username: username ? username.replace(/^@/, '') : undefined,
      type: type || 'user',
      addedAt: nowIst,
    });

    const updated = db.getTelegramConfig();
    res.json({
      success: true,
      subscribers: updated.subscribers,
      totalCount: updated.subscribers.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/telegram/subscribers/:id — Remove a subscriber
apiRouter.delete('/telegram/subscribers/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const removed = db.removeTelegramSubscriber(id);
    const updated = db.getTelegramConfig();
    res.json({
      success: removed,
      subscribers: updated.subscribers,
      totalCount: updated.subscribers.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/telegram/settings — Update Telegram notification preferences
apiRouter.post('/telegram/settings', (req: Request, res: Response) => {
  try {
    const { enabled, botToken, notifyOnNewSignal, notifyOnSettlement, minConfidence } = req.body;

    const updates: any = {};
    if (typeof enabled === 'boolean') updates.enabled = enabled;
    if (typeof botToken === 'string' && botToken.trim()) updates.botToken = botToken.trim();
    if (typeof notifyOnNewSignal === 'boolean') updates.notifyOnNewSignal = notifyOnNewSignal;
    if (typeof notifyOnSettlement === 'boolean') updates.notifyOnSettlement = notifyOnSettlement;
    if (typeof minConfidence === 'number') updates.minConfidence = Math.max(0.5, Math.min(0.99, minConfidence));

    const updated = db.saveTelegramConfig(updates);
    res.json({
      success: true,
      config: updated,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/telegram/test — Send test verification alert
apiRouter.post('/telegram/test', async (req: Request, res: Response) => {
  try {
    const { targetChatId } = req.body || {};
    const testResult = await telegramService.sendTestAlert(targetChatId);
    res.json(testResult);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/telegram/audit-report — Dispatch a Win & Loss Audit Report (single settled signal or full Daily Audit Summary)
apiRouter.post('/telegram/audit-report', async (req: Request, res: Response) => {
  try {
    const { signalId, targetChatId } = req.body || {};

    if (signalId) {
      const sig = db.getSignalById(String(signalId));
      if (!sig) {
        return res.status(404).json({ success: false, sentTo: 0, error: 'Signal not found in ledger.' });
      }
      if (sig.lifecycleState !== 'CLOSED' || !['WIN', 'LOSS', 'SCRATCH'].includes(sig.outcomeResult)) {
        return res.status(400).json({
          success: false,
          sentTo: 0,
          error: 'Signal is not settled yet. Audit reports can only be sent for CLOSED WIN/LOSS/SCRATCH results.',
        });
      }

      const config = db.getTelegramConfig();
      if (!targetChatId && config.subscribers.length === 0) {
        return res.json({
          success: false,
          sentTo: 0,
          error: 'No Telegram subscribers registered yet. Open Telegram Settings and sync your chat ID first.',
        });
      }

      const results = await telegramService.sendSettlementAlert(sig, {
        forceResend: true,
        targetChatId,
      });
      const delivered = results.filter(r => r.success).length;
      return res.json({
        success: delivered > 0,
        sentTo: delivered,
        signalId: sig.id,
        outcome: sig.outcomeResult,
        error: delivered === 0 ? results[0]?.error || 'Failed to deliver audit report to Telegram' : undefined,
      });
    }

    const summaryRes = await telegramService.sendDailyAuditSummaryReport(targetChatId);
    return res.json(summaryRes);
  } catch (err: any) {
    res.status(500).json({ success: false, sentTo: 0, error: err.message });
  }
});

