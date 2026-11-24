import React, { useEffect, useState } from 'react';
import {
  ShieldAlert,
  RotateCw,
} from 'lucide-react';
import { SystemHealthState } from '../../types/index.js';

export const SystemHealthView: React.FC = () => {
  const [health, setHealth] = useState<SystemHealthState | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchHealth = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/system/health');
      if (res.ok) {
        const data = await res.json();
        setHealth(data);
      }
    } catch (e) {
      console.error('Failed to fetch system health:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, []);

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
      <div className="flex flex-wrap items-center justify-between pb-4 border-b border-[#354251] gap-4">
        <div>
          <h3 className="text-base font-bold text-[#E8E5DE] font-mono flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-[#72A98B]" />
            <span>System Telemetry & Provider Health</span>
          </h3>
          <p className="text-xs text-[#AAB4BF] font-mono mt-1">
            Real-time infrastructure monitor, data feed health checks, and autonomous cron job executions.
          </p>
        </div>

        <button
          onClick={fetchHealth}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-[#222B36] border border-[#354251] text-[#E8E5DE] hover:border-[#6C9D91] rounded transition-colors cursor-pointer"
        >
          <RotateCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#6C9D91]' : ''}`} />
          <span>Refresh Health</span>
        </button>
      </div>

      {health ? (
        <div className="space-y-6 font-mono text-xs">
          {/* Top Status Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-[#222B36] border border-[#354251] rounded-lg p-4">
              <span className="text-[#AAB4BF] text-[10px] uppercase block font-semibold">Engine Uptime</span>
              <span className="text-xl font-bold text-[#E8E5DE] tabular-nums">
                {Math.floor(health.uptimeSeconds / 60)}m {health.uptimeSeconds % 60}s
              </span>
              <span className="text-[10px] text-[#72A98B] block mt-1 font-semibold">Continuous Execution</span>
            </div>

            <div className="bg-[#222B36] border border-[#354251] rounded-lg p-4">
              <span className="text-[#AAB4BF] text-[10px] uppercase block font-semibold">Database Storage</span>
              <span className="text-xl font-bold text-[#E8E5DE] truncate block">
                {health.dbType}
              </span>
              <span className="text-[10px] text-[#AAB4BF] block mt-1 tabular-nums">
                {health.totalCandlesStored} candles cached
              </span>
            </div>

            <div className="bg-[#222B36] border border-[#354251] rounded-lg p-4">
              <span className="text-[#AAB4BF] text-[10px] uppercase block font-semibold">Autopilot Pulse</span>
              <span className="text-xl font-bold text-[#6C9D91]">
                {health.isCronRunning ? 'Cycle In Progress' : 'Polling every 20s'}
              </span>
              <span className="text-[10px] text-[#AAB4BF] block mt-1">
                Signal scanning interval: 20 seconds
              </span>
            </div>

            <div className="bg-[#222B36] border border-[#354251] rounded-lg p-4">
              <span className="text-[#AAB4BF] text-[10px] uppercase block font-semibold">Active Signals</span>
              <span className="text-xl font-bold text-[#E8E5DE] tabular-nums">
                {health.activeSignalsCount} active / {health.totalExperimentsRun} backtests
              </span>
              <span className="text-[10px] text-[#AAB4BF] block mt-1">{health.totalForwardObservations || 0} forward paper observations</span>
            </div>
          </div>

          {/* Data Providers Health Matrix */}
          <div className="bg-[#222B36] border border-[#354251] rounded-lg p-5 space-y-3">
            <h4 className="text-sm font-semibold text-[#E8E5DE]">Public Feed Auditing & Fallback Matrix</h4>
            <div className="border border-[#354251] rounded overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-[#17212D] border-b border-[#354251] text-[#AAB4BF] uppercase text-[10px]">
                  <tr>
                    <th className="py-2.5 px-4">Provider Feed</th>
                    <th className="py-2.5 px-4">Symbol</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Latency</th>
                    <th className="py-2.5 px-4">Last Success</th>
                    <th className="py-2.5 px-4">Failure Attribution</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#354251] bg-[#222B36]/60">
                  {health.providers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-4 text-center text-[#AAB4BF]">
                        Providers initializing with market warmups...
                      </td>
                    </tr>
                  ) : (
                    health.providers.map((p, i) => (
                      <tr key={i} className="hover:bg-[#17212D]/50">
                        <td className="py-2.5 px-4 text-[#E8E5DE] font-semibold uppercase">{p.provider}</td>
                        <td className="py-2.5 px-4 text-[#AAB4BF]">{p.symbol}</td>
                        <td className="py-2.5 px-4">
                          <span
                            className={`font-semibold px-2 py-0.5 rounded text-[10px] ${
                              p.status === 'ONLINE'
                                ? 'bg-[#72A98B]/15 text-[#72A98B] border border-[#72A98B]/40'
                                : p.status === 'DEGRADED'
                                ? 'bg-[#C5A36A]/15 text-[#C5A36A] border border-[#C5A36A]/40'
                                : 'bg-[#B7797D]/15 text-[#B7797D] border border-[#B7797D]/40'
                            }`}
                          >
                            {p.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right text-[#E8E5DE] tabular-nums">
                          {p.latencyMs}ms
                        </td>
                        <td className="py-2.5 px-4 text-[#AAB4BF]">
                          {formatIST(p.lastSuccess)}
                        </td>
                        <td className="py-2.5 px-4 text-[#AAB4BF] text-[11px]">
                          {p.errorMessage ? (
                            <span className="text-[#B7797D]">{p.errorMessage}</span>
                          ) : (
                            p.attribution
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="h-64 flex items-center justify-center text-[#AAB4BF] font-mono text-xs bg-[#222B36] border border-[#354251] rounded-lg">
          Loading system telemetry...
        </div>
      )}
    </div>
  );
};
