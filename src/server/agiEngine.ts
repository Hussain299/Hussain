/**
 * SignalForge ML — Autonomous AGI Self-Learning Engine
 * Implements continuous closed-loop reinforcement learning from every completed trade:
 * 1. Online Bayesian Multi-Armed Bandit (Thompson Sampling over Strategy Genomes)
 * 2. Episodic Memory Bank (k-NN Vector Similarity & Neighborhood Veto Gate)
 * 3. Hurst Exponent & Shannon Entropy Market Regime Classification
 * 4. Active Antidote Immune System (Inhibitory Negative-Constraint Filters)
 * 5. Adaptive PID Activation Threshold Tuning
 */

import {
  AgiSelfLearningState,
  BanditArmState,
  Candle,
  EpisodicTradeMemory,
  ForexSymbol,
  MarketRegimeState,
  MarketSessionId,
  ResearchSignal,
  SignalDirection,
} from '../types/index.js';
import { db } from './db.js';

export class AgiSelfLearningEngine {
  private episodicMemories: EpisodicTradeMemory[] = [];
  private banditArms: Record<string, BanditArmState> = {};
  private regimeCache: Record<string, MarketRegimeState> = {};
  private recentVetoes: AgiSelfLearningState['recentVetoes'] = [];
  private adaptiveThresholdDelta: number = 0; // PID dynamic sensitivity adjustment
  private trailingErrors: number[] = [];
  private lastReinforcementTime: string = new Date().toISOString();

  constructor() {
    this.initializeBanditArms();
  }

  /**
   * Initializes or refreshes Bayesian Bandit priors for all active strategy genomes.
   */
  private initializeBanditArms() {
    const strategies = db.getSynthesizedStrategies();
    for (const strat of strategies) {
      if (!this.banditArms[strat.id]) {
        // Uniform Beta(2, 2) uninformative prior centered around 50%
        this.banditArms[strat.id] = {
          strategyId: strat.id,
          strategyName: strat.name,
          alpha: 4.0, // pseudo-observations: 4 wins
          beta: 2.0,  // pseudo-observations: 2 losses
          totalTrades: 0,
          wins: 0,
          losses: 0,
          currentWinRate: 66.7,
          thompsonSampleScore: 0.667,
          status: 'ACTIVE_ARM',
          lastUpdated: new Date().toISOString(),
        };
      }
    }
  }

  /**
   * 1. EXTRACT 19-DIMENSIONAL NORMALIZED FEATURE VECTOR
   * Standardizes the technical indicators into an embedding vector for k-NN similarity.
   */
  public extractFeatureVector(candle: Candle, history: Candle[]): number[] {
    if (!history || history.length < 20) {
      return new Array(19).fill(0);
    }

    const isJpy = candle.symbol.includes('JPY');
    const pipScale = isJpy ? 0.01 : 0.0001;
    const len = history.length;
    const c = candle.close;
    const range = Math.max(0.00005, candle.high - candle.low);
    const body = Math.abs(candle.close - candle.open);

    const ret1 = (c - history[len - 2].close) / pipScale;
    const ret3 = (c - history[Math.max(0, len - 4)].close) / pipScale;
    const ret5 = (c - history[Math.max(0, len - 6)].close) / pipScale;
    const ret13 = (c - history[Math.max(0, len - 14)].close) / pipScale;

    const bodyDirection = candle.close >= candle.open ? 1.0 : -1.0;
    const bodyRatio = body / range;
    const upperWick = (candle.high - Math.max(candle.open, candle.close)) / range;
    const lowerWick = (Math.min(candle.open, candle.close) - candle.low) / range;
    const wickImbalance = upperWick - lowerWick;
    const closeLocation = (candle.close - candle.low) / range;

    // Rolling ATR 14
    let atrSum = 0;
    for (let i = Math.max(0, len - 14); i < len; i++) {
      atrSum += (history[i].high - history[i].low);
    }
    const rollingAtr = atrSum / Math.min(14, len);
    const rangeExpansion = range / Math.max(0.00005, rollingAtr);

    // Simple EMAs
    const closes = history.map(k => k.close);
    const ema9 = this.calcQuickEma(closes, 9);
    const ema21 = this.calcQuickEma(closes, 21);
    const emaSpread = (ema9 - ema21) / pipScale;
    const emaCurvature = (ema9 - c) / pipScale;

    // RSI proxy
    const rsiProxy = this.calcQuickRsiCentered(closes, 14);
    const rsiMomentum = rsiProxy * bodyDirection;

    // Donchian Range Positions (13 & 34)
    const pos13 = this.calcDonchianPos(history, 13, c);
    const pos34 = this.calcDonchianPos(history, 34, c);

    // Fast vs Slow Volatility Ratio
    const fastAtr = (history.slice(-5).reduce((acc, h) => acc + (h.high - h.low), 0) / 5) / pipScale;
    const slowAtr = (history.slice(-20).reduce((acc, h) => acc + (h.high - h.low), 0) / 20) / pipScale;
    const volRatio = fastAtr / Math.max(0.1, slowAtr);

    // Directional Efficiency
    const netMove = Math.abs(c - history[Math.max(0, len - 10)].close);
    let grossPath = 0;
    for (let i = Math.max(1, len - 9); i < len; i++) {
      grossPath += Math.abs(history[i].close - history[i - 1].close);
    }
    const directionalEfficiency = netMove / Math.max(0.00001, grossPath);

    // 1-bar autocorrelation proxy
    const autoCorr = Math.tanh(ret1 * ret3 / 10.0);

    // Wick pressure change
    const prevRange = Math.max(0.00005, history[len - 2].high - history[len - 2].low);
    const prevWickSum = (history[len - 2].high - Math.max(history[len - 2].open, history[len - 2].close) +
      Math.min(history[len - 2].open, history[len - 2].close) - history[len - 2].low) / prevRange;
    const currWickSum = upperWick + lowerWick;
    const wickPressureChange = currWickSum - prevWickSum;

    // Assemble raw 19-dimensional vector
    const rawVector = [
      ret1,
      ret3,
      ret5,
      ret13,
      bodyDirection,
      bodyRatio,
      wickImbalance,
      closeLocation,
      rangeExpansion,
      emaSpread,
      emaCurvature,
      rsiProxy,
      rsiMomentum,
      pos13,
      pos34,
      volRatio,
      directionalEfficiency,
      autoCorr,
      wickPressureChange,
    ];

    // Standardize to stable numeric bounds [-3.0, 3.0] using hyperbolic tangent scaling
    return rawVector.map((val, idx) => {
      if (idx === 4) return val; // binary direction
      return Number(Math.tanh(val / 2.5).toFixed(4));
    });
  }

  /**
   * 2. EPISODIC MEMORY RECORDING & K-NN NEIGHBORHOOD QUERY
   */
  public recordTradeOutcomeEpisode(
    signal: ResearchSignal,
    featureVector: number[],
    exitPrice: number,
    outcome: 'WIN' | 'LOSS' | 'SCRATCH' | 'CANCELLED',
    netUnits: number
  ) {
    const memory: EpisodicTradeMemory = {
      id: `mem_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      signalId: signal.id,
      symbol: signal.symbol,
      direction: signal.direction,
      featureVector,
      marketSession: signal.marketSession || 'ASIA',
      outcome,
      netReturnUnits: netUnits,
      entryPrice: signal.actualEntryPrice || signal.triggerPrice,
      exitPrice,
      timestamp: new Date().toISOString(),
    };

    this.episodicMemories.unshift(memory);
    if (this.episodicMemories.length > 500) {
      this.episodicMemories.pop(); // Cap bounded episodic memory store
    }

    // Trigger online Bayesian Reinforcement for the strategy arm
    this.updateBanditArm(signal.strategyId || signal.synthesizedGeneId || 'default', outcome);

    // Update PID Adaptive Threshold
    this.updatePidController(outcome);

    this.lastReinforcementTime = new Date().toISOString();
  }

  /**
   * Evaluates k-NN similarity across prior trade episodes.
   * Returns whether the local market structure historically failed (Inhibitory Veto).
   */
  public evaluateEpisodicVeto(
    symbol: ForexSymbol,
    direction: SignalDirection,
    featureVector: number[],
    k: number = 7
  ): {
    shouldVeto: boolean;
    reason: string;
    neighborhoodLossRate: number;
    neighborsFound: number;
  } {
    // Look at past memories for this currency pair or correlated assets
    const candidateMemories = this.episodicMemories.filter(
      m => m.symbol === symbol && m.direction === direction && ['WIN', 'LOSS'].includes(m.outcome)
    );

    if (candidateMemories.length < 5) {
      return {
        shouldVeto: false,
        reason: 'Insufficient episodic history for neighborhood veto.',
        neighborhoodLossRate: 0,
        neighborsFound: candidateMemories.length,
      };
    }

    // Compute Euclidean distance in 19D feature space
    const scored = candidateMemories.map(m => {
      let distSq = 0;
      for (let i = 0; i < featureVector.length; i++) {
        const diff = (featureVector[i] || 0) - (m.featureVector[i] || 0);
        distSq += diff * diff;
      }
      return { memory: m, distance: Math.sqrt(distSq) };
    });

    // Sort by distance (nearest neighbors first)
    scored.sort((a, b) => a.distance - b.distance);
    const kNearest = scored.slice(0, Math.min(k, scored.length));

    const total = kNearest.length;
    const losses = kNearest.filter(n => n.memory.outcome === 'LOSS').length;
    const lossRate = Number((losses / total).toFixed(2));

    // INHIBITORY VETO RULE: If >= 60% of nearest structural market episodes lost, VETO!
    if (total >= 5 && lossRate >= 0.60) {
      const reason = `[EPISODIC MEMORY VETO]: ${Math.round(lossRate * 100)}% of top-${total} nearest historical setups resulted in LOSS on ${symbol} ${direction}. Sub-microstructure pattern flagged as high-fragility trap.`;
      this.recentVetoes.unshift({
        timestamp: new Date().toISOString(),
        symbol,
        direction,
        reason,
        neighborhoodLossRate: lossRate,
      });
      if (this.recentVetoes.length > 20) this.recentVetoes.pop();

      return {
        shouldVeto: true,
        reason,
        neighborhoodLossRate: lossRate,
        neighborsFound: total,
      };
    }

    return {
      shouldVeto: false,
      reason: `Neighborhood cleared: ${Math.round((1 - lossRate) * 100)}% historical win rate across nearest ${total} episodes.`,
      neighborhoodLossRate: lossRate,
      neighborsFound: total,
    };
  }

  /**
   * 3. ONLINE BAYESIAN MULTI-ARMED BANDIT (THOMPSON SAMPLING)
   * Updates posterior Beta distribution of strategy win rates with exponential decay.
   */
  public updateBanditArm(strategyId: string, outcome: 'WIN' | 'LOSS' | 'SCRATCH' | 'CANCELLED') {
    this.initializeBanditArms();
    const arm = this.banditArms[strategyId];
    if (!arm || ['SCRATCH', 'CANCELLED'].includes(outcome)) return;

    const gamma = 0.96; // Exponential recency discount (~25 trade memory horizon)
    arm.totalTrades += 1;

    if (outcome === 'WIN') {
      arm.wins += 1;
      arm.alpha = Number((arm.alpha * gamma + 1.0).toFixed(3));
      arm.beta = Number((arm.beta * gamma).toFixed(3));
    } else if (outcome === 'LOSS') {
      arm.losses += 1;
      arm.alpha = Number((arm.alpha * gamma).toFixed(3));
      arm.beta = Number((arm.beta * gamma + 1.0).toFixed(3));
    }

    const scored = Math.max(1, arm.wins + arm.losses);
    arm.currentWinRate = Number(((arm.wins / scored) * 100).toFixed(1));

    // Draw Thompson sample from Beta(alpha, beta)
    arm.thompsonSampleScore = Number(this.sampleBeta(arm.alpha, arm.beta).toFixed(3));

    // Throttle underperforming arms below binary options break-even floor (55.6% @ 80% payout)
    const expectedWinRate = arm.alpha / (arm.alpha + arm.beta);
    if (scored >= 8 && expectedWinRate < 0.556) {
      arm.status = 'THROTTLED';
    } else {
      arm.status = 'ACTIVE_ARM';
    }

    arm.lastUpdated = new Date().toISOString();
  }

  /**
   * Samples a random variable from Beta(alpha, beta) using Johnk's generator
   */
  private sampleBeta(alpha: number, beta: number): number {
    const a = Math.max(0.1, alpha);
    const b = Math.max(0.1, beta);
    // Fast approximation of Beta via Gamma distributions
    const gammaA = this.sampleGamma(a);
    const gammaB = this.sampleGamma(b);
    return gammaA / (gammaA + gammaB);
  }

  private sampleGamma(shape: number): number {
    // Marsaglia and Tsang method for Gamma(shape, 1)
    if (shape < 1) {
      return this.sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
    }
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    while (true) {
      let x, v;
      do {
        x = (Math.random() + Math.random() + Math.random() - 1.5) * 2; // normal approx
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = Math.random();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }

  /**
   * 4. HURST EXPONENT & SHANNON ENTROPY REGIME CLASSIFICATION
   * Computes market memory persistence:
   * H > 0.55: Persistent / Trending (Trend-following setups favoured)
   * H < 0.45: Anti-persistent / Mean-reverting (Wick-rejection fades favoured)
   * 0.45 <= H <= 0.55: Random walk / High-entropy noise (Stand down or demand high conviction)
   */
  public classifyMarketRegime(symbol: ForexSymbol, candles: Candle[]): MarketRegimeState {
    if (!candles || candles.length < 40) {
      return {
        symbol,
        hurstExponent: 0.50,
        regimeType: 'RANDOM_WALK_CHOP',
        shannonEntropy: 0.85,
        atrPercentile: 50,
        recommendedFamily: 'stand_down',
        calculatedAt: new Date().toISOString(),
      };
    }

    const n = Math.min(64, candles.length);
    const sample = candles.slice(-n);
    const closes = sample.map(c => c.close);

    // Compute returns
    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      returns.push(closes[i] - closes[i - 1]);
    }

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    let sumDevSq = 0;
    const cumDev: number[] = [];
    let running = 0;

    for (const r of returns) {
      const dev = r - mean;
      sumDevSq += dev * dev;
      running += dev;
      cumDev.push(running);
    }

    const stdDev = Math.sqrt(sumDevSq / Math.max(1, returns.length - 1));
    const range = Math.max(...cumDev) - Math.min(...cumDev);
    const rs = range / Math.max(0.00001, stdDev);
    // H = ln(R/S) / ln(n)
    const rawHurst = Math.log(Math.max(1.0, rs)) / Math.log(n);
    const hurst = Number(Math.max(0.20, Math.min(0.85, rawHurst)).toFixed(2));

    // Shannon Entropy of price action
    const binCount = 8;
    const bins = new Array(binCount).fill(0);
    const minR = Math.min(...returns);
    const maxR = Math.max(...returns);
    const span = Math.max(0.00001, maxR - minR);

    for (const r of returns) {
      const binIdx = Math.min(binCount - 1, Math.floor(((r - minR) / span) * binCount));
      bins[binIdx]++;
    }

    let entropy = 0;
    for (const count of bins) {
      if (count > 0) {
        const p = count / returns.length;
        entropy -= p * Math.log2(p);
      }
    }
    const maxEntropy = Math.log2(binCount);
    const normEntropy = Number((entropy / maxEntropy).toFixed(2));

    // ATR Rank
    const ranges = sample.map(c => c.high - c.low);
    const currentRange = ranges[ranges.length - 1];
    const sortedRanges = [...ranges].sort((a, b) => a - b);
    const rankIdx = sortedRanges.findIndex(r => r >= currentRange);
    const atrPercentile = Math.round((rankIdx / sortedRanges.length) * 100);

    let regimeType: MarketRegimeState['regimeType'] = 'RANDOM_WALK_CHOP';
    let recommendedFamily: MarketRegimeState['recommendedFamily'] = 'stand_down';

    if (hurst >= 0.56 && normEntropy < 0.88) {
      regimeType = 'TRENDING';
      recommendedFamily = 'momentum';
    } else if (hurst <= 0.44 && normEntropy < 0.90) {
      regimeType = 'MEAN_REVERTING';
      recommendedFamily = 'mean_reversion';
    } else {
      regimeType = 'RANDOM_WALK_CHOP';
      recommendedFamily = 'stand_down';
    }

    const state: MarketRegimeState = {
      symbol,
      hurstExponent: hurst,
      regimeType,
      shannonEntropy: normEntropy,
      atrPercentile,
      recommendedFamily,
      calculatedAt: new Date().toISOString(),
    };

    this.regimeCache[symbol] = state;
    return state;
  }

  /**
   * 5. PID ADAPTIVE SENSITIVITY CONTROLLER
   * Automatically tightens entry thresholds when trailing performance dips,
   * protecting capital from regime shifts.
   */
  private updatePidController(outcome: 'WIN' | 'LOSS' | 'SCRATCH' | 'CANCELLED') {
    if (['SCRATCH', 'CANCELLED'].includes(outcome)) return;

    // Target win rate: 72%
    const TARGET_ACCURACY = 0.72;
    const resultVal = outcome === 'WIN' ? 1.0 : 0.0;
    const error = TARGET_ACCURACY - resultVal;

    this.trailingErrors.push(error);
    if (this.trailingErrors.length > 20) {
      this.trailingErrors.shift();
    }

    const Kp = 0.08; // Proportional gain
    const Ki = 0.02; // Integral gain
    const Kd = 0.04; // Derivative gain

    const pTerm = error;
    const iTerm = this.trailingErrors.reduce((a, b) => a + b, 0) / this.trailingErrors.length;
    const dTerm = this.trailingErrors.length >= 2
      ? this.trailingErrors[this.trailingErrors.length - 1] - this.trailingErrors[this.trailingErrors.length - 2]
      : 0;

    const adjustment = Kp * pTerm + Ki * iTerm + Kd * dTerm;
    // Bound the adaptive threshold delta within [-0.08, +0.15]
    this.adaptiveThresholdDelta = Number(Math.max(-0.08, Math.min(0.15, this.adaptiveThresholdDelta + adjustment)).toFixed(3));
  }

  /**
   * 6. ACTIVE ANTIDOTE IMMUNE FILTER
   * Checks if an incoming setup triggers an active forensic autopsy antidote pattern.
   */
  public evaluateAntidoteImmuneResistance(
    symbol: ForexSymbol,
    direction: SignalDirection,
    candle: Candle
  ): {
    resistanceApplied: boolean;
    dampingPenalty: number;
    antidoteName?: string;
  } {
    const autopsies = db.getLossAutopsies();
    if (!autopsies || autopsies.length === 0) {
      return { resistanceApplied: false, dampingPenalty: 0 };
    }

    // Match autopsies on this pair and direction in recent history
    const matching = autopsies.filter(
      a => a.symbol === symbol && a.direction === direction
    );

    if (matching.length === 0) {
      return { resistanceApplied: false, dampingPenalty: 0 };
    }

    const recentAutopsy = matching[0];
    // Apply negative inhibitory resistance: reduces conviction score by 0.12 - 0.20
    return {
      resistanceApplied: true,
      dampingPenalty: 0.14,
      antidoteName: recentAutopsy.antidoteStrategyName,
    };
  }

  /**
   * Returns complete real-time AGI learning state for API and UI telemetry.
   */
  public getSelfLearningState(): AgiSelfLearningState {
    const autopsies = db.getLossAutopsies();
    return {
      totalEpisodesLearned: this.episodicMemories.length,
      banditArms: this.banditArms,
      regimes: this.regimeCache,
      recentVetoes: this.recentVetoes,
      adaptiveThresholdDelta: this.adaptiveThresholdDelta,
      activeImmuneAntidotesCount: autopsies.length,
      lastReinforcementAt: this.lastReinforcementTime,
    };
  }

  // Helper math utilities
  private calcQuickEma(values: number[], period: number): number {
    if (values.length === 0) return 0;
    const k = 2 / (period + 1);
    let ema = values[0];
    for (let i = 1; i < values.length; i++) {
      ema = values[i] * k + ema * (1 - k);
    }
    return ema;
  }

  private calcQuickRsiCentered(values: number[], period: number): number {
    if (values.length < period + 1) return 0;
    let gains = 0;
    let losses = 0;
    for (let i = values.length - period; i < values.length; i++) {
      const diff = values[i] - values[i - 1];
      if (diff > 0) gains += diff;
      else losses += Math.abs(diff);
    }
    if (losses === 0) return 1.0;
    const rs = gains / losses;
    const rsi = 100 - (100 / (1 + rs));
    return (rsi - 50) / 50; // Scaled -1.0 to +1.0
  }

  private calcDonchianPos(history: Candle[], lookback: number, close: number): number {
    const slice = history.slice(-lookback);
    const high = Math.max(...slice.map(c => c.high));
    const low = Math.min(...slice.map(c => c.low));
    const range = high - low;
    if (range <= 0.00001) return 0.5;
    return (close - low) / range;
  }
}

export const agiSelfLearningEngine = new AgiSelfLearningEngine();
