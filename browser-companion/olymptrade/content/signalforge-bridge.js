(() => {
  const CHANNEL = 'SIGNALFORGE_OLYMP_TRADE_BRIDGE';
  if (window.__signalForgeOlympBridgeInstalled) return;
  window.__signalForgeOlympBridgeInstalled = true;

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL || data.direction !== 'APP_REQUEST' ||
      typeof data.requestId !== 'string' || !data.requestId.startsWith('sf-') ||
      (data.command !== 'GET_STATUS' && data.command !== 'REFRESH')) return;

    // Validate requestId format to prevent injection
    if (data.requestId.length > 64) return;

    chrome.runtime.sendMessage({ type: data.command }).then(
      payload => {
        // Strip any unexpected fields before forwarding
        const safe = payload && typeof payload === 'object' ? {
          extensionInstalled: payload.extensionInstalled === true,
          extensionVersion: typeof payload.extensionVersion === 'string' ? payload.extensionVersion : null,
          platformTabOpen: payload.platformTabOpen === true,
          connected: payload.connected === true,
          sessionState: typeof payload.sessionState === 'string' ? payload.sessionState : 'UNKNOWN',
          capturedAt: typeof payload.capturedAt === 'string' ? payload.capturedAt : null,
          ageMs: typeof payload.ageMs === 'number' ? payload.ageMs : null,
          instruments: Array.isArray(payload.instruments) ? payload.instruments : [],
        } : {
          extensionInstalled: false, platformTabOpen: false, connected: false,
          sessionState: 'UNKNOWN', instruments: [],
        };

        window.postMessage({
          channel: CHANNEL, direction: 'EXTENSION_RESPONSE',
          requestId: data.requestId, payload: safe,
        }, window.location.origin);
      },
      () => window.postMessage({
        channel: CHANNEL, direction: 'EXTENSION_RESPONSE', requestId: data.requestId,
        payload: {
          extensionInstalled: false, platformTabOpen: false, connected: false,
          sessionState: 'UNKNOWN', instruments: [],
        },
      }, window.location.origin)
    );
  });
})();
