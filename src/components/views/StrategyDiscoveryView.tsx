import React, { useState } from 'react';
import { Lightbulb, Check, ArrowRight, Zap, Target, TrendingUp, Shield } from 'lucide-react';
import { RuleFamily } from '../../types/index.js';

interface StrategyDiscoveryViewProps {
  onGoToSignals?: () => void;
}

export const StrategyDiscoveryView: React.FC<StrategyDiscoveryViewProps> = ({ onGoToSignals }) => {
  const [selectedFamily, setSelectedFamily] = useState<string>('momentum_5');

  const strategies = [
    {
      id: 'momentum_5',
      name: '5-Minute Momentum Breakout',
      rank: 'CANDIDATE · NOT VALIDATED',
      winRate: '—',
      accuracyLabel: 'No verified historical result',
      pairs: 'EUR/USD, GBP/USD, EUR/JPY',
      timeframe: '5-Minute Dynamic Expiry',
      entryRule: 'Alerted 3 minutes in advance. Enters strictly at 5M candle open (:00, :05, :10, :15, etc.).',
      exitRule: 'Closes 5 minutes later at candle close.',
      spreadCost: '1.2-pip research cost assumption; profitability not established',
      description:
        'Candidate hypothesis: a candle closing near its high or low with a relatively strong body may precede continuation. The configured 3-minute alert and exact 5M-open entry schedule remains unchanged; performance still requires testing.',
    },
    {
      id: 'wick_reversal',
      name: '10-Minute Liquidity Wick Reversal',
      rank: 'CANDIDATE · NOT VALIDATED',
      winRate: '—',
      accuracyLabel: 'No verified historical result',
      pairs: 'USD/JPY, AUD/USD, AUD/CAD',
      timeframe: '10-Minute Dynamic Expiry',
      entryRule: 'Alerted 3 minutes in advance. Enters on 5M candle open after liquidity rejection.',
      exitRule: 'Closes 10 minutes later (across 2 full 5-minute candles).',
      spreadCost: '1.2-pip research cost assumption; profitability not established',
      description:
        'Candidate hypothesis: a long rejection wick near a recent high or low may precede a short-term reversal. This needs pair-by-pair historical and forward validation.',
    },
    {
      id: 'mean_reversion_20',
      name: '15-Minute Statistical Mean Reversion',
      rank: 'CANDIDATE · NOT VALIDATED',
      winRate: '—',
      accuracyLabel: 'No verified historical result',
      pairs: 'EUR/GBP, USD/CAD',
      timeframe: '15-Minute Dynamic Expiry',
      entryRule: 'Alerted 3 minutes in advance when price stretches >8 pips from 20-period mean.',
      exitRule: 'Closes 15 minutes later (across 3 full 5-minute candles).',
      spreadCost: '1.2-pip research cost assumption; profitability not established',
      description:
        'Candidate hypothesis: an unusually extended move during a range may revert toward its recent average. The claimed edge and selected expiry must be measured, not assumed.',
    },
    {
      id: 'range_breakout',
      name: '20-to-30 Minute Volatility Breakout',
      rank: 'CANDIDATE · NOT VALIDATED',
      winRate: '—',
      accuracyLabel: 'No verified historical result',
      pairs: 'GBP/USD, EUR/JPY, AUD/CAD',
      timeframe: '20m to 30m Dynamic Expiry',
      entryRule: 'Alerted 3 minutes before candle open when multi-candle consolidation breaks.',
      exitRule: 'Closes 20 or 30 minutes later at the corresponding 5M candle close.',
      spreadCost: '1.2-pip research cost assumption; profitability not established',
      description:
        'Candidate hypothesis: a break beyond a recent multi-candle range may continue. The 20–30 minute expiry remains a configured option; it is not evidence of profitability.',
    },
  ];

  const current = strategies.find(s => s.id === selectedFamily) || strategies[0];

  return (
    <div className="w-full bg-[#17212D] text-[#E8E5DE] p-4 sm:p-6 space-y-6 font-sans">
      {/* Top Banner with Direct Link to Live Signals */}
      <div className="bg-[#222B36] border border-[#6C9D91]/50 rounded-xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-[#6C9D91]" />
            <h2 className="text-lg sm:text-xl font-bold text-[#E8E5DE] font-mono">
              Dynamic Expiry (5m–30m) &amp; 3-Min Advance Signals
            </h2>
          </div>
          <p className="text-xs sm:text-sm text-[#AAB4BF] mt-1 max-w-xl">
            Trades open <strong className="text-[#E8E5DE]">ONLY on exact 5-minute candle marks</strong> (:00, :05, :10, :15, :20, etc.) with advance warning alerts 3 minutes prior.
          </p>
        </div>

        {onGoToSignals && (
          <button
            onClick={onGoToSignals}
            className="px-4 py-2 bg-[#6C9D91] hover:bg-[#6C9D91]/90 text-[#17212D] font-bold rounded-lg text-xs font-mono flex items-center gap-2 transition-all shadow-sm"
          >
            <span>View 5M Signals Board</span>
            <ArrowRight className="w-4 h-4 stroke-[2.5]" />
          </button>
        )}
      </div>

      {/* Title */}
      <div className="pb-3 border-b border-[#354251]">
        <h3 className="text-base font-bold text-[#E8E5DE] flex items-center gap-2 font-mono">
          <Lightbulb className="w-5 h-5 text-[#C5A36A]" />
          <span>Strategy Rule Families · Validation Pending</span>
        </h3>
        <p className="text-xs text-[#AAB4BF] mt-1">
          These are candidate rule families, not measured performance results. Import historical candles and validate before promotion.
        </p>
      </div>

      {/* Strategies Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {strategies.map((s, idx) => {
          const isSelected = s.id === selectedFamily;
          return (
            <div
              key={`strat_disc_${s.id}_${idx}`}
              onClick={() => setSelectedFamily(s.id)}
              className={`p-4 sm:p-5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                isSelected
                  ? 'bg-[#222B36] border-[#6C9D91] shadow-md ring-1 ring-[#6C9D91]/30'
                  : 'bg-[#222B36] border-[#354251] hover:border-[#AAB4BF]/50'
              }`}
            >
              <div className="space-y-2.5">
                <div className="flex justify-between items-start">
                  <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded bg-[#17212D] text-[#AAB4BF] border border-[#354251]">
                    {s.rank}
                  </span>
                  <span className="text-lg font-bold font-mono text-[#AAB4BF]">
                    {s.winRate}
                  </span>
                </div>

                <h4 className="font-bold text-[#E8E5DE] text-sm leading-snug">{s.name}</h4>
                <p className="text-[#AAB4BF] text-xs leading-relaxed">{s.description}</p>
              </div>

              <div className="pt-3 mt-3 border-t border-[#354251] text-xs font-mono space-y-1">
                <div className="flex justify-between text-[#AAB4BF]">
                  <span>Pairs:</span>
                  <span className="text-[#E8E5DE] font-semibold">{s.pairs}</span>
                </div>
                <div className="flex justify-between text-[#AAB4BF]">
                  <span>Candle Duration:</span>
                  <span className="text-[#6C9D91] font-bold">5 Minutes</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail Showcase of Selected Strategy */}
      <div className="bg-[#222B36] border border-[#354251] rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#354251]">
          <div>
            <h4 className="text-base font-bold text-[#E8E5DE]">{current.name}</h4>
            <span className="text-xs text-[#AAB4BF] font-mono">
              Applies to: {current.pairs}
            </span>
          </div>
          <span className="px-3 py-1 rounded-lg bg-[#17212D] text-[#AAB4BF] border border-[#354251] font-mono font-medium text-xs">
            {current.accuracyLabel}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
          <div className="bg-[#17212D] p-4 rounded-lg border border-[#354251] space-y-1.5">
            <span className="text-[#6C9D91] font-bold uppercase text-[11px] block">
              1. EXACT ENTRY RULE:
            </span>
            <p className="text-[#E8E5DE] leading-relaxed font-sans text-xs">
              {current.entryRule}
            </p>
          </div>

          <div className="bg-[#17212D] p-4 rounded-lg border border-[#354251] space-y-1.5">
            <span className="text-[#C5A36A] font-bold uppercase text-[11px] block">
              2. EXACT EXPIRY RULE:
            </span>
            <p className="text-[#E8E5DE] leading-relaxed font-sans text-xs">
              {current.exitRule}
            </p>
          </div>
        </div>

        <div className="p-3.5 bg-[#17212D] rounded-lg border border-[#354251] flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-2 text-[#AAB4BF]">
            <Shield className="w-4 h-4 text-[#6C9D91]" />
            <span>Modeled transaction cost:</span>
          </div>
          <span className="text-[#E8E5DE] font-semibold">{current.spreadCost}</span>
        </div>

        {onGoToSignals && (
          <button
            onClick={onGoToSignals}
            className="w-full py-2.5 bg-[#6C9D91] hover:bg-[#6C9D91]/90 text-[#17212D] font-bold rounded-lg text-xs font-mono transition-colors text-center"
          >
            Go To Live Signals For This Strategy →
          </button>
        )}
      </div>
    </div>
  );
};
