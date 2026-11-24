import React, { useState, useEffect } from 'react';
import {
  Settings,
  Database,
  Cloud,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  Play,
  ShieldCheck,
  Send,
  ExternalLink,
  RotateCw,
  Users,
} from 'lucide-react';
import { VerificationTestResult } from '../../types/index.js';
import { TelegramBotModal } from '../common/TelegramBotModal.tsx';

export const ConfigurationView: React.FC = () => {
  const [d1Schema, setD1Schema] = useState<string>('');
  const [wranglerToml, setWranglerToml] = useState<string>('');
  const [copiedD1, setCopiedD1] = useState(false);
  const [copiedWrangler, setCopiedWrangler] = useState(false);

  // Test Suite state
  const [isRunningTests, setIsRunningTests] = useState(false);
  const [testResults, setTestResults] = useState<{
    summary: { total: number; passed: number; failed: number; durationMs: number };
    results: VerificationTestResult[];
  } | null>(null);

  // Telegram Integration State
  const [isTelegramModalOpen, setIsTelegramModalOpen] = useState(false);
  const [telegramStatus, setTelegramStatus] = useState<{
    configured: boolean;
    bot?: { username: string; firstName: string; id: number };
    botStatus: string;
    subscribersCount: number;
    enabled: boolean;
  } | null>(null);
  const [isSyncingTelegram, setIsSyncingTelegram] = useState(false);

  const fetchTelegramStatus = () => {
    fetch('/api/telegram/status')
      .then(res => res.json())
      .then(data => setTelegramStatus(data))
      .catch(console.error);
  };

  useEffect(() => {
    fetch('/api/system/export-d1')
      .then(res => res.json())
      .then(data => {
        setD1Schema(data.schemaSql || '');
        setWranglerToml(data.wranglerToml || '');
      })
      .catch(console.error);

    fetchTelegramStatus();
  }, []);

  const handleSyncTelegram = async () => {
    setIsSyncingTelegram(true);
    try {
      await fetch('/api/telegram/sync', { method: 'POST' });
      fetchTelegramStatus();
    } catch (e) {
      console.error(e);
    } finally {
      setIsSyncingTelegram(false);
    }
  };

  const handleRunTests = async () => {
    setIsRunningTests(true);
    try {
      const res = await fetch('/api/test/run', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setTestResults(data);
      }
    } catch (e) {
      console.error('Failed to run verification tests:', e);
    } finally {
      setIsRunningTests(false);
    }
  };

  const copyToClipboard = (text: string, type: 'd1' | 'wrangler') => {
    navigator.clipboard.writeText(text);
    if (type === 'd1') {
      setCopiedD1(true);
      setTimeout(() => setCopiedD1(false), 2000);
    } else {
      setCopiedWrangler(true);
      setTimeout(() => setCopiedWrangler(false), 2000);
    }
  };

  return (
    <div className="w-full bg-[#17212D] text-[#E8E5DE] p-4 lg:p-6 space-y-6 font-sans pb-16 lg:pb-8">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#354251]">
        <div>
          <h3 className="text-base font-bold text-[#E8E5DE] font-mono flex items-center gap-2">
            <Settings className="w-4 h-4 text-[#72A98B]" />
            <span>Settings, Quality Assurance & Data Export</span>
          </h3>
          <p className="text-xs text-[#AAB4BF] font-mono mt-1">
            SignalForge runs its research server locally, while live prices depend on its configured public market-data providers.
          </p>
        </div>

        <button
          onClick={handleRunTests}
          disabled={isRunningTests}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#17212D] bg-[#72A98B] hover:bg-[#72A98B]/90 rounded transition-colors disabled:opacity-50 cursor-pointer"
        >
          <Play className={`w-3.5 h-3.5 ${isRunningTests ? 'animate-spin' : ''}`} />
          <span>{isRunningTests ? 'Running Assertions...' : 'Run Automated Test Suite'}</span>
        </button>
      </div>

      {/* Local storage and feed requirements */}
      <div className="bg-[#222B36] border border-[#354251] rounded-lg p-4 font-mono text-xs space-y-2">
        <div className="flex items-center gap-2 text-[#72A98B] font-semibold">
          <CheckCircle2 className="w-4 h-4" />
          <span>Local JSON persistence · Public market-data feeds</span>
        </div>
        <p className="text-[#AAB4BF] leading-relaxed text-[11px]">
          Cloudflare D1 is optional. Live prices depend on configured public market-data providers. Historical research requires imported one-minute candles; these are stored locally in monthly JSON partitions, separately from the rolling live-feed cache. The configured universe contains 20 currency pairs.
        </p>
      </div>

      {/* Telegram Bot Live Signal Dispatch Card */}
      <div className="bg-[#222B36] border border-[#354251] rounded-xl p-5 font-mono text-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#354251]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#6C9D91]/20 border border-[#6C9D91]/40 flex items-center justify-center text-[#6C9D91]">
              <Send className="w-4 h-4 -rotate-12 translate-x-0.5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold text-[#E8E5DE] font-mono">
                  Telegram Bot Integration (@{telegramStatus?.bot?.username || 'Forex_new_calender_bot'})
                </h4>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#72A98B]/20 text-[#72A98B] border border-[#72A98B]/40 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#72A98B] animate-pulse" />
                  {telegramStatus?.botStatus || 'CONNECTED'}
                </span>
              </div>
              <p className="text-[11px] text-[#AAB4BF] mt-0.5">
                Automatically broadcasts 5M Forex Signals (3-min advance entry) &amp; verified settlement reports to Telegram.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSyncTelegram}
              disabled={isSyncingTelegram}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#17212D] hover:bg-[#354251] text-[#E8E5DE] border border-[#354251] text-xs font-semibold transition-all disabled:opacity-50"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isSyncingTelegram ? 'animate-spin text-[#6C9D91]' : ''}`} />
              <span>{isSyncingTelegram ? 'Syncing...' : 'Sync Subscribers'}</span>
            </button>
            <button
              onClick={() => setIsTelegramModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#6C9D91] hover:bg-[#72A98B] text-[#17212D] text-xs font-bold transition-all shadow-sm"
            >
              <Users className="w-3.5 h-3.5" />
              <span>Manage Bot &amp; Subscribers ({telegramStatus?.subscribersCount ?? 0})</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px]">
          <div className="p-3 rounded-lg bg-[#17212D] border border-[#354251] space-y-1">
            <span className="text-[#AAB4BF]">Bot Profile:</span>
            <div className="font-bold text-[#E8E5DE] flex items-center gap-1">
              <span>{telegramStatus?.bot?.firstName || 'Forex news'}</span>
              <a
                href={`https://t.me/${telegramStatus?.bot?.username || 'Forex_new_calender_bot'}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#6C9D91] hover:underline flex items-center gap-0.5 ml-1"
              >
                <span>@{telegramStatus?.bot?.username || 'Forex_new_calender_bot'}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-[#17212D] border border-[#354251] space-y-1">
            <span className="text-[#AAB4BF]">Active Subscribers:</span>
            <div className="font-bold text-[#72A98B] text-sm">
              {telegramStatus?.subscribersCount ?? 0} Recipient{telegramStatus?.subscribersCount === 1 ? '' : 's'}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-[#17212D] border border-[#354251] space-y-1">
            <span className="text-[#AAB4BF]">Dispatch Status:</span>
            <div className="font-bold text-[#E8E5DE]">
              {telegramStatus?.enabled ? 'Active · 5M Signals & Outcomes' : 'Disabled in Settings'}
            </div>
          </div>
        </div>
      </div>

      <TelegramBotModal
        isOpen={isTelegramModalOpen}
        onClose={() => {
          setIsTelegramModalOpen(false);
          fetchTelegramStatus();
        }}
      />

      {/* Test Report Section */}
      {testResults && (
        <div className="bg-[#222B36] border border-[#354251] rounded-lg p-5 font-mono text-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between pb-3 border-b border-[#354251] gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#72A98B]" />
              <h4 className="text-sm font-semibold text-[#E8E5DE]">Quality Assurance Test Report</h4>
            </div>

            <div className="flex items-center gap-4">
              <span className="text-[#72A98B] font-bold">
                {testResults.summary.passed} Passed
              </span>
              {testResults.summary.failed > 0 && (
                <span className="text-[#B7797D] font-bold">
                  {testResults.summary.failed} Failed
                </span>
              )}
              <span className="text-[#AAB4BF]">
                {(testResults.summary.durationMs / 1000).toFixed(2)}s duration
              </span>
            </div>
          </div>

          <div className="space-y-2">
            {testResults.results.map((r, i) => (
              <div
                key={i}
                className="bg-[#17212D] p-3 rounded border border-[#354251] flex flex-wrap items-start justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[#AAB4BF]/60 font-semibold text-[10px]">[{r.category}]</span>
                    <strong className="text-[#E8E5DE]">{r.name}</strong>
                  </div>
                  <div className="text-[#AAB4BF] text-[11px]">{r.details}</div>
                  {r.error && <div className="text-[#B7797D] font-semibold">{r.error}</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[#AAB4BF] tabular-nums">{r.durationMs}ms</span>
                  {r.passed ? (
                    <span className="text-[#72A98B] font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> PASSED
                    </span>
                  ) : (
                    <span className="text-[#B7797D] font-semibold flex items-center gap-1">
                      <XCircle className="w-3.5 h-3.5" /> FAILED
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Optional Cloudflare D1 Export Guide */}
      <div className="space-y-2">
        <div className="text-[11px] font-mono text-[#AAB4BF]">
          Optional External Deployment Artifacts (Safe to ignore if running locally)
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 font-mono text-xs">
          {/* D1 SQL Schema */}
          <div className="bg-[#222B36] border border-[#354251] rounded-lg p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-[#E8E5DE] flex items-center gap-2">
                <Database className="w-4 h-4 text-[#72A98B]" />
                <span>Optional D1 SQL Schema (0001_initial.sql)</span>
              </h4>
              <button
                onClick={() => copyToClipboard(d1Schema, 'd1')}
                className="flex items-center gap-1 text-[11px] text-[#AAB4BF] hover:text-[#E8E5DE] bg-[#17212D] border border-[#354251] px-2.5 py-1 rounded transition-colors cursor-pointer"
              >
                {copiedD1 ? <Check className="w-3 h-3 text-[#72A98B]" /> : <Copy className="w-3 h-3" />}
                <span>{copiedD1 ? 'Copied' : 'Copy SQL'}</span>
              </button>
            </div>

            <p className="text-[#AAB4BF] text-[11px]">
              Ready for execution with <code className="text-[#E8E5DE] bg-[#17212D] px-1 py-0.5 rounded">npx wrangler d1 execute signalforge-db --file=migrations/0001_initial.sql</code>.
            </p>

            <pre className="bg-[#17212D] p-4 rounded border border-[#354251] text-[#E8E5DE] text-[11px] h-64 overflow-y-auto overflow-x-auto leading-relaxed">
              {d1Schema}
            </pre>
          </div>

          {/* wrangler.toml */}
          <div className="bg-[#222B36] border border-[#354251] rounded-lg p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-[#E8E5DE] flex items-center gap-2">
                <Cloud className="w-4 h-4 text-[#6C9D91]" />
                <span>Cloudflare Workers Config (wrangler.toml)</span>
              </h4>
              <button
                onClick={() => copyToClipboard(wranglerToml, 'wrangler')}
                className="flex items-center gap-1 text-[11px] text-[#AAB4BF] hover:text-[#E8E5DE] bg-[#17212D] border border-[#354251] px-2.5 py-1 rounded transition-colors cursor-pointer"
              >
                {copiedWrangler ? <Check className="w-3 h-3 text-[#72A98B]" /> : <Copy className="w-3 h-3" />}
                <span>{copiedWrangler ? 'Copied' : 'Copy TOML'}</span>
              </button>
            </div>

            <p className="text-[#AAB4BF] text-[11px]">
              Configures worker name, D1 binding (<code className="text-[#E8E5DE] bg-[#17212D] px-1 py-0.5 rounded">DB</code>), and hourly cron trigger (<code className="text-[#E8E5DE] bg-[#17212D] px-1 py-0.5 rounded">0 * * * *</code>).
            </p>

            <pre className="bg-[#17212D] p-4 rounded border border-[#354251] text-[#E8E5DE] text-[11px] h-64 overflow-y-auto overflow-x-auto leading-relaxed">
              {wranglerToml}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
