import React, { useEffect, useState } from 'react';
import {
  Sliders,
  Shield,
  CheckCircle2,
  RotateCcw,
  Save,
  Power,
  Zap,
  Globe,
  Brain,
  Gauge,
  Send,
  Layers,
} from 'lucide-react';
import { FOREX_PAIRS, ForexSymbol, MarketSessionId } from '../../types/index.js';
import {
  BOT_DEFINITION,
  getDefaultManualControls,
  loadManualControls,
  ManualControlsState,
  saveManualControls,
} from '../../utils/botControls.js';

interface ManualControlsViewProps {
  onControlsUpdated?: () => void;
}

const ALL_SESSIONS: { id: MarketSessionId; name: string }[] = [
  { id: 'ASIA', name: 'Asian Session (Tokyo)' },
  { id: 'LONDON', name: 'European (London)' },
  { id: 'OVERLAP', name: 'London / NY Overlap' },
  { id: 'NEW_YORK', name: 'American (New York)' },
];

export const ManualControlsView: React.FC<ManualControlsViewProps> = ({ onControlsUpdated }) => {
  const [controls, setControls] = useState<ManualControlsState>(loadManualControls());
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [resetFeedback, setResetFeedback] = useState(false);
  const [serverTradingMode, setServerTradingMode] = useState<'MANUAL_PAIRS' | 'OLYMP_TRADE' | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/bot-controls/pairs')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!active || !data) return;
        if (data.tradingMode === 'MANUAL_PAIRS' || data.tradingMode === 'OLYMP_TRADE') {
          setServerTradingMode(data.tradingMode);
        }
        if (data.tradingMode === 'MANUAL_PAIRS' && Array.isArray(data.pairs)) {
          const validPairs = data.pairs.filter((p: unknown): p is ForexSymbol =>
            typeof p === 'string' && FOREX_PAIRS.includes(p as ForexSymbol)
          );
          setControls(prev => {
            const next: ManualControlsState = {
              ...prev,
              bot: {
                ...prev.bot,
                allowedPairs: validPairs,
              },
            };
            saveManualControls(next);
            return next;
          });
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const syncManualPairsToServer = async (allowedPairs: ForexSymbol[]) => {
    try {
      await fetch('/api/bot-controls/pairs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowedPairs }),
      });
    } catch (e) {
      console.warn('Failed to sync manual pairs to backend:', e);
    }
  };

  const handleSave = async () => {
    saveManualControls(controls);
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 2500);

    await Promise.all([
      syncManualPairsToServer(controls.bot.allowedPairs),
      // Sync telegram threshold to backend
      fetch('/api/telegram/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: controls.telegramBroadcast,
          minConfidence: controls.telegramMinConfidence,
        }),
      }).catch(e => {
        console.warn('Failed to sync telegram settings to backend:', e);
      }),
    ]);

    if (onControlsUpdated) onControlsUpdated();
  };

  const handleResetDefaults = async () => {
    const defaults = getDefaultManualControls();
    setControls(defaults);
    saveManualControls(defaults);
    await syncManualPairsToServer(defaults.bot.allowedPairs);
    setResetFeedback(true);
    setTimeout(() => setResetFeedback(false), 2500);
    if (onControlsUpdated) onControlsUpdated();
  };

  const togglePair = (pair: ForexSymbol) => {
    setControls(prev => {
      const currentPairs = prev.bot.allowedPairs;
      const isAllowed = currentPairs.includes(pair);
      const newPairs = isAllowed
        ? currentPairs.filter(p => p !== pair)
        : [...currentPairs, pair];

      return {
        ...prev,
        bot: {
          ...prev.bot,
          allowedPairs: newPairs,
        },
      };
    });
  };

  const selectAllPairs = () => {
    setControls(prev => ({
      ...prev,
      bot: {
        ...prev.bot,
        allowedPairs: [...FOREX_PAIRS],
      },
    }));
  };

  const deselectAllPairs = () => {
    setControls(prev => ({
      ...prev,
      bot: {
        ...prev.bot,
        allowedPairs: ['EUR/USD', 'GBP/USD'] as ForexSymbol[],
      },
    }));
  };

  const toggleSession = (sessionId: MarketSessionId) => {
    setControls(prev => {
      const currentSessions = prev.bot.tradingSessions || ['ASIA', 'LONDON', 'OVERLAP', 'NEW_YORK'];
      const hasSession = currentSessions.includes(sessionId);
      const newSessions = hasSession
        ? currentSessions.filter(s => s !== sessionId)
        : [...currentSessions, sessionId];

      // Keep at least one session active
      if (newSessions.length === 0) return prev;

      return {
        ...prev,
        bot: {
          ...prev.bot,
          tradingSessions: newSessions,
        },
      };
    });
  };

  const botConfig = controls.bot;

  return (
    <div className="w-full bg-[#121820] text-[#E8E5DE] min-h-screen font-sans pb-24">
      {/* Top Action Bar */}
      <div className="border-b border-[#243040] bg-[#161F2B] px-4 lg:px-8 py-3.5 sticky top-16 z-20">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-[#72A98B]" />
            <span className="text-sm font-black tracking-wide text-[#E8E5DE] uppercase">
              Autonomous Bot Controls &amp; Risk Governance
            </span>
            <span className="text-[#354251]">/</span>
            <span className="text-[#AAB4BF]">
              Unified Institutional Engine Configuration
            </span>
          </div>

          <div className="flex items-center gap-3">
            {savedFeedback && (
              <span className="flex items-center gap-1.5 text-xs text-[#72A98B] font-bold animate-in fade-in">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Saved &amp; Active!</span>
              </span>
            )}
            {resetFeedback && (
              <span className="flex items-center gap-1.5 text-xs text-[#C5A36A] font-bold animate-in fade-in">
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset to Factory Defaults!</span>
              </span>
            )}

            <button
              onClick={handleResetDefaults}
              className="px-3 py-1.5 rounded-md bg-[#121820] hover:bg-[#243040] border border-[#243040] text-[#AAB4BF] hover:text-[#E8E5DE] transition-colors cursor-pointer"
            >
              Reset Defaults
            </button>

            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-[#72A98B] hover:bg-[#72A98B]/90 text-[#121820] font-black transition-all shadow-sm cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save &amp; Apply Filters</span>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-6 space-y-6">
        {/* ------------------------------------------------------------- */}
        {/* SECTION 1: MASTER SAFETY & GLOBAL RISK BAR */}
        {/* ------------------------------------------------------------- */}
        <div className="bg-[#161F2B] border border-[#243040] rounded-xl p-5 sm:p-6 space-y-4 shadow-lg font-mono text-xs">
          <div className="flex flex-wrap items-center justify-between pb-3 border-b border-[#243040] gap-2">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-[#72A98B]" />
              <h2 className="text-base font-bold text-[#E8E5DE] tracking-tight">
                Master Safety &amp; Risk Guardrails
              </h2>
            </div>
            <span className="text-xs text-[#AAB4BF]">
              Real-time capital preservation and emergency circuit-breakers
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Global Killswitch */}
            <div
              className={`p-4 rounded-xl border transition-all ${
                controls.globalKillSwitch
                  ? 'bg-rose-950/30 border-rose-800'
                  : 'bg-[#121820] border-[#243040]'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-[#E8E5DE] text-xs">Emergency Killswitch</span>
                <button
                  onClick={() =>
                    setControls(prev => ({ ...prev, globalKillSwitch: !prev.globalKillSwitch }))
                  }
                  className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                    controls.globalKillSwitch
                      ? 'bg-rose-600 text-white'
                      : 'bg-[#243040] text-[#AAB4BF] hover:text-[#E8E5DE]'
                  }`}
                  title="Toggle Emergency Killswitch"
                >
                  <Power className="w-4 h-4" />
                </button>
              </div>
              <p className="text-[11px] text-[#AAB4BF] leading-relaxed">
                {controls.globalKillSwitch
                  ? 'HALTED: All signal evaluation and execution blocked.'
                  : 'ARMED: Autonomous execution active on live ticks.'}
              </p>
            </div>

            {/* Daily Loss Limit */}
            <div className="p-4 rounded-xl bg-[#121820] border border-[#243040] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[#AAB4BF]">Daily Loss Limit:</span>
                <span className="font-bold text-[#E8E5DE] text-sm tabular-nums">
                  {controls.dailyLossLimitUnits} U
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="20"
                step="0.5"
                value={controls.dailyLossLimitUnits}
                onChange={e =>
                  setControls(prev => ({
                    ...prev,
                    dailyLossLimitUnits: parseFloat(e.target.value),
                  }))
                }
                className="w-full accent-[#72A98B] cursor-pointer"
              />
              <span className="text-[10px] text-[#AAB4BF] block">
                Stops trading if day losses hit this threshold.
              </span>
            </div>

            {/* Max Open Exposure Units */}
            <div className="p-4 rounded-xl bg-[#121820] border border-[#243040] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[#AAB4BF]">Max Open Exposure:</span>
                <span className="font-bold text-[#E8E5DE] text-sm tabular-nums">
                  {controls.maxOpenExposureUnits} U
                </span>
              </div>
              <input
                type="range"
                min="2"
                max="16"
                step="1"
                value={controls.maxOpenExposureUnits}
                onChange={e =>
                  setControls(prev => ({
                    ...prev,
                    maxOpenExposureUnits: parseFloat(e.target.value),
                  }))
                }
                className="w-full accent-[#6C9D91] cursor-pointer"
              />
              <span className="text-[10px] text-[#AAB4BF] block">
                Upper ceiling for concurrent risk across all pairs.
              </span>
            </div>

            {/* Telegram Broadcast Setting */}
            <div className="p-4 rounded-xl bg-[#121820] border border-[#243040] space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#E8E5DE]">
                  <Send className="w-3.5 h-3.5 text-[#6C9D91]" />
                  <span>Telegram Alerting</span>
                </div>
                <button
                  onClick={() =>
                    setControls(prev => ({
                      ...prev,
                      telegramBroadcast: !prev.telegramBroadcast,
                    }))
                  }
                  className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-colors ${
                    controls.telegramBroadcast
                      ? 'bg-[#72A98B]/20 text-[#72A98B] border border-[#72A98B]/40'
                      : 'bg-[#243040] text-[#AAB4BF]'
                  }`}
                >
                  {controls.telegramBroadcast ? 'BROADCASTING' : 'MUTED'}
                </button>
              </div>
              <div className="flex items-center justify-between text-[11px] pt-1">
                <span className="text-[#AAB4BF]">Min Conf:</span>
                <strong className="text-[#C4A574]">
                  {(controls.telegramMinConfidence * 100).toFixed(0)}%
                </strong>
              </div>
              <input
                type="range"
                min="0.5"
                max="0.95"
                step="0.05"
                value={controls.telegramMinConfidence}
                onChange={e =>
                  setControls(prev => ({
                    ...prev,
                    telegramMinConfidence: parseFloat(e.target.value),
                  }))
                }
                className="w-full accent-[#C4A574] cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* SECTION 2: AUTONOMOUS BOT PARAMETERS (UNIFIED ENGINE) */}
        {/* ------------------------------------------------------------- */}
        <div className="bg-[#161F2B] border border-[#243040] rounded-xl p-5 sm:p-6 space-y-5 shadow-lg font-mono text-xs">
          {/* Engine Header & Status */}
          <div className="flex flex-wrap items-center justify-between pb-3 border-b border-[#243040] gap-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#72A98B]/10 border border-[#72A98B]/30 flex items-center justify-center">
                <Brain className="w-4 h-4 text-[#72A98B]" />
              </div>
              <div>
                <h3 className="text-base font-black text-[#E8E5DE] tracking-tight">
                  {BOT_DEFINITION.name}
                </h3>
                <p className="text-xs text-[#AAB4BF]">
                  {BOT_DEFINITION.description}
                </p>
              </div>
            </div>

            {/* Bot Active Switch */}
            <div className="flex items-center gap-3">
              <span className="text-[#AAB4BF]">Engine State:</span>
              <button
                onClick={() =>
                  setControls(prev => ({
                    ...prev,
                    bot: {
                      ...prev.bot,
                      enabled: !prev.bot.enabled,
                    },
                  }))
                }
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors shadow-sm flex items-center gap-1.5 ${
                  botConfig.enabled
                    ? 'bg-[#72A98B] text-[#121820]'
                    : 'bg-[#B7797D] text-[#121820]'
                }`}
              >
                <Power className="w-3.5 h-3.5" />
                <span>{botConfig.enabled ? 'ACTIVE & TRADING' : 'PAUSED'}</span>
              </button>
            </div>
          </div>

          {/* Core Configuration Parameters Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            {/* Minimum Signal Confidence Threshold */}
            <div className="p-4 rounded-xl bg-[#121820] border border-[#243040] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[#AAB4BF] font-semibold">Min Confidence Gate:</span>
                <span className="text-base font-bold text-[#E8E5DE] tabular-nums">
                  {(botConfig.minConfidence * 100).toFixed(0)}%
                </span>
              </div>
              <input
                type="range"
                min="0.5"
                max="0.95"
                step="0.01"
                value={botConfig.minConfidence}
                onChange={e =>
                  setControls(prev => ({
                    ...prev,
                    bot: {
                      ...prev.bot,
                      minConfidence: parseFloat(e.target.value),
                    },
                  }))
                }
                className="w-full accent-[#72A98B] cursor-pointer"
              />
              <span className="text-[10px] text-[#AAB4BF] block">
                Signals below {(botConfig.minConfidence * 100).toFixed(0)}% composite conviction are strictly rejected.
              </span>
            </div>

            {/* Max Concurrent In-Market Trades */}
            <div className="p-4 rounded-xl bg-[#121820] border border-[#243040] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[#AAB4BF] font-semibold">Max Concurrent Trades:</span>
                <span className="text-base font-bold text-[#E8E5DE] tabular-nums">
                  {botConfig.maxConcurrentTrades} slots
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="10"
                step="1"
                value={botConfig.maxConcurrentTrades}
                onChange={e =>
                  setControls(prev => ({
                    ...prev,
                    bot: {
                      ...prev.bot,
                      maxConcurrentTrades: parseInt(e.target.value),
                    },
                  }))
                }
                className="w-full accent-[#6C9D91] cursor-pointer"
              />
              <span className="text-[10px] text-[#AAB4BF] block">
                Maximum active trades held simultaneously across all pairs.
              </span>
            </div>

            {/* Dynamic Spread Gate */}
            <div className="p-4 rounded-xl bg-[#121820] border border-[#243040] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[#AAB4BF] font-semibold">Dynamic Spread Gate:</span>
                <button
                  onClick={() =>
                    setControls(prev => ({
                      ...prev,
                      bot: {
                        ...prev.bot,
                        dynamicSpreadGate: !prev.bot.dynamicSpreadGate,
                      },
                    }))
                  }
                  className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                    botConfig.dynamicSpreadGate
                      ? 'bg-[#72A98B]/20 text-[#72A98B] border border-[#72A98B]/40'
                      : 'bg-[#243040] text-[#AAB4BF]'
                  }`}
                >
                  {botConfig.dynamicSpreadGate ? 'ACTIVE' : 'OFF'}
                </button>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[#AAB4BF]">Max Allowed Spread:</span>
                <strong className="text-[#E8E5DE]">{botConfig.maxSpreadPips || 2.5} pips</strong>
              </div>
              <input
                type="range"
                min="1.0"
                max="5.0"
                step="0.1"
                value={botConfig.maxSpreadPips || 2.5}
                onChange={e =>
                  setControls(prev => ({
                    ...prev,
                    bot: {
                      ...prev.bot,
                      maxSpreadPips: parseFloat(e.target.value),
                    },
                  }))
                }
                className="w-full accent-[#72A98B] cursor-pointer"
              />
              <span className="text-[10px] text-[#AAB4BF] block">
                Rejects trades if live broker bid-ask spread exceeds threshold.
              </span>
            </div>
          </div>

          {/* Secondary Controls: Sessions & Execution Rules */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            {/* Active Trading Sessions */}
            <div className="p-4 rounded-xl bg-[#121820] border border-[#243040] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#E8E5DE] flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-[#6C9D91]" />
                  <span>Permitted Trading Sessions</span>
                </span>
                <span className="text-[10px] text-[#AAB4BF]">
                  {(botConfig.tradingSessions || []).length} / {ALL_SESSIONS.length} Active
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                {ALL_SESSIONS.map(sess => {
                  const isActive = (botConfig.tradingSessions || []).includes(sess.id);
                  return (
                    <button
                      key={sess.id}
                      onClick={() => toggleSession(sess.id)}
                      className={`p-2 rounded-lg border text-left text-[11px] font-bold transition-all cursor-pointer flex items-center justify-between ${
                        isActive
                          ? 'bg-[#161F2B] border-[#72A98B] text-[#72A98B]'
                          : 'bg-[#121820] border-[#243040] text-[#64748B] hover:text-[#AAB4BF]'
                      }`}
                    >
                      <span>{sess.name}</span>
                      <span>{isActive ? '✓' : '—'}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Neural & Confluence Logic Settings */}
            <div className="p-4 rounded-xl bg-[#121820] border border-[#243040] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#E8E5DE] flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-[#C4A574]" />
                  <span>Confluence Engine Architecture</span>
                </span>
                <span className="text-[10px] text-[#72A98B] font-bold">5M Causal Candle Open</span>
              </div>
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between p-2 rounded bg-[#161F2B] border border-[#243040]">
                  <div>
                    <span className="text-xs text-[#E8E5DE] font-semibold block">
                      Neural Policy Weighting
                    </span>
                    <span className="text-[10px] text-[#AAB4BF]">
                      Transformer model directional veto on high uncertainty
                    </span>
                  </div>
                  <button
                    onClick={() =>
                      setControls(prev => ({
                        ...prev,
                        bot: {
                          ...prev.bot,
                          neuralWeighting: !prev.bot.neuralWeighting,
                        },
                      }))
                    }
                    className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                      botConfig.neuralWeighting
                        ? 'bg-[#C4A574]/20 text-[#C4A574] border border-[#C4A574]/40'
                        : 'bg-[#243040] text-[#AAB4BF]'
                    }`}
                  >
                    {botConfig.neuralWeighting ? 'ENABLED' : 'DISABLED'}
                  </button>
                </div>

                <div className="flex items-center justify-between p-2 rounded bg-[#161F2B] border border-[#243040]">
                  <div>
                    <span className="text-xs text-[#E8E5DE] font-semibold block">
                      Take-Profit / Stop-Loss Ratio
                    </span>
                    <span className="text-[10px] text-[#AAB4BF]">
                      TP {botConfig.takeProfitPips || 12}p / SL {botConfig.stopLossPips || 8}p (1.5:1 Target)
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-[#72A98B] font-bold">
                    +1.5 R:R
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Allowed Forex Pairs Matrix */}
          <div className="space-y-3 pt-3 border-t border-[#243040]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-xs font-bold text-[#E8E5DE] block">
                  Permitted Currency Pairs Matrix ({botConfig.allowedPairs.length} / {FOREX_PAIRS.length})
                </span>
                <span className="text-[10px] text-[#AAB4BF]">
                  {serverTradingMode === 'MANUAL_PAIRS'
                    ? 'AI Studio Preview is actively trading on these manual pairs. Click Save & Apply Filters to update.'
                    : serverTradingMode === 'OLYMP_TRADE'
                    ? 'Published Production enforces live Olymp Trade >=80% payout eligibility (manual list acts only as preview config).'
                    : 'The autonomous bot strictly scans, predicts, and executes on active pairs only.'}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={selectAllPairs}
                  className="px-2.5 py-1 rounded bg-[#121820] hover:bg-[#243040] text-[#72A98B] border border-[#243040] text-[11px] font-semibold cursor-pointer"
                >
                  Select All {FOREX_PAIRS.length} Pairs
                </button>
                <button
                  onClick={deselectAllPairs}
                  className="px-2.5 py-1 rounded bg-[#121820] hover:bg-[#243040] text-[#AAB4BF] border border-[#243040] text-[11px] cursor-pointer"
                >
                  Majors Only (EUR/GBP)
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2">
              {FOREX_PAIRS.map(pair => {
                const isSelected = botConfig.allowedPairs.includes(pair);
                return (
                  <button
                    key={pair}
                    onClick={() => togglePair(pair)}
                    className={`py-2 px-3 rounded-lg border text-xs font-bold transition-all cursor-pointer flex items-center justify-between ${
                      isSelected
                        ? 'bg-[#121820] border-[#72A98B] text-[#72A98B]'
                        : 'bg-[#121820] border-[#243040] text-[#64748B] hover:text-[#AAB4BF]'
                    }`}
                  >
                    <span>{pair}</span>
                    <span className="text-[10px]">{isSelected ? '✓' : '+'}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
