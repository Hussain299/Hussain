import React, { useState, useEffect } from 'react';
import {
  Brain,
  ShieldAlert,
  TrendingUp,
  Activity,
  Layers,
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Flame,
  Zap,
  Target,
  BarChart2,
  Scale,
  RefreshCw,
  Clock,
  Compass,
  FileText,
  Percent,
  Sliders,
  ChevronRight,
  Info,
} from 'lucide-react';
import {
  FOREX_PAIRS,
  ForexSymbol,
  BehavioralHypothesis,
  BotSelfMonitoringState,
  BehavioralMemoryRecord,
  ShadowModeComparison,
  MarketBehaviorType,
} from '../../types/index.js';

type ActiveSubTab = 'market_psych' | 'bot_auditor' | 'shadow_mode' | 'memory_trail';

const BEHAVIOR_NAMES: Record<MarketBehaviorType, { name: string; tag: string; description: string }> = {
  FEAR_PANIC: {
    name: 'Fear & Panic Liquidation',
    tag: 'Downside Capitulation',
    description: 'Empirically identifies sudden asymmetric downside range expansion with volume surges and severe low-wick exhaustion.',
  },
  GREED_MOMENTUM_CHASING: {
    name: 'Greed & Parabolic Momentum',
    tag: 'Overextended Buying',
    description: 'Measures unsustainable multi-bar acceleration with consecutive bullish closes and extreme standard deviation departures.',
  },
  HERD_CROWDED_POSITIONING: {
    name: 'Herd Mentality & Crowding',
    tag: 'One-Sided Orderflow',
    description: 'Detects unilateral candle alignment where directional volume imbalance reaches crowded retail positioning thresholds.',
  },
  FOMO_LATE_ENTRY: {
    name: 'FOMO & Late Retail Chasing',
    tag: 'Exhaustion Climax',
    description: 'Quantifies late entries entering extended candles characterized by diminishing body size and expanding adverse wicks.',
  },
  LOSS_AVERSION_DEFENSE: {
    name: 'Loss Aversion & Breakeven Defense',
    tag: 'Structural Defense',
    description: 'Measures repetitive price rejection and resting defense clusters around key psychological round numbers.',
  },
  OVERCONFIDENCE_COMPLACENCY: {
    name: 'Overconfidence & Volatility Compression',
    tag: 'Complacency Squeeze',
    description: 'Tracks sub-normal ATR multi-period compression where low historical volatility masks imminent breakout expansion.',
  },
  LIQUIDITY_SWEEP_CLUSTERS: {
    name: 'Liquidity Sweeps & Stop Traps',
    tag: 'Key-Level Stop Hunt',
    description: 'Identifies institutional sweeps that penetrate 20-period swing extremes and immediately reject back within the prior range.',
  },
  CAPITULATION: {
    name: 'Market Capitulation',
    tag: 'Final Exhaustion Flush',
    description: 'Detects extreme volume washouts with maximum wick rejection signaling buyer/seller exhaustion.',
  },
  FAILED_BREAKOUT_TRAP: {
    name: 'Failed Breakout Bull/Bear Trap',
    tag: 'Trapped Traders',
    description: 'Pinpoints aggressive breakouts that fail to produce follow-through closes, leaving momentum chasers trapped offside.',
  },
  MARKET_INDECISION: {
    name: 'Market Indecision & Choppiness',
    tag: 'Directionless Equilibrium',
    description: 'Detects alternating doji candles, dual long wicks, and micro-range compression signaling severe directional noise.',
  },
};

export const BehaviouralIntelligenceView: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<ActiveSubTab>('market_psych');
  const [selectedPair, setSelectedPair] = useState<ForexSymbol>('EUR/USD');
  const [hypotheses, setHypotheses] = useState<BehavioralHypothesis[]>([]);
  const [botHealth, setBotHealth] = useState<BotSelfMonitoringState | null>(null);
  const [memoryRecords, setMemoryRecords] = useState<BehavioralMemoryRecord[]>([]);
  const [shadowComparison, setShadowComparison] = useState<ShadowModeComparison | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [lastRefreshedIst, setLastRefreshedIst] = useState<string>('');

  const fetchData = async () => {
    try {
      // 1. Fetch Behavioral Assessment for selected pair
      const hypRes = await fetch(`/api/behavioural/assessment?symbol=${encodeURIComponent(selectedPair)}`);
      if (hypRes.ok) {
        const hypData = await hypRes.json();
        setHypotheses(hypData.hypotheses || []);
        if (hypData.timestampIst) setLastRefreshedIst(hypData.timestampIst);
      }

      // 2. Fetch Bot Self-Monitoring Auditor State
      const botRes = await fetch('/api/behavioural/bot-auditor');
      if (botRes.ok) {
        const botData = await botRes.json();
        setBotHealth(botData.botHealth || null);
      }

      // 3. Fetch Behavioral Memory Records
      const memRes = await fetch('/api/behavioural/memory');
      if (memRes.ok) {
        const memData = await memRes.json();
        setMemoryRecords(memData.records || []);
      }

      // 4. Fetch Shadow Mode Comparison & Ablation Tests
      const shadowRes = await fetch('/api/behavioural/shadow-comparison');
      if (shadowRes.ok) {
        const shadowData = await shadowRes.json();
        setShadowComparison(shadowData.comparison || null);
      }
    } catch (err) {
      console.error('[BehaviouralIntelligenceView] Error loading data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 6000);
    return () => clearInterval(interval);
  }, [selectedPair]);

  const activeHypothesesCount = hypotheses.filter(h => h.isActive).length;

  return (
    <div className="flex flex-col gap-5 p-4 lg:p-6 max-w-7xl mx-auto w-full text-[#E8E5DE] font-sans pb-16">
      {/* Top Header & Architecture Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-xl bg-[#222B36] border border-[#354251] shadow-md">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#17212D] border border-[#C4A574]/40 flex items-center justify-center text-[#C4A574] shrink-0">
            <Brain className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-[#E8E5DE] font-mono">Behavioural Intelligence &amp; Bot Auditor</h1>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-[#72A98B]/15 text-[#72A98B] border border-[#72A98B]/40">
                SHADOW ENGINE ONLINE
              </span>
            </div>
            <p className="text-xs text-[#AAB4BF] mt-1 max-w-2xl leading-relaxed">
              Empirical market psychology modeling &amp; causal self-monitoring architecture. Audits human liquidity traps,
              algorithmic calibration drift (Brier/ECE), and recency biases across strictly closed candles.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right font-mono">
            <div className="text-[11px] text-[#AAB4BF] flex items-center justify-end gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[#6C9D91]" />
              <span>{lastRefreshedIst || 'Syncing IST...'}</span>
            </div>
            <div className="text-xs text-[#E8E5DE] font-semibold mt-0.5">Timezone: Asia/Kolkata (IST)</div>
          </div>
          <button
            onClick={fetchData}
            className="p-2 rounded-lg bg-[#17212D] hover:bg-[#354251] text-[#AAB4BF] hover:text-[#E8E5DE] border border-[#354251] transition-colors"
            title="Refresh Behavioural Intelligence"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-[#354251] pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveSubTab('market_psych')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
            activeSubTab === 'market_psych'
              ? 'bg-[#222B36] text-[#E8E5DE] border border-[#354251] shadow-sm'
              : 'text-[#AAB4BF] hover:text-[#E8E5DE] hover:bg-[#222B36]/60'
          }`}
        >
          <Activity className="w-3.5 h-3.5 text-[#6C9D91]" />
          <span>Module 1: Market Psychology</span>
          {activeHypothesesCount > 0 && (
            <span className="px-1.5 py-0.2 rounded bg-[#17212D] text-[#6C9D91] border border-[#354251] text-[10px] font-mono">
              {activeHypothesesCount} Active
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveSubTab('bot_auditor')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
            activeSubTab === 'bot_auditor'
              ? 'bg-[#222B36] text-[#E8E5DE] border border-[#354251] shadow-sm'
              : 'text-[#AAB4BF] hover:text-[#E8E5DE] hover:bg-[#222B36]/60'
          }`}
        >
          <Scale className="w-3.5 h-3.5 text-[#C5A36A]" />
          <span>Module 2: Bot Self-Monitoring Auditor</span>
          {botHealth?.confidenceCalibration.calibrationStatus === 'OVERCONFIDENT' && (
            <span className="px-1.5 py-0.2 rounded bg-[#C5A36A]/15 text-[#C5A36A] border border-[#C5A36A]/40 text-[10px] font-mono">
              Shrinkage Active
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveSubTab('shadow_mode')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
            activeSubTab === 'shadow_mode'
              ? 'bg-[#222B36] text-[#E8E5DE] border border-[#354251] shadow-sm'
              : 'text-[#AAB4BF] hover:text-[#E8E5DE] hover:bg-[#222B36]/60'
          }`}
        >
          <Sliders className="w-3.5 h-3.5 text-[#72A98B]" />
          <span>Modules 4 &amp; 5: Shadow Mode &amp; Ablation Tests</span>
          {shadowComparison?.calibrationImprovementPct ? (
            <span className="px-1.5 py-0.2 rounded bg-[#72A98B]/15 text-[#72A98B] border border-[#72A98B]/40 text-[10px] font-mono">
              +{shadowComparison.calibrationImprovementPct}% Brier
            </span>
          ) : null}
        </button>

        <button
          onClick={() => setActiveSubTab('memory_trail')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
            activeSubTab === 'memory_trail'
              ? 'bg-[#222B36] text-[#E8E5DE] border border-[#354251] shadow-sm'
              : 'text-[#AAB4BF] hover:text-[#E8E5DE] hover:bg-[#222B36]/60'
          }`}
        >
          <FileText className="w-3.5 h-3.5 text-[#C4A574]" />
          <span>Module 3: Behavioural Memory Trail</span>
          <span className="px-1.5 py-0.2 rounded bg-[#17212D] text-[#AAB4BF] border border-[#354251] text-[10px] font-mono">
            {memoryRecords.length}
          </span>
        </button>
      </div>

      {/* ========================================================= */}
      {/* SUB-VIEW 1: HUMAN MARKET PSYCHOLOGY (MODULE 1)            */}
      {/* ========================================================= */}
      {activeSubTab === 'market_psych' && (
        <div className="flex flex-col gap-5">
          {/* Forex Pair Selector */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-[#222B36] border border-[#354251]">
            <div className="flex items-center gap-2">
              <Compass className="w-4 h-4 text-[#6C9D91]" />
              <span className="text-xs font-bold text-[#E8E5DE] uppercase tracking-wider font-mono">Select Currency Pair:</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FOREX_PAIRS.map(pair => (
                <button
                  key={pair}
                  onClick={() => setSelectedPair(pair)}
                  className={`px-3 py-1.5 rounded-lg font-mono text-xs font-semibold transition-all ${
                    selectedPair === pair
                      ? 'bg-[#6C9D91]/20 text-[#6C9D91] border border-[#6C9D91]/50 shadow-sm'
                      : 'bg-[#17212D] text-[#AAB4BF] hover:text-[#E8E5DE] border border-[#354251]'
                  }`}
                >
                  {pair}
                </button>
              ))}
            </div>
          </div>

          {/* Pair Context Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-4 rounded-xl bg-[#222B36] border border-[#354251] flex items-center justify-between">
              <div>
                <div className="text-[11px] font-mono text-[#AAB4BF] uppercase">Monitored Pair</div>
                <div className="text-base font-bold text-[#E8E5DE] font-mono mt-0.5">{selectedPair}</div>
              </div>
              <span className="px-2.5 py-1 rounded-md text-xs font-mono bg-[#17212D] text-[#AAB4BF] border border-[#354251]">
                10 Models Active
              </span>
            </div>

            <div className="p-4 rounded-xl bg-[#222B36] border border-[#354251] flex items-center justify-between">
              <div>
                <div className="text-[11px] font-mono text-[#AAB4BF] uppercase">Active Behavioral Catalysts</div>
                <div className="text-base font-bold text-[#72A98B] font-mono mt-0.5">
                  {activeHypothesesCount} of 10 Detected
                </div>
              </div>
              <div className="w-8 h-8 rounded-full bg-[#72A98B]/15 border border-[#72A98B]/40 flex items-center justify-center text-[#72A98B] text-xs font-bold font-mono">
                {activeHypothesesCount}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-[#222B36] border border-[#354251] flex items-center justify-between">
              <div>
                <div className="text-[11px] font-mono text-[#AAB4BF] uppercase">Methodology Standard</div>
                <div className="text-xs font-semibold text-[#E8E5DE] mt-0.5 font-mono">Strict Zero Look-Ahead</div>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#17212D] text-[#6C9D91] border border-[#354251]">
                Causal Closed Candles
              </span>
            </div>
          </div>

          {/* 10 Observable Behavior Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {hypotheses.map(hyp => {
              const meta = BEHAVIOR_NAMES[hyp.type] || {
                name: hyp.name || hyp.type,
                tag: 'Market Psychology',
                description: 'Empirical participant behavior model.',
              };

              const getImplicationBadge = (imp: string) => {
                switch (imp) {
                  case 'BULLISH_EDGE':
                    return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#72A98B]/15 text-[#72A98B] border border-[#72A98B]/40">BULLISH EDGE</span>;
                  case 'BEARISH_EDGE':
                    return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#B7797D]/15 text-[#B7797D] border border-[#B7797D]/40">BEARISH EDGE</span>;
                  case 'HIGH_RISK_FADE':
                    return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#C5A36A]/15 text-[#C5A36A] border border-[#C5A36A]/40">HIGH RISK FADE</span>;
                  case 'STAND_DOWN':
                    return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#17212D] text-[#AAB4BF] border border-[#354251]">STAND DOWN / AVOID</span>;
                  default:
                    return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#17212D] text-[#AAB4BF] border border-[#354251]">NEUTRAL</span>;
                }
              };

              return (
                <div
                  key={hyp.type}
                  className={`p-5 rounded-xl border transition-all ${
                    hyp.isActive
                      ? 'bg-[#222B36] border-[#6C9D91] shadow-md ring-1 ring-[#6C9D91]/20'
                      : 'bg-[#222B36] border-[#354251] opacity-80'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-[#E8E5DE] tracking-tight">{meta.name}</h3>
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#17212D] text-[#AAB4BF] border border-[#354251]">
                          {meta.tag}
                        </span>
                      </div>
                      <p className="text-xs text-[#AAB4BF] mt-1 leading-relaxed">{meta.description}</p>
                    </div>

                    <div className="shrink-0 flex flex-col items-end gap-1.5">
                      {hyp.isActive ? (
                        <span className="px-2.5 py-1 rounded text-[10px] font-mono font-bold bg-[#72A98B]/15 text-[#72A98B] border border-[#72A98B]/40 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#72A98B] animate-ping" />
                          ACTIVE CATALYST
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-[#17212D] text-[#AAB4BF] border border-[#354251]">
                          SUB-THRESHOLD
                        </span>
                      )}
                      {getImplicationBadge(hyp.tradeImplication)}
                    </div>
                  </div>

                  {/* Empirical Measurable Evidence Grid */}
                  <div className="mt-4 pt-3 border-t border-[#354251]">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-[#AAB4BF] font-bold mb-2">
                      Empirical Evidence Metrics (Zero Assumption):
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {hyp.measurableEvidence.map(ev => {
                        const isSatisfied = ev.measuredValue >= ev.threshold;
                        return (
                          <div
                            key={ev.metricName}
                            className={`p-2 rounded-lg border text-xs font-mono flex flex-col justify-between ${
                              isSatisfied
                                ? 'bg-[#17212D] border-[#6C9D91]/40 text-[#E8E5DE]'
                                : 'bg-[#17212D] border-[#354251] text-[#AAB4BF]'
                            }`}
                          >
                            <span className="text-[10px] text-[#AAB4BF]">{ev.metricName}</span>
                            <div className="flex items-baseline justify-between mt-1">
                              <span className={`font-bold ${isSatisfied ? 'text-[#6C9D91]' : 'text-[#E8E5DE]'}`}>
                                {ev.measuredValue.toFixed(ev.unit === 'Ratio' ? 3 : 1)} {ev.unit || ''}
                              </span>
                              <span className="text-[10px] text-[#AAB4BF]">
                                req: {ev.threshold.toFixed(ev.unit === 'Ratio' ? 2 : 1)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Evidence Strength Meter & Plain Language Rationale */}
                  <div className="mt-4 pt-3 border-t border-[#354251] flex flex-col gap-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[11px] font-mono text-[#AAB4BF]">Evidence Conviction Score:</span>
                      <span className="font-mono font-bold text-[#E8E5DE]">
                        {(hyp.evidenceStrength * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-[#17212D] border border-[#354251] overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          hyp.evidenceStrength >= 0.70
                            ? 'bg-[#72A98B]'
                            : hyp.evidenceStrength >= 0.40
                            ? 'bg-[#6C9D91]'
                            : 'bg-[#354251]'
                        }`}
                        style={{ width: `${Math.round(hyp.evidenceStrength * 100)}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-[#AAB4BF] italic mt-1 leading-relaxed">
                      "{hyp.plainLanguageExplanation}"
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* SUB-VIEW 2: BOT PSYCHOLOGY & SELF-MONITORING (MODULE 2)   */}
      {/* ========================================================= */}
      {activeSubTab === 'bot_auditor' && (
        <div className="flex flex-col gap-5">
          {!botHealth ? (
            <div className="p-8 text-center text-[#AAB4BF] font-mono text-xs bg-[#222B36] border border-[#354251] rounded-xl">
              Calculating bot self-monitoring telemetry...
            </div>
          ) : (
            <>
              {/* Calibration & Brier Score Banner */}
              <div className="p-5 rounded-xl bg-[#222B36] border border-[#354251] flex flex-col md:flex-row md:items-center justify-between gap-5">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono uppercase tracking-wider text-[#AAB4BF] font-bold">
                      Confidence Calibration Audit
                    </span>
                    <span
                      className={`px-2.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                        botHealth.confidenceCalibration.calibrationStatus === 'WELL_CALIBRATED'
                          ? 'bg-[#72A98B]/15 text-[#72A98B] border border-[#72A98B]/40'
                          : botHealth.confidenceCalibration.calibrationStatus === 'OVERCONFIDENT'
                          ? 'bg-[#C5A36A]/15 text-[#C5A36A] border border-[#C5A36A]/40'
                          : 'bg-[#6C9D91]/15 text-[#6C9D91] border border-[#6C9D91]/40'
                      }`}
                    >
                      {botHealth.confidenceCalibration.calibrationStatus}
                    </span>
                  </div>
                  <h2 className="text-lg font-bold text-[#E8E5DE] mt-1 font-mono">
                    Brier Score: {botHealth.confidenceCalibration.brierScore.toFixed(4)} · Expected Calibration Error (ECE):{' '}
                    {(botHealth.confidenceCalibration.expectedCalibrationError * 100).toFixed(1)}%
                  </h2>
                  <p className="text-xs text-[#AAB4BF] mt-1 max-w-2xl leading-relaxed">
                    Evaluates mathematical gap between algorithmic confidence p-hat and actual binary realization y in [0, 1].
                    When overconfidence is detected, the Behavioural Layer automatically applies calibrated variance shrinkage.
                  </p>
                </div>

                <div className="flex items-center gap-4 shrink-0 font-mono text-right">
                  <div className="p-3 rounded-lg bg-[#17212D] border border-[#354251]">
                    <div className="text-[10px] text-[#AAB4BF] uppercase">Realized Win Rate</div>
                    <div className="text-base font-bold text-[#72A98B] mt-0.5">
                      {(botHealth.confidenceCalibration.actualRealizedWinRate * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-[#17212D] border border-[#354251]">
                    <div className="text-[10px] text-[#AAB4BF] uppercase">Evaluated Trades</div>
                    <div className="text-base font-bold text-[#E8E5DE] mt-0.5">
                      {botHealth.confidenceCalibration.sampleSize}
                    </div>
                  </div>
                </div>
              </div>

              {/* Empirical Calibration Curve Table */}
              <div className="p-5 rounded-xl bg-[#222B36] border border-[#354251]">
                <h3 className="text-xs font-mono uppercase tracking-wider text-[#E8E5DE] font-bold mb-3 flex items-center gap-2">
                  <BarChart2 className="w-4 h-4 text-[#6C9D91]" />
                  Reliability Diagram &amp; Calibration Bins Table
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead>
                      <tr className="border-b border-[#354251] text-[#AAB4BF]">
                        <th className="py-2.5 px-3">Predicted Confidence Range</th>
                        <th className="py-2.5 px-3">Mean Predicted Prob</th>
                        <th className="py-2.5 px-3">Empirical Win Rate</th>
                        <th className="py-2.5 px-3">Sample Trades</th>
                        <th className="py-2.5 px-3">Calibration Delta</th>
                        <th className="py-2.5 px-3 text-right">Visual Reliability</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#354251] text-[#E8E5DE]">
                      {botHealth.confidenceCalibration.calibrationBins.map(bin => {
                        const delta = bin.observedWinRate - bin.meanPredictedProbability;
                        const isClose = Math.abs(delta) <= 0.08;
                        return (
                          <tr key={bin.binRange} className="hover:bg-[#17212D]/50 transition-colors">
                            <td className="py-2.5 px-3 font-bold text-[#E8E5DE]">{bin.binRange}</td>
                            <td className="py-2.5 px-3">{(bin.meanPredictedProbability * 100).toFixed(1)}%</td>
                            <td className="py-2.5 px-3">
                              <span
                                className={`font-bold ${
                                  bin.observedWinRate >= bin.meanPredictedProbability
                                    ? 'text-[#72A98B]'
                                    : 'text-[#B7797D]'
                                }`}
                              >
                                {(bin.observedWinRate * 100).toFixed(1)}%
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-[#AAB4BF]">{bin.tradeCount} trades</td>
                            <td className="py-2.5 px-3">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] ${
                                  isClose
                                    ? 'bg-[#17212D] text-[#AAB4BF] border border-[#354251]'
                                    : delta < 0
                                    ? 'bg-[#C5A36A]/15 text-[#C5A36A] border border-[#C5A36A]/40'
                                    : 'bg-[#72A98B]/15 text-[#72A98B] border border-[#72A98B]/40'
                                }`}
                              >
                                {delta > 0 ? '+' : ''}
                                {(delta * 100).toFixed(1)}%
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <div className="w-32 h-2 rounded-full bg-[#17212D] border border-[#354251] ml-auto overflow-hidden flex">
                                <div
                                  className="h-full bg-[#72A98B] rounded-full"
                                  style={{ width: `${Math.min(100, Math.round(bin.observedWinRate * 100))}%` }}
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 6 Core Algorithmic Weakness Audits */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* 1. Recency Bias Index */}
                <div className="p-4 rounded-xl bg-[#222B36] border border-[#354251] flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono uppercase text-[#AAB4BF] font-bold">1. Recency Bias</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                          botHealth.recencyBiasIndex.isBiased
                            ? 'bg-[#C5A36A]/15 text-[#C5A36A] border border-[#C5A36A]/40'
                            : 'bg-[#17212D] text-[#AAB4BF] border border-[#354251]'
                        }`}
                      >
                        {botHealth.recencyBiasIndex.isBiased ? 'ACTIVE BIAS' : 'BALANCED'}
                      </span>
                    </div>
                    <div className="mt-2">
                      <div className="text-sm font-bold text-[#E8E5DE]">
                        Streak: {botHealth.recencyBiasIndex.streakLength} {botHealth.recencyBiasIndex.streakType}S
                      </div>
                      <p className="text-xs text-[#AAB4BF] mt-1 leading-relaxed">
                        Measures whether recent streak outcomes disproportionately inflate or depress future signal confidence.
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-[#354251] flex items-center justify-between font-mono text-xs">
                    <span className="text-[#AAB4BF]">Distortion Factor:</span>
                    <span className="font-bold text-[#E8E5DE]">
                      {botHealth.recencyBiasIndex.distortionFactor.toFixed(2)}x
                    </span>
                  </div>
                </div>

                {/* 2. Confirmation Bias Audit */}
                <div className="p-4 rounded-xl bg-[#222B36] border border-[#354251] flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono uppercase text-[#AAB4BF] font-bold">2. Confirmation Bias</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                          botHealth.confirmationBiasAudit.status === 'ELEVATED_CONFIRMATION_BIAS'
                            ? 'bg-[#B7797D]/15 text-[#B7797D] border border-[#B7797D]/40'
                            : 'bg-[#17212D] text-[#AAB4BF] border border-[#354251]'
                        }`}
                      >
                        {botHealth.confirmationBiasAudit.status === 'ELEVATED_CONFIRMATION_BIAS' ? 'ELEVATED' : 'OPTIMAL'}
                      </span>
                    </div>
                    <div className="mt-2">
                      <div className="text-sm font-bold text-[#E8E5DE]">
                        Trend Contradiction: {(botHealth.confirmationBiasAudit.contradictionRate * 100).toFixed(0)}%
                      </div>
                      <p className="text-xs text-[#AAB4BF] mt-1 leading-relaxed">
                        Evaluates whether signals are generated counter to dominant higher-timeframe orderflow without reversal confirmation.
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-[#354251] flex items-center justify-between font-mono text-xs">
                    <span className="text-[#AAB4BF]">Counter-Trend Count:</span>
                    <span className="font-bold text-[#E8E5DE]">
                      {botHealth.confirmationBiasAudit.trendCounterTradesCount} trades
                    </span>
                  </div>
                </div>

                {/* 3. Overtrading & Frequency Burst */}
                <div className="p-4 rounded-xl bg-[#222B36] border border-[#354251] flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono uppercase text-[#AAB4BF] font-bold">3. Overtrading Burst</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                          botHealth.overtradingMetrics.isOvertrading
                            ? 'bg-[#B7797D]/15 text-[#B7797D] border border-[#B7797D]/40'
                            : 'bg-[#72A98B]/15 text-[#72A98B] border border-[#72A98B]/40'
                        }`}
                      >
                        {botHealth.overtradingMetrics.isOvertrading ? 'THROTTLED' : 'OPTIMAL'}
                      </span>
                    </div>
                    <div className="mt-2">
                      <div className="text-sm font-bold text-[#E8E5DE]">
                        {botHealth.overtradingMetrics.signalsPastHour} Signals / Last Hour
                      </div>
                      <p className="text-xs text-[#AAB4BF] mt-1 leading-relaxed">
                        Hourly throttle ceiling is {botHealth.overtradingMetrics.hourlyThreshold} signals to prevent revenge trading or over-exposure.
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-[#354251] flex items-center justify-between font-mono text-xs">
                    <span className="text-[#AAB4BF]">Frequency Penalty:</span>
                    <span className="font-bold text-[#E8E5DE]">
                      -{(botHealth.overtradingMetrics.burstFrequencyPenalty * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>

                {/* 4. Repeated Loss Vulnerability */}
                <div className="p-4 rounded-xl bg-[#222B36] border border-[#354251] flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono uppercase text-[#AAB4BF] font-bold">4. Failure Clusters</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#17212D] text-[#AAB4BF] border border-[#354251]">
                        {botHealth.repeatedFailureVulnerability.clusterCentroidMatches.length} Matches
                      </span>
                    </div>
                    <div className="mt-2">
                      <div className="text-sm font-bold text-[#E8E5DE]">
                        Vulnerability Score: {(botHealth.repeatedFailureVulnerability.vulnerabilityIndex * 100).toFixed(0)}%
                      </div>
                      <p className="text-xs text-[#AAB4BF] mt-1 leading-relaxed">
                        Matches live market setups against past loss autopsy clusters to avoid repeating identical failure modes.
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-[#354251] flex flex-col gap-1 text-[11px] font-mono">
                    {botHealth.repeatedFailureVulnerability.clusterCentroidMatches.slice(0, 2).map(c => (
                      <div key={c.clusterName} className="flex items-center justify-between text-[#AAB4BF]">
                        <span className="truncate max-w-[140px]">{c.clusterName}</span>
                        <span className="text-[#B7797D] font-bold">{(c.historicalLossRate * 100).toFixed(0)}% Loss</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 5. CUSUM Strategy Deterioration */}
                <div className="p-4 rounded-xl bg-[#222B36] border border-[#354251] flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono uppercase text-[#AAB4BF] font-bold">5. CUSUM Drift</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                          botHealth.strategyDeterioration.deterioratingCount > 0
                            ? 'bg-[#C5A36A]/15 text-[#C5A36A] border border-[#C5A36A]/40'
                            : 'bg-[#72A98B]/15 text-[#72A98B] border border-[#72A98B]/40'
                        }`}
                      >
                        {botHealth.strategyDeterioration.deterioratingCount > 0
                          ? `${botHealth.strategyDeterioration.deterioratingCount} Decaying`
                          : 'STABLE'}
                      </span>
                    </div>
                    <div className="mt-2">
                      <div className="text-sm font-bold text-[#E8E5DE]">
                        Monitored: {botHealth.strategyDeterioration.monitoredCount} Strategies
                      </div>
                      <p className="text-xs text-[#AAB4BF] mt-1 leading-relaxed">
                        Page's CUSUM sequential test detects structural alpha decay and automatically quarantines degrading models.
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-[#354251] text-[11px] font-mono text-[#AAB4BF]">
                    Status: {botHealth.strategyDeterioration.deterioratingCount === 0 ? 'All models passing CUSUM bounds' : 'Quarantine active'}
                  </div>
                </div>

                {/* 6. Excessive Dependence (HHI) */}
                <div className="p-4 rounded-xl bg-[#222B36] border border-[#354251] flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono uppercase text-[#AAB4BF] font-bold">6. Concentration HHI</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                          botHealth.excessiveDependenceHHI.concentrationRisk === 'DIVERSIFIED'
                            ? 'bg-[#72A98B]/15 text-[#72A98B] border border-[#72A98B]/40'
                            : 'bg-[#C5A36A]/15 text-[#C5A36A] border border-[#C5A36A]/40'
                        }`}
                      >
                        {botHealth.excessiveDependenceHHI.concentrationRisk}
                      </span>
                    </div>
                    <div className="mt-2">
                      <div className="text-sm font-bold text-[#E8E5DE]">
                        HHI Index: {botHealth.excessiveDependenceHHI.hhiScore} / 10,000
                      </div>
                      <p className="text-xs text-[#AAB4BF] mt-1 leading-relaxed">
                        Herfindahl-Hirschman Index measures reliance on a single rule or strategy family to prevent single-point failure.
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-[#354251] flex items-center justify-between font-mono text-xs">
                    <span className="text-[#AAB4BF]">Dominant Strategy:</span>
                    <span className="font-bold text-[#E8E5DE] truncate max-w-[150px]">
                      {botHealth.excessiveDependenceHHI.dominantStrategy}
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* SUB-VIEW 3: SHADOW MODE & RESEARCH ABLATION (MODULES 4 & 5)*/}
      {/* ========================================================= */}
      {activeSubTab === 'shadow_mode' && (
        <div className="flex flex-col gap-5">
          {!shadowComparison ? (
            <div className="p-8 text-center text-[#AAB4BF] font-mono text-xs bg-[#222B36] border border-[#354251] rounded-xl">
              Synthesizing shadow mode experimentation data...
            </div>
          ) : (
            <>
              {/* Shadow vs Baseline Comparison Banner */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="p-4 rounded-xl bg-[#222B36] border border-[#354251] flex flex-col justify-between">
                  <span className="text-[11px] font-mono text-[#AAB4BF] uppercase">Baseline Win Rate</span>
                  <div className="text-xl font-bold font-mono text-[#E8E5DE] mt-1">
                    {shadowComparison.baselineWinRate ? `${shadowComparison.baselineWinRate}%` : 'Evaluating'}
                  </div>
                  <span className="text-[10px] font-mono text-[#AAB4BF] mt-1">
                    {shadowComparison.baselineTradesCount} trades
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-[#222B36] border border-[#6C9D91]/50 flex flex-col justify-between ring-1 ring-[#6C9D91]/20">
                  <span className="text-[11px] font-mono text-[#6C9D91] uppercase">Shadow Model Win Rate</span>
                  <div className="text-xl font-bold font-mono text-[#6C9D91] mt-1">
                    {shadowComparison.shadowWinRate ? `${shadowComparison.shadowWinRate}%` : 'Evaluating'}
                  </div>
                  <span className="text-[10px] font-mono text-[#AAB4BF] mt-1">
                    {shadowComparison.shadowTradesCount} trades
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-[#222B36] border border-[#354251] flex flex-col justify-between">
                  <span className="text-[11px] font-mono text-[#AAB4BF] uppercase">Avoided Losing Trades</span>
                  <div className="text-xl font-bold font-mono text-[#72A98B] mt-1">
                    {shadowComparison.avoidedLosingTradesCount} Trades
                  </div>
                  <span className="text-[10px] font-mono text-[#AAB4BF] mt-1">
                    Rejected before loss execution
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-[#222B36] border border-[#354251] flex flex-col justify-between">
                  <span className="text-[11px] font-mono text-[#AAB4BF] uppercase">Brier Improvement</span>
                  <div className="text-xl font-bold font-mono text-[#72A98B] mt-1">
                    +{shadowComparison.calibrationImprovementPct}%
                  </div>
                  <span className="text-[10px] font-mono text-[#AAB4BF] mt-1">
                    {shadowComparison.brierScoreBaseline} → {shadowComparison.brierScoreShadow}
                  </span>
                </div>
              </div>

              {/* Research Ablation Studies Table */}
              <div className="p-5 rounded-xl bg-[#222B36] border border-[#354251]">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                  <div>
                    <h3 className="text-xs font-mono uppercase tracking-wider text-[#E8E5DE] font-bold flex items-center gap-2">
                      <Sliders className="w-4 h-4 text-[#6C9D91]" />
                      Research Feature Ablation Studies (Walk-Forward Isolation)
                    </h3>
                    <p className="text-xs text-[#AAB4BF] mt-0.5">
                      Empirically tests marginal predictive contribution of each behavioral component.
                      Components are promoted ONLY when p &lt; 0.05 with positive marginal EV.
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded-md text-[10px] font-mono bg-[#17212D] text-[#AAB4BF] border border-[#354251]">
                    5 Components Monitored
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead>
                      <tr className="border-b border-[#354251] text-[#AAB4BF]">
                        <th className="py-2.5 px-3">Behavioral Component</th>
                        <th className="py-2.5 px-3">Description</th>
                        <th className="py-2.5 px-3">Sample Size</th>
                        <th className="py-2.5 px-3">Δ Win Rate</th>
                        <th className="py-2.5 px-3">Δ EV (Units)</th>
                        <th className="py-2.5 px-3">p-Value</th>
                        <th className="py-2.5 px-3 text-right">Promotion Verdict</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#354251] text-[#E8E5DE]">
                      {shadowComparison.ablationTests.map(test => (
                        <tr key={test.componentId} className="hover:bg-[#17212D]/50 transition-colors">
                          <td className="py-2.5 px-3 font-bold text-[#E8E5DE]">{test.componentName}</td>
                          <td className="py-2.5 px-3 text-[#AAB4BF] max-w-xs">{test.description}</td>
                          <td className="py-2.5 px-3 text-[#AAB4BF]">{test.sampleSize} trades</td>
                          <td className="py-2.5 px-3 text-[#72A98B] font-bold">
                            +{test.marginalWinRateDelta.toFixed(1)}%
                          </td>
                          <td className="py-2.5 px-3 text-[#6C9D91] font-bold">
                            +{test.marginalEVUnitsDelta.toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] ${
                                test.pValue < 0.05
                                  ? 'bg-[#72A98B]/15 text-[#72A98B] border border-[#72A98B]/40'
                                  : 'bg-[#17212D] text-[#AAB4BF] border border-[#354251]'
                              }`}
                            >
                              p = {test.pValue.toFixed(3)}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                test.status === 'PROMOTABLE'
                                  ? 'bg-[#72A98B]/15 text-[#72A98B] border border-[#72A98B]/40'
                                  : 'bg-[#C5A36A]/15 text-[#C5A36A] border border-[#C5A36A]/40'
                              }`}
                            >
                              {test.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* SUB-VIEW 4: BEHAVIOURAL MEMORY TRAIL (MODULE 3)           */}
      {/* ========================================================= */}
      {activeSubTab === 'memory_trail' && (
        <div className="flex flex-col gap-4">
          <div className="p-4 rounded-xl bg-[#222B36] border border-[#354251] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-mono uppercase tracking-wider text-[#E8E5DE] font-bold flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#C4A574]" />
                Persistent Auditable Behavioural Memory Stream
              </h3>
              <p className="text-xs text-[#AAB4BF] mt-0.5">
                Every prediction, its activated hypotheses, empirical evidence snapshots, shadow recommendations, and verified outcomes.
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-md text-[10px] font-mono bg-[#17212D] text-[#AAB4BF] border border-[#354251]">
              {memoryRecords.length} Audited Records
            </span>
          </div>

          {memoryRecords.length === 0 ? (
            <div className="p-10 text-center rounded-xl bg-[#222B36] border border-[#354251] text-[#AAB4BF] font-mono text-xs">
              No behavioural memory records yet. Records are generated dynamically on every 3-minute advance signal pulse.
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {memoryRecords.map(rec => {
                const isWin = rec.actualOutcome === 'WIN';
                const isLoss = rec.actualOutcome === 'LOSS';
                const isPending = rec.actualOutcome === 'PENDING';

                const getRecBadge = (recType: string) => {
                  switch (recType) {
                    case 'SUPPORT':
                      return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#72A98B]/15 text-[#72A98B] border border-[#72A98B]/40">SUPPORT</span>;
                    case 'REDUCE_CONFIDENCE':
                      return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#C5A36A]/15 text-[#C5A36A] border border-[#C5A36A]/40">REDUCE CONF</span>;
                    case 'FLAG_UNCERTAINTY':
                      return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#6C9D91]/15 text-[#6C9D91] border border-[#6C9D91]/40">FLAG UNCERTAIN</span>;
                    case 'REJECT_INSUFFICIENT_EVIDENCE':
                      return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#B7797D]/15 text-[#B7797D] border border-[#B7797D]/40">REJECT INSUFFICIENT</span>;
                    case 'OBSERVE_ONLY':
                      return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#17212D] text-[#AAB4BF] border border-[#354251]">OBSERVE ONLY</span>;
                    default:
                      return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#17212D] text-[#AAB4BF] border border-[#354251]">{recType}</span>;
                  }
                };

                return (
                  <div
                    key={rec.id}
                    className="p-4 rounded-xl bg-[#222B36] border border-[#354251] hover:border-[#AAB4BF]/50 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 font-mono text-xs"
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${
                          rec.direction === 'BUY'
                            ? 'bg-[#72A98B]/15 text-[#72A98B] border border-[#72A98B]/40'
                            : 'bg-[#B7797D]/15 text-[#B7797D] border border-[#B7797D]/40'
                        }`}
                      >
                        {rec.direction === 'BUY' ? 'CALL' : 'PUT'}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[#E8E5DE] text-sm">{rec.symbol}</span>
                          <span className="text-[11px] text-[#AAB4BF]">{rec.timestampIst}</span>
                          {getRecBadge(rec.recommendation)}
                        </div>
                        <div className="text-[11px] text-[#AAB4BF] mt-1">
                          Evidence: <span className="text-[#E8E5DE]">{rec.evidenceSnapshot}</span>
                        </div>
                        {rec.activeBehaviors.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {rec.activeBehaviors.map(b => (
                              <span
                                key={b}
                                className="px-1.5 py-0.2 rounded text-[9px] bg-[#17212D] text-[#6C9D91] border border-[#354251]"
                              >
                                {BEHAVIOR_NAMES[b]?.tag || b}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-5 shrink-0 justify-between md:justify-end border-t md:border-t-0 pt-2 md:pt-0 border-[#354251]">
                      <div className="text-right">
                        <div className="text-[10px] text-[#AAB4BF]">Confidence Calibration</div>
                        <div className="text-[#E8E5DE] mt-0.5">
                          <span className="line-through text-[#AAB4BF]/60 mr-1.5">
                            {(rec.baselineConfidence * 100).toFixed(0)}%
                          </span>
                          <span className="font-bold text-[#72A98B]">
                            {(rec.adjustedConfidence * 100).toFixed(0)}%
                          </span>
                        </div>
                      </div>

                      <div className="text-right min-w-[90px]">
                        <div className="text-[10px] text-[#AAB4BF]">Verified Outcome</div>
                        <div className="mt-0.5">
                          {isPending ? (
                            <span className="px-2 py-0.5 rounded text-[10px] bg-[#C5A36A]/15 text-[#C5A36A] border border-[#C5A36A]/40 font-bold">
                              PENDING
                            </span>
                          ) : isWin ? (
                            <span className="px-2 py-0.5 rounded text-[10px] bg-[#72A98B]/15 text-[#72A98B] border border-[#72A98B]/40 font-bold">
                              WIN {rec.netReturnUnits ? `(+${rec.netReturnUnits.toFixed(2)})` : ''}
                            </span>
                          ) : isLoss ? (
                            <span className="px-2 py-0.5 rounded text-[10px] bg-[#B7797D]/15 text-[#B7797D] border border-[#B7797D]/40 font-bold">
                              LOSS {rec.avoidedLoss ? '• AVOIDED' : ''}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] bg-[#17212D] text-[#AAB4BF] border border-[#354251]">
                              SCRATCH
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
