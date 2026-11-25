import React from 'react';
import { AlertTriangle, RefreshCw, Utensils } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  onResetToMenu?: () => void;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
    };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error instanceof Error ? error.message : 'Unexpected interface error',
    };
  }

  override componentDidCatch(error: unknown) {
    // Keep silent in production UI while ensuring state transitions cleanly
    if (import.meta.env.DEV) {
      console.error('[SmartMenu ErrorBoundary]', error);
    }
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleRecoverOffline = () => {
    try {
      window.localStorage.setItem('smartmenu_qr_active_view_v1', 'customer');
    } catch {
      // Ignore storage errors
    }
    this.props.onResetToMenu?.();
    this.setState({ hasError: false, errorMessage: '' });
  };

  override render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#09090B] text-zinc-100 flex items-center justify-center px-4 py-12">
          <div className="w-full max-w-md rounded-2xl bg-[#141418] border border-zinc-800 p-6 sm:p-8 text-center shadow-2xl space-y-5">
            <div className="w-12 h-12 rounded-xl bg-orange-500/10 border border-orange-500/30 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6 text-orange-400" aria-hidden="true" />
            </div>

            <div className="space-y-2">
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-white">
                SMARTMENU QR
              </h1>
              <p className="text-sm text-zinc-300 leading-relaxed">
                Une interruption temporaire est survenue lors de l’affichage. Vos menus locaux restent enregistrés.
              </p>
              {this.state.errorMessage && (
                <p className="text-[11px] font-mono text-zinc-500 break-words">
                  {this.state.errorMessage}
                </p>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
              <button
                type="button"
                onClick={this.handleRecoverOffline}
                className="flex-1 inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl bg-red-600 hover:bg-red-500 text-sm font-semibold text-white cursor-pointer"
              >
                <Utensils className="w-4 h-4" aria-hidden="true" />
                <span>Ouvrir le menu local</span>
              </button>
              <button
                type="button"
                onClick={this.handleReload}
                className="flex-1 inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-sm font-medium text-zinc-200 cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                <span>Actualiser</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
