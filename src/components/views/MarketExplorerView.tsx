import React, { useState, useEffect } from 'react';
import {
  Activity,
  Database,
  CheckCircle2,
  Clock,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { Candle, FOREX_PAIRS, ForexSymbol, ProviderHealth } from '../../types/index.js';

interface MarketExplorerViewProps {
  providers: ProviderHealth[];
}

export const MarketExplorerView: React.FC<MarketExplorerViewProps> = ({ providers }) => {
  const [selectedPair, setSelectedPair] = useState<ForexSymbol>('EUR/USD');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [activeSource, setActiveSource] = useState<string>('biquote');
  const [qualityScore, setQualityScore] = useState<number>(95);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [hoveredCandle, setHoveredCandle] = useState<Candle | null>(null);

  const fetchPairData = async (symbol: ForexSymbol) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/forex-candles?symbol=${symbol.replace('/', '')}&limit=80`);
      if (res.ok) {
        const data = await res.json();
        setCandles(data.candles || []);
        setActiveSource(data.source || 'biquote');
        setQualityScore(data.qualityScore || 90);
      }
    } catch (e) {
      console.error('Failed to fetch candles:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPairData(selectedPair);
  }, [selectedPair]);

  const latestCandle = candles[candles.length - 1];
  const firstCandle = candles[0];
  const changePips =
    latestCandle && firstCandle
      ? Number(
          ((latestCandle.close - firstCandle.open) * (selectedPair.includes('JPY') ? 100 : 10000)).toFixed(1)
        )
      : 0;

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

  // Render SVG Candlestick Chart
  const renderChart = () => {
    if (candles.length < 2) {
      return (
        <div className="h-72 flex items-center justify-center text-[#AAB4BF] font-mono text-xs bg-[#222B36] border border-[#354251] rounded-lg">
          Loading candle series...
        </div>
      );
    }

    const minPrice = Math.min(...candles.map(c => c.low));
    const maxPrice = Math.max(...candles.map(c => c.high));
    const priceRange = Math.max(0.0001, maxPrice - minPrice);

    const chartHeight = 280;
    const chartWidth = 900;
    const candleWidth = Math.max(3, Math.min(10, (chartWidth / candles.length) * 0.7));
    const spacing = chartWidth / candles.length;

    const getY = (price: number) => {
      return chartHeight - ((price - minPrice) / priceRange) * (chartHeight - 40) - 20;
    };

    return (
      <div className="relative w-full overflow-x-auto bg-[#222B36] p-4 border border-[#354251] rounded-lg">
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="w-full h-72 overflow-visible select-none"
        >
          {/* Horizontal Grid lines */}
          {[0.2, 0.4, 0.6, 0.8].map(ratio => {
            const y = chartHeight * ratio;
            const price = maxPrice - ratio * priceRange;
            return (
              <g key={ratio}>
                <line
                  x1="0"
                  y1={y}
                  x2={chartWidth}
                  y2={y}
                  stroke="#354251"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                  strokeOpacity="0.6"
                />
                <text
                  x={chartWidth - 55}
                  y={y - 4}
                  fill="#AAB4BF"
                  fontSize="9"
                  fontFamily="monospace"
                >
                  {price.toFixed(selectedPair.includes('JPY') ? 3 : 5)}
                </text>
              </g>
            );
          })}

          {/* Candle Elements */}
          {candles.map((c, i) => {
            const isGreen = c.close >= c.open;
            const x = i * spacing + spacing / 2;
            const yHigh = getY(c.high);
            const yLow = getY(c.low);
            const yOpen = getY(c.open);
            const yClose = getY(c.close);
            const bodyY = Math.min(yOpen, yClose);
            const bodyHeight = Math.max(2, Math.abs(yClose - yOpen));
            const candleColor = isGreen ? '#72A98B' : '#B7797D';

            return (
              <g
                key={c.timestampMs}
                className="cursor-pointer transition-opacity hover:opacity-80"
                onMouseEnter={() => setHoveredCandle(c)}
                onMouseLeave={() => setHoveredCandle(null)}
              >
                {/* Wick */}
                <line
                  x1={x}
                  y1={yHigh}
                  x2={x}
                  y2={yLow}
                  stroke={candleColor}
                  strokeWidth="1.2"
                />
                {/* Candle Body */}
                <rect
                  x={x - candleWidth / 2}
                  y={bodyY}
                  width={candleWidth}
                  height={bodyHeight}
                  fill={candleColor}
                  rx="0.5"
                />
              </g>
            );
          })}
        </svg>

        {/* OHLC Bar Inspector */}
        <div className="mt-3 pt-2 border-t border-[#354251] flex flex-wrap items-center justify-between text-xs font-mono text-[#AAB4BF] gap-2">
          <div className="flex flex-wrap items-center gap-4">
            <span>
              O: <strong className="text-[#E8E5DE]">{(hoveredCandle || latestCandle)?.open}</strong>
            </span>
            <span>
              H: <strong className="text-[#E8E5DE]">{(hoveredCandle || latestCandle)?.high}</strong>
            </span>
            <span>
              L: <strong className="text-[#E8E5DE]">{(hoveredCandle || latestCandle)?.low}</strong>
            </span>
            <span>
              C: <strong className="text-[#E8E5DE]">{(hoveredCandle || latestCandle)?.close}</strong>
            </span>
            <span>
              Vol: <strong className="text-[#E8E5DE]">{(hoveredCandle || latestCandle)?.volume}</strong>
            </span>
          </div>
          <div className="text-[11px] text-[#AAB4BF] flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-[#6C9D91]" />
            <span>Time: {formatIST((hoveredCandle || latestCandle)?.timestamp)}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full bg-[#17212D] text-[#E8E5DE] p-4 lg:p-6 space-y-6 font-sans pb-16 lg:pb-8">
      {/* Pair Selector & Feed Health Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#354251]">
        <div className="flex items-center gap-1.5 overflow-x-auto py-1">
          {FOREX_PAIRS.map(pair => (
            <button
              key={pair}
              onClick={() => setSelectedPair(pair)}
              className={`px-3 py-1.5 rounded text-xs font-mono font-medium transition-colors ${
                selectedPair === pair
                  ? 'bg-[#17212D] text-[#E8E5DE] font-semibold border border-[#6C9D91]'
                  : 'text-[#AAB4BF] hover:text-[#E8E5DE] bg-[#222B36] border border-[#354251]'
              }`}
            >
              {pair}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-1.5 text-[#AAB4BF]">
            <span>Active Source:</span>
            <span className="text-[#72A98B] font-semibold uppercase">{activeSource}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[#AAB4BF]">
            <span>Data Quality:</span>
            <span className="text-[#E8E5DE] font-semibold">{qualityScore}/100</span>
          </div>
        </div>
      </div>

      {/* Main Chart Section */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <h3 className="text-base font-bold text-[#E8E5DE] font-mono">{selectedPair} M1 Continuous</h3>
            <span className="text-xs font-mono text-[#AAB4BF]">
              Last: <strong className="text-[#E8E5DE]">{latestCandle?.close}</strong>
            </span>
            <span
              className={`text-xs font-mono font-medium flex items-center gap-0.5 px-2 py-0.5 rounded ${
                changePips >= 0
                  ? 'bg-[#72A98B]/15 text-[#72A98B] border border-[#72A98B]/30'
                  : 'bg-[#B7797D]/15 text-[#B7797D] border border-[#B7797D]/30'
              }`}
            >
              {changePips >= 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
              {changePips >= 0 ? '+' : ''}
              {changePips} pips
            </span>
          </div>
          <div className="text-xs font-mono text-[#AAB4BF]">
            {candles.length} One-Minute Candles Cached
          </div>
        </div>

        {renderChart()}
      </div>

      {/* Provider Health Matrix & Architecture */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
        <div className="bg-[#222B36] border border-[#354251] rounded-lg p-4 text-xs font-mono space-y-2">
          <div className="text-[#AAB4BF] uppercase text-[10px] tracking-wider font-semibold flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-[#72A98B]" />
            <span className="text-[#E8E5DE]">Tier 1 Provider: Biquote.io</span>
          </div>
          <p className="text-[#AAB4BF]">
            Direct public forex endpoint (<code className="text-[#E8E5DE] bg-[#17212D] px-1 py-0.5 rounded">/api/symbol/ohlc</code>).
            Unfinished candles stripped; timestamps converted to ISO IST.
          </p>
          <div className="text-[11px] text-[#72A98B] font-semibold">Status: Active / Monitored</div>
        </div>

        <div className="bg-[#222B36] border border-[#354251] rounded-lg p-4 text-xs font-mono space-y-2">
          <div className="text-[#AAB4BF] uppercase text-[10px] tracking-wider font-semibold flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-[#C5A36A]" />
            <span className="text-[#E8E5DE]">Tier 2 Fallback: Dukascopy</span>
          </div>
          <p className="text-[#AAB4BF]">
            Dukascopy secondary feed with institutional bid/ask midpoints. Engages automatically if
            Biquote exceeds 4s timeout.
          </p>
          <div className="text-[11px] text-[#AAB4BF]">Status: Standby Ready</div>
        </div>

        <div className="bg-[#222B36] border border-[#354251] rounded-lg p-4 text-xs font-mono space-y-2">
          <div className="text-[#AAB4BF] uppercase text-[10px] tracking-wider font-semibold flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-[#6C9D91]" />
            <span className="text-[#E8E5DE]">Tier 3 Fallback: Yahoo Finance</span>
          </div>
          <p className="text-[#AAB4BF]">
            Chart v8 endpoint fallback. Handles weekend/session boundary fills with realistic
            continuity engine.
          </p>
          <div className="text-[11px] text-[#AAB4BF]">Status: Standby Ready</div>
        </div>
      </div>
    </div>
  );
};
