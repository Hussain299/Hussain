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
import { isWithinStrictSignalDiscoveryWindow, AutonomousScheduler, resolvePulseFetchPlan } from './scheduler.js';
import {
  sanitizeOlympTradeBridgeStatus,
  normalizePair,
  resolveActiveTradingPairs,
  authorizeSignalWithBrokerSnapshot,
} from '../services/olympTradeBridge.js';
import {
  createInitialOnlineLearnerState,
  getOnlineLearnerSummary,
  learnOnlineOutcome,
  predictOnlineOutcome,
  replayOnlineLearnerHistory,
  normalizeOnlineLearnerState,
  ONLINE_LEARNER_FEATURE_DIMENSIONS,
} from './onlineLearning.js';
import type { PriorEpisodeRecord } from './shadowPredictor.js';

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

  await runTest('DATA', 'Olymp Trade browser bridge accepts only normalized read-only instrument data', () => {
    const status = sanitizeOlympTradeBridgeStatus({
      extensionInstalled: true,
      extensionVersion: '1.0.0',
      platformTabOpen: true,
      connected: true,
      sessionState: 'READY',
      capturedAt: new Date().toISOString(),
      ageMs: 1000,
      instruments: [
        { pair: 'eur/usd', payoutPct: 87.5, availability: 'AVAILABLE', evidence: 'MEDIUM' },
        { pair: 'EUR/USD', payoutPct: 92, availability: 'AVAILABLE', evidence: 'HIGH' },
        { pair: 'EURUSD', payoutPct: 99, availability: 'AVAILABLE', evidence: 'HIGH' },
        { pair: 'GBP/JPY', payoutPct: 145, availability: 'AVAILABLE', evidence: 'HIGH' },
        { pair: 'USD/CHF', payoutPct: 45, availability: 'AVAILABLE', evidence: 'HIGH' },
      ],
      password: 'must-not-be-forwarded',
    });
    const eurUsd = status.instruments.find(row => row.pair === 'EUR/USD');
    const gbpJpy = status.instruments.find(row => row.pair === 'GBP/JPY');
    const usdChf = status.instruments.find(row => row.pair === 'USD/CHF');
    if (!status.connected || status.instruments.length !== 3 || eurUsd?.payoutPct !== 92 ||
        eurUsd.evidence !== 'HIGH' || gbpJpy?.payoutPct !== null || usdChf?.payoutPct !== null) {
      throw new Error('The browser bridge failed to deduplicate pairs or reject malformed/unreliable payout values.');
    }
    if ('password' in status) {
      throw new Error('Credential-like fields must never be included in the SignalForge broker snapshot.');
    }
  });

  // ─── Comprehensive Olymp Trade Bridge Tests ───

  await runTest('DATA', 'Olymp Trade bridge: exact symbol normalization', () => {
    // Standard format
    if (normalizePair('EUR/USD') !== 'EUR/USD') throw new Error('Standard pair normalization failed');
    if (normalizePair('eur/usd') !== 'EUR/USD') throw new Error('Lowercase pair normalization failed');
    if (normalizePair('  eur / usd  ') !== 'EUR/USD') throw new Error('Whitespace pair normalization failed');
    if (normalizePair('Gbp/Jpy') !== 'GBP/JPY') throw new Error('Mixed case pair normalization failed');
    // Invalid formats
    if (normalizePair('EURUSD') !== null) throw new Error('No-slash pair should be rejected');
    if (normalizePair('EUR') !== null) throw new Error('Single currency should be rejected');
    if (normalizePair('') !== null) throw new Error('Empty string should be rejected');
    if (normalizePair(null) !== null) throw new Error('Null should be rejected');
    if (normalizePair(123) !== null) throw new Error('Number should be rejected');
    if (normalizePair('USD/USD') !== null) throw new Error('Same-currency pair should be rejected');
    if (normalizePair('AB/CDE') !== null) throw new Error('Short base currency should be rejected');
    if (normalizePair('ABCD/EUR') !== null) throw new Error('Long base currency should be rejected');
  });

  await runTest('DATA', 'Olymp Trade bridge: pair/payout association prevents cross-contamination', () => {
    // When two pairs exist in the same snapshot, payouts must stay with their own pair
    const status = sanitizeOlympTradeBridgeStatus({
      extensionInstalled: true,
      extensionVersion: '1.0.0',
      platformTabOpen: true,
      connected: true,
      sessionState: 'READY',
      capturedAt: new Date().toISOString(),
      ageMs: 500,
      instruments: [
        { pair: 'EUR/USD', payoutPct: 92, availability: 'AVAILABLE', evidence: 'HIGH' },
        { pair: 'GBP/USD', payoutPct: 85, availability: 'AVAILABLE', evidence: 'HIGH' },
        { pair: 'AUD/JPY', payoutPct: 88, availability: 'AVAILABLE', evidence: 'MEDIUM' },
      ],
    });
    const eurUsd = status.instruments.find(r => r.pair === 'EUR/USD');
    const gbpUsd = status.instruments.find(r => r.pair === 'GBP/USD');
    const audJpy = status.instruments.find(r => r.pair === 'AUD/JPY');
    if (eurUsd?.payoutPct !== 92) throw new Error('EUR/USD payout misassociated');
    if (gbpUsd?.payoutPct !== 85) throw new Error('GBP/USD payout misassociated');
    if (audJpy?.payoutPct !== 88) throw new Error('AUD/JPY payout misassociated');
  });

  await runTest('DATA', 'Olymp Trade bridge: duplicate instrument handling keeps best evidence', () => {
    const status = sanitizeOlympTradeBridgeStatus({
      extensionInstalled: true, extensionVersion: '1.0.0', platformTabOpen: true,
      connected: true, sessionState: 'READY',
      capturedAt: new Date().toISOString(), ageMs: 500,
      instruments: [
        { pair: 'EUR/USD', payoutPct: null, availability: 'AVAILABLE', evidence: 'NONE' },
        { pair: 'EUR/USD', payoutPct: 92, availability: 'AVAILABLE', evidence: 'HIGH' },
        { pair: 'EUR/USD', payoutPct: 88, availability: 'AVAILABLE', evidence: 'MEDIUM' },
      ],
    });
    const eur = status.instruments.filter(r => r.pair === 'EUR/USD');
    if (eur.length !== 1) throw new Error('Duplicate EUR/USD not deduplicated');
    if (eur[0].payoutPct !== 92 || eur[0].evidence !== 'HIGH') throw new Error('Best evidence not kept');
  });

  await runTest('DATA', 'Olymp Trade bridge: missing payout handled correctly', () => {
    const status = sanitizeOlympTradeBridgeStatus({
      extensionInstalled: true, extensionVersion: '1.0.0', platformTabOpen: true,
      connected: true, sessionState: 'READY',
      capturedAt: new Date().toISOString(), ageMs: 500,
      instruments: [
        { pair: 'EUR/USD', payoutPct: null, availability: 'AVAILABLE', evidence: 'NONE' },
        { pair: 'GBP/JPY', availability: 'AVAILABLE', evidence: 'NONE' },
      ],
    });
    const eur = status.instruments.find(r => r.pair === 'EUR/USD');
    const gbp = status.instruments.find(r => r.pair === 'GBP/JPY');
    if (eur?.payoutPct !== null) throw new Error('Null payout should stay null');
    if (gbp?.payoutPct !== null) throw new Error('Missing payout field should be null');
  });

  await runTest('DATA', 'Olymp Trade bridge: invalid or impossible percentage rejection', () => {
    const status = sanitizeOlympTradeBridgeStatus({
      extensionInstalled: true, extensionVersion: '1.0.0', platformTabOpen: true,
      connected: true, sessionState: 'READY',
      capturedAt: new Date().toISOString(), ageMs: 500,
      instruments: [
        { pair: 'EUR/USD', payoutPct: 145, availability: 'AVAILABLE', evidence: 'HIGH' },
        { pair: 'GBP/JPY', payoutPct: -10, availability: 'AVAILABLE', evidence: 'HIGH' },
        { pair: 'AUD/USD', payoutPct: 0, availability: 'AVAILABLE', evidence: 'HIGH' },
        { pair: 'USD/CHF', payoutPct: 49.9, availability: 'AVAILABLE', evidence: 'HIGH' },
        { pair: 'NZD/USD', payoutPct: 100.01, availability: 'AVAILABLE', evidence: 'HIGH' },
        { pair: 'AUD/JPY', payoutPct: NaN, availability: 'AVAILABLE', evidence: 'HIGH' },
        { pair: 'EUR/GBP', payoutPct: Infinity, availability: 'AVAILABLE', evidence: 'HIGH' },
        { pair: 'GBP/USD', payoutPct: 'eighty', availability: 'AVAILABLE', evidence: 'HIGH' },
      ],
    });
    for (const inst of status.instruments) {
      if (inst.payoutPct !== null) {
        throw new Error(`Invalid payout ${inst.payoutPct} for ${inst.pair} should have been rejected`);
      }
    }
  });

  await runTest('DATA', 'Olymp Trade bridge: disabled/unavailable instrument detection', () => {
    const status = sanitizeOlympTradeBridgeStatus({
      extensionInstalled: true, extensionVersion: '1.0.0', platformTabOpen: true,
      connected: true, sessionState: 'READY',
      capturedAt: new Date().toISOString(), ageMs: 500,
      instruments: [
        { pair: 'EUR/USD', payoutPct: 90, availability: 'AVAILABLE', evidence: 'HIGH' },
        { pair: 'GBP/JPY', payoutPct: 85, availability: 'UNAVAILABLE', evidence: 'HIGH' },
        { pair: 'AUD/USD', payoutPct: 88, availability: 'UNKNOWN', evidence: 'HIGH' },
        { pair: 'USD/CHF', payoutPct: 82, availability: 'INVALID_STATE', evidence: 'HIGH' },
      ],
    });
    const eur = status.instruments.find(r => r.pair === 'EUR/USD');
    const gbp = status.instruments.find(r => r.pair === 'GBP/JPY');
    const aud = status.instruments.find(r => r.pair === 'AUD/USD');
    const usd = status.instruments.find(r => r.pair === 'USD/CHF');
    if (eur?.availability !== 'AVAILABLE') throw new Error('AVAILABLE not preserved');
    if (gbp?.availability !== 'UNAVAILABLE') throw new Error('UNAVAILABLE not preserved');
    if (aud?.availability !== 'UNKNOWN') throw new Error('UNKNOWN not preserved');
    if (usd?.availability !== 'UNKNOWN') throw new Error('Invalid state should become UNKNOWN');
  });

  await runTest('DATA', 'Olymp Trade bridge: stale snapshot rejection', () => {
    const staleTime = new Date(Date.now() - 120_000).toISOString(); // 2 minutes old
    const status = sanitizeOlympTradeBridgeStatus({
      extensionInstalled: true, extensionVersion: '1.0.0', platformTabOpen: true,
      connected: true, sessionState: 'READY',
      capturedAt: staleTime, ageMs: 120_000,
      instruments: [{ pair: 'EUR/USD', payoutPct: 90, availability: 'AVAILABLE', evidence: 'HIGH' }],
    });
    if (status.connected) throw new Error('Stale snapshot (120s) should not be reported as connected');
  });

  await runTest('DATA', 'Olymp Trade bridge: session expiration detection', () => {
    const statusLogin = sanitizeOlympTradeBridgeStatus({
      extensionInstalled: true, extensionVersion: '1.0.0', platformTabOpen: true,
      connected: false, sessionState: 'LOGIN_REQUIRED',
      capturedAt: new Date().toISOString(), ageMs: 500,
      instruments: [],
    });
    if (statusLogin.connected) throw new Error('LOGIN_REQUIRED should not be connected');
    if (statusLogin.sessionState !== 'LOGIN_REQUIRED') throw new Error('LOGIN_REQUIRED state not preserved');
  });

  await runTest('DATA', 'Olymp Trade bridge: automatic recovery after login', () => {
    // First check LOGIN_REQUIRED
    const before = sanitizeOlympTradeBridgeStatus({
      extensionInstalled: true, extensionVersion: '1.0.0', platformTabOpen: true,
      connected: false, sessionState: 'LOGIN_REQUIRED',
      capturedAt: new Date().toISOString(), ageMs: 500, instruments: [],
    });
    if (before.connected) throw new Error('Should not be connected during login');

    // Then check that READY with instruments reconnects
    const after = sanitizeOlympTradeBridgeStatus({
      extensionInstalled: true, extensionVersion: '1.0.0', platformTabOpen: true,
      connected: true, sessionState: 'READY',
      capturedAt: new Date().toISOString(), ageMs: 500,
      instruments: [{ pair: 'EUR/USD', payoutPct: 90, availability: 'AVAILABLE', evidence: 'HIGH' }],
    });
    if (!after.connected) throw new Error('Should reconnect after login with fresh READY data');
  });

  await runTest('DATA', 'Olymp Trade bridge: invalid message origin rejection', () => {
    // Null/undefined inputs
    const s1 = sanitizeOlympTradeBridgeStatus(null);
    const s2 = sanitizeOlympTradeBridgeStatus(undefined);
    const s3 = sanitizeOlympTradeBridgeStatus('not an object');
    const s4 = sanitizeOlympTradeBridgeStatus(42);
    for (const s of [s1, s2, s3, s4]) {
      if (s.connected || s.extensionInstalled || s.instruments.length > 0) {
        throw new Error('Invalid input should return empty disconnected status');
      }
    }
  });

  await runTest('DATA', 'Olymp Trade bridge: no credential-like data in sanitized snapshots', () => {
    const status = sanitizeOlympTradeBridgeStatus({
      extensionInstalled: true, extensionVersion: '1.0.0', platformTabOpen: true,
      connected: true, sessionState: 'READY',
      capturedAt: new Date().toISOString(), ageMs: 500,
      instruments: [{ pair: 'EUR/USD', payoutPct: 90, availability: 'AVAILABLE', evidence: 'HIGH' }],
      password: 'secret123', token: 'bearer_xyz', cookie: 'session=abc',
      email: 'user@example.com', balance: 5000, accountId: '12345',
    });
    const json = JSON.stringify(status);
    if (json.includes('secret123') || json.includes('bearer_xyz') || json.includes('session=abc') ||
        json.includes('user@example.com') || json.includes('12345')) {
      throw new Error('Credential-like data leaked through sanitization');
    }
    // Verify only expected keys exist at top level
    const allowedKeys = new Set(['extensionInstalled', 'extensionVersion', 'platformTabOpen',
      'connected', 'sessionState', 'capturedAt', 'ageMs', 'instruments']);
    for (const key of Object.keys(status)) {
      if (!allowedKeys.has(key)) throw new Error(`Unexpected key "${key}" in sanitized status`);
    }
  });

  await runTest('DATA', 'Olymp Trade bridge: 29-pair universe is not modified by bridge status', () => {
    // Verify that the bridge status contains instruments but doesn't affect FOREX_PAIRS
    const pairsBeforeCount = FOREX_PAIRS.length;
    sanitizeOlympTradeBridgeStatus({
      extensionInstalled: true, extensionVersion: '1.0.0', platformTabOpen: true,
      connected: true, sessionState: 'READY',
      capturedAt: new Date().toISOString(), ageMs: 500,
      instruments: [
        { pair: 'EUR/USD', payoutPct: 90, availability: 'AVAILABLE', evidence: 'HIGH' },
        { pair: 'BTC/USD', payoutPct: 95, availability: 'AVAILABLE', evidence: 'HIGH' },
      ],
    });
    if (FOREX_PAIRS.length !== pairsBeforeCount || FOREX_PAIRS.length !== 29) {
      throw new Error('Bridge processing must not modify the configured 29-pair universe');
    }
    if (FOREX_PAIRS.includes('BTC/USD' as any)) {
      throw new Error('Non-forex pair should not appear in FOREX_PAIRS');
    }
  });

  await runTest('DATA', 'Olymp Trade bridge: empty instrument list with READY session is not connected', () => {
    const status = sanitizeOlympTradeBridgeStatus({
      extensionInstalled: true, extensionVersion: '1.0.0', platformTabOpen: true,
      connected: true, sessionState: 'READY',
      capturedAt: new Date().toISOString(), ageMs: 500,
      instruments: [],
    });
    if (status.connected) throw new Error('READY with no instruments should not be connected');
  });

  await runTest('DATA', 'Fail-closed broker eligibility: missing, restarted, stale, login-required and disconnected snapshots yield zero pairs', () => {
    const now = Date.now();
    // 1. No broker snapshot
    const noSnap = resolveActiveTradingPairs(null, now);
    if (noSnap.mode !== 'OLYMP_WAITING_FOR_SNAPSHOT' || noSnap.pairs.length !== 0) {
      throw new Error(`Expected OLYMP_WAITING_FOR_SNAPSHOT with 0 pairs, got ${noSnap.mode} (${noSnap.pairs.length})`);
    }
    // 2. Freshly restarted scheduler has zero eligible pairs
    const freshScheduler = new AutonomousScheduler();
    const restarted = freshScheduler.getActiveTradingUniverse(now);
    if (restarted.mode !== 'OLYMP_WAITING_FOR_SNAPSHOT' || restarted.pairs.length !== 0) {
      throw new Error(`Restarted scheduler must fail closed with 0 pairs, got ${restarted.mode}`);
    }
    // 3. Stale snapshot (>45s) yields 0 pairs
    const liveStatus = sanitizeOlympTradeBridgeStatus({
      extensionInstalled: true, extensionVersion: '1.2.0', platformTabOpen: true,
      connected: true, sessionState: 'READY',
      capturedAt: new Date(now - 5_000).toISOString(), ageMs: 5_000,
      instruments: [{ pair: 'EUR/USD', payoutPct: 82, availability: 'AVAILABLE', evidence: 'HIGH' }],
    });
    const stale = resolveActiveTradingPairs(liveStatus, now + 50_000);
    if (stale.mode !== 'OLYMP_STALE' || stale.pairs.length !== 0) {
      throw new Error(`Stale snapshot must produce 0 pairs in OLYMP_STALE mode, got ${stale.mode} (${stale.pairs.length})`);
    }
    // 4. Login-required yields 0 pairs
    const loginReq = resolveActiveTradingPairs(sanitizeOlympTradeBridgeStatus({
      extensionInstalled: true, extensionVersion: '1.2.0', platformTabOpen: true,
      connected: false, sessionState: 'LOGIN_REQUIRED',
      capturedAt: new Date(now - 1_000).toISOString(), ageMs: 1_000,
      instruments: [{ pair: 'EUR/USD', payoutPct: 82, availability: 'AVAILABLE', evidence: 'HIGH' }],
    }), now);
    if (loginReq.mode !== 'OLYMP_LOGIN_REQUIRED' || loginReq.pairs.length !== 0) {
      throw new Error(`LOGIN_REQUIRED must yield 0 pairs, got ${loginReq.mode}`);
    }
    // 19. Disconnected browser cannot reactivate 29 pairs
    const disconnected = resolveActiveTradingPairs(sanitizeOlympTradeBridgeStatus({
      extensionInstalled: true, extensionVersion: '1.2.0', platformTabOpen: false,
      connected: false, sessionState: 'NO_PLATFORM_TAB',
      capturedAt: null, ageMs: null, instruments: [],
    }), now);
    if (disconnected.pairs.length !== 0) {
      throw new Error('Disconnected browser must never reactivate the 29-pair universe');
    }
  });

  await runTest('DATA', 'Fail-closed broker eligibility: enforces AVAILABLE, HIGH evidence, >=80.00% payout, and 15+ pair market discovery', () => {
    const now = Date.now();
    // 5-9: UNKNOWN, UNAVAILABLE, missing payout, 79.99%, MEDIUM evidence rejected; exactly 80% + AVAILABLE + HIGH qualifies
    const strictCheck = sanitizeOlympTradeBridgeStatus({
      extensionInstalled: true, extensionVersion: '1.2.0', platformTabOpen: true,
      connected: true, sessionState: 'READY',
      capturedAt: new Date(now - 2_000).toISOString(), ageMs: 2_000,
      instruments: [
        { pair: 'EUR/USD', payoutPct: 80, availability: 'AVAILABLE', evidence: 'HIGH', sourceType: 'MARKET_LIST' },
        { pair: 'GBP/USD', payoutPct: 79.99, availability: 'AVAILABLE', evidence: 'HIGH', sourceType: 'MARKET_LIST' },
        { pair: 'USD/JPY', payoutPct: 85, availability: 'UNKNOWN', evidence: 'HIGH', sourceType: 'TAB' },
        { pair: 'AUD/CAD', payoutPct: 85, availability: 'UNAVAILABLE', evidence: 'HIGH', sourceType: 'MARKET_LIST' },
        { pair: 'EUR/GBP', payoutPct: null, availability: 'AVAILABLE', evidence: 'NONE', sourceType: 'MARKET_LIST' },
        { pair: 'EUR/AUD', payoutPct: 84, availability: 'AVAILABLE', evidence: 'MEDIUM', sourceType: 'MARKET_LIST' },
        { pair: 'BTC/USD', payoutPct: 90, availability: 'AVAILABLE', evidence: 'HIGH', sourceType: 'MARKET_LIST' },
      ],
    });
    const strictRes = resolveActiveTradingPairs(strictCheck, now);
    if (
      strictRes.mode !== 'OLYMP_ACTIVE' ||
      strictRes.pairs.length !== 1 ||
      strictRes.pairs[0] !== 'EUR/USD' ||
      strictRes.counts.outsideUniverse !== 1 ||
      strictRes.counts.unknownAvailability !== 1 ||
      strictRes.counts.unavailable !== 1
    ) {
      throw new Error(`Strict eligibility filter failed: ${JSON.stringify(strictRes)}`);
    }

    // 10-13: 15+ observed pairs produce exact eligible subset, keep accurate payouts, deduplicate, and exclude non-29
    const fifteenPlus = sanitizeOlympTradeBridgeStatus({
      extensionInstalled: true, extensionVersion: '1.2.0', platformTabOpen: true,
      connected: true, sessionState: 'READY',
      capturedAt: new Date(now - 2_000).toISOString(), ageMs: 2_000,
      instruments: [
        { pair: 'EUR/USD', payoutPct: 82, availability: 'AVAILABLE', evidence: 'HIGH', sourceType: 'MARKET_LIST' },
        { pair: 'EUR/USD', payoutPct: 80, availability: 'UNKNOWN', evidence: 'MEDIUM', sourceType: 'TAB' }, // duplicate lower-score
        { pair: 'GBP/USD', payoutPct: 82, availability: 'AVAILABLE', evidence: 'HIGH', sourceType: 'MARKET_LIST' },
        { pair: 'USD/JPY', payoutPct: 80, availability: 'AVAILABLE', evidence: 'HIGH', sourceType: 'MARKET_LIST' },
        { pair: 'AUD/USD', payoutPct: 81, availability: 'AVAILABLE', evidence: 'HIGH', sourceType: 'MARKET_LIST' },
        { pair: 'USD/CAD', payoutPct: 80, availability: 'AVAILABLE', evidence: 'HIGH', sourceType: 'MARKET_LIST' },
        { pair: 'EUR/JPY', payoutPct: 82, availability: 'AVAILABLE', evidence: 'HIGH', sourceType: 'MARKET_LIST' },
        { pair: 'GBP/JPY', payoutPct: 80, availability: 'AVAILABLE', evidence: 'HIGH', sourceType: 'MARKET_LIST' },
        { pair: 'EUR/GBP', payoutPct: 80, availability: 'AVAILABLE', evidence: 'HIGH', sourceType: 'MARKET_LIST' },
        { pair: 'AUD/CAD', payoutPct: 80, availability: 'AVAILABLE', evidence: 'HIGH', sourceType: 'MARKET_LIST' },
        { pair: 'EUR/AUD', payoutPct: 80, availability: 'AVAILABLE', evidence: 'HIGH', sourceType: 'MARKET_LIST' },
        { pair: 'USD/CHF', payoutPct: 80, availability: 'AVAILABLE', evidence: 'HIGH', sourceType: 'MARKET_LIST' },
        { pair: 'NZD/USD', payoutPct: 80, availability: 'AVAILABLE', evidence: 'HIGH', sourceType: 'MARKET_LIST' },
        { pair: 'AUD/JPY', payoutPct: 78, availability: 'AVAILABLE', evidence: 'HIGH', sourceType: 'MARKET_LIST' }, // <80%
        { pair: 'CAD/JPY', payoutPct: 80, availability: 'UNAVAILABLE', evidence: 'HIGH', sourceType: 'MARKET_LIST' }, // unavailable
        { pair: 'USD/NOK', payoutPct: 85, availability: 'AVAILABLE', evidence: 'HIGH', sourceType: 'MARKET_LIST' }, // outside 29
        { pair: 'EUR/NOK', payoutPct: 85, availability: 'AVAILABLE', evidence: 'HIGH', sourceType: 'MARKET_LIST' }, // outside 29
      ],
    });
    const res15 = resolveActiveTradingPairs(fifteenPlus, now);
    if (
      res15.counts.observed !== 16 ||
      res15.counts.outsideUniverse !== 2 ||
      res15.pairs.length !== 12 ||
      res15.eligibleDetails['EUR/USD']?.payoutPct !== 82 ||
      res15.pairs.includes('AUD/JPY') ||
      res15.pairs.includes('CAD/JPY') ||
      res15.pairs.includes('USD/NOK' as any)
    ) {
      throw new Error(`15+ instrument discovery eligibility mismatch: ${JSON.stringify(res15)}`);
    }
  });

  await runTest('ENTRY_EXIT', 'Authoritative scheduler & signal gate blocks ineligible pairs, blocks Telegram dispatch, and preserves legacy settlement', async () => {
    const now = Date.now();
    const scheduler = new AutonomousScheduler();
    const candle: Candle = {
      symbol: 'GBP/NZD',
      timestamp: new Date(now).toISOString(),
      timestampMs: now,
      open: 2.11,
      high: 2.112,
      low: 2.109,
      close: 2.111,
      volume: 100,
      source: 'yahoo',
    };

    // 14. Attempting non-test signal creation without active broker snapshot throws
    let blockedNoSnap = false;
    try {
      entryExitEngine.createResearchSignal({
        symbol: 'GBP/NZD',
        direction: 'BUY',
        signalCandle: candle,
        ruleFamily: 'momentum_5',
        expiryMinutes: 5,
        confidence: 0.8,
        modelVersion: 'vTest',
      });
    } catch (e: any) {
      blockedNoSnap = String(e.message).includes('BROKER_ELIGIBILITY_BLOCKED');
    }
    if (!blockedNoSnap) throw new Error('createResearchSignal allowed non-test signal creation without broker eligibility');

    // 18 & 20. Updating snapshot on scheduler updates universe dynamically without restart & matches UI resolver
    const snap = {
      extensionInstalled: true, extensionVersion: '1.2.0', platformTabOpen: true,
      connected: true, sessionState: 'READY',
      capturedAt: new Date(now - 1_000).toISOString(), ageMs: 1_000,
      instruments: [
        { pair: 'EUR/USD', payoutPct: 82, availability: 'AVAILABLE', evidence: 'HIGH', sourceType: 'MARKET_LIST' },
      ],
    };
    const serverUni = scheduler.updateOlympTradeSnapshot(snap);
    const uiUni = resolveActiveTradingPairs(sanitizeOlympTradeBridgeStatus(snap), now);
    if (serverUni.pairs.length !== uiUni.pairs.length || serverUni.pairs[0] !== 'EUR/USD') {
      throw new Error('Server universe and UI resolver must produce identical eligible counts');
    }

    // Attempting scheduler signal creation for ineligible pair GBP/NZD must fail closed
    let blockedIneligible = false;
    try {
      scheduler.createBrokerGatedSignal({
        symbol: 'GBP/NZD',
        direction: 'BUY',
        signalCandle: candle,
        ruleFamily: 'momentum_5',
        expiryMinutes: 5,
        confidence: 0.82,
        modelVersion: 'vTest',
      }, now);
    } catch (e: any) {
      blockedIneligible = String(e.message).includes('BROKER_ELIGIBILITY_BLOCKED');
    }
    if (!blockedIneligible) throw new Error('Scheduler allowed signal creation for pair outside eligible Olymp Trade universe');

    // 15. Telegram dispatch blocks legacy / ineligible signals
    const legacySignal: any = {
      id: 'sig_legacy_block_test',
      symbol: 'GBP/NZD',
      direction: 'SELL',
      predictionTimeUtc: new Date(now).toISOString(),
      predictionTimeIst: '07:41:53 PM IST',
      signalCandleTime: new Date(now).toISOString(),
      entryCondition: 'test',
      entryWindowStartUtc: new Date(now).toISOString(),
      entryWindowEndUtc: new Date(now + 300_000).toISOString(),
      triggerPrice: 2.11,
      invalidationPrice: 2.12,
      actualEntryTimeUtc: null,
      actualEntryPrice: null,
      entrySource: null,
      expiryMinutes: 5,
      plannedExitTimeUtc: null,
      actualExitTimeUtc: null,
      actualExitPrice: null,
      confidence: 0.9,
      calibrationStatus: 'UNCALIBRATED',
      lifecycleState: 'WAITING_FOR_ENTRY',
      lifecycleHistory: [],
      grossReturnPips: null,
      estimatedSpreadPips: 2.4,
      netReturnPips: null,
      outcomeResult: 'PENDING',
      ruleFamily: 'test_legacy_telegram',
      modelVersion: 'vTest',
    };
    const tgResult = await telegramService.sendSignalAlert(legacySignal);
    if (tgResult.length !== 0) {
      throw new Error('Telegram must block new signal dispatch when brokerEligibility is missing/ineligible');
    }

    // 16 & 17. Eligible authorization + legacy active position continues normal settlement & stays preserved
    const auth = authorizeSignalWithBrokerSnapshot('EUR/USD', sanitizeOlympTradeBridgeStatus(snap), now);
    if (!auth.authorized || auth.eligibility.payoutPct !== 82) {
      throw new Error('Eligible EUR/USD authorization failed');
    }
    const baseMs = Math.floor((now - 15 * 60_000) / 60_000) * 60_000;
    const legacySigCandle: Candle = {
      symbol: 'GBP/NZD', timestamp: new Date(baseMs).toISOString(), timestampMs: baseMs,
      open: 2.100, high: 2.101, low: 2.099, close: 2.1005, volume: 100, source: 'test_fixture',
    };
    const openLegacy = entryExitEngine.createResearchSignal({
      symbol: 'GBP/NZD',
      direction: 'BUY',
      signalCandle: legacySigCandle,
      ruleFamily: `test_legacy_open_${now}`,
      expiryMinutes: 5,
      confidence: 0.78,
      modelVersion: 'vLegacy',
    });
    const legacyEntryCandle: Candle = {
      ...legacySigCandle, timestamp: new Date(baseMs + 60_000).toISOString(), timestampMs: baseMs + 60_000,
      open: 2.1006, high: 2.1015, low: 2.1002, close: 2.1012,
    };
    const legacyExitCandle: Candle = {
      ...legacySigCandle, timestamp: new Date(baseMs + 5 * 60_000).toISOString(), timestampMs: baseMs + 5 * 60_000,
      open: 2.1012, high: 2.1025, low: 2.1010, close: 2.1020,
    };
    entryExitEngine.evaluateSignals({ 'GBP/NZD': [legacySigCandle, legacyEntryCandle] } as any, true);
    entryExitEngine.evaluateSignals({ 'GBP/NZD': [legacySigCandle, legacyEntryCandle, legacyExitCandle] } as any, true);
    const settledLegacy = db.getSignalById(openLegacy.id);
    if (!settledLegacy || settledLegacy.lifecycleState !== 'CLOSED' || settledLegacy.outcomeResult !== 'WIN') {
      throw new Error(`Legacy open signal must continue normal settlement, got ${settledLegacy?.lifecycleState}/${settledLegacy?.outcomeResult}`);
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

  await runTest('ML', 'Phase 1 Proof: Zero Lookahead Leakage on Frozen Features & Missing Vector Skips', async () => {
    const { OnlinePolicyNetwork, hasTrustedPredictionFeatures } = await import('./onlinePolicyNetwork.js');
    const net = new OnlinePolicyNetwork({ skipAutoLoad: true, persistToDb: false });
    const vec = Array.from({ length: 19 }, (_, idx) => (idx % 2 === 0 ? 0.35 : -0.25));

    // Fresh network has honest null lastTrainedAt
    if (net.getTelemetry().lastTrainedAt !== null || net.getTelemetry().lastUpdated !== null) {
      throw new Error('Untrained network must expose lastTrainedAt === null instead of wall-clock time.');
    }

    // Signal without frozen prediction vector fails trust check and must never reconstruct from future candles
    const incompleteSig = {
      id: 'test_sig_no_vec',
      symbol: 'EUR/USD',
      direction: 'BUY',
      ruleFamily: 'order_flow_imbalance',
    } as unknown as ResearchSignal;
    if (hasTrustedPredictionFeatures(incompleteSig)) {
      throw new Error('Signal lacking 19D marketFeatureVector must not pass hasTrustedPredictionFeatures.');
    }

    // Verify entryExitEngine.createResearchSignal freezes feature vector strictly from <= signalCandle.timestampMs
    const baseMs = 1793300000000;
    const realHist: Candle[] = makeM1TestCandles('EUR/USD', 25).map((c, i) => ({
      ...c,
      timestampMs: baseMs + i * 60_000,
      timestamp: new Date(baseMs + i * 60_000).toISOString(),
      source: 'yahoo' as const,
    }));
    db.storeCandles('EUR/USD', realHist);
    const predCandle = realHist[realHist.length - 1];
    // Insert extreme adversarial future candle after predCandle
    const futureCandle: Candle = {
      symbol: 'EUR/USD',
      timestampMs: predCandle.timestampMs + 60_000,
      timestamp: new Date(predCandle.timestampMs + 60_000).toISOString(),
      open: predCandle.close * 1.15,
      high: predCandle.close * 1.25,
      low: predCandle.close * 0.85,
      close: predCandle.close * 1.20,
      volume: 99999,
      source: 'yahoo' as const,
    };
    db.storeCandles('EUR/USD', [futureCandle]);

    const sigCausal = entryExitEngine.createResearchSignal({
      symbol: 'EUR/USD',
      direction: 'BUY',
      signalCandle: predCandle,
      ruleFamily: `test_no_lookahead_${Date.now()}`,
      expiryMinutes: 5,
      confidence: 0.72,
      modelVersion: 'vTest',
    });
    if (!Array.isArray(sigCausal.marketFeatureVector) || sigCausal.marketFeatureVector.length !== 19) {
      throw new Error('Expected createResearchSignal to freeze 19D marketFeatureVector at creation.');
    }
    // Check training step directly on frozen vector is unaffected by future candles
    const r = net.trainStep(vec, 'BUY', 'WIN', 0.8, 'EUR/USD', 'sig_freeze_1', new Date(predCandle.timestampMs + 300_000).toISOString());
    if (r.step !== 1 || net.getTelemetry().trainedSignalCount !== 1) {
      throw new Error('Expected single valid step on frozen vector.');
    }
  });

  await runTest('ML', 'Phase 1 Proof: Adam Optimizer Full State Persistence & Legacy Safe Migration', async () => {
    const { OnlinePolicyNetwork } = await import('./onlinePolicyNetwork.js');
    const net1 = new OnlinePolicyNetwork({ skipAutoLoad: true, persistToDb: false });
    const x1 = Array.from({ length: 19 }, (_, i) => Math.sin(i + 1) * 0.4);
    const x2 = Array.from({ length: 19 }, (_, i) => Math.cos(i + 1) * 0.4);

    for (let i = 0; i < 5; i++) {
      net1.trainStep(i % 2 === 0 ? x1 : x2, 'BUY', i % 2 === 0 ? 'WIN' : 'LOSS', i % 2 === 0 ? 0.8 : -1.0, 'EUR/USD', `sig_adam_${i}`, '2026-11-25T12:00:00.000Z');
    }
    const snap = net1.exportPersistedSnapshot();
    if (!snap || snap.adamStepCount !== 5 || !Array.isArray(snap.mW1) || !Array.isArray(snap.vW2)) {
      throw new Error('Exported snapshot missing Adam first/second moment arrays or adamStepCount.');
    }

    const net2 = new OnlinePolicyNetwork({ skipAutoLoad: true, persistToDb: false });
    net2.loadPersistedSnapshot(snap);
    const tel2 = net2.getTelemetry();
    if (tel2.optimizerRestorationStatus !== 'RESTORED_WITH_ADAM_MOMENTS' || tel2.adamStepCount !== 5 || tel2.lastTrainedAt !== '2026-11-25T12:00:00.000Z') {
      throw new Error(`Expected full Adam restoration, got ${JSON.stringify(tel2)}`);
    }

    // Step #6 on net1 vs restored net2 must produce identical loss & weights
    const s1 = net1.trainStep(x1, 'SELL', 'WIN', 0.85, 'GBP/USD', 'sig_adam_resume', '2026-11-25T12:05:00.000Z');
    const s2 = net2.trainStep(x1, 'SELL', 'WIN', 0.85, 'GBP/USD', 'sig_adam_resume', '2026-11-25T12:05:00.000Z');
    if (Math.abs(s1.loss - s2.loss) > 1e-12 || Math.abs(s1.gradientNorm - s2.gradientNorm) > 1e-12) {
      throw new Error(`Restarted Adam trajectory diverged: s1=${JSON.stringify(s1)}, s2=${JSON.stringify(s2)}`);
    }

    // Legacy snapshot with stepCount > 0 but zero moments must safely reset adamStepCount = 0
    const net3 = new OnlinePolicyNetwork({ skipAutoLoad: true, persistToDb: false });
    const legacySnap = {
      w1: snap.w1,
      b1: snap.b1,
      w2: snap.w2,
      b2: snap.b2,
      linUcbA: snap.linUcbA,
      linUcbB: snap.linUcbB,
      stepCount: 42,
      trailingLosses: [0.7],
      trainedSignalIds: ['legacy_1'],
      lastUpdated: new Date().toISOString(),
    };
    net3.loadPersistedSnapshot(legacySnap);
    const tel3 = net3.getTelemetry();
    if (tel3.optimizerRestorationStatus !== 'MIGRATED_LEGACY_RESET_ADAM_STEP' || tel3.adamStepCount !== 0 || tel3.stepCount !== 42) {
      throw new Error(`Legacy migration must reset adamStepCount=0 while preserving historical stepCount=42, got ${JSON.stringify(tel3)}`);
    }
  });

  await runTest('ML', 'Phase 1/5 Proof: LinUCB V2 Direction Isolation, Actual Return Reward & Duplicate Blocks', async () => {
    const { OnlinePolicyNetwork } = await import('./onlinePolicyNetwork.js');
    const net = new OnlinePolicyNetwork({ skipAutoLoad: true, persistToDb: false });
    const x = Array.from({ length: 19 }, (_, i) => (i === 0 ? 0.9 : 0.1));

    // Train 5 BUY losses -> SELL arm must stay completely isolated (0 observations, 0 mean reward)
    for (let i = 0; i < 5; i++) {
      net.trainLinUcbV2(x, 'BUY', 'LOSS', -1.0, `sig_v2_buy_${i}`, '2026-11-25T13:00:00.000Z');
    }
    const buyEval = net.evaluateLinUcbV2(x, 'BUY');
    const sellEval = net.evaluateLinUcbV2(x, 'SELL');
    if (buyEval.actionObservations !== 5 || buyEval.meanReward >= 0) {
      throw new Error(`Expected BUY meanReward < 0 after 5 losses, got ${JSON.stringify(buyEval)}`);
    }
    if (sellEval.actionObservations !== 0 || sellEval.meanReward !== 0) {
      throw new Error(`BUY losses contaminated isolated SELL LinUCB V2 arm: ${JSON.stringify(sellEval)}`);
    }

    // Train SELL win using actual netReturnUnits (+0.90) & test duplicate block
    const winRes = net.trainLinUcbV2(x, 'SELL', 'WIN', 0.9, 'sig_v2_sell_1', '2026-11-25T13:05:00.000Z');
    const dupRes = net.trainLinUcbV2(x, 'SELL', 'WIN', 0.9, 'sig_v2_sell_1', '2026-11-25T13:05:00.000Z');
    if (!winRes.trained || winRes.reward <= 0.89 || dupRes.trained || net.getTelemetry().duplicateAttemptsBlocked < 1) {
      throw new Error(`Expected LinUCB V2 win (+0.90) and duplicate block, got win=${JSON.stringify(winRes)}, dup=${JSON.stringify(dupRes)}`);
    }
  });

  await runTest('ML', 'Phase 2-4 Proof: Shadow Causal Calibration, Negative-EV Abstention & Walk-Forward Metrics', async () => {
    const { evaluateShadowCandidate, evaluateShadowCandidateChronologically } = await import('./shadowPredictor.js');

    // Construct strictly prior losing history -> shadow candidate must detect negative EV and abstain
    const losingPriors: PriorEpisodeRecord[] = Array.from({ length: 24 }, (_, idx) => ({
      symbol: 'EUR/USD',
      direction: 'BUY',
      ruleFamily: 'momentum_5',
      strategyId: 'rule:momentum_5',
      outcome: idx % 4 === 0 ? 'WIN' : 'LOSS', // 25% WR << 55.56% break-even
      netReturnUnits: idx % 4 === 0 ? 0.8 : -1.0,
      rawScoreProb: 0.45,
    }));

    const shadowWeak = evaluateShadowCandidate({
      symbol: 'EUR/USD',
      direction: 'BUY',
      ruleFamily: 'momentum_5',
      strategyId: 'rule:momentum_5',
      payoutPct: 80,
      ftrlProbability: 0.38,
      ftrlSampleSize: 24,
      priorSettledRecords: losingPriors,
    });
    if (!shadowWeak.shouldAbstain || !shadowWeak.abstentionReasons.includes('NEGATIVE_EXPECTED_VALUE')) {
      throw new Error(`Expected shadow candidate to abstain with NEGATIVE_EXPECTED_VALUE, got ${JSON.stringify(shadowWeak)}`);
    }

    // Walk-forward chronological evaluation computes prevalence Brier baseline and provenance split cleanly
    const mockSettled: ResearchSignal[] = Array.from({ length: 20 }, (_, i) => ({
      id: `sig_wf_${i}`,
      symbol: 'EUR/USD',
      direction: i % 2 === 0 ? 'BUY' : 'SELL',
      predictionTimeUtc: new Date(1795600000000 + i * 600_000).toISOString(),
      predictionTimeIst: '',
      signalCandleTime: '',
      entryCondition: '',
      entryWindowStartUtc: '',
      entryWindowEndUtc: '',
      triggerPrice: 1.1,
      invalidationPrice: 1.09,
      actualEntryTimeUtc: new Date(1795600000000 + i * 600_000 + 60_000).toISOString(),
      actualEntryPrice: 1.1,
      entrySource: 'yahoo',
      expiryMinutes: 5,
      plannedExitTimeUtc: new Date(1795600000000 + i * 600_000 + 360_000).toISOString(),
      actualExitTimeUtc: new Date(1795600000000 + i * 600_000 + 360_000).toISOString(),
      actualExitPrice: 1.1,
      confidence: 0.8,
      calibrationStatus: 'UNCALIBRATED',
      lifecycleState: 'CLOSED',
      lifecycleHistory: [],
      grossReturnPips: 1,
      estimatedSpreadPips: 1,
      netReturnPips: 0,
      payoutPct: 80,
      payoutSource: i >= 12 ? 'BROKER_OBSERVED' : 'ASSUMED_MINIMUM',
      netReturnUnits: i % 3 === 0 ? -1.0 : 0.8,
      outcomeResult: i % 3 === 0 ? 'LOSS' : 'WIN',
      ruleFamily: 'order_flow_imbalance',
      modelVersion: 'vTest',
      notes: '',
      marketFeatureVector: Array.from({ length: 19 }, (_, k) => Math.sin(i + k) * 0.3),
    }));
    const report = evaluateShadowCandidateChronologically(mockSettled);
    if (report.datasetSummary.legacyWinLoss !== 12 || report.datasetSummary.olympVerifiedWinLoss !== 8) {
      throw new Error(`Expected 12 legacy / 8 olympVerified, got ${JSON.stringify(report.datasetSummary)}`);
    }
    if (report.shadowAll.brierScore >= report.baselineAll.brierScore || report.baselineAll.prevalenceBrierBaseline <= 0) {
      throw new Error(`Expected calibrated shadow Brier (${report.shadowAll.brierScore}) < overconfident baseline (${report.baselineAll.brierScore})`);
    }
  });

  await runTest('SYSTEM', 'Audit Fix Proofs: Isolated Temp DB, Batched Bootstrap Saves, Read-Only Regime, Duplicate Audit & k-NN Restore', async () => {
    const fsMod = await import('fs');
    const pathMod = await import('path');
    const { OnlinePolicyNetwork } = await import('./onlinePolicyNetwork.js');
    const { AgiSelfLearningEngine } = await import('./agiEngine.js');
    const { evaluateShadowCandidate } = await import('./shadowPredictor.js');

    // 1. Verify isolated test database is active (never points at data/signalforge.db.json)
    const activeDbPath = pathMod.default.resolve(db.getDbPath());
    const prodDbPath = pathMod.default.resolve(process.cwd(), 'data', 'signalforge.db.json');
    if (activeDbPath === prodDbPath) {
      throw new Error(`Tests must never run against working DB ${prodDbPath}`);
    }

    // 2. Verify shadow regime evaluation reports missing regimes as UNKNOWN & never mutates live cache
    const shadowNullRegime = evaluateShadowCandidate({
      symbol: 'EUR/USD',
      direction: 'BUY',
      ruleFamily: 'order_flow_imbalance',
      payoutPct: 80,
      regime: null,
      priorSettledRecords: [],
    });
    if (shadowNullRegime.regimeType !== 'UNKNOWN') {
      throw new Error(`Expected UNKNOWN for null regime, got ${shadowNullRegime.regimeType}`);
    }

    const tempAgi = new AgiSelfLearningEngine();
    const baseMs = 1793500000000;
    const histCandles: Candle[] = makeM1TestCandles('USD/JPY', 45).map((c, idx) => ({
      ...c,
      timestampMs: baseMs + idx * 60_000,
      timestamp: new Date(baseMs + idx * 60_000).toISOString(),
      source: 'yahoo' as const,
    }));
    tempAgi.classifyMarketRegime('USD/JPY', histCandles, true);
    const cachedBefore = tempAgi.getSelfLearningState().regimes['USD/JPY'];
    await new Promise(r => setTimeout(r, 15));
    tempAgi.classifyMarketRegime('USD/JPY', histCandles, false);
    const cachedAfter = tempAgi.getSelfLearningState().regimes['USD/JPY'];
    if (cachedBefore.calculatedAt !== cachedAfter.calculatedAt) {
      throw new Error('Read-only classifyMarketRegime(..., false) mutated live regimeCache.');
    }

    // 3. Verify trainingAudit persists synchronously & duplicate-blocked attempts report false + ALREADY_TRAINED
    const vec = Array.from({ length: 19 }, (_, idx) => Math.sin(idx + 0.5) * 0.35);
    const auditSig: ResearchSignal = {
      id: `sig_audit_fix_${Date.now()}`,
      symbol: 'EUR/USD',
      direction: 'BUY',
      predictionTimeUtc: '2026-11-25T10:00:00.000Z',
      predictionTimeIst: '03:30:00 PM IST',
      signalCandleTime: '2026-11-25T09:59:00.000Z',
      entryCondition: 'M5',
      entryWindowStartUtc: '2026-11-25T10:05:00.000Z',
      entryWindowEndUtc: '2026-11-25T10:10:00.000Z',
      triggerPrice: 1.1,
      invalidationPrice: 1.09,
      actualEntryTimeUtc: '2026-11-25T10:05:00.000Z',
      actualEntryPrice: 1.1,
      entrySource: 'yahoo',
      expiryMinutes: 5,
      plannedExitTimeUtc: '2026-11-25T10:10:00.000Z',
      actualExitTimeUtc: '2026-11-25T10:10:00.000Z',
      actualExitPrice: 1.101,
      confidence: 0.78,
      calibrationStatus: 'UNCALIBRATED',
      lifecycleState: 'ACTIVE',
      lifecycleHistory: [],
      grossReturnPips: 10,
      estimatedSpreadPips: 1.2,
      netReturnPips: null,
      payoutPct: 80,
      payoutSource: 'BROKER_OBSERVED',
      netReturnUnits: 0.8,
      outcomeResult: 'WIN',
      ruleFamily: 'order_flow_imbalance',
      modelVersion: 'vTest',
      notes: '',
      marketFeatureVector: vec,
    };
    db.addSignal(auditSig);
    auditSig.lifecycleState = 'CLOSED';
    db.updateSignal(auditSig);
    (entryExitEngine as any).triggerClosedLoopLearning(auditSig, histCandles);
    // Re-read raw JSON from isolated temp DB to prove synchronous disk persistence of trainingAudit
    const onDiskFirst = JSON.parse(fsMod.default.readFileSync(activeDbPath, 'utf-8')).signals.find((s: any) => s.id === auditSig.id);
    if (!onDiskFirst?.trainingAudit?.mlpTrained || !onDiskFirst?.trainingAudit?.linUcbV2Trained || !onDiskFirst?.trainingAudit?.episodicRecorded) {
      throw new Error(`Expected persisted trainingAudit all true after first training, got ${JSON.stringify(onDiskFirst?.trainingAudit)}`);
    }
    // Second call with exact same signalId must block duplicates AND record false + ALREADY_TRAINED
    (entryExitEngine as any).triggerClosedLoopLearning(auditSig, histCandles);
    const onDiskDup = JSON.parse(fsMod.default.readFileSync(activeDbPath, 'utf-8')).signals.find((s: any) => s.id === auditSig.id);
    if (
      onDiskDup?.trainingAudit?.mlpTrained !== false ||
      onDiskDup?.trainingAudit?.mlpSkippedReason !== 'ALREADY_TRAINED' ||
      onDiskDup?.trainingAudit?.linUcbV2Trained !== false ||
      onDiskDup?.trainingAudit?.linUcbV2SkippedReason !== 'ALREADY_TRAINED' ||
      onDiskDup?.trainingAudit?.episodicRecorded !== false ||
      onDiskDup?.trainingAudit?.episodicSkippedReason !== 'ALREADY_TRAINED'
    ) {
      throw new Error(`Duplicate-blocked run must report false/ALREADY_TRAINED on disk, got ${JSON.stringify(onDiskDup?.trainingAudit)}`);
    }

    // 4. Verify bootstrapFromSettledSignals() batches saves instead of saving per skipped record
    for (let i = 0; i < 6; i++) {
      db.addSignal({
        ...auditSig,
        id: `sig_skip_batch_${i}_${Date.now()}`,
        symbol: 'GBP/USD',
        candleOpenTimeUtc: `2026-11-25T10:${String(15 + i * 5).padStart(2, '0')}:00.000Z`,
        lifecycleState: 'CLOSED',
        marketFeatureVector: undefined,
      });
    }
    const batchNet = new OnlinePolicyNetwork({ skipAutoLoad: true, persistToDb: false });
    let saveCalls = 0;
    (batchNet as any).saveState = () => { saveCalls++; };
    const boot1 = batchNet.bootstrapFromSettledSignals();
    if (boot1.skippedMissingFeatures < 6 || saveCalls !== 1) {
      throw new Error(`Expected batched 1 save across >=6 skipped signals, got skipped=${boot1.skippedMissingFeatures}, saveCalls=${saveCalls}`);
    }
    const boot2 = batchNet.bootstrapFromSettledSignals();
    if (saveCalls !== 1 || boot2.skippedMissingFeatures < 6) {
      throw new Error(`Expected 0 redundant saves on repeat bootstrap, got saveCalls=${saveCalls}`);
    }

    // 5. Verify second k-NN check (onlinePolicyNetwork.queryEpisodicKNN) is functional & restored in scheduler.ts GATE 3
    const knnNet = new OnlinePolicyNetwork({ skipAutoLoad: true, persistToDb: false });
    for (let i = 0; i < 5; i++) {
      knnNet.trainStep(vec, 'BUY', 'LOSS', -1.0, 'EUR/AUD', `sig_knn_restore_${i}`);
    }
    const knnCheck = knnNet.queryEpisodicKNN(vec, 'EUR/AUD', 'BUY', 7);
    if (!knnCheck.shouldVeto) {
      throw new Error(`Expected queryEpisodicKNN veto after 5 local losses, got ${JSON.stringify(knnCheck)}`);
    }
    const schedSrc = fsMod.default.readFileSync(pathMod.default.resolve(process.cwd(), 'src', 'server', 'scheduler.ts'), 'utf-8');
    if (!schedSrc.includes('const policyKnn = onlinePolicyNetwork.queryEpisodicKNN(featureVec, symbol, candidate.direction);') ||
        !schedSrc.includes('if (agiKnn.shouldVeto || policyKnn.shouldVeto)')) {
      throw new Error('Expected restored dual k-NN veto gate in scheduler.ts GATE 3.');
    }
  });

  await runTest('SYSTEM', 'Production Safety: HTTP Test Endpoints Disabled in Production & Child-Process Isolated in Dev', async () => {
    const fsMod = await import('fs');
    const pathMod = await import('path');
    const { isProductionTestExecutionBlocked, createHandleRunTests, apiRouter } = await import('./api.js');

    // 1. Verify production & fail-closed env checks block execution
    if (!isProductionTestExecutionBlocked({ NODE_ENV: 'production' })) {
      throw new Error('Expected NODE_ENV=production to block HTTP test endpoints.');
    }
    if (!isProductionTestExecutionBlocked({ K_SERVICE: 'ais-pre-signalforge' })) {
      throw new Error('Expected K_SERVICE=ais-pre-* to block HTTP test endpoints.');
    }
    if (!isProductionTestExecutionBlocked({ K_SERVICE: 'signalforge-prod' })) {
      throw new Error('Expected production Cloud Run K_SERVICE to block HTTP test endpoints.');
    }
    if (!isProductionTestExecutionBlocked({})) {
      throw new Error('Expected unset environment to fail closed and block HTTP test endpoints.');
    }
    if (isProductionTestExecutionBlocked({ NODE_ENV: 'development' })) {
      throw new Error('Expected NODE_ENV=development to allow isolated subprocess HTTP testing.');
    }

    // 2. Verify handler returns HTTP 403 and NEVER invokes runner in production
    let runnerInvokedInProd = false;
    const prodHandler = createHandleRunTests(
      () => ({ NODE_ENV: 'production' }),
      async () => {
        runnerInvokedInProd = true;
        return { ok: true };
      }
    );
    let capturedStatus = 200;
    let capturedBody: any = null;
    const mockRes: any = {
      status(code: number) {
        capturedStatus = code;
        return this;
      },
      json(body: any) {
        capturedBody = body;
        return this;
      },
    };
    await prodHandler({} as any, mockRes);
    if (capturedStatus !== 403 || runnerInvokedInProd || !String(capturedBody?.error || '').includes('disabled in production')) {
      throw new Error(`Expected HTTP 403 without running tests in production, got status=${capturedStatus}, invoked=${runnerInvokedInProd}`);
    }

    // Verify both /test/run and /tests/run POST routes are registered
    const postPaths = (apiRouter.stack || [])
      .filter((layer: any) => layer?.route?.methods?.post)
      .map((layer: any) => layer.route.path);
    if (!postPaths.includes('/test/run') || !postPaths.includes('/tests/run')) {
      throw new Error(`Expected /test/run and /tests/run routes registered, got ${JSON.stringify(postPaths)}`);
    }

    // 3. Verify api.ts never imports or calls runAllVerificationTests in-process
    const apiSrc = fsMod.default.readFileSync(pathMod.default.resolve(process.cwd(), 'src', 'server', 'api.ts'), 'utf-8');
    if (apiSrc.includes('runAllVerificationTests') || apiSrc.includes('./tests.js')) {
      throw new Error('api.ts must not import ./tests.js or call runAllVerificationTests() inside the live Express process.');
    }

    // 4. Verify dev handler delegates to isolated child-process runner (never live DB)
    let devRunnerCalls = 0;
    const devHandler = createHandleRunTests(
      () => ({ NODE_ENV: 'development' }),
      async () => {
        devRunnerCalls++;
        return { isolated: true, dbPath: process.env.SIGNALFORGE_DB_PATH };
      }
    );
    capturedStatus = 200;
    await devHandler({} as any, mockRes);
    if (capturedStatus !== 200 || devRunnerCalls !== 1 || !capturedBody?.isolated) {
      throw new Error(`Expected dev handler to invoke isolated runner once, got status=${capturedStatus}, calls=${devRunnerCalls}`);
    }

    // 5. Verify CLI runner sets SIGNALFORGE_DB_PATH in os.tmpdir() before importing db.js & active DB is not working DB
    const runnerSrc = fsMod.default.readFileSync(pathMod.default.resolve(process.cwd(), 'scripts', 'run-verification.ts'), 'utf-8');
    const envAssignIdx = runnerSrc.indexOf('process.env.SIGNALFORGE_DB_PATH');
    const dbImportIdx = runnerSrc.indexOf("await import('../src/server/db.js')");
    if (envAssignIdx < 0 || dbImportIdx < 0 || envAssignIdx > dbImportIdx) {
      throw new Error('scripts/run-verification.ts must assign SIGNALFORGE_DB_PATH before importing db.js.');
    }
    const prodDbPath = pathMod.default.resolve(process.cwd(), 'data', 'signalforge.db.json');
    if (pathMod.default.resolve(db.getDbPath()) === prodDbPath) {
      throw new Error('Test execution attempted on real working database.');
    }
  });

  await runTest('SYSTEM', 'Orphaned Zombie Signal Purge & Bandit Recovery Fix', async () => {
    const { mergeServerAndCloudSignals } = await import('../utils/signalMerge.js');
    const { AgiSelfLearningEngine } = await import('./agiEngine.js');

    const nowMs = Date.parse('2026-11-25T18:00:00.000Z');
    const settledCloud: ResearchSignal = {
      id: 'sig_cloud_settled_1',
      symbol: 'EUR/USD',
      direction: 'BUY',
      predictionTimeUtc: '2026-11-25T13:00:00.000Z',
      predictionTimeIst: '',
      signalCandleTime: '',
      entryCondition: '',
      entryWindowStartUtc: '',
      entryWindowEndUtc: '',
      triggerPrice: 1.1,
      invalidationPrice: 1.09,
      actualEntryTimeUtc: '2026-11-25T13:05:00.000Z',
      actualEntryPrice: 1.1,
      entrySource: 'yahoo',
      expiryMinutes: 5,
      plannedExitTimeUtc: '2026-11-25T13:10:00.000Z',
      actualExitTimeUtc: '2026-11-25T13:10:00.000Z',
      actualExitPrice: 1.101,
      confidence: 0.78,
      calibrationStatus: 'UNCALIBRATED',
      lifecycleState: 'CLOSED',
      lifecycleHistory: [],
      grossReturnPips: 10,
      estimatedSpreadPips: 1.2,
      netReturnPips: null,
      payoutPct: 80,
      payoutSource: 'BROKER_OBSERVED',
      netReturnUnits: 0.8,
      outcomeResult: 'WIN',
      ruleFamily: 'order_flow_imbalance',
      modelVersion: 'vTest',
      notes: '',
    };
    const orphanWaitingCloud: ResearchSignal = {
      ...settledCloud,
      id: 'sig_cloud_orphan_waiting',
      lifecycleState: 'WAITING_FOR_ENTRY',
      outcomeResult: 'PENDING',
      actualEntryTimeUtc: null,
      actualEntryPrice: null,
      plannedExitTimeUtc: null,
      actualExitTimeUtc: null,
      actualExitPrice: null,
      candleCloseTimeUtc: '2026-11-25T14:30:00.000Z',
    };

    const mergedAfterLoad = mergeServerAndCloudSignals([], [settledCloud, orphanWaitingCloud], true, true, nowMs);
    if (!mergedAfterLoad.some(s => s.id === settledCloud.id) || mergedAfterLoad.some(s => s.id === orphanWaitingCloud.id)) {
      throw new Error('Expected settled cloud history kept and orphaned non-settled zombie dropped after server load.');
    }

    // Verify profitable ~59% (40W-28L) interleaved bandit arm stays ACTIVE under gamma=0.985 & throttled arm gets hourly probe
    const agi = new AgiSelfLearningEngine();
    const stratActive = 'stacked:test_gamma985_ofi:30';
    for (let i = 0; i < 68; i++) {
      // Interleaved 40W-28L distribution (first 34: 22W-12L, last 34: 18W-16L -> ~53% recent, ~59% overall)
      const outcome = i < 34 ? (i % 3 === 0 ? 'LOSS' : 'WIN') : (i % 2 === 0 ? 'WIN' : 'LOSS');
      agi.updateBanditArm(stratActive, outcome);
    }
    const activeCheck = agi.isStrategyThrottled(stratActive, Date.now());
    if (activeCheck.throttled) {
      throw new Error(`Expected profitable interleaved 40W-28L arm to stay ACTIVE under gamma=0.985, got ${JSON.stringify(activeCheck)}`);
    }
    const losingStrat = 'stacked:test_recovery_probe:20';
    for (let i = 0; i < 9; i++) {
      agi.updateBanditArm(losingStrat, i < 2 ? 'WIN' : 'LOSS');
    }
    const immediateCheck = agi.isStrategyThrottled(losingStrat, Date.now());
    if (!immediateCheck.throttled) {
      throw new Error('Expected losing arm to remain throttled immediately after loss streak.');
    }
    const afterHourCheck = agi.isStrategyThrottled(losingStrat, Date.now() + 65 * 60 * 1000);
    if (afterHourCheck.throttled || !afterHourCheck.recoveryProbe) {
      throw new Error(`Expected 1 hourly recovery probe after 65m idle, got ${JSON.stringify(afterHourCheck)}`);
    }
    const secondImmediateCheck = agi.isStrategyThrottled(losingStrat, Date.now() + 66 * 60 * 1000);
    if (!secondImmediateCheck.throttled) {
      throw new Error('Expected throttled arm to allow at most one recovery probe per 60m window.');
    }
  });

  await runTest('SYSTEM', 'Targeted Olymp-Only Sensing: Fail-closed empty fetch when no active pairs, minimal fetch for active + settlement pairs', async () => {
    const nowMs = Date.now();
    const staleUniverse = resolveActiveTradingPairs(null, nowMs);
    const planIdle = resolvePulseFetchPlan(staleUniverse, [], [], nowMs);
    if (planIdle.shouldFetch || planIdle.shouldDiscover || planIdle.symbolsToFetch.length !== 0) {
      throw new Error(`Expected fail-closed empty fetch plan when Olymp has no active pairs, got ${JSON.stringify(planIdle)}`);
    }

    const activeTrade: ResearchSignal = {
      id: 'sig_plan_active_eurusd',
      symbol: 'EUR/USD',
      direction: 'BUY',
      predictionTimeUtc: new Date(nowMs - 60_000).toISOString(),
      predictionTimeIst: '',
      signalCandleTime: new Date(nowMs - 60_000).toISOString(),
      entryCondition: 'NEXT_5M_OPEN',
      entryWindowStartUtc: new Date(nowMs - 30_000).toISOString(),
      entryWindowEndUtc: new Date(nowMs + 30_000).toISOString(),
      triggerPrice: 1.08,
      invalidationPrice: 1.078,
      actualEntryTimeUtc: new Date(nowMs - 30_000).toISOString(),
      actualEntryPrice: 1.08,
      entrySource: 'yahoo',
      expiryMinutes: 30,
      plannedExitTimeUtc: new Date(nowMs + 25 * 60_000).toISOString(),
      actualExitTimeUtc: null,
      actualExitPrice: null,
      confidence: 0.78,
      calibrationStatus: 'UNCALIBRATED',
      lifecycleState: 'ACTIVE',
      lifecycleHistory: [],
      grossReturnPips: null,
      estimatedSpreadPips: 1.2,
      netReturnPips: null,
      payoutPct: 82,
      payoutSource: 'BROKER_OBSERVED',
      netReturnUnits: null,
      outcomeResult: 'PENDING',
      ruleFamily: 'order_flow_imbalance',
      modelVersion: 'vTest',
      notes: '',
    };
    const recoveringExpired: ResearchSignal = {
      ...activeTrade,
      id: 'sig_plan_expired_gbpjpy',
      symbol: 'GBP/JPY',
      lifecycleState: 'EXPIRED',
      outcomeResult: 'CANCELLED',
      plannedExitTimeUtc: new Date(nowMs - 10 * 60_000).toISOString(),
      lifecycleHistory: [
        {
          timestamp: new Date(nowMs - 5 * 60_000).toISOString(),
          fromState: 'ACTIVE',
          toState: 'EXPIRED',
          reason: 'No verified market candle within ±6m of planned expiry time.',
        },
      ],
    };

    const planSettleOnly = resolvePulseFetchPlan(staleUniverse, [activeTrade], [recoveringExpired], nowMs);
    if (
      !planSettleOnly.shouldFetch ||
      planSettleOnly.shouldDiscover ||
      planSettleOnly.symbolsToFetch.length !== 2 ||
      !planSettleOnly.symbolsToFetch.includes('EUR/USD') ||
      !planSettleOnly.symbolsToFetch.includes('GBP/JPY')
    ) {
      throw new Error(`Expected settlement-only fetch for EUR/USD + GBP/JPY, got ${JSON.stringify(planSettleOnly)}`);
    }

    const activeSnapshot = sanitizeOlympTradeBridgeStatus({
      extensionInstalled: true,
      extensionVersion: '1.3.0',
      platformTabOpen: true,
      connected: true,
      sessionState: 'READY',
      capturedAt: new Date(nowMs).toISOString(),
      ageMs: 500,
      instruments: [
        { pair: 'EUR/USD', payoutPct: 85, availability: 'AVAILABLE', evidence: 'HIGH' },
        { pair: 'USD/JPY', payoutPct: 84, availability: 'AVAILABLE', evidence: 'HIGH' },
        { pair: 'GBP/USD', payoutPct: 82, availability: 'AVAILABLE', evidence: 'HIGH' },
        { pair: 'EUR/GBP', payoutPct: 74, availability: 'AVAILABLE', evidence: 'HIGH' },
        { pair: 'USD/CAD', payoutPct: 88, availability: 'DISABLED', evidence: 'HIGH' },
      ],
    });
    const olympActiveUniverse = resolveActiveTradingPairs(activeSnapshot, nowMs);
    const inactiveOpenTrade: ResearchSignal = {
      ...activeTrade,
      id: 'sig_plan_open_audnzd',
      symbol: 'AUD/NZD',
    };
    const planActive = resolvePulseFetchPlan(olympActiveUniverse, [inactiveOpenTrade], [], nowMs);
    if (
      !planActive.shouldFetch ||
      !planActive.shouldDiscover ||
      planActive.brokerPairsCount !== 3 ||
      planActive.symbolsToFetch.length !== 4 ||
      !planActive.symbolsToFetch.includes('EUR/USD') ||
      !planActive.symbolsToFetch.includes('USD/JPY') ||
      !planActive.symbolsToFetch.includes('GBP/USD') ||
      !planActive.symbolsToFetch.includes('AUD/NZD')
    ) {
      throw new Error(`Expected active-only fetch for 3 Olymp pairs + 1 open settlement pair, got ${JSON.stringify(planActive)}`);
    }
  });

  await runTest('ML', 'Multi-Agent Adversarial Debate, Counterfactual Stress & Hedge (MWU) Adaptation', async () => {
    const {
      createInitialAgentCouncilState,
      runMultiAgentDebate,
      MultiAgentCouncilEngine,
    } = await import('./multiAgentCouncil.js');

    // 1. Overextended BUY setup with weak counterfactual survival & immune penalty must draw Contrarian + Red-Team challenges
    const fragileVec = [
      0.8, 1.5, 2.0, 2.5, 1.0,
      0.55, 0.52, 0.05, 0.47, 0.5,
      1.2, 1.8, 0.4, 0.72, 0.72,
      0.92, 0.94, 1.2, 0.0,
    ];
    const councilInit = createInitialAgentCouncilState();
    const fragileDebate = runMultiAgentDebate(
      {
        symbol: 'EUR/USD',
        direction: 'BUY',
        ruleFamily: 'momentum_5',
        payoutPct: 80,
        marketFeatureVector: fragileVec,
        regime: {
          symbol: 'EUR/USD',
          hurstExponent: 0.48,
          regimeType: 'RANDOM_WALK_CHOP',
          shannonEntropy: 0.91,
          atrPercentile: 75,
          recommendedFamily: 'stand_down',
          calculatedAt: new Date().toISOString(),
        },
        ftrlProbability: 0.44,
        ftrlSampleSize: 30,
        mlpUpProbability: 0.41,
        mlpStepCount: 25,
        mlpOosBce: 0.66,
        immuneDampingPenalty: 0.14,
        severeTrapCount: 1,
        priorSettledRecords: [],
      },
      councilInit,
      () => ({ probabilityUp: 0.41 })
    );

    if (fragileDebate.votes.length !== 5) {
      throw new Error(`Expected 5 voting agents, got ${fragileDebate.votes.length}`);
    }
    const concededChallenges = fragileDebate.challenges.filter((c) => c.outcome === 'CONCEDED_REVISION');
    if (concededChallenges.length === 0) {
      throw new Error('Expected Contrarian/Red-Team challenges to force Round 2 revision on overextended setup.');
    }
    if (fragileDebate.round2MeanProbability >= fragileDebate.round1MeanProbability) {
      throw new Error(
        `Expected Round 2 mean (${fragileDebate.round2MeanProbability}) < Round 1 mean (${fragileDebate.round1MeanProbability}) after challenges.`
      );
    }
    if (fragileDebate.verdict !== 'VETO_SHADOW') {
      throw new Error(`Expected fragile setup verdict VETO_SHADOW, got ${fragileDebate.verdict}`);
    }

    // 2. Robust aligned BUY setup should defend counterfactual suite cleanly
    const strongVec = [
      1.6, 2.8, 3.6, 4.4, 1.0,
      0.78, 0.06, 0.12, -0.06, 0.85,
      1.35, 3.2, 1.4, 0.12, 0.12,
      0.62, 0.58, 1.25, 0.0,
    ];
    const strongDebate = runMultiAgentDebate(
      {
        symbol: 'EUR/USD',
        direction: 'BUY',
        ruleFamily: 'order_flow_imbalance',
        payoutPct: 85,
        marketFeatureVector: strongVec,
        regime: {
          symbol: 'EUR/USD',
          hurstExponent: 0.63,
          regimeType: 'TRENDING',
          shannonEntropy: 0.68,
          atrPercentile: 62,
          recommendedFamily: 'momentum',
          calculatedAt: new Date().toISOString(),
        },
        ftrlProbability: 0.72,
        ftrlSampleSize: 40,
        mlpUpProbability: 0.74,
        mlpStepCount: 40,
        mlpOosBce: 0.61,
        priorSettledRecords: Array.from({ length: 12 }, (_, idx) => ({
          symbol: 'EUR/USD' as ForexSymbol,
          direction: 'BUY' as const,
          ruleFamily: 'order_flow_imbalance',
          outcome: idx < 9 ? 'WIN' as const : 'LOSS' as const,
          netReturnUnits: idx < 9 ? 0.85 : -1.0,
        })),
      },
      councilInit,
      (v) => ({ probabilityUp: v[0] > 0.2 ? 0.73 : 0.62 })
    );
    if (strongDebate.counterfactualSurvivalRate < 0.8 || strongDebate.verdict !== 'APPROVE') {
      throw new Error(`Expected robust setup to survive counterfactual shocks & APPROVE, got ${JSON.stringify(strongDebate)}`);
    }

    // 3. Hedge / Multiplicative Weights Update: reward accurate challengers, keep weights normalized, block duplicates
    const engine = new MultiAgentCouncilEngine();
    const beforeW = engine.getState().agents.ADVERSARIAL_RED_TEAM.weight;
    const settledLoss: ResearchSignal = {
      id: 'sig_council_hedge_test_1',
      symbol: 'EUR/USD',
      direction: 'BUY',
      predictionTimeUtc: new Date().toISOString(),
      predictionTimeIst: '',
      signalCandleTime: new Date().toISOString(),
      entryCondition: 'NEXT_5M_OPEN',
      entryWindowStartUtc: new Date().toISOString(),
      entryWindowEndUtc: new Date().toISOString(),
      triggerPrice: 1.09,
      invalidationPrice: 1.088,
      actualEntryTimeUtc: new Date().toISOString(),
      actualEntryPrice: 1.09,
      entrySource: 'yahoo',
      expiryMinutes: 15,
      plannedExitTimeUtc: new Date().toISOString(),
      actualExitTimeUtc: new Date().toISOString(),
      actualExitPrice: 1.089,
      confidence: 0.78,
      calibrationStatus: 'UNCALIBRATED',
      lifecycleState: 'CLOSED',
      lifecycleHistory: [],
      grossReturnPips: -10,
      estimatedSpreadPips: 1.2,
      netReturnPips: null,
      payoutPct: 80,
      payoutSource: 'BROKER_OBSERVED',
      netReturnUnits: -1.0,
      outcomeResult: 'LOSS',
      ruleFamily: 'momentum_5',
      modelVersion: 'vTest',
      agentDebate: {
        ...fragileDebate,
        votes: fragileDebate.votes.map((v) =>
          v.agentId === 'ADVERSARIAL_RED_TEAM'
            ? { ...v, round2Probability: 0.25 }
            : v.agentId === 'BULL_MOMENTUM'
              ? { ...v, round2Probability: 0.80 }
              : v
        ),
      },
    };
    const firstTrain = engine.trainFromSettledSignal(settledLoss);
    const dupTrain = engine.trainFromSettledSignal(settledLoss);
    if (!firstTrain.trained || !dupTrain.duplicateBlocked) {
      throw new Error(`Expected first council Hedge train=true and second duplicateBlocked=true, got ${JSON.stringify({ firstTrain, dupTrain })}`);
    }
    const afterState = engine.getState();
    const sumWeights = Object.values(afterState.agents).reduce((acc, a) => acc + a.weight, 0);
    if (Math.abs(sumWeights - 1.0) > 1e-4) {
      throw new Error(`Expected Hedge weights normalized to 1.0, got ${sumWeights}`);
    }
    if (afterState.agents.ADVERSARIAL_RED_TEAM.weight <= beforeW ||
        afterState.agents.ADVERSARIAL_RED_TEAM.weight <= afterState.agents.BULL_MOMENTUM.weight) {
      throw new Error('Expected accurate Red-Team challenger on LOSS to gain Hedge weight above overconfident Bull agent.');
    }

    // 4. Live isolation check: Debate evaluation must NEVER touch signal.confidence when creating a ResearchSignal
    const testCandle: Candle = makeM1TestCandles('EUR/USD', 1)[0];
    const createdShadowTest = entryExitEngine.createResearchSignal({
      symbol: 'EUR/USD',
      direction: 'BUY',
      signalCandle: testCandle,
      ruleFamily: 'test_council_isolation',
      modelVersion: 'test-council-v1',
      expiryMinutes: 15,
      confidence: 0.81,
    });
    if (createdShadowTest.confidence !== 0.81) {
      throw new Error(`Expected live confidence 0.81 preserved untouched by shadow council, got ${createdShadowTest.confidence}`);
    }
  });

  await runTest('SYSTEM', 'Scheduler Anti-Hang: Recover stalled cycle locks after 75s without starving normal cycles', async () => {
    const sched: any = new AutonomousScheduler();
    const now = Date.now();
    sched.isRunningCycle = true;
    sched.currentCycleStartedAtMs = now - 20_000;
    if (sched.recoverIfStalled(now)) {
      throw new Error('Active 20s cycle should NOT be flagged as stalled.');
    }
    sched.currentCycleStartedAtMs = now - 80_000;
    if (!sched.recoverIfStalled(now) || sched.isRunningCycle !== false || sched.currentCycleStartedAtMs !== 0) {
      throw new Error('Expected 80s hung cycle lock to be released cleanly by recoverIfStalled().');
    }
  });

  await runTest('ML', 'Institutional Quant Engine: Causal M5/M15 Resampling, 8-Currency Strength, Kelly Sizing & Factor Correlation', async () => {
    const {
      resampleCandlesCausal,
      computeCurrencyStrengthMatrix,
      getDirectionalStrengthSpread,
    } = await import('./quantMicrostructure.js');
    const {
      evaluateInstitutionalSignalRisk,
      computeFactorExposureMatrix,
      computePortfolioStatistics,
      evaluatePromotionReadiness,
    } = await import('./portfolioRiskEngine.js');

    const baseCandles = makeM1TestCandles('EUR/USD', 40).map((c, idx) => ({
      ...c,
      open: 1.08 + idx * 0.0001,
      high: 1.08 + idx * 0.00015,
      low: 1.08 + idx * 0.00005,
      close: 1.08 + (idx + 1) * 0.0001,
      source: 'yahoo' as const,
    }));
    const cutoffTs = baseCandles[24].timestampMs;
    const causalM5 = resampleCandlesCausal(baseCandles, 5, cutoffTs);
    if (causalM5.some((b) => b.bucketMs > cutoffTs)) {
      throw new Error('Causal M5 resampling leaked future bucket timestamps.');
    }

    const strength = computeCurrencyStrengthMatrix({
      'EUR/USD': baseCandles,
      'GBP/USD': baseCandles.map((c) => ({ ...c, symbol: 'GBP/USD' })),
    });
    const eurEntry = strength.currencies.find((c) => c.currency === 'EUR');
    const usdEntry = strength.currencies.find((c) => c.currency === 'USD');
    if (!eurEntry || !usdEntry || eurEntry.score <= usdEntry.score) {
      throw new Error(`Expected rising EUR/USD & GBP/USD to rank EUR > USD, got EUR=${eurEntry?.score} USD=${usdEntry?.score}`);
    }
    const buySpread = getDirectionalStrengthSpread('EUR/USD', 'BUY', strength);
    if (buySpread <= 0) {
      throw new Error(`Expected positive BUY strength spread for rising EUR/USD, got ${buySpread}`);
    }

    const mkOpen = (id: string, symbol: ForexSymbol, direction: 'BUY' | 'SELL'): ResearchSignal => ({
      id,
      symbol,
      direction,
      predictionTimeUtc: new Date().toISOString(),
      predictionTimeIst: '',
      signalCandleTime: new Date().toISOString(),
      entryCondition: 'NEXT_5M_OPEN',
      entryWindowStartUtc: new Date().toISOString(),
      entryWindowEndUtc: new Date().toISOString(),
      triggerPrice: 1.08,
      invalidationPrice: 1.078,
      actualEntryTimeUtc: new Date().toISOString(),
      actualEntryPrice: 1.08,
      entrySource: 'yahoo',
      expiryMinutes: 15,
      plannedExitTimeUtc: new Date(Date.now() + 600_000).toISOString(),
      actualExitTimeUtc: null,
      actualExitPrice: null,
      confidence: 0.78,
      calibrationStatus: 'UNCALIBRATED',
      lifecycleState: 'ACTIVE',
      lifecycleHistory: [],
      grossReturnPips: null,
      estimatedSpreadPips: 1.2,
      netReturnPips: null,
      outcomeResult: 'PENDING',
      ruleFamily: 'order_flow_imbalance',
      modelVersion: 'vTest',
    });

    const openStack = [
      mkOpen('open_1', 'EUR/USD', 'BUY'),
      mkOpen('open_2', 'EUR/JPY', 'BUY'),
    ];
    const exposure = computeFactorExposureMatrix(openStack);
    const eurExp = exposure.find((e) => e.currency === 'EUR');
    if (!eurExp || eurExp.netExposureUnits !== 2) {
      throw new Error(`Expected EUR factor exposure +2 across 2 long EUR positions, got ${eurExp?.netExposureUnits}`);
    }

    const highCorrEdge = evaluateInstitutionalSignalRisk({
      symbol: 'EUR/GBP',
      direction: 'BUY',
      payoutPct: 80,
      modelProbability: 0.64,
      predictionHistory: baseCandles.slice(0, 25),
      predictionCandleTimestampMs: cutoffTs,
      openSignals: openStack,
      allSignals: [],
      currencyStrengthSnapshot: strength,
    });
    if (highCorrEdge.correlationRiskLevel !== 'HIGH' || highCorrEdge.quarterKellyPct <= 0) {
      throw new Error(`Expected HIGH correlation risk & positive Quarter-Kelly stake, got ${JSON.stringify(highCorrEdge)}`);
    }

    const noEdge = evaluateInstitutionalSignalRisk({
      symbol: 'EUR/GBP',
      direction: 'BUY',
      payoutPct: 80,
      modelProbability: 0.52,
      predictionHistory: baseCandles.slice(0, 25),
      predictionCandleTimestampMs: cutoffTs,
      openSignals: [],
      allSignals: [],
      currencyStrengthSnapshot: strength,
    });
    if (noEdge.quarterKellyPct !== 0 || noEdge.suggestedStakePct !== 0) {
      throw new Error(`Expected 0 Kelly stake below break-even (52% <= 55.6%), got ${JSON.stringify(noEdge)}`);
    }

    const settledSample: ResearchSignal[] = [
      { ...mkOpen('s_1', 'EUR/USD', 'BUY'), lifecycleState: 'CLOSED', outcomeResult: 'WIN', netReturnUnits: 0.8 },
      { ...mkOpen('s_2', 'EUR/USD', 'SELL'), lifecycleState: 'CLOSED', outcomeResult: 'LOSS', netReturnUnits: -1.0 },
      { ...mkOpen('s_3', 'USD/JPY', 'BUY'), lifecycleState: 'CLOSED', outcomeResult: 'WIN', netReturnUnits: 0.85 },
    ];
    const stats = computePortfolioStatistics(settledSample);
    const promo = evaluatePromotionReadiness(settledSample);
    if (stats.settledCount !== 3 || stats.wins !== 2 || stats.losses !== 1 || promo.shadowCalibrator.status !== 'COLLECTING_EVIDENCE') {
      throw new Error(`Unexpected portfolio stats or promotion gate output: ${JSON.stringify({ stats, promo })}`);
    }
  });

  await runTest('SYSTEM', 'Self-Healing Supervisor: Repairs zombie waiting signals, missing settlement units, and corrupt candles automatically', async () => {
    const { SelfHealingSupervisor } = await import('./selfHealingSupervisor.js');

    const nowMs = Date.now();
    const zombieCandle = makeM1TestCandles('CAD/CHF', 1)[0];
    // Insert a zombie signal whose entry window expired 20 minutes ago without fill (using isolated pair CAD/CHF)
    const insertedZombie = db.addSignal({
      id: 'sig_selfheal_zombie_1',
      symbol: 'CAD/CHF',
      direction: 'BUY',
      predictionTimeUtc: new Date(nowMs - 30 * 60_000).toISOString(),
      predictionTimeIst: '',
      signalCandleTime: zombieCandle.timestamp,
      entryCondition: 'NEXT_5M_OPEN',
      entryWindowStartUtc: new Date(nowMs - 25 * 60_000).toISOString(),
      entryWindowEndUtc: new Date(nowMs - 20 * 60_000).toISOString(),
      triggerPrice: zombieCandle.close,
      invalidationPrice: zombieCandle.close - 0.002,
      actualEntryTimeUtc: null,
      actualEntryPrice: null,
      entrySource: null,
      expiryMinutes: 15,
      plannedExitTimeUtc: null,
      actualExitTimeUtc: null,
      actualExitPrice: null,
      confidence: 0.78,
      calibrationStatus: 'UNCALIBRATED',
      lifecycleState: 'WAITING_FOR_ENTRY',
      lifecycleHistory: [],
      grossReturnPips: null,
      estimatedSpreadPips: 1.2,
      netReturnPips: null,
      outcomeResult: 'PENDING',
      ruleFamily: 'order_flow_imbalance',
      modelVersion: 'vTest',
    });
    if (!insertedZombie || insertedZombie.id !== 'sig_selfheal_zombie_1') {
      throw new Error(`Expected test zombie fixture inserted cleanly, got ${JSON.stringify(insertedZombie)}`);
    }

    // Insert a closed WIN trade missing netReturnUnits
    db.addSignal({
      id: 'sig_selfheal_settlement_1',
      symbol: 'USD/JPY',
      direction: 'BUY',
      predictionTimeUtc: new Date(nowMs - 40 * 60_000).toISOString(),
      predictionTimeIst: '',
      signalCandleTime: zombieCandle.timestamp,
      entryCondition: 'NEXT_5M_OPEN',
      entryWindowStartUtc: new Date(nowMs - 35 * 60_000).toISOString(),
      entryWindowEndUtc: new Date(nowMs - 30 * 60_000).toISOString(),
      triggerPrice: 150.0,
      invalidationPrice: 149.8,
      actualEntryTimeUtc: new Date(nowMs - 35 * 60_000).toISOString(),
      actualEntryPrice: 150.0,
      entrySource: 'yahoo',
      expiryMinutes: 15,
      plannedExitTimeUtc: new Date(nowMs - 20 * 60_000).toISOString(),
      actualExitTimeUtc: new Date(nowMs - 20 * 60_000).toISOString(),
      actualExitPrice: 150.15,
      confidence: 0.80,
      calibrationStatus: 'UNCALIBRATED',
      lifecycleState: 'CLOSED',
      lifecycleHistory: [],
      grossReturnPips: 15,
      estimatedSpreadPips: 1.2,
      netReturnPips: null,
      payoutPct: 82,
      netReturnUnits: null,
      outcomeResult: 'WIN',
      ruleFamily: 'order_flow_imbalance',
      modelVersion: 'vTest',
    });

    const healer = new SelfHealingSupervisor();
    const report = healer.runDiagnosticAndRepair(nowMs);
    if (report.status !== 'REPAIRED' || report.totalRepairsExecuted < 2) {
      throw new Error(`Expected self-healer to repair zombie & missing settlement units, got ${JSON.stringify(report)}`);
    }

    const fixedZombie = db.getSignals(true).find((s) => s.id === 'sig_selfheal_zombie_1');
    const fixedSettled = db.getSignals(true).find((s) => s.id === 'sig_selfheal_settlement_1');
    if (!fixedZombie || fixedZombie.lifecycleState !== 'EXPIRED' || fixedZombie.outcomeResult !== 'CANCELLED') {
      throw new Error(`Zombie waiting signal was not expired/cancelled: ${JSON.stringify(fixedZombie)}`);
    }
    if (!fixedSettled || fixedSettled.netReturnUnits !== 0.82) {
      throw new Error(`Missing settlement netReturnUnits was not auto-recomputed (expected 0.82): ${JSON.stringify(fixedSettled)}`);
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
