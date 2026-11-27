/**
 * SignalForge ML — Isolated Shadow-Only Self-Reverse-Engineering Engine
 *
 * Strictly isolated experiment workspace & database (`data/reverse_engineering_experiment.db.json`):
 * - NEVER modifies `data/signalforge.db.json`, production models, or live trading decisions.
 * - Inspects SignalForge's own decision pipeline (frozen 19D features, stacked confluences,
 *   regimes, rule families, confidence, expiries) strictly causally without future data leakage.
 * - Separates correct vs. incorrect predictions on Train only, synthesizes experimental
 *   adversarial policies, freezes top candidates on Validation, and evaluates once on Untouched OOS Test.
 * - Compares 4 models on identical timestamps, pairs, expiries, and settlement prices:
 *     A. Original SignalForge predictions
 *     B. Simple direction inversion (BUY <-> SELL)
 *     C. Autonomous self-reverse-engineered candidate (target < 30% OOS accuracy)
 *     D. Random directional baseline (seeded 50/50)
 */

import fs from 'fs';
import path from 'path';
import {
  Candle,
  ForexSymbol,
  FOREX_PAIRS,
  MarketRegimeState,
  ResearchSignal,
  SignalDirection,
} from '../types/index.js';
import { calculateBinarySettlement, DEFAULT_BINARY_PAYOUT_PERCENT } from './binarySettlement.js';
import { agiSelfLearningEngine } from './agiEngine.js';
import { researchEngine } from './researchEngine.js';
import { wilsonInterval } from './shadowPredictor.js';
import { db } from './db.js';
import { historicalDataStore } from './historicalData.js';

export type ReverseModelKey =
  | 'ORIGINAL'
  | 'SIMPLE_INVERSION'
  | 'AUTONOMOUS_REVERSE_ENGINEERED'
  | 'RANDOM_BASELINE';

export interface ReverseDecisionSnapshot {
  id: string;
  sourceKind: 'SETTLED_SIGNAL' | 'HISTORICAL_M1_REPLAY';
  symbol: ForexSymbol;
  expiryMinutes: number;
  timestampUtc: string;
  entryTimeUtc: string;
  exitTimeUtc: string;
  originalPrediction: SignalDirection;
  actualOutcome: 'WIN' | 'LOSS' | 'SCRATCH';
  entryPrice: number;
  exitPrice: number;
  payoutPct: number;
  confidence: number;
  ruleFamily: string;
  strategyId: string;
  confluenceItems: string[];
  confluenceScore: number;
  marketRegime: MarketRegimeState['regimeType'] | 'UNKNOWN';
  featureVector: number[];
  hasValidFeatures: boolean;
  indicatorSummary: {
    emaSpread: number;
    rsi14: number;
    wickImbalance: number;
    deviationPips: number;
    bodyRatio: number;
    pos34: number;
    volRatio: number;
  };
}

export interface GroupAccuracyBreakdown {
  key: string;
  predictions: number;
  scored: number;
  wins: number;
  losses: number;
  scratches: number;
  accuracyPct: number | null;
}

export interface ModelEvaluationSummary {
  modelKey: ReverseModelKey;
  modelLabel: string;
  predictions: number;
  scored: number;
  wins: number;
  losses: number;
  scratches: number;
  accuracyPct: number | null;
  wilson95CiPct: [number, number] | null;
  comparisonVsRandomDeltaPct: number | null;
  byPair: GroupAccuracyBreakdown[];
  byExpiry: GroupAccuracyBreakdown[];
  byRegime: GroupAccuracyBreakdown[];
}

export interface FeatureEffectProfile {
  featureIndex: number;
  featureName: string;
  winMean: number;
  lossMean: number;
  effectSizeD: number;
}

export interface PatternPocketSummary {
  dimension: 'RULE_FAMILY' | 'REGIME' | 'DIRECTION' | 'EXPIRY' | 'CONFIDENCE_BAND';
  key: string;
  count: number;
  wins: number;
  losses: number;
  accuracyPct: number;
  patternRole: 'HIGH_ACCURACY_INVERT_TARGET' | 'TOXIC_FAILURE_KEEP_TARGET' | 'NEUTRAL';
}

export type CandidateTransformFamily =
  | 'LINEAR_LOG_ODDS'
  | 'CONDITIONAL_POCKET'
  | 'FEATURE_PERTURBATION'
  | 'ADVERSARIAL_ENSEMBLE';

export interface ReverseCandidateGenome {
  candidateId: string;
  name: string;
  family: CandidateTransformFamily;
  featureWeights: number[]; // 19D weights predicting P(original WINS)
  bias: number;
  invertThreshold: number; // Invert original when P_hat(orig WINS) >= invertThreshold
  keepThreshold: number; // Keep original when P_hat(orig WINS) <= keepThreshold
  useRulePockets: boolean;
  useRegimePockets: boolean;
  ruleFlipMap: Record<string, boolean>; // fallback orientation per ruleFamily derived from train
  regimeFlipMap: Record<string, boolean>; // fallback orientation per regime derived from train
  trainAccuracyPct: number;
  trainScored: number;
  validationAccuracyPct: number;
  validationScored: number;
  validationVsInversionDeltaPct: number;
}

export interface FailureAnalysisReport {
  trainSampleCount: number;
  trainWins: number;
  trainLosses: number;
  trainBaselineAccuracyPct: number | null;
  topDivergentFeatures: FeatureEffectProfile[];
  patternPockets: PatternPocketSummary[];
  highAccuracyPocketsCount: number;
  naturalFailurePocketsCount: number;
}

export interface ReverseExperimentRun {
  experimentId: string;
  createdAtUtc: string;
  dataSourceMode: 'REAL_SETTLED_AND_HISTORY' | 'SETTLED_LEDGER_ONLY' | 'HISTORICAL_M1_REPLAY_ONLY';
  sampleSufficiency: 'SUFFICIENT' | 'PRELIMINARY' | 'INSUFFICIENT_SAMPLE';
  datasetCounts: {
    totalSnapshots: number;
    scoredWinLoss: number;
    scratches: number;
    with19DFeatures: number;
    trainCount: number;
    embargoTrainValSkipped: number;
    validationCount: number;
    embargoValTestSkipped: number;
    unseenTestCount: number;
  };
  verifiedBaselineAll: {
    predictions: number;
    scored: number;
    wins: number;
    losses: number;
    accuracyPct: number | null;
    wilson95CiPct: [number, number] | null;
  };
  failureAnalysis: FailureAnalysisReport;
  frozenCandidate: ReverseCandidateGenome | null;
  candidatesEvaluatedCount: number;
  unseenFourWayComparison: {
    original: ModelEvaluationSummary;
    simpleInversion: ModelEvaluationSummary;
    autonomousReverseEngineered: ModelEvaluationSummary;
    randomBaseline: ModelEvaluationSummary;
  };
  fullChronologicalComparison: {
    original: ModelEvaluationSummary;
    simpleInversion: ModelEvaluationSummary;
    autonomousReverseEngineered: ModelEvaluationSummary;
    randomBaseline: ModelEvaluationSummary;
  };
  walkForwardFolds: Array<{
    foldIndex: number;
    trainSize: number;
    testSize: number;
    originalAccPct: number | null;
    inversionAccPct: number | null;
    autonomousAccPct: number | null;
    randomAccPct: number | null;
  }>;
  promotionDecision: {
    promoted: boolean;
    targetPrimaryMet: boolean; // unseen OOS < 30%
    targetSecondaryMet: boolean; // unseen OOS <= 25%
    beatsSimpleInversion: boolean;
    beatsRandomDegradation: boolean; // lower accuracy than random (< 50%)
    verdict: 'PROMOTED_UNDER_30' | 'REJECTED_INSUFFICIENT_SAMPLE' | 'REJECTED_ABOVE_30_OOS' | 'REJECTED_WORSE_THAN_INVERSION';
    rationale: string;
  };
}

export interface ReverseEngineeringDbState {
  version: number;
  lastUpdatedUtc: string | null;
  continuousCyclesRun: number;
  snapshots: ReverseDecisionSnapshot[];
  experiments: ReverseExperimentRun[];
  promotedChampion: ReverseCandidateGenome | null;
  continuousHistory: Array<{
    cycleAtUtc: string;
    totalSnapshots: number;
    unseenOriginalAccPct: number | null;
    unseenInversionAccPct: number | null;
    unseenAutonomousAccPct: number | null;
    unseenRandomAccPct: number | null;
    promotedCandidateId: string | null;
    verdict: string;
  }>;
}

const FEATURE_NAMES_19D = [
  'ret1',
  'ret3',
  'ret5',
  'ret13',
  'bodyDirection',
  'bodyRatio',
  'wickImbalance',
  'closeLocation',
  'rangeExpansion',
  'emaSpread',
  'emaCurvature',
  'rsiProxy',
  'rsiMomentum',
  'pos13',
  'pos34',
  'volRatio',
  'directionalEfficiency',
  'autoCorr',
  'wickPressureChange',
];

function sigmoid(x: number): number {
  const z = Math.max(-20, Math.min(20, x));
  return 1 / (1 + Math.exp(-z));
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function round(v: number, digits = 2): number {
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

/** Deterministic PRNG seeded cleanly per snapshot so random baseline is reproducible & non-adaptive. */
function deterministicRandomDir(seedStr: string): SignalDirection {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2 === 0 ? 'BUY' : 'SELL';
}

function flipDir(dir: SignalDirection): SignalDirection {
  return dir === 'BUY' ? 'SELL' : 'BUY';
}

function resolveSnapshotOutcomeForDirection(
  snap: ReverseDecisionSnapshot,
  chosenDir: SignalDirection
): 'WIN' | 'LOSS' | 'SCRATCH' {
  if (snap.actualOutcome === 'SCRATCH') return 'SCRATCH';
  if (snap.entryPrice > 0 && snap.exitPrice > 0 && snap.entryPrice !== snap.exitPrice) {
    const settled = calculateBinarySettlement(chosenDir, snap.entryPrice, snap.exitPrice, snap.payoutPct || 80);
    return settled.outcome;
  }
  return chosenDir === snap.originalPrediction
    ? snap.actualOutcome
    : snap.actualOutcome === 'WIN'
      ? 'LOSS'
      : 'WIN';
}

function groupAccuracy(
  rows: Array<{ snap: ReverseDecisionSnapshot; outcome: 'WIN' | 'LOSS' | 'SCRATCH' }>,
  keyFn: (s: ReverseDecisionSnapshot) => string
): GroupAccuracyBreakdown[] {
  const map = new Map<string, { predictions: number; wins: number; losses: number; scratches: number }>();
  for (const row of rows) {
    const k = keyFn(row.snap);
    const cur = map.get(k) || { predictions: 0, wins: 0, losses: 0, scratches: 0 };
    cur.predictions++;
    if (row.outcome === 'WIN') cur.wins++;
    else if (row.outcome === 'LOSS') cur.losses++;
    else cur.scratches++;
    map.set(k, cur);
  }
  return Array.from(map.entries())
    .map(([key, g]) => {
      const scored = g.wins + g.losses;
      return {
        key,
        predictions: g.predictions,
        scored,
        wins: g.wins,
        losses: g.losses,
        scratches: g.scratches,
        accuracyPct: scored > 0 ? round((g.wins / scored) * 100, 2) : null,
      };
    })
    .sort((a, b) => b.scored - a.scored || a.key.localeCompare(b.key));
}

function summarizeModelOnSet(
  modelKey: ReverseModelKey,
  modelLabel: string,
  snapshots: ReverseDecisionSnapshot[],
  predictFn: (snap: ReverseDecisionSnapshot) => SignalDirection
): ModelEvaluationSummary {
  const evaluated = snapshots.map((snap) => {
    const dir = predictFn(snap);
    const outcome = resolveSnapshotOutcomeForDirection(snap, dir);
    return { snap, outcome };
  });
  const wins = evaluated.filter((r) => r.outcome === 'WIN').length;
  const losses = evaluated.filter((r) => r.outcome === 'LOSS').length;
  const scratches = evaluated.filter((r) => r.outcome === 'SCRATCH').length;
  const scored = wins + losses;
  const accuracyPct = scored > 0 ? round((wins / scored) * 100, 2) : null;
  const ci = scored > 0 ? wilsonInterval(wins, scored) : null;

  return {
    modelKey,
    modelLabel,
    predictions: evaluated.length,
    scored,
    wins,
    losses,
    scratches,
    accuracyPct,
    wilson95CiPct: ci ? [round(ci.lower * 100, 2), round(ci.upper * 100, 2)] : null,
    comparisonVsRandomDeltaPct: accuracyPct !== null ? round(accuracyPct - 50, 2) : null,
    byPair: groupAccuracy(evaluated, (s) => s.symbol),
    byExpiry: groupAccuracy(evaluated, (s) => `${s.expiryMinutes}m`),
    byRegime: groupAccuracy(evaluated, (s) => s.marketRegime),
  };
}

function getSessionShortFromMs(ms: number): { id: string; shortName: string } {
  const d = new Date(ms);
  const hour = d.getUTCHours();
  if (hour >= 12 && hour < 16) return { id: 'OVERLAP', shortName: 'Overlap' };
  if (hour >= 7 && hour < 12) return { id: 'LONDON', shortName: 'London' };
  if (hour >= 16 && hour < 21) return { id: 'NEW_YORK', shortName: 'New York' };
  return { id: 'ASIA', shortName: 'Asia' };
}

export class ReverseEngineeringEngine {
  private readonly overrideDbPath?: string;
  private state: ReverseEngineeringDbState;

  constructor(customDbPath?: string) {
    this.overrideDbPath = customDbPath;
    this.state = this.loadState();
  }

  private getDbPath(): string {
    return (
      this.overrideDbPath ||
      process.env.SIGNALFORGE_REVERSE_DB_PATH ||
      path.resolve(process.cwd(), 'data', 'reverse_engineering_experiment.db.json')
    );
  }

  private createEmptyState(): ReverseEngineeringDbState {
    return {
      version: 1,
      lastUpdatedUtc: null,
      continuousCyclesRun: 0,
      snapshots: [],
      experiments: [],
      promotedChampion: null,
      continuousHistory: [],
    };
  }

  private loadState(): ReverseEngineeringDbState {
    const dbPath = this.getDbPath();
    try {
      if (!fs.existsSync(dbPath)) {
        return this.createEmptyState();
      }
      const parsed = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
      return {
        ...this.createEmptyState(),
        ...parsed,
        snapshots: Array.isArray(parsed?.snapshots) ? parsed.snapshots : [],
        experiments: Array.isArray(parsed?.experiments) ? parsed.experiments : [],
        continuousHistory: Array.isArray(parsed?.continuousHistory) ? parsed.continuousHistory : [],
      };
    } catch {
      return this.createEmptyState();
    }
  }

  private saveStateSync() {
    const dbPath = this.getDbPath();
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.state.lastUpdatedUtc = new Date().toISOString();
    const payload = JSON.stringify(this.state);
    const tmpPath = `${dbPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, payload, 'utf-8');
    try {
      fs.renameSync(tmpPath, dbPath);
    } catch {
      fs.writeFileSync(dbPath, payload, 'utf-8');
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {
        // Ignore cleanup failure
      }
    }
  }

  public getState(): ReverseEngineeringDbState {
    return {
      ...this.state,
      snapshots: this.state.snapshots.slice(-300),
      experiments: this.state.experiments.slice(0, 20),
      continuousHistory: this.state.continuousHistory.slice(0, 50),
    };
  }

  /**
   * Collects preserved decision snapshots from settled SignalForge DB signals (read-only)
   * without touching any production state. Reconstructs causal 19D features from candles
   * strictly <= prediction candle time when historical rows predate vector freezing.
   */
  public extractSettledSignalSnapshots(): ReverseDecisionSnapshot[] {
    const rawSignals = db
      .getSignals(false)
      .filter(
        (s) =>
          s.lifecycleState === 'CLOSED' &&
          (s.outcomeResult === 'WIN' || s.outcomeResult === 'LOSS' || s.outcomeResult === 'SCRATCH') &&
          !s.ruleFamily?.startsWith('test_') &&
          FOREX_PAIRS.includes(s.symbol)
      );

    const out: ReverseDecisionSnapshot[] = [];
    for (const sig of rawSignals) {
      const predMs = Date.parse(sig.signalCandleTime || sig.predictionTimeUtc || '');
      const entryPrice = Number(sig.actualEntryPrice || sig.triggerPrice || 0);
      const exitPrice = Number(sig.actualExitPrice || 0);
      if (!Number.isFinite(predMs) || entryPrice <= 0 || exitPrice <= 0) continue;

      let vec: number[] = new Array(19).fill(0);
      let hasValidFeatures = false;
      let marketRegime: ReverseDecisionSnapshot['marketRegime'] = sig.predictionMarketRegime || 'UNKNOWN';

      if (Array.isArray(sig.marketFeatureVector) && sig.marketFeatureVector.length === 19 && sig.marketFeatureVector.every(Number.isFinite)) {
        vec = [...sig.marketFeatureVector];
        hasValidFeatures = true;
      } else {
        // Causal reconstruction ONLY from stored non-synthetic candles strictly <= signal candle time
        const allPairCandles = [
          ...(historicalDataStore.getCandles(sig.symbol) || []),
          ...(db.getCandles(sig.symbol, 500) || []),
        ].filter((c) => c && c.source !== 'synthetic' && c.timestampMs <= predMs);
        const byTs = new Map<number, Candle>();
        for (const c of allPairCandles) byTs.set(c.timestampMs, c);
        const causal = Array.from(byTs.values()).sort((a, b) => a.timestampMs - b.timestampMs);
        if (causal.length >= 25) {
          vec = agiSelfLearningEngine.extractFeatureVector(causal[causal.length - 1], causal);
          hasValidFeatures = vec.length === 19 && vec.every(Number.isFinite);
          if (marketRegime === 'UNKNOWN' && causal.length >= 40) {
            marketRegime = agiSelfLearningEngine.classifyMarketRegime(sig.symbol, causal, false).regimeType;
          }
        }
      }

      out.push({
        id: `rsnap_sig_${sig.id}`,
        sourceKind: 'SETTLED_SIGNAL',
        symbol: sig.symbol,
        expiryMinutes: sig.expiryMinutes || 5,
        timestampUtc: sig.predictionTimeUtc || new Date(predMs).toISOString(),
        entryTimeUtc: sig.actualEntryTimeUtc || sig.candleOpenTimeUtc || new Date(predMs).toISOString(),
        exitTimeUtc: sig.actualExitTimeUtc || sig.plannedExitTimeUtc || new Date(predMs + (sig.expiryMinutes || 5) * 60_000).toISOString(),
        originalPrediction: sig.direction,
        actualOutcome: sig.outcomeResult as 'WIN' | 'LOSS' | 'SCRATCH',
        entryPrice,
        exitPrice,
        payoutPct: typeof sig.payoutPct === 'number' && Number.isFinite(sig.payoutPct) ? sig.payoutPct : DEFAULT_BINARY_PAYOUT_PERCENT,
        confidence: typeof sig.confidence === 'number' && Number.isFinite(sig.confidence) ? sig.confidence : 0.72,
        ruleFamily: sig.ruleFamily || 'unknown',
        strategyId: sig.strategyId || `rule:${sig.ruleFamily || 'unknown'}`,
        confluenceItems: Array.isArray(sig.confluenceStrategies) ? [...sig.confluenceStrategies] : [],
        confluenceScore: sig.confluenceScore || 2,
        marketRegime,
        featureVector: vec,
        hasValidFeatures,
        indicatorSummary: {
          emaSpread: round(vec[9] || 0, 3),
          rsi14: round(50 + (vec[11] || 0) * 50, 1),
          wickImbalance: round(vec[6] || 0, 3),
          deviationPips: round(vec[3] || 0, 2),
          bodyRatio: round(vec[5] || 0, 3),
          pos34: round(vec[14] || 0, 3),
          volRatio: round(vec[15] || 0, 3),
        },
      });
    }

    return out.sort((a, b) => Date.parse(a.timestampUtc) - Date.parse(b.timestampUtc) || a.id.localeCompare(b.id));
  }

  /**
   * Replays SignalForge's exact causal stacked-confluence generator step-by-step on non-synthetic
   * M1 candles strictly using `[0..t]` at prediction time and settling at `[entryOpen -> expiryClose]`.
   */
  public collectHistoricalReplaySnapshots(
    candlesBySymbol?: Partial<Record<ForexSymbol, Candle[]>>,
    maxPerPair = 2000
  ): ReverseDecisionSnapshot[] {
    const snapshots: ReverseDecisionSnapshot[] = [];

    for (const symbol of FOREX_PAIRS) {
      const provided = candlesBySymbol?.[symbol];
      const combined = provided
        ? provided.filter((c) => c && c.source !== 'synthetic')
        : [
            ...(historicalDataStore.getCandles(symbol) || []),
            ...(db.getCandles(symbol, 500) || []),
          ].filter((c) => c && c.source !== 'synthetic');

      if (combined.length < 70) continue;

      const byTs = new Map<number, Candle>();
      for (const c of combined) {
        if (Number.isFinite(c.timestampMs) && c.close > 0 && c.open > 0) {
          byTs.set(c.timestampMs, c);
        }
      }
      const candles = Array.from(byTs.values())
        .sort((a, b) => a.timestampMs - b.timestampMs)
        .slice(-maxPerPair);
      if (candles.length < 70) continue;

      const tsIndexMap = new Map<number, number>();
      for (let idx = 0; idx < candles.length; idx++) {
        tsIndexMap.set(candles[idx].timestampMs, idx);
      }

      const closes = candles.map((k) => k.close);
      const ema9All = researchEngine.calculateEMA(closes, 9);
      const ema21All = researchEngine.calculateEMA(closes, 21);
      const rsi14All = researchEngine.calculateRSI(closes, 14);

      const isJpy = symbol.includes('JPY');
      const pipScale = isJpy ? 0.01 : 0.0001;
      let lastExpiryIdx = -1;

      for (let t = 40; t < candles.length - 35; t++) {
        if (t <= lastExpiryIdx) continue; // Non-overlapping per pair matching Strict Pair Isolation
        const c = candles[t];
        const prev = candles[t - 1];
        // Sample at 5M advance checkpoints (:02, :07, :12, ... -> next bar or aligned 5M open)
        const nextOpenMs = c.timestampMs + 3 * 60_000;
        const entryBarIdx = tsIndexMap.get(nextOpenMs);
        if (entryBarIdx === undefined) continue;
        // Require the preceding minute matches SignalForge's 3-minute advance timing on 5M boundaries
        if (new Date(nextOpenMs).getUTCMinutes() % 5 !== 0) continue;

        const range = Math.max(0.00008, c.high - c.low);
        const body = Math.abs(c.close - c.open);
        const bodyRatio = body / range;
        const upperWick = c.high - Math.max(c.open, c.close);
        const lowerWick = Math.min(c.open, c.close) - c.low;

        const lastEma9 = ema9All[t];
        const lastEma21 = ema21All[t];
        const prevEma9 = ema9All[t - 1] ?? lastEma9;
        const prevEma21 = ema21All[t - 1] ?? lastEma21;
        const lastRsi = rsi14All[t] ?? 50;

        const recent20 = candles.slice(t - 19, t + 1);
        const sma20 = recent20.reduce((acc, k) => acc + k.close, 0) / 20;
        const deviationPips = (c.close - sma20) / pipScale;
        const prev19 = candles.slice(t - 19, t);
        const high20 = Math.max(...prev19.map((k) => k.high));
        const low20 = Math.min(...prev19.map((k) => k.low));
        const activeSession = getSessionShortFromMs(c.timestampMs);

        const buyConfluences: string[] = [];
        const sellConfluences: string[] = [];

        if (lastEma9 > lastEma21 && (c.close > c.open || lastEma9 - lastEma21 > prevEma9 - prevEma21)) {
          buyConfluences.push('EMA 9/21 Trend Breakout');
        }
        if (lastEma9 < lastEma21 && (c.close < c.open || lastEma21 - lastEma9 > prevEma21 - prevEma9)) {
          sellConfluences.push('EMA 9/21 Trend Breakdown');
        }
        if (lowerWick / range > 0.42) buyConfluences.push('Liquidity Wick Sweep');
        if (upperWick / range > 0.42) sellConfluences.push('Liquidity Wick Sweep');
        if (deviationPips < -5.5) buyConfluences.push('Mean Reversion');
        if (deviationPips > 5.5) sellConfluences.push('Mean Reversion');
        if (lastRsi < 36) buyConfluences.push('RSI Oversold');
        if (lastRsi > 64) sellConfluences.push('RSI Overbought');
        if (c.close >= high20 || (bodyRatio > 0.60 && c.close > c.open)) buyConfluences.push('20-Bar High Expansion');
        if (c.close <= low20 || (bodyRatio > 0.60 && c.close < c.open)) sellConfluences.push('20-Bar Low Expansion');
        if (activeSession.id === 'OVERLAP' || activeSession.id === 'LONDON') {
          if (buyConfluences.length >= 1) buyConfluences.push(`${activeSession.shortName} Volume Flow`);
          if (sellConfluences.length >= 1) sellConfluences.push(`${activeSession.shortName} Volume Flow`);
        }

        let direction: SignalDirection | null = null;
        let confluences: string[] = [];
        if (buyConfluences.length >= 2 && buyConfluences.length > sellConfluences.length) {
          direction = 'BUY';
          confluences = buyConfluences;
        } else if (sellConfluences.length >= 2 && sellConfluences.length > buyConfluences.length) {
          direction = 'SELL';
          confluences = sellConfluences;
        }
        if (!direction) continue;

        let dynamicExpiry: 5 | 10 | 15 | 20 | 25 | 30 = 15;
        let ruleFamily = 'mean_reversion_20';
        const hasMomentum = confluences.some((i) => i.includes('Trend') || i.includes('Expansion'));
        const hasWick = confluences.some((i) => i.includes('Wick'));
        const hasMeanRev = confluences.some((i) => i.includes('Mean Reversion'));
        const hasRsi = confluences.some((i) => i.includes('RSI'));

        if (hasMomentum && !hasMeanRev && bodyRatio > 0.60) {
          dynamicExpiry = 5;
          ruleFamily = 'momentum_5';
        } else if (hasWick && (hasMomentum || hasRsi)) {
          dynamicExpiry = 10;
          ruleFamily = 'wick_reversal';
        } else if (hasMeanRev && hasRsi) {
          dynamicExpiry = 15;
          ruleFamily = 'mean_reversion_20';
        } else if (hasMomentum && confluences.some((i) => i.includes('20-Bar'))) {
          dynamicExpiry = 20;
          ruleFamily = 'range_breakout';
        } else if (hasMeanRev && hasWick) {
          dynamicExpiry = 25;
          ruleFamily = 'volatility_squeeze';
        } else {
          dynamicExpiry = 30;
          ruleFamily = 'order_flow_imbalance';
        }

        const plannedExitCloseMs = nextOpenMs + (dynamicExpiry - 1) * 60_000;
        const exitBarIdx = tsIndexMap.get(plannedExitCloseMs);
        if (exitBarIdx === undefined || exitBarIdx <= entryBarIdx) continue;

        const causalHistory = candles.slice(Math.max(0, t - 63), t + 1);
        const vec = agiSelfLearningEngine.extractFeatureVector(c, causalHistory);
        const regime = agiSelfLearningEngine.classifyMarketRegime(symbol, causalHistory, false);
        const baseConfidence = Number(Math.min(0.92, 0.77 + (confluences.length - 2) * 0.05).toFixed(2));

        const entryBar = candles[entryBarIdx];
        const exitBar = candles[exitBarIdx];
        const settlement = calculateBinarySettlement(direction, entryBar.open, exitBar.close, DEFAULT_BINARY_PAYOUT_PERCENT);
        lastExpiryIdx = exitBarIdx;

        snapshots.push({
          id: `rsnap_hist_${symbol.replace('/', '')}_${c.timestampMs}`,
          sourceKind: 'HISTORICAL_M1_REPLAY',
          symbol,
          expiryMinutes: dynamicExpiry,
          timestampUtc: c.timestamp,
          entryTimeUtc: entryBar.timestamp,
          exitTimeUtc: exitBar.timestamp,
          originalPrediction: direction,
          actualOutcome: settlement.outcome,
          entryPrice: entryBar.open,
          exitPrice: exitBar.close,
          payoutPct: DEFAULT_BINARY_PAYOUT_PERCENT,
          confidence: baseConfidence,
          ruleFamily,
          strategyId: `stacked:${ruleFamily}:${dynamicExpiry}`,
          confluenceItems: confluences,
          confluenceScore: confluences.length,
          marketRegime: regime.regimeType,
          featureVector: vec,
          hasValidFeatures: vec.length === 19 && vec.every(Number.isFinite),
          indicatorSummary: {
            emaSpread: round(vec[9] || 0, 3),
            rsi14: round(lastRsi, 1),
            wickImbalance: round(vec[6] || 0, 3),
            deviationPips: round(deviationPips, 2),
            bodyRatio: round(bodyRatio, 3),
            pos34: round(vec[14] || 0, 3),
            volRatio: round(vec[15] || 0, 3),
          },
        });
      }
    }

    return snapshots.sort((a, b) => Date.parse(a.timestampUtc) - Date.parse(b.timestampUtc) || a.id.localeCompare(b.id));
  }

  /**
   * Separately analyzes WIN vs LOSS snapshots strictly inside the Train split
   * so failure discovery NEVER touches validation or OOS test labels.
   */
  private analyzeFailurePatternsOnTrain(train: ReverseDecisionSnapshot[]): {
    report: FailureAnalysisReport;
    effectWeights: number[];
    trainWinPrior: number;
    ruleStats: Record<string, { wins: number; losses: number; wr: number }>;
    regimeStats: Record<string, { wins: number; losses: number; wr: number }>;
    dirStats: Record<string, { wins: number; losses: number; wr: number }>;
  } {
    const scored = train.filter((s) => s.actualOutcome === 'WIN' || s.actualOutcome === 'LOSS');
    const winRows = scored.filter((s) => s.actualOutcome === 'WIN');
    const lossRows = scored.filter((s) => s.actualOutcome === 'LOSS');
    const trainWinPrior = scored.length > 0 ? winRows.length / scored.length : 0.5;

    const validWinVecs = winRows.filter((s) => s.hasValidFeatures);
    const validLossVecs = lossRows.filter((s) => s.hasValidFeatures);
    const effectWeights = new Array(19).fill(0);
    const profiles: FeatureEffectProfile[] = [];

    for (let i = 0; i < 19; i++) {
      const wVals = validWinVecs.map((s) => s.featureVector[i]);
      const lVals = validLossVecs.map((s) => s.featureVector[i]);
      const wMean = wVals.length > 0 ? wVals.reduce((a, b) => a + b, 0) / wVals.length : 0;
      const lMean = lVals.length > 0 ? lVals.reduce((a, b) => a + b, 0) / lVals.length : 0;
      const wVar =
        wVals.length > 1
          ? wVals.reduce((acc, v) => acc + Math.pow(v - wMean, 2), 0) / (wVals.length - 1)
          : 1;
      const lVar =
        lVals.length > 1
          ? lVals.reduce((acc, v) => acc + Math.pow(v - lMean, 2), 0) / (lVals.length - 1)
          : 1;
      const pooledStd = Math.sqrt(Math.max(0.05, 0.5 * (wVar + lVar)));
      // Positive weight => larger feature predicts ORIGINAL WIN
      const d = (wMean - lMean) / pooledStd;
      effectWeights[i] = clamp(d, -2.0, 2.0);
      profiles.push({
        featureIndex: i,
        featureName: FEATURE_NAMES_19D[i] || `f${i}`,
        winMean: round(wMean, 3),
        lossMean: round(lMean, 3),
        effectSizeD: round(d, 3),
      });
    }

    const collectGroup = (dim: PatternPocketSummary['dimension'], keyFn: (s: ReverseDecisionSnapshot) => string) => {
      const g = new Map<string, { wins: number; losses: number }>();
      for (const s of scored) {
        const k = keyFn(s);
        const cur = g.get(k) || { wins: 0, losses: 0 };
        if (s.actualOutcome === 'WIN') cur.wins++;
        else cur.losses++;
        g.set(k, cur);
      }
      const statsRecord: Record<string, { wins: number; losses: number; wr: number }> = {};
      const list: PatternPocketSummary[] = [];
      for (const [k, v] of g.entries()) {
        const n = v.wins + v.losses;
        const acc = n > 0 ? (v.wins / n) * 100 : 50;
        // Bayesian shrinkage toward trainWinPrior (k=4 pseudo-samples)
        const shrunkWr = (v.wins + 4 * trainWinPrior) / (n + 4);
        statsRecord[k] = { wins: v.wins, losses: v.losses, wr: shrunkWr };
        const role: PatternPocketSummary['patternRole'] =
          n >= 3 && acc >= 55
            ? 'HIGH_ACCURACY_INVERT_TARGET'
            : n >= 3 && acc <= 42
              ? 'TOXIC_FAILURE_KEEP_TARGET'
              : 'NEUTRAL';
        list.push({
          dimension: dim,
          key: k,
          count: n,
          wins: v.wins,
          losses: v.losses,
          accuracyPct: round(acc, 1),
          patternRole: role,
        });
      }
      return { statsRecord, list };
    };

    const ruleRes = collectGroup('RULE_FAMILY', (s) => s.ruleFamily);
    const regimeRes = collectGroup('REGIME', (s) => s.marketRegime);
    const dirRes = collectGroup('DIRECTION', (s) => s.originalPrediction);
    const expiryRes = collectGroup('EXPIRY', (s) => `${s.expiryMinutes}m`);
    const confRes = collectGroup('CONFIDENCE_BAND', (s) =>
      s.confidence >= 0.85 ? '>=0.85' : s.confidence >= 0.78 ? '0.78-0.84' : '<0.78'
    );

    const allPockets = [
      ...ruleRes.list,
      ...regimeRes.list,
      ...dirRes.list,
      ...expiryRes.list,
      ...confRes.list,
    ].sort((a, b) => b.count - a.count || a.accuracyPct - b.accuracyPct);

    const report: FailureAnalysisReport = {
      trainSampleCount: scored.length,
      trainWins: winRows.length,
      trainLosses: lossRows.length,
      trainBaselineAccuracyPct: scored.length > 0 ? round(trainWinPrior * 100, 2) : null,
      topDivergentFeatures: profiles
        .sort((a, b) => Math.abs(b.effectSizeD) - Math.abs(a.effectSizeD))
        .slice(0, 8),
      patternPockets: allPockets,
      highAccuracyPocketsCount: allPockets.filter((p) => p.patternRole === 'HIGH_ACCURACY_INVERT_TARGET').length,
      naturalFailurePocketsCount: allPockets.filter((p) => p.patternRole === 'TOXIC_FAILURE_KEEP_TARGET').length,
    };

    return {
      report,
      effectWeights,
      trainWinPrior,
      ruleStats: ruleRes.statsRecord,
      regimeStats: regimeRes.statsRecord,
      dirStats: dirRes.statsRecord,
    };
  }

  /** Evaluates a candidate genome strictly causally using only snapshot inputs known at prediction time. */
  private predictWithCandidate(genome: ReverseCandidateGenome, snap: ReverseDecisionSnapshot): SignalDirection {
    let dot = genome.bias;
    if (snap.hasValidFeatures) {
      for (let i = 0; i < 19; i++) {
        dot += (genome.featureWeights[i] || 0) * clamp(snap.featureVector[i] || 0, -4, 4);
      }
    }
    const featureWinProb = sigmoid(dot);

    // Combine learned feature probability with empirical train pocket routing when active
    if (genome.family === 'CONDITIONAL_POCKET') {
      const ruleFlip = genome.useRulePockets && snap.ruleFamily in genome.ruleFlipMap
        ? genome.ruleFlipMap[snap.ruleFamily]
        : null;
      const regimeFlip = genome.useRegimePockets && snap.marketRegime in genome.regimeFlipMap
        ? genome.regimeFlipMap[snap.marketRegime]
        : null;
      if (ruleFlip !== null && regimeFlip !== null) {
        const voteFlip = Number(ruleFlip) + Number(regimeFlip) + Number(featureWinProb >= genome.invertThreshold);
        return voteFlip >= 2 ? flipDir(snap.originalPrediction) : snap.originalPrediction;
      }
      if (ruleFlip !== null) return ruleFlip ? flipDir(snap.originalPrediction) : snap.originalPrediction;
      if (regimeFlip !== null) return regimeFlip ? flipDir(snap.originalPrediction) : snap.originalPrediction;
    }

    // Standard adversarial rule: estimate P(original WINS); flip when >= invertThreshold, keep when <= keepThreshold
    if (featureWinProb >= genome.invertThreshold) {
      return flipDir(snap.originalPrediction);
    }
    if (featureWinProb <= genome.keepThreshold) {
      return snap.originalPrediction;
    }
    // Mid-zone resolves strictly by the side minimizing estimated win probability
    return featureWinProb >= 0.5 ? flipDir(snap.originalPrediction) : snap.originalPrediction;
  }

  /**
   * Trains simple L2-regularized logistic regression on Train ONLY predicting y_orig = 1 (original WON) vs 0 (LOST).
   */
  private fitLogisticWinProbWeights(
    train: ReverseDecisionSnapshot[],
    initWeights: number[],
    l2Reg: number,
    lr: number,
    epochs: number
  ): { weights: number[]; bias: number } {
    const scored = train.filter((s) => (s.actualOutcome === 'WIN' || s.actualOutcome === 'LOSS') && s.hasValidFeatures);
    const w = [...initWeights];
    const baseRate = scored.length > 0 ? scored.filter((s) => s.actualOutcome === 'WIN').length / scored.length : 0.5;
    let b = Math.log(clamp(baseRate, 0.05, 0.95) / (1 - clamp(baseRate, 0.05, 0.95)));
    if (scored.length < 4) return { weights: w, bias: b };

    for (let ep = 0; ep < epochs; ep++) {
      for (const s of scored) {
        const y = s.actualOutcome === 'WIN' ? 1 : 0;
        let z = b;
        for (let i = 0; i < 19; i++) z += w[i] * clamp(s.featureVector[i], -4, 4);
        const err = sigmoid(z) - y;
        b -= lr * err;
        for (let i = 0; i < 19; i++) {
          const xi = clamp(s.featureVector[i], -4, 4);
          w[i] = w[i] * (1 - lr * l2Reg) - lr * err * xi;
        }
      }
    }
    return { weights: w.map((v) => round(clamp(v, -3, 3), 4)), bias: round(clamp(b, -3, 3), 4) };
  }

  private scoreCandidate(
    genome: Omit<
      ReverseCandidateGenome,
      'trainAccuracyPct' | 'trainScored' | 'validationAccuracyPct' | 'validationScored' | 'validationVsInversionDeltaPct'
    >,
    train: ReverseDecisionSnapshot[],
    validation: ReverseDecisionSnapshot[]
  ): ReverseCandidateGenome {
    const full = {
      ...genome,
      trainAccuracyPct: 50,
      trainScored: 0,
      validationAccuracyPct: 50,
      validationScored: 0,
      validationVsInversionDeltaPct: 0,
    };
    const trainEval = summarizeModelOnSet('AUTONOMOUS_REVERSE_ENGINEERED', full.name, train, (s) =>
      this.predictWithCandidate(full, s)
    );
    const valEval = summarizeModelOnSet('AUTONOMOUS_REVERSE_ENGINEERED', full.name, validation, (s) =>
      this.predictWithCandidate(full, s)
    );
    const valInv = summarizeModelOnSet('SIMPLE_INVERSION', 'Inversion', validation, (s) =>
      flipDir(s.originalPrediction)
    );

    const valAcc = valEval.accuracyPct ?? 50;
    const invAcc = valInv.accuracyPct ?? 50;

    return {
      ...full,
      trainAccuracyPct: trainEval.accuracyPct ?? 50,
      trainScored: trainEval.scored,
      validationAccuracyPct: valAcc,
      validationScored: valEval.scored,
      validationVsInversionDeltaPct: round(valAcc - invAcc, 2),
    };
  }

  private discoverAndFreezeBestCandidate(
    train: ReverseDecisionSnapshot[],
    validation: ReverseDecisionSnapshot[]
  ): { frozen: ReverseCandidateGenome | null; totalEvaluated: number } {
    if (train.length < 4 || validation.length < 2) {
      return { frozen: null, totalEvaluated: 0 };
    }

    const analysis = this.analyzeFailurePatternsOnTrain(train);
    const ruleFlipFromTrain = (thresh: number) => {
      const map: Record<string, boolean> = {};
      for (const [k, st] of Object.entries(analysis.ruleStats)) {
        map[k] = st.wr >= thresh;
      }
      return map;
    };
    const regimeFlipFromTrain = (thresh: number) => {
      const map: Record<string, boolean> = {};
      for (const [k, st] of Object.entries(analysis.regimeStats)) {
        map[k] = st.wr >= thresh;
      }
      return map;
    };

    const candidates: ReverseCandidateGenome[] = [];
    let idx = 0;

    // Family 1: Regularized Logistic Win-Probability Estimators (fitted on Train ONLY)
    for (const l2 of [0.05, 0.25, 0.8]) {
      const fitted = this.fitLogisticWinProbWeights(train, analysis.effectWeights.map((v) => v * 0.25), l2, 0.03, 35);
      for (const cut of [0.42, 0.48, 0.50, 0.54, 0.58]) {
        candidates.push(
          this.scoreCandidate(
            {
              candidateId: `cand_log_${++idx}`,
              name: `AntiLogOdds (L2=${l2}, cut=${cut})`,
              family: 'LINEAR_LOG_ODDS',
              featureWeights: fitted.weights,
              bias: fitted.bias,
              invertThreshold: cut,
              keepThreshold: clamp(cut - 0.06, 0.2, 0.5),
              useRulePockets: false,
              useRegimePockets: false,
              ruleFlipMap: {},
              regimeFlipMap: {},
            },
            train,
            validation
          )
        );
      }
    }

    // Family 2: Empirical Pocket Polarity Transforms (discovered from Train rule/regime accuracy)
    for (const thresh of [0.46, 0.49, 0.50, 0.53]) {
      const rf = ruleFlipFromTrain(thresh);
      const regf = regimeFlipFromTrain(thresh);
      const combos: Array<{ name: string; useRule: boolean; useRegime: boolean }> = [
        { name: `PocketRule(cut=${thresh})`, useRule: true, useRegime: false },
        { name: `PocketRegime(cut=${thresh})`, useRule: false, useRegime: true },
        { name: `PocketJoint(cut=${thresh})`, useRule: true, useRegime: true },
      ];
      for (const combo of combos) {
        candidates.push(
          this.scoreCandidate(
            {
              candidateId: `cand_pkt_${++idx}`,
              name: combo.name,
              family: 'CONDITIONAL_POCKET',
              featureWeights: analysis.effectWeights.map((v) => round(v * 0.2, 4)),
              bias: 0,
              invertThreshold: thresh,
              keepThreshold: thresh,
              useRulePockets: combo.useRule,
              useRegimePockets: combo.useRegime,
              ruleFlipMap: rf,
              regimeFlipMap: regf,
            },
            train,
            validation
          )
        );
      }
    }

    // Family 3: Deterministic Feature-Weight Perturbations (seeded coordinate search around effectWeights)
    const zeroW = new Array(19).fill(0);
    for (let s = 1; s <= 12; s++) {
      const wPerturbed = analysis.effectWeights.map((baseVal, j) => {
        const mod = ((s * 31 + j * 17) % 11) - 5; // [-5, +5] deterministic
        return round(clamp(baseVal * (0.2 + s * 0.04) + mod * 0.06, -2.5, 2.5), 4);
      });
      const biasShift = round((((s * 7) % 9) - 4) * 0.08, 3);
      candidates.push(
        this.scoreCandidate(
          {
            candidateId: `cand_pert_${++idx}`,
            name: `FeaturePerturb-#${s}`,
            family: 'FEATURE_PERTURBATION',
            featureWeights: s % 4 === 0 ? zeroW : wPerturbed,
            bias: biasShift,
            invertThreshold: 0.48 + (s % 3) * 0.03,
            keepThreshold: 0.42 + (s % 3) * 0.02,
            useRulePockets: false,
            useRegimePockets: false,
            ruleFlipMap: {},
            regimeFlipMap: {},
          },
          train,
          validation
        )
      );
    }

    // Family 4: Adversarial Ensemble combining shrunk empirical rule/regime prior + fitted linear anti-weights
    const fittedBest = this.fitLogisticWinProbWeights(train, analysis.effectWeights.map((v) => v * 0.35), 0.15, 0.035, 45);
    for (const cut of [0.46, 0.50, 0.54]) {
      candidates.push(
        this.scoreCandidate(
          {
            candidateId: `cand_ens_${++idx}`,
            name: `AdversarialEnsemble(cut=${cut})`,
            family: 'ADVERSARIAL_ENSEMBLE',
            featureWeights: fittedBest.weights,
            bias: fittedBest.bias,
            invertThreshold: cut,
            keepThreshold: cut - 0.05,
            useRulePockets: true,
            useRegimePockets: true,
            ruleFlipMap: ruleFlipFromTrain(cut),
            regimeFlipMap: regimeFlipFromTrain(cut),
          },
          train,
          validation
        )
      );
    }

    // Select lowest Validation accuracy ONLY (never inspects unseenTest!)
    const sorted = [...candidates].sort((a, b) => {
      if (a.validationAccuracyPct !== b.validationAccuracyPct) {
        return a.validationAccuracyPct - b.validationAccuracyPct;
      }
      // Prefer candidates with stronger train failure signal too
      return a.trainAccuracyPct - b.trainAccuracyPct;
    });

    return {
      frozen: sorted[0] || null,
      totalEvaluated: candidates.length,
    };
  }

  /** Chronological Train -> Embargo -> Validation -> Embargo -> Unseen Test split. */
  private splitChronologically(snapshots: ReverseDecisionSnapshot[]): {
    train: ReverseDecisionSnapshot[];
    validation: ReverseDecisionSnapshot[];
    unseenTest: ReverseDecisionSnapshot[];
    embargoTrainValSkipped: number;
    embargoValTestSkipped: number;
  } {
    const ordered = [...snapshots].sort(
      (a, b) => Date.parse(a.timestampUtc) - Date.parse(b.timestampUtc) || a.id.localeCompare(b.id)
    );
    const n = ordered.length;
    if (n < 12) {
      const splitA = Math.max(1, Math.floor(n * 0.5));
      const splitB = Math.max(splitA + 1, Math.floor(n * 0.75));
      return {
        train: ordered.slice(0, splitA),
        validation: ordered.slice(splitA, splitB),
        unseenTest: ordered.slice(splitB),
        embargoTrainValSkipped: 0,
        embargoValTestSkipped: 0,
      };
    }

    const embargo = n >= 40 ? Math.max(1, Math.floor(n * 0.02)) : 0;
    const trainEnd = Math.floor(n * 0.5);
    const valStart = Math.min(n - 2, trainEnd + embargo);
    const valEnd = Math.min(n - 1, valStart + Math.max(2, Math.floor(n * 0.25)));
    const testStart = Math.min(n, valEnd + embargo);

    return {
      train: ordered.slice(0, trainEnd),
      validation: ordered.slice(valStart, valEnd),
      unseenTest: ordered.slice(testStart),
      embargoTrainValSkipped: Math.max(0, valStart - trainEnd),
      embargoValTestSkipped: Math.max(0, testStart - valEnd),
    };
  }

  /**
   * Executes a complete isolated leak-free self-reverse-engineering experiment and saves
   * results strictly to `data/reverse_engineering_experiment.db.json`.
   */
  public runExperiment(options: {
    customSnapshots?: ReverseDecisionSnapshot[];
    candlesBySymbol?: Partial<Record<ForexSymbol, Candle[]>>;
    includeRealSettled?: boolean;
    includeHistoricalReplay?: boolean;
  } = {}): ReverseExperimentRun {
    const includeRealSettled = options.includeRealSettled ?? true;
    const includeHistoricalReplay = options.includeHistoricalReplay ?? true;

    let snapshots: ReverseDecisionSnapshot[] = [];
    let dataSourceMode: ReverseExperimentRun['dataSourceMode'] = 'SETTLED_LEDGER_ONLY';

    if (options.customSnapshots && options.customSnapshots.length > 0) {
      snapshots = [...options.customSnapshots];
      dataSourceMode = snapshots.some((s) => s.sourceKind === 'HISTORICAL_M1_REPLAY')
        ? 'HISTORICAL_M1_REPLAY_ONLY'
        : 'SETTLED_LEDGER_ONLY';
    } else {
      const settled = includeRealSettled ? this.extractSettledSignalSnapshots() : [];
      const replay = includeHistoricalReplay ? this.collectHistoricalReplaySnapshots(options.candlesBySymbol) : [];
      const dedup = new Map<string, ReverseDecisionSnapshot>();
      for (const s of [...settled, ...replay]) {
        if (!dedup.has(s.id)) dedup.set(s.id, s);
      }
      snapshots = Array.from(dedup.values());
      if (settled.length > 0 && replay.length > 0) dataSourceMode = 'REAL_SETTLED_AND_HISTORY';
      else if (replay.length > 0) dataSourceMode = 'HISTORICAL_M1_REPLAY_ONLY';
      else dataSourceMode = 'SETTLED_LEDGER_ONLY';
    }

    snapshots.sort((a, b) => Date.parse(a.timestampUtc) - Date.parse(b.timestampUtc) || a.id.localeCompare(b.id));
    const experimentId = `revexp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const splits = this.splitChronologically(snapshots);
    const trainAnalysis = this.analyzeFailurePatternsOnTrain(splits.train);
    const { frozen, totalEvaluated } = this.discoverAndFreezeBestCandidate(splits.train, splits.validation);

    const predictOrig = (s: ReverseDecisionSnapshot): SignalDirection => s.originalPrediction;
    const predictInv = (s: ReverseDecisionSnapshot): SignalDirection => flipDir(s.originalPrediction);
    const predictAuto = (s: ReverseDecisionSnapshot): SignalDirection =>
      frozen ? this.predictWithCandidate(frozen, s) : flipDir(s.originalPrediction);
    const predictRand = (s: ReverseDecisionSnapshot): SignalDirection =>
      deterministicRandomDir(`${experimentId}:${s.id}:${s.timestampUtc}`);

    const unseenFourWay = {
      original: summarizeModelOnSet('ORIGINAL', 'A. Original SignalForge', splits.unseenTest, predictOrig),
      simpleInversion: summarizeModelOnSet('SIMPLE_INVERSION', 'B. Simple Direction Inversion', splits.unseenTest, predictInv),
      autonomousReverseEngineered: summarizeModelOnSet(
        'AUTONOMOUS_REVERSE_ENGINEERED',
        'C. Autonomous Reverse-Engineered',
        splits.unseenTest,
        predictAuto
      ),
      randomBaseline: summarizeModelOnSet('RANDOM_BASELINE', 'D. Random Baseline (50/50)', splits.unseenTest, predictRand),
    };

    const fullFourWay = {
      original: summarizeModelOnSet('ORIGINAL', 'A. Original SignalForge', snapshots, predictOrig),
      simpleInversion: summarizeModelOnSet('SIMPLE_INVERSION', 'B. Simple Direction Inversion', snapshots, predictInv),
      autonomousReverseEngineered: summarizeModelOnSet(
        'AUTONOMOUS_REVERSE_ENGINEERED',
        'C. Autonomous Reverse-Engineered',
        snapshots,
        predictAuto
      ),
      randomBaseline: summarizeModelOnSet('RANDOM_BASELINE', 'D. Random Baseline (50/50)', snapshots, predictRand),
    };

    // Expanding walk-forward folds across available history
    const walkForwardFolds: ReverseExperimentRun['walkForwardFolds'] = [];
    if (snapshots.length >= 24) {
      const foldCount = 3;
      const chunkSize = Math.floor(snapshots.length / (foldCount + 2));
      for (let f = 0; f < foldCount; f++) {
        const trEnd = chunkSize * (f + 2);
        const teEnd = f === foldCount - 1 ? snapshots.length : Math.min(snapshots.length, trEnd + chunkSize);
        const trSlice = snapshots.slice(0, trEnd);
        const valCut = Math.max(4, Math.floor(trSlice.length * 0.67));
        const teSlice = snapshots.slice(trEnd, teEnd);
        if (teSlice.length < 2) break;
        const { frozen: foldFrozen } = this.discoverAndFreezeBestCandidate(trSlice.slice(0, valCut), trSlice.slice(valCut));
        const foldOrig = summarizeModelOnSet('ORIGINAL', 'Orig', teSlice, predictOrig);
        const foldInv = summarizeModelOnSet('SIMPLE_INVERSION', 'Inv', teSlice, predictInv);
        const foldAuto = summarizeModelOnSet('AUTONOMOUS_REVERSE_ENGINEERED', 'Auto', teSlice, (s) =>
          foldFrozen ? this.predictWithCandidate(foldFrozen, s) : flipDir(s.originalPrediction)
        );
        const foldRand = summarizeModelOnSet('RANDOM_BASELINE', 'Rand', teSlice, predictRand);
        walkForwardFolds.push({
          foldIndex: f + 1,
          trainSize: trSlice.length,
          testSize: teSlice.length,
          originalAccPct: foldOrig.accuracyPct,
          inversionAccPct: foldInv.accuracyPct,
          autonomousAccPct: foldAuto.accuracyPct,
          randomAccPct: foldRand.accuracyPct,
        });
      }
    }

    const unseenScored = unseenFourWay.autonomousReverseEngineered.scored;
    const sampleSufficiency: ReverseExperimentRun['sampleSufficiency'] =
      unseenScored >= 30 ? 'SUFFICIENT' : unseenScored >= 15 ? 'PRELIMINARY' : 'INSUFFICIENT_SAMPLE';

    const autoAcc = unseenFourWay.autonomousReverseEngineered.accuracyPct;
    const invAcc = unseenFourWay.simpleInversion.accuracyPct;
    const randAcc = unseenFourWay.randomBaseline.accuracyPct;
    const targetPrimaryMet = autoAcc !== null && autoAcc < 30.0;
    const targetSecondaryMet = autoAcc !== null && autoAcc <= 25.0;
    const beatsSimpleInversion = autoAcc !== null && invAcc !== null && autoAcc < invAcc;
    const beatsRandomDegradation = autoAcc !== null && randAcc !== null && autoAcc < randAcc;

    let verdict: ReverseExperimentRun['promotionDecision']['verdict'] = 'REJECTED_ABOVE_30_OOS';
    let promoted = false;
    let rationale = '';

    if (!frozen || unseenScored < 15) {
      verdict = 'REJECTED_INSUFFICIENT_SAMPLE';
      rationale = `Unseen OOS sample has ${unseenScored} scored predictions (< 15 minimum required to claim validation). Import historical M1 candles or accumulate more settled outcomes.`;
    } else if (!targetPrimaryMet) {
      verdict = 'REJECTED_ABOVE_30_OOS';
      rationale = `Frozen candidate ${frozen.name} achieved ${autoAcc}% on unseen OOS (n=${unseenScored}), above the <30% failure target.`;
    } else if (!beatsSimpleInversion) {
      verdict = 'REJECTED_WORSE_THAN_INVERSION';
      rationale = `Frozen candidate ${frozen.name} achieved ${autoAcc}% OOS (<30%), but did not outperform simple direction inversion (${invAcc}%).`;
    } else {
      verdict = 'PROMOTED_UNDER_30';
      promoted = true;
      rationale = `Frozen candidate ${frozen.name} achieved ${autoAcc}% accuracy on ${unseenScored} unseen OOS setups (<30% target), beating both Simple Inversion (${invAcc}%) and Random Baseline (${randAcc}%). Original SignalForge untouched.`;
    }

    const run: ReverseExperimentRun = {
      experimentId,
      createdAtUtc: new Date().toISOString(),
      dataSourceMode,
      sampleSufficiency,
      datasetCounts: {
        totalSnapshots: snapshots.length,
        scoredWinLoss: snapshots.filter((s) => s.actualOutcome === 'WIN' || s.actualOutcome === 'LOSS').length,
        scratches: snapshots.filter((s) => s.actualOutcome === 'SCRATCH').length,
        with19DFeatures: snapshots.filter((s) => s.hasValidFeatures).length,
        trainCount: splits.train.length,
        embargoTrainValSkipped: splits.embargoTrainValSkipped,
        validationCount: splits.validation.length,
        embargoValTestSkipped: splits.embargoValTestSkipped,
        unseenTestCount: splits.unseenTest.length,
      },
      verifiedBaselineAll: {
        predictions: fullFourWay.original.predictions,
        scored: fullFourWay.original.scored,
        wins: fullFourWay.original.wins,
        losses: fullFourWay.original.losses,
        accuracyPct: fullFourWay.original.accuracyPct,
        wilson95CiPct: fullFourWay.original.wilson95CiPct,
      },
      failureAnalysis: trainAnalysis.report,
      frozenCandidate: frozen,
      candidatesEvaluatedCount: totalEvaluated,
      unseenFourWayComparison: unseenFourWay,
      fullChronologicalComparison: fullFourWay,
      walkForwardFolds,
      promotionDecision: {
        promoted,
        targetPrimaryMet,
        targetSecondaryMet,
        beatsSimpleInversion,
        beatsRandomDegradation,
        verdict,
        rationale,
      },
    };

    this.state.snapshots = snapshots.slice(-500);
    this.state.experiments.unshift(run);
    if (this.state.experiments.length > 25) {
      this.state.experiments = this.state.experiments.slice(0, 25);
    }
    if (promoted && frozen) {
      this.state.promotedChampion = frozen;
    }
    this.saveStateSync();
    return run;
  }

  /**
   * Continuous self-analysis step invoked on completed outcomes or manual trigger:
   * 1) Records outcome snapshot in isolated DB, 2) Compares 4 models, 3) Updates failure analysis,
   * 4) Re-evaluates failure patterns, 5) Generates alternatives, 6) Validates chronologically,
   * 7) Promotes only candidates proving reproducible unseen OOS results. Original model untouched.
   */
  public stepContinuousSelfAnalysis(completedSnapshot?: ReverseDecisionSnapshot): ReverseExperimentRun {
    if (completedSnapshot) {
      const existingIdx = this.state.snapshots.findIndex((s) => s.id === completedSnapshot.id);
      if (existingIdx === -1) {
        this.state.snapshots.push(completedSnapshot);
      } else {
        this.state.snapshots[existingIdx] = completedSnapshot;
      }
    }

    const existingSnapshots =
      this.state.snapshots.length > 0 ? this.state.snapshots : this.extractSettledSignalSnapshots();
    const run = this.runExperiment({
      customSnapshots: existingSnapshots.length > 0 ? existingSnapshots : undefined,
    });
    this.state.continuousCyclesRun += 1;
    this.state.continuousHistory.unshift({
      cycleAtUtc: run.createdAtUtc,
      totalSnapshots: run.datasetCounts.totalSnapshots,
      unseenOriginalAccPct: run.unseenFourWayComparison.original.accuracyPct,
      unseenInversionAccPct: run.unseenFourWayComparison.simpleInversion.accuracyPct,
      unseenAutonomousAccPct: run.unseenFourWayComparison.autonomousReverseEngineered.accuracyPct,
      unseenRandomAccPct: run.unseenFourWayComparison.randomBaseline.accuracyPct,
      promotedCandidateId: run.promotionDecision.promoted && run.frozenCandidate ? run.frozenCandidate.candidateId : null,
      verdict: run.promotionDecision.verdict,
    });
    if (this.state.continuousHistory.length > 50) {
      this.state.continuousHistory = this.state.continuousHistory.slice(0, 50);
    }
    this.saveStateSync();
    return run;
  }
}

export const reverseEngineeringEngine = new ReverseEngineeringEngine();
