import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Brain,
  Compass,
  Dna,
  History,
  LayoutDashboard,
  Link2,
  Search,
  Server,
  Sliders,
  Sparkles,
  Target,
  X,
  Zap,
} from 'lucide-react';
import { ResearchSignal } from '../../types/index.js';
import { ViewTab } from '../Sidebar.tsx';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTab: (tab: ViewTab) => void;
  signals: ResearchSignal[];
  brokerStatus?: { mode: string; liveCount: number; activeCount?: number } | null;
}

interface CommandItem {
  id: string;
  label: string;
  description: string;
  category: 'VIEW' | 'SIGNAL';
  tab: ViewTab;
  badge?: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onSelectTab,
  signals,
  brokerStatus,
}) => {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!isOpen) setQuery('');
  }, [isOpen]);

  const items = useMemo<CommandItem[]>(() => {
    const viewItems: CommandItem[] = [
      {
        id: 'nav_overview',
        label: 'Overview Desk',
        description: 'Autonomous bot telemetry, live olymp gate & 24h performance',
        category: 'VIEW',
        tab: 'overview',
        icon: LayoutDashboard,
      },
      {
        id: 'nav_signals',
        label: 'Live Signals Terminal',
        description: '3-min advance alerts, active contracts & settlement verification',
        category: 'VIEW',
        tab: 'terminal',
        badge: 'LIVE',
        icon: Zap,
      },
      {
        id: 'nav_broker',
        label: 'Olymp Trade Live Feed',
        description: `Browser companion status (${brokerStatus?.mode || 'CONNECTING'}) & active pairs`,
        category: 'VIEW',
        tab: 'broker',
        badge: brokerStatus?.mode === 'OLYMP_ACTIVE'
          ? `${brokerStatus.liveCount} ELIG · ${brokerStatus.activeCount ?? brokerStatus.liveCount} ACT`
          : brokerStatus?.activeCount
          ? `0 ELIG · ${brokerStatus.activeCount} ACT`
          : 'GATE',
        icon: Link2,
      },
      {
        id: 'nav_brain',
        label: 'Quantitative Brain & Debate Arena',
        description: '5-Agent Adversarial Debate Council, Hedge weights, Neural MLP & Autopsies',
        category: 'VIEW',
        tab: 'brain',
        badge: 'AGI',
        icon: Brain,
      },
      {
        id: 'nav_history',
        label: 'Trade History Ledger',
        description: 'Searchable archive, CSV export & settled outcomes',
        category: 'VIEW',
        tab: 'history',
        icon: History,
      },
      {
        id: 'nav_analytics',
        label: 'Analytics & PnL Equity',
        description: 'Cumulative units curve, drawdown & pair breakdown',
        category: 'VIEW',
        tab: 'analytics',
        icon: BarChart3,
      },
      {
        id: 'nav_accuracy',
        label: 'Session & Pair Accuracy',
        description: 'Empirical win rates across sessions & Olymp-verified trades',
        category: 'VIEW',
        tab: 'accuracy',
        icon: Target,
      },
      {
        id: 'nav_portfolio',
        label: 'Institutional Quant Desk & Risk',
        description: 'Quarter-Kelly sizing, 8-currency strength matrix, VaR/CVaR & promotion gate',
        category: 'VIEW',
        tab: 'portfolio',
        badge: 'RISK',
        icon: Target,
      },
      {
        id: 'nav_system',
        label: 'System Health & Diagnostics',
        description: 'Feeds, cron heartbeats, Telegram bot & ML learning recovery',
        category: 'VIEW',
        tab: 'system',
        icon: Server,
      },
      {
        id: 'nav_controls',
        label: 'Manual Bot Controls',
        description: 'Risk guardrails & emergency killswitch',
        category: 'VIEW',
        tab: 'controls',
        icon: Sliders,
      },
      {
        id: 'nav_explorer',
        label: 'Candlestick Price Explorer',
        description: 'Multi-feed M1 charting desk',
        category: 'VIEW',
        tab: 'explorer',
        icon: Compass,
      },
      {
        id: 'nav_strategy',
        label: 'Discovered Genetic Strategies',
        description: 'Synthesized non-linear mathematical formulas',
        category: 'VIEW',
        tab: 'strategy',
        icon: Sparkles,
      },
      {
        id: 'nav_evolution',
        label: 'Evolutionary Research Lab',
        description: 'Walk-forward evaluations & generational logs',
        category: 'VIEW',
        tab: 'evolution',
        icon: Dna,
      },
    ];

    const signalItems: CommandItem[] = signals.slice(0, 12).map((s) => ({
      id: `sig_${s.id}`,
      label: `${s.symbol} ${s.direction} (${s.outcomeResult !== 'PENDING' ? s.outcomeResult : s.lifecycleState})`,
      description: `${s.predictionTimeIst || s.predictionTimeUtc} · ${(s.confidence * 100).toFixed(1)}% · ${s.strategyName || s.ruleFamily}`,
      category: 'SIGNAL',
      tab: s.outcomeResult === 'WIN' || s.outcomeResult === 'LOSS' ? 'history' : 'terminal',
      badge: s.agentDebate?.verdict || s.lifecycleState,
      icon: Zap,
    }));

    return [...viewItems, ...signalItems];
  }, [signals, brokerStatus]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 14);
    return items
      .filter(
        (item) =>
          item.label.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          (item.badge || '').toLowerCase().includes(q)
      )
      .slice(0, 16);
  }, [items, query]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 px-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl sf-panel rounded-2xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[#243040] bg-[#161F2B]">
          <Search className="w-4 h-4 text-[#6C9D91] shrink-0" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'Enter' && filtered.length > 0) {
                onSelectTab(filtered[0].tab);
                onClose();
              }
            }}
            placeholder="Jump to workspace view, Olymp pair, debate verdict, or trade..."
            className="flex-1 bg-transparent text-sm text-[#E8E5DE] placeholder-[#AAB4BF]/60 focus:outline-none font-sans"
          />
          <button
            onClick={onClose}
            className="p-1 rounded-md text-[#AAB4BF] hover:text-[#E8E5DE] hover:bg-[#243040] cursor-pointer"
            aria-label="Close quick jump"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto divide-y divide-[#243040]/40 p-2">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-xs font-mono text-[#AAB4BF]">
              No matching views or signals found for &ldquo;{query}&rdquo;.
            </div>
          ) : (
            filtered.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    onSelectTab(item.tab);
                    onClose();
                  }}
                  className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl hover:bg-[#243040]/55 text-left transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-[#121820] border border-[#243040] group-hover:border-[#6C9D91]/50 flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4 text-[#6C9D91]" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-[#E8E5DE] truncate">{item.label}</div>
                      <div className="text-[11px] text-[#AAB4BF] truncate">{item.description}</div>
                    </div>
                  </div>
                  {item.badge && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#121820] border border-[#243040] text-[#C4A574] shrink-0">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        <div className="px-4 py-2 bg-[#121820] border-t border-[#243040] flex items-center justify-between text-[10px] font-mono text-[#AAB4BF]">
          <span>Enter to open top match · Esc to close</span>
          <span>Ctrl+K / Cmd+K anywhere</span>
        </div>
      </div>
    </div>
  );
};
