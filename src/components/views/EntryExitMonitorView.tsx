import React, { useState } from 'react';
import { Target, Clock, ArrowRight, ShieldAlert, CheckCircle2, AlertTriangle, Layers } from 'lucide-react';
import { ResearchSignal } from '../../types/index.js';

interface EntryExitMonitorViewProps {
  signals: ResearchSignal[];
}

export const EntryExitMonitorView: React.FC<EntryExitMonitorViewProps> = ({ signals }) => {
  const [selectedSignal, setSelectedSignal] = useState<ResearchSignal | null>(
    signals[0] || null
  );

  const sig =
    (selectedSignal ? signals.find(s => s.id === selectedSignal.id) || selectedSignal : null) ||
    signals[0];

  const formatIST = (timestampStr?: string) => {
    if (!timestampStr) return '--:--:-- IST';
    try {
      const d = new Date(timestampStr);
      if (isNaN(d.getTime())) return timestampStr;
      return (
        d.toLocaleTimeString('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }) + ' IST'
      );
    } catch {
      return timestampStr;
    }
  };

  return (
    <div className="w-full bg-[#17212D] text-[#E8E5DE] p-4 lg:p-6 space-y-6 font-sans pb-16 lg:pb-8">
      <div className="pb-4 border-b border-[#354251]">
        <h3 className="text-base font-bold text-[#E8E5DE] font-mono flex items-center gap-2">
          <Target className="w-4 h-4 text-[#72A98B]" />
          <span>Causal Entry & Exit Execution Monitor</span>
        </h3>
        <p className="text-xs text-[#AAB4BF] font-mono mt-1">
          Inspection of temporal decoupling between prediction time, causal trigger breach, actual entry fill, and dynamically offset exit times (all times in Indian Standard Time).
        </p>
      </div>

      {sig ? (
        <div className="space-y-6 font-mono text-xs">
          {/* Signal Selector Ribbon */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {signals.map((s, idx) => (
              <button
                key={`entry_exit_${s.id}_${idx}`}
                onClick={() => setSelectedSignal(s)}
                className={`px-3 py-1.5 rounded border text-xs font-mono transition-colors whitespace-nowrap ${
                  (selectedSignal?.id || sig.id) === s.id
                    ? 'bg-[#17212D] text-[#E8E5DE] border-[#6C9D91] font-semibold'
                    : 'bg-[#222B36] text-[#AAB4BF] border-[#354251] hover:text-[#E8E5DE]'
                }`}
              >
                {s.symbol} {s.direction} ({s.lifecycleState})
              </button>
            ))}
          </div>

          {/* Temporal Lifecycle Stepper */}
          <div className="bg-[#222B36] border border-[#354251] rounded-lg p-5 space-y-4">
            <h4 className="text-sm font-semibold text-[#E8E5DE]">
              Deterministic Causal State Transition Architecture
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              {/* Step 1 */}
              <div className="bg-[#17212D] p-3.5 rounded border border-[#354251] space-y-1">
                <span className="text-[10px] text-[#AAB4BF] uppercase font-semibold">
                  01. Setup Detected
                </span>
                <div className="text-[#E8E5DE] font-bold">{sig.symbol} {sig.direction}</div>
                <div className="text-[#AAB4BF] text-[11px]">
                  Closed candle: {formatIST(sig.signalCandleTime)}
                </div>
                <div className="text-[10px] text-[#AAB4BF]/80 mt-2">
                  No execution permitted on signal candle close.
                </div>
              </div>

              {/* Step 2 */}
              <div className="bg-[#17212D] p-3.5 rounded border border-[#354251] space-y-1">
                <span className="text-[10px] text-[#C5A36A] uppercase font-semibold">
                  02. Waiting for Causal Trigger
                </span>
                <div className="text-[#E8E5DE] font-bold">{sig.triggerPrice}</div>
                <div className="text-[#AAB4BF] text-[11px]">
                  Window: {formatIST(sig.entryWindowStartUtc)}–{formatIST(sig.entryWindowEndUtc)}
                </div>
                <div className="text-[10px] text-[#AAB4BF]/80 mt-2">
                  Requires next candle high/low to penetrate trigger.
                </div>
              </div>

              {/* Step 3 */}
              <div className="bg-[#17212D] p-3.5 rounded border border-[#354251] space-y-1">
                <span className="text-[10px] text-[#72A98B] uppercase font-semibold">
                  03. Actual Entry Fill
                </span>
                <div className="text-[#E8E5DE] font-bold">
                  {sig.actualEntryPrice ? sig.actualEntryPrice : 'Pending'}
                </div>
                <div className="text-[#AAB4BF] text-[11px]">
                  Fill Time: {sig.actualEntryTimeUtc ? formatIST(sig.actualEntryTimeUtc) : 'Awaiting confirmation'}
                </div>
                <div className="text-[10px] text-[#AAB4BF]/80 mt-2">
                  Expiry clock strictly starts here, not at prediction.
                </div>
              </div>

              {/* Step 4 */}
              <div className="bg-[#17212D] p-3.5 rounded border border-[#354251] space-y-1">
                <span className="text-[10px] text-[#6C9D91] uppercase font-semibold">
                  04. Planned & Actual Exit
                </span>
                <div className="text-[#E8E5DE] font-bold">
                  {sig.actualExitPrice ? sig.actualExitPrice : 'Holding'}
                </div>
                <div className="text-[#AAB4BF] text-[11px]">
                  Exit Target: {sig.plannedExitTimeUtc ? formatIST(sig.plannedExitTimeUtc) : 'Set after fill'}
                </div>
                <div className="text-[10px] text-[#AAB4BF]/80 mt-2">
                  Duration: {sig.expiryMinutes}m post actual fill.
                </div>
              </div>
            </div>
          </div>

          {/* Audit Rule Enforcement Panel */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-[#222B36] border border-[#354251] rounded-lg p-4 space-y-3">
              <h4 className="text-sm font-semibold text-[#E8E5DE] flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-[#72A98B]" />
                <span>Anti-Lookahead Timing Guarantees</span>
              </h4>
              <div className="space-y-2 text-[#AAB4BF] text-[11px]">
                <div className="flex gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#72A98B] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#E8E5DE]">Causal Trigger:</strong> Price crossing is strictly evaluated on
                    subsequent completed 1m candles. Historical candle closes are never treated as
                    instant market fills.
                  </span>
                </div>
                <div className="flex gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#72A98B] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#E8E5DE]">Dynamic Expiry Start:</strong> Expiry duration (+{sig.expiryMinutes}m) is
                    calculated strictly from observed fill timestamp (
                    {sig.actualEntryTimeUtc ? formatIST(sig.actualEntryTimeUtc) : 'Awaiting'}), avoiding premature exit evaluation.
                  </span>
                </div>
                <div className="flex gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#72A98B] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#E8E5DE]">Ambiguity Trap Prevention:</strong> If a volatile 1m candle penetrates
                    both trigger ({sig.triggerPrice}) and stop ({sig.invalidationPrice}), state
                    switches immediately to AMBIGUOUS without fictitious intrabar sequence guessing.
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-[#222B36] border border-[#354251] rounded-lg p-4 space-y-3">
              <h4 className="text-sm font-semibold text-[#E8E5DE]">Full Event Trail for {sig.id}</h4>
              <div className="bg-[#17212D] p-3 rounded border border-[#354251] space-y-1.5 max-h-48 overflow-y-auto">
                {sig.lifecycleHistory.map((evt, idx) => (
                  <div key={idx} className="text-[11px] text-[#AAB4BF]">
                    <span className="text-[#AAB4BF]/60">[{formatIST(evt.timestamp)}]</span>{' '}
                    <span className="text-[#72A98B] font-semibold">
                      {evt.fromState} → {evt.toState}
                    </span>
                    : <span className="text-[#E8E5DE]">{evt.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="h-64 flex flex-col items-center justify-center text-center text-[#AAB4BF] font-mono text-xs bg-[#222B36] border border-[#354251] rounded-lg">
          <Target className="w-8 h-8 text-[#354251] mb-2" />
          <p className="text-[#E8E5DE] font-medium text-sm">No Signals to Monitor</p>
          <p className="mt-1 text-[#AAB4BF]">Signals will appear here once generated by the research cycle.</p>
        </div>
      )}
    </div>
  );
};
