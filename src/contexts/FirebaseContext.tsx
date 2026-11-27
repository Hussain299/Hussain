import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from '../firebase.ts';
import { ResearchSignal, SignalDirection, SignalLifecycleState, ForexSymbol, MarketSessionId } from '../types/index.ts';

interface FirebaseContextValue {
  user: User | null;
  authReady: boolean;
  cloudSignals: ResearchSignal[];
  cloudLedgerReady: boolean;
  isSyncingCloud: boolean;
  cloudStatusMessage: string | null;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  syncSignalsToFirestore: (serverSignals: ResearchSignal[]) => Promise<void>;
  deleteClosedSignalsFromFirestore: () => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

const VALID_LIFECYCLE_STATES = new Set<string>([
  'WAITING_FOR_ENTRY',
  'ENTRY_TRIGGERED',
  'ACTIVE',
  'EXIT_PENDING',
  'CLOSED',
  'EXPIRED',
  'INVALIDATED',
  'AMBIGUOUS',
]);

const VALID_OUTCOMES = new Set<string>(['PENDING', 'WIN', 'LOSS', 'SCRATCH', 'CANCELLED']);
const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

function clampStr(val: unknown, maxLen: number, fallback: string): string {
  const s = typeof val === 'string' && val.trim().length > 0 ? val.trim() : fallback;
  return s.slice(0, maxLen);
}

function optionalClampedStr(val: unknown, maxLen: number): string | undefined {
  if (typeof val !== 'string' || val.trim().length === 0) return undefined;
  return val.trim().slice(0, maxLen);
}

function isSettled(sig: { lifecycleState?: string; outcomeResult?: string } | undefined | null): boolean {
  return Boolean(
    sig &&
      sig.lifecycleState === 'CLOSED' &&
      typeof sig.outcomeResult === 'string' &&
      ['WIN', 'LOSS', 'SCRATCH'].includes(sig.outcomeResult)
  );
}

function isPermissionDeniedError(error: unknown): boolean {
  const code = typeof (error as any)?.code === 'string' ? (error as any).code : '';
  const msg = error instanceof Error ? error.message : String(error || '');
  return (
    code === 'permission-denied' ||
    msg.includes('Missing or insufficient permissions') ||
    msg.includes('PERMISSION_DENIED')
  );
}

/**
 * Sanitizes a ResearchSignal into a strict TradeRecord payload conforming 100%
 * to firebase-blueprint.json schema & firestore.rules validation blueprints.
 */
function buildCreateTradePayload(sig: ResearchSignal, ownerId: string): Record<string, unknown> | null {
  if (!sig?.id || !VALID_ID_REGEX.test(sig.id) || !VALID_ID_REGEX.test(ownerId)) {
    return null;
  }
  const direction = sig.direction === 'SELL' ? 'SELL' : 'BUY';
  const lifecycleState = VALID_LIFECYCLE_STATES.has(sig.lifecycleState)
    ? sig.lifecycleState
    : 'WAITING_FOR_ENTRY';
  const outcomeResult = VALID_OUTCOMES.has(sig.outcomeResult) ? sig.outcomeResult : 'PENDING';
  const expiryMinutes = Math.min(240, Math.max(1, Number(sig.expiryMinutes) || 5));
  const confidence = Math.min(1, Math.max(0, Number(sig.confidence) || 0.7));
  const triggerPrice = Number(sig.triggerPrice) > 0 ? Number(sig.triggerPrice) : 1.0;

  const payload: Record<string, unknown> = {
    id: sig.id.slice(0, 128),
    ownerId: ownerId.slice(0, 128),
    symbol: clampStr(sig.symbol, 16, 'EUR/USD'),
    direction,
    ruleFamily: clampStr(sig.ruleFamily, 120, 'momentum_5'),
    strategyName: clampStr(sig.strategyName || sig.ruleFamily, 200, 'SignalForge Strategy'),
    expiryMinutes,
    confidence,
    triggerPrice,
    predictionTimeUtc: clampStr(sig.predictionTimeUtc, 40, new Date().toISOString()),
    predictionTimeIst: clampStr(sig.predictionTimeIst, 40, 'IST'),
    lifecycleState,
    outcomeResult,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (typeof sig.actualEntryPrice === 'number' && Number.isFinite(sig.actualEntryPrice)) {
    payload.actualEntryPrice = sig.actualEntryPrice;
  }
  if (typeof sig.actualExitPrice === 'number' && Number.isFinite(sig.actualExitPrice)) {
    payload.actualExitPrice = sig.actualExitPrice;
  }

  const optStrs: Array<[string, unknown, number]> = [
    ['candleOpenTimeUtc', sig.candleOpenTimeUtc, 40],
    ['candleOpenTimeIst', sig.candleOpenTimeIst, 40],
    ['candleCloseTimeUtc', sig.candleCloseTimeUtc, 40],
    ['candleCloseTimeIst', sig.candleCloseTimeIst, 40],
    ['actualEntryTimeUtc', sig.actualEntryTimeUtc, 40],
    ['actualExitTimeUtc', sig.actualExitTimeUtc, 40],
    ['plannedExitTimeUtc', sig.plannedExitTimeUtc, 40],
    ['marketSession', sig.marketSession, 32],
    ['marketSessionName', sig.marketSessionName, 64],
  ];
  for (const [k, v, maxLen] of optStrs) {
    const clean = optionalClampedStr(v, maxLen);
    if (clean !== undefined) payload[k] = clean;
  }

  if (typeof sig.grossReturnPips === 'number' && Number.isFinite(sig.grossReturnPips)) {
    payload.grossReturnPips = sig.grossReturnPips;
  }
  if (typeof sig.netReturnUnits === 'number' && Number.isFinite(sig.netReturnUnits)) {
    payload.netReturnUnits = sig.netReturnUnits;
  }
  if (typeof sig.payoutPct === 'number' && Number.isFinite(sig.payoutPct)) {
    payload.payoutPct = sig.payoutPct;
  }

  return payload;
}

function buildUpdateTradePayload(sig: ResearchSignal): Record<string, unknown> {
  const lifecycleState = VALID_LIFECYCLE_STATES.has(sig.lifecycleState)
    ? sig.lifecycleState
    : 'ACTIVE';
  const outcomeResult = VALID_OUTCOMES.has(sig.outcomeResult) ? sig.outcomeResult : 'PENDING';

  const updates: Record<string, unknown> = {
    lifecycleState,
    outcomeResult,
    updatedAt: serverTimestamp(),
  };

  if (typeof sig.actualEntryPrice === 'number' && Number.isFinite(sig.actualEntryPrice)) {
    updates.actualEntryPrice = sig.actualEntryPrice;
  }
  if (typeof sig.actualExitPrice === 'number' && Number.isFinite(sig.actualExitPrice)) {
    updates.actualExitPrice = sig.actualExitPrice;
  }
  const actualEntryTimeUtc = optionalClampedStr(sig.actualEntryTimeUtc, 40);
  if (actualEntryTimeUtc !== undefined) updates.actualEntryTimeUtc = actualEntryTimeUtc;
  const actualExitTimeUtc = optionalClampedStr(sig.actualExitTimeUtc, 40);
  if (actualExitTimeUtc !== undefined) updates.actualExitTimeUtc = actualExitTimeUtc;
  const plannedExitTimeUtc = optionalClampedStr(sig.plannedExitTimeUtc, 40);
  if (plannedExitTimeUtc !== undefined) updates.plannedExitTimeUtc = plannedExitTimeUtc;

  if (typeof sig.grossReturnPips === 'number' && Number.isFinite(sig.grossReturnPips)) {
    updates.grossReturnPips = sig.grossReturnPips;
  }
  if (typeof sig.netReturnUnits === 'number' && Number.isFinite(sig.netReturnUnits)) {
    updates.netReturnUnits = sig.netReturnUnits;
  }
  if (typeof sig.payoutPct === 'number' && Number.isFinite(sig.payoutPct)) {
    updates.payoutPct = sig.payoutPct;
  }

  return updates;
}

function mapDocToSignal(data: Record<string, any>): ResearchSignal {
  return {
    id: String(data.id || ''),
    symbol: (data.symbol || 'EUR/USD') as ForexSymbol,
    direction: (data.direction === 'SELL' ? 'SELL' : 'BUY') as SignalDirection,
    ruleFamily: String(data.ruleFamily || 'momentum_5'),
    strategyName: String(data.strategyName || data.ruleFamily || 'SignalForge Strategy'),
    expiryMinutes: Number(data.expiryMinutes) || 5,
    confidence: Number(data.confidence) || 0.7,
    modelVersion: 'firestore-cloud-ledger',
    predictionTimeUtc: String(data.predictionTimeUtc || ''),
    predictionTimeIst: String(data.predictionTimeIst || ''),
    candleOpenTimeUtc: data.candleOpenTimeUtc,
    candleOpenTimeIst: data.candleOpenTimeIst,
    candleCloseTimeUtc: data.candleCloseTimeUtc,
    candleCloseTimeIst: data.candleCloseTimeIst,
    signalCandleTime: String(data.predictionTimeUtc || ''),
    entryCondition: '5M Candle Open Sync',
    calibrationStatus: 'CALIBRATED',
    entryWindowStartUtc: String(data.candleOpenTimeUtc || data.predictionTimeUtc || ''),
    entryWindowEndUtc: String(data.candleCloseTimeUtc || data.predictionTimeUtc || ''),
    triggerPrice: Number(data.triggerPrice) || 0,
    invalidationPrice: Number(data.triggerPrice) || 0,
    actualEntryTimeUtc: data.actualEntryTimeUtc ?? null,
    actualEntryPrice: typeof data.actualEntryPrice === 'number' ? data.actualEntryPrice : null,
    entrySource: 'firestore',
    plannedExitTimeUtc: data.plannedExitTimeUtc ?? null,
    actualExitTimeUtc: data.actualExitTimeUtc ?? null,
    actualExitPrice: typeof data.actualExitPrice === 'number' ? data.actualExitPrice : null,
    lifecycleState: (data.lifecycleState || 'CLOSED') as SignalLifecycleState,
    outcomeResult: (data.outcomeResult || 'PENDING') as ResearchSignal['outcomeResult'],
    grossReturnPips: typeof data.grossReturnPips === 'number' ? data.grossReturnPips : null,
    netReturnPips: null,
    netReturnUnits: typeof data.netReturnUnits === 'number' ? data.netReturnUnits : undefined,
    payoutPct: typeof data.payoutPct === 'number' ? data.payoutPct : 80,
    payoutSource: 'ASSUMED_MINIMUM',
    estimatedSpreadPips: 1.0,
    marketSession: data.marketSession as MarketSessionId | undefined,
    marketSessionName: data.marketSessionName,
    lifecycleHistory: [],
  };
}

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [cloudSignals, setCloudSignals] = useState<ResearchSignal[]>([]);
  const [cloudLedgerReady, setCloudLedgerReady] = useState(false);
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);
  const [cloudStatusMessage, setCloudStatusMessage] = useState<string | null>(null);

  const cloudMapRef = useRef<Map<string, ResearchSignal>>(new Map());
  const syncedStateFingerprintsRef = useRef<Map<string, string>>(new Map());
  const profileReadyRef = useRef<boolean>(false);
  const [profileReady, setProfileReady] = useState<boolean>(false);
  const isSyncRunningRef = useRef<boolean>(false);
  const lastHydratedKeyRef = useRef<string>('');

  const activeUidRef = useRef<string | null>(null);

  const ensureUserProfile = useCallback(async (currentUser: User): Promise<boolean> => {
    const userPath = `users/${currentUser.uid}`;
    try {
      const userRef = doc(db, 'users', currentUser.uid);
      const snap = await getDoc(userRef);
      if (!snap.exists()) {
        await setDoc(userRef, {
          uid: currentUser.uid.slice(0, 128),
          displayName: clampStr(currentUser.displayName || currentUser.email, 100, 'Trader'),
          email: clampStr(currentUser.email, 200, 'trader@signalforge.app'),
          role: 'trader',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      profileReadyRef.current = true;
      setProfileReady(true);
      setCloudStatusMessage(null);
      return true;
    } catch (error) {
      if (isPermissionDeniedError(error)) {
        try {
          handleFirestoreError(error, OperationType.WRITE, userPath);
        } catch {
          setCloudStatusMessage('Cloud ledger write permission check failed; running with local backend ledger.');
        }
      } else {
        // Transient offline/network hiccup — allow automatic retry on snapshot reconnect
        console.warn('[FirebaseContext] Transient profile check error (continuing locally):', error);
        setCloudStatusMessage('Cloud sync temporarily offline; local trade ledger remains active.');
      }
      return false;
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async currentUser => {
      const nextUid = currentUser?.uid || null;
      if (activeUidRef.current !== nextUid) {
        activeUidRef.current = nextUid;
        setCloudSignals([]);
        setCloudLedgerReady(false);
        cloudMapRef.current.clear();
        syncedStateFingerprintsRef.current.clear();
        lastHydratedKeyRef.current = '';
      }

      setUser(currentUser);
      setAuthReady(true);
      profileReadyRef.current = false;
      setProfileReady(false);

      if (!currentUser) {
        setCloudStatusMessage(null);
        return;
      }

      if (!currentUser.emailVerified) {
        setCloudStatusMessage('Please verify your Google account email to enable cloud ledger sync.');
        return;
      }

      await ensureUserProfile(currentUser);
    });

    return () => unsub();
  }, [ensureUserProfile]);

  // Attach real-time Firestore listener ONLY when authenticated and email-verified
  useEffect(() => {
    if (!authReady || !user || !user.emailVerified) return;

    const ledgerPath = `users/${user.uid}/tradeLedger`;
    const ledgerQuery = query(
      collection(db, 'users', user.uid, 'tradeLedger'),
      where('ownerId', '==', user.uid)
    );

    const unsubscribe = onSnapshot(
      ledgerQuery,
      snapshot => {
        if (!profileReadyRef.current) {
          void ensureUserProfile(user);
        }
        const nextList: ResearchSignal[] = [];
        const nextMap = new Map<string, ResearchSignal>();

        snapshot.forEach(docSnap => {
          const mapped = mapDocToSignal(docSnap.data());
          if (mapped.id) {
            nextList.push(mapped);
            nextMap.set(mapped.id, mapped);
            syncedStateFingerprintsRef.current.set(
              mapped.id,
              `${mapped.lifecycleState}|${mapped.outcomeResult}|${mapped.actualEntryPrice ?? ''}|${mapped.actualExitPrice ?? ''}`
            );
          }
        });

        nextList.sort((a, b) => {
          const ta = a.predictionTimeUtc ? Date.parse(a.predictionTimeUtc) : 0;
          const tb = b.predictionTimeUtc ? Date.parse(b.predictionTimeUtc) : 0;
          if (tb !== ta) return tb - ta;
          return b.id.localeCompare(a.id);
        });

        cloudMapRef.current = nextMap;
        setCloudSignals(nextList);
        setCloudLedgerReady(true);
        setCloudStatusMessage(null);

        // Re-hydrate settled trades back to backend container ONCE per unique settled set
        const settled = nextList.filter(s => isSettled(s));
        const hydratedKey = settled.map(s => s.id).sort().join(',');
        if (settled.length > 0 && hydratedKey !== lastHydratedKeyRef.current) {
          lastHydratedKeyRef.current = hydratedKey;
          fetch('/api/signals/hydrate-ledger', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ signals: settled }),
          }).catch(() => {});
        }
      },
      error => {
        if (isPermissionDeniedError(error)) {
          try {
            handleFirestoreError(error, OperationType.LIST, ledgerPath);
          } catch {
            setCloudStatusMessage('Cloud ledger read permission error; using live backend ledger.');
          }
        } else {
          console.warn('[FirebaseContext] Transient snapshot listener error:', error);
          setCloudStatusMessage('Cloud sync reconnecting...');
        }
      }
    );

    return () => unsubscribe();
  }, [authReady, user]);

  const signInWithGoogle = useCallback(async () => {
    try {
      setCloudStatusMessage(null);
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      if (error?.code !== 'auth/popup-closed-by-user') {
        setCloudStatusMessage(error?.message || 'Google sign-in failed.');
      }
    }
  }, []);

  const signOutUser = useCallback(async () => {
    try {
      await signOut(auth);
      setCloudStatusMessage(null);
    } catch (error: any) {
      setCloudStatusMessage(error?.message || 'Sign-out failed.');
    }
  }, []);

  const syncSignalsToFirestore = useCallback(
    async (serverSignals: ResearchSignal[]) => {
      if (!user || !user.emailVerified || !profileReadyRef.current || !cloudLedgerReady) return;
      if (!Array.isArray(serverSignals) || serverSignals.length === 0) return;
      // Strict mutex prevents concurrent reload/poll syncs from issuing duplicate setDoc creates
      if (isSyncRunningRef.current) return;

      isSyncRunningRef.current = true;
      setIsSyncingCloud(true);
      try {
        for (const sig of serverSignals) {
          if (!sig?.id || !VALID_ID_REGEX.test(sig.id)) continue;
          if (sig.ruleFamily?.startsWith('test_')) continue;

          const existingCloud = cloudMapRef.current.get(sig.id);
          const fingerprint = `${sig.lifecycleState}|${sig.outcomeResult}|${sig.actualEntryPrice ?? ''}|${sig.actualExitPrice ?? ''}`;

          // NEVER overwrite or attempt to update an already-settled immutable trade in Firestore!
          if (isSettled(existingCloud)) {
            continue;
          }

          if (syncedStateFingerprintsRef.current.get(sig.id) === fingerprint) {
            continue;
          }

          const docPath = `users/${user.uid}/tradeLedger/${sig.id}`;
          const docRef = doc(db, 'users', user.uid, 'tradeLedger', sig.id);

          try {
            if (!existingCloud) {
              const createPayload = buildCreateTradePayload(sig, user.uid);
              if (createPayload) {
                await setDoc(docRef, createPayload);
                cloudMapRef.current.set(sig.id, sig);
                syncedStateFingerprintsRef.current.set(sig.id, fingerprint);
              }
            } else {
              const updatePayload = buildUpdateTradePayload(sig);
              await updateDoc(docRef, updatePayload);
              cloudMapRef.current.set(sig.id, sig);
              syncedStateFingerprintsRef.current.set(sig.id, fingerprint);
            }
          } catch (error) {
            if (isPermissionDeniedError(error)) {
              // Mark fingerprint so we don't spin endlessly on a rejected doc, while logging structured error
              syncedStateFingerprintsRef.current.set(sig.id, fingerprint);
              try {
                handleFirestoreError(
                  error,
                  existingCloud ? OperationType.UPDATE : OperationType.CREATE,
                  docPath
                );
              } catch {
                // Logged via handleFirestoreError without crashing the entire UI
              }
            } else {
              // Transient offline/network error — abort this batch cleanly and retry on next poll
              console.warn('[FirebaseContext] Transient sync write error (will retry):', error);
              break;
            }
          }
        }
      } finally {
        isSyncRunningRef.current = false;
        setIsSyncingCloud(false);
      }
    },
    [user, cloudLedgerReady, profileReady]
  );

  const deleteClosedSignalsFromFirestore = useCallback(async () => {
    if (!user || !user.emailVerified) return;
    const closedDocs = cloudSignals.filter(s =>
      !['WAITING_FOR_ENTRY', 'ENTRY_TRIGGERED', 'ACTIVE', 'EXIT_PENDING'].includes(s.lifecycleState)
    );
    for (const sig of closedDocs) {
      const docPath = `users/${user.uid}/tradeLedger/${sig.id}`;
      try {
        await deleteDoc(doc(db, 'users', user.uid, 'tradeLedger', sig.id));
        cloudMapRef.current.delete(sig.id);
        syncedStateFingerprintsRef.current.delete(sig.id);
      } catch (error) {
        if (isPermissionDeniedError(error)) {
          try {
            handleFirestoreError(error, OperationType.DELETE, docPath);
          } catch {
            // Logged via handleFirestoreError without crashing UI
          }
        } else {
          console.warn('[FirebaseContext] Transient delete error:', error);
          break;
        }
      }
    }
  }, [user, cloudSignals]);

  return (
    <FirebaseContext.Provider
      value={{
        user,
        authReady,
        cloudSignals,
        cloudLedgerReady,
        isSyncingCloud,
        cloudStatusMessage,
        signInWithGoogle,
        signOutUser,
        syncSignalsToFirestore,
        deleteClosedSignalsFromFirestore,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
};

export function useFirebase(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (!ctx) {
    throw new Error('useFirebase must be used inside FirebaseProvider');
  }
  return ctx;
}
