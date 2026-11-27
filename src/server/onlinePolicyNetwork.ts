/**
 * SignalForge ML — Production Online Neural Policy & Contextual Bandit
 * Real mathematical machine learning running in production:
 * 1. Online 19-16-1 Multi-Layer Perceptron (MLP) with analytical backpropagation & persistent Adam optimizer.
 * 2. Legacy LinUCB (retained for baseline parity) + Shadow LinUCB V2 (direction-conditioned BUY/SELL 38D block-diagonal with actual netReturnUnits reward).
 * 3. Exact L2 k-Nearest Neighbors (k-NN) episodic memory bank.
 * Zero lookahead: offline/settlement training uses ONLY prediction-time frozen marketFeatureVector.
 */

import { Candle, ForexSymbol, ResearchSignal, SignalDirection } from '../types/index.js';
import { db } from './db.js';

export const ONLINE_POLICY_MODEL_VERSION = 'mlp-19-16-1-adam-v2';
export const LINUCB_V2_MODEL_VERSION = 'linucb-dir-block38d-v2';

export type OptimizerRestorationStatus =
  | 'FRESH_INITIALIZED'
  | 'RESTORED_WITH_ADAM_MOMENTS'
  | 'MIGRATED_LEGACY_RESET_ADAM_STEP';

export interface ModelTelemetry {
  modelVersion: string;
  stepCount: number;
  adamStepCount: number;
  optimizerRestorationStatus: OptimizerRestorationStatus;
  lastLoss: number;
  averageLoss20: number;
  validationLossOos: number | null;
  oosDirectionalAccuracy: number | null;
  oosEvaluatedCount: number;
  gradientNorm: number;
  learningRate: number;
  activeWeightsNorm: number;
  linUcbConfidenceRadius: number;
  storedMemoryEpisodes: number;
  trainedSignalCount: number;
  skippedMissingFeaturesCount: number;
  duplicateAttemptsBlocked: number;
  lastTrainedAt: string | null;
  lastUpdated: string | null;
  linUcbV2: {
    version: string;
    mode: 'SHADOW_ONLY';
    observationsBuy: number;
    observationsSell: number;
    totalObservations: number;
    meanReward: number | null;
    meanExplorationBonus: number | null;
    meanExploitationScore: number | null;
    lastTrainedAt: string | null;
  };
}

export function hasTrustedPredictionFeatures(signal?: Partial<ResearchSignal> | null): boolean {
  return Boolean(
    signal &&
      Array.isArray(signal.marketFeatureVector) &&
      signal.marketFeatureVector.length === 19 &&
      signal.marketFeatureVector.every(v => typeof v === 'number' && Number.isFinite(v))
  );
}

function createIdentityMatrix(dim: number): number[][] {
  const mat: number[][] = [];
  for (let i = 0; i < dim; i++) {
    mat[i] = new Array(dim).fill(0);
    mat[i][i] = 1.0;
  }
  return mat;
}

function createZeroMatrix(rows: number, cols: number): number[][] {
  return Array.from({ length: rows }, () => new Array(cols).fill(0));
}

function isValidMatrix(m: unknown, rows: number, cols: number, requireNonNeg = false): m is number[][] {
  if (!Array.isArray(m) || m.length !== rows) return false;
  for (const row of m) {
    if (!Array.isArray(row) || row.length !== cols) return false;
    for (const v of row) {
      if (typeof v !== 'number' || !Number.isFinite(v)) return false;
      if (requireNonNeg && v < 0) return false;
    }
  }
  return true;
}

function isValidVector(v: unknown, len: number, requireNonNeg = false): v is number[] {
  if (!Array.isArray(v) || v.length !== len) return false;
  for (const item of v) {
    if (typeof item !== 'number' || !Number.isFinite(item)) return false;
    if (requireNonNeg && item < 0) return false;
  }
  return true;
}

export class OnlinePolicyNetwork {
  // Network Dimensions: 19 input features -> 16 hidden neurons -> 1 output
  private readonly inputDim = 19;
  private readonly hiddenDim = 16;

  // Parameters
  private W1!: number[][]; // 16 x 19
  private b1!: number[]; // 16
  private W2!: number[]; // 16
  private b2: number = 0; // scalar

  // Adam Optimizer State
  private mW1!: number[][];
  private vW1!: number[][];
  private mb1!: number[];
  private vb1!: number[];
  private mW2!: number[];
  private vW2!: number[];
  private mb2: number = 0;
  private vb2: number = 0;

  private t: number = 0; // Total lifetime MLP optimization updates
  private adamT: number = 0; // Adam bias-correction step synchronized with m/v moments
  private optimizerRestorationStatus: OptimizerRestorationStatus = 'FRESH_INITIALIZED';
  private readonly lr = 0.015;
  private readonly beta1 = 0.9;
  private readonly beta2 = 0.999;
  private readonly eps = 1e-8;

  // Legacy LinUCB (retained untouched for baseline parity)
  private LinUcbA!: number[][];
  private LinUcbB!: number[];
  private readonly linUcbAlpha = 0.45;

  // Shadow LinUCB V2: direction-conditioned BUY/SELL 19x19 ridge contextual bandits using netReturnUnits
  private v2ABuy!: number[][];
  private v2BBuy!: number[];
  private v2ASell!: number[][];
  private v2BSell!: number[];
  private readonly v2Alpha = 0.35;
  private v2ObservationsBuy = 0;
  private v2ObservationsSell = 0;
  private v2TotalReward = 0;
  private v2ExplorationTotal = 0;
  private v2ExploitationTotal = 0;
  private v2TrainedSignalIds: Set<string> = new Set();
  private v2LastTrainedAt: string | null = null;

  // Episodic Memory Matrix
  private episodicMemory: Array<{
    signalId?: string;
    vector: number[];
    symbol: ForexSymbol;
    direction: SignalDirection;
    y: number; // 1 = Win, 0 = Loss
    timestamp: string;
  }> = [];

  private trainedSignalIds: Set<string> = new Set();
  private trailingLosses: number[] = [];
  private oosLosses: number[] = [];
  private oosDirectionCorrect = 0;
  private oosDirectionTotal = 0;
  private lastGradNorm: number = 0;
  private lastTrainedAt: string | null = null;
  private skippedTrainingRecords: Array<{ signalId: string; reason: string; at: string }> = [];
  private duplicateBlocks = 0;
  private readonly persistToDb: boolean;

  constructor(options?: { skipAutoLoad?: boolean; persistToDb?: boolean }) {
    this.persistToDb = options?.persistToDb ?? true;
    this.initFreshParameters();
    if (!options?.skipAutoLoad) {
      this.loadPersistedState();
    }
  }

  private initFreshParameters() {
    this.W1 = [];
    this.mW1 = createZeroMatrix(this.hiddenDim, this.inputDim);
    this.vW1 = createZeroMatrix(this.hiddenDim, this.inputDim);
    const scale1 = Math.sqrt(2.0 / (this.inputDim + this.hiddenDim));
    for (let i = 0; i < this.hiddenDim; i++) {
      this.W1[i] = [];
      for (let j = 0; j < this.inputDim; j++) {
        this.W1[i][j] = (Math.random() * 2 - 1) * scale1;
      }
    }

    this.b1 = new Array(this.hiddenDim).fill(0.01);
    this.mb1 = new Array(this.hiddenDim).fill(0);
    this.vb1 = new Array(this.hiddenDim).fill(0);

    const scale2 = Math.sqrt(2.0 / (this.hiddenDim + 1));
    this.W2 = [];
    this.mW2 = new Array(this.hiddenDim).fill(0);
    this.vW2 = new Array(this.hiddenDim).fill(0);
    for (let i = 0; i < this.hiddenDim; i++) {
      this.W2[i] = (Math.random() * 2 - 1) * scale2;
    }
    this.b2 = 0.0;
    this.mb2 = 0;
    this.vb2 = 0;

    this.LinUcbA = createIdentityMatrix(this.inputDim);
    this.LinUcbB = new Array(this.inputDim).fill(0);

    this.v2ABuy = createIdentityMatrix(this.inputDim);
    this.v2BBuy = new Array(this.inputDim).fill(0);
    this.v2ASell = createIdentityMatrix(this.inputDim);
    this.v2BSell = new Array(this.inputDim).fill(0);
  }

  public loadPersistedSnapshot(
    persisted: any,
    memories?: Array<{ signalId?: string; vector: number[]; symbol: ForexSymbol; direction: SignalDirection; y: number; timestamp: string }>
  ) {
    if (persisted && isValidMatrix(persisted.w1, this.hiddenDim, this.inputDim) &&
        isValidVector(persisted.b1, this.hiddenDim) &&
        isValidVector(persisted.w2, this.hiddenDim) &&
        typeof persisted.b2 === 'number' && Number.isFinite(persisted.b2)) {
      this.W1 = persisted.w1.map((row: number[]) => [...row]);
      this.b1 = [...persisted.b1];
      this.W2 = [...persisted.w2];
      this.b2 = persisted.b2;
      this.t = Number.isInteger(persisted.stepCount) && persisted.stepCount >= 0 ? persisted.stepCount : 0;
      this.trailingLosses = Array.isArray(persisted.trailingLosses)
        ? persisted.trailingLosses.filter((v: any) => typeof v === 'number' && Number.isFinite(v)).slice(-50)
        : [];
      this.oosLosses = Array.isArray(persisted.oosLosses)
        ? persisted.oosLosses.filter((v: any) => typeof v === 'number' && Number.isFinite(v)).slice(-100)
        : [];
      this.oosDirectionCorrect = Number.isInteger(persisted.oosDirectionCorrect) ? persisted.oosDirectionCorrect : 0;
      this.oosDirectionTotal = Number.isInteger(persisted.oosDirectionTotal) ? persisted.oosDirectionTotal : 0;
      this.lastGradNorm = typeof persisted.lastGradNorm === 'number' && Number.isFinite(persisted.lastGradNorm)
        ? persisted.lastGradNorm
        : 0;
      this.lastTrainedAt = typeof persisted.lastTrainedAt === 'string' && Number.isFinite(Date.parse(persisted.lastTrainedAt))
        ? persisted.lastTrainedAt
        : null;
      this.duplicateBlocks = Number.isInteger(persisted.duplicateBlocks) ? persisted.duplicateBlocks : 0;
      this.skippedTrainingRecords = Array.isArray(persisted.skippedTrainingRecords)
        ? persisted.skippedTrainingRecords.slice(-500)
        : [];

      if (isValidMatrix(persisted.linUcbA, this.inputDim, this.inputDim) && isValidVector(persisted.linUcbB, this.inputDim)) {
        this.LinUcbA = persisted.linUcbA.map((row: number[]) => [...row]);
        this.LinUcbB = [...persisted.linUcbB];
      }
      if (Array.isArray(persisted.trainedSignalIds)) {
        this.trainedSignalIds = new Set(persisted.trainedSignalIds.filter((id: any) => typeof id === 'string'));
      }

      // Restore Adam moments ONLY when version matches and all moment shapes are finite & valid.
      const hasValidAdamMoments =
        persisted.modelVersion === ONLINE_POLICY_MODEL_VERSION &&
        isValidMatrix(persisted.mW1, this.hiddenDim, this.inputDim) &&
        isValidMatrix(persisted.vW1, this.hiddenDim, this.inputDim, true) &&
        isValidVector(persisted.mb1, this.hiddenDim) &&
        isValidVector(persisted.vb1, this.hiddenDim, true) &&
        isValidVector(persisted.mW2, this.hiddenDim) &&
        isValidVector(persisted.vW2, this.hiddenDim, true) &&
        typeof persisted.mb2 === 'number' && Number.isFinite(persisted.mb2) &&
        typeof persisted.vb2 === 'number' && Number.isFinite(persisted.vb2) && persisted.vb2 >= 0;

      if (hasValidAdamMoments) {
        this.mW1 = persisted.mW1.map((row: number[]) => [...row]);
        this.vW1 = persisted.vW1.map((row: number[]) => [...row]);
        this.mb1 = [...persisted.mb1];
        this.vb1 = [...persisted.vb1];
        this.mW2 = [...persisted.mW2];
        this.vW2 = [...persisted.vW2];
        this.mb2 = persisted.mb2;
        this.vb2 = persisted.vb2;
        this.adamT = Number.isInteger(persisted.adamStepCount) && persisted.adamStepCount >= 0
          ? persisted.adamStepCount
          : this.t;
        this.optimizerRestorationStatus = 'RESTORED_WITH_ADAM_MOMENTS';
      } else {
        // Legacy migration: NEVER run Adam with stale stepCount and zeroed m/v moments!
        this.mW1 = createZeroMatrix(this.hiddenDim, this.inputDim);
        this.vW1 = createZeroMatrix(this.hiddenDim, this.inputDim);
        this.mb1 = new Array(this.hiddenDim).fill(0);
        this.vb1 = new Array(this.hiddenDim).fill(0);
        this.mW2 = new Array(this.hiddenDim).fill(0);
        this.vW2 = new Array(this.hiddenDim).fill(0);
        this.mb2 = 0;
        this.vb2 = 0;
        this.adamT = 0;
        this.optimizerRestorationStatus = 'MIGRATED_LEGACY_RESET_ADAM_STEP';
      }

      // Restore Shadow LinUCB V2 state if compatible
      const v2 = persisted.linUcbV2;
      if (v2 && v2.version === LINUCB_V2_MODEL_VERSION &&
          isValidMatrix(v2.aBuy, this.inputDim, this.inputDim) &&
          isValidVector(v2.bBuy, this.inputDim) &&
          isValidMatrix(v2.aSell, this.inputDim, this.inputDim) &&
          isValidVector(v2.bSell, this.inputDim)) {
        this.v2ABuy = v2.aBuy.map((row: number[]) => [...row]);
        this.v2BBuy = [...v2.bBuy];
        this.v2ASell = v2.aSell.map((row: number[]) => [...row]);
        this.v2BSell = [...v2.bSell];
        this.v2ObservationsBuy = Number.isInteger(v2.observationsBuy) ? v2.observationsBuy : 0;
        this.v2ObservationsSell = Number.isInteger(v2.observationsSell) ? v2.observationsSell : 0;
        this.v2TotalReward = typeof v2.totalReward === 'number' && Number.isFinite(v2.totalReward) ? v2.totalReward : 0;
        this.v2ExplorationTotal = typeof v2.explorationTotal === 'number' && Number.isFinite(v2.explorationTotal) ? v2.explorationTotal : 0;
        this.v2ExploitationTotal = typeof v2.exploitationTotal === 'number' && Number.isFinite(v2.exploitationTotal) ? v2.exploitationTotal : 0;
        this.v2LastTrainedAt = typeof v2.lastTrainedAt === 'string' && Number.isFinite(Date.parse(v2.lastTrainedAt))
          ? v2.lastTrainedAt
          : null;
        if (Array.isArray(v2.trainedSignalIds)) {
          this.v2TrainedSignalIds = new Set(v2.trainedSignalIds.filter((id: any) => typeof id === 'string'));
        }
      }
    }

    if (Array.isArray(memories)) {
      this.episodicMemory = memories.slice(0, 1000);
      for (const mem of this.episodicMemory) {
        if (mem.signalId) this.trainedSignalIds.add(mem.signalId);
      }
    }
  }

  public exportPersistedSnapshot() {
    return {
      modelVersion: ONLINE_POLICY_MODEL_VERSION,
      w1: this.W1.map(row => [...row]),
      b1: [...this.b1],
      w2: [...this.W2],
      b2: this.b2,
      mW1: this.mW1.map(row => [...row]),
      vW1: this.vW1.map(row => [...row]),
      mb1: [...this.mb1],
      vb1: [...this.vb1],
      mW2: [...this.mW2],
      vW2: [...this.vW2],
      mb2: this.mb2,
      vb2: this.vb2,
      stepCount: this.t,
      adamStepCount: this.adamT,
      lastGradNorm: this.lastGradNorm,
      trailingLosses: this.trailingLosses.slice(-50),
      oosLosses: this.oosLosses.slice(-100),
      oosDirectionCorrect: this.oosDirectionCorrect,
      oosDirectionTotal: this.oosDirectionTotal,
      linUcbA: this.LinUcbA.map(row => [...row]),
      linUcbB: [...this.LinUcbB],
      trainedSignalIds: Array.from(this.trainedSignalIds).slice(-5000),
      skippedTrainingRecords: this.skippedTrainingRecords.slice(-500),
      duplicateBlocks: this.duplicateBlocks,
      lastTrainedAt: this.lastTrainedAt,
      lastUpdated: this.lastTrainedAt || '',
      linUcbV2: {
        version: LINUCB_V2_MODEL_VERSION,
        aBuy: this.v2ABuy.map(row => [...row]),
        bBuy: [...this.v2BBuy],
        aSell: this.v2ASell.map(row => [...row]),
        bSell: [...this.v2BSell],
        observationsBuy: this.v2ObservationsBuy,
        observationsSell: this.v2ObservationsSell,
        totalReward: Number(this.v2TotalReward.toFixed(4)),
        explorationTotal: Number(this.v2ExplorationTotal.toFixed(4)),
        exploitationTotal: Number(this.v2ExploitationTotal.toFixed(4)),
        trainedSignalIds: Array.from(this.v2TrainedSignalIds).slice(-5000),
        lastTrainedAt: this.v2LastTrainedAt,
      },
    };
  }

  private loadPersistedState() {
    try {
      const persisted = db.getOnlineModelWeights();
      const memories = db.getEpisodicMemories();
      this.loadPersistedSnapshot(persisted, memories);
    } catch (e) {
      console.warn('[OnlinePolicy] Using fresh initial weights:', e);
    }
  }

  private saveState() {
    if (!this.persistToDb) return;
    try {
      db.saveOnlineModelWeights(this.exportPersistedSnapshot());
      db.saveEpisodicMemories(this.episodicMemory.slice(0, 500));
    } catch (e) {
      console.warn('[OnlinePolicy] Failed to persist weights:', e);
    }
  }

  public hasTrainedOnSignal(signalId: string): boolean {
    return this.trainedSignalIds.has(signalId);
  }

  public hasTrainedLinUcbV2OnSignal(signalId: string): boolean {
    return this.v2TrainedSignalIds.has(signalId);
  }

  public recordSkippedTraining(signalId: string, reason: string, persist: boolean = true): boolean {
    if (this.skippedTrainingRecords.some(r => r.signalId === signalId && r.reason === reason)) return false;
    this.skippedTrainingRecords.push({ signalId, reason, at: new Date().toISOString() });
    if (this.skippedTrainingRecords.length > 500) this.skippedTrainingRecords.shift();
    if (persist) {
      this.saveState();
    }
    return true;
  }

  /**
   * FORWARD PASS (Baseline Live Path — preserved for baseline parity):
   * Computes h = LeakyReLU(W1 * x + b1), p_up = Sigmoid(W2 * h + b2)
   */
  public forward(x: number[]): {
    probabilityUp: number;
    recommendedDirection: SignalDirection;
    conviction: number;
    hiddenActivations: number[];
    linUcbScore: number;
  } {
    if (x.length !== this.inputDim) {
      throw new Error(`Expected input feature vector of dimension ${this.inputDim}, got ${x.length}`);
    }

    const h = new Array(this.hiddenDim).fill(0);
    for (let i = 0; i < this.hiddenDim; i++) {
      let sum = this.b1[i];
      for (let j = 0; j < this.inputDim; j++) {
        sum += this.W1[i][j] * x[j];
      }
      h[i] = sum > 0 ? sum : 0.05 * sum;
    }

    let logit = this.b2;
    for (let i = 0; i < this.hiddenDim; i++) {
      logit += this.W2[i] * h[i];
    }

    const probUp = 1.0 / (1.0 + Math.exp(-Math.max(-15, Math.min(15, logit))));
    const linScore = this.evaluateLinUcb(x);
    const direction: SignalDirection = probUp >= 0.5 ? 'BUY' : 'SELL';
    const rawConviction = direction === 'BUY' ? probUp : 1.0 - probUp;
    const conviction = Number(
      Math.min(0.96, Math.max(0.50, rawConviction * 0.8 + Math.min(0.2, Math.max(0, linScore) * 0.2))).toFixed(3)
    );

    return {
      probabilityUp: Number(probUp.toFixed(4)),
      recommendedDirection: direction,
      conviction,
      hiddenActivations: h,
      linUcbScore: Number(linScore.toFixed(3)),
    };
  }

  /**
   * SHADOW LINUCB V2 FORWARD PASS:
   * Evaluates direction-conditioned ridge regression for BUY vs SELL separately.
   */
  public evaluateLinUcbV2(x: number[], direction: SignalDirection): {
    meanReward: number;
    explorationBonus: number;
    ucbScore: number;
    actionObservations: number;
  } {
    if (x.length !== this.inputDim) {
      return { meanReward: 0, explorationBonus: 0, ucbScore: 0, actionObservations: 0 };
    }
    const A = direction === 'BUY' ? this.v2ABuy : this.v2ASell;
    const b = direction === 'BUY' ? this.v2BBuy : this.v2BSell;
    const obs = direction === 'BUY' ? this.v2ObservationsBuy : this.v2ObservationsSell;

    const invA = this.invertMatrix19(A);
    if (!invA) return { meanReward: 0, explorationBonus: 0, ucbScore: 0, actionObservations: obs };

    const theta = new Array(this.inputDim).fill(0);
    for (let i = 0; i < this.inputDim; i++) {
      for (let j = 0; j < this.inputDim; j++) {
        theta[i] += invA[i][j] * b[j];
      }
    }

    let meanReward = 0;
    for (let i = 0; i < this.inputDim; i++) {
      meanReward += x[i] * theta[i];
    }

    let variance = 0;
    for (let i = 0; i < this.inputDim; i++) {
      let rowSum = 0;
      for (let j = 0; j < this.inputDim; j++) {
        rowSum += invA[i][j] * x[j];
      }
      variance += x[i] * rowSum;
    }

    const explorationBonus = this.v2Alpha * Math.sqrt(Math.max(0, variance));
    const ucbScore = meanReward + explorationBonus;
    return {
      meanReward: Number(Math.max(-1.5, Math.min(1.5, meanReward)).toFixed(4)),
      explorationBonus: Number(explorationBonus.toFixed(4)),
      ucbScore: Number(Math.max(-1.5, Math.min(2.0, ucbScore)).toFixed(4)),
      actionObservations: obs,
    };
  }

  /**
   * SHADOW LINUCB V2 TRAINING STEP:
   * Uses direction-conditioned 19x19 action matrix + actual settled netReturnUnits reward.
   */
  public trainLinUcbV2(
    x: number[],
    tradeDirection: SignalDirection,
    tradeOutcome: 'WIN' | 'LOSS' | 'SCRATCH' | 'CANCELLED',
    netReturnUnits: number,
    signalId?: string,
    observedAt: string = new Date().toISOString(),
    persist: boolean = true
  ): { trained: boolean; reward: number; actionObservations: number; duplicateBlocked?: boolean } {
    if (x.length !== this.inputDim || !x.every(Number.isFinite)) {
      return { trained: false, reward: 0, actionObservations: 0 };
    }
    if (tradeOutcome === 'CANCELLED') {
      return { trained: false, reward: 0, actionObservations: 0 };
    }
    if (signalId && this.v2TrainedSignalIds.has(signalId)) {
      this.duplicateBlocks++;
      return {
        trained: false,
        reward: 0,
        actionObservations: tradeDirection === 'BUY' ? this.v2ObservationsBuy : this.v2ObservationsSell,
        duplicateBlocked: true,
      };
    }

    // Actual netReturnUnits reward (clamped to [-1.5, +1.5] for numerical stability)
    const fallbackReward = tradeOutcome === 'WIN' ? 0.8 : tradeOutcome === 'LOSS' ? -1.0 : 0.0;
    const rawReward = typeof netReturnUnits === 'number' && Number.isFinite(netReturnUnits)
      ? netReturnUnits
      : fallbackReward;
    const reward = Number(Math.max(-1.5, Math.min(1.5, rawReward)).toFixed(4));

    const preEval = this.evaluateLinUcbV2(x, tradeDirection);
    this.v2ExploitationTotal += Math.abs(preEval.meanReward);
    this.v2ExplorationTotal += preEval.explorationBonus;

    const A = tradeDirection === 'BUY' ? this.v2ABuy : this.v2ASell;
    const b = tradeDirection === 'BUY' ? this.v2BBuy : this.v2BSell;
    for (let i = 0; i < this.inputDim; i++) {
      b[i] += reward * x[i];
      for (let j = 0; j < this.inputDim; j++) {
        A[i][j] += x[i] * x[j];
      }
    }

    if (tradeDirection === 'BUY') this.v2ObservationsBuy++;
    else this.v2ObservationsSell++;
    this.v2TotalReward += reward;
    this.v2LastTrainedAt = Number.isFinite(Date.parse(observedAt)) ? observedAt : new Date().toISOString();
    if (signalId) this.v2TrainedSignalIds.add(signalId);

    if (persist) {
      this.saveState();
    }
    return {
      trained: true,
      reward,
      actionObservations: tradeDirection === 'BUY' ? this.v2ObservationsBuy : this.v2ObservationsSell,
    };
  }

  /**
   * BACKWARD PASS (Online Stochastic Gradient Descent with persistent Adam):
   * Evaluates pre-update OOS loss & directional accuracy before updating weights.
   */
  public trainStep(
    x: number[],
    tradeDirection: SignalDirection,
    tradeOutcome: 'WIN' | 'LOSS' | 'SCRATCH' | 'CANCELLED',
    netReturnUnits: number,
    symbol: ForexSymbol,
    signalId?: string,
    observedAt: string = new Date().toISOString(),
    persist: boolean = true
  ): {
    loss: number;
    gradientNorm: number;
    step: number;
    duplicateBlocked?: boolean;
    linUcbV2Trained: boolean;
    linUcbV2DuplicateBlocked?: boolean;
  } {
    if (tradeOutcome === 'CANCELLED' || tradeOutcome === 'SCRATCH') {
      return { loss: 0, gradientNorm: 0, step: this.t, linUcbV2Trained: false };
    }
    if (!Array.isArray(x) || x.length !== this.inputDim || !x.every(Number.isFinite)) {
      return {
        loss: Number((this.trailingLosses[this.trailingLosses.length - 1] || 0).toFixed(4)),
        gradientNorm: Number(this.lastGradNorm.toFixed(4)),
        step: this.t,
        linUcbV2Trained: false,
      };
    }
    if (signalId && this.trainedSignalIds.has(signalId)) {
      this.duplicateBlocks++;
      return {
        loss: Number((this.trailingLosses[this.trailingLosses.length - 1] || 0).toFixed(4)),
        gradientNorm: Number(this.lastGradNorm.toFixed(4)),
        step: this.t,
        duplicateBlocked: true,
        linUcbV2Trained: false,
        linUcbV2DuplicateBlocked: this.v2TrainedSignalIds.has(signalId),
      };
    }

    // Target y = 1.0 for upward price displacement, 0.0 for downward price displacement
    const targetY =
      (tradeDirection === 'BUY' && tradeOutcome === 'WIN') ||
      (tradeDirection === 'SELL' && tradeOutcome === 'LOSS')
        ? 1.0
        : 0.0;

    // 1. Pre-update forward pass (measures true out-of-sample directional performance)
    const z1 = new Array(this.hiddenDim).fill(0);
    const h = new Array(this.hiddenDim).fill(0);
    for (let i = 0; i < this.hiddenDim; i++) {
      let sum = this.b1[i];
      for (let j = 0; j < this.inputDim; j++) {
        sum += this.W1[i][j] * x[j];
      }
      z1[i] = sum;
      h[i] = sum > 0 ? sum : 0.05 * sum;
    }

    let logit = this.b2;
    for (let i = 0; i < this.hiddenDim; i++) {
      logit += this.W2[i] * h[i];
    }
    const p = 1.0 / (1.0 + Math.exp(-Math.max(-15, Math.min(15, logit))));

    const clipP = Math.max(1e-7, Math.min(1 - 1e-7, p));
    const loss = -(targetY * Math.log(clipP) + (1.0 - targetY) * Math.log(1.0 - clipP));
    this.trailingLosses.push(loss);
    if (this.trailingLosses.length > 50) this.trailingLosses.shift();

    this.oosLosses.push(loss);
    if (this.oosLosses.length > 100) this.oosLosses.shift();
    const predictedUp = p >= 0.5 ? 1.0 : 0.0;
    if (predictedUp === targetY) this.oosDirectionCorrect++;
    this.oosDirectionTotal++;

    // 2. Gradients
    const dLogit = p - targetY;
    const gradW2 = new Array(this.hiddenDim);
    let gradNormSq = dLogit * dLogit;
    for (let i = 0; i < this.hiddenDim; i++) {
      gradW2[i] = dLogit * h[i];
      gradNormSq += gradW2[i] * gradW2[i];
    }
    const gradB2 = dLogit;

    const dH = new Array(this.hiddenDim);
    const dZ1 = new Array(this.hiddenDim);
    const gradW1: number[][] = [];
    const gradB1 = new Array(this.hiddenDim);

    for (let i = 0; i < this.hiddenDim; i++) {
      dH[i] = dLogit * this.W2[i];
      dZ1[i] = dH[i] * (z1[i] > 0 ? 1.0 : 0.05);
      gradB1[i] = dZ1[i];
      gradNormSq += gradB1[i] * gradB1[i];

      gradW1[i] = new Array(this.inputDim);
      for (let j = 0; j < this.inputDim; j++) {
        gradW1[i][j] = dZ1[i] * x[j];
        gradNormSq += gradW1[i][j] * gradW1[i][j];
      }
    }

    const gradNorm = Math.sqrt(gradNormSq);
    this.lastGradNorm = gradNorm;
    this.t += 1;
    this.adamT += 1;

    // 3. Adam Optimizer updates using synchronized adamT
    const beta1 = this.beta1;
    const beta2 = this.beta2;
    const lr = this.lr;
    const eps = this.eps;
    const biasCorrection1 = 1.0 - Math.pow(beta1, this.adamT);
    const biasCorrection2 = 1.0 - Math.pow(beta2, this.adamT);

    for (let i = 0; i < this.hiddenDim; i++) {
      this.mW2[i] = beta1 * this.mW2[i] + (1 - beta1) * gradW2[i];
      this.vW2[i] = beta2 * this.vW2[i] + (1 - beta2) * (gradW2[i] * gradW2[i]);
      const mHat = this.mW2[i] / biasCorrection1;
      const vHat = this.vW2[i] / biasCorrection2;
      this.W2[i] -= (lr / (Math.sqrt(vHat) + eps)) * mHat;
    }
    this.mb2 = beta1 * this.mb2 + (1 - beta1) * gradB2;
    this.vb2 = beta2 * this.vb2 + (1 - beta2) * (gradB2 * gradB2);
    this.b2 -= (lr / (Math.sqrt(this.vb2 / biasCorrection2) + eps)) * (this.mb2 / biasCorrection1);

    for (let i = 0; i < this.hiddenDim; i++) {
      this.mb1[i] = beta1 * this.mb1[i] + (1 - beta1) * gradB1[i];
      this.vb1[i] = beta2 * this.vb1[i] + (1 - beta2) * (gradB1[i] * gradB1[i]);
      this.b1[i] -= (lr / (Math.sqrt(this.vb1[i] / biasCorrection2) + eps)) * (this.mb1[i] / biasCorrection1);

      for (let j = 0; j < this.inputDim; j++) {
        this.mW1[i][j] = beta1 * this.mW1[i][j] + (1 - beta1) * gradW1[i][j];
        this.vW1[i][j] = beta2 * this.vW1[i][j] + (1 - beta2) * (gradW1[i][j] * gradW1[i][j]);
        const mHat = this.mW1[i][j] / biasCorrection1;
        const vHat = this.vW1[i][j] / biasCorrection2;
        this.W1[i][j] -= (lr / (Math.sqrt(vHat) + eps)) * mHat;
      }
    }

    // 4. Legacy LinUCB update (retained for baseline parity)
    const legacyReward = tradeOutcome === 'WIN' ? 0.80 : -1.00;
    for (let i = 0; i < this.inputDim; i++) {
      this.LinUcbB[i] += legacyReward * x[i];
      for (let j = 0; j < this.inputDim; j++) {
        this.LinUcbA[i][j] += x[i] * x[j];
      }
    }

    // 5. Shadow LinUCB V2 update with actual netReturnUnits & direction isolation (batched save below)
    const v2Res = this.trainLinUcbV2(x, tradeDirection, tradeOutcome, netReturnUnits, signalId, observedAt, false);

    // 6. Episodic Memory Bank
    if (signalId) {
      this.trainedSignalIds.add(signalId);
    }
    this.lastTrainedAt = Number.isFinite(Date.parse(observedAt)) ? observedAt : new Date().toISOString();
    this.episodicMemory.unshift({
      signalId,
      vector: x,
      symbol,
      direction: tradeDirection,
      y: tradeOutcome === 'WIN' ? 1 : 0,
      timestamp: this.lastTrainedAt,
    });
    if (this.episodicMemory.length > 1000) {
      this.episodicMemory.pop();
    }

    if (persist) {
      this.saveState();
    }

    return {
      loss: Number(loss.toFixed(4)),
      gradientNorm: Number(gradNorm.toFixed(4)),
      step: this.t,
      linUcbV2Trained: v2Res.trained,
      linUcbV2DuplicateBlocked: v2Res.duplicateBlocked,
    };
  }

  /**
   * Catches up the online MLP, LinUCB V2, and Episodic k-NN bank on settled WIN/LOSS signals
   * STRICTLY using their immutable prediction-time `signal.marketFeatureVector`.
   * Signals lacking frozen prediction-time features are never reconstructed from post-entry candles;
   * they are explicitly recorded as skipped with reason `MISSING_FROZEN_PREDICTION_FEATURES`.
   */
  public bootstrapFromSettledSignals(
    _getRealCandlesForSymbol?: (symbol: ForexSymbol) => Candle[],
    _extractFeatureVector?: (candle: Candle, history: Candle[]) => number[]
  ): {
    trainedCount: number;
    skippedMissingFeatures: number;
    skippedNoCandles: number;
    stepCount: number;
  } {
    const settled = db
      .getSignals(false)
      .filter(
        s =>
          s.lifecycleState === 'CLOSED' &&
          (s.outcomeResult === 'WIN' || s.outcomeResult === 'LOSS') &&
          !s.ruleFamily?.startsWith('test_')
      )
      .sort((a, b) => {
        const ta = Date.parse(a.actualExitTimeUtc || a.actualEntryTimeUtc || a.predictionTimeUtc);
        const tb = Date.parse(b.actualExitTimeUtc || b.actualEntryTimeUtc || b.predictionTimeUtc);
        return ta - tb;
      });

    let trainedCount = 0;
    let skippedMissingFeatures = 0;
    let dirty = false;

    for (const signal of settled) {
      if (this.trainedSignalIds.has(signal.id)) continue;

      if (!hasTrustedPredictionFeatures(signal)) {
        skippedMissingFeatures++;
        if (this.recordSkippedTraining(signal.id, 'MISSING_FROZEN_PREDICTION_FEATURES', false)) {
          dirty = true;
        }
        continue;
      }

      const observedAt = signal.actualExitTimeUtc || signal.plannedExitTimeUtc || new Date().toISOString();
      const stepRes = this.trainStep(
        signal.marketFeatureVector!,
        signal.direction,
        signal.outcomeResult as 'WIN' | 'LOSS',
        signal.netReturnUnits ?? (signal.outcomeResult === 'WIN' ? 0.8 : -1.0),
        signal.symbol,
        signal.id,
        observedAt,
        false
      );
      if (!stepRes.duplicateBlocked) {
        trainedCount++;
        dirty = true;
      }
    }

    if (dirty) {
      this.saveState();
    }

    return {
      trainedCount,
      skippedMissingFeatures,
      skippedNoCandles: skippedMissingFeatures, // legacy alias
      stepCount: this.t,
    };
  }

  private evaluateLinUcb(x: number[]): number {
    const invA = this.invertMatrix19(this.LinUcbA);
    if (!invA) return 0;

    const theta = new Array(this.inputDim).fill(0);
    for (let i = 0; i < this.inputDim; i++) {
      for (let j = 0; j < this.inputDim; j++) {
        theta[i] += invA[i][j] * this.LinUcbB[j];
      }
    }

    let mean = 0;
    for (let i = 0; i < this.inputDim; i++) {
      mean += x[i] * theta[i];
    }

    let variance = 0;
    for (let i = 0; i < this.inputDim; i++) {
      let rowSum = 0;
      for (let j = 0; j < this.inputDim; j++) {
        rowSum += invA[i][j] * x[j];
      }
      variance += x[i] * rowSum;
    }

    return mean + this.linUcbAlpha * Math.sqrt(Math.max(0, variance));
  }

  private invertMatrix19(matrix: number[][]): number[][] | null {
    const n = matrix.length;
    const aug: number[][] = [];
    for (let i = 0; i < n; i++) {
      aug[i] = new Array(2 * n).fill(0);
      for (let j = 0; j < n; j++) {
        aug[i][j] = matrix[i][j];
      }
      aug[i][n + i] = 1.0;
    }

    for (let i = 0; i < n; i++) {
      let maxRow = i;
      let maxVal = Math.abs(aug[i][i]);
      for (let r = i + 1; r < n; r++) {
        if (Math.abs(aug[r][i]) > maxVal) {
          maxVal = Math.abs(aug[r][i]);
          maxRow = r;
        }
      }
      if (maxVal < 1e-12) return null;
      if (maxRow !== i) {
        const temp = aug[i];
        aug[i] = aug[maxRow];
        aug[maxRow] = temp;
      }
      const pivot = aug[i][i];
      for (let j = 0; j < 2 * n; j++) {
        aug[i][j] /= pivot;
      }
      for (let r = 0; r < n; r++) {
        if (r !== i) {
          const factor = aug[r][i];
          for (let j = 0; j < 2 * n; j++) {
            aug[r][j] -= factor * aug[i][j];
          }
        }
      }
    }

    const inv: number[][] = [];
    for (let i = 0; i < n; i++) {
      inv[i] = aug[i].slice(n);
    }
    return inv;
  }

  public queryEpisodicKNN(
    x: number[],
    symbol: ForexSymbol,
    direction: SignalDirection,
    k: number = 7
  ): {
    shouldVeto: boolean;
    localWinRate: number;
    neighbors: number;
    explanation: string;
  } {
    const pool = this.episodicMemory.filter(
      m => m.symbol === symbol && m.direction === direction
    );

    if (pool.length < 5) {
      return {
        shouldVeto: false,
        localWinRate: 0.5,
        neighbors: pool.length,
        explanation: 'Insufficient local episodes for k-NN gate.',
      };
    }

    const scored = pool.map(item => {
      let sumSq = 0;
      for (let i = 0; i < this.inputDim; i++) {
        const diff = (x[i] || 0) - (item.vector[i] || 0);
        sumSq += diff * diff;
      }
      return { item, dist: Math.sqrt(sumSq) };
    });

    scored.sort((a, b) => a.dist - b.dist);
    const topK = scored.slice(0, Math.min(k, scored.length));
    const wins = topK.filter(n => n.item.y === 1).length;
    const localWinRate = Number((wins / topK.length).toFixed(3));

    if (topK.length >= 5 && localWinRate < 0.40) {
      return {
        shouldVeto: true,
        localWinRate,
        neighbors: topK.length,
        explanation: `Online k-NN Veto: Top-${topK.length} nearest historical trade vectors show only ${(localWinRate * 100).toFixed(1)}% win rate on ${symbol} ${direction}. Sub-manifold flagged as negative expectancy.`,
      };
    }

    return {
      shouldVeto: false,
      localWinRate,
      neighbors: topK.length,
      explanation: `Cleared k-NN verification: ${(localWinRate * 100).toFixed(1)}% empirical win rate across nearest ${topK.length} vectors.`,
    };
  }

  public getTelemetry(): ModelTelemetry {
    const avgLoss = this.trailingLosses.length > 0
      ? this.trailingLosses.reduce((a, b) => a + b, 0) / this.trailingLosses.length
      : 0.693;
    const validationLossOos = this.oosLosses.length > 0
      ? Number((this.oosLosses.reduce((a, b) => a + b, 0) / this.oosLosses.length).toFixed(4))
      : null;
    const oosDirectionalAccuracy = this.oosDirectionTotal > 0
      ? Number(((this.oosDirectionCorrect / this.oosDirectionTotal) * 100).toFixed(2))
      : null;

    let weightNormSq = this.b2 * this.b2;
    for (let i = 0; i < this.hiddenDim; i++) {
      weightNormSq += this.b1[i] * this.b1[i] + this.W2[i] * this.W2[i];
      for (let j = 0; j < this.inputDim; j++) {
        weightNormSq += this.W1[i][j] * this.W1[i][j];
      }
    }

    const v2Total = this.v2ObservationsBuy + this.v2ObservationsSell;

    return {
      modelVersion: ONLINE_POLICY_MODEL_VERSION,
      stepCount: this.t,
      adamStepCount: this.adamT,
      optimizerRestorationStatus: this.optimizerRestorationStatus,
      lastLoss: Number((this.trailingLosses[this.trailingLosses.length - 1] || 0.693).toFixed(4)),
      averageLoss20: Number(avgLoss.toFixed(4)),
      validationLossOos,
      oosDirectionalAccuracy,
      oosEvaluatedCount: this.oosDirectionTotal,
      gradientNorm: Number(this.lastGradNorm.toFixed(4)),
      learningRate: this.lr,
      activeWeightsNorm: Number(Math.sqrt(weightNormSq).toFixed(3)),
      linUcbConfidenceRadius: this.linUcbAlpha,
      storedMemoryEpisodes: this.episodicMemory.length,
      trainedSignalCount: this.trainedSignalIds.size,
      skippedMissingFeaturesCount: this.skippedTrainingRecords.length,
      duplicateAttemptsBlocked: this.duplicateBlocks,
      lastTrainedAt: this.lastTrainedAt,
      lastUpdated: this.lastTrainedAt,
      linUcbV2: {
        version: LINUCB_V2_MODEL_VERSION,
        mode: 'SHADOW_ONLY',
        observationsBuy: this.v2ObservationsBuy,
        observationsSell: this.v2ObservationsSell,
        totalObservations: v2Total,
        meanReward: v2Total > 0 ? Number((this.v2TotalReward / v2Total).toFixed(4)) : null,
        meanExplorationBonus: v2Total > 0 ? Number((this.v2ExplorationTotal / v2Total).toFixed(4)) : null,
        meanExploitationScore: v2Total > 0 ? Number((this.v2ExploitationTotal / v2Total).toFixed(4)) : null,
        lastTrainedAt: this.v2LastTrainedAt,
      },
    };
  }

  public getSkippedTrainingRecords() {
    return [...this.skippedTrainingRecords];
  }

  public getWeightsSnapshot(): {
    W1_sample: number[][];
    b1_sample: number[];
    W2: number[];
    b2: number;
  } {
    return {
      W1_sample: this.W1.slice(0, 4).map(row => row.slice(0, 6).map(v => Number(v.toFixed(4)))),
      b1_sample: this.b1.slice(0, 4).map(v => Number(v.toFixed(4))),
      W2: this.W2.map(v => Number(v.toFixed(4))),
      b2: Number(this.b2.toFixed(4)),
    };
  }
}

export const onlinePolicyNetwork = new OnlinePolicyNetwork();
