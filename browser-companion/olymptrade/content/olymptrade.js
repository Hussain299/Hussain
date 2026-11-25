(() => {
  if (window.__signalForgeOlympObserverInstalled) return;
  window.__signalForgeOlympObserverInstalled = true;
  const CURRENCIES = new Set([
    'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'MXN', 'NOK', 'SEK', 'SGD',
    'ZAR', 'TRY', 'PLN', 'HKD', 'CNY', 'INR', 'BRL', 'CZK', 'HUF', 'DKK', 'ILS', 'AED',
    'SAR', 'THB', 'IDR', 'MYR', 'PHP', 'KRW',
  ]);
  const PAIR_REGEX = /\b([A-Z]{3})\s*\/\s*([A-Z]{3})\b/g;
  const PAYOUT_LABEL_REGEX = /(?:payout|profit|return|income|yield)[^\d]{0,32}(\d{2,3}(?:\.\d{1,2})?)\s*%/i;
  const PERCENT_REGEX = /(?:^|[\s+])([5-9]\d(?:\.\d{1,2})?|100(?:\.0{1,2})?)\s*%/g;
  const CANDIDATE_SELECTOR = ['button', '[role="button"]', '[role="option"]', '[role="tab"]',
    '[data-testid]', '[data-asset]', '[data-symbol]', '[aria-label]', 'li'].join(',');

  function isVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
  }
  function readText(element) {
    return [element.innerText || '', element.getAttribute('aria-label') || '',
      element.getAttribute('title') || '', element.getAttribute('data-asset') || '',
      element.getAttribute('data-symbol') || ''].join(' ').replace(/\s+/g, ' ').trim().slice(0, 240);
  }
  function findPairs(text) {
    const pairs = new Set();
    for (const match of text.toUpperCase().matchAll(PAIR_REGEX)) {
      if (CURRENCIES.has(match[1]) && CURRENCIES.has(match[2])) pairs.add(match[1] + '/' + match[2]);
    }
    return Array.from(pairs);
  }
  function findPayout(text, pair) {
    const labeled = text.match(PAYOUT_LABEL_REGEX);
    if (labeled) {
      const value = Number(labeled[1]);
      if (value >= 50 && value <= 100) return { payoutPct: value, evidence: 'HIGH' };
    }
    const pairIndex = text.toUpperCase().indexOf(pair);
    if (pairIndex >= 0) {
      const afterPair = text.slice(pairIndex + pair.length, pairIndex + pair.length + 36);
      const adjacent = afterPair.match(/^[^\d]{0,16}(\d{2,3}(?:\.\d{1,2})?)\s*%/);
      if (adjacent) {
        const value = Number(adjacent[1]);
        if (value >= 50 && value <= 100) return { payoutPct: value, evidence: 'HIGH' };
      }
    }
    const percentages = Array.from(text.matchAll(PERCENT_REGEX)).map(match => Number(match[1]))
      .filter(value => value >= 50 && value <= 100);
    if (percentages.length === 1) return { payoutPct: percentages[0], evidence: 'MEDIUM' };
    return { payoutPct: null, evidence: 'NONE' };
  }
  function readInstruments() {
    const found = new Map();
    const nodes = Array.from(document.querySelectorAll(CANDIDATE_SELECTOR)).slice(0, 2500);
    for (const element of nodes) {
      if (!isVisible(element)) continue;
      const text = readText(element);
      if (!text || text.length > 240) continue;
      const pairs = findPairs(text);
      if (!pairs.length) continue;
      const classText = typeof element.className === 'string' ? element.className : '';
      const isDisabled = element.hasAttribute('disabled') ||
        element.getAttribute('aria-disabled') === 'true' ||
        /\b(disabled|unavailable|closed)\b/i.test(classText);
      const isInteractive = element.matches('button,[role="button"],[role="option"]');
      const availability = isDisabled ? 'UNAVAILABLE' : isInteractive ? 'AVAILABLE' : 'UNKNOWN';
      for (const pair of pairs) {
        const payout = findPayout(text, pair);
        const next = { pair, payoutPct: payout.payoutPct, availability, evidence: payout.evidence, textLength: text.length };
        const previous = found.get(pair);
        const score = row => (row.payoutPct !== null ? 100 : 0) +
          (row.evidence === 'HIGH' ? 20 : row.evidence === 'MEDIUM' ? 10 : 0) +
          (row.availability === 'AVAILABLE' ? 5 : 0) - row.textLength / 1000;
        if (!previous || score(next) > score(previous)) found.set(pair, next);
      }
    }
    return Array.from(found.values()).sort((a, b) => a.pair.localeCompare(b.pair))
      .slice(0, 200).map(row => ({
        pair: row.pair, payoutPct: row.payoutPct, availability: row.availability, evidence: row.evidence,
      }));
  }
  function hasVisibleLoginForm() {
    return Array.from(document.querySelectorAll('input[type="password"]')).some(isVisible);
  }
  function publishSnapshot() {
    const instruments = readInstruments();
    const sessionState = hasVisibleLoginForm() ? 'LOGIN_REQUIRED'
      : instruments.length > 0 ? 'READY' : 'WAITING_FOR_MARKET_DATA';
    chrome.runtime.sendMessage({ type: 'OLYMP_SNAPSHOT', payload: { sessionState, instruments } })
      .catch(() => undefined);
  }
  let scheduled = false;
  function schedulePublish() {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(() => { scheduled = false; publishSnapshot(); }, 450);
  }
  const observer = new MutationObserver(schedulePublish);
  if (document.documentElement) observer.observe(document.documentElement, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ['aria-label', 'aria-disabled', 'data-asset', 'data-symbol'],
  });
  chrome.runtime.onMessage.addListener(message => {
    if (message && message.type === 'OLYMP_SCAN_NOW') publishSnapshot();
  });
  publishSnapshot();
  window.setInterval(publishSnapshot, 5000);
})();
