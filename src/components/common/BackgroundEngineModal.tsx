import React, { useState } from 'react';
import {
  Activity,
  Bell,
  CheckCircle2,
  Cpu,
  Download,
  HardDrive,
  Radio,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  X,
  Zap
} from 'lucide-react';
import { useServiceWorker } from '../../services/serviceWorkerRegistration';
import { usePWAInstall } from '../../hooks/usePWAInstall';

interface BackgroundEngineModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BackgroundEngineModal: React.FC<BackgroundEngineModalProps> = ({ isOpen, onClose }) => {
  const {
    isSupported,
    isRegistered,
    isActive,
    isPeriodicSyncSupported,
    isPeriodicSyncRegistered,
    notificationPermission,
    lastPulseTime,
    pulsesCount,
    lastHeartbeatStatus,
    version,
    triggerPulse,
    requestNotifications,
    ping,
  } = useServiceWorker();

  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [isPulsing, setIsPulsing] = useState(false);
  const [pulseFeedback, setPulseFeedback] = useState<string | null>(null);
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [uptimeStatus, setUptimeStatus] = useState<any>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    fetch('/api/system/uptime-status')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (d) setUptimeStatus(d);
      })
      .catch(() => {});
  }, [isOpen]);

  if (!isOpen) return null;

  const handleManualPulse = async () => {
    setIsPulsing(true);
    setPulseFeedback(null);
    const success = await triggerPulse();
    setIsPulsing(false);
    setPulseFeedback(success ? 'Autonomous pulse completed successfully.' : 'Pulse triggered in background.');
    setTimeout(() => setPulseFeedback(null), 4000);
  };

  const handleRequestNotify = async () => {
    const res = await requestNotifications();
    if (res === 'granted') {
      setPulseFeedback('Background notification permissions granted.');
    } else {
      setPulseFeedback(`Notification permission status: ${res}`);
    }
    setTimeout(() => setPulseFeedback(null), 4000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-[#17212D] border border-[#354251] rounded-2xl shadow-2xl overflow-hidden font-mono text-xs flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 bg-[#222B36] border-b border-[#354251] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#6C9D91]/20 border border-[#6C9D91]/40 flex items-center justify-center text-[#6C9D91]">
              <Cpu className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-black text-[#E8E5DE] uppercase tracking-wider">
                  SignalForge 24/5 Execution &amp; Background Engine
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#72A98B]/20 text-[#72A98B] border border-[#72A98B]/30">
                  {uptimeStatus?.isSandboxedPreview ? 'DEV SANDBOX' : 'ONLINE'}
                </span>
              </div>
              <p className="text-[11px] text-[#AAB4BF] mt-0.5">
                Serverless 24/5 Cron Endpoint (<code className="text-[#72A98B]">/api/cron/tick</code>) + Service Worker Bridge
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#AAB4BF] hover:text-[#E8E5DE] hover:bg-[#354251] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Architecture Status Banner */}
          <div className={`p-4 rounded-xl border space-y-2 ${uptimeStatus?.isSandboxedPreview ? 'bg-[#C4A574]/10 border-[#C4A574]/40' : 'bg-[#222B36]/80 border-[#354251]'}`}>
            <div className={`flex items-center gap-2 font-bold text-xs uppercase ${uptimeStatus?.isSandboxedPreview ? 'text-[#C4A574]' : 'text-[#72A98B]'}`}>
              <ShieldCheck className="w-4 h-4" />
              <span>
                {uptimeStatus?.isSandboxedPreview
                  ? 'AI Studio Preview Sandbox — Deploy + Add Cron for 24/5'
                  : '24/5 Cloud Execution Ready'}
              </span>
            </div>
            <p className="text-[#AAB4BF] leading-relaxed">
              {uptimeStatus?.isSandboxedPreview ? (
                <>
                  While running inside the <strong className="text-[#E8E5DE]">AI Studio preview window</strong>, Google Cloud Run hibernates the dev container whenever the editor tab is closed. To keep the bot trading and sending Telegram alerts <strong>24/5 unattended</strong>, deploy this app via AI Studio&apos;s <strong>Deploy / Share</strong> button and point a free 1-minute external cron (<code className="text-[#72A98B]">cron-job.org</code> or UptimeRobot) at <code className="text-[#72A98B]">&lt;YOUR_URL&gt;/api/cron/tick</code>.
                </>
              ) : (
                <>
                  SignalForge is running in deployed mode with synchronous Telegram dispatch and immediate database flushing on every <code className="text-[#72A98B]">GET /api/cron/tick</code> heartbeat (external ticks received: <strong className="text-[#E8E5DE]">{uptimeStatus?.externalCronCount ?? 0}</strong>).
                </>
              )}
            </p>
          </div>

          {/* 4 Telemetry Status Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Service Worker Status */}
            <div className="p-4 rounded-xl bg-[#222B36] border border-[#354251] space-y-2">
              <div className="flex items-center justify-between text-[#AAB4BF]">
                <span className="uppercase text-[10px] font-semibold flex items-center gap-1.5">
                  <Radio className="w-3.5 h-3.5 text-[#6C9D91]" />
                  Service Worker Bridge
                </span>
                <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-[#72A98B] animate-pulse' : 'bg-[#B7797D]'}`} />
              </div>
              <div className="text-base font-black text-[#E8E5DE]">
                {isActive ? 'ACTIVE & CONTROLLING' : isRegistered ? 'REGISTERED' : 'INITIALIZING'}
              </div>
              <div className="text-[10px] text-[#AAB4BF]">
                Scope: <code className="text-[#6C9D91]">/</code> · Cache: <code className="text-[#E8E5DE]">v{version}</code>
              </div>
            </div>

            {/* Backend Daemon Pulse Status */}
            <div className="p-4 rounded-xl bg-[#222B36] border border-[#354251] space-y-2">
              <div className="flex items-center justify-between text-[#AAB4BF]">
                <span className="uppercase text-[10px] font-semibold flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-[#C4A574]" />
                  Backend Engine Pulse
                </span>
                <span className="w-2 h-2 rounded-full bg-[#72A98B] animate-ping" />
              </div>
              <div className="text-base font-black text-[#E8E5DE]">
                10-SECOND PULSE + /api/cron/tick
              </div>
              <div className="text-[10px] text-[#AAB4BF]">
                Heartbeat: <span className="text-[#72A98B] font-bold">{lastHeartbeatStatus}</span> · External Ticks: {uptimeStatus?.externalCronCount ?? 0}
              </div>
            </div>

            {/* Periodic Background Sync */}
            <div className="p-4 rounded-xl bg-[#222B36] border border-[#354251] space-y-2">
              <div className="flex items-center justify-between text-[#AAB4BF]">
                <span className="uppercase text-[10px] font-semibold flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 text-[#6C9D91]" />
                  Periodic Background Sync
                </span>
                <span className={`w-2 h-2 rounded-full ${isPeriodicSyncRegistered ? 'bg-[#72A98B]' : 'bg-[#C5A36A]'}`} />
              </div>
              <div className="text-base font-black text-[#E8E5DE]">
                {isPeriodicSyncRegistered ? 'REGISTERED & ACTIVE' : isPeriodicSyncSupported ? 'SUPPORTED' : 'SERVER AUTOPILOT FALLBACK'}
              </div>
              <div className="text-[10px] text-[#AAB4BF]">
                Tag: <code className="text-[#6C9D91]">signalforge-periodic-pulse</code>
              </div>
            </div>

            {/* Database Sync Persistence */}
            <div className="p-4 rounded-xl bg-[#222B36] border border-[#354251] space-y-2">
              <div className="flex items-center justify-between text-[#AAB4BF]">
                <span className="uppercase text-[10px] font-semibold flex items-center gap-1.5">
                  <HardDrive className="w-3.5 h-3.5 text-[#72A98B]" />
                  Database Persistence
                </span>
                <span className="w-2 h-2 rounded-full bg-[#72A98B]" />
              </div>
              <div className="text-base font-black text-[#E8E5DE]">
                data/signalforge.db.json
              </div>
              <div className="text-[10px] text-[#AAB4BF]">
                Multi-day persistent audit ledger • Survives all reloads
              </div>
            </div>
          </div>

          {/* Action Row */}
          <div className="p-4 rounded-xl bg-[#222B36] border border-[#354251] space-y-3">
            <h3 className="text-xs font-black text-[#E8E5DE] uppercase tracking-wider">
              Diagnostic &amp; Background Sync Controls
            </h3>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handleManualPulse}
                disabled={isPulsing}
                className="px-4 py-2 rounded-lg bg-[#354251] hover:bg-[#6C9D91] hover:text-[#17212D] text-[#E8E5DE] font-semibold flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
              >
                <Zap className={`w-3.5 h-3.5 ${isPulsing ? 'animate-spin' : ''}`} />
                <span>{isPulsing ? 'Executing Pulse...' : 'Trigger Background Pulse Now'}</span>
              </button>

              <button
                onClick={() => ping()}
                className="px-3.5 py-2 rounded-lg bg-[#17212D] hover:bg-[#354251] text-[#E8E5DE] font-semibold border border-[#354251] flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Ping SW Controller</span>
              </button>

              <button
                onClick={handleRequestNotify}
                className="px-3.5 py-2 rounded-lg bg-[#17212D] hover:bg-[#354251] text-[#E8E5DE] font-semibold border border-[#354251] flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Bell className="w-3.5 h-3.5 text-[#C4A574]" />
                <span>
                  {notificationPermission === 'granted'
                    ? 'Notifications: Active'
                    : 'Enable Trade Notifications'}
                </span>
              </button>
            </div>

            {pulseFeedback && (
              <div className="p-2.5 rounded bg-[#72A98B]/10 border border-[#72A98B]/30 text-[#72A98B] text-xs font-semibold flex items-center gap-2 animate-in fade-in">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{pulseFeedback}</span>
              </div>
            )}
          </div>

          {/* PWA Install Section */}
          <div className="p-4 rounded-xl bg-[#222B36] border border-[#354251] flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-xs font-black text-[#E8E5DE] uppercase tracking-wider flex items-center gap-1.5">
                <Smartphone className="w-4 h-4 text-[#6C9D91]" />
                Install SignalForge as Standalone Desktop / Mobile App
              </h3>
              <p className="text-[11px] text-[#AAB4BF] mt-0.5">
                Install directly onto your home screen or desktop taskbar for dedicated background execution.
              </p>
            </div>

            {isInstalled ? (
              <span className="px-3 py-1.5 rounded-lg bg-[#72A98B]/20 text-[#72A98B] border border-[#72A98B]/40 font-bold flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                Already Installed (Standalone)
              </span>
            ) : isInstallable ? (
              <button
                onClick={install}
                className="px-4 py-2 rounded-lg bg-[#6C9D91] hover:bg-[#72A98B] text-[#17212D] font-black flex items-center gap-2 shadow-lg transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4" />
                Install SignalForge App
              </button>
            ) : isIOS ? (
              <button
                onClick={() => setShowIOSGuide(true)}
                className="px-4 py-2 rounded-lg bg-[#C4A574] hover:bg-[#C5A36A] text-[#17212D] font-black flex items-center gap-2 shadow-lg transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4" />
                Install on iOS Safari
              </button>
            ) : (
              <span className="text-[10px] text-[#AAB4BF] italic">
                PWA manifest ready (Chromium / Safari compliant)
              </span>
            )}
          </div>

          {/* iOS Safari Guide Modal */}
          {showIOSGuide && (
            <div className="p-4 rounded-xl bg-[#17212D] border border-[#C4A574] space-y-2 text-[#E8E5DE]">
              <strong className="text-xs text-[#C4A574] block">How to Install on iPhone / iPad:</strong>
              <ol className="list-decimal pl-4 space-y-1 text-[#AAB4BF]">
                <li>Tap the <strong>Share</strong> button in the Safari toolbar.</li>
                <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
                <li>Tap <strong>Add</strong> in the top-right corner.</li>
              </ol>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-2 text-xs text-[#C4A574] underline cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-[#222B36] border-t border-[#354251] flex flex-wrap items-center justify-between text-[#AAB4BF] gap-2">
          <div className="text-[10px]">
            Last Synchronized: <span className="text-[#E8E5DE]">{lastPulseTime ? new Date(lastPulseTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST' : 'Active Continuous'}</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#354251] hover:bg-[#17212D] text-[#E8E5DE] font-semibold transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
