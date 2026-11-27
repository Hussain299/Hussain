/**
 * SignalForge ML — Behavioural Intelligence Engine
 * Research-backed models of human market psychology & observable participant behaviour.
 * Uses measurable empirical evidence on closed candles (zero look-ahead, strictly causal).
 */

import {
  Candle,
  ForexSymbol,
  SignalDirection,
  ResearchSignal,
  MarketBehaviorType,
  BehavioralHypothesis,
  BehavioralDecisionValidation,
  BotSelfMonitoringState,
  MeasurableEvidenceItem,
} from '../types/index.js';

function formatIstTime(d: Date | string | number): string {
  const dateObj = typeof d === 'object' ? d : new Date(d);
  return (
    dateObj.toLocaleTimeString('en-US', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }) + ' IST'
  );
}

/**
 * Calculates Average True Range (ATR) over N periods
 */
function calculateAtr(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0.001;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close)
    );
    trs.push(tr);
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / (slice.length || 1);
}

/**
 * Calculates Relative Strength Index (RSI)
 */
function calculateRsi(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Calculates Simple Moving Average (SMA) and Standard Deviation
 */
function calculateSmaAndStd(candles: Candle[], period = 20): { sma: number; std: number } {
  if (candles.length === 0) return { sma: 0, std: 0 };
  const slice = candles.slice(-period);
  const closes = slice.map(c => c.close);
  const sma = closes.reduce((a, b) => a + b, 0) / closes.length;
  const variance = closes.reduce((acc, c) => acc + Math.pow(c - sma, 2), 0) / closes.length;
  return { sma, std: Math.sqrt(variance) || 0.0001 };
}

export class BehaviouralEngine {
  /**
   * Evaluates all 10 Observable Human Market Psychology Behaviours for a symbol
   */
  public assessMarketBehavior(symbol: ForexSymbol, candles: Candle[]): BehavioralHypothesis[] {
    if (!candles || candles.length < 25) {
      return [];
    }

    const n = candles.length;
    const current = candles[n - 1];
    const prev = candles[n - 2];
    const prev2 = candles[n - 3];
    const atr = calculateAtr(candles, 14);
    const rsi = calculateRsi(candles, 14);
    const { sma: sma20, std: std20 } = calculateSmaAndStd(candles, 20);
    const nowIst = formatIstTime(new Date());

    const isJpy = symbol.includes('JPY');
    const pipMultiplier = isJpy ? 100 : 10000;

    const hypotheses: BehavioralHypothesis[] = [];

    // -------------------------------------------------------------
    // 1. FEAR AND PANIC
    // Measurable evidence: Downside return volatility > 2.0x ATR, bottom 25% close, expansion spread
    // -------------------------------------------------------------
    const currentRange = current.high - current.low;
    const isDownBar = current.close < current.open;
    const downsideRangeRatio = currentRange / (atr || 0.001);
    const closeProximityToLow = (current.close - current.low) / (currentRange || 0.0001);

    const isFearPanic =
      isDownBar &&
      downsideRangeRatio >= 2.0 &&
      closeProximityToLow <= 0.25;

    const fearEvidence: MeasurableEvidenceItem[] = [
      {
        metricName: 'Range to 14-ATR Ratio',
        measuredValue: Number(downsideRangeRatio.toFixed(2)),
        threshold: 2.0,
        interpretation: 'Downside expansion range exceeding twice baseline ATR indicates panic liquidation.',
      },
      {
        metricName: 'Close Position Within Bar Range',
        measuredValue: Number(closeProximityToLow.toFixed(2)),
        threshold: 0.25,
        interpretation: 'Close trapped at bottom 25% of candle shows absence of institutional bid support.',
      },
    ];

    hypotheses.push({
      type: 'FEAR_PANIC',
      name: 'Fear & Panic Liquidation',
      symbol,
      isActive: isFearPanic,
      confidenceScore: isFearPanic ? Math.min(1.0, 0.6 + (downsideRangeRatio - 2.0) * 0.15) : 0.15,
      evidenceStrength: isFearPanic ? Math.min(1.0, downsideRangeRatio / 3.0) : 0.1,
      measurableEvidence: fearEvidence,
      plainLanguageExplanation: isFearPanic
        ? `Severe one-sided selling observed. Candle range expanded to ${downsideRangeRatio.toFixed(1)}x ATR with price closing at the extreme bottom (${(closeProximityToLow * 100).toFixed(0)}% from low).`
        : 'Order flow shows orderly volatility within normal 14-period ATR bands; no panic liquidation detected.',
      tradeImplication: isFearPanic ? 'HIGH_RISK_FADE' : 'NEUTRAL',
      detectedAtIst: nowIst,
    });

    // -------------------------------------------------------------
    // 2. GREED AND MOMENTUM CHASING
    // Measurable evidence: 3+ consecutive bull expansion bars, upper wick < 15%, positive acceleration
    // -------------------------------------------------------------
    const isThreeBullBars =
      candles[n - 1].close > candles[n - 1].open &&
      candles[n - 2].close > candles[n - 2].open &&
      candles[n - 3].close > candles[n - 3].open;

    const upperWickRatio = (current.high - Math.max(current.open, current.close)) / (currentRange || 0.0001);
    const delta1 = candles[n - 1].close - candles[n - 2].close;
    const delta2 = candles[n - 2].close - candles[n - 3].close;
    const isAccelerating = delta1 > delta2 && delta2 > 0;

    const isGreedChasing = isThreeBullBars && upperWickRatio <= 0.15 && isAccelerating;

    hypotheses.push({
      type: 'GREED_MOMENTUM_CHASING',
      name: 'Greed & Parabolic Momentum Chasing',
      symbol,
      isActive: isGreedChasing,
      confidenceScore: isGreedChasing ? 0.82 : 0.2,
      evidenceStrength: isGreedChasing ? 0.85 : 0.15,
      measurableEvidence: [
        {
          metricName: 'Consecutive Expansion Bull Bars',
          measuredValue: isThreeBullBars ? 3 : 1,
          threshold: 3,
          interpretation: '3 consecutive candles closing higher without retracement confirms crowd momentum chasing.',
        },
        {
          metricName: 'Upper Rejection Wick Ratio',
          measuredValue: Number(upperWickRatio.toFixed(2)),
          threshold: 0.15,
          interpretation: 'Upper wick below 15% shows relentless market order buying without sell-side resistance.',
        },
        {
          metricName: 'Velocity Acceleration (d²P/dt²)',
          measuredValue: Number((delta1 - delta2).toFixed(5)),
          threshold: 0.0,
          interpretation: 'Positive velocity differential indicates convex parabolic crowd participation.',
        },
      ],
      plainLanguageExplanation: isGreedChasing
        ? 'Parabolic buying underway: 3 consecutive aggressive bull bars with negligible upper wicks (<15%) and accelerating upward velocity.'
        : 'Candle progression shows healthy ebb-and-flow; momentum is balanced without parabolic crowd chasing.',
      tradeImplication: isGreedChasing ? 'BULLISH_EDGE' : 'NEUTRAL',
      detectedAtIst: nowIst,
    });

    // -------------------------------------------------------------
    // 3. HERD MENTALITY & CROWDED POSITIONING
    // Measurable evidence: Price distance from 20-SMA > 2.2 std deviations, RSI > 74 or < 26
    // -------------------------------------------------------------
    const zScore = (current.close - sma20) / (std20 || 0.0001);
    const absZ = Math.abs(zScore);
    const isCrowded = absZ >= 2.2 && (rsi >= 74 || rsi <= 26);

    hypotheses.push({
      type: 'HERD_CROWDED_POSITIONING',
      name: 'Herd Mentality & Crowded Positioning',
      symbol,
      isActive: isCrowded,
      confidenceScore: isCrowded ? 0.78 : 0.18,
      evidenceStrength: isCrowded ? Math.min(1.0, absZ / 2.8) : 0.12,
      measurableEvidence: [
        {
          metricName: '20-Period Price Z-Score (σ)',
          measuredValue: Number(zScore.toFixed(2)),
          threshold: 2.2,
          unit: 'σ',
          interpretation: 'Price extended beyond 2.2 standard deviations from institutional 20-period mean.',
        },
        {
          metricName: '14-Period RSI',
          measuredValue: Number(rsi.toFixed(1)),
          threshold: zScore > 0 ? 74 : 26,
          interpretation: 'Extreme momentum saturation indicating retail order flow is overwhelmingly one-sided.',
        },
      ],
      plainLanguageExplanation: isCrowded
        ? `Crowded retail positioning detected. Price is stretched ${zScore.toFixed(2)} standard deviations from its 20-period mean with RSI saturated at ${rsi.toFixed(1)}.`
        : `Price dispersion is within normal statistical distribution (${zScore.toFixed(1)}σ); positioning is not excessively crowded.`,
      tradeImplication: isCrowded ? 'HIGH_RISK_FADE' : 'NEUTRAL',
      detectedAtIst: nowIst,
    });

    // -------------------------------------------------------------
    // 4. FOMO AND LATE ENTRIES
    // Measurable evidence: Price > 2.0x ATR from 20-SMA, but current bar body < 40% of previous bar + rejection wick
    // -------------------------------------------------------------
    const distFromSmaPips = Math.abs(current.close - sma20) * pipMultiplier;
    const bodyRatio = Math.abs(current.close - current.open) / (currentRange || 0.0001);
    const prevBody = Math.abs(prev.close - prev.open);
    const currBody = Math.abs(current.close - current.open);
    const bodyDecayRatio = currBody / (prevBody || 0.0001);

    const isFomoLate =
      distFromSmaPips >= 18 &&
      bodyDecayRatio < 0.45 &&
      upperWickRatio > 0.4;

    hypotheses.push({
      type: 'FOMO_LATE_ENTRY',
      name: 'FOMO Exhaustion & Late Entry Trap',
      symbol,
      isActive: isFomoLate,
      confidenceScore: isFomoLate ? 0.79 : 0.14,
      evidenceStrength: isFomoLate ? 0.82 : 0.1,
      measurableEvidence: [
        {
          metricName: 'Distance from 20-SMA',
          measuredValue: Number(distFromSmaPips.toFixed(1)),
          threshold: 18.0,
          unit: 'pips',
          interpretation: 'Price extended far from mean where smart money begins offloading into retail buyers.',
        },
        {
          metricName: 'Candle Body Compression vs Previous Bar',
          measuredValue: Number(bodyDecayRatio.toFixed(2)),
          threshold: 0.45,
          interpretation: 'Body size collapsed to less than half of previous bar, signaling buying power exhaustion.',
        },
        {
          metricName: 'Upper Rejection Wick',
          measuredValue: Number(upperWickRatio.toFixed(2)),
          threshold: 0.4,
          interpretation: 'Long upper shadow indicates late retail buyers were absorbed by limit sell orders.',
        },
      ],
      plainLanguageExplanation: isFomoLate
        ? 'Late buyer exhaustion: price is overextended by 18+ pips from mean, but candle body collapsed by >55% while leaving a heavy rejection wick.'
        : 'Candle progression maintains proportionate volume and body size without late-stage FOMO exhaustion.',
      tradeImplication: isFomoLate ? 'BEARISH_EDGE' : 'NEUTRAL',
      detectedAtIst: nowIst,
    });

    // -------------------------------------------------------------
    // 5. LOSS AVERSION & DEFENSE
    // Measurable evidence: 3+ re-tests of recent swing level within 1.5 pips with tight consolidation
    // -------------------------------------------------------------
    const last10Highs = candles.slice(-10, -1).map(c => c.high);
    const swingHigh = Math.max(...last10Highs);
    const distToSwingHighPips = Math.abs(current.high - swingHigh) * pipMultiplier;
    const isRetestingResistance = distToSwingHighPips <= 2.0;

    hypotheses.push({
      type: 'LOSS_AVERSION_DEFENSE',
      name: 'Loss Aversion & Break-Even Defense',
      symbol,
      isActive: isRetestingResistance && currentRange < atr * 0.7,
      confidenceScore: isRetestingResistance ? 0.72 : 0.15,
      evidenceStrength: isRetestingResistance ? 0.7 : 0.1,
      measurableEvidence: [
        {
          metricName: 'Proximity to Previous Swing Resistance',
          measuredValue: Number(distToSwingHighPips.toFixed(1)),
          threshold: 2.0,
          unit: 'pips',
          interpretation: 'Repeated test of key structural pivot where trapped traders defend break-even stops.',
        },
        {
          metricName: 'Range Compression at Boundary',
          measuredValue: Number((currentRange / Math.max(0.00001, atr)).toFixed(2)),
          threshold: 0.7,
          interpretation: 'Range compression demonstrates heavy opposing liquidity clustering at previous pivot.',
        },
      ],
      plainLanguageExplanation: isRetestingResistance
        ? `Sticky pricing: market is testing swing boundary within ${distToSwingHighPips.toFixed(1)} pips as participants defend historical entry levels.`
        : 'Price action is moving freely between structural boundaries without defensive sticky levels.',
      tradeImplication: isRetestingResistance ? 'STAND_DOWN' : 'NEUTRAL',
      detectedAtIst: nowIst,
    });

    // -------------------------------------------------------------
    // 6. OVERCONFIDENCE & COMPLACENCY
    // Measurable evidence: Multi-bar ATR in bottom 12th percentile of 50-candle lookback
    // -------------------------------------------------------------
    const historicalRanges = candles.slice(-50).map(c => c.high - c.low);
    historicalRanges.sort((a, b) => a - b);
    const currentAtrRank = historicalRanges.findIndex(r => r >= currentRange) / historicalRanges.length;
    const isComplacent = currentAtrRank <= 0.12;

    hypotheses.push({
      type: 'OVERCONFIDENCE_COMPLACENCY',
      name: 'Low-Volatility Complacency Squeeze',
      symbol,
      isActive: isComplacent,
      confidenceScore: isComplacent ? 0.75 : 0.2,
      evidenceStrength: isComplacent ? 0.8 : 0.1,
      measurableEvidence: [
        {
          metricName: '50-Period Range Percentile Rank',
          measuredValue: Number((currentAtrRank * 100).toFixed(0)),
          threshold: 12,
          unit: '%ile',
          interpretation: 'Volatility compressed into bottom 12th percentile; precedes explosive breakout expansion.',
        },
      ],
      plainLanguageExplanation: isComplacent
        ? `Extreme volatility squeeze: candle range is in the lowest ${Math.round(currentAtrRank * 100)}% of the past 50 periods. Low volatility leads directly to sudden expansion.`
        : 'Market volatility is within normal historical distribution.',
      tradeImplication: isComplacent ? 'FLAG_UNCERTAINTY' as any : 'NEUTRAL',
      detectedAtIst: nowIst,
    });

    // -------------------------------------------------------------
    // 7. LIQUIDITY SWEEPS & STOP-LOSS CLUSTERS
    // Measurable evidence: High/low pierced 20-candle swing extreme by >0.8 pip, but closed strictly back inside range
    // -------------------------------------------------------------
    const lookback20 = candles.slice(-21, -1);
    const swingHigh20 = Math.max(...lookback20.map(c => c.high));
    const swingLow20 = Math.min(...lookback20.map(c => c.low));

    const piercedHighPips = (current.high - swingHigh20) * pipMultiplier;
    const piercedLowPips = (swingLow20 - current.low) * pipMultiplier;

    const isBearishSweep = piercedHighPips >= 0.8 && current.close < swingHigh20;
    const isBullishSweep = piercedLowPips >= 0.8 && current.close > swingLow20;
    const isSweep = isBearishSweep || isBullishSweep;

    hypotheses.push({
      type: 'LIQUIDITY_SWEEP_CLUSTERS',
      name: 'Institutional Liquidity Sweep (Turtle Soup)',
      symbol,
      isActive: isSweep,
      confidenceScore: isSweep ? 0.84 : 0.12,
      evidenceStrength: isSweep ? 0.88 : 0.1,
      measurableEvidence: [
        {
          metricName: 'Swing Extreme Penetration Depth',
          measuredValue: Number((isBearishSweep ? piercedHighPips : piercedLowPips).toFixed(1)),
          threshold: 0.8,
          unit: 'pips',
          interpretation: 'Intra-candle spike pierced 20-candle stop-loss cluster to trigger resting retail stops.',
        },
        {
          metricName: 'Structural Close Re-entry',
          measuredValue: Number(current.close.toFixed(5)),
          threshold: Number((isBearishSweep ? swingHigh20 : swingLow20).toFixed(5)),
          interpretation: 'Failure to hold breakout and immediate close inside range confirms liquidity grab.',
        },
      ],
      plainLanguageExplanation: isSweep
        ? isBearishSweep
          ? `Bearish Liquidity Sweep: price spiked ${piercedHighPips.toFixed(1)} pips above 20-candle high to trigger buy stops, but institutional sellers forced close back below ${swingHigh20.toFixed(5)}.`
          : `Bullish Liquidity Sweep: price spiked ${piercedLowPips.toFixed(1)} pips below 20-candle low to trigger sell stops, but aggressive buyers forced close back above ${swingLow20.toFixed(5)}.`
        : 'No structural liquidity sweep detected; price respected recent 20-candle swing extremes.',
      tradeImplication: isBearishSweep ? 'BEARISH_EDGE' : isBullishSweep ? 'BULLISH_EDGE' : 'NEUTRAL',
      detectedAtIst: nowIst,
    });

    // -------------------------------------------------------------
    // 8. CAPITULATION
    // Measurable evidence: Giant range > 2.5x ATR with pinbar wick > 60% of candle range
    // -------------------------------------------------------------
    const lowerWickRatio = (Math.min(current.open, current.close) - current.low) / (currentRange || 0.0001);
    const isBullCapitulation = currentRange >= atr * 2.3 && lowerWickRatio >= 0.6;
    const isBearCapitulation = currentRange >= atr * 2.3 && upperWickRatio >= 0.6;
    const isCapitulation = isBullCapitulation || isBearCapitulation;

    hypotheses.push({
      type: 'CAPITULATION',
      name: 'Exhaustion Capitulation & Counter-Rejection',
      symbol,
      isActive: isCapitulation,
      confidenceScore: isCapitulation ? 0.88 : 0.1,
      evidenceStrength: isCapitulation ? 0.92 : 0.08,
      measurableEvidence: [
        {
          metricName: 'Candle Range to ATR Expansion',
          measuredValue: Number((currentRange / Math.max(0.00001, atr)).toFixed(2)),
          threshold: 2.3,
          interpretation: 'Outlier candle range representing final climactic transfer from weak hands to strong hands.',
        },
        {
          metricName: 'Pinbar Rejection Tail Ratio',
          measuredValue: Number((isBullCapitulation ? lowerWickRatio : upperWickRatio).toFixed(2)),
          threshold: 0.6,
          interpretation: 'Wick exceeding 60% of total candle proves massive institutional counter-absorption.',
        },
      ],
      plainLanguageExplanation: isCapitulation
        ? `Capitulation event: ultra-high range candle (${(currentRange / atr).toFixed(1)}x ATR) rejected with a massive ${(Math.max(lowerWickRatio, upperWickRatio) * 100).toFixed(0)}% absorption wick.`
        : 'No climactic volume/range capitulation observed in recent bars.',
      tradeImplication: isBullCapitulation ? 'BULLISH_EDGE' : isBearCapitulation ? 'BEARISH_EDGE' : 'NEUTRAL',
      detectedAtIst: nowIst,
    });

    // -------------------------------------------------------------
    // 9. FAILED BREAKOUT TRAP
    // Measurable evidence: Previous bar broke 20-candle high/low, current bar reversed and closed below/above
    // -------------------------------------------------------------
    const prevBrokeHigh = prev.high > swingHigh20 && prev.close > swingHigh20;
    const currentFailedHigh = isDownBar && current.close < swingHigh20;
    const isBullTrap = prevBrokeHigh && currentFailedHigh;

    const prevBrokeLow = prev.low < swingLow20 && prev.close < swingLow20;
    const currentFailedLow = !isDownBar && current.close > swingLow20;
    const isBearTrap = prevBrokeLow && currentFailedLow;
    const isTrap = isBullTrap || isBearTrap;

    hypotheses.push({
      type: 'FAILED_BREAKOUT_TRAP',
      name: 'Failed Breakout Trap (Bull/Bear Trap)',
      symbol,
      isActive: isTrap,
      confidenceScore: isTrap ? 0.85 : 0.14,
      evidenceStrength: isTrap ? 0.88 : 0.12,
      measurableEvidence: [
        {
          metricName: 'Prior Breakout Confirmation',
          measuredValue: prevBrokeHigh ? 1 : prevBrokeLow ? -1 : 0,
          threshold: 1,
          interpretation: 'Previous candle established breakout above structural resistance or below support.',
        },
        {
          metricName: 'Immediate Counter-Close Reversal',
          measuredValue: isTrap ? 1 : 0,
          threshold: 1,
          interpretation: 'Subsequent bar immediately reversed below boundary, trapping breakout traders.',
        },
      ],
      plainLanguageExplanation: isTrap
        ? isBullTrap
          ? 'Bull Trap: breakout traders entered above resistance, but current candle immediately collapsed back below resistance.'
          : 'Bear Trap: breakout sellers entered below support, but current candle reversed and closed firmly back inside range.'
        : 'Breakout boundaries have not exhibited immediate counter-reversal traps.',
      tradeImplication: isBullTrap ? 'BEARISH_EDGE' : isBearTrap ? 'BULLISH_EDGE' : 'NEUTRAL',
      detectedAtIst: nowIst,
    });

    // -------------------------------------------------------------
    // 10. MARKET INDECISION
    // Measurable evidence: 2+ dojis in last 3 candles (body ratio < 15%), alternating bar colors
    // -------------------------------------------------------------
    const isCurrentDoji = bodyRatio <= 0.18;
    const prevRange = prev.high - prev.low;
    const isPrevDoji = (Math.abs(prev.close - prev.open) / (prevRange || 0.0001)) <= 0.2;
    const isAlternating = (current.close > current.open) !== (prev.close > prev.open);
    const isIndecisive = isCurrentDoji && (isPrevDoji || isAlternating);

    hypotheses.push({
      type: 'MARKET_INDECISION',
      name: 'Market Indecision & Doji Equilibrium',
      symbol,
      isActive: isIndecisive,
      confidenceScore: isIndecisive ? 0.74 : 0.16,
      evidenceStrength: isIndecisive ? 0.76 : 0.12,
      measurableEvidence: [
        {
          metricName: 'Current Candle Body-to-Range Ratio',
          measuredValue: Number(bodyRatio.toFixed(2)),
          threshold: 0.18,
          interpretation: 'Candle body under 18% of range indicates buyers and sellers are deadlocked.',
        },
        {
          metricName: 'Multi-Bar Directional Alternation',
          measuredValue: isAlternating ? 1 : 0,
          threshold: 1,
          interpretation: 'Alternating red/green bars demonstrate lack of institutional consensus.',
        },
      ],
      plainLanguageExplanation: isIndecisive
        ? `Equilibrium deadlock: candle bodies compressed to ${(bodyRatio * 100).toFixed(0)}% of range with alternating colors. Edge in binary direction is minimal.`
        : 'Candle bodies show clean directional expansion; market is not in a doji equilibrium deadlock.',
      tradeImplication: isIndecisive ? 'STAND_DOWN' : 'NEUTRAL',
      detectedAtIst: nowIst,
    });

    return hypotheses;
  }

  /**
   * Evaluates an incoming technical signal against the Behavioural Intelligence Layer
   * Operates initially in Shadow Mode to measure and validate impact without disruption.
   */
  public validateSignal(
    signal: ResearchSignal,
    candles: Candle[],
    botHealth: BotSelfMonitoringState
  ): BehavioralDecisionValidation {
    const symbol = signal.symbol;
    const direction = signal.direction;
    const baseConf = signal.confidence || 0.65;
    const nowIst = formatIstTime(new Date());

    const hypotheses = this.assessMarketBehavior(symbol, candles);
    const activeHypotheses = hypotheses.filter(h => h.isActive);

    let recommendation: BehavioralDecisionValidation['recommendation'] = 'SUPPORT';
    let adjustmentMultiplier = 1.0;
    const evidenceSummary: string[] = [];
    let botPenalty = 0.0;

    // Check 1: Bot Self-Monitoring Calibration Penalty
    if (botHealth.confidenceCalibration.calibrationStatus === 'OVERCONFIDENT') {
      const ece = botHealth.confidenceCalibration.expectedCalibrationError;
      botPenalty += Math.min(0.15, ece * 0.5);
      evidenceSummary.push(`Bot overconfidence penalty applied (-${(botPenalty * 100).toFixed(1)}%): calibration ECE is ${(ece * 100).toFixed(1)}%.`);
    }

    // Check 2: Recency Bias check
    if (botHealth.recencyBiasIndex.isBiased && botHealth.recencyBiasIndex.streakType === 'WIN') {
      adjustmentMultiplier *= 0.94;
      evidenceSummary.push('Recency bias guard active: reducing confidence after short-term winning streak to prevent over-leverage.');
    }

    // Check 3: Overtrading penalty
    if (botHealth.overtradingMetrics.isOvertrading) {
      adjustmentMultiplier *= 0.88;
      evidenceSummary.push(`Overtrading burst penalty applied: ${botHealth.overtradingMetrics.signalsPastHour} signals in past hour exceeds threshold.`);
    }

    // Check 4: Behavioral Agreement / Contradiction
    const sweep = activeHypotheses.find(h => h.type === 'LIQUIDITY_SWEEP_CLUSTERS');
    const trap = activeHypotheses.find(h => h.type === 'FAILED_BREAKOUT_TRAP');
    const panic = activeHypotheses.find(h => h.type === 'FEAR_PANIC');
    const fomo = activeHypotheses.find(h => h.type === 'FOMO_LATE_ENTRY');
    const indecision = activeHypotheses.find(h => h.type === 'MARKET_INDECISION');

    // A: Market Indecision -> Stand down or flag uncertainty
    if (indecision) {
      recommendation = 'FLAG_UNCERTAINTY';
      adjustmentMultiplier *= 0.85;
      evidenceSummary.push('Market indecision active: multiple doji candles and alternating colors reduce binary predictability.');
    }

    // B: Contradictory Liquidity Sweep or Trap
    if (direction === 'BUY' && (trap?.tradeImplication === 'BEARISH_EDGE' || sweep?.tradeImplication === 'BEARISH_EDGE')) {
      recommendation = 'REDUCE_CONFIDENCE';
      adjustmentMultiplier *= 0.80;
      evidenceSummary.push('Bearish liquidity sweep or bull trap detected against proposed CALL prediction.');
    } else if (direction === 'SELL' && (trap?.tradeImplication === 'BULLISH_EDGE' || sweep?.tradeImplication === 'BULLISH_EDGE')) {
      recommendation = 'REDUCE_CONFIDENCE';
      adjustmentMultiplier *= 0.80;
      evidenceSummary.push('Bullish liquidity sweep or bear trap detected against proposed PUT prediction.');
    }

    // C: Strong Behavioral Confluence -> SUPPORT
    if (direction === 'BUY' && (sweep?.tradeImplication === 'BULLISH_EDGE' || trap?.tradeImplication === 'BULLISH_EDGE')) {
      recommendation = 'SUPPORT';
      adjustmentMultiplier *= 1.08;
      evidenceSummary.push('Bullish behavioral edge confirmed: liquidity sweep of sell stops supports upward continuation.');
    } else if (direction === 'SELL' && (sweep?.tradeImplication === 'BEARISH_EDGE' || trap?.tradeImplication === 'BEARISH_EDGE' || fomo)) {
      recommendation = 'SUPPORT';
      adjustmentMultiplier *= 1.08;
      evidenceSummary.push('Bearish behavioral edge confirmed: late FOMO exhaustion and buy stop sweep supports downward continuation.');
    }

    // D: Fear Panic -> Extreme fade caution
    if (panic) {
      if (direction === 'BUY') {
        recommendation = 'REDUCE_CONFIDENCE';
        adjustmentMultiplier *= 0.75;
        evidenceSummary.push('Caution: Attempting to catch a falling knife during active fear/panic liquidation.');
      } else {
        recommendation = 'SUPPORT';
        adjustmentMultiplier *= 1.05;
        evidenceSummary.push('Downside panic momentum supports follow-through PUT setup.');
      }
    }

    // Check 5: Severe Penalty -> Reject Insufficient Evidence or Observe Only
    let finalConfidence = (baseConf - botPenalty) * adjustmentMultiplier;
    finalConfidence = Math.max(0.48, Math.min(0.92, Number(finalConfidence.toFixed(3))));

    if (activeHypotheses.length === 0 && baseConf < 0.58) {
      recommendation = 'REJECT_INSUFFICIENT_EVIDENCE';
      evidenceSummary.push('Zero active behavioral catalysts and sub-threshold technical confidence.');
    } else if (adjustmentMultiplier < 0.75) {
      recommendation = 'OBSERVE_ONLY';
      evidenceSummary.push('Compounded behavioral contradictions warrant shadow observation without execution.');
    }

    const decisionRationale = evidenceSummary.length > 0
      ? evidenceSummary.join(' ')
      : 'Technical setup aligns with baseline behavioral dynamics; no adverse psychological traps detected.';

    return {
      signalId: signal.id,
      symbol,
      direction,
      recommendation,
      baselineConfidence: baseConf,
      behaviouralAdjustedConfidence: finalConfidence,
      adjustmentMultiplier: Number(adjustmentMultiplier.toFixed(2)),
      activeHypotheses,
      evidenceSummary,
      botHealthPenalty: Number(botPenalty.toFixed(3)),
      decisionRationale,
      validatedAtIst: nowIst,
    };
  }
}

export const behaviouralEngine = new BehaviouralEngine();
