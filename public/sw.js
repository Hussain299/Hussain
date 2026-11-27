/**
 * SignalForge ML — Advanced Service Worker
 * Maintains background execution bridge, periodic background sync,
 * offline caching, and system notifications for trade settlements and signal alerts.
 */

const CACHE_VERSION = 'signalforge-v3.2.0';
const STATIC_CACHE = `signalforge-static-${CACHE_VERSION}`;
const API_CACHE = `signalforge-api-${CACHE_VERSION}`;

const PRECACHE_ASSETS = [
  '/manifest.webmanifest',
  '/icon.svg',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png',
  '/apple-touch-icon.png'
];

// In-worker execution metrics
let backgroundPulsesCount = 0;
let lastPulseTimestamp = null;
let lastHeartbeatStatus = 'INIT';

// ---------------------------------------------------------------------------
// 1. INSTALLATION & PRECACHE
// ---------------------------------------------------------------------------
self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Installing SignalForge Service Worker v3.0.0...');
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[ServiceWorker] Precaching app shell assets');
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[ServiceWorker] Some assets failed to precache (non-fatal):', err);
      });
    }).then(() => {
      // Force immediate activation without waiting for existing tabs to close
      return self.skipWaiting();
    })
  );
});

// ---------------------------------------------------------------------------
// 2. ACTIVATION & CACHE CLEANUP
// ---------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activating SignalForge Service Worker v3.0.0...');
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== STATIC_CACHE && key !== API_CACHE) {
            console.log('[ServiceWorker] Purging stale legacy cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => {
      // Claim all clients immediately so the service worker controls active pages
      return self.clients.claim();
    }).then(() => {
      console.log('[ServiceWorker] SignalForge Service Worker active and controlling clients.');
      broadcastToClients({
        type: 'SW_ACTIVATED',
        timestamp: new Date().toISOString(),
        version: CACHE_VERSION
      });
    })
  );
});

// ---------------------------------------------------------------------------
// 3. FETCH STRATEGY: NetworkFirst for API, direct bypass for Vite/dev scripts
// ---------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ignore non-GET requests, cross-origin requests (e.g. Firebase/Google APIs), or non-HTTP protocols
  if (
    event.request.method !== 'GET' ||
    !url.protocol.startsWith('http') ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  // Never intercept or cache development scripts, modules, or Vite internals
  if (
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/@') ||
    url.pathname.startsWith('/node_modules/') ||
    url.pathname.endsWith('.tsx') ||
    url.pathname.endsWith('.ts') ||
    url.pathname.endsWith('.mjs') ||
    url.search.includes('t=') ||
    url.search.includes('import')
  ) {
    return; // Pass through straight to network
  }

  // A. API Requests: Strictly pass through directly to network (NEVER cache /api/signals or trade history!)
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // B. Static Assets: Network-first for HTML, Cache-first for icons/manifest
  if (url.pathname.endsWith('.png') || url.pathname.endsWith('.svg') || url.pathname.endsWith('.webmanifest')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        return cached || fetch(event.request).then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(STATIC_CACHE).then(c => c.put(event.request, clone));
          }
          return res;
        });
      })
    );
    return;
  }
});

// ---------------------------------------------------------------------------
// 4. PERIODIC BACKGROUND SYNC & KEEP-ALIVE
// (Runs even when browser tabs are closed in supported browsers)
// ---------------------------------------------------------------------------
self.addEventListener('periodicsync', (event) => {
  console.log('[ServiceWorker] Periodic background sync event fired:', event.tag);
  if (event.tag === 'signalforge-periodic-pulse' || event.tag === 'signalforge-heartbeat') {
    event.waitUntil(executeBackgroundPulse('PERIODIC_SYNC'));
  }
});

// ---------------------------------------------------------------------------
// 5. STANDARD BACKGROUND SYNC (Fires upon network recovery)
// ---------------------------------------------------------------------------
self.addEventListener('sync', (event) => {
  console.log('[ServiceWorker] Background sync event fired:', event.tag);
  if (event.tag === 'signalforge-sync' || event.tag === 'signalforge-heartbeat') {
    event.waitUntil(executeBackgroundPulse('ONE_SHOT_SYNC'));
  }
});

/**
 * Executes an autonomous background pulse via the backend API.
 * Keeps the scheduler running, evaluates active trades, and dispatches notifications.
 */
async function executeBackgroundPulse(triggerSource) {
  try {
    console.log(`[ServiceWorker] Executing background pulse via ${triggerSource}...`);
    const response = await fetch('/api/scheduler/pulse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: `SERVICE_WORKER_${triggerSource}` })
    });

    if (response.ok) {
      const data = await response.json();
      backgroundPulsesCount++;
      lastPulseTimestamp = new Date().toISOString();
      lastHeartbeatStatus = 'HEALTHY';

      // Check if any trade was settled in this pulse
      if (data.newlySettled && Array.isArray(data.newlySettled) && data.newlySettled.length > 0) {
        await Promise.allSettled(data.newlySettled.map(trade => showSettlementNotification(trade)));
      }

      // Check if any fresh high-confidence signal was emitted
      if (data.newlyEmitted && Array.isArray(data.newlyEmitted) && data.newlyEmitted.length > 0) {
        await Promise.allSettled(data.newlyEmitted.map(sig => showSignalNotification(sig)));
      }

      await broadcastToClients({
        type: 'BACKGROUND_PULSE_SUCCESS',
        triggerSource,
        timestamp: lastPulseTimestamp,
        pulsesCount: backgroundPulsesCount,
        summary: data.summary || null
      });

      console.log('[ServiceWorker] Background pulse successfully completed:', data.summary);
    } else {
      lastHeartbeatStatus = 'SERVER_ERROR';
    }
  } catch (err) {
    console.warn('[ServiceWorker] Background pulse failed (server offline or unreachable):', err.message);
    lastHeartbeatStatus = 'NETWORK_OFFLINE';
  }
}

// ---------------------------------------------------------------------------
// 6. SYSTEM NOTIFICATIONS
// ---------------------------------------------------------------------------
function showSettlementNotification(trade) {
  if (!self.Notification || Notification.permission !== 'granted') return Promise.resolve();

  const isWin = trade.outcomeResult === 'WIN';
  const title = isWin
    ? `🎯 SignalForge WIN: ${trade.symbol}`
    : `⚠️ SignalForge LOSS: ${trade.symbol}`;

  const body = `${trade.direction} 5M Contract Settled: ${trade.outcomeResult} (${isWin ? '+' : ''}${trade.netReturnUnits} U, ${trade.grossReturnPips} pips)`;

  return self.registration.showNotification(title, {
    body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: `settle_${trade.id}`,
    data: { url: '/', signalId: trade.id },
    vibrate: [200, 100, 200]
  });
}

function showSignalNotification(signal) {
  if (!self.Notification || Notification.permission !== 'granted') return Promise.resolve();

  const title = `⚡ SignalForge Alert: ${signal.symbol} ${signal.direction}`;
  const body = `Causal setup verified with ${(signal.confidence * 100).toFixed(0)}% confidence at ${signal.triggerPrice}`;

  return self.registration.showNotification(title, {
    body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: `signal_${signal.id}`,
    data: { url: '/', signalId: signal.id }
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

// ---------------------------------------------------------------------------
// 7. CLIENT MESSAGING BRIDGE
// ---------------------------------------------------------------------------
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (data.type === 'PING') {
    event.source?.postMessage({
      type: 'PONG',
      version: CACHE_VERSION,
      status: lastHeartbeatStatus,
      pulsesCount: backgroundPulsesCount,
      lastPulse: lastPulseTimestamp,
      timestamp: new Date().toISOString()
    });
  }

  if (data.type === 'FORCE_BACKGROUND_PULSE') {
    const task = executeBackgroundPulse('MANUAL_CLIENT_TRIGGER').then(() => {
      event.source?.postMessage({
        type: 'FORCE_PULSE_ACK',
        timestamp: new Date().toISOString()
      });
    });
    if (typeof event.waitUntil === 'function') {
      event.waitUntil(task);
    }
  }
});

function broadcastToClients(message) {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    clients.forEach((client) => client.postMessage(message));
  });
}
