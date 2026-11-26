/**
 * SignalForge ML — Causal Entry & Exit Lifecycle Execution Engine
 * Enforces strict temporal ordering, causal triggers on post-signal closed candles,
 * dynamic entry-to-exit timing, ambiguity detection, and transaction cost modelling.
 */

import {
  BrokerEligibilitySnapshot,
  Candle,
  FOREX_PAIRS,
  ForexSymbol,
  MarketSessionId,
  ResearchSignal,
  SignalDirection,
  SignalLifecycleEvent,
  SignalLifecycleState,
} from '../types/index.js';
import { db } from './db.js';
import { calculateBinarySettlement, DEFAULT_BINARY_PAYOUT_PERCENT } from './binarySettlement.js';
import { getSessionFromTimestamp } from './dataFeeds.js';
import { agiSelfLearningEngine } from './agiEngine.js';
import { hasTrustedPredictionFeatures, onlinePolicyNetwork } from './onlinePolicyNetwork.js';
import { isValidBrokerEligibilitySnapshot, resolveRuntimeTradingMode } from '../services/olympTradeBridge.js';
import { evaluateShadowCandidate, PriorEpisodeRecord } from './shadowPredictor.js';
import { multiAgentCouncil } from './multiAgentCouncil.js';
import { evaluateInstitutionalSignalRisk } from './portfolioRiskEngine.js';
import { quantMicrostructure } from './quantMicrostructure.js';

/** Maximum delay to wait for a provider to deliver the exact 5-minute entry bar. */
export const LIVE_ENTRY_BAR_ARRIVAL_GRACE_MS = 5 * 60_000;
export const LIVE_ENTRY_BAR_TIMESTAMP_TOLERANCE_MS = 1_000;

/**
 * Select only the M1 candle that opens at the scheduled M5 boundary.
 * A nearby or newest candle is never a substitute for the missing entry bar.
 */
export function findExactEntryCandle(
  candles: readonly Candle[],
  symbol: ForexSymbol,
  candleOpenMs: number,
  toleranceMs: number = LIVE_ENTRY_BAR_TIMESTAMP_TOLERANCE_MS,
): Candle | null {
  if (!Number.isFinite(candleOpenMs) || !Number.isFinite(toleranceMs) || toleranceMs < 0) return null;

  return candles
    .filter(candle =>
      candle &&
      candle.symbol === symbol &&
      (candle.source === 'biquote' || candle.source === 'dukascopy' || candle.source === 'yahoo') &&
      Number.isFinite(candle.timestampMs) &&
      Math.abs(candle.timestampMs - candleOpenMs) <= toleranceMs &&
      Number.isFinite(candle.open) &&
      candle.open > 0
    )
    .sort((a, b) =>
      Math.abs(a.timestampMs - candleOpenMs) - Math.abs(b.timestampMs - candleOpenMs) ||
      a.timestampMs - b.timestampMs
    )[0] || null;
}

export interface SignalCreationParams {
  symbol: ForexSymbol;
  direction: SignalDirection;
  signalCandle: Candle;
  ruleFamily: string;
  expiryMinutes?: number;
  confidence: number;
  /** Broker-observed payout where available; otherwise use the 80% research floor. */
  payoutPct?: number;
  payoutSource?: 'ASSUMED_MINIMUM' | 'BROKER_OBSERVED';
  modelVersion: string;
  notes?: string;
  strategyName?: string;
  strategyWinRate?: number;
  strategyHistoricalSampleSize?: number;
  strategyEvidenceStatus?: 'UNVALIDATED' | 'INSUFFICIENT_SAMPLE' | 'BACKTESTED';
  strategyId?: string;
  candleOpenTimeUtc?: string;
  candleCloseTimeUtc?: string;
  confluenceStrategies?: string[];
  confluenceScore?: number;
  isStackedStrategy?: boolean;
  isNovelAiSynthesized?: boolean;
  synthesizedGeneId?: string;
  mathematicalFormula?: string;
  whyHumansMissThis?: string;
  paperOnly?: boolean;
  brokerEligibility?: BrokerEligibilitySnapshot;
  manualPairAuthorization?: {
    mode: 'MANUAL_ACTIVE';
    pair: ForexSymbol;
    verifiedAtUtc: string;
  };
}

export class EntryExitEngine {
  // Typical institutional forex spreads in pips
  private spreadsPips: Record<ForexSymbol, number> = {
    'EUR/USD': 1.1,
    'GBP/USD': 1.6,
    'USD/JPY': 1.2,
    'EUR/JPY': 1.8,
    'AUD/USD': 1.4,
    'USD/CAD': 1.7,
    'EUR/GBP': 1.2,
    'AUD/CAD': 1.8,
    'AUD/CHF': 1.9,
    'AUD/JPY': 1.7,
    'AUD/NZD': 2.0,
    'EUR/AUD': 1.9,
    'EUR/CAD': 1.8,
    'EUR/CHF': 1.6,
    'EUR/NZD': 2.2,
    'GBP/AUD': 2.2,
    'GBP/CAD': 2.0,
    'GBP/CHF': 2.1,
    'GBP/JPY': 2.0,
    'GBP/NZD': 2.4,
    // Conservative indicative spread estimates for newly added pairs.
    'USD/MXN': 35.0,
    'USD/CHF': 1.5,
    'NZD/CAD': 2.0,
    'NZD/JPY': 2.2,
    'CHF/JPY': 2.2,
    'NZD/USD': 1.5,
    'NZD/CHF': 2.0,
    'CAD/JPY': 2.1,
    'CAD/CHF': 2.0,
  };

  /**
   * Factory for creating a research signal in DETECTED state, moving to WAITING_FOR_ENTRY.
   * Every trade is synchronized to open strictly on the 5-minute candle opening.
   */
  public createResearchSignal(params: SignalCreationParams): ResearchSignal {
    const isTest = params.ruleFamily.startsWith('test_');
    if (!isTest) {
      if (!FOREX_PAIRS.includes(params.symbol)) {
        throw new Error(`BROKER_ELIGIBILITY_BLOCKED: ${params.symbol} is outside the configured 29-pair universe.`);
      }
      const hasValidOlympSnapshot = isValidBrokerEligibilitySnapshot(params.brokerEligibility, params.symbol);
      const allowManualUniverse =
        resolveRuntimeTradingMode() === 'MANUAL_PAIRS' || db.getAllowAllConfiguredPairs();
      const hasValidManualPreviewAuth =
        allowManualUniverse &&
        params.manualPairAuthorization?.mode === 'MANUAL_ACTIVE' &&
        params.manualPairAuthorization.pair === params.symbol;
      if (!hasValidOlympSnapshot && !hasValidManualPreviewAuth) {
        throw new Error(
          `BROKER_ELIGIBILITY_BLOCKED: Cannot create live signal for ${params.symbol} without a fresh, verified Olymp Trade AVAILABLE >=80% HIGH-evidence snapshot.`
        );
      }
    }
    const isJpy = params.symbol.includes('JPY');
    const pipUnit = isJpy ? 0.01 : 0.0001;
    const now = new Date();
    const nowUtc = now.toISOString();

    const signalCandleTime = params.signalCandle.timestamp;
    const signalClose = params.signalCandle.close;
    const signalHigh = params.signalCandle.high;
    const signalLow = params.signalCandle.low;

    // Dynamic Expiry Duration (5 to 30 minutes based on strategy and accuracy)
    const expiryMinutes = params.expiryMinutes || (
      params.ruleFamily.includes('momentum')
        ? 5
        : params.ruleFamily.includes('wick')
        ? 10
        : params.ruleFamily.includes('mean_reversion')
        ? 15
        : params.ruleFamily.includes('range')
        ? 20
        : params.ruleFamily.includes('squeeze')
        ? 25
        : 15
    );

    // Strict 5-Minute Candle Alignment:
    // Every trade opens exactly on the full 5-minute candle boundary (:00, :05, :10, :15, :20, :25, :30, :35, :40, :45, :50, :55)
    // Never random mid-candle entries like :32 or :37.
    const FIVE_MIN_MS = 5 * 60 * 1000;
    const signalCandleMs = params.signalCandle.timestampMs || Date.now();
    const refMs = isTest ? signalCandleMs : Date.now();
    // Strict 3-Minute Advance Alignment:
    // Every signal MUST provide at least 140 seconds (~2m 20s to 3m 30s) of advance notice before candle entry.
    // If the next immediate 5M boundary is less than 140s away, the signal targets the subsequent 5M boundary,
    // guaranteeing the trader the promised ~3-minute advance preparation window without rush or delay.
    let next5mCandleOpenMs = Math.ceil(refMs / FIVE_MIN_MS) * FIVE_MIN_MS;
    if (next5mCandleOpenMs - refMs < 140_000) {
      next5mCandleOpenMs += FIVE_MIN_MS;
    }
    const next5mCandleCloseMs = next5mCandleOpenMs + (expiryMinutes * 60 * 1000);

    const candleOpenTimeUtc = params.candleOpenTimeUtc || new Date(next5mCandleOpenMs).toISOString();
    const candleCloseTimeUtc = params.candleCloseTimeUtc || new Date(next5mCandleCloseMs).toISOString();

    const candleOpenTimeIst = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(new Date(candleOpenTimeUtc)).toUpperCase() + ' IST';

    const candleCloseTimeIst = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(new Date(candleCloseTimeUtc)).toUpperCase() + ' IST';

    // Causal Trigger Definition:
    // CALL / BUY: requires price to break above the signal candle's high
    // PUT / SELL: requires price to break below the signal candle's low
    let triggerPrice: number;
    let invalidationPrice: number;
    let entryCondition: string;

    if (params.direction === 'BUY') {
      triggerPrice = Number((signalHigh + 0.2 * pipUnit).toFixed(isJpy ? 3 : 5));
      invalidationPrice = Number((signalLow - 1.0 * pipUnit).toFixed(isJpy ? 3 : 5));
      entryCondition = `Strict 5M Candle Open (${candleOpenTimeIst}) [Trigger: ${triggerPrice}] · ${expiryMinutes}m Expiry`;
    } else {
      triggerPrice = Number((signalLow - 0.2 * pipUnit).toFixed(isJpy ? 3 : 5));
      invalidationPrice = Number((signalHigh + 1.0 * pipUnit).toFixed(isJpy ? 3 : 5));
      entryCondition = `Strict 5M Candle Open (${candleOpenTimeIst}) [Trigger: ${triggerPrice}] · ${expiryMinutes}m Expiry`;
    }

    // Entry window: valid from next candle open for tests, or from 5m candle open for live
    const entryWindowStartMs = isTest ? (signalCandleMs + 60 * 1000) : next5mCandleOpenMs;
    const entryWindowEndMs = entryWindowStartMs + (expiryMinutes * 60 * 1000);

    const initialHistory: SignalLifecycleEvent[] = [
      {
        timestamp: nowUtc,
        fromState: 'DETECTED',
        toState: 'WAITING_FOR_ENTRY',
        reason: `3-Minute Advance Signal Detected. Trade strictly scheduled for 5M Candle Open (${candleOpenTimeIst}). Expiry: ${expiryMinutes}m (${candleCloseTimeIst}).`,
      },
    ];

    const istString = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(now).toUpperCase() + ' IST';

    const defaultStrategyName = params.strategyName || (
      params.ruleFamily.includes('momentum')
        ? '5-Min Momentum Breakout'
        : params.ruleFamily.includes('wick')
        ? '10-Min Liquidity Wick Reversal'
        : params.ruleFamily.includes('mean_reversion')
        ? '15-Min Statistical Mean Reversion'
        : params.ruleFamily.includes('range')
        ? '20-Min Volatility Range Breakout'
        : '30-Min Order Flow Expansion'
    );

    // Never invent a historical win rate for a rule without measured backtest evidence.
    const defaultWinRate = params.strategyWinRate;

    const signal: ResearchSignal = {
      id: `sig_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      symbol: params.symbol,
      direction: params.direction,
      predictionTimeUtc: nowUtc,
      predictionTimeIst: istString,
      signalCandleTime,
      entryCondition,
      entryWindowStartUtc: new Date(entryWindowStartMs).toISOString(),
      entryWindowEndUtc: new Date(entryWindowEndMs).toISOString(),
      triggerPrice,
      invalidationPrice,
      actualEntryTimeUtc: null,
      actualEntryPrice: null,
      entrySource: null,
      expiryMinutes,
      plannedExitTimeUtc: null, // Computed strictly AFTER entry confirmed!
      actualExitTimeUtc: null,
      actualExitPrice: null,
      confidence: params.confidence,
      // Confidence is currently a heuristic signal-strength score, not a calibrated probability.
      calibrationStatus: 'UNCALIBRATED',
      lifecycleState: 'WAITING_FOR_ENTRY',
      lifecycleHistory: initialHistory,
      grossReturnPips: null,
      estimatedSpreadPips: this.spreadsPips[params.symbol] || 1.5,
      netReturnPips: null,
      payoutPct: params.payoutPct ?? DEFAULT_BINARY_PAYOUT_PERCENT,
      payoutSource: params.payoutSource ?? 'ASSUMED_MINIMUM',
      netReturnUnits: null,
      outcomeResult: 'PENDING',
      ruleFamily: params.ruleFamily,
      modelVersion: params.modelVersion,
      notes: params.notes,
      strategyName: defaultStrategyName,
      strategyWinRate: defaultWinRate,
      strategyHistoricalSampleSize: params.strategyHistoricalSampleSize,
      strategyEvidenceStatus: params.strategyEvidenceStatus,
      strategyId: params.strategyId || `rule:${params.ruleFamily}`,
      advanceNoticeMinutes: 3,
      candleOpenTimeUtc,
      candleCloseTimeUtc,
      candleOpenTimeIst,
      candleCloseTimeIst,
      marketSession: getSessionFromTimestamp(now).id,
      marketSessionName: getSessionFromTimestamp(now).name,
      confluenceStrategies: params.confluenceStrategies || [defaultStrategyName],
      confluenceScore: params.confluenceScore || 1,
      isStackedStrategy: params.isStackedStrategy ?? false,
      isNovelAiSynthesized: params.isNovelAiSynthesized ?? false,
      synthesizedGeneId: params.synthesizedGeneId,
      mathematicalFormula: params.mathematicalFormula,
      whyHumansMissThis: params.whyHumansMissThis,
      paperOnly: params.paperOnly ?? false,
      brokerEligibility: params.brokerEligibility,
    };

    // Freeze the new shadow model's prediction at signal creation using only real
    // candles available at that time. Never reconstruct these features at settlement.
    const predictionCandleMs = params.signalCandle.timestampMs;
    if (params.signalCandle.source !== 'synthetic' &&
        Number.isFinite(predictionCandleMs) &&
        predictionCandleMs > 0) {
      const causalByTimestamp = new Map<number, Candle>();
      for (const candle of db.getCandles(params.symbol, 500)) {
        if (candle && candle.source !== 'synthetic' &&
            Number.isFinite(candle.timestampMs) &&
            candle.timestampMs <= predictionCandleMs) {
          causalByTimestamp.set(candle.timestampMs, candle);
        }
      }
      causalByTimestamp.set(predictionCandleMs, params.signalCandle);
      const predictionHistory = Array.from(causalByTimestamp.values())
        .sort((a, b) => a.timestampMs - b.timestampMs)
        .slice(-500);
      if (predictionHistory.length >= 20 &&
          predictionHistory[predictionHistory.length - 1].timestampMs === predictionCandleMs) {
        const marketFeatureVector = agiSelfLearningEngine.extractFeatureVector(
          params.signalCandle,
          predictionHistory,
        );
        if (marketFeatureVector.length === 19 && marketFeatureVector.every(Number.isFinite)) {
          const prediction = db.predictOnlineOutcome({
            symbol: params.symbol,
            direction: params.direction,
            ruleFamily: params.ruleFamily,
            marketFeatureVector,
          });
          signal.marketFeatureVector = [...marketFeatureVector];
          signal.onlineLearnerPrediction = prediction.probability;
          signal.onlineLearnerSampleSize = prediction.sampleSize;
          signal.onlineLearnerVersion = prediction.version;

          // Read-only regime classification for shadow telemetry (must NOT mutate live regimeCache)
          const regime = agiSelfLearningEngine.classifyMarketRegime(params.symbol, predictionHistory, false);
          signal.predictionMarketRegime = regime.regimeType;

          // Compute strictly causal shadow calibrated evaluation (NEVER modifies live signal confidence/execution)
          const nowMs = Date.parse(nowUtc);
          const priorSettledRecords: PriorEpisodeRecord[] = db
            .getSignals(false)
            .filter(s => {
              if (s.lifecycleState !== 'CLOSED') return false;
              if (s.outcomeResult !== 'WIN' && s.outcomeResult !== 'LOSS') return false;
              if (s.ruleFamily?.startsWith('test_')) return false;
              const settledAtMs = Date.parse(s.actualExitTimeUtc || s.plannedExitTimeUtc || s.predictionTimeUtc);
              return Number.isFinite(settledAtMs) && settledAtMs <= nowMs;
            })
            .map(s => ({
              symbol: s.symbol,
              direction: s.direction,
              ruleFamily: s.ruleFamily,
              strategyId: s.strategyId,
              outcome: s.outcomeResult as 'WIN' | 'LOSS',
              netReturnUnits:
                typeof s.netReturnUnits === 'number' && Number.isFinite(s.netReturnUnits)
                  ? s.netReturnUnits
                  : s.outcomeResult === 'WIN'
                    ? (s.payoutPct || 80) / 100
                    : -1,
              regimeType: s.predictionMarketRegime,
              marketFeatureVector: s.marketFeatureVector,
              rawScoreProb: s.shadowCandidate?.rawProbability,
            }));

          const mlpFwd = onlinePolicyNetwork.forward(marketFeatureVector);
          const mlpTel = onlinePolicyNetwork.getTelemetry();
          const v2Eval = onlinePolicyNetwork.evaluateLinUcbV2(marketFeatureVector, params.direction);

          signal.shadowCandidate = evaluateShadowCandidate({
            symbol: params.symbol,
            direction: params.direction,
            ruleFamily: params.ruleFamily,
            strategyId: signal.strategyId,
            payoutPct: signal.payoutPct,
            marketFeatureVector,
            ftrlProbability: prediction.probability,
            ftrlSampleSize: prediction.sampleSize,
            mlpUpProbability: mlpFwd.probabilityUp,
            mlpStepCount: mlpTel.stepCount,
            mlpOosBce: mlpTel.validationLossOos,
            linUcbV2Score: v2Eval.ucbScore,
            linUcbV2Obs: v2Eval.actionObservations,
            regime,
            priorSettledRecords,
          });

          const knnEval = onlinePolicyNetwork.queryEpisodicKNN(
            marketFeatureVector,
            params.symbol,
            params.direction
          );
          const immuneEval = agiSelfLearningEngine.evaluateAntidoteImmuneResistance(
            params.symbol,
            params.direction,
            params.signalCandle
          );
          signal.agentDebate = multiAgentCouncil.evaluateSignalDebate({
            symbol: params.symbol,
            direction: params.direction,
            ruleFamily: params.ruleFamily,
            strategyId: signal.strategyId,
            payoutPct: signal.payoutPct,
            marketFeatureVector,
            regime,
            ftrlProbability: prediction.probability,
            ftrlSampleSize: prediction.sampleSize,
            mlpUpProbability: mlpFwd.probabilityUp,
            mlpStepCount: mlpTel.stepCount,
            mlpOosBce: mlpTel.validationLossOos,
            linUcbV2Score: v2Eval.ucbScore,
            linUcbV2Obs: v2Eval.actionObservations,
            knnWinProbability: knnEval.neighbors >= 4 ? knnEval.localWinRate : null,
            knnSampleCount: knnEval.neighbors,
            immuneDampingPenalty: immuneEval.resistanceApplied ? immuneEval.dampingPenalty : 0,
            priorSettledRecords,
          });

          signal.institutionalRisk = evaluateInstitutionalSignalRisk({
            symbol: params.symbol,
            direction: params.direction,
            payoutPct: signal.payoutPct,
            modelProbability:
              signal.shadowCandidate?.calibratedProbability ??
              signal.agentDebate?.hedgeWeightedProbability ??
              0.5,
            predictionHistory,
            predictionCandleTimestampMs: params.signalCandle.timestampMs,
            openSignals: db.getActiveSignals(),
            allSignals: db.getSignals(false),
            currencyStrengthSnapshot: quantMicrostructure.getCurrencyStrength(),
          });
        }
      }
    }

    return db.addSignal(signal);
  }

  /**
   * Evaluates active research signals against newly arrived completed candles.
   * Advances states through the causal state machine.
   */
  public evaluateSignals(candlesMap: Record<ForexSymbol, Candle[]>, includeTest: boolean = false): ResearchSignal[] {
    const activeSignals = db.getActiveSignals(includeTest);
    const updatedSignals: ResearchSignal[] = [];
    const nowMs = Date.now();

    for (const signal of activeSignals) {
      // Never re-evaluate or mutate an already-closed trade
      if (signal.lifecycleState === 'CLOSED') continue;
      const isTestSignal = signal.ruleFamily?.startsWith('test_');
      const rawCandles = candlesMap[signal.symbol];
      const candles = isTestSignal
        ? rawCandles
        : rawCandles?.filter(c => c && c.source !== 'synthetic');
      if (!candles || candles.length === 0) continue;

      let changed = false;

      // 1. Process WAITING_FOR_ENTRY state
      if (signal.lifecycleState === 'WAITING_FOR_ENTRY') {
        const windowStartMs = Date.parse(signal.entryWindowStartUtc);
        const windowEndMs = Date.parse(signal.entryWindowEndUtc);

        // A. Test Suite Signals: process test triggers
        if (signal.ruleFamily.startsWith('test_')) {
          const windowCandles = candles.filter(
            c => c.timestampMs >= windowStartMs && c.timestampMs <= windowEndMs
          );

          for (const candle of windowCandles) {
            const triggerHit =
              signal.direction === 'BUY'
                ? candle.high >= signal.triggerPrice
                : candle.low <= signal.triggerPrice;

            const invalidationHit =
              signal.direction === 'BUY'
                ? candle.low <= signal.invalidationPrice
                : candle.high >= signal.invalidationPrice;

            if (triggerHit && invalidationHit) {
              signal.lifecycleState = 'AMBIGUOUS';
              signal.outcomeResult = 'CANCELLED';
              signal.lifecycleHistory.push({
                timestamp: new Date().toISOString(),
                fromState: 'WAITING_FOR_ENTRY',
                toState: 'AMBIGUOUS',
                reason: `Both trigger (${signal.triggerPrice}) and invalidation (${signal.invalidationPrice}) crossed in 1m candle at ${candle.timestamp}. Tick ordering indeterminate.`,
                price: candle.close,
              });
              changed = true;
              break;
            }

            if (invalidationHit && !triggerHit) {
              signal.lifecycleState = 'INVALIDATED';
              signal.outcomeResult = 'CANCELLED';
              signal.lifecycleHistory.push({
                timestamp: new Date().toISOString(),
                fromState: 'WAITING_FOR_ENTRY',
                toState: 'INVALIDATED',
                reason: `Adverse price movement touched invalidation level (${signal.invalidationPrice}) at ${candle.timestamp}.`,
                price: candle.close,
              });
              changed = true;
              break;
            }

            if (triggerHit) {
              const entryFillPrice =
                signal.direction === 'BUY'
                  ? Math.max(candle.open, signal.triggerPrice)
                  : Math.min(candle.open, signal.triggerPrice);

              const entryTimeMs = candle.timestampMs;
              const entryTimeUtc = candle.timestamp;
              const plannedExitMs = entryTimeMs + signal.expiryMinutes * 60 * 1000;
              const plannedExitTimeUtc = new Date(plannedExitMs).toISOString();

              signal.actualEntryTimeUtc = entryTimeUtc;
              signal.actualEntryPrice = entryFillPrice;
              signal.entrySource = candle.source;
              signal.plannedExitTimeUtc = plannedExitTimeUtc;
              signal.lifecycleState = 'ACTIVE';

              signal.lifecycleHistory.push({
                timestamp: new Date().toISOString(),
                fromState: 'WAITING_FOR_ENTRY',
                toState: 'ENTRY_TRIGGERED',
                reason: `Trigger level crossed at ${candle.timestamp}. Entry confirmed at ${entryFillPrice}.`,
                price: entryFillPrice,
              });

              signal.lifecycleHistory.push({
                timestamp: new Date().toISOString(),
                fromState: 'ENTRY_TRIGGERED',
                toState: 'ACTIVE',
                reason: `Active position underway. Expiry scheduled for ${plannedExitTimeUtc} (${signal.expiryMinutes}m duration).`,
                price: entryFillPrice,
              });

              changed = true;
              break;
            }
          }
        } else if (signal.candleOpenTimeUtc) {
          // B. Strict live paper entry: only the exact scheduled M5-open candle is eligible.
          // Providers may deliver that minute late, so wait up to one full M5 window for the
          // matching timestamp. Never substitute a nearby/latest candle or its close.
          const candleOpenMs = Date.parse(signal.candleOpenTimeUtc);
          if (Number.isFinite(candleOpenMs) && nowMs >= candleOpenMs) {
            const allCandles = [
              ...candles,
              ...db.getCandles(signal.symbol, 200).filter(c => c.source !== 'synthetic'),
            ];
            const entryCandle = findExactEntryCandle(allCandles, signal.symbol, candleOpenMs);

            if (entryCandle) {
              const entryFillPrice = entryCandle.open;
              const entryTimeUtc = new Date(candleOpenMs).toISOString();
              const plannedExitMs = candleOpenMs + (signal.expiryMinutes || 5) * 60 * 1000;
              const plannedExitTimeUtc = signal.candleCloseTimeUtc || new Date(plannedExitMs).toISOString();

              signal.actualEntryTimeUtc = entryTimeUtc;
              signal.actualEntryPrice = entryFillPrice;
              signal.entrySource = entryCandle.source;
              signal.plannedExitTimeUtc = plannedExitTimeUtc;
              signal.lifecycleState = 'ACTIVE';

              signal.lifecycleHistory.push({
                timestamp: new Date().toISOString(),
                fromState: 'WAITING_FOR_ENTRY',
                toState: 'ACTIVE',
                reason: `Paper entry matched the exact 5M candle open (${signal.candleOpenTimeIst || entryTimeUtc}) at the candle open price ${entryFillPrice}. Feed arrival was allowed within ${LIVE_ENTRY_BAR_ARRIVAL_GRACE_MS / 60_000} minutes; no adjacent candle was substituted. Expiry: ${signal.expiryMinutes} minutes (${signal.candleCloseTimeIst || plannedExitTimeUtc}).`,
                price: entryFillPrice,
              });
              changed = true;
            } else if (nowMs >= candleOpenMs + LIVE_ENTRY_BAR_ARRIVAL_GRACE_MS) {
              signal.lifecycleState = 'EXPIRED';
              signal.outcomeResult = 'CANCELLED';
              signal.lifecycleHistory.push({
                timestamp: new Date().toISOString(),
                fromState: 'WAITING_FOR_ENTRY',
                toState: 'EXPIRED',
                reason: `The exact 5M entry candle at ${signal.candleOpenTimeUtc} was not delivered within the ${LIVE_ENTRY_BAR_ARRIVAL_GRACE_MS / 60_000}-minute feed-arrival window. No nearby or latest candle was substituted; no contract was filled.`,
              });
              changed = true;
            }
          }
        }

        // If still waiting and window has expired
        const newestCandle = candles[candles.length - 1];
        if (
          signal.lifecycleState === 'WAITING_FOR_ENTRY' &&
          newestCandle.timestampMs > windowEndMs + 10 * 60_000
        ) {
          signal.lifecycleState = 'EXPIRED';
          signal.outcomeResult = 'CANCELLED';
          signal.lifecycleHistory.push({
            timestamp: new Date().toISOString(),
            fromState: 'WAITING_FOR_ENTRY',
            toState: 'EXPIRED',
            reason: `Entry window elapsed (${signal.entryWindowEndUtc}) without trigger condition being satisfied.`,
          });
          changed = true;
        }
      }

      // 2. Process ACTIVE state
      if (!changed && signal.lifecycleState === 'ACTIVE' && signal.plannedExitTimeUtc && signal.actualEntryPrice) {
        const plannedExitMs = Date.parse(signal.plannedExitTimeUtc);
        const newestCandle = candles[candles.length - 1];
        const nowMs = Date.now();
        
        const isTest = signal.ruleFamily?.startsWith('test_');
        const allCandles = isTest
          ? candles
          : candles.concat(db.getCandles(signal.symbol, 300).filter(c => c.source !== 'synthetic'));
        
        // Match the candle closing at expiry: either open time was 1m before (c.timestampMs + 60_000 == plannedExitMs)
        // or close timestamp matches plannedExitMs
        const targetExitCandle = allCandles.find(c =>
          Math.abs((c.timestampMs + 60_000) - plannedExitMs) <= (isTest ? 5_000 : 30_000) ||
          (!isTest && Math.abs(c.timestampMs - plannedExitMs) <= 30_000)
        );
        const exitCandle = targetExitCandle && (isTest || nowMs >= plannedExitMs)
          ? targetExitCandle
          : null;

        if (exitCandle) {
          const isJpy = signal.symbol.includes('JPY');
          const pipFactor = isJpy ? 100 : 10000;
          const exitPrice = exitCandle.close;
          const entryPrice = signal.actualEntryPrice;
          const payoutPct = signal.payoutPct ?? DEFAULT_BINARY_PAYOUT_PERCENT;
          const settlement = calculateBinarySettlement(
            signal.direction,
            entryPrice,
            exitPrice,
            payoutPct
          );
          const grossPips = Number((
            (signal.direction === 'BUY' ? exitPrice - entryPrice : entryPrice - exitPrice) * pipFactor
          ).toFixed(1));

          signal.actualExitTimeUtc = exitCandle.timestamp;
          signal.actualExitPrice = exitPrice;
          signal.grossReturnPips = grossPips; // Informational price movement only; not the contract P/L.
          signal.netReturnPips = null; // Binary options are not scored using forex pip spreads.
          signal.netReturnUnits = settlement.netReturnUnits;
          signal.payoutPct = payoutPct;
          signal.payoutSource = signal.payoutSource ?? 'ASSUMED_MINIMUM';
          signal.outcomeResult = settlement.outcome;
          signal.lifecycleState = 'CLOSED';

          const unitText = settlement.netReturnUnits > 0
            ? `+${settlement.netReturnUnits.toFixed(2)} stake units`
            : settlement.netReturnUnits < 0
              ? `${settlement.netReturnUnits.toFixed(2)} stake units`
              : '0.00 stake units (push)';
          signal.lifecycleHistory.push({
            timestamp: new Date().toISOString(),
            fromState: 'ACTIVE',
            toState: 'CLOSED',
            reason: `Binary contract expired at ${signal.plannedExitTimeUtc}. Entry ${entryPrice}; expiry ${exitPrice}; payout ${payoutPct}% (${signal.payoutSource}); result ${settlement.outcome}; return ${unitText}.`,
            price: exitPrice,
          });

          // Continuous AGI & Online Neural Closed-Loop Learning (strictly causal entry-time features)
          

          changed = true;
        } else if (isTest && newestCandle.timestampMs + 60_000 > plannedExitMs) {
          // Unit test fixture strict assertion: test observations must expire unscored if target candle is missing
          signal.lifecycleState = 'EXPIRED';
          signal.outcomeResult = 'CANCELLED';
          signal.lifecycleHistory.push({
            timestamp: new Date().toISOString(),
            fromState: 'ACTIVE',
            toState: 'EXPIRED',
            reason: `Exact binary expiry candle was missing at ${signal.plannedExitTimeUtc}; no later candle was substituted, so no WIN/LOSS was recorded.`,
          });
        } else if (!isTest && nowMs >= plannedExitMs) {
          // If past planned exit by more than 2 minutes, resolve immediately with current/latest candle
          if (nowMs >= plannedExitMs + 2 * 60_000 && newestCandle) {
            const isJpy = signal.symbol.includes('JPY');
            const pipFactor = isJpy ? 100 : 10000;
            const exitPrice = newestCandle.close;
            const entryPrice = signal.actualEntryPrice;
            const payoutPct = signal.payoutPct ?? DEFAULT_BINARY_PAYOUT_PERCENT;
            const settlement = calculateBinarySettlement(
              signal.direction,
              entryPrice,
              exitPrice,
              payoutPct
            );
            const grossPips = Number((
              (signal.direction === 'BUY' ? exitPrice - entryPrice : entryPrice - exitPrice) * pipFactor
            ).toFixed(1));

            const previousState = signal.lifecycleState;
            signal.actualExitTimeUtc = newestCandle.timestamp;
            signal.actualExitPrice = exitPrice;
            signal.grossReturnPips = grossPips;
            signal.netReturnPips = null;
            signal.netReturnUnits = settlement.netReturnUnits;
            signal.outcomeResult = settlement.outcome;
            signal.lifecycleState = 'CLOSED';

            signal.lifecycleHistory.push({
              timestamp: new Date().toISOString(),
              fromState: previousState,
              toState: 'CLOSED',
              reason: `Binary contract expired at ${signal.plannedExitTimeUtc}. Reconciled with real feed tick at ${exitPrice}; outcome: ${settlement.outcome}.`,
              price: exitPrice,
            });

            
            changed = true;
          } else if (signal.lifecycleState === 'ACTIVE') {
            signal.lifecycleState = 'EXIT_PENDING';
            signal.outcomeResult = 'PENDING';
            changed = true;
          }
        }
      }

      // 3. Process EXIT_PENDING state
      if (!changed && signal.lifecycleState === 'EXIT_PENDING' && signal.actualEntryPrice) {
        const plannedExitMs = signal.plannedExitTimeUtc ? Date.parse(signal.plannedExitTimeUtc) : 0;
        const nowMs = Date.now();
        if (nowMs >= plannedExitMs + 2 * 60_000) {
          const newestCandle = candles[candles.length - 1];
          if (newestCandle) {
            const isJpy = signal.symbol.includes('JPY');
            const pipFactor = isJpy ? 100 : 10000;
            const exitPrice = newestCandle.close;
            const entryPrice = signal.actualEntryPrice;
            const payoutPct = signal.payoutPct ?? DEFAULT_BINARY_PAYOUT_PERCENT;
            const settlement = calculateBinarySettlement(
              signal.direction,
              entryPrice,
              exitPrice,
              payoutPct
            );
            const grossPips = Number((
              (signal.direction === 'BUY' ? exitPrice - entryPrice : entryPrice - exitPrice) * pipFactor
            ).toFixed(1));

            signal.actualExitTimeUtc = newestCandle.timestamp;
            signal.actualExitPrice = exitPrice;
            signal.grossReturnPips = grossPips;
            signal.netReturnPips = null;
            signal.netReturnUnits = settlement.netReturnUnits;
            signal.outcomeResult = settlement.outcome;
            signal.lifecycleState = 'CLOSED';

            signal.lifecycleHistory.push({
              timestamp: new Date().toISOString(),
              fromState: 'EXIT_PENDING',
              toState: 'CLOSED',
              reason: `Settled from feed candle: ${exitPrice}. Outcome: ${settlement.outcome}.`,
              price: exitPrice,
            });

            
            changed = true;
          }
        }
      }

      if (changed) {
        // updateSignal synchronously persists a newly CLOSED result before any
        // downstream model, bandit, or episodic-memory update can run.
        db.updateSignal(signal);
        if (signal.lifecycleState === 'CLOSED' &&
            (signal.outcomeResult === 'WIN' || signal.outcomeResult === 'LOSS')) {
          this.triggerClosedLoopLearning(signal, candles);
        }
        updatedSignals.push(signal);
      }
    }

    return updatedSignals;
  }

  /**
   * Sweeps and reconciles any active, waiting, or prematurely-expired signals strictly against real verified candles.
   * NEVER fabricates synthetic prices or fake WINs when real candle data is unavailable.
   */
  public sweepStaleActiveSignals(candlesMap?: Partial<Record<ForexSymbol, Candle[]>>): ResearchSignal[] {
    const activeSignals = db.getActiveSignals();
    const nowMs = Date.now();
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const updated: ResearchSignal[] = [];

    const getVerifiedRealCandles = (symbol: ForexSymbol): Candle[] => {
      const fresh = (candlesMap?.[symbol] || []).filter(c => c && c.source !== 'synthetic');
      const stored = db.getCandles(symbol, 500).filter(c => c && c.source !== 'synthetic');
      if (fresh.length === 0) return stored;
      const byTs = new Map<number, Candle>();
      for (const c of stored) byTs.set(c.timestampMs, c);
      for (const c of fresh) byTs.set(c.timestampMs, c);
      return Array.from(byTs.values()).sort((a, b) => a.timestampMs - b.timestampMs);
    };

    const findExactExpiryCandle = (realCandles: Candle[], exitTimeMs: number): Candle | undefined => {
      let best: Candle | undefined;
      let bestDist = Infinity;
      for (const c of realCandles) {
        const distClose = Math.abs((c.timestampMs + 60_000) - exitTimeMs);
        const distOpen = Math.abs(c.timestampMs - exitTimeMs);
        const dist = Math.min(distClose, distOpen);
        if (dist <= 90_000 && dist < bestDist) {
          best = c;
          bestDist = dist;
        }
      }
      return best;
    };

    for (const signal of activeSignals) {
      if (signal.lifecycleState === 'CLOSED') continue;

      const exitTimeMs = signal.plannedExitTimeUtc ? Date.parse(signal.plannedExitTimeUtc) : 0;
      const entryTimeMs = signal.actualEntryTimeUtc
        ? Date.parse(signal.actualEntryTimeUtc)
        : signal.candleOpenTimeUtc
        ? Date.parse(signal.candleOpenTimeUtc)
        : Date.parse(signal.predictionTimeUtc);

      const realCandles = getVerifiedRealCandles(signal.symbol);

      // 1. If active / exit-pending and past expiry, settle ONLY using a real verified candle within ±90s of expiry
      if (exitTimeMs > 0 && nowMs >= exitTimeMs && signal.actualEntryPrice) {
        const candle = findExactExpiryCandle(realCandles, exitTimeMs);

        if (candle) {
          const previousState = signal.lifecycleState;
          const isJpy = signal.symbol.includes('JPY');
          const pipFactor = isJpy ? 100 : 10000;
          const exitPrice = candle.close;
          const entryPrice = signal.actualEntryPrice;
          const payoutPct = signal.payoutPct ?? DEFAULT_BINARY_PAYOUT_PERCENT;
          const settlement = calculateBinarySettlement(
            signal.direction,
            entryPrice,
            exitPrice,
            payoutPct
          );
          const grossPips = Number((
            (signal.direction === 'BUY' ? exitPrice - entryPrice : entryPrice - exitPrice) * pipFactor
          ).toFixed(1));

          signal.actualExitTimeUtc = candle.timestamp;
          signal.actualExitPrice = exitPrice;
          signal.grossReturnPips = grossPips;
          signal.netReturnPips = null;
          signal.netReturnUnits = settlement.netReturnUnits;
          signal.outcomeResult = settlement.outcome;
          signal.lifecycleState = 'CLOSED';

          signal.lifecycleHistory.push({
            timestamp: new Date().toISOString(),
            fromState: previousState,
            toState: 'CLOSED',
            reason: `Reconciled settlement from verified feed (${candle.source}). Entry: ${entryPrice}; Exit: ${exitPrice}; Outcome: ${settlement.outcome}.`,
            price: exitPrice,
          });

          db.updateSignal(signal);
          db.recordForwardObservation(signal);
          db.recordStrategyOutcome(signal);
          this.triggerClosedLoopLearning(signal, realCandles);
          updated.push(signal);
          continue;
        }

        // Only expire unscored if >30m past expiry with NO real candle available (and only after fresh feeds were checked)
        if (candlesMap && nowMs >= exitTimeMs + 30 * 60_000) {
          const previousState = signal.lifecycleState;
          signal.lifecycleState = 'EXPIRED';
          signal.outcomeResult = 'CANCELLED';
          signal.lifecycleHistory.push({
            timestamp: new Date().toISOString(),
            fromState: previousState,
            toState: 'EXPIRED',
            reason: `No verified market candle within ±90s of planned expiry (${signal.plannedExitTimeUtc}); closed unscored without fabricating an outcome.`,
          });
          db.updateSignal(signal);
          updated.push(signal);
          continue;
        }
      }

      // 2. If WAITING_FOR_ENTRY and well past entry window without filling, expire unscored (never fabricate a WIN)
      if (signal.lifecycleState === 'WAITING_FOR_ENTRY' && entryTimeMs > 0) {
        const plannedExitMs = entryTimeMs + (signal.expiryMinutes || 5) * 60 * 1000;
        if (nowMs >= plannedExitMs + 2 * 60_000) {
          signal.lifecycleState = 'EXPIRED';
          signal.outcomeResult = 'CANCELLED';
          signal.lifecycleHistory.push({
            timestamp: new Date().toISOString(),
            fromState: 'WAITING_FOR_ENTRY',
            toState: 'EXPIRED',
            reason: `Entry window elapsed before real feed confirmation; expired unscored.`,
          });
          db.updateSignal(signal);
          updated.push(signal);
        }
      }
    }

    // 3. Reconcile recently prematurely-EXPIRED filled trades if real verified expiry candles are now present
    // (Never touches already-settled CLOSED WIN/LOSS/SCRATCH trades — only unscored EXPIRED/CANCELLED fills)
    const allRecent = db.getSignals(false);
    for (const signal of allRecent) {
      if (signal.lifecycleState !== 'EXPIRED' || signal.outcomeResult !== 'CANCELLED') continue;
      if (!signal.actualEntryPrice || !signal.plannedExitTimeUtc) continue;
      const exitTimeMs = Date.parse(signal.plannedExitTimeUtc);
      if (!exitTimeMs || nowMs - exitTimeMs > ONE_DAY_MS || nowMs < exitTimeMs) continue;

      const lastReason = signal.lifecycleHistory?.[signal.lifecycleHistory.length - 1]?.reason || '';
      if (!lastReason.includes('No verified market candle within')) continue;

      const realCandles = getVerifiedRealCandles(signal.symbol);
      const candle = findExactExpiryCandle(realCandles, exitTimeMs);
      if (!candle) continue;

      const isJpy = signal.symbol.includes('JPY');
      const pipFactor = isJpy ? 100 : 10000;
      const exitPrice = candle.close;
      const entryPrice = signal.actualEntryPrice;
      const payoutPct = signal.payoutPct ?? DEFAULT_BINARY_PAYOUT_PERCENT;
      const settlement = calculateBinarySettlement(
        signal.direction,
        entryPrice,
        exitPrice,
        payoutPct
      );
      const grossPips = Number((
        (signal.direction === 'BUY' ? exitPrice - entryPrice : entryPrice - exitPrice) * pipFactor
      ).toFixed(1));

      signal.actualExitTimeUtc = candle.timestamp;
      signal.actualExitPrice = exitPrice;
      signal.grossReturnPips = grossPips;
      signal.netReturnPips = null;
      signal.netReturnUnits = settlement.netReturnUnits;
      signal.payoutPct = payoutPct;
      signal.outcomeResult = settlement.outcome;
      signal.lifecycleState = 'CLOSED';

      signal.lifecycleHistory.push({
        timestamp: new Date().toISOString(),
        fromState: 'EXPIRED',
        toState: 'CLOSED',
        reason: `Reconciled against verified ${candle.source} expiry candle (${candle.timestamp}). Entry: ${entryPrice}; Exit: ${exitPrice}; Outcome: ${settlement.outcome}.`,
        price: exitPrice,
      });

      db.updateSignal(signal);
      db.recordForwardObservation(signal);
      db.recordStrategyOutcome(signal);
      this.triggerClosedLoopLearning(signal, realCandles);
      updated.push(signal);
    }

    return updated;
  }

  /**
   * Unified closed-loop reinforcement learning trigger called by EVERY settlement branch.
   * ZERO LOOKAHEAD: Uses ONLY the immutable prediction-time `signal.marketFeatureVector`
   * captured when the signal was originally emitted. Never reconstructs features from
   * post-entry candles (`entryTsMs + 60_000` bug removed).
   */
  private triggerClosedLoopLearning(signal: ResearchSignal, _candles: Candle[]) {
    if (signal.ruleFamily?.startsWith('test_')) return;
    if (signal.outcomeResult !== 'WIN' && signal.outcomeResult !== 'LOSS') return;

    const outcome = signal.outcomeResult;
    const netUnits = signal.netReturnUnits ?? (outcome === 'WIN' ? 0.8 : -1.0);
    const exitPrice = signal.actualExitPrice ?? signal.actualEntryPrice ?? signal.triggerPrice;
    const observedAt = signal.actualExitTimeUtc || signal.plannedExitTimeUtc || new Date().toISOString();

    if (hasTrustedPredictionFeatures(signal)) {
      const featureVec = signal.marketFeatureVector!;

      const episodicRecorded = agiSelfLearningEngine.recordTradeOutcomeEpisode(
        signal,
        featureVec,
        exitPrice,
        outcome,
        netUnits
      );

      const stepRes = onlinePolicyNetwork.trainStep(
        featureVec,
        signal.direction,
        outcome,
        netUnits,
        signal.symbol,
        signal.id,
        observedAt
      );

      const mlpTrained = !stepRes.duplicateBlocked && stepRes.step > 0;
      const linUcbV2Trained = Boolean(stepRes.linUcbV2Trained) && !stepRes.linUcbV2DuplicateBlocked;
      const councilRes = multiAgentCouncil.trainFromSettledSignal(signal);

      signal.trainingAudit = {
        ...(signal.trainingAudit || { ftrlTrained: false }),
        mlpTrained,
        mlpSkippedReason: mlpTrained
          ? undefined
          : stepRes.duplicateBlocked
            ? 'ALREADY_TRAINED'
            : 'NOT_TRAINED',
        linUcbV2Trained,
        linUcbV2SkippedReason: linUcbV2Trained
          ? undefined
          : stepRes.linUcbV2DuplicateBlocked
            ? 'ALREADY_TRAINED'
            : 'NOT_TRAINED',
        episodicRecorded,
        episodicSkippedReason: episodicRecorded ? undefined : 'ALREADY_TRAINED',
        councilTrained: councilRes.trained,
        councilSkippedReason: councilRes.trained ? undefined : councilRes.skippedReason,
        trainedAtUtc:
          mlpTrained || linUcbV2Trained || episodicRecorded || councilRes.trained
            ? observedAt
            : signal.trainingAudit?.trainedAtUtc,
      };
      db.updateSignal(signal);
    } else {
      // No frozen prediction-time features: classify transparently as skipped without fabricating future features.
      onlinePolicyNetwork.recordSkippedTraining(signal.id, 'MISSING_FROZEN_PREDICTION_FEATURES');
      const councilRes = multiAgentCouncil.trainFromSettledSignal(signal);
      signal.trainingAudit = {
        ...(signal.trainingAudit || { ftrlTrained: false }),
        mlpTrained: false,
        mlpSkippedReason: 'MISSING_FROZEN_PREDICTION_FEATURES',
        linUcbV2Trained: false,
        linUcbV2SkippedReason: 'MISSING_FROZEN_PREDICTION_FEATURES',
        episodicRecorded: false,
        episodicSkippedReason: 'MISSING_FROZEN_PREDICTION_FEATURES',
        councilTrained: councilRes.trained,
        councilSkippedReason: councilRes.trained ? undefined : councilRes.skippedReason,
      };
      db.updateSignal(signal);

      // Strategy Bandit updates strictly on strategyId + outcome (zero candle leakage)
      const strategyId = signal.strategyId || signal.synthesizedGeneId || `rule:${signal.ruleFamily}`;
      agiSelfLearningEngine.updateBanditArm(strategyId, outcome, signal.strategyName);
    }
  }
}

export const entryExitEngine = new EntryExitEngine();

