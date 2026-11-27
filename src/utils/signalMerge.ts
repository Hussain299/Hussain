import { ResearchSignal } from '../types/index.js';

export function isSettledImmutable(sig?: ResearchSignal | null): boolean {
  return Boolean(
    sig &&
      sig.lifecycleState === 'CLOSED' &&
      ['WIN', 'LOSS', 'SCRATCH'].includes(sig.outcomeResult)
  );
}

export function sortSignalsDeterministically(list: ResearchSignal[]): ResearchSignal[] {
  return [...list].sort((a, b) => {
    const ta = a.predictionTimeUtc ? Date.parse(a.predictionTimeUtc) : 0;
    const tb = b.predictionTimeUtc ? Date.parse(b.predictionTimeUtc) : 0;
    if (tb !== ta) return tb - ta;
    return String(b.id).localeCompare(String(a.id));
  });
}

const ORPHAN_MAX_GRACE_MS = 35 * 60 * 1000;

/**
 * Merges live backend signals with persistent Firestore cloud ledger.
 * Preserves immutable settled outcomes across container restarts, while dropping
 * orphaned non-settled Firestore docs (WAITING_FOR_ENTRY, ACTIVE, EXIT_PENDING, etc.)
 * that no longer exist on the live server or have elapsed past their grace window.
 */
export function mergeServerAndCloudSignals(
  serverSignals: ResearchSignal[],
  cloudSignals: ResearchSignal[],
  includeCloud: boolean,
  serverLoadedOnce: boolean,
  nowMs: number = Date.now()
): ResearchSignal[] {
  const merged = new Map<string, ResearchSignal>();
  const serverIds = new Set<string>();
  for (const ss of serverSignals) {
    if (ss?.id) serverIds.add(ss.id);
  }

  if (includeCloud) {
    for (const cs of cloudSignals) {
      if (!cs?.id) continue;
      if (isSettledImmutable(cs)) {
        merged.set(cs.id, cs);
        continue;
      }
      // Non-settled cloud record: only keep if live server still tracks it,
      // or (prior to initial server load) if it is still within its expiry grace window.
      if (serverIds.has(cs.id)) {
        merged.set(cs.id, cs);
        continue;
      }
      if (!serverLoadedOnce) {
        const refTs =
          Date.parse(
            cs.plannedExitTimeUtc ||
              cs.candleCloseTimeUtc ||
              cs.entryWindowEndUtc ||
              cs.predictionTimeUtc ||
              ''
          ) || 0;
        if (refTs > 0 && nowMs <= refTs + ORPHAN_MAX_GRACE_MS) {
          merged.set(cs.id, cs);
        }
      }
    }
  }

  for (const ss of serverSignals) {
    if (!ss?.id) continue;
    const existing = merged.get(ss.id);
    if (existing && isSettledImmutable(existing) && !isSettledImmutable(ss)) {
      // Cloud holds settled immutable outcome while server copy has not settled yet: keep cloud settlement with rich server metadata
      merged.set(ss.id, {
        ...ss,
        ...existing,
        brokerEligibility: ss.brokerEligibility || existing.brokerEligibility,
        manualPairAuthorization: ss.manualPairAuthorization || existing.manualPairAuthorization,
        agentDebate: ss.agentDebate || existing.agentDebate,
        institutionalRisk: ss.institutionalRisk || existing.institutionalRisk,
        shadowCandidate: ss.shadowCandidate || existing.shadowCandidate,
        trainingAudit: ss.trainingAudit || existing.trainingAudit,
        notes: ss.notes || existing.notes,
        lifecycleHistory:
          ss.lifecycleHistory && ss.lifecycleHistory.length > 0
            ? ss.lifecycleHistory
            : existing.lifecycleHistory,
        lossAutopsy: ss.lossAutopsy || existing.lossAutopsy,
      });
    } else {
      merged.set(ss.id, ss);
    }
  }

  return sortSignalsDeterministically(Array.from(merged.values()));
}
