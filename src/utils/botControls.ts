/**
 * SignalForge ML — Autonomous Trading Bot Manual Controls & Performance Analytics
 * Single unified algorithmic trading bot architecture.
 */

import { ForexSymbol, FOREX_PAIRS, MarketSessionId, ResearchSignal } from '../types/index.js';

export type BotId = 'signalforge_bot' | 'bot_1' | 'bot_2' | 'bot_3';

export interface BotMetadata {
  id: string;
  name: string;
  tagline: string;
  family: string;
  description: string;
  defaultPairs: ForexSymbol[];
  defaultMinConfidence: number;
  defaultMaxTrades: number;
  color: string;
  badgeBg: string;
}

export const BOT_DEFINITION: BotMetadata = {
  id: 'signalforge_bot',
  name: 'SignalForge Autonomous Bot',
  tagline: 'Multi-Strategy Neural Confluence & 5M Causal Execution',
  family: 'Autonomous Quantitative Forex Engine',
  description: 'Self-governing trading bot executing 5M candle open entries using real-time momentum breakouts, mean-reversion liquidity sweeps, and online policy neural networks.',
  defaultPairs: [...FOREX_PAIRS],
  defaultMinConfidence: 0.70,
  defaultMaxTrades: 6,
  color: '#72A98B',
  badgeBg: 'bg-[#72A98B]/15 text-[#72A98B] border-[#72A98B]/30',
};

// Backwards compatibility alias
export const BOT_DEFINITIONS: Record<string, BotMetadata> = {
  signalforge_bot: BOT_DEFINITION,
  bot_1: BOT_DEFINITION,
  bot_2: BOT_DEFINITION,
  bot_3: BOT_DEFINITION,
};

export interface BotFilterConfig {
  enabled: boolean;
  minConfidence: number;
  allowedPairs: ForexSymbol[];
  maxConcurrentTrades: number;
  timeframeMinutes: number;
  tradingSessions: MarketSessionId[];
  riskPerTradeUnits: number;
  stopLossPips: number;
  takeProfitPips: number;
  trendSensitivity?: number;
  dynamicSpreadGate?: boolean;
  maxSpreadPips?: number;
  neuralWeighting?: boolean;
}

export interface ManualControlsState {
  globalKillSwitch: boolean;
  dailyLossLimitUnits: number;
  maxOpenExposureUnits: number;
  telegramBroadcast: boolean;
  telegramMinConfidence: number;
  bot: BotFilterConfig;
  bots?: {
    bot_1: BotFilterConfig;
    bot_2: BotFilterConfig;
    bot_3: BotFilterConfig;
  };
  lastSavedAtIst?: string;
}

const STORAGE_KEY = 'signalforge_manual_controls_v3';

export function getDefaultManualControls(): ManualControlsState {
  const defaultBotConfig: BotFilterConfig = {
    enabled: true,
    minConfidence: 0.70,
    allowedPairs: [...FOREX_PAIRS],
    maxConcurrentTrades: 6,
    timeframeMinutes: 5,
    tradingSessions: ['ASIA', 'LONDON', 'OVERLAP', 'NEW_YORK'],
    riskPerTradeUnits: 1.0,
    stopLossPips: 8.0,
    takeProfitPips: 12.0,
    trendSensitivity: 3,
    dynamicSpreadGate: true,
    maxSpreadPips: 2.5,
    neuralWeighting: true,
  };

  return {
    globalKillSwitch: false,
    dailyLossLimitUnits: 5.0,
    maxOpenExposureUnits: 8.0,
    telegramBroadcast: true,
    telegramMinConfidence: 0.70,
    bot: defaultBotConfig,
    bots: {
      bot_1: defaultBotConfig,
      bot_2: defaultBotConfig,
      bot_3: defaultBotConfig,
    },
    lastSavedAtIst: new Date().toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }) + ' IST',
  };
}

export function loadManualControls(): ManualControlsState {
  if (typeof window === 'undefined') return getDefaultManualControls();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultManualControls();
    const parsed = JSON.parse(raw);
    const defaults = getDefaultManualControls();
    const botConfig = parsed.bot || parsed.bots?.bot_1 || defaults.bot;
    return {
      ...defaults,
      ...parsed,
      bot: { ...defaults.bot, ...botConfig },
      bots: {
        bot_1: { ...defaults.bot, ...botConfig },
        bot_2: { ...defaults.bot, ...botConfig },
        bot_3: { ...defaults.bot, ...botConfig },
      },
    };
  } catch (err) {
    console.error('Failed to parse manual controls from localStorage:', err);
    return getDefaultManualControls();
  }
}

export function saveManualControls(state: ManualControlsState): void {
  if (typeof window === 'undefined') return;
  try {
    const withTimestamp: ManualControlsState = {
      ...state,
      bots: {
        bot_1: state.bot,
        bot_2: state.bot,
        bot_3: state.bot,
      },
      lastSavedAtIst: new Date().toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }) + ' IST',
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(withTimestamp));
  } catch (err) {
    console.error('Failed to save manual controls to localStorage:', err);
  }
}

/**
 * Maps any signal to the unified SignalForge bot
 */
export function getBotForSignal(_signal?: ResearchSignal | null): BotMetadata {
  return BOT_DEFINITION;
}

export interface BotPerformanceSummary {
  totalSignals: number;
  executedTrades: number;
  activeCount: number;
  verifyingCount: number;
  completedTrades: number;
  wins: number;
  losses: number;
  scratches: number;
  winRate: number | null;
  netUnits: number;
  grossPips: number;
  profitFactor: number | null;
  recentSignals: ResearchSignal[];
}

/**
 * Calculates comprehensive real-time performance metrics for the unified SignalForge bot
 */
export function computeBotPerformance(
  _botIdOrSignals: any = 'signalforge_bot',
  optionalSignals?: ResearchSignal[]
): BotPerformanceSummary {
  const signals: ResearchSignal[] = Array.isArray(_botIdOrSignals)
    ? _botIdOrSignals
    : Array.isArray(optionalSignals)
    ? optionalSignals
    : [];

  const safeSignals = signals.filter(Boolean);

  const nowMs = Date.now();
  const activeTrades = safeSignals.filter(s => {
    if (s.lifecycleState !== 'ACTIVE' || s.actualEntryPrice === null) return false;
    const exitMs = s.plannedExitTimeUtc ? Date.parse(s.plannedExitTimeUtc) : 0;
    return exitMs === 0 || nowMs < exitMs;
  });
  const verifyingTrades = safeSignals.filter(s => {
    if (s.actualEntryPrice === null || s.outcomeResult !== 'PENDING') return false;
    const exitMs = s.plannedExitTimeUtc ? Date.parse(s.plannedExitTimeUtc) : 0;
    const isPastExpiry = exitMs > 0 && nowMs >= exitMs;
    return s.lifecycleState === 'EXIT_PENDING' || (s.lifecycleState === 'ACTIVE' && isPastExpiry);
  });
  const completedTrades = safeSignals.filter(
    s => s.lifecycleState === 'CLOSED' && ['WIN', 'LOSS', 'SCRATCH'].includes(s.outcomeResult)
  );

  const wins = completedTrades.filter(s => s.outcomeResult === 'WIN').length;
  const losses = completedTrades.filter(s => s.outcomeResult === 'LOSS').length;
  const scratches = completedTrades.filter(s => s.outcomeResult === 'SCRATCH').length;
  const scored = wins + losses;
  const winRate = scored > 0 ? Number(((wins / scored) * 100).toFixed(1)) : null;

  const netUnits = Number(
    completedTrades.reduce((acc, s) => acc + (s.netReturnUnits || 0), 0).toFixed(2)
  );
  const grossPips = Number(
    completedTrades.reduce((acc, s) => acc + (s.grossReturnPips || 0), 0).toFixed(1)
  );

  // Profit Factor calculation
  const grossProfit = completedTrades
    .filter(s => (s.netReturnUnits || 0) > 0)
    .reduce((sum, s) => sum + (s.netReturnUnits || 0), 0);
  const grossLoss = Math.abs(
    completedTrades
      .filter(s => (s.netReturnUnits || 0) < 0)
      .reduce((sum, s) => sum + (s.netReturnUnits || 0), 0)
  );
  const profitFactor = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? 9.99 : null;

  return {
    totalSignals: safeSignals.length,
    executedTrades: activeTrades.length + verifyingTrades.length + completedTrades.length,
    activeCount: activeTrades.length,
    verifyingCount: verifyingTrades.length,
    completedTrades: completedTrades.length,
    wins,
    losses,
    scratches,
    winRate,
    netUnits,
    grossPips,
    profitFactor,
    recentSignals: safeSignals.slice(0, 10),
  };
}
