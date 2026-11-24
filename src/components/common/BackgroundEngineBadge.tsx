import React, { useState } from 'react';
import { Cpu, Download } from 'lucide-react';
import { useServiceWorker } from '../../services/serviceWorkerRegistration';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { BackgroundEngineModal } from './BackgroundEngineModal';

export const BackgroundEngineBadge: React.FC = () => {
  const { isActive, isRegistered, lastHeartbeatStatus } = useServiceWorker();
  const { isInstallable, isInstalled, install } = usePWAInstall();
  const [modalOpen, setModalOpen] = useState(false);

  const isHealthy = isActive || isRegistered || lastHeartbeatStatus === 'HEALTHY';

  return (
    <>
      <div className="flex items-center gap-2 font-mono text-xs">
        {/* In-App Install Quick Action (hides if already installed) */}
        {!isInstalled && isInstallable && (
          <button
            onClick={install}
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#6C9D91]/20 hover:bg-[#6C9D91]/30 border border-[#6C9D91]/40 text-[#6C9D91] hover:text-[#E8E5DE] transition-colors cursor-pointer text-[11px] font-bold"
            title="Install SignalForge PWA App"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Install App</span>
          </button>
        )}

        {/* SW Daemon Live Execution Status Pill */}
        <button
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-[#222B36] hover:bg-[#354251] border border-[#354251] text-[#E8E5DE] transition-colors cursor-pointer group shadow-sm"
          title="Click to view Service Worker & Background Execution details"
        >
          <span className="relative flex h-2 w-2">
            <span
              className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                isHealthy ? 'bg-[#72A98B]' : 'bg-[#C5A36A]'
              }`}
            />
            <span
              className={`relative inline-flex rounded-full h-2 w-2 ${
                isHealthy ? 'bg-[#72A98B]' : 'bg-[#C5A36A]'
              }`}
            />
          </span>

          <Cpu className="w-3.5 h-3.5 text-[#6C9D91] group-hover:rotate-45 transition-transform" />

          <span className="text-[11px] font-bold tracking-wider uppercase text-[#E8E5DE]">
            SW ENGINE: <span className="text-[#72A98B]">ACTIVE</span>
          </span>
        </button>
      </div>

      <BackgroundEngineModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
};
