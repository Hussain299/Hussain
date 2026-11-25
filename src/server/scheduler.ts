/**
 * SignalForge ML — Scheduled signal and research coordinator.
 * Collects market candles, manages causal signal lifecycles, validates candidates
 * on imported history, and records forward paper-trading outcomes.
 */

import {
  AutopilotLog,
  Candle,
  EvolutionGeneration,
  FOREX_PAIRS,
  ForexSymbol,
  ResearchExperiment,
  RuleFamily,
} from '../types/index.js';
import { dataFeedEngine, getFreshRealCandleWindow, getSessionFromTimestamp, isForexMarketOpen } from './dataFeeds.js';
import { db } from './db.js';
import { entryExitEngine } from './entryExitEngine.js';
import { researchEngine } from './researchEngine.js';
import { historicalDataStore } from './historicalData.js';
import { agiSelfLearningEngine } from './agiEngine.js';
import { onlinePolicyNetwork } from './onlinePolicyNetwork.js';
import { behaviouralEngine } from './behaviouralEngine.js';
import { botAuditor } from './botAuditor.js';
import { telegramService } from './telegramService.js';

const FIVE_MINUTE_MS = 5 * 60 * 1000;

/**
 * Whether a pulse request arrived inside the strict 3-minute advance discovery
 * window (210–145 seconds before the next 5-minute candle open).
 */
export function isWithinStrictSignalDiscoveryWindow(timestampMs: number): boolean {
  if (!Number.isFinite(timestampMs)) return false;
  const next5mOpenMs = (Math.floor(timestampMs / FIVE_MINUTE_MS) + 1) * FIVE_MINUTE_MS;
  const msUntilNextOpen = next5mOpenMs - timestampMs;
  return msUntilNextOpen <= 210_000 && msUntilNextOpen >= 145_000;
}

export class AutonomousScheduler {
  private isRunningCycle = false;
  // Preserve exact/cron scan requests when a slower sensing cycle currently owns the scheduler.
  private pendingSignalScan = false;
  private autopilotTimer: NodeJS.Timeout | null = null;
  private advanceTimer: NodeJS.Timeout | null = null;
  private autopilotIntervalMs = 25 * 1000; // Poll configured pairs every 25 seconds (plus exact 3M advance timer)
  private currentGeneration = 1;
  private cycleCount = 0;
  private hasBootstrappedOnlineModel = false;

  constructor() {
    const existingGens = db.getGenerations();
    if (existingGens.length > 0) {
      this.currentGeneration = existingGens[0].generation + 1;
    }
  }

  private syncOnlineLearningWithLedger(candlesMap?: Partial<Record<ForexSymbol, Candle[]>>) {
    try {
      agiSelfLearningEngine.hydrateFromPersistentLedger();
      const getCombinedRealCandles = (symbol: ForexSymbol): Candle[] => {
        const byTs = new Map<number, Candle>();
        for (const c of historicalDataStore.getCandles(symbol) || []) {
          if (c && c.source !== 'synthetic') byTs.set(c.timestampMs, c);
        }
        for (const c of db.getCandles(symbol, 500) || []) {
          if (c && c.source !== 'synthetic') byTs.set(c.timestampMs, c);
        }
        for (const c of candlesMap?.[symbol] || []) {
          if (c && c.source !== 'synthetic') byTs.set(c.timestampMs, c);
        }
        return Array.from(byTs.values()).sort((a, b) => a.timestampMs - b.timestampMs);
      };

      const res = onlinePolicyNetwork.bootstrapFromSettledSignals(
        getCombinedRealCandles,
        (candle, history) => agiSelfLearningEngine.extractFeatureVector(candle, history)
      );

      if (res.trainedCount > 0) {
        // Re-hydrate AGI episodic memories after onlinePolicyNetwork persisted newly trained vectors
        agiSelfLearningEngine.hydrateFromPersistentLedger();
        this.logMind(
          'MIND',
          `Online Policy Network caught up on ${res.trainedCount} settled trades (causal entry vectors). Total Adam steps: ${res.stepCount}.`
        );
      }
      this.hasBootstrappedOnlineModel = true;
    } catch (err: any) {
      console.error('[Scheduler] Online learning bootstrap error:', err?.message || err);
    }
  }

  /**
   * Precision 3-Minute Advance Pulse Scheduler:
   * Dynamically synchronizes to the exact 3-minute advance second (:02:00, :07:00, :12:00, :17:00...)
   * guaranteeing that every 5M signal is evaluated and dispatched with ~2m 55s to 3m 00s of advance preparation time.
   */
  private scheduleNext3MinuteAdvancePulse() {
    if (this.advanceTimer) {
      clearTimeout(this.advanceTimer);
      this.advanceTimer = null;
    }
    const now = Date.now();
    const FIVE_MIN_MS = 5 * 60 * 1000;
    const current5mOpenMs = Math.floor(now / FIVE_MIN_MS) * FIVE_MIN_MS;
    // Exactly 2 minutes into the 5M candle is the 3-minute advance mark (180s before next 5M open)
    let target3mMs = current5mOpenMs + (2 * 60 * 1000);
    if (target3mMs <= now) {
      target3mMs += FIVE_MIN_MS;
    }
    const delayMs = Math.max(250, target3mMs - now);

    this.advanceTimer = setTimeout(() => {
      if (this.isRunning()) {
        // Queue the scan before invoking the pulse: the current 29-pair sensing
        // cycle may still be running, and executeAutopilotPulse must not drop it.
        this.pendingSignalScan = true;
        void this.executeAutopilotPulse('EXACT_3M_ADVANCE_TRIGGER');
        this.scheduleNext3MinuteAdvancePulse();
      }
    }, delayMs);
  }

  public start() {
    if (this.autopilotTimer) return;
    console.log('[Autopilot] Starting SignalForge scheduled signal and research coordinator...');

    // Sweep any stale active signals from previous session/weekend
    entryExitEngine.sweepStaleActiveSignals();

    // Hydrate AGI bandit arms / PID controller and catch up online MLP weights from persisted ledger
    this.syncOnlineLearningWithLedger();

    this.logMind(
      'MIND',
      `Research coordinator online. 25-second precision pulse + synchronous 3-minute advance timer across ${FOREX_PAIRS.length} configured currency pairs.`
    );

    // Defer initial warm pulse briefly so cold-start HTTP/Vite traffic gets full priority
    setTimeout(() => {
      this.executeAutopilotPulse('WARMUP');
    }, 4000);

    // Continuous autonomous pulse every 25 seconds (exact 3M timer still fires at :02, :07, :12...)
    this.autopilotTimer = setInterval(() => {
      this.executeAutopilotPulse('AUTONOMOUS_PULSE');
    }, this.autopilotIntervalMs);

    // Schedule precision 3-minute advance pulse aligned to :02, :07, :12, :17...
    this.scheduleNext3MinuteAdvancePulse();
  }

  public stop() {
    if (this.autopilotTimer) {
      clearInterval(this.autopilotTimer);
      this.autopilotTimer = null;
    }
    if (this.advanceTimer) {
      clearTimeout(this.advanceTimer);
      this.advanceTimer = null;
    }
    this.logMind('MIND', 'Autopilot pulse paused.');
  }

  public isRunning(): boolean {
    return this.autopilotTimer !== null;
  }

  public getUptimeTelemetry() {
    const cron = db.getCronState();
    const kService = process.env.K_SERVICE || '';
    const isAiStudioDevPreview =
      kService.startsWith('ais-dev-') ||
      (process.env.NODE_ENV !== 'production' && !kService.startsWith('ais-pre-'));
    const market = isForexMarketOpen(new Date());
    const lastExtMs = cron.lastExternalCronAt ? Date.parse(cron.lastExternalCronAt) : 0;
    const isExternalCronActive = lastExtMs > 0 && Date.now() - lastExtMs <= 5 * 60 * 1000;

    return {
      runtimeMode: isAiStudioDevPreview ? 'AI_STUDIO_DEV_PREVIEW' : 'DEPLOYED_PRODUCTION',
      isSandboxedPreview: isAiStudioDevPreview,
      serviceName: kService || 'local-node',
      schedulerRunning: this.isRunning(),
      uptimeSeconds: Math.floor(process.uptime()),
      marketOpen: market.isOpen,
      marketStatusText: market.statusText,
      lastPulseAt: cron.lastRun,
      lastExternalCronAt: cron.lastExternalCronAt || null,
      externalCronCount: cron.externalCronCount || 0,
      lastExternalCronSource: cron.lastExternalCronSource || null,
      isExternalCronActive,
      is24x5Guaranteed: !isAiStudioDevPreview && isExternalCronActive,
      cronTickPath: '/api/cron/tick',
      recommendedIntervalSeconds: 60,
    };
  }

  private logMind(
    role: AutopilotLog['role'],
    message: string,
    symbol?: ForexSymbol,
    signalId?: string
  ) {
    db.addAutopilotLog({
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      role,
      message,
      symbol,
      signalId,
    });
  }

  private recordBehavioralValidation(signal: any, candles: Candle[]) {
    try {
      const botHealth = db.getBotHealthState() || botAuditor.auditBotHealth(db.getSignals(), db.getLossAutopsies());
      db.saveBotHealthState(botHealth);
      const validation = behaviouralEngine.validateSignal(signal, candles, botHealth);
      const activeHyp = validation.activeHypotheses.filter(h => h.isActive);
      db.addBehaviouralMemoryRecord({
        id: `bmem_${signal.id}`,
        signalId: signal.id,
        symbol: signal.symbol,
        direction: signal.direction,
        timestampIst: signal.predictionTimeIst,
        baselineConfidence: validation.baselineConfidence,
        adjustedConfidence: validation.behaviouralAdjustedConfidence,
        marketRegime: activeHyp[0]?.type || 'NORMAL_FLOW',
        activeBehaviors: activeHyp.map(h => h.type),
        evidenceSnapshot: validation.evidenceSummary.slice(0, 2).join(' | ') || 'Baseline technical alignment',
        recommendation: validation.recommendation,
        actualOutcome: 'PENDING',
        predictionError: null,
        grossReturnPips: null,
        netReturnUnits: null,
        avoidedLoss: false,
      });

      this.logMind(
        'AUDITOR',
        `🧠 [BEHAVIOURAL VALIDATION · SHADOW]: ${signal.symbol} ${signal.direction} -> Recommendation: ${validation.recommendation} (Conf: ${(validation.baselineConfidence * 100).toFixed(0)}% -> ${(validation.behaviouralAdjustedConfidence * 100).toFixed(0)}%). Active Catalysts: ${activeHyp.length}. ${validation.decisionRationale}`,
        signal.symbol,
        signal.id
      );
    } catch (err: any) {
      console.error('[Scheduler] Behavioral validation error:', err.message);
    }
  }

  /**
   * Continuous Autonomous Autopilot Pulse:
   * Senses market -> Evaluates active signals -> Scans for setups -> Emits signals -> Evolves models.
   */
  public async executeAutopilotPulse(triggerSource: string = 'AUTOPILOT'): Promise<{
    durationMs: number;
    pairsProcessed: number;
    signalsCreated: number;
    signalsUpdated: number;
    experimentsRun: number;
    topExperiment: ResearchExperiment | null;
  }> {
    const pulseRequestedAtMs = Date.now();
    const isForcedScanRequest = [
      'WARMUP',
      'MANUAL_TRIGGER',
      'SCAN_NOW',
      'SERVICE_WORKER_BACKGROUND_PULSE',
      'EXACT_3M_ADVANCE_TRIGGER',
    ].includes(triggerSource);

    // Capture eligibility before data fetching. A 29-pair provider sweep can
    // take longer than the remaining part of the 65-second discovery window.
    if (isWithinStrictSignalDiscoveryWindow(pulseRequestedAtMs) || isForcedScanRequest) {
      this.pendingSignalScan = true;
    }

    if (this.isRunningCycle) {
      return {
        durationMs: 0,
        pairsProcessed: 0,
        signalsCreated: 0,
        signalsUpdated: 0,
        experimentsRun: 0,
        topExperiment: null,
      };
    }

    this.isRunningCycle = true;
    const startTime = Date.now();
    this.cycleCount++;

    try {
      // 0. Weekend Market Closure Guard
      const marketState = isForexMarketOpen(new Date());
      if (!marketState.isOpen) {
        // Safely sweep and reconcile any stale active/waiting signals from Friday, and send Telegram Audit Reports for any settled trades
        this.pendingSignalScan = false;
        const weekendSwept = entryExitEngine.sweepStaleActiveSignals();
        const weekendAuditDispatches: Array<Promise<any>> = [];
        for (const sig of weekendSwept) {
          if (sig.lifecycleState === 'CLOSED' && ['WIN', 'LOSS', 'SCRATCH'].includes(sig.outcomeResult)) {
            db.updateBehaviouralMemoryOutcome(sig.id, sig.outcomeResult, sig.netReturnPips, sig.netReturnUnits);
            if (sig.outcomeResult === 'LOSS' && !sig.lossAutopsy) {
              const storedCandles = db.getCandles(sig.symbol, 5);
              const lastCandle = storedCandles[storedCandles.length - 1] || ({
                close: sig.actualExitPrice || sig.actualEntryPrice || 0,
                high: sig.actualExitPrice || sig.actualEntryPrice || 0,
                low: sig.actualExitPrice || sig.actualEntryPrice || 0,
                open: sig.actualEntryPrice || 0,
                volume: 100,
                timestamp: sig.actualExitTimeUtc || new Date().toISOString(),
                timestampMs: Date.now(),
                source: 'dukascopy',
                symbol: sig.symbol,
              } as Candle);
              const { autopsy } = researchEngine.conductForensicLossAutopsy(sig, lastCandle);
              sig.lossAutopsy = autopsy;
              db.addLossAutopsy(autopsy);
              db.updateSignal(sig);
            }
            weekendAuditDispatches.push(
              telegramService.sendSettlementAlert(sig).catch(err => {
                console.error('[Scheduler] Weekend Telegram audit dispatch error:', err.message);
              })
            );
          }
        }
        if (weekendAuditDispatches.length > 0) {
          await Promise.allSettled(weekendAuditDispatches);
        }

        // Log status periodically (once every ~3 minutes) so the log stream isn't spammed
        if (this.cycleCount % 9 === 1) {
          this.logMind(
            'MIND',
            `⏸️ [FOREX WEEKEND CLOSURE]: Global Forex market is closed (${marketState.statusText}). Real-time broker trading and signal generation are paused until market reopen.`
          );
        }

        this.isRunningCycle = false;
        return {
          durationMs: Date.now() - startTime,
          pairsProcessed: 0,
          signalsCreated: 0,
          signalsUpdated: weekendSwept.length,
          experimentsRun: 0,
          topExperiment: null,
        };
      }

      const pendingTelegramDispatches: Array<Promise<any>> = [];

      // Continuous 7-day history housekeeping
      db.purgeSignalsOlderThan24Hours();

      // Periodically sync new Telegram subscribers who messaged /start to the bot
      if (this.cycleCount % 6 === 1) {
        telegramService.syncSubscribersFromUpdates().catch(() => {});
      }

      const candlesMap: Record<ForexSymbol, Candle[]> = {} as any;
      let totalCandlesFetched = 0;

      // 1. Autonomous Market Sensing across all configured ranked forex pairs in bounded concurrency batches of 5
      // Prevents socket/memory/CPU spikes while still fetching all fresh real candles BEFORE sweeping or evaluating trades.
      const FETCH_BATCH_SIZE = 5;
      for (let i = 0; i < FOREX_PAIRS.length; i += FETCH_BATCH_SIZE) {
        const batch = FOREX_PAIRS.slice(i, i + FETCH_BATCH_SIZE);
        await Promise.all(
          batch.map(async (symbol) => {
            try {
              const res = await dataFeedEngine.fetchCandles(symbol, 100);
              // Require a fresh newest real candle, but retain the preceding real M1
              // history for EMA/RSI/ATR/regime features. Applying a 90s age filter to
              // every candle leaves fewer than 35 rows and silently disables discovery.
              const nowMs = Date.now();
              const freshStoredWindow = getFreshRealCandleWindow(db.getCandles(symbol, 100), symbol, nowMs, undefined, 100);
              const freshFetchedWindow = getFreshRealCandleWindow(res.candles, symbol, nowMs, undefined, 100);
              const byTimestamp = new Map<number, Candle>();
              for (const candle of freshStoredWindow) byTimestamp.set(candle.timestampMs, candle);
              // Prefer this cycle's provider candle if it shares a timestamp with persisted data.
              for (const candle of freshFetchedWindow) byTimestamp.set(candle.timestampMs, candle);
              candlesMap[symbol] = Array.from(byTimestamp.values())
                .sort((a, b) => a.timestampMs - b.timestampMs)
                .slice(-100);
              totalCandlesFetched += candlesMap[symbol].length;
            } catch (err: any) {
              console.error(`[Autopilot] Sensing failed for ${symbol}:`, err.message);
            }
          })
        );
      }

      // 1b. Reconcile any stale or previously candle-delayed settlements using freshly fetched real candles
      const sweptSignals = entryExitEngine.sweepStaleActiveSignals(candlesMap);
      for (const sig of sweptSignals) {
        if (sig.lifecycleState === 'CLOSED' && ['WIN', 'LOSS', 'SCRATCH'].includes(sig.outcomeResult)) {
          db.updateBehaviouralMemoryOutcome(sig.id, sig.outcomeResult, sig.netReturnPips, sig.netReturnUnits);
          if (sig.outcomeResult === 'LOSS' && !sig.lossAutopsy) {
            const pairCandles = candlesMap[sig.symbol] || db.getCandles(sig.symbol, 5);
            const lastCandle = pairCandles[pairCandles.length - 1] || ({
              close: sig.actualExitPrice || sig.actualEntryPrice || 0,
              high: sig.actualExitPrice || sig.actualEntryPrice || 0,
              low: sig.actualExitPrice || sig.actualEntryPrice || 0,
              open: sig.actualEntryPrice || 0,
              volume: 100,
              timestamp: sig.actualExitTimeUtc || new Date().toISOString(),
              timestampMs: Date.now(),
              source: 'dukascopy',
              symbol: sig.symbol,
            } as Candle);
            const { autopsy } = researchEngine.conductForensicLossAutopsy(sig, lastCandle);
            sig.lossAutopsy = autopsy;
            db.addLossAutopsy(autopsy);
            db.updateSignal(sig);
          }
          pendingTelegramDispatches.push(
            telegramService.sendSettlementAlert(sig).catch(err => {
              console.error('[Scheduler] Swept Telegram audit dispatch error:', err.message);
            })
          );
        }
      }
      if (sweptSignals.some(s => s.lifecycleState === 'CLOSED')) {
        try {
          const updatedBotHealth = botAuditor.auditBotHealth(db.getSignals(), db.getLossAutopsies());
          db.saveBotHealthState(updatedBotHealth);
        } catch (err: any) {
          console.error('[Scheduler] Bot health audit error after sweep:', err.message);
        }
      }

      // 2. Step Causal Entry/Exit Engine for active trades
      const updatedSignals = entryExitEngine.evaluateSignals(candlesMap);
      if (updatedSignals.length > 0) {
        for (const sig of updatedSignals) {
          if (sig.lifecycleState === 'ACTIVE') {
            this.logMind(
              'EXECUTION',
              `Causal trigger confirmed for ${sig.symbol} ${sig.direction} at ${sig.actualEntryPrice}. Expiry clock running (${sig.expiryMinutes}m).`,
              sig.symbol,
              sig.id
            );
          } else if (sig.lifecycleState === 'CLOSED') {
            const tradeExp = db.recordForwardObservation(sig);
            db.recordStrategyOutcome(sig);
            db.updateBehaviouralMemoryOutcome(sig.id, sig.outcomeResult, sig.netReturnPips, sig.netReturnUnits);

            // AGI Autonomous Forensic Loss Investigation & Self-Correction Engine
            // Run BEFORE Telegram Audit Report dispatch so every LOSS report includes the real forensic autopsy!
            if (sig.outcomeResult === 'LOSS') {
              const lastCandle = candlesMap[sig.symbol]?.[candlesMap[sig.symbol].length - 1] || ({
                close: sig.actualExitPrice || sig.actualEntryPrice || 0,
                high: sig.actualExitPrice || sig.actualEntryPrice || 0,
                low: sig.actualExitPrice || sig.actualEntryPrice || 0,
                open: sig.actualEntryPrice || 0,
                volume: 100,
                timestamp: new Date().toISOString(),
                timestampMs: Date.now(),
                source: 'dukascopy',
                symbol: sig.symbol,
              } as Candle);

              const { autopsy, antidoteGene } = researchEngine.conductForensicLossAutopsy(sig, lastCandle);
              sig.lossAutopsy = autopsy;
              db.addLossAutopsy(autopsy);
              db.updateSignal(sig);

              this.logMind(
                'AUDITOR',
                `🔬 [FORENSIC LOSS AUTOPSY & SELF-CORRECTION]: Investigated loss on ${sig.symbol} (${sig.direction}). Root Cause: ${autopsy.rootCause}. Lesson: ${autopsy.lessonsLearned[0]}. Autonomously Evolved Antidote: ${antidoteGene.name} (${antidoteGene.mathematicalFormula}) [UNVALIDATED — not eligible for live strategy promotion].`,
                sig.symbol,
                sig.id
              );
            } else {
              const dispPips = sig.grossReturnPips ?? sig.netReturnPips ?? 0;
              const dispUnits = sig.netReturnUnits ?? 0;
              this.logMind(
                'EXECUTION',
                `Position closed for ${sig.symbol} ${sig.direction} at ${sig.actualExitPrice}. Move: ${
                  dispPips > 0 ? '+' : ''
                }${dispPips} pips | Net: ${dispUnits > 0 ? '+' : ''}${dispUnits.toFixed(2)} U (${sig.outcomeResult}). Recorded as a forward paper observation ${tradeExp.id}.`,
                sig.symbol,
                sig.id
              );
            }

            try {
              const updatedBotHealth = botAuditor.auditBotHealth(db.getSignals(), db.getLossAutopsies());
              db.saveBotHealthState(updatedBotHealth);
            } catch (err: any) {
              console.error('[Scheduler] Bot health audit error:', err.message);
            }

            // Dispatch verified Win / Loss Audit Report to Telegram bot subscribers (awaited before pulse returns)
            pendingTelegramDispatches.push(
              telegramService.sendSettlementAlert(sig).catch(err => {
                console.error('[Scheduler] Telegram settlement audit dispatch error:', err.message);
              })
            );
          } else if (sig.lifecycleState === 'AMBIGUOUS') {
            this.logMind(
              'AUDITOR',
              `Marked ${sig.symbol} setup as AMBIGUOUS: both trigger & invalidation levels penetrated within 1m bar. Zero lookahead assumption enforced.`,
              sig.symbol,
              sig.id
            );
          }
        }
      }

      // 3. Autonomous Setup Discovery: Strictly 3-Minute Advance Signals on 5M Candle Openings
      // HUMAN STRICT RULE: Signals must ONLY be generated strictly within the 3-minute advance window!
      // A 5-minute advance signal is dangerous to accuracy because the setup candle has barely formed.
      // At 3 minutes advance (:32, :37, :42, etc.), 2 full minutes of candle volume and price discovery
      // have settled, providing maximum mathematical conviction.
      const createdSignals: any[] = [];
      const currentActive = db.getActiveSignals();
      const inFlightTrades = currentActive.filter(s => {
        const exitMs = s.plannedExitTimeUtc ? Date.parse(s.plannedExitTimeUtc) : 0;
        return exitMs === 0 || Date.now() < exitMs;
      });
      const inFlightSymbols = new Set(inFlightTrades.map(s => s.symbol));
      const activeSession = getSessionFromTimestamp(new Date());

      const nowMs = Date.now();
      const FIVE_MIN_MS = 5 * 60 * 1000;
      const THREE_MIN_MS = 3 * 60 * 1000;
      const current5mOpenMs = Math.floor(nowMs / FIVE_MIN_MS) * FIVE_MIN_MS;
      const next5mCandleOpenMs = current5mOpenMs + FIVE_MIN_MS;
      const msUntilNextOpen = next5mCandleOpenMs - nowMs;

      // Strict 3-Minute Advance Window:
      // Active between 210s and 145s prior to 5M candle open (65-second window centered at 180s / 3 minutes).
      // A 65-second window guarantees that ANY 1-minute external 24/5 cron pinger lands inside the window
      // every 5-minute candle cycle without ever missing a setup or emitting rushed/late signals.
      const isWithin3MinAdvanceWindow =
        isWithinStrictSignalDiscoveryWindow(pulseRequestedAtMs) ||
        isWithinStrictSignalDiscoveryWindow(nowMs);
      const isManualOrWarmup =
        triggerSource === 'WARMUP' ||
        triggerSource === 'MANUAL_TRIGGER' ||
        triggerSource === 'SCAN_NOW' ||
        triggerSource === 'SERVICE_WORKER_BACKGROUND_PULSE' ||
        triggerSource === 'EXACT_3M_ADVANCE_TRIGGER';
      const shouldScanForSignals =
        this.pendingSignalScan || isWithin3MinAdvanceWindow || isManualOrWarmup;

      // Consume the queued request only when reaching discovery. Any earlier
      // failure leaves it queued for the next pulse to retry.
      if (shouldScanForSignals) this.pendingSignalScan = false;

      if (!shouldScanForSignals && inFlightTrades.length < 6) {
        const secondsUntil3m = msUntilNextOpen > 210 * 1000
          ? Math.round((msUntilNextOpen - THREE_MIN_MS) / 1000)
          : Math.round((msUntilNextOpen + (2 * 60 * 1000)) / 1000);
        if (this.cycleCount % 6 === 0) {
          this.logMind(
            'MIND',
            `⏳ [STRICT 3M ADVANCE GUARD ACTIVE]: Setup candle maturing. 3-minute advance alert window opens in ${secondsUntil3m}s.`
          );
        }
      }

      // Emit new setups when capacity permits (up to 6 concurrent in-flight slots)
      if (shouldScanForSignals && inFlightTrades.length >= 6) {
        this.logMind(
          'AUDITOR',
          `[SIGNAL DISCOVERY BLOCKED] All 6 in-flight slots are occupied; ${inFlightSymbols.size} currency pairs already have pending contracts.`
        );
      }

      if (shouldScanForSignals && inFlightTrades.length < 6) {
        for (const symbol of FOREX_PAIRS) {
          // Strict Pair Isolation: If this pair already has an active in-flight trade, NEVER create another!
          if (inFlightSymbols.has(symbol)) {
            continue;
          }

          const candles = candlesMap[symbol];
          if (!candles || candles.length < 35) continue;

          const c = candles[candles.length - 1];
          const prev = candles[candles.length - 2];
          const range = Math.max(0.00008, c.high - c.low);
          const body = Math.abs(c.close - c.open);
          const bodyRatio = body / range;
          const upperWick = c.high - Math.max(c.open, c.close);
          const lowerWick = Math.min(c.open, c.close) - c.low;
          const isJpy = symbol.includes('JPY');
          const pipScale = isJpy ? 0.01 : 0.0001;

          // Technical indicators
          const closes = candles.map(k => k.close);
          const ema9 = researchEngine.calculateEMA(closes, 9);
          const ema21 = researchEngine.calculateEMA(closes, 21);
          const rsi14 = researchEngine.calculateRSI(closes, 14);

          const lastEma9 = ema9[ema9.length - 1];
          const lastEma21 = ema21[ema21.length - 1];
          const prevEma9 = ema9[ema9.length - 2] || lastEma9;
          const prevEma21 = ema21[ema21.length - 2] || lastEma21;
          const lastRsi = rsi14[rsi14.length - 1] || 50;

          // 20-period Moving Average and Extremes
          const recent20 = candles.slice(-20);
          const sma20 = recent20.reduce((acc, k) => acc + k.close, 0) / 20;
          const deviationPips = (c.close - sma20) / pipScale;
          const high20 = Math.max(...candles.slice(-20, -1).map(k => k.high));
          const low20 = Math.min(...candles.slice(-20, -1).map(k => k.low));

          // -------------------------------------------------------------
          // NOVEL NON-HUMAN AI STRATEGY GENESIS CHECK
          // Checks if an evolved, multi-dimensional quantitative formula
          // with non-linear polynomial operators triggers on this candle
          // -------------------------------------------------------------
          const promotedGenes = db.getPaperTradingStrategies().sort((a, b) =>
            Number(b.status === 'PROMOTED_ACTIVE') - Number(a.status === 'PROMOTED_ACTIVE')
          );
          let novelGeneCandidate: {
            gene: typeof promotedGenes[0];
            direction: 'BUY' | 'SELL';
            conviction: number;
            rationale: string;
          } | null = null;

          for (const gene of promotedGenes) {
            // Forward verification must use the same pair whose historical data
            // established the candidate's edge; never cross-apply a single-pair model.
            if (gene.symbol && gene.symbol !== symbol) continue;
            if (gene.sessionAffinity !== 'ALL' && gene.sessionAffinity !== activeSession.id) {
              continue;
            }
            const evalResult = researchEngine.evaluateSynthesizedGeneSignal(
              gene,
              c,
              prev,
              closes,
              ema9,
              ema21,
              rsi14
            );
            if (evalResult.shouldTrigger && evalResult.conviction >= 0.80) {
              novelGeneCandidate = {
                gene,
                direction: evalResult.direction,
                conviction: evalResult.conviction,
                rationale: evalResult.rationale,
              };
              break;
            }
          }

          if (novelGeneCandidate) {
            const gene = novelGeneCandidate.gene;
            const agiState = agiSelfLearningEngine.getSelfLearningState();
            const arm = agiState.banditArms[gene.id];

            // A. Bandit Arm Throttle Gate (Auto-pause strategies whose trailing posterior EV is negative)
            if (arm && arm.status === 'THROTTLED') {
              this.logMind(
                'AUDITOR',
                `🛑 [MAB BANDIT THROTTLE]: Strategy ${gene.name} temporarily throttled (trailing posterior win rate: ${arm.currentWinRate}% < 55.6% break-even floor). Setup bypassed.`,
                symbol
              );
              continue;
            }

            // B. Market Regime Gate (Hurst exponent & entropy)
            const regime = agiSelfLearningEngine.classifyMarketRegime(symbol, candles);
            if (regime.regimeType === 'RANDOM_WALK_CHOP' && novelGeneCandidate.conviction < 0.88) {
              this.logMind(
                'AUDITOR',
                `🛑 [REGIME GATE STAND-DOWN]: ${symbol} is in high-entropy Random Walk Chop (Hurst: ${regime.hurstExponent}, Entropy: ${regime.shannonEntropy}). Conviction ${novelGeneCandidate.conviction} < 0.88 required for chop. Setup bypassed.`,
                symbol
              );
              continue;
            }

            // C. Online Neural Network Forward Pass & k-NN Manifold Veto Gate
            const featureVec = agiSelfLearningEngine.extractFeatureVector(c, candles);
            const netEval = onlinePolicyNetwork.forward(featureVec);
            const knn = onlinePolicyNetwork.queryEpisodicKNN(featureVec, symbol, novelGeneCandidate.direction);
            if (knn.shouldVeto) {
              this.logMind(
                'AUDITOR',
                `[KNN_VETO]: ${knn.explanation}`,
                symbol
              );
              continue;
            }

            // D. Antidote Immune Resistance Adjustment
            const immuneCheck = agiSelfLearningEngine.evaluateAntidoteImmuneResistance(symbol, novelGeneCandidate.direction, c);
            let finalConviction = Number(((novelGeneCandidate.conviction * 0.6) + (netEval.conviction * 0.4)).toFixed(2));
            if (immuneCheck.resistanceApplied) {
              finalConviction = Number(Math.max(0.50, finalConviction - immuneCheck.dampingPenalty).toFixed(2));
              this.logMind(
                'SCIENTIST',
                `🛡️ [IMMUNE RESISTANCE]: Applied antidote damping (-${immuneCheck.dampingPenalty}) against active loss pattern "${immuneCheck.antidoteName}". Adjusted conviction: ${finalConviction}.`,
                symbol
              );
              if (finalConviction < 0.72) {
                continue; // Suppressed below actionable threshold
              }
            }

            const signal = entryExitEngine.createResearchSignal({
              symbol,
              direction: novelGeneCandidate.direction,
              signalCandle: c,
              ruleFamily: 'volatility_squeeze',
              expiryMinutes: gene.optimalHorizonMinutes,
              confidence: finalConviction,
              modelVersion: `OnlinePolicy-MLP19-16-1+LinUCB`,
              strategyName: gene.name,
              strategyId: gene.id,
              strategyWinRate: gene.verifiedAccuracy,
              strategyHistoricalSampleSize: gene.sampleCount,
              strategyEvidenceStatus: gene.accuracyStatus,
              confluenceStrategies: [gene.name, ...gene.parents, `${gene.nonLinearOperator} Activation`],
              confluenceScore: gene.parents.length + 1,
              isStackedStrategy: true,
              isNovelAiSynthesized: true,
              synthesizedGeneId: gene.id,
              mathematicalFormula: gene.mathematicalFormula,
              whyHumansMissThis: gene.whyHumansMissThis,
              paperOnly: gene.status !== 'PROMOTED_ACTIVE',
              notes: gene.status !== 'PROMOTED_ACTIVE'
                ? `[PAPER ONLY — NOT APPROVED FOR ACTIONABLE TRADING] Forward validation sample. ${gene.mathematicalFormula}`
                : `[APPROVED AFTER 300 HISTORICAL + 300 FORWARD OUTCOMES]: ${gene.mathematicalFormula} | Edge: ${gene.whyHumansMissThis}`,
            });

            createdSignals.push(signal);
            this.recordBehavioralValidation(signal, candles);
            inFlightSymbols.add(symbol);

            // Dispatch instant signal notification to Telegram subscribers (awaited before pulse returns)
            pendingTelegramDispatches.push(
              telegramService.sendSignalAlert(signal).catch(err => {
                console.error('[Scheduler] Telegram novel signal dispatch error:', err.message);
              })
            );

            this.logMind(
              'SCIENTIST',
              `🧬 [NOVEL AI STRATEGY TRIGGERED]: ${symbol} ${signal.direction} [${gene.name} · Dynamic Expiry: ${gene.optimalHorizonMinutes}m · Formula: ${gene.mathematicalFormula} · ${gene.verifiedAccuracy}% historical test WR (n=${gene.sampleCount}). ${gene.status === 'PAPER_TRADING' ? 'PAPER TRADING' : 'FORWARD APPROVED'}. Enters strictly at 5M Candle Open (${signal.candleOpenTimeIst}).`,
              symbol,
              signal.id
            );
            break; // Single high-conviction signal per pulse
          }

          // -------------------------------------------------------------
          // Multi-Strategy Stacking: Detect Bullish vs Bearish Confluence
          // Stack technical confluences to form a research signal. Historical and live
          // outcome performance are measured separately; confluence count is not a win rate.
          // -------------------------------------------------------------
          const buyConfluences: string[] = [];
          const sellConfluences: string[] = [];

          // 1. Momentum / EMA Alignment
          if (lastEma9 > lastEma21 && (c.close > c.open || lastEma9 - lastEma21 > prevEma9 - prevEma21)) {
            buyConfluences.push('EMA 9/21 Trend Breakout');
          }
          if (lastEma9 < lastEma21 && (c.close < c.open || lastEma21 - lastEma9 > prevEma21 - prevEma9)) {
            sellConfluences.push('EMA 9/21 Trend Breakdown');
          }

          // 2. Liquidity Wick Rejection
          if (lowerWick / range > 0.42) {
            buyConfluences.push(`Liquidity Wick Sweep (${((lowerWick / range) * 100).toFixed(0)}%)`);
          }
          if (upperWick / range > 0.42) {
            sellConfluences.push(`Liquidity Wick Sweep (${((upperWick / range) * 100).toFixed(0)}%)`);
          }

          // 3. Statistical Mean Reversion
          if (deviationPips < -5.5) {
            buyConfluences.push(`Mean Reversion (-${Math.abs(deviationPips).toFixed(1)} Pips)`);
          }
          if (deviationPips > 5.5) {
            sellConfluences.push(`Mean Reversion (+${deviationPips.toFixed(1)} Pips)`);
          }

          // 4. RSI Extremes
          if (lastRsi < 36) {
            buyConfluences.push(`RSI Oversold (${lastRsi})`);
          }
          if (lastRsi > 64) {
            sellConfluences.push(`RSI Overbought (${lastRsi})`);
          }

          // 5. Volatility Breakout
          if (c.close >= high20 || (bodyRatio > 0.60 && c.close > c.open)) {
            buyConfluences.push('20-Bar High Expansion');
          }
          if (c.close <= low20 || (bodyRatio > 0.60 && c.close < c.open)) {
            sellConfluences.push('20-Bar Low Expansion');
          }

          // 6. Session Alignment
          if (activeSession.id === 'OVERLAP' || activeSession.id === 'LONDON') {
            if (buyConfluences.length >= 1) buyConfluences.push(`${activeSession.shortName} Volume Flow`);
            if (sellConfluences.length >= 1) sellConfluences.push(`${activeSession.shortName} Volume Flow`);
          }

          // Select candidate setup ONLY IF Confluence Score >= 2 (Strict Stacking Requirement)
          let candidate: {
            direction: 'BUY' | 'SELL';
            confluence: string[];
            confluenceScore: number;
          } | null = null;

          if (buyConfluences.length >= 2 && buyConfluences.length > sellConfluences.length) {
            candidate = {
              direction: 'BUY',
              confluence: buyConfluences,
              confluenceScore: buyConfluences.length,
            };
          } else if (sellConfluences.length >= 2 && sellConfluences.length > buyConfluences.length) {
            candidate = {
              direction: 'SELL',
              confluence: sellConfluences,
              confluenceScore: sellConfluences.length,
            };
          }

          if (candidate) {
            // Dynamically assign optimal expiry across 5m, 10m, 15m, 20m, 25m, 30m
            let dynamicExpiry: 5 | 10 | 15 | 20 | 25 | 30 = 15;
            let ruleFamily = 'mean_reversion_20';
            let strategyName = '';

            const hasMomentum = candidate.confluence.some(item => item.includes('Trend') || item.includes('Expansion'));
            const hasWick = candidate.confluence.some(item => item.includes('Wick'));
            const hasMeanRev = candidate.confluence.some(item => item.includes('Mean Reversion'));
            const hasRsi = candidate.confluence.some(item => item.includes('RSI'));

            if (hasMomentum && !hasMeanRev && bodyRatio > 0.60) {
              // 5 Min: High-velocity momentum surge (Single candle expansion)
              dynamicExpiry = 5;
              ruleFamily = 'momentum_5';
              strategyName = `Stacked: 5-Min Momentum + ${hasWick ? 'Wick Rejection' : 'Volume Expansion'}`;
            } else if (hasWick && (hasMomentum || hasRsi)) {
              // 10 Min: Liquidity Wick Sweep + 2-Candle Retest
              dynamicExpiry = 10;
              ruleFamily = 'wick_reversal';
              strategyName = `Stacked: 10-Min Liquidity Wick + ${hasRsi ? 'RSI Reversal' : 'Trend Retest'}`;
            } else if (hasMeanRev && hasRsi) {
              // 15 Min: Statistical Mean Reversion + RSI Extreme Pullback
              dynamicExpiry = 15;
              ruleFamily = 'mean_reversion_20';
              strategyName = 'Stacked: 15-Min Mean Reversion + RSI Divergence';
            } else if (hasMomentum && candidate.confluence.some(item => item.includes('20-Bar'))) {
              // 20 Min: Volatility Range Breakout (4-candle expansion)
              dynamicExpiry = 20;
              ruleFamily = 'range_breakout';
              strategyName = 'Stacked: 20-Min Volatility Range Breakout';
            } else if (hasMeanRev && hasWick) {
              // 25 Min: Structural Swing Reversal (5-candle channel bounce)
              dynamicExpiry = 25;
              ruleFamily = 'volatility_squeeze';
              strategyName = 'Stacked: 25-Min Structural Swing Reversal';
            } else {
              // 30 Min: Macro Session Trend Continuation (6-candle session flow)
              dynamicExpiry = 30;
              ruleFamily = 'order_flow_imbalance';
              strategyName = `Stacked: 30-Min ${activeSession.shortName} Macro Trend Flow`;
            }

            const strategyId = `stacked:${ruleFamily}:${dynamicExpiry}`;

            // =========================================================================
            // LIVE ADAPTIVE ML GATE STACK (Closed-Loop Learning Applied Pre-Execution)
            // =========================================================================
            if (!this.hasBootstrappedOnlineModel) {
              this.syncOnlineLearningWithLedger(candlesMap);
            }

            // GATE 1: Thompson Sampling Bandit / Empirical Break-Even Throttle (<55.6% WR @ n>=8)
            const throttleCheck = agiSelfLearningEngine.isStrategyThrottled(strategyId);
            if (throttleCheck.throttled) {
              this.logMind(
                'AUDITOR',
                `[ADAPTIVE BANDIT THROTTLE] Blocked ${symbol} ${candidate.direction} (${strategyId}): ${throttleCheck.reason}`,
                symbol
              );
              continue;
            }

            // GATE 2: Hurst Exponent & Shannon Entropy Regime Chop Filter
            const regime = agiSelfLearningEngine.classifyMarketRegime(symbol, candles);
            if (regime.regimeType === 'RANDOM_WALK_CHOP' && candidate.confluenceScore < 3) {
              this.logMind(
                'AUDITOR',
                `[REGIME CHOP GATE] Blocked low-confluence ${symbol} ${candidate.direction} (${candidate.confluenceScore} signals) during RANDOM_WALK_CHOP (H=${regime.hurstExponent}, Entropy=${regime.shannonEntropy}).`,
                symbol
              );
              continue;
            }

            // GATE 3: 19D Feature Extraction + Dual Episodic k-NN Loss Veto
            const featureVec = agiSelfLearningEngine.extractFeatureVector(c, candles);
            const agiKnn = agiSelfLearningEngine.evaluateEpisodicVeto(symbol, candidate.direction, featureVec);
            const policyKnn = onlinePolicyNetwork.queryEpisodicKNN(featureVec, symbol, candidate.direction);
            if (agiKnn.shouldVeto || policyKnn.shouldVeto) {
              this.logMind(
                'AUDITOR',
                `[EPISODIC k-NN VETO] Blocked ${symbol} ${candidate.direction}: ${agiKnn.shouldVeto ? agiKnn.reason : policyKnn.explanation}`,
                symbol
              );
              continue;
            }

            // GATE 4: Online Neural Policy (19-16-1 MLP + LinUCB) Directional Alignment
            const netEval = onlinePolicyNetwork.forward(featureVec);
            const policyTelemetry = onlinePolicyNetwork.getTelemetry();
            const mlpDirProb = candidate.direction === 'BUY' ? netEval.probabilityUp : 1.0 - netEval.probabilityUp;

            if (policyTelemetry.stepCount >= 10 && mlpDirProb < 0.35) {
              this.logMind(
                'AUDITOR',
                `[NEURAL POLICY VETO] Blocked ${symbol} ${candidate.direction}: Trained MLP (step=${policyTelemetry.stepCount}) assigns only ${(mlpDirProb * 100).toFixed(1)}% probability to ${candidate.direction} (LinUCB=${netEval.linUcbScore}).`,
                symbol
              );
              continue;
            }

            // Base structural score adjusted by centered online MLP directional edge (relative to 0.50 neutral)
            // Positive MLP agreement (>50%) boosts conviction; disagreement (<50%) penalizes it without pulling valid trades below floor.
            const baseScore = Math.min(0.92, 0.77 + (candidate.confluenceScore - 2) * 0.05);
            const mlpScale = policyTelemetry.stepCount >= 10
              ? Math.min(0.28, 0.16 + (policyTelemetry.stepCount - 10) * 0.003)
              : 0;
            const mlpDelta = (mlpDirProb - 0.50) * mlpScale;
            let adaptedConfidence = baseScore + mlpDelta;

            // GATE 5: Active Forensic Loss Autopsy Immune Damping + PID Adaptive Threshold
            const immune = agiSelfLearningEngine.evaluateAntidoteImmuneResistance(symbol, candidate.direction, c);
            if (immune.resistanceApplied) {
              // Apply focused penalty when a recent (<6h) loss autopsy occurred on this exact pair + direction
              adaptedConfidence -= immune.dampingPenalty * 0.45;
            }

            const agiState = agiSelfLearningEngine.getSelfLearningState();
            const pidMinFloor = Number(
              Math.max(0.70, Math.min(0.775, 0.72 + agiState.adaptiveThresholdDelta * 0.35)).toFixed(3)
            );
            adaptedConfidence = Number(Math.max(0.50, Math.min(0.95, adaptedConfidence)).toFixed(2));

            if (adaptedConfidence < pidMinFloor) {
              this.logMind(
                'AUDITOR',
                `[PID + IMMUNE GATE] Blocked ${symbol} ${candidate.direction} (${strategyId}): Adapted conviction ${(adaptedConfidence * 100).toFixed(1)}% < PID floor ${(pidMinFloor * 100).toFixed(1)}% (delta=${agiState.adaptiveThresholdDelta >= 0 ? '+' : ''}${agiState.adaptiveThresholdDelta}${immune.resistanceApplied ? `, Immune: ${immune.antidoteName}` : ''}).`,
                symbol
              );
              continue;
            }

            // GATE 6: Pre-Execution Behavioural Trap Filter (Promoted from shadow-only)
            const botHealth = db.getBotHealthState() || botAuditor.auditBotHealth(db.getSignals(), db.getLossAutopsies());
            db.saveBotHealthState(botHealth);
            const preCheckSignal: any = {
              id: `precheck_${Date.now()}`,
              symbol,
              direction: candidate.direction,
              confidence: adaptedConfidence,
              strategyId,
              ruleFamily,
              predictionTimeIst: new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata' }),
            };
            const preBehavioral = behaviouralEngine.validateSignal(preCheckSignal, candles, botHealth);
            const severeTrapCatalysts = preBehavioral.activeHypotheses.filter(
              h =>
                h.isActive &&
                ['LIQUIDITY_SWEEP_CLUSTERS', 'FAILED_BREAKOUT_TRAP', 'FOMO_LATE_ENTRY', 'FEAR_PANIC'].includes(h.type)
            );
            if (
              preBehavioral.recommendation === 'REJECT_INSUFFICIENT_EVIDENCE' &&
              severeTrapCatalysts.length > 0
            ) {
              this.logMind(
                'AUDITOR',
                `[BEHAVIOURAL TRAP VETO] Blocked ${symbol} ${candidate.direction}: ${severeTrapCatalysts.map(h => h.type).join(', ')} (${preBehavioral.decisionRationale})`,
                symbol
              );
              continue;
            }

            const signal = entryExitEngine.createResearchSignal({
              symbol,
              direction: candidate.direction,
              signalCandle: c,
              ruleFamily,
              expiryMinutes: dynamicExpiry,
              confidence: adaptedConfidence,
              modelVersion: `v3.0-adaptive-online-ml`,
              strategyName,
              strategyId,
              confluenceStrategies: candidate.confluence,
              confluenceScore: candidate.confluenceScore,
              isStackedStrategy: true,
              paperOnly: true,
              notes: `[ADAPTIVE ONLINE ML · PAPER] Confluence: [${candidate.confluence.join(' · ')}] | Regime: ${regime.regimeType} (H=${regime.hurstExponent}) | MLP(${policyTelemetry.stepCount} steps): ${(mlpDirProb * 100).toFixed(1)}% | PID Floor: ${(pidMinFloor * 100).toFixed(1)}%${immune.resistanceApplied ? ` | Immune Damped (${immune.antidoteName})` : ''}. Enters strictly on 5M open (${activeSession.name}).`,
            });

            createdSignals.push(signal);
            this.recordBehavioralValidation(signal, candles);
            inFlightSymbols.add(symbol);

            // Dispatch instant signal notification to Telegram subscribers (awaited before pulse returns)
            pendingTelegramDispatches.push(
              telegramService.sendSignalAlert(signal).catch(err => {
                console.error('[Scheduler] Telegram stacked signal dispatch error:', err.message);
              })
            );

            this.logMind(
              'SCIENTIST',
              `3-Min Advance Adaptive ML Signal: ${symbol} ${candidate.direction} [${strategyName} · Expiry: ${dynamicExpiry}m · Adapted Conf: ${(adaptedConfidence * 100).toFixed(0)}% vs PID Floor ${(pidMinFloor * 100).toFixed(0)}% · MLP ${(mlpDirProb * 100).toFixed(0)}% @ ${policyTelemetry.stepCount} steps · Regime: ${regime.regimeType}]. Enters at 5M Open (${signal.candleOpenTimeIst}).`,
              symbol,
              signal.id
            );
            break; // Single high-conviction setup per pulse to prevent burst clutter
          }
        }
      }

      if (shouldScanForSignals && createdSignals.length === 0) {
        const freshPairs = FOREX_PAIRS.filter(pair => (candlesMap[pair]?.length || 0) >= 35).length;
        this.logMind(
          'AUDITOR',
          `[SIGNAL DISCOVERY EMPTY] Fresh real-feed pairs with 35+ M1 candles: ${freshPairs}/${FOREX_PAIRS.length}; pending pairs: ${inFlightSymbols.size}; in-flight slots: ${inFlightTrades.length}/6. No setup passed the existing confluence/adaptive filters.`
        );
      }

      // 4. Autonomous ML Walk-Forward Experimentation (every 3rd pulse)
      const experimentsRun: ResearchExperiment[] = [];
      let topExp: ResearchExperiment | null = null;

      if (this.cycleCount % 3 === 0) {
        const testPair: ForexSymbol =
          FOREX_PAIRS[this.cycleCount % FOREX_PAIRS.length];
        const testCandles = historicalDataStore.getCandles(testPair);

        if (testCandles.length >= 10_000 && testCandles.every(c => c.source !== 'synthetic')) {
          const rule: RuleFamily =
            this.cycleCount % 2 === 0 ? 'momentum_5' : 'mean_reversion_20';
          const horizon = (5 * ((this.cycleCount % 5) + 1));

          try {
            const exp = researchEngine.runWalkForwardExperiment(
              testPair,
              testCandles,
              rule,
              horizon,
              this.currentGeneration
            );
            await researchEngine.generateTrinityReviews(exp);
            experimentsRun.push(exp);
            topExp = exp;

            this.logMind(
              'AUDITOR',
              `Audited ${testPair} [${rule}] ${horizon}m walk-forward model. Test Acc: ${(
                exp.metrics.testAccuracy * 100
              ).toFixed(1)}%, Brier: ${exp.metrics.brierScore}, Verdict: ${exp.auditorVerdict}.`,
              testPair
            );
          } catch (e: any) {
            // Quiet skip
          }
        }
      }

      // Symbolic candidates are generated only through the dedicated 300-candidate
      // historical search API. Do not create random unvalidated genes every live pulse
      // or repeatedly backtest one candidate against the same imported dataset.

      // 5. Generational Evolution Synthesis (every 10 pulses)
      if (this.cycleCount % 10 === 0 && experimentsRun.length > 0) {
        const allExps = db.getExperiments().filter(e => e.experimentType !== 'LIVE_TRADE' && e.experimentType !== 'FORWARD_OBSERVATION').slice(0, 10);
        const accepted = allExps.filter(e => e.auditorVerdict === 'ACCEPTED').length;
        const rejected = allExps.filter(e => e.auditorVerdict === 'REJECTED').length;
        const bestF1 = allExps.length > 0
          ? Math.max(...allExps.map(e => e.metrics.f1Score))
          : 0;
        const latestExperiment = allExps[0] || null;

        const gen: EvolutionGeneration = {
          generation: this.currentGeneration,
          timestamp: new Date().toISOString(),
          totalExperiments: allExps.length,
          acceptedCount: accepted,
          rejectedCount: rejected,
          topExperimentId: latestExperiment?.id || null,
          bestF1Score: bestF1,
          summary: allExps.length > 0
            ? `Generation ${this.currentGeneration}: ${allExps.length} historical experiments reviewed; ${accepted} accepted, ${rejected} rejected. Best recorded F1: ${bestF1.toFixed(3)}.`
            : `Generation ${this.currentGeneration}: no eligible historical experiments were available; no performance conclusion recorded.`,
          lessonsLearned: latestExperiment
            ? [
                `Latest run: ${latestExperiment.symbol} ${latestExperiment.ruleFamily}, ${latestExperiment.horizonMinutes}m; test sample n=${latestExperiment.metrics.sampleSize}.`,
                `Out-of-sample EV ${latestExperiment.metrics.expectedValuePips.toFixed(2)} pips; PF ${latestExperiment.metrics.profitFactor.toFixed(2)} after modeled spread.`,
              ]
            : ['No empirical lesson recorded because no qualifying historical experiment was available.'],
        };
        db.addGeneration(gen);
        this.currentGeneration++;
        this.logMind(
          'MIND',
          `Autonomous research generation #${gen.generation} evolved. Best F1: ${bestF1.toFixed(3)}.`
        );
      }

      // Ensure all Telegram dispatches finish BEFORE returning (critical for serverless Cloud Run cron ticks)
      if (pendingTelegramDispatches.length > 0) {
        await Promise.allSettled(pendingTelegramDispatches);
      }

      const durationMs = Date.now() - startTime;
      db.logCronRun(
        durationMs,
        'SUCCESS',
        `Autopilot pulse #${this.cycleCount} (${triggerSource}) executed in ${durationMs}ms. ${createdSignals.length} signals generated, ${updatedSignals.length} active updated.`
      );

      // Flush database asynchronously whenever state changed or driven by an external serverless cron tick
      if (
        createdSignals.length > 0 ||
        updatedSignals.length > 0 ||
        triggerSource === 'EXTERNAL_24_5_CRON' ||
        triggerSource === 'SERVICE_WORKER_BACKGROUND_PULSE'
      ) {
        await db.flushAsync();
      }

      return {
        durationMs,
        pairsProcessed: Object.keys(candlesMap).length,
        signalsCreated: createdSignals.length,
        signalsUpdated: updatedSignals.length,
        experimentsRun: experimentsRun.length,
        topExperiment: topExp,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      db.logCronRun(durationMs, 'ERROR', `Autopilot pulse error: ${err.message}`);
      await db.flushAsync();
      return {
        durationMs,
        pairsProcessed: 0,
        signalsCreated: 0,
        signalsUpdated: 0,
        experimentsRun: 0,
        topExperiment: null,
      };
    } finally {
      this.isRunningCycle = false;
    }
  }

  // Alias for manual triggers to maintain backwards compatibility
  public executeFullResearchCycle(triggerSource: string = 'MANUAL') {
    return this.executeAutopilotPulse(triggerSource);
  }
}

export const autonomousScheduler = new AutonomousScheduler();
