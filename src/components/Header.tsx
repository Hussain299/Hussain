import React, { useState, useEffect } from 'react';
import {
  Clock,
  RotateCw,
  Layers,
  Menu,
  Bell,
  Zap,
  Brain,
  BarChart3,
  Target,
  History,
  Sliders,
  Server,
  LayoutDashboard,
  Link2,
  Cloud,
  LogIn,
  LogOut,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { soundNotificationService } from '../utils/notifications.ts';
import { ViewTab } from './Sidebar.tsx';
import { BackgroundEngineBadge } from './common/BackgroundEngineBadge.tsx';
import { TelegramBotBadge } from './common/TelegramBotBadge.tsx';
import { useFirebase } from '../contexts/FirebaseContext.tsx';

interface HeaderProps {
  activeTab: ViewTab;
  onTabChange: (tab: ViewTab) => void;
  onRunCycle: () => void;
  isRunningCycle: boolean;
  onRefresh: () => void;
  isRefreshing: boolean;
  activeSignalsCount: number;
  onToggleSidebar: () => void;
  brokerStatus?: { mode: string; liveCount: number; activeCount?: number; discoveredCount?: number; allowAllPairs?: boolean; reason?: string } | null;
  onOpenCommandPalette?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onTabChange,
  onRunCycle,
  isRunningCycle,
  onRefresh,
  isRefreshing,
  activeSignalsCount,
  onToggleSidebar,
  brokerStatus,
  onOpenCommandPalette,
}) => {
  const [timeIst, setTimeIst] = useState<string>('');
  const [isMarketOpen, setIsMarketOpen] = useState<boolean>(true);
  const { user, cloudSignals, isSyncingCloud, signInWithGoogle, signOutUser } = useFirebase();

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeIst(
        new Intl.DateTimeFormat('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        }).format(now).toUpperCase() + ' IST'
      );

      const day = now.getUTCDay(); // 0 = Sun, 5 = Fri, 6 = Sat
      const utcHour = now.getUTCHours();
      const isWeekend = (day === 5 && utcHour >= 21) || day === 6 || (day === 0 && utcHour < 21);
      setIsMarketOpen(!isWeekend);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const primaryTabs: Array<{ id: ViewTab; label: string; icon: React.ComponentType<{ className?: string }>; count?: number }> = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'terminal', label: 'Signals', icon: Zap, count: activeSignalsCount },
    { id: 'history', label: 'History', icon: History },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'accuracy', label: 'Accuracy', icon: Target },
    { id: 'portfolio', label: 'Quant Desk', icon: ShieldCheck },
    { id: 'broker', label: 'Broker', icon: Link2 },
    { id: 'brain', label: 'Brain', icon: Brain },
    { id: 'system', label: 'System', icon: Server },
    { id: 'controls', label: 'Controls', icon: Sliders },
  ];

  return (
    <div className="w-full sticky top-0 z-30 flex flex-col shadow-md">
      <header className="h-14 border-b border-[#243040] bg-[#121820]/95 backdrop-blur-md px-3 sm:px-5 flex items-center justify-between gap-2 z-30 shrink-0 w-full font-sans overflow-hidden">
        {/* Left: Brand Identity, Market Status & Live Broker Pill */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0 min-w-0">
          <button
            onClick={() => onTabChange('overview')}
            className="flex items-center gap-2 cursor-pointer text-left focus:outline-none shrink-0"
          >
            <div className="w-8 h-8 rounded-lg bg-[#161F2B] border border-[#243040] flex items-center justify-center text-[#72A98B]">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm sm:text-base font-black tracking-widest font-mono text-[#E8E5DE] leading-tight">
                SIGNALFORGE
              </div>
              <div className="hidden xl:block text-[9px] font-mono text-[#AAB4BF] tracking-wider uppercase">
                Institutional Terminal
              </div>
            </div>
          </button>

          {/* Market Status Chip */}
          {isMarketOpen ? (
            <span className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#72A98B]/15 border border-[#72A98B]/35 text-[#72A98B] text-[10px] font-mono font-bold shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-[#72A98B] animate-pulse" />
              FX LIVE
            </span>
          ) : (
            <span className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#C5A36A]/15 border border-[#C5A36A]/35 text-[#C5A36A] text-[10px] font-mono font-bold shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-[#C5A36A]" />
              WEEKEND PAUSE
            </span>
          )}

          {/* Live Trading Universe Pill (Manual Pairs in AI Studio vs Olymp Trade in Production) */}
          <button
            onClick={() => onTabChange('broker')}
            title={brokerStatus?.reason || 'Click to inspect active trading universe'}
            className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold border transition-colors cursor-pointer shrink-0 ${
              brokerStatus?.mode === 'OLYMP_ACTIVE' || brokerStatus?.mode === 'MANUAL_ACTIVE'
                ? 'bg-[#72A98B]/15 border-[#72A98B]/40 text-[#72A98B] hover:bg-[#72A98B]/25'
                : 'bg-[#C5A36A]/10 border-[#C5A36A]/35 text-[#C5A36A] hover:bg-[#C5A36A]/20'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                brokerStatus?.mode === 'OLYMP_ACTIVE' || brokerStatus?.mode === 'MANUAL_ACTIVE'
                  ? 'bg-[#72A98B] animate-pulse'
                  : 'bg-[#C5A36A]'
              }`}
            />
            <span>
              {brokerStatus?.allowAllPairs
                ? `ALL · ${brokerStatus.liveCount}/29`
                : brokerStatus?.mode === 'MANUAL_ACTIVE'
                ? `MANUAL · ${brokerStatus.liveCount}`
                : brokerStatus?.mode === 'OLYMP_ACTIVE'
                ? `OLYMP · ${brokerStatus.liveCount}/${brokerStatus.activeCount ?? brokerStatus.liveCount}`
                : brokerStatus?.activeCount
                ? `OLYMP · 0/${brokerStatus.activeCount}`
                : 'OLYMP · WAIT'}
            </span>
          </button>
        </div>

        {/* Right: Actions, IST Clock & Menu Drawer Trigger */}
        <div className="flex items-center gap-1.5 sm:gap-2 text-xs shrink-0 font-mono">
          {onOpenCommandPalette && (
            <button
              onClick={onOpenCommandPalette}
              title="Quick jump (Ctrl+K / Cmd+K)"
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#161F2B] hover:bg-[#243040] border border-[#243040] text-[#AAB4BF] hover:text-[#E8E5DE] transition-colors cursor-pointer"
            >
              <Search className="w-3.5 h-3.5 text-[#6C9D91]" />
              <span className="hidden 2xl:inline text-[10px]">Jump</span>
              <kbd className="text-[9px] px-1 py-0.2 rounded bg-[#121820] border border-[#354251] text-[#AAB4BF]">
                ⌘K
              </kbd>
            </button>
          )}

          {/* Telegram Bot Signal Link Badge */}
          <TelegramBotBadge />

          {/* Service Worker Background Daemon Monitor Badge */}
          <BackgroundEngineBadge />

          {/* Persistent Firestore Cloud Ledger Auth / Sync */}
          {user ? (
            <button
              onClick={signOutUser}
              title={`Cloud Ledger synced (${cloudSignals.length} records) as ${user.email || user.displayName}. Click to sign out.`}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-[#72A98B]/15 hover:bg-[#243040] border border-[#72A98B]/40 text-[#72A98B] font-bold transition-colors cursor-pointer"
            >
              <Cloud className={`w-3.5 h-3.5 ${isSyncingCloud ? 'animate-pulse' : ''}`} />
              <span className="hidden 2xl:inline">{cloudSignals.length} Synced</span>
              <LogOut className="w-3 h-3 text-[#AAB4BF]" />
            </button>
          ) : (
            <button
              onClick={signInWithGoogle}
              title="Sign in with Google to permanently sync your trade ledger to Firebase Firestore"
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-[#161F2B] hover:bg-[#243040] border border-[#243040] text-[#E8E5DE] font-semibold transition-colors cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5 text-[#72A98B]" />
              <span className="hidden 2xl:inline">Cloud</span>
            </button>
          )}

          {/* Real-time IST Clock */}
          <div className="hidden xl:flex items-center gap-1.5 text-[#E8E5DE] font-mono tabular-nums bg-[#161F2B] border border-[#243040] px-2.5 py-1.5 rounded-lg font-bold">
            <Clock className="w-3.5 h-3.5 text-[#6C9D91]" />
            <span>{timeIst}</span>
          </div>

          {/* Audio Alert Test */}
          <button
            onClick={() => {
              soundNotificationService.playSignalAlertSound();
              soundNotificationService.sendBrowserNotification(
                '⚡ Signal Alert Chime',
                'Sound alert calibrated. Fresh 5M signals will chime automatically.'
              );
            }}
            title="Test audio chime notification"
            className="p-2 rounded-lg text-[#C4A574] bg-[#161F2B] hover:bg-[#243040] border border-[#243040] transition-colors flex items-center gap-1.5 font-medium cursor-pointer"
          >
            <Bell className="w-3.5 h-3.5 text-[#C4A574]" />
          </button>

          {/* Scan / Refresh Trigger */}
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            title="Sync live signals"
            className="p-2 sm:px-2.5 sm:py-1.5 text-xs font-semibold text-[#AAB4BF] hover:text-[#E8E5DE] bg-[#161F2B] hover:bg-[#243040] border border-[#243040] rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-[#72A98B]' : ''}`} />
            <span className="hidden 2xl:inline">Sync</span>
          </button>

          {/* Full Suite Navigation Trigger */}
          <button
            onClick={onToggleSidebar}
            aria-label="Open full command suite"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-[#72A98B] hover:bg-[#72A98B]/90 text-[#121820] transition-colors shadow-sm cursor-pointer"
          >
            <Menu className="w-4 h-4" />
            <span className="hidden sm:inline">Suite</span>
            {activeSignalsCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-[#121820] animate-ping" />
            )}
          </button>
        </div>
      </header>

      {/* Primary Navigation Bar (Full-width, unclipped across all desktop, laptop, and mobile screens) */}
      <nav className="w-full h-10 bg-[#161F2B] border-b border-[#243040] px-3 sm:px-5 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0 font-sans">
        {primaryTabs.map(tab => {
          const Icon = tab.icon;
          const isActive =
            activeTab === tab.id ||
            (tab.id === 'terminal' && activeTab === 'signals') ||
            (tab.id === 'brain' && (activeTab === 'behaviour' || activeTab === 'modellab' || activeTab === 'strategy' || activeTab === 'evolution' || activeTab === 'agents')) ||
            (tab.id === 'system' && (activeTab === 'health' || activeTab === 'config')) ||
            (tab.id === 'controls' && activeTab === 'config');

          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all shrink-0 cursor-pointer ${
                isActive
                  ? 'bg-[#121820] text-[#E8E5DE] border border-[#72A98B] shadow-sm'
                  : 'text-[#AAB4BF] hover:text-[#E8E5DE] bg-[#161F2B]'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-[#72A98B]' : 'text-[#AAB4BF]'}`} />
              <span>{tab.label}</span>
              {tab.count !== undefined && tab.count > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[9px] font-mono font-black bg-[#72A98B] text-[#121820]">
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
};
