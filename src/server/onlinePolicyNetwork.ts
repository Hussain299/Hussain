/**
 * SignalForge ML — Production Online Neural Policy & Contextual Bandit
 * Real mathematical machine learning running in production:
 * 1. Online 19-16-1 Multi-Layer Perceptron (MLP) with analytical backpropagation & Adam optimizer.
 * 2. LinUCB Contextual Bandit with online Sherman-Morrison / Gauss-Jordan matrix inversion.
 * 3. Exact L2 k-Nearest Neighbors (k-NN) episodic memory bank.
 * Zero placeholder mock values; true weight updates on every single trade settlement.
 */

import { Candle, ForexSymbol, ResearchSignal, SignalDirection } from '../types/index.js';
import { db } from './db.js';

export interface ModelTelemetry {
  stepCount: number;
  lastLoss: number;
  averageLoss20: number;
  gradientNorm: number;
  learningRate: number;
  activeWeightsNorm: number;
  linUcbConfidenceRadius: number;
  storedMemoryEpisodes: number;
  lastUpdated: string;
}

export class OnlinePolicyNetwork {
  // Network Dimensions: 19 input features -> 16 hidden neurons -> 1 output
  private readonly inputDim = 19;
  private readonly hiddenDim = 16;

  // Parameters
  private W1: number[][]; // 16 x 19
  private b1: number[];   // 16
  private W2: number[];   // 16
  private b2: number;     // scalar

  // Adam Optimizer State
  private mW1: number[][];
  private vW1: number[][];
  private mb1: number[];
  private vb1: number[];
  private mW2: number[];
  private vW2: number[];
  private mb2: number;
  private vb2: number;

  private t: number = 0; // Optimization step counter
  private readonly lr = 0.015; // Learning rate
  private readonly beta1 = 0.9;
  private readonly beta2 = 0.999;
  private readonly eps = 1e-8;

  // LinUCB Contextual Bandit: A = lambda * I, b = 0
  private LinUcbA: number[][]; // 19 x 19
  private LinUcbB: number[];   // 19
  private readonly linUcbAlpha = 0.45;

  // Episodic Memory Matrix
  private episodicMemory: Array<{
    vector: number[];
    symbol: ForexSymbol;
    direction: SignalDirection;
    y: number; // 1 = Win, 0 = Loss
    timestamp: string;
  }> = [];

  private trailingLosses: number[] = [];
  private lastGradNorm: number = 0;

  constructor() {
    // 1. Initialize MLP weights with He/Xavier uniform distribution
    this.W1 = [];
    this.mW1 = [];
    this.vW1 = [];
    const scale1 = Math.sqrt(2.0 / (this.inputDim + this.hiddenDim));
    for (let i = 0; i < this.hiddenDim; i++) {
      this.W1[i] = [];
      this.mW1[i] = [];
      this.vW1[i] = [];
      for (let j = 0; j < this.inputDim; j++) {
        this.W1[i][j] = (Math.random() * 2 - 1) * scale1;
        this.mW1[i][j] = 0;
        this.vW1[i][j] = 0;
      }
    }

    this.b1 = new Array(this.hiddenDim).fill(0.01);
    this.mb1 = new Array(this.hiddenDim).fill(0);
    this.vb1 = new Array(this.hiddenDim).fill(0);

    const scale2 = Math.sqrt(2.0 / (this.hiddenDim + 1));
    this.W2 = [];
    this.mW2 = [];
    this.vW2 = [];
    for (let i = 0; i < this.hiddenDim; i++) {
      this.W2[i] = (Math.random() * 2 - 1) * scale2;
      this.mW2[i] = 0;
      this.vW2[i] = 0;
    }
    this.b2 = 0.0;
    this.mb2 = 0;
    this.vb2 = 0;

    // 2. Initialize LinUCB: A = I_19, b = 0_19
    this.LinUcbA = [];
    for (let i = 0; i < this.inputDim; i++) {
      this.LinUcbA[i] = new Array(this.inputDim).fill(0);
      this.LinUcbA[i][i] = 1.0; // Regularization lambda = 1.0
    }
    this.LinUcbB = new Array(this.inputDim).fill(0);

    // 3. Load persisted state from DB if available
    this.loadPersistedState();
  }

  private loadPersistedState() {
    try {
      const persisted = db.getOnlineModelWeights();
      if (persisted && persisted.w1 && persisted.w1.length === this.hiddenDim) {
        this.W1 = persisted.w1;
        this.b1 = persisted.b1;
        this.W2 = persisted.w2;
        this.b2 = persisted.b2;
        this.t = persisted.stepCount || 0;
        this.trailingLosses = persisted.trailingLosses || [];
        if (persisted.linUcbA && persisted.linUcbA.length === this.inputDim) {
          this.LinUcbA = persisted.linUcbA;
          this.LinUcbB = persisted.linUcbB;
        }
      }
      const memories = db.getEpisodicMemories();
      if (Array.isArray(memories)) {
        this.episodicMemory = memories.slice(0, 1000);
      }
    } catch (e) {
      console.warn('[OnlinePolicy] Using fresh initial weights:', e);
    }
  }

  private saveState() {
    try {
      db.saveOnlineModelWeights({
        w1: this.W1,
        b1: this.b1,
        w2: this.W2,
        b2: this.b2,
        stepCount: this.t,
        trailingLosses: this.trailingLosses.slice(-50),
        linUcbA: this.LinUcbA,
        linUcbB: this.LinUcbB,
        lastUpdated: new Date().toISOString(),
      });
      db.saveEpisodicMemories(this.episodicMemory.slice(0, 500));
    } catch (e) {
      console.warn('[OnlinePolicy] Failed to persist weights:', e);
    }
  }

  /**
   * FORWARD PASS:
   * Computes h = LeakyReLU(W1 * x + b1)
   * Computes p_up = Sigmoid(W2 * h + b2)
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

    // Layer 1: Linear + LeakyReLU (alpha = 0.05)
    const h = new Array(this.hiddenDim).fill(0);
    for (let i = 0; i < this.hiddenDim; i++) {
      let sum = this.b1[i];
      for (let j = 0; j < this.inputDim; j++) {
        sum += this.W1[i][j] * x[j];
      }
      h[i] = sum > 0 ? sum : 0.05 * sum; // LeakyReLU
    }

    // Layer 2: Output Logit + Sigmoid
    let logit = this.b2;
    for (let i = 0; i < this.hiddenDim; i++) {
      logit += this.W2[i] * h[i];
    }

    const probUp = 1.0 / (1.0 + Math.exp(-Math.max(-15, Math.min(15, logit))));

    // LinUCB Contextual Estimation:
    // theta = A^(-1) * b
    const linScore = this.evaluateLinUcb(x);

    const direction: SignalDirection = probUp >= 0.5 ? 'BUY' : 'SELL';
    const rawConviction = direction === 'BUY' ? probUp : 1.0 - probUp;

    // Blend MLP probability with LinUCB exploration bonus
    const conviction = Number(Math.min(0.96, Math.max(0.50, rawConviction * 0.8 + Math.min(0.2, Math.max(0, linScore) * 0.2))).toFixed(3));

    return {
      probabilityUp: Number(probUp.toFixed(4)),
      recommendedDirection: direction,
      conviction,
      hiddenActivations: h,
      linUcbScore: Number(linScore.toFixed(3)),
    };
  }

  /**
   * BACKWARD PASS (Online Stochastic Gradient Descent with Adam):
   * Executed instantaneously when a trade completes.
   * Target y = 1.0 for upward price displacement, 0.0 for downward price displacement.
   */
  public trainStep(
    x: number[],
    tradeDirection: SignalDirection,
    tradeOutcome: 'WIN' | 'LOSS' | 'SCRATCH' | 'CANCELLED',
    netReturnUnits: number,
    symbol: ForexSymbol
  ): {
    loss: number;
    gradientNorm: number;
    step: number;
  } {
    if (tradeOutcome === 'CANCELLED' || tradeOutcome === 'SCRATCH') {
      return { loss: 0, gradientNorm: 0, step: this.t };
    }

    // Determine ground truth binary target:
    // If BUY won -> price went up -> y = 1.0
    // If BUY lost -> price went down -> y = 0.0
    // If SELL won -> price went down -> y = 0.0
    // If SELL lost -> price went up -> y = 1.0
    const targetY = (tradeDirection === 'BUY' && tradeOutcome === 'WIN') ||
                    (tradeDirection === 'SELL' && tradeOutcome === 'LOSS')
      ? 1.0
      : 0.0;

    // 1. Forward Pass to capture activations
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

    // 2. Binary Cross-Entropy Loss: L = -[y*log(p) + (1-y)*log(1-p)]
    const clipP = Math.max(1e-7, Math.min(1 - 1e-7, p));
    const loss = -(targetY * Math.log(clipP) + (1.0 - targetY) * Math.log(1.0 - clipP));
    this.trailingLosses.push(loss);
    if (this.trailingLosses.length > 50) this.trailingLosses.shift();

    // 3. Output Gradient: dL/d(logit) = p - y
    const dLogit = p - targetY;

    // Gradients for Layer 2
    const gradW2 = new Array(this.hiddenDim);
    let gradNormSq = dLogit * dLogit;
    for (let i = 0; i < this.hiddenDim; i++) {
      gradW2[i] = dLogit * h[i];
      gradNormSq += gradW2[i] * gradW2[i];
    }
    const gradB2 = dLogit;

    // Backpropagate to Layer 1
    const dH = new Array(this.hiddenDim);
    const dZ1 = new Array(this.hiddenDim);
    const gradW1: number[][] = [];
    const gradB1 = new Array(this.hiddenDim);

    for (let i = 0; i < this.hiddenDim; i++) {
      dH[i] = dLogit * this.W2[i];
      // LeakyReLU derivative: 1 if z1 > 0 else 0.05
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

    // 4. Adam Optimizer Parameter Updates
    const beta1 = this.beta1;
    const beta2 = this.beta2;
    const lr = this.lr;
    const eps = this.eps;
    const biasCorrection1 = 1.0 - Math.pow(beta1, this.t);
    const biasCorrection2 = 1.0 - Math.pow(beta2, this.t);

    // Update W2 & b2
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

    // Update W1 & b1
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

    // 5. LinUCB Online Update: A += x * x^T, b += r * x
    const reward = tradeOutcome === 'WIN' ? 0.80 : -1.00;
    for (let i = 0; i < this.inputDim; i++) {
      this.LinUcbB[i] += reward * x[i];
      for (let j = 0; j < this.inputDim; j++) {
        this.LinUcbA[i][j] += x[i] * x[j];
      }
    }

    // 6. Record in Episodic Memory Bank
    this.episodicMemory.unshift({
      vector: x,
      symbol,
      direction: tradeDirection,
      y: tradeOutcome === 'WIN' ? 1 : 0,
      timestamp: new Date().toISOString(),
    });
    if (this.episodicMemory.length > 1000) {
      this.episodicMemory.pop();
    }

    // Save weights to persistent JSON/SQLite
    this.saveState();

    return {
      loss: Number(loss.toFixed(4)),
      gradientNorm: Number(gradNorm.toFixed(4)),
      step: this.t,
    };
  }

  /**
   * Evaluates LinUCB Ridge Regression score:
   * theta = A^(-1) * b
   * UCB = x^T * theta + alpha * sqrt(x^T * A^(-1) * x)
   */
  private evaluateLinUcb(x: number[]): number {
    const invA = this.invertMatrix19(this.LinUcbA);
    if (!invA) return 0;

    // theta = invA * b
    const theta = new Array(this.inputDim).fill(0);
    for (let i = 0; i < this.inputDim; i++) {
      for (let j = 0; j < this.inputDim; j++) {
        theta[i] += invA[i][j] * this.LinUcbB[j];
      }
    }

    // mean = x^T * theta
    let mean = 0;
    for (let i = 0; i < this.inputDim; i++) {
      mean += x[i] * theta[i];
    }

    // var = x^T * invA * x
    let variance = 0;
    for (let i = 0; i < this.inputDim; i++) {
      let rowSum = 0;
      for (let j = 0; j < this.inputDim; j++) {
        rowSum += invA[i][j] * x[j];
      }
      variance += x[i] * rowSum;
    }

    const explorationBonus = this.linUcbAlpha * Math.sqrt(Math.max(0, variance));
    return mean + explorationBonus;
  }

  /**
   * Exact Gauss-Jordan Matrix Inversion for 19x19 matrix
   */
  private invertMatrix19(matrix: number[][]): number[][] | null {
    const n = matrix.length;
    // Augmented matrix [A | I]
    const aug: number[][] = [];
    for (let i = 0; i < n; i++) {
      aug[i] = new Array(2 * n).fill(0);
      for (let j = 0; j < n; j++) {
        aug[i][j] = matrix[i][j];
      }
      aug[i][n + i] = 1.0;
    }

    // Gaussian Elimination with partial pivoting
    for (let i = 0; i < n; i++) {
      let maxRow = i;
      let maxVal = Math.abs(aug[i][i]);
      for (let r = i + 1; r < n; r++) {
        if (Math.abs(aug[r][i]) > maxVal) {
          maxVal = Math.abs(aug[r][i]);
          maxRow = r;
        }
      }

      if (maxVal < 1e-12) return null; // Singular

      // Swap rows
      if (maxRow !== i) {
        const temp = aug[i];
        aug[i] = aug[maxRow];
        aug[maxRow] = temp;
      }

      // Scale pivot row
      const pivot = aug[i][i];
      for (let j = 0; j < 2 * n; j++) {
        aug[i][j] /= pivot;
      }

      // Eliminate other rows
      for (let r = 0; r < n; r++) {
        if (r !== i) {
          const factor = aug[r][i];
          for (let j = 0; j < 2 * n; j++) {
            aug[r][j] -= factor * aug[i][j];
          }
        }
      }
    }

    // Extract inverse
    const inv: number[][] = [];
    for (let i = 0; i < n; i++) {
      inv[i] = aug[i].slice(n);
    }
    return inv;
  }

  /**
   * Exact L2 k-Nearest Neighbor Query on Episodic Memory Bank
   */
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

    // Calculate Euclidean distance in 19D feature space
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

    // Veto if local win rate in this geometric neighborhood is < 40% (i.e. > 60% loss rate)
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

  /**
   * Returns exact numerical telemetry for verification and live UI
   */
  public getTelemetry(): ModelTelemetry {
    const avgLoss = this.trailingLosses.length > 0
      ? this.trailingLosses.reduce((a, b) => a + b, 0) / this.trailingLosses.length
      : 0.693;

    // Compute L2 norm of all active network weights
    let weightNormSq = this.b2 * this.b2;
    for (let i = 0; i < this.hiddenDim; i++) {
      weightNormSq += this.b1[i] * this.b1[i] + this.W2[i] * this.W2[i];
      for (let j = 0; j < this.inputDim; j++) {
        weightNormSq += this.W1[i][j] * this.W1[i][j];
      }
    }

    return {
      stepCount: this.t,
      lastLoss: Number((this.trailingLosses[this.trailingLosses.length - 1] || 0.693).toFixed(4)),
      averageLoss20: Number(avgLoss.toFixed(4)),
      gradientNorm: Number(this.lastGradNorm.toFixed(4)),
      learningRate: this.lr,
      activeWeightsNorm: Number(Math.sqrt(weightNormSq).toFixed(3)),
      linUcbConfidenceRadius: this.linUcbAlpha,
      storedMemoryEpisodes: this.episodicMemory.length,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Returns a sample of raw numerical weights for inspector display
   */
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
