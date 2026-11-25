/**
 * SignalForge ML — Autonomous Self-Healing Runtime Supervisor
 *
 * Continuously audits runtime invariants and automatically repairs recoverable bugs:
 * 1. Scheduler deadlock & timer drift recovery (isRunningCycle > 75s, dead/drifted 3M timer)
 * 2. Zombie signal & missing netReturnUnits settlement repair
 * 3. Learning-ledger desync repair (forward observations, strategy outcomes, & Council Hedge catch-up)
 * 4. Persisted candle OHLC & synthetic corruption sanitization
 * 5. Orphaned DB temp-file cleanup (*.tmp left behind after unexpected kills)
 * 6. Expired broker snapshot pruning (> 10 minutes stale)
 */

import fs from 'fs';
import path from 'path';
import { ResearchSignal } from '../types/index.js';
import { db } from './db.js';
import { calculateBinarySettlement, DEFAULT_BINARY_PAYOUT_PERCENT } from './binarySettlement.js';
import { multiAgentCouncil } from './multiAgentCouncil.js';
import { autonomousScheduler } from './scheduler.js';

export type SelfHealCheckStatus = 'HEALTHY' | 'REPAIRED' | 'WARNING';

export interface SelfHealRepairEvent {
  id: string;
  timestampUtc: string;
  subsystem:
    | 'SCHEDULER_LOCK'
    | 'ADVANCE_TIMER'
    | 'ZOMBIE_SIGNALS'
    | 'SETTLEMENT_MATH'
    | 'LEARNING_LEDGER'
    | 'CANDLE_INTEGRITY'
    | 'TEMP_FILES'
    | 'BROKER_CACHE';
  issueDetected: string;
  actionTaken: string;
  itemsFixed: number;
}

export interface SelfHealReport {
  status: SelfHealCheckStatus;
  lastScanAtUtc: string;
  totalScansRun: number;
  totalRepairsExecuted: number;
  invariants: Array<{
    name: string;
    status: SelfHealCheckStatus;
    detail: string;
  }>;
  recentRepairs: SelfHealRepairEvent[];
}

const MAX_REPAIR_LOG = 40;
const STALE_WAITING_GRACE_MS = 5 * 60_000;
const STALE_TMP_AGE_MS = 10 * 60_000;
const STALE_BROKER_PRUNE_MS = 10 * 60_000;

export class SelfHealingSupervisor {
  private totalScansRun = 0;
  private totalRepairsExecuted = 0;
  private lastScanAtUtc: string = '';
  private recentRepairs: SelfHealRepairEvent[] = [];
  private latestInvariants: SelfHealReport['invariants'] = [];

  private recordRepair(
    subsystem: SelfHealRepairEvent['subsystem'],
    issueDetected: string,
    actionTaken: string,
    itemsFixed: number
  ) {
    this.totalRepairsExecuted += 1;
    const evt: SelfHealRepairEvent = {
      id: `heal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestampUtc: new Date().toISOString(),
      subsystem,
      issueDetected,
      actionTaken,
      itemsFixed,
    };
    this.recentRepairs.unshift(evt);
    if (this.recentRepairs.length > MAX_REPAIR_LOG) {
      this.recentRepairs = this.recentRepairs.slice(0, MAX_REPAIR_LOG);
    }
    console.warn(`[SelfHealer:${subsystem}] ${issueDetected} -> ${actionTaken} (fixed=${itemsFixed})`);
  }

  /**
   * Executes one deterministic invariant audit & self-repair pass across all runtime subsystems.
   */
  public runDiagnosticAndRepair(nowMs: number = Date.now()): SelfHealReport {
    this.totalScansRun += 1;
    this.lastScanAtUtc = new Date(nowMs).toISOString();
    const invariants: SelfHealReport['invariants'] = [];

    // 1. Scheduler lock & daemon liveness + 3M timer alignment
    const stalledRecovered = autonomousScheduler.recoverIfStalled(nowMs);
    if (stalledRecovered) {
      this.recordRepair(
        'SCHEDULER_LOCK',
        'Sensing cycle lock remained held past 75s threshold.',
        'Released stalled isRunningCycle lock cleanly.',
        1
      );
    }
    const timerRearmed = autonomousScheduler.ensureAdvanceTimerArmed(nowMs);
    if (timerRearmed) {
      this.recordRepair(
        'ADVANCE_TIMER',
        'Precision 3-minute advance timer drifted or was disarmed while scheduler was active.',
        'Re-synchronized 3M advance timer to next 5M candle boundary.',
        1
      );
    }
    invariants.push({
      name: 'Scheduler Execution & 3M Timer',
      status: stalledRecovered || timerRearmed ? 'REPAIRED' : 'HEALTHY',
      detail: autonomousScheduler.isRunning()
        ? stalledRecovered || timerRearmed
          ? 'Auto-recovered scheduler lock/timer alignment.'
          : 'Scheduler loop and 3M timer operating within bounds.'
        : 'Scheduler intentionally stopped or awaiting start().',
    });

    // 2. Zombie unentered signals & closed settlement math repair
    let zombieCount = 0;
    let settlementRepairedCount = 0;
    const allSignals = db.getSignals(false);
    for (const sig of allSignals) {
      if (sig.ruleFamily?.startsWith('test_')) continue;

      // 2a. Waiting setup whose entry window expired >= 5 minutes ago without filling
      if (
        ['WAITING_FOR_ENTRY', 'DETECTED', 'ENTRY_TRIGGERED'].includes(sig.lifecycleState) &&
        sig.actualEntryPrice === null &&
        sig.entryWindowEndUtc
      ) {
        const endMs = Date.parse(sig.entryWindowEndUtc);
        if (Number.isFinite(endMs) && nowMs - endMs > STALE_WAITING_GRACE_MS) {
          sig.lifecycleState = 'EXPIRED';
          sig.outcomeResult = 'CANCELLED';
          sig.lifecycleHistory = Array.isArray(sig.lifecycleHistory) ? sig.lifecycleHistory : [];
          sig.lifecycleHistory.push({
            timestamp: new Date(nowMs).toISOString(),
            fromState: 'WAITING_FOR_ENTRY',
            toState: 'EXPIRED',
            reason: '[SelfHealer] Entry window elapsed without fill confirmation; marked EXPIRED unscored.',
          });
          db.updateSignal(sig);
          zombieCount += 1;
        }
      }

      // 2b. Closed WIN/LOSS trade missing binary netReturnUnits
      if (
        sig.lifecycleState === 'CLOSED' &&
        (sig.outcomeResult === 'WIN' || sig.outcomeResult === 'LOSS' || sig.outcomeResult === 'SCRATCH') &&
        (sig.netReturnUnits === null || sig.netReturnUnits === undefined || !Number.isFinite(sig.netReturnUnits)) &&
        typeof sig.actualEntryPrice === 'number' &&
        typeof sig.actualExitPrice === 'number'
      ) {
        const payout = sig.payoutPct ?? DEFAULT_BINARY_PAYOUT_PERCENT;
        const settlement = calculateBinarySettlement(sig.direction, sig.actualEntryPrice, sig.actualExitPrice, payout);
        sig.netReturnUnits = settlement.netReturnUnits;
        sig.outcomeResult = settlement.outcome;
        db.updateSignal(sig);
        settlementRepairedCount += 1;
      }
    }

    if (zombieCount > 0) {
      this.recordRepair(
        'ZOMBIE_SIGNALS',
        `Detected ${zombieCount} stale unentered setup(s) stuck beyond entry window expiry.`,
        'Transitioned zombie setups to EXPIRED/CANCELLED.',
        zombieCount
      );
    }
    if (settlementRepairedCount > 0) {
      this.recordRepair(
        'SETTLEMENT_MATH',
        `Detected ${settlementRepairedCount} closed signal(s) missing binary netReturnUnits.`,
        'Recomputed deterministic payout settlement units.',
        settlementRepairedCount
      );
    }
    invariants.push({
      name: 'Signal State & Settlement Integrity',
      status: zombieCount + settlementRepairedCount > 0 ? 'REPAIRED' : 'HEALTHY',
      detail:
        zombieCount + settlementRepairedCount > 0
          ? `Repaired ${zombieCount} zombie setup(s) and ${settlementRepairedCount} missing settlement unit(s).`
          : 'All signal states and settled unit returns verified consistent.',
    });

    // 3. Learning ledger desync repair (forward ledger + strategy performance + Multi-Agent Council Hedge catch-up)
    const ledgerRecovery = db.reconcileClosedSignalLearning();
    const councilState = multiAgentCouncil.getState();
    const trainedCouncilSet = new Set(councilState.trainedSignalIds);
    let councilCaughtUp = 0;
    for (const sig of db.getSignals(false)) {
      if (
        sig.lifecycleState === 'CLOSED' &&
        (sig.outcomeResult === 'WIN' || sig.outcomeResult === 'LOSS') &&
        !sig.ruleFamily?.startsWith('test_') &&
        sig.agentDebate &&
        !trainedCouncilSet.has(sig.id)
      ) {
        const res = multiAgentCouncil.trainFromSettledSignal(sig);
        if (res.trained) councilCaughtUp += 1;
      }
    }
    const totalLearningRecovered =
      ledgerRecovery.forwardObservationsRecovered +
      ledgerRecovery.strategyOutcomesRecovered +
      councilCaughtUp;
    if (totalLearningRecovered > 0) {
      this.recordRepair(
        'LEARNING_LEDGER',
        `Found missed closed-loop updates (forward=${ledgerRecovery.forwardObservationsRecovered}, strategy=${ledgerRecovery.strategyOutcomesRecovered}, council=${councilCaughtUp}).`,
        'Reconciled all closed settled outcomes idempotently.',
        totalLearningRecovered
      );
    }
    invariants.push({
      name: 'Closed-Loop Learning Ledger Sync',
      status: totalLearningRecovered > 0 ? 'REPAIRED' : 'HEALTHY',
      detail:
        totalLearningRecovered > 0
          ? `Synced ${totalLearningRecovered} missed closed-loop learning records.`
          : 'Forward ledger, Bandit stats & Council Hedge weights are 100% synced.',
    });

    // 4. Candle corruption / synthetic contamination sanitization
    const badCandlesRemoved = db.sanitizePersistedCandles();
    if (badCandlesRemoved > 0) {
      this.recordRepair(
        'CANDLE_INTEGRITY',
        `Detected ${badCandlesRemoved} invalid/synthetic/corrupt candle row(s) in storage.`,
        'Purged invalid OHLC records while preserving verified history.',
        badCandlesRemoved
      );
    }
    invariants.push({
      name: 'Market Candle Integrity',
      status: badCandlesRemoved > 0 ? 'REPAIRED' : 'HEALTHY',
      detail:
        badCandlesRemoved > 0
          ? `Purged ${badCandlesRemoved} corrupt candle record(s).`
          : 'Zero synthetic or malformed OHLC rows in persisted store.',
    });

    // 5. Orphan DB temp-file cleanup (safe prefix match only)
    let tmpCleaned = 0;
    try {
      const dbPath = db.getDbPath();
      const dir = path.dirname(dbPath);
      const base = path.basename(dbPath);
      if (fs.existsSync(dir)) {
        const entries = fs.readdirSync(dir);
        for (const name of entries) {
          if (name.startsWith(`${base}.`) && name.endsWith('.tmp')) {
            const full = path.join(dir, name);
            try {
              const stat = fs.statSync(full);
              if (nowMs - stat.mtimeMs > STALE_TMP_AGE_MS) {
                fs.rmSync(full, { force: true });
                tmpCleaned += 1;
              }
            } catch {
              // Ignore transient locks
            }
          }
        }
      }
    } catch {
      // Non-fatal
    }
    if (tmpCleaned > 0) {
      this.recordRepair(
        'TEMP_FILES',
        `Found ${tmpCleaned} orphaned atomic-write temp file(s) > 10m old.`,
        'Removed stale .tmp files safely without touching active database.',
        tmpCleaned
      );
    }
    invariants.push({
      name: 'Atomic Storage & Temp Hygiene',
      status: tmpCleaned > 0 ? 'REPAIRED' : 'HEALTHY',
      detail:
        tmpCleaned > 0
          ? `Cleaned ${tmpCleaned} orphaned .tmp file(s).`
          : 'No orphaned database write temp files present.',
    });

    // 6. Expired Olymp Trade broker snapshot memory prune
    let brokerPruned = 0;
    const universe = autonomousScheduler.getActiveTradingUniverse(nowMs);
    if (
      universe.mode === 'OLYMP_STALE' &&
      universe.ageMs !== null &&
      universe.ageMs > STALE_BROKER_PRUNE_MS
    ) {
      autonomousScheduler.clearOlympTradeSnapshot();
      brokerPruned = 1;
      this.recordRepair(
        'BROKER_CACHE',
        `Olymp Trade snapshot expired (${Math.round(universe.ageMs / 1000)}s > 600s stale threshold).`,
        'Pruned stale broker snapshot object; cleanly awaiting fresh companion ping.',
        1
      );
    }
    invariants.push({
      name: 'Broker Bridge Cache Hygiene',
      status: brokerPruned > 0 ? 'REPAIRED' : universe.mode === 'OLYMP_ACTIVE' ? 'HEALTHY' : 'WARNING',
      detail:
        universe.mode === 'OLYMP_ACTIVE'
          ? `Connected & fresh (${universe.liveCount} active pairs).`
          : brokerPruned > 0
            ? 'Pruned expired snapshot >10m old cleanly.'
            : `Fail-closed: ${universe.mode}.`,
    });

    this.latestInvariants = invariants;
    const overallStatus: SelfHealCheckStatus = invariants.some((i) => i.status === 'REPAIRED')
      ? 'REPAIRED'
      : 'HEALTHY';

    return this.getReport(overallStatus);
  }

  public getReport(statusOverride?: SelfHealCheckStatus): SelfHealReport {
    const status =
      statusOverride ||
      (this.latestInvariants.some((i) => i.status === 'REPAIRED') ? 'REPAIRED' : 'HEALTHY');
    return {
      status,
      lastScanAtUtc: this.lastScanAtUtc || new Date().toISOString(),
      totalScansRun: this.totalScansRun,
      totalRepairsExecuted: this.totalRepairsExecuted,
      invariants: this.latestInvariants,
      recentRepairs: this.recentRepairs,
    };
  }
}

export const selfHealingSupervisor = new SelfHealingSupervisor();
