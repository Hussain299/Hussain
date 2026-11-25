import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertCircle, AlertTriangle, CheckCircle2, CircleHelp, ExternalLink, Link2, RefreshCw, ShieldCheck, Wifi, WifiOff, Clock, Eye } from 'lucide-react';
import { FOREX_PAIRS } from '../../types/index.js';
import { OlympTradeBridgeStatus, requestOlympTradeBridgeStatus } from '../../services/olympTradeBridge.js';

const EMPTY_STATUS: OlympTradeBridgeStatus = {
  extensionInstalled: false, extensionVersion: null, platformTabOpen: false,
  connected: false, sessionState: 'UNKNOWN', capturedAt: null, ageMs: null, instruments: [],
};

function formatCaptureTime(value: string | null): string {
  if (!value) return 'Not captured yet';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  }).format(new Date(value)) + ' IST';
}

function formatAge(ageMs: number | null): string {
  if (ageMs === null) return 'N/A';
  const seconds = Math.max(0, Math.floor(ageMs / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s ago`;
}

export const BrokerConnectionView: React.FC = () => {
  const [status, setStatus] = useState<OlympTradeBridgeStatus>(EMPTY_STATUS);
  const [checking, setChecking] = useState(false);
  const [lastRefreshTime, setLastRefreshTime] = useState<string | null>(null);

  const refresh = useCallback(async (forceScan = false) => {
    setChecking(true);
    try {
      const result = await requestOlympTradeBridgeStatus(forceScan ? 'REFRESH' : 'GET_STATUS');
      setStatus(result);
      setLastRefreshTime(new Date().toISOString());
    } finally { setChecking(false); }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const configuredPairs = useMemo(() => new Set<string>(FOREX_PAIRS), []);
  const availableCount = status.instruments.filter(row => row.availability === 'AVAILABLE').length;
  const unavailableCount = status.instruments.filter(row => row.availability === 'UNAVAILABLE').length;
  const payoutCount = status.instruments.filter(row => row.payoutPct !== null && row.evidence === 'HIGH').length;
  const mediumPayoutCount = status.instruments.filter(row => row.payoutPct !== null && row.evidence === 'MEDIUM').length;
  const trackedCount = status.instruments.filter(row => configuredPairs.has(row.pair)).length;
  const dataIsFresh = status.connected && status.ageMs !== null && status.ageMs <= 45_000;

  const stateLabel = !status.extensionInstalled ? 'COMPANION NOT INSTALLED'
    : !status.platformTabOpen ? 'OLYMP TRADE TAB NOT OPEN'
    : status.sessionState === 'LOGIN_REQUIRED' ? 'LOGIN REQUIRED'
    : status.sessionState === 'WAITING_FOR_MARKET_DATA' ? 'WAITING FOR INSTRUMENT DATA'
    : status.sessionState === 'STALE' ? 'DATA STALE — REFRESH NEEDED'
    : dataIsFresh ? 'READ-ONLY CONNECTED' : 'NOT CONNECTED';

  const stateClass = dataIsFresh
    ? 'bg-[#72A98B]/15 border-[#72A98B]/40 text-[#72A98B]'
    : status.sessionState === 'LOGIN_REQUIRED'
    ? 'bg-[#C67D83]/15 border-[#C67D83]/40 text-[#C67D83]'
    : 'bg-[#C5A36A]/10 border-[#C5A36A]/35 text-[#C5A36A]';

  return (
    <div className="min-h-screen w-full bg-[#121820] text-[#E8E5DE] px-4 py-6 lg:px-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#243040] pb-5">
          <div>
            <div className="flex items-center gap-2 text-[#72A98B] text-[10px] font-mono font-bold tracking-[0.18em] uppercase"><Link2 className="w-4 h-4" /> Broker connection / read-only</div>
            <h1 className="mt-2 text-2xl sm:text-3xl font-black tracking-tight">Olymp Trade Feed</h1>
            <p className="mt-2 max-w-3xl text-sm text-[#AAB4BF] leading-relaxed">
              Read the instruments and payout percentages visible in your own Olymp Trade browser session.
              SignalForge never receives your password and this connector cannot place orders.
            </p>
          </div>
          <button onClick={() => void refresh(true)} disabled={checking}
            className="inline-flex items-center gap-2 rounded-lg border border-[#354251] bg-[#1B2633] px-4 py-2.5 text-xs font-bold text-[#E8E5DE] hover:bg-[#243040] disabled:opacity-50">
            <RefreshCw className={checking ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> Refresh snapshot
          </button>
        </div>

        {/* ───── Connection Status Banner ───── */}
        <section className="rounded-xl border border-[#354251] bg-[#161F2B] p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">{dataIsFresh ? <Wifi className="h-5 w-5 text-[#72A98B]" /> : <WifiOff className="h-5 w-5 text-[#C5A36A]" />}<span className="font-mono text-sm font-bold">LOCAL BROWSER COMPANION</span></div>
            <span className={'rounded-full border px-3 py-1 text-[10px] font-mono font-bold tracking-wide ' + stateClass}>{stateLabel}</span>
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-lg border border-[#2B3949] bg-[#121820] p-3"><div className="text-[10px] text-[#82909D] font-mono uppercase">Extension</div><div className="mt-1 text-sm font-bold">{status.extensionInstalled ? 'Installed · v' + (status.extensionVersion || 'unknown') : 'Not detected'}</div></div>
            <div className="rounded-lg border border-[#2B3949] bg-[#121820] p-3"><div className="text-[10px] text-[#82909D] font-mono uppercase">Olymp Trade session</div><div className="mt-1 text-sm font-bold">{status.platformTabOpen ? (status.sessionState === 'LOGIN_REQUIRED' ? 'Login screen detected' : 'Platform tab detected') : 'Open Olymp Trade in Chrome'}</div></div>
            <div className="rounded-lg border border-[#2B3949] bg-[#121820] p-3"><div className="text-[10px] text-[#82909D] font-mono uppercase">Last captured</div><div className="mt-1 text-sm font-bold tabular-nums">{formatCaptureTime(status.capturedAt)}</div></div>
            <div className="rounded-lg border border-[#2B3949] bg-[#121820] p-3"><div className="text-[10px] text-[#82909D] font-mono uppercase">Snapshot age</div><div className="mt-1 text-sm font-bold tabular-nums">{formatAge(status.ageMs)}</div></div>
          </div>
        </section>

        {/* ───── Troubleshooting Guidance ───── */}
        {!status.extensionInstalled && (
          <section className="rounded-xl border border-[#C5A36A]/35 bg-[#1B2633] p-4 sm:p-5">
            <div className="flex items-start gap-3"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#C5A36A]" /><div className="space-y-2">
              <h2 className="font-bold">Install the local companion once</h2>
              <p className="text-sm text-[#AAB4BF]">The companion runs in your Chrome profile. It reads only visible instrument labels and payout values from the open Olymp Trade page.</p>
              <ol className="list-decimal pl-5 space-y-1 text-xs text-[#C3CDD6]">
                <li>Download the SignalForge repository ZIP and extract it.</li>
                <li>Open <span className="font-mono text-[#E8E5DE]">chrome://extensions</span> and enable Developer mode.</li>
                <li>Click <b>Load unpacked</b> and select <span className="font-mono text-[#E8E5DE]">browser-companion/olymptrade</span>.</li>
                <li>Keep the extension enabled and open the Olymp Trade trading terminal in the same Chrome profile.</li>
              </ol>
              <a href="https://github.com/Hussain299/Hussain/tree/main/browser-companion/olymptrade" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-bold text-[#72A98B] hover:underline">
                Companion source and install notes <ExternalLink className="h-3 w-3" />
              </a>
            </div></div>
          </section>
        )}

        {status.extensionInstalled && !status.platformTabOpen && <section className="rounded-xl border border-[#C5A36A]/35 bg-[#1B2633] p-4 text-sm text-[#C3CDD6]">Open <b>olymptrade.com</b> in another tab in this same Chrome profile and log in normally. The companion does not handle or store your login details.</section>}

        {status.platformTabOpen && status.sessionState === 'LOGIN_REQUIRED' && (
          <section className="rounded-xl border border-[#C67D83]/35 bg-[#1B2633] p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#C67D83]" />
              <div>
                <h2 className="font-bold text-[#C67D83]">Login Required</h2>
                <p className="mt-1 text-sm text-[#C3CDD6]">Olymp Trade appears to be showing its login screen. Sign in directly on the official site; then leave the trading terminal open while SignalForge reads the visible market list. The companion will automatically reconnect once your session is active.</p>
              </div>
            </div>
          </section>
        )}

        {status.platformTabOpen && status.sessionState === 'WAITING_FOR_MARKET_DATA' && <section className="rounded-xl border border-[#C5A36A]/35 bg-[#1B2633] p-4 text-sm text-[#C3CDD6]">The platform tab is open, but no instrument list has been detected yet. Open the instrument selector or market list in Olymp Trade and press Refresh snapshot.</section>}

        {status.sessionState === 'STALE' && (
          <section className="rounded-xl border border-[#C5A36A]/35 bg-[#1B2633] p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <Clock className="mt-0.5 h-5 w-5 shrink-0 text-[#C5A36A]" />
              <div>
                <h2 className="font-bold text-[#C5A36A]">Data Stale</h2>
                <p className="mt-1 text-sm text-[#C3CDD6]">The last snapshot is older than 30 seconds. Observations may not be current. Ensure the Olymp Trade tab is active and the instrument list is visible, then press Refresh snapshot.</p>
              </div>
            </div>
          </section>
        )}

        {/* ───── Summary Stats ───── */}
        <section className="grid grid-cols-2 xl:grid-cols-6 gap-3">
          {[
            { label: 'Visible instruments', value: status.instruments.length },
            { label: 'Available', value: availableCount },
            { label: 'Unavailable', value: unavailableCount },
            { label: 'High-confidence payouts', value: payoutCount },
            { label: 'Medium-confidence payouts', value: mediumPayoutCount },
            { label: 'In SignalForge 29', value: trackedCount },
          ].map(item => <div key={item.label} className="rounded-xl border border-[#2B3949] bg-[#161F2B] p-4"><div className="text-[10px] font-mono uppercase tracking-wide text-[#82909D]">{item.label}</div><div className="mt-2 text-2xl font-black tabular-nums">{item.value}</div></div>)}
        </section>

        {/* ───── Live Instrument Snapshot Table ───── */}
        <section className="overflow-hidden rounded-xl border border-[#354251] bg-[#161F2B]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2B3949] px-4 py-4">
            <div>
              <h2 className="font-bold">Live instrument snapshot</h2>
              <p className="mt-1 text-xs text-[#82909D]">Only values read from the visible platform UI are shown. No payout is inferred or cached as live.</p>
            </div>
            <div className="flex items-center gap-3">
              {!dataIsFresh && status.instruments.length > 0 && (
                <span className="flex items-center gap-1.5 text-[10px] font-mono text-[#C5A36A]">
                  <AlertTriangle className="h-3.5 w-3.5" /> STALE — values may not be current
                </span>
              )}
              <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#82909D]">
                <Activity className="h-3.5 w-3.5" />
                {status.ageMs === null ? 'NO SNAPSHOT' : 'AGE ' + Math.max(0, Math.floor(status.ageMs / 1000)) + 's'}
              </div>
            </div>
          </div>
          {status.instruments.length === 0 ? <div className="p-8 text-center"><CircleHelp className="mx-auto h-7 w-7 text-[#82909D]" /><p className="mt-3 text-sm font-semibold">No instrument data received</p><p className="mt-1 text-xs text-[#82909D]">Connect the extension and open the instrument list in Olymp Trade.</p></div> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-xs">
              <thead className="bg-[#121820] text-[10px] uppercase tracking-wide text-[#82909D]"><tr><th className="px-4 py-3">Instrument</th><th className="px-4 py-3">Availability</th><th className="px-4 py-3">Payout</th><th className="px-4 py-3">Read confidence</th><th className="px-4 py-3">SignalForge universe</th><th className="px-4 py-3">Status</th></tr></thead>
              <tbody>{status.instruments.map(instrument => {
                const tracked = configuredPairs.has(instrument.pair);
                const isStaleRow = !dataIsFresh;
                return <tr key={instrument.pair} className={'border-t border-[#2B3949]' + (isStaleRow ? ' opacity-60' : '')}>
                  <td className="px-4 py-3 font-mono font-bold text-[#E8E5DE]">{instrument.pair}</td>
                  <td className="px-4 py-3">{instrument.availability === 'AVAILABLE' ? <span className="inline-flex items-center gap-1 text-[#72A98B]"><CheckCircle2 className="h-3.5 w-3.5" /> Available</span> : instrument.availability === 'UNAVAILABLE' ? <span className="text-[#C67D83]">Unavailable</span> : <span className="text-[#82909D]">Not confirmed</span>}</td>
                  <td className="px-4 py-3 font-mono font-bold">{instrument.payoutPct === null ? <span className="text-[#82909D]">Not detected</span> : <span className={instrument.payoutPct >= 80 ? 'text-[#72A98B]' : 'text-[#C5A36A]'}>{instrument.payoutPct.toFixed(2)}%</span>}</td>
                  <td className="px-4 py-3">{instrument.evidence === 'HIGH' ? <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3 text-[#72A98B]" /> High · payout label</span> : instrument.evidence === 'MEDIUM' ? <span className="text-[#C5A36A]">Medium · visible percentage</span> : <span className="text-[#82909D]">No payout evidence</span>}</td>
                  <td className="px-4 py-3"><span className={tracked ? 'text-[#72A98B]' : 'text-[#82909D]'}>{tracked ? 'Configured pair' : 'Outside configured 29'}</span></td>
                  <td className="px-4 py-3">{isStaleRow ? <span className="text-[#C5A36A] text-[10px] font-mono">STALE</span> : <span className="text-[#72A98B] text-[10px] font-mono">LIVE</span>}</td>
                </tr>;
              })}</tbody>
            </table></div>
          )}
        </section>

        {/* ───── Security / Safety Footer ───── */}
        <div className="flex items-start gap-2 rounded-lg border border-[#2B3949] bg-[#121820] p-4 text-[11px] leading-relaxed text-[#82909D]"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#72A98B]" /><p>Read-only by design. This extension does not read passwords or cookies, call private trading APIs, click trading controls, or submit orders. The current 29-pair SignalForge universe and all strategy, broker and execution rules remain unchanged; this screen is an observation layer. Stale data is clearly marked and never treated as live values.</p></div>
      </div>
    </div>
  );
};
