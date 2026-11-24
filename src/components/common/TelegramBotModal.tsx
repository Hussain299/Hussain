import React, { useState, useEffect } from 'react';
import {
  Send,
  X,
  CheckCircle2,
  AlertTriangle,
  RotateCw,
  ExternalLink,
  Users,
  ShieldCheck,
  Bell,
  Trash2,
  Plus,
  Sliders,
  Check,
  FileText,
} from 'lucide-react';
import { TelegramConfig, TelegramSubscriber } from '../../types/index.js';

interface TelegramBotModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TelegramBotModal: React.FC<TelegramBotModalProps> = ({ isOpen, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sendingAuditSummary, setSendingAuditSummary] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  const [botInfo, setBotInfo] = useState<{
    configured: boolean;
    enabled: boolean;
    bot?: { id: number; username: string; firstName: string };
    botStatus: string;
    botError?: string;
    subscribersCount: number;
    subscribers: TelegramSubscriber[];
    notifyOnNewSignal: boolean;
    notifyOnSettlement: boolean;
    minConfidence: number;
    lastSyncAt?: string;
    botUrl: string;
  } | null>(null);

  // Manual subscriber input
  const [manualId, setManualId] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualType, setManualType] = useState<'user' | 'group' | 'channel'>('user');
  const [addingSub, setAddingSub] = useState(false);

  // Settings
  const [enabled, setEnabled] = useState(true);
  const [notifySignals, setNotifySignals] = useState(true);
  const [notifySettlement, setNotifySettlement] = useState(true);
  const [minConfidence, setMinConfidence] = useState(0.70);
  const [savingSettings, setSavingSettings] = useState(false);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/telegram/status');
      if (res.ok) {
        const data = await res.json();
        setBotInfo(data);
        setEnabled(data.enabled ?? true);
        setNotifySignals(data.notifyOnNewSignal ?? true);
        setNotifySettlement(data.notifyOnSettlement ?? true);
        setMinConfidence(data.minConfidence ?? 0.70);
      }
    } catch (e: any) {
      console.error('Failed to fetch Telegram status:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchStatus();
      setStatusMessage(null);
    }
  }, [isOpen]);

  const handleSync = async () => {
    setSyncing(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/telegram/sync', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setStatusMessage({
          text: `Sync complete! Found ${data.discoveredCount} new subscriber(s). Total registered: ${data.totalSubscribers}`,
          type: 'success',
        });
        await fetchStatus();
      } else {
        setStatusMessage({
          text: data.error || 'Failed to sync subscribers from Telegram',
          type: 'error',
        });
      }
    } catch (err: any) {
      setStatusMessage({ text: err.message, type: 'error' });
    } finally {
      setSyncing(false);
    }
  };

  const handleTestAlert = async (targetId?: string | number) => {
    setTesting(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/telegram/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetChatId: targetId }),
      });
      const data = await res.json();
      if (data.success) {
        setStatusMessage({
          text: `Test alert dispatched successfully to ${data.sentTo} subscriber(s)! Check Telegram.`,
          type: 'success',
        });
      } else {
        setStatusMessage({
          text: data.error || 'Failed to dispatch test alert',
          type: 'error',
        });
      }
    } catch (err: any) {
      setStatusMessage({ text: err.message, type: 'error' });
    } finally {
      setTesting(false);
    }
  };

  const handleSendAuditSummary = async (targetId?: string | number) => {
    setSendingAuditSummary(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/telegram/audit-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetChatId: targetId }),
      });
      const data = await res.json();
      if (data.success) {
        setStatusMessage({
          text: `Win & Loss Audit Summary dispatched to ${data.sentTo} Telegram subscriber(s)!`,
          type: 'success',
        });
      } else {
        setStatusMessage({
          text: data.error || 'Failed to dispatch Win & Loss Audit Summary',
          type: 'error',
        });
      }
    } catch (err: any) {
      setStatusMessage({ text: err.message, type: 'error' });
    } finally {
      setSendingAuditSummary(false);
    }
  };

  const handleAddManualSubscriber = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualId.trim()) return;
    setAddingSub(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/telegram/subscribers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: manualId.trim(),
          name: manualName.trim() || undefined,
          type: manualType,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setStatusMessage({
          text: `Subscriber ${manualId} registered successfully!`,
          type: 'success',
        });
        setManualId('');
        setManualName('');
        await fetchStatus();
      } else {
        setStatusMessage({ text: data.error || 'Could not add subscriber', type: 'error' });
      }
    } catch (err: any) {
      setStatusMessage({ text: err.message, type: 'error' });
    } finally {
      setAddingSub(false);
    }
  };

  const handleRemoveSubscriber = async (id: string | number) => {
    if (!confirm('Remove this subscriber from receiving Telegram signals?')) return;
    try {
      const res = await fetch(`/api/telegram/subscribers/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setStatusMessage({ text: 'Subscriber removed.', type: 'info' });
        await fetchStatus();
      }
    } catch (err: any) {
      setStatusMessage({ text: err.message, type: 'error' });
    }
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/telegram/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          notifyOnNewSignal: notifySignals,
          notifyOnSettlement: notifySettlement,
          minConfidence,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setStatusMessage({ text: 'Notification preferences updated.', type: 'success' });
        await fetchStatus();
      }
    } catch (err: any) {
      setStatusMessage({ text: err.message, type: 'error' });
    } finally {
      setSavingSettings(false);
    }
  };

  if (!isOpen) return null;

  const botUsername = botInfo?.bot?.username || 'Forex_new_calender_bot';
  const botFirstName = botInfo?.bot?.firstName || 'Forex news';
  const botUrl = `https://t.me/${botUsername}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-[#17212D] border border-[#354251] rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden font-sans text-[#E8E5DE]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#354251] bg-[#222B36] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#6C9D91]/20 border border-[#6C9D91]/40 flex items-center justify-center text-[#6C9D91]">
              <Send className="w-4 h-4 -rotate-12 translate-x-0.5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold tracking-wide font-mono text-[#E8E5DE]">
                  TELEGRAM SIGNAL DISPATCH
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#72A98B]/20 text-[#72A98B] border border-[#72A98B]/40 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#72A98B] animate-pulse" />
                  LIVE BOT
                </span>
              </div>
              <p className="text-[11px] text-[#AAB4BF] font-mono">
                Institutional 5M signals &amp; verified settlements linked to @{botUsername}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#AAB4BF] hover:text-[#E8E5DE] hover:bg-[#354251]/50 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-5 space-y-5 overflow-y-auto custom-scrollbar">
          {/* Status Message Banner */}
          {statusMessage && (
            <div
              className={`p-3 rounded-xl border text-xs font-mono flex items-center justify-between gap-3 ${
                statusMessage.type === 'success'
                  ? 'bg-[#72A98B]/15 border-[#72A98B]/40 text-[#72A98B]'
                  : statusMessage.type === 'error'
                  ? 'bg-[#B7797D]/15 border-[#B7797D]/40 text-[#B7797D]'
                  : 'bg-[#C5A36A]/15 border-[#C5A36A]/40 text-[#C5A36A]'
              }`}
            >
              <div className="flex items-center gap-2">
                {statusMessage.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                )}
                <span>{statusMessage.text}</span>
              </div>
              <button
                onClick={() => setStatusMessage(null)}
                className="text-[#AAB4BF] hover:text-[#E8E5DE] text-xs font-bold"
              >
                ×
              </button>
            </div>
          )}

          {/* Bot Profile Card */}
          <div className="bg-[#222B36] border border-[#354251] rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-[#17212D] border border-[#354251] flex items-center justify-center text-xl font-bold text-[#6C9D91] font-mono">
                  TG
                </div>
                <div>
                  <div className="text-sm font-bold text-[#E8E5DE] flex items-center gap-2">
                    <span>{botFirstName}</span>
                    <span className="text-xs font-mono text-[#6C9D91]">@{botUsername}</span>
                  </div>
                  <div className="text-xs text-[#AAB4BF] font-mono mt-0.5">
                    Bot ID: <code className="text-[#E8E5DE]">8386549882</code> · Token Connected
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={botUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#6C9D91] hover:bg-[#72A98B] text-[#17212D] text-xs font-bold transition-all shadow-sm"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open in Telegram</span>
                </a>
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#17212D] hover:bg-[#354251] text-[#E8E5DE] border border-[#354251] text-xs font-mono font-semibold transition-all disabled:opacity-50"
                  title="Check Telegram updates for /start from new subscribers"
                >
                  <RotateCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin text-[#6C9D91]' : ''}`} />
                  <span>{syncing ? 'Syncing...' : 'Sync Subscribers'}</span>
                </button>
              </div>
            </div>

            {/* Step-by-Step Instructions */}
            <div className="p-3 bg-[#17212D] border border-[#354251]/60 rounded-lg text-xs space-y-1.5 font-mono">
              <div className="text-[#C4A574] font-bold text-[11px] tracking-wider uppercase flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                How to Receive Signals on your Phone:
              </div>
              <ol className="list-decimal list-inside text-[#AAB4BF] space-y-1 text-[11px] leading-relaxed">
                <li>
                  Click <a href={botUrl} target="_blank" rel="noopener noreferrer" className="text-[#6C9D91] underline">Open in Telegram</a> and tap <strong className="text-[#E8E5DE]">START</strong> (or send <code className="text-[#E8E5DE]">/start</code>).
                </li>
                <li>
                  Click the <strong className="text-[#E8E5DE]">Sync Subscribers</strong> button above to auto-register your chat ID.
                </li>
                <li>
                  Click <strong className="text-[#E8E5DE]">Send Test Alert</strong> below to confirm live reception!
                </li>
              </ol>
            </div>
          </div>

          {/* Quick Actions & Test Trigger */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-[#222B36] border border-[#354251] rounded-xl font-mono text-xs">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-[#6C9D91]" />
              <span className="text-[#AAB4BF]">Registered Recipients:</span>
              <span className="font-bold text-[#E8E5DE] px-2 py-0.5 rounded-md bg-[#17212D] border border-[#354251]">
                {botInfo?.subscribersCount ?? 0}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => handleSendAuditSummary()}
                disabled={sendingAuditSummary || (botInfo?.subscribersCount ?? 0) === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#6C9D91] hover:bg-[#72A98B] text-[#17212D] font-bold text-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>{sendingAuditSummary ? 'Sending Audit...' : 'Send Win/Loss Audit Summary'}</span>
              </button>
              <button
                onClick={() => handleTestAlert()}
                disabled={testing || (botInfo?.subscribersCount ?? 0) === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#C4A574] hover:bg-[#C5A36A] text-[#17212D] font-bold text-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Send className={`w-3.5 h-3.5 ${testing ? 'animate-bounce' : ''}`} />
                <span>{testing ? 'Dispatching...' : 'Send Test Alert'}</span>
              </button>
            </div>
          </div>

          {/* Subscriber Management Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold font-mono text-[#E8E5DE] uppercase tracking-wider flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-[#6C9D91]" />
                Registered Telegram Channels &amp; Chats ({botInfo?.subscribers.length ?? 0})
              </h4>
            </div>

            {/* Subscribers List */}
            {botInfo?.subscribers && botInfo.subscribers.length > 0 ? (
              <div className="border border-[#354251] rounded-xl overflow-hidden divide-y divide-[#354251] bg-[#222B36]">
                {botInfo.subscribers.map(sub => (
                  <div key={sub.id} className="p-3 flex items-center justify-between gap-3 text-xs font-mono">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#17212D] border border-[#354251] text-[#6C9D91] shrink-0 uppercase">
                        {sub.type || 'user'}
                      </span>
                      <div className="truncate">
                        <div className="font-bold text-[#E8E5DE] truncate flex items-center gap-1.5">
                          <span>{sub.name}</span>
                          {sub.username && (
                            <span className="text-[#AAB4BF] font-normal">(@{sub.username})</span>
                          )}
                        </div>
                        <div className="text-[10px] text-[#AAB4BF] mt-0.5">
                          Chat ID: <code className="text-[#E8E5DE]">{sub.id}</code> · Added {sub.addedAt}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleTestAlert(sub.id)}
                        disabled={testing}
                        title="Send test message to this specific recipient"
                        className="px-2 py-1 rounded bg-[#17212D] hover:bg-[#354251] text-[#C4A574] border border-[#354251] text-[11px] transition-colors"
                      >
                        Test
                      </button>
                      <button
                        onClick={() => handleRemoveSubscriber(sub.id)}
                        title="Remove subscriber"
                        className="p-1 rounded bg-[#17212D] hover:bg-[#B7797D]/30 text-[#B7797D] border border-[#354251] transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center border border-dashed border-[#354251] rounded-xl bg-[#222B36]/50 font-mono text-xs text-[#AAB4BF] space-y-2">
                <p>No Telegram subscribers registered yet.</p>
                <p className="text-[11px] text-[#6C9D91]">
                  Open <a href={botUrl} target="_blank" rel="noopener noreferrer" className="underline font-bold">@{botUsername}</a> on Telegram, tap Start, then click "Sync Subscribers"!
                </p>
              </div>
            )}

            {/* Manual Add Subscriber Form */}
            <form onSubmit={handleAddManualSubscriber} className="bg-[#222B36] border border-[#354251] p-3 rounded-xl space-y-2">
              <div className="text-[11px] font-mono text-[#AAB4BF] flex items-center gap-1.5 font-bold">
                <Plus className="w-3.5 h-3.5 text-[#6C9D91]" />
                Manually Add Chat / Channel ID:
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  placeholder="Chat ID (e.g. 123456789 or -100...)"
                  value={manualId}
                  onChange={e => setManualId(e.target.value)}
                  className="flex-1 min-w-[180px] bg-[#17212D] border border-[#354251] rounded-lg px-3 py-1.5 text-xs font-mono text-[#E8E5DE] placeholder-[#AAB4BF]/50 focus:outline-none focus:border-[#6C9D91]"
                />
                <input
                  type="text"
                  placeholder="Label / Name (optional)"
                  value={manualName}
                  onChange={e => setManualName(e.target.value)}
                  className="w-36 bg-[#17212D] border border-[#354251] rounded-lg px-3 py-1.5 text-xs font-mono text-[#E8E5DE] placeholder-[#AAB4BF]/50 focus:outline-none focus:border-[#6C9D91]"
                />
                <select
                  value={manualType}
                  onChange={e => setManualType(e.target.value as any)}
                  className="bg-[#17212D] border border-[#354251] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[#E8E5DE] focus:outline-none focus:border-[#6C9D91]"
                >
                  <option value="user">User</option>
                  <option value="channel">Channel</option>
                  <option value="group">Group</option>
                </select>
                <button
                  type="submit"
                  disabled={addingSub || !manualId.trim()}
                  className="px-3 py-1.5 rounded-lg bg-[#6C9D91] hover:bg-[#72A98B] text-[#17212D] font-bold text-xs font-mono transition-colors disabled:opacity-40"
                >
                  {addingSub ? 'Adding...' : 'Add'}
                </button>
              </div>
            </form>
          </div>

          {/* Dispatch Preferences */}
          <div className="bg-[#222B36] border border-[#354251] rounded-xl p-4 space-y-3 font-mono text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-[#354251]">
              <div className="flex items-center gap-2 font-bold text-[#E8E5DE]">
                <Sliders className="w-3.5 h-3.5 text-[#6C9D91]" />
                <span>Notification Preferences</span>
              </div>
              <button
                onClick={handleSaveSettings}
                disabled={savingSettings}
                className="flex items-center gap-1.5 px-3 py-1 rounded bg-[#72A98B] hover:bg-[#72A98B]/90 text-[#17212D] font-bold text-xs transition-colors disabled:opacity-50"
              >
                <Check className="w-3 h-3" />
                <span>{savingSettings ? 'Saving...' : 'Save Preferences'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <label className="flex items-center gap-2.5 p-2.5 rounded-lg bg-[#17212D] border border-[#354251] cursor-pointer hover:border-[#6C9D91]/60 transition-colors">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={e => setEnabled(e.target.checked)}
                  className="rounded border-[#354251] text-[#6C9D91] focus:ring-0"
                />
                <div>
                  <div className="font-bold text-[#E8E5DE]">Enable Telegram Dispatch</div>
                  <div className="text-[10px] text-[#AAB4BF]">Master toggle for bot alerts</div>
                </div>
              </label>

              <label className="flex items-center gap-2.5 p-2.5 rounded-lg bg-[#17212D] border border-[#354251] cursor-pointer hover:border-[#6C9D91]/60 transition-colors">
                <input
                  type="checkbox"
                  checked={notifySignals}
                  onChange={e => setNotifySignals(e.target.checked)}
                  className="rounded border-[#354251] text-[#6C9D91] focus:ring-0"
                />
                <div>
                  <div className="font-bold text-[#E8E5DE]">Live 5M Signals</div>
                  <div className="text-[10px] text-[#AAB4BF]">3-min advance entry alerts</div>
                </div>
              </label>

              <label className="flex items-center gap-2.5 p-2.5 rounded-lg bg-[#17212D] border border-[#354251] cursor-pointer hover:border-[#6C9D91]/60 transition-colors">
                <input
                  type="checkbox"
                  checked={notifySettlement}
                  onChange={e => setNotifySettlement(e.target.checked)}
                  className="rounded border-[#354251] text-[#6C9D91] focus:ring-0"
                />
                <div>
                  <div className="font-bold text-[#E8E5DE]">Win &amp; Loss Audit Reports</div>
                  <div className="text-[10px] text-[#AAB4BF]">Auto forensic audit for every signal result</div>
                </div>
              </label>

              <div className="p-2.5 rounded-lg bg-[#17212D] border border-[#354251] space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#E8E5DE]">Min Conviction Filter:</span>
                  <span className="text-[#6C9D91] font-bold">{(minConfidence * 100).toFixed(0)}%</span>
                </div>
                <input
                  type="range"
                  min="0.50"
                  max="0.95"
                  step="0.05"
                  value={minConfidence}
                  onChange={e => setMinConfidence(parseFloat(e.target.value))}
                  className="w-full accent-[#6C9D91] cursor-pointer"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#354251] bg-[#222B36] flex items-center justify-between text-xs font-mono text-[#AAB4BF]">
          <span>Token: <code>8386549882:AAGo...nkA</code></span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#17212D] hover:bg-[#354251] text-[#E8E5DE] border border-[#354251] transition-colors font-bold"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
