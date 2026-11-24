import React from 'react';
import {
  LayoutDashboard,
  Compass,
  LineChart,
  Brain,
  Lightbulb,
  History,
  Dna,
  Users,
  Target,
  BarChart3,
  ShieldAlert,
  Settings,
  X,
  Zap,
  Activity,
  Layers,
  Sliders,
  Server,
} from 'lucide-react';

export type ViewTab =
  | 'overview'
  | 'signals'
  | 'terminal'
  | 'history'
  | 'analytics'
  | 'brain'
  | 'behaviour'
  | 'system'
  | 'health'
  | 'controls'
  | 'config'
  | 'explorer'
  | 'modellab'
  | 'strategy'
  | 'evolution'
  | 'agents'
  | 'monitor';

interface SidebarProps {
  activeTab: ViewTab;
  onTabChange: (tab: ViewTab) => void;
  activeSignalsCount: number;
  totalExperiments: number;
  isOpen?: boolean;
  onClose?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
  activeSignalsCount,
  totalExperiments,
  isOpen = false,
  onClose,
}) => {
  const navSections: Array<{
    title: string;
    items: Array<{
      id: ViewTab;
      label: string;
      desc: string;
      icon: React.ComponentType<{ className?: string }>;
      count?: number;
      badge?: string;
    }>;
  }> = [
    {
      title: 'Core Platform Pillars',
      items: [
        {
          id: 'overview',
          label: 'Overview',
          desc: 'Autonomous bot status & market summary',
          icon: LayoutDashboard,
          badge: 'AUTONOMOUS',
        },
        {
          id: 'terminal',
          label: 'Live Signals',
          desc: 'Active, verifying, 3-min advance alerts',
          icon: Zap,
          count: activeSignalsCount,
          badge: 'LIVE',
        },
        {
          id: 'history',
          label: 'Trade History Ledger',
          desc: 'Searchable, filterable archive & CSV export',
          icon: History,
        },
        {
          id: 'analytics',
          label: 'Analytics & PnL',
          desc: 'Equity trajectory, win rate & asset matrix',
          icon: BarChart3,
        },
        {
          id: 'brain',
          label: 'Quantitative Brain',
          desc: 'Neural policy, AGI loss autopsies & psychology',
          icon: Brain,
          badge: 'AGI',
        },
        {
          id: 'system',
          label: 'System & Diagnostics',
          desc: 'Feeds, Telegram gateway, database & test suite',
          icon: Server,
        },
        {
          id: 'controls',
          label: 'Manual Bot Controls',
          desc: 'Parameters, risk guardrails & killswitches',
          icon: Sliders,
          badge: 'CONFIG',
        },
      ],
    },
    {
      title: 'Quantitative Deep Dives & Labs',
      items: [
        {
          id: 'explorer',
          label: 'Price Candlestick Explorer',
          desc: 'Multi-feed M1 forex charting desk',
          icon: LineChart,
        },
        {
          id: 'strategy',
          label: 'Discovered Genetic Strategies',
          desc: 'Symbolic mathematical rule formulas',
          icon: Lightbulb,
        },
        {
          id: 'modellab',
          label: 'Model Walk-Forward Lab',
          desc: 'Combinatorial purged cross-validation',
          icon: Compass,
        },
        {
          id: 'agents',
          label: 'Trinity Research Deliberations',
          desc: 'Scientist, Engineer & Skeptical Auditor',
          icon: Users,
        },
        {
          id: 'evolution',
          label: 'Autonomous Evolution Lab',
          desc: 'Symbolic regression strategy engine',
          icon: Dna,
        },
      ],
    },
  ];

  const handleSelect = (id: ViewTab) => {
    onTabChange(id);
    if (onClose) onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      {/* Click outside to close */}
      <div className="flex-1 cursor-pointer" onClick={onClose} />

      {/* Slide-in Command Drawer */}
      <aside className="w-full max-w-md h-full bg-[#121820] border-l border-[#243040] shadow-2xl flex flex-col justify-between overflow-y-auto z-10">
        {/* Drawer Header */}
        <div className="p-5 border-b border-[#243040] flex items-center justify-between bg-[#161F2B] sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#121820] border border-[#243040] flex items-center justify-center text-[#72A98B]">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-black tracking-wider font-mono text-[#E8E5DE]">
                SIGNALFORGE
              </div>
              <div className="text-[10px] text-[#AAB4BF] font-mono uppercase tracking-wider">
                Institutional Command Suite
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-lg bg-[#121820] border border-[#243040] text-[#AAB4BF] hover:text-[#E8E5DE] transition-colors cursor-pointer"
            aria-label="Close command drawer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Categories */}
        <div className="p-4 space-y-6 flex-1 font-sans">
          {navSections.map(sec => (
            <div key={sec.title} className="space-y-1.5">
              <div className="text-[10px] font-mono font-bold tracking-widest text-[#AAB4BF]/70 uppercase px-3">
                {sec.title}
              </div>
              <div className="space-y-1">
                {sec.items.map(item => {
                  const Icon = item.icon;
                  // Handle aliases (terminal == signals, behaviour == brain, health == system, config == controls)
                  const isActive =
                    activeTab === item.id ||
                    (item.id === 'terminal' && activeTab === 'signals') ||
                    (item.id === 'brain' && activeTab === 'behaviour') ||
                    (item.id === 'system' && activeTab === 'health') ||
                    (item.id === 'controls' && activeTab === 'config');

                  return (
                    <button
                      key={item.id}
                      onClick={() => handleSelect(item.id)}
                      className={`w-full flex items-center justify-between p-3 rounded-xl transition-all text-left cursor-pointer ${
                        isActive
                          ? 'bg-[#161F2B] border border-[#72A98B] shadow-sm text-[#E8E5DE]'
                          : 'hover:bg-[#161F2B]/60 border border-transparent text-[#AAB4BF] hover:text-[#E8E5DE]'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${
                            isActive
                              ? 'bg-[#121820] border-[#72A98B] text-[#72A98B]'
                              : 'bg-[#161F2B] border-[#243040] text-[#AAB4BF]'
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold truncate text-[#E8E5DE]">
                            {item.label}
                          </div>
                          <div className="text-[11px] text-[#AAB4BF] truncate mt-0.5">
                            {item.desc}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        {item.badge && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold font-mono bg-[#72A98B]/20 text-[#72A98B] border border-[#72A98B]/30">
                            {item.badge}
                          </span>
                        )}
                        {item.count !== undefined && item.count > 0 && !item.badge && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#121820] text-[#E8E5DE] border border-[#243040]">
                            {item.count}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Drawer Footer */}
        <div className="p-4 border-t border-[#243040] bg-[#161F2B] text-[11px] font-mono text-[#AAB4BF] space-y-1">
          <div className="flex items-center justify-between">
            <span>Execution Model</span>
            <span className="text-[#E8E5DE] font-bold">5M Causal Trigger</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Server Clock</span>
            <span className="text-[#72A98B] font-bold">Indian Standard Time (IST)</span>
          </div>
        </div>
      </aside>
    </div>
  );
};
