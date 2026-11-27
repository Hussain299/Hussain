/**
 * SignalForge ML — Multi-Source Forex Data Ingestion Engine
 * Provider order: Yahoo Finance public chart API -> Biquote.io public M1 endpoint -> Dukascopy data via the zapi.ink proxy.
 * Includes gap detection, duplicate elimination, UTC normalization, and health scoring.
 */

import { Candle, ForexSymbol, MarketSessionId, MarketSessionInfo, ProviderHealth } from '../types/index.js';
import { db } from './db.js';

interface RawCandle {
  timestamp: number | string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/**
 * Live scanner freshness policy for one-minute market candles.
 * Candle timestamps mark the minute's open, so a 90-second age limit allows
 * normal provider finalization and the scheduler's 25-second polling cadence.
 * Only recognized external feed sources are eligible; imported, fixture, and
 * synthetic candles must never drive live signal discovery.
 */
export const LIVE_CANDLE_MAX_AGE_MS = 90_000;
const LIVE_CANDLE_FUTURE_SKEW_TOLERANCE_MS = 5_000;
const LIVE_FEED_SOURCES = new Set<Candle['source']>(['biquote', 'dukascopy', 'yahoo']);

export function filterFreshRealCandles(
  candles: readonly Candle[],
  symbol: ForexSymbol,
  nowMs: number = Date.now(),
  maxAgeMs: number = LIVE_CANDLE_MAX_AGE_MS
): Candle[] {
  if (!Number.isFinite(nowMs) || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
    return [];
  }

  return candles
    .filter(candle => {
      if (!candle || candle.symbol !== symbol || !LIVE_FEED_SOURCES.has(candle.source)) {
        return false;
      }
      if (!Number.isFinite(candle.timestampMs)) return false;

      const parsedTimestampMs = Date.parse(candle.timestamp);
      if (!Number.isFinite(parsedTimestampMs) ||
          Math.abs(parsedTimestampMs - candle.timestampMs) > 1_000) {
        return false;
      }

      const ageMs = nowMs - candle.timestampMs;
      return ageMs <= maxAgeMs && ageMs >= -LIVE_CANDLE_FUTURE_SKEW_TOLERANCE_MS;
    })
    .sort((a, b) => a.timestampMs - b.timestampMs);
}

/**
 * Preserve the full real-candle feature window while enforcing freshness on
 * its newest observation. Historical M1 candles are required by the scanner's
 * 35-candle minimum and technical indicators; applying the 90s age check to
 * every row would leave only 1–2 candles and prevent every setup from scanning.
 *
 * Synthetic/imported/test candles are excluded. If the newest verified real
 * candle is stale or too far in the future, the whole window is rejected.
 */
export function getFreshRealCandleWindow(
  candles: readonly Candle[],
  symbol: ForexSymbol,
  nowMs: number = Date.now(),
  maxAgeMs: number = LIVE_CANDLE_MAX_AGE_MS,
  limit: number = 100
): Candle[] {
  if (
    !Number.isFinite(nowMs) ||
    !Number.isFinite(maxAgeMs) ||
    maxAgeMs < 0 ||
    !Number.isInteger(limit) ||
    limit < 1
  ) {
    return [];
  }

  const validRealCandles = candles
    .filter(candle => {
      if (!candle || candle.symbol !== symbol || !LIVE_FEED_SOURCES.has(candle.source)) {
        return false;
      }
      if (!Number.isFinite(candle.timestampMs)) return false;

      const parsedTimestampMs = Date.parse(candle.timestamp);
      if (!Number.isFinite(parsedTimestampMs) ||
          Math.abs(parsedTimestampMs - candle.timestampMs) > 1_000) {
        return false;
      }

      // Reject implausibly future-dated rows but retain legitimate historical
      // observations for the technical feature window.
      return nowMs - candle.timestampMs >= -LIVE_CANDLE_FUTURE_SKEW_TOLERANCE_MS;
    })
    .sort((a, b) => a.timestampMs - b.timestampMs);

  const newest = validRealCandles[validRealCandles.length - 1];
  if (!newest) return [];

  const newestAgeMs = nowMs - newest.timestampMs;
  if (newestAgeMs > maxAgeMs || newestAgeMs < -LIVE_CANDLE_FUTURE_SKEW_TOLERANCE_MS) {
    return [];
  }

  const byTimestamp = new Map<number, Candle>();
  for (const candle of validRealCandles) byTimestamp.set(candle.timestampMs, candle);
  return Array.from(byTimestamp.values()).sort((a, b) => a.timestampMs - b.timestampMs).slice(-limit);
}

export function hasFreshRealProviderCandles(
  candles: readonly Candle[],
  symbol: ForexSymbol,
  nowMs: number = Date.now()
): boolean {
  return getFreshRealCandleWindow(candles, symbol, nowMs, LIVE_CANDLE_MAX_AGE_MS, 100).length > 0;
}

export class DataFeedEngine {
  private basePrices: Record<ForexSymbol, number> = {
    'EUR/USD': 1.0854,
    'GBP/USD': 1.2985,
    'USD/JPY': 152.42,
    'EUR/JPY': 165.45,
    'AUD/USD': 0.6582,
    'USD/CAD': 1.3895,
    'EUR/GBP': 0.8345,
    'AUD/CAD': 0.9125,
    'AUD/CHF': 0.5740,
    'AUD/JPY': 99.85,
    'AUD/NZD': 1.0875,
    'EUR/AUD': 1.6480,
    'EUR/CAD': 1.5030,
    'EUR/CHF': 0.9470,
    'EUR/NZD': 1.7920,
    'GBP/AUD': 1.9720,
    'GBP/CAD': 1.8010,
    'GBP/CHF': 1.1340,
    'GBP/JPY': 198.20,
    'GBP/NZD': 2.1460,
    // Seed prices for the nine pairs added from the Olymp Trade availability audit.
    // These values are used only by the synthetic continuity generator; synthetic
    // candles are filtered out before live signal generation and settlement.
    'USD/MXN': 18.15,
    'USD/CHF': 0.8000,
    'NZD/CAD': 0.7910,
    'NZD/JPY': 86.88,
    'CHF/JPY': 190.53,
    'NZD/USD': 0.5700,
    'NZD/CHF': 0.4560,
    'CAD/JPY': 109.70,
    'CAD/CHF': 0.5760,
  };

  /**
   * Fetches candles with full 3-tier fallback logic and health auditing.
   */
  public async fetchCandles(symbol: ForexSymbol, limit: number = 100): Promise<{ candles: Candle[]; source: string; qualityScore: number }> {
    const cleanSymbol = symbol.replace('/', '');
    let candles: Candle[] = [];
    let activeSource = 'none';

    // 1. Try the Yahoo Finance public chart API first.
    try {
      const start = Date.now();
      const yahooSymbol = `${cleanSymbol}=X`;
      const yahooUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?range=2d&interval=1m`;
      const res = await fetch(yahooUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(4500),
      });

      if (res.ok) {
        const data = await res.json() as any;
        const result = data?.chart?.result?.[0];
        if (result && result.timestamp && result.indicators?.quote?.[0]) {
          const normalized = this.normalizeYahoo(symbol, result);
          if (hasFreshRealProviderCandles(normalized, symbol)) {
            candles = normalized;
            activeSource = 'yahoo';
            db.updateFeedHealth({
              provider: 'yahoo',
              symbol,
              status: 'ONLINE',
              latencyMs: Date.now() - start,
              lastSuccess: new Date().toISOString(),
              consecutiveFailures: 0,
              attribution: 'Yahoo Finance public chart API',
            });
          } else {
            // A non-empty historical response is not a successful live quote.
            // Reject it so the Biquote/Dukascopy fallbacks can still be tried.
            db.updateFeedHealth({
              provider: 'yahoo',
              symbol,
              status: 'DEGRADED',
              latencyMs: Date.now() - start,
              lastSuccess: 'Pending',
              consecutiveFailures: 1,
              attribution: 'Yahoo Finance public chart API (stale response rejected)',
              errorMessage: 'Newest external M1 candle is outside the 90-second live freshness window',
            });
          }
        }
      }
    } catch (err: any) {
      db.updateFeedHealth({
        provider: 'yahoo',
        symbol,
        status: 'DEGRADED',
        latencyMs: 3000,
        lastSuccess: 'Pending',
        consecutiveFailures: 1,
        attribution: 'Yahoo Finance public chart API (fallback attempted)',
        errorMessage: err.message,
      });
    }

    // 2. Try Biquote Fallback if Yahoo failed
    if (candles.length === 0) {
      try {
        const start = Date.now();
        const biquoteUrl = `https://biquote.io/api/${cleanSymbol}/ohlc?interval=1m&limit=${limit}`;
        const res = await fetch(biquoteUrl, {
          headers: { 'User-Agent': 'SignalForge-Research/2.0' },
          signal: AbortSignal.timeout(2000),
        });

        if (res.ok) {
          const data = await res.json() as any;
          const rawList = Array.isArray(data) ? data : data?.data || data?.candles;
          if (Array.isArray(rawList) && rawList.length > 0) {
            const normalized = this.normalizeBiquote(symbol, rawList);
            if (hasFreshRealProviderCandles(normalized, symbol)) {
              candles = normalized;
              activeSource = 'biquote';
              db.updateFeedHealth({
                provider: 'biquote',
                symbol,
                status: 'ONLINE',
                latencyMs: Date.now() - start,
                lastSuccess: new Date().toISOString(),
                consecutiveFailures: 0,
                attribution: 'Biquote.io public M1 endpoint',
              });
            } else {
              db.updateFeedHealth({
                provider: 'biquote',
                symbol,
                status: 'DEGRADED',
                latencyMs: Date.now() - start,
                lastSuccess: 'Pending',
                consecutiveFailures: 1,
                attribution: 'Biquote.io public M1 endpoint (stale response rejected)',
                errorMessage: 'Newest external M1 candle is outside the 90-second live freshness window',
              });
            }
          }
        }
      } catch (err: any) {
        db.updateFeedHealth({
          provider: 'biquote',
          symbol,
          status: 'DEGRADED',
          latencyMs: 2000,
          lastSuccess: 'Pending',
          consecutiveFailures: 1,
          attribution: 'Biquote.io public M1 endpoint (fallback attempted)',
          errorMessage: err.message,
        });
      }
    }

    // 3. Try Dukascopy Fallback if Biquote failed
    if (candles.length === 0) {
      try {
        const start = Date.now();
        const dukascopyUrl = `https://zapi.ink/v1/finance:dukascopy/m1-candles?instrument=${cleanSymbol}&count=${limit}`;
        const res = await fetch(dukascopyUrl, {
          signal: AbortSignal.timeout(2000),
        });

        if (res.ok) {
          const data = await res.json() as any;
          const rawList = data?.candles || data;
          if (Array.isArray(rawList) && rawList.length > 0) {
            const normalized = this.normalizeDukascopy(symbol, rawList);
            if (hasFreshRealProviderCandles(normalized, symbol)) {
              candles = normalized;
              activeSource = 'dukascopy';
              db.updateFeedHealth({
                provider: 'dukascopy',
                symbol,
                status: 'ONLINE',
                latencyMs: Date.now() - start,
                lastSuccess: new Date().toISOString(),
                consecutiveFailures: 0,
                attribution: 'Dukascopy data via zapi.ink proxy (M1)',
              });
            } else {
              db.updateFeedHealth({
                provider: 'dukascopy',
                symbol,
                status: 'DEGRADED',
                latencyMs: Date.now() - start,
                lastSuccess: 'Pending',
                consecutiveFailures: 1,
                attribution: 'Dukascopy data via zapi.ink proxy (stale response rejected)',
                errorMessage: 'Newest external M1 candle is outside the 90-second live freshness window',
              });
            }
          }
        }
      } catch (err: any) {
        db.updateFeedHealth({
          provider: 'dukascopy',
          symbol,
          status: 'DEGRADED',
          latencyMs: 2000,
          lastSuccess: 'Pending',
          consecutiveFailures: 1,
          attribution: 'Dukascopy data via zapi.ink proxy (fallback attempted)',
          errorMessage: err.message,
        });
      }
    }

    // 4. If public endpoints fail or are closed, generate synthetic continuity candles for display only; live scanning rejects them.
    if (candles.length === 0) {
      const stored = db.getCandles(symbol, limit);
      if (stored.length > 0) {
        candles = this.extendFromStored(symbol, stored, limit);
        activeSource = 'synthetic';
      } else {
        candles = this.generateRealisticHistoricalCandles(symbol, limit);
        activeSource = 'synthetic';
      }
      candles = this.validateAndDeduplicate(candles);
    } else {
      // Audit quality & sort chronologically BEFORE bridging up to live time
      candles = this.validateAndDeduplicate(candles);
      if (candles.length > 0) {
        candles = this.validateAndDeduplicate(this.bridgeToCurrentTime(symbol, candles, limit));
      }
    }

    const validated = candles;
    const qualityScore = this.calculateQualityScore(validated);

    // Save ONLY real market candles to persistent database (never persist random synthetic continuity candles)
    const realToStore = validated.filter(c => c.source !== 'synthetic');
    if (realToStore.length > 0) {
      db.storeCandles(symbol, realToStore);
    }

    const containsSynthetic = validated.some(candle => candle.source === 'synthetic');
    const reportedSource = containsSynthetic
      ? (activeSource === 'synthetic' ? 'synthetic' : `${activeSource}+synthetic`)
      : activeSource;
    return {
      candles: validated,
      source: reportedSource,
      qualityScore,
    };
  }

  private normalizeBiquote(symbol: ForexSymbol, raw: any[]): Candle[] {
    const out: Candle[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const timeVal = item.time ?? item.timestamp ?? item.t;
      const tsMs = typeof timeVal === 'number' ? (timeVal < 10000000000 ? timeVal * 1000 : timeVal) : Date.parse(String(timeVal || ''));
      if (!Number.isFinite(tsMs) || tsMs <= 0) continue;
      const d = new Date(tsMs);
      if (!Number.isFinite(d.getTime())) continue;
      const open = Number(item.open ?? item.o);
      const high = Number(item.high ?? item.h);
      const low = Number(item.low ?? item.l);
      const close = Number(item.close ?? item.c);
      const volume = Number(item.volume ?? item.v ?? 100);
      if (![open, high, low, close].every(v => Number.isFinite(v) && v > 0) || high < low) continue;
      out.push({
        symbol,
        timestamp: d.toISOString(),
        timestampMs: tsMs,
        open,
        high,
        low,
        close,
        volume: Number.isFinite(volume) && volume >= 0 ? volume : 100,
        source: 'biquote' as const,
      });
    }
    return out;
  }

  private normalizeDukascopy(symbol: ForexSymbol, raw: any[]): Candle[] {
    const out: Candle[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const tsMs = typeof item.time === 'number' ? (item.time < 10000000000 ? item.time * 1000 : item.time) : Date.parse(String(item.time || ''));
      if (!Number.isFinite(tsMs) || tsMs <= 0) continue;
      const d = new Date(tsMs);
      if (!Number.isFinite(d.getTime())) continue;
      const open = Number(item.open);
      const high = Number(item.high);
      const low = Number(item.low);
      const close = Number(item.close);
      const volume = Number(item.volume ?? 100);
      if (![open, high, low, close].every(v => Number.isFinite(v) && v > 0) || high < low) continue;
      out.push({
        symbol,
        timestamp: d.toISOString(),
        timestampMs: tsMs,
        open,
        high,
        low,
        close,
        volume: Number.isFinite(volume) && volume >= 0 ? volume : 100,
        source: 'dukascopy' as const,
      });
    }
    return out;
  }

  private normalizeYahoo(symbol: ForexSymbol, chartResult: any): Candle[] {
    const timestamps = chartResult?.timestamp || [];
    const quote = chartResult?.indicators?.quote?.[0] || {};
    const opens = quote.open || [];
    const highs = quote.high || [];
    const lows = quote.low || [];
    const closes = quote.close || [];
    const volumes = quote.volume || [];

    const candles: Candle[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const tsSec = Number(timestamps[i]);
      const closeVal = Number(closes[i]);
      if (!Number.isFinite(tsSec) || tsSec <= 0 || closes[i] === null || closes[i] === undefined || !Number.isFinite(closeVal) || closeVal <= 0) {
        continue;
      }
      const tsMs = tsSec * 1000;
      const d = new Date(tsMs);
      if (!Number.isFinite(d.getTime())) continue;
      const open = Number(opens[i] ?? closeVal);
      const high = Number(highs[i] ?? closeVal);
      const low = Number(lows[i] ?? closeVal);
      if (![open, high, low].every(v => Number.isFinite(v) && v > 0)) continue;
      const vol = Number(volumes[i] ?? 150);
      candles.push({
        symbol,
        timestamp: d.toISOString(),
        timestampMs: tsMs,
        open,
        high,
        low,
        close: closeVal,
        volume: Number.isFinite(vol) && vol >= 0 ? vol : 150,
        source: 'yahoo' as const,
      });
    }
    return candles;
  }

  private validateAndDeduplicate(candles: Candle[]): Candle[] {
    const map = new Map<number, Candle>();
    for (const c of candles) {
      if (
        Number.isFinite(c.timestampMs) &&
        c.timestampMs > 0 &&
        Number.isFinite(c.open) && c.open > 0 &&
        Number.isFinite(c.high) && c.high > 0 &&
        Number.isFinite(c.low) && c.low > 0 &&
        Number.isFinite(c.close) && c.close > 0 &&
        c.high >= c.low &&
        c.high >= c.open &&
        c.high >= c.close &&
        c.low <= c.open &&
        c.low <= c.close
      ) {
        map.set(c.timestampMs, c);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.timestampMs - b.timestampMs);
  }

  private calculateQualityScore(candles: Candle[]): number {
    if (candles.length < 5) return 20;
    let gaps = 0;
    for (let i = 1; i < candles.length; i++) {
      const diff = candles[i].timestampMs - candles[i - 1].timestampMs;
      if (diff > 90 * 1000) {
        gaps++;
      }
    }
    const gapPenalty = Math.min(40, gaps * 4);
    return Math.max(30, 100 - gapPenalty);
  }

  /**
   * High-fidelity realistic candle generator for when markets are closed or APIs rate-limit
   */
  public generateRealisticHistoricalCandles(symbol: ForexSymbol, count: number = 120): Candle[] {
    const candles: Candle[] = [];
    let currentPrice = this.basePrices[symbol] || 1.085;
    const now = Date.now();
    const intervalMs = 60 * 1000;
    const startMs = now - count * intervalMs;
    const isJpy = symbol.includes('JPY');
    const pipScale = isJpy ? 0.01 : 0.0001;

    for (let i = 0; i < count; i++) {
      const timeMs = startMs + i * intervalMs;
      const stepChange = (Math.random() - 0.495) * 3.5 * pipScale;
      const open = currentPrice;
      const close = Number((open + stepChange).toFixed(isJpy ? 3 : 5));
      const wickUpper = Math.random() * 2.0 * pipScale;
      const wickLower = Math.random() * 2.0 * pipScale;
      const high = Number((Math.max(open, close) + wickUpper).toFixed(isJpy ? 3 : 5));
      const low = Number((Math.min(open, close) - wickLower).toFixed(isJpy ? 3 : 5));
      const volume = Math.floor(80 + Math.random() * 250);

      currentPrice = close;
      candles.push({
        symbol,
        timestamp: new Date(timeMs).toISOString(),
        timestampMs: timeMs,
        open,
        high,
        low,
        close,
        volume,
        source: 'synthetic',
      });
    }

    return candles;
  }

  private bridgeToCurrentTime(symbol: ForexSymbol, candles: Candle[], limit: number): Candle[] {
    if (candles.length === 0) return this.generateRealisticHistoricalCandles(symbol, limit);
    const nowMs = Date.now();
    const intervalMs = 60 * 1000;
    const latest = candles[candles.length - 1];

    // If candles are within the last 90 seconds, they are fresh
    if (nowMs - latest.timestampMs <= 90 * 1000) {
      return candles.slice(-limit);
    }

    const isJpy = symbol.includes('JPY');
    const pipScale = isJpy ? 0.01 : 0.0001;
    let currentPrice = latest.close;
    // Advance forward minute by minute up to current Date.now()
    const missedSteps = Math.min(240, Math.max(1, Math.floor((nowMs - latest.timestampMs) / intervalMs)));
    const extension: Candle[] = [];

    for (let i = 1; i <= missedSteps; i++) {
      const timeMs = latest.timestampMs + i * intervalMs;
      const stepChange = (Math.random() - 0.495) * 3.2 * pipScale;
      const open = currentPrice;
      const close = Number((open + stepChange).toFixed(isJpy ? 3 : 5));
      const wickUpper = Math.random() * 2.0 * pipScale;
      const wickLower = Math.random() * 2.0 * pipScale;
      const high = Number((Math.max(open, close) + wickUpper).toFixed(isJpy ? 3 : 5));
      const low = Number((Math.min(open, close) - wickLower).toFixed(isJpy ? 3 : 5));
      const volume = Math.floor(80 + Math.random() * 250);

      currentPrice = close;
      extension.push({
        symbol,
        timestamp: new Date(timeMs).toISOString(),
        timestampMs: timeMs,
        open,
        high,
        low,
        close,
        volume,
        source: 'synthetic',
      });
    }

    const merged = [...candles, ...extension];
    return merged.slice(-limit);
  }

  private extendFromStored(symbol: ForexSymbol, stored: Candle[], limit: number): Candle[] {
    return this.bridgeToCurrentTime(symbol, stored, limit);
  }

  /**
   * Returns current active market sessions and timezone metadata
   */
  public getMarketSessions() {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const currentSession = getSessionFromTimestamp(now);

    return {
      activeSessionId: currentSession.id,
      activeSessionName: currentSession.name,
      sydney: utcHour >= 22 || utcHour < 7,
      tokyo: utcHour >= 0 && utcHour < 9,
      london: utcHour >= 7 && utcHour < 16,
      newYork: utcHour >= 12 && utcHour < 21,
      overlap: utcHour >= 12 && utcHour < 16,
      currentUtcHour: utcHour,
      currentUtcIso: now.toISOString(),
      currentIst: new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }).format(now).toUpperCase() + ' IST',
    };
  }
}

/**
 * Institutional FX trading hours:
 * - Market opens Sunday at 21:00 UTC (Sydney/Wellington open / 5:00 PM EST / Mon 02:30 AM IST).
 * - Market closes Friday at 21:00 UTC (New York close / 5:00 PM EST / Sat 02:30 AM IST).
 * - Closed from Friday 21:00 UTC to Sunday 21:00 UTC.
 */
export function isForexMarketOpen(timestampUtc: string | Date | number = new Date()): {
  isOpen: boolean;
  statusText: string;
  nextOpenUtc?: string;
  nextOpenIst?: string;
} {
  const d = new Date(timestampUtc);
  if (!Number.isFinite(d.getTime())) {
    return {
      isOpen: false,
      statusText: 'Invalid timestamp; treating market as closed.',
    };
  }
  const day = d.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 5 = Fri, 6 = Sat
  const hour = d.getUTCHours();

  // Friday after 21:00 UTC: Closed
  if (day === 5 && hour >= 21) {
    return {
      isOpen: false,
      statusText: 'Market Closed (Weekend). Reopens Sunday 21:00 UTC (Monday 02:30 AM IST).',
      nextOpenUtc: 'Sunday 21:00 UTC',
      nextOpenIst: 'Monday 02:30 AM IST',
    };
  }

  // Saturday: Closed all day
  if (day === 6) {
    return {
      isOpen: false,
      statusText: 'Market Closed (Weekend). Reopens Sunday 21:00 UTC (Monday 02:30 AM IST).',
      nextOpenUtc: 'Sunday 21:00 UTC',
      nextOpenIst: 'Monday 02:30 AM IST',
    };
  }

  // Sunday before 21:00 UTC: Closed
  if (day === 0 && hour < 21) {
    return {
      isOpen: false,
      statusText: 'Market Closed (Weekend). Reopens Sunday 21:00 UTC (Monday 02:30 AM IST).',
      nextOpenUtc: 'Sunday 21:00 UTC',
      nextOpenIst: 'Monday 02:30 AM IST',
    };
  }

  return {
    isOpen: true,
    statusText: 'Market Open',
  };
}

/**
 * Deterministically resolves the forex market session for any UTC timestamp.
 * 4 Recognized Institutional Sessions:
 * 1. ASIA (Tokyo/Sydney): 00:00 - 07:00 UTC (05:30 - 12:30 IST)
 * 2. LONDON: 07:00 - 12:00 UTC (12:30 - 17:30 IST)
 * 3. OVERLAP (London + New York Peak): 12:00 - 16:00 UTC (17:30 - 21:30 IST)
 * 4. NEW_YORK (Afternoon NY): 16:00 - 21:00 UTC (21:30 - 02:30 IST)
 */
export function getSessionFromTimestamp(
  timestampUtc: string | Date | number,
  ignoreWeekend: boolean = false
): {
  id: MarketSessionId;
  name: string;
  shortName: string;
  utcRange: string;
  istRange: string;
  isMarketOpen: boolean;
} {
  const d = new Date(timestampUtc);
  const marketStatus = isForexMarketOpen(d);

  if (!ignoreWeekend && !marketStatus.isOpen) {
    return {
      id: 'WEEKEND_CLOSED',
      name: 'Weekend (Market Closed)',
      shortName: 'Closed',
      utcRange: 'Reopens Sun 21:00 UTC',
      istRange: 'Reopens Mon 02:30 AM IST',
      isMarketOpen: false,
    };
  }

  const hour = d.getUTCHours();

  if (hour >= 12 && hour < 16) {
    return {
      id: 'OVERLAP',
      name: 'London / New York Overlap',
      shortName: 'Overlap',
      utcRange: '12:00 - 16:00 UTC',
      istRange: '05:30 PM - 09:30 PM IST',
      isMarketOpen: true,
    };
  } else if (hour >= 7 && hour < 12) {
    return {
      id: 'LONDON',
      name: 'London Session',
      shortName: 'London',
      utcRange: '07:00 - 12:00 UTC',
      istRange: '12:30 PM - 05:30 PM IST',
      isMarketOpen: true,
    };
  } else if (hour >= 16 && hour < 21) {
    return {
      id: 'NEW_YORK',
      name: 'New York Session',
      shortName: 'New York',
      utcRange: '16:00 - 21:00 UTC',
      istRange: '09:30 PM - 02:30 AM IST',
      isMarketOpen: true,
    };
  } else {
    return {
      id: 'ASIA',
      name: 'Asian Session',
      shortName: 'Asia',
      utcRange: '00:00 - 07:00 UTC',
      istRange: '05:30 AM - 12:30 PM IST',
      isMarketOpen: true,
    };
  }
}

export const dataFeedEngine = new DataFeedEngine();

