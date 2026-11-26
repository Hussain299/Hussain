import { BrokerEligibilitySnapshot, FOREX_PAIRS, ForexSymbol } from '../types/index.js';

export type RuntimeTradingMode = 'MANUAL_PAIRS' | 'OLYMP_TRADE';

export type OlympTradeSessionState = 'READY' | 'LOGIN_REQUIRED' | 'WAITING_FOR_MARKET_DATA' | 'NO_PLATFORM_TAB' | 'STALE' | 'UNKNOWN';
export type OlympTradeAvailability = 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
export type OlympTradeEvidence = 'HIGH' | 'MEDIUM' | 'NONE';
export type OlympTradeInstrumentSource = 'MARKET_LIST' | 'TAB' | 'UNKNOWN';
export type OlympTradeUniverseMode =
  | 'OLYMP_ACTIVE'
  | 'MANUAL_ACTIVE'
  | 'OLYMP_NO_ELIGIBLE_PAIRS'
  | 'OLYMP_WAITING_FOR_SNAPSHOT'
  | 'OLYMP_STALE'
  | 'OLYMP_LOGIN_REQUIRED';

export interface OlympTradeDiagnosticCounts {
  observed: number;
  available: number;
  unavailable: number;
  unknownAvailability: number;
  knownPayout: number;
  payoutAtLeast80: number;
  eligibleInUniverse: number;
  outsideUniverse: number;
}

export interface EligiblePairDetail {
  payoutPct: number;
  availability: 'AVAILABLE';
  evidence: 'HIGH';
  sourceType: OlympTradeInstrumentSource;
}

export interface ActiveTradingUniverse {
  mode: OlympTradeUniverseMode;
  tradingMode?: RuntimeTradingMode;
  allowAllPairs?: boolean;
  pairs: ForexSymbol[];
  liveCount: number;
  capturedAt: string | null;
  ageMs: number | null;
  reason: string;
  counts: OlympTradeDiagnosticCounts;
  eligibleDetails: Partial<Record<ForexSymbol, EligiblePairDetail>>;
  extensionInstalled: boolean;
  extensionVersion: string | null;
  platformTabOpen: boolean;
  connected: boolean;
  sessionState: OlympTradeSessionState;
  discoveredPairs: string[];
  activePairs: string[];
  unavailablePairs: string[];
  unknownPairs: string[];
  discoveredCount: number;
  activeCount: number;
  unavailableCount: number;
  instruments: OlympTradeInstrument[];
}

export interface OlympTradeInstrument {
  pair: string;
  payoutPct: number | null;
  availability: OlympTradeAvailability;
  evidence: OlympTradeEvidence;
  sourceType?: OlympTradeInstrumentSource;
}

export interface OlympTradeBridgeStatus {
  extensionInstalled: boolean;
  extensionVersion: string | null;
  platformTabOpen: boolean;
  connected: boolean;
  sessionState: OlympTradeSessionState;
  capturedAt: string | null;
  ageMs: number | null;
  instruments: OlympTradeInstrument[];
}

export const SNAPSHOT_FRESHNESS_MS = 45_000;
export const MIN_ELIGIBLE_PAYOUT_PCT = 80;

const CHANNEL = 'SIGNALFORGE_OLYMP_TRADE_BRIDGE';
const CONFIGURED_PAIR_SET = new Set<string>(FOREX_PAIRS);

const EMPTY_STATUS: OlympTradeBridgeStatus = {
  extensionInstalled: false,
  extensionVersion: null,
  platformTabOpen: false,
  connected: false,
  sessionState: 'UNKNOWN',
  capturedAt: null,
  ageMs: null,
  instruments: [],
};

function emptyCounts(): OlympTradeDiagnosticCounts {
  return {
    observed: 0,
    available: 0,
    unavailable: 0,
    unknownAvailability: 0,
    knownPayout: 0,
    payoutAtLeast80: 0,
    eligibleInUniverse: 0,
    outsideUniverse: 0,
  };
}

export function normalizePair(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const pair = value.trim().toUpperCase().replace(/\s+/g, '');
  if (/^[A-Z]{3}\/[A-Z]{3}$/.test(pair)) {
    const [base, quote] = pair.split('/');
    if (base === quote) return null; // Reject same-currency pairs
    return pair;
  }
  return null;
}

function isInstrumentEligible(inst: OlympTradeInstrument): boolean {
  return (
    CONFIGURED_PAIR_SET.has(inst.pair) &&
    inst.availability === 'AVAILABLE' &&
    inst.payoutPct !== null &&
    Number.isFinite(inst.payoutPct) &&
    inst.payoutPct >= MIN_ELIGIBLE_PAYOUT_PCT &&
    inst.payoutPct <= 100 &&
    inst.evidence === 'HIGH'
  );
}

function instrumentScore(inst: OlympTradeInstrument): number {
  return (
    (inst.availability === 'AVAILABLE' ? 200 : inst.availability === 'UNAVAILABLE' ? 50 : 0) +
    (inst.evidence === 'HIGH' ? 100 : inst.evidence === 'MEDIUM' ? 30 : 0) +
    (inst.payoutPct !== null ? 40 : 0) +
    (inst.sourceType === 'MARKET_LIST' ? 10 : 0)
  );
}

/** Accept only the fields needed by this read-only panel from the local extension. */
export function sanitizeOlympTradeBridgeStatus(value: unknown): OlympTradeBridgeStatus {
  if (!value || typeof value !== 'object') return { ...EMPTY_STATUS };
  const raw = value as Record<string, unknown>;
  const capturedAt =
    typeof raw.capturedAt === 'string' && Number.isFinite(Date.parse(raw.capturedAt))
      ? new Date(raw.capturedAt).toISOString()
      : null;
  const ageMs =
    typeof raw.ageMs === 'number' && Number.isFinite(raw.ageMs) && raw.ageMs >= 0
      ? Math.min(raw.ageMs, 7 * 24 * 60 * 60 * 1000)
      : capturedAt
      ? Math.max(0, Date.now() - Date.parse(capturedAt))
      : null;
  const allowedStates: OlympTradeSessionState[] = [
    'READY', 'LOGIN_REQUIRED', 'WAITING_FOR_MARKET_DATA', 'NO_PLATFORM_TAB', 'STALE', 'UNKNOWN',
  ];
  const sessionState = allowedStates.includes(raw.sessionState as OlympTradeSessionState)
    ? (raw.sessionState as OlympTradeSessionState)
    : 'UNKNOWN';
  const unique = new Map<string, OlympTradeInstrument>();

  if (Array.isArray(raw.instruments)) {
    for (const item of raw.instruments) {
      if (!item || typeof item !== 'object') continue;
      const instrument = item as Record<string, unknown>;
      const pair = normalizePair(instrument.pair);
      if (!pair) continue;
      const payout =
        typeof instrument.payoutPct === 'number' &&
        Number.isFinite(instrument.payoutPct) &&
        instrument.payoutPct >= 50 &&
        instrument.payoutPct <= 100
          ? Math.round(instrument.payoutPct * 100) / 100
          : null;
      const availability: OlympTradeAvailability =
        instrument.availability === 'AVAILABLE' || instrument.availability === 'UNAVAILABLE'
          ? instrument.availability
          : 'UNKNOWN';
      const evidence: OlympTradeEvidence =
        instrument.evidence === 'HIGH' || instrument.evidence === 'MEDIUM'
          ? instrument.evidence
          : 'NONE';
      const sourceType: OlympTradeInstrumentSource =
        instrument.sourceType === 'MARKET_LIST' || instrument.sourceType === 'TAB'
          ? instrument.sourceType
          : 'UNKNOWN';
      const next: OlympTradeInstrument = { pair, payoutPct: payout, availability, evidence, sourceType };
      const previous = unique.get(pair);
      if (!previous || instrumentScore(next) > instrumentScore(previous)) {
        unique.set(pair, next);
      }
    }
  }

  const extensionInstalled = raw.extensionInstalled === true;
  const platformTabOpen = raw.platformTabOpen === true;
  const connected =
    extensionInstalled &&
    platformTabOpen &&
    raw.connected === true &&
    sessionState === 'READY' &&
    ageMs !== null &&
    ageMs <= SNAPSHOT_FRESHNESS_MS &&
    unique.size > 0;

  // Build result with ONLY the expected fields — no credential data forwarded
  return {
    extensionInstalled,
    extensionVersion: typeof raw.extensionVersion === 'string' ? raw.extensionVersion.slice(0, 32) : null,
    platformTabOpen,
    connected,
    sessionState,
    capturedAt,
    ageMs,
    instruments: Array.from(unique.values()).sort((a, b) => a.pair.localeCompare(b.pair)),
  };
}

export async function requestOlympTradeBridgeStatus(
  command: 'GET_STATUS' | 'REFRESH' = 'GET_STATUS'
): Promise<OlympTradeBridgeStatus> {
  if (typeof window === 'undefined') return { ...EMPTY_STATUS };
  return new Promise(resolve => {
    const requestId = 'sf-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    let settled = false;
    let timeoutId = 0;
    const finish = (status: OlympTradeBridgeStatus) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      window.removeEventListener('message', onMessage);
      resolve(status);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || data.channel !== CHANNEL || data.direction !== 'EXTENSION_RESPONSE' || data.requestId !== requestId) {
        return;
      }
      finish(sanitizeOlympTradeBridgeStatus(data.payload));
    };
    timeoutId = window.setTimeout(() => finish({ ...EMPTY_STATUS }), 1800);
    window.addEventListener('message', onMessage);
    window.postMessage({ channel: CHANNEL, direction: 'APP_REQUEST', requestId, command }, window.location.origin);
  });
}

export function computeDiagnosticCounts(instruments: readonly OlympTradeInstrument[]): OlympTradeDiagnosticCounts {
  const counts = emptyCounts();
  for (const inst of instruments) {
    counts.observed++;
    if (inst.availability === 'AVAILABLE') counts.available++;
    else if (inst.availability === 'UNAVAILABLE') counts.unavailable++;
    else counts.unknownAvailability++;

    if (inst.payoutPct !== null && Number.isFinite(inst.payoutPct)) {
      counts.knownPayout++;
      if (inst.payoutPct >= MIN_ELIGIBLE_PAYOUT_PCT) counts.payoutAtLeast80++;
    }

    if (!CONFIGURED_PAIR_SET.has(inst.pair)) {
      counts.outsideUniverse++;
    } else if (isInstrumentEligible(inst)) {
      counts.eligibleInUniverse++;
    }
  }
  return counts;
}

/**
 * Authoritative FAIL-CLOSED resolver for actionable Olymp Trade signal generation.
 * Never falls back to the 29-pair research universe when the broker snapshot is
 * missing, disconnected, login-required, stale (>45s), or lacks verified >=80% pairs.
 * Separately exposes ALL deduplicated broker-discovered instruments & active markets
 * so UI surfaces can display every active Olymp Trade pair without weakening eligibility.
 */
export function resolveActiveTradingPairs(
  status: OlympTradeBridgeStatus | null | undefined,
  nowMs: number = Date.now()
): ActiveTradingUniverse {
  if (!status || !status.extensionInstalled || !status.platformTabOpen) {
    return {
      mode: 'OLYMP_WAITING_FOR_SNAPSHOT',
      pairs: [],
      liveCount: 0,
      capturedAt: null,
      ageMs: null,
      reason: 'Waiting for authenticated Olymp Trade browser companion snapshot. Signal generation paused.',
      counts: emptyCounts(),
      eligibleDetails: {},
      extensionInstalled: Boolean(status?.extensionInstalled),
      extensionVersion: status?.extensionVersion ?? null,
      platformTabOpen: Boolean(status?.platformTabOpen),
      connected: false,
      sessionState: status?.sessionState ?? 'UNKNOWN',
      discoveredPairs: [],
      activePairs: [],
      unavailablePairs: [],
      unknownPairs: [],
      discoveredCount: 0,
      activeCount: 0,
      unavailableCount: 0,
      instruments: [],
    };
  }

  const byPair = new Map<string, OlympTradeInstrument>();
  for (const inst of status.instruments) {
    const pair = normalizePair(inst.pair);
    if (!pair) continue;
    const normalizedInst: OlympTradeInstrument = { ...inst, pair };
    const prev = byPair.get(pair);
    if (!prev || instrumentScore(normalizedInst) > instrumentScore(prev)) {
      byPair.set(pair, normalizedInst);
    }
  }
  const deduplicatedInstruments = Array.from(byPair.values()).sort((a, b) => a.pair.localeCompare(b.pair));
  const discoveredPairs = deduplicatedInstruments.map(inst => inst.pair);
  const activePairs = deduplicatedInstruments
    .filter(inst => inst.availability === 'AVAILABLE')
    .map(inst => inst.pair);
  const unavailablePairs = deduplicatedInstruments
    .filter(inst => inst.availability === 'UNAVAILABLE')
    .map(inst => inst.pair);
  const unknownPairs = deduplicatedInstruments
    .filter(inst => inst.availability === 'UNKNOWN')
    .map(inst => inst.pair);

  const rawCounts = computeDiagnosticCounts(deduplicatedInstruments);
  const baseDiscoveryFields = {
    extensionInstalled: status.extensionInstalled,
    extensionVersion: status.extensionVersion,
    platformTabOpen: status.platformTabOpen,
    sessionState: status.sessionState,
    discoveredPairs,
    activePairs,
    unavailablePairs,
    unknownPairs,
    discoveredCount: discoveredPairs.length,
    activeCount: activePairs.length,
    unavailableCount: unavailablePairs.length,
    instruments: deduplicatedInstruments,
  };

  if (status.sessionState === 'LOGIN_REQUIRED') {
    return {
      mode: 'OLYMP_LOGIN_REQUIRED',
      pairs: [],
      liveCount: 0,
      capturedAt: status.capturedAt,
      ageMs: status.ageMs,
      reason: 'Olymp Trade requires login. Signal generation paused until authenticated.',
      counts: { ...rawCounts, eligibleInUniverse: 0 },
      eligibleDetails: {},
      connected: false,
      ...baseDiscoveryFields,
    };
  }

  if (status.sessionState === 'STALE') {
    return {
      mode: 'OLYMP_STALE',
      pairs: [],
      liveCount: 0,
      capturedAt: status.capturedAt,
      ageMs: status.ageMs,
      reason: 'Olymp Trade browser snapshot is stale. Signal generation paused.',
      counts: { ...rawCounts, eligibleInUniverse: 0 },
      eligibleDetails: {},
      connected: false,
      ...baseDiscoveryFields,
    };
  }

  if (status.sessionState !== 'READY' || !status.connected || !status.capturedAt) {
    return {
      mode: 'OLYMP_WAITING_FOR_SNAPSHOT',
      pairs: [],
      liveCount: 0,
      capturedAt: status.capturedAt,
      ageMs: status.ageMs,
      reason: 'Olymp Trade market snapshot not ready or disconnected. Signal generation paused.',
      counts: { ...rawCounts, eligibleInUniverse: 0 },
      eligibleDetails: {},
      connected: false,
      ...baseDiscoveryFields,
    };
  }

  const capturedMs = Date.parse(status.capturedAt);
  const computedAgeMs = Number.isFinite(capturedMs) ? Math.max(0, nowMs - capturedMs) : Infinity;
  const effectiveAgeMs = status.ageMs !== null ? Math.max(computedAgeMs, status.ageMs) : computedAgeMs;

  if (!Number.isFinite(capturedMs) || effectiveAgeMs > SNAPSHOT_FRESHNESS_MS) {
    return {
      mode: 'OLYMP_STALE',
      pairs: [],
      liveCount: 0,
      capturedAt: status.capturedAt,
      ageMs: Number.isFinite(effectiveAgeMs) ? effectiveAgeMs : null,
      reason: 'Olymp Trade snapshot exceeded 45s freshness limit. Signal generation paused.',
      counts: { ...rawCounts, eligibleInUniverse: 0 },
      eligibleDetails: {},
      connected: false,
      ...baseDiscoveryFields,
      sessionState: 'STALE',
    };
  }

  const eligibleDetails: Partial<Record<ForexSymbol, EligiblePairDetail>> = {};
  const pairs: ForexSymbol[] = [];
  for (const pair of FOREX_PAIRS) {
    const inst = byPair.get(pair);
    if (inst && isInstrumentEligible(inst)) {
      pairs.push(pair);
      eligibleDetails[pair] = {
        payoutPct: inst.payoutPct!,
        availability: 'AVAILABLE',
        evidence: 'HIGH',
        sourceType: inst.sourceType || 'UNKNOWN',
      };
    }
  }

  if (pairs.length === 0) {
    return {
      mode: 'OLYMP_NO_ELIGIBLE_PAIRS',
      pairs: [],
      liveCount: 0,
      capturedAt: status.capturedAt,
      ageMs: effectiveAgeMs,
      reason: 'No configured 29-pair instrument is explicitly AVAILABLE with >=80% HIGH-confidence payout on Olymp Trade.',
      counts: { ...rawCounts, eligibleInUniverse: 0 },
      eligibleDetails: {},
      connected: status.connected,
      ...baseDiscoveryFields,
    };
  }

  return {
    mode: 'OLYMP_ACTIVE',
    pairs,
    liveCount: pairs.length,
    capturedAt: status.capturedAt,
    ageMs: effectiveAgeMs,
    reason: `Olymp Trade eligibility gate active across ${pairs.length} verified pair(s) paying >=80% (${activePairs.length} total active market(s) discovered).`,
    counts: { ...rawCounts, eligibleInUniverse: pairs.length },
    eligibleDetails,
    connected: true,
    ...baseDiscoveryFields,
  };
}

export function authorizeSignalWithBrokerSnapshot(
  symbol: ForexSymbol,
  status: OlympTradeBridgeStatus | null | undefined,
  nowMs: number = Date.now()
):
  | { authorized: true; eligibility: BrokerEligibilitySnapshot; universe: ActiveTradingUniverse }
  | { authorized: false; reason: string; universe: ActiveTradingUniverse } {
  const universe = resolveActiveTradingPairs(status, nowMs);
  if (universe.mode !== 'OLYMP_ACTIVE') {
    return { authorized: false, reason: universe.reason, universe };
  }
  const detail = universe.eligibleDetails[symbol];
  if (!detail || !universe.pairs.includes(symbol) || !universe.capturedAt) {
    return {
      authorized: false,
      reason: `${symbol} is not in the currently eligible Olymp Trade active-pair universe.`,
      universe,
    };
  }
  return {
    authorized: true,
    universe,
    eligibility: {
      broker: 'OLYMP_TRADE',
      mode: 'OLYMP_ACTIVE',
      pair: symbol,
      payoutPct: detail.payoutPct,
      availability: 'AVAILABLE',
      evidence: 'HIGH',
      snapshotCapturedAt: universe.capturedAt,
      verifiedAtUtc: new Date(nowMs).toISOString(),
    },
  };
}

export function isValidBrokerEligibilitySnapshot(
  eligibility: BrokerEligibilitySnapshot | null | undefined,
  expectedSymbol: ForexSymbol,
  nowMs: number = Date.now()
): boolean {
  if (!eligibility || typeof eligibility !== 'object') return false;
  if (eligibility.broker !== 'OLYMP_TRADE' || eligibility.mode !== 'OLYMP_ACTIVE') return false;
  if (eligibility.pair !== expectedSymbol || !CONFIGURED_PAIR_SET.has(expectedSymbol)) return false;
  if (eligibility.availability !== 'AVAILABLE' || eligibility.evidence !== 'HIGH') return false;
  if (
    typeof eligibility.payoutPct !== 'number' ||
    !Number.isFinite(eligibility.payoutPct) ||
    eligibility.payoutPct < MIN_ELIGIBLE_PAYOUT_PCT ||
    eligibility.payoutPct > 100
  ) {
    return false;
  }
  const capturedMs = Date.parse(eligibility.snapshotCapturedAt);
  if (!Number.isFinite(capturedMs)) return false;
  const ageMs = nowMs - capturedMs;
  return ageMs >= -5_000 && ageMs <= SNAPSHOT_FRESHNESS_MS;
}

/**
 * Determine whether the active runtime uses AI Studio manual-pair trading or strict Olymp Trade gating.
 * Published production (`DEPLOYED_PRODUCTION`) always enforces `OLYMP_TRADE`; AI Studio preview (`ais-dev-*`
 * or local Vite dev mode) defaults to `MANUAL_PAIRS`.
 */
export function resolveRuntimeTradingMode(
  env: Record<string, string | undefined> | undefined = typeof process !== 'undefined' ? process.env : undefined
): RuntimeTradingMode {
  const explicit = env?.SIGNALFORGE_TRADING_MODE;
  if (explicit === 'OLYMP_TRADE' || explicit === 'MANUAL_PAIRS') {
    return explicit;
  }
  const kService = env?.K_SERVICE || '';
  const isAiStudioDevPreview =
    kService.startsWith('ais-dev-') ||
    (env?.NODE_ENV !== 'production' && !kService.startsWith('ais-pre-'));
  return isAiStudioDevPreview ? 'MANUAL_PAIRS' : 'OLYMP_TRADE';
}

/**
 * Resolve an ActiveTradingUniverse payload from user-configured manual pairs for AI Studio preview mode.
 * Never used in DEPLOYED_PRODUCTION where Olymp Trade fail-closed gating is mandatory.
 */
export function resolveManualTradingUniverse(
  manualPairs: readonly ForexSymbol[],
  nowMs: number = Date.now()
): ActiveTradingUniverse {
  const validSet = new Set<ForexSymbol>(FOREX_PAIRS);
  const unique = new Set<ForexSymbol>();
  for (const pair of manualPairs) {
    if (validSet.has(pair)) unique.add(pair);
  }
  const active = Array.from(unique);
  const capturedAt = new Date(nowMs).toISOString();
  const instruments: OlympTradeInstrument[] = active.map(pair => ({
    pair,
    payoutPct: 82,
    availability: 'AVAILABLE',
    evidence: 'HIGH',
    sourceType: 'MARKET_LIST',
  }));
  const eligibleDetails: Partial<Record<ForexSymbol, EligiblePairDetail>> = {};
  for (const pair of active) {
    eligibleDetails[pair] = {
      payoutPct: 82,
      availability: 'AVAILABLE',
      evidence: 'HIGH',
      sourceType: 'MARKET_LIST',
    };
  }
  const counts: OlympTradeDiagnosticCounts = {
    observed: active.length,
    available: active.length,
    unavailable: 0,
    unknownAvailability: 0,
    knownPayout: active.length,
    payoutAtLeast80: active.length,
    eligibleInUniverse: active.length,
    outsideUniverse: 0,
  };

  if (active.length === 0) {
    return {
      mode: 'OLYMP_NO_ELIGIBLE_PAIRS',
      tradingMode: 'MANUAL_PAIRS',
      pairs: [],
      liveCount: 0,
      capturedAt,
      ageMs: 0,
      reason: 'AI Studio preview: no manual pairs enabled in Bot Controls. Enable at least 1 pair to resume discovery.',
      counts,
      eligibleDetails: {},
      extensionInstalled: false,
      extensionVersion: null,
      platformTabOpen: false,
      connected: true,
      sessionState: 'READY',
      discoveredPairs: [],
      activePairs: [],
      unavailablePairs: [],
      unknownPairs: [],
      discoveredCount: 0,
      activeCount: 0,
      unavailableCount: 0,
      instruments: [],
    };
  }

  return {
    mode: 'MANUAL_ACTIVE',
    tradingMode: 'MANUAL_PAIRS',
    pairs: active,
    liveCount: active.length,
    capturedAt,
    ageMs: 0,
    reason: `AI Studio preview active: trading on ${active.length} manual pair(s) from Bot Controls (published app enforces live Olymp Trade).`,
    counts,
    eligibleDetails,
    extensionInstalled: false,
    extensionVersion: null,
    platformTabOpen: false,
    connected: true,
    sessionState: 'READY',
    discoveredPairs: active,
    activePairs: active,
    unavailablePairs: [],
    unknownPairs: [],
    discoveredCount: active.length,
    activeCount: active.length,
    unavailableCount: 0,
    instruments,
  };
}
