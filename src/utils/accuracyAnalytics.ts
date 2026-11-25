import { FOREX_PAIRS, MarketSessionId, ResearchSignal } from '../types/index.js';

export type AccuracyPeriod = '24H' | '7D' | '30D' | 'ALL';
export type AccuracySessionId = Exclude<MarketSessionId, 'WEEKEND_CLOSED'>;
export type AccuracySessionFilter = 'ALL' | AccuracySessionId;

export interface AccuracySessionDefinition {
  id: AccuracySessionId;
  label: string;
  istRange: string;
  utcRange: string;
}

export const ACCURACY_SESSIONS: AccuracySessionDefinition[] = [
  { id: 'ASIA', label: 'Asian Session', istRange: '05:30 AM – 12:30 PM IST', utcRange: '00:00–07:00 UTC' },
  { id: 'LONDON', label: 'London Session', istRange: '12:30 PM – 05:30 PM IST', utcRange: '07:00–12:00 UTC' },
  { id: 'OVERLAP', label: 'London / New York Overlap', istRange: '05:30 PM – 09:30 PM IST', utcRange: '12:00–16:00 UTC' },
  { id: 'NEW_YORK', label: 'New York Session', istRange: '09:30 PM – 02:30 AM IST', utcRange: '16:00–21:00 UTC' },
];

export interface AccuracyBucket {
  key: string;
  label: string;
  settlements: number;
  scoredTrades: number;
  wins: number;
  losses: number;
  scratches: number;
  winRatePct: number | null;
  netReturnUnits: number;
  lastSettledAt: string | null;
}

export interface AccuracyReport {
  period: AccuracyPeriod;
  summary: AccuracyBucket;
  sessions: AccuracyBucket[];
  pairs: AccuracyBucket[];
  pairsWithScoredSettlements: number;
  generatedAt: string;
}

export interface AccuracyReportOptions {
  period?: AccuracyPeriod;
  pairSession?: AccuracySessionFilter;
  nowMs?: number;
}

const PERIOD_MS: Record<Exclude<AccuracyPeriod, 'ALL'>, number> = {
  '24H': 24 * 60 * 60 * 1000,
  '7D': 7 * 24 * 60 * 60 * 1000,
  '30D': 30 * 24 * 60 * 60 * 1000,
};

function isAccuracySessionId(value: unknown): value is AccuracySessionId {
  return ACCURACY_SESSIONS.some(session => session.id === value);
}

/**
 * Match the scheduler's UTC session boundaries when older records do not have
 * marketSession metadata. Weekend timestamps are not assigned to a session.
 */
export function inferAccuracySession(timestampUtc: string): AccuracySessionId | null {
  const timestampMs = Date.parse(timestampUtc);
  if (!Number.isFinite(timestampMs)) return null;
  const date = new Date(timestampMs);
  const day = date.getUTCDay();
  const hour = date.getUTCHours();

  if ((day === 5 && hour >= 21) || day === 6 || (day === 0 && hour < 21)) return null;
  if (hour >= 12 && hour < 16) return 'OVERLAP';
  if (hour >= 7 && hour < 12) return 'LONDON';
  if (hour >= 16 && hour < 21) return 'NEW_YORK';
  return 'ASIA';
}

/**
 * The accuracy view follows the same minimum evidence rules as the forward
 * outcome ledger: CLOSED result, actual fill and exit, and recorded payout units.
 * Unfilled/expired setups, pending rows, cancelled rows, tests and partial
 * historical records are never treated as scored contracts.
 */
export function isVerifiedAccuracySettlement(signal: ResearchSignal): boolean {
  if (
    !signal ||
    signal.lifecycleState !== 'CLOSED' ||
    !['WIN', 'LOSS', 'SCRATCH'].includes(signal.outcomeResult) ||
    signal.ruleFamily?.startsWith('test_') ||
    !FOREX_PAIRS.includes(signal.symbol)
  ) {
    return false;
  }

  const entryTime = typeof signal.actualEntryTimeUtc === 'string'
    ? Date.parse(signal.actualEntryTimeUtc)
    : Number.NaN;
  const exitTime = typeof signal.actualExitTimeUtc === 'string'
    ? Date.parse(signal.actualExitTimeUtc)
    : Number.NaN;

  return Number.isFinite(entryTime) &&
    Number.isFinite(exitTime) &&
    exitTime >= entryTime &&
    Number.isFinite(signal.actualEntryPrice) &&
    Number(signal.actualEntryPrice) > 0 &&
    Number.isFinite(signal.actualExitPrice) &&
    Number(signal.actualExitPrice) > 0 &&
    Number.isFinite(signal.netReturnUnits) &&
    Number.isFinite(signal.payoutPct);
}

function emptyBucket(key: string, label: string): AccuracyBucket {
  return {
    key,
    label,
    settlements: 0,
    scoredTrades: 0,
    wins: 0,
    losses: 0,
    scratches: 0,
    winRatePct: null,
    netReturnUnits: 0,
    lastSettledAt: null,
  };
}

function addSettlement(bucket: AccuracyBucket, signal: ResearchSignal): void {
  bucket.settlements += 1;
  if (signal.outcomeResult === 'WIN') bucket.wins += 1;
  else if (signal.outcomeResult === 'LOSS') bucket.losses += 1;
  else if (signal.outcomeResult === 'SCRATCH') bucket.scratches += 1;

  bucket.scoredTrades = bucket.wins + bucket.losses;
  bucket.winRatePct = bucket.scoredTrades > 0
    ? Number(((bucket.wins / bucket.scoredTrades) * 100).toFixed(1))
    : null;
  bucket.netReturnUnits = Number(
    (bucket.netReturnUnits + Number(signal.netReturnUnits)).toFixed(2)
  );

  const timestamp = signal.actualExitTimeUtc!;
  if (!bucket.lastSettledAt || Date.parse(timestamp) > Date.parse(bucket.lastSettledAt)) {
    bucket.lastSettledAt = timestamp;
  }
}

export function buildAccuracyReport(
  signals: readonly ResearchSignal[],
  options: AccuracyReportOptions = {}
): AccuracyReport {
  const period = options.period ?? '7D';
  const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const periodMs = period === 'ALL' ? null : PERIOD_MS[period];
  const pairSession = options.pairSession ?? 'ALL';

  // Merge defensively by signal ID. The app normally deduplicates server and
  // Firestore copies before they reach this view.
  const unique = new Map<string, ResearchSignal>();
  for (const signal of signals) {
    if (signal?.id) unique.set(signal.id, signal);
  }

  const eligible = Array.from(unique.values()).filter(signal => {
    if (!isVerifiedAccuracySettlement(signal)) return false;
    const settledAt = Date.parse(signal.actualExitTimeUtc!);
    if (settledAt > nowMs + 5 * 60_000) return false;
    return periodMs === null || nowMs - settledAt <= periodMs;
  });

  const overall = emptyBucket('ALL', 'All verified settlements');
  const sessionBuckets = ACCURACY_SESSIONS.map(session => emptyBucket(session.id, session.label));
  const sessionMap = new Map(sessionBuckets.map(bucket => [bucket.key, bucket]));
  const unclassified = emptyBucket('UNCLASSIFIED', 'Session unavailable');
  const pairMap = new Map<string, AccuracyBucket>(
    FOREX_PAIRS.map(pair => [pair, emptyBucket(pair, pair)])
  );

  for (const signal of eligible) {
    addSettlement(overall, signal);

    const sessionId = isAccuracySessionId(signal.marketSession)
      ? signal.marketSession
      : inferAccuracySession(signal.predictionTimeUtc);
    const sessionBucket = sessionId ? sessionMap.get(sessionId) : unclassified;
    if (sessionBucket) addSettlement(sessionBucket, signal);

    if (pairSession === 'ALL' || sessionId === pairSession) {
      const pairBucket = pairMap.get(signal.symbol);
      if (pairBucket) addSettlement(pairBucket, signal);
    }
  }

  const sessions = [...sessionBuckets];
  if (unclassified.settlements > 0) sessions.push(unclassified);

  const pairs = FOREX_PAIRS.map(pair => pairMap.get(pair)!);

  return {
    period,
    summary: overall,
    sessions,
    pairs,
    pairsWithScoredSettlements: pairs.filter(pair => pair.scoredTrades > 0).length,
    generatedAt: new Date(nowMs).toISOString(),
  };
}
