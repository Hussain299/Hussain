(() => {
  const CHANNEL = 'SIGNALFORGE_OLYMP_TRADE_BRIDGE';
  if (window.__signalForgeOlympBridgeInstalled) return;
  window.__signalForgeOlympBridgeInstalled = true;
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL || data.direction !== 'APP_REQUEST' ||
      typeof data.requestId !== 'string' ||
      (data.command !== 'GET_STATUS' && data.command !== 'REFRESH')) return;
    chrome.runtime.sendMessage({ type: data.command }).then(
      payload => window.postMessage({
        channel: CHANNEL, direction: 'EXTENSION_RESPONSE', requestId: data.requestId, payload,
      }, window.location.origin),
      () => window.postMessage({
        channel: CHANNEL, direction: 'EXTENSION_RESPONSE', requestId: data.requestId,
        payload: { extensionInstalled: false, platformTabOpen: false, connected: false, sessionState: 'UNKNOWN', instruments: [] },
      }, window.location.origin)
    );
  });
})();
