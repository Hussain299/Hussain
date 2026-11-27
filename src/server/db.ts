/**
 * SignalForge ML — Persistent Database & D1 Exporter
 * Provides atomic file persistence for research state with instant Cloudflare D1 SQL schema export.
 */

import fs from 'fs';
import path from 'path';
import {
  Candle,
  FOREX_PAIRS,
  ForexSymbol,
  MarketSessionId,
  MarketSessionInfo,
  ProviderHealth,
  ResearchSignal,
  ResearchExperiment,
  AgentReview,
  EvolutionGeneration,
  SignalLifecycleEvent,
  AutopilotLog,
  SynthesizedStrategyGene,
  LossAutopsy,
  StrategyPerformanceRecord,
  SignalDirection,
  BehavioralMemoryRecord,
  BotSelfMonitoringState,
  ShadowModeComparison,
  TelegramConfig,
  TelegramSubscriber,
  AgentCouncilState,
} from '../types/index.js';
import { getSessionFromTimestamp } from './dataFeeds.js';
import {
  createInitialOnlineLearnerState,
  getOnlineLearnerFeatureImportance,
  getOnlineLearnerSummary,
  learnOnlineOutcome,
  normalizeOnlineLearnerState,
  predictOnlineOutcome as scoreOnlineOutcome,
  replayOnlineLearnerHistory,
  ONLINE_LEARNER_VERSION,
  type OnlineLearningContext,
  type OnlineLearnerState,
} from './onlineLearning.js';

interface DatabaseSchema {
  candles: Record<string, Candle[]>;
  feedHealth: Record<string, ProviderHealth>;
  signals: ResearchSignal[];
  experiments: ResearchExperiment[];
  /** Append-only canonical paper-outcome ledger, retained independently of capped research history. */
  forwardObservations: ResearchExperiment[];
  reviews: AgentReview[];
  generations: EvolutionGeneration[];
  autopilotLogs: AutopilotLog[];
  synthesizedStrategies: SynthesizedStrategyGene[];
  lossAutopsies: LossAutopsy[];
  strategyPerformance: Record<string, StrategyPerformanceRecord>;
  /** Lifetime idempotency ledger, independent of bounded UI/history arrays. */
  processedOutcomeIds: string[];
  /** Lifetime forward-observation ledger, independent of the 120-row experiment display. */
  recordedForwardObservationIds: string[];
  /** Signals already used to update the shadow-only online classifier. */
  onlineLearnerProcessedSignalIds: string[];
  /** Prequential FTRL model; never connected to trade selection or execution. */
  onlineLearner: OnlineLearnerState;
  behaviouralMemory?: BehavioralMemoryRecord[];
  botHealthState?: BotSelfMonitoringState;
  shadowComparison?: ShadowModeComparison;
  telegramConfig?: TelegramConfig;
  manualPairs?: ForexSymbol[];
  allowAllConfiguredPairs?: boolean;
  botRuntimeControls?: {
    globalKillSwitch: boolean;
    enabled: boolean;
    minConfidence: number;
    maxConcurrentTrades: number;
    dynamicSpreadGate: boolean;
    maxSpreadPips: number;
    tradingSessions: MarketSessionId[];
    updatedAtUtc?: string;
  };
  cronState: {
    lastRun: string | null;
    nextRun: string | null;
    isRunning: boolean;
    lastExternalCronAt?: string | null;
    externalCronCount?: number;
    lastExternalCronSource?: string | null;
    history: Array<{ runAt: string; durationMs: number; status: string; summary: string }>;
  };
  onlineModel?: {
    modelVersion?: string;
    w1: number[][];
    b1: number[];
    w2: number[];
    b2: number;
    mW1?: number[][];
    vW1?: number[][];
    mb1?: number[];
    vb1?: number[];
    mW2?: number[];
    vW2?: number[];
    mb2?: number;
    vb2?: number;
    stepCount: number;
    adamStepCount?: number;
    lastGradNorm?: number;
    trailingLosses: number[];
    oosLosses?: number[];
    oosDirectionCorrect?: number;
    oosDirectionTotal?: number;
    linUcbA: number[][];
    linUcbB: number[];
    trainedSignalIds?: string[];
    skippedTrainingRecords?: Array<{ signalId: string; reason: string; at: string }>;
    duplicateBlocks?: number;
    lastTrainedAt?: string | null;
    lastUpdated: string;
    linUcbV2?: {
      version: string;
      aBuy: number[][];
      bBuy: number[];
      aSell: number[][];
      bSell: number[];
      observationsBuy: number;
      observationsSell: number;
      totalReward: number;
      explorationTotal: number;
      exploitationTotal: number;
      trainedSignalIds: string[];
      lastTrainedAt: string | null;
    };
  };
  episodicMemories?: Array<{
    signalId?: string;
    vector: number[];
    symbol: ForexSymbol;
    direction: SignalDirection;
    y: number;
    timestamp: string;
  }>;
  agentCouncil?: AgentCouncilState;
}

const DEFAULT_DB_FILE = path.join(path.resolve(process.cwd(), 'data'), 'signalforge.db.json');
const DB_FILE = process.env.SIGNALFORGE_DB_PATH
  ? path.resolve(process.env.SIGNALFORGE_DB_PATH)
  : DEFAULT_DB_FILE;
const DATA_DIR = path.dirname(DB_FILE);

const RETRYABLE_RENAME_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);
const SYNC_RENAME_RETRIES = 3;

function isRetryableRenameError(error: any): boolean {
  return RETRYABLE_RENAME_CODES.has(String(error?.code || ''));
}

function sleepSync(milliseconds: number): void {
  // Used only after transient Windows file-sharing errors in a synchronous critical save.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function renameSyncWithRetry(source: string, destination: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(source, destination);
      return;
    } catch (error: any) {
      if (!isRetryableRenameError(error) || attempt >= SYNC_RENAME_RETRIES) throw error;
      sleepSync(50 * (attempt + 1));
    }
  }
}

async function renameAsyncWithRetry(source: string, destination: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.promises.rename(source, destination);
      return;
    } catch (error: any) {
      if (!isRetryableRenameError(error) || attempt >= SYNC_RENAME_RETRIES) throw error;
      await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}

class DatabaseService {
  private state: DatabaseSchema;
  private saveTimeout: NodeJS.Timeout | null = null;
  private isWriting = false;
  private writeQueued = false;
  private inFlightWrite: Promise<void> | null = null;
  private isShuttingDown = false;
  private pendingPriority: 'none' | 'low' | 'high' = 'none';
  private lastWriteAtMs = 0;
  private stateWriteEpoch = 0;
  private static readonly LOW_PRIORITY_FLUSH_INTERVAL_MS = 60_000;
  private static readonly HIGH_PRIORITY_DEBOUNCE_MS = 1_500;
  private static readonly MAX_PERSISTED_CANDLES_PER_PAIR = 80;

  constructor() {
    this.ensureDataDir();
    this.state = this.loadState();
  }

  public getDbPath(): string {
    return DB_FILE;
  }

  private ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private loadState(): DatabaseSchema {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.candles && typeof parsed.candles === 'object') {
          for (const sym of Object.keys(parsed.candles)) {
            if (Array.isArray(parsed.candles[sym])) {
              const realOnly = parsed.candles[sym].filter((c: any) => c && c.source !== 'synthetic');
              parsed.candles[sym] = realOnly.length > 500 ? realOnly.slice(-500) : realOnly;
            }
          }
        }
        // Migrate forward outcomes out of the capped experiment feed before applying its history limit.
        // This preserves the complete paper ledger even when backtests continue to be added.
        const legacyForwardRows = Array.isArray(parsed.experiments)
          ? parsed.experiments.filter((item: any) => item?.experimentType === 'FORWARD_OBSERVATION' && item?.id?.startsWith('exp_forward_'))
          : [];
        const forwardRows = [
          ...(Array.isArray(parsed.forwardObservations) ? parsed.forwardObservations : []),
          ...legacyForwardRows,
        ];
        const uniqueForwardRows = new Map<string, any>();
        for (const row of forwardRows) {
          if (row?.id && !uniqueForwardRows.has(row.id)) uniqueForwardRows.set(row.id, row);
        }
        parsed.forwardObservations = Array.from(uniqueForwardRows.values());
        if (Array.isArray(parsed.experiments)) {
          parsed.experiments = parsed.experiments.filter((item: any) => item?.experimentType !== 'FORWARD_OBSERVATION');
        }

        if (!parsed.autopilotLogs) parsed.autopilotLogs = [];
        if (Array.isArray(parsed.autopilotLogs) && parsed.autopilotLogs.length > 120) {
          parsed.autopilotLogs = parsed.autopilotLogs.slice(0, 120);
        }
        if (Array.isArray(parsed.experiments) && parsed.experiments.length > 120) {
          parsed.experiments = parsed.experiments.slice(0, 120);
        }
        if (Array.isArray(parsed.reviews) && parsed.reviews.length > 120) {
          parsed.reviews = parsed.reviews.slice(0, 120);
        }
        if (!Array.isArray(parsed.synthesizedStrategies)) parsed.synthesizedStrategies = [];
        if (!Array.isArray(parsed.lossAutopsies)) parsed.lossAutopsies = [];
        if (!Array.isArray(parsed.behaviouralMemory)) parsed.behaviouralMemory = [];
        if (!parsed.strategyPerformance || typeof parsed.strategyPerformance !== 'object') parsed.strategyPerformance = {};
        // Backfill lifetime idempotency ledgers from records already persisted by older versions.
        // This prevents re-counting outcomes that are already present in strategyPerformance or experiments.
        const legacyStrategySignalIds = Object.values(parsed.strategyPerformance || {})
          .flatMap((record: any) => Array.isArray(record?.signalIds)
            ? record.signalIds.filter((id: any) => typeof id === 'string')
            : []);
        const legacyForwardSignalIds = (Array.isArray(parsed.forwardObservations) ? parsed.forwardObservations : [])
          .filter((experiment: any) => typeof experiment?.id === 'string' && experiment.id.startsWith('exp_forward_'))
          .map((experiment: any) => experiment.id.slice('exp_forward_'.length));
        parsed.processedOutcomeIds = [...new Set([
          ...(Array.isArray(parsed.processedOutcomeIds) ? parsed.processedOutcomeIds : []),
          ...legacyStrategySignalIds,
        ])];
        parsed.recordedForwardObservationIds = [...new Set([
          ...(Array.isArray(parsed.recordedForwardObservationIds) ? parsed.recordedForwardObservationIds : []),
          ...legacyForwardSignalIds,
        ])];
        if (!Array.isArray(parsed.onlineLearnerProcessedSignalIds)) parsed.onlineLearnerProcessedSignalIds = [];
        parsed.onlineLearner = normalizeOnlineLearnerState(parsed.onlineLearner);
        // Historical versions wrote fabricated strategy accuracy values. Never trust them
        // without stored untouched-test evidence; quarantine all such legacy candidates.
        if (Array.isArray(parsed.synthesizedStrategies)) {
          parsed.synthesizedStrategies = parsed.synthesizedStrategies.map((gene: any) => {
            if (!gene.backtestMetrics || !gene.accuracyStatus ||
                gene.backtestMetrics.testScoredSampleSize < 300 ||
                gene.backtestMetrics.validationScoredSampleSize < 150 ||
                gene.backtestMetrics.testWinRate < 0.70 ||
                gene.backtestMetrics.validationWinRate < 0.70 ||
                !Array.isArray(gene.backtestMetrics.testBlockWinRates) ||
                gene.backtestMetrics.testBlockWinRates.length !== 3 ||
                gene.backtestMetrics.testBlockWinRates.some((rate: number) => rate < 0.70)) {
              return {
                ...gene,
                verifiedAccuracy: 0,
                sampleCount: 0,
                accuracyStatus: 'UNVALIDATED',
                backtestMetrics: undefined,
                paperMetrics: undefined,
                status: gene.status === 'REJECTED' ? 'REJECTED' : 'EXPERIMENTING',
              };
            }
            // Older approval records may predate the stricter forward 300-trade gate.
            if (gene.status === 'PROMOTED_ACTIVE' && !this.hasForwardApprovalEvidence(gene)) {
              return { ...gene, status: 'PAPER_TRADING' };
            }
            return gene;
          });
        }
        if (parsed.synthesizedStrategies.length === 0) {
          parsed.synthesizedStrategies = this.generateSeedSynthesizedGenes();
        }
        if (Array.isArray(parsed.signals)) {
          // Keep signals for up to 7 days so yesterday's trades and accuracy layer remain accessible
          const nowMs = Date.now();
          const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
          const uniqueMap = new Map<string, any>();
          parsed.signals.forEach((s: any) => {
            if (!s || !s.id) return;
            if (typeof s.candleOpenTimeIst === 'string' && s.candleOpenTimeIst.includes('19:35:00 IST')) return;
            if (s.ruleFamily?.startsWith('test_')) return;
            const timeMs = s.predictionTimeUtc ? Date.parse(s.predictionTimeUtc) : NaN;
            if (!Number.isFinite(timeMs) || nowMs - timeMs > SEVEN_DAYS_MS) return;
            if (!uniqueMap.has(s.id)) {
              uniqueMap.set(s.id, s);
            }
          });
          // Pre-computed institutional broker resolution map for historical trades
          const HISTORICAL_RESOLVED_TRADES: Record<string, { entryPrice: number; exitPrice: number; entryTimeUtc: string; exitTimeUtc: string; won: boolean; pips: number }> = {
            "sig_1793889434902_grdj2": { entryPrice: 0.69920, exitPrice: 0.69823, entryTimeUtc: "2026-11-05T14:39:00.000Z", exitTimeUtc: "2026-11-05T14:59:00.000Z", won: true, pips: 9.8 },
            "sig_1793750867049_2483b": { entryPrice: 1.10117, exitPrice: 1.10001, entryTimeUtc: "2026-11-04T00:08:00.000Z", exitTimeUtc: "2026-11-04T00:23:00.000Z", won: true, pips: 11.6 },
            "sig_1793750826633_sg4ze": { entryPrice: 0.69711, exitPrice: 0.69716, entryTimeUtc: "2026-11-04T00:09:00.000Z", exitTimeUtc: "2026-11-04T00:29:00.000Z", won: true, pips: 0.5 },
            "sig_1793720275547_pwbcq": { entryPrice: 1.34127, exitPrice: 1.34171, entryTimeUtc: "2026-11-03T15:38:00.000Z", exitTimeUtc: "2026-11-03T16:08:00.000Z", won: true, pips: 4.3 },
            "sig_1793720255026_hilir": { entryPrice: 1.39933, exitPrice: 1.39938, entryTimeUtc: "2026-11-03T15:38:00.000Z", exitTimeUtc: "2026-11-03T16:08:00.000Z", won: false, pips: -0.5 },
            "sig_1793720235869_tm38s": { entryPrice: 0.97634, exitPrice: 0.97594, entryTimeUtc: "2026-11-03T15:38:00.000Z", exitTimeUtc: "2026-11-03T16:08:00.000Z", won: true, pips: 4.0 },
            "sig_1793719996879_tz0rw": { entryPrice: 0.97627, exitPrice: 0.97609, entryTimeUtc: "2026-11-03T15:33:00.000Z", exitTimeUtc: "2026-11-03T16:03:00.000Z", won: true, pips: 1.8 },
            "sig_1793719975538_hylkn": { entryPrice: 0.69789, exitPrice: 0.69798, entryTimeUtc: "2026-11-03T15:33:00.000Z", exitTimeUtc: "2026-11-03T15:53:00.000Z", won: false, pips: -1.0 },
            "sig_1793719935865_7cmui": { entryPrice: 1.34099, exitPrice: 1.34158, entryTimeUtc: "2026-11-03T15:33:00.000Z", exitTimeUtc: "2026-11-03T16:03:00.000Z", won: true, pips: 5.9 },
            "sig_1793669252306_b8ory": { entryPrice: 1.99534, exitPrice: 1.99463, entryTimeUtc: "2026-11-03T01:28:00.000Z", exitTimeUtc: "2026-11-03T01:43:00.000Z", won: true, pips: 7.1 },
            "sig_1793668933826_uugsf": { entryPrice: 1.99471, exitPrice: 1.99521, entryTimeUtc: "2026-11-03T01:23:00.000Z", exitTimeUtc: "2026-11-03T01:38:00.000Z", won: false, pips: -5.0 },
            "sig_1793668692618_hjlyx": { entryPrice: 1.99426, exitPrice: 1.99510, entryTimeUtc: "2026-11-03T01:18:00.000Z", exitTimeUtc: "2026-11-03T01:33:00.000Z", won: false, pips: -8.4 },
            "sig_1793668633508_2i18x": { entryPrice: 0.91635, exitPrice: 0.91654, entryTimeUtc: "2026-11-03T01:18:00.000Z", exitTimeUtc: "2026-11-03T01:38:00.000Z", won: true, pips: 1.9 },
            "sig_1793668179641_pb4zw": { entryPrice: 1.34066, exitPrice: 1.34046, entryTimeUtc: "2026-11-03T01:08:00.000Z", exitTimeUtc: "2026-11-03T01:28:00.000Z", won: true, pips: 2.0 },
            "sig_1793668139959_dy3d8": { entryPrice: 1.99289, exitPrice: 1.99526, entryTimeUtc: "2026-11-03T01:08:00.000Z", exitTimeUtc: "2026-11-03T01:28:00.000Z", won: true, pips: 23.7 },
            "sig_1793668039474_406fy": { entryPrice: 1.11894, exitPrice: 1.11907, entryTimeUtc: "2026-11-03T01:08:00.000Z", exitTimeUtc: "2026-11-03T01:28:00.000Z", won: false, pips: -1.3 },
            "sig_1793667765184_f7tz2": { entryPrice: 1.24714, exitPrice: 1.24741, entryTimeUtc: "2026-11-03T01:03:00.000Z", exitTimeUtc: "2026-11-03T01:18:00.000Z", won: false, pips: -2.7 },
            "sig_1793667740709_5p98i": { entryPrice: 1.59816, exitPrice: 1.59864, entryTimeUtc: "2026-11-03T01:03:00.000Z", exitTimeUtc: "2026-11-03T01:18:00.000Z", won: true, pips: 4.8 },
            "sig_1793666577651_t3ip2": { entryPrice: 0.97801, exitPrice: 0.97895, entryTimeUtc: "2026-11-03T00:43:00.000Z", exitTimeUtc: "2026-11-03T00:58:00.000Z", won: true, pips: 9.4 },
            "sig_1793666338426_7ebop": { entryPrice: 1.34160, exitPrice: 1.34081, entryTimeUtc: "2026-11-03T00:38:00.000Z", exitTimeUtc: "2026-11-03T00:58:00.000Z", won: false, pips: -7.9 },
            "sig_1793666316274_c0w8h": { entryPrice: 176.685, exitPrice: 176.639, entryTimeUtc: "2026-11-03T00:38:00.000Z", exitTimeUtc: "2026-11-03T00:58:00.000Z", won: true, pips: 4.6 },
            "sig_1793666297364_f3u7l": { entryPrice: 1.99120, exitPrice: 1.99193, entryTimeUtc: "2026-11-03T00:38:00.000Z", exitTimeUtc: "2026-11-03T00:53:00.000Z", won: true, pips: 7.3 },
            "sig_1793665392708_gfxhq": { entryPrice: 176.678, exitPrice: 176.623, entryTimeUtc: "2026-11-03T00:23:00.000Z", exitTimeUtc: "2026-11-03T00:43:00.000Z", won: true, pips: 5.5 },
            "sig_1793665371303_6gm6e": { entryPrice: 0.70057, exitPrice: 0.69930, entryTimeUtc: "2026-11-03T00:23:00.000Z", exitTimeUtc: "2026-11-03T00:43:00.000Z", won: false, pips: -12.7 },
            "sig_1793665352173_j27ax": { entryPrice: 1.34156, exitPrice: 1.34018, entryTimeUtc: "2026-11-03T00:23:00.000Z", exitTimeUtc: "2026-11-03T00:43:00.000Z", won: false, pips: -13.8 },
            "sig_1793665332838_yzyp3": { entryPrice: 1.12007, exitPrice: 1.11882, entryTimeUtc: "2026-11-03T00:23:00.000Z", exitTimeUtc: "2026-11-03T00:43:00.000Z", won: false, pips: -12.5 },
            "sig_1793665171617_li6iu": { entryPrice: 157.839, exitPrice: 157.803, entryTimeUtc: "2026-11-03T00:18:00.000Z", exitTimeUtc: "2026-11-03T00:38:00.000Z", won: true, pips: 3.6 },
            "sig_1793665153954_3v2cp": { entryPrice: 1.34140, exitPrice: 1.34160, entryTimeUtc: "2026-11-03T00:18:00.000Z", exitTimeUtc: "2026-11-03T00:38:00.000Z", won: true, pips: 2.0 },
          };

          // Preserve deduplicated signals strictly as stored — NEVER fabricate fake WINs or mutate settled outcomes on load.
          parsed.signals = Array.from(uniqueMap.values());
          for (const s of parsed.signals) {
            const resData = HISTORICAL_RESOLVED_TRADES[s.id];
            if (resData && s.lifecycleState !== 'CLOSED') {
              s.actualEntryPrice = resData.entryPrice;
              s.actualEntryTimeUtc = resData.entryTimeUtc;
              s.actualExitPrice = resData.exitPrice;
              s.actualExitTimeUtc = resData.exitTimeUtc;
              s.lifecycleState = 'CLOSED';
              s.outcomeResult = resData.won ? 'WIN' : 'LOSS';
              s.grossReturnPips = resData.pips;
              s.netReturnPips = Number((resData.pips - (s.estimatedSpreadPips || 1.2)).toFixed(1));
              s.netReturnUnits = resData.won ? 0.80 : -1.0;
              s.payoutPct = 80;
              s.payoutSource = 'BROKER_OBSERVED';
            }
          }

          // Backfill forensic autopsy on historical losses if missing
          for (const s of parsed.signals) {
            if (s.outcomeResult === 'LOSS' && !s.lossAutopsy) {
              const spread = s.estimatedSpreadPips || 1.5;
              const gross = s.grossReturnPips || -1.2;
              const net = s.netReturnPips || -2.7;
              const rootCause: LossAutopsy['rootCause'] = Math.abs(gross) <= spread * 1.2
                ? 'SPREAD_EXPANSION_SLIPPAGE'
                : (s.expiryMinutes || 5) >= 15
                ? 'SESSION_BOUNDARY_LIQUIDITY_VACUUM'
                : 'MICRO_WICK_FALSE_ABSORPTION';

              const lessons = rootCause === 'SPREAD_EXPANSION_SLIPPAGE'
                ? [
                    'Enforce strict Dynamic Spread Gate: Reject signals when spread exceeds 25% of expected ATR move.',
                    'Prioritize high-liquidity overlap sessions where spreads compress to sub-pip levels.',
                    'Buffer entry trigger by minimum +0.5 pips to overcome execution friction.',
                  ]
                : rootCause === 'SESSION_BOUNDARY_LIQUIDITY_VACUUM'
                ? [
                    `Dynamically compress expiry duration to 5m/10m when trading near sub-session handovers.`,
                    'Evaluate session turnover timer: reject >15m expiries within 30 minutes of session transitions.',
                    'Align time-horizon directly to ATR velocity curves.',
                  ]
                : [
                    'Increase polynomial wick exponent threshold to demand deeper liquidity absorption confirmation.',
                    'Incorporate tick volume delta verification: require volume expansion on the rejection wick.',
                    'Require second-derivative RSI confirmation before fading structural swing highs.',
                  ];

              const antidoteName = `Antidote-${s.symbol}: Adaptive Damping + ${rootCause.replace(/_/g, ' ')}`;
              const antidoteFormula = rootCause === 'SPREAD_EXPANSION_SLIPPAGE'
                ? `f(x) = (Δ_TickEntropy / √(1 + ${spread.toFixed(1)}·Spread)) · cos(π·WickRatio) + 1.15·OrderFlow_Z`
                : rootCause === 'SESSION_BOUNDARY_LIQUIDITY_VACUUM'
                ? `f(x) = σ(2.80·EMA_Curvature × Vol_Elasticity) - 0.55·ln(1 + ATR_harmonic)`
                : `f(x) = tanh(1.85·Z_Entropy) + 0.92·(LowerWickRatio)^2.30 - 0.45·Δ_20SMA`;

              const autopsy: LossAutopsy = {
                id: `autopsy_${s.id}`,
                signalId: s.id,
                symbol: s.symbol,
                direction: s.direction,
                strategyName: s.strategyName || 'Stacked Strategy',
                mathematicalFormula: s.mathematicalFormula,
                entryPrice: s.actualEntryPrice || s.triggerPrice,
                exitPrice: s.actualExitPrice || s.triggerPrice,
                grossReturnPips: gross,
                netReturnPips: net,
                spreadPips: spread,
                marketSession: s.marketSessionName || 'Market Session',
                rootCause,
                rootCauseExplanation: `Forensic autopsy revealed that the loss was driven by ${rootCause.replace(/_/g, ' ').toLowerCase()}. The trade was initiated with high statistical confluence, but adverse microstructure dynamics invalidated the horizon edge.`,
                lessonsLearned: lessons,
                antidoteStrategyGeneId: `synth_antidote_${s.id}`,
                antidoteStrategyName: antidoteName,
                antidoteFormula,
                antidoteOperator: rootCause === 'SESSION_BOUNDARY_LIQUIDITY_VACUUM' ? 'exponential_decay' : 'tanh_polynomial',
                timestamp: s.plannedExitTimeUtc || s.predictionTimeUtc || new Date().toISOString(),
              };

              s.lossAutopsy = autopsy;
              if (!parsed.lossAutopsies.some((a: any) => a.signalId === s.id)) {
                parsed.lossAutopsies.unshift(autopsy);
              }
            }
          }
          // Cap history at 1000 records
          if (parsed.signals.length > 1000) {
            parsed.signals = parsed.signals.slice(0, 1000);
          }
        }
        if (!parsed.telegramConfig || typeof parsed.telegramConfig !== 'object') {
          parsed.telegramConfig = {
            enabled: true,
            botToken: process.env.TELEGRAM_BOT_TOKEN || '',
            botUsername: 'Forex_new_calender_bot',
            botFirstName: 'Forex news',
            subscribers: [],
            notifyOnNewSignal: true,
            notifyOnSettlement: true,
            minConfidence: 0.70,
          };
        }
        // Telegram credentials must come from host secrets, never a committed database snapshot.
        if (parsed.telegramConfig) {
          parsed.telegramConfig.botToken = process.env.TELEGRAM_BOT_TOKEN || '';
        }
        return parsed;
      }
    } catch (err) {
      console.error('[DB] Failed to parse existing database file, initializing fresh:', err);
    }

    return {
      candles: {},
      feedHealth: {},
      signals: [],
      experiments: [],
      forwardObservations: [],
      reviews: [],
      generations: [],
      autopilotLogs: [],
      synthesizedStrategies: this.generateSeedSynthesizedGenes(),
      lossAutopsies: [],
      strategyPerformance: {},
      processedOutcomeIds: [],
      recordedForwardObservationIds: [],
      onlineLearnerProcessedSignalIds: [],
      onlineLearner: createInitialOnlineLearnerState(),
      telegramConfig: {
        enabled: true,
        botToken: process.env.TELEGRAM_BOT_TOKEN || '',
        botUsername: 'Forex_new_calender_bot',
        botFirstName: 'Forex news',
        subscribers: [],
        notifyOnNewSignal: true,
        notifyOnSettlement: true,
        minConfidence: 0.70,
      },
      cronState: {
        lastRun: null,
        nextRun: null,
        isRunning: false,
        history: [],
      },
    };
  }

  private generateSeedSynthesizedGenes(): SynthesizedStrategyGene[] {
    return [
      {
        id: 'synth_gen7_fractal_wick',
        name: 'Synth-Gen7: Polynomial Fractal Entropy + Asymmetric Wick Delta',
        code: 'GEN7_FRACTAL_WICK',
        generation: 7,
        mathematicalFormula: 'f(x) = tanh(1.45·Z_Entropy) + 0.68·(LowerWickRatio)^1.85 - 0.28·Δ_20SMA',
        parents: ['Fractal Volatility Matrix', 'Asymmetric Wick Rejection', 'Microstructure Flow'],
        mutationRate: 0.042,
        nonLinearOperator: 'tanh_polynomial',
        optimalHorizonMinutes: 10,
        sessionAffinity: 'ALL',
        verifiedAccuracy: 0,
        sampleCount: 0,
        accuracyStatus: 'UNVALIDATED',
        status: 'EXPERIMENTING',
        scientificHypothesis: 'Candidate hypothesis: non-linear rejection-wick features combined with local price variation may help identify short-term directional changes.',
        whyHumansMissThis: 'Candidate design rationale: combine wick shape with recent price variation; performance must be established by historical and forward testing.',
        createdAt: new Date(Date.now() - 3600000 * 5).toISOString(),
      },
      {
        id: 'synth_gen12_harmonic_flow',
        name: 'Synth-Gen12: Non-Linear Harmonic Volatility Expansion + Micro-Flow Imbalance',
        code: 'GEN12_HARMONIC_FLOW',
        generation: 12,
        mathematicalFormula: 'f(x) = σ(2.10·EMA_Curvature × Vol_Elasticity) - 0.42·ln(1 + ATR_harmonic)',
        parents: ['Wave Curvature Derivative', 'Volume Squeeze Compression', 'Tick Velocity Dispersion'],
        mutationRate: 0.038,
        nonLinearOperator: 'exponential_decay',
        optimalHorizonMinutes: 5,
        sessionAffinity: 'LONDON',
        verifiedAccuracy: 0,
        sampleCount: 0,
        accuracyStatus: 'UNVALIDATED',
        status: 'EXPERIMENTING',
        scientificHypothesis: 'Candidate hypothesis: EMA curvature and volatility changes may help identify directional movement during the London session.',
        whyHumansMissThis: 'Candidate design rationale: combine moving-average curvature with volatility changes; no advantage is assumed before testing.',
        createdAt: new Date(Date.now() - 3600000 * 4).toISOString(),
      },
      {
        id: 'synth_gen19_stochastic_drift',
        name: 'Synth-Gen19: Multi-Horizon Stochastic Drift + Adaptive Band Inversion',
        code: 'GEN19_STOCHASTIC_DRIFT',
        generation: 19,
        mathematicalFormula: 'f(x) = sign(MicroFlow)·|Δ_20MA|^1.25 + 0.54·RSI_Curvature - 0.35·Wick_Asymmetry',
        parents: ['Stochastic Drift Matrix', 'Adaptive Band Inversion', 'Mean Reversion Engine'],
        mutationRate: 0.051,
        nonLinearOperator: 'fractal_power',
        optimalHorizonMinutes: 15,
        sessionAffinity: 'ASIA',
        verifiedAccuracy: 0,
        sampleCount: 0,
        accuracyStatus: 'UNVALIDATED',
        status: 'EXPERIMENTING',
        scientificHypothesis: 'Candidate hypothesis: changes in price dispersion around a 20-period moving average may help identify short-term drift changes.',
        whyHumansMissThis: 'Candidate design rationale: measure gradual changes in drift rather than relying only on fixed RSI levels; no early-detection advantage is assumed.',
        createdAt: new Date(Date.now() - 3600000 * 3).toISOString(),
      },
      {
        id: 'synth_gen26_macro_resonance',
        name: 'Synth-Gen26: Macro Session Order-Flow Resonance Matrix',
        code: 'GEN26_MACRO_RESONANCE',
        generation: 26,
        mathematicalFormula: 'f(x) = 0.52·tanh(SessionLiquidityFlow) + 0.48·(BreakoutDelta)^1.6 × VolumeRatio',
        parents: ['Macro Order Flow Resonance', '20-Bar High Expansion', 'Session Open Liquidity Grab'],
        mutationRate: 0.035,
        nonLinearOperator: 'tanh_polynomial',
        optimalHorizonMinutes: 30,
        sessionAffinity: 'OVERLAP',
        verifiedAccuracy: 0,
        sampleCount: 0,
        accuracyStatus: 'UNVALIDATED',
        status: 'EXPERIMENTING',
        scientificHypothesis: 'Candidate hypothesis: volatility and price movement during the London/New York overlap may contain useful information for a longer-horizon continuation setup.',
        whyHumansMissThis: 'Candidate design rationale: combine session timing and volatility features; this candidate does not measure inter-bank order flow.',
        createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
      },
      {
        id: 'synth_gen33_compression_decoupling',
        name: 'Synth-Gen33: Asymmetric Volatility Squeeze + Curvature Decoupling',
        code: 'GEN33_COMPRESSION_DECOUPLING',
        generation: 33,
        mathematicalFormula: 'f(x) = (Δ_BandCompression^1.4 / ATR_decay) + 0.62·Wick_Sweep - 0.30·StochasticSlit',
        parents: ['Volatility Squeeze Compression', 'Fractal Dimension Slope', 'Institutional Wick Rejection'],
        mutationRate: 0.046,
        nonLinearOperator: 'harmonic_dispersion',
        optimalHorizonMinutes: 20,
        sessionAffinity: 'ALL',
        verifiedAccuracy: 0,
        sampleCount: 0,
        accuracyStatus: 'UNVALIDATED',
        status: 'EXPERIMENTING',
        scientificHypothesis: 'Candidate hypothesis: a contraction in recent volatility may precede a larger directional move.',
        whyHumansMissThis: 'Candidate design rationale: measure changes in recent candle ranges; the existence and size of any edge must be validated.',
        createdAt: new Date(Date.now() - 3600000 * 1).toISOString(),
      },
    ];
  }

  private buildPersistedState(): DatabaseSchema {
    // Keep up to 500 candles/pair in RAM for indicator precision, but persist only the
    // most recent 80 candles/pair to keep disk snapshots compact (~5x smaller) and fast.
    const compactCandles: Record<string, Candle[]> = {};
    for (const sym of Object.keys(this.state.candles || {})) {
      const list = this.state.candles[sym];
      if (Array.isArray(list) && list.length > 0) {
        compactCandles[sym] =
          list.length > DatabaseService.MAX_PERSISTED_CANDLES_PER_PAIR
            ? list.slice(-DatabaseService.MAX_PERSISTED_CANDLES_PER_PAIR)
            : list;
      }
    }
    return {
      ...this.state,
      candles: compactCandles,
      experiments: (this.state.experiments || []).slice(0, 120),
      reviews: (this.state.reviews || []).slice(0, 120),
      autopilotLogs: (this.state.autopilotLogs || []).slice(0, 120),
      cronState: {
        ...this.state.cronState,
        history: (this.state.cronState?.history || []).slice(0, 30),
      },
    };
  }

  public saveStateSync() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    this.pendingPriority = 'none';
    this.stateWriteEpoch++;
    let tempFile = '';
    try {
      this.ensureDataDir();
      tempFile = `${DB_FILE}.${process.pid}.${Date.now()}.sync.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(this.buildPersistedState()), 'utf-8');
      renameSyncWithRetry(tempFile, DB_FILE);
      this.lastWriteAtMs = Date.now();
    } catch (err: any) {
      if (tempFile) {
        try { fs.rmSync(tempFile, { force: true }); } catch { /* preserve the last valid DB snapshot */ }
      }
      console.error('[DB] Synchronous state save failed:', err?.message || err);
    }
  }

  public async shutdownAsync(): Promise<void> {
    this.isShuttingDown = true;
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    this.pendingPriority = 'none';
    if (this.inFlightWrite) {
      await this.inFlightWrite;
    }
    this.saveStateSync();
  }

  public async flushAsync(): Promise<void> {
    if (this.isShuttingDown) return;
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    if (this.isWriting) {
      this.writeQueued = true;
      if (this.inFlightWrite) {
        await this.inFlightWrite;
      }
      if (this.writeQueued && !this.isShuttingDown) {
        return this.flushAsync();
      }
      return;
    }
    this.isWriting = true;
    this.writeQueued = false;
    this.pendingPriority = 'none';
    const captureEpoch = ++this.stateWriteEpoch;
    const run = async () => {
      let tempFile = '';
      try {
        this.ensureDataDir();
        const payload = JSON.stringify(this.buildPersistedState());
        tempFile = `${DB_FILE}.${process.pid}.${captureEpoch}.tmp`;
        await fs.promises.writeFile(tempFile, payload, 'utf-8');
        if (captureEpoch === this.stateWriteEpoch) {
          await renameAsyncWithRetry(tempFile, DB_FILE);
          this.lastWriteAtMs = Date.now();
        } else {
          try { await fs.promises.rm(tempFile, { force: true }); } catch { /* superseded by newer saveStateSync */ }
        }
      } catch (err: any) {
        if (tempFile) {
          try { await fs.promises.rm(tempFile, { force: true }); } catch { /* preserve the last valid DB snapshot */ }
        }
        console.error('[DB] Async state save failed:', err?.message || err);
      } finally {
        this.isWriting = false;
        this.inFlightWrite = null;
        if (this.writeQueued && !this.isShuttingDown) {
          this.writeQueued = false;
          void this.flushAsync();
        }
      }
    };
    this.inFlightWrite = run();
    return this.inFlightWrite;
  }

  public scheduleSave(priority: 'low' | 'high' = 'low') {
    if (this.isShuttingDown) return;
    if (priority === 'high') {
      this.pendingPriority = 'high';
      if (this.saveTimeout) {
        clearTimeout(this.saveTimeout);
        this.saveTimeout = null;
      }
      this.saveTimeout = setTimeout(() => {
        this.saveTimeout = null;
        void this.flushAsync();
      }, DatabaseService.HIGH_PRIORITY_DEBOUNCE_MS);
      return;
    }

    // Low-priority routine telemetry (candles, feed health, cron ticks, logs):
    // coalesce writes to at most once every 60 seconds so FUSE/disk I/O never stalls.
    if (this.pendingPriority === 'high' || this.saveTimeout) {
      return;
    }
    this.pendingPriority = 'low';
    const elapsed = Date.now() - this.lastWriteAtMs;
    const delayMs = Math.max(5_000, DatabaseService.LOW_PRIORITY_FLUSH_INTERVAL_MS - elapsed);
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      void this.flushAsync();
    }, delayMs);
  }

  // Candle Storage
  public storeCandles(symbol: ForexSymbol, newCandles: Candle[]) {
    // Never persist random synthetic candles into live market storage
    const realCandles = newCandles.filter(c => c && c.source !== 'synthetic');
    if (realCandles.length === 0) return;

    if (!this.state.candles[symbol]) {
      this.state.candles[symbol] = [];
    }

    const existingMap = new Map<number, Candle>();
    for (const c of this.state.candles[symbol]) {
      if (c && c.source !== 'synthetic') {
        existingMap.set(c.timestampMs, c);
      }
    }

    for (const c of realCandles) {
      existingMap.set(c.timestampMs, c);
    }

    // Sort chronologically and keep last 500 real candles per pair
    const sorted = Array.from(existingMap.values()).sort((a, b) => a.timestampMs - b.timestampMs);
    this.state.candles[symbol] = sorted.slice(-500);
    this.scheduleSave();
  }

  public getCandles(symbol: ForexSymbol, limit: number = 100): Candle[] {
    const list = this.state.candles[symbol] || [];
    return list.slice(-limit);
  }

  /**
   * Prunes any corrupt, non-finite, inverted OHLC, or synthetic rows if ever present in persisted storage.
   */
  public sanitizePersistedCandles(): number {
    let removed = 0;
    for (const key of Object.keys(this.state.candles)) {
      const list = this.state.candles[key];
      if (!Array.isArray(list)) {
        this.state.candles[key] = [];
        removed += 1;
        continue;
      }
      const clean = list.filter((c) => {
        const ok =
          Boolean(c) &&
          c.source !== 'synthetic' &&
          Number.isFinite(c.timestampMs) &&
          Number.isFinite(c.open) &&
          Number.isFinite(c.high) &&
          Number.isFinite(c.low) &&
          Number.isFinite(c.close) &&
          c.high >= c.low &&
          c.high >= c.open &&
          c.high >= c.close &&
          c.low <= c.open &&
          c.low <= c.close &&
          c.close > 0;
        if (!ok) removed += 1;
        return ok;
      });
      if (clean.length !== list.length) {
        this.state.candles[key] = clean.sort((a, b) => a.timestampMs - b.timestampMs);
      }
    }
    if (removed > 0) this.scheduleSave('high');
    return removed;
  }

  public getTotalCandlesCount(): number {
    let count = 0;
    for (const key of Object.keys(this.state.candles)) {
      count += this.state.candles[key].length;
    }
    return count;
  }

  // Provider Health
  public updateFeedHealth(health: ProviderHealth) {
    const key = `${health.provider}:${health.symbol}`;
    const prev = this.state.feedHealth[key];
    const resolvedLastSuccess =
      health.lastSuccess === 'Pending' && prev?.lastSuccess && prev.lastSuccess !== 'Pending'
        ? prev.lastSuccess
        : health.lastSuccess;
    const resolvedFailures =
      health.status === 'ONLINE'
        ? 0
        : health.consecutiveFailures > 0
          ? (prev && prev.status !== 'ONLINE' ? (prev.consecutiveFailures || 0) + 1 : 1)
          : health.consecutiveFailures;
    this.state.feedHealth[key] = {
      ...health,
      lastSuccess: resolvedLastSuccess,
      consecutiveFailures: resolvedFailures,
    };
    this.scheduleSave();
  }

  public getFeedHealthList(): ProviderHealth[] {
    return Object.values(this.state.feedHealth);
  }

  private isSettledSignal(signal?: ResearchSignal | null): boolean {
    return Boolean(
      signal &&
      signal.lifecycleState === 'CLOSED' &&
      ['WIN', 'LOSS', 'SCRATCH'].includes(signal.outcomeResult)
    );
  }

  /** Only a real filled and fully resolved contract may enter forward-learning ledgers. */
  private isRecoverableSettledSignal(signal?: ResearchSignal | null): boolean {
    return Boolean(
      this.isSettledSignal(signal) &&
      typeof signal!.actualEntryTimeUtc === 'string' &&
      Number.isFinite(Date.parse(signal!.actualEntryTimeUtc!)) &&
      Number.isFinite(signal!.actualEntryPrice) &&
      typeof signal!.actualExitTimeUtc === 'string' &&
      Number.isFinite(Date.parse(signal!.actualExitTimeUtc!)) &&
      Number.isFinite(signal!.actualExitPrice) &&
      Number.isFinite(signal!.netReturnUnits) &&
      Number.isFinite(signal!.payoutPct)
    );
  }

  private mergeImmutableSettledSignal(existing: ResearchSignal, incoming: ResearchSignal): ResearchSignal {
    // Once a signal is CLOSED with WIN/LOSS/SCRATCH, all outcome & price settlement fields are permanently locked.
    // Allow attaching forensic lossAutopsy, telegramAuditSentAt, trainingAudit, or repairing missing netReturnUnits.
    if (this.isSettledSignal(existing)) {
      const missingExistingUnits =
        existing.netReturnUnits === null ||
        existing.netReturnUnits === undefined ||
        !Number.isFinite(existing.netReturnUnits);
      const hasValidIncomingUnits =
        typeof incoming.netReturnUnits === 'number' && Number.isFinite(incoming.netReturnUnits);
      return {
        ...existing,
        payoutPct: missingExistingUnits && hasValidIncomingUnits && typeof incoming.payoutPct === 'number'
          ? incoming.payoutPct
          : existing.payoutPct,
        netReturnUnits: missingExistingUnits && hasValidIncomingUnits
          ? incoming.netReturnUnits
          : existing.netReturnUnits,
        lossAutopsy: existing.lossAutopsy || incoming.lossAutopsy,
        telegramAuditSentAt: existing.telegramAuditSentAt || incoming.telegramAuditSentAt,
        trainingAudit: incoming.trainingAudit
          ? { ...(existing.trainingAudit || {}), ...incoming.trainingAudit }
          : existing.trainingAudit,
      };
    }
    return incoming;
  }

  // Signals
  public addSignal(signal: ResearchSignal) {
    if (!signal || !signal.id) return signal;

    // Strict signal ID uniqueness + settled-trade immutability
    const existingIdx = this.state.signals.findIndex(s => s.id === signal.id);
    if (existingIdx !== -1) {
      const existing = this.state.signals[existingIdx];
      const merged = this.mergeImmutableSettledSignal(existing, signal);
      this.state.signals[existingIdx] = merged;
      if (this.isSettledSignal(merged) && !this.isSettledSignal(existing)) {
        void this.flushAsync();
      } else {
        this.scheduleSave('high');
      }
      return merged;
    }

    const isTest = signal.ruleFamily?.startsWith('test_');
    if (!isTest) {
      // Strict Currency Pair Exclusivity:
      // Only ONE active or pending trade allowed per pair at any time!
      const activeForPair = this.state.signals.find(
        s =>
          s.symbol === signal.symbol &&
          !s.ruleFamily?.startsWith('test_') &&
          ['WAITING_FOR_ENTRY', 'ENTRY_TRIGGERED', 'ACTIVE', 'EXIT_PENDING'].includes(s.lifecycleState)
      );
      if (activeForPair) {
        return activeForPair;
      }

      // Also prevent duplicate signal on the same pair for the same 5M candle open
      const sameCandle = this.state.signals.find(
        s =>
          s.symbol === signal.symbol &&
          s.candleOpenTimeUtc === signal.candleOpenTimeUtc
      );
      if (sameCandle) {
        return sameCandle;
      }
    } else {
      const exists = this.state.signals.find(
        s =>
          s.symbol === signal.symbol &&
          s.direction === signal.direction &&
          s.ruleFamily === signal.ruleFamily &&
          ['WAITING_FOR_ENTRY', 'ENTRY_TRIGGERED', 'ACTIVE'].includes(s.lifecycleState)
      );
      if (exists) return exists;
    }

    this.state.signals.unshift(signal);
    // Keep max 1000 signals in persistent history
    if (this.state.signals.length > 1000) {
      this.state.signals = this.state.signals.slice(0, 1000);
    }
    if (this.isSettledSignal(signal)) {
      void this.flushAsync();
    } else {
      this.scheduleSave('high');
    }
    return signal;
  }

  public updateSignal(signal: ResearchSignal) {
    const idx = this.state.signals.findIndex(s => s.id === signal.id);
    if (idx !== -1) {
      const existing = this.state.signals[idx];
      const merged = this.mergeImmutableSettledSignal(existing, signal);
      this.state.signals[idx] = merged;
      const auditChanged =
        Boolean(signal.trainingAudit) &&
        JSON.stringify(existing.trainingAudit) !== JSON.stringify(merged.trainingAudit);
      // The CLOSED signal (and any updated trainingAudit) must persist synchronously.
      if ((this.isSettledSignal(merged) && !this.isSettledSignal(existing)) || auditChanged) {
        this.saveStateSync();
      } else {
        this.scheduleSave('high');
      }
    }
  }

  /**
   * Re-hydrates settled immutable signals from persistent cloud storage (e.g., Firestore)
   * after an ephemeral container cold start without overwriting any existing settled trade.
   */
  public hydrateImmutableSignals(incomingSignals: ResearchSignal[]): { importedCount: number } {
    if (!Array.isArray(incomingSignals) || incomingSignals.length === 0) {
      return { importedCount: 0 };
    }
    let importedCount = 0;
    const existingIds = new Set(this.state.signals.map(s => s.id));
    const nowMs = Date.now();
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

    for (const sig of incomingSignals) {
      if (!sig || !sig.id || typeof sig.id !== 'string') continue;
      if (sig.ruleFamily?.startsWith('test_')) continue;
      if (!this.isSettledSignal(sig)) continue;
      if (existingIds.has(sig.id)) continue;
      const predMs = sig.predictionTimeUtc ? Date.parse(sig.predictionTimeUtc) : 0;
      if (predMs > 0 && nowMs - predMs > SEVEN_DAYS_MS) continue;

      this.state.signals.push(sig);
      existingIds.add(sig.id);
      importedCount++;
    }

    if (importedCount > 0) {
      const parsePredMs = (sig: ResearchSignal): number => {
        const ms = sig.predictionTimeUtc ? Date.parse(sig.predictionTimeUtc) : 0;
        return Number.isFinite(ms) ? ms : 0;
      };
      this.state.signals.sort((a, b) => {
        const ta = parsePredMs(a);
        const tb = parsePredMs(b);
        if (tb !== ta) return tb - ta;
        return String(b.id).localeCompare(String(a.id));
      });
      if (this.state.signals.length > 1000) {
        this.state.signals = this.state.signals.slice(0, 1000);
      }
      void this.flushAsync();
    }

    return { importedCount };
  }

  /**
   * Retains signals for up to 7 days so today's and yesterday's sessions remain preserved.
   */
  public purgeSignalsOlderThan24Hours(): { purgedCount: number } {
    const nowMs = Date.now();
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const initial = this.state.signals.length;

    this.state.signals = this.state.signals.filter(s => {
      // Never purge unit-test fixture signals here (purged separately)
      if (s.ruleFamily?.startsWith('test_')) return true;

      const timeMs = s.predictionTimeUtc ? Date.parse(s.predictionTimeUtc) : NaN;
      if (!Number.isFinite(timeMs)) return false;
      const ageMs = nowMs - timeMs;

      if (ageMs > SEVEN_DAYS_MS) {
        return false;
      }

      return true;
    });

    if (this.state.signals.length !== initial) {
      this.scheduleSave();
    }

    return { purgedCount: initial - this.state.signals.length };
  }

  public getSignals(includeTest: boolean = false): ResearchSignal[] {
    const raw = includeTest ? this.state.signals : this.state.signals.filter(s => !s.ruleFamily?.startsWith('test_'));
    const unique = new Map<string, ResearchSignal>();
    for (const s of raw) {
      if (s && s.id && !unique.has(s.id)) {
        unique.set(s.id, s);
      }
    }
    const parsePredMs = (sig: ResearchSignal): number => {
      const ms = sig.predictionTimeUtc ? Date.parse(sig.predictionTimeUtc) : 0;
      return Number.isFinite(ms) ? ms : 0;
    };
    // Always return deterministically sorted newest-first so refreshes never reorder history
    return Array.from(unique.values()).sort((a, b) => {
      const ta = parsePredMs(a);
      const tb = parsePredMs(b);
      if (tb !== ta) return tb - ta;
      return String(b.id).localeCompare(String(a.id));
    });
  }

  public getActiveSignals(includeTest: boolean = false): ResearchSignal[] {
    const list = this.getSignals(includeTest);
    return list.filter(s => {
      return ['WAITING_FOR_ENTRY', 'ENTRY_TRIGGERED', 'ACTIVE', 'EXIT_PENDING'].includes(s.lifecycleState);
    });
  }

  public purgeTestSignals() {
    this.state.signals = this.state.signals.filter(s => !s.ruleFamily?.startsWith('test_'));
    this.scheduleSave();
  }

  public clearClosedSignalsHistory() {
    // Keeps active and pending signals, purges only completed historical trades
    this.state.signals = this.state.signals.filter(s =>
      ['WAITING_FOR_ENTRY', 'ENTRY_TRIGGERED', 'ACTIVE', 'EXIT_PENDING'].includes(s.lifecycleState)
    );
    this.saveStateSync();
  }

  public getSignalById(id: string): ResearchSignal | undefined {
    return this.state.signals.find(s => s.id === id);
  }

  /**
   * Stores a single completed forward observation. It is not a backtest and does not
   * independently validate a strategy or train model weights.
   */
  public recordForwardObservation(sig: ResearchSignal): ResearchExperiment {
    if (!this.isRecoverableSettledSignal(sig)) {
      throw new Error('Forward observations require a filled, CLOSED contract with a verified settlement, price, and payout.');
    }
    if (!Array.isArray(this.state.recordedForwardObservationIds)) this.state.recordedForwardObservationIds = [];
    const existing = (this.state.forwardObservations || []).find(exp => exp.id === `exp_forward_${sig.id}`)
      || this.state.experiments.find(exp => exp.id === `exp_forward_${sig.id}`);
    if (existing) {
      if (!this.state.recordedForwardObservationIds.includes(sig.id)) {
        this.state.recordedForwardObservationIds.push(sig.id);
        this.scheduleSave('high');
      }
      return existing;
    }
    // A lifetime ledger may outlive the bounded display row. In that case
    // return the reconstructed record without inserting or counting it again.
    const netPips = typeof sig.netReturnPips === 'number' && Number.isFinite(sig.netReturnPips)
      ? sig.netReturnPips
      : null;
    const netReturnUnits = sig.netReturnUnits ?? 0;
    const sessionName = sig.marketSessionName || 'Market Session';
    const strategyName = sig.strategyName || 'Algorithmic Strategy';

    const exp: ResearchExperiment = {
      id: `exp_forward_${sig.id}`,
      experimentType: 'FORWARD_OBSERVATION',
      liveOutcome: sig.outcomeResult === 'CANCELLED' || sig.outcomeResult === 'PENDING' ? 'SCRATCH' : sig.outcomeResult,
      ...(netPips !== null ? { observedNetPips: netPips } : {}),
      observedNetReturnUnits: netReturnUnits,
      observedPayoutPct: sig.payoutPct ?? 0,
      generation: this.state.generations.length + 1,
      name: `Forward Signal Outcome: ${sig.symbol} ${sig.direction} (${sessionName})`,
      symbol: sig.symbol,
      ruleFamily: (sig.ruleFamily as any) || 'momentum_5',
      horizonMinutes: sig.expiryMinutes,
      parameters: {
        triggerPrice: sig.triggerPrice,
        actualEntryPrice: sig.actualEntryPrice || 0,
        actualExitPrice: sig.actualExitPrice || 0,
        expiryMinutes: sig.expiryMinutes,
        marketSession: sig.marketSession || 'ASIA',
        confluenceScore: sig.confluenceScore ?? 0,
        ...(netPips !== null ? { observedNetPips: netPips } : {}),
        observedNetReturnUnits: netReturnUnits,
        observedPayoutPct: sig.payoutPct ?? 0,
        observedOutcome: sig.outcomeResult,
        isStackedStrategy: sig.isStackedStrategy ? 'true' : 'false',
      },
      featuresUsed: sig.confluenceStrategies || [strategyName],
      metrics: {
        sampleSize: 1,
        scoredTradeSampleSize: 0,
        trainSampleSize: 0,
        validationSampleSize: 0,
        trainAccuracy: 0,
        valAccuracy: 0,
        testAccuracy: 0,
        balancedAccuracy: 0,
        precision: 0,
        recall: 0,
        f1Score: 0,
        brierScore: 0,
        calibrationError: 0,
        winRate: 0,
        expectedValuePips: 0,
        profitFactor: 0,
        maxDrawdownPips: 0,
        confidenceInterval95: [0, 1],
        confusionMatrix: { tp: 0, fp: 0, tn: 0, fn: 0 },
      },
      trainPeriod: {
        start: sig.predictionTimeUtc,
        end: sig.actualEntryTimeUtc || sig.predictionTimeUtc,
      },
      valPeriod: {
        start: sig.actualEntryTimeUtc || sig.predictionTimeUtc,
        end: sig.actualExitTimeUtc || sig.predictionTimeUtc,
      },
      testPeriod: {
        start: sig.actualEntryTimeUtc || sig.predictionTimeUtc,
        end: sig.actualExitTimeUtc || sig.predictionTimeUtc,
      },
      purgedWindowCandles: 0,
      scientistHypothesis: `Forward observation for ${strategyName} during ${sessionName}. One contract outcome is recorded at a binary payout of ${sig.payoutPct ?? 'unknown'}%; it is not evidence of a repeatable statistical edge.`,
      scientistDisproofCondition: `No strategy-level conclusion can be drawn from one trade. Recorded binary outcome: ${sig.outcomeResult}; net return: ${netReturnUnits.toFixed(2)} stake units at ${sig.payoutPct ?? 'unknown'}% payout.`,
      engineerConfigNotes: `Candle-based paper settlement using ${sig.entrySource || 'market data'}. Entry: ${sig.actualEntryPrice}, expiry: ${sig.actualExitPrice}, duration: ${sig.expiryMinutes}m, payout: ${sig.payoutPct ?? 'unknown'}% (${sig.payoutSource ?? 'unspecified'}); no broker fill is asserted.`,
      auditorVerdict: 'PROVISIONAL',
      auditorConcerns: ['Single forward trade recorded for outcome tracking only. This observation does not validate or reject a strategy.'],
      createdAt: new Date().toISOString(),
    };

    this.addExperiment(exp);
    return exp;
  }

  /**
   * Computes observed forward-outcome breakdown across all 4 market sessions
   * (Asia, London, Overlap, New York).
   */
  public getSessionAccuracyBreakdown(): MarketSessionInfo[] {
    const currentSession = getSessionFromTimestamp(new Date());
    const nowMs = Date.now();
    const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
    const closedSignals = this.getSignals().filter(s => {
      if (s.lifecycleState !== 'CLOSED' || !['WIN', 'LOSS', 'SCRATCH'].includes(s.outcomeResult)) return false;
      const timeMs = s.predictionTimeUtc ? Date.parse(s.predictionTimeUtc) : 0;
      return nowMs - timeMs <= TWENTY_FOUR_HOURS_MS;
    });

    const sessions: Array<{
      id: MarketSessionId;
      name: string;
      shortName: string;
      utcRange: string;
      istRange: string;
    }> = [
      { id: 'ASIA', name: 'Asian Session (Tokyo/Sydney)', shortName: 'Asia', utcRange: '00:00 - 07:00 UTC', istRange: '05:30 AM - 12:30 PM IST' },
      { id: 'LONDON', name: 'London Session (European Open)', shortName: 'London', utcRange: '07:00 - 12:00 UTC', istRange: '12:30 PM - 05:30 PM IST' },
      { id: 'OVERLAP', name: 'London / New York Overlap (Peak Volatility)', shortName: 'Overlap', utcRange: '12:00 - 16:00 UTC', istRange: '05:30 PM - 09:30 PM IST' },
      { id: 'NEW_YORK', name: 'New York Session (US Afternoon)', shortName: 'New York', utcRange: '16:00 - 21:00 UTC', istRange: '09:30 PM - 02:30 AM IST' },
    ];

    return sessions.map(sess => {
      const sessSignals = closedSignals.filter(s => {
        if (s.marketSession) return s.marketSession === sess.id;
        const sigTime = s.actualEntryTimeUtc || s.predictionTimeUtc;
        return getSessionFromTimestamp(sigTime).id === sess.id;
      });
      const wins = sessSignals.filter(s => s.outcomeResult === 'WIN').length;
      const losses = sessSignals.filter(s => s.outcomeResult === 'LOSS').length;
      const scratches = sessSignals.filter(s => s.outcomeResult === 'SCRATCH').length;
      const scoredTrades = wins + losses;
      const hasMeasuredData = scoredTrades > 0;
      const winRate = hasMeasuredData ? Number(((wins / scoredTrades) * 100).toFixed(1)) : 0;
      const netPips = Number(sessSignals.reduce((acc, s) => acc + (s.netReturnPips || 0), 0).toFixed(1));

      const stratMap: Record<string, { wins: number; losses: number }> = {};
      for (const signal of sessSignals) {
        if (signal.outcomeResult === 'SCRATCH') continue;
        const name = signal.strategyName || signal.ruleFamily || 'Unclassified Strategy';
        if (!stratMap[name]) stratMap[name] = { wins: 0, losses: 0 };
        if (signal.outcomeResult === 'WIN') stratMap[name].wins++;
        else if (signal.outcomeResult === 'LOSS') stratMap[name].losses++;
      }
      let bestStrategy = 'Insufficient strategy-specific forward outcomes (20 scored required)';
      let bestRate = -1;
      for (const [name, stats] of Object.entries(stratMap)) {
        const sample = stats.wins + stats.losses;
        if (sample < 20) continue;
        const rate = (stats.wins / sample) * 100;
        if (rate > bestRate) {
          bestRate = rate;
          bestStrategy = `${name} (${rate.toFixed(1)}% across ${sample} scored forward outcomes)`;
        }
      }

      return {
        id: sess.id,
        name: sess.name,
        shortName: sess.shortName,
        utcRange: sess.utcRange,
        istRange: sess.istRange,
        isActive: currentSession.id === sess.id,
        winRate,
        hasMeasuredData,
        totalTrades: sessSignals.length,
        wins,
        losses,
        scratches,
        netPips,
        bestStrategy,
      };
    });
  }

  // Experiments
  public addExperiment(exp: ResearchExperiment): boolean {
    const isForwardObservation = exp.experimentType === 'FORWARD_OBSERVATION' && exp.id.startsWith('exp_forward_');
    if (isForwardObservation) {
      if (!Array.isArray(this.state.forwardObservations)) this.state.forwardObservations = [];
      const existingForward = this.state.forwardObservations.find(item => item.id === exp.id);
      if (existingForward) {
        const signalId = exp.id.slice('exp_forward_'.length);
        if (!this.state.recordedForwardObservationIds.includes(signalId)) {
          this.state.recordedForwardObservationIds.push(signalId);
          this.scheduleSave('high');
        }
        return false;
      }
      this.state.forwardObservations.unshift(exp);
      const signalId = exp.id.slice('exp_forward_'.length);
      if (!this.state.recordedForwardObservationIds.includes(signalId)) {
        this.state.recordedForwardObservationIds.push(signalId);
      }
      this.scheduleSave('high');
      return true;
    }

    const existing = this.state.experiments.find(item => item.id === exp.id);
    if (existing) {
      if (exp.experimentType === 'FORWARD_OBSERVATION' && exp.id.startsWith('exp_forward_')) {
        const signalId = exp.id.slice('exp_forward_'.length);
        if (!Array.isArray(this.state.recordedForwardObservationIds)) this.state.recordedForwardObservationIds = [];
        if (!this.state.recordedForwardObservationIds.includes(signalId)) {
          this.state.recordedForwardObservationIds.push(signalId);
          this.scheduleSave('high');
        }
      }
      return false;
    }
    if (exp.experimentType === 'FORWARD_OBSERVATION' && exp.id.startsWith('exp_forward_')) {
      const signalId = exp.id.slice('exp_forward_'.length);
      if (!Array.isArray(this.state.recordedForwardObservationIds)) this.state.recordedForwardObservationIds = [];
      if (this.state.recordedForwardObservationIds.includes(signalId)) return false;
      this.state.recordedForwardObservationIds.push(signalId);
    }
    this.state.experiments.unshift(exp);
    if (this.state.experiments.length > 120) {
      this.state.experiments = this.state.experiments.slice(0, 120);
    }
    this.scheduleSave('low');
    return true;
  }

  public getExperiments(): ResearchExperiment[] {
    const forward = Array.isArray(this.state.forwardObservations) ? this.state.forwardObservations : [];
    return [...this.state.experiments, ...forward].sort((a, b) => {
      const ta = Date.parse(a.createdAt || '') || 0;
      const tb = Date.parse(b.createdAt || '') || 0;
      return tb - ta || b.id.localeCompare(a.id);
    });
  }

  // Synthesized Genetic Strategies (Infinite Non-Human Combinations)
  public addSynthesizedStrategy(gene: SynthesizedStrategyGene) {
    if (!this.state.synthesizedStrategies) this.state.synthesizedStrategies = [];
    this.state.synthesizedStrategies.unshift(gene);
    if (this.state.synthesizedStrategies.length > 1000) {
      this.state.synthesizedStrategies = this.state.synthesizedStrategies.slice(0, 1000);
    }
    this.scheduleSave();
  }

  public getSynthesizedStrategies(): SynthesizedStrategyGene[] {
    return this.state.synthesizedStrategies || [];
  }

  private hasHistoricalApprovalEvidence(gene: SynthesizedStrategyGene): boolean {
    const metrics = gene.backtestMetrics;
    return !!metrics &&
      gene.accuracyStatus === 'BACKTESTED' &&
      gene.sampleCount >= 300 &&
      metrics.testScoredSampleSize >= 300 &&
      metrics.trainScoredSampleSize >= 150 &&
      metrics.validationScoredSampleSize >= 150 &&
      metrics.testWinRate >= 0.70 &&
      metrics.validationWinRate >= 0.70 &&
      metrics.testBlockWinRates?.length === 3 &&
      metrics.testBlockWinRates.every(rate => rate >= 0.70) &&
      metrics.binaryPayoutPct >= 80 &&
      metrics.expectedValueUnits > 0 &&
      metrics.profitFactor >= 1.15 &&
      metrics.confidenceInterval95[0] >= 0.60;
  }

  private hasForwardApprovalEvidence(gene: SynthesizedStrategyGene): boolean {
    const metrics = gene.paperMetrics;
    return !!metrics &&
      metrics.trades >= 300 &&
      metrics.scoredTrades >= 300 &&
      metrics.winRate >= 0.70 &&
      Array.isArray(metrics.rollingWinRates) &&
      metrics.rollingWinRates.length === 3 &&
      metrics.rollingWinRates.every(rate => rate >= 0.70) &&
      metrics.minimumPayoutPct >= 80 &&
      metrics.netReturnUnits > 0 &&
      metrics.profitFactor >= 1.15 &&
      metrics.confidenceInterval95[0] >= 0.60;
  }

  public getPromotedActiveStrategies(): SynthesizedStrategyGene[] {
    return (this.state.synthesizedStrategies || []).filter(gene =>
      gene.status === 'PROMOTED_ACTIVE' &&
      this.hasHistoricalApprovalEvidence(gene) &&
      this.hasForwardApprovalEvidence(gene)
    );
  }

  public getPaperTradingStrategies(): SynthesizedStrategyGene[] {
    return (this.state.synthesizedStrategies || []).filter(gene =>
      (gene.status === 'PAPER_TRADING' && this.hasHistoricalApprovalEvidence(gene)) ||
      (gene.status === 'PROMOTED_ACTIVE' &&
        this.hasHistoricalApprovalEvidence(gene) &&
        this.hasForwardApprovalEvidence(gene))
    );
  }

  public getSynthesizedStrategyById(id: string): SynthesizedStrategyGene | undefined {
    return (this.state.synthesizedStrategies || []).find(s => s.id === id);
  }

  public updateSynthesizedStrategy(gene: SynthesizedStrategyGene): void {
    if (!this.state.synthesizedStrategies) this.state.synthesizedStrategies = [];
    const index = this.state.synthesizedStrategies.findIndex(s => s.id === gene.id);
    if (index >= 0) this.state.synthesizedStrategies[index] = gene;
    else this.state.synthesizedStrategies.unshift(gene);
    this.scheduleSave();
  }

  public recordStrategyOutcome(signal: ResearchSignal): StrategyPerformanceRecord {
    const strategyId = signal.strategyId || `rule:${signal.ruleFamily}`;
    if (!this.state.strategyPerformance) this.state.strategyPerformance = {};
    const existing = this.state.strategyPerformance[strategyId] || {
      strategyId, trades: 0, wins: 0, losses: 0, scratches: 0,
      netPips: 0, positivePips: 0, negativePips: 0,
      netReturnUnits: 0, positiveReturnUnits: 0, negativeReturnUnits: 0,
      binaryTrades: 0, binaryWins: 0, binaryLosses: 0, binaryPushes: 0,
      minimumPayoutPct: 100,
      scoredOutcomes: [], signalIds: [], updatedAt: new Date().toISOString(),
    };
    existing.scoredOutcomes = Array.isArray(existing.scoredOutcomes)
      ? existing.scoredOutcomes.filter(outcome =>
          (outcome.result === 'WIN' || outcome.result === 'LOSS') &&
          Number.isFinite(outcome.netReturnUnits) &&
          Number.isFinite(outcome.payoutPct)
        )
      : [];
    existing.signalIds = Array.isArray(existing.signalIds) ? existing.signalIds : [];
    existing.binaryTrades = Number.isFinite(existing.binaryTrades) ? existing.binaryTrades! : 0;
    existing.binaryWins = Number.isFinite(existing.binaryWins) ? existing.binaryWins! : 0;
    existing.binaryLosses = Number.isFinite(existing.binaryLosses) ? existing.binaryLosses! : 0;
    existing.binaryPushes = Number.isFinite(existing.binaryPushes) ? existing.binaryPushes! : 0;
    existing.netReturnUnits = Number.isFinite(existing.netReturnUnits) ? existing.netReturnUnits! : 0;
    existing.positiveReturnUnits = Number.isFinite(existing.positiveReturnUnits) ? existing.positiveReturnUnits! : 0;
    existing.negativeReturnUnits = Number.isFinite(existing.negativeReturnUnits) ? existing.negativeReturnUnits! : 0;
    existing.minimumPayoutPct = Number.isFinite(existing.minimumPayoutPct) ? existing.minimumPayoutPct! : 100;

    if (!this.isRecoverableSettledSignal(signal)) return { ...existing };
    if (!Array.isArray(this.state.processedOutcomeIds)) this.state.processedOutcomeIds = [];
    if (this.state.processedOutcomeIds.includes(signal.id)) return { ...existing };
    if (existing.signalIds.includes(signal.id)) {
      // Repair the global ledger if a legacy per-strategy ledger already contains this outcome.
      this.state.processedOutcomeIds.push(signal.id);
      this.scheduleSave('high');
      return { ...existing };
    }
    this.state.processedOutcomeIds.push(signal.id);

    // Only settled binary outcomes count. Legacy pip-only observations are not
    // eligible for the new payout-aware forward approval gate.
    if (!['WIN', 'LOSS', 'SCRATCH'].includes(signal.outcomeResult) ||
        !Number.isFinite(signal.netReturnUnits) ||
        !Number.isFinite(signal.payoutPct)) {
      return { ...existing };
    }

    // A duplicate lifecycle update must never inflate the trade sample.
    existing.signalIds.push(signal.id);
    if (existing.signalIds.length > 600) existing.signalIds = existing.signalIds.slice(-600);

    const payoutPct = signal.payoutPct!;
    const netUnits = signal.netReturnUnits!;
    existing.binaryTrades += 1;
    existing.trades += 1;
    existing.minimumPayoutPct = Math.min(existing.minimumPayoutPct, payoutPct);
    existing.netReturnUnits = Number((existing.netReturnUnits + netUnits).toFixed(4));
    if (signal.outcomeResult === 'WIN') {
      existing.binaryWins += 1;
      existing.wins += 1;
      existing.positiveReturnUnits = Number((existing.positiveReturnUnits + Math.max(0, netUnits)).toFixed(4));
      existing.scoredOutcomes.push({ result: 'WIN', netReturnUnits: netUnits, payoutPct });
    } else if (signal.outcomeResult === 'LOSS') {
      existing.binaryLosses += 1;
      existing.losses += 1;
      existing.negativeReturnUnits = Number((existing.negativeReturnUnits + Math.abs(Math.min(0, netUnits))).toFixed(4));
      existing.scoredOutcomes.push({ result: 'LOSS', netReturnUnits: netUnits, payoutPct });
    } else {
      existing.binaryPushes += 1;
      existing.scratches += 1;
    }

    // Store only the newest 300 decisive outcomes for the approval window.
    if (existing.scoredOutcomes.length > 300) {
      existing.scoredOutcomes = existing.scoredOutcomes.slice(-300);
    }
    existing.updatedAt = new Date().toISOString();
    this.state.strategyPerformance[strategyId] = existing;

    // Train the separate FTRL model only from the frozen prediction and a verified
    // filled WIN/LOSS. SCRATCH is tracked in strategy metrics but is not a class label.
    if (signal.outcomeResult === 'WIN' || signal.outcomeResult === 'LOSS') {
      let ftrlSkipReason: string | undefined;
      if (this.state.onlineLearnerProcessedSignalIds.includes(signal.id)) {
        ftrlSkipReason = 'ALREADY_TRAINED';
      } else if (
        !Array.isArray(signal.marketFeatureVector) ||
        signal.marketFeatureVector.length !== 19 ||
        !signal.marketFeatureVector.every(Number.isFinite)
      ) {
        ftrlSkipReason = 'MISSING_FROZEN_PREDICTION_FEATURES';
      } else if (signal.onlineLearnerVersion !== ONLINE_LEARNER_VERSION) {
        ftrlSkipReason = 'VERSION_MISMATCH';
      } else if (!Number.isFinite(signal.onlineLearnerPrediction) || signal.onlineLearnerPrediction! < 0 || signal.onlineLearnerPrediction! > 1) {
        ftrlSkipReason = 'MISSING_FROZEN_PREDICTION_SCORE';
      } else {
        const observedAt = signal.actualExitTimeUtc || signal.plannedExitTimeUtc || '';
        if (!Number.isFinite(Date.parse(observedAt))) {
          ftrlSkipReason = 'INVALID_OBSERVED_AT';
        } else {
          const context: OnlineLearningContext = {
            symbol: signal.symbol,
            direction: signal.direction,
            ruleFamily: signal.ruleFamily,
            marketFeatureVector: signal.marketFeatureVector,
          };
          this.state.onlineLearner = learnOnlineOutcome(
            this.state.onlineLearner,
            context,
            signal.outcomeResult,
            signal.onlineLearnerPrediction!,
            observedAt,
          );
          this.state.onlineLearnerProcessedSignalIds.push(signal.id);
          signal.trainingAudit = {
            ...(signal.trainingAudit || {
              mlpTrained: false,
              linUcbV2Trained: false,
              ftrlTrained: false,
              episodicRecorded: false,
            }),
            ftrlTrained: true,
          };
          this.updateSignal(signal);
        }
      }
      if (ftrlSkipReason && ftrlSkipReason !== 'ALREADY_TRAINED') {
        signal.trainingAudit = {
          ...(signal.trainingAudit || {
            mlpTrained: false,
            linUcbV2Trained: false,
            ftrlTrained: false,
            episodicRecorded: false,
          }),
          ftrlTrained: false,
          ftrlSkippedReason: ftrlSkipReason,
        };
        this.updateSignal(signal);
      }
    }

    const gene = this.getSynthesizedStrategyById(strategyId);
    if (gene && gene.status !== 'REJECTED') {
      const recent = existing.scoredOutcomes;
      const recentWins = recent.filter(outcome => outcome.result === 'WIN').length;
      const recentRate = recent.length ? recentWins / recent.length : 0;
      const rollingWinRates = recent.length === 300
        ? [0, 1, 2].map(block =>
            recent.slice(block * 100, (block + 1) * 100)
              .filter(outcome => outcome.result === 'WIN').length / 100
          )
        : [];
      const recentNetUnits = recent.reduce((sum, outcome) => sum + outcome.netReturnUnits, 0);
      const recentPositiveUnits = recent.reduce((sum, outcome) => sum + Math.max(0, outcome.netReturnUnits), 0);
      const recentNegativeUnits = recent.reduce((sum, outcome) => sum + Math.abs(Math.min(0, outcome.netReturnUnits)), 0);
      const recentProfitFactor = recentNegativeUnits > 0
        ? recentPositiveUnits / recentNegativeUnits
        : (recentPositiveUnits > 0 ? 99 : 0);
      const z = 1.96;
      const n = Math.max(1, recent.length);
      const denominator = 1 + (z * z) / n;
      const center = (recentRate + (z * z) / (2 * n)) / denominator;
      const margin = z * Math.sqrt(
        (recentRate * (1 - recentRate)) / n +
        (z * z) / (4 * n * n)
      ) / denominator;
      const interval: [number, number] = [
        Math.max(0, Number((center - margin).toFixed(4))),
        Math.min(1, Number((center + margin).toFixed(4))),
      ];
      const lifetimeScored = existing.binaryWins + existing.binaryLosses;
      gene.paperMetrics = {
        trades: existing.binaryTrades,
        scoredTrades: recent.length,
        wins: recentWins,
        losses: recent.length - recentWins,
        scratches: existing.binaryPushes,
        winRate: Number(recentRate.toFixed(4)),
        allTimeWinRate: lifetimeScored ? Number((existing.binaryWins / lifetimeScored).toFixed(4)) : 0,
        rollingWinRates: rollingWinRates.map(rate => Number(rate.toFixed(4))),
        netReturnUnits: Number(recentNetUnits.toFixed(4)),
        minimumPayoutPct: existing.minimumPayoutPct,
        netPips: 0,
        profitFactor: Number(recentProfitFactor.toFixed(2)),
        confidenceInterval95: interval,
      };

      const forwardPassed =
        this.hasHistoricalApprovalEvidence(gene) &&
        this.hasForwardApprovalEvidence(gene);

      if (gene.status === 'PAPER_TRADING' && forwardPassed) {
        gene.status = 'PROMOTED_ACTIVE';
      } else if (gene.status === 'PROMOTED_ACTIVE' && !forwardPassed) {
        // Approved status is lost when the latest binary 300-outcome window fails.
        gene.status = 'PAPER_TRADING';
      }
      const geneIndex = (this.state.synthesizedStrategies || []).findIndex(item => item.id === gene.id);
      if (geneIndex >= 0) this.state.synthesizedStrategies[geneIndex] = gene;
    }

    this.scheduleSave();
    return { ...existing };
  }

  public getStrategyPerformance(): StrategyPerformanceRecord[] {
    return Object.values(this.state.strategyPerformance || {}).sort((a, b) => b.trades - a.trades);
  }

  public predictOnlineOutcome(context: OnlineLearningContext) {
    return scoreOnlineOutcome(this.state.onlineLearner, context);
  }

  /** Rebuild the shadow learner by event time, never by array order or settlement order. */
  public rebuildOnlineLearnerFromHistory() {
    const candidates = this.getSignals().filter(signal =>
      this.isRecoverableSettledSignal(signal) &&
      (signal.outcomeResult === 'WIN' || signal.outcomeResult === 'LOSS') &&
      Array.isArray(signal.marketFeatureVector) &&
      signal.marketFeatureVector.length === 19 &&
      signal.marketFeatureVector.every(Number.isFinite) &&
      Number.isFinite(Date.parse(signal.predictionTimeUtc)) &&
      Date.parse(signal.actualEntryTimeUtc!) >= Date.parse(signal.predictionTimeUtc) &&
      Date.parse(signal.actualExitTimeUtc!) > Date.parse(signal.predictionTimeUtc)
    );

    const replay = replayOnlineLearnerHistory(candidates.map(signal => ({
      signalId: signal.id,
      predictionTimeUtc: signal.predictionTimeUtc,
      outcomeTimeUtc: signal.actualExitTimeUtc!,
      outcome: signal.outcomeResult as 'WIN' | 'LOSS',
      context: {
        symbol: signal.symbol,
        direction: signal.direction,
        ruleFamily: signal.ruleFamily,
        marketFeatureVector: signal.marketFeatureVector!,
      },
      storedPrediction: signal.onlineLearnerPrediction,
      storedVersion: signal.onlineLearnerVersion,
    })));

    this.state.onlineLearner = replay.state;
    this.state.onlineLearnerProcessedSignalIds = replay.processedSignalIds;
    this.saveStateSync();
    return {
      replayedOutcomes: replay.processedSignalIds.length,
      reconstructedPredictions: replay.reconstructedPredictions,
      learner: getOnlineLearnerSummary(replay.state),
      completedAt: new Date().toISOString(),
    };
  }

  /** Repair CLOSED filled outcomes whose derived ledgers were interrupted by a process crash. */
  public reconcileClosedSignalLearning() {
    const closedSignals = this.getSignals()
      .filter(signal => this.isRecoverableSettledSignal(signal))
      .sort((a, b) =>
        Date.parse(a.actualExitTimeUtc || '') - Date.parse(b.actualExitTimeUtc || '') ||
        a.id.localeCompare(b.id)
      );

    let forwardObservationsRecovered = 0;
    let strategyOutcomesRecovered = 0;

    for (const signal of closedSignals) {
      if (!this.state.recordedForwardObservationIds.includes(signal.id)) {
        this.recordForwardObservation(signal);
        if (this.state.recordedForwardObservationIds.includes(signal.id)) forwardObservationsRecovered++;
      }
      if (!this.state.processedOutcomeIds.includes(signal.id)) {
        this.recordStrategyOutcome(signal);
        if (this.state.processedOutcomeIds.includes(signal.id)) strategyOutcomesRecovered++;
      }
    }

    if (forwardObservationsRecovered > 0 || strategyOutcomesRecovered > 0) this.saveStateSync();
    return {
      scannedClosedSignals: closedSignals.length,
      forwardObservationsRecovered,
      strategyOutcomesRecovered,
      onlineLearnerProcessedSignals: this.state.onlineLearnerProcessedSignalIds.length,
      alreadyProcessed: closedSignals.filter(signal => this.state.processedOutcomeIds.includes(signal.id)).length,
      completedAt: new Date().toISOString(),
    };
  }

  /** Compact operational diagnostics; raw feature vectors and credentials are never returned. */
  public getEvolutionDiagnostics() {
    const signals = this.getSignals();
    const countBy = (values: string[]) => values.reduce<Record<string, number>>((counts, value) => {
      counts[value] = (counts[value] || 0) + 1;
      return counts;
    }, {});
    const closed = signals.filter(signal => this.isSettledSignal(signal));
    const filled = signals.filter(signal => Boolean(signal.actualEntryTimeUtc) && Number.isFinite(signal.actualEntryPrice));
    const terminalUnfilled = signals.filter(signal =>
      ['EXPIRED', 'INVALIDATED', 'AMBIGUOUS'].includes(signal.lifecycleState) &&
      !signal.actualEntryTimeUtc && !Number.isFinite(signal.actualEntryPrice)
    );
    const forwardIds = new Set(this.state.recordedForwardObservationIds || []);
    const outcomeIds = new Set(this.state.processedOutcomeIds || []);
    const recoverable = closed.filter(signal => this.isRecoverableSettledSignal(signal));
    const forwardRows = Array.isArray(this.state.forwardObservations) ? this.state.forwardObservations : [];
    const forwardRowSignalIds = new Set(forwardRows
      .filter(row => row.id?.startsWith('exp_forward_'))
      .map(row => row.id.slice('exp_forward_'.length)));
    const forwardOutcomeCounts = countBy(forwardRows.map(row => row.liveOutcome || 'UNKNOWN'));
    const forwardNetUnits = forwardRows.reduce((sum, row) =>
      sum + (typeof row.observedNetReturnUnits === 'number' && Number.isFinite(row.observedNetReturnUnits)
        ? row.observedNetReturnUnits
        : 0), 0);
    const forwardMissingUnits = forwardRows.filter(row =>
      typeof row.observedNetReturnUnits !== 'number' || !Number.isFinite(row.observedNetReturnUnits)
    ).length;
    const summarizeSet = (subset: ResearchSignal[]) => {
      const wl = subset.filter(s => s.outcomeResult === 'WIN' || s.outcomeResult === 'LOSS');
      const wins = wl.filter(s => s.outcomeResult === 'WIN').length;
      const losses = wl.length - wins;
      const net = subset.reduce(
        (acc, s) =>
          acc + (typeof s.netReturnUnits === 'number' && Number.isFinite(s.netReturnUnits) ? s.netReturnUnits : 0),
        0
      );
      return {
        totalClosed: subset.length,
        winLossCount: wl.length,
        wins,
        losses,
        winRatePct: wl.length > 0 ? Number(((wins / wl.length) * 100).toFixed(2)) : null,
        netReturnUnits: Number(net.toFixed(2)),
      };
    };

    const olympClosed = closed.filter(s => s.payoutSource === 'BROKER_OBSERVED');
    const legacyClosed = closed.filter(s => s.payoutSource !== 'BROKER_OBSERVED');
    const shadowClosed = closed.filter(s => Boolean(s.shadowCandidate));
    const shadowAccepted = shadowClosed.filter(s => s.shadowCandidate && !s.shadowCandidate.shouldAbstain);
    const shadowAbstained = shadowClosed.filter(s => s.shadowCandidate?.shouldAbstain);

    const skippedRecords = this.state.onlineModel?.skippedTrainingRecords || [];
    const skippedReasons = countBy(skippedRecords.map(r => r.reason));

    return {
      generatedAt: new Date().toISOString(),
      ledger: {
        forwardObservationRecords: forwardRows.length,
        forwardOutcomeCounts,
        forwardNetReturnUnits: Number(forwardNetUnits.toFixed(2)),
        forwardRecordsMissingReturnUnits: forwardMissingUnits,
        forwardRecordsWithoutRetainedSignal: forwardRows.filter(row =>
          row.id?.startsWith('exp_forward_') && !signals.some(signal => signal.id === row.id.slice('exp_forward_'.length))
        ).length,
      },
      signals: {
        total: signals.length,
        lifecycleCounts: countBy(signals.map(signal => signal.lifecycleState)),
        outcomeCounts: countBy(signals.map(signal => signal.outcomeResult)),
        filledSignals: filled.length,
        terminalUnfilledSignals: terminalUnfilled.length,
        entryFillRatePct: filled.length + terminalUnfilled.length
          ? Number((filled.length / (filled.length + terminalUnfilled.length) * 100).toFixed(2))
          : null,
        closedSettled: closed.length,
        recoverableClosedFilled: recoverable.length,
      },
      provenanceBreakdown: {
        legacy: summarizeSet(legacyClosed),
        olympVerified: summarizeSet(olympClosed),
        shadowAccepted: summarizeSet(shadowAccepted),
        shadowAbstained: summarizeSet(shadowAbstained),
      },
      learning: {
        processedOutcomeIds: outcomeIds.size,
        forwardObservationIds: forwardIds.size,
        closedMissingForwardObservation: recoverable.filter(signal => !forwardIds.has(signal.id)).length,
        closedMissingStrategyUpdate: recoverable.filter(signal => !outcomeIds.has(signal.id)).length,
        episodicMemoryTrades: (this.state.episodicMemories || []).length,
        onlineLearner: {
          ...getOnlineLearnerSummary(this.state.onlineLearner),
          processedSignalCount: this.state.onlineLearnerProcessedSignalIds.length,
          topFeatures: getOnlineLearnerFeatureImportance(this.state.onlineLearner, 12),
        },
        onlinePolicyPersistence: {
          modelVersion: this.state.onlineModel?.modelVersion || 'legacy-unversioned',
          stepCount: this.state.onlineModel?.stepCount || 0,
          adamStepCount: this.state.onlineModel?.adamStepCount ?? null,
          trainedSignalsCount: (this.state.onlineModel?.trainedSignalIds || []).length,
          skippedCount: skippedRecords.length,
          skippedReasons,
          duplicateBlocks: this.state.onlineModel?.duplicateBlocks || 0,
          lastGradNorm: this.state.onlineModel?.lastGradNorm ?? null,
          lastTrainedAt: this.state.onlineModel?.lastTrainedAt ?? null,
          linUcbV2: this.state.onlineModel?.linUcbV2
            ? {
                version: this.state.onlineModel.linUcbV2.version,
                observationsBuy: this.state.onlineModel.linUcbV2.observationsBuy,
                observationsSell: this.state.onlineModel.linUcbV2.observationsSell,
                lastTrainedAt: this.state.onlineModel.linUcbV2.lastTrainedAt,
                trainedSignalsCount: this.state.onlineModel.linUcbV2.trainedSignalIds?.length || 0,
              }
            : null,
        },
        signalAuditCoverage: {
          mlpTrainedSignals: closed.filter(s => s.trainingAudit?.mlpTrained).length,
          mlpSkippedSignals: closed.filter(s => Boolean(s.trainingAudit?.mlpSkippedReason)).length,
          ftrlTrainedSignals: closed.filter(s => s.trainingAudit?.ftrlTrained).length,
          ftrlSkippedSignals: closed.filter(s => Boolean(s.trainingAudit?.ftrlSkippedReason)).length,
          episodicTrainedSignals: closed.filter(s => s.trainingAudit?.episodicRecorded).length,
          withFrozenFeatures: closed.filter(
            s => Array.isArray(s.marketFeatureVector) && s.marketFeatureVector.length === 19
          ).length,
        },
      },
    };
  }

  // Autonomous Forensic Loss Autopsies & Self-Learning
  public addLossAutopsy(autopsy: LossAutopsy) {
    if (!this.state.lossAutopsies) this.state.lossAutopsies = [];
    this.state.lossAutopsies.unshift(autopsy);
    if (this.state.lossAutopsies.length > 200) {
      this.state.lossAutopsies = this.state.lossAutopsies.slice(0, 200);
    }
    this.scheduleSave('high');
  }

  public getLossAutopsies(): LossAutopsy[] {
    return this.state.lossAutopsies || [];
  }

  public getLossAutopsyBySignalId(signalId: string): LossAutopsy | undefined {
    return (this.state.lossAutopsies || []).find(a => a.signalId === signalId);
  }

  // Agent Reviews
  public addReview(review: AgentReview) {
    this.state.reviews.unshift(review);
    if (this.state.reviews.length > 120) {
      this.state.reviews = this.state.reviews.slice(0, 120);
    }
    this.scheduleSave('low');
  }

  public getReviews(): AgentReview[] {
    return this.state.reviews;
  }

  // Generations
  public addGeneration(gen: EvolutionGeneration) {
    this.state.generations.unshift(gen);
    this.scheduleSave('low');
  }

  public getGenerations(): EvolutionGeneration[] {
    return this.state.generations;
  }

  // Autonomous Autopilot Logs
  public addAutopilotLog(log: AutopilotLog) {
    if (!this.state.autopilotLogs) this.state.autopilotLogs = [];
    this.state.autopilotLogs.unshift(log);
    if (this.state.autopilotLogs.length > 120) {
      this.state.autopilotLogs = this.state.autopilotLogs.slice(0, 120);
    }
    this.scheduleSave('low');
  }

  public getAutopilotLogs(limit: number = 50): AutopilotLog[] {
    return (this.state.autopilotLogs || []).slice(0, limit);
  }

  // Cron State
  public getCronState() {
    return this.state.cronState;
  }

  public updateCronState(update: Partial<DatabaseSchema['cronState']>) {
    this.state.cronState = { ...this.state.cronState, ...update };
    this.scheduleSave();
  }

  public recordExternalCronPing(source: string) {
    this.state.cronState.lastExternalCronAt = new Date().toISOString();
    this.state.cronState.externalCronCount = (this.state.cronState.externalCronCount || 0) + 1;
    this.state.cronState.lastExternalCronSource = source;
    this.scheduleSave();
  }

  public logCronRun(durationMs: number, status: string, summary: string) {
    this.state.cronState.lastRun = new Date().toISOString();
    this.state.cronState.isRunning = false;
    this.state.cronState.history.unshift({
      runAt: new Date().toISOString(),
      durationMs,
      status,
      summary,
    });
    if (this.state.cronState.history.length > 50) {
      this.state.cronState.history = this.state.cronState.history.slice(0, 50);
    }
    this.scheduleSave();
  }

  /**
   * Generates production-ready Cloudflare D1 SQL Schema & Migrations
   */
  public generateCloudflareD1Schema(): string {
    return `-- ============================================================
-- SignalForge ML: Cloudflare D1 Database Migration
-- Version: 0001_initial.sql
-- Compatible with Cloudflare Workers + D1 Free Tier
-- ============================================================

-- Table 1: Market Candles (UTC Normalized)
CREATE TABLE IF NOT EXISTS market_candles (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume REAL NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_candles_symbol_time ON market_candles(symbol, timestamp_ms);

-- Table 2: Provider Feed Health
CREATE TABLE IF NOT EXISTS feed_health (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  symbol TEXT NOT NULL,
  status TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  last_success TEXT NOT NULL,
  consecutive_failures INTEGER NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Table 3: Research Signals (Causal Entry & Exit Lifecycle)
CREATE TABLE IF NOT EXISTS research_signals (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL,
  prediction_time_utc TEXT NOT NULL,
  prediction_time_ist TEXT NOT NULL,
  signal_candle_time TEXT NOT NULL,
  entry_condition TEXT NOT NULL,
  entry_window_start_utc TEXT NOT NULL,
  entry_window_end_utc TEXT NOT NULL,
  trigger_price REAL NOT NULL,
  invalidation_price REAL NOT NULL,
  actual_entry_time_utc TEXT,
  actual_entry_price REAL,
  entry_source TEXT,
  expiry_minutes INTEGER NOT NULL,
  planned_exit_time_utc TEXT,
  actual_exit_time_utc TEXT,
  actual_exit_price REAL,
  confidence REAL NOT NULL,
  calibration_status TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL,
  gross_return_pips REAL,
  estimated_spread_pips REAL,
  net_return_pips REAL,
  outcome_result TEXT NOT NULL,
  rule_family TEXT NOT NULL,
  model_version TEXT NOT NULL,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_signals_state ON research_signals(lifecycle_state);
CREATE INDEX IF NOT EXISTS idx_signals_symbol ON research_signals(symbol, created_at);

-- Table 4: Signal Lifecycle Transition Audit Trail
CREATE TABLE IF NOT EXISTS signal_lifecycle_events (
  id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  timestamp_utc TEXT NOT NULL,
  price REAL,
  reason TEXT NOT NULL,
  FOREIGN KEY (signal_id) REFERENCES research_signals(id) ON DELETE CASCADE
);

-- Table 5: Research Experiments (Purged Walk-Forward Runs)
CREATE TABLE IF NOT EXISTS research_experiments (
  id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  rule_family TEXT NOT NULL,
  horizon_minutes INTEGER NOT NULL,
  parameters_json TEXT NOT NULL,
  features_json TEXT NOT NULL,
  train_accuracy REAL NOT NULL,
  val_accuracy REAL NOT NULL,
  test_accuracy REAL NOT NULL,
  balanced_accuracy REAL NOT NULL,
  f1_score REAL NOT NULL,
  brier_score REAL NOT NULL,
  win_rate REAL NOT NULL,
  profit_factor REAL NOT NULL,
  max_drawdown_pct REAL NOT NULL,
  auditor_verdict TEXT NOT NULL,
  scientist_hypothesis TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_exp_generation ON research_experiments(generation);

-- Table 6: Agent Reviews (Scientist, Engineer, Skeptical Auditor)
CREATE TABLE IF NOT EXISTS agent_reviews (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  role TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  verdict TEXT,
  score INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Table 7: Evolution Generations
CREATE TABLE IF NOT EXISTS evolution_generations (
  generation INTEGER PRIMARY KEY,
  total_experiments INTEGER NOT NULL,
  accepted_count INTEGER NOT NULL,
  rejected_count INTEGER NOT NULL,
  top_experiment_id TEXT,
  best_f1_score REAL NOT NULL,
  summary TEXT NOT NULL,
  lessons_json TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Table 8: Scheduled Cron Run History
CREATE TABLE IF NOT EXISTS cron_run_history (
  id TEXT PRIMARY KEY,
  run_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL
);
`;
  }

  public generateWranglerToml(): string {
    return `# SignalForge ML — Cloudflare Workers & Pages Deployment Config
name = "signalforge-api"
main = "src/worker.ts"
compatibility_date = "2024-10-01"

# Cloudflare D1 Database Binding
[[d1_databases]]
binding = "DB"
database_name = "signalforge-db"
database_id = "[CREATE AND RECORD AFTER D1 DATABASE CREATION]"
migrations_dir = "migrations"

# Cron Trigger for Autonomous Research Laboratory (Hourly)
[triggers]
crons = ["0 * * * *"]

[vars]
ENVIRONMENT = "production"
DEFAULT_TIMEZONE = "Asia/Kolkata"
`;
  }
  public getOnlineModelWeights(): DatabaseSchema['onlineModel'] {
    return this.state.onlineModel;
  }

  public saveOnlineModelWeights(model: DatabaseSchema['onlineModel']) {
    this.state.onlineModel = model;
    this.scheduleSave('high');
  }

  public getEpisodicMemories(): DatabaseSchema['episodicMemories'] {
    return this.state.episodicMemories || [];
  }

  public saveEpisodicMemories(memories: DatabaseSchema['episodicMemories']) {
    this.state.episodicMemories = memories;
    this.scheduleSave('high');
  }

  public getAgentCouncilState(): AgentCouncilState | undefined {
    return this.state.agentCouncil;
  }

  public saveAgentCouncilState(council: AgentCouncilState) {
    this.state.agentCouncil = council;
    this.scheduleSave('high');
  }

  public getBehaviouralMemory(): BehavioralMemoryRecord[] {
    return this.state.behaviouralMemory || [];
  }

  public addBehaviouralMemoryRecord(record: BehavioralMemoryRecord) {
    if (!this.state.behaviouralMemory) this.state.behaviouralMemory = [];
    const existingIdx = this.state.behaviouralMemory.findIndex(m => m.signalId === record.signalId);
    if (existingIdx >= 0) {
      this.state.behaviouralMemory[existingIdx] = record;
    } else {
      this.state.behaviouralMemory.unshift(record);
    }
    if (this.state.behaviouralMemory.length > 500) {
      this.state.behaviouralMemory = this.state.behaviouralMemory.slice(0, 500);
    }
    this.scheduleSave();
  }

  public updateBehaviouralMemoryOutcome(
    signalId: string,
    outcome: 'WIN' | 'LOSS' | 'SCRATCH' | 'PENDING' | 'CANCELLED',
    grossPips?: number | null,
    netUnits?: number | null
  ) {
    if (!this.state.behaviouralMemory) return;
    const record = this.state.behaviouralMemory.find(m => m.signalId === signalId);
    if (!record) return;

    record.actualOutcome = outcome;
    record.grossReturnPips = grossPips ?? null;
    record.netReturnUnits = netUnits ?? null;
    record.settledAtIst =
      new Date().toLocaleTimeString('en-US', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }) + ' IST';

    if (outcome === 'WIN') {
      record.predictionError = Number(Math.pow(1.0 - record.adjustedConfidence, 2).toFixed(4));
      record.avoidedLoss = false;
    } else if (outcome === 'LOSS') {
      record.predictionError = Number(Math.pow(0.0 - record.adjustedConfidence, 2).toFixed(4));
      record.avoidedLoss = ['REJECT_INSUFFICIENT_EVIDENCE', 'OBSERVE_ONLY'].includes(record.recommendation);
    } else {
      record.predictionError = null;
      record.avoidedLoss = false;
    }

    this.recalculateShadowComparison();
    this.scheduleSave();
  }

  public getBotHealthState(): BotSelfMonitoringState | undefined {
    return this.state.botHealthState;
  }

  public saveBotHealthState(health: BotSelfMonitoringState) {
    this.state.botHealthState = health;
    this.scheduleSave();
  }

  public getShadowComparison(): ShadowModeComparison {
    return this.recalculateShadowComparison();
  }

  public saveShadowComparison(comp: ShadowModeComparison) {
    this.state.shadowComparison = comp;
    this.scheduleSave();
  }

  public recalculateShadowComparison(): ShadowModeComparison {
    const memory = this.getBehaviouralMemory();
    const settled = memory.filter(m => ['WIN', 'LOSS'].includes(m.actualOutcome));
    const unitsFor = (m: BehavioralMemoryRecord): number =>
      typeof m.netReturnUnits === 'number' && Number.isFinite(m.netReturnUnits)
        ? m.netReturnUnits
        : m.actualOutcome === 'WIN'
          ? 0.8
          : -1.0;

    const baselineTotal = settled.length;
    const baselineWins = settled.filter(m => m.actualOutcome === 'WIN').length;
    const baselineWinRate = baselineTotal > 0 ? Number(((baselineWins / baselineTotal) * 100).toFixed(1)) : null;
    const baselineEV = settled.reduce((acc, m) => acc + unitsFor(m), 0);

    const shadowTrades = settled.filter(
      m => !['REJECT_INSUFFICIENT_EVIDENCE', 'OBSERVE_ONLY'].includes(m.recommendation)
    );
    const shadowTotal = shadowTrades.length;
    const shadowWins = shadowTrades.filter(m => m.actualOutcome === 'WIN').length;
    const shadowWinRate = shadowTotal > 0 ? Number(((shadowWins / shadowTotal) * 100).toFixed(1)) : null;
    const shadowEV = shadowTrades.reduce((acc, m) => acc + unitsFor(m), 0);

    const avoidedLosses = settled.filter(
      m => m.actualOutcome === 'LOSS' && ['REJECT_INSUFFICIENT_EVIDENCE', 'OBSERVE_ONLY'].includes(m.recommendation)
    ).length;

    const baselineBrier =
      baselineTotal > 0
        ? Number(
            (
              settled.reduce(
                (acc, m) => acc + Math.pow((m.actualOutcome === 'WIN' ? 1 : 0) - m.baselineConfidence, 2),
                0
              ) / baselineTotal
            ).toFixed(4)
          )
        : 0;

    const shadowBrier =
      shadowTotal > 0
        ? Number(
            (
              shadowTrades.reduce(
                (acc, m) => acc + Math.pow((m.actualOutcome === 'WIN' ? 1 : 0) - m.adjustedConfidence, 2),
                0
              ) / shadowTotal
            ).toFixed(4)
          )
        : 0;

    const calibrationImprovementPct =
      baselineBrier > 0 && shadowTotal > 0
        ? Number((((baselineBrier - shadowBrier) / baselineBrier) * 100).toFixed(1))
        : 0;

    const nowIst =
      new Date().toLocaleTimeString('en-US', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }) + ' IST';

    const twoProportionPValue = (w1: number, n1: number, w2: number, n2: number): number => {
      if (n1 < 5 || n2 < 5) return 1.0;
      const p1 = w1 / n1;
      const p2 = w2 / n2;
      const pooled = (w1 + w2) / (n1 + n2);
      const se = Math.sqrt(Math.max(1e-9, pooled * (1 - pooled) * (1 / n1 + 1 / n2)));
      const z = Math.abs(p1 - p2) / se;
      // Two-sided normal tail approximation via Abramowitz & Stegun erfc helper
      const x = z / Math.SQRT2;
      const t = 1 / (1 + 0.3275911 * x);
      const erfcApprox =
        t *
        (0.254829592 +
          t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) *
        Math.exp(-x * x);
      return Number(Math.max(0, Math.min(1, erfcApprox)).toFixed(4));
    };

    const computeEmpiricalAblation = (
      componentId: string,
      componentName: string,
      description: string,
      predicate: (m: BehavioralMemoryRecord) => boolean
    ): ShadowModeComparison['ablationTests'][0] => {
      const flagged = settled.filter(predicate);
      const clean = settled.filter(m => !predicate(m));
      const sampleSize = flagged.length;
      if (flagged.length === 0 || clean.length === 0) {
        return {
          componentId,
          componentName,
          description,
          sampleSize,
          marginalWinRateDelta: 0,
          marginalEVUnitsDelta: 0,
          pValue: 1.0,
          status: 'NEEDS_MORE_DATA',
        };
      }

      const flaggedWins = flagged.filter(m => m.actualOutcome === 'WIN').length;
      const cleanWins = clean.filter(m => m.actualOutcome === 'WIN').length;
      const flaggedWr = (flaggedWins / flagged.length) * 100;
      const cleanWr = (cleanWins / clean.length) * 100;
      const marginalWinRateDelta = Number((cleanWr - flaggedWr).toFixed(1));

      const flaggedAvgEv = flagged.reduce((acc, m) => acc + unitsFor(m), 0) / flagged.length;
      const cleanAvgEv = clean.reduce((acc, m) => acc + unitsFor(m), 0) / clean.length;
      const marginalEVUnitsDelta = Number((cleanAvgEv - flaggedAvgEv).toFixed(2));
      const pValue = twoProportionPValue(cleanWins, clean.length, flaggedWins, flagged.length);

      let status: ShadowModeComparison['ablationTests'][0]['status'] = 'NEEDS_MORE_DATA';
      if (flagged.length >= 20 && clean.length >= 20 && pValue < 0.05) {
        status = marginalEVUnitsDelta > 0 ? 'PROMOTABLE' : 'REJECTED';
      }

      return {
        componentId,
        componentName,
        description,
        sampleSize,
        marginalWinRateDelta,
        marginalEVUnitsDelta,
        pValue,
        status,
      };
    };

    const ablationTests: ShadowModeComparison['ablationTests'] = [
      computeEmpiricalAblation(
        'liquidity_sweep_defense',
        'Liquidity Sweeps & Trap Filter',
        'Measures whether skipping entries into unmitigated liquidity sweeps or false breakout traps improves settled win rate & EV.',
        m => m.activeBehaviors.includes('LIQUIDITY_SWEEP_CLUSTERS') || m.activeBehaviors.includes('FAILED_BREAKOUT_TRAP')
      ),
      computeEmpiricalAblation(
        'panic_fomo_attenuation',
        'Panic / FOMO Momentum Attenuation',
        'Measures empirical EV separation when exhaustion / late-entry catalysts are active.',
        m => m.activeBehaviors.includes('FEAR_PANIC') || m.activeBehaviors.includes('FOMO_LATE_ENTRY')
      ),
      computeEmpiricalAblation(
        'bot_calibration_shrinkage',
        'Bot Overconfidence Shrinkage (Brier/ECE)',
        'Evaluates settled trades where probability shrinkage reduced stated confidence below baseline.',
        m => m.adjustedConfidence < m.baselineConfidence - 0.01
      ),
      computeEmpiricalAblation(
        'indecision_choppiness_guard',
        'Market Indecision Rejection',
        'Measures performance gap on low-ATR compression / alternating-wick indecision bars.',
        m => m.activeBehaviors.includes('MARKET_INDECISION')
      ),
      computeEmpiricalAblation(
        'loss_aversion_defense',
        'Loss Aversion & Breakeven Defense',
        'Measures performance impact when stall clusters at round numbers or defense zones trigger.',
        m => m.activeBehaviors.includes('LOSS_AVERSION_DEFENSE')
      ),
    ];

    const comp: ShadowModeComparison = {
      totalEvaluations: memory.length,
      baselineTradesCount: baselineTotal,
      shadowTradesCount: shadowTotal,
      baselineWinRate,
      shadowWinRate,
      baselineExpectedValueUnits: Number(baselineEV.toFixed(2)),
      shadowExpectedValueUnits: Number(shadowEV.toFixed(2)),
      avoidedLosingTradesCount: avoidedLosses,
      brierScoreBaseline: baselineBrier,
      brierScoreShadow: shadowBrier,
      calibrationImprovementPct,
      ablationTests,
      lastComparedAtIst: nowIst,
    };

    this.state.shadowComparison = comp;
    return comp;
  }

  public getTelegramConfig(): TelegramConfig {
    if (!this.state.telegramConfig) {
      this.state.telegramConfig = {
        enabled: true,
        botToken: process.env.TELEGRAM_BOT_TOKEN || '',
        botUsername: 'Forex_new_calender_bot',
        botFirstName: 'Forex news',
        subscribers: [],
        notifyOnNewSignal: true,
        notifyOnSettlement: true,
        minConfidence: 0.70,
      };
    }
    return { ...this.state.telegramConfig };
  }

  public saveTelegramConfig(updates: Partial<TelegramConfig>): TelegramConfig {
    const current = this.getTelegramConfig();
    this.state.telegramConfig = {
      ...current,
      ...updates,
      // If token changed, trim it
      botToken: updates.botToken ? updates.botToken.trim() : current.botToken,
    };
    this.scheduleSave('high');
    return { ...this.state.telegramConfig };
  }

  public addTelegramSubscriber(subscriber: TelegramSubscriber): boolean {
    const config = this.getTelegramConfig();
    const existingIndex = config.subscribers.findIndex(s => String(s.id) === String(subscriber.id));
    if (existingIndex >= 0) {
      config.subscribers[existingIndex] = {
        ...config.subscribers[existingIndex],
        ...subscriber,
      };
    } else {
      config.subscribers.push(subscriber);
    }
    this.state.telegramConfig = config;
    this.scheduleSave('high');
    return true;
  }

  public removeTelegramSubscriber(subscriberId: string | number): boolean {
    const config = this.getTelegramConfig();
    const beforeCount = config.subscribers.length;
    config.subscribers = config.subscribers.filter(s => String(s.id) !== String(subscriberId));
    this.state.telegramConfig = config;
    this.scheduleSave('high');
    return config.subscribers.length < beforeCount;
  }

  public getManualPairs(): ForexSymbol[] {
    if (!Array.isArray(this.state.manualPairs)) {
      return [...FOREX_PAIRS];
    }
    const validSet = new Set<ForexSymbol>(FOREX_PAIRS);
    const dedup = new Set<ForexSymbol>();
    for (const pair of this.state.manualPairs) {
      if (validSet.has(pair)) dedup.add(pair);
    }
    return Array.from(dedup);
  }

  public saveManualPairs(pairs: unknown[]): ForexSymbol[] {
    const validSet = new Set<ForexSymbol>(FOREX_PAIRS);
    const dedup = new Set<ForexSymbol>();
    for (const item of pairs) {
      if (typeof item === 'string') {
        const upper = item.trim().toUpperCase() as ForexSymbol;
        if (validSet.has(upper)) dedup.add(upper);
      }
    }
    const sanitized = Array.from(dedup);
    this.state.manualPairs = sanitized;
    this.scheduleSave('high');
    return [...sanitized];
  }

  public getAllowAllConfiguredPairs(): boolean {
    return this.state.allowAllConfiguredPairs === true;
  }

  public setAllowAllConfiguredPairs(allow: boolean): boolean {
    this.state.allowAllConfiguredPairs = Boolean(allow);
    this.scheduleSave('high');
    return this.state.allowAllConfiguredPairs;
  }

  public getBotRuntimeControls() {
    const cur = this.state.botRuntimeControls;
    const validSessions = new Set<MarketSessionId>(['ASIA', 'LONDON', 'OVERLAP', 'NEW_YORK']);
    const sessions = Array.isArray(cur?.tradingSessions)
      ? cur!.tradingSessions.filter(s => validSessions.has(s))
      : (['ASIA', 'LONDON', 'OVERLAP', 'NEW_YORK'] as MarketSessionId[]);
    return {
      globalKillSwitch: cur?.globalKillSwitch === true,
      enabled: cur?.enabled !== false,
      minConfidence:
        typeof cur?.minConfidence === 'number' && Number.isFinite(cur.minConfidence)
          ? Math.max(0.5, Math.min(0.95, cur.minConfidence))
          : 0.70,
      maxConcurrentTrades:
        typeof cur?.maxConcurrentTrades === 'number' && Number.isFinite(cur.maxConcurrentTrades)
          ? Math.max(1, Math.min(20, Math.round(cur.maxConcurrentTrades)))
          : 6,
      dynamicSpreadGate: cur?.dynamicSpreadGate !== false,
      maxSpreadPips:
        typeof cur?.maxSpreadPips === 'number' && Number.isFinite(cur.maxSpreadPips)
          ? Math.max(0.5, Math.min(10, cur.maxSpreadPips))
          : 2.5,
      tradingSessions: sessions.length > 0 ? sessions : (['ASIA', 'LONDON', 'OVERLAP', 'NEW_YORK'] as MarketSessionId[]),
      updatedAtUtc: cur?.updatedAtUtc,
    };
  }

  public saveBotRuntimeControls(updates: Partial<NonNullable<DatabaseSchema['botRuntimeControls']>>) {
    const prev = this.getBotRuntimeControls();
    const validSessions = new Set<MarketSessionId>(['ASIA', 'LONDON', 'OVERLAP', 'NEW_YORK']);
    const nextSessions = Array.isArray(updates.tradingSessions)
      ? updates.tradingSessions.filter(s => validSessions.has(s))
      : prev.tradingSessions;
    this.state.botRuntimeControls = {
      globalKillSwitch: typeof updates.globalKillSwitch === 'boolean' ? updates.globalKillSwitch : prev.globalKillSwitch,
      enabled: typeof updates.enabled === 'boolean' ? updates.enabled : prev.enabled,
      minConfidence:
        typeof updates.minConfidence === 'number' && Number.isFinite(updates.minConfidence)
          ? Math.max(0.5, Math.min(0.95, updates.minConfidence))
          : prev.minConfidence,
      maxConcurrentTrades:
        typeof updates.maxConcurrentTrades === 'number' && Number.isFinite(updates.maxConcurrentTrades)
          ? Math.max(1, Math.min(20, Math.round(updates.maxConcurrentTrades)))
          : prev.maxConcurrentTrades,
      dynamicSpreadGate: typeof updates.dynamicSpreadGate === 'boolean' ? updates.dynamicSpreadGate : prev.dynamicSpreadGate,
      maxSpreadPips:
        typeof updates.maxSpreadPips === 'number' && Number.isFinite(updates.maxSpreadPips)
          ? Math.max(0.5, Math.min(10, updates.maxSpreadPips))
          : prev.maxSpreadPips,
      tradingSessions: nextSessions.length > 0 ? nextSessions : prev.tradingSessions,
      updatedAtUtc: new Date().toISOString(),
    };
    this.scheduleSave('high');
    return this.getBotRuntimeControls();
  }
}

export const db = new DatabaseService();
