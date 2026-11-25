/**
 * SignalForge ML — Quantitative Microstructure & Multi-Timeframe Strength Engine
 *
 * Institutional signal context computed strictly from closed/prediction-time candles:
 * 1. Causal M1 -> M5 and M1 -> M15 OHLC resampling (never touches partial future bars).
 * 2. Multi-timeframe trend & impulse alignment score [-1, +1].
 * 3. Cross-sectional 8-major Currency Relative Strength Matrix
 *    (USD, EUR, GBP, JPY, AUD, NZD, CAD, CHF) from active live pair returns.
 */

import { Candle, ForexSymbol, SignalDirection } from '../types/index.js';

export type MajorCurrency = 'USD' | 'EUR' | 'GBP' | 'JPY' | 'AUD' | 'NZD' | 'CAD' | 'CHF';
export const MAJOR_CURRENCIES: MajorCurrency[] = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF'];

export interface ResampledBar {
  bucketMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MultiTimeframeContext {
  m5TrendBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  m15TrendBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  m5ReturnPips: number;
  m15ReturnPips: number;
  alignmentScore: number; // [-1.0, +1.0] positive means higher timeframes support trade direction
  m5BarsCount: number;
  m15BarsCount: number;
}

export interface CurrencyStrengthEntry {
  currency: MajorCurrency;
  score: number; // Normalized Z/pip return composite [-100, +100]
  pairsSampled: number;
  rank: number;
  bias: 'STRONG' | 'NEUTRAL' | 'WEAK';
}

export interface CurrencyStrengthSnapshot {
  updatedAtUtc: string;
  activePairsCount: number;
  currencies: CurrencyStrengthEntry[];
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function round(v: number, digits = 3): number {
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

/**
 * Resample ordered M1 candles into aligned higher-timeframe buckets (5m or 15m),
 * strictly keeping buckets up to the provided prediction candle timestamp.
 */
export function resampleCandlesCausal(
  m1Candles: readonly Candle[],
  timeframeMinutes: 5 | 15,
  maxTimestampMs?: number
): ResampledBar[] {
  const bucketMsSpan = timeframeMinutes * 60_000;
  const filtered = m1Candles
    .filter((c) => c && c.source !== 'synthetic' && Number.isFinite(c.timestampMs) && (maxTimestampMs === undefined || c.timestampMs <= maxTimestampMs))
    .sort((a, b) => a.timestampMs - b.timestampMs);

  const buckets = new Map<number, ResampledBar>();
  for (const c of filtered) {
    const bucketMs = Math.floor(c.timestampMs / bucketMsSpan) * bucketMsSpan;
    const existing = buckets.get(bucketMs);
    if (!existing) {
      buckets.set(bucketMs, {
        bucketMs,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: Number.isFinite(c.volume) ? c.volume : 100,
      });
    } else {
      existing.high = Math.max(existing.high, c.high);
      existing.low = Math.min(existing.low, c.low);
      existing.close = c.close;
      existing.volume += Number.isFinite(c.volume) ? c.volume : 100;
    }
  }

  return Array.from(buckets.values()).sort((a, b) => a.bucketMs - b.bucketMs);
}

/**
 * Compute causal M5 and M15 trend alignment relative to a signal's trade direction.
 */
export function evaluateMultiTimeframeAlignment(
  symbol: ForexSymbol,
  direction: SignalDirection,
  m1Candles: readonly Candle[],
  maxTimestampMs?: number
): MultiTimeframeContext {
  const isJpy = symbol.includes('JPY');
  const pipScale = isJpy ? 0.01 : 0.0001;
  const dirSign = direction === 'BUY' ? 1 : -1;

  const m5Bars = resampleCandlesCausal(m1Candles, 5, maxTimestampMs);
  const m15Bars = resampleCandlesCausal(m1Candles, 15, maxTimestampMs);

  const m5Last = m5Bars[m5Bars.length - 1];
  const m5Prev = m5Bars[Math.max(0, m5Bars.length - 4)];
  const m5ReturnPips = m5Last && m5Prev ? (m5Last.close - m5Prev.open) / pipScale : 0;

  const m15Last = m15Bars[m15Bars.length - 1];
  const m15Prev = m15Bars[Math.max(0, m15Bars.length - 3)];
  const m15ReturnPips = m15Last && m15Prev ? (m15Last.close - m15Prev.open) / pipScale : 0;

  const m5TrendBias: MultiTimeframeContext['m5TrendBias'] =
    m5ReturnPips > 1.2 ? 'BULLISH' : m5ReturnPips < -1.2 ? 'BEARISH' : 'NEUTRAL';
  const m15TrendBias: MultiTimeframeContext['m15TrendBias'] =
    m15ReturnPips > 1.8 ? 'BULLISH' : m15ReturnPips < -1.8 ? 'BEARISH' : 'NEUTRAL';

  // Alignment score in [-1, +1]
  const m5Align = Math.tanh((dirSign * m5ReturnPips) / 8);
  const m15Align = Math.tanh((dirSign * m15ReturnPips) / 12);
  const alignmentScore = clamp(0.55 * m5Align + 0.45 * m15Align, -1, 1);

  return {
    m5TrendBias,
    m15TrendBias,
    m5ReturnPips: round(m5ReturnPips, 2),
    m15ReturnPips: round(m15ReturnPips, 2),
    alignmentScore: round(alignmentScore, 3),
    m5BarsCount: m5Bars.length,
    m15BarsCount: m15Bars.length,
  };
}

/**
 * Compute cross-sectional 8-currency strength matrix across available real candles.
 */
export function computeCurrencyStrengthMatrix(
  candlesMap: Partial<Record<ForexSymbol, Candle[]>>
): CurrencyStrengthSnapshot {
  const accum: Record<MajorCurrency, { sum: number; count: number }> = {
    USD: { sum: 0, count: 0 },
    EUR: { sum: 0, count: 0 },
    GBP: { sum: 0, count: 0 },
    JPY: { sum: 0, count: 0 },
    AUD: { sum: 0, count: 0 },
    NZD: { sum: 0, count: 0 },
    CAD: { sum: 0, count: 0 },
    CHF: { sum: 0, count: 0 },
  };

  let pairsSampled = 0;
  for (const [pairKey, rawCandles] of Object.entries(candlesMap)) {
    const candles = (rawCandles || []).filter((c) => c && c.source !== 'synthetic');
    if (candles.length < 16) continue;
    const [base, quote] = pairKey.split('/') as [MajorCurrency, MajorCurrency];
    if (!accum[base] || !accum[quote]) continue;

    pairsSampled += 1;
    const isJpy = pairKey.includes('JPY');
    const pipScale = isJpy ? 0.01 : 0.0001;
    const latest = candles[candles.length - 1];
    const past15 = candles[Math.max(0, candles.length - 16)];
    const past5 = candles[Math.max(0, candles.length - 6)];

    // Blend 15m + 5m normalized return scaled safely to [-100, +100]
    const move15 = (latest.close - past15.close) / pipScale;
    const move5 = (latest.close - past5.close) / pipScale;
    const normalizedScore = clamp((move15 * 0.6 + move5 * 0.4) * 5.0, -100, 100);

    accum[base].sum += normalizedScore;
    accum[base].count += 1;
    accum[quote].sum -= normalizedScore;
    accum[quote].count += 1;
  }

  const entries: CurrencyStrengthEntry[] = MAJOR_CURRENCIES.map((currency) => {
    const item = accum[currency];
    const score = item.count > 0 ? round(clamp(item.sum / item.count, -100, 100), 1) : 0;
    const bias: CurrencyStrengthEntry['bias'] =
      score >= 12 ? 'STRONG' : score <= -12 ? 'WEAK' : 'NEUTRAL';
    return {
      currency,
      score,
      pairsSampled: item.count,
      rank: 0,
      bias,
    };
  }).sort((a, b) => b.score - a.score);

  entries.forEach((entry, idx) => {
    entry.rank = idx + 1;
  });

  return {
    updatedAtUtc: new Date().toISOString(),
    activePairsCount: pairsSampled,
    currencies: entries,
  };
}

/**
 * Directional base-vs-quote currency strength spread in [-1, +1] (+ = macro flow supports trade).
 */
export function getDirectionalStrengthSpread(
  symbol: ForexSymbol,
  direction: SignalDirection,
  snapshot: CurrencyStrengthSnapshot | null
): number {
  if (!snapshot || snapshot.activePairsCount === 0) return 0;
  const [base, quote] = symbol.split('/') as [MajorCurrency, MajorCurrency];
  const baseScore = snapshot.currencies.find((c) => c.currency === base)?.score ?? 0;
  const quoteScore = snapshot.currencies.find((c) => c.currency === quote)?.score ?? 0;
  const rawSpread = (baseScore - quoteScore) / 100; // roughly [-1, +1]
  const signed = direction === 'BUY' ? rawSpread : -rawSpread;
  return round(clamp(signed, -1, 1), 3);
}

class QuantMicrostructureStore {
  private latestMatrix: CurrencyStrengthSnapshot = {
    updatedAtUtc: new Date().toISOString(),
    activePairsCount: 0,
    currencies: MAJOR_CURRENCIES.map((currency, idx) => ({
      currency,
      score: 0,
      pairsSampled: 0,
      rank: idx + 1,
      bias: 'NEUTRAL',
    })),
  };

  public updateCurrencyStrength(candlesMap: Partial<Record<ForexSymbol, Candle[]>>): CurrencyStrengthSnapshot {
    const computed = computeCurrencyStrengthMatrix(candlesMap);
    if (computed.activePairsCount > 0) {
      this.latestMatrix = computed;
    }
    return this.latestMatrix;
  }

  public getCurrencyStrength(): CurrencyStrengthSnapshot {
    return this.latestMatrix;
  }
}

export const quantMicrostructure = new QuantMicrostructureStore();
