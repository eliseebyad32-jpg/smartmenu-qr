import React from 'react';
import { AlertTriangle, Clock, RefreshCw, Server, Wifi, WifiOff } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { SyncStatus } from '../services/syncService';

interface OfflineIndicatorProps {
  syncStatus: SyncStatus;
  pendingCount: number;
  localServerActive?: boolean;
  allowLocalOverwrite?: boolean;
  lastSyncedAt?: string | null;
  onSyncNow: () => void;
  onResolveConflict?: (strategy: 'keep_local' | 'use_server') => void;
}

export const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({
  syncStatus,
  pendingCount,
  localServerActive = false,
  allowLocalOverwrite = false,
  lastSyncedAt,
  onSyncNow,
  onResolveConflict,
}) => {
  const { t, language } = useLanguage();

  if (syncStatus === 'conflict' && onResolveConflict) {
    return (
      <div
        role="alert"
        className="fixed bottom-4 left-4 right-4 sm:right-auto sm:max-w-md z-50 rounded-xl bg-zinc-900 border border-red-500/70 p-4 text-xs text-zinc-100 shadow-2xl space-y-2.5 print:hidden"
      >
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="font-semibold text-white">{t.sync.conflictTitle}</p>
            <p className="text-zinc-300 mt-0.5 leading-relaxed">{t.sync.conflictBody}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 pt-1">
          {allowLocalOverwrite && (
            <button
              type="button"
              onClick={() => onResolveConflict('keep_local')}
              className="min-h-[36px] px-3 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-semibold text-white cursor-pointer"
            >
              {t.sync.keepLocal}
            </button>
          )}
          <button
            type="button"
            onClick={() => onResolveConflict('use_server')}
            className="min-h-[36px] px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 cursor-pointer"
          >
            {t.sync.useServer}
          </button>
        </div>
      </div>
    );
  }

  const mustShowOnMobile =
    syncStatus !== 'online' || pendingCount > 0 || localServerActive;

  const formattedTime = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleTimeString(language === 'fr' ? 'fr-FR' : 'en-US', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-4 left-4 z-40 ${
        mustShowOnMobile ? 'flex' : 'hidden sm:flex'
      } items-center gap-2 max-w-[calc(100vw-11.5rem)] sm:max-w-md rounded-xl bg-[#141418]/95 backdrop-blur-md border ${
        syncStatus === 'offline'
          ? 'border-orange-500/50'
          : syncStatus === 'error'
          ? 'border-red-500/50'
          : 'border-zinc-800'
      } px-3 py-2 text-xs font-medium text-zinc-200 shadow-xl print:hidden`}
    >
      {syncStatus === 'offline' ? (
        <>
          <WifiOff className="w-3.5 h-3.5 text-orange-400 shrink-0" aria-hidden="true" />
          <span className="text-orange-300 truncate">{t.sync.statusOffline}</span>
          {pendingCount > 0 && (
            <span className="font-mono text-[11px] text-zinc-300 tabular-nums shrink-0">
              ({pendingCount})
            </span>
          )}
        </>
      ) : syncStatus === 'syncing' ? (
        <>
          <RefreshCw
            className="w-3.5 h-3.5 text-orange-400 animate-spin shrink-0"
            aria-hidden="true"
          />
          <span className="text-zinc-200 truncate">{t.sync.statusSyncing}</span>
        </>
      ) : syncStatus === 'error' ? (
        <>
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" aria-hidden="true" />
          <span className="text-red-300 truncate">{t.sync.statusError}</span>
          {pendingCount > 0 && (
            <span className="font-mono text-[11px] text-zinc-300 tabular-nums shrink-0">
              ({pendingCount})
            </span>
          )}
          <button
            type="button"
            onClick={onSyncNow}
            className="underline text-zinc-100 hover:text-white ml-1 shrink-0 cursor-pointer"
          >
            {t.sync.retry}
          </button>
        </>
      ) : pendingCount > 0 ? (
        <>
          <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
          <span className="text-amber-300 truncate">
            {t.sync.statusPending} ({pendingCount})
          </span>
          <button
            type="button"
            onClick={onSyncNow}
            className="underline text-zinc-100 hover:text-white ml-1 shrink-0 cursor-pointer"
          >
            {t.sync.syncNow}
          </button>
        </>
      ) : localServerActive ? (
        <>
          <Server className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
          <span className="text-zinc-200 truncate">{t.sync.statusLocalLan}</span>
          {formattedTime && (
            <span className="hidden md:inline font-mono text-[11px] text-zinc-400 tabular-nums">
              · {formattedTime}
            </span>
          )}
        </>
      ) : (
        <>
          <Wifi className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
          <span className="text-zinc-300 truncate">{t.sync.statusOnline}</span>
          {formattedTime && (
            <span className="hidden md:inline font-mono text-[11px] text-zinc-500 tabular-nums">
              · {formattedTime}
            </span>
          )}
        </>
      )}
    </div>
  );
};
