import React, { useState, useEffect } from 'react';
import {
  Brain,
  Cpu,
  Dna,
  Users,
  Microscope,
  Activity,
  Layers,
  Sparkles,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCw,
  Search,
  ExternalLink,
} from 'lucide-react';
import {
  AgentReview,
  EvolutionGeneration,
  LossAutopsy,
  MultiAgentDebateResult,
  ResearchExperiment,
  SynthesizedStrategyGene,
} from '../../types/index.js';

interface BrainViewProps {
  onRefresh?: () => void;
}

type BrainTab = 'neural' | 'council' | 'agi' | 'behavioural' | 'trinity' | 'strategies';

export const BrainView: React.FC<BrainViewProps> = () => {
  const [activeTab, setActiveTab] = useState<BrainTab>('neural');
  const [telemetry, setTelemetry] = useState<any>(null);
  const [weights, setWeights] = useState<any>(null);
  const [agiState, setAgiState] = useState<any>(null);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [autopsies, setAutopsies] = useState<LossAutopsy[]>([]);
  const [reviews, setReviews] = useState<AgentReview[]>([]);
  const [strategies, setStrategies] = useState<SynthesizedStrategyGene[]>([]);
  const [botHealth, setBotHealth] = useState<any>(null);
  const [shadowComparison, setShadowComparison] = useState<any>(null);
  const [councilData, setCouncilData] = useState<{
    council: any;
    benchmark: any;
    recentDebates: Array<{
      signalId: string;
      symbol: string;
      direction: string;
      predictionTimeUtc: string;
      predictionTimeIst: string;
      lifecycleState: string;
      outcomeResult: string;
      payoutPct?: number;
      netReturnUnits?: number | null;
      agentDebate: MultiAgentDebateResult;
    }>;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchBrainData = async () => {
    setIsLoading(true);
    try {
      const [telRes, wtRes, agiRes, diagRes, autRes, revRes, stratRes, councilRes, auditorRes, shadowCompRes] = await Promise.all([
        fetch('/api/online-model/telemetry').then(r => r.json()).catch(() => ({ telemetry: null })),
        fetch('/api/online-model/weights').then(r => r.json()).catch(() => ({ weights: null })),
        fetch('/api/agi/state').then(r => r.json()).catch(() => ({ agi: null })),
        fetch('/api/evolution/diagnostics').then(r => r.json()).catch(() => null),
        fetch('/api/research/autopsies').then(r => r.json()).catch(() => ({ autopsies: [] })),
        fetch('/api/research/agents').then(r => r.json()).catch(() => ({ reviews: [] })),
        fetch('/api/strategies/synthesized').then(r => r.json()).catch(() => ({ strategies: [] })),
        fetch('/api/agi/council').then(r => r.json()).catch(() => null),
        fetch('/api/behavioural/bot-auditor').then(r => r.json()).catch(() => null),
        fetch('/api/behavioural/shadow-comparison').then(r => r.json()).catch(() => null),
      ]);

      if (telRes?.telemetry) setTelemetry(telRes.telemetry);
      if (wtRes?.weights) setWeights(wtRes.weights);
      if (agiRes?.agi) setAgiState(agiRes.agi);
      if (diagRes) setDiagnostics(diagRes);
      if (autRes?.autopsies) setAutopsies(autRes.autopsies);
      if (revRes?.reviews) setReviews(revRes.reviews);
      if (stratRes?.strategies) setStrategies(stratRes.strategies);
      if (councilRes?.council) setCouncilData(councilRes);
      if (auditorRes?.botHealth) setBotHealth(auditorRes.botHealth);
      if (shadowCompRes?.comparison) setShadowComparison(shadowCompRes.comparison);
    } catch (err) {
      console.error('Failed to sync brain telemetry:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBrainData();
    const interval = setInterval(fetchBrainData, 8000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="w-full bg-[#121820] text-[#E8E5DE] min-h-screen font-sans pb-24">
      {/* Header & Module Switcher */}
      <div className="border-b border-[#243040] bg-[#161F2B] px-4 lg:px-8 py-3.5 sticky top-24 z-20">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-black tracking-wide text-[#E8E5DE] uppercase flex items-center gap-2">
              <Brain className="w-4 h-4 text-[#C4A574]" />
              <span>Quantitative Brain &amp; Model Intelligence</span>
            </span>

            <span className="text-[#354251] mx-1">/</span>

            {/* Segmented Module Switcher */}
            <div className="flex flex-wrap items-center bg-[#121820] border border-[#243040] p-1 rounded-lg gap-1">
              {[
                { id: 'neural', label: 'Neural Policy Network', icon: Cpu },
                { id: 'council', label: 'Adversarial Debate Arena', icon: Sparkles },
                { id: 'agi', label: 'AGI Self-Learning & Autopsies', icon: Microscope },
                { id: 'behavioural', label: 'Market Psychology', icon: Brain },
                { id: 'trinity', label: 'Trinity Agents', icon: Users },
                { id: 'strategies', label: 'Discovered Strategies', icon: Dna },
              ].map(tab => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as BrainTab)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-bold transition-all cursor-pointer ${
                      isActive
                        ? 'bg-[#161F2B] text-[#C4A574] border border-[#C4A574]/40 shadow-sm'
                        : 'text-[#AAB4BF] hover:text-[#E8E5DE]'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <button
            onClick={fetchBrainData}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#121820] hover:bg-[#243040] border border-[#243040] text-[#AAB4BF] hover:text-[#E8E5DE] font-semibold transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#C4A574]' : ''}`} />
            <span>Sync Telemetry</span>
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-6 space-y-6">
        {/* ========================================================= */}
        {/* MODULE 1: NEURAL POLICY NETWORK */}
        {/* ========================================================= */}
        {activeTab === 'neural' && (
          <div className="space-y-6 font-mono text-xs animate-in fade-in duration-150">
            <div className="bg-[#161F2B] border border-[#243040] rounded-xl p-5 sm:p-6 shadow-lg space-y-4">
              <div className="flex flex-wrap items-center justify-between pb-3 border-b border-[#243040] gap-2">
                <div>
                  <h2 className="text-base font-bold text-[#E8E5DE] tracking-tight">
                    Online Policy Network &amp; LinUCB Exploration
                  </h2>
                  <p className="text-xs text-[#AAB4BF] mt-0.5">
                    Real-time gradient optimization adjusting weights continuously after every verified candle outcome.
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded bg-[#72A98B]/15 text-[#72A98B] border border-[#72A98B]/30 font-bold">
                  {telemetry?.lastTrainedAt ? `TRAINED: ${new Date(telemetry.lastTrainedAt).toLocaleString()}` : 'AWAITING SETTLED OUTCOMES'}
                </span>
              </div>

              {/* Top 4 Metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-[#121820] border border-[#243040] rounded-lg p-3.5">
                  <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Adam Training Steps</span>
                  <div className="text-2xl font-black text-[#E8E5DE] mt-1 tabular-nums">
                    {telemetry?.stepCount ?? 0}
                  </div>
                  <span className="text-[10px] text-[#72A98B] block mt-1">
                    {telemetry?.optimizerRestorationStatus || 'FRESH_INIT'} · Skipped: {telemetry?.skippedMissingFeaturesCount ?? 0}
                  </span>
                </div>

                <div className="bg-[#121820] border border-[#243040] rounded-lg p-3.5">
                  <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">OOS BCE / Dir Acc</span>
                  <div className="text-2xl font-black text-[#C4A574] mt-1 tabular-nums">
                    {telemetry?.validationLossOos !== null && telemetry?.validationLossOos !== undefined
                      ? telemetry.validationLossOos
                      : telemetry?.averageLoss20 ?? '—'}
                  </div>
                  <span className="text-[10px] text-[#AAB4BF] block mt-1">
                    OOS Dir: {telemetry?.oosDirectionalAccuracy !== null && telemetry?.oosDirectionalAccuracy !== undefined ? `${telemetry.oosDirectionalAccuracy}%` : '—'} (n={telemetry?.oosEvaluatedCount ?? 0})
                  </span>
                </div>

                <div className="bg-[#121820] border border-[#243040] rounded-lg p-3.5">
                  <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">LinUCB V2 (Shadow)</span>
                  <div className="text-2xl font-black text-[#6C9D91] mt-1 tabular-nums">
                    {telemetry?.linUcbV2?.totalObservations ?? 0} obs
                  </div>
                  <span className="text-[10px] text-[#AAB4BF] block mt-1">
                    BUY {telemetry?.linUcbV2?.observationsBuy ?? 0} · SELL {telemetry?.linUcbV2?.observationsSell ?? 0} · Mean {telemetry?.linUcbV2?.meanReward ?? '—'}
                  </span>
                </div>

                <div className="bg-[#121820] border border-[#243040] rounded-lg p-3.5">
                  <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">FTRL 56D Brier Skill</span>
                  <div className="text-2xl font-black text-[#E8E5DE] mt-1 tabular-nums">
                    {diagnostics?.learning?.onlineLearner?.brierSkillVsPrevalence ?? '—'}
                  </div>
                  <span className="text-[10px] text-[#AAB4BF] block mt-1">
                    Prevalence Base: {diagnostics?.learning?.onlineLearner?.prevalenceBrierBaseline ?? '—'} (n={diagnostics?.learning?.onlineLearner?.sampleCount ?? 0})
                  </span>
                </div>
              </div>

              {/* Provenance + Episodic + Coverage Telemetry */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
                <div className="bg-[#121820] border border-[#243040] rounded-lg p-3.5 space-y-1">
                  <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Signal Provenance Split</span>
                  <div className="text-[#E8E5DE]">
                    Legacy: <strong>{diagnostics?.provenanceBreakdown?.legacy?.wins ?? 0}W-{diagnostics?.provenanceBreakdown?.legacy?.losses ?? 0}L</strong> ({diagnostics?.provenanceBreakdown?.legacy?.winRatePct ?? '—'}%)
                  </div>
                  <div className="text-[#72A98B]">
                    Olymp Verified: <strong>{diagnostics?.provenanceBreakdown?.olympVerified?.wins ?? 0}W-{diagnostics?.provenanceBreakdown?.olympVerified?.losses ?? 0}L</strong> ({diagnostics?.provenanceBreakdown?.olympVerified?.winRatePct ?? '—'}%)
                  </div>
                  <div className="text-[#C4A574]">
                    Shadow Accepted: <strong>{diagnostics?.provenanceBreakdown?.shadowAccepted?.wins ?? 0}W-{diagnostics?.provenanceBreakdown?.shadowAccepted?.losses ?? 0}L</strong> · Abstained: {diagnostics?.provenanceBreakdown?.shadowAbstained?.totalClosed ?? 0}
                  </div>
                </div>

                <div className="bg-[#121820] border border-[#243040] rounded-lg p-3.5 space-y-1">
                  <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Training Coverage &amp; Episodic k-NN</span>
                  <div className="text-[#E8E5DE]">
                    MLP Trained: <strong>{telemetry?.trainedSignalCount ?? 0}</strong> · Dups Blocked: {telemetry?.duplicateAttemptsBlocked ?? 0}
                  </div>
                  <div className="text-[#AAB4BF]">
                    Episodic Retrievals: {agiState?.episodicStats?.retrievalsTotal ?? 0} · Skipped (&lt;5): {agiState?.episodicStats?.skippedInsufficientHistoryCount ?? 0} · Vetoes: {agiState?.episodicStats?.vetoCount ?? 0}
                  </div>
                </div>

                <div className="bg-[#121820] border border-[#243040] rounded-lg p-3.5 space-y-1">
                  <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Top FTRL Feature Weights</span>
                  <div className="text-[11px] text-[#AAB4BF] space-y-0.5 max-h-20 overflow-y-auto">
                    {(diagnostics?.learning?.onlineLearner?.topFeatures || []).slice(0, 4).map((f: any) => (
                      <div key={f.feature} className="flex justify-between">
                        <span className="truncate max-w-[160px]">{f.feature}</span>
                        <span className={f.weight >= 0 ? 'text-[#72A98B]' : 'text-[#B7797D]'}>{f.weight >= 0 ? '+' : ''}{f.weight}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Numerical Weights Snapshot */}
              <div className="space-y-2 pt-2">
                <span className="text-xs font-bold text-[#E8E5DE] block">
                  Layer 1 Weights Snapshot (10 Hidden Neurons × 19 Input Features)
                </span>
                <div className="p-3 rounded-lg bg-[#121820] border border-[#243040] overflow-x-auto max-h-48 text-[11px] leading-relaxed text-[#AAB4BF]">
                  {weights ? (
                    <pre className="text-[#C4A574] font-mono">
                      {JSON.stringify(weights, null, 2)}
                    </pre>
                  ) : (
                    <div className="text-[#AAB4BF]">Weights streaming from neural memory...</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* MODULE 2: AGI SELF-LEARNING & LOSS AUTOPSIES */}
        {/* ========================================================= */}
        {activeTab === 'agi' && (
          <div className="space-y-6 font-mono text-xs animate-in fade-in duration-150">
            <div className="bg-[#161F2B] border border-[#243040] rounded-xl p-5 sm:p-6 shadow-lg space-y-4">
              <div className="flex flex-wrap items-center justify-between pb-3 border-b border-[#243040] gap-2">
                <div>
                  <h2 className="text-base font-bold text-[#E8E5DE] tracking-tight">
                    Forensic Loss Autopsies &amp; Evolved Antidotes
                  </h2>
                  <p className="text-xs text-[#AAB4BF] mt-0.5">
                    Every losing trade is forensically analyzed for root causes and mapped to an evolved antidote rule.
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded bg-[#B7797D]/15 text-[#B7797D] border border-[#B7797D]/30 font-bold">
                  {autopsies.length} Logged Autopsies
                </span>
              </div>

              {autopsies.length === 0 ? (
                <div className="p-8 text-center text-[#AAB4BF]">
                  No trade losses logged in this operational session.
                </div>
              ) : (
                <div className="space-y-3">
                  {autopsies.slice(0, 10).map((auto, i) => (
                    <div
                      key={auto.id || i}
                      className="p-4 rounded-xl bg-[#121820] border border-[#243040] space-y-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-black text-[#E8E5DE]">{auto.symbol}</span>
                          <span className="px-2 py-0.5 rounded text-[10px] bg-[#B7797D]/20 text-[#B7797D] font-bold">
                            {auto.direction} · {auto.netReturnPips} pips
                          </span>
                        </div>
                        <span className="text-[10px] text-[#AAB4BF]">
                          Root Cause: <strong className="text-[#B7797D]">{auto.rootCause}</strong>
                        </span>
                      </div>

                      <p className="text-xs text-[#E8E5DE]/85 leading-relaxed">
                        {auto.rootCauseExplanation}
                      </p>

                      <div className="p-2.5 rounded-lg bg-[#161F2B] border border-[#243040] flex flex-wrap items-center justify-between gap-2 text-[11px]">
                        <div>
                          <span className="text-[#AAB4BF]">Evolved Antidote: </span>
                          <strong className="text-[#72A98B]">{auto.antidoteStrategyName}</strong>
                        </div>
                        <code className="text-[#C4A574] text-[10px]">{auto.antidoteFormula}</code>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* MODULE 3: BEHAVIOURAL MARKET INTELLIGENCE */}
        {/* ========================================================= */}
        {activeTab === 'behavioural' && (
          <div className="space-y-6 font-mono text-xs animate-in fade-in duration-150">
            <div className="bg-[#161F2B] border border-[#243040] rounded-xl p-5 sm:p-6 shadow-lg space-y-5">
              <div className="flex flex-wrap items-center justify-between pb-3 border-b border-[#243040] gap-2">
                <div>
                  <h2 className="text-base font-bold text-[#E8E5DE] tracking-tight">
                    Decision Calibration, Cognitive Auditing &amp; Shadow Ablation
                  </h2>
                  <p className="text-xs text-[#AAB4BF] mt-0.5">
                    Live calibration error, streak distortion, strategy HHI concentration, and empirical behavioral filter ablation.
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded bg-[#6C9D91]/15 text-[#6C9D91] border border-[#6C9D91]/30 font-bold">
                  {botHealth?.confidenceCalibration?.calibrationStatus || 'COLLECTING_SAMPLES'} · n={botHealth?.confidenceCalibration?.sampleSize ?? 0}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-[#121820] border border-[#243040] space-y-2">
                  <span className="text-[10px] text-[#AAB4BF] uppercase font-bold block">
                    Confidence Calibration (ECE &amp; Brier)
                  </span>
                  <div className="text-lg font-black text-[#C4A574]">
                    ECE {botHealth?.confidenceCalibration ? botHealth.confidenceCalibration.expectedCalibrationError.toFixed(4) : '—'}
                  </div>
                  <p className="text-[11px] text-[#AAB4BF] leading-relaxed">
                    Brier: <strong className="text-[#E8E5DE]">{botHealth?.confidenceCalibration ? botHealth.confidenceCalibration.brierScore.toFixed(4) : '—'}</strong> ·{' '}
                    Avg Stated: <strong className="text-[#E8E5DE]">{botHealth?.confidenceCalibration ? `${(botHealth.confidenceCalibration.averageReportedConfidence * 100).toFixed(1)}%` : '—'}</strong> vs{' '}
                    Realized: <strong className="text-[#72A98B]">{botHealth?.confidenceCalibration ? `${(botHealth.confidenceCalibration.actualRealizedWinRate * 100).toFixed(1)}%` : '—'}</strong>
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-[#121820] border border-[#243040] space-y-2">
                  <span className="text-[10px] text-[#AAB4BF] uppercase font-bold block">
                    Recency Streak &amp; Concentration HHI
                  </span>
                  <div className="text-lg font-black text-[#6C9D91]">
                    {botHealth?.recencyBiasIndex
                      ? `${botHealth.recencyBiasIndex.streakType} × ${botHealth.recencyBiasIndex.streakLength}`
                      : 'NO STREAK'}
                  </div>
                  <p className="text-[11px] text-[#AAB4BF] leading-relaxed">
                    Strategy HHI: <strong className="text-[#E8E5DE]">{botHealth?.excessiveDependenceHHI?.hhiScore ?? '—'}</strong> ({botHealth?.excessiveDependenceHHI?.concentrationRisk || '—'}) ·{' '}
                    CUSUM Decay: <strong className="text-[#E8E5DE]">{botHealth?.strategyDeterioration?.deterioratingCount ?? 0}/{botHealth?.strategyDeterioration?.monitoredCount ?? 0}</strong>
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-[#121820] border border-[#243040] space-y-2">
                  <span className="text-[10px] text-[#AAB4BF] uppercase font-bold block">
                    Behavioral Shadow Filter Impact
                  </span>
                  <div className="text-lg font-black text-[#72A98B]">
                    {shadowComparison?.shadowWinRate !== null && shadowComparison?.shadowWinRate !== undefined
                      ? `${shadowComparison.shadowWinRate}% Shadow WR`
                      : 'Awaiting Settled Set'}
                  </div>
                  <p className="text-[11px] text-[#AAB4BF] leading-relaxed">
                    Baseline WR: <strong className="text-[#E8E5DE]">{shadowComparison?.baselineWinRate !== null && shadowComparison?.baselineWinRate !== undefined ? `${shadowComparison.baselineWinRate}%` : '—'}</strong> (n={shadowComparison?.baselineTradesCount ?? 0}) ·{' '}
                    Blocked Losses: <strong className="text-[#72A98B]">{shadowComparison?.avoidedLosingTradesCount ?? 0}</strong>
                  </p>
                </div>
              </div>

              {Array.isArray(shadowComparison?.ablationTests) && shadowComparison.ablationTests.length > 0 && (
                <div className="overflow-x-auto border border-[#243040] rounded-xl bg-[#121820]">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[#243040] text-[#AAB4BF] text-[10px] uppercase">
                        <th className="py-2 px-3">Filter Component</th>
                        <th className="py-2 px-3">Flagged n</th>
                        <th className="py-2 px-3">Δ WR (Clean - Flagged)</th>
                        <th className="py-2 px-3">Δ EV (Units)</th>
                        <th className="py-2 px-3">p-Value</th>
                        <th className="py-2 px-3 text-right">Empirical Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shadowComparison.ablationTests.map((row: any) => (
                        <tr key={row.componentId} className="border-b border-[#243040]/50">
                          <td className="py-2 px-3 font-bold text-[#E8E5DE]">{row.componentName}</td>
                          <td className="py-2 px-3 text-[#AAB4BF]">{row.sampleSize}</td>
                          <td className={`py-2 px-3 font-bold ${row.marginalWinRateDelta >= 0 ? 'text-[#72A98B]' : 'text-[#B7797D]'}`}>
                            {row.marginalWinRateDelta >= 0 ? '+' : ''}{Number(row.marginalWinRateDelta).toFixed(1)}%
                          </td>
                          <td className={`py-2 px-3 font-bold ${row.marginalEVUnitsDelta >= 0 ? 'text-[#6C9D91]' : 'text-[#B7797D]'}`}>
                            {row.marginalEVUnitsDelta >= 0 ? '+' : ''}{Number(row.marginalEVUnitsDelta).toFixed(2)} U
                          </td>
                          <td className="py-2 px-3 text-[#AAB4BF]">p={Number(row.pValue).toFixed(3)}</td>
                          <td className="py-2 px-3 text-right font-bold text-[#C4A574]">{row.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* MODULE 1B: ADVERSARIAL MULTI-AGENT DEBATE ARENA & HEDGE   */}
        {/* ========================================================= */}
        {activeTab === 'council' && (
          <div className="space-y-6 font-mono text-xs animate-in fade-in duration-150">
            <div className="bg-[#161F2B] border border-[#243040] rounded-xl p-5 sm:p-6 shadow-lg space-y-5">
              <div className="flex flex-wrap items-center justify-between pb-3 border-b border-[#243040] gap-2">
                <div>
                  <h2 className="text-base font-bold text-[#E8E5DE] tracking-tight">
                    Multi-Agent Adversarial Debate Arena &amp; Hedge Meta-Learner
                  </h2>
                  <p className="text-xs text-[#AAB4BF] mt-0.5">
                    5 autonomous quantitative agents propose, challenge via 5 counterfactual market shocks, revise beliefs in Round 2, and adapt weights via online Hedge (MWU) on settled outcomes. Shadow + Audit mode only.
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded bg-[#6C9D91]/15 text-[#6C9D91] border border-[#6C9D91]/30 font-bold">
                  SHADOW + AUDIT · {councilData?.council?.totalDebatesEvaluated ?? 0} DEBATES
                </span>
              </div>

              {/* Shadow Benchmark Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-4 rounded-xl bg-[#121820] border border-[#243040]">
                  <span className="text-[10px] text-[#AAB4BF] uppercase block">Debated Settled</span>
                  <span className="text-xl font-black text-[#E8E5DE] mt-1 block">
                    {councilData?.benchmark?.debatedSettledCount ?? 0}
                  </span>
                  <span className="text-[10px] text-[#AAB4BF] mt-1 block">
                    All WR: {councilData?.benchmark?.hedgeAllWinRate !== null && councilData?.benchmark?.hedgeAllWinRate !== undefined ? `${councilData.benchmark.hedgeAllWinRate}%` : 'Collecting'}
                  </span>
                </div>
                <div className="p-4 rounded-xl bg-[#121820] border border-[#243040]">
                  <span className="text-[10px] text-[#72A98B] uppercase block">Council APPROVE WR</span>
                  <span className="text-xl font-black text-[#72A98B] mt-1 block">
                    {councilData?.benchmark?.hedgeApproveWinRate !== null && councilData?.benchmark?.hedgeApproveWinRate !== undefined ? `${councilData.benchmark.hedgeApproveWinRate}%` : 'Pending'}
                  </span>
                  <span className="text-[10px] text-[#AAB4BF] mt-1 block">
                    n={councilData?.benchmark?.hedgeApproveCount ?? 0} · {(councilData?.benchmark?.hedgeApproveNetUnits ?? 0) >= 0 ? '+' : ''}{councilData?.benchmark?.hedgeApproveNetUnits ?? 0} U
                  </span>
                </div>
                <div className="p-4 rounded-xl bg-[#121820] border border-[#243040]">
                  <span className="text-[10px] text-[#C4A574] uppercase block">Shadow-Vetoed Loss Block</span>
                  <span className="text-xl font-black text-[#C4A574] mt-1 block">
                    {councilData?.benchmark?.hedgeVetoedLossAvoidancePct !== null && councilData?.benchmark?.hedgeVetoedLossAvoidancePct !== undefined ? `${councilData.benchmark.hedgeVetoedLossAvoidancePct}%` : 'Pending'}
                  </span>
                  <span className="text-[10px] text-[#AAB4BF] mt-1 block">
                    Vetoed setups: {councilData?.benchmark?.hedgeVetoedCount ?? 0}
                  </span>
                </div>
                <div className="p-4 rounded-xl bg-[#121820] border border-[#243040]">
                  <span className="text-[10px] text-[#6C9D91] uppercase block">Hedge Ensemble Brier</span>
                  <span className="text-xl font-black text-[#6C9D91] mt-1 block">
                    {councilData?.benchmark?.hedgeBrier !== null && councilData?.benchmark?.hedgeBrier !== undefined ? councilData.benchmark.hedgeBrier : 'Pending'}
                  </span>
                  <span className="text-[10px] text-[#AAB4BF] mt-1 block">
                    Fixed-share η={councilData?.council?.eta ?? 0.25}
                  </span>
                </div>
              </div>

              {/* Hedge Weights & Performance Leaderboard */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#E8E5DE] uppercase">
                    Agent Hedge Weights &amp; Accountability Leaderboard
                  </span>
                  <span className="text-[10px] text-[#AAB4BF]">
                    Regret-minimizing multiplicative updates shift weight toward winning challengers
                  </span>
                </div>
                <div className="overflow-x-auto border border-[#243040] rounded-xl bg-[#121820]">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[#243040] text-[#AAB4BF] text-[10px] uppercase">
                        <th className="py-2.5 px-4">Agent</th>
                        <th className="py-2.5 px-3">Hedge Weight</th>
                        <th className="py-2.5 px-3">Last Delta</th>
                        <th className="py-2.5 px-3">Observations</th>
                        <th className="py-2.5 px-3">Call Accuracy</th>
                        <th className="py-2.5 px-3">Brier</th>
                        <th className="py-2.5 px-3">Challenge Win %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(councilData?.benchmark?.agentLeaderboard || []).map((row: any) => (
                        <tr key={row.agentId} className="border-b border-[#243040]/50 hover:bg-[#161F2B]/50">
                          <td className="py-2.5 px-4 font-bold text-[#E8E5DE]">{row.agentName}</td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 rounded bg-[#6C9D91]/20 text-[#6C9D91] font-bold">
                              {row.weightPct.toFixed(1)}%
                            </span>
                          </td>
                          <td className={`py-2.5 px-3 font-semibold ${row.lastWeightDeltaPct > 0 ? 'text-[#72A98B]' : row.lastWeightDeltaPct < 0 ? 'text-[#B7797D]' : 'text-[#AAB4BF]'}`}>
                            {row.lastWeightDeltaPct > 0 ? '+' : ''}{row.lastWeightDeltaPct.toFixed(2)}%
                          </td>
                          <td className="py-2.5 px-3 text-[#E8E5DE]">{row.observations}</td>
                          <td className="py-2.5 px-3 text-[#E8E5DE]">{row.accuracyPct !== null ? `${row.accuracyPct}%` : '—'}</td>
                          <td className="py-2.5 px-3 text-[#AAB4BF]">{row.brierScore !== null ? row.brierScore : '—'}</td>
                          <td className="py-2.5 px-3 text-[#C4A574]">{row.challengeWinRatePct !== null ? `${row.challengeWinRatePct}%` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Recent Multi-Round Signal Debates */}
              <div className="space-y-3 pt-2">
                <span className="text-xs font-bold text-[#E8E5DE] uppercase block">
                  Recent Setup Cross-Examinations &amp; Counterfactual Challenges
                </span>
                {(!councilData?.recentDebates || councilData.recentDebates.length === 0) ? (
                  <div className="p-6 rounded-xl bg-[#121820] border border-[#243040] text-center text-[#AAB4BF]">
                    No live setup debates recorded yet. Every new active Olymp Trade signal automatically triggers a 2-round multi-agent debate and counterfactual stress suite.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {councilData.recentDebates.slice(0, 8).map((item) => {
                      const d = item.agentDebate;
                      return (
                        <div key={item.signalId} className="p-4 rounded-xl bg-[#121820] border border-[#243040] space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#243040]">
                            <div className="flex items-center gap-2">
                              <span className="font-black text-sm text-[#E8E5DE]">{item.symbol}</span>
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${item.direction === 'BUY' ? 'bg-[#72A98B]/20 text-[#72A98B]' : 'bg-[#B7797D]/20 text-[#B7797D]'}`}>
                                {item.direction}
                              </span>
                              <span className="text-[11px] text-[#AAB4BF]">{item.predictionTimeIst || item.predictionTimeUtc}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {item.outcomeResult === 'WIN' || item.outcomeResult === 'LOSS' ? (
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${item.outcomeResult === 'WIN' ? 'bg-[#72A98B]/20 text-[#72A98B]' : 'bg-[#B7797D]/20 text-[#B7797D]'}`}>
                                  ACTUAL: {item.outcomeResult}
                                </span>
                              ) : null}
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                d.verdict === 'APPROVE'
                                  ? 'bg-[#72A98B]/20 text-[#72A98B] border border-[#72A98B]/40'
                                  : d.verdict === 'CAUTION'
                                    ? 'bg-[#C4A574]/20 text-[#C4A574] border border-[#C4A574]/40'
                                    : 'bg-[#B7797D]/20 text-[#B7797D] border border-[#B7797D]/40'
                              }`}>
                                COUNCIL: {d.verdict}
                              </span>
                            </div>
                          </div>

                          <div className="text-[11px] text-[#E8E5DE]">{d.consensusSummary}</div>

                          <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                            {d.votes.map((v) => (
                              <div key={v.agentId} className="p-2.5 rounded-lg bg-[#161F2B] border border-[#243040] space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-bold text-[#E8E5DE] truncate">{v.agentName}</span>
                                  <span className={`text-[9px] font-bold ${v.stance === 'SUPPORT' ? 'text-[#72A98B]' : v.stance === 'OPPOSE' ? 'text-[#B7797D]' : 'text-[#C4A574]'}`}>
                                    {v.stance}
                                  </span>
                                </div>
                                <div className="text-[11px] text-[#6C9D91]">
                                  R1 {(v.round1Probability * 100).toFixed(0)}% → R2 <strong>{(v.round2Probability * 100).toFixed(0)}%</strong>
                                </div>
                                <div className="text-[9px] text-[#AAB4BF] leading-snug">{v.rationale}</div>
                              </div>
                            ))}
                          </div>

                          {d.challenges.length > 0 && (
                            <div className="space-y-1.5 pt-1">
                              {d.challenges.map((c, idx) => (
                                <div key={idx} className="p-2 rounded bg-[#161F2B]/70 border border-[#354251] text-[10px] text-[#AAB4BF]">
                                  <strong className="text-[#C4A574]">{c.challenger} → {c.target}:</strong> {c.flawCited}{' '}
                                  <span className="text-[#E8E5DE]">{c.rebuttal}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* MODULE 4: TRINITY RESEARCH AGENTS */}
        {/* ========================================================= */}
        {activeTab === 'trinity' && (
          <div className="space-y-6 font-mono text-xs animate-in fade-in duration-150">
            <div className="bg-[#161F2B] border border-[#243040] rounded-xl p-5 sm:p-6 shadow-lg space-y-4">
              <div className="flex flex-wrap items-center justify-between pb-3 border-b border-[#243040] gap-2">
                <div>
                  <h2 className="text-base font-bold text-[#E8E5DE] tracking-tight">
                    Trinity Agent Deliberation Records
                  </h2>
                  <p className="text-xs text-[#AAB4BF] mt-0.5">
                    Multi-agent consensus between the Scientist (Hypothesis), Engineer (Backtest), and Skeptical Auditor (Rejection).
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded bg-[#C4A574]/15 text-[#C4A574] border border-[#C4A574]/30 font-bold">
                  3 CONCURRENT AGENTS
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-[#121820] border border-[#243040] space-y-2">
                  <span className="text-[10px] text-[#6C9D91] uppercase font-bold block">01. Research Scientist</span>
                  <div className="text-sm font-bold text-[#E8E5DE]">Hypothesis Generator</div>
                  <p className="text-[11px] text-[#AAB4BF] leading-relaxed">
                    Formulates causal market micro-structure hypotheses using order flow imbalance and volatility regimes.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-[#121820] border border-[#243040] space-y-2">
                  <span className="text-[10px] text-[#72A98B] uppercase font-bold block">02. Backtest Engineer</span>
                  <div className="text-sm font-bold text-[#E8E5DE]">Purged Walk-Forward Evaluator</div>
                  <p className="text-[11px] text-[#AAB4BF] leading-relaxed">
                    Executes strict out-of-sample splits with combinatorial purging and zero lookahead bias.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-[#121820] border border-[#243040] space-y-2">
                  <span className="text-[10px] text-[#B7797D] uppercase font-bold block">03. Skeptical Auditor</span>
                  <div className="text-sm font-bold text-[#E8E5DE]">Deflated Sharpe Gatekeeper</div>
                  <p className="text-[11px] text-[#AAB4BF] leading-relaxed">
                    Penalizes multiple testing and rejects overfitted candidates before forward deployment.
                  </p>
                </div>
              </div>

              {/* Reviews List */}
              <div className="space-y-3 pt-2">
                <span className="text-xs font-bold text-[#E8E5DE] block">Recent Deliberation Logs</span>
                {reviews.length === 0 ? (
                  <div className="p-4 rounded-lg bg-[#121820] text-[#AAB4BF] text-center">
                    No active agent reviews. Deliberations trigger during research generations.
                  </div>
                ) : (
                  reviews.slice(0, 5).map((rev, i) => (
                    <div key={rev.id || i} className="p-3.5 rounded-lg bg-[#121820] border border-[#243040] space-y-1.5">
                      <div className="flex items-center justify-between">
                        <strong className="text-[#E8E5DE]">{rev.role}: {rev.title}</strong>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${rev.verdict === 'PROCEED' ? 'bg-[#72A98B]/20 text-[#72A98B]' : 'bg-[#B7797D]/20 text-[#B7797D]'}`}>
                          {rev.verdict || 'REVIEWED'}
                        </span>
                      </div>
                      <p className="text-xs text-[#AAB4BF]">{rev.content}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* MODULE 5: DISCOVERED STRATEGIES POOL */}
        {/* ========================================================= */}
        {activeTab === 'strategies' && (
          <div className="space-y-6 font-mono text-xs animate-in fade-in duration-150">
            <div className="bg-[#161F2B] border border-[#243040] rounded-xl p-5 sm:p-6 shadow-lg space-y-4">
              <div className="flex flex-wrap items-center justify-between pb-3 border-b border-[#243040] gap-2">
                <div>
                  <h2 className="text-base font-bold text-[#E8E5DE] tracking-tight">
                    Discovered Evolutionary Strategy Pool
                  </h2>
                  <p className="text-xs text-[#AAB4BF] mt-0.5">
                    Mathematical rule families discovered via symbolic regression and tested against historical M1 tick feeds.
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded bg-[#72A98B]/15 text-[#72A98B] border border-[#72A98B]/30 font-bold">
                  {strategies.length} Discovered Candidates
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {strategies.slice(0, 8).map(gene => (
                  <div key={gene.id} className="p-4 rounded-xl bg-[#121820] border border-[#243040] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-black text-sm text-[#E8E5DE]">{gene.name}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${gene.status === 'PROMOTED_ACTIVE' ? 'bg-[#72A98B]/20 text-[#72A98B]' : 'bg-[#C4A574]/20 text-[#C4A574]'}`}>
                        {gene.status}
                      </span>
                    </div>

                    {gene.mathematicalFormula && (
                      <div className="p-2 rounded bg-[#161F2B] text-[10px] text-[#C4A574] overflow-x-auto">
                        <code>{gene.mathematicalFormula}</code>
                      </div>
                    )}

                    <div className="flex items-center justify-between text-[11px] text-[#AAB4BF] pt-1">
                      <span>Test Win Rate: <strong className="text-[#E8E5DE]">
                        {(() => {
                          const rawWr = gene.backtestMetrics?.testWinRate ?? gene.discoveryMetrics?.validationWinRate;
                          return typeof rawWr === 'number' && Number.isFinite(rawWr)
                            ? `${(rawWr * 100).toFixed(1)}%`
                            : '—';
                        })()}
                      </strong></span>
                      <span>Symbol: <strong className="text-[#E8E5DE]">{gene.symbol || 'All Pairs'}</strong></span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
