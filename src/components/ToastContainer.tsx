import React from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useToast } from '../context/ToastContext';

export const ToastContainer: React.FC = () => {
  const { toasts, dismissToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed top-18 right-4 z-[60] flex flex-col gap-2 w-[calc(100vw-2rem)] max-w-sm pointer-events-none"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-2xl backdrop-blur-md text-sm ${
            toast.type === 'error'
              ? 'bg-red-950/95 border-red-600/60 text-red-100'
              : toast.type === 'info'
              ? 'bg-zinc-900/95 border-orange-500/50 text-zinc-100'
              : 'bg-zinc-900/95 border-emerald-500/50 text-zinc-100'
          }`}
        >
          {toast.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
          ) : toast.type === 'info' ? (
            <Info className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
          )}

          <p className="flex-1 leading-snug">{toast.message}</p>

          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            aria-label="Fermer"
            className="text-zinc-400 hover:text-white p-0.5 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};
