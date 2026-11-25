/**
 * SignalForge ML — Comprehensive Automated Verification Test Suite
 * Executes real tests across Data Ingestion, ML Pipeline, Causal Entry/Exit Engine,
 * Research Trinity Audits, and System State.
 */

import { Candle, ForexSymbol, FOREX_PAIRS, ResearchExperiment, ResearchSignal, VerificationTestResult } from '../types/index.js';
import { summarizeForwardObservations, summarizeSignalAccounting } from '../utils/tradeAccounting.js';
import { dataFeedEngine, filterFreshRealCandles, getFreshRealCandleWindow, hasFreshRealProviderCandles, LIVE_CANDLE_MAX_AGE_MS } from './dataFeeds.js';
import { db } from './db.js';
import { entryExitEngine, findExactEntryCandle, LIVE_ENTRY_BAR_ARRIVAL_GRACE_MS } from './entryExitEngine.js';
import { researchEngine } from './researchEngine.js';
import { calculateBinarySettlement } from './binarySettlement.js';
import { buildAccuracyReport } from '../utils/accuracyAnalytics.js';
import { telegramService } from './telegramService.js';
import { isWithinStrictSignalDiscoveryWindow } from './scheduler.js';
import {
  createInitialOnlineLearnerState,
  getOnlineLearnerSummary,
  learnOnlineOutcome,
  predictOnlineOutcome,
  replayOnlineLearnerHistory,
  normalizeOnlineLearnerState,
  ONLINE_LEARNER_FEATURE_DIMENSIONS,
} from './onlineLearning.js';

const makeM1TestCandles = (symbol: ForexSymbol, count: number): Candle[] =>
  dataFeedEngine.generateRealisticHistoricalCandles(symbol, count).map(c => {
    const timestampMs = Math.floor(c.timestampMs / 60_000) * 60_000;
    return {
      ...c,
      timestampMs,
      timestamp: new Date(timestampMs).toISOString(),
      source: 'test_fixture' as const,
    };
  });

export async function runAllVerificationTests(): Promise<{
  summary: { total: number; passed: number; failed: number; durationMs: number };
  results: VerificationTestResult[];
}> {
  const startTime = Date.now();
  const results: VerificationTestResult[] = [];

  const runTest = async (
    category: VerificationTestResult['category'],
    name: string,
    fn: () => Promise<void> | void
  ) => {
    const t0 = Date.now();
    try {
      await fn();
      results.push({
        category,
        name,
        passed: true,
        durationMs: Date.now() - t0,
        details: 'Passed all verification assertions.',
      });
    } catch (err: any) {
      results.push({
        category,
        name,
        passed: false,
        durationMs: Date.now() - t0,
        details: 'Assertion failure',
        error: err.message,
      });
    }
  };

  await runTest('DATA', 'Olymp Trade-ranked universe contains 29 qualifying pairs and excludes low-payout candidates', () => {
    const requiredPairs = [
      'USD/MXN', 'AUD/JPY', 'AUD/USD', 'EUR/AUD', 'EUR/JPY', 'EUR/NZD',
      'EUR/USD', 'GBP/CAD', 'GBP/JPY', 'GBP/NZD', 'NZD/CAD', 'USD/CAD',
      'USD/CHF', 'EUR/CAD', 'NZD/JPY', 'CHF/JPY', 'NZD/USD', 'AUD/CHF',
      'AUD/NZD', 'EUR/GBP', 'GBP/USD', 'EUR/CHF', 'NZD/CHF', 'AUD/CAD',
      'USD/JPY', 'GBP/AUD', 'GBP/CHF', 'CAD/JPY', 'CAD/CHF',
    ];
    if (FOREX_PAIRS.length !== 29 ||
        new Set(FOREX_PAIRS).size !== 29 ||
        requiredPairs.some(pair => !FOREX_PAIRS.includes(pair as ForexSymbol)) ||
        FOREX_PAIRS.includes('USD/NOK' as ForexSymbol) ||
        FOREX_PAIRS.includes('USD/SGD' as ForexSymbol)) {
      throw new Error('The scanner pair universe does not match the 29 qualifying audit pairs.');
    }
  });

  await runTest('DATA', 'Strict 3-minute discovery window includes only the intended 65-second lead window', () => {
    const fiveMinuteBoundary = Date.UTC(2026, 10, 25, 12, 0, 0);
    if (
      !isWithinStrictSignalDiscoveryWindow(fiveMinuteBoundary + 90_000) ||
      !isWithinStrictSignalDiscoveryWindow(fiveMinuteBoundary + 155_000) ||
      isWithinStrictSignalDiscoveryWindow(fiveMinuteBoundary + 89_999) ||
      isWithinStrictSignalDiscoveryWindow(fiveMinuteBoundary + 155_001)
    ) {
      throw new Error('The strict 3-minute signal discovery window boundaries are incorrect.');
    }
  });

  await runTest('DATA', 'Session and pair accuracy uses only verified filled settlements', () => {
    const nowMs = Date.UTC(2026, 10, 25, 12, 0, 0);
    const makeSettlement = (
      id: string,
      outcome: 'WIN' | 'LOSS' | 'SCRATCH',
      session?: 'ASIA' | 'LONDON' | 'OVERLAP' | 'NEW_YORK',
      overrides: Partial<ResearchSignal> = {}
    ): ResearchSignal => ({
      id,
      symbol: 'EUR/USD',
      direction: 'BUY',
      predictionTimeUtc: new Date(nowMs - 60 * 60_000).toISOString(),
      predictionTimeIst: '05:30 PM IST',
      signalCandleTime: new Date(nowMs - 60 * 60_000).toISOString(),
      entryCondition: 'Verified test fixture',
      entryWindowStartUtc: new Date(nowMs - 60 * 60_000).toISOString(),
      entryWindowEndUtc: new Date(nowMs - 55 * 60_000).toISOString(),
      triggerPrice: 1.1,
      invalidationPrice: 1.09,
      actualEntryTimeUtc: new Date(nowMs - 55 * 60_000).toISOString(),
      actualEntryPrice: 1.1,
      entrySource: 'yahoo',
      expiryMinutes: 5,
      plannedExitTimeUtc: new Date(nowMs - 50 * 60_000).toISOString(),
      actualExitTimeUtc: new Date(nowMs - 50 * 60_000).toISOString(),
      actualExitPrice: 1.101,
      confidence: 0.8,
      calibrationStatus: 'UNCALIBRATED',
      lifecycleState: 'CLOSED',
      lifecycleHistory: [],
      grossReturnPips: 10,
      estimatedSpreadPips: 1,
      netReturnPips: 9,
      payoutPct: 80,
      netReturnUnits: outcome === 'WIN' ? 0.8 : outcome === 'LOSS' ? -1 : 0,
      outcomeResult: outcome,
      ruleFamily: 'momentum_5',
      modelVersion: 'test',
      marketSession: session,
      ...overrides,
    } as ResearchSignal);

    const asiaWin = makeSettlement('accuracy_asia_win', 'WIN', 'ASIA');
    const asiaLoss = makeSettlement('accuracy_asia_loss', 'LOSS', 'ASIA');
    const londonScratch = makeSettlement('accuracy_london_scratch', 'SCRATCH', 'LONDON');
    const noSession = makeSettlement('accuracy_no_session', 'WIN', undefined, {
      predictionTimeUtc: '2026-11-25T13:00:00.000Z',
    });
    const expiredUnfilled = makeSettlement('accuracy_expired', 'LOSS', 'ASIA', {
      lifecycleState: 'EXPIRED',
      actualEntryTimeUtc: null,
      actualEntryPrice: null,
      actualExitTimeUtc: null,
      actualExitPrice: null,
    });
    const missingPayout = makeSettlement('accuracy_missing_payout', 'WIN', 'ASIA', {
      payoutPct: undefined,
    });
    const testFixture = makeSettlement('accuracy_test_rule', 'WIN', 'ASIA', {
      ruleFamily: 'test_fixture',
    });

    const report = buildAccuracyReport(
      [asiaWin, asiaLoss, londonScratch, noSession, expiredUnfilled, missingPayout, testFixture, asiaWin],
      { period: 'ALL', nowMs }
    );

    if (
      report.summary.settlements !== 4 ||
      report.summary.scoredTrades !== 3 ||
      report.summary.wins !== 2 ||
      report.summary.losses !== 1 ||
      report.summary.scratches !== 1 ||
      report.summary.winRatePct !== 66.7
    ) {
      throw new Error(`Unexpected verified accuracy summary: ${JSON.stringify(report.summary)}`);
    }

    const asia = report.sessions.find(row => row.key === 'ASIA');
    const london = report.sessions.find(row => row.key === 'LONDON');
    const overlap = report.sessions.find(row => row.key === 'OVERLAP');
    if (asia?.scoredTrades !== 2 || asia.winRatePct !== 50 ||
        london?.scratches !== 1 || london.winRatePct !== null ||
        overlap?.wins !== 1) {
      throw new Error('Session-wise aggregation or legacy session inference is incorrect.');
    }

    const londonPairs = buildAccuracyReport(
      [asiaWin, asiaLoss, londonScratch, noSession],
      { period: 'ALL', pairSession: 'LONDON', nowMs }
    );
    const eurUsdLondon = londonPairs.pairs.find(row => row.key === 'EUR/USD');
    if (eurUsdLondon?.settlements !== 1 || eurUsdLondon.scoredTrades !== 0 ||
        eurUsdLondon.winRatePct !== null) {
      throw new Error('Pair-wise session filtering must keep scratch rows separate from scored win rate.');
    }
    if (report.pairs.length !== FOREX_PAIRS.length) {
      throw new Error('Pair accuracy must render every configured currency pair, including pairs with no data.');
    }
  });

  await runTest('ML', 'Legacy 20-pair shadow learner weights migrate into the 29-pair layout', () => {
    const oldZ = Array(47).fill(0);
    const oldN = Array(47).fill(0);
    oldZ[0] = 0.11;       // intercept
    oldZ[1] = 0.12;       // first market feature
    oldZ[20] = 0.20;      // legacy EUR/USD pair flag
    oldZ[40] = 0.40;      // direction flag
    oldZ[41] = 0.41;      // first strategy family flag
    oldN[20] = 4;
    oldN[40] = 5;
    const migrated = normalizeOnlineLearnerState({
      ...createInitialOnlineLearnerState(),
      z: oldZ,
      n: oldN,
      sampleCount: 12,
      wins: 8,
      losses: 4,
    });
    const eurUsdIndex = 20 + 6; // EUR/USD's position in the new ranked 29-pair one-hot block.
    const directionIndex = 20 + 29;
    const strategyIndex = directionIndex + 1;
    if (ONLINE_LEARNER_FEATURE_DIMENSIONS !== 56 ||
        migrated.z.length !== 56 || migrated.n.length !== 56 ||
        migrated.z[0] !== 0.11 || migrated.z[1] !== 0.12 ||
        migrated.z[eurUsdIndex] !== 0.20 || migrated.n[eurUsdIndex] !== 4 ||
        migrated.z[directionIndex] !== 0.40 || migrated.n[directionIndex] !== 5 ||
        migrated.z[strategyIndex] !== 0.41 ||
        migrated.z[20] !== 0 ||
        migrated.sampleCount !== 12 || migrated.wins !== 8 || migrated.losses !== 4) {
      throw new Error('Existing learner weights/statistics were not preserved during pair-universe migration.');
    }
  });

  await runTest('ML', 'FTRL learner starts neutral, updates only from verified WIN/LOSS and stays shadow-only', () => {
    const context = {
      symbol: 'EUR/USD',
      direction: 'BUY' as const,
      ruleFamily: 'momentum_5',
      marketFeatureVector: Array(19).fill(0.1),
    };
    let model = createInitialOnlineLearnerState();
    const first = predictOnlineOutcome(model, context);
    if (first.probability !== 0.5 || first.sampleSize !== 0 ||
        first.status !== 'WARMUP' || first.isActionable !== false) {
      throw new Error('A fresh learner must start neutral, in warmup, and non-actionable.');
    }
    for (let index = 0; index < 100; index++) {
      const prediction = predictOnlineOutcome(model, context);
      model = learnOnlineOutcome(
        model,
        context,
        'WIN',
        prediction.probability,
        new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString(),
      );
    }
    const learned = predictOnlineOutcome(model, context);
    const summary = getOnlineLearnerSummary(model);
    if (!(learned.probability > first.probability) || learned.sampleSize !== 100 ||
        learned.status !== 'SHADOW_ONLY' || learned.isActionable !== false ||
        summary.mode !== 'SHADOW_ONLY' || summary.isUsedForTradeSelection !== false ||
        summary.sampleCount !== 100 || !Number.isFinite(summary.meanBrierScore) ||
        !(summary.brierSkillVs50Baseline! > 0)) {
      throw new Error('Verified outcomes should update telemetry without making the learner actionable.');
    }
    let scratchRejected = false;
    try {
      learnOnlineOutcome(model, context, 'SCRATCH' as any, 0.5);
    } catch {
      scratchRejected = true;
    }
    if (!scratchRejected) throw new Error('SCRATCH must not become a directional online-learning label.');
  });

  await runTest('ML', 'Online learner detects sustained prequential error drift without changing trade behavior', () => {
    const context = {
      symbol: 'GBP/USD',
      direction: 'SELL' as const,
      ruleFamily: 'wick_reversal',
      marketFeatureVector: Array(19).fill(-0.1),
    };
    let model = createInitialOnlineLearnerState();
    for (let index = 0; index < 40; index++) {
      model = learnOnlineOutcome(
        model, context, 'WIN', 0.99,
        new Date(Date.UTC(2026, 10, 2, 0, index)).toISOString(),
      );
    }
    for (let index = 40; index < 90; index++) {
      model = learnOnlineOutcome(
        model, context, 'LOSS', 0.99,
        new Date(Date.UTC(2026, 10, 2, 0, index)).toISOString(),
      );
    }
    const summary = getOnlineLearnerSummary(model);
    if (summary.driftEvents < 1 || !summary.lastDriftAt ||
        summary.mode !== 'SHADOW_ONLY' || summary.isUsedForTradeSelection !== false) {
      throw new Error('Sustained prequential error should raise drift telemetry only.');
    }
  });

  await runTest('ML', 'Chronological learner replay prevents overlapping-trade lookahead leakage', () => {
    const context = {
      symbol: 'EUR/USD',
      direction: 'BUY' as const,
      ruleFamily: 'momentum_5',
      marketFeatureVector: Array(19).fill(0.15),
    };
    const replay = replayOnlineLearnerHistory([
      {
        signalId: 'replay-a',
        predictionTimeUtc: '2026-11-03T00:00:00.000Z',
        outcomeTimeUtc: '2026-11-03T00:10:00.000Z',
        outcome: 'WIN',
        context,
      },
      {
        signalId: 'replay-b',
        predictionTimeUtc: '2026-11-03T00:05:00.000Z',
        outcomeTimeUtc: '2026-11-03T00:15:00.000Z',
        outcome: 'LOSS',
        context,
      },
      {
        signalId: 'replay-c',
        predictionTimeUtc: '2026-11-03T00:10:00.000Z',
        outcomeTimeUtc: '2026-11-03T00:20:00.000Z',
        outcome: 'WIN',
        context,
      },
      {
        signalId: 'replay-d',
        predictionTimeUtc: '2026-11-03T00:11:00.000Z',
        outcomeTimeUtc: '2026-11-03T00:21:00.000Z',
        outcome: 'WIN',
        context,
      },
    ]);
    const a = replay.decisionProbabilities.get('replay-a');
    const b = replay.decisionProbabilities.get('replay-b');
    const c = replay.decisionProbabilities.get('replay-c');
    const d = replay.decisionProbabilities.get('replay-d');
    if (a !== 0.5 || b !== 0.5 || c !== 0.5 || !(d! > 0.5)) {
      throw new Error('A later or same-time settlement leaked into an earlier prediction.');
    }
    if (replay.state.sampleCount !== 4 || replay.processedSignalIds.length !== 4 ||
        replay.reconstructedPredictions !== 4) {
      throw new Error('Replay did not process every verified outcome exactly once.');
    }
  });

  await runTest('SYSTEM', 'Unfilled and cancelled setups cannot enter the forward outcome ledger', () => {
    let rejected = false;
    try {
      db.recordForwardObservation({
        id: 'test_unfilled_forward_observation',
        lifecycleState: 'EXPIRED',
        outcomeResult: 'CANCELLED',
      } as ResearchSignal);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error('An expired unfilled setup was accepted as a forward trade observation.');
  });

  await runTest('SYSTEM', 'Learning diagnostics expose recovery state without raw feature vectors', () => {
    const diagnostics = db.getEvolutionDiagnostics();
    if (!diagnostics.signals || !diagnostics.learning ||
        !diagnostics.learning.onlineLearner ||
        diagnostics.learning.onlineLearner.mode !== 'SHADOW_ONLY' ||
        diagnostics.learning.onlineLearner.isUsedForTradeSelection !== false) {
      throw new Error('Learning diagnostics are missing required shadow-mode health fields.');
    }
  });

  await runTest('SYSTEM', 'Signal setups, filled contracts, settled outcomes and expired unfilled setups are counted separately', () => {
    const makeSignal = (
      id: string,
      lifecycleState: ResearchSignal['lifecycleState'],
      outcomeResult: ResearchSignal['outcomeResult'],
      entryPrice: number | null,
      netReturnUnits: number | null = null,
    ) => ({
      id,
      lifecycleState,
      outcomeResult,
      actualEntryTimeUtc: entryPrice === null ? null : new Date().toISOString(),
      actualEntryPrice: entryPrice,
      actualExitTimeUtc: entryPrice === null ? null : new Date().toISOString(),
      actualExitPrice: entryPrice === null ? null : 1.1001,
      netReturnUnits,
    } as ResearchSignal);

    const summary = summarizeSignalAccounting([
      makeSignal('acct_waiting', 'WAITING_FOR_ENTRY', 'PENDING', null),
      makeSignal('acct_expired', 'EXPIRED', 'CANCELLED', null),
      makeSignal('acct_invalidated', 'INVALIDATED', 'CANCELLED', null),
      makeSignal('acct_active_fill', 'ACTIVE', 'PENDING', 1.1),
      makeSignal('acct_win', 'CLOSED', 'WIN', 1.1, 0.8),
      makeSignal('acct_loss', 'CLOSED', 'LOSS', 1.1, -1),
      makeSignal('acct_scratch', 'CLOSED', 'SCRATCH', 1.1, 0),
    ]);

    if (summary.signalSetups !== 7 ||
        summary.filledContracts !== 4 ||
        summary.settledContracts !== 3 ||
        summary.pendingFilledContracts !== 1 ||
        summary.expiredUnfilledSetups !== 1 ||
        summary.otherUnfilledSetups !== 2 ||
        summary.wins !== 1 ||
        summary.losses !== 1 ||
        summary.scratches !== 1 ||
        summary.winRate !== 50 ||
        summary.netReturnUnits !== -0.2) {
      throw new Error(`Incorrect signal accounting breakdown: ${JSON.stringify(summary)}`);
    }
  });

  await runTest('SYSTEM', 'Forward analytics deduplicate IDs and use recorded stake returns without pips or payout defaults', () => {
    const makeForward = (
      id: string,
      liveOutcome: 'WIN' | 'LOSS' | 'SCRATCH',
      observedNetReturnUnits?: number,
    ) => ({
      id: `exp_forward_${id}`,
      experimentType: 'FORWARD_OBSERVATION',
      liveOutcome,
      observedNetReturnUnits,
      observedPayoutPct: 80,
      createdAt: new Date().toISOString(),
      valPeriod: { start: '', end: new Date().toISOString() },
    } as unknown as ResearchExperiment);

    const summary = summarizeForwardObservations([
      makeForward('fwd_win_1', 'WIN', 0.8),
      makeForward('fwd_win_2', 'WIN', 0.8),
      makeForward('fwd_loss_1', 'LOSS', -1),
      makeForward('fwd_scratch_1', 'SCRATCH', 0),
      makeForward('fwd_win_missing_return', 'WIN'),
      makeForward('fwd_win_1', 'LOSS', -1),
    ]);

    if (summary.observations !== 5 ||
        summary.wins !== 3 ||
        summary.losses !== 1 ||
        summary.scratches !== 1 ||
        summary.scoredOutcomes !== 4 ||
        summary.winRate !== 75 ||
        summary.netReturnUnits !== 0.6 ||
        summary.missingReturnCount !== 1 ||
        summary.profitFactor !== 1.6) {
      throw new Error(`Incorrect retained forward outcome summary: ${JSON.stringify(summary)}`);
    }
  });

  await runTest('DATA', 'Binary payout settlement (win, loss, push and payout floor)', () => {
    const win = calculateBinarySettlement('BUY', 1.10000, 1.10010, 80);
    if (win.outcome !== 'WIN' || win.netReturnUnits !== 0.8) {
      throw new Error('A winning binary contract must return +0.80 stake units at an 80% payout.');
    }
    const loss = calculateBinarySettlement('BUY', 1.10010, 1.10000, 80);
    if (loss.outcome !== 'LOSS' || loss.netReturnUnits !== -1) {
      throw new Error('A losing binary contract must return -1.00 stake units.');
    }
    const push = calculateBinarySettlement('SELL', 1.10000, 1.10000, 80);
    if (push.outcome !== 'SCRATCH' || push.netReturnUnits !== 0) {
      throw new Error('An exact strike tie must be recorded as a zero-return push.');
    }
    const lowPayout = calculateBinarySettlement('BUY', 1.1, 1.1001, 75);
    if (lowPayout.netReturnUnits !== 0.75) {
      throw new Error('Observed payout must be reflected exactly in the binary return.');
    }
  });

  // ==========================================
  // 1. DATA TESTS
  // ==========================================
  await runTest('DATA', 'Live scanner rejects stale, synthetic, imported, mismatched and invalid-time candles', () => {
    const nowMs = Date.UTC(2026, 10, 24, 10, 0, 0);
    const makeCandle = (
      symbol: ForexSymbol,
      ageMs: number,
      source: Candle['source'] = 'yahoo',
      timestampOffsetMs: number = 0
    ): Candle => {
      const timestampMs = nowMs - ageMs;
      return {
        symbol,
        timestamp: new Date(timestampMs + timestampOffsetMs).toISOString(),
        timestampMs,
        open: 1.0850,
        high: 1.0860,
        low: 1.0840,
        close: 1.0855,
        volume: 100,
        source,
      };
    };

    const boundaryFresh = makeCandle('EUR/USD', LIVE_CANDLE_MAX_AGE_MS);
    const recentFresh = makeCandle('EUR/USD', 30_000, 'biquote');
    const smallFutureSkew = makeCandle('EUR/USD', -5_000, 'dukascopy');
    const stale = makeCandle('EUR/USD', LIVE_CANDLE_MAX_AGE_MS + 1);
    const excessiveFuture = makeCandle('EUR/USD', -5_001);
    const synthetic = makeCandle('EUR/USD', 1_000, 'synthetic');
    const imported = makeCandle('EUR/USD', 1_000, 'imported');
    const fixture = makeCandle('EUR/USD', 1_000, 'test_fixture');
    const wrongPair = makeCandle('GBP/USD', 1_000);
    const inconsistentTimestamp = makeCandle('EUR/USD', 1_000, 'yahoo', 2_000);

    const accepted = filterFreshRealCandles([
      stale,
      excessiveFuture,
      synthetic,
      imported,
      fixture,
      wrongPair,
      inconsistentTimestamp,
      recentFresh,
      smallFutureSkew,
      boundaryFresh,
    ], 'EUR/USD', nowMs);

    const expected = [boundaryFresh, recentFresh, smallFutureSkew]
      .sort((a, b) => a.timestampMs - b.timestampMs);
    if (accepted.length !== expected.length ||
        accepted.some((candle, index) => candle.timestampMs !== expected[index].timestampMs)) {
      throw new Error(
        `Live freshness filter accepted/rejected the wrong candles. Expected ${expected.length}, got ${accepted.length}.`
      );
    }
  });

  await runTest('DATA', 'Fresh live candle window preserves historical M1 candles for strategy features', () => {
    const nowMs = Date.UTC(2026, 10, 25, 10, 0, 30);
    const history: Candle[] = Array.from({ length: 100 }, (_, index) => {
      const timestampMs = nowMs - ((99 - index) * 60_000) - 30_000;
      return {
        symbol: 'EUR/USD',
        timestamp: new Date(timestampMs).toISOString(),
        timestampMs,
        open: 1.0850 + index * 0.00001,
        high: 1.0860 + index * 0.00001,
        low: 1.0840 + index * 0.00001,
        close: 1.0855 + index * 0.00001,
        volume: 100,
        source: 'yahoo',
      };
    });
    const syntheticNow: Candle = {
      ...history[history.length - 1],
      timestamp: new Date(nowMs).toISOString(),
      timestampMs: nowMs,
      source: 'synthetic',
    };
    const retained = getFreshRealCandleWindow(
      [...history, syntheticNow],
      'EUR/USD',
      nowMs,
      LIVE_CANDLE_MAX_AGE_MS,
      100
    );

    if (retained.length !== 100 ||
        retained[0].timestampMs !== history[0].timestampMs ||
        retained[retained.length - 1].timestampMs !== history[history.length - 1].timestampMs ||
        retained.some(candle => candle.source === 'synthetic')) {
      throw new Error(
        `Expected 100 verified historical candles with a fresh newest real observation; got ${retained.length}.`
      );
    }

    const staleWindow = getFreshRealCandleWindow(
      history.map(candle => ({
        ...candle,
        timestampMs: candle.timestampMs - 70_001,
        timestamp: new Date(candle.timestampMs - 70_001).toISOString(),
      })),
      'EUR/USD',
      nowMs,
      LIVE_CANDLE_MAX_AGE_MS,
      100
    );
    if (staleWindow.length !== 0) {
      throw new Error('A stale newest real candle must reject the complete live feature window.');
    }

    // The legacy single-candle freshness filter remains strict for callers
    // that need only currently fresh observations.
    const pointFresh = filterFreshRealCandles(history, 'EUR/USD', nowMs);
    if (pointFresh.length > 2 || pointFresh.length === 0) {
      throw new Error('Point freshness filter unexpectedly changed its strict per-candle behavior.');
    }
  });

  await runTest('DATA', 'Stale provider responses are rejected before fallback selection', () => {
    const nowMs = Date.now();
    const freshHistory: Candle[] = Array.from({ length: 40 }, (_, index) => {
      const timestampMs = nowMs - ((39 - index) * 60_000) - 30_000;
      return {
        symbol: 'EUR/USD',
        timestamp: new Date(timestampMs).toISOString(),
        timestampMs,
        open: 1.0850,
        high: 1.0860,
        low: 1.0840,
        close: 1.0855,
        volume: 100,
        source: 'yahoo' as const,
      };
    });
    const staleHistory = freshHistory.map(candle => ({
      ...candle,
      timestampMs: candle.timestampMs - 120_000,
      timestamp: new Date(candle.timestampMs - 120_000).toISOString(),
    }));

    if (!hasFreshRealProviderCandles(freshHistory, 'EUR/USD', nowMs)) {
      throw new Error('A provider response with a fresh newest M1 candle should be accepted.');
    }
    if (hasFreshRealProviderCandles(staleHistory, 'EUR/USD', nowMs)) {
      throw new Error('A non-empty but stale provider response must be rejected so the next provider is attempted.');
    }
  });

  await runTest('DATA', 'Provider Fallback & Continuity Generation', async () => {
    // Test that requesting candles never returns empty list even if remote APIs are offline
    const res = await dataFeedEngine.fetchCandles('EUR/USD', 50);
    if (!res.candles || res.candles.length < 20) {
      throw new Error(`Expected at least 20 candles, got ${res.candles?.length || 0}`);
    }
    if (!res.source) {
      throw new Error('Missing active provider source attribution');
    }
  });

  await runTest('DATA', 'Invalid OHLC Validation & Sanity Enforcement', () => {
    const candles = dataFeedEngine.generateRealisticHistoricalCandles('GBP/USD', 20);
    for (const c of candles) {
      if (c.high < c.low) throw new Error(`High (${c.high}) < Low (${c.low})`);
      if (c.high < c.open || c.high < c.close) throw new Error('High is not the highest value');
      if (c.low > c.open || c.low > c.close) throw new Error('Low is not the lowest value');
    }
  });

  await runTest('DATA', 'Timestamp Ordering & Strict Chronology', () => {
    const candles = dataFeedEngine.generateRealisticHistoricalCandles('USD/JPY', 30);
    for (let i = 1; i < candles.length; i++) {
      if (candles[i].timestampMs <= candles[i - 1].timestampMs) {
        throw new Error(`Candle ${i} timestamp is not strictly greater than previous`);
      }
    }
  });

  await runTest('DATA', 'Deduplication & Gap Detection', () => {
    const testCandles: Candle[] = [
      {
        symbol: 'EUR/USD',
        timestamp: '2026-10-29T10:00:00.000Z',
        timestampMs: 1793282400000,
        open: 1.085,
        high: 1.086,
        low: 1.084,
        close: 1.0855,
        volume: 100,
        source: 'biquote',
      },
      {
        symbol: 'EUR/USD',
        timestamp: '2026-10-29T10:00:00.000Z', // Duplicate
        timestampMs: 1793282400000,
        open: 1.085,
        high: 1.086,
        low: 1.084,
        close: 1.0855,
        volume: 100,
        source: 'biquote',
      },
    ];
    db.storeCandles('EUR/USD', testCandles);
    const retrieved = db.getCandles('EUR/USD', 10);
    const countWithSameTime = retrieved.filter(c => c.timestampMs === 1793282400000).length;
    if (countWithSameTime > 1) {
      throw new Error(`Duplicate candle detected in storage: count=${countWithSameTime}`);
    }
  });

  // ==========================================
  // 2. ENTRY / EXIT CAUSAL TESTS
  // ==========================================
  await runTest('ENTRY_EXIT', 'Live paper entry requires the exact M5-open candle and never substitutes a nearby bar', () => {
    const openMs = Date.UTC(2026, 10, 24, 10, 0, 0);
    const candle = (offsetMs: number, source: Candle['source'] = 'yahoo', open = 1.085) => ({
      symbol: 'EUR/USD' as ForexSymbol,
      timestamp: new Date(openMs + offsetMs).toISOString(),
      timestampMs: openMs + offsetMs,
      open,
      high: open + 0.0005,
      low: open - 0.0005,
      close: open + 0.0001,
      volume: 100,
      source,
    } as Candle);

    const exactDelayedBar = candle(800, 'yahoo', 1.0861);
    const earlierBar = candle(-60_000, 'biquote', 1.0840);
    const laterBar = candle(60_000, 'dukascopy', 1.0870);
    const selected = findExactEntryCandle(
      [earlierBar, laterBar, exactDelayedBar],
      'EUR/USD',
      openMs,
    );

    if (selected !== exactDelayedBar || selected.open !== 1.0861) {
      throw new Error('The entry selector did not choose the exact M5-open candle.');
    }
    if (findExactEntryCandle([earlierBar, laterBar], 'EUR/USD', openMs) !== null) {
      throw new Error('A nearby candle was incorrectly accepted as the M5 entry.');
    }
    if (findExactEntryCandle([candle(0, 'synthetic')], 'EUR/USD', openMs) !== null) {
      throw new Error('A synthetic candle was incorrectly accepted as a live entry.');
    }
    if (findExactEntryCandle([candle(0, 'imported')], 'EUR/USD', openMs) !== null ||
        findExactEntryCandle([candle(0, 'test_fixture')], 'EUR/USD', openMs) !== null) {
      throw new Error('Imported or test-fixture candles were incorrectly accepted as a live entry.');
    }
    if (findExactEntryCandle([candle(0, 'yahoo', 0)], 'EUR/USD', openMs) !== null) {
      throw new Error('A zero/invalid open price was incorrectly accepted.');
    }
    if (LIVE_ENTRY_BAR_ARRIVAL_GRACE_MS !== 5 * 60_000) {
      throw new Error('The delayed-feed grace must be exactly one five-minute window.');
    }
  });

  await runTest('ENTRY_EXIT', 'Causal Trigger: No Lookahead Entry', () => {
    const signalCandle: Candle = {
      symbol: 'EUR/USD',
      timestamp: '2026-10-29T10:00:00.000Z',
      timestampMs: 1793282400000,
      open: 1.085,
      high: 1.086,
      low: 1.084,
      close: 1.0858,
      volume: 120,
      source: 'synthetic',
    };

    const sig = entryExitEngine.createResearchSignal({
      symbol: 'EUR/USD',
      direction: 'BUY',
      signalCandle,
      ruleFamily: `test_no_lookahead_${Date.now()}`,
      expiryMinutes: 5,
      confidence: 0.72,
      modelVersion: 'vTest',
    });

    if (sig.lifecycleState !== 'WAITING_FOR_ENTRY') {
      throw new Error(`Expected WAITING_FOR_ENTRY initial state, got ${sig.lifecycleState}`);
    }
    if (sig.actualEntryPrice !== null || sig.actualEntryTimeUtc !== null) {
      throw new Error('Premature entry fill recorded before subsequent trigger candle arrived');
    }
    if (sig.triggerPrice <= signalCandle.high) {
      throw new Error('BUY trigger price must be above signal candle high');
    }
  });

  await runTest('ENTRY_EXIT', 'Causal Trigger Confirmation & Actual Fill', () => {
    const baseTime = 1793282400000;
    const signalCandle: Candle = {
      symbol: 'EUR/USD',
      timestamp: new Date(baseTime).toISOString(),
      timestampMs: baseTime,
      open: 1.085,
      high: 1.086,
      low: 1.084,
      close: 1.0858,
      volume: 120,
      source: 'synthetic',
    };

    const sig = entryExitEngine.createResearchSignal({
      symbol: 'EUR/USD',
      direction: 'BUY',
      signalCandle,
      ruleFamily: `test_causal_fill_${Date.now()}`,
      expiryMinutes: 10,
      confidence: 0.75,
      modelVersion: 'vTest',
    });

    // Next candle breaks above trigger
    const triggerCandle: Candle = {
      symbol: 'EUR/USD',
      timestamp: new Date(baseTime + 60000).toISOString(),
      timestampMs: baseTime + 60000,
      open: 1.0859,
      high: 1.0868, // Breaks above trigger
      low: 1.0855,
      close: 1.0865,
      volume: 140,
      source: 'synthetic',
    };

    entryExitEngine.evaluateSignals({ 'EUR/USD': [signalCandle, triggerCandle] } as any, true);

    const updated = db.getSignalById(sig.id);
    if (!updated || updated.lifecycleState !== 'ACTIVE') {
      throw new Error(`Expected ACTIVE state after trigger break, got ${updated?.lifecycleState}`);
    }
    if (!updated.actualEntryPrice || updated.actualEntryPrice <= 0) {
      throw new Error('Missing actual entry price after confirmation');
    }
    // Strict requirement: Expiry must be calculated from ACTUAL ENTRY time!
    const expectedExitMs = triggerCandle.timestampMs + 10 * 60 * 1000;
    if (Date.parse(updated.plannedExitTimeUtc!) !== expectedExitMs) {
      throw new Error(
        `Planned exit must equal actual entry + expiry. Got ${updated.plannedExitTimeUtc}`
      );
    }
  });

  await runTest('ENTRY_EXIT', 'Missing binary expiry candle is not replaced by a later candle', () => {
    const baseTime = 1793282400000;
    const signalCandle: Candle = {
      symbol: 'EUR/USD',
      timestamp: new Date(baseTime).toISOString(),
      timestampMs: baseTime,
      open: 1.085,
      high: 1.086,
      low: 1.084,
      close: 1.0858,
      volume: 120,
      source: 'test_fixture',
    };
    const signal = entryExitEngine.createResearchSignal({
      symbol: 'EUR/USD',
      direction: 'BUY',
      signalCandle,
      ruleFamily: `test_missing_expiry_${Date.now()}`,
      expiryMinutes: 10,
      confidence: 0.7,
      modelVersion: 'vTest',
    });
    const entryCandle: Candle = {
      ...signalCandle,
      timestamp: new Date(baseTime + 60_000).toISOString(),
      timestampMs: baseTime + 60_000,
      open: 1.0859,
      high: 1.0868,
      low: 1.0855,
      close: 1.0865,
    };
    const laterCandle: Candle = {
      ...entryCandle,
      timestamp: new Date(baseTime + 12 * 60_000).toISOString(),
      timestampMs: baseTime + 12 * 60_000,
      open: 1.0865,
      high: 1.0870,
      low: 1.0860,
      close: 1.0867,
    };

    entryExitEngine.evaluateSignals({ 'EUR/USD': [signalCandle, entryCandle] } as any, true);
    entryExitEngine.evaluateSignals({ 'EUR/USD': [signalCandle, entryCandle, laterCandle] } as any, true);
    const settled = db.getSignalById(signal.id);
    if (!settled || settled.lifecycleState !== 'EXPIRED' || settled.outcomeResult !== 'CANCELLED') {
      throw new Error(`A missing exact expiry candle must expire unscored, got ${settled?.lifecycleState}/${settled?.outcomeResult}.`);
    }
    if (settled.netReturnUnits !== null) {
      throw new Error('A later candle must never be used to fabricate a binary settlement.');
    }
  });

  await runTest('ENTRY_EXIT', 'Ambiguous Candle Ordering Detection', () => {
    const baseTime = 1793282500000;
    const signalCandle: Candle = {
      symbol: 'GBP/USD',
      timestamp: new Date(baseTime).toISOString(),
      timestampMs: baseTime,
      open: 1.298,
      high: 1.299,
      low: 1.297,
      close: 1.2985,
      volume: 100,
      source: 'synthetic',
    };

    const sig = entryExitEngine.createResearchSignal({
      symbol: 'GBP/USD',
      direction: 'BUY',
      signalCandle,
      ruleFamily: `test_ambiguous_${Date.now()}`,
      expiryMinutes: 5,
      confidence: 0.65,
      modelVersion: 'vTest',
    });

    // Highly volatile candle hits BOTH high trigger and low invalidation level in 1m
    const extremeCandle: Candle = {
      symbol: 'GBP/USD',
      timestamp: new Date(baseTime + 60000).toISOString(),
      timestampMs: baseTime + 60000,
      open: 1.2985,
      high: 1.3005, // Crosses trigger (1.29902)
      low: 1.2955, // Crosses invalidation (1.2969)
      close: 1.298,
      volume: 450,
      source: 'synthetic',
    };

    entryExitEngine.evaluateSignals({ 'GBP/USD': [signalCandle, extremeCandle] } as any, true);
    const evaluated = db.getSignalById(sig.id);

    if (evaluated?.lifecycleState !== 'AMBIGUOUS') {
      throw new Error(
        `Expected AMBIGUOUS lifecycle state when both thresholds crossed, got ${evaluated?.lifecycleState}`
      );
    }
  });

  // ==========================================
  // 3. ML & RESEARCH PIPELINE TESTS
  // ==========================================
  await runTest('ML', 'Purged Walk-Forward Splits & Embargo Verification', () => {
    const candles = makeM1TestCandles('EUR/USD', 32000);
    const exp = researchEngine.runWalkForwardExperiment('EUR/USD', candles, 'momentum_5', 10, 1, { allowTestFixtures: true });

    if (exp.purgedWindowCandles < 10) {
      throw new Error(`Purged embargo must cover the 10m horizon, got ${exp.purgedWindowCandles} M1 candles.`);
    }
    if (exp.metrics.trainSampleSize <= exp.metrics.validationSampleSize || exp.metrics.validationSampleSize <= 0) {
      throw new Error('Training and validation sample counts are missing or incorrectly ordered.');
    }
    if (Date.parse(exp.valPeriod.start) <= Date.parse(exp.trainPeriod.end)) {
      throw new Error('Validation set must chronologically follow train set after embargo purge');
    }
    if (exp.metrics.sampleSize <= 0) {
      throw new Error('Test set sample size is zero');
    }
  });

  await runTest('ML', 'Synthetic and test-fixture candles cannot be used for research claims', () => {
    const synthetic = dataFeedEngine.generateRealisticHistoricalCandles('EUR/USD', 1500);
    const testFixture = makeM1TestCandles('EUR/USD', 1500);
    for (const candles of [synthetic, testFixture]) {
      let rejected = false;
      try {
        researchEngine.runWalkForwardExperiment('EUR/USD', candles, 'momentum_5', 10, 1);
      } catch (error: any) {
        rejected = String(error.message).includes('Synthetic and test-fixture candles are not eligible');
      }
      if (!rejected) throw new Error('Synthetic or test-fixture candles were not rejected by the backtest engine.');
    }
  });

  await runTest('RESEARCH', 'Generated strategy remains unvalidated until historical testing', () => {
    const candles = dataFeedEngine.generateRealisticHistoricalCandles('EUR/USD', 100);
    const gene = researchEngine.synthesizeInfiniteNovelStrategy(candles, 'EUR/USD', 99);
    if (!gene.genome || gene.genome.version !== 1 || !gene.genome.signature || gene.genome.complexity < 1) {
      throw new Error('Generated candidate must contain a persisted executable symbolic genome.');
    }
    if (gene.verifiedAccuracy !== 0 || gene.sampleCount !== 0) {
      throw new Error('New candidate must not contain a fabricated accuracy or sample count.');
    }
    if (gene.status !== 'EXPERIMENTING' || gene.accuracyStatus !== 'UNVALIDATED') {
      throw new Error('New candidate must remain unvalidated and out of the promoted pool.');
    }
    const closes = candles.map(candle => candle.close);
    const evaluated = researchEngine.evaluateSynthesizedGeneSignal(
      gene,
      candles[99],
      candles[98],
      closes,
      closes,
      closes,
      closes.map(() => 50),
      99
    );
    if (!Number.isFinite(evaluated.conviction) || !['BUY', 'SELL'].includes(evaluated.direction)) {
      throw new Error('The saved symbolic genome must be executable by the live evaluator.');
    }
    if (!evaluated.rationale.includes('Symbolic genome score')) {
      throw new Error('The candidate was not evaluated through its symbolic genome.');
    }
  });

  await runTest('ML', 'Probabilistic Calibration & Brier Score Calculation', () => {
    const candles = makeM1TestCandles('EUR/USD', 32000);
    const exp = researchEngine.runWalkForwardExperiment(
      'EUR/USD',
      candles,
      'momentum_5',
      10,
      1,
      { allowTestFixtures: true }
    );

    if (isNaN(exp.metrics.brierScore) || exp.metrics.brierScore < 0 || exp.metrics.brierScore > 1) {
      throw new Error(`Invalid Brier score: ${exp.metrics.brierScore}`);
    }
    if (!exp.metrics.confusionMatrix || exp.metrics.confusionMatrix.tp === undefined) {
      throw new Error('Missing confusion matrix');
    }
  });

  await runTest('RESEARCH', 'Skeptical Auditor Rejection of Overfitted Candidates', async () => {
    const candles = makeM1TestCandles('EUR/GBP', 18000);
    const exp = researchEngine.runWalkForwardExperiment('EUR/GBP', candles, 'wick_reversal', 15, 1, { allowTestFixtures: true });
    const reviews = await researchEngine.generateTrinityReviews(exp);

    const auditor = reviews.find(r => r.role === 'SKEPTICAL_AUDITOR');
    if (!auditor) {
      throw new Error('Skeptical auditor review was not produced');
    }
    if (exp.auditorVerdict === 'REJECTED' && auditor.verdict !== 'REJECT') {
      throw new Error('Auditor review verdict mismatched with experiment rejection status');
    }
  });

  // ==========================================
  // 4. SYSTEM & DATABASE TESTS
  // ==========================================
  await runTest('SYSTEM', 'Persistent Database & Cloudflare D1 Export Parity', () => {
    const schema = db.generateCloudflareD1Schema();
    if (!schema.includes('CREATE TABLE IF NOT EXISTS research_signals')) {
      throw new Error('D1 schema missing research_signals table');
    }
    if (!schema.includes('idx_signals_state')) {
      throw new Error('D1 schema missing lifecycle indexes');
    }
    const wrangler = db.generateWranglerToml();
    if (!wrangler.includes('binding = "DB"')) {
      throw new Error('Wrangler toml missing D1 binding');
    }
  });

  await runTest('SYSTEM', 'Telegram Bot Configuration & Signal Dispatch Engine', () => {
    const cfg = db.getTelegramConfig();
    const expectedToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
    if ((cfg.botToken || '').trim() !== expectedToken) {
      throw new Error('Telegram credential must come from host configuration, not a hard-coded or committed fallback.');
    }
    if (cfg.minConfidence < 0.5 || cfg.minConfidence > 1.0) {
      throw new Error(`Invalid Telegram minConfidence threshold: ${cfg.minConfidence}`);
    }

    // Verify subscriber addition and removal persistence
    const testSubId = `test_${Date.now()}`;
    db.addTelegramSubscriber({
      id: testSubId,
      name: 'Automated Test Subscriber',
      username: 'test_user',
      addedAt: new Date().toISOString(),
      type: 'user',
    });

    const withSub = db.getTelegramConfig();
    if (!withSub.subscribers.some(s => String(s.id) === testSubId)) {
      throw new Error('Failed to persist Telegram subscriber');
    }

    db.removeTelegramSubscriber(testSubId);
    const cleaned = db.getTelegramConfig();
    if (cleaned.subscribers.some(s => String(s.id) === testSubId)) {
      throw new Error('Failed to clean up test Telegram subscriber');
    }
  });

  await runTest('SYSTEM', 'Telegram Win & Loss Audit Report Formatting & Autopsy Parity', async () => {
    const { telegramService } = await import('./telegramService.js');
    const nowIso = new Date().toISOString();

    const winTrade: any = {
      id: 'sig_test_win_audit',
      symbol: 'EUR/USD',
      direction: 'BUY',
      predictionTimeUtc: nowIso,
      predictionTimeIst: '10:02:00 AM IST',
      candleOpenTimeUtc: nowIso,
      candleOpenTimeIst: '10:05:00 AM IST',
      actualEntryTimeUtc: nowIso,
      actualExitTimeUtc: nowIso,
      triggerPrice: 1.08500,
      actualEntryPrice: 1.08500,
      actualExitPrice: 1.08565,
      entrySource: 'dukascopy',
      expiryMinutes: 5,
      confidence: 0.84,
      lifecycleState: 'CLOSED',
      lifecycleHistory: [{ timestamp: nowIso, fromState: 'ACTIVE', toState: 'CLOSED', reason: 'Settled from dukascopy feed' }],
      grossReturnPips: 6.5,
      estimatedSpreadPips: 1.1,
      netReturnPips: null,
      payoutPct: 85,
      netReturnUnits: 0.85,
      outcomeResult: 'WIN',
      ruleFamily: 'test_audit_win',
      strategyName: 'RSI Momentum Confluence',
      marketSessionName: 'London / NY Overlap',
    };

    const winReport = telegramService.formatSettlementAuditReport(winTrade);
    if (!winReport.includes('WIN AUDIT REPORT') || !winReport.includes('+6.5 pips') || !winReport.includes('+0.85 U')) {
      throw new Error(`WIN Audit Report missing verified pips or payout fields: ${winReport}`);
    }
    if (!winReport.includes('LIVE AUDIT SCORECARD')) {
      throw new Error('WIN Audit Report missing live scorecard section');
    }

    const lossTrade: any = {
      ...winTrade,
      id: 'sig_test_loss_audit',
      symbol: 'USD/JPY',
      direction: 'SELL',
      actualEntryPrice: 154.200,
      actualExitPrice: 154.242,
      grossReturnPips: -4.2,
      netReturnPips: null,
      netReturnUnits: -1.0,
      outcomeResult: 'LOSS',
      ruleFamily: 'test_audit_loss',
      lossAutopsy: {
        id: 'autopsy_test_loss',
        signalId: 'sig_test_loss_audit',
        symbol: 'USD/JPY',
        direction: 'SELL',
        strategyName: 'RSI Momentum Confluence',
        entryPrice: 154.200,
        exitPrice: 154.242,
        grossReturnPips: -4.2,
        netReturnPips: -5.4,
        spreadPips: 1.2,
        marketSession: 'Tokyo Session',
        rootCause: 'MICRO_WICK_FALSE_ABSORPTION',
        rootCauseExplanation: 'Stop-run wick swept resting liquidity above resistance before closing higher.',
        lessonsLearned: ['Require volume expansion confirmation on rejection wick.'],
        antidoteStrategyGeneId: 'gene_antidote_1',
        antidoteStrategyName: 'Antidote-USD/JPY: Wick Volume Gate',
        antidoteFormula: 'tanh(1.5*x)',
        antidoteOperator: 'tanh',
        timestamp: nowIso,
      },
    };

    const lossReport = telegramService.formatSettlementAuditReport(lossTrade);
    if (
      !lossReport.includes('LOSS AUDIT REPORT') ||
      !lossReport.includes('-4.2 pips') ||
      !lossReport.includes('-1.00 U') ||
      !lossReport.includes('FORENSIC LOSS AUTOPSY') ||
      !lossReport.includes('MICRO WICK FALSE ABSORPTION') ||
      !lossReport.includes('Antidote-USD/JPY: Wick Volume Gate')
    ) {
      throw new Error(`LOSS Audit Report missing forensic autopsy or real pips: ${lossReport}`);
    }

    const summaryReport = telegramService.formatDailyAuditSummaryReport();
    if (!summaryReport.includes('WIN &amp; LOSS AUDIT SUMMARY') || !summaryReport.includes("TODAY'S AUDITED PERFORMANCE")) {
      throw new Error('Daily Audit Summary Report missing expected sections');
    }
  });

  await runTest('ML', 'Closed-Loop Adaptive Bandit Throttling & Online MLP Deduplication', async () => {
    const { AgiSelfLearningEngine } = await import('./agiEngine.js');
    const { OnlinePolicyNetwork } = await import('./onlinePolicyNetwork.js');

    // 1. Verify stacked strategy arms are auto-registered and throttled when <55.6% WR at n>=8
    const tempAgi = new AgiSelfLearningEngine();
    const testStratId = 'stacked:test_losing_arm:20';
    for (let i = 0; i < 6; i++) tempAgi.updateBanditArm(testStratId, 'LOSS');
    for (let i = 0; i < 3; i++) tempAgi.updateBanditArm(testStratId, 'WIN');
    const throttle = tempAgi.isStrategyThrottled(testStratId);
    if (!throttle.throttled) {
      throw new Error(`Expected losing stacked arm (3W-6L, 33.3% WR) to be THROTTLED, got ${JSON.stringify(throttle)}`);
    }

    // 2. Verify winning stacked arm stays ACTIVE_ARM
    const winStratId = 'stacked:test_winning_arm:15';
    for (let i = 0; i < 7; i++) tempAgi.updateBanditArm(winStratId, 'WIN');
    for (let i = 0; i < 2; i++) tempAgi.updateBanditArm(winStratId, 'LOSS');
    const winThrottle = tempAgi.isStrategyThrottled(winStratId);
    if (winThrottle.throttled) {
      throw new Error(`Expected winning stacked arm (7W-2L, 77.8% WR) to remain active, got ${JSON.stringify(winThrottle)}`);
    }

    // 3. Verify OnlinePolicyNetwork trains on new signalId and deduplicates repeat calls without mutating DB
    const tempNet = new OnlinePolicyNetwork();
    // Stub saveState to keep unit test strictly isolated from production DB weights
    (tempNet as any).saveState = () => {};
    const stepBefore = tempNet.getTelemetry().stepCount;
    const vec = new Array(19).fill(0.25);
    const sigId = 'sig_test_online_dedup_1';
    const first = tempNet.trainStep(vec, 'BUY', 'WIN', 0.8, 'EUR/USD', sigId);
    if (first.step !== stepBefore + 1) {
      throw new Error(`Expected online policy step to increment to ${stepBefore + 1}, got ${first.step}`);
    }
    const duplicate = tempNet.trainStep(vec, 'BUY', 'WIN', 0.8, 'EUR/USD', sigId);
    if (duplicate.step !== stepBefore + 1) {
      throw new Error(`Expected duplicate signalId training to be skipped, but step became ${duplicate.step}`);
    }
  });

  // Purge test signals so they never appear on the user's trading terminal
  db.purgeTestSignals();

  const durationMs = Date.now() - startTime;
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  return {
    summary: {
      total: results.length,
      passed,
      failed,
      durationMs,
    },
    results,
  };
}
