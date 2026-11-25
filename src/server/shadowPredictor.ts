import {
  Candle,
  ForexSymbol,
  MarketRegimeState,
  ResearchSignal,
  ShadowCandidateEvaluation,
  SignalDirection,
} from '../types/index.js';
import {
  createInitialOnlineLearnerState,
  learnOnlineOutcome,
  OnlineLearnerState,
  predictOnlineOutcome,
} from './onlineLearning.js';
import { OnlinePolicyNetwork } from './onlinePolicyNetwork.js';

export const SHADOW_CANDIDATE_VERSION = 'shadow-cal-v1.0';

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function sigmoid(z: number): number {
  const cz = clamp(z, -12, 12);
  return 1 / (1 + Math.exp(-cz));
}

function logit(p: number): number {
  const cp = clamp(p, 1e-4, 1 - 1e-4);
  return Math.log(cp / (1 - cp));
}

function round(val: number, digits = 4): number {
  const f = Math.pow(10, digits);
  return Math.round(val * f) / f;
}

export function computeBreakEvenProbability(payoutPct: number = 80): number {
  const safePayout = Number.isFinite(payoutPct) && payoutPct > 0 ? payoutPct : 80;
  return 1 / (1 + safePayout / 100);
}

/**
 * Wilson score confidence interval (exact closed form).
 */
export function wilsonInterval(
  wins: number,
  total: number,
  z: number = 1.96
): { winRate: number; lower: number; upper: number } {
  if (total <= 0) {
    return { winRate: 0, lower: 0, upper: 1 };
  }
  const p = clamp(wins / total, 0, 1);
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const center = p + z2 / (2 * total);
  const half = z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));
  return {
    winRate: round(p, 4),
    lower: round(clamp((center - half) / denom, 0, 1), 4),
    upper: round(clamp((center + half) / denom, 0, 1), 4),
  };
}

function normalizeDirectionFromSignal(
  marketFeatureVector: number[] | undefined,
  symbol: ForexSymbol,
  direction: SignalDirection
): number {
  // Feature vector must be finite 19D prediction-time vector
  if (!Array.isArray(marketFeatureVector) || marketFeatureVector.length !== 19) return 0.5;
  if (!marketFeatureVector.every(Number.isFinite)) return 0.5;
  return direction === 'BUY' ? 1 : 0;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const va = Number.isFinite(a[i]) ? a[i] : 0;
    const vb = Number.isFinite(b[i]) ? b[i] : 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  if (normA <= 1e-12 || normB <= 1e-12) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface PriorEpisodeRecord {
  symbol: ForexSymbol;
  direction: SignalDirection;
  ruleFamily: string;
  strategyId?: string;
  outcome: 'WIN' | 'LOSS';
  netReturnUnits: number;
  regimeType?: string;
  marketFeatureVector?: number[];
  rawScoreProb?: number;
}

export interface ShadowEvaluationInput {
  symbol: ForexSymbol;
  direction: SignalDirection;
  ruleFamily: string;
  strategyId?: string;
  payoutPct?: number;
  marketFeatureVector?: number[];
  ftrlProbability?: number;
  ftrlSampleSize?: number;
  mlpUpProbability?: number;
  mlpStepCount?: number;
  mlpOosBce?: number | null;
  linUcbV2Score?: number | null;
  linUcbV2Obs?: number;
  regime?: MarketRegimeState | null;
  severeTrapCount?: number;
  priorSettledRecords: PriorEpisodeRecord[];
}

/**
 * Strictly causal shadow calibrator + evidence-based abstention evaluator.
 * Never mutates live execution confidence or live trading gates.
 */
export function evaluateShadowCandidate(
  input: ShadowEvaluationInput
): ShadowCandidateEvaluation {
  const payoutPct =
    typeof input.payoutPct === 'number' && Number.isFinite(input.payoutPct) && input.payoutPct > 0
      ? input.payoutPct
      : 80;
  const breakEvenProbability = computeBreakEvenProbability(payoutPct);

  const priors = input.priorSettledRecords;
  const priorWins = priors.filter(r => r.outcome === 'WIN').length;
  const priorTotal = priors.length;

  // 1. Base empirical prior shrunk weakly toward 0.50 (never hardcoded 0.77)
  const PRIOR_STRENGTH = 14;
  const priorMean = (priorWins + 0.5 * PRIOR_STRENGTH) / (priorTotal + PRIOR_STRENGTH);
  const priorLogOdds = logit(priorMean);

  const estimators: number[] = [];
  let deltaLogOdds = 0;

  // 2. FTRL 56D logistic probability (weight matures with sample count)
  if (typeof input.ftrlProbability === 'number' && Number.isFinite(input.ftrlProbability)) {
    const sampleSize = input.ftrlSampleSize ?? priorTotal;
    const ftrlWeight = clamp(sampleSize / 40, 0.15, 0.75);
    const ftrlShift = logit(clamp(input.ftrlProbability, 0.25, 0.75)) - logit(0.5);
    deltaLogOdds += ftrlWeight * ftrlShift;
    if (sampleSize >= 10) estimators.push(clamp(input.ftrlProbability, 0.15, 0.85));
  }

  // 3. OOS-gated MLP: zero weight unless out-of-sample BCE improves over random coin flip (< 0.690)
  const mlpSteps = input.mlpStepCount ?? 0;
  const mlpOosBce = input.mlpOosBce ?? null;
  const mlpActive =
    typeof input.mlpUpProbability === 'number' &&
    Number.isFinite(input.mlpUpProbability) &&
    mlpSteps >= 20 &&
    mlpOosBce !== null &&
    mlpOosBce < 0.69;
  if (mlpActive && typeof input.mlpUpProbability === 'number') {
    const mlpDirProb =
      input.direction === 'BUY' ? input.mlpUpProbability : 1 - input.mlpUpProbability;
    const skillScale = clamp((0.6931 - (mlpOosBce as number)) * 12, 0.05, 0.45);
    deltaLogOdds += skillScale * (logit(clamp(mlpDirProb, 0.2, 0.8)) - logit(0.5));
    estimators.push(clamp(mlpDirProb, 0.15, 0.85));
  }

  // 4. Direction-conditioned LinUCB V2 reward signal
  const v2Obs = input.linUcbV2Obs ?? 0;
  if (
    typeof input.linUcbV2Score === 'number' &&
    Number.isFinite(input.linUcbV2Score) &&
    v2Obs >= 6
  ) {
    // Expected net unit return roughly in [-0.6, +0.6] -> convert smoothly to directional log-odds nudge
    const v2Weight = clamp(v2Obs / 30, 0.1, 0.45);
    deltaLogOdds += v2Weight * Math.tanh(input.linUcbV2Score * 1.4);
    estimators.push(clamp(0.5 + 0.25 * Math.tanh(input.linUcbV2Score), 0.2, 0.8));
  }

  // 5. Recency-weighted Strategy / RuleFamily Bayesian posterior (adapts to regime drift)
  const stratMatches = priors.filter(
    r =>
      (input.strategyId && r.strategyId === input.strategyId) ||
      r.ruleFamily === input.ruleFamily
  );
  let recStratW = 0;
  let recStratL = 0;
  for (const r of stratMatches) {
    recStratW = recStratW * 0.96 + (r.outcome === 'WIN' ? 1 : 0);
    recStratL = recStratL * 0.96 + (r.outcome === 'LOSS' ? 1 : 0);
  }
  const STRAT_M = 16;
  const stratPost = (recStratW + priorMean * STRAT_M) / (recStratW + recStratL + STRAT_M);
  if (stratMatches.length >= 5) {
    deltaLogOdds += 0.7 * (logit(stratPost) - priorLogOdds);
    estimators.push(stratPost);
  }

  // 5b. Direction prior (BUY vs SELL) with balanced shrinkage
  const dirMatches = priors.filter(r => r.direction === input.direction);
  let recDirW = 0;
  let recDirL = 0;
  for (const r of dirMatches) {
    recDirW = recDirW * 0.97 + (r.outcome === 'WIN' ? 1 : 0);
    recDirL = recDirL * 0.97 + (r.outcome === 'LOSS' ? 1 : 0);
  }
  const DIR_M = 32;
  const dirPost = (recDirW + priorMean * DIR_M) / (recDirW + recDirL + DIR_M);
  if (dirMatches.length >= 8) {
    deltaLogOdds += 0.3 * (logit(dirPost) - priorLogOdds);
    estimators.push(dirPost);
  }

  // 7. Cross-pair direction-aligned feature-similarity k-NN (using y_up from all settled prior vectors)
  let knnMatchesUsed = 0;
  let knnProb: number | null = null;
  if (
    Array.isArray(input.marketFeatureVector) &&
    input.marketFeatureVector.length === 19 &&
    input.marketFeatureVector.every(Number.isFinite)
  ) {
    const vecPool = priors.filter(
      r =>
        Array.isArray(r.marketFeatureVector) &&
        r.marketFeatureVector.length === 19 &&
        r.marketFeatureVector.every(Number.isFinite)
    );
    if (vecPool.length >= 8) {
      const scored = vecPool
        .map(r => {
          const sim = cosineSimilarity(input.marketFeatureVector!, r.marketFeatureVector!);
          const sameRegimeBoost =
            input.regime && r.regimeType && r.regimeType === input.regime.regimeType ? 0.08 : 0;
          const upOutcome =
            (r.direction === 'BUY' && r.outcome === 'WIN') ||
            (r.direction === 'SELL' && r.outcome === 'LOSS')
              ? 1
              : 0;
          return { sim: sim + sameRegimeBoost, rawSim: sim, upOutcome };
        })
        .filter(item => item.rawSim >= 0.55)
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 12);

      if (scored.length >= 6) {
        knnMatchesUsed = scored.length;
        let wSum = 0;
        let upSum = 0;
        for (const n of scored) {
          const w = Math.max(0.01, n.rawSim);
          wSum += w;
          upSum += w * n.upOutcome;
        }
        const upProb = upSum / wSum;
        const dirKnnRaw = input.direction === 'BUY' ? upProb : 1 - upProb;
        const KNN_M = 18;
        knnProb =
          (dirKnnRaw * scored.length + priorMean * KNN_M) / (scored.length + KNN_M);
        deltaLogOdds += 0.35 * (logit(knnProb) - priorLogOdds);
        estimators.push(knnProb);
      }
    }
  }

  // 8. Regime and severe behavioural trap penalty
  const regimePenalty =
    input.regime?.regimeType === 'RANDOM_WALK_CHOP'
      ? -0.18
      : input.regime &&
          ((input.ruleFamily === 'mean_reversion' && input.regime.regimeType === 'TRENDING') ||
            (input.ruleFamily === 'trend_follow' && input.regime.regimeType === 'MEAN_REVERTING'))
        ? -0.12
        : 0;
  const trapPenalty =
    typeof input.severeTrapCount === 'number' && input.severeTrapCount > 0
      ? -0.25 * Math.min(2, input.severeTrapCount)
      : 0;

  const rawProbability = clamp(
    sigmoid(priorLogOdds + clamp(deltaLogOdds, -0.75, 0.75) + regimePenalty + trapPenalty),
    0.05,
    0.95
  );

  // 9. Out-of-sample regularized linear log-odds calibrator fitted ONLY on prior outcomes with rawScoreProb
  let calibratedProbability = rawProbability;
  const calibrationPairs = priors.filter(
    (p): p is PriorEpisodeRecord & { rawScoreProb: number } =>
      typeof p.rawScoreProb === 'number' && Number.isFinite(p.rawScoreProb)
  );
  let sampleSupport = priorTotal;
  if (calibrationPairs.length >= 25) {
    // Strongly regularized 1D online Platt fit (a in [0.35, 1.05], b shrunk toward 0)
    let a = 0.65;
    let b = 0.0;
    const lr = 0.06;
    const reg = 0.45;
    for (let epoch = 0; epoch < 20; epoch++) {
      let gA = reg * (a - 0.65);
      let gB = reg * b;
      for (const cp of calibrationPairs) {
        const z = logit(cp.rawScoreProb) - priorLogOdds;
        const pred = sigmoid(a * z + b + priorLogOdds);
        const y = cp.outcome === 'WIN' ? 1 : 0;
        const err = pred - y;
        gA += (err * z) / calibrationPairs.length;
        gB += err / calibrationPairs.length;
      }
      a = clamp(a - lr * gA, 0.35, 1.05);
      b = clamp(b - lr * gB, -0.35, 0.35);
    }
    const zNow = logit(rawProbability) - priorLogOdds;
    const plattProb = sigmoid(a * zNow + b + priorLogOdds);
    const blendW = clamp(calibrationPairs.length / 90, 0.25, 0.75);
    calibratedProbability = clamp(
      blendW * plattProb + (1 - blendW) * rawProbability,
      0.05,
      0.95
    );
    sampleSupport = calibrationPairs.length;
  }

  // 10. Uncertainty estimation (model disagreement + effective sample size lower bound)
  let disagreement = 0;
  if (estimators.length >= 2) {
    const meanEst = estimators.reduce((s, v) => s + v, 0) / estimators.length;
    const variance =
      estimators.reduce((s, v) => s + (v - meanEst) * (v - meanEst), 0) / estimators.length;
    disagreement = Math.sqrt(variance);
  }

  // Conservative one-sided lower confidence bound (reported for telemetry & severe risk gating)
  const effectiveEvidenceN = Math.max(12, Math.min(100, 14 + stratMatches.length + knnMatchesUsed));
  const se = Math.sqrt((calibratedProbability * (1 - calibratedProbability)) / effectiveEvidenceN);
  const conservativeLowerBound = clamp(calibratedProbability - 0.65 * se - disagreement * 0.2, 0.01, 0.99);

  const expectedValueUnits =
    calibratedProbability * (payoutPct / 100) - (1 - calibratedProbability);

  // Evidence-based natural abstention reasons (NO daily quotas)
  const abstentionReasons: string[] = [];
  if (calibratedProbability <= breakEvenProbability) {
    abstentionReasons.push('NEGATIVE_EXPECTED_VALUE');
  } else if (conservativeLowerBound < breakEvenProbability - 0.065) {
    abstentionReasons.push('INSUFFICIENT_LOWER_BOUND_EDGE');
  }
  if (disagreement > 0.16) {
    abstentionReasons.push('HIGH_MODEL_DISAGREEMENT');
  }
  if (
    input.regime?.regimeType === 'RANDOM_WALK_CHOP' &&
    calibratedProbability < breakEvenProbability + 0.03
  ) {
    abstentionReasons.push('CHAOTIC_REGIME_INSUFFICIENT_EDGE');
  }
  if (typeof input.severeTrapCount === 'number' && input.severeTrapCount >= 2) {
    abstentionReasons.push('SEVERE_BEHAVIOURAL_TRAP');
  }
  if (priorTotal < 8 && calibratedProbability < breakEvenProbability + 0.015) {
    abstentionReasons.push('COLD_START_INSUFFICIENT_HISTORY');
  }

  return {
    modelVersion: SHADOW_CANDIDATE_VERSION,
    rawProbability: round(rawProbability, 4),
    calibratedProbability: round(calibratedProbability, 4),
    lowerConfidenceBound: round(conservativeLowerBound, 4),
    breakEvenProbability: round(breakEvenProbability, 4),
    payoutPctUsed: round(payoutPct, 2),
    expectedValueUnits: round(expectedValueUnits, 4),
    shouldAbstain: abstentionReasons.length > 0,
    abstentionReasons,
    linUcbV2Score:
      typeof input.linUcbV2Score === 'number' ? round(input.linUcbV2Score, 4) : 0,
    ftrlProbability:
      typeof input.ftrlProbability === 'number' ? round(input.ftrlProbability, 4) : 0.5,
    mlpDirectionalProbability:
      mlpActive && typeof input.mlpUpProbability === 'number'
        ? round(
            input.direction === 'BUY' ? input.mlpUpProbability : 1 - input.mlpUpProbability,
            4
          )
        : 0.5,
    regimeType: input.regime?.regimeType || 'UNKNOWN',
    modelDisagreement: round(disagreement, 4),
    calibrationSampleSize: sampleSupport,
  };
}

// =============================================================================
// PHASE 3 & 4: CHRONOLOGICAL WALK-FORWARD EVALUATOR
// =============================================================================

export interface CalibrationBinStat {
  band: string;
  count: number;
  wins: number;
  losses: number;
  meanPredicted: number;
  empiricalWinRate: number;
  ci95Low: number;
  ci95High: number;
  netReturnUnits: number;
}

export interface GroupBreakdownStat {
  key: string;
  count: number;
  wins: number;
  losses: number;
  winRate: number;
  ci95Low: number;
  ci95High: number;
  netReturnUnits: number;
}

export interface CoveragePointStat {
  coveragePct: number;
  takenCount: number;
  wins: number;
  losses: number;
  winRate: number;
  ci95Low: number;
  ci95High: number;
  netReturnUnits: number;
}

export interface ModelEvaluationMetrics {
  sampleCount: number;
  wins: number;
  losses: number;
  winRate: number;
  ci95Low: number;
  ci95High: number;
  netReturnUnits: number;
  meanConfidence: number;
  prevalenceBrierBaseline: number;
  brierScore: number;
  brierSkillVsPrevalence: number;
  prevalenceLogLossBaseline: number;
  logLoss: number;
  ece: number;
  confidenceBands: CalibrationBinStat[];
  coverageCurve: CoveragePointStat[];
}

export interface ChronologicalBenchmarkReport {
  generatedAt: string;
  datasetSummary: {
    totalInputSignals: number;
    settledWinLoss: number;
    legacyWinLoss: number;
    olympVerifiedWinLoss: number;
    withFrozenFeatures: number;
    missingFrozenFeatures: number;
  };
  baselineAll: ModelEvaluationMetrics;
  shadowAll: ModelEvaluationMetrics;
  shadowAccepted: ModelEvaluationMetrics;
  shadowAbstained: ModelEvaluationMetrics;
  splitByProvenance: {
    legacy: { baseline: ModelEvaluationMetrics; shadowAccepted: ModelEvaluationMetrics };
    olympVerified: { baseline: ModelEvaluationMetrics; shadowAccepted: ModelEvaluationMetrics };
  };
  breakdowns: {
    byDirection: GroupBreakdownStat[];
    byRuleFamily: GroupBreakdownStat[];
    bySession: GroupBreakdownStat[];
    byRegime: GroupBreakdownStat[];
    topPairsByVolume: GroupBreakdownStat[];
  };
  banditComparison: {
    gamma096ThrottledCount: number;
    gamma0985WithRecoveryThrottledCount: number;
    armsComparison: Array<{
      strategyId: string;
      totalTrades: number;
      empiricalWinRate: number;
      gamma096Rate: number;
      gamma096Throttled: boolean;
      gamma0985Rate: number;
      gamma0985WouldProbeOrRecover: boolean;
    }>;
  };
  knnComparison: {
    exactPairDirectionEvaluations: number;
    exactPairSufficientCount: number;
    exactPairVetoes: number;
    exactPairVetoedWinRate: number | null;
    crossPairEvaluations: number;
    crossPairSufficientCount: number;
    crossPairVetoes: number;
    crossPairVetoedWinRate: number | null;
    crossPairClearedWinRate: number | null;
  };
}

interface ScoredRecord {
  signal: ResearchSignal;
  outcome: 'WIN' | 'LOSS';
  y: number;
  netUnits: number;
  prob: number;
  regimeType: string;
}

function summarizeScoredRecords(records: ScoredRecord[]): ModelEvaluationMetrics {
  const n = records.length;
  if (n === 0) {
    return {
      sampleCount: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      ci95Low: 0,
      ci95High: 1,
      netReturnUnits: 0,
      meanConfidence: 0,
      prevalenceBrierBaseline: 0.25,
      brierScore: 0,
      brierSkillVsPrevalence: 0,
      prevalenceLogLossBaseline: round(Math.log(2), 4),
      logLoss: 0,
      ece: 0,
      confidenceBands: [],
      coverageCurve: [],
    };
  }

  const wins = records.filter(r => r.y === 1).length;
  const losses = n - wins;
  const wi = wilsonInterval(wins, n, 1.96);
  const pBar = wins / n;
  const prevalenceBrierBaseline = pBar * (1 - pBar);
  const clippedPBar = clamp(pBar, 1e-6, 1 - 1e-6);
  const prevalenceLogLossBaseline = -(
    clippedPBar * Math.log(clippedPBar) +
    (1 - clippedPBar) * Math.log(1 - clippedPBar)
  );

  let brierSum = 0;
  let logLossSum = 0;
  let confSum = 0;
  let netSum = 0;

  for (const r of records) {
    const p = clamp(r.prob, 1e-6, 1 - 1e-6);
    brierSum += (p - r.y) * (p - r.y);
    logLossSum += -(r.y * Math.log(p) + (1 - r.y) * Math.log(1 - p));
    confSum += r.prob;
    netSum += r.netUnits;
  }

  const brierScore = brierSum / n;
  const logLoss = logLossSum / n;
  const brierSkillVsPrevalence =
    prevalenceBrierBaseline > 1e-9 ? 1 - brierScore / prevalenceBrierBaseline : 0;

  const bandDefs = [
    { label: '<0.55', min: -1, max: 0.55 },
    { label: '0.55-0.60', min: 0.55, max: 0.6 },
    { label: '0.60-0.72', min: 0.6, max: 0.72 },
    { label: '0.72-0.76', min: 0.72, max: 0.76 },
    { label: '0.76-0.80', min: 0.76, max: 0.8 },
    { label: '0.80-1.00', min: 0.8, max: 1.01 },
  ];

  let ece = 0;
  const confidenceBands: CalibrationBinStat[] = [];
  for (const bd of bandDefs) {
    const bucket = records.filter(r => r.prob >= bd.min && r.prob < bd.max);
    if (bucket.length === 0) continue;
    const bWins = bucket.filter(r => r.y === 1).length;
    const bLosses = bucket.length - bWins;
    const bWi = wilsonInterval(bWins, bucket.length, 1.96);
    const meanPred = bucket.reduce((s, r) => s + r.prob, 0) / bucket.length;
    const bNet = bucket.reduce((s, r) => s + r.netUnits, 0);
    ece += (bucket.length / n) * Math.abs(meanPred - bWins / bucket.length);
    confidenceBands.push({
      band: bd.label,
      count: bucket.length,
      wins: bWins,
      losses: bLosses,
      meanPredicted: round(meanPred, 4),
      empiricalWinRate: bWi.winRate,
      ci95Low: bWi.lower,
      ci95High: bWi.upper,
      netReturnUnits: round(bNet, 2),
    });
  }

  // Coverage vs accuracy curve ranked by predicted probability descending
  const ranked = [...records].sort((a, b) => b.prob - a.prob);
  const coverageCurve: CoveragePointStat[] = [];
  for (const pct of [100, 80, 60, 40, 25]) {
    const takeCount = Math.max(1, Math.round((pct / 100) * n));
    const slice = ranked.slice(0, takeCount);
    const sWins = slice.filter(r => r.y === 1).length;
    const sWi = wilsonInterval(sWins, slice.length, 1.96);
    const sNet = slice.reduce((s, r) => s + r.netUnits, 0);
    coverageCurve.push({
      coveragePct: round((slice.length / n) * 100, 1),
      takenCount: slice.length,
      wins: sWins,
      losses: slice.length - sWins,
      winRate: sWi.winRate,
      ci95Low: sWi.lower,
      ci95High: sWi.upper,
      netReturnUnits: round(sNet, 2),
    });
  }

  return {
    sampleCount: n,
    wins,
    losses,
    winRate: wi.winRate,
    ci95Low: wi.lower,
    ci95High: wi.upper,
    netReturnUnits: round(netSum, 2),
    meanConfidence: round(confSum / n, 4),
    prevalenceBrierBaseline: round(prevalenceBrierBaseline, 5),
    brierScore: round(brierScore, 5),
    brierSkillVsPrevalence: round(brierSkillVsPrevalence, 5),
    prevalenceLogLossBaseline: round(prevalenceLogLossBaseline, 5),
    logLoss: round(logLoss, 5),
    ece: round(ece, 5),
    confidenceBands,
    coverageCurve,
  };
}

function summarizeGroups(
  records: ScoredRecord[],
  keyFn: (r: ScoredRecord) => string
): GroupBreakdownStat[] {
  const buckets = new Map<string, ScoredRecord[]>();
  for (const r of records) {
    const k = keyFn(r) || 'UNKNOWN';
    const arr = buckets.get(k) || [];
    arr.push(r);
    buckets.set(k, arr);
  }
  const result: GroupBreakdownStat[] = [];
  for (const [key, group] of buckets.entries()) {
    const wins = group.filter(r => r.y === 1).length;
    const wi = wilsonInterval(wins, group.length, 1.96);
    const net = group.reduce((s, r) => s + r.netUnits, 0);
    result.push({
      key,
      count: group.length,
      wins,
      losses: group.length - wins,
      winRate: wi.winRate,
      ci95Low: wi.lower,
      ci95High: wi.upper,
      netReturnUnits: round(net, 2),
    });
  }
  return result.sort((a, b) => b.count - a.count);
}

/**
 * Replays historical settled signals strictly chronologically:
 * prediction is scored strictly BEFORE any outcome settles, and outcomes enter
 * training/calibration buffers only after `outcomeTimeMs <= nextPredictionTimeMs`.
 */
export function evaluateShadowCandidateChronologically(
  signals: ResearchSignal[],
  candlesBySymbol?: Partial<Record<ForexSymbol, Candle[]>>
): ChronologicalBenchmarkReport {
  const settledAll = signals
    .filter(
      s =>
        s.lifecycleState === 'CLOSED' &&
        (s.outcomeResult === 'WIN' || s.outcomeResult === 'LOSS') &&
        !s.ruleFamily?.startsWith('test_')
    )
    .sort((a, b) => {
      const ta = Date.parse(a.predictionTimeUtc || a.actualEntryTimeUtc || '');
      const tb = Date.parse(b.predictionTimeUtc || b.actualEntryTimeUtc || '');
      return ta - tb;
    });

  let ftrlState: OnlineLearnerState = createInitialOnlineLearnerState();
  const replayPolicyNet = new OnlinePolicyNetwork({ skipAutoLoad: true, persistToDb: false });
  const priorBuffer: PriorEpisodeRecord[] = [];

  // Pending settled queue waiting until their actual outcome timestamp passes (strict temporal embargo!)
  const pendingSettlements: Array<{
    settleMs: number;
    signal: ResearchSignal;
    outcome: 'WIN' | 'LOSS';
    netUnits: number;
    regimeType: string;
    rawScoreProb: number;
    ftrlPredProb: number | null;
  }> = [];

  // Bandit variant simulation state
  const arms096 = new Map<string, { alpha: number; beta: number; wins: number; losses: number }>();
  const arms0985 = new Map<
    string,
    { alpha: number; beta: number; wins: number; losses: number; sinceProbe: number }
  >();

  // k-NN variant simulation stats
  let exactPairEvaluations = 0;
  let exactPairSufficientCount = 0;
  let exactPairVetoes = 0;
  let exactPairVetoWins = 0;
  let crossPairEvaluations = 0;
  let crossPairSufficientCount = 0;
  let crossPairVetoes = 0;
  let crossPairVetoWins = 0;
  let crossPairClearedCount = 0;
  let crossPairClearedWins = 0;

  const flushSettlementsUpTo = (predMs: number) => {
    pendingSettlements.sort((a, b) => a.settleMs - b.settleMs);
    while (pendingSettlements.length > 0 && pendingSettlements[0].settleMs <= predMs) {
      const done = pendingSettlements.shift()!;
      const sig = done.signal;
      const hasVec =
        Array.isArray(sig.marketFeatureVector) &&
        sig.marketFeatureVector.length === 19 &&
        sig.marketFeatureVector.every(Number.isFinite);

      if (hasVec) {
        ftrlState = learnOnlineOutcome(
          ftrlState,
          {
            symbol: sig.symbol,
            direction: sig.direction,
            ruleFamily: sig.ruleFamily,
            marketFeatureVector: sig.marketFeatureVector!,
          },
          done.outcome,
          done.ftrlPredProb ?? 0.5,
          sig.actualExitTimeUtc || sig.predictionTimeUtc
        );

        replayPolicyNet.trainStep(
          sig.marketFeatureVector!,
          sig.direction,
          done.outcome,
          done.netUnits,
          sig.symbol,
          sig.id,
          sig.actualExitTimeUtc || sig.predictionTimeUtc
        );
      }

      priorBuffer.push({
        symbol: sig.symbol,
        direction: sig.direction,
        ruleFamily: sig.ruleFamily,
        strategyId: sig.strategyId,
        outcome: done.outcome,
        netReturnUnits: done.netUnits,
        regimeType: done.regimeType,
        marketFeatureVector: hasVec ? sig.marketFeatureVector : undefined,
        rawScoreProb: done.rawScoreProb,
      });

      // Bandit simulations
      const armId = sig.strategyId || `rule:${sig.ruleFamily}`;
      const cur96 = arms096.get(armId) || { alpha: 3, beta: 2, wins: 0, losses: 0 };
      cur96.alpha = 3 + (cur96.alpha - 3) * 0.96;
      cur96.beta = 2 + (cur96.beta - 2) * 0.96;
      if (done.outcome === 'WIN') {
        cur96.alpha += 1;
        cur96.wins += 1;
      } else {
        cur96.beta += 1;
        cur96.losses += 1;
      }
      arms096.set(armId, cur96);

      const cur985 = arms0985.get(armId) || {
        alpha: 3,
        beta: 2,
        wins: 0,
        losses: 0,
        sinceProbe: 0,
      };
      cur985.alpha = 3 + (cur985.alpha - 3) * 0.985;
      cur985.beta = 2 + (cur985.beta - 2) * 0.985;
      if (done.outcome === 'WIN') {
        cur985.alpha += 1;
        cur985.wins += 1;
      } else {
        cur985.beta += 1;
        cur985.losses += 1;
      }
      cur985.sinceProbe += 1;
      arms0985.set(armId, cur985);
    }
  };

  const baselineRecords: ScoredRecord[] = [];
  const shadowAllRecords: ScoredRecord[] = [];
  const shadowAcceptedRecords: ScoredRecord[] = [];
  const shadowAbstainedRecords: ScoredRecord[] = [];

  for (const sig of settledAll) {
    const predMs = Date.parse(sig.predictionTimeUtc || sig.actualEntryTimeUtc || '') || 0;
    flushSettlementsUpTo(predMs);

    const outcome = sig.outcomeResult as 'WIN' | 'LOSS';
    const y = outcome === 'WIN' ? 1 : 0;
    const netUnits =
      typeof sig.netReturnUnits === 'number' && Number.isFinite(sig.netReturnUnits)
        ? sig.netReturnUnits
        : outcome === 'WIN'
          ? (sig.payoutPct || 80) / 100
          : -1.0;
    const regimeType = sig.predictionMarketRegime || 'UNKNOWN';

    const hasVec =
      Array.isArray(sig.marketFeatureVector) &&
      sig.marketFeatureVector.length === 19 &&
      sig.marketFeatureVector.every(Number.isFinite);

    // Query FTRL, MLP, LinUCB V2 strictly BEFORE this signal's outcome settles
    const ftrlPred = hasVec
      ? predictOnlineOutcome(ftrlState, {
          symbol: sig.symbol,
          direction: sig.direction,
          ruleFamily: sig.ruleFamily,
          marketFeatureVector: sig.marketFeatureVector!,
        })
      : null;
    const netTel = replayPolicyNet.getTelemetry();
    const netEval = hasVec ? replayPolicyNet.forward(sig.marketFeatureVector!) : null;
    const v2Eval = hasVec
      ? replayPolicyNet.evaluateLinUcbV2(sig.marketFeatureVector!, sig.direction)
      : null;

    // k-NN exact (symbol, direction) vs cross-pair evaluation on prior settled vectors
    if (hasVec) {
      exactPairEvaluations++;
      const exactRes = replayPolicyNet.queryEpisodicKNN(
        sig.marketFeatureVector!,
        sig.symbol,
        sig.direction,
        7
      );
      if (exactRes.neighbors >= 5) {
        exactPairSufficientCount++;
        if (exactRes.shouldVeto) {
          exactPairVetoes++;
          if (outcome === 'WIN') exactPairVetoWins++;
        }
      }

      crossPairEvaluations++;
      const vecPool = priorBuffer.filter(
        r =>
          Array.isArray(r.marketFeatureVector) &&
          r.marketFeatureVector.length === 19 &&
          r.marketFeatureVector.every(Number.isFinite)
      );
      const topCross = vecPool
        .map(r => ({
          sim: cosineSimilarity(sig.marketFeatureVector!, r.marketFeatureVector!),
          upOutcome:
            (r.direction === 'BUY' && r.outcome === 'WIN') ||
            (r.direction === 'SELL' && r.outcome === 'LOSS')
              ? 1
              : 0,
        }))
        .filter(item => item.sim >= 0.55)
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 7);
      if (topCross.length >= 5) {
        crossPairSufficientCount++;
        const upMean = topCross.reduce((s, r) => s + r.upOutcome, 0) / topCross.length;
        const dirWin = sig.direction === 'BUY' ? upMean : 1 - upMean;
        if (dirWin < 0.42) {
          crossPairVetoes++;
          if (outcome === 'WIN') crossPairVetoWins++;
        } else {
          crossPairClearedCount++;
          if (outcome === 'WIN') crossPairClearedWins++;
        }
      }
    }

    const shadowEval = evaluateShadowCandidate({
      symbol: sig.symbol,
      direction: sig.direction,
      ruleFamily: sig.ruleFamily,
      strategyId: sig.strategyId,
      payoutPct: sig.payoutPct,
      marketFeatureVector: hasVec ? sig.marketFeatureVector : undefined,
      ftrlProbability: ftrlPred?.probability,
      ftrlSampleSize: ftrlPred?.sampleSize ?? ftrlState.sampleCount,
      mlpUpProbability: netEval?.probabilityUp,
      mlpStepCount: netTel.stepCount,
      mlpOosBce: netTel.validationLossOos,
      linUcbV2Score: v2Eval?.ucbScore ?? null,
      linUcbV2Obs: v2Eval?.actionObservations ?? 0,
      regime:
        regimeType !== 'UNKNOWN'
          ? {
              symbol: sig.symbol,
              regimeType: regimeType as MarketRegimeState['regimeType'],
              hurstExponent: 0.5,
              shannonEntropy: 0.5,
              atrPercentile: 50,
              recommendedFamily: 'momentum',
              calculatedAt: sig.predictionTimeUtc,
            }
          : null,
      priorSettledRecords: priorBuffer,
    });

    const baseRec: ScoredRecord = {
      signal: sig,
      outcome,
      y,
      netUnits,
      prob: clamp(sig.confidence ?? 0.75, 0.01, 0.99),
      regimeType,
    };
    const shadRec: ScoredRecord = {
      signal: sig,
      outcome,
      y,
      netUnits,
      prob: shadowEval.calibratedProbability,
      regimeType,
    };

    baselineRecords.push(baseRec);
    shadowAllRecords.push(shadRec);
    if (shadowEval.shouldAbstain) shadowAbstainedRecords.push(shadRec);
    else shadowAcceptedRecords.push(shadRec);

    const settleMs =
      Date.parse(sig.actualExitTimeUtc || sig.plannedExitTimeUtc || sig.predictionTimeUtc) ||
      predMs + 5 * 60 * 1000;
    pendingSettlements.push({
      settleMs: Math.max(predMs + 1, settleMs),
      signal: sig,
      outcome,
      netUnits,
      regimeType,
      rawScoreProb: shadowEval.rawProbability,
      ftrlPredProb: ftrlPred?.probability ?? null,
    });
  }

  // Flush remaining outcomes at end of series to report final bandit arm states
  flushSettlementsUpTo(Number.MAX_SAFE_INTEGER);

  const legacyBase = baselineRecords.filter(r => r.signal.payoutSource !== 'BROKER_OBSERVED');
  const legacyAcc = shadowAcceptedRecords.filter(r => r.signal.payoutSource !== 'BROKER_OBSERVED');
  const olympBase = baselineRecords.filter(r => r.signal.payoutSource === 'BROKER_OBSERVED');
  const olympAcc = shadowAcceptedRecords.filter(r => r.signal.payoutSource === 'BROKER_OBSERVED');

  const armsComparison: ChronologicalBenchmarkReport['banditComparison']['armsComparison'] = [];
  let gamma096ThrottledCount = 0;
  let gamma0985WithRecoveryThrottledCount = 0;

  for (const [strategyId, arm96] of arms096.entries()) {
    const total = arm96.wins + arm96.losses;
    const rate96 = arm96.alpha / (arm96.alpha + arm96.beta);
    const emp = total > 0 ? arm96.wins / total : 0.5;
    const throttled96 = total >= 8 && (rate96 < 0.556 || emp < 0.556);
    if (throttled96) gamma096ThrottledCount++;

    const arm985 = arms0985.get(strategyId)!;
    const rate985 = arm985.alpha / (arm985.alpha + arm985.beta);
    const wi985 = wilsonInterval(arm985.wins, total, 1.645);
    // Recover/probe eligible if decayed rate recovers >= 0.556 OR Wilson 90% upper bound exceeds break-even
    const canRecoverOrProbe = rate985 >= 0.556 || wi985.upper >= 0.56;
    const stillThrottled985 = total >= 12 && rate985 < 0.53 && !canRecoverOrProbe;
    if (stillThrottled985) gamma0985WithRecoveryThrottledCount++;

    armsComparison.push({
      strategyId,
      totalTrades: total,
      empiricalWinRate: round(emp, 4),
      gamma096Rate: round(rate96, 4),
      gamma096Throttled: throttled96,
      gamma0985Rate: round(rate985, 4),
      gamma0985WouldProbeOrRecover: throttled96 && canRecoverOrProbe,
    });
  }
  armsComparison.sort((a, b) => b.totalTrades - a.totalTrades);

  const withFrozen = settledAll.filter(
    s =>
      Array.isArray(s.marketFeatureVector) &&
      s.marketFeatureVector.length === 19 &&
      s.marketFeatureVector.every(Number.isFinite)
  ).length;

  void candlesBySymbol; // Reserved for optional candle-derived regime audits without future leakage

  return {
    generatedAt: new Date().toISOString(),
    datasetSummary: {
      totalInputSignals: signals.length,
      settledWinLoss: settledAll.length,
      legacyWinLoss: settledAll.filter(s => s.payoutSource !== 'BROKER_OBSERVED').length,
      olympVerifiedWinLoss: settledAll.filter(s => s.payoutSource === 'BROKER_OBSERVED').length,
      withFrozenFeatures: withFrozen,
      missingFrozenFeatures: settledAll.length - withFrozen,
    },
    baselineAll: summarizeScoredRecords(baselineRecords),
    shadowAll: summarizeScoredRecords(shadowAllRecords),
    shadowAccepted: summarizeScoredRecords(shadowAcceptedRecords),
    shadowAbstained: summarizeScoredRecords(shadowAbstainedRecords),
    splitByProvenance: {
      legacy: {
        baseline: summarizeScoredRecords(legacyBase),
        shadowAccepted: summarizeScoredRecords(legacyAcc),
      },
      olympVerified: {
        baseline: summarizeScoredRecords(olympBase),
        shadowAccepted: summarizeScoredRecords(olympAcc),
      },
    },
    breakdowns: {
      byDirection: summarizeGroups(baselineRecords, r => r.signal.direction),
      byRuleFamily: summarizeGroups(baselineRecords, r => r.signal.ruleFamily || 'unknown'),
      bySession: summarizeGroups(baselineRecords, r => r.signal.marketSession || 'UNKNOWN'),
      byRegime: summarizeGroups(baselineRecords, r => r.regimeType),
      topPairsByVolume: summarizeGroups(baselineRecords, r => r.signal.symbol).slice(0, 12),
    },
    banditComparison: {
      gamma096ThrottledCount,
      gamma0985WithRecoveryThrottledCount,
      armsComparison,
    },
    knnComparison: {
      exactPairDirectionEvaluations: exactPairEvaluations,
      exactPairSufficientCount,
      exactPairVetoes,
      exactPairVetoedWinRate:
        exactPairVetoes > 0 ? round(exactPairVetoWins / exactPairVetoes, 4) : null,
      crossPairEvaluations,
      crossPairSufficientCount,
      crossPairVetoes,
      crossPairVetoedWinRate:
        crossPairVetoes > 0 ? round(crossPairVetoWins / crossPairVetoes, 4) : null,
      crossPairClearedWinRate:
        crossPairClearedCount > 0 ? round(crossPairClearedWins / crossPairClearedCount, 4) : null,
    },
  };
}
