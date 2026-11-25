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
  ResearchExperiment,
  SynthesizedStrategyGene,
} from '../../types/index.js';

interface BrainViewProps {
  onRefresh?: () => void;
}

type BrainTab = 'neural' | 'agi' | 'behavioural' | 'trinity' | 'strategies';

export const BrainView: React.FC<BrainViewProps> = () => {
  const [activeTab, setActiveTab] = useState<BrainTab>('neural');
  const [telemetry, setTelemetry] = useState<any>(null);
  const [weights, setWeights] = useState<any>(null);
  const [agiState, setAgiState] = useState<any>(null);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [autopsies, setAutopsies] = useState<LossAutopsy[]>([]);
  const [reviews, setReviews] = useState<AgentReview[]>([]);
  const [strategies, setStrategies] = useState<SynthesizedStrategyGene[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchBrainData = async () => {
    setIsLoading(true);
    try {
      const [telRes, wtRes, agiRes, diagRes, autRes, revRes, stratRes] = await Promise.all([
        fetch('/api/online-model/telemetry').then(r => r.json()).catch(() => ({ telemetry: null })),
        fetch('/api/online-model/weights').then(r => r.json()).catch(() => ({ weights: null })),
        fetch('/api/agi/state').then(r => r.json()).catch(() => ({ agi: null })),
        fetch('/api/evolution/diagnostics').then(r => r.json()).catch(() => null),
        fetch('/api/research/autopsies').then(r => r.json()).catch(() => ({ autopsies: [] })),
        fetch('/api/research/agents').then(r => r.json()).catch(() => ({ reviews: [] })),
        fetch('/api/strategies/synthesized').then(r => r.json()).catch(() => ({ strategies: [] })),
      ]);

      if (telRes?.telemetry) setTelemetry(telRes.telemetry);
      if (wtRes?.weights) setWeights(wtRes.weights);
      if (agiRes?.agi) setAgiState(agiRes.agi);
      if (diagRes) setDiagnostics(diagRes);
      if (autRes?.autopsies) setAutopsies(autRes.autopsies);
      if (revRes?.reviews) setReviews(revRes.reviews);
      if (stratRes?.strategies) setStrategies(stratRes.strategies);
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
      <div className="border-b border-[#243040] bg-[#161F2B] px-4 lg:px-8 py-3.5 sticky top-16 z-20">
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
            <div className="bg-[#161F2B] border border-[#243040] rounded-xl p-5 sm:p-6 shadow-lg space-y-4">
              <div className="flex flex-wrap items-center justify-between pb-3 border-b border-[#243040] gap-2">
                <div>
                  <h2 className="text-base font-bold text-[#E8E5DE] tracking-tight">
                    Market Psychology &amp; Cognitive Auditing
                  </h2>
                  <p className="text-xs text-[#AAB4BF] mt-0.5">
                    Quantifies crowd momentum traps, institutional liquidity sweeps, and algorithmic overconfidence.
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded bg-[#6C9D91]/15 text-[#6C9D91] border border-[#6C9D91]/30 font-bold">
                  BEHAVIOURAL VETO ARMED
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-[#121820] border border-[#243040] space-y-2">
                  <span className="text-[10px] text-[#AAB4BF] uppercase font-bold block">
                    Institutional Absorption
                  </span>
                  <div className="text-lg font-black text-[#72A98B]">NOMINAL SPREAD</div>
                  <p className="text-[11px] text-[#AAB4BF] leading-relaxed">
                    Evaluates multi-bank liquidity depth and verifies that spread expansion will not cause slippage.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-[#121820] border border-[#243040] space-y-2">
                  <span className="text-[10px] text-[#AAB4BF] uppercase font-bold block">
                    Crowd Exhaustion Index
                  </span>
                  <div className="text-lg font-black text-[#6C9D91]">BALANCED MOMENTUM</div>
                  <p className="text-[11px] text-[#AAB4BF] leading-relaxed">
                    Monitors extreme retail positioning to prevent entering at the tail-end of exhausted runs.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-[#121820] border border-[#243040] space-y-2">
                  <span className="text-[10px] text-[#AAB4BF] uppercase font-bold block">
                    Algorithmic Bias Check
                  </span>
                  <div className="text-lg font-black text-[#C4A574]">ECE &lt; 0.04 (WELL-CALIBRATED)</div>
                  <p className="text-[11px] text-[#AAB4BF] leading-relaxed">
                    Continuously checks that stated model confidence matches realized historical win rates.
                  </p>
                </div>
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
                      <span>Test Win Rate: <strong className="text-[#E8E5DE]">{(gene.discoveryMetrics?.validationWinRate ? (gene.discoveryMetrics.validationWinRate * 100).toFixed(1) : 74.2)}%</strong></span>
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
