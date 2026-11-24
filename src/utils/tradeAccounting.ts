import type { ResearchExperiment, ResearchSignal } from '../types/index.js';

const SETTLED_OUTCOMES = new Set(['WIN', 'LOSS', 'SCRATCH']);
const TERMINAL_UNFILLED_STATES = new Set(['EXPIRED', 'INVALIDATED', 'AMBIGUOUS']);

export function isFilledContract(signal: ResearchSignal): boolean {
  return Number.isFinite(signal.actualEntryPrice) && (signal.actualEntryPrice ?? 0) > 0;
}

export function isSettledOutcome(signal: ResearchSignal): boolean {
  return signal.lifecycleState === 'CLOSED' && SETTLED_OUTCOMES.has(signal.outcomeResult);
}

export function isSettledContract(signal: ResearchSignal): boolean {
  return isFilledContract(signal) &&
    isSettledOutcome(signal) &&
    Number.isFinite(signal.actualExitPrice) &&
    (signal.actualExitPrice ?? 0) > 0 &&
    typeof signal.actualExitTimeUtc === 'string' &&
    Number.isFinite(Date.parse(signal.actualExitTimeUtc));
}

export function isTerminalUnfilledSetup(signal: ResearchSignal): boolean {
  return !isFilledContract(signal) && TERMINAL_UNFILLED_STATES.has(signal.lifecycleState);
}

export function isExpiredUnfilledSetup(signal: ResearchSignal): boolean {
  return !isFilledContract(signal) && signal.lifecycleState === 'EXPIRED';
}

export function getForwardObservations(experiments: ResearchExperiment[]): ResearchExperiment[] {
  const unique = new Map<string, ResearchExperiment>();
  for (const experiment of experiments) {
    if (experiment.experimentType !== 'FORWARD_OBSERVATION' ||
        !experiment.id?.startsWith('exp_forward_') ||
        !SETTLED_OUTCOMES.has(experiment.liveOutcome || '')) continue;
    if (!unique.has(experiment.id)) unique.set(experiment.id, experiment);
  }
  return Array.from(unique.values()).sort((a, b) => {
    const ta = Date.parse(a.valPeriod?.end || a.createdAt || '');
    const tb = Date.parse(b.valPeriod?.end || b.createdAt || '');
    return tb - ta || b.id.localeCompare(a.id);
  });
}

export interface SignalAccountingSummary {
  signalSetups: number;
  filledContracts: number;
  settledContracts: number;
  pendingFilledContracts: number;
  expiredUnfilledSetups: number;
  otherUnfilledSetups: number;
  wins: number;
  losses: number;
  scratches: number;
  scoredOutcomes: number;
  winRate: number | null;
  netReturnUnits: number;
  missingReturnCount: number;
}

export function summarizeSignalAccounting(signals: ResearchSignal[]): SignalAccountingSummary {
  const unique = new Map<string, ResearchSignal>();
  for (const signal of signals) {
    if (signal?.id && !unique.has(signal.id)) unique.set(signal.id, signal);
  }
  const rows = Array.from(unique.values());
  const filled = rows.filter(isFilledContract);
  const settled = filled.filter(isSettledContract);
  const wins = settled.filter(signal => signal.outcomeResult === 'WIN').length;
  const losses = settled.filter(signal => signal.outcomeResult === 'LOSS').length;
  const scratches = settled.filter(signal => signal.outcomeResult === 'SCRATCH').length;
  const scoredOutcomes = wins + losses;
  const returns = settled.map(signal => signal.netReturnUnits)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const netReturnUnits = returns.reduce((sum, value) => sum + value, 0);
  const expiredUnfilledSetups = rows.filter(isExpiredUnfilledSetup).length;

  return {
    signalSetups: rows.length,
    filledContracts: filled.length,
    settledContracts: settled.length,
    pendingFilledContracts: filled.length - settled.length,
    expiredUnfilledSetups,
    otherUnfilledSetups: rows.length - filled.length - expiredUnfilledSetups,
    wins,
    losses,
    scratches,
    scoredOutcomes,
    winRate: scoredOutcomes > 0 ? Number(((wins / scoredOutcomes) * 100).toFixed(1)) : null,
    netReturnUnits: Number(netReturnUnits.toFixed(2)),
    missingReturnCount: settled.length - returns.length,
  };
}

export interface ForwardOutcomeSummary {
  observations: number;
  wins: number;
  losses: number;
  scratches: number;
  scoredOutcomes: number;
  winRate: number | null;
  netReturnUnits: number;
  missingReturnCount: number;
  profitFactor: number | null;
}

export function summarizeForwardObservations(experiments: ResearchExperiment[]): ForwardOutcomeSummary {
  const observations = getForwardObservations(experiments);
  const wins = observations.filter(row => row.liveOutcome === 'WIN').length;
  const losses = observations.filter(row => row.liveOutcome === 'LOSS').length;
  const scratches = observations.filter(row => row.liveOutcome === 'SCRATCH').length;
  const returns = observations.map(row => row.observedNetReturnUnits)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const netReturnUnits = returns.reduce((sum, value) => sum + value, 0);
  const positiveReturns = returns.filter(value => value > 0).reduce((sum, value) => sum + value, 0);
  const negativeReturns = Math.abs(returns.filter(value => value < 0).reduce((sum, value) => sum + value, 0));
  const scoredOutcomes = wins + losses;

  return {
    observations: observations.length,
    wins,
    losses,
    scratches,
    scoredOutcomes,
    winRate: scoredOutcomes > 0 ? Number(((wins / scoredOutcomes) * 100).toFixed(1)) : null,
    netReturnUnits: Number(netReturnUnits.toFixed(2)),
    missingReturnCount: observations.length - returns.length,
    profitFactor: negativeReturns > 0 ? Number((positiveReturns / negativeReturns).toFixed(2)) : positiveReturns > 0 ? null : null,
  };
}
