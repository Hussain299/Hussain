import React, { useState, useEffect } from 'react';
import {
  X,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  Microscope,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Brain,
  Shield,
  Layers,
  Sparkles,
  Send,
} from 'lucide-react';
import { ResearchSignal } from '../../types/index.js';
import { getBotForSignal } from '../../utils/botControls.js';

interface TradeAuditModalProps {
  signal: ResearchSignal | null;
  onClose: () => void;
}

export const TradeAuditModal: React.FC<TradeAuditModalProps> = ({ signal, onClose }) => {
  const [sendingAudit, setSendingAudit] = useState(false);
  const [auditDispatchStatus, setAuditDispatchStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setAuditDispatchStatus(null);
  }, [signal?.id]);

  if (!signal) return null;

  const bot = getBotForSignal(signal);
  const isBuy = signal.direction === 'BUY';
  const isWon = signal.outcomeResult === 'WIN';
  const isLost = signal.outcomeResult === 'LOSS';
  const isScratch = signal.outcomeResult === 'SCRATCH';
  const isPending = signal.outcomeResult === 'PENDING' || !signal.outcomeResult;
  const hasEntryFill = Number.isFinite(signal.actualEntryPrice) && (signal.actualEntryPrice ?? 0) > 0;
  const isTerminalUnfilled = !hasEntryFill && ['EXPIRED', 'INVALIDATED', 'AMBIGUOUS'].includes(signal.lifecycleState);
  const auditReason = [...(signal.lifecycleHistory || [])].reverse().find(event =>
    ['EXPIRED', 'INVALIDATED', 'AMBIGUOUS'].includes(event.toState)
  )?.reason || 'No entry fill was recorded; this setup is excluded from contract outcomes.';

  const entryPrice = signal.actualEntryPrice || signal.triggerPrice;
  const exitPrice = signal.actualExitPrice;
  const payout = typeof signal.payoutPct === 'number' && Number.isFinite(signal.payoutPct)
    ? signal.payoutPct
    : null;
  const payoutSourceLabel = signal.payoutSource === 'BROKER_OBSERVED'
    ? 'Broker-observed payout'
    : signal.payoutSource === 'ASSUMED_MINIMUM'
    ? 'Assumed minimum payout'
    : 'Payout source not recorded';

  const formatIST = (utcString?: string | null) => {
    if (!utcString) return '—';
    try {
      const d = new Date(utcString);
      if (isNaN(d.getTime())) return utcString;
      return (
        d.toLocaleTimeString('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        }) + ' IST'
      );
    } catch {
      return utcString;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150">
      <div className="bg-[#161F2B] border border-[#243040] rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl text-xs font-sans">
        {/* Header */}
        <div className="p-5 border-b border-[#243040] flex items-center justify-between bg-[#121820] sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <span className="text-xl font-black font-mono text-[#E8E5DE]">
              {signal.symbol}
            </span>
            <span
              className={`px-2.5 py-0.5 rounded text-xs font-black font-mono ${
                isBuy ? 'bg-[#72A98B] text-[#121820]' : 'bg-[#B7797D] text-[#121820]'
              }`}
            >
              {signal.direction} ({isBuy ? 'CALL' : 'PUT'}) · {signal.expiryMinutes || 5}M
            </span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${bot.badgeBg}`}>
              {bot.name}
            </span>
          </div>

          <button
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-lg text-[#AAB4BF] hover:text-[#E8E5DE] hover:bg-[#243040] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5">
          {/* Outcome Status Banner */}
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-[#121820] border border-[#243040] font-mono">
            <div>
              <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Paper Settlement Outcome</span>
              <div className="flex items-center gap-2 mt-0.5">
                {isWon && <CheckCircle2 className="w-4 h-4 text-[#72A98B]" />}
                {isLost && <XCircle className="w-4 h-4 text-[#B7797D]" />}
                {isScratch && <AlertTriangle className="w-4 h-4 text-[#C5A36A]" />}
                <span
                  className={`text-base font-black ${
                    isWon ? 'text-[#72A98B]' : isLost ? 'text-[#B7797D]' : 'text-[#C5A36A]'
                  }`}
                >
                  {signal.outcomeResult || signal.lifecycleState}
                </span>
                <span className="text-xs text-[#AAB4BF]">
                  (Status: {signal.lifecycleState})
                </span>
              </div>
            </div>

            <div className="text-right">
              <span className="text-[10px] text-[#AAB4BF] uppercase block font-semibold">Net Payout Units</span>
              <div
                className={`text-lg font-black ${
                  (signal.netReturnUnits || 0) > 0
                    ? 'text-[#72A98B]'
                    : (signal.netReturnUnits || 0) < 0
                    ? 'text-[#B7797D]'
                    : 'text-[#AAB4BF]'
                }`}
              >
                {signal.netReturnUnits !== undefined && signal.netReturnUnits !== null
                  ? `${signal.netReturnUnits > 0 ? '+' : ''}${signal.netReturnUnits.toFixed(2)} U`
                  : 'Pending'}
              </div>
            </div>
          </div>

          {isTerminalUnfilled && (
            <div className="p-4 rounded-xl bg-[#C4A574]/10 border border-[#C4A574]/50 space-y-1">
              <div className="text-[11px] font-black tracking-wide text-[#C4A574]">AUDIT: UNSETTLED / NO ENTRY</div>
              <div className="text-[10px] font-bold text-[#E8E5DE]">{signal.lifecycleState}</div>
              <p className="text-xs leading-relaxed text-[#AAB4BF]">{auditReason}</p>
              <p className="text-[10px] text-[#AAB4BF]">No filled contract exists; no WIN, LOSS, or stake return is counted.</p>
            </div>
          )}

          {/* IST Timings Matrix */}
          <div className="p-4 rounded-xl bg-[#121820] border border-[#243040] space-y-2.5 font-mono">
            <div className="flex items-center gap-2 text-[#6C9D91] font-bold text-xs uppercase">
              <Clock className="w-3.5 h-3.5" />
              <span>Indian Standard Time (IST) Execution Trail</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-[10px] text-[#AAB4BF] block">Alert Generated</span>
                <span className="font-bold text-[#E8E5DE]">{signal.predictionTimeIst || formatIST(signal.predictionTimeUtc)}</span>
              </div>
              <div>
                <span className="text-[10px] text-[#AAB4BF] block">5M Candle Open (Fill)</span>
                <span className="font-bold text-[#E8E5DE]">{signal.candleOpenTimeIst || formatIST(signal.actualEntryTimeUtc)}</span>
              </div>
              <div>
                <span className="text-[10px] text-[#AAB4BF] block">Target Expiry</span>
                <span className="font-bold text-[#6C9D91]">{signal.candleCloseTimeIst || formatIST(signal.plannedExitTimeUtc)}</span>
              </div>
              <div>
                <span className="text-[10px] text-[#AAB4BF] block">Contract Horizon</span>
                <span className="font-bold text-[#E8E5DE]">{signal.expiryMinutes || 5} Minutes</span>
              </div>
            </div>
          </div>

          {/* Binary Contract Inputs & Prices — returns are reported in stake units, not pips. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-center">
            <div className="p-3 rounded-xl bg-[#121820] border border-[#243040]">
              <span className="text-[10px] text-[#AAB4BF] uppercase block">Entry Price</span>
              <span className="text-sm font-bold text-[#E8E5DE] block mt-0.5 tabular-nums">
                {hasEntryFill ? entryPrice.toFixed(5) : 'Not filled'}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-[#121820] border border-[#243040]">
              <span className="text-[10px] text-[#AAB4BF] uppercase block">Expiry Price</span>
              <span className="text-sm font-bold text-[#E8E5DE] block mt-0.5 tabular-nums">
                {typeof exitPrice === 'number' && exitPrice > 0 ? exitPrice.toFixed(5) : 'Not settled'}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-[#121820] border border-[#243040]">
              <span className="text-[10px] text-[#AAB4BF] uppercase block">Saved Payout</span>
              <span className="text-sm font-bold text-[#C4A574] block mt-0.5 tabular-nums">
                {payout === null ? 'Not recorded' : `${payout}%`}
              </span>
              <span className="mt-1 block text-[10px] text-[#AAB4BF]">{payoutSourceLabel}</span>
            </div>
          </div>

          {/* Strategy & Mathematical Logic */}
          <div className="p-4 rounded-xl bg-[#121820] border border-[#243040] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-[#AAB4BF] uppercase font-mono font-bold">Quantitative Strategy Formula</span>
              <span className="text-[10px] font-mono text-[#6C9D91]">
                Confidence: {(signal.confidence * 100).toFixed(1)}% · Rule Family: {signal.ruleFamily}
              </span>
            </div>
            <div className="text-sm font-bold text-[#E8E5DE] font-mono">
              {signal.strategyName || signal.ruleFamily}
            </div>
            {signal.mathematicalFormula && (
              <div className="p-2.5 rounded-lg bg-[#161F2B] border border-[#243040] font-mono text-xs text-[#C4A574]">
                <code>{signal.mathematicalFormula}</code>
              </div>
            )}
            <p className="text-[#AAB4BF] text-xs leading-relaxed pt-1">
              {signal.entryCondition}
            </p>
          </div>

          {/* Adversarial Multi-Agent Debate Summary (If present) */}
          {signal.agentDebate && (
            <div className="p-4 rounded-xl bg-[#6C9D91]/10 border border-[#6C9D91]/35 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[#6C9D91] font-bold text-xs uppercase font-mono">
                  <Brain className="w-4 h-4 text-[#6C9D91]" />
                  <span>Multi-Agent Debate &amp; Red-Team Stress Audit (Shadow)</span>
                </div>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                  signal.agentDebate.verdict === 'APPROVE'
                    ? 'bg-[#72A98B]/20 text-[#72A98B]'
                    : signal.agentDebate.verdict === 'CAUTION'
                      ? 'bg-[#C4A574]/20 text-[#C4A574]'
                      : 'bg-[#B7797D]/20 text-[#B7797D]'
                }`}>
                  {signal.agentDebate.verdict} · Hedge {(signal.agentDebate.hedgeWeightedProbability * 100).toFixed(1)}%
                </span>
              </div>
              <p className="text-[11px] font-mono text-[#E8E5DE]">
                {signal.agentDebate.consensusSummary}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {signal.agentDebate.votes.map((v) => (
                  <div key={v.agentId} className="p-2 rounded bg-[#161F2B] border border-[#243040] text-[10px] font-mono">
                    <div className="flex items-center justify-between text-[#E8E5DE] font-bold">
                      <span>{v.agentName}</span>
                      <span className={v.stance === 'SUPPORT' ? 'text-[#72A98B]' : v.stance === 'OPPOSE' ? 'text-[#B7797D]' : 'text-[#C4A574]'}>
                        {v.stance} · R2 {(v.round2Probability * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="text-[#AAB4BF] mt-0.5">{v.rationale}</div>
                  </div>
                ))}
              </div>
              {signal.agentDebate.challenges.length > 0 && (
                <div className="space-y-1">
                  {signal.agentDebate.challenges.map((c, idx) => (
                    <div key={idx} className="text-[10px] font-mono text-[#AAB4BF]">
                      <strong className="text-[#C4A574]">{c.challenger}:</strong> {c.flawCited} {c.rebuttal}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Institutional Risk, Kelly Sizing & MTF Context (If present) */}
          {signal.institutionalRisk && (
            <div className="p-4 rounded-xl bg-[#121820] border border-[#243040] space-y-2 font-mono text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[#C4A574] font-bold uppercase">
                  <Shield className="w-4 h-4 text-[#C4A574]" />
                  <span>Institutional Kelly Sizing &amp; Factor Risk</span>
                </div>
                <span className="px-2 py-0.5 rounded bg-[#72A98B]/15 text-[#72A98B] text-[10px] font-bold">
                  Stake: {signal.institutionalRisk.suggestedStakePct.toFixed(2)}% (¼-Kelly)
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                <div>
                  <span className="text-[#AAB4BF] block text-[10px]">M5 / M15 Bias</span>
                  <strong className="text-[#E8E5DE]">{signal.institutionalRisk.m5TrendBias} / {signal.institutionalRisk.m15TrendBias}</strong>
                </div>
                <div>
                  <span className="text-[#AAB4BF] block text-[10px]">MTF Align</span>
                  <strong className="text-[#6C9D91]">{signal.institutionalRisk.mtfAlignmentScore >= 0 ? '+' : ''}{signal.institutionalRisk.mtfAlignmentScore.toFixed(2)}</strong>
                </div>
                <div>
                  <span className="text-[#AAB4BF] block text-[10px]">Currency Spread</span>
                  <strong className="text-[#E8E5DE]">{signal.institutionalRisk.currencyStrengthSpread >= 0 ? '+' : ''}{signal.institutionalRisk.currencyStrengthSpread.toFixed(2)}</strong>
                </div>
                <div>
                  <span className="text-[#AAB4BF] block text-[10px]">Correlation Heat</span>
                  <strong className={signal.institutionalRisk.correlationRiskLevel === 'HIGH' ? 'text-[#B7797D]' : 'text-[#72A98B]'}>
                    {signal.institutionalRisk.correlationRiskLevel} ({signal.institutionalRisk.sameFactorOpenCount})
                  </strong>
                </div>
              </div>
            </div>
          )}

          {/* Loss Autopsy (If present) */}
          {signal.lossAutopsy && (
            <div className="p-4 rounded-xl bg-[#B7797D]/10 border border-[#B7797D]/40 space-y-2">
              <div className="flex items-center gap-2 text-[#B7797D] font-bold text-xs uppercase font-mono">
                <Microscope className="w-4 h-4 text-[#B7797D]" />
                <span>Forensic Loss Autopsy &amp; Evolved Antidote</span>
              </div>
              <div className="text-xs text-[#E8E5DE]">
                <strong className="text-[#B7797D]">Root Cause:</strong> {signal.lossAutopsy.rootCause}
              </div>
              <p className="text-[#E8E5DE]/85 text-xs leading-relaxed">
                {signal.lossAutopsy.rootCauseExplanation}
              </p>
              {signal.lossAutopsy.antidoteStrategyName && (
                <div className="pt-2 border-t border-[#B7797D]/20 text-xs text-[#AAB4BF] font-mono">
                  Synthesized Antidote: <strong className="text-[#72A98B]">{signal.lossAutopsy.antidoteStrategyName}</strong>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-[#121820] border-t border-[#243040] flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-mono text-[#AAB4BF]">
              Signal ID: <code className="text-[#E8E5DE]">{signal.id}</code>
            </span>
            {auditDispatchStatus && (
              <span
                className={`text-[10px] font-mono font-semibold ${
                  auditDispatchStatus.ok ? 'text-[#72A98B]' : 'text-[#B7797D]'
                }`}
              >
                {auditDispatchStatus.text}
              </span>
            )}
            {!auditDispatchStatus && signal.telegramAuditSentAt && (
              <span className="text-[10px] font-mono text-[#6C9D91]">
                Telegram Audit Dispatched · {formatIST(signal.telegramAuditSentAt)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {(isWon || isLost || isScratch) && (
              <button
                onClick={async () => {
                  setSendingAudit(true);
                  setAuditDispatchStatus(null);
                  try {
                    const res = await fetch('/api/telegram/audit-report', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ signalId: signal.id }),
                    });
                    const data = await res.json();
                    if (data.success) {
                      setAuditDispatchStatus({
                        ok: true,
                        text: `Win/Loss Audit Report sent to ${data.sentTo} Telegram subscriber(s).`,
                      });
                    } else {
                      setAuditDispatchStatus({
                        ok: false,
                        text: data.error || 'Failed to dispatch Telegram audit report.',
                      });
                    }
                  } catch (err: any) {
                    setAuditDispatchStatus({ ok: false, text: err.message });
                  } finally {
                    setSendingAudit(false);
                  }
                }}
                disabled={sendingAudit}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-[#6C9D91] hover:bg-[#72A98B] text-[#121820] rounded-lg text-xs font-bold font-mono transition-colors cursor-pointer disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{sendingAudit ? 'Sending Audit...' : 'Send Audit to Telegram'}</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 bg-[#161F2B] hover:bg-[#243040] text-[#E8E5DE] border border-[#243040] rounded-lg text-xs font-bold font-mono transition-colors cursor-pointer"
            >
              Close Audit Inspector
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
