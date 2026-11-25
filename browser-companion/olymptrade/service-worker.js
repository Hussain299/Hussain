const STORAGE_KEY = 'signalforgeOlympTradeSnapshot';
const MAX_AGE_MS = 30_000;

function hostnameOf(value) {
  try { return new URL(value).hostname.toLowerCase(); } catch { return ''; }
}
function isOlympTradeUrl(value) {
  const host = hostnameOf(value);
  return host === 'olymptrade.com' || host.endsWith('.olymptrade.com');
}
function isSignalForgeUrl(value) {
  const host = hostnameOf(value);
  return host === 'signalforge-ml.ai.studio' || host === 'localhost' || host === '127.0.0.1';
}
function cleanSnapshot(value, tabId) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.instruments)) return null;
  const instruments = [];
  const seen = new Set();
  for (const row of value.instruments.slice(0, 300)) {
    if (!row || typeof row.pair !== 'string') continue;
    const pair = row.pair.trim().toUpperCase();
    if (!/^[A-Z]{3}\\/[A-Z]{3}$/.test(pair) || seen.has(pair)) continue;
    seen.add(pair);
    const payoutPct = typeof row.payoutPct === 'number' && Number.isFinite(row.payoutPct) && row.payoutPct >= 50 && row.payoutPct <= 100
      ? Math.round(row.payoutPct * 100) / 100 : null;
    const availability = row.availability === 'AVAILABLE' || row.availability === 'UNAVAILABLE' ? row.availability : 'UNKNOWN';
    const evidence = row.evidence === 'HIGH' || row.evidence === 'MEDIUM' ? row.evidence : 'NONE';
    instruments.push({ pair, payoutPct, availability, evidence });
  }
  const sessionState = value.sessionState === 'READY' || value.sessionState === 'LOGIN_REQUIRED'
    ? value.sessionState : 'WAITING_FOR_MARKET_DATA';
  return { tabId, capturedAt: new Date().toISOString(), sessionState, instruments };
}
async function makeStatus() {
  const [platformTabs, stored] = await Promise.all([
    chrome.tabs.query({ url: ['https://olymptrade.com/*', 'https://*.olymptrade.com/*'] }),
    chrome.storage.local.get(STORAGE_KEY),
  ]);
  const snapshot = stored[STORAGE_KEY] || null;
  const tabIsOpen = platformTabs.length > 0;
  const snapshotTabOpen = !!snapshot && platformTabs.some(tab => tab.id === snapshot.tabId);
  const capturedAtMs = snapshot && snapshot.capturedAt ? Date.parse(snapshot.capturedAt) : NaN;
  const ageMs = Number.isFinite(capturedAtMs) ? Math.max(0, Date.now() - capturedAtMs) : null;
  const fresh = snapshotTabOpen && ageMs !== null && ageMs <= MAX_AGE_MS;
  let sessionState = 'NO_PLATFORM_TAB';
  if (tabIsOpen && !snapshotTabOpen) sessionState = 'WAITING_FOR_MARKET_DATA';
  else if (snapshotTabOpen && !fresh) sessionState = 'STALE';
  else if (fresh) sessionState = snapshot.sessionState;
  return {
    extensionInstalled: true,
    extensionVersion: chrome.runtime.getManifest().version,
    platformTabOpen: tabIsOpen,
    connected: fresh && sessionState === 'READY' && snapshot.instruments.length > 0,
    sessionState,
    capturedAt: snapshot ? snapshot.capturedAt : null,
    ageMs,
    instruments: snapshot ? snapshot.instruments : [],
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;
  if (message.type === 'OLYMP_SNAPSHOT') {
    const sourceUrl = sender.tab && sender.tab.url ? sender.tab.url : (sender.url || '');
    if (!isOlympTradeUrl(sourceUrl) || !sender.tab || !sender.tab.id) {
      sendResponse({ ok: false, error: 'UNTRUSTED_SOURCE' });
      return false;
    }
    const snapshot = cleanSnapshot(message.payload, sender.tab.id);
    if (!snapshot) { sendResponse({ ok: false, error: 'INVALID_SNAPSHOT' }); return false; }
    chrome.storage.local.set({ [STORAGE_KEY]: snapshot }).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false, error: 'STORAGE_FAILED' })
    );
    return true;
  }

  if (message.type === 'GET_STATUS' || message.type === 'REFRESH') {
    const sourceUrl = sender.tab && sender.tab.url ? sender.tab.url : (sender.url || '');
    if (!isSignalForgeUrl(sourceUrl)) {
      sendResponse({ extensionInstalled: true, connected: false, sessionState: 'UNKNOWN', instruments: [] });
      return false;
    }
    if (message.type === 'REFRESH') {
      chrome.tabs.query({ url: ['https://olymptrade.com/*', 'https://*.olymptrade.com/*'] }).then(async tabs => {
        await Promise.all(tabs.map(tab => tab.id
          ? chrome.tabs.sendMessage(tab.id, { type: 'OLYMP_SCAN_NOW' }).catch(() => undefined)
          : Promise.resolve()));
        sendResponse(await makeStatus());
      }).catch(async () => sendResponse(await makeStatus()));
      return true;
    }
    makeStatus().then(sendResponse).catch(() =>
      sendResponse({ extensionInstalled: true, connected: false, sessionState: 'UNKNOWN', instruments: [] })
    );
    return true;
  }
  return false;
});
