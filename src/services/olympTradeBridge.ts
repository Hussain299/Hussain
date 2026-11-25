export type OlympTradeSessionState = 'READY' | 'LOGIN_REQUIRED' | 'WAITING_FOR_MARKET_DATA' | 'NO_PLATFORM_TAB' | 'STALE' | 'UNKNOWN';
export type OlympTradeAvailability = 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
export type OlympTradeEvidence = 'HIGH' | 'MEDIUM' | 'NONE';

export interface OlympTradeInstrument {
  pair: string;
  payoutPct: number | null;
  availability: OlympTradeAvailability;
  evidence: OlympTradeEvidence;
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

const CHANNEL = 'SIGNALFORGE_OLYMP_TRADE_BRIDGE';
const EMPTY_STATUS: OlympTradeBridgeStatus = {
  extensionInstalled: false, extensionVersion: null, platformTabOpen: false,
  connected: false, sessionState: 'UNKNOWN', capturedAt: null, ageMs: null, instruments: [],
};

function normalizePair(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const pair = value.trim().toUpperCase().replace(/\s+/g, '');
  return /^[A-Z]{3}\/[A-Z]{3}$/.test(pair) ? pair : null;
}

/** Accept only the fields needed by this read-only panel from the local extension. */
export function sanitizeOlympTradeBridgeStatus(value: unknown): OlympTradeBridgeStatus {
  if (!value || typeof value !== 'object') return { ...EMPTY_STATUS };
  const raw = value as Record<string, unknown>;
  const capturedAt = typeof raw.capturedAt === 'string' && Number.isFinite(Date.parse(raw.capturedAt))
    ? new Date(raw.capturedAt).toISOString() : null;
  const ageMs = typeof raw.ageMs === 'number' && Number.isFinite(raw.ageMs) && raw.ageMs >= 0
    ? Math.min(raw.ageMs, 7 * 24 * 60 * 60 * 1000)
    : capturedAt ? Math.max(0, Date.now() - Date.parse(capturedAt)) : null;
  const allowedStates: OlympTradeSessionState[] = [
    'READY', 'LOGIN_REQUIRED', 'WAITING_FOR_MARKET_DATA', 'NO_PLATFORM_TAB', 'STALE', 'UNKNOWN',
  ];
  const sessionState = allowedStates.includes(raw.sessionState as OlympTradeSessionState)
    ? raw.sessionState as OlympTradeSessionState : 'UNKNOWN';
  const unique = new Map<string, OlympTradeInstrument>();

  if (Array.isArray(raw.instruments)) {
    for (const item of raw.instruments.slice(0, 300)) {
      if (!item || typeof item !== 'object') continue;
      const instrument = item as Record<string, unknown>;
      const pair = normalizePair(instrument.pair);
      if (!pair) continue;
      const payout = typeof instrument.payoutPct === 'number' &&
        Number.isFinite(instrument.payoutPct) && instrument.payoutPct >= 50 && instrument.payoutPct <= 100
        ? Math.round(instrument.payoutPct * 100) / 100 : null;
      const availability: OlympTradeAvailability =
        instrument.availability === 'AVAILABLE' || instrument.availability === 'UNAVAILABLE'
          ? instrument.availability : 'UNKNOWN';
      const evidence: OlympTradeEvidence =
        instrument.evidence === 'HIGH' || instrument.evidence === 'MEDIUM'
          ? instrument.evidence : 'NONE';
      const next = { pair, payoutPct: payout, availability, evidence };
      const previous = unique.get(pair);
      if (!previous || (next.payoutPct !== null && previous.payoutPct === null) ||
          (next.evidence === 'HIGH' && previous.evidence !== 'HIGH')) unique.set(pair, next);
    }
  }

  const extensionInstalled = raw.extensionInstalled === true;
  const platformTabOpen = raw.platformTabOpen === true;
  const connected = extensionInstalled && platformTabOpen && raw.connected === true &&
    sessionState === 'READY' && ageMs !== null && ageMs <= 45_000 && unique.size > 0;
  return {
    extensionInstalled,
    extensionVersion: typeof raw.extensionVersion === 'string' ? raw.extensionVersion.slice(0, 32) : null,
    platformTabOpen, connected, sessionState, capturedAt, ageMs,
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
      if (!data || data.channel !== CHANNEL || data.direction !== 'EXTENSION_RESPONSE' ||
          data.requestId !== requestId) return;
      finish(sanitizeOlympTradeBridgeStatus(data.payload));
    };
    timeoutId = window.setTimeout(() => finish({ ...EMPTY_STATUS }), 1400);
    window.addEventListener('message', onMessage);
    window.postMessage({ channel: CHANNEL, direction: 'APP_REQUEST', requestId, command }, window.location.origin);
  });
}
