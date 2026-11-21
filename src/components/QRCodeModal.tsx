import React, { useEffect, useState } from 'react';
import { Check, Copy, Download, Printer, Wifi, X } from 'lucide-react';
import QRCode from 'qrcode';
import { useLanguage } from '../context/LanguageContext';
import { useToast } from '../context/ToastContext';
import { fetchLocalServerInfo } from '../services/syncService';
import { Restaurant } from '../types/menu';

interface QRCodeModalProps {
  restaurant: Restaurant | null;
  onClose: () => void;
}

function getTableLabelKey(restaurantId: string): string {
  return `smartmenu_qr_table_label_${restaurantId}`;
}

export const QRCodeModal: React.FC<QRCodeModalProps> = ({ restaurant, onClose }) => {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [tableLabel, setTableLabel] = useState(() => {
    if (typeof window === 'undefined' || !restaurant) return '';
    try {
      return window.localStorage.getItem(getTableLabelKey(restaurant.id)) ?? '';
    } catch {
      return '';
    }
  });
  const [lanBaseUrl, setLanBaseUrl] = useState<string | null>(null);
  const [preferLanUrl, setPreferLanUrl] = useState(false);

  useEffect(() => {
    if (!restaurant) return;
    try {
      setTableLabel(window.localStorage.getItem(getTableLabelKey(restaurant.id)) ?? '');
    } catch {
      // Ignore storage errors
    }
  }, [restaurant?.id]);

  useEffect(() => {
    if (!restaurant) return;
    try {
      if (tableLabel) {
        window.localStorage.setItem(getTableLabelKey(restaurant.id), tableLabel);
      } else {
        window.localStorage.removeItem(getTableLabelKey(restaurant.id));
      }
    } catch {
      // Ignore storage errors
    }
  }, [restaurant?.id, tableLabel]);

  useEffect(() => {
    if (!restaurant) return;
    let active = true;
    fetchLocalServerInfo().then((info) => {
      if (!active || !info.active || !info.primaryLanUrl) return;
      setLanBaseUrl(info.primaryLanUrl);
      const host = window.location.hostname;
      if (host === 'localhost' || host === '127.0.0.1') {
        setPreferLanUrl(true);
      }
    });
    return () => {
      active = false;
    };
  }, [restaurant?.id]);

  const baseOrigin = preferLanUrl && lanBaseUrl ? lanBaseUrl : window.location.origin;

  const menuUrl = restaurant
    ? `${baseOrigin}/?restaurant=${encodeURIComponent(restaurant.slug)}${
        tableLabel.trim() ? `&table=${encodeURIComponent(tableLabel.trim())}` : ''
      }`
    : '';

  useEffect(() => {
    if (!restaurant || !menuUrl) return;
    let active = true;
    QRCode.toDataURL(menuUrl, {
      width: 420,
      margin: 2,
      color: {
        dark: '#09090B',
        light: '#FFFFFF',
      },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        // Keep current QR image visible if regeneration fails
      });
    return () => {
      active = false;
    };
  }, [restaurant?.id, menuUrl]);

  if (!restaurant) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(menuUrl);
      setCopied(true);
      showToast(t.qr.copied);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleDownload = () => {
    if (!qrDataUrl) return;
    const link = document.createElement('a');
    link.href = qrDataUrl;
    link.download = `smartmenu-qr-${restaurant.slug}${tableLabel ? `-table-${tableLabel}` : ''}.png`;
    link.click();
    showToast(t.qr.downloadPng);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 print:bg-white print:p-0"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-modal-title"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-[#141418] border border-zinc-800 p-6 shadow-2xl print:border-zinc-300 print:bg-white print:text-black print:shadow-none"
      >
        <div className="flex items-start justify-between gap-4 print:hidden">
          <div>
            <p className="text-xs font-semibold text-orange-400">{restaurant.name}</p>
            <h3 id="qr-modal-title" className="mt-1 font-display text-2xl font-bold text-white">
              {t.qr.title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.menu.close}
            className="min-h-[44px] min-w-[44px] -mt-2 -mr-2 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="mt-2 text-sm text-zinc-400 leading-relaxed print:hidden">{t.qr.subtitle}</p>

        {/* Printable Table Card Preview */}
        <div className="mt-5 rounded-2xl bg-white text-zinc-950 p-6 text-center shadow-lg border border-zinc-200">
          {restaurant.logoUrl && (
            <img
              src={restaurant.logoUrl}
              alt={restaurant.name}
              className="w-12 h-12 rounded-lg object-cover mx-auto mb-2 border border-zinc-200"
            />
          )}
          <p className="font-display text-2xl font-bold tracking-tight text-zinc-950">
            {restaurant.name}
          </p>
          {tableLabel.trim() && (
            <p className="text-xs font-semibold uppercase tracking-wider text-red-600 mt-0.5">
              Table {tableLabel.trim()}
            </p>
          )}
          <div className="my-4 flex justify-center">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt={`QR Code ${restaurant.name}`}
                className="w-48 h-48 sm:w-52 sm:h-52 block"
              />
            ) : (
              <div className="w-48 h-48 bg-zinc-200 animate-pulse rounded-lg" />
            )}
          </div>
          <p className="text-xs font-semibold text-zinc-700">{t.qr.tableScanPrompt}</p>
          <p className="text-[11px] font-mono text-zinc-500 mt-1">SMARTMENU QR</p>
        </div>

        <div className="mt-4 print:hidden">
          <label className="block text-xs font-medium text-zinc-400 mb-1">
            {t.qr.tableNumber}
          </label>
          <input
            type="text"
            value={tableLabel}
            onChange={(e) => setTableLabel(e.target.value)}
            placeholder="01, 04, VIP..."
            className="w-full min-h-[40px] px-3 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
          />
        </div>

        <div className="mt-3 print:hidden">
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="text-xs font-medium text-zinc-400">{t.qr.directLink}</p>
            {lanBaseUrl && (
              <button
                type="button"
                onClick={() => setPreferLanUrl((prev) => !prev)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-orange-400 hover:underline cursor-pointer"
              >
                <Wifi className="w-3 h-3" aria-hidden="true" />
                <span>{preferLanUrl ? t.qr.useCurrentUrl : t.qr.useLanUrl}</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2">
            <span className="font-mono text-xs text-zinc-300 truncate flex-1">{menuUrl}</span>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2 print:hidden">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs font-medium text-white transition-colors cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                <span>{t.qr.copied}</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-zinc-300" aria-hidden="true" />
                <span>{t.qr.copyLink}</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleDownload}
            disabled={!qrDataUrl}
            className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-2.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-xs font-semibold text-white transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>PNG</span>
          </button>

          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs font-medium text-white transition-colors cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5 text-orange-400" aria-hidden="true" />
            <span>{t.qr.printCard}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
