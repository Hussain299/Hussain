const STORAGE_KEY = 'signalforgeOlympTradeSnapshot';
const CATALOG_STORAGE_KEY = 'signalforgeOlympMarketCatalog';
const MAX_AGE_MS = 45_000;
const CATALOG_RETENTION_MS = 4 * 60 * 60_000;
const SIGNALFORGE_PROD_SNAPSHOT_URL = 'https://signalforge-ml.ai.studio/api/broker/olymptrade/snapshot';
const PUSH_MIN_INTERVAL_MS = 12_000;
const ALARM_NAME = 'signalforgeOlympKeepalive';
let lastServerPushAtMs = 0;

async function pushStatusToServer(force = false) {
  const nowMs = Date.now();
  if (!force && nowMs - lastServerPushAtMs < PUSH_MIN_INTERVAL_MS) return;
  try {
    const status = await makeStatus();
    if (!status || !status.extensionInstalled) return;
    lastServerPushAtMs = nowMs;
    await fetch(SIGNALFORGE_PROD_SNAPSHOT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(status),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // Non-fatal: tab relay or next alarm will retry
  }
}

function ensureKeepaliveAlarm() {
  if (!chrome.alarms) return;
  chrome.alarms.get(ALARM_NAME, (existing) => {
    if (!existing) {
      chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });
    }
  });
}

chrome.runtime.onInstalled.addListener(() => ensureKeepaliveAlarm());
chrome.runtime.onStartup.addListener(() => ensureKeepaliveAlarm());
ensureKeepaliveAlarm();

if (chrome.alarms) {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== ALARM_NAME) return;
    try {
      const tabs = await chrome.tabs.query({ url: ['https://olymptrade.com/*', 'https://*.olymptrade.com/*'] });
      if (tabs.length === 0) return;
      await Promise.all(
        tabs.map((tab) =>
          tab.id ? chrome.tabs.sendMessage(tab.id, { type: 'OLYMP_SCAN_NOW' }).catch(() => undefined) : Promise.resolve()
        )
      );
      await new Promise((r) => setTimeout(r, 450));
      await pushStatusToServer(true);
    } catch {}
  });
}

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

function instrumentScore(row) {
  return (
    (row.availability === 'AVAILABLE' ? 200 : row.availability === 'UNAVAILABLE' ? 50 : 0) +
    (row.evidence === 'HIGH' ? 100 : row.evidence === 'MEDIUM' ? 30 : 0) +
    (row.payoutPct !== null ? 40 : 0) +
    (row.sourceType === 'MARKET_LIST' ? 10 : 0)
  );
}

function cleanSnapshot(value, tabId) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.instruments)) return null;
  const byPair = new Map();
  for (const row of value.instruments) {
    if (!row || typeof row.pair !== 'string') continue;
    const pair = row.pair.trim().toUpperCase();
    if (!/^[A-Z]{3}\/[A-Z]{3}$/.test(pair)) continue;
    const [base, quote] = pair.split('/');
    if (base === quote) continue;
    const payoutPct = typeof row.payoutPct === 'number' && Number.isFinite(row.payoutPct) && row.payoutPct >= 50 && row.payoutPct <= 100
      ? Math.round(row.payoutPct * 100) / 100 : null;
    const availability = row.availability === 'AVAILABLE' || row.availability === 'UNAVAILABLE' ? row.availability : 'UNKNOWN';
    const evidence = row.evidence === 'HIGH' || row.evidence === 'MEDIUM' ? row.evidence : 'NONE';
    const sourceType = row.sourceType === 'MARKET_LIST' || row.sourceType === 'TAB' ? row.sourceType : 'UNKNOWN';
    const cleaned = { pair, payoutPct, availability, evidence, sourceType };
    const prev = byPair.get(pair);
    if (!prev || instrumentScore(cleaned) > instrumentScore(prev)) {
      byPair.set(pair, cleaned);
    }
  }
  const instruments = Array.from(byPair.values()).sort((a, b) => a.pair.localeCompare(b.pair));
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

  const instruments = (fresh && snapshot) ? snapshot.instruments : [];
  const capturedAt = (fresh && snapshot) ? snapshot.capturedAt : null;

  return {
    extensionInstalled: true,
    extensionVersion: chrome.runtime.getManifest().version,
    platformTabOpen: tabIsOpen,
    connected: fresh && sessionState === 'READY' && instruments.length > 0,
    sessionState,
    capturedAt,
    ageMs: fresh ? ageMs : null,
    instruments,
  };
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    const stored = await chrome.storage.local.get([STORAGE_KEY, CATALOG_STORAGE_KEY]);
    const snapshot = stored[STORAGE_KEY];
    if (snapshot && snapshot.tabId === tabId) {
      await chrome.storage.local.remove(STORAGE_KEY);
    }
    const catalog = stored[CATALOG_STORAGE_KEY];
    if (catalog && catalog.tabId === tabId) {
      await chrome.storage.local.remove(CATALOG_STORAGE_KEY);
    }
  } catch {}
});

async function mergeWithPersistentCatalog(snapshot) {
  const nowMs = Date.now();
  if (snapshot.sessionState === 'LOGIN_REQUIRED') {
    await chrome.storage.local.remove(CATALOG_STORAGE_KEY);
    return snapshot;
  }

  const stored = await chrome.storage.local.get(CATALOG_STORAGE_KEY);
  const existing = stored[CATALOG_STORAGE_KEY];
  const sameOrAnyEntries =
    existing &&
    existing.entries &&
    typeof existing.entries === 'object' &&
    (existing.tabId === snapshot.tabId || existing.entries)
      ? { ...existing.entries }
      : {};

  for (const [pair, item] of Object.entries(sameOrAnyEntries)) {
    if (!item || typeof item.seenAt !== 'number' || nowMs - item.seenAt > CATALOG_RETENTION_MS) {
      delete sameOrAnyEntries[pair];
    }
  }

  // If the Olymp Trade tab is transiently throttled/loading (0 visible instruments),
  // retain unexpired cached market catalog entries instead of blanking out the snapshot.
  if (snapshot.sessionState !== 'READY' || snapshot.instruments.length === 0) {
    const restored = Object.values(sameOrAnyEntries)
      .map(entry => entry && entry.row)
      .filter(Boolean)
      .sort((a, b) => a.pair.localeCompare(b.pair));
    if (restored.length > 0) {
      return {
        ...snapshot,
        sessionState: 'READY',
        instruments: restored,
      };
    }
    return snapshot;
  }

  const entries = sameOrAnyEntries;

  const hasMarketListScan =
    snapshot.instruments.length > 10 ||
    snapshot.instruments.some(row => row.sourceType === 'MARKET_LIST');

  for (const row of snapshot.instruments) {
    if (row.sourceType === 'MARKET_LIST' || (hasMarketListScan && row.sourceType !== 'TAB')) {
      entries[row.pair] = { row, seenAt: nowMs };
    } else if (entries[row.pair]) {
      // Never let a bare TAB entry with null payout / lower score downgrade cached MARKET_LIST payout or evidence
      const prevRow = entries[row.pair].row;
      const mergedRow =
        instrumentScore(row) >= instrumentScore(prevRow)
          ? row
          : {
              ...prevRow,
              availability: row.availability !== 'UNKNOWN' ? row.availability : prevRow.availability,
              payoutPct: row.payoutPct !== null ? row.payoutPct : prevRow.payoutPct,
              evidence: row.payoutPct !== null && row.evidence !== 'NONE' ? row.evidence : prevRow.evidence,
            };
      entries[row.pair] = { row: mergedRow, seenAt: nowMs };
    }
  }

  await chrome.storage.local.set({
    [CATALOG_STORAGE_KEY]: { tabId: snapshot.tabId, updatedAt: nowMs, entries },
  });

  const mergedByPair = new Map();
  for (const row of snapshot.instruments) {
    mergedByPair.set(row.pair, row);
  }
  for (const [pair, entry] of Object.entries(entries)) {
    if (!entry || !entry.row) continue;
    const current = mergedByPair.get(pair);
    if (!current || instrumentScore(entry.row) > instrumentScore(current)) {
      mergedByPair.set(pair, entry.row);
    }
  }

  const mergedInstruments = Array.from(mergedByPair.values()).sort((a, b) => a.pair.localeCompare(b.pair));
  return { ...snapshot, instruments: mergedInstruments };
}

let snapshotWriteQueue = Promise.resolve();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;

  if (message.type === 'OLYMP_SNAPSHOT') {
    const sourceUrl = sender.tab && sender.tab.url ? sender.tab.url : (sender.url || '');
    if (!isOlympTradeUrl(sourceUrl) || !sender.tab || !sender.tab.id) {
      sendResponse({ ok: false, error: 'UNTRUSTED_SOURCE' });
      return false;
    }
    const rawSnapshot = cleanSnapshot(message.payload, sender.tab.id);
    if (!rawSnapshot) { sendResponse({ ok: false, error: 'INVALID_SNAPSHOT' }); return false; }
    // Serialize storage read-modify-write ops to prevent interleaved observer/scroll bursts dropping pairs
    snapshotWriteQueue = snapshotWriteQueue
      .catch(() => undefined)
      .then(() => mergeWithPersistentCatalog(rawSnapshot))
      .then((snapshot) =>
        chrome.storage.local.set({ [STORAGE_KEY]: snapshot }).then(() => snapshot)
      )
      .then(
        (snapshot) => {
          void pushStatusToServer(snapshot.instruments.length > 0 && snapshot.sessionState === 'READY');
          sendResponse({ ok: true });
        },
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
        await new Promise(r => setTimeout(r, 600));
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
