(() => {
  if (window.__signalForgeOlympObserverInstalled) return;
  window.__signalForgeOlympObserverInstalled = true;

  /* ───────── currency whitelist ───────── */
  const CURRENCIES = new Set([
    'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'MXN', 'NOK', 'SEK', 'SGD',
    'ZAR', 'TRY', 'PLN', 'HKD', 'CNY', 'INR', 'BRL', 'CZK', 'HUF', 'DKK', 'ILS', 'AED',
    'SAR', 'THB', 'IDR', 'MYR', 'PHP', 'KRW',
  ]);

  /* ───────── regex patterns ───────── */
  const PAIR_REGEX = /\b([A-Z]{3})\s*\/\s*([A-Z]{3})\b/g;
  const PAIR_NO_SLASH_REGEX = /\b([A-Z]{3})([A-Z]{3})\b/g;
  const PAYOUT_LABEL_REGEX = /(?:payout|profit|return|income|yield)[^0-9]{0,32}(\d{2,3}(?:\.\d{1,2})?)\s*%/i;
  const PERCENT_REGEX = /(?:^|[\s+])([5-9]\d(?:\.\d{1,2})?|100(?:\.0{1,2})?)\s*%/g;

  /* ───────── Broad selector for instrument items in Olymp Trade ───────── */
  const CANDIDATE_SELECTOR = [
    // Explicit Olymp Trade DOM patterns observed on live platform
    '[data-testid*="asset"]',
    '[data-testid*="instrument"]',
    '[data-testid*="pair"]',
    '[data-asset]',
    '[data-symbol]',
    // Generic interactive elements that commonly contain instrument rows
    'button', '[role="button"]', '[role="option"]', '[role="tab"]', '[role="row"]',
    '[role="listitem"]', '[role="menuitem"]',
    // Structural elements
    'li', 'tr',
    // Any element with an aria-label containing a currency pair
    '[aria-label]',
  ].join(',');

  /* ───────── visibility check ───────── */
  function isVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
  }

  /* ───────── text extraction from a single element ───────── */
  function readText(element) {
    return [
      element.innerText || '',
      element.getAttribute('aria-label') || '',
      element.getAttribute('title') || '',
      element.getAttribute('data-asset') || '',
      element.getAttribute('data-symbol') || '',
      element.getAttribute('alt') || '',
    ].join(' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  }

  /* ───────── extract normalised currency pairs from text ───────── */
  function findPairs(text) {
    const pairs = new Set();
    const upper = text.toUpperCase();

    // Standard "XXX/YYY" format
    for (const match of upper.matchAll(PAIR_REGEX)) {
      if (CURRENCIES.has(match[1]) && CURRENCIES.has(match[2]) && match[1] !== match[2]) {
        pairs.add(match[1] + '/' + match[2]);
      }
    }

    // "XXXYYY" format (no slash) — only accept when no slashed pair was found
    if (pairs.size === 0) {
      for (const match of upper.matchAll(PAIR_NO_SLASH_REGEX)) {
        if (CURRENCIES.has(match[1]) && CURRENCIES.has(match[2]) && match[1] !== match[2]) {
          pairs.add(match[1] + '/' + match[2]);
        }
      }
    }

    return Array.from(pairs);
  }

  /* ───────── find payout associated with a specific pair ───────── */
  function findPayout(text, pair) {
    // 1. Try labelled payout (highest confidence)
    const labeled = text.match(PAYOUT_LABEL_REGEX);
    if (labeled) {
      const value = Number(labeled[1]);
      if (value >= 50 && value <= 100) return { payoutPct: value, evidence: 'HIGH' };
    }

    // 2. Try payout adjacent to the pair text (within 40 chars after pair)
    const pairIndex = text.toUpperCase().indexOf(pair);
    if (pairIndex >= 0) {
      const afterPair = text.slice(pairIndex + pair.length, pairIndex + pair.length + 40);
      const adjacent = afterPair.match(/^[^0-9]{0,20}(\d{2,3}(?:\.\d{1,2})?)\s*%/);
      if (adjacent) {
        const value = Number(adjacent[1]);
        if (value >= 50 && value <= 100) return { payoutPct: value, evidence: 'HIGH' };
      }
    }

    // 3. If exactly one plausible percentage in the whole text, use it as medium confidence
    // But ONLY if there's exactly one pair in the text (prevents cross-contamination)
    const allPairsInText = findPairs(text);
    if (allPairsInText.length === 1 && allPairsInText[0] === pair) {
      const percentages = Array.from(text.matchAll(PERCENT_REGEX))
        .map(match => Number(match[1]))
        .filter(value => value >= 50 && value <= 100);
      if (percentages.length === 1) return { payoutPct: percentages[0], evidence: 'MEDIUM' };
    }

    return { payoutPct: null, evidence: 'NONE' };
  }

  /* ───────── scan visible instruments ───────── */
  function readInstruments() {
    const found = new Map();
    const nodes = Array.from(document.querySelectorAll(CANDIDATE_SELECTOR)).slice(0, 3000);

    for (const element of nodes) {
      if (!isVisible(element)) continue;

      const text = readText(element);
      if (!text || text.length > 300) continue;

      const pairs = findPairs(text);
      if (!pairs.length) continue;

      // Reject elements with too many pairs (likely a header or summary, not an instrument row)
      if (pairs.length > 2) continue;

      const classText = typeof element.className === 'string' ? element.className : '';
      const isDisabled = element.hasAttribute('disabled') ||
        element.getAttribute('aria-disabled') === 'true' ||
        /\b(disabled|unavailable|closed|suspended|locked)\b/i.test(classText) ||
        /\b(disabled|unavailable|closed|suspended|locked)\b/i.test(text);
      const isInteractive = element.matches('button,[role="button"],[role="option"],[role="listitem"],[role="menuitem"]');
      const availability = isDisabled ? 'UNAVAILABLE' : isInteractive ? 'AVAILABLE' : 'UNKNOWN';

      for (const pair of pairs) {
        const payout = findPayout(text, pair);
        const next = {
          pair,
          payoutPct: payout.payoutPct,
          availability,
          evidence: payout.evidence,
          textLength: text.length,
        };

        const previous = found.get(pair);
        const score = row =>
          (row.payoutPct !== null ? 100 : 0) +
          (row.evidence === 'HIGH' ? 20 : row.evidence === 'MEDIUM' ? 10 : 0) +
          (row.availability === 'AVAILABLE' ? 5 : 0) -
          row.textLength / 1000;

        if (!previous || score(next) > score(previous)) found.set(pair, next);
      }
    }

    return Array.from(found.values())
      .sort((a, b) => a.pair.localeCompare(b.pair))
      .slice(0, 200)
      .map(row => ({
        pair: row.pair,
        payoutPct: row.payoutPct,
        availability: row.availability,
        evidence: row.evidence,
      }));
  }

  /* ───────── detect login-required states ───────── */
  function hasVisibleLoginForm() {
    // Check for visible password inputs
    const passwordInputs = Array.from(document.querySelectorAll('input[type="password"]'));
    if (passwordInputs.some(isVisible)) return true;

    // Check for visible email/login inputs near a submit button
    const loginFormIndicators = document.querySelectorAll(
      'form[action*="login"], form[action*="auth"], [data-testid*="login"], [data-testid*="auth"]'
    );
    if (Array.from(loginFormIndicators).some(isVisible)) return true;

    // Check for "Sign in" / "Log in" buttons
    const buttons = document.querySelectorAll('button, [role="button"], a[href*="login"], a[href*="auth"]');
    for (const btn of buttons) {
      if (!isVisible(btn)) continue;
      const btnText = (btn.textContent || '').trim().toLowerCase();
      if (/^(sign\s*in|log\s*in|login|register)$/i.test(btnText)) return true;
    }

    return false;
  }

  /* ───────── detect if the platform appears to be the authenticated trading terminal ───────── */
  function isAuthenticatedTerminal() {
    // Look for trading-related UI elements that only appear when logged in
    const tradingIndicators = document.querySelectorAll(
      '[data-testid*="trade"], [data-testid*="chart"], [data-testid*="balance"], ' +
      'canvas, .chart-container, [class*="chart"], [class*="trading"]'
    );
    return Array.from(tradingIndicators).some(isVisible);
  }

  /* ───────── publish snapshot to service worker ───────── */
  function publishSnapshot() {
    const instruments = readInstruments();
    let sessionState;

    if (hasVisibleLoginForm()) {
      sessionState = 'LOGIN_REQUIRED';
    } else if (instruments.length > 0) {
      sessionState = 'READY';
    } else if (isAuthenticatedTerminal()) {
      // Terminal is loaded but no instruments found (market list not open)
      sessionState = 'WAITING_FOR_MARKET_DATA';
    } else {
      sessionState = 'WAITING_FOR_MARKET_DATA';
    }

    chrome.runtime.sendMessage({
      type: 'OLYMP_SNAPSHOT',
      payload: { sessionState, instruments },
    }).catch(() => undefined);
  }

  /* ───────── debounced mutation-driven publish ───────── */
  let scheduled = false;
  function schedulePublish() {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(() => {
      scheduled = false;
      publishSnapshot();
    }, 500);
  }

  /* ───────── MutationObserver: watch for DOM changes ───────── */
  const observer = new MutationObserver(schedulePublish);
  if (document.documentElement) {
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'aria-label', 'aria-disabled', 'data-asset', 'data-symbol',
        'data-testid', 'class', 'disabled', 'title',
      ],
    });
  }

  /* ───────── listen for on-demand scan requests ───────── */
  chrome.runtime.onMessage.addListener(message => {
    if (message && message.type === 'OLYMP_SCAN_NOW') publishSnapshot();
  });

  /* ───────── initial scan + periodic heartbeat ───────── */
  publishSnapshot();
  window.setInterval(publishSnapshot, 5000);
})();
