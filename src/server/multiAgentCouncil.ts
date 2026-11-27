/**
 * SignalForge ML — Multi-Agent Adversarial Debate & Hedge Meta-Learner Council
 *
 * Architectural foundations (zero external LLM keys, <2ms local inference):
 * 1. TradingAgents (TauricResearch): Specialized Bull/Momentum vs. Bear/Contrarian
 *    researchers + Risk Auditor engaging in explicit adversarial critique before decision.
 * 2. Du et al. Multi-Agent Debate: 2-round structured protocol (Propose -> Cross-Examine
 *    & Challenge -> Belief Revision) to curb confirmation bias and expose fragile theses.
 * 3. Multiplicative Weights / Hedge Algorithm: Online regret-minimizing meta-learner
 *    updating each agent's trust weight cleanly on settled WIN/LOSS outcomes with a fixed
 *    exploration mixing floor so no specialist ever dies permanently across regime shifts.
 * 4. Counterfactual Red-Team Stress Testing: Perturbs prediction-time 19D feature vectors
 *    across 5 adverse microstructure shocks (spread slippage, exhaustion reversal, wick
 *    rejection spike, volatility shock, noise attenuation) to score thesis survival.
 *
 * Operating Mode: SHADOW + AUDIT ONLY (never modifies live execution or live confidence).
 */

import {
  AgentCouncilState,
  DebateAgentRole,
  DebateAgentVote,
  DebateChallengeRecord,
  ForexSymbol,
  HedgeAgentWeightState,
  MarketRegimeState,
  MultiAgentDebateResult,
  ResearchSignal,
  SignalDirection,
} from '../types/index.js';
import { computeBreakEvenProbability, PriorEpisodeRecord, wilsonInterval } from './shadowPredictor.js';
import { agiSelfLearningEngine } from './agiEngine.js';
import { onlinePolicyNetwork } from './onlinePolicyNetwork.js';
import { db } from './db.js';

export const COUNCIL_DEBATE_VERSION = 'council-hedge-v1.0';
const MAX_TRAINED_COUNCIL_IDS = 5000;
const AGENT_IDS: DebateAgentRole[] = [
  'BULL_MOMENTUM',
  'BEAR_CONTRARIAN',
  'NEURAL_BANDIT',
  'ADVERSARIAL_RED_TEAM',
  'RISK_AUDITOR',
];

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function round(val: number, digits = 4): number {
  const f = Math.pow(10, digits);
  return Math.round(val * f) / f;
}

function sigmoid(z: number): number {
  const cz = clamp(z, -12, 12);
  return 1 / (1 + Math.exp(-cz));
}

function defaultAgentsMap(): Record<DebateAgentRole, HedgeAgentWeightState> {
  const uniformWeight = 1 / AGENT_IDS.length;
  return {
    BULL_MOMENTUM: {
      agentId: 'BULL_MOMENTUM',
      agentName: 'Trend & Momentum Quant',
      roleSummary: 'Advocates directional continuation via EMA9/21 curvature, multi-horizon returns & breakout expansion.',
      weight: uniformWeight,
      observations: 0,
      correctCalls: 0,
      cumulativeBrier: 0,
      cumulativeLogLoss: 0,
      challengeWins: 0,
      challengeAttempts: 0,
      lastWeightDelta: 0,
      lastUpdatedAt: null,
    },
    BEAR_CONTRARIAN: {
      agentId: 'BEAR_CONTRARIAN',
      agentName: 'Contrarian Mean-Reverter',
      roleSummary: 'Challenges trend chasing via RSI stretch, wick rejection imbalance, Donchian extremes & mean-reversion regimes.',
      weight: uniformWeight,
      observations: 0,
      correctCalls: 0,
      cumulativeBrier: 0,
      cumulativeLogLoss: 0,
      challengeWins: 0,
      challengeAttempts: 0,
      lastWeightDelta: 0,
      lastUpdatedAt: null,
    },
    NEURAL_BANDIT: {
      agentId: 'NEURAL_BANDIT',
      agentName: 'Neural + Bandit Ensemble',
      roleSummary: 'Synthesizes out-of-sample MLP-19, 56D FTRL, direction-isolated LinUCB V2, and cosine k-NN manifolds.',
      weight: uniformWeight,
      observations: 0,
      correctCalls: 0,
      cumulativeBrier: 0,
      cumulativeLogLoss: 0,
      challengeWins: 0,
      challengeAttempts: 0,
      lastWeightDelta: 0,
      lastUpdatedAt: null,
    },
    ADVERSARIAL_RED_TEAM: {
      agentId: 'ADVERSARIAL_RED_TEAM',
      agentName: 'Counterfactual Red-Team Challenger',
      roleSummary: 'Runs 5 adverse 19D feature perturbations (slippage, reversal, wick flip, volatility shock, noise) + immune autopsies.',
      weight: uniformWeight,
      observations: 0,
      correctCalls: 0,
      cumulativeBrier: 0,
      cumulativeLogLoss: 0,
      challengeWins: 0,
      challengeAttempts: 0,
      lastWeightDelta: 0,
      lastUpdatedAt: null,
    },
    RISK_AUDITOR: {
      agentId: 'RISK_AUDITOR',
      agentName: 'Break-Even & Portfolio Auditor',
      roleSummary: 'Audits realized strategy Wilson lower bound, binary break-even floor vs payout, & Hurst/Entropy chop risk.',
      weight: uniformWeight,
      observations: 0,
      correctCalls: 0,
      cumulativeBrier: 0,
      cumulativeLogLoss: 0,
      challengeWins: 0,
      challengeAttempts: 0,
      lastWeightDelta: 0,
      lastUpdatedAt: null,
    },
  };
}

export function createInitialAgentCouncilState(): AgentCouncilState {
  return {
    version: COUNCIL_DEBATE_VERSION,
    eta: 0.25,
    mixingAlpha: 0.02,
    totalDebatesEvaluated: 0,
    trainedSignalIds: [],
    duplicateBlocks: 0,
    agents: defaultAgentsMap(),
    lastUpdatedAt: null,
  };
}

function normalizeCouncilState(raw?: Partial<AgentCouncilState> | null): AgentCouncilState {
  const base = createInitialAgentCouncilState();
  if (!raw || typeof raw !== 'object') return base;

  const mergedAgents = { ...base.agents };
  for (const id of AGENT_IDS) {
    const incoming = raw.agents?.[id];
    if (incoming && typeof incoming === 'object') {
      mergedAgents[id] = {
        ...base.agents[id],
        ...incoming,
        agentId: id,
        weight:
          typeof incoming.weight === 'number' && Number.isFinite(incoming.weight) && incoming.weight > 0
            ? incoming.weight
            : base.agents[id].weight,
      };
    }
  }

  // Re-normalize agent weights to sum strictly to 1.0
  const sumW = AGENT_IDS.reduce((s, id) => s + mergedAgents[id].weight, 0);
  if (sumW > 0) {
    for (const id of AGENT_IDS) {
      mergedAgents[id].weight = round(mergedAgents[id].weight / sumW, 6);
    }
  }

  return {
    version: typeof raw.version === 'string' ? raw.version : COUNCIL_DEBATE_VERSION,
    eta: typeof raw.eta === 'number' && Number.isFinite(raw.eta) ? raw.eta : 0.25,
    mixingAlpha: typeof raw.mixingAlpha === 'number' && Number.isFinite(raw.mixingAlpha) ? raw.mixingAlpha : 0.02,
    totalDebatesEvaluated: typeof raw.totalDebatesEvaluated === 'number' ? raw.totalDebatesEvaluated : 0,
    trainedSignalIds: Array.isArray(raw.trainedSignalIds)
      ? raw.trainedSignalIds.slice(-MAX_TRAINED_COUNCIL_IDS)
      : [],
    duplicateBlocks: typeof raw.duplicateBlocks === 'number' ? raw.duplicateBlocks : 0,
    agents: mergedAgents,
    lastUpdatedAt: raw.lastUpdatedAt || null,
  };
}

export interface CouncilDebateInput {
  symbol: ForexSymbol;
  direction: SignalDirection;
  ruleFamily: string;
  strategyId?: string;
  payoutPct?: number;
  marketFeatureVector: number[];
  regime?: MarketRegimeState | null;
  ftrlProbability?: number;
  ftrlSampleSize?: number;
  mlpUpProbability?: number;
  mlpStepCount?: number;
  mlpOosBce?: number | null;
  linUcbV2Score?: number | null;
  linUcbV2Obs?: number;
  knnWinProbability?: number | null;
  knnSampleCount?: number;
  immuneDampingPenalty?: number;
  severeTrapCount?: number;
  priorSettledRecords: PriorEpisodeRecord[];
}

export interface CounterfactualStressSummary {
  survivalRate: number;
  baselineDirProb: number;
  worstScenarioProb: number;
  scenariosTested: number;
  scenariosSurvived: number;
  failedScenarios: string[];
}

/**
 * Evaluates 5 deterministic prediction-time counterfactual stress shocks on a 19D feature vector.
 * Falls back smoothly to feature-margin evaluation when MLP stepCount < 10.
 */
export function runCounterfactualStressSuite(
  featureVec: number[],
  direction: SignalDirection,
  breakEvenProbability: number,
  mlpStepCount: number,
  forwardFn: (vec: number[]) => { probabilityUp: number }
): CounterfactualStressSummary {
  const dirSign = direction === 'BUY' ? 1 : -1;
  const vec = featureVec.length === 19 && featureVec.every(Number.isFinite)
    ? featureVec
    : new Array(19).fill(0);

  const scoreVec = (v: number[]): number => {
    if (mlpStepCount >= 10) {
      const pUp = forwardFn(v).probabilityUp;
      return direction === 'BUY' ? pUp : 1 - pUp;
    }
    // Cold-start interpretable linear stress surrogate over canonical 19D features:
    // ret1 (0), ret3 (1), emaSpread (9), rsiProxy (11), bodyDir (4), wickImbalance=upper-lower (6)
    const rawMomentum =
      0.22 * v[0] +
      0.16 * v[1] +
      0.18 * v[9] -
      0.15 * v[11] +
      0.15 * v[4] -
      0.20 * v[6];
    return sigmoid(dirSign * rawMomentum * 0.45);
  };

  const baselineDirProb = scoreVec(vec);
  const survivalFloor = Math.max(0.49, breakEvenProbability - 0.04);

  const scenarios: Array<{ name: string; build: (base: number[]) => number[] }> = [
    {
      name: 'SPREAD_SLIPPAGE',
      build: (b) => {
        const copy = [...b];
        copy[0] = b[0] - dirSign * 0.85;
        copy[9] = b[9] * 0.85;
        return copy;
      },
    },
    {
      name: 'MOMENTUM_FADE',
      build: (b) => {
        const copy = [...b];
        copy[1] = b[1] * 0.45;
        copy[2] = b[2] * 0.45;
        copy[9] = b[9] * 0.55;
        copy[10] = b[10] * 0.55;
        return copy;
      },
    },
    {
      name: 'WICK_REJECTION',
      build: (b) => {
        const copy = [...b];
        copy[6] = dirSign * 0.45;
        copy[7] = dirSign > 0 ? 0.08 : 0.92;
        copy[8] = Math.max(b[8], 0.45);
        return copy;
      },
    },
    {
      name: 'VOLATILITY_SPIKE',
      build: (b) => {
        const copy = [...b];
        copy[8] = b[8] * 1.35;
        copy[15] = b[15] * 1.35;
        copy[4] = b[4] * 0.7;
        return copy;
      },
    },
    {
      name: 'SIGNAL_TO_NOISE_DECAY',
      build: (b) => b.map((val) => val * 0.72),
    },
  ];

  let survived = 0;
  let worstProb = baselineDirProb;
  const failedScenarios: string[] = [];

  for (const s of scenarios) {
    const p = scoreVec(s.build(vec));
    if (p < worstProb) worstProb = p;
    if (p >= survivalFloor) {
      survived += 1;
    } else {
      failedScenarios.push(s.name);
    }
  }

  return {
    survivalRate: round(survived / scenarios.length, 4),
    baselineDirProb: round(baselineDirProb, 4),
    worstScenarioProb: round(worstProb, 4),
    scenariosTested: scenarios.length,
    scenariosSurvived: survived,
    failedScenarios,
  };
}

/**
 * Pure deterministic 2-round adversarial debate evaluation (safe for live telemetry & historical replay).
 */
export function runMultiAgentDebate(
  input: CouncilDebateInput,
  councilState: AgentCouncilState,
  forwardFn: (vec: number[]) => { probabilityUp: number } = (v) => onlinePolicyNetwork.forward(v)
): MultiAgentDebateResult {
  const vec = input.marketFeatureVector.length === 19 && input.marketFeatureVector.every(Number.isFinite)
    ? input.marketFeatureVector
    : new Array(19).fill(0);
  const dirSign = input.direction === 'BUY' ? 1 : -1;
  const payoutPct = typeof input.payoutPct === 'number' && Number.isFinite(input.payoutPct) && input.payoutPct > 0
    ? input.payoutPct
    : 80;
  const breakEvenProb = computeBreakEvenProbability(payoutPct);

  // Unpack canonical 19D prediction-time features (defined in agiEngine.extractFeatureVector)
  const ret1 = vec[0];
  const ret3 = vec[1];
  const ret5 = vec[2];
  const bodyRatio = vec[5];
  const wickImbalance = vec[6]; // (upperWick - lowerWick)/range: + = upper wick rejection, - = lower wick support
  const closeLocation = vec[7];
  const rangeExpansion = vec[8];
  const emaSpread = vec[9];
  const emaCurvature = vec[10];
  const rsiCentered = vec[11]; // [-1, +1], positive = high RSI
  const pos13 = vec[13];
  const pos34 = vec[14];
  const volRatio = vec[15];

  // =========================================================================
  // ROUND 1: INDEPENDENT AGENT ANALYSES
  // =========================================================================

  // 1. BULL_MOMENTUM (Trend & Breakout Advocate)
  const alignedEma = clamp(dirSign * emaSpread * 0.45, -1.2, 1.2);
  const alignedReturns = clamp(dirSign * (ret1 * 0.35 + ret3 * 0.25 + ret5 * 0.15), -1.2, 1.2);
  const breakoutSupport = clamp((rangeExpansion * 0.25) + (volRatio * 0.2) + (bodyRatio * 0.35) + (dirSign * (closeLocation - 0.5) * 0.4), -0.6, 0.7);
  const regimeTrendAlign =
    input.regime?.regimeType === 'TRENDING'
      ? 0.25
      : input.regime?.regimeType === 'RANDOM_WALK_CHOP'
        ? -0.22
        : -0.05;
  const bullR1 = clamp(sigmoid(0.05 + 0.55 * alignedEma + 0.45 * alignedReturns + breakoutSupport + regimeTrendAlign), 0.15, 0.88);

  // 2. BEAR_CONTRARIAN (Exhaustion / Reversion Counter-Thesis)
  // Argues AGAINST trade continuation whenever RSI/Donchian is overextended or adverse wick absorption appears
  const dirRsi = dirSign * rsiCentered; // > 0.20 means chasing overbought (BUY) / oversold (SELL)
  const exhaustionPenalty = dirRsi > 0.20 ? (dirRsi - 0.20) * 1.15 : dirRsi < -0.20 ? dirRsi * 0.65 : 0;
  const adverseWick = dirSign * wickImbalance;
  const stretchPos = (dirSign > 0 ? pos34 : 1 - pos34) - 0.58;
  const meanRevBonus = input.regime?.regimeType === 'MEAN_REVERTING' && stretchPos > 0.15 ? 0.35 : 0;
  const contrarianHeadwind = clamp(
    0.75 * exhaustionPenalty + 0.9 * Math.max(0, adverseWick) + 0.75 * Math.max(0, stretchPos) + meanRevBonus - clamp(-dirSign * emaCurvature * 0.05, -0.3, 0.3),
    -0.5,
    1.5
  );
  const bearR1 = clamp(sigmoid(0.10 - contrarianHeadwind), 0.15, 0.85);

  // 3. NEURAL_BANDIT (FTRL + OOS-MLP + LinUCB V2 + Cosine k-NN)
  const neuralLogits: number[] = [];
  const neuralNotes: string[] = [];
  const ftrlProb = typeof input.ftrlProbability === 'number' && Number.isFinite(input.ftrlProbability) ? clamp(input.ftrlProbability, 0.15, 0.85) : 0.5;
  const ftrlN = input.ftrlSampleSize ?? 0;
  if (ftrlN >= 8) {
    neuralLogits.push((ftrlProb - 0.5) * clamp(ftrlN / 25, 0.4, 1.4));
    neuralNotes.push(`FTRL=${(ftrlProb * 100).toFixed(1)}%(n=${ftrlN})`);
  }
  const mlpSteps = input.mlpStepCount ?? 0;
  const mlpOos = input.mlpOosBce ?? null;
  if (typeof input.mlpUpProbability === 'number' && Number.isFinite(input.mlpUpProbability) && mlpSteps >= 10) {
    const mlpDir = input.direction === 'BUY' ? input.mlpUpProbability : 1 - input.mlpUpProbability;
    const gateW = mlpOos !== null && mlpOos < 0.693 ? clamp((0.6931 - mlpOos) * 10, 0.4, 1.3) : 0.35;
    neuralLogits.push((mlpDir - 0.5) * gateW);
    neuralNotes.push(`MLP=${(mlpDir * 100).toFixed(1)}%(step=${mlpSteps})`);
  }
  if (typeof input.linUcbV2Score === 'number' && Number.isFinite(input.linUcbV2Score) && (input.linUcbV2Obs ?? 0) >= 4) {
    neuralLogits.push(0.35 * Math.tanh(input.linUcbV2Score));
    neuralNotes.push(`LinUCB2=${input.linUcbV2Score.toFixed(2)}`);
  }
  if (typeof input.knnWinProbability === 'number' && Number.isFinite(input.knnWinProbability) && (input.knnSampleCount ?? 0) >= 4) {
    neuralLogits.push((clamp(input.knnWinProbability, 0.15, 0.85) - 0.5) * 0.9);
    neuralNotes.push(`kNN=${(input.knnWinProbability * 100).toFixed(0)}%(n=${input.knnSampleCount})`);
  }
  const neuralNetSum = neuralLogits.reduce((a, b) => a + b, 0);
  const neuralR1 = clamp(sigmoid(neuralNetSum * 1.4), 0.15, 0.88);

  // 4. ADVERSARIAL_RED_TEAM (Counterfactual Stress Suite + Autopsy/Trap Pressure)
  const stress = runCounterfactualStressSuite(vec, input.direction, breakEvenProb, mlpSteps, forwardFn);
  const immunePen = typeof input.immuneDampingPenalty === 'number' && Number.isFinite(input.immuneDampingPenalty)
    ? input.immuneDampingPenalty
    : 0;
  const trapPen = typeof input.severeTrapCount === 'number' && input.severeTrapCount > 0
    ? 0.14 * Math.min(2, input.severeTrapCount)
    : 0;
  const redTeamBase = 0.34 + 0.32 * stress.survivalRate - immunePen * 0.65 - trapPen;
  const redTeamR1 = clamp(redTeamBase, 0.12, 0.82);

  // 5. RISK_AUDITOR (Break-Even Edge & Realized Empirical Wilson Bound)
  const priors = input.priorSettledRecords || [];
  const matching = priors.filter(
    (p) => (input.strategyId && p.strategyId === input.strategyId) || p.ruleFamily === input.ruleFamily
  );
  const priorWins = priors.filter((p) => p.outcome === 'WIN').length;
  const globalPrior = priors.length > 0 ? (priorWins + 7) / (priors.length + 14) : 0.5;
  const stratWins = matching.filter((p) => p.outcome === 'WIN').length;
  const wilson = wilsonInterval(stratWins, matching.length);
  const bayesStrat = (stratWins + 12 * globalPrior) / (matching.length + 12);
  const chopPenalty = input.regime?.regimeType === 'RANDOM_WALK_CHOP' ? -0.045 : 0;
  const riskR1 = clamp(
    0.55 * bayesStrat + 0.45 * (matching.length >= 6 ? wilson.lower + 0.08 : globalPrior) + chopPenalty,
    0.15,
    0.85
  );

  // =========================================================================
  // ROUND 2: ADVERSARIAL CROSS-EXAMINATION & BELIEF REVISION
  // =========================================================================
  let bullR2 = bullR1;
  let bearR2 = bearR1;
  let neuralR2 = neuralR1;
  const redTeamR2 = redTeamR1;
  const riskR2 = riskR1;
  const challenges: DebateChallengeRecord[] = [];

  // Challenge 1: Bear Contrarian challenges Bull Momentum on overextension / counter-wick
  if (bearR1 < 0.47 && bullR1 > 0.52) {
    const shift = -clamp((0.50 - bearR1) * 0.45, 0.02, 0.12);
    bullR2 = clamp(bullR1 + shift, 0.15, 0.88);
    challenges.push({
      challenger: 'BEAR_CONTRARIAN',
      target: 'BULL_MOMENTUM',
      flawCited: `Counter-thesis detects extension headwind (RSI=${clamp(50 + rsiCentered * 50, 0, 100).toFixed(0)}, Pos34=${(pos34 * 100).toFixed(0)}%, WickImb=${wickImbalance.toFixed(2)}).`,
      rebuttal: `Momentum thesis discounted by ${Math.abs(shift * 100).toFixed(1)}pp after structural exhaustion challenge.`,
      probabilityAdjustment: round(shift, 4),
      outcome: 'CONCEDED_REVISION',
    });
  } else if (bullR1 >= 0.58 && bearR1 >= 0.52) {
    challenges.push({
      challenger: 'BEAR_CONTRARIAN',
      target: 'BULL_MOMENTUM',
      flawCited: 'Scanned for RSI exhaustion & opposing liquidity sweeps.',
      rebuttal: 'Contrarian found insufficient counter-evidence; momentum structure defended cleanly.',
      probabilityAdjustment: 0,
      outcome: 'DEFENDED',
    });
  }

  // Challenge 2: Adversarial Red-Team attacks Consensus on Counterfactual Stress Failure or Immune Pattern
  if (stress.survivalRate < 0.65 || immunePen > 0 || trapPen > 0) {
    const redShift = -clamp((0.8 - stress.survivalRate) * 0.14 + immunePen * 0.25 + trapPen * 0.3, 0.03, 0.14);
    bullR2 = clamp(bullR2 + redShift * 0.65, 0.15, 0.88);
    neuralR2 = clamp(neuralR2 + redShift * 0.85, 0.15, 0.88);
    const causes = [
      stress.failedScenarios.length > 0 ? `failed counterfactuals [${stress.failedScenarios.join(', ')}]` : null,
      immunePen > 0 ? `autopsy immune penalty -${(immunePen * 100).toFixed(0)}%` : null,
      trapPen > 0 ? `${input.severeTrapCount} severe behavioural trap(s)` : null,
    ].filter(Boolean);
    challenges.push({
      challenger: 'ADVERSARIAL_RED_TEAM',
      target: 'NEURAL_BANDIT',
      flawCited: `Thesis cracked under adversarial stress (${stress.scenariosSurvived}/${stress.scenariosTested} survived): ${causes.join('; ')}.`,
      rebuttal: `Supporters forced to revise downward (${(redShift * 0.85 * 100).toFixed(1)}pp) under worst-case shock.`,
      probabilityAdjustment: round(redShift, 4),
      outcome: 'CONCEDED_REVISION',
    });
  } else {
    // Red-Team challenge failed to break thesis -> Bear Contrarian nudged up slightly (acknowledging robustness)
    bearR2 = clamp(bearR1 + 0.03, 0.15, 0.85);
    challenges.push({
      challenger: 'ADVERSARIAL_RED_TEAM',
      target: 'CONSENSUS',
      flawCited: `Injected 5 counterfactual market shocks (worst prob ${(stress.worstScenarioProb * 100).toFixed(1)}%).`,
      rebuttal: `Thesis survived ${stress.scenariosSurvived}/${stress.scenariosTested} adversarial scenarios cleanly.`,
      probabilityAdjustment: 0.02,
      outcome: 'DEFENDED',
    });
  }

  // Challenge 3: Risk Auditor challenges weak break-even edge or Chop regime
  if (riskR1 < breakEvenProb) {
    const riskShift = -clamp((breakEvenProb - riskR1) * 0.4, 0.02, 0.09);
    bullR2 = clamp(bullR2 + riskShift * 0.5, 0.15, 0.88);
    neuralR2 = clamp(neuralR2 + riskShift * 0.5, 0.15, 0.88);
    challenges.push({
      challenger: 'RISK_AUDITOR',
      target: 'CONSENSUS',
      flawCited: `Strategy edge ${(riskR1 * 100).toFixed(1)}% falls below ${(breakEvenProb * 100).toFixed(1)}% break-even floor at ${payoutPct.toFixed(0)}% payout (Wilson low ${(wilson.lower * 100).toFixed(1)}%, n=${matching.length}).`,
      rebuttal: `Risk penalty applied across coalition; flagged for negative expected-value drift.`,
      probabilityAdjustment: round(riskShift, 4),
      outcome: 'RISK_WARNING',
    });
  }

  const r1Probs = [bullR1, bearR1, neuralR1, redTeamR1, riskR1];
  const r2Probs = [bullR2, bearR2, neuralR2, redTeamR2, riskR2];
  const stanceOf = (p: number): DebateAgentVote['stance'] =>
    p >= breakEvenProb + 0.02 ? 'SUPPORT' : p < breakEvenProb - 0.02 ? 'OPPOSE' : 'NEUTRAL';

  const votes: DebateAgentVote[] = [
    {
      agentId: 'BULL_MOMENTUM',
      agentName: councilState.agents.BULL_MOMENTUM.agentName,
      stance: stanceOf(bullR2),
      round1Probability: round(bullR1, 4),
      round2Probability: round(bullR2, 4),
      confidence: round(Math.abs(bullR2 - 0.5) * 2, 4),
      hedgeWeightAtDecision: councilState.agents.BULL_MOMENTUM.weight,
      rationale: `EMA spread ${emaSpread.toFixed(2)} pips, aligned returns (${ret1.toFixed(1)}/${ret3.toFixed(1)}p), body ratio ${(bodyRatio * 100).toFixed(0)}%, regime ${input.regime?.regimeType || 'UNKNOWN'}.`,
      keyMetrics: [`EMA_Spread=${emaSpread.toFixed(2)}`, `Ret3=${ret3.toFixed(2)}p`, `VolRatio=${volRatio.toFixed(2)}`],
    },
    {
      agentId: 'BEAR_CONTRARIAN',
      agentName: councilState.agents.BEAR_CONTRARIAN.agentName,
      stance: stanceOf(bearR2),
      round1Probability: round(bearR1, 4),
      round2Probability: round(bearR2, 4),
      confidence: round(Math.abs(bearR2 - 0.5) * 2, 4),
      hedgeWeightAtDecision: councilState.agents.BEAR_CONTRARIAN.weight,
      rationale: `RSI=${(50 + rsiCentered * 50).toFixed(1)}, Donchian34=${(pos34 * 100).toFixed(0)}%, adverse wick exposure ${(Math.max(0, adverseWick) * 100).toFixed(0)}%.`,
      keyMetrics: [`RSI=${(50 + rsiCentered * 50).toFixed(1)}`, `Pos34=${(pos34 * 100).toFixed(0)}%`, `Pos13=${(pos13 * 100).toFixed(0)}%`],
    },
    {
      agentId: 'NEURAL_BANDIT',
      agentName: councilState.agents.NEURAL_BANDIT.agentName,
      stance: stanceOf(neuralR2),
      round1Probability: round(neuralR1, 4),
      round2Probability: round(neuralR2, 4),
      confidence: round(Math.abs(neuralR2 - 0.5) * 2, 4),
      hedgeWeightAtDecision: councilState.agents.NEURAL_BANDIT.weight,
      rationale: neuralNotes.length > 0 ? `Learned predictors: ${neuralNotes.join(', ')}.` : 'Cold-start neutral prior (insufficient settled neural samples).',
      keyMetrics: neuralNotes.length > 0 ? neuralNotes : ['COLD_START=0.50'],
    },
    {
      agentId: 'ADVERSARIAL_RED_TEAM',
      agentName: councilState.agents.ADVERSARIAL_RED_TEAM.agentName,
      stance: stanceOf(redTeamR2),
      round1Probability: round(redTeamR1, 4),
      round2Probability: round(redTeamR2, 4),
      confidence: round(Math.abs(redTeamR2 - 0.5) * 2, 4),
      hedgeWeightAtDecision: councilState.agents.ADVERSARIAL_RED_TEAM.weight,
      rationale: `Survived ${stress.scenariosSurvived}/${stress.scenariosTested} counterfactual stress shocks (worst ${(stress.worstScenarioProb * 100).toFixed(1)}%${stress.failedScenarios.length > 0 ? `, failed: ${stress.failedScenarios.join(',')}` : ''}).`,
      keyMetrics: [`Survival=${(stress.survivalRate * 100).toFixed(0)}%`, `Worst=${(stress.worstScenarioProb * 100).toFixed(1)}%`],
    },
    {
      agentId: 'RISK_AUDITOR',
      agentName: councilState.agents.RISK_AUDITOR.agentName,
      stance: stanceOf(riskR2),
      round1Probability: round(riskR1, 4),
      round2Probability: round(riskR2, 4),
      confidence: round(Math.abs(riskR2 - 0.5) * 2, 4),
      hedgeWeightAtDecision: councilState.agents.RISK_AUDITOR.weight,
      rationale: `Bayesian WR ${(bayesStrat * 100).toFixed(1)}% (n=${matching.length}, Wilson low ${(wilson.lower * 100).toFixed(1)}%) vs ${(breakEvenProb * 100).toFixed(1)}% break-even @ ${payoutPct.toFixed(0)}% payout.`,
      keyMetrics: [`BreakEven=${(breakEvenProb * 100).toFixed(1)}%`, `BayesWR=${(bayesStrat * 100).toFixed(1)}%`],
    },
  ];

  const r1Mean = r1Probs.reduce((s, p) => s + p, 0) / r1Probs.length;
  const r2Mean = r2Probs.reduce((s, p) => s + p, 0) / r2Probs.length;

  let weightSum = 0;
  let hedgeWeightedSum = 0;
  for (const v of votes) {
    const w = councilState.agents[v.agentId]?.weight ?? 0.2;
    weightSum += w;
    hedgeWeightedSum += w * v.round2Probability;
  }
  const hedgeWeightedProb = weightSum > 0 ? clamp(hedgeWeightedSum / weightSum, 0.05, 0.95) : r2Mean;

  const variance = r2Probs.reduce((acc, p) => acc + Math.pow(p - r2Mean, 2), 0) / r2Probs.length;
  const disagreementStdDev = Math.sqrt(variance);
  const hedgeExpectedValueUnits = hedgeWeightedProb * (payoutPct / 100) - (1 - hedgeWeightedProb);

  let verdict: MultiAgentDebateResult['verdict'] = 'CAUTION';
  if (hedgeExpectedValueUnits > 0.01 && stress.survivalRate >= 0.6 && disagreementStdDev <= 0.14) {
    verdict = 'APPROVE';
  } else if (hedgeWeightedProb <= breakEvenProb - 0.015 || stress.survivalRate < 0.4) {
    verdict = 'VETO_SHADOW';
  }

  const supportCount = votes.filter((v) => v.stance === 'SUPPORT').length;
  const opposeCount = votes.filter((v) => v.stance === 'OPPOSE').length;
  const consensusSummary =
    `${supportCount}/5 SUPPORT vs ${opposeCount}/5 OPPOSE | Hedge ${(hedgeWeightedProb * 100).toFixed(1)}% ` +
    `(EV ${hedgeExpectedValueUnits >= 0 ? '+' : ''}${hedgeExpectedValueUnits.toFixed(3)}U) | Stress ${stress.scenariosSurvived}/${stress.scenariosTested} -> ${verdict}`;

  return {
    debateVersion: COUNCIL_DEBATE_VERSION,
    evaluatedAtUtc: new Date().toISOString(),
    round1MeanProbability: round(r1Mean, 4),
    round2MeanProbability: round(r2Mean, 4),
    hedgeWeightedProbability: round(hedgeWeightedProb, 4),
    breakEvenProbability: round(breakEvenProb, 4),
    hedgeExpectedValueUnits: round(hedgeExpectedValueUnits, 4),
    disagreementStdDev: round(disagreementStdDev, 4),
    counterfactualSurvivalRate: stress.survivalRate,
    verdict,
    consensusSummary,
    votes,
    challenges,
  };
}

export class MultiAgentCouncilEngine {
  private state: AgentCouncilState;

  constructor() {
    this.state = normalizeCouncilState(db.getAgentCouncilState());
  }

  public getState(): AgentCouncilState {
    return normalizeCouncilState(this.state);
  }

  public evaluateSignalDebate(input: CouncilDebateInput): MultiAgentDebateResult {
    const current = this.getState();
    const result = runMultiAgentDebate(input, current);
    this.state.totalDebatesEvaluated = (this.state.totalDebatesEvaluated || 0) + 1;
    this.state.lastUpdatedAt = new Date().toISOString();
    db.saveAgentCouncilState(this.state);
    return result;
  }

  /**
   * Fixed-Share Multiplicative Weights Update (Hedge) trained causally from
   * frozen prediction-time debate votes once a real WIN/LOSS settles.
   */
  public trainFromSettledSignal(signal: ResearchSignal): {
    trained: boolean;
    duplicateBlocked: boolean;
    skippedReason?: string;
  } {
    if (signal.ruleFamily?.startsWith('test_')) {
      return { trained: false, duplicateBlocked: false, skippedReason: 'TEST_SIGNAL_IGNORED' };
    }
    if (signal.lifecycleState !== 'CLOSED' || (signal.outcomeResult !== 'WIN' && signal.outcomeResult !== 'LOSS')) {
      return { trained: false, duplicateBlocked: false, skippedReason: 'NOT_SETTLED_WIN_LOSS' };
    }
    if (!signal.agentDebate || !Array.isArray(signal.agentDebate.votes) || signal.agentDebate.votes.length === 0) {
      return { trained: false, duplicateBlocked: false, skippedReason: 'MISSING_FROZEN_DEBATE' };
    }
    if (this.state.trainedSignalIds.includes(signal.id)) {
      this.state.duplicateBlocks += 1;
      db.saveAgentCouncilState(this.state);
      return { trained: false, duplicateBlocked: true, skippedReason: 'ALREADY_TRAINED' };
    }

    const y = signal.outcomeResult === 'WIN' ? 1 : 0;
    const eta = this.state.eta || 0.25;
    const alpha = this.state.mixingAlpha || 0.02;
    const prevWeights: Record<DebateAgentRole, number> = {} as any;
    const rawUpdated: Record<DebateAgentRole, number> = {} as any;
    let weightTotal = 0;

    for (const id of AGENT_IDS) {
      const agentState = this.state.agents[id];
      const vote = signal.agentDebate.votes.find((v) => v.agentId === id);
      const p = clamp(vote ? vote.round2Probability : 0.5, 0.05, 0.95);
      prevWeights[id] = agentState.weight;

      const brier = Math.pow(p - y, 2);
      // Normalized binary log-loss relative to coin flip baseline ln(2) so weights adapt cleanly
      const logLoss = -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
      const scaledLoss = clamp(logLoss / Math.log(2), 0, 2.2);

      const predictedWin = p >= signal.agentDebate.breakEvenProbability;
      const wasCorrect = (predictedWin && y === 1) || (!predictedWin && y === 0);

      agentState.observations += 1;
      if (wasCorrect) agentState.correctCalls += 1;
      agentState.cumulativeBrier = round(agentState.cumulativeBrier + brier, 6);
      agentState.cumulativeLogLoss = round(agentState.cumulativeLogLoss + logLoss, 6);
      agentState.lastUpdatedAt = signal.actualExitTimeUtc || new Date().toISOString();

      // Exponential Hedge multiplier
      const wNew = agentState.weight * Math.exp(-eta * scaledLoss);
      rawUpdated[id] = wNew;
      weightTotal += wNew;
    }

    // Attribute challenge accuracy on conceded challenges & warnings
    for (const ch of signal.agentDebate.challenges || []) {
      if (ch.probabilityAdjustment < 0 && this.state.agents[ch.challenger]) {
        this.state.agents[ch.challenger].challengeAttempts += 1;
        // Challenger correctly warned of weakness when trade LOST
        if (y === 0) {
          this.state.agents[ch.challenger].challengeWins += 1;
        }
      }
    }

    // Normalize with Fixed-Share uniform floor so no specialist gets wiped to 0 permanently
    const nAgents = AGENT_IDS.length;
    for (const id of AGENT_IDS) {
      const normalized = weightTotal > 0 ? rawUpdated[id] / weightTotal : 1 / nAgents;
      const mixed = (1 - alpha) * normalized + alpha * (1 / nAgents);
      this.state.agents[id].weight = round(mixed, 6);
      this.state.agents[id].lastWeightDelta = round(mixed - prevWeights[id], 6);
    }

    this.state.trainedSignalIds.push(signal.id);
    if (this.state.trainedSignalIds.length > MAX_TRAINED_COUNCIL_IDS) {
      this.state.trainedSignalIds = this.state.trainedSignalIds.slice(-MAX_TRAINED_COUNCIL_IDS);
    }
    this.state.lastUpdatedAt = new Date().toISOString();
    db.saveAgentCouncilState(this.state);

    return { trained: true, duplicateBlocked: false };
  }

  /**
   * Chronological causal audit replay across all historical signals having agentDebate + WIN/LOSS outcome.
   */
  public computeCouncilBenchmark(signals: ResearchSignal[]): {
    debatedSettledCount: number;
    hedgeAllWinRate: number | null;
    hedgeApproveWinRate: number | null;
    hedgeApproveCount: number;
    hedgeApproveNetUnits: number;
    hedgeVetoedLossAvoidancePct: number | null;
    hedgeVetoedCount: number;
    hedgeBrier: number | null;
    agentLeaderboard: Array<{
      agentId: DebateAgentRole;
      agentName: string;
      weightPct: number;
      observations: number;
      accuracyPct: number | null;
      brierScore: number | null;
      challengeWinRatePct: number | null;
      lastWeightDeltaPct: number;
    }>;
  } {
    const debatedSettled = signals
      .filter(
        (s) =>
          s.lifecycleState === 'CLOSED' &&
          (s.outcomeResult === 'WIN' || s.outcomeResult === 'LOSS') &&
          !s.ruleFamily?.startsWith('test_') &&
          Boolean(s.agentDebate)
      )
      .sort((a, b) => {
        const ta = Date.parse(a.actualExitTimeUtc || a.plannedExitTimeUtc || a.predictionTimeUtc);
        const tb = Date.parse(b.actualExitTimeUtc || b.plannedExitTimeUtc || b.predictionTimeUtc);
        return ta - tb;
      });

    let allWins = 0;
    let approveCount = 0;
    let approveWins = 0;
    let approveUnits = 0;
    let vetoCount = 0;
    let vetoLosses = 0;
    let brierSum = 0;

    for (const sig of debatedSettled) {
      const y = sig.outcomeResult === 'WIN' ? 1 : 0;
      const deb = sig.agentDebate!;
      const p = deb.hedgeWeightedProbability;
      const units = typeof sig.netReturnUnits === 'number' && Number.isFinite(sig.netReturnUnits)
        ? sig.netReturnUnits
        : y === 1
          ? (sig.payoutPct || 80) / 100
          : -1;

      if (y === 1) allWins += 1;
      brierSum += Math.pow(p - y, 2);

      if (deb.verdict === 'APPROVE') {
        approveCount += 1;
        if (y === 1) approveWins += 1;
        approveUnits += units;
      } else if (deb.verdict === 'VETO_SHADOW') {
        vetoCount += 1;
        if (y === 0) vetoLosses += 1;
      }
    }

    const state = this.getState();
    const agentLeaderboard = AGENT_IDS.map((id) => {
      const a = state.agents[id];
      return {
        agentId: id,
        agentName: a.agentName,
        weightPct: round(a.weight * 100, 2),
        observations: a.observations,
        accuracyPct: a.observations > 0 ? round((a.correctCalls / a.observations) * 100, 2) : null,
        brierScore: a.observations > 0 ? round(a.cumulativeBrier / a.observations, 4) : null,
        challengeWinRatePct: a.challengeAttempts > 0 ? round((a.challengeWins / a.challengeAttempts) * 100, 2) : null,
        lastWeightDeltaPct: round(a.lastWeightDelta * 100, 2),
      };
    }).sort((x, y) => y.weightPct - x.weightPct);

    return {
      debatedSettledCount: debatedSettled.length,
      hedgeAllWinRate: debatedSettled.length > 0 ? round((allWins / debatedSettled.length) * 100, 2) : null,
      hedgeApproveWinRate: approveCount > 0 ? round((approveWins / approveCount) * 100, 2) : null,
      hedgeApproveCount: approveCount,
      hedgeApproveNetUnits: round(approveUnits, 2),
      hedgeVetoedLossAvoidancePct: vetoCount > 0 ? round((vetoLosses / vetoCount) * 100, 2) : null,
      hedgeVetoedCount: vetoCount,
      hedgeBrier: debatedSettled.length > 0 ? round(brierSum / debatedSettled.length, 5) : null,
      agentLeaderboard,
    };
  }
}

export const multiAgentCouncil = new MultiAgentCouncilEngine();
