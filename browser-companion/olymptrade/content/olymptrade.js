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
  const PAIR_REGEX = /\b([A-Z]{3})\s*[/⁄]\s*([A-Z]{3})\b/g;
  const PAIR_NO_SLASH_REGEX = /\b([A-Z]{3})([A-Z]{3})\b/g;
  const PAYOUT_LABEL_REGEX = /(?:payout|profit|return|income|yield)[^0-9]{0,32}(\d{2,3}(?:\.\d{1,2})?)\s*%/i;
  const PERCENT_REGEX = /(?:^|[\s+•|·(])([5-9]\d(?:\.\d{1,2})?|100(?:\.0{1,2})?)\s*%/g;

  /* ───────── visibility check ───────── */
  function isVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /* ───────── text extraction from a single element ───────── */
  function readText(element) {
    if (!(element instanceof HTMLElement)) return '';
    return [
      element.innerText || element.textContent || '',
      element.getAttribute('aria-label') || '',
      element.getAttribute('title') || '',
      element.getAttribute('data-asset') || '',
      element.getAttribute('data-symbol') || '',
      element.getAttribute('data-test') || '',
      element.getAttribute('alt') || '',
    ].join(' ').replace(/\s+/g, ' ').trim().slice(0, 320);
  }

  /* ───────── extract normalised currency pairs from text ───────── */
  function findPairs(text) {
    const pairs = new Set();
    const upper = text.toUpperCase();

    for (const match of upper.matchAll(PAIR_REGEX)) {
      if (CURRENCIES.has(match[1]) && CURRENCIES.has(match[2]) && match[1] !== match[2]) {
        pairs.add(match[1] + '/' + match[2]);
      }
    }

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
    const labeled = text.match(PAYOUT_LABEL_REGEX);
    if (labeled) {
      const value = Number(labeled[1]);
      if (value >= 50 && value <= 100) return { payoutPct: value, evidence: 'HIGH' };
    }

    const pairIndex = text.toUpperCase().indexOf(pair);
    if (pairIndex >= 0) {
      const afterPair = text.slice(pairIndex + pair.length, pairIndex + pair.length + 48);
      const adjacent = afterPair.match(/^[^0-9]{0,24}(\d{2,3}(?:\.\d{1,2})?)\s*%/);
      if (adjacent) {
        const value = Number(adjacent[1]);
        if (value >= 50 && value <= 100) return { payoutPct: value, evidence: 'HIGH' };
      }
    }

    const allPairsInText = findPairs(text);
    if (allPairsInText.length === 1 && allPairsInText[0] === pair) {
      const percentages = Array.from(text.matchAll(PERCENT_REGEX))
        .map(match => Number(match[1]))
        .filter(value => value >= 50 && value <= 100);
      if (percentages.length === 1) return { payoutPct: percentages[0], evidence: 'MEDIUM' };
    }

    return { payoutPct: null, evidence: 'NONE' };
  }

  /* ───────── find smallest enclosing row/card that contains only this pair ───────── */
  function findRowContainer(startElement, pair) {
    let best = startElement;
    let current = startElement.parentElement;
    for (let depth = 0; depth < 5 && current && current !== document.body; depth++) {
      const rect = current.getBoundingClientRect();
      if (rect.height > 180 || rect.width > 900) break;
      const text = readText(current);
      if (!text || text.length > 260) break;
      const pairs = findPairs(text);
      if (pairs.length !== 1 || pairs[0] !== pair) break;
      best = current;
      // If this container already has a percentage, we found the instrument row/card
      if (/%/.test(text)) break;
      current = current.parentElement;
    }
    return best;
  }

  /* ───────── scan visible instruments via TreeWalker + attribute fallback ───────── */
  function readInstruments() {
    const found = new Map();
    const candidateLeaves = new Set();

    // 1. Walk visible text nodes containing currency-like letters
    if (document.body) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      let visited = 0;
      while ((node = walker.nextNode()) && visited < 6000) {
        visited++;
        const raw = node.nodeValue;
        if (!raw || raw.length < 6 || raw.length > 80) continue;
        if (!/[A-Z]{3}/i.test(raw)) continue;
        const parent = node.parentElement;
        if (parent && isVisible(parent) && findPairs(raw).length > 0) {
          candidateLeaves.add(parent);
        }
      }
    }

    // 2. Also check elements with aria-label / data-asset / data-symbol / title
    const attrNodes = document.querySelectorAll('[aria-label],[data-asset],[data-symbol],[title]');
    for (let i = 0; i < attrNodes.length && i < 1500; i++) {
      const el = attrNodes[i];
      if (isVisible(el)) candidateLeaves.add(el);
    }

    for (const leaf of candidateLeaves) {
      const leafPairs = findPairs(readText(leaf));
      if (leafPairs.length !== 1) continue;
      const pair = leafPairs[0];

      const rowEl = findRowContainer(leaf, pair);
      if (!isVisible(rowEl)) continue;

      const text = readText(rowEl);
      if (!text || text.length > 260) continue;

      const classText = typeof rowEl.className === 'string' ? rowEl.className : '';
      const isDisabled = rowEl.hasAttribute('disabled') ||
        rowEl.getAttribute('aria-disabled') === 'true' ||
        /\b(disabled|unavailable|closed|suspended|locked)\b/i.test(classText) ||
        /\b(disabled|unavailable|closed|suspended|locked)\b/i.test(text);
      const isInteractive = rowEl.matches('button,a,[role="button"],[role="option"],[role="listitem"],[role="menuitem"],[role="tab"],[role="row"],li,tr') ||
        Boolean(rowEl.closest('button,a,[role="button"],[role="option"],[role="listitem"],[role="menuitem"],[role="tab"],[role="row"]')) ||
        Boolean(rowEl.querySelector('button,[role="button"]')) ||
        window.getComputedStyle(rowEl).cursor === 'pointer';
      const availability = isDisabled ? 'UNAVAILABLE' : isInteractive ? 'AVAILABLE' : 'UNKNOWN';

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
    const passwordInputs = Array.from(document.querySelectorAll('input[type="password"]'));
    if (passwordInputs.some(isVisible)) return true;

    const loginFormIndicators = document.querySelectorAll(
      'form[action*="login"], form[action*="auth"], [data-testid*="login"], [data-testid*="auth"]'
    );
    if (Array.from(loginFormIndicators).some(isVisible)) return true;

    const buttons = document.querySelectorAll('button, [role="button"], a[href*="login"], a[href*="auth"]');
    for (const btn of buttons) {
      if (!isVisible(btn)) continue;
      const btnText = (btn.textContent || '').trim().toLowerCase();
      if (/^(sign\s*in|log\s*in|login|register)$/i.test(btnText)) return true;
    }

    return false;
  }

  /* ───────── publish snapshot to service worker ───────── */
  function publishSnapshot() {
    const instruments = readInstruments();
    let sessionState;

    if (hasVisibleLoginForm()) {
      sessionState = 'LOGIN_REQUIRED';
    } else if (instruments.length > 0) {
      sessionState = 'READY';
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

  const observer = new MutationObserver(schedulePublish);
  if (document.documentElement) {
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'aria-label', 'aria-disabled', 'data-asset', 'data-symbol',
        'data-test', 'data-testid', 'class', 'disabled', 'title',
      ],
    });
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message && message.type === 'OLYMP_SCAN_NOW') publishSnapshot();
  });

  publishSnapshot();
  window.setInterval(publishSnapshot, 5000);
})();
