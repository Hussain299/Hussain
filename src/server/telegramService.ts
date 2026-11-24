/**
 * SignalForge ML — Telegram Bot Integration Service
 * Dispatches real-time institutional 5M trading signals, 3-minute advance entry alerts,
 * and verified trade settlements directly to Telegram channels, groups, and personal subscribers.
 */

import { ResearchSignal, TelegramConfig, TelegramSubscriber, TelegramDispatchResult } from '../types/index.js';
import { db } from './db.js';

function escapeHtml(text: string | number | undefined | null): string {
  if (text === undefined || text === null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatIstTime(utcOrIso?: string | null): string {
  if (!utcOrIso) return '—';
  try {
    const d = new Date(utcOrIso);
    if (isNaN(d.getTime())) return String(utcOrIso);
    return (
      new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      })
        .format(d)
        .toUpperCase() + ' IST'
    );
  } catch {
    return String(utcOrIso);
  }
}

function getIstDateKey(iso?: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return '';
  }
}

function formatForexPrice(symbol: string, price?: number | null): string {
  if (price === undefined || price === null || Number.isNaN(price)) return '—';
  return price.toFixed(symbol.includes('JPY') ? 3 : 5);
}

function resolveTradeDisplacementPips(trade: ResearchSignal): number {
  if (trade.grossReturnPips !== null && trade.grossReturnPips !== undefined && !Number.isNaN(trade.grossReturnPips)) {
    return Number(trade.grossReturnPips.toFixed(1));
  }
  if (trade.netReturnPips !== null && trade.netReturnPips !== undefined && !Number.isNaN(trade.netReturnPips)) {
    return Number(trade.netReturnPips.toFixed(1));
  }
  const entry = trade.actualEntryPrice ?? trade.triggerPrice;
  const exit = trade.actualExitPrice;
  if (entry && exit) {
    const pipFactor = trade.symbol.includes('JPY') ? 100 : 10000;
    const diff = trade.direction === 'BUY' ? exit - entry : entry - exit;
    return Number((diff * pipFactor).toFixed(1));
  }
  return 0;
}

interface AuditScorecardBucket {
  wins: number;
  losses: number;
  scratches: number;
  scored: number;
  winRatePct: number;
  netUnits: number;
  grossPips: number;
}

interface AuditScorecard {
  todayDateKey: string;
  today: AuditScorecardBucket;
  overall: AuditScorecardBucket;
  streakText: string;
  recentClosed: ResearchSignal[];
}

export class TelegramService {
  private lastUpdateOffset: number = 0;
  private isSyncing: boolean = false;
  private cachedBotInfo: { id: number; username: string; firstName: string } | null = null;
  private dispatchedAuditSignalIds: Set<string> = new Set();

  private getBotToken(): string {
    const config = db.getTelegramConfig();
    return (config.botToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  }

  private getApiUrl(method: string): string {
    const token = this.getBotToken();
    return `https://api.telegram.org/bot${token}/${method}`;
  }

  /**
   * Compute verified IST Today and Overall Win/Loss Audit Scorecard from immutable closed signals.
   */
  public computeAuditScorecard(referenceSignal?: ResearchSignal): AuditScorecard {
    const isTestRef = Boolean(referenceSignal?.ruleFamily?.startsWith('test_'));
    const storedSignals = db.getSignals(isTestRef);
    const byId = new Map<string, ResearchSignal>();

    for (const s of storedSignals) {
      if (s?.id && (!s.ruleFamily?.startsWith('test_') || isTestRef)) {
        byId.set(s.id, s);
      }
    }
    if (referenceSignal?.id) {
      byId.set(referenceSignal.id, referenceSignal);
    }

    const closed = Array.from(byId.values())
      .filter(s => s.lifecycleState === 'CLOSED' && ['WIN', 'LOSS', 'SCRATCH'].includes(s.outcomeResult))
      .sort((a, b) => {
        const ta = Date.parse(a.actualExitTimeUtc || a.candleCloseTimeUtc || a.predictionTimeUtc || '') || 0;
        const tb = Date.parse(b.actualExitTimeUtc || b.candleCloseTimeUtc || b.predictionTimeUtc || '') || 0;
        return tb - ta;
      });

    const todayDateKey = getIstDateKey(new Date().toISOString());

    const summarize = (list: ResearchSignal[]): AuditScorecardBucket => {
      let wins = 0;
      let losses = 0;
      let scratches = 0;
      let netUnits = 0;
      let grossPips = 0;

      for (const s of list) {
        const payout = (s.payoutPct ?? 80) / 100;
        if (s.outcomeResult === 'WIN') {
          wins++;
          netUnits += s.netReturnUnits ?? payout;
        } else if (s.outcomeResult === 'LOSS') {
          losses++;
          netUnits += s.netReturnUnits ?? -1.0;
        } else if (s.outcomeResult === 'SCRATCH') {
          scratches++;
          netUnits += s.netReturnUnits ?? 0;
        }
        grossPips += resolveTradeDisplacementPips(s);
      }

      const scored = wins + losses;
      const winRatePct = scored > 0 ? Number(((wins / scored) * 100).toFixed(1)) : 0;
      return {
        wins,
        losses,
        scratches,
        scored,
        winRatePct,
        netUnits: Number(netUnits.toFixed(2)),
        grossPips: Number(grossPips.toFixed(1)),
      };
    };

    const todayClosed = closed.filter(s => {
      const canonicalTs = s.actualEntryTimeUtc || s.candleOpenTimeUtc || s.predictionTimeUtc;
      return getIstDateKey(canonicalTs) === todayDateKey;
    });

    // Compute active Win/Loss streak from newest scored trade backwards
    const scoredClosed = closed.filter(s => s.outcomeResult === 'WIN' || s.outcomeResult === 'LOSS');
    let streakText = '';
    if (scoredClosed.length > 0) {
      const firstOutcome = scoredClosed[0].outcomeResult;
      let count = 0;
      for (const s of scoredClosed) {
        if (s.outcomeResult === firstOutcome) count++;
        else break;
      }
      streakText = `${count}${firstOutcome === 'WIN' ? 'W' : 'L'} Streak`;
    }

    return {
      todayDateKey,
      today: summarize(todayClosed),
      overall: summarize(closed),
      streakText,
      recentClosed: closed.slice(0, 6),
    };
  }

  /**
   * Verify Telegram Bot credentials and query bot profile
   */
  public async getBotInfo(forceRefresh = false): Promise<{
    ok: boolean;
    bot?: { id: number; username: string; firstName: string };
    error?: string;
  }> {
    if (this.cachedBotInfo && !forceRefresh) {
      return { ok: true, bot: this.cachedBotInfo };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 7000);

      const res = await fetch(this.getApiUrl('getMe'), {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const data = await res.json();
      if (data.ok && data.result) {
        this.cachedBotInfo = {
          id: data.result.id,
          username: data.result.username || '',
          firstName: data.result.first_name || '',
        };

        // Sync bot name into config if needed
        db.saveTelegramConfig({
          botUsername: data.result.username,
          botFirstName: data.result.first_name,
        });

        return { ok: true, bot: this.cachedBotInfo };
      }
      return { ok: false, error: data.description || 'Failed to authenticate Telegram bot token' };
    } catch (err: any) {
      return { ok: false, error: err.name === 'AbortError' ? 'Telegram API request timed out' : err.message };
    }
  }

  /**
   * Auto-discover subscribers by polling Telegram getUpdates for /start or any messages sent to the bot
   */
  public async syncSubscribersFromUpdates(): Promise<{
    success: boolean;
    discoveredCount: number;
    totalSubscribers: number;
    subscribers: TelegramSubscriber[];
    error?: string;
  }> {
    if (this.isSyncing) {
      const cfg = db.getTelegramConfig();
      return {
        success: true,
        discoveredCount: 0,
        totalSubscribers: cfg.subscribers.length,
        subscribers: cfg.subscribers,
      };
    }

    this.isSyncing = true;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const queryUrl = this.lastUpdateOffset > 0
        ? `${this.getApiUrl('getUpdates')}?offset=${this.lastUpdateOffset + 1}&limit=100`
        : `${this.getApiUrl('getUpdates')}?limit=100`;

      const res = await fetch(queryUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      const data = await res.json();
      if (!data.ok || !Array.isArray(data.result)) {
        return {
          success: false,
          discoveredCount: 0,
          totalSubscribers: db.getTelegramConfig().subscribers.length,
          subscribers: db.getTelegramConfig().subscribers,
          error: data.description || 'Could not fetch updates from Telegram',
        };
      }

      let newDiscovered = 0;
      const nowIst = formatIstTime(new Date().toISOString());

      for (const update of data.result) {
        if (update.update_id && update.update_id > this.lastUpdateOffset) {
          this.lastUpdateOffset = update.update_id;
        }

        const msg = update.message || update.channel_post || update.edited_message;
        if (!msg || !msg.chat) continue;

        const chatId = msg.chat.id;
        const name = msg.chat.title || [msg.chat.first_name, msg.chat.last_name].filter(Boolean).join(' ') || (msg.chat.username ? `@${msg.chat.username}` : `Chat ${chatId}`);
        const username = msg.chat.username;
        const type: 'user' | 'group' | 'channel' =
          msg.chat.type === 'channel' ? 'channel' : msg.chat.type === 'group' || msg.chat.type === 'supergroup' ? 'group' : 'user';

        const config = db.getTelegramConfig();
        const exists = config.subscribers.some(s => String(s.id) === String(chatId));

        if (!exists) {
          db.addTelegramSubscriber({
            id: chatId,
            name,
            username,
            type,
            addedAt: nowIst,
          });
          newDiscovered++;
          console.log(`[TelegramService] New subscriber registered: ${name} (ID: ${chatId})`);

          // Send a welcome message directly to the new subscriber
          this.sendMessage(
            chatId,
            `<b>⚡ Welcome to SignalForge ML Autonomous Alerts!</b>\n\n` +
            `You are now registered to receive high-conviction 5-Minute Forex signals with 3-minute advance notice and full Win &amp; Loss Audit Reports for every settled trade.\n\n` +
            `• <b>Engine:</b> SignalForge ML Autonomous Research Terminal\n` +
            `• <b>Timezone:</b> Indian Standard Time (IST)\n` +
            `• <b>Status:</b> Active &amp; Listening`
          ).catch(() => {});
        }
      }

      db.saveTelegramConfig({ lastSyncAt: nowIst });
      const currentConfig = db.getTelegramConfig();

      return {
        success: true,
        discoveredCount: newDiscovered,
        totalSubscribers: currentConfig.subscribers.length,
        subscribers: currentConfig.subscribers,
      };
    } catch (err: any) {
      console.error('[TelegramService] sync error:', err.message);
      return {
        success: false,
        discoveredCount: 0,
        totalSubscribers: db.getTelegramConfig().subscribers.length,
        subscribers: db.getTelegramConfig().subscribers,
        error: err.name === 'AbortError' ? 'Sync request timed out' : err.message,
      };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Send arbitrary HTML message to a specific Telegram chat ID
   */
  public async sendMessage(chatId: string | number, htmlMessage: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 7000);

      const res = await fetch(this.getApiUrl('sendMessage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: htmlMessage,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const data = await res.json();
      if (!data.ok) {
        return { ok: false, error: data.description || `HTTP ${res.status}` };
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.name === 'AbortError' ? 'Delivery timed out' : err.message };
    }
  }

  /**
   * Broadcast message to all registered subscribers
   */
  public async broadcast(htmlMessage: string, ignoreMasterEnabled = false): Promise<TelegramDispatchResult[]> {
    const config = db.getTelegramConfig();
    if (!ignoreMasterEnabled && !config.enabled) {
      return [];
    }

    if (config.subscribers.length === 0) {
      console.log('[TelegramService] Broadcast skipped: No subscribers registered yet.');
      return [];
    }

    const results: TelegramDispatchResult[] = [];
    const promises = config.subscribers.map(async sub => {
      const res = await this.sendMessage(sub.id, htmlMessage);
      if (res.ok) {
        results.push({ subscriberId: sub.id, success: true });
      } else {
        results.push({ subscriberId: sub.id, success: false, error: res.error });
        // If subscriber blocked the bot, we log but don't crash
        console.warn(`[TelegramService] Delivery failed for ${sub.name} (${sub.id}): ${res.error}`);
      }
    });

    await Promise.allSettled(promises);
    return results;
  }

  /**
   * Format and send an institutional trading signal alert
   */
  public async sendSignalAlert(signal: ResearchSignal): Promise<TelegramDispatchResult[]> {
    const config = db.getTelegramConfig();
    if (!config.enabled || !config.notifyOnNewSignal) {
      return [];
    }

    if (signal.confidence < (config.minConfidence ?? 0.70)) {
      return [];
    }

    const directionBadge = signal.direction === 'BUY'
      ? '🟢 <b>CALL (BUY)</b>'
      : '🔴 <b>PUT (SELL)</b>';

    const directionEmoji = signal.direction === 'BUY' ? '📈' : '📉';

    const confidencePct = (signal.confidence * 100).toFixed(1);
    const winRateText = signal.strategyWinRate
      ? ` | <b>WR:</b> ${signal.strategyWinRate}% (n=${signal.strategyHistoricalSampleSize || 300})`
      : '';

    const confluenceItems = (signal.confluenceStrategies || [])
      .map(c => `  ▫️ <i>${escapeHtml(c)}</i>`)
      .slice(0, 5)
      .join('\n');

    const htmlMessage =
      `⚡ <b>SIGNALFORGE — 5M LIVE SIGNAL (3-MIN ADVANCE)</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📊 <b>PAIR:</b> <code>${escapeHtml(signal.symbol)}</code>\n` +
      `🧭 <b>DIRECTION:</b> ${directionBadge} ${directionEmoji}\n` +
      `⏱️ <b>EXPIRY HORIZON:</b> <code>${signal.expiryMinutes}m</code>\n` +
      `📢 <b>ALERT ISSUED (IST):</b> <code>${escapeHtml(signal.predictionTimeIst || formatIstTime(signal.predictionTimeUtc))}</code>\n` +
      `🎯 <b>CANDLE ENTRY (IST):</b> <code>${escapeHtml(signal.candleOpenTimeIst || 'Upcoming 5M Open')}</code>\n` +
      `⏳ <b>ADVANCE PREPARATION:</b> <code>Full 3 Minutes</code>\n` +
      `📍 <b>TRIGGER PRICE:</b> <code>${formatForexPrice(signal.symbol, signal.triggerPrice)}</code>\n` +
      `🧠 <b>CONVICTION:</b> <b>${confidencePct}%</b>${winRateText}\n` +
      `🏷️ <b>STRATEGY:</b> <i>${escapeHtml(signal.strategyName || 'Multi-Model Confluence')}</i>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🔬 <b>TECHNICAL CONFLUENCE:</b>\n` +
      `${confluenceItems || '  ▫️ <i>Statistical Volatility &amp; Order Flow Confluence</i>'}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `⏳ <b>EXECUTION PROTOCOL:</b>\n` +
      `• Signal broadcast 3 minutes in advance for broker preparation.\n` +
      `• Place order strictly at candle open: <b>${escapeHtml(signal.candleOpenTimeIst || '5M Candle Open')}</b>.\n` +
      `• Never chase late entries.\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🤖 <i>SignalForge ML Autonomous Terminal</i>`;

    return this.broadcast(htmlMessage);
  }

  /**
   * Format a complete institutional WIN / LOSS / SCRATCH Audit Report for a settled signal.
   */
  public formatSettlementAuditReport(trade: ResearchSignal): string {
    const isWin = trade.outcomeResult === 'WIN';
    const isLoss = trade.outcomeResult === 'LOSS';
    const isScratch = trade.outcomeResult === 'SCRATCH';

    const statusHeader = isWin
      ? '✅ <b>WIN AUDIT REPORT — SIGNAL RESULT</b>'
      : isLoss
      ? '❌ <b>LOSS AUDIT REPORT — SIGNAL RESULT</b>'
      : '⚪ <b>SCRATCH (TIE) AUDIT REPORT — SIGNAL RESULT</b>';

    const directionLabel = trade.direction === 'BUY' ? 'CALL (BUY) 📈' : 'PUT (SELL) 📉';
    const entryPrice = trade.actualEntryPrice ?? trade.triggerPrice;
    const exitPrice = trade.actualExitPrice;
    const displacementPips = resolveTradeDisplacementPips(trade);
    const pipsText = `${displacementPips > 0 ? '+' : ''}${displacementPips.toFixed(1)} pips`;

    const payoutPct = trade.payoutPct ?? 80;
    const netUnits =
      trade.netReturnUnits !== null && trade.netReturnUnits !== undefined
        ? trade.netReturnUnits
        : isWin
        ? Number((payoutPct / 100).toFixed(2))
        : isLoss
        ? -1.0
        : 0;
    const unitsText = `${netUnits > 0 ? '+' : ''}${netUnits.toFixed(2)} U`;

    const outcomeLine = isWin
      ? `🟢 <b>VERIFIED WIN:</b> <b>${unitsText}</b> (<code>${pipsText}</code> @ ${payoutPct}% payout)`
      : isLoss
      ? `🔴 <b>VERIFIED LOSS:</b> <b>${unitsText}</b> (<code>${pipsText}</code>)`
      : `⚪ <b>VERIFIED PUSH:</b> <b>0.00 U</b> (<code>0.0 pips</code> — Stake Refunded)`;

    const alertIst = trade.predictionTimeIst || formatIstTime(trade.predictionTimeUtc);
    const entryIst = trade.candleOpenTimeIst || formatIstTime(trade.actualEntryTimeUtc || trade.candleOpenTimeUtc);
    const exitIst = formatIstTime(trade.actualExitTimeUtc || trade.candleCloseTimeUtc || trade.plannedExitTimeUtc || new Date().toISOString());
    const convictionPct = `${(trade.confidence * 100).toFixed(1)}%`;

    const closedEvent = [...(trade.lifecycleHistory || [])].reverse().find(e => e.toState === 'CLOSED');
    const feedAuditSource = trade.entrySource
      ? trade.entrySource.toUpperCase()
      : closedEvent?.reason?.toLowerCase().includes('dukascopy')
      ? 'DUKASCOPY'
      : closedEvent?.reason?.toLowerCase().includes('yahoo')
      ? 'YAHOO'
      : 'LIVE MARKET FEED';

    // Outcome Audit Verdict / Forensic Loss Autopsy Section
    let auditSection = '';
    if (isWin) {
      auditSection =
        `🏆 <b>AUDIT VERDICT:</b>\n` +
        `• In-the-money at expiry by <code>${pipsText}</code> on verified <b>${escapeHtml(feedAuditSource)}</b> feed.\n` +
        `• Strategy edge confirmed: <i>${escapeHtml(trade.strategyName || trade.ruleFamily)}</i>`;
    } else if (isLoss) {
      if (trade.lossAutopsy) {
        const rootCauseFormatted = trade.lossAutopsy.rootCause.replace(/_/g, ' ');
        const explanation = (trade.lossAutopsy.rootCauseExplanation || '').slice(0, 240);
        const lesson = (trade.lossAutopsy.lessonsLearned?.[0] || '').slice(0, 180);
        auditSection =
          `🔬 <b>FORENSIC LOSS AUTOPSY:</b>\n` +
          `• <b>Root Cause:</b> <code>${escapeHtml(rootCauseFormatted)}</code>\n` +
          (explanation ? `• <b>Finding:</b> ${escapeHtml(explanation)}\n` : '') +
          (lesson ? `• <b>Lesson:</b> ${escapeHtml(lesson)}\n` : '') +
          (trade.lossAutopsy.antidoteStrategyName
            ? `• <b>Evolved Antidote:</b> <i>${escapeHtml(trade.lossAutopsy.antidoteStrategyName)}</i>`
            : '');
      } else {
        auditSection =
          `🔬 <b>LOSS AUDIT FINDING:</b>\n` +
          `• Out-of-the-money at expiry (<code>${pipsText}</code>) on verified <b>${escapeHtml(feedAuditSource)}</b> feed.\n` +
          `• Logged into permanent forensic ledger for strategy calibration.`;
      }
    } else if (isScratch) {
      auditSection =
        `⚖️ <b>AUDIT VERDICT:</b>\n` +
        `• Exact strike tie at expiry (<code>0.0 pips</code>). Full stake returned (<code>0.00 U</code>).`;
    }

    // Live Updated Win / Loss Scorecard
    const scorecard = this.computeAuditScorecard(trade);
    const fmtUnits = (u: number) => `${u > 0 ? '+' : ''}${u.toFixed(2)} U`;
    const todayScratchNote = scorecard.today.scratches > 0 ? ` · ${scorecard.today.scratches}T` : '';
    const overallScratchNote = scorecard.overall.scratches > 0 ? ` · ${scorecard.overall.scratches}T` : '';
    const streakSuffix = scorecard.streakText ? ` | 🔥 <b>${scorecard.streakText}</b>` : '';

    return (
      `${statusHeader}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📊 <b>PAIR:</b> <code>${escapeHtml(trade.symbol)}</code> · ${directionLabel}\n` +
      `⏱️ <b>EXPIRY:</b> <code>${trade.expiryMinutes}m</code> | <b>CONVICTION:</b> <b>${convictionPct}</b>\n` +
      `🌐 <b>SESSION:</b> <i>${escapeHtml(trade.marketSessionName || 'Active Forex Session')}</i>\n` +
      `🏷️ <b>STRATEGY:</b> <i>${escapeHtml(trade.strategyName || trade.ruleFamily || 'Stacked Model')}</i>\n` +
      `🆔 <b>AUDIT REF:</b> <code>${escapeHtml(trade.id)}</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🕒 <b>IST EXECUTION TIMELINE:</b>\n` +
      `• <b>Alert Issued:</b> <code>${escapeHtml(alertIst)}</code>\n` +
      `• <b>Entry Fill:</b> <code>${escapeHtml(entryIst)}</code>\n` +
      `• <b>Settled At:</b> <code>${escapeHtml(exitIst)}</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📍 <b>ENTRY STRIKE:</b> <code>${formatForexPrice(trade.symbol, entryPrice)}</code>\n` +
      `🏁 <b>EXPIRY CLOSE:</b> <code>${formatForexPrice(trade.symbol, exitPrice)}</code>\n` +
      `📏 <b>DISPLACEMENT:</b> <code>${pipsText}</code>\n` +
      `💰 <b>RESULT:</b> ${outcomeLine}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `${auditSection}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📊 <b>LIVE AUDIT SCORECARD (${scorecard.todayDateKey} IST):</b>\n` +
      `• <b>Today:</b> <b>${scorecard.today.wins}W - ${scorecard.today.losses}L</b>${todayScratchNote} | <b>WR:</b> ${scorecard.today.winRatePct.toFixed(1)}% | <b>Net:</b> ${fmtUnits(scorecard.today.netUnits)}\n` +
      `• <b>7D Ledger:</b> <b>${scorecard.overall.wins}W - ${scorecard.overall.losses}L</b>${overallScratchNote} | <b>WR:</b> ${scorecard.overall.winRatePct.toFixed(1)}% | <b>Net:</b> ${fmtUnits(scorecard.overall.netUnits)}${streakSuffix}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🤖 <i>SignalForge ML Forensic Settlement Audit</i>`
    );
  }

  /**
   * Dispatch a verified WIN / LOSS / SCRATCH Audit Report for a settled signal.
   * Deduplicated per signal ID so every settled result dispatches exactly once automatically.
   */
  public async sendSettlementAlert(
    trade: ResearchSignal,
    options?: { forceResend?: boolean; targetChatId?: string | number }
  ): Promise<TelegramDispatchResult[]> {
    const forceResend = Boolean(options?.forceResend);
    const config = db.getTelegramConfig();

    if (!forceResend) {
      if (!config.enabled || !config.notifyOnSettlement) {
        return [];
      }
      if (trade.ruleFamily?.startsWith('test_')) {
        return [];
      }
      if (this.dispatchedAuditSignalIds.has(trade.id) || trade.telegramAuditSentAt) {
        return [];
      }
      this.dispatchedAuditSignalIds.add(trade.id);
    }

    const htmlMessage = this.formatSettlementAuditReport(trade);

    try {
      let results: TelegramDispatchResult[];
      if (options?.targetChatId) {
        const res = await this.sendMessage(options.targetChatId, htmlMessage);
        results = [{ subscriberId: options.targetChatId, success: res.ok, error: res.error }];
      } else {
        results = await this.broadcast(htmlMessage, forceResend);
      }

      const deliveredCount = results.filter(r => r.success).length;
      if (deliveredCount > 0) {
        trade.telegramAuditSentAt = trade.telegramAuditSentAt || new Date().toISOString();
        db.updateSignal(trade);
      } else if (!forceResend) {
        // Release in-memory lock if zero subscribers or transient failure prevented delivery
        this.dispatchedAuditSignalIds.delete(trade.id);
      }

      return results;
    } catch (err) {
      if (!forceResend) {
        this.dispatchedAuditSignalIds.delete(trade.id);
      }
      throw err;
    }
  }

  /**
   * Format an on-demand Win & Loss Audit Summary Report covering Today (IST) and 7D Ledger.
   */
  public formatDailyAuditSummaryReport(): string {
    const scorecard = this.computeAuditScorecard();
    const nowIst = formatIstTime(new Date().toISOString());
    const fmtUnits = (u: number) => `${u > 0 ? '+' : ''}${u.toFixed(2)} U`;
    const fmtPips = (p: number) => `${p > 0 ? '+' : ''}${p.toFixed(1)} pips`;

    const recentLines = scorecard.recentClosed.length > 0
      ? scorecard.recentClosed
          .map(s => {
            const icon = s.outcomeResult === 'WIN' ? '✅' : s.outcomeResult === 'LOSS' ? '❌' : '⚪';
            const dir = s.direction === 'BUY' ? 'CALL' : 'PUT';
            const pips = resolveTradeDisplacementPips(s);
            const units = s.netReturnUnits ?? (s.outcomeResult === 'WIN' ? (s.payoutPct ?? 80) / 100 : s.outcomeResult === 'LOSS' ? -1 : 0);
            const tIst = s.candleOpenTimeIst || formatIstTime(s.actualEntryTimeUtc || s.predictionTimeUtc);
            return `${icon} <code>${escapeHtml(s.symbol)}</code> ${dir} | <b>${units > 0 ? '+' : ''}${units.toFixed(2)} U</b> (<code>${pips > 0 ? '+' : ''}${pips.toFixed(1)}p</code>) · <i>${escapeHtml(tIst)}</i>`;
          })
          .join('\n')
      : '<i>No settled signal results recorded yet.</i>';

    const todayScratches = scorecard.today.scratches > 0 ? ` · ${scorecard.today.scratches} Push` : '';
    const overallScratches = scorecard.overall.scratches > 0 ? ` · ${scorecard.overall.scratches} Push` : '';

    return (
      `📋 <b>SIGNALFORGE ML — WIN &amp; LOSS AUDIT SUMMARY</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🗓️ <b>AUDIT DATE (IST):</b> <code>${scorecard.todayDateKey}</code>\n` +
      `🕒 <b>GENERATED AT:</b> <code>${escapeHtml(nowIst)}</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📅 <b>TODAY'S AUDITED PERFORMANCE (IST):</b>\n` +
      `• <b>Wins / Losses:</b> <b>${scorecard.today.wins}W - ${scorecard.today.losses}L</b>${todayScratches}\n` +
      `• <b>Win Rate:</b> <b>${scorecard.today.winRatePct.toFixed(1)}%</b> (n=${scorecard.today.scored})\n` +
      `• <b>Net Stake PnL:</b> <b>${fmtUnits(scorecard.today.netUnits)}</b>\n` +
      `• <b>Gross Displacement:</b> <code>${fmtPips(scorecard.today.grossPips)}</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📈 <b>7-DAY IMMUTABLE LEDGER TOTAL:</b>\n` +
      `• <b>Wins / Losses:</b> <b>${scorecard.overall.wins}W - ${scorecard.overall.losses}L</b>${overallScratches}\n` +
      `• <b>Win Rate:</b> <b>${scorecard.overall.winRatePct.toFixed(1)}%</b> (n=${scorecard.overall.scored})\n` +
      `• <b>Net Stake PnL:</b> <b>${fmtUnits(scorecard.overall.netUnits)}</b>\n` +
      (scorecard.streakText ? `• <b>Current Streak:</b> <b>${scorecard.streakText}</b>\n` : '') +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🧾 <b>RECENT AUDITED SIGNAL RESULTS:</b>\n` +
      `${recentLines}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🤖 <i>SignalForge ML Forensic Settlement Ledger</i>`
    );
  }

  /**
   * Dispatch a full Daily Win & Loss Audit Summary Report to Telegram on demand.
   */
  public async sendDailyAuditSummaryReport(targetChatId?: string | number): Promise<{
    success: boolean;
    sentTo: number;
    error?: string;
  }> {
    const summaryMessage = this.formatDailyAuditSummaryReport();

    if (targetChatId) {
      const res = await this.sendMessage(targetChatId, summaryMessage);
      return { success: res.ok, sentTo: res.ok ? 1 : 0, error: res.error };
    }

    const config = db.getTelegramConfig();
    if (config.subscribers.length === 0) {
      return {
        success: false,
        sentTo: 0,
        error: 'No Telegram subscribers registered yet. Message @Forex_new_calender_bot on Telegram or add your Chat ID first.',
      };
    }

    const results = await this.broadcast(summaryMessage, true);
    const delivered = results.filter(r => r.success).length;
    return {
      success: delivered > 0,
      sentTo: delivered,
      error: delivered === 0 ? 'Failed to deliver audit summary to registered subscribers' : undefined,
    };
  }

  /**
   * Send a test verification alert to verify connectivity and format
   */
  public async sendTestAlert(targetChatId?: string | number): Promise<{
    success: boolean;
    sentTo: number;
    error?: string;
  }> {
    const nowIst = formatIstTime(new Date().toISOString());

    const testMessage =
      `🧪 <b>SIGNALFORGE ML — TELEGRAM CONNECTION TEST</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `✅ <b>Status:</b> System Connected &amp; Calibrated\n` +
      `🕒 <b>Time:</b> <code>${nowIst}</code>\n` +
      `🤖 <b>Bot Profile:</b> <code>@Forex_new_calender_bot</code>\n` +
      `📊 <b>Monitoring:</b> 20 Forex Pairs (5M Candle Timeframe)\n` +
      `⚡ <b>Advance Notice:</b> 3 Minutes Prior to 5M Candle Open\n` +
      `📋 <b>Settlement Audits:</b> Automatic Win &amp; Loss Audit Report for every signal result\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `<i>All live trading signals and full Win/Loss Audit Reports will arrive here automatically.</i>`;

    if (targetChatId) {
      const res = await this.sendMessage(targetChatId, testMessage);
      return { success: res.ok, sentTo: res.ok ? 1 : 0, error: res.error };
    }

    const config = db.getTelegramConfig();
    if (config.subscribers.length === 0) {
      return {
        success: false,
        sentTo: 0,
        error: 'No Telegram subscribers registered yet. Message @Forex_new_calender_bot on Telegram or add your Chat ID first.',
      };
    }

    const results = await this.broadcast(testMessage, true);
    const delivered = results.filter(r => r.success).length;
    return {
      success: delivered > 0,
      sentTo: delivered,
      error: delivered === 0 ? 'Failed to deliver to registered subscribers' : undefined,
    };
  }
}

export const telegramService = new TelegramService();
