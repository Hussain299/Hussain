import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[SignalForge ErrorBoundary caught an error]:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full bg-[#121820] text-[#E8E5DE] flex items-center justify-center p-6 font-mono">
          <div className="bg-[#161F2B] border border-[#B7797D]/50 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center gap-3 text-[#B7797D]">
              <div className="p-2.5 rounded-xl bg-[#121820] border border-[#B7797D]/40">
                <AlertTriangle className="w-6 h-6 text-[#B7797D]" />
              </div>
              <div>
                <h1 className="text-lg font-black text-[#E8E5DE]">
                  Platform Exception Caught
                </h1>
                <p className="text-xs text-[#AAB4BF]">
                  SignalForge state recovered safely. The background trading engine continues running.
                </p>
              </div>
            </div>

            {this.state.error && (
              <div className="p-3.5 rounded-xl bg-[#121820] border border-[#243040] space-y-1">
                <div className="text-[10px] text-[#AAB4BF] uppercase font-bold">Error Message:</div>
                <div className="text-xs text-[#B7797D] font-bold break-all">
                  {this.state.error.message || String(this.state.error)}
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => {
                  try {
                    localStorage.removeItem('signalforge_active_tab');
                  } catch {}
                  window.location.href = '/';
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#121820] hover:bg-[#243040] border border-[#243040] text-[#E8E5DE] text-xs font-bold transition-colors cursor-pointer"
              >
                <Home className="w-4 h-4 text-[#72A98B]" />
                <span>Return to Overview</span>
              </button>

              <button
                onClick={this.handleReset}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#72A98B] hover:bg-[#72A98B]/90 text-[#121820] text-xs font-black transition-colors cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Reload Platform</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
