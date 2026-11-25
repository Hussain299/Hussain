import React, { useState, useEffect } from 'react';
import { Header } from './components/Header.tsx';
import { Sidebar, ViewTab } from './components/Sidebar.tsx';
import { OverviewView } from './components/views/OverviewView.tsx';
import { SignalTerminalView } from './components/views/SignalTerminalView.tsx';
import { HistoryView } from './components/views/HistoryView.tsx';
import { AnalyticsView } from './components/views/AnalyticsView.tsx';
import { AccuracyView } from './components/views/AccuracyView.tsx';
import { PortfolioRiskView } from './components/views/PortfolioRiskView.tsx';
import { BrokerConnectionView } from './components/views/BrokerConnectionView.tsx';
import { BrainView } from './components/views/BrainView.tsx';
import { SystemView } from './components/views/SystemView.tsx';
import { ManualControlsView } from './components/views/ManualControlsView.tsx';
import { MarketExplorerView } from './components/views/MarketExplorerView.tsx';
import { ModelLabView } from './components/views/ModelLabView.tsx';
import { StrategyDiscoveryView } from './components/views/StrategyDiscoveryView.tsx';
import { EvolutionLabView } from './components/views/EvolutionLabView.tsx';
import { ResearchAgentsView } from './components/views/ResearchAgentsView.tsx';
import { EntryExitMonitorView } from './components/views/EntryExitMonitorView.tsx';
import { NotificationBanner } from './components/NotificationBanner.tsx';
import { CommandPalette } from './components/common/CommandPalette.tsx';
import {
  AgentReview,
  AppNotification,
  AutopilotLog,
  EvolutionGeneration,
  MarketSessionInfo,
  ProviderHealth,
  ResearchExperiment,
  ResearchSignal,
} from './types/index.ts';
import { useFirebase } from './contexts/FirebaseContext.tsx';
import { requestOlympTradeBridgeStatus } from './services/olympTradeBridge.ts';
import { mergeServerAndCloudSignals, sortSignalsDeterministically } from './utils/signalMerge.ts';

export default function App() {
  const { user, cloudSignals, cloudLedgerReady, syncSignalsToFirestore } = useFirebase();
  const [activeTab, setActiveTab] = useState<ViewTab>('overview');
  const [serverSignals, setServerSignals] = useState<ResearchSignal[]>([]);
  const [serverLoadedOnce, setServerLoadedOnce] = useState(false);
  const [latestPrices, setLatestPrices] = useState<Record<string, number>>({});
  const [marketSessions, setMarketSessions] = useState<MarketSessionInfo[]>([]);
  const [experiments, setExperiments] = useState<ResearchExperiment[]>([]);
  const [reviews, setReviews] = useState<AgentReview[]>([]);
  const [generations, setGenerations] = useState<EvolutionGeneration[]>([]);
  const [providers, setProviders] = useState<ProviderHealth[]>([]);
  const [autopilotLogs, setAutopilotLogs] = useState<AutopilotLog[]>([]);
  const [activeNotification, setActiveNotification] = useState<AppNotification | null>(null);
  const notifiedIdsRef = React.useRef<Set<string>>(new Set());
  const isFetchingRef = React.useRef(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRunningCycle, setIsRunningCycle] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [brokerStatus, setBrokerStatus] = useState<{ mode: string; liveCount: number; pairs?: string[]; reason?: string } | null>(null);

  // Purge legacy localStorage signal snapshots on boot so stale win/loss numbers never flash on refresh
  useEffect(() => {
    try {
      localStorage.removeItem('signalforge_cached_signals');
      localStorage.removeItem('signalforge_cached_prices');
    } catch {}
  }, []);

  // Forward sanitized read-only Olymp Trade companion snapshots to the scheduler while app is open
  useEffect(() => {
    const syncBridgeToServer = async () => {
      try {
        const status = await requestOlympTradeBridgeStatus('GET_STATUS');
        if (!status.extensionInstalled) return;
        const res = await fetch('/api/broker/olymptrade/snapshot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(status),
        });
        if (res.ok) {
          const universe = await res.json();
          if (universe?.mode) setBrokerStatus(universe);
        }
      } catch {
        // Non-fatal: scheduler fails closed when Olymp Trade snapshot is absent/stale
      }
    };
    void syncBridgeToServer();
    const timer = window.setInterval(() => void syncBridgeToServer(), 15_000);
    const onResume = () => {
      if (document.visibilityState === 'visible') {
        void syncBridgeToServer();
      }
    };
    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('focus', onResume);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('focus', onResume);
    };
  }, []);

  // Merge live server signals with persistent Firestore cloud ledger (drops orphaned non-settled zombie docs)
  const signals = React.useMemo(
    () =>
      mergeServerAndCloudSignals(
        serverSignals,
        cloudSignals,
        Boolean(user && cloudLedgerReady),
        serverLoadedOnce
      ),
    [serverSignals, cloudSignals, user, cloudLedgerReady, serverLoadedOnce]
  );

  // Continuously persist newly arrived or settled server signals into Firestore when signed in
  useEffect(() => {
    if (user && cloudLedgerReady && serverSignals.length > 0) {
      void syncSignalsToFirestore(serverSignals);
    }
  }, [user, cloudLedgerReady, serverSignals, syncSignalsToFirestore]);

  const fetchJsonSafely = async (url: string) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 7000);
      const res = await fetch(url, {
        signal: controller.signal,
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
        },
      });
      clearTimeout(timeoutId);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };

  const lastSignalsFingerprintRef = React.useRef<string>('');
  const lastSecondaryFetchMsRef = React.useRef<number>(0);
  const lastFocusSyncMsRef = React.useRef<number>(0);

  const fetchAllData = React.useCallback(async (isManual = false) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    if (isManual) setIsRefreshing(true);
    try {
      const now = Date.now();
      const shouldFetchSecondary = isManual || now - lastSecondaryFetchMsRef.current >= 45_000;

      const [sigRes, autoRes, brokerRes] = await Promise.all([
        fetchJsonSafely('/api/signals'),
        fetchJsonSafely('/api/autopilot/logs'),
        fetchJsonSafely('/api/broker/olymptrade/status'),
      ]);
      if (brokerRes?.mode) setBrokerStatus(brokerRes);

      let histRes: any = null;
      let revRes: any = null;
      let genRes: any = null;
      let healthRes: any = null;
      if (shouldFetchSecondary) {
        lastSecondaryFetchMsRef.current = now;
        [histRes, revRes, genRes, healthRes] = await Promise.all([
          fetchJsonSafely('/api/research/history'),
          fetchJsonSafely('/api/research/agents'),
          fetchJsonSafely('/api/evolution/state'),
          fetchJsonSafely('/api/system/health'),
        ]);
      }

      if (sigRes && Array.isArray(sigRes.signals)) {
        setServerLoadedOnce(true);
        const uniqueSignalsMap = new Map<string, ResearchSignal>();
        for (const sig of sigRes.signals) {
          if (sig && sig.id && !uniqueSignalsMap.has(sig.id)) {
            uniqueSignalsMap.set(sig.id, sig);
          }
        }
        const cleanSignals = sortSignalsDeterministically(Array.from(uniqueSignalsMap.values()));
        const nextFingerprint = cleanSignals
          .map(
            s =>
              `${s.id}:${s.lifecycleState}:${s.outcomeResult}:${s.actualEntryPrice ?? ''}:${s.actualExitPrice ?? ''}:${s.lossAutopsy ? 1 : 0}`
          )
          .join('|');
        if (nextFingerprint !== lastSignalsFingerprintRef.current) {
          lastSignalsFingerprintRef.current = nextFingerprint;
          setServerSignals(cleanSignals);
        }

        if (sigRes.latestPrices && Object.keys(sigRes.latestPrices).length > 0) {
          setLatestPrices(sigRes.latestPrices);
        }
        if (sigRes.sessions && Array.isArray(sigRes.sessions) && sigRes.sessions.length > 0) {
          setMarketSessions(sigRes.sessions);
        }

        // Notify user on fresh signals generated within last 3 minutes (180s)
        const nowMs = Date.now();
        for (const sig of sigRes.signals) {
          if (!sig || !sig.id) continue;
          if (!notifiedIdsRef.current.has(sig.id)) {
            notifiedIdsRef.current.add(sig.id);
            const sigTime = sig.predictionTimeUtc ? Date.parse(sig.predictionTimeUtc) : 0;
            const sigAgeMs = isNaN(sigTime) || sigTime === 0 ? Infinity : nowMs - sigTime;
            if (sigAgeMs <= 180_000 && sig.lifecycleState === 'WAITING_FOR_ENTRY' && sig.brokerEligibility?.mode === 'OLYMP_ACTIVE') {
              setActiveNotification({
                id: `notif_${sig.id}`,
                signalId: sig.id,
                symbol: sig.symbol,
                direction: sig.direction,
                title: `⚡ 3-Min Advance Alert: ${sig.symbol} ${sig.direction} (${sig.direction === 'BUY' ? 'CALL' : 'PUT'})`,
                message: `Entry at candle open: ${sig.candleOpenTimeIst || 'Next 5M'}. Target expiry: ${sig.candleCloseTimeIst || '5 min'}.`,
                timestamp: new Date().toISOString(),
                triggerPrice: sig.triggerPrice,
                expiryMinutes: sig.expiryMinutes || 5,
                read: false,
                candleOpenTimeIst: sig.candleOpenTimeIst,
                candleCloseTimeIst: sig.candleCloseTimeIst,
              });
              break;
            }
          }
        }
      }
      if (histRes?.experiments && histRes.experiments.length > 0) setExperiments(histRes.experiments);
      if (revRes?.reviews && revRes.reviews.length > 0) setReviews(revRes.reviews);
      if (genRes?.generations && genRes.generations.length > 0) setGenerations(genRes.generations);
      if (healthRes?.providers && healthRes.providers.length > 0) setProviders(healthRes.providers);
      if (autoRes?.logs && autoRes.logs.length > 0) setAutopilotLogs(autoRes.logs);
    } catch (err) {
      console.error('Failed to sync SignalForge data safely:', err);
    } finally {
      isFetchingRef.current = false;
      if (isManual) setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAllData(false);
    // Live Autopilot Pulse Stream: 6 second lightweight polling with strict in-flight guard
    const interval = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        fetchAllData(false);
      }
    }, 6000);

    // Debounced re-sync when returning to tab or coming back online (never fires duplicate bursts on reload)
    const handleReFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastFocusSyncMsRef.current < 3000) return;
      lastFocusSyncMsRef.current = now;
      fetchAllData(false);
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleReFocus);
    }
    window.addEventListener('online', handleReFocus);

    return () => {
      clearInterval(interval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleReFocus);
      }
      window.removeEventListener('online', handleReFocus);
    };
  }, [fetchAllData]);

  const handleRunCycle = async () => {
    setIsRunningCycle(true);
    try {
      const res = await fetch('/api/evolution/run', { method: 'POST' });
      if (res.ok) {
        await fetchAllData(true);
      }
    } catch (err) {
      console.error('Failed to run research cycle:', err);
    } finally {
      setIsRunningCycle(false);
    }
  };

  const handleEvaluateSignals = async () => {
    setIsEvaluating(true);
    try {
      const res = await fetch('/api/signals/evaluate', { method: 'POST' });
      if (res.ok) {
        await fetchAllData(true);
      }
    } catch (err) {
      console.error('Failed to evaluate signals:', err);
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleExperimentComplete = (newExp: ResearchExperiment) => {
    setExperiments(prev => [newExp, ...prev]);
    fetchAllData();
  };

  const handleDismissNotification = React.useCallback(() => {
    setActiveNotification(null);
  }, []);

  const handleSelectSignal = React.useCallback(() => {
    setActiveTab('terminal');
  }, []);

  const handleRefreshManual = React.useCallback(() => {
    fetchAllData(true);
  }, [fetchAllData]);

  const activeSignalsCount = signals.filter(s =>
    ['WAITING_FOR_ENTRY', 'ENTRY_TRIGGERED', 'ACTIVE'].includes(s.lifecycleState)
  ).length;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="min-h-screen w-full bg-[#121820] text-[#E8E5DE] antialiased font-sans flex flex-col relative">
      {/* Real-time In-App Signal Alert Banner */}
      <NotificationBanner
        notification={activeNotification}
        onDismiss={handleDismissNotification}
        onSelectSignal={handleSelectSignal}
      />

      {/* Instant Workspace & Signal Command Palette (Ctrl/Cmd+K) */}
      <CommandPalette
        isOpen={isCommandOpen}
        onClose={() => setIsCommandOpen(false)}
        onSelectTab={setActiveTab}
        signals={signals}
        brokerStatus={brokerStatus}
      />

      {/* Top Header with Single-Line Nav & Top Bar Contract */}
      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onRunCycle={handleRunCycle}
        isRunningCycle={isRunningCycle}
        onRefresh={handleRefreshManual}
        isRefreshing={isRefreshing}
        activeSignalsCount={activeSignalsCount}
        onToggleSidebar={() => setIsMobileMenuOpen(prev => !prev)}
        brokerStatus={brokerStatus}
        onOpenCommandPalette={() => setIsCommandOpen(true)}
      />

      {/* Main Content Area — Full-page natural single document flow */}
      <div className="flex-1 w-full min-w-0">
        {/* Navigation Command Drawer */}
        <Sidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          activeSignalsCount={activeSignalsCount}
          totalExperiments={experiments.length}
          isOpen={isMobileMenuOpen}
          onClose={() => setIsMobileMenuOpen(false)}
        />

        {/* Dynamic View Viewport — Full width, zero vertical constraints */}
        <main className="w-full min-w-0 bg-[#121820]">
          {/* 1. OVERVIEW: Bot 1, 2, 3 status, market health, signals, performance */}
          {activeTab === 'overview' && (
            <OverviewView
              signals={signals}
              latestPrices={latestPrices}
              marketSessions={marketSessions}
              providers={providers}
              brokerStatus={brokerStatus}
              onNavigateTab={setActiveTab}
              onEvaluateSignals={handleEvaluateSignals}
              isEvaluating={isEvaluating}
            />
          )}

          {/* 2. SIGNALS: Live command centre with ACTIVE, VERIFYING, WIN, LOSS states */}
          {(activeTab === 'terminal' || activeTab === 'signals') && (
            <SignalTerminalView
              signals={signals}
              latestPrices={latestPrices}
              marketSessions={marketSessions}
              autopilotLogs={autopilotLogs}
              onEvaluateSignals={handleEvaluateSignals}
              isEvaluating={isEvaluating}
            />
          )}

          {/* 3. HISTORY: Searchable and filterable trade ledger */}
          {activeTab === 'history' && (
            <HistoryView signals={signals} onRefresh={fetchAllData} />
          )}

          {/* 4. ANALYTICS: Accurate charts and bot/asset performance */}
          {activeTab === 'analytics' && (
            <AnalyticsView signals={signals} experiments={experiments} />
          )}

          {/* 5. ACCURACY: Verified outcome rates by market session and currency pair */}
          {activeTab === 'accuracy' && <AccuracyView signals={signals} />}
          {activeTab === 'portfolio' && <PortfolioRiskView />}
          {activeTab === 'broker' && <BrokerConnectionView />}

          {/* 5. BRAIN: Research, learning and model intelligence */}
          {(activeTab === 'brain' || activeTab === 'behaviour') && (
            <BrainView onRefresh={fetchAllData} />
          )}

          {/* 6. SYSTEM: Bot health, feeds, scheduler, database and errors */}
          {(activeTab === 'system' || activeTab === 'health') && <SystemView />}

          {/* 7. MANUAL CONTROLS: One compact panel across bots without cross-contamination */}
          {(activeTab === 'controls' || activeTab === 'config') && (
            <ManualControlsView onControlsUpdated={fetchAllData} />
          )}

          {/* SECONDARY QUANTITATIVE LABS */}
          {activeTab === 'explorer' && <MarketExplorerView providers={providers} />}
          {activeTab === 'modellab' && (
            <ModelLabView
              experiments={experiments}
              onExperimentComplete={handleExperimentComplete}
            />
          )}
          {activeTab === 'strategy' && (
            <StrategyDiscoveryView onGoToSignals={() => setActiveTab('terminal')} />
          )}
          {activeTab === 'evolution' && (
            <EvolutionLabView
              generations={generations}
              onTriggerGeneration={handleRunCycle}
              isRunning={isRunningCycle}
            />
          )}
          {activeTab === 'agents' && <ResearchAgentsView reviews={reviews} />}
          {activeTab === 'monitor' && <EntryExitMonitorView signals={signals} />}
        </main>
      </div>
    </div>
  );
}
