/**
 * SignalForge ML — Institutional Portfolio Risk, Kelly Sizing & Promotion Engine
 *
 * Implements institutional-desk risk analytics & sizing:
 * 1. Fractional Quarter-Kelly binary sizing with trailing drawdown de-leveraging.
 * 2. 8-Currency Factor Exposure decomposition & active trade correlation heat.
 * 3. Portfolio Risk-Adjusted Return Metrics: Sharpe, Sortino, Profit Factor, Max DD & 95% CVaR.
 * 4. Automated Statistical Promotion Gate comparing Legacy vs. Shadow Calibrator vs. 5-Agent Council.
 */

import {
  Candle,
  ForexSymbol,
  InstitutionalSignalRiskAudit,
  ResearchSignal,
  SignalDirection,
} from '../types/index.js';
import { computeBreakEvenProbability, evaluateShadowCandidateChronologically, wilsonInterval } from './shadowPredictor.js';
import {
  CurrencyStrengthSnapshot,
  evaluateMultiTimeframeAlignment,
  getDirectionalStrengthSpread,
  MAJOR_CURRENCIES,
  MajorCurrency,
} from './quantMicrostructure.js';
import { multiAgentCouncil } from './multiAgentCouncil.js';

export interface CurrencyExposureRow {
  currency: MajorCurrency;
  netExposureUnits: number; // + long count, - short count across open trades
  longCount: number;
  shortCount: number;
  openPairs: string[];
}

export interface InstitutionalPortfolioStats {
  settledCount: number;
  wins: number;
  losses: number;
  scratches: number;
  winRatePct: number | null;
  wilson95LowerPct: number | null;
  wilson95UpperPct: number | null;
  netReturnUnits: number;
  expectancyUnitsPerTrade: number;
  profitFactor: number;
  sharpePerTrade: number;
  sortinoPerTrade: number;
  maxDrawdownUnits: number;
  currentDrawdownUnits: number;
  var95Units: number;
  cvar95Units: number;
  longestWinStreak: number;
  longestLossStreak: number;
  drawdownMode: 'NORMAL' | 'CAUTION_HALF' | 'DEFENSE_QUARTER';
  drawdownThrottleFactor: number;
}

export interface PromotionCandidateGate {
  candidateName: string;
  sampleCount: number;
  minRequiredSamples: number;
  winRatePct: number | null;
  wilson95LowerPct: number | null;
  breakEvenPct: number;
  brierScore: number | null;
  brierSkillVsPrevalence: number | null;
  ece: number | null;
  netReturnUnits: number;
  checks: {
    hasMinSample: boolean;
    beatsBreakEvenOnWilsonLower: boolean;
    positiveNetUnits: boolean;
    positiveBrierSkill: boolean;
  };
  progressPct: number;
  status: 'READY_FOR_PROMOTION' | 'COLLECTING_EVIDENCE' | 'INSUFFICIENT_EDGE';
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function round(v: number, digits = 3): number {
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

/**
 * Compute fractional Kelly & institutional portfolio statistics on real settled outcomes.
 */
export function computePortfolioStatistics(signals: ResearchSignal[]): InstitutionalPortfolioStats {
  const settled = signals
    .filter(
      (s) =>
        s.lifecycleState === 'CLOSED' &&
        (s.outcomeResult === 'WIN' || s.outcomeResult === 'LOSS' || s.outcomeResult === 'SCRATCH') &&
        !s.ruleFamily?.startsWith('test_')
    )
    .sort((a, b) => {
      const ta = Date.parse(a.actualExitTimeUtc || a.plannedExitTimeUtc || a.predictionTimeUtc);
      const tb = Date.parse(b.actualExitTimeUtc || b.plannedExitTimeUtc || b.predictionTimeUtc);
      return ta - tb;
    });

  let wins = 0;
  let losses = 0;
  let scratches = 0;
  let grossWinUnits = 0;
  let grossLossAbsUnits = 0;
  let equity = 0;
  let peakEquity = 0;
  let maxDrawdownUnits = 0;
  let curWinStreak = 0;
  let curLossStreak = 0;
  let longestWinStreak = 0;
  let longestLossStreak = 0;

  const returns: number[] = [];

  for (const sig of settled) {
    const u =
      typeof sig.netReturnUnits === 'number' && Number.isFinite(sig.netReturnUnits)
        ? sig.netReturnUnits
        : sig.outcomeResult === 'WIN'
          ? (sig.payoutPct || 80) / 100
          : sig.outcomeResult === 'LOSS'
            ? -1
            : 0;

    returns.push(u);
    equity += u;
    if (equity > peakEquity) peakEquity = equity;
    const dd = peakEquity - equity;
    if (dd > maxDrawdownUnits) maxDrawdownUnits = dd;

    if (sig.outcomeResult === 'WIN') {
      wins += 1;
      grossWinUnits += Math.max(0, u);
      curWinStreak += 1;
      curLossStreak = 0;
      longestWinStreak = Math.max(longestWinStreak, curWinStreak);
    } else if (sig.outcomeResult === 'LOSS') {
      losses += 1;
      grossLossAbsUnits += Math.abs(Math.min(0, u));
      curLossStreak += 1;
      curWinStreak = 0;
      longestLossStreak = Math.max(longestLossStreak, curLossStreak);
    } else {
      scratches += 1;
    }
  }

  const scoredCount = wins + losses;
  const wilson = wilsonInterval(wins, scoredCount);
  const currentDrawdownUnits = Math.max(0, peakEquity - equity);

  // Per-trade Sharpe & Sortino
  const n = returns.length;
  const meanR = n > 0 ? equity / n : 0;
  const variance = n > 1 ? returns.reduce((acc, r) => acc + Math.pow(r - meanR, 2), 0) / (n - 1) : 0;
  const stdDev = Math.sqrt(variance);
  const downsideReturns = returns.filter((r) => r < 0);
  const downsideVar =
    downsideReturns.length > 0
      ? downsideReturns.reduce((acc, r) => acc + r * r, 0) / Math.max(1, n)
      : 0;
  const downsideDev = Math.sqrt(downsideVar);

  const sharpePerTrade = stdDev > 1e-6 ? meanR / stdDev : 0;
  const sortinoPerTrade = downsideDev > 1e-6 ? meanR / downsideDev : meanR > 0 ? 1.5 : 0;

  // Historical VaR & CVaR at 95% confidence (tail losses per trade in Units)
  const sortedAsc = [...returns].sort((a, b) => a - b);
  const varIdx = n > 0 ? Math.max(0, Math.floor(n * 0.05)) : 0;
  const var95Units = n > 0 ? Math.abs(Math.min(0, sortedAsc[varIdx])) : 0;
  const tailSlice = sortedAsc.slice(0, Math.max(1, varIdx + 1));
  const cvar95Units =
    tailSlice.length > 0
      ? Math.abs(Math.min(0, tailSlice.reduce((s, r) => s + r, 0) / tailSlice.length))
      : 0;

  // Trailing 20-trade drawdown de-leveraging guard
  const trailing20Units = returns.slice(-20).reduce((a, b) => a + b, 0);
  let drawdownMode: InstitutionalPortfolioStats['drawdownMode'] = 'NORMAL';
  let drawdownThrottleFactor = 1.0;
  if (trailing20Units <= -6.0 || currentDrawdownUnits >= 8.0) {
    drawdownMode = 'DEFENSE_QUARTER';
    drawdownThrottleFactor = 0.25;
  } else if (trailing20Units <= -3.0 || currentDrawdownUnits >= 4.0) {
    drawdownMode = 'CAUTION_HALF';
    drawdownThrottleFactor = 0.5;
  }

  return {
    settledCount: settled.length,
    wins,
    losses,
    scratches,
    winRatePct: scoredCount > 0 ? round((wins / scoredCount) * 100, 2) : null,
    wilson95LowerPct: scoredCount > 0 ? round(wilson.lower * 100, 2) : null,
    wilson95UpperPct: scoredCount > 0 ? round(wilson.upper * 100, 2) : null,
    netReturnUnits: round(equity, 2),
    expectancyUnitsPerTrade: n > 0 ? round(meanR, 4) : 0,
    profitFactor: grossLossAbsUnits > 0 ? round(grossWinUnits / grossLossAbsUnits, 2) : grossWinUnits > 0 ? 9.99 : 0,
    sharpePerTrade: round(sharpePerTrade, 3),
    sortinoPerTrade: round(sortinoPerTrade, 3),
    maxDrawdownUnits: round(maxDrawdownUnits, 2),
    currentDrawdownUnits: round(currentDrawdownUnits, 2),
    var95Units: round(var95Units, 3),
    cvar95Units: round(cvar95Units, 3),
    longestWinStreak,
    longestLossStreak,
    drawdownMode,
    drawdownThrottleFactor,
  };
}

/**
 * Decompose active/in-flight signals into per-currency directional factor exposure.
 */
export function computeFactorExposureMatrix(openSignals: ResearchSignal[]): CurrencyExposureRow[] {
  const map: Record<MajorCurrency, CurrencyExposureRow> = {} as any;
  for (const cur of MAJOR_CURRENCIES) {
    map[cur] = {
      currency: cur,
      netExposureUnits: 0,
      longCount: 0,
      shortCount: 0,
      openPairs: [],
    };
  }

  for (const sig of openSignals) {
    if (!['WAITING_FOR_ENTRY', 'ENTRY_TRIGGERED', 'ACTIVE'].includes(sig.lifecycleState)) continue;
    const [base, quote] = (sig.symbol || '').split('/') as [MajorCurrency, MajorCurrency];
    if (!map[base] || !map[quote]) continue;

    const dirSign = sig.direction === 'BUY' ? 1 : -1;
    map[base].netExposureUnits += dirSign;
    map[quote].netExposureUnits -= dirSign;
    if (dirSign > 0) {
      map[base].longCount += 1;
      map[quote].shortCount += 1;
    } else {
      map[base].shortCount += 1;
      map[quote].longCount += 1;
    }
    map[base].openPairs.push(`${sig.symbol} ${sig.direction}`);
    map[quote].openPairs.push(`${sig.symbol} ${sig.direction}`);
  }

  return MAJOR_CURRENCIES.map((c) => map[c]).sort(
    (a, b) => Math.abs(b.netExposureUnits) - Math.abs(a.netExposureUnits)
  );
}

/**
 * Compute per-signal institutional Kelly stake %, correlation heat, MTF alignment, and macro strength spread.
 */
export function evaluateInstitutionalSignalRisk(params: {
  symbol: ForexSymbol;
  direction: SignalDirection;
  payoutPct?: number;
  modelProbability: number;
  predictionHistory: readonly Candle[];
  predictionCandleTimestampMs: number;
  openSignals: ResearchSignal[];
  allSignals: ResearchSignal[];
  currencyStrengthSnapshot: CurrencyStrengthSnapshot | null;
}): InstitutionalSignalRiskAudit {
  const payoutPctUsed =
    typeof params.payoutPct === 'number' && Number.isFinite(params.payoutPct) && params.payoutPct > 0
      ? params.payoutPct
      : 80;
  const breakEvenProbability = computeBreakEvenProbability(payoutPctUsed);
  const b = payoutPctUsed / 100;
  const p = clamp(Number.isFinite(params.modelProbability) ? params.modelProbability : 0.5, 0.05, 0.95);

  const rawFullKelly = (p * (b + 1) - 1) / Math.max(0.1, b);
  const fullKellyPct = rawFullKelly > 0 ? round(clamp(rawFullKelly * 100, 0, 25), 2) : 0;
  const quarterKellyRaw = rawFullKelly > 0 ? clamp(rawFullKelly * 0.25 * 100, 0, 3.0) : 0;

  const portfolioStats = computePortfolioStatistics(params.allSignals);
  const suggestedStakePct = round(quarterKellyRaw * portfolioStats.drawdownThrottleFactor, 2);

  const mtf = evaluateMultiTimeframeAlignment(
    params.symbol,
    params.direction,
    params.predictionHistory,
    params.predictionCandleTimestampMs
  );
  const strengthSpread = getDirectionalStrengthSpread(
    params.symbol,
    params.direction,
    params.currencyStrengthSnapshot
  );

  // Measure shared directional currency factor count across active trades
  const exposure = computeFactorExposureMatrix(params.openSignals);
  const [base, quote] = params.symbol.split('/') as [MajorCurrency, MajorCurrency];
  const dirSign = params.direction === 'BUY' ? 1 : -1;
  const baseRow = exposure.find((r) => r.currency === base);
  const quoteRow = exposure.find((r) => r.currency === quote);
  const sameBaseLoad = baseRow && Math.sign(baseRow.netExposureUnits) === dirSign ? Math.abs(baseRow.netExposureUnits) : 0;
  const sameQuoteLoad = quoteRow && Math.sign(quoteRow.netExposureUnits) === -dirSign ? Math.abs(quoteRow.netExposureUnits) : 0;
  const sameFactorOpenCount = Math.max(sameBaseLoad, sameQuoteLoad);

  const correlationRiskLevel: InstitutionalSignalRiskAudit['correlationRiskLevel'] =
    sameFactorOpenCount >= 2 ? 'HIGH' : sameFactorOpenCount === 1 ? 'MODERATE' : 'LOW';

  const riskNotes: string[] = [];
  if (p <= breakEvenProbability) {
    riskNotes.push(`Zero Kelly edge: calibrated p=${(p * 100).toFixed(1)}% <= break-even ${(breakEvenProbability * 100).toFixed(1)}%`);
  }
  if (correlationRiskLevel === 'HIGH') {
    riskNotes.push(`High factor correlation: ${sameFactorOpenCount} active positions already stacked on ${base}/${quote} direction`);
  }
  if (mtf.alignmentScore < -0.25) {
    riskNotes.push(`Counter-HTF setup: M5 (${mtf.m5TrendBias}) / M15 (${mtf.m15TrendBias}) oppose trade direction`);
  }
  if (portfolioStats.drawdownThrottleFactor < 1.0) {
    riskNotes.push(`Portfolio drawdown throttle active (${portfolioStats.drawdownThrottleFactor}x sizing)`);
  }

  return {
    evaluatedAtUtc: new Date().toISOString(),
    payoutPctUsed: round(payoutPctUsed, 2),
    breakEvenProbability: round(breakEvenProbability, 4),
    probabilityUsed: round(p, 4),
    fullKellyPct,
    quarterKellyPct: round(quarterKellyRaw, 2),
    suggestedStakePct,
    drawdownThrottleFactor: portfolioStats.drawdownThrottleFactor,
    m5TrendBias: mtf.m5TrendBias,
    m15TrendBias: mtf.m15TrendBias,
    mtfAlignmentScore: mtf.alignmentScore,
    currencyStrengthSpread: strengthSpread,
    sameFactorOpenCount,
    correlationRiskLevel,
    riskNotes,
  };
}

/**
 * Evaluate automated Shadow-to-Live promotion readiness across Shadow Calibrator & 5-Agent Council.
 */
export function evaluatePromotionReadiness(signals: ResearchSignal[]): {
  minRequiredSamples: number;
  breakEvenAt80Pct: number;
  shadowCalibrator: PromotionCandidateGate;
  agentCouncil: PromotionCandidateGate;
} {
  const MIN_SAMPLES = 100;
  const BREAK_EVEN_80 = 55.56;

  const bench = evaluateShadowCandidateChronologically(signals);
  const sAcc = bench.shadowAccepted;
  const sWilLow = sAcc.sampleCount > 0 ? round(sAcc.ci95Low * 100, 2) : null;
  const sChecks = {
    hasMinSample: sAcc.sampleCount >= MIN_SAMPLES,
    beatsBreakEvenOnWilsonLower: sWilLow !== null && sWilLow >= BREAK_EVEN_80,
    positiveNetUnits: sAcc.netReturnUnits > 0,
    positiveBrierSkill: bench.shadowAll.sampleCount > 0 && bench.shadowAll.brierSkillVsPrevalence > 0,
  };
  const sStatus: PromotionCandidateGate['status'] =
    sChecks.hasMinSample && sChecks.beatsBreakEvenOnWilsonLower && sChecks.positiveNetUnits && sChecks.positiveBrierSkill
      ? 'READY_FOR_PROMOTION'
      : sAcc.sampleCount < MIN_SAMPLES
        ? 'COLLECTING_EVIDENCE'
        : 'INSUFFICIENT_EDGE';

  const councilBench = multiAgentCouncil.computeCouncilBenchmark(signals);
  const councilApproveSignals = signals.filter(
    (s) =>
      s.lifecycleState === 'CLOSED' &&
      (s.outcomeResult === 'WIN' || s.outcomeResult === 'LOSS') &&
      !s.ruleFamily?.startsWith('test_') &&
      s.agentDebate?.verdict === 'APPROVE'
  );
  const cWins = councilApproveSignals.filter((s) => s.outcomeResult === 'WIN').length;
  const cTotal = councilApproveSignals.length;
  const cWilson = wilsonInterval(cWins, cTotal);
  const cWilLow = cTotal > 0 ? round(cWilson.lower * 100, 2) : null;
  const cBrierSkill =
    councilBench.hedgeBrier !== null && bench.baselineAll.prevalenceBrierBaseline > 0
      ? round(1 - councilBench.hedgeBrier / bench.baselineAll.prevalenceBrierBaseline, 4)
      : null;

  const cChecks = {
    hasMinSample: cTotal >= MIN_SAMPLES,
    beatsBreakEvenOnWilsonLower: cWilLow !== null && cWilLow >= BREAK_EVEN_80,
    positiveNetUnits: councilBench.hedgeApproveNetUnits > 0,
    positiveBrierSkill: cBrierSkill !== null && cBrierSkill > 0,
  };
  const cStatus: PromotionCandidateGate['status'] =
    cChecks.hasMinSample && cChecks.beatsBreakEvenOnWilsonLower && cChecks.positiveNetUnits && cChecks.positiveBrierSkill
      ? 'READY_FOR_PROMOTION'
      : cTotal < MIN_SAMPLES
        ? 'COLLECTING_EVIDENCE'
        : 'INSUFFICIENT_EDGE';

  return {
    minRequiredSamples: MIN_SAMPLES,
    breakEvenAt80Pct: BREAK_EVEN_80,
    shadowCalibrator: {
      candidateName: 'Shadow Calibrator (shadow-cal-v1.0)',
      sampleCount: sAcc.sampleCount,
      minRequiredSamples: MIN_SAMPLES,
      winRatePct: sAcc.sampleCount > 0 ? round(sAcc.winRate * 100, 2) : null,
      wilson95LowerPct: sWilLow,
      breakEvenPct: BREAK_EVEN_80,
      brierScore: bench.shadowAll.sampleCount > 0 ? bench.shadowAll.brierScore : null,
      brierSkillVsPrevalence: bench.shadowAll.sampleCount > 0 ? bench.shadowAll.brierSkillVsPrevalence : null,
      ece: bench.shadowAll.sampleCount > 0 ? bench.shadowAll.ece : null,
      netReturnUnits: round(sAcc.netReturnUnits, 2),
      checks: sChecks,
      progressPct: round(clamp((sAcc.sampleCount / MIN_SAMPLES) * 100, 0, 100), 1),
      status: sStatus,
    },
    agentCouncil: {
      candidateName: '5-Agent Adversarial Council (Hedge MWU)',
      sampleCount: cTotal,
      minRequiredSamples: MIN_SAMPLES,
      winRatePct: councilBench.hedgeApproveWinRate,
      wilson95LowerPct: cWilLow,
      breakEvenPct: BREAK_EVEN_80,
      brierScore: councilBench.hedgeBrier,
      brierSkillVsPrevalence: cBrierSkill,
      ece: null,
      netReturnUnits: councilBench.hedgeApproveNetUnits,
      checks: cChecks,
      progressPct: round(clamp((cTotal / MIN_SAMPLES) * 100, 0, 100), 1),
      status: cStatus,
    },
  };
}
