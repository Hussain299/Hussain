(() => {
  if (window.__signalForgeOlympObserverInstalled) return;
  window.__signalForgeOlympObserverInstalled = true;

  /* ───────── currency whitelist ───────── */
  const CURRENCIES = new Set([
    'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'MXN', 'NOK', 'SEK', 'SGD',
    'ZAR', 'TRY', 'PLN', 'HKD', 'CNY', 'CNH', 'INR', 'BRL', 'CZK', 'HUF', 'DKK', 'ILS',
    'AED', 'SAR', 'THB', 'IDR', 'MYR', 'PHP', 'KRW', 'RUB', 'TWD', 'KZT',
  ]);

  /* ───────── regex patterns ───────── */
  const PAIR_REGEX = /\b([A-Z]{3})(?:\s*[/⁄\-_]\s*|\s+)([A-Z]{3})\b/g;
  const PAIR_NO_SLASH_REGEX = /\b([A-Z]{3})([A-Z]{3})\b/g;
  const PAYOUT_LABEL_REGEX = /(?:payout|profit|return|income|yield)[^0-9]{0,32}(\d{2,3}(?:\.\d{1,2})?)\s*%/i;
  const PERCENT_REGEX = /(?:^|[\s+•|·(])([5-9]\d(?:\.\d{1,2})?|100(?:\.0{1,2})?)\s*%/g;
  const MARKET_CONTAINER_SELECTOR = [
    '[role="dialog"]', '[role="listbox"]', '[role="menu"]', '[role="grid"]',
    '[data-test*="asset" i]', '[data-testid*="asset" i]',
    '[data-test*="market" i]', '[data-testid*="market" i]',
    '[class*="asset" i]', '[class*="market" i]', '[class*="modal" i]',
    '[class*="drawer" i]', '[class*="dropdown" i]', '[class*="popover" i]',
    '[class*="selector" i]', '[class*="volume" i]',
  ].join(',');
  const INTERACTIVE_SELECTOR = 'button,a,[role="button"],[role="option"],[role="listitem"],[role="menuitem"],[role="tab"],[role="row"],[tabindex],li,tr';

  const VIRTUAL_CACHE_TTL_MS = 45_000;
  const MARKET_DISCOVERY_RETENTION_MS = 4 * 60 * 60_000;
  const virtualMarketListCache = new Map();
  let lastRichSnapshotAt = 0;
  let lastRichInstrumentCount = 0;

  /* ───────── visibility check ───────── */
  function isVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) {
      return false;
    }
    if (style.display === 'contents') return true;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /* ───────── text extraction from a single element ───────── */
  function readText(element, maxLen = 400) {
    if (!(element instanceof HTMLElement)) return '';
    const combined = [
      element.innerText || element.textContent || '',
      element.getAttribute('aria-label') || '',
      element.getAttribute('title') || '',
      element.getAttribute('data-asset') || '',
      element.getAttribute('data-symbol') || '',
      element.getAttribute('data-pair') || '',
      element.getAttribute('data-instrument') || '',
      element.getAttribute('data-test') || '',
      element.getAttribute('alt') || '',
    ].join(' ').replace(/\s+/g, ' ').trim();
    return Number.isFinite(maxLen) ? combined.slice(0, maxLen) : combined;
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

    for (const match of upper.matchAll(PAIR_NO_SLASH_REGEX)) {
      if (CURRENCIES.has(match[1]) && CURRENCIES.has(match[2]) && match[1] !== match[2]) {
        pairs.add(match[1] + '/' + match[2]);
      }
    }

    return Array.from(pairs);
  }

  /* ───────── find payout associated strictly with a single pair row ───────── */
  function findPayout(text, pair) {
    // 1. Explicit payout label is authoritative
    const labeled = text.match(PAYOUT_LABEL_REGEX);
    if (labeled) {
      const value = Number(labeled[1]);
      if (value >= 50 && value <= 100) return { payoutPct: value, evidence: 'HIGH' };
    }

    // Ensure the row text contains only this pair so neighbouring pairs never bleed over
    const allPairsInText = findPairs(text);
    if (allPairsInText.length !== 1 || allPairsInText[0] !== pair) {
      return { payoutPct: null, evidence: 'NONE' };
    }

    // Collect distinct plausible 50-100% values in this single-pair row (innerText + title/aria-label duplicates don't invalidate payout)
    const uniquePercentages = Array.from(
      new Set(
        Array.from(text.matchAll(PERCENT_REGEX))
          .map(match => Number(match[1]))
          .filter(value => Number.isFinite(value) && value >= 50 && value <= 100)
      )
    );

    const [base, quote] = pair.split('/');
    const pairPattern = new RegExp(`\\b${base}(?:\\s*[/⁄\\-_]?\\s*)${quote}\\b`, 'i');
    const pairMatch = pairPattern.exec(text);
    if (pairMatch) {
      const afterPair = text.slice(pairMatch.index + pairMatch[0].length, pairMatch.index + pairMatch[0].length + 64);
      const adjacentStrict = afterPair.match(/^[^0-9]{0,28}(\d{2,3}(?:\.\d{1,2})?)\s*%/);
      if (adjacentStrict) {
        const value = Number(adjacentStrict[1]);
        if (value >= 50 && value <= 100) return { payoutPct: value, evidence: 'HIGH' };
      }
      if (uniquePercentages.length === 1) {
        const nearbyMatch = afterPair.match(/(?:^|[\s+•|·(])([5-9]\d(?:\.\d{1,2})?|100(?:\.0{1,2})?)\s*%/);
        if (nearbyMatch) {
          const value = Number(nearbyMatch[1]);
          if (value >= 50 && value <= 100) return { payoutPct: value, evidence: 'HIGH' };
        }
      }
    }

    // Multiple distinct 50-100% numbers in the same row without an explicit label are ambiguous
    if (uniquePercentages.length === 1) {
      return { payoutPct: uniquePercentages[0], evidence: 'MEDIUM' };
    }

    return { payoutPct: null, evidence: 'NONE' };
  }

  /* ───────── find smallest enclosing row/card that contains only this pair ───────── */
  function findRowContainer(startElement, pair) {
    let best = startElement;
    let bestWithPayout = findPayout(readText(startElement, 850), pair).payoutPct !== null ? startElement : null;
    let current = startElement.parentElement;
    for (let depth = 0; depth < 10 && current && current !== document.body; depth++) {
      const style = window.getComputedStyle(current);
      if (style.display !== 'contents') {
        const rect = current.getBoundingClientRect();
        if (rect.height > 240 || rect.width > 1400) break;
      }
      const text = readText(current, 850);
      if (!text || text.length > 800) break;
      const pairs = findPairs(text);
      if (pairs.length !== 1 || pairs[0] !== pair) break;
      const payoutNow = findPayout(text, pair);
      if (payoutNow.payoutPct !== null) {
        bestWithPayout = current;
      }
      best = current;
      // Stop climbing as soon as a single-pair element already includes its payout and interactive wrapper
      if (payoutNow.payoutPct !== null && (current.matches(INTERACTIVE_SELECTOR) || depth >= 4)) break;
      current = current.parentElement;
    }
    return bestWithPayout || best;
  }

  function hasInteractiveCue(rowEl, leaf) {
    // Check elements from leaf up through rowEl and single-pair ancestors
    let cur = leaf;
    for (let i = 0; i < 8 && cur && cur !== document.body; i++) {
      if (cur instanceof HTMLElement) {
        if (cur.matches(INTERACTIVE_SELECTOR)) return true;
        const style = window.getComputedStyle(cur);
        if (style.cursor === 'pointer') return true;
      }
      if (cur === rowEl) break;
      cur = cur.parentElement;
    }

    cur = rowEl;
    for (let i = 0; i < 4 && cur && cur !== document.body; i++) {
      if (cur instanceof HTMLElement) {
        if (cur.matches(INTERACTIVE_SELECTOR)) return true;
        if (window.getComputedStyle(cur).cursor === 'pointer') return true;
      }
      cur = cur.parentElement;
    }

    const childInteractive = rowEl.querySelector('button,a,[role="button"],[role="option"],[role="tab"],[tabindex]');
    if (childInteractive && isVisible(childInteractive)) return true;
    const descendants = rowEl.querySelectorAll('*');
    for (let i = 0; i < descendants.length && i < 25; i++) {
      if (descendants[i] instanceof HTMLElement && window.getComputedStyle(descendants[i]).cursor === 'pointer') {
        return true;
      }
    }
    return false;
  }

  function hasDisabledCue(rowEl, text) {
    let cur = rowEl;
    for (let i = 0; i < 4 && cur && cur !== document.body; i++) {
      if (cur instanceof HTMLElement) {
        if (
          cur.hasAttribute('disabled') ||
          cur.getAttribute('aria-disabled') === 'true' ||
          cur.getAttribute('data-disabled') === 'true' ||
          cur.getAttribute('data-locked') === 'true'
        ) {
          return true;
        }
        const cls = typeof cur.className === 'string' ? cur.className : '';
        if (/\b(disabled|unavailable|closed|suspended|locked|inactive)\b/i.test(cls)) return true;
        const opacity = Number(window.getComputedStyle(cur).opacity || 1);
        if (Number.isFinite(opacity) && opacity < 0.55) return true;
      }
      cur = cur.parentElement;
    }
    return /\b(disabled|unavailable|closed|suspended|locked|inactive|not\s+available)\b/i.test(text);
  }

  function classifySourceType(rowEl) {
    if (rowEl.closest('[role="tablist"],[role="tab"]')) return 'TAB';
    const insideExplicitDrawer = Boolean(rowEl.closest('[role="dialog"],[role="listbox"],[role="menu"],[role="grid"]'));
    let insideOverlayOrScroll = false;
    let cur = rowEl.parentElement;
    for (let i = 0; i < 16 && cur && cur !== document.body; i++) {
      const style = window.getComputedStyle(cur);
      if (
        ((style.overflowY === 'auto' || style.overflowY === 'scroll') && cur.scrollHeight > cur.clientHeight + 10) ||
        style.position === 'fixed' ||
        (style.position === 'absolute' && cur.getBoundingClientRect().height >= 120)
      ) {
        insideOverlayOrScroll = true;
        break;
      }
      cur = cur.parentElement;
    }

    const rect = rowEl.getBoundingClientRect();
    if (rect.top >= 0 && rect.top < 110 && rect.height > 0 && rect.height <= 76 && !insideExplicitDrawer && !insideOverlayOrScroll) {
      return 'TAB';
    }
    if (rowEl.closest(MARKET_CONTAINER_SELECTOR) || insideExplicitDrawer || insideOverlayOrScroll) {
      return 'MARKET_LIST';
    }
    return 'UNKNOWN';
  }

  function hasOpenMarketListContainer() {
    const candidates = document.querySelectorAll(MARKET_CONTAINER_SELECTOR);
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      if (!isVisible(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.height >= 120 && rect.width >= 160 && findPairs(readText(el, 24000)).length >= 2) {
        return true;
      }
    }
    // Fallback for hashed CSS classes: detect any visible scroll/overlay container holding >= 2 currency pairs
    const containers = document.querySelectorAll('div,section,aside,ul,table');
    for (let i = 0; i < containers.length && i < 1500; i++) {
      const el = containers[i];
      if (!isVisible(el)) continue;
      const style = window.getComputedStyle(el);
      const isScrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 10;
      const isOverlay = style.position === 'fixed' || style.position === 'absolute';
      if (!isScrollable && !isOverlay) continue;
      const rect = el.getBoundingClientRect();
      if (rect.height >= 120 && rect.width >= 160 && findPairs(readText(el, 24000)).length >= 2) {
        return true;
      }
    }
    return false;
  }

  /* ───────── scan visible instruments via TreeWalker + attribute fallback ───────── */
  function readInstruments() {
    const found = new Map();
    const candidateLeaves = new Set();

    if (document.body) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      let visited = 0;
      while ((node = walker.nextNode()) && visited < 200000) {
        visited++;
        const raw = node.nodeValue ? node.nodeValue.trim() : '';
        if (!raw || raw.length < 3 || raw.length > 120) continue;
        if (!/[A-Z]{3}/i.test(raw)) continue;
        const parent = node.parentElement;
        if (!parent || !isVisible(parent)) continue;
        if (findPairs(raw).length > 0) {
          candidateLeaves.add(parent);
        } else if (CURRENCIES.has(raw.toUpperCase()) && parent.parentElement && isVisible(parent.parentElement)) {
          candidateLeaves.add(parent.parentElement);
          if (parent.parentElement.parentElement && isVisible(parent.parentElement.parentElement)) {
            candidateLeaves.add(parent.parentElement.parentElement);
          }
        }
      }
    }

    const attrNodes = document.querySelectorAll(
      '[aria-label],[data-asset],[data-symbol],[data-pair],[data-instrument],[data-currency],[data-test],[data-testid],[title]'
    );
    for (let i = 0; i < attrNodes.length && i < 20000; i++) {
      const el = attrNodes[i];
      if (isVisible(el)) candidateLeaves.add(el);
    }

    for (const leaf of candidateLeaves) {
      const leafPairs = findPairs(readText(leaf, 600));
      if (leafPairs.length !== 1) continue;
      const pair = leafPairs[0];

      const rowEl = findRowContainer(leaf, pair);
      if (!isVisible(rowEl)) continue;

      const text = readText(rowEl, 850);
      if (!text || text.length > 800) continue;
      // Never conflate OTC instruments with live FX currency pairs
      if (/\bOTC\b/i.test(text)) continue;

      const isDisabled = hasDisabledCue(rowEl, text);
      const isInteractive = hasInteractiveCue(rowEl, leaf);
      const availability = isDisabled ? 'UNAVAILABLE' : isInteractive ? 'AVAILABLE' : 'UNKNOWN';
      const sourceType = classifySourceType(rowEl);
      const payout = findPayout(text, pair);

      const next = {
        pair,
        payoutPct: payout.payoutPct,
        availability,
        evidence: payout.evidence,
        sourceType,
        textLength: text.length,
      };

      const previous = found.get(pair);
      const score = row =>
        (row.sourceType === 'MARKET_LIST' ? 40 : row.sourceType === 'TAB' ? 10 : 0) +
        (row.payoutPct !== null ? 100 : 0) +
        (row.evidence === 'HIGH' ? 20 : row.evidence === 'MEDIUM' ? 10 : 0) +
        (row.availability === 'AVAILABLE' ? 5 : 0) -
        row.textLength / 1000;

      if (!previous || score(next) > score(previous)) found.set(pair, next);
    }

    const nowMs = Date.now();
    if (hasVisibleLoginForm()) {
      virtualMarketListCache.clear();
      lastRichInstrumentCount = 0;
      lastRichSnapshotAt = 0;
      return [];
    }
    const marketOpen = hasOpenMarketListContainer() || found.size > 10;
    if (marketOpen) {
      for (const [pair, row] of found.entries()) {
        if (row.sourceType === 'MARKET_LIST' || (found.size > 10 && row.sourceType !== 'TAB')) {
          virtualMarketListCache.set(pair, {
            row: row.sourceType === 'UNKNOWN' ? { ...row, sourceType: 'MARKET_LIST' } : row,
            seenAt: nowMs,
          });
        }
      }
    }
    // Retain discovered market-list pairs and their observed evidence across scrolling,
    // drawer close, and tab switches so SignalForge does not collapse back to the ~7 pinned tabs.
    const instrumentPriority = row =>
      (row.sourceType === 'MARKET_LIST' ? 40 : row.sourceType === 'TAB' ? 10 : 0) +
      (row.payoutPct !== null ? 100 : 0) +
      (row.evidence === 'HIGH' ? 20 : row.evidence === 'MEDIUM' ? 10 : 0) +
      (row.availability === 'AVAILABLE' ? 5 : 0);

    for (const [pair, entry] of virtualMarketListCache.entries()) {
      if (nowMs - entry.seenAt > MARKET_DISCOVERY_RETENTION_MS) {
        virtualMarketListCache.delete(pair);
      } else {
        const existing = found.get(pair);
        if (!existing || instrumentPriority(entry.row) > instrumentPriority(existing)) {
          found.set(pair, entry.row);
        }
      }
    }

    return Array.from(found.values())
      .sort((a, b) => a.pair.localeCompare(b.pair))
      .map(row => ({
        pair: row.pair,
        payoutPct: row.payoutPct,
        availability: row.availability,
        evidence: row.evidence,
        sourceType: row.sourceType,
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
  let intervalId = null;
  function stopObserver() {
    if (intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
    observer.disconnect();
    document.removeEventListener('scroll', schedulePublish, true);
  }

  function publishSnapshot(force = false) {
    if (!chrome.runtime?.id) {
      stopObserver();
      return;
    }
    if (!force && document.hidden) return;
    const instruments = readInstruments();
    const nowMs = Date.now();
    if (
      !force &&
      document.hidden &&
      !hasOpenMarketListContainer() &&
      instruments.length < lastRichInstrumentCount &&
      nowMs - lastRichSnapshotAt < VIRTUAL_CACHE_TTL_MS
    ) {
      return;
    }
    if (instruments.length >= lastRichInstrumentCount || !document.hidden) {
      lastRichInstrumentCount = instruments.length;
      lastRichSnapshotAt = nowMs;
    }
    let sessionState;

    if (hasVisibleLoginForm()) {
      sessionState = 'LOGIN_REQUIRED';
    } else if (instruments.length > 0) {
      sessionState = 'READY';
    } else {
      sessionState = 'WAITING_FOR_MARKET_DATA';
    }

    try {
      chrome.runtime.sendMessage({
        type: 'OLYMP_SNAPSHOT',
        payload: { sessionState, instruments },
      }).catch(() => undefined);
    } catch {
      stopObserver();
    }
  }

  let scheduled = false;
  function schedulePublish() {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(() => {
      scheduled = false;
      publishSnapshot(false);
    }, 350);
  }

  const observer = new MutationObserver(schedulePublish);
  if (document.documentElement) {
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'aria-label', 'aria-disabled', 'data-asset', 'data-symbol', 'data-pair', 'data-instrument',
        'data-test', 'data-testid', 'data-disabled', 'data-locked', 'class', 'disabled', 'title',
      ],
    });
  }

  document.addEventListener('scroll', schedulePublish, { capture: true, passive: true });

  chrome.runtime.onMessage.addListener(message => {
    if (message && message.type === 'OLYMP_SCAN_NOW') publishSnapshot(true);
  });

  publishSnapshot(true);
  intervalId = window.setInterval(() => publishSnapshot(false), 5000);
})();
